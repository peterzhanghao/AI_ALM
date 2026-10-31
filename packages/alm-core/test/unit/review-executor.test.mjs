import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { checkReport, indexReport } from '../../src/commands.mjs'
import {
  readReviewReport,
  requirementContentHash,
  reviewView,
  runReview,
  signReview,
} from '../../src/review/executor.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
const fixture = join(repoRoot, 'fixtures/order-refund')
const dirs = []

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'alm-review-'))
  dirs.push(root)
  cpSync(fixture, root, { recursive: true })
  return root
}

function context(root, requirementId = 'REQ-PAY-001') {
  const index = indexReport(root)
  const asset = index.assets.find((entry) => entry.id === requirementId)
  return {
    asset,
    item: { id: asset.id, file: asset.source.path },
    check: checkReport(root),
  }
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
  assert.equal(readReviewReport(root, 'REQ-PAY-001'), null)

  const applied = runReview({ root, ...ctx, apply: true })
  assert.equal(applied.applied, true)
  const stored = readReviewReport(root, 'REQ-PAY-001')
  assert.equal(stored.source, 'executor')
  assert.equal(stored.requirement, 'REQ-PAY-001')
  assert.equal(stored.signoff, null)
})

test('signReview requires a report, blocks bad actors and validates sign-off', () => {
  const root = makeRepo()
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
  const plan = signReview({ root, asset: ctx.asset, actor: 'human:peterzhanghao' })
  assert.equal(plan.schema, 'alm.signoff.plan/v1')
  assert.equal(plan.applied, false)
  assert.equal(plan.alreadySigned, false)

  const signed = signReview({ root, asset: ctx.asset, actor: 'human:peterzhanghao', apply: true })
  assert.equal(signed.applied, true)
  assert.equal(signed.signoff.actor, 'human:peterzhanghao')
  assert.equal(signed.signoff.contentHash, plan.contentHash)

  const view = reviewView({ root, ...ctx })
  assert.equal(view.stored, true)
  assert.equal(view.signoffValid, true)
  assert.equal(view.signoff.valid, true)
  assert.equal(readReviewReport(root, 'REQ-PAY-001').signoff.decision, 'approve')
})

test('content changes invalidate an existing sign-off', () => {
  const root = makeRepo()
  const ctx = context(root)
  const beforeHash = requirementContentHash({ root, asset: ctx.asset })
  runReview({ root, ...ctx, apply: true })
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
    (error) => error.code === 'has-blockers',
  )
})
