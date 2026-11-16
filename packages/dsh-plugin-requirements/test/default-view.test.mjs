import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')
const start = source.indexOf('    function deliveryOf(')
const end = source.indexOf('    const REL_LABELS', start)
const context = vm.createContext({})
vm.runInContext(source.slice(start, end) + '\nthis.matchesView = matchesView\nthis.sortForView = sortForView', context)

test('待办 is the whole open funnel and 已归档 collects both terminal deliveries', () => {
  for (const key of ['pending', 'in-progress', 'awaiting-acceptance']) {
    assert.equal(context.matchesView({ delivery: { key } }, 'todo'), true, key)
    assert.equal(context.matchesView({ delivery: { key } }, 'archived'), false, key)
  }
  for (const key of ['accepted', 'closed']) {
    assert.equal(context.matchesView({ delivery: { key } }, 'todo'), false, key)
    assert.equal(context.matchesView({ delivery: { key } }, 'archived'), true, key)
  }
  // A retired view id still resolves to its rows, so a session written by the
  // previous version shows what it names instead of an empty list.
  assert.equal(context.matchesView({ delivery: { key: 'closed' } }, 'closed'), true)
  assert.equal(context.matchesView({ delivery: { key: 'pending' } }, 'pending'), true)
})

test('the tab bar names work funnels, not delivery stages', () => {
  const filters = vm.runInNewContext(
    source.slice(source.indexOf('    const FILTERS = ['), source.indexOf('    // Each tab has to say')) + '\nFILTERS',
  )
  assert.deepEqual(
    Array.from(filters, ([id]) => id),
    ['todo', 'awaiting', 'archived', 'anomalies'],
  )
  // 待我处理 used to sit next to 待办 and contain a subset of the same rows, so
  // the same work had two tabs. It is gone from the bar, not renamed.
  for (const retired of ['mine', 'pending', 'running', 'accepted', 'closed', 'all']) {
    assert.equal(filters.some(([id]) => id === retired), false, retired)
  }
})

test('the retired 待我处理 view still resolves for an old session', () => {
  // A persisted navigation state from the previous version names `mine`; the
  // tab is gone, but the filter must still describe rows, not crash or blank.
  assert.equal(context.matchesView({ delivery: { key: 'pending' }, requiresHuman: true }, 'mine'), true)
  assert.equal(context.matchesView({ delivery: { key: 'in-progress' } }, 'mine'), false)
  assert.equal(context.matchesView({ delivery: { key: 'awaiting-acceptance' } }, 'mine'), true)
  // Retiring a tab invalidates the stored navigation so the list reopens on
  // 待办 instead of a filter no tab can highlight.
  assert.match(source, /const NAVIGATION_VERSION = 7/)
})

test('待办 is the initial and project-switch default', () => {
  assert.match(source, /const DEFAULT_REQUIREMENT_VIEW = 'todo'/)
  assert.match(source, /useState\(\(\) => readV4Navigation\(\)\.filter \?\? DEFAULT_REQUIREMENT_VIEW\)/)
  assert.match(source, /const applyProject = \(id\) => \{\s*setSelectedId\(null\)\s*setFilter\(DEFAULT_REQUIREMENT_VIEW\)/)
})

test('待办 opens on 需要我优先, then on the row that has waited longest', () => {
  const daysAgo = (days) => new Date(Date.now() - days * 86400000).toISOString()
  const items = [
    { id: 'REQ-RUN', delivery: { key: 'in-progress' }, updatedAt: daysAgo(0) },
    { id: 'REQ-NEW-PENDING', delivery: { key: 'pending' }, createdAt: daysAgo(0.1) },
    { id: 'REQ-OLD-PENDING', delivery: { key: 'pending' }, createdAt: daysAgo(9) },
    { id: 'REQ-ACCEPT', delivery: { key: 'awaiting-acceptance' }, updatedAt: daysAgo(1) },
    { id: 'REQ-DECIDE', delivery: { key: 'pending' }, requiresHuman: true, updatedAt: daysAgo(2) },
    { id: 'REQ-DONE', delivery: { key: 'accepted' }, updatedAt: daysAgo(0.2) },
  ]
  assert.deepEqual(
    Array.from(context.sortForView(items, 'todo'), (item) => item.id),
    ['REQ-ACCEPT', 'REQ-DECIDE', 'REQ-RUN', 'REQ-OLD-PENDING', 'REQ-DONE', 'REQ-NEW-PENDING'],
  )
  // History reads newest first: an archive is a ledger, not a queue.
  assert.deepEqual(
    Array.from(context.sortForView(items.filter((item) => item.delivery.key === 'accepted'), 'archived'), (item) => item.id),
    ['REQ-DONE'],
  )
  assert.deepEqual(
    Array.from(context.sortForView([
      { id: 'REQ-A', delivery: { key: 'closed' }, updatedAt: daysAgo(6) },
      { id: 'REQ-B', delivery: { key: 'accepted' }, updatedAt: daysAgo(1) },
    ], 'archived'), (item) => item.id),
    ['REQ-B', 'REQ-A'],
  )
})

test('a saved pre-upgrade navigation cannot mask the 待办 default', () => {
  const version = source.match(/const NAVIGATION_VERSION = (\d+)/)?.[0]
  assert.ok(version, 'navigation schema version is declared')
  assert.match(source, /viewVersion: NAVIGATION_VERSION/)
  const start = source.indexOf('    function readV4Navigation() {')
  const end = source.indexOf('    async function saveExchangeFile', start)
  assert.ok(start > 0 && end > start)
  const storage = { value: JSON.stringify({ filter: 'all', source: 'all', keyword: '' }) }
  const context = vm.createContext({ sessionStorage: { getItem: () => storage.value } })
  vm.runInContext(`${version}\n${source.slice(start, end)}\nthis.read = readV4Navigation`, context)
  // The old 'all' default was persisted on first paint, not chosen by a human.
  assert.equal(context.read().filter, undefined)
  assert.equal(context.read().keyword, '')
  storage.value = JSON.stringify({ filter: 'awaiting', viewVersion: Number(version.split('=')[1]) })
  assert.equal(context.read().filter, 'awaiting')
})
