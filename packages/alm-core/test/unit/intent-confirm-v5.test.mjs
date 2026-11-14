import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
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
  setDocDraft,
  setEdits,
} from '../../src/intent/index.mjs'
import { planRequirement } from '../../src/requirements/create.mjs'
import { docHashOf } from '../../src/requirements/doc.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
const fixture = join(repoRoot, 'fixtures/order-refund')
const CREATE_TEXT = '退款申请需要支持部分退款，目前只能整单退款，客服每天处理很多工单。'
const REUSE_TEXT = '退款幂等：同一笔退款重复提交会生成多条退款单，需要同一幂等键只产生一张退款单。'
const CONFIRMED_AT = '2026-11-04T09:00:00.000Z'

function makeRepo(t) {
  const root = mkdtempSync(join(tmpdir(), 'alm-intent-confirm-v5-'))
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

function draftInput(overrides = {}) {
  return {
    goal: '支持部分退款',
    problem: '只能整单退款',
    scope: ['按金额部分退款'],
    outOfScope: ['跨渠道对账'],
    features: [
      {
        id: 'FR-01',
        title: '部分退款',
        behavior: '客服可按金额发起部分退款',
        preconditions: [],
        response: '返回部分退款单',
        boundaries: [],
        sources: [],
        provenance: 'user-answer',
      },
    ],
    acceptance: [
      {
        id: 'AC-01',
        featureIds: ['FR-01'],
        text: '提交部分退款成功退指定金额',
        precondition: null,
        action: '提交部分退款',
        expected: '成功退指定金额',
        judgement: null,
        sources: [],
        provenance: 'user-answer',
      },
    ],
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

function stageWithDraft(t, options = {}) {
  const staged = stage(t, options)
  const session = setDocDraft({
    root: staged.root,
    session: staged.session,
    docDraft: draftInput(options.draft),
    now: CONFIRMED_AT,
  })
  return { ...staged, session }
}

function confirmationFor(session, context, overrides = {}) {
  return {
    route: 'create',
    items: [{ itemId: 'ITM-1', route: 'create' }],
    priority: 'P1',
    contextSnapshotId: context.contextSnapshotId,
    expectedInputRevision: session.input.inputRevision,
    expectedSessionRevision: session.sessionRevision,
    docHash: session.docDraft?.docHash ?? null,
    draftRevision: session.draftRevision ?? 0,
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

test('create 确认：草稿 docHash 匹配时按 renderDoc 规范正文落盘，回执带 docHash/revision/clauseIds', (t) => {
  const { root, context, session } = stageWithDraft(t, { items: [makeItem()] })
  const result = confirmIntent({
    root,
    sessionId: session.sessionId,
    confirmation: confirmationFor(session, context),
    actor: 'human:tester',
    idempotencyKey: 'key-v5-create',
    now: CONFIRMED_AT,
  })
  assert.equal(result.replayed, false)
  const requirement = result.artifacts.find((entry) => entry.kind === 'requirement')
  assert.ok(requirement)
  const briefPath = join(root, 'requirements/briefs/REQ-PAY-005.md')
  assert.ok(existsSync(briefPath))
  const brief = readFileSync(briefPath, 'utf8')
  assert.match(brief, /^# REQ-PAY-005 支持部分退款\n/)
  assert.match(brief, /## 问题与场景/)
  assert.match(brief, /## 详细功能/)
  assert.match(brief, /### FR-01 部分退款/)
  assert.match(brief, /## 验收要求/)
  assert.match(brief, /- AC-01（FR-01）/)
  assert.match(brief, /<!-- alm:meta /)
  assert.match(brief, /"confirmedAt":"2026-11-04T09:00:00.000Z"/)
  assert.doesNotMatch(brief, /## 背景/)

  assert.equal(result.receipt.docHash, docHashOf(brief))
  assert.equal(result.receipt.revision, 1)
  assert.deepEqual(result.receipt.clauseIds.features, ['FR-01'])
  assert.deepEqual(result.receipt.clauseIds.acceptance, ['AC-01'])
  assert.equal(result.receipt.confirmedAt, CONFIRMED_AT)

  const reloaded = loadSession({ root, sessionId: session.sessionId })
  assert.equal(reloaded.state, 'committed')
  assert.equal(reloaded.confirmation.docHash, result.receipt.docHash)
  assert.equal(reloaded.confirmation.revision, 1)
  assert.equal(reloaded.confirmation.draftRevision, session.draftRevision)
})

test('create 确认：多段问题描述可落为正式需求正文', (t) => {
  const { root, context, session } = stageWithDraft(t, {
    items: [makeItem()],
    draft: { problem: '重复操作导致返工\n需要按批次复盘' },
  })
  const result = confirmIntent({
    root,
    sessionId: session.sessionId,
    confirmation: confirmationFor(session, context),
    actor: 'human:tester',
    idempotencyKey: 'key-v5-multiline-problem',
    now: CONFIRMED_AT,
  })

  assert.equal(result.replayed, false)
  const brief = readFileSync(join(root, 'requirements/briefs/REQ-PAY-005.md'), 'utf8')
  assert.match(brief, /重复操作导致返工\n需要按批次复盘/)
})

test('docHash 不匹配：draft-changed 409，带 latest 草稿与 diff，且不写需求', (t) => {
  const { root, context, session } = stageWithDraft(t, { items: [makeItem()] })
  const before = requirementFiles(root)
  const error = assertIntentError(
    () =>
      confirmIntent({
        root,
        sessionId: session.sessionId,
        confirmation: confirmationFor(session, context, { docHash: `sha256:${'0'.repeat(64)}` }),
        idempotencyKey: 'key-v5-doc-hash',
        now: CONFIRMED_AT,
      }),
    'draft-changed',
    409,
  )
  assert.equal(error.details.latest.docHash, session.docDraft.docHash)
  assert.equal(error.details.latest.draftRevision, session.draftRevision)
  assert.equal(error.details.latest.docDraft.docHash, session.docDraft.docHash)
  assert.ok(Object.hasOwn(error.details, 'diff'))
  assert.equal(error.details.diff, null)
  assert.deepEqual(requirementFiles(root), before)
  assert.ok(!existsSync(join(root, 'requirements/briefs/REQ-PAY-005.md')))
})

test('draftRevision 不匹配：draft-changed 409，即使 docHash 相同', (t) => {
  const { root, context, session } = stageWithDraft(t, { items: [makeItem()] })
  const error = assertIntentError(
    () =>
      confirmIntent({
        root,
        sessionId: session.sessionId,
        confirmation: confirmationFor(session, context, { draftRevision: session.draftRevision + 1 }),
        idempotencyKey: 'key-v5-draft-revision',
        now: CONFIRMED_AT,
      }),
    'draft-changed',
    409,
  )
  assert.equal(error.details.latest.draftRevision, session.draftRevision)
})

test('expectedSessionRevision 不匹配：stale-session 409', (t) => {
  const { root, context, session } = stageWithDraft(t, { items: [makeItem()] })
  const error = assertIntentError(
    () =>
      confirmIntent({
        root,
        sessionId: session.sessionId,
        confirmation: confirmationFor(session, context, { expectedSessionRevision: session.sessionRevision + 1 }),
        idempotencyKey: 'key-v5-session-revision',
        now: CONFIRMED_AT,
      }),
    'stale-session',
    409,
  )
  assert.equal(error.details.expected, session.sessionRevision)
})

test('a candidate edit invalidates a previously prepared confirmation', (t) => {
  const { root, context, session } = stageWithDraft(t, { items: [makeItem()] })
  const oldConfirmation = confirmationFor(session, context)
  const before = requirementFiles(root)
  const edited = setEdits({ root, session, edits: [{ itemId: 'ITM-1', field: 'candidate.title', value: '人工修改标题' }] })
  assert.equal(edited.sessionRevision, session.sessionRevision + 1)
  assertIntentError(() => confirmIntent({ root, sessionId: session.sessionId, confirmation: oldConfirmation,
    idempotencyKey: 'key-stale-after-edit', now: CONFIRMED_AT }), 'stale-session', 409)
  assert.deepEqual(requirementFiles(root), before)
  assert.equal(loadSession({ root, sessionId: session.sessionId }).items[0].fields['candidate.title'].value, '人工修改标题')
})

test('校验顺序：stale-input 先于 stale-session 先于 draft-changed', (t) => {
  const { root, context, session } = stageWithDraft(t, { items: [makeItem()] })
  // 三者同时过期时优先 stale-input。
  assertIntentError(
    () =>
      confirmIntent({
        root,
        sessionId: session.sessionId,
        confirmation: confirmationFor(session, context, {
          expectedInputRevision: session.input.inputRevision + 1,
          expectedSessionRevision: session.sessionRevision + 1,
          docHash: `sha256:${'1'.repeat(64)}`,
        }),
        idempotencyKey: 'key-v5-order-input',
        now: CONFIRMED_AT,
      }),
    'stale-input',
    409,
  )
  // input 正常时 stale-session 优先于 draft-changed。
  assertIntentError(
    () =>
      confirmIntent({
        root,
        sessionId: session.sessionId,
        confirmation: confirmationFor(session, context, {
          expectedSessionRevision: session.sessionRevision + 1,
          docHash: `sha256:${'2'.repeat(64)}`,
        }),
        idempotencyKey: 'key-v5-order-session',
        now: CONFIRMED_AT,
      }),
    'stale-session',
    409,
  )
})

test('幂等重试：同键同负载返回同一回执，只落一份需求', (t) => {
  const { root, context, session } = stageWithDraft(t, { items: [makeItem()] })
  const confirmation = confirmationFor(session, context)
  const first = confirmIntent({
    root,
    sessionId: session.sessionId,
    confirmation,
    idempotencyKey: 'key-v5-idem',
    now: CONFIRMED_AT,
  })
  const second = confirmIntent({
    root,
    sessionId: session.sessionId,
    confirmation,
    idempotencyKey: 'key-v5-idem',
    now: CONFIRMED_AT,
  })
  assert.equal(second.replayed, true)
  assert.equal(second.receipt.receiptId, first.receipt.receiptId)
  assert.equal(second.receipt.docHash, first.receipt.docHash)
  const files = requirementFiles(root).filter((name) => name === 'req-pay-005.sdoc')
  assert.equal(files.length, 1)
})

test('旧会话（无 docDraft）仍按 candidateMarkdown 兼容确认，回执 docHash 指向落盘正文', (t) => {
  const { root, context, session } = stage(t, { items: [makeItem()] })
  assert.equal(session.docDraft, null)
  const result = confirmIntent({
    root,
    sessionId: session.sessionId,
    confirmation: confirmationFor(session, context),
    idempotencyKey: 'key-v5-legacy',
    now: CONFIRMED_AT,
  })
  const brief = readFileSync(join(root, 'requirements/briefs/REQ-PAY-005.md'), 'utf8')
  assert.match(brief, /^# REQ-PAY-005 /)
  assert.match(brief, /## 问题与场景/)
  assert.doesNotMatch(brief, /## 背景/)
  assert.equal(result.receipt.docHash, docHashOf(brief))
  assert.equal(result.receipt.revision, 1)
  assert.ok(Array.isArray(result.receipt.clauseIds.features))
  assert.ok(Array.isArray(result.receipt.clauseIds.acceptance))
})

test('planRequirement 传 doc：正文规范、含 FR/AC 与 confirmedAt，不再重复背景/目标', (t) => {
  const root = makeRepo(t)
  const plan = planRequirement({
    root,
    title: '支持部分退款',
    doc: draftInput(),
    confirmedAt: CONFIRMED_AT,
  })
  assert.equal(plan.doc.schema, 'alm.requirement.doc/v1')
  assert.equal(plan.doc.requirementId, 'REQ-PAY-005')
  assert.equal(plan.doc.title, '支持部分退款')
  assert.match(plan.briefContent, /^# REQ-PAY-005 支持部分退款\n/)
  assert.match(plan.briefContent, /## 问题与场景/)
  assert.match(plan.briefContent, /## 详细功能/)
  assert.match(plan.briefContent, /### FR-01 /)
  assert.match(plan.briefContent, /## 验收要求/)
  assert.match(plan.briefContent, /- AC-01（FR-01）/)
  assert.match(plan.briefContent, /"confirmedAt":"2026-11-04T09:00:00.000Z"/)
  assert.doesNotMatch(plan.briefContent, /## 背景/)
  assert.doesNotMatch(plan.briefContent, /## 目标\n\n支持部分退款\n\n## 目标/)
})

test('planRequirement 旧 brief：正文进问题与场景，未知章节原样保留', (t) => {
  const root = makeRepo(t)
  const plan = planRequirement({
    root,
    title: '退款状态对账',
    brief: '每天对账退款状态\n\n## 验收线索\n\n需要看退款单状态与对账结果',
  })
  assert.match(plan.briefContent, /## 问题与场景/)
  assert.match(plan.briefContent, /每天对账退款状态/)
  assert.match(plan.briefContent, /## 验收线索/)
  assert.match(plan.briefContent, /需要看退款单状态与对账结果/)
  assert.doesNotMatch(plan.briefContent, /## 背景/)
})

test('change 确认：有 docDraft 时变更草稿正文为 renderDoc 规范文档，正式需求不变', (t) => {
  const { root, context, session } = stageWithDraft(t, {
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
      items: [
        { itemId: 'ITM-1', route: 'change', base: { uid: 'REQ-PAY-004', revision: 2, contentHash: 'sha256:forged-base' } },
      ],
    }),
    idempotencyKey: 'key-v5-change',
    now: CONFIRMED_AT,
  })
  const draftArtifact = result.artifacts.find((entry) => entry.kind === 'change-draft')
  assert.ok(draftArtifact)
  const draft = JSON.parse(readFileSync(join(root, draftArtifact.path), 'utf8'))
  assert.match(draft.proposed.brief, /^# REQ-PAY-004 /)
  assert.match(draft.proposed.brief, /## 详细功能/)
  assert.match(draft.proposed.brief, /### FR-01 /)
  assert.equal(draft.proposed.title, '支持部分退款')
  assert.equal(result.receipt.revision, 2)
  assert.deepEqual(result.receipt.clauseIds.features, ['FR-01'])
  assert.equal(readFileSync(sdocPath, 'utf8'), before)
})
