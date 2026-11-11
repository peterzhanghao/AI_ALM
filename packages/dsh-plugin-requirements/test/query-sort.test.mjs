import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { requirements, sortRequirements } from '../query.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const fixture = join(repoRoot, 'fixtures/order-refund')

const requirementDoc = (id, title) =>
  ['[DOCUMENT]', `TITLE: ${title}`, '', '[REQUIREMENT]', `UID: ${id}`, `TITLE: ${title}`, 'STATUS: proposed', 'OWNER: team-qa', ''].join('\n')

test('sortRequirements orders by creation time desc, then id desc', () => {
  const items = [
    { id: 'REQ-A-1', createdAt: '2026-01-01T00:00:00.000Z', occurrenceKey: 'a1' },
    { id: 'REQ-A-3', createdAt: '2026-03-01T00:00:00.000Z', occurrenceKey: 'a3' },
    { id: 'REQ-A-2', createdAt: '2026-02-01T00:00:00.000Z', occurrenceKey: 'a2' },
    { id: 'REQ-A-0', createdAt: null, occurrenceKey: 'a0' },
  ]
  assert.deepEqual(
    sortRequirements(items).map((item) => item.id),
    ['REQ-A-3', 'REQ-A-2', 'REQ-A-1', 'REQ-A-0'],
  )
  // Same instant: the higher id is the newer record.
  assert.deepEqual(
    sortRequirements([
      { id: 'REQ-A-2', createdAt: '2026-03-01T00:00:00.000Z', occurrenceKey: 'x' },
      { id: 'REQ-A-9', createdAt: '2026-03-01T00:00:00.000Z', occurrenceKey: 'y' },
    ]).map((item) => item.id),
    ['REQ-A-9', 'REQ-A-2'],
  )
  // Duplicate UIDs at the same instant keep a deterministic row order.
  assert.deepEqual(
    sortRequirements([
      { id: 'REQ-A-2', createdAt: '2026-03-01T00:00:00.000Z', occurrenceKey: 'b' },
      { id: 'REQ-A-2', createdAt: '2026-03-01T00:00:00.000Z', occurrenceKey: 'a' },
    ]).map((item) => item.occurrenceKey),
    ['a', 'b'],
  )
})

test('sortRequirements does not mutate the payload array', () => {
  const items = [
    { id: 'REQ-A-1', createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'REQ-A-2', createdAt: '2026-02-01T00:00:00.000Z' },
  ]
  const ordered = sortRequirements(items)
  assert.notEqual(ordered, items)
  assert.deepEqual(items.map((item) => item.id), ['REQ-A-1', 'REQ-A-2'])
  assert.deepEqual(ordered.map((item) => item.id), ['REQ-A-2', 'REQ-A-1'])
})

test('requirements payload carries createdAt newest first', () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-created-at-'))
  try {
    mkdirSync(join(root, 'requirements'), { recursive: true })
    // Creation order is the write order, so the second file is the newer
    // requirement. Ties resolve by id desc, which yields the same assertion.
    writeFileSync(join(root, 'requirements', 'first.sdoc'), requirementDoc('REQ-ALM-901', '先创建'))
    writeFileSync(join(root, 'requirements', 'second.sdoc'), requirementDoc('REQ-ALM-902', '后创建'))
    const payload = requirements(root)
    const created = payload.requirements.map((item) => item.createdAt)
    assert.equal(created.length, 2)
    for (const value of created) assert.match(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    assert.deepEqual(payload.requirements.map((item) => item.id), ['REQ-ALM-902', 'REQ-ALM-901'])
    assert.ok(Date.parse(created[0]) >= Date.parse(created[1]))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('every fixture requirement resolves a createdAt', () => {
  const payload = requirements(fixture)
  assert.ok(payload.requirements.length > 0)
  for (const item of payload.requirements) {
    assert.ok(item.createdAt, `${item.id} has no createdAt`)
    assert.ok(Number.isFinite(Date.parse(item.createdAt)), `${item.id} createdAt is not a date`)
  }
})
