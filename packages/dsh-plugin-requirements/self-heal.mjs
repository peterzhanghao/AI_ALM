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
 *    `.alm/self-heal/policy.json` that the next analysis reads: time gates
 *    (`firstTokenMs`, `outputMs`), the output-token budget
 *    (`maxOutputTokens`, clamped by the model ceiling) and the fallback
 *    `modelChain`. Policy changes are versioned, reasoned and reversible;
 *    source edits made by a model are none of those things.
 * 2. Capture never throws. It runs inside the failure path of a request that is
 *    already failing, so a broken ledger must not turn a 502 into a crash.
 *
 * Provider faults stay `external` (see `failure.mjs`): an upstream 5xx is not our
 * defect. A call that *we* aborted because *our* budget was too small is.
 */
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { recordFailure, failureFingerprint } from '../alm-core/src/requirements/failure.mjs'

export const HEAL_POLICY_SCHEMA = 'alm.self-heal.policy/v2'
export const LEGACY_POLICY_SCHEMAS = ['alm.self-heal.policy/v1', HEAL_POLICY_SCHEMA]
export const POLICY_FILE = '.alm/self-heal/policy.json'
export const SESSION_DIR = '.alm/intents/sessions'

/** Floor/ceiling guard so a bad patch can never produce an unusable budget. */
const MIN_BUDGET_MS = 5_000
const MAX_BUDGET_MS = 300_000
const MIN_OUTPUT_TOKENS = 1_000
const MAX_OUTPUT_TOKENS = 200_000
// Measured first-token latencies on deepseek-flash: 15.8s, 16.3s, 21.1s
// (RUN-mwj5o3nw) and 31.7s (RUN-mwlfpyk5) — the old 15s default sat below every
// successful first token, so a fresh workspace was guaranteed one failure
// before the heal loop could raise the gate. 60s is ~2x the worst observation
// and still catches a dead provider within a minute.
const DEFAULT_FIRST_TOKEN_MS = 60_000
const DEFAULT_OUTPUT_MS = 90_000
// Token budget belongs to the same policy as the time budgets: reasoning and
// the JSON answer share one output pool, so this is the parameter a
// budget-exhausted failure may raise. 100k matches the shipped intent call;
// `resolveOutputBudget` clamps it to a provider/model ceiling when one is known.
const DEFAULT_MAX_OUTPUT_TOKENS = 100_000
const DEFAULT_TOKEN_GROWTH = 2
const DEFAULT_MAX_CHAIN_HOPS = 1
// The thinking budget is the parameter that decides whether the answer fits at
// all: the host's reasoning models default to effort `high`, a profile may set
// `max`, and the thinking and the JSON answer share one output pool. Clamping
// the intent call to a bounded level is what keeps a global "max thinking"
// default from spending the whole answer budget on thought; `null` disables the
// clamp (inherit whatever the model selection says).
const DEFAULT_INTENT_REASONING_EFFORT = 'low'
// Fallback used only after a truncation survived the clamp.
const DEFAULT_REPAIR_REASONING_EFFORT = 'off'
const REASONING_EFFORTS = new Set(['off', 'low', 'high', 'max'])

/**
 * Per-model hard output ceilings, keyed as `provider/model` or bare `model`.
 * Kept as data so a newly measured provider limit is a one-line change instead
 * of another code path. Unknown models are not clamped (the policy value is the
 * best available number); a host may pass `selection.maxOutputTokens` instead.
 */
export const MODEL_OUTPUT_LIMITS = {}

export const DEFAULT_POLICY = {
  schema: HEAL_POLICY_SCHEMA,
  firstTokenMs: DEFAULT_FIRST_TOKEN_MS,
  outputMs: DEFAULT_OUTPUT_MS,
  maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
  tokenGrowth: DEFAULT_TOKEN_GROWTH,
  maxChainHops: DEFAULT_MAX_CHAIN_HOPS,
  intentReasoningEffort: DEFAULT_INTENT_REASONING_EFFORT,
  repairReasoningEffort: DEFAULT_REPAIR_REASONING_EFFORT,
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

/** Token budgets are integers; a hand-edited 0 must not disable the model call. */
export function clampTokenBudget(value, fallback = DEFAULT_MAX_OUTPUT_TOKENS) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return fallback
  return Math.min(MAX_OUTPUT_TOKENS, Math.max(MIN_OUTPUT_TOKENS, Math.round(number)))
}

function clampGrowth(value, fallback = DEFAULT_TOKEN_GROWTH) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 1.1) return fallback
  return Math.min(4, number)
}

function clampHops(value, fallback = DEFAULT_MAX_CHAIN_HOPS) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < 0) return fallback
  return Math.min(3, number)
}

/**
 * One reasoning effort id, or `null` to leave the caller's choice untouched.
 * Unknown values fall back instead of being forwarded: the host rejects an
 * unsupported effort before any provider I/O, so a typo would look like a dead
 * model rather than a bad setting.
 */
function clampReasoningEffort(value, fallback = DEFAULT_REPAIR_REASONING_EFFORT) {
  if (value === null) return null
  if (value === undefined) return fallback
  const text = String(value).trim().toLowerCase()
  if (text === '' || text === 'default' || text === 'inherit' || text === 'none') return null
  return REASONING_EFFORTS.has(text) ? text : fallback
}

function positiveLimit(value) {
  const number = Number(value)
  return Number.isFinite(number) && number >= MIN_OUTPUT_TOKENS ? Math.round(number) : null
}

/**
 * Resolve the model's own output ceiling. A host that knows the provider limit
 * may pass it on the selection; an operator may override it for one machine via
 * env. Unknown stays unknown: the policy value is then authoritative.
 */
export function modelOutputCeiling({ selection = null, env = process.env } = {}) {
  const fromSelection = positiveLimit(
    selection?.maxOutputTokens ?? selection?.maxOutput ?? selection?.modelInfo?.maxOutputTokens ?? selection?.limits?.maxOutputTokens,
  )
  if (fromSelection !== null) return fromSelection
  const fromEnv = positiveLimit(env?.ALM_INTENT_MAX_OUTPUT_TOKENS ?? env?.ALM_MODEL_MAX_OUTPUT_TOKENS)
  if (fromEnv !== null) return fromEnv
  const provider = selection?.provider ? String(selection.provider) : ''
  const model = selection?.model ? String(selection.model) : ''
  for (const key of [`${provider}/${model}`, model]) {
    if (!key) continue
    const limit = positiveLimit(MODEL_OUTPUT_LIMITS[key])
    if (limit !== null) return limit
  }
  return null
}

/** The token budget a request may actually use: policy value clamped by the model. */
export function resolveOutputBudget({ policy = null, selection = null, env = process.env } = {}) {
  const effective = policy ?? DEFAULT_POLICY
  const requested = clampTokenBudget(effective.maxOutputTokens, DEFAULT_MAX_OUTPUT_TOKENS)
  const ceiling = modelOutputCeiling({ selection, env })
  return ceiling === null ? requested : Math.min(requested, ceiling)
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
  // v1 files upgrade transparently: every v2 field has a default, so the first
  // write (or the next heal) persists v2 without a migration step.
  if (!raw || !LEGACY_POLICY_SCHEMAS.includes(raw.schema)) return { ...DEFAULT_POLICY }
  return {
    ...DEFAULT_POLICY,
    ...raw,
    schema: HEAL_POLICY_SCHEMA,
    firstTokenMs: clampBudget(raw.firstTokenMs, DEFAULT_FIRST_TOKEN_MS),
    outputMs: clampBudget(raw.outputMs, DEFAULT_OUTPUT_MS),
    maxOutputTokens: clampTokenBudget(raw.maxOutputTokens, DEFAULT_MAX_OUTPUT_TOKENS),
    tokenGrowth: clampGrowth(raw.tokenGrowth, DEFAULT_TOKEN_GROWTH),
    maxChainHops: clampHops(raw.maxChainHops, DEFAULT_MAX_CHAIN_HOPS),
    intentReasoningEffort: clampReasoningEffort(raw.intentReasoningEffort, DEFAULT_INTENT_REASONING_EFFORT),
    repairReasoningEffort: clampReasoningEffort(raw.repairReasoningEffort, DEFAULT_REPAIR_REASONING_EFFORT),
    modelChain: Array.isArray(raw.modelChain)
      ? raw.modelChain.filter((entry) => typeof entry === 'string' && entry.trim() !== '').map((entry) => entry.trim())
      : [],
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
    schema: HEAL_POLICY_SCHEMA,
    firstTokenMs: clampBudget(patch.firstTokenMs ?? before.firstTokenMs, before.firstTokenMs),
    outputMs: clampBudget(patch.outputMs ?? before.outputMs, before.outputMs),
    maxOutputTokens: clampTokenBudget(patch.maxOutputTokens ?? before.maxOutputTokens, before.maxOutputTokens),
    tokenGrowth: clampGrowth(patch.tokenGrowth ?? before.tokenGrowth, before.tokenGrowth),
    maxChainHops: clampHops(patch.maxChainHops ?? before.maxChainHops, before.maxChainHops),
    repairReasoningEffort: patch.repairReasoningEffort === undefined
      ? before.repairReasoningEffort
      : clampReasoningEffort(patch.repairReasoningEffort, before.repairReasoningEffort),
    intentReasoningEffort: patch.intentReasoningEffort === undefined
      ? before.intentReasoningEffort
      : clampReasoningEffort(patch.intentReasoningEffort, before.intentReasoningEffort),
    modelChain: Array.isArray(patch.modelChain)
      ? patch.modelChain.filter((entry) => typeof entry === 'string' && entry.trim() !== '').map((entry) => entry.trim())
      : before.modelChain,
    revision: before.revision + 1,
    updatedAt: new Date().toISOString(),
    updatedBy: String(actor),
  }
  const changed =
    after.firstTokenMs !== before.firstTokenMs || after.outputMs !== before.outputMs ||
    after.maxOutputTokens !== before.maxOutputTokens ||
    after.tokenGrowth !== before.tokenGrowth || after.maxChainHops !== before.maxChainHops ||
    after.repairReasoningEffort !== before.repairReasoningEffort ||
    after.intentReasoningEffort !== before.intentReasoningEffort ||
    JSON.stringify(after.modelChain) !== JSON.stringify(before.modelChain)
  // Every setting that changes model behaviour is snapshotted together, so a
  // rollback is one patch and an audit reader can see the whole strategy state.
  after.history = [
    ...before.history,
    {
      at: after.updatedAt,
      actor: after.updatedBy,
      reason: reason === null || reason === undefined ? null : String(reason).slice(0, 500),
      before: { firstTokenMs: before.firstTokenMs, outputMs: before.outputMs, maxOutputTokens: before.maxOutputTokens, tokenGrowth: before.tokenGrowth, maxChainHops: before.maxChainHops, intentReasoningEffort: before.intentReasoningEffort, repairReasoningEffort: before.repairReasoningEffort, modelChain: before.modelChain },
      after: { firstTokenMs: after.firstTokenMs, outputMs: after.outputMs, maxOutputTokens: after.maxOutputTokens, tokenGrowth: after.tokenGrowth, maxChainHops: after.maxChainHops, intentReasoningEffort: after.intentReasoningEffort, repairReasoningEffort: after.repairReasoningEffort, modelChain: after.modelChain },
      changed,
    },
  ].slice(-50)
  if (apply === true) writeJsonAtomic(join(repo, POLICY_FILE), after)
  return { applied: apply === true, before, after, changed }
}

/**
 * The next model worth trying after the current one exhausted its output
 * budget. Entries are `provider/model` or a bare `model` (keeping the provider).
 * Already-tried and malformed entries are skipped; a missing chain is normal.
 */
export function nextModelInChain({ policy = null, selection = null, used = [] } = {}) {
  const effective = policy ?? DEFAULT_POLICY
  const entries = Array.isArray(effective.modelChain) ? effective.modelChain : []
  const tried = new Set((Array.isArray(used) ? used : []).filter(Boolean).map((entry) => `${entry.provider ?? ''}/${entry.model ?? ''}`))
  if (selection?.model) tried.add(`${selection.provider ?? ''}/${selection.model}`)
  for (const raw of entries) {
    const entry = String(raw ?? '').trim()
    if (!entry) continue
    const slash = entry.indexOf('/')
    const candidate = slash > 0
      ? { provider: entry.slice(0, slash).trim(), model: entry.slice(slash + 1).trim() }
      : { provider: selection?.provider ?? null, model: entry }
    if (!candidate.model) continue
    if (tried.has(`${candidate.provider ?? ''}/${candidate.model}`)) continue
    return candidate
  }
  return null
}

/**
 * Turn a measured output-budget exhaustion into a token patch. Growth is
 * bounded by `MAX_OUTPUT_TOKENS`; when the ceiling is already reached the right
 * move is a model switch, which the caller performs from `modelChain`.
 */
export function planOutputBudgetHeal({ policy = null, observedTokens = null } = {}) {
  const effective = policy ?? DEFAULT_POLICY
  const current = clampTokenBudget(effective.maxOutputTokens, DEFAULT_MAX_OUTPUT_TOKENS)
  const observed = Number(observedTokens)
  const hasObserved = Number.isFinite(observed) && observed > 0
  // Headroom already exists: a failure with far fewer consumed tokens is a
  // contract/transport problem, and raising the budget would hide it.
  if (hasObserved && observed < current * 0.9) {
    return {
      strategy: 'raise-output-tokens',
      healable: false,
      requiresCodeChange: false,
      patch: null,
      rationale: `实测 ${Math.round(observed)} tokens 未逼近当前 ${current} 预算，不调整`,
    }
  }
  const grown = clampTokenBudget(Math.max(current * effective.tokenGrowth, hasObserved ? observed * 2 : 0), current)
  if (grown <= current) {
    return {
      strategy: 'switch-model',
      healable: false,
      requiresCodeChange: false,
      patch: null,
      rationale: `输出预算已达上限 ${current} tokens，无法继续提升，需要切换模型链`,
    }
  }
  return {
    strategy: 'raise-output-tokens',
    healable: true,
    requiresCodeChange: false,
    patch: { maxOutputTokens: grown },
    rationale: `输出预算 ${current} tokens 被推理/正文耗尽（实测 ${hasObserved ? Math.round(observed) : '未知'}），提升到 ${grown}`,
  }
}

/** Persist one token-budget heal with history; used inside the retry path. */
export function applyOutputBudgetHeal({ root, observedTokens = null, reason = null, actor = 'ai:self-heal', apply = true } = {}) {
  const repo = resolveRoot(root)
  const policy = readHealPolicy(repo)
  const plan = planOutputBudgetHeal({ policy, observedTokens })
  if (!plan.healable || !plan.patch) return { applied: false, plan, policy, requiresCodeChange: false }
  const written = writeHealPolicy({ root: repo, patch: plan.patch, reason: reason ?? plan.rationale, actor, apply })
  return { applied: written.applied, plan, policy: written.after, before: written.before }
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
export function classifyRuntimeFailure({ errorCode = null, timing = null, policy = null, status = null, finishKind = null, usage = null, budgetTokens = null, streamProgress = null } = {}) {
  const effective = policy ?? DEFAULT_POLICY
  const code = String(errorCode ?? '').trim()
  const t = timing && typeof timing === 'object' ? timing : {}
  const totalMs = Number.isFinite(t.totalMs) ? t.totalMs : null
  const firstTokenMs = Number.isFinite(t.firstTokenMs) ? t.firstTokenMs : null
  const modelMs = Number.isFinite(t.modelMs) ? t.modelMs : null
  const outputTokens = Number.isFinite(usage?.outputTokens) ? usage.outputTokens
    : Number.isFinite(usage?.completionTokens) ? usage.completionTokens : null
  const reasoningTokens = Number.isFinite(usage?.reasoningTokens) ? usage.reasoningTokens : null
  const budget = clampTokenBudget(budgetTokens ?? effective.maxOutputTokens, effective.maxOutputTokens)
  // What the stream had delivered before it died. `null` means "unknown" (older
  // records), which must keep the previous duration-based behaviour instead of
  // pretending the provider stayed silent.
  const progress = streamProgress && typeof streamProgress === 'object'
    ? {
        chunks: Array.isArray(streamProgress.chunks) ? streamProgress.chunks : [],
        contentChars: Number.isFinite(streamProgress.contentChars) ? streamProgress.contentChars : 0,
        reasoningChars: Number.isFinite(streamProgress.reasoningChars) ? streamProgress.reasoningChars : 0,
      }
    : null
  const streamed = progress === null
    ? null
    : progress.chunks.length > 0 || progress.contentChars > 0 || progress.reasoningChars > 0
  // `finish=max-tokens` (the host's real truncation kind) and "consumed the
  // whole allowance" are the same defect seen from two sides; both mean the
  // model ran out of output tokens, not that it broke the contract. Treating
  // them as `invalid-output` used to send the user to a prompt fix that could
  // never help — and matching only `length`, a kind this host never emits, made
  // every real truncation land in that branch.
  const truncated = (finishKind === 'max-tokens' || finishKind === 'length') || code === 'ai-output-truncated'
  const nearBudget = outputTokens !== null && outputTokens >= Math.round(budget * 0.9)
  if (code === 'ai-output-budget-exhausted' || truncated || (code === 'ai-invalid-output' && nearBudget)) {
    return {
      errorType: 'output-budget-exhausted',
      kind: 'plugin-defect',
      healable: true,
      requiresCodeChange: false,
      strategy: 'raise-output-tokens',
      rationale: `模型输出预算 ${budget} tokens ${outputTokens === null ? '被耗尽' : `仅剩 ${Math.max(0, budget - outputTokens)}`}（finish=${finishKind ?? 'unknown'}，已用 ${outputTokens ?? '未知'}），需要提高 token 预算或切换模型`,
      evidence: { code, status, finishKind, outputTokens, reasoningTokens, budgetTokens: budget },
    }
  }

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
  // Bytes arrived but the answer never did: the stream was alive and the model was
  // thinking (or thinking until the output budget ran out). Raising the *first
  // token* gate here is what produced the 15s→31s→63s→127s escalation against a
  // call that was never stalled.
  if (streamed === true && code === 'ai-call-failed') {
    return {
      errorType: 'output-timeout',
      kind: 'plugin-defect',
      healable: true,
      requiresCodeChange: false,
      strategy: 'raise-output-budget',
      rationale: `模型已开始输出（${progress.chunks.join('/') || '未知分片'}，思考 ${progress.reasoningChars} 字、正文 ${progress.contentChars} 字）但正文未完成，按输出预算耗尽处理（实测 ${modelMs ?? totalMs ?? '未知'}ms）`,
      evidence: { code, status, totalMs, firstTokenMs, modelMs, chunks: progress.chunks, contentChars: progress.contentChars, reasoningChars: progress.reasoningChars, budgetMs: effective.outputMs },
    }
  }
  // No first token means the answering phase never started. The duration only
  // sizes the repair: a sub-2s failure is a dead transport, not a tight gate —
  // historically this same signature appeared both at the old 8s cap and at the
  // later 15s gate, so the gate value must not decide the class. When the stream
  // reported what arrived, that report is the evidence: silence is required.
  if (firstTokenMs === null && (totalMs === null || totalMs >= 2_000)) {
    return {
      errorType: 'first-token-timeout',
      kind: 'plugin-defect',
      healable: true,
      requiresCodeChange: false,
      strategy: 'raise-first-token-budget',
      rationale: `首 token 未到达即失败（${streamed === false ? '流内没有任何分片' : '无分片证据'}，实测 ${totalMs ?? '未知'}ms，当前闸门 ${effective.firstTokenMs}ms），判定为本机首 token 预算过紧`,
      evidence: { code, totalMs, firstTokenMs, budgetMs: effective.firstTokenMs, chunks: progress?.chunks ?? null },
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
  signals = null,
  apply = true,
} = {}) {
  const repo = resolveRoot(root)
  const effective = policy ?? readHealPolicy(repo)
  const signal = signals && typeof signals === 'object' ? signals : {}
  const outputTokens = Number.isFinite(signal.outputTokens) ? signal.outputTokens : null
  const reasoningTokens = Number.isFinite(signal.reasoningTokens) ? signal.reasoningTokens : null
  const budgetTokens = Number.isFinite(signal.budgetTokens) ? signal.budgetTokens : null
  // The host hands the adapter's failure object to the consumer; keeping its
  // code is what turns "AI 调用失败" into a nameable defect next time. The
  // provider's prose is deliberately not persisted: it can quote the request.
  const providerCode = typeof signal.providerCode === 'string' && signal.providerCode.trim() ? signal.providerCode.trim().slice(0, 120) : null
  // What the stream had delivered before it died is the difference between a
  // stalled provider and a model that was still thinking.
  const streamProgress = signal.streamProgress && typeof signal.streamProgress === 'object'
    ? {
        chunks: Array.isArray(signal.streamProgress.chunks) ? signal.streamProgress.chunks.slice(0, 8) : [],
        contentChars: Number.isFinite(signal.streamProgress.contentChars) ? signal.streamProgress.contentChars : 0,
        reasoningChars: Number.isFinite(signal.streamProgress.reasoningChars) ? signal.streamProgress.reasoningChars : 0,
      }
    : null
  // An unusable model body travels as an excerpt on the error (details.rawExcerpt
  // for a direct contract break, details.firstBodyFailure.rawExcerpt when the
  // repair died on transport). Without it the failure is undiagnosable: the run
  // record keeps only an error code, and the raw answer is gone forever.
  const rawExcerpt = typeof error?.details?.rawExcerpt === 'string' && error.details.rawExcerpt.trim() !== ''
    ? error.details.rawExcerpt
    : typeof error?.details?.firstBodyFailure?.rawExcerpt === 'string' && error.details.firstBodyFailure.rawExcerpt.trim() !== ''
      ? error.details.firstBodyFailure.rawExcerpt
      : null
  // The parse/contract error code is the difference between "the JSON was cut
  // off" and "the model used a field the contract forbids". The first body's
  // diagnosis travels on details.firstBodyFailure when the repair died on
  // transport; without its code the ledger can only say "external failure".
  const firstBody = error?.details?.firstBodyFailure
  const firstBodyCode = typeof error?.details?.code === 'string'
    ? error.details.code
    : typeof firstBody?.code === 'string' ? firstBody.code : null
  const classification = classifyRuntimeFailure({
    errorCode: error?.code ?? null,
    timing,
    policy: effective,
    status: error?.status ?? null,
    finishKind: signal.finishKind ?? null,
    usage: { outputTokens, reasoningTokens },
    budgetTokens,
    // The passed-in signals are the only trustworthy report of what arrived.
    streamProgress,
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
        `policy=firstToken:${effective.firstTokenMs}ms output:${effective.outputMs}ms tokens:${effective.maxOutputTokens}`,
        `finish=${signal.finishKind ?? 'unknown'} outputTokens=${outputTokens ?? '?'} reasoningTokens=${reasoningTokens ?? '?'} budgetTokens=${budgetTokens ?? effective.maxOutputTokens}`,
        `providerFailure=${providerCode ?? '?'}`,
        `stream=${streamProgress ? `chunks=${streamProgress.chunks.join('|') || 'none'} contentChars=${streamProgress.contentChars} reasoningChars=${streamProgress.reasoningChars}` : 'chunks=?'}`,
        `reason=${classification.rationale}`,
      ],
      artifacts: sessionId ? [{ kind: 'intent-session', id: sessionId }] : [],
      snapshot: {
        sessionId,
        runId,
        // AC-01: runId / model / timing travel as fields on the event, not only
        // as prose in the log lines, so a reader or a heal pass can use them.
        model: model ? { provider: model.provider ?? null, model: model.model ?? null } : null,
        inputHash: session?.input?.inputHash ?? null,
        inputExcerpt: inputText,
        timing: timing ?? null,
        finishKind: signal.finishKind ?? null,
        providerFailure: providerCode === null ? null : { code: providerCode },
        streamProgress,
        tokens: outputTokens === null && reasoningTokens === null && budgetTokens === null
          ? null
          : { outputTokens, reasoningTokens, budgetTokens: budgetTokens ?? effective.maxOutputTokens },
        rawOutputExcerpt: rawExcerpt === null ? null : rawExcerpt.slice(0, 2_000),
        parseFailureCode: firstBodyCode === null ? null : firstBodyCode.slice(0, 80),
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
        finishKind: snapshot.finishKind ?? null,
        usage: snapshot.tokens ?? null,
        budgetTokens: snapshot.tokens?.budgetTokens ?? null,
        streamProgress: snapshot.streamProgress ?? null,
      })
  if (classification.errorType === 'output-budget-exhausted') {
    const planned = planOutputBudgetHeal({
      policy: effective,
      observedTokens: snapshot.tokens?.outputTokens ?? null,
    })
    return { ...planned, failureId: failure?.id ?? null }
  }
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
