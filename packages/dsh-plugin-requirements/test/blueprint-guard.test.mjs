import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { runPreflight } from '../preflight.mjs'
import { applyAcceptanceConfig, runAcceptance } from '../../alm-core/src/acceptance/acceptance.mjs'
import { MAX_VERIFICATION_TEST_FILES, createBlueprint, createScopeDecision, approveBlueprintExpansion, deriveVerificationCommand, inspectBlueprintScope, readBlueprint, verificationBudget, verificationCommandDiagnosis, writeBlueprint } from '../../alm-core/src/requirements/blueprint-guard.mjs'
import { worktreeSnapshot } from '../../alm-core/src/requirements/worktree-snapshot.mjs'
import { createCandidate } from '../../alm-core/src/requirements/candidate.mjs'

function write(root, path, text) {
  const file = join(root, path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
}

function git(root, ...args) {
  execFileSync('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=test', ...args], { cwd: root, stdio: 'ignore' })
}

function repo() {
  const root = mkdtempSync(join(tmpdir(), 'alm-blueprint-'))
  write(root, 'packages/demo/src/feature.mjs', 'export const feature = true\n')
  write(root, 'packages/demo/test/feature.test.mjs', "import test from 'node:test'\ntest('feature', () => {})\n")
  write(root, 'packages/demo/src/other.mjs', 'export const other = true\n')
  write(root, 'package.json', JSON.stringify({ scripts: { test: 'node --test packages/demo/test/feature.test.mjs' } }, null, 2) + '\n')
  write(root, 'requirements/req-demo-001.sdoc', '[DOCUMENT]\nTITLE: Demo\n\n[REQUIREMENT]\nUID: REQ-DEMO-001\nTITLE: Demo\nBRIEF: requirements/briefs/REQ-DEMO-001.md\n')
  write(root, 'requirements/briefs/REQ-DEMO-001.md', '# 需求\n\n## 验收标准\n- AC-01：功能可验证\n')
  git(root, 'init'); git(root, 'add', '.'); git(root, 'commit', '-m', 'fixture')
  return root
}

test('preflight registers a precise multi-file test set and start blueprint locks its evidence scope', async () => {
  const root = repo()
  try {
    let state = { id: 'REQ-DEMO-001', file: 'requirements/req-demo-001.sdoc', investigationEvidence: [{ path: 'packages/demo/src/feature.mjs' }], acceptance: { registered: false, latest: null }, decision: { state: 'unchecked', gaps: [] } }
    let commands = null
    const record = await runPreflight({ root, requirementId: state.id, apply: true, deps: {
      inspect: () => ({ requirements: [state] }),
      applyAcceptanceConfig: value => { commands = value; state = { ...state, acceptance: { registered: true, latest: null } } },
      runAcceptance: () => ({ result: 'pass', evidence: { result: 'pass', commands: [] } }),
    } })
    assert.equal(record.readiness.ready, true)
    assert.deepEqual(commands, [{ id: 'cmd-1', command: ['node', '--test', 'packages/demo/test/feature.test.mjs'], timeoutMs: 30000 }])
    const baseline = worktreeSnapshot(root)
    const blueprint = createBlueprint({ root, runId: 'RUN-001', requirementId: state.id, asset: { source: { path: state.file }, extra: { brief: 'requirements/briefs/REQ-DEMO-001.md' }, doc: { acceptance: [{ id: 'AC-01', text: '功能可验证' }] } }, investigationEvidence: [...state.investigationEvidence, { path: 'packages/demo/test/feature.test.mjs' }], acceptance: { commands }, baseline })
    writeBlueprint(root, blueprint)
    assert.equal(readBlueprint(root, 'RUN-001').acVerificationMap[0].id, 'AC-01')
    assert.ok(blueprint.allowedPaths.includes('packages/demo/src/feature.mjs'))
    assert.ok(blueprint.allowedPaths.includes('packages/demo/test/feature.test.mjs'))
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('workspace implementation authorization keeps normal source, tests and bundles advisory', () => {
  const root = repo()
  try {
    const blueprint = createBlueprint({ root, runId: 'RUN-001', requirementId: 'REQ-DEMO-001', investigationEvidence: [{ path: 'packages/demo/src/feature.mjs' }], acceptance: { commands: [] }, baseline: worktreeSnapshot(root) })
    writeBlueprint(root, blueprint)
    write(root, 'packages/demo/src/other.mjs', 'export const other = false\n')
    write(root, 'packages/demo/test/other.test.mjs', "import test from 'node:test'\ntest('other', () => {})\n")
    write(root, 'packages/dsh-plugin-requirements/client.js', 'bundle\n')
    write(root, 'packages/dsh-plugin-requirements/host.bundle.js', 'host bundle\n')
    write(root, '.alm/runs/RUN-001-note.json', '{}\n')
    const inspection = inspectBlueprintScope({ blueprint, snapshot: worktreeSnapshot(root) })
    assert.equal(blueprint.scopeMode, 'advisory')
    assert.equal(blueprint.authorization.mode, 'workspace-implementation')
    assert.equal(inspection.advisory, true)
    assert.equal(inspection.ok, true)
    assert.deepEqual(inspection.outOfScope, [])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('exchange evidence expands to its explicit HTTP and dialog test set, never a package suite', () => {
  const root = repo()
  try {
    write(root, 'packages/demo/src/exchange.mjs', 'export const exchange = true\n')
    write(root, 'packages/demo/test/exchange-http.test.mjs', "import test from 'node:test'\ntest('http', () => {})\n")
    write(root, 'packages/demo/test/exchange-ui.test.mjs', "import test from 'node:test'\ntest('dialog', () => {})\n")
    write(root, 'packages/demo/test/intent-http.test.mjs', "import test from 'node:test'\ntest('intent', () => {})\n")
    write(root, 'packages/demo/test/clarification-ui.test.mjs', "import test from 'node:test'\ntest('clarification', () => {})\n")
    const derived = deriveVerificationCommand({ root, investigationEvidence: [{ path: 'packages/demo/src/exchange.mjs' }] })
    assert.deepEqual(derived.command, ['node', '--test',
      'packages/demo/test/clarification-ui.test.mjs',
      'packages/demo/test/exchange-http.test.mjs',
      'packages/demo/test/exchange-ui.test.mjs',
      'packages/demo/test/intent-http.test.mjs',
    ])
    assert.doesNotMatch(derived.command.join(' '), /pnpm test/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('generated verification is capped and its timeout follows the selected file count', () => {
  const root = repo()
  try {
    write(root, 'packages/demo/src/exchange.mjs', 'export const exchange = true\n')
    for (let index = 0; index < 12; index += 1) {
      write(root, `packages/demo/test/exchange-extra-${String(index).padStart(2, '0')}.test.mjs`, "import test from 'node:test'\ntest('extra', () => {})\n")
    }
    const derived = deriveVerificationCommand({ root, investigationEvidence: [{ path: 'packages/demo/src/exchange.mjs' }] })
    assert.equal(derived.testFiles.length, MAX_VERIFICATION_TEST_FILES)
    assert.equal(derived.command.slice(2).length, MAX_VERIFICATION_TEST_FILES)
    assert.equal(derived.timeoutMs, verificationBudget(MAX_VERIFICATION_TEST_FILES))
    assert.ok(derived.timeoutMs > 30000)
    assert.equal(derived.omittedCount, 4)
    assert.match(derived.reason, /已裁剪/)
    assert.equal(verificationBudget(1), 30000)
    assert.equal(verificationBudget(51), 180000)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('an oversized fixed-budget command is diagnosed as re-derivable', () => {
  const command = ['node', '--test', ...Array.from({ length: 51 }, (_, index) => `packages/demo/test/case-${index}.test.mjs`)]
  const diagnosis = verificationCommandDiagnosis(command, 30000)
  assert.equal(diagnosis.fileCount, 51)
  assert.equal(diagnosis.oversized, true)
  assert.equal(diagnosis.underBudget, true)
  assert.equal(verificationCommandDiagnosis(['node', '--test', 'a.test.mjs'], 30000).oversized, false)
  assert.equal(verificationCommandDiagnosis(['node', '--test', 'a.test.mjs'], undefined).underBudget, false)
  assert.equal(verificationCommandDiagnosis(['node', '-e', 'process.exit(0)'], 1000).fileCount, 0)
})

test('tampering with a locked test fails acceptance despite a zero exit code', () => {
  const root = repo()
  try {
    applyAcceptanceConfig({ root, requirementId: 'REQ-DEMO-001', commands: [{ id: 'cmd-1', command: ['node', '--test', 'packages/demo/test/feature.test.mjs'] }] })
    const result = runAcceptance({ root, requirementId: 'REQ-DEMO-001', apply: true, exec: () => {
      write(root, 'packages/demo/test/feature.test.mjs', "import test from 'node:test'\ntest('weakened', () => {})\n")
      return { status: 0, stdout: 'ok', stderr: '' }
    } })
    assert.equal(result.result, 'fail')
    assert.equal(result.evidence.failure.code, 'tampered_test')
    assert.deepEqual(result.evidence.failure.files, ['packages/demo/test/feature.test.mjs'])
    assert.throws(() => createCandidate({
      root,
      asset: { id: 'REQ-DEMO-001', type: 'requirement', title: 'Demo', status: 'open', owner: null, extra: { brief: 'requirements/briefs/REQ-DEMO-001.md' }, links: [], source: { path: 'requirements/req-demo-001.sdoc' } },
      acceptance: { latest: { file: result.evidencePath } },
    }), error => error.code === 'tampered-test')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
