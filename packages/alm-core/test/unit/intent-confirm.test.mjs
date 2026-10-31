import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  IntentError,
  buildIntentContext,
  confirmIntent,
  createSession,
  loadSession,
  saveSession,
} from '../../src/intent/index.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
const fixture = join(repoRoot, 'fixtures/order-refund')
const CREATE_TEXT = '退款申请需要支持部分退款，目前只能整单退款，客服每天处理很多工单。'
const REUSE_TEXT = '退款幂等：同一笔退款重复提交会生成多条退款单，需要同一幂等键只产生一张退款单。'

function makeRepo(t) {
  const root = mkdtempSync(join(tmpdir(), 'alm-intent-confirm-'))
  cpSync(fixture, root, { recursive: true })
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

function requirementFiles(root) {
  return readdirSync(join(root, 'requirements')).filter((name) => name.endsWith('.sdoc')).sort()
}

function makeCandidate(overrides = {}) {
  return {
    title: '支持部分退款',
    problem: '只能整单退款',
    goal: '支持部分退款',
    inScope: ['按金额部分退款'],
    outOfScope: ['跨渠道对账'],
    acceptance: [{ precondition: null, action: '提交部分退款', expected: '成功退指定金额', judgement: null, sourceRefs: [] }],
    owner: null,
    priority: null,
    ...overrides,
  }
}

function makeItem(overrides = {}) {
  return {
    itemId: 'ITM-1',
    sourceRefs: [{ ref: 'chat#L1', line: 1, endLine: 1, quote: '目前只能整单退款' }],
    userProblem: '只能整单退款',
    desiredOutcome: '支持部分退款',
    recommendedRoute: 'create',
    routeRationale: '需要新增部分退款能力',
    related: [],
    assumptions: [],
    unknowns: [],
    candidate: makeCandidate(),
    counterexample: { scenario: null, status: 'unverified' },
    valueCheck: { claim: null, smallestCheck: null, stopCondition: null, status: 'unverified' },
    fields: {},
    ...overrides,
  }
}

function stage(t, { items, text = CREATE_TEXT, explicit } = {}) {
  const root = makeRepo(t)
  const context = buildIntentContext({ root, projectId: 'PAY', intentText: text })
  const session = createSession({ root, project: 'PAY', input: { text, explicit }, context })
  const staged = saveSession({ root, session: { ...session, items } })
  return { root, context, session: staged }
}

function confirmationFor(session, context, overrides = {}) {
  return {
    route: 'create',
    items: [{ itemId: 'ITM-1', route: 'create' }],
    priority: 'P1',
    contextSnapshotId: context.contextSnapshotId,
    expectedInputRevision: session.input.inputRevision,
    ...overrides,
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
  assert.fail(`expected IntentError ${code}, but call succeeded`)
}

test('create 去向：写需求草稿、回执与审计，会话提交', (t) => {
  const { root, context, session } = stage(t, { items: [makeItem()] })
  const result = confirmIntent({
    root,
    sessionId: session.sessionId,
    confirmation: confirmationFor(session, context),
    actor: 'human:tester',
    idempotencyKey: 'key-create-1',
  })
  assert.equal(result.replayed, false)
  assert.equal(result.receipt.schema, 'alm.intent.receipt/v1')
  assert.equal(result.receipt.route, 'create')
  assert.equal(result.receipt.actor, 'human:tester')
  assert.equal(result.receipt.inputRevision, session.input.inputRevision)
  assert.equal(result.receipt.contextSnapshotId, context.contextSnapshotId)
  assert.equal(result.receipt.decision.route, 'create')
  assert.ok(typeof result.receipt.contentHash === 'string' && result.receipt.contentHash.length === 64)
  assert.ok(result.receipt.warnings.some((warning) => warning.includes('项目默认团队')))

  const requirement = result.artifacts.find((entry) => entry.kind === 'requirement')
  assert.ok(requirement)
  assert.equal(requirement.id, 'REQ-PAY-005')
  assert.ok(existsSync(join(root, requirement.path)))
  assert.ok(existsSync(join(root, 'requirements/briefs/REQ-PAY-005.md')))
  const sdoc = readFileSync(join(root, requirement.path), 'utf8')
  assert.match(sdoc, /STATUS: proposed/)
  assert.match(sdoc, /PRIORITY: P1/)
  assert.ok(result.artifacts.some((entry) => entry.kind === 'receipt'))

  assert.ok(existsSync(join(root, `.alm/intents/receipts/${result.receipt.receiptId}.json`)))
  assert.ok(existsSync(join(root, `.alm/audit/intents/${result.receipt.receiptId}.json`)))

  const reloaded = loadSession({ root, sessionId: session.sessionId })
  assert.equal(reloaded.state, 'committed')
  assert.equal(reloaded.receipt.receiptId, result.receipt.receiptId)
  assert.equal(reloaded.confirmation.contentHash, result.receipt.contentHash)
})

test('change 去向：只写变更草稿，绝不修改正式需求', (t) => {
  const { root, context, session } = stage(t, {
    items: [
      makeItem({
        recommendedRoute: 'change',
        related: [{ uid: 'REQ-PAY-004', revision: 2, match: 'covered', reason: '同一退款语义' }],
      }),
    ],
    text: REUSE_TEXT,
  })
  const sdocPath = join(root, 'requirements/refund-idempotent.sdoc')
  const before = readFileSync(sdocPath, 'utf8')
  const result = confirmIntent({
    root,
    sessionId: session.sessionId,
    confirmation: confirmationFor(session, context, {
      route: 'change',
      // 请求里的 revision/contentHash 是伪造值，只能作为指针使用
      items: [
        { itemId: 'ITM-1', route: 'change', base: { uid: 'REQ-PAY-004', revision: 1, contentHash: 'sha256:forged-base' } },
      ],
    }),
    idempotencyKey: 'key-change-1',
  })
  const draftArtifact = result.artifacts.find((entry) => entry.kind === 'change-draft')
  assert.ok(draftArtifact)
  assert.match(draftArtifact.id, /^CHG-PAY-\d{3,}$/)
  const draftFile = join(root, draftArtifact.path)
  assert.ok(existsSync(draftFile))
  const draft = JSON.parse(readFileSync(draftFile, 'utf8'))
  assert.equal(draft.schema, 'alm.intent.change-draft/v1')
  assert.equal(draft.status, 'draft')
  assert.equal(draft.base.uid, 'REQ-PAY-004')
  assert.equal(draft.base.revision, 2)
  assert.equal(draft.base.contentHash, context.readSet.find((entry) => entry.uid === 'REQ-PAY-004').contentHash)
  assert.ok(Array.isArray(draft.impact.paths))
  assert.ok(draft.impact.coverage)
  assert.equal(draft.sourceRefs[0].quote, '目前只能整单退款')
  assert.ok(result.receipt.baseRevisions['REQ-PAY-004'])
  assert.equal(readFileSync(sdocPath, 'utf8'), before)
  assert.ok(!existsSync(join(root, 'requirements/req-pay-005.sdoc')))
})

test('investigate 去向：记录调查问题，不创建需求', (t) => {
  const { root, context, session } = stage(t, {
    items: [makeItem({ recommendedRoute: 'investigate', candidate: null })],
  })
  const before = requirementFiles(root)
  const result = confirmIntent({
    root,
    sessionId: session.sessionId,
    confirmation: confirmationFor(session, context, {
      route: 'investigate',
      items: [{ itemId: 'ITM-1', route: 'investigate', question: '部分退款的额度上限如何规定？' }],
      priority: null,
    }),
    idempotencyKey: 'key-investigate-1',
  })
  const artifact = result.artifacts.find((entry) => entry.kind === 'investigation')
  assert.ok(artifact)
  assert.match(artifact.id, /^INV-PAY-\d{3,}$/)
  const record = JSON.parse(readFileSync(join(root, artifact.path), 'utf8'))
  assert.equal(record.schema, 'alm.intent.investigation/v1')
  assert.equal(record.status, 'open')
  assert.equal(record.question, '部分退款的额度上限如何规定？')
  assert.deepEqual(requirementFiles(root), before)
})

test('reuse 去向：回执登记链接，不新建需求', (t) => {
  const { root, context, session } = stage(t, {
    items: [
      makeItem({
        recommendedRoute: 'reuse',
        related: [{ uid: 'REQ-PAY-004', revision: 2, match: 'covered', reason: '已有幂等需求' }],
      }),
    ],
    text: REUSE_TEXT,
  })
  const before = requirementFiles(root)
  const result = confirmIntent({
    root,
    sessionId: session.sessionId,
    confirmation: confirmationFor(session, context, {
      route: 'reuse',
      items: [{ itemId: 'ITM-1', route: 'reuse' }],
      priority: null,
    }),
    idempotencyKey: 'key-reuse-1',
  })
  assert.equal(result.receipt.route, 'reuse')
  assert.equal(result.receipt.decision.link.uid, 'REQ-PAY-004')
  assert.equal(result.receipt.decision.link.revision, 2)
  assert.ok(!result.artifacts.some((entry) => entry.kind === 'requirement'))
  assert.deepEqual(requirementFiles(root), before)
})

test('decline/answer 去向只写回执，且 decline 必须带原因/替代方案/可重开', (t) => {
  const decline = stage(t, { items: [makeItem({ recommendedRoute: 'decline' })] })
  const declined = confirmIntent({
    root: decline.root,
    sessionId: decline.session.sessionId,
    confirmation: confirmationFor(decline.session, decline.context, {
      route: 'decline',
      items: [{ itemId: 'ITM-1', route: 'decline' }],
      priority: null,
      reason: '与现有幂等需求重复',
      alternative: '先复用 REQ-PAY-004',
    }),
    idempotencyKey: 'key-decline-1',
  })
  assert.equal(declined.receipt.decision.decline.appeal, 'reopen')
  assert.equal(declined.receipt.decision.decline.reason, '与现有幂等需求重复')
  assert.ok(!declined.artifacts.some((entry) => entry.kind === 'requirement'))

  const answer = stage(t, { items: [makeItem({ recommendedRoute: 'answer' })] })
  const answered = confirmIntent({
    root: answer.root,
    sessionId: answer.session.sessionId,
    confirmation: confirmationFor(answer.session, answer.context, {
      route: 'answer',
      items: [{ itemId: 'ITM-1', route: 'answer' }],
      priority: null,
      answer: '部分退款单笔不超过 500 元。',
    }),
    idempotencyKey: 'key-answer-1',
  })
  assert.equal(answered.receipt.decision.answer, '部分退款单笔不超过 500 元。')
  assert.ok(!answered.artifacts.some((entry) => entry.kind === 'requirement'))
})

test('幂等：同键同负载重放回执，同键不同负载 409', (t) => {
  const { root, context, session } = stage(t, { items: [makeItem()] })
  const confirmation = confirmationFor(session, context)
  const first = confirmIntent({ root, sessionId: session.sessionId, confirmation, idempotencyKey: 'key-idem-1' })
  const second = confirmIntent({ root, sessionId: session.sessionId, confirmation, idempotencyKey: 'key-idem-1' })
  assert.equal(second.replayed, true)
  assert.equal(second.receipt.receiptId, first.receipt.receiptId)
  assert.equal(readdirSync(join(root, '.alm/intents/receipts')).length, 1)

  assertIntentError(
    () =>
      confirmIntent({
        root,
        sessionId: session.sessionId,
        confirmation: confirmationFor(session, context, { priority: 'P2' }),
        idempotencyKey: 'key-idem-1',
      }),
    'idempotency-conflict',
    409,
  )
  // 换个键也不能二次提交已提交会话
  const other = stage(t, { items: [makeItem()] })
  confirmIntent({ root: other.root, sessionId: other.session.sessionId, confirmation: confirmationFor(other.session, other.context), idempotencyKey: 'key-a' })
  assertIntentError(
    () =>
      confirmIntent({
        root: other.root,
        sessionId: other.session.sessionId,
        confirmation: confirmationFor(other.session, other.context),
        idempotencyKey: 'key-b',
      }),
    'already-committed',
    409,
  )
})

test('陈旧输入/陈旧上下文被拒绝（409），且不写产物', (t) => {
  const { root, context, session } = stage(t, { items: [makeItem()] })
  const staleInput = assertIntentError(
    () =>
      confirmIntent({
        root,
        sessionId: session.sessionId,
        confirmation: confirmationFor(session, context, { expectedInputRevision: session.input.inputRevision + 1 }),
        idempotencyKey: 'key-stale-input',
      }),
    'stale-input',
    409,
  )
  assert.equal(staleInput.details.expected, session.input.inputRevision)

  assertIntentError(
    () =>
      confirmIntent({
        root,
        sessionId: session.sessionId,
        confirmation: confirmationFor(session, context, { contextSnapshotId: 'ctx-0000000000000000' }),
        idempotencyKey: 'key-stale-context',
      }),
    'stale-context',
    409,
  )
  assert.ok(!existsSync(join(root, 'requirements/req-pay-005.sdoc')))
})

test('未就绪（缺少用户显式优先级）时 422 not-ready 且不写产物', (t) => {
  const { root, context, session } = stage(t, { items: [makeItem()] })
  const error = assertIntentError(
    () =>
      confirmIntent({
        root,
        sessionId: session.sessionId,
        confirmation: confirmationFor(session, context, { priority: null }),
        idempotencyKey: 'key-not-ready',
      }),
    'not-ready',
    422,
  )
  assert.ok(error.details.reasons.some((reason) => reason.code === 'needs-priority'))
  assert.ok(!existsSync(join(root, 'requirements/req-pay-005.sdoc')))
})

test('写入失败返回 appliedArtifacts + journal；同键重试可恢复且不重复建需求', (t) => {
  const { root, context, session } = stage(t, { items: [makeItem()] })
  const receiptsDir = join(root, '.alm/intents')
  // 用同名文件占住回执目录，制造写入失败
  writeFileSync(join(receiptsDir, 'receipts'), 'block')
  const failure = assertIntentError(
    () =>
      confirmIntent({
        root,
        sessionId: session.sessionId,
        confirmation: confirmationFor(session, context),
        idempotencyKey: 'key-write-failed',
      }),
    'write-failed',
    500,
  )
  assert.ok(Array.isArray(failure.details.appliedArtifacts))
  assert.equal(failure.details.appliedArtifacts[0].kind, 'requirement')
  assert.ok(existsSync(failure.details.journalPath))
  const journal = JSON.parse(readFileSync(failure.details.journalPath, 'utf8'))
  assert.equal(journal.status, 'failed')
  assert.ok(journal.artifacts.length >= 1)
  assert.equal(loadSession({ root, sessionId: session.sessionId }).state, 'failed')

  rmSync(join(receiptsDir, 'receipts'))
  const recovered = confirmIntent({
    root,
    sessionId: session.sessionId,
    confirmation: confirmationFor(session, context),
    idempotencyKey: 'key-write-failed',
  })
  assert.equal(recovered.replayed, false)
  assert.equal(recovered.receipt.route, 'create')
  assert.ok(existsSync(join(root, '.alm/intents/receipts', `${recovered.receipt.receiptId}.json`)))
  const created = requirementFiles(root).filter((name) => name === 'req-pay-005.sdoc')
  assert.equal(created.length, 1)
  assert.equal(loadSession({ root, sessionId: session.sessionId }).state, 'committed')
})
