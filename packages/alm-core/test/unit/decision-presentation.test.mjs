import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { presentDecisionRequest, buildProductDecisionAnswer, DECISION_AUTONOMY_POLICY } from '../../src/requirements/decision-presentation.mjs'

const legacy = readFileSync(new URL('../../../../fixtures/decision-requests/legacy-product-mixed.md', import.meta.url), 'utf8')
const canonical = (type = '功能', title = '默认显示什么', options = '- 选 A：待处理 — 更聚焦\n- 选 B：全部 — 信息更多') => `# 决策请求：默认视图
## 要决定什么
新用户默认看哪个视图？
## 决策 1：${title}
类型：${type}
${options}
- 推荐：A（减少干扰）
## 等待期间我还能做什么
- 完成不依赖该选择的测试。
`

test('legacy mixed request becomes one functional choice, with no technical A/B/C selection', () => {
  const p = presentDecisionRequest(legacy)
  assert.equal(p.selectable, true)
  assert.deepEqual(p.decisions.map(d => d.id), ['D2'])
  assert.equal(p.technicalDecisions.length, 1)
  assert.equal(p.decisions[0].title, '「查询条件不超过 3 个」的计数口径')
  assert.deepEqual(p.decisions[0].options.map(o => o.key), ['A','B'])
  assert.equal(p.decisions[0].recommendation, null, 'legacy text has no recommendation; never invent one')
  assert.doesNotMatch(JSON.stringify(p.decisions), /show\/trace|删除 frozen|索引规则|client-source/)
  const answer = buildProductDecisionAnswer(p, { action:'choose', selections:{D2:'A'} })
  assert.match(answer, /^决策 2.*选 A.*导航/)
  assert.match(answer, /技术实现由 AI/)
  assert.doesNotMatch(answer, /决策 1.*选|删除 frozen/)
})

test('canonical business choices retain impact and recommendation without type metadata as question', () => {
  const p=presentDecisionRequest(canonical())
  assert.equal(p.selectable,true)
  assert.equal(p.decisions[0].category,'function')
  assert.equal(p.decisions[0].recommendation.key,'A')
  assert.doesNotMatch(p.decisions[0].question,/类型/)
  assert.equal(buildProductDecisionAnswer(p,{action:'choose',selections:{D1:'B'},note:'保留已有导航'}),'决策 1（默认显示什么）：选 B — 全部\n\n补充业务约束：保留已有导航')
})

test('technical-only request delegates within prior scope without selecting a technical option', () => {
  const p=presentDecisionRequest(canonical('技术','代码组织'))
  assert.equal(p.technicalOnly,true)
  assert.deepEqual(p.decisions,[])
  const answer=buildProductDecisionAnswer(p,{action:'delegate'})
  assert.match(answer,/AI 在原需求与既有授权范围内/)
  assert.doesNotMatch(answer,/选 A|选 B/)
  assert.throws(()=>buildProductDecisionAnswer(p,{action:'choose',selections:{D1:'A'}}),{code:'decision-selection-invalid'})
})

test('permissions, data loss, acceptance weakening and release are never delegated even if marked technical', () => {
  for(const title of ['申请扩大权限','删除生产数据','正式发布','降低验收标准','人工签收']) {
    const p=presentDecisionRequest(canonical('技术',title))
    assert.equal(p.technicalOnly,false,title)
    assert.equal(p.selectable,false,title)
    assert.equal(p.authorizationDecisions.length,1,title)
    assert.throws(()=>buildProductDecisionAnswer(p,{action:'delegate'}),{code:'decision-selection-invalid'})
    const answer=buildProductDecisionAnswer(p,{action:'reframe'})
    assert.match(answer,/尚未选择任何/)
  }
  // User-facing technical concepts are still product decisions when explicitly typed.
  assert.equal(presentDecisionRequest(canonical('功能','索引规则对用户的展示方式')).decisions.length,1)
})

test('missing impact, duplicate keys, oversized lists and unreadable requests require reframe, never typed approval', () => {
  for(const raw of ['', '# 请求\n无法识别的内容',canonical('功能','默认显示什么','- 选 A：待处理\n- 选 B：全部'),canonical('功能','默认显示什么','- 选 A：待处理 — 聚焦\n- 选 A：全部 — 更多'),canonical('功能','默认显示什么',Array.from({length:5},(_,i)=>`- 选 ${String.fromCharCode(65+i)}：方案${i} — 影响${i}`).join('\n'))]) {
    const p=presentDecisionRequest(raw)
    assert.equal(p.selectable,false)
    assert.throws(()=>buildProductDecisionAnswer(p,{action:'choose',selections:{D1:'A'}}),{code:'decision-selection-invalid'})
    assert.match(buildProductDecisionAnswer(p,{action:'reframe'}),/不要替我选择推荐项/)
  }
})

test('server rejects forged, inherited, unknown or partial picks before making an answer', () => {
  const p=presentDecisionRequest(canonical())
  for(const selections of [{},{D1:'Z'},{D1:'A',D9:'B'},Object.create({D1:'A'}),{D1:{toString:()=> 'A'}},[]]) {
    assert.throws(()=>buildProductDecisionAnswer(p,{action:'choose',selections}),{code:'decision-selection-invalid'})
  }
  assert.throws(()=>buildProductDecisionAnswer(p,{action:'delegate'}),{code:'decision-selection-invalid'})
  assert.throws(()=>buildProductDecisionAnswer(p,{action:'reframe',note:'x'.repeat(4001)}),{code:'decision-selection-invalid'})
  assert.throws(()=>buildProductDecisionAnswer(p,{action:'choose',selections:{D1:'A'},note:{}}),{code:'decision-selection-invalid'})
})

test('code-fenced fake decisions never shift business/technical source association', () => {
  const p=presentDecisionRequest('```md\n## 决策 99：代码组织\n类型：技术\n```\n'+canonical())
  assert.equal(p.technicalDecisions.length,0)
  assert.equal(p.selectable,true)
  const embedded=presentDecisionRequest(canonical().replace('类型：功能','```md\n类型：技术\n```'))
  assert.equal(embedded.technicalOnly,false)
  assert.equal(embedded.decisions.length,1)
})

test('autonomy instruction keeps business and authorization boundary explicit', () => {
  for(const token of ['产品经理只决定','不要把技术方案 A/B/C','不降低验收标准','不能当作同意推荐项']) assert.ok(DECISION_AUTONOMY_POLICY.includes(token))
})
