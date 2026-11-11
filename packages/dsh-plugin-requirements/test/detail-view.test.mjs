import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  DETAIL_VIEW_SCHEMA,
  collectedTimelinePage,
  deriveDetailView,
  parseBodySections,
  primaryActionFor,
} from '../detail-view.mjs'
import { requirements } from '../query.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const fixture = join(repoRoot, 'fixtures/order-refund')
const NOW = Date.parse('2026-02-01T00:00:00.000Z')

test('bounded timeline keeps the latest facts and AI suggestions use their actual anchor', () => {
  const versions = Array.from({ length: 60 }, (_, index) => ({ date: new Date(NOW + index * 1000).toISOString(), subject: `commit-${index}` }))
  const detail = deriveDetailView(baseItem({ versions, aiReview: { stored: true, generatedAt: new Date(NOW + 100000).toISOString(), verdict: 'warn' } }))
  assert.equal(detail.record.timeline.length, 50)
  assert.equal(detail.record.timelineOmitted, 12)
  assert.equal(detail.record.timeline.some(entry => entry.title === 'commit-0'), false)
  assert.equal(detail.record.timeline.some(entry => entry.title === 'commit-59'), true)
  assert.equal(detail.record.timeline.at(-1).kind, 'ai-review')
  assert.equal(detail.record.timeline.at(-1).ref.anchor, 'delivery-ai-suggestions')
  const page = collectedTimelinePage(baseItem({ versions, aiReview: { stored: true, generatedAt: new Date(NOW + 100000).toISOString(), verdict: 'warn' } }), detail.record.timelineOmitted, detail.record.timelineFingerprint)
  assert.equal(page.entries.length, 12)
  assert.equal(page.entries[0].title, '创建需求 · v1')
  assert.equal(page.next, null)
  assert.throws(() => collectedTimelinePage(baseItem({ versions: versions.slice(1) }), detail.record.timelineOmitted, detail.record.timelineFingerprint), { code: 'timeline-changed' })
  assert.throws(() => collectedTimelinePage(baseItem(), -1, detail.record.timelineFingerprint), { code: 'timeline-cursor-invalid' })
  assert.equal(deriveDetailView(baseItem()).record.timelineOmitted, 0)
})

test('collected timeline pages preserve all events and reject changed snapshots', () => {
  const versions = Array.from({ length: 151 }, (_, index) => ({ date: new Date(NOW + index * 1000).toISOString(), subject: `commit-${index}` }))
  const item = baseItem({ versions })
  const record = deriveDetailView(item).record
  let before = record.timelineOmitted
  let older = []
  while (before) {
    const page = collectedTimelinePage(item, before, record.timelineFingerprint)
    older = [...page.entries, ...older]
    before = page.next
  }
  assert.deepEqual([...older, ...record.timeline].map(entry => entry.title), ['创建需求 · v1', ...versions.map(entry => entry.subject)])
  assert.throws(() => collectedTimelinePage(baseItem({ versions: [...versions, { date: new Date(NOW + 200000).toISOString(), subject: 'new' }] }), record.timelineOmitted, record.timelineFingerprint), { code: 'timeline-changed' })
})

test('generic convergence notes are replaced with a concrete incremental change summary', () => {
  const item = baseItem({
    specConvergences: [{
      at: '2026-02-01T01:00:00.000Z',
      beforeRevision: 3,
      revision: 4,
      evolutionNote: '主对话定稿',
      sourceSession: 'requirements-version-badge-feedback',
      diff: {
        added: [{ kind: 'acceptance', id: 'AC-05', label: '支持高版本徽章悬停查看演进摘要。' }],
        modified: [],
        removed: [],
      },
      acceptanceCriteria: {
        before: [{ id: 'AC-01', text: '既有规则。' }],
        after: [{ id: 'AC-01', text: '既有规则。' }, { id: 'AC-05', text: '支持高版本徽章悬停查看演进摘要。' }],
      },
    }],
  })
  const entry = deriveDetailView(item).record.timeline.find(event => event.kind === 'spec_converged')
  assert.equal(entry.title, '需求基线已收敛 · v3 → v4')
  assert.match(entry.detail, /新增 1 项验收标准（AC-05: 支持高版本徽章悬停查看演进摘要。）/)
  assert.match(entry.detail, /来源会话：requirements-version-badge-feedback/)
  assert.ok(entry.specDelta)
})

test('candidate projection retains development branch synchronization and architecture archive facts', () => {
  const view = deriveDetailView(baseItem({
    candidate: {
      exists: true, id: 'CAND-DEV-001', current: true, treeHash: 'aaaabbbbcccc',
      architecture: { path: 'requirements/architecture/REQ-TEST-001-design.md', indexPath: 'requirements/architecture/ARCHITECTURE-LEDGER.md' },
      development: { devBranch: 'develop', devCommitSha: '1234567890abcdef1234567890abcdef12345678', pushedToRemoteDev: true, reason: null },
    },
  }))
  assert.equal(view.summaries.candidate.architecture.path, 'requirements/architecture/REQ-TEST-001-design.md')
  assert.equal(view.summaries.candidate.development.devBranch, 'develop')
  assert.equal(view.summaries.candidate.development.pushedToRemoteDev, true)
  assert.match(view.summaries.candidate.development.devCommitSha, /^1234567/)
})

test('timeline distinguishes human signoff from technical checks and preserves stale status', () => {
  const item = baseItem({ humanAcceptance: { signoff: { decision: 'approve', at: '2026-01-10T00:00:00Z', candidateId: 'CAND-1', valid: false } } })
  const entry = deriveDetailView(item).record.timeline.find(event => event.kind === 'human-signoff')
  assert.equal(entry.title, '人工签收交付')
  assert.equal(entry.detail, 'CAND-1 · 当前已失效')
  assert.equal(entry.ref.anchor, 'delivery-candidate')
  item.humanAcceptance.signoff.valid = true
  assert.match(deriveDetailView(item).record.timeline.find(event => event.kind === 'human-signoff').detail, /当前有效/)
  item.humanAcceptance.signoff.decision = 'reject'
  assert.equal(deriveDetailView(item).record.timeline.some(event => event.kind === 'human-signoff'), false)
})

test('timeline preserves separate signoffs with identical timestamps and presentation', () => {
  const signoff = { decision: 'approve', at: '2026-01-10T00:00:00Z', candidateId: 'CAND-1', valid: true }
  const item = baseItem({ humanAcceptance: { signoffs: [signoff, { ...signoff }, { ...signoff, candidateId: 'CAND-2' }] } })
  const entries = deriveDetailView(item).record.timeline.filter(event => event.kind === 'human-signoff')
  assert.equal(entries.length, 3)
  assert.deepEqual(entries.map(event => event.detail), ['CAND-1 · 当前有效', 'CAND-1 · 当前有效', 'CAND-2 · 当前有效'])
})

test('timeline does not present stale or unverified technical checks as current passes', () => {
  for (const [current, complete, expected] of [[true, true, '当前技术检查通过'], [false, true, '历史通过，当前已过期'], [null, true, '历史通过，当前适用性未知'], [true, false, '历史通过，当前适用性未知']]) {
    const item = baseItem({ acceptance: { registered: true, latest: { finishedAt: '2026-01-10T00:00:00Z', result: 'pass', current, complete } } })
    const entry = deriveDetailView(item).record.timeline.find(event => event.kind === 'acceptance')
    assert.equal(entry.detail, expected)
  }
})

test('incomplete or unverified passing checks do not suggest generating a candidate', () => {
  for (const [current, complete] of [[true, false], [true, null], [null, true], [false, true]]) {
    const acceptance = passingAcceptance({ latest: { ...passingAcceptance().latest, current, complete } })
    const detail = deriveDetailView(baseItem({ acceptance }))
    assert.notEqual(detail.context.kind, 'candidate-pending')
    assert.notEqual(detail.primaryAction?.id, 'create-candidate')
  }
})

test('unknown acceptance applicability stays unknown instead of becoming stale', () => {
  const acceptance = passingAcceptance({ latest: { ...passingAcceptance().latest, current: null } })
  const view = deriveDetailView(baseItem({ acceptance }))
  assert.equal(view.summaries.acceptance.current, null)
  assert.ok(attentionOf(view, 'evidence-unknown'))
  assert.equal(attentionOf(view, 'evidence-stale'), undefined)
  assert.notEqual(view.primaryAction.id, 'create-candidate')
})

test('historical failed checks identify whether applicability is unknown or stale', () => {
  for (const [current, expected] of [[null, '当前适用性未确认'], [false, '该结果已过期']]) {
    const acceptance = failingAcceptance({ latest: { ...failingAcceptance().latest, current } })
    const view = deriveDetailView(baseItem({ acceptance }))
    assert.equal(attentionOf(view, 'acceptance-failed').title, '历史检查未通过')
    assert.match(attentionOf(view, 'acceptance-failed').detail, new RegExp(expected))
    assert.notEqual(view.primaryAction.id, 'create-candidate')
  }
})

test('unknown candidate validity stays unknown and cannot enable signoff', () => {
  const view = deriveDetailView(baseItem({ candidate: { exists: true, id: 'CAND-1', current: null }, delivery: { key: 'awaiting-acceptance' }, decision: baseDecision({ state: 'ready-for-human' }) }))
  assert.equal(view.freshness.candidateCurrent, null)
  assert.equal(attentionOf(view, 'candidate-stale').title, '交付候选有效性未知')
  assert.equal(view.primaryAction.enabled, false)
})

test('verification summary keeps release history and every full criterion without inventing coverage', () => {
  const briefText = '## 验收要求\n- AC1 支持所有用户\n- AC2 不得丢失历史记录'
  const released = deriveDetailView(baseItem({ briefText, delivery: { key: 'accepted', source: 'release' }, release: { exists: true, status: 'released', released: true }, acceptance: failingAcceptance() }))
  assert.equal(released.verificationSummary.kind, 'released-history')
  assert.match(released.verificationSummary.explanation, /不会撤销/)
  assert.match(released.verificationSummary.criteria[0].text, /AC2 不得丢失历史记录/)
  for (const criterion of released.verificationSummary.criteria) {
    assert.equal(criterion.status, 'unverified')
    assert.equal(criterion.evidence, null)
  }
  const passed = deriveDetailView(baseItem({ briefText, acceptance: passingAcceptance() }))
  assert.equal(passed.verificationSummary.kind, 'current')
  assert.equal(passed.verificationSummary.technicalResult, 'pass')
  assert.equal(passed.verificationSummary.criteria[0].status, 'unverified')
  const stale = deriveDetailView(baseItem({ acceptance: passingAcceptance({ latest: { ...passingAcceptance().latest, current: false } }) }))
  assert.equal(stale.verificationSummary.kind, 'outdated')
})

test('current matter counts only a complete business decision or trusted human acceptance as mine', () => {
  const run = { exists: true, id: 'RUN-X', status: 'waiting-input', awaitingAnswer: true }
  const legacy = deriveDetailView(baseItem({ run }))
  assert.equal(legacy.currentMatter.kind, 'technical-block')
  assert.equal(legacy.currentMatter.requiresHuman, false)
  assert.equal(legacy.currentMatter.action.id, 'answer-run')
  const business = deriveDetailView(baseItem({ run: { ...run, decisionPresentation: { complete: true, businessQuestion: '先做哪部分？', decisions: [{ id: 'one' }] } } }))
  assert.equal(business.currentMatter.kind, 'decision')
  assert.equal(business.currentMatter.requiresHuman, true)
  const idle = deriveDetailView(baseItem({ run: { ...run, awaitingAnswer: false, idleHandback: true } }))
  assert.equal(idle.currentMatter.requiresHuman, false)
  assert.match(idle.currentMatter.explanation, /未获得本轮自动续推授权/)
  const candidate = { exists: true, current: true, id: 'CAND-X' }
  const ready = deriveDetailView(baseItem({ candidate, delivery: { key: 'awaiting-acceptance' }, decision: baseDecision({ state: 'ready-for-human' }) }))
  assert.equal(ready.currentMatter.kind, 'awaiting-acceptance')
  assert.equal(ready.currentMatter.requiresHuman, true)
  const stale = deriveDetailView(baseItem({ candidate: { ...candidate, current: false }, delivery: { key: 'awaiting-acceptance' } }))
  assert.equal(stale.currentMatter.requiresHuman, false)
})

test('current matter preserves auto budget facts and stops without manufacturing a question', () => {
  const autoAdvance = { authorized: true, dispatches: 2, maxDispatches: 3, status: 'running' }
  const run = { exists: true, id: 'RUN-X', status: 'running', active: true, idleHandback: false, autoAdvance }
  const active = deriveDetailView(baseItem({ run }))
  assert.equal(active.currentMatter.kind, 'automatic')
  assert.equal(active.currentMatter.requiresHuman, false)
  assert.match(active.currentMatter.explanation, /2\/3/)
  assert.deepEqual(active.currentMatter.progress.autoAdvance, autoAdvance)
  const stopped = deriveDetailView(baseItem({ run: { ...run, autoAdvance: { ...autoAdvance, status: 'stopped', reason: 'auto-budget-exhausted' } } }))
  assert.equal(stopped.currentMatter.kind, 'technical-block')
  assert.equal(stopped.currentMatter.requiresHuman, false)
  assert.match(stopped.currentMatter.explanation, /用完 3 次/)
  assert.equal(stopped.currentMatter.progress.autoAdvance.reason, 'auto-budget-exhausted')
})

function briefText(...parts) {
  return parts.join('\n')
}

function baseDecision(overrides = {}) {
  return {
    schema: 'alm.evidence.decision/v1',
    state: 'unchecked',
    label: '未检查',
    tone: 'neutral',
    topGap: null,
    gaps: [],
    nextStep: null,
    policy: { risk: 'normal', requiredRoles: [], requiresAcceptance: true },
    coverage: { rolesCompleted: 0, rolesRequired: 0, missingRoles: [] },
    aiReview: { verdict: null, findings: 0 },
    adoption: null,
    candidate: null,
    humanAccepted: false,
    ...overrides,
  }
}

function passingAcceptance(overrides = {}) {
  return {
    schema: 'alm.acceptance.summary/v2',
    registered: true,
    commandCount: 2,
    commands: [
      { id: 'CMD-REFUND-1', command: 'node --test acceptance.test.mjs' },
      { id: 'CMD-REFUND-2', command: 'node --test refund.test.mjs' },
    ],
    latest: {
      result: 'pass',
      headSha: '64ec15e6aa11bb22cc33',
      finishedAt: '2026-01-10T08:00:00.000Z',
      commands: 2,
      file: 'evidence/acceptance/REQ-TEST-001.json',
      current: true,
      complete: true,
      requirementHash: 'hash-1',
      testRevision: 'tests@1',
      environment: 'local',
      source: 'executor',
      missing: [],
      staleReason: null,
    },
    ...overrides,
  }
}

function failingAcceptance(overrides = {}) {
  return passingAcceptance({
    latest: {
      ...passingAcceptance().latest,
      result: 'fail',
      headSha: '64ec15e6aa11bb22cc33',
      current: true,
    },
    ...overrides,
  })
}

function baseItem(overrides = {}) {
  return {
    id: 'REQ-TEST-001',
    businessId: 'BIZ-001',
    occurrenceKey: 'REQ-TEST-001#1',
    title: '退款需求',
    status: 'active',
    statusLabel: '进行中',
    owner: 'alice',
    project: 'shop',
    projectName: '商城',
    priority: 'P1',
    category: 'feature',
    revision: 3,
    brief: 'requirements/REQ-TEST-001.md',
    briefText: briefText(
      '## 目标',
      '实现退款流程。',
      '## 范围',
      '退款接口与订单状态。',
      '## 验收要求',
      '退款成功后订单状态为 refunded。',
    ),
    sources: ['requirement'],
    attachments: 0,
    attachmentFiles: [],
    verifiedBy: ['TEST-REFUND-001'],
    file: 'requirements/REQ-TEST-001.md',
    root: '/repo/fixture',
    line: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    links: [],
    github: null,
    anomalies: [],
    acceptance: { schema: 'alm.acceptance.summary/v2', registered: false, commandCount: 0, commands: [], latest: null },
    candidate: { exists: false, id: null, current: false, reasons: [], treeHash: null, headSha: null, createdAt: null },
    closure: null,
    closed: false,
    decision: baseDecision(),
    run: { exists: false, id: null, status: null, label: null, active: false },
    delivery: { schema: 'alm.delivery.state/v1', key: 'pending', label: '待推进', source: 'default', reason: null },
    release: { exists: false, id: null, status: null, label: null },
    defect: { exists: false, defect: null, status: null, statusLabel: null, occurrenceCount: 0, regressionSuspected: false },
    nextAction: 'run-review',
    nextActionLabel: '运行评审',
    versions: [{ short: 'abc1234', date: '2026-01-02T00:00:00.000Z', subject: 'feat: refund' }],
    aiReview: { stored: false },
    ...overrides,
  }
}

function attentionKinds(view) {
  return view.attentionItems.map((entry) => entry.kind)
}

function attentionOf(view, kind) {
  return view.attentionItems.find((entry) => entry.kind === kind)
}

function collectUndefined(value, path = '$', out = []) {
  if (value === undefined) {
    out.push(path)
    return out
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectUndefined(entry, `${path}[${index}]`, out))
    return out
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) collectUndefined(entry, `${path}.${key}`, out)
  }
  return out
}

test('deriveDetailView survives an empty item and fills every key', () => {
  const view = deriveDetailView({}, { now: NOW })
  assert.equal(view.schema, DETAIL_VIEW_SCHEMA)
  assert.equal(view.context.kind, 'not-started')
  assert.equal(view.context.tone, 'neutral')
  assert.equal(view.primaryAction.id, 'start')
  assert.equal(view.primaryAction.enabled, true)
  assert.deepEqual(view.content.missing, ['目标', '范围', '验收要求'])
  assert.deepEqual(view.content.sections, [])
  assert.deepEqual(view.record.relations, [])
  assert.equal(view.summaries.run.exists, false)
  assert.equal(view.summaries.release, null)
  assert.equal(view.freshness.readAt, new Date(NOW).toISOString())
  assert.equal(view.freshness.candidateCurrent, null)
  assert.equal(view.tabs.delivery.badge, 1)
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(view)))
})

test('default review has zero coverage and only optional AI advice', () => {
  for (const item of [{}, baseItem(), baseItem({ decision: baseDecision({ policy: { requiredRoles: ['business', 'testing'] } }) })]) {
    const view = deriveDetailView(item, { now: NOW })
    const review = view.summaries.review
    assert.equal(review.state, 'advisory')
    assert.equal(review.optional, true)
    assert.equal(review.gating, false)
    assert.deepEqual(review.coverage, { completed: 0, total: 0, missing: [] })
    assert.deepEqual(review.roles, [])
    assert.equal(review.ai.stored, false)
    assert.equal(review.ai.verdict, null)
    assert.deepEqual(review.channels.map((channel) => channel.id), ['ai'])
    assert.match(review.channels[0].label, /可选/)
    assert.equal(attentionOf(view, 'review-pending'), undefined)
    assert.equal(attentionOf(view, 'review-blocked'), undefined)
    assert.equal(view.context.kind, 'not-started')
    assert.equal(view.primaryAction.id, 'start')
  }
})

test('historical review coverage and role verdicts remain facts, not delivery gates', () => {
  const roles = [
    { id: 'business', verdict: 'pass', findings: [] },
    { id: 'security', verdict: 'block', findings: [{ message: '历史安全建议' }] },
  ]
  for (const historical of [
    { coverage: { completed: 1, total: 4, missing: ['security', 'testing', 'delivery'] }, roles, summary: { blockers: 2 } },
    { summary: { coverage: { completed: 1, total: 3, missing: ['testing', 'security'] }, blockers: 1 }, roles },
    { coverage: { completed: 0, total: 0, missing: [] }, roles, summary: { blockers: 0 } },
  ]) {
    const item = baseItem({ review: historical, acceptance: passingAcceptance() })
    const before = JSON.stringify(item)
    const view = deriveDetailView(item, { now: NOW })
    assert.deepEqual(view.summaries.review.coverage, historical.coverage ?? historical.summary.coverage)
    assert.deepEqual(view.summaries.review.roles, roles)
    assert.equal(view.summaries.review.blockers, historical.summary.blockers)
    assert.equal(view.summaries.review.state, 'advisory')
    assert.equal(view.context.kind, 'candidate-pending')
    assert.equal(view.primaryAction.id, 'create-candidate')
    assert.equal(attentionOf(view, 'review-blocked'), undefined)
    assert.equal(attentionOf(view, 'review-pending'), undefined)
    assert.equal(JSON.stringify(item), before, 'projection must not rewrite historical verdicts')
  }
  const rolesOnly = deriveDetailView(baseItem({ review: { roles } }))
  assert.equal(rolesOnly.summaries.review.total, 2)
  assert.deepEqual(rolesOnly.summaries.review.roles, roles)
})

test('optional AI advice cannot hide failed, stale or missing acceptance evidence', () => {
  for (const verdict of ['pass', 'block']) {
    const aiReview = { stored: true, verdict, suggestions: 1 }
    for (const [acceptance, attention, expectedFocus] of [
      [failingAcceptance(), 'acceptance-failed', 'acceptance-failed'],
      [passingAcceptance({ latest: { ...passingAcceptance().latest, current: false, staleReason: 'head' } }), 'evidence-stale', 'not-started'],
      [passingAcceptance({ latest: null }), 'acceptance-missing', 'not-started'],
      [{ registered: false, latest: null }, 'acceptance-missing', 'not-started'],
    ]) {
      const item = baseItem({ aiReview, acceptance })
      const view = deriveDetailView(item)
      assert.equal(view.context.kind, expectedFocus)
      assert.ok(attentionOf(view, attention))
      assert.equal(attentionOf(view, attention).current, true)
      assert.notEqual(view.primaryAction.id, 'create-candidate')
      assert.notEqual(view.primaryAction.id, 'signoff')
      assert.notEqual(view.primaryAction.id, 'release')
      assert.equal(view.currentMatter.requiresHuman, false)
      assert.equal(view.summaries.aiReview.verdict, verdict)
      assert.equal(item.decision.humanAccepted, false)
    }
    for (const state of ['blocked', 'needs-clarification']) {
      const view = deriveDetailView(baseItem({ aiReview, acceptance: passingAcceptance(), decision: baseDecision({ state }) }))
      assert.equal(view.context.kind, 'acceptance-failed')
      assert.equal(view.primaryAction.id, 'start-fix')
    }
  }
})

test('AI advice and technical passes never fabricate a candidate or trusted human acceptance', () => {
  for (const verdict of ['pass', 'block']) {
    const aiReview = { stored: true, verdict, suggestions: 1 }
    const item = baseItem({ aiReview, acceptance: passingAcceptance() })
    const pending = deriveDetailView(item)
    assert.equal(pending.context.kind, 'candidate-pending')
    assert.equal(pending.summaries.candidate.exists, false)
    assert.equal(pending.currentMatter.requiresHuman, false)
    assert.equal(item.decision.humanAccepted, false)
    assert.equal(pending.summaries.release, null)
    const missing = deriveDetailView({ ...item, delivery: { key: 'awaiting-acceptance' }, decision: baseDecision({ state: 'ready-for-human' }) })
    assert.equal(missing.primaryAction.id, 'signoff')
    assert.equal(missing.primaryAction.enabled, false)
    assert.equal(missing.currentMatter.requiresHuman, false)
    for (const [current, state] of [[false, 'ready-for-human'], [true, 'unchecked']]) {
      const candidate = { exists: true, id: 'CAND-untrusted', current, reasons: ['工作区已变化'] }
      const view = deriveDetailView({ ...item, candidate, delivery: { key: 'awaiting-acceptance' }, decision: baseDecision({ state }) })
      assert.equal(view.currentMatter.requiresHuman, false)
      assert.equal(view.primaryAction.enabled, false)
      assert.notEqual(view.context.kind, 'accepted')
      assert.notEqual(view.context.kind, 'released')
      if (!current) assert.ok(attentionOf(view, 'candidate-stale'))
    }
    const ready = deriveDetailView({ ...item, candidate: { exists: true, id: 'CAND-ready', current: true }, delivery: { key: 'awaiting-acceptance' }, decision: baseDecision({ state: 'ready-for-human' }) })
    assert.equal(ready.currentMatter.requiresHuman, true)
    assert.equal(ready.primaryAction.id, 'signoff')
    assert.equal(ready.primaryAction.enabled, true)
    const denied = deriveDetailView({ ...item, candidate: { exists: true, id: 'CAND-ready', current: true }, delivery: { key: 'awaiting-acceptance' }, decision: baseDecision({ state: 'ready-for-human', signoff: { allowed: false } }) })
    assert.equal(denied.primaryAction.enabled, false)
    assert.equal(ready.context.kind, 'awaiting-acceptance')
    assert.equal(ready.summaries.release, null)
  }
})

test('closed requirement has no primary action and no secondary actions', () => {
  const view = deriveDetailView(
    baseItem({
      closed: true,
      closure: {
        schema: 'alm.closure/v1',
        requirement: 'REQ-TEST-001',
        mode: 'done',
        reason: '需求已完成',
        actor: 'alice',
        at: '2026-01-20T00:00:00.000Z',
      },
      delivery: { schema: 'alm.delivery.state/v1', key: 'closed', label: '已关闭', source: 'closure', reason: '需求已完成' },
    }),
    { now: NOW },
  )
  assert.equal(view.context.kind, 'closed')
  assert.equal(view.primaryAction, null)
  assert.deepEqual(view.secondaryActions, [])
  assert.match(view.context.explanation, /需求已关闭/)
  assert.match(view.context.explanation, /需求已完成/)
})

test('a waiting run asks the human to answer and targets that run', () => {
  const view = deriveDetailView(
    baseItem({
      run: {
        exists: true,
        id: 'RUN-001',
        status: 'waiting-input',
        label: '等待输入',
        phase: 'develop',
        active: true,
        stale: false,
        awaitingAnswer: true,
        idleHandback: false,
        decision: 'RUN-001-decision.md',
        lastActivityAt: '2026-01-15T00:00:00.000Z',
      },
      delivery: { schema: 'alm.delivery.state/v1', key: 'pending', label: '待推进', source: 'run', reason: null },
    }),
    { now: NOW },
  )
  assert.equal(view.context.kind, 'answer')
  assert.equal(view.context.headline, '需要你回答')
  assert.equal(view.primaryAction.id, 'answer-run')
  assert.equal(view.primaryAction.label, '回答并继续')
  assert.equal(view.primaryAction.enabled, true)
  assert.equal(view.primaryAction.target.runId, 'RUN-001')
  assert.equal(view.primaryAction.target.decisionRef, 'RUN-001-decision.md')
  assert.equal(view.context.question.ref, 'RUN-001-decision.md')
  assert.equal(view.context.question.title, '运行决策请求')
  assert.equal(view.context.question.runId, 'RUN-001')
  assert.match(view.context.explanation, /RUN-001/)
})

test('an interrupted run with a checkpoint can be resumed', () => {
  const view = deriveDetailView(
    baseItem({
      run: {
        exists: true,
        id: 'RUN-002',
        status: 'running',
        label: '运行',
        active: false,
        stale: true,
        awaitingAnswer: false,
        idleHandback: false,
        checkpoint: 'RUN-002-checkpoint.json',
        decision: null,
      },
      delivery: { schema: 'alm.delivery.state/v1', key: 'pending', label: '待推进', source: 'run-stale', reason: null },
    }),
    { now: NOW },
  )
  assert.equal(view.context.kind, 'run-interrupted')
  assert.equal(view.context.tone, 'danger')
  assert.equal(view.primaryAction.id, 'resume-run')
  assert.equal(view.primaryAction.target.runId, 'RUN-002')
  assert.match(view.context.explanation, /可从检查点恢复/)
})

test('an interrupted run without a checkpoint requires manual review', () => {
  const view = deriveDetailView(
    baseItem({
      run: {
        exists: true,
        id: 'RUN-003',
        status: 'running',
        label: '运行',
        active: false,
        stale: true,
        awaitingAnswer: false,
        idleHandback: false,
      },
      delivery: { schema: 'alm.delivery.state/v1', key: 'pending', label: '待推进', source: 'run-stale', reason: null },
    }),
    { now: NOW },
  )
  assert.equal(view.context.kind, 'run-interrupted')
  assert.equal(view.primaryAction.id, 'resume-run')
  assert.match(view.context.explanation, /无法确认可恢复，需人工核对/)
})

test('an active run is watched rather than started again', () => {
  const view = deriveDetailView(
    baseItem({
      run: {
        exists: true,
        id: 'RUN-004',
        status: 'running',
        label: '运行',
        active: true,
        stale: false,
        awaitingAnswer: false,
        idleHandback: false,
      },
      delivery: { schema: 'alm.delivery.state/v1', key: 'in-progress', label: '推进中', source: 'run', runId: 'RUN-004' },
    }),
    { now: NOW },
  )
  assert.equal(view.context.kind, 'run-active')
  assert.equal(view.context.tone, 'attention')
  assert.equal(view.primaryAction.id, 'watch-run')
  assert.equal(view.primaryAction.target.runId, 'RUN-004')
  assert.equal(view.primaryAction.enabled, true)
})

test('an idle handback asks the human what to do next', () => {
  const view = deriveDetailView(
    baseItem({
      run: {
        exists: true,
        id: 'RUN-005',
        status: 'waiting-input',
        label: '等待输入',
        active: false,
        stale: false,
        awaitingAnswer: false,
        idleHandback: true,
        decision: null,
      },
      delivery: { schema: 'alm.delivery.state/v1', key: 'pending', label: '待推进', source: 'run-idle', reason: null },
    }),
    { now: NOW },
  )
  assert.equal(view.context.kind, 'run-idle-handback')
  assert.equal(view.primaryAction.id, 'continue-run')
  assert.equal(view.primaryAction.target.runId, 'RUN-005')
})

test('awaiting acceptance offers signoff on the candidate', () => {
  const view = deriveDetailView(
    baseItem({
      candidate: {
        exists: true,
        id: 'CAND-001',
        current: true,
        reasons: [],
        treeHash: '0123456789abcdef0123',
        headSha: 'abc12345',
        createdAt: '2026-01-11T00:00:00.000Z',
      },
      decision: baseDecision({ state: 'ready-for-human', label: '待人工验收' }),
      delivery: {
        schema: 'alm.delivery.state/v1',
        key: 'awaiting-acceptance',
        label: '待验收',
        source: 'candidate',
        candidateId: 'CAND-001',
      },
    }),
    { now: NOW },
  )
  assert.equal(view.context.kind, 'awaiting-acceptance')
  assert.equal(view.primaryAction.id, 'signoff')
  assert.equal(view.primaryAction.label, '✓ 确认签收 (Signoff)')
  assert.equal(view.primaryAction.enabled, true)
  assert.equal(view.primaryAction.target.candidateId, 'CAND-001')
  assert.equal(view.summaries.candidate.treeHashShort, '01234567')
  assert.match(view.context.explanation, /CAND-001/)
})

test('live running and queued repairs outrank old failed or blocked evidence without dropping warnings', () => {
  for (const status of ['running', 'queued']) {
    for (const state of ['failed', 'stale', 'blocked', 'needs-clarification']) {
      const item = baseItem({
        delivery: { key: 'in-progress', label: '推进中' },
        run: { exists: true, id: 'RUN-live', status, active: true },
        decision: baseDecision({ state }),
        acceptance: { registered: true, latest: { result: 'fail', current: true } },
      })
      const view = deriveDetailView(item)
      assert.equal(view.context.kind, 'run-active')
      assert.equal(view.primaryAction.id, 'watch-run')
      assert.equal(view.primaryAction.enabled, true)
      assert.equal(view.primaryAction.target.runId, 'RUN-live')
      assert.deepEqual(view.secondaryActions.map((entry) => entry.id), ['refresh', 'open-record'])
      assert.ok(attentionKinds(view).includes('acceptance-failed'))
      assert.equal(view.summaries.acceptance.result, 'fail')
      assert.equal(deriveDetailView({ ...item, closed: true }).context.kind, 'closed')
      assert.equal(deriveDetailView({ ...item, delivery: { key: 'accepted', source: 'release' } }).context.kind, 'released')
      const answer = deriveDetailView({ ...item, run: { ...item.run, awaitingAnswer: true } })
      assert.equal(answer.primaryAction.id, 'answer-run')
      assert.equal(answer.primaryAction.enabled, true)
      for (const kind of ['not-started', 'acceptance-failed', 'candidate-pending', 'run-interrupted', 'run-idle-handback', 'accepted', 'release-authorized']) {
        const action = primaryActionFor({ ...view, context: { kind } })
        assert.equal(action.enabled, false, `${kind} must not launch conflicting work during a live run`)
      }
    }
  }
})

test('settled runs expose recovery instead of pretending they are live', () => {
  const run = { exists: true, id: 'RUN-old', status: 'running', active: true }
  for (const patch of [{ active: false }, { stale: true }, { idleHandback: true }, { status: 'waiting-input' }, { status: 'paused' }, { status: 'failed' }, { status: 'done' }, { status: 'cancelled' }, { exists: false }]) {
    const view = deriveDetailView(baseItem({
      run: { ...run, ...patch },
      acceptance: { registered: true, latest: { result: 'fail' } },
      decision: baseDecision({ state: 'failed' }),
    }))
    if (patch.stale || patch.status === 'failed') {
      assert.equal(view.context.kind, 'run-interrupted')
      assert.equal(view.primaryAction.id, 'resume-run')
    } else if (patch.idleHandback) {
      assert.equal(view.context.kind, 'run-idle-handback')
      assert.equal(view.primaryAction.id, 'continue-run')
    } else {
      assert.equal(view.context.kind, 'acceptance-failed')
      assert.equal(view.primaryAction.id, 'start-fix')
    }
  }
  for (const [key, kind] of [['awaiting-acceptance', 'awaiting-acceptance'], ['accepted', 'accepted']]) {
    const view = deriveDetailView(baseItem({ run, delivery: { key } }))
    assert.equal(view.context.kind, kind)
    assert.equal(view.primaryAction.enabled, false, 'inconsistent live run disables terminal mutation')
  }
})

test('an accepted and released requirement is a read-only success', () => {
  const view = deriveDetailView(
    baseItem({
      decision: baseDecision({ state: 'verified', label: '已验收' }),
      delivery: { schema: 'alm.delivery.state/v1', key: 'accepted', label: '已验收', source: 'human-signoff' },
      release: {
        exists: true,
        id: 'REL-001',
        status: 'released',
        label: 'v1.2.0',
        target: 'shop',
        version: '1.2.0',
        authorizedBy: 'alice',
        authorizedAt: '2026-01-18T00:00:00.000Z',
        releasedAt: '2026-01-19T00:00:00.000Z',
      },
    }),
    { now: NOW },
  )
  assert.equal(view.context.kind, 'released')
  assert.equal(view.context.tone, 'success')
  assert.equal(view.primaryAction, null)
  assert.equal(view.summaries.release.released, true)
  assert.equal(view.secondaryActions.length, 2)
  assert.match(view.context.explanation, /已发布/)
})

test('published delivery outranks old unanswered runs and stale or blocked evidence without deleting risk', () => {
  for (const state of ['stale', 'blocked', 'needs-clarification']) {
    const item = baseItem({
      delivery: { key: 'accepted', label: '已发布', source: 'release' },
      decision: baseDecision({ state, humanAccepted: false }),
      candidate: { exists: true, id: 'CAND-old', current: false, reasons: ['工作区已变化'] },
      run: { exists: true, id: 'RUN-old', status: 'waiting-input', awaitingAnswer: true, idleHandback: true },
      release: { exists: true, id: 'REL-new', status: 'draft', lastReleased: { exists: true, id: 'REL-published', status: 'released', label: '已发布' } },
    })
    const view = deriveDetailView(item, { now: NOW })
    assert.equal(view.context.kind, 'released')
    assert.equal(view.context.headline, '已发布')
    assert.equal(view.context.question, null)
    assert.equal(view.primaryAction, null)
    assert.equal(view.summaries.release.id, 'REL-published')
    assert.equal(view.summaries.run.awaitingAnswer, true)
    assert.equal(view.summaries.candidate.current, false)
    assert.ok(view.attentionItems.some((entry) => entry.kind === 'candidate-stale'))
    assert.equal(item.decision.humanAccepted, false)
    assert.equal(deriveDetailView({ ...item, closed: true }).context.kind, 'closed')
    const next = deriveDetailView({ ...item, revision: 2, delivery: { key: 'pending' } })
    assert.equal(next.context.kind, 'answer', 'a new delivery iteration must not inherit the old release focus')
    assert.equal(next.summaries.release.status, 'draft')
  }
})

test('an accepted requirement without a release offers release', () => {
  const withCandidate = deriveDetailView(
    baseItem({
      decision: baseDecision({ state: 'verified' }),
      delivery: { schema: 'alm.delivery.state/v1', key: 'accepted', label: '已验收', source: 'human-signoff' },
      candidate: { exists: true, id: 'CAND-002', current: true, reasons: [], treeHash: 'aaaabbbbcccc' },
    }),
    { now: NOW },
  )
  assert.equal(withCandidate.context.kind, 'accepted')
  assert.equal(withCandidate.primaryAction.id, 'release')
  assert.equal(withCandidate.primaryAction.enabled, true)
  assert.equal(withCandidate.primaryAction.target.candidateId, 'CAND-002')

  const withoutCandidate = deriveDetailView(
    baseItem({
      decision: baseDecision({ state: 'verified' }),
      delivery: { schema: 'alm.delivery.state/v1', key: 'accepted', label: '已验收', source: 'human-signoff' },
    }),
    { now: NOW },
  )
  assert.equal(withoutCandidate.primaryAction.id, 'release')
  assert.equal(withoutCandidate.primaryAction.enabled, false)
  assert.equal(withoutCandidate.primaryAction.reason, '尚未生成交付候选')
})

test('an authorised but unexecuted release offers execute-release, not decide-release again', () => {
  const view = deriveDetailView(
    baseItem({
      decision: baseDecision({ state: 'verified', label: '已验收' }),
      delivery: { schema: 'alm.delivery.state/v1', key: 'accepted', label: '已验收', source: 'human-signoff' },
      candidate: { exists: true, id: 'CAND-003', current: true, reasons: [], treeHash: 'aaaabbbbcccc' },
      release: {
        exists: true,
        id: 'REL-007',
        status: 'authorized',
        label: '已授权待执行',
        target: 'staging',
        version: null,
        authorizedBy: 'human:local',
        authorizedAt: '2026-01-18T00:00:00.000Z',
        releasedAt: null,
      },
    }),
    { now: NOW },
  )
  assert.equal(view.context.kind, 'release-authorized')
  assert.equal(view.primaryAction.id, 'execute-release')
  assert.equal(view.primaryAction.label, '🚀 发布交付 (Release)')
  assert.equal(view.primaryAction.enabled, true)
  assert.equal(view.primaryAction.target.releaseId, 'REL-007')
  assert.equal(view.summaries.release.released, false)
  assert.match(view.context.explanation, /REL-007/)
  assert.match(view.context.explanation, /授权不是发布/)
})

test('a failed release execution can be retried', () => {
  const view = deriveDetailView(
    baseItem({
      decision: baseDecision({ state: 'verified', label: '已验收' }),
      delivery: { schema: 'alm.delivery.state/v1', key: 'accepted', label: '已验收', source: 'human-signoff' },
      candidate: { exists: true, id: 'CAND-004', current: true, reasons: [], treeHash: 'aaaabbbbcccc' },
      release: {
        exists: true,
        id: 'REL-008',
        status: 'failed',
        label: '发布失败',
        target: 'staging',
        authorizedBy: 'human:local',
        authorizedAt: '2026-01-18T00:00:00.000Z',
        releasedAt: null,
      },
    }),
    { now: NOW },
  )
  assert.equal(view.context.kind, 'release-failed')
  assert.equal(view.primaryAction.id, 'execute-release')
  assert.equal(view.primaryAction.enabled, true)
  assert.match(view.context.explanation, /执行失败/)
})

test('a deterministic non-review blocker still points at fixing acceptance', () => {
  const view = deriveDetailView(
    baseItem({
      decision: baseDecision({
        state: 'blocked',
        label: '阻塞',
        topGap: { code: 'integrity-blocked', message: '需求关系不完整', fix: '修订需求', severity: 'block' },
        gaps: [{ code: 'integrity-blocked', message: '需求关系不完整', severity: 'block' }],
      }),
    }),
    { now: NOW },
  )
  assert.equal(view.context.kind, 'acceptance-failed')
  assert.equal(view.primaryAction.id, 'start-fix')
  assert.equal(view.primaryAction.enabled, true)
  assert.equal(view.primaryAction.target.requirementRevision, 3)
  assert.equal(attentionOf(view, 'review-blocked'), undefined)
  assert.equal(attentionOf(view, 'review-pending'), undefined)
  assert.equal(view.summaries.review.state, 'advisory')
  assert.doesNotMatch(JSON.stringify(view), /0% 质量|未评审/)
})

test('a blocking AI review keeps its verdict but never gates passing acceptance', () => {
  const view = deriveDetailView(
    baseItem({
      aiReview: { stored: true, verdict: 'block', suggestions: 3, adopted: null, generatedAt: '2026-01-20T00:00:00.000Z' },
      acceptance: passingAcceptance(),
      decision: baseDecision({
        state: 'unchecked',
        topGap: { code: 'ai-review-blocked', message: 'AI 评审结论为阻塞：缺少边界条件', severity: 'block' },
        gaps: [{ code: 'ai-review-blocked', message: 'AI 评审结论为阻塞：缺少边界条件', severity: 'block' }],
        policy: { risk: 'high', requiredRoles: ['business', 'architecture', 'testing', 'security', 'delivery'], requiresAcceptance: true },
        coverage: { rolesCompleted: 0, rolesRequired: 5, missingRoles: ['business', 'architecture', 'testing', 'security', 'delivery'] },
      }),
    }),
    { now: NOW },
  )
  assert.equal(view.context.kind, 'candidate-pending')
  assert.equal(view.primaryAction.id, 'create-candidate')
  assert.equal(view.primaryAction.enabled, true)
  assert.equal(view.summaries.review.state, 'advisory')
  assert.equal(view.summaries.review.optional, true)
  assert.equal(view.summaries.review.gating, false)
  assert.equal(view.summaries.review.total, 0, 'policy roles are not executed review evidence')
  assert.deepEqual(view.summaries.review.channels.map((channel) => channel.id), ['ai'])
  const ai = view.summaries.review.channels[0]
  assert.equal(ai.state, 'advisory')
  assert.match(ai.label, /可选/)
  assert.match(ai.detail, /结论：block/)
  assert.equal(view.summaries.review.ai.stored, true)
  assert.equal(view.summaries.review.ai.verdict, 'block')
  assert.equal(view.summaries.aiReview.verdict, 'block')
  assert.equal(attentionOf(view, 'review-blocked'), undefined)
  assert.equal(attentionOf(view, 'review-pending'), undefined)
  assert.doesNotMatch(JSON.stringify(view), /0% 质量|未评审/)
})

test('a review that was never run does not interrupt candidate generation after handback', () => {
  const view = deriveDetailView(
    baseItem({
      run: { exists: true, id: 'RUN-REVIEW', status: 'waiting-input', label: '等待输入', active: true, stale: false, awaitingAnswer: false, idleHandback: true, decision: null },
      acceptance: passingAcceptance(),
      delivery: { schema: 'alm.delivery.state/v1', key: 'pending', label: '待推进', source: 'run-idle', reason: '本轮推进已交接，等待人类决定下一步' },
    }),
    { now: NOW },
  )
  assert.equal(view.context.kind, 'candidate-pending')
  assert.equal(view.context.tone, 'attention')
  assert.equal(view.primaryAction.id, 'create-candidate')
  assert.equal(view.primaryAction.label, '生成交付候选')
  assert.equal(view.primaryAction.enabled, true)
  assert.equal(view.summaries.review.state, 'advisory')
  assert.deepEqual(view.summaries.review.channels.map((channel) => channel.id), ['ai'])
  assert.equal(view.summaries.review.channels[0].state, 'advisory')
  assert.equal(view.summaries.review.ai.stored, false)
  assert.equal(attentionOf(view, 'review-pending'), undefined)
  assert.equal(attentionOf(view, 'review-blocked'), undefined)
})

test('needs-clarification asks for a requirement fix without review projection', () => {
  const view = deriveDetailView(
    baseItem({
      decision: baseDecision({
        state: 'needs-clarification',
        label: '待澄清',
        topGap: { code: 'ambiguous-scope', message: '范围不清晰', fix: '补充范围', severity: 'block' },
        gaps: [{ code: 'ambiguous-scope', message: '范围不清晰', severity: 'block' }],
      }),
    }),
    { now: NOW },
  )
  assert.equal(view.context.kind, 'acceptance-failed')
  assert.equal(view.primaryAction.id, 'start-fix')
  // Deterministic clarification stays blocking; optional review is not its source.
  assert.ok('review' in view.summaries)
  assert.equal(view.summaries.review.state, 'advisory')
  assert.equal(attentionOf(view, 'review-pending'), undefined)
  assert.equal(attentionOf(view, 'review-blocked'), undefined)
})

test('a failed acceptance can always start a fix', () => {
  const view = deriveDetailView(
    baseItem({
      acceptance: failingAcceptance(),
      decision: baseDecision({ state: 'failed', label: '验收失败' }),
    }),
    { now: NOW },
  )
  assert.equal(view.context.kind, 'acceptance-failed')
  assert.equal(view.primaryAction.id, 'start-fix')
  assert.equal(view.primaryAction.label, '🔧 让 AI 自动修复未通过项')
  assert.equal(view.primaryAction.enabled, true)
  assert.equal(view.primaryAction.reason, null)
  assert.match(view.context.explanation, /不会永久禁止开发/)
  const failed = attentionOf(view, 'acceptance-failed')
  assert.ok(failed)
  assert.equal(failed.current, true)
  assert.equal(failed.tone, 'danger')
})

test('a rolled-back run goes back to the generic start action with its reason', () => {
  const view = deriveDetailView(
    baseItem({
      delivery: {
        schema: 'alm.delivery.state/v1',
        key: 'pending',
        label: '待推进',
        source: 'run-failed',
        reason: '上一次运行失败：验收命令未通过',
      },
    }),
    { now: NOW },
  )
  assert.equal(view.context.kind, 'run-rolled-back')
  assert.equal(view.primaryAction.id, 'start')
  assert.equal(view.primaryAction.enabled, true)
  assert.match(view.context.explanation, /上一次运行失败：验收命令未通过/)
  assert.match(view.context.explanation, /可交给 AI 推进/)
})

test('in-progress delivery without a run disables the watch action defensively', () => {
  const view = deriveDetailView(
    baseItem({
      delivery: {
        schema: 'alm.delivery.state/v1',
        key: 'in-progress',
        label: '推进中',
        source: 'run',
        runId: 'RUN-009',
        runStatus: 'running',
      },
    }),
    { now: NOW },
  )
  assert.equal(view.context.kind, 'run-active')
  assert.equal(view.primaryAction.id, 'watch-run')
  assert.equal(view.primaryAction.enabled, false)
  assert.equal(view.primaryAction.reason, '缺少关联的运行记录')
  assert.equal(view.primaryAction.target.runId, null)
})

test('a closed defect stays neutral and never counts toward the tab badge', () => {
  const view = deriveDetailView(
    baseItem({
      acceptance: passingAcceptance(),
      decision: baseDecision({ state: 'verified' }),
      defect: {
        exists: true,
        defect: { id: 'DEF-004', status: 'closed', updatedAt: '2026-01-25T00:00:00.000Z' },
        status: 'closed',
        statusLabel: '已关闭',
        occurrenceCount: 3,
        regressionSuspected: false,
      },
    }),
    { now: NOW },
  )
  assert.deepEqual(attentionKinds(view), ['defect-closed'])
  assert.equal(view.tabs.delivery.badge, 0)
  assert.equal(view.summaries.defects.closedHistory.length, 1)
  assert.deepEqual(view.summaries.defects.counts, { open: 0, closed: 1 })
})

test('parseBodySections classifies authored and metadata-backed AI sections', () => {
  const text = briefText(
    '## 目标',
    '支持退款。',
    '## 范围',
    '退款接口。',
    '## 场景',
    '用户申请退款。',
    '## 问题',
    '重复退款。',
    '## 背景',
    '历史遗留。',
    '## 备注',
    '测试备注。',
    '## 约束',
    '必须在月底前上线。',
    '## 风险',
    '上游接口不稳定。',
    '## 依赖',
    '支付网关。',
    '## 验收要求',
    '退款成功。',
    '## 验收标准',
    '状态为 refunded。',
    '## AI评审',
    '建议拆分任务。',
    '## AI 评审建议（已采纳 2026-10-31）',
    '已采纳：退款状态机需要幂等。',
    '## 非 AI 评审',
    '用户手写的说明。',
    '## 重构建议',
    '拆分退款模块。',
  )
  const withAi = parseBodySections(text, { aiStored: true })
  const kinds = Object.fromEntries(withAi.map((section) => [section.title, section.kind]))
  assert.equal(kinds['目标'], 'claim')
  assert.equal(kinds['范围'], 'claim')
  assert.equal(kinds['场景'], 'claim')
  assert.equal(kinds['问题'], 'claim')
  assert.equal(kinds['背景'], 'background')
  assert.equal(kinds['备注'], 'background')
  assert.equal(kinds['约束'], 'constraint')
  assert.equal(kinds['风险'], 'constraint')
  assert.equal(kinds['依赖'], 'constraint')
  assert.equal(kinds['验收要求'], 'acceptance')
  assert.equal(kinds['验收标准'], 'acceptance')
  assert.equal(kinds['AI评审'], 'ai-suggestion')
  // Real briefs append adoption metadata in a parenthesised suffix.
  assert.equal(kinds['AI 评审建议（已采纳 2026-10-31）'], 'ai-suggestion')
  assert.equal(kinds['非 AI 评审'], 'other')
  // Keyword matching used to turn authored content into "AI" advice.
  assert.equal(kinds['重构建议'], 'other')
  assert.deepEqual(
    withAi.map((section) => section.id),
    withAi.map((_, index) => `sec-${index + 1}`),
  )

  const withoutAi = parseBodySections(text)
  assert.equal(withoutAi.find((section) => section.title === 'AI评审').kind, 'other')
})

test('sameAs marks only fully equal earlier bodies and keeps every paragraph', () => {
  const sections = parseBodySections(
    briefText(
      '## 背景',
      '用户无法自助退款。',
      '## 背景',
      '  用户无法自助退款。  ',
      '## 背景',
      '用户无法自助退款，但可联系客服。',
      '## 背景',
      '用户无法自助退款。',
    ),
  )
  assert.equal(sections.length, 4)
  assert.equal(sections[0].sameAs, null)
  assert.equal(sections[1].sameAs, '背景')
  assert.equal(sections[1].text, '用户无法自助退款。')
  // Longer text with the same prefix is new information, not a duplicate.
  assert.equal(sections[2].sameAs, null)
  assert.match(sections[2].text, /但可联系客服/)
  // A non-adjacent exact repeat can collapse too; the intervening restriction
  // remains distinct and all original bodies remain available to expand.
  assert.equal(sections[3].sameAs, '背景')
  assert.ok(sections.every((section) => section.text.length > 0))
})

test('body parsing uses actual CRLF and whitespace, not literal escaped text', () => {
  const sections = parseBodySections([
    '# 退款需求',
    '##\t目标',
    '目标：\t支持退款。',
    '保留第二行。',
    '## AI 评审建议（已采纳）',
    '建议补充幂等。',
  ].join('\r\n'), { aiStored: true })
  assert.deepEqual(sections.map(({ title, kind, text }) => ({ title, kind, text })), [
    { title: '目标', kind: 'claim', text: '支持退款。\n保留第二行。' },
    { title: 'AI 评审建议（已采纳）', kind: 'ai-suggestion', text: '建议补充幂等。' },
  ])
  const literal = String.raw`正文包含 \n 和 \s，不应被当作换行或空白。`
  assert.equal(parseBodySections(literal)[0].text, literal)
})

test('feedback intent and provenance stay separate without losing source content or changing actions', () => {
  const sourceSections = [
    ['目标', '让用户直接表达意图，由 AI 执行。'],
    ['范围', '需求详情。'],
    ['用户原话', '让用户直接表达意图，由 AI 执行。'],
    ['期望', '技术上下文可展开，不占核心展示。'],
    ['上下文摘要', '- 页面/阶段：需求详情\n- 上下文快照：SNAP-001'],
    ['覆盖边界', '- 只覆盖当前上下文，不代表方案或优先级已确认。'],
    ['反馈来源', '- 反馈：FDB-001'],
    ['约束', '让用户直接表达意图，由 AI 执行。必须人工确认发布。'],
    ['上下文摘要补充', '作者新增限制，不能按标题前缀归档。'],
  ]
  const item = baseItem()
  const original = deriveDetailView(item, { now: NOW })
  const view = deriveDetailView({
    ...item,
    briefText: sourceSections.map(([title, text]) => `## ${title}\n${text}`).join('\n\n'),
  }, { now: NOW })
  assert.deepEqual(view.content.sections.map(({ title, text }) => [title, text]), sourceSections)
  assert.deepEqual(view.content.sections.map(({ kind }) => kind), [
    'claim', 'claim', 'background', 'claim', 'provenance', 'provenance', 'provenance', 'constraint', 'other',
  ])
  assert.equal(view.content.sections[2].sameAs, '目标')
  assert.equal(view.content.sections[7].sameAs, null)
  assert.equal(view.content.sections[8].sameAs, null)
  assert.deepEqual(view.context, original.context)
  assert.deepEqual(view.primaryAction, original.primaryAction)
  assert.deepEqual(view.secondaryActions, original.secondaryActions)
  assert.deepEqual(view.summaries, original.summaries)
  assert.equal(view.schema, DETAIL_VIEW_SCHEMA)
})

test('quoted user words are preserved rather than loosely deduplicated against a goal', () => {
  const sections = parseBodySections(briefText(
    '## 目标', '支持退款。',
    '## 用户原话', '> 支持退款。',
    '## 覆盖边界', '支持退款。但不能自动发布。',
  ))
  assert.equal(sections[1].text, '> 支持退款。')
  assert.equal(sections[1].sameAs, null)
  assert.equal(sections[2].sameAs, null)
  assert.equal(sections[2].text, '支持退款。但不能自动发布。')
})

test('missing sections never count a title or a linked test as acceptance wording', () => {
  const sparse = deriveDetailView(
    baseItem({
      briefText: briefText('## 目标', '## 范围', '只有范围。'),
      verifiedBy: ['TEST-REFUND-001'],
    }),
    { now: NOW },
  )
  assert.deepEqual(sparse.content.missing, ['目标', '验收要求'])
  assert.deepEqual(sparse.content.verifiedBy, ['TEST-REFUND-001'])
  assert.deepEqual(sparse.content.acceptanceCriteria, [])

  const complete = deriveDetailView(
    baseItem({
      briefText: briefText('## 目标', '支持退款。', '## 范围', '退款接口。', '## 验收要求', '状态为 refunded。'),
    }),
    { now: NOW },
  )
  assert.deepEqual(complete.content.missing, [])
  assert.equal(complete.content.acceptanceCriteria.length, 1)
  assert.equal(complete.content.acceptanceCriteria[0].text, '状态为 refunded。')
})

test('relations recompute from allItems and stay empty without them', () => {
  const item = baseItem({
    links: [
      { type: 'parent_of', target: 'REQ-TEST-CHILD', line: 3 },
      { type: 'verified_by', target: 'TEST-REFUND-001', line: 4 },
      { type: 'depends_on', target: 'REQ-TEST-DEP', line: 5 },
    ],
  })
  const allItems = [
    { id: 'REQ-TEST-001', links: item.links },
    { id: 'REQ-TEST-PARENT', links: [{ type: 'parent_of', target: 'REQ-TEST-001', line: 1 }] },
    { id: 'REQ-TEST-CHILD', links: [] },
    { id: 'REQ-TEST-DEP', links: [] },
  ]
  const withRelations = deriveDetailView(item, { now: NOW, allItems })
  assert.deepEqual(withRelations.record.relations, [
    ['上级', ['REQ-TEST-PARENT']],
    ['子需求', ['REQ-TEST-CHILD']],
    ['验收', ['TEST-REFUND-001']],
    ['依赖', ['REQ-TEST-DEP']],
  ])
  assert.ok(
    withRelations.context.relatedRefs.some(
      (ref) => ref.id === 'REQ-TEST-PARENT' && ref.tab === 'requirement',
    ),
  )

  const withoutRelations = deriveDetailView(item, { now: NOW })
  assert.deepEqual(withoutRelations.record.relations, [])
})

test('stale candidate and stale acceptance evidence are separate attention rows', () => {
  const view = deriveDetailView(
    baseItem({
      candidate: {
        exists: true,
        id: 'CAND-004',
        current: false,
        reasons: [{ code: 'requirement-changed', message: '需求内容已变化' }],
        treeHash: 'ffff000011112222',
      },
      acceptance: {
        ...passingAcceptance(),
        latest: { ...passingAcceptance().latest, result: 'pass', current: false, staleReason: 'head' },
      },
    }),
    { now: NOW },
  )
  const candidate = attentionOf(view, 'candidate-stale')
  const evidence = attentionOf(view, 'evidence-stale')
  assert.ok(candidate)
  assert.ok(evidence)
  assert.equal(candidate.current, true)
  assert.match(candidate.detail, /需求内容已变化/)
  assert.equal(evidence.current, true)
  assert.match(evidence.detail, /提交已变化/)
  assert.equal(view.freshness.candidateCurrent, false)
})

test('an open defect with suspected regression is a danger item', () => {
  const view = deriveDetailView(
    baseItem({
      defect: {
        exists: true,
        defect: { id: 'DEF-005', status: 'confirmed', updatedAt: '2026-01-26T00:00:00.000Z' },
        status: 'confirmed',
        statusLabel: '已确认',
        occurrenceCount: 4,
        regressionSuspected: true,
      },
    }),
    { now: NOW },
  )
  const open = attentionOf(view, 'defect-open')
  assert.ok(open)
  assert.equal(open.current, true)
  assert.equal(open.tone, 'danger')
  assert.match(open.detail, /疑似回归/)
  assert.equal(view.summaries.defects.own.regressionSuspected, true)
  assert.equal(view.summaries.defects.counts.open, 1)
  assert.equal(view.tabs.delivery.badge, 2)
})

test('the projection is JSON round-trippable and contains no undefined values', () => {
  const view = deriveDetailView(
    baseItem({
      run: {
        exists: true,
        id: 'RUN-001',
        status: 'waiting-input',
        awaitingAnswer: true,
        decision: 'RUN-001-decision.md',
        failure: null,
      },
      decision: baseDecision({ state: 'ready-for-human' }),
      candidate: { exists: true, id: 'CAND-001', current: true, reasons: [], treeHash: '0123456789' },
      delivery: { schema: 'alm.delivery.state/v1', key: 'awaiting-acceptance', label: '待验收', source: 'candidate' },
      acceptance: failingAcceptance(),
      release: { exists: false, id: null, status: null, label: null },
    }),
    { now: NOW },
  )
  const roundTrip = JSON.parse(JSON.stringify(view))
  assert.deepEqual(roundTrip, view)
  assert.deepEqual(collectUndefined(view), [])
})

test('primaryActionFor accepts a partial detail object without IO', () => {
  const action = primaryActionFor({
    context: { kind: 'answer' },
    summaries: { run: { exists: true, id: 'RUN-777' } },
    identity: { revision: 4 },
  })
  assert.equal(action.id, 'answer-run')
  assert.equal(action.target.runId, 'RUN-777')
  assert.equal(action.target.requirementRevision, 4)
  assert.equal(primaryActionFor({ context: { kind: 'closed' } }), null)
})

test('the projection is deterministic for a fixed now and accepts a clock', () => {
  const item = baseItem({
    run: {
      exists: true,
      id: 'RUN-010',
      status: 'waiting-input',
      awaitingAnswer: true,
      decision: 'RUN-010-decision.md',
    },
    delivery: { schema: 'alm.delivery.state/v1', key: 'pending', label: '待推进', source: 'run', reason: null },
  })
  const first = deriveDetailView(item, { now: NOW })
  const second = deriveDetailView(item, { now: NOW })
  assert.deepEqual(first, second)
  const later = deriveDetailView(item, { now: NOW + 60_000 })
  assert.equal(later.freshness.readAt, new Date(NOW + 60_000).toISOString())
  later.freshness.readAt = first.freshness.readAt
  assert.deepEqual(later, first)
})

test('requirements() attaches a detailView to every item', () => {
  const dir = mkdtempSync(join(tmpdir(), 'alm-detail-view-'))
  try {
    cpSync(fixture, dir, { recursive: true })
    const payload = requirements(dir)
    assert.ok(payload.requirements.length > 0)
    for (const item of payload.requirements) {
      assert.equal(item.detailView.schema, DETAIL_VIEW_SCHEMA)
      assert.equal(item.detailView.identity.id, item.id)
      assert.equal(typeof item.detailView.context.kind, 'string')
      assert.ok(Array.isArray(item.detailView.attentionItems))
      assert.ok(Array.isArray(item.detailView.record.relations))
      assert.doesNotThrow(() => JSON.parse(JSON.stringify(item.detailView)))
    }
    const pay = payload.requirements.find((item) => item.id === 'REQ-PAY-001')
    assert.ok(pay, 'fixture must expose REQ-PAY-001')
    assert.equal(pay.detailView.identity.title, pay.title)
    assert.equal(pay.detailView.freshness.requirementRevision, pay.revision)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('passing acceptance with review not run asks for the delivery candidate', () => {
  const view = deriveDetailView(
    baseItem({
      run: { exists: true, id: 'RUN-9', status: 'waiting-input', label: '等待输入', active: true, stale: false, awaitingAnswer: false, idleHandback: true },
      acceptance: passingAcceptance(),
      delivery: { schema: 'alm.delivery.state/v1', key: 'pending', label: '待推进', source: 'run-idle', reason: '本轮推进已交接，等待人类决定下一步' },
    }),
    { now: NOW },
  )
  assert.equal(view.context.kind, 'candidate-pending')
  assert.equal(view.primaryAction.id, 'create-candidate')
  assert.equal(view.primaryAction.label, '生成交付候选')
})

test('reviewed passing acceptance asks for the delivery candidate', () => {
  const view = deriveDetailView(
    baseItem({
      aiReview: { stored: true, verdict: 'pass', suggestions: 0, adopted: null, generatedAt: '2026-01-20T00:00:00.000Z' },
      run: { exists: true, id: 'RUN-9', status: 'waiting-input', label: '等待输入', active: true, stale: false, awaitingAnswer: false, idleHandback: true },
      acceptance: passingAcceptance(),
      delivery: { schema: 'alm.delivery.state/v1', key: 'pending', label: '待推进', source: 'run-idle', reason: '本轮推进已交接，等待人类决定下一步' },
    }),
    { now: NOW },
  )
  assert.equal(view.summaries.review.state, 'advisory')
  assert.equal(view.summaries.review.ai.verdict, 'pass')
  assert.equal(view.context.kind, 'candidate-pending')
  assert.equal(view.primaryAction.id, 'create-candidate')
  assert.equal(view.primaryAction.label, '生成交付候选')
})

test('an idle review-result run keeps recovery visible beside failed acceptance evidence', () => {
  const view = deriveDetailView(
    baseItem({
      run: { exists: true, id: 'RUN-9', status: 'waiting-input', label: '等待输入', active: true, stale: false, awaitingAnswer: false, idleHandback: true },
      acceptance: failingAcceptance(),
      delivery: { schema: 'alm.delivery.state/v1', key: 'pending', label: '待推进', source: 'run-idle', reason: '本轮推进已交接，等待人类决定下一步' },
    }),
    { now: NOW },
  )
  assert.equal(view.context.kind, 'run-idle-handback')
  assert.equal(view.primaryAction.id, 'continue-run')
})

test('a current candidate supersedes an old waiting-input handback and its historical failure', () => {
  const view = deriveDetailView(
    baseItem({
      run: {
        exists: true, id: 'RUN-OLD', status: 'waiting-input', active: true, stale: false,
        awaitingAnswer: true, idleHandback: true,
        autoAdvance: { status: 'stopped', reason: 'environment-blocked' },
      },
      acceptance: failingAcceptance(),
      candidate: { exists: true, id: 'CAND-REQ-ALM-012-002', current: true, reasons: [], treeHash: '0123456789' },
      decision: baseDecision({ state: 'ready-for-human' }),
      delivery: { schema: 'alm.delivery.state/v1', key: 'awaiting-acceptance', label: '待验收', source: 'candidate' },
    }),
    { now: NOW },
  )
  assert.equal(view.context.kind, 'awaiting-acceptance')
  assert.equal(view.primaryAction.id, 'signoff')
  assert.equal(view.primaryAction.label, '✓ 确认签收 (Signoff)')
  assert.equal(view.currentMatter.kind, 'awaiting-acceptance')
  assert.equal(view.executionDiagnostic, null)
  assert.equal(view.attentionItems.some(entry => entry.kind === 'acceptance-failed'), false)
  assert.equal(view.verificationSummary.kind, 'candidate-ready')
  assert.match(view.verificationSummary.headline, /CAND-REQ-ALM-012-002/)
})

test('execution diagnostics translate scope and acceptance failures into actionable Chinese', () => {
  const scope = deriveDetailView(baseItem({
    run: {
      exists: true, id: 'RUN-9', status: 'waiting-input', label: '等待输入', active: true, stale: false, awaitingAnswer: false, idleHandback: true,
      scopeDiagnostic: { changedCount: 12, allowedCount: 4, outOfScope: ['packages/a.mjs', 'packages/b.mjs'], risky: [] },
    },
  }))
  assert.equal(scope.executionDiagnostic.title, '🟠 修改范围超出蓝图锁定边界')
  assert.match(scope.executionDiagnostic.summary, /实际修改了 12 个文件.*锁定的 4 个模块/)
  assert.equal(scope.executionDiagnostic.actionLabel, '批准当前修改范围并重新验证')

  const verification = deriveDetailView(baseItem({
    acceptance: failingAcceptance({ latest: {
      ...failingAcceptance().latest,
      diagnostic: { category: 'verification', title: '验证检查未通过', summary: '验证命令失败（exit 1）：not ok 1', command: ['node', '--test', 'x.test.mjs'], log: 'not ok 1 - should pass' },
    } }),
  }))
  assert.equal(verification.executionDiagnostic.title, '验证检查未通过')
  assert.match(verification.executionDiagnostic.summary, /exit 1/)
  assert.equal(verification.executionDiagnostic.actionLabel, '🔧 让 AI 自动修复未通过项')

  const environment = deriveDetailView(baseItem({
    run: { exists: true, id: 'RUN-10', status: 'waiting-input', label: '等待输入', active: true, idleHandback: true, autoAdvance: { status: 'stopped', reason: 'environment-blocked' } },
  }))
  assert.equal(environment.executionDiagnostic.title, '🟠 调查证据过期或环境受阻')
  assert.doesNotMatch(JSON.stringify(environment.executionDiagnostic), /environment-blocked/)
  assert.doesNotMatch(environment.currentMatter.explanation, /environment-blocked/)
})

test('released delivery projects a verified develop to main merge credential', () => {
  const view = deriveDetailView(baseItem({
    delivery: { schema: 'alm.delivery.state/v1', key: 'closed', label: '已关闭', source: 'release' },
    release: {
      exists: true,
      id: 'REL-002',
      status: 'released',
      label: '已发布',
      sourceControl: {
        devBranch: 'develop',
        mainBranch: 'main',
        mainMergeCommitSha: '615178757f804a86ea313dd09b85c0497acf9f8f',
        pushedToMain: true,
      },
    },
    architectureLedger: {
      path: 'requirements/architecture/REQ-ALM-012-design.md',
      title: 'REQ-ALM-012 架构与数据模型交付档案',
      baseline: ['需求：REQ-ALM-012 · v5'],
      modules: [{ path: 'packages/dsh-plugin-requirements/client-source.js', role: 'DSH 插件接口与用户视图' }],
      contracts: ['沿用既有数据与接口契约。'],
      verification: ['AC-01：通过'],
    },
  }), { now: NOW })
  assert.equal(view.summaries.release.mainMerged, true)
  assert.equal(view.summaries.release.sourceControl.mainBranch, 'main')
  assert.match(view.context.explanation, /代码与架构档案已合入 GitHub main 分支/)
  assert.doesNotMatch(view.verificationSummary.explanation, /缺少 GitHub 合并凭据/)
  assert.equal(view.record.architecture.path, 'requirements/architecture/REQ-ALM-012-design.md')
  assert.equal(view.record.architecture.modules[0].path, 'packages/dsh-plugin-requirements/client-source.js')
})

