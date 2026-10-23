import { checkReport, indexReport } from '../alm-core/src/commands.mjs'
import { buildGraph, impactOf } from '../alm-core/src/index/closure.mjs'

const ARCH_TYPES = new Set(['module', 'architecture-decision', 'interface', 'data-model'])

/**
 * Architecture payload: node lists, dependency/constraint edges, per-node
 * impact counts and real REL-001/REL-002 findings.
 */
export function architecture(root) {
  const index = indexReport(root)
  if (index.ok === false) return index
  const check = checkReport(root)
  if (check.ok === false) return check

  const ids = new Set(index.assets.map((asset) => asset.id))
  const nodes = index.assets.filter((asset) => ARCH_TYPES.has(asset.type))

  const edges = []
  for (const asset of nodes) {
    for (const link of asset.links) {
      if (!ids.has(link.target)) continue
      edges.push({ from: asset.id, to: link.target, type: link.type })
    }
  }
  edges.sort(
    (left, right) =>
      left.from.localeCompare(right.from) || left.to.localeCompare(right.to) || left.type.localeCompare(right.type),
  )

  const graph = buildGraph(index.assets)
  const impact = {}
  for (const asset of nodes) impact[asset.id] = impactOf(graph, asset.id).impacted.length

  const gaps = check.checks
    .filter((entry) => entry.id === 'REL-001' || entry.id === 'REL-002')
    .flatMap((entry) => entry.findings.map((finding) => ({ rule: entry.id, ...finding })))

  const pick = (type) =>
    nodes
      .filter((asset) => asset.type === type)
      .map((asset) => ({
        id: asset.id,
        title: asset.title,
        status: asset.status,
        owner: asset.owner,
        file: asset.source.path,
      }))

  return {
    schema: 'alm.architecture/v1',
    root: index.root,
    result: check.result,
    modules: pick('module'),
    decisions: pick('architecture-decision'),
    interfaces: pick('interface'),
    dataModels: pick('data-model'),
    edges,
    impact,
    gaps,
    summary: {
      nodes: nodes.length,
      edges: edges.length,
      gaps: gaps.length,
      affected: Object.values(impact).reduce((total, value) => total + value, 0),
    },
  }
}
