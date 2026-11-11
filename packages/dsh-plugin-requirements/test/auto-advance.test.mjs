import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import RequirementsService from '../index.js'
import * as runs from '../../alm-core/src/requirements/run.mjs'
import { nextAutomaticAction, progressFingerprint } from '../auto-advance.mjs'

const authorization = { actor: 'human:test', source: 'start-v4', requirementHash: 'reqhash', revision: 1 }
const facts = (fingerprint = 'first') => ({ requirementHash: 'reqhash', revision: 1, snapshot: { complete: true, headSha: 'head' }, fingerprint, candidateEligible: false })
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
  assert.equal(f.instance.resumeAutomaticCheckpoint(f.root,run,'human:test').receipt.autoAdvanceResumed,false)
})
for (const status of ['paused', 'cancelled', 'done', 'failed']) test(`${status} is never revived`, () => {
  assert.equal(policy({}, { run: { status, checkpoint: { autoAdvance: { authorized: true, authorization } } } }).reason, 'run-not-active')
})
for (const [input, reason] of [[{ pendingDecision: true }, 'human-decision-required'], [{ carrier: false }, 'no-authorized-carrier'], [{ facts: null }, 'facts-unavailable'], [{ facts: { ...facts(), requirementHash: 'changed' } }, 'requirement-changed']]) test(reason, () => assert.equal(policy({}, input).reason, reason))

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
