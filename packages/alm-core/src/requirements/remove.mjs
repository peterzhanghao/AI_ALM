/**
 * Remove a requirement record from the repository.
 *
 * Archive keeps a record and moves it out of the active funnel; remove is the
 * destructive counterpart for records that should never have existed (test
 * leftovers, duplicate imports). It is still audited: the full previous file
 * content is written to `.alm/audit/requirements/` before anything is deleted,
 * so recovery remains possible.
 *
 * A file that holds a single requirement is deleted whole. An sdoc that holds
 * several `[REQUIREMENT]` blocks only loses the target block, leaving the rest
 * of the document intact.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { indexReport } from '../commands.mjs'
import {
  ARCHIVE_DIR,
  ArchiveError,
  normalizeReason,
  revisionOf,
} from './archive.mjs'
import { archiveBaseline } from './archive.mjs'

export const REMOVE_SCHEMA = 'alm.requirement.remove/v1'
export const REMOVE_IDEMPOTENCY_SCHEMA = 'alm.audit.idempotency/v1'

const NODE_RE = /^\[([A-Z][A-Z0-9_-]*)\]\s*$/

function requireAsset(asset) {
  if (!asset || typeof asset !== 'object' || typeof asset.id !== 'string' || asset.id === '') {
    throw new ArchiveError('requirement asset is required', { code: 'unknown-requirement', status: 404 })
  }
}

function safeRelative(repo, filePath) {
  const raw = String(filePath ?? '').trim()
  if (raw === '') throw new ArchiveError('requirement file path is empty', { code: 'file-invalid', status: 409 })
  const target = resolve(repo, raw)
  const rel = relative(repo, target)
  if (rel === '' || rel.startsWith('..') || rel.includes(`..${sep}`)) {
    throw new ArchiveError(`unsafe file path: ${raw}`, { code: 'invalid-path', status: 409 })
  }
  return target
}

function isSdoc(asset, file) {
  const format = String(asset?.source?.format ?? '').toLowerCase()
  return format === 'sdoc' || /\.sdoc$/i.test(String(file ?? ''))
}

/** Locate a `[REQUIREMENT]` block for one UID; returns null when it is absent. */
function requirementBlockRange(lines, id) {
  const starts = []
  for (let index = 0; index < lines.length; index += 1) {
    const match = NODE_RE.exec(lines[index].trim())
    if (match && match[1] === 'REQUIREMENT') starts.push(index)
  }
  for (const start of starts) {
    let end = lines.length
    for (let index = start + 1; index < lines.length; index += 1) {
      const match = NODE_RE.exec(lines[index].trim())
      if (match && (match[1] === 'REQUIREMENT' || match[1] === 'DOCUMENT' || match[1] === 'SECTION')) {
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

function countRequirements(assetFile, assets) {
  return assets.filter((entry) => entry.type === 'requirement' && entry.source?.path === assetFile).length
}

function trimTrailingBlank(lines, start, end) {
  let stop = end
  while (stop > start && lines[stop - 1].trim() === '') stop -= 1
  return stop
}

export function planRemove({ root, asset, reason }) {
  const repo = resolve(root)
  requireAsset(asset)
  const file = asset.source?.path
  if (typeof file !== 'string' || file.trim() === '') {
    throw new ArchiveError(`requirement ${asset.id} has no source file`, { code: 'unknown-requirement', status: 404 })
  }
  const absolute = safeRelative(repo, file)
  if (!existsSync(absolute)) throw new ArchiveError(`requirement file not found: ${file}`, { code: 'file-missing', status: 409 })
  const content = readFileSync(absolute, 'utf8')
  const index = indexReport(repo)
  if (index.ok === false) throw new ArchiveError(index.error ?? 'index failed', { code: 'index-failed', status: 500 })
  const siblings = countRequirements(file, index.assets)
  const sdoc = isSdoc(asset, file)
  let after = null
  if (sdoc && siblings > 1) {
    const lines = content.split('\n')
    const range = requirementBlockRange(lines, asset.id)
    if (!range) throw new ArchiveError(`cannot find [REQUIREMENT] ${asset.id} in the source file`, { code: 'file-invalid', status: 409 })
    const stop = trimTrailingBlank(lines, range.start, range.end)
    const kept = [...lines.slice(0, range.start), ...lines.slice(stop)]
    after = kept.join('\n')
  }
  return {
    schema: REMOVE_SCHEMA,
    applied: false,
    requirement: asset.id,
    title: asset.title ?? null,
    file,
    format: sdoc ? 'sdoc' : String(asset.source?.format ?? 'yaml'),
    status: asset.status,
    mode: after === null ? 'file' : 'block',
    siblings,
    reason: normalizeReason(reason),
    baseline: archiveBaseline({ root: repo, asset }),
    before: { content, revision: revisionOf(asset) },
    after: after === null ? null : { content: after },
  }
}

function safeSegment(value) {
  const text = String(value ?? '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 96)
  return text === '' ? 'empty' : text
}

function writeAudit({ repo, plan, actor, baseline, at, key }) {
  const dir = join(repo, ARCHIVE_DIR)
  mkdirSync(dir, { recursive: true })
  const stamp = at.replace(/[-:.]/g, '')
  const base = `${safeSegment(plan.requirement)}-${stamp}-remove-${safeSegment(key)}`
  let file = join(dir, `${base}.json`)
  for (let attempt = 2; existsSync(file); attempt += 1) file = join(dir, `${base}-${attempt}.json`)
  writeFileSync(
    file,
    `${JSON.stringify(
      {
        schema: 'alm.audit/v1',
        kind: 'remove',
        requirement: plan.requirement,
        actor,
        at,
        idempotencyKey: key,
        reason: plan.reason,
        file: plan.file,
        mode: plan.mode,
        baseline,
        before: plan.before,
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
  return relative(repo, file).split(sep).join('/')
}

function atomicWrite(absolute, content) {
  mkdirSync(dirname(absolute), { recursive: true })
  const temp = `${absolute}.tmp-${process.pid}-${Date.now()}`
  try {
    writeFileSync(temp, content, 'utf8')
    renameSync(temp, absolute)
  } finally {
    rmSync(temp, { force: true })
  }
}

/**
 * Delete the requirement. Requires an actor and a CAS baseline (from preview);
 * the audit write happens before deletion, so a crash leaves a recoverable
 * record rather than a silent loss.
 */
export function applyRemove({ root, asset, expectedBaseline, actor, reason, idempotencyKey } = {}) {
  const repo = resolve(root)
  requireAsset(asset)
  const actorId = String(actor ?? '').trim()
  if (actorId === '') throw new ArchiveError('actor is required to remove', { code: 'actor-required' })
  if (!expectedBaseline || typeof expectedBaseline !== 'object' || Array.isArray(expectedBaseline)) {
    throw new ArchiveError('expectedBaseline is required to remove a requirement', { code: 'baseline-required' })
  }
  const current = archiveBaseline({ root: repo, asset })
  if (current.contentHash !== expectedBaseline.contentHash || current.relationHash !== expectedBaseline.relationHash) {
    throw new ArchiveError('需求在预览后发生了变化，请重新读取后再删除', { code: 'stale-preview', status: 409, baseline: current })
  }
  const plan = planRemove({ root: repo, asset, reason })
  const at = new Date().toISOString()
  const key = String(idempotencyKey ?? '').trim() || `auto-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  const auditFile = writeAudit({ repo, plan, actor: actorId, baseline: current, at, key })
  const absolute = safeRelative(repo, plan.file)
  try {
    if (plan.mode === 'file') rmSync(absolute, { force: false })
    else atomicWrite(absolute, plan.after.content)
  } catch (error) {
    throw new ArchiveError(`删除写入失败：${error?.message ?? String(error)}`, {
      code: 'write-failed',
      status: 500,
      applied: false,
      auditFile,
    })
  }
  return {
    schema: REMOVE_SCHEMA,
    requirement: plan.requirement,
    applied: true,
    file: plan.file,
    mode: plan.mode,
    reason: plan.reason,
    auditFile,
    removedAt: at,
  }
}
