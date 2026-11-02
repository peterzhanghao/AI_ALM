import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { indexReport } from '../../src/commands.mjs'
import { applyRemove, planRemove } from '../../src/requirements/remove.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
const dirs = []

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function makeRepo(fixture) {
  const root = mkdtempSync(join(tmpdir(), 'alm-remove-'))
  dirs.push(root)
  cpSync(join(repoRoot, fixture), root, { recursive: true })
  git(root, ['init', '-q'])
  git(root, ['add', '-A'])
  git(root, ['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'fixture'])
  return root
}

// A shared sdoc holding two requirement blocks: deleting one must only remove
// that block, which is the case that cannot be covered by the single-record
// fixtures.
function makeSharedRepo() {
  const root = makeRepo('fixtures/order-refund')
  const source = readFileSync(join(root, 'requirements', 'refund-idempotent.sdoc'), 'utf8')
  const second = source.replace('UID: REQ-PAY-004', 'UID: REQ-PAY-005')
  writeFileSync(join(root, 'requirements', 'shared.sdoc'), `${source}\n${second}`, 'utf8')
  git(root, ['add', '-A'])
  git(root, ['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'shared'])
  return root
}

function assetOf(root, id) {
  const index = indexReport(root)
  const asset = index.assets.find((entry) => entry.id === id && entry.type === 'requirement')
  assert.ok(asset, `fixture should contain ${id}`)
  return asset
}

test('planRemove removes one block from a shared sdoc and keeps siblings', () => {
  const root = makeSharedRepo()
  const asset = assetOf(root, 'REQ-PAY-005')
  const plan = planRemove({ root, asset, reason: '测试清理' })
  assert.equal(plan.schema, 'alm.requirement.remove/v1')
  assert.equal(plan.mode, 'block')
  assert.ok(plan.siblings > 1)
  assert.match(plan.before.content, /REQ-PAY-005/)
  assert.doesNotMatch(plan.after.content, /UID\s*:\s*REQ-PAY-005/, 'target block should be gone from the preview')
  assert.match(plan.after.content, /UID\s*:\s*REQ-PAY-004/, 'siblings must stay in the preview')
})

test('applyRemove deletes the block, writes an audit copy, and leaves no record behind', () => {
  const root = makeSharedRepo()
  const asset = assetOf(root, 'REQ-PAY-005')
  const plan = planRemove({ root, asset })
  const result = applyRemove({
    root,
    asset,
    expectedBaseline: plan.baseline,
    actor: 'human:test',
    reason: '重复记录',
    idempotencyKey: 'k1',
  })
  assert.equal(result.applied, true)
  assert.equal(result.mode, 'block')
  assert.ok(existsSync(join(root, result.file)), 'shared sdoc must survive')
  const text = readFileSync(join(root, result.file), 'utf8')
  assert.doesNotMatch(text, /UID\s*:\s*REQ-PAY-005/)
  assert.match(text, /UID\s*:\s*REQ-PAY-004/)
  assert.equal(indexReport(root).assets.some((entry) => entry.id === 'REQ-PAY-005'), false)
  const audits = readdirSync(join(root, '.alm', 'audit', 'requirements'))
  assert.equal(audits.length, 1)
  const audit = JSON.parse(readFileSync(join(root, '.alm', 'audit', 'requirements', audits[0]), 'utf8'))
  assert.equal(audit.kind, 'remove')
  assert.equal(audit.actor, 'human:test')
  assert.match(audit.before.content, /REQ-PAY-005/, 'audit must keep the deleted content for recovery')
})

test('applyRemove refuses a stale baseline', () => {
  const root = makeRepo('fixtures/order-refund')
  const asset = assetOf(root, 'REQ-PAY-004')
  assert.throws(
    () =>
      applyRemove({
        root,
        asset,
        expectedBaseline: { contentHash: 'stale', relationHash: 'stale' },
        actor: 'human:test',
      }),
    (error) => {
      assert.equal(error.code, 'stale-preview')
      return true
    },
  )
})

test('applyRemove requires an actor', () => {
  const root = makeRepo('fixtures/order-refund')
  const asset = assetOf(root, 'REQ-PAY-004')
  const plan = planRemove({ root, asset })
  assert.throws(() => applyRemove({ root, asset, expectedBaseline: plan.baseline }), (error) => {
    assert.equal(error.code, 'actor-required')
    return true
  })
})

test('planRemove deletes a single-requirement file whole', () => {
  const root = makeRepo('fixtures/smoke')
  const asset = assetOf(root, 'REQ-SMK-001')
  const plan = planRemove({ root, asset })
  assert.equal(plan.mode, 'file')
  assert.equal(plan.after, null)
  const result = applyRemove({ root, asset, expectedBaseline: plan.baseline, actor: 'human:test' })
  assert.equal(result.mode, 'file')
  assert.equal(existsSync(join(root, result.file)), false)
})

test.after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})
