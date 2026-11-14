import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import RequirementsService from '../index.js'

const PROJECT = {
  schema: 'alm.project/v1',
  id: 'PAY',
  name: '支付平台',
  defaultBranch: 'main',
  requirementRoot: 'requirements',
  github: { owner: 'peterzhanghao', repo: 'AI_ALM', project: { number: 1, status: { ready: 'Ready' } } },
  teams: ['支付团队'],
}

const ITEM = { id: 'REQ-PAY-001', title: '列表按创建时间倒序', revision: 1 }

function service(root, { agents = null, presets = null, llm = null, selection = { provider: 'deepseek-official', model: 'deepseek-flash' } } = {}) {
  const disposers = []
  const ctx = {
    effect(callback) {
      disposers.push(callback())
    },
    webServer: { register: () => () => {} },
    tools: { register: () => () => {} },
    get(name) {
      if (name === 'agents') return agents
      if (name === 'agentPresets') return presets
      if (name === 'agentDefaultModel') return { currentSelection: () => selection }
      if (name === 'llm') return llm
      return null
    },
  }
  const instance = new RequirementsService(ctx, { root, sidebarPort: 0 })
  return { instance, dispose: () => disposers.forEach((fn) => fn()) }
}

function tempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'alm-defect-api-'))
  mkdirSync(join(root, '.alm'), { recursive: true })
  mkdirSync(join(root, 'requirements'), { recursive: true })
  writeFileSync(join(root, '.alm/project.json'), JSON.stringify(PROJECT))
  return root
}

function listDir(path) {
  return existsSync(path) ? readdirSync(path) : []
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function sdocFiles(root) {
  return listDir(join(root, 'requirements')).filter((name) => name.endsWith('.sdoc'))
}

/** Minimal HTTP request/response pair for the mode-dispatched endpoints. */
function fakeRequest({ method = 'POST', url, body = {} } = {}) {
  const text = JSON.stringify(body ?? {})
  const req = {
    method,
    url,
    headers: { 'content-type': 'application/json' },
    on(event, handler) {
      this.handlers ??= {}
      ;(this.handlers[event] ??= []).push(handler)
    },
  }
  setImmediate(() => {
    for (const handler of req.handlers?.data ?? []) handler(Buffer.from(text, 'utf8'))
    for (const handler of req.handlers?.end ?? []) handler()
  })
  return req
}

function fakeResponse() {
  return {
    status: 0,
    payload: null,
    writeHead(status) {
      this.status = status
      return this
    },
    end(chunk) {
      this.payload = chunk === undefined ? null : JSON.parse(String(chunk))
    },
  }
}

async function postEndpoint(instance, endpoint, body) {
  const res = fakeResponse()
  const req = fakeRequest({ url: `/api/alm/requirements/${endpoint}`, body })
  if (endpoint === 'failure') await instance.handleFailure(req, res)
  else await instance.handleDefect(req, res)
  return res
}

async function postWrite(instance, action, body) {
  const res = fakeResponse()
  const req = fakeRequest({ url: `/api/alm/requirements/${action}`, body })
  await instance.handleWrite(req, res, action)
  return res
}

function fakeLlm(text) {
  return {
    stream: async function* () {
      yield { type: 'text-delta', text }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
}

const ANALYSIS = {
  what: 'AI 执行会话启动失败',
  expected: '会话启动后继续推进需求',
  actual: '宿主缺少 agents 服务',
  impact: '需求无法自动推进',
  directCause: '宿主未注册 agents 服务',
  rootCause: '插件依赖注入缺失',
  evidence: ['.alm/failures/FAIL-PAY-001.json'],
  confidence: 'medium',
  missing: ['宿主启动日志'],
  fixes: ['补齐 agents 服务注入'],
  tests: ['node --test packages/dsh-plugin-requirements/test/defect-api.test.mjs'],
}

test('external failures are recorded as events and never become defects', async () => {
  const root = tempRoot()
  const { instance, dispose } = service(root)
  try {
    const out = instance.monitorFailure({
      root,
      requirement: 'REQ-PAY-001',
      run: 'RUN-EXT-001',
      stage: 'develop',
      step: 'agent-turn',
      error: Object.assign(new Error('connect ETIMEDOUT 127.0.0.1'), { code: 'ETIMEDOUT' }),
    })
    assert.equal(out.eventOnly, true)
    assert.equal(out.retryHint?.retryable, true)
    assert.equal(out.kind, 'external')
    const failures = listDir(join(root, '.alm/failures'))
    assert.equal(failures.length, 1)
    const failure = readJson(join(root, '.alm/failures', failures[0]))
    assert.equal(failure.kind, 'external')
    assert.equal(failure.defect, null)
    assert.ok(!existsSync(join(root, '.alm/defects')), 'external failures must not open the defect ledger')
  } finally {
    dispose()
    rmSync(root, { recursive: true, force: true })
  }
})

test('explicit defect creation files a requirement whose sdoc records SOURCE: defect', async () => {
  const root = tempRoot()
  const { instance, dispose } = service(root)
  try {
    const started = await instance.startDeliveryRun({ root, requirementId: 'REQ-PAY-001', item: ITEM })
    assert.equal(started.scheduled, false)
    assert.equal(started.reason, 'carrier-unavailable')
    assert.equal(started.defectId, undefined)
    assert.equal(started.repair?.reason, 'not-repairable')
    const created = await postEndpoint(instance, 'defect', { mode: 'create', failureId: started.failureId, apply: true })
    assert.equal(created.status, 200)
    assert.match(created.payload.defect.id, /^DEF-REQ-PAY-001-\d{3}$/)
    assert.equal(started.failureId?.startsWith('FAIL-'), true)
    const defects = listDir(join(root, '.alm/defects'))
    assert.equal(defects.length, 1)
    const defect = readJson(join(root, '.alm/defects', defects[0]))
    assert.equal(defect.status, 'awaiting-confirmation')
    assert.equal(defect.source?.firstFailure, started.failureId)
    assert.equal(defect.requirement, created.payload.requirementId)
    const failures = listDir(join(root, '.alm/failures'))
    assert.equal(readJson(join(root, '.alm/failures', failures[0])).defect, defect.id)
    const sdocs = sdocFiles(root)
    assert.equal(sdocs.length, 1)
    const text = readFileSync(join(root, 'requirements', sdocs[0]), 'utf8')
    assert.match(text, /^SOURCE: defect$/m)
    assert.ok(text.includes(defect.requirement), 'the defect must point at the generated requirement')
  } finally {
    dispose()
    rmSync(root, { recursive: true, force: true })
  }
})

test('a duplicate delivery of the same failure does not file a second defect', async () => {
  const root = tempRoot()
  const { instance, dispose } = service(root)
  try {
    const first = await instance.startDeliveryRun({ root, requirementId: 'REQ-PAY-001', item: ITEM })
    const second = await instance.startDeliveryRun({ root, requirementId: 'REQ-PAY-001', item: ITEM })
    assert.equal(second.failureId, first.failureId, 'the duplicate resolves to the recorded failure')
    assert.equal(second.defectId, undefined, 'the duplicate must not file another defect')
    assert.equal(listDir(join(root, '.alm/defects')).length, 0)
    assert.equal(sdocFiles(root).length, 0)
    assert.equal(listDir(join(root, '.alm/failures')).length, 1)
  } finally {
    dispose()
    rmSync(root, { recursive: true, force: true })
  }
})

test('confirm preview starts nothing; a real confirm starts execution and records the iteration', async () => {
  const root = tempRoot()
  const offline = service(root)
  let defect = null
  try {
    const failure = await offline.instance.startDeliveryRun({ root, requirementId: 'REQ-PAY-001', item: ITEM })
    const created = await postEndpoint(offline.instance, 'defect', { mode: 'create', failureId: failure.failureId, apply: true })
    assert.equal(created.status, 200)
    const started = { defectId: created.payload.defect.id }
    const files = listDir(join(root, '.alm/defects'))
    assert.equal(files.length, 1)
    defect = readJson(join(root, '.alm/defects', files[0]))
    assert.equal(defect.status, 'awaiting-confirmation')
    assert.equal(started.defectId, defect.id)
    assert.ok(!existsSync(join(root, '.alm/runs')), 'no run may exist before confirmation')
  } finally {
    offline.dispose()
  }

  let createCalls = 0
  const followups = []
  const agent = {
    followup(message) {
      followups.push(message)
      return Promise.resolve()
    },
    whenIdle: () => Promise.resolve(),
    cancel() {},
  }
  const agents = {
    create: async () => {
      createCalls += 1
      return { agent, dispose() {} }
    },
  }
  const presets = { resolve: async (name) => ({ id: name }), mount: async () => {} }
  const online = service(root, { agents, presets })
  try {
    const preview = await postEndpoint(online.instance, 'defect', { mode: 'confirm', defectId: defect.id, apply: false })
    assert.equal(preview.status, 200)
    assert.equal(preview.payload.applied, false)
    assert.equal(preview.payload.execution, null)
    assert.equal(createCalls, 0)
    assert.ok(!existsSync(join(root, '.alm/runs')))

    const confirmed = await postEndpoint(online.instance, 'defect', { mode: 'confirm', defectId: defect.id, apply: true })
    assert.equal(confirmed.status, 200)
    assert.equal(confirmed.payload.applied, true)
    assert.equal(confirmed.payload.execution.scheduled, true)
    assert.equal(confirmed.payload.execution.reason, undefined)
    assert.equal(createCalls, 1)
    assert.equal(followups.length, 1)
    const runs = listDir(join(root, '.alm/runs')).filter((name) => !name.endsWith('-blueprint.json'))
    assert.equal(runs.length, 1)
    assert.equal(confirmed.payload.iteration?.run, confirmed.payload.execution.runId)
    const updated = readJson(join(root, '.alm/defects', defect.id + '.json'))
    assert.ok(['fixing', 'verifying'].includes(updated.status), 'an immediately idle mock may already have settled')
    assert.ok(updated.iterations.length >= 1)
    assert.equal(updated.iterations[0].run, confirmed.payload.execution.runId)
  } finally {
    online.dispose()
    rmSync(root, { recursive: true, force: true })
  }
})

test('a monitor exception never replaces the original write error', async () => {
  const root = tempRoot()
  const { instance, dispose } = service(root)
  try {
    instance.monitorFailure = () => {
      throw new Error('monitor exploded')
    }
    const response = await postWrite(instance, 'create', {})
    assert.equal(response.status, 400)
    assert.equal(response.payload.ok, false)
    assert.equal(response.payload.error.code, 'title-required')
    assert.equal(response.payload.failureId, undefined)
    assert.equal(response.payload.defectId, undefined)
    assert.ok(!existsSync(join(root, '.alm/failures')), 'the monitor must not have written anything')
  } finally {
    dispose()
    rmSync(root, { recursive: true, force: true })
  }
})

test('monitoring settings off stops automatic defect filing but explicit records still land', async () => {
  const root = tempRoot()
  const { instance, dispose } = service(root)
  try {
    const settings = await postEndpoint(instance, 'defect', { mode: 'settings', enabled: false })
    assert.equal(settings.status, 200)
    assert.equal(settings.payload.applied, true)
    assert.equal(settings.payload.monitoring.enabled, false)

    const started = await instance.startDeliveryRun({ root, requirementId: 'REQ-PAY-001', item: ITEM })
    assert.equal(started.reason, 'carrier-unavailable')
    assert.equal(started.failureId, undefined)
    assert.equal(started.defectId, undefined)
    assert.deepEqual(listDir(join(root, '.alm/failures')), [])
    assert.ok(!existsSync(join(root, '.alm/defects')))

    const explicit = instance.monitorFailure({
      root,
      requirement: 'REQ-PAY-001',
      stage: 'develop',
      step: 'manual-record',
      error: Object.assign(new Error('explicit record'), { code: 'ETIMEDOUT' }),
      auto: false,
    })
    assert.ok(explicit.failure?.id)
    assert.equal(listDir(join(root, '.alm/failures')).length, 1)
    assert.ok(!existsSync(join(root, '.alm/defects')), 'the explicit record is not an automatic defect')
  } finally {
    dispose()
    rmSync(root, { recursive: true, force: true })
  }
})

async function seedFailure(root, instance) {
  const out = instance.monitorFailure({
    root,
    requirement: 'REQ-PAY-001',
    run: 'RUN-ANALYSE-001',
    stage: 'develop',
    step: 'agent-turn',
    error: Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' }),
  })
  assert.ok(out.failure?.id)
  return out.failure.id
}

test('analyse stores the contract analysis when the model returns valid JSON', async () => {
  const root = tempRoot()
  let options
  const llm = { stream(value) { options = value; return fakeLlm(JSON.stringify(ANALYSIS)).stream(value) } }
  const { instance, dispose } = service(root, { llm, selection: { provider: 'host-provider', model: 'host-model', reasoningEffort: 'low' } })
  try {
    // A product defect, so the failure files a defect whose analysis we can check.
    const seeded = instance.monitorFailure({
      root,
      requirement: 'REQ-PAY-001',
      run: 'RUN-ANALYSE-002',
      stage: 'develop',
      step: 'agent-turn',
      error: Object.assign(new Error('rows.map is not a function'), { code: 'TypeError' }),
    })
    const failureId = seeded.failure.id
    const created = await postEndpoint(instance, 'defect', { mode: 'create', failureId, apply: true })
    assert.equal(created.status, 200)
    const response = await postEndpoint(instance, 'failure', { mode: 'analyse', failureId })
    assert.deepEqual({ provider: options.provider, model: options.model, reasoningEffort: options.reasoningEffort }, { provider: 'host-provider', model: 'host-model', reasoningEffort: 'low' })
    assert.equal(response.status, 200)
    assert.equal(response.payload.analysisStatus, 'complete')
    assert.equal(response.payload.failure.analysisStatus, 'complete')
    assert.equal(response.payload.failure.analysis.what, ANALYSIS.what)
    const stored = readJson(join(root, '.alm/failures', `${failureId}.json`))
    assert.equal(stored.analysisStatus, 'complete')
    assert.equal(stored.analysis.rootCause, ANALYSIS.rootCause)
    // The defect ledger carries the same reviewed analysis, not only the event.
    assert.ok(stored.defect, 'the failure should point at its defect')
    const defect = readJson(join(root, '.alm/defects', stored.defect + '.json'))
    assert.equal(defect.analysisStatus, 'complete')
    assert.equal(defect.analysis.rootCause, ANALYSIS.rootCause)
  } finally {
    dispose()
    rmSync(root, { recursive: true, force: true })
  }
})

test('analyse keeps the failure record and marks it failed on invalid model output', async () => {
  const root = tempRoot()
  const llm = fakeLlm('这不是 JSON')
  const { instance, dispose } = service(root, { llm })
  try {
    const failureId = await seedFailure(root, instance)
    const response = await postEndpoint(instance, 'failure', { mode: 'analyse', failureId })
    assert.equal(response.status, 200)
    assert.equal(response.payload.analysisStatus, 'failed')
    assert.ok(response.payload.failure.analysis.missing.length > 0)
    const stored = readJson(join(root, '.alm/failures', `${failureId}.json`))
    assert.equal(stored.analysisStatus, 'failed')
    assert.equal(stored.kind, 'external', 'the failure event itself is preserved')
  } finally {
    dispose()
    rmSync(root, { recursive: true, force: true })
  }
})

test('analyse records model selection failure without starting a stream', async () => {
  const root = tempRoot()
  const { instance, dispose } = service(root)
  try {
    const failureId = await seedFailure(root, instance)
    instance.resolveAiSelection = async () => { throw new Error('no model') }
    instance.aiStreamFor = () => { throw new Error('stream must not start') }
    const response = await postEndpoint(instance, 'failure', { mode: 'analyse', failureId })
    assert.equal(response.status, 200)
    assert.equal(response.payload.analysisStatus, 'failed')
    assert.equal(readJson(join(root, '.alm/failures', `${failureId}.json`)).analysisStatus, 'failed')
  } finally { dispose(); rmSync(root, { recursive: true, force: true }) }
})

test('a failing acceptance keeps evidence without creating a requirement when no carrier exists', () => {
  const root = tempRoot()
  const { instance, dispose } = service(root)
  try {
    const headSha = 'a'.repeat(40)
    const evidencePath = join(root, '.alm/acceptance/REQ-PAY-001', `${headSha}.json`)
    // Shape returned by alm-core runAcceptance: executed commands live under
    // `evidence.commands`, and a spawn failure carries error/spawnFailed.
    const failed = instance.monitorAcceptanceFailure(root, 'REQ-PAY-001', {
      schema: 'alm.acceptance.plan/v1',
      requirement: 'REQ-PAY-001',
      headSha,
      result: 'fail',
      evidencePath,
      commands: [{ id: 'cmd-1', command: ['node', '--test'], timeoutMs: 120000 }],
      evidence: {
        headSha,
        commands: [
          {
            id: 'cmd-1',
            command: ['node', '--test'],
            exitCode: null,
            timedOut: false,
            spawnFailed: true,
            durationMs: 9,
            error: { code: 'EPERM', message: 'spawnSync node EPERM' },
            stdout: '',
            stderr: '',
          },
        ],
      },
    })
    assert.equal(failed.failure?.stage, 'test')
    assert.equal(failed.failure?.step, 'acceptance')
    assert.equal(failed.kind, 'product-defect')
    assert.ok(String(failed.failure?.id ?? '').startsWith('FAIL-'))
    assert.match(failed.failure?.summary ?? '', /EPERM/, 'the failure summary names the reason')
    assert.equal(failed.defect, undefined)
    assert.equal(failed.repair.reason, 'no-authorized-carrier')
    assert.equal(listDir(join(root, '.alm/defects')).length, 0)
    assert.equal(sdocFiles(root).length, 0)

    const stored = readJson(join(root, '.alm/failures', `${failed.failure.id}.json`))
    assert.equal(stored.evidence.logs.length, 1)
    assert.match(stored.evidence.logs[0], /EPERM/)
    assert.match(stored.evidence.logs[0], /node --test/)
    assert.equal(stored.evidence.artifacts[0].path, evidencePath)
    assert.equal(stored.evidence.snapshot.headSha, headSha)
    assert.equal(stored.evidence.snapshot.failedCommands[0].spawnFailed, true)
    assert.equal(stored.evidence.snapshot.failedCommands[0].error.code, 'EPERM')

    const passed = instance.monitorAcceptanceFailure(root, 'REQ-PAY-001', { result: 'pass' })
    assert.equal(passed.skipped, true)
    assert.equal(passed.reason, 'not-failed')
    assert.equal(listDir(join(root, '.alm/failures')).length, 1)
  } finally {
    dispose()
    rmSync(root, { recursive: true, force: true })
  }
})

test('a legacy acceptance payload without executed evidence still files with its log', () => {
  const root = tempRoot()
  const { instance, dispose } = service(root)
  try {
    const failed = instance.monitorAcceptanceFailure(root, 'REQ-PAY-001', {
      result: 'fail',
      commands: [{ id: 'cmd-1', command: ['node', '--test'], result: 'fail', logPath: '.alm/acceptance/REQ-PAY-001/cmd-1.log' }],
    })
    assert.equal(failed.failure?.stage, 'test')
    const stored = readJson(join(root, '.alm/failures', `${failed.failure.id}.json`))
    assert.ok(stored.evidence.logs.includes('.alm/acceptance/REQ-PAY-001/cmd-1.log'))
  } finally {
    dispose()
    rmSync(root, { recursive: true, force: true })
  }
})

test('a defect iteration settles when its fix run ends, so the defect leaves fixing', async () => {
  const root = tempRoot()
  const offline = service(root)
  let defect = null
  try {
    const failure = await offline.instance.startDeliveryRun({ root, requirementId: 'REQ-PAY-001', item: ITEM })
    const created = await postEndpoint(offline.instance, 'defect', { mode: 'create', failureId: failure.failureId, apply: true })
    assert.equal(created.status, 200)
    const started = { defectId: created.payload.defect.id }
    defect = readJson(join(root, '.alm/defects', listDir(join(root, '.alm/defects'))[0]))
    assert.equal(defect.status, 'awaiting-confirmation')
    assert.equal(started.defectId, defect.id)
  } finally {
    offline.dispose()
  }

  const agent = { followup: () => Promise.resolve(), whenIdle: () => Promise.resolve(), cancel() {} }
  const agents = { create: async () => ({ agent, dispose() {} }) }
  const presets = { resolve: async (name) => ({ id: name }), mount: async () => {} }
  const online = service(root, { agents, presets })
  try {
    const confirmed = await postEndpoint(online.instance, 'defect', { mode: 'confirm', defectId: defect.id, apply: true })
    assert.equal(confirmed.payload.applied, true)
    const runId = confirmed.payload.execution.runId
    // The turn ran in the background; let the settle callback land.
    await new Promise((resolve) => setTimeout(resolve, 25))
    const settled = readJson(join(root, '.alm/defects', defect.id + '.json'))
    assert.equal(settled.status, 'verifying')
    const last = settled.iterations.at(-1)
    assert.equal(last.result, 'awaiting-acceptance')
    assert.equal(last.run, runId)
  } finally {
    online.dispose()
    rmSync(root, { recursive: true, force: true })
  }
})

test('a failed fix run marks the defect iteration failed', async () => {
  const root = tempRoot()
  const offline = service(root)
  let defect = null
  try {
    const failure = await offline.instance.startDeliveryRun({ root, requirementId: 'REQ-PAY-001', item: ITEM })
    const created = await postEndpoint(offline.instance, 'defect', { mode: 'create', failureId: failure.failureId, apply: true })
    assert.equal(created.status, 200)
    const started = { defectId: created.payload.defect.id }
    defect = readJson(join(root, '.alm/defects', listDir(join(root, '.alm/defects'))[0]))
    assert.equal(started.defectId, defect.id)
  } finally {
    offline.dispose()
  }

  const agent = { followup: () => Promise.reject(Object.assign(new Error('agent crashed'), { code: 'agent-crashed' })), whenIdle: () => Promise.resolve(), cancel() {} }
  const agents = { create: async () => ({ agent, dispose() {} }) }
  const presets = { resolve: async (name) => ({ id: name }), mount: async () => {} }
  const online = service(root, { agents, presets })
  try {
    await postEndpoint(online.instance, 'defect', { mode: 'confirm', defectId: defect.id, apply: true })
    await new Promise((resolve) => setTimeout(resolve, 50))
    const settled = readJson(join(root, '.alm/defects', defect.id + '.json'))
    assert.equal(settled.status, 'failed')
    assert.equal(settled.iterations.at(-1).result, 'failed')
  } finally {
    online.dispose()
    rmSync(root, { recursive: true, force: true })
  }
})

test('a passing acceptance closes the defect it just verified', async () => {
  const root = tempRoot()
  const offline = service(root)
  let defect = null
  try {
    const failure = await offline.instance.startDeliveryRun({ root, requirementId: 'REQ-PAY-001', item: ITEM })
    const created = await postEndpoint(offline.instance, 'defect', { mode: 'create', failureId: failure.failureId, apply: true })
    assert.equal(created.status, 200)
    defect = readJson(join(root, '.alm/defects', listDir(join(root, '.alm/defects'))[0]))
  } finally {
    offline.dispose()
  }

  const agent = { followup: () => Promise.resolve(), whenIdle: () => Promise.resolve(), cancel() {} }
  const agents = { create: async () => ({ agent, dispose() {} }) }
  const presets = { resolve: async (name) => ({ id: name }), mount: async () => {} }
  const online = service(root, { agents, presets })
  try {
    await postEndpoint(online.instance, 'defect', { mode: 'confirm', defectId: defect.id, apply: true })
    await new Promise((resolve) => setTimeout(resolve, 25))
    assert.equal(readJson(join(root, '.alm/defects', defect.id + '.json')).status, 'verifying')

    const monitoring = online.instance.monitorAcceptanceResult(root, defect.requirement, { result: 'pass' })
    assert.equal(monitoring.skipped, false)
    assert.equal(monitoring.closed.length, 1)
    const closed = readJson(join(root, '.alm/defects', defect.id + '.json'))
    assert.equal(closed.status, 'closed')
    assert.ok(closed.iterations.some((iteration) => iteration.result === 'accepted'))
    assert.equal(readJson(join(root, '.alm/defects', defect.id + '.json')).status, 'closed')
    // A repeat failure stays on this requirement; automatic monitoring must not
    // reopen a defect requirement or authorize another release.
    const failed = online.instance.monitorAcceptanceResult(root, defect.requirement, { result: 'fail', commands: [] })
    assert.equal(failed.skipped, false)
    const reopened = listDir(join(root, '.alm/defects')).map((name) => readJson(join(root, '.alm/defects', name)))
    assert.equal(reopened.length, 1)
    assert.equal(reopened[0].status, 'closed')
    assert.equal(failed.failure.defect, null)
    assert.equal(failed.repair.scheduled, true)
    await Promise.all([...online.instance.repairJobs.values()])
  } finally {
    online.dispose()
    rmSync(root, { recursive: true, force: true })
  }
})
