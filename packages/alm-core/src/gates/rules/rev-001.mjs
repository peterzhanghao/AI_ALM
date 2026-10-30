/**
 * REV-001: `REVISION` must be a positive integer, never decrease, and bump
 * whenever the requirement content changes (status-only edits are STATE-001's job).
 */
export const id = 'REV-001'
export const level = 'block'

function contentOf(asset) {
  const extra = Object.fromEntries(Object.entries(asset.extra ?? {}).filter(([key]) => key !== 'revision'))
  const links = asset.links
    .map((link) => `${link.type}>${link.target}`)
    .sort()
  return JSON.stringify({ title: asset.title, owner: asset.owner, links, extra })
}

function validate(asset) {
  const revision = asset.extra?.revision
  if (revision === undefined) return null
  if (!Number.isInteger(revision) || revision < 1) {
    return {
      assetId: asset.id,
      file: asset.source.path,
      line: asset.source.line,
      message: `revision must be a positive integer, got ${String(revision)}`,
    }
  }
  return null
}

export function check({ assets, baseAssets }) {
  const requirements = assets.filter((asset) => asset.type === 'requirement')
  const findings = requirements.map(validate).filter(Boolean)

  if (!baseAssets) {
    if (findings.length === 0) {
      return { status: 'skip', findings: [], message: 'no --base ref; revision not compared' }
    }
    return findings
  }

  const before = new Map(baseAssets.filter((asset) => asset.type === 'requirement').map((asset) => [asset.id, asset]))
  for (const asset of requirements) {
    const previous = before.get(asset.id)
    if (!previous) continue
    const previousRevision = previous.extra?.revision ?? 1
    const revision = asset.extra?.revision ?? 1
    if (contentOf(previous) !== contentOf(asset) && revision <= previousRevision) {
      findings.push({
        assetId: asset.id,
        file: asset.source.path,
        line: asset.source.line,
        message: `revision ${revision} must increase after a content change (was ${previousRevision})`,
      })
    }
  }
  return findings
}
