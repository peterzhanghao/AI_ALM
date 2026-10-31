import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildIntentContext, createSession, evaluateReadiness } from '../../src/intent/index.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
const fixture = join(repoRoot, 'fixtures/order-refund')
const INPUT_TEXT = '退款申请需要支持部分退款，目前只能整单退款，客服每天处理很多工单。'

function makeRepo(t) {
  const root = mkdtempSync(join(tmpdir(), 'alm-intent-readiness-'))
  cpSync(fixture, root, { recursive: true })
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

const QUOTE = '目前只能整单退款'

function makeItem(overrides = {}) {
  return {
    itemId: 'ITM-1',
    sourceRefs: [{ ref: 'chat#L1', line: 1, endLine: 1, quote: QUOTE }],
    userProblem: '只能整单退款',
    desiredOutcome: '支持部分退款',
    recommendedRoute: 'create',
    routeRationale: '需要新增能力',
    related: [],
    assumptions: [],
    unknowns: [],
    candidate: {
      title: '支持部分退款',
      problem: '只能整单退款',
      goal: '支持部分退款',
      inScope: [],
      outOfScope: [],
      acceptance: [{ precondition: null, action: '提交部分退款', expected: '成功退指定金额', judgement: null, sourceRefs: [] }],
      owner: null,
      priority: null,
    },
    counterexample: { scenario: null, status: 'unverified' },
    valueCheck: { claim: null, smallestCheck: null, stopCondition: null, status: 'unverified' },
    fields: {},
    ...overrides,
  }
}

function stage(t, { items, confirmation = null, explicit = {}, context: contextOverrides = {} } = {}) {
  const root = makeRepo(t)
  const context = { ...buildIntentContext({ root, projectId: 'PAY', intentText: INPUT_TEXT }), ...contextOverrides }
  const created = createSession({ root, project: 'PAY', input: { text: INPUT_TEXT, explicit }, context })
  const session = { ...created, items, confirmation }
  return { root, context, session }
}

function codes(result) {
  return result.reasons.map((reason) => reason.code)
}

function confirmationFor(session, context, overrides = {}) {
  return {
    route: 'create',
    items: [{ itemId: 'ITM-1', route: 'create' }],
    priority: 'P1',
    contextSnapshotId: context.contextSnapshotId,
    expectedInputRevision: session.input.inputRevision,
    inputRevision: session.input.inputRevision,
    contentHash: 'sha256:test',
    ...overrides,
  }
}

test('无 items 时不 ready，给出 no-items', (t) => {
  const { session } = stage(t, { items: [] })
  const result = evaluateReadiness({ session, requireConfirmation: false })
  assert.equal(result.ready, false)
  assert.ok(codes(result).includes('no-items'))
})

test('完整且已确认的 create 意图 ready', (t) => {
  const { session, context } = stage(t, { items: [makeItem()] })
  const confirmation = confirmationFor(session, context)
  const result = evaluateReadiness({ session, contextNow: context, confirmation })
  assert.deepEqual(result.reasons, [])
  assert.equal(result.ready, true)
})

test('未确认时给出 not-confirmed，且不依赖 UI 按钮', (t) => {
  const { session, context } = stage(t, { items: [makeItem()], explicit: { priority: 'P1' } })
  const result = evaluateReadiness({ session, contextNow: context })
  assert.equal(result.ready, false)
  assert.ok(codes(result).includes('not-confirmed'))
})

test('缺少用户显式优先级时 needs-priority，绝不默认猜测', (t) => {
  const { session, context } = stage(t, { items: [makeItem()] })
  const confirmation = confirmationFor(session, context, { priority: null })
  const result = evaluateReadiness({ session, contextNow: context, confirmation })
  assert.equal(result.ready, false)
  assert.ok(codes(result).includes('needs-priority'))
})

test('非法优先级给出 invalid-priority', (t) => {
  const { session, context } = stage(t, { items: [makeItem()] })
  const confirmation = confirmationFor(session, context, { priority: 'P9' })
  const result = evaluateReadiness({ session, contextNow: context, confirmation })
  assert.ok(codes(result).includes('invalid-priority'))
})

test('缺少验收条件时 needs-acceptance，缺少标题时 missing-title', (t) => {
  const noAcceptance = makeItem({
    candidate: { ...makeItem().candidate, acceptance: [] },
  })
  const first = stage(t, { items: [noAcceptance] })
  const firstResult = evaluateReadiness({
    session: first.session,
    contextNow: first.context,
    confirmation: confirmationFor(first.session, first.context),
  })
  assert.ok(codes(firstResult).includes('needs-acceptance'))

  const noTitle = makeItem({ candidate: { ...makeItem().candidate, title: null } })
  const second = stage(t, { items: [noTitle] })
  const secondResult = evaluateReadiness({
    session: second.session,
    contextNow: second.context,
    confirmation: confirmationFor(second.session, second.context),
  })
  assert.ok(codes(secondResult).includes('missing-title'))
})

test('阻塞未知未解决、无 sourceRefs 时给出对应原因', (t) => {
  const blocking = makeItem({
    unknowns: [{ description: '部分退款额度上限未知', blocking: true, resolution: 'pending' }],
  })
  const first = stage(t, { items: [blocking] })
  const firstResult = evaluateReadiness({
    session: first.session,
    contextNow: first.context,
    confirmation: confirmationFor(first.session, first.context),
  })
  assert.ok(codes(firstResult).includes('unresolved-blocking-unknown'))

  const noRefs = makeItem({ sourceRefs: [] })
  const second = stage(t, { items: [noRefs] })
  const secondResult = evaluateReadiness({
    session: second.session,
    contextNow: second.context,
    confirmation: confirmationFor(second.session, second.context),
  })
  assert.ok(codes(secondResult).includes('unresolved-source'))
})

test('change 路由缺少可校验的基线时 invalid-change-base，且请求里的 revision/hash 不可信', (t) => {
  const item = makeItem({ recommendedRoute: 'change', related: [] })
  const { session, context } = stage(t, { items: [item] })
  const missing = evaluateReadiness({
    session,
    contextNow: context,
    confirmation: confirmationFor(session, context, {
      route: 'change',
      items: [{ itemId: 'ITM-1', route: 'change' }],
    }),
  })
  assert.equal(missing.ready, false)
  assert.ok(codes(missing).includes('invalid-change-base'))

  // 指向不在已核对上下文里的 uid：即使伪造 revision/contentHash 也不能算基线
  const forgedUid = evaluateReadiness({
    session,
    contextNow: context,
    confirmation: confirmationFor(session, context, {
      route: 'change',
      items: [
        {
          itemId: 'ITM-1',
          route: 'change',
          base: { uid: 'REQ-PAY-999', revision: 1, contentHash: 'sha256:forged-base' },
        },
      ],
    }),
  })
  assert.equal(forgedUid.ready, false)
  assert.ok(codes(forgedUid).includes('invalid-change-base'))

  // uid 命中 context 时基线始终取自 context（revision 2），伪造的 revision/hash 被忽略
  const relatedItem = makeItem({
    recommendedRoute: 'change',
    related: [{ uid: 'REQ-PAY-004', revision: 2, match: 'covered', reason: '同一退款语义' }],
  })
  const trusted = stage(t, { items: [relatedItem] })
  const result = evaluateReadiness({
    session: trusted.session,
    contextNow: trusted.context,
    confirmation: confirmationFor(trusted.session, trusted.context, {
      route: 'change',
      items: [
        {
          itemId: 'ITM-1',
          route: 'change',
          base: { uid: 'REQ-PAY-004', revision: 1, contentHash: 'sha256:forged-base' },
        },
      ],
    }),
  })
  assert.deepEqual(result.reasons, [])
  assert.equal(result.ready, true)
  assert.equal(trusted.context.readSet.find((entry) => entry.uid === 'REQ-PAY-004').revision, 2)
})

test('reuse 缺少可核对的相关需求时 unresolved-source', (t) => {
  const item = makeItem({ recommendedRoute: 'reuse', related: [] })
  const { session, context } = stage(t, { items: [item] })
  const confirmation = confirmationFor(session, context, {
    route: 'reuse',
    items: [{ itemId: 'ITM-1', route: 'reuse' }],
  })
  const result = evaluateReadiness({ session, contextNow: context, confirmation })
  assert.ok(codes(result).includes('unresolved-source'))
})

test('decline 必须给出原因与替代方案，answer 必须有答复', (t) => {
  const declineItem = makeItem({ recommendedRoute: 'decline' })
  const first = stage(t, { items: [declineItem] })
  const declineResult = evaluateReadiness({
    session: first.session,
    contextNow: first.context,
    confirmation: confirmationFor(first.session, first.context, {
      route: 'decline',
      items: [{ itemId: 'ITM-1', route: 'decline' }],
      reason: null,
      alternative: null,
    }),
  })
  assert.ok(codes(declineResult).includes('missing-decline-reason'))

  const answerItem = makeItem({ recommendedRoute: 'answer' })
  const second = stage(t, { items: [answerItem] })
  const answerResult = evaluateReadiness({
    session: second.session,
    contextNow: second.context,
    confirmation: confirmationFor(second.session, second.context, {
      route: 'answer',
      items: [{ itemId: 'ITM-1', route: 'answer' }],
      answer: null,
    }),
  })
  assert.ok(codes(answerResult).includes('missing-answer'))
})

test('检索失败（queryStatus=error）时不得假装已核对，给出 unverified-context', (t) => {
  const { session, context } = stage(t, {
    items: [makeItem()],
    context: { queryStatus: 'error', contextSnapshotId: 'ctx-deadbeefdeadbeef' },
  })
  const confirmation = confirmationFor(session, context)
  const result = evaluateReadiness({ session, contextNow: context, confirmation })
  assert.equal(result.ready, false)
  const reason = result.reasons.find((entry) => entry.code === 'unverified-context')
  assert.ok(reason)
  assert.ok(reason.message.includes('相关需求尚未核对'))
})

test('陈旧输入/陈旧上下文与未重新核对给出明确原因', (t) => {
  const { session, context } = stage(t, { items: [makeItem()] })
  const staleInput = evaluateReadiness({
    session,
    contextNow: context,
    confirmation: confirmationFor(session, context, {
      expectedInputRevision: session.input.inputRevision - 1,
      inputRevision: session.input.inputRevision - 1,
    }),
  })
  assert.ok(codes(staleInput).includes('stale-input'))

  const staleContext = evaluateReadiness({
    session,
    contextNow: context,
    confirmation: confirmationFor(session, context, { contextSnapshotId: 'ctx-0000000000000000' }),
  })
  assert.ok(codes(staleContext).includes('stale-context'))

  const notRechecked = evaluateReadiness({ session, requireConfirmation: false })
  assert.ok(notRechecked.warnings.some((warning) => warning.includes('context-not-rechecked')))
})
