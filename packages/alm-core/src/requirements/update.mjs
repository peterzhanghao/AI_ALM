/**
 * Requirement update: plan the rewritten sdoc/brief, then apply it atomically.
 *
 * Only `title`, `priority` and `brief` may change. The sdoc's TITLE/PRIORITY/
 * REVISION lines are rewritten (revision + 1); every other field and all
 * RELATION blocks stay byte-for-byte. Applying binds the write to the preview
 * baseline (CAS), writes an `alm.audit/v1` event before touching the files,
 * and replays an idempotency key without a second write.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { gitHead } from '../approvals/approval.mjs'
import { indexReport } from '../commands.mjs'
import { relationSnapshotHash, requirementContentHash } from '../model/content-hash.mjs'

export const AUDIT_DIR = '.alm/audit/requirements'
export const AUDIT_SCHEMA = 'alm.audit/v1'
export const IDEMPOTENCY_SCHEMA = 'alm.audit.idempotency/v1'
export const UPDATE_SCHEMA = 'alm.requirement.update/v1'
export const UPDATE_FIELDS = ['title', 'priority', 'brief']

const IDEMPOTENCY_DIR = 'idempotency'
const PRIORITIES = new Set(['P0', 'P1', 'P2', 'P3'])
const MAX_TITLE = 200
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/
const NODE_RE = /^\[([A-Z][A-Z0-9_-]*)\]\s*$/

export class RequirementUpdateError extends Error {
  constructor(message, { code = 'requirement-update', status = 400, ...extra } = {}) {
    super(message)
    this.name = 'RequirementUpdateError'
    this.code = code
    this.status = status
    for (const [key, value] of Object.entries(extra)) {
      if (value !== undefined) this[key] = value
    }
  }
}

/** Validate and normalize one `{ field, value }` change. */
export function normalizeChange(change) {
  if (!change || typeof change !== 'object' || Array.isArray(change)) {
    throw new RequirementUpdateError('change is required', { code: 'invalid-change' })
  }
  const field = String(change.field ?? '')
  if (!UPDATE_FIELDS.includes(field)) {
    throw new RequirementUpdateError(`unsupported change field: ${field} (allowed: ${UPDATE_FIELDS.join(', ')})`, {
      code: 'invalid-change',
    })
  }
  const raw = change.value
  if (typeof raw !== 'string') {
    throw new RequirementUpdateError(`change.value must be a string for ${field}`, { code: 'invalid-change' })
  }

  if (field === 'title') {
    if (CONTROL_CHARS.test(raw)) {
      throw new RequirementUpdateError('title must not contain control characters or newlines', { code: 'invalid-title' })
    }
    const value = raw.trim()
    if (value === '') throw new RequirementUpdateError('title is required', { code: 'title-required' })
    if (value.length > MAX_TITLE) {
      throw new RequirementUpdateError(`title is too long (max ${MAX_TITLE})`, { code: 'title-too-long' })
    }
    return { field, value }
  }

  if (field === 'priority') {
    const value = raw.trim()
    if (!PRIORITIES.has(value)) {
      throw new RequirementUpdateError(`invalid priority: ${value} (allowed: P0-P3)`, { code: 'invalid-priority' })
    }
    return { field, value }
  }

  // brief: the value is the complete Markdown document, kept verbatim.
  return { field, value: raw }
}

export function revisionOf(asset) {
  const revision = Number(asset?.extra?.revision ?? 1)
  return Number.isInteger(revision) && revision > 0 ? revision : 1
}

/** Snapshot hash bundle a preview is bound to; apply compares it (CAS). */
export function requirementBaseline({ root, asset }) {
  const repo = resolve(root)
  return {
    contentHash: requirementContentHash({ root: repo, asset }),
    relationHash: relationSnapshotHash({ asset }),
    headSha: gitHead(repo) ?? null,
    revision: revisionOf(asset),
  }
}

/** Re-read the requirement from disk so CAS compares against the real state. */
function freshRequirement({ repo, requirementId, fallback }) {
  try {
    const index = indexReport(repo)
    if (!index || index.ok === false) return fallback
    return index.assets.find((entry) => entry.id === requirementId) ?? fallback
  } catch {
    return fallback
  }
}

/** Reject a preview whose baseline no longer matches the requirement on disk. */
export function assertBaseline({ root, asset, expectedBaseline }) {
  if (!expectedBaseline || typeof expectedBaseline !== 'object' || Array.isArray(expectedBaseline)) {
    throw new RequirementUpdateError('expectedBaseline is required to apply a previewed change', {
      code: 'baseline-required',
    })
  }
  if (typeof expectedBaseline.contentHash !== 'string' || typeof expectedBaseline.relationHash !== 'string') {
    throw new RequirementUpdateError('expectedBaseline needs contentHash and relationHash', { code: 'baseline-required' })
  }
  const current = requirementBaseline({ root, asset })
  if (current.contentHash !== expectedBaseline.contentHash || current.relationHash !== expectedBaseline.relationHash) {
    throw new RequirementUpdateError('the requirement changed after this preview; reload it and confirm again', {
      code: 'stale-preview',
      status: 409,
      baseline: current,
    })
  }
  return current
}

function safeAbsolute(repo, filePath, code = 'invalid-path') {
  const raw = String(filePath ?? '').trim()
  if (raw === '' || isAbsolute(raw)) {
    throw new RequirementUpdateError(`unsafe file path: ${String(filePath)}`, { code })
  }
  const target = resolve(repo, raw)
  const rel = relative(repo, target)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new RequirementUpdateError(`unsafe file path: ${String(filePath)}`, { code })
  }
  return target
}

function nodeKind(line) {
  const match = NODE_RE.exec(line.trim())
  return match ? match[1] : null
}

/** Locate the `[REQUIREMENT]` block that owns `id`; RELATION stays inside it. */
function requirementBlockRange(lines, id) {
  const starts = []
  for (let index = 0; index < lines.length; index += 1) {
    if (nodeKind(lines[index]) === 'REQUIREMENT') starts.push(index)
  }
  for (const start of starts) {
    let end = lines.length
    for (let index = start + 1; index < lines.length; index += 1) {
      const kind = nodeKind(lines[index])
      if (kind === 'REQUIREMENT' || kind === 'DOCUMENT' || kind === 'SECTION') {
        end = index
        break
      }
    }
    for (let index = start; index < end; index += 1) {
      const uid = /^UID\s*:\s*(.*)$/.exec(lines[index].trim())
      if (uid) {
        if (uid[1].trim() === id) return { start, end }
        break
      }
    }
  }
  return null
}

function setField(lines, range, key, value) {
  const fieldRe = new RegExp(`^${key}\\s*:`)
  for (let index = range.start; index < range.end; index += 1) {
    if (fieldRe.test(lines[index].trim())) {
      lines[index] = `${key}: ${value}`
      return
    }
  }
  const anchors = key === 'TITLE' ? ['UID'] : key === 'PRIORITY' ? ['TITLE', 'UID'] : ['PRIORITY', 'TITLE', 'UID']
  let insertAt = range.start + 1
  let anchored = false
  for (const anchor of anchors) {
    const anchorRe = new RegExp(`^${anchor}\\s*:`)
    for (let index = range.start; index < range.end; index += 1) {
      if (anchorRe.test(lines[index].trim())) {
        insertAt = index + 1
        anchored = true
        break
      }
    }
    if (anchored) break
  }
  lines.splice(insertAt, 0, `${key}: ${value}`)
}

/**
 * Rewrite only the requested sdoc fields inside the matching requirement block.
 * Document/section titles and every other line are preserved.
 */
function rewriteRequirement({ content, id, fields }) {
  const lines = content.split('\n')
  for (const [key, value] of Object.entries(fields)) {
    const range = requirementBlockRange(lines, id)
    if (!range) {
      throw new RequirementUpdateError(`cannot find [REQUIREMENT] ${id} in the source file`, {
        code: 'file-invalid',
        status: 409,
      })
    }
    setField(lines, range, key, value)
  }
  return lines.join('\n')
}

/**
 * Plan one requirement update. Planning never writes: it returns the file,
 * before/after snapshots and (for a brief change) the brief target/content.
 */
export function planRequirementUpdate({ root, asset, change }) {
  const repo = resolve(root)
  if (!asset || typeof asset !== 'object' || typeof asset.id !== 'string' || asset.id === '') {
    throw new RequirementUpdateError('requirement asset is required', { code: 'unknown-requirement', status: 404 })
  }
  const normalized = normalizeChange(change)
  const file = asset.source?.path
  if (typeof file !== 'string' || file.trim() === '') {
    throw new RequirementUpdateError(`requirement ${asset.id} has no source file`, {
      code: 'unknown-requirement',
      status: 404,
    })
  }
  const absolute = safeAbsolute(repo, file)
  if (!existsSync(absolute)) {
    throw new RequirementUpdateError(`requirement file not found: ${file}`, { code: 'file-missing', status: 409 })
  }

  const content = readFileSync(absolute, 'utf8')
  const revision = revisionOf(asset)
  const before = { content, title: asset.title, priority: asset.extra?.priority ?? null, revision }
  const after = { content, title: before.title, priority: before.priority, revision: revision + 1 }

  const fields = {}
  if (normalized.field === 'title') {
    after.title = normalized.value
    fields.TITLE = normalized.value
  } else if (normalized.field === 'priority') {
    after.priority = normalized.value
    fields.PRIORITY = normalized.value
  }
  fields.REVISION = String(after.revision)
  after.content = rewriteRequirement({ content, id: asset.id, fields })

  const plan = { file, before, after }
  if (normalized.field === 'brief') {
    const brief = asset.extra?.brief
    if (typeof brief !== 'string' || brief.trim() === '') {
      throw new RequirementUpdateError(`requirement ${asset.id} has no BRIEF field to update`, { code: 'brief-missing' })
    }
    safeAbsolute(repo, brief)
    plan.briefFile = brief
    plan.briefContent = normalized.value
  }
  return plan
}

function utcStamp(iso) {
  return iso.replace(/[-:.]/g, '')
}

function safeSegment(value) {
  const text = String(value ?? '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 96)
  return text === '' ? 'empty' : text
}

function idempotencyPath(repo, requirementId, idempotencyKey) {
  return join(resolve(repo), AUDIT_DIR, IDEMPOTENCY_DIR, `${safeSegment(requirementId)}__${safeSegment(idempotencyKey)}.json`)
}

/** Replay record of the first successful apply for one idempotency key. */
export function readIdempotentResult({ root, requirementId, idempotencyKey }) {
  if (typeof idempotencyKey !== 'string' || idempotencyKey.trim() === '') return null
  const file = idempotencyPath(root, requirementId, idempotencyKey)
  if (!existsSync(file)) return null
  try {
    const payload = JSON.parse(readFileSync(file, 'utf8'))
    if (payload?.schema !== IDEMPOTENCY_SCHEMA) return null
    if (!payload.result || typeof payload.result !== 'object') return null
    return payload.result
  } catch {
    return null
  }
}

function writeIdempotentResult({ root, requirementId, idempotencyKey, result }) {
  const file = idempotencyPath(root, requirementId, idempotencyKey)
  const payload = {
    schema: IDEMPOTENCY_SCHEMA,
    requirement: requirementId,
    idempotencyKey,
    at: new Date().toISOString(),
    result,
  }
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  } catch {
    // A missing replay record must never turn an applied change into an error.
  }
}

function writeAuditEvent({ repo, asset, actor, change, plan, baseline, impactSummary, at, idempotencyKey }) {
  const dir = join(repo, AUDIT_DIR)
  mkdirSync(dir, { recursive: true })
  const base = `${safeSegment(asset.id)}-${utcStamp(at)}-${safeSegment(idempotencyKey)}`
  let file = join(dir, `${base}.json`)
  // Same key retried within one millisecond must not overwrite the first draft.
  for (let attempt = 2; existsSync(file); attempt += 1) file = join(dir, `${base}-${attempt}.json`)
  const payload = {
    schema: AUDIT_SCHEMA,
    requirement: asset.id,
    actor,
    change,
    before: plan.before,
    after: plan.after,
    baseline,
    impactSummary: impactSummary ?? null,
    at,
    idempotencyKey,
    ...(plan.briefFile ? { briefFile: plan.briefFile } : {}),
  }
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  return relative(repo, file).split(sep).join('/')
}

let tempCounter = 0

/** Write via a sibling temp file + rename so readers never see half a file. */
function atomicWrite({ absolute, content, writeFile }) {
  mkdirSync(dirname(absolute), { recursive: true })
  const temp = `${absolute}.tmp-${process.pid}-${(tempCounter += 1)}`
  try {
    writeFile(temp, content, 'utf8')
    renameSync(temp, absolute)
  } finally {
    rmSync(temp, { force: true })
  }
}

function rollbackWrites(written) {
  for (const entry of [...written].reverse()) {
    try {
      if (entry.previous === null) rmSync(entry.absolute, { force: true })
      else writeFileSync(entry.absolute, entry.previous)
    } catch {
      // Best effort: the primary error is already being reported.
    }
  }
}

/**
 * Apply a planned update atomically. `expectedBaseline` is mandatory (CAS).
 * The audit event is written before the files; a failure returns no half state
 * (`applied:false`) but keeps the audit draft (`draftRetained:true`).
 */
export function applyRequirementUpdate({
  root,
  asset,
  change,
  expectedBaseline,
  actor,
  idempotencyKey,
  writeFile = writeFileSync,
  impactSummary = null,
  resultExtra = null,
} = {}) {
  const repo = resolve(root)
  if (!asset || typeof asset !== 'object' || typeof asset.id !== 'string' || asset.id === '') {
    throw new RequirementUpdateError('requirement asset is required', { code: 'unknown-requirement', status: 404 })
  }
  const actorId = String(actor ?? '').trim()
  if (actorId === '') {
    throw new RequirementUpdateError('actor is required for an audited update', { code: 'actor-required' })
  }
  if (typeof writeFile !== 'function') {
    throw new RequirementUpdateError('writeFile must be a function', { code: 'invalid-write-file' })
  }

  const key = String(idempotencyKey ?? '').trim() || `auto-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  const replay = readIdempotentResult({ root: repo, requirementId: asset.id, idempotencyKey: key })
  if (replay) return { ...replay, applied: true, idempotent: true }

  // CAS is evaluated against the current disk state, not the caller's snapshot.
  const current = freshRequirement({ repo, requirementId: asset.id, fallback: asset })
  const plan = planRequirementUpdate({ root: repo, asset: current, change })
  const normalized = normalizeChange(change)
  const baseline = assertBaseline({ root: repo, asset: current, expectedBaseline })

  const at = new Date().toISOString()
  let auditFile
  try {
    auditFile = writeAuditEvent({
      repo,
      asset: current,
      actor: actorId,
      change: normalized,
      plan,
      baseline,
      impactSummary,
      at,
      idempotencyKey: key,
    })
  } catch (error) {
    throw new RequirementUpdateError(`audit event could not be written: ${error?.message ?? String(error)}`, {
      code: 'audit-failed',
      status: 500,
      applied: false,
      draftRetained: false,
    })
  }

  const targets = []
  if (plan.briefFile) targets.push({ file: plan.briefFile, content: plan.briefContent })
  targets.push({ file: plan.file, content: plan.after.content })

  const written = []
  try {
    for (const target of targets) {
      const absolute = safeAbsolute(repo, target.file)
      const previous = existsSync(absolute) ? readFileSync(absolute) : null
      atomicWrite({ absolute, content: target.content, writeFile })
      written.push({ absolute, previous })
    }
  } catch (error) {
    rollbackWrites(written)
    throw new RequirementUpdateError(
      `update could not be written (${error?.message ?? String(error)}); already-written files were rolled back`,
      {
        code: 'write-failed',
        status: 500,
        applied: false,
        draftRetained: true,
        auditFile,
        cause: error,
      },
    )
  }

  const result = {
    schema: UPDATE_SCHEMA,
    requirement: asset.id,
    applied: true,
    idempotent: false,
    file: plan.file,
    ...(plan.briefFile ? { briefFile: plan.briefFile } : {}),
    revision: plan.after.revision,
    baseline,
    change: normalized,
    before: plan.before,
    after: plan.after,
    auditFile,
    writes: targets.map((target) => ({ file: target.file })),
    signoffInvalidated: true,
    evidenceStale: true,
  }
  const merged = resultExtra && typeof resultExtra === 'object' && !Array.isArray(resultExtra)
    ? { ...result, ...resultExtra }
    : result
  writeIdempotentResult({ root: repo, requirementId: asset.id, idempotencyKey: key, result: merged })
  return merged
}
