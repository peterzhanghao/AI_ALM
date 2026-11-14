import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCandidate } from '../../src/requirements/candidate.mjs'
import { collectDeliveryScope } from '../../src/requirements/delivery-scope.mjs'

const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()

test('candidate writes architecture ledger and commits then pushes its scoped delivery to develop', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'alm-dev-sync-'))
  const remote = `${root}-origin.git`
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(remote, { recursive: true, force: true }) })
  execFileSync('git', ['init', '--bare', '-q', remote])
  git(root, ['init', '-q'])
  git(root, ['checkout', '-qb', 'develop'])
  git(root, ['config', 'user.name', 'ALM Test'])
  git(root, ['config', 'user.email', 'alm-test@example.test'])
  git(root, ['remote', 'add', 'origin', remote])
  writeFileSync(join(root, 'package.json'), '{"type":"module"}\n')
  writeFileSync(join(root, 'implementation.mjs'), 'export const title = "before"\n')
  git(root, ['add', '.'])
  git(root, ['commit', '-qm', 'base'])
  git(root, ['push', '-u', 'origin', 'develop'])

  writeFileSync(join(root, 'implementation.mjs'), 'export const title = "after"\n')
  const asset = {
    id: 'REQ-DEV-001', title: '同步需求开发分支', source: { path: 'implementation.mjs' },
    extra: { revision: 5, brief: 'requirements/briefs/REQ-DEV-001.md' },
    doc: { goal: '将已验证的交付同步到开发分支', acceptance: [{ id: 'AC-01', text: '交付档案可追溯。' }] },
  }
  mkdirSync(join(root, 'requirements/briefs'), { recursive: true })
  writeFileSync(join(root, asset.extra.brief), '# REQ-DEV-001\n')
  const candidate = createCandidate({
    root, asset, actor: 'system:test', source: 'test',
    development: { enabled: true, branch: 'develop', remote: 'origin', requirement: { id: asset.id, title: asset.title, revision: 5, doc: asset.doc }, paths: ['implementation.mjs', asset.extra.brief] },
  })
  assert.equal(candidate.development.pushedToRemoteDev, true, JSON.stringify(candidate.development))
  assert.equal(candidate.development.devBranch, 'develop')
  assert.match(candidate.development.devCommitSha, /^[a-f0-9]{40}$/)
  assert.equal(candidate.devCommitSha, candidate.development.devCommitSha)
  assert.equal(existsSync(join(root, 'requirements/architecture/REQ-DEV-001-design.md')), true)
  assert.match(readFileSync(join(root, 'requirements/architecture/REQ-DEV-001-design.md'), 'utf8'), /架构与数据模型交付档案/)
  assert.match(readFileSync(join(root, 'requirements/architecture/ARCHITECTURE-LEDGER.md'), 'utf8'), /REQ-DEV-001/)
  assert.equal(git(root, ['log', '-1', '--format=%s']), 'REQ-DEV-001: 同步需求开发分支')
  assert.equal(git(root, ['rev-parse', 'refs/remotes/origin/develop']), candidate.development.devCommitSha)
  const repeated = createCandidate({
    root, asset, actor: 'system:test', source: 'test',
    development: { enabled: true, branch: 'develop', remote: 'origin', requirement: { id: asset.id, title: asset.title, revision: 5, doc: asset.doc }, paths: ['implementation.mjs', asset.extra.brief] },
  })
  assert.equal(repeated.id, candidate.id)
  assert.equal(git(root, ['rev-parse', 'HEAD']), candidate.development.devCommitSha)
})

test('candidate preserves unrelated work and records why development sync was skipped', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'alm-dev-sync-safe-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  git(root, ['init', '-q'])
  git(root, ['checkout', '-qb', 'develop'])
  git(root, ['config', 'user.name', 'ALM Test'])
  git(root, ['config', 'user.email', 'alm-test@example.test'])
  git(root, ['remote', 'add', 'origin', root])
  writeFileSync(join(root, 'implementation.mjs'), 'export const value = 1\n')
  writeFileSync(join(root, 'unrelated.mjs'), 'export const unrelated = 1\n')
  git(root, ['add', '.']); git(root, ['commit', '-qm', 'base'])
  writeFileSync(join(root, 'implementation.mjs'), 'export const value = 2\n')
  writeFileSync(join(root, 'unrelated.mjs'), 'export const unrelated = 2\n')
  const asset = { id: 'REQ-DEV-002', title: '安全提交', source: { path: 'implementation.mjs' }, extra: { revision: 1 }, doc: { acceptance: [] } }
  const candidate = createCandidate({ root, asset, development: { enabled: true, requirement: { id: asset.id, title: asset.title, revision: 1 }, paths: ['implementation.mjs'] } })
  assert.equal(candidate.development.pushedToRemoteDev, false)
  assert.match(candidate.development.reason, /未归属/)
  assert.match(git(root, ['status', '--short']), /unrelated\.mjs/)
})

test('candidate sync ignores local ALM evidence and temporary artifact folders', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'alm-dev-sync-runtime-'))
  const remote = `${root}-origin.git`
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(remote, { recursive: true, force: true }) })
  execFileSync('git', ['init', '--bare', '-q', remote])
  git(root, ['init', '-q']); git(root, ['checkout', '-qb', 'develop'])
  git(root, ['config', 'user.name', 'ALM Test']); git(root, ['config', 'user.email', 'alm-test@example.test'])
  git(root, ['remote', 'add', 'origin', remote])
  writeFileSync(join(root, 'implementation.mjs'), 'export const value = 1\n')
  git(root, ['add', '.']); git(root, ['commit', '-qm', 'base']); git(root, ['push', '-u', 'origin', 'develop'])
  writeFileSync(join(root, 'implementation.mjs'), 'export const value = 2\n')
  mkdirSync(join(root, '.alm/runs'), { recursive: true }); writeFileSync(join(root, '.alm/runs/RUN-1.json'), '{}')
  mkdirSync(join(root, 'artifacts'), { recursive: true }); writeFileSync(join(root, 'artifacts/debug.json'), '{}')
  mkdirSync(join(root, 'validation'), { recursive: true }); writeFileSync(join(root, 'validation/README.md'), 'local only')
  const asset = { id: 'REQ-DEV-003', title: '忽略本地运行产物', source: { path: 'implementation.mjs' }, extra: { revision: 1 }, doc: { acceptance: [] } }
  const candidate = createCandidate({ root, asset, development: { enabled: true, requirement: { id: asset.id, title: asset.title, revision: 1 }, paths: ['implementation.mjs'] } })
  assert.equal(candidate.development.pushedToRemoteDev, true, candidate.development.reason)
  assert.equal(git(root, ['rev-parse', 'refs/remotes/origin/develop']), candidate.development.devCommitSha)
  const status = git(root, ['status', '--short'])
  assert.match(status, /\.alm\//)
  assert.match(status, /artifacts\//)
  assert.match(status, /validation\//)
})

test('real src diff, directory authorization and architecture archive share one delivery commit', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'alm-dev-sync-scope-'))
  const remote = `${root}-origin.git`
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(remote, { recursive: true, force: true }) })
  execFileSync('git', ['init', '--bare', '-q', remote])
  git(root, ['init', '-q'])
  git(root, ['checkout', '-qb', 'develop'])
  git(root, ['config', 'user.name', 'ALM Test'])
  git(root, ['config', 'user.email', 'alm-test@example.test'])
  git(root, ['remote', 'add', 'origin', remote])
  writeFileSync(join(root, 'package.json'), '{"type":"module"}\n')
  writeFileSync(join(root, 'implementation.mjs'), 'export const title = "before"\n')
  writeFileSync(join(root, 'never-changed.test.mjs'), 'export const untouched = true\n')
  mkdirSync(join(root, 'requirements/briefs'), { recursive: true })
  writeFileSync(join(root, 'requirements/briefs/REQ-DEV-004.md'), '# REQ-DEV-004\n')
  git(root, ['add', '.'])
  git(root, ['commit', '-qm', 'base'])
  git(root, ['push', '-u', 'origin', 'develop'])

  writeFileSync(join(root, 'implementation.mjs'), 'export const title = "after"\n')
  mkdirSync(join(root, '.workbuddy/memory'), { recursive: true })
  writeFileSync(join(root, '.workbuddy/memory/2026-11-14.md'), 'local notes\n')
  mkdirSync(join(root, 'fixtures/order-refund/.alm/failures'), { recursive: true })
  writeFileSync(join(root, 'fixtures/order-refund/.alm/failures/FAIL-REQ-ALM-006-001.json'), '{}')

  const asset = {
    id: 'REQ-DEV-004', title: '真实改动自动归档', source: { path: 'implementation.mjs' },
    extra: { revision: 1, brief: 'requirements/briefs/REQ-DEV-004.md' },
    doc: { goal: '按真实改动生成架构档案并提交', acceptance: [{ id: 'AC-01', text: 'src 改动进入提交。' }] },
  }
  const scope = collectDeliveryScope({
    root,
    allowedPaths: ['packages/', 'requirements/', 'implementation.mjs', 'package.json'],
    requirementId: asset.id,
  })
  assert.equal(scope.ok, true, JSON.stringify(scope.foreign))
  assert.ok(scope.owned.includes('implementation.mjs'))
  assert.equal(scope.foreign.length, 0)
  const candidate = createCandidate({
    root, asset, actor: 'system:test', source: 'test',
    development: {
      enabled: true, branch: 'develop', remote: 'origin',
      requirement: { id: asset.id, title: asset.title, revision: 1, doc: asset.doc },
      // A literal test path used to be archived even though it never changed.
      paths: ['never-changed.test.mjs'],
      scope,
    },
  })
  assert.equal(candidate.development.pushedToRemoteDev, true, JSON.stringify(candidate.development))
  assert.equal(candidate.development.reason, null)
  assert.equal(candidate.development.requiresReverification, true)
  assert.equal(candidate.architecture.synced, true)
  assert.equal(candidate.architecture.changed, true)
  assert.equal(git(root, ['log', '-1', '--format=%s']), 'REQ-DEV-004: 真实改动自动归档')
  const committed = git(root, ['show', '--pretty=', '--name-only', 'HEAD'])
  assert.match(committed, /implementation\.mjs/)
  assert.match(committed, /REQ-DEV-004-design\.md/)
  assert.match(committed, /ARCHITECTURE-LEDGER\.md/)
  const ledger = readFileSync(join(root, 'requirements/architecture/REQ-DEV-004-design.md'), 'utf8')
  assert.match(ledger, /implementation\.mjs/)
  assert.doesNotMatch(ledger, /never-changed\.test\.mjs/)
})
