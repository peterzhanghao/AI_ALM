import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { check, index, query, show } from '../service.mjs'

const SMOKE = fileURLToPath(new URL('../../../fixtures/smoke', import.meta.url))

test('index exposes the shared report shape', () => {
  const report = index(SMOKE)
  assert.equal(report.schema, 'alm.index/v1')
  assert.equal(report.assets.length, 3)
  assert.equal(report.errors.length, 0)
})

test('show returns one asset and a structured not-found error', () => {
  const found = show(SMOKE, 'REQ-SMK-001')
  assert.equal(found.schema, 'alm.show/v1')
  assert.equal(found.asset.type, 'requirement')

  const missing = show(SMOKE, 'REQ-NOPE-999')
  assert.equal(missing.ok, false)
  assert.equal(missing.notFound, true)
  assert.match(missing.error, /not found/)
})

test('query filters by type and owner', () => {
  const modules = query(SMOKE, { type: 'module' })
  assert.equal(modules.schema, 'alm.query/v1')
  assert.deepEqual(
    modules.assets.map((asset) => asset.id),
    ['MOD-SMK-001'],
  )
  assert.equal(query(SMOKE, { owner: 'team-qa' }).assets.length, 1)
  assert.deepEqual(query(SMOKE, { type: undefined }).filter, {})
})

test('check returns the same verdict as the CLI', () => {
  const report = check(SMOKE)
  assert.equal(report.schema, 'alm.check/v1')
  assert.equal(report.result, 'pass')
  assert.equal(report.rules.packVersion, '1.1.0')
})
