import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
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

test('confirmation refuses a persisted answer awaiting analysis without creating artifacts', (t) => {
  const { root, context, session } = stage(t, { items: [makeItem()] })
  saveSession({ root, session: { ...session, answerAnalysisRequired: true } })
  const before = requirementFiles(root)
  const error = assertIntentError(() => confirmIntent({ root, sessionId: session.sessionId, confirmation: confirmationFor(session, context), actor: 'human:tester', idempotencyKey: 'pending-analysis-key' }), 'not-ready')
  assert.ok(error.details?.reasons?.some(reason => reason.code === 'analysis-pending'))
  assert.deepEqual(requirementFiles(root), before)
})

test('confirmation refuses a persisted unfinished reanalysis without an active process', (t) => {
  const { root, context, session } = stage(t, { items: [makeItem()] })
  saveSession({ root, session: { ...session, analysisRetryRequired: true } })
  const before = requirementFiles(root)
  const error = assertIntentError(() => confirmIntent({ root, sessionId: session.sessionId, confirmation: confirmationFor(session, context), actor: 'human:tester', idempotencyKey: 'retry-analysis-key' }), 'not-ready')
  assert.ok(error.details?.reasons?.some(reason => reason.code === 'analysis-pending'))
  assert.deepEqual(requirementFiles(root), before)
})

test('confirmation rechecks investigation citations from the working tree', (t) => {
  const description = '需要核对现有实现'
  const { root, context, session } = stage(t, { items: [makeItem({ unknowns: [{ description, blocking: true, resolution: 'investigate' }] })] })
  const source = join(root, 'investigation-evidence.txt')
  writeFileSync(source, 'verified original evidence\n')
  const record = { investigationId: 'INV-20261107000000-abcdef', adoptedBy: 'human:tester', adoptedAt: '2026-11-07T00:00:00.000Z', sessionId: session.sessionId, inputRevision: session.input.inputRevision, itemIds: ['ITM-1'], unknownDescription: description, verdict: 'answered', source: 'observed_evidence', findings: [{ refs: [{ path: 'investigation-evidence.txt', line: 1, quote: 'verified original evidence', verified: true }] }] }
  saveSession({ root, session: { ...session, investigationEvidence: [record] } })
  const before = requirementFiles(root)
  writeFileSync(source, 'changed evidence\n')
  const error = assertIntentError(() => confirmIntent({ root, sessionId: session.sessionId, confirmation: confirmationFor(session, context), idempotencyKey: 'changed-evidence' }), 'not-ready')
  assert.ok(error.details?.reasons?.some(reason => reason.code === 'investigation-evidence-incomplete'))
  assert.deepEqual(requirementFiles(root), before)
  writeFileSync(source, 'verified original evidence\n')
  const result = confirmIntent({ root, sessionId: session.sessionId, confirmation: confirmationFor(session, context), idempotencyKey: 'current-evidence' })
  assert.ok(result.artifacts.some(entry => entry.kind === 'requirement'))
  const [adoption] = result.receipt.decision.investigations
  assert.equal(adoption.investigationId, record.investigationId)
  assert.equal(adoption.adoptedBy, record.adoptedBy)
  assert.equal(adoption.unknownDescription, description)
  assert.match(adoption.findingsHash, /^[a-f0-9]{64}$/)
  assert.doesNotMatch(JSON.stringify(adoption), /verified original evidence/)
})

test('receipt includes investigation evidence only for item routes that use it', (t) => {
  const description = '需要核对现有实现'
  const unknown = { description, blocking: true, resolution: 'investigate' }
  const { root, context, session } = stage(t, { items: [makeItem({ unknowns: [unknown] }), makeItem({ itemId: 'ITM-2', recommendedRoute: 'investigate', unknowns: [unknown] })] })
  writeFileSync(join(root, 'evidence.txt'), 'verified original evidence\n')
  const record = { adoptedBy: 'human:tester', sessionId: session.sessionId, inputRevision: session.input.inputRevision, unknownDescription: description, verdict: 'answered', source: 'observed_evidence', findings: [{ refs: [{ path: 'evidence.txt', line: 1, quote: 'verified original evidence', verified: true }] }] }
  saveSession({ root, session: { ...session, investigationEvidence: [{ ...record, investigationId: 'INV-1', itemIds: ['ITM-1'] }, { ...record, investigationId: 'INV-2', itemIds: ['ITM-2'] }] } })
  const confirmation = confirmationFor(session, context, { items: [{ itemId: 'ITM-1', route: 'create' }, { itemId: 'ITM-2', route: 'investigate', question: '需要核对现有实现' }] })
  const result = confirmIntent({ root, sessionId: session.sessionId, confirmation, idempotencyKey: 'mixed-routes' })
  assert.deepEqual(result.receipt.decision.investigations.map(entry => entry.investigationId), ['INV-1'])
  assert.deepEqual(result.receipt.decision.investigations[0].itemIds, ['ITM-1'])
})

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
  // STATUS is legacy: the delivery lifecycle is derived, not filed.
  assert.doesNotMatch(sdoc, /^STATUS:/m)
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

test('confirm 跳过孤立 brief/附件，同键重试原回执且既有记录字节不变', (t) => {
  const { root, context, session } = stage(t, { items: [makeItem()] })
  mkdirSync(join(root, 'requirements/briefs'), { recursive: true })
  mkdirSync(join(root, 'requirements/attachments/REQ-PAY-006'), { recursive: true })
  const briefPath = join(root, 'requirements/briefs/REQ-PAY-005.md')
  const attachmentPath = join(root, 'requirements/attachments/REQ-PAY-006/original.txt')
  writeFileSync(briefPath, '孤立brief，不代表确认\r\n')
  writeFileSync(attachmentPath, '保留附件\r\n')
  const preserved = [briefPath, attachmentPath, join(root, 'requirements/refund-idempotent.sdoc')]
  const original = preserved.map((path) => readFileSync(path))
  const input = { root, sessionId: session.sessionId, confirmation: confirmationFor(session, context), idempotencyKey: 'key-orphan-retry' }
  const first = confirmIntent(input)
  const created = first.artifacts.find((entry) => entry.kind === 'requirement')
  assert.equal(created.id, 'REQ-PAY-007')
  assert.equal(existsSync(join(root, 'requirements/req-pay-005.sdoc')), false)
  assert.equal(existsSync(join(root, 'requirements/req-pay-006.sdoc')), false)
  const records = [
    join(root, created.path),
    join(root, 'requirements/briefs/REQ-PAY-007.md'),
    join(root, `.alm/intents/receipts/${first.receipt.receiptId}.json`),
    join(root, `.alm/intents/sessions/${session.sessionId}.json`),
    join(root, `.alm/audit/intents/${first.receipt.receiptId}.json`),
    ...readdirSync(join(root, '.alm/intents/idempotency')).map((name) => join(root, '.alm/intents/idempotency', name)),
    ...readdirSync(join(root, '.alm/intents/journal')).map((name) => join(root, '.alm/intents/journal', name)),
  ]
  const beforeRetry = records.map((path) => readFileSync(path))
  const beforeRequirements = requirementFiles(root)
  const replay = confirmIntent(input)
  assert.equal(replay.replayed, true)
  // Replay reads the persisted receipt; the first in-memory response additionally
  // appends its own receipt artifact after persistence.
  assert.deepEqual(replay.receipt, JSON.parse(beforeRetry[2].toString('utf8')))
  assert.equal(replay.receipt.receiptId, first.receipt.receiptId)
  assert.deepEqual(requirementFiles(root), beforeRequirements)
  records.forEach((path, index) => assert.deepEqual(readFileSync(path), beforeRetry[index]))
  preserved.forEach((path, index) => assert.deepEqual(readFileSync(path), original[index]))
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

test('open 阻塞决定由统一门禁拒绝，补 P2 仍保持零写入', (t) => {
  const item = makeItem({
    unknowns: [{ description: '需要决定默认筛选状态', blocking: true, resolution: 'clarify', blockingFor: 'confirmation' }],
  })
  const { root, context, session } = stage(t, { items: [item], explicit: { priority: 'P2' } })
  saveSession({
    root,
    session: {
      ...session,
      state: 'needs_input',
      questionGroup: {
        groupId: 'QG-blocking',
        questions: [
          {
            questionId: 'Q-blocking',
            decisionId: 'D-blocking',
            itemIds: ['ITM-1'],
            text: '默认筛选状态是什么？',
            status: 'open',
          },
        ],
      },
    },
  })
  const beforeRequirements = requirementFiles(root)
  const beforeIntentFiles = Object.fromEntries(
    ['receipts', 'idempotency', 'journal'].map((dir) => {
      const path = join(root, '.alm/intents', dir)
      return [dir, existsSync(path) ? readdirSync(path).sort() : []]
    }),
  )
  const error = assertIntentError(
    () =>
      confirmIntent({
        root,
        sessionId: session.sessionId,
        confirmation: confirmationFor(session, context, { priority: 'P2' }),
        actor: 'human:tester',
        idempotencyKey: 'key-blocking-decision',
      }),
    'not-ready',
    422,
  )
  assert.ok(error.details.reasons.some((reason) => reason.code === 'unresolved-blocking-decision'))
  assert.deepEqual(requirementFiles(root), beforeRequirements)
  for (const [dir, before] of Object.entries(beforeIntentFiles)) {
    const path = join(root, '.alm/intents', dir)
    assert.deepEqual(existsSync(path) ? readdirSync(path).sort() : [], before, `${dir} must remain unchanged`)
  }
  assert.equal(loadSession({ root, sessionId: session.sessionId }).state, 'needs_input')
})

test('analysis pending 由 confirm 稳定拒绝且零写入', (t) => {
  const { root, context, session } = stage(t, { items: [makeItem()] })
  saveSession({ root, session: { ...session, state: 'analyzing' } })
  const error = assertIntentError(
    () =>
      confirmIntent({
        root,
        sessionId: session.sessionId,
        confirmation: confirmationFor(session, context),
        actor: 'human:tester',
        idempotencyKey: 'key-analysis-pending',
      }),
    'not-ready',
    422,
  )
  assert.ok(error.details.reasons.some((reason) => reason.code === 'analysis-pending'))
  assert.ok(!existsSync(join(root, 'requirements/req-pay-005.sdoc')))
  assert.equal(existsSync(join(root, '.alm/intents/idempotency')), false)
  assert.equal(existsSync(join(root, '.alm/intents/journal')), false)
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

  const createdPaths = [join(root, 'requirements/req-pay-005.sdoc'), join(root, 'requirements/briefs/REQ-PAY-005.md')]
  const createdBytes = createdPaths.map((path) => readFileSync(path))
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
  assert.equal(existsSync(join(root, 'requirements/req-pay-006.sdoc')), false)
  createdPaths.forEach((path, index) => assert.deepEqual(readFileSync(path), createdBytes[index]))
  assert.equal(loadSession({ root, sessionId: session.sessionId }).state, 'committed')
})
