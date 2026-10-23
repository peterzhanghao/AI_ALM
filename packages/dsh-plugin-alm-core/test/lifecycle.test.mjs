import test from 'node:test'
import assert from 'node:assert/strict'
import AlmCoreService from '../index.js'

test('core plugin disposes all tools on unload', () => {
  const disposers = []
  const tools = []
  const ctx = {
    effect(callback) {
      disposers.push(callback())
    },
    reflect: {
      provide() {},
    },
    tools: {
      register(definition) {
        tools.push(definition)
        return () => tools.splice(tools.indexOf(definition), 1)
      },
    },
    workingDirectory: {
      ensure: async () => 'D:\\repo',
    },
  }

  new AlmCoreService(ctx)

  assert.deepEqual(
    tools.map((tool) => tool.name).sort(),
    ['alm_check', 'alm_index', 'alm_query', 'alm_show', 'alm_workspace_create', 'alm_workspace_guard', 'alm_workspace_status'],
  )

  for (const dispose of disposers) dispose()
  assert.equal(tools.length, 0)
})
