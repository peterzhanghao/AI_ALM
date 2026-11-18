/**
 * End-to-end adjudication through the plugin's HTTP contract.
 *
 * These cases cover the three behaviours a user can actually observe:
 *   1. 查重命中时不能直接新建（duplicate-unadjudicated），裁决后才能继续；
 *   2. 拒绝会进否决账本，并且下次分析能把它带回来；
 *   3. 暂缓必须写触发条件，确认后落成观察项而不是需求。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { handleIntentRequest } from '../intent.mjs'

const IDEMPOTENT_TEXT = '退款幂等：同一笔退款重复提交会生成多条退款单，需要同一幂等键只产生一张退款单。'

function tempRepo(t) {
  const root = mkdtempSync(join(tmpdir(), 'alm-intent-adjudication-http-'))
  cpSync('D:/DSH/fixtures/order-refund', root, { recursive: true })
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

function analysisFor({ related = [], route = 'create' } = {}) {
  return {
    schemaVersion: 'intent-review.v1',
    items: [{
      itemId: 'ITM-1',
      sourceRefs: [{ ref: 'input.text', line: null, endLine: null, quote: '同一幂等键只产生一张退款单' }],
      userProblem: '重复提交产生多条退款单',
      desiredOutcome: '同一幂等键只产生一张退款单',
      recommendedRoute: route,
      routeRationale: '看起来已有幂等承诺',
      related,
      assumptions: [],
      unknowns: [],
      candidate: {
        title: '退款幂等补充约束',
        problem: '重复提交产生多条退款单',
        goal: '同一幂等键只产生一张退款单',
        inScope: [],
        outOfScope: [],
        acceptance: [{ precondition: null, action: '重复提交退款', expected: '返回首次退款单', judgement: '接口断言' }],
        owner: null,
        priority: null,
      },
      counterexample: null,
      valueCheck: null,
    }],
    nextQuestion: null,
  }
}

async function analyze(root, options) {
  const payload = analysisFor(options)
  return handleIntentRequest({
    root,
    body: { action: 'analyze', projectId: 'PAY', input: { text: IDEMPOTENT_TEXT, source: 'text' } },
    resolveAiSelection: async () => ({ provider: 'fake', model: 'fake' }),
    aiStreamFor: () => async function* () {
      yield { type: 'text-delta', text: JSON.stringify(payload) }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  })
}

function confirmBody(session, confirmation) {
  return {
    action: 'confirm',
    sessionId: session.sessionId,
    expectedInputRevision: session.input.inputRevision,
    expectedSessionRevision: session.sessionRevision,
    docHash: session.docDraft?.docHash ?? null,
    draftRevision: session.draftRevision ?? null,
    contextSnapshotId: session.context?.contextSnapshotId ?? null,
    idempotencyKey: `idem-${session.sessionId}-${confirmation.route}`,
    confirmation: { contentHash: null, items: [{ itemId: session.items[0].itemId, route: confirmation.route }], priority: 'P2', ...confirmation },
  }
}

test('命中已覆盖条款时新建被拦下，裁决为“新的”后才放行', async t => {
  const root = tempRepo(t)
  const related = [{ uid: 'REQ-PAY-004', revision: 2, match: 'covered', reason: '已有幂等条款' }]
  const first = await analyze(root, { related })
  const session = first.session
  const codes = (first.session.readiness?.reasons ?? first.analysis?.readiness?.reasons ?? []).map((entry) => entry.code)
  assert.ok(codes.includes('duplicate-unadjudicated'), codes.join(','))

  await assert.rejects(
    handleIntentRequest({ root, body: confirmBody(session, { route: 'create', reason: null }) }),
    (error) => error.code === 'not-ready',
  )

  const edited = await handleIntentRequest({
    root,
    body: {
      action: 'edit',
      sessionId: session.sessionId,
      itemId: session.items[0].itemId,
      expectedInputRevision: session.input.inputRevision,
      expectedSessionRevision: session.sessionRevision,
      fields: { adjudication: { duplicate: 'new', uids: ['REQ-PAY-004'], reason: 'human: 确实是新的' } },
    },
  })
  assert.ok(!edited.readiness.reasons.some((entry) => entry.code === 'duplicate-unadjudicated'))
  const confirmed = await handleIntentRequest({ root, body: confirmBody(edited.session, { route: 'create' }) })
  assert.equal(confirmed.ok, true)
  assert.equal(confirmed.receipt.route, 'create')
})

test('拒绝写入否决账本，并在下一次分析中作为“已否决”带回来', async t => {
  const root = tempRepo(t)
  const related = [{ uid: 'REQ-PAY-004', revision: 2, match: 'covered', reason: '已有幂等条款' }]
  const first = await analyze(root, { related })
  let session = first.session
  const declined = await handleIntentRequest({
    root,
    body: confirmBody(session, {
      route: 'decline',
      reason: '已有 REQ-PAY-004 覆盖同一幂等约束',
      alternative: '直接复用 REQ-PAY-004 的幂等键约束',
      revisitTrigger: '需要按渠道分别计算幂等键时',
    }),
  })
  assert.equal(declined.ok, true)
  const ledgerDir = join(root, '.alm/rejections')
  assert.ok(existsSync(ledgerDir))
  const files = readdirSync(ledgerDir)
  assert.equal(files.length, 1)
  const record = JSON.parse(readFileSync(join(ledgerDir, files[0]), 'utf8'))
  assert.equal(record.alternative, '直接复用 REQ-PAY-004 的幂等键约束')
  assert.equal(record.revisitTrigger, '需要按渠道分别计算幂等键时')

  // 下一次同样的诉求：上下文里必须出现否决账本命中。
  const second = await analyze(root, { related })
  const loaded = await handleIntentRequest({ root, body: { action: 'load', sessionId: second.session.sessionId } })
  const rejections = loaded.session.context?.rejections ?? []
  assert.equal(rejections.length, 1)
  assert.match(rejections[0].statement, /退款单/)
  assert.equal(rejections[0].revisitTrigger, '需要按渠道分别计算幂等键时')
})

test('暂缓缺少触发条件时拒绝确认，补齐后落成观察项而不是需求', async t => {
  const root = tempRepo(t)
  const first = await analyze(root, { related: [] })
  const before = readdirSync(join(root, 'requirements')).length
  const editedRoute = await handleIntentRequest({
    root,
    body: {
      action: 'edit',
      sessionId: first.session.sessionId,
      itemId: first.session.items[0].itemId,
      expectedInputRevision: first.session.input.inputRevision,
      expectedSessionRevision: first.session.sessionRevision,
      fields: { route: 'defer' },
    },
  })
  const codes = editedRoute.readiness.reasons.map((entry) => entry.code)
  assert.ok(codes.includes('missing-defer-trigger'), codes.join(','))
  await assert.rejects(
    handleIntentRequest({ root, body: confirmBody(editedRoute.session, { route: 'defer' }) }),
    (error) => error.code === 'not-ready',
  )

  const withTrigger = await handleIntentRequest({
    root,
    body: {
      action: 'edit',
      sessionId: editedRoute.session.sessionId,
      itemId: editedRoute.session.items[0].itemId,
      expectedInputRevision: editedRoute.session.input.inputRevision,
      expectedSessionRevision: editedRoute.session.sessionRevision,
      fields: { deferTrigger: '出现第 3 次同渠道幂等冲突时' },
    },
  })
  const confirmed = await handleIntentRequest({ root, body: confirmBody(withTrigger.session, { route: 'defer' }) })
  assert.equal(confirmed.ok, true)
  assert.equal(readdirSync(join(root, 'requirements')).length, before)
  const observation = (confirmed.artifacts ?? []).find((entry) => entry.kind === 'observation')
  assert.ok(observation, JSON.stringify(confirmed.artifacts))
  const record = JSON.parse(readFileSync(join(root, observation.path), 'utf8'))
  assert.equal(record.trigger, '出现第 3 次同渠道幂等冲突时')
})
