/**
 * Relation graph helpers. Edges point from the asset that declares a link to
 * its target; reverse edges answer "what depends on this asset".
 */
export function buildGraph(assets) {
  const forward = new Map()
  const reverse = new Map()

  for (const asset of assets) {
    if (!forward.has(asset.id)) forward.set(asset.id, [])
    if (!reverse.has(asset.id)) reverse.set(asset.id, [])
  }

  for (const asset of assets) {
    for (const link of asset.links) {
      const edge = { type: link.type, line: link.line, file: asset.source.path }
      forward.get(asset.id).push({ to: link.target, ...edge })
      if (!reverse.has(link.target)) reverse.set(link.target, [])
      reverse.get(link.target).push({ from: asset.id, ...edge })
    }
  }

  for (const list of forward.values()) list.sort(compareEdge)
  for (const list of reverse.values()) list.sort(compareEdge)
  return { forward, reverse }
}

function compareEdge(a, b) {
  const left = a.to ?? a.from
  const right = b.to ?? b.from
  return left < right ? -1 : left > right ? 1 : 0
}

function neighbours(graph, direction, id) {
  return direction === 'forward' ? (graph.forward.get(id) ?? []) : (graph.reverse.get(id) ?? [])
}

function edgeTarget(edge, direction) {
  return direction === 'forward' ? edge.to : edge.from
}

/**
 * Deterministic BFS over one direction. Cycles are reported separately and
 * never cause recursion: every id is expanded once.
 */
export function walk(graph, startId, direction) {
  const queue = [{ id: startId, depth: 0 }]
  const seen = new Map([[startId, { id: startId, depth: 0, via: null }]])
  const order = []

  while (queue.length > 0) {
    queue.sort((a, b) => a.depth - b.depth || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    const current = queue.shift()
    for (const edge of neighbours(graph, direction, current.id)) {
      const next = edgeTarget(edge, direction)
      if (seen.has(next)) continue
      seen.set(next, { id: next, depth: current.depth + 1, via: edge.type })
      order.push({ id: next, depth: current.depth + 1, via: edge.type })
      queue.push({ id: next, depth: current.depth + 1 })
    }
  }

  return order
}

/** Find cycles reachable from `startId`; each cycle is a closing id path. */
export function findCycles(graph, startId, direction) {
  const cycles = []
  const state = new Map()
  const stack = []

  const visit = (id) => {
    state.set(id, 'active')
    stack.push(id)
    for (const edge of neighbours(graph, direction, id)) {
      const next = edgeTarget(edge, direction)
      if (!state.has(next)) visit(next)
      else if (state.get(next) === 'active') {
        const start = stack.indexOf(next)
        if (start !== -1) cycles.push([...stack.slice(start), next])
      }
    }
    stack.pop()
    state.set(id, 'done')
  }

  if (graph.forward.has(startId) || graph.reverse.has(startId)) visit(startId)
  return cycles
}

export function impactOf(graph, assetId) {
  return { impacted: walk(graph, assetId, 'reverse'), cycles: findCycles(graph, assetId, 'reverse') }
}

export function traceOf(graph, assetId) {
  return { nodes: walk(graph, assetId, 'forward'), cycles: findCycles(graph, assetId, 'forward') }
}
