import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
const client = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')
function fixture() {
  const run = { id: 'RUN-1', requirement: 'REQ-1', status: 'waiting-input', checkpoint: { autoAdvance: { authorized: true, authorization: { source: 'start-v4', requirementHash: 'req', revision: 1, configHash: 'config' } } } }
  const facts = { requirementHash: 'req', revision: 1, configHash: 'config', registered: true, accepted: false, snapshot: { complete: true, headSha: 'head', treeHash: 'tree', files: [{ path: 'src/source.js', hash: 'source' }] } }
  const state = { run, facts, executions: 0, payload: { result: 'pass', evidencePath: 'evidence.json', evidence: { schema: 'acceptance', worktree: { stable: true } } } }
  const methods = source.slice(source.indexOf('  nativeDeliveryError('), source.indexOf('  /** Only actual queued/running work'))
  const Service = vm.runInNewContext(`(class { ${methods} })`, { resolveRequirementsRoot: (r) => r, resolve: (r) => r, URL,
    readFileSync: () => 'artifact', createHash: () => ({ update: () => ({ digest: () => 'a'.repeat(64) }) }),
    runCore: { activeRunFor: () => state.run, readRun: () => state.run, listRuns: () => [state.run] },
    candidateCore: { latestCandidate: () => ({ id: 'CAND-1' }) },
    acceptanceCore: { ACCEPTANCE_SCHEMA: 'acceptance', runAcceptance: () => { state.executions++; return state.payload } } })
  const service = new Service()
  Object.assign(service, { root: '/repo', activeRuns: new Map(), pendingRepairs: new Map(), repairJobs: new Map(), deliveryRootKey: (r) => r, executionKey: (root, id) => JSON.stringify([root, id]),
    automaticFacts: () => state.facts, hasPendingDecision: () => false, acceptanceContext: () => ({}),
    createDeliveryCandidate: (...args) => { state.candidateArgs = args; return { candidate: { id: 'CAND-2', treeHash: state.facts.snapshot.treeHash } } }, stopRunHeartbeat() {} })
  return { service, state, input: { root: '/repo', requirementId: 'REQ-1', runId: 'RUN-1' } }
}
test('inspect binds original authorization and rejects activity/changed config/closure', () => {
  const { service, state, input } = fixture()
  assert.equal(service.inspectNativeDelivery(input).busy, false)
  state.run.status = 'running'
  assert.equal(service.inspectNativeDelivery(input).busy, true)
  state.run.status = 'waiting-input'; state.facts.configHash = 'new'
  assert.equal(service.inspectNativeDelivery(input).busy, true)
  state.facts.configHash = 'config'; state.facts.accepted = true
  assert.equal(service.inspectNativeDelivery(input).busy, true)
})
test('handoff awaits actual carrier idle then CAS; never fabricates completion', async () => {
  const { service, state, input } = fixture()
  let disposed = 0
  service.activeRuns.set(service.executionKey('/repo', 'REQ-1'), { root: '/repo', runId: 'RUN-1', agent: { whenIdle: async () => { state.facts.snapshot.treeHash = 'changed' } }, dispose: () => disposed++ })
  await assert.rejects(service.handoffNativeDelivery(input), /变化/)
  assert.equal(disposed, 0)
  assert.equal(state.run.status, 'waiting-input')
  service.activeRuns.get(service.executionKey('/repo', 'REQ-1')).agent.whenIdle = async () => {}
  assert.equal((await service.handoffNativeDelivery(input)).ok, true)
  assert.equal(disposed, 1)
  assert.equal(state.run.status, 'waiting-input')
})
test('reverify binds trusted initial, executes real acceptance, creates fresh candidate without run rewrite', () => {
  const { service, state, input } = fixture()
  const initial = JSON.parse(JSON.stringify(service.inspectNativeDelivery(input)))
  const published = { hostHash: 'a'.repeat(64), clientHash: 'a'.repeat(64) }
  assert.throws(() => service.reverifyNativeDelivery({ ...input, published, initial: { ...initial, configHash: 'other' } }), /变化/)
  assert.equal(state.executions, 0)
  state.facts.snapshot.treeHash = 'published-tree'
  state.facts.snapshot.files.push({ path: 'packages/dsh-plugin-requirements/host.bundle.js', hash: 'new' })
  const result = service.reverifyNativeDelivery({ ...input, initial, published })
  assert.equal(result.pass, true)
  assert.equal(result.candidateId, 'CAND-2')
  assert.equal(state.executions, 1)
  assert.equal(state.candidateArgs[0], '/repo')
  assert.equal(state.candidateArgs[2].source, 'native-deployment')
  assert.equal(state.run.checkpoint.autoAdvance.authorization.requirementHash, 'req')
  state.payload.result = 'fail'
  assert.throws(() => service.reverifyNativeDelivery({ ...input, initial, published }), /未通过/)
  assert.equal(service.verificationLocks.size, 0)
  state.payload.result = 'pass'
  state.facts.snapshot.files[0].hash = 'drift'
  const executions = state.executions
  assert.throws(() => service.reverifyNativeDelivery({ ...input, initial, published }), /变化/)
  assert.equal(state.executions, executions)
})
test('HTTP authenticates before body/workspace and ignores body subject', async () => {
  const { service } = fixture()
  let status, body
  const response = { writeHead: (s) => { status = s }, end: (b) => { body = JSON.parse(b) } }
  service.humanSubjectFor = () => { throw Object.assign(new Error('denied'), { status: 403 }) }
  await service.handleNativeDelivery({ method: 'POST' }, response)
  assert.equal(status, 403)
  assert.equal(body.error.message, 'denied')
  assert.match(source, /subject, source: 'requirements-ui'/)
  assert.doesNotMatch(source, /subject: body\.subject/)
})
test('client identity is compiled closure and native UI dispatch is explicit with persistent job polling', () => {
  assert.match(client, /typeof __ALM_SOURCE_BUILD_ID__ === 'string'/)
  assert.match(client, /typeof __ALM_CLIENT_BUILD_ID__ === 'string'/)
  assert.match(client, /'data-source-build-id': NATIVE_SOURCE_BUILD_ID/)
  assert.match(client, /'data-client-build-id': NATIVE_CLIENT_BUILD_ID/)
  assert.match(client, /'data-page-instance': nativePageInstance.current/)
  assert.match(client, /window\.confirm\(`对 \$\{requirementId\}/)
  assert.match(client, /localStorage\.setItem\('alm.native-delivery.job'/)
  assert.match(client, /原生部署|本机 GUI/)
})
