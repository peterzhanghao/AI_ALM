import test from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
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


test('GET /api/alm/projects lists the repository project', async () => {
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
    assert.ok(payload.projects.some((project) => project.id === 'PAY' && project.root))
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('GET /api/alm/requirements?project=ALL aggregates registry projects', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'alm-all-'))
  const registry = join(dir, 'projects.json')
  writeFileSync(registry, JSON.stringify({ schema: 'alm.projects/v1', projects: [{ id: 'PAY', root: fixture }] }))
  const previous = process.env.DSH_ALM_REGISTRY
  process.env.DSH_ALM_REGISTRY = registry

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
    if (previous === undefined) delete process.env.DSH_ALM_REGISTRY
    else process.env.DSH_ALM_REGISTRY = previous
    rmSync(dir, { recursive: true, force: true })
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
