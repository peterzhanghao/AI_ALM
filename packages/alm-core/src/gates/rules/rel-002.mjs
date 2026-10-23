/** REL-002: relation type and direction must match the source/target types. */
export const id = 'REL-002'
export const level = 'block'

const ALLOWED = {
  satisfies: (source, target) => source === 'requirement' && target === 'requirement',
  allocated_to: (source, target) => source === 'requirement' && target === 'module',
  depends_on: (source, target) =>
    ['module', 'interface', 'data-model'].includes(source) && ['module', 'interface'].includes(target),
  constrained_by: (source, target) => source !== 'architecture-decision' && target === 'architecture-decision',
  verified_by: (source, target) => source === 'requirement' && target === 'acceptance-test',
  supersedes: (source, target) => source === target,
}

export function check({ assets, index }) {
  const findings = []
  for (const asset of assets) {
    for (const link of asset.links) {
      const target = index.byId.get(link.target)
      if (!target) continue
      if (ALLOWED[link.type]?.(asset.type, target.type)) continue
      findings.push({
        assetId: asset.id,
        file: asset.source.path,
        line: link.line ?? asset.source.line,
        message: `illegal ${link.type}: ${asset.type} -> ${target.type}`,
      })
    }
  }
  return findings
}
