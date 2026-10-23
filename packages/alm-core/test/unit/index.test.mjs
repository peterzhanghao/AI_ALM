import test from 'node:test'
import assert from 'node:assert/strict'
import { buildIndex } from '../../src/index/index.mjs'
import { normalizeAsset } from '../../src/model/asset.mjs'

function asset(id, path, type = 'requirement', links = []) {
  return normalizeAsset(
    { schema_version: 1, id, type, title: id, status: 'proposed', owner: 'team', links },
    { path, format: 'yaml', line: 1 },
  )
}

test('indexes by id and type', () => {
  const index = buildIndex([asset('REQ-PAY-001', 'a.yml'), asset('MOD-PAY-001', 'b.yml', 'module')])
  assert.equal(index.byId.get('REQ-PAY-001').source.path, 'a.yml')
  assert.equal(index.byType.get('module').length, 1)
  assert.equal(index.duplicates.length, 0)
})

test('keeps every duplicate occurrence', () => {
  const index = buildIndex([asset('REQ-PAY-001', 'a.yml'), asset('REQ-PAY-001', 'b.yml')])
  assert.equal(index.duplicates.length, 1)
  assert.equal(index.duplicates[0].id, 'REQ-PAY-001')
  assert.deepEqual(
    index.duplicates[0].occurrences.map((entry) => entry.source.path),
    ['a.yml', 'b.yml'],
  )
})
