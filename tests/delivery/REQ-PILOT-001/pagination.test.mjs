import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = process.env.DSH_CANDIDATE_ROOT ?? fileURLToPath(new URL('../../../', import.meta.url))
const require = createRequire(join(root, 'package.json'))
const paginate = require('./src/pilot/pagination.cjs')
const rows = Array.from({ length: 45 }, (_, id) => ({ id }))

test('45 items span three pages of 20, 20 and 5', () => {
  assert.deepEqual([1, 2, 3].map((page) => paginate(rows, { page }).items.length), [20, 20, 5])
})

test('pagination preserves every item exactly once in source order', () => {
  const ids = [1, 2, 3].flatMap((page) => paginate(rows, { page }).items.map((item) => item.id))
  assert.deepEqual(ids, rows.map((item) => item.id))
})

test('changing a filter resets the selected page to one', () => {
  const result = paginate(rows, { page: 3, filter: (item) => item.id < 5 })
  assert.equal(result.page, 1)
  assert.deepEqual(result.items.map((item) => item.id), [0, 1, 2, 3, 4])
})

test('empty and last pages expose the correct navigation state', () => {
  assert.deepEqual(paginate([], { page: 1 }), {
    items: [], page: 1, pageCount: 0, hasPrevious: false, hasNext: false
  })
  const last = paginate(rows, { page: 3 })
  assert.equal(last.hasPrevious, true)
  assert.equal(last.hasNext, false)
  assert.equal(last.pageCount, 3)
})
