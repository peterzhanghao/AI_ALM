import { createHash } from 'node:crypto'

export const MAX_AUTO_DISPATCHES = 3
export const MAX_AUTO_VERIFICATIONS = 4
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

/** Ignore heartbeats, timestamps, prose and log growth; only bound facts count. */
export function progressFingerprint({ snapshot, evidence }) {
  const files = (snapshot?.files ?? []).filter(({ path }) => !/(^|\/)(artifacts|logs|reports)(\/|$)|\.(log|md)$/i.test(path))
  return hash({ head: snapshot?.headSha, files: files.map(({ path, hash }) => ({ path, hash })),
    evidence: evidence ? { requirementHash: evidence.requirementHash, testRevision: evidence.testRevision,
      result: evidence.result, commands: (evidence.commands ?? []).map(({ id, exitCode, result, timedOut, spawnFailed }) => ({ id, exitCode, result, timedOut, spawnFailed })) } : null })
}

/**
 * The identity an automatic authorization is bound to.
 *
 * `scopeHash` covers the goal, scope and acceptance text. Legacy authorizations
 * only have `requirementHash` (which also covers relations and metadata); they
 * keep that stricter binding until a human resume refreshes them.
 */
export function authorizationScope(authorization) {
  return typeof authorization?.scopeHash === 'string' && authorization.scopeHash !== '' ? authorization.scopeHash : null
}

export function factsScope(facts) {
  return typeof facts?.scopeHash === 'string' && facts.scopeHash !== '' ? facts.scopeHash : null
}

/** True when the authorization still covers what this delivery is asked to build. */
export function authorizationScopeMatchesFacts(authorization, facts) {
  const authorized = authorizationScope(authorization)
  const current = factsScope(facts)
  if (authorized !== null && current !== null) return authorized === current
  return typeof authorization?.requirementHash === 'string' && authorization.requirementHash !== '' &&
    authorization.requirementHash === facts?.requirementHash
}

/**
 * Refresh a start-time authorization after a human-consented requirement edit.
 *
 * Only an explicit human click (declaring the modules that unblock the delivery,
 * narrowing acceptance, resuming the run) may issue this. It preserves the
 * dispatch/verification budget so a re-authorization never grants extra rounds.
 */
export function rebindAutomaticAuthorization({ autoAdvance, facts, actor, reason = 'requirement-metadata-rebound', at = new Date().toISOString() } = {}) {
  const authorization = autoAdvance?.authorization
  if (!authorization || autoAdvance?.authorized !== true || authorization.source !== 'start-v4') return null
  if (!String(actor ?? '').startsWith('human:')) return null
  if (!facts?.requirementHash) return null
  const changes = []
  const next = { ...authorization }
  if (factsScope(facts) !== null && next.scopeHash !== factsScope(facts)) {
    changes.push({ field: 'scopeHash', from: next.scopeHash ?? null, to: factsScope(facts) })
    next.scopeHash = factsScope(facts)
  }
  if (next.requirementHash !== facts.requirementHash) {
    changes.push({ field: 'requirementHash', from: next.requirementHash ?? null, to: facts.requirementHash })
    next.requirementHash = facts.requirementHash
  }
  if (facts.revision !== undefined && next.revision !== facts.revision) {
    changes.push({ field: 'revision', from: next.revision ?? null, to: facts.revision })
    next.revision = facts.revision
  }
  if (changes.length === 0) return { changed: false, autoAdvance }
  next.rebound = { at: String(at), actor: String(actor), reason: String(reason), changes }
  // A declaration only re-arms a stop whose cause was the requirement identity
  // itself. A genuine environment or timeout stop stays stopped until a human
  // explicitly resumes it; refreshing the identity must not bypass that gate.
  const rearm = autoAdvance.status !== 'stopped' || ['requirement-changed', 'auto-facts-changed'].includes(autoAdvance.reason)
  return {
    changed: true,
    autoAdvance: { ...autoAdvance, authorization: next, ...(rearm ? { status: 'authorized', reason: null } : {}) },
  }
}

/** Pure, fail-closed scheduling policy. Authorization never comes from model text. */
export function nextAutomaticAction({ run, pendingDecision, carrier, repairPending, facts }) {
  const state = run?.checkpoint?.autoAdvance
  if (!state?.authorized || state.authorization?.source !== 'start-v4') return { action: 'stop', reason: 'not-authorized' }
  if (!['running', 'waiting-input'].includes(run.status)) return { action: 'stop', reason: 'run-not-active' }
  // A plan-first round never auto-advances into implementation: that transition
  // is the human's confirmation, not a budget-driven continuation.
  if (run.checkpoint?.plan?.required === true && run.checkpoint.plan.status !== 'approved') return { action: 'stop', reason: 'plan-not-approved' }
  if (pendingDecision) return { action: 'decision', reason: 'human-decision-required' }
  if (run.checkpoint?.decisionReframe) return { action: 'stop', reason: 'decision-options-requested' }
  if (!carrier) return { action: 'stop', reason: 'no-authorized-carrier' }
  if (!facts || !facts.snapshot?.complete || !facts.snapshot?.headSha) return { action: 'stop', reason: 'facts-unavailable' }
  if (!authorizationScopeMatchesFacts(state.authorization, facts)) return { action: 'stop', reason: 'requirement-changed' }
  if (facts.accepted) return { action: 'stop', reason: 'delivery-already-accepted' }
  if (facts.environmentBlocked) return { action: 'stop', reason: 'environment-blocked' }
  if (repairPending) return { action: 'repair', reason: 'repair-pending' }
  // Fresh, complete host evidence for this exact snapshot outranks a stale
  // scheduling stop. `environment-blocked` only said the previous round could
  // not run the browser/pipe commands; once the host has produced a passing
  // receipt, a stopped flag must not keep the verified delivery out of a
  // candidate — that turned one blocked round into a permanent dead end.
  if (facts.candidateEligible) return { action: 'candidate', reason: 'evidence-ready' }
  if (state.status === 'stopped') return { action: 'stop', reason: state.reason ?? 'stopped' }
  if (state.status === 'running' && state.lastDispatchFingerprint === facts.fingerprint) return { action: 'stop', reason: 'no-progress' }
  if (Number(state.dispatches ?? 0) >= MAX_AUTO_DISPATCHES) return { action: 'stop', reason: 'auto-budget-exhausted' }
  return { action: 'continue', reason: 'work-remains' }
}
