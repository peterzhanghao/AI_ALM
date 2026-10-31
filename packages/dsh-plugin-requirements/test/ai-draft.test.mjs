import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizeDraft, resolveSourceRefs, runAiDraft } from '../ai-draft.mjs'

function fakeStream(payload) {
  return async function* stream() {
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload)
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

const EXTRACTED = '张三：退款老是重复退\n李四：同一笔订单只退一次\n王五：财务对账很麻烦'

const CANDIDATE = {
  title: '退款幂等与并发控制',
  brief:
    '## 背景\n\n退款重复提交会造成多张退款单。\n\n## 目标\n\n同一订单同一幂等键只退一次。\n\n## 范围外\n\n不改审批流。\n\n## 关键决策\n\n幂等键由调用方传入。\n\n## 验收线索\n\n并发重复请求只产生一张退款单。',
  claim: '重复提交的退款请求必须只产生一张退款单',
  suggestedPriority: 'P1',
  rationale: '用户提到财务对账受影响，但未说明资损，建议 P1 待人工确认。',
  sourceRefs: ['#L2', '#L99', '不是行号'],
  assumptions: ['调用方可以携带幂等键'],
  question: '退款失败重试时是否复用同一个幂等键？',
  counterexample: '如果上游每次重试都生成新的幂等键，仍然会重复退款（假设，不是已发生缺陷）。',
  acceptanceDraft: ['并发两次同键请求只产生一张退款单'],
  unknowns: ['影响范围未确认'],
}

test('runAiDraft returns a candidate draft without formal priority or owner', async () => {
  const draft = await runAiDraft({
    stream: fakeStream(CANDIDATE),
    provider: 'fake',
    model: 'fake',
    intent: '退款老是重复退，财务对账很麻烦，要保证同一笔订单只退一次',
    extractedText: EXTRACTED,
    projectName: '支付平台',
  })
  assert.equal(draft.schema, 'alm.ai-draft/v1')
  assert.equal(draft.candidate, true)
  assert.equal(draft.requiresHumanConfirmation, true)
  assert.equal(draft.title, CANDIDATE.title)
  assert.match(draft.brief, /## 验收线索/)
  // AI must never fill the formal fields.
  assert.equal(draft.priority, null)
  assert.equal(draft.owner, null)
  assert.equal(draft.suggestedPriority, 'P1')
  assert.match(draft.rationale, /待人工确认/)
  assert.equal(draft.claim, CANDIDATE.claim)
  // Only the resolvable source refs survive; the rest is surfaced as unknown.
  assert.deepEqual(
    draft.sourceRefs.map((ref) => ref.ref),
    ['#L2'],
  )
  assert.match(draft.sourceRefs[0].quote, /同一笔订单只退一次/)
  assert.ok(draft.unknowns.some((note) => note.includes('#L99')))
  assert.ok(draft.unknowns.some((note) => note.includes('不是行号')))
  assert.equal(draft.assumptions.length, 1)
  assert.equal(draft.question, CANDIDATE.question)
  assert.match(draft.counterexample, /假设/)
  assert.deepEqual(draft.acceptanceDraft, CANDIDATE.acceptanceDraft)
  assert.ok(draft.unknowns.includes('影响范围未确认'))
  assert.ok(draft.unknowns.includes('负责人由人工指定，待确认'))
  assert.equal(draft.provider, 'fake')
})

test('normalizeDraft ignores model-supplied priority and owner, keeping only a suggestion', () => {
  const draft = normalizeDraft(
    {
      title: '退款幂等',
      priority: 'P0',
      owner: '张浩',
      suggestedPriority: 'P0',
      rationale: '涉及资金一致性',
      sourceRefs: [{ line: 1 }],
    },
    { intent: '线上退款事故', extractedText: '张三：线上退款重复扣款' },
  )
  assert.equal(draft.priority, null)
  assert.equal(draft.owner, null)
  assert.equal(draft.suggestedPriority, 'P0')
  assert.equal(draft.sourceRefs[0].ref, '#L1')
  assert.equal(draft.question, null)
  assert.equal(draft.counterexample, null)
})

test('normalizeDraft marks missing evidence instead of inventing it', () => {
  const draft = normalizeDraft(
    { title: '按钮样式优化', sourceRefs: ['#L3'] },
    { intent: '首页按钮样式优化，体验更顺' },
  )
  assert.equal(draft.priority, null)
  assert.equal(draft.owner, null)
  assert.equal(draft.suggestedPriority, null)
  assert.deepEqual(draft.sourceRefs, [])
  assert.ok(draft.unknowns.some((note) => note.includes('来源引用待确认')))
  assert.ok(draft.unknowns.some((note) => note.includes('优先级无依据')))
  assert.match(draft.brief, /## 背景/)
})

test('resolveSourceRefs keeps at most one question and resolves line ranges', () => {
  const resolved = resolveSourceRefs(['#L2-L3', '#L2', '#L2'], 'a\nb\nc')
  assert.deepEqual(
    resolved.sourceRefs.map((ref) => ref.ref),
    ['#L2-L3', '#L2'],
  )
  assert.equal(resolved.sourceRefs[0].endLine, 3)
  const draft = normalizeDraft(
    { title: 'x', question: ['第一个问题？', '第二个问题？'], suggestedPriority: 'P1' },
    { intent: 'x' },
  )
  assert.equal(draft.question, '第一个问题？')
})

test('runAiDraft rejects empty intent and empty model output', async () => {
  await assert.rejects(
    runAiDraft({ stream: fakeStream(CANDIDATE), provider: 'fake', model: 'fake', intent: '   ' }),
    (error) => error.code === 'intent-required',
  )
  await assert.rejects(
    runAiDraft({ stream: fakeStream(''), provider: 'fake', model: 'fake', intent: '退款重复' }),
    (error) => error.code === 'ai-empty',
  )
})
