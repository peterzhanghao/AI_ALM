function linkKey(link) {
  return `${link.type} ${link.target}`
}

const FIELDS = ['title', 'status', 'owner', 'type']

/** Field-level and relation-level diff between two asset sets. */
export function diffAssets(baseAssets, headAssets) {
  const base = new Map(baseAssets.map((asset) => [asset.id, asset]))
  const head = new Map(headAssets.map((asset) => [asset.id, asset]))

  const added = [...head.keys()]
    .filter((id) => !base.has(id))
    .sort()
    .map((id) => ({ id, type: head.get(id).type }))

  const removed = [...base.keys()]
    .filter((id) => !head.has(id))
    .sort()
    .map((id) => ({ id, type: base.get(id).type }))

  const changed = []
  for (const id of [...base.keys()].filter((key) => head.has(key)).sort()) {
    const before = base.get(id)
    const after = head.get(id)

    const fields = []
    for (const field of FIELDS) {
      if (JSON.stringify(before[field]) === JSON.stringify(after[field])) continue
      fields.push({ field, from: before[field], to: after[field] })
    }
    if (before.source.path !== after.source.path) {
      fields.push({ field: 'source.path', from: before.source.path, to: after.source.path })
    }

    const beforeLinks = new Set(before.links.map(linkKey))
    const afterLinks = new Set(after.links.map(linkKey))
    const addedLinks = [...afterLinks].filter((key) => !beforeLinks.has(key)).sort()
    const removedLinks = [...beforeLinks].filter((key) => !afterLinks.has(key)).sort()

    if (fields.length === 0 && addedLinks.length === 0 && removedLinks.length === 0) continue
    fields.sort((left, right) => left.field.localeCompare(right.field))
    changed.push({ id, type: after.type, fields, links: { added: addedLinks, removed: removedLinks } })
  }

  return {
    summary: { added: added.length, removed: removed.length, changed: changed.length },
    added,
    removed,
    changed,
  }
}
