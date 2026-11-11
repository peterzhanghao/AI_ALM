/**
 * Context envelope for a piece of manual feedback.
 *
 * The envelope is a *bounded, honest* snapshot: unknown fields are dropped,
 * absent fields are omitted instead of being invented, secrets are redacted and
 * oversized values are truncated with `captureBoundary.truncated` set. Manual
 * feedback is always `current-only`: there is no recorded event history, and
 * the envelope must never imply otherwise.
 */
import { basename, isAbsolute } from 'node:path'
import {
  FEEDBACK_CONTEXT_SCHEMA,
  FEEDBACK_LIMITS,
  FEEDBACK_PAGES,
  FEEDBACK_STAGES,
  allocateContextSnapshotId,
  byteLength,
  feedbackError,
  isPlainObject,
  oneLine,
  toIso,
} from './store.mjs'
import { redactValue } from './redact.mjs'
import { CONTEXT_SNAPSHOT_ID, resolveRoot } from './paths.mjs'

const TARGET_PRODUCT = 'dsh-requirements-plugin'
const COMPONENTS = ['intent', 'review', 'run', 'acceptance', 'list']
const MAX_DEPTH = 6
const MAX_ARRAY = 50
const MAX_STRING = 4000

function normalizeText(value, max = MAX_STRING) {
  if (typeof value !== 'string') return undefined
  const text = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim()
  if (text === '') return undefined
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text
}

function normalizeString(value, max = MAX_STRING) {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function capArray(value) {
  return Array.isArray(value) ? value.slice(0, MAX_ARRAY) : []
}

function normalizeIdList(value) {
  if (!Array.isArray(value)) return undefined
  const list = capArray(value)
    .filter((entry) => typeof entry === 'string' && entry.trim() !== '')
    .map((entry) => entry.trim())
  return list.length > 0 ? [...new Set(list)] : undefined
}

function normalizeObservedWorkspace(source, repo, projectId) {
  const raw = isPlainObject(source.observedWorkspace) ? source.observedWorkspace : {}
  const workspaceId =
    typeof raw.workspaceId === 'string' && raw.workspaceId.trim() !== '' ? raw.workspaceId.trim() : basename(repo) || 'workspace'
  const observedProject = typeof projectId === 'string' && projectId.trim() !== '' ? projectId.trim() : typeof raw.projectId === 'string' && raw.projectId.trim() !== '' ? raw.projectId.trim() : null
  return { projectId: observedProject, workspaceId, root: repo }
}

function normalizeTargetProduct(source) {
  const raw = isPlainObject(source.targetProduct) ? source.targetProduct : {}
  const product = normalizeString(raw.product) ?? TARGET_PRODUCT
  const target = { product }
  if (typeof raw.component === 'string' && COMPONENTS.includes(raw.component)) target.component = raw.component
  if (normalizeString(raw.pluginVersion)) target.pluginVersion = normalizeString(raw.pluginVersion).slice(0, 80)
  return target
}

function normalizeDestinationWorkspace(destination) {
  if (!isPlainObject(destination)) return undefined
  const root = typeof destination.root === 'string' ? destination.root.trim() : ''
  if (root === '' || !isAbsolute(root)) return undefined
  const out = { configured: true }
  if (normalizeString(destination.workspaceId)) out.workspaceId = normalizeString(destination.workspaceId)
  if (normalizeString(destination.projectId)) out.projectId = normalizeString(destination.projectId)
  out.root = root
  return out
}

function normalizeUi(source, truncated) {
  const raw = isPlainObject(source.ui) ? source.ui : null
  if (!raw) return undefined
  const ui = {}
  ui.page = typeof raw.page === 'string' && FEEDBACK_PAGES.includes(raw.page) ? raw.page : 'other'
  if (typeof raw.stage === 'string' && FEEDBACK_STAGES.includes(raw.stage)) ui.stage = raw.stage
  const viewState = sanitizeViewState(raw.viewState)
  if (viewState !== undefined) ui.viewState = viewState
  const summary = normalizeText(raw.unsavedSummary, 500)
  if (summary !== undefined) {
    ui.unsavedSummary = summary
    if (typeof raw.unsavedSummary === 'string' && raw.unsavedSummary.length > 500) truncated.value = true
  }
  return ui
}

function sanitizeViewState(value, depth = 0) {
  if (depth > 3 || !isPlainObject(value)) return undefined
  const out = {}
  let count = 0
  for (const [key, entry] of Object.entries(value)) {
    if (count >= 30) break
    if (entry === null || entry === undefined) continue
    if (typeof entry === 'string') {
      out[key] = entry.length > 200 ? `${entry.slice(0, 199)}…` : entry
      count += 1
      continue
    }
    if (typeof entry === 'number' || typeof entry === 'boolean') {
      out[key] = entry
      count += 1
      continue
    }
    const nested = sanitizeViewState(entry, depth + 1)
    if (nested !== undefined) {
      out[key] = nested
      count += 1
    }
  }
  if (Object.keys(out).length === 0) return undefined
  if (byteLength(out) > 2000) return undefined
  return out
}

/**
 * A requirement reference must survive a workspace switch. The file identity is
 * relative (absolute paths are redacted anyway) and the revision pins the copy
 * the user was looking at, so `REQ-X` in two workspaces never collapses.
 */
function normalizeRequirementFile(value) {
  const text = normalizeString(value)
  if (text === undefined) return undefined
  const cleaned = text.replaceAll('\\', '/').replace(/^\.\//, '').trim()
  if (cleaned === '' || cleaned.startsWith('/') || /^[A-Za-z]:/.test(cleaned)) return undefined
  return oneLine(cleaned, 400)
}

function normalizeLinks(source) {
  const raw = isPlainObject(source.links) ? source.links : null
  if (!raw) return undefined
  const links = {}
  if (normalizeString(raw.intentSessionId)) links.intentSessionId = normalizeString(raw.intentSessionId).slice(0, 120)
  if (normalizeString(raw.requirementId)) links.requirementId = normalizeString(raw.requirementId).slice(0, 120)
  if (Number.isInteger(raw.requirementRevision) && raw.requirementRevision > 0) links.requirementRevision = raw.requirementRevision
  const requirementFile = normalizeRequirementFile(raw.requirementFile)
  if (requirementFile !== undefined) links.requirementFile = requirementFile
  if (normalizeString(raw.requirementInstanceKey)) links.requirementInstanceKey = normalizeString(raw.requirementInstanceKey).slice(0, 200)
  for (const key of ['runIds', 'failureIds']) {
    const list = normalizeIdList(raw[key])
    if (list !== undefined) links[key] = list
  }
  if (normalizeString(raw.candidateId)) links.candidateId = normalizeString(raw.candidateId).slice(0, 120)
  if (normalizeString(raw.acceptanceDecisionId)) links.acceptanceDecisionId = normalizeString(raw.acceptanceDecisionId).slice(0, 120)
  return Object.keys(links).length > 0 ? links : undefined
}

/**
 * Capture provenance: when the user clicked, which build they clicked in, and
 * whether that timestamp came from the client or was filled server-side. The
 * client clock is a *claim*, not a trusted clock; `capturedAt` stays server
 * time and both values are kept so a time-zone or clock bug is visible.
 */
function normalizeCapture(source, options) {
  const raw = isPlainObject(source.capture) ? source.capture : {}
  const observedAt = toIso(source.observedAt ?? raw.observedAt ?? options.observedAt)
  const timeSource =
    normalizeString(raw.timeSource) ??
    (observedAt !== undefined ? 'client' : 'server')
  const capture = {
    kind: normalizeString(raw.kind)?.slice(0, 60) ?? 'client-click',
    timeSource: timeSource === 'client' ? 'client' : 'server',
  }
  if (normalizeString(raw.client)) capture.client = normalizeString(raw.client).slice(0, 80)
  if (normalizeString(raw.clientBuild)) capture.clientBuild = normalizeString(raw.clientBuild).slice(0, 120)
  if (observedAt !== undefined) capture.observedAt = observedAt
  return capture
}

function normalizeRuntime(source) {
  const raw = isPlainObject(source.runtime) ? source.runtime : null
  if (!raw) return undefined
  const runtime = {}
  if (normalizeString(raw.hostVersion)) runtime.hostVersion = normalizeString(raw.hostVersion).slice(0, 80)
  if (normalizeString(raw.pluginVersion)) runtime.pluginVersion = normalizeString(raw.pluginVersion).slice(0, 80)
  const model = isPlainObject(raw.model) ? raw.model : null
  if (model && (normalizeString(model.provider) || normalizeString(model.model))) {
    runtime.model = {}
    if (normalizeString(model.provider)) runtime.model.provider = normalizeString(model.provider).slice(0, 80)
    if (normalizeString(model.model)) runtime.model.model = normalizeString(model.model).slice(0, 120)
  }
  const errorCodes = normalizeIdList(raw.errorCodes)
  if (errorCodes !== undefined) runtime.errorCodes = errorCodes.map((code) => code.slice(0, 80)).slice(0, 20)
  if (isPlainObject(raw.timingMs)) {
    const timing = {}
    for (const [key, value] of Object.entries(raw.timingMs)) {
      if (Object.keys(timing).length >= 20) break
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) timing[key] = value
    }
    if (Object.keys(timing).length > 0) runtime.timingMs = timing
  }
  return Object.keys(runtime).length > 0 ? runtime : undefined
}

function normalizeEvidence(source, { includeAttachments, truncated }) {
  const raw = isPlainObject(source.evidence) ? source.evidence : null
  const recentError = normalizeText(source.recentError, 600)
  if (!raw && recentError === undefined) return undefined
  const evidence = { eventRange: null, screenshotRef: null }
  const excerpts = []
  if (Array.isArray(raw?.textExcerpts) && raw.textExcerpts.length > 0) {
    for (const entry of capArray(raw.textExcerpts)) {
      if (!isPlainObject(entry)) continue
      const text = normalizeText(entry.text)
      if (text === undefined) continue
      excerpts.push({
        label: oneLine(entry.label ?? '摘录', 120),
        text,
        truncated: entry.truncated === true || text.length !== String(entry.text ?? '').length,
      })
    }
  }
  // Legacy clients send the visible error as `recentError`; it used to be
  // dropped by the UI whitelist, which made "已附带最近错误" a lie. Store it in
  // the supported excerpt field instead of inventing a second error shape.
  if (recentError !== undefined && excerpts.length === 0) {
    excerpts.push({ label: '最近错误', text: recentError, truncated: recentError.length < String(source.recentError).length })
  }
  if (excerpts.length > 0) evidence.textExcerpts = excerpts
  if (includeAttachments && Array.isArray(raw?.attachments) && raw.attachments.length > 0) {
    const attachments = []
    for (const entry of capArray(raw.attachments)) {
      if (!isPlainObject(entry)) continue
      const name = normalizeString(entry.name)
      if (!name) continue
      const out = { name: name.slice(0, 200) }
      if (typeof entry.size === 'number' && Number.isFinite(entry.size) && entry.size >= 0) out.size = Math.floor(entry.size)
      if (typeof entry.sha256 === 'string' && /^[0-9a-f]{64}$/i.test(entry.sha256)) out.sha256 = entry.sha256.toLowerCase()
      if (typeof entry.type === 'string' && entry.type.trim() !== '') out.type = oneLine(entry.type, 80).toLowerCase()
      // A client may echo a stored reference back. Only the canonical content
      // addressed location is accepted; arbitrary paths never reach the record.
      if (typeof entry.path === 'string') {
        const relative = entry.path.split(String.fromCharCode(92)).join('/')
        if (/^[.]alm[/]feedback[/]attachments[/][0-9a-f]{64}[.][a-z0-9]+$/.test(relative)) out.path = relative
      }
      attachments.push(out)
    }
    if (attachments.length > 0) evidence.attachments = attachments
  }
  return evidence
}

function normalizeUserStatement(source, statement) {
  const raw = isPlainObject(source.userStatement) ? source.userStatement : null
  const text = normalizeText(statement ?? raw?.text)
  if (text === undefined) return undefined
  const out = { text }
  const expected = normalizeText(raw?.expected)
  if (expected !== undefined) out.expected = expected
  return out
}

function normalizeCaptureBoundary(source) {
  const raw = isPlainObject(source.captureBoundary) ? source.captureBoundary : null
  const notCoveredStages = ['未记录的历史操作']
  if (Array.isArray(raw?.notCoveredStages)) {
    for (const stage of capArray(raw.notCoveredStages)) {
      if (typeof stage === 'string' && stage.trim() !== '' && !notCoveredStages.includes(stage.trim())) {
        notCoveredStages.push(stage.trim())
      }
    }
  }
  return {
    mode: 'current-only',
    coveredStages: [],
    notCoveredStages,
    truncated: false,
    missing: [],
  }
}

/** Trim large strings until the envelope fits; marks `captureBoundary.truncated`. */
function fitEnvelope(envelope, maxBytes) {
  if (byteLength(envelope) <= maxBytes) return envelope
  envelope.captureBoundary = { ...(envelope.captureBoundary ?? {}), truncated: true }
  const candidates = []
  const collect = (value, path) => {
    if (typeof value === 'string') {
      if (value.length > 120) candidates.push(path)
      return
    }
    if (Array.isArray(value)) {
      value.forEach((entry, index) => collect(entry, [...path, index]))
      return
    }
    if (isPlainObject(value)) {
      for (const [key, entry] of Object.entries(value)) collect(entry, [...path, key])
    }
  }
  collect(envelope, [])
  candidates.sort((left, right) => {
    const get = (path) => path.reduce((acc, key) => acc?.[key], envelope)
    return String(get(right) ?? '').length - String(get(left) ?? '').length
  })
  for (const path of candidates) {
    if (byteLength(envelope) <= maxBytes) break
    const parent = path.slice(0, -1).reduce((acc, key) => acc?.[key], envelope)
    const key = path[path.length - 1]
    if (!parent || typeof parent[key] !== 'string') continue
    parent[key] = `${parent[key].slice(0, Math.max(60, Math.floor(parent[key].length / 2)))}…`
  }
  if (byteLength(envelope) > maxBytes) {
    delete envelope.evidence?.textExcerpts
    delete envelope.ui?.viewState
  }
  return envelope
}

/**
 * Build the contract context envelope from raw (plugin supplied) data.
 *
 * @param {object} raw
 * @param {{root?: string, now?: string|number|Date, projectId?: string|null,
 *          destination?: object|null, statement?: string,
 *          contextSnapshotId?: string, includeAttachments?: boolean}} options
 */
export function normalizeContextEnvelope(raw, options = {}) {
  if (raw !== undefined && raw !== null && !isPlainObject(raw)) {
    throw feedbackError('invalid-context', 'context 必须是对象', 400)
  }
  const source = isPlainObject(raw) ? raw : {}
  const repo = resolveRoot(options.root ?? source.observedWorkspace?.root)
  const truncated = { value: false }
  const contextSnapshotId =
    typeof source.contextSnapshotId === 'string' && CONTEXT_SNAPSHOT_ID.test(source.contextSnapshotId)
      ? source.contextSnapshotId
      : typeof options.contextSnapshotId === 'string' && CONTEXT_SNAPSHOT_ID.test(options.contextSnapshotId)
        ? options.contextSnapshotId
        : allocateContextSnapshotId(repo)

  const envelope = {
    schema: FEEDBACK_CONTEXT_SCHEMA,
    contextSnapshotId,
    capturedAt: toIso(options.now ?? source.capturedAt),
    observedWorkspace: normalizeObservedWorkspace(source, repo, options.projectId),
    targetProduct: normalizeTargetProduct(source),
  }

  const capture = normalizeCapture(source, options)
  if (capture.observedAt !== undefined) envelope.observedAt = capture.observedAt
  envelope.capture = capture

  const destination = normalizeDestinationWorkspace(options.destination ?? source.destinationWorkspace)
  if (destination !== undefined) envelope.destinationWorkspace = destination

  const ui = normalizeUi(source, truncated)
  if (ui !== undefined) envelope.ui = ui
  const links = normalizeLinks(source)
  if (links !== undefined) envelope.links = links
  const runtime = normalizeRuntime(source)
  if (runtime !== undefined) envelope.runtime = runtime
  const includeAttachments = options.includeAttachments === true
  const evidence = normalizeEvidence(source, { includeAttachments, truncated })
  if (evidence !== undefined) envelope.evidence = evidence
  const userStatement = normalizeUserStatement(source, options.statement)
  if (userStatement !== undefined) envelope.userStatement = userStatement

  envelope.captureBoundary = normalizeCaptureBoundary(source)
  envelope.captureBoundary.truncated = truncated.value

  const { value: redacted, redactions } = redactValue(envelope)
  const final = redacted
  final.captureBoundary.truncated = final.captureBoundary.truncated === true || truncated.value
  final.redactions = { applied: redactions.length > 0, fields: redactions }
  return fitEnvelope(final, FEEDBACK_LIMITS.envelopeBytes)
}
