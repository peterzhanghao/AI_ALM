import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { isGenericTestCommand } from '../alm-core/src/acceptance/acceptance.mjs'
import { deriveVerificationCommand, readBlueprint, verificationCommandDiagnosis } from '../alm-core/src/requirements/blueprint-guard.mjs'
import { worktreeSnapshot } from '../alm-core/src/requirements/worktree-snapshot.mjs'

/**
 * AI-driven entry gate (ALM preflight).
 *
 * Product rule: starting development must not be a manual checklist. The gate
 * runs itself when the user asks to start, registers a derivable acceptance
 * command, and records every existing review/verification fact as work for
 * the delivery run. It deliberately does not run review or acceptance before
 * implementation: those are outcomes of the development task, not admission
 * prerequisites.
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
 * Derive a requirement-scoped acceptance command from investigated and planned
 * modules. A package script such as `pnpm test` is deliberately not a default:
 * it has no requirement boundary and lets unrelated historical failures block
 * a delivery.
 */
export function deriveAcceptanceCommand(root, { investigationEvidence = [], asset = null, blueprint = null, changedFiles = [] } = {}) {
  const repo = resolve(root)
  return deriveVerificationCommand({ root: repo, investigationEvidence, asset, blueprint, changedFiles })
}

export function needsTargetedAcceptance(acceptance) {
  if (!acceptance?.registered) return true
  const commands = acceptance.commands ?? []
  if (commands.some(entry => isGenericTestCommand(entry?.command ?? entry))) return true
  // A command generated from a long-lived dirty worktree can contain far more
  // test files than its fixed timeout can cover. Re-derive a bounded command
  // instead of letting a restart repeat the same guaranteed timeout.
  return commands.some(entry => {
    const diagnosis = verificationCommandDiagnosis(entry?.command ?? entry, entry?.timeoutMs)
    return diagnosis.oversized || diagnosis.underBudget
  })
}

/**
 * Files changed since this run's blueprint baseline. A repository that has
 * accumulated several rounds of uncommitted work must not make a new
 * requirement own every historical change; only the current round counts.
 */
function runScopedChangedFiles(root, item) {
  const runId = item?.run?.id
  if (!runId) return []
  try {
    const baseline = new Map((readBlueprint(root, runId)?.baseline?.files ?? [])
      .map(entry => [String(entry?.path ?? '').replaceAll('\\', '/'), entry?.hash]))
    if (baseline.size === 0) return []
    return worktreeSnapshot(root).files
      .filter(entry => baseline.get(String(entry.path).replaceAll('\\', '/')) !== entry.hash)
      .map(entry => entry.path)
  } catch {
    return []
  }
}

function derivationInput(item) {
  return {
    investigationEvidence: item?.investigationEvidence ?? [],
    asset: item?.file ? { source: { path: item.file }, extra: { brief: item.brief ?? null }, doc: item.docView?.doc ?? null } : null,
    blueprint: item?.run?.id ? { allowedPaths: item.run.allowedPaths ?? [] } : null,
    changedFiles: item?.run?.changedFiles ?? [],
  }
}

function workingTreeChangedFiles(root) {
  try {
    const tracked = execFileSync('git', ['diff', '--name-only', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    return [...new Set(`${tracked}\n${untracked}`.split(/\r?\n/).map(path => path.trim()).filter(Boolean))]
  } catch {
    return []
  }
}

/**
 * What is required to *start* development, as opposed to releasing it.
 * Review and acceptance evidence describe work the AI must perform, rather
 * than proof required before work can begin. Only an unreadable requirement,
 * a damaged workspace or a terminal archive state may lock the start action.
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
  if (Object.hasOwn(item ?? {}, 'briefText') && !String(item.briefText ?? '').trim()) {
    return { ...base, ready: false, code: 'brief-missing', label: '需求正文为空', reasons: [{ code: 'brief-missing', message: '需求正文为空，无法生成可执行任务' }] }
  }
  if (item?.workspace?.healthy === false || item?.workspace?.damaged === true || item?.integrity?.workspaceHealthy === false) {
    return { ...base, ready: false, code: 'workspace-damaged', label: '工作区状态异常', reasons: [{ code: 'workspace-damaged', message: '工作区状态异常，无法安全创建开发任务' }] }
  }
  const carryOver = []
  const addCarryOver = entry => {
    if (!carryOver.some(current => current.code === entry.code)) carryOver.push(entry)
  }
  if (state === 'blocked' || state === 'needs-clarification' || state === 'failed') {
    addCarryOver({
      code: decision?.topGap?.code ?? `decision-${state}`,
      message: decision?.topGap?.message ?? decision?.label ?? '现有检查结论需要在开发过程中处理',
      fix: '将现有检查结论带入本轮 AI 推进并在实现后重新验证',
      evidence: null,
    })
  }
  if (!review?.stored) {
    addCarryOver({ code: 'review-not-run', message: '尚未运行评审，AI 会在本轮推进中完成检查', fix: '开发过程中完成评审并处理发现项', evidence: null })
  }
  if (!acceptance?.registered) {
    addCarryOver({ code: 'acceptance-missing', message: '尚未登记验收命令，启动时会尝试从仓库自动推导', fix: '开发完成后运行已登记的定向验收', evidence: null })
  }

  const latest = acceptance.latest ?? null
  if (latest && latest.result === 'fail') {
    addCarryOver({
      code: 'acceptance-failed',
      message: latest.commands
        ? `上次验收 ${latest.commands} 条命令执行失败（${String(latest.finishedAt ?? '').slice(0, 19).replace('T', ' ')}）`
        : '上次验收执行失败',
      fix: '进入开发后先修复失败项，再重新执行验收生成通过证据',
      evidence: latest.file ?? null,
    })
  } else if (latest && latest.current !== true) {
    addCarryOver({
      code: 'evidence-stale',
      message: '验收证据与当前需求/实现不一致，进入开发后会重新执行',
      fix: '开发完成后重新执行验收',
      evidence: latest.file ?? null,
    })
  } else if (!latest) {
    addCarryOver({
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
 *   Optional review helpers and applyAcceptanceConfig(commands)
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
      push({ code: 'review-run', status: 'carry-over', title: '评审尚未运行', detail: '作为本轮 AI 推进目标带入，不阻断启动' })
    } else if (typeof deps.runReview !== 'function') {
      push({ code: 'review-run', status: 'carry-over', title: '评审尚未运行', detail: '当前没有独立评审执行器；AI 会在本轮推进中完成检查' })
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
  const aiReviewGap = reviewGap === 'review-not-accepted' || reviewGap === 'coverage-incomplete' || reviewGap === 'review-not-run'
  // A host that only wires the acceptance side of preflight (for example the
  // `start` path) must still be able to launch: the review becomes this round's
  // AI work instead of a TypeError that blocks development entirely.
  if (aiReviewGap && typeof deps.readAiReview !== 'function') {
    push({ code: 'ai-review-adopt', status: 'carry-over', title: '评审建议待本轮 AI 处理', detail: '宿主未提供独立评审执行器；评审与建议采纳将在本轮推进中完成' })
  } else if (aiReviewGap) {
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

  // 3. Register a targeted test set when none exists, and replace a legacy
  //    default `pnpm test` binding before it can block this requirement again.
  if (needsTargetedAcceptance(item.acceptance)) {
    const input = derivationInput(item)
    const scoped = runScopedChangedFiles(root, item)
    // Prefer the current round's boundary; fall back to the whole working tree
    // only when no blueprint baseline exists (for example a first start).
    input.changedFiles = [...new Set([...input.changedFiles, ...scoped, ...(scoped.length ? [] : workingTreeChangedFiles(root))])]
    const derived = deriveAcceptanceCommand(root, input)
    if (derived) {
      const commands = [{ id: 'cmd-1', command: derived.command, timeoutMs: derived.timeoutMs }]
      try {
        if (apply) {
          deps.applyAcceptanceConfig(commands)
          push({ code: 'acceptance-configure', status: 'fixed', title: '登记精准验收命令', detail: derived.reason })
          item = pickItem(deps.inspect(), requirementId) ?? item
        } else {
          push({ code: 'acceptance-configure', status: 'skipped', title: '将登记精准验收命令', detail: derived.reason })
        }
      } catch (error) {
        push({ code: 'acceptance-configure', status: 'failed', title: '登记验收命令失败', detail: error?.message ?? String(error) })
      }
    } else {
      push({
        code: 'acceptance-configure',
        status: 'needs-decision',
        title: '无法自动确定精准验收命令',
        detail: '未找到与调查证据或执行范围对应的专项测试文件，请手动登记定向验收命令',
      })
    }
  }

  // 4. Never execute acceptance before implementation. Both missing/stale
  //    evidence and a known failure are explicit delivery tasks for the AI.
  //    This prevents a first start from waiting on a suite that can only pass
  //    after the requested change exists.
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
    push({ code: 'acceptance-run', status: 'carry-over', title: '验收尚未执行', detail: '作为开发完成后的验证目标带入本轮 AI 推进' })
  } else if (latest) {
    push({
      code: 'acceptance-check',
      status: 'checked',
      title: '验收证据仍有效',
      detail: latest.result === 'pass' ? '最近一次验收通过' : `最近一次验收：${latest.result ?? '未知'}`,
    })
  }

  // 5. Final readiness only rejects structurally unsafe starts. Historical
  // review and acceptance outcomes are already represented as carry-over work.
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
