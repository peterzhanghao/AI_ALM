import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')
const start = source.indexOf('    function useRequirements(')
const end = source.indexOf('    function ProjectPicker(', start)

test('resolved project ID does not refetch an unchanged root; ALL and root changes still load', async () => {
  let state, callback, deps, effectDeps
  const requests = [], pending = []
  const context = {
    ALL_PROJECTS: 'ALL',
    useState(initial) { state ??= initial; return [state, value => { state = typeof value === 'function' ? value(state) : value }] },
    useCallback(fn, nextDeps) { if (!deps || nextDeps.some((v, i) => v !== deps[i])) { callback = fn; deps = nextDeps } return callback },
    useEffect(fn, nextDeps) { if (!effectDeps || nextDeps.some((v, i) => v !== effectDeps[i])) { effectDeps = nextDeps; fn() } },
    fetch(url) { requests.push(url); const task = Promise.resolve({ ok: true, json: async () => ({ ok: true, project: 'server-project', requirements: [] }) }); pending.push(task); return task },
  }
  vm.createContext(context)
  vm.runInContext(source.slice(start, end) + '\nthis.render = useRequirements', context)
  context.render({ root: 'D:/DSH', projectId: '' })
  await Promise.all(pending); await new Promise(resolve => setImmediate(resolve))
  context.render({ root: 'D:/DSH', projectId: 'server-project' })
  assert.equal(requests.length, 1)
  context.render({ root: 'D:/DSH', projectId: 'ALL' })
  assert.equal(requests.length, 2)
  assert.equal(requests[1], '/api/alm/requirements?project=ALL')
  context.render({ root: 'D:/another', projectId: 'another' })
  assert.equal(requests.length, 3)
  assert.equal(requests[2], '/api/alm/requirements?root=D%3A%2Fanother')
})
