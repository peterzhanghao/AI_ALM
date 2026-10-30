import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, test } from 'node:test'
import { servePages } from '../../../../scripts/lib/plugin-pages.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..')

let server

before(async () => {
  server = await servePages({ root: join(repoRoot, 'fixtures/order-refund') })
})

after(async () => {
  if (server) await server.close()
})

test('serves the requirements page from the live renderer', async () => {
  const response = await fetch(`${server.url}/alm/requirements`)
  const body = await response.text()
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type'), /text\/html/)
  assert.match(body, /REQ-PAY-001/)
  assert.match(body, /TEST-PAY-001/)
  assert.ok(body.includes('·'), 'summary uses the middle dot separator')
  assert.ok(!body.includes('路'), 'no mojibake separator')
})

test('serves the architecture page with all four node sections', async () => {
  const response = await fetch(`${server.url}/alm/architecture`)
  const body = await response.text()
  assert.equal(response.status, 200)
  for (const id of ['MOD-PAY-REFUND', 'ADR-PAY-003', 'IF-PAY-REFUND-API', 'DM-PAY-REFUND']) {
    assert.ok(body.includes(id), `${id} missing from the architecture page`)
  }
})

test('serves JSON payloads the pages link to', async () => {
  const requirements = await (await fetch(`${server.url}/api/alm/requirements`)).json()
  const architecture = await (await fetch(`${server.url}/api/alm/architecture`)).json()
  assert.equal(requirements.schema, 'alm.requirements/v1')
  assert.equal(architecture.schema, 'alm.architecture/v1')
  assert.ok(requirements.requirements.some((item) => item.id === 'REQ-PAY-001'))
  assert.ok(requirements.requirements.some((item) => item.id === 'REQ-PAY-004'))
})

test('unknown routes return 404', async () => {
  const response = await fetch(`${server.url}/alm/unknown`)
  assert.equal(response.status, 404)
})
