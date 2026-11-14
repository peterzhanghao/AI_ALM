import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import {
  RELEASE_SCHEMA,
  REQUIREMENT_RELEASE_SCHEMA,
  archiveRequirementRelease,
  authorizeRelease,
  createRelease,
  listReleases,
  planRelease,
  readRelease,
  recordReleaseExecution,
  releaseViewFor,
  syncRequirementReleaseToMain,
} from '../../src/requirements/release.mjs'

const LOCAL_HUMAN = { id: 'human:local', kind: 'human', source: 'local-session' }

function authorize(options) {
  const actor = options.actor ?? LOCAL_HUMAN.id
  const subject = options.subject === undefined ? { ...LOCAL_HUMAN, id: actor } : options.subject
  return authorizeRelease({ ...options, actor, subject })
}

function acceptedItem(id, overrides = {}) {
  const item = {
    id,
    title: `${id} title`,
    decision: {
      state: 'verified',
      humanAccepted: true,
      signoff: { actor: 'human:local', at: '2026-11-01T00:00:00.000Z' },
    },
    candidate: {
      exists: true,
      current: true,
      id: `CAND-${id}-001`,
      treeHash: 'tree-1',
      requirementHash: 'req-1',
      acceptance: { file: `.alm/acceptance/${id}/abc.json`, hash: 'acc-1', result: 'pass', finishedAt: '2026-11-01T00:00:00.000Z' },
    },
  }
  if (overrides.candidate) item.candidate = { ...item.candidate, ...overrides.candidate }
  if (overrides.decision) item.decision = { ...item.decision, ...overrides.decision }
  return item
}

const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()

test('planRelease refuses requirements without a human-accepted delivery', () => {
  const pending = { id: 'REQ-A', title: 'A', decision: { state: 'ready-for-human', humanAccepted: false }, candidate: { exists: true, current: true, id: 'C1', treeHash: 't' } }
  const plan = planRelease({ items: [pending, acceptedItem('REQ-B')], target: 'prod', version: 'v1' })
  assert.equal(plan.ok, false)
  assert.deepEqual(
    plan.blockers.map((blocker) => blocker.code),
    ['delivery-not-accepted'],
  )
  assert.equal(plan.contentHash, null)
})

test('planRelease blocks a stale candidate and stays stable for valid deliveries', () => {
  const stale = planRelease({ items: [acceptedItem('REQ-A', { candidate: { current: false, reasons: ['requirement-changed'] } })], target: 'prod' })
  assert.equal(stale.ok, false)
  assert.equal(stale.blockers[0].code, 'candidate-stale')

  const first = planRelease({ items: [acceptedItem('REQ-B'), acceptedItem('REQ-A')], target: 'prod', version: 'v1' })
  const second = planRelease({ items: [acceptedItem('REQ-A'), acceptedItem('REQ-B')], target: 'prod', version: 'v1' })
  assert.equal(first.ok, true)
  assert.equal(first.deliveries.length, 2)
  assert.equal(first.contentHash, second.contentHash, 'candidate order does not change the release hash')
  assert.equal(first.deliveries[0].humanSignoff.actor, 'human:local')
})

test('a release is created as a draft and only a human authorization moves it forward', () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-release-'))
  try {
    const items = [acceptedItem('REQ-A')]
    const created = createRelease({ root, items, requirementIds: ['REQ-A'], target: 'prod', version: 'v1' })
    assert.equal(created.schema, RELEASE_SCHEMA)
    assert.equal(created.status, 'draft')
    assert.equal(created.id, 'REL-001')
    assert.equal(created.deliveries.length, 1)
    assert.equal(created.authorization, null)

    const stored = readRelease(root, 'REL-001')
    assert.equal(stored.contentHash, created.contentHash)

    const authorized = authorize({ root, releaseId: 'REL-001', items, actor: 'human:local', apply: true })
    assert.equal(authorized.applied, true)
    assert.equal(authorized.release.status, 'authorized')
    assert.equal(authorized.release.authorization.actor, 'human:local')

    const released = recordReleaseExecution({ root, releaseId: 'REL-001', result: 'released', note: 'deployed', apply: true })
    assert.equal(released.release.status, 'released')
    assert.equal(released.release.executions.length, 1)
    assert.equal(listReleases(root).length, 1)
    assert.deepEqual(
      releaseViewFor({ root, requirementId: 'REQ-A' }),
      {
        exists: true,
        id: 'REL-001',
        status: 'released',
        label: '已发布',
        target: 'prod',
        version: 'v1',
        authorizedBy: 'human:local',
        authorizedAt: authorized.release.authorization.at,
        releasedAt: released.execution.at,
        github: null,
        githubVerified: false,
        candidateId: 'CAND-REQ-A-001',
        requirementRevision: null,
        requirementHash: 'req-1',
        treeHash: 'tree-1',
        lastReleased: {
          exists: true,
          id: 'REL-001',
          status: 'released',
          label: '已发布',
          target: 'prod',
          version: 'v1',
          authorizedBy: 'human:local',
          authorizedAt: authorized.release.authorization.at,
          releasedAt: released.execution.at,
          github: null,
          githubVerified: false,
          candidateId: 'CAND-REQ-A-001',
          requirementRevision: null,
          requirementHash: 'req-1',
          treeHash: 'tree-1',
        },
      },
    )
    assert.equal(releaseViewFor({ root, requirementId: 'REQ-B' }).exists, false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('newer drafts retain successful publication and legacy candidates supply revision read-only', () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-release-history-'))
  try {
    const items = [acceptedItem('REQ-A')]
    const first = createRelease({ root, items, requirementIds: ['REQ-A'], target: 'prod' })
    authorize({ root, releaseId: first.id, items, apply: true })
    recordReleaseExecution({ root, releaseId: first.id, result: 'released', apply: true })
    const dir = join(root, '.alm/candidates/REQ-A')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'CAND-REQ-A-001.json'), JSON.stringify({ schema: 'alm.candidate/v1', revision: 1, requirementHash: 'req-1' }))
    const next = acceptedItem('REQ-A', { candidate: { id: 'CAND-REQ-A-002' } })
    next.revision = 2
    createRelease({ root, items: [next], requirementIds: ['REQ-A'], target: 'prod' })
    const view = releaseViewFor({ root, requirementId: 'REQ-A' })
    assert.equal(view.status, 'draft')
    assert.equal(view.requirementRevision, 2)
    assert.equal(view.candidateId, 'CAND-REQ-A-002')
    assert.equal(view.lastReleased.status, 'released')
    assert.equal(view.lastReleased.requirementRevision, 1)
    assert.equal(view.lastReleased.candidateId, 'CAND-REQ-A-001')
    assert.equal(readRelease(root, first.id).deliveries[0].requirementRevision, null, 'legacy release is never rewritten by a read')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('release view exposes persisted main merge credentials from a release record', () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-release-source-control-'))
  try {
    mkdirSync(join(root, '.alm/releases'), { recursive: true })
    writeFileSync(join(root, '.alm/releases/REL-002.json'), JSON.stringify({
      schema: 'alm.release/v1', id: 'REL-002', status: 'released', deliveries: [{ requirement: 'REQ-A', candidateId: 'CAND-REQ-A-001' }],
      sourceControl: {
        devBranch: 'develop', devCommitSha: '1234567890abcdef', mainBranch: 'main',
        mainMergeCommitSha: 'abcdef0123456789', pushedToMain: true, pushedToMainAt: '2026-11-11T12:23:49.072Z',
      },
    }))
    const view = releaseViewFor({ root, requirementId: 'REQ-A' })
    assert.equal(view.mainMerged, true)
    assert.equal(view.sourceControl.devBranch, 'develop')
    assert.equal(view.sourceControl.mainMergeCommitSha, 'abcdef0123456789')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('release authorization requires a trusted host human and rejects body labels or automated subjects', () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-release-identity-'))
  try {
    const items = [acceptedItem('REQ-A')]
    const created = createRelease({ root, items, requirementIds: ['REQ-A'], target: 'prod' })
    for (const subject of [
      null,
      { id: 'test:runner', kind: 'human', source: 'host-authenticated' },
      { id: 'automation:ci', kind: 'human', source: 'host-authenticated' },
      { id: 'ai:agent', kind: 'human', source: 'host-authenticated' },
      { id: 'human:mallory', kind: 'human', source: 'request-body' },
    ]) {
      assert.throws(
        () => authorizeRelease({ root, releaseId: created.id, items, actor: subject?.id ?? 'human:mallory', subject, apply: true }),
        (error) => error.code === 'untrusted-subject' && error.status === 403,
      )
    }
    assert.equal(readRelease(root, created.id).status, 'draft')

    const allowed = authorizeRelease({
      root,
      releaseId: created.id,
      items,
      actor: 'human:alice',
      subject: { id: 'human:alice', kind: 'human', source: 'host-authenticated' },
      apply: true,
    })
    assert.equal(allowed.release.status, 'authorized')
    assert.deepEqual(allowed.release.authorization.subject, { id: 'human:alice', kind: 'human', source: 'host-authenticated' })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('authorization cannot be reused after the accepted candidate changes', () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-release-stale-'))
  try {
    const items = [acceptedItem('REQ-A')]
    const created = createRelease({ root, items, requirementIds: ['REQ-A'], target: 'prod' })
    const changed = [acceptedItem('REQ-A', { candidate: { id: 'CAND-REQ-A-002', treeHash: 'tree-2' } })]
    assert.throws(
      () => authorize({ root, releaseId: created.id, items: changed, apply: true }),
      (error) => error.code === 'release-stale' && error.blockers[0].code === 'release-candidate-changed',
    )
    assert.equal(readRelease(root, created.id).status, 'draft', 'a failed authorization writes nothing')
    assert.throws(
      () => recordReleaseExecution({ root, releaseId: created.id, result: 'released', apply: true }),
      (error) => error.code === 'release-not-authorized',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('executing an authorized release refuses a changed candidate instead of publishing unseen content', () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-release-exec-stale-'))
  try {
    const items = [acceptedItem('REQ-A')]
    const created = createRelease({ root, items, requirementIds: ['REQ-A'], target: 'prod' })
    authorize({ root, releaseId: created.id, items, actor: 'human:local', apply: true })
    const changed = [acceptedItem('REQ-A', { candidate: { id: 'CAND-REQ-A-002', treeHash: 'tree-2' } })]
    assert.throws(
      () => recordReleaseExecution({ root, releaseId: created.id, result: 'released', apply: true, items: changed }),
      (error) => error.code === 'release-candidate-changed' && /重新生成发布记录/.test(error.message),
    )
    assert.equal(readRelease(root, created.id).status, 'authorized', 'a refused execution writes nothing')
    assert.equal(readRelease(root, created.id).executions.length, 0)
    const same = recordReleaseExecution({ root, releaseId: created.id, result: 'released', apply: true, items })
    assert.equal(same.release.status, 'released')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a signed current delivery creates one immutable requirement release archive and rejects a changed candidate', () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-requirement-release-'))
  try {
    const item = {
      ...acceptedItem('REQ-A'),
      revision: 5,
      briefText: '# REQ-A 归档测试\n\n## 验收要求\n- AC-01 用户可以完成签收\n',
      specConvergences: [{ revision: 2, at: '2026-11-02T00:00:00.000Z', summary: '补充验收规则' }],
      humanAcceptance: { signoff: { actor: 'human:local', at: '2026-11-03T00:00:00.000Z' } },
    }
    const result = archiveRequirementRelease({ root, item, actor: LOCAL_HUMAN.id, subject: LOCAL_HUMAN, apply: true })
    assert.equal(result.schema, REQUIREMENT_RELEASE_SCHEMA)
    assert.equal(result.release.status, 'released')
    assert.equal(result.archive.record.requirement.revision, 5)
    assert.match(result.archive.path, /\.alm\/releases\/REQ-A-release\.json$/)
    assert.equal(result.archive.record.acceptanceCriteria[0].id, 'AC-01')
    assert.ok(result.archive.record.archiveHash)
    assert.equal(releaseViewFor({ root, requirementId: 'REQ-A' }).status, 'released')

    const changed = { ...item, candidate: { ...item.candidate, current: false, reasons: ['worktree-changed'] } }
    assert.throws(
      () => archiveRequirementRelease({ root, item: changed, actor: LOCAL_HUMAN.id, subject: LOCAL_HUMAN, apply: true }),
      (error) => error.code === 'release-blocked',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('release sync merges pushed develop into origin/main and records real merge credentials', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'alm-release-git-'))
  const remote = `${root}-origin.git`
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(remote, { recursive: true, force: true }) })
  execFileSync('git', ['init', '--bare', '-q', remote])
  git(root, ['init', '-q'])
  git(root, ['config', 'user.name', 'ALM Test'])
  git(root, ['config', 'user.email', 'alm-test@example.test'])
  git(root, ['checkout', '-qb', 'main'])
  git(root, ['remote', 'add', 'origin', remote])
  mkdirSync(join(root, '.alm/releases'), { recursive: true })
  writeFileSync(join(root, 'package.json'), '{"type":"module"}\n')
  writeFileSync(join(root, '.alm/releases/REL-001.json'), JSON.stringify({ schema: 'alm.release/v1', id: 'REL-001', status: 'released', deliveries: [] }))
  writeFileSync(join(root, '.alm/releases/REQ-GIT-release.json'), JSON.stringify({ schema: 'alm.requirement-release/v1', id: 'REQ-GIT-release', releaseId: 'REL-001', requirement: { id: 'REQ-GIT', revision: 5 } }))
  git(root, ['add', '.']); git(root, ['commit', '-qm', 'base release archive']); git(root, ['push', '-u', 'origin', 'main'])
  git(root, ['checkout', '-qb', 'develop']); writeFileSync(join(root, 'delivery.mjs'), 'export const delivered = true\n')
  git(root, ['add', '.']); git(root, ['commit', '-qm', 'feat delivery']); git(root, ['push', '-u', 'origin', 'develop'])
  mkdirSync(join(root, '.alm/runs'), { recursive: true }); writeFileSync(join(root, '.alm/runs/RUN-1.json'), '{}')
  mkdirSync(join(root, 'artifacts'), { recursive: true }); writeFileSync(join(root, 'artifacts/debug.json'), '{}')
  mkdirSync(join(root, 'validation'), { recursive: true }); writeFileSync(join(root, 'validation/README.md'), 'local only')

  const result = syncRequirementReleaseToMain({ root, requirementId: 'REQ-GIT', releaseId: 'REL-001', revision: 5, apply: true })
  assert.equal(result.applied, true, JSON.stringify(result.sourceControl))
  assert.equal(result.sourceControl.pushedToMain, true)
  assert.match(result.sourceControl.mainMergeCommitSha, /^[a-f0-9]{40}$/)
  assert.equal(git(root, ['rev-parse', 'refs/remotes/origin/main']), result.sourceControl.mainMergeCommitSha)
  assert.equal(git(root, ['merge-base', '--is-ancestor', 'develop', 'origin/main']), '')
  const archive = JSON.parse(readFileSync(join(root, '.alm/releases/REQ-GIT-release.json'), 'utf8'))
  assert.equal(archive.sourceControl.mainMergeCommitSha, result.sourceControl.mainMergeCommitSha)
  assert.equal(archive.sourceControl.devBranch, 'develop')
})
