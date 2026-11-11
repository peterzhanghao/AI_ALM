import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import RequirementsService from '../index.js'
import { decodeRequirementsXlsx, encodeRequirementsXlsx } from '../../alm-core/src/requirements/exchange-xlsx.mjs'

test('exchange real HTTP JSON/XLSX export, preview, CAS apply and security boundaries', async () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-run007-http-'))
  cpSync(resolve('fixtures/order-refund'), root, { recursive: true })
  const routes = new Map()
  // Exercise the host Connection boundary, not the explicit no-Connection local mode.
  const connection = { admit: ({ headers }) => {
    if (headers.authorization === 'Bearer test-owner') return { peer: { principal: { kind: 'owner' } } }
    if (headers.authorization === 'Bearer test-human') return { peer: { principal: { kind: 'human', id: 'human:tester' } } }
    if (headers.authorization === 'Bearer test-agent') return { peer: { principal: { kind: 'agent', id: 'agent:tester' } } }
    if (headers.authorization === 'Bearer test-empty') return { peer: {} }
    return { rejection: 401 }
  } }
  new RequirementsService({ effect: fn => fn(), get: name => name === 'connection' ? connection : null, webServer: { register: r => { routes.set(r.path, r.handler); return () => {} } }, tools: { register: () => () => {} } }, { root })
  const server = createServer((req, res) => routes.get(new URL(req.url, 'http://localhost').pathname)?.(req, res) ?? undefined)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const url = `${base}/api/alm/requirements/exchange?root=${encodeURIComponent(root)}`
  const post = async (body, headers = {}) => { const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer test-owner', ...headers }, body: JSON.stringify(body) }); return { status: res.status, body: await res.json() } }
  const snapshot = () => {
    const files = []
    const visit = dir => { for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) visit(path)
      else files.push([path.slice(root.length), createHash('sha256').update(readFileSync(path)).digest('hex')])
    } }
    visit(root)
    return files
  }
  const denied = async requests => {
    const before = snapshot()
    for (const request of requests) {
      // An absent credential, a forged body identity, an agent and a missing
      // principal must all fail before exchange validation or filesystem writes.
      for (const [authorization, actor, status] of [
        ['', undefined, 401], ['', 'human:local', 401],
        ['Bearer test-agent', 'human:local', 403], ['Bearer test-empty', 'human:local', 403],
      ]) {
        const result = await post({ ...request, ...(actor ? { actor } : {}) }, { authorization, origin: base })
        assert.equal(result.status, status, JSON.stringify(result))
        assert.equal(result.body.ok, false)
        assert.match(result.body.error.code, /^(unauthenticated|untrusted)-subject$/)
        assert.deepEqual(snapshot(), before)
      }
    }
  }
  try {
    await denied([{ action: 'export', format: 'json' }, { action: 'initialize' }, { action: 'preview', format: 'json' }, { action: 'apply', format: 'json' }])
    assert.equal((await fetch(url)).status, 405)
    assert.equal((await post({ action: 'export', format: 'pdf' })).status, 415)
    assert.equal((await post({ action: 'export', format: 'json' }, { origin: 'http://evil.invalid' })).status, 403)
    assert.equal((await post({ action: 'export', format: 'json', status: 'signed' })).status, 400)
    const uninitialized = await post({ action: 'export', format: 'json' })
    assert.equal(uninitialized.status, 409)
    assert.equal(uninitialized.body.error.code, 'exchange-uninitialized')
    assert.equal((await post({ action: 'initialize', format: 'json' })).status, 400)
    const initialized = await post({ action: 'initialize' })
    assert.equal(initialized.status, 200, JSON.stringify(initialized.body))
    const key = readFileSync(join(root, '.alm/exchange/key'))
    assert.equal((await post({ action: 'initialize' })).status, 200)
    assert.deepEqual(readFileSync(join(root, '.alm/exchange/key')), key)
    for (const format of ['json', 'xlsx']) {
      const exported = await post({ action: 'export', format })
      assert.equal(exported.status, 200, JSON.stringify(exported.body))
      const bytes = Buffer.from(exported.body.content, 'base64')
      const payload = format === 'json' ? JSON.parse(bytes) : decodeRequirementsXlsx(bytes)
      payload.records[0].values.title += ` ${format}中文HTTP`
      const input = { format, filename: exported.body.filename, content: (format === 'json' ? Buffer.from(JSON.stringify(payload)) : encodeRequirementsXlsx(payload)).toString('base64') }
      await denied([{ action: 'export', format }, { action: 'initialize' }, { action: 'preview', ...input }, { action: 'apply', ...input, expectedLocalHash: 'forged' }])
      const before = readFileSync(join(root, 'requirements/refund.sdoc'), 'utf8')
      const preview = await post({ action: 'preview', ...input }, { authorization: 'Bearer test-human' })
      assert.equal(preview.status, 200, JSON.stringify(preview.body))
      assert.equal(preview.body.ok, true)
      assert.equal(readFileSync(join(root, 'requirements/refund.sdoc'), 'utf8'), before)
      const stale = await post({ action: 'apply', ...input, expectedLocalHash: 'stale' })
      assert.notEqual(stale.status, 200)
      assert.equal(readFileSync(join(root, 'requirements/refund.sdoc'), 'utf8'), before)
      const applied = await post({ action: 'apply', ...input, expectedLocalHash: preview.body.localHash })
      assert.equal(applied.status, 200, JSON.stringify(applied.body))
      assert.equal(applied.body.applied, true)
      const repeat = await post({ action: 'preview', ...input })
      const again = await post({ action: 'apply', ...input, expectedLocalHash: repeat.body.localHash })
      assert.equal(again.body.idempotent, true)
    }
    assert.equal((await post({ action: 'preview', format: 'json', filename: 'bad.json', content: '!!!!' })).status, 400)
  } finally { await new Promise(resolve => server.close(resolve)); rmSync(root, { recursive: true, force: true }) }
})
