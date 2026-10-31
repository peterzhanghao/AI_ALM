import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { parseSdocAsset } from '../alm-core/src/parse/sdoc.mjs'

export class VersionDiffError extends Error {
  constructor(message, { code = 'version-diff', status = 400 } = {}) {
    super(message)
    this.name = 'VersionDiffError'
    this.code = code
    this.status = status
  }
}

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function repoPath(root, file) {
  const top = git(root, ['rev-parse', '--show-toplevel'])
  return { top, path: relative(top, resolve(root, file)).replace(/\\/g, '/') }
}

function readVersion(root, file, ref) {
  if (ref === 'worktree') return readFileSync(join(root, file), 'utf8')
  if (!/^[0-9a-f]{7,40}$/.test(ref)) throw new VersionDiffError(`invalid ref: ${ref}`, { code: 'invalid-ref' })
  const { top, path } = repoPath(root, file)
  try {
    return git(top, ['show', `${ref}:${path}`])
  } catch {
    throw new VersionDiffError(`cannot read ${ref}:${path}`, { code: 'ref-unavailable', status: 404 })
  }
}

function assetFromText(text, file, assetId) {
  const asset = parseSdocAsset(text, file).find((entry) => entry.id === assetId)
  if (!asset) return null
  const extra = asset.extra ?? {}
  return {
    fields: {
      UID: asset.id,
      TITLE: asset.title,
      STATUS: asset.status,
      OWNER: asset.owner,
      ...(extra.revision !== undefined ? { REVISION: String(extra.revision) } : {}),
      ...(extra.priority ? { PRIORITY: extra.priority } : {}),
      ...(extra.category ? { CATEGORY: extra.category } : {}),
      ...(extra.brief ? { BRIEF: extra.brief } : {}),
      ...(extra.project ? { PROJECT: extra.project } : {}),
      ...(extra.sources?.length ? { SOURCE: extra.sources.join(',') } : {}),
    },
    relations: (asset.links ?? []).map((link) => ({ type: link.type, target: link.target })),
  }
}

const RELATION_KEY = (relation) => `${relation.type}|${relation.target}`

/**
 * Field/relation diff of one requirement between two git refs (or the
 * worktree). Read-only: it never writes, stages or checks out anything.
 */
export function diffRequirementVersions({ root, file, assetId, from, to = 'worktree' }) {
  const repo = resolve(root)
  if (!assetId) throw new VersionDiffError('assetId is required', { code: 'asset-required' })
  if (!from) throw new VersionDiffError('from is required', { code: 'from-required' })
  const beforeText = readVersion(repo, file, from)
  const afterText = readVersion(repo, file, to)
  const before = assetFromText(beforeText, file, assetId)
  const after = assetFromText(afterText, file, assetId)
  if (!before && !after) throw new VersionDiffError(`asset not found in either version: ${assetId}`, { code: 'asset-not-found', status: 404 })

  const fields = []
  const fieldKeys = new Set([...Object.keys(before?.fields ?? {}), ...Object.keys(after?.fields ?? {})])
  for (const key of [...fieldKeys].sort()) {
    const previous = before?.fields?.[key] ?? null
    const next = after?.fields?.[key] ?? null
    if (previous === next) continue
    fields.push({ field: key, from: previous, to: next })
  }
  const beforeRelations = new Set((before?.relations ?? []).map(RELATION_KEY))
  const afterRelations = new Set((after?.relations ?? []).map(RELATION_KEY))
  const added = [...afterRelations].filter((key) => !beforeRelations.has(key)).sort()
  const removed = [...beforeRelations].filter((key) => !afterRelations.has(key)).sort()

  return {
    schema: 'alm.version.diff/v1',
    asset: assetId,
    file,
    from,
    to,
    mode: before && after ? 'changed' : before ? 'removed' : 'added',
    fields,
    relations: { added, removed },
    summary: {
      changedFields: fields.length,
      addedRelations: added.length,
      removedRelations: removed.length,
    },
  }
}
