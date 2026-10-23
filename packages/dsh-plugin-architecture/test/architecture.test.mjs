import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { architecture } from '../query.mjs'

const ORDER_REFUND = fileURLToPath(new URL('../../../fixtures/order-refund', import.meta.url))

test('architecture payload lists nodes, edges and impact counts', () => {
  const payload = architecture(ORDER_REFUND)
  assert.equal(payload.schema, 'alm.architecture/v1')
  assert.equal(payload.result, 'pass')
  assert.equal(payload.modules.length, 1)
  assert.equal(payload.decisions[0].id, 'ADR-PAY-003')
  assert.equal(payload.interfaces[0].id, 'IF-PAY-REFUND-API')
  assert.equal(payload.dataModels[0].id, 'DM-PAY-REFUND')
  assert.equal(payload.summary.nodes, 4)
  assert.equal(payload.summary.edges, 4)
  assert.equal(payload.impact['ADR-PAY-003'], 5)
  assert.deepEqual(payload.gaps, [])
})

test('edges are deterministic and carry relation types', () => {
  const payload = architecture(ORDER_REFUND)
  assert.deepEqual(
    payload.edges.map((edge) => `${edge.from}->${edge.to}:${edge.type}`),
    [
      'DM-PAY-REFUND->ADR-PAY-003:constrained_by',
      'IF-PAY-REFUND-API->ADR-PAY-003:constrained_by',
      'MOD-PAY-REFUND->ADR-PAY-003:constrained_by',
      'MOD-PAY-REFUND->IF-PAY-REFUND-API:depends_on',
    ],
  )
})

test('a missing root returns a structured error', () => {
  const payload = architecture(fileURLToPath(new URL('../../../fixtures/nope', import.meta.url)))
  assert.equal(payload.ok, false)
  assert.match(payload.error, /not a directory/)
})
