import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')

function fragment(startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, startMarker)
  const end = source.indexOf(endMarker, start)
  assert.ok(end > start, endMarker)
  return source.slice(start, end)
}

// Execute production event handlers without a DOM. These checks do not claim
// browser layout, native scrolling or end-to-end creation acceptance.
function resetHarness() {
  const state = { filter: 'anomalies', source: 'defect', keyword: 'old' }
  const context = vm.createContext({
    setFilter: value => { state.filter = value },
    setSource: value => { state.source = value },
    setKeyword: value => { state.keyword = value },
  })
  vm.runInContext(fragment('      const clearFilters = () => {', '      const selected =') + '\nthis.reset = clearFilters', context)
  return { state, context }
}

const cleared = { filter: 'all', source: 'all', keyword: '' }

test('one-click reset clears every list restriction, including source and anomalies', () => {
  const { state, context } = resetHarness()
  context.reset()
  assert.deepEqual(state, cleared)
})

test('created requirement reveal clears all filters before dismissing its notice', () => {
  const { state, context } = resetHarness()
  let dismissed = false
  Object.assign(context, {
    createdNotice: { requirementId: 'REQ-NEW', awaiting: false },
    visible: [], card: {}, T: {}, EVIDENCE_TONE: { warn: {} }, button: {},
    setCreatedNotice(value) {
      assert.deepEqual(state, cleared, 'filters must be cleared before hiding the guidance')
      assert.equal(value, null)
      dismissed = true
    },
    h(type, props, ...children) { return { type, props, children } },
  })
  vm.runInContext(fragment('      const createdBanner =', '      // Duplicate UIDs') + '\nthis.banner = createdBanner', context)
  const reveal = context.banner.children.find(node => node?.type === 'button')
  assert.ok(reveal)
  assert.equal(reveal.children[0], '清除筛选查看')
  reveal.props.onClick()
  assert.deepEqual(state, cleared)
  assert.equal(dismissed, true)
})

test('empty result guidance invokes the same complete reset', () => {
  const { state, context } = resetHarness()
  Object.assign(context, {
    T: {}, FILTERS: [['anomalies', '数据异常']], SOURCE_FILTERS: [['defect', '缺陷']],
    h(type, props, ...children) { return { type, props, children } },
  })
  vm.runInContext(fragment('    function NoResults(', '    function AnomalyNotice(') + '\nthis.empty = NoResults', context)
  const node = context.empty({ filter: 'anomalies', keyword: 'old', source: 'defect', onClear: context.reset })
  assert.equal(node.children[0].children[0], '没有符合条件的需求')
  assert.equal(node.children[1].children[0], '视图：数据异常 · 来源：缺陷 · 搜索：old')
  node.children.find(child => child.type === 'button').props.onClick()
  assert.deepEqual(state, cleared)
})

test('create refresh reveals the top row only after loading finishes, without clearing queries', () => {
  const scroll = { scrollTop: 640 }
  let effect
  let notice = { requirementId: 'REQ-NEW', awaiting: true }
  const context = vm.createContext({
    useEffect: callback => { effect = callback },
    createdNotice: notice, loading: true, data: { requirements: [] },
    listScroll: { current: scroll },
    setCreatedNotice: update => { notice = update(notice) },
  })
  vm.runInContext(fragment('      useEffect(() => {\n        if (!createdNotice', '      const hasScope ='), context)
  effect()
  assert.equal(scroll.scrollTop, 640, 'in-flight refresh must not move the list')
  assert.equal(notice.awaiting, true)
  context.loading = false
  effect()
  assert.equal(scroll.scrollTop, 0, 'new first row must be in view after refresh')
  assert.equal(notice.awaiting, false)
  assert.equal(notice.requirementId, 'REQ-NEW')
  context.createdNotice = notice
  scroll.scrollTop = 320
  effect()
  assert.equal(scroll.scrollTop, 320, 'ordinary renders must preserve reading position')
  context.createdNotice = { requirementId: 'REQ-OTHER', awaiting: true }
  context.listScroll.current = null
  assert.doesNotThrow(() => effect(), 'empty/unmounted list is safe')
})

test('list scroller is a named keyboard-reachable region with visible focus', () => {
  assert.match(source, /ref: listScroll, role: 'region', 'aria-label': '需求列表', tabIndex: 0/)
  assert.match(source, /\[data-list-scroll\]:focus-visible/)
})

test('requirement rows defer offscreen rendering without removing table rows from the accessibility tree', () => {
  const row = fragment("    function RequirementRow(", "    function RequirementTable(")
  assert.match(row, /role: 'row'/)
  assert.match(row, /contentVisibility: 'auto'/)
  assert.match(row, /containIntrinsicSize: `auto \$\{mobile \? 76 : 80\}px`/)
})

test('create completion requests a fresh payload without a page reload', () => {
  const calls = []
  const context = vm.createContext({ setCreatedNotice: value => calls.push(value), reload: () => calls.push('reload') })
  vm.runInContext(fragment('      const onIntentCreated =', '      useEffect(() => {\n        if (!createdNotice') + '\nthis.created = onIntentCreated', context)
  context.created({ requirementId: 'REQ-NEW' })
  assert.equal(calls[0].requirementId, 'REQ-NEW')
  assert.equal(calls[0].awaiting, true)
  assert.equal(calls[1], 'reload')
})


test('acceptance count falls back to legacy brief and never reports zero', () => {
  const context = vm.createContext({})
  vm.runInContext(fragment('    function acceptanceLabel(', '    function duplicateCountFor(') + '\nthis.label = acceptanceLabel', context)
  assert.equal(context.label({ briefText: '## 验收标准\n- 第一项\n- 第二项\n## 其他\n- 不计入' }), '2 项标准')
  assert.equal(context.label({ briefText: '## 验收标准\n完成走查' }), '正文内含')
  assert.equal(context.label({ briefText: '## 目标\n功能' }), '待细化')
})
