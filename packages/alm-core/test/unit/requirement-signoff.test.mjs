import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { acceptanceSummary, runAcceptance } from '../../src/acceptance/acceptance.mjs'
import { indexReport } from '../../src/commands.mjs'
import { createCandidate } from '../../src/requirements/candidate.mjs'
import {
  SIGNOFF_SCHEMA,
  readRequirementSignoffs,
  signoffView,
  signRequirement,
} from '../../src/requirements/signoff.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
const fixture = join(repoRoot, 'fixtures/order-refund')
const roots = []
const HUMAN = { id: 'human:tester', kind: 'human', source: 'host-authenticated' }
const PASS_COMMAND = [{ id: 'smoke', command: ['node', '-e', 'process.exit(0)'] }]

test('signoff refuses a candidate different from the one the human reviewed', () => {
  const root = makeRepo()
  const { asset } = context(root)
  assert.throws(() => signRequirement({ root, asset, actor: HUMAN.id, subject: HUMAN, apply: true, expectedCandidate: { id: 'CAND-old', treeHash: 'old' } }), { code: 'signoff-candidate-changed' })
  assert.equal(readRequirementSignoffs(root, asset.id), null)
})

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'alm-signoff-'))
  roots.push(root)
  cpSync(fixture, root, { recursive: true })
  execFileSync('git', ['init', '-q'], { cwd: root })
  execFileSync('git', ['add', '-A'], { cwd: root })
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'init'], { cwd: root })
  return root
}

function context(root) {
  const indexed = indexReport(root)
  const asset = indexed.assets.find((entry) => entry.id === 'REQ-PAY-001')
  return { asset, assets: indexed.assets }
}

function writeAcceptanceConfig(root, requirementId) {
  mkdirSync(join(root, '.alm', 'acceptance'), { recursive: true })
  writeFileSync(
    join(root, '.alm', 'acceptance', `${requirementId}.json`),
    `${JSON.stringify({ schema: 'alm.acceptance.config/v1', requirement: requirementId, commands: PASS_COMMAND }, null, 2)}\n`,
  )
}

function readyForSignoff(root, ctx = context(root)) {
  writeAcceptanceConfig(root, ctx.asset.id)
  const run = runAcceptance({
    root,
    requirementId: ctx.asset.id,
    apply: true,
    context: {
      asset: ctx.asset,
      assets: ctx.assets,
      actor: 'test:runner',
      project: 'PAY',
      file: ctx.asset.source.path,
    },
  })
  const acceptance = acceptanceSummary(root, ctx.asset.id, run.headSha, { asset: ctx.asset, assets: ctx.assets })
  const candidate = createCandidate({ root, asset: ctx.asset, acceptance, actor: 'ai:adopted', source: 'test' })
  return { ctx, run, acceptance, candidate }
}

function sign(root, asset, extra = {}) {
  return signRequirement({ root, asset, actor: HUMAN.id, subject: HUMAN, ...extra })
}

test.after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

test('plans and signs without any review report', () => {
  const root = makeRepo()
  const { ctx, acceptance, candidate } = readyForSignoff(root)
  assert.equal(existsSync(join(root, '.alm', 'reviews', `${ctx.asset.id}.json`)), false)

  const plan = sign(root, ctx.asset, { acceptance })
  assert.equal(plan.schema, 'alm.requirement-signoff.plan/v1')
  assert.equal(plan.applied, false)
  assert.equal(plan.signoff.allowed, true)
  assert.equal(plan.candidate.id, candidate.id)

  const applied = sign(root, ctx.asset, { acceptance, apply: true })
  assert.equal(applied.applied, true)
  assert.equal(applied.signoff.actor, HUMAN.id)
  const stored = readRequirementSignoffs(root, ctx.asset.id)
  assert.equal(stored.schema, SIGNOFF_SCHEMA)
  assert.equal(stored.signoffs.length, 1)
  assert.equal(existsSync(join(root, '.alm', 'signoffs', `${ctx.asset.id}.json`)), true)
  assert.equal(signoffView({ root, asset: ctx.asset, acceptance }).signoffValid, true)
})

test('requires a trusted host subject instead of trusting the actor label', () => {
  const root = makeRepo()
  const { ctx, acceptance } = readyForSignoff(root)
  for (const subject of [
    null,
    { id: 'human:tester', kind: 'human', source: 'request-body' },
    { id: 'ai:agent', kind: 'human', source: 'host-authenticated' },
    { id: 'human:other', kind: 'human', source: 'host-authenticated' },
  ]) {
    assert.throws(
      () => signRequirement({ root, asset: ctx.asset, actor: HUMAN.id, subject, acceptance, apply: true }),
      (error) => error.code === 'untrusted-subject' && error.status === 403,
    )
  }
  assert.equal(readRequirementSignoffs(root, ctx.asset.id), null)
})

test('binds sign-off to the current candidate and acceptance provenance', () => {
  const root = makeRepo()
  const { ctx, acceptance, candidate, run } = readyForSignoff(root)
  const applied = sign(root, ctx.asset, { acceptance, apply: true })
  assert.equal(applied.signoff.candidateId, candidate.id)
  assert.equal(applied.signoff.candidateHash, candidate.treeHash)
  assert.equal(applied.signoff.requirementHash, run.evidence.requirementHash)
  assert.equal(applied.signoff.testRevision, run.evidence.testRevision)
  assert.equal(applied.signoff.headSha, run.headSha)

  const staleAcceptance = {
    ...acceptance,
    latest: { ...acceptance.latest, testRevision: 'f'.repeat(64) },
  }
  const view = signoffView({ root, asset: ctx.asset, acceptance: staleAcceptance })
  assert.equal(view.signoffValid, false)
  assert.equal(view.evidenceBound, false)
})

test('requirement content changes invalidate the sign-off', () => {
  const root = makeRepo()
  const { ctx, acceptance } = readyForSignoff(root)
  sign(root, ctx.asset, { acceptance, apply: true })

  const file = join(root, ctx.asset.source.path)
  writeFileSync(file, readFileSync(file, 'utf8').replace('TITLE: 支持订单部分退款', 'TITLE: 支持订单部分退款（改）'))
  const changed = context(root)
  const view = signoffView({ root, asset: changed.asset, acceptance })
  assert.equal(view.signoffValid, false)
  assert.equal(view.signoff.valid, false)
})

test('repeat signing is idempotent and a new evidence generation appends history', () => {
  const root = makeRepo()
  const first = readyForSignoff(root)
  sign(root, first.ctx.asset, { acceptance: first.acceptance, apply: true })
  const repeated = sign(root, first.ctx.asset, { acceptance: first.acceptance, apply: true })
  assert.equal(repeated.alreadySigned, true)
  assert.equal(repeated.applied, false)
  assert.equal(readRequirementSignoffs(root, first.ctx.asset.id).signoffs.length, 1)

  const file = join(root, first.ctx.asset.source.path)
  writeFileSync(file, readFileSync(file, 'utf8').replace('TITLE: 支持订单部分退款', 'TITLE: 支持订单部分退款（第二版）'))
  const secondCtx = context(root)
  const second = readyForSignoff(root, secondCtx)
  sign(root, second.ctx.asset, { acceptance: second.acceptance, apply: true })
  const stored = readRequirementSignoffs(root, second.ctx.asset.id)
  assert.equal(stored.signoffs.length, 2)
  assert.notEqual(stored.signoffs[0].contentHash, stored.signoffs[1].contentHash)
  const view = signoffView({ root, asset: second.ctx.asset, acceptance: second.acceptance })
  assert.deepEqual(view.signoffs.map(entry => entry.valid), [false, true])
  assert.equal(view.signoff.candidateId, stored.signoffs[1].candidateId)
  assert.equal(view.signoffValid, true)
})

test('reads legacy human sign-off as migration input but writes only the new signoff store', () => {
  const root = makeRepo()
  const { ctx, acceptance } = readyForSignoff(root)
  const reviewsDir = join(root, '.alm', 'reviews')
  mkdirSync(reviewsDir, { recursive: true })
  const legacyPath = join(reviewsDir, `${ctx.asset.id}.json`)
  writeFileSync(
    legacyPath,
    `${JSON.stringify({
      schema: 'alm.review/v1',
      requirement: ctx.asset.id,
      signoffs: [{ actor: 'human:legacy', decision: 'approve', at: '2026-01-01T00:00:00.000Z' }],
    }, null, 2)}\n`,
  )
  const before = readFileSync(legacyPath, 'utf8')
  const migrated = readRequirementSignoffs(root, ctx.asset.id)
  assert.equal(migrated.migratedFrom, '.alm/reviews')
  assert.equal(migrated.stored, false)
  assert.equal(migrated.signoff.actor, 'human:legacy')
  assert.equal(signoffView({ root, asset: ctx.asset, acceptance }).signoffValid, false)

  sign(root, ctx.asset, { acceptance, apply: true })
  assert.equal(readFileSync(legacyPath, 'utf8'), before)
  const current = JSON.parse(readFileSync(join(root, '.alm', 'signoffs', `${ctx.asset.id}.json`), 'utf8'))
  assert.equal(current.schema, SIGNOFF_SCHEMA)
  assert.equal(current.signoffs.length, 2)
  assert.equal(current.signoffs.at(-1).actor, HUMAN.id)
})
