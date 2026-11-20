import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

/**
 * The acceptance dialog has to hand a product manager an executable procedure,
 * not a list of claims. These tests pin the plan projection (input / action /
 * expected), the "no steps" honesty state, the select-all control and the
 * step-by-step panel. They run against client-source.js in a VM, so they need
 * no browser and no bundler.
 */
const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')
const start = source.indexOf('    function acceptanceChecklistFor(')
const end = source.indexOf('    function SignoffModal(', start)
assert.ok(start >= 0 && end > start, 'missing acceptance plan source boundaries')
const context = vm.createContext({
  T: { text: '#fff', text2: '#bbb', text3: '#888', line: '#222', line2: '#333', warn: '#e7b04b', ok: '#35c47a', err: '#ff6b6b' },
  HUMAN_CONTROL: { minHeight: '40px' },
  HUMAN_PRIMARY: { minHeight: '44px' },
  h(type, props, ...children) {
    return { type, props: props ?? {}, children: children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false) }
  },
})
vm.runInContext([
  source.slice(start, end),
  'this.ui = { acceptanceChecklistFor, acceptancePlanRows, acceptanceMissingSteps, acceptanceProgress, AcceptanceAllControl, AcceptancePlanCard, AcceptanceStepPanel }',
].join('\n'), context)
const ui = context.ui
const nodes = node => (node && typeof node === 'object' ? [node, ...(node.children ?? []).flatMap(nodes)] : [])
const textOf = node => (typeof node === 'string' ? node : node && typeof node === 'object' ? (node.children ?? []).map(textOf).join('') : '')
const byData = (tree, key) => nodes(tree).filter(node => node?.props && Object.hasOwn(node.props, key))
const byName = (tree, name) => nodes(tree).filter(node => node?.props?.name === name)
/** VM-created objects carry their own prototypes; compare plain JSON values. */
const same = (actual, expected) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)))

const planEntry = {
  id: 'AC-02',
  text: '首 token 超时与输出超时两类缺陷必须能被自动分类',
  precondition: '准备一个不返回任何分片的模型路由',
  action: '在澄清页选择该路由并提交「需要澄清」输入，等待看门狗触发',
  expected: '界面提示首 token 预算已放宽，同一会话重试后分析成功',
  judgement: '检查会话记录的 runs[].timing.firstTokenMs',
}

test('acceptance checklist carries the authored input / action / expected fields', () => {
  const criteria = ui.acceptanceChecklistFor({ detailView: { content: { doc: { acceptance: [planEntry] } } } })
  assert.equal(criteria.length, 1)
  same(criteria[0], planEntry)
})

test('checklist falls back to the verification summary without inventing steps', () => {
  const criteria = ui.acceptanceChecklistFor({ detailView: { verificationSummary: { criteria: [{ id: 'AC-09', text: '验收文本' }] } } })
  assert.equal(criteria[0].id, 'AC-09')
  assert.equal(criteria[0].action, '')
  assert.equal(criteria[0].expected, '')
})

test('plan rows read prepare → act → observe in order and drop empty fields', () => {
  const rows = ui.acceptancePlanRows(planEntry)
  same(rows.map((row) => row.key), ['input', 'action', 'expected', 'judgement'])
  same(rows.map((row) => row.label), ['输入 / 前置', '操作', '预期', '判定'])
  same(ui.acceptancePlanRows({ text: 'only prose' }), [])
})

test('a clause without action or expectation is reported as not executable', () => {
  assert.equal(ui.acceptanceMissingSteps(planEntry), false)
  assert.equal(ui.acceptanceMissingSteps({ text: '只有文本' }), true)
  assert.equal(ui.acceptanceMissingSteps({ action: '点一下' }), true)
  assert.equal(ui.acceptanceMissingSteps({ expected: '看到结果' }), true)
})

test('progress counts the same checks the cards toggle', () => {
  const criteria = [{ id: 'AC-01' }, { id: 'AC-02' }, { id: 'AC-03' }]
  same(ui.acceptanceProgress(criteria, {}), { total: 3, passed: 0, complete: false })
  same(ui.acceptanceProgress(criteria, { 'AC-01': true, 'AC-02': true, 'AC-03': true }), { total: 3, passed: 3, complete: true })
})

test('the select-all control reflects every check and reports the truthful count', () => {
  const changes = []
  const partial = ui.AcceptanceAllControl({ total: 6, passed: 3, disabled: false, onChange: value => changes.push(value) })
  const all = ui.AcceptanceAllControl({ total: 6, passed: 6, disabled: false, onChange: () => {} })
  const none = ui.AcceptanceAllControl({ total: 0, passed: 0, disabled: false, onChange: () => {} })
  const box = byData(partial, 'data-acceptance-all')[0]
  assert.equal(box.props.checked, false)
  assert.equal(box.props.disabled, false)
  assert.equal(byData(all, 'data-acceptance-all')[0].props.checked, true)
  assert.equal(byData(none, 'data-acceptance-all')[0].props.disabled, true)
  assert.match(textOf(partial), /全选（已通过 3 \/ 6 项）/)
  box.props.onChange({ target: { checked: true } })
  assert.deepEqual(changes, [true])
})

test('a list card renders the step rows and keeps the checkbox wired to the accepted id', () => {
  const toggles = []
  const card = ui.AcceptancePlanCard({ entry: planEntry, checked: true, disabled: false, onToggle: (id, value) => toggles.push([id, value]) })
  assert.equal(byData(card, 'data-acceptance-ac')[0].props['data-acceptance-ac'], 'AC-02')
  same(byData(card, 'data-acceptance-plan').map((node) => node.props['data-acceptance-plan']), ['input', 'action', 'expected', 'judgement'])
  const planText = textOf(card)
  assert.match(planText, /输入 \/ 前置/)
  assert.match(planText, /准备一个不返回任何分片的模型路由/)
  assert.match(planText, /操作/)
  assert.match(planText, /预期/)
  assert.equal(byData(card, 'data-acceptance-missing').length, 0)
  byName(card, 'acceptance-AC-02')[0].props.onChange({ target: { checked: false } })
  assert.deepEqual(toggles, [['AC-02', false]])
})

test('a card without steps says it is not executable instead of pretending', () => {
  const card = ui.AcceptancePlanCard({ entry: { id: 'AC-03', text: '模型未参与时不得生成 problem' }, checked: false, disabled: false, onToggle: () => {} })
  assert.equal(byData(card, 'data-acceptance-plan').length, 0)
  assert.equal(byData(card, 'data-acceptance-missing').length, 1)
  assert.match(textOf(card), /未登记可执行的验收步骤/)
})

test('the step panel walks one clause at a time with real navigation bounds', () => {
  const toggles = []
  const first = ui.AcceptanceStepPanel({ entry: planEntry, index: 0, total: 2, checked: false, disabled: false, onToggle: (id, value) => toggles.push([id, value]), onPrev: () => {}, onNext: () => {} })
  assert.match(textOf(first), /第 1 \/ 2 步/)
  assert.match(textOf(first), /输入 \/ 前置/)
  assert.match(textOf(first), /我已在交付版本中执行并确认本步通过/)
  assert.equal(byData(first, 'data-acceptance-prev')[0].props.disabled, true, 'first step has no previous step')
  assert.equal(byData(first, 'data-acceptance-next')[0].props.disabled, false)
  byData(first, 'data-acceptance-step-pass')[0].props.onChange({ target: { checked: true } })
  assert.deepEqual(toggles, [['AC-02', true]])

  const last = ui.AcceptanceStepPanel({ entry: planEntry, index: 1, total: 2, checked: true, disabled: false, onToggle: () => {}, onPrev: () => {}, onNext: () => {} })
  assert.match(textOf(last), /第 2 \/ 2 步/)
  assert.equal(byData(last, 'data-acceptance-prev')[0].props.disabled, false)
  assert.equal(byData(last, 'data-acceptance-next')[0].props.disabled, true, 'last step has no next step')
  assert.equal(byData(last, 'data-acceptance-step-pass')[0].props.checked, true)
})

test('the signoff dialog wires select-all, both views and the step plan together', () => {
  const dialog = source.slice(end, source.indexOf('    function ReleaseModal(', end))
  assert.match(dialog, /title: '验收交付/)
  assert.match(dialog, /AcceptanceAllControl/)
  assert.match(dialog, /data-acceptance-mode': 'steps'/)
  assert.match(dialog, /data-acceptance-mode': 'list'/)
  assert.match(dialog, /AcceptanceStepPanel/)
  assert.match(dialog, /AcceptancePlanCard/)
  assert.match(dialog, /没有登记「操作 \/ 预期」/)
})
