import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import RequirementsService from '../index.js'
import { createRun, updateRun } from '../../alm-core/src/requirements/run.mjs'
import { presentDecisionRequest } from '../../alm-core/src/requirements/decision-presentation.mjs'

const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')
const start = source.indexOf('    function DecisionForm(')
const end = source.indexOf('    function SignoffModal(', start)
const fixture = readFileSync(new URL('../../../fixtures/decision-requests/after-2-card-content.md', import.meta.url), 'utf8')

function harness(text = fixture) {
  const values = []
  let cursor = 0
  const effectDeps = []
  let effectCursor = 0
  const writes = []
  const presentation = presentDecisionRequest(text)
  const refs = []
  let refCursor = 0
  const context = {
    h: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    useState(initial) {
      const index = cursor++
      if (!(index in values)) values[index] = initial
      return [values[index], (next) => { values[index] = typeof next === 'function' ? next(values[index]) : next }]
    },
    useRef(value) { const index = refCursor++; return refs[index] ??= {current:value} },
    useEffect(fn, deps) {
      const index = effectCursor++
      if (!effectDeps[index] || deps.some((value, i) => !Object.is(value, effectDeps[index][i]))) {
        effectDeps[index] = deps
        fn()
      }
    },
    writeJson: async (_, body) => {
      writes.push(body)
      return body.mode === 'decision' ? { text, presentation, decision: '.alm/runs/RUN-001-decision.md', decisionIdentity: { path: '.alm/runs/RUN-001-decision.md', contentHash: 'sha256-card-current' } } : { message: '已继续推进' }
    },
    DecisionFormShell: 'decision-form-shell', PlanRows: 'rows', feedbackContextFor: () => ({}),
    T: {}, primary: {}, button: {}, input: {}, EMPTY_ANSWER_HINT: '请写下决定',
    document: { querySelector: () => null },
  }
  vm.createContext(context)
  vm.runInContext(source.slice(start, end) + '\nthis.renderModal = DecisionForm', context)
  return {
    presentation, writes,
    render() { cursor = 0; refCursor = 0; effectCursor = 0; return context.renderModal({ item: { id: 'REQ-ALM-003', run: { id: 'RUN-001' } }, root: '.', onClose() {} }) },
  }
}
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return []
  return [tree, ...tree.children.flatMap(nodes), ...(tree.props.footer ?? []).flatMap(nodes)]
}
function visible(tree) {
  if (typeof tree === 'string') return tree
  if (!tree || typeof tree !== 'object') return ''
  if (tree.type === 'details' && !tree.props.open) return visible(tree.children[0])
  return tree.children.map(visible).join(' ')
}
const tick = () => new Promise((resolve) => setImmediate(resolve))

test('run decision API adds business projection without changing the raw record', () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-decision-card-'))
  try {
    const { run } = createRun({ root, requirementId: 'REQ-ALM-003', carrier: 'test' })
    const decision = `.alm/runs/${run.id}-decision.md`
    mkdirSync(join(root, '.alm/runs'), { recursive: true })
    writeFileSync(join(root, decision), fixture)
    updateRun({ root, runId: run.id, status: 'waiting-input', checkpoint: { decision }, apply: true })
    const result = RequirementsService.prototype.runDecision({ root, requirementId: 'REQ-ALM-003' })
    assert.equal(result.text, fixture)
    assert.equal(result.presentation.complete, true)
    assert.equal(result.presentation.runId, run.id)
    assert.equal(result.presentation.sourceFile, decision)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

for (const name of ['after-1-acceptance-scope', 'after-2-card-content', 'after-3-legacy-fallback']) {
test(`decision card ${name} hides technical records and requires explicit picks before submitting`, async () => {
  const app = harness(readFileSync(new URL(`../../../fixtures/decision-requests/${name}.md`, import.meta.url), 'utf8'))
  assert.equal(app.presentation.complete, true)
  app.render(); await tick()
  let tree = app.render()
  assert.ok(visible(tree).includes(app.presentation.businessQuestion))
  assert.ok(!visible(tree).includes('.alm/runs/'))
  assert.equal(nodes(tree).find((node) => node.props['data-decision-technical']).props.open, undefined)
  let radios = nodes(tree).filter((node) => node.props.type === 'radio')
  assert.ok(radios.length >= 2)
  assert.ok(radios.every((node) => !node.props.checked))
  const submit = () => nodes(tree).find((node) => node.props.key === 'answer').props.onClick()
  submit(); await tick()
  assert.equal(app.writes.filter((entry) => entry.mode === 'answer').length, 0)
  for (const decision of app.presentation.decisions) {
    tree = app.render()
    nodes(tree).find((node) => node.props.name === `decision-${decision.id}`).props.onChange()
  }
  tree = app.render()
  submit(); await tick()
  const answers = app.writes.filter((entry) => entry.mode === 'answer')
  assert.equal(answers.length, 1)
  assert.deepEqual(JSON.parse(JSON.stringify(answers[0].expectedDecision)), { path: '.alm/runs/RUN-001-decision.md', contentHash: 'sha256-card-current' })
  assert.equal(answers[0].answer, undefined, 'server builds the authoritative answer')
  assert.equal(answers[0].decisionResponse.action, 'choose')
  assert.equal(Object.keys(answers[0].decisionResponse.selections).length, app.presentation.decisions.length)
  assert.equal(answers[0].decisionResponse.note, '')
  tree = app.render()
  assert.ok(!nodes(tree).some((node) => node.props.key === 'answer'))
  assert.ok(visible(tree).includes('你的决定已提交'))
  assert.ok(nodes(tree).filter((node) => node.type === 'details').every((node) => !node.props.open))
})
}

test('legacy incomplete request asks AI to organize choices without fabricating an approval', async () => {
  const app = harness('# 决策请求\n\npnpm test\n')
  app.render(); await tick()
  let tree = app.render()
  assert.ok(!visible(tree).includes('pnpm test'))
  assert.ok(visible(tree).includes('没有清晰的业务选项'))
  assert.equal(nodes(tree).filter((node) => node.props.type === 'radio').length, 0)
  assert.equal(nodes(tree).find(node => node.type === 'textarea').props.value,'')
  nodes(tree).find((node) => node.props.key === 'answer').props.onClick()
  await tick()
  assert.equal(app.writes.at(-1).decisionResponse.action, 'reframe')
  assert.equal(app.writes.at(-1).answer, undefined)
})

test('legacy RUN-015 shape shows only functional choices and ignores rapid duplicate submit', async () => {
  const app=harness(readFileSync(new URL('../../../fixtures/decision-requests/legacy-product-mixed.md',import.meta.url),'utf8'))
  app.render(); await tick()
  let tree=app.render()
  assert.equal(nodes(tree).filter(n=>n.props.type==='radio').length,2)
  assert.doesNotMatch(visible(tree),/show\/trace|索引规则|删除 frozen/)
  assert.match(visible(tree),/技术实现交由 AI/)
  nodes(tree).find(n=>n.props.type==='radio').props.onChange()
  tree=app.render()
  const submit=nodes(tree).find(n=>n.props.key==='answer').props.onClick
  submit();submit();await tick()
  assert.equal(app.writes.filter(w=>w.mode==='answer').length,1)
  assert.deepEqual(JSON.parse(JSON.stringify(app.writes.at(-1).decisionResponse.selections)),{D2:'A'})
})

test('technical only request has no technical-option radios and delegates without approval',async()=>{
  const app=harness('# 决策请求\n## 决策 1：代码组织\n类型：技术\n- 选 A：集中 — 复用\n- 选 B：分开 — 解耦')
  app.render(); await tick()
  const tree=app.render()
  assert.equal(nodes(tree).filter(n=>n.props.type==='radio').length,0)
  assert.match(visible(tree),/无需你挑选技术方案/)
  nodes(tree).find(n=>n.props.key==='answer').props.onClick();await tick()
  assert.equal(app.writes.at(-1).decisionResponse.action,'delegate')
})

test('client exposes optional AI optimization without the legacy five-view review UI', () => {
  for (const removed of [
    'function ReviewModal(',
    'function ReviewBlock(',
    '规则与视角检查',
    '按策略需',
    '评审阻塞',
    // 'run-review' / 'fix-review' are no longer tied to the legacy five-view
    // engine: with the AI-review-only pipeline they open the AI review findings
    // (asserted below), so the ids are allowed while the legacy UI stays gone.
  ]) {
    assert.ok(!source.includes(removed), `legacy review UI remains: ${removed}`)
  }
  assert.match(source, /'fix-review': \(\) => navigate\('delivery', 'delivery-ai-suggestions'\)/)
  assert.match(source, /sectionId: 'delivery-ai-suggestions', anchor: 'delivery-ai-suggestions'/)
  assert.match(source, /'run-review': \(\) => props\.onAiReview && props\.onAiReview\(item\)/)
  assert.match(source, /review: \(\) => props\.onAiReview && props\.onAiReview\(item\)/)
  assert.match(source, /title: 'AI 优化建议'/)
  assert.match(source, /AI 建议仅供参考，不是审批、验收或推进门禁/)
  assert.match(source, /暂不采纳，继续推进/)
  assert.match(source, /disabled: selected\.length === 0/)
  assert.match(source, /title: '验收执行'/)
  assert.match(source, /title: '验收交付/)
})
