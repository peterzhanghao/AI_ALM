/** COV-001: every requirement is verified by at least one acceptance test. */
export const id = 'COV-001'
export const level = 'block'

export function check({ assets }) {
  return assets
    .filter((asset) => asset.type === 'requirement' && !asset.links.some((link) => link.type === 'verified_by'))
    .map((asset) => ({
      assetId: asset.id,
      file: asset.source.path,
      line: asset.source.line,
      message: 'requirement has no verified_by acceptance test',
    }))
}
