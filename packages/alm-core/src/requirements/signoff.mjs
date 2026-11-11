import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { acceptanceSummary } from '../acceptance/acceptance.mjs'
import { gitHead } from '../approvals/approval.mjs'
import { indexReport } from '../commands.mjs'
import { decideEvidence } from '../evidence/decision.mjs'
import { requirementContentHash, sha256 } from '../model/content-hash.mjs'
import { candidateView } from './candidate.mjs'
import { requireTrustedHumanSubject } from './identity.mjs'

export const SIGNOFF_SCHEMA = 'alm.requirement-signoff/v1'
export const SIGNOFF_DIR = '.alm/signoffs'

export class RequirementSignoffError extends Error {
  constructor(message, { code = 'signoff', status = 400 } = {}) {
    super(message)
    this.name = 'RequirementSignoffError'
    this.code = code
    this.status = status
  }
}

function signoffPath(root, requirementId) {
  return join(resolve(root), SIGNOFF_DIR, `${requirementId}.json`)
}

function legacyReviewPath(root, requirementId) {
  return join(resolve(root), '.alm/reviews', `${requirementId}.json`)
}

function parseJson(file) {
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function humanApprovals(payload) {
  const entries = Array.isArray(payload?.signoffs) ? payload.signoffs : payload?.signoff ? [payload.signoff] : []
  return entries.filter(
    (entry) => entry?.decision === 'approve' && String(entry?.actor ?? '').startsWith('human:'),
  )
}

/**
 * Read trusted-human requirement sign-offs. The old review file is a read-only
 * migration source; every new write goes exclusively to `.alm/signoffs`.
 */
export function readRequirementSignoffs(root, requirementId) {
  const current = parseJson(signoffPath(root, requirementId))
  if (current?.schema === SIGNOFF_SCHEMA) {
    const signoffs = humanApprovals(current)
    return { ...current, signoffs, signoff: signoffs.at(-1) ?? null }
  }

  const legacy = parseJson(legacyReviewPath(root, requirementId))
  const signoffs = humanApprovals(legacy)
  if (signoffs.length === 0) return null
  return {
    schema: SIGNOFF_SCHEMA,
    requirement: requirementId,
    signoffs,
    signoff: signoffs.at(-1),
    migratedFrom: '.alm/reviews',
    stored: false,
  }
}

function currentAcceptance(root, asset, acceptance) {
  if (acceptance) return acceptance
  const indexed = indexReport(root)
  return acceptanceSummary(root, asset.id, gitHead(root) ?? null, {
    asset,
    assets: indexed.assets ?? [],
  })
}

function bindingIsCurrent(signoff, { contentHash, candidate, acceptance }) {
  if (!signoff || signoff.contentHash !== contentHash) return false
  if (!candidate?.exists || !candidate.current) return false
  if (!signoff.candidateId || signoff.candidateId !== candidate.id) return false
  if ((signoff.candidateHash ?? null) !== (candidate.treeHash ?? null)) return false

  const latest = acceptance?.latest ?? null
  if (!latest || latest.result !== 'pass' || latest.current !== true || latest.complete === false) return false
  if ((signoff.requirementHash ?? null) !== (latest.requirementHash ?? null)) return false
  if ((signoff.testRevision ?? null) !== (latest.testRevision ?? null)) return false
  if (signoff.headSha && latest.headSha && signoff.headSha !== latest.headSha) return false
  return true
}

/** A minimal trusted-human view; it intentionally exposes no review metadata. */
export function signoffView({ root, asset, acceptance = null, candidate = null, anomalies = [] }) {
  void anomalies
  const repo = resolve(root)
  const acceptanceInput = currentAcceptance(repo, asset, acceptance)
  const candidateInput = candidate ?? candidateView({ root: repo, asset, acceptance: acceptanceInput })
  const stored = readRequirementSignoffs(repo, asset.id)
  const binding = {
    contentHash: requirementContentHash({ root: repo, asset }),
    candidate: candidateInput,
    acceptance: acceptanceInput,
  }
  const signoffs = (stored?.signoffs ?? []).map(entry => ({ ...entry, valid: bindingIsCurrent(entry, binding) }))
  const signoff = signoffs.at(-1) ?? null
  const valid = signoff?.valid === true
  return {
    schema: 'alm.requirement-signoff-view/v1',
    requirement: asset.id,
    signoff,
    signoffs,
    signoffValid: valid,
    evidenceBound: Boolean(valid && signoff?.evidenceHash && signoff?.candidateId),
  }
}

function refusalCode(decision) {
  const code = decision.topGap?.code
  if (code === 'candidate-missing') return 'candidate-missing'
  if (['candidate-stale', 'candidate-incomplete', 'requirement-changed', 'head-changed', 'worktree-changed'].includes(code)) {
    return 'candidate-stale'
  }
  if (decision.state === 'needs-clarification') return 'needs-clarification'
  if (decision.state === 'failed') return 'acceptance-failed'
  if (decision.state === 'stale') return code?.startsWith('candidate') ? 'candidate-stale' : 'acceptance-stale'
  if (code === 'acceptance-missing' || code === 'acceptance-not-run') return code
  return 'not-ready'
}

/**
 * Record a trusted human's acceptance of the current delivery candidate.
 * AI review/adoption is deliberately absent from this gate.
 */
export function signRequirement({ root, asset, actor, subject = null, apply = false, acceptance = null, anomalies = [], expectedCandidate = null }) {
  const principal = requireTrustedHumanSubject(subject, {
    actor,
    error: (message) => new RequirementSignoffError(message, { code: 'untrusted-subject', status: 403 }),
  })
  const repo = resolve(root)
  const acceptanceInput = currentAcceptance(repo, asset, acceptance)
  const candidate = candidateView({ root: repo, asset, acceptance: acceptanceInput })
  if (expectedCandidate && (expectedCandidate.id !== candidate.id || expectedCandidate.treeHash !== candidate.treeHash)) {
    throw new RequirementSignoffError('交付候选已更新，请重新打开验收清单，核对新交付后再确认。', { code: 'signoff-candidate-changed', status: 409 })
  }
  const current = signoffView({ root: repo, asset, acceptance: acceptanceInput, anomalies })
  const decision = decideEvidence({
    asset,
    acceptance: acceptanceInput,
    anomalies,
    candidate,
    humanAcceptance: current,
  })
  const contentHash = requirementContentHash({ root: repo, asset })
  const plan = {
    schema: 'alm.requirement-signoff.plan/v1',
    requirement: asset.id,
    actor: principal.id,
    contentHash,
    alreadySigned: current.signoffValid,
    signoff: decision.signoff,
    candidate,
    decision,
    applied: false,
  }
  if (decision.state === 'verified') return plan
  if (!decision.signoff.allowed) {
    throw new RequirementSignoffError(decision.topGap?.message ?? '证据不完整，不能验收', {
      code: refusalCode(decision),
      status: 409,
    })
  }
  if (!apply) return plan

  const latest = acceptanceInput?.latest ?? null
  const headSha = gitHead(repo) ?? latest?.headSha ?? null
  const requirementHash = latest?.requirementHash ?? null
  const testRevision = latest?.testRevision ?? null
  const signoff = {
    actor: principal.id,
    subject: principal,
    decision: 'approve',
    at: new Date().toISOString(),
    headSha,
    contentHash,
    requirementHash,
    testRevision,
    evidenceHash: sha256(`${requirementHash}${testRevision}${headSha}`),
    candidateId: candidate.id,
    candidateHash: candidate.treeHash ?? null,
  }

  const previous = readRequirementSignoffs(repo, asset.id)
  const signoffs = [...(previous?.signoffs ?? []), signoff]
  const record = {
    schema: SIGNOFF_SCHEMA,
    requirement: asset.id,
    signoffs,
    signoff,
  }
  const dir = join(repo, SIGNOFF_DIR)
  mkdirSync(dir, { recursive: true })
  writeFileSync(signoffPath(repo, asset.id), `${JSON.stringify(record, null, 2)}\n`, 'utf8')
  return { ...plan, applied: true, signoff }
}
