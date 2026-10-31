import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { nextActionFor, requirements, requirementsAll, resolveRequirementsRoot, versionSnapshot } from '../query.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const fixture = join(repoRoot, 'fixtures/order-refund')

test('nextActionFor maps the evidence decision state to one action', () => {
  assert.equal(nextActionFor({ decision: { state: 'blocked' } }, []), 'fix-blockers')
  assert.equal(nextActionFor({ decision: { state: 'needs-clarification' } }, []), 'fix-anomaly')
  assert.equal(nextActionFor({ decision: { state: 'stale' } }, []), 'rerun-evidence')
  assert.equal(nextActionFor({ decision: { state: 'failed' } }, []), 'run-acceptance')
  assert.equal(nextActionFor({ decision: { state: 'ready-for-human' } }, []), 'signoff')
  assert.equal(nextActionFor({ decision: { state: 'verified' } }, []), 'done')
  assert.equal(
    nextActionFor({ decision: { state: 'unchecked', topGap: { code: 'review-not-run' } } }, []),
    'run-review',
  )
  assert.equal(
    nextActionFor({ decision: { state: 'unchecked', topGap: { code: 'coverage-incomplete' } } }, []),
    'run-review',
  )
  assert.equal(
    nextActionFor({ decision: { state: 'unchecked', topGap: { code: 'acceptance-not-run' } } }, []),
    'run-acceptance',
  )
  assert.equal(
    nextActionFor({ decision: { state: 'unchecked', topGap: { code: 'acceptance-missing' } } }, []),
    'run-acceptance',
  )
  // A missing decision still yields a review action instead of throwing.
  assert.equal(nextActionFor({}, []), 'run-review')
})

test('resolveRequirementsRoot accepts a relative fixture path and rejects traversal', () => {
  const resolved = resolveRequirementsRoot('fixtures/order-refund', fixture)
  assert.equal(resolved, fixture)
  assert.throws(() => resolveRequirementsRoot('../etc', fixture), (error) => error.status === 400 && error.code === 'invalid-root')
  assert.throws(() => resolveRequirementsRoot('no/such/dir', fixture), (error) => error.status === 404 && error.code === 'root-not-found')
  assert.equal(resolveRequirementsRoot(undefined, fixture), fixture)
})

test('requirements payload carries file, links and the next action', () => {
  const payload = requirements(fixture)
  assert.equal(payload.schema, 'alm.requirements/v1')
  assert.equal(payload.project, 'PAY')
  assert.equal(payload.projectName, '支付平台')
  const item = payload.requirements.find((entry) => entry.id === 'REQ-PAY-001')
  assert.ok(item, 'REQ-PAY-001 missing from the fixture payload')
  assert.equal(item.file, 'requirements/refund.sdoc')
  assert.ok(item.line >= 1)
  assert.deepEqual(item.verifiedBy, ['TEST-PAY-001'])
  assert.ok(item.links.some((link) => link.type === 'verified_by' && link.target === 'TEST-PAY-001'))
  // No stored review yet, so the decision asks for a review before a change.
  assert.equal(item.nextAction, 'run-review')
  assert.equal(item.nextActionLabel, '运行评审')
  assert.equal(item.occurrenceKey, `REQ-PAY-001@${item.file}:${item.line}`)
  assert.equal(item.businessId, null)
  assert.equal(item.decision.state, 'unchecked')
  assert.match(item.decision.topGap.code, /review/)
  assert.equal(item.decision.tone, 'neutral')
  assert.deepEqual(item.anomalies, [])
  assert.equal(item.review.coverage.total, 5)
  assert.deepEqual(item.review.coverage.missing, [])
  assert.equal(payload.anomalySummary.count, 0)
  assert.deepEqual(payload.anomalies, [])
})

test('requirements payload carries project, brief text and attachment detail', () => {
  const payload = requirements(fixture)
  const item = payload.requirements.find((entry) => entry.id === 'REQ-PAY-004')
  assert.ok(item)
  assert.equal(item.project, 'PAY')
  assert.equal(item.projectName, '支付平台')
  assert.match(item.briefText, /幂等/)
  assert.equal(item.attachments, 1)
  assert.deepEqual(item.attachmentFiles, [{ name: 'chat-2026-10-29.md', kind: 'chat' }])
  assert.deepEqual(payload.projectInfo, {
    id: 'PAY',
    name: '支付平台',
    repo: 'peterzhanghao/AI_ALM',
    board: 1,
    status: { ready: 'Ready' },
  })
  assert.equal(item.github, null)
})

test('github mapping projects the issue, labels, board and parented task issues', () => {
  const dir = mkdtempSync(join(tmpdir(), 'alm-gh-'))
  try {
    cpSync(fixture, dir, { recursive: true })
    writeFileSync(
      join(dir, '.alm/github.json'),
      JSON.stringify(
        {
          schema: 'alm.github/v1',
          repo: 'peterzhanghao/AI_ALM',
          requirements: {
            'REQ-PAY-004': {
              provider: 'github',
              number: 104,
              url: 'https://github.com/peterzhanghao/AI_ALM/issues/104',
            },
          },
          tasks: {
            'TASK-001': { provider: 'github', number: 105, url: 'https://github.com/peterzhanghao/AI_ALM/issues/105', parent: 104 },
            'TASK-002': { provider: 'github', number: 106, url: 'https://github.com/peterzhanghao/AI_ALM/issues/106', parent: 999 },
          },
        },
        null,
        2,
      ),
    )
    const payload = requirements(dir)
    const item = payload.requirements.find((entry) => entry.id === 'REQ-PAY-004')
    assert.equal(item.github.issue, 104)
    assert.equal(item.github.repo, 'peterzhanghao/AI_ALM')
    assert.deepEqual(item.github.labels, ['type::requirement', 'project::pay', 'priority::P1'])
    assert.deepEqual(item.github.board, { number: 1, status: 'Ready' })
    assert.deepEqual(item.github.tasks.map((task) => task.number), [105])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('requirementsAll merges project roots and tags each requirement', () => {
  const payload = requirementsAll([{ id: 'PAY', name: '支付平台', root: fixture }])
  assert.equal(payload.scope, 'all')
  assert.equal(payload.result, 'pass')
  assert.equal(payload.summary.projects, 1)
  assert.ok(payload.requirements.length >= 2)
  assert.ok(payload.requirements.every((entry) => entry.project === 'PAY'))
  assert.equal(payload.projects[0].project, 'PAY')
  assert.ok(payload.projects[0].requirements >= 1)
})

test('requirementsAll reports a broken project without dropping the others', () => {
  const payload = requirementsAll([
    { id: 'PAY', name: '支付平台', root: fixture },
    { id: 'CRM', name: '客户 CRM', root: join(fixture, 'no-such-root') },
  ])
  assert.equal(payload.result, 'fail')
  assert.equal(payload.summary.failed, 1)
  assert.ok(payload.requirements.length >= 2)
  assert.ok(payload.projects.some((project) => project.project === 'CRM' && project.error))
})

test('review derives role verdicts from the real gate report', () => {
  const payload = requirements(fixture)
  const item = payload.requirements.find((entry) => entry.id === 'REQ-PAY-001')
  assert.equal(item.review.schema, 'alm.review/v1')
  assert.equal(item.review.source, 'gates')
  assert.equal(item.review.roles.length, 5)
  assert.equal(item.review.summary.total, 5)
  assert.equal(item.review.summary.blockers, 0)
  assert.ok(item.review.roles.every((role) => ['pass', 'skip'].includes(role.verdict)))
  assert.equal(item.review.signoff, null)
  assert.deepEqual(item.review.coverage, { completed: 5, total: 5, missing: [] })
  assert.equal(item.review.evidenceBound, false)
})

test('review blocks the testing role when acceptance is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'alm-review-'))
  try {
    cpSync(fixture, dir, { recursive: true })
    const file = join(dir, 'requirements/refund.sdoc')
    const source = readFileSync(file, 'utf8').replace(
      /\[RELATION\]\nType: verified_by\nValue: TEST-PAY-001\n/,
      '',
    )
    writeFileSync(file, source)
    const payload = requirements(dir)
    const item = payload.requirements.find((entry) => entry.id === 'REQ-PAY-001')
    const testing = item.review.roles.find((role) => role.id === 'testing')
    assert.equal(testing.verdict, 'block')
    assert.ok(testing.findings.some((finding) => finding.rule === 'COV-001' && /verified_by/.test(finding.message)))
    assert.equal(item.review.summary.blockers, 1)
    assert.equal(item.review.summary.ready, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('version history and snapshot are read from git', () => {
  const payload = requirements(fixture)
  const item = payload.requirements.find((entry) => entry.id === 'REQ-PAY-001')
  assert.ok(item.versions.length >= 1, 'fixture file should have git history')
  const first = item.versions[0]
  assert.match(first.sha, /^[0-9a-f]{40}$/)
  assert.match(first.short, /^[0-9a-f]{7,}$/)
  assert.ok(first.date && first.subject)
  const snapshot = versionSnapshot({ root: fixture, assetId: 'REQ-PAY-001', sha: first.sha })
  assert.equal(snapshot.schema, 'alm.version/v1')
  assert.equal(snapshot.asset, 'REQ-PAY-001')
  assert.match(snapshot.content, /REQ-PAY-001/)
  assert.throws(
    () => versionSnapshot({ root: fixture, assetId: 'REQ-PAY-001', sha: 'not-a-sha' }),
    (error) => error.status === 400 && error.code === 'invalid-sha',
  )
  assert.throws(
    () => versionSnapshot({ root: fixture, assetId: 'REQ-NOPE', sha: first.sha }),
    (error) => error.status === 404 && error.code === 'asset-not-found',
  )
})

test('trace graph exposes direct nodes, edges and impact stats', () => {
  const payload = requirements(fixture)
  const item = payload.requirements.find((entry) => entry.id === 'REQ-PAY-004')
  assert.equal(item.trace.schema, 'alm.trace/v1')
  const ids = item.trace.nodes.map((node) => node.id)
  assert.deepEqual(ids.sort(), [
    'ADR-PAY-003',
    'MOD-PAY-REFUND',
    'REQ-PAY-001',
    'REQ-PAY-004',
    'TEST-PAY-004',
    'TEST-PAY-005',
  ])
  assert.equal(item.trace.nodes.filter((node) => node.current).length, 1)
  assert.equal(item.trace.stats.parent, 1)
  assert.equal(item.trace.stats.children, 0)
  assert.equal(item.trace.stats.tests, 2)
  assert.equal(item.trace.stats.impacted, 1)
  assert.equal(item.trace.edges.length, 5)
  const parentEdge = item.trace.edges.find((edge) => edge.from === 'REQ-PAY-001' && edge.to === 'REQ-PAY-004')
  assert.equal(parentEdge.type, 'parent_of')
})

test('trace keeps a dangling target as a missing node', () => {
  const dir = mkdtempSync(join(tmpdir(), 'alm-trace-'))
  try {
    cpSync(fixture, dir, { recursive: true })
    const file = join(dir, 'requirements/refund.sdoc')
    writeFileSync(
      file,
      `${readFileSync(file, 'utf8')}\n[RELATION]\nType: allocated_to\nValue: MOD-NOPE\n`,
    )
    const payload = requirements(dir)
    const item = payload.requirements.find((entry) => entry.id === 'REQ-PAY-001')
    const missing = item.trace.nodes.find((node) => node.id === 'MOD-NOPE')
    assert.ok(missing, 'dangling target should still appear in the trace')
    assert.equal(missing.type, 'missing')
    assert.equal(missing.title, null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('requirements payload exposes acceptance registration and latest evidence', () => {
  const clean = requirements(fixture).requirements.find((entry) => entry.id === 'REQ-PAY-001')
  assert.equal(clean.acceptance.schema, 'alm.acceptance.summary/v2')
  assert.equal(clean.acceptance.registered, false)
  assert.equal(clean.acceptance.latest, null)

  const dir = mkdtempSync(join(tmpdir(), 'alm-acceptance-query-'))
  try {
    cpSync(fixture, dir, { recursive: true })
    execFileSync('git', ['init', '-q'], { cwd: dir })
    execFileSync('git', ['add', '-A'], { cwd: dir })
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init'], { cwd: dir })
    mkdirSync(join(dir, '.alm/acceptance'), { recursive: true })
    writeFileSync(
      join(dir, '.alm/acceptance/REQ-PAY-001.json'),
      JSON.stringify({
        schema: 'alm.acceptance.config/v1',
        requirement: 'REQ-PAY-001',
        commands: [{ id: 'smoke', command: ['node', '-e', 'process.exit(0)'] }],
      }),
    )
    const head = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    mkdirSync(join(dir, '.alm/acceptance/REQ-PAY-001'), { recursive: true })
    writeFileSync(
      join(dir, '.alm/acceptance/REQ-PAY-001', `${head}.json`),
      JSON.stringify({
        schema: 'alm.acceptance/v1',
        requirement: 'REQ-PAY-001',
        headSha: head,
        result: 'pass',
        finishedAt: '2026-10-31T00:00:00.000Z',
        commands: [{ id: 'smoke', exitCode: 0 }],
      }),
    )
    const item = requirements(dir).requirements.find((entry) => entry.id === 'REQ-PAY-001')
    assert.equal(item.acceptance.registered, true)
    assert.equal(item.acceptance.commandCount, 1)
    assert.equal(item.acceptance.latest.result, 'pass')
    // Legacy v1 evidence stays readable but is not complete/current evidence.
    assert.equal(item.acceptance.latest.complete, false)
    assert.equal(item.acceptance.latest.current, false)
    assert.equal(item.acceptance.latest.staleReason, 'incomplete')
    assert.ok(item.acceptance.latest.missing.includes('requirementHash'))
    assert.equal(item.decision.state, 'stale')
    assert.equal(item.nextAction, 'rerun-evidence')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
