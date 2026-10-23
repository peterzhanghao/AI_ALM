import test from 'node:test'
import assert from 'node:assert/strict'
import { AssetError } from '../../../src/model/asset.mjs'
import { parseYamlAsset } from '../../../src/parse/yaml.mjs'

const OPENAPI = `openapi: 3.0.3
info:
  title: Refund API
  version: 1.0.0
  x-alm-id: IF-PAY-REFUND-API
  x-alm-owner: team-payments
  x-alm-status: accepted
  x-alm-links:
    - type: constrained_by
      target: ADR-PAY-003
paths:
  /refunds:
    post:
      operationId: createRefund
`

test('an OpenAPI document becomes an interface asset', () => {
  const asset = parseYamlAsset(OPENAPI, 'architecture/refund-api.yml')
  assert.equal(asset.id, 'IF-PAY-REFUND-API')
  assert.equal(asset.type, 'interface')
  assert.equal(asset.title, 'Refund API')
  assert.equal(asset.status, 'accepted')
  assert.equal(asset.source.format, 'openapi')
  assert.equal(asset.extra.operationId, 'createRefund')
  assert.deepEqual(asset.links, [{ type: 'constrained_by', target: 'ADR-PAY-003', line: 10 }])
})

test('missing x-alm-id fails instead of inventing an id', () => {
  const text = OPENAPI.replace('  x-alm-id: IF-PAY-REFUND-API\n', '')
  assert.throws(() => parseYamlAsset(text, 'architecture/no-id.yml'), (error) => {
    assert.ok(error instanceof AssetError)
    assert.equal(error.rule, 'FMT-001')
    assert.match(error.message, /x-alm-id/)
    return true
  })
})

test('missing paths fails', () => {
  const text = OPENAPI.split('paths:')[0]
  assert.throws(() => parseYamlAsset(text, 'architecture/no-paths.yml'), /no paths object/)
})
