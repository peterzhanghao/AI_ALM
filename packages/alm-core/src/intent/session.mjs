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

import { applyAnalysis, normalizeDocDraft } from './analysis.mjs'
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
  normalizeStringList,
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
const MAX_ANSWERS_PER_BATCH = 3
const MAX_GROUP_QUESTIONS = 12
const QUESTION_STATUSES = ['open', 'answered', 'stale']
const TIMING_KEYS = ['totalMs', 'contextMs', 'modelMs', 'firstTokenMs', 'parseMs', 'persistMs', 'queueMs', 'calls', 'retries']
const DEFAULT_ANSWER_SUBMISSION_BUDGET = 3
/** Draft schema is owned by requirements/doc.mjs; kept in sync as a string here. */
const DOC_DRAFT_SCHEMA = 'alm.requirement.doc.draft/v1'
const LOCKED_CLAUSE_KINDS = new Set(['feature', 'acceptance', 'goal', 'scope'])
const MAX_LOCKED_CLAUSES = 200

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

/** Derive the stable decision id for a question (same formula as analysis.mjs). */
function derivedDecisionId(questionId, text) {
  return `DEC-${sha256Hex(`${questionId}|${text}`).slice(0, 10)}`
}

/** Pure: bump `sessionRevision` by one (1-based; missing/invalid treated as 0). */
export function bumpSessionRevision(session) {
  const next = clone(session)
  const current = Number.isInteger(next.sessionRevision) && next.sessionRevision > 0 ? next.sessionRevision : 0
  next.sessionRevision = current + 1
  return next
}

/** Only finite, non-negative integer durations survive; unknown keys are dropped. */
function normalizeTiming(timing) {
  if (!timing || typeof timing !== 'object' || Array.isArray(timing)) return null
  const out = {}
  for (const key of TIMING_KEYS) {
    const value = timing[key]
    if (Number.isInteger(value) && value >= 0) out[key] = value
  }
  return Object.keys(out).length > 0 ? out : null
}

function normalizeStoredOptions(options) {
  if (!Array.isArray(options)) return []
  const out = []
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index]
    if (!option || typeof option !== 'object' || Array.isArray(option)) continue
    const label = cleanLine(option.label, { max: 500, field: 'option.label' })
    if (label === '') continue
    out.push({
      id: cleanLine(option.id, { max: 120, field: 'option.id' }) || `OPT-${index + 1}`,
      label,
      impact: cleanLine(option.impact, { max: 500, field: 'option.impact' }) || null,
    })
    if (out.length >= 3) break
  }
  return out
}

function normalizeStoredQuestion(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const text = cleanLine(raw.text, { max: 4000, field: 'question.text' })
  const questionId = cleanLine(raw.questionId, { max: 120, field: 'question.questionId' })
  if (text === '' || questionId === '') return null
  return {
    questionId,
    decisionId: cleanLine(raw.decisionId, { max: 120, field: 'question.decisionId' }) || derivedDecisionId(questionId, text),
    itemIds: normalizeStringList(raw.itemIds ?? [], { max: 20, maxLength: 120 }),
    text,
    whyNow: cleanLine(raw.whyNow, { max: 1000, field: 'question.whyNow' }) || null,
    impact: cleanLine(raw.impact, { max: 500, field: 'question.impact' }) || null,
    materiality: raw.materiality === 'reversible' ? 'reversible' : 'major',
    recommendedOptionId: cleanLine(raw.recommendedOptionId, { max: 120, field: 'question.recommendedOptionId' }) || null,
    options: normalizeStoredOptions(raw.options),
    allowFreeText: raw.allowFreeText !== false,
    dependsOn: normalizeStringList(raw.dependsOn ?? [], { max: 8, maxLength: 120 }),
    status: QUESTION_STATUSES.includes(raw.status) ? raw.status : 'open',
    staleReason: cleanLine(raw.staleReason, { max: 500, field: 'question.staleReason' }) || null,
    analysisRunId: cleanLine(raw.analysisRunId, { max: 120, field: 'question.analysisRunId' }) || null,
  }
}

/**
 * Normalize a stored question group. `dependsOn` keeps only references to
 * decisions that actually exist in the group (excluding self); ordering is not
 * enforced here because answered history is appended after current questions.
 */
function normalizeStoredQuestionGroup(group) {
  if (!group || typeof group !== 'object' || Array.isArray(group)) return null
  const questions = (Array.isArray(group.questions) ? group.questions : []).map(normalizeStoredQuestion).filter(Boolean)
  const recommendations = (Array.isArray(group.recommendations) ? group.recommendations : [])
    .map((raw) => {
      const question = normalizeStoredQuestion(raw)
      if (!question) return null
      return { ...question, status: raw?.status === 'answered' ? 'answered' : 'suggested' }
    })
    .filter(Boolean)
  const decisionIds = new Set(questions.map((question) => question.decisionId))
  for (const question of questions) {
    question.dependsOn = question.dependsOn.filter((id) => id !== question.decisionId && decisionIds.has(id))
  }
  return {
    groupId:
      cleanLine(group.groupId, { max: 120, field: 'questionGroup.groupId' }) ||
      `QG-${sha256Hex(questions.map((question) => question.decisionId).join('|')).slice(0, 10)}`,
    analysisRunId: cleanLine(group.analysisRunId, { max: 120, field: 'questionGroup.analysisRunId' }) || null,
    createdAt: cleanLine(group.createdAt, { max: 40, field: 'questionGroup.createdAt' }) || null,
    updatedAt: cleanLine(group.updatedAt, { max: 40, field: 'questionGroup.updatedAt' }) || null,
    questions,
    recommendations,
  }
}

function normalizeStoredAnswer(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const answerId = cleanLine(raw.answerId, { max: 120, field: 'answer.answerId' }) || null
  const questionId = cleanLine(raw.questionId, { max: 120, field: 'answer.questionId' }) || null
  if (answerId === null && questionId === null) return null
  return {
    answerId,
    itemId: cleanLine(raw.itemId, { max: 120, field: 'answer.itemId' }) || null,
    questionId,
    decisionId: cleanLine(raw.decisionId, { max: 120, field: 'answer.decisionId' }) || null,
    optionId: cleanLine(raw.optionId, { max: 120, field: 'answer.optionId' }) || null,
    optionLabel: cleanLine(raw.optionLabel, { max: 500, field: 'answer.optionLabel' }) || null,
    text: cleanLine(raw.text, { max: 2000, field: 'answer.text' }) || null,
    questionText: cleanLine(raw.questionText, { max: 4000, field: 'answer.questionText' }) || null,
    options: raw.options === undefined ? null : normalizeStoredOptions(raw.options),
    at: cleanLine(raw.at, { max: 40, field: 'answer.at' }) || null,
    inputRevision: Number.isInteger(raw.inputRevision) ? raw.inputRevision : null,
    sessionRevision: Number.isInteger(raw.sessionRevision) ? raw.sessionRevision : null,
    supersededBy: cleanLine(raw.supersededBy, { max: 120, field: 'answer.supersededBy' }) || null,
    supersededAt: cleanLine(raw.supersededAt, { max: 40, field: 'answer.supersededAt' }) || null,
  }
}

/** Derive the legacy-shaped `nextQuestion` from the question group. */
function nextQuestionFromGroup(group) {
  const questions = group?.questions ?? []
  const question = questions.find((entry) => entry.status === 'open') ?? questions.find((entry) => entry.status === 'stale') ?? null
  if (!question) return null
  return {
    questionId: question.questionId,
    itemIds: [...question.itemIds],
    text: question.text,
    whyNow: question.whyNow,
    options: clone(question.options),
    allowFreeText: question.allowFreeText,
  }
}

/** Progress counters for the review UI: "待决定 N / 已处理 M / 待重新核对 S". */
export function questionProgress(session) {
  const questions = session?.questionGroup?.questions ?? []
  const progress = { total: questions.length, open: 0, answered: 0, stale: 0, pending: 0 }
  for (const question of questions) {
    if (question.status === 'answered') progress.answered += 1
    else if (question.status === 'stale') progress.stale += 1
    else progress.open += 1
  }
  progress.pending = progress.open + progress.stale
  return progress
}

function normalizeConvergence(raw, questionGroup = null) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const nonNegative = (value) => (Number.isInteger(value) && value >= 0 ? value : 0)
  const seenDecisionIds = normalizeStringList(source.seenDecisionIds ?? [], { max: 200, maxLength: 120 })
  const resolvedDecisionIds = normalizeStringList(source.resolvedDecisionIds ?? [], { max: 200, maxLength: 120 })
  const timing = {}
  for (const key of TIMING_KEYS) timing[key] = nonNegative(source.timing?.[key])
  const progress = questionProgress({ questionGroup })
  const answerSubmissions = nonNegative(source.answerSubmissions)
  return {
    answerSubmissions,
    analysisRuns: nonNegative(source.analysisRuns),
    proposedDecisions: nonNegative(source.proposedDecisions),
    newDecisions: nonNegative(source.newDecisions),
    resolvedDecisions: resolvedDecisionIds.length,
    pendingDecisions: progress.pending,
    recommendedDefaults: Array.isArray(questionGroup?.recommendations) ? questionGroup.recommendations.length : 0,
    seenDecisionIds,
    resolvedDecisionIds,
    timing,
    budget: {
      maxAnswerSubmissions: DEFAULT_ANSWER_SUBMISSION_BUDGET,
      remainingAnswerSubmissions: Math.max(0, DEFAULT_ANSWER_SUBMISSION_BUDGET - answerSubmissions),
      exhausted: answerSubmissions >= DEFAULT_ANSWER_SUBMISSION_BUDGET,
    },
  }
}

function activeAnswerFor(answers, questionId, inputRevision) {
  for (let index = answers.length - 1; index >= 0; index -= 1) {
    const answer = answers[index]
    if (answer?.questionId === questionId && answer.inputRevision === inputRevision && (answer.supersededBy === undefined || answer.supersededBy === null)) {
      return answer
    }
  }
  return null
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

/**
 * A stored draft is trusted to be structurally complete but re-normalized so a
 * hand-edited or forward-versioned session file cannot crash rendering.
 */
function normalizeStoredDocDraft(draft) {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) return null
  const out = clone(draft)
  out.schema = DOC_DRAFT_SCHEMA
  out.docHash = cleanLine(out.docHash, { max: 120, field: 'docDraft.docHash' }) || null
  out.draftRevision = Number.isInteger(out.draftRevision) && out.draftRevision > 0 ? out.draftRevision : 1
  out.basedOnInputRevision = Number.isInteger(out.basedOnInputRevision) ? out.basedOnInputRevision : null
  out.basedOnSessionRevision = Number.isInteger(out.basedOnSessionRevision) ? out.basedOnSessionRevision : null
  out.goal = typeof out.goal === 'string' ? out.goal : ''
  out.problem = typeof out.problem === 'string' ? out.problem : ''
  out.features = Array.isArray(out.features) ? out.features : []
  out.scope = Array.isArray(out.scope) ? out.scope : []
  out.outOfScope = Array.isArray(out.outOfScope) ? out.outOfScope : []
  out.acceptance = Array.isArray(out.acceptance) ? out.acceptance : []
  out.constraints = Array.isArray(out.constraints) ? out.constraints : []
  out.pending = Array.isArray(out.pending) ? out.pending : []
  out.meta = out.meta && typeof out.meta === 'object' && !Array.isArray(out.meta)
    ? out.meta
    : { nextFr: 1, nextAc: 1, confirmedAt: null }
  out.legacy = out.legacy === true
  return out
}

function normalizeLockedClauses(value) {
  if (!Array.isArray(value)) return []
  const out = []
  const seen = new Set()
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const kind = LOCKED_CLAUSE_KINDS.has(entry.kind) ? entry.kind : null
    if (kind === null) continue
    const id = cleanLine(entry.id, { max: 20, field: 'lockedClauses.id' }) || null
    const key = `${kind}:${id ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ kind, id })
    if (out.length >= MAX_LOCKED_CLAUSES) break
  }
  return out
}

function normalizeClauseRefs(value) {
  if (!Array.isArray(value)) throw intentError('invalid-request', 'clauses 必须是数组', { path: 'clauses' })
  const normalized = normalizeLockedClauses(value)
  if (normalized.length === 0) throw intentError('invalid-request', 'clauses 需要至少一个有效条款引用', { path: 'clauses' })
  return normalized
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
  out.sessionRevision = Number.isInteger(out.sessionRevision) && out.sessionRevision > 0 ? out.sessionRevision : 1
  out.questionGroup = normalizeStoredQuestionGroup(out.questionGroup)
  out.convergence = normalizeConvergence(out.convergence, out.questionGroup)
  out.docDraft = normalizeStoredDocDraft(out.docDraft)
  out.draftRevision = Number.isInteger(out.draftRevision) && out.draftRevision >= 0
    ? out.draftRevision
    : out.docDraft?.draftRevision ?? 0
  if (out.docDraft && out.draftRevision > out.docDraft.draftRevision) out.docDraft.draftRevision = out.draftRevision
  out.lockedClauses = normalizeLockedClauses(out.lockedClauses)
  out.answers = Array.isArray(out.answers) ? out.answers.map(normalizeStoredAnswer).filter(Boolean) : []
  out.runs = Array.isArray(out.runs) ? out.runs : []
  out.items = Array.isArray(out.items) ? out.items : []
  out.artifacts = Array.isArray(out.artifacts) ? out.artifacts : []
  out.context = out.context && typeof out.context === 'object' ? out.context : emptyContext(out.project?.id)
  // The legacy single-question view is always derived from the group once one
  // exists; old sessions (questionGroup === null) keep their stored value.
  out.nextQuestion = out.questionGroup ? nextQuestionFromGroup(out.questionGroup) : (out.nextQuestion ?? null)
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
    sessionRevision: 1,
    questionGroup: null,
    docDraft: null,
    draftRevision: 0,
    lockedClauses: [],
    convergence: normalizeConvergence(null),
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
  next.questionGroup = null
  next.docDraft = null
  next.answerAnalysisRequired = false
  next.analysisRetryRequired = false
  next.draftRevision = 0
  next.lockedClauses = []
  next.convergence = normalizeConvergence(null)
  next.confirmation = null
  next.artifacts = []
  next.receipt = null
  next.error = null
  next.state = 'editing'
  next.sessionRevision = (Number.isInteger(session.sessionRevision) && session.sessionRevision > 0 ? session.sessionRevision : 1) + 1
  next.updatedAt = nowIso(now)
  if (root) return saveSession({ root, session: next })
  return normalizeSession(next)
}

/**
 * Record 1..3 answers atomically.
 *
 * - Idempotent: an identical `{optionId,text}` for the active answer changes
 *   nothing and does not bump `sessionRevision`.
 * - Re-answering keeps the previous record and marks it `supersededBy`.
 * - When a question group exists, changing a decision marks answered
 *   dependents `stale` (answers are kept, they just stop counting as resolved).
 * - Sessions without a question group keep the old single-question semantics.
 */
export function recordAnswers({ root, session, answers, expectedSessionRevision, now } = {}) {
  if (!session) throw intentError('invalid-request', 'recordAnswers 需要 session')
  assertMutable(session)
  const batch = Array.isArray(answers) ? answers : []
  if (batch.length === 0 || batch.length > MAX_ANSWERS_PER_BATCH) {
    throw intentError('invalid-request', `answers 需要 1-${MAX_ANSWERS_PER_BATCH} 条回答`, { count: batch.length })
  }
  if (expectedSessionRevision !== undefined && expectedSessionRevision !== null) {
    const expected = Number(expectedSessionRevision)
    const current = session.sessionRevision ?? 1
    if (!Number.isInteger(expected) || expected !== current) {
      throw intentError(
        'stale-session',
        `会话决定已更新（当前版本 ${current}，请求版本 ${expected}），请刷新后重试`,
        { expected: current, received: Number.isFinite(expected) ? expected : null },
      )
    }
  }
  const group = session.questionGroup ?? null
  const normalized = []
  const seen = new Set()
  for (let index = 0; index < batch.length; index += 1) {
    const raw = batch[index]
    const questionId = cleanLine(raw?.questionId, { max: 120, field: `answers[${index}].questionId` })
    if (questionId === '') throw intentError('invalid-request', `answers[${index}].questionId 不能为空`)
    if (seen.has(questionId)) throw intentError('invalid-request', `answers 中问题 ${questionId} 重复`)
    seen.add(questionId)
    const optionId = cleanLine(raw?.optionId, { max: 120, field: `answers[${index}].optionId` }) || null
    const text = cleanLine(raw?.text, { max: 2000, field: `answers[${index}].text` }) || null
    if (optionId === null && text === null) {
      throw intentError('invalid-request', `answers[${index}] 需要 optionId 或 text`)
    }
    let question = null
    if (group) {
      question =
        group.questions.find((entry) => entry.questionId === questionId) ??
        (group.recommendations ?? []).find((entry) => entry.questionId === questionId) ??
        null
      if (!question) {
        throw intentError('answer-not-in-group', `问题 ${questionId} 不在当前问题组中，请刷新后重试`, {
          questionId,
          groupId: group.groupId ?? null,
        })
      }
      if (optionId !== null && !question.options.some((option) => option.id === optionId)) {
        throw intentError('invalid-request', `选项 ${optionId} 不在问题 ${questionId} 的选项中`, { questionId, optionId })
      }
    } else if (session.nextQuestion?.questionId === questionId) {
      // Legacy single-question session: snapshot the question shown at the time.
      question = {
        questionId,
        decisionId: null,
        text: session.nextQuestion.text ?? null,
        options: Array.isArray(session.nextQuestion.options) ? session.nextQuestion.options : [],
      }
    }
    normalized.push({ questionId, optionId, text, question })
  }

  let next = clone(session)
  next.answers = Array.isArray(next.answers) ? next.answers : []
  const saved = []
  const newAnswerIds = new Set()
  const changedQuestions = []
  for (const entry of normalized) {
    const active = activeAnswerFor(next.answers, entry.questionId, next.input?.inputRevision)
    if (active && active.optionId === entry.optionId && (active.text ?? null) === entry.text) continue
    const at = nowIso(now)
    const answerId = newEntityId('ANS', now)
    if (active) {
      active.supersededBy = answerId
      active.supersededAt = at
    }
    const question = entry.question
    const option = entry.optionId ? (question?.options ?? []).find((candidate) => candidate.id === entry.optionId) ?? null : null
    next.answers.push({
      answerId,
      itemId: null,
      questionId: entry.questionId,
      decisionId: question?.decisionId ?? null,
      optionId: entry.optionId,
      optionLabel: option?.label ?? null,
      text: entry.text,
      questionText: question?.text ?? null,
      options: question ? clone(question.options ?? []) : null,
      at,
      inputRevision: next.input?.inputRevision ?? 1,
      sessionRevision: null,
      supersededBy: null,
      supersededAt: null,
    })
    saved.push({ questionId: entry.questionId, answerId })
    newAnswerIds.add(answerId)
    changedQuestions.push({ questionId: entry.questionId, decisionId: question?.decisionId ?? null })
  }

  if (saved.length === 0) {
    return { session: normalizeSession(session), changed: false, saved: [], stale: [], progress: questionProgress(session) }
  }

  next.sessionRevision = (Number.isInteger(session.sessionRevision) && session.sessionRevision > 0 ? session.sessionRevision : 1) + 1
  next.answerAnalysisRequired = true
  next.convergence = normalizeConvergence(next.convergence, next.questionGroup)
  const blockingSubmission = changedQuestions.some(({ questionId }) => group?.questions?.some((question) => question.questionId === questionId))
  if (blockingSubmission || !group) next.convergence.answerSubmissions += 1
  next.convergence.budget.remainingAnswerSubmissions = Math.max(
    0,
    next.convergence.budget.maxAnswerSubmissions - next.convergence.answerSubmissions,
  )
  next.convergence.budget.exhausted = next.convergence.answerSubmissions >= next.convergence.budget.maxAnswerSubmissions
  for (const answer of next.answers) {
    if (newAnswerIds.has(answer.answerId)) answer.sessionRevision = next.sessionRevision
  }

  const stale = []
  if (group) {
    const changedIds = new Set(changedQuestions.map((entry) => entry.questionId))
    const changedDecisionIds = new Set(changedQuestions.map((entry) => entry.decisionId).filter(Boolean))
    for (const question of group.questions) {
      if (changedIds.has(question.questionId)) {
        question.status = 'answered'
        question.staleReason = null
      }
    }
    for (const recommendation of group.recommendations ?? []) {
      if (changedIds.has(recommendation.questionId)) {
        recommendation.status = 'answered'
        recommendation.staleReason = null
      }
    }
    for (const question of group.questions) {
      if (changedIds.has(question.questionId)) continue
      if (question.status !== 'answered') continue
      const dependency = (question.dependsOn ?? []).find((decisionId) => changedDecisionIds.has(decisionId))
      if (!dependency) continue
      question.status = 'stale'
      question.staleReason = `依赖的决定 ${dependency} 已更改，需重新核对`
      stale.push(question.decisionId)
    }
    group.updatedAt = nowIso(now)
    next.questionGroup = group
    next.nextQuestion = nextQuestionFromGroup(group)
    const questions = group.questions
    const resolved = questions.every((question) => question.status === 'answered')
    next.state = resolved ? 'ready_for_confirmation' : 'needs_input'
  } else {
    next.state = 'editing'
  }
  const resolvedIds = new Set(next.convergence.resolvedDecisionIds)
  for (const question of next.questionGroup?.questions ?? []) {
    if (question.status === 'answered') resolvedIds.add(question.decisionId)
    else resolvedIds.delete(question.decisionId)
  }
  next.convergence.resolvedDecisionIds = [...resolvedIds]
  next.convergence.resolvedDecisions = next.convergence.resolvedDecisionIds.length
  next.convergence.pendingDecisions = questionProgress(next).pending
  // An answer invalidates the draft: the next analysis must fold the decision
  // in, so the old draft text may not be confirmed any more.
  if (next.docDraft) {
    next.draftRevision = (Number.isInteger(next.docDraft.draftRevision) ? next.docDraft.draftRevision : 0) + 1
    next.docDraft.draftRevision = next.draftRevision
  }
  next.updatedAt = nowIso(now)

  const result = root ? saveSession({ root, session: next }) : normalizeSession(next)
  return { session: result, changed: true, saved, stale, progress: questionProgress(result) }
}

/** Backward-compatible wrapper: record one answer and return the session. */
export function recordAnswer({ root, session, answer, now } = {}) {
  if (!session) throw intentError('invalid-request', 'recordAnswer 需要 session')
  const result = recordAnswers({ root, session, answers: answer ? [answer] : [], now })
  return result.session
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
  next.sessionRevision = (Number.isInteger(session.sessionRevision) && session.sessionRevision > 0 ? session.sessionRevision : 1) + 1
  next.updatedAt = nowIso(now)
  if (root) return saveSession({ root, session: next })
  return normalizeSession(next)
}

const DOC_DRAFT_PATCH_KEYS = ['title', 'goal', 'problem', 'features', 'scope', 'outOfScope', 'acceptance', 'constraints', 'pending']

/**
 * Apply a human edit to the requirement draft. `patch` (default) shallow-merges
 * the supplied fields over the current draft (arrays replace wholesale), then
 * normalizes + re-hashes and bumps `draftRevision` and `sessionRevision`.
 * Human edits are never reverted by locks (a lock only protects against the
 * model), so the lock list is not enforced here.
 */
export function setDocDraft({ root, session, docDraft, patch = true, now } = {}) {
  if (!session) throw intentError('invalid-request', 'setDocDraft 需要 session')
  assertMutable(session)
  if (!docDraft || typeof docDraft !== 'object' || Array.isArray(docDraft)) {
    throw intentError('invalid-request', 'docDraft 必须是对象', { path: 'docDraft' })
  }
  const current = normalizeStoredDocDraft(session.docDraft)
  let merged = {}
  if (patch !== false && current) {
    merged = clone(current)
    for (const key of DOC_DRAFT_PATCH_KEYS) {
      if (docDraft[key] !== undefined) merged[key] = clone(docDraft[key])
    }
  } else {
    for (const key of DOC_DRAFT_PATCH_KEYS) {
      if (docDraft[key] !== undefined) merged[key] = clone(docDraft[key])
    }
  }
  const nextRevision = (Number.isInteger(session.draftRevision) ? session.draftRevision : 0) + 1
  const draft = normalizeDocDraft(merged, {
    previous: current,
    warnings: [],
    lockedClauses: [],
    requirementId: session.project?.requirementId ?? null,
    inputRevision: session.input?.inputRevision ?? null,
    sessionRevision: Number.isInteger(session.sessionRevision) ? session.sessionRevision : 1,
    draftRevision: nextRevision,
    legacy: false,
  })
  const next = clone(session)
  next.docDraft = draft
  next.draftRevision = draft.draftRevision
  next.sessionRevision = bumpSessionRevision(session).sessionRevision
  next.updatedAt = nowIso(now)
  const result = root ? saveSession({ root, session: next }) : normalizeSession(next)
  return result
}

/** Lock clauses so a later analysis may not overwrite them. Idempotent. */
export function lockClauses({ root, session, clauses, now } = {}) {
  if (!session) throw intentError('invalid-request', 'lockClauses 需要 session')
  assertMutable(session)
  const incoming = normalizeClauseRefs(clauses)
  const current = normalizeLockedClauses(session.lockedClauses)
  const existing = new Set(current.map((entry) => `${entry.kind}:${entry.id ?? ''}`))
  const added = incoming.filter((entry) => !existing.has(`${entry.kind}:${entry.id ?? ''}`))
  if (added.length === 0) return session
  const next = clone(session)
  next.lockedClauses = [...current, ...added]
  next.sessionRevision = bumpSessionRevision(session).sessionRevision
  next.updatedAt = nowIso(now)
  const result = root ? saveSession({ root, session: next }) : normalizeSession(next)
  return result
}

/** Unlock clauses previously locked by a human. Idempotent. */
export function unlockClauses({ root, session, clauses, now } = {}) {
  if (!session) throw intentError('invalid-request', 'unlockClauses 需要 session')
  assertMutable(session)
  const incoming = normalizeClauseRefs(clauses)
  const remove = new Set(incoming.map((entry) => `${entry.kind}:${entry.id ?? ''}`))
  const current = normalizeLockedClauses(session.lockedClauses)
  const kept = current.filter((entry) => !remove.has(`${entry.kind}:${entry.id ?? ''}`))
  if (kept.length === current.length) return session
  const next = clone(session)
  next.lockedClauses = kept
  next.sessionRevision = bumpSessionRevision(session).sessionRevision
  next.updatedAt = nowIso(now)
  const result = root ? saveSession({ root, session: next }) : normalizeSession(next)
  return result
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
  baseSessionRevision,
  timing,
  startedAt,
  finishedAt,
  status,
  errorCode,
  now,
} = {}) {
  if (!session) throw intentError('invalid-request', 'recordAnalysis 需要 session')
  assertMutable(session)
  if (baseSessionRevision !== undefined && baseSessionRevision !== null) {
    const expected = Number(baseSessionRevision)
    const current = session.sessionRevision ?? 1
    if (!Number.isInteger(expected) || expected !== current) {
      throw intentError(
        'stale-session',
        `分析结果基于会话版本 ${expected}，当前已是 ${current}；迟到结果不能覆盖更新的决定`,
        { expected: current, received: Number.isFinite(expected) ? expected : null },
      )
    }
  }
  const revision = inputRevision ?? session.input.inputRevision
  if (revision !== session.input.inputRevision) {
    throw intentError(
      'stale-input',
      `分析结果针对输入版本 ${revision}，当前已是 ${session.input.inputRevision}；迟到结果不能覆盖新输入`,
      { expected: session.input.inputRevision, received: revision },
    )
  }
  let next = clone(session)
  next.convergence = normalizeConvergence(next.convergence, next.questionGroup)
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
  const normalizedTiming = normalizeTiming(timing)
  if (normalizedTiming) run.timing = normalizedTiming
  next.runs.push(run)
  next.convergence.analysisRuns += 1
  for (const key of TIMING_KEYS) {
    next.convergence.timing[key] += normalizedTiming?.[key] ?? 0
  }
  if (analysis) {
    next = applyAnalysis({ session: next, analysis, model, runId: run.analysisRunId, inputRevision: revision, now })
    next.answerAnalysisRequired = false
    next.analysisRetryRequired = false
    const decisionIds = (next.questionGroup?.questions ?? [])
      .concat(next.questionGroup?.recommendations ?? [])
      .map((question) => question.decisionId)
      .filter(Boolean)
    const seen = new Set(next.convergence.seenDecisionIds)
    const before = seen.size
    for (const decisionId of decisionIds) seen.add(decisionId)
    next.convergence.seenDecisionIds = [...seen]
    next.convergence.proposedDecisions += decisionIds.length
    next.convergence.newDecisions += seen.size - before
    next.convergence.pendingDecisions = questionProgress(next).pending
    next.convergence.recommendedDefaults = next.questionGroup?.recommendations?.length ?? 0
    // A successful apply changes decision state, so the session revision moves.
    next.sessionRevision = (Number.isInteger(session.sessionRevision) && session.sessionRevision > 0 ? session.sessionRevision : 1) + 1
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
