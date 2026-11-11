import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCandidate } from '../../src/requirements/candidate.mjs'

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
  assert.match(git(root, ['log', '-1', '--format=%s']), /feat\(REQ-DEV-001\): 同步需求开发分支 \[v5 \/ CAND-REQ-DEV-001-001\]/)
  assert.equal(git(root, ['rev-parse', 'refs/remotes/origin/develop']), candidate.development.devCommitSha)
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
