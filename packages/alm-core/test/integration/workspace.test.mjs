import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createWorkspace, guardWrite, pathAllowed, statusWorkspace } from '../../src/workspace/workspace.mjs'

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
}

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'alm-workspace-'))
  mkdirSync(join(root, 'requirements'), { recursive: true })
  writeFileSync(join(root, 'requirements/req.yml'), 'schema_version: 1\n', 'utf8')
  git(root, 'init', '-q')
  git(root, 'add', '-A')
  git(root, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'base')
  return root
}

test('createWorkspace opens a branch and commits the change record', () => {
  const root = makeRepo()
  try {
    const record = createWorkspace({ root, baseline: 'HEAD', changeId: 'CHG-TEST-001' })
    assert.equal(record.branch, 'alm/chg-test-001')
    assert.equal(record.status, 'open')
    assert.equal(git(root, 'rev-parse', '--abbrev-ref', 'HEAD'), 'alm/chg-test-001')

    const status = statusWorkspace({ root })
    assert.equal(status.dirty, false)
    assert.equal(status.active.changeId, 'CHG-TEST-001')
    assert.equal(status.changes.length, 1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('duplicate change or branch is refused', () => {
  const root = makeRepo()
  try {
    createWorkspace({ root, baseline: 'HEAD', changeId: 'CHG-TEST-002' })
    assert.throws(
      () => createWorkspace({ root, baseline: 'HEAD', changeId: 'CHG-TEST-002' }),
      /branch already exists/,
    )
    assert.throws(
      () => createWorkspace({ root, baseline: 'HEAD', changeId: 'bad id' }),
      /invalid change id/,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('guardWrite allows asset dirs and rejects escapes', () => {
  const root = makeRepo()
  try {
    createWorkspace({ root, baseline: 'HEAD', changeId: 'CHG-TEST-003' })
    assert.deepEqual(
      guardWrite({ root, changeId: 'CHG-TEST-003', paths: ['requirements/a.yml', 'adr/ADR-X-001.md'] }),
      {
        schema: 'alm.workspace.guard/v1',
        ok: true,
        changeId: 'CHG-TEST-003',
        branch: 'alm/chg-test-003',
        violations: [],
      },
    )

    const denied = guardWrite({ root, paths: ['docs/x.md', '../outside.yml', 'C:/tmp/x.yml'] })
    assert.equal(denied.ok, false)
    assert.deepEqual(denied.violations, ['docs/x.md', '../outside.yml', 'C:/tmp/x.yml'])
    assert.equal(pathAllowed('requirements/nested/file.sdoc'), true)
    assert.equal(pathAllowed('requirements/../../x.yml'), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('writing without an active change is refused', () => {
  const root = makeRepo()
  try {
    const guarded = guardWrite({ root, paths: ['requirements/a.yml'] })
    assert.equal(guarded.ok, false)
    assert.match(guarded.error, /no active change workspace/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
