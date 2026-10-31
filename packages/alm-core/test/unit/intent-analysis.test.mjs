import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  INTENT_SYSTEM_PROMPT,
  IntentError,
  applyAnalysis,
  buildAnalysisMessages,
  buildIntentContext,
  createSession,
  effectiveCandidate,
  effectiveRoute,
  normalizeAnalysis,
} from '../../src/intent/index.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
const fixture = join(repoRoot, 'fixtures/order-refund')
const INPUT_TEXT =
  '退款申请需要支持部分退款，目前只能整单退款，客服每天处理很多工单，客户希望先退一部分。'

function makeRepo(t) {
  const root = mkdtempSync(join(tmpdir(), 'alm-intent-analysis-'))
  cpSync(fixture, root, { recursive: true })
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

function makeSession(root, text = INPUT_TEXT) {
  const context = buildIntentContext({ root, projectId: 'PAY', intentText: text })
  const session = createSession({ root, project: 'PAY', input: { text }, context })
  return { session, context }
}

function rawAnalysis(context, items, extra = {}) {
  return {
    schemaVersion: 'intent-review.v1',
    contextSnapshotId: context.contextSnapshotId,
    items,
    ...extra,
  }
}

function assertIntentError(fn, code, status) {
  try {
    fn()
  } catch (error) {
    assert.ok(error instanceof IntentError, `expected IntentError, got ${error?.name}: ${error?.message}`)
    assert.equal(error.code, code)
    if (status !== undefined) assert.equal(error.status, status)
    return error
  }
  assert.fail(`expected IntentError ${code}`)
}

test('normalizeAnalysis 接受对象、JSON 文本与 ```json 围栏文本', (t) => {
  const root = makeRepo(t)
  const { session, context } = makeSession(root)
  const items = [
    {
      itemId: 'ITM-1',
      recommendedRoute: 'create',
      userProblem: '只能整单退款',
      desiredOutcome: '支持部分退款',
      sourceRefs: [{ ref: 'chat#L1', line: 1, endLine: 1, quote: '目前只能整单退款' }],
      candidate: {
        title: '支持部分退款',
        problem: '只能整单退款',
        goal: '支持部分退款',
        acceptance: [{ action: '提交部分退款', expected: '成功退指定金额' }],
      },
      summary: '需要新增部分退款能力',
    },
  ]
  const fromObject = normalizeAnalysis(rawAnalysis(context, items), { session, context })
  const fromText = normalizeAnalysis(JSON.stringify(rawAnalysis(context, items)), { session, context })
  const fromFence = normalizeAnalysis('```json\n' + JSON.stringify(rawAnalysis(context, items)) + '\n```', {
    session,
    context,
  })

  for (const result of [fromObject, fromText, fromFence]) {
    assert.equal(result.analysis.schema, 'intent-review.v1')
    assert.equal(result.analysis.contextSnapshotId, context.contextSnapshotId)
    assert.equal(result.analysis.items.length, 1)
    assert.equal(result.analysis.items[0].recommendedRoute, 'create')
    assert.equal(result.analysis.items[0].candidate.title, '支持部分退款')
    assert.equal(result.analysis.items[0].candidate.owner, null)
    assert.equal(result.analysis.items[0].candidate.priority, null)
    assert.equal(result.analysis.items[0].sourceRefs.length, 1)
    assert.equal(result.analysis.items[0].sourceRefs[0].ref, 'chat#L1')
  }
})

test('sourceRef 的引用必须逐字出现在用户输入中，否则丢弃且不成为事实', (t) => {
  const root = makeRepo(t)
  const { session, context } = makeSession(root)
  const { analysis, warnings } = normalizeAnalysis(
    rawAnalysis(context, [
      {
        itemId: 'ITM-1',
        recommendedRoute: 'create',
        sourceRefs: [
          { ref: 'chat#L1', line: 1, quote: '目前只能整单退款' },
          { ref: 'chat#L9', line: 9, quote: '模型编造的原文：必须支持跨境退款' },
        ],
        candidate: { title: '部分退款', acceptance: [{ action: '提交部分退款', expected: '成功' }] },
      },
    ]),
    { session, context },
  )
  const item = analysis.items[0]
  assert.equal(item.sourceRefs.length, 1)
  assert.equal(item.sourceRefs[0].quote, '目前只能整单退款')
  assert.equal(item.sourceRefsRejected, false)
  assert.ok(warnings.some((warning) => warning.includes('未在用户提供的输入中找到')))
  assert.ok(!JSON.stringify(analysis.items).includes('跨境退款'))
})

test('未知 route 与非法 schemaVersion 被拒绝', (t) => {
  const root = makeRepo(t)
  const { session, context } = makeSession(root)
  const unknownRoute = assertIntentError(
    () => normalizeAnalysis(rawAnalysis(context, [{ itemId: 'ITM-1', recommendedRoute: 'auto-approve' }]), { session, context }),
    'unknown-route',
    422,
  )
  assert.equal(unknownRoute.details.path, 'items[0].recommendedRoute')

  assertIntentError(
    () => normalizeAnalysis({ ...rawAnalysis(context, []), schemaVersion: 'intent-review/v9' }, { session, context }),
    'invalid-schema-version',
    422,
  )
  assertIntentError(
    () => normalizeAnalysis('这不是 JSON', { session, context }),
    'ai-invalid-output',
    502,
  )
})

test('任意层级的可执行字段导致整份输出被拒绝', (t) => {
  const root = makeRepo(t)
  const { session, context } = makeSession(root)
  const cases = [
    { itemId: 'ITM-1', recommendedRoute: 'create', candidate: { title: 'x', apply: true } },
    { itemId: 'ITM-1', recommendedRoute: 'create', candidate: { title: 'x', acceptance: [{ action: 'a', approve: true }] } },
    { itemId: 'ITM-1', recommendedRoute: 'create', unknowns: [{ description: 'u', signoff: 'ok' }] },
  ]
  for (const item of cases) {
    const error = assertIntentError(
      () => normalizeAnalysis(rawAnalysis(context, [item]), { session, context }),
      'executable-field',
      422,
    )
    assert.ok(typeof error.details.path === 'string' && error.details.path.length > 0)
  }
})

test('候选草稿的 owner/priority 必须为 null（模型不得指派）', (t) => {
  const root = makeRepo(t)
  const { session, context } = makeSession(root)
  assertIntentError(
    () =>
      normalizeAnalysis(
        rawAnalysis(context, [{ itemId: 'ITM-1', recommendedRoute: 'create', candidate: { title: 'x', owner: '张三' } }]),
        { session, context },
      ),
    'model-assigned-owner',
    422,
  )
  assertIntentError(
    () =>
      normalizeAnalysis(
        rawAnalysis(context, [{ itemId: 'ITM-1', recommendedRoute: 'create', candidate: { title: 'x', priority: 'P0' } }]),
        { session, context },
      ),
    'model-assigned-priority',
    422,
  )
})

test('模型输出上下文快照与当前会话不一致时拒绝（迟到/串场响应）', (t) => {
  const root = makeRepo(t)
  const { session, context } = makeSession(root)
  assertIntentError(
    () =>
      normalizeAnalysis(
        { schemaVersion: 'intent-review.v1', contextSnapshotId: 'ctx-0000000000000000', items: [] },
        { session, context },
      ),
    'context-mismatch',
    409,
  )
})

test('未知普通字段被丢弃并写入 warnings，nextQuestion 自动补 questionId 且选项最多 3 个', (t) => {
  const root = makeRepo(t)
  const { session, context } = makeSession(root)
  const { analysis, warnings } = normalizeAnalysis(
    rawAnalysis(
      context,
      [{ itemId: 'ITM-1', recommendedRoute: 'create', autoExecute: 'yes' }],
      {
        unknownTopLevel: 'x',
        nextQuestion: {
          text: '部分退款的额度上限是多少？',
          whyNow: '影响验收标准',
          options: [
            { label: '不限', impact: '验收更宽' },
            { label: '按订单金额', impact: '需新规则' },
            { label: '按商品金额', impact: '需拆单' },
            { label: '其他', impact: '需澄清' },
          ],
        },
      },
    ),
    { session, context },
  )
  assert.ok(warnings.some((warning) => warning.includes('unknownTopLevel')))
  assert.ok(warnings.some((warning) => warning.includes('autoExecute')))
  assert.equal(analysis.items[0].autoExecute, undefined)
  assert.ok(analysis.nextQuestion.questionId.startsWith('Q-'))
  assert.ok(analysis.nextQuestion.questionId.length > 2)
  assert.equal(analysis.nextQuestion.options.length, 3)
  assert.deepEqual(analysis.nextQuestion.itemIds, ['ITM-1'])
  assert.equal(analysis.nextQuestion.allowFreeText, true)
})

test('applyAnalysis 按 itemId 合并，人工编辑优先并记录冲突', (t) => {
  const root = makeRepo(t)
  const { session, context } = makeSession(root)
  const { analysis } = normalizeAnalysis(
    rawAnalysis(context, [
      {
        itemId: 'ITM-1',
        recommendedRoute: 'create',
        candidate: { title: '模型标题', problem: '问题', acceptance: [{ action: 'a', expected: 'b' }] },
      },
    ]),
    { session, context },
  )
  const base = {
    ...session,
    items: [
      {
        itemId: 'ITM-1',
        recommendedRoute: 'create',
        fields: {
          recommendedRoute: { value: 'change', source: 'human', at: '2026-10-31T00:00:00.000Z' },
          'candidate.title': { value: '人工标题', source: 'human', at: '2026-10-31T00:00:00.000Z' },
        },
        candidate: { title: '人工标题', problem: '问题', goal: null, inScope: [], outOfScope: [], acceptance: [], owner: null, priority: null },
      },
    ],
  }
  const next = applyAnalysis({ session: base, analysis, model: { provider: 'p', model: 'm' }, runId: 'RUN-1' })
  const item = next.items[0]
  assert.equal(item.itemId, 'ITM-1')
  assert.equal(effectiveRoute(item), 'change')
  assert.equal(effectiveCandidate(item).title, '人工标题')
  assert.equal(effectiveCandidate(item).owner, null)
  assert.equal(effectiveCandidate(item).priority, null)
  assert.equal(item.fields['candidate.title'].conflict.value, '模型标题')
  assert.ok(next.analysisMeta.warnings.some((warning) => warning.includes('人工编辑')))
  assert.equal(next.state, 'ready_for_confirmation')
})

test('applyAnalysis 拒绝陈旧输入与陈旧上下文', (t) => {
  const root = makeRepo(t)
  const { session, context } = makeSession(root)
  const { analysis } = normalizeAnalysis(rawAnalysis(context, [{ itemId: 'ITM-1', recommendedRoute: 'investigate' }]), {
    session,
    context,
  })
  assertIntentError(
    () => applyAnalysis({ session, analysis, inputRevision: session.input.inputRevision + 1 }),
    'stale-input',
    409,
  )
  assertIntentError(
    () => applyAnalysis({ session, analysis: { ...analysis, contextSnapshotId: 'ctx-1111111111111111' } }),
    'stale-context',
    409,
  )
})

test('模型自撰字段中的 HTML 被剥离为纯文本，sourceRefs.quote 保留原话（INT-16）', (t) => {
  const root = makeRepo(t)
  const text = '退款进度看不到，希望支持部分退款。'
  const { session, context } = makeSession(root, text)
  const items = [
    {
      itemId: 'ITM-1',
      recommendedRoute: 'answer',
      userProblem: '<b>退款</b>进度看不到',
      summary: '<i>先答疑</i>',
      sourceRefs: [{ ref: 'chat#L1', line: 1, quote: '退款进度看不到' }],
      related: [{ uid: 'REQ-PAY-004', match: 'related', reason: '<span>可能相关</span>' }],
      unknowns: [{ description: '<script>alert(1)</script>需要确认入口', blocking: false, resolution: 'clarify' }],
      candidate: {
        title: '<script>alert(2)</script>支持部分退款',
        problem: '<div>只能整单退款</div>',
        goal: '支持<em>部分退款</em>',
        inScope: ['<b>订单详情</b>'],
        outOfScope: ['<style>p{}</style>不改结算'],
        acceptance: [{ action: '<a href="#">提交</a>', expected: '返回<b>成功</b>', judgement: '人工判断' }],
      },
      counterexample: { scenario: '<p>退一半失败</p>', status: 'unverified' },
      valueCheck: { claim: '<b>可验证</b>', smallestCheck: '<i>一段</i>', stopCondition: '<u>失败</u>' },
    },
  ]
  const { analysis, warnings } = normalizeAnalysis(
    rawAnalysis(context, items, {
      nextQuestion: {
        text: '<b>期望看到什么？</b>',
        whyNow: '<i>因为</i>需要澄清',
        options: [{ label: '<b>选项</b>', impact: '<i>影响</i>' }],
      },
    }),
    { session, context },
  )
  const item = analysis.items[0]
  const values = [
    item.userProblem,
    item.routeRationale,
    item.unknowns[0].description,
    item.candidate.title,
    item.candidate.problem,
    item.candidate.goal,
    item.candidate.inScope[0],
    item.candidate.outOfScope[0],
    item.candidate.acceptance[0].action,
    item.candidate.acceptance[0].expected,
    item.related[0].reason,
    item.counterexample.scenario,
    item.valueCheck.claim,
    item.valueCheck.smallestCheck,
    item.valueCheck.stopCondition,
    analysis.nextQuestion.text,
    analysis.nextQuestion.whyNow,
    analysis.nextQuestion.options[0].label,
    analysis.nextQuestion.options[0].impact,
  ]
  for (const value of values) {
    assert.ok(typeof value === 'string' && value.length > 0, `字段为空：${value}`)
    assert.ok(!/[<>]/.test(value), `HTML 未剥离：${value}`)
    assert.ok(!/alert\(|p\{\}/.test(value), `脚本内容未剥离：${value}`)
  }
  assert.equal(item.userProblem, '退款进度看不到')
  assert.equal(item.candidate.title, '支持部分退款')
  assert.equal(item.sourceRefs[0].quote, '退款进度看不到')
  assert.equal(session.input.text, text)
  const sanitized = warnings.filter((warning) => warning.includes('sanitized-html'))
  assert.ok(sanitized.length >= 3, `expected sanitized-html warnings, got ${JSON.stringify(warnings)}`)
})

test('items 为空或缺失时生成待澄清 stub，不伪造 route/candidate（INT-13）', (t) => {
  const root = makeRepo(t)
  const text = '退款进度看不到'
  const { session, context } = makeSession(root, text)
  const variants = [
    rawAnalysis(context, []),
    { schemaVersion: 'intent-review.v1', contextSnapshotId: context.contextSnapshotId },
  ]
  for (const raw of variants) {
    const { analysis, warnings } = normalizeAnalysis(raw, { session, context })
    assert.equal(analysis.items.length, 1)
    const [item] = analysis.items
    assert.equal(item.stub, true)
    assert.equal(item.recommendedRoute, null)
    assert.equal(item.candidate, null)
    assert.equal(item.sourceRefs.length, 0)
    assert.equal(item.userProblem, text)
    assert.equal(item.unknowns[0].blocking, true)
    assert.ok(['pending', 'clarify'].includes(item.unknowns[0].resolution))
    assert.equal(analysis.nextQuestion.text, '期望看到的具体行为是什么？')
    assert.equal(analysis.nextQuestion.questionId, 'Q-STUB-1')
    assert.deepEqual(analysis.nextQuestion.itemIds, [item.itemId])
    assert.ok(analysis.nextQuestion.allowFreeText)
    assert.ok(analysis.nextQuestion.whyNow && analysis.nextQuestion.whyNow.length > 0)
    assert.ok(warnings.some((warning) => warning.includes('stub')))

    const next = applyAnalysis({ session, analysis, model: { provider: 'p', model: 'm' } })
    assert.equal(next.state, 'needs_input')
    assert.equal(next.items.length, 1)
    assert.equal(next.items[0].recommendedRoute, null)
    assert.equal(next.items[0].candidate, null)
    assert.equal(next.nextQuestion.text, '期望看到的具体行为是什么？')
  }
})

test('applyAnalysis 收到空 items 的合法容器时生成 stub 并进入 needs_input（INT-13）', (t) => {
  const root = makeRepo(t)
  const { session, context } = makeSession(root)
  const next = applyAnalysis({
    session,
    analysis: { contextSnapshotId: context.contextSnapshotId, items: [], nextQuestion: null },
    model: { provider: 'p', model: 'm' },
  })
  assert.equal(next.items.length, 1)
  assert.equal(next.items[0].stub, true)
  assert.equal(next.items[0].recommendedRoute, null)
  assert.equal(next.items[0].candidate, null)
  assert.equal(next.nextQuestion.text, '期望看到的具体行为是什么？')
  assert.equal(next.state, 'needs_input')
  assert.equal(next.error, null)
  assert.ok(next.analysisMeta.warnings.some((warning) => warning.includes('stub')))
})

test('系统提示词对可回答的使用类提问优先 answer（INT-07）', (t) => {
  const root = makeRepo(t)
  const { session, context } = makeSession(root)
  assert.ok(INTENT_SYSTEM_PROMPT.includes('route=answer'))
  assert.ok(INTENT_SYSTEM_PROMPT.includes('不得为答疑新建需求'))
  assert.ok(INTENT_SYSTEM_PROMPT.includes('investigate'))
  const messages = buildAnalysisMessages({ session, context })
  assert.equal(messages[0].role, 'system')
  assert.ok(messages[0].content.includes(INTENT_SYSTEM_PROMPT))
  assert.ok(messages[0].content.includes('route=answer'))
})
