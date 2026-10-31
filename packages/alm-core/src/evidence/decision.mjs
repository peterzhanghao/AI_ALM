/**
 * Requirement evidence decision: a pure judgement over the review view, the
 * acceptance summary and the data-anomaly list. This module never touches the
 * filesystem: callers pass already-read shapes, so the same inputs always give
 * the same decision (and the UI can never turn "no evidence" into "passed").
 */

/** Decision document schema. Distinct from `alm.evidence/v1` (gate-run evidence). */
export const EVIDENCE_SCHEMA = 'alm.evidence.decision/v1'

/** Review perspectives in their stable order. */
export const ROLE_IDS = ['business', 'architecture', 'testing', 'security', 'delivery']

const NORMAL_ROLES = ['business', 'architecture', 'testing', 'delivery']
const LOW_ROLES = ['testing', 'delivery']

const ANOMALY_KINDS = new Set(['duplicate-id', 'dangling-relation', 'duplicate-business-id'])

const LABELS = {
  unchecked: '未检查',
  'needs-clarification': '需澄清',
  blocked: '阻塞',
  failed: '执行失败',
  stale: '证据过期',
  'ready-for-human': '可进入人工确认',
  verified: '已签收',
}

const TONES = {
  unchecked: 'neutral',
  'needs-clarification': 'neutral',
  blocked: 'error',
  failed: 'error',
  stale: 'warn',
  'ready-for-human': 'success',
  verified: 'success',
}

/** P0/P1 => high (all roles), P2 => normal, everything else => low. */
export function riskLevel(asset) {
  const priority = asset?.extra?.priority ?? asset?.priority ?? null
  if (priority === 'P0' || priority === 'P1') return 'high'
  if (priority === 'P2') return 'normal'
  return 'low'
}

/** Which review perspectives a requirement must cover, purely from its priority. */
export function requirementPolicy(asset) {
  const risk = riskLevel(asset)
  let requiredRoles
  if (risk === 'high') requiredRoles = [...ROLE_IDS]
  else if (risk === 'normal') requiredRoles = [...NORMAL_ROLES]
  else requiredRoles = [...LOW_ROLES]
  return { risk, requiredRoles, requiresAcceptance: true }
}

function rolesById(review) {
  const map = new Map()
  for (const role of Array.isArray(review?.roles) ? review.roles : []) {
    if (role && typeof role.id === 'string') map.set(role.id, role)
  }
  return map
}

function coverageOf(policy, review) {
  const byId = rolesById(review)
  const missingRoles = []
  let rolesCompleted = 0
  for (const roleId of policy.requiredRoles) {
    const verdict = byId.get(roleId)?.verdict
    if (!verdict || verdict === 'skip') missingRoles.push(roleId)
    else rolesCompleted += 1
  }
  return { rolesCompleted, rolesRequired: policy.requiredRoles.length, missingRoles }
}

function anomalyFor(asset, anomalies) {
  const id = asset?.id
  if (!id || !Array.isArray(anomalies)) return []
  return anomalies.filter((entry) => {
    if (!entry || !ANOMALY_KINDS.has(entry.kind)) return false
    if (Array.isArray(entry.requirementIds) && entry.requirementIds.includes(id)) return true
    return (Array.isArray(entry.occurrences) ? entry.occurrences : []).some(
      (occurrence) => occurrence?.assetId === id || occurrence?.uid === id,
    )
  })
}

function findingText(finding) {
  const where = finding?.file ? `${finding.file}${finding.line ? `:${finding.line}` : ''}` : null
  return [finding?.rule, where, finding?.message].filter(Boolean).join(' ')
}

function blockingGaps(review) {
  const roles = (Array.isArray(review?.roles) ? review.roles : []).filter((role) => role?.verdict === 'block')
  return roles.map((role) => {
    const findings = (Array.isArray(role.findings) ? role.findings : []).map(findingText).filter(Boolean)
    return {
      code: 'blockers',
      message: `${role.label ?? role.id}评审存在阻塞项${findings.length > 0 ? `：${findings.join('；')}` : ''}`,
      fix: '修复阻塞项后重新运行评审并保存报告',
      severity: 'block',
    }
  })
}

function anomalyGaps(entries) {
  return entries.map((entry) => {
    const ids = Array.isArray(entry.requirementIds) ? entry.requirementIds.join('、') : ''
    return {
      code: entry.kind,
      message: entry.message ?? `${entry.kind}：${ids}`,
      fix: '保留两条记录并人工澄清，不自动合并、不擅自选一条',
      severity: 'block',
    }
  })
}

function failedGap(latest) {
  const failedIds = (Array.isArray(latest?.commands) ? latest.commands : [])
    .map((command, index) => (command?.exitCode ? command.id ?? `cmd-${index + 1}` : null))
    .filter(Boolean)
  return {
    code: 'acceptance-failed',
    message: `验收执行失败${failedIds.length > 0 ? `：${failedIds.join('、')}` : ''}，不能视为通过`,
    fix: '修复失败项后重新执行验收，生成新的通过证据',
    severity: 'block',
  }
}

const STALE_REASONS = {
  incomplete: '来源或版本不完整（缺少需求修订/测试修订/环境/来源）',
  head: '实现提交已变化',
  requirement: '需求内容已变化',
  tests: '验收用例修订已变化',
}

function staleGap(latest) {
  const reason = STALE_REASONS[latest?.staleReason] ?? '证据与当前版本不一致'
  return {
    code: 'evidence-stale',
    message: `验收证据已过期：${reason}；历史证据保留但不能当作通过`,
    fix: '重新执行验收，生成与当前需求修订、实现提交和用例修订绑定的证据',
    severity: 'warn',
  }
}

function nextStepFor(state, topGap) {
  if (state === 'blocked') return { label: '修复阻塞项', action: 'fix-blockers' }
  if (state === 'needs-clarification') return { label: '处理数据异常', action: 'fix-anomaly' }
  if (state === 'failed') return { label: '修复后重新执行验收', action: 'run-acceptance' }
  if (state === 'stale') return { label: '重新执行验收', action: 'run-acceptance' }
  if (state === 'ready-for-human') return { label: '采纳 AI 评审', action: 'ai-review' }
  if (state === 'verified') return { label: '已通过，无需操作', action: 'none' }
  const code = topGap?.code
  if (code === 'review-not-run') return { label: '运行并保存评审', action: 'run-review' }
  if (code === 'review-not-accepted') return { label: '运行 AI 评审并采纳意见', action: 'ai-review' }
  if (code === 'coverage-incomplete') return { label: '补齐评审视角后重新评审', action: 'run-review' }
  if (code === 'acceptance-missing') return { label: '登记验收命令', action: 'run-acceptance' }
  return { label: '执行验收', action: 'run-acceptance' }
}

const SIGNOFF_CODES = {
  blocked: 'blocked',
  'needs-clarification': 'needs-clarification',
  failed: 'acceptance-failed',
  stale: 'acceptance-stale',
}

function signoffFor(state, gaps) {
  if (state === 'ready-for-human') return { allowed: true, reasons: [] }
  if (state === 'verified') return { allowed: false, reasons: [] }
  const code = SIGNOFF_CODES[state] ?? gaps[0]?.code ?? 'not-ready'
  return {
    allowed: false,
    reasons: gaps.map((gap) => ({ code: state === 'unchecked' ? gap.code : code, message: gap.message })),
  }
}

/**
 * Turn review + acceptance + anomalies into one evidence decision.
 * Priority is strict: blockers > ambiguity > failed > stale > review > coverage
 * > acceptance registration > acceptance run > signed.
 */
export function decideEvidence({ asset, review = null, acceptance = null, anomalies = [], legacyHumanSignoff = false } = {}) {
  const policy = requirementPolicy(asset)
  const coverage = coverageOf(policy, review)
  const blockers = Number(review?.summary?.blockers ?? 0)
  const relatedAnomalies = anomalyFor(asset, anomalies)
  const latest = acceptance?.latest ?? null

  let state
  let gaps = []
  if (blockers > 0) {
    state = 'blocked'
    gaps = blockingGaps(review)
    if (gaps.length === 0) {
      gaps = [
        {
          code: 'blockers',
          message: `存在 ${blockers} 个阻塞项`,
          fix: '修复阻塞项后重新运行评审并保存报告',
          severity: 'block',
        },
      ]
    }
  } else if (relatedAnomalies.length > 0) {
    state = 'needs-clarification'
    gaps = anomalyGaps(relatedAnomalies)
  } else if (latest && latest.current === true && latest.result === 'fail') {
    state = 'failed'
    gaps = [failedGap(latest)]
  } else if (latest && (!latest.complete || !latest.current)) {
    state = 'stale'
    gaps = [staleGap(latest)]
  } else if (!review?.stored) {
    state = 'unchecked'
    gaps = [
      {
        code: 'review-not-run',
        message: '尚未运行并保存评审',
        fix: '运行评审并保存报告后再判断证据',
        severity: 'warn',
      },
    ]
  } else if (coverage.missingRoles.length > 0) {
    state = 'unchecked'
    gaps = [
      {
        code: 'coverage-incomplete',
        message: `评审视角未覆盖：${coverage.missingRoles.join('、')}`,
        fix: '补齐必需评审视角后重新运行评审',
        severity: 'warn',
      },
    ]
  } else if (!acceptance?.registered) {
    state = 'unchecked'
    gaps = [
      {
        code: 'acceptance-missing',
        message: '未登记验收命令',
        fix: '登记可执行的验收命令',
        severity: 'warn',
      },
    ]
  } else if (!latest) {
    state = 'unchecked'
    gaps = [
      {
        code: 'acceptance-not-run',
        message: '验收尚未执行',
        fix: '执行已登记的验收命令并归档证据',
        severity: 'warn',
      },
    ]
  } else if (review?.signoffValid === true || review?.signoff?.valid === true) {
    state = 'verified'
    gaps = []
  } else {
    if (legacyHumanSignoff) {
      // Backward-compatible path for the old signReview API. The product UI no
      // longer offers a human sign-off button; adopting the AI review records
      // acceptance directly. This flag keeps the legacy endpoint gate testable.
      state = 'ready-for-human'
      gaps = []
    } else {
      // No separate human sign-off step: an AI review counts as accepted once
      // its suggestions are adopted (which records the acceptance sign-off).
      state = 'unchecked'
      gaps = [
        {
          code: 'review-not-accepted',
          message: 'AI 评审尚未采纳',
          fix: '运行 AI 评审并采纳意见；采纳即视为评审通过，无需人工签收',
          severity: 'warn',
        },
      ]
    }
  }

  const topGap = gaps[0] ?? null
  return {
    schema: EVIDENCE_SCHEMA,
    state,
    label: LABELS[state],
    tone: TONES[state],
    topGap,
    gaps,
    nextStep: nextStepFor(state, topGap),
    signoff: signoffFor(state, gaps),
    policy,
    coverage,
  }
}
