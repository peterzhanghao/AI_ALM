/**
 * Close-and-archive for YAML requirement assets (`.yml` / `.yaml`).
 *
 * The sdoc writer lives in `archive.mjs`; YAML assets are plain line-oriented
 * documents with `id`, `status` and optional `revision` keys, so this module
 * rewrites exactly those lines and keeps every other key byte-for-byte.
 *
 * It intentionally shares the contract, baseline, audit and idempotency layout
 * with the sdoc path: same schema, same CAS rule, same one-audited-write rule.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { indexReport } from '../commands.mjs'
import { relationSnapshotHash, requirementContentHash } from '../model/content-hash.mjs'
import {
  ARCHIVE_DIR,
  ARCHIVE_SCHEMA,
  ARCHIVE_STATUS,
  ARCHIVABLE_STATUSES,
  ArchiveError,
  normalizeReason,
  revisionOf,
} from './archive.mjs'

const MAX_REASON = 500
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/
const YAML_FORMATS = ['yaml', 'yml']
const IDEMPOTENCY_SCHEMA = 'alm.audit.idempotency/v1'

export function isYamlAsset(asset) {
  const format = String(asset?.source?.format ?? '').toLowerCase()
  if (YAML_FORMATS.includes(format)) return true
  return /\.ya?ml$/i.test(String(asset?.source?.path ?? ''))
}

function requireAsset(asset) {
  if (!asset || typeof asset !== 'object' || typeof asset.id !== 'string' || asset.id === '') {
    throw new ArchiveError('requirement asset is required', { code: 'unknown-requirement', status: 404 })
  }
}

function safeRelative(repo, filePath) {
  const raw = String(filePath ?? '').trim()
  if (raw === '' || isAbsolute(raw)) throw new ArchiveError(`unsafe file path: ${raw}`, { code: 'invalid-path' })
  const target = resolve(repo, raw)
  const rel = relative(repo, target)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) throw new ArchiveError(`unsafe file path: ${raw}`, { code: 'invalid-path' })
  return target
}

function yamlValue(line) {
  const index = line.indexOf(':')
  return index < 0 ? null : line.slice(index + 1).trim()
}

function rewriteYamlArchived({ content, id, status, revision }) {
  const lines = content.split('\n')
  const idLine = lines.findIndex((line) => /^id\s*:/.test(line))
  if (idLine < 0) throw new ArchiveError(`YAML 资产缺少 id 字段：${id}`, { code: 'file-invalid', status: 409 })
  if (yamlValue(lines[idLine]) !== id) {
    throw new ArchiveError(`YAML 文件中的 id 与需求不一致：${yamlValue(lines[idLine])} != ${id}`, { code: 'file-invalid', status: 409 })
  }
  const statusLine = lines.findIndex((line) => /^status\s*:/.test(line))
  if (statusLine < 0) throw new ArchiveError(`YAML 资产缺少 status 字段：${id}`, { code: 'file-invalid', status: 409 })
  lines[statusLine] = `status: ${status}`
  const revisionLine = lines.findIndex((line) => /^revision\s*:/.test(line))
  if (revisionLine >= 0) lines[revisionLine] = `revision: ${revision}`
  else lines.splice(statusLine + 1, 0, `revision: ${revision}`)
  return lines.join('\n')
}

export function planArchiveYaml({ root, asset, reason }) {
  const repo = resolve(root)
  requireAsset(asset)
  if (!isYamlAsset(asset)) throw new ArchiveError('该需求不是 YAML 资产，请使用 sdoc 归档', { code: 'invalid-format', status: 409 })
  if (asset.status === ARCHIVE_STATUS) throw new ArchiveError(`${asset.id} 已归档，无需重复关闭`, { code: 'already-archived', status: 409 })
  if (!ARCHIVABLE_STATUSES.includes(asset.status)) {
    throw new ArchiveError(`当前状态 ${asset.status} 不能关闭归档（仅活跃需求）`, { code: 'invalid-status', status: 409 })
  }
  const file = asset.source?.path
  if (typeof file !== 'string' || file.trim() === '') throw new ArchiveError(`requirement ${asset.id} has no source file`, { code: 'unknown-requirement', status: 404 })
  const absolute = safeRelative(repo, file)
  if (!existsSync(absolute)) throw new ArchiveError(`需求文件不存在：${file}`, { code: 'file-missing', status: 409 })
  const content = readFileSync(absolute, 'utf8')
  const revision = revisionOf(asset) + 1
  const afterContent = rewriteYamlArchived({ content, id: asset.id, status: ARCHIVE_STATUS, revision })
  return {
    schema: ARCHIVE_SCHEMA,
    applied: false,
    requirement: asset.id,
    file,
    format: 'yaml',
    status: { from: asset.status, to: ARCHIVE_STATUS },
    revision,
    reason: normalizeReason(reason),
    baseline: {
      contentHash: requirementContentHash({ root: repo, asset }),
      relationHash: relationSnapshotHash({ asset }),
      revision: revisionOf(asset),
    },
    before: { status: asset.status, revision: revisionOf(asset), content },
    after: { status: ARCHIVE_STATUS, revision, content: afterContent },
  }
}

function assertBaseline({ root, asset, expectedBaseline }) {
  if (!expectedBaseline || typeof expectedBaseline !== 'object' || Array.isArray(expectedBaseline)) {
    throw new ArchiveError('expectedBaseline is required to archive a requirement', { code: 'baseline-required' })
  }
  const current = {
    contentHash: requirementContentHash({ root, asset }),
    relationHash: relationSnapshotHash({ asset }),
    revision: revisionOf(asset),
  }
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
    if (payload?.schema !== IDEMPOTENCY_SCHEMA || !payload.result) return null
    return payload.result
  } catch {
    return null
  }
}

function writeIdempotent({ repo, requirementId, key, result }) {
  const file = idempotencyPath(repo, requirementId, key)
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `${JSON.stringify({ schema: IDEMPOTENCY_SCHEMA, requirement: requirementId, idempotencyKey: key, at: new Date().toISOString(), result }, null, 2)}\n`, 'utf8')
  } catch {
    // Replay is best effort; the archive already succeeded.
  }
}

function writeAudit({ repo, plan, actor, baseline, at, key }) {
  const dir = join(repo, ARCHIVE_DIR)
  mkdirSync(dir, { recursive: true })
  const stamp = at.replace(/[-:.]/g, '')
  let file = join(dir, `${safeSegment(plan.requirement)}-${stamp}-archive-${safeSegment(key)}.json`)
  for (let attempt = 2; existsSync(file); attempt += 1) file = join(dir, `${safeSegment(plan.requirement)}-${stamp}-archive-${safeSegment(key)}-${attempt}.json`)
  writeFileSync(
    file,
    `${JSON.stringify({
      schema: 'alm.audit/v1',
      kind: 'archive',
      format: 'yaml',
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
    }, null, 2)}\n`,
    'utf8',
  )
  return relative(repo, file).split(sep).join('/')
}

function freshYamlAsset(repo, asset) {
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

export function applyArchiveYaml({ root, asset, expectedBaseline, actor, reason, idempotencyKey, writeFile = writeFileSync } = {}) {
  const repo = resolve(root)
  requireAsset(asset)
  if (!isYamlAsset(asset)) throw new ArchiveError('该需求不是 YAML 资产，请使用 sdoc 归档', { code: 'invalid-format', status: 409 })
  const actorId = String(actor ?? '').trim()
  if (actorId === '') throw new ArchiveError('actor is required to archive', { code: 'actor-required' })
  if (typeof writeFile !== 'function') throw new ArchiveError('writeFile must be a function', { code: 'invalid-write-file' })
  const key = String(idempotencyKey ?? '').trim() || `auto-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  const replay = readIdempotent({ repo, requirementId: asset.id, key })
  if (replay) return { ...replay, applied: true, idempotent: true }

  const current = freshYamlAsset(repo, asset)
  if (current.status === ARCHIVE_STATUS) throw new ArchiveError(`${asset.id} 已归档，无需重复关闭`, { code: 'already-archived', status: 409 })
  const plan = planArchiveYaml({ root: repo, asset: current, reason })
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
    format: 'yaml',
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
