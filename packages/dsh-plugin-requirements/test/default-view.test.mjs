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

test('all is the initial and project-switch default', () => {
  assert.match(source, /const DEFAULT_REQUIREMENT_VIEW = 'all'/)
  assert.match(source, /const applyProject = \(id\) => \{\s*setSelectedId\(null\)\s*setFilter\(DEFAULT_REQUIREMENT_VIEW\)/)
  assert.equal(context.matchesView({ delivery: { key: 'in-progress' } }, 'pending'), false)
})
