import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  architectureImpactTrailer,
  declaredModulesOf,
  detectArchitectureImpact,
  isArchitectureNeutral,
  loadModuleRegistry,
  moduleIdForPath,
  resolveModuleIds,
  verificationPathsFor,
} from '../../src/requirements/architecture-impact.mjs'

function registryRoot(modules) {
  const root = mkdtempSync(join(tmpdir(), 'alm-registry-'))
  mkdirSync(join(root, 'architecture'), { recursive: true })
  for (const [name, body] of Object.entries(modules)) {
    writeFileSync(join(root, 'architecture', `${name}.yml`), body)
  }
  return root
}

const PARENT = `schema_version: 1
id: MOD-PKG
type: module
title: 聚合包
role: 父级包
paths:
  - packages/
entries:
  - packages/index.js
tests:
  - packages/test/parent.test.mjs
`

const CHILD = `schema_version: 1
id: MOD-PKG-CHILD
type: module
title: 子模块
role: 子模块
paths:
  - packages/child/
entries:
  - packages/child/index.js
tests:
  - packages/child/test/child.test.mjs
`

test('a missing registry disables enforcement instead of failing', () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-noregistry-'))
  const registry = loadModuleRegistry(root)
  assert.equal(registry.enforced, false)
  const impact = detectArchitectureImpact({ root, changedPaths: ['packages/a/index.js'], declaredModules: [], registry })
  assert.equal(impact.enforced, false)
  assert.equal(impact.blocking, false)
  assert.equal(impact.changed, false)
})

test('invalid module entries are reported, never silently dropped', () => {
  const root = registryRoot({
    bad: `id: not-a-module\ntype: module\npaths:\n  - packages/x/\n`,
    nopaths: `id: MOD-EMPTY\ntype: module\n`,
  })
  const registry = loadModuleRegistry(root)
  assert.equal(registry.modules.length, 0)
  assert.equal(registry.errors.length, 2)
  assert.ok(registry.errors.every((entry) => entry.file.startsWith('architecture/')))
})

test('module attribution uses the longest matching prefix', () => {
  const root = registryRoot({ parent: PARENT, child: CHILD })
  const registry = loadModuleRegistry(root)
  assert.equal(moduleIdForPath('packages/child/index.js', registry), 'MOD-PKG-CHILD')
  assert.equal(moduleIdForPath('packages/other/index.js', registry), 'MOD-PKG')
  assert.deepEqual(resolveModuleIds(['packages/child/a.js', 'packages/child/b.js'], registry), ['MOD-PKG-CHILD'])
})

test('tests, bundles, requirement assets and docs never move architecture', () => {
  for (const path of [
    'packages/child/test/child.test.mjs',
    'packages/child/client.js',
    'packages/child/host.bundle.js',
    'requirements/req-1.sdoc',
    '.alm/runs/RUN-1.json',
    'architecture/MOD-PKG.yml',
    'docs/design.md',
    'fixtures/demo/index.js',
  ]) {
    assert.equal(isArchitectureNeutral(path), true, `${path} 应视为架构中立`)
  }
  assert.equal(isArchitectureNeutral('packages/child/index.js'), false)
})

test('a change to an undeclared module blocks the delivery', () => {
  const root = registryRoot({ parent: PARENT, child: CHILD })
  const registry = loadModuleRegistry(root)
  const impact = detectArchitectureImpact({
    root,
    changedPaths: ['packages/child/index.js', 'packages/child/test/child.test.mjs'],
    declaredModules: ['MOD-PKG'],
    registry,
  })
  assert.equal(impact.enforced, true)
  assert.equal(impact.changed, true)
  assert.deepEqual(impact.moduleIds, ['MOD-PKG-CHILD'])
  assert.deepEqual(impact.undeclared, ['MOD-PKG-CHILD'])
  assert.equal(impact.blocking, true)
  // The test file is neutral, so it is reported as ignored rather than as impact.
  assert.deepEqual(impact.ignored, ['packages/child/test/child.test.mjs'])
  assert.match(impact.reason, /未声明模块：MOD-PKG-CHILD/)
})

test('a declared module that did not change is a warning, not a block', () => {
  const root = registryRoot({ parent: PARENT, child: CHILD })
  const registry = loadModuleRegistry(root)
  const impact = detectArchitectureImpact({
    root,
    changedPaths: ['packages/child/index.js'],
    declaredModules: ['MOD-PKG-CHILD', 'MOD-PKG'],
    registry,
  })
  assert.equal(impact.blocking, false)
  assert.deepEqual(impact.declaredNotChanged, ['MOD-PKG'])
  assert.match(impact.reason, /不影响交付/)
  assert.equal(architectureImpactTrailer(impact), 'Architecture-Impact: MOD-PKG-CHILD')
})

test('a neutral-only change is not an architecture impact', () => {
  const root = registryRoot({ parent: PARENT })
  const registry = loadModuleRegistry(root)
  const impact = detectArchitectureImpact({ root, changedPaths: ['requirements/req-1.sdoc'], declaredModules: [], registry })
  assert.equal(impact.changed, false)
  assert.equal(impact.blocking, false)
  assert.equal(architectureImpactTrailer(impact), 'Architecture-Impact: none')
  assert.match(impact.reason, /未触及任何已登记模块/)
})

test('verification scope comes from the module table and stays capped', () => {
  const root = registryRoot({ parent: PARENT, child: CHILD })
  const registry = loadModuleRegistry(root)
  assert.deepEqual(verificationPathsFor(['MOD-PKG-CHILD', 'MOD-PKG'], registry), [
    'packages/child/test/child.test.mjs',
    'packages/test/parent.test.mjs',
  ])
  assert.equal(verificationPathsFor(['MOD-PKG'], registry, { limit: 0 }).length, 0)
})

test('declared modules come from allocated_to relations only', () => {
  const asset = {
    links: [
      { type: 'allocated_to', target: 'MOD-A' },
      { type: 'verified_by', target: 'TEST-1' },
      { type: 'allocated_to', target: 'MOD-A' },
      { type: 'allocated_to', target: 'MOD-B' },
    ],
  }
  assert.deepEqual(declaredModulesOf(asset), ['MOD-A', 'MOD-B'])
  assert.deepEqual(declaredModulesOf({}), [])
})
