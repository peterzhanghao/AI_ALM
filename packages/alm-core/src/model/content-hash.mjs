import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * Canonical content of one requirement as reviewed/evidenced: fields, relations
 * and the brief bytes. Kept in one module so the review report, the acceptance
 * evidence and the change rehearsal all bind to the same snapshot hash.
 */
function sortedExtra(extra = {}) {
  return Object.fromEntries(Object.entries(extra).sort(([left], [right]) => left.localeCompare(right)))
}

export function canonicalRequirement({ root, asset }) {
  const briefPath = asset?.extra?.brief ? join(resolve(root), asset.extra.brief) : null
  const brief = briefPath && existsSync(briefPath) ? readFileSync(briefPath, 'utf8') : ''
  return {
    id: asset.id,
    type: asset.type,
    title: asset.title,
    status: asset.status,
    owner: asset.owner,
    extra: sortedExtra(asset.extra),
    links: [...(asset.links ?? [])]
      .map((link) => ({ type: link.type, target: link.target }))
      .sort((left, right) => `${left.type}|${left.target}`.localeCompare(`${right.type}|${right.target}`)),
    brief,
  }
}

export function sha256(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')
}

/** Hash of the requirement snapshot a sign-off / evidence record is bound to. */
export function requirementContentHash({ root, asset }) {
  return sha256(canonicalRequirement({ root, asset }))
}

/**
 * Hash of the acceptance-test revision referenced by `verified_by`. A test that
 * was edited or replaced changes this hash, so old evidence stops being current.
 */
export function testRevisionHash({ asset, assets = [] }) {
  const byId = new Map(assets.map((entry) => [entry.id, entry]))
  const targets = (asset?.links ?? [])
    .filter((link) => link.type === 'verified_by')
    .map((link) => link.target)
    .sort()
  const resolved = targets.map((target) => {
    const test = byId.get(target)
    if (!test) return { target, missing: true }
    return {
      target,
      title: test.title,
      status: test.status,
      revision: test.extra?.revision ?? 1,
    }
  })
  return sha256({ requirement: asset?.id ?? null, tests: resolved })
}

/** Hash of the registered relation snapshot, used to reject stale rehearsals. */
export function relationSnapshotHash({ asset }) {
  const links = [...(asset?.links ?? [])]
    .map((link) => ({ type: link.type, target: link.target }))
    .sort((left, right) => `${left.type}|${left.target}`.localeCompare(`${right.type}|${right.target}`))
  return sha256({ id: asset?.id ?? null, links })
}
