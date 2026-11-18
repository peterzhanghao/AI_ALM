#!/usr/bin/env node
/**
 * Defect self-heal console for the requirements plugin.
 *
 * Subcommands:
 *   status                     policy + failure/defect counts + last verification
 *   capture --session <id>     record one session's failed runs as failure events
 *   capture --all              record every failed run found in the session store
 *   heal [--all|--failure <id>] apply the policy repair for healable failures
 *   verify [--policy <json>]   replay recorded runs against the current policy
 *   run [--all]                capture -> heal -> verify in one pass
 *
 * Exit code is 0 when the loop closed (healed or nothing to heal) and 1 when a
 * failure needs a code change or an operator.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { listFailures, readFailure } from '../../alm-core/src/requirements/failure.mjs'
import {
  POLICY_FILE,
  captureIntentFailure,
  planHeal,
  readHealPolicy,
  verifyHeal,
  writeHealPolicy,
} from '../self-heal.mjs'

const args = process.argv.slice(2)
const command = args[0] ?? 'status'
const flag = (name) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] ?? null : null
}
const root = resolve(flag('--root') ?? process.cwd())
const sessionDir = join(root, '.alm/intents/sessions')

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

function loadSessions() {
  let names = []
  try {
    names = readdirSync(sessionDir).filter((name) => name.endsWith('.json'))
  } catch {
    return []
  }
  const out = []
  for (const name of names) {
    try {
      const value = JSON.parse(readFileSync(join(sessionDir, name), 'utf8'))
      if (value?.sessionId) out.push(value)
    } catch {
      /* a corrupt session must not stop the sweep */
    }
  }
  return out
}

function failedRuns(session) {
  return (Array.isArray(session.runs) ? session.runs : []).filter(
    (run) => run?.status === 'error' && /ai-call-failed|ai-timeout|ai-invalid-output/.test(String(run.errorCode ?? '')),
  )
}

function captureSessions(sessions, { apply = true } = {}) {
  const captured = []
  for (const session of sessions) {
    for (const run of failedRuns(session)) {
      const result = captureIntentFailure({
        root,
        session,
        error: { code: run.errorCode, message: run.errorCode, status: 502 },
        timing: run.timing ?? null,
        model: { provider: run.provider, model: run.model },
        runId: run.analysisRunId ?? null,
        apply,
      })
      captured.push({
        sessionId: session.sessionId,
        runId: run.analysisRunId ?? null,
        errorType: result.classification.errorType,
        healable: result.classification.healable,
        failureId: result.failure?.id ?? null,
        deduped: result.deduped === true,
      })
    }
  }
  return captured
}

/**
 * Heal as a batch: taking the maximum of every planned patch means one write
 * clears the worst observed interception instead of doubling the gate once per
 * failure and landing on an absurd budget.
 */
function healFailures(failures, { apply = true } = {}) {
  const policy = readHealPolicy(root)
  const healed = []
  const blocked = new Map()
  const patch = {}
  for (const failure of failures) {
    const plan = planHeal({ failure, policy })
    if (!plan.healable || !plan.patch) {
      const key = `${failure.errorType}|${plan.strategy}`
      if (!blocked.has(key)) {
        blocked.set(key, { errorType: failure.errorType, strategy: plan.strategy, requiresCodeChange: plan.requiresCodeChange === true, failures: [] })
      }
      blocked.get(key).failures.push(failure.id)
      continue
    }
    for (const [key, value] of Object.entries(plan.patch)) patch[key] = Math.max(patch[key] ?? 0, value)
    healed.push({ failureId: failure.id, errorType: failure.errorType, strategy: plan.strategy })
  }
  const blockedList = [...blocked.values()]
  if (Object.keys(patch).length === 0) return { healed: [], blocked: blockedList, policy, before: policy }
  const reason = `批量自愈 ${healed.length} 条失败：${[...new Set(healed.map((entry) => entry.errorType))].join('、')}`
  const written = writeHealPolicy({ root, patch, reason, actor: 'ai:self-heal', apply })
  return { healed, blocked: blockedList, policy: written.after, before: written.before }
}

if (command === 'status') {
  const policy = readHealPolicy(root)
  const failures = listFailures(root, { limit: 20 })
  const verification = verifyHeal({ root, policy })
  process.stdout.write(`${JSON.stringify({ ok: true, policyFile: POLICY_FILE, policy: { revision: policy.revision, firstTokenMs: policy.firstTokenMs, outputMs: policy.outputMs, updatedAt: policy.updatedAt }, failures: failures.map((entry) => ({ id: entry.id, errorType: entry.errorType, kind: entry.kind, at: entry.at })), verification }, null, 2)}\n`)
  process.exit(0)
}

if (command === 'capture') {
  const sessions = loadSessions()
  const only = flag('--session')
  const target = only ? sessions.filter((session) => session.sessionId === only) : sessions
  if (only && target.length === 0) fail(`会话 ${only} 不存在`)
  const captured = captureSessions(target)
  process.stdout.write(`${JSON.stringify({ ok: true, captured: captured.length, events: captured }, null, 2)}\n`)
  process.exit(0)
}

if (command === 'heal') {
  const explicit = flag('--failure')
  const failures = explicit
    ? [readFailure(root, explicit)].filter(Boolean)
    : listFailures(root, { limit: 200 }).filter((entry) => entry.stage === 'clarify')
  if (failures.length === 0) fail('没有可自愈的失败事件，先运行 capture')
  const { healed, blocked } = healFailures(failures)
  process.stdout.write(`${JSON.stringify({ ok: blocked.length === 0, healed, blocked }, null, 2)}\n`)
  process.exit(blocked.length === 0 ? 0 : 1)
}

if (command === 'verify') {
  const inline = flag('--policy')
  const policy = inline ? { ...readHealPolicy(root), ...JSON.parse(inline) } : readHealPolicy(root)
  const verification = verifyHeal({ root, policy })
  process.stdout.write(`${JSON.stringify({ ok: verification.verdict === 'healed', verification }, null, 2)}\n`)
  process.exit(verification.verdict === 'healed' ? 0 : 1)
}

if (command === 'run') {
  const sessions = loadSessions()
  const captured = captureSessions(sessions)
  const failures = listFailures(root, { limit: 200 }).filter((entry) => entry.stage === 'clarify')
  const { healed, blocked, before, policy } = healFailures(failures)
  const verification = verifyHeal({ root })
  const closed = verification.verdict === 'healed' && blocked.length === 0
  process.stdout.write(`${JSON.stringify({
    ok: closed,
    captured: captured.length,
    healed,
    blocked,
    policy: {
      before: { firstTokenMs: before.firstTokenMs, outputMs: before.outputMs },
      after: { firstTokenMs: policy.firstTokenMs, outputMs: policy.outputMs },
      revision: policy.revision,
    },
    verification,
  }, null, 2)}\n`)
  process.exit(closed ? 0 : 1)
}

if (command === 'reset-policy') {
  const written = writeHealPolicy({ root, patch: { firstTokenMs: 15_000, outputMs: 90_000 }, reason: 'manual reset', actor: 'human:local', apply: true })
  process.stdout.write(`${JSON.stringify({ ok: true, policy: written.after }, null, 2)}\n`)
  process.exit(0)
}

fail(`未知命令：${command}（可用：status | capture | heal | verify | run | reset-policy）`)
