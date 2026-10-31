import test from 'node:test'
import assert from 'node:assert/strict'
import RequirementsService from '../index.js'

test('requirements plugin disposes its routes and tool on unload', () => {
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

  new RequirementsService(ctx, {})

  assert.deepEqual(routes.map((route) => route.path).sort(), [
    '/alm/requirements',
    '/api/alm/projects',
    '/api/alm/projects/associate',
    '/api/alm/requirements',
    '/api/alm/requirements/accept',
    '/api/alm/requirements/acceptance',
    '/api/alm/requirements/ai-review',
    '/api/alm/requirements/archive',
    '/api/alm/requirements/create',
    '/api/alm/requirements/diff',
    '/api/alm/requirements/draft',
    '/api/alm/requirements/github',
    '/api/alm/requirements/intake',
    '/api/alm/requirements/intent',
    '/api/alm/requirements/rehearsal',
    '/api/alm/requirements/reveal',
    '/api/alm/requirements/review',
    '/api/alm/requirements/signoff',
    '/api/alm/requirements/start',
    '/api/alm/requirements/version',
  ])
  assert.deepEqual(tools.map((tool) => tool.name), ['alm_requirements'])

  for (const dispose of disposers) dispose()
  assert.equal(routes.length, 0)
  assert.equal(tools.length, 0)
})
