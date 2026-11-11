import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import RequirementsService from '../index.js'
import * as runs from '../../alm-core/src/requirements/run.mjs'

function fixture(t, status = 'running') {
  const root = mkdtempSync(join(tmpdir(), 'alm-busy-'))
  const instance = Object.create(RequirementsService.prototype)
  Object.assign(instance, { root, activeRuns: new Map(), runHeartbeats: new Map(), startingRuns: new Map(), rootFor: () => root, monitorWriteFailure: () => ({}) })
  const run = runs.createRun({ root, requirementId: 'REQ-1', carrier: 'mock' }).run
  runs.updateRun({ root, runId: run.id, status, apply: true })
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return { root, instance, run }
}
async function post(instance, action, body, rehearsal = false) {
  const listeners = {}
  const req = { method: 'POST', url: '/', on(name, fn) { listeners[name] = fn } }
  const res = { writeHead(status) { this.status = status }, end(text) { this.payload = JSON.parse(text) } }
  const promise = rehearsal ? instance.handleRehearsal(req, res) : action === 'defect' ? instance.handleDefect(req, res) : instance.handleWrite(req, res, action)
  listeners.data(Buffer.from(JSON.stringify(body)))
  listeners.end()
  await promise
  return res
}

for (const action of ['start', 'acceptance', 'acceptance-config', 'candidate', 'signoff', 'review', 'archive', 'remove', 'release']) {
  test(`busy execution rejects conflicting ${action} before any business write`, async (t) => {
    const f = fixture(t)
    const res = await post(f.instance, action, { requirementId: 'REQ-1', apply: true, mode: 'authorize' })
    assert.equal(res.status, 409)
    assert.equal(res.payload.error.code, 'run-busy')
    assert.match(res.payload.error.message, /正在执行/)
  })
}
for (const mode of ['prepare-pr', 'merge-pr']) test(`busy execution blocks ${mode} before GitHub calls`, async t => {
  const f = fixture(t)
  const res = await post(f.instance, 'release', { requirementId: 'REQ-1', apply: true, mode })
  assert.equal(res.status, 409)
  assert.equal(res.payload.error.code, 'run-busy')
})

for (const link of ['own', 'impact']) {
  test(`defect confirm rejects busy ${link} requirement before authorization write`, async (t) => {
    const f = fixture(t)
    f.instance.monitorRootFor = () => f.root
    f.instance.findDefectById = () => ({ requirement: link === 'own' ? 'REQ-1' : 'DEF-1', impact: { requirement: 'REQ-1' } })
    const res = await post(f.instance, 'defect', { mode: 'confirm', defectId: 'D-1', apply: true })
    assert.equal(res.status, 409)
    assert.equal(res.payload.error.code, 'run-busy')
  })
}
test('defect confirm preview does not acquire busy mutation gate', async (t) => {
  const f = fixture(t)
  f.instance.monitorRootFor = () => f.root
  f.instance.findDefectById = () => ({ requirement: 'REQ-1' })
  // A missing defect reaches the domain lookup (not the busy gate) in preview.
  const res = await post(f.instance, 'defect', { mode: 'confirm', defectId: 'D-missing', apply: false })
  assert.notEqual(res.payload.error?.code, 'run-busy')
})
test('rehearsal apply is rejected before loading or mutating requirement', async (t) => {
  const f = fixture(t)
  f.instance.rehearsalContext = () => { throw new Error('must not reach business layer') }
  const res = await post(f.instance, '', { requirementId: 'REQ-1', apply: true }, true)
  assert.equal(res.status, 409)
  assert.equal(res.payload.error.code, 'run-busy')
})
for (const status of ['waiting-input', 'paused', 'failed', 'done', 'cancelled']) {
  test(`${status} is not busy merely because a run exists`, (t) => {
    const f = fixture(t, status)
    assert.equal(f.instance.busyDelivery(f.root, ['REQ-1']), null)
    assert.doesNotThrow(() => f.instance.assertDeliveryIdle(f.root, ['REQ-1']))
  })
}
test('busy run answer and cancel remain routed to their authorized handlers', async (t) => {
  const f = fixture(t)
  for (const mode of ['answer', 'cancel']) {
    let calls = 0
    f.instance.resumeDeliveryRun = async () => { calls++; return { resumed: true } }
    f.instance.cancelDeliveryRun = () => { calls++; return { cancelled: true } }
    const res = await post(f.instance, 'run', { requirementId: 'REQ-1', mode, answer: 'human answer' })
    assert.equal(res.status, 200)
    assert.equal(calls, 1)
  }
})
test('concurrent start shares a root-normalized lock and finally releases it on failure', async (t) => {
  const f = fixture(t)
  let release
  let calls = 0
  f.instance.startDeliveryRunUnlocked = async () => { calls++; await new Promise((r) => { release = r }); throw new Error('mock failure') }
  const first = f.instance.startDeliveryRun({ root: join(f.root, '.'), requirementId: 'REQ-2' })
  const second = await f.instance.startDeliveryRun({ root: f.root, requirementId: 'REQ-2' })
  assert.equal(second.reason, 'run-starting')
  assert.equal(calls, 1)
  assert.equal(f.instance.busyDelivery(f.root, ['REQ-2']).status, 'starting')
  release()
  await assert.rejects(first, /mock failure/)
  assert.equal(f.instance.startingRuns.size, 0)
})
test('startup lock blocks a second HTTP start before planning a second change', async (t) => {
  const f = fixture(t)
  f.instance.startingRuns.set('key', { root: f.instance.deliveryRootKey(f.root), requirementId: 'REQ-2' })
  const res = await post(f.instance, 'start', { requirementId: 'REQ-2', apply: true })
  assert.equal(res.status, 409)
  assert.equal(res.payload.error.code, 'run-busy')
  assert.equal(runs.listRuns(f.root).length, 1)
})
test('two actual concurrent starts create one carrier and one run only', async (t) => {
  const f = fixture(t)
  let release
  let created = 0
  const ready = new Promise((r) => { release = r })
  f.instance.reconcileRuns = () => {}
  f.instance.startRunHeartbeat = () => {}
  f.instance.stopRunHeartbeat = () => {}
  f.instance.closeDefectIteration = () => {}
  f.instance.pendingRepairs = new Map()
  f.instance.repairJobs = new Map()
  f.instance.executionCarrier = () => ({ create: async () => { created++; return { agent: { followup: async () => {}, whenIdle: async () => {} } } } })
  f.instance.ctx = { get: (name) => name === 'agentPresets' ? { resolve: async () => { await ready; return { id: 'mock' } }, mount: async () => {} } : null }
  const first = f.instance.startDeliveryRun({ root: f.root, requirementId: 'REQ-2', item: {} })
  const second = await f.instance.startDeliveryRun({ root: f.root, requirementId: 'REQ-2', item: {} })
  assert.equal(second.reason, 'run-starting')
  release()
  const result = await first
  assert.equal(result.scheduled, true)
  assert.equal(created, 1)
  assert.equal(runs.listRuns(f.root).filter((run) => run.requirement === 'REQ-2').length, 1)
  await new Promise((resolve) => setImmediate(resolve))
})

test('stale disk run is reconciled rather than permanently blocking writes', (t) => {
  const f = fixture(t)
  const file = join(f.root, '.alm/runs', `${f.run.id}.json`)
  const run = JSON.parse(readFileSync(file, 'utf8'))
  const old = '2000-01-01T00:00:00.000Z'
  writeFileSync(file, JSON.stringify({ ...run, heartbeatAt: old, updatedAt: old, createdAt: old }))
  assert.equal(f.instance.busyDelivery(f.root, ['REQ-1']), null)
  assert.equal(runs.readRun(f.root, f.run.id).status, 'failed')
})

test('Windows startup busy lookup folds root casing and separators', { skip: process.platform !== 'win32' }, async (t) => {
  const f = fixture(t)
  let release
  f.instance.startDeliveryRunUnlocked = async () => { await new Promise((r) => { release = r }); return {} }
  const first = f.instance.startDeliveryRun({ root: f.root.toUpperCase().replaceAll('\\\\', '/'), requirementId: 'REQ-2' })
  assert.equal(f.instance.busyDelivery(f.root, ['REQ-2']).status, 'starting')
  assert.equal((await f.instance.startDeliveryRun({ root: f.root, requirementId: 'REQ-2' })).reason, 'run-starting')
  release()
  await first
})

test('busy guard does not leak across requirements or roots', (t) => {
  const f = fixture(t)
  assert.equal(f.instance.busyDelivery(f.root, ['REQ-OTHER']), null)
  assert.equal(f.instance.busyDelivery(join(f.root, 'other'), ['REQ-1']), null)
})
