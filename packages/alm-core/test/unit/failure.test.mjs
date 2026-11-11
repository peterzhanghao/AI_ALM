import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  DEFECT_DIR,
  DEFECT_LABELS,
  DEFECT_SCHEMA,
  DEFECT_STATES,
  DEFECT_TRANSITIONS,
  FAILURE_DIR,
  FAILURE_KINDS,
  FAILURE_KIND_LABELS,
  FAILURE_SCHEMA,
  FAILURE_STAGES,
  attachAnalysis,
  classifyFailure,
  closeDefectsOnAcceptance,
  confirmDefect,
  createDefect,
  deferDefect,
  defectSummary,
  failureDiagnosis,
  defectView,
  failureFingerprint,
  findDefectByFingerprint,
  ignoreDefect,
  linkDefect,
  listDefects,
  listFailures,
  planDefect,
  recordFailure,
  recordIteration,
  readDefect,
  readFailure,
  readMonitoring,
  updateDefectStatus,
  updateFailureAnalysis,
  writeMonitoring,
} from '../../src/requirements/failure.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
const fixture = join(repoRoot, 'fixtures/order-refund')
const dirs = []

test('readDefect returns only validated defect records', () => {
  const root = makeRepo()
  const { failure } = recordProductFailure(root)
  const created = createDefect({ root, failure, apply: true }).defect
  assert.equal(readDefect(root, created.id).id, created.id)
  assert.equal(readDefect(root, '../outside'), null)
  writeFileSync(join(root, DEFECT_DIR, 'DEF-BAD.json'), JSON.stringify({ schema: 'wrong', id: 'DEF-BAD' }))
  assert.equal(readDefect(root, 'DEF-BAD'), null)
})

test('failure diagnosis presents a repairable cause without an internal code', () => {
  const diagnosis = failureDiagnosis({
    id: 'FAIL-REQ-1', kind: 'product-defect', stage: 'test', step: 'acceptance', summary: '验收命令退出码为 1',
    analysis: { rootCause: 'AC-02 对长标题覆盖规则缺少边界处理', actual: '验证断言未通过' },
  })
  assert.equal(diagnosis.title, '验证检查未通过')
  assert.match(diagnosis.summary, /退出码为 1/)
  assert.match(diagnosis.log, /AC-02/)
})

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'alm-failure-'))
  dirs.push(root)
  // Each ledger test starts with no runtime failures. The shared sample may
  // contain observer/acceptance history; keep that history in the sample but
  // never import it as this test's initial ledger.
  cpSync(fixture, root, {
    recursive: true,
    filter: (source) => source !== join(fixture, FAILURE_DIR),
  })
  return root
}

test.after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

function readJson(root, relative) {
  return JSON.parse(readFileSync(join(root, relative), 'utf8'))
}

function recordProductFailure(root, overrides = {}) {
  return recordFailure({
    root,
    requirement: 'REQ-PAY-001',
    run: 'RUN-1',
    stage: 'test',
    step: 'acceptance',
    error: new Error('refund status mismatch'),
    ...overrides,
  })
}

/* ------------------------------------------------------------------ */
/* contracts                                                           */
/* ------------------------------------------------------------------ */

test('schema and directory constants match the contract', () => {
  assert.equal(FAILURE_SCHEMA, 'alm.failure.event/v1')
  assert.equal(FAILURE_DIR, '.alm/failures')
  assert.deepEqual(FAILURE_KINDS, ['product-defect', 'business-outcome', 'user-cancelled', 'external', 'plugin-defect', 'unknown'])
  for (const kind of FAILURE_KINDS) assert.equal(typeof FAILURE_KIND_LABELS[kind], 'string')
  assert.deepEqual(FAILURE_STAGES, ['clarify', 'review', 'develop', 'test', 'handoff'])
  assert.equal(DEFECT_SCHEMA, 'alm.defect/v1')
  assert.equal(DEFECT_DIR, '.alm/defects')
  assert.deepEqual(DEFECT_STATES, [
    'awaiting-confirmation',
    'confirmed',
    'fixing',
    'verifying',
    'awaiting-acceptance',
    'closed',
    'deferred',
    'ignored',
    'failed',
  ])
  assert.equal(DEFECT_LABELS['awaiting-confirmation'], '待确认')
  assert.equal(DEFECT_LABELS.failed, '迭代失败')
  assert.deepEqual(DEFECT_TRANSITIONS.closed, [])
  assert.deepEqual(DEFECT_TRANSITIONS.fixing, ['verifying', 'failed'])
  assert.deepEqual(DEFECT_TRANSITIONS['awaiting-confirmation'], ['confirmed', 'deferred', 'ignored', 'closed'])
})

/* ------------------------------------------------------------------ */
/* classification matrix                                               */
/* ------------------------------------------------------------------ */

test('classifyFailure follows the contract rule order', () => {
  const cancelled = classifyFailure({ error: Object.assign(new Error('stopped'), { code: 'run-cancelled' }) })
  assert.equal(cancelled.kind, 'user-cancelled')
  assert.equal(cancelled.confidence, 'high')
  assert.equal(classifyFailure({ context: { cancelled: true } }).kind, 'user-cancelled')

  const network = classifyFailure({ error: Object.assign(new Error('reset'), { code: 'ECONNRESET' }) })
  assert.equal(network.kind, 'external')
  assert.equal(network.errorType, 'ECONNRESET')
  assert.equal(classifyFailure({ error: { status: 503, message: 'upstream down' } }).kind, 'external')
  assert.equal(classifyFailure({ error: { code: 'EACCES', message: 'nope' } }).kind, 'external')
  assert.equal(classifyFailure({ error: { status: 429, message: 'slow down' } }).kind, 'external')

  assert.equal(classifyFailure({ error: new Error('x'), context: { businessOutcome: true } }).kind, 'business-outcome')
  assert.equal(
    classifyFailure({ error: Object.assign(new Error('stale'), { code: 'module-stale' }) }).kind,
    'plugin-defect',
  )
  assert.equal(
    classifyFailure({ error: Object.assign(new Error('bad state'), { code: 'state-corrupt' }) }).kind,
    'plugin-defect',
  )
  const product = classifyFailure({ error: new Error('refund status mismatch') })
  assert.equal(product.kind, 'product-defect')
  assert.equal(product.errorType, 'Error')

  const unknown = classifyFailure({})
  assert.equal(unknown.kind, 'unknown')
  assert.equal(unknown.confidence, 'low')
})

test('classifyFailure ranks external and business outcome ahead of plugin evidence', () => {
  assert.equal(
    classifyFailure({ error: { status: 500, message: 'boom' }, context: { businessOutcome: true } }).kind,
    'external',
  )
  assert.equal(
    classifyFailure({ error: new Error('target missed'), context: { businessOutcome: true, pluginFault: true } }).kind,
    'business-outcome',
  )
})

/* ------------------------------------------------------------------ */
/* fingerprints                                                        */
/* ------------------------------------------------------------------ */

test('failureFingerprint is stable, ignores volatile text and sorts test ids', () => {
  const base = { requirement: 'REQ-PAY-001', stage: 'test', errorType: 'AssertionError', testIds: ['TEST-B', 'TEST-A'] }
  const fingerprint = failureFingerprint(base)
  assert.match(fingerprint, /^fp_[0-9a-f]{16}$/)
  assert.equal(failureFingerprint({ ...base, testIds: ['TEST-A', 'TEST-B'] }), fingerprint)
  assert.notEqual(failureFingerprint({ ...base, errorType: 'TimeoutError' }), fingerprint)
  assert.notEqual(failureFingerprint({ ...base, stage: 'review' }), fingerprint)
  assert.notEqual(failureFingerprint({ ...base, requirement: 'REQ-PAY-002' }), fingerprint)
})

/* ------------------------------------------------------------------ */
/* failure ledger                                                      */
/* ------------------------------------------------------------------ */

test('recordFailure writes an event and list/read round-trip', () => {
  const root = makeRepo()
  const result = recordProductFailure(root, {
    evidence: { logs: ['assert failed'], artifacts: [{ path: 'reports/test.json' }], snapshot: { headSha: 'abc', treeHash: 'def' } },
  })
  assert.equal(result.created, true)
  assert.equal(result.deduped, false)
  assert.equal(result.kind, 'product-defect')
  assert.equal(result.failure.id, 'FAIL-REQ-PAY-001-001')
  assert.equal(result.failure.schema, FAILURE_SCHEMA)
  assert.equal(result.failure.outcome, 'failed')
  assert.equal(result.failure.stage, 'test')
  assert.equal(result.failure.attempt, 1)
  assert.ok(existsSync(join(root, FAILURE_DIR, 'FAIL-REQ-PAY-001-001.json')))
  assert.equal(readJson(root, `${FAILURE_DIR}/FAIL-REQ-PAY-001-001.json`).requirement, 'REQ-PAY-001')

  const all = listFailures(root)
  assert.equal(all.length, 1)
  assert.equal(all[0].id, result.failure.id)
  assert.deepEqual(readFailure(root, result.failure.id), all[0])
  assert.equal(readFailure(root, 'FAIL-REQ-PAY-001-999'), null)
})

test('recordFailure without a requirement uses the project id in the failure id', () => {
  const root = makeRepo()
  const result = recordProductFailure(root, { requirement: null })
  assert.equal(result.failure.id, 'FAIL-PAY-001')
  assert.equal(result.failure.requirement, null)
  assert.equal(result.failure.requirementRevision, null)
})

test('recordFailure with apply=false writes nothing', () => {
  const root = makeRepo()
  const result = recordProductFailure(root, { apply: false })
  assert.equal(result.created, false)
  assert.ok(!existsSync(join(root, FAILURE_DIR)))
  assert.deepEqual(listFailures(root), [])
})

test('recordFailure dedupes the same failure inside 24h', () => {
  const root = makeRepo()
  const first = recordProductFailure(root)
  const second = recordFailure({
    root,
    requirement: 'REQ-PAY-001',
    run: 'RUN-1',
    stage: 'test',
    step: 'acceptance',
    error: new Error('a different volatile message'),
    attempt: 2,
  })
  assert.equal(second.created, false)
  assert.equal(second.deduped, true)
  assert.equal(second.failure.id, first.failure.id)
  assert.equal(second.failure.attempt, 2)
  assert.equal(second.failure.summary, first.failure.summary)
  assert.equal(listFailures(root).length, 1)
})

test('recordFailure creates a new event when the previous one is older than 24h', () => {
  const root = makeRepo()
  const first = recordProductFailure(root)
  const path = join(root, FAILURE_DIR, `${first.failure.id}.json`)
  const stored = JSON.parse(readFileSync(path, 'utf8'))
  stored.updatedAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
  stored.createdAt = stored.updatedAt
  writeFileSync(path, JSON.stringify(stored, null, 2), 'utf8')

  const second = recordProductFailure(root)
  assert.equal(second.created, true)
  assert.notEqual(second.failure.id, first.failure.id)
  assert.equal(second.failure.id, 'FAIL-REQ-PAY-001-002')
  assert.equal(listFailures(root).length, 2)
})

test('recordFailure redacts secrets in summary and evidence', () => {
  const root = makeRepo()
  const result = recordFailure({
    root,
    run: 'RUN-secret',
    stage: 'test',
    error: new Error('call failed Authorization: Bearer sk-live-SECRET token=abc123'),
    evidence: { logs: ['curl -H "Authorization: Bearer sk-live-SECRET"'] },
  })
  assert.match(result.summary, /<redacted>/)
  assert.doesNotMatch(result.summary, /SECRET/)
  assert.doesNotMatch(result.summary, /abc123/)
  assert.match(result.failure.evidence.logs[0], /<redacted>/)
  assert.doesNotMatch(result.failure.evidence.logs[0], /SECRET/)
})

test('listFailures filters by requirement and kind and keeps the newest limit', () => {
  const root = makeRepo()
  recordProductFailure(root, { run: 'RUN-1' })
  recordFailure({ root, run: 'RUN-2', stage: 'test', error: Object.assign(new Error('reset'), { code: 'ECONNRESET' }) })
  const byKind = listFailures(root, { kind: 'external' })
  assert.equal(byKind.length, 1)
  assert.equal(byKind[0].kind, 'external')
  assert.equal(listFailures(root, { requirement: 'REQ-PAY-001' }).length, 1)
  assert.equal(listFailures(root, { limit: 1 }).length, 1)
})

test('updateFailureAnalysis validates before writing and keeps a failed analysis', () => {
  const root = makeRepo()
  const { failure } = recordProductFailure(root)
  assert.throws(
    () => updateFailureAnalysis({ root, id: failure.id, analysis: 'not-an-object', status: 'complete', apply: true }),
    (error) => error.code === 'analysis-invalid',
  )
  assert.equal(readFailure(root, failure.id).analysisStatus, 'pending')

  const ok = updateFailureAnalysis({
    root,
    id: failure.id,
    analysis: { what: '退款状态未更新', evidence: ['reports/test.json'], confidence: 'high', fixes: ['修正状态机'] },
    apply: true,
  })
  assert.equal(ok.applied, true)
  const stored = readFailure(root, failure.id)
  assert.equal(stored.analysisStatus, 'complete')
  assert.equal(stored.analysis.what, '退款状态未更新')
  assert.equal(stored.analysis.confidence, 'high')
  assert.deepEqual(stored.analysis.missing, [])

  const dry = updateFailureAnalysis({ root, id: failure.id, analysis: { what: 'dry run only' }, apply: false })
  assert.equal(dry.applied, false)
  assert.equal(readFailure(root, failure.id).analysis.what, '退款状态未更新')

  const failed = updateFailureAnalysis({ root, id: failure.id, status: 'failed', analysis: { what: 'half' }, apply: true })
  assert.equal(failed.failure.analysisStatus, 'failed')
  assert.ok(failed.failure.analysis.missing.length > 0)
  assert.equal(readFailure(root, failure.id).analysisStatus, 'failed')
})

test('attachAnalysis never throws and preserves the missing evidence list', () => {
  assert.doesNotThrow(() => attachAnalysis())
  const result = attachAnalysis({ error: new Error('model unavailable') })
  assert.equal(result.ok, false)
  assert.equal(result.analysisStatus, 'failed')
  assert.ok(result.missing.some((entry) => entry.includes('model unavailable')))
  assert.doesNotThrow(() => attachAnalysis({ error: null, analysis: { what: 'partial' } }))
})

/* ------------------------------------------------------------------ */
/* defect planning                                                     */
/* ------------------------------------------------------------------ */

test('planDefect skips non-defect kinds and marks external failures event-only', () => {
  const root = makeRepo()
  const business = recordFailure({ root, run: 'RUN-b', stage: 'test', error: new Error('target missed'), context: { businessOutcome: true } })
  const businessPlan = planDefect({ root, failure: business.failure })
  assert.equal(businessPlan.action, 'skip')
  assert.equal(businessPlan.schema, 'alm.defect.plan/v1')
  assert.equal(businessPlan.eventOnly, false)

  const cancelled = recordFailure({ root, run: 'RUN-c', stage: 'test', error: Object.assign(new Error('cancel'), { code: 'run-cancelled' }) })
  assert.equal(planDefect({ root, failure: cancelled.failure }).action, 'skip')

  const external = recordFailure({ root, run: 'RUN-e', stage: 'test', error: Object.assign(new Error('reset'), { code: 'ECONNRESET' }) })
  const externalPlan = planDefect({ root, failure: external.failure })
  assert.equal(externalPlan.action, 'skip')
  assert.equal(externalPlan.eventOnly, true)
  assert.ok(!existsSync(join(root, DEFECT_DIR)))
})

test('planDefect create plans a source=defect requirement without writing', () => {
  const root = makeRepo()
  const { failure } = recordProductFailure(root)
  const plan = planDefect({ root, failure })
  assert.equal(plan.action, 'create')
  assert.equal(plan.fingerprint, failure.fingerprint)
  assert.equal(plan.requirementId, 'REQ-PAY-005')
  assert.equal(plan.defect.schema, DEFECT_SCHEMA)
  assert.equal(plan.defect.id, 'DEF-REQ-PAY-005-001')
  assert.equal(plan.defect.status, 'awaiting-confirmation')
  assert.equal(plan.defect.occurrenceCount, 1)
  assert.equal(plan.defect.fingerprint, failure.fingerprint)
  assert.deepEqual(plan.defect.linkedRequirements, ['REQ-PAY-001'])
  assert.equal(plan.defect.impact.requirement, 'REQ-PAY-001')
  assert.equal(plan.requirementPlan.source, 'defect')
  assert.match(plan.requirementPlan.content, /^SOURCE: defect$/m)
  assert.match(plan.requirementPlan.briefContent, /## 缺陷来源/)
  assert.ok(!existsSync(join(root, DEFECT_DIR)))
  assert.ok(!existsSync(join(root, 'requirements/req-pay-005.sdoc')))
})

test('planDefect create lists every required brief section', () => {
  const root = makeRepo()
  const { failure } = recordProductFailure(root)
  const plan = planDefect({ root, failure })
  for (const heading of ['### 问题描述', '### 触发条件', '### 复现步骤', '### 预期', '### 实际', '### 影响', '### 证据', '### 分析', '### 修复建议', '### 验收标准']) {
    assert.ok(plan.requirementPlan.briefContent.includes(heading), `missing ${heading}`)
  }
})

test('createDefect apply creates the requirement and the defect and links the failure', () => {
  const root = makeRepo()
  const { failure } = recordProductFailure(root)
  const result = createDefect({ root, failure, apply: true })
  assert.equal(result.applied, true)
  assert.equal(result.action, 'create')
  assert.equal(result.created, true)
  assert.equal(result.defect.id, 'DEF-REQ-PAY-005-001')
  assert.equal(result.requirementId, 'REQ-PAY-005')
  assert.equal(result.requirement.requirementId, 'REQ-PAY-005')
  assert.ok(existsSync(join(root, 'requirements/req-pay-005.sdoc')))
  assert.ok(existsSync(join(root, 'requirements/briefs/REQ-PAY-005.md')))
  assert.match(readFileSync(join(root, 'requirements/req-pay-005.sdoc'), 'utf8'), /^SOURCE: defect$/m)
  assert.ok(existsSync(join(root, DEFECT_DIR, 'DEF-REQ-PAY-005-001.json')))
  assert.equal(readFailure(root, failure.id).defect, 'DEF-REQ-PAY-005-001')
  assert.equal(listDefects(root).length, 1)
  assert.equal(findDefectByFingerprint({ root, fingerprint: failure.fingerprint }).id, 'DEF-REQ-PAY-005-001')
})

test('createDefect default is a dry run and writes nothing', () => {
  const root = makeRepo()
  const { failure } = recordProductFailure(root)
  const result = createDefect({ root, failure })
  assert.equal(result.applied, false)
  assert.equal(result.action, 'create')
  assert.equal(result.defect.id, 'DEF-REQ-PAY-005-001')
  assert.ok(!existsSync(join(root, DEFECT_DIR)))
  assert.ok(!existsSync(join(root, 'requirements/req-pay-005.sdoc')))
})

test('createDefect merges a repeated fingerprint into the open defect', () => {
  const root = makeRepo()
  const first = recordProductFailure(root, { run: 'RUN-1' })
  const created = createDefect({ root, failure: first.failure, apply: true })

  const second = recordFailure({
    root,
    requirement: 'REQ-PAY-001',
    run: 'RUN-2',
    stage: 'test',
    step: 'acceptance',
    error: new Error('refund status still mismatched'),
  })
  assert.equal(second.failure.fingerprint, first.failure.fingerprint)
  const plan = planDefect({ root, failure: second.failure })
  assert.equal(plan.action, 'merge')
  assert.equal(plan.defect.id, created.defect.id)
  assert.equal(plan.defect.occurrenceCount, 2)

  const merged = createDefect({ root, failure: second.failure, apply: true })
  assert.equal(merged.merged, true)
  assert.equal(listDefects(root).length, 1)
  const stored = listDefects(root)[0]
  assert.equal(stored.occurrenceCount, 2)
  assert.equal(stored.occurrences.length, 2)
  assert.equal(stored.source.lastFailure, second.failure.id)
  assert.ok(!existsSync(join(root, 'requirements/req-pay-006.sdoc')))
})

test('createDefect treats a closed fingerprint as a regression and reopens it', () => {
  const root = makeRepo()
  const first = recordProductFailure(root, { run: 'RUN-1' })
  const created = createDefect({ root, failure: first.failure, apply: true })
  updateDefectStatus({ root, defectId: created.defect.id, status: 'closed', apply: true })
  assert.equal(listDefects(root)[0].status, 'closed')

  const again = recordFailure({
    root,
    requirement: 'REQ-PAY-001',
    run: 'RUN-3',
    stage: 'test',
    step: 'acceptance',
    error: new Error('regressed again'),
  })
  const plan = planDefect({ root, failure: again.failure })
  assert.equal(plan.action, 'regression')
  assert.equal(plan.defect.status, 'awaiting-confirmation')
  assert.equal(plan.defect.regressionSuspected, true)
  assert.equal(plan.defect.occurrenceCount, 2)

  const applied = createDefect({ root, failure: again.failure, apply: true })
  assert.equal(applied.regression, true)
  const stored = listDefects(root)[0]
  assert.equal(stored.status, 'awaiting-confirmation')
  assert.equal(stored.regressionSuspected, true)
  assert.equal(stored.occurrenceCount, 2)
  assert.ok(stored.timeline.some((entry) => entry.type === 'regression'))
})

/* ------------------------------------------------------------------ */
/* defect lifecycle                                                    */
/* ------------------------------------------------------------------ */

test('confirmDefect binds the authorization to the reviewed revision', () => {
  const root = makeRepo()
  const { failure } = recordProductFailure(root)
  const created = createDefect({ root, failure, apply: true })
  assert.equal(listDefects(root)[0].revision, 1)

  assert.throws(
    () => confirmDefect({ root, defectId: created.defect.id }),
    (error) => error.code === 'actor-required',
  )
  const dry = confirmDefect({ root, defectId: created.defect.id, actor: 'human:reviewer', scope: 'fix-only' })
  assert.equal(dry.applied, false)
  assert.equal(listDefects(root)[0].status, 'awaiting-confirmation')

  const confirmed = confirmDefect({ root, defectId: created.defect.id, actor: 'human:reviewer', scope: 'fix-only', apply: true })
  assert.equal(confirmed.applied, true)
  assert.equal(confirmed.defect.status, 'confirmed')
  assert.equal(confirmed.authorization.actor, 'human:reviewer')
  assert.equal(confirmed.authorization.scope, 'fix-only')
  assert.equal(confirmed.authorization.defectRevision, 1)
  assert.equal(listDefects(root)[0].authorization.defectRevision, 1)
  assert.equal(listDefects(root)[0].revision, 2)
  assert.ok(listDefects(root)[0].timeline.some((entry) => entry.type === 'confirmed'))
})

test('confirmDefect rejects a second confirmation and a non-confirmable state', () => {
  const root = makeRepo()
  const { failure } = recordProductFailure(root)
  const created = createDefect({ root, failure, apply: true })
  updateDefectStatus({ root, defectId: created.defect.id, status: 'closed', apply: true })
  assert.throws(
    () => confirmDefect({ root, defectId: created.defect.id, actor: 'human:reviewer', apply: true }),
    (error) => error.code === 'defect-transition-invalid' && error.status === 409,
  )
})

test('deferDefect only works before confirmation and can still be confirmed later', () => {
  const root = makeRepo()
  const { failure } = recordProductFailure(root)
  const created = createDefect({ root, failure, apply: true })
  const deferred = deferDefect({ root, defectId: created.defect.id, reason: '下一迭代处理', until: '2026-12-01', apply: true })
  assert.equal(deferred.defect.status, 'deferred')
  assert.equal(deferred.defect.defer.reason, '下一迭代处理')

  const confirmed = confirmDefect({ root, defectId: created.defect.id, actor: 'human:reviewer', apply: true })
  assert.equal(confirmed.defect.status, 'confirmed')
  assert.throws(
    () => deferDefect({ root, defectId: created.defect.id, reason: 'again', apply: true }),
    (error) => error.code === 'defect-transition-invalid',
  )
})

test('ignoreDefect requires a reason and can be closed afterwards', () => {
  const root = makeRepo()
  const { failure } = recordProductFailure(root)
  const created = createDefect({ root, failure, apply: true })
  assert.throws(
    () => ignoreDefect({ root, defectId: created.defect.id, apply: true }),
    (error) => error.code === 'ignore-reason-required',
  )
  const ignored = ignoreDefect({
    root,
    defectId: created.defect.id,
    reason: '外部环境导致，非产品缺陷',
    scope: 'fingerprint',
    expiresAt: '2027-01-01',
    apply: true,
  })
  assert.equal(ignored.defect.status, 'ignored')
  assert.equal(ignored.defect.ignore.reason, '外部环境导致，非产品缺陷')
  assert.equal(ignored.defect.ignore.scope, 'fingerprint')
  const closed = updateDefectStatus({ root, defectId: created.defect.id, status: 'closed', apply: true })
  assert.equal(closed.defect.status, 'closed')
})

test('updateDefectStatus enforces DEFECT_TRANSITIONS', () => {
  const root = makeRepo()
  const { failure } = recordProductFailure(root)
  const created = createDefect({ root, failure, apply: true })
  assert.throws(
    () => updateDefectStatus({ root, defectId: created.defect.id, status: 'fixing', apply: true }),
    (error) => error.code === 'defect-transition-invalid',
  )
  assert.throws(
    () => updateDefectStatus({ root, defectId: created.defect.id, status: 'nonsense', apply: true }),
    (error) => error.code === 'defect-status-invalid',
  )
  confirmDefect({ root, defectId: created.defect.id, actor: 'human:reviewer', apply: true })
  updateDefectStatus({ root, defectId: created.defect.id, status: 'fixing', apply: true })
  updateDefectStatus({ root, defectId: created.defect.id, status: 'verifying', apply: true })
  updateDefectStatus({ root, defectId: created.defect.id, status: 'awaiting-acceptance', apply: true })
  const closed = updateDefectStatus({ root, defectId: created.defect.id, status: 'closed', apply: true })
  assert.equal(closed.defect.status, 'closed')
  assert.throws(
    () => updateDefectStatus({ root, defectId: created.defect.id, status: 'fixing', apply: true }),
    (error) => error.code === 'defect-transition-invalid',
  )
})

test('recordIteration appends history and marks a failed fix iteration', () => {
  const root = makeRepo()
  const { failure } = recordProductFailure(root)
  const created = createDefect({ root, failure, apply: true })
  confirmDefect({ root, defectId: created.defect.id, actor: 'human:reviewer', apply: true })
  updateDefectStatus({ root, defectId: created.defect.id, status: 'fixing', apply: true })

  const running = recordIteration({ root, defectId: created.defect.id, run: 'RUN-FIX-1', change: 'CHG-1', result: 'running', apply: true })
  assert.equal(running.defect.iterations.length, 1)
  assert.equal(running.defect.iterations[0].run, 'RUN-FIX-1')

  const failed = recordIteration({ root, defectId: created.defect.id, run: 'RUN-FIX-2', result: 'failed', note: '仍然失败', apply: true })
  assert.equal(failed.defect.status, 'failed')
  assert.equal(failed.defect.iterations.length, 2)
  assert.equal(failed.defect.iterations[1].note, '仍然失败')

  assert.throws(
    () => recordIteration({ root, defectId: created.defect.id, result: 'nonsense', apply: true }),
    (error) => error.code === 'iteration-result-invalid',
  )
})

test('linkDefect validates requirement ids and never duplicates links', () => {
  const root = makeRepo()
  const { failure } = recordProductFailure(root)
  const created = createDefect({ root, failure, apply: true })
  assert.throws(
    () => linkDefect({ root, defectId: created.defect.id, requirementId: 'BAD-ID', apply: true }),
    (error) => error.code === 'invalid-requirement-id',
  )
  const linked = linkDefect({ root, defectId: created.defect.id, requirementId: 'REQ-PAY-002', apply: true })
  assert.deepEqual(linked.defect.linkedRequirements.sort(), ['REQ-PAY-001', 'REQ-PAY-002'])
  const again = linkDefect({ root, defectId: created.defect.id, requirementId: 'REQ-PAY-002', apply: true })
  assert.equal(again.defect.linkedRequirements.length, 2)
})

test('defectSummary, listDefects and defectView report the ledger state', () => {
  const root = makeRepo()
  assert.equal(defectView({ root, requirementId: 'REQ-PAY-001' }).exists, false)
  assert.deepEqual(defectSummary(root), { awaitingConfirmation: 0, confirmed: 0, fixing: 0, verifying: 0, awaitingAcceptance: 0, total: 0 })

  const { failure } = recordProductFailure(root)
  const created = createDefect({ root, failure, apply: true })
  const view = defectView({ root, requirementId: 'REQ-PAY-005' })
  assert.equal(view.exists, true)
  assert.equal(view.status, 'awaiting-confirmation')
  assert.equal(view.statusLabel, '待确认')
  assert.equal(view.occurrenceCount, 1)
  assert.equal(view.regressionSuspected, false)

  confirmDefect({ root, defectId: created.defect.id, actor: 'human:reviewer', apply: true })
  assert.deepEqual(defectSummary(root), { awaitingConfirmation: 0, confirmed: 1, fixing: 0, verifying: 0, awaitingAcceptance: 0, total: 1 })
  assert.equal(listDefects(root, { status: 'confirmed' }).length, 1)
  assert.equal(listDefects(root, { status: 'closed' }).length, 0)
  assert.equal(listDefects(root, { requirement: 'REQ-PAY-001' }).length, 1, 'linked requirements are found too')
})

/* ------------------------------------------------------------------ */
/* monitoring                                                          */
/* ------------------------------------------------------------------ */

test('readMonitoring defaults to enabled and writeMonitoring persists the switch', () => {
  const root = makeRepo()
  const defaults = readMonitoring(root)
  assert.equal(defaults.schema, 'alm.monitoring/v1')
  assert.equal(defaults.enabled, true)
  assert.equal(defaults.notify, true)
  assert.deepEqual(defaults.stages, FAILURE_STAGES)

  const dry = writeMonitoring({ root, enabled: false })
  assert.equal(dry.applied, false)
  assert.ok(!existsSync(join(root, '.alm/monitoring.json')))

  const applied = writeMonitoring({ root, enabled: false, stages: ['test', 'review'], notify: false, updatedBy: 'human:local', apply: true })
  assert.equal(applied.applied, true)
  assert.ok(existsSync(join(root, '.alm/monitoring.json')))
  const stored = readJson(root, '.alm/monitoring.json')
  assert.equal(stored.schema, 'alm.monitoring/v1')
  assert.equal(stored.enabled, false)
  assert.deepEqual(stored.stages, ['test', 'review'])
  assert.equal(stored.notify, false)
  assert.equal(readMonitoring(root).enabled, false)

  writeMonitoring({ root, enabled: true, stages: ['unknown-stage', 'test'], apply: true })
  assert.deepEqual(readMonitoring(root).stages, ['test'])
})

test('a passing acceptance closes the defect it verified', () => {
  const root = makeRepo()
  const { failure } = recordProductFailure(root)
  const created = createDefect({ root, failure, apply: true })
  const requirement = created.defect.requirement
  confirmDefect({ root, defectId: created.defect.id, actor: 'human:reviewer', scope: 'fix-only', apply: true })
  updateDefectStatus({ root, defectId: created.defect.id, status: 'fixing', apply: true })
  recordIteration({ root, defectId: created.defect.id, run: 'RUN-1', result: 'awaiting-acceptance', apply: true })
  updateDefectStatus({ root, defectId: created.defect.id, status: 'verifying', apply: true })

  // Dry run reports the close without writing anything.
  const dry = closeDefectsOnAcceptance({ root, requirementId: requirement })
  assert.equal(dry.applied, false)
  assert.equal(dry.closed.length, 1)
  assert.equal(listDefects(root)[0].status, 'verifying')

  const closed = closeDefectsOnAcceptance({ root, requirementId: requirement, note: '验收通过', apply: true })
  assert.equal(closed.applied, true)
  assert.equal(closed.closed[0].status, 'closed')
  const stored = listDefects(root)[0]
  assert.equal(stored.status, 'closed')
  assert.ok(stored.iterations.some((iteration) => iteration.result === 'accepted'), 'the accepted iteration is recorded')

  // Nothing verified for another requirement: a pass is a no-op.
  assert.equal(closeDefectsOnAcceptance({ root, requirementId: 'REQ-NONE', apply: true }).closed.length, 0)
})
