/**
 * Feedback ledger storage.
 *
 * `.alm/feedback/` holds three small JSON stores: settings, feedback records
 * (`records/FB-NNNN.json`) and proposals (`proposals/IMP-NNNN.json`). Every
 * write is atomic (temp file + rename), every read tolerates a missing or
 * corrupt file, and no reader may throw because of one bad record.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { sha256 } from '../model/content-hash.mjs'
import {
  CONTEXT_SNAPSHOT_ID,
  FEEDBACK_RECORD_ID,
  FEEDBACK_PROPOSAL_ID,
  feedbackProposalPath,
  feedbackProposalsDir,
  feedbackRecordPath,
  feedbackRecordsDir,
  feedbackSettingsPath,
  isFeedbackProposalId,
  isFeedbackRecordId,
  padSequence,
  readDirSafe,
  resolveRoot,
} from './paths.mjs'

export const FEEDBACK_SCHEMA = 'alm.feedback/v1'
export const FEEDBACK_CONTEXT_SCHEMA = 'alm.feedback.context/v1'
export const FEEDBACK_SETTINGS_SCHEMA = 'alm.feedback.settings/v1'
export const FEEDBACK_INBOX_SCHEMA = 'alm.feedback.inbox/v1'
export const PROPOSAL_SCHEMA = 'alm.proposal/v1'

export const FEEDBACK_CATEGORIES = ['undetermined', 'defect', 'experience', 'capability']
export const FEEDBACK_CATEGORY_LABELS = {
  undetermined: '待判断',
  defect: '缺陷',
  experience: '体验',
  capability: '新能力',
}
export const FEEDBACK_STATUSES = ['saved', 'needs-routing', 'routed', 'requirement-created', 'failed', 'ignored']
export const FEEDBACK_STAGES = ['intent', 'review', 'run', 'test', 'acceptance', 'list', 'detail']
export const FEEDBACK_PAGES = ['intent', 'review', 'run', 'test', 'acceptance', 'list', 'detail', 'settings', 'other']
export const PROPOSAL_STATUSES = ['awaiting-confirmation', 'confirmed', 'converted', 'failed']
export const PROPOSAL_KINDS = ['defect', 'improvement', 'capability', 'investigation']

export const FEEDBACK_LIMITS = {
  statement: 4000,
  excerpt: 160,
  note: 500,
  recordBytes: 64 * 1024,
  envelopeBytes: 52 * 1024,
  list: 50,
}

export const DEFAULT_FEEDBACK_SETTINGS = Object.freeze({
  schema: FEEDBACK_SETTINGS_SCHEMA,
  enabled: false,
  destinationWorkspace: null,
  coverage: { stages: [...FEEDBACK_STAGES] },
  capture: { includeAttachments: false, retentionDays: 90, maxRecords: 500 },
  updatedAt: null,
  updatedBy: null,
})

export class FeedbackError extends Error {
  constructor(message, { code = 'feedback', status = 400, details = null } = {}) {
    super(message)
    this.name = 'FeedbackError'
    this.code = code
    this.status = status
    if (details) this.details = details
  }
}

export function feedbackError(code, message, status = 400, details = null) {
  return new FeedbackError(message, { code, status, ...(details ? { details } : {}) })
}

/* ------------------------------------------------------------------ */
/* small helpers                                                       */
/* ------------------------------------------------------------------ */

let tempCounter = 0

function atomicWrite(absolute, content) {
  mkdirSync(dirname(absolute), { recursive: true })
  const temp = `${absolute}.tmp-${process.pid}-${Date.now()}-${++tempCounter}`
  try {
    writeFileSync(temp, content, 'utf8')
    renameSync(temp, absolute)
  } finally {
    rmSync(temp, { force: true })
  }
}

export function writeJson(absolute, value) {
  atomicWrite(absolute, `${JSON.stringify(value, null, 2)}\n`)
}

/** Parse JSON, returning `null` instead of throwing on a missing/corrupt file. */
export function readJson(absolute) {
  try {
    return JSON.parse(readFileSync(absolute, 'utf8'))
  } catch {
    return null
  }
}

export function toIso(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString()
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString()
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString()
  }
  return new Date().toISOString()
}

export function nowIso() {
  return new Date().toISOString()
}

export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function oneLine(value, max = 300) {
  const text = String(value ?? '').replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text
}

export function byteLength(value) {
  return Buffer.byteLength(JSON.stringify(value))
}

function maxSequence(dir, prefix, pattern) {
  let max = 0
  for (const name of readDirSafe(dir)) {
    const match = pattern.exec(name)
    if (!match) continue
    const value = Number(match[1])
    if (Number.isInteger(value)) max = Math.max(max, value)
  }
  return max
}

export function allocateFeedbackId(root) {
  const dir = feedbackRecordsDir(root)
  return `FB-${padSequence(maxSequence(dir, 'FB', /^FB-(\d{4})\.json$/) + 1)}`
}

export function allocateProposalId(root) {
  const dir = feedbackProposalsDir(root)
  return `IMP-${padSequence(maxSequence(dir, 'IMP', /^IMP-(\d{4})\.json$/) + 1)}`
}

/** Next `FCTX-NNNN` derived from the ids already frozen in stored records. */
export function allocateContextSnapshotId(root) {
  let max = 0
  for (const record of listStoredFeedback(root)) {
    const value = record?.context?.contextSnapshotId
    if (typeof value !== 'string') continue
    const match = CONTEXT_SNAPSHOT_ID.exec(value)
    if (match) max = Math.max(max, Number(value.slice(5)))
  }
  return `FCTX-${padSequence(max + 1)}`
}

/* ------------------------------------------------------------------ */
/* record store                                                        */
/* ------------------------------------------------------------------ */

/** Raw stored records (valid schema + matching id only), oldest first. */
export function listStoredFeedback(root) {
  const repo = resolveRoot(root)
  const dir = feedbackRecordsDir(repo)
  const records = []
  for (const name of readDirSafe(dir)) {
    const id = name.endsWith('.json') ? name.slice(0, -5) : ''
    if (!isFeedbackRecordId(id)) continue
    const value = readJson(feedbackRecordPath(repo, id))
    if (!value || value.schema !== FEEDBACK_SCHEMA || value.id !== id) continue
    records.push(value)
  }
  records.sort((left, right) => {
    const byTime = String(left.createdAt ?? '').localeCompare(String(right.createdAt ?? ''))
    return byTime !== 0 ? byTime : String(left.id).localeCompare(String(right.id))
  })
  return records
}

export function readStoredFeedback(root, id) {
  const repo = resolveRoot(root)
  const key = String(id ?? '').trim()
  if (!isFeedbackRecordId(key)) return null
  const value = readJson(feedbackRecordPath(repo, key))
  return value && value.schema === FEEDBACK_SCHEMA && value.id === key ? value : null
}

export function writeStoredFeedback(root, record) {
  const repo = resolveRoot(root)
  if (!isFeedbackRecordId(record?.id)) throw feedbackError('invalid-feedback-id', `非法反馈 ID：${record?.id ?? ''}`, 400)
  writeJson(feedbackRecordPath(repo, record.id), record)
  return record
}

export function countStoredFeedbackFiles(root) {
  return readDirSafe(feedbackRecordsDir(root)).filter((name) => /^FB-\d{4}\.json$/.test(name)).length
}

/* ------------------------------------------------------------------ */
/* proposal store                                                      */
/* ------------------------------------------------------------------ */

export function listStoredProposals(root) {
  const repo = resolveRoot(root)
  const dir = feedbackProposalsDir(repo)
  const proposals = []
  for (const name of readDirSafe(dir)) {
    const id = name.endsWith('.json') ? name.slice(0, -5) : ''
    if (!isFeedbackProposalId(id)) continue
    const value = readJson(feedbackProposalPath(repo, id))
    if (!value || value.schema !== PROPOSAL_SCHEMA || value.id !== id) continue
    proposals.push(value)
  }
  proposals.sort((left, right) => String(left.id).localeCompare(String(right.id)))
  return proposals
}

export function readStoredProposal(root, id) {
  const repo = resolveRoot(root)
  const key = String(id ?? '').trim()
  if (!isFeedbackProposalId(key)) return null
  const value = readJson(feedbackProposalPath(repo, key))
  return value && value.schema === PROPOSAL_SCHEMA && value.id === key ? value : null
}

export function writeStoredProposal(root, proposal) {
  const repo = resolveRoot(root)
  if (!isFeedbackProposalId(proposal?.id)) {
    throw feedbackError('invalid-proposal-id', `非法提案 ID：${proposal?.id ?? ''}`, 400)
  }
  writeJson(feedbackProposalPath(repo, proposal.id), proposal)
  return proposal
}

/* ------------------------------------------------------------------ */
/* settings store                                                      */
/* ------------------------------------------------------------------ */

function normalizeDestination(value) {
  if (value === null || value === undefined) return null
  if (!isPlainObject(value)) return null
  const root = typeof value.root === 'string' ? value.root.trim() : ''
  if (root === '') return null
  return {
    workspaceId: typeof value.workspaceId === 'string' && value.workspaceId.trim() !== '' ? value.workspaceId.trim() : null,
    projectId: typeof value.projectId === 'string' && value.projectId.trim() !== '' ? value.projectId.trim() : null,
    root,
  }
}

function normalizeCapture(value, current) {
  if (value === undefined) return { ...current }
  if (!isPlainObject(value)) throw feedbackError('invalid-settings', 'capture 必须是对象', 400)
  const next = { ...current }
  if (value.includeAttachments !== undefined) {
    if (typeof value.includeAttachments !== 'boolean') throw feedbackError('invalid-settings', 'capture.includeAttachments 必须是布尔值', 400)
    next.includeAttachments = value.includeAttachments
  }
  if (value.retentionDays !== undefined) {
    if (!Number.isInteger(value.retentionDays) || value.retentionDays < 1) {
      throw feedbackError('invalid-settings', 'capture.retentionDays 必须是正整数', 400)
    }
    next.retentionDays = value.retentionDays
  }
  if (value.maxRecords !== undefined) {
    if (!Number.isInteger(value.maxRecords) || value.maxRecords < 1 || value.maxRecords > 5000) {
      throw feedbackError('invalid-settings', 'capture.maxRecords 必须是 1..5000 的整数', 400)
    }
    next.maxRecords = value.maxRecords
  }
  return next
}

function normalizeStages(value, current) {
  if (value === undefined) return [...current]
  if (!Array.isArray(value) || value.some((stage) => typeof stage !== 'string')) {
    throw feedbackError('invalid-settings', 'coverage.stages 必须是字符串数组', 400)
  }
  return [...new Set(value.filter((stage) => FEEDBACK_STAGES.includes(stage)))]
}

function readSettingsFile(root) {
  const value = readJson(feedbackSettingsPath(root))
  return value && value.schema === FEEDBACK_SETTINGS_SCHEMA ? value : null
}

/** Read settings merged over the defaults; a missing/corrupt file is "default". */
export function readFeedbackSettings(root) {
  const repo = resolveRoot(root)
  const value = readSettingsFile(repo)
  if (!value) {
    return {
      ...DEFAULT_FEEDBACK_SETTINGS,
      coverage: { stages: [...DEFAULT_FEEDBACK_SETTINGS.coverage.stages] },
      capture: { ...DEFAULT_FEEDBACK_SETTINGS.capture },
    }
  }
  const stages = Array.isArray(value.coverage?.stages)
    ? [...new Set(value.coverage.stages.filter((stage) => FEEDBACK_STAGES.includes(stage)))]
    : [...DEFAULT_FEEDBACK_SETTINGS.coverage.stages]
  const capture = { ...DEFAULT_FEEDBACK_SETTINGS.capture }
  if (typeof value.capture?.includeAttachments === 'boolean') capture.includeAttachments = value.capture.includeAttachments
  if (Number.isInteger(value.capture?.retentionDays) && value.capture.retentionDays > 0) capture.retentionDays = value.capture.retentionDays
  if (Number.isInteger(value.capture?.maxRecords) && value.capture.maxRecords > 0) capture.maxRecords = value.capture.maxRecords
  return {
    schema: FEEDBACK_SETTINGS_SCHEMA,
    // Slice 1 never writes `enabled`; it is read back as stored for slice 2.
    enabled: value.enabled === true,
    destinationWorkspace: normalizeDestination(value.destinationWorkspace),
    coverage: { stages },
    capture,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null,
    updatedBy: typeof value.updatedBy === 'string' ? value.updatedBy : null,
  }
}

/**
 * Update settings. `enabled` is read-only in slice 1 (its value is preserved, a
 * caller-supplied change is ignored without an error). Destination, coverage and
 * capture are validated; `apply: false` only returns the planned value.
 */
export function writeFeedbackSettings({ root, settings = {}, actor = 'human:local', apply = true } = {}) {
  const repo = resolveRoot(root)
  if (!isPlainObject(settings)) throw feedbackError('invalid-settings', 'settings 必须是对象', 400)
  const current = readFeedbackSettings(repo)
  const destination =
    settings.destinationWorkspace === undefined ? current.destinationWorkspace : normalizeDestination(settings.destinationWorkspace)
  if (settings.destinationWorkspace !== undefined && settings.destinationWorkspace !== null && destination === null) {
    throw feedbackError('invalid-destination', 'destinationWorkspace 需要非空的 root', 400)
  }
  const next = {
    schema: FEEDBACK_SETTINGS_SCHEMA,
    enabled: current.enabled,
    destinationWorkspace: destination,
    coverage: { stages: normalizeStages(settings.coverage?.stages, current.coverage.stages) },
    capture: normalizeCapture(settings.capture, current.capture),
    updatedAt: nowIso(),
    updatedBy: String(actor ?? 'human:local'),
  }
  if (apply === true) writeJson(feedbackSettingsPath(repo), next)
  return { applied: apply === true, settings: next }
}

/* ------------------------------------------------------------------ */
/* requirement / proposal links                                        */
/* ------------------------------------------------------------------ */

/** Validate and normalize a `{ root, id, revision }` requirement link. */
export function normalizeRequirementLink(requirement, { root = null } = {}) {
  if (!isPlainObject(requirement)) throw feedbackError('invalid-requirement', '缺少需求关联', 400)
  const id = String(requirement.id ?? '').trim()
  if (!/^REQ-[A-Z0-9]{2,8}-\d{3}$/.test(id)) {
    throw feedbackError('invalid-requirement', `非法需求 ID：${id || '（空）'}`, 400)
  }
  const revision = requirement.revision === undefined || requirement.revision === null ? 1 : Number(requirement.revision)
  if (!Number.isInteger(revision) || revision < 1) {
    throw feedbackError('invalid-requirement', '需求 revision 必须是正整数', 400)
  }
  const linkedRoot =
    typeof requirement.root === 'string' && requirement.root.trim() !== '' ? requirement.root.trim() : root
  if (!linkedRoot) throw feedbackError('invalid-requirement', '需求关联缺少 root', 400)
  return { root: linkedRoot, id, revision }
}

export { sha256 }
