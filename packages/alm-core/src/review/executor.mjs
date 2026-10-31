import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { gitHead } from '../approvals/approval.mjs'

export const REVIEW_DIR = '.alm/reviews'
export const REVIEW_SCHEMA = 'alm.review/v1'
const HUMAN_ACTOR = /^human:[A-Za-z0-9._-]+$/

export class ReviewError extends Error {
  constructor(message, { code = 'review', status = 400 } = {}) {
    super(message)
    this.name = 'ReviewError'
    this.code = code
    this.status = status
  }
}

/** Five review roles, mapped onto rules that already exist in the gate pack. */
export const REVIEW_ROLES = [
  { id: 'business', label: '业务', rules: ['BRIEF-001'] },
  { id: 'architecture', label: '架构', rules: ['REL-001', 'REL-002', 'REL-003', 'PRJ-001', 'REV-001'] },
  { id: 'testing', label: '测试', rules: ['COV-001', 'COV-002'] },
  { id: 'security', label: '安全', rules: ['SEC-001'] },
  { id: 'delivery', label: '交付', rules: ['ATT-001', 'TASK-001'] },
]

export function reviewPath(root, requirementId) {
  return join(resolve(root), REVIEW_DIR, `${requirementId}.json`)
}

function findingHits(finding, item) {
  if (!finding) return false
  return finding.assetId === item.id || finding.file === item.file
}

/** Gate-backed multi-role review: no second source of truth, no AI call. */
export function reviewFromGates(item, check) {
  const checks = new Map((check.checks ?? []).map((entry) => [entry.id, entry]))
  const roles = REVIEW_ROLES.map((role) => {
    const findings = []
    const levels = []
    for (const ruleId of role.rules) {
      const rule = checks.get(ruleId)
      if (!rule) continue
      levels.push(rule.level)
      for (const finding of rule.findings ?? []) {
        if (!findingHits(finding, item)) continue
        findings.push({
          rule: ruleId,
          severity: rule.level === 'warn' ? 'warn' : 'block',
          message: finding.message,
          file: finding.file ?? null,
          line: finding.line ?? null,
        })
      }
    }
    const active = levels.filter((level) => level !== 'skip' && level !== 'off')
    let verdict
    if (active.length === 0) verdict = 'skip'
    else if (findings.some((finding) => finding.severity === 'block')) verdict = 'block'
    else if (findings.length > 0) verdict = 'warn'
    else verdict = 'pass'
    return { id: role.id, label: role.label, verdict, rules: role.rules, findings }
  })
  const blockers = roles.filter((role) => role.verdict === 'block').length
  return {
    schema: REVIEW_SCHEMA,
    source: 'gates',
    roles,
    summary: {
      completed: roles.filter((role) => role.verdict !== 'skip').length,
      total: roles.length,
      blockers,
      ready: blockers === 0,
    },
    signoff: null,
  }
}

function sortedExtra(extra = {}) {
  return Object.fromEntries(Object.entries(extra).sort(([left], [right]) => left.localeCompare(right)))
}

/**
 * Content hash of the requirement as reviewed: canonical fields + relations
 * + brief file bytes. Any content change makes an existing sign-off stale.
 */
export function requirementContentHash({ root, asset }) {
  const briefPath = asset?.extra?.brief ? join(resolve(root), asset.extra.brief) : null
  const brief = briefPath && existsSync(briefPath) ? readFileSync(briefPath, 'utf8') : ''
  const canonical = JSON.stringify({
    id: asset.id,
    type: asset.type,
    title: asset.title,
    status: asset.status,
    owner: asset.owner,
    extra: sortedExtra(asset.extra),
    links: [...(asset.links ?? [])]
      .map((link) => ({ type: link.type, target: link.target }))
      .sort((left, right) => `${left.type}|${left.target}`.localeCompare(`${right.type}|${right.target}`)),
    brief,
  })
  return createHash('sha256').update(canonical).digest('hex')
}

export function readReviewReport(root, requirementId) {
  const file = reviewPath(root, requirementId)
  if (!existsSync(file)) return null
  try {
    const payload = JSON.parse(readFileSync(file, 'utf8'))
    return payload.schema === REVIEW_SCHEMA ? { ...payload, file } : null
  } catch {
    return null
  }
}

export function writeReviewReport(root, report) {
  const file = reviewPath(root, report.requirement)
  mkdirSync(join(resolve(root), REVIEW_DIR), { recursive: true })
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  return file
}

/** Fresh review view: persisted report when present, gate-derived otherwise. */
export function reviewView({ root, asset, item, check }) {
  const currentHash = requirementContentHash({ root, asset })
  const stored = readReviewReport(root, asset.id)
  if (!stored) {
    return { ...reviewFromGates(item, check), source: 'gates', stored: false, contentHash: currentHash, signoffValid: false }
  }
  const signoff = stored.signoff ?? null
  return {
    ...stored,
    stored: true,
    contentHash: currentHash,
    signoff: signoff ? { ...signoff, valid: signoff.contentHash === currentHash } : null,
    signoffValid: Boolean(signoff && signoff.contentHash === currentHash),
  }
}

/** Generate a persisted report from the current gates (fresh executor run). */
export function runReview({ root, asset, item, check, apply = false }) {
  const report = {
    ...reviewFromGates(item, check),
    requirement: asset.id,
    source: 'executor',
    generatedAt: new Date().toISOString(),
    headSha: gitHead(resolve(root)) ?? null,
    contentHash: requirementContentHash({ root, asset }),
    signoff: null,
  }
  if (!apply) return { ...report, applied: false }
  const file = writeReviewReport(root, report)
  return { ...report, file, applied: true }
}

/**
 * Human sign-off: only allowed on a stored report whose content hash still
 * matches the working tree and which has no blockers. Dry-run returns the plan.
 */
export function signReview({ root, asset, actor, apply = false }) {
  if (!HUMAN_ACTOR.test(String(actor ?? ''))) {
    throw new ReviewError('actor must be human:<login>', { code: 'invalid-actor' })
  }
  const stored = readReviewReport(root, asset.id)
  if (!stored) throw new ReviewError('先运行评审并保存报告，才能人工签收', { code: 'no-review', status: 409 })
  const currentHash = requirementContentHash({ root, asset })
  if (stored.contentHash !== currentHash) {
    throw new ReviewError('评审报告已过期（内容已变化），请重新运行评审', { code: 'review-stale', status: 409 })
  }
  if ((stored.summary?.blockers ?? 0) > 0) {
    throw new ReviewError('存在阻塞项，不能签收', { code: 'has-blockers', status: 409 })
  }
  const plan = {
    schema: 'alm.signoff.plan/v1',
    requirement: asset.id,
    actor,
    contentHash: currentHash,
    alreadySigned: Boolean(stored.signoff && stored.signoff.contentHash === currentHash),
    applied: false,
  }
  if (!apply) return plan

  const signoff = {
    actor,
    decision: 'approve',
    at: new Date().toISOString(),
    headSha: stored.headSha ?? null,
    contentHash: currentHash,
  }
  writeReviewReport(root, { ...stored, signoff })
  return { ...plan, applied: true, signoff }
}
