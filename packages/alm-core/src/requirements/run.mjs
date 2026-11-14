import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, rmdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { join, resolve } from 'node:path'
import { resolveRunDecision } from './run-decision.mjs'

/**
 * One execution run per delivery attempt.
 *
 * The run is the receipt that "AI is now working": it exists only after a
 * carrier accepted the task (a host session, later a local runner). Creating
 * task cards is not a run. Repeated start requests on the same change reuse the
 * active run instead of piling up duplicates, and a run that loses its
 * heartbeat is marked failed rather than shown as running forever.
 */
export const RUN_SCHEMA = 'alm.execution.run/v1'
export const RUN_DIR = '.alm/runs'
export const RUN_STATES = ['queued', 'running', 'waiting-input', 'paused', 'failed', 'done', 'cancelled']
export const RUN_LABELS = {
  queued: '排队',
  running: '运行',
  'waiting-input': '等待输入',
  paused: '暂停',
  failed: '失败',
  done: '结束',
  cancelled: '已取消',
}
export const ACTIVE_RUN_STATES = ['queued', 'running', 'waiting-input', 'paused']
/** A run without a heartbeat for this long stops claiming to be running. */
export const RUN_HEARTBEAT_TIMEOUT_MS = 10 * 60 * 1000
export const IDLE_RUN_STATES = ['waiting-input', 'paused']
// A host connection can end a turn before the agent's `whenIdle()` promise
// settles. These failures retain the checkpoint and may be resumed in a fresh
// host session; they are not product or acceptance failures.
export const RESUMABLE_HOST_FAILURE_CODES = ['host-restart', 'transport-failed']

export function isResumableHostFailure(failure) {
  const code = String(failure?.code ?? '').toLowerCase()
  // `TRANSPORT` was persisted by older host adapters before transport errors
  // received their durable, user-facing identifier. Keep those interrupted
  // runs resumable rather than marooning an already failed host turn.
  return RESUMABLE_HOST_FAILURE_CODES.includes(code) || code === 'transport'
}

/** Remove storage metadata from text handed to an execution agent. */
export function cleanRequirementBriefForPrompt(brief) {
  return String(brief ?? '')
    .replace(/\n*<!--\s*alm:meta\b[\s\S]*?-->\s*$/gi, '')
    .replace(/\bsha256:[a-f0-9]{64}\b/gi, '')
    .replace(/\b[a-f0-9]{64}\b/gi, '')
    .trim()
}

/** Highest-priority handoff anchor, supplied from the current persisted brief. */
export function requirementAnchor({ brief, revision }) {
  if (typeof brief !== 'string' || !brief.trim()) throw runError('requirement-doc-missing', '无法读取最新需求正文，不能继续执行', 409)
  if (Array.from(brief).length > 60000) throw runError('requirement-doc-too-large', '需求正文超过执行上限，不能截断后继续', 422)
  const cleaned = cleanRequirementBriefForPrompt(brief)
  return `最高优先级：以下是当前已确认的需求正文和验收要求（版本 v${revision ?? '未知'}）。若旧对话或历史指令与其冲突，以此为准；范围外事项仍需人工决定。\n---\n${cleaned}\n---`
}

export function runDir(root) {
  return join(resolve(root), RUN_DIR)
}

export function runPath(root, runId) {
  return join(runDir(root), `${runId}.json`)
}

function nextRunId(root) {
  let entries = []
  try {
    entries = readdirSync(runDir(root)).filter((name) => name.startsWith('RUN-') && name.endsWith('.json'))
  } catch {
    entries = []
  }
  let max = 0
  for (const entry of entries) {
    const match = /^RUN-(\d+)\.json$/.exec(entry)
    if (match) max = Math.max(max, Number(match[1]))
  }
  return `RUN-${String(max + 1).padStart(3, '0')}`
}

export function readRun(root, runId) {
  const file = runPath(root, runId)
  if (!existsSync(file)) return null
  try {
    const payload = JSON.parse(readFileSync(file, 'utf8'))
    return payload?.schema === RUN_SCHEMA ? payload : null
  } catch {
    return null
  }
}

export function listRuns(root) {
  let entries = []
  try {
    entries = readdirSync(runDir(root))
  } catch {
    return []
  }
  return entries
    .filter((name) => name.startsWith('RUN-') && name.endsWith('.json'))
    .map((name) => readRun(root, name.slice(0, -'.json'.length)))
    .filter(Boolean)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
}

/** Pages by the monotonically allocated run number, newest first. */
export function listRunPage(root, requirementId, { before = null, limit = 20 } = {}) {
  if (typeof requirementId !== 'string' || !requirementId || (before !== null && !/^RUN-\d+$/.test(before)) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw runError('run-cursor-invalid', '运行历史游标无效', 400)
  }
  let entries
  try { entries = readdirSync(runDir(root)) } catch (error) { if (error.code === 'ENOENT') return { runs: [], next: null }; throw error }
  const ceiling = before === null ? null : BigInt(before.slice(4))
  const ids = entries.flatMap(name => {
    const match = /^(RUN-(\d+))\.json$/.exec(name)
    if (!match) return []
    const number = BigInt(match[2])
    return ceiling === null || number < ceiling || (number === ceiling && match[1].localeCompare(before) > 0) ? [{ id: match[1], number }] : []
  }).sort((a, b) => a.number === b.number ? a.id.localeCompare(b.id) : a.number > b.number ? -1 : 1)
  const found = []
  for (const { id } of ids) {
    const run = readRun(root, id)
    if (run?.id !== id || run.requirement !== requirementId) continue
    found.push(run)
    if (found.length > limit) break
  }
  const page = found.slice(0, limit)
  return { runs: page, next: found.length > limit ? page.at(-1).id : null }
}

export function activeRunFor(root, requirementId) {
  return (
    listRuns(root)
      .filter((run) => run.requirement === requirementId && ACTIVE_RUN_STATES.includes(run.status))
      .pop() ?? null
  )
}

// Selection only: retain the recorded interruption and all state/decision gates.
// Never scan backwards past a newer terminal round to resurrect an old one.
export function resumableRunFor(root, requirementId) {
  const active = activeRunFor(root, requirementId)
  if (active) return active
  const latest = listRuns(root).filter((run) => run.requirement === requirementId).at(-1)
  return latest?.status === 'failed' && isResumableHostFailure(latest.failure) ? latest : null
}

function heartbeatExpired(run, now = Date.now()) {
  const beat = Date.parse(run?.heartbeatAt ?? run?.updatedAt ?? run?.createdAt ?? '')
  return Number.isFinite(beat) && now - beat > RUN_HEARTBEAT_TIMEOUT_MS
}

function writeRun(root, run) {
  mkdirSync(runDir(root), { recursive: true })
  const path = runPath(root, run.id)
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, `${JSON.stringify(run, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    renameSync(temporary, path)
  } finally {
    try { unlinkSync(temporary) } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  return run
}

function runError(code, message, status = 409) {
  const error = new Error(message)
  error.code = code
  error.status = status
  return error
}

function interruptedSessionsFor(run, failure) {
  if ((failure?.code !== 'heartbeat-lost' && !isResumableHostFailure(failure)) || typeof run.sessionId !== 'string' || !run.sessionId) return null
  const existing = Array.isArray(run.interruptedSessions) ? run.interruptedSessions : []
  return [...new Set([...existing, run.sessionId])]
}

function reclaimExitedRunLock(lock, reclaimLock) {
  try { mkdirSync(reclaimLock) } catch { return false }
  try {
    let owner
    try {
      if (!lstatSync(lock).isDirectory() || lstatSync(lock).isSymbolicLink()) return false
      owner = JSON.parse(readFileSync(join(lock, 'owner.json'), 'utf8'))
    } catch { return false }
    if (owner?.hostname !== hostname() || !Number.isSafeInteger(owner?.pid) || owner.pid <= 0) return false
    try { process.kill(owner.pid, 0); return false } catch (error) { if (error?.code !== 'ESRCH') return false }
    const retired = `${lock}.reaped-${randomUUID()}`
    try {
      // Move the verified stale lock out of the contested name atomically.
      // A new writer may claim `lock` immediately without being removed by
      // this reclaimer's cleanup.
      renameSync(lock, retired)
      unlinkSync(join(retired, 'owner.json'))
      rmdirSync(retired)
      return true
    } catch { return false }
  } finally {
    try { rmdirSync(reclaimLock) } catch {}
  }
}

// All run mutations share the lock: allocation, active-run selection and
// read-modify-write must be one transaction across host processes.
function withRunLock(root, operation) {
  mkdirSync(runDir(root), { recursive: true })
  const lock = join(runDir(root), '.write-lock')
  const reclaimLock = join(runDir(root), '.write-lock-reclaim')
  const ownerFile = join(lock, 'owner.json')
  const deadline = Date.now() + 1000
  const sleeper = new Int32Array(new SharedArrayBuffer(4))
  while (true) {
    // A stale-lock reclaimer temporarily owns this marker. Writers wait for
    // it so a newly created lock cannot be mistaken for the retired one.
    if (existsSync(reclaimLock)) {
      if (Date.now() >= deadline) throw runError('run-busy', '运行记录正被其他进程修改，请稍后重试')
      Atomics.wait(sleeper, 0, 0, 10)
      continue
    }
    try {
      mkdirSync(lock)
      try {
        writeFileSync(ownerFile, JSON.stringify({ pid: process.pid, hostname: hostname() }), { encoding: 'utf8', flag: 'wx' })
      } catch (error) {
        try { rmdirSync(lock) } catch {}
        if (error?.code === 'ENOENT') continue
        throw error
      }
      break
    } catch (error) {
      const pendingRemoval = process.platform === 'win32' && error.code === 'EPERM'
      if (error.code !== 'EEXIST' && !pendingRemoval) throw error
      if (error.code === 'EEXIST' && reclaimExitedRunLock(lock, reclaimLock)) continue
      if (Date.now() >= deadline) {
        if (pendingRemoval) throw error
        throw runError('run-busy', '运行记录正被其他进程修改，请稍后重试')
      }
      Atomics.wait(sleeper, 0, 0, 10)
    }
  }
  try {
    return operation()
  } finally {
    // Another process may have reclaimed an abandoned Windows lock between
    // the operation and cleanup. Releasing an already-removed lock is safe.
    try { unlinkSync(ownerFile) } catch (error) { if (error?.code !== 'ENOENT') throw error }
    try { rmdirSync(lock) } catch (error) { if (error?.code !== 'ENOENT') throw error }
  }
}

/**
 * Registers a run only when a carrier has accepted the work. `carrier` names
 * what is executing (e.g. `dsh-session`), `sessionId` is the handle used to
 * resume it. Starting the same change twice returns the active run (`reused`),
 * so the button is idempotent.
 */
export function createRun(options) {
  if (!options.carrier && !activeRunFor(options.root, options.requirementId)) {
    throw runError('run-carrier-missing', '没有可用的执行载体，未创建运行记录')
  }
  return withRunLock(options.root, () => createRunUnlocked(options))
}

function createRunUnlocked({
  root,
  requirementId,
  changeId = null,
  carrier = null,
  sessionId = null,
  phase = 'intake',
  actor = 'ai:runner',
  status = 'queued',
  checkpoint = null,
  requirementRevision = null,
  requirementDocHash = null,
  acceptanceIds = null,
}) {
  const existing = activeRunFor(root, requirementId)
  if (existing) {
    return { schema: RUN_SCHEMA, created: false, reused: true, run: existing }
  }
  if (!carrier) throw runError('run-carrier-missing', '没有可用的执行载体，未创建运行记录')
  if (!RUN_STATES.includes(status)) throw runError('run-status-invalid', `未知的运行状态 ${status}`, 400)
  const now = new Date().toISOString()
  const run = {
    schema: RUN_SCHEMA,
    id: nextRunId(root),
    requirement: requirementId,
    change: changeId,
    carrier,
    sessionId,
    ...(sessionId ? {
      sessions: [{ sessionId, startedAt: now, endedAt: null, reason: 'start', source: carrier, requirementRevision, requirementDocHash }],
      sessionHistoryComplete: true,
    } : {}),
    status,
    phase,
    actor,
    createdAt: now,
    updatedAt: now,
    heartbeatAt: now,
    attempts: 1,
    checkpoint,
    failure: null,
    answers: [],
    events: [{ at: now, status, phase, note: 'run registered' }],
    // Which version of the requirement document this run agreed to execute.
    // Optional: legacy runs and tests keep their exact previous shape.
    ...(requirementRevision !== null ? { requirementRevision } : {}),
    ...(requirementDocHash !== null ? { requirementDocHash } : {}),
    ...(acceptanceIds !== null ? { acceptanceIds: [...acceptanceIds] } : {}),
  }
  return { schema: RUN_SCHEMA, created: true, reused: false, run: writeRun(root, run) }
}

const ALLOWED_TRANSITIONS = {
  queued: ['running', 'failed', 'paused', 'waiting-input', 'done', 'cancelled'],
  running: ['waiting-input', 'paused', 'failed', 'done', 'cancelled'],
  'waiting-input': ['running', 'paused', 'failed', 'done', 'cancelled'],
  paused: ['running', 'queued', 'failed', 'done', 'cancelled'],
  failed: ['queued', 'running'],
  done: [],
}

export function updateRun(options) {
  return options.apply ? withRunLock(options.root, () => updateRunUnlocked(options)) : updateRunUnlocked(options)
}

function updateRunUnlocked({ root, runId, status = null, phase = null, note = null, checkpoint = null, failure = null, answer = null, sessionId = null, requirementRevision = null, requirementDocHash = null, acceptanceIds = null, expectedRun = null, apply = false }) {
  const run = readRun(root, runId)
  if (!run) throw runError('run-not-found', `运行记录 ${runId} 不存在`, 404)
  if (expectedRun) {
    const businessState = value => JSON.stringify([value.id, value.status, value.phase, value.sessionId ?? null, value.sessions ?? null,
      value.checkpoint ?? null, value.answers ?? [], value.failure ?? null, value.interruptedSessions ?? null, value.requirementRevision ?? null,
      value.requirementDocHash ?? null, value.acceptanceIds ?? null])
    if (businessState(run) !== businessState(expectedRun)) throw runError('run-changed', '运行状态已变化，请重新读取后重试')
  }
  if (status !== null && !RUN_STATES.includes(status)) throw runError('run-status-invalid', `未知的运行状态 ${status}`, 400)
  if (status !== null && status !== run.status && !(ALLOWED_TRANSITIONS[run.status] ?? []).includes(status)) {
    throw runError('run-transition-invalid', `运行状态不能从 ${run.status} 变为 ${status}`)
  }
  const now = new Date().toISOString()
  // Answers are the human side of a decision request: append-only so a resumed
  // turn can be re-read later without the panel having to remember it.
  const answers = answer
    ? [...(run.answers ?? []), { at: now, actor: answer.actor ?? 'human:local', text: String(answer.text ?? '') }]
    : (run.answers ?? [])
  // Older records retain only their latest session; its predecessors cannot be
  // reconstructed from an identifier or a timestamp.
  let sessions = Array.isArray(run.sessions) ? run.sessions.map((entry) => ({ ...entry })) : null
  let sessionHistoryComplete = run.sessionHistoryComplete
  if (sessionId && sessionId !== run.sessionId) {
    if (!sessions) {
      sessions = run.sessionId ? [{ sessionId: run.sessionId, startedAt: null, endedAt: null, reason: 'legacy', requirementRevision: run.requirementRevision ?? null, requirementDocHash: run.requirementDocHash ?? null }] : []
      sessionHistoryComplete = false
    }
    if (sessions.some((entry) => entry.sessionId === sessionId)) throw runError('run-session-reused', '不能将运行切换回已结束的会话')
    if (sessions.length && !sessions.at(-1).endedAt) sessions[sessions.length - 1].endedAt = now
    sessions.push({ sessionId, startedAt: now, endedAt: null, reason: 'resume', source: run.carrier ?? null, requirementRevision: requirementRevision ?? run.requirementRevision ?? null, requirementDocHash: requirementDocHash ?? run.requirementDocHash ?? null })
  }
  const interruptedSessions = interruptedSessionsFor(run, failure) ?? (run.status === 'failed' ? interruptedSessionsFor(run, run.failure) : null)
  const next = {
    ...run,
    status: status ?? run.status,
    phase: phase ?? run.phase,
    sessionId: sessionId ?? run.sessionId,
    ...(sessions ? { sessions, sessionHistoryComplete: sessionHistoryComplete === true } : {}),
    updatedAt: now,
    heartbeatAt: now,
    checkpoint: checkpoint ?? run.checkpoint,
    failure: failure ?? run.failure,
    ...(interruptedSessions ? { interruptedSessions } : {}),
    answers,
    events: [...(run.events ?? []), { at: now, status: status ?? run.status, phase: phase ?? run.phase, note }],
    ...(requirementRevision !== null ? { requirementRevision } : {}),
    ...(requirementDocHash !== null ? { requirementDocHash } : {}),
    ...(acceptanceIds !== null ? { acceptanceIds: [...acceptanceIds] } : {}),
  }
  if (apply) writeRun(root, next)
  return { applied: apply === true, run: next }
}

/**
 * Refreshes the heartbeat of a live run. Only an active run accepts a beat, so
 * a dead process cannot keep showing up as "running" by writing this file.
 */
export function touchRun(options) {
  if (!existsSync(runDir(options.root))) return { applied: false, run: null }
  return options.apply !== false ? withRunLock(options.root, () => touchRunUnlocked(options)) : touchRunUnlocked(options)
}

function touchRunUnlocked({ root, runId, note = null, apply = true, now = Date.now(), expectedSessionId = undefined }) {
  const run = readRun(root, runId)
  if (!run || !ACTIVE_RUN_STATES.includes(run.status)) return { applied: false, run: run ?? null }
  if (expectedSessionId !== undefined && (run.sessionId ?? null) !== expectedSessionId) return { applied: false, run }
  const at = new Date(now).toISOString()
  const next = { ...run, heartbeatAt: at, updatedAt: at }
  if (note) next.events = [...(run.events ?? []), { at, status: run.status, phase: run.phase, note }]
  if (apply) writeRun(root, next)
  return { applied: true, run: next }
}

/** Marks the run failed when its heartbeat is gone: a dead run is never shown as running. */
export function sweepStaleRuns(options) {
  if (!existsSync(runDir(options.root))) return { schema: RUN_SCHEMA, swept: [] }
  return options.apply ? withRunLock(options.root, () => sweepStaleRunsUnlocked(options)) : sweepStaleRunsUnlocked(options)
}

function sweepStaleRunsUnlocked({ root, apply = false, now = Date.now() }) {
  // A turn parked for a human answer (or paused on purpose) is idle by design,
  // so an old heartbeat there is not a dead executor.
  const stale = listRuns(root).filter(
    (run) => ACTIVE_RUN_STATES.includes(run.status) && !IDLE_RUN_STATES.includes(run.status) && heartbeatExpired(run, now),
  )
  if (apply) {
    for (const run of stale) {
      const interruptedSessions = interruptedSessionsFor(run, { code: 'heartbeat-lost' })
      const updated = {
        ...run,
        status: 'failed',
        updatedAt: new Date().toISOString(),
        heartbeatAt: new Date().toISOString(),
        failure: { code: 'heartbeat-lost', message: '执行器心跳丢失，已标记失败；可从检查点恢复' },
        ...(interruptedSessions ? { interruptedSessions } : {}),
        events: [
          ...(run.events ?? []),
          { at: new Date().toISOString(), status: 'failed', phase: run.phase, note: 'heartbeat lost' },
        ],
      }
      writeRun(root, updated)
    }
  }
  return { schema: RUN_SCHEMA, swept: stale.map((run) => run.id) }
}

export function runView({ root, requirementId, decisionFor = resolveRunDecision }) {
  const selected = resumableRunFor(root, requirementId)
  const all = listRuns(root).filter((run) => run.requirement === requirementId)
  const latest = selected ?? all[all.length - 1] ?? null
  if (!latest) return { exists: false, id: null, status: null, label: null, active: false }
  // Waiting for a human or paused on purpose is still an open run: the panel
  // must keep offering answer/cancel instead of calling it dead.
  const running =
    ACTIVE_RUN_STATES.includes(latest.status) &&
    (IDLE_RUN_STATES.includes(latest.status) || !heartbeatExpired(latest))
  const decision = decisionFor(root, latest)
  const pending = decision.pending
  return {
    exists: true,
    id: latest.id,
    status: latest.status,
    label: RUN_LABELS[latest.status] ?? latest.status,
    phase: latest.phase ?? null,
    carrier: latest.carrier ?? null,
    sessionId: latest.sessionId ?? null,
    change: latest.change ?? null,
    active: running,
    // Only a run that should be making progress can be stale: a turn waiting for
    // a human answer is idle by design, not dead.
    stale:
      ACTIVE_RUN_STATES.includes(latest.status) &&
      !IDLE_RUN_STATES.includes(latest.status) &&
      !running,
    // "Waiting for input" is only a real question when the executor wrote a
    // decision request. A turn that merely ended (agent idle) must not offer
    // "回答并继续": there is nothing to answer.
    awaitingAnswer: Boolean(selected) && (latest.status === 'waiting-input' || (latest.status === 'failed' && isResumableHostFailure(latest.failure))) && pending,
    idleHandback: latest.status === 'waiting-input' && !pending,
    lastActivityAt: latest.heartbeatAt ?? latest.updatedAt ?? latest.createdAt ?? null,
    startedAt: latest.createdAt ?? null,
    updatedAt: latest.updatedAt ?? null,
    failure: latest.failure ?? null,
    decision: decision.path,
    ...(pending ? { decisionReadable: Boolean(decision.identity) } : {}),
    answers: (latest.answers ?? []).length,
    lastAnswerAt: (latest.answers ?? []).at(-1)?.at ?? null,
    // Requirements-document binding: exposed only when recorded, so legacy
    // runs keep their exact previous public shape.
    ...(latest.requirementRevision != null || latest.requirementDocHash != null || Array.isArray(latest.acceptanceIds)
      ? {
          requirementBinding: {
            requirementRevision: latest.requirementRevision ?? null,
            requirementDocHash: latest.requirementDocHash ?? null,
            acceptanceIds: Array.isArray(latest.acceptanceIds) ? [...latest.acceptanceIds] : [],
          },
        }
      : {}),
  }
}
