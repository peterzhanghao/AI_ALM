import { existsSync, statSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { checkReport, indexReport } from '../alm-core/src/commands.mjs'

const NEXT = {
  'missing-acceptance': '补验收',
  'dangling-relation': '修关系',
  'ready-to-change': '发起变更',
  done: '查看影响',
}

export function nextActionLabel(action) {
  return NEXT[action] ?? '查看'
}

/**
 * One deterministic next action per requirement. The UI shows the label and
 * copies a prompt; the action itself still runs through the normal skill and
 * gate path, never through this page.
 */
export function nextActionFor(item, gaps = []) {
  if (!item || !Array.isArray(item.verifiedBy) || item.verifiedBy.length === 0) return 'missing-acceptance'
  const related = gaps.some(
    (gap) => gap.assetId === item.id || (gap.file === item.file && gap.rule === 'REL-001'),
  )
  if (related) return 'dangling-relation'
  if (item.status === 'accepted') return 'done'
  return 'ready-to-change'
}

/**
 * Resolve `?root=` for the read-only API. Relative paths resolve against the
 * repository root (the parent of the default fixture), never against the
 * caller's cwd; `..` is rejected so the page cannot roam the filesystem.
 */
export function resolveRequirementsRoot(requested, fallback) {
  if (requested === undefined || requested === null) return fallback
  const value = String(requested).trim()
  if (value === '') return fallback

  const segments = value.split(/[\/]+/)
  if (segments.includes('..')) {
    const error = new Error('root must not contain ".."')
    error.status = 400
    error.code = 'invalid-root'
    throw error
  }

  const repoRoot = resolve(fallback, '..', '..')
  const absolute = isAbsolute(value) ? value : join(repoRoot, value)
  if (!existsSync(absolute) || !statSync(absolute).isDirectory()) {
    const error = new Error(`root not found: ${value}`)
    error.status = 404
    error.code = 'root-not-found'
    throw error
  }
  return absolute
}

/**
 * Requirements page payload. Gaps come from the real gate checks (COV-001 /
 * COV-002), never from a static mock.
 */
export function requirements(root) {
  const index = indexReport(root)
  if (index.ok === false) return index

  const check = checkReport(root)
  if (check.ok === false) return check

  const gaps = check.checks
    .filter((entry) => entry.id === 'COV-001' || entry.id === 'COV-002')
    .flatMap((entry) => entry.findings.map((finding) => ({ rule: entry.id, ...finding })))

  const items = index.assets
    .filter((asset) => asset.type === 'requirement')
    .map((asset) => {
      const verifiedBy = asset.links.filter((link) => link.type === 'verified_by').map((link) => link.target)
      const item = {
        id: asset.id,
        title: asset.title,
        status: asset.status,
        owner: asset.owner,
        verifiedBy,
        file: asset.source.path,
        line: asset.source.line,
        links: asset.links.map((link) => ({ type: link.type, target: link.target, line: link.line ?? null })),
      }
      item.nextAction = nextActionFor(item, gaps)
      item.nextActionLabel = nextActionLabel(item.nextAction)
      return item
    })

  return {
    schema: 'alm.requirements/v1',
    root: index.root,
    result: check.result,
    requirements: items,
    gaps,
    summary: { requirements: items.length, gaps: gaps.length },
  }
}
