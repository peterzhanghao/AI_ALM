import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * AI-driven entry gate (ALM preflight).
 *
 * Product rule: starting development must not be a manual checklist. The gate
 * runs itself when the user asks to start, repairs every evidence gap it can
 * repair deterministically (run/save review, adopt the AI review, register an
 * acceptance command derived from the repository, execute acceptance), records
 * the whole run, and only stops to ask the user when a gap is genuinely
 * ambiguous (review blockers, data anomalies, no derivable command).
 *
 * Failing acceptance evidence is NOT a blocker here: a failing suite is work
 * for development, so it becomes a carry-over item instead of a locked button.
 */

export const PREFLIGHT_SCHEMA = 'alm.preflight/v1'
export const PREFLIGHT_DIR = '.alm/preflight'

const STATUS = {
  fixed: { label: '已自动处理', tone: 'ok' },
  checked: { label: '已检查', tone: 'neutral' },
  skipped: { label: '无需处理', tone: 'neutral' },
  'carry-over': { label: '带入开发', tone: 'warn' },
  'needs-decision': { label: '需要你决定', tone: 'warn' },
  failed: { label: '自动处理失败', tone: 'err' },
}

export function stepMeta(status) {
  return STATUS[status] ?? STATUS.checked
}

/**
 * Derive a safe acceptance command from the repository itself. Only the
 * package.json script name and the detected package manager are used; the
 * command still goes through the acceptance whitelist (node/npm/pnpm).
 */
export function deriveAcceptanceCommand(root) {
  const repo = resolve(root)
  const file = join(repo, 'package.json')
  if (!existsSync(file)) return null
  let scripts
  try {
    scripts = JSON.parse(readFileSync(file, 'utf8')).scripts ?? {}
  } catch {
    return null
  }
  const name = ['test', 'ci', 'verify'].find((key) => typeof scripts[key] === 'string' && scripts[key].trim() !== '')
  if (!name) return null
  const runner = existsSync(join(repo, 'pnpm-lock.yaml')) ? 'pnpm' : existsSync(join(repo, 'package-lock.json')) ? 'npm' : 'pnpm'
  return {
    name,
    runner,
    command: [runner, name],
    timeoutMs: 10 * 60 * 1000,
    reason: `从 package.json 的 scripts.${name} 推导：${runner} ${name}`,
  }
}

/**
 * What is required to *start* development, as opposed to releasing it.
 * Review readiness and a registered acceptance command are mandatory; the
 * health of the implementation (failed / stale evidence) is carried into
 * development as work, never used to lock the button.
 */
export function startReadiness(item) {
  const decision = item?.decision ?? null
  const review = item?.review ?? null
  const acceptance = item?.acceptance ?? null
  const state = decision?.state ?? 'unchecked'
  const gaps = Array.isArray(decision?.gaps) ? decision.gaps : []
  const base = { state, gaps, carryOver: [] }

  if (item?.status === 'archived' || state === 'archived') {
    return { ...base, ready: false, code: 'archived', label: '需求已归档', reasons: gaps }
  }
  if (state === 'blocked') {
    return { ...base, ready: false, code: 'review-blocked', label: '评审存在阻塞项', reasons: gaps }
  }
  if (state === 'needs-clarification') {
    return { ...base, ready: false, code: 'needs-clarification', label: '需求数据存在歧义', reasons: gaps }
  }
  if (!review?.stored) {
    return { ...base, ready: false, code: 'review-missing', label: '尚未运行评审', reasons: gaps }
  }
  if (!acceptance?.registered) {
    return { ...base, ready: false, code: 'acceptance-missing', label: '未登记验收命令', reasons: gaps }
  }

  const latest = acceptance.latest ?? null
  const carryOver = []
  if (latest && latest.result === 'fail') {
    carryOver.push({
      code: 'acceptance-failed',
      message: latest.commands
        ? `上次验收 ${latest.commands} 条命令执行失败（${String(latest.finishedAt ?? '').slice(0, 19).replace('T', ' ')}）`
        : '上次验收执行失败',
      fix: '进入开发后先修复失败项，再重新执行验收生成通过证据',
      evidence: latest.file ?? null,
    })
  } else if (latest && latest.current !== true) {
    carryOver.push({
      code: 'evidence-stale',
      message: '验收证据与当前需求/实现不一致，进入开发后会重新执行',
      fix: '开发完成后重新执行验收',
      evidence: latest.file ?? null,
    })
  } else if (!latest) {
    carryOver.push({
      code: 'acceptance-not-run',
      message: '验收尚未执行，进入开发后由 AI 运行',
      fix: '开发完成后执行验收',
      evidence: null,
    })
  }

  return { ...base, ready: true, code: 'ready', label: '可以开始开发', reasons: [], carryOver }
}

function pickItem(payload, requirementId) {
  const items = Array.isArray(payload?.requirements) ? payload.requirements : []
  return items.find((entry) => entry.id === requirementId) ?? null
}

function emptyState() {
  return { state: 'unchecked', label: '未检查', gaps: [] }
}

function decisionOf(item) {
  return item?.decision ?? emptyState()
}

/**
 * Run one preflight pass. `deps` supplies every side effect so the orchestration
 * itself stays testable:
 *   inspect() -> { requirements: [...] }
 *   runReview() | readAiReview() | generateAiReview() | adoptAiReview(report)
 *   planAcceptanceConfig(commands) | applyAcceptanceConfig(commands) | runAcceptance()
 */
export async function runPreflight({ root, requirementId, apply = false, deps }) {
  if (!requirementId) throw Object.assign(new Error('requirementId is required'), { status: 400, code: 'requirement-required' })
  if (!deps || typeof deps.inspect !== 'function') throw new Error('preflight deps.inspect is required')
  const startedAt = new Date().toISOString()
  const steps = []
  const push = (step) => {
    steps.push({ at: new Date().toISOString(), ...step })
    return steps[steps.length - 1]
  }

  let item = pickItem(deps.inspect(), requirementId)
  if (!item) throw Object.assign(new Error(`requirement not found: ${requirementId}`), { status: 404, code: 'requirement-not-found' })

  if (item.status === 'archived') {
    return finish({
      apply,
      startedAt,
      requirementId,
      steps: [push({ code: 'archived', status: 'skipped', title: '需求已归档', detail: '归档需求不进入开发流程' })],
      item,
      question: null,
    })
  }

  // 1. A saved review is the cheapest fix and often closes coverage gaps.
  //    Preview (apply:false) must not write a review report, so it only says
  //    what the run would do.
  if (!item.review?.stored) {
    if (!apply) {
      push({ code: 'review-run', status: 'skipped', title: '需要运行评审', detail: '预览模式不改写文件；开始开发时会自动运行评审' })
    } else {
      try {
        deps.runReview()
        push({ code: 'review-run', status: 'fixed', title: '运行并保存评审', detail: '评审报告已生成，不再需要手动运行' })
        item = pickItem(deps.inspect(), requirementId) ?? item
      } catch (error) {
        push({ code: 'review-run', status: 'failed', title: '运行评审失败', detail: error?.message ?? String(error) })
      }
    }
  } else {
    push({ code: 'review-check', status: 'checked', title: '评审报告已存在', detail: `${item.review.summary?.completed ?? 0}/${item.review.summary?.total ?? 0} 个视角完成` })
  }

  // 2. Adopt the AI review when the decision is waiting on review acceptance or
  //    coverage. Adoption records the sign-off (and rewrites the brief through
  //    the reviewed suggestions), so the user never signs manually.
  const reviewGap = decisionOf(item)?.topGap?.code
  if (reviewGap === 'review-not-accepted' || reviewGap === 'coverage-incomplete' || reviewGap === 'review-not-run') {
    let report = deps.readAiReview()
    if (!report && apply) {
      try {
        report = await deps.generateAiReview()
        push({
          code: 'ai-review-generate',
          status: 'fixed',
          title: 'AI 评审需求',
          detail: `结论 ${report?.verdict ?? 'warn'} · ${(report?.suggestions ?? []).length} 条建议`,
        })
      } catch (error) {
        push({ code: 'ai-review-generate', status: 'failed', title: 'AI 评审失败', detail: error?.message ?? String(error) })
      }
    }
    if (report && apply) {
      try {
        const adopted = deps.adoptAiReview(report)
        const accepted = adopted?.accepted?.accepted === true
        push({
          code: 'ai-review-adopt',
          status: accepted ? 'fixed' : 'needs-decision',
          title: '采纳 AI 评审建议',
          detail: accepted ? '已按建议修订需求并登记评审通过' : '建议已采纳，但评审仍标记为阻塞，需要你决定',
        })
        item = pickItem(deps.inspect(), requirementId) ?? item
        try {
          deps.runReview()
          item = pickItem(deps.inspect(), requirementId) ?? item
        } catch {
          // A stale review after an adoption is re-run on the next preflight.
        }
      } catch (error) {
        push({ code: 'ai-review-adopt', status: 'failed', title: '采纳 AI 评审失败', detail: error?.message ?? String(error) })
      }
    } else if (report) {
      push({ code: 'ai-review-adopt', status: 'skipped', title: '将采纳 AI 评审建议', detail: '预览模式不改写评审与需求' })
    }
  }

  // 3. Register an acceptance command when the requirement has none. The
  //    command is derived from the repository, never invented.
  if (!item.acceptance?.registered) {
    const derived = deriveAcceptanceCommand(root)
    if (derived) {
      const commands = [{ id: 'cmd-1', command: derived.command, timeoutMs: derived.timeoutMs }]
      try {
        if (apply) {
          deps.applyAcceptanceConfig(commands)
          push({ code: 'acceptance-configure', status: 'fixed', title: '登记验收命令', detail: derived.reason })
          item = pickItem(deps.inspect(), requirementId) ?? item
        } else {
          push({ code: 'acceptance-configure', status: 'skipped', title: '将登记验收命令', detail: derived.reason })
        }
      } catch (error) {
        push({ code: 'acceptance-configure', status: 'failed', title: '登记验收命令失败', detail: error?.message ?? String(error) })
      }
    } else {
      push({
        code: 'acceptance-configure',
        status: 'needs-decision',
        title: '无法自动确定验收命令',
        detail: '仓库里没有可用的 package.json 测试脚本，请手动登记验收命令',
      })
    }
  }

  // 4. Execute acceptance whenever the registered evidence is absent or stale.
  //    A previously failing run is already a known development task: re-running
  //    the same suite on every start would be slow and noisy, so it is carried
  //    over instead of executed again.
  const latest = item.acceptance?.latest ?? null
  const knownFailure = Boolean(item.acceptance?.registered) && latest?.result === 'fail'
  const needsRun =
    Boolean(item.acceptance?.registered) && !knownFailure && (!latest || latest.current !== true)
  if (knownFailure) {
    push({
      code: 'acceptance-run',
      status: 'carry-over',
      title: '沿用上次验收失败结果',
      detail: '失败项作为开发任务带入，开发完成后自动重新验收',
    })
  } else if (needsRun) {
    if (!apply) {
      push({ code: 'acceptance-run', status: 'skipped', title: '需要执行验收', detail: '预览模式不执行命令' })
    } else {
      try {
        const run = deps.runAcceptance()
        const passed = run?.result === 'pass' || run?.evidence?.result === 'pass'
        push({
          code: 'acceptance-run',
          status: passed ? 'fixed' : 'carry-over',
          title: passed ? '执行验收并通过' : '执行验收未通过',
          detail: passed
            ? `${run?.evidence?.commands?.length ?? 0} 条命令通过，证据 ${run?.evidence?.file ?? ''}`.trim()
            : '失败项会作为开发任务带入，开发完成后自动重新验收',
        })
        item = pickItem(deps.inspect(), requirementId) ?? item
      } catch (error) {
        push({ code: 'acceptance-run', status: 'failed', title: '执行验收失败', detail: error?.message ?? String(error) })
      }
    }
  } else if (latest) {
    push({
      code: 'acceptance-check',
      status: 'checked',
      title: '验收证据仍有效',
      detail: latest.result === 'pass' ? '最近一次验收通过' : `最近一次验收：${latest.result ?? '未知'}`,
    })
  }

  // 5. Final readiness decides whether the flow continues to change creation.
  const readiness = startReadiness(item)
  let question = null
  if (!readiness.ready) {
    question = {
      code: readiness.code,
      message: `${readiness.label}：${readiness.reasons?.[0]?.message ?? '缺少必要证据'}`,
      options: [
        { id: 'proceed', label: '带着问题开始开发', detail: '缺口记入审计，AI 在开发过程中继续处理' },
        { id: 'cancel', label: '先不开始', detail: '回到需求列表，补齐后再试' },
      ],
    }
  }

  return finish({ apply, startedAt, requirementId, steps, item, readiness, question })
}

function finish({ apply, startedAt, requirementId, steps, item, readiness = null, question = null }) {
  const record = {
    schema: PREFLIGHT_SCHEMA,
    requirementId,
    applied: apply,
    startedAt,
    finishedAt: new Date().toISOString(),
    steps,
    decision: {
      state: decisionOf(item).state,
      label: decisionOf(item).label,
      topGap: decisionOf(item)?.topGap ?? null,
      gaps: decisionOf(item)?.gaps ?? [],
    },
    readiness: readiness ?? { ready: false, code: 'unknown', label: '未检查', reasons: [], carryOver: [] },
    carryOver: readiness?.carryOver ?? [],
    question,
  }
  return record
}

export function writePreflightAudit(root, record) {
  const dir = join(resolve(root), PREFLIGHT_DIR, record.requirementId)
  mkdirSync(dir, { recursive: true })
  const stamp = String(record.startedAt ?? new Date().toISOString()).replace(/[:.]/g, '-')
  const file = join(dir, `${stamp}.json`)
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
  return file
}
