import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import RequirementsService from '../index.js'
import * as runs from '../../alm-core/src/requirements/run.mjs'
import { nextAutomaticAction, progressFingerprint, rebindAutomaticAuthorization } from '../auto-advance.mjs'

const authorization = { actor: 'human:test', source: 'start-v4', requirementHash: 'reqhash', scopeHash: 'scope', revision: 1 }
const facts = (fingerprint = 'first') => ({ requirementHash: 'reqhash', scopeHash: 'scope', revision: 1, snapshot: { complete: true, headSha: 'head' }, fingerprint, candidateEligible: false })
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'alm-auto-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const instance = Object.create(RequirementsService.prototype)
  Object.assign(instance, { activeRuns: new Map(), runHeartbeats: new Map(), pendingRepairs: new Map(), repairJobs: new Map(), monitorFailure() {} })
  const run = runs.createRun({ root, requirementId: 'REQ-A', carrier: 'mock' }).run
  runs.updateRun({ root, runId: run.id, status: 'running', checkpoint: { autoAdvance: { authorized: true, authorization, dispatches: 0, maxDispatches: 3, status: 'authorized' } }, apply: true })
  instance.automaticFacts = () => facts()
  instance.activeRuns.set(instance.executionKey(root, 'REQ-A'), { root, runId: run.id, agent: { followup: async () => {} } })
  return { root, instance, runId: run.id }
}
async function drain(f) {
  for (let i = 0; i < 12; i++) { const jobs = [...(f.instance.autoAdvanceJobs?.values() ?? [])]; if (!jobs.length) break; await Promise.all(jobs) }
}
function policy(state = {}, overrides = {}) {
  return nextAutomaticAction({ run: { status: 'waiting-input', checkpoint: { autoAdvance: { authorized: true, authorization, dispatches: 0, ...state } } }, carrier: true, facts: facts(), ...overrides })
}

test('legacy runs never acquire retroactive authorization', () => {
  assert.equal(nextAutomaticAction({ run: { checkpoint: {} } }).reason, 'not-authorized')
  assert.equal(policy({}, { run: { checkpoint: { autoAdvance: { authorized: true } } } }).reason, 'not-authorized')
})

test('asking AI to reframe is not business approval even when candidate evidence already passes', () => {
  const run = { status: 'waiting-input', checkpoint: { decisionReframe: { path: '.alm/runs/RUN-1-decision.md' }, autoAdvance: { authorized: true, authorization } } }
  assert.deepEqual(nextAutomaticAction({ run, pendingDecision: false, carrier: true, facts: { ...facts(), candidateEligible: true } }), { action: 'stop', reason: 'decision-options-requested' })
  assert.equal(nextAutomaticAction({ run, pendingDecision: true, carrier: true, facts: facts() }).action,'decision')
})

test('answering a reframed request restores only existing verified automatic authorization and budget',t=>{
  const f=fixture(t)
  f.instance.automaticFacts=()=>({...facts(),configHash:'config'})
  const previous={authorized:true,authorization:{...authorization,configHash:'config'},dispatches:2,maxDispatches:3,status:'stopped',reason:'decision-options-requested',verification:{attempts:1}}
  const run={requirement:'REQ-A',checkpoint:{decisionReframe:{contentHash:'old'},autoAdvance:previous}}
  const result=f.instance.resumeAutomaticCheckpoint(f.root,run,'human:test')
  assert.equal(result.receipt.autoAdvanceResumed,true)
  assert.equal(result.checkpoint.autoAdvance.status,'authorized')
  assert.equal(result.checkpoint.autoAdvance.dispatches,2)
  assert.deepEqual(result.checkpoint.autoAdvance.authorization,previous.authorization)
  f.instance.automaticFacts=()=>({...facts(),configHash:'changed'})
  const rebound=f.instance.resumeAutomaticCheckpoint(f.root,run,'human:test')
  assert.equal(rebound.receipt.autoAdvanceResumed,true)
  assert.equal(rebound.receipt.autoAdvanceRebound,true)
  assert.equal(rebound.checkpoint.autoAdvance.authorization.configHash,'changed')
  assert.equal(rebound.checkpoint.autoAdvance.authorization.rebound.reason,'resume-verification-config-rebound')
  assert.equal(rebound.checkpoint.autoAdvance.dispatches,2)
  assert.equal(f.instance.resumeAutomaticCheckpoint(f.root,run,'agent:forged').receipt.autoAdvanceResumed,false)
})
for (const status of ['paused', 'cancelled', 'done', 'failed']) test(`${status} is never revived`, () => {
  assert.equal(policy({}, { run: { status, checkpoint: { autoAdvance: { authorized: true, authorization } } } }).reason, 'run-not-active')
})
for (const [input, reason] of [[{ pendingDecision: true }, 'human-decision-required'], [{ carrier: false }, 'no-authorized-carrier'], [{ facts: null }, 'facts-unavailable'], [{ facts: { ...facts(), scopeHash: 'changed' } }, 'requirement-changed']]) test(reason, () => assert.equal(policy({}, input).reason, reason))

test('metadata-only requirement edits keep the scoped authorization', () => {
  // Declaring allocated modules changes requirementHash and revision but not
  // what the run was asked to build; it must not stop the run it unblocks.
  const metadataChanged = { ...facts(), requirementHash: 'newhash', revision: 2 }
  assert.equal(policy({}, { facts: metadataChanged }).action, 'continue')
  // A legacy authorization without scopeHash keeps the strict binding.
  const legacy = { ...authorization }
  delete legacy.scopeHash
  assert.equal(nextAutomaticAction({ run: { status: 'waiting-input', checkpoint: { autoAdvance: { authorized: true, authorization: legacy } } }, carrier: true, facts: metadataChanged }).reason, 'requirement-changed')
})

test('a human-consented declaration rebinds the authorization without touching budgets', () => {
  const autoAdvance = { authorized: true, authorization: { ...authorization, configHash: 'config' }, dispatches: 1, maxDispatches: 3, status: 'stopped', reason: 'requirement-changed', verification: { attempts: 1, records: [{ status: 'failed', key: 'old' }] } }
  const rebind = rebindAutomaticAuthorization({
    autoAdvance,
    facts: { ...facts(), requirementHash: 'newhash', scopeHash: 'newscope', revision: 2, configHash: 'config' },
    actor: 'human:test',
    reason: 'declare-allocation',
    at: '2026-11-19T00:00:00.000Z',
  })
  assert.equal(rebind.changed, true)
  assert.equal(rebind.autoAdvance.authorization.requirementHash, 'newhash')
  assert.equal(rebind.autoAdvance.authorization.scopeHash, 'newscope')
  assert.equal(rebind.autoAdvance.authorization.revision, 2)
  assert.equal(rebind.autoAdvance.authorization.rebound.reason, 'declare-allocation')
  assert.equal(rebind.autoAdvance.authorization.rebound.changes.length, 3)
  assert.equal(rebind.autoAdvance.status, 'authorized')
  assert.equal(rebind.autoAdvance.reason, null)
  // Re-authorization refreshes identity only; it never grants extra rounds.
  assert.equal(rebind.autoAdvance.dispatches, 1)
  assert.deepEqual(rebind.autoAdvance.verification, autoAdvance.verification)
  // No anonymous or model-authored re-authorization.
  assert.equal(rebindAutomaticAuthorization({ autoAdvance, facts: { ...facts(), scopeHash: 'newscope' }, actor: 'agent:forged' }), null)
  // Nothing changed: no rewrite.
  assert.equal(rebindAutomaticAuthorization({ autoAdvance, facts: { ...facts(), configHash: 'config' }, actor: 'human:test' }).changed, false)
})

test('three persistent dispatches do not consume independent repair budget', () => {
  assert.equal(policy({ dispatches: 3 }).reason, 'auto-budget-exhausted')
  assert.equal(policy({ dispatches: 2 }).action, 'continue')
  assert.equal(policy({}, { repairPending: true }).action, 'repair')
})
test('one unchanged automatic turn stops despite budget remaining', () => {
  assert.equal(policy({ status: 'running', dispatches: 1, lastDispatchFingerprint: 'first' }).reason, 'no-progress')
})
test('timestamps, output growth and summary files are not progress', () => {
  const snapshot = { headSha: 'head', files: [{ path: 'src/x.js', hash: 'x' }, { path: 'summary.md', hash: 'old' }] }
  const evidence = { result: 'fail', requirementHash: 'req', testRevision: 't', finishedAt: 'old', commands: [{ id: 'cmd', exitCode: 1, stdout: 'old' }] }
  const first = progressFingerprint({ snapshot, evidence })
  snapshot.files[1].hash = 'new'; evidence.finishedAt = 'new'; evidence.commands[0].stdout = 'more'
  assert.equal(progressFingerprint({ snapshot, evidence }), first)
  evidence.commands[0].exitCode = 0
  assert.notEqual(progressFingerprint({ snapshot, evidence }), first)
})
test('authorization requires trusted explicit subject and complete bound facts', (t) => {
  const f = fixture(t)
  assert.throws(() => f.instance.prepareAutomaticAuthorization(f.root, 'REQ-A', null), { code: 'auto-authorization-required' })
  const state = f.instance.prepareAutomaticAuthorization(f.root, 'REQ-A', { kind: 'human', id: 'human:test' })
  assert.equal(state.dispatches, 0); assert.equal(state.maxDispatches, 3)
  assert.equal(state.authorization.requirementHash, 'reqhash')
  assert.equal(state.authorization.scopeHash, 'scope')
})
test('a declaration rebind updates the run checkpoint and preserves its budgets', (t) => {
  const f = fixture(t)
  let run = runs.readRun(f.root, f.runId)
  runs.updateRun({ root: f.root, runId: f.runId, status: 'waiting-input',
    checkpoint: { ...run.checkpoint, autoAdvance: { ...run.checkpoint.autoAdvance, status: 'stopped', reason: 'requirement-changed',
      authorization: { ...authorization, configHash: 'config' }, dispatches: 1, verification: { attempts: 1 } } }, apply: true })
  f.instance.automaticFacts = () => ({ requirementHash: 'newhash', scopeHash: 'newscope', revision: 2, configHash: 'config',
    snapshot: { complete: true, headSha: 'head' }, fingerprint: 'f' })
  f.instance.activeRuns.delete(f.instance.executionKey(f.root, 'REQ-A'))
  const rebound = f.instance.rebindRequirementAuthorization(f.root, 'REQ-A', 'human:test', 'declare-allocation')
  assert.equal(rebound?.rebound, true)
  run = runs.readRun(f.root, f.runId)
  assert.equal(run.checkpoint.autoAdvance.status, 'authorized')
  assert.equal(run.checkpoint.autoAdvance.reason, null)
  assert.equal(run.checkpoint.autoAdvance.dispatches, 1)
  assert.equal(run.checkpoint.autoAdvance.verification.attempts, 1)
  assert.equal(run.checkpoint.autoAdvance.authorization.requirementHash, 'newhash')
  assert.equal(run.checkpoint.autoAdvance.authorization.scopeHash, 'newscope')
  assert.equal(run.checkpoint.autoAdvance.authorization.rebound.reason, 'declare-allocation')
  // A model or an anonymous caller cannot mint an authorization.
  assert.equal(f.instance.rebindRequirementAuthorization(f.root, 'REQ-A', 'agent:forged', 'declare-allocation'), null)
})

test('idle dispatches once then stops without fake answers or new sessions', async (t) => {
  const f = fixture(t); let dispatches = 0
  f.instance.activeRuns.get(f.instance.executionKey(f.root, 'REQ-A')).agent.followup = async (message) => { dispatches++; assert.match(message.id, /^[0-9a-f-]{36}$/i); assert.equal(message.source.kind, 'user'); assert.match(message.content[0].text, /系统自动衔接/) }
  f.instance.executionCarrier = () => assert.fail('automatic continuation cannot create a carrier')
  f.instance.settleResumedTurn(f.root, f.runId)
  f.instance.scheduleAutomaticAdvance(f.root, f.runId)
  await drain(f)
  const run = runs.readRun(f.root, f.runId)
  assert.equal(dispatches, 1); assert.equal(run.checkpoint.autoAdvance.dispatches, 1)
  assert.equal(run.checkpoint.autoAdvance.reason, 'no-progress'); assert.equal(run.answers.length, 0)
})
for (const mode of ['sync', 'async']) test(`automatic dispatch records ${mode} host failure and stops`, async (t) => {
  const f = fixture(t)
  const error = Object.assign(new Error('host rejected automatic turn'), { code: 'HOST_REJECTED' })
  let attempts = 0
  f.instance.activeRuns.get(f.instance.executionKey(f.root, 'REQ-A')).agent.followup = () => {
    attempts++
    if (mode === 'sync') throw error
    return Promise.reject(error)
  }
  f.instance.settleResumedTurn(f.root, f.runId)
  await drain(f)
  const run = runs.readRun(f.root, f.runId)
  assert.equal(attempts, 1)
  assert.equal(run.status, 'failed')
  assert.equal(run.failure.code, 'HOST_REJECTED')
  assert.equal(run.checkpoint.autoAdvance.status, 'stopped')
  assert.equal(run.checkpoint.autoAdvance.reason, 'auto-turn-failed')
  assert.equal(f.instance.runHeartbeats.size, 0)
  assert.equal(run.answers.length, 0)
  f.instance.scheduleAutomaticAdvance(f.root, f.runId)
  await drain(f)
  assert.equal(attempts, 1)
})
test('three progress-making dispatches exhaust durable budget and preserve repair count', async (t) => {
  const f = fixture(t); let count = 0
  let run = runs.readRun(f.root, f.runId)
  runs.updateRun({ root: f.root, runId: f.runId, checkpoint: { ...run.checkpoint, inPlaceRepair: { attempts: 2 } }, apply: true })
  f.instance.automaticFacts = () => facts(`version-${count}`)
  f.instance.activeRuns.get(f.instance.executionKey(f.root, 'REQ-A')).agent.followup = async () => { count++ }
  f.instance.settleResumedTurn(f.root, f.runId); await drain(f)
  run = runs.readRun(f.root, f.runId)
  assert.equal(count, 3); assert.equal(run.checkpoint.autoAdvance.reason, 'auto-budget-exhausted')
  assert.equal(run.checkpoint.inPlaceRepair.attempts, 2)
  f.instance.scheduleAutomaticAdvance(f.root, f.runId); await drain(f)
  assert.equal(count, 3)
})
test('legacy eligible evidence cannot create a candidate without server verification', async (t) => {
  const f = fixture(t); let creates = 0
  f.instance.automaticFacts = () => ({ ...facts(), candidateEligible: true })
  f.instance.createDeliveryCandidate = (root, id, options) => { creates++; assert.equal(options.actor, 'system:auto-advance'); return { candidate: { id: 'CAND-1' } } }
  f.instance.activeRuns.get(f.instance.executionKey(f.root, 'REQ-A')).agent.followup = () => assert.fail('candidate requires no model')
  f.instance.settleResumedTurn(f.root, f.runId); await drain(f)
  const run = runs.readRun(f.root, f.runId)
  assert.equal(creates, 0); assert.notEqual(run.checkpoint.autoAdvance.status, 'candidate-ready')
  assert.equal(run.checkpoint.autoAdvance.candidateId, undefined); assert.equal(run.answers.length, 0)
})
test('accepted delivery and unrecoverable environment are explicit stops', () => {
  assert.equal(policy({}, { facts: { ...facts(), accepted: true } }).reason, 'delivery-already-accepted')
  assert.equal(policy({}, { facts: { ...facts(), environmentBlocked: true } }).reason, 'environment-blocked')
})
test('fresh host evidence outranks a stale environment-blocked stop', () => {
  const stopped = { status: 'stopped', reason: 'environment-blocked' }
  assert.deepEqual(policy(stopped, { facts: { ...facts(), candidateEligible: true } }), { action: 'candidate', reason: 'evidence-ready' })
  assert.equal(policy(stopped).reason, 'environment-blocked')
  assert.equal(policy({ status: 'stopped', reason: 'no-progress' }, { facts: { ...facts(), candidateEligible: true } }).action, 'candidate')
})
test('lost carrier persists stop without creating replacement', async (t) => {
  const f = fixture(t)
  f.instance.activeRuns.clear()
  f.instance.executionCarrier = () => assert.fail('no silent replacement')
  f.instance.settleResumedTurn(f.root, f.runId); await drain(f)
  assert.equal(runs.readRun(f.root, f.runId).checkpoint.autoAdvance.reason, 'no-authorized-carrier')
})
test('candidate receipt survives repeat settlement without model dispatch', async (t) => {
  const f = fixture(t)
  const prior = runs.readRun(f.root, f.runId)
  runs.updateRun({ root: f.root, runId: f.runId, checkpoint: { ...prior.checkpoint, autoAdvance: { ...prior.checkpoint.autoAdvance, status: 'candidate-ready', candidateId: 'CAND-stable' } }, apply: true })
  f.instance.automaticFacts = () => ({ ...facts(), candidateEligible: true })
  f.instance.createDeliveryCandidate = () => ({ candidate: { id: 'CAND-stable' } })
  f.instance.activeRuns.get(f.instance.executionKey(f.root, 'REQ-A')).agent.followup = () => assert.fail('must not dispatch')
  f.instance.settleResumedTurn(f.root, f.runId); await drain(f)
  f.instance.scheduleAutomaticAdvance(f.root, f.runId); await drain(f)
  assert.equal(runs.readRun(f.root, f.runId).checkpoint.autoAdvance.candidateId, 'CAND-stable')
  assert.equal(runs.readRun(f.root, f.runId).checkpoint.autoAdvance.dispatches, 0)
})
test('new authorization is not attached when start reuses historical run', async (t) => {
  const f = fixture(t)
  runs.updateRun({ root: f.root, runId: f.runId, status: 'waiting-input', checkpoint: { autoAdvance: null }, apply: true })
  const result = await f.instance.startDeliveryRun({ root: f.root, requirementId: 'REQ-A', autoAdvance: true, authorizationSubject: { id: 'human:test', kind: 'human' } })
  assert.equal(result.reused, true)
  assert.equal(runs.readRun(f.root, f.runId).checkpoint.autoAdvance, null)
})
test('queued cancel and unreadable decision stop before dispatch', async (t) => {
  for (const gate of ['cancel', 'decision']) {
    const f = fixture(t)
    f.instance.activeRuns.get(f.instance.executionKey(f.root, 'REQ-A')).agent.followup = () => assert.fail('must not dispatch')
    f.instance.settleResumedTurn(f.root, f.runId)
    const run = runs.readRun(f.root, f.runId)
    runs.updateRun({ root: f.root, runId: f.runId, ...(gate === 'cancel' ? { status: 'cancelled' } : { checkpoint: { ...run.checkpoint, decision: '.alm/runs/missing.md' } }), apply: true })
    await drain(f)
    assert.equal(runs.readRun(f.root, f.runId).status, gate === 'cancel' ? 'cancelled' : 'waiting-input')
  }
})

test('a human resume re-authorizes a changed requirement instead of stopping forever', (t) => {
  const f = fixture(t)
  // The round was granted for one revision, then the requirement text changed.
  // Every later resume used to be denied with auto-facts-changed, so the host
  // verification never ran again and the panel offered 继续推进 indefinitely.
  f.instance.automaticFacts = () => ({ ...facts(), requirementHash: 'newhash', scopeHash: 'newscope', revision: 2, configHash: 'config' })
  const granted = { ...authorization, configHash: 'config' }
  const stopped = { requirement: 'REQ-A', status: 'waiting-input', checkpoint: { autoAdvance: { authorized: true, authorization: granted, dispatches: 1, maxDispatches: 3, status: 'stopped', reason: 'requirement-changed' } } }
  const resumed = f.instance.resumeAutomaticCheckpoint(f.root, stopped, 'human:test')
  assert.equal(resumed.receipt.autoAdvanceResumed, true)
  assert.equal(resumed.receipt.autoAdvanceRebound, true)
  assert.equal(resumed.receipt.autoAdvanceReboundReason, 'resume-requirement-rebound')
  assert.equal(resumed.checkpoint.autoAdvance.status, 'authorized')
  assert.equal(resumed.checkpoint.autoAdvance.dispatches, 1)
  const auth = resumed.checkpoint.autoAdvance.authorization
  assert.equal(auth.requirementHash, 'newhash')
  assert.equal(auth.scopeHash, 'newscope')
  assert.equal(auth.revision, 2)
  assert.equal(auth.rebound.actor, 'human:test')
  assert.equal(auth.rebound.changes.length, 3)
  // The same mismatch stays denied when the stop had another cause or the
  // caller is not a human: only the click that sees this exact stop re-grants.
  assert.notEqual(f.instance.resumeAutomaticCheckpoint(f.root, { ...stopped, checkpoint: { autoAdvance: { ...stopped.checkpoint.autoAdvance, reason: 'no-progress' } } }, 'human:test').receipt.autoAdvanceResumed, true)
  assert.equal(f.instance.resumeAutomaticCheckpoint(f.root, stopped, 'agent:forged').receipt.autoAdvanceResumed, false)
})

test('explicitly resuming a changed scope admits fresh verification after the old scope exhausted its budget', (t) => {
  const f = fixture(t)
  const records = [{ key: 'old-proof', status: 'passed' }]
  const autoAdvance = {
    authorized: true, authorization: { ...authorization, configHash: 'config' },
    dispatches: 1, maxDispatches: 3, status: 'stopped', reason: 'requirement-changed',
    verification: { attempts: 4, records },
  }
  const stopped = { requirement: 'REQ-A', status: 'waiting-input', checkpoint: { autoAdvance } }
  f.instance.automaticFacts = () => ({ ...facts(), configHash: 'config' })
  assert.equal(f.instance.resumeAutomaticCheckpoint(f.root, stopped, 'human:test').receipt.autoAdvanceReason, 'auto-budget-exhausted')
  f.instance.automaticFacts = () => ({ ...facts(), requirementHash: 'newhash', scopeHash: 'newscope', configHash: 'config' })
  const resumed = f.instance.resumeAutomaticCheckpoint(f.root, stopped, 'human:test')
  assert.equal(resumed.receipt.autoAdvanceResumed, true)
  assert.equal(resumed.checkpoint.autoAdvance.dispatches, 1)
  assert.deepEqual(resumed.checkpoint.autoAdvance.verification, { attempts: 0, records })
  assert.equal(resumed.checkpoint.autoAdvance.authorization.rebound.previousVerificationAttempts, 4)
})
