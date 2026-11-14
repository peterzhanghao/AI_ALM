import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  belongsToOtherRequirement, collectDeliveryScope, developWorktree, isAllowedPath, isNoisePath,
} from '../../src/requirements/delivery-scope.mjs'

const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()

function repo(t) {
  const root = mkdtempSync(join(tmpdir(), 'alm-scope-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  git(root, ['init', '-q'])
  git(root, ['checkout', '-qb', 'develop'])
  git(root, ['config', 'user.name', 'ALM Test'])
  git(root, ['config', 'user.email', 'alm-test@example.test'])
  mkdirSync(join(root, 'base'), { recursive: true })
  writeFileSync(join(root, 'base', 'base.txt'), 'base\n')
  git(root, ['add', '.'])
  git(root, ['commit', '-qm', 'base'])
  return root
}

function put(root, path) {
  const parts = path.split('/')
  mkdirSync(join(root, ...parts.slice(0, -1)), { recursive: true })
  writeFileSync(join(root, ...parts), 'changed\n')
}

test('directory blueprint entries authorize every implementation file below them', () => {
  assert.equal(isAllowedPath('packages/alm-core/src/acceptance/acceptance.mjs', ['packages/']), true)
  assert.equal(isAllowedPath('packages/dsh-plugin-requirements/client-source.js', ['packages/']), true)
  assert.equal(isAllowedPath('packages/alm-core/src/acceptance/acceptance.mjs', ['packages/alm-core/test/unit/a.test.mjs']), false)
  assert.equal(isAllowedPath('package.json', ['package.json']), true)
})

test('local runtime noise and other requirements are never treated as implementation', () => {
  assert.equal(isNoisePath('.workbuddy/memory/2026-11-14.md'), true)
  assert.equal(isNoisePath('fixtures/order-refund/.alm/failures/FAIL-REQ-ALM-006-001.json'), true)
  assert.equal(isNoisePath('.alm/candidates/REQ-ALM-015/CAND.json'), true)
  assert.equal(isNoisePath('packages/alm-core/src/acceptance/acceptance.mjs'), false)
  assert.equal(belongsToOtherRequirement('requirements/briefs/REQ-ALM-014.md', 'REQ-ALM-015'), true)
  assert.equal(belongsToOtherRequirement('requirements/briefs/REQ-ALM-015.md', 'REQ-ALM-015'), false)
  assert.equal(belongsToOtherRequirement('requirements/req-alm-015.sdoc', 'REQ-ALM-015'), false)
  assert.equal(belongsToOtherRequirement('packages/alm-core/src/run.mjs', 'REQ-ALM-015'), false)
})

test('real worktree diff keeps src edits owned, excludes noise and lists every foreign file', (t) => {
  const root = repo(t)
  put(root, 'packages/alm-core/src/acceptance/acceptance.mjs')
  put(root, 'packages/dsh-plugin-requirements/test/default-view.test.mjs')
  put(root, 'package.json')
  put(root, '.workbuddy/memory/2026-11-14.md')
  put(root, 'fixtures/order-refund/.alm/failures/FAIL-REQ-ALM-006-001.json')
  put(root, 'requirements/briefs/REQ-ALM-014.md')
  const allowed = ['packages/', 'requirements/', 'package.json']
  const scope = collectDeliveryScope({ root, allowedPaths: allowed, requirementId: 'REQ-ALM-015' })
  assert.deepEqual(scope.owned.sort(), [
    'package.json',
    'packages/alm-core/src/acceptance/acceptance.mjs',
    'packages/dsh-plugin-requirements/test/default-view.test.mjs',
  ])
  assert.equal(scope.noise.length, 2, JSON.stringify(scope.noise))
  assert.deepEqual(scope.foreign, ['requirements/briefs/REQ-ALM-014.md'])
  assert.equal(scope.ok, false)
  rmSync(join(root, 'requirements', 'briefs', 'REQ-ALM-014.md'))
  const split = collectDeliveryScope({ root, allowedPaths: allowed, requirementId: 'REQ-ALM-015' })
  assert.equal(split.ok, true)
  assert.equal(split.foreign.length, 0)
  assert.equal(developWorktree(root, 'develop'), resolve(root))
})
