/**
 * Adjudication tests: clause fingerprints, three-channel recall, the rejection
 * ledger, and the eight-verdict preconditions.
 *
 * These tests exist because the previous matcher could not be wrong in a
 * *visible* way: it returned a similarity score and everyone treated the top
 * score as a verdict. Each case below is a judgement that must be auditable.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  IntentError,
  adjudicateClause,
  buildIntentContext,
  confirmIntent,
  createSession,
  evaluateReadiness,
  fingerprintClause,
  matchRejections,
  readRejections,
  writeRejection,
  saveSession,
} from '../../src/intent/index.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
const fixture = join(repoRoot, 'fixtures/order-refund')

function makeRepo(t) {
  const root = mkdtempSync(join(tmpdir(), 'alm-intent-adjudication-'))
  cpSync(fixture, root, { recursive: true })
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

// ---------------------------------------------------------------------------
// Fingerprints and pairwise verdicts
// ---------------------------------------------------------------------------

test('同一件事换一种说法必须判 covered，而不是“相似度低”', () => {
  const clause = '当用户手动修改过需求标题后，AI 自动提炼不得覆盖该标题。'
  const same = adjudicateClause({ query: '标题自动提炼后不得覆盖我手动改过的标题', clause })
  assert.equal(same.verdict, 'covered')
  assert.ok(same.reasons.length > 0, '判定必须带理由')

  const paraphrased = adjudicateClause({ query: 'AI 提炼完别把我改的标题又改回去', clause })
  assert.equal(paraphrased.verdict, 'covered')
  assert.equal(paraphrased.keyword > 0 || paraphrased.structural > 0.6, true)
})

test('词面几乎相同但动作相反，必须判 unrelated 而不是 covered', () => {
  const clause = '支持把需求列表导出为 CSV 文件。'
  assert.equal(adjudicateClause({ query: '支持导出 CSV', clause }).verdict, 'covered')
  const imported = adjudicateClause({ query: '支持导入 CSV', clause })
  assert.equal(imported.verdict, 'unrelated')
  assert.match(imported.reasons.join(' '), /动作不同/)
})

test('极性相反且作用于同一件事，必须判 conflict', () => {
  const clause = 'AI 自动提炼可以覆盖用户手动修改过的标题。'
  const result = adjudicateClause({ query: '标题自动提炼不得覆盖我手动改过的标题', clause })
  assert.equal(result.verdict, 'conflict')
  assert.match(result.reasons.join(' '), /极性相反/)
})

test('否定只作用于子句时不得把整句判成 deny', () => {
  // 「要自动记录，不要让我手工复制」是肯定诉求 + 从属否定。
  const print = fingerprintClause('澄清失败要自动记录到失败台账，不要让我手工复制报错')
  assert.equal(print.polarity, 'allow')
})

test('只有对象重合、没有对齐动作，最多判 partial', () => {
  const result = adjudicateClause({
    query: '标题不要太长',
    clause: '需求列表页标题超过 50 字时截断显示。',
  })
  assert.equal(result.verdict, 'partial')
})

// ---------------------------------------------------------------------------
// Rejection ledger
// ---------------------------------------------------------------------------

test('拒绝写入账本后，下一次同样的诉求必须被查到', (t) => {
  const root = makeRepo(t)
  const record = writeRejection(root, {
    statement: '需求列表要支持导出 CSV',
    reason: '已有 REQ-ALM-006 的导出能力覆盖同一场景',
    alternative: '使用 REQ-ALM-006 的导出，补一个字段',
    revisitTrigger: '外部系统要求固定列顺序时',
    at: '2026-11-01T00:00:00.000Z',
  })
  assert.ok(record?.id?.startsWith('REJ-'))
  assert.ok(existsSync(join(root, '.alm/rejections', `${record.id}.json`)))

  const all = readRejections(root)
  assert.equal(all.length, 1)
  const hits = matchRejections({ text: '我希望需求列表能导出 CSV', rejections: all })
  assert.equal(hits.length, 1)
  assert.equal(hits[0].revisitTrigger, '外部系统要求固定列顺序时')

  // 同一句话再被拒绝一次：不新建文件，只有 occurrences 累加。
  writeRejection(root, { statement: '需求列表要支持导出 CSV', reason: '同样理由', alternative: '同样替代' })
  assert.equal(readdirSync(join(root, '.alm/rejections')).length, 1)
  assert.equal(readRejections(root)[0].occurrences, 2)
})

test('无关诉求不会被否决账本命中', (t) => {
  const root = makeRepo(t)
  writeRejection(root, { statement: '需求列表要支持导出 CSV', reason: 'r', alternative: 'a' })
  const hits = matchRejections({ text: '退款单需要支持部分退款金额', rejections: readRejections(root) })
  assert.equal(hits.length, 0)
})

// ---------------------------------------------------------------------------
// Readiness preconditions for the new verdicts
// ---------------------------------------------------------------------------

function stagedSession(t, { items, text = '退款幂等：同一笔退款重复提交会生成多条退款单，需要同一幂等键只产生一张退款单。' }) {
  const root = makeRepo(t)
  const context = buildIntentContext({ root, projectId: 'PAY', intentText: text })
  const session = createSession({ root, project: 'PAY', input: { text, explicit: { priority: 'P1' } }, context })
  const saved = saveSession({ root, session: { ...session, items } })
  return { root, context, session: saved }
}

function baseItem(overrides = {}) {
  return {
    itemId: 'ITM-1',
    sourceRefs: [{ ref: 'input.text', line: null, endLine: null, quote: '需要同一幂等键只产生一张退款单' }],
    userProblem: '重复提交会产生多条退款单',
    desiredOutcome: '同一幂等键只产生一张退款单',
    recommendedRoute: 'create',
    routeRationale: null,
    related: [{ uid: 'REQ-PAY-004', revision: 2, match: 'covered', reason: '已有幂等条款' }],
    assumptions: [],
    unknowns: [],
    candidate: {
      title: '退款幂等补充约束',
      problem: '重复提交产生多条退款单',
      goal: '同一幂等键只产生一张退款单',
      inScope: [],
      outOfScope: [],
      acceptance: [{ precondition: null, action: '重复提交退款', expected: '返回首次退款单', judgement: null }],
    },
    fields: {},
    ...overrides,
  }
}

test('命中已覆盖条款时，create 被 duplicate-unadjudicated 拦下', (t) => {
  const { context, session } = stagedSession(t, { items: [baseItem()] })
  const readiness = evaluateReadiness({ session, contextNow: context, requireConfirmation: false })
  assert.equal(readiness.ready, false)
  assert.ok(readiness.reasons.some((entry) => entry.code === 'duplicate-unadjudicated'), JSON.stringify(readiness.reasons))
})

test('人类裁决“确实是新的”之后，同一个 create 放行', (t) => {
  const item = baseItem({ fields: { adjudication: { value: { duplicate: 'new', reason: 'human: 确实是新的' }, source: 'human' } } })
  const { context, session } = stagedSession(t, { items: [item] })
  const readiness = evaluateReadiness({ session, contextNow: context, requireConfirmation: false })
  assert.ok(!readiness.reasons.some((entry) => entry.code === 'duplicate-unadjudicated'), JSON.stringify(readiness.reasons))
})

test('extend 必须有新增条款：与基线完全重合时拦下，新增一条即放行', (t) => {
  const baselineClause = '同一幂等键只产生一张退款单'
  const related = [{ uid: 'REQ-PAY-004', revision: 2, match: 'covered', reason: '已有幂等条款' }]
  const run = (acceptance, fields = {}) => {
    const item = baseItem({
      recommendedRoute: 'extend',
      related,
      candidate: { ...baseItem().candidate, acceptance: acceptance.map((text) => ({ expected: text, judgement: null })) },
      fields,
    })
    const staged = stagedSession(t, { items: [item] })
    // 基线验收来自简报：写一份可读的验收段，让条款级基线可核对。
    writeFileSync(join(staged.root, 'requirements/briefs/REQ-PAY-004.md'), '# REQ-PAY-004 退款幂等\n\n## 验收要求\n- ' + baselineClause + '\n')
    const context = buildIntentContext({ root: staged.root, projectId: 'PAY', intentText: '退款幂等：同一笔退款重复提交会生成多条退款单' })
    return evaluateReadiness({ session: staged.session, contextNow: context, requireConfirmation: false }).reasons.map((entry) => entry.code)
  }
  const blocked = run([baselineClause])
  assert.ok(blocked.includes('missing-extend-increment'), blocked.join(','))
  const released = run([baselineClause], { extendClauses: { value: ['幂等记录过期后必须记录重新发起的次数'], source: 'human' } })
  assert.ok(!released.includes('missing-extend-increment'), released.join(','))
})

test('split 少于两个可独立验收的部分不得成立', (t) => {
  const item = baseItem({ recommendedRoute: 'split', related: [] })
  const { context, session } = stagedSession(t, { items: [item] })
  const codes = evaluateReadiness({ session, contextNow: context, requireConfirmation: false }).reasons.map((entry) => entry.code)
  assert.ok(codes.includes('missing-split-parts'), codes.join(','))
})

test('defer 必须写触发条件', (t) => {
  const item = baseItem({ recommendedRoute: 'defer', related: [] })
  const { context, session } = stagedSession(t, { items: [item] })
  const codes = evaluateReadiness({ session, contextNow: context, requireConfirmation: false }).reasons.map((entry) => entry.code)
  assert.ok(codes.includes('missing-defer-trigger'), codes.join(','))
})

// ---------------------------------------------------------------------------
// Confirmation artifacts
// ---------------------------------------------------------------------------

test('decline 确认后写入否决账本，回执指向该账本条目', (t) => {
  const item = baseItem({ recommendedRoute: 'decline', related: [], candidate: null })
  const { root, context, session } = stagedSession(t, { items: [item] })
  const result = confirmIntent({
    root,
    sessionId: session.sessionId,
    actor: 'human:tester',
    idempotencyKey: 'decline-key-1',
    confirmation: {
      route: 'decline',
      items: [{ itemId: 'ITM-1', route: 'decline' }],
      reason: '已有替代',
      alternative: '用现有导出',
      revisitTrigger: '外部要求固定列时',
      contextSnapshotId: context.contextSnapshotId,
      expectedInputRevision: session.input.inputRevision,
    },
  })
  const ledger = readdirSync(join(root, '.alm/rejections'))
  assert.equal(ledger.length, 1)
  const record = JSON.parse(readFileSync(join(root, '.alm/rejections', ledger[0]), 'utf8'))
  assert.equal(record.reason, '已有替代')
  assert.equal(record.revisitTrigger, '外部要求固定列时')
  assert.equal(result.receipt.decision.decline.revisitTrigger, '外部要求固定列时')
})

test('defer 确认后写入观察项而不是需求', (t) => {
  const item = baseItem({ recommendedRoute: 'defer', related: [], fields: { deferTrigger: { value: '需求数超过 50 条', source: 'human' } } })
  const { root, context, session } = stagedSession(t, { items: [item] })
  const before = readdirSync(join(root, 'requirements')).length
  const result = confirmIntent({
    root,
    sessionId: session.sessionId,
    actor: 'human:tester',
    idempotencyKey: 'defer-key-1',
    confirmation: {
      route: 'defer',
      items: [{ itemId: 'ITM-1', route: 'defer' }],
      contextSnapshotId: context.contextSnapshotId,
      expectedInputRevision: session.input.inputRevision,
    },
  })
  assert.equal(readdirSync(join(root, 'requirements')).length, before)
  const artifacts = (result.artifacts ?? []).filter((entry) => entry.kind === 'observation')
  assert.equal(artifacts.length, 1)
  const record = JSON.parse(readFileSync(join(root, artifacts[0].path), 'utf8'))
  assert.equal(record.trigger, '需求数超过 50 条')
})

test('split 确认后只落拆分计划，不直接生成需求', (t) => {
  const item = baseItem({
    recommendedRoute: 'split',
    related: [],
    fields: {
      splitParts: {
        value: [
          { title: '自动发现缺陷', acceptance: ['失败运行写入台账'] },
          { title: '自动修复缺陷', acceptance: ['策略调整后重跑成功'] },
        ],
        source: 'human',
      },
    },
  })
  const { root, context, session } = stagedSession(t, { items: [item] })
  const before = readdirSync(join(root, 'requirements')).length
  const result = confirmIntent({
    root,
    sessionId: session.sessionId,
    actor: 'human:tester',
    idempotencyKey: 'split-key-1',
    confirmation: {
      route: 'split',
      items: [{ itemId: 'ITM-1', route: 'split' }],
      contextSnapshotId: context.contextSnapshotId,
      expectedInputRevision: session.input.inputRevision,
    },
  })
  assert.equal(readdirSync(join(root, 'requirements')).length, before)
  const plan = (result.artifacts ?? []).find((entry) => entry.kind === 'split-plan')
  assert.ok(plan, JSON.stringify(result.artifacts))
  const record = JSON.parse(readFileSync(join(root, plan.path), 'utf8'))
  assert.equal(record.parts.length, 2)
})

test('decline 缺少理由时拒绝确认，且不落账本', (t) => {
  const item = baseItem({ recommendedRoute: 'decline', related: [], candidate: null })
  const { root, context, session } = stagedSession(t, { items: [item] })
  assert.throws(
    () => confirmIntent({
      root,
      sessionId: session.sessionId,
      idempotencyKey: 'decline-key-2',
      confirmation: {
        route: 'decline',
        items: [{ itemId: 'ITM-1', route: 'decline' }],
        contextSnapshotId: context.contextSnapshotId,
        expectedInputRevision: session.input.inputRevision,
      },
    }),
    (error) => error instanceof IntentError && error.details?.reasons?.some((reason) => reason.code === 'missing-decline-reason'),
  )
  assert.equal(existsSync(join(root, '.alm/rejections')) ? readdirSync(join(root, '.alm/rejections')).length : 0, 0)
})
