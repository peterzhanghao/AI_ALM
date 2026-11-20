/**
 * Declare the modules a requirement allocates.
 *
 * A delivery that moved a module the requirement never claimed is refused by
 * `dev-branch-sync` before anything is staged, and re-running acceptance cannot
 * clear that. Only a `allocated_to` relation can — which is requirement content,
 * so this module treats it as an explicit, attributable, CAS-guarded write:
 * the document is re-parsed after writing to prove the relation took effect
 * instead of trusting a string append.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { requirementContentHash, relationSnapshotHash } from '../model/content-hash.mjs'
import { loadRepo, parseAssetFile } from '../parse/load.mjs'
import { allocationSnippet, declaredModulesOf, loadModuleRegistry } from './architecture-impact.mjs'

export const ALLOCATION_SCHEMA = 'alm.architecture.declaration/v1'
const AUDIT_DIR = '.alm/audit/requirements'

export class AllocationError extends Error {
  constructor(message, { code = 'allocation-failed', status = 400 } = {}) {
    super(message)
    this.name = 'AllocationError'
    this.code = code
    this.status = status
  }
}

const text = (value) => (typeof value === 'string' ? value.trim() : '')
const unique = (values) => [...new Set((Array.isArray(values) ? values : []).map(text).filter(Boolean))]

function findRequirement(repo, requirementId) {
  const id = text(requirementId)
  if (!id) throw new AllocationError('需要指定需求编号', { code: 'requirement-required' })
  const loaded = loadRepo(repo)
  const asset = (loaded.assets ?? []).find((entry) => entry?.type === 'requirement' && entry.id === id)
  if (!asset) throw new AllocationError(`需求 ${id} 不存在`, { code: 'unknown-requirement', status: 404 })
  const file = text(asset.source?.path)
  if (!file) throw new AllocationError(`需求 ${id} 缺少来源文件`, { code: 'requirement-file-missing', status: 500 })
  return { asset, file, loaded }
}

/** Reject ids the module registry does not know: a typo would leave the gate blind. */
function knownModules(repo, modules) {
  const registry = loadModuleRegistry(repo)
  const known = registry?.byId instanceof Map ? registry.byId : new Map()
  const resolved = []
  const unknown = []
  for (const id of unique(modules)) {
    if (known.size > 0 && !known.has(id)) unknown.push(id)
    else resolved.push(id)
  }
  if (unknown.length > 0) {
    throw new AllocationError(`未登记的模块：${unknown.join('、')}`, { code: 'unknown-module', status: 400 })
  }
  return resolved
}

function writeJsonAtomic(absolute, value) {
  mkdirSync(dirname(absolute), { recursive: true })
  const temp = `${absolute}.tmp-${process.pid}-${Date.now()}`
  try {
    writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    renameSync(temp, absolute)
  } finally {
    rmSync(temp, { force: true })
  }
}

/**
 * Read-only view of what a declaration would add. Never writes, so the UI can
 * show the exact snippet before a human authorizes the requirement change.
 */
export function planAllocation({ root, requirementId = null, modules = [] } = {}) {
  const repo = resolve(root ?? process.cwd())
  const { asset, file } = findRequirement(repo, requirementId)
  const requested = knownModules(repo, modules)
  const declared = declaredModulesOf(asset)
  const missing = requested.filter((id) => !declared.includes(id))
  return {
    schema: ALLOCATION_SCHEMA,
    requirement: asset.id,
    file,
    modules: requested,
    declared,
    missing,
    snippet: allocationSnippet(missing),
    requirementHash: requirementContentHash({ root: repo, asset }),
    relationHash: relationSnapshotHash({ asset }),
  }
}

/**
 * Append the missing `allocated_to` relations. `expectedRequirementHash` is a
 * mandatory CAS: a concurrent requirement edit must win over a stale plan.
 */
export function applyAllocation({
  root,
  requirementId = null,
  modules = [],
  expectedRequirementHash = null,
  actor = null,
  note = null,
  now = null,
  apply = true,
  writeFile = writeFileSync,
} = {}) {
  const repo = resolve(root ?? process.cwd())
  const actorId = text(actor)
  if (actorId === '') throw new AllocationError('补声明需要操作人', { code: 'actor-required' })
  if (typeof writeFile !== 'function') throw new AllocationError('writeFile must be a function', { code: 'invalid-write-file' })

  const { asset, file } = findRequirement(repo, requirementId)
  const requested = knownModules(repo, modules)
  if (requested.length === 0) throw new AllocationError('没有需要声明的模块', { code: 'modules-required' })
  const declared = declaredModulesOf(asset)
  const missing = requested.filter((id) => !declared.includes(id))
  const beforeHash = requirementContentHash({ root: repo, asset })
  const expected = text(expectedRequirementHash)
  if (expected !== '' && expected !== beforeHash) {
    throw new AllocationError('需求已变化，请重新生成声明计划后确认', { code: 'requirement-changed', status: 409 })
  }
  if (missing.length === 0) {
    return { schema: ALLOCATION_SCHEMA, applied: false, idempotent: true, requirement: asset.id, file, modules: requested, declared, missing, requirementHash: beforeHash }
  }

  const absolute = join(repo, file)
  const textBefore = readFileSync(absolute, 'utf8')
  const snippet = allocationSnippet(missing)
  const textAfter = `${textBefore.replace(/\s+$/, '')}\n\n${snippet}\n`

  // Prove the relations landed before touching the file: a format mistake must
  // fail here, not leave a requirement nobody can parse.
  let parsed
  try {
    parsed = parseAssetFile(textAfter, file)[0]
  } catch (error) {
    throw new AllocationError(`补声明会破坏需求文档，已放弃写入：${error?.message ?? String(error)}`, { code: 'invalid-declaration', status: 500 })
  }
  if (!parsed || parsed.id !== asset.id) {
    throw new AllocationError('补声明后无法解析为同一需求，已放弃写入', { code: 'invalid-declaration', status: 500 })
  }
  const declaredAfter = declaredModulesOf(parsed)
  const stillMissing = requested.filter((id) => !declaredAfter.includes(id))
  if (stillMissing.length > 0) {
    throw new AllocationError(`补声明未生效：${stillMissing.join('、')}`, { code: 'invalid-declaration', status: 500 })
  }

  const at = now === null || now === undefined ? new Date().toISOString() : String(now)
  const afterHash = requirementContentHash({ root: repo, asset: parsed })
  const auditFile = join(AUDIT_DIR, `${asset.id}-${at.replace(/[:.]/g, '-')}-declare-allocation.json`)
  const audit = {
    schema: ALLOCATION_SCHEMA,
    requirement: asset.id,
    file,
    at,
    actor: actorId,
    note: text(note) === '' ? null : text(note).slice(0, 300),
    modules: missing,
    declaredBefore: declared,
    declaredAfter,
    requirementHashBefore: beforeHash,
    requirementHashAfter: afterHash,
    source: 'architecture-declare',
  }

  if (apply === true) {
    const temp = `${absolute}.tmp-${process.pid}-${Date.now()}`
    try {
      writeFile(temp, textAfter, 'utf8')
      renameSync(temp, absolute)
    } finally {
      rmSync(temp, { force: true })
    }
    writeJsonAtomic(join(repo, auditFile), audit)
  }
  return {
    schema: ALLOCATION_SCHEMA,
    applied: apply === true,
    idempotent: false,
    requirement: asset.id,
    file,
    modules: missing,
    declared: declaredAfter,
    snippet,
    requirementHash: afterHash,
    previousRequirementHash: beforeHash,
    auditFile: apply === true && existsSync(join(repo, auditFile)) ? auditFile.replaceAll('\\', '/') : null,
    audit,
  }
}
