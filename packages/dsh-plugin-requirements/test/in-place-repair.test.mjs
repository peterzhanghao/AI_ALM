import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import RequirementsService from '../index.js'
import * as runs from '../../alm-core/src/requirements/run.mjs'

const requirementId = 'REQ-PAY-001'
function fixture(t, { status = 'waiting-input', followup = () => Promise.resolve() } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'alm-in-place-repair-'))
  const instance = Object.create(RequirementsService.prototype)
  Object.assign(instance, { root, activeRuns: new Map(), runHeartbeats: new Map(), pendingRepairs: new Map(), repairJobs: new Map(), disposed: false })
  const run = runs.createRun({ root, requirementId, carrier: 'test-only', sessionId: 'mock-session' }).run
  runs.updateRun({ root, runId: run.id, status, apply: true })
  const messages = []
  instance.activeRuns.set(instance.executionKey(root, requirementId), { root, runId: run.id, agent: { followup(message) { messages.push(message); return followup(message) }, whenIdle: () => Promise.resolve() } })
  t.after(() => {
    instance.disposed = true
    for (const timer of instance.runHeartbeats.values()) clearInterval(timer)
    rmSync(root, { recursive: true, force: true })
  })
  return { instance, root, runId: run.id, messages }
}
function fail(f, code = 'assertion-failed', extra = {}) {
  return f.instance.monitorFailure({ root: f.root, requirement: requirementId, run: f.runId, stage: 'develop', step: code, error: Object.assign(new Error(code), { code }), ...extra })
}
async function settled(f) { await Promise.all([...f.instance.repairJobs.values()]) }
function noNewRequirement(f) {
  assert.equal(existsSync(join(f.root, '.alm/defects')), false)
  assert.equal(existsSync(join(f.root, 'requirements')), false)
}
function acceptance() { return { result: 'fail', evidencePath: '.alm/evidence/acceptance.json', evidence: { commands: [{ id: 'unit', command: ['node', '--test'], exitCode: 1, stderr: 'assertion failed' }] } } }

test('automatic acceptance failure reuses original run and session, preserving evidence and human gates', async (t) => {
  const f = fixture(t)
  const result = f.instance.monitorAcceptanceResult(f.root, requirementId, acceptance())
  assert.equal(result.repair.scheduled, true)
  assert.equal(result.repair.requirementId, requirementId)
  await settled(f)
  assert.equal(f.messages.length, 1)
  assert.match(f.messages[0].content[0].text, /不得创建新需求/)
  assert.match(f.messages[0].content[0].text, /不自动验收签字、授权或发布/)
  const stored = runs.readRun(f.root, f.runId)
  assert.equal(stored.requirement, requirementId)
  assert.equal(stored.status, 'waiting-input')
  assert.equal(stored.answers.length, 0, 'automation must never invent a human answer')
  assert.equal(stored.checkpoint.inPlaceRepair.attempts, 1)
  assert.equal(runs.listRuns(f.root).length, 1)
  const failure = JSON.parse(readFileSync(join(f.root, '.alm/failures', `${result.failure.id}.json`), 'utf8'))
  assert.equal(failure.evidence.snapshot.failedCommands[0].exitCode, 1)
  assert.equal(failure.defect, null)
  noNewRequirement(f)
})

test('duplicate delivery and durable per-run budget prevent repeated or unbounded repairs', async (t) => {
  const f = fixture(t)
  const first = fail(f)
  const duplicate = fail(f)
  assert.equal(duplicate.deduped, true)
  await settled(f)
  assert.equal(f.messages.length, 1)
  assert.equal(fail(f, 'different-failure').repair.scheduled, true)
  await settled(f)
  assert.equal(f.messages.length, 2)
  assert.equal(fail(f, 'third-failure').repair.reason, 'repair-limit')
  assert.equal(runs.readRun(f.root, f.runId).checkpoint.inPlaceRepair.attempts, 2)
  assert.equal(first.failure.defect, null)
  noNewRequirement(f)
})

test('failure during original live turn waits until idle and does not overlap followups', async (t) => {
  const f = fixture(t, { status: 'running' })
  const out = fail(f)
  assert.equal(out.repair.queued, true)
  assert.equal(f.messages.length, 0)
  runs.updateRun({ root: f.root, runId: f.runId, status: 'waiting-input', apply: true })
  await f.instance.drainInPlaceRepair({ root: f.root, runId: f.runId })
  assert.equal(f.messages.length, 1)
  noNewRequirement(f)
})

test('repair rejection records evidence without recursively scheduling a repair', async (t) => {
  const f = fixture(t, { status: 'failed', followup: () => { throw new Error('repair failed synchronously') } })
  assert.equal(fail(f).repair.scheduled, true)
  await settled(f)
  assert.equal(f.messages.length, 1)
  const stored = runs.readRun(f.root, f.runId)
  assert.equal(stored.status, 'failed')
  assert.equal(stored.checkpoint.inPlaceRepair.status, 'failed')
  assert.equal(readdirSync(join(f.root, '.alm/failures')).length, 2)
  noNewRequirement(f)
})

for (const gate of ['decision-checkpoint', 'decision-file', 'paused', 'cancelled', 'done', 'no-carrier', 'other-root', 'other-run']) {
  test(`automatic repair does not bypass ${gate}`, async (t) => {
    const f = fixture(t)
    if (gate === 'decision-checkpoint') runs.updateRun({ root: f.root, runId: f.runId, checkpoint: { decision: 'decision.md' }, apply: true })
    if (gate === 'decision-file') {
      const path = `.alm/runs/${f.runId}-decision.md`
      writeFileSync(join(f.root, path), 'Human decision required')
      runs.updateRun({ root: f.root, runId: f.runId, checkpoint: { decision: path }, apply: true })
    }
    if (['paused', 'cancelled', 'done'].includes(gate)) runs.updateRun({ root: f.root, runId: f.runId, status: gate, apply: true })
    if (gate === 'no-carrier') f.instance.activeRuns.clear()
    if (gate === 'other-root') f.instance.activeRuns.get(f.instance.executionKey(f.root, requirementId)).root = resolve(f.root, 'other')
    const out = fail(f, 'failure', gate === 'other-run' ? { run: 'RUN-OTHER' } : {})
    assert.equal(out.repair.scheduled, false)
    await settled(f)
    assert.equal(f.messages.length, 0)
    noNewRequirement(f)
  })
}

for (const kind of ['external', 'user-cancelled', 'business-outcome', 'plugin-defect', 'unknown']) {
  test(`${kind} stays an event without new requirement or automatic execution`, async (t) => {
    const f = fixture(t)
    const out = fail(f, 'failure', { kind })
    assert.equal(out.eventOnly, true)
    await settled(f)
    assert.equal(f.messages.length, 0)
    noNewRequirement(f)
  })
}

test('decision arriving while repair queued is rechecked before dispatch', async (t) => {
  const f = fixture(t, { status: 'running' })
  fail(f)
  runs.updateRun({ root: f.root, runId: f.runId, status: 'waiting-input', checkpoint: { decision: 'must-ask.md' }, apply: true })
  assert.equal(f.instance.drainInPlaceRepair({ root: f.root, runId: f.runId }), null)
  assert.equal(f.messages.length, 0)
})

test('cancellation before dispatch preserves terminal state and never calls carrier', async (t) => {
  const f = fixture(t)
  assert.equal(fail(f).repair.scheduled, true)
  runs.updateRun({ root: f.root, runId: f.runId, status: 'cancelled', apply: true })
  await settled(f)
  assert.equal(f.messages.length, 0)
  assert.equal(runs.readRun(f.root, f.runId).status, 'cancelled')
})

test('decision arriving immediately before dispatch is never treated as an answer', async (t) => {
  const f = fixture(t)
  fail(f)
  runs.updateRun({ root: f.root, runId: f.runId, checkpoint: { decision: 'must-ask.md' }, apply: true })
  await settled(f)
  assert.equal(f.messages.length, 0)
  const stored = runs.readRun(f.root, f.runId)
  assert.equal(stored.status, 'waiting-input')
  assert.equal(stored.answers.length, 0)
  assert.equal(stored.checkpoint.decision, 'must-ask.md')
})

test('interrupted durable repair does not automatically retry after reconstructing controller state', async (t) => {
  const f = fixture(t)
  runs.updateRun({ root: f.root, runId: f.runId, checkpoint: { inPlaceRepair: { attempts: 1, failureIds: ['FAIL-OLD'], status: 'running' } }, apply: true })
  assert.equal(fail(f).repair.reason, 'repair-in-progress')
  assert.equal(f.messages.length, 0)
})

test('initial delivery followup rejection reaches monitoring and bounded repair on the same carrier', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'alm-initial-reject-repair-'))
  const messages = []
  const disposers = []
  let created = 0
  const agents = { async create() {
    created += 1
    return { agent: {
      followup(message) {
        messages.push(message)
        if (messages.length === 1) return Promise.reject(Object.assign(new Error('assertion failed in implementation'), { code: 'assertion-failed' }))
        return Promise.resolve()
      }, whenIdle: () => Promise.resolve(), cancel() {},
    }, dispose() {} }
  } }
  const presets = { resolve: async () => ({ id: 'standard' }), mount: async () => {} }
  const instance = new RequirementsService({
    effect(callback) { disposers.push(callback()) },
    webServer: { register: () => () => {} }, tools: { register: () => () => {} },
    get(name) { return name === 'agents' ? agents : name === 'agentPresets' ? presets : null },
  }, { sidebarPort: 0 })
  t.after(() => { for (const dispose of disposers) dispose(); rmSync(root, { recursive: true, force: true }) })
  const receipt = await instance.startDeliveryRun({ root, requirementId, changeId: 'CHG-TEST-001', item: { id: requirementId, title: 'isolated repair test' } })
  // Flush the actual start followup rejection → catch → monitor → repair chain.
  await new Promise((resolve) => setImmediate(resolve))
  await Promise.all([...instance.repairJobs.values()])
  assert.equal(receipt.scheduled, true)
  assert.equal(created, 1)
  assert.equal(messages.length, 2, 'one rejected initial turn and exactly one repair turn')
  const stored = runs.readRun(root, receipt.runId)
  assert.equal(stored.status, 'waiting-input')
  assert.equal(stored.checkpoint.inPlaceRepair.attempts, 1)
  assert.equal(stored.checkpoint.inPlaceRepair.status, 'done')
  assert.equal(stored.answers.length, 0)
  assert.equal(runs.listRuns(root).length, 1)
  const files = readdirSync(join(root, '.alm/failures'))
  assert.equal(files.length, 1)
  const failure = JSON.parse(readFileSync(join(root, '.alm/failures', files[0]), 'utf8'))
  assert.equal(failure.kind, 'product-defect')
  assert.equal(failure.step, 'agent-turn')
  assert.equal(failure.run, receipt.runId)
  noNewRequirement({ root })
})

test('record-only and monitoring-disabled paths never execute or create requirements', async (t) => {
  const f = fixture(t)
  assert.equal(fail(f, 'record', { auto: false }).repair, undefined)
  mkdirSync(join(f.root, '.alm'), { recursive: true })
  f.instance.monitoringFor = () => ({ enabled: false, stages: ['develop'] })
  assert.equal(fail(f, 'disabled').reason, 'monitoring-disabled')
  assert.equal(f.messages.length, 0)
  noNewRequirement(f)
})
