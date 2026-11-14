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
  assert.match(source, /const visible = searched/)
  assert.match(source, /anomalyOnly: filter === 'anomalies'/)
  const handler = source.match(/onToggleOnly: (\(\) => setFilter\(\(value\) => value === 'anomalies' \? 'all' : 'anomalies'\))/)?.[1]
  assert.ok(handler, 'anomaly shortcut selects the existing view axis')
  let view = 'accepted'
  const toggle = vm.runInNewContext(handler, { setFilter: updater => { view = updater(view) } })
  toggle()
  assert.equal(view, 'anomalies')
  toggle()
  assert.equal(view, 'all')
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

test('anomaly view remains reachable by keyboard including wrap and Home/End', () => {
  const filters = vm.runInNewContext(extract('    const FILTERS = [', '    // Source is a second') + '\nFILTERS')
  let view = 'pending'
  let focused = -1
  let prevented = 0
  const context = vm.createContext({ FILTERS: filters, filter: view, setFilter: value => { view = value } })
  vm.runInContext(extract('      const onFilterKeyDown =', '      const toolbar =') + '\nthis.keydown = onFilterKeyDown', context)
  const press = key => {
    context.filter = view
    context.keydown({ key, preventDefault: () => { prevented++ }, currentTarget: { querySelectorAll: () => filters.map((_, index) => ({ focus: () => { focused = index } })) } })
  }
  press('End')
  assert.equal(view, 'anomalies')
  assert.equal(focused, filters.length - 1)
  press('ArrowRight')
  assert.equal(view, 'all')
  press('ArrowLeft')
  assert.equal(view, 'anomalies')
  press('Home')
  assert.equal(view, 'all')
  press('Enter')
  assert.equal(prevented, 4)
})

test('production pipeline intersects anomaly view, source and keyword without reordering records', () => {
  const records = [
    { id: 'REQ-5', title: 'Needle closed defect', sources: ['defect'], closed: true, anomalies: [{}] },
    { id: 'REQ-4', title: 'Needle manual', sources: [], anomalies: [{}] },
    { id: 'REQ-3', title: 'Other defect', sources: ['defect'], anomalies: [{}] },
    { id: 'REQ-2', title: 'Needle clean defect', sources: ['defect'], anomalies: [] },
    { id: 'REQ-1', title: 'Needle open defect', sources: ['defect'], anomalies: [{}] },
  ]
  const context = vm.createContext({
    scopedItems: records, data: { requirements: records }, keyword: '  NEEDLE ',
    filter: 'anomalies', source: 'defect', root: '',
  })
  vm.runInContext(
    extract('    function isDefect(', '    /** `item.defect`') +
    extract('    function isFeedbackSource(', '    // ---- Feedback:') +
    extract('    function deliveryOf(', '    const REL_LABELS') +
    extract('    const FILTERS = [', '    // Source is a second') +
    extract('    function requirementViewCounts(', '    function useRequirements('), context)
  const pipeline = extract('      const needle = keyword.trim()', '      const clearFilters =')
  const visibleIds = () => Array.from(vm.runInContext(`(() => { ${pipeline}; return visible.map(item => item.id) })()`, context))
  assert.deepEqual(visibleIds(), ['REQ-5', 'REQ-1'])
  context.source = 'manual'
  assert.deepEqual(visibleIds(), ['REQ-4'])
  context.source = 'defect'
  context.keyword = 'no match'
  assert.deepEqual(visibleIds(), [])
  context.keyword = ''
  context.filter = 'all'
  assert.deepEqual(visibleIds(), ['REQ-5', 'REQ-3', 'REQ-2', 'REQ-1'])
  assert.equal(records[0].id, 'REQ-5', 'filtering must not mutate incoming order')
})

test('default 待我处理 view keeps the server creation-time order and hides clean records', () => {
  const records = [
    { id: 'REQ-9', requiresHuman: true, delivery: { key: 'awaiting-acceptance' }, createdAt: '2026-03-01T00:00:00.000Z' },
    { id: 'REQ-8', requiresHuman: false, delivery: { key: 'pending' }, createdAt: '2026-02-01T00:00:00.000Z' },
    { id: 'REQ-7', requiresHuman: true, delivery: { key: 'in-progress' }, createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'REQ-6', delivery: { key: 'closed' }, createdAt: '2025-12-01T00:00:00.000Z' },
  ]
  const context = vm.createContext({
    scopedItems: records, data: { requirements: records }, keyword: '', filter: 'mine', source: 'all', root: '',
  })
  vm.runInContext(
    extract('    function isDefect(', '    /** `item.defect`') +
    extract('    function isFeedbackSource(', '    // ---- Feedback:') +
    extract('    function deliveryOf(', '    const REL_LABELS') +
    extract('    const FILTERS = [', '    // Source is a second') +
    extract('    function requirementViewCounts(', '    function useRequirements('), context)
  const pipeline = extract('      const needle = keyword.trim()', '      const clearFilters =')
  const visibleIds = () => Array.from(vm.runInContext(`(() => { ${pipeline}; return visible.map(item => item.id) })()`, context))
  // Entering the plugin must not reorder: the API already returns newest first.
  assert.deepEqual(visibleIds(), ['REQ-9', 'REQ-7'])
  assert.equal(records[0].id, 'REQ-9', 'the default view must not mutate the server order')
})

test('only three independent query state axes remain and reset includes all of them', () => {
  const reset = extract('      const clearFilters = () => {', '      const selected =')
  assert.deepEqual([...reset.matchAll(/set(\w+)\(/g)].map(match => match[1]), ['Filter', 'Source', 'Keyword'])
  assert.match(source, /const filtered = filter !== 'all' \|\| keyword !== '' \|\| source !== 'all'/)
  assert.match(source, /const DEFAULT_REQUIREMENT_VIEW = 'mine'/)
})
