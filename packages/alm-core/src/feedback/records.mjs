/**
 * Feedback records: capture, routing and lifecycle.
 *
 * A feedback is saved first (never silently dropped), then either routed to a
 * destination workspace or parked as `needs-routing`. Generating the
 * requirement is a separate, idempotent transition; a failed generation keeps
 * the record retryable and never claims that a requirement exists.
 */
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_INBOX_SCHEMA,
  FEEDBACK_LIMITS,
  FEEDBACK_SCHEMA,
  allocateContextSnapshotId,
  allocateFeedbackId,
  byteLength,
  feedbackError,
  isPlainObject,
  listStoredFeedback,
  normalizeRequirementLink,
  oneLine,
  readJson,
  readFeedbackSettings,
  readStoredFeedback,
  nowIso,
  toIso,
  writeStoredFeedback,
} from './store.mjs'
import { feedbackRecordPath, isFeedbackRecordId, resolveRoot } from './paths.mjs'
import { normalizeContextEnvelope } from './context.mjs'
import { redactValue } from './redact.mjs'

const PROJECT_ID = /^[A-Z][A-Z0-9]{1,7}$/

function normalizeRootOption(root) {
  const value = typeof root === 'string' ? root.trim() : ''
  return value === '' ? null : value
}

function normalizeWorkspaceId(workspace) {
  return typeof workspace?.workspaceId === 'string' && workspace.workspaceId.trim() !== ''
    ? workspace.workspaceId.trim()
    : null
}

function failureResult(code, message, extra = {}) {
  return { ok: false, code, message, root: null, projectId: null, workspaceId: null, ...extra }
}

/**
 * Check that a destination workspace can receive generated requirements.
 * `probeWrite: false` performs only read checks and never touches disk.
 */
export function validateDestination({ root, workspace, probeWrite = true } = {}) {
  const ws = isPlainObject(workspace) ? workspace : {}
  const workspaceId = normalizeWorkspaceId(ws)
  const rawRoot = normalizeRootOption(root) ?? normalizeRootOption(ws.root)
  if (!rawRoot) {
    return failureResult('destination-not-configured', '未配置目标工作区', { workspaceId })
  }
  const repo = resolveRoot(rawRoot)
  try {
    if (!existsSync(repo) || !statSync(repo).isDirectory()) {
      return failureResult('destination-unavailable', '目标工作区目录不存在或不可访问', { workspaceId })
    }
    const project = readJson(join(repo, '.alm', 'project.json'))
    const projectId = project && typeof project.id === 'string' ? project.id.trim() : ''
    if (!project || !PROJECT_ID.test(projectId)) {
      return failureResult('destination-unavailable', '目标工作区缺少有效的 .alm/project.json', { workspaceId })
    }
    const requirements = join(repo, 'requirements')
    if (existsSync(requirements)) {
      if (!statSync(requirements).isDirectory()) {
        return failureResult('destination-unavailable', '目标工作区的 requirements 不是目录', { projectId, workspaceId })
      }
    } else if (probeWrite) {
      try {
        mkdirSync(requirements, { recursive: true })
      } catch {
        return failureResult('destination-not-writable', '目标工作区 requirements 目录不可创建', { projectId, workspaceId })
      }
    }
    if (probeWrite) {
      try {
        const probeDir = join(repo, '.alm', 'feedback')
        mkdirSync(probeDir, { recursive: true })
        const probe = join(probeDir, '.write-probe')
        writeFileSync(probe, '', 'utf8')
        rmSync(probe, { force: true })
      } catch {
        return failureResult('destination-not-writable', '目标工作区不可写', { projectId, workspaceId })
      }
    }
    return { ok: true, code: null, message: null, root: repo, projectId, workspaceId }
  } catch {
    return failureResult('destination-unavailable', '目标工作区不可访问', { workspaceId })
  }
}

function observedProjectIdFromRoot(repo) {
  const project = readJson(join(repo, '.alm', 'project.json'))
  const candidate = project && typeof project.id === 'string' ? project.id.trim() : ''
  return PROJECT_ID.test(candidate) ? candidate : null
}

function normalizeStatement(statement) {
  if (typeof statement !== 'string') throw feedbackError('statement-required', '反馈内容不能为空', 400)
  const text = statement
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
  if (text === '') throw feedbackError('statement-required', '反馈内容不能为空', 400)
  if (text.length > FEEDBACK_LIMITS.statement) {
    throw feedbackError('statement-too-long', `反馈内容不能超过 ${FEEDBACK_LIMITS.statement} 字符`, 400)
  }
  return text
}

function normalizeCategory(category) {
  const value = category === undefined || category === null || category === '' ? 'undetermined' : String(category)
  if (!FEEDBACK_CATEGORIES.includes(value)) {
    throw feedbackError('invalid-category', `反馈类别必须是 ${FEEDBACK_CATEGORIES.join(', ')}`, 400)
  }
  return value
}

function idempotencyDigest(text, category, context) {
  const source = isPlainObject(context) ? context : {}
  const links = isPlainObject(source.links) ? source.links : null
  const evidence = isPlainObject(source.evidence) ? source.evidence : null
  const ui = isPlainObject(source.ui) ? source.ui : null
  const observedAt = typeof source.observedAt === 'string' ? source.observedAt : isPlainObject(source.capture) && typeof source.capture.observedAt === 'string' ? source.capture.observedAt : null
  const payload = JSON.stringify([text, category, observedAt, links, evidence, ui, typeof source.recentError === 'string' ? source.recentError : null])
  return createHash('sha256').update(payload).digest('hex')
}

function findIdempotent(repo, clientRequestId) {
  const key = typeof clientRequestId === 'string' ? clientRequestId.trim() : ''
  if (key === '') return null
  return listStoredFeedback(repo).find((record) => record.clientRequestId === key) ?? null
}

function allocateRecordId(repo) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const id = allocateFeedbackId(repo)
    if (!existsSync(feedbackRecordPath(repo, id))) return id
  }
  throw feedbackError('feedback-id-exhausted', '无法分配反馈 ID', 500)
}

/**
 * Persist a new feedback record.
 *
 * `context` may be raw plugin data (normalized here) or an already-normalized
 * envelope; server-side root/destination always win. Returns `changed: false`
 * when the same `clientRequestId` was already saved on this workspace.
 */
export function saveFeedback({
  root,
  statement,
  category = 'undetermined',
  context = null,
  clientRequestId,
  now,
  projectId = null,
  destination = null,
  includeAttachments = false,
} = {}) {
  const repo = resolveRoot(root)
  const text = redactValue(normalizeStatement(statement)).value
  const normalizedCategory = normalizeCategory(category)
  const digest = idempotencyDigest(text, normalizedCategory, context)
  const existing = findIdempotent(repo, clientRequestId)
  if (existing) {
    // A replay with the same key returns the original receipt, but a *different*
    // payload under the same key must not masquerade as saved: the user would
    // believe the new text/context was stored while the old record answers.
    const sameText = redactValue(String(existing.statement ?? '')).value === text
    const sameCategory = (existing.category ?? 'undetermined') === normalizedCategory
    const existingDigest = typeof existing?.idempotency?.digest === 'string'
      ? existing.idempotency.digest
      : idempotencyDigest(
          redactValue(String(existing.statement ?? '')).value,
          existing.category ?? 'undetermined',
          existing.context ?? null,
        )
    if (!sameText || !sameCategory || existingDigest !== digest) {
      throw feedbackError(
        'idempotency-conflict',
        '同一幂等键已保存过不同内容或上下文的反馈；请刷新后再提交，避免误以为新内容已保存',
        409,
        { existing: { id: existing.id, observedAt: existing.context?.observedAt ?? null } },
      )
    }
    return { feedback: existing, changed: false }
  }

  const settings = readFeedbackSettings(repo)
  const candidate = destination ?? settings.destinationWorkspace
  const validation = candidate
    ? validateDestination({ root: candidate.root, workspace: candidate, probeWrite: true })
    : { ok: false, code: 'destination-not-configured', message: '未配置目标工作区', root: null, projectId: null, workspaceId: null }
  const status = validation.ok ? 'routed' : 'needs-routing'
  const routingReason = validation.ok ? null : validation.code === 'destination-not-configured' ? 'no-destination' : validation.code === 'destination-not-writable' ? 'destination-not-writable' : 'destination-unavailable'
  const at = toIso(now)
  const id = allocateRecordId(repo)
  const envelope = normalizeContextEnvelope(context, {
    root: repo,
    now: at,
    projectId: projectId ?? observedProjectIdFromRoot(repo),
    destination: validation.ok ? { workspaceId: validation.workspaceId, projectId: validation.projectId, root: validation.root } : null,
    statement: text,
    contextSnapshotId: `FCTX-${id.slice(3)}`,
    includeAttachments: includeAttachments === true || settings.capture.includeAttachments === true,
  })
  const record = {
    schema: FEEDBACK_SCHEMA,
    id,
    revision: 1,
    createdAt: at,
    updatedAt: at,
    // Server receipt time. `context.observedAt` is the client-claimed click
    // time; keeping both makes a client clock/zone bug visible instead of
    // silently overwritten by save latency.
    receivedAt: at,
    observedWorkspace: { ...envelope.observedWorkspace },
    statement: text,
    category: normalizedCategory,
    status,
    context: envelope,
    ...(typeof clientRequestId === 'string' && clientRequestId.trim() !== '' ? { clientRequestId: clientRequestId.trim(), idempotency: { digest } } : {}),
    routing: {
      destination: validation.ok
        ? { workspaceId: validation.workspaceId, projectId: validation.projectId, root: validation.root }
        : null,
      reason: routingReason,
      attempts: [
        {
          at,
          outcome: status === 'routed' ? 'routed' : routingReason === 'destination-not-writable' ? 'failed' : 'needs-routing',
          detail: validation.ok ? `已路由到 ${validation.projectId}` : validation.message,
        },
      ],
    },
    proposalId: null,
    requirement: null,
    failure: null,
    notes: [],
  }
  if (byteLength(record) > FEEDBACK_LIMITS.recordBytes) {
    throw feedbackError('feedback-too-large', `反馈记录不能超过 ${FEEDBACK_LIMITS.recordBytes} 字节`, 413)
  }
  writeStoredFeedback(repo, record)
  return { feedback: record, changed: true }
}

/** Read one stored feedback (schema-validated); missing/corrupt returns null. */
export function readFeedback(root, id) {
  return readStoredFeedback(resolveRoot(root), id)
}

/** List records, newest first, filtered by status and bounded by `limit`. */
export function listFeedback(root, { status, limit } = {}) {
  const repo = resolveRoot(root)
  const wanted = status === undefined || status === null ? null : Array.isArray(status) ? new Set(status) : new Set([status])
  const max = Number.isInteger(limit) && limit > 0 ? limit : FEEDBACK_LIMITS.list
  return listStoredFeedback(repo)
    .filter((record) => wanted === null || wanted.has(record.status))
    .sort((left, right) => {
      const byTime = String(right.createdAt ?? '').localeCompare(String(left.createdAt ?? ''))
      return byTime !== 0 ? byTime : String(right.id).localeCompare(String(left.id))
    })
    .slice(0, max)
}

/**
 * Inbox projection: counts + light items; never the full captured context.
 *
 * `filter` narrows the returned items only; counts always describe the whole
 * inbox so the operator sees the actual backlog without clearing filters.
 */
export function feedbackInbox(root, filter = {}) {
  const repo = resolveRoot(root)
  const settings = readFeedbackSettings(repo)
  const records = listStoredFeedback(repo)
  const counts = { saved: 0, needsRouting: 0, routed: 0, requirementCreated: 0, failed: 0 }
  const items = []
  for (const record of records) {
    if (record.status === 'saved') counts.saved += 1
    else if (record.status === 'needs-routing') counts.needsRouting += 1
    else if (record.status === 'routed') counts.routed += 1
    else if (record.status === 'requirement-created') counts.requirementCreated += 1
    else if (record.status === 'failed') counts.failed += 1
    items.push({
      id: record.id,
      status: record.status,
      category: record.category,
      statementExcerpt: oneLine(record.statement, FEEDBACK_LIMITS.excerpt),
      createdAt: record.createdAt,
      destination: record.routing?.destination
        ? { workspaceId: record.routing.destination.workspaceId, projectId: record.routing.destination.projectId }
        : null,
      requirement: record.requirement ? { id: record.requirement.id, revision: record.requirement.revision } : null,
      failureCode: record.failure?.code ?? null,
      ...(record.proposalId ? { proposalId: record.proposalId } : {}),
      contextSnapshotId: record.context?.contextSnapshotId,
      ...(record.context?.ui?.page ? { page: record.context.ui.page } : {}),
      ...(record.context?.ui?.stage ? { stage: record.context.ui.stage } : {}),
      disposition: record.disposition?.state ?? 'open',
      resolution: record.resolution?.state ?? 'pending',
      supplementCount: Array.isArray(record.supplements) ? record.supplements.length : 0,
      updatedAt: record.updatedAt ?? record.createdAt,
      // Drift between "requirement created" and "feedback linked" stays
      // visible on the row so the retry path is discoverable.
      reconciliation: record.reconciliation
        ? {
          state: record.reconciliation.state ?? null,
          requirementId: record.reconciliation.requirementId ?? null,
          note: record.reconciliation.note ?? null,
          at: record.reconciliation.at ?? null,
        }
        : null,
      processing: record.processing
        ? {
          state: record.processing.state ?? null,
          attempts: record.processing.attempts ?? 0,
          lastError: record.processing.lastError ?? null,
          updatedAt: record.processing.updatedAt ?? null,
        }
        : null,
    })
  }
  items.sort((left, right) => {
    const byTime = String(right.createdAt ?? '').localeCompare(String(left.createdAt ?? ''))
    return byTime !== 0 ? byTime : String(right.id).localeCompare(String(left.id))
  })
  const wanted = {
    status: typeof filter.status === 'string' && filter.status !== '' ? new Set([filter.status]) : null,
    category: typeof filter.category === 'string' && filter.category !== '' ? filter.category : null,
    disposition: typeof filter.disposition === 'string' && filter.disposition !== '' ? filter.disposition : null,
    resolution: typeof filter.resolution === 'string' && filter.resolution !== '' ? filter.resolution : null,
    page: typeof filter.page === 'string' && filter.page !== '' ? filter.page : null,
    stage: typeof filter.stage === 'string' && filter.stage !== '' ? filter.stage : null,
    q: typeof filter.q === 'string' && filter.q.trim() !== '' ? filter.q.trim().toLowerCase() : null,
  }
  const limit = Number.isInteger(filter.limit) && filter.limit > 0
    ? Math.min(filter.limit, FEEDBACK_LIMITS.list)
    : settings.capture.maxRecords
  const visible = items.filter((item) => {
    if (wanted.status && !wanted.status.has(item.status)) return false
    if (wanted.category && item.category !== wanted.category) return false
    if (wanted.disposition && item.disposition !== wanted.disposition) return false
    if (wanted.resolution && item.resolution !== wanted.resolution) return false
    if (wanted.page && item.page !== wanted.page) return false
    if (wanted.stage && item.stage !== wanted.stage) return false
    if (wanted.q && !`${item.id} ${item.statementExcerpt}`.toLowerCase().includes(wanted.q)) return false
    return true
  })
  return {
    schema: FEEDBACK_INBOX_SCHEMA,
    counts,
    total: items.length,
    shown: Math.min(visible.length, limit),
    items: visible.slice(0, limit),
    settings,
  }
}

/** Re-run routing; the record keeps a bounded attempt log. */
export function routeFeedback({ root, id, destination = null, now } = {}) {
  const repo = resolveRoot(root)
  const record = readStoredFeedback(repo, id)
  if (!record) throw feedbackError('feedback-not-found', `反馈不存在：${id ?? ''}`, 404)
  if (record.status === 'requirement-created') return record
  const settings = readFeedbackSettings(repo)
  const candidate = destination ?? settings.destinationWorkspace
  const validation = candidate
    ? validateDestination({ root: candidate.root, workspace: candidate, probeWrite: true })
    : { ok: false, code: 'destination-not-configured', message: '未配置目标工作区', root: null, projectId: null, workspaceId: null }
  const at = toIso(now)
  const outcome = validation.ok ? 'routed' : validation.code === 'destination-not-writable' ? 'failed' : 'needs-routing'
  const reason = validation.ok ? null : validation.code === 'destination-not-configured' ? 'no-destination' : validation.code === 'destination-not-writable' ? 'destination-not-writable' : 'destination-unavailable'
  const attempts = Array.isArray(record.routing?.attempts) ? record.routing.attempts.slice(-49) : []
  attempts.push({ at, outcome, detail: validation.ok ? `已路由到 ${validation.projectId}` : validation.message })
  const next = {
    ...record,
    revision: (record.revision ?? 0) + 1,
    updatedAt: at,
    status: validation.ok ? 'routed' : 'needs-routing',
    routing: {
      destination: validation.ok ? { workspaceId: validation.workspaceId, projectId: validation.projectId, root: validation.root } : null,
      reason,
      attempts,
    },
  }
  writeStoredFeedback(repo, next)
  return next
}

/**
 * Mark that a requirement was created for this feedback. Idempotent: repeating
 * with the same requirement returns the stored record unchanged.
 */
export function markFeedbackRequirement({ root, id, requirement, proposalId, now } = {}) {
  const repo = resolveRoot(root)
  const record = readStoredFeedback(repo, id)
  if (!record) throw feedbackError('feedback-not-found', `反馈不存在：${id ?? ''}`, 404)
  const link = normalizeRequirementLink(requirement, { root: repo })
  if (record.status === 'requirement-created') {
    if (record.requirement?.id === link.id) return record
    throw feedbackError('feedback-already-created', `反馈 ${record.id} 已生成需求 ${record.requirement?.id ?? ''}`, 409)
  }
  const at = toIso(now)
  const next = {
    ...record,
    revision: (record.revision ?? 0) + 1,
    updatedAt: at,
    status: 'requirement-created',
    requirement: link,
    failure: null,
    ...(proposalId ? { proposalId } : {}),
  }
  writeStoredFeedback(repo, next)
  return next
}

/** Mark a generation attempt as failed; the record stays retryable. */
export function markFeedbackFailed({ root, id, failure, now } = {}) {
  const repo = resolveRoot(root)
  const record = readStoredFeedback(repo, id)
  if (!record) throw feedbackError('feedback-not-found', `反馈不存在：${id ?? ''}`, 404)
  if (!isPlainObject(failure) || typeof failure.code !== 'string' || failure.code.trim() === '') {
    throw feedbackError('invalid-failure', 'failure 需要非空 code', 400)
  }
  const at = toIso(now)
  const failureCode = failure.code.trim().slice(0, 80)
  const failureMessage = oneLine(redactValue(String(failure.message ?? '')).value, 500)
  const attempts = Array.isArray(record.routing?.attempts) ? record.routing.attempts.slice(-49) : []
  attempts.push({ at, outcome: 'failed', detail: failureMessage || failureCode })
  const next = {
    ...record,
    revision: (record.revision ?? 0) + 1,
    updatedAt: at,
    status: 'failed',
    routing: { ...(record.routing ?? {}), attempts },
    failure: {
      code: failureCode,
      message: failureMessage,
      at: failure.at ? toIso(failure.at) : at,
    },
  }
  writeStoredFeedback(repo, next)
  return next
}

/**
 * Correct the category of a stored feedback without touching its context.
 * `apply: false` only previews the change.
 */
export function updateFeedbackCategory({ root, feedbackId, id, category, notes, actor = 'human:local', apply = true } = {}) {
  const repo = resolveRoot(root)
  const record = readStoredFeedback(repo, feedbackId ?? id)
  if (!record) throw feedbackError('feedback-not-found', `反馈不存在：${feedbackId ?? id ?? ''}`, 404)
  const nextCategory = normalizeCategory(category)
  const at = nowIso()
  const noteText = typeof notes === 'string' ? notes.trim() : ''
  const changed = record.category !== nextCategory || noteText !== ''
  const next = {
    ...record,
    category: nextCategory,
    revision: changed ? (record.revision ?? 0) + 1 : record.revision,
    updatedAt: changed ? at : record.updatedAt,
    notes: noteText === ''
      ? [...(record.notes ?? [])]
      : [...(record.notes ?? []), { at, actor: String(actor ?? 'human:local'), text: noteText.slice(0, FEEDBACK_LIMITS.note) }].slice(-50),
  }
  if (apply === true && changed) writeStoredFeedback(repo, next)
  return { applied: apply === true && changed, feedback: next }
}

/**
 * Disposition is what the team decided to do with a feedback; it is separate
 * from routing (`routed`/`needs-routing`) and from requirement creation, so a
 * `declined` or `deferred` feedback never looks like an unfinished task.
 */
export const FEEDBACK_DISPOSITIONS = ['open', 'linked', 'deferred', 'declined', 'duplicate']

/** Resolution tracks whether the original problem was actually verified fixed. */
export const FEEDBACK_RESOLUTION_STATES = ['pending', 'resolved', 'reopened']

const MAX_SUPPLEMENTS = 20

function readFeedbackOrThrow(repo, id) {
  const record = readStoredFeedback(repo, id)
  if (!record) throw feedbackError('feedback-not-found', `反馈不存在：${id ?? ''}`, 404)
  return record
}

/**
 * Append a supplement (user follow-up) to an existing feedback.
 *
 * The original statement and frozen context are never rewritten: a supplement
 * is its own frozen context snapshot, so "what I saw then" stays auditable.
 * Repeating the same `supplementId` returns the stored record unchanged.
 */
export function appendSupplement({
  root,
  id,
  statement,
  note = '',
  context = null,
  supplementId = null,
  actor = 'human:local',
  observedAt = null,
  now,
} = {}) {
  const repo = resolveRoot(root)
  const record = readFeedbackOrThrow(repo, id)
  const at = toIso(now)
  const text = redactValue(normalizeStatement(statement)).value
  const key = typeof supplementId === 'string' && supplementId.trim() !== '' ? supplementId.trim().slice(0, 200) : null
  const supplements = Array.isArray(record.supplements) ? record.supplements : []
  if (key && supplements.some((entry) => entry?.supplementId === key)) {
    return { feedback: record, changed: false }
  }
  if (supplements.length >= MAX_SUPPLEMENTS) {
    throw feedbackError('too-many-supplements', `单个反馈最多追加 ${MAX_SUPPLEMENTS} 条补充`, 409)
  }
  const envelope = isPlainObject(context)
    ? normalizeContextEnvelope(context, {
      root: repo,
      now: at,
      projectId: observedProjectIdFromRoot(repo),
      destination: record.routing?.destination ?? null,
      statement: text,
      contextSnapshotId: allocateContextSnapshotId(repo),
    })
    : null
  const supplement = {
    at,
    actor: oneLine(String(actor ?? 'human:local'), 80),
    statement: text,
    note: oneLine(String(note ?? ''), FEEDBACK_LIMITS.note),
    observedAt: observedAt ? toIso(observedAt) : envelope?.observedAt ?? null,
    contextSnapshotId: envelope?.contextSnapshotId ?? null,
    ...(key ? { supplementId: key } : {}),
    ...(envelope ? { context: envelope } : {}),
  }
  const next = {
    ...record,
    revision: (record.revision ?? 0) + 1,
    updatedAt: at,
    supplements: [...supplements, supplement],
  }
  if (byteLength(next) > FEEDBACK_LIMITS.recordBytes) {
    throw feedbackError('feedback-too-large', `反馈记录不能超过 ${FEEDBACK_LIMITS.recordBytes} 字节`, 413)
  }
  writeStoredFeedback(repo, next)
  return { feedback: next, changed: true, supplement }
}

/** Record what the team decided to do with this feedback. */
export function updateFeedbackDisposition({
  root,
  id,
  disposition,
  reason = '',
  actor = 'human:local',
  now,
} = {}) {
  const repo = resolveRoot(root)
  const record = readFeedbackOrThrow(repo, id)
  const value = String(disposition ?? '').trim()
  if (!FEEDBACK_DISPOSITIONS.includes(value)) {
    throw feedbackError('invalid-disposition', `反馈处置必须是 ${FEEDBACK_DISPOSITIONS.join(', ')}`, 400)
  }
  const at = toIso(now)
  const next = {
    ...record,
    revision: (record.revision ?? 0) + 1,
    updatedAt: at,
    disposition: {
      state: value,
      reason: oneLine(redactValue(String(reason ?? '')).value, FEEDBACK_LIMITS.note),
      at,
      actor: oneLine(String(actor ?? 'human:local'), 80),
    },
  }
  writeStoredFeedback(repo, next)
  return { feedback: next, changed: true }
}

/**
 * Mark the original problem as verified fixed (or reopen it / clear back to
 * pending). "Requirement created" is not a resolution.
 */
export function updateFeedbackResolution({
  root,
  id,
  state,
  note = '',
  evidence = null,
  actor = 'human:local',
  now,
} = {}) {
  const repo = resolveRoot(root)
  const record = readFeedbackOrThrow(repo, id)
  const value = String(state ?? '').trim()
  if (!FEEDBACK_RESOLUTION_STATES.includes(value)) {
    throw feedbackError('invalid-resolution', `解决状态必须是 ${FEEDBACK_RESOLUTION_STATES.join(', ')}`, 400)
  }
  if (value === 'resolved' && !record.requirement?.id) {
    throw feedbackError('resolution-needs-requirement', '只有在关联需求存在后才能标记已解决；请先关联或转成需求', 409)
  }
  const at = toIso(now)
  const next = {
    ...record,
    revision: (record.revision ?? 0) + 1,
    updatedAt: at,
    resolution: {
      state: value,
      note: oneLine(redactValue(String(note ?? '')).value, FEEDBACK_LIMITS.note),
      ...(isPlainObject(evidence) ? { evidence } : {}),
      at,
      actor: oneLine(String(actor ?? 'human:local'), 80),
    },
  }
  writeStoredFeedback(repo, next)
  return { feedback: next, changed: true }
}

export const FEEDBACK_PROCESSING_STATES = ['queued', 'analyzing', 'draft-ready', 'failed', 'skipped']

function processingFor(record, patch, at) {
  const previous = isPlainObject(record.processing) ? record.processing : {}
  const state = patch?.state !== undefined ? String(patch.state) : previous.state ?? 'queued'
  if (!FEEDBACK_PROCESSING_STATES.includes(state)) {
    throw feedbackError('invalid-processing-state', `整理状态必须是 ${FEEDBACK_PROCESSING_STATES.join(', ')}`, 400)
  }
  const attempts =
    typeof patch?.attempts === 'number' && Number.isInteger(patch.attempts) && patch.attempts >= 0
      ? patch.attempts
      : Number.isInteger(previous.attempts)
        ? previous.attempts
        : 0
  const next = {
    state,
    attempts,
    queuedAt: previous.queuedAt ?? at,
    updatedAt: at,
  }
  if (state === 'analyzing') next.startedAt = at
  if (state === 'draft-ready' || state === 'failed' || state === 'skipped') next.finishedAt = at
  const lastError = patch?.lastError !== undefined ? patch.lastError : previous.lastError
  if (typeof lastError === 'string' && lastError.trim() !== '') next.lastError = oneLine(redactValue(lastError).value, 300)
  const proposalId = patch?.proposalId !== undefined ? patch.proposalId : previous.proposalId
  if (typeof proposalId === 'string' && proposalId !== '') next.proposalId = proposalId
  const analysis = patch?.analysis !== undefined ? patch.analysis : previous.analysis
  if (isPlainObject(analysis)) next.analysis = analysis
  return next
}

/**
 * Persist the background-processing state of one feedback.
 *
 * Processing is metadata: it never bumps `revision`, because the user's words
 * and the captured context did not change. A queued record is picked up by
 * `processFeedbackQueue`; an interrupted `analyzing` record is recovered by
 * `recoverFeedbackProcessing`.
 */
export function updateFeedbackProcessing({ root, id, patch = {}, now } = {}) {
  const repo = resolveRoot(root)
  const record = readFeedbackOrThrow(repo, id)
  const at = toIso(now)
  const next = { ...record, updatedAt: at, processing: processingFor(record, patch, at) }
  writeStoredFeedback(repo, next)
  return { feedback: next, changed: true }
}

const PROCESSING_ORDER = { analyzing: 0, queued: 1 }

/** Records waiting for (or interrupted during) background processing. */
export function listFeedbackProcessing(root) {
  const repo = resolveRoot(root)
  return listStoredFeedback(repo)
    .filter((entry) => entry?.processing && Object.hasOwn(PROCESSING_ORDER, entry.processing.state))
    .sort((a, b) => {
      const order = PROCESSING_ORDER[a.processing.state] - PROCESSING_ORDER[b.processing.state]
      if (order !== 0) return order
      return String(a.processing.updatedAt ?? a.updatedAt ?? '').localeCompare(String(b.processing.updatedAt ?? b.updatedAt ?? ''))
    })
}

/** Queue a feedback for background processing (idempotent). */
export function enqueueFeedbackProcessing({ root, id, now } = {}) {
  const repo = resolveRoot(root)
  const record = readFeedbackOrThrow(repo, id)
  const current = isPlainObject(record.processing) ? record.processing : {}
  if (current.state === 'queued' || current.state === 'analyzing' || current.state === 'draft-ready') {
    return { feedback: record, changed: false }
  }
  return updateFeedbackProcessing({ root: repo, id, patch: { state: 'queued', lastError: null }, now })
}

/** Turn interrupted `analyzing` records back into queued work. */
export function recoverFeedbackProcessing({ root, now } = {}) {
  const repo = resolveRoot(root)
  const interrupted = listStoredFeedback(repo).filter((entry) => entry?.processing?.state === 'analyzing')
  const at = toIso(now)
  for (const record of interrupted) {
    const next = {
      ...record,
      updatedAt: at,
      processing: processingFor(record, { state: 'queued', lastError: '上一次整理被中断，已重新排队' }, at),
    }
    writeStoredFeedback(repo, next)
  }
  return { recovered: interrupted.map((record) => record.id) }
}

export const FEEDBACK_CONVERSION_STATES = ['pending', 'created', 'linked']

export const FEEDBACK_RECONCILIATION_STATES = ['link-failed', 'resolved']

function conversionFor(record, patch, at) {
  const previous = isPlainObject(record.conversion) ? record.conversion : {}
  const state = patch?.state !== undefined ? String(patch.state) : previous.state ?? 'pending'
  if (!FEEDBACK_CONVERSION_STATES.includes(state)) {
    throw feedbackError('invalid-conversion-state', `转化状态必须是 ${FEEDBACK_CONVERSION_STATES.join(', ')}`, 400)
  }
  const next = {
    id: previous.id ?? `FBC-${record.id}`,
    state,
    at,
  }
  const requirementId = patch?.requirementId !== undefined ? patch.requirementId : previous.requirementId
  if (typeof requirementId === 'string' && requirementId !== '') next.requirementId = oneLine(requirementId, 160)
  const requirementRoot = patch?.requirementRoot !== undefined ? patch.requirementRoot : previous.requirementRoot
  if (typeof requirementRoot === 'string' && requirementRoot !== '') next.requirementRoot = requirementRoot
  const note = patch?.note !== undefined ? patch.note : previous.note
  if (typeof note === 'string' && note.trim() !== '') next.note = oneLine(redactValue(note).value, 300)
  if (typeof previous.startedAt === 'string') next.startedAt = previous.startedAt
  if (state === 'linked') next.linkedAt = at
  return next
}

/**
 * Record the cross-workspace conversion intent before the requirement file is
 * written. The conversion id is what makes a retried generate reconcile with
 * the requirement it already created instead of creating a second one.
 */
export function beginFeedbackConversion({ root, id, now } = {}) {
  const repo = resolveRoot(root)
  const record = readFeedbackOrThrow(repo, id)
  const at = toIso(now)
  const previous = isPlainObject(record.conversion) ? record.conversion : {}
  if (previous.startedAt) {
    return { feedback: record, changed: false }
  }
  const next = { ...record, updatedAt: at, conversion: { ...conversionFor(record, { state: 'pending' }, at), startedAt: at } }
  writeStoredFeedback(repo, next)
  return { feedback: next, changed: true }
}

/** Advance the conversion record after create/link, without bumping revision. */
export function updateFeedbackConversion({ root, id, patch = {}, now } = {}) {
  const repo = resolveRoot(root)
  const record = readFeedbackOrThrow(repo, id)
  const at = toIso(now)
  const next = { ...record, updatedAt: at, conversion: conversionFor(record, patch, at) }
  writeStoredFeedback(repo, next)
  return { feedback: next, changed: true }
}

/**
 * Record a known inconsistency discovered while converting a feedback, so a
 * retry (or a human) can reconcile it instead of creating a second requirement.
 */
export function markFeedbackReconciliation({ root, id, state, requirementId = null, note = '', now } = {}) {
  const repo = resolveRoot(root)
  const record = readFeedbackOrThrow(repo, id)
  const normalized = oneLine(String(state ?? '')).trim()
  if (!FEEDBACK_RECONCILIATION_STATES.includes(normalized)) {
    throw feedbackError('invalid-reconciliation-state', `未知的对账状态：${normalized || '(empty)'}`, 400)
  }
  const at = toIso(now)
  const reconciliation = {
    state: normalized,
    requirementId: typeof requirementId === 'string' && requirementId.trim() !== '' ? requirementId.trim() : null,
    note: oneLine(String(note ?? '')).slice(0, FEEDBACK_LIMITS.note),
    at,
  }
  const next = { ...record, updatedAt: at, reconciliation }
  writeStoredFeedback(repo, next)
  return { feedback: next, changed: true }
}

export { FEEDBACK_SCHEMA }
