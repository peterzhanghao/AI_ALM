import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')
const extract = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)))

test('view labels count: anomalies share the view axis rather than a fourth restriction', () => {
  assert.match(source, /\['anomalies', '数据异常'\]/)
  assert.doesNotMatch(source, /\[anomalyOnly, setAnomalyOnly\]/)
  assert.doesNotMatch(source, /setAnomalyOnly\(/)
  // The view decides which rows exist, then the default order decides which row
  // is read first. Both are single expressions, so neither can drift silently.
  assert.match(source, /const visible = sortForMode\(searched, sortMode, filter\)/)
  assert.match(source, /anomalyOnly: filter === 'anomalies'/)
  const handler = source.match(/onToggleOnly: (\(\) => setFilter\(\(value\) => value === 'anomalies' \? DEFAULT_REQUIREMENT_VIEW : 'anomalies'\))/)?.[1]
  assert.ok(handler, 'anomaly shortcut selects the existing view axis')
  let view = 'archived'
  const toggle = vm.runInNewContext(handler, { setFilter: updater => { view = updater(view) }, DEFAULT_REQUIREMENT_VIEW: 'todo' })
  toggle()
  assert.equal(view, 'anomalies')
  toggle()
  assert.equal(view, 'todo')
})

test('anomaly view shows affected records and excludes clean ones without changing source or keyword', () => {
  const context = vm.createContext({})
  vm.runInContext(extract('    function deliveryOf(', '    const REL_LABELS') + '\nthis.matches = matchesView', context)
  for (const key of ['pending', 'accepted', 'closed']) {
    assert.equal(context.matches({ delivery: { key }, anomalies: [{}] }, 'anomalies'), true)
    assert.equal(context.matches({ delivery: { key }, anomalies: [] }, 'anomalies'), false)
  }
  assert.equal(context.matches({}, 'anomalies'), false)
  assert.match(source, /const scopeItems = scopedItems/)
})

test('production pipeline intersects anomaly view, source and keyword without dropping records', () => {
  const records = [
    { id: 'REQ-5', title: 'Needle closed defect', sources: ['defect'], closed: true, anomalies: [{}] },
    { id: 'REQ-4', title: 'Needle manual', sources: [], anomalies: [{}] },
    { id: 'REQ-3', title: 'Other defect', sources: ['defect'], anomalies: [{}] },
    { id: 'REQ-2', title: 'Needle clean defect', sources: ['defect'], anomalies: [] },
    { id: 'REQ-1', title: 'Needle open defect', sources: ['defect'], anomalies: [{}] },
  ]
  const context = vm.createContext({
    scopedItems: records, data: { requirements: records }, keyword: '  NEEDLE ',
    filter: 'anomalies', source: 'defect', root: '', DEFAULT_REQUIREMENT_VIEW: 'todo', sortMode: 'need',
  })
  vm.runInContext(
    extract('    function isDefect(', '    /** `item.defect`') +
    extract('    function isFeedbackSource(', '    // ---- Feedback:') +
    extract('    function deliveryOf(', '    const REL_LABELS') +
    extract('    const FILTERS = [', '    // Each tab') +
    extract('    function requirementViewCounts(', '    function useRequirements('), context)
  const pipeline = extract('      const needle = keyword.trim()', '      const clearFilters =')
  const visibleIds = () => Array.from(vm.runInContext(`(() => { ${pipeline}; return visible.map(item => item.id) })()`, context)).sort()
  // The order is a separate contract (see default-view); here the guarantee is
  // that intersecting the three axes drops nothing it should keep.
  assert.deepEqual(visibleIds(), ['REQ-1', 'REQ-5'])
  context.source = 'manual'
  assert.deepEqual(visibleIds(), ['REQ-4'])
  context.source = 'defect'
  context.keyword = 'no match'
  assert.deepEqual(visibleIds(), [])
  context.keyword = ''
  context.filter = 'all'
  assert.deepEqual(visibleIds(), ['REQ-1', 'REQ-2', 'REQ-3', 'REQ-5'])
  assert.equal(records[0].id, 'REQ-5', 'filtering must not mutate incoming order')
})

test('the 待办 view hides terminal deliveries and never reorders the payload in place', () => {
  const records = [
    { id: 'REQ-9', requiresHuman: true, delivery: { key: 'awaiting-acceptance' }, createdAt: '2026-03-01T00:00:00.000Z' },
    { id: 'REQ-8', requiresHuman: false, delivery: { key: 'pending' }, createdAt: '2026-02-01T00:00:00.000Z' },
    { id: 'REQ-7', requiresHuman: true, delivery: { key: 'in-progress' }, createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'REQ-6', delivery: { key: 'closed' }, createdAt: '2025-12-01T00:00:00.000Z' },
    { id: 'REQ-5', delivery: { key: 'accepted' }, createdAt: '2025-11-01T00:00:00.000Z' },
  ]
  const context = vm.createContext({
    scopedItems: records, data: { requirements: records }, keyword: '', filter: 'todo', source: 'all', root: '',
    DEFAULT_REQUIREMENT_VIEW: 'todo', sortMode: 'need',
  })
  vm.runInContext(
    extract('    function isDefect(', '    /** `item.defect`') +
    extract('    function isFeedbackSource(', '    // ---- Feedback:') +
    extract('    function deliveryOf(', '    const REL_LABELS') +
    extract('    const FILTERS = [', '    // Each tab') +
    extract('    function requirementViewCounts(', '    function useRequirements('), context)
  const pipeline = extract('      const needle = keyword.trim()', '      const clearFilters =')
  const visibleIds = () => Array.from(vm.runInContext(`(() => { ${pipeline}; return visible.map(item => item.id) })()`, context))
  // 待验收 first, then the decision the human owes, then AI work, then queued —
  // and the two terminal deliveries are simply not here.
  assert.deepEqual(visibleIds(), ['REQ-9', 'REQ-7', 'REQ-8'])
  assert.deepEqual(records.map((item) => item.id), ['REQ-9', 'REQ-8', 'REQ-7', 'REQ-6', 'REQ-5'], 'the default view must not mutate the server order')
  context.filter = 'archived'
  assert.deepEqual(visibleIds(), ['REQ-6', 'REQ-5'])
})

test('only three independent query state axes remain and reset includes all of them', () => {
  const reset = extract('      const clearFilters = () => {', '      const selected =')
  assert.deepEqual([...reset.matchAll(/set(\w+)\(/g)].map(match => match[1]), ['Filter', 'Source', 'Keyword'])
  assert.match(source, /const filtered = filter !== DEFAULT_REQUIREMENT_VIEW \|\| keyword !== '' \|\| source !== 'all'/)
  assert.match(source, /const DEFAULT_REQUIREMENT_VIEW = 'todo'/)
})
