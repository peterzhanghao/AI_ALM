/**
 * Close a requirement without developing it: rewrite its STATUS to `archived`
 * and bump REVISION in one atomic write.
 *
 * This is a deliberate, audited operation, not an edit: the caller must pass a
 * baseline from a preview (CAS), an actor and a reason. An already archived
 * requirement is not archived twice.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { indexReport } from '../commands.mjs'
import { relationSnapshotHash, requirementContentHash } from '../model/content-hash.mjs'

export const ARCHIVE_SCHEMA = 'alm.requirement.archive/v1'
export const ARCHIVE_STATUS = 'archived'
export const ARCHIVE_DIR = '.alm/audit/requirements'
export const ARCHIVE_IDEMPOTENCY_SCHEMA = 'alm.audit.idempotency/v1'

/** Statuses a user may close. Terminal statuses are already out of scope. */
export const ARCHIVABLE_STATUSES = ['proposed', 'accepted', 'in-progress', 'implemented', 'verified']

const MAX_REASON = 500
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/
const NODE_RE = /^\[([A-Z][A-Z0-9_-]*)\]\s*$/

export class ArchiveError extends Error {
  constructor(message, { code = 'requirement-archive', status = 400, ...extra } = {}) {
    super(message)
    this.name = 'ArchiveError'
    this.code = code
    this.status = status
    for (const [key, value] of Object.entries(extra)) if (value !== undefined) this[key] = value
  }
}

export function revisionOf(asset) {
  const revision = Number(asset?.extra?.revision ?? 1)
  return Number.isInteger(revision) && revision > 0 ? revision : 1
}

export function archiveBaseline({ root, asset }) {
  const repo = resolve(root)
  return {
    contentHash: requirementContentHash({ root: repo, asset }),
    relationHash: relationSnapshotHash({ asset }),
    revision: revisionOf(asset),
  }
}

export function normalizeReason(reason) {
  if (reason === undefined || reason === null) return ''
  if (typeof reason !== 'string') throw new ArchiveError('reason must be a string', { code: 'invalid-reason' })
  if (CONTROL_CHARS.test(reason)) throw new ArchiveError('reason must not contain control characters', { code: 'invalid-reason' })
  const value = reason.trim()
  if (value.length > MAX_REASON) throw new ArchiveError(`reason is too long (max ${MAX_REASON})`, { code: 'invalid-reason' })
  return value
}

function safeRelative(repo, filePath) {
  const raw = String(filePath ?? '').trim()
  if (raw === '' || isAbsolute(raw)) throw new ArchiveError(`unsafe file path: ${raw}`, { code: 'invalid-path' })
  const target = resolve(repo, raw)
  const rel = relative(repo, target)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) throw new ArchiveError(`unsafe file path: ${raw}`, { code: 'invalid-path' })
  return target
}

function nodeKind(line) {
  const match = NODE_RE.exec(line.trim())
  return match ? match[1] : null
}

function requirementBlockRange(lines, id) {
  const starts = []
  for (let index = 0; index < lines.length; index += 1) if (nodeKind(lines[index]) === 'REQUIREMENT') starts.push(index)
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

function rewriteArchived({ content, id, status, revision }) {
  const lines = content.split('\n')
  const range = requirementBlockRange(lines, id)
  if (!range) throw new ArchiveError(`cannot find [REQUIREMENT] ${id} in the source file`, { code: 'file-invalid', status: 409 })
  let hasStatus = false
  let hasRevision = false
  for (let index = range.start; index < range.end; index += 1) {
    if (/^STATUS\s*:/.test(lines[index].trim())) {
      lines[index] = `STATUS: ${status}`
      hasStatus = true
    } else if (/^REVISION\s*:/.test(lines[index].trim())) {
      lines[index] = `REVISION: ${revision}`
      hasRevision = true
    }
  }
  if (!hasStatus) throw new ArchiveError(`[REQUIREMENT] ${id} has no STATUS field`, { code: 'file-invalid', status: 409 })
  if (!hasRevision) {
    const at = lines.findIndex((line, index) => index >= range.start && index < range.end && /^STATUS\s*:/.test(line.trim()))
    lines.splice(at + 1, 0, `REVISION: ${revision}`)
  }
  return lines.join('\n')
}

/**
 * Plan an archive without writing. The file/before/after/baseline are what the
 * UI shows; apply re-reads the requirement and compares the same baseline.
 */
export function planArchive({ root, asset, reason }) {
  const repo = resolve(root)
  if (!asset || typeof asset !== 'object' || typeof asset.id !== 'string' || asset.id === '') {
    throw new ArchiveError('requirement asset is required', { code: 'unknown-requirement', status: 404 })
  }
  if (asset.status === ARCHIVE_STATUS) {
    throw new ArchiveError(`${asset.id} 已归档，无需重复关闭`, { code: 'already-archived', status: 409 })
  }
  if (!ARCHIVABLE_STATUSES.includes(asset.status)) {
    throw new ArchiveError(`当前状态 ${asset.status} 不能关闭归档（仅活跃需求）`, { code: 'invalid-status', status: 409 })
  }
  const file = asset.source?.path
  if (typeof file !== 'string' || file.trim() === '') {
    throw new ArchiveError(`requirement ${asset.id} has no source file`, { code: 'unknown-requirement', status: 404 })
  }
  const absolute = safeRelative(repo, file)
  if (!existsSync(absolute)) throw new ArchiveError(`requirement file not found: ${file}`, { code: 'file-missing', status: 409 })
  const content = readFileSync(absolute, 'utf8')
  const revision = revisionOf(asset) + 1
  const afterContent = rewriteArchived({ content, id: asset.id, status: ARCHIVE_STATUS, revision })
  return {
    schema: ARCHIVE_SCHEMA,
    applied: false,
    requirement: asset.id,
    file,
    status: { from: asset.status, to: ARCHIVE_STATUS },
    revision,
    reason: normalizeReason(reason),
    baseline: archiveBaseline({ root: repo, asset }),
    before: { status: asset.status, revision: revisionOf(asset), content },
    after: { status: ARCHIVE_STATUS, revision, content: afterContent },
  }
}

function assertBaseline({ root, asset, expectedBaseline }) {
  if (!expectedBaseline || typeof expectedBaseline !== 'object' || Array.isArray(expectedBaseline)) {
    throw new ArchiveError('expectedBaseline is required to archive a requirement', { code: 'baseline-required' })
  }
  const current = archiveBaseline({ root, asset })
  if (current.contentHash !== expectedBaseline.contentHash || current.relationHash !== expectedBaseline.relationHash) {
    throw new ArchiveError('需求在预览后发生了变化，请重新读取后再关闭', { code: 'stale-preview', status: 409, baseline: current })
  }
  return current
}

function safeSegment(value) {
  const text = String(value ?? '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 96)
  return text === '' ? 'empty' : text
}

function idempotencyPath(repo, requirementId, key) {
  return join(repo, ARCHIVE_DIR, 'idempotency', `${safeSegment(requirementId)}__${safeSegment(key)}.json`)
}

function readIdempotent({ repo, requirementId, key }) {
  if (typeof key !== 'string' || key.trim() === '') return null
  const file = idempotencyPath(repo, requirementId, key)
  if (!existsSync(file)) return null
  try {
    const payload = JSON.parse(readFileSync(file, 'utf8'))
    if (payload?.schema !== ARCHIVE_IDEMPOTENCY_SCHEMA || !payload.result) return null
    return payload.result
  } catch {
    return null
  }
}

function writeIdempotent({ repo, requirementId, key, result }) {
  const file = idempotencyPath(repo, requirementId, key)
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(
      file,
      `${JSON.stringify({ schema: ARCHIVE_IDEMPOTENCY_SCHEMA, requirement: requirementId, idempotencyKey: key, at: new Date().toISOString(), result }, null, 2)}\n`,
      'utf8',
    )
  } catch {
    // Replay is best effort; the archive itself already succeeded.
  }
}

function writeAudit({ repo, plan, actor, baseline, at, key }) {
  const dir = join(repo, ARCHIVE_DIR)
  mkdirSync(dir, { recursive: true })
  const stamp = at.replace(/[-:.]/g, '')
  const base = `${safeSegment(plan.requirement)}-${stamp}-archive-${safeSegment(key)}`
  let file = join(dir, `${base}.json`)
  for (let attempt = 2; existsSync(file); attempt += 1) file = join(dir, `${base}-${attempt}.json`)
  const payload = {
    schema: 'alm.audit/v1',
    kind: 'archive',
    requirement: plan.requirement,
    actor,
    at,
    idempotencyKey: key,
    status: plan.status,
    reason: plan.reason,
    file: plan.file,
    baseline,
    before: plan.before,
    after: plan.after,
  }
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  return relative(repo, file).split(sep).join('/')
}

function freshRequirement(repo, asset) {
  try {
    const index = indexReport(repo)
    if (!index || index.ok === false) return asset
    const file = asset?.source?.path
    return index.assets.find((entry) => entry.id === asset.id && (!file || entry.source.path === file)) ?? asset
  } catch {
    return asset
  }
}

function atomicWrite(absolute, content, writeFile) {
  mkdirSync(dirname(absolute), { recursive: true })
  const temp = `${absolute}.tmp-${process.pid}-${Date.now()}`
  try {
    writeFile(temp, content, 'utf8')
    renameSync(temp, absolute)
  } finally {
    rmSync(temp, { force: true })
  }
}

/**
 * Apply an archive. `expectedBaseline` is mandatory (CAS). The audit event is
 * written before the sdoc; a write failure leaves no half state.
 */
export function applyArchive({ root, asset, expectedBaseline, actor, reason, idempotencyKey, writeFile = writeFileSync } = {}) {
  const repo = resolve(root)
  if (!asset || typeof asset !== 'object' || typeof asset.id !== 'string' || asset.id === '') {
    throw new ArchiveError('requirement asset is required', { code: 'unknown-requirement', status: 404 })
  }
  const actorId = String(actor ?? '').trim()
  if (actorId === '') throw new ArchiveError('actor is required to archive', { code: 'actor-required' })
  if (typeof writeFile !== 'function') throw new ArchiveError('writeFile must be a function', { code: 'invalid-write-file' })

  const key = String(idempotencyKey ?? '').trim() || `auto-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  const replay = readIdempotent({ repo, requirementId: asset.id, key })
  if (replay) return { ...replay, applied: true, idempotent: true }

  const current = freshRequirement(repo, asset)
  if (current.status === ARCHIVE_STATUS) {
    throw new ArchiveError(`${asset.id} 已归档，无需重复关闭`, { code: 'already-archived', status: 409 })
  }
  const plan = planArchive({ root: repo, asset: current, reason })
  const baseline = assertBaseline({ root: repo, asset: current, expectedBaseline })
  const at = new Date().toISOString()
  const auditFile = writeAudit({ repo, plan, actor: actorId, baseline, at, key })
  const absolute = safeRelative(repo, plan.file)
  try {
    atomicWrite(absolute, plan.after.content, writeFile)
  } catch (error) {
    try {
      writeFile(absolute, plan.before.content, 'utf8')
    } catch {
      // Best effort rollback; the primary error is reported.
    }
    throw new ArchiveError(`归档写入失败：${error?.message ?? String(error)}`, {
      code: 'write-failed',
      status: 500,
      applied: false,
      auditFile,
      draftRetained: true,
    })
  }

  const result = {
    schema: ARCHIVE_SCHEMA,
    requirement: plan.requirement,
    applied: true,
    idempotent: false,
    file: plan.file,
    status: plan.status,
    revision: plan.revision,
    reason: plan.reason,
    baseline,
    auditFile,
    evidenceStale: true,
  }
  writeIdempotent({ repo, requirementId: plan.requirement, key, result })
  return result
}
