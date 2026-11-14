import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dirname } from 'node:path'
import { PREFLIGHT_SCHEMA, deriveAcceptanceCommand, runPreflight, startReadiness, stepMeta, writePreflightAudit } from '../preflight.mjs'

function repo(files = {}) {
  const root = mkdtempSync(join(tmpdir(), 'alm-preflight-'))
  for (const [name, content] of Object.entries(files)) {
    const file = join(root, name)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, content)
  }
  return root
}

function item(overrides = {}) {
  return {
    id: 'REQ-T-001',
    status: 'backlog',
    decision: { state: 'verified', label: '已验证', gaps: [], topGap: null },
    review: { stored: true, summary: { completed: 5, total: 5 } },
    acceptance: { registered: true, latest: { result: 'pass', current: true, file: '.alm/acceptance/REQ-T-001/abc.json', commands: 1 } },
    ...overrides,
  }
}

test('deriveAcceptanceCommand produces only requirement-scoped test files', () => {
  const root = repo({
    'package.json': JSON.stringify({ scripts: { test: 'node --test', ci: 'node --test && node bin/alm.mjs' } }),
    'pnpm-lock.yaml': '',
    'packages/demo/src/feature.mjs': 'export const feature = true\n',
    'packages/demo/test/feature.test.mjs': "import test from 'node:test'\ntest('feature', () => {})\n",
  })
  const derived = deriveAcceptanceCommand(root, { investigationEvidence: [{ path: 'packages/demo/src/feature.mjs' }] })
  assert.deepEqual(derived.command, ['node', '--test', 'packages/demo/test/feature.test.mjs'])
  assert.equal(derived.timeoutMs, 30000)
  assert.match(derived.reason, /精准定向/)
  assert.doesNotMatch(derived.command.join(' '), /pnpm test/)

  assert.equal(deriveAcceptanceCommand(repo({ 'package.json': JSON.stringify({ name: 'x' }) })), null)
  assert.equal(deriveAcceptanceCommand(repo()), null)
})

test('stepMeta falls back to checked for unknown statuses', () => {
  assert.equal(stepMeta('fixed').tone, 'ok')
  assert.equal(stepMeta('carry-over').tone, 'warn')
  assert.equal(stepMeta('nope').label, stepMeta('checked').label)
})

test('startReadiness separates start requirements from release evidence', () => {
  assert.equal(startReadiness(item({ status: 'archived' })).code, 'archived')
  assert.equal(startReadiness(item({ briefText: '   ' })).code, 'brief-missing')
  assert.equal(startReadiness(item({ workspace: { healthy: false } })).code, 'workspace-damaged')

  const unreviewed = startReadiness(item({ review: { stored: false }, acceptance: { registered: false, latest: null } }))
  assert.equal(unreviewed.ready, true)
  assert.deepEqual(unreviewed.carryOver.map(entry => entry.code), ['review-not-run', 'acceptance-missing', 'acceptance-not-run'])

  const ready = startReadiness(item())
  assert.equal(ready.ready, true)
  assert.equal(ready.code, 'ready')
  assert.deepEqual(ready.carryOver, [])

  const failing = startReadiness(item({ acceptance: { registered: true, latest: { result: 'fail', current: true, commands: 2, finishedAt: '2026-01-01T00:00:00.000Z' } } }))
  assert.equal(failing.ready, true)
  assert.equal(failing.carryOver[0].code, 'acceptance-failed')
  assert.equal(failing.carryOver[0].fix.length > 0, true)

  const stale = startReadiness(item({ acceptance: { registered: true, latest: { result: 'pass', current: false } } }))
  assert.equal(stale.carryOver[0].code, 'evidence-stale')

  const notRun = startReadiness(item({ acceptance: { registered: true, latest: null } }))
  assert.equal(notRun.carryOver[0].code, 'acceptance-not-run')
})

test('runPreflight registers a derived acceptance command without running it before development', async () => {
  const root = repo({ 'package.json': JSON.stringify({ scripts: { test: 'node --test' } }), 'pnpm-lock.yaml': '', 'packages/demo/src/feature.mjs': 'export const feature = true\n', 'packages/demo/test/feature.test.mjs': "import test from 'node:test'\ntest('feature', () => {})\n" })
  let itemState = item({
    decision: { state: 'acceptance-missing', label: '未登记验收命令', gaps: [{ code: 'acceptance-missing', message: '未登记验收命令' }], topGap: { code: 'acceptance-missing', message: '未登记验收命令' } },
    acceptance: { registered: false, latest: null },
    investigationEvidence: [{ path: 'packages/demo/src/feature.mjs' }],
  })
  const calls = []
  const deps = {
    inspect: () => ({ requirements: [itemState] }),
    runReview: () => calls.push('runReview'),
    readAiReview: () => null,
    generateAiReview: async () => null,
    adoptAiReview: () => ({}),
    applyAcceptanceConfig: (commands) => {
      calls.push(['applyAcceptanceConfig', commands])
      itemState = { ...itemState, acceptance: { registered: true, latest: null } }
    },
    runAcceptance: () => { throw new Error('must not execute acceptance before development') },
  }
  const record = await runPreflight({ root, requirementId: 'REQ-T-001', apply: true, deps })

  assert.equal(record.schema, PREFLIGHT_SCHEMA)
  assert.equal(record.applied, true)
  assert.deepEqual(record.steps.map((step) => step.code), ['review-check', 'acceptance-configure', 'acceptance-run'])
  assert.equal(record.steps[1].status, 'fixed')
  assert.match(record.steps[1].detail, /精准定向/)
  assert.equal(record.steps[2].status, 'carry-over')
  assert.equal(record.readiness.ready, true)
  assert.equal(record.carryOver[0].code, 'acceptance-not-run')
  assert.equal(record.question, null)
  assert.equal(calls.filter((entry) => entry === 'runAcceptance').length, 0)
  assert.deepEqual(calls.find((entry) => Array.isArray(entry))[1], [{ id: 'cmd-1', command: ['node', '--test', 'packages/demo/test/feature.test.mjs'], timeoutMs: 30000 }])
})

test('runPreflight replaces a legacy generic pnpm test binding with the targeted set', async () => {
  const root = repo({
    'packages/demo/src/feature.mjs': 'export const feature = true\n',
    'packages/demo/test/feature.test.mjs': "import test from 'node:test'\ntest('feature', () => {})\n",
  })
  let itemState = item({
    acceptance: { registered: true, commands: [{ id: 'cmd-1', command: ['pnpm', 'test'] }], latest: { result: 'fail', current: true } },
    investigationEvidence: [{ path: 'packages/demo/src/feature.mjs' }],
  })
  const updates = []
  const record = await runPreflight({ root, requirementId: 'REQ-T-001', apply: true, deps: {
    inspect: () => ({ requirements: [itemState] }),
    applyAcceptanceConfig: commands => {
      updates.push(commands)
      itemState = { ...itemState, acceptance: { registered: true, commands, latest: null } }
    },
  } })
  assert.deepEqual(updates, [[{ id: 'cmd-1', command: ['node', '--test', 'packages/demo/test/feature.test.mjs'], timeoutMs: 30000 }]])
  assert.equal(record.steps.find(step => step.code === 'acceptance-configure')?.status, 'fixed')
  assert.doesNotMatch(updates[0][0].command.join(' '), /pnpm test/)
})

test('runPreflight replaces an oversized fixed-budget binding instead of repeating its timeout', async () => {
  const root = repo({
    'packages/demo/src/feature.mjs': 'export const feature = true\n',
    'packages/demo/test/feature.test.mjs': "import test from 'node:test'\ntest('feature', () => {})\n",
  })
  const wide = Array.from({ length: 51 }, (_, index) => `packages/demo/test/feature-${index}.test.mjs`)
  let itemState = item({
    acceptance: { registered: true, commands: [{ id: 'cmd-1', command: ['node', '--test', ...wide], timeoutMs: 30000 }], latest: { result: 'fail', current: true } },
    investigationEvidence: [{ path: 'packages/demo/src/feature.mjs' }],
  })
  const updates = []
  await runPreflight({ root, requirementId: 'REQ-T-001', apply: true, deps: {
    inspect: () => ({ requirements: [itemState] }),
    applyAcceptanceConfig: commands => {
      updates.push(commands)
      itemState = { ...itemState, acceptance: { registered: true, commands, latest: null } }
    },
  } })
  assert.equal(updates.length, 1)
  assert.deepEqual(updates[0], [{ id: 'cmd-1', command: ['node', '--test', 'packages/demo/test/feature.test.mjs'], timeoutMs: 30000 }])
})

test('runPreflight carries a known failing run instead of re-running it', async () => {
  const root = repo({ 'package.json': JSON.stringify({ scripts: { test: 'node --test' } }) })
  const failing = item({
    decision: { state: 'failed', label: '执行失败', gaps: [{ code: 'acceptance-failed', message: '验收执行失败' }], topGap: { code: 'acceptance-failed', message: '验收执行失败' } },
    acceptance: { registered: true, latest: { result: 'fail', current: true, commands: 1, finishedAt: '2026-01-01T00:00:00.000Z', file: '.alm/acceptance/REQ-T-001/abc.json' } },
  })
  const deps = {
    inspect: () => ({ requirements: [failing] }),
    runReview: () => {},
    readAiReview: () => null,
    generateAiReview: async () => null,
    adoptAiReview: () => ({}),
    applyAcceptanceConfig: () => {},
    runAcceptance: () => {
      throw new Error('a known failing run must not execute again')
    },
  }
  const record = await runPreflight({ root, requirementId: 'REQ-T-001', apply: true, deps })
  assert.equal(record.steps.at(-1).code, 'acceptance-run')
  assert.equal(record.steps.at(-1).status, 'carry-over')
  assert.match(record.steps.at(-1).title, /沿用上次验收失败结果/)
  assert.equal(record.readiness.ready, true)
  assert.equal(record.question, null)
})

test('runPreflight starts an unreviewed requirement with a failed acceptance as development carry-over', async () => {
  const root = repo({ 'package.json': JSON.stringify({ scripts: { test: 'node --test' } }) })
  const unreviewed = item({
    decision: { state: 'failed', label: '执行失败', gaps: [{ code: 'acceptance-failed', message: '验收执行失败，不能视为通过' }], topGap: { code: 'acceptance-failed', message: '验收执行失败，不能视为通过' } },
    review: { stored: false },
    acceptance: { registered: true, latest: { result: 'fail', current: true, commands: 1, finishedAt: '2026-01-01T00:00:00.000Z', file: '.alm/acceptance/REQ-T-001/abc.json' } },
  })
  const record = await runPreflight({
    root,
    requirementId: 'REQ-T-001',
    apply: true,
    deps: {
      inspect: () => ({ requirements: [unreviewed] }),
      applyAcceptanceConfig: () => { throw new Error('already registered') },
      runAcceptance: () => { throw new Error('known failed acceptance must not rerun before development') },
    },
  })
  assert.equal(record.readiness.ready, true, JSON.stringify(record))
  assert.equal(record.question, null)
  assert.equal(record.steps.find(step => step.code === 'review-run')?.status, 'carry-over')
  assert.ok(record.carryOver.some(entry => entry.code === 'review-not-run'))
  assert.ok(record.carryOver.some(entry => entry.code === 'acceptance-failed'))
})

test('runPreflight carries an old review blocker into development and skips execution in preview mode', async () => {
  const root = repo({ 'package.json': JSON.stringify({ scripts: { test: 'node --test' } }) })
  const blocked = item({
    decision: { state: 'blocked', label: '评审阻塞', gaps: [{ code: 'review-blocked', message: '评审有 2 个阻塞项' }], topGap: { code: 'review-blocked', message: '评审有 2 个阻塞项' } },
  })
  const deps = {
    inspect: () => ({ requirements: [blocked] }),
    runReview: () => {},
    readAiReview: () => null,
    generateAiReview: async () => null,
    adoptAiReview: () => ({}),
    applyAcceptanceConfig: () => {},
    runAcceptance: () => {
      throw new Error('should not run in preview mode')
    },
  }
  const record = await runPreflight({ root, requirementId: 'REQ-T-001', apply: false, deps })
  assert.equal(record.readiness.ready, true)
  assert.equal(record.question, null)
  assert.equal(record.steps.some((step) => step.code === 'acceptance-run'), false)
})

test('runPreflight throws a typed error for an unknown requirement', async () => {
  const deps = { inspect: () => ({ requirements: [] }) }
  await assert.rejects(runPreflight({ root: tmpdir(), requirementId: 'REQ-NOPE', apply: true, deps }), (error) => {
    assert.equal(error.code, 'requirement-not-found')
    assert.equal(error.status, 404)
    return true
  })
})

test('writePreflightAudit records the run under .alm/preflight', () => {
  const root = repo()
  const record = { schema: PREFLIGHT_SCHEMA, requirementId: 'REQ-T-001', startedAt: '2026-01-01T00:00:00.000Z', steps: [] }
  const file = writePreflightAudit(root, record)
  assert.equal(existsSync(file), true)
  assert.equal(file.startsWith(join(root, '.alm', 'preflight', 'REQ-T-001')), true)
  const written = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(written.schema, PREFLIGHT_SCHEMA)
  assert.equal(written.requirementId, 'REQ-T-001')
})
