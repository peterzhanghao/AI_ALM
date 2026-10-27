import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import RequirementsService from '../index.js'
import { startSidebarServer } from '../sidebar.mjs'

let server

before(async () => {
  server = await startSidebarServer({
    port: 0,
    handler: (request, response) => {
      const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
      if (path === '/alm/requirements') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        response.end('<!doctype html><title>ALM Requirements</title><p>REQ-PAY-001</p>')
        return
      }
      if (path === '/api/alm/requirements') {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ schema: 'alm.requirements/v1' }))
        return
      }
      response.writeHead(404, { 'content-type': 'text/plain' })
      response.end('not found')
    },
  })
})

after(async () => {
  await server?.close()
})

test('sidecar server serves the page and JSON on its own port', async () => {
  assert.match(server.origin, /^http:\/\/127\.0\.0\.1:\d+$/)
  assert.notEqual(server.port, 0)

  const page = await fetch(`${server.origin}/alm/requirements`)
  assert.equal(page.status, 200)
  assert.match(await page.text(), /REQ-PAY-001/)

  const api = await fetch(`${server.origin}/api/alm/requirements`)
  assert.equal(api.status, 200)
  assert.equal((await api.json()).schema, 'alm.requirements/v1')
})

test('sidecar server answers unknown paths with 404', async () => {
  const response = await fetch(`${server.origin}/nope`)
  assert.equal(response.status, 404)
})

test('sidecar server falls back to an ephemeral port when the preferred one is taken', async () => {
  const blocking = await startSidebarServer({ port: 0, handler: (_request, response) => response.end('x') })
  try {
    const fallback = await startSidebarServer({ port: blocking.port, handler: (_request, response) => response.end('y') })
    assert.notEqual(fallback.port, blocking.port)
    assert.match(fallback.origin, /^http:\/\/127\.0\.0\.1:\d+$/)
    await fallback.close()
  } finally {
    await blocking.close()
  }
})

test('the plugin wires the sidecar listener and points the page at it', async () => {
  const disposers = []
  const ctx = {
    effect(callback) {
      disposers.push(callback())
    },
    webServer: { register: () => () => {} },
    tools: { register: () => () => {} },
  }

  const plugin = new RequirementsService(ctx, { sidebarPort: 0 })
  try {
    const deadline = Date.now() + 2000
    while (!plugin.sidecarOrigin && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10))
    assert.ok(plugin.sidecarOrigin, 'plugin did not start its sidecar listener')

    const page = await fetch(`${plugin.sidecarOrigin}/alm/requirements`)
    assert.equal(page.status, 200)
    const html = await page.text()
    assert.match(html, /ALM Requirements/)
    assert.ok(html.includes(`Sidebar browser:`))
    assert.ok(html.includes(plugin.sidecarOrigin))

    const api = await fetch(`${plugin.sidecarOrigin}/api/alm/requirements`)
    assert.equal((await api.json()).schema, 'alm.requirements/v1')
  } finally {
    for (const dispose of disposers) dispose()
  }
})
