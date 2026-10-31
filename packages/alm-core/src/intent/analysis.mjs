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
  MATCHES,
  RESOLUTIONS,
  ROUTES,
  intentError,
} from './errors.mjs'
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

const TOP_KEYS = new Set(['schemaVersion', 'contextSnapshotId', 'items', 'nextQuestion'])
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
const OPTION_KEYS = new Set(['id', 'label', 'impact'])
const MAX_ITEMS = 20
const MAX_OPTIONS = 3
const MAX_TEXT = 4000

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
  const description = cleanModelText(entry.description, { max: 500, field: 'unknown.description', path: `${path}.description`, warnings })
  if (description === '') {
    warnings.push(`${path}: 缺少 description 的 unknown 已丢弃`)
    return null
  }
  const resolution = cleanLine(entry.resolution, { max: 20, field: 'unknown.resolution' }) || 'pending'
  if (!RESOLUTIONS.includes(resolution)) {
    warnings.push(`${path}: 未知 resolution ${resolution}，已按 pending 处理`)
  }
  return {
    description,
    blocking: entry.blocking === true,
    resolution: RESOLUTIONS.includes(resolution) ? resolution : 'pending',
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

/**
 * Normalize raw model output into `intent-review.v1`.
 *
 * @returns {{analysis: object, warnings: string[]}}
 */
export function normalizeAnalysis(raw, { session, context, extractedText, now } = {}) {
  const parsed = parseRaw(raw)
  if (!isPlainObject(parsed)) throw intentError('ai-invalid-output', '模型输出必须是 JSON 对象')
  walkForExecutables(parsed, '', '')

  const warnings = []
  for (const key of Object.keys(parsed)) {
    if (!TOP_KEYS.has(key)) warnings.push(`顶层未知字段 ${key} 已丢弃`)
  }
  if (parsed.schemaVersion !== undefined) {
    const version = parsed.schemaVersion
    if (!(version === ANALYSIS_SCHEMA || version === 1 || version === '1')) {
      throw intentError('invalid-schema-version', `不支持的模型输出 schemaVersion：${String(version)}`, { value: version })
    }
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
  const nextQuestion = stubOnly
    ? normalizeQuestion(buildStubQuestion(items[0].itemId), itemIds, warnings)
    : normalizeQuestion(parsed.nextQuestion, itemIds, warnings)
  return {
    analysis: {
      schema: ANALYSIS_SCHEMA,
      schemaVersion: ANALYSIS_SCHEMA,
      contextSnapshotId: contextSnapshotId ?? null,
      items,
      nextQuestion,
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
  if (merged.length === 0) {
    const stub = buildStubItem({ session, itemId: existing.length === 0 ? 'ITM-1' : `ITM-${existing.length + 1}` })
    merged.push(stub)
    nextQuestion = buildStubQuestion(stub.itemId)
    warnings.push('分析结果没有条目，已生成待澄清的 stub 条目')
  }
  next.items = merged
  next.nextQuestion = nextQuestion
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
