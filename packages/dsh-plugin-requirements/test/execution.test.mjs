import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import RequirementsService from '../index.js'
import * as runCore from '../../alm-core/src/requirements/run.mjs'

function service({ agents = null, presets = null, selection = { provider: 'deepseek-official', model: 'deepseek-flash' } } = {}) {
  const disposers = []
  const listeners = new Map()
  const ctx = {
    effect(callback) {
      disposers.push(callback())
    },
    webServer: { register: () => () => {} },
    tools: { register: () => () => {} },
    on(name, callback) { listeners.set(name, callback); return () => listeners.delete(name) },
    get(name) {
      if (name === 'agents') return agents
      if (name === 'agentPresets') return presets
      if (name === 'agentDefaultModel') return { currentSelection: () => selection }
      return null
    },
  }
  const instance = new RequirementsService(ctx, { sidebarPort: 0 })
  return { instance, emit: (name, ...args) => listeners.get(name)?.(...args), dispose: () => disposers.forEach((fn) => fn()) }
}

function tempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'alm-run-'))
  mkdirSync(join(root, 'requirements', 'briefs'), { recursive: true })
  writeFileSync(join(root, 'requirements', 'req-pay-001.sdoc'), '[DOCUMENT]\nTITLE: 测试\n\n[REQUIREMENT]\nUID: REQ-PAY-001\nTITLE: 测试\nOWNER: team\nPROJECT: PAY\nREVISION: 1\nBRIEF: requirements/briefs/REQ-PAY-001.md\n')
  writeFileSync(join(root, 'requirements', 'briefs', 'REQ-PAY-001.md'), '# 测试\n\n## 目标\n\n完成测试\n\n## 验收要求\n\n- AC-01 验证成功\n')
  return root
}

test('identical requirement and run IDs stay isolated across workspaces', async () => {
  const roots = [tempRoot(), tempRoot()]
  const handles = []
  const agents = { async create(options) {
    const handle = { root: options.meta.cwd, sessionId: options.sessionId, cancelled: false,
      agent: { followup: async () => {}, whenIdle: () => new Promise(() => {}), cancel() { handle.cancelled = true } }, dispose() {} }
    handles.push(handle)
    return handle
  } }
  const presets = { resolve: async name => ({ id: name }), mount: async () => {} }
  const { instance, dispose } = service({ agents, presets })
  try {
    const results = await Promise.all(roots.map(root => instance.startDeliveryRun({ root, requirementId: item.id, changeId: 'CHG-PAY-001', item })))
    assert.ok(results.every(result => result.scheduled))
    assert.equal(results[0].runId, results[1].runId)
    assert.notEqual(results[0].sessionId, results[1].sessionId)
    assert.equal(instance.activeRuns.size, 2)
    assert.equal(instance.runHeartbeats.size, 2)
    assert.equal(instance.cancelDeliveryRun({ root: roots[0], requirementId: item.id }).cancelled, true)
    assert.equal(handles.find(handle => handle.root === roots[0]).cancelled, true)
    assert.equal(handles.find(handle => handle.root === roots[1]).cancelled, false)
    assert.equal(runCore.readRun(roots[0], results[0].runId).status, 'cancelled')
    assert.equal(runCore.readRun(roots[1], results[1].runId).status, 'running')
    assert.equal(instance.runHeartbeats.size, 1)
    assert.ok(instance.activeRuns.has(instance.executionKey(roots[1], item.id)))
  } finally {
    dispose()
    for (const root of roots) rmSync(root, { recursive: true, force: true })
  }
})

test('cancel leaves the carrier alive when its durable state cannot be updated', () => {
  const root = tempRoot()
  const { instance, dispose } = service()
  try {
    const run = runCore.createRun({ root, requirementId: item.id, carrier: 'dsh-session', sessionId: 's' }).run
    let cancelled = false
    instance.activeRuns.set(instance.executionKey(root, item.id), { root, runId: run.id, agent: { cancel() { cancelled = true } } })
    instance.startRunHeartbeat({ root, runId: run.id })
    const lock = join(root, '.alm', 'runs', '.write-lock')
    mkdirSync(lock)
    const result = instance.cancelDeliveryRun({ root, requirementId: item.id })
    assert.equal(result.cancelled, false)
    assert.equal(result.reason, 'run-busy')
    assert.equal(cancelled, false)
    assert.equal(instance.activeRuns.size, 1)
    assert.equal(instance.runHeartbeats.size, 1)
    assert.equal(runCore.readRun(root, run.id).status, 'queued')
    rmSync(lock, { recursive: true })
  } finally { dispose(); rmSync(root, { recursive: true, force: true }) }
})

for (const outcome of ['resolve', 'reject']) test(`late ${outcome} from an old carrier cannot settle a resumed session`, async () => {
  const root = tempRoot()
  let finishOld
  let created = 0
  const agents = { async create() {
    created++
    return { agent: { followup: () => created === 1 ? new Promise((resolve, reject) => { finishOld = outcome === 'resolve' ? resolve : reject }) : new Promise(() => {}), whenIdle: async () => {}, cancel() {} }, dispose() {} }
  } }
  const presets = { resolve: async name => ({ id: name }), mount: async () => {} }
  const { instance, dispose } = service({ agents, presets })
  try {
    const started = await instance.startDeliveryRun({ root, requirementId: item.id, changeId: 'CHG-PAY-001', item })
    runCore.updateRun({ root, runId: started.runId, status: 'failed', failure: { code: 'host-restart' }, apply: true })
    instance.activeRuns.delete(instance.executionKey(root, item.id))
    const resumed = await instance.resumeDeliveryRun({ root, requirementId: item.id, continuing: true })
    assert.equal(resumed.resumed, true)
    const currentTimer = instance.runHeartbeats.get(instance.executionKey(root, started.runId))
    finishOld(outcome === 'reject' ? new Error('old carrier failed') : undefined)
    await new Promise(resolve => setTimeout(resolve, 30))
    const stored = runCore.readRun(root, started.runId)
    assert.equal(stored.status, 'running')
    assert.equal(stored.sessionId, resumed.sessionId)
    assert.equal(instance.runHeartbeats.get(instance.executionKey(root, started.runId)), currentTimer)
  } finally { dispose(); rmSync(root, { recursive: true, force: true }) }
})

const item = {
  id: 'REQ-PAY-001',
  title: '列表按创建时间倒序',
  file: 'requirements/req-pay-001.sdoc',
  brief: 'requirements/briefs/REQ-PAY-001.md',
  revision: 1,
  acceptance: { commands: [{ id: 'cmd-1', command: ['node', '--test'] }] },
}

test('a synchronous host followup failure settles the delivery run as failed', async () => {
  const root = tempRoot()
  const agents = { async create() { return { agent: { followup() { throw Object.assign(new Error('host rejected'), { code: 'HOST_REJECTED' }) } }, dispose() {} } } }
  const presets = { resolve: async name => ({ id: name }), mount: async () => {} }
  const { instance, dispose } = service({ agents, presets })
  try {
    const result = await instance.startDeliveryRun({ root, requirementId: item.id, item })
    assert.equal(result.scheduled, true)
    await new Promise(resolve => setImmediate(resolve))
    const run = runCore.readRun(root, result.runId)
    assert.equal(run.status, 'failed')
    assert.equal(run.failure.code, 'HOST_REJECTED')
    assert.equal(instance.runHeartbeats.size, 0)
  } finally { dispose(); rmSync(root, { recursive: true, force: true }) }
})

test('start without a host carrier reports the truth instead of pretending to run', async () => {
  const root = tempRoot()
  const { instance, dispose } = service()
  try {
    const execution = await instance.startDeliveryRun({ root, requirementId: item.id, changeId: 'CHG-PAY-001', item })
    assert.equal(execution.scheduled, false)
    assert.equal(execution.reason, 'carrier-unavailable')
    assert.equal(existsSync(join(root, '.alm/runs')), false)
  } finally {
    dispose()
    rmSync(root, { recursive: true, force: true })
  }
})

test('start creates one host session, records the run and never duplicates it', async () => {
  const root = tempRoot()
  const created = []
  const followed = []
  let mounts = 0
  const agents = {
    async create(options) {
      created.push(options)
      await options.setup?.({})
      return {
        agent: {
          followup: (message) => {
            followed.push(message)
            return Promise.resolve()
          },
          whenIdle: () => Promise.resolve(),
          cancel: () => {},
        },
        dispose: () => {},
      }
    },
  }
  const presets = {
    resolve: async (name) => ({ id: name }),
    mount: async () => {
      mounts += 1
    },
  }
  const { instance, dispose } = service({ agents, presets })
  try {
    const execution = await instance.startDeliveryRun({ root, requirementId: item.id, changeId: 'CHG-PAY-001', item })
    assert.equal(execution.scheduled, true)
    assert.equal(execution.carrier, 'dsh-session')
    assert.match(execution.runId, /^RUN-/)
    assert.equal(created.length, 1)
    assert.deepEqual(created[0].agentOptions, { provider: 'deepseek-official', model: 'deepseek-flash' })
    assert.equal(created[0].meta.cwd, root)
    assert.equal(created[0].meta.agentPreset, 'standard')
    assert.equal(mounts, 1)

    // The message must be a full user Message: a bare {content, source} makes the
    // transport drop the role and fail with an opaque TRANSPORT error.
    assert.equal(followed.length, 1)
    assert.match(followed[0].id, /^[0-9a-f-]{36}$/i)
    assert.equal(followed[0].role, 'user')
    assert.equal(followed[0].source.kind, 'user')
    const text = followed[0].content[0].text
    assert.match(text, /REQ-PAY-001/)
    assert.match(text, /node --test/)
    assert.match(text, /decision\.md/)
    assert.ok(text.includes(`本次运行：${execution.runId}`))
    assert.ok(text.includes(`.alm/runs/${execution.runId}-decision.md`))
    assert.ok(text.includes('## 决策 N：<问题>'))
    assert.ok(text.includes('## 等待期间我还能做什么'))
    assert.ok(text.includes('不要把技术方案 A/B/C 交给产品经理'))

    const runFile = join(root, '.alm/runs', `${execution.runId}.json`)
    assert.equal(existsSync(runFile), true)
    const stored = JSON.parse(readFileSync(runFile, 'utf8'))
    assert.equal(stored.carrier, 'dsh-session')
    assert.equal(stored.sessionId, execution.sessionId)
    assert.equal(stored.change, 'CHG-PAY-001')

    // A second click resumes the same run instead of spawning another session.
    const again = await instance.startDeliveryRun({ root, requirementId: item.id, changeId: 'CHG-PAY-001', item })
    assert.equal(again.scheduled, false)
    assert.equal(again.reused, true)
    assert.equal(again.reason, 'run-active')
    assert.equal(created.length, 1)
  } finally {
    dispose()
    rmSync(root, { recursive: true, force: true })
  }
})

test('host turn error is recorded as failed even when the agent becomes idle', async () => {
  const root = tempRoot()
  let emit
  const agents = { async create(options) { return { agent: {
    followup() {
      emit('session/event', { id: options.sessionId }, { type: 'turn/start', data: { turn: 0 } })
      emit('session/event', { id: options.sessionId }, { type: 'turn/end', data: { turn: 0, reason: { kind: 'error', error: { code: 'MISSING_CREDENTIAL', message: 'sensitive provider detail' } } } })
      return Promise.resolve()
    }, whenIdle: () => Promise.resolve(), cancel() {},
  }, dispose() {} } } }
  const host = service({ agents, presets: { resolve: async name => ({ id: name }), mount: async () => {} } })
  emit = host.emit
  try {
    const execution = await host.instance.startDeliveryRun({ root, requirementId: item.id, item })
    await new Promise(resolve => setTimeout(resolve, 25))
    const run = runCore.readRun(root, execution.runId)
    assert.equal(run.status, 'failed')
    assert.equal(run.failure.code, 'MISSING_CREDENTIAL')
    assert.match(run.failure.message, /凭据/)
    assert.doesNotMatch(JSON.stringify(run), /sensitive provider detail/)
  } finally { host.dispose(); rmSync(root, { recursive: true, force: true }) }
})

test('an idle agent closes the run as waiting for the human', async () => {
  const root = tempRoot()
  const agents = {
    async create() {
      return {
        agent: { followup: () => Promise.resolve(), whenIdle: () => Promise.resolve(), cancel: () => {} },
        dispose: () => {},
      }
    },
  }
  const presets = { resolve: async (name) => ({ id: name }), mount: async () => {} }
  const { instance, dispose } = service({ agents, presets })
  try {
    const execution = await instance.startDeliveryRun({ root, requirementId: item.id, changeId: 'CHG-PAY-001', item })
    await new Promise((resolve) => setTimeout(resolve, 20))
    const stored = JSON.parse(readFileSync(join(root, '.alm/runs', `${execution.runId}.json`), 'utf8'))
    assert.equal(stored.status, 'waiting-input')
    assert.equal(stored.phase, 'review-result')
    assert.equal(runCore.runView({ root, requirementId: item.id }).awaitingAnswer, false)
  } finally {
    dispose()
    rmSync(root, { recursive: true, force: true })
  }
})

test('preparing an execution session fails soft with a reason', async () => {
  const root = tempRoot()
  const agents = {
    async create() {
      throw Object.assign(new Error('session already exists'), { code: 'session-exists' })
    },
  }
  const presets = { resolve: async (name) => ({ id: name }), mount: async () => {} }
  const { instance, dispose } = service({ agents, presets })
  try {
    const execution = await instance.startDeliveryRun({ root, requirementId: item.id, changeId: 'CHG-PAY-001', item })
    assert.equal(execution.scheduled, false)
    assert.equal(execution.reason, 'session-exists')
    assert.match(execution.message, /session already exists/)
  } finally {
    dispose()
    rmSync(root, { recursive: true, force: true })
  }
})

test('cancelling a run stops the host session and keeps the record', async () => {
  const root = tempRoot()
  let cancelled = 0
  const agents = {
    async create() {
      return {
        agent: { followup: () => Promise.resolve(), whenIdle: () => new Promise(() => {}), cancel: () => { cancelled += 1 } },
        dispose: () => {},
      }
    },
  }
  const presets = { resolve: async (name) => ({ id: name }), mount: async () => {} }
  const { instance, dispose } = service({ agents, presets })
  try {
    const execution = await instance.startDeliveryRun({ root, requirementId: item.id, changeId: 'CHG-PAY-001', item })
    assert.equal(execution.scheduled, true)
    const result = instance.cancelDeliveryRun({ root, requirementId: item.id, reason: '测试取消' })
    assert.equal(result.cancelled, true)
    assert.equal(cancelled, 1)
    const stored = JSON.parse(readFileSync(join(root, '.alm/runs', execution.runId + '.json'), 'utf8'))
    assert.equal(stored.status, 'cancelled')
    const again = instance.cancelDeliveryRun({ root, requirementId: item.id })
    assert.equal(again.cancelled, false)
    assert.equal(again.reason, 'no-active-run')
  } finally {
    dispose()
    rmSync(root, { recursive: true, force: true })
  }
})

test('a delivery session runs without approval prompts inside the workspace boundary', async () => {
  const root = tempRoot()
  const appended = []
  let agentOptions
  const agents = {
    async create(options) {
      agentOptions = options.agentOptions
      const agent = {
        session: { append: (type, payload) => appended.push([type, payload]) },
        followup: () => Promise.resolve(),
        whenIdle: () => new Promise(() => {}),
        cancel: () => {},
      }
      await options.setup?.({}, agent)
      return { agent, dispose: () => {} }
    },
  }
  const presets = { resolve: async (name) => ({ id: name }), mount: async () => {} }
  const { instance, dispose } = service({ agents, presets, selection: { provider: 'p', model: 'm', reasoningEffort: 'low' } })
  try {
    const execution = await instance.startDeliveryRun({ root, requirementId: item.id, changeId: 'CHG-PAY-001', item })
    assert.deepEqual(agentOptions, { provider: 'p', model: 'm', reasoningEffort: 'low' })
    // A headless turn would hang on an `ask` policy: the round is pinned to the
    // workspace boundary instead, so the executor never waits for a click.
    assert.deepEqual(appended, [
      ['sandbox/mode', { mode: 'workspace-write' }],
      ['approval/policy', { policy: 'never' }],
    ])
    const stored = JSON.parse(readFileSync(join(root, '.alm/runs', execution.runId + '.json'), 'utf8'))
    assert.equal(stored.status, 'running', 'a dispatched run must not keep reporting queued')
    assert.equal(stored.phase, 'implement')
  } finally {
    dispose()
    rmSync(root, { recursive: true, force: true })
  }
})

test('answering a decision request continues the same host session', async () => {
  const root = tempRoot()
  const followed = []
  const agents = {
    async create() {
      return {
        agent: {
          followup: (message) => {
            followed.push(message)
            return Promise.resolve()
          },
          whenIdle: () => Promise.resolve(),
          cancel: () => {},
        },
        dispose: () => {},
      }
    },
  }
  const presets = { resolve: async (name) => ({ id: name }), mount: async () => {} }
  const { instance, dispose } = service({ agents, presets })
  try {
    const execution = await instance.startDeliveryRun({ root, requirementId: item.id, changeId: 'CHG-PAY-001', item })
    await new Promise((resolve) => setTimeout(resolve, 20))
    const waiting = JSON.parse(readFileSync(join(root, '.alm/runs', execution.runId + '.json'), 'utf8'))
    assert.equal(waiting.status, 'waiting-input')

    const result = await instance.resumeDeliveryRun({ root, requirementId: item.id, answer: '选 A：接受范围内门禁证据' })
    assert.equal(result.continueMode, 'same-session')
    assert.equal(result.runId, execution.runId)
    assert.equal(followed.length, 2)
    assert.match(followed[1].id, /^[0-9a-f-]{36}$/i)
    assert.notEqual(followed[1].id, followed[0].id)
    assert.equal(followed[1].role, 'user')
    assert.match(followed[1].content[0].text, /选 A：接受范围内门禁证据/)
    assert.ok(followed[1].content[0].text.includes(`.alm/runs/${execution.runId}-decision.md`))
    assert.ok(followed[1].content[0].text.includes('## 决策 N：<问题>'))
    assert.ok(followed[1].content[0].text.includes('产品经理只决定'))

    const stored = JSON.parse(readFileSync(join(root, '.alm/runs', execution.runId + '.json'), 'utf8'))
    assert.equal(stored.answers.length, 1)
    assert.equal(stored.answers[0].text, '选 A：接受范围内门禁证据')
    assert.equal(stored.sessionId, execution.sessionId)
  } finally {
    dispose()
    rmSync(root, { recursive: true, force: true })
  }
})

for (const restart of [false, true]) test(`synchronous followup failure after ${restart ? 'host restart' : 'same-session resume'} is recorded`, async () => {
  const root = tempRoot()
  let calls = 0
  const agents = { async create() { return { agent: { followup() { if (++calls > 1) throw Object.assign(new Error('resume rejected'), { code: 'RESUME_REJECTED' }) }, whenIdle: async () => {}, cancel() {} }, dispose() {} } } }
  const presets = { resolve: async name => ({ id: name }), mount: async () => {} }
  const first = service({ agents, presets })
  let second
  try {
    const started = await first.instance.startDeliveryRun({ root, requirementId: item.id, item })
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(runCore.readRun(root, started.runId).status, 'waiting-input')
    if (restart) { first.dispose(); second = service({ agents, presets }) }
    const instance = second?.instance ?? first.instance
    const result = await instance.resumeDeliveryRun({ root, requirementId: item.id, continuing: true })
    assert.equal(result.resumed, true)
    await new Promise(resolve => setImmediate(resolve))
    const run = runCore.readRun(root, started.runId)
    assert.equal(run.status, 'failed')
    assert.equal(run.failure.code, 'RESUME_REJECTED')
    assert.equal(instance.runHeartbeats.size, 0)
  } finally { if (second) second.dispose(); else first.dispose(); rmSync(root, { recursive: true, force: true }) }
})

test('a host restart resumes the run in a fresh session and keeps the answer', async () => {
  const root = tempRoot()
  const first = { followed: [] }
  const firstAgents = {
    async create() {
      return {
        agent: {
          followup: (message) => {
            first.followed.push(message)
            return Promise.resolve()
          },
          whenIdle: () => Promise.resolve(),
          cancel: () => {},
        },
        dispose: () => {},
      }
    },
  }
  const presets = { resolve: async (name) => ({ id: name }), mount: async () => {} }
  const one = service({ agents: firstAgents, presets })
  let execution = null
  try {
    execution = await one.instance.startDeliveryRun({ root, requirementId: item.id, changeId: 'CHG-PAY-001', item })
    await new Promise((resolve) => setTimeout(resolve, 20))
    const before = JSON.parse(readFileSync(join(root, '.alm/runs', execution.runId + '.json'), 'utf8'))
    assert.equal(before.status, 'waiting-input')

    // Simulate a host restart: the old service (and its in-memory sessions) is gone.
    one.dispose()
    const created = []
    const secondAgents = {
      async create(options) {
        created.push(options)
        return {
          agent: { followup: () => Promise.resolve(), whenIdle: () => Promise.resolve(), cancel: () => {} },
          dispose: () => {},
        }
      },
    }
    const two = service({ agents: secondAgents, presets, selection: { provider: 'p2', model: 'm2', reasoningEffort: 'high' } })
    try {
      const result = await two.instance.resumeDeliveryRun({ root, requirementId: item.id, answer: '选 C：改 checkReport 口径' })
      assert.equal(result.continueMode, 'resumed-session')
      assert.equal(created.length, 1)
      assert.deepEqual(created[0].agentOptions, { provider: 'p2', model: 'm2', reasoningEffort: 'high' })
      const stored = JSON.parse(readFileSync(join(root, '.alm/runs', execution.runId + '.json'), 'utf8'))
      assert.notEqual(stored.sessionId, before.sessionId)
      assert.equal(stored.sessionId, created[0].sessionId)
      assert.equal(stored.answers.length, 1)
      assert.equal(stored.answers[0].text, '选 C：改 checkReport 口径')
    } finally {
      two.dispose()
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a delivery run keeps a heartbeat while the agent works and stops it when the turn ends', async () => {
  const root = tempRoot()
  let resolveIdle = null
  const agents = {
    async create(options) {
      await options.setup?.({})
      return {
        agent: {
          followup: () => Promise.resolve(),
          whenIdle: () => new Promise((resolve) => { resolveIdle = resolve }),
          cancel: () => {},
        },
        dispose: () => {},
      }
    },
  }
  const presets = { resolve: async (name) => ({ id: name }), mount: async () => {} }
  const { instance, dispose } = service({ agents, presets })
  const startHeartbeat = instance.startRunHeartbeat.bind(instance)
  instance.startRunHeartbeat = options => startHeartbeat({ ...options, intervalMs: 10 })
  try {
    const execution = await instance.startDeliveryRun({ root, requirementId: item.id, changeId: 'CHG-PAY-001', item })
    assert.equal(execution.scheduled, true)
    assert.equal(instance.runHeartbeats.size, 1, 'a live run owns a heartbeat timer')
    const file = join(root, '.alm/runs', execution.runId + '.json')
    const first = JSON.parse(readFileSync(file, 'utf8'))
    await new Promise((resolve) => setTimeout(resolve, 60))
    const beat = JSON.parse(readFileSync(file, 'utf8'))
    assert.ok(beat.heartbeatAt > first.heartbeatAt, 'the heartbeat advances while the turn runs')
    assert.equal(beat.status, 'running')
    resolveIdle()
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.equal(instance.runHeartbeats.size, 0, 'settling the turn stops the heartbeat')
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).status, 'waiting-input')
  } finally {
    dispose()
    rmSync(root, { recursive: true, force: true })
  }
})

test('a restart starts a new run from the previous checkpoint instead of faking the old one', async () => {
  const root = tempRoot()
  const presets = { resolve: async (name) => ({ id: name }), mount: async () => {} }
  const makeAgents = (calls) => ({
    async create(options) {
      await options.setup?.({})
      return {
        agent: {
          followup: (message) => { calls.push(message); return Promise.resolve() },
          whenIdle: () => Promise.resolve(),
          cancel: () => {},
        },
        dispose: () => {},
      }
    },
  })
  const one = service({ agents: makeAgents([]), presets })
  let previousRunId = null
  try {
    const execution = await one.instance.startDeliveryRun({ root, requirementId: item.id, changeId: 'CHG-PAY-001', item })
    previousRunId = execution.runId
    await new Promise((resolve) => setTimeout(resolve, 20))
    runCore.updateRun({ root, runId: previousRunId, status: 'failed', failure: { code: 'agent-crashed', message: '会话在宿主重启时中断' }, apply: true })
  } finally {
    one.dispose()
  }
  const calls = []
  const two = service({ agents: makeAgents(calls), presets })
  try {
    const restarted = await two.instance.restartDeliveryRun({ root, requirementId: item.id })
    assert.equal(restarted.restarted, true)
    assert.equal(restarted.previousRunId, previousRunId)
    assert.notEqual(restarted.runId, previousRunId)
    const text = calls[0].content[0].text
    assert.match(text, /从中断处继续/)
    assert.match(text, /会话在宿主重启时中断/)
    assert.ok(text.includes(`.alm/runs/${restarted.runId}-decision.md`))
    assert.ok(text.includes('## 决策 N：<问题>'))
    assert.ok(text.includes('产品经理只决定'))
  } finally {
    two.dispose()
    rmSync(root, { recursive: true, force: true })
  }
})
