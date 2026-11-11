/**
 * Model-output normalization and application.
 *
 * The model is an untrusted suggestion source. `normalizeAnalysis` is the only
 * gate between raw model text and the session: it refuses executable fields,
 * owner/priority assignments and unknown routes, drops unknown plain fields
 * (with warnings) and verifies that every quoted source ref exists in the
 * input the user actually provided.
 */
import {
  ANALYSIS_SCHEMA,
  ANALYSIS_SCHEMA_V2,
  BLOCKING_FOR,
  MATCHES,
  RESOLUTIONS,
  ROUTES,
  UNKNOWN_KINDS,
  intentError,
} from './errors.mjs'
import { DOC_SCHEMA, docHashOf, normalizeDoc, renderDoc } from '../requirements/doc.mjs'
import {
  asString,
  canonicalJson,
  cleanLine,
  clone,
  isPlainObject,
  normalizeStringList,
  sha256Hex,
  truncateText,
} from './util.mjs'

export const ANALYSIS_SCHEMA_V3 = 'intent-review.v3'
export const DOC_DRAFT_SCHEMA = 'alm.requirement.doc.draft/v1'
const PROVENANCES = new Set(['user-stated', 'user-answer', 'human-edit', 'verified-context', 'ai-suggestion', 'unconfirmed'])
const LOCKED_KINDS = new Set(['feature', 'acceptance', 'goal', 'scope'])
const MAX_DRAFT_FEATURES = 40
const MAX_DRAFT_ACCEPTANCE = 40
const MAX_DRAFT_PENDING = 40

const TOP_KEYS = new Set(['schemaVersion', 'contextSnapshotId', 'items', 'nextQuestion', 'questions', 'docDraft'])
const ITEM_KEYS = new Set([
  'itemId',
  'sourceRefs',
  'userProblem',
  'desiredOutcome',
  'recommendedRoute',
  'summary',
  'related',
  'assumptions',
  'unknowns',
  'candidate',
  'counterexample',
  'valueCheck',
])
const CANDIDATE_KEYS = new Set([
  'title',
  'problem',
  'goal',
  'inScope',
  'outOfScope',
  'acceptance',
  'owner',
  'priority',
])
const ACCEPTANCE_KEYS = new Set(['precondition', 'action', 'expected', 'judgement', 'sourceRefs'])
const QUESTION_KEYS = new Set(['questionId', 'itemIds', 'text', 'whyNow', 'options', 'allowFreeText'])
const QUESTION_V2_KEYS = new Set([...QUESTION_KEYS, 'decisionId', 'impact', 'dependsOn', 'materiality', 'recommendedOptionId'])
const UNKNOWN_KEYS = new Set(['description', 'blocking', 'resolution', 'kind', 'blockingFor'])
const OPTION_KEYS = new Set(['id', 'label', 'impact'])
const MAX_ITEMS = 20
const MAX_OPTIONS = 3
const MAX_TEXT = 4000
const MAX_QUESTIONS = 3
const MAX_GROUP_QUESTIONS = 12

/**
 * Model-authored prose is untrusted markup: strip HTML/script/style tags and
 * record a warning. Only model prose is sanitized here — user quotes in
 * `sourceRefs.quote` stay byte-for-byte so they can be verified against input.
 */
const HTML_TAG_RE = /<\/?[a-zA-Z][^>]*>|<!--/
const HTML_BLOCK_RE = /<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi

function stripHtml(text) {
  return text
    .replace(HTML_BLOCK_RE, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/?[a-zA-Z][^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;|&gt;/gi, '')
    .replace(/&amp;/gi, '&')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

function cleanModelText(value, { max = 4000, field = 'value', path = field, warnings } = {}) {
  const raw = asString(value, max + 1)
  if (raw.trim() === '') return ''
  const text = HTML_TAG_RE.test(raw) ? stripHtml(raw) : raw
  if (text !== raw && warnings) warnings.push(`${path}: 含 HTML 标签，已剥离为纯文本（sanitized-html）`)
  return cleanLine(text, { max, field })
}

function modelStringList(value, { max = 20, maxLength = 500, path = 'list', warnings } = {}) {
  const list = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]
  const out = []
  const seen = new Set()
  for (const [index, entry] of list.entries()) {
    const text = cleanModelText(entry, {
      max: maxLength,
      field: `${path}[${index}]`,
      path: `${path}[${index}]`,
      warnings,
    })
    if (text === '' || seen.has(text)) continue
    seen.add(text)
    out.push(text)
    if (out.length >= max) break
  }
  return out
}

/**
 * A contract-valid but empty model answer must not fail the whole analysis:
 * produce a neutral stub unit that only asks the user what they expect to see.
 * It never invents a route, candidate or acceptance criteria.
 */
export function buildStubItem({ session, itemId = 'ITM-1' } = {}) {
  const original = asString(session?.input?.text, 2000).trim()
  return {
    itemId,
    sourceRefs: [],
    sourceRefsRejected: false,
    userProblem: original === '' ? null : original,
    desiredOutcome: null,
    recommendedRoute: null,
    routeRationale: '证据不足：模型没有给出符合契约的意图条目，无法判断是新建、变更还是复用',
    related: [],
    assumptions: [],
    unknowns: [{ description: '需要澄清：用户期望看到的具体行为是什么', blocking: true, resolution: 'pending' }],
    candidate: null,
    counterexample: { scenario: null, status: 'unverified' },
    valueCheck: { claim: null, smallestCheck: null, stopCondition: null, status: 'unverified' },
    fields: {},
    stub: true,
  }
}

export function buildStubQuestion(itemId = 'ITM-1') {
  return {
    questionId: 'Q-STUB-1',
    itemIds: [itemId],
    text: '期望看到的具体行为是什么？',
    whyNow: '当前输入不足以判断去向，需要先澄清期望看到的具体行为，才能决定是新建、变更还是复用。',
    options: [],
    allowFreeText: true,
  }
}

/** Fields that would let a model claim a decision instead of proposing one. */
const EXECUTABLE_KEYS = new Set([
  'apply',
  'applied',
  'execute',
  'executed',
  'approve',
  'approved',
  'approval',
  'sign',
  'signed',
  'signoff',
  'sign-off',
  'publish',
  'published',
  'status',
  'state',
  'transition',
  'idempotencykey',
  'idempotency_key',
  'receipt',
  'confirmed',
  'confirm',
  'commit',
  'committed',
  'deploy',
  'deployed',
  'merge',
  'merged',
  'release',
  'released',
  'authorize',
  'authorized',
  'grant',
  'permission',
  'role',
])
/** `status` is structural only inside these two objects. */
const STATUS_PARENTS = new Set(['counterexample', 'valueCheck'])

function walkForExecutables(value, path, parentKey) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walkForExecutables(entry, `${path}[${index}]`, parentKey))
    return
  }
  if (!isPlainObject(value)) return
  for (const [key, entry] of Object.entries(value)) {
    const lower = key.toLowerCase()
    if (EXECUTABLE_KEYS.has(lower)) {
      if (lower === 'status' && STATUS_PARENTS.has(parentKey)) {
        walkForExecutables(entry, `${path}.${key}`, key)
        continue
      }
      throw intentError(
        'executable-field',
        `模型输出包含可执行/决策字段 ${path ? `${path}.` : ''}${key}，整份结果已拒绝；模型只能提出建议`,
        { path: path ? `${path}.${key}` : key, field: key },
      )
    }
    walkForExecutables(entry, path ? `${path}.${key}` : key, key)
  }
}

function parseRaw(raw) {
  if (typeof raw === 'string') {
    let text = raw.trim()
    const fenced = /^```(?:json)?\s*([\s\S]*?)```$/i.exec(text)
    if (fenced) text = fenced[1].trim()
    if (text === '') throw intentError('ai-invalid-output', '模型输出为空')
    try {
      return JSON.parse(text)
    } catch (error) {
      throw intentError('ai-invalid-output', `模型输出不是合法 JSON：${error.message}`, {})
    }
  }
  if (raw === null || raw === undefined) throw intentError('ai-invalid-output', '模型输出为空')
  return raw
}

function normalizeSourceRef(ref, haystacks, path, warnings) {
  if (typeof ref === 'string') ref = { ref }
  if (!isPlainObject(ref)) {
    warnings.push(`${path}: 非对象 sourceRef 已丢弃`)
    return null
  }
  const target = cleanLine(ref.ref, { max: 500, field: 'sourceRef.ref' })
  if (target === '') {
    warnings.push(`${path}: 缺少 ref 的 sourceRef 已丢弃`)
    return null
  }
  const quote = asString(ref.quote, 2000).trim()
  if (quote === '') {
    warnings.push(`${path}: sourceRef ${target} 缺少原文引用，未作为事实采用`)
    return null
  }
  const normalized = quote.replace(/\s+/g, ' ')
  const found = haystacks.some((haystack) => haystack.replace(/\s+/g, ' ').includes(normalized))
  if (!found) {
    warnings.push(`${path}: sourceRef ${target} 的引用未在用户提供的输入中找到，已丢弃（不成为事实）`)
    return null
  }
  const line = Number(ref.line)
  const endLine = Number(ref.endLine)
  return {
    ref: target,
    line: Number.isInteger(line) && line > 0 ? line : null,
    endLine: Number.isInteger(endLine) && endLine > 0 ? endLine : null,
    quote,
  }
}

function normalizeRelated(entry, path, warnings) {
  if (!isPlainObject(entry)) {
    warnings.push(`${path}: 非对象 related 已丢弃`)
    return null
  }
  const uid = cleanLine(entry.uid, { max: 120, field: 'related.uid' })
  if (uid === '') {
    warnings.push(`${path}: 缺少 uid 的 related 已丢弃`)
    return null
  }
  const match = cleanLine(entry.match, { max: 20, field: 'related.match' }) || 'related'
  if (!MATCHES.includes(match)) {
    throw intentError('invalid-analysis', `${path}: 未知 related.match ${match}`, { path, value: match })
  }
  const revision = Number(entry.revision)
  return {
    uid,
    revision: Number.isInteger(revision) && revision > 0 ? revision : null,
    match,
    reason: cleanModelText(entry.reason, { max: 500, field: 'related.reason', path: `${path}.reason`, warnings }) || null,
  }
}

function normalizeUnknown(entry, path, warnings) {
  if (!isPlainObject(entry)) {
    warnings.push(`${path}: 非对象 unknown 已丢弃`)
    return null
  }
  for (const key of Object.keys(entry)) {
    if (!UNKNOWN_KEYS.has(key)) warnings.push(`${path}.${key}: 未知字段已丢弃`)
  }
  const description = cleanModelText(entry.description, { max: 500, field: 'unknown.description', path: `${path}.description`, warnings })
  if (description === '') {
    warnings.push(`${path}: 缺少 description 的 unknown 已丢弃`)
    return null
  }
  const resolution = cleanLine(entry.resolution, { max: 20, field: 'unknown.resolution' }) || 'pending'
  if (!RESOLUTIONS.includes(resolution)) {
    warnings.push(`${path}: 未知 resolution ${resolution}，已按 pending 处理`)
  }
  const kind = cleanLine(entry.kind, { max: 40, field: 'unknown.kind' }) || null
  if (kind !== null && !UNKNOWN_KINDS.includes(kind)) {
    warnings.push(`${path}: 未知 kind ${kind}，已忽略（允许 ${UNKNOWN_KINDS.join('/')}）`)
  }
  const blockingFor = cleanLine(entry.blockingFor, { max: 20, field: 'unknown.blockingFor' }) || 'confirmation'
  if (!BLOCKING_FOR.includes(blockingFor)) {
    warnings.push(`${path}: 未知 blockingFor ${blockingFor}，已按 confirmation 处理`)
  }
  return {
    description,
    blocking: entry.blocking === true,
    resolution: RESOLUTIONS.includes(resolution) ? resolution : 'pending',
    kind: kind !== null && UNKNOWN_KINDS.includes(kind) ? kind : null,
    blockingFor: BLOCKING_FOR.includes(blockingFor) ? blockingFor : 'confirmation',
  }
}

function normalizeAcceptance(entry, path, haystacks, warnings) {
  if (!isPlainObject(entry)) {
    warnings.push(`${path}: 非对象验收条目已丢弃`)
    return null
  }
  for (const key of Object.keys(entry)) {
    if (!ACCEPTANCE_KEYS.has(key)) warnings.push(`${path}.${key}: 未知字段已丢弃`)
  }
  const action = cleanModelText(entry.action, { max: 1000, field: 'acceptance.action', path: `${path}.action`, warnings })
  const expected = cleanModelText(entry.expected, { max: 1000, field: 'acceptance.expected', path: `${path}.expected`, warnings })
  if (action === '' && expected === '') {
    warnings.push(`${path}: 验收条目缺少 action/expected，已丢弃`)
    return null
  }
  const refs = (Array.isArray(entry.sourceRefs) ? entry.sourceRefs : [])
    .map((ref, index) => normalizeSourceRef(ref, haystacks, `${path}.sourceRefs[${index}]`, warnings))
    .filter(Boolean)
  return {
    precondition: cleanModelText(entry.precondition, { max: 1000, field: 'acceptance.precondition', path: `${path}.precondition`, warnings }) || null,
    action,
    expected,
    judgement: cleanModelText(entry.judgement, { max: 1000, field: 'acceptance.judgement', path: `${path}.judgement`, warnings }) || null,
    sourceRefs: refs,
  }
}

function normalizeCandidate(candidate, path, haystacks, warnings) {
  if (candidate === null || candidate === undefined) return null
  if (!isPlainObject(candidate)) {
    warnings.push(`${path}: candidate 必须是对象或 null，已丢弃`)
    return null
  }
  for (const [key, value] of Object.entries(candidate)) {
    if (!CANDIDATE_KEYS.has(key)) warnings.push(`${path}.${key}: 未知字段已丢弃`)
    if (key === 'owner' && value !== null && value !== undefined && String(value).trim() !== '') {
      throw intentError('model-assigned-owner', '候选草稿的负责人必须为 null：模型不得指派负责人，需等待人工明确', {
        path: `${path}.owner`,
        value,
      })
    }
    if (key === 'priority' && value !== null && value !== undefined && String(value).trim() !== '') {
      throw intentError('model-assigned-priority', '候选草稿的优先级必须为 null：模型不得猜优先级，需等待人工选择', {
        path: `${path}.priority`,
        value,
      })
    }
  }
  const acceptance = (Array.isArray(candidate.acceptance) ? candidate.acceptance : [])
    .map((entry, index) => normalizeAcceptance(entry, `${path}.acceptance[${index}]`, haystacks, warnings))
    .filter(Boolean)
  return {
    title: cleanModelText(candidate.title, { max: 200, field: 'candidate.title', path: `${path}.title`, warnings }) || null,
    problem: cleanModelText(candidate.problem, { max: 2000, field: 'candidate.problem', path: `${path}.problem`, warnings }) || null,
    goal: cleanModelText(candidate.goal, { max: 2000, field: 'candidate.goal', path: `${path}.goal`, warnings }) || null,
    inScope: modelStringList(candidate.inScope, { max: 20, maxLength: 500, path: `${path}.inScope`, warnings }),
    outOfScope: modelStringList(candidate.outOfScope, { max: 20, maxLength: 500, path: `${path}.outOfScope`, warnings }),
    acceptance,
    owner: null,
    priority: null,
  }
}

function normalizeQuestion(question, existingItems, warnings) {
  if (question === null || question === undefined) return null
  if (!isPlainObject(question)) {
    warnings.push('nextQuestion: 必须是对象或 null，已丢弃')
    return null
  }
  for (const key of Object.keys(question)) {
    if (!QUESTION_KEYS.has(key)) warnings.push(`nextQuestion.${key}: 未知字段已丢弃`)
  }
  const text = cleanModelText(question.text, { max: 1000, field: 'nextQuestion.text', path: 'nextQuestion.text', warnings })
  if (text === '') {
    warnings.push('nextQuestion 缺少 text，已丢弃')
    return null
  }
  const allowFreeText = question.allowFreeText !== false
  const rawOptions = Array.isArray(question.options) ? question.options : []
  if (rawOptions.length > MAX_OPTIONS) warnings.push(`nextQuestion.options 超过 ${MAX_OPTIONS} 项，已截断`)
  const options = []
  rawOptions.slice(0, MAX_OPTIONS).forEach((option, index) => {
    if (!isPlainObject(option)) {
      warnings.push(`nextQuestion.options[${index}]: 非对象已丢弃`)
      return
    }
    for (const key of Object.keys(option)) {
      if (!OPTION_KEYS.has(key)) warnings.push(`nextQuestion.options[${index}].${key}: 未知字段已丢弃`)
    }
    const label = cleanModelText(option.label, { max: 200, field: 'option.label', path: `nextQuestion.options[${index}].label`, warnings })
    if (label === '') {
      warnings.push(`nextQuestion.options[${index}]: 缺少 label 已丢弃`)
      return
    }
    options.push({
      id: cleanLine(option.id, { max: 80, field: 'option.id' }) || `OPT-${index + 1}`,
      label,
      impact: cleanModelText(option.impact, { max: 500, field: 'option.impact', path: `nextQuestion.options[${index}].impact`, warnings }) || null,
    })
  })
  if (options.length === 0 && !allowFreeText) {
    warnings.push('nextQuestion 没有选项且不允许自由回答，已丢弃')
    return null
  }
  const itemIds = (Array.isArray(question.itemIds) ? question.itemIds : [])
    .map((itemId) => cleanLine(itemId, { max: 120, field: 'nextQuestion.itemIds' }))
    .filter((itemId) => itemId !== '' && existingItems.has(itemId))
  if (itemIds.length === 0) {
    for (const itemId of existingItems) itemIds.push(itemId)
  }
  return {
    questionId: cleanLine(question.questionId, { max: 120, field: 'questionId' }) || `Q-${sha256Hex(text).slice(0, 12)}`,
    itemIds,
    text,
    whyNow: cleanModelText(question.whyNow, { max: 1000, field: 'nextQuestion.whyNow', path: 'nextQuestion.whyNow', warnings }) || null,
    options,
    allowFreeText,
  }
}

function isoNow(now) {
  return now ? new Date(now).toISOString() : new Date().toISOString()
}

function derivedDecisionId(questionId, text) {
  return `DEC-${sha256Hex(`${questionId}|${text}`).slice(0, 10)}`
}

/** Project a v2 question into the legacy single-question shape. */
function legacyQuestionShape(question) {
  return {
    questionId: question.questionId,
    itemIds: [...(question.itemIds ?? [])],
    text: question.text,
    whyNow: question.whyNow ?? null,
    options: clone(question.options ?? []),
    allowFreeText: question.allowFreeText !== false,
  }
}

/** Wrap a legacy single question as a v2 question (v1 output compatibility). */
function questionFromLegacy(question) {
  if (!question) return null
  return {
    questionId: question.questionId,
    decisionId: derivedDecisionId(question.questionId, question.text),
    itemIds: [...(question.itemIds ?? [])],
    text: question.text,
    whyNow: question.whyNow ?? null,
    impact: null,
    materiality: 'major',
    recommendedOptionId: null,
    options: clone(question.options ?? []),
    allowFreeText: question.allowFreeText !== false,
    dependsOn: [],
    status: 'open',
    staleReason: null,
    analysisRunId: null,
  }
}

function normalizeQuestionV2(question, existingItems, path, warnings) {
  if (!isPlainObject(question)) {
    warnings.push(`${path}: 必须是对象，已丢弃`)
    return null
  }
  for (const key of Object.keys(question)) {
    if (!QUESTION_V2_KEYS.has(key)) warnings.push(`${path}.${key}: 未知字段已丢弃`)
  }
  const text = cleanModelText(question.text, { max: 1000, field: `${path}.text`, path: `${path}.text`, warnings })
  if (text === '') {
    warnings.push(`${path} 缺少 text，已丢弃`)
    return null
  }
  const allowFreeText = question.allowFreeText !== false
  const rawOptions = Array.isArray(question.options) ? question.options : []
  if (rawOptions.length > MAX_OPTIONS) warnings.push(`${path}.options 超过 ${MAX_OPTIONS} 项，已截断`)
  const options = []
  rawOptions.slice(0, MAX_OPTIONS).forEach((option, index) => {
    if (!isPlainObject(option)) {
      warnings.push(`${path}.options[${index}]: 非对象已丢弃`)
      return
    }
    for (const key of Object.keys(option)) {
      if (!OPTION_KEYS.has(key)) warnings.push(`${path}.options[${index}].${key}: 未知字段已丢弃`)
    }
    const label = cleanModelText(option.label, { max: 200, field: 'option.label', path: `${path}.options[${index}].label`, warnings })
    if (label === '') {
      warnings.push(`${path}.options[${index}]: 缺少 label 已丢弃`)
      return
    }
    const providedId = cleanLine(option.id, { max: 80, field: 'option.id' })
    const fallbackId = `OPT-${index + 1}`
    const id = providedId === '' || options.some((entry) => entry.id === providedId) ? fallbackId : providedId
    if (providedId !== '' && id !== providedId) warnings.push(`${path}.options[${index}].id ${providedId} 重复，已改为 ${id}`)
    options.push({
      id,
      label,
      impact: cleanModelText(option.impact, { max: 500, field: 'option.impact', path: `${path}.options[${index}].impact`, warnings }) || null,
    })
  })
  if (options.length === 0 && !allowFreeText) {
    warnings.push(`${path} 没有选项且不允许自由回答，已丢弃`)
    return null
  }
  const itemIds = (Array.isArray(question.itemIds) ? question.itemIds : [])
    .map((itemId) => cleanLine(itemId, { max: 120, field: `${path}.itemIds` }))
    .filter((itemId) => itemId !== '' && existingItems.has(itemId))
  if (itemIds.length === 0) {
    for (const itemId of existingItems) itemIds.push(itemId)
  }
  const questionId = cleanLine(question.questionId, { max: 120, field: `${path}.questionId` }) || `Q-${sha256Hex(text).slice(0, 12)}`
  const materiality = cleanLine(question.materiality, { max: 20, field: `${path}.materiality` }) || 'major'
  if (!['major', 'reversible'].includes(materiality)) {
    warnings.push(`${path}.materiality ${materiality} 未知，已按 major 处理`)
  }
  const recommendedOptionId = cleanLine(question.recommendedOptionId, { max: 80, field: `${path}.recommendedOptionId` }) || null
  if (recommendedOptionId !== null && !options.some((option) => option.id === recommendedOptionId)) {
    warnings.push(`${path}.recommendedOptionId ${recommendedOptionId} 不在 options 中，已丢弃`)
  }
  return {
    questionId,
    decisionId: cleanLine(question.decisionId, { max: 120, field: `${path}.decisionId` }) || derivedDecisionId(questionId, text),
    itemIds,
    text,
    whyNow: cleanModelText(question.whyNow, { max: 1000, field: `nextQuestion.whyNow`, path: `${path}.whyNow`, warnings }) || null,
    impact: cleanModelText(question.impact, { max: 500, field: 'question.impact', path: `${path}.impact`, warnings }) || null,
    materiality:
      materiality === 'reversible' && options.some((option) => option.id === recommendedOptionId) ? 'reversible' : 'major',
    recommendedOptionId: options.some((option) => option.id === recommendedOptionId) ? recommendedOptionId : null,
    options,
    allowFreeText,
    dependsOn: (Array.isArray(question.dependsOn) ? question.dependsOn : [])
      .map((entry) => cleanLine(entry, { max: 120, field: `${path}.dependsOn` }))
      .filter((entry) => entry !== ''),
    status: 'open',
    staleReason: null,
    analysisRunId: null,
  }
}

/**
 * Normalize the v2 `questions` array: at most 3 mutually independent questions,
 * stable decision ids, and only valid `dependsOn` references.
 */
export function normalizeQuestions(questions, existingItems, existingGroup, warnings = []) {
  const itemSet = existingItems instanceof Set ? existingItems : new Set(Array.isArray(existingItems) ? existingItems : [])
  const list = Array.isArray(questions) ? questions : []
  if (list.length > MAX_QUESTIONS) warnings.push(`questions 超过 ${MAX_QUESTIONS} 个，已截断`)
  const out = []
  const seenDecisionIds = new Set()
  const seenQuestionIds = new Set()
  const allowedDependencies = new Set(
    (existingGroup?.questions ?? [])
      .filter((question) => question?.status === 'answered')
      .map((question) => question.decisionId)
      .filter(Boolean),
  )
  list.slice(0, MAX_QUESTIONS).forEach((entry, index) => {
    const path = `questions[${index}]`
    const question = normalizeQuestionV2(entry, itemSet, path, warnings)
    if (!question) return
    if (seenDecisionIds.has(question.decisionId)) {
      warnings.push(`${path}.decisionId ${question.decisionId} 与本次输出的其它问题重复，已丢弃`)
      return
    }
    if (seenQuestionIds.has(question.questionId)) {
      warnings.push(`${path}.questionId ${question.questionId} 与本次输出的其它问题重复，已丢弃`)
      return
    }
    question.dependsOn = question.dependsOn.filter((dependency) => {
      if (dependency === question.decisionId || !allowedDependencies.has(dependency)) {
        warnings.push(`${path}.dependsOn ${dependency} 不是本次输出中更早的问题或已答决定，已删除该依赖`)
        return false
      }
      return true
    })
    out.push(question)
    seenDecisionIds.add(question.decisionId)
    seenQuestionIds.add(question.questionId)
    allowedDependencies.add(question.decisionId)
  })
  return out
}

function nextQuestionFromGroup(group) {
  const questions = group?.questions ?? []
  const question = questions.find((entry) => entry.status === 'open') ?? questions.find((entry) => entry.status === 'stale') ?? null
  return question ? legacyQuestionShape(question) : null
}

/**
 * Merge the questions from one v2 analysis into the session's question group
 * (pure). Answered/stale history is preserved by `decisionId`; current open
 * questions are replaced by the model's new wording; the group is capped at 12.
 */
export function mergeQuestionGroup({ session, questions, analysisRunId, now } = {}) {
  if (!session) throw intentError('invalid-request', 'mergeQuestionGroup 需要 session')
  const warnings = []
  const existingGroup = session.questionGroup ?? null
  const prior = existingGroup?.questions ?? []
  const priorRecommendations = existingGroup?.recommendations ?? []
  const priorByDecision = new Map()
  for (const question of prior) {
    if (question?.decisionId && !priorByDecision.has(question.decisionId)) priorByDecision.set(question.decisionId, question)
  }
  const priorRecommendationsByDecision = new Map()
  for (const recommendation of priorRecommendations) {
    if (recommendation?.decisionId && !priorRecommendationsByDecision.has(recommendation.decisionId)) {
      priorRecommendationsByDecision.set(recommendation.decisionId, recommendation)
    }
  }
  const seen = new Set()
  const current = []
  const kept = []
  const recommendations = []
  for (const question of Array.isArray(questions) ? questions : []) {
    if (!isPlainObject(question) || !question.decisionId || seen.has(question.decisionId)) continue
    seen.add(question.decisionId)
    if (question.materiality === 'reversible' && question.recommendedOptionId) {
      const previous = priorRecommendationsByDecision.get(question.decisionId)
      recommendations.push({
        ...question,
        options: clone(question.options ?? []),
        dependsOn: [...(question.dependsOn ?? [])],
        status: previous?.status === 'answered' ? 'answered' : 'suggested',
        analysisRunId: analysisRunId ?? question.analysisRunId ?? null,
      })
      continue
    }
    const previous = priorByDecision.get(question.decisionId)
    if (previous && (previous.status === 'answered' || previous.status === 'stale')) {
      kept.push({ ...previous, options: clone(previous.options ?? []), dependsOn: [...(previous.dependsOn ?? [])] })
      continue
    }
    current.push({
      ...question,
      options: clone(question.options ?? []),
      dependsOn: [...(question.dependsOn ?? [])],
      status: 'open',
      staleReason: null,
      analysisRunId: analysisRunId ?? question.analysisRunId ?? null,
    })
  }
  for (const question of prior) {
    if (!question || seen.has(question.decisionId)) continue
    if (question.status === 'answered' || question.status === 'stale') {
      kept.push({ ...question, options: clone(question.options ?? []), dependsOn: [...(question.dependsOn ?? [])] })
    }
    // An open question the model did not re-ask is dropped: the model owns the open set.
  }
  for (const recommendation of priorRecommendations) {
    if (!recommendation || seen.has(recommendation.decisionId) || recommendation.status !== 'answered') continue
    recommendations.push({
      ...recommendation,
      options: clone(recommendation.options ?? []),
      dependsOn: [...(recommendation.dependsOn ?? [])],
    })
  }
  let merged = [...current, ...kept]
  if (merged.length > MAX_GROUP_QUESTIONS) {
    const overflow = merged.length - MAX_GROUP_QUESTIONS
    warnings.push(`问题组超过 ${MAX_GROUP_QUESTIONS} 条，已从最老的已答问题开始裁剪`)
    const removed = new Set()
    for (const question of merged) {
      if (removed.size >= overflow) break
      if (question.status === 'answered' || question.status === 'stale') removed.add(question)
    }
    merged = merged.filter((question) => !removed.has(question))
  }
  const remainingDecisions = new Set(merged.map((question) => question.decisionId))
  for (const question of merged) {
    question.dependsOn = (question.dependsOn ?? []).filter((decisionId) => decisionId !== question.decisionId && remainingDecisions.has(decisionId))
  }
  const updatedAt = isoNow(now)
  const groupId =
    cleanLine(existingGroup?.groupId, { max: 120, field: 'questionGroup.groupId' }) ||
    `QG-${sha256Hex(`${analysisRunId ?? 'run'}|${merged.map((question) => question.decisionId).join('|')}`).slice(0, 10)}`
  const questionGroup = {
    groupId,
    analysisRunId: analysisRunId ?? existingGroup?.analysisRunId ?? null,
    createdAt: cleanLine(existingGroup?.createdAt, { max: 40, field: 'questionGroup.createdAt' }) || updatedAt,
    updatedAt,
    questions: merged,
    recommendations,
  }
  return { questionGroup, warnings }
}

/* ------------------------------------------------------------------ */
/* Requirement doc draft (intent-review.v3)                            */
/* ------------------------------------------------------------------ */

function normalizeDraftSources(value, path, warnings) {
  return modelStringList(value, { max: 10, maxLength: 300, path: `${path}.sources`, warnings })
}

function normalizeProvenance(value, path, warnings) {
  const text = cleanLine(value, { max: 40, field: `${path}.provenance` })
  if (text === '') return 'ai-suggestion'
  if (!PROVENANCES.has(text)) {
    warnings.push(`${path}.provenance: 未知来源 ${text}，已按 ai-suggestion 处理`)
    return 'ai-suggestion'
  }
  return text
}

function normalizeDraftFeatures(value, warnings) {
  const list = Array.isArray(value) ? value : []
  if (value !== undefined && value !== null && !Array.isArray(value)) warnings.push('docDraft.features 不是数组，已忽略')
  if (list.length > MAX_DRAFT_FEATURES) warnings.push(`docDraft.features 超过 ${MAX_DRAFT_FEATURES} 条，已截断`)
  const out = []
  const seen = new Set()
  list.forEach((entry, index) => {
    if (out.length >= MAX_DRAFT_FEATURES) return
    const path = `docDraft.features[${index}]`
    if (!isPlainObject(entry)) {
      warnings.push(`${path}: 非对象已丢弃`)
      return
    }
    const title = cleanModelText(entry.title, { max: 200, field: `${path}.title`, path: `${path}.title`, warnings })
    const behavior = cleanModelText(entry.behavior, { max: MAX_TEXT, field: `${path}.behavior`, path: `${path}.behavior`, warnings })
    if (title === '' && behavior === '') {
      warnings.push(`${path}: 缺少标题与行为，已丢弃`)
      return
    }
    const rawId = cleanLine(entry.id, { max: 20, field: `${path}.id` })
    const id = /^FR-\d{1,4}$/.test(rawId) ? rawId : null
    if (id !== null) {
      if (seen.has(id)) {
        warnings.push(`${path}: 重复 ${id} 已丢弃`)
        return
      }
      seen.add(id)
    }
    out.push({
      id,
      title: title || null,
      behavior,
      preconditions: modelStringList(entry.preconditions, { max: 10, maxLength: 500, path: `${path}.preconditions`, warnings }),
      response: cleanModelText(entry.response, { max: MAX_TEXT, field: `${path}.response`, path: `${path}.response`, warnings }),
      boundaries: modelStringList(entry.boundaries, { max: 10, maxLength: 500, path: `${path}.boundaries`, warnings }),
      sources: normalizeDraftSources(entry.sources, path, warnings),
      provenance: normalizeProvenance(entry.provenance, path, warnings),
    })
  })
  return out
}

function normalizeDraftAcceptance(value, warnings) {
  const list = Array.isArray(value) ? value : []
  if (value !== undefined && value !== null && !Array.isArray(value)) warnings.push('docDraft.acceptance 不是数组，已忽略')
  if (list.length > MAX_DRAFT_ACCEPTANCE) warnings.push(`docDraft.acceptance 超过 ${MAX_DRAFT_ACCEPTANCE} 条，已截断`)
  const out = []
  const seen = new Set()
  list.forEach((entry, index) => {
    if (out.length >= MAX_DRAFT_ACCEPTANCE) return
    const path = `docDraft.acceptance[${index}]`
    if (!isPlainObject(entry)) {
      warnings.push(`${path}: 非对象已丢弃`)
      return
    }
    const text = cleanModelText(entry.text, { max: MAX_TEXT, field: `${path}.text`, path: `${path}.text`, warnings })
    const action = cleanModelText(entry.action, { max: 1000, field: `${path}.action`, path: `${path}.action`, warnings })
    const expected = cleanModelText(entry.expected, { max: 1000, field: `${path}.expected`, path: `${path}.expected`, warnings })
    if (text === '' && action === '' && expected === '') {
      warnings.push(`${path}: 缺少验收文本与动作/预期，已丢弃`)
      return
    }
    const rawId = cleanLine(entry.id, { max: 20, field: `${path}.id` })
    const id = /^AC-\d{1,4}$/.test(rawId) ? rawId : null
    if (id !== null) {
      if (seen.has(id)) {
        warnings.push(`${path}: 重复 ${id} 已丢弃`)
        return
      }
      seen.add(id)
    }
    out.push({
      id,
      featureIds: modelStringList(entry.featureIds, { max: 10, maxLength: 20, path: `${path}.featureIds`, warnings }),
      text,
      precondition: cleanModelText(entry.precondition, { max: 1000, field: `${path}.precondition`, path: `${path}.precondition`, warnings }),
      action,
      expected,
      judgement: cleanModelText(entry.judgement, { max: 1000, field: `${path}.judgement`, path: `${path}.judgement`, warnings }),
      sources: normalizeDraftSources(entry.sources, path, warnings),
      provenance: normalizeProvenance(entry.provenance, path, warnings),
    })
  })
  return out
}

function normalizeDraftPending(value, warnings) {
  const list = Array.isArray(value) ? value : []
  if (value !== undefined && value !== null && !Array.isArray(value)) warnings.push('docDraft.pending 不是数组，已忽略')
  if (list.length > MAX_DRAFT_PENDING) warnings.push(`docDraft.pending 超过 ${MAX_DRAFT_PENDING} 条，已截断`)
  const out = []
  const seen = new Set()
  list.forEach((entry, index) => {
    if (out.length >= MAX_DRAFT_PENDING) return
    const path = `docDraft.pending[${index}]`
    const source = isPlainObject(entry) ? entry : { text: entry }
    const text = cleanModelText(source.text, { max: MAX_TEXT, field: `${path}.text`, path: `${path}.text`, warnings })
    if (text === '' || seen.has(text)) return
    seen.add(text)
    const id = cleanLine(source.id, { max: 20, field: `${path}.id` })
    out.push({
      id: /^Q-\d{1,4}$/.test(id) ? id : null,
      text,
      status: source.status === 'resolved' ? 'resolved' : 'open',
    })
  })
  return out
}

function previousAsDoc(previous) {
  if (!previous || typeof previous !== 'object') return null
  return { ...clone(previous), schema: DOC_SCHEMA }
}

/**
 * Keep human-locked clauses: the model may propose new content, but a locked
 * feature/acceptance/goal/scope is restored from the previous draft and only a
 * warning is recorded. Locks never create new clauses out of nothing.
 */
function applyLockedClauses({ next, previous, lockedClauses, warnings }) {
  if (!previous || !Array.isArray(lockedClauses) || lockedClauses.length === 0) return
  for (const raw of lockedClauses) {
    if (!isPlainObject(raw)) continue
    const kind = LOCKED_KINDS.has(raw.kind) ? raw.kind : null
    if (kind === null) continue
    const id = cleanLine(raw.id, { max: 20, field: 'lockedClauses.id' }) || null
    if (kind === 'goal' || kind === 'scope') {
      const before = previous[kind]
      if (before === undefined || before === null || (typeof before === 'string' && before === '')) continue
      if (canonicalJson(next[kind]) === canonicalJson(before)) continue
      next[kind] = clone(before)
      warnings.push(`人工锁定的 ${kind} 未被模型覆盖`)
      continue
    }
    if (id === null) continue
    const collection = kind === 'feature' ? 'features' : 'acceptance'
    const locked = (Array.isArray(previous[collection]) ? previous[collection] : []).find((entry) => entry?.id === id)
    if (!locked) continue
    const target = Array.isArray(next[collection]) ? next[collection] : []
    const index = target.findIndex((entry) => entry?.id === id)
    if (index >= 0 && canonicalJson(target[index]) === canonicalJson(locked)) continue
    if (index >= 0) target[index] = clone(locked)
    else target.push(clone(locked))
    next[collection] = target
    warnings.push(`人工锁定的 ${kind} ${id} 未被模型覆盖`)
  }
}

/**
 * Normalize a model-authored `docDraft` into `alm.requirement.doc.draft/v1`.
 * Delegates clause/ID/provenance rules to `requirements/doc.mjs::normalizeDoc`
 * and then re-applies the human locks (a lock wins even over normalization).
 */
export function normalizeDocDraft(raw, {
  previous = null,
  warnings = [],
  lockedClauses = [],
  requirementId = null,
  revision = null,
  draftRevision = null,
  inputRevision = null,
  sessionRevision = null,
  legacy = false,
} = {}) {
  const source = isPlainObject(raw) ? raw : {}
  if (!isPlainObject(raw)) warnings.push('docDraft 不是对象，已按空草稿处理')
  const doc = {
    schema: DOC_SCHEMA,
    requirementId: cleanLine(source.requirementId ?? requirementId, { max: 120, field: 'docDraft.requirementId' }) || null,
    title: cleanModelText(source.title, { max: 200, field: 'docDraft.title', path: 'docDraft.title', warnings }),
    revision: Number.isInteger(source.revision) ? source.revision : Number.isInteger(revision) ? revision : null,
    docHash: null,
    goal: cleanModelText(source.goal, { max: MAX_TEXT, field: 'docDraft.goal', path: 'docDraft.goal', warnings }),
    problem: cleanModelText(source.problem, { max: MAX_TEXT, field: 'docDraft.problem', path: 'docDraft.problem', warnings }),
    features: normalizeDraftFeatures(source.features, warnings),
    scope: modelStringList(source.scope, { max: 30, maxLength: 500, path: 'docDraft.scope', warnings }),
    outOfScope: modelStringList(source.outOfScope, { max: 30, maxLength: 500, path: 'docDraft.outOfScope', warnings }),
    acceptance: normalizeDraftAcceptance(source.acceptance, warnings),
    constraints: modelStringList(source.constraints, { max: 30, maxLength: 500, path: 'docDraft.constraints', warnings }),
    pending: normalizeDraftPending(source.pending, warnings),
    meta: { nextFr: 1, nextAc: 1, confirmedAt: null },
  }
  const normalized = normalizeDoc(doc, { previous: previousAsDoc(previous) })
  applyLockedClauses({ next: normalized, previous: previousAsDoc(previous), lockedClauses, warnings })
  const docHash = docHashOf(renderDoc({ ...normalized, schema: DOC_SCHEMA }))
  const previousRevision = Number.isInteger(previous?.draftRevision) && previous.draftRevision > 0 ? previous.draftRevision : 0
  return {
    ...clone(normalized),
    schema: DOC_DRAFT_SCHEMA,
    docHash,
    draftRevision: Number.isInteger(draftRevision) && draftRevision > 0 ? draftRevision : previousRevision + 1,
    basedOnInputRevision: Number.isInteger(inputRevision) ? inputRevision : (previous?.basedOnInputRevision ?? null),
    basedOnSessionRevision: Number.isInteger(sessionRevision) ? sessionRevision : (previous?.basedOnSessionRevision ?? null),
    legacy: legacy === true,
  }
}

/**
 * Backward-compatible v2 path: synthesize a doc draft from the legacy candidate
 * so old analyses remain renderable. Every clause is `unconfirmed`, so
 * `normalizeDoc` parks it in pending instead of pretending it was approved.
 */
export function synthesizeLegacyDocDraft({ items = [], previous = null, warnings = [], inputRevision = null, sessionRevision = null, requirementId = null } = {}) {
  const item = items.find((entry) => entry?.excluded !== true) ?? items[0] ?? null
  const candidate = item?.candidate ?? null
  if (!candidate) {
    return normalizeDocDraft({ goal: '', problem: item?.userProblem ?? '', features: [], acceptance: [] }, {
      previous,
      warnings,
      inputRevision,
      sessionRevision,
      requirementId,
      legacy: true,
    })
  }
  const acceptance = (Array.isArray(candidate.acceptance) ? candidate.acceptance : []).map((entry, index) => ({
    id: `AC-${String(index + 1).padStart(2, '0')}`,
    featureIds: [],
    text: entry?.expected ?? entry?.action ?? '',
    precondition: entry?.precondition ?? '',
    action: entry?.action ?? '',
    expected: entry?.expected ?? '',
    judgement: entry?.judgement ?? '',
    sources: [],
    provenance: 'unconfirmed',
  }))
  const features = candidate.title
    ? [{
        id: 'FR-01',
        title: candidate.title,
        behavior: candidate.goal ?? candidate.problem ?? '',
        preconditions: [],
        response: '',
        boundaries: [],
        sources: [],
        provenance: 'unconfirmed',
      }]
    : []
  return normalizeDocDraft({
    goal: candidate.goal ?? '',
    problem: candidate.problem ?? '',
    features,
    scope: candidate.inScope ?? [],
    outOfScope: candidate.outOfScope ?? [],
    acceptance,
    constraints: [],
    pending: [],
  }, { previous, warnings, inputRevision, sessionRevision, requirementId, legacy: true })
}


export function normalizeAnalysis(raw, { session, context, extractedText, now } = {}) {
  const parsed = parseRaw(raw)
  if (!isPlainObject(parsed)) throw intentError('ai-invalid-output', '模型输出必须是 JSON 对象')
  walkForExecutables(parsed, '', '')

  const warnings = []
  for (const key of Object.keys(parsed)) {
    if (!TOP_KEYS.has(key)) warnings.push(`顶层未知字段 ${key} 已丢弃`)
  }
  const version = parsed.schemaVersion
  const isV3 = version === ANALYSIS_SCHEMA_V3 || version === 'intent-review.v3'
  const isV2 = version === ANALYSIS_SCHEMA_V2 || version === 'intent-review.v2'
  const supportsGroups = isV3 || isV2
  if (version !== undefined && !supportsGroups && !(version === ANALYSIS_SCHEMA || version === 1 || version === '1')) {
    throw intentError('invalid-schema-version', `不支持的模型输出 schemaVersion：${String(version)}`, { value: version })
  }
  const sessionSnapshot = session?.context?.contextSnapshotId ?? null
  let contextSnapshotId = parsed.contextSnapshotId ?? sessionSnapshot
  if (parsed.contextSnapshotId !== undefined && sessionSnapshot !== null && parsed.contextSnapshotId !== sessionSnapshot) {
    throw intentError(
      'context-mismatch',
      `模型结果针对上下文 ${parsed.contextSnapshotId}，当前会话上下文为 ${sessionSnapshot}；请重新分析`,
      { expected: sessionSnapshot, received: parsed.contextSnapshotId },
    )
  }
  if (contextSnapshotId === null && context?.contextSnapshotId) contextSnapshotId = context.contextSnapshotId
  if (!contextSnapshotId) warnings.push('模型输出缺少 contextSnapshotId，已绑定当前会话上下文')

  const haystacks = [session?.input?.text, session?.input?.extractedText, extractedText, context?.query?.text].filter(
    (value) => typeof value === 'string' && value.trim() !== '',
  )
  const rawItems = Array.isArray(parsed.items) ? parsed.items : []
  if (parsed.items !== undefined && !Array.isArray(parsed.items)) {
    throw intentError('invalid-analysis', 'items 必须是数组', { path: 'items' })
  }
  if (rawItems.length > MAX_ITEMS) warnings.push(`items 超过 ${MAX_ITEMS} 条，已截断`)

  const items = []
  rawItems.slice(0, MAX_ITEMS).forEach((entry, index) => {
    const path = `items[${index}]`
    if (!isPlainObject(entry)) {
      warnings.push(`${path}: 非对象已丢弃`)
      return
    }
    for (const key of Object.keys(entry)) {
      if (!ITEM_KEYS.has(key)) warnings.push(`${path}.${key}: 未知字段已丢弃`)
    }
    const recommendedRoute = cleanLine(entry.recommendedRoute, { max: 20, field: 'recommendedRoute' }) || null
    if (recommendedRoute !== null && !ROUTES.includes(recommendedRoute)) {
      throw intentError('unknown-route', `${path}: 未知 route ${recommendedRoute}（允许 ${ROUTES.join('/')}）`, {
        path: `${path}.recommendedRoute`,
        value: recommendedRoute,
      })
    }
    const sourceRefs = (Array.isArray(entry.sourceRefs) ? entry.sourceRefs : [])
      .map((ref, refIndex) => normalizeSourceRef(ref, haystacks, `${path}.sourceRefs[${refIndex}]`, warnings))
      .filter(Boolean)
    const related = (Array.isArray(entry.related) ? entry.related : [])
      .map((ref, refIndex) => normalizeRelated(ref, `${path}.related[${refIndex}]`, warnings))
      .filter(Boolean)
    const unknowns = (Array.isArray(entry.unknowns) ? entry.unknowns : [])
      .map((unknown, unknownIndex) => normalizeUnknown(unknown, `${path}.unknowns[${unknownIndex}]`, warnings))
      .filter(Boolean)
    const assumptions = modelStringList(entry.assumptions, { max: 20, maxLength: 500, path: `${path}.assumptions`, warnings })
    const candidate = normalizeCandidate(entry.candidate, `${path}.candidate`, haystacks, warnings)
    const counterexample = isPlainObject(entry.counterexample)
      ? {
          scenario: cleanModelText(entry.counterexample.scenario, { max: 1000, field: 'counterexample.scenario', path: `${path}.counterexample.scenario`, warnings }) || null,
          status: entry.counterexample.status === 'observed' ? 'observed' : 'unverified',
        }
      : { scenario: null, status: 'unverified' }
    const valueCheck = isPlainObject(entry.valueCheck)
      ? {
          claim: cleanModelText(entry.valueCheck.claim, { max: 1000, field: 'valueCheck.claim', path: `${path}.valueCheck.claim`, warnings }) || null,
          smallestCheck: cleanModelText(entry.valueCheck.smallestCheck, { max: 1000, field: 'valueCheck.smallestCheck', path: `${path}.valueCheck.smallestCheck`, warnings }) || null,
          stopCondition: cleanModelText(entry.valueCheck.stopCondition, { max: 1000, field: 'valueCheck.stopCondition', path: `${path}.valueCheck.stopCondition`, warnings }) || null,
          status: cleanLine(entry.valueCheck.status, { max: 40, field: 'valueCheck.status' }) || 'unverified',
        }
      : { claim: null, smallestCheck: null, stopCondition: null, status: 'unverified' }

    const providedId = cleanLine(entry.itemId, { max: 120, field: 'itemId' })
    items.push({
      itemId: providedId || `ITM-${index + 1}`,
      sourceRefs,
      sourceRefsRejected: Array.isArray(entry.sourceRefs) && entry.sourceRefs.length > 0 && sourceRefs.length === 0,
      userProblem: cleanModelText(entry.userProblem, { max: 2000, field: 'userProblem', path: `${path}.userProblem`, warnings }) || null,
      desiredOutcome: cleanModelText(entry.desiredOutcome, { max: 2000, field: 'desiredOutcome', path: `${path}.desiredOutcome`, warnings }) || null,
      recommendedRoute,
      routeRationale: cleanModelText(entry.summary, { max: 2000, field: 'summary', path: `${path}.summary`, warnings }) || null,
      related,
      assumptions,
      unknowns,
      candidate,
      counterexample,
      valueCheck,
      fields: {},
    })
  })

  if (items.length === 0) {
    const stub = buildStubItem({ session })
    items.push(stub)
    warnings.push('模型输出没有可用的意图条目，已生成待澄清的 stub 条目')
  }
  const itemIds = new Set(items.map((item) => item.itemId))
  const stubOnly = items.length === 1 && items[0].stub === true
  if (stubOnly && parsed.nextQuestion !== undefined && parsed.nextQuestion !== null) {
    warnings.push('模型输出的澄清问题缺少有效条目支撑，已替换为 stub 澄清问题')
  }
  let nextQuestion = stubOnly
    ? normalizeQuestion(buildStubQuestion(items[0].itemId), itemIds, warnings)
    : normalizeQuestion(parsed.nextQuestion, itemIds, warnings)
  let questions = []
  const rawQuestions = parsed.questions
  if (rawQuestions !== undefined && rawQuestions !== null) {
    if (!Array.isArray(rawQuestions)) throw intentError('invalid-analysis', 'questions 必须是数组', { path: 'questions' })
    if (parsed.nextQuestion !== undefined && parsed.nextQuestion !== null) {
      warnings.push('模型输出同时包含 questions 与 nextQuestion，已以 questions 为准')
    }
    if (stubOnly) {
      warnings.push('模型输出缺少有效条目，questions 已替换为 stub 澄清问题')
    } else {
      if (!supportsGroups) warnings.push('模型输出未声明 intent-review.v2/v3，questions 不合并到问题组，仅取第一题作 nextQuestion')
      questions = normalizeQuestions(rawQuestions, itemIds, session?.questionGroup ?? null, warnings)
      if (supportsGroups) {
        nextQuestion = questions.length > 0 ? legacyQuestionShape(questions[0]) : null
      } else if (questions.length > 0) {
        nextQuestion = legacyQuestionShape(questions[0])
      }
    }
  }
  if (questions.length === 0 && nextQuestion) questions = [questionFromLegacy(nextQuestion)]

  let docDraft = null
  const previousDraft = session?.docDraft ?? null
  const draftDefaults = {
    previous: previousDraft,
    warnings,
    lockedClauses: Array.isArray(session?.lockedClauses) ? session.lockedClauses : [],
    requirementId: session?.project?.requirementId ?? null,
    inputRevision: session?.input?.inputRevision ?? null,
    sessionRevision: session?.sessionRevision ?? null,
  }
  if (isV3) {
    if (isPlainObject(parsed.docDraft)) {
      docDraft = normalizeDocDraft(parsed.docDraft, { ...draftDefaults, legacy: false })
    } else {
      warnings.push('模型声明 intent-review.v3 但缺少 docDraft，已按候选条目合成未确认草稿')
      docDraft = synthesizeLegacyDocDraft({ ...draftDefaults, items })
    }
  } else if (isV2) {
    docDraft = synthesizeLegacyDocDraft({ ...draftDefaults, items })
  }

  return {
    analysis: {
      schema: ANALYSIS_SCHEMA,
      schemaVersion: isV3 ? ANALYSIS_SCHEMA_V3 : isV2 ? ANALYSIS_SCHEMA_V2 : ANALYSIS_SCHEMA,
      contextSnapshotId: contextSnapshotId ?? null,
      items,
      questions,
      nextQuestion,
      docDraft,
      normalizedAt: now ? new Date(now).toISOString() : null,
    },
    warnings,
  }
}

/** Effective route: a human edit always wins over the model suggestion. */
export function effectiveRoute(item) {
  const override = item?.fields?.recommendedRoute
  if (override && override.source === 'human') return override.value
  return item?.recommendedRoute ?? null
}

const CANDIDATE_FIELD_KEYS = ['title', 'problem', 'goal', 'inScope', 'outOfScope', 'acceptance']

/** Effective candidate: layer `item.fields['candidate.*']` human edits on top. */
export function effectiveCandidate(item) {
  const base = item?.candidate ? clone(item.candidate) : null
  const fields = item?.fields ?? {}
  const hasOverride = CANDIDATE_FIELD_KEYS.some((key) => fields[`candidate.${key}`]?.source === 'human')
  if (!base && !hasOverride) return null
  const out = base ?? { title: null, problem: null, goal: null, inScope: [], outOfScope: [], acceptance: [], owner: null, priority: null }
  for (const key of CANDIDATE_FIELD_KEYS) {
    const override = fields[`candidate.${key}`]
    if (override && override.source === 'human') out[key] = override.value
  }
  if (out.owner && out.owner !== null) out.owner = null
  if (out.priority && out.priority !== null) out.priority = null
  return out
}

export function effectiveValue(item, field) {
  const override = item?.fields?.[field]
  if (override && override.source === 'human') return override.value
  return item?.[field] ?? null
}

/**
 * Merge a normalized analysis into a session (pure). Never touches disk.
 */
export function applyAnalysis({ session, analysis, model, runId, inputRevision, now } = {}) {
  if (!session) throw intentError('invalid-request', 'applyAnalysis 需要 session')
  if (!isPlainObject(analysis)) throw intentError('invalid-analysis', 'applyAnalysis 需要规范化的 analysis')
  if (inputRevision !== undefined && inputRevision !== session.input.inputRevision) {
    throw intentError('stale-input', `分析结果针对输入版本 ${inputRevision}，当前已是 ${session.input.inputRevision}`, {
      expected: session.input.inputRevision,
      received: inputRevision,
    })
  }
  const currentSnapshot = session.context?.contextSnapshotId ?? null
  if (analysis.contextSnapshotId && currentSnapshot && analysis.contextSnapshotId !== currentSnapshot) {
    throw intentError('stale-context', `分析结果针对上下文 ${analysis.contextSnapshotId}，当前为 ${currentSnapshot}`, {
      expected: currentSnapshot,
      received: analysis.contextSnapshotId,
    })
  }

  const warnings = []
  const next = clone(session)
  next.investigationEvidence = []
  const existing = Array.isArray(next.items) ? next.items : []
  const byId = new Map(existing.map((item) => [item.itemId, item]))
  const merged = []
  const usedIds = new Set()

  ;(analysis.items ?? []).forEach((incoming, index) => {
    const target = (incoming.itemId && byId.get(incoming.itemId)) || (!incoming.itemId ? existing[index] : null)
    if (!target) {
      merged.push({
        ...incoming,
        itemId: incoming.itemId && !usedIds.has(incoming.itemId) ? incoming.itemId : `ITM-${index + 1}`,
      })
    } else {
      const mergedItem = { ...target, ...incoming, fields: clone(target.fields ?? {}) }
      for (const [field, override] of Object.entries(mergedItem.fields)) {
        if (override?.source !== 'human') continue
        const incomingValue = field.startsWith('candidate.')
          ? incoming.candidate?.[field.slice('candidate.'.length)]
          : incoming[field]
        if (incomingValue !== undefined && canonicalJson(incomingValue) !== canonicalJson(override.value)) {
          mergedItem.fields[field] = {
            ...override,
            conflict: { value: incomingValue, at: now ? new Date(now).toISOString() : new Date().toISOString() },
          }
          warnings.push(`人工编辑 ${target.itemId}.${field} 已保留，模型新值仅作为冲突记录`)
        }
      }
      merged.push(mergedItem)
    }
    usedIds.add(merged[merged.length - 1].itemId)
  })

  // Keep excluded items from the old analysis: they carry a human decision.
  for (const item of existing) {
    if (item.excluded === true && !usedIds.has(item.itemId)) merged.push(item)
  }

  let nextQuestion = analysis.nextQuestion ?? null
  let stubQuestion = null
  if (merged.length === 0) {
    const stub = buildStubItem({ session, itemId: existing.length === 0 ? 'ITM-1' : `ITM-${existing.length + 1}` })
    merged.push(stub)
    stubQuestion = buildStubQuestion(stub.itemId)
    nextQuestion = stubQuestion
    warnings.push('分析结果没有条目，已生成待澄清的 stub 条目')
  }
  next.items = merged
  const supportsGroups = analysis.schemaVersion === ANALYSIS_SCHEMA_V3
    || analysis.schemaVersion === 'intent-review.v3'
    || analysis.schemaVersion === ANALYSIS_SCHEMA_V2
    || analysis.schemaVersion === 'intent-review.v2'
  if (supportsGroups) {
    const incoming = Array.isArray(analysis.questions) ? [...analysis.questions] : []
    if (incoming.length === 0 && stubQuestion) incoming.push(questionFromLegacy(stubQuestion))
    const groupResult = mergeQuestionGroup({ session: next, questions: incoming, analysisRunId: runId, now })
    next.questionGroup = groupResult.questionGroup
    warnings.push(...groupResult.warnings)
    next.nextQuestion = nextQuestionFromGroup(groupResult.questionGroup)
  } else if (next.questionGroup) {
    // A late v1 result must not wipe decisions captured by a v2 question group.
    next.nextQuestion = nextQuestionFromGroup(next.questionGroup)
  } else {
    next.nextQuestion = nextQuestion
  }
  if (analysis.docDraft) {
    const draft = clone(analysis.docDraft)
    const humanTitle = existing
      .flatMap((item) => Object.entries(item?.fields ?? {}).map(([field, override]) => ({ field, override })))
      .find(({ field, override }) => field === 'candidate.title' && override?.source === 'human')?.override?.value
    if (typeof humanTitle === 'string' && humanTitle.trim() !== '') {
      if (draft.title !== humanTitle) warnings.push('人工编辑标题已保留，模型草稿标题未覆盖')
      draft.title = humanTitle
    }
    const previousRevision = Number.isInteger(session.draftRevision) && session.draftRevision >= 0 ? session.draftRevision : 0
    draft.draftRevision = Math.max(
      Number.isInteger(draft.draftRevision) && draft.draftRevision > 0 ? draft.draftRevision : 1,
      previousRevision + 1,
    )
    draft.basedOnInputRevision = next.input.inputRevision
    draft.basedOnSessionRevision = Number.isInteger(session.sessionRevision) ? session.sessionRevision : 1
    next.docDraft = draft
    next.draftRevision = draft.draftRevision
  }
  next.state = next.nextQuestion ? 'needs_input' : merged.length > 0 ? 'ready_for_confirmation' : 'editing'
  next.error = null
  next.analysisMeta = {
    analysisRunId: runId ?? null,
    appliedAt: now ? new Date(now).toISOString() : new Date().toISOString(),
    provider: model?.provider ?? null,
    model: model?.model ?? null,
    contextSnapshotId: analysis.contextSnapshotId ?? currentSnapshot,
    warnings,
    inputRevision: next.input.inputRevision,
  }
  next.updatedAt = next.analysisMeta.appliedAt
  return next
}
