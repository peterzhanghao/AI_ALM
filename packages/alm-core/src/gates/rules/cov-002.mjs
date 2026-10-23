/** COV-002: acceptance tests not referenced by any requirement are reported. */
export const id = 'COV-002'
export const level = 'warn'

export function check({ assets }) {
  const referenced = new Set(
    assets.flatMap((asset) =>
      asset.links.filter((link) => link.type === 'verified_by').map((link) => link.target),
    ),
  )
  return assets
    .filter((asset) => asset.type === 'acceptance-test' && !referenced.has(asset.id))
    .map((asset) => ({
      assetId: asset.id,
      file: asset.source.path,
      line: asset.source.line,
      message: 'acceptance test is not referenced by any requirement',
    }))
}
