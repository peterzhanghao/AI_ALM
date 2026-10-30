import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { requirements } from '../query.mjs'

const ORDER_REFUND = fileURLToPath(new URL('../../../fixtures/order-refund', import.meta.url))

test('requirements payload lists coverage and no gaps for the sample', () => {
  const payload = requirements(ORDER_REFUND)
  assert.equal(payload.schema, 'alm.requirements/v1')
  assert.equal(payload.result, 'pass')
  assert.equal(payload.requirements.length, 2)
  const first = payload.requirements.find((item) => item.id === 'REQ-PAY-001')
  const idempotent = payload.requirements.find((item) => item.id === 'REQ-PAY-004')
  assert.deepEqual(first.verifiedBy, ['TEST-PAY-001'])
  assert.deepEqual(idempotent.verifiedBy, ['TEST-PAY-004', 'TEST-PAY-005'])
  assert.equal(first.nextAction, 'ready-to-change')
  assert.equal(payload.summary.gaps, 0)
  assert.deepEqual(payload.gaps, [])
})

test('a missing root returns a structured error', () => {
  const payload = requirements(fileURLToPath(new URL('../../../fixtures/does-not-exist', import.meta.url)))
  assert.equal(payload.ok, false)
  assert.match(payload.error, /not a directory/)
})
