/** REL-003: the requirement hierarchy (parent_of / satisfies) must be acyclic. */
export const id = 'REL-003'
export const level = 'block'

const EDGES = new Set(['parent_of', 'satisfies'])

export function check({ assets, index }) {
  const graph = new Map()
  for (const asset of assets) {
    if (asset.type !== 'requirement') continue
    graph.set(
      asset.id,
      asset.links
        .filter((link) => EDGES.has(link.type) && index.byId.get(link.target)?.type === 'requirement')
        .map((link) => link.target),
    )
  }

  const state = new Map()
  const findings = []
  const reported = new Set()

  const visit = (id, path) => {
    state.set(id, 'visiting')
    for (const target of graph.get(id) ?? []) {
      const targetState = state.get(target)
      if (targetState === 'visiting') {
        const cycle = [...path.slice(path.indexOf(target)), target]
        const key = [...cycle].sort().join('|')
        if (!reported.has(key)) {
          reported.add(key)
          const asset = index.byId.get(id)
          findings.push({
            assetId: id,
            file: asset.source.path,
            line: asset.source.line,
            message: `hierarchy cycle: ${cycle.join(' -> ')}`,
          })
        }
        continue
      }
      if (targetState !== 'done') visit(target, [...path, target])
    }
    state.set(id, 'done')
  }

  for (const id of graph.keys()) {
    if (!state.has(id)) visit(id, [id])
  }
  return findings
}
