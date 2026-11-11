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
import { createHash, randomBytes } from 'node:crypto'
import { lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, rmdirSync, writeFileSync } from 'node:fs'
import { homedir, hostname } from 'node:os'
import { join } from 'node:path'
import * as core from '../alm-core/src/intent/index.mjs'
import { createRequirement } from '../alm-core/src/requirements/create.mjs'
import { normalizeDoc } from '../alm-core/src/requirements/doc.mjs'
import { crystallizeChatDraft } from './intake.mjs'
import { matchRequirement } from '../alm-core/src/requirements/matcher.mjs'
// Draft mutations (contract §§2.3/4) are re-exported through the core entrypoint
// once the T3 slice lands; until then the transport falls back to the module
// that owns them so the HTTP channel is testable in isolation.
import {
  InvestigationError,
  buildEvidenceNote,
  listInvestigations,
  readInvestigation,
  revalidateInvestigation,
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

// `grill-me` is a small Matt Pocock wrapper which delegates to `grilling`.
// The latter contains the actual decision-tree instructions.  DSH exposes
// user skills as files rather than a plugin RPC, so this is the trusted local
// bridge: load the installed instruction, then give it to the selected host
// model for this clarification round.
const GRILL_SKILL_MAX_BYTES = 32 * 1024
function loadGrillSkill(root) {
  const roots = [
    { path: join(root, '.agents', 'skills'), source: 'workspace' },
    { path: join(root, '.dsh', 'skills'), source: 'workspace' },
    { path: join(homedir(), '.agents', 'skills'), source: 'user' },
  ]
  const readSkill = (name, pattern) => {
    for (const candidate of roots) {
      const path = join(candidate.path, name, 'SKILL.md')
      try {
        const stat = lstatSync(path)
        if (!stat.isFile() || stat.size <= 0 || stat.size > GRILL_SKILL_MAX_BYTES) continue
        const instructions = readFileSync(path, 'utf8').trim()
        if (!pattern.test(instructions)) continue
        return { instructions, source: candidate.source }
      } catch {}
    }
    return null
  }
  const grilling = readSkill('grilling', /name:\s*grilling\b[\s\S]*Interview the user relentlessly/i)
  // `grill-me` is intentionally read too: it is the Matt-facing entry point
  // and records that the installed wrapper delegated to the loaded engine.
  const wrapper = readSkill('grill-me', /name:\s*grill-me\b[\s\S]*Call the Skill tool with "grilling"/i)
  if (grilling) {
    return { name: 'grilling', instructions: grilling.instructions, source: grilling.source, wrapper: wrapper ? 'grill-me' : null }
  }
  return null
}

function normalizeGrillAnswers(value) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > 3) throw invalid('grillAnswers 必须是最多 3 条的数组')
  return value.map((entry, index) => {
    if (!isPlainObject(entry)) throw invalid(`grillAnswers[${index}] 必须是对象`)
    const question = optionalString(entry.question, `grillAnswers[${index}].question`, 800)
    const answer = optionalString(entry.answer, `grillAnswers[${index}].answer`, 800)
    if (!question || !answer) throw invalid(`grillAnswers[${index}] 缺少问题或回答`)
    return { question, answer }
  })
}

function grillState(skill, previous, answers = []) {
  if (!skill) return { status: 'local', name: null, source: null, wrapper: null, round: previous?.round ?? 0, answers: previous?.answers ?? [] }
  const history = [...(Array.isArray(previous?.answers) ? previous.answers : []), ...answers].slice(-12)
  return { status: 'loaded', name: skill.name, source: skill.source, wrapper: skill.wrapper ?? null, round: Math.max(1, Number(previous?.round ?? 0) + (answers.length ? 1 : 0)), answers: history }
}

function grillPrompt(skill, state) {
  if (!skill) return null
  const answered = state?.answers?.length
    ? `\n本轮已经获得的用户回答（作为已定决策，不要重复追问）：\n${state.answers.map((entry, index) => `${index + 1}. ${entry.question}\n回答：${entry.answer}`).join('\n')}`
    : ''
  return [
    '以下是本机已安装并已加载的 Grill Skill 原文。严格用它的决策树与 frontier 原则分析当前需求；仅提出当前已具备前提的 2 至 3 个问题，问题和选项必须针对用户的实际业务语句。',
    '本服务需要机器可校验的 intent-review JSON，不能直接输出 Markdown 问答。请把 Grill 的结果落实到现有 JSON 契约中的标题、候选项、验收条件和 nextQuestion/questionGroup；不得编造已确认事实。',
    '--- Grill Skill 原文 ---',
    skill.instructions,
    '--- 结束 Grill Skill 原文 ---',
    answered,
  ].filter(Boolean).join('\n')
}

/** Every HTTP error code in contract §2 mapped to its status. */
const STATUS_BY_CODE = {
  'invalid-request': 400,
  'unknown-action': 400,
  'invalid-json': 400,
  'body-too-large': 413,
  'unknown-session': 404,
  'unknown-project': 404,
  'stale-input': 409,
  'stale-session': 409,
  'intent-busy': 409,
  'draft-changed': 409,
  'analysis-pending': 409,
  'stale-context': 409,
  'idempotency-conflict': 409,
  'already-committed': 409,
  'not-ready': 422,
  'unresolved-source': 422,
  'missing-acceptance': 422,
  'invalid-change-base': 422,
  'no-question': 422,
  'answer-not-in-group': 422,
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
  crystallize: ['action', 'root', 'summary', 'messages', 'draft', 'investigationIds', 'focus', 'projectId', 'owner', 'priority', 'provider', 'model', 'apply', 'draftHash', 'sourceSession'],
  analyze: ['action', 'root', 'input', 'explicit', 'projectId', 'selectedRequirementId', 'sessionId', 'provider', 'model', 'actor', 'investigationIds', 'grillAnswers', 'retryExisting', 'expectedSessionRevision'],
  answer: [
    'action',
    'root',
    'sessionId',
    'expectedInputRevision',
    'expectedSessionRevision',
    'questionId',
    'optionId',
    'text',
    'answers',
    'actor',
  ],
  edit: ['action', 'root', 'sessionId', 'expectedInputRevision', 'expectedSessionRevision', 'itemId', 'fields', 'actor'],
  investigate: ['action', 'root', 'sessionId', 'questionId', 'question', 'focus', 'expectedInputRevision', 'provider', 'model', 'actor'],
  'adopt-investigation': ['action', 'root', 'sessionId', 'expectedInputRevision', 'expectedSessionRevision', 'itemId', 'unknownDescription', 'investigationId', 'actor'],
  confirm: ['action', 'root', 'sessionId', 'expectedInputRevision', 'expectedSessionRevision', 'docHash', 'draftRevision', 'contextSnapshotId', 'confirmation', 'idempotencyKey', 'actor'],
  'set-doc-draft': ['action', 'root', 'sessionId', 'expectedSessionRevision', 'expectedDraftRevision', 'docDraft', 'actor'],
  'lock-clauses': ['action', 'root', 'sessionId', 'expectedSessionRevision', 'clauses', 'actor'],
  'unlock-clauses': ['action', 'root', 'sessionId', 'expectedSessionRevision', 'clauses', 'actor'],
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
// Session-revision CAS (contract §3.2): a decision state moved under the client.
const staleSession = (session, extra = {}) =>
  new IntentHttpError('stale-session', '会话已变化，请重新加载后再提交', {
    status: 409,
    details: {
      sessionRevision: Number.isInteger(session?.sessionRevision) ? session.sessionRevision : null,
      ...extra,
    },
  })
const staleContext = (session) =>
  new IntentHttpError('stale-context', '项目上下文已变化，请重新分析后再确认', {
    status: 409,
    details: { contextSnapshotId: session?.context?.contextSnapshotId ?? null },
  })
const alreadyCommitted = () => new IntentHttpError('already-committed', '会话已经确认保存，不能再修改', { status: 409 })
// Contract §5: the confirmation must bind the exact draft the user saw.
const draftChanged = (session, extra = {}) =>
  new IntentHttpError('draft-changed', '需求正文草稿已更新；请核对最新草稿后再确认', {
    status: 409,
    details: {
      latest: draftLatest(session),
      diff: null,
      ...extra,
    },
  })
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
  for (const key of ['field', 'fields', 'code', 'expectedInputRevision', 'inputRevision', 'sessionRevision', 'expectedSessionRevision', 'draftRevision', 'expectedDraftRevision', 'docHash', 'latest', 'expected', 'diff', 'questionId', 'decisionId', 'contextSnapshotId', 'sessionId', 'itemId', 'analysisRunId', 'appliedArtifacts', 'rawExcerpt', 'attempts']) {
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
    // Draft CAS (contract §5): `latest` carries the server's current draft so
    // the UI can re-render it; `diff` is only honest when a before-snapshot
    // exists, so a null diff is echoed as null instead of being dropped.
    if (key === 'latest') {
      const latest = sanitizeDraftLatest(value)
      if (latest) out.latest = latest
      continue
    }
    if (key === 'expected') {
      const expected = sanitizeDraftExpected(value)
      if (expected) out.expected = expected
      continue
    }
    if (key === 'diff') {
      out.diff = value === null ? null : sanitizeDraftDiff(value)
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

/** `details.latest` for `draft-changed`: the server's current draft binding. */
function sanitizeDraftLatest(value) {
  if (!isPlainObject(value)) return undefined
  const latest = {
    docDraft: isPlainObject(value.docDraft) ? value.docDraft : null,
    docHash: typeof value.docHash === 'string' ? truncated(value.docHash, 200) : null,
    draftRevision: Number.isInteger(value.draftRevision) ? value.draftRevision : 0,
  }
  return latest
}

function sanitizeDraftExpected(value) {
  if (!isPlainObject(value)) return undefined
  const expected = {}
  if (typeof value.docHash === 'string') expected.docHash = truncated(value.docHash, 200)
  if (value.draftRevision === null || Number.isInteger(value.draftRevision)) {
    expected.draftRevision = value.draftRevision
  }
  return Object.keys(expected).length ? expected : undefined
}

/** Optional structural diff; null means "no before-snapshot to compare against". */
function sanitizeDraftDiff(value) {
  if (!isPlainObject(value)) return undefined
  const out = {}
  for (const key of ['added', 'removed', 'modified']) {
    const list = value[key]
    if (!Array.isArray(list)) continue
    out[key] = list.slice(0, 50).map((entry) => {
      if (isPlainObject(entry)) {
        const item = { kind: typeof entry.kind === 'string' ? truncated(entry.kind, 40) : 'clause' }
        if (typeof entry.id === 'string') item.id = truncated(entry.id, 40)
        if (typeof entry.action === 'string') item.action = truncated(entry.action, 40)
        if (typeof entry.text === 'string') item.text = truncated(entry.text, 200)
        return item
      }
      return truncated(String(entry), 200)
    })
  }
  if (Number.isInteger(value.pending)) out.pending = value.pending
  if (value.docHashChanged === true || value.docHashChanged === false) out.docHashChanged = value.docHashChanged
  return Object.keys(out).length ? out : undefined
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

// Serialize read-modify-write operations for one intent across host processes.
// The caller still supplies expectedSessionRevision; the lock closes the gap
// between loading that revision and persisting the mutation.
async function withIntentSessionLock(root, sessionId, operation) {
  assertSessionId(sessionId)
  assertHistoryStorage(root)
  const lockRoot = join(root, '.alm', 'intents', 'locks')
  mkdirSync(lockRoot, { recursive: true })
  if (lstatSync(lockRoot).isSymbolicLink()) throw new IntentHttpError('outside-root', '意图锁目录不能通过链接越过 workspace', { status: 403 })
  const lock = join(lockRoot, `${sessionId}.lock`)
  const ownerFile = join(lock, 'owner.json')
  const reclaimLock = join(lockRoot, `${sessionId}.reclaim.lock`)
  const isAlive = (pid) => {
    if (!Number.isSafeInteger(pid) || pid <= 0) return true
    try {
      process.kill(pid, 0)
      return true
    } catch (error) {
      // EPERM means the process exists but is not probeable; only ESRCH is a
      // positive stale-lock signal. Unknown errors stay conservative.
      return error?.code !== 'ESRCH'
    }
  }
  const acquireReclaimLock = () => {
    try {
      mkdirSync(reclaimLock)
      try {
        writeFileSync(join(reclaimLock, 'owner.json'), JSON.stringify({ pid: process.pid, hostname: hostname(), startedAt: new Date().toISOString() }), 'utf8')
      } catch (error) {
        try { rmSync(reclaimLock, { recursive: true, force: true }) } catch {}
        throw error
      }
      return true
    } catch { return false }
  }
  const reclaimExitedOwner = () => {
    if (!acquireReclaimLock()) return false
    try {
      let owner
      try {
        if (lstatSync(lock).isSymbolicLink()) return false
        owner = JSON.parse(readFileSync(ownerFile, 'utf8'))
      } catch {
        return false
      }
      if (owner?.hostname !== hostname() || isAlive(owner?.pid)) return false
      try {
        return rmSync(lock, { recursive: true, force: true }) === undefined
      } catch {
        return false
      }
    } finally {
      try { rmSync(reclaimLock, { recursive: true, force: true }) } catch {}
    }
  }
  const deadline = Date.now() + 1000
  while (true) {
    try {
      mkdirSync(lock)
      try {
        writeFileSync(ownerFile, JSON.stringify({ pid: process.pid, hostname: hostname(), startedAt: new Date().toISOString() }), 'utf8')
      } catch (error) {
        try { rmSync(lock, { recursive: true, force: true }) } catch {}
        throw error
      }
      break
    } catch (error) {
      const pendingRemoval = process.platform === 'win32' && error.code === 'EPERM'
      if (error.code !== 'EEXIST' && !pendingRemoval) throw error
      if (error.code === 'EEXIST' && reclaimExitedOwner()) continue
      if (Date.now() >= deadline) throw new IntentHttpError('intent-busy', '该意图正被其他窗口修改，请稍后重试', { status: 409 })
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  }
  try { return await operation() } finally {
    try { rmSync(lock, { recursive: true, force: true }) } catch { try { rmdirSync(lock) } catch {} }
  }
}

async function persist(root, session) {
  if (!isPlainObject(session)) throw new IntentHttpError('internal-error', '会话状态无效', { status: 500 })
  const saved = await core.saveSession({ root, session })
  return isPlainObject(saved) ? saved : session
}

/**
 * Write answers through the one core entry point that owns the decision state
 * (contract §3.2). `recordAnswers` is a single atomic CAS write: it validates
 * every answer before persisting, bumps `sessionRevision` once, marks dependent
 * answers stale and reports idempotent replays as `changed:false`.
 *
 * While the core slice is still landing (`recordAnswers` absent) each answer is
 * replayed through the legacy `recordAnswer`; that fallback cannot detect an
 * idempotent replay, so it reports `changed:true` — it exists only so the
 * transport keeps working against an older core.
 */
// ---------------------------------------------------------------------------
// Doc-draft adapters (contract §4: T2b HTTP channel for the requirement draft)
// ---------------------------------------------------------------------------

/** Top-level draft keys a client may patch; everything else is a control field. */
const DOC_DRAFT_PATCH_KEYS = ['goal', 'problem', 'features', 'scope', 'outOfScope', 'acceptance', 'constraints', 'pending']
const LOCK_CLAUSE_KINDS = ['feature', 'acceptance', 'goal', 'scope']

/** Deterministic JSON used only to detect a semantic no-op (idempotent replay). */
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(',')}}`
}

/** The draft binding the UI must echo back to confirm (contract §5). */
function draftLatest(session) {
  const draft = isPlainObject(session?.docDraft) ? session.docDraft : null
  const fromDraft = Number.isInteger(draft?.draftRevision) ? draft.draftRevision : 0
  return {
    docDraft: draft,
    docHash: typeof draft?.docHash === 'string' ? draft.docHash : null,
    draftRevision: Number.isInteger(session?.draftRevision) ? session.draftRevision : fromDraft,
  }
}

function docDraftSummary(session) {
  const { docDraft, docHash, draftRevision } = draftLatest(session)
  return { docDraft, docHash, draftRevision }
}

function normalizeDraftPatch(value) {
  assertPlainObject(value, 'docDraft')
  const patch = {}
  for (const [key, entry] of Object.entries(value)) {
    if (!DOC_DRAFT_PATCH_KEYS.includes(key)) {
      throw invalid(`unknown field: docDraft.${key}`, { field: `docDraft.${key}` })
    }
    patch[key] = entry
  }
  return patch
}

/**
 * Report which draft clauses a patch actually changes. `features`/`acceptance`
 * are diffed by clause id so the UI can show "N 处变化"; arrays without ids fall
 * back to whole-array comparison (the core assigns ids when it normalizes).
 */
function diffDraftPatch(current, patch) {
  const draft = isPlainObject(current) ? current : {}
  const changes = []
  for (const [key, nextValue] of Object.entries(patch)) {
    const before = draft[key]
    if (key === 'features' || key === 'acceptance') {
      const kind = key === 'features' ? 'feature' : 'acceptance'
      const beforeList = Array.isArray(before) ? before : []
      const nextList = Array.isArray(nextValue) ? nextValue : []
      const idsComplete =
        beforeList.every((entry) => isPlainObject(entry) && typeof entry.id === 'string') &&
        nextList.every((entry) => isPlainObject(entry) && typeof entry.id === 'string')
      if (!idsComplete) {
        if (stableStringify(beforeList) !== stableStringify(nextList)) changes.push({ kind })
        continue
      }
      const beforeById = new Map(beforeList.map((entry) => [entry.id, entry]))
      for (const entry of nextList) {
        const previous = beforeById.get(entry.id)
        if (!previous) {
          changes.push({ kind, id: entry.id, action: 'added' })
          continue
        }
        beforeById.delete(entry.id)
        if (stableStringify(previous) !== stableStringify(entry)) {
          changes.push({ kind, id: entry.id, action: 'modified' })
        }
      }
      for (const id of beforeById.keys()) changes.push({ kind, id, action: 'removed' })
      continue
    }
    if (stableStringify(before ?? null) !== stableStringify(nextValue ?? null)) changes.push({ kind: key })
  }
  return changes
}

function normalizeClauseList(value) {
  if (!Array.isArray(value) || value.length === 0) throw invalid('clauses 至少包含一项')
  if (value.length > 200) throw invalid('clauses 过多 (max 200)')
  const out = []
  const seen = new Set()
  for (const [index, entry] of value.entries()) {
    if (!isPlainObject(entry)) throw invalid(`clauses[${index}] 必须是对象`)
    for (const key of Object.keys(entry)) {
      if (!['kind', 'id'].includes(key)) throw invalid(`unknown field: clauses[${index}].${key}`)
    }
    const kind = requireEnum(entry.kind, LOCK_CLAUSE_KINDS, `clauses[${index}].kind`)
    const id = optionalString(entry.id, `clauses[${index}].id`, 40)
    const dedupeKey = id ? `${kind}:${id}` : kind
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    out.push(id ? { kind, id } : { kind })
  }
  if (out.length === 0) throw invalid('clauses 至少包含一项')
  return out
}

/**
 * Call the core draft mutators through the public core entrypoint (T2 APIs are
 * re-exported by `alm-core/src/intent/index.mjs`).
 */
async function callDraftCore(name, args) {
  const fn = core[name]
  if (typeof fn !== 'function') {
    throw new IntentHttpError('internal-error', `核心暂不支持需求草稿操作：${name}`, { status: 500 })
  }
  try {
    return await fn(args)
  } catch (error) {
    throw toIntentHttpError(error, 'write-failed')
  }
}

function optionalSessionRevision(value, field, session) {
  if (value === undefined || value === null) return null
  const expected = requireInteger(value, field)
  if (Number.isInteger(session?.sessionRevision) && session.sessionRevision !== expected) {
    throw staleSession(session, { expectedSessionRevision: expected, latest: draftLatest(session) })
  }
  return expected
}

async function recordAnswersCore({ root, session, answers, expectedSessionRevision, now }) {
  if (typeof core.recordAnswers === 'function') {
    let result
    try {
      result = await core.recordAnswers({
        root,
        session,
        answers,
        expectedSessionRevision: expectedSessionRevision ?? null,
        now: now(),
      })
    } catch (error) {
      throw toIntentHttpError(error, 'invalid-request')
    }
    const next = isPlainObject(result?.session) ? result.session : isPlainObject(result) ? result : session
    return {
      session: next,
      changed: result?.changed !== false,
      saved: Array.isArray(result?.saved) ? result.saved : [],
      stale: Array.isArray(result?.stale) ? result.stale : [],
      progress: isPlainObject(result?.progress) ? result.progress : null,
    }
  }
  let next = session
  const saved = []
  for (const answer of answers) {
    const before = new Set((Array.isArray(next.answers) ? next.answers : []).map((entry) => entry?.answerId))
    let recorded
    try {
      recorded = await core.recordAnswer({ root, session: next, answer, now: now() })
    } catch (error) {
      throw toIntentHttpError(error, 'invalid-request')
    }
    next = isPlainObject(recorded) ? recorded : next
    const added = (Array.isArray(next.answers) ? next.answers : []).find((entry) => entry && !before.has(entry.answerId))
    saved.push({ questionId: answer.questionId, answerId: added?.answerId ?? null })
  }
  return { session: next, changed: true, saved, stale: [], progress: null }
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
    if (unknown.resolution !== entry.resolution) {
      next.investigationEvidence = (next.investigationEvidence ?? []).filter(record => !(record?.itemIds?.includes(targetId) && record.unknownDescription === unknown.description))
    }
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
    recommendedRoute: 'create',
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
  if (items.some((item) => item && item.excluded !== true)) return { ...session, items: items.map(item => item?.itemId?.startsWith('ITM-MANUAL-') && !item.recommendedRoute ? { ...item, recommendedRoute: 'create' } : item) }
  return { ...session, items: [...items, manualStubItem(session)] }
}

function suggestedLocalDraft(raw, draft, structured) {
  const cleanRaw = raw.replace(/^(?:我希望|希望|我想|请|需要)\s*/, '').trim()
  const conciseTitle = (value) => {
    const normalized = String(value ?? '').replace(/\s+/g, ' ').trim()
    if (normalized.length <= 28) return normalized
    const firstClause = normalized.split(/[。！？；;\n]/)[0]?.trim() || normalized
    const preferred = firstClause.length > 28 ? firstClause.slice(0, 28) : firstClause
    return `${preferred.replace(/[，,、\s]+$/, '')}…`
  }
  const goal = draft.goal || cleanRaw
  // Commas in Chinese conditional clauses carry the rule itself.  Never turn
  // “如果…，就…” into separate acceptance fragments; only sentence/list
  // separators create independent assertions.
  const clauses = cleanRaw.split(/[。；;\n]+/).map(s => s.trim()).filter(Boolean)
  const titleOverride = /(?:如果|当|若).{1,80}(?:就|则).{1,120}/.test(cleanRaw) && /手动修改/.test(cleanRaw) && /(?:自动提炼|AI.*提炼|提炼.*AI)/i.test(cleanRaw)
    ? '长标题自动提炼保留手动修改标题'
    : null
  const context = /^(?:在.+(?:中|时|阶段|过程)|当.+时|针对.+|如果.+)$/.test(clauses[0] ?? '') ? clauses.shift().replace(/^在/, '').replace(/(?:过程中|阶段中|中)$/, '') : ''
  const cleaned = clauses.map(s => s.replace(/^(?:我希望|希望|能够|可以|支持|需要|让用户能够)\s*/, ''))
  const valueGrill = /拷问|grill/i.test(raw) && /需求|价值/.test(raw)
  const descriptive = [context, ...cleaned].filter(Boolean).join('，')
  const title = conciseTitle(draft.title || titleOverride || (valueGrill ? '需求澄清支持拷问 Skills 评估需求价值' : descriptive) || '待澄清需求')
  const inferred = valueGrill ? [
    '在需求澄清阶段支持使用拷问 Skills 对需求进行追问。',
    '通过追问识别需求的业务价值，并向用户展示评估结果。',
    '用户可以补充回答并确认需求的价值与边界。',
  ] : titleOverride
    ? ['当用户手动修改过需求标题后，AI 自动提炼不得覆盖该标题。']
    : cleaned.map(clause => `${context ? `${context}：` : ''}${clause.replace(/[。！？]$/, '')}。`).filter(s => s.length > 4)
  const acceptance = structured
    ? draft.acceptance.map(entry => ({ text: typeof entry === 'string' ? entry : entry.text ?? '', provenance: 'user-stated' }))
    : inferred.slice(0, 3).map(text => ({ text, provenance: titleOverride ? 'user-stated' : 'ai-suggestion' }))
  const problem = draft.problem || (valueGrill
    ? '避免未经价值推敲与边界澄清的模糊需求直接进入开发，减少返工与需求漂移。'
    : titleOverride
      ? '防止用户手动修改后的需求标题被后续 AI 自动提炼逻辑意外覆盖丢失。'
      : `用户原话尚未说明具体影响：${(cleaned[0] || cleanRaw).slice(0, 90)}。`)
  return { title, goal, problem, acceptance }
}

async function localIntentDraft({ root, session, draft, structured, now }) {
  const raw = String(session.input?.text ?? '').trim()
  const { title, goal, problem, acceptance } = suggestedLocalDraft(raw, draft, structured)
  const item = { ...manualStubItem(session), userProblem: problem, desiredOutcome: goal,
    candidate: { title, problem, goal, acceptance: acceptance.map(entry => ({ expected: entry.text, judgement: entry.text })) } }
  const base = { ...session, items: [item], state: 'ready_for_confirmation', error: null, analysisRetryRequired: false, nextQuestion: null }
  const next = await core.setDocDraft({ root, session: base, patch: false, now: now(), docDraft: { title, goal, problem, acceptance, pending: [] } })
  const readiness = readinessFor(next, next.context, null, root)
  return { ok: true, session: projectSession(next, readiness), readiness, localFallback: !structured }
}

async function repairLegacyManual(root, sessionId, now = defaultNow) {
  return withIntentSessionLock(root, sessionId, async () => {
    const session = await requireSession(root, sessionId)
    if (['committed', 'cancelled', 'analyzing'].includes(session.state) || activeRuns.has(sessionId)) return session
    const manual = (session.items ?? []).filter(item => item?.itemId?.startsWith('ITM-MANUAL-'))
    if (!manual.length || (session.docDraft && manual.every(item => item.recommendedRoute))) return session
    const draft = crystallizeChatDraft({ summary: session.input?.text })
    const structured = Boolean(draft.title && draft.goal && draft.problem && draft.acceptance.length)
    const raw = String(session.input?.text ?? '').trim()
    const { title, goal, problem, acceptance } = suggestedLocalDraft(raw, draft, structured)
    const candidate = { title, problem, goal, acceptance: acceptance.map(entry => ({ expected: entry.text, judgement: entry.text })) }
    const items = session.items.map(item => item?.itemId?.startsWith('ITM-MANUAL-') ? { ...item, recommendedRoute: item.recommendedRoute || 'create', sourceRefs: item.sourceRefs?.length ? item.sourceRefs : manualStubItem(session).sourceRefs, candidate: item.candidate ?? candidate } : item)
    const next = { ...session, items }
    if (session.docDraft) return persist(root, { ...next, sessionRevision: session.sessionRevision + 1 })
    return core.setDocDraft({ root, session: next, patch: false, now: now(), docDraft: { title, goal, problem, acceptance, pending: [] } })
  })
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
  // The core renderer deliberately owns the stable intent shape.  Grill is a
  // transport capability/status, so retain this small, non-authoritative view
  // projection without changing core confirmation semantics.
  if (session?.grill) view.grill = session.grill
  return view
}

/** Best-effort readiness; core recomputes the read-set itself at confirm (§4). */
function readinessFor(session, context, completedRunId = null, root = null) {
  try {
    const verifiedEvidence = root ? core.currentInvestigationEvidence(root, session) : []
    const checkedSession = root ? { ...session, investigationEvidence: verifiedEvidence, investigations: [] } : session
    const value = core.evaluateReadiness({ session: checkedSession, contextNow: context ?? session?.context })
    if (!isPlainObject(value)) return null
    const reasons = Array.isArray(value.reasons) ? [...value.reasons] : []
    const analysisStatus = analysisStatusFor(session?.sessionId)
    const activeRun = activeRuns.get(session?.sessionId)
    const statusPending = analysisStatus?.status === 'running' && !(analysisStatus.origin === 'retry' && completedRunId && activeRun === completedRunId)
    if ((statusPending || (activeRun && activeRun !== completedRunId)) && !reasons.some((reason) => reason?.code === 'analysis-pending')) {
      reasons.push({ code: 'analysis-pending', message: '正在分析；完成前不能确认' })
    }
    return {
      ready: value.ready === true && reasons.length === 0,
      reasons,
      warnings: Array.isArray(value.warnings) ? value.warnings : [],
      investigationAdoptions: (Array.isArray(session?.investigationEvidence) ? session.investigationEvidence : []).filter(entry => entry?.adoptedBy && Array.isArray(entry.itemIds) && entry.itemIds.length === 1 && typeof entry.unknownDescription === 'string').map(entry => ({
        investigationId: entry.investigationId ?? null,
        itemId: entry.itemIds[0],
        unknownDescription: entry.unknownDescription,
        inputRevision: entry.inputRevision ?? null,
        adoptedAt: entry.adoptedAt ?? null,
        referencesCurrent: root ? verifiedEvidence.includes(entry) : false,
      })),
    }
  } catch {
    return null
  }
}

/** Server-measured milliseconds since an ISO timestamp; omitted when unknown. */
function elapsedSince(startedAt) {
  const started = typeof startedAt === 'string' ? Date.parse(startedAt) : Number.NaN
  if (!Number.isFinite(started)) return undefined
  const value = Math.round(Date.now() - started)
  return value >= 0 ? value : undefined
}

/**
 * Public, serialisable progress for a background answer re-analysis. `elapsedMs`
 * is computed server-side from `startedAt` (contract §4.3) so the UI never
 * trusts its own clock; `finishedAt` only exists once the run settled.
 */
function analysisStatusFor(sessionId) {
  const entry = backgroundRuns.get(sessionId)
  if (!entry) return null
  const status = {
    runId: entry.runId,
    status: entry.status,
    startedAt: entry.startedAt,
    inputRevision: entry.inputRevision ?? null,
    sessionRevision: entry.sessionRevision ?? null,
    origin: entry.origin ?? 'answer',
  }
  const elapsedMs = elapsedSince(entry.startedAt)
  if (elapsedMs !== undefined) status.elapsedMs = elapsedMs
  if (entry.status === 'done' || entry.status === 'error') {
    if (typeof entry.finishedAt === 'string') status.finishedAt = entry.finishedAt
    if (entry.error) status.error = entry.error
  }
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

/**
 * Collect the model answer; streaming/tool failures become 502 ai-call-failed.
 * `onFirstToken` fires exactly once, on the first content chunk, so callers can
 * measure real time-to-first-token without buffering the stream (contract §4.2).
 */
async function streamOutput({ stream, selection, messages, onFirstToken, signal }) {
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
  let firstTokenSeen = false
  const seen = []
  try {
    for await (const chunk of stream({
      provider: selection.provider,
      model: selection.model,
      ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }),
      system: systemParts.join('\n\n'),
      messages: dialog,
      temperature: 0.2,
      maxTokens: 8000,
      signal,
    })) {
      if (['text-delta', 'reasoning-delta', 'finish', 'usage', 'block-start', 'block-end'].includes(chunk?.type) && seen.length < 8 && !seen.includes(chunk.type)) seen.push(chunk.type)
      if (chunk?.type === 'text-delta') {
        output += chunk.text ?? ''
        if (!firstTokenSeen && typeof chunk.text === 'string' && chunk.text !== '') {
          firstTokenSeen = true
          if (typeof onFirstToken === 'function') onFirstToken()
        }
      }
      if (chunk?.type === 'finish') finishKind = ['stop', 'length', 'tool-calls', 'content-filter', 'error'].includes(chunk.reason?.kind) ? chunk.reason.kind : 'unknown'
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
    if (!Number.isSafeInteger(investigation.inputRevision) || investigation.inputRevision !== session.input?.inputRevision) {
      throw new IntentHttpError('invalid-investigation', `调查不属于当前输入版本：${entry}`, { status: 422 })
    }
    const current = revalidateInvestigation(root, investigation)
    if (!current) {
      throw new IntentHttpError('invalid-investigation', `调查引用已变化或失效：${entry}`, { status: 422 })
    }
    investigations.push(current)
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

/** Reload the session and re-check the late-response guards (INT-12, §3.2). */
async function assertRunCurrent({ root, sessionId, inputRevision, runId, baseSessionRevision }) {
  const fresh = await requireSession(root, sessionId)
  if (fresh.state === 'committed' || fresh.state === 'cancelled') {
    throw staleInput(fresh, { reason: 'session-closed' })
  }
  if (fresh.input?.inputRevision !== inputRevision) throw staleInput(fresh, { inputRevision })
  // The second, decision-state guard: an answer (or a newer analysis) bumped
  // sessionRevision while this run was in flight, so its result is late.
  if (
    Number.isInteger(baseSessionRevision) &&
    Number.isInteger(fresh.sessionRevision) &&
    fresh.sessionRevision !== baseSessionRevision
  ) {
    throw staleSession(fresh, { expectedSessionRevision: baseSessionRevision })
  }
  const latestRun = activeRuns.get(sessionId)
  if (latestRun && latestRun !== runId) {
    throw staleInput(fresh, { analysisRunId: runId, reason: 'newer-run' })
  }
  return fresh
}

/** Best-effort error-run bookkeeping so a repair retry is visible in runs[]. */
async function recordFailedAttempt({
  root,
  session,
  model,
  runId,
  inputRevision,
  baseSessionRevision,
  errorCode,
  timing,
  now,
}) {
  try {
    await withIntentSessionLock(root, session.sessionId, async () => {
      const current = await assertRunCurrent({ root, sessionId: session.sessionId, inputRevision, runId, baseSessionRevision })
      await core.recordAnalysis({
        root,
        session: current,
        analysis: null,
        model,
        runId,
        inputRevision,
        status: 'error',
        errorCode,
        now: now(),
        ...(baseSessionRevision === undefined ? {} : { baseSessionRevision }),
        ...(timing === undefined ? {} : { timing }),
      })
    })
  } catch (error) {
    // Stale input must still surface as 409; a failed bookkeeping write must not
    // block the repair attempt (the success path records the final run anyway).
    if (error?.code === 'stale-input' || error?.code === 'stale-session' || error?.code === 'already-committed') {
      throw toIntentHttpError(error)
    }
  }
}

/**
 * Run the model over the current session snapshot and apply the normalised
 * analysis. Invalid output gets exactly one repair retry. Throws 502 when both
 * attempts are unusable and 409 when the run went stale.
 */
/** Round a measured duration; omit non-finite/negative values (never fake 0). */
function cleanTiming(timing) {
  const out = {}
  for (const key of ['totalMs', 'contextMs', 'modelMs', 'firstTokenMs', 'parseMs', 'persistMs', 'queueMs', 'calls', 'retries']) {
    const value = timing?.[key]
    if (Number.isFinite(value) && value >= 0) out[key] = Math.round(value)
  }
  return Object.keys(out).length ? out : undefined
}

async function runAnalysis({
  root,
  session,
  context,
  body,
  resolveAiSelection,
  aiStreamFor,
  now,
  investigations = [],
  grillSkill = null,
  grill = null,
  timing: timingInput = null,
  baseSessionRevision,
}) {
  if (session.state === 'committed') throw alreadyCommitted()
  const runStartedAt = Date.now()
  // Every duration below is measured on the server from real clock reads; a
  // missing measurement is omitted from the run record rather than written as
  // zero (contract §2.3). contextMs is provided by the caller (handleAnalyze
  // measures buildIntentContext; the answer path reuses the stored context).
  const timing = { calls: 0, retries: 0 }
  if (Number.isFinite(timingInput?.contextMs) && timingInput.contextMs >= 0) timing.contextMs = Math.round(timingInput.contextMs)
  const totalMsSoFar = () => {
    const value = Date.now() - runStartedAt
    return Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined
  }
  const timingSnapshot = (extra = {}) => cleanTiming({ ...timing, ...extra, totalMs: totalMsSoFar() })
  const addParseMs = (startedAt) => {
    const value = Date.now() - startedAt
    if (Number.isFinite(value) && value >= 0) timing.parseMs = (timing.parseMs ?? 0) + Math.round(value)
  }
  const measureParse = async (work) => {
    const startedAt = Date.now()
    try {
      return await work()
    } finally {
      addParseMs(startedAt)
    }
  }
  const { selection, stream } = await selectModel({ body, resolveAiSelection, aiStreamFor, session })
  let messages = core.buildAnalysisMessages({ session, context })
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new IntentHttpError('ai-invalid-output', 'AI 提示构建失败，可重试', { status: 502 })
  }
  const grillInstruction = grillPrompt(grillSkill, grill)
  if (grillInstruction) {
    messages = [...messages, { role: 'user', content: [{ type: 'text', text: grillInstruction }] }]
  }
  // Observed, quote-verified investigation evidence is data for the model; it
  // is never a decision and never overrides the user's confirmation (INT-16).
  if (Array.isArray(investigations) && investigations.length > 0) {
    const checked = investigations.map((entry) => revalidateInvestigation(root, entry))
    if (checked.some((entry) => !entry)) {
      throw new IntentHttpError('invalid-investigation', '调查引用已变化或失效，请重新调查后再试', { status: 422 })
    }
    messages = [...messages, { role: 'user', content: [{ type: 'text', text: buildEvidenceNote(checked) }] }]
  }

  const model = { provider: selection.provider, model: selection.model }
  const inputRevision = session.input?.inputRevision
  let runId = newRunId()
  await withIntentSessionLock(root, session.sessionId, async () => {
    await assertRunCurrent({ root, sessionId: session.sessionId, inputRevision, runId: activeRuns.get(session.sessionId) ?? runId, baseSessionRevision })
    activeRuns.set(session.sessionId, runId)
  })

  // One model call; the first attempt and the repair retry both feed the run's
  // timing. firstTokenMs is the first content chunk of the first stream only.
  const streamOnce = async (messagesToSend) => {
    const streamStartedAt = Date.now()
    timing.calls += 1
    let firstTokenAt = null
    const controller = new AbortController()
    let timeout
    const output = await Promise.race([
      streamOutput({ stream, selection, messages: messagesToSend, signal: controller.signal, onFirstToken: () => { if (firstTokenAt === null) firstTokenAt = Date.now() } }),
      new Promise((_, reject) => { timeout = setTimeout(() => { controller.abort(); reject(new IntentHttpError('ai-call-failed', 'AI 调用超时', { status: 502 })) }, 8000) }),
    ]).finally(() => clearTimeout(timeout))
    const modelMs = Date.now() - streamStartedAt
    if (Number.isFinite(modelMs) && modelMs >= 0) timing.modelMs = (timing.modelMs ?? 0) + Math.round(modelMs)
    if (firstTokenAt !== null && timing.firstTokenMs === undefined) {
      const first = firstTokenAt - streamStartedAt
      if (Number.isFinite(first) && first >= 0) timing.firstTokenMs = Math.round(first)
    }
    return output
  }

  try {
    let firstOutput
    try {
      firstOutput = await streamOnce(messages)
    } catch (error) {
      // A provider failure is still a run: record the measured timing. No model
      // output exists, so there is nothing to parse.
      const code = typeof error?.code === 'string' ? error.code : 'ai-call-failed'
      await recordFailedAttempt({
        root,
        session,
        model,
        runId,
        inputRevision,
        baseSessionRevision,
        errorCode: code,
        timing: timingSnapshot(),
        now,
      })
      throw error
    }
    let fresh = await assertRunCurrent({ root, sessionId: session.sessionId, inputRevision, runId, baseSessionRevision })
    let contextUsed = context ?? fresh.context

    let normalized
    try {
      normalized = await measureParse(() => normalizeModelOutput({ output: firstOutput, session: fresh, context: contextUsed }))
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
        baseSessionRevision,
        errorCode: 'ai-invalid-output',
        timing: timingSnapshot(),
        now,
      })
      const retryRunId = newRunId()
      timing.retries += 1
      await withIntentSessionLock(root, session.sessionId, async () => {
        await assertRunCurrent({ root, sessionId: session.sessionId, inputRevision, runId, baseSessionRevision })
        runId = retryRunId
        activeRuns.set(session.sessionId, retryRunId)
      })
      const repairMessages = buildRepairMessages(messages, firstOutput, error)
      let retryOutput
      try {
        retryOutput = await streamOnce(repairMessages)
      } catch (streamError) {
        await recordFailedAttempt({
          root,
          session: fresh,
          model,
          runId: retryRunId,
          inputRevision,
          baseSessionRevision,
          errorCode: typeof streamError?.code === 'string' ? streamError.code : 'ai-call-failed',
          timing: timingSnapshot(),
          now,
        })
        throw streamError
      }
      fresh = await assertRunCurrent({ root, sessionId: session.sessionId, inputRevision, runId: retryRunId, baseSessionRevision })
      contextUsed = context ?? fresh.context
      try {
        normalized = await measureParse(() => normalizeModelOutput({ output: retryOutput, session: fresh, context: contextUsed }))
      } catch (secondError) {
        await recordFailedAttempt({
          root,
          session: fresh,
          model,
          runId: retryRunId,
          inputRevision,
          baseSessionRevision,
          errorCode: 'ai-invalid-output',
          timing: timingSnapshot(),
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
    // late write whose inputRevision/sessionRevision no longer match (INT-12).
    let applied
    try {
      applied = await withIntentSessionLock(root, session.sessionId, async () => {
        const latest = await assertRunCurrent({ root, sessionId: session.sessionId, inputRevision, runId, baseSessionRevision })
        return core.recordAnalysis({
          root,
          // A failed attempt marked the session with a transient error; a
          // successful retry clears it so the UI never shows a stale failure.
          session: { ...latest, error: null },
          analysis,
          context: contextUsed,
          model,
          runId,
          inputRevision,
          now: now(),
          ...(baseSessionRevision === undefined ? {} : { baseSessionRevision }),
          timing: timingSnapshot(),
        })
      })
    } catch (error) {
      throw toIntentHttpError(error, 'ai-invalid-output')
    }
    if (!isPlainObject(applied)) applied = fresh

    const readiness = readinessFor(applied, contextUsed, runId, root)
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

/**
 * Normalise `answer.answers[]` (batch, 1..3) or the legacy single-question
 * fields into one uniform list. A batch is atomic: every entry is validated
 * before core persists anything (contract §4.1).
 */
function normalizeAnswerList(body) {
  const raw = body.answers
  if (raw !== undefined && raw !== null) {
    if (!Array.isArray(raw)) throw invalid('answers must be an array')
    if (raw.length < 1) throw invalid('answers must contain at least one answer')
    if (raw.length > 3) throw invalid('answers 最多 3 条')
    const seen = new Set()
    return raw.map((entry, index) => {
      if (!isPlainObject(entry)) throw invalid(`answers[${index}] must be an object`)
      assertKnownFields(entry, ['questionId', 'optionId', 'text'], `answers[${index}]`)
      const questionId = requireString(entry.questionId, `answers[${index}].questionId`, 200)
      if (seen.has(questionId)) throw invalid(`answers 中 questionId 重复：${questionId}`)
      seen.add(questionId)
      return normalizeSingleAnswer({ questionId, optionId: entry.optionId, text: entry.text }, `answers[${index}].`)
    })
  }
  // Legacy single-answer shape stays accepted by the same handler.
  const questionId = requireString(body.questionId, 'questionId', 200)
  return [normalizeSingleAnswer({ questionId, optionId: body.optionId, text: body.text }, '')]
}

function normalizeSingleAnswer({ questionId, optionId, text }, prefix = '') {
  const normalizedOptionId =
    optionId === undefined || optionId === null ? null : requireString(optionId, `${prefix}optionId`, 200)
  const normalizedText =
    text === undefined || text === null ? '' : requireString(text, `${prefix}text`, { max: MAX_FREE_TEXT, min: 0 })
  if (normalizedOptionId === null && normalizedText.trim() === '') {
    throw invalid(`${prefix}optionId 与 text 至少提供一个`)
  }
  return { questionId, optionId: normalizedOptionId, text: normalizedText.trim() }
}

/** The question a given questionId addresses, from the group or legacy field. */
function questionForAnswer(session, questionId) {
  const questions = Array.isArray(session?.questionGroup?.questions) ? session.questionGroup.questions : []
  const fromGroup = questions.find((question) => question?.questionId === questionId)
  if (fromGroup) return fromGroup
  if (isPlainObject(session?.nextQuestion) && session.nextQuestion.questionId === questionId) {
    return session.nextQuestion
  }
  return null
}

/**
 * Structural pre-check only: membership (unknown question) is core's call
 * (`answer-not-in-group` 422), and the authoritative option check happens again
 * inside `recordAnswers`.
 */
function assertAnswerOptions(session, answers) {
  for (const answer of answers) {
    if (answer.optionId === null) continue
    const question = questionForAnswer(session, answer.questionId)
    if (!question) continue
    const options = Array.isArray(question.options) ? question.options : []
    if (!options.some((option) => option?.id === answer.optionId)) {
      throw invalid(`optionId 不在问题 ${answer.questionId} 的选项中`)
    }
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function handleAnalyze({ root, body, resolveAiSelection, aiStreamFor, now }) {
  let input = normalizeInput(body.input)
  const explicit = normalizeExplicit(body.explicit)
  const projectId = optionalString(body.projectId, 'projectId', 200)
  let selectedRequirementId = optionalString(body.selectedRequirementId, 'selectedRequirementId', 200)
  const actor = optionalString(body.actor, 'actor', 200) ?? 'human:local'
  const grillSkill = loadGrillSkill(root)
  const submittedGrillAnswers = normalizeGrillAnswers(body.grillAnswers)
  const matchedReq = matchRequirement({ root, text: input.text })
  const withMatchedReq = result => ({ ...result, matchedReq })

  let session = null
  if (body.sessionId !== undefined && body.sessionId !== null) {
    session = await requireSession(root, body.sessionId)
    if (session.state === 'committed') throw alreadyCommitted()
    if (projectId && session.project?.id && session.project.id !== projectId) {
      throw invalid('projectId 与既有会话不一致，切换项目请新建会话')
    }
  }
  if (body.retryExisting !== undefined && typeof body.retryExisting !== 'boolean') throw invalid('retryExisting must be a boolean')
  const retryExisting = body.retryExisting === true
  if (retryExisting) {
    if (!session) throw invalid('retryExisting 需要已有会话')
    const expected = requireInteger(body.expectedSessionRevision, 'expectedSessionRevision')
    if (session.sessionRevision !== expected) throw staleSession(session, { expectedSessionRevision: expected })
    const originalAnchor = session.context?.selected?.uid ?? null
    if (selectedRequirementId && selectedRequirementId !== originalAnchor) throw invalid('重新分析不能更换需求上下文锚点')
    selectedRequirementId = originalAnchor
    input = normalizeInput({ text: session.input?.text, source: session.input?.source, extractedText: session.input?.extractedText, attachment: session.input?.attachment })
  }

  // Build the read-set before creating the session: the snapshot carries the
  // resolved project id (`.alm/project.json` when the body omits projectId).
  const contextStartedAt = Date.now()
  const context = await buildContext({
    root,
    projectId: projectId ?? session?.project?.id ?? null,
    selectedRequirementId,
    input,
  })
  if (retryExisting && selectedRequirementId && context.queryStatus !== 'success') {
    throw new IntentHttpError('context-failed', '无法核对已选需求，请恢复需求检索后重试', { status: 503 })
  }
  // Real time spent assembling the model context, recorded on the run (§4.2).
  const contextMs = Math.round(Date.now() - contextStartedAt)

  // Evidence may only be attached to an existing session of this repo; a new
  // session has nothing to reference and would be a cross-session smuggling
  // attempt (INT-16).
  let investigations = []
  if (body.investigationIds !== undefined && body.investigationIds !== null) {
    if (!session) {
      throw new IntentHttpError('invalid-investigation', 'investigationIds 需要一个已存在的会话', { status: 422 })
    }
    investigations = await normalizeInvestigationIds({ root, session, value: body.investigationIds })
    if (investigations.length && !retryExisting) throw invalid('调查证据只能用于当前输入的重新分析')
  }

  const creatingSession = !session
  if (creatingSession) {
    const resolvedProjectId = projectId ?? context?.projectId ?? null
    if (!resolvedProjectId) {
      throw new IntentHttpError('unknown-project', '未找到项目：请传 projectId 或先初始化 .alm/project.json', {
        status: 404,
      })
    }
    session = await core.createSession({
      project: { id: resolvedProjectId },
      actor,
      input: inputForCore(input, explicit),
      now: now(),
    })
  }
  if (!isPlainObject(session)) {
    throw new IntentHttpError('internal-error', '会话创建失败', { status: 500 })
  }

  let retryReservation = null
  session = await withIntentSessionLock(root, session.sessionId, async () => {
    let latest = creatingSession ? session : await requireSession(root, session.sessionId)
    if (latest.state === 'committed') throw alreadyCommitted()
    if (projectId && latest.project?.id && latest.project.id !== projectId) {
      throw invalid('projectId 与既有会话不一致，切换项目请新建会话')
    }
    if (retryExisting && latest.sessionRevision !== body.expectedSessionRevision) throw staleSession(latest, { expectedSessionRevision: body.expectedSessionRevision })
    if (!creatingSession && !retryExisting) latest = await core.setInput({ session: latest, input: inputForCore(input, explicit), now: now() })
    if (retryExisting) latest = { ...latest, analysisRetryRequired: true, sessionRevision: latest.sessionRevision + 1 }
    const grill = grillState(grillSkill, latest.grill, submittedGrillAnswers)
    const saved = await persist(root, { ...attachContext(latest, context), grill })
    if (!creatingSession && !retryExisting) backgroundRuns.delete(saved.sessionId)
    if (retryExisting) {
      retryReservation = newRunId()
      activeRuns.set(saved.sessionId, retryReservation)
      backgroundRuns.set(saved.sessionId, { runId: retryReservation, origin: 'retry', status: 'running', startedAt: new Date(now()).toISOString(), inputRevision: saved.input?.inputRevision ?? null, sessionRevision: saved.sessionRevision })
    }
    return saved
  })

  const localDraft = crystallizeChatDraft({ summary: input.text })
  const structured = Boolean(localDraft.title && localDraft.goal && localDraft.problem && localDraft.acceptance.length)
  if (structured && creatingSession && !selectedRequirementId) return withIntentSessionLock(root, session.sessionId, async () => withMatchedReq(await localIntentDraft({ root, session: await requireSession(root, session.sessionId), draft: localDraft, structured: true, now })))

  try {
    const result = await runAnalysis({
      root,
      session,
      context,
      body,
      resolveAiSelection,
      aiStreamFor,
      now,
      investigations,
      grillSkill,
      grill: session.grill,
      timing: { contextMs },
      baseSessionRevision: Number.isInteger(session.sessionRevision) ? session.sessionRevision : undefined,
    })
    const current = backgroundRuns.get(session.sessionId)
    if (retryReservation && current?.runId === retryReservation) backgroundRuns.set(session.sessionId, { ...current, status: 'done', finishedAt: new Date().toISOString(), sessionRevision: result?.session?.sessionRevision ?? current.sessionRevision })
    return withMatchedReq(result)
  } catch (error) {
    const current = backgroundRuns.get(session.sessionId)
    if (retryReservation && current?.runId === retryReservation) backgroundRuns.set(session.sessionId, { ...current, status: 'error', finishedAt: new Date().toISOString(), error: { code: error?.code ?? 'ai-call-failed', message: '重新分析未完成，请重试。' } })
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
      const assertSameRevision = latest => {
        if (latest.input?.inputRevision !== session.input?.inputRevision) throw staleInput(latest)
        if (latest.sessionRevision !== session.sessionRevision) throw staleSession(latest)
      }
      assertSameRevision(next)
      const hasItem = (next.items ?? []).some((item) => item && item.excluded !== true)
      if (!hasItem) {
        // The failed model call started from an older snapshot.  Re-read and
        // seed the manual item while holding the same session lock as edits,
        // otherwise a concurrent human edit could be overwritten here.
        try {
          next = await withIntentSessionLock(root, session.sessionId, async () => {
            const latest = await requireSession(root, session.sessionId)
            assertSameRevision(latest)
            if ((latest.items ?? []).some((item) => item && item.excluded !== true)) return latest
            return persist(root, ensureManualStub(latest))
          })
        } catch (fallbackError) {
          if (fallbackError?.code === 'stale-input' || fallbackError?.code === 'stale-session') throw fallbackError
          // Preserve the provider error and project the freshest readable
          // snapshot when another writer currently owns the lock.
          try { next = await requireSession(root, session.sessionId) } catch { /* keep prior snapshot */ }
        }
      }
      error.session = projectSession(next, readinessFor(next, next.context, null, root))
      if (creatingSession && !selectedRequirementId) return withIntentSessionLock(root, session.sessionId, async () => {
        const latest = await requireSession(root, session.sessionId)
        assertSameRevision(latest)
        return withMatchedReq(await localIntentDraft({ root, session: latest, draft: localDraft, structured: false, now }))
      })
    }
    throw error
  } finally {
    if (retryReservation && activeRuns.get(session.sessionId) === retryReservation) activeRuns.delete(session.sessionId)
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
      reasoningEffort: selection.reasoningEffort,
      root,
      session,
      question,
      focus,
    })
  } catch (error) {
    throw investigationHttpError(error, session)
  }

  const readiness = readinessFor(session, session.context, null, root)
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

  // §4.1: `expectedInputRevision` guards the analysis input (set only by a new
  // analyze), `expectedSessionRevision` guards the decision state (bumped by
  // every answer). Both are optional echoes of what the client rendered.
  if (body.expectedInputRevision !== undefined && body.expectedInputRevision !== null) {
    const expected = requireInteger(body.expectedInputRevision, 'expectedInputRevision')
    if (session.input?.inputRevision !== expected) throw staleInput(session)
  }
  const expectedSessionRevision =
    body.expectedSessionRevision === undefined || body.expectedSessionRevision === null
      ? null
      : requireInteger(body.expectedSessionRevision, 'expectedSessionRevision')
  if (expectedSessionRevision !== null && Number.isInteger(session.sessionRevision)) {
    if (session.sessionRevision !== expectedSessionRevision) {
      throw staleSession(session, { expectedSessionRevision })
    }
  }

  const answers = normalizeAnswerList(body)
  assertAnswerOptions(session, answers)

  // One atomic CAS write: every answer is validated before anything is saved.
  const recorded = await recordAnswersCore({
    root,
    session,
    answers,
    expectedSessionRevision,
    now,
  })
  let saved = recorded.saved
  let next = recorded.session
  if (!isPlainObject(next)) next = session

  // Standard intent question groups and the compact Grill controls both feed
  // follow-up analyses.  Keep the visual round counter honest for the former;
  // the authoritative answer text remains in core's immutable answer journal.
  if (recorded.changed !== false && next.grill?.status === 'loaded') {
    next = await persist(root, { ...next, grill: { ...next.grill, round: Math.max(1, Number(next.grill.round ?? 1) + 1) } })
    saved = true
  }

  // Idempotent replay (identical answers already active): nothing changed, so
  // no write happened and no new model run may be started.
  if (recorded.changed === false) {
    const readiness = readinessFor(next, next.context, null, root)
    const projected = projectSession(next, readiness)
    return {
      ok: true,
      session: projected,
      readiness,
      saved,
      changed: false,
      stale: recorded.stale,
      progress: recorded.progress,
      pending: false,
      analysisStatus: analysisStatusFor(next.sessionId),
      ...docDraftSummary(next),
    }
  }

  // Answering is an acknowledgement: persist the answer and return immediately,
  // then re-run the analysis in the background. Model latency must not hold the
  // submit request (the UI polls `load` while `analysisStatus.status==='running'`).
  const runId = newRunId()
  const readiness = readinessFor(next, next.context, null, root)
  const projected = projectSession(next, readiness)
  const inputRevision = next.input?.inputRevision ?? null
  const baseSessionRevision = Number.isInteger(next.sessionRevision) ? next.sessionRevision : undefined
  backgroundRuns.set(next.sessionId, {
    runId,
    status: 'running',
    startedAt: new Date(now()).toISOString(),
    inputRevision,
    sessionRevision: baseSessionRevision ?? null,
  })
  void runAnalysis({
    root,
    session: next,
    context: next.context ?? null,
    body,
    resolveAiSelection,
    aiStreamFor,
    now,
    // Answering re-runs the model, not the context build: no queue, no I/O for
    // the read-set (contract §4.1).
    timing: { contextMs: 0 },
    baseSessionRevision,
    grillSkill: next.grill?.status === 'loaded' ? loadGrillSkill(root) : null,
    grill: next.grill ?? null,
  })
    .then((result) => {
      const current = backgroundRuns.get(next.sessionId)
      if (!current || current.runId !== runId) return
      const finished = isPlainObject(result?.session) ? result.session : null
      backgroundRuns.set(next.sessionId, {
        ...current,
        status: 'done',
        finishedAt: new Date().toISOString(),
        // The status now describes the finished run, so it reports the session
        // revision the run produced (recordAnalysis bumps it on success).
        sessionRevision: Number.isInteger(finished?.sessionRevision)
          ? finished.sessionRevision
          : current.sessionRevision,
        session: finished,
        readiness: result?.readiness ?? null,
      })
    })
    .catch((error) => {
      const current = backgroundRuns.get(next.sessionId)
      if (!current || current.runId !== runId) return
      const failedSession = isPlainObject(error?.session) ? error.session : null
      backgroundRuns.set(next.sessionId, {
        ...current,
        status: 'error',
        finishedAt: new Date().toISOString(),
        sessionRevision: Number.isInteger(failedSession?.sessionRevision)
          ? failedSession.sessionRevision
          : current.sessionRevision,
        error: {
          code: ['stale-input', 'stale-session', 'already-committed', 'no-model', 'ai-invalid-output', 'ai-call-failed'].includes(error?.code) ? error.code : 'ai-call-failed',
          message: error?.code === 'stale-session' || error?.code === 'stale-input' ? '会话已变化，请重新加载后重试。' : '重新分析未完成，请检查配置后重试。',
        },
        session: failedSession,
      })
    })
  return {
    ok: true,
    session: projected,
    readiness,
    saved,
    changed: true,
    stale: recorded.stale,
    progress: recorded.progress,
    pending: true,
    analysisStatus: analysisStatusFor(next.sessionId),
    // The draft is visible right away (and advances again when the background
    // run applies); the UI uses docHash as the confirm binding (contract §5).
    ...docDraftSummary(next),
  }
}

/**
 * `action:'set-doc-draft'` — patch the requirement draft (contract §2.3/§4).
 * Draft edits are pure writes: no model call is ever started, and an identical
 * patch is reported as `changed:false` without touching the worktree.
 */
async function handleSetDocDraft({ root, body, now }) {
  const session = await requireSession(root, body.sessionId)
  if (session.state === 'committed') throw alreadyCommitted()

  optionalSessionRevision(body.expectedSessionRevision, 'expectedSessionRevision', session)
  const expectedDraftRevision =
    body.expectedDraftRevision === undefined || body.expectedDraftRevision === null
      ? null
      : requireInteger(body.expectedDraftRevision, 'expectedDraftRevision')
  const latest = draftLatest(session)
  if (expectedDraftRevision !== null && expectedDraftRevision !== latest.draftRevision) {
    throw draftChanged(session, { expected: { docHash: latest.docHash, draftRevision: expectedDraftRevision } })
  }

  const patch = normalizeDraftPatch(body.docDraft)
  if (Object.keys(patch).length === 0) throw invalid('docDraft 至少包含一个可编辑字段')
  const changes = diffDraftPatch(session.docDraft, patch)

  if (changes.length === 0) {
    const readiness = readinessFor(session, session.context, null, root)
    return {
      ok: true,
      session: projectSession(session, readiness),
      readiness,
      changed: false,
      changes,
      ...docDraftSummary(session),
    }
  }

  let next = await callDraftCore('setDocDraft', { root, session, docDraft: patch, patch: true, now: now() })
  if (!isPlainObject(next)) next = session
  const readiness = readinessFor(next, next.context, null, root)
  return {
    ok: true,
    session: projectSession(next, readiness),
    readiness,
    changed: true,
    changes,
    ...docDraftSummary(next),
  }
}

/** `lock-clauses` / `unlock-clauses`: protect human-edited clauses from analysis. */
async function handleClauses({ root, body, now, lock }) {
  const session = await requireSession(root, body.sessionId)
  if (session.state === 'committed') throw alreadyCommitted()

  optionalSessionRevision(body.expectedSessionRevision, 'expectedSessionRevision', session)
  const clauses = normalizeClauseList(body.clauses)
  const before = stableStringify(Array.isArray(session.lockedClauses) ? session.lockedClauses : [])

  let next = await callDraftCore(lock ? 'lockClauses' : 'unlockClauses', {
    root,
    session,
    clauses,
    now: now(),
  })
  if (!isPlainObject(next)) next = session
  const after = stableStringify(Array.isArray(next.lockedClauses) ? next.lockedClauses : [])
  const changed = before !== after
  const readiness = readinessFor(next, next.context, null, root)
  return {
    ok: true,
    session: projectSession(next, readiness),
    readiness,
    changed,
    changes: changed
      ? [{ kind: 'lockedClauses', action: lock ? 'locked' : 'unlocked', count: clauses.length }]
      : [],
    lockedClauses: Array.isArray(next.lockedClauses) ? next.lockedClauses : [],
    ...docDraftSummary(next),
  }
}

async function handleEdit({ root, body, now }) {
  const session = await requireSession(root, body.sessionId)
  if (session.state === 'committed') throw alreadyCommitted()
  const expected = requireInteger(body.expectedInputRevision, 'expectedInputRevision')
  if (session.input?.inputRevision !== expected) throw staleInput(session)
  optionalSessionRevision(body.expectedSessionRevision, 'expectedSessionRevision', session)
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
  if (edits.length === 0) next = { ...next, sessionRevision: (session.sessionRevision ?? 1) + 1 }
  next = await persist(root, next)
  const readiness = readinessFor(next, next.context, null, root)
  return { ok: true, session: projectSession(next, readiness), readiness }
}

async function handleAdoptInvestigation({ root, body, now }) {
  const session = await requireSession(root, body.sessionId)
  if (session.state === 'committed' || session.state === 'cancelled') throw alreadyCommitted()
  if (activeRuns.has(session.sessionId) || analysisStatusFor(session.sessionId)?.status === 'running') throw new IntentHttpError('intent-busy', '分析进行中，请完成后再采纳调查', { status: 409 })
  if (requireInteger(body.expectedInputRevision, 'expectedInputRevision') !== session.input?.inputRevision) throw staleInput(session)
  const expected = requireInteger(body.expectedSessionRevision, 'expectedSessionRevision')
  if (expected !== session.sessionRevision) throw staleSession(session, { expectedSessionRevision: expected })
  const itemId = requireString(body.itemId, 'itemId', { max: 200 })
  const description = requireString(body.unknownDescription, 'unknownDescription', { max: 1000 })
  const item = (session.items ?? []).find(entry => entry?.itemId === itemId && entry.excluded !== true)
  const matches = (item?.unknowns ?? []).filter(entry => entry?.description === description)
  if (matches.length !== 1 || matches[0].blocking !== true) throw invalid('请选择唯一的当前阻塞未知项')
  const [investigation] = await normalizeInvestigationIds({ root, session, value: [body.investigationId] })
  if (investigation?.verdict !== 'answered' || investigation.source !== 'observed_evidence' || !investigation.findings?.length) {
    throw new IntentHttpError('invalid-investigation', '仅可采纳已回答且引用可核对的调查', { status: 422 })
  }
  const record = { ...investigation, itemIds: [itemId], unknownDescription: description, adoptedBy: optionalString(body.actor, 'actor', 200) ?? 'human:local', adoptedAt: now() }
  const records = (session.investigationEvidence ?? []).filter(entry => !(entry?.itemIds?.includes(itemId) && entry.unknownDescription === description))
  const items = session.items.map(entry => entry.itemId === itemId ? { ...entry, unknowns: entry.unknowns.map(unknown => unknown.description === description ? { ...unknown, resolution: 'investigate' } : unknown) } : entry)
  const next = await persist(root, { ...session, items, investigationEvidence: [...records, record], sessionRevision: session.sessionRevision + 1 })
  const readiness = readinessFor(next, next.context, null, root)
  return { ok: true, session: projectSession(next, readiness), readiness }
}

async function handleConfirm({ root, body, now }) {
  const session = await requireSession(root, body.sessionId)
  const analysisStatus = analysisStatusFor(session.sessionId)
  if (analysisStatus?.status === 'running' || activeRuns.has(session.sessionId)) {
    throw new IntentHttpError('analysis-pending', '正在分析；完成前不能确认', { status: 409, session })
  }
  const expected = requireInteger(body.expectedInputRevision, 'expectedInputRevision')
  if (session.input?.inputRevision !== expected) throw staleInput(session)
  // Draft CAS (contract §5): the confirmation binds the exact draft the user
  // saw. The core re-validates authoritatively; this echo check fails fast and
  // carries the same `latest` payload so the UI can re-render without a reload.
  const expectedSessionRevision =
    body.expectedSessionRevision === undefined || body.expectedSessionRevision === null
      ? null
      : requireInteger(body.expectedSessionRevision, 'expectedSessionRevision')
  if (expectedSessionRevision !== null && Number.isInteger(session.sessionRevision)) {
    if (session.sessionRevision !== expectedSessionRevision) {
      throw staleSession(session, { expectedSessionRevision, latest: draftLatest(session) })
    }
  }
  const docHash = optionalString(body.docHash, 'docHash', 200)
  const draftRevision =
    body.draftRevision === undefined || body.draftRevision === null
      ? null
      : requireInteger(body.draftRevision, 'draftRevision')
  const latestDraft = draftLatest(session)
  if (docHash !== null && latestDraft.docHash !== null) {
    const hashMatches = docHash === latestDraft.docHash
    const revisionMatches = draftRevision === null || draftRevision === latestDraft.draftRevision
    if (!hashMatches || !revisionMatches) {
      throw draftChanged(session, { expected: { docHash, draftRevision } })
    }
  }
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
      confirmation: {
        ...confirmation,
        expectedInputRevision: expected,
        contextSnapshotId,
        ...(expectedSessionRevision === null ? {} : { expectedSessionRevision }),
        ...(docHash === null ? {} : { docHash }),
        ...(draftRevision === null ? {} : { draftRevision }),
      },
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
  return { ok: true, session: projectSession(next, readinessFor(next, next.context, null, root)) }
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

  if (['load', 'confirm'].includes(action)) {
    const id = action === 'load' ? (body.session ?? body.sessionId) : body.sessionId
    if (typeof id === 'string') await repairLegacyManual(root, id, now)
  }

  switch (action) {
    case 'crystallize': {
      const draft = crystallizeChatDraft(body)
      if (!draft.title || !draft.goal || !draft.problem || !draft.acceptance.length) throw new IntentHttpError('not-ready', '需要明确的标题、目标、问题现状和验收标准', { status: 422 })
      let investigationIds = body.investigationIds
      if ((!Array.isArray(investigationIds) || !investigationIds.length) && body.apply !== true) {
        const session = { sessionId: `INT-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${randomBytes(3).toString('hex')}`, project: { id: body.projectId ?? null }, input: { inputRevision: 1 } }
        const { selection, stream } = await selectModel({ body, resolveAiSelection, aiStreamFor, session })
        const result = await runInvestigation({ root, session, question: `核查与以下需求目标和问题相关的代码现状：${draft.goal}\n${draft.problem}`, focus: normalizeInvestigationFocus(body.focus), aiStream: stream, ...selection })
        investigationIds = [result.investigation.investigationId]
      }
      if (!Array.isArray(investigationIds) || !investigationIds.length || investigationIds.length > 20) throw new IntentHttpError('invalid-investigation', '需要至少一份已回答的代码调查', { status: 422 })
      const evidence = investigationIds.map(id => {
        const saved = readInvestigation(root, id)
        const checked = saved && revalidateInvestigation(root, saved)
        if (!checked || checked.source !== 'observed_evidence' || checked.verdict !== 'answered' || !checked.findings?.length) throw new IntentHttpError('invalid-investigation', '调查证据不存在、未回答或已过期', { status: 422 })
        return checked
      })
      const doc = { title: draft.title, goal: draft.goal, problem: draft.problem, acceptance: draft.acceptance.map(entry => typeof entry === 'string' ? { text: entry, provenance: 'user-stated' } : entry) }
      const normalized = normalizeDoc(doc, {})
      if (normalized.acceptance.length !== doc.acceptance.length || normalized.pending.length) throw new IntentHttpError('not-ready', '验收标准不完整或尚未确认', { status: 422 })
      const sourceSession = optionalString(body.sourceSession, 'sourceSession', 200)
      const binding = { doc, investigationIds, evidence, sourceSession, project: body.projectId ?? null, owner: body.owner ?? null, priority: body.priority ?? 'P1' }
      const draftHash = createHash('sha256').update(JSON.stringify(binding)).digest('hex')
      if (body.apply === true && body.draftHash !== draftHash) throw new IntentHttpError('draft-changed', '请先核对并确认当前结晶草案', { status: 409 })
      const result = createRequirement({ root, title: draft.title, doc, project: body.projectId, owner: body.owner, priority: body.priority ?? 'P1', source: 'chat', confirmedAt: body.apply === true ? now() : null, apply: body.apply === true,
        attachments: [{ name: 'investigation-evidence.json', text: JSON.stringify(evidence, null, 2), kind: 'investigation' }, ...(sourceSession ? [{ name: 'source-session.json', text: JSON.stringify({ sourceSession }), kind: 'source-session' }] : [])] })
      return { ok: true, draft, draftHash, investigationIds, evidence, result }
    }
    case 'analyze':
      return handleAnalyze({ root, body, resolveAiSelection, aiStreamFor, now })
    case 'answer':
      return withIntentSessionLock(root, body.sessionId, () => handleAnswer({ root, body, resolveAiSelection, aiStreamFor, now }))
    case 'edit':
      return withIntentSessionLock(root, body.sessionId, () => handleEdit({ root, body, now }))
    case 'set-doc-draft':
      return withIntentSessionLock(root, body.sessionId, () => handleSetDocDraft({ root, body, now }))
    case 'lock-clauses':
      return withIntentSessionLock(root, body.sessionId, () => handleClauses({ root, body, now, lock: true }))
    case 'unlock-clauses':
      return withIntentSessionLock(root, body.sessionId, () => handleClauses({ root, body, now, lock: false }))
    case 'investigate':
      return handleInvestigate({ root, body, resolveAiSelection, aiStreamFor, now })
    case 'adopt-investigation':
      return withIntentSessionLock(root, body.sessionId, () => handleAdoptInvestigation({ root, body, now }))
    case 'confirm':
      return withIntentSessionLock(root, body.sessionId, () => handleConfirm({ root, body, now }))
    case 'cancel':
      return withIntentSessionLock(root, body.sessionId, () => handleCancel({ root, body, now }))
    case 'migrate':
      return handleMigrate({ root, now })
    case 'load': {
      const sessionId = typeof body.session === 'string' ? body.session : body.sessionId
      const session = await requireSession(root, sessionId)
      const readiness = readinessFor(session, session.context, null, root)
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

/** Reject storage links before reading: a registered workspace is not authority
 * to follow an intent directory/file into another workspace. */
function assertHistoryStorage(root, sessionId) {
  let target = root
  for (const part of ['.alm', 'intents', 'sessions', ...(sessionId ? [`${sessionId}.json`] : [])]) {
    target = join(target, part)
    try {
      if (lstatSync(target).isSymbolicLink()) throw new IntentHttpError('outside-root', '意图存储不能通过链接越过 workspace', { status: 403 })
    } catch (error) {
      if (error?.code === 'ENOENT') return
      throw error
    }
  }
}

function modelHasEnded(session) {
  const status = analysisStatusFor(session.sessionId)
  if (status?.status === 'running') {
    return (session.runs ?? []).some(run => run?.finishedAt && ['success', 'error'].includes(run.status))
  }
  if (session.state === 'analyzing' || activeRuns.has(session.sessionId) || status?.status === 'running') return false
  const last = session.runs?.at(-1)
  return Boolean(last?.finishedAt && ['success', 'error'].includes(last.status)) || (session.state === 'committed' && Boolean(session.receipt))
}

/** GET intent?project=<workspace>&action=history, or &session=<id>.
 * root/projectId are resolved from the registered workspace by the host. */
export async function handleIntentLoad({ root, projectId, query } = {}) {
  if (typeof root !== 'string' || root === '') throw invalid('root is required')
  if (typeof projectId !== 'string' || !projectId) throw invalid('明确合法的 project 必填')
  const params = query instanceof URLSearchParams ? query : new URLSearchParams(query ?? {})
  for (const key of params.keys()) {
    if (!['project', 'root', 'action', 'session', 'sessionId', 'offset', 'snapshot'].includes(key) || params.getAll(key).length !== 1) throw invalid(`非法或重复查询参数：${key}`)
  }
  const action = params.get('action')
  if (action !== 'answer-history' && (params.has('offset') || params.has('snapshot'))) throw invalid('分页参数仅适用于回答历史')
  const sessionId = params.get('session') ?? params.get('sessionId')
  if (params.has('session') && params.has('sessionId') && params.get('session') !== params.get('sessionId')) throw invalid('session 与 sessionId 不一致')
  assertHistoryStorage(root)
  if (action === 'history') {
    if (sessionId !== null) throw invalid('history 不接受 session')
    let entries
    try { entries = readdirSync(join(root, core.SESSIONS_DIR)) } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      entries = []
    }
    const sessions = []
    for (const name of entries) {
      if (!name.endsWith('.json') || !SESSION_ID_PATTERN.test(name.slice(0, -5))) continue
      const id = name.slice(0, -5)
      assertHistoryStorage(root, id)
      const saved = await requireSession(root, id)
      if (saved.project?.id !== projectId || !modelHasEnded(saved)) continue
      sessions.push({
        sessionId: saved.sessionId, state: saved.state, updatedAt: saved.updatedAt,
        title: saved.items?.[0]?.candidate?.title ?? saved.input?.text?.slice(0, 120) ?? saved.sessionId,
        inputRevision: saved.input?.inputRevision, sessionRevision: saved.sessionRevision,
        route: saved.confirmation?.route ?? saved.items?.[0]?.recommendedRoute ?? null,
      })
    }
    sessions.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)) || a.sessionId.localeCompare(b.sessionId))
    return { ok: true, projectId, sessions }
  }
  if (action !== null && action !== 'load' && action !== 'answer-history') throw invalid('未知 GET action')
  if (sessionId === null || sessionId.trim() === '') throw invalid('session 查询参数必填')
  assertSessionId(sessionId.trim())
  assertHistoryStorage(root, sessionId.trim())
  let session = await requireSession(root, sessionId.trim())
  if (session.project?.id !== projectId) throw new IntentHttpError('unknown-session', '当前项目中不存在该意图', { status: 404 })
  if (action !== 'answer-history') session = await repairLegacyManual(root, sessionId.trim())
  if (action === 'answer-history') {
    const rawOffset = params.get('offset'), snapshot = params.get('snapshot')
    if (!rawOffset || !/^[1-9]\d*$/.test(rawOffset) || !Number.isSafeInteger(Number(rawOffset)) || Number(rawOffset) % 20 !== 0 || !snapshot || !/^[a-f0-9]{64}$/.test(snapshot)) throw invalid('回答历史分页参数无效')
    const page = core.historicalAnswerPage(session, Number(rawOffset))
    if (page.snapshot !== snapshot) throw new IntentHttpError('stale-session', '回答历史已变化，请重新加载会话', { status: 409 })
    if (Number(rawOffset) >= page.total) throw invalid('回答历史分页超出范围')
    return { ok: true, sessionId: session.sessionId, offset: Number(rawOffset), ...page }
  }
  const readiness = readinessFor(session, session.context, null, root)
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
