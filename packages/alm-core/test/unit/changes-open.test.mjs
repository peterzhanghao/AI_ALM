import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { changeIds, nextChangeId, openChange, planChange } from '../../src/changes/open.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
const fixture = join(repoRoot, 'fixtures/order-refund')
const dirs = []

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'alm-change-open-'))
  dirs.push(root)
  cpSync(fixture, root, { recursive: true })
  git(root, ['init', '-q'])
  git(root, ['add', '-A'])
  git(root, ['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'fixture'])
  return root
}

test.after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

test('planChange picks the next project change id and writes nothing', () => {
  const root = makeRepo()
  const plan = planChange({ root, requirementIds: ['REQ-PAY-004'] })
  assert.equal(plan.schema, 'alm.change.plan/v1')
  assert.equal(plan.changeId, 'CHG-PAY-001')
  assert.equal(plan.project, 'PAY')
  assert.equal(plan.branch, 'alm/chg-pay-001')
  assert.match(plan.baselineSha, /^[0-9a-f]{40}$/)
  assert.equal(plan.taskCount, 3)
  assert.ok(plan.plannedFiles.includes('.alm/changes/CHG-PAY-001.json'))
  assert.ok(!existsSync(join(root, '.alm/changes/CHG-PAY-001.json')))
  assert.ok(!existsSync(join(root, 'changes/CHG-PAY-001')))
})

test('openChange apply writes the change record and three task cards without moving the branch', () => {
  const root = makeRepo()
  const before = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()
  const result = openChange({ root, requirementIds: ['REQ-PAY-004'], apply: true })
  assert.equal(result.applied, true)
  assert.equal(result.draft.tasks.length, 3)
  assert.ok(existsSync(join(root, '.alm/changes/CHG-PAY-001.json')))
  assert.ok(existsSync(join(root, 'changes/CHG-PAY-001/tasks.json')))
  assert.ok(existsSync(join(root, 'changes/CHG-PAY-001/proposal.md')))
  assert.equal(git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).trim(), before)
  assert.ok(changeIds(root).includes('CHG-PAY-001'))
  assert.equal(nextChangeId({ root, projectId: 'PAY' }), 'CHG-PAY-002')
})

test('openChange rejects a duplicate change id and an unknown requirement', () => {
  const root = makeRepo()
  openChange({ root, requirementIds: ['REQ-PAY-004'], apply: true })
  assert.throws(
    () => planChange({ root, requirementIds: ['REQ-PAY-004'], changeId: 'CHG-PAY-001' }),
    (error) => error.code === 'already-exists' && error.status === 409,
  )
  assert.throws(
    () => planChange({ root, requirementIds: ['REQ-NOPE-001'] }),
    (error) => error.code === 'unknown-requirement' && error.status === 404,
  )
})

test('openChange isolate creates a sibling worktree and leaves the main worktree clean', () => {
  const root = makeRepo()
  const plan = planChange({ root, requirementIds: ['REQ-PAY-004'], isolate: true })
  assert.equal(plan.isolate, true)
  assert.ok(plan.worktreePath)
  assert.ok(!existsSync(plan.worktreePath), 'planning must not create the worktree')

  const result = openChange({ root, requirementIds: ['REQ-PAY-004'], apply: true, isolate: true })
  const worktree = result.worktree.path
  try {
    assert.ok(existsSync(worktree))
    assert.equal(git(worktree, ['rev-parse', '--abbrev-ref', 'HEAD']).trim(), 'alm/chg-pay-001')
    assert.ok(existsSync(join(worktree, '.alm/changes/CHG-PAY-001.json')))
    assert.ok(existsSync(join(worktree, 'changes/CHG-PAY-001/tasks.json')))
    assert.ok(!existsSync(join(root, '.alm/changes/CHG-PAY-001.json')))
    assert.deepEqual(git(root, ['status', '--porcelain']).trim(), '')
    assert.ok(!existsSync(join(root, 'changes/CHG-PAY-001')))
  } finally {
    execFileSync('git', ['-C', root, 'worktree', 'remove', '--force', worktree], { stdio: 'ignore' })
    execFileSync('git', ['-C', root, 'branch', '-D', 'alm/chg-pay-001'], { stdio: 'ignore' })
  }
})

test('openChange isolate rejects an existing worktree path', () => {
  const root = makeRepo()
  const plan = planChange({ root, requirementIds: ['REQ-PAY-004'], isolate: true })
  openChange({ root, requirementIds: ['REQ-PAY-004'], changeId: plan.changeId, apply: true, isolate: true })
  try {
    assert.throws(
      () => planChange({ root, requirementIds: ['REQ-PAY-004'], changeId: plan.changeId, isolate: true }),
      (error) => error.code === 'worktree-exists' && error.status === 409,
    )
  } finally {
    execFileSync('git', ['-C', root, 'worktree', 'remove', '--force', plan.worktreePath], { stdio: 'ignore' })
    execFileSync('git', ['-C', root, 'branch', '-D', plan.branch], { stdio: 'ignore' })
  }
})
