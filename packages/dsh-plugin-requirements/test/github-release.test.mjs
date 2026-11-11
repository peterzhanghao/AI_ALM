import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspectGithubRelease, publishGithubRelease } from '../github-release.mjs'
import { readRelease, recordReleaseExecution } from '../../alm-core/src/requirements/release.mjs'

const subject = { kind: 'human', id: 'human:tester', source: 'host-authenticated' }
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'alm-github-release-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git('init', '-b', 'develop')
  writeFileSync(join(root, 'source.js'), 'module.exports=42\n')
  git('add', '.'); git('commit', '-qm', 'feat: test delivery')
  const head = git('rev-parse', 'HEAD'), merged = 'b'.repeat(40)
  git('remote', 'add', 'origin', 'https://github.com/test/repo.git')
  mkdirSync(join(root, '.alm'))
  writeFileSync(join(root, '.alm/project.json'), JSON.stringify({ schema: 'alm.project/v1', id: 'TEST', name: 'Fixture', requirementRoot: 'requirements', defaultBranch: 'main', github: { owner: 'test', repo: 'repo' } }))
  const items = [{ id: 'REQ-TEST-001', title: 'Answer', revision: 1, decision: { state: 'verified', humanAccepted: true }, humanAcceptance: { signoff: { actor: subject.id, at: '2026-11-05T01:00:00Z' } }, candidate: { exists: true, current: true, id: 'CAND-1', treeHash: 'tree', requirementHash: 'requirement', headSha: head } }]
  const calls = []
  const remote = { pr: null, protection: true, failMergeRead: false, head, checks: true }
  const newPr = () => ({ number: 7, url: 'https://github.com/test/repo/pull/7', state: 'OPEN', headRefName: 'develop', baseRefName: 'main', headRefOid: head, isDraft: false, reviewDecision: 'APPROVED', mergeable: 'MERGEABLE', statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }] })
  const run = async (command, args) => {
    calls.push([command, ...args])
    if (command === 'git') return git(...args)
    if (args[0] === 'repo') return JSON.stringify({ defaultBranchRef: { name: 'main' } })
    if (args[0] === 'api') {
      if (args[1].includes('/git/ref/')) return JSON.stringify({ object: { sha: remote.head } })
      if (args[1].endsWith('/protection')) {
        if (!remote.protection) throw new Error('404')
        return JSON.stringify({ required_pull_request_reviews: { required_approving_review_count: 1 }, required_status_checks: { contexts: ['alm-core'] } })
      }
      if (args[1].includes('/compare/')) return JSON.stringify({ status: 'ahead' })
    }
    if (args[1] === 'list') return JSON.stringify(remote.pr ? [remote.pr] : [])
    if (args[1] === 'create') {
      const body = readFileSync(args[args.indexOf('--body-file') + 1], 'utf8')
      assert.match(body, /REQ-TEST-001/); assert.match(body, new RegExp(head))
      remote.pr = newPr(); return remote.pr.url
    }
    if (args[1] === 'merge') { assert.equal(args[args.indexOf('--match-head-commit') + 1], head); assert.ok(!args.includes('--admin')); remote.pr = { ...remote.pr, state: 'MERGED', mergedAt: '2026-11-05T02:00:00Z', mergeCommit: { oid: merged } }; return '' }
    if (args[1] === 'view') { if (remote.failMergeRead) throw new Error('network lost'); return JSON.stringify(remote.pr) }
    assert.fail('Unexpected remote command: ' + args.join(' '))
  }
  return { root, items, requirementIds: [items[0].id], subject, run, remote, calls, git, head, newPr }
}

test('release PR prepare, retry, protected merge and readback bind the exact accepted commit', async t => {
  const f = fixture(t)
  const first = await publishGithubRelease({ ...f, mode: 'prepare' })
  const releaseId = first.release.id
  assert.equal(first.release.status, 'authorized')
  assert.equal(first.release.deliveries[0].humanSignoff.actor, subject.id)
  await publishGithubRelease({ ...f, mode: 'prepare', releaseId })
  assert.equal(f.calls.filter(c => c[1] === 'pr' && c[2] === 'create').length, 1)
  const result = await publishGithubRelease({ ...f, mode: 'merge', releaseId })
  assert.equal(result.release.status, 'released')
  assert.equal(result.release.github.verified, true)
  assert.equal(result.release.github.head, f.head)
  assert.equal(result.release.executions[0].actor, subject.id)
})

test('dirty source, remote mismatch and wrong branch cannot create a release or PR', async t => {
  for (const gate of ['dirty', 'remote', 'branch', 'unpushed', 'unaccepted']) {
    const f = fixture(t)
    if (gate === 'dirty') writeFileSync(join(f.root, 'source.js'), 'module.exports=43\n')
    if (gate === 'remote') f.git('remote', 'set-url', 'origin', 'https://github.com/test/other.git')
    if (gate === 'branch') f.git('switch', '-c', 'feature/isolated')
    if (gate === 'unpushed') f.remote.head = 'c'.repeat(40)
    if (gate === 'unaccepted') f.items[0].decision.humanAccepted = false
    await assert.rejects(publishGithubRelease({ ...f, mode: 'prepare' }), { code: 'github-release-blocked' })
    assert.equal(readRelease(f.root, 'REL-001'), null)
    assert.equal(f.calls.filter(c => c[1] === 'pr' && ['create', 'merge'].includes(c[2])).length, 0)
  }
})

test('missing protection, review, CI, conflict or changed head blocks merge without pretending success', async t => {
  for (const gate of ['protection', 'review', 'checks', 'conflict', 'head']) {
    const f = fixture(t)
    const prepared = await publishGithubRelease({ ...f, mode: 'prepare' })
    if (gate === 'protection') f.remote.protection = false
    if (gate === 'review') f.remote.pr.reviewDecision = 'REVIEW_REQUIRED'
    if (gate === 'checks') f.remote.pr.statusCheckRollup = []
    if (gate === 'conflict') f.remote.pr.mergeable = 'CONFLICTING'
    if (gate === 'head') f.remote.head = 'c'.repeat(40)
    await assert.rejects(publishGithubRelease({ ...f, releaseId: prepared.release.id, mode: 'merge' }))
    assert.equal(readRelease(f.root, prepared.release.id).status, 'authorized')
    assert.equal(f.calls.filter(c => c[1] === 'pr' && c[2] === 'merge').length, 0)
  }
})

test('lost merge readback preserves authorization and retry confirms the existing merge', async t => {
  const f = fixture(t)
  const prepared = await publishGithubRelease({ ...f, mode: 'prepare' })
  f.remote.failMergeRead = true
  await assert.rejects(publishGithubRelease({ ...f, releaseId: prepared.release.id, mode: 'merge' }))
  assert.equal(readRelease(f.root, prepared.release.id).status, 'authorized')
  f.remote.failMergeRead = false
  const result = await publishGithubRelease({ ...f, releaseId: prepared.release.id, mode: 'merge' })
  assert.equal(result.release.status, 'released')
  assert.equal(f.calls.filter(c => c[1] === 'pr' && c[2] === 'merge').length, 1)
})

test('legacy manual release success cannot bypass linked GitHub merge verification', async t => {
  const f = fixture(t)
  const prepared = await publishGithubRelease({ ...f, mode: 'prepare' })
  assert.throws(() => recordReleaseExecution({ root: f.root, releaseId: prepared.release.id, result: 'released', apply: true, items: f.items }), { code: 'github-merge-required' })
  assert.equal(readRelease(f.root, prepared.release.id).status, 'authorized')
  await assert.rejects(publishGithubRelease({ ...f, subject: { kind: 'agent', id: 'human:fake' }, mode: 'merge' }))
})

test('source changed while awaiting network cannot record a successful release', async t => {
  const f = fixture(t)
  const prepared = await publishGithubRelease({ ...f, mode: 'prepare' })
  await assert.rejects(publishGithubRelease({ ...f, releaseId: prepared.release.id, mode: 'merge', loadItems: () => { writeFileSync(join(f.root, 'source.js'), 'changed during merge'); return f.items } }))
  assert.equal(readRelease(f.root, prepared.release.id).status, 'authorized')
})
