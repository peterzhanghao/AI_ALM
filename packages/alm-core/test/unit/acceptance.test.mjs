import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import {
  ACCEPTANCE_SCHEMA,
  acceptanceSummary,
  readAcceptanceEvidence,
  runAcceptance,
} from '../../src/acceptance/acceptance.mjs'
import { gitHead } from '../../src/approvals/approval.mjs'
import { requirementContentHash, testRevisionHash } from '../../src/model/content-hash.mjs'

const dirs = []

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'alm-acceptance-'))
  dirs.push(root)
  execFileSync('git', ['init', '-q'], { cwd: root })
  writeFileSync(join(root, 'README.md'), '# demo\n')
  execFileSync('git', ['add', '-A'], { cwd: root })
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'init'], { cwd: root })
  return root
}

function writeConfig(root, requirementId, commands) {
  mkdirSync(join(root, '.alm', 'acceptance'), { recursive: true })
  writeFileSync(
    join(root, '.alm', 'acceptance', `${requirementId}.json`),
    JSON.stringify({ schema: 'alm.acceptance.config/v1', requirement: requirementId, commands }, null, 2),
  )
}

function requirementAsset(overrides = {}) {
  return {
    id: 'REQ-X-001',
    type: 'requirement',
    title: '示例需求',
    status: 'proposed',
    owner: 'team',
    links: [{ type: 'verified_by', target: 'TEST-X-001' }],
    extra: { priority: 'P1' },
    ...overrides,
  }
}

function testAsset(overrides = {}) {
  return {
    id: 'TEST-X-001',
    type: 'acceptance-test',
    title: '验收用例',
    status: 'proposed',
    owner: 'team',
    links: [],
    extra: { revision: 1 },
    ...overrides,
  }
}

function contextOf(asset = requirementAsset()) {
  return {
    asset,
    assets: [asset, testAsset()],
    actor: 'human:local',
    project: 'PAY',
    file: asset.source?.path ?? 'requirements/refund.sdoc',
  }
}

function passCommand() {
  return [{ id: 'smoke', command: ['node', '-e', 'process.exit(0)'] }]
}

after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

test('planAcceptance previews commands without writing evidence', () => {
  const root = makeRepo()
  writeConfig(root, 'REQ-X-001', [{ id: 'smoke', command: ['node', '-e', 'process.exit(0)'] }])
  const plan = runAcceptance({ root, requirementId: 'REQ-X-001' })
  assert.equal(plan.schema, 'alm.acceptance.plan/v1')
  assert.match(plan.headSha, /^[0-9a-f]{40}$/)
  assert.equal(plan.commands.length, 1)
  assert.equal(plan.commands[0].id, 'smoke')
  assert.equal(plan.applied, false)
  assert.ok(!existsSync(join(root, '.alm', 'acceptance', 'REQ-X-001')))
})

test('runAcceptance archives pass/fail evidence keyed by HEAD', () => {
  const root = makeRepo()
  writeConfig(root, 'REQ-X-001', [{ id: 'smoke', command: ['node', '-e', 'process.exit(0)'] }])
  const pass = runAcceptance({ root, requirementId: 'REQ-X-001', apply: true })
  assert.equal(pass.result, 'pass')
  assert.equal(pass.evidence.commands[0].exitCode, 0)
  const evidence = readAcceptanceEvidence(root, 'REQ-X-001')
  assert.equal(evidence.schema, ACCEPTANCE_SCHEMA)
  assert.equal(evidence.schema, 'alm.acceptance/v2')
  assert.equal(evidence.revision, 2)
  assert.equal(evidence.result, 'pass')
  assert.equal(evidence.headSha, pass.headSha)
  assert.equal(evidence.environment.runner, 'alm-core/acceptance')
  assert.equal(evidence.source, 'local-runner')
  // No context: the run is archived but not provenance-bound.
  assert.equal(evidence.requirementHash, null)
  assert.equal(evidence.testRevision, null)
  assert.ok(existsSync(join(root, '.alm', 'acceptance', 'REQ-X-001', `${pass.headSha}.json`)))

  writeConfig(root, 'REQ-X-001', [{ id: 'broken', command: ['node', '-e', 'process.exit(3)'] }])
  const fail = runAcceptance({ root, requirementId: 'REQ-X-001', apply: true })
  assert.equal(fail.result, 'fail')
  assert.equal(fail.evidence.commands[0].exitCode, 3)
  const stored = JSON.parse(readFileSync(fail.evidence.file ?? join(root, '.alm', 'acceptance', 'REQ-X-001', `${fail.headSha}.json`), 'utf8'))
  assert.equal(stored.result, 'fail')
})

test('acceptanceSummary exposes registration and latest evidence', () => {
  const root = makeRepo()
  writeConfig(root, 'REQ-X-001', [{ id: 'smoke', command: ['node', '-e', 'process.exit(0)'] }])
  const empty = acceptanceSummary(root, 'REQ-X-001')
  assert.equal(empty.registered, true)
  assert.equal(empty.commandCount, 1)
  assert.equal(empty.latest, null)

  const asset = requirementAsset()
  const run = runAcceptance({ root, requirementId: 'REQ-X-001', apply: true, context: contextOf(asset) })
  assert.equal(run.evidence.requirementHash, requirementContentHash({ root, asset }))
  assert.equal(run.evidence.testRevision, testRevisionHash({ asset, assets: [asset, testAsset()] }))
  const summary = acceptanceSummary(root, 'REQ-X-001', run.headSha, contextOf(asset))
  assert.equal(summary.schema, 'alm.acceptance.summary/v2')
  assert.equal(summary.latest.result, 'pass')
  assert.equal(summary.latest.current, true)
  assert.equal(summary.latest.commands, 1)
  assert.equal(summary.latest.complete, true)
  assert.deepEqual(summary.latest.missing, [])
  assert.equal(summary.latest.staleReason, null)
  assert.equal(summary.latest.requirementHash, requirementContentHash({ root, asset }))
  assert.equal(summary.latest.testRevision, testRevisionHash({ asset, assets: [asset, testAsset()] }))
  assert.equal(summary.latest.environment.runner, 'alm-core/acceptance')
  assert.equal(summary.latest.source, 'local-runner')
})

test('acceptance rejects non-whitelisted binaries and missing config', () => {
  const root = makeRepo()
  writeConfig(root, 'REQ-X-001', [{ id: 'bad', command: ['bash', '-lc', 'echo hi'] }])
  assert.throws(
    () => runAcceptance({ root, requirementId: 'REQ-X-001' }),
    (error) => error.code === 'binary-not-allowed',
  )
  assert.throws(
    () => runAcceptance({ root, requirementId: 'REQ-NOPE-001' }),
    (error) => error.code === 'no-config' && error.status === 404,
  )
})

test('a run without context is archived but stays incomplete and never current', () => {
  const root = makeRepo()
  writeConfig(root, 'REQ-X-001', passCommand())
  const run = runAcceptance({ root, requirementId: 'REQ-X-001', apply: true })
  assert.equal(run.evidence.requirementHash, null)
  assert.equal(run.evidence.testRevision, null)
  assert.equal(run.evidence.requirementHash === null && run.evidence.testRevision === null, true)

  const summary = acceptanceSummary(root, 'REQ-X-001', run.headSha)
  assert.equal(summary.latest.complete, false)
  assert.equal(summary.latest.current, false)
  assert.deepEqual(summary.latest.missing, ['requirementHash', 'testRevision'])
  assert.equal(summary.latest.staleReason, 'incomplete')

  // Even with a live context, incomplete evidence cannot become current.
  const withContext = acceptanceSummary(root, 'REQ-X-001', run.headSha, contextOf())
  assert.equal(withContext.latest.current, false)
  assert.equal(withContext.latest.staleReason, 'incomplete')
})

test('acceptanceSummary explains why bound evidence is stale', () => {
  const root = makeRepo()
  writeConfig(root, 'REQ-X-001', passCommand())
  const asset = requirementAsset()
  const run = runAcceptance({ root, requirementId: 'REQ-X-001', apply: true, context: contextOf(asset) })
  const head = run.headSha

  const requirementChanged = acceptanceSummary(
    root,
    'REQ-X-001',
    head,
    contextOf(requirementAsset({ title: '示例需求（改）' })),
  )
  assert.equal(requirementChanged.latest.current, false)
  assert.equal(requirementChanged.latest.complete, true)
  assert.equal(requirementChanged.latest.staleReason, 'requirement')

  const testsChanged = acceptanceSummary(root, 'REQ-X-001', head, {
    asset,
    assets: [asset, testAsset({ title: '验收用例（改）' })],
  })
  assert.equal(testsChanged.latest.current, false)
  assert.equal(testsChanged.latest.staleReason, 'tests')

  const headChanged = acceptanceSummary(root, 'REQ-X-001', 'f'.repeat(40), contextOf(asset))
  assert.equal(headChanged.latest.current, false)
  assert.equal(headChanged.latest.staleReason, 'head')
})

test('v1 evidence is read only compatible and marked incomplete, never migrated', () => {
  const root = makeRepo()
  writeConfig(root, 'REQ-X-001', passCommand())
  const headSha = gitHead(root)
  const evidenceDir = join(root, '.alm', 'acceptance', 'REQ-X-001')
  mkdirSync(evidenceDir, { recursive: true })
  const v1File = join(evidenceDir, `${headSha}.json`)
  writeFileSync(
    v1File,
    JSON.stringify(
      {
        schema: 'alm.acceptance/v1',
        requirement: 'REQ-X-001',
        headSha,
        result: 'pass',
        startedAt: '2026-10-30T00:00:00.000Z',
        finishedAt: '2026-10-30T00:00:01.000Z',
        commands: [{ id: 'smoke', command: ['node', '-e', 'process.exit(0)'], exitCode: 0, timedOut: false, durationMs: 1 }],
      },
      null,
      2,
    ),
  )

  const evidence = readAcceptanceEvidence(root, 'REQ-X-001')
  assert.equal(evidence.schema, 'alm.acceptance/v1')
  assert.equal(evidence.result, 'pass')

  const summary = acceptanceSummary(root, 'REQ-X-001', headSha, contextOf())
  assert.equal(summary.latest.complete, false)
  assert.equal(summary.latest.current, false)
  assert.deepEqual(summary.latest.missing, ['requirementHash', 'testRevision', 'environment', 'source'])
  assert.equal(summary.latest.staleReason, 'incomplete')

  // The old file is preserved verbatim: no migration, no deletion.
  assert.ok(existsSync(v1File))
  assert.equal(JSON.parse(readFileSync(v1File, 'utf8')).schema, 'alm.acceptance/v1')
})
