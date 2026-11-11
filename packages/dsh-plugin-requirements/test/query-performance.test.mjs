import assert from 'node:assert/strict'
import cp from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { nextActionFor, requirements, versionHistories } from '../query.mjs'
import { checkReport, indexReport, loadRepo } from '../../alm-core/src/commands.mjs'
import { createCandidate, candidateStatus } from '../../alm-core/src/requirements/candidate.mjs'
import { applyAcceptanceConfig, runAcceptance, acceptanceSummary } from '../../alm-core/src/acceptance/acceptance.mjs'

function verifiedCandidate(root, asset, assets) {
  applyAcceptanceConfig({ root, requirementId: asset.id, commands: [{ id: 'smoke', command: ['node', '-e', 'process.exit(0)'] }] })
  const context = { asset, assets }
  const run = runAcceptance({ root, requirementId: asset.id, apply: true, context })
  return createCandidate({ root, asset, acceptance: acceptanceSummary(root, asset.id, run.headSha, context) })
}

test('published same-iteration history does not offer publishing again after a later draft', () => {
  assert.equal(nextActionFor({ delivery: { key: 'accepted', source: 'release' }, release: { status: 'draft', lastReleased: { status: 'released' } } }, []), 'done')
  assert.equal(nextActionFor({ delivery: { key: 'accepted', source: 'acceptance' }, release: { status: 'draft' } }, []), 'release')
})

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'alm-query-performance-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  cpSync(new URL('../../../fixtures/order-refund/', import.meta.url), root, { recursive: true })
  cp.execFileSync('git', ['init', '-q', root])
  return root
}

function countGit(t) {
  const original = cp.execFileSync
  const calls = []
  const mock = t.mock.method(cp, 'execFileSync', function (...args) {
    if (args[0] === 'git') calls.push(args[1])
    return original.apply(this, args)
  })
  syncBuiltinESMExports()
  t.after(() => { mock.mock.restore(); syncBuiltinESMExports() })
  return calls
}

test('successful empty batch histories are known-empty for every uncommitted path', (t) => {
  const root = fixture(t)
  // An initial commit outside requirements makes git log a successful empty walk.
  writeFileSync(join(root, 'seed.txt'), 'seed')
  cp.execFileSync('git', ['-C', root, 'add', 'seed.txt'])
  cp.execFileSync('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'seed'])
  const paths = ['requirements/refund.sdoc', 'requirements/untracked.sdoc']
  const histories = versionHistories(root, paths)
  for (const path of paths) assert.deepEqual(histories.get(path), [])
  const calls = countGit(t)
  const payload = requirements(root)
  assert.ok(payload.requirements.length > 0)
  assert.equal(calls.filter((args) => args.includes('--follow')).length, 0)
  assert.equal(calls.filter((args) => args.includes('--show-toplevel')).length, 1)
})

test('one query shares one live snapshot but the next query detects dirty content changes', (t) => {
  const root = fixture(t)
  writeFileSync(join(root, 'delivered.txt'), 'before')
  const loaded = loadRepo(root)
  const assets = loaded.assets.filter((asset) => asset.type === 'requirement').slice(0, 2)
  assert.equal(assets.length, 2)
  cp.execFileSync('git', ['-C', root, 'add', '.'])
  cp.execFileSync('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture'])
  for (const asset of assets) verifiedCandidate(root, asset, loaded.assets)
  const calls = countGit(t)
  const first = requirements(root)
  assert.equal(calls.filter((args) => args.includes('--porcelain=v1')).length, 1)
  for (const asset of assets) assert.equal(first.requirements.find((item) => item.id === asset.id).candidate.current, true)
  writeFileSync(join(root, 'delivered.txt'), 'after')
  const second = requirements(root)
  assert.equal(calls.filter((args) => args.includes('--porcelain=v1')).length, 2)
  for (const asset of assets) {
    const candidate = second.requirements.find((item) => item.id === asset.id).candidate
    assert.equal(candidate.current, false)
    assert.ok(candidate.reasons.some((reason) => reason.code === 'worktree-changed'))
  }
})

test('default candidate validation stays fresh and missing candidates do not scan git', (t) => {
  const root = fixture(t)
  const asset = loadRepo(root).assets.find((entry) => entry.type === 'requirement')
  writeFileSync(join(root, 'delivery.txt'), 'before')
  cp.execFileSync('git', ['-C', root, 'add', '.'])
  cp.execFileSync('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture'])
  const candidate = verifiedCandidate(root, asset, loadRepo(root).assets)
  const calls = countGit(t)
  assert.equal(candidateStatus({ root, asset, candidate: null }).current, false)
  assert.equal(calls.length, 0)
  assert.equal(candidateStatus({ root, asset, candidate }).current, true)
  writeFileSync(join(root, 'delivery.txt'), 'after')
  assert.equal(candidateStatus({ root, asset, candidate }).current, false)
  assert.equal(calls.filter((args) => args.includes('--porcelain=v1')).length, 2)
})

test('shared parsed input preserves index and gate report contracts', (t) => {
  const root = fixture(t)
  const loaded = loadRepo(root)
  assert.deepEqual(indexReport(root, { loaded }), indexReport(root))
  assert.deepEqual(checkReport(root, {}, { loaded }), checkReport(root))
})

test('targeted requirement projection matches the full query and preserves shared history scope', (t) => {
  const root = fixture(t)
  cp.execFileSync('git', ['-C', root, 'add', '.'])
  cp.execFileSync('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture'])
  const full = requirements(root)
  assert.ok(full.requirements.length > 1)
  for (const item of full.requirements) {
    const targeted = requirements(root, { requirementId: item.id })
    assert.equal(targeted.requirements.length, 1)
    const expected = item.detailView.record
    const actual = targeted.requirements[0].detailView.record
    assert.deepEqual(actual.timeline, expected.timeline)
    assert.equal(actual.timelineOmitted, expected.timelineOmitted)
    assert.equal(actual.timelineFingerprint, expected.timelineFingerprint)
  }
  assert.deepEqual(requirements(root, { requirementId: 'REQ-MISSING' }).requirements, [])
})
