/**
 * Runtime self-heal for the intent clarification path.
 *
 * The clarification pipeline had a closed loop with a hole: a failed model call
 * left a `runs[]` entry, then the request fell back to a keyword draft. Nothing
 * reached `.alm/failures`, so the plugin could neither explain the failure nor
 * repair it — the user had to copy the error into the main conversation.
 *
 * This module owns the missing half:
 *   capture  -> classify -> heal (policy only) -> verify (replay recorded runs)
 *
 * Two deliberate constraints:
 *
 * 1. Self-heal never edits source code. A failed call is almost always a budget
 *    or routing problem, so the repair is a policy change in
 *    `.alm/self-heal/policy.json` that the next analysis reads. Policy changes
 *    are versioned, reasoned and reversible; source edits made by a model are
 *    none of those things.
 * 2. Capture never throws. It runs inside the failure path of a request that is
 *    already failing, so a broken ledger must not turn a 502 into a crash.
 *
 * Provider faults stay `external` (see `failure.mjs`): an upstream 5xx is not our
 * defect. A call that *we* aborted because *our* budget was too small is.
 */
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { recordFailure, failureFingerprint } from '../alm-core/src/requirements/failure.mjs'

export const HEAL_POLICY_SCHEMA = 'alm.self-heal.policy/v1'
export const POLICY_FILE = '.alm/self-heal/policy.json'
export const SESSION_DIR = '.alm/intents/sessions'

/** Floor/ceiling guard so a bad patch can never produce an unusable budget. */
const MIN_BUDGET_MS = 5_000
const MAX_BUDGET_MS = 300_000
// Measured first-token latencies on deepseek-flash: 15.8s, 16.3s, 21.1s
// (RUN-mwj5o3nw) and 31.7s (RUN-mwlfpyk5) — the old 15s default sat below every
// successful first token, so a fresh workspace was guaranteed one failure
// before the heal loop could raise the gate. 60s is ~2x the worst observation
// and still catches a dead provider within a minute.
const DEFAULT_FIRST_TOKEN_MS = 60_000
const DEFAULT_OUTPUT_MS = 90_000

export const DEFAULT_POLICY = {
  schema: HEAL_POLICY_SCHEMA,
  firstTokenMs: DEFAULT_FIRST_TOKEN_MS,
  outputMs: DEFAULT_OUTPUT_MS,
  modelChain: [],
  revision: 1,
  updatedAt: null,
  updatedBy: null,
  history: [],
}

/* ------------------------------------------------------------------ */
/* atomic io                                                           */
/* ------------------------------------------------------------------ */

let tempCounter = 0

function writeJsonAtomic(absolute, value) {
  mkdirSync(dirname(absolute), { recursive: true })
  const temp = `${absolute}.tmp-${process.pid}-${Date.now()}-${++tempCounter}`
  try {
    writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    renameSync(temp, absolute)
  } finally {
    rmSync(temp, { force: true })
  }
}

function readJsonSafe(absolute) {
  try {
    return JSON.parse(readFileSync(absolute, 'utf8'))
  } catch {
    return null
  }
}

function resolveRoot(root) {
  return resolve(root ?? process.cwd())
}

function clampBudget(value, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return fallback
  return Math.min(MAX_BUDGET_MS, Math.max(MIN_BUDGET_MS, Math.round(number)))
}

/* ------------------------------------------------------------------ */
/* policy                                                              */
/* ------------------------------------------------------------------ */

/**
 * Read the heal policy; a missing or corrupt file yields the defaults.
 * Budgets are clamped on read as well as on write, so a hand-edited file cannot
 * disable the watchdog by writing `0`.
 */
export function readHealPolicy(root) {
  const repo = resolveRoot(root)
  const raw = readJsonSafe(join(repo, POLICY_FILE))
  if (!raw || raw.schema !== HEAL_POLICY_SCHEMA) return { ...DEFAULT_POLICY }
  return {
    ...DEFAULT_POLICY,
    ...raw,
    firstTokenMs: clampBudget(raw.firstTokenMs, DEFAULT_FIRST_TOKEN_MS),
    outputMs: clampBudget(raw.outputMs, DEFAULT_OUTPUT_MS),
    modelChain: Array.isArray(raw.modelChain) ? raw.modelChain.filter((entry) => typeof entry === 'string') : [],
    revision: Number.isInteger(raw.revision) && raw.revision > 0 ? raw.revision : 1,
    history: Array.isArray(raw.history) ? raw.history.slice(-50) : [],
  }
}

/**
 * Apply one policy patch. Every change records what it replaced, why, and who
 * asked: an unattributable budget change is indistinguishable from a typo.
 */
export function writeHealPolicy({ root, patch = {}, reason = null, actor = 'ai:self-heal', apply = true } = {}) {
  const repo = resolveRoot(root)
  const before = readHealPolicy(repo)
  const after = {
    ...before,
    ...patch,
    firstTokenMs: clampBudget(patch.firstTokenMs ?? before.firstTokenMs, before.firstTokenMs),
    outputMs: clampBudget(patch.outputMs ?? before.outputMs, before.outputMs),
    revision: before.revision + 1,
    updatedAt: new Date().toISOString(),
    updatedBy: String(actor),
  }
  const budgetChange =
    after.firstTokenMs !== before.firstTokenMs || after.outputMs !== before.outputMs
  after.history = [
    ...before.history,
    {
      at: after.updatedAt,
      actor: after.updatedBy,
      reason: reason === null || reason === undefined ? null : String(reason).slice(0, 500),
      before: { firstTokenMs: before.firstTokenMs, outputMs: before.outputMs },
      after: { firstTokenMs: after.firstTokenMs, outputMs: after.outputMs },
      changed: budgetChange,
    },
  ].slice(-50)
  if (apply === true) writeJsonAtomic(join(repo, POLICY_FILE), after)
  return { applied: apply === true, before, after, changed: budgetChange }
}

/* ------------------------------------------------------------------ */
/* classification                                                      */
/* ------------------------------------------------------------------ */

const CONFIG_CODES = new Set(['no-model', 'ai-model-unavailable', 'ai-unavailable'])

/**
 * Decide what kind of runtime failure this was, from the run's own timing.
 *
 * The run record is the evidence: `firstTokenMs` and `modelMs` are measured on
 * the server, so the phase that ran out of budget is knowable without guessing.
 *
 * - no `firstTokenMs`      -> the provider never started answering; our
 *                             first-token gate is the suspect.
 * - `modelMs` at the cap   -> the answer was still streaming when the output
 *                             budget expired.
 * - `ai-invalid-output`    -> the model answered but violated the contract;
 *                             no budget change can fix that.
 */
export function classifyRuntimeFailure({ errorCode = null, timing = null, policy = null, status = null } = {}) {
  const effective = policy ?? DEFAULT_POLICY
  const code = String(errorCode ?? '').trim()
  const t = timing && typeof timing === 'object' ? timing : {}
  const totalMs = Number.isFinite(t.totalMs) ? t.totalMs : null
  const firstTokenMs = Number.isFinite(t.firstTokenMs) ? t.firstTokenMs : null
  const modelMs = Number.isFinite(t.modelMs) ? t.modelMs : null

  if (code === 'ai-invalid-output') {
    return {
      errorType: 'invalid-output',
      kind: 'plugin-defect',
      healable: false,
      requiresCodeChange: true,
      strategy: 'prompt-contract-repair',
      rationale: '模型有输出但违反意图契约，预算调整无法修复，需要收紧提示或补齐校验',
      evidence: { code, status },
    }
  }
  if (CONFIG_CODES.has(code)) {
    return {
      errorType: 'configuration',
      kind: 'external',
      healable: false,
      requiresCodeChange: false,
      strategy: 'operator-action',
      rationale: '没有可用模型或鉴权失败，属于环境/配置问题，自愈不能也不该绕过',
      evidence: { code, status },
    }
  }
  // No first token means the answering phase never started. The duration only
  // sizes the repair: a sub-2s failure is a dead transport, not a tight gate —
  // historically this same signature appeared both at the old 8s cap and at the
  // later 15s gate, so the gate value must not decide the class.
  if (firstTokenMs === null && (totalMs === null || totalMs >= 2_000)) {
    return {
      errorType: 'first-token-timeout',
      kind: 'plugin-defect',
      healable: true,
      requiresCodeChange: false,
      strategy: 'raise-first-token-budget',
      rationale: `首 token 未到达即失败（实测 ${totalMs ?? '未知'}ms，当前闸门 ${effective.firstTokenMs}ms），判定为本机首 token 预算过紧`,
      evidence: { code, totalMs, firstTokenMs, budgetMs: effective.firstTokenMs },
    }
  }
  if (firstTokenMs !== null && modelMs !== null && modelMs >= Math.round(effective.outputMs * 0.9)) {
    return {
      errorType: 'output-timeout',
      kind: 'plugin-defect',
      healable: true,
      requiresCodeChange: false,
      strategy: 'raise-output-budget',
      rationale: `首 token 已到达（${firstTokenMs}ms），输出在 ${Math.round(effective.outputMs / 1000)}s 预算处被切断（实测 ${modelMs}ms）`,
      evidence: { code, totalMs, firstTokenMs, modelMs, budgetMs: effective.outputMs },
    }
  }
  return {
    errorType: 'transport-failure',
    kind: 'external',
    healable: false,
    requiresCodeChange: false,
    strategy: 'operator-action',
    rationale: '无法从运行记录判定是本机预算还是上游故障，按外部失败处理',
    evidence: { code, status, totalMs, firstTokenMs, modelMs },
  }
}

/* ------------------------------------------------------------------ */
/* capture                                                             */
/* ------------------------------------------------------------------ */

/**
 * Record one failed clarification run in the defect ledger.
 *
 * `kind` is declared explicitly so the monitor does not re-classify a 502 as an
 * upstream fault and skip it — that skip is exactly how 17 failed clarifications
 * stayed invisible.
 */
export function captureIntentFailure({
  root,
  session = null,
  error = {},
  timing = null,
  model = null,
  runId = null,
  policy = null,
  apply = true,
} = {}) {
  const repo = resolveRoot(root)
  const effective = policy ?? readHealPolicy(repo)
  const classification = classifyRuntimeFailure({
    errorCode: error?.code ?? null,
    timing,
    policy: effective,
    status: error?.status ?? null,
  })
  const sessionId = session?.sessionId ?? null
  const inputText = String(session?.input?.text ?? '').slice(0, 300)
  const result = recordFailure({
    root: repo,
    requirement: null,
    // Older sessions carry no run id; keying the event by session keeps two
    // different sessions from collapsing into one "same failure" record.
    run: runId ?? sessionId ?? null,
    stage: 'clarify',
    step: 'intent-analyze',
    error: { code: classification.errorType, message: error?.message ?? classification.rationale, status: error?.status ?? null },
    kind: classification.kind,
    component: 'dsh-plugin-requirements/intent',
    evidence: {
      logs: [
        `providerCode=${error?.code ?? '?'} status=${error?.status ?? '?'}`,
        `model=${model?.provider ?? '?'}/${model?.model ?? '?'} run=${runId ?? '?'}`,
        `policy=firstToken:${effective.firstTokenMs}ms output:${effective.outputMs}ms`,
        `reason=${classification.rationale}`,
      ],
      artifacts: sessionId ? [{ kind: 'intent-session', id: sessionId }] : [],
      snapshot: {
        sessionId,
        runId,
        inputHash: session?.input?.inputHash ?? null,
        inputExcerpt: inputText,
        timing: timing ?? null,
        classification: { errorType: classification.errorType, strategy: classification.strategy, healable: classification.healable },
      },
      testFileHashes: null,
    },
    context: { component: 'intent-clarify' },
    apply,
  })
  return {
    classification,
    recorded: result.created === true || result.deduped === true,
    deduped: result.deduped === true,
    failure: result.failure,
    fingerprint: failureFingerprint({
      requirement: null,
      stage: 'clarify',
      errorType: classification.errorType,
      component: 'intent-clarify',
    }),
  }
}

/** Never-throwing wrapper for the request path. */
export function captureIntentFailureSafe(args) {
  try {
    return captureIntentFailure(args)
  } catch (error) {
    return { recorded: false, error: String(error?.message ?? error) }
  }
}

/* ------------------------------------------------------------------ */
/* heal                                                                */
/* ------------------------------------------------------------------ */

/**
 * Turn one classified failure into a policy patch.
 *
 * Doubling the budget is intentionally conservative: the point is to clear the
 * measured interception point with margin, not to disable the watchdog.
 */
export function planHeal({ failure = null, policy = null } = {}) {
  const effective = policy ?? DEFAULT_POLICY
  const snapshot = failure?.evidence?.snapshot ?? {}
  const stored = snapshot.classification ?? null
  const classification = stored
    ? { ...stored, requiresCodeChange: stored.errorType === 'invalid-output' }
    : classifyRuntimeFailure({
        errorCode: failure?.errorType ?? null,
        timing: snapshot.timing ?? null,
        policy: effective,
      })
  if (!classification.healable) {
    return {
      strategy: classification.strategy,
      healable: false,
      requiresCodeChange: classification.requiresCodeChange === true,
      patch: null,
      rationale: classification.rationale,
      failureId: failure?.id ?? null,
    }
  }
  if (classification.errorType === 'first-token-timeout') {
    const observed = Number(snapshot.timing?.totalMs ?? 0)
    const next = clampBudget(Math.max(effective.firstTokenMs * 2, observed * 1.5), effective.firstTokenMs)
    return {
      strategy: 'raise-first-token-budget',
      healable: true,
      requiresCodeChange: false,
      patch: { firstTokenMs: next },
      rationale: `首 token 闸门 ${effective.firstTokenMs}ms 小于实测中断点 ${observed || '未知'}ms，提升到 ${next}ms`,
      failureId: failure?.id ?? null,
    }
  }
  if (classification.errorType === 'output-timeout') {
    const observed = Number(snapshot.timing?.modelMs ?? 0)
    const next = clampBudget(Math.max(effective.outputMs * 1.5, observed * 1.4), effective.outputMs)
    return {
      strategy: 'raise-output-budget',
      healable: true,
      requiresCodeChange: false,
      patch: { outputMs: next },
      rationale: `输出预算 ${effective.outputMs}ms 小于实测生成耗时 ${observed || '未知'}ms，提升到 ${next}ms`,
      failureId: failure?.id ?? null,
    }
  }
  return {
    strategy: classification.strategy,
    healable: false,
    requiresCodeChange: false,
    patch: null,
    rationale: classification.rationale,
    failureId: failure?.id ?? null,
  }
}

/**
 * Apply a heal. Only policy is touched; a failure whose repair needs a code
 * change returns `requiresCodeChange` instead of pretending to be fixed.
 * `policy` overrides the on-disk policy for planning — used by tests and by
 * callers that already hold a fresh read.
 */
export function applyHeal({ root, failure = null, policy = null, reason = null, actor = 'ai:self-heal', apply = true } = {}) {
  const repo = resolveRoot(root)
  const effective = policy ?? readHealPolicy(repo)
  const plan = planHeal({ failure, policy: effective })
  if (!plan.healable || !plan.patch) {
    return { applied: false, plan, policy: effective, requiresCodeChange: plan.requiresCodeChange }
  }
  const written = writeHealPolicy({
    root: repo,
    patch: plan.patch,
    reason: reason ?? plan.rationale,
    actor,
    apply,
  })
  return { applied: written.applied, plan, policy: written.after, before: written.before }
}

/* ------------------------------------------------------------------ */
/* verify                                                              */
/* ------------------------------------------------------------------ */

function listSessions(root) {
  const dir = join(root, SESSION_DIR)
  let names = []
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  const out = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const value = readJsonSafe(join(dir, name))
    if (value && typeof value === 'object' && value.sessionId) out.push(value)
  }
  return out
}

/**
 * Replay every recorded run against a candidate policy.
 *
 * This is the only honest verification available offline: it answers "would the
 * gate have aborted at the same point?" using the measured interception time,
 * instead of claiming a success that no one watched happen.
 *
 * A run is counted as `wouldNotAbort` when the new budget exceeds the duration
 * at which the old budget fired. It says nothing about whether the provider
 * would have answered — `latency` reports the observed successful first tokens
 * so a human can judge the margin.
 */
export function verifyHeal({ root, policy = null, sessions = null } = {}) {
  const repo = resolveRoot(root)
  const candidate = policy ?? readHealPolicy(repo)
  const all = Array.isArray(sessions) ? sessions : listSessions(repo)
  const timeoutRuns = []
  const successLatencies = []
  for (const session of all) {
    const runs = Array.isArray(session.runs) ? session.runs : []
    for (const run of runs) {
      const timing = run?.timing ?? {}
      if (run?.status === 'success') {
        if (Number.isFinite(timing.firstTokenMs)) successLatencies.push(timing.firstTokenMs)
        continue
      }
      if (!/ai-call-failed|ai-timeout/.test(String(run?.errorCode ?? ''))) continue
      if (!Number.isFinite(timing.totalMs)) continue
      timeoutRuns.push({
        sessionId: session.sessionId,
        runId: run.analysisRunId ?? null,
        errorCode: run.errorCode,
        totalMs: timing.totalMs,
        firstTokenMs: Number.isFinite(timing.firstTokenMs) ? timing.firstTokenMs : null,
        modelMs: Number.isFinite(timing.modelMs) ? timing.modelMs : null,
      })
    }
  }
  const firstTokenGate = timeoutRuns.filter((run) => run.firstTokenMs === null)
  const outputGate = timeoutRuns.filter((run) => run.firstTokenMs !== null)
  const wouldNotAbort = [
    ...firstTokenGate.filter((run) => candidate.firstTokenMs > run.totalMs),
    ...outputGate.filter((run) => candidate.outputMs > (run.modelMs ?? run.totalMs)),
  ]
  const stillAbort = timeoutRuns.filter((run) => !wouldNotAbort.includes(run))
  const p95 = successLatencies.length
    ? [...successLatencies].sort((a, b) => a - b)[Math.max(0, Math.ceil(successLatencies.length * 0.95) - 1)]
    : null
  return {
    schema: 'alm.self-heal.verification/v1',
    policy: { firstTokenMs: candidate.firstTokenMs, outputMs: candidate.outputMs, revision: candidate.revision },
    checkedSessions: all.length,
    timeoutRuns: timeoutRuns.length,
    wouldNotAbort: wouldNotAbort.length,
    wouldStillAbort: stillAbort.map((run) => ({ sessionId: run.sessionId, totalMs: run.totalMs, firstTokenMs: run.firstTokenMs })),
    latency: { samples: successLatencies.length, p95, max: successLatencies.length ? Math.max(...successLatencies) : null },
    marginOk: p95 === null ? null : candidate.firstTokenMs >= p95 * 2,
    verdict: timeoutRuns.length === 0
      ? 'no-timeout-runs'
      : wouldNotAbort.length === timeoutRuns.length ? 'healed' : wouldNotAbort.length > 0 ? 'partially-healed' : 'not-healed',
  }
}
