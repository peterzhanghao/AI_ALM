import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { diffRequirementVersions } from '../version-diff.mjs'

const dirs = []

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'alm-version-diff-'))
  dirs.push(root)
  mkdirSync(join(root, 'requirements'), { recursive: true })
  execFileSync('git', ['init', '-q'], { cwd: root })
  return root
}

function writeSdoc(root, { title, status = 'proposed', priority = 'P1', relations = [] }) {
  const lines = [
    '[DOCUMENT]',
    'TITLE: demo',
    '',
    '[REQUIREMENT]',
    'UID: REQ-DIFF-001',
    `TITLE: ${title}`,
    `STATUS: ${status}`,
    'OWNER: team-a',
    'PROJECT: DIFF',
    `PRIORITY: ${priority}`,
    'REVISION: 1',
  ]
  for (const [type, target] of relations) lines.push('', '[RELATION]', `Type: ${type}`, `Value: ${target}`)
  writeFileSync(join(root, 'requirements', 'demo.sdoc'), `${lines.join('\n')}\n`)
}

function commit(root, message) {
  execFileSync('git', ['add', '-A'], { cwd: root })
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-qm', message], { cwd: root })
}

function head(root) {
  return execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
}

test.after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

test('diffRequirementVersions reports field and relation changes between commits', () => {
  const root = makeRepo()
  writeSdoc(root, { title: '初始标题', relations: [['verified_by', 'TEST-DIFF-001']] })
  commit(root, 'v1 with asset')
  const first = head(root)

  writeSdoc(root, {
    title: '更新后的标题',
    status: 'accepted',
    priority: 'P2',
    relations: [
      ['verified_by', 'TEST-DIFF-002'],
      ['allocated_to', 'MOD-DIFF-001'],
    ],
  })
  commit(root, 'v2')
  const second = head(root)

  const diff = diffRequirementVersions({
    root,
    file: 'requirements/demo.sdoc',
    assetId: 'REQ-DIFF-001',
    from: first.slice(0, 8),
    to: second,
  })
  assert.equal(diff.schema, 'alm.version.diff/v1')
  assert.equal(diff.mode, 'changed')
  const fieldNames = diff.fields.map((field) => field.field)
  assert.ok(fieldNames.includes('TITLE'))
  assert.ok(fieldNames.includes('STATUS'))
  assert.ok(fieldNames.includes('PRIORITY'))
  assert.deepEqual(diff.relations.added, ['allocated_to|MOD-DIFF-001', 'verified_by|TEST-DIFF-002'])
  assert.deepEqual(diff.relations.removed, ['verified_by|TEST-DIFF-001'])
  assert.equal(diff.summary.changedFields, diff.fields.length)
  assert.equal(diff.summary.addedRelations, 2)
  assert.equal(diff.summary.removedRelations, 1)
})

test('diffRequirementVersions compares a commit against the worktree by default', () => {
  const root = makeRepo()
  writeSdoc(root, { title: '工作区标题' })
  commit(root, 'worktree baseline')
  const base = head(root)
  writeSdoc(root, { title: '工作区标题', status: 'accepted' })
  const diff = diffRequirementVersions({ root, file: 'requirements/demo.sdoc', assetId: 'REQ-DIFF-001', from: base })
  assert.equal(diff.to, 'worktree')
  assert.deepEqual(diff.fields.map((field) => field.field), ['STATUS'])
})

test('diffRequirementVersions rejects bad refs and unknown assets', () => {
  const root = makeRepo()
  writeSdoc(root, { title: 'x' })
  commit(root, 'x')
  const base = head(root)
  assert.throws(
    () => diffRequirementVersions({ root, file: 'requirements/demo.sdoc', assetId: 'REQ-DIFF-001', from: 'not-a-ref' }),
    (error) => error.code === 'invalid-ref',
  )
  assert.throws(
    () => diffRequirementVersions({ root, file: 'requirements/demo.sdoc', assetId: 'REQ-NOPE-001', from: base }),
    (error) => error.code === 'asset-not-found' && error.status === 404,
  )
})
