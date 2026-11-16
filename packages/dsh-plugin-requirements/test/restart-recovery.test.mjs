import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import RequirementsService from '../index.js'
import { updateRun } from '../../alm-core/src/requirements/run.mjs'

/**
 * "恢复推进" must always end in a run the panel can show. Before this suite the
 * button could refuse with `run-active` (a record that still said "running"
 * with a dead heartbeat) or `no-active-run` (a parked round) and the button
 * stayed exactly as it was, so the human saw nothing happen.
 */

function git(root, ...args) {
  execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], { cwd: root, stdio: 'ignore' })
}

function fixtureRepo() {
  const root = mkdtempSync(join(tmpdir(), 'alm-restart-'))
  mkdirSync(join(root, 'requirements', 'briefs'), { recursive: true })
  writeFileSync(join(root, 'requirements', 'req-pay-001.sdoc'), [
    '[DOCUMENT]', 'TITLE: 需求样例', '', '[REQUIREMENT]', 'UID: REQ-PAY-001', 'TITLE: 列表按创建时间倒序',
    'OWNER: team-x', 'PRIORITY: P1', 'CATEGORY: functional', 'REVISION: 1', 'BRIEF: requirements/briefs/REQ-PAY-001.md', 'SOURCE: chat', '',
  ].join('\n'))
  writeFileSync(join(root, 'requirements', 'briefs', 'REQ-PAY-001.md'), '# 目标\n\n列表按创建时间倒序。\n\n# 验收\n\n进入列表时按创建时间倒序排列。\n')
  writeFileSync(join(root, 'README.md'), '# fixture\n')
  mkdirSync(join(root, 'packages', 'demo', 'test'), { recursive: true })
  writeFileSync(join(root, 'packages', 'demo', 'index.js'), 'export default 1\n')
  writeFileSync(join(root, 'packages', 'demo', 'test', 'index.test.mjs'), "import test from 'node:test'\ntest('列表按创建时间倒序', () => {})\n")
  writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }, null, 2))
  mkdirSync(join(root, '.alm', 'acceptance'), { recursive: true })
  writeFileSync(join(root, '.alm', 'acceptance', 'REQ-PAY-001.json'), JSON.stringify({
    schema: 'alm.acceptance.config/v1',
    requirement: 'REQ-PAY-001',
    commands: [{ id: 'test', command: ['node', '-e', 'process.exit(0)'] }],
  }))
  git(root, 'init'); git(root, 'add', '.'); git(root, 'commit', '-m', 'fixture')
  return root
}

async function withServer(root, run) {
  const routes = new Map()
  const followed = []
  const agents = {
    async create() {
      return {
        agent: {
          followup: (message) => { followed.push(message); return Promise.resolve() },
          // A live turn: the run keeps its heartbeat and never settles here.
          whenIdle: () => new Promise(() => {}),
          cancel: () => {},
        },
        dispose: () => {},
      }
    },
  }
  const presets = { resolve: async (name) => ({ id: name }), mount: async () => {} }
  const admission = { peer: { principal: { kind: 'human', id: 'human:test' } } }
  const ctx = {
    effect(callback) { callback() },
    on() { return () => {} },
    webServer: { register(route) { routes.set(route.path, route.handler); return () => routes.delete(route.path) } },
    tools: { register: () => () => {} },
    get(name) {
      if (name === 'connection') return { admit: () => admission }
      if (name === 'agents') return agents
      if (name === 'agentPresets') return presets
      if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-flash' }) }
      return null
    },
  }
  new RequirementsService(ctx, { root, sidebarPort: 0 })
  const server = createServer((req, res) => {
    const handler = routes.get(new URL(req.url, 'http://127.0.0.1').pathname)
    if (!handler) { res.writeHead(404).end('not found'); return }
    handler(req, res)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  try { await run(base, followed) } finally { await new Promise((resolve) => server.close(resolve)) }
}

const startRun = (base) => fetch(`${base}/api/alm/requirements/start`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ requirementId: 'REQ-PAY-001', apply: true, autoAdvance: true }),
}).then((response) => response.json())

const restart = (base) => fetch(`${base}/api/alm/requirements/run`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ mode: 'restart', requirementId: 'REQ-PAY-001' }),
}).then(async (response) => ({ status: response.status, body: await response.json() }))

const runFiles = (root) => readdirSync(join(root, '.alm', 'runs')).filter((name) => /^RUN-\d+\.json$/.test(name))

test('a live run is reported as active instead of failing the resume click', async () => {
  const root = fixtureRepo()
  try {
    await withServer(root, async (base, followed) => {
      const started = await startRun(base)
      assert.equal(started.execution.scheduled, true)
      const runId = started.execution.runId
      const before = followed.length

      const result = await restart(base)
      assert.equal(result.status, 200)
      assert.equal(result.body.restarted, false)
      assert.equal(result.body.reason, 'run-active')
      // The panel needs the run to switch its button to "查看运行".
      assert.equal(result.body.active, true)
      assert.equal(result.body.runId, runId)
      assert.equal(result.body.status, 'running')
      assert.deepEqual(runFiles(root), [`${runId}.json`], 'no duplicate run for a live round')
      assert.equal(followed.length, before, 'a live round receives no second instruction')
    })
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a parked round is continued by 恢复推进 instead of being refused', async () => {
  const root = fixtureRepo()
  try {
    await withServer(root, async (base, followed) => {
      const started = await startRun(base)
      const runId = started.execution.runId
      const path = join(root, '.alm', 'runs', `${runId}.json`)
      const record = JSON.parse(readFileSync(path, 'utf8'))
      updateRun({ root, runId, expectedRun: record, status: 'waiting-input', phase: 'review-result', apply: true })
      const before = followed.length

      const result = await restart(base)
      assert.equal(result.status, 200)
      assert.equal(result.body.restarted, true)
      assert.equal(result.body.continued, true)
      assert.equal(result.body.runId, runId)
      assert.deepEqual(runFiles(root), [`${runId}.json`], 'continuing keeps the same run record')
      assert.equal(followed.length, before + 1, 'the carrier receives the continue instruction')
      const after = JSON.parse(readFileSync(path, 'utf8'))
      assert.equal(after.status, 'running')
      assert.equal(after.phase, 'resume')
    })
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a run with a dead heartbeat is replaced instead of blocking the resume click', async () => {
  const root = fixtureRepo()
  try {
    await withServer(root, async (base, followed) => {
      const started = await startRun(base)
      const runId = started.execution.runId
      const path = join(root, '.alm', 'runs', `${runId}.json`)
      const record = JSON.parse(readFileSync(path, 'utf8'))
      const stale = new Date(Date.now() - 30 * 60 * 1000).toISOString()
      writeFileSync(path, JSON.stringify({ ...record, heartbeatAt: stale, updatedAt: stale }, null, 2))

      const result = await restart(base)
      assert.equal(result.status, 200, JSON.stringify(result.body))
      assert.equal(result.body.restarted, true)
      assert.equal(result.body.previousRunId, runId)
      assert.notEqual(result.body.runId, runId, 'a dead carrier is replaced by a new run')
      assert.equal(runFiles(root).length, 2)
      assert.ok(followed.length >= 2, 'the new carrier receives the restart instruction')
      const swept = JSON.parse(readFileSync(path, 'utf8'))
      assert.equal(swept.status, 'failed')
      assert.equal(swept.failure.code, 'heartbeat-lost')
    })
  } finally { rmSync(root, { recursive: true, force: true }) }
})
