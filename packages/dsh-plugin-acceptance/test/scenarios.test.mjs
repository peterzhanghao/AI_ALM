import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, test } from 'node:test'
import {
  ScenarioError,
  describeScenario,
  loadScenarioFile,
  loadScenarios,
  normalizeScenario,
} from '../engine/scenarios.mjs'
import { cleanup, makeWorkspace, writeScenario } from './helpers.mjs'

const dirs = []
after(() => cleanup(dirs))

const valid = {
  id: 'demo',
  title: '演示',
  plugin: '@ai-alm/demo',
  start: { module: 'serve.mjs' },
  checks: [{ id: 'rows', title: '两行', expected: '两行', steps: [{ goto: '/' }, { shot: 'page' }] }],
}

test('normalises defaults for a minimal scenario', () => {
  const scenario = normalizeScenario(valid)
  assert.equal(scenario.level, 'L1')
  assert.equal(scenario.start.export, 'default')
  assert.deepEqual(scenario.start.options, {})
  assert.equal(scenario.checks[0].level, 'L1')
  assert.equal(scenario.checks[0].surface ?? null, null)
})

test('rejects a check without reviewable evidence', () => {
  const bad = { ...valid, checks: [{ id: 'rows', title: 't', expected: 'e', steps: [{ goto: '/' }, { expectText: 'x' }] }] }
  assert.throws(() => normalizeScenario(bad), (error) => {
    assert.ok(error instanceof ScenarioError)
    assert.match(error.message, /reviewable evidence/)
    return true
  })
})

test('rejects unknown steps and malformed expectCount', () => {
  assert.throws(() => normalizeScenario({ ...valid, checks: [{ ...valid.checks[0], steps: [{ scroll: 'down' }] }] }), /unknown step/)
  assert.throws(
    () =>
      normalizeScenario({
        ...valid,
        checks: [{ ...valid.checks[0], steps: [{ expectCount: { selector: 'tr' } }, { shot: 'p' }] }],
      }),
    /exactly one of equals, min, max/,
  )
})

test('rejects duplicate check ids, bad schema and ambiguous start', () => {
  const steps = [{ goto: '/' }, { shot: 'page' }]
  assert.throws(
    () =>
      normalizeScenario({
        ...valid,
        checks: [
          { id: 'a', title: 't', expected: 'e', steps },
          { id: 'a', title: 't', expected: 'e', steps },
        ],
      }),
    /duplicate check id/,
  )
  assert.throws(() => normalizeScenario({ ...valid, schema: 'other/v1' }), /unsupported schema/)
  assert.throws(() => normalizeScenario({ ...valid, start: { base: 'http://x', module: 'serve.mjs' } }), /exactly one of base or module/)
  assert.throws(() => normalizeScenario({ ...valid, checks: [] }), /non-empty checks/)
})

test('loads a scenario module and filters by plugin and id', async () => {
  const root = makeWorkspace()
  dirs.push(root)
  writeScenario(root, 'demo', valid)
  const scenarios = await loadScenarios({ root, plugin: '@ai-alm/demo' })
  assert.equal(scenarios.length, 1)
  assert.equal(scenarios[0].id, 'demo')
  assert.deepEqual(describeScenario(scenarios[0]), {
    id: 'demo',
    title: '演示',
    level: 'L1',
    requirement: null,
    checks: 1,
    source: 'scenario.mjs',
  })

  assert.equal((await loadScenarios({ root, plugin: 'other-plugin' })).length, 0)
  assert.equal((await loadScenarios({ root, plugin: '@ai-alm/demo', ids: ['demo'] })).length, 1)
  await assert.rejects(() => loadScenarios({ root, plugin: '@ai-alm/demo', ids: ['missing'] }), /no scenario named missing/)
})

test('a scenario file without a default export is a load error', async () => {
  const root = makeWorkspace()
  dirs.push(root)
  const file = join(root, 'empty.mjs')
  writeFileSync(file, 'export const nope = 1\n', 'utf8')
  await assert.rejects(() => loadScenarioFile(file), /must export default/)
})
