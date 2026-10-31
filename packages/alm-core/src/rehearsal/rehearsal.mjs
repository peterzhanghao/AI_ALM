/**
 * Change rehearsal: preview the impact closure of an update and apply it only
 * when the preview baseline still matches (CAS). The impact is advisory: an
 * empty relation graph is reported as a blind spot, never as "no impact".
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildGraph } from '../index/closure.mjs'
import {
  RequirementUpdateError,
  applyRequirementUpdate,
  assertBaseline,
  normalizeChange,
  normalizeChanges,
  readIdempotentResult,
  requirementBaseline,
} from '../requirements/update.mjs'

export const REHEARSAL_SCHEMA = 'alm.rehearsal/v1'
export const IMPACT_GROUPS = ['reverify', 'reconfirm', 'reference']
export const REHEARSAL_FIELDS = ['title', 'priority', 'brief']

const MAX_DEPTH = 4
const MAX_PATHS = 50
const MAX_NODES = 500

/**
 * Relation semantics from the changed requirement's point of view.
 * `directions` is the direction of the edge to follow: 'out' = the requirement
 * declares the link (出), 'in' = another asset declares it (入).
 */
export const RELATION_SEMANTICS = {
  verified_by: { directions: ['out'], group: 'reverify', label: '需重验（测试）' },
  allocated_to: { directions: ['out'], group: 'reconfirm', label: '需重新确认（实现模块）' },
  parent_of: { directions: ['out', 'in'], group: 'reconfirm', label: '需重新确认（子/父需求）' },
  constrained_by: { directions: ['out'], group: 'reconfirm', label: '需重新确认（决定）' },
  depends_on: { directions: ['in'], group: 'reconfirm', label: '需重新确认（依赖方）' },
  satisfies: { directions: ['out', 'in'], group: 'reference', label: '仅参考' },
  supersedes: { directions: ['out'], group: 'reference', label: '仅参考' },
}

export class RehearsalError extends Error {
  constructor(message, { code = 'rehearsal', status = 400, ...extra } = {}) {
    super(message)
    this.name = 'RehearsalError'
    this.code = code
    this.status = status
    for (const [key, value] of Object.entries(extra)) {
      if (value !== undefined) this[key] = value
    }
  }
}

function normalizeAssets({ assets, asset }) {
  const list = Array.isArray(assets)
    ? assets.filter((entry) => entry && typeof entry === 'object' && typeof entry.id === 'string')
    : []
  if (!list.some((entry) => entry.id === asset.id)) list.push(asset)
  return list
}

function edgesFor(id, graph, byId) {
  const edges = []
  const asset = byId.get(id)
  for (const link of asset?.links ?? []) {
    const semantics = RELATION_SEMANTICS[link?.type]
    if (!semantics || !semantics.directions.includes('out')) continue
    if (!byId.has(link.target)) continue // missing targets are blind spots, not edges
    edges.push({ from: id, to: link.target, type: link.type, direction: 'out' })
  }
  for (const reverse of graph.reverse.get(id) ?? []) {
    const semantics = RELATION_SEMANTICS[reverse.type]
    if (!semantics || !semantics.directions.includes('in')) continue
    if (!byId.has(reverse.from)) continue
    edges.push({ from: reverse.from, to: id, type: reverse.type, direction: 'in' })
  }
  return edges
}

function kindsOf(trail) {
  const kinds = []
  for (const step of trail) {
    const group = RELATION_SEMANTICS[step.type]?.group
    if (group && !kinds.includes(group)) kinds.push(group)
  }
  return kinds
}

function trailIds(startId, trail) {
  const ids = [startId]
  for (const step of trail) ids.push(step.direction === 'out' ? step.to : step.from)
  return ids
}

function byDepthThenId(left, right) {
  if (left.depth !== right.depth) return left.depth - right.depth
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
}

/**
 * Bounded path enumeration over the semantic relation graph.
 * - `visited`/`expanded` stops re-expansion and cycles from looping forever.
 * - every path to a node is kept (multi-path), capped at MAX_PATHS.
 * - an edge already used on the current path is not traversed backwards, so a
 *   single bidirectional relation never fakes a cycle.
 */
function computeImpact({ startId, assets }) {
  const graph = buildGraph(assets)
  const byId = new Map(assets.map((entry) => [entry.id, entry]))
  const adjacency = (id) =>
    edgesFor(id, graph, byId).sort((left, right) => {
      const leftKey = `${left.type}|${left.direction}|${left.to}|${left.from}`
      const rightKey = `${right.type}|${right.direction}|${right.to}|${right.from}`
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
    })

  const paths = []
  const cycles = []
  const cycleKeys = new Set()
  const nodes = new Map()
  const expanded = new Set()
  const onPath = new Set([startId])
  const usedEdges = new Set()
  const seenEdges = new Set()
  let truncated = false

  const recordCycle = (ids) => {
    const key = ids.join('>')
    if (cycleKeys.has(key)) return
    cycleKeys.add(key)
    cycles.push(ids)
  }

  const travel = (id, depth, trail) => {
    if (expanded.has(id)) return
    expanded.add(id)
    if (expanded.size > MAX_NODES) {
      truncated = true
      return
    }
    for (const edge of adjacency(id)) {
      if (paths.length >= MAX_PATHS) {
        truncated = true
        return
      }
      const edgeKey = `${edge.from}|${edge.type}|${edge.to}`
      seenEdges.add(edgeKey)
      if (usedEdges.has(edgeKey)) continue
      const step = { from: edge.from, to: edge.to, type: edge.type, direction: edge.direction }
      const next = edge.direction === 'out' ? edge.to : edge.from
      const nextTrail = [...trail, step]
      if (onPath.has(next)) {
        recordCycle(trailIds(startId, nextTrail))
        continue
      }

      const kinds = kindsOf(nextTrail)
      paths.push({
        to: next,
        depth: depth + 1,
        kinds,
        relations: nextTrail.map((entry) => ({ ...entry })),
      })
      const node = nodes.get(next)
      if (node) {
        node.depth = Math.min(node.depth, depth + 1)
        for (const kind of kinds) node.kinds.add(kind)
      } else {
        nodes.set(next, {
          id: next,
          title: byId.get(next)?.title ?? null,
          type: byId.get(next)?.type ?? null,
          depth: depth + 1,
          kinds: new Set(kinds),
        })
      }

      if (depth + 1 >= MAX_DEPTH) {
        truncated = true
        continue
      }
      if (expanded.has(next)) continue
      usedEdges.add(edgeKey)
      onPath.add(next)
      travel(next, depth + 1, nextTrail)
      onPath.delete(next)
      usedEdges.delete(edgeKey)
    }
  }
  travel(startId, 0, [])

  const groups = Object.fromEntries(IMPACT_GROUPS.map((group) => [group, []]))
  for (const node of nodes.values()) {
    for (const group of node.kinds) {
      groups[group].push({
        id: node.id,
        title: node.title,
        type: node.type,
        depth: node.depth,
        kinds: [...node.kinds].sort(),
      })
    }
  }
  for (const group of IMPACT_GROUPS) groups[group].sort(byDepthThenId)

  const startAsset = byId.get(startId)
  const blindSpots = []
  for (const link of startAsset?.links ?? []) {
    const semantics = RELATION_SEMANTICS[link?.type]
    if (!semantics) {
      blindSpots.push({
        kind: 'unknown-relation',
        detail: `未知关系类型：${String(link?.type)} → ${String(link?.target)}，未纳入影响分析`,
      })
      continue
    }
    if (!byId.has(link.target)) {
      blindSpots.push({
        kind: 'unresolved-target',
        detail: `关系目标不存在：${link.type} → ${String(link.target)}，影响面无法确认`,
      })
    }
  }
  const reverseNeighbours = graph.reverse.get(startId) ?? []
  if ((startAsset?.links ?? []).length === 0 && reverseNeighbours.length === 0) {
    blindSpots.push({ kind: 'no-relations', detail: '未登记影响（不等于无影响）' })
  }

  paths.sort(
    (left, right) =>
      left.depth - right.depth ||
      (left.to < right.to ? -1 : left.to > right.to ? 1 : 0) ||
      left.kinds.join(',').localeCompare(right.kinds.join(',')),
  )

  return {
    groups,
    paths,
    cycles,
    blindSpots,
    coverage: { relations: seenEdges.size, explored: nodes.size, maxDepth: MAX_DEPTH, truncated },
    advisory: true,
  }
}

function currentValueFor({ repo, asset, field, before }) {
  if (field === 'title') return before.title
  if (field === 'priority') return before.priority
  const brief = asset.extra?.brief
  if (typeof brief !== 'string' || brief.trim() === '') return null
  const absolute = resolve(repo, brief)
  return existsSync(absolute) ? readFileSync(absolute, 'utf8') : null
}

/**
 * Compute the diff and the impact closure without writing anything.
 * `change = { field: 'title'|'priority'|'brief', value }`.
 */
export function previewRehearsal({ root, asset, assets, change } = {}) {
  const repo = resolve(root ?? '.')
  if (!asset || typeof asset !== 'object' || typeof asset.id !== 'string' || asset.id === '') {
    throw new RehearsalError('requirement asset is required', { code: 'unknown-requirement', status: 404 })
  }
  const normalizedList = normalizeChanges(change)
  if (
    normalizedList.some((entry) => entry.field === 'brief') &&
    (typeof asset.extra?.brief !== 'string' || asset.extra.brief.trim() === '')
  ) {
    throw new RehearsalError(`requirement ${asset.id} has no BRIEF field to update`, { code: 'brief-missing' })
  }

  const baseline = requirementBaseline({ root: repo, asset })
  const requirementBefore = {
    id: asset.id,
    title: asset.title,
    priority: asset.extra?.priority ?? null,
    revision: baseline.revision,
  }
  const requirementAfter = { ...requirementBefore, revision: baseline.revision + 1 }
  for (const entry of normalizedList) {
    if (entry.field === 'title') requirementAfter.title = entry.value
    if (entry.field === 'priority') requirementAfter.priority = entry.value
  }

  const changes = normalizedList.map((entry) => ({
    field: entry.field,
    before: currentValueFor({ repo, asset, field: entry.field, before: requirementBefore }),
    after: entry.value,
  }))
  const impact = computeImpact({ startId: asset.id, assets: normalizeAssets({ assets, asset }) })
  return {
    schema: REHEARSAL_SCHEMA,
    requirement: asset.id,
    baseline,
    change: changes.length === 1 ? changes[0] : changes,
    changes,
    requirementBefore,
    requirementAfter,
    impact,
    applied: false,
    writes: [],
  }
}

function summarizeImpact(impact) {
  return {
    groups: Object.fromEntries(IMPACT_GROUPS.map((group) => [group, impact.groups[group].length])),
    paths: impact.paths.length,
    cycles: impact.cycles.length,
    blindSpots: impact.blindSpots.length,
    coverage: impact.coverage,
    advisory: true,
  }
}

function toRehearsalError(error) {
  if (error instanceof RehearsalError) return error
  if (error instanceof RequirementUpdateError) {
    return new RehearsalError(error.message, {
      code: error.code,
      status: error.status,
      applied: error.applied,
      draftRetained: error.draftRetained,
      auditFile: error.auditFile,
      baseline: error.baseline,
      cause: error,
    })
  }
  return error
}

/**
 * Apply a rehearsal: CAS on `expectedBaseline`, audit event, atomic write and
 * idempotent replay. A stale preview throws `stale-preview` (409); a failed
 * write throws `write-failed` with `applied:false` / `draftRetained:true`.
 */
export function applyRehearsal({ root, asset, assets, change, expectedBaseline, actor, idempotencyKey, writeFile } = {}) {
  const repo = resolve(root ?? '.')
  if (!asset || typeof asset !== 'object' || typeof asset.id !== 'string' || asset.id === '') {
    throw new RehearsalError('requirement asset is required', { code: 'unknown-requirement', status: 404 })
  }
  const actorId = String(actor ?? '').trim()
  if (actorId === '') {
    throw new RehearsalError('actor is required to apply a rehearsal', { code: 'actor-required' })
  }
  if (!expectedBaseline || typeof expectedBaseline !== 'object' || Array.isArray(expectedBaseline)) {
    throw new RehearsalError('expectedBaseline is required to apply a rehearsal', { code: 'baseline-required' })
  }

  const key = String(idempotencyKey ?? '').trim()
  if (key !== '') {
    const replay = readIdempotentResult({ root: repo, requirementId: asset.id, idempotencyKey: key })
    if (replay) return { ...replay, applied: true, idempotent: true }
  }

  try {
    const preview = previewRehearsal({ root: repo, asset, assets, change })
    assertBaseline({ root: repo, asset, expectedBaseline })
    const result = applyRequirementUpdate({
      root: repo,
      asset,
      change,
      expectedBaseline: preview.baseline,
      actor: actorId,
      idempotencyKey: key === '' ? undefined : key,
      writeFile,
      impactSummary: summarizeImpact(preview.impact),
      resultExtra: {
        schema: REHEARSAL_SCHEMA,
        requirementBefore: preview.requirementBefore,
        requirementAfter: preview.requirementAfter,
        change: preview.change,
        impact: preview.impact,
      },
    })
    return { ...result, applied: true }
  } catch (error) {
    throw toRehearsalError(error)
  }
}
