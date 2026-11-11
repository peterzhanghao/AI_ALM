/**
 * HTTP layer for the manual feedback loop (feedback v1 contract §3).
 *
 * `handleFeedbackRequest` is a pure request->response function: it maps an
 * already-parsed body/query onto the core feedback ledger (`alm-core/src/
 * feedback`) and returns `{ status, payload }`. The plugin route in index.js
 * only supplies the observation root and JSON body reader, and every core
 * dependency is injectable for unit tests.
 *
 * Invariants enforced here (contract §3, §6):
 * - destinations are resolved from the trusted workspace list only; the client
 *   never supplies a path, and a missing target never falls back to the
 *   current business root;
 * - statement/priority/category are validated before any write;
 * - save is idempotent by `clientRequestId`, generate is idempotent by
 *   feedback status (serialized per root+feedback so two clicks make one
 *   requirement);
 * - the generated brief carries only the user statement and frozen-context
 *   facts, never absolute paths and never AI conclusions;
 * - the slice is zero-model-call: nothing here fans out to a provider.
 */
import { readFileSync } from 'node:fs'
import { resolve as pathResolve } from 'node:path'
import { readProject } from '../alm-core/src/project/project.mjs'
import * as feedbackCore from '../alm-core/src/feedback/index.mjs'
import { createRequirement } from '../alm-core/src/requirements/create.mjs'
import { listWorkspaces } from './workspaces.mjs'
import { requirements as listRequirements } from './query.mjs'
import { feedbackBuildInfo } from './build-info.mjs'

const GET_ACTIONS = new Set(['inbox', 'record', 'settings', 'diagnostics', 'proposal', 'requirement-ref', 'attachment'])
const POST_ACTIONS = new Set(['save', 'generate', 'settings', 'retry', 'category', 'supplement', 'link', 'disposition', 'resolve', 'reopen', 'process', 'proposal-confirm'])
const FALLBACK_CATEGORIES = ['undetermined', 'defect', 'experience', 'capability']
const CATEGORY_ALIASES = new Map([
  ['待判断', 'undetermined'],
  ['待定', 'undetermined'],
  ['undetermined', 'undetermined'],
  ['unknown', 'undetermined'],
  ['缺陷', 'defect'],
  ['bug', 'defect'],
  ['缺陷/问题', 'defect'],
  ['体验', 'experience'],
  ['体验问题', 'experience'],
  ['ux', 'experience'],
  ['新能力', 'capability'],
  ['新功能', 'capability'],
  ['feature', 'capability'],
])
const PRIORITIES = new Set(['P0', 'P1', 'P2'])
const MAX_STATEMENT = 4000
const MAX_CLIENT_REQUEST_ID = 200
const UI_KEYS = ['page', 'stage', 'viewState', 'unsavedSummary']
const LINK_KEYS = [
  'intentSessionId',
  'requirementId',
  'requirementRevision',
  'requirementFile',
  'requirementInstanceKey',
  'runIds',
  'candidateId',
  'acceptanceDecisionId',
  'failureIds',
]
const TARGET_PRODUCT_KEYS = ['product', 'component', 'pluginVersion']
const RUNTIME_KEYS = ['hostVersion', 'pluginVersion', 'model', 'errorCodes', 'timingMs']
const EVIDENCE_KEYS = ['eventRange', 'textExcerpts', 'attachments', 'screenshotRef']
const FEEDBACK_ID = /^FB-[0-9]{1,8}$/

/** A request problem that maps directly onto the HTTP contract. */
class FeedbackRequestError extends Error {
  constructor(status, code, message, details) {
    super(message)
    this.name = 'FeedbackRequestError'
    this.status = status
    this.code = code
    this.details = details
  }
}

function ok(status, payload) {
  return { status, payload }
}

function fail(status, code, message, details) {
  const error = { code, message }
  if (details !== undefined) error.details = details
  return { status, payload: { ok: false, error } }
}

function readText(value) {
  if (value === undefined || value === null) return null
  const text = String(value).trim()
  return text === '' ? null : text
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasOwn(object, key) {
  return isPlainObject(object) && Object.prototype.hasOwnProperty.call(object, key)
}

function queryValue(query, name) {
  if (!query) return null
  if (typeof query.get === 'function') {
    try {
      return query.get(name)
    } catch {
      return null
    }
  }
  if (!isPlainObject(query)) return null
  const value = query[name]
  return Array.isArray(value) ? value[0] : value
}

function nowIso() {
  return new Date().toISOString()
}

/** Copy the whitelisted keys of a client object, omitting missing/null values. */
function pickKeys(value, keys) {
  const out = {}
  if (!isPlainObject(value)) return out
  for (const key of keys) {
    const entry = value[key]
    if (entry === undefined || entry === null) continue
    out[key] = entry
  }
  return out
}

function unwrapRecord(value) {
  if (!isPlainObject(value)) return null
  if (isPlainObject(value.feedback)) return value.feedback
  return value
}

function resolveDeps(overrides) {
  return {
    ...feedbackCore,
    listWorkspaces,
    createRequirement,
    ...(isPlainObject(overrides) ? overrides : {}),
  }
}

function defaultSettings() {
  return {
    schema: 'alm.feedback.settings/v1',
    enabled: false,
    destinationWorkspace: null,
    coverage: { stages: ['intent', 'review', 'run', 'test', 'acceptance', 'list', 'detail'] },
    capture: { includeAttachments: false, retentionDays: 90, maxRecords: 500 },
    updatedAt: null,
    updatedBy: null,
  }
}

function readSettings(core, root) {
  try {
    const settings = core.readFeedbackSettings(root)
    if (isPlainObject(settings)) return settings
  } catch {
    // A broken settings file must not hide the default contract: the default is
    // "disabled / no destination", which is also what the UI shows.
  }
  return defaultSettings()
}

function feedbackCategories(core) {
  const raw = core?.FEEDBACK_CATEGORIES
  if (Array.isArray(raw) && raw.length > 0) {
    const values = raw
      .map((entry) => (typeof entry === 'string' ? entry : entry?.id ?? entry?.value ?? entry?.category ?? entry?.key))
      .filter((entry) => typeof entry === 'string' && entry !== '')
    if (values.length > 0) return values
  }
  if (isPlainObject(raw)) {
    const keys = Object.keys(raw)
    if (keys.length > 0) return keys
  }
  return FALLBACK_CATEGORIES
}

function normaliseCategory(core, value, { required = false } = {}) {
  const text = readText(value)
  if (!text) {
    if (required) throw new FeedbackRequestError(400, 'category-required', '缺少反馈类别')
    return null
  }
  const mapped = CATEGORY_ALIASES.get(text) ?? CATEGORY_ALIASES.get(text.toLowerCase()) ?? null
  const categories = feedbackCategories(core)
  if (mapped) {
    if (!categories.includes(mapped)) throw new FeedbackRequestError(400, 'category-invalid', `未知的反馈类别：${text}`, { categories })
    return mapped
  }
  const lower = text.toLowerCase()
  if (categories.includes(lower)) return lower
  throw new FeedbackRequestError(400, 'category-invalid', `未知的反馈类别：${text}`, { categories })
}

function normaliseStatement(value) {
  if (typeof value !== 'string') {
    throw new FeedbackRequestError(400, 'statement-required', '请填写反馈内容')
  }
  const text = value.trim()
  if (text === '') throw new FeedbackRequestError(400, 'statement-required', '请填写反馈内容')
  if (text.length > MAX_STATEMENT) {
    throw new FeedbackRequestError(400, 'statement-too-long', `反馈内容超过 ${MAX_STATEMENT} 字`)
  }
  return text
}

function requireFeedbackId(value) {
  const text = readText(value)
  if (!text) throw new FeedbackRequestError(400, 'feedback-id-required', '缺少反馈 id')
  if (!FEEDBACK_ID.test(text)) throw new FeedbackRequestError(400, 'feedback-id-invalid', '反馈 id 不合法')
  return text
}

function listWorkspacesSafe(core) {
  try {
    const listed = core.listWorkspaces()
    return Array.isArray(listed?.workspaces) ? listed.workspaces : []
  } catch {
    return []
  }
}

function workspaceName(workspace) {
  return readText(workspace?.name) ?? readText(workspace?.title) ?? readText(workspace?.root) ?? ''
}

/** Public trusted-workspace entry; `root` is the local path the UI may display. */
function publicWorkspace(workspace, writable) {
  return {
    id: workspace?.id ?? workspace?.workspaceId ?? workspace?.projectId ?? '',
    projectId: workspace?.projectId ?? null,
    workspaceId: workspace?.workspaceId ?? null,
    name: workspaceName(workspace),
    root: workspace?.root ?? null,
    linked: workspace?.linked === true,
    writable: writable === true,
  }
}

/** The destination shape used by records/proposals (workspaceId+projectId+root). */
function destinationOf(workspace) {
  if (!workspace?.root) return null
  return {
    workspaceId: workspace.workspaceId ?? null,
    projectId: workspace.projectId ?? null,
    root: workspace.root,
  }
}

/**
 * Ask core (read-only or probing) whether a trusted workspace can receive a
 * requirement. Never throws: an unavailable validator is reported as a
 * destination problem, never treated as success.
 */
function probeDestination(core, workspace, probeWrite) {
  if (!workspace?.root) {
    return { ok: false, code: 'destination-not-configured', message: '尚未配置接收工作区' }
  }
  if (workspace.exists === false) {
    return { ok: false, code: 'destination-not-configured', message: '接收工作区目录不存在' }
  }
  if (typeof core.validateDestination !== 'function') {
    return { ok: false, code: 'destination-validate-unavailable', message: '目标工作区校验不可用' }
  }
  try {
    const result = core.validateDestination({ root: workspace.root, workspace, probeWrite: probeWrite === true })
    if (!isPlainObject(result)) {
      return { ok: false, code: 'destination-not-writable', message: '无法校验接收工作区' }
    }
    if (result.ok === true) return { ok: true, code: null, message: '' }
    return {
      ok: false,
      code: typeof result.code === 'string' && result.code !== '' ? result.code : 'destination-not-writable',
      message: readText(result.message) ?? '接收工作区不可写',
    }
  } catch (error) {
    return {
      ok: false,
      code: typeof error?.code === 'string' && error.code !== '' ? error.code : 'destination-not-writable',
      message: readText(error?.message) ?? '接收工作区不可用',
    }
  }
}

function destinationCode(check) {
  const code = String(check?.code ?? '')
  if (code === 'destination-not-configured' || code === 'destination-not-writable') return code
  if (code === 'destination-unavailable' || code === 'destination-not-found' || code === 'project-not-found') {
    return 'destination-not-configured'
  }
  return 'destination-not-writable'
}

function workspaceFromRef(workspaces, ref) {
  if (ref === undefined || ref === null) return null
  const wanted = typeof ref === 'string' || typeof ref === 'number' ? readText(ref) : readText(ref.workspaceId ?? ref.projectId ?? ref.id)
  if (!wanted) return null
  return (
    workspaces.find(
      (workspace) =>
        workspace.workspaceId === wanted || workspace.projectId === wanted || workspace.id === wanted,
    ) ?? null
  )
}

function resolveWorkspaceParameter(core, value) {
  const wanted = readText(value)
  if (!wanted) return null
  return workspaceFromRef(listWorkspacesSafe(core), wanted)
}

/** Trusted workspaces with a read-only writability hint (no probe writes). */
function workspacesWithWritable(core) {
  return listWorkspacesSafe(core).map((workspace) => {
    const check = probeDestination(core, workspace, false)
    return publicWorkspace(workspace, check.ok === true)
  })
}

function observedWorkspaceFor(workspaces, root) {
  let project = null
  try {
    project = readProject(root)
  } catch {
    project = null
  }
  const match = workspaces.find((workspace) => workspace?.root && samePath(workspace.root, root)) ?? null
  return {
    projectId: project?.id ?? match?.projectId ?? null,
    workspaceId: match?.workspaceId ?? null,
    root,
  }
}

function samePath(left, right) {
  try {
    return pathResolve(String(left)) === pathResolve(String(right))
  } catch {
    return String(left) === String(right)
  }
}

function normaliseCounts(counts) {
  const source = isPlainObject(counts) ? counts : {}
  const value = (key, alias) => {
    const raw = source[key] ?? (alias ? source[alias] : undefined)
    const number = Number(raw)
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0
  }
  return {
    saved: value('saved'),
    needsRouting: value('needsRouting', 'needs-routing') || value('needs_routing'),
    routed: value('routed'),
    requirementCreated: value('requirementCreated', 'requirement-created') || value('requirement_created'),
    failed: value('failed'),
  }
}

function countsFor(core, root) {
  try {
    const inbox = core.feedbackInbox(root)
    return normaliseCounts(inbox?.counts)
  } catch {
    return normaliseCounts(null)
  }
}

function excerpt(value, max = 160) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  if (text === '') return ''
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function publicInboxItem(item) {
  if (!isPlainObject(item)) return null
  const requirement = isPlainObject(item.requirement)
    ? {
      id: item.requirement.id ?? null,
      revision: item.requirement.revision ?? null,
      ...(item.requirement.file ? { file: item.requirement.file } : {}),
    }
    : null
  return {
    id: item.id ?? null,
    status: item.status ?? null,
    category: item.category ?? null,
    statementExcerpt: readText(item.statementExcerpt) ?? excerpt(item.statement),
    createdAt: item.createdAt ?? null,
    updatedAt: item.updatedAt ?? null,
    destination: item.destination ?? item.routing?.destination ?? null,
    requirement,
    failureCode: item.failure?.code ?? item.failureCode ?? null,
    proposalId: item.proposalId ?? null,
    contextSnapshotId: item.contextSnapshotId ?? null,
    page: item.page ?? null,
    stage: item.stage ?? null,
    disposition: item.disposition ?? 'open',
    resolution: item.resolution ?? 'pending',
    supplementCount: Number.isInteger(item.supplementCount) ? item.supplementCount : 0,
    // A requirement can exist while linking back to the feedback failed. Put
    // that on the inbox row so a retry is visible instead of invisible drift.
    reconciliation: isPlainObject(item.reconciliation)
      ? {
        state: item.reconciliation.state ?? null,
        requirementId: item.reconciliation.requirementId ?? null,
        note: readText(item.reconciliation.note) ?? null,
        at: item.reconciliation.at ?? null,
      }
      : null,
    processing: isPlainObject(item.processing)
      ? {
        state: item.processing.state ?? null,
        attempts: Number.isInteger(item.processing.attempts) ? item.processing.attempts : 0,
        lastError: readText(item.processing.lastError) ?? null,
        updatedAt: item.processing.updatedAt ?? null,
      }
      : null,
  }
}

function readProposal(core, root, feedback) {
  const id = readText(feedback?.proposalId) ?? readText(feedback?.processing?.proposalId)
  if (!id) return null
  if (typeof core.readProposal !== 'function') return null
  try {
    const proposal = core.readProposal(root, id)
    return isPlainObject(proposal) ? proposal : null
  } catch {
    return null
  }
}

function routeToDestination(core, root, id, workspace, now, reason) {
  if (typeof core.routeFeedback !== 'function') return null
  try {
    const destination = destinationOf(workspace)
    const out = core.routeFeedback({
      root,
      id,
      destination,
      ...(reason ? { reason } : {}),
      now,
    })
    return unwrapRecord(out)
  } catch (error) {
    throw new FeedbackRequestError(
      Number.isInteger(error?.status) ? error.status : 500,
      error?.code ?? 'route-feedback-failed',
      `反馈路由失败：${error?.message ?? String(error)}`,
    )
  }
}

function markFailed(core, root, id, failure, now) {
  if (typeof core.markFeedbackFailed !== 'function') return null
  try {
    return unwrapRecord(core.markFeedbackFailed({ root, id, failure, now }))
  } catch {
    return null
  }
}

/** Build the ContextEnvelope input from the server facts plus whitelisted client fields. */
function assembleContext({ body, statement, now, observed, envelopeDestination }) {
  const source = isPlainObject(body?.context) ? body.context : {}
  const context = {
    capturedAt: now,
    observedWorkspace: observed,
    captureBoundary: {
      mode: 'current-only',
      coveredStages: [],
      notCoveredStages: ['未记录的历史操作'],
      truncated: false,
    },
    userStatement: { text: statement },
  }
  // The click time is the user's clock; keep it separate from `capturedAt`
  // (server save time) so a timezone/skew bug stays visible instead of being
  // silently rewritten to "when the request arrived".
  const observedAt = readText(source.observedAt) ?? readText(source.capture?.observedAt)
  if (observedAt) context.observedAt = observedAt
  const rawCapture = isPlainObject(source.capture) ? source.capture : null
  if (rawCapture) {
    const capture = {}
    for (const key of ['kind', 'client', 'clientBuild', 'timeSource']) {
      const value = readText(rawCapture[key])
      if (value) capture[key] = value.slice(0, 200)
    }
    if (Object.keys(capture).length > 0) context.capture = capture
  }
  const recentError = readText(source.recentError) ?? readText(source.ui?.recentError)
  if (recentError) context.recentError = recentError.slice(0, 600)
  const ui = pickKeys(source.ui, UI_KEYS)
  if (Object.keys(ui).length > 0) context.ui = ui
  const links = pickKeys(source.links, LINK_KEYS)
  if (Object.keys(links).length > 0) context.links = links
  const targetProduct = pickKeys(source.targetProduct, TARGET_PRODUCT_KEYS)
  if (targetProduct.product === undefined) targetProduct.product = 'dsh-requirements-plugin'
  context.targetProduct = targetProduct
  const runtime = pickKeys(source.runtime, RUNTIME_KEYS)
  if (Object.keys(runtime).length > 0) context.runtime = runtime
  const evidence = pickKeys(source.evidence, EVIDENCE_KEYS)
  if (Object.keys(evidence).length > 0) context.evidence = evidence
  const expected = readText(source.userStatement?.expected)
  if (expected) context.userStatement.expected = expected
  if (envelopeDestination) context.destinationWorkspace = envelopeDestination
  return context
}

function resolveSaveDestination({ core, body, settings }) {
  const workspaces = listWorkspacesSafe(core)
  const explicit = hasOwn(body, 'destinationWorkspaceId') ? body.destinationWorkspaceId : undefined
  if (explicit !== undefined) {
    if (explicit === null || readText(explicit) === null) return { workspace: null, source: 'explicit-none' }
    const workspace = workspaceFromRef(workspaces, explicit)
    if (!workspace) {
      throw new FeedbackRequestError(422, 'destination-not-configured', '接收工作区不在可信工作区列表中')
    }
    return { workspace, source: 'explicit' }
  }
  const fromSettings = workspaceFromRef(workspaces, settings?.destinationWorkspace)
  return { workspace: fromSettings, source: fromSettings ? 'settings' : 'none' }
}

function resolveGenerateDestination({ core, body, feedback, settings }) {
  const workspaces = listWorkspacesSafe(core)
  if (hasOwn(body, 'destinationWorkspaceId') && body.destinationWorkspaceId !== undefined) {
    if (body.destinationWorkspaceId === null) return null
    return workspaceFromRef(workspaces, body.destinationWorkspaceId)
  }
  const fromRecord = workspaceFromRef(workspaces, feedback?.routing?.destination)
  if (fromRecord) return fromRecord
  return workspaceFromRef(workspaces, settings?.destinationWorkspace)
}

function buildTitle(value, statement) {
  const explicit = readText(value)
  const fallback = String(statement ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line !== '')
  const base = explicit ?? fallback ?? ''
  const clean = base
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return (clean === '' ? '手动反馈改进' : clean).slice(0, 80)
}

/** Requirement brief: user words + frozen facts only, no absolute paths, no AI. */
function buildBrief(feedback) {
  const context = isPlainObject(feedback?.context) ? feedback.context : {}
  const statement = String(feedback?.statement ?? '').trim()
  const expected = readText(context.userStatement?.expected)
  const ui = isPlainObject(context.ui) ? context.ui : {}
  const links = isPlainObject(context.links) ? context.links : {}
  const boundary = isPlainObject(context.captureBoundary) ? context.captureBoundary : {}
  const lines = ['## 用户原话', '', ...statement.split(/\r?\n/).map((line) => `> ${line}`), '']
  if (expected) lines.push('## 期望', '', expected, '')
  const facts = []
  if (ui.page || ui.stage) facts.push(`- 页面/阶段：${ui.page ?? '未记录'}${ui.stage ? ` / ${ui.stage}` : ''}`)
  if (links.requirementId) {
    facts.push(`- 关联需求：${links.requirementId}${links.requirementRevision ? ` v${links.requirementRevision}` : ''}`)
  }
  if (links.intentSessionId) facts.push(`- 意图会话：${links.intentSessionId}`)
  if (Array.isArray(links.runIds) && links.runIds.length > 0) facts.push(`- 交付运行：${links.runIds.join('、')}`)
  if (links.candidateId) facts.push(`- 候选：${links.candidateId}`)
  if (feedback?.observedWorkspace?.projectId) facts.push(`- 观察工作区项目：${feedback.observedWorkspace.projectId}`)
  facts.push(`- 反馈类别：${feedback?.category ?? 'undetermined'}`)
  facts.push(`- 上下文快照：${context.contextSnapshotId ?? '未分配'}（捕获于 ${context.capturedAt ?? '未记录'}）`)
  lines.push('## 上下文摘要', '', ...facts, '')
  lines.push('## 覆盖边界', '')
  lines.push('- 快照模式：current-only（只覆盖用户提交时冻结的当前上下文）')
  const notCovered =
    Array.isArray(boundary.notCoveredStages) && boundary.notCoveredStages.length > 0
      ? boundary.notCoveredStages.join('、')
      : '未记录的历史操作'
  lines.push(`- 未覆盖：${notCovered}`)
  lines.push('- 本需求由人工反馈生成（零模型调用），内容来自用户原话与冻结上下文事实，不含 AI 结论，也不表示优先级/方案已确认。')
  return lines.join('\n')
}

/**
 * Facts handed to `createRequirement` for its `## 反馈来源` section. Only ids,
 * enums and component names go in; the local root never reaches the brief.
 */
function feedbackMeta(feedback) {
  const context = isPlainObject(feedback?.context) ? feedback.context : {}
  return {
    id: feedback?.id ?? null,
    category: feedback?.category ?? null,
    conversionId: readText(feedback?.conversion?.id),
    observedWorkspace: isPlainObject(context.observedWorkspace)
      ? { projectId: context.observedWorkspace.projectId ?? null, workspaceId: context.observedWorkspace.workspaceId ?? null }
      : null,
    targetProduct: isPlainObject(context.targetProduct) ? context.targetProduct : null,
  }
}

/**
 * Persist the proposal for a generated requirement and mark it converted.
 * A proposal failure never rolls back the requirement that already exists; it
 * is reported as `proposal: null` instead of being invented.
 */
function saveConvertedProposal({ core, root, feedback, settings, requirement, now }) {
  try {
    if (typeof core.planProposal !== 'function') return null
    const plan = core.planProposal({ feedback, settings, now })
    if (!isPlainObject(plan)) return null
    let saved = null
    if (typeof core.saveProposal === 'function') {
      try {
        saved = unwrapRecord(core.saveProposal(root, plan))
      } catch {
        saved = null
      }
    }
    const proposalId = readText(saved?.id ?? plan.id ?? feedback?.proposalId)
    if (!proposalId) return saved ?? plan
    if (typeof core.updateProposal === 'function') {
      try {
        const out = core.updateProposal({
          root,
          proposalId,
          ...(Number.isInteger(saved?.revision) ? { expectedRevision: saved.revision } : {}),
          status: 'converted',
          requirement,
          actor: 'human:local',
          apply: true,
        })
        const updated = unwrapRecord(out?.proposal ?? out)
        if (updated) saved = updated
      } catch {
        // Keep the awaiting-confirmation proposal: the requirement reference is
        // still returned from the feedback record, nothing is fabricated.
      }
    }
    return saved ?? plan
  } catch {
    return null
  }
}

/** Serialize generate for one observation root + feedback id (double click). */
const generateLocks = new Map()
async function withGenerateLock(key, run) {
  const prior = generateLocks.get(key) ?? Promise.resolve()
  let release
  const gate = new Promise((resolveGate) => {
    release = resolveGate
  })
  const tail = prior.then(() => gate)
  generateLocks.set(key, tail)
  await prior
  try {
    return await run()
  } finally {
    release()
    if (generateLocks.get(key) === tail) generateLocks.delete(key)
  }
}

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

function handleRequirementRef({ core, root, query }) {
  const id = requireFeedbackId(queryValue(query, 'id') ?? queryValue(query, 'feedbackId'))
  const feedback = core.readFeedback(root, id)
  if (!isPlainObject(feedback)) {
    throw new FeedbackRequestError(404, 'feedback-not-found', `反馈不存在：${id}`)
  }
  const linked = isPlainObject(feedback.requirement) ? feedback.requirement : null
  const requirementId = readText(linked?.id)
  if (!requirementId) {
    throw new FeedbackRequestError(404, 'requirement-not-linked', '这条反馈还没有关联需求', { feedbackId: id })
  }
  const requirementRoot = readText(linked?.root) ?? root
  const destination = isPlainObject(feedback.routing?.destination) ? feedback.routing.destination : null
  const trusted = listWorkspacesSafe(core).find((workspace) => {
    const workspaceRoot = readText(workspace?.root)
    return workspaceRoot !== null && pathResolve(workspaceRoot) === pathResolve(requirementRoot)
  })
  let item = null
  try {
    const listing = listRequirements(requirementRoot)
    item = (Array.isArray(listing?.requirements) ? listing.requirements : []).find((entry) => entry?.id === requirementId) ?? null
  } catch {
    item = null
  }
  const decision = isPlainObject(item?.decision) ? item.decision : null
  const acceptance = isPlainObject(item?.acceptance) ? item.acceptance : null
  return ok(200, {
    schema: 'alm.feedback.requirement-ref/v1',
    feedbackId: id,
    found: Boolean(item),
    requirement: {
      workspaceId: readText(trusted?.workspaceId) ?? readText(destination?.workspaceId),
      projectId: readText(trusted?.projectId) ?? readText(destination?.projectId),
      root: requirementRoot,
      file: readText(item?.file) ?? readText(linked?.file),
      id: requirementId,
      revision: Number.isInteger(item?.revision) ? item.revision : Number.isInteger(linked?.revision) ? linked.revision : null,
      title: readText(item?.title),
      status: readText(item?.status) ?? 'proposed',
      decision: decision
        ? {
            state: readText(decision.state),
            label: readText(decision.label),
            topGap: isPlainObject(decision.topGap)
              ? { code: readText(decision.topGap.code), message: readText(decision.topGap.message) }
              : null,
          }
        : null,
      acceptance: acceptance
        ? {
            registered: acceptance.registered === true,
            commandCount: Number.isInteger(acceptance.commandCount) ? acceptance.commandCount : null,
            latest: isPlainObject(acceptance.latest)
              ? {
                  result: readText(acceptance.latest.result),
                  current: acceptance.latest.current === true,
                  at: readText(acceptance.latest.finishedAt),
                }
              : null,
          }
        : null,
    },
    // Spelled out so the UI never equates "requirement created" or "tests
    // passed" with "the reported problem is solved".
    resolutionHint: readText(item?.status) === 'archived'
      ? '需求已归档；仍需人工确认原问题是否解决，然后再标记反馈为已验证。'
      : '需求已生成或推进中；测试通过不等于原问题解决，需要人工验证后标记。',
  })
}

function handleAttachmentGet({ core, root, query }) {
  // Attachments are stored as content-addressed bytes; the record only keeps a
  // reference. Reading one back is a root-bound, read-only operation.
  const sha256 = String(queryValue(query, 'sha256') ?? '').toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    throw new FeedbackRequestError(400, 'attachment-invalid', '附件引用无效')
  }
  const stored = typeof core.readAttachment === 'function' ? core.readAttachment({ root, sha256 }) : null
  if (!stored?.file) throw new FeedbackRequestError(404, 'attachment-not-found', '找不到这个附件')
  const data = readFileSync(stored.file)
  const extension = stored.file.split('.').pop()
  const type = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', txt: 'text/plain', md: 'text/markdown', json: 'application/json' }[extension] ?? 'application/octet-stream'
  return ok(200, {
    schema: 'alm.feedback.attachment-read/v1',
    attachment: { sha256, type, size: data.byteLength, dataBase64: data.toString('base64') },
  })
}

function handleGet({ core, root, action, query }) {
  if (!GET_ACTIONS.has(action)) {
    throw new FeedbackRequestError(404, 'feedback-action-unknown', `未知的反馈操作：${action}`)
  }
  if (action === 'diagnostics') {
    // Build identity lets the UI prove whether the bundle it runs can actually
    // see saved feedback fields (e.g. observedAt/capture); without it a stale
    // host bundle looks identical to a backend bug.
    return ok(200, { schema: 'alm.feedback.build/v1', ...feedbackBuildInfo() })
  }
  if (action === 'proposal') {
    return handleProposalGet({ core, root, query })
  }
  if (action === 'requirement-ref') {
    return handleRequirementRef({ core, root, query })
  }
  if (action === 'attachment') {
    return handleAttachmentGet({ core, root, query })
  }
  if (action === 'inbox') {
    // Interrupted background work becomes queued again instead of staying
    // stuck in `analyzing` after a crash or restart.
    if (typeof core.recoverFeedbackProcessing === 'function') {
      try {
        core.recoverFeedbackProcessing({ root })
      } catch {
        // reading the inbox must not fail because recovery failed
      }
    }
    // Filters only narrow the returned items; counts stay global so the
    // operator still sees the real backlog.
    const filter = {
      status: readText(queryValue(query, 'status')),
      category: readText(queryValue(query, 'category')),
      disposition: readText(queryValue(query, 'disposition')),
      resolution: readText(queryValue(query, 'resolution')),
      page: readText(queryValue(query, 'page')),
      stage: readText(queryValue(query, 'stage')),
      q: readText(queryValue(query, 'q')),
      limit: Number.parseInt(String(queryValue(query, 'limit') ?? ''), 10),
    }
    let inbox = null
    try {
      inbox = core.feedbackInbox(root, filter)
    } catch {
      inbox = null
    }
    const items = Array.isArray(inbox?.items) ? inbox.items.map(publicInboxItem).filter(Boolean) : []
    return ok(200, {
      schema: 'alm.feedback.inbox/v1',
      counts: normaliseCounts(inbox?.counts),
      total: Number.isInteger(inbox?.total) ? inbox.total : items.length,
      shown: Number.isInteger(inbox?.shown) ? inbox.shown : items.length,
      filter: Object.fromEntries(Object.entries(filter).filter(([, value]) => value !== null && value !== undefined && value !== '' && !(typeof value === 'number' && !Number.isInteger(value)))),
      items,
      settings: readSettings(core, root),
      workspaces: workspacesWithWritable(core),
    })
  }
  if (action === 'record') {
    const id = requireFeedbackId(queryValue(query, 'id') ?? queryValue(query, 'feedbackId'))
    const feedback = core.readFeedback(root, id)
    if (!isPlainObject(feedback)) {
      throw new FeedbackRequestError(404, 'feedback-not-found', `反馈不存在：${id}`)
    }
    return ok(200, {
      schema: 'alm.feedback.detail/v1',
      feedback,
      proposal: readProposal(core, root, feedback),
      requirement: isPlainObject(feedback.requirement) ? feedback.requirement : null,
    })
  }
  return ok(200, {
    schema: 'alm.feedback.settings/v1',
    settings: readSettings(core, root),
    workspaces: workspacesWithWritable(core),
  })
}

// ---------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------

function handleSave({ core, root, body }) {
  const statement = normaliseStatement(body.statement)
  const category = normaliseCategory(core, body.category)
  const clientRequestId = readText(body.clientRequestId)
  if (clientRequestId && clientRequestId.length > MAX_CLIENT_REQUEST_ID) {
    throw new FeedbackRequestError(400, 'client-request-id-too-long', `幂等键超过 ${MAX_CLIENT_REQUEST_ID} 字符`)
  }
  const now = nowIso()
  const workspaces = listWorkspacesSafe(core)
  const observed = observedWorkspaceFor(workspaces, root)
  const settings = readSettings(core, root)
  const destination = resolveSaveDestination({ core, body, settings })
  // Core validates the destination and derives routed/needs-routing itself. An
  // explicit `null` means "no destination", never "fall back to settings".
  const destinationInput =
    destination.source === 'explicit'
      ? destinationOf(destination.workspace)
      : destination.source === 'explicit-none'
        ? {}
        : undefined

  const rawContext = assembleContext({ body, statement, now, observed })

  // Attachments are bytes, not context: persist them content-addressed first and
  // put only durable references into the recorded context. A client can never
  // smuggle base64 into the record or point at an arbitrary path.
  const requestedAttachments = Array.isArray(body.attachments) ? body.attachments : []
  if (requestedAttachments.length > 3) {
    throw new FeedbackRequestError(400, 'attachment-too-many', '一次最多附带 3 个附件')
  }
  let attachmentRefs = []
  if (requestedAttachments.length > 0) {
    if (typeof core.saveAttachment !== 'function') {
      throw new FeedbackRequestError(500, 'module-stale', '附件存储模块不可用（需重启宿主）')
    }
    let totalBytes = 0
    try {
      for (const entry of requestedAttachments) {
        if (!isPlainObject(entry)) continue
        const ref = core.saveAttachment({ root, name: entry.name, type: entry.type, dataBase64: entry.dataBase64 })
        totalBytes += ref.size
        if (totalBytes > 4 * 1024 * 1024) {
          throw new FeedbackRequestError(413, 'attachment-too-large', '附件总大小超出上限（4 MB）')
        }
        attachmentRefs.push(ref)
      }
    } catch (error) {
      if (error instanceof FeedbackRequestError) throw error
      throw new FeedbackRequestError(
        Number.isInteger(error?.status) ? error.status : 400,
        error?.code ?? 'attachment-invalid',
        `附件保存失败：${error?.message ?? String(error)}`,
      )
    }
    if (attachmentRefs.length > 0) {
      rawContext.evidence = { ...(isPlainObject(rawContext.evidence) ? rawContext.evidence : {}), attachments: attachmentRefs }
    }
  }
  // A draft captured in workspace A must not be saved into workspace B just
  // because the request root changed underneath it. The client freezes its
  // workspace root when the panel opens; a mismatch is a conflict the user has
  // to see, not something to silently re-home.
  const frozenRoot = readText(body.context?.observedRoot)
  if (frozenRoot) {
    const normalizeRootPath = (value) => String(value ?? '').trim().replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()
    if (normalizeRootPath(frozenRoot) !== normalizeRootPath(root)) {
      throw new FeedbackRequestError(
        409,
        'workspace-changed',
        '这条反馈是在另一个工作区打开的；请回到原工作区提交，或在新工作区重新写一条。',
      )
    }
  }
  if (typeof core.saveFeedback !== 'function') {
    throw new FeedbackRequestError(500, 'module-stale', '反馈存储模块不可用（需重启宿主）')
  }
  let result
  try {
    result = core.saveFeedback({
      root,
      statement,
      ...(category ? { category } : {}),
      context: rawContext,
      ...(clientRequestId ? { clientRequestId } : {}),
      ...(destinationInput !== undefined ? { destination: destinationInput } : {}),
      includeAttachments: attachmentRefs.length > 0,
      now,
    })
  } catch (error) {
    throw new FeedbackRequestError(
      Number.isInteger(error?.status) ? error.status : 500,
      error?.code ?? 'feedback-save-failed',
      `反馈保存失败：${error?.message ?? String(error)}`,
      error?.details,
    )
  }
  let feedback = unwrapRecord(result?.feedback ?? result?.record ?? null)
  if (!feedback?.id) {
    throw new FeedbackRequestError(500, 'feedback-save-failed', '反馈保存失败：未返回记录')
  }
  const changed = result?.changed === true

  // Queue background organisation. Saving must never depend on it: if queuing
  // fails the receipt above is still the truth and the record stays readable.
  if (typeof core.enqueueFeedbackProcessing === 'function' && feedback.status !== 'requirement-created') {
    try {
      const queued = core.enqueueFeedbackProcessing({ root, id: feedback.id, now })
      if (isPlainObject(queued?.feedback)) feedback = queued.feedback
    } catch {
      // best-effort only
    }
  }

  const storedRouting = isPlainObject(feedback.routing) ? feedback.routing : {}
  const routing = {
    status: feedback.status ?? null,
    reason: storedRouting.reason ?? null,
    destination: storedRouting.destination ?? null,
  }

  return ok(200, {
    ok: true,
    feedback: {
      id: feedback.id,
      status: feedback.status ?? null,
      revision: feedback.revision ?? 1,
      createdAt: feedback.createdAt ?? now,
    },
    receipt: {
      feedbackId: feedback.id,
      savedAt: feedback.updatedAt ?? now,
      changed,
      observedAt: feedback.context?.observedAt ?? null,
      receivedAt: feedback.receivedAt ?? null,
      build: feedbackBuildInfo(),
    },
    routing,
    inbox: { counts: countsFor(core, root) },
  })
}

function requireProcessingCore(core) {
  const required = ['recoverFeedbackProcessing', 'listFeedbackProcessing', 'updateFeedbackProcessing', 'planProposal', 'saveProposal']
  const missing = required.filter((name) => typeof core[name] !== 'function')
  if (missing.length > 0) {
    throw new FeedbackRequestError(500, 'module-stale', `反馈整理模块不可用（缺少 ${missing.join(', ')}，需重启宿主）`)
  }
}

function processLimit(value, fallback = 3) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback
  return Math.min(parsed, 5)
}

/**
 * Generate/refresh proposals for queued feedback.
 *
 * This is the durable background step: the save path only marks a record
 * `queued`; this action turns queued work into `awaiting-confirmation`
 * proposals, one record at a time, and records failures on the record instead
 * of losing them. It is intentionally bounded (<= 5 records per call) and
 * model-free: the proposal is marked `analysis.kind === 'raw'` so callers can
 * tell an unanalysed candidate from an analysed one.
 */
async function handleProcess({ core, root, body }) {
  requireProcessingCore(core)
  try {
    core.recoverFeedbackProcessing({ root })
  } catch {
    // Recovery is best-effort; processing itself still records its own failure.
  }
  const only = readText(body.id)
  const settings = readSettings(core, root)
  return withGenerateLock(`${root}\u0000feedback-process`, async () => {
    let queue
    if (only) {
      const feedback = core.readFeedback(root, only)
      if (!isPlainObject(feedback)) throw new FeedbackRequestError(404, 'feedback-not-found', `反馈不存在：${only}`)
      queue = [feedback]
    } else {
      queue = core.listFeedbackProcessing(root).slice(0, processLimit(body.limit))
    }
    const processed = []
    for (const record of queue) {
      const at = nowIso()
      core.updateFeedbackProcessing({ root, id: record.id, patch: { state: 'analyzing' }, now: at })
      try {
        const planned = core.planProposal({ feedback: record, settings, now: at })
        const saved = core.saveProposal(root, planned)
        core.updateFeedbackProcessing({
          root,
          id: record.id,
          patch: { state: 'draft-ready', proposalId: saved?.id ?? null, analysis: saved?.analysis ?? planned.analysis },
          now: nowIso(),
        })
        processed.push({ id: record.id, state: 'draft-ready', proposalId: saved?.id ?? null })
      } catch (error) {
        core.updateFeedbackProcessing({
          root,
          id: record.id,
          patch: { state: 'failed', lastError: readText(error?.message) ?? String(error) },
          now: nowIso(),
        })
        processed.push({
          id: record.id,
          state: 'failed',
          error: readText(error?.code) ?? 'processing-failed',
          message: readText(error?.message) ?? null,
        })
      }
    }
    let remaining = 0
    try {
      remaining = core.listFeedbackProcessing(root).length
    } catch {
      remaining = 0
    }
    return ok(200, { ok: true, processed, remaining })
  })
}

function handleProposalGet({ core, root, query }) {
  const proposalId = readText(queryValue(query, 'proposalId'))
  const feedbackId = readText(queryValue(query, 'id') ?? queryValue(query, 'feedbackId'))
  let proposal = null
  if (proposalId) {
    if (typeof core.readProposal !== 'function') {
      throw new FeedbackRequestError(500, 'module-stale', '提案模块不可用（需重启宿主）')
    }
    proposal = core.readProposal(root, proposalId)
  } else if (feedbackId) {
    proposal = readProposal(core, root, core.readFeedback(root, feedbackId))
  } else {
    throw new FeedbackRequestError(400, 'proposal-id-required', '需要 proposalId 或 feedback id')
  }
  if (!isPlainObject(proposal)) {
    throw new FeedbackRequestError(404, 'proposal-not-found', `提案不存在：${proposalId ?? feedbackId ?? ''}`)
  }
  return ok(200, { ok: true, proposal })
}

function handleProposalConfirm({ core, root, body }) {
  if (typeof core.confirmProposal !== 'function') {
    throw new FeedbackRequestError(500, 'module-stale', '提案确认模块不可用（需重启宿主）')
  }
  let proposalId = readText(body.proposalId)
  if (!proposalId) {
    const feedbackId = requireFeedbackId(body.id)
    const feedback = core.readFeedback(root, feedbackId)
    if (!isPlainObject(feedback)) throw new FeedbackRequestError(404, 'feedback-not-found', `反馈不存在：${feedbackId}`)
    proposalId = readText(feedback.proposalId) ?? readText(feedback.processing?.proposalId)
  }
  if (!proposalId) throw new FeedbackRequestError(400, 'proposal-id-required', '这条反馈还没有候选，先整理再确认')
  const expectedRevision = Number.isInteger(body.expectedRevision) ? body.expectedRevision : null
  let result
  try {
    result = core.confirmProposal({
      root,
      proposalId,
      expectedRevision,
      actor: readText(body.actor) ?? 'human:local',
      notes: readText(body.notes) ?? '',
    })
  } catch (error) {
    throw new FeedbackRequestError(
      Number.isInteger(error?.status) ? error.status : 400,
      error?.code ?? 'proposal-confirm-failed',
      `候选确认失败：${error?.message ?? String(error)}`,
    )
  }
  const proposal = isPlainObject(result?.proposal) ? result.proposal : null
  if (!proposal) throw new FeedbackRequestError(500, 'proposal-confirm-failed', '候选确认没有返回提案')
  return ok(200, { ok: true, proposal, changed: result?.changed === true })
}

async function handleGenerate({ core, root, body }) {
  const id = requireFeedbackId(body.id)
  const priority = readText(body.priority)
  if (!priority) {
    throw new FeedbackRequestError(422, 'priority-required', '生成需求前必须显式选择优先级（P0/P1/P2）', { feedbackId: id })
  }
  if (!PRIORITIES.has(priority)) {
    throw new FeedbackRequestError(422, 'priority-required', '优先级必须是 P0/P1/P2', { feedbackId: id })
  }
  return withGenerateLock(`${root}\u0000${id}`, async () => {
    const now = nowIso()
    let feedback = core.readFeedback(root, id)
    if (!isPlainObject(feedback)) {
      throw new FeedbackRequestError(404, 'feedback-not-found', `反馈不存在：${id}`)
    }
    // Idempotent replay: the requirement already exists, return the same one.
    if (feedback.status === 'requirement-created' && readText(feedback.requirement?.id)) {
      const proposal = readProposal(core, root, feedback)
      return ok(200, {
        ok: true,
        feedback,
        requirement: { root: feedback.requirement.root ?? null, id: feedback.requirement.id },
        proposal: proposal ? { id: proposal.id ?? null, fingerprint: proposal.fingerprint ?? null } : null,
        receipt: { feedbackId: id, requirementId: feedback.requirement.id, changed: false },
      })
    }

    // Confirmation gate: an organised candidate must be confirmed by a human
    // before it may become an executable requirement. Legacy records without a
    // proposal keep the old behaviour.
    const existingProposal = readProposal(core, root, feedback)
    if (existingProposal && existingProposal.status !== 'confirmed' && existingProposal.status !== 'converted') {
      throw new FeedbackRequestError(409, 'proposal-unconfirmed', '这条反馈的候选还没确认，确认后才能转成需求', {
        feedbackId: id,
        proposalId: existingProposal.id ?? null,
        proposalStatus: existingProposal.status ?? null,
      })
    }

    const settings = readSettings(core, root)
    const workspace = resolveGenerateDestination({ core, body, feedback, settings })
    if (!workspace) {
      if (feedback.status !== 'needs-routing') {
        try {
          const routed = routeToDestination(core, root, id, null, now, 'no-destination')
          if (routed) feedback = routed
        } catch {
          // Keep the stored state when the route attempt is rejected; the 422
          // below is the truthful outcome either way.
        }
      }
      throw new FeedbackRequestError(422, 'destination-not-configured', '尚未配置接收工作区，反馈已保留为待路由', {
        feedbackId: id,
        status: feedback?.status ?? 'needs-routing',
      })
    }
    const check = probeDestination(core, workspace, true)
    if (!check.ok) {
      const code = destinationCode(check)
      const failed = markFailed(core, root, id, { code, message: check.message, at: now }, now)
      if (failed) feedback = failed
      throw new FeedbackRequestError(422, code, check.message, {
        feedbackId: id,
        status: feedback?.status ?? 'failed',
      })
    }

    const destinationRoot = workspace.root
    const title = buildTitle(body.title, feedback.statement)
    const goal = readText(body.goal) ?? readText(feedback.context?.userStatement?.expected) ?? ''
    // Record the conversion intent before creating anything in the destination
    // project. If linking fails or the process dies, a retry reconciles with the
    // requirement already created instead of creating a duplicate.
    if (typeof core.beginFeedbackConversion === 'function') {
      try {
        const begun = unwrapRecord(core.beginFeedbackConversion({ root, id, now }))
        if (begun) feedback = begun
      } catch {
        // The conversion record is a recovery aid; never block the write for it.
      }
    }
    const existingRequirementId = readText(feedback?.conversion?.requirementId)
    const existingRequirementRoot = readText(feedback?.conversion?.requirementRoot) ?? destinationRoot
    let requirementId = existingRequirementId
    // Dedupe hard prerequisite: before creating, look for an already-converted
    // proposal with the same fingerprint in this feedback workspace. Two
    // different reports describing the same problem must point at one
    // requirement instead of creating a duplicate.
    let reusedFromFingerprint = false
    let requirementRootForRef = existingRequirementId ? existingRequirementRoot : destinationRoot
    if (!requirementId && typeof core.listProposals === 'function' && typeof core.planProposal === 'function') {
      try {
        const planned = core.planProposal({ feedback, settings, now })
        const fingerprint = readText(planned?.fingerprint)
        if (fingerprint) {
          const converted = (core.listProposals(root) ?? []).find((entry) =>
            entry?.status === 'converted' &&
            entry?.fingerprint === fingerprint &&
            readText(entry?.requirementRef?.id) !== null,
          )
          if (converted) {
            const candidateRoot = readText(converted.requirementRef?.root) ?? destinationRoot
            const candidateId = readText(converted.requirementRef?.id)
            let exists = false
            try {
              const listed = listRequirements(candidateRoot)
              const rows = listed?.requirements ?? listed?.items ?? []
              exists = rows.some((row) => readText(row?.id) === candidateId)
            } catch {
              exists = false
            }
            if (exists) {
              requirementId = candidateId
              requirementRootForRef = candidateRoot
              reusedFromFingerprint = true
              if (typeof core.updateFeedbackConversion === 'function') {
                try {
                  core.updateFeedbackConversion({ root, id, patch: { state: 'created', requirementId, requirementRoot: candidateRoot, note: '同一问题已有需求，复用并关联' }, now })
                } catch {
                  // Conversion metadata is best-effort; linking below still carries the id.
                }
              }
            }
          }
        }
      } catch {
        // Dedupe is advisory: never block a real conversion on a store read.
      }
    }
    if (!requirementId) {
      let created
      try {
        created = core.createRequirement({
          root: destinationRoot,
          title,
          brief: buildBrief(feedback),
          ...(goal ? { goal } : {}),
          priority,
          source: 'feedback',
          feedback: feedbackMeta(feedback),
          apply: true,
        })
      } catch (error) {
        const failure = {
          code: readText(error?.code) ?? 'requirement-create-failed',
          message: readText(error?.message) ?? '写入改进需求失败',
          at: now,
        }
        if (typeof core.updateFeedbackConversion === 'function') {
          try {
            core.updateFeedbackConversion({ root, id, patch: { state: 'pending', note: failure.message }, now })
          } catch {
            // Keep the original failure truthful.
          }
        }
        const failed = markFailed(core, root, id, failure, now)
        if (failed) feedback = failed
        throw new FeedbackRequestError(
          Number.isInteger(error?.status) ? error.status : 500,
          failure.code,
          `写入改进需求失败：${failure.message}`,
          { feedbackId: id },
        )
      }
      requirementId = readText(created?.requirementId ?? created?.id)
      if (!requirementId) {
        markFailed(core, root, id, { code: 'requirement-create-failed', message: 'createRequirement 未返回需求 id', at: now }, now)
        throw new FeedbackRequestError(500, 'requirement-create-failed', '写入改进需求失败：未返回需求 id', { feedbackId: id })
      }
      if (typeof core.updateFeedbackConversion === 'function') {
        try {
          const recorded = unwrapRecord(
            core.updateFeedbackConversion({ root, id, patch: { state: 'created', requirementId, requirementRoot: destinationRoot }, now }),
          )
          if (recorded) feedback = recorded
        } catch {
          // Linking below still has the requirement id in hand.
        }
      }
    }
    const requirementRef = { root: requirementRootForRef, id: requirementId, revision: 1 }
    // The proposal is saved before the requirement link is written to the
    // feedback record, so `markFeedbackRequirement` can link both at once.
    const proposal = saveConvertedProposal({ core, root, feedback, settings, requirement: requirementRef, now })
    const proposalId = readText(proposal?.id ?? feedback?.proposalId)
    if (typeof core.markFeedbackRequirement === 'function') {
      try {
        const marked = unwrapRecord(
          core.markFeedbackRequirement({
            root,
            id,
            requirement: requirementRef,
            ...(proposalId ? { proposalId } : {}),
            now,
          }),
        )
        if (marked) feedback = marked
      } catch (error) {
        const message = `需求已创建但反馈状态未更新：${error?.message ?? String(error)}`
        if (typeof core.updateFeedbackConversion === 'function') {
          try {
            core.updateFeedbackConversion({ root, id, patch: { state: 'created', requirementId, requirementRoot: requirementRef.root, note: message }, now })
          } catch {
            // The retryable 409 below is the truthful outcome either way.
          }
        }
        // Keep the inconsistency on the record: a retry must reconcile this
        // requirement instead of creating a second one.
        if (typeof core.markFeedbackReconciliation === 'function') {
          try {
            core.markFeedbackReconciliation({ root, id, state: 'link-failed', requirementId, note: message, now })
          } catch {
            // best-effort; the 409 already carries the requirement id
          }
        }
        throw new FeedbackRequestError(409, 'feedback-link-failed', message, {
          feedbackId: id,
          requirementId,
          retryable: true,
        })
      }
      if (typeof core.updateFeedbackConversion === 'function') {
        try {
          const linked = unwrapRecord(
            core.updateFeedbackConversion({ root, id, patch: { state: 'linked', requirementId, requirementRoot: requirementRef.root }, now }),
          )
          if (linked) feedback = linked
          if (typeof core.markFeedbackReconciliation === 'function') {
            try {
              core.markFeedbackReconciliation({ root, id, state: 'resolved', requirementId, note: '已关联，需求与反馈对账一致', now })
            } catch {
              // Clearing a stale inconsistency note must not fail the receipt.
            }
          }
        } catch {
          // The requirement is created and linked; the audit field is best-effort.
        }
      }
    }
    return ok(200, {
      ok: true,
      feedback,
      requirement: requirementRef,
      proposal: proposal ? { id: proposal.id ?? null, fingerprint: proposal.fingerprint ?? null } : null,
      deduplicated: reusedFromFingerprint,
      receipt: { feedbackId: id, requirementId, changed: true, createdAt: now },
    })
  })
}

function handleSettings({ core, root, body }) {
  const now = nowIso()
  const current = readSettings(core, root)
  const actor = readText(body.actor) ?? 'human:local'
  let destination = isPlainObject(current.destinationWorkspace) ? current.destinationWorkspace : null
  const hasId = hasOwn(body, 'destinationWorkspaceId')
  const hasObject = hasOwn(body, 'destinationWorkspace')
  if (hasId || hasObject) {
    const raw = hasId
      ? body.destinationWorkspaceId
      : isPlainObject(body.destinationWorkspace)
        ? body.destinationWorkspace.workspaceId ?? body.destinationWorkspace.projectId ?? null
        : body.destinationWorkspace
    if (raw === null || readText(raw) === null) {
      destination = null
    } else {
      const workspace = workspaceFromRef(listWorkspacesSafe(core), raw)
      if (!workspace) {
        throw new FeedbackRequestError(422, 'destination-not-configured', '接收工作区不在可信工作区列表中')
      }
      destination = destinationOf(workspace)
    }
  }
  const next = {
    ...current,
    schema: 'alm.feedback.settings/v1',
    destinationWorkspace: destination,
    ...(isPlainObject(body.coverage) ? { coverage: body.coverage } : {}),
    ...(isPlainObject(body.capture) ? { capture: body.capture } : {}),
    updatedAt: now,
    updatedBy: actor,
  }
  if (typeof core.writeFeedbackSettings !== 'function') {
    throw new FeedbackRequestError(500, 'module-stale', '反馈设置模块不可用（需重启宿主）')
  }
  let result
  try {
    result = core.writeFeedbackSettings({ root, settings: next, actor, apply: body.apply !== false })
  } catch (error) {
    throw new FeedbackRequestError(
      Number.isInteger(error?.status) ? error.status : 400,
      error?.code ?? 'settings-invalid',
      `反馈设置未保存：${error?.message ?? String(error)}`,
    )
  }
  if (result?.applied === false) {
    throw new FeedbackRequestError(500, 'settings-not-applied', '反馈设置未写入')
  }
  return ok(200, { ok: true, settings: isPlainObject(result?.settings) ? result.settings : readSettings(core, root) })
}

function handleRetry({ core, root, body }) {
  const id = requireFeedbackId(body.id)
  const now = nowIso()
  let feedback = core.readFeedback(root, id)
  if (!isPlainObject(feedback)) {
    throw new FeedbackRequestError(404, 'feedback-not-found', `反馈不存在：${id}`)
  }
  if (feedback.status === 'requirement-created') {
    return ok(200, { ok: true, feedback })
  }
  const settings = readSettings(core, root)
  const workspace = resolveGenerateDestination({ core, body, feedback, settings })
  if (!workspace) {
    throw new FeedbackRequestError(422, 'destination-not-configured', '尚未配置接收工作区，反馈仍为待路由', {
      feedbackId: id,
      status: feedback.status ?? 'needs-routing',
    })
  }
  const check = probeDestination(core, workspace, true)
  if (!check.ok) {
    const code = destinationCode(check)
    const failed = markFailed(core, root, id, { code, message: check.message, at: now }, now)
    if (failed) feedback = failed
    throw new FeedbackRequestError(422, code, check.message, { feedbackId: id, status: feedback?.status ?? 'failed' })
  }
  const routed = routeToDestination(core, root, id, workspace, now, null)
  if (routed) feedback = routed
  return ok(200, {
    ok: true,
    feedback,
    routing: {
      status: feedback.status ?? null,
      reason: null,
      destination: destinationOf(workspace),
    },
  })
}

function handleCategory({ core, root, body }) {
  const id = requireFeedbackId(body.id)
  const category = normaliseCategory(core, body.category, { required: true })
  const now = nowIso()
  const feedback = core.readFeedback(root, id)
  if (!isPlainObject(feedback)) {
    throw new FeedbackRequestError(404, 'feedback-not-found', `反馈不存在：${id}`)
  }
  if (typeof core.updateFeedbackCategory !== 'function') {
    throw new FeedbackRequestError(500, 'module-stale', '反馈类别更新模块不可用（需重启宿主）')
  }
  let updated
  try {
    updated = unwrapRecord(
      core.updateFeedbackCategory({
        root,
        feedbackId: id,
        category,
        ...(readText(body.notes) ? { notes: readText(body.notes) } : {}),
        actor: readText(body.actor) ?? 'human:local',
        apply: true,
      }),
    )
  } catch (error) {
    throw new FeedbackRequestError(
      Number.isInteger(error?.status) ? error.status : 500,
      error?.code ?? 'category-update-failed',
      `反馈类别未更新：${error?.message ?? String(error)}`,
    )
  }
  if (!updated) throw new FeedbackRequestError(500, 'category-update-failed', '反馈类别未更新')
  return ok(200, { ok: true, feedback: updated })
}

function requireCoreFunction(core, name) {
  if (typeof core[name] !== 'function') {
    throw new FeedbackRequestError(500, 'module-stale', `反馈模块缺少 ${name}（需重启宿主）`)
  }
}

function coreFailure(error, fallbackCode, message) {
  return new FeedbackRequestError(
    Number.isInteger(error?.status) ? error.status : 500,
    error?.code ?? fallbackCode,
    `${message}：${error?.message ?? String(error)}`,
  )
}

function requireStoredFeedback(core, root, id) {
  const feedback = core.readFeedback(root, id)
  if (!isPlainObject(feedback)) {
    throw new FeedbackRequestError(404, 'feedback-not-found', `反馈不存在：${id}`)
  }
  return feedback
}

function handleSupplement({ core, root, body }) {
  const id = requireFeedbackId(body.id)
  const statement = readText(body.statement)
  if (!statement) throw new FeedbackRequestError(400, 'statement-required', '补充内容不能为空')
  if (statement.length > MAX_STATEMENT) {
    throw new FeedbackRequestError(413, 'statement-too-long', `补充内容不能超过 ${MAX_STATEMENT} 字`)
  }
  requireStoredFeedback(core, root, id)
  requireCoreFunction(core, 'appendSupplement')
  let updated
  try {
    updated = unwrapRecord(core.appendSupplement({
      root,
      id,
      statement,
      ...(readText(body.note) ? { note: readText(body.note) } : {}),
      context: isPlainObject(body.context) ? body.context : null,
      supplementId: readText(body.supplementId),
      actor: readText(body.actor) ?? 'human:local',
      observedAt: readText(body.observedAt),
    }))
  } catch (error) {
    throw coreFailure(error, 'supplement-failed', '补充未保存')
  }
  if (!updated) throw new FeedbackRequestError(500, 'supplement-failed', '补充未保存')
  return ok(200, { ok: true, feedback: updated })
}

function handleLink({ core, root, body }) {
  const id = requireFeedbackId(body.id)
  const requirement = isPlainObject(body.requirement) ? body.requirement : null
  if (!readText(requirement?.id)) {
    throw new FeedbackRequestError(400, 'requirement-required', '关联需要 requirement.id')
  }
  const feedback = requireStoredFeedback(core, root, id)
  // Link against the trusted routed destination, never a client path.
  const linkRoot = readText(feedback?.routing?.destination?.root) ?? root
  requireCoreFunction(core, 'markFeedbackRequirement')
  let updated
  try {
    updated = core.markFeedbackRequirement({
      root,
      id,
      requirement: {
        root: linkRoot,
        id: readText(requirement.id),
        ...(requirement.revision === undefined ? {} : { revision: requirement.revision }),
      },
      proposalId: readText(body.proposalId),
    })
  } catch (error) {
    throw coreFailure(error, 'link-failed', '关联需求未保存')
  }
  if (typeof core.updateFeedbackDisposition === 'function') {
    try {
      const disposition = unwrapRecord(core.updateFeedbackDisposition({
        root,
        id,
        disposition: 'linked',
        reason: `关联需求 ${readText(requirement.id)}`,
        actor: readText(body.actor) ?? 'human:local',
      }))
      if (disposition) updated = disposition
    } catch {
      // linking itself already succeeded; a missing disposition must not undo it
    }
  }
  return ok(200, { ok: true, feedback: updated })
}

function handleDisposition({ core, root, body }) {
  const id = requireFeedbackId(body.id)
  const disposition = readText(body.disposition)
  if (!disposition) throw new FeedbackRequestError(400, 'disposition-required', '缺少 disposition')
  requireStoredFeedback(core, root, id)
  requireCoreFunction(core, 'updateFeedbackDisposition')
  let updated
  try {
    updated = unwrapRecord(core.updateFeedbackDisposition({
      root,
      id,
      disposition,
      reason: readText(body.reason) ?? '',
      actor: readText(body.actor) ?? 'human:local',
    }))
  } catch (error) {
    throw coreFailure(error, 'disposition-failed', '反馈处置未保存')
  }
  if (!updated) throw new FeedbackRequestError(500, 'disposition-failed', '反馈处置未保存')
  return ok(200, { ok: true, feedback: updated })
}

function handleResolution({ core, root, body, state }) {
  const id = requireFeedbackId(body.id)
  requireStoredFeedback(core, root, id)
  requireCoreFunction(core, 'updateFeedbackResolution')
  let updated
  try {
    updated = unwrapRecord(core.updateFeedbackResolution({
      root,
      id,
      state,
      note: readText(body.note) ?? '',
      evidence: isPlainObject(body.evidence) ? body.evidence : null,
      actor: readText(body.actor) ?? 'human:local',
    }))
  } catch (error) {
    throw coreFailure(error, `${state}-failed`, state === 'resolved' ? '解决状态未保存' : '重开状态未保存')
  }
  if (!updated) throw new FeedbackRequestError(500, `${state}-failed`, '解决状态未保存')
  return ok(200, { ok: true, feedback: updated })
}

function handlePost({ core, root, action, body }) {
  if (action === 'save') return handleSave({ core, root, body })
  if (action === 'generate') return handleGenerate({ core, root, body })
  if (action === 'settings') return handleSettings({ core, root, body })
  if (action === 'retry') return handleRetry({ core, root, body })
  if (action === 'category') return handleCategory({ core, root, body })
  if (action === 'supplement') return handleSupplement({ core, root, body })
  if (action === 'link') return handleLink({ core, root, body })
  if (action === 'disposition') return handleDisposition({ core, root, body })
  if (action === 'resolve') return handleResolution({ core, root, body, state: 'resolved' })
  if (action === 'reopen') return handleResolution({ core, root, body, state: 'reopened' })
  if (action === 'process') return handleProcess({ core, root, body })
  if (action === 'proposal-confirm') return handleProposalConfirm({ core, root, body })
  throw new FeedbackRequestError(404, 'feedback-action-unknown', `未知的反馈操作：${action}`)
}

/**
 * Dispatch one feedback HTTP request.
 *
 * @param {object} input
 * @param {string} input.root observation workspace root (from rootFor(req))
 * @param {string} input.method HTTP method
 * @param {object} [input.body] parsed JSON body
 * @param {URLSearchParams|object} [input.query] GET parameters
 * @param {object} [input.deps] core/listWorkspaces/createRequirement overrides
 * @returns {Promise<{status:number,payload:object}>}
 */
export async function handleFeedbackRequest({ root, method = 'GET', body = {}, query = null, deps = {} } = {}) {
  const core = resolveDeps(deps)
  const observationRoot = readText(root)
  const verb = String(method ?? 'GET').toUpperCase()
  try {
    if (!observationRoot) {
      throw new FeedbackRequestError(400, 'root-required', '缺少观察工作区 root')
    }
    const action =
      readText(body?.action) ??
      readText(queryValue(query, 'action')) ??
      (verb === 'GET' ? 'inbox' : null)
    if (!action) throw new FeedbackRequestError(400, 'action-required', '缺少 action')
    const normalisedAction = action.toLowerCase()
    if (verb === 'GET') {
      return await handleGet({ core, root: observationRoot, action: normalisedAction, query })
    }
    if (verb === 'POST') {
      if (!isPlainObject(body)) throw new FeedbackRequestError(400, 'invalid-json', '请求体必须是 JSON 对象')
      return await handlePost({ core, root: observationRoot, action: normalisedAction, body })
    }
    return fail(405, 'method-not-allowed', 'GET or POST required')
  } catch (error) {
    if (error instanceof FeedbackRequestError) {
      return fail(error.status, error.code, error.message, error.details)
    }
    return fail(
      Number.isInteger(error?.status) ? error.status : 500,
      error?.code ?? 'feedback-request-failed',
      error?.message ?? String(error),
      error?.details,
    )
  }
}

export { FeedbackRequestError }
