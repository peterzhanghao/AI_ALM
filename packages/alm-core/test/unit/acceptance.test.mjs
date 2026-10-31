import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import {
  acceptanceSummary,
  readAcceptanceEvidence,
  runAcceptance,
} from '../../src/acceptance/acceptance.mjs'

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
  assert.equal(evidence.schema, 'alm.acceptance/v1')
  assert.equal(evidence.result, 'pass')
  assert.equal(evidence.headSha, pass.headSha)
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

  const run = runAcceptance({ root, requirementId: 'REQ-X-001', apply: true })
  const summary = acceptanceSummary(root, 'REQ-X-001', run.headSha)
  assert.equal(summary.latest.result, 'pass')
  assert.equal(summary.latest.current, true)
  assert.equal(summary.latest.commands, 1)
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
