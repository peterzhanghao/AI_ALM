import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  EVIDENCE_SCHEMA,
  ROLE_IDS,
  decideEvidence,
  requirementPolicy,
  riskLevel,
} from '../../src/evidence/decision.mjs'
import { normalizeAsset, BUSINESS_ID_PATTERN } from '../../src/model/asset.mjs'
import { loadRepo } from '../../src/parse/load.mjs'
import { parseSdocAsset } from '../../src/parse/sdoc.mjs'
import { requirementContentHash as sharedContentHash } from '../../src/model/content-hash.mjs'
import { requirementContentHash as executorContentHash } from '../../src/review/executor.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
const fixture = join(repoRoot, 'fixtures/order-refund')

function requirementAsset(overrides = {}) {
  return {
    id: 'REQ-X-001',
    type: 'requirement',
    title: '示例需求',
    status: 'proposed',
    owner: 'team',
    links: [],
    extra: { priority: 'P1' },
    ...overrides,
  }
}

function reviewOf({ verdicts = {}, stored = true, blockers = null, signoff = null, roles = null } = {}) {
  const resolved =
    roles ??
    ROLE_IDS.map((id) => ({
      id,
      label: id,
      verdict: verdicts[id] ?? 'pass',
      rules: [],
      findings: [],
    }))
  const blocking = resolved.filter((role) => role.verdict === 'block').length
  const effectiveBlockers = blockers ?? blocking
  const missing = resolved.filter((role) => role.verdict === 'skip').map((role) => role.id)
  return {
    schema: 'alm.review/v1',
    stored,
    contentHash: 'f'.repeat(64),
    roles: resolved,
    summary: {
      completed: resolved.length - missing.length,
      total: resolved.length,
      blockers: effectiveBlockers,
      ready: effectiveBlockers === 0,
      coverage: { completed: resolved.length - missing.length, total: resolved.length, missing },
    },
    signoff,
    signoffValid: Boolean(signoff?.valid),
    evidenceBound: Boolean(signoff?.evidenceHash),
  }
}

function acceptanceOf({ registered = true, latest = null } = {}) {
  return {
    schema: 'alm.acceptance.summary/v2',
    registered,
    commandCount: registered ? 1 : 0,
    commands: registered ? [{ id: 'smoke', command: ['node', '-e', 'process.exit(0)'] }] : [],
    latest,
  }
}

function latestEvidence(overrides = {}) {
  return {
    result: 'pass',
    headSha: 'a'.repeat(40),
    finishedAt: '2026-10-31T00:00:00.000Z',
    commands: 1,
    file: '.alm/acceptance/REQ-X-001/x.json',
    current: true,
    requirementHash: 'b'.repeat(64),
    testRevision: 'c'.repeat(64),
    environment: { platform: 'win32', arch: 'x64', node: 'v22.0.0', runner: 'alm-core/acceptance' },
    source: 'local-runner',
    complete: true,
    missing: [],
    staleReason: null,
    ...overrides,
  }
}

test('EVIDENCE_SCHEMA and ROLE_IDS are stable contract constants', () => {
  assert.equal(EVIDENCE_SCHEMA, 'alm.evidence.decision/v1')
  assert.deepEqual(ROLE_IDS, ['business', 'architecture', 'testing', 'security', 'delivery'])
})

test('riskLevel and requirementPolicy map priority to required review perspectives', () => {
  assert.equal(riskLevel(requirementAsset({ extra: { priority: 'P0' } })), 'high')
  assert.equal(riskLevel(requirementAsset({ extra: { priority: 'P1' } })), 'high')
  assert.equal(riskLevel(requirementAsset({ extra: { priority: 'P2' } })), 'normal')
  assert.equal(riskLevel(requirementAsset({ extra: { priority: 'P3' } })), 'low')
  assert.equal(riskLevel(requirementAsset({ extra: {} })), 'low')
  // priority can also sit at the top level on hand-built assets
  assert.equal(riskLevel({ ...requirementAsset(), priority: 'P0' }), 'high')

  assert.deepEqual(requirementPolicy(requirementAsset({ extra: { priority: 'P1' } })), {
    risk: 'high',
    requiredRoles: [...ROLE_IDS],
    requiresAcceptance: true,
  })
  assert.deepEqual(requirementPolicy(requirementAsset({ extra: { priority: 'P2' } })).requiredRoles, [
    'business',
    'architecture',
    'testing',
    'delivery',
  ])
  assert.deepEqual(requirementPolicy(requirementAsset({ extra: { priority: 'P3' } })).requiredRoles, ['testing', 'delivery'])
  assert.equal(requirementPolicy(requirementAsset({ extra: {} })).requiresAcceptance, true)
})

test('complete evidence without an accepted AI review stays open until adoption', () => {
  const decision = decideEvidence({
    asset: requirementAsset(),
    review: reviewOf(),
    acceptance: acceptanceOf({ latest: latestEvidence() }),
  })
  assert.equal(decision.schema, EVIDENCE_SCHEMA)
  assert.equal(decision.state, 'unchecked')
  assert.equal(decision.label, '未检查')
  assert.equal(decision.tone, 'neutral')
  assert.equal(decision.topGap.code, 'review-not-accepted')
  assert.deepEqual(decision.signoff.allowed, false)
  assert.deepEqual(decision.nextStep, { label: '运行 AI 评审并采纳意见', action: 'ai-review' })
  assert.equal(decision.policy.risk, 'high')
  assert.deepEqual(decision.coverage, { rolesCompleted: 5, rolesRequired: 5, missingRoles: [] })
})

test('a valid sign-off turns the decision into verified', () => {
  const signoff = { actor: 'human:test', contentHash: 'f'.repeat(64), evidenceHash: 'd'.repeat(64), valid: true }
  const decision = decideEvidence({
    asset: requirementAsset(),
    review: reviewOf({ signoff }),
    acceptance: acceptanceOf({ latest: latestEvidence() }),
  })
  assert.equal(decision.state, 'verified')
  assert.equal(decision.label, '已签收')
  assert.equal(decision.tone, 'success')
  assert.equal(decision.signoff.allowed, false)
  assert.equal(decision.topGap, null)
})

test('blockers win over everything and block sign-off', () => {
  const roles = reviewOf().roles.map((role) => (role.id === 'architecture' ? { ...role, verdict: 'block' } : role))
  roles[1].findings = [{ rule: 'REL-001', severity: 'block', message: 'dangling relation', file: 'requirements/x.sdoc', line: 12 }]
  const decision = decideEvidence({
    asset: requirementAsset(),
    review: reviewOf({ roles, blockers: 1 }),
    acceptance: acceptanceOf({ latest: latestEvidence({ result: 'fail' }) }),
    anomalies: [{ kind: 'duplicate-id', message: 'dup', requirementIds: ['REQ-X-001'] }],
  })
  assert.equal(decision.state, 'blocked')
  assert.equal(decision.tone, 'error')
  assert.equal(decision.topGap.code, 'blockers')
  assert.match(decision.topGap.message, /REL-001/)
  assert.match(decision.topGap.message, /requirements\/x\.sdoc:12/)
  assert.equal(decision.nextStep.action, 'fix-blockers')
  assert.equal(decision.signoff.allowed, false)
  assert.deepEqual(decision.signoff.reasons.map((reason) => reason.code), ['blocked'])

  // Even a minimal review shape with only a blocker count still yields a gap.
  const minimal = decideEvidence({
    asset: requirementAsset(),
    review: { stored: true, summary: { blockers: 2 }, roles: [] },
    acceptance: acceptanceOf(),
  })
  assert.equal(minimal.state, 'blocked')
  assert.equal(minimal.topGap.code, 'blockers')
  assert.match(minimal.topGap.message, /2 个阻塞项/)
})

test('ambiguous references need clarification, never an automatic pick', () => {
  const decision = decideEvidence({
    asset: requirementAsset(),
    review: reviewOf(),
    acceptance: acceptanceOf({ latest: latestEvidence({ result: 'fail' }) }),
    anomalies: [
      { kind: 'duplicate-id', message: 'other requirement', requirementIds: ['REQ-OTHER-001'] },
      { kind: 'duplicate-business-id', message: 'JIRA-1 maps to two UIDs', requirementIds: ['REQ-X-001'] },
      { kind: 'unknown-kind', message: 'ignored', requirementIds: ['REQ-X-001'] },
    ],
  })
  assert.equal(decision.state, 'needs-clarification')
  assert.equal(decision.label, '需澄清')
  assert.equal(decision.tone, 'neutral')
  assert.equal(decision.topGap.code, 'duplicate-business-id')
  assert.equal(decision.gaps.length, 1)
  assert.equal(decision.nextStep.action, 'fix-anomaly')
  assert.equal(decision.signoff.reasons[0].code, 'needs-clarification')
})

test('an anomaly can match through its occurrence list', () => {
  const decision = decideEvidence({
    asset: requirementAsset(),
    review: reviewOf(),
    acceptance: acceptanceOf({ latest: latestEvidence() }),
    anomalies: [
      {
        kind: 'dangling-relation',
        message: 'target missing',
        requirementIds: [],
        occurrences: [{ assetId: 'REQ-X-001', file: 'requirements/x.sdoc', line: 1 }],
      },
    ],
  })
  assert.equal(decision.state, 'needs-clarification')
  assert.equal(decision.topGap.code, 'dangling-relation')
})

test('current failed acceptance is failed, not passed', () => {
  const decision = decideEvidence({
    asset: requirementAsset(),
    review: reviewOf(),
    acceptance: acceptanceOf({
      latest: latestEvidence({ result: 'fail', commands: [{ id: 'unit', exitCode: 1 }, { id: 'lint', exitCode: 0 }] }),
    }),
  })
  assert.equal(decision.state, 'failed')
  assert.equal(decision.label, '执行失败')
  assert.equal(decision.tone, 'error')
  assert.equal(decision.topGap.code, 'acceptance-failed')
  assert.match(decision.topGap.message, /unit/)
  assert.equal(decision.nextStep.action, 'run-acceptance')
})

test('incomplete or non-current evidence is stale and never counts as a pass', () => {
  const headStale = decideEvidence({
    asset: requirementAsset(),
    review: reviewOf(),
    acceptance: acceptanceOf({ latest: latestEvidence({ current: false, staleReason: 'head' }) }),
  })
  assert.equal(headStale.state, 'stale')
  assert.equal(headStale.label, '证据过期')
  assert.equal(headStale.tone, 'warn')
  assert.equal(headStale.topGap.code, 'evidence-stale')
  assert.equal(headStale.topGap.severity, 'warn')
  assert.match(headStale.topGap.message, /历史证据保留/)
  assert.equal(headStale.nextStep.action, 'run-acceptance')

  // A v1 evidence file is read-only compatible but always incomplete.
  const v1 = decideEvidence({
    asset: requirementAsset(),
    review: reviewOf(),
    acceptance: acceptanceOf({
      latest: latestEvidence({
        current: false,
        complete: false,
        requirementHash: null,
        testRevision: null,
        environment: null,
        source: null,
        missing: ['requirementHash', 'testRevision', 'environment', 'source'],
        staleReason: 'incomplete',
      }),
    }),
  })
  assert.equal(v1.state, 'stale')
  assert.equal(v1.topGap.code, 'evidence-stale')
})

test('stale evidence outranks an unstored review, and an unstored review outranks coverage', () => {
  const staleWins = decideEvidence({
    asset: requirementAsset(),
    review: reviewOf({ stored: false }),
    acceptance: acceptanceOf({ latest: latestEvidence({ current: false, staleReason: 'tests' }) }),
  })
  assert.equal(staleWins.state, 'stale')

  const reviewMissing = decideEvidence({
    asset: requirementAsset(),
    review: reviewOf({ stored: false }),
    acceptance: acceptanceOf({ latest: null }),
  })
  assert.equal(reviewMissing.state, 'unchecked')
  assert.equal(reviewMissing.topGap.code, 'review-not-run')
  assert.equal(reviewMissing.nextStep.action, 'run-review')
})

test('required review perspectives that were skipped leave the decision unchecked', () => {
  const decision = decideEvidence({
    asset: requirementAsset(),
    review: reviewOf({ verdicts: { security: 'skip' } }),
    acceptance: acceptanceOf({ latest: latestEvidence() }),
  })
  assert.equal(decision.state, 'unchecked')
  assert.equal(decision.label, '未检查')
  assert.equal(decision.tone, 'neutral')
  assert.equal(decision.topGap.code, 'coverage-incomplete')
  assert.match(decision.topGap.message, /评审视角未覆盖：security/)
  assert.deepEqual(decision.coverage, { rolesCompleted: 4, rolesRequired: 5, missingRoles: ['security'] })
  assert.equal(decision.nextStep.action, 'run-review')
  assert.deepEqual(decision.signoff.reasons.map((reason) => reason.code), ['coverage-incomplete'])
})

test('low and normal risk only require their own perspectives', () => {
  const lowRisk = decideEvidence({
    asset: requirementAsset({ extra: { priority: 'P3' } }),
    review: reviewOf({ verdicts: { business: 'skip', architecture: 'skip', security: 'skip' } }),
    acceptance: acceptanceOf({ latest: latestEvidence() }),
  })
  assert.equal(lowRisk.state, 'unchecked')
  assert.equal(lowRisk.topGap.code, 'review-not-accepted')
  assert.equal(lowRisk.coverage.rolesRequired, 2)

  const normalRisk = decideEvidence({
    asset: requirementAsset({ extra: { priority: 'P2' } }),
    review: reviewOf({ verdicts: { security: 'skip' } }),
    acceptance: acceptanceOf({ latest: latestEvidence() }),
  })
  assert.equal(normalRisk.state, 'unchecked')
})

test('acceptance must be registered and executed before sign-off', () => {
  const missing = decideEvidence({
    asset: requirementAsset(),
    review: reviewOf(),
    acceptance: acceptanceOf({ registered: false, latest: null }),
  })
  assert.equal(missing.state, 'unchecked')
  assert.equal(missing.topGap.code, 'acceptance-missing')
  assert.equal(missing.nextStep.action, 'run-acceptance')

  const notRun = decideEvidence({
    asset: requirementAsset(),
    review: reviewOf(),
    acceptance: acceptanceOf({ registered: true, latest: null }),
  })
  assert.equal(notRun.state, 'unchecked')
  assert.equal(notRun.topGap.code, 'acceptance-not-run')
  assert.match(notRun.topGap.message, /验收尚未执行/)
  assert.equal(notRun.signoff.allowed, false)
})

test('topGap is always gaps[0] and every decision carries consistent labels', () => {
  const decisions = [
    decideEvidence({ asset: requirementAsset(), review: reviewOf(), acceptance: acceptanceOf({ latest: latestEvidence() }) }),
    decideEvidence({ asset: requirementAsset(), review: reviewOf({ stored: false }), acceptance: acceptanceOf({ latest: null }) }),
    decideEvidence({
      asset: requirementAsset(),
      review: reviewOf(),
      acceptance: acceptanceOf({ latest: latestEvidence({ complete: false, current: false, staleReason: 'incomplete' }) }),
    }),
  ]
  for (const decision of decisions) {
    assert.equal(decision.topGap, decision.gaps[0] ?? null)
    assert.equal(typeof decision.label, 'string')
    assert.ok(['neutral', 'error', 'warn', 'success'].includes(decision.tone))
    assert.ok(['run-review', 'run-acceptance', 'fix-blockers', 'fix-anomaly', 'rehearse', 'ai-review', 'signoff'].includes(decision.nextStep.action))
  }
})

test('the decision module stays pure: no filesystem access', () => {
  const source = readFileSync(join(repoRoot, 'packages/alm-core/src/evidence/decision.mjs'), 'utf8')
  assert.ok(!source.includes('node:fs'))
  assert.ok(!source.includes('readFileSync'))
  assert.ok(!source.includes('writeFileSync'))
})

test('the review executor re-exports the shared content hash unchanged', () => {
  const { assets } = loadRepo(fixture)
  const asset = assets.find((entry) => entry.id === 'REQ-PAY-004')
  const shared = sharedContentHash({ root: fixture, asset })
  assert.match(shared, /^[0-9a-f]{64}$/)
  assert.equal(executorContentHash({ root: fixture, asset }), shared)
})

test('BUSINESS_ID is an optional label that never replaces the stable UID', () => {
  const [asset] = parseSdocAsset(
    '[DOCUMENT]\nTITLE: t\n\n[REQUIREMENT]\nUID: REQ-LABEL-001\nTITLE: labelled\nSTATUS: proposed\nOWNER: team\nBUSINESS_ID: JIRA-1234\n\n[RELATION]\nType: verified_by\nValue: TEST-LABEL-001\n',
    'requirements/label.sdoc',
  )
  assert.equal(asset.id, 'REQ-LABEL-001')
  assert.equal(asset.extra.businessId, 'JIRA-1234')
  assert.equal(asset.businessId, undefined)
  assert.deepEqual(
    asset.links.map((link) => ({ type: link.type, target: link.target })),
    [{ type: 'verified_by', target: 'TEST-LABEL-001' }],
  )
})

test('normalizeAsset validates BUSINESS_ID and keeps it in extra', () => {
  assert.equal(BUSINESS_ID_PATTERN.source, '^[A-Za-z0-9._/-]{1,64}$')
  const valid = normalizeAsset(
    {
      schema_version: 1,
      id: 'REQ-LABEL-002',
      type: 'requirement',
      title: 't',
      status: 'proposed',
      owner: 'team',
      links: [],
      businessId: 'PAY-42/refund.v2',
    },
    { path: 'requirements/label.sdoc', format: 'sdoc', line: 1 },
  )
  assert.equal(valid.extra.businessId, 'PAY-42/refund.v2')

  assert.throws(
    () =>
      parseSdocAsset(
        '[REQUIREMENT]\nUID: REQ-LABEL-003\nTITLE: t\nSTATUS: proposed\nOWNER: team\nBUSINESS_ID: bad id!\n',
        'requirements/label.sdoc',
      ),
    /invalid businessId/,
  )
  assert.throws(
    () =>
      normalizeAsset(
        {
          id: 'REQ-LABEL-004',
          type: 'requirement',
          title: 't',
          status: 'proposed',
          owner: 'team',
          links: [],
          businessId: 'x'.repeat(65),
        },
        { path: 'requirements/label.sdoc', format: 'sdoc', line: 1 },
      ),
    /invalid businessId/,
  )
})
