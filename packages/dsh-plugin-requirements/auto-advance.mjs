import { createHash } from 'node:crypto'

export const MAX_AUTO_DISPATCHES = 3
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

/** Ignore heartbeats, timestamps, prose and log growth; only bound facts count. */
export function progressFingerprint({ snapshot, evidence }) {
  const files = (snapshot?.files ?? []).filter(({ path }) => !/(^|\/)(artifacts|logs|reports)(\/|$)|\.(log|md)$/i.test(path))
  return hash({ head: snapshot?.headSha, files: files.map(({ path, hash }) => ({ path, hash })),
    evidence: evidence ? { requirementHash: evidence.requirementHash, testRevision: evidence.testRevision,
      result: evidence.result, commands: (evidence.commands ?? []).map(({ id, exitCode, result, timedOut, spawnFailed }) => ({ id, exitCode, result, timedOut, spawnFailed })) } : null })
}

/** Pure, fail-closed scheduling policy. Authorization never comes from model text. */
export function nextAutomaticAction({ run, pendingDecision, carrier, repairPending, facts }) {
  const state = run?.checkpoint?.autoAdvance
  if (!state?.authorized || state.authorization?.source !== 'start-v4') return { action: 'stop', reason: 'not-authorized' }
  if (!['running', 'waiting-input'].includes(run.status)) return { action: 'stop', reason: 'run-not-active' }
  if (pendingDecision) return { action: 'decision', reason: 'human-decision-required' }
  if (run.checkpoint?.decisionReframe) return { action: 'stop', reason: 'decision-options-requested' }
  if (!carrier) return { action: 'stop', reason: 'no-authorized-carrier' }
  if (!facts || !facts.snapshot?.complete || !facts.snapshot?.headSha) return { action: 'stop', reason: 'facts-unavailable' }
  if (state.authorization.requirementHash !== facts.requirementHash || state.authorization.revision !== facts.revision) return { action: 'stop', reason: 'requirement-changed' }
  if (facts.accepted) return { action: 'stop', reason: 'delivery-already-accepted' }
  if (facts.environmentBlocked) return { action: 'stop', reason: 'environment-blocked' }
  if (repairPending) return { action: 'repair', reason: 'repair-pending' }
  if (state.status === 'stopped') return { action: 'stop', reason: state.reason ?? 'stopped' }
  if (facts.candidateEligible) return { action: 'candidate', reason: 'evidence-ready' }
  if (state.status === 'running' && state.lastDispatchFingerprint === facts.fingerprint) return { action: 'stop', reason: 'no-progress' }
  if (Number(state.dispatches ?? 0) >= MAX_AUTO_DISPATCHES) return { action: 'stop', reason: 'auto-budget-exhausted' }
  return { action: 'continue', reason: 'work-remains' }
}
