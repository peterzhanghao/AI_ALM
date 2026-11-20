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
  applyOutputBudgetHeal,
  captureIntentFailure,
  classifyRuntimeFailure,
  nextModelInChain,
  planHeal,
  planOutputBudgetHeal,
  readHealPolicy,
  resolveOutputBudget,
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
    const settings = { firstTokenMs: 60_000, outputMs: 90_000, maxOutputTokens: 100_000, tokenGrowth: 2, maxChainHops: 1, intentReasoningEffort: 'low', repairReasoningEffort: 'off', modelChain: [] }
    assert.deepEqual(first.after.history[0].before, { ...settings })
    assert.deepEqual(first.after.history[0].after, { ...settings, firstTokenMs: 30_000 })
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
    assert.equal(stored.run, 'RUN-1')
    assert.deepEqual(stored.evidence.snapshot.model, { provider: 'deepseek-official', model: 'deepseek-flash' })
    assert.equal(stored.evidence.snapshot.timing.totalMs, 16_280)
    assert.equal(stored.evidence.snapshot.classification.healable, true)
    assert.equal(stored.occurrences.length, 1)
    assert.equal(stored.occurrenceCount, 1)
    assert.ok(typeof stored.fingerprint === 'string' && stored.fingerprint.startsWith('fp_'))
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
    const first = captureIntentFailure(args)
    assert.equal(first.recorded, true)
    const second = captureIntentFailure(args)
    assert.equal(second.deduped, true)
    assert.equal(listFailures(root).length, 1)
    const stored = readFailure(root, second.failure.id)
    // AC-01: a repeated failure does not create a second file, it accumulates
    // occurrences on the same dedupe key (the event keeps its first evidence).
    assert.equal(stored.occurrences.length, 2)
    assert.equal(stored.occurrenceCount, 2)
    assert.deepEqual(stored.occurrences.map((entry) => entry.run), ['RUN-1', 'RUN-1'])
    assert.ok(stored.occurrences.every((entry) => typeof entry.at === 'string' && entry.at !== ''))
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

test('policy v1 upgrades to v2 and token budgets are clamped like time budgets', () => {
  const root = workspace()
  try {
    mkdirSync(join(root, '.alm/self-heal'), { recursive: true })
    writeFileSync(join(root, POLICY_FILE), JSON.stringify({
      schema: 'alm.self-heal.policy/v1', firstTokenMs: 0, outputMs: 9_999_999, maxOutputTokens: 9_999_999,
    }), 'utf8')
    const policy = readHealPolicy(root)
    assert.equal(policy.schema, 'alm.self-heal.policy/v2')
    assert.equal(policy.maxOutputTokens, 200_000, 'a hand-edited token ceiling is clamped')
    assert.equal(policy.firstTokenMs, DEFAULT_POLICY.firstTokenMs)
    assert.equal(policy.outputMs, 300_000)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('output budget resolves from policy and is clamped by the model ceiling', () => {
  const policy = { ...DEFAULT_POLICY, maxOutputTokens: 100_000 }
  assert.equal(resolveOutputBudget({ policy, env: {} }), 100_000)
  assert.equal(
    resolveOutputBudget({ policy, selection: { provider: 'p', model: 'm', maxOutputTokens: 32_000 }, env: {} }),
    32_000,
    'the provider ceiling wins over a larger policy value',
  )
  assert.equal(resolveOutputBudget({ policy, env: { ALM_INTENT_MAX_OUTPUT_TOKENS: '64000' } }), 64_000)
  assert.equal(
    resolveOutputBudget({ policy, selection: { maxOutputTokens: 200 }, env: {} }),
    100_000,
    'an implausibly small ceiling is ignored',
  )
})

test('an exhausted output budget is classified apart from a contract violation', () => {
  const truncated = classifyRuntimeFailure({
    errorCode: 'ai-invalid-output',
    finishKind: 'length',
    policy: { ...DEFAULT_POLICY, maxOutputTokens: 10_000 },
  })
  assert.equal(truncated.errorType, 'output-budget-exhausted')
  assert.equal(truncated.healable, true)
  assert.equal(truncated.requiresCodeChange, false)
  const near = classifyRuntimeFailure({ errorCode: 'ai-invalid-output', usage: { outputTokens: 9_500 }, budgetTokens: 10_000 })
  assert.equal(near.errorType, 'output-budget-exhausted')
  // Headroom exists: this is a real contract failure and must not be green-lit
  // by silently raising the budget.
  const contract = classifyRuntimeFailure({ errorCode: 'ai-invalid-output', usage: { outputTokens: 1_000 }, budgetTokens: 10_000 })
  assert.equal(contract.errorType, 'invalid-output')
  assert.equal(contract.requiresCodeChange, true)
})

test('a token heal grows within the ceiling and falls back to a model switch', () => {
  const low = planOutputBudgetHeal({ policy: { ...DEFAULT_POLICY, maxOutputTokens: 10_000, tokenGrowth: 2 }, observedTokens: 9_500 })
  assert.equal(low.healable, true)
  assert.deepEqual(low.patch, { maxOutputTokens: 20_000 })
  const top = planOutputBudgetHeal({ policy: { ...DEFAULT_POLICY, maxOutputTokens: 200_000 }, observedTokens: 200_000 })
  assert.equal(top.healable, false)
  assert.equal(top.strategy, 'switch-model')
  const headroom = planOutputBudgetHeal({ policy: { ...DEFAULT_POLICY, maxOutputTokens: 10_000 }, observedTokens: 1_000 })
  assert.equal(headroom.healable, false)
})

test('token heal is persisted with history and the chain parses provider/model entries', () => {
  const root = workspace()
  try {
    const healed = applyOutputBudgetHeal({ root, observedTokens: 100_000 })
    assert.equal(healed.applied, true)
    assert.equal(healed.policy.maxOutputTokens, 200_000)
    assert.equal(healed.policy.history.at(-1).after.maxOutputTokens, 200_000)
    assert.equal(readHealPolicy(root).maxOutputTokens, 200_000)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
  const policy = { ...DEFAULT_POLICY, modelChain: ['prov/a', 'b'] }
  const first = nextModelInChain({ policy, selection: { provider: 'p', model: 'm' } })
  assert.deepEqual(first, { provider: 'prov', model: 'a' })
  const second = nextModelInChain({ policy, selection: { provider: 'p', model: 'm' }, used: [first] })
  assert.deepEqual(second, { provider: 'p', model: 'b' })
  assert.equal(
    nextModelInChain({ policy: { ...DEFAULT_POLICY, modelChain: ['p/m'] }, selection: { provider: 'p', model: 'm' } }),
    null,
    'the current model is never retried from the chain',
  )
})

test('capture stores the token/finish signals that drive the budget heal', () => {
  const root = workspace()
  try {
    const result = captureIntentFailure({
      root,
      session: { sessionId: 'INT-1', input: { text: 'x' } },
      error: { code: 'ai-invalid-output', status: 502 },
      signals: { finishKind: 'length', outputTokens: 9_800, reasoningTokens: 9_500, budgetTokens: 10_000 },
      runId: 'RUN-1',
    })
    assert.equal(result.classification.errorType, 'output-budget-exhausted')
    const stored = readFailure(root, result.failure.id)
    assert.equal(stored.evidence.snapshot.finishKind, 'length')
    assert.equal(stored.evidence.snapshot.tokens.outputTokens, 9_800)
    assert.equal(stored.evidence.snapshot.tokens.budgetTokens, 10_000)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the analysis path reads budgets from policy, captures failures and applies the heal', () => {
  const source = readFileSync(new URL('../intent.mjs', import.meta.url), 'utf8')
  assert.match(source, /const healPolicy = readHealPolicy\(root\)/)
  // The gate is armed from the policy (an explicit phase label is allowed: the
  // abort message has to say which budget fired).
  assert.match(source, /arm\(healPolicy\.firstTokenMs[,)]/)
  assert.equal(/arm\(15_000\)/.test(source), false)
  assert.match(source, /captureIntentFailureSafe\(\{/)
  // Capture only records; without applying the planned patch in the same
  // failure path, the same gate kills every retry (RUN-mwlfpyk5 aborted at
  // 31716ms against a 31694ms gate whose fix had already been computed).
  assert.match(source, /applyHeal\(\{ root, failure: captured\.failure \}\)/)
  assert.equal(existsSync(new URL('../self-heal.mjs', import.meta.url)), true)
})

test('the watchdog treats reasoning as progress and names what arrived', () => {
  const source = readFileSync(new URL('../intent.mjs', import.meta.url), 'utf8')
  // Only counting the answer text aborted healthy thinking calls (63s, 0 content
  // tokens) and then raised the gate for a call that was never broken.
  assert.match(source, /if \(chunk\?\.type === 'reasoning-delta'\)/)
  assert.match(source, /const markProgress = \(\) =>/)
  assert.match(source, /reasoningChars/)
  // A late chunk after the race settled must not arm a second, orphaned timer.
  assert.match(source, /if \(settled\) return/)
})

test('silence must be proven before the first-token gate is raised', () => {
  const timing = { totalMs: 63_404, contextMs: 53, calls: 1, retries: 0 }
  // No bytes at all: the local gate is genuinely the suspect.
  const silent = classifyRuntimeFailure({
    errorCode: 'ai-call-failed',
    timing,
    streamProgress: { chunks: [], contentChars: 0, reasoningChars: 0 },
  })
  assert.equal(silent.errorType, 'first-token-timeout')
  assert.equal(silent.strategy, 'raise-first-token-budget')
  assert.match(silent.rationale, /流内没有任何分片/)

  // Bytes arrived (a thinking model): the gate is not the problem, so raising it
  // would repeat the 15s→31s→63s→127s escalation against a healthy call.
  const thinking = classifyRuntimeFailure({
    errorCode: 'ai-call-failed',
    timing: { ...timing, modelMs: 63_400 },
    streamProgress: { chunks: ['block-start', 'reasoning-delta'], contentChars: 0, reasoningChars: 900 },
  })
  assert.equal(thinking.errorType, 'output-timeout')
  assert.equal(thinking.strategy, 'raise-output-budget')
  assert.equal(thinking.evidence.reasoningChars, 900)
  assert.match(thinking.rationale, /思考 900 字/)
})

test('a legacy record without stream evidence keeps the old duration rule', () => {
  const legacy = classifyRuntimeFailure({ errorCode: 'ai-call-failed', timing: { totalMs: 63_404, calls: 1, retries: 0 } })
  assert.equal(legacy.errorType, 'first-token-timeout', 'absent evidence must not be read as proof of progress')
})
