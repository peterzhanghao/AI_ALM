import test from 'node:test'
import assert from 'node:assert/strict'
import ArchitectureService from '../index.js'

test('architecture plugin disposes its routes and tool on unload', () => {
  const disposers = []
  const routes = []
  const tools = []
  const ctx = {
    effect(callback) {
      disposers.push(callback())
    },
    webServer: {
      register(route) {
        routes.push(route)
        return () => routes.splice(routes.indexOf(route), 1)
      },
    },
    tools: {
      register(definition) {
        tools.push(definition)
        return () => tools.splice(tools.indexOf(definition), 1)
      },
    },
  }

  new ArchitectureService(ctx, {})

  assert.deepEqual(routes.map((route) => route.path).sort(), ['/alm/architecture', '/api/alm/architecture'])
  assert.deepEqual(tools.map((tool) => tool.name), ['alm_architecture'])

  for (const dispose of disposers) dispose()
  assert.equal(routes.length, 0)
  assert.equal(tools.length, 0)
})
