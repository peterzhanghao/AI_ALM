import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { indexReport } from '../../src/commands.mjs'
import { ArchiveError } from '../../src/requirements/archive.mjs'
import {
  applyArchiveYaml,
  isYamlAsset,
  planArchiveYaml,
} from '../../src/requirements/archive-yaml.mjs'

const dirs = []

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function yamlAsset({ id, title, status = 'proposed', revision = 1 }) {
  return [
    'schema_version: 1',
    `id: ${id}`,
    'type: requirement',
    `title: ${title}`,
    `status: ${status}`,
    ...(revision === undefined ? [] : [`revision: ${revision}`]),
    'owner: team-demo',
    'links:',
    '  - type: verified_by',
    '    target: TEST-DUP-001',
    '',
  ].join('\n')
}

function makeRepo(extra = {}) {
  const root = mkdtempSync(join(tmpdir(), 'alm-archive-yaml-'))
  dirs.push(root)
  mkdirSync(join(root, '.alm'), { recursive: true })
  mkdirSync(join(root, 'requirements'), { recursive: true })
  writeFileSync(
    join(root, '.alm', 'project.json'),
    `${JSON.stringify({ schema: 'alm.project/v1', id: 'ALM', name: '归档测试', requirementRoot: 'requirements', teams: ['测试团队'] }, null, 2)}\n`,
    'utf8',
  )
  writeFileSync(join(root, 'requirements', 'dup-a.yml'), yamlAsset({ id: 'REQ-DUP-001', title: '重复 A', ...(extra.a ?? {}) }), 'utf8')
  writeFileSync(join(root, 'requirements', 'dup-b.yml'), yamlAsset({ id: 'REQ-DUP-001', title: '重复 B', ...(extra.b ?? {}) }), 'utf8')
  git(root, ['init', '-q'])
  git(root, ['add', '-A'])
  git(root, ['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'fixture'])
  return root
}

function loadAsset(root, id, file) {
  const index = indexReport(root)
  assert.deepEqual(index.errors, [])
  return index.assets.find((entry) => entry.id === id && (!file || entry.source.path === file))
}

function auditFiles(root) {
  const dir = join(root, '.alm', 'audit', 'requirements')
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((name) => name.endsWith('.json')).sort()
}

function lineCount(text) {
  return text.split(String.fromCharCode(10)).length
}

test.after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

test('isYamlAsset recognises yaml assets and rejects sdoc', () => {
  const root = makeRepo()
  const asset = loadAsset(root, 'REQ-DUP-001', 'requirements/dup-a.yml')
  assert.equal(isYamlAsset(asset), true)
  assert.equal(isYamlAsset({ id: 'REQ-X', source: { path: 'requirements/x.sdoc', format: 'sdoc' } }), false)
})

test('planArchiveYaml rewrites only status/revision of the target file', () => {
  const root = makeRepo()
  const asset = loadAsset(root, 'REQ-DUP-001', 'requirements/dup-a.yml')
  const before = readFileSync(join(root, 'requirements', 'dup-a.yml'), 'utf8')
  const plan = planArchiveYaml({ root, asset, reason: '重复记录，保留 A' })

  assert.equal(plan.applied, false)
  assert.equal(plan.file, 'requirements/dup-a.yml')
  assert.equal(plan.format, 'yaml')
  assert.equal(plan.status.to, 'archived')
  assert.equal(plan.revision, 2)
  assert.match(plan.after.content, /^status: archived$/m)
  assert.match(plan.after.content, /^revision: 2$/m)
  // the fixture already carries a revision line, so it is replaced rather than inserted
  assert.equal(lineCount(plan.after.content), lineCount(before))
  assert.equal(readFileSync(join(root, 'requirements', 'dup-a.yml'), 'utf8'), before)
  // the duplicate sibling is untouched in the plan
  assert.match(plan.after.content, /^title: 重复 A$/m)
})

test('applyArchiveYaml archives one duplicate, bumps revision, writes audit and is idempotent', () => {
  const root = makeRepo()
  const asset = loadAsset(root, 'REQ-DUP-001', 'requirements/dup-b.yml')
  const plan = planArchiveYaml({ root, asset })
  const result = applyArchiveYaml({
    root,
    asset,
    expectedBaseline: plan.baseline,
    actor: 'human:local',
    reason: '保留 B',
    idempotencyKey: 'k-1',
  })

  assert.equal(result.applied, true)
  assert.equal(result.idempotent, false)
  assert.equal(result.revision, 2)
  assert.equal(result.file, 'requirements/dup-b.yml')
  assert.equal(result.status.to, 'archived')
  const archived = readFileSync(join(root, 'requirements', 'dup-b.yml'), 'utf8')
  assert.match(archived, /^status: archived$/m)
  assert.match(archived, /^revision: 2$/m)
  // the other record keeps its status and revision
  const sibling = readFileSync(join(root, 'requirements', 'dup-a.yml'), 'utf8')
  assert.match(sibling, /^status: proposed$/m)
  assert.match(sibling, /^revision: 1$/m)
  // audit is one file bound to the actor and the idempotency key
  const audits = auditFiles(root)
  assert.equal(audits.length, 1)
  const audit = JSON.parse(readFileSync(join(root, '.alm', 'audit', 'requirements', audits[0]), 'utf8'))
  assert.equal(audit.kind, 'archive')
  assert.equal(audit.format, 'yaml')
  assert.equal(audit.actor, 'human:local')
  assert.equal(audit.idempotencyKey, 'k-1')
  // replay with the same key returns the recorded result and does not bump twice
  const replay = applyArchiveYaml({ root, asset, expectedBaseline: plan.baseline, actor: 'human:local', idempotencyKey: 'k-1' })
  assert.equal(replay.applied, true)
  assert.equal(replay.idempotent, true)
  assert.equal(readFileSync(join(root, 'requirements', 'dup-b.yml'), 'utf8'), archived)
})

test('a stale baseline is rejected and the file stays untouched', () => {
  const root = makeRepo()
  const asset = loadAsset(root, 'REQ-DUP-001', 'requirements/dup-a.yml')
  const plan = planArchiveYaml({ root, asset })
  // simulate a concurrent edit after the preview
  writeFileSync(join(root, 'requirements', 'dup-a.yml'), yamlAsset({ id: 'REQ-DUP-001', title: '重复 A 已改', revision: 2 }), 'utf8')
  assert.throws(
    () => applyArchiveYaml({ root, asset, expectedBaseline: plan.baseline, actor: 'human:local' }),
    (error) => error instanceof ArchiveError && error.code === 'stale-preview' && error.status === 409,
  )
  assert.match(readFileSync(join(root, 'requirements', 'dup-a.yml'), 'utf8'), /^title: 重复 A 已改$/m)
})

test('archiving requires an actor and a baseline', () => {
  const root = makeRepo()
  const asset = loadAsset(root, 'REQ-DUP-001', 'requirements/dup-a.yml')
  const plan = planArchiveYaml({ root, asset })
  assert.throws(
    () => applyArchiveYaml({ root, asset, expectedBaseline: plan.baseline }),
    (error) => error.code === 'actor-required',
  )
  assert.throws(
    () => applyArchiveYaml({ root, asset, actor: 'human:local' }),
    (error) => error.code === 'baseline-required',
  )
})

test('an already archived requirement is not archived twice', () => {
  const root = makeRepo({ a: { status: 'archived', revision: 2 } })
  const asset = loadAsset(root, 'REQ-DUP-001', 'requirements/dup-a.yml')
  assert.throws(
    () => planArchiveYaml({ root, asset }),
    (error) => error.code === 'already-archived' && error.status === 409,
  )
})

test('mismatched id fails without writing', () => {
  const root = makeRepo()
  const asset = loadAsset(root, 'REQ-DUP-001', 'requirements/dup-a.yml')
  const wrong = { ...asset, id: 'REQ-OTHER-001' }
  assert.throws(
    () => planArchiveYaml({ root, asset: wrong }),
    (error) => error.code === 'file-invalid' && error.status === 409,
  )
  assert.match(readFileSync(join(root, 'requirements', 'dup-a.yml'), 'utf8'), /^status: proposed$/m)
})
