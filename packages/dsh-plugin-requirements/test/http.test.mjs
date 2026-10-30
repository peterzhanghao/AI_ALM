import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import RequirementsService from '../index.js'

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
