import assert from 'node:assert/strict'
import { createCandidate, candidateStatus, worktreeSnapshot } from '../../src/requirements/candidate.mjs'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import {
  ACCEPTANCE_SCHEMA,
  acceptanceBinding,
  acceptanceSummary,
  readAcceptanceEvidence,
  runAcceptance,
} from '../../src/acceptance/acceptance.mjs'
import { MAX_VERIFICATION_TEST_FILES } from '../../src/requirements/blueprint-guard.mjs'
import { gitHead } from '../../src/approvals/approval.mjs'
import { requirementContentHash, testRevisionHash } from '../../src/model/content-hash.mjs'

const dirs = []
const receiptSchema = JSON.parse(readFileSync(new URL('../../src/contracts/acceptance.schema.json', import.meta.url), 'utf8'))
// Dependency-free executable validator for every keyword used by this contract.
function validateReceipt(value, schema = receiptSchema) {
  if (schema.$ref) return validateReceipt(value, receiptSchema.definitions[schema.$ref.split('/').at(-1)])
  if ('const' in schema && value !== schema.const) return false
  if (schema.enum && !schema.enum.includes(value)) return false
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
  if (schema.type && ![].concat(schema.type).some(t => t === type || (t === 'integer' && Number.isInteger(value)))) return false
  if (schema.pattern && !new RegExp(schema.pattern).test(value)) return false
  if (schema.minLength && value.length < schema.minLength) return false
  if (schema.minItems && value.length < schema.minItems) return false
  if (schema.required?.some(key => !Object.hasOwn(value, key))) return false
  if (schema.properties && Object.entries(schema.properties).some(([key, s]) => Object.hasOwn(value, key) && !validateReceipt(value[key], s))) return false
  if (schema.items && value.some(item => !validateReceipt(item, schema.items))) return false
  return true
}

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

test('v3 binds dirty content and prevents candidate laundering of an older pass', () => {
  const root = makeRepo(), asset = requirementAsset(), context = contextOf(asset)
  writeConfig(root, asset.id, passCommand())
  writeFileSync(join(root, 'business.txt'), 'A')
  const run = runAcceptance({ root, requirementId: asset.id, apply: true, context })
  assert.equal(validateReceipt(run.evidence), true, JSON.stringify(validateReceipt.errors))
  const summary = acceptanceSummary(root, asset.id, run.headSha, context)
  const candidate = createCandidate({ root, asset, acceptance: summary })
  assert.equal(candidateStatus({ root, asset, assets: context.assets, candidate }).current, true)
  writeFileSync(join(root, 'business.txt'), 'B')
  assert.equal(acceptanceSummary(root, asset.id, run.headSha, context).latest.current, false)
  const laundered = createCandidate({ root, asset, acceptance: summary })
  assert.equal(candidateStatus({ root, asset, assets: context.assets, candidate: laundered }).current, false)
  assert.ok(candidateStatus({ root, asset, assets: context.assets, candidate: laundered }).reasons.some(r => r.code === 'candidate-unverified'))
  const fresh = runAcceptance({ root, requirementId: asset.id, apply: true, context })
  const rebound = createCandidate({ root, asset, acceptance: acceptanceSummary(root, asset.id, fresh.headSha, context) })
  assert.equal(candidateStatus({ root, asset, assets: context.assets, candidate: rebound }).current, true)
  assert.equal(candidateStatus({ root, asset, assets: [asset, testAsset({ title: 'changed' })], candidate: rebound }).current, false)
  for (const mutate of [e => { e.requirement = 'REQ-OTHER' }, e => { e.commands[0].command = ['node', '-e', 'wrong'] }, e => { e.worktree.before.headSha = 'f'.repeat(40) }, e => { e.commands[0].exitCode = 1 }, e => { delete e.environment }, e => { e.commands[0].timedOut = true }]) {
    const forged = structuredClone(fresh.evidence); mutate(forged)
    assert.equal(acceptanceBinding({ root, evidence: forged, asset, assets: context.assets }).current, false)
  }
})

test('execution mutations and configuration changes fail closed, legacy v2 remains read-only', () => {
  const root = makeRepo(), asset = requirementAsset(), context = contextOf(asset)
  writeConfig(root, asset.id, passCommand())
  const run = runAcceptance({ root, requirementId: asset.id, apply: true, context, exec: () => { writeFileSync(join(root, 'changed.txt'), 'during command'); return { status: 0 } } })
  assert.equal(run.result, 'pass')
  assert.equal(run.evidence.worktree.stable, false)
  assert.equal(acceptanceSummary(root, asset.id, run.headSha, context).latest.current, false)
  const good = runAcceptance({ root, requirementId: asset.id, apply: true, context })
  writeConfig(root, asset.id, [{ ...passCommand()[0], timeoutMs: 42 }])
  assert.equal(acceptanceSummary(root, asset.id, good.headSha, context).latest.staleReason, 'config')
  const target = join(root, '.alm/acceptance', asset.id, `${good.headSha}.json`)
  const legacy = { ...good.evidence, schema: 'alm.acceptance/v2', revision: 2 }; delete legacy.worktree; delete legacy.configHash
  const bytes = JSON.stringify(legacy); writeFileSync(target, bytes)
  assert.equal(acceptanceSummary(root, asset.id, good.headSha, context).latest.staleReason, 'worktree-unbound')
  assert.equal(readFileSync(target, 'utf8'), bytes)
  assert.equal(validateReceipt(legacy), false)
})

test('history preserves corrupt and same timestamp distinct receipt bytes without overwrites', () => {
  const root = makeRepo(), asset = requirementAsset(), context = contextOf(asset)
  writeConfig(root, asset.id, passCommand())
  const first = runAcceptance({ root, requirementId: asset.id, apply: true, context })
  const target = join(root, '.alm/acceptance', asset.id, `${first.headSha}.json`)
  const history = join(root, '.alm/acceptance', asset.id, 'history')
  const originals = ['{malformed', JSON.stringify({ ...first.evidence, marker: 1 }), JSON.stringify({ ...first.evidence, marker: 2 })]
  for (const bytes of originals) { writeFileSync(target, bytes); runAcceptance({ root, requirementId: asset.id, apply: true, context }) }
  const archived = readdirSync(history).map(name => readFileSync(join(history, name), 'utf8'))
  for (const bytes of originals) assert.ok(archived.includes(bytes))
  for (const mutate of [e => { delete e.worktree }, e => { e.configHash = 'bad' }, e => { e.commands = [] }]) {
    const bad = structuredClone(first.evidence); mutate(bad); assert.equal(validateReceipt(bad), false)
  }
  let calls = 0, cached
  const readContext = { worktreeSnapshot: () => { calls++; return cached ??= worktreeSnapshot(root) } }
  acceptanceSummary(root, asset.id, first.headSha, { ...context, readContext })
  assert.equal(calls, 1)
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
  assert.equal(evidence.schema, 'alm.acceptance/v3')
  assert.equal(evidence.revision, 3)
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
  assert.equal(summary.schema, 'alm.acceptance.summary/v3')
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

test('acceptance rejects legacy unscoped Node discovery before spawning', () => {
  const root = makeRepo()
  writeConfig(root, 'REQ-X-001', [{ id: 'unsafe', command: ['node', '--test'], timeoutMs: 120000 }])
  let calls = 0
  assert.throws(
    () => runAcceptance({ root, requirementId: 'REQ-X-001', apply: true, exec: () => { calls += 1; return { status: 0 } } }),
    (error) => error.code === 'test-scope-required',
  )
  assert.equal(calls, 0)
})

test('acceptance rejects a legacy repository-wide package test before spawning', () => {
  const root = makeRepo()
  writeConfig(root, 'REQ-X-001', [{ id: 'unsafe', command: ['pnpm', 'test'], timeoutMs: 120000 }])
  let calls = 0
  assert.throws(
    () => runAcceptance({ root, requirementId: 'REQ-X-001', apply: true, exec: () => { calls += 1; return { status: 0 } } }),
    (error) => error.code === 'generic-test-command',
  )
  assert.equal(calls, 0)
})

test('explicit Node test scope runs without discovering a failing tmp copy', () => {
  const root = makeRepo()
  mkdirSync(join(root, 'test'), { recursive: true })
  mkdirSync(join(root, 'tmp'), { recursive: true })
  writeFileSync(join(root, 'test', 'requirement.test.mjs'), "import test from 'node:test'; test('requirement', () => {})\n")
  writeFileSync(join(root, 'tmp', 'copied.test.mjs'), "import test from 'node:test'; test('copied', () => { throw new Error('must not run') })\n")
  writeConfig(root, 'REQ-X-001', [{ id: 'scoped', command: ['node', '--test', 'test/requirement.test.mjs'] }])
  const run = runAcceptance({ root, requirementId: 'REQ-X-001', apply: true })
  assert.equal(run.result, 'pass')
  assert.deepEqual(run.evidence.commands[0].command, ['node', '--test', 'test/requirement.test.mjs'])
  assert.doesNotMatch(run.evidence.commands[0].stdout, /must not run/)
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
  assert.deepEqual(summary.latest.missing, ['requirementHash', 'testRevision', 'environment', 'source', 'worktree', 'configHash'])
  assert.equal(summary.latest.staleReason, 'worktree-unbound')

  // The old file is preserved verbatim: no migration, no deletion.
  assert.ok(existsSync(v1File))
  assert.equal(JSON.parse(readFileSync(v1File, 'utf8')).schema, 'alm.acceptance/v1')
})

test('an oversized timed-out command explains how to narrow the acceptance set', () => {
  const root = makeRepo()
  const asset = requirementAsset()
  const files = Array.from({ length: MAX_VERIFICATION_TEST_FILES + 1 }, (_, index) => `test/case-${index}.test.mjs`)
  writeConfig(root, 'REQ-X-001', [{ id: 'wide', command: ['node', '--test', ...files], timeoutMs: 30000 }])
  const run = runAcceptance({
    root,
    requirementId: 'REQ-X-001',
    apply: true,
    context: contextOf(asset),
    exec: () => ({ error: Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' }), signal: 'SIGTERM' }),
  })
  const diagnostic = acceptanceSummary(root, 'REQ-X-001', run.headSha, contextOf(asset)).latest.diagnostic
  assert.equal(diagnostic.category, 'timeout')
  assert.match(diagnostic.summary, /收窄验收命令/)
  assert.equal(diagnostic.scale.fileCount, MAX_VERIFICATION_TEST_FILES + 1)
  assert.equal(diagnostic.scale.max, MAX_VERIFICATION_TEST_FILES)
})

test('acceptance summary exposes a redacted diagnostic for a failed command', () => {
  const root = makeRepo()
  const asset = requirementAsset()
  writeConfig(root, 'REQ-X-001', [{ id: 'focused', command: ['node', '--test', 'focused.test.mjs'] }])
  const run = runAcceptance({
    root,
    requirementId: 'REQ-X-001',
    apply: true,
    context: contextOf(asset),
    exec: () => ({ status: 1, stderr: 'not ok 1 - preserves title\nAssertionError: expected retained title\ntoken=secret-value' }),
  })
  const diagnostic = acceptanceSummary(root, 'REQ-X-001', run.headSha, contextOf(asset)).latest.diagnostic
  assert.equal(diagnostic.title, '验证检查未通过')
  assert.match(diagnostic.summary, /exit 1.*not ok 1/)
  assert.match(diagnostic.log, /not ok 1/)
  assert.doesNotMatch(diagnostic.log, /secret-value/)
})
