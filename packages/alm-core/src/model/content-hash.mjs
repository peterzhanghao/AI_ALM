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

const scopeText = (value) => String(value ?? '').replace(/\r\n?/g, '\n').trim()

/**
 * Hash of what a delivery is asked to build, not of every editable field.
 *
 * The start-time automatic authorization used to be pinned to
 * `requirementContentHash`, which includes relations and metadata. Declaring an
 * `allocated_to` module — the very action that unblocks a delivery — therefore
 * revoked the authorization of the run that was waiting for it. This hash keeps
 * the goal, scope and acceptance text and deliberately ignores relations,
 * owner/status/priority and revision bookkeeping.
 */
export function requirementScopeHash({ root, asset, doc = null } = {}) {
  const briefPath = asset?.extra?.brief ? join(resolve(root), asset.extra.brief) : null
  const brief = briefPath && existsSync(briefPath) ? readFileSync(briefPath, 'utf8') : ''
  const structured = doc && typeof doc === 'object'
    ? {
        goal: scopeText(doc.goal),
        problem: scopeText(doc.problem),
        features: (Array.isArray(doc.features) ? doc.features : []).map((entry) => ({
          id: entry?.id ?? null,
          title: scopeText(entry?.title),
          behavior: scopeText(entry?.behavior),
        })),
        acceptance: (Array.isArray(doc.acceptance) ? doc.acceptance : []).map((entry) => ({
          id: entry?.id ?? null,
          text: scopeText(entry?.text),
        })),
        constraints: (Array.isArray(doc.constraints) ? doc.constraints : []).map(scopeText),
        scope: (Array.isArray(doc.scope) ? doc.scope : []).map(scopeText),
        outOfScope: (Array.isArray(doc.outOfScope) ? doc.outOfScope : []).map(scopeText),
        pending: (Array.isArray(doc.pending) ? doc.pending : []).map((entry) => ({
          id: entry?.id ?? null,
          text: scopeText(entry?.text),
        })),
      }
    : null
  return sha256({ id: asset?.id ?? null, brief: scopeText(brief), structured })
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
