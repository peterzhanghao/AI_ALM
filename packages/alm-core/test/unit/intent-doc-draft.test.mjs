import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  buildIntentContext,
  createSession,
  normalizeAnalysis,
  applyAnalysis,
} from '../../src/intent/index.mjs'
import { normalizeDocDraft } from '../../src/intent/analysis.mjs'
import {
  lockClauses,
  recordAnswers,
  saveSession,
  setDocDraft,
  setInput,
  unlockClauses,
} from '../../src/intent/session.mjs'
import { renderSessionView } from '../../src/intent/view.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
const fixture = join(repoRoot, 'fixtures/order-refund')
const INPUT_TEXT = '退款申请需要支持部分退款，目前只能整单退款，客服每天处理很多工单，客户希望先退一部分。'
const DRAFT_SCHEMA = 'alm.requirement.doc.draft/v1'

function makeRepo(t) {
  const root = mkdtempSync(join(tmpdir(), 'alm-intent-doc-draft-'))
  cpSync(fixture, root, { recursive: true })
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

function makeSession(root) {
  const context = buildIntentContext({ root, projectId: 'PAY', intentText: INPUT_TEXT })
  const session = createSession({ root, project: 'PAY', input: { text: INPUT_TEXT }, context })
  return { session, context }
}

function draftPayload(overrides = {}) {
  return {
    goal: '支持部分退款',
    problem: '当前只能整单退款，无法按金额退还',
    features: [
      {
        id: 'FR-01',
        title: '部分退款',
        behavior: '用户可选择退款金额并提交部分退款申请',
        preconditions: ['订单已支付'],
        response: '生成部分退款单',
        boundaries: ['退款金额不超过可退余额'],
        sources: ['user-1'],
        provenance: 'user-stated',
      },
    ],
    scope: ['部分退款'],
    outOfScope: ['自动审批'],
    acceptance: [
      {
        id: 'AC-01',
        featureIds: ['FR-01'],
        text: '部分退款成功后剩余金额可继续申请退款',
        precondition: '订单已支付且在退款有效期',
        action: '提交部分退款申请',
        expected: '生成金额正确的退款单，剩余可退金额同步扣减',
        judgement: '退款单金额等于申请金额',
        sources: ['user-1'],
        provenance: 'user-answer',
      },
    ],
    constraints: ['接口幂等'],
    pending: [],
    ...overrides,
  }
}

function rawV3(context, extra = {}) {
  return {
    schemaVersion: 'intent-review.v3',
    contextSnapshotId: context.contextSnapshotId,
    items: [
      {
        itemId: 'ITM-1',
        recommendedRoute: 'create',
        candidate: { title: '部分退款', goal: '支持部分退款' },
      },
    ],
    ...extra,
  }
}

function assertFiniteHash(hash) {
  assert.match(String(hash), /^sha256:[0-9a-f]{64}$/)
}

test('v3 分析：docDraft 归一化为草稿 schema，正式条款保留并计算 docHash', (t) => {
  const root = makeRepo(t)
  const { session, context } = makeSession(root)
  const { analysis, warnings } = normalizeAnalysis(
    rawV3(context, {
      docDraft: draftPayload(),
      questions: [
        {
          questionId: 'Q-1',
          itemIds: ['ITM-1'],
          text: '部分退款后是否需要主动通知用户？',
          whyNow: '决定是否包含通知能力',
          options: [{ id: 'notify', label: '需要主动通知', impact: '范围增加通知渠道' }],
          allowFreeText: true,
          dependsOn: [],
        },
      ],
    }),
    { session, context },
  )
  assert.equal(analysis.schemaVersion, 'intent-review.v3')
  const draft = analysis.docDraft
  assert.equal(draft.schema, DRAFT_SCHEMA)
  assert.equal(draft.features.length, 1)
  assert.equal(draft.features[0].id, 'FR-01')
  assert.equal(draft.features[0].title, '部分退款')
  assert.equal(draft.features[0].provenance, 'user-stated')
  assert.equal(draft.acceptance.length, 1)
  assert.deepEqual(draft.acceptance[0].featureIds, ['FR-01'])
  assert.equal(draft.acceptance[0].action, '提交部分退款申请')
  assert.equal(draft.acceptance[0].expected, '生成金额正确的退款单，剩余可退金额同步扣减')
  assert.equal(draft.draftRevision, 1)
  assert.equal(draft.basedOnInputRevision, session.input.inputRevision)
  assert.equal(draft.basedOnSessionRevision, session.sessionRevision)
  assert.equal(draft.legacy, false)
  assertFiniteHash(draft.docHash)
  assert.equal(analysis.questions.length, 1)
  assert.equal(analysis.nextQuestion.questionId, 'Q-1')
  assert.equal(warnings.some((entry) => entry.includes('docDraft')), false)
})

test('ai-suggestion 条款进入待确认而不是正式条款', (t) => {
  const root = makeRepo(t)
  const { session, context } = makeSession(root)
  const { analysis } = normalizeAnalysis(
    rawV3(context, {
      docDraft: draftPayload({
        features: [
          {
            id: 'FR-01',
            title: '退款自动审批',
            behavior: '小额退款自动通过',
            provenance: 'ai-suggestion',
          },
        ],
        acceptance: [
          {
            id: 'AC-01',
            featureIds: ['FR-01'],
            text: '小额退款自动通过',
            action: '提交小额退款',
            expected: '无需人工审批',
            provenance: 'ai-suggestion',
          },
        ],
      }),
    }),
    { session, context },
  )
  const draft = analysis.docDraft
  assert.equal(draft.features.length, 0)
  assert.equal(draft.acceptance.length, 0)
  assert.equal(draft.pending.length, 2)
  assert.match(draft.pending[0].text, /AI 建议/)
  assert.match(draft.pending[0].text, /退款自动审批/)
  assert.match(draft.pending[1].text, /AC-01/)
  assert.match(draft.pending[1].text, /AI 建议/)
})

test('只有动作或只有预期的半条验收转为待确认', (t) => {
  const root = makeRepo(t)
  const { session, context } = makeSession(root)
  const { analysis } = normalizeAnalysis(
    rawV3(context, {
      docDraft: draftPayload({
        features: [],
        acceptance: [
          {
            id: 'AC-09',
            featureIds: [],
            text: '部分退款需要人工复核',
            action: '提交部分退款',
            expected: '',
            provenance: 'user-stated',
          },
        ],
      }),
    }),
    { session, context },
  )
  const draft = analysis.docDraft
  assert.equal(draft.acceptance.length, 0)
  assert.equal(draft.pending.length, 1)
  assert.match(draft.pending[0].text, /验收待补/)
  assert.match(draft.pending[0].text, /AC-09/)
})

test('未知 provenance 归一为 ai-suggestion 并记录 warning', (t) => {
  const root = makeRepo(t)
  const { session, context } = makeSession(root)
  const { analysis, warnings } = normalizeAnalysis(
    rawV3(context, {
      docDraft: draftPayload({
        features: [
          {
            id: 'FR-01',
            title: '部分退款',
            behavior: '按金额退款',
            provenance: 'boss-said',
          },
        ],
        acceptance: [],
      }),
    }),
    { session, context },
  )
  assert.equal(analysis.docDraft.features.length, 0)
  assert.equal(analysis.docDraft.pending.length, 1)
  assert.match(analysis.docDraft.pending[0].text, /AI 建议/)
  assert.ok(warnings.some((entry) => entry.includes('未知来源 boss-said')), '应记录未知 provenance 的告警')
})

test('previous 合并沿用相同条款 ID，新条款占用下一个编号且 draftRevision 递增', (t) => {
  const root = makeRepo(t)
  const { session, context } = makeSession(root)
  const first = normalizeAnalysis(rawV3(context, { docDraft: draftPayload() }), { session, context }).analysis
  assert.equal(first.docDraft.features[0].id, 'FR-01')

  const second = normalizeAnalysis(
    rawV3(context, {
      docDraft: draftPayload({
        features: [
          {
            id: 'FR-01',
            title: '部分退款',
            behavior: '用户可选择退款金额并提交部分退款申请',
            provenance: 'user-stated',
          },
          {
            title: '退款进度查询',
            behavior: '用户可查看部分退款的处理进度',
            provenance: 'user-stated',
          },
        ],
        acceptance: [],
      }),
    }),
    { session: { ...session, docDraft: first.docDraft, draftRevision: first.docDraft.draftRevision }, context },
  ).analysis
  assert.equal(second.docDraft.features.length, 2)
  assert.equal(second.docDraft.features[0].id, 'FR-01')
  assert.equal(second.docDraft.features[1].id, 'FR-02')
  assert.equal(second.docDraft.draftRevision, 2)
  assert.equal(second.docDraft.meta.nextFr, 3)
})

test('人工锁定的功能条款不被模型覆盖，只记录 warning', (t) => {
  const root = makeRepo(t)
  const { session, context } = makeSession(root)
  const first = normalizeAnalysis(rawV3(context, { docDraft: draftPayload() }), { session, context }).analysis
  const locked = { ...session, docDraft: first.docDraft, draftRevision: first.docDraft.draftRevision, lockedClauses: [{ kind: 'feature', id: 'FR-01' }] }
  const { analysis, warnings } = normalizeAnalysis(
    rawV3(context, {
      docDraft: draftPayload({
        features: [
          {
            id: 'FR-01',
            title: '模型自作主张的标题',
            behavior: '模型重写的行为描述',
            provenance: 'user-stated',
          },
        ],
        acceptance: [],
      }),
    }),
    { session: locked, context },
  )
  assert.equal(analysis.docDraft.features[0].title, '部分退款')
  assert.equal(analysis.docDraft.features[0].behavior, '用户可选择退款金额并提交部分退款申请')
  assert.ok(warnings.some((entry) => entry.includes('人工锁定')), '应记录锁定条款未被覆盖的告警')
})

test('v2 输出合成 legacy 草稿：未确认内容进入待确认', (t) => {
  const root = makeRepo(t)
  const { session, context } = makeSession(root)
  const { analysis } = normalizeAnalysis(
    {
      schemaVersion: 'intent-review.v2',
      contextSnapshotId: context.contextSnapshotId,
      items: [
        {
          itemId: 'ITM-1',
          recommendedRoute: 'create',
          candidate: {
            title: '部分退款',
            goal: '支持部分退款',
            acceptance: [{ action: '提交部分退款', expected: '生成金额正确的退款单' }],
          },
        },
      ],
    },
    { session, context },
  )
  assert.equal(analysis.schemaVersion, 'intent-review.v2')
  const draft = analysis.docDraft
  assert.equal(draft.schema, DRAFT_SCHEMA)
  assert.equal(draft.legacy, true)
  assert.equal(draft.features.length, 0)
  assert.equal(draft.acceptance.length, 0)
  assert.equal(draft.pending.length, 2)
  assert.match(draft.pending[0].text, /未确认/)
  assert.match(draft.pending[1].text, /AC-01/)
})

test('v3 缺少 docDraft 时按候选条目合成草稿并告警', (t) => {
  const root = makeRepo(t)
  const { session, context } = makeSession(root)
  const { analysis, warnings } = normalizeAnalysis(rawV3(context), { session, context })
  assert.equal(analysis.docDraft.schema, DRAFT_SCHEMA)
  assert.equal(analysis.docDraft.legacy, true)
  assert.equal(analysis.docDraft.features.length, 0)
  assert.ok(warnings.some((entry) => entry.includes('缺少 docDraft')))
})

test('v1 分析不产生需求草稿，保持旧行为', (t) => {
  const root = makeRepo(t)
  const { session, context } = makeSession(root)
  const { analysis } = normalizeAnalysis(
    {
      schemaVersion: 'intent-review.v1',
      contextSnapshotId: context.contextSnapshotId,
      items: [{ itemId: 'ITM-1', recommendedRoute: 'create', candidate: { title: '部分退款' } }],
    },
    { session, context },
  )
  assert.equal(analysis.docDraft, null)
})

test('normalizeDocDraft 接受显式 draftRevision 与 basedOn 版本', () => {
  const draft = normalizeDocDraft(draftPayload(), {
    draftRevision: 7,
    inputRevision: 3,
    sessionRevision: 5,
  })
  assert.equal(draft.draftRevision, 7)
  assert.equal(draft.basedOnInputRevision, 3)
  assert.equal(draft.basedOnSessionRevision, 5)
  const next = normalizeDocDraft(draftPayload(), { previous: { ...draft, draftRevision: 4 } })
  assert.equal(next.draftRevision, 5)
})

test('setDocDraft 合并补丁、递增 draftRevision/sessionRevision 并重算哈希', (t) => {
  const root = makeRepo(t)
  const { session } = makeSession(root)
  const first = setDocDraft({
    root,
    session,
    docDraft: {
      goal: '支持部分退款',
      features: [{ title: '部分退款', behavior: '按金额退款', provenance: 'human-edit' }],
    },
  })
  assert.equal(first.draftRevision, 1)
  assert.equal(first.sessionRevision, 2)
  assert.equal(first.docDraft.draftRevision, 1)
  assert.equal(first.docDraft.basedOnInputRevision, 1)
  assert.equal(first.docDraft.basedOnSessionRevision, session.sessionRevision)
  assertFiniteHash(first.docDraft.docHash)
  const firstHash = first.docDraft.docHash

  const second = setDocDraft({ root, session: first, docDraft: { goal: '支持按金额部分退款' } })
  assert.equal(second.draftRevision, 2)
  assert.equal(second.sessionRevision, 3)
  assert.equal(second.docDraft.goal, '支持按金额部分退款')
  assert.equal(second.docDraft.features.length, 1, '浅合并应保留未提交的条款')
  assert.notEqual(second.docDraft.docHash, firstHash)
  assert.equal(second.docDraft.basedOnSessionRevision, 2)
})

test('setDocDraft preserves paragraph breaks in goal and problem but rejects other controls', (t) => {
  const root = makeRepo(t)
  const { session } = makeSession(root)
  const saved = setDocDraft({
    root,
    session,
    docDraft: {
      goal: '缩短交付等待\r\n保留人工决策',
      problem: '重复操作导致返工\n需要按批次复盘',
    },
  })

  assert.equal(saved.docDraft.goal, '缩短交付等待\n保留人工决策')
  assert.equal(saved.docDraft.problem, '重复操作导致返工\n需要按批次复盘')
  assert.throws(
    () => setDocDraft({ root, session: saved, docDraft: { problem: '不可见\u0000字符' } }),
    (error) => error?.code === 'invalid-request' && /docDraft\.problem/.test(error.message),
  )
})

test('recordAnswers 后草稿 draftRevision 递增，setInput 清空草稿与锁定', (t) => {
  const root = makeRepo(t)
  const { session } = makeSession(root)
  const drafted = setDocDraft({
    root,
    session,
    docDraft: { goal: '支持部分退款', features: [{ title: '部分退款', behavior: '按金额退款', provenance: 'human-edit' }] },
  })
  const withQuestion = saveSession({
    root,
    session: {
      ...drafted,
      nextQuestion: {
        questionId: 'Q-1',
        itemIds: ['ITM-1'],
        text: '部分退款是否需要主动通知用户？',
        whyNow: '决定是否包含通知能力',
        options: [{ id: 'notify', label: '需要主动通知', impact: '范围增加通知渠道' }],
        allowFreeText: true,
      },
    },
  })
  const answered = recordAnswers({ root, session: withQuestion, answers: [{ questionId: 'Q-1', optionId: 'notify' }] })
  assert.equal(answered.changed, true)
  assert.equal(answered.session.draftRevision, 2)
  assert.equal(answered.session.docDraft.draftRevision, 2)
  assert.equal(answered.session.sessionRevision, 3)
  assertFiniteHash(answered.session.docDraft.docHash)

  const locked = lockClauses({ root, session: answered.session, clauses: [{ kind: 'goal' }] })
  assert.equal(locked.lockedClauses.length, 1)
  const cleared = setInput({ root, session: locked, input: { text: '新的退款需求：部分退款需要支持多次发起。' } })
  assert.equal(cleared.docDraft, null)
  assert.equal(cleared.draftRevision, 0)
  assert.deepEqual(cleared.lockedClauses, [])
  assert.equal(cleared.state, 'editing')
})

test('lockClauses/unlockClauses 幂等去重且只在真实变化时递增 sessionRevision', (t) => {
  const root = makeRepo(t)
  const { session } = makeSession(root)
  const locked = lockClauses({
    root,
    session,
    clauses: [{ kind: 'goal' }, { kind: 'feature', id: 'FR-01' }, { kind: 'feature', id: 'FR-01' }],
  })
  assert.deepEqual(locked.lockedClauses, [{ kind: 'goal', id: null }, { kind: 'feature', id: 'FR-01' }])
  assert.equal(locked.sessionRevision, session.sessionRevision + 1)
  const again = lockClauses({ root, session: locked, clauses: [{ kind: 'goal' }] })
  assert.equal(again.sessionRevision, locked.sessionRevision, '重复锁定不应递增版本')

  const unlocked = unlockClauses({ root, session: locked, clauses: [{ kind: 'feature', id: 'FR-01' }] })
  assert.deepEqual(unlocked.lockedClauses, [{ kind: 'goal', id: null }])
  assert.equal(unlocked.sessionRevision, locked.sessionRevision + 1)
  const noop = unlockClauses({ root, session: unlocked, clauses: [{ kind: 'feature', id: 'FR-99' }] })
  assert.equal(noop.sessionRevision, unlocked.sessionRevision)

  assert.throws(
    () => lockClauses({ root, session: unlocked, clauses: [] }),
    (error) => error?.code === 'invalid-request',
  )
  assert.throws(
    () => unlockClauses({ root, session: unlocked, clauses: [{ kind: 'unknown' }] }),
    (error) => error?.code === 'invalid-request',
  )
})

test('view 投影草稿、修订版本、锁定与条目草稿摘要', (t) => {
  const root = makeRepo(t)
  const { session } = makeSession(root)
  const drafted = setDocDraft({
    root,
    session,
    docDraft: { goal: '支持部分退款', features: [{ title: '部分退款', behavior: '按金额退款', provenance: 'human-edit' }] },
  })
  const locked = lockClauses({ root, session: drafted, clauses: [{ kind: 'goal' }] })
  const withItem = saveSession({
    root,
    session: {
      ...locked,
      items: [
        {
          itemId: 'ITM-1',
          candidate: { title: '部分退款', goal: '支持部分退款' },
          docDraft: {
            docHash: locked.docDraft.docHash,
            draftRevision: locked.draftRevision,
            basedOnInputRevision: locked.docDraft.basedOnInputRevision,
            basedOnSessionRevision: locked.docDraft.basedOnSessionRevision,
          },
        },
      ],
    },
  })
  const view = renderSessionView(withItem)
  assert.equal(view.draftRevision, 1)
  assert.equal(view.docDraft.schema, DRAFT_SCHEMA)
  assert.equal(view.docDraft.docHash, locked.docDraft.docHash)
  assert.deepEqual(view.lockedClauses, [{ kind: 'goal', id: null }])
  assert.equal(view.sessionRevision, withItem.sessionRevision)
  assert.equal(view.items[0].docDraft.draftRevision, 1)
  assert.equal(view.items[0].docDraft.docHash, locked.docDraft.docHash)
  assert.equal(view.items[0].docDraft.basedOnInputRevision, 1)
})

test('applyAnalysis 应用 v3 草稿：基于当前输入/会话版本并递增 draftRevision', (t) => {
  const root = makeRepo(t)
  const { session, context } = makeSession(root)
  const { analysis } = normalizeAnalysis(
    rawV3(context, {
      docDraft: draftPayload(),
      questions: [
        {
          questionId: 'Q-1',
          itemIds: ['ITM-1'],
          text: '部分退款后是否需要主动通知用户？',
          whyNow: '决定是否包含通知能力',
          options: [{ id: 'notify', label: '需要主动通知', impact: '范围增加通知渠道' }],
          allowFreeText: true,
          dependsOn: [],
        },
      ],
    }),
    { session, context },
  )
  const applied = applyAnalysis({ session, analysis, inputRevision: session.input.inputRevision })
  assert.equal(applied.docDraft.schema, DRAFT_SCHEMA)
  assert.equal(applied.draftRevision, applied.docDraft.draftRevision)
  assert.ok(applied.draftRevision >= 1)
  assert.equal(applied.docDraft.basedOnInputRevision, session.input.inputRevision)
  assert.equal(applied.docDraft.basedOnSessionRevision, session.sessionRevision)
  assert.equal(applied.questionGroup.questions.length, 1)
  assert.equal(applied.state, 'needs_input')

  const reapplied = applyAnalysis({ session: applied, analysis, inputRevision: applied.input.inputRevision })
  assert.ok(
    reapplied.draftRevision > applied.draftRevision,
    `再次应用分析应继续递增 draftRevision（${reapplied.draftRevision} <= ${applied.draftRevision}）`,
  )
})
