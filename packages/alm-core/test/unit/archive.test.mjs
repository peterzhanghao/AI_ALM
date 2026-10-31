import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { indexReport } from '../../src/commands.mjs'
import { decideEvidence } from '../../src/evidence/decision.mjs'
import {
  applyArchive,
  ArchiveError,
  archiveBaseline,
  planArchive,
} from '../../src/requirements/archive.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
const fixture = join(repoRoot, 'fixtures/order-refund')
const dirs = []

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'alm-archive-'))
  dirs.push(root)
  cpSync(fixture, root, { recursive: true })
  git(root, ['init', '-q'])
  git(root, ['add', '-A'])
  git(root, ['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'fixture'])
  return root
}

function loadRequirement(root, id = 'REQ-PAY-004') {
  const index = indexReport(root)
  return index.assets.find((entry) => entry.id === id)
}

function auditFiles(root) {
  const dir = join(root, '.alm', 'audit', 'requirements')
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((name) => name.endsWith('.json')).sort()
}

test.after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

test('planArchive rewrites STATUS and REVISION without touching the file', () => {
  const root = makeRepo()
  const asset = loadRequirement(root)
  const before = readFileSync(join(root, asset.source.path), 'utf8')
  const plan = planArchive({ root, asset, reason: '业务决定暂不开发' })

  assert.equal(plan.applied, false)
  assert.equal(plan.status.from, asset.status)
  assert.equal(plan.status.to, 'archived')
  assert.equal(plan.revision, Number(asset.extra?.revision ?? 1) + 1)
  assert.match(plan.after.content, /^STATUS: archived$/m)
  assert.match(plan.after.content, new RegExp(`^REVISION: ${plan.revision}$`, 'm'))
  assert.equal(readFileSync(join(root, asset.source.path), 'utf8'), before, 'preview must not write')
  assert.deepEqual(auditFiles(root), [])
})

test('applyArchive is CAS-guarded, audited and idempotent', () => {
  const root = makeRepo()
  const asset = loadRequirement(root)
  const baseline = archiveBaseline({ root, asset })
  const first = applyArchive({
    root,
    asset,
    expectedBaseline: baseline,
    actor: 'human:local',
    reason: '不开发，直接归档',
    idempotencyKey: 'close-1',
  })

  assert.equal(first.applied, true)
  assert.equal(first.status.to, 'archived')
  assert.match(readFileSync(join(root, asset.source.path), 'utf8'), /^STATUS: archived$/m)
  assert.equal(auditFiles(root).length, 1)

  const replay = applyArchive({
    root,
    asset,
    expectedBaseline: baseline,
    actor: 'human:local',
    reason: '不开发，直接归档',
    idempotencyKey: 'close-1',
  })
  assert.equal(replay.applied, true)
  assert.equal(replay.idempotent, true)
  assert.equal(auditFiles(root).length, 1, 'replay must not write a second audit')

  assert.throws(
    () => applyArchive({ root, asset, expectedBaseline: baseline, actor: 'human:local', idempotencyKey: 'close-2' }),
    (error) => error instanceof ArchiveError && error.code === 'already-archived',
  )
})

test('applyArchive rejects a stale baseline and leaves the file untouched', () => {
  const root = makeRepo()
  const asset = loadRequirement(root)
  const stale = { ...archiveBaseline({ root, asset }), contentHash: '0'.repeat(64) }
  const before = readFileSync(join(root, asset.source.path), 'utf8')
  assert.throws(
    () => applyArchive({ root, asset, expectedBaseline: stale, actor: 'human:local' }),
    (error) => error instanceof ArchiveError && error.code === 'stale-preview',
  )
  assert.equal(readFileSync(join(root, asset.source.path), 'utf8'), before)
})

test('archived requirements are out of the delivery funnel even with old gaps', () => {
  const decision = decideEvidence({
    asset: { id: 'REQ-X', type: 'requirement', status: 'archived', extra: { priority: 'P0' }, links: [] },
    review: null,
    acceptance: null,
    anomalies: [{ kind: 'duplicate-id', message: 'dup' }],
  })
  assert.equal(decision.state, 'archived')
  assert.equal(decision.label, '已归档')
  assert.deepEqual(decision.gaps, [])
  assert.equal(decision.nextStep.action, 'none')
  assert.equal(decision.signoff.allowed, false)
})
