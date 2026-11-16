import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gitText } from '../../src/git-run.mjs'

function repo(t) {
  const root = mkdtempSync(join(tmpdir(), 'alm-git-run-'))
  execFileSync('git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'init', '-q'], { cwd: root })
  writeFileSync(join(root, 'a.txt'), 'a\n')
  execFileSync('git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'add', '.'], { cwd: root })
  execFileSync('git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture'], { cwd: root })
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

test('pipes and the file fallback return the same bytes', (t) => {
  const root = repo(t)
  const piped = gitText(root, ['rev-parse', 'HEAD'])
  assert.match(piped, /^[a-f0-9]{40}$/)
  process.env.ALM_GIT_FILE_STDIO = '1'
  t.after(() => { delete process.env.ALM_GIT_FILE_STDIO })
  assert.equal(gitText(root, ['rev-parse', 'HEAD']), piped)
  assert.equal(gitText(root, ['rev-parse', '--short', 'HEAD']), piped.slice(0, 7))
})

test('a failing git command still throws instead of returning empty output', (t) => {
  const root = repo(t)
  process.env.ALM_GIT_FILE_STDIO = '1'
  t.after(() => { delete process.env.ALM_GIT_FILE_STDIO })
  assert.throws(() => gitText(root, ['rev-parse', 'not-a-ref']), /git rev-parse exited/)
})
