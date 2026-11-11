import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')
const fragment = (from, to) => {
  const start = source.indexOf(from)
  const end = source.indexOf(to, start)
  assert.ok(start >= 0 && end > start)
  return source.slice(start, end)
}
const children = node => (node?.children ?? []).flat(Infinity).filter(Boolean)
const find = (node, type) => node?.type === type ? node : children(node).map(child => find(child, type)).find(Boolean)

// Production component handlers and ref wiring, not a substitute for native GUI
// keyboard activation, focus/layout, or current Desktop deployment acceptance.
function harness() {
  const picked = []
  const document = { activeElement: null }
  const selectRef = { current: null }
  const context = vm.createContext({
    h: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    T: {}, input: {}, card: {}, muted: {}, button: {}, ALL_PROJECTS: 'ALL',
  })
  vm.runInContext(fragment('    function ProjectContextPrompt(', '    function RootPicker(') + '\nthis.prompt = ProjectContextPrompt; this.picker = ProjectPicker', context)
  const renderPicker = (projects, currentId = '') => {
    const tree = context.picker({ projects, currentId, selectRef, onPick: value => picked.push(value) })
    const select = find(tree, 'select')
    assert.equal(select.props.ref, selectRef)
    const element = { focus() { document.activeElement = element } }
    select.props.ref.current = element
    return select
  }
  return { context, selectRef, picked, document, renderPicker }
}

test('unselected guidance contains exact unloaded semantics and focuses the existing select without picking', () => {
  const app = harness()
  const select = app.renderPicker([{ id: 'ALM', title: 'DSH', linked: true, projectId: 'ALM' }])
  const prompt = app.context.prompt({ selectRef: app.selectRef })
  assert.equal(prompt.props['data-project-context-empty'], 'true')
  assert.equal(prompt.children[0].children[0], '请先选择工作区项目')
  assert.equal(prompt.children[1].children[0], '尚未加载需求，不代表没有需求')
  const button = find(prompt, 'button')
  assert.equal(button.props.type, 'button', 'native button owns Enter/Space activation, never submits a form')
  assert.equal(button.props.disabled, undefined)
  assert.equal(button.props.onKeyDown, undefined, 'do not dispatch duplicate keyboard clicks')
  assert.equal(find(prompt, 'input'), undefined, 'guidance must not open a path input')
  assert.equal(app.document.activeElement, null, 'render must not steal focus')
  button.props.onClick()
  assert.equal(app.document.activeElement, app.selectRef.current)
  assert.equal(select.props.value, '')
  assert.deepEqual(app.picked, [], 'focusing must not guess a project or fetch sample data')
  select.props.onChange({ target: { value: 'ALM' } })
  assert.deepEqual(app.picked, ['ALM'])
})

for (const projects of [undefined, []]) {
  test(`empty/loading project registry retains a focusable placeholder (${projects === undefined ? 'undefined' : 'empty'})`, () => {
    const app = harness()
    const select = app.renderPicker(projects)
    assert.equal(select.props.disabled, undefined)
    assert.equal(select.props.value, '')
    const options = children(select)
    assert.equal(options.length, 1)
    assert.equal(options[0].props.value, '')
    find(app.context.prompt({ selectRef: app.selectRef }), 'button').props.onClick()
    assert.equal(app.document.activeElement, app.selectRef.current)
    assert.deepEqual(app.picked, [])
  })
}

test('unmounted ref is harmless; ALL, unlinked and missing-path choices retain their semantics', () => {
  const app = harness()
  find(app.context.prompt({ selectRef: app.selectRef }), 'button').props.onClick()
  assert.equal(app.document.activeElement, null)
  const select = app.renderPicker([
    { id: 'unlinked', title: '仓库', linked: false },
    { id: 'missing', title: '丢失', exists: false },
  ], 'ALL')
  const options = children(select)
  assert.equal(select.props.value, 'ALL')
  assert.equal(options[1].props.value, 'ALL')
  assert.match(options[2].children[0], /未关联仓库/)
  assert.equal(options[3].props.disabled, true)
  assert.deepEqual(app.picked, [])
})

test('Workbench wires the same ref to prompt and picker, and keeps loaded zero separate', () => {
  assert.match(source, /const projectSelectRef = useRef\(null\)/)
  assert.match(source, /h\(ProjectPicker, \{ projects, currentId: projectId, onPick: applyProject, selectRef: projectSelectRef \}\)/)
  const branch = fragment('      if (!hasScope) {\n        body =', '      const notices =')
  const context = vm.createContext({
    h: (type, props) => ({ type, props }), ProjectContextPrompt: 'prompt', EmptyState: 'empty',
    SkeletonTable: 'loading', RequirementTable: 'table',
    hasScope: false, loading: false, data: null, error: null, scopedItems: [],
    projectSelectRef: {}, root: '', createRequirement() {}, openPanel() {},
  })
  vm.runInContext('let body, tableInScroller;\n' + branch + '\nthis.body = body', context)
  assert.equal(context.body.type, 'prompt')
  assert.equal(context.body.props.selectRef, context.projectSelectRef)
  Object.assign(context, { hasScope: true, data: { root: 'D:/empty', requirements: [] } })
  vm.runInContext(branch + '\nthis.body = body', context)
  assert.equal(context.body.type, 'empty', 'real zero must not show unselected guidance')
  assert.equal(context.body.props.root, 'D:/empty')
  assert.match(source, /const countLabel = loading \? '读取中' : data \? `\$\{itemCount\} 条` : '—'/)
  assert.match(source, /disabled: !singleWorkspace, onClick: \(\) => setExchangeOpen\(true\)/)
  assert.match(source, /label: '新建需求',[\s\S]*?disabled: !singleWorkspace/)
})
