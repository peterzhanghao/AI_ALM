import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')
const start = source.indexOf('    function deliveryOf(')
const end = source.indexOf('    const REL_LABELS', start)
const context = vm.createContext({})
vm.runInContext(source.slice(start, end) + '\nthis.matchesView = matchesView', context)

test('views distinguish pending work and include closed in all', () => {
  for (const key of ['pending', 'in-progress', 'awaiting-acceptance', 'accepted', 'closed']) {
    assert.equal(context.matchesView({ delivery: { key } }, 'pending'), key === 'pending', key)
    assert.equal(context.matchesView({ delivery: { key } }, 'all'), true, key)
  }
})

test('mine (待我处理) is the initial and project-switch default', () => {
  assert.match(source, /const DEFAULT_REQUIREMENT_VIEW = 'mine'/)
  assert.match(source, /useState\(\(\) => readV4Navigation\(\)\.filter \?\? DEFAULT_REQUIREMENT_VIEW\)/)
  assert.match(source, /const applyProject = \(id\) => \{\s*setSelectedId\(null\)\s*setFilter\(DEFAULT_REQUIREMENT_VIEW\)/)
  // 待我处理 means human work, not every open requirement: an in-progress run
  // without a question stays out, while a pending acceptance lands in it.
  assert.equal(context.matchesView({ delivery: { key: 'in-progress' } }, 'mine'), false)
  assert.equal(context.matchesView({ delivery: { key: 'awaiting-acceptance' } }, 'mine'), true)
  assert.equal(context.matchesView({ delivery: { key: 'closed' }, detailView: { question: 'q' } }, 'mine'), false)
})

test('a saved pre-upgrade navigation cannot mask the 待我处理 default', () => {
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
