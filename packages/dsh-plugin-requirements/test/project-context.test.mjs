import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')
const start = source.indexOf('    function useRequirements(')
const end = source.indexOf('    function ProjectPicker(', start)
const flush = () => new Promise(resolve => setImmediate(resolve))

// Effects are deliberately committed separately from render to cover the
// pre-effect frame where an old project's rows must already be inaccessible.
function harness() {
  let state, callback, callbackDeps, effectDeps, cleanup, effect
  const requests = []
  const changed = (a, b) => !a || b.some((value, index) => value !== a[index])
  const context = vm.createContext({
    ALL_PROJECTS: 'ALL',
    useState(initial) { state ??= initial; return [state, value => { state = typeof value === 'function' ? value(state) : value }] },
    useCallback(fn, deps) { if (changed(callbackDeps, deps)) { callback = fn; callbackDeps = deps } return callback },
    useEffect(fn, deps) { if (changed(effectDeps, deps)) { effectDeps = deps; effect = fn } },
    fetch(url) {
      return new Promise((resolve, reject) => requests.push({
        url, reject,
        resolve(body, ok = true) { resolve({ ok, status: ok ? 200 : 500, json: async () => body }) },
      }))
    },
  })
  const filters = source.slice(source.indexOf('    const FILTERS ='), source.indexOf('    // Source is a second'))
  const rules = source.slice(source.indexOf('    function deliveryOf('), source.indexOf('    const REL_LABELS'))
  const counts = source.slice(source.indexOf('    function requirementViewCounts('), start)
  const countBinding = source.slice(source.indexOf('      const counts = requirementViewCounts(', source.indexOf('    function Workbench('))).split('\n')[0]
  assert.ok(countBinding.includes('(data, keywordMatched)'), 'Workbench supplies the scope-masked result to the count projection')
  const tabsStart = source.indexOf('          FILTERS.map(([id, label]) => {', source.indexOf('    function Workbench('))
  const tabsEnd = source.indexOf('          }),', tabsStart) + '          })'.length
  vm.runInContext(filters + rules + counts + source.slice(start, end) + `
    this.render = useRequirements
    const h = (type, props, ...children) => ({ type, props, children })
    const T = {}
    this.tabs = (data, keywordMatched = data?.requirements ?? []) => {
      ${countBinding}
      const filter = 'pending', setFilter = () => {}
      return ${source.slice(tabsStart, tabsEnd)}
    }
  `, context)
  return {
    requests,
    tabs: (data, items) => context.tabs(data, items),
    render(root = '', projectId = '') { return context.render({ root, projectId }) },
    commit() { if (effect) { cleanup?.(); const next = effect; effect = null; cleanup = next() } },
    unmount() { cleanup?.() },
  }
}

const body = project => ({ ok: true, project, requirements: [{ id: `REQ-${project}` }] })
const viewIds = ['pending', 'all', 'mine', 'running', 'awaiting', 'accepted', 'closed', 'anomalies']
function assertTabs(app, view, expected) {
  const tabs = Array.from(app.tabs(view.data))
  assert.deepEqual(tabs.map(tab => tab.props.key), viewIds)
  assert.deepEqual(tabs.map(tab => tab.children[1].children[0]), expected)
}
const unloaded = Array(8).fill('—')
const zero = Array(8).fill(0)

for (const failLate of [false, true]) {
  test(`all eight rendered category counts follow current loaded scope (late failure: ${failLate})`, async () => {
    const app = harness()
    assertTabs(app, app.render(), unloaded); app.commit()
    assert.equal(app.requests.length, 0)
    assertTabs(app, app.render('A'), unloaded); app.commit()
    assertTabs(app, app.render('A'), unloaded)
    app.requests[0].reject(new Error('initial load failed')); await flush()
    assertTabs(app, app.render('A'), unloaded)
    app.render('A').reload()
    app.requests[1].resolve({ ok: true, requirements: [] }); await flush()
    assertTabs(app, app.render('A'), zero)
    app.render('A').reload()
    assertTabs(app, app.render('A'), zero, 'same-scope refresh retains loaded zero')
    assertTabs(app, app.render('B'), unloaded); app.commit()
    if (failLate) app.requests[2].reject(new Error('late A failure'))
    else app.requests[2].resolve(body('A'))
    await flush()
    assertTabs(app, app.render('B'), unloaded)
    app.requests[3].resolve({ ok: true, requirements: [] }); await flush()
    assertTabs(app, app.render('B'), zero)
    assertTabs(app, app.render('', 'ALL'), unloaded); app.commit()
    app.requests[4].resolve({ ok: true, requirements: [] }); await flush()
    assertTabs(app, app.render('', 'ALL'), zero)
    app.render('', 'ALL').reload()
    assertTabs(app, app.render(), unloaded); app.commit()
    if (failLate) app.requests[5].reject(new Error('late ALL failure'))
    else app.requests[5].resolve(body('ALL'))
    await flush()
    assertTabs(app, app.render(), unloaded)
    app.render('C'); app.commit()
    app.requests[6].resolve({ ok: true, requirements: [] }); await flush()
    app.render('C').reload()
    app.requests[7].reject(new Error('refresh failed')); await flush()
    assertTabs(app, app.render('C'), zero)
  })
}

test('eight category spans include anomaly counts and filtered real zero, not placeholders', async () => {
  const app = harness()
  app.render('A'); app.commit()
  const rows = ['pending', 'in-progress', 'awaiting-acceptance', 'accepted', 'closed'].map(key => ({ delivery: { key } }))
  rows[0].anomalies = ['duplicate-title']
  app.requests[0].resolve({ ok: true, requirements: rows }); await flush()
  const view = app.render('A')
  // Production matchesView rules: pending overlaps running/awaiting; awaiting needs a human.
  assertTabs(app, view, [3, 5, 1, 1, 1, 1, 1, 1])
  const filteredTabs = Array.from(app.tabs(view.data, []))
  assert.deepEqual(filteredTabs.map(tab => tab.children[1].children[0]), zero)
  assertTabs(app, { data: {} }, unloaded)
})

test('fresh or cleared context never requests implicit default fixtures', () => {
  const app = harness()
  let view = app.render()
  app.commit()
  assert.equal(view.loading, false)
  assert.equal(view.data, null)
  view.reload()
  assert.equal(app.requests.length, 0)
  assert.equal(app.render('', 'stale-project-id').data, null)
  app.commit()
  assert.equal(app.requests.length, 0)
  assert.match(source, /data-project-context-empty/)
  assert.match(source, /尚未加载需求，不代表没有需求/)
  assert.match(source, /const singleWorkspace = projectId !== ALL_PROJECTS && Boolean\(root\)/)
})

test('saved root and ALL stay explicit; resolved project IDs do not refetch', async () => {
  const app = harness()
  app.render('D:/DSH'); app.commit()
  assert.equal(app.requests[0].url, '/api/alm/requirements?root=D%3A%2FDSH')
  app.requests[0].resolve(body('ALM')); await flush()
  assert.equal(app.render('D:/DSH', 'ALM').data.project, 'ALM'); app.commit()
  assert.equal(app.requests.length, 1)
  assert.equal(app.render('D:/DSH', 'ALL').data, null); app.commit()
  assert.equal(app.requests[1].url, '/api/alm/requirements?project=ALL')
  app.requests[1].resolve(body('aggregate')); await flush()
  assert.equal(app.render('', 'ALL').data.project, 'aggregate'); app.commit()
  assert.equal(app.requests.length, 2)
  assert.match(source, /if \(!data\?\.project \|\| projectId === ALL_PROJECTS\) return/)
})

test('switch masks rows before effects, rejects late success/error, and keeps the new project', async () => {
  const app = harness()
  app.render('A'); app.commit()
  app.requests[0].resolve(body('A')); await flush()
  let view = app.render('A')
  view.reload() // A refresh remains in flight during the switch.
  assert.equal(app.render('A').data.project, 'A')
  view = app.render('B')
  assert.equal(view.data, null)
  assert.equal(view.loading, true)
  app.commit()
  app.requests[2].resolve(body('B')); await flush()
  app.requests[1].resolve(body('A')); await flush()
  assert.equal(app.render('B').data.project, 'B')
  app.render('B').reload()
  app.render('C'); app.commit()
  app.requests[3].reject(new Error('late B failure')); await flush()
  view = app.render('C')
  assert.equal(view.data, null)
  assert.equal(view.error, null)
  app.requests[4].resolve(body('C')); await flush()
  assert.equal(app.render('C').data.project, 'C')
  assert.equal(app.render().data, null); app.commit()
  assert.equal(app.render().loading, false)
})

test('same-scope refresh retains rows, reports errors and accepts only the latest request', async () => {
  const app = harness()
  app.render('A'); app.commit()
  app.requests[0].resolve(body('A')); await flush()
  app.render('A').reload()
  assert.equal(app.render('A').data.project, 'A')
  app.requests[1].reject(new Error('refresh failed')); await flush()
  assert.equal(app.render('A').error, 'refresh failed')
  assert.equal(app.render('A').data.project, 'A')
  app.render('A').reload()
  app.render('A').reload()
  app.requests[3].resolve(body('new')); await flush()
  app.requests[2].resolve(body('old')); await flush()
  assert.equal(app.render('A').data.project, 'new')
  app.render('A').reload(); app.unmount()
  app.requests[4].resolve(body('unmounted')); await flush()
  assert.equal(app.render('A').data.project, 'new')
})

test('clearing during a refresh rejects late data and late errors without loading defaults', async () => {
  for (const failure of [false, true]) {
    const app = harness()
    app.render('A'); app.commit()
    app.requests[0].resolve(body('A')); await flush()
    app.render('A').reload()
    assert.equal(app.render().data, null, 'mask rows before effect cleanup')
    app.commit()
    if (failure) app.requests[1].reject(new Error('late refresh failure'))
    else app.requests[1].resolve(body('A'))
    await flush()
    const view = app.render()
    assert.equal(view.data, null)
    assert.equal(view.error, null)
    assert.equal(view.loading, false)
    view.reload()
    assert.equal(app.requests.length, 2)
  }
})

test('a loaded zero-row project remains loaded across refresh, unlike an unset scope', async () => {
  const app = harness()
  app.render('empty'); app.commit()
  app.requests[0].resolve({ ok: true, project: 'EMPTY', requirements: [] }); await flush()
  assert.equal(app.render('empty').data.requirements.length, 0)
  app.render('empty').reload()
  assert.equal(app.render('empty').data.project, 'EMPTY')
  assert.equal(app.render().data, null)
  app.commit()
  app.requests[1].resolve(body('late')); await flush()
  assert.equal(app.render().data, null)
})

test('clearing scope also clears persisted selection; project pick keeps its explicit identity', () => {
  const rootStart = source.indexOf('      const applyRoot = useCallback(')
  const rootEnd = source.indexOf('      const openSnapshot =', rootStart)
  const calls = [], storage = new Map([['root', 'A'], ['project', 'A']])
  const context = vm.createContext({
    useCallback: fn => fn,
    setRoot: value => calls.push(['root', value]),
    setSelectedId() {}, setProjectId: value => calls.push(['project', value]),
    setFilter() {}, setKeyword() {}, setAnomalyOnly() {}, setRootInput() {},
    ROOT_KEY: 'root', PROJECT_KEY: 'project', ALL_PROJECTS: 'ALL', DEFAULT_REQUIREMENT_VIEW: 'pending',
    projects: [{ id: 'B', root: 'D:/B' }],
    localStorage: { setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
  })
  vm.runInContext(source.slice(rootStart, rootEnd) + '\nthis.pick = applyProject; this.apply = applyRoot', context)
  context.pick('ALL')
  assert.equal(storage.get('project'), 'ALL')
  context.pick('B')
  assert.equal(storage.get('root'), 'D:/B')
  assert.equal(storage.get('project'), 'B')
  context.pick('')
  assert.equal(storage.has('root'), false)
  assert.equal(storage.has('project'), false)
  assert.deepEqual(calls.at(-1), ['project', ''])
})
