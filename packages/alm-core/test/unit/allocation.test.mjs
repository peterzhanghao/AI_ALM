/**
 * Declaring `allocated_to` is the only action that unblocks a delivery whose
 * implementation moved an undeclared module. Because it edits requirement
 * content, the write is CAS-guarded, audited and re-verified by re-parsing.
 */
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { applyAllocation, planAllocation } from '../../src/requirements/allocation.mjs'
import { loadRepo } from '../../src/parse/load.mjs'
import { reconcileArchitectureDeclarations } from '../../src/requirements/architecture-impact.mjs'

const SDOC = `[DOCUMENT]
TITLE: 声明测试需求

[SECTION]
TITLE: 背景

[REQUIREMENT]
UID: REQ-T-1
TITLE: 声明测试需求
OWNER: team-pay
PROJECT: ALM
PRIORITY: P2
CATEGORY: functional
REVISION: 1
BRIEF: requirements/briefs/REQ-T-1.md
SOURCE: chat
`

function moduleYml(id, path) {
  return `schema_version: 1
id: ${id}
type: module
title: ${id}
role: test module
paths:
  - ${path}
`
}

function repo() {
  const root = mkdtempSync(join(tmpdir(), 'alm-allocation-'))
  mkdirSync(join(root, 'architecture'), { recursive: true })
  mkdirSync(join(root, 'requirements/briefs'), { recursive: true })
  writeFileSync(join(root, 'architecture/MOD-A.yml'), moduleYml('MOD-A', 'packages/a/'))
  writeFileSync(join(root, 'architecture/MOD-B.yml'), moduleYml('MOD-B', 'packages/b/'))
  writeFileSync(join(root, 'requirements/req-t-1.sdoc'), SDOC)
  writeFileSync(join(root, 'requirements/briefs/REQ-T-1.md'), '# REQ-T-1\n\n目标：声明测试\n')
  return root
}

test('plan reports only the modules still missing and the exact snippet', () => {
  const root = repo()
  try {
    const plan = planAllocation({ root, requirementId: 'REQ-T-1', modules: ['MOD-A', 'MOD-B'] })
    assert.equal(plan.requirement, 'REQ-T-1')
    assert.equal(plan.file, 'requirements/req-t-1.sdoc')
    assert.deepEqual(plan.declared, [])
    assert.deepEqual(plan.missing, ['MOD-A', 'MOD-B'])
    assert.match(plan.snippet, /\[RELATION\]\nType: allocated_to\nValue: MOD-A/)
    assert.match(plan.snippet, /Value: MOD-B/)
    assert.match(plan.requirementHash, /^[a-f0-9]{64}$/)
    // A plan never writes.
    assert.equal(readFileSync(join(root, plan.file), 'utf8'), SDOC)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('declare appends the relations, re-parses the document and is idempotent', () => {
  const root = repo()
  try {
    const first = applyAllocation({
      root,
      requirementId: 'REQ-T-1',
      modules: ['MOD-A', 'MOD-B'],
      actor: 'human:local',
      now: '2026-11-18T12:00:00.000Z',
    })
    assert.equal(first.applied, true)
    assert.equal(first.idempotent, false)
    assert.deepEqual(first.modules, ['MOD-A', 'MOD-B'])
    assert.deepEqual(first.declared, ['MOD-A', 'MOD-B'])
    assert.notEqual(first.requirementHash, first.previousRequirementHash, 'a declaration changes requirement content')
    assert.ok(first.auditFile, 'the change is attributable')
    assert.equal(first.audit.actor, 'human:local')
    assert.deepEqual(first.audit.modules, ['MOD-A', 'MOD-B'])

    // The written document really carries the relations for the normal loader.
    const loaded = loadRepo(root)
    const asset = loaded.assets.find(entry => entry.id === 'REQ-T-1')
    assert.deepEqual(
      asset.links.filter(link => link.type === 'allocated_to').map(link => link.target).sort(),
      ['MOD-A', 'MOD-B'],
    )
    assert.equal(asset.title, '声明测试需求', 'appending relations never rewrites the requirement body')

    // Declaring again is a no-op, not a second append.
    const second = applyAllocation({ root, requirementId: 'REQ-T-1', modules: ['MOD-A'], actor: 'human:local' })
    assert.equal(second.applied, false)
    assert.equal(second.idempotent, true)
    const text = readFileSync(join(root, 'requirements/req-t-1.sdoc'), 'utf8')
    assert.equal((text.match(/Type: allocated_to/g) ?? []).length, 2)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a stale requirement hash is refused instead of overwriting a concurrent edit', () => {
  const root = repo()
  try {
    assert.throws(
      () => applyAllocation({
        root,
        requirementId: 'REQ-T-1',
        modules: ['MOD-A'],
        actor: 'human:local',
        expectedRequirementHash: 'f'.repeat(64),
      }),
      error => error.code === 'requirement-changed' && error.status === 409,
    )
    assert.equal(readFileSync(join(root, 'requirements/req-t-1.sdoc'), 'utf8'), SDOC)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an unregistered module id is refused: a typo must not leave the gate blind', () => {
  const root = repo()
  try {
    assert.throws(
      () => planAllocation({ root, requirementId: 'REQ-T-1', modules: ['MOD-NOPE'] }),
      error => error.code === 'unknown-module',
    )
    assert.throws(
      () => applyAllocation({ root, requirementId: 'REQ-T-1', modules: ['MOD-NOPE'], actor: 'human:local' }),
      error => error.code === 'unknown-module',
    )
    assert.equal(readFileSync(join(root, 'requirements/req-t-1.sdoc'), 'utf8'), SDOC)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an unknown requirement is a 404, not a silent write', () => {
  const root = repo()
  try {
    assert.throws(
      () => planAllocation({ root, requirementId: 'REQ-NOPE', modules: ['MOD-A'] }),
      error => error.code === 'unknown-requirement' && error.status === 404,
    )
    assert.throws(
      () => applyAllocation({ root, requirementId: 'REQ-T-1', modules: ['MOD-A'] }),
      error => error.code === 'actor-required',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a declaration clears its own blocker without rewriting the frozen record', () => {
  const record = {
    schema: 'alm.architecture-record/v1',
    changed: true,
    enforced: true,
    blocking: true,
    undeclared: ['MOD-A', 'MOD-B'],
    moduleIds: ['MOD-A', 'MOD-B'],
    declaredNotChanged: [],
    reason: '实现改动了未声明模块：MOD-A、MOD-B',
    modules: [{ id: 'MOD-A' }, { id: 'MOD-B' }],
  }
  const before = reconcileArchitectureDeclarations({ architecture: record, declaredModules: [] })
  assert.equal(before.blocking, true)
  assert.deepEqual(before.undeclared, ['MOD-A', 'MOD-B'])

  const after = reconcileArchitectureDeclarations({ architecture: record, declaredModules: ['MOD-A', 'MOD-B'] })
  assert.equal(after.blocking, false, 'the gate must not outlive the declaration that satisfies it')
  assert.deepEqual(after.undeclared, [])
  assert.deepEqual(after.declaredNotChanged, [])
  assert.match(after.reason, /改动模块均已声明/)
  // The stored record itself is immutable history.
  assert.equal(record.blocking, true)
  assert.deepEqual(record.undeclared, ['MOD-A', 'MOD-B'])

  const partial = reconcileArchitectureDeclarations({ architecture: record, declaredModules: ['MOD-A'] })
  assert.equal(partial.blocking, true)
  assert.deepEqual(partial.undeclared, ['MOD-B'])
})

test('an unenforced registry never blocks and an empty record is null', () => {
  const record = { moduleIds: ['MOD-A'], undeclared: ['MOD-A'], enforced: false }
  assert.equal(reconcileArchitectureDeclarations({ architecture: record, declaredModules: [] }).blocking, false)
  assert.equal(reconcileArchitectureDeclarations({ architecture: null }), null)
  // A legacy record without moduleIds falls back to its frozen undeclared list.
  const legacy = reconcileArchitectureDeclarations({ architecture: { undeclared: ['MOD-A'] }, declaredModules: ['MOD-A'] })
  assert.equal(legacy.blocking, false)
})
