import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { applyDeliveryShim, nextActionFor, requirements, requirementsAll, resolveRequirementsRoot, versionSnapshot, versionHistoryPage } from '../query.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const fixture = join(repoRoot, 'fixtures/order-refund')

test('mine and current matter share one projection across project and aggregate payloads', () => {
  const project = requirements(fixture)
  for (const item of project.requirements) {
    assert.deepEqual(item.currentMatter, item.detailView.currentMatter)
    assert.equal(item.mine, item.currentMatter.requiresHuman)
    assert.equal(item.requiresHuman, item.mine)
  }
  assert.equal(project.summary.mine, project.requirements.filter((item) => item.mine).length)
  const all = requirementsAll([{ id: 'fixture', root: fixture, name: 'fixture' }])
  assert.equal(all.summary.mine, all.requirements.filter((item) => item.mine).length)
})

test('nextActionFor maps the evidence decision state to one action', () => {
  assert.equal(nextActionFor({ decision: { state: 'blocked' } }, []), 'fix-blockers')
  assert.equal(nextActionFor({ decision: { state: 'needs-clarification' } }, []), 'fix-anomaly')
  assert.equal(nextActionFor({ decision: { state: 'stale' } }, []), 'rerun-evidence')
  assert.equal(nextActionFor({ decision: { state: 'failed' } }, []), 'run-acceptance')
  assert.equal(nextActionFor({ decision: { state: 'ready-for-human' } }, []), 'signoff')
  assert.equal(nextActionFor({ decision: { state: 'verified' } }, []), 'done')
  assert.equal(
    nextActionFor({ decision: { state: 'unchecked', topGap: { code: 'review-not-run' } } }, []),
    'run-acceptance',
  )
  assert.equal(
    nextActionFor({ decision: { state: 'unchecked', topGap: { code: 'coverage-incomplete' } } }, []),
    'run-acceptance',
  )
  assert.equal(
    nextActionFor({ decision: { state: 'unchecked', topGap: { code: 'acceptance-not-run' } } }, []),
    'run-acceptance',
  )
  assert.equal(
    nextActionFor({ decision: { state: 'unchecked', topGap: { code: 'acceptance-missing' } } }, []),
    'run-acceptance',
  )
  // A missing decision still yields the executable evidence action instead of throwing.
  assert.equal(nextActionFor({}, []), 'run-acceptance')
})

test('a defect under verification asks the human to run acceptance first', () => {
  const item = {
    id: 'REQ-DEF-002',
    decision: { state: 'unchecked', topGap: { code: 'review-not-run' } },
    defect: { exists: true, status: 'verifying', defect: { requirement: 'REQ-DEF-002' } },
  }
  assert.equal(nextActionFor(item, []), 'run-acceptance')
  // The source requirement of a defect keeps its own next action.
  const source = { ...item, id: 'REQ-DEF-001' }
  assert.equal(nextActionFor(source, []), 'run-acceptance')
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
  // Optional review never blocks the normal flow; the next action is executable acceptance evidence.
  assert.equal(item.nextAction, 'run-acceptance')
  assert.equal(item.nextActionLabel, '运行验收')
  assert.equal(item.occurrenceKey, `REQ-PAY-001@${item.file}:${item.line}`)
  assert.equal(item.businessId, null)
  assert.equal(item.decision.state, 'unchecked')
  assert.match(item.decision.topGap.code, /acceptance/)
  assert.equal(item.decision.tone, 'neutral')
  assert.deepEqual(item.anomalies, [])
  assert.equal('review' in item, false)
  assert.equal(item.humanAcceptance.signoff, null)
  assert.equal(item.humanAcceptance.signoffValid, false)
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

test('requirements expose independent human acceptance without five-perspective review projection', () => {
  const payload = requirements(fixture)
  const item = payload.requirements.find((entry) => entry.id === 'REQ-PAY-001')
  assert.equal('review' in item, false)
  assert.equal(item.humanAcceptance.schema, 'alm.requirement-signoff-view/v1')
  assert.equal(item.humanAcceptance.requirement, 'REQ-PAY-001')
  assert.equal(item.humanAcceptance.signoff, null)
  assert.equal(item.humanAcceptance.signoffValid, false)
  assert.equal(item.humanAcceptance.evidenceBound, false)
})

test('query projects a stored human signoff into the timeline with its current validity', () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-query-signoff-'))
  try {
    cpSync(fixture, root, { recursive: true })
    const dir = join(root, '.alm', 'signoffs')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'REQ-PAY-001.json'), JSON.stringify({
      schema: 'alm.requirement-signoff/v1', requirement: 'REQ-PAY-001',
      signoffs: [
        { actor: 'human:test', decision: 'approve', at: '2026-01-09T00:00:00Z', candidateId: 'CAND-000', contentHash: 'older' },
        { actor: 'human:test', decision: 'approve', at: '2026-01-10T00:00:00Z', candidateId: 'CAND-001', contentHash: 'old' },
        { actor: 'ai:test', decision: 'approve', at: '2026-01-11T00:00:00Z', candidateId: 'CAND-002' },
      ],
    }))
    const item = requirements(root).requirements.find(entry => entry.id === 'REQ-PAY-001')
    assert.equal(item.humanAcceptance.signoffValid, false)
    assert.equal(item.humanAcceptance.signoffs.length, 2)
    assert.equal(item.detailView.record.timeline.filter(entry => entry.kind === 'human-signoff').length, 2)
    const events = item.detailView.record.timeline.filter(entry => entry.kind === 'human-signoff')
    assert.deepEqual(events.map(entry => entry.detail), ['CAND-000 · 当前已失效', 'CAND-001 · 当前已失效'])
    assert.equal(item.humanAcceptance.signoff.candidateId, 'CAND-001')
    assert.notEqual(item.decision.state, 'verified')
  } finally { rmSync(root, { recursive: true, force: true }) }
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

test('version history pages remain pinned when new commits arrive', () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-history-'))
  try {
    cpSync(fixture, root, { recursive: true })
    const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' })
    git('init', '-q')
    const file = join(root, 'requirements', 'refund.sdoc')
    const original = readFileSync(file, 'utf8')
    for (let i = 0; i < 22; i++) {
      writeFileSync(file, original + '\n'.repeat(i + 1))
      git('add', '.')
      git('-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-qm', `version ${i}`)
    }
    const first = versionHistoryPage({ root, assetId: 'REQ-PAY-001' })
    assert.equal(first.versions.length, 20)
    assert.equal(first.next, 20)
    writeFileSync(file, original + '\n'.repeat(23))
    git('add', '.')
    git('-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'new version')
    const second = versionHistoryPage({ root, assetId: 'REQ-PAY-001', head: first.head, offset: first.next })
    assert.equal(second.versions.length, 2)
    assert.equal(second.next, null)
    assert.equal(new Set([...first.versions, ...second.versions].map(entry => entry.sha)).size, 22)
    assert.throws(() => versionHistoryPage({ root, assetId: 'REQ-PAY-001', offset: 20 }), { code: 'invalid-head' })
    assert.throws(() => versionHistoryPage({ root, assetId: 'REQ-MISSING' }), { code: 'asset-not-found' })
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('snapshots follow committed renames to the path at the selected commit', () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-renamed-history-'))
  try {
    cpSync(fixture, root, { recursive: true })
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
    git('init', '-q')
    git('add', '.')
    git('-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'before rename')
    const before = git('rev-parse', 'HEAD')
    git('mv', 'requirements/refund.sdoc', 'requirements/refund renamed.sdoc')
    git('-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'rename')
    const page = versionHistoryPage({ root, assetId: 'REQ-PAY-001' })
    assert.equal(page.versions.length, 2)
    const snapshot = versionSnapshot({ root, assetId: 'REQ-PAY-001', sha: before })
    assert.equal(snapshot.path, 'requirements/refund.sdoc')
    assert.match(snapshot.content, /REQ-PAY-001/)
  } finally { rmSync(root, { recursive: true, force: true }) }
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
  assert.equal(clean.acceptance.schema, 'alm.acceptance.summary/v3')
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
    assert.equal(item.acceptance.latest.staleReason, 'worktree-unbound')
    assert.ok(item.acceptance.latest.missing.includes('requirementHash'))
    assert.equal(item.decision.state, 'stale')
    const event = item.detailView.record.timeline.find(entry => entry.kind === 'acceptance')
    assert.equal(event.title, '执行技术检查')
    assert.equal(event.detail, '历史通过，当前已过期')
    assert.notEqual(item.detailView.primaryAction?.id, 'create-candidate')
    assert.equal(item.nextAction, 'rerun-evidence')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('anomalies are scoped to the project requirement root so counts match the list', () => {
  const dir = mkdtempSync(join(tmpdir(), 'alm-anomaly-scope-'))
  try {
    cpSync(fixture, dir, { recursive: true })
    // A negative fixture outside `requirements/` duplicates a UID on purpose.
    const negative = join(repoRoot, 'fixtures/negative/duplicate-id')
    mkdirSync(join(dir, 'fixtures/negative/duplicate-id'), { recursive: true })
    for (const name of ['req-a.yml', 'req-b.yml']) {
      cpSync(join(negative, name), join(dir, 'fixtures/negative/duplicate-id', name))
    }

    const hidden = requirements(dir)
    assert.deepEqual(
      hidden.requirements.map((entry) => entry.id).filter((id) => id === 'REQ-DUP-001'),
      [],
      'fixture records are not listed',
    )
    assert.deepEqual(hidden.anomalies, [], 'anomalies must not describe records the list hides')
    assert.equal(hidden.anomalySummary.count, 0)
    assert.equal(hidden.summary.anomalies, 0)

    // A duplicate inside the requirement root is still a real anomaly, and its
    // occurrences map one-to-one onto listed records.
    cpSync(join(dir, 'requirements/refund.sdoc'), join(dir, 'requirements/refund-copy.sdoc'))
    const visible = requirements(dir)
    assert.equal(visible.anomalySummary.duplicateId, 1)
    assert.equal(visible.summary.anomalies, 1)
    const anomaly = visible.anomalies.find((entry) => entry.kind === 'duplicate-id')
    assert.ok(anomaly)
    assert.equal(anomaly.occurrences.length, 2)
    const listed = new Set(visible.requirements.filter((entry) => entry.id === 'REQ-PAY-001').map((entry) => entry.occurrenceKey))
    assert.equal(listed.size, 2)
    for (const occurrence of anomaly.occurrences) {
      assert.ok(listed.has(occurrence.occurrenceKey), 'every counted occurrence is a listed record')
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a run that stopped or is waiting asks for the honest action', () => {
  const base = { id: 'REQ-X', delivery: { key: 'in-progress' } }
  // A stopped heartbeat is not progress: offer resuming instead of waiting forever.
  assert.equal(nextActionFor({ ...base, run: { exists: true, stale: true, status: 'running' } }, []), 'resume-run')
  // A turn waiting for a human answer is a real question, not a dead run.
  assert.equal(
    nextActionFor({ ...base, run: { exists: true, status: 'waiting-input', awaitingAnswer: true } }, []),
    'answer-run',
  )
  // An idle hand-back has nothing to answer, but the round is unfinished: the
  // only honest action is to continue it from the last checkpoint.
  assert.equal(
    nextActionFor(
      { id: 'REQ-X', delivery: { key: 'in-progress' }, run: { exists: true, status: 'waiting-input', idleHandback: true } },
      [],
    ),
    'resume-run',
  )
  // A run that died (host restart, crash) is resumed rather than re-evaluated.
  assert.equal(
    nextActionFor(
      { id: 'REQ-X', delivery: { key: 'pending' }, run: { exists: true, status: 'failed', failure: { code: 'host-restart' } } },
      [],
    ),
    'resume-run',
  )
  // Still working: the only correct action is to watch, never to restart it.
  assert.equal(nextActionFor({ ...base, run: { exists: true, status: 'running', active: true } }, []), 'watch-run')
  // A requirement without a run keeps its executable evidence action.
  assert.equal(nextActionFor({ ...base, run: { exists: false } }, []), 'run-acceptance')
})

test('a dead run is listed as 待推进 with the interruption reason, not 推进中', () => {
  const dir = mkdtempSync(join(tmpdir(), 'alm-dead-run-'))
  try {
    cpSync(fixture, dir, { recursive: true })
    mkdirSync(join(dir, '.alm/runs'), { recursive: true })
    const run = {
      schema: 'alm.execution.run/v1',
      id: 'RUN-003',
      requirement: 'REQ-PAY-001',
      change: null,
      carrier: 'dsh-session',
      sessionId: 's1',
      status: 'running',
      phase: 'implement',
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z',
      heartbeatAt: '2020-01-01T00:00:00.000Z',
      attempts: 1,
      checkpoint: null,
      failure: null,
      answers: [],
      events: [],
    }
    writeFileSync(join(dir, '.alm/runs/RUN-003.json'), JSON.stringify(run))
    const item = requirements(dir).requirements.find((entry) => entry.id === 'REQ-PAY-001')
    assert.equal(item.delivery.key, 'pending', 'a lost heartbeat must not read as 推进中')
    assert.equal(item.delivery.label, '待推进')
    assert.equal(item.delivery.source, 'run-stale')
    assert.equal(item.delivery.runId, 'RUN-003')
    assert.equal(item.delivery.runStatus, 'running')
    assert.equal(item.delivery.reason, '执行器心跳丢失，本轮推进已中断')
    assert.notEqual(item.nextAction, 'watch-run')

    // Waiting for a human is a hand-back: nobody advances it, so it rolls back
    // to 待推进 with the reason, while the next action still continues the round.
    writeFileSync(
      join(dir, '.alm/runs/RUN-003.json'),
      JSON.stringify({ ...run, status: 'waiting-input', heartbeatAt: new Date().toISOString() }),
    )
    const handback = requirements(dir).requirements.find((entry) => entry.id === 'REQ-PAY-001')
    assert.equal(handback.delivery.key, 'pending')
    assert.equal(handback.delivery.source, 'run-idle')
    assert.equal(handback.delivery.waitingForHuman, true)
    assert.equal(handback.delivery.reason, '本轮推进已交接，等待人类决定下一步')
    assert.equal(handback.nextAction, 'resume-run', 'an idle hand-back continues the round')
    assert.equal(handback.mine, false)
    assert.equal(handback.currentMatter.requiresHuman, false)

    // A recorded decision request is a real question: offer answering it.
    writeFileSync(
      join(dir, '.alm/runs/RUN-003.json'),
      JSON.stringify({
        ...run,
        status: 'waiting-input',
        heartbeatAt: new Date().toISOString(),
        checkpoint: { decision: '.alm/runs/RUN-003-decision.md' },
      }),
    )
    const waiting = requirements(dir).requirements.find((entry) => entry.id === 'REQ-PAY-001')
    assert.equal(waiting.delivery.key, 'pending')
    assert.equal(waiting.delivery.source, 'run-idle')
    assert.equal(waiting.delivery.waitingForHuman, true)
    assert.equal(waiting.delivery.reason, '等待回答决策请求后继续')
    assert.equal(waiting.nextAction, 'answer-run')
    assert.equal(waiting.currentMatter.kind, 'technical-block')
    assert.equal(waiting.mine, false)
    const questionFile = join(dir, '.alm/runs/RUN-003-decision.md')
    writeFileSync(questionFile, '# 技术问题\n环境不可用')
    const firstQuestion = requirements(dir).requirements.find((entry) => entry.id === 'REQ-PAY-001')
    assert.equal(firstQuestion.run.decisionIdentity.path, '.alm/runs/RUN-003-decision.md')
    assert.match(firstQuestion.run.decisionIdentity.contentHash, /^[a-f0-9]{64}$/)
    writeFileSync(questionFile, '# 技术问题\n出现新问题')
    const secondQuestion = requirements(dir).requirements.find((entry) => entry.id === 'REQ-PAY-001')
    assert.notEqual(secondQuestion.run.decisionIdentity.contentHash, firstQuestion.run.decisionIdentity.contentHash)
    // A conventional unresolved file remains a real gate even without the
    // explicit checkpoint ref. Remove it for the independent budget-only case.
    rmSync(questionFile)
    const autoAdvance = { authorized: true, dispatches: 3, maxDispatches: 3, status: 'stopped', reason: 'auto-budget-exhausted' }
    writeFileSync(join(dir, '.alm/runs/RUN-003.json'), JSON.stringify({ ...run, status: 'waiting-input', checkpoint: { autoAdvance } }))
    const stopped = requirements(dir).requirements.find((entry) => entry.id === 'REQ-PAY-001')
    assert.deepEqual(stopped.run.autoAdvance, autoAdvance)
    assert.deepEqual(stopped.currentMatter.progress.autoAdvance, autoAdvance)
    assert.equal(stopped.mine, false)
    assert.match(stopped.currentMatter.explanation, /用完 3 次/)

    // A live run still reads as 推进中.
    writeFileSync(
      join(dir, '.alm/runs/RUN-003.json'),
      JSON.stringify({ ...run, status: 'running', heartbeatAt: new Date().toISOString() }),
    )
    const live = requirements(dir).requirements.find((entry) => entry.id === 'REQ-PAY-001')
    assert.equal(live.delivery.key, 'in-progress')
    assert.equal(live.delivery.source, 'run')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an older core that still calls a parked run 推进中 is corrected at the plugin boundary', () => {
  const stuck = { key: 'in-progress', label: '推进中', source: 'run', runId: 'RUN-9', runStatus: 'waiting-input' }
  const corrected = applyDeliveryShim({
    delivery: stuck,
    run: { exists: true, id: 'RUN-9', status: 'waiting-input', active: true, decision: '.alm/runs/RUN-9-decision.md' },
  })
  assert.equal(corrected.key, 'pending')
  assert.equal(corrected.label, '待推进')
  assert.equal(corrected.source, 'run-idle')
  assert.equal(corrected.runStatus, 'waiting-input')
  assert.equal(corrected.reason, '等待回答决策请求后继续')

  const handback = applyDeliveryShim({
    delivery: { ...stuck, runStatus: 'waiting-input' },
    run: { exists: true, id: 'RUN-9', status: 'waiting-input', active: true },
  })
  assert.equal(handback.reason, '本轮推进已交接，等待人类决定下一步')

  // A run that can actually progress is left alone.
  const live = { key: 'in-progress', label: '推进中', source: 'run', runId: 'RUN-8', runStatus: 'running' }
  assert.equal(
    applyDeliveryShim({ delivery: live, run: { exists: true, id: 'RUN-8', status: 'running', active: true } }),
    live,
  )

  // Already-honest projections pass through untouched.
  const pending = { key: 'pending', label: '待推进', source: 'run-stale' }
  assert.equal(applyDeliveryShim({ delivery: pending, run: { exists: true, status: 'running' } }), pending)
})
