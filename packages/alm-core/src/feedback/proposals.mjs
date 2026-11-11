/**
 * Proposals derived from manual feedback.
 *
 * A proposal is a *problem statement*, not a solution: no acceptance scenarios,
 * effect checks, root causes or priorities are invented. The fingerprint is the
 * dedupe key; an open proposal with the same fingerprint is reused instead of
 * creating a duplicate.
 */
import {
  FEEDBACK_LIMITS,
  PROPOSAL_KINDS,
  PROPOSAL_SCHEMA,
  PROPOSAL_STATUSES,
  allocateProposalId,
  byteLength,
  feedbackError,
  isPlainObject,
  listStoredProposals,
  normalizeRequirementLink,
  nowIso,
  oneLine,
  readStoredProposal,
  sha256,
  toIso,
  writeStoredProposal,
} from './store.mjs'
import { feedbackProposalPath, isFeedbackProposalId, resolveRoot } from './paths.mjs'
import { redactText } from './redact.mjs'
import { existsSync } from 'node:fs'

const TARGET_PRODUCT = 'dsh-requirements-plugin'
const COMPONENTS = ['intent', 'review', 'run', 'acceptance', 'list']
const PAGE_COMPONENT = { intent: 'intent', review: 'review', run: 'run', acceptance: 'acceptance', list: 'list', detail: 'list' }

function normalizeFingerprintText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
}

export function proposalFingerprint({ targetProduct = TARGET_PRODUCT, targetComponent = '', problem = '', desiredOutcome = '' } = {}) {
  return sha256(
    `${targetProduct}|${targetComponent}|${normalizeFingerprintText(problem)}|${normalizeFingerprintText(desiredOutcome)}`,
  )
}

function kindForCategory(category) {
  if (category === 'defect') return 'defect'
  if (category === 'capability') return 'capability'
  if (category === 'experience') return 'improvement'
  return 'investigation'
}

function componentForContext(context) {
  const explicit = context?.targetProduct?.component
  if (typeof explicit === 'string' && COMPONENTS.includes(explicit)) return explicit
  const page = context?.ui?.page
  if (typeof page === 'string' && PAGE_COMPONENT[page]) return PAGE_COMPONENT[page]
  return null
}

function buildObservations(feedback, problem) {
  const excerpts = feedback?.context?.evidence?.textExcerpts
  if (!Array.isArray(excerpts) || excerpts.length === 0) {
    return [{ text: oneLine(problem, 500), evidenceRefs: [`context:${feedback?.context?.contextSnapshotId ?? feedback?.id ?? 'unknown'}`] }]
  }
  return excerpts.slice(0, 10).map((excerpt, index) => ({
    text: oneLine(excerpt?.text, 500),
    evidenceRefs: [`context:${feedback.context.contextSnapshotId}/evidence.textExcerpts[${index}]`],
  }))
}

/**
 * Pure planner: turn one routed feedback into an `awaiting-confirmation`
 * proposal. The id is assigned by `saveProposal`.
 */
export function planProposal({ feedback, settings = null, now } = {}) {
  if (!isPlainObject(feedback) || typeof feedback.id !== 'string') {
    throw feedbackError('invalid-feedback', 'planProposal 需要反馈记录', 400)
  }
  const context = isPlainObject(feedback.context) ? feedback.context : {}
  const statement = redactText(String(feedback.statement ?? '')).trim()
  const expected = typeof context.userStatement?.expected === 'string' ? redactText(context.userStatement.expected).trim() : ''
  const targetComponent = componentForContext(context)
  const destination = settings?.destinationWorkspace ?? feedback.routing?.destination ?? null
  const problem = statement === '' ? oneLine(feedback.statement, 500) : statement
  const fingerprint = proposalFingerprint({
    targetProduct: TARGET_PRODUCT,
    targetComponent: targetComponent ?? '',
    problem,
    desiredOutcome: expected,
  })
  const missingInformation = []
  if (expected === '') missingInformation.push('期望结果未填写')
  if (targetComponent === null) missingInformation.push('目标组件未确定')
  if (!destination) missingInformation.push('目标工作区未配置')

  const related = { feedbackIds: [feedback.id] }
  if (typeof context.links?.requirementId === 'string') related.requirementId = context.links.requirementId
  if (Array.isArray(context.links?.runIds) && context.links.runIds.length > 0) related.runIds = [...context.links.runIds]
  if (typeof context.links?.intentSessionId === 'string') related.intentSessionId = context.links.intentSessionId

  const at = toIso(now)
  return {
    schema: PROPOSAL_SCHEMA,
    id: '',
    revision: 1,
    origin: 'manual-feedback',
    kind: kindForCategory(feedback.category),
    targetProduct: TARGET_PRODUCT,
    targetComponent: targetComponent ?? 'list',
    destination: destination
      ? { workspaceId: destination.workspaceId ?? null, projectId: destination.projectId ?? null }
      : null,
    observedWorkspaces: [{ projectId: feedback.observedWorkspace?.projectId ?? null }],
    related,
    problem,
    desiredOutcome: expected,
    scope: '',
    exclusions: '',
    suggestedChange: '',
    acceptanceScenarios: [],
    effectCheck: null,
    observations: buildObservations(feedback, problem),
    evidenceRefs: [`context:${context.contextSnapshotId ?? feedback.id}`],
    // Facts are only what the user said or what was captured. Anything the
    // system inferred lives in hypotheses, so a reviewer can tell them apart.
    facts: [{ text: problem, source: 'user-statement' }],
    hypotheses: [],
    alternativeCauses: [],
    missingInformation,
    fingerprint,
    status: 'awaiting-confirmation',
    confirmation: { required: true, confirmedAt: null, confirmedBy: null, notes: '' },
    analysis: {
      kind: 'raw',
      model: null,
      analyzedAt: null,
      label: '原话候选，尚未分析',
    },
    requirementRef: null,
    createdAt: at,
    updatedAt: at,
  }
}

function validateProposalShape(proposal) {
  if (!isPlainObject(proposal)) throw feedbackError('invalid-proposal', '提案必须是对象', 400)
  if (proposal.schema !== PROPOSAL_SCHEMA) throw feedbackError('invalid-proposal', `提案 schema 必须是 ${PROPOSAL_SCHEMA}`, 400)
  if (!PROPOSAL_KINDS.includes(proposal.kind)) {
    throw feedbackError('invalid-proposal', `提案 kind 必须是 ${PROPOSAL_KINDS.join(', ')}`, 400)
  }
  if (!PROPOSAL_STATUSES.includes(proposal.status)) {
    throw feedbackError('invalid-proposal', `提案 status 必须是 ${PROPOSAL_STATUSES.join(', ')}`, 400)
  }
  if (typeof proposal.problem !== 'string' || proposal.problem.trim() === '') {
    throw feedbackError('invalid-proposal', '提案 problem 不能为空', 400)
  }
  if (typeof proposal.fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(proposal.fingerprint)) {
    throw feedbackError('invalid-proposal', '提案 fingerprint 非法', 400)
  }
}

function mergeRelated(existing, planned) {
  const related = { ...(existing.related ?? {}) }
  const ids = [...(related.feedbackIds ?? [])]
  for (const id of planned.related?.feedbackIds ?? []) {
    if (!ids.includes(id)) ids.push(id)
  }
  related.feedbackIds = ids
  if (!related.requirementId && planned.related?.requirementId) related.requirementId = planned.related.requirementId
  if (!related.intentSessionId && planned.related?.intentSessionId) related.intentSessionId = planned.related.intentSessionId
  const runIds = [...(related.runIds ?? [])]
  for (const id of planned.related?.runIds ?? []) {
    if (!runIds.includes(id)) runIds.push(id)
  }
  if (runIds.length > 0) related.runIds = runIds
  return related
}

/**
 * Persist a planned proposal. An open (`awaiting-confirmation`) proposal with
 * the same fingerprint is reused: its id is kept and the new feedback is linked.
 */
export function saveProposal(root, proposal) {
  const repo = resolveRoot(root)
  validateProposalShape(proposal)
  if (byteLength(proposal) > FEEDBACK_LIMITS.recordBytes) {
    throw feedbackError('proposal-too-large', `提案不能超过 ${FEEDBACK_LIMITS.recordBytes} 字节`, 413)
  }
  const store = listStoredProposals(repo)
  const open = store.find((entry) => entry.fingerprint === proposal.fingerprint && entry.status === 'awaiting-confirmation')
  if (open) {
    const merged = {
      ...open,
      related: mergeRelated(open, proposal),
      updatedAt: nowIso(),
    }
    writeStoredProposal(repo, merged)
    return merged
  }

  let id = isFeedbackProposalId(proposal.id) ? proposal.id : null
  if (id !== null && existsSync(feedbackProposalPath(repo, id))) {
    const existing = readStoredProposal(repo, id)
    if (existing && existing.fingerprint === proposal.fingerprint) return existing
    throw feedbackError('proposal-id-conflict', `提案 ID 已被占用：${id}`, 409)
  }
  if (id === null) id = allocateProposalId(repo)
  const next = { ...proposal, id, createdAt: proposal.createdAt || nowIso(), updatedAt: nowIso() }
  writeStoredProposal(repo, next)
  return next
}

/** List stored proposals for one feedback workspace (newest write last). */
export function listProposals(root) {
  return listStoredProposals(resolveRoot(root))
}

export function readProposal(root, proposalId) {
  return readStoredProposal(resolveRoot(root), proposalId)
}

/**
 * Update a proposal with optimistic concurrency. Stale `expectedRevision` fails
 * with 409 `proposal-revision-conflict`; a missing proposal is 404.
 */
export function updateProposal({
  root,
  proposalId,
  id,
  expectedRevision,
  status,
  requirement,
  requirementRef,
  notes,
  actor = 'human:local',
  apply = true,
} = {}) {
  const repo = resolveRoot(root)
  const key = proposalId ?? id
  const proposal = readStoredProposal(repo, key)
  if (!proposal) throw feedbackError('proposal-not-found', `提案不存在：${key ?? ''}`, 404)
  if (expectedRevision !== undefined && expectedRevision !== null) {
    if (!Number.isInteger(expectedRevision)) {
      throw feedbackError('invalid-revision', 'expectedRevision 必须是整数', 400)
    }
    if (proposal.revision !== expectedRevision) {
      throw feedbackError(
        'proposal-revision-conflict',
        `提案 ${proposal.id} 版本冲突：期望 ${expectedRevision}，实际 ${proposal.revision}`,
        409,
      )
    }
  }
  if (status !== undefined && !PROPOSAL_STATUSES.includes(status)) {
    throw feedbackError('invalid-status', `提案 status 必须是 ${PROPOSAL_STATUSES.join(', ')}`, 400)
  }
  let incomingRef = null
  if (requirementRef !== undefined && requirementRef !== null) {
    incomingRef = normalizeRequirementLink(requirementRef, { root: repo })
  } else if (requirement !== undefined && requirement !== null) {
    incomingRef = normalizeRequirementLink(requirement, { root: repo })
  }
  const at = nowIso()
  const noteText = typeof notes === 'string' ? notes.trim() : ''
  const changed = status !== undefined || incomingRef !== null || noteText !== ''
  const next = {
    ...proposal,
    ...(status !== undefined ? { status } : {}),
    ...(incomingRef ? { requirementRef: incomingRef } : {}),
    revision: changed ? (proposal.revision ?? 0) + 1 : proposal.revision,
    updatedAt: changed ? at : proposal.updatedAt,
    ...(changed ? { updatedBy: String(actor ?? 'human:local') } : {}),
    notes: noteText === ''
      ? [...(proposal.notes ?? [])]
      : [...(proposal.notes ?? []), { at, actor: String(actor ?? 'human:local'), text: noteText.slice(0, FEEDBACK_LIMITS.note) }].slice(-50),
  }
  if (apply === true && changed) writeStoredProposal(repo, next)
  return { applied: apply === true && changed, proposal: next }
}

/**
 * Confirm an awaiting-confirmation proposal.
 *
 * Confirmation is the human gate between "the system organised the feedback"
 * and "this becomes an executable requirement". Replays are idempotent; a
 * converted or failed proposal cannot be re-confirmed.
 */
export function confirmProposal({
  root,
  proposalId,
  expectedRevision = null,
  actor = 'human:local',
  notes = '',
  now,
} = {}) {
  const repo = resolveRoot(root)
  const proposal = readStoredProposal(repo, proposalId)
  if (!proposal) throw feedbackError('proposal-not-found', `提案不存在：${proposalId ?? ''}`, 404)
  if (expectedRevision !== null && expectedRevision !== undefined) {
    if (!Number.isInteger(expectedRevision)) {
      throw feedbackError('invalid-revision', 'expectedRevision 必须是整数', 400)
    }
    if (proposal.revision !== expectedRevision) {
      throw feedbackError(
        'proposal-revision-conflict',
        `提案 ${proposal.id} 版本冲突：期望 ${expectedRevision}，实际 ${proposal.revision}`,
        409,
      )
    }
  }
  if (proposal.status === 'confirmed') return { proposal, changed: false }
  if (proposal.status !== 'awaiting-confirmation') {
    throw feedbackError('proposal-not-confirmable', `提案状态为 ${proposal.status}，不能确认`, 409)
  }
  const at = toIso(now)
  const next = {
    ...proposal,
    status: 'confirmed',
    revision: (proposal.revision ?? 0) + 1,
    updatedAt: at,
    confirmation: {
      required: true,
      confirmedAt: at,
      confirmedBy: oneLine(String(actor ?? 'human:local'), 80),
      notes: oneLine(String(notes ?? ''), FEEDBACK_LIMITS.note),
    },
  }
  writeStoredProposal(repo, next)
  return { proposal: next, changed: true }
}

export { PROPOSAL_SCHEMA, PROPOSAL_STATUSES }
