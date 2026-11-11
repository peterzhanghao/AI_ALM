import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { ACTIVE_RUN_STATES, IDLE_RUN_STATES, RUN_HEARTBEAT_TIMEOUT_MS } from './run.mjs'

/**
 * Delivery state is *derived*, never stored.
 *
 * `asset.status` used to hold the lifecycle (proposed → … → verified). That enum
 * mixed three unrelated questions (what the requirement is, what the AI is
 * doing, what the human decided) and could drift from the evidence. It is now a
 * legacy field: the delivery state below is computed from the candidate, the
 * evidence decision, the execution run and the closure record.
 */
export const DELIVERY_SCHEMA = 'alm.delivery.state/v1'
export const DELIVERY_STATES = ['pending', 'in-progress', 'awaiting-acceptance', 'accepted', 'closed']
export const DELIVERY_LABELS = {
  pending: '待推进',
  'in-progress': '推进中',
  'awaiting-acceptance': '待验收',
  accepted: '已验收',
  closed: '已关闭',
}
/** Legacy sdoc marker for a closed record (`STATUS: archived`). */
export const CLOSED_STATUS = 'archived'
export const CLOSURE_SCHEMA = 'alm.closure/v1'
export const CLOSURE_DIR = '.alm/closures'

export function closurePath(root, requirementId) {
  return join(resolve(root), CLOSURE_DIR, `${requirementId}.json`)
}

export function readClosure(root, requirementId) {
  const file = closurePath(root, requirementId)
  if (!existsSync(file)) return null
  try {
    const payload = JSON.parse(readFileSync(file, 'utf8'))
    return payload?.schema === CLOSURE_SCHEMA ? payload : null
  } catch {
    return null
  }
}

/**
 * A closure is an explicit human decision with a reason (取消/不做/重复/已替代),
 * not just a visibility attribute. Archived legacy records without a closure file
 * still read as closed, but with `reason: null` and `legacy: true`.
 */
export function writeClosure({ root, requirementId, reason, actor = 'human:local', mode = 'close' }) {
  const file = closurePath(root, requirementId)
  mkdirSync(join(resolve(root), CLOSURE_DIR), { recursive: true })
  const payload = {
    schema: CLOSURE_SCHEMA,
    requirement: requirementId,
    mode,
    reason: typeof reason === 'string' && reason.trim() !== '' ? reason.trim() : null,
    actor,
    at: new Date().toISOString(),
  }
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  return payload
}

export function isClosed({ root, asset, closure = undefined }) {
  const found = closure === undefined ? (asset?.id ? readClosure(root, asset.id) : null) : closure
  if (found) return true
  return asset?.status === CLOSED_STATUS
}

/**
 * One derived delivery state per requirement. `run` is reserved for the
 * execution carrier (Phase 2) so "推进中" only appears when something is really
 * executing; today a saved requirement without a candidate is 待推进.
 */
/**
 * A run may only back "推进中" while it can still make progress. A turn parked
 * on a human decision, a lost heartbeat (host process gone) or a failed run is
 * an interruption, not progress: the delivery state must fall back to 待推进
 * and say why, so the next action is "推进/恢复" instead of a dead end.
 */
function runInterruption(run) {
  const status = run?.status ?? null
  if (run?.failure?.message) return run.failure.message
  if (status === 'waiting-input') {
    return run.decision ? '等待回答决策请求后继续' : '本轮推进已交接，等待人类决定下一步'
  }
  if (status === 'paused') return '本轮推进已暂停，等待恢复'
  if (status === 'failed') return '本轮推进失败，可从检查点恢复'
  if (status === 'cancelled') return '本轮推进已取消'
  if (status === 'done') return '本轮推进已结束，等待下一步'
  return '执行器心跳丢失，本轮推进已中断'
}

function runCanProgress(run, now = Date.now()) {
  const status = run?.status ?? null
  if (!ACTIVE_RUN_STATES.includes(status)) return false
  // Waiting for a human (or paused on purpose) is idle by design, not progress.
  if (IDLE_RUN_STATES.includes(status)) return false
  if (run.active === false) return false
  if (run.stale === true) return false
  if (run.active === true) return true
  // A raw run record: judge liveness from its own heartbeat.
  const beat = Date.parse(run.heartbeatAt ?? run.updatedAt ?? run.createdAt ?? '')
  return Number.isFinite(beat) && now - beat <= RUN_HEARTBEAT_TIMEOUT_MS
}

function runInterruptionSource(run) {
  const status = run?.status ?? null
  if (status === 'failed') return 'run-failed'
  if (status === 'cancelled') return 'run-cancelled'
  if (status === 'done') return 'run-done'
  if (IDLE_RUN_STATES.includes(status)) return 'run-idle'
  if (run?.stale === true) return 'run-stale'
  return 'run-inactive'
}

export function deliveryStateFor({ root, asset, decision = null, candidate = null, closure = undefined, run = null, release = null } = {}) {
  const closed = isClosed({ root, asset, closure })
  if (closed) {
    const record = closure === undefined ? (asset?.id ? readClosure(root, asset.id) : null) : closure
    return {
      schema: DELIVERY_SCHEMA,
      key: 'closed',
      label: DELIVERY_LABELS.closed,
      source: record ? 'closure' : 'legacy-status',
      reason: record?.reason ?? null,
      actor: record?.actor ?? null,
      at: record?.at ?? null,
    }
  }
  // A successful deployment is historical, not a fresh evidence pass. Worktree
  // edits, re-running acceptance and an old parked run cannot undo that fact.
  // Only an explicit different requirement revision (or a legacy hash mismatch
  // when revision metadata is unavailable) starts a new delivery iteration.
  const published = release?.status === 'released' ? release : release?.lastReleased
  const revision = asset?.extra?.revision ?? asset?.revision ?? null
  const sameRevision = published?.requirementRevision != null && revision != null
    ? String(published.requirementRevision) === String(revision)
    : !(published?.requirementHash && candidate?.requirementHash && published.requirementHash !== candidate.requirementHash)
  if (published?.status === 'released' && sameRevision) {
    return {
      schema: DELIVERY_SCHEMA,
      key: 'closed',
      label: '已关闭',
      source: 'release',
      releaseId: published.id ?? null,
      candidateId: published.candidateId ?? null,
      releasedAt: published.releasedAt ?? null,
      completion: 'released',
      githubVerified: published.githubVerified === true,
      reason: null,
    }
  }
  if (decision?.state === 'verified') {
    return { schema: DELIVERY_SCHEMA, key: 'accepted', label: DELIVERY_LABELS.accepted, source: 'human-signoff', reason: null }
  }
  if (decision?.state === 'ready-for-human') {
    return {
      schema: DELIVERY_SCHEMA,
      key: 'awaiting-acceptance',
      label: DELIVERY_LABELS['awaiting-acceptance'],
      source: 'candidate',
      candidateId: candidate?.id ?? null,
      reason: null,
    }
  }
  if (run && runCanProgress(run)) {
    return {
      schema: DELIVERY_SCHEMA,
      key: 'in-progress',
      label: DELIVERY_LABELS['in-progress'],
      source: 'run',
      runId: run.id ?? null,
      runStatus: run.status ?? null,
      reason: null,
    }
  }
  if (
    run &&
    (ACTIVE_RUN_STATES.includes(run.status) || ['failed', 'cancelled', 'done'].includes(run.status))
  ) {
    // The run exists but is not making progress: a human hand-back, a paused
    // round, a lost heartbeat or a finished/failed run all mean nobody is
    // advancing this right now. Roll back to 待推进 and keep the interruption
    // visible, instead of leaving the row saying 推进中.
    const waitingForHuman = IDLE_RUN_STATES.includes(run.status)
    return {
      schema: DELIVERY_SCHEMA,
      key: 'pending',
      label: DELIVERY_LABELS.pending,
      source: runInterruptionSource(run),
      runId: run.id ?? null,
      runStatus: run.status ?? null,
      waitingForHuman,
      reason: runInterruption(run),
    }
  }
  return { schema: DELIVERY_SCHEMA, key: 'pending', label: DELIVERY_LABELS.pending, source: 'default', reason: null }
}
