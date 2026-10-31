import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { checkReport, indexReport } from '../../src/commands.mjs'
import { runAcceptance } from '../../src/acceptance/acceptance.mjs'
import { sha256 } from '../../src/model/content-hash.mjs'
import {
  readReviewReport,
  requirementContentHash,
  reviewView,
  runReview,
  signReview,
  writeReviewReport,
} from '../../src/review/executor.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
const fixture = join(repoRoot, 'fixtures/order-refund')
const dirs = []

function makeRepo({ git = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'alm-review-'))
  dirs.push(root)
  cpSync(fixture, root, { recursive: true })
  if (git) {
    execFileSync('git', ['init', '-q'], { cwd: root })
    execFileSync('git', ['add', '-A'], { cwd: root })
    execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'init'], { cwd: root })
  }
  return root
}

function context(root, requirementId = 'REQ-PAY-001') {
  const index = indexReport(root)
  const asset = index.assets.find((entry) => entry.id === requirementId)
  return {
    asset,
    assets: index.assets,
    item: { id: asset.id, file: asset.source.path },
    check: checkReport(root),
  }
}

function writeAcceptanceConfig(root, requirementId, commands) {
  mkdirSync(join(root, '.alm', 'acceptance'), { recursive: true })
  writeFileSync(
    join(root, '.alm', 'acceptance', `${requirementId}.json`),
    JSON.stringify({ schema: 'alm.acceptance.config/v1', requirement: requirementId, commands }, null, 2),
  )
}

const PASS_COMMAND = [{ id: 'smoke', command: ['node', '-e', 'process.exit(0)'] }]
const FAIL_COMMAND = [{ id: 'broken', command: ['node', '-e', 'process.exit(3)'] }]

/** Register and execute acceptance with the provenance context. */
function runAcceptanceFor(root, ctx) {
  writeAcceptanceConfig(root, ctx.asset.id, PASS_COMMAND)
  return runAcceptance({
    root,
    requirementId: ctx.asset.id,
    apply: true,
    context: {
      asset: ctx.asset,
      assets: ctx.assets,
      actor: 'human:local',
      project: 'PAY',
      file: ctx.asset.source.path,
    },
  })
}

test.after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

test('runReview previews and persists a gate-backed report', () => {
  const root = makeRepo()
  const ctx = context(root)
  const preview = runReview({ root, ...ctx })
  assert.equal(preview.schema, 'alm.review/v1')
  assert.equal(preview.source, 'executor')
  assert.equal(preview.applied, false)
  assert.equal(preview.roles.length, 5)
  assert.match(preview.contentHash, /^[0-9a-f]{64}$/)
  assert.deepEqual(preview.summary.coverage, { completed: 5, total: 5, missing: [] })
  assert.equal(preview.summary.ready, true)
  assert.equal(readReviewReport(root, 'REQ-PAY-001'), null)

  const applied = runReview({ root, ...ctx, apply: true })
  assert.equal(applied.applied, true)
  const stored = readReviewReport(root, 'REQ-PAY-001')
  assert.equal(stored.source, 'executor')
  assert.equal(stored.requirement, 'REQ-PAY-001')
  assert.equal(stored.signoff, null)
  assert.deepEqual(stored.summary.coverage, { completed: 5, total: 5, missing: [] })
})

test('signReview requires a report, blocks bad actors and validates sign-off', () => {
  const root = makeRepo({ git: true })
  const ctx = context(root)
  assert.throws(
    () => signReview({ root, asset: ctx.asset, actor: 'agent:bot' }),
    (error) => error.code === 'invalid-actor',
  )
  assert.throws(
    () => signReview({ root, asset: ctx.asset, actor: 'human:tester' }),
    (error) => error.code === 'no-review' && error.status === 409,
  )

  runReview({ root, ...ctx, apply: true })
  const run = runAcceptanceFor(root, ctx)
  const plan = signReview({ root, asset: ctx.asset, actor: 'human:peterzhanghao' })
  assert.equal(plan.schema, 'alm.signoff.plan/v1')
  assert.equal(plan.applied, false)
  assert.equal(plan.alreadySigned, false)
  assert.equal(plan.signoff.allowed, true)
  assert.equal(plan.policy.risk, 'high')
  assert.deepEqual(plan.coverage, { rolesCompleted: 5, rolesRequired: 5, missingRoles: [] })

  const signed = signReview({ root, asset: ctx.asset, actor: 'human:peterzhanghao', apply: true })
  assert.equal(signed.applied, true)
  assert.equal(signed.signoff.actor, 'human:peterzhanghao')
  assert.equal(signed.signoff.contentHash, plan.contentHash)
  assert.equal(signed.signoff.headSha, run.headSha)
  assert.equal(signed.signoff.requirementHash, run.evidence.requirementHash)
  assert.equal(signed.signoff.testRevision, run.evidence.testRevision)
  assert.equal(
    signed.signoff.evidenceHash,
    sha256(`${run.evidence.requirementHash}${run.evidence.testRevision}${run.headSha}`),
  )

  const view = reviewView({ root, ...ctx })
  assert.equal(view.stored, true)
  assert.equal(view.signoffValid, true)
  assert.equal(view.signoff.valid, true)
  assert.equal(view.evidenceBound, true)
  assert.deepEqual(view.coverage, { completed: 5, total: 5, missing: [] })
  const report = readReviewReport(root, 'REQ-PAY-001')
  assert.equal(report.signoff.decision, 'approve')
  assert.equal(report.signoffs.length, 1)
})

test('content changes invalidate an existing sign-off', () => {
  const root = makeRepo({ git: true })
  const ctx = context(root)
  const beforeHash = requirementContentHash({ root, asset: ctx.asset })
  assert.equal(beforeHash, requirementContentHash({ root, asset: ctx.asset }))
  runReview({ root, ...ctx, apply: true })
  runAcceptanceFor(root, ctx)
  signReview({ root, asset: ctx.asset, actor: 'human:tester', apply: true })

  const file = join(root, ctx.asset.source.path)
  writeFileSync(file, readFileSync(file, 'utf8').replace('TITLE: 支持订单部分退款', 'TITLE: 支持订单部分退款（改）'))
  const changed = context(root)
  const view = reviewView({ root, ...changed })
  assert.equal(view.signoffValid, false)
  assert.equal(view.signoff.valid, false)
  assert.notEqual(view.contentHash, beforeHash)
  assert.throws(
    () => signReview({ root, asset: changed.asset, actor: 'human:tester', apply: true }),
    (error) => error.code === 'review-stale',
  )
})

test('blockers prevent sign-off', () => {
  const root = makeRepo()
  const file = join(root, 'requirements/refund.sdoc')
  writeFileSync(file, readFileSync(file, 'utf8').replace(/\[RELATION\]\nType: verified_by\nValue: TEST-PAY-001\n/, ''))
  const ctx = context(root)
  const report = runReview({ root, ...ctx, apply: true })
  assert.equal(report.summary.blockers, 1)
  assert.throws(
    () => signReview({ root, asset: ctx.asset, actor: 'human:tester' }),
    (error) => error.code === 'blocked' && error.status === 409,
  )
})

test('sign-off is a backend hard gate: missing, not-run and failed acceptance are refused', () => {
  const root = makeRepo({ git: true })
  const ctx = context(root)
  runReview({ root, ...ctx, apply: true })

  assert.throws(
    () => signReview({ root, asset: ctx.asset, actor: 'human:tester' }),
    (error) => error.code === 'acceptance-missing' && error.status === 409,
  )

  writeAcceptanceConfig(root, ctx.asset.id, PASS_COMMAND)
  assert.throws(
    () => signReview({ root, asset: ctx.asset, actor: 'human:tester' }),
    (error) => error.code === 'acceptance-not-run' && error.status === 409,
  )

  writeAcceptanceConfig(root, ctx.asset.id, FAIL_COMMAND)
  runAcceptance({
    root,
    requirementId: ctx.asset.id,
    apply: true,
    context: { asset: ctx.asset, assets: ctx.assets, actor: 'human:local' },
  })
  assert.throws(
    () => signReview({ root, asset: ctx.asset, actor: 'human:tester' }),
    (error) => error.code === 'acceptance-failed' && error.status === 409,
  )

  // A passing re-run on the same snapshot clears the gate and allows sign-off.
  runAcceptanceFor(root, ctx)
  const plan = signReview({ root, asset: ctx.asset, actor: 'human:tester' })
  assert.equal(plan.signoff.allowed, true)
})

test('acceptance evidence from an older HEAD is stale and refused', () => {
  const root = makeRepo({ git: true })
  const ctx = context(root)
  runReview({ root, ...ctx, apply: true })
  runAcceptanceFor(root, ctx)

  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-qm', 'next'], {
    cwd: root,
  })
  assert.throws(
    () => signReview({ root, asset: ctx.asset, actor: 'human:tester' }),
    (error) => error.code === 'acceptance-stale' && error.status === 409,
  )
})

test('missing required review perspectives are refused even if the client claims done', () => {
  const root = makeRepo()
  const ctx = context(root)
  // A stored report that silently lacks the security perspective: the backend
  // recomputes coverage from the persisted roles and refuses the sign-off.
  writeReviewReport(root, {
    schema: 'alm.review/v1',
    requirement: ctx.asset.id,
    source: 'executor',
    headSha: null,
    contentHash: requirementContentHash({ root, asset: ctx.asset }),
    roles: [
      { id: 'business', label: '业务', verdict: 'pass', rules: [], findings: [] },
      { id: 'architecture', label: '架构', verdict: 'pass', rules: [], findings: [] },
      { id: 'testing', label: '测试', verdict: 'pass', rules: [], findings: [] },
      { id: 'delivery', label: '交付', verdict: 'pass', rules: [], findings: [] },
    ],
    summary: { completed: 4, total: 4, blockers: 0, ready: true },
    signoff: null,
  })
  assert.throws(
    () => signReview({ root, asset: ctx.asset, actor: 'human:tester' }),
    (error) => error.code === 'coverage-incomplete' && /评审视角未覆盖：security/.test(error.message),
  )
})

test('sign-off history is appended and old records are preserved', () => {
  const root = makeRepo({ git: true })
  const first = context(root)
  runReview({ root, ...first, apply: true })
  const firstRun = runAcceptanceFor(root, first)
  const firstSign = signReview({ root, asset: first.asset, actor: 'human:alice', apply: true })
  assert.equal(firstSign.applied, true)

  const file = join(root, first.asset.source.path)
  writeFileSync(file, readFileSync(file, 'utf8').replace('TITLE: 支持订单部分退款', 'TITLE: 支持订单部分退款（第二版）'))
  const second = context(root)
  runReview({ root, ...second, apply: true })
  const secondRun = runAcceptanceFor(root, second)
  const secondSign = signReview({ root, asset: second.asset, actor: 'human:bob', apply: true })
  assert.equal(secondSign.applied, true)
  assert.notEqual(secondRun.evidence.requirementHash, firstRun.evidence.requirementHash)

  const report = readReviewReport(root, 'REQ-PAY-001')
  assert.equal(report.signoffs.length, 2)
  assert.equal(report.signoffs[0].actor, 'human:alice')
  assert.equal(report.signoffs[0].contentHash, firstSign.signoff.contentHash)
  assert.equal(report.signoffs[1].actor, 'human:bob')
  assert.deepEqual(report.signoff, report.signoffs[1])
  assert.notEqual(report.signoffs[0].evidenceHash, report.signoffs[1].evidenceHash)

  const view = reviewView({ root, ...second })
  assert.equal(view.signoffValid, true)
  assert.equal(view.signoff.actor, 'human:bob')
})

test('signing an already verified requirement is idempotent and writes no duplicate record', () => {
  const root = makeRepo({ git: true })
  const ctx = context(root)
  runReview({ root, ...ctx, apply: true })
  runAcceptanceFor(root, ctx)
  signReview({ root, asset: ctx.asset, actor: 'human:tester', apply: true })

  const again = signReview({ root, asset: ctx.asset, actor: 'human:tester', apply: true })
  assert.equal(again.applied, false)
  assert.equal(again.alreadySigned, true)
  assert.equal(readReviewReport(root, 'REQ-PAY-001').signoffs.length, 1)
})
