import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { worktreeSnapshot } from '../../src/requirements/worktree-snapshot.mjs'

test('declared independent validation repo is outside DSH snapshot; other validation content stays checked', t => {
  const root = mkdtempSync(join(tmpdir(), 'snapshot-boundary-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', ...args], { cwd, stdio: 'pipe' })
  writeFileSync(join(root, 'README.md'), '# DSH fixture\n')
  git(root, 'init'); git(root, 'add', '.'); git(root, 'commit', '-qm', 'fixture')
  const nested = join(root, 'validation/requirements-plugin-clean')
  mkdirSync(nested, { recursive: true })
  git(nested, 'init')
  writeFileSync(join(nested, 'server.js'), 'module.exports=1\n')
  const blocked = worktreeSnapshot(root)
  assert.equal(blocked.complete, false)
  assert.ok(blocked.reasons.includes('unverified-file:validation/requirements-plugin-clean/'))

  writeFileSync(join(root, '.gitignore'), readFileSync(new URL('../../../../.gitignore', import.meta.url)))
  writeFileSync(join(root, 'validation/check.js'), 'module.exports=1\n')
  const first = worktreeSnapshot(root)
  assert.equal(first.complete, true)
  assert.ok(first.files.some(f => f.path === '.gitignore'))
  assert.ok(first.files.some(f => f.path === 'validation/check.js'))
  assert.ok(first.files.every(f => !f.path.startsWith('validation/requirements-plugin-clean/')))
  writeFileSync(join(nested, 'server.js'), 'module.exports=2\n')
  assert.equal(worktreeSnapshot(root).treeHash, first.treeHash)
  writeFileSync(join(root, 'validation/check.js'), 'module.exports=2\n')
  assert.notEqual(worktreeSnapshot(root).treeHash, first.treeHash)

  const undeclared = join(root, 'validation/other-project')
  mkdirSync(undeclared)
  git(undeclared, 'init')
  writeFileSync(join(undeclared, 'source.js'), 'module.exports=3\n')
  assert.equal(worktreeSnapshot(root).complete, false)
})

test('snapshot fails closed for git failures and unavailable HEAD', () => {
  const snapshot = worktreeSnapshot('.', { exec: () => { throw new Error('git unavailable') } })
  assert.equal(snapshot.complete, false)
  assert.ok(snapshot.reasons.includes('head-unavailable'))
})

test('snapshot never treats size-only, missing unreadable or non-file as complete', t => {
  const root = mkdtempSync(join(tmpdir(), 'snapshot-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const exec = (_, args) => args[0] === 'rev-parse' ? 'a'.repeat(40) : '?? big.bin\0?? missing.txt\0?? .\0'
  writeFileSync(join(root, 'big.bin'), Buffer.alloc(4 * 1024 * 1024 + 1, 1))
  const first = worktreeSnapshot(root, { exec })
  assert.equal(first.complete, false)
  assert.equal(first.files.find(f => f.path === 'big.bin').omitted, true)
  assert.equal(first.files.find(f => f.path === 'missing.txt').hash, 'unreadable')
  assert.equal(first.files.find(f => f.path === '.').hash, 'not-a-file')
  writeFileSync(join(root, 'big.bin'), Buffer.alloc(4 * 1024 * 1024 + 1, 2))
  const second = worktreeSnapshot(root, { exec })
  assert.equal(second.complete, false)
  const deleted = worktreeSnapshot(root, { exec: (_, args) => args[0] === 'rev-parse' ? 'a'.repeat(40) : ' D deleted.txt\0' })
  assert.equal(deleted.complete, true)
  assert.equal(deleted.files[0].hash, 'deleted')
})
