/** REL-001: every relation target resolves to an asset in the repository. */
export const id = 'REL-001'
export const level = 'block'

export function check({ index }) {
  const findings = []
  for (const asset of index.assets) {
    for (const link of asset.links) {
      if (index.byId.has(link.target)) continue
      findings.push({
        assetId: asset.id,
        file: asset.source.path,
        line: link.line ?? asset.source.line,
        message: `dangling ${link.type} target ${link.target}`,
      })
    }
  }
  return findings
}
