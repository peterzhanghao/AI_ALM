/**
 * Build the in-memory relation index. Duplicate ids are kept as occurrences so
 * ID-001 can report every location instead of silently keeping the last one.
 */
export function buildIndex(assets) {
  const byId = new Map()
  const byType = new Map()
  const duplicates = new Map()

  for (const asset of assets) {
    if (byId.has(asset.id)) {
      if (!duplicates.has(asset.id)) duplicates.set(asset.id, [byId.get(asset.id)])
      duplicates.get(asset.id).push(asset)
    } else {
      byId.set(asset.id, asset)
    }

    if (!byType.has(asset.type)) byType.set(asset.type, [])
    byType.get(asset.type).push(asset)
  }

  return {
    assets,
    byId,
    byType,
    duplicates: [...duplicates].map(([id, occurrences]) => ({ id, occurrences })),
  }
}
