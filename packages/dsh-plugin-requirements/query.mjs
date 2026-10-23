import { checkReport, indexReport } from '../alm-core/src/commands.mjs'

/**
 * Requirements page payload. Gaps come from the real gate checks (COV-001 /
 * COV-002), never from a static mock.
 */
export function requirements(root) {
  const index = indexReport(root)
  if (index.ok === false) return index

  const check = checkReport(root)
  if (check.ok === false) return check

  const items = index.assets
    .filter((asset) => asset.type === 'requirement')
    .map((asset) => ({
      id: asset.id,
      title: asset.title,
      status: asset.status,
      owner: asset.owner,
      verifiedBy: asset.links.filter((link) => link.type === 'verified_by').map((link) => link.target),
      file: asset.source.path,
    }))

  const gaps = check.checks
    .filter((entry) => entry.id === 'COV-001' || entry.id === 'COV-002')
    .flatMap((entry) => entry.findings.map((finding) => ({ rule: entry.id, ...finding })))

  return {
    schema: 'alm.requirements/v1',
    root: index.root,
    result: check.result,
    requirements: items,
    gaps,
    summary: { requirements: items.length, gaps: gaps.length },
  }
}
