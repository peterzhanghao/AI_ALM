import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { startSidebarServer } from '../sidebar.mjs'

let server

before(async () => {
  server = await startSidebarServer({
    port: 0,
    handler: (request, response) => {
      const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
      if (path === '/alm/architecture') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        response.end('<!doctype html><title>ALM Architecture</title><p>MOD-PAY-REFUND</p>')
        return
      }
      if (path === '/api/alm/architecture') {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ schema: 'alm.architecture/v1' }))
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

test('architecture sidecar serves the page and JSON on its own port', async () => {
  const page = await fetch(`${server.origin}/alm/architecture`)
  assert.equal(page.status, 200)
  assert.match(await page.text(), /MOD-PAY-REFUND/)

  const api = await fetch(`${server.origin}/api/alm/architecture`)
  assert.equal((await api.json()).schema, 'alm.architecture/v1')
})

test('architecture sidecar answers unknown paths with 404', async () => {
  const response = await fetch(`${server.origin}/nope`)
  assert.equal(response.status, 404)
})
