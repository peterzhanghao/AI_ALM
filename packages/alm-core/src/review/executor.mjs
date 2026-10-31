import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { gitHead } from '../approvals/approval.mjs'
import { acceptanceSummary } from '../acceptance/acceptance.mjs'
import { indexReport } from '../commands.mjs'
import { requirementContentHash, sha256 } from '../model/content-hash.mjs'
import { decideEvidence } from '../evidence/decision.mjs'

export { requirementContentHash } from '../model/content-hash.mjs'

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

/** Missing perspectives: a skipped role means the review never covered it. */
function roleCoverage(report) {
  const roles = Array.isArray(report?.roles) ? report.roles : []
  const missing = roles.filter((role) => role?.verdict === 'skip').map((role) => role.id)
  return { completed: roles.length - missing.length, total: roles.length, missing }
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
      coverage: roleCoverage({ roles }),
    },
    signoff: null,
  }
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

/** Stored report in the same shape decideEvidence expects from reviewView. */
function storedReviewShape(stored, currentHash) {
  const signoff = stored.signoff ? { ...stored.signoff, valid: stored.signoff.contentHash === currentHash } : null
  return {
    ...stored,
    stored: true,
    contentHash: currentHash,
    signoff,
    signoffValid: Boolean(signoff?.valid),
    evidenceBound: Boolean(signoff?.evidenceHash),
    coverage: stored.summary?.coverage ?? roleCoverage(stored),
  }
}

/** Fresh review view: persisted report when present, gate-derived otherwise. */
export function reviewView({ root, asset, item, check }) {
  const currentHash = requirementContentHash({ root, asset })
  const stored = readReviewReport(root, asset.id)
  if (!stored) {
    const fresh = reviewFromGates(item, check)
    return {
      ...fresh,
      source: 'gates',
      stored: false,
      contentHash: currentHash,
      signoffValid: false,
      evidenceBound: false,
      coverage: fresh.summary.coverage,
    }
  }
  return storedReviewShape(stored, currentHash)
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
  // Re-running the review invalidates the current sign-off but must never erase
  // the audit history of earlier human decisions.
  const existing = readReviewReport(root, asset.id)
  const history = Array.isArray(existing?.signoffs)
    ? existing.signoffs
    : existing?.signoff
      ? [existing.signoff]
      : []
  const persisted = history.length > 0 ? { ...report, signoffs: history } : report
  const file = writeReviewReport(root, persisted)
  return { ...persisted, file, applied: true }
}

/** Backend sign-off gate: map the decision state to the documented 409 code. */
function signoffErrorCode(decision) {
  if (decision.state === 'unchecked') {
    const code = decision.topGap?.code
    if (code === 'coverage-incomplete' || code === 'acceptance-missing' || code === 'acceptance-not-run') return code
    return 'coverage-incomplete'
  }
  if (decision.state === 'blocked') return 'blocked'
  if (decision.state === 'needs-clarification') return 'needs-clarification'
  if (decision.state === 'failed') return 'acceptance-failed'
  if (decision.state === 'stale') return 'acceptance-stale'
  return 'not-ready'
}

/**
 * Human sign-off: only allowed when the persisted review is current and the
 * full evidence decision (blockers, ambiguity, acceptance provenance, coverage,
 * not-yet-signed) allows it. The decision is re-computed here on the backend;
 * client-side button state is never trusted. History is appended, never
 * overwritten, so old sign-offs stay auditable.
 */
export function signReview({ root, asset, actor, apply = false, acceptance = null, anomalies = [] }) {
  if (!HUMAN_ACTOR.test(String(actor ?? ''))) {
    throw new ReviewError('actor must be human:<login>', { code: 'invalid-actor' })
  }
  const stored = readReviewReport(root, asset.id)
  if (!stored) throw new ReviewError('先运行评审并保存报告，才能人工签收', { code: 'no-review', status: 409 })
  const currentHash = requirementContentHash({ root, asset })
  if (stored.contentHash !== currentHash) {
    throw new ReviewError('评审报告已过期（内容已变化），请重新运行评审', { code: 'review-stale', status: 409 })
  }

  const repo = resolve(root)
  const headSha = gitHead(repo) ?? null
  let acceptanceInput = acceptance
  if (!acceptanceInput) {
    const indexed = indexReport(repo)
    const assets = indexed.assets ?? []
    acceptanceInput = acceptanceSummary(repo, asset.id, headSha, { asset, assets })
  }
  const reviewShape = storedReviewShape(stored, currentHash)
  const decision = decideEvidence({ asset, review: reviewShape, acceptance: acceptanceInput, anomalies })

  const plan = {
    schema: 'alm.signoff.plan/v1',
    requirement: asset.id,
    actor,
    contentHash: currentHash,
    alreadySigned: Boolean(reviewShape.signoff?.valid),
    signoff: decision.signoff,
    policy: decision.policy,
    coverage: decision.coverage,
    decision,
    applied: false,
  }
  // An already-valid sign-off is idempotent: nothing to write, nothing to fix.
  if (decision.state === 'verified') return plan
  if (!decision.signoff.allowed) {
    throw new ReviewError(decision.topGap?.message ?? '证据不完整，不能签收', {
      code: signoffErrorCode(decision),
      status: 409,
    })
  }
  if (!apply) return plan

  const latest = acceptanceInput?.latest ?? null
  const requirementHash = latest?.requirementHash ?? null
  const testRevision = latest?.testRevision ?? null
  const boundHead = headSha ?? latest?.headSha ?? null
  const signoff = {
    actor,
    decision: 'approve',
    at: new Date().toISOString(),
    headSha: boundHead,
    contentHash: currentHash,
    requirementHash,
    testRevision,
    evidenceHash: sha256(`${requirementHash}${testRevision}${boundHead}`),
  }
  const history = Array.isArray(stored.signoffs)
    ? [...stored.signoffs]
    : stored.signoff
      ? [stored.signoff]
      : []
  history.push(signoff)
  writeReviewReport(repo, { ...stored, signoffs: history, signoff })
  return { ...plan, applied: true, signoff }
}
