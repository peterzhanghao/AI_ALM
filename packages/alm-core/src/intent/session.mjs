/**
 * Intent session lifecycle: create, load, save (atomic), edit input, record
 * answers, record an analysis run and cancel.
 *
 * A session is the carrier of one human intent. Its `inputRevision` is the
 * causality token: an analysis or confirmation produced for revision N may
 * never be applied to revision N+1, and a late model response is rejected
 * rather than silently overwriting newer user words.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { applyAnalysis } from './analysis.mjs'
import {
  ANALYSIS_SCHEMA,
  INTENT_SCHEMA,
  INTENT_SCHEMA_VERSION,
  INPUT_SOURCES,
  MAX_EXTRACTED_TEXT,
  ROUTES,
  SESSION_STATES,
  intentError,
} from './errors.mjs'
import {
  cleanLine,
  clone,
  dateFrom,
  listJsonFiles,
  nowIso,
  readJsonFile,
  safeRepoPath,
  sha256Hex,
  stamp,
  randomHex,
  truncateText,
  tryReadJsonFile,
  writeJsonAtomic,
} from './util.mjs'

export const SESSIONS_DIR = '.alm/intents/sessions'
const MAX_INPUT_TEXT = 200000
const PRIORITIES = new Set(['P0', 'P1', 'P2', 'P3'])

export function sessionsDir(root) {
  return join(root, SESSIONS_DIR)
}

export function sessionFile(root, sessionId) {
  return join(root, SESSIONS_DIR, `${sessionId}.json`)
}

export function newSessionId(now) {
  return `INT-${stamp(dateFrom(now))}-${randomHex(3)}`
}

export function newEntityId(prefix, now) {
  return `${prefix}-${stamp(dateFrom(now))}-${randomHex(3)}`
}

function defaultExplicit(value) {
  const owner = cleanLine(value?.owner, { max: 120, field: 'owner' }) || null
  const priority = cleanLine(value?.priority, { max: 4, field: 'priority' }).toUpperCase() || null
  if (priority && !PRIORITIES.has(priority)) {
    throw intentError('invalid-input', `无效优先级：${priority}（允许 P0-P3）`)
  }
  return { owner, priority }
}

/** Build the bounded input record; extractedText is the only persisted copy. */
export function makeInput({ text, source = 'text', extractedText, attachment = null, explicit = null, inputRevision = 1 } = {}) {
  const cleanSource = String(source ?? 'text')
  if (!INPUT_SOURCES.includes(cleanSource)) {
    throw intentError('invalid-input', `无效输入来源：${cleanSource}（允许 ${INPUT_SOURCES.join('/')}）`)
  }
  const originalText = truncateText(text ?? '', MAX_INPUT_TEXT)
  const trimmed = originalText.text.trim()
  if (trimmed === '') throw intentError('empty-input', '意图文本不能为空')
  const extracted = truncateText(extractedText === undefined || extractedText === null ? trimmed : extractedText, MAX_EXTRACTED_TEXT)
  let normalizedAttachment = null
  if (attachment && typeof attachment === 'object') {
    normalizedAttachment = {
      name: cleanLine(attachment.name, { max: 200, field: 'attachment.name' }) || null,
      size: Number.isFinite(Number(attachment.size)) ? Number(attachment.size) : null,
      kind: cleanLine(attachment.kind, { max: 60, field: 'attachment.kind' }) || null,
    }
  }
  const inputHash = sha256Hex({
    text: trimmed,
    source: cleanSource,
    attachment: normalizedAttachment,
    extractedText: extracted.text,
    extractedTextTruncated: extracted.truncated,
  })
  return {
    text: trimmed,
    source: cleanSource,
    extractedText: extracted.text,
    extractedTextTruncated: extracted.truncated,
    originalTextLength: originalText.originalLength,
    attachment: normalizedAttachment,
    inputRevision: Number.isInteger(inputRevision) && inputRevision > 0 ? inputRevision : 1,
    inputHash,
    explicit: defaultExplicit(explicit),
  }
}

export function emptyContext(projectId) {
  return {
    policy: 'intent-context/v1',
    contextSnapshotId: null,
    projectId: projectId ?? null,
    generatedAt: null,
    queryStatus: 'not-queried',
    query: null,
    readSet: [],
    selected: null,
    boundary: {
      scope: 'project',
      projectId: projectId ?? null,
      limit: 0,
      total: 0,
      truncated: false,
      statement: '尚未查询需求库，相关需求尚未核对。',
      caution: '本结论不能用于声称“全新/无重复”。',
    },
  }
}

function normalizeProject(project) {
  if (typeof project === 'string' && project.trim() !== '') return { id: project.trim().toUpperCase(), name: null }
  if (project && typeof project === 'object') {
    const id = cleanLine(project.id, { max: 20, field: 'project.id' }).toUpperCase()
    if (id === '') throw intentError('invalid-request', 'project.id 不能为空')
    return { id, name: cleanLine(project.name, { max: 80, field: 'project.name' }) || null }
  }
  throw intentError('invalid-request', 'createSession 需要 project（项目 id 或 {id,name}）')
}

export function normalizeSession(session) {
  if (!session || typeof session !== 'object' || Array.isArray(session)) {
    throw intentError('invalid-session', 'session 必须是对象')
  }
  const out = clone(session)
  out.schema = INTENT_SCHEMA
  out.schemaVersion = INTENT_SCHEMA_VERSION
  out.sessionId = String(out.sessionId ?? '')
  if (!/^INT-[A-Za-z0-9-]+$/.test(out.sessionId)) throw intentError('invalid-session', 'sessionId 非法')
  out.state = SESSION_STATES.includes(out.state) ? out.state : 'editing'
  out.input =
    out.input && typeof out.input === 'object'
      ? out.input
      : makeInput({ text: '（历史会话缺少输入文本，已恢复为待补充状态）', source: 'text' })
  out.input.explicit = out.input.explicit ?? { owner: null, priority: null }
  out.input.inputRevision = Number.isInteger(out.input.inputRevision) ? out.input.inputRevision : 1
  out.answers = Array.isArray(out.answers) ? out.answers : []
  out.runs = Array.isArray(out.runs) ? out.runs : []
  out.items = Array.isArray(out.items) ? out.items : []
  out.artifacts = Array.isArray(out.artifacts) ? out.artifacts : []
  out.context = out.context && typeof out.context === 'object' ? out.context : emptyContext(out.project?.id)
  out.nextQuestion = out.nextQuestion ?? null
  out.confirmation = out.confirmation ?? null
  out.receipt = out.receipt ?? null
  out.error = out.error ?? null
  out.createdAt = out.createdAt ?? nowIso()
  out.updatedAt = out.updatedAt ?? out.createdAt
  return out
}

/** Create and (when `root` is given) persist a fresh session. */
export function createSession({ root, project, actor = 'human:local', input, context, now } = {}) {
  const projectRef = normalizeProject(project)
  const createdAt = nowIso(now)
  const session = {
    schema: INTENT_SCHEMA,
    schemaVersion: INTENT_SCHEMA_VERSION,
    sessionId: newSessionId(now),
    project: projectRef,
    createdAt,
    updatedAt: createdAt,
    actor: cleanLine(actor, { max: 120, field: 'actor' }) || 'human:local',
    state: 'editing',
    input: makeInput({ ...input, inputRevision: 1 }),
    answers: [],
    runs: [],
    context: context ?? emptyContext(projectRef.id),
    items: [],
    nextQuestion: null,
    confirmation: null,
    artifacts: [],
    receipt: null,
    error: null,
  }
  const normalized = normalizeSession(session)
  if (root) saveSession({ root, session: normalized })
  return normalized
}

export function loadSession({ root, sessionId } = {}) {
  if (!root) throw intentError('invalid-request', 'loadSession 需要 root')
  const id = String(sessionId ?? '').trim()
  if (id === '' || !/^INT-[A-Za-z0-9-]+$/.test(id)) {
    throw intentError('invalid-request', `非法 sessionId：${sessionId}`)
  }
  const file = sessionFile(root, id)
  if (!existsSync(file)) throw intentError('unknown-session', `未找到会话 ${id}`, { sessionId: id })
  const raw = tryReadJsonFile(file)
  if (!raw) throw intentError('invalid-session', `会话文件不是有效 JSON：${id}`)
  if (raw.schema !== INTENT_SCHEMA || raw.schemaVersion !== INTENT_SCHEMA_VERSION) {
    throw intentError('invalid-session', `会话 ${id} schema 版本不受支持，请先执行 migrateIntentStore`, {
      schema: raw.schema ?? null,
      schemaVersion: raw.schemaVersion ?? null,
    })
  }
  if (raw.sessionId !== id) throw intentError('invalid-session', `会话文件 sessionId 不匹配：${id}`)
  return normalizeSession(raw)
}

export function saveSession({ root, session } = {}) {
  if (!root) throw intentError('invalid-request', 'saveSession 需要 root')
  if (!session) throw intentError('invalid-request', 'saveSession 需要 session')
  const normalized = normalizeSession(session)
  normalized.updatedAt = nowIso()
  const target = sessionFile(root, normalized.sessionId)
  if (!target.startsWith(sessionsDir(root))) throw intentError('invalid-request', '会话路径越界')
  writeJsonAtomic(safeRepoPath(root, `${SESSIONS_DIR}/${normalized.sessionId}.json`), normalized)
  return normalized
}

export function listSessions({ root } = {}) {
  if (!root) throw intentError('invalid-request', 'listSessions 需要 root')
  const sessions = []
  for (const file of listJsonFiles(sessionsDir(root))) {
    const raw = tryReadJsonFile(file)
    if (!raw || raw.schema !== INTENT_SCHEMA || raw.schemaVersion !== INTENT_SCHEMA_VERSION) continue
    sessions.push({
      sessionId: raw.sessionId,
      projectId: raw.project?.id ?? null,
      state: raw.state ?? 'editing',
      inputRevision: raw.input?.inputRevision ?? 1,
      route: raw.confirmation?.route ?? raw.items?.[0]?.recommendedRoute ?? null,
      updatedAt: raw.updatedAt ?? raw.createdAt ?? null,
      title: raw.project?.name ?? raw.project?.id ?? null,
    })
  }
  sessions.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
  return sessions
}

function assertMutable(session) {
  if (session.state === 'committed') {
    throw intentError('already-committed', '会话已提交，不能再修改；如需继续请新建会话')
  }
  if (session.state === 'cancelled') {
    throw intentError('session-cancelled', '会话已取消，不能再修改；如需继续请新建会话', {
      sessionId: session.sessionId,
    })
  }
}

/** Replace the user's words: bump inputRevision and invalidate derived work. */
export function setInput({ root, session, input, now } = {}) {
  if (!session) throw intentError('invalid-request', 'setInput 需要 session')
  assertMutable(session)
  const nextRevision = (session.input?.inputRevision ?? 0) + 1
  const next = clone(session)
  next.input = makeInput({ ...input, explicit: input?.explicit ?? session.input?.explicit, inputRevision: nextRevision })
  next.items = []
  next.nextQuestion = null
  next.confirmation = null
  next.artifacts = []
  next.receipt = null
  next.error = null
  next.state = 'editing'
  next.updatedAt = nowIso(now)
  if (root) return saveSession({ root, session: next })
  return normalizeSession(next)
}

/** Record one answer to the previous single question. */
export function recordAnswer({ root, session, answer, now } = {}) {
  if (!session) throw intentError('invalid-request', 'recordAnswer 需要 session')
  assertMutable(session)
  const questionId = cleanLine(answer?.questionId, { max: 120, field: 'answer.questionId' })
  if (questionId === '') throw intentError('invalid-request', 'answer.questionId 不能为空')
  const next = clone(session)
  next.answers.push({
    answerId: newEntityId('ANS', now),
    itemId: cleanLine(answer?.itemId, { max: 120, field: 'answer.itemId' }) || null,
    questionId,
    optionId: cleanLine(answer?.optionId, { max: 120, field: 'answer.optionId' }) || null,
    text: cleanLine(answer?.text, { max: 2000, field: 'answer.text' }) || null,
    at: nowIso(now),
    inputRevision: next.input.inputRevision,
  })
  next.state = 'editing'
  next.updatedAt = nowIso(now)
  if (root) return saveSession({ root, session: next })
  return normalizeSession(next)
}

/** Store human edits as `item.fields[field] = { value, source: 'human' }`. */
export function setEdits({ root, session, edits, now } = {}) {
  if (!session) throw intentError('invalid-request', 'setEdits 需要 session')
  assertMutable(session)
  const next = clone(session)
  const list = Array.isArray(edits) ? edits : edits && typeof edits === 'object' ? [edits] : []
  if (list.length === 0) throw intentError('invalid-request', 'setEdits 需要至少一个编辑')
  for (const edit of list) {
    const itemId = cleanLine(edit?.itemId, { max: 120, field: 'edit.itemId' })
    const field = cleanLine(edit?.field, { max: 120, field: 'edit.field' })
    if (itemId === '' || field === '') throw intentError('invalid-request', '编辑需要 itemId 与 field')
    const item = next.items.find((entry) => entry.itemId === itemId)
    if (!item) throw intentError('invalid-request', `未知条目：${itemId}`)
    item.fields = item.fields && typeof item.fields === 'object' ? item.fields : {}
    item.fields[field] = { value: edit.value ?? null, source: 'human', at: nowIso(now) }
  }
  next.updatedAt = nowIso(now)
  if (root) return saveSession({ root, session: next })
  return normalizeSession(next)
}

export function cancelSession({ root, session, reason, now } = {}) {
  if (!session) throw intentError('invalid-request', 'cancelSession 需要 session')
  assertMutable(session)
  const next = clone(session)
  next.state = 'cancelled'
  next.cancel = { reason: cleanLine(reason, { max: 500, field: 'reason' }) || null, at: nowIso(now) }
  next.updatedAt = nowIso(now)
  if (root) return saveSession({ root, session: next })
  return normalizeSession(next)
}

/** Attach a freshly built context snapshot (no disk by itself). */
export function attachContext({ session, context } = {}) {
  if (!session) throw intentError('invalid-request', 'attachContext 需要 session')
  if (!context || typeof context.contextSnapshotId !== 'string') {
    throw intentError('invalid-request', 'context 需要 contextSnapshotId')
  }
  const next = clone(session)
  next.context = context
  return next
}

/**
 * Record one model run. `analysis` is optional: a failed/timed-out run is
 * recorded without touching items, so the UI can show "分析失败" honestly.
 */
export function recordAnalysis({
  root,
  session,
  analysis,
  context,
  model,
  runId,
  inputRevision,
  startedAt,
  finishedAt,
  status,
  errorCode,
  now,
} = {}) {
  if (!session) throw intentError('invalid-request', 'recordAnalysis 需要 session')
  assertMutable(session)
  const revision = inputRevision ?? session.input.inputRevision
  if (revision !== session.input.inputRevision) {
    throw intentError(
      'stale-input',
      `分析结果针对输入版本 ${revision}，当前已是 ${session.input.inputRevision}；迟到结果不能覆盖新输入`,
      { expected: session.input.inputRevision, received: revision },
    )
  }
  let next = clone(session)
  if (context) next = attachContext({ session: next, context })
  const at = nowIso(now)
  const run = {
    analysisRunId: cleanLine(runId, { max: 120, field: 'runId' }) || newEntityId('RUN', now),
    startedAt: startedAt ?? at,
    finishedAt: finishedAt ?? at,
    status: status ?? (analysis ? 'success' : 'error'),
    provider: cleanLine(model?.provider, { max: 120, field: 'model.provider' }) || null,
    model: cleanLine(model?.model, { max: 120, field: 'model.model' }) || null,
  }
  if (errorCode) run.errorCode = cleanLine(errorCode, { max: 80, field: 'errorCode' })
  next.runs.push(run)
  if (analysis) {
    next = applyAnalysis({ session: next, analysis, model, runId: run.analysisRunId, inputRevision: revision, now })
  } else {
    next.updatedAt = at
    if (status === 'error' || status === 'timeout') {
      next.error = { code: errorCode ?? 'ai-failed', message: 'AI 分析未完成', at }
    }
  }
  if (root) return saveSession({ root, session: next })
  return normalizeSession(next)
}

/** Build a fallback context snapshot when the caller did not provide one. */
export function contextOrDefault(session) {
  return session.context ?? emptyContext(session.project?.id)
}

export function routeOfSession(session) {
  if (session.confirmation?.route && ROUTES.includes(session.confirmation.route)) return session.confirmation.route
  const item = (session.items ?? []).find((entry) => entry.excluded !== true)
  return item?.recommendedRoute && ROUTES.includes(item.recommendedRoute) ? item.recommendedRoute : null
}

export { ANALYSIS_SCHEMA, INTENT_SCHEMA, INTENT_SCHEMA_VERSION }
