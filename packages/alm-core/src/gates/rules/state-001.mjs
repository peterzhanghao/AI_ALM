/**
 * STATE-001: status transitions must move forward. With no `--base` ref the
 * rule reports `skip` instead of pretending the check passed.
 */
export const id = 'STATE-001'
export const level = 'block'

const ALLOWED = {
  proposed: ['accepted', 'deprecated', 'superseded', 'archived'],
  accepted: ['in-progress', 'deprecated', 'superseded', 'archived'],
  'in-progress': ['implemented', 'accepted', 'deprecated', 'archived'],
  implemented: ['verified', 'in-progress', 'deprecated', 'archived'],
  verified: ['in-progress', 'deprecated', 'archived'],
  deprecated: [],
  superseded: [],
  archived: [],
}

export function check({ assets, baseAssets }) {
  if (!baseAssets) {
    return { status: 'skip', findings: [], message: 'no --base ref; status transitions not checked' }
  }

  const before = new Map(baseAssets.map((asset) => [asset.id, asset]))
  const findings = []

  for (const asset of assets) {
    const previous = before.get(asset.id)
    if (!previous || previous.status === asset.status) continue
    if ((ALLOWED[previous.status] ?? []).includes(asset.status)) continue
    findings.push({
      assetId: asset.id,
      file: asset.source.path,
      line: asset.source.line,
      message: `illegal status transition ${previous.status} -> ${asset.status}`,
    })
  }

  return findings
}
