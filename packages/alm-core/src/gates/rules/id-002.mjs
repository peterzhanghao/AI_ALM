import { TYPE_PREFIX } from '../../model/asset.mjs'

/** ID-002: the id prefix must match the asset type. */
export const id = 'ID-002'
export const level = 'block'

export function check({ assets }) {
  return assets
    .filter((asset) => !asset.id.startsWith(`${TYPE_PREFIX[asset.type]}-`))
    .map((asset) => ({
      assetId: asset.id,
      file: asset.source.path,
      line: asset.source.line,
      message: `id prefix does not match type ${asset.type}`,
    }))
}
