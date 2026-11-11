import test from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { draftTasks } from '../../alm-core/src/tasks/draft.mjs'
import RequirementsService from '../index.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const fixture = join(repoRoot, 'fixtures/order-refund')

test('GET /alm/requirements serves the standalone HTML page', async () => {
  const routes = new Map()
  const ctx = {
    effect(callback) {
      callback()
    },
    webServer: {
      register(route) {
        routes.set(route.path, route.handler)
        return () => routes.delete(route.path)
      },
    },
    tools: { register: () => () => {} },
  }

  new RequirementsService(ctx, {})
  const server = createServer((req, res) => {
    const handler = routes.get(req.url)
    if (!handler) {
      res.writeHead(404).end('not found')
      return
    }
    handler(req, res)
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const { port } = server.address()
    const response = await fetch(`http://127.0.0.1:${port}/alm/requirements`)
    const html = await response.text()
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type'), /text\/html/)
    assert.match(html, /ALM Requirements/)
    assert.match(html, /REQ-PAY-001/)
    assert.match(html, /href="\/api\/alm\/requirements"/)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('invalid root is rejected with 400 instead of walking the filesystem', async () => {
  const routes = new Map()
  const ctx = {
    effect(callback) {
      callback()
    },
    webServer: {
      register(route) {
        routes.set(route.path, route.handler)
        return () => routes.delete(route.path)
      },
    },
    tools: { register: () => () => {} },
  }

  new RequirementsService(ctx, {})
  const server = createServer((req, res) => {
    const handler = routes.get(new URL(req.url, 'http://127.0.0.1').pathname)
    if (!handler) {
      res.writeHead(404).end('not found')
      return
    }
    handler(req, res)
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const { port } = server.address()
    const response = await fetch(`http://127.0.0.1:${port}/api/alm/requirements?root=../etc`)
    assert.equal(response.status, 400)
    const body = await response.json()
    assert.equal(body.ok, false)
    assert.equal(body.error.code, 'invalid-root')
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})


function makeWorkspaceStore(entries, defaultId = 'default-ws') {
  const dir = mkdtempSync(join(tmpdir(), 'alm-ws-http-'))
  const file = join(dir, 'workspace.json')
  writeFileSync(
    file,
    JSON.stringify({
      unit: { name: 'workspace', version: 2 },
      global: { initialized: true, defaultWorkspaceId: defaultId, workspaceIds: Object.keys(entries) },
      tables: { workspaces: entries },
    }),
  )
  return { dir, file }
}

function useWorkspaceStore(file) {
  const previous = process.env.DSH_WORKSPACES_FILE
  process.env.DSH_WORKSPACES_FILE = file
  return () => {
    if (previous === undefined) delete process.env.DSH_WORKSPACES_FILE
    else process.env.DSH_WORKSPACES_FILE = previous
  }
}

test('GET /api/alm/projects lists DSH workspaces and excludes the default workspace', async () => {
  const bare = mkdtempSync(join(tmpdir(), 'alm-ws-bare-'))
  const store = makeWorkspaceStore({
    'default-ws': { path: join(bare, 'default'), title: 'default-workspace' },
    'pay-ws': { path: fixture, title: '支付平台工作区' },
    'bare-ws': { path: bare, title: 'plug-in' },
  })
  const restore = useWorkspaceStore(store.file)
  const routes = new Map()
  const ctx = {
    effect(callback) {
      callback()
    },
    webServer: {
      register(route) {
        routes.set(route.path, route.handler)
        return () => routes.delete(route.path)
      },
    },
    tools: { register: () => () => {} },
  }

  new RequirementsService(ctx, {})
  const server = createServer((req, res) => {
    const handler = routes.get(req.url)
    if (!handler) {
      res.writeHead(404).end('not found')
      return
    }
    handler(req, res)
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const { port } = server.address()
    const response = await fetch(`http://127.0.0.1:${port}/api/alm/projects`)
    const payload = await response.json()
    assert.equal(response.status, 200)
    assert.equal(payload.schema, 'alm.projects/v1')
    assert.ok(!payload.projects.some((project) => project.workspaceId === 'default-ws'))
    const pay = payload.projects.find((project) => project.workspaceId === 'pay-ws')
    assert.ok(pay)
    assert.equal(pay.projectId, 'PAY')
    assert.equal(pay.linked, true)
    assert.equal(pay.root, fixture)
    const bareEntry = payload.projects.find((project) => project.workspaceId === 'bare-ws')
    assert.equal(bareEntry.linked, false)
    assert.equal(bareEntry.projectId, null)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    restore()
    rmSync(store.dir, { recursive: true, force: true })
    rmSync(bare, { recursive: true, force: true })
  }
})

test('POST /api/alm/projects/associate links a workspace to a GitHub repo', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'alm-ws-assoc-'))
  const store = makeWorkspaceStore({ 'bare-ws': { path: workspace, title: '新工作区' } })
  const restore = useWorkspaceStore(store.file)
  try {
    await withWriteServer(fixture, async (base) => {
      const response = await fetch(`${base}/api/alm/projects/associate?root=${encodeURIComponent(workspace)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'DEMO',
          name: '演示项目',
          owner: 'peterzhanghao',
          repo: 'AI_ALM',
          projectNumber: 2,
        }),
      })
      const payload = await response.json()
      assert.equal(response.status, 200)
      assert.equal(payload.schema, 'alm.project.associate/v1')
      assert.equal(payload.id, 'DEMO')
      assert.ok(existsSync(join(workspace, '.alm/project.json')))
      assert.ok(existsSync(join(workspace, 'requirements')))
      assert.equal(JSON.parse(readFileSync(join(workspace, '.alm/project.json'), 'utf8')).github.repo, 'AI_ALM')

      const listed = await (await fetch(`${base}/api/alm/projects`)).json()
      const linked = listed.projects.find((project) => project.workspaceId === 'bare-ws')
      assert.equal(linked.linked, true)
      assert.equal(linked.projectId, 'DEMO')
    })
  } finally {
    restore()
    rmSync(store.dir, { recursive: true, force: true })
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('GET /api/alm/requirements?project=ALL aggregates workspaces', async () => {
  const store = makeWorkspaceStore({ 'pay-ws': { path: fixture, title: '支付平台工作区' } })
  const restore = useWorkspaceStore(store.file)

  const routes = new Map()
  const ctx = {
    effect(callback) {
      callback()
    },
    webServer: {
      register(route) {
        routes.set(route.path, route.handler)
        return () => routes.delete(route.path)
      },
    },
    tools: { register: () => () => {} },
  }

  new RequirementsService(ctx, { root: fixture })
  const server = createServer((req, res) => {
    const handler = routes.get(new URL(req.url, 'http://127.0.0.1').pathname)
    if (!handler) {
      res.writeHead(404).end('not found')
      return
    }
    handler(req, res)
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const { port } = server.address()
    const response = await fetch(`http://127.0.0.1:${port}/api/alm/requirements?project=ALL`)
    const payload = await response.json()
    assert.equal(response.status, 200)
    assert.equal(payload.schema, 'alm.requirements/v1')
    assert.equal(payload.scope, 'all')
    assert.ok(payload.requirements.some((item) => item.project === 'PAY' && item.id === 'REQ-PAY-001'))
    assert.ok(payload.projects.some((project) => project.project === 'PAY' && project.result === 'pass'))
  } finally {
    await new Promise((resolve) => server.close(resolve))
    restore()
    rmSync(store.dir, { recursive: true, force: true })
  }
})

test('GET /api/alm/requirements/version serves a committed snapshot and rejects bad input', async () => {
  const routes = new Map()
  const ctx = {
    effect(callback) {
      callback()
    },
    webServer: {
      register(route) {
        routes.set(route.path, route.handler)
        return () => routes.delete(route.path)
      },
    },
    tools: { register: () => () => {} },
  }

  new RequirementsService(ctx, { root: fixture })
  const server = createServer((req, res) => {
    const handler = routes.get(new URL(req.url, 'http://127.0.0.1').pathname)
    if (!handler) {
      res.writeHead(404).end('not found')
      return
    }
    handler(req, res)
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const { port } = server.address()
    const base = `http://127.0.0.1:${port}`
    const list = await (await fetch(`${base}/api/alm/requirements`)).json()
    const item = list.requirements.find((entry) => entry.id === 'REQ-PAY-001')
    assert.ok(item?.versions?.length, 'fixture requirement should have git history')
    const sha = item.versions[0].sha

    const response = await fetch(`${base}/api/alm/requirements/version?asset=REQ-PAY-001&sha=${sha}`)
    const payload = await response.json()
    assert.equal(response.status, 200)
    assert.equal(payload.schema, 'alm.version/v1')
    assert.equal(payload.asset, 'REQ-PAY-001')
    assert.match(payload.content, /REQ-PAY-001/)

    const bad = await fetch(`${base}/api/alm/requirements/version?asset=REQ-PAY-001&sha=zzz`)
    assert.equal(bad.status, 400)
    assert.equal((await bad.json()).error.code, 'invalid-sha')
    const history = await fetch(`${base}/api/alm/requirements/version?mode=history&asset=REQ-PAY-001`)
    const page = await history.json()
    assert.equal(history.status, 200)
    assert.equal(page.schema, 'alm.version.history/v1')
    assert.ok(page.versions.length > 0)
    assert.match(page.head, /^[0-9a-f]{40,64}$/)
    const badOffset = await fetch(`${base}/api/alm/requirements/version?mode=history&asset=REQ-PAY-001&offset=20`)
    assert.equal(badOffset.status, 400)
    assert.equal((await badOffset.json()).error.code, 'invalid-head')
    const wrongMethod = await fetch(`${base}/api/alm/requirements/version?mode=history&asset=REQ-PAY-001`, { method: 'POST' })
    assert.equal(wrongMethod.status, 405)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

async function withWriteServer(root, run, extra = {}) {
  const routes = new Map()
  const ctx = {
    effect(callback) {
      callback()
    },
    get(name) {
      return extra.services?.[name]
    },
    webServer: {
      register(route) {
        routes.set(route.path, route.handler)
        return () => routes.delete(route.path)
      },
    },
    tools: { register: () => () => {} },
  }
  new RequirementsService(ctx, { root, ...extra })
  const server = createServer((req, res) => {
    const handler = routes.get(new URL(req.url, 'http://127.0.0.1').pathname)
    if (!handler) {
      res.writeHead(404).end('not found')
      return
    }
    handler(req, res)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    await run(`http://127.0.0.1:${server.address().port}`)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

test('trusted human subject prefers Connection admission and rejects failed authentication', () => {
  const routes = new Map()
  const connection = {
    admit({ headers }) {
      assert.equal(headers.authorization, 'Bearer host-proof')
      return { peer: { principal: { id: 'human:alice', kind: 'human' } } }
    },
  }
  const service = new RequirementsService(
    {
      effect(callback) {
        callback()
      },
      get(name) {
        return name === 'connection' ? connection : undefined
      },
      webServer: {
        register(route) {
          routes.set(route.path, route.handler)
          return () => routes.delete(route.path)
        },
      },
      tools: { register: () => () => {} },
    },
    { root: fixture },
  )
  assert.deepEqual(service.humanSubjectFor({ headers: { authorization: 'Bearer host-proof' } }), {
    id: 'human:alice',
    kind: 'human',
    source: 'host-authenticated',
  })

  connection.admit = () => ({ rejection: 401 })
  assert.throws(
    () => service.humanSubjectFor({ headers: {} }),
    (error) => error.code === 'unauthenticated-subject' && error.status === 401,
  )
})

test('POST /api/alm/requirements/start previews without writing', async () => {
  await withWriteServer(fixture, async (base) => {
    const response = await fetch(`${base}/api/alm/requirements/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requirementId: 'REQ-PAY-004' }),
    })
    const payload = await response.json()
    assert.equal(response.status, 200)
    assert.equal(payload.schema, 'alm.change.plan/v1')
    assert.equal(payload.applied, false)
    assert.equal(payload.changeId, 'CHG-PAY-001')
    assert.equal(payload.taskCount, 3)
    assert.ok(!existsSync(join(fixture, '.alm/changes/CHG-PAY-001.json')))
  })
})

test('POST /api/alm/requirements/create previews and applies on a temp root', async () => {
  await withWriteServer(fixture, async (base) => {
    const preview = await fetch(`${base}/api/alm/requirements/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '退款状态对账', brief: '每天对账退款状态' }),
    })
    const plan = await preview.json()
    assert.equal(preview.status, 200)
    assert.equal(plan.requirementId, 'REQ-PAY-005')
    assert.ok(!existsSync(join(fixture, plan.file)))
  })

  const dir = mkdtempSync(join(tmpdir(), 'alm-create-http-'))
  try {
    cpSync(fixture, dir, { recursive: true })
    await withWriteServer(dir, async (base) => {
      const response = await fetch(`${base}/api/alm/requirements/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: '退款状态对账', brief: '每天对账退款状态', apply: true }),
      })
      const payload = await response.json()
      assert.equal(response.status, 200)
      assert.equal(payload.applied, true)
      assert.ok(existsSync(join(dir, 'requirements/req-pay-005.sdoc')))
      assert.ok(existsSync(join(dir, 'requirements/briefs/REQ-PAY-005.md')))
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('write endpoints reject non-POST and broken roots', async () => {
  await withWriteServer(fixture, async (base) => {
    const getResponse = await fetch(`${base}/api/alm/requirements/start`)
    assert.equal(getResponse.status, 405)

    const dir = mkdtempSync(join(tmpdir(), 'alm-accept-http-'))
    try {
      // runCi needs a git repository; a plain temp dir must fail, not hang.
      const accept = await fetch(`${base}/api/alm/requirements/accept?root=${encodeURIComponent(dir)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      assert.equal(accept.status, 400)
      assert.equal((await accept.json()).error.code, 'write-failed')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

test('a write uses the workspace named in its body, not only the query string', async () => {
  await withWriteServer(fixture, async (base) => {
    const dir = mkdtempSync(join(tmpdir(), 'alm-root-body-'))
    try {
      cpSync(fixture, dir, { recursive: true })
      const response = await fetch(`${base}/api/alm/requirements/archive`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ root: dir, requirementId: 'REQ-PAY-001' }),
      })
      assert.equal(response.status, 200)
      const payload = await response.json()
      assert.equal(payload.requirement, 'REQ-PAY-001')
      assert.equal(payload.applied, false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

test('POST /api/alm/requirements/github previews issue plan without network', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'alm-github-http-'))
  try {
    cpSync(fixture, dir, { recursive: true })
    mkdirSync(join(dir, '.alm', 'changes'), { recursive: true })
    writeFileSync(
      join(dir, '.alm', 'changes', 'CHG-GH-001.json'),
      JSON.stringify({
        schema: 'alm.change/v1',
        changeId: 'CHG-GH-001',
        baselineSha: 'a'.repeat(40),
        branch: 'alm/chg-gh-001',
        status: 'open',
      }),
    )
    draftTasks({ root: dir, changeId: 'CHG-GH-001', requirementIds: ['REQ-PAY-004'] })

    await withWriteServer(dir, async (base) => {
      const response = await fetch(`${base}/api/alm/requirements/github?root=${encodeURIComponent(dir)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ changeId: 'CHG-GH-001' }),
      })
      const payload = await response.json()
      assert.equal(response.status, 200)
      assert.equal(payload.schema, 'alm.github.plan/v1')
      assert.equal(payload.repo, 'peterzhanghao/AI_ALM')
      assert.equal(payload.requirements.length, 1)
      assert.match(payload.requirements[0].title, /^\[REQ-PAY-004\]/)
      assert.equal(payload.tasks.length, 3)
      assert.ok(!existsSync(join(dir, '.alm', 'github.json')))

      const missing = await fetch(`${base}/api/alm/requirements/github?root=${encodeURIComponent(dir)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ changeId: 'CHG-NOPE-001' }),
      })
      assert.equal(missing.status, 404)
      assert.equal((await missing.json()).error.code, 'no-draft')
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('POST /api/alm/requirements/acceptance previews and archives evidence', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'alm-acceptance-http-'))
  try {
    writeFileSync(join(dir, 'README.md'), '# demo\n')
    execFileSync('git', ['init', '-q'], { cwd: dir })
    execFileSync('git', ['add', '-A'], { cwd: dir })
    execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'init'], { cwd: dir })
    mkdirSync(join(dir, '.alm', 'acceptance'), { recursive: true })
    writeFileSync(
      join(dir, '.alm', 'acceptance', 'REQ-X-001.json'),
      JSON.stringify({
        schema: 'alm.acceptance.config/v1',
        requirement: 'REQ-X-001',
        commands: [{ id: 'smoke', command: ['node', '-e', 'process.exit(0)'] }],
      }),
    )

    await withWriteServer(dir, async (base) => {
      const preview = await fetch(`${base}/api/alm/requirements/acceptance?root=${encodeURIComponent(dir)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requirementId: 'REQ-X-001' }),
      })
      const plan = await preview.json()
      assert.equal(preview.status, 200)
      assert.equal(plan.schema, 'alm.acceptance.plan/v1')
      assert.equal(plan.applied, false)
      assert.equal(plan.commands[0].id, 'smoke')
      assert.ok(!existsSync(join(dir, '.alm', 'acceptance', 'REQ-X-001')))

      const run = await fetch(`${base}/api/alm/requirements/acceptance?root=${encodeURIComponent(dir)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requirementId: 'REQ-X-001', apply: true }),
      })
      const result = await run.json()
      assert.equal(run.status, 200)
      assert.equal(result.result, 'pass')
      assert.equal(result.applied, true)
      assert.ok(existsSync(result.evidencePath))

      const missing = await fetch(`${base}/api/alm/requirements/acceptance?root=${encodeURIComponent(dir)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requirementId: 'REQ-NOPE-001' }),
      })
      assert.equal(missing.status, 404)
      assert.equal((await missing.json()).error.code, 'no-config')
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('POST /api/alm/requirements/archive closes a requirement without developing it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'alm-archive-http-'))
  try {
    cpSync(fixture, dir, { recursive: true })
    execFileSync('git', ['init', '-q'], { cwd: dir })
    execFileSync('git', ['add', '-A'], { cwd: dir })
    execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'init'], { cwd: dir })
    await withWriteServer(dir, async (base) => {
      const preview = await fetch(`${base}/api/alm/requirements/archive?root=${encodeURIComponent(dir)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requirementId: 'REQ-PAY-001' }),
      })
      const plan = await preview.json()
      assert.equal(preview.status, 200)
      assert.equal(plan.applied, false)
      assert.equal(plan.status.to, 'archived')

      const apply = await fetch(`${base}/api/alm/requirements/archive?root=${encodeURIComponent(dir)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          requirementId: 'REQ-PAY-001',
          apply: true,
          expectedBaseline: plan.baseline,
          actor: 'human:local',
          reason: '本期不开发',
          idempotencyKey: 'http-close-1',
        }),
      })
      const result = await apply.json()
      assert.equal(apply.status, 200)
      assert.equal(result.status.to, 'archived')
      assert.ok(result.auditFile)

      const replay = await fetch(`${base}/api/alm/requirements/archive?root=${encodeURIComponent(dir)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          requirementId: 'REQ-PAY-001',
          apply: true,
          expectedBaseline: plan.baseline,
          actor: 'human:local',
          idempotencyKey: 'http-close-1',
        }),
      })
      assert.equal(replay.status, 200)
      assert.equal((await replay.json()).idempotent, true)

      const list = await fetch(`${base}/api/alm/requirements?root=${encodeURIComponent(dir)}`)
      const payload = await list.json()
      const item = payload.requirements.find((entry) => entry.id === 'REQ-PAY-001')
      assert.equal(item.status, 'archived')
      assert.equal(item.decision.state, 'archived')
      assert.equal(item.decision.nextStep.action, 'none')
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('GET /api/alm/requirements/diff compares a commit against the worktree', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'alm-diff-http-'))
  try {
    cpSync(fixture, dir, { recursive: true })
    execFileSync('git', ['init', '-q'], { cwd: dir })
    execFileSync('git', ['add', '-A'], { cwd: dir })
    execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'init'], { cwd: dir })
    const head = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    const file = join(dir, 'requirements', 'refund.sdoc')
    writeFileSync(file, readFileSync(file, 'utf8').replace('STATUS: proposed', 'STATUS: accepted'))

    await withWriteServer(dir, async (base) => {
      const response = await fetch(
        `${base}/api/alm/requirements/diff?root=${encodeURIComponent(dir)}&asset=REQ-PAY-001&from=${head.slice(0, 8)}`,
      )
      const payload = await response.json()
      assert.equal(response.status, 200)
      assert.equal(payload.schema, 'alm.version.diff/v1')
      assert.equal(payload.to, 'worktree')
      assert.ok(payload.fields.some((field) => field.field === 'STATUS' && field.to === 'accepted'))

      const missing = await fetch(
        `${base}/api/alm/requirements/diff?root=${encodeURIComponent(dir)}&asset=REQ-NOPE-001&from=${head.slice(0, 8)}`,
      )
      assert.equal(missing.status, 404)
      assert.equal((await missing.json()).error.code, 'asset-not-found')
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('POST /api/alm/requirements/signoff persists independent human acceptance', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'alm-review-http-'))
  try {
    cpSync(fixture, dir, { recursive: true })
    execFileSync('git', ['init', '-q'], { cwd: dir })
    execFileSync('git', ['add', '-A'], { cwd: dir })
    execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'init'], {
      cwd: dir,
    })
    await withWriteServer(dir, async (base) => {
      assert.ok(!existsSync(join(dir, '.alm', 'signoffs', 'REQ-PAY-001.json')))

      // Request JSON cannot select the signer. With no Connection service this
      // test server is the explicit local single-user boundary, so even forged
      // actor/subject fields reach the ordinary acceptance gate as human:local.
      const gate = await fetch(`${base}/api/alm/requirements/signoff?root=${encodeURIComponent(dir)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          requirementId: 'REQ-PAY-001',
          actor: 'human:mallory',
          subject: { id: 'human:mallory', kind: 'human', source: 'host-authenticated' },
          apply: true,
        }),
      })
      assert.equal(gate.status, 409)
      assert.equal((await gate.json()).error.code, 'acceptance-missing')

      // Register and execute the acceptance command, then sign off for real.
      mkdirSync(join(dir, '.alm', 'acceptance'), { recursive: true })
      writeFileSync(
        join(dir, '.alm', 'acceptance', 'REQ-PAY-001.json'),
        JSON.stringify({
          schema: 'alm.acceptance.config/v1',
          requirement: 'REQ-PAY-001',
          commands: [{ id: 'smoke', command: ['node', '-e', 'process.exit(0)'] }],
        }),
      )
      const run = await fetch(`${base}/api/alm/requirements/acceptance?root=${encodeURIComponent(dir)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requirementId: 'REQ-PAY-001', apply: true }),
      })
      assert.equal((await run.json()).result, 'pass')

      // Human acceptance binds a delivery candidate: no candidate, no sign-off.
      const noCandidate = await fetch(`${base}/api/alm/requirements/signoff?root=${encodeURIComponent(dir)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requirementId: 'REQ-PAY-001', actor: 'human:tester', apply: true }),
      })
      assert.equal(noCandidate.status, 409)
      assert.equal((await noCandidate.json()).error.code, 'candidate-missing')

      const made = await fetch(`${base}/api/alm/requirements/candidate?root=${encodeURIComponent(dir)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requirementId: 'REQ-PAY-001', actor: 'ai:adopted' }),
      })
      const candidate = await made.json()
      assert.equal(made.status, 200)
      assert.equal(candidate.created, true)
      assert.ok(candidate.candidate.id.startsWith('CAND-REQ-PAY-001-'))
      assert.ok(candidate.candidate.treeHash)

      const signed = await fetch(`${base}/api/alm/requirements/signoff?root=${encodeURIComponent(dir)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requirementId: 'REQ-PAY-001', actor: 'human:tester', apply: true }),
      })
      const signoff = await signed.json()
      assert.equal(signed.status, 200)
      assert.equal(signoff.applied, true, JSON.stringify(signoff))
      assert.equal(signoff.signoff.actor, 'human:local')
      assert.deepEqual(signoff.signoff.subject, { id: 'human:local', kind: 'human', source: 'local-session' })

      const payload = await (await fetch(`${base}/api/alm/requirements?root=${encodeURIComponent(dir)}`)).json()
      const item = payload.requirements.find((entry) => entry.id === 'REQ-PAY-001')
      assert.equal('review' in item, false)
      assert.equal(item.humanAcceptance.signoffValid, true)
      assert.equal(item.humanAcceptance.signoff.actor, 'human:local')
      assert.deepEqual(item.humanAcceptance.signoff.subject, { id: 'human:local', kind: 'human', source: 'local-session' })
      assert.equal(item.humanAcceptance.evidenceBound, true)
      assert.ok(existsSync(join(dir, '.alm', 'signoffs', 'REQ-PAY-001.json')))
      assert.ok(!existsSync(join(dir, '.alm', 'reviews', 'REQ-PAY-001.json')))
      assert.equal(item.decision.state, 'verified')

      const createdRelease = await fetch(`${base}/api/alm/requirements/release?root=${encodeURIComponent(dir)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'create', requirementIds: ['REQ-PAY-001'] }),
      })
      const releaseDraft = await createdRelease.json()
      assert.equal(createdRelease.status, 200)
      assert.equal(releaseDraft.release.status, 'draft')

      const authorizedRelease = await fetch(`${base}/api/alm/requirements/release?root=${encodeURIComponent(dir)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode: 'authorize',
          releaseId: releaseDraft.release.id,
          actor: 'human:mallory',
          subject: { id: 'human:mallory', kind: 'human', source: 'host-authenticated' },
          apply: true,
        }),
      })
      const authorization = await authorizedRelease.json()
      assert.equal(authorizedRelease.status, 200)
      assert.equal(authorization.release.authorization.actor, 'human:local')
      assert.deepEqual(authorization.release.authorization.subject, {
        id: 'human:local',
        kind: 'human',
        source: 'local-session',
      })
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('POST /api/alm/requirements/intake parses chat and runs local OCR adapter', async () => {
  await withWriteServer(fixture, async (base) => {
    const chat = await fetch(`${base}/api/alm/requirements/intake?root=${encodeURIComponent(fixture)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'chat', markdown: '10:12 张三：退款要幂等\n10:13 李四：并发也只退一次' }),
    })
    const chatPayload = await chat.json()
    assert.equal(chat.status, 200)
    assert.equal(chatPayload.schema, 'alm.intake.chat/v1')
    assert.equal(chatPayload.messages.length, 2)
    assert.equal(chatPayload.messages[0].ref, 'chat.md#L1')

    const dir = mkdtempSync(join(tmpdir(), 'alm-ocr-http-'))
    const script = join(dir, 'fake-ocr.py')
    writeFileSync(script, `setTimeout(() => console.log(JSON.stringify({ engine: 'ppocrv5', lines: [{ text: '本地 OCR 文本', confidence: 0.9 }], blocks: [] })), 1000)`)
    const previousPython = process.env.DSH_OCR_PYTHON
    const previousScript = process.env.DSH_OCR_SCRIPT
    process.env.DSH_OCR_PYTHON = process.execPath
    process.env.DSH_OCR_SCRIPT = script
    try {
      let ocrFinished = false
      const pendingOcr = fetch(`${base}/api/alm/requirements/intake?root=${encodeURIComponent(fixture)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'ocr', filename: 'shot.png', imageBase64: Buffer.from('fake-image').toString('base64') }),
      }).then(response => { ocrFinished = true; return response })
      await new Promise(resolve => setTimeout(resolve, 200))
      const concurrentChat = await fetch(`${base}/api/alm/requirements/intake?root=${encodeURIComponent(fixture)}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'chat', markdown: '10:12 张三：并发检查' }),
      })
      assert.equal(concurrentChat.status, 200)
      assert.equal(ocrFinished, false)
      const ocr = await pendingOcr
      const ocrPayload = await ocr.json()
      assert.equal(ocr.status, 200)
      assert.equal(ocrPayload.schema, 'alm.ocr/v1')
      assert.equal(ocrPayload.lines[0].ref, 'shot.png#L1')
      assert.match(ocrPayload.text, /本地 OCR/)
    } finally {
      if (previousPython === undefined) delete process.env.DSH_OCR_PYTHON
      else process.env.DSH_OCR_PYTHON = previousPython
      if (previousScript === undefined) delete process.env.DSH_OCR_SCRIPT
      else process.env.DSH_OCR_SCRIPT = previousScript
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

test('disconnecting an OCR request terminates its process and cleans its image', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'alm-ocr-cancel-http-'))
  const script = join(dir, 'slow.cjs'), marker = join(dir, 'started.json')
  writeFileSync(script, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, JSON.stringify({pid:process.pid,image:process.argv[2]})); setTimeout(() => {}, 60000)`)
  const previousPython = process.env.DSH_OCR_PYTHON, previousScript = process.env.DSH_OCR_SCRIPT
  process.env.DSH_OCR_PYTHON = process.execPath
  process.env.DSH_OCR_SCRIPT = script
  try {
    await withWriteServer(fixture, async base => {
      const controller = new AbortController()
      const pending = fetch(`${base}/api/alm/requirements/intake?root=${encodeURIComponent(fixture)}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ mode: 'ocr', filename: 'shot.png', imageBase64: Buffer.from('image').toString('base64') }),
      })
      try {
        for (let i = 0; i < 100 && !existsSync(marker); i++) await new Promise(resolve => setTimeout(resolve, 20))
        assert.equal(existsSync(marker), true)
        const { pid, image } = JSON.parse(readFileSync(marker, 'utf8'))
        controller.abort()
        await assert.rejects(pending, { name: 'AbortError' })
        let exited = false
        for (let i = 0; i < 100; i++) {
          try { process.kill(pid, 0) } catch (error) { if (error.code === 'ESRCH') { exited = true; break } throw error }
          await new Promise(resolve => setTimeout(resolve, 20))
        }
        assert.equal(exited, true)
        for (let i = 0; i < 100 && existsSync(image); i++) await new Promise(resolve => setTimeout(resolve, 20))
        assert.equal(existsSync(image), false)
      } finally { controller.abort(); await pending.catch(() => {}) }
    })
  } finally {
    if (previousPython === undefined) delete process.env.DSH_OCR_PYTHON
    else process.env.DSH_OCR_PYTHON = previousPython
    if (previousScript === undefined) delete process.env.DSH_OCR_SCRIPT
    else process.env.DSH_OCR_SCRIPT = previousScript
    rmSync(dir, { recursive: true, force: true })
  }
})

test('POST /api/alm/requirements/create persists attachments and manifest', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'alm-create-attach-'))
  try {
    cpSync(fixture, dir, { recursive: true })
    await withWriteServer(dir, async (base) => {
      const response = await fetch(`${base}/api/alm/requirements/create?root=${encodeURIComponent(dir)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: '带原始材料的需求',
          brief: '来自聊天与截图',
          attachments: [
            { name: 'chat.md', kind: 'chat', text: '10:12 张三：退款要幂等' },
            { name: 'shot.png', kind: 'screenshot', dataBase64: Buffer.from('fake-png').toString('base64') },
          ],
          apply: true,
        }),
      })
      const payload = await response.json()
      assert.equal(response.status, 200)
      assert.equal(payload.applied, true)
      assert.equal(payload.attachments.length, 2)
      assert.ok(existsSync(join(dir, 'requirements/attachments/REQ-PAY-005/manifest.json')))
      assert.ok(existsSync(join(dir, 'requirements/attachments/REQ-PAY-005/chat.md')))
      const listed = await (await fetch(`${base}/api/alm/requirements?root=${encodeURIComponent(dir)}`)).json()
      const item = listed.requirements.find((entry) => entry.id === 'REQ-PAY-005')
      assert.equal(item.attachments, 2)
      assert.deepEqual(item.attachmentFiles.map((file) => file.name).sort(), ['chat.md', 'shot.png'])
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('POST /api/alm/requirements/ai-review generates, loads and adopts AI suggestions', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'alm-ai-review-http-'))
  const fakeAiStream = async function* () {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield {
      type: 'text-delta',
      index: 0,
      text: JSON.stringify({
        verdict: 'block',
        summary: '目标清楚，但验收场景不足。',
        findings: [{ title: '验收不足', severity: 'warn', detail: '缺少并发场景说明。', ref: 'COV-001' }],
        suggestions: [
          { id: 'S1', title: '补充并发验收', category: '验收', detail: '增加并发重复请求用例。', suggestedText: '并发两次同键请求只产生一张退款单。' },
          { id: 'S2', title: '补充边界', category: '范围', detail: '说明失败与重试。', suggestedText: '失败时保留幂等键。' },
        ],
        plan: [{ step: '补验收', detail: '新增 TEST 资产。' }],
        proposedBrief: '## 背景\n\n补齐并发与失败边界。',
      }),
    }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
  try {
    cpSync(fixture, dir, { recursive: true })
    await withWriteServer(
      dir,
      async (base) => {
        const generated = await fetch(`${base}/api/alm/requirements/ai-review?root=${encodeURIComponent(dir)}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ requirementId: 'REQ-PAY-001' }),
        })
        const report = await generated.json()
        assert.equal(generated.status, 200)
        assert.equal(report.schema, 'alm.ai-review/v1')
        assert.equal(report.provider, 'fake')
        assert.equal(report.suggestions.length, 2)
        assert.ok(existsSync(join(dir, '.alm/reviews/REQ-PAY-001.ai.json')))

        const loaded = await fetch(`${base}/api/alm/requirements/ai-review?root=${encodeURIComponent(dir)}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ requirementId: 'REQ-PAY-001', load: true }),
        })
        assert.equal((await loaded.json()).summary, '目标清楚，但验收场景不足。')

        const skipped = await fetch(`${base}/api/alm/requirements/ai-review?root=${encodeURIComponent(dir)}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ requirementId: 'REQ-PAY-001', apply: true, selectedSuggestionIds: [] }),
        })
        const skippedPayload = await skipped.json()
        assert.equal(skipped.status, 200)
        assert.equal(skippedPayload.applied, false)
        assert.equal(skippedPayload.skipped, true)
        assert.equal(skippedPayload.adopted, null)

        const adopted = await fetch(`${base}/api/alm/requirements/ai-review?root=${encodeURIComponent(dir)}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ requirementId: 'REQ-PAY-001', apply: true, selectedSuggestionIds: ['S1'], includeBrief: true }),
        })
        const adoptedPayload = await adopted.json()
        assert.equal(adopted.status, 200)
        assert.equal(adoptedPayload.aiVerdict, 'block')
        assert.equal(adoptedPayload.applied, true)
        assert.deepEqual(adoptedPayload.adopted.suggestionIds, ['S1'])
        const brief = readFileSync(join(dir, 'requirements/briefs/REQ-PAY-001.md'), 'utf8')
        assert.match(brief, /AI 优化建议（已采纳/)
        assert.match(brief, /补充并发验收/)
        assert.doesNotMatch(brief, /补充边界/)

        const listed = await (await fetch(`${base}/api/alm/requirements?root=${encodeURIComponent(dir)}`)).json()
        const item = listed.requirements.find((entry) => entry.id === 'REQ-PAY-001')
        assert.equal(item.aiReview.stored, true)
        assert.equal(item.aiReview.adopted.suggestionIds[0], 'S1')
      },
      { aiStream: fakeAiStream, aiProvider: 'fake', aiModel: 'fake-review' },
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('POST /api/alm/requirements/draft returns a candidate draft, never formal priority/owner', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'alm-draft-http-'))
  const fakeStream = async function* () {
    yield {
      type: 'text-delta',
      index: 0,
      text: JSON.stringify({
        title: '退款幂等与并发控制',
        brief: '## 背景\n\n退款重复提交。\n\n## 目标\n\n只退一次。\n\n## 范围外\n\n（待确认）\n\n## 关键决策\n\n幂等键。\n\n## 验收线索\n\n并发只产生一张单。',
        claim: '重复提交的退款请求只产生一张退款单',
        suggestedPriority: 'P0',
        rationale: '涉及资金一致性，建议 P0 待人工确认。',
        sourceRefs: ['#L1'],
        assumptions: ['调用方携带幂等键'],
        question: '重试是否复用同一幂等键？',
        counterexample: '上游每次重试换新幂等键时仍会重复退款（假设）。',
        acceptanceDraft: ['并发两次同键请求只产生一张退款单'],
        unknowns: ['影响范围待确认'],
      }),
    }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
  try {
    cpSync(fixture, dir, { recursive: true })
    await withWriteServer(
      dir,
      async (base) => {
        const response = await fetch(`${base}/api/alm/requirements/draft?root=${encodeURIComponent(dir)}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            intent: '退款老是重复退，财务对账麻烦，要保证只退一次',
            extractedText: '张三：退款重复退\n李四：只退一次',
            projectName: '支付平台',
          }),
        })
        const payload = await response.json()
        assert.equal(response.status, 200)
        assert.equal(payload.schema, 'alm.ai-draft/v1')
        assert.equal(payload.candidate, true)
        assert.equal(payload.title, '退款幂等与并发控制')
        // AI output is only a candidate: no formal priority/owner is filled.
        assert.equal(payload.priority, null)
        assert.equal(payload.owner, null)
        assert.equal(payload.suggestedPriority, 'P0')
        assert.deepEqual(
          payload.sourceRefs.map((ref) => ref.ref),
          ['#L1'],
        )
        assert.equal(payload.question, '重试是否复用同一幂等键？')
        assert.match(payload.brief, /## 验收线索/)
      },
      { aiStream: fakeStream, aiProvider: 'fake', aiModel: 'fake-draft' },
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
