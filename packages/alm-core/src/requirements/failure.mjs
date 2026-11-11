/**
 * Failure monitor + defect ledger.
 *
 * A failing run step is classified, fingerprinted and recorded as a failure
 * event (`.alm/failures`). A monitor turns product failures into a defect
 * (`.alm/defects`) and, on the first occurrence only, into a `source: defect`
 * requirement that a human must confirm before a fix run may start.
 *
 * The module is deliberately dependency free besides `create.mjs`: the plugin
 * hook (see docs/analysis/failure-closed-loop-design.md §2.1/§2.2) calls it and
 * must never be able to throw into a failing command path, so every writer here
 * is atomic and every reader tolerates a missing/corrupt file.
 */
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { sha256 } from '../model/content-hash.mjs'
import { readProject } from '../project/project.mjs'
import { createRequirement, planRequirement } from './create.mjs'

export const FAILURE_SCHEMA = 'alm.failure.event/v1'
export const FAILURE_DIR = '.alm/failures'
export const FAILURE_KINDS = ['product-defect', 'business-outcome', 'user-cancelled', 'external', 'plugin-defect', 'unknown']
export const FAILURE_KIND_LABELS = {
  'product-defect': '产品缺陷',
  'business-outcome': '业务结果未达成',
  'user-cancelled': '用户取消',
  external: '外部依赖失败',
  'plugin-defect': '插件缺陷',
  unknown: '未知失败',
}
export const FAILURE_STAGES = ['clarify', 'review', 'develop', 'test', 'handoff']

const FAILURE_STAGE_LABELS = { clarify: '澄清', review: '评审', develop: '开发', test: '测试', handoff: '交接' }

export const DEFECT_SCHEMA = 'alm.defect/v1'
export const DEFECT_DIR = '.alm/defects'
export const DEFECT_STATES = [
  'awaiting-confirmation',
  'confirmed',
  'fixing',
  'verifying',
  'awaiting-acceptance',
  'closed',
  'deferred',
  'ignored',
  'failed',
]
export const DEFECT_LABELS = {
  'awaiting-confirmation': '待确认',
  confirmed: '已确认',
  fixing: '修复中',
  verifying: '验证中',
  'awaiting-acceptance': '待验收',
  closed: '已关闭',
  deferred: '已暂缓',
  ignored: '已忽略',
  failed: '迭代失败',
}
export const DEFECT_TRANSITIONS = {
  'awaiting-confirmation': ['confirmed', 'deferred', 'ignored', 'closed'],
  confirmed: ['fixing'],
  fixing: ['verifying', 'failed'],
  verifying: ['awaiting-acceptance', 'failed'],
  'awaiting-acceptance': ['closed'],
  deferred: ['confirmed', 'ignored', 'closed'],
  ignored: ['closed'],
  failed: ['awaiting-confirmation', 'confirmed', 'closed'],
  closed: [],
}

const DEFECT_PLAN_SCHEMA = 'alm.defect.plan/v1'
const MONITORING_SCHEMA = 'alm.monitoring/v1'
const MONITORING_FILE = '.alm/monitoring.json'
const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000
const SUMMARY_MAX = 500
const ITERATION_RESULTS = ['running', 'failed', 'awaiting-acceptance', 'accepted']
const SKIP_DEFECT_KINDS = new Set(['business-outcome', 'user-cancelled', 'external'])

class FailureMonitorError extends Error {
  constructor(message, { code = 'failure-monitor', status = 400 } = {}) {
    super(message)
    this.name = 'FailureMonitorError'
    this.code = code
    this.status = status
  }
}

function monitorError(code, message, status = 400) {
  return new FailureMonitorError(message, { code, status })
}

function nowIso() {
  return new Date().toISOString()
}

function resolveRoot(root) {
  return resolve(root ?? process.cwd())
}

/* ------------------------------------------------------------------ */
/* atomic file helpers                                                 */
/* ------------------------------------------------------------------ */

let tempCounter = 0

function atomicWrite(absolute, content) {
  mkdirSync(dirname(absolute), { recursive: true })
  const temp = `${absolute}.tmp-${process.pid}-${Date.now()}-${++tempCounter}`
  try {
    writeFileSync(temp, content, 'utf8')
    renameSync(temp, absolute)
  } finally {
    rmSync(temp, { force: true })
  }
}

function writeJson(absolute, value) {
  atomicWrite(absolute, `${JSON.stringify(value, null, 2)}\n`)
}

function readJson(absolute) {
  try {
    return JSON.parse(readFileSync(absolute, 'utf8'))
  } catch {
    return null
  }
}

function readDirSafe(absolute) {
  try {
    return readdirSync(absolute)
  } catch {
    return []
  }
}

function readProjectSafe(root) {
  try {
    return readProject(root) ?? null
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ */
/* redaction                                                           */
/* ------------------------------------------------------------------ */

const REDACT_PATTERNS = [
  [/(Authorization\s*[:=]\s*)[^\r\n,;"']+/gi, '$1<redacted>'],
  [/\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer <redacted>'],
  [/\bsk-[A-Za-z0-9_-]{4,}\b/g, '<redacted>'],
  [/(token\s*=\s*)[^\s&,;"']+/gi, '$1<redacted>'],
  [/\b(password\s*[:=]\s*)[^\r\n,;"']+/gi, '$1<redacted>'],
]

function redact(value) {
  let text = String(value ?? '')
  for (const [pattern, replacement] of REDACT_PATTERNS) text = text.replace(pattern, replacement)
  return text
}

function deepRedact(value) {
  if (typeof value === 'string') return redact(value)
  if (Array.isArray(value)) return value.map(deepRedact)
  if (value && typeof value === 'object') {
    const out = {}
    for (const [key, entry] of Object.entries(value)) out[key] = deepRedact(entry)
    return out
  }
  return value
}

function truncate(text, max) {
  const value = String(text ?? '')
  return value.length > max ? `${value.slice(0, Math.max(0, max - 1))}…` : value
}

function oneLine(text, max = SUMMARY_MAX) {
  return truncate(redact(text).replace(/\s+/g, ' ').trim(), max)
}

/* ------------------------------------------------------------------ */
/* failure classification                                              */
/* ------------------------------------------------------------------ */

const CANCELLED_CODES = new Set(['cancelled', 'canceled', 'run-cancelled', 'user-cancelled', 'aborted'])
const EXTERNAL_CODE = /^(ECONN|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|ENETUNREACH|EHOSTUNREACH|EPIPE|ECONNRESET)/i
const PERMISSION_CODES = new Set(['EPERM', 'EACCES'])
const PLUGIN_CODES = new Set(['module-stale', 'carrier-unavailable', 'preset-unavailable', 'run-transition-invalid'])
const PLUGIN_PREFIXES = ['state-']

function errorCode(error) {
  if (error === undefined || error === null || typeof error !== 'object') return ''
  return String(error.code ?? error.errno ?? '').trim()
}

function errorMessageOf(error) {
  if (error === undefined || error === null) return ''
  if (typeof error === 'string') return error
  return String(error.message ?? error.reason ?? '')
}

function errorStatus(error) {
  if (!error || typeof error !== 'object') return 0
  const value = Number(error.status ?? error.statusCode ?? 0)
  return Number.isInteger(value) ? value : 0
}

function isExternalError(error) {
  const code = errorCode(error)
  if (EXTERNAL_CODE.test(code)) return true
  if (PERMISSION_CODES.has(code)) return true
  const status = errorStatus(error)
  if (status === 401 || status === 429) return true
  if (status >= 500 && status <= 599) return true
  if (/5\d\d/.test(code)) return true
  if (/quota|rate.?limit|too.?many.?requests|unauthori[sz]ed/i.test(code)) return true
  const message = errorMessageOf(error)
  if (/quota exceeded|rate limit|too many requests|unauthori[sz]ed|socket hang up|EAI_AGAIN|ETIMEDOUT/i.test(message)) return true
  return false
}

function isCancellation(error, context) {
  if (context && (context.cancelled === true || context.cancel === true)) return true
  const code = errorCode(error)
  if (CANCELLED_CODES.has(code)) return true
  const name = String(error?.name ?? '')
  if (name === 'AbortError') return true
  const message = errorMessageOf(error)
  return /\b(run[- ]?cancelled|cancelled by user|user cancelled)\b/i.test(message)
}

function isPluginFault(error, context) {
  if (context && context.pluginFault === true) return true
  if (error && typeof error === 'object' && error.pluginFault === true) return true
  const code = errorCode(error)
  if (PLUGIN_CODES.has(code)) return true
  if (PLUGIN_PREFIXES.some((prefix) => code.startsWith(prefix))) return true
  return false
}

function detailErrorType(error, fallback) {
  const code = errorCode(error)
  if (code !== '') return code
  if (typeof error === 'string' && error.trim() !== '') return oneLine(error, 80)
  const name = String(error?.name ?? '').trim()
  if (name !== '') return name
  return fallback
}

/**
 * Classify one failed execution step.
 *
 * Rule order is part of the contract: cancellation wins over an external
 * status, an external dependency wins over a business outcome, and a business
 * outcome wins over a plugin fault. Only a non-empty, otherwise unclassified
 * error is a product defect.
 */
export function classifyFailure({ error = null, stage = null, step = null, context = null } = {}) {
  void stage
  void step
  const ctx = context && typeof context === 'object' ? context : null
  if (isCancellation(error, ctx)) {
    return {
      kind: 'user-cancelled',
      errorType: detailErrorType(error, 'cancelled'),
      reason: '用户取消或运行被中止，不是缺陷',
      confidence: 'high',
    }
  }
  if (isExternalError(error)) {
    return {
      kind: 'external',
      errorType: detailErrorType(error, 'external'),
      reason: '外部依赖或环境失败（网络/配额/权限/上游 5xx），不计入缺陷',
      confidence: 'high',
    }
  }
  if (ctx && ctx.businessOutcome === true) {
    return {
      kind: 'business-outcome',
      errorType: detailErrorType(error, 'business-outcome'),
      reason: '运行完成但业务结果未达成，需要人工判定，不自动记为缺陷',
      confidence: 'high',
    }
  }
  if (isPluginFault(error, ctx)) {
    return {
      kind: 'plugin-defect',
      errorType: detailErrorType(error, 'plugin-defect'),
      reason: '插件/载体自身故障，需要先修复插件而不是需求',
      confidence: 'high',
    }
  }
  if (error !== undefined && error !== null && (typeof error !== 'object' || errorMessageOf(error) !== '' || errorCode(error) !== '')) {
    return {
      kind: 'product-defect',
      errorType: detailErrorType(error, 'runtime-error'),
      reason: '执行步骤失败且可复现，按产品缺陷处理',
      confidence: 'medium',
    }
  }
  return {
    kind: 'unknown',
    errorType: 'unknown',
    reason: '没有足够的错误证据，无法分类',
    confidence: 'low',
  }
}

/**
 * Stable failure fingerprint. It intentionally ignores `summary`/`message`
 * (volatile) but keeps the requirement, stage, error type, component and the
 * sorted acceptance test ids so that "the same failure" is deduplicated.
 */
export function failureFingerprint({ requirement = null, stage = null, errorType = null, component = null, testIds = [] } = {}) {
  const tests = (Array.isArray(testIds) ? testIds : testIds === null || testIds === undefined ? [] : [testIds])
    .filter((entry) => entry !== null && entry !== undefined && String(entry).trim() !== '')
    .map((entry) => String(entry))
    .sort()
  const digest = sha256({
    requirement: requirement ?? null,
    stage: stage ?? null,
    errorType: errorType ?? null,
    component: component ?? null,
    testIds: tests,
  })
  return `fp_${digest.slice(0, 16)}`
}

/* ------------------------------------------------------------------ */
/* failure ledger                                                      */
/* ------------------------------------------------------------------ */

function failurePath(root, id) {
  return join(root, FAILURE_DIR, `${id}.json`)
}

function defectPath(root, id) {
  return join(root, DEFECT_DIR, `${id}.json`)
}

function listAllFailures(root) {
  const dir = join(root, FAILURE_DIR)
  const files = readDirSafe(dir)
  const out = []
  for (const name of files) {
    if (!name.endsWith('.json')) continue
    const value = readJson(join(dir, name))
    if (value && value.schema === FAILURE_SCHEMA) out.push(value)
  }
  out.sort((left, right) => String(left.createdAt ?? '').localeCompare(String(right.createdAt ?? '')) || String(left.id).localeCompare(String(right.id)))
  return out
}

function listAllDefects(root) {
  const dir = join(root, DEFECT_DIR)
  const files = readDirSafe(dir)
  const out = []
  for (const name of files) {
    if (!name.endsWith('.json')) continue
    const value = readJson(join(dir, name))
    if (value && value.schema === DEFECT_SCHEMA) out.push(value)
  }
  out.sort((left, right) => String(left.createdAt ?? '').localeCompare(String(right.createdAt ?? '')) || String(left.id).localeCompare(String(right.id)))
  return out
}

function nextFailureId(root, requirement) {
  const projectId = readProjectSafe(root)?.id ?? 'ALM'
  const prefix = requirement ? `FAIL-${requirement}-` : `FAIL-${projectId}-`
  let max = 0
  for (const failure of listAllFailures(root)) {
    const id = String(failure.id ?? '')
    if (!id.startsWith(prefix)) continue
    const value = Number(id.slice(prefix.length))
    if (Number.isInteger(value)) max = Math.max(max, value)
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`
}

function nextDefectId(root, requirementId) {
  const prefix = `DEF-${requirementId}-`
  let max = 0
  for (const defect of listAllDefects(root)) {
    const id = String(defect.id ?? '')
    if (!id.startsWith(prefix)) continue
    const value = Number(id.slice(prefix.length))
    if (Number.isInteger(value)) max = Math.max(max, value)
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`
}

function normalizeEvidence(evidence) {
  const value = evidence && typeof evidence === 'object' ? evidence : {}
  const logs = Array.isArray(value.logs) ? value.logs.map((entry) => (typeof entry === 'string' ? redact(entry) : deepRedact(entry))) : []
  const artifacts = Array.isArray(value.artifacts) ? value.artifacts.map((entry) => deepRedact(entry)) : []
  const snapshot = value.snapshot && typeof value.snapshot === 'object' ? deepRedact(value.snapshot) : null
  const testFileHashes = value.testFileHashes && typeof value.testFileHashes === 'object' && !Array.isArray(value.testFileHashes)
    ? deepRedact(value.testFileHashes)
    : null
  return { logs, artifacts, snapshot, testFileHashes }
}

function analysisShape(analysis) {
  const value = analysis && typeof analysis === 'object' && !Array.isArray(analysis) ? analysis : {}
  const asString = (entry) => (typeof entry === 'string' && entry.trim() !== '' ? redact(entry) : null)
  const asArray = (entry) => (Array.isArray(entry) ? entry.map((item) => (typeof item === 'string' ? redact(item) : deepRedact(item))) : [])
  return {
    what: asString(value.what),
    expected: asString(value.expected),
    actual: asString(value.actual),
    impact: asString(value.impact),
    directCause: asString(value.directCause),
    rootCause: asString(value.rootCause),
    evidence: asArray(value.evidence),
    confidence: asString(value.confidence) ?? 'low',
    missing: asArray(value.missing),
    fixes: asArray(value.fixes),
    tests: asArray(value.tests),
  }
}

function validateCompleteAnalysis(analysis) {
  if (!analysis || typeof analysis !== 'object' || Array.isArray(analysis)) {
    throw monitorError('analysis-invalid', 'analysis must be an object', 400)
  }
  for (const key of ['evidence', 'missing', 'fixes', 'tests']) {
    if (analysis[key] !== undefined && analysis[key] !== null && !Array.isArray(analysis[key])) {
      throw monitorError('analysis-invalid', `analysis.${key} must be an array`, 400)
    }
  }
  const shape = analysisShape(analysis)
  if (shape.what === null && shape.actual === null && shape.rootCause === null && shape.directCause === null) {
    throw monitorError('analysis-invalid', 'analysis needs at least one of what/actual/directCause/rootCause', 400)
  }
  return shape
}

/**
 * Record one failed step. Default is to write (`apply: true`); pass
 * `apply: false` in a dry-run/preview path.
 *
 * Dedupe: the same `dedupeKey` (run|stage|step|fingerprint) inside a 24h window
 * updates only `updatedAt`/`attempt` and returns `{ deduped: true }`.
 */
export function recordFailure({
  root,
  requirement = null,
  requirementRevision = null,
  run = null,
  change = null,
  stage = 'develop',
  step = null,
  error = null,
  kind = null,
  analysis = null,
  evidence = null,
  attempt = 1,
  component = null,
  testIds = [],
  context = null,
  apply = true,
} = {}) {
  const repo = resolveRoot(root)
  const at = nowIso()
  const ctx = context && typeof context === 'object' ? context : null
  const declaredKind = FAILURE_KINDS.includes(kind) ? kind : null
  const classification = declaredKind
    ? {
        kind: declaredKind,
        errorType: detailErrorType(error, declaredKind),
        reason: '分类由调用方指定',
        confidence: 'high',
      }
    : classifyFailure({ error, stage, step, context: ctx })
  const errorType = classification.errorType
  const testIdList = Array.isArray(testIds) ? testIds : testIds === null || testIds === undefined ? [] : [testIds]
  const effectiveTests = testIdList.length > 0 ? testIdList : Array.isArray(ctx?.testIds) ? ctx.testIds : []
  const fingerprint = failureFingerprint({
    requirement,
    stage,
    errorType,
    component: component ?? ctx?.component ?? null,
    testIds: effectiveTests,
  })
  const dedupeKey = sha256([run ?? '', stage ?? '', step ?? '', fingerprint].join('|'))
  const rawMessage = errorMessageOf(error)
  const summary = oneLine(rawMessage !== '' ? rawMessage : classification.reason)
  const normalizedEvidence = normalizeEvidence(evidence)
  const { analysisStatus, analysisRecord } = (() => {
    if (!analysis) return { analysisStatus: 'pending', analysisRecord: null }
    try {
      return { analysisStatus: 'complete', analysisRecord: validateCompleteAnalysis(analysis) }
    } catch {
      return {
        analysisStatus: 'failed',
        analysisRecord: { ...analysisShape(analysis), missing: [...analysisShape(analysis).missing, summary] },
      }
    }
  })()

  const previous = listAllFailures(repo)
    .filter((entry) => entry.dedupeKey === dedupeKey)
    .sort((left, right) => String(right.updatedAt ?? '').localeCompare(String(left.updatedAt ?? '')))[0]
  if (previous) {
    const age = Date.parse(at) - Date.parse(previous.updatedAt ?? previous.createdAt ?? '')
    if (Number.isFinite(age) && age >= 0 && age <= DEDUPE_WINDOW_MS) {
      // Contract: a deduped failure only refreshes `updatedAt`/`attempt`; the
      // original event keeps its summary and evidence untouched.
      const merged = {
        ...previous,
        updatedAt: at,
        attempt: Math.max(Number(previous.attempt ?? 1), Number(attempt ?? 1)),
      }
      if (apply === true) writeJson(failurePath(repo, merged.id), merged)
      return {
        created: false,
        deduped: true,
        applied: apply === true,
        failure: merged,
        kind: merged.kind,
        summary: merged.summary,
      }
    }
  }

  const failure = {
    schema: FAILURE_SCHEMA,
    id: nextFailureId(repo, requirement),
    requirement: requirement ?? null,
    requirementRevision: requirement ? (requirementRevision ?? 1) : null,
    run: run ?? null,
    change: change ?? null,
    stage,
    step: step ?? null,
    at,
    kind: classification.kind,
    kindLabel: FAILURE_KIND_LABELS[classification.kind] ?? classification.kind,
    errorType,
    summary,
    evidence: normalizedEvidence,
    attempt: Number(attempt ?? 1),
    outcome: 'failed',
    fingerprint,
    defect: null,
    dedupeKey,
    analysisStatus,
    analysis: analysisRecord,
    createdAt: at,
    updatedAt: at,
  }
  if (apply === true) writeJson(failurePath(repo, failure.id), failure)
  return {
    created: apply === true,
    deduped: false,
    applied: apply === true,
    failure,
    kind: failure.kind,
    summary,
  }
}

/** Read one failure event; returns `null` for a missing or malformed record. */
export function readFailure(root, failureId) {
  const repo = resolveRoot(root)
  const id = String(failureId ?? '').trim()
  if (!/^FAIL-[A-Z0-9-]{1,120}$/.test(id)) return null
  const value = readJson(failurePath(repo, id))
  return value && value.schema === FAILURE_SCHEMA ? value : null
}

/** List failure events, oldest first. `limit` keeps the newest N. */
export function listFailures(root, { requirement = null, kind = null, limit = null } = {}) {
  const repo = resolveRoot(root)
  let values = listAllFailures(repo)
  if (requirement) values = values.filter((entry) => entry.requirement === requirement)
  if (kind) values = values.filter((entry) => entry.kind === kind)
  if (Number.isInteger(limit) && limit > 0) values = values.slice(-limit)
  return values
}

/**
 * A stable, presentation-safe diagnosis for a recorded failure. Consumers can
 * show this without exposing an internal error code as the primary explanation.
 */
export function failureDiagnosis(failure) {
  if (!failure || typeof failure !== 'object') return null
  const analysis = failure.analysis && typeof failure.analysis === 'object' ? failure.analysis : null
  const rootCause = oneLine(analysis?.rootCause ?? analysis?.directCause ?? '', 500)
  const summary = oneLine(failure.summary ?? rootCause ?? '本轮推进未能完成', 500)
  const category = failure.stage === 'test' ? 'verification' : failure.kind === 'external' ? 'environment' : 'repair'
  const title = category === 'verification' ? '验证检查未通过'
    : category === 'environment' ? '调查证据过期或环境受阻'
      : 'AI 自检发现未完成项'
  return {
    id: typeof failure.id === 'string' ? failure.id : null,
    category,
    title,
    summary,
    stage: typeof failure.stage === 'string' ? failure.stage : null,
    step: typeof failure.step === 'string' ? failure.step : null,
    log: [rootCause, oneLine(analysis?.actual ?? '', 1000)].filter(Boolean).join('\n'),
  }
}

/**
 * Attach a structured analysis to a failure event. `status: 'failed'` keeps the
 * partial shape plus the missing-evidence list instead of throwing away the
 * failure; an invalid `complete` analysis is rejected without touching the file.
 */
export function updateFailureAnalysis({ root, id, failureId = null, analysis = null, status = 'complete', apply = false } = {}) {
  const repo = resolveRoot(root)
  const key = id ?? failureId
  const failure = readFailure(repo, key)
  if (!failure) throw monitorError('failure-not-found', `失败记录 ${key ?? ''} 不存在`, 404)
  if (status !== 'complete' && status !== 'failed') {
    throw monitorError('analysis-status-invalid', `非法分析状态：${status}`, 400)
  }
  const record =
    status === 'complete'
      ? validateCompleteAnalysis(analysis)
      : (() => {
          const shape = analysisShape(analysis)
          if (shape.missing.length === 0) shape.missing = ['分析未完成，缺少证据']
          return shape
        })()
  const next = { ...failure, analysisStatus: status, analysis: record, updatedAt: nowIso() }
  if (apply === true) writeJson(failurePath(repo, next.id), next)
  return { applied: apply === true, failure: next }
}

/**
 * Convert an analysis failure into a stored shape. Contract: never throws — the
 * monitor wraps every model call with this so a broken analysis cannot lose the
 * failure record.
 */
export function attachAnalysis({ error = null, analysis = null } = {}) {
  const message = oneLine(error?.message ?? error?.code ?? error ?? 'analysis failed', 300)
  const shape = analysisShape(analysis)
  if (shape.missing.length === 0) shape.missing = [message]
  return {
    ok: false,
    analysisStatus: 'failed',
    analysis: shape,
    missing: shape.missing,
    reason: message,
  }
}

/* ------------------------------------------------------------------ */
/* defect ledger                                                       */
/* ------------------------------------------------------------------ */

function defectStageLabel(stage) {
  return FAILURE_STAGE_LABELS[stage] ?? String(stage ?? '未知')
}

function defectSeverity(stage, kind) {
  if (kind === 'product-defect' || kind === 'plugin-defect') {
    return stage === 'test' || stage === 'review' ? 'P1' : 'P2'
  }
  return 'P2'
}

function cleanTitle(text) {
  const base = String(text ?? '')
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const title = base === '' ? '执行失败' : base
  return title.length > 120 ? `${title.slice(0, 119)}…` : title
}

function renderEvidence(failure) {
  const evidence = failure.evidence ?? {}
  const lines = []
  const logs = Array.isArray(evidence.logs) ? evidence.logs : []
  const artifacts = Array.isArray(evidence.artifacts) ? evidence.artifacts : []
  const snapshot = evidence.snapshot ?? null
  for (const log of logs.slice(0, 5)) {
    const text = typeof log === 'string' ? log : (log?.path ?? log?.name ?? JSON.stringify(log))
    lines.push(`- 日志：${truncate(String(text ?? ''), 200)}`)
  }
  for (const artifact of artifacts.slice(0, 5)) {
    const text = typeof artifact === 'string' ? artifact : (artifact?.path ?? artifact?.name ?? JSON.stringify(artifact))
    lines.push(`- 产物：${truncate(String(text ?? ''), 200)}`)
  }
  if (snapshot) {
    lines.push(`- 快照：headSha=${snapshot.headSha ?? '未知'} treeHash=${snapshot.treeHash ?? '未知'}`)
  }
  if (lines.length === 0) lines.push('- （无）')
  return lines
}

function renderList(items, fallback = '（无）') {
  const values = Array.isArray(items) ? items : []
  if (values.length === 0) return [`- ${fallback}`]
  return values.map((entry) => `- ${typeof entry === 'string' ? entry : truncate(JSON.stringify(entry), 300)}`)
}

/** Requirement title/brief/goal/priority derived from a failure and its analysis. */
function defectRequirementInputs({ failure, analysis = null }) {
  const shape = analysis ? analysisShape(analysis) : failure.analysis ? analysisShape(failure.analysis) : null
  const summary = cleanTitle(failure.summary ?? failure.errorType ?? '执行失败')
  const title = cleanTitle(`缺陷：${summary}`)
  const stage = failure.stage ?? 'develop'
  const severity = defectSeverity(stage, failure.kind)
  const lines = [
    '### 问题描述',
    '',
    summary,
    '',
    '### 触发条件',
    '',
    `- 阶段：${defectStageLabel(stage)}（${stage}）`,
    `- 步骤：${failure.step ?? '（未记录）'}`,
    `- 运行：${failure.run ?? '（未记录）'}`,
    `- 失败事件：${failure.id ?? '（未持久化）'}`,
    `- 失败分类：${FAILURE_KIND_LABELS[failure.kind] ?? failure.kind}（${failure.kind}）`,
    '',
    '### 复现步骤',
    '',
    '1. 按失败事件记录的运行与步骤重放同一变更。',
    '2. 使用相同的验收测试与输入数据。',
    '3. 预期稳定观察到同一 `errorType` / 同一指纹失败。',
    '',
    '### 预期',
    '',
    shape?.expected ?? '按需求验收标准通过。',
    '',
    '### 实际',
    '',
    shape?.actual ?? summary,
    '',
    '### 影响',
    '',
    shape?.impact ?? `需求 ${failure.requirement ?? '（无关联需求）'} 在${defectStageLabel(stage)}阶段无法继续。`,
    '',
    '### 证据',
    '',
    ...renderEvidence(failure),
    '',
    '### 分析',
    '',
    `- 直接原因：${shape?.directCause ?? '待分析'}`,
    `- 根因：${shape?.rootCause ?? '待分析'}`,
    `- 置信度：${shape?.confidence ?? 'low'}`,
    `- 缺失证据：${(shape?.missing ?? []).length > 0 ? (shape.missing ?? []).join('；') : '无'}`,
    '',
    '### 修复建议',
    '',
    ...renderList(shape?.fixes),
    '',
    '### 验收标准',
    '',
    ...renderList(shape?.tests, '该失败指纹不再出现，且关联验收测试通过。'),
  ]
  return {
    title,
    brief: `${lines.join('\n')}\n`,
    goal: '修复该缺陷并通过同一验收标准，确认同一指纹不再复发。',
    priority: severity,
    severity,
    stage,
    summary,
  }
}

function occurrenceOf(failure, at) {
  return {
    failure: failure.id ?? null,
    at,
    run: failure.run ?? null,
    evidence: failure.evidence ?? null,
  }
}

function withOccurrence(defect, failure, at, { regression = false, analysis = null } = {}) {
  const occurrences = [...(defect.occurrences ?? []), occurrenceOf(failure, at)]
  const timeline = [...(defect.timeline ?? [])]
  timeline.push({
    at,
    type: regression ? 'regression' : 'failure',
    summary: regression
      ? `已关闭缺陷的同一指纹再次出现：${failure.id ?? '未持久化失败事件'}`
      : `同一指纹再次失败：${failure.id ?? '未持久化失败事件'}`,
  })
  const next = {
    ...defect,
    occurrences,
    occurrenceCount: occurrences.length,
    source: {
      ...(defect.source ?? { kind: 'failure-monitor' }),
      kind: 'failure-monitor',
      lastFailure: failure.id ?? defect.source?.lastFailure ?? null,
    },
    updatedAt: at,
    timeline,
  }
  if (regression) {
    next.status = 'awaiting-confirmation'
    next.regressionSuspected = true
    next.authorization = null
    timeline.push({ at, type: 'created', summary: '缺陷回归，重新进入待确认' })
  }
  if (analysis) {
    next.analysis = analysisShape(analysis)
    next.analysisStatus = 'complete'
  }
  return next
}

function buildNewDefect({ root, failure, analysis, requirementId, at }) {
  const inputs = defectRequirementInputs({ failure, analysis })
  const shape = analysis ? analysisShape(analysis) : failure.analysis ? analysisShape(failure.analysis) : null
  const linked = failure.requirement && failure.requirement !== requirementId ? [failure.requirement] : []
  return {
    schema: DEFECT_SCHEMA,
    id: nextDefectId(root, requirementId),
    revision: 1,
    requirement: requirementId,
    title: inputs.title,
    status: 'awaiting-confirmation',
    fingerprint: failure.fingerprint,
    source: {
      kind: 'failure-monitor',
      firstFailure: failure.id ?? null,
      lastFailure: failure.id ?? null,
    },
    occurrences: [occurrenceOf(failure, at)],
    occurrenceCount: 1,
    analysisStatus: shape ? 'complete' : failure.analysisStatus ?? 'pending',
    analysis: shape ?? failure.analysis ?? null,
    impact: {
      stage: inputs.stage,
      requirement: failure.requirement ?? null,
      severity: inputs.severity,
      reason: failure.summary ?? '',
    },
    authorization: null,
    iterations: [],
    regressionSuspected: false,
    ignore: null,
    linkedRequirements: linked,
    timeline: [
      { at, type: 'failure', summary: `失败事件 ${failure.id ?? '（未持久化）'} 分类为 ${failure.kind}（${failure.fingerprint}）` },
      { at, type: 'created', summary: `已创建缺陷需求 ${requirementId}，等待人工确认` },
    ],
    createdAt: at,
    updatedAt: at,
  }
}

function hasPluginEvidence(failure, analysis) {
  const evidence = failure.evidence ?? {}
  if (evidence.pluginFault === true) return true
  if (Array.isArray(evidence.kinds) && evidence.kinds.includes('plugin-defect')) return true
  const shape = analysis ? analysisShape(analysis) : failure.analysis ? analysisShape(failure.analysis) : null
  const text = [shape?.rootCause, shape?.directCause].filter(Boolean).join(' ')
  return /plugin-defect|插件缺陷|插件故障/i.test(text)
}

function coerceFailure(input) {
  if (!input || typeof input !== 'object') throw monitorError('failure-required', 'failure event is required', 400)
  const value = input.schema === FAILURE_SCHEMA ? input : input.failure && input.failure.schema === FAILURE_SCHEMA ? input.failure : input
  if (!value || typeof value !== 'object') throw monitorError('failure-required', 'failure event is required', 400)
  const kind = FAILURE_KINDS.includes(value.kind) ? value.kind : 'unknown'
  const fingerprint =
    typeof value.fingerprint === 'string' && /^fp_[0-9a-f]{16}$/.test(value.fingerprint)
      ? value.fingerprint
      : failureFingerprint({
          requirement: value.requirement ?? null,
          stage: value.stage ?? null,
          errorType: value.errorType ?? null,
        })
  return { ...value, kind, fingerprint }
}

function sortDefectsByUpdated(defects) {
  return [...defects].sort(
    (left, right) => String(right.updatedAt ?? '').localeCompare(String(left.updatedAt ?? '')) || String(right.createdAt ?? '').localeCompare(String(left.createdAt ?? '')),
  )
}

/**
 * Decide what a failure should do to the defect ledger. Pure: never writes.
 *
 * - skip: business outcome / user cancellation / external dependency (unless
 *   plugin-defect evidence exists); external is `eventOnly: true`.
 * - merge: same fingerprint, defect not closed → append an occurrence.
 * - regression: same fingerprint, defect closed → reopen for confirmation.
 * - create: plan a `source: defect` requirement for a brand new defect.
 */
export function planDefect({ root, failure, analysis = null } = {}) {
  const repo = resolveRoot(root)
  const record = coerceFailure(failure)
  const at = nowIso()
  const inputs = defectRequirementInputs({ failure: record, analysis })
  if (SKIP_DEFECT_KINDS.has(record.kind) && !hasPluginEvidence(record, analysis)) {
    return {
      schema: DEFECT_PLAN_SCHEMA,
      action: 'skip',
      fingerprint: record.fingerprint,
      defect: null,
      requirementId: record.requirement ?? null,
      title: inputs.title,
      requirementPlan: null,
      eventOnly: record.kind === 'external',
      reason: `失败分类 ${record.kind} 不进入缺陷台账`,
    }
  }
  const same = listAllDefects(repo).filter((defect) => defect.fingerprint === record.fingerprint)
  const open = sortDefectsByUpdated(same.filter((defect) => defect.status !== 'closed'))[0]
  if (open) {
    return {
      schema: DEFECT_PLAN_SCHEMA,
      action: 'merge',
      fingerprint: record.fingerprint,
      defect: withOccurrence(open, record, at),
      requirementId: open.requirement,
      title: open.title,
      requirementPlan: null,
    }
  }
  const closed = sortDefectsByUpdated(same.filter((defect) => defect.status === 'closed'))[0]
  if (closed) {
    return {
      schema: DEFECT_PLAN_SCHEMA,
      action: 'regression',
      fingerprint: record.fingerprint,
      defect: withOccurrence(closed, record, at, { regression: true }),
      requirementId: closed.requirement,
      title: closed.title,
      requirementPlan: null,
    }
  }
  const requirementPlan = planRequirement({
    root: repo,
    title: inputs.title,
    brief: inputs.brief,
    goal: inputs.goal,
    priority: inputs.priority,
    source: 'defect',
  })
  return {
    schema: DEFECT_PLAN_SCHEMA,
    action: 'create',
    fingerprint: record.fingerprint,
    defect: buildNewDefect({
      root: repo,
      failure: record,
      analysis,
      requirementId: requirementPlan.requirementId,
      at,
    }),
    requirementId: requirementPlan.requirementId,
    title: inputs.title,
    requirementPlan,
  }
}

/** Latest defect for a fingerprint (open wins, otherwise the closed one). */
export function findDefectByFingerprint({ root, fingerprint } = {}) {
  const repo = resolveRoot(root)
  const value = String(fingerprint ?? '').trim()
  if (value === '') return null
  const same = listAllDefects(repo).filter((defect) => defect.fingerprint === value)
  if (same.length === 0) return null
  return sortDefectsByUpdated(same.filter((defect) => defect.status !== 'closed'))[0] ?? sortDefectsByUpdated(same)[0]
}

function writeDefect(root, defect) {
  writeJson(defectPath(root, defect.id), defect)
}

/** Read one validated defect record without exposing arbitrary filesystem paths. */
export function readDefect(root, defectId) {
  const id = String(defectId ?? '').trim()
  if (!/^DEF-[A-Z0-9-]{1,140}$/.test(id)) return null
  const value = readJson(defectPath(root, id))
  return value && value.schema === DEFECT_SCHEMA ? value : null
}

function loadDefectForWrite(root, { defectId = null, id = null, defect = null }) {
  const key = defectId ?? id ?? defect?.id ?? null
  const current = key ? readDefect(root, key) : null
  if (current) return current
  if (defect && typeof defect === 'object' && defect.id) return defect
  throw monitorError('defect-not-found', `缺陷记录 ${key ?? ''} 不存在`, 404)
}

function markFailureDefect(root, failure, defectId) {
  if (!failure?.id) return
  const current = readFailure(root, failure.id)
  if (!current) return
  writeJson(failurePath(root, current.id), { ...current, defect: defectId, updatedAt: nowIso() })
}

function removeRequirementFiles(root, requirement) {
  if (!requirement?.file) return
  rmSync(join(root, requirement.file), { force: true })
  if (requirement.briefFile) rmSync(join(root, requirement.briefFile), { force: true })
}

/**
 * Apply `planDefect`. Default is a dry run (`apply: false`); with `apply: true`:
 * - create: writes the requirement first, then the defect; rolls the requirement
 *   files back if the defect write fails;
 * - merge/regression: appends the occurrence to the existing defect;
 * - skip: writes nothing and returns `eventOnly` for external failures.
 */
export function createDefect({ root, failure, analysis = null, actor = 'ai:monitor', apply = false } = {}) {
  void actor
  const repo = resolveRoot(root)
  const plan = planDefect({ root: repo, failure, analysis })
  if (plan.action === 'skip') {
    return {
      applied: false,
      skipped: true,
      action: 'skip',
      eventOnly: plan.eventOnly === true,
      defect: null,
      requirementId: plan.requirementId,
      plan,
    }
  }
  if (apply !== true) {
    return {
      applied: false,
      action: plan.action,
      defect: plan.defect,
      requirementId: plan.requirementId,
      requirement: null,
      plan,
    }
  }
  const defect = { ...plan.defect, revision: plan.defect.revision ?? 1 }
  let requirement = null
  if (plan.action === 'create') {
    const inputs = defectRequirementInputs({ failure: coerceFailure(failure), analysis })
    const created = createRequirement({
      root: repo,
      id: plan.requirementId,
      title: inputs.title,
      brief: inputs.brief,
      goal: inputs.goal,
      priority: inputs.priority,
      source: 'defect',
      apply: true,
    })
    requirement = { requirementId: created.requirementId, file: created.file, briefFile: created.briefFile }
    try {
      writeDefect(repo, defect)
    } catch (error) {
      removeRequirementFiles(repo, requirement)
      throw error
    }
  } else {
    writeDefect(repo, defect)
  }
  markFailureDefect(repo, failure?.schema === FAILURE_SCHEMA ? failure : failure?.failure ?? failure, defect.id)
  return {
    applied: true,
    action: plan.action,
    created: plan.action === 'create',
    merged: plan.action === 'merge',
    regression: plan.action === 'regression',
    defect,
    requirementId: defect.requirement,
    requirement,
  }
}

function transitionDefect(defect, status, { at, type, summary, extra = {} } = {}) {
  if (!DEFECT_STATES.includes(status)) throw monitorError('defect-status-invalid', `未知缺陷状态：${status}`, 400)
  if (status !== defect.status) {
    const allowed = DEFECT_TRANSITIONS[defect.status] ?? []
    if (!allowed.includes(status)) {
      throw monitorError('defect-transition-invalid', `缺陷 ${defect.id} 不能从 ${defect.status} 流转到 ${status}`, 409)
    }
  }
  return {
    ...defect,
    ...extra,
    status,
    revision: Number(defect.revision ?? 1) + 1,
    updatedAt: at,
    timeline: [...(defect.timeline ?? []), { at, type, summary }],
  }
}

/**
 * Confirm a defect and bind the authorization to the current defect revision:
 * `authorization.defectRevision` is the revision a human actually reviewed. Any
 * later automatic change bumps `revision`, so a stale confirmation is visible.
 */
export function confirmDefect({ root, defectId = null, id = null, defect = null, actor = null, scope = null, apply = false } = {}) {
  const repo = resolveRoot(root)
  const current = loadDefectForWrite(repo, { defectId, id, defect })
  const at = nowIso()
  const actorId = String(actor ?? '').trim()
  if (actorId === '') throw monitorError('actor-required', '确认缺陷需要 actor（谁确认了修复范围）', 400)
  if (!['awaiting-confirmation', 'deferred'].includes(current.status)) {
    throw monitorError('defect-transition-invalid', `缺陷 ${current.id} 当前状态 ${current.status} 不能确认`, 409)
  }
  const scopeValue = scope === null || scope === undefined || scope === '' ? 'fix-and-verify' : scope
  const authorization = {
    actor: actorId,
    at,
    scope: scopeValue,
    defectRevision: Number(current.revision ?? 1),
  }
  const next = transitionDefect(current, 'confirmed', {
    at,
    type: 'confirmed',
    summary: `${actorId} 已确认修复范围：${typeof scopeValue === 'string' ? scopeValue : JSON.stringify(scopeValue)}`,
    extra: { authorization },
  })
  if (apply === true) writeDefect(repo, next)
  return { applied: apply === true, defect: next, authorization }
}

/** Defer a not-yet-confirmed defect (暂缓). */
export function deferDefect({ root, defectId = null, id = null, defect = null, actor = null, reason = null, until = null, apply = false } = {}) {
  const repo = resolveRoot(root)
  const current = loadDefectForWrite(repo, { defectId, id, defect })
  const at = nowIso()
  const next = transitionDefect(current, 'deferred', {
    at,
    type: 'deferred',
    summary: `缺陷已暂缓${reason ? `：${oneLine(reason, 200)}` : ''}${until ? `（至 ${until}）` : ''}`,
    extra: { defer: { actor: actor ? String(actor) : null, reason: reason ? oneLine(reason, 300) : null, until: until ?? null, at } },
  })
  if (apply === true) writeDefect(repo, next)
  return { applied: apply === true, defect: next }
}

/** Ignore a defect; a reason and an explicit scope are mandatory. */
export function ignoreDefect({ root, defectId = null, id = null, defect = null, reason = null, scope = null, expiresAt = null, actor = null, apply = false } = {}) {
  const repo = resolveRoot(root)
  const current = loadDefectForWrite(repo, { defectId, id, defect })
  const reasonText = String(reason ?? '').trim()
  if (reasonText === '') throw monitorError('ignore-reason-required', '忽略缺陷必须给出原因', 400)
  const scopeValue = scope ?? 'failure-fingerprint'
  const at = nowIso()
  const next = transitionDefect(current, 'ignored', {
    at,
    type: 'ignored',
    summary: `忽略缺陷：${oneLine(reasonText, 200)}（范围：${typeof scopeValue === 'string' ? scopeValue : JSON.stringify(scopeValue)}）`,
    extra: {
      ignore: {
        reason: oneLine(reasonText, 500),
        scope: scopeValue,
        expiresAt: expiresAt ?? null,
        actor: actor ? String(actor) : null,
        at,
      },
    },
  })
  if (apply === true) writeDefect(repo, next)
  return { applied: apply === true, defect: next }
}

/** Link another requirement (e.g. the original requirement) to the defect. */
export function linkDefect({ root, defectId = null, id = null, defect = null, requirementId = null, apply = false } = {}) {
  const repo = resolveRoot(root)
  const current = loadDefectForWrite(repo, { defectId, id, defect })
  const target = String(requirementId ?? '').trim()
  if (!/^REQ-[A-Z0-9]{2,8}-\d{3}$/.test(target)) {
    throw monitorError('invalid-requirement-id', `非法需求 ID：${target || '（空）'}`, 400)
  }
  const linked = [...new Set([...(current.linkedRequirements ?? []), target])]
  const at = nowIso()
  const next = {
    ...current,
    linkedRequirements: linked,
    revision: Number(current.revision ?? 1) + 1,
    updatedAt: at,
    timeline: [...(current.timeline ?? []), { at, type: 'created', summary: `关联需求 ${target}` }],
  }
  if (apply === true) writeDefect(repo, next)
  return { applied: apply === true, defect: next }
}

/** Record one fix iteration on a defect. */
export function recordIteration({ root, defectId = null, id = null, defect = null, run = null, change = null, result = 'running', note = null, apply = false } = {}) {
  const repo = resolveRoot(root)
  const current = loadDefectForWrite(repo, { defectId, id, defect })
  if (!ITERATION_RESULTS.includes(result)) {
    throw monitorError('iteration-result-invalid', `非法迭代结果：${result}`, 400)
  }
  const at = nowIso()
  const iteration = {
    at,
    run: run ?? null,
    change: change ?? null,
    result,
    note: note === null || note === undefined ? null : oneLine(note, 300),
  }
  let next = {
    ...current,
    iterations: [...(current.iterations ?? []), iteration],
    revision: Number(current.revision ?? 1) + 1,
    updatedAt: at,
    timeline: [...(current.timeline ?? []), { at, type: 'run', summary: `修复迭代 ${run ?? '（未记录运行）'}：${result}` }],
  }
  if (result === 'failed' && (DEFECT_TRANSITIONS[next.status] ?? []).includes('failed')) {
    next = transitionDefect(next, 'failed', {
      at,
      type: 'run',
      summary: '修复迭代失败，缺陷标记为迭代失败',
    })
  }
  if (apply === true) writeDefect(repo, next)
  return { applied: apply === true, defect: next }
}

const STATUS_TIMELINE = {
  confirmed: 'confirmed',
  fixing: 'run',
  verifying: 'verified',
  'awaiting-acceptance': 'verified',
  closed: 'closed',
  deferred: 'deferred',
  ignored: 'ignored',
  failed: 'run',
  'awaiting-confirmation': 'created',
}

/** Enforce `DEFECT_TRANSITIONS` for an arbitrary status change. */
/** Attach a reviewed cause analysis to a defect (the failure event keeps its own copy). */
/**
 * Closes the defects of one requirement when its acceptance run passes: the
 * regression tests that were red are green again, so the fix iteration is
 * accepted and the record stops waiting for a human to close it by hand.
 */
export function closeDefectsOnAcceptance({ root, requirementId = null, actor = 'human:local', note = null, run = null, apply = false } = {}) {
  const repo = resolveRoot(root)
  const candidates = listAllDefects(repo).filter(
    (defect) =>
      (requirementId === null || defect.requirement === requirementId) &&
      (defect.status === 'verifying' || defect.status === 'awaiting-acceptance'),
  )
  if (apply !== true) {
    // Dry run: report what the pass would close without touching the ledger.
    return { schema: DEFECT_SCHEMA, applied: false, closed: candidates.map((defect) => ({ id: defect.id, requirement: defect.requirement, status: 'closed' })), defects: [] }
  }
  const closed = []
  for (const defect of candidates) {
    let current = defect
    if (current.status === 'verifying') {
      const recorded = recordIteration({
        root: repo,
        defectId: current.id,
        run,
        result: 'accepted',
        note: note ?? '验收通过，修复迭代被接受',
        apply: true,
      })
      current = recorded.defect
      current = updateDefectStatus({
        root: repo,
        defectId: current.id,
        status: 'awaiting-acceptance',
        note: '验收通过，缺陷进入关闭',
        apply: true,
      }).defect
    }
    current = updateDefectStatus({
      root: repo,
      defectId: current.id,
      status: 'closed',
      note: note ?? '验收通过，缺陷关闭',
      apply: true,
    }).defect
    closed.push(current)
  }
  return {
    schema: DEFECT_SCHEMA,
    applied: apply === true,
    closed: closed.map((defect) => ({ id: defect.id, requirement: defect.requirement, status: defect.status })),
    defects: closed,
  }
}

export function updateDefectAnalysis({ root, defectId = null, id = null, analysis = null, status = null, apply = false } = {}) {
  const repo = resolveRoot(root)
  const current = loadDefectForWrite(repo, { defectId, id })
  const shape = analysisShape(analysis)
  const at = nowIso()
  const next = {
    ...current,
    analysis: shape,
    analysisStatus: status ?? 'complete',
    revision: Number(current.revision ?? 1) + 1,
    updatedAt: at,
    timeline: [...(current.timeline ?? []), { at, type: 'analysis', summary: '缺陷原因分析更新' }],
  }
  if (apply === true) writeDefect(repo, next)
  return { applied: apply === true, defect: next }
}

export function updateDefectStatus({ root, defectId = null, id = null, defect = null, status = null, note = null, apply = false } = {}) {
  const repo = resolveRoot(root)
  const current = loadDefectForWrite(repo, { defectId, id, defect })
  const target = String(status ?? '').trim()
  const at = nowIso()
  const next = transitionDefect(current, target, {
    at,
    type: STATUS_TIMELINE[target] ?? 'analysis',
    summary: `缺陷状态：${DEFECT_LABELS[current.status] ?? current.status} → ${DEFECT_LABELS[target] ?? target}${note ? `（${oneLine(note, 200)}）` : ''}`,
  })
  if (apply === true) writeDefect(repo, next)
  return { applied: apply === true, defect: next }
}

/** Defect view for one requirement: latest defect + status label + counts. */
export function defectView({ root, requirementId = null } = {}) {
  const repo = resolveRoot(root)
  const defects = listDefects(repo, { requirement: requirementId })
  const defect = sortDefectsByUpdated(defects)[0] ?? null
  if (!defect) return { exists: false, defect: null, status: null, statusLabel: null, occurrenceCount: 0, regressionSuspected: false }
  return {
    exists: true,
    defect,
    status: defect.status,
    statusLabel: DEFECT_LABELS[defect.status] ?? defect.status,
    occurrenceCount: defect.occurrenceCount ?? 0,
    regressionSuspected: defect.regressionSuspected === true,
  }
}

/** List defects, oldest first, optionally filtered by status/requirement. */
export function listDefects(root, { status = null, requirement = null } = {}) {
  const repo = resolveRoot(root)
  let values = listAllDefects(repo)
  if (status) values = values.filter((defect) => defect.status === status)
  if (requirement) values = values.filter((defect) => defect.requirement === requirement || (defect.linkedRequirements ?? []).includes(requirement))
  return values
}

/** Compact counters used by the status/query surface. */
export function defectSummary(root) {
  const repo = resolveRoot(root)
  const defects = listAllDefects(repo)
  const count = (status) => defects.filter((defect) => defect.status === status).length
  return {
    awaitingConfirmation: count('awaiting-confirmation'),
    confirmed: count('confirmed'),
    fixing: count('fixing'),
    verifying: count('verifying'),
    awaitingAcceptance: count('awaiting-acceptance'),
    total: defects.length,
  }
}

/* ------------------------------------------------------------------ */
/* monitoring switch                                                   */
/* ------------------------------------------------------------------ */

function defaultMonitoring() {
  return {
    schema: MONITORING_SCHEMA,
    enabled: true,
    stages: [...FAILURE_STAGES],
    notify: true,
    updatedAt: null,
    updatedBy: null,
  }
}

/** Read `.alm/monitoring.json`; a missing/corrupt file falls back to "on". */
export function readMonitoring(root) {
  const repo = resolveRoot(root)
  const value = readJson(join(repo, MONITORING_FILE))
  if (!value || value.schema !== MONITORING_SCHEMA) return defaultMonitoring()
  const stages = Array.isArray(value.stages) ? value.stages.filter((stage) => FAILURE_STAGES.includes(stage)) : [...FAILURE_STAGES]
  return {
    schema: MONITORING_SCHEMA,
    enabled: value.enabled !== false,
    stages,
    notify: value.notify !== false,
    updatedAt: value.updatedAt ?? null,
    updatedBy: value.updatedBy ?? null,
  }
}

/**
 * Update the monitoring switch. Turning it off stops *new* failure records; it
 * never deletes failures or defects that already exist.
 */
export function writeMonitoring({ root, enabled = null, stages = null, notify = null, updatedBy = 'human:local', apply = false } = {}) {
  const repo = resolveRoot(root)
  const current = readMonitoring(repo)
  const next = {
    schema: MONITORING_SCHEMA,
    enabled: enabled === null || enabled === undefined ? current.enabled : Boolean(enabled),
    stages: stages === null || stages === undefined ? current.stages : (Array.isArray(stages) ? stages.filter((stage) => FAILURE_STAGES.includes(stage)) : current.stages),
    notify: notify === null || notify === undefined ? current.notify : Boolean(notify),
    updatedAt: nowIso(),
    updatedBy: String(updatedBy ?? 'human:local'),
  }
  if (apply === true) writeJson(join(repo, MONITORING_FILE), next)
  return { applied: apply === true, monitoring: next }
}
