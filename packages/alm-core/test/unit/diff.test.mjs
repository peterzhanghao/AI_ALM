import test from 'node:test'
import assert from 'node:assert/strict'
import { diffAssets } from '../../src/diff/diff.mjs'
import { normalizeAsset } from '../../src/model/asset.mjs'

function asset(id, type, title, status, links = [], path = `${id}.yml`) {
  return normalizeAsset(
    { schema_version: 1, id, type, title, status, owner: 'team-demo', links },
    { path, format: 'yaml', line: 1 },
  )
}

test('diff reports added, removed and field-level changes', () => {
  const base = [
    asset('REQ-A-001', 'requirement', '旧标题', 'proposed', [{ type: 'allocated_to', target: 'MOD-A-001' }]),
    asset('RISK-A-001', 'risk', '旧风险', 'proposed'),
  ]
  const head = [
    asset('REQ-A-001', 'requirement', '新标题', 'accepted', [{ type: 'allocated_to', target: 'MOD-A-002' }]),
    asset('ADR-A-001', 'architecture-decision', '新决策', 'proposed'),
  ]

  const result = diffAssets(base, head)
  assert.deepEqual(result.summary, { added: 1, removed: 1, changed: 1 })
  assert.deepEqual(result.added, [{ id: 'ADR-A-001', type: 'architecture-decision' }])
  assert.deepEqual(result.removed, [{ id: 'RISK-A-001', type: 'risk' }])

  const changed = result.changed[0]
  assert.equal(changed.id, 'REQ-A-001')
  assert.deepEqual(
    changed.fields.map((field) => field.field),
    ['status', 'title'],
  )
  assert.deepEqual(changed.links, {
    added: ['allocated_to MOD-A-002'],
    removed: ['allocated_to MOD-A-001'],
  })
})

test('diff is empty for identical asset sets and ignores ordering', () => {
  const one = asset('REQ-A-001', 'requirement', 'x', 'proposed')
  const two = asset('MOD-A-001', 'module', 'm', 'accepted')
  const result = diffAssets([one, two], [two, one])
  assert.deepEqual(result.summary, { added: 0, removed: 0, changed: 0 })
})
