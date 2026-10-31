import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizeDraft, runAiDraft } from '../ai-draft.mjs'

function fakeStream(payload) {
  return async function* stream() {
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload)
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

const DRAFT = {
  title: '退款幂等与并发控制',
  brief: '## 背景\n\n退款重复提交会造成多张退款单。\n\n## 目标\n\n同一订单同一幂等键只退一次。\n\n## 范围外\n\n不改审批流。\n\n## 关键决策\n\n幂等键由调用方传入。\n\n## 验收线索\n\n并发重复请求只产生一张退款单。',
  priority: 'P1',
  owner: '张浩',
  rationale: '涉及资金一致性，按 P1 处理。',
}

test('runAiDraft turns colloquial intent into a structured draft', async () => {
  const draft = await runAiDraft({
    stream: fakeStream(DRAFT),
    provider: 'fake',
    model: 'fake',
    intent: '退款老是重复退，财务对账很麻烦，要保证同一笔订单只退一次',
    projectName: '支付平台',
  })
  assert.equal(draft.schema, 'alm.ai-draft/v1')
  assert.equal(draft.title, DRAFT.title)
  assert.match(draft.brief, /## 验收线索/)
  assert.equal(draft.priority, 'P1')
  assert.equal(draft.owner, '张浩')
  assert.equal(draft.provider, 'fake')
})

test('normalizeDraft falls back to intent-derived title, priority and 张浩', () => {
  const draft = normalizeDraft({ brief: '' }, { intent: '线上支付事故，退款重复扣款，需要紧急修复' })
  assert.equal(draft.title, '线上支付事故，退款重复扣款，需要紧急修复')
  assert.equal(draft.priority, 'P0')
  assert.equal(draft.owner, '张浩')
  assert.match(draft.brief, /## 背景/)
  const optimized = normalizeDraft({ title: '按钮样式优化' }, { intent: '首页按钮样式优化，体验更顺' })
  assert.equal(optimized.priority, 'P2')
})

test('runAiDraft rejects empty intent and empty model output', async () => {
  await assert.rejects(
    runAiDraft({ stream: fakeStream(DRAFT), provider: 'fake', model: 'fake', intent: '   ' }),
    (error) => error.code === 'intent-required',
  )
  await assert.rejects(
    runAiDraft({ stream: fakeStream(''), provider: 'fake', model: 'fake', intent: '退款重复' }),
    (error) => error.code === 'ai-empty',
  )
})
