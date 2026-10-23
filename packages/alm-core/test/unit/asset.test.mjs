import test from 'node:test'
import assert from 'node:assert/strict'
import { AssetError, normalizeAsset } from '../../src/model/asset.mjs'

const source = { path: 'REQ-X-001.yml', format: 'yaml', line: 1 }

function valid(overrides = {}) {
  return {
    schema_version: 1,
    id: 'REQ-PAY-001',
    type: 'requirement',
    title: '支持部分退款',
    status: 'proposed',
    owner: 'team-payments',
    links: [{ type: 'allocated_to', target: 'MOD-PAY-001' }],
    ...overrides,
  }
}

test('normalizes a valid asset and keeps extra fields', () => {
  const asset = normalizeAsset(valid({ priority: 'P0' }), source)
  assert.equal(asset.id, 'REQ-PAY-001')
  assert.deepEqual(asset.links, [{ type: 'allocated_to', target: 'MOD-PAY-001' }])
  assert.equal(asset.extra.priority, 'P0')
  assert.equal(asset.source.path, 'REQ-X-001.yml')
})

test('rejects a missing required field with FMT-002', () => {
  const raw = valid()
  delete raw.owner
  assert.throws(() => normalizeAsset(raw, source), (error) => {
    assert.ok(error instanceof AssetError)
    assert.equal(error.rule, 'FMT-002')
    assert.match(error.message, /owner/)
    return true
  })
})

test('accepts a mismatched id prefix; ID-002 owns that decision', () => {
  const asset = normalizeAsset(valid({ id: 'ADR-PAY-001' }), source)
  assert.equal(asset.id, 'ADR-PAY-001')
  assert.equal(asset.type, 'requirement')
})

test('rejects unknown link types', () => {
  assert.throws(
    () => normalizeAsset(valid({ links: [{ type: 'relates_to', target: 'MOD-PAY-001' }] }), source),
    /unknown link type/,
  )
})

test('rejects an unknown status', () => {
  assert.throws(() => normalizeAsset(valid({ status: 'draft' }), source), /unknown status/)
})
