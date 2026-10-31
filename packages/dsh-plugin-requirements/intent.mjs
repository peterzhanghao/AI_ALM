/**
 * Intent clarification transport for the requirements plugin (contract §2).
 *
 * Business rules live in `packages/alm-core/src/intent/index.mjs`: session
 * schema, stored layout, strict model-output normalisation, readiness,
 * confirmation artifacts and the idempotency journal. This module owns only the
 * gateway concerns:
 *   - request validation (unknown action/field/route rejected, body as data),
 *   - model selection + streaming and the two-phase stale-run guard,
 *   - mapping core errors onto `{ok:false,error:{code,message,reasons?}}`
 *     without echoing prompts, model output or credentials,
 *   - projecting sessions for the UI through `renderSessionView`.
 *
 * The core import is namespaced on purpose: the core slice is being built
 * against the same contract in parallel, so every call point is isolated in the
 * adapter block below and a signature change is a one-line fix.
 */
import { randomBytes } from 'node:crypto'
import * as core from '../alm-core/src/intent/index.mjs'
import {
  InvestigationError,
  buildEvidenceNote,
  listInvestigations,
  readInvestigation,
  runInvestigation,
} from './investigate.mjs'

export const MAX_BODY_BYTES = 64 * 1024
const MAX_INPUT_TEXT = 20_000
const MAX_EXTRACTED_TEXT = 40_000
const MAX_FREE_TEXT = 4_000
const SESSION_ID_PATTERN = /^INT-\d{14}-[0-9a-f]{6}$/
const ROUTES = ['create', 'change', 'reuse', 'investigate', 'decline', 'answer']
const SOURCES = ['text', 'ocr', 'chat']
const EDIT_FIELDS = ['route', 'title', 'problem', 'goal', 'inScope', 'outOfScope', 'acceptance', 'owner', 'priority', 'unknownResolutions']
const UNKNOWN_RESOLUTIONS = ['clarify', 'investigate', 'exclude', 'pending']

/** Every HTTP error code in contract §2 mapped to its status. */
const STATUS_BY_CODE = {
  'invalid-request': 400,
  'unknown-action': 400,
  'invalid-json': 400,
  'body-too-large': 413,
  'unknown-session': 404,
  'unknown-project': 404,
  'stale-input': 409,
  'stale-context': 409,
  'idempotency-conflict': 409,
  'already-committed': 409,
  'not-ready': 422,
  'unresolved-source': 422,
  'missing-acceptance': 422,
  'invalid-change-base': 422,
  'no-question': 422,
  'invalid-investigation': 422,
  'outside-root': 403,
  'too-large': 413,
  'write-failed': 500,
  'context-failed': 500,
  'internal-error': 500,
  'ai-call-failed': 502,
  'ai-invalid-output': 502,
  'ai-model-unavailable': 503,
  'ai-unavailable': 503,
  'no-model': 503,
}

// Top-level request keys accepted per action. Anything else is rejected
// (`invalid-request`) so material cannot smuggle control fields (INT-16).
const ACTION_KEYS = {
  analyze: ['action', 'root', 'input', 'explicit', 'projectId', 'selectedRequirementId', 'sessionId', 'provider', 'model', 'actor', 'investigationIds'],
  answer: ['action', 'root', 'sessionId', 'expectedInputRevision', 'questionId', 'optionId', 'text', 'actor'],
  edit: ['action', 'root', 'sessionId', 'expectedInputRevision', 'itemId', 'fields', 'actor'],
  investigate: ['action', 'root', 'sessionId', 'questionId', 'question', 'focus', 'expectedInputRevision', 'provider', 'model', 'actor'],
  confirm: ['action', 'root', 'sessionId', 'expectedInputRevision', 'contextSnapshotId', 'confirmation', 'idempotencyKey', 'actor'],
  cancel: ['action', 'root', 'sessionId', 'actor'],
  migrate: ['action', 'root'],
  load: ['action', 'root', 'session', 'sessionId'],
}

export class IntentHttpError extends Error {
  constructor(code, message, { status, details, manualFallback = false } = {}) {
    super(message)
    this.name = 'IntentHttpError'
    this.code = code
    this.status = status ?? STATUS_BY_CODE[code] ?? 500
    this.details = details
    this.manualFallback = manualFallback
    // A saved session handed back with a 503 so the UI can keep editing by hand.
    this.session = undefined
  }
}

const invalid = (message, details) => new IntentHttpError('invalid-request', message, { status: 400, details })
const staleInput = (session, extra = {}) =>
  new IntentHttpError('stale-input', '输入已变化，旧的分析结果不能覆盖当前会话', {
    status: 409,
    details: { expectedInputRevision: session?.input?.inputRevision ?? null, ...extra },
  })
const staleContext = (session) =>
  new IntentHttpError('stale-context', '项目上下文已变化，请重新分析后再确认', {
    status: 409,
    details: { contextSnapshotId: session?.context?.contextSnapshotId ?? null },
  })
const alreadyCommitted = () => new IntentHttpError('already-committed', '会话已经确认保存，不能再修改', { status: 409 })
const defaultNow = () => new Date().toISOString()

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

function assertPlainObject(value, field) {
  if (!isPlainObject(value)) throw invalid(`${field} must be an object`)
}

function assertKnownFields(object, allowed, field) {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) throw invalid(`unknown field: ${field}.${key}`, { field: `${field}.${key}` })
  }
}

function truncated(value, max) {
  const text = String(value)
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function optionalString(value, field, max = 200, { trimmed = true } = {}) {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw invalid(`${field} must be a string`)
  const text = trimmed ? value.trim() : value
  if (text === '') return null
  if (text.length > max) throw invalid(`${field} is too long (max ${max})`)
  return text
}

function requireString(value, field, { max = 200, min = 1 } = {}) {
  if (typeof value !== 'string') throw invalid(`${field} must be a string`)
  const text = value.trim()
  if (text.length < min) throw invalid(`${field} is required`)
  if (text.length > max) throw invalid(`${field} is too long (max ${max})`)
  return text
}

function requireInteger(value, field) {
  if (!Number.isInteger(value) || value < 0) throw invalid(`${field} must be a non-negative integer`)
  return value
}

function requireEnum(value, allowed, field) {
  const text = requireString(value, field, { max: 64 })
  if (!allowed.includes(text)) throw invalid(`${field} must be one of ${allowed.join('|')}`)
  return text
}

function assertSessionId(value) {
  if (typeof value !== 'string' || !SESSION_ID_PATTERN.test(value)) {
    throw new IntentHttpError('unknown-session', `意图会话不存在：${truncated(value ?? '', 64)}`, { status: 404 })
  }
  return value
}

// ---------------------------------------------------------------------------
// Error projection
// ---------------------------------------------------------------------------

/** Keep only codes, field names and artifact pointers — never prompts or output. */
function sanitizeDetails(details) {
  if (!isPlainObject(details)) return undefined
  const out = {}
  for (const key of ['field', 'fields', 'code', 'expectedInputRevision', 'inputRevision', 'contextSnapshotId', 'sessionId', 'itemId', 'analysisRunId', 'appliedArtifacts', 'rawExcerpt', 'attempts']) {
    const value = details[key]
    if (value === undefined) continue
    if (key === 'rawExcerpt') {
      if (typeof value === 'string') out.rawExcerpt = truncated(value, 4_000)
      continue
    }
    if (key === 'attempts') {
      if (Number.isInteger(value)) out.attempts = value
      continue
    }
    if (key === 'appliedArtifacts') {
      const artifacts = sanitizeArtifacts(value)
      if (artifacts) out.appliedArtifacts = artifacts
      continue
    }
    if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
      out[key] = value.slice(0, 20).map((entry) => truncated(entry, 80))
      continue
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out[key] = typeof value === 'string' ? truncated(value, 200) : value
    }
  }
  return Object.keys(out).length ? out : undefined
}

function sanitizeArtifacts(value) {
  if (!Array.isArray(value)) return undefined
  return value.slice(0, 20).map((entry) => ({
    kind: typeof entry?.kind === 'string' ? truncated(entry.kind, 40) : 'artifact',
    id: entry?.id === undefined ? null : truncated(entry.id, 120),
    path: entry?.path === undefined ? null : truncated(entry.path, 300),
  }))
}

function safeReasons(value) {
  if (!Array.isArray(value)) return undefined
  const reasons = value
    .slice(0, 20)
    .filter((entry) => isPlainObject(entry))
    .map((entry) => ({
      code: typeof entry.code === 'string' ? truncated(entry.code, 80) : 'not-ready',
      message: typeof entry.message === 'string' ? truncated(entry.message, 300) : '',
      ...(entry.itemId === undefined ? {} : { itemId: truncated(entry.itemId, 120) }),
    }))
  return reasons.length ? reasons : undefined
}

/** Tolerant JSON read, used only to bind the run's context id (core re-validates). */
function parseJsonObject(output) {
  const text = String(output).trim().replace(/^```(?:json)?[ \t]*\r?\n?/i, '').replace(/```\s*$/, '').trim()
  try {
    const value = JSON.parse(text)
    return isPlainObject(value) ? value : null
  } catch {
    return null
  }
}

function fieldNames(details) {
  if (!isPlainObject(details)) return []
  const raw = Array.isArray(details.fields) ? details.fields : details.field === undefined ? [] : [details.field]
  return raw
    .filter((entry) => typeof entry === 'string' && /^[A-Za-z0-9_.\[\]]{1,64}$/.test(entry))
    .slice(0, 20)
}

/** Normalise any thrown value onto the contract's HTTP error shape. */
export function toIntentHttpError(error, fallbackCode = 'internal-error') {
  if (error instanceof IntentHttpError) return error
  const code = typeof error?.code === 'string' && error.code ? error.code : fallbackCode
  const coreStatus = Number.isInteger(error?.status) ? error.status : undefined

  // Provider output and prompt fragments may appear in AI error messages, so
  // these four codes always get a fixed message and structural details only.
  if (['ai-invalid-output', 'invalid-analysis', 'invalid-model-output', 'malformed-json', 'ai-empty'].includes(code)) {
    return new IntentHttpError('ai-invalid-output', 'AI 返回内容不符合意图契约，可重试或手动填写候选', {
      status: 502,
      details: { code: truncated(code, 80), fields: fieldNames(error?.details) },
    })
  }
  if (['ai-call-failed', 'ai-timeout'].includes(code)) {
    return new IntentHttpError('ai-call-failed', 'AI 调用失败，可重试或手动填写候选', { status: 502 })
  }
  if (['ai-model-unavailable', 'ai-unavailable', 'no-model'].includes(code)) {
    return new IntentHttpError('no-model', '未配置可用的模型，可手动填写候选后保存会话', {
      status: 503,
      manualFallback: true,
    })
  }
  const message = typeof error?.message === 'string' && error.message ? error.message : code
  const fallbackStatus = fallbackCode === 'write-failed' ? 500 : fallbackCode === 'ai-invalid-output' ? 502 : 400
  return new IntentHttpError(code, truncated(message, 500), {
    status: coreStatus ?? STATUS_BY_CODE[code] ?? fallbackStatus,
    details: error?.details,
  })
}

/** Map a thrown value to `{status, payload}` for the HTTP handler. */
export function intentErrorResponse(error) {
  const normalized = toIntentHttpError(error)
  const payload = { ok: false, error: { code: normalized.code, message: normalized.message } }
  const source = isPlainObject(normalized.details) ? normalized.details : {}
  const reasons = safeReasons(source.reasons)
  if (reasons) payload.error.reasons = reasons
  const artifacts = sanitizeArtifacts(source.appliedArtifacts)
  if (artifacts) payload.error.appliedArtifacts = artifacts
  const details = sanitizeDetails(source)
  if (details) payload.error.details = details
  if (normalized.manualFallback) payload.manualFallback = true
  if (normalized.session) payload.session = normalized.session
  return { status: normalized.status, payload }
}

// ---------------------------------------------------------------------------
// Core adapters — the only place that touches core session mutation semantics.
// ---------------------------------------------------------------------------

function noModelError(session) {
  const error = new IntentHttpError('no-model', '未配置可用的模型，可手动填写候选后保存会话', {
    status: 503,
    manualFallback: true,
  })
  if (session) error.session = projectSession(session)
  return error
}

async function requireSession(root, sessionId) {
  assertSessionId(sessionId)
  let session = null
  try {
    // Contract: loadSession throws IntentError('unknown-session', 404).
    session = await core.loadSession({ root, sessionId })
  } catch (error) {
    if (error?.code === 'unknown-session') {
      throw new IntentHttpError('unknown-session', `意图会话不存在：${sessionId}`, { status: 404 })
    }
    throw toIntentHttpError(error, 'unknown-session')
  }
  if (!isPlainObject(session) || typeof session.sessionId !== 'string') {
    throw new IntentHttpError('unknown-session', `意图会话不存在：${sessionId}`, { status: 404 })
  }
  return session
}

async function persist(root, session) {
  if (!isPlainObject(session)) throw new IntentHttpError('internal-error', '会话状态无效', { status: 500 })
  const saved = await core.saveSession({ root, session })
  return isPlainObject(saved) ? saved : session
}

function inputForCore(input, explicit) {
  return {
    text: input.text,
    source: input.source,
    extractedText: input.extractedText,
    attachment: input.attachment,
    explicit: explicit ?? { owner: null, priority: null },
  }
}

function attachContext(session, context) {
  if (!context) return session
  if (typeof core.attachContext === 'function') return core.attachContext({ session, context })
  // §1: session.context is the read-set projection bound to contextSnapshotId.
  return { ...session, context }
}

/**
 * `setEdits` only stores per-item fields; unknown resolutions live on
 * `item.unknowns[]`. Apply them on the session clone before the single save.
 */
function applyUnknownResolutions(session, resolutions, itemId, now) {
  const next = { ...session, items: (session.items ?? []).map((item) => ({ ...item })) }
  const pending = new Map()
  for (const item of next.items) {
    const list = Array.isArray(item.unknowns) ? item.unknowns.map((unknown) => ({ ...unknown })) : []
    item.unknowns = list
    pending.set(item.itemId, list)
  }
  for (const entry of resolutions) {
    const targetId =
      optionalString(entry.itemId, 'fields.unknownResolutions.itemId', 200) ??
      optionalString(itemId, 'itemId', 200) ??
      (next.items.find((item) => item.excluded !== true)?.itemId ?? null)
    if (!targetId) throw invalid('unknownResolutions 需要指定 itemId')
    const list = pending.get(targetId)
    if (!list) throw invalid(`unknownResolutions 指向未知条目：${targetId}`)
    const description = optionalString(entry.description, 'fields.unknownResolutions.description', 500)
    let index = -1
    if (description) index = list.findIndex((unknown) => unknown.description === description)
    else index = list.findIndex((unknown) => !unknown.resolution || unknown.resolution === 'pending')
    if (index < 0) throw invalid(`未找到要解决的未知项：${description ?? targetId}`)
    const unknown = list[index]
    unknown.resolution = entry.resolution
    if (entry.reason) unknown.resolutionReason = truncated(entry.reason, 2_000)
    unknown.resolvedAt = now
  }
  return next
}

/**
 * Manual fallback: when no model output produced an item (503 no-model, 502
 * model failure, or an analysis with zero items), a human still needs an item
 * to edit and confirm. The stub only carries the user's own original words as
 * its source reference — never an AI suggestion — and every candidate field
 * stays empty until a human fills it through `edit` (INT-16: input is data).
 */
function manualStubItem(session) {
  const text = String(session?.input?.text ?? '').replace(/\s+/g, ' ').trim()
  return {
    itemId: 'ITM-MANUAL-1',
    sourceRefs: text ? [{ ref: 'input.text', line: null, endLine: null, quote: truncated(text, 2_000) }] : [],
    userProblem: null,
    desiredOutcome: null,
    recommendedRoute: null,
    routeRationale: null,
    related: [],
    unknowns: [],
    assumptions: [],
    counterexample: null,
    valueCheck: null,
    candidate: null,
    fields: {},
  }
}

function ensureManualStub(session) {
  const items = Array.isArray(session.items) ? session.items : []
  if (items.some((item) => item && item.excluded !== true)) return session
  return { ...session, items: [...items, manualStubItem(session)] }
}

/** Project a session for the UI, optionally carrying readiness (§4). */
export function projectSession(session, readiness) {
  let projected
  try {
    projected = core.renderSessionView(session)
  } catch {
    projected = null
  }
  const view = isPlainObject(projected) ? projected : { ...session }
  if (readiness) view.readiness = readiness
  return view
}

/** Best-effort readiness; core recomputes the read-set itself at confirm (§4). */
function readinessFor(session, context) {
  try {
    const value = core.evaluateReadiness({ session, contextNow: context ?? session?.context })
    if (!isPlainObject(value)) return null
    return {
      ready: value.ready === true,
      reasons: Array.isArray(value.reasons) ? value.reasons : [],
      warnings: Array.isArray(value.warnings) ? value.warnings : [],
    }
  } catch {
    return null
  }
}

/** Public, serialisable progress for a background answer re-analysis. */
function analysisStatusFor(sessionId) {
  const entry = backgroundRuns.get(sessionId)
  if (!entry) return null
  const { session, ...status } = entry
  return status
}

function withAnalysisStatus(payload, sessionId) {
  const status = analysisStatusFor(sessionId)
  if (!status) return payload
  if (payload.session) payload.session.analysisStatus = status
  payload.analysisStatus = status
  return payload
}

function newRunId() {
  return `RUN-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`
}

function flattenContent(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'string' ? part : typeof part?.text === 'string' ? part.text : ''))
      .join('')
  }
  return ''
}

/** Collect the model answer; streaming/tool failures become 502 ai-call-failed. */
async function streamOutput({ stream, selection, messages }) {
  const systemParts = []
  const dialog = []
  for (const message of Array.isArray(messages) ? messages : []) {
    if (!isPlainObject(message)) continue
    if (message.role === 'system') {
      systemParts.push(flattenContent(message.content))
      continue
    }
    // The host LLM stream requires message.content to be a parts array; the
    // core prompt builder returns plain strings.
    dialog.push({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: Array.isArray(message.content)
        ? message.content
        : [{ type: 'text', text: flattenContent(message.content) }],
    })
  }
  let output = ''
  let finishKind = null
  const seen = []
  try {
    for await (const chunk of stream({
      provider: selection.provider,
      model: selection.model,
      system: systemParts.join('\n\n'),
      messages: dialog,
      temperature: 0.2,
      maxTokens: 8000,
    })) {
      if (chunk?.type && seen.length < 8 && !seen.includes(chunk.type)) seen.push(chunk.type)
      if (chunk?.type === 'text-delta') output += chunk.text ?? ''
      if (chunk?.type === 'finish') finishKind = chunk.reason?.kind ?? null
      if (chunk?.type === 'finish' && chunk.reason?.kind === 'error') {
        throw new IntentHttpError('ai-call-failed', 'AI 调用失败，可重试或手动填写候选', { status: 502 })
      }
    }
  } catch (error) {
    if (error instanceof IntentHttpError) throw error
    throw new IntentHttpError('ai-call-failed', 'AI 调用失败，可重试或手动填写候选', { status: 502 })
  }
  if (output.trim() === '') {
    const detail = `AI 返回为空（finish=${finishKind ?? 'none'}, chunks=${seen.join('|') || 'none'}），可重试或手动填写候选`
    throw new IntentHttpError('ai-invalid-output', detail, { status: 502 })
  }
  return output
}

async function selectModel({ body, resolveAiSelection, aiStreamFor, session }) {
  let selection = null
  try {
    selection = await resolveAiSelection({ provider: body?.provider, model: body?.model })
  } catch (error) {
    throw noModelError(session)
  }
  if (!selection?.provider || !selection?.model) throw noModelError(session)
  const stream = aiStreamFor()
  if (typeof stream !== 'function') throw noModelError(session)
  return { selection, stream }
}

// The latest run per session in this process: a newer request makes an older
// in-flight answer stale before it can be applied (INT-12). Persisted
// inputRevision is the second, restart-safe guard.
const activeRuns = new Map()

// Answering returns immediately; the re-analysis runs here so `load`/`answer`
// can report progress without holding the submit request open for model latency.
const backgroundRuns = new Map()

// ---------------------------------------------------------------------------
// Investigation evidence (contract: tmp/team/intent-investigation-contract.md §1)
// ---------------------------------------------------------------------------

const INVESTIGATION_ID = /^INV-\d{14}-[0-9a-f]{6}$/

/**
 * `analyze.investigationIds`: a client may feed up to five investigations of
 * this session back into the next analysis. Anything unknown, malformed or
 * belonging to another session is rejected (no cross-session leakage).
 */
async function normalizeInvestigationIds({ root, session, value }) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw invalid('investigationIds 必须是数组')
  if (value.length > 5) throw invalid('investigationIds 最多 5 条')
  const seen = new Set()
  const investigations = []
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== 'string' || !INVESTIGATION_ID.test(entry)) {
      throw new IntentHttpError('invalid-investigation', `investigationIds[${index}] 不是合法的调查 ID`, { status: 422 })
    }
    if (seen.has(entry)) continue
    seen.add(entry)
    const investigation = readInvestigation(root, entry)
    if (!investigation) {
      throw new IntentHttpError('invalid-investigation', `调查不存在：${entry}`, { status: 422 })
    }
    if (investigation.sessionId !== session.sessionId) {
      throw new IntentHttpError('invalid-investigation', `调查不属于当前会话：${entry}`, { status: 422 })
    }
    investigations.push(investigation)
  }
  return investigations
}

/** The question to investigate: explicit > nextQuestion > first blocking unknown. */
function questionForInvestigation(session) {
  const nextText = optionalString(session.nextQuestion?.text, 'nextQuestion.text', 2000)
  if (nextText) return nextText
  for (const item of Array.isArray(session.items) ? session.items : []) {
    if (!item || item.excluded === true) continue
    for (const unknown of Array.isArray(item.unknowns) ? item.unknowns : []) {
      if (unknown?.blocking !== true) continue
      const description = optionalString(unknown?.description, 'unknown.description', 2000)
      if (description) return description
    }
  }
  return null
}

function normalizeInvestigationFocus(value) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw invalid('focus 必须是字符串数组')
  if (value.length > 10) throw invalid('focus 最多 10 条')
  return value
    .map((entry, index) => {
      if (typeof entry !== 'string') throw invalid(`focus[${index}] 必须是字符串`)
      const trimmed = entry.trim()
      if (trimmed === '') return null
      if (trimmed.length > 300) throw invalid(`focus[${index}] 最多 300 字符`)
      return trimmed
    })
    .filter(Boolean)
}

function investigationHttpError(error, session) {
  if (error instanceof InvestigationError) {
    const status = error.status ?? (error.code === 'outside-root' ? 403 : error.code === 'too-large' ? 413 : 502)
    const http = new IntentHttpError(error.code, error.message || '调查失败', { status })
    if (error.code === 'no-model') http.manualFallback = true
    if (session && (status === 502 || status === 503)) http.session = projectSession(session)
    return http
  }
  return toIntentHttpError(error, 'ai-call-failed')
}

/** Session investigations for analyze responses / GET load (best effort). */
function listSessionInvestigations(root, sessionId) {
  try {
    return listInvestigations(root, { sessionId, limit: 20 })
  } catch {
    return []
  }
}


/** 502 payload for unusable model output: structural details plus an excerpt. */
function invalidModelOutput(error, output) {
  return new IntentHttpError('ai-invalid-output', 'AI 返回内容不符合意图契约，可重试或手动填写候选', {
    status: 502,
    details: {
      code: typeof error?.code === 'string' ? truncated(error.code, 80) : 'invalid-analysis',
      fields: fieldNames(error?.details),
      rawExcerpt: truncated(String(output ?? ''), 4_000),
    },
  })
}

/**
 * Parse + validate one model answer. The run's context snapshot id is bound
 * before validation, so the model can never retarget the session's snapshot.
 */
async function normalizeModelOutput({ output, session, context }) {
  const runContext = context ?? session.context
  const parsed = parseJsonObject(output)
  const raw =
    parsed && runContext?.contextSnapshotId && !parsed.contextSnapshotId
      ? { ...parsed, contextSnapshotId: runContext.contextSnapshotId }
      : output
  try {
    return await core.normalizeAnalysis(raw, {
      session,
      context: runContext,
      extractedText: session.input?.extractedText ?? '',
    })
  } catch (error) {
    throw invalidModelOutput(error, output)
  }
}

/** Second attempt prompt: original dialog + bad answer + the validation error. */
function buildRepairMessages(messages, output, error) {
  const fields = fieldNames(error?.details)
  const code = typeof error?.details?.code === 'string' ? error.details.code : 'invalid-analysis'
  const diagnosis = [
    '上一次输出未通过 intent-review.v1 契约校验。',
    `错误码：${code}`,
    fields.length ? `涉及字段：${fields.join(', ')}` : null,
    '请只输出修正后的 JSON 对象：不要 Markdown 围栏，不要解释，不要新增字段，不要遗漏 schemaVersion。',
  ]
    .filter(Boolean)
    .join('\n')
  return [
    ...messages,
    { role: 'assistant', content: truncated(String(output ?? ''), 4_000) },
    { role: 'user', content: diagnosis },
  ]
}

/** Reload the session and re-check the late-response guards (INT-12). */
async function assertRunCurrent({ root, sessionId, inputRevision, runId }) {
  const fresh = await requireSession(root, sessionId)
  if (fresh.state === 'committed' || fresh.state === 'cancelled') {
    throw staleInput(fresh, { reason: 'session-closed' })
  }
  if (fresh.input?.inputRevision !== inputRevision) throw staleInput(fresh, { inputRevision })
  const latestRun = activeRuns.get(sessionId)
  if (latestRun && latestRun !== runId) {
    throw staleInput(fresh, { analysisRunId: runId, reason: 'newer-run' })
  }
  return fresh
}

/** Best-effort error-run bookkeeping so a repair retry is visible in runs[]. */
async function recordFailedAttempt({ root, session, model, runId, inputRevision, errorCode, now }) {
  try {
    await core.recordAnalysis({
      root,
      session,
      analysis: null,
      model,
      runId,
      inputRevision,
      status: 'error',
      errorCode,
      now: now(),
    })
  } catch (error) {
    // Stale input must still surface as 409; a failed bookkeeping write must not
    // block the repair attempt (the success path records the final run anyway).
    if (error?.code === 'stale-input' || error?.code === 'already-committed') throw toIntentHttpError(error)
  }
}

/**
 * Run the model over the current session snapshot and apply the normalised
 * analysis. Invalid output gets exactly one repair retry. Throws 502 when both
 * attempts are unusable and 409 when the run went stale.
 */
async function runAnalysis({ root, session, context, body, resolveAiSelection, aiStreamFor, now, investigations = [] }) {
  if (session.state === 'committed') throw alreadyCommitted()
  const { selection, stream } = await selectModel({ body, resolveAiSelection, aiStreamFor, session })
  let messages = core.buildAnalysisMessages({ session, context })
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new IntentHttpError('ai-invalid-output', 'AI 提示构建失败，可重试', { status: 502 })
  }
  // Observed, quote-verified investigation evidence is data for the model; it
  // is never a decision and never overrides the user's confirmation (INT-16).
  if (Array.isArray(investigations) && investigations.length > 0) {
    messages = [...messages, { role: 'user', content: [{ type: 'text', text: buildEvidenceNote(investigations) }] }]
  }

  const model = { provider: selection.provider, model: selection.model }
  const inputRevision = session.input?.inputRevision
  let runId = newRunId()
  activeRuns.set(session.sessionId, runId)

  try {
    const firstOutput = await streamOutput({ stream, selection, messages })
    let fresh = await assertRunCurrent({ root, sessionId: session.sessionId, inputRevision, runId })
    let contextUsed = context ?? fresh.context

    let normalized
    try {
      normalized = await normalizeModelOutput({ output: firstOutput, session: fresh, context: contextUsed })
    } catch (error) {
      // Exactly one repair retry: hand the validation error and the truncated
      // bad answer back to the model. Both attempts land in runs[]; the session
      // stays editable either way and a newer run still wins (no overwrite).
      await recordFailedAttempt({
        root,
        session: fresh,
        model,
        runId,
        inputRevision,
        errorCode: 'ai-invalid-output',
        now,
      })
      const retryRunId = newRunId()
      runId = retryRunId
      activeRuns.set(session.sessionId, retryRunId)
      const repairMessages = buildRepairMessages(messages, firstOutput, error)
      let retryOutput
      try {
        retryOutput = await streamOutput({ stream, selection, messages: repairMessages })
      } catch (streamError) {
        await recordFailedAttempt({
          root,
          session: fresh,
          model,
          runId: retryRunId,
          inputRevision,
          errorCode: typeof streamError?.code === 'string' ? streamError.code : 'ai-call-failed',
          now,
        })
        throw streamError
      }
      fresh = await assertRunCurrent({ root, sessionId: session.sessionId, inputRevision, runId: retryRunId })
      contextUsed = context ?? fresh.context
      try {
        normalized = await normalizeModelOutput({ output: retryOutput, session: fresh, context: contextUsed })
      } catch (secondError) {
        await recordFailedAttempt({
          root,
          session: fresh,
          model,
          runId: retryRunId,
          inputRevision,
          errorCode: 'ai-invalid-output',
          now,
        })
        const second = isPlainObject(secondError?.details) ? secondError.details : {}
        throw new IntentHttpError('ai-invalid-output', 'AI 返回内容不符合意图契约（已自动重试一次），可重试或手动填写候选', {
          status: 502,
          details: {
            code: typeof second.code === 'string' ? second.code : 'invalid-analysis',
            fields: Array.isArray(second.fields) ? second.fields : [],
            attempts: 2,
            rawExcerpt: truncated(String(retryOutput ?? ''), 4_000),
          },
        })
      }
    }

    const analysis = isPlainObject(normalized?.analysis) ? normalized.analysis : normalized
    const warnings = Array.isArray(normalized?.warnings) ? normalized.warnings : []
    if (!isPlainObject(analysis)) {
      throw new IntentHttpError('ai-invalid-output', 'AI 返回内容不符合意图契约，可重试或手动填写候选', {
        status: 502,
        details: { code: 'invalid-analysis', fields: [], attempts: 1 },
      })
    }

    // recordAnalysis = runs[] + applyAnalysis + atomic save, and it rejects a
    // late write whose inputRevision no longer matches (INT-12, restart-safe).
    let applied
    try {
      applied = await core.recordAnalysis({
        root,
        // A failed attempt marked the session with a transient error; a
        // successful retry clears it so the UI never shows a stale failure.
        session: { ...fresh, error: null },
        analysis,
        model,
        runId,
        inputRevision,
        now: now(),
      })
    } catch (error) {
      throw toIntentHttpError(error, 'ai-invalid-output')
    }
    if (!isPlainObject(applied)) applied = fresh
    applied = attachContext(applied, contextUsed)
    applied = await persist(root, applied)

    const readiness = readinessFor(applied, contextUsed)
    const projected = projectSession(applied, readiness)
    return {
      ok: true,
      session: projected,
      investigations: listSessionInvestigations(root, applied.sessionId),
      analysis: {
        analysisRunId: runId,
        contextSnapshotId: applied.context?.contextSnapshotId ?? contextUsed?.contextSnapshotId ?? null,
        state: projected.state ?? applied.state ?? null,
        items: projected.items ?? applied.items ?? [],
        nextQuestion: projected.nextQuestion ?? applied.nextQuestion ?? null,
        readiness,
        warnings,
        model,
      },
      model,
    }
  } finally {
    if (activeRuns.get(session.sessionId) === runId) activeRuns.delete(session.sessionId)
  }
}
async function buildContext({ root, projectId, selectedRequirementId, input }) {
  try {
    const context = await core.buildIntentContext({
      root,
      projectId: projectId ?? undefined,
      selectedRequirementId: selectedRequirementId ?? undefined,
      intentText: input.text,
      extractedText: input.extractedText,
    })
    if (!isPlainObject(context)) throw new IntentHttpError('context-failed', '构建项目上下文失败', { status: 500 })
    return context
  } catch (error) {
    throw toIntentHttpError(error, 'context-failed')
  }
}

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

function normalizeAttachment(value) {
  if (value === undefined || value === null) return null
  assertPlainObject(value, 'input.attachment')
  assertKnownFields(value, ['name', 'size', 'kind'], 'input.attachment')
  const name = requireString(value.name, 'input.attachment.name', { max: 300 })
  const size = value.size === undefined || value.size === null ? 0 : requireInteger(value.size, 'input.attachment.size')
  const kind = value.kind === undefined || value.kind === null ? 'file' : requireString(value.kind, 'input.attachment.kind', { max: 32 })
  return { name, size, kind }
}

/**
 * Material (chat/OCR/attachment text) is analysis data only: it is length-
 * bounded and never interpreted as instructions or control fields (INT-16).
 */
function normalizeInput(value) {
  assertPlainObject(value, 'input')
  assertKnownFields(value, ['text', 'source', 'extractedText', 'attachment'], 'input')
  const text = requireString(value.text, 'input.text', { max: MAX_INPUT_TEXT })
  const source = value.source === undefined || value.source === null ? 'text' : requireEnum(value.source, SOURCES, 'input.source')
  let extractedText = ''
  if (value.extractedText !== undefined && value.extractedText !== null) {
    if (typeof value.extractedText !== 'string') throw invalid('input.extractedText must be a string')
    extractedText = value.extractedText.slice(0, MAX_EXTRACTED_TEXT)
  }
  return { text, source, extractedText, attachment: normalizeAttachment(value.attachment) }
}

function normalizeExplicit(value) {
  if (value === undefined || value === null) return { owner: null, priority: null }
  assertPlainObject(value, 'explicit')
  assertKnownFields(value, ['owner', 'priority'], 'explicit')
  return {
    owner: optionalString(value.owner, 'explicit.owner', 120),
    priority: optionalString(value.priority, 'explicit.priority', 40),
  }
}

function normalizeEditFields(value) {
  assertPlainObject(value, 'fields')
  assertKnownFields(value, EDIT_FIELDS, 'fields')
  const fields = {}
  for (const key of ['route', 'title', 'problem', 'goal', 'owner', 'priority']) {
    if (value[key] === undefined) continue
    if (value[key] === null) {
      fields[key] = null
      continue
    }
    if (key === 'route') fields[key] = requireEnum(value[key], ROUTES, 'fields.route')
    else fields[key] = requireString(value[key], `fields.${key}`, { max: key === 'title' ? 300 : 4_000 })
  }
  for (const key of ['inScope', 'outOfScope']) {
    if (value[key] === undefined) continue
    if (value[key] === null) {
      fields[key] = []
      continue
    }
    if (!Array.isArray(value[key]) || value[key].some((entry) => typeof entry !== 'string')) {
      throw invalid(`fields.${key} must be an array of strings`)
    }
    fields[key] = value[key].slice(0, 100).map((entry) => truncated(entry, 2_000))
  }
  if (value.acceptance !== undefined) {
    if (value.acceptance === null) fields.acceptance = []
    else {
      if (!Array.isArray(value.acceptance)) throw invalid('fields.acceptance must be an array')
      if (value.acceptance.length > 100) throw invalid('fields.acceptance has too many entries')
      fields.acceptance = value.acceptance.map((entry, index) => {
        assertPlainObject(entry, `fields.acceptance[${index}]`)
        const output = {}
        for (const key of ['precondition', 'action', 'expected', 'judgement']) {
          if (entry[key] === undefined || entry[key] === null) continue
          if (typeof entry[key] !== 'string') throw invalid(`fields.acceptance[${index}].${key} must be a string`)
          output[key] = truncated(entry[key], 2_000)
        }
        if (Array.isArray(entry.sourceRefs)) {
          output.sourceRefs = entry.sourceRefs.filter((ref) => typeof ref === 'string').slice(0, 20)
        }
        return output
      })
    }
  }
  if (value.unknownResolutions !== undefined) {
    if (value.unknownResolutions === null) fields.unknownResolutions = []
    else {
      if (!Array.isArray(value.unknownResolutions)) throw invalid('fields.unknownResolutions must be an array')
      if (value.unknownResolutions.length > 100) throw invalid('fields.unknownResolutions has too many entries')
      fields.unknownResolutions = value.unknownResolutions.map((entry, index) => {
        assertPlainObject(entry, `fields.unknownResolutions[${index}]`)
        const output = {
          resolution: requireEnum(entry.resolution, UNKNOWN_RESOLUTIONS, `fields.unknownResolutions[${index}].resolution`),
        }
        for (const key of ['description', 'itemId', 'reason']) {
          if (entry[key] === undefined || entry[key] === null) continue
          if (typeof entry[key] !== 'string') throw invalid(`fields.unknownResolutions[${index}].${key} must be a string`)
          output[key] = truncated(entry[key], 2_000)
        }
        return output
      })
    }
  }
  return fields
}

function normalizeConfirmationItems(value) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw invalid('confirmation.items must be an array')
  if (value.length > 100) throw invalid('confirmation.items has too many entries')
  return value.map((entry, index) => {
    assertPlainObject(entry, `confirmation.items[${index}]`)
    const item = { itemId: requireString(entry.itemId, `confirmation.items[${index}].itemId`, { max: 200 }) }
    if (entry.route !== undefined && entry.route !== null) item.route = requireEnum(entry.route, ROUTES, `confirmation.items[${index}].route`)
    if (entry.candidate !== undefined && entry.candidate !== null) {
      assertPlainObject(entry.candidate, `confirmation.items[${index}].candidate`)
      item.candidate = entry.candidate
    }
    if (entry.unknowns !== undefined && entry.unknowns !== null) {
      if (!Array.isArray(entry.unknowns)) throw invalid(`confirmation.items[${index}].unknowns must be an array`)
      item.unknowns = entry.unknowns
    }
    // A human may point a change at a requirement baseline. Core resolves the
    // authoritative revision/contentHash from the fresh context; the pointer is
    // all we forward, so a stale or forged base can never become the base.
    if (entry.base !== undefined && entry.base !== null) {
      assertPlainObject(entry.base, `confirmation.items[${index}].base`)
      const base = {}
      for (const key of ['uid', 'revision', 'contentHash']) {
        if (entry.base[key] === undefined || entry.base[key] === null) continue
        if (key === 'revision') {
          base.revision = requireInteger(entry.base.revision, `confirmation.items[${index}].base.revision`)
        } else {
          base[key] = requireString(entry.base[key], `confirmation.items[${index}].base.${key}`, 200)
        }
      }
      if (!base.uid) throw invalid(`confirmation.items[${index}].base.uid is required when base is present`)
      item.base = base
    }
    return item
  })
}

function normalizeConfirmation(value) {
  assertPlainObject(value, 'confirmation')
  // Must stay in sync with core normalizeConfirmation (packages/alm-core/src/
  // intent/confirm.mjs): answer/investigate/decline routes need answer/question/
  // reason/alternative, and a client may echo its own expected revision.
  assertKnownFields(
    value,
    [
      'contentHash',
      'route',
      'items',
      'owner',
      'priority',
      'reason',
      'alternative',
      'answer',
      'question',
      'expectedInputRevision',
      'contextSnapshotId',
    ],
    'confirmation',
  )
  return {
    // contentHash may be null: the core recomputes the authoritative digest.
    contentHash: optionalString(value.contentHash, 'confirmation.contentHash', 200),
    // Clients echo the read-set they reviewed; core re-checks it (confirm.mjs
    // reads confirmation.contextSnapshotId), the handler also verifies the
    // envelope-level id before calling in.
    contextSnapshotId: optionalString(value.contextSnapshotId, 'confirmation.contextSnapshotId', 120),
    route: value.route === undefined || value.route === null ? null : requireEnum(value.route, ROUTES, 'confirmation.route'),
    items: normalizeConfirmationItems(value.items),
    owner: optionalString(value.owner, 'confirmation.owner', 120),
    priority: optionalString(value.priority, 'confirmation.priority', 40),
    reason: optionalString(value.reason, 'confirmation.reason', 1000),
    alternative: optionalString(value.alternative, 'confirmation.alternative', 1000),
    answer: optionalString(value.answer, 'confirmation.answer', 4000),
    question: optionalString(value.question, 'confirmation.question', 1000),
    expectedInputRevision:
      value.expectedInputRevision === undefined || value.expectedInputRevision === null
        ? null
        : requireInteger(value.expectedInputRevision, 'confirmation.expectedInputRevision'),
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function handleAnalyze({ root, body, resolveAiSelection, aiStreamFor, now }) {
  const input = normalizeInput(body.input)
  const explicit = normalizeExplicit(body.explicit)
  const projectId = optionalString(body.projectId, 'projectId', 200)
  const selectedRequirementId = optionalString(body.selectedRequirementId, 'selectedRequirementId', 200)
  const actor = optionalString(body.actor, 'actor', 200) ?? 'human:local'

  let session = null
  if (body.sessionId !== undefined && body.sessionId !== null) {
    session = await requireSession(root, body.sessionId)
    if (session.state === 'committed') throw alreadyCommitted()
    if (projectId && session.project?.id && session.project.id !== projectId) {
      throw invalid('projectId 与既有会话不一致，切换项目请新建会话')
    }
  }

  // Build the read-set before creating the session: the snapshot carries the
  // resolved project id (`.alm/project.json` when the body omits projectId).
  const context = await buildContext({
    root,
    projectId: projectId ?? session?.project?.id ?? null,
    selectedRequirementId,
    input,
  })

  // Evidence may only be attached to an existing session of this repo; a new
  // session has nothing to reference and would be a cross-session smuggling
  // attempt (INT-16).
  let investigations = []
  if (body.investigationIds !== undefined && body.investigationIds !== null) {
    if (!session) {
      throw new IntentHttpError('invalid-investigation', 'investigationIds 需要一个已存在的会话', { status: 422 })
    }
    investigations = await normalizeInvestigationIds({ root, session, value: body.investigationIds })
  }

  if (session) {
    session = await core.setInput({
      root,
      session,
      input: inputForCore(input, explicit),
      now: now(),
    })
  } else {
    const resolvedProjectId = projectId ?? context?.projectId ?? null
    if (!resolvedProjectId) {
      throw new IntentHttpError('unknown-project', '未找到项目：请传 projectId 或先初始化 .alm/project.json', {
        status: 404,
      })
    }
    session = await core.createSession({
      root,
      project: { id: resolvedProjectId },
      actor,
      input: inputForCore(input, explicit),
      now: now(),
    })
  }
  if (!isPlainObject(session)) {
    throw new IntentHttpError('internal-error', '会话创建失败', { status: 500 })
  }

  session = attachContext(session, context)
  session = await persist(root, session)

  try {
    return await runAnalysis({ root, session, context, body, resolveAiSelection, aiStreamFor, now, investigations })
  } catch (error) {
    // Contract §2: model failures keep the editable session alive (503 carries
    // manualFallback+session). Seed the manual stub before projecting so a
    // human can fill the candidate and still confirm without a model.
    if (error instanceof IntentHttpError && (error.status === 502 || error.status === 503)) {
      // Reload first: runAnalysis may already have persisted failed runs on
      // disk, and the in-memory snapshot predates them (persisting it would
      // silently drop the retry/attempt bookkeeping).
      let next = session
      try {
        next = await requireSession(root, session.sessionId)
      } catch {
        next = session
      }
      const hasItem = (next.items ?? []).some((item) => item && item.excluded !== true)
      if (!hasItem) {
        next = ensureManualStub(next)
        next = await persist(root, next)
      }
      error.session = projectSession(next, readinessFor(next, next.context))
    }
    throw error
  }
}

async function handleInvestigate({ root, body, resolveAiSelection, aiStreamFor, now }) {
  const session = await requireSession(root, body.sessionId)
  if (session.state === 'committed') throw alreadyCommitted()

  if (body.expectedInputRevision !== undefined && body.expectedInputRevision !== null) {
    if (!Number.isInteger(body.expectedInputRevision)) throw invalid('expectedInputRevision must be an integer')
    if (body.expectedInputRevision !== session.input?.inputRevision) throw staleInput(session)
  }

  const explicitQuestion = optionalString(body.question, 'question', 2000)
  // `questionId` is accepted for UI symmetry with `answer`; the investigation
  // itself is question-text based, so it only needs to be a valid identifier.
  optionalString(body.questionId, 'questionId', 200)
  const question = explicitQuestion ?? questionForInvestigation(session)
  if (!question) {
    throw new IntentHttpError('no-question', '没有可调查的问题：请先分析生成澄清问题，或直接传入 question', {
      status: 422,
    })
  }
  const focus = normalizeInvestigationFocus(body.focus)

  const { selection, stream } = await selectModel({ body, resolveAiSelection, aiStreamFor, session })
  let result
  try {
    result = await runInvestigation({
      aiStream: stream,
      provider: selection.provider,
      model: selection.model,
      root,
      session,
      question,
      focus,
    })
  } catch (error) {
    throw investigationHttpError(error, session)
  }

  const readiness = readinessFor(session, session.context)
  return {
    ok: true,
    investigation: result.investigation,
    session: projectSession(session, readiness),
    investigations: listSessionInvestigations(root, session.sessionId),
  }
}

async function handleAnswer({ root, body, resolveAiSelection, aiStreamFor, now }) {
  const session = await requireSession(root, body.sessionId)
  if (session.state === 'committed') throw alreadyCommitted()
  const expected = requireInteger(body.expectedInputRevision, 'expectedInputRevision')
  if (session.input?.inputRevision !== expected) throw staleInput(session)
  const questionId = requireString(body.questionId, 'questionId', 200)
  const question = session.nextQuestion
  if (!isPlainObject(question) || question.questionId !== questionId) {
    throw invalid('questionId 不是当前待回答的问题，请先重新加载会话')
  }
  const optionId = body.optionId === undefined || body.optionId === null ? null : requireString(body.optionId, 'optionId', 200)
  const options = Array.isArray(question.options) ? question.options : []
  if (optionId !== null && !options.some((option) => option?.id === optionId)) {
    throw invalid('optionId 不在当前问题的选项中')
  }
  const text = body.text === undefined || body.text === null ? '' : requireString(body.text, 'text', { max: MAX_FREE_TEXT, min: 0 })
  if (optionId === null && text.trim() === '') throw invalid('optionId 与 text 至少提供一个')

  let next = await core.recordAnswer({
    root,
    session,
    answer: { questionId, optionId, text: text.trim() },
    now: now(),
  })
  if (!isPlainObject(next)) next = session
  // Answering is an acknowledgement: persist the answer and return immediately,
  // then re-run the analysis in the background. Model latency must not hold the
  // submit request (the UI polls `load` while `analysisStatus.status==='running'`).
  const runId = newRunId()
  const readiness = readinessFor(next, next.context)
  const projected = projectSession(next, readiness)
  backgroundRuns.set(next.sessionId, {
    runId,
    status: 'running',
    startedAt: new Date(now()).toISOString(),
    inputRevision: next.input?.inputRevision ?? null,
  })
  void runAnalysis({ root, session: next, context: next.context ?? null, body, resolveAiSelection, aiStreamFor, now })
    .then((result) => {
      const current = backgroundRuns.get(next.sessionId)
      if (!current || current.runId !== runId) return
      backgroundRuns.set(next.sessionId, {
        ...current,
        status: 'done',
        finishedAt: new Date().toISOString(),
        session: result?.session ?? null,
        readiness: result?.readiness ?? null,
      })
    })
    .catch((error) => {
      const current = backgroundRuns.get(next.sessionId)
      if (!current || current.runId !== runId) return
      backgroundRuns.set(next.sessionId, {
        ...current,
        status: 'error',
        finishedAt: new Date().toISOString(),
        error: {
          code: error?.code ?? error?.details?.code ?? 'ai-call-failed',
          message: error?.message ?? String(error),
        },
        session: isPlainObject(error?.session) ? error.session : null,
      })
    })
  return {
    ok: true,
    session: projected,
    readiness,
    pending: true,
    analysisStatus: backgroundRuns.get(next.sessionId),
  }
}

async function handleEdit({ root, body, now }) {
  const session = await requireSession(root, body.sessionId)
  if (session.state === 'committed') throw alreadyCommitted()
  const expected = requireInteger(body.expectedInputRevision, 'expectedInputRevision')
  if (session.input?.inputRevision !== expected) throw staleInput(session)
  const fields = normalizeEditFields(body.fields)
  if (Object.keys(fields).length === 0) throw invalid('fields 至少包含一个可人工编辑的字段')
  const requestedItemId = optionalString(body.itemId, 'itemId', 200)
  const firstItem = (session.items ?? []).find((item) => item && item.excluded !== true) ?? null

  // Human edits are stored per item (`route` -> recommendedRoute, the rest ->
  // `candidate.*`); owner/priority are session-level explicit inputs, never AI
  // suggestions, so they land on `input.explicit` instead.
  const edits = []
  const explicitPatch = {}
  let unknownResolutions = null
  for (const [key, value] of Object.entries(fields)) {
    if (key === 'unknownResolutions') {
      unknownResolutions = value
      continue
    }
    if (key === 'owner' || key === 'priority') {
      explicitPatch[key] = value
      continue
    }
    edits.push({ field: key === 'route' ? 'recommendedRoute' : `candidate.${key}`, value })
  }

  let next = session
  if (edits.length > 0) {
    // A no-model session starts with no items; seed a human stub so manual
    // candidate entry is possible before the first successful analysis.
    if (!requestedItemId && !firstItem) next = ensureManualStub(next)
    const itemId =
      requestedItemId ?? (next.items ?? []).find((item) => item && item.excluded !== true)?.itemId ?? null
    if (!itemId) throw invalid('会话尚无条目可编辑，请先执行 analyze')
    next = await core.setEdits({
      root,
      session: next,
      edits: edits.map((edit) => ({ ...edit, itemId })),
      now: now(),
    })
    if (!isPlainObject(next)) next = session
  }
  if (Object.keys(explicitPatch).length > 0) {
    next = {
      ...next,
      input: { ...next.input, explicit: { ...(next.input?.explicit ?? {}), ...explicitPatch } },
    }
  }
  if (unknownResolutions) {
    next = applyUnknownResolutions(next, unknownResolutions, requestedItemId, now())
  }
  next = await persist(root, next)
  const readiness = readinessFor(next, next.context)
  return { ok: true, session: projectSession(next, readiness), readiness }
}

async function handleConfirm({ root, body, now }) {
  const session = await requireSession(root, body.sessionId)
  const expected = requireInteger(body.expectedInputRevision, 'expectedInputRevision')
  if (session.input?.inputRevision !== expected) throw staleInput(session)
  const contextSnapshotId = requireString(body.contextSnapshotId, 'contextSnapshotId', 200)
  if (session.context?.contextSnapshotId !== contextSnapshotId) throw staleContext(session)
  const idempotencyKey = requireString(body.idempotencyKey, 'idempotencyKey', { min: 8, max: 200 })
  const confirmation = normalizeConfirmation(body.confirmation)
  const actor = optionalString(body.actor, 'actor', 200) ?? 'human:local'

  let result
  try {
    result = await core.confirmIntent({
      root,
      sessionId: session.sessionId,
      confirmation: { ...confirmation, expectedInputRevision: expected, contextSnapshotId },
      actor,
      idempotencyKey,
      now: now(),
    })
  } catch (error) {
    throw toIntentHttpError(error, 'write-failed')
  }
  return {
    ok: true,
    receipt: isPlainObject(result?.receipt) ? result.receipt : null,
    replayed: result?.replayed === true,
    artifacts: Array.isArray(result?.artifacts) ? result.artifacts : [],
  }
}

async function handleCancel({ root, body, now }) {
  const session = await requireSession(root, body.sessionId)
  let next
  try {
    next = await core.cancelSession({ root, session, reason: null, now: now() })
  } catch (error) {
    throw toIntentHttpError(error, 'invalid-request')
  }
  if (!isPlainObject(next)) {
    throw new IntentHttpError('internal-error', '取消会话失败', { status: 500 })
  }
  return { ok: true, session: projectSession(next, readinessFor(next, next.context)) }
}

async function handleMigrate({ root, now }) {
  const result = await core.migrateIntentStore({ root, now: now() })
  return { ok: true, ...(isPlainObject(result) ? result : {}) }
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

/**
 * POST /api/alm/requirements/intent
 * Contract §2: `{action, root?, ...}` -> `{ok:true, ...}` or an error response.
 */
export async function handleIntentRequest({
  root,
  body,
  resolveAiSelection,
  aiStreamFor,
  now = defaultNow,
} = {}) {
  if (typeof root !== 'string' || root === '') throw invalid('root is required')
  assertPlainObject(body, 'body')
  const action = body.action
  if (typeof action !== 'string' || action === '') throw invalid('action is required')
  const allowed = Object.prototype.hasOwnProperty.call(ACTION_KEYS, action) ? ACTION_KEYS[action] : null
  if (!allowed) throw new IntentHttpError('unknown-action', `未知的 action：${truncated(action, 64)}`, { status: 400 })
  assertKnownFields(body, allowed, 'body')

  switch (action) {
    case 'analyze':
      return handleAnalyze({ root, body, resolveAiSelection, aiStreamFor, now })
    case 'answer':
      return handleAnswer({ root, body, resolveAiSelection, aiStreamFor, now })
    case 'edit':
      return handleEdit({ root, body, now })
    case 'investigate':
      return handleInvestigate({ root, body, resolveAiSelection, aiStreamFor, now })
    case 'confirm':
      return handleConfirm({ root, body, now })
    case 'cancel':
      return handleCancel({ root, body, now })
    case 'migrate':
      return handleMigrate({ root, now })
    case 'load': {
      const sessionId = typeof body.session === 'string' ? body.session : body.sessionId
      const session = await requireSession(root, sessionId)
      const readiness = readinessFor(session, session.context)
      return withAnalysisStatus(
        {
          ok: true,
          session: projectSession(session, readiness),
          readiness,
          investigations: listSessionInvestigations(root, session.sessionId),
        },
        session.sessionId,
      )
    }
    default:
      // Unreachable: ACTION_KEYS and this switch are kept in sync.
      throw new IntentHttpError('unknown-action', `未知的 action：${truncated(action, 64)}`, { status: 400 })
  }
}

/** GET /api/alm/requirements/intent?session=<id>[&root=...] */
export async function handleIntentLoad({ root, query } = {}) {
  if (typeof root !== 'string' || root === '') throw invalid('root is required')
  const params = query instanceof URLSearchParams ? query : new URLSearchParams(query ?? {})
  const sessionId = params.get('session') ?? params.get('sessionId')
  if (sessionId === null || sessionId.trim() === '') throw invalid('session 查询参数必填')
  const session = await requireSession(root, sessionId.trim())
  const readiness = readinessFor(session, session.context)
  return withAnalysisStatus(
    {
      ok: true,
      session: projectSession(session, readiness),
      readiness,
      investigations: listSessionInvestigations(root, session.sessionId),
    },
    session.sessionId,
  )
}
