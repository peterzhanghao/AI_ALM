import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import * as feedback from '../../src/feedback/index.mjs'
import { SOURCE_KINDS } from '../../src/model/asset.mjs'
import { planRequirement } from '../../src/requirements/create.mjs'

const roots = []

function makeRoot({ id = 'ALM', project = true, requirements = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'alm-feedback-'))
  roots.push(root)
  if (project) {
    mkdirSync(join(root, '.alm'), { recursive: true })
    writeFileSync(
      join(root, '.alm', 'project.json'),
      `${JSON.stringify(
        {
          schema: 'alm.project/v1',
          id,
          name: `${id} project`,
          requirementRoot: 'requirements',
          github: { owner: 'ai-alm', repo: 'ai-alm' },
        },
        null,
        2,
      )}\n`,
      'utf8',
    )
  } else if (requirements) {
    mkdirSync(join(root, 'requirements'), { recursive: true })
  }
  if (requirements) mkdirSync(join(root, 'requirements'), { recursive: true })
  return root
}

function configureDestination(root, destination, extra = {}) {
  return feedback.writeFeedbackSettings({
    root,
    settings: {
      destinationWorkspace: { workspaceId: 'ws-dest', projectId: 'DEST', root: destination },
      ...extra,
    },
    actor: 'test:setup',
  })
}

function save(root, overrides = {}) {
  return feedback.saveFeedback({
    root,
    statement: '详情页没有反馈入口',
    ...overrides,
  })
}

function recordPath(root, id) {
  return join(root, '.alm', 'feedback', 'records', `${id}.json`)
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

test.after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

test('exports the contract feedback surface and constants', () => {
  const functions = [
    'readFeedbackSettings',
    'writeFeedbackSettings',
    'normalizeContextEnvelope',
    'saveFeedback',
    'readFeedback',
    'listFeedback',
    'feedbackInbox',
    'planProposal',
    'saveProposal',
    'routeFeedback',
    'markFeedbackRequirement',
    'markFeedbackFailed',
    'validateDestination',
    'readProposal',
    'updateProposal',
    'updateFeedbackCategory',
    'updateFeedbackProcessing',
    'enqueueFeedbackProcessing',
    'recoverFeedbackProcessing',
    'listFeedbackProcessing',
    'confirmProposal',
    'beginFeedbackConversion',
    'updateFeedbackConversion',
    'redactValue',
  ]
  for (const name of functions) assert.equal(typeof feedback[name], 'function', name)

  assert.equal(feedback.FEEDBACK_DIR, '.alm/feedback')
  assert.equal(feedback.FEEDBACK_SCHEMA, 'alm.feedback/v1')
  assert.equal(feedback.FEEDBACK_CONTEXT_SCHEMA, 'alm.feedback.context/v1')
  assert.equal(feedback.FEEDBACK_SETTINGS_SCHEMA, 'alm.feedback.settings/v1')
  assert.equal(feedback.FEEDBACK_INBOX_SCHEMA, 'alm.feedback.inbox/v1')
  assert.equal(feedback.PROPOSAL_SCHEMA, 'alm.proposal/v1')
  assert.deepEqual(feedback.FEEDBACK_CATEGORIES, ['undetermined', 'defect', 'experience', 'capability'])
  assert.deepEqual(feedback.PROPOSAL_STATUSES, ['awaiting-confirmation', 'confirmed', 'converted', 'failed'])
})

test('readFeedbackSettings returns frozen defaults and enabled stays read-only', () => {
  const root = makeRoot()
  const defaults = feedback.readFeedbackSettings(root)
  assert.equal(defaults.schema, feedback.FEEDBACK_SETTINGS_SCHEMA)
  assert.equal(defaults.enabled, false)
  assert.equal(defaults.destinationWorkspace, null)
  assert.deepEqual(defaults.coverage.stages, ['intent', 'review', 'run', 'test', 'acceptance', 'list', 'detail'])
  assert.equal(defaults.capture.includeAttachments, false)
  assert.equal(defaults.capture.retentionDays, 90)
  assert.equal(defaults.capture.maxRecords, 500)

  const { applied, settings } = feedback.writeFeedbackSettings({
    root,
    settings: { enabled: true, capture: { retentionDays: 30 }, actor: 'nobody' },
    actor: 'test:settings',
  })
  assert.equal(applied, true)
  assert.equal(settings.schema, feedback.FEEDBACK_SETTINGS_SCHEMA)
  assert.equal(settings.enabled, false, 'slice 1 never enables capture')
  assert.equal(settings.capture.retentionDays, 30)
  assert.equal(settings.capture.maxRecords, 500)
  assert.equal(settings.updatedBy, 'test:settings')

  const stored = readJson(join(root, '.alm', 'feedback', 'settings.json'))
  assert.equal(stored.enabled, false)
  assert.equal(stored.schema, feedback.FEEDBACK_SETTINGS_SCHEMA)
  assert.match(readFileSync(join(root, '.alm', 'feedback', 'settings.json'), 'utf8'), /\n$/)

  assert.throws(
    () => feedback.writeFeedbackSettings({ root, settings: { capture: { retentionDays: 'forever' } } }),
    (error) => error.code === 'invalid-settings' && error.status === 400,
  )
})

test('saveFeedback persists a needs-routing record with a normalized, bounded context', () => {
  const root = makeRoot()
  const { feedback: record, changed } = save(root, {
    statement: '  保存后详情页没有显示反馈入口  ',
    category: 'experience',
    context: {
      observedWorkspace: { workspaceId: 'ws-local', root },
      targetProduct: { component: 'review', extra: 'dropped' },
      ui: { page: 'detail', stage: 'review', unknown: 'dropped' },
      links: { requirementId: 'REQ-ALM-001', runIds: ['RUN-1'], whatever: true },
      runtime: { hostVersion: '1.0.0', timingMs: { load: 12, bad: -1, worse: 'nope' } },
      userStatement: { expected: '详情页展示反馈入口' },
      untrusted: { ignored: true },
    },
  })

  assert.equal(changed, true)
  assert.match(record.id, /^FB-\d{4}$/)
  assert.equal(record.schema, feedback.FEEDBACK_SCHEMA)
  assert.equal(record.revision, 1)
  assert.equal(record.statement, '保存后详情页没有显示反馈入口')
  assert.equal(record.category, 'experience')
  assert.equal(record.status, 'needs-routing')
  assert.deepEqual(record.routing.destination, null)
  assert.equal(record.routing.reason, 'no-destination')
  assert.equal(record.routing.attempts.length, 1)
  assert.equal(record.routing.attempts[0].outcome, 'needs-routing')
  assert.equal(record.proposalId, null)
  assert.equal(record.requirement, null)
  assert.equal(record.failure, null)
  assert.deepEqual(record.notes, [])

  assert.equal(record.context.schema, feedback.FEEDBACK_CONTEXT_SCHEMA)
  assert.match(record.context.contextSnapshotId, /^FCTX-\d{4}$/)
  assert.equal(record.context.contextSnapshotId, `FCTX-${record.id.slice(3)}`)
  assert.equal(record.context.captureBoundary.mode, 'current-only')
  assert.deepEqual(record.context.captureBoundary.coveredStages, [])
  assert.ok(record.context.captureBoundary.notCoveredStages.includes('未记录的历史操作'))
  assert.equal(record.context.captureBoundary.truncated, false)
  assert.equal(record.context.observedWorkspace.root, resolve(root))
  assert.equal(record.context.targetProduct.component, 'review')
  assert.equal(record.context.targetProduct.extra, undefined)
  assert.equal(record.context.ui.page, 'detail')
  assert.equal(record.context.ui.stage, 'review')
  assert.equal(record.context.ui.unknown, undefined)
  assert.deepEqual(record.context.links.runIds, ['RUN-1'])
  assert.equal(record.context.links.whatever, undefined)
  assert.deepEqual(record.context.runtime.timingMs, { load: 12 })
  assert.equal(record.context.untrusted, undefined)
  assert.equal(record.context.userStatement.text, record.statement)
  assert.equal(record.context.userStatement.expected, '详情页展示反馈入口')
  assert.equal(record.context.destinationWorkspace, undefined)
  assert.equal(record.context.redactions.applied, false)

  assert.deepEqual(record, feedback.readFeedback(root, record.id))
  assert.deepEqual(feedback.listFeedback(root).map((item) => item.id), [record.id])
})

test('saveFeedback with a valid destination marks the record routed', () => {
  const root = makeRoot()
  const destination = makeRoot({ id: 'DEST' })
  configureDestination(root, destination)

  const { feedback: record } = save(root)
  assert.equal(record.status, 'routed')
  assert.equal(record.routing.reason, null)
  assert.equal(record.routing.destination.workspaceId, 'ws-dest')
  assert.equal(record.routing.destination.projectId, 'DEST')
  assert.equal(record.routing.destination.root, resolve(destination))
  assert.equal(record.routing.attempts.at(-1).outcome, 'routed')

  const check = feedback.validateDestination({ workspace: { workspaceId: 'ws-dest', projectId: 'DEST', root: destination } })
  assert.deepEqual(check, {
    ok: true,
    code: null,
    message: null,
    root: resolve(destination),
    projectId: 'DEST',
    workspaceId: 'ws-dest',
  })
})

test('saveFeedback is idempotent per clientRequestId for the same payload', () => {
  const root = makeRoot()
  const first = save(root, { clientRequestId: 'client-1' })
  const second = save(root, { clientRequestId: 'client-1' })
  assert.equal(first.changed, true)
  assert.equal(second.changed, false)
  assert.equal(second.feedback.id, first.feedback.id)
  assert.equal(second.feedback.statement, first.feedback.statement)
  assert.equal(readdirSync(join(root, '.alm', 'feedback', 'records')).length, 1)
  assert.equal(feedback.listFeedback(root).length, 1)
})

test('saveFeedback rejects the same idempotency key with different content', () => {
  const root = makeRoot()
  save(root, { clientRequestId: 'client-conflict' })
  assert.throws(
    () => save(root, { clientRequestId: 'client-conflict', statement: '另一个说法' }),
    (error) => error.code === 'idempotency-conflict' && error.status === 409,
  )
  assert.equal(feedback.listFeedback(root).length, 1)
})

test('saveFeedback rejects the same key when only the captured context changed', () => {
  const root = makeRoot()
  const first = save(root, {
    clientRequestId: 'client-context',
    observedAt: '2026-11-03T03:00:00.000Z',
    context: { links: { requirementId: 'REQ-ONE' } },
  })
  assert.throws(
    () =>
      save(root, {
        clientRequestId: 'client-context',
        observedAt: '2026-11-03T03:00:00.000Z',
        context: { links: { requirementId: 'REQ-TWO' } },
      }),
    (error) =>
      error.code === 'idempotency-conflict' &&
      error.status === 409 &&
      error.details?.existing?.id === first.feedback.id,
  )
  assert.equal(feedback.listFeedback(root).length, 1)
  const replay = save(root, {
    clientRequestId: 'client-context',
    observedAt: '2026-11-03T03:00:00.000Z',
    context: { links: { requirementId: 'REQ-ONE' } },
  })
  assert.equal(replay.changed, false)
  assert.equal(replay.feedback.id, first.feedback.id)
})

test('saveFeedback rejects an empty or over-long statement and unknown categories', () => {
  const root = makeRoot()
  assert.throws(
    () => save(root, { statement: '   ' }),
    (error) => error.code === 'statement-required' && error.status === 400,
  )
  assert.throws(
    () => save(root, { statement: 'x'.repeat(4001) }),
    (error) => error.code === 'statement-too-long' && error.status === 400,
  )
  assert.throws(
    () => save(root, { category: 'bug' }),
    (error) => error.code === 'invalid-category' && error.status === 400,
  )
  assert.equal(feedback.listFeedback(root).length, 0)
})

test('priority is validated by the requirement planner and feedback briefs carry provenance', () => {
  const root = makeRoot()
  const destination = makeRoot({ id: 'DEST' })
  const plan = planRequirement({
    root: destination,
    id: 'REQ-DEST-007',
    title: '补充反馈入口',
    brief: '用户原话',
    goal: '可手动提交反馈',
    priority: 'P0',
    source: 'feedback',
    feedback: {
      id: 'FB-0001',
      category: 'defect',
      observedWorkspace: { projectId: 'ALM', workspaceId: 'ws-local', root: 'C:\\Users\\admin\\secret-project' },
      targetComponent: 'review',
    },
  })
  assert.equal(plan.content.includes('SOURCE: feedback'), true)
  assert.match(plan.briefContent, /## 反馈来源/)
  assert.match(plan.briefContent, /FB-0001/)
  assert.match(plan.briefContent, /defect/)
  assert.match(plan.briefContent, /ALM/)
  assert.match(plan.briefContent, /review/)
  assert.equal(plan.briefContent.includes('C:\\Users\\admin\\secret-project'), false)
  assert.equal(plan.briefContent.includes('secret-project'), false)

  const defect = planRequirement({ root, id: 'REQ-ALM-001', title: 't', brief: 'b', goal: '', priority: 'P1', source: 'defect' })
  assert.match(defect.briefContent, /## 缺陷来源/)
  assert.equal(defect.briefContent.includes('## 反馈来源'), false)

  const plain = planRequirement({ root, id: 'REQ-ALM-002', title: 't', brief: 'b', goal: '', priority: 'P1', source: 'feedback' })
  assert.match(plain.briefContent, /## 反馈来源/)
  assert.equal(plain.briefContent.includes('反馈 ID：'), false, 'missing metadata is omitted, not invented')

  assert.equal(planRequirement({ root, id: 'REQ-ALM-003', title: 't', brief: 'b', goal: '', source: 'chat' }).priority, 'P1')
  assert.throws(
    () => planRequirement({ root, id: 'REQ-ALM-004', title: 't', brief: 'b', goal: '', priority: 'P9', source: 'chat' }),
    (error) => error.code === 'invalid-priority',
  )

  assert.equal(SOURCE_KINDS.includes('feedback'), true)
  assert.deepEqual(SOURCE_KINDS.slice(0, 6), ['chat', 'meeting', 'doc', 'screenshot', 'email', 'defect'])
})

test('redactValue removes secret-keyed values, token shapes and absolute paths', () => {
  const { value, redactions } = feedback.redactValue({
    password: 'hunter2',
    nested: { apiKey: 'plain-secret' },
    text: 'Authorization: Bearer abcdefghijklmnop',
    token: 'sk-live-1234567890',
    safe: 'visible',
  })
  assert.equal(value.password, '[redacted]')
  assert.equal(value.nested.apiKey, '[redacted]')
  assert.equal(value.text, 'Authorization: [redacted]')
  assert.equal(value.token, '[redacted]')
  assert.equal(value.safe, 'visible')
  assert.ok(redactions.includes('password'))
  assert.ok(redactions.includes('nested.apiKey'))
  assert.ok(redactions.includes('token'))
  assert.ok(redactions.includes('text'))

  assert.equal(redactions.includes('safe'), false)
  const paths = feedback.redactText('居家目录 /home/admin/project 和 D:\\work\\secret 都已检查')
  assert.equal(paths.includes('/home/admin'), false)
  assert.equal(paths.includes('D:\\work\\secret'), false)
  assert.match(paths, /\[redacted\]/)

  const bearer = feedback.redactText('header sk-abcdefghijklmn and ghp_abcdefghijklmn')
  assert.equal(bearer.includes('sk-abcdefghijklmn'), false)
  assert.equal(bearer.includes('ghp_abcdefghijklmn'), false)
})

test('saved records redact secrets in statements and context fields', () => {
  const root = makeRoot()
  const { feedback: record } = save(root, {
    statement: '保存时报错 Authorization: Bearer abcdefghijklmnop',
    context: { ui: { page: 'settings', viewState: { password: 'hunter2', note: 'Bearer abcdefghijklmnop' } } },
  })
  assert.equal(record.statement.includes('abcdefghijklmnop'), false)
  assert.match(record.statement, /\[redacted\]/)
  assert.equal(record.context.ui.viewState.password, '[redacted]')
  assert.equal(record.context.ui.viewState.note, '[redacted]')
  assert.equal(record.context.redactions.applied, true)
  assert.ok(record.context.redactions.fields.includes('ui.viewState.password'))
  assert.ok(record.context.redactions.fields.includes('ui.viewState.note'))
  const onDisk = readFileSync(recordPath(root, record.id), 'utf8')
  assert.equal(onDisk.includes('hunter2'), false)
  assert.equal(onDisk.includes('abcdefghijklmnop'), false)
})

test('context snapshots are stable, omit absent fields and never fabricate history', () => {
  const root = makeRoot()
  const first = save(root, { context: {} }).feedback
  assert.equal(first.context.contextSnapshotId, 'FCTX-0001')
  assert.equal(first.context.ui, undefined)
  assert.equal(first.context.links, undefined)
  assert.equal(first.context.runtime, undefined)
  assert.equal(first.context.evidence, undefined)
  assert.equal(first.context.destinationWorkspace, undefined)
  assert.equal(first.context.userStatement.text, first.statement)
  assert.equal(first.context.userStatement.expected, undefined)
  assert.equal(first.context.captureBoundary.mode, 'current-only')
  assert.equal(first.context.captureBoundary.coveredStages.length, 0)
  assert.equal('history' in first.context, false)

  const reread = feedback.readFeedback(root, first.id)
  assert.equal(reread.context.contextSnapshotId, 'FCTX-0001')
  assert.deepEqual(reread.context.captureBoundary, first.context.captureBoundary)

  const second = save(root, { statement: '另一条反馈' }).feedback
  assert.equal(second.context.contextSnapshotId, 'FCTX-0002')
  assert.notEqual(second.context.contextSnapshotId, first.context.contextSnapshotId)
})

test('capture separates the click time from the server receive time and keeps attachments as evidence', () => {
  const root = makeRoot()
  const { feedback: record } = save(root, {
    context: {
      observedAt: '2026-11-03T02:55:10.000Z',
      capture: { kind: 'client-click', client: 'dsh-web', clientBuild: 'feedback-v2/test' },
      recentError: 'Error: no such decision file',
      links: { requirementId: 'REQ-ALM-001', requirementFile: 'requirements/req-alm-001.sdoc', requirementInstanceKey: 'req-alm-001.sdoc' },
    },
  })
  assert.equal(record.context.observedAt, '2026-11-03T02:55:10.000Z')
  assert.notEqual(record.context.capturedAt, record.context.observedAt)
  assert.equal(record.context.capture.kind, 'client-click')
  assert.equal(record.context.capture.clientBuild, 'feedback-v2/test')
  assert.equal(record.receivedAt, record.context.capturedAt)
  assert.equal(record.context.links.requirementFile, 'requirements/req-alm-001.sdoc')
  assert.equal(record.context.links.requirementInstanceKey, 'req-alm-001.sdoc')
  assert.deepEqual(record.context.evidence.textExcerpts, [
    { label: '最近错误', text: 'Error: no such decision file', truncated: false },
  ])
  // An absolute path is not a repository-relative requirement file, so it must
  // be dropped rather than stored (context must never leak machine paths).
  const dropped = save(root, { context: { links: { requirementFile: 'C:/abs/req.sdoc' } } }).feedback
  assert.equal(dropped.context.links?.requirementFile, undefined)
})

test('context normalization caps arrays, strings and total size with an honest truncated flag', () => {
  const root = makeRoot()
  const { feedback: record } = save(root, {
    context: {
      evidence: { textExcerpts: [{ label: 'l', text: 'x'.repeat(5000) }] },
      ui: { page: 'run', unsavedSummary: 'y'.repeat(600) },
      runtime: { errorCodes: Array.from({ length: 60 }, (_, index) => `ERR_${index}`) },
    },
  })
  assert.equal(record.context.evidence.textExcerpts[0].text.length <= 4000, true)
  assert.equal(record.context.evidence.textExcerpts[0].truncated, true)
  assert.equal(record.context.ui.unsavedSummary.length <= 500, true)
  assert.equal(record.context.runtime.errorCodes.length <= 20, true)
  assert.equal(record.context.captureBoundary.truncated, true)
  assert.equal(Buffer.byteLength(JSON.stringify(record), 'utf8') <= 64 * 1024, true)
})

test('a corrupted store does not crash listing and is skipped instead', () => {
  const root = makeRoot()
  const good = save(root).feedback
  mkdirSync(join(root, '.alm', 'feedback', 'records'), { recursive: true })
  writeFileSync(join(root, '.alm', 'feedback', 'records', 'FB-9999.json'), '{not json', 'utf8')
  writeFileSync(join(root, '.alm', 'feedback', 'records', 'FB-9998.json'), JSON.stringify({ schema: 'wrong', id: 'FB-9998' }), 'utf8')
  writeFileSync(join(root, '.alm', 'feedback', 'settings.json'), '{broken', 'utf8')

  assert.deepEqual(feedback.listFeedback(root).map((item) => item.id), [good.id])
  assert.equal(feedback.readFeedback(root, 'FB-9999'), null)
  assert.equal(feedback.readFeedback(root, 'NOT-A-RECORD'), null)
  assert.equal(feedback.readFeedbackSettings(root).enabled, false)
  const inbox = feedback.feedbackInbox(root)
  assert.equal(inbox.schema, feedback.FEEDBACK_INBOX_SCHEMA)
  assert.equal(inbox.counts.needsRouting, 1)
  assert.equal(inbox.items.length, 1)
})

test('the same feedback id in different workspaces never crosses records', () => {
  const rootA = makeRoot()
  const rootB = makeRoot()
  const a = save(rootA, { statement: '工作区 A 的反馈' }).feedback
  const b = save(rootB, { statement: '工作区 B 的反馈' }).feedback
  assert.equal(a.id, 'FB-0001')
  assert.equal(b.id, 'FB-0001')
  assert.equal(feedback.readFeedback(rootA, 'FB-0001').statement, '工作区 A 的反馈')
  assert.equal(feedback.readFeedback(rootB, 'FB-0001').statement, '工作区 B 的反馈')
  assert.equal(feedback.listFeedback(rootA).length, 1)
  assert.equal(feedback.listFeedback(rootB).length, 1)
})

test('validateDestination distinguishes not-configured, unavailable and not-writable', () => {
  const none = feedback.validateDestination({})
  assert.equal(none.ok, false)
  assert.equal(none.code, 'destination-not-configured')
  assert.equal(none.root, null)

  const noProject = makeRoot({ project: false })
  const unavailable = feedback.validateDestination({ root: noProject })
  assert.equal(unavailable.ok, false)
  assert.equal(unavailable.code, 'destination-unavailable')

  const lowerId = makeRoot({ id: 'dest' })
  assert.equal(feedback.validateDestination({ root: lowerId }).code, 'destination-unavailable')

  const writable = makeRoot({ id: 'DEST', requirements: false })
  const probe = feedback.validateDestination({ root: writable, probeWrite: false })
  assert.equal(probe.ok, true)
  assert.equal(probe.code, null)
  assert.equal(existsSync(join(writable, 'requirements')), false)
  assert.equal(existsSync(join(writable, '.alm', 'feedback')), false)

  const created = feedback.validateDestination({ root: writable })
  assert.equal(created.ok, true)
  assert.equal(existsSync(join(writable, 'requirements')), true)
  assert.equal(existsSync(join(writable, '.alm', 'feedback')), true)
  assert.equal(existsSync(join(writable, '.alm', 'feedback', '.write-probe')), false)

  const blocked = makeRoot({ id: 'DEST' })
  writeFileSync(join(blocked, '.alm', 'feedback'), 'not a directory', 'utf8')
  assert.equal(feedback.validateDestination({ root: blocked }).code, 'destination-not-writable')
})

test('an invalid configured destination saves the record as needs-routing with a reason', () => {
  const root = makeRoot()
  const destination = makeRoot({ id: 'DEST' })
  configureDestination(root, destination)
  rmSync(join(destination, '.alm', 'project.json'))
  const { feedback: record } = save(root)
  assert.equal(record.status, 'needs-routing')
  assert.ok(['destination-unavailable', 'destination-not-writable'].includes(record.routing.reason))
  assert.equal(record.routing.destination, null)
})

test('planProposal derives an honest proposal and dedupes by fingerprint', () => {
  const root = makeRoot()
  const destination = makeRoot({ id: 'DEST' })
  configureDestination(root, destination)
  const { feedback: first } = save(root, {
    category: 'defect',
    statement: '评审页在 /home/admin/app 下崩溃',
    context: {
      targetProduct: { component: 'review' },
      userStatement: { expected: '评审页可以正常打开' },
      evidence: { textExcerpts: [{ label: 'error', text: 'TypeError: boom' }] },
    },
  })
  const settings = feedback.readFeedbackSettings(root)
  const plan = feedback.planProposal({ feedback: first, settings })
  assert.equal(plan.schema, feedback.PROPOSAL_SCHEMA)
  assert.equal(plan.origin, 'manual-feedback')
  assert.equal(plan.kind, 'defect')
  assert.equal(plan.targetProduct, 'dsh-requirements-plugin')
  assert.equal(plan.targetComponent, 'review')
  assert.equal(plan.destination.projectId, 'DEST')
  assert.deepEqual(plan.observedWorkspaces, [{ projectId: 'ALM' }])
  assert.deepEqual(plan.related.feedbackIds, [first.id])
  assert.equal(plan.problem.includes('/home/admin'), false)
  assert.equal(plan.desiredOutcome, '评审页可以正常打开')
  assert.deepEqual(plan.acceptanceScenarios, [])
  assert.equal(plan.effectCheck, null)
  assert.deepEqual(plan.hypotheses, [])
  assert.equal(plan.status, 'awaiting-confirmation')
  assert.deepEqual(plan.confirmation, { required: true, confirmedAt: null, confirmedBy: null, notes: '' })
  assert.equal(plan.analysis.kind, 'raw')
  assert.equal(plan.analysis.label, '原话候选，尚未分析')
  assert.equal(plan.analysis.analyzedAt, null)
  assert.deepEqual(plan.facts, [{ text: plan.problem, source: 'user-statement' }])
  assert.equal(plan.fingerprint.length, 64)
  assert.ok(plan.observations.length >= 1)
  assert.match(plan.observations[0].evidenceRefs[0], /context:FCTX-0001/)

  const saved = feedback.saveProposal(root, plan)
  assert.match(saved.id, /^IMP-\d{4}$/)
  assert.equal(feedback.readProposal(root, saved.id).fingerprint, plan.fingerprint)

  const { feedback: second } = save(root, {
    category: 'defect',
    statement: '评审页在 /home/admin/app 下崩溃',
    context: {
      targetProduct: { component: 'review' },
      userStatement: { expected: '评审页可以正常打开' },
    },
  })
  const planAgain = feedback.planProposal({ feedback: second, settings })
  assert.equal(planAgain.fingerprint, plan.fingerprint)
  const reused = feedback.saveProposal(root, planAgain)
  assert.equal(reused.id, saved.id)
  assert.deepEqual(new Set(reused.related.feedbackIds), new Set([first.id, second.id]))
  assert.equal(readdirSync(join(root, '.alm', 'feedback', 'proposals')).length, 1)
})

test('updateProposal enforces revision CAS and reports missing proposals', () => {
  const root = makeRoot()
  const destination = makeRoot({ id: 'DEST' })
  configureDestination(root, destination)
  const { feedback: record } = save(root)
  const saved = feedback.saveProposal(root, feedback.planProposal({ feedback: record, settings: feedback.readFeedbackSettings(root) }))
  assert.equal(saved.revision, 1)

  assert.throws(
    () => feedback.updateProposal({ root, proposalId: 'IMP-9999', status: 'converted' }),
    (error) => error.code === 'proposal-not-found' && error.status === 404,
  )
  assert.throws(
    () => feedback.updateProposal({ root, proposalId: saved.id, status: 'done' }),
    (error) => error.code === 'invalid-status' && error.status === 400,
  )

  const converted = feedback.updateProposal({
    root,
    proposalId: saved.id,
    expectedRevision: 1,
    status: 'converted',
    requirement: { root: destination, id: 'REQ-DEST-001', revision: 1 },
    actor: 'test:reviewer',
  })
  assert.equal(converted.applied, true)
  assert.equal(converted.proposal.status, 'converted')
  assert.equal(converted.proposal.revision, 2)
  assert.equal(converted.proposal.requirementRef.id, 'REQ-DEST-001')
  assert.equal(converted.proposal.updatedBy, 'test:reviewer')

  assert.throws(
    () => feedback.updateProposal({ root, proposalId: saved.id, expectedRevision: 1, status: 'failed' }),
    (error) => error.code === 'proposal-revision-conflict' && error.status === 409,
  )
  assert.equal(feedback.updateProposal({ root, proposalId: saved.id, expectedRevision: 2, status: 'converted', apply: false }).applied, false)
})

test('markFeedbackRequirement is idempotent and rejects a different requirement', () => {
  const root = makeRoot()
  const destination = makeRoot({ id: 'DEST' })
  configureDestination(root, destination)
  const record = save(root).feedback
  assert.equal(record.status, 'routed')

  const requirement = { root: destination, id: 'REQ-DEST-001', revision: 1 }
  const marked = feedback.markFeedbackRequirement({ root, id: record.id, requirement })
  assert.equal(marked.status, 'requirement-created')
  assert.equal(marked.requirement.id, 'REQ-DEST-001')
  assert.equal(marked.requirement.revision, 1)
  assert.equal(marked.requirement.root, resolve(destination))
  assert.equal(marked.failure, null)

  const again = feedback.markFeedbackRequirement({ root, id: record.id, requirement })
  assert.equal(again.revision, marked.revision)
  assert.equal(again.requirement.id, 'REQ-DEST-001')

  assert.throws(
    () => feedback.markFeedbackRequirement({ root, id: record.id, requirement: { root: destination, id: 'REQ-DEST-002', revision: 1 } }),
    (error) => error.code === 'feedback-already-created' && error.status === 409,
  )
})

test('a failed generation keeps the failure for an explicit retry', () => {
  const root = makeRoot()
  const failed = feedback.markFeedbackFailed({
    root,
    id: save(root).feedback.id,
    failure: { code: 'write-failed', message: 'requirements 目录不可写 token=sk-abcdefghijklmn' },
  })
  assert.equal(failed.status, 'failed')
  assert.equal(failed.failure.code, 'write-failed')
  assert.equal(failed.failure.message.includes('sk-abcdefghijklmn'), false)
  assert.equal(failed.requirement, null)

  const destination = makeRoot({ id: 'DEST' })
  const retried = feedback.routeFeedback({
    root,
    id: failed.id,
    destination: { workspaceId: 'ws-dest', projectId: 'DEST', root: destination },
  })
  assert.equal(retried.status, 'routed')
  assert.equal(retried.routing.reason, null)
  assert.equal(retried.routing.attempts.some((attempt) => attempt.outcome === 'failed'), true)
  assert.equal(retried.routing.attempts.at(-1).outcome, 'routed')

  assert.throws(
    () => feedback.routeFeedback({ root, id: 'FB-9999', destination: { root: destination } }),
    (error) => error.code === 'feedback-not-found' && error.status === 404,
  )
})

test('feedbackInbox counts statuses and never leaks the full context', () => {
  const root = makeRoot()
  const destination = makeRoot({ id: 'DEST' })

  const needsRouting = save(root, { statement: '无目标反馈' }).feedback
  configureDestination(root, destination)
  const routed = save(root, { statement: '已路由反馈' }).feedback
  const created = save(root, { statement: '已生成需求' }).feedback
  const failed = save(root, { statement: '生成失败反馈' }).feedback

  feedback.markFeedbackRequirement({ root, id: created.id, requirement: { root: destination, id: 'REQ-DEST-001', revision: 1 } })
  feedback.markFeedbackFailed({ root, id: failed.id, failure: { code: 'create-failed', message: 'boom' } })

  const inbox = feedback.feedbackInbox(root)
  assert.equal(inbox.schema, feedback.FEEDBACK_INBOX_SCHEMA)
  assert.deepEqual(inbox.counts, { saved: 0, needsRouting: 1, routed: 1, requirementCreated: 1, failed: 1 })
  assert.equal(inbox.items.length, 4)
  assert.equal(inbox.settings.schema, feedback.FEEDBACK_SETTINGS_SCHEMA)

  const byId = new Map(inbox.items.map((item) => [item.id, item]))
  assert.equal(byId.get(needsRouting.id).destination, null)
  assert.equal(byId.get(needsRouting.id).contextSnapshotId, needsRouting.context.contextSnapshotId)
  assert.equal(byId.get(created.id).requirement.id, 'REQ-DEST-001')
  assert.equal(byId.get(failed.id).failureCode, 'create-failed')
  assert.equal(byId.get(routed.id).destination.projectId, 'DEST')

  const allowedKeys = new Set([
    'category',
    'contextSnapshotId',
    'createdAt',
    'destination',
    'disposition',
    'failureCode',
    'id',
    'page',
    'proposalId',
    'requirement',
    'resolution',
    'stage',
    'statementExcerpt',
    'status',
    'supplementCount',
    'updatedAt',
    'processing',
    'reconciliation',
  ])
  for (const item of inbox.items) {
    assert.equal('context' in item, false)
    assert.equal(item.statementExcerpt.length <= 161, true)
    for (const key of Object.keys(item)) assert.equal(allowedKeys.has(key), true, `unexpected inbox key ${key}`)
    assert.equal(item.disposition, 'open')
    assert.equal(item.resolution, 'pending')
    assert.equal(item.supplementCount, 0)
  }
})

test('updateFeedbackCategory is append-only on notes and validates input', () => {
  const root = makeRoot()
  const record = save(root).feedback
  const before = JSON.stringify(record.context)

  const noChange = feedback.updateFeedbackCategory({ root, feedbackId: record.id, category: 'undetermined', apply: false })
  assert.equal(noChange.applied, false)
  assert.equal(feedback.readFeedback(root, record.id).category, 'undetermined')

  const changed = feedback.updateFeedbackCategory({
    root,
    feedbackId: record.id,
    category: 'capability',
    notes: '复核后确认为能力缺口',
    actor: 'test:reviewer',
  })
  assert.equal(changed.applied, true)
  assert.equal(changed.feedback.category, 'capability')
  assert.equal(changed.feedback.revision, 2)
  assert.equal(changed.feedback.notes.length, 1)
  assert.equal(changed.feedback.notes[0].text, '复核后确认为能力缺口')
  assert.equal(changed.feedback.notes[0].actor, 'test:reviewer')
  assert.equal(JSON.stringify(changed.feedback.context), before)

  assert.throws(
    () => feedback.updateFeedbackCategory({ root, feedbackId: 'FB-9999', category: 'defect' }),
    (error) => error.code === 'feedback-not-found' && error.status === 404,
  )
  assert.throws(
    () => feedback.updateFeedbackCategory({ root, feedbackId: record.id, category: 'bug' }),
    (error) => error.code === 'invalid-category' && error.status === 400,
  )
})

test('appendSupplement freezes its own context and never rewrites the original statement', () => {
  const root = makeRoot()
  const original = save(root, { statement: '导出偶尔会多一列' }).feedback
  const before = JSON.stringify(original.context)

  const first = feedback.appendSupplement({
    root,
    id: original.id,
    statement: '今天又出现了，这次是 12 列',
    note: '补充一次复现',
    supplementId: 'sup-1',
    context: { ui: { page: 'detail', stage: 'test' }, observedAt: '2026-11-03T03:00:00.000Z' },
    actor: 'test:user',
    observedAt: '2026-11-03T03:00:00.000Z',
  })
  assert.equal(first.changed, true)
  assert.equal(first.feedback.revision, 2)
  assert.equal(first.feedback.statement, '导出偶尔会多一列')
  assert.equal(JSON.stringify(first.feedback.context), before)
  assert.equal(first.feedback.supplements.length, 1)
  assert.equal(first.feedback.supplements[0].statement, '今天又出现了，这次是 12 列')
  assert.equal(first.feedback.supplements[0].note, '补充一次复现')
  assert.equal(first.feedback.supplements[0].actor, 'test:user')
  assert.equal(typeof first.feedback.supplements[0].contextSnapshotId, 'string')

  const replay = feedback.appendSupplement({ root, id: original.id, statement: '今天又出现了，这次是 12 列', supplementId: 'sup-1' })
  assert.equal(replay.changed, false)
  assert.equal(feedback.readFeedback(root, original.id).supplements.length, 1)

  assert.throws(
    () => feedback.appendSupplement({ root, id: original.id, statement: '   ' }),
    (error) => error.code === 'statement-required' || error.code === 'invalid-statement',
  )
  assert.throws(
    () => feedback.appendSupplement({ root, id: 'FB-9999', statement: '补充' }),
    (error) => error.code === 'feedback-not-found' && error.status === 404,
  )
})

test('disposition and resolution are separate from requirement creation', () => {
  const root = makeRoot()
  const destination = makeRoot({ id: 'DEST' })
  configureDestination(root, destination)
  const record = save(root, { statement: '提示文案有歧义' }).feedback

  assert.throws(
    () => feedback.updateFeedbackResolution({ root, id: record.id, state: 'resolved' }),
    (error) => error.code === 'resolution-needs-requirement' && error.status === 409,
  )
  assert.throws(
    () => feedback.updateFeedbackDisposition({ root, id: record.id, disposition: 'done' }),
    (error) => error.code === 'invalid-disposition' && error.status === 400,
  )

  const deferred = feedback.updateFeedbackDisposition({ root, id: record.id, disposition: 'deferred', reason: '等下一版' })
  assert.equal(deferred.feedback.disposition.state, 'deferred')
  assert.equal(deferred.feedback.disposition.reason, '等下一版')
  assert.equal(deferred.feedback.status, 'routed', 'disposition must not fake requirement creation')

  feedback.markFeedbackRequirement({ root, id: record.id, requirement: { root: destination, id: 'REQ-DEST-002', revision: 1 } })
  const resolved = feedback.updateFeedbackResolution({ root, id: record.id, state: 'resolved', note: '已在 1.2.0 验证', evidence: { verifiedBy: 'tester', at: '2026-11-03' } })
  assert.equal(resolved.feedback.resolution.state, 'resolved')
  assert.equal(resolved.feedback.resolution.note, '已在 1.2.0 验证')

  const reopened = feedback.updateFeedbackResolution({ root, id: record.id, state: 'reopened', note: '同一路径又复现' })
  assert.equal(reopened.feedback.resolution.state, 'reopened')

  const inbox = feedback.feedbackInbox(root)
  const item = inbox.items.find((entry) => entry.id === record.id)
  assert.equal(item.disposition, 'deferred')
  assert.equal(item.resolution, 'reopened')
})

test('feedbackInbox filters items without changing the global counts', () => {
  const root = makeRoot()
  const a = save(root, { statement: '列表滚动卡顿', category: 'experience' }).feedback
  const b = save(root, { statement: '保存按钮没有反应', category: 'defect' }).feedback
  feedback.updateFeedbackDisposition({ root, id: b.id, disposition: 'deferred', reason: '先观察' })

  const filtered = feedback.feedbackInbox(root, { disposition: 'deferred' })
  assert.equal(filtered.items.length, 1)
  assert.equal(filtered.items[0].id, b.id)
  assert.equal(filtered.total, 2)
  assert.equal(filtered.shown, 1)
  assert.equal(filtered.counts.saved + filtered.counts.needsRouting + filtered.counts.routed, 2)

  const byText = feedback.feedbackInbox(root, { q: '滚动' })
  assert.equal(byText.items.length, 1)
  assert.equal(byText.items[0].id, a.id)

  const byCategory = feedback.feedbackInbox(root, { category: 'defect' })
  assert.equal(byCategory.items.length, 1)
  assert.equal(byCategory.items[0].id, b.id)

  const capped = feedback.feedbackInbox(root, { limit: 1 })
  assert.equal(capped.items.length, 1)
  assert.equal(capped.total, 2)
})

test('processing is queued, recovered after an interruption and never bumps revision', () => {
  const root = makeRoot()
  const { feedback: record } = save(root)
  assert.equal(record.processing, undefined)

  const queued = feedback.enqueueFeedbackProcessing({ root, id: record.id })
  assert.equal(queued.changed, true)
  assert.equal(queued.feedback.processing.state, 'queued')
  assert.equal(queued.feedback.revision, record.revision)

  const replay = feedback.enqueueFeedbackProcessing({ root, id: record.id })
  assert.equal(replay.changed, false)

  const running = feedback.updateFeedbackProcessing({ root, id: record.id, patch: { state: 'analyzing' } })
  assert.equal(running.feedback.processing.state, 'analyzing')
  assert.equal(running.feedback.revision, record.revision)
  const queue = feedback.listFeedbackProcessing(root)
  assert.deepEqual(queue.map((entry) => entry.id), [record.id])

  const recovered = feedback.recoverFeedbackProcessing({ root })
  assert.deepEqual(recovered.recovered, [record.id])
  const afterRecovery = feedback.readFeedback(root, record.id)
  assert.equal(afterRecovery.processing.state, 'queued')
  assert.match(afterRecovery.processing.lastError, /中断/)

  const done = feedback.updateFeedbackProcessing({
    root,
    id: record.id,
    patch: { state: 'draft-ready', proposalId: 'IMP-0001' },
  })
  assert.equal(done.feedback.processing.proposalId, 'IMP-0001')
  assert.equal(feedback.listFeedbackProcessing(root).length, 0)
  assert.throws(
    () => feedback.updateFeedbackProcessing({ root, id: record.id, patch: { state: 'done' } }),
    (error) => error.code === 'invalid-processing-state' && error.status === 400,
  )
})

test('confirmProposal is the human gate and is idempotent', () => {
  const root = makeRoot()
  const destination = makeRoot({ id: 'DEST' })
  configureDestination(root, destination)
  const { feedback: record } = save(root, { context: { targetProduct: { component: 'list' } } })
  const saved = feedback.saveProposal(
    root,
    feedback.planProposal({ feedback: record, settings: feedback.readFeedbackSettings(root) }),
  )
  assert.equal(saved.status, 'awaiting-confirmation')

  assert.throws(
    () => feedback.confirmProposal({ root, proposalId: saved.id, expectedRevision: 99 }),
    (error) => error.code === 'proposal-revision-conflict' && error.status === 409,
  )

  const confirmed = feedback.confirmProposal({
    root,
    proposalId: saved.id,
    expectedRevision: saved.revision,
    actor: 'test:reviewer',
    notes: '范围可以',
  })
  assert.equal(confirmed.changed, true)
  assert.equal(confirmed.proposal.status, 'confirmed')
  assert.equal(confirmed.proposal.confirmation.confirmedBy, 'test:reviewer')
  assert.equal(confirmed.proposal.confirmation.notes, '范围可以')
  assert.ok(confirmed.proposal.confirmation.confirmedAt)

  const replay = feedback.confirmProposal({ root, proposalId: saved.id })
  assert.equal(replay.changed, false)

  feedback.updateProposal({ root, proposalId: saved.id, status: 'converted' })
  assert.throws(
    () => feedback.confirmProposal({ root, proposalId: saved.id }),
    (error) => error.code === 'proposal-not-confirmable' && error.status === 409,
  )
  assert.throws(
    () => feedback.confirmProposal({ root, proposalId: 'IMP-9999' }),
    (error) => error.code === 'proposal-not-found' && error.status === 404,
  )
})

test('reconciliation records link drift without bumping the revision', () => {
  const root = makeRoot()
  const first = save(root, { clientRequestId: 'client-reconcile' })
  const failed = feedback.markFeedbackReconciliation({ root, id: first.feedback.id, state: 'link-failed', requirementId: 'REQ-REC-001', note: '关联失败' })
  assert.equal(failed.feedback.reconciliation.state, 'link-failed')
  assert.equal(failed.feedback.reconciliation.requirementId, 'REQ-REC-001')
  assert.equal(failed.feedback.revision, first.feedback.revision)
  const resolved = feedback.markFeedbackReconciliation({ root, id: first.feedback.id, state: 'resolved', requirementId: 'REQ-REC-001' })
  assert.equal(resolved.feedback.reconciliation.state, 'resolved')
  assert.throws(
    () => feedback.markFeedbackReconciliation({ root, id: first.feedback.id, state: 'unknown' }),
    (error) => error.code === 'invalid-reconciliation-state' && error.status === 400,
  )
  const inbox = feedback.feedbackInbox(root)
  assert.equal(inbox.items[0].reconciliation.state, 'resolved')
  assert.equal(inbox.items[0].reconciliation.requirementId, 'REQ-REC-001')
})

test('reconciliation records link drift without bumping the revision', () => {
  const root = makeRoot()
  const first = save(root, { clientRequestId: 'client-reconcile' })
  const failed = feedback.markFeedbackReconciliation({ root, id: first.feedback.id, state: 'link-failed', requirementId: 'REQ-REC-001', note: '关联失败' })
  assert.equal(failed.feedback.reconciliation.state, 'link-failed')
  assert.equal(failed.feedback.reconciliation.requirementId, 'REQ-REC-001')
  assert.equal(failed.feedback.revision, first.feedback.revision)
  const resolved = feedback.markFeedbackReconciliation({ root, id: first.feedback.id, state: 'resolved', requirementId: 'REQ-REC-001' })
  assert.equal(resolved.feedback.reconciliation.state, 'resolved')
  assert.throws(
    () => feedback.markFeedbackReconciliation({ root, id: first.feedback.id, state: 'unknown' }),
    (error) => error.code === 'invalid-reconciliation-state' && error.status === 400,
  )
  const inbox = feedback.feedbackInbox(root)
  assert.equal(inbox.items[0].reconciliation.state, 'resolved')
  assert.equal(inbox.items[0].reconciliation.requirementId, 'REQ-REC-001')
})

test('conversion records the create/link hand-off and stays out of the revision', () => {
  const root = makeRoot()
  const { feedback: record } = save(root)

  const begun = feedback.beginFeedbackConversion({ root, id: record.id })
  assert.equal(begun.changed, true)
  assert.equal(begun.feedback.conversion.state, 'pending')
  assert.equal(begun.feedback.conversion.id, `FBC-${record.id}`)
  assert.equal(begun.feedback.revision, record.revision)

  const replay = feedback.beginFeedbackConversion({ root, id: record.id })
  assert.equal(replay.changed, false)

  const created = feedback.updateFeedbackConversion({
    root,
    id: record.id,
    patch: { state: 'created', requirementId: 'REQ-DEST-001', requirementRoot: 'D:/dest' },
  })
  assert.equal(created.feedback.conversion.requirementId, 'REQ-DEST-001')
  assert.equal(created.feedback.conversion.state, 'created')
  assert.equal(created.feedback.revision, record.revision)

  const again = feedback.beginFeedbackConversion({ root, id: record.id })
  assert.equal(again.changed, false, 'a created conversion is never reset to pending')

  const linked = feedback.updateFeedbackConversion({ root, id: record.id, patch: { state: 'linked' } })
  assert.equal(linked.feedback.conversion.state, 'linked')
  assert.ok(linked.feedback.conversion.linkedAt)
  assert.equal(linked.feedback.revision, record.revision)

  assert.throws(
    () => feedback.updateFeedbackConversion({ root, id: record.id, patch: { state: 'duplicated' } }),
    (error) => error.code === 'invalid-conversion-state' && error.status === 400,
  )
})
