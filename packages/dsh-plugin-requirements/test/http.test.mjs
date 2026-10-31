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
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

async function withWriteServer(root, run) {
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
  new RequirementsService(ctx, { root })
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

test('POST /api/alm/requirements/review and signoff persist a human review', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'alm-review-http-'))
  try {
    cpSync(fixture, dir, { recursive: true })
    await withWriteServer(dir, async (base) => {
      const preview = await fetch(`${base}/api/alm/requirements/review?root=${encodeURIComponent(dir)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requirementId: 'REQ-PAY-001' }),
      })
      const plan = await preview.json()
      assert.equal(preview.status, 200)
      assert.equal(plan.schema, 'alm.review/v1')
      assert.equal(plan.source, 'executor')
      assert.equal(plan.applied, false)
      assert.ok(!existsSync(join(dir, '.alm', 'reviews', 'REQ-PAY-001.json')))

      const applied = await fetch(`${base}/api/alm/requirements/review?root=${encodeURIComponent(dir)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requirementId: 'REQ-PAY-001', apply: true }),
      })
      assert.equal((await applied.json()).applied, true)
      assert.ok(existsSync(join(dir, '.alm', 'reviews', 'REQ-PAY-001.json')))

      const badActor = await fetch(`${base}/api/alm/requirements/signoff?root=${encodeURIComponent(dir)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requirementId: 'REQ-PAY-001', actor: 'agent:bot' }),
      })
      assert.equal(badActor.status, 400)
      assert.equal((await badActor.json()).error.code, 'invalid-actor')

      const signed = await fetch(`${base}/api/alm/requirements/signoff?root=${encodeURIComponent(dir)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requirementId: 'REQ-PAY-001', actor: 'human:tester', apply: true }),
      })
      const signoff = await signed.json()
      assert.equal(signed.status, 200)
      assert.equal(signoff.applied, true)
      assert.equal(signoff.signoff.actor, 'human:tester')

      const payload = await (await fetch(`${base}/api/alm/requirements?root=${encodeURIComponent(dir)}`)).json()
      const item = payload.requirements.find((entry) => entry.id === 'REQ-PAY-001')
      assert.equal(item.review.stored, true)
      assert.equal(item.review.signoffValid, true)
      assert.equal(item.review.signoff.actor, 'human:tester')
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
    writeFileSync(script, `console.log(JSON.stringify({ engine: 'ppocrv5', lines: [{ text: '本地 OCR 文本', confidence: 0.9 }], blocks: [] }))`)
    const previousPython = process.env.DSH_OCR_PYTHON
    const previousScript = process.env.DSH_OCR_SCRIPT
    process.env.DSH_OCR_PYTHON = process.execPath
    process.env.DSH_OCR_SCRIPT = script
    try {
      const ocr = await fetch(`${base}/api/alm/requirements/intake?root=${encodeURIComponent(fixture)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'ocr', filename: 'shot.png', imageBase64: Buffer.from('fake-image').toString('base64') }),
      })
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
