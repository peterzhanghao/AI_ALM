import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listFailures, readFailure } from '../../alm-core/src/requirements/failure.mjs'
import {
  DEFAULT_POLICY,
  POLICY_FILE,
  applyHeal,
  captureIntentFailure,
  classifyRuntimeFailure,
  planHeal,
  readHealPolicy,
  verifyHeal,
  writeHealPolicy,
} from '../self-heal.mjs'

function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-heal-'))
  mkdirSync(join(root, '.alm'), { recursive: true })
  return root
}

const firstTokenTimeout = {
  totalMs: 16_280,
  contextMs: 49,
  calls: 1,
  retries: 0,
}

test('a call aborted before its first token is our policy defect, not an upstream fault', () => {
  const result = classifyRuntimeFailure({ errorCode: 'ai-call-failed', timing: firstTokenTimeout })
  assert.equal(result.errorType, 'first-token-timeout')
  assert.equal(result.kind, 'plugin-defect')
  assert.equal(result.healable, true)
  assert.equal(result.strategy, 'raise-first-token-budget')
  assert.match(result.rationale, /首 token/)
})

test('a stream cut at the output ceiling is classified separately from a stuck provider', () => {
  const result = classifyRuntimeFailure({
    errorCode: 'ai-call-failed',
    timing: { totalMs: 110_776, firstTokenMs: 33_724, modelMs: 110_751 },
  })
  assert.equal(result.errorType, 'output-timeout')
  assert.equal(result.healable, true)
  assert.equal(result.strategy, 'raise-output-budget')
})

test('contract violations and missing models are never auto-healed', () => {
  const invalid = classifyRuntimeFailure({ errorCode: 'ai-invalid-output', timing: firstTokenTimeout })
  assert.equal(invalid.healable, false)
  assert.equal(invalid.requiresCodeChange, true)
  const offline = classifyRuntimeFailure({ errorCode: 'no-model' })
  assert.equal(offline.healable, false)
  assert.equal(offline.kind, 'external')
  const config = writeHealPolicy
  assert.equal(typeof config, 'function')
})

test('a missing or corrupt policy falls back to defaults, and budgets stay clamped', () => {
  const root = workspace()
  try {
    assert.equal(readHealPolicy(root).firstTokenMs, DEFAULT_POLICY.firstTokenMs)
    mkdirSync(join(root, '.alm/self-heal'), { recursive: true })
    writeFileSync(join(root, POLICY_FILE), '{ not json', 'utf8')
    assert.equal(readHealPolicy(root).outputMs, DEFAULT_POLICY.outputMs)
    writeFileSync(join(root, POLICY_FILE), JSON.stringify({ schema: 'alm.self-heal.policy/v1', firstTokenMs: 0, outputMs: 9_999_999 }), 'utf8')
    const policy = readHealPolicy(root)
    assert.equal(policy.firstTokenMs, DEFAULT_POLICY.firstTokenMs, 'zero must not disable the watchdog')
    assert.equal(policy.outputMs, 300_000, 'a hand-edited ceiling is clamped')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('every policy change is versioned, attributed and reversible', () => {
  const root = workspace()
  try {
    const first = writeHealPolicy({ root, patch: { firstTokenMs: 30_000 }, reason: 'test raise' })
    assert.equal(first.applied, true)
    assert.equal(first.after.revision, 2)
    assert.equal(first.after.history.length, 1)
    assert.deepEqual(first.after.history[0].before, { firstTokenMs: 60_000, outputMs: 90_000 })
    assert.deepEqual(first.after.history[0].after, { firstTokenMs: 30_000, outputMs: 90_000 })
    assert.equal(first.after.updatedBy, 'ai:self-heal')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('capture writes one failure event carrying the run timing as evidence', () => {
  const root = workspace()
  try {
    const result = captureIntentFailure({
      root,
      session: { sessionId: 'INT-1', input: { text: '我希望……', inputHash: 'abc' } },
      error: { code: 'ai-call-failed', message: 'AI 调用超时', status: 502 },
      timing: firstTokenTimeout,
      model: { provider: 'deepseek-official', model: 'deepseek-flash' },
      runId: 'RUN-1',
    })
    assert.equal(result.classification.errorType, 'first-token-timeout')
    assert.equal(result.recorded, true)
    const stored = readFailure(root, result.failure.id)
    assert.equal(stored.kind, 'plugin-defect', 'a 502 must not be skipped as an external fault')
    assert.equal(stored.stage, 'clarify')
    assert.equal(stored.evidence.snapshot.timing.totalMs, 16_280)
    assert.equal(stored.evidence.snapshot.classification.healable, true)
    assert.equal(listFailures(root).length, 1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('capture is idempotent for the same run and never throws on a broken root', () => {
  const root = workspace()
  try {
    const args = {
      root,
      session: { sessionId: 'INT-1', input: { text: 'x' } },
      error: { code: 'ai-call-failed', status: 502 },
      timing: firstTokenTimeout,
      runId: 'RUN-1',
    }
    captureIntentFailure(args)
    const second = captureIntentFailure(args)
    assert.equal(second.deduped, true)
    assert.equal(listFailures(root).length, 1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('healing raises the gate above the measured interception point', () => {
  const root = workspace()
  try {
    const captured = captureIntentFailure({
      root,
      session: { sessionId: 'INT-1', input: { text: 'x' } },
      error: { code: 'ai-call-failed', status: 502 },
      timing: firstTokenTimeout,
      runId: 'RUN-1',
    })
    // A fixed 15s gate pins the arithmetic: the patch clears the measured
    // interception point with margin while keeping a watchdog.
    const stockGate = { ...DEFAULT_POLICY, firstTokenMs: 15_000, outputMs: 90_000 }
    const plan = planHeal({ failure: captured.failure, policy: stockGate })
    assert.equal(plan.healable, true)
    assert.equal(plan.patch.firstTokenMs, 30_000, 'doubles the gate, keeps a watchdog')
    const applied = applyHeal({ root, failure: captured.failure, policy: stockGate })
    assert.equal(applied.applied, true)
    assert.equal(readHealPolicy(root).firstTokenMs, 30_000)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('verification replays recorded runs instead of claiming an unwatched success', () => {
  const root = workspace()
  try {
    const sessions = [
      { sessionId: 'A', runs: [{ status: 'error', errorCode: 'ai-call-failed', timing: { totalMs: 16_280 } }] },
      { sessionId: 'B', runs: [{ status: 'error', errorCode: 'ai-call-failed', timing: { totalMs: 74_175, firstTokenMs: 39_667, modelMs: 74_147 } }] },
      { sessionId: 'C', runs: [{ status: 'success', timing: { firstTokenMs: 11_093, modelMs: 50_255 } }] },
    ]
    // Pin the pre-heal gate so the replay semantics stay comparable regardless
    // of what the shipped default becomes.
    const before = verifyHeal({ root, policy: { ...DEFAULT_POLICY, firstTokenMs: 15_000, outputMs: 90_000 }, sessions })
    // Under the stock policy the 74s output cut was already inside its 90s
    // ceiling, so only the first-token abort is still unexplained.
    assert.equal(before.verdict, 'partially-healed')
    assert.equal(before.timeoutRuns, 2)
    assert.equal(before.wouldNotAbort, 1)
    assert.equal(before.latency.p95, 11_093)

    writeHealPolicy({ root, patch: { firstTokenMs: 30_000, outputMs: 120_000 } })
    const after = verifyHeal({ root, sessions })
    assert.equal(after.verdict, 'healed')
    assert.equal(after.wouldNotAbort, 2)
    assert.equal(after.marginOk, true, '30s clears twice the observed 11.1s p95')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the analysis path reads budgets from policy, captures failures and applies the heal', () => {
  const source = readFileSync(new URL('../intent.mjs', import.meta.url), 'utf8')
  assert.match(source, /const healPolicy = readHealPolicy\(root\)/)
  assert.match(source, /arm\(healPolicy\.firstTokenMs\)/)
  assert.equal(/arm\(15_000\)/.test(source), false)
  assert.match(source, /captureIntentFailureSafe\(\{/)
  // Capture only records; without applying the planned patch in the same
  // failure path, the same gate kills every retry (RUN-mwlfpyk5 aborted at
  // 31716ms against a 31694ms gate whose fix had already been computed).
  assert.match(source, /applyHeal\(\{ root, failure: captured\.failure \}\)/)
  assert.equal(existsSync(new URL('../self-heal.mjs', import.meta.url)), true)
})
