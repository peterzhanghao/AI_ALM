import test from 'node:test'
import assert from 'node:assert/strict'
import { buildGraph, findCycles, impactOf, traceOf } from '../../src/index/closure.mjs'
import { normalizeAsset } from '../../src/model/asset.mjs'

function asset(id, links = []) {
  return normalizeAsset(
    {
      schema_version: 1,
      id,
      type: 'requirement',
      title: id,
      status: 'proposed',
      owner: 'team-demo',
      links,
    },
    { path: `${id}.yml`, format: 'yaml', line: 1 },
  )
}

const link = (target) => ({ type: 'satisfies', target })

test('forward trace follows links in deterministic order', () => {
  const graph = buildGraph([
    asset('REQ-C-001', []),
    asset('REQ-A-001', [link('REQ-B-001'), link('REQ-C-001')]),
    asset('REQ-B-001', [link('REQ-C-001')]),
  ])
  const { nodes, cycles } = traceOf(graph, 'REQ-A-001')
  assert.deepEqual(
    nodes.map((node) => `${node.id}@${node.depth}`),
    ['REQ-B-001@1', 'REQ-C-001@1'],
  )
  assert.deepEqual(cycles, [])
})

test('reverse impact closure answers who depends on the asset', () => {
  const graph = buildGraph([
    asset('REQ-A-001', [link('REQ-B-001')]),
    asset('REQ-B-001', [link('REQ-C-001')]),
    asset('REQ-C-001', []),
  ])
  const { impacted } = impactOf(graph, 'REQ-C-001')
  assert.deepEqual(
    impacted.map((node) => `${node.id}@${node.depth}`),
    ['REQ-B-001@1', 'REQ-A-001@2'],
  )
})

test('cycles are reported without unbounded recursion', () => {
  const graph = buildGraph([
    asset('REQ-A-001', [link('REQ-B-001')]),
    asset('REQ-B-001', [link('REQ-C-001')]),
    asset('REQ-C-001', [link('REQ-A-001')]),
  ])
  const { nodes, cycles } = traceOf(graph, 'REQ-A-001')
  assert.equal(nodes.length, 2)
  assert.equal(cycles.length, 1)
  assert.deepEqual(cycles[0], ['REQ-A-001', 'REQ-B-001', 'REQ-C-001', 'REQ-A-001'])
})

test('findCycles returns an empty list for a DAG', () => {
  const graph = buildGraph([asset('REQ-A-001', [link('REQ-B-001')]), asset('REQ-B-001', [])])
  assert.deepEqual(findCycles(graph, 'REQ-A-001', 'forward'), [])
})
