import test from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { handleIntentRequest } from '../intent.mjs'
import { createSession, saveSession, buildIntentContext } from '../../alm-core/src/intent/index.mjs'
import { requirements } from '../query.mjs'
import { runCaptured } from '../../alm-core/src/process-capture.mjs'

/** CLI capture that survives a sandbox which forbids piped child stdio. */
function runNodeCli(args, input) {
  const result = runCaptured(process.execPath, args, { input })
  if (result.error || result.status !== 0) {
    throw new Error(`node CLI failed: ${result.error?.code ?? result.error?.message ?? result.stderr}`)
  }
  return String(result.stdout ?? '')
}

test('structured input creates a draft without invoking the model', async t => {
  const root = mkdtempSync(join(tmpdir(), 'intent-local-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  cpSync(new URL('../../../fixtures/order-refund', import.meta.url), root, { recursive: true })
  let calls = 0
  const result = await handleIntentRequest({ root, body: { action: 'analyze', projectId: 'PAY', input: { text: '标题：退款提醒\n目标：提醒用户\n问题：用户看不到进度\n验收标准：\n- 退款完成后显示提醒', source: 'text' } }, resolveAiSelection: async () => { calls++; throw new Error('502') }, aiStreamFor: () => null })
  assert.equal(calls, 0)
  assert.ok(result.session.docDraft?.acceptance?.length)
  assert.equal(result.session.items[0].recommendedRoute, 'create')
})

test('CLI finds matching code and creates a requirement at the top', t => {
  const root = mkdtempSync(join(tmpdir(), 'intent-cli-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  cpSync(new URL('../../../fixtures/order-refund', import.meta.url), root, { recursive: true })
  writeFileSync(join(root, 'reminder.mjs'), 'export function reminderNotification() { return true }\n')
  const text = '标题：reminderNotification\n目标：reminderNotification\n问题：reminderNotification\n验收标准：\n- reminderNotification 返回成功'
  const script = new URL('../bin/crystallize.mjs', import.meta.url)
  const scriptPath = script.pathname.startsWith('/') && process.platform === 'win32' ? decodeURIComponent(script.pathname.slice(1)) : decodeURIComponent(script.pathname)
  const output = JSON.parse(runNodeCli([scriptPath, '--root', root, '--source-session', '讨论退款', '--apply'], text))
  assert.equal(output.result.applied, true)
  assert.equal(requirements(root).requirements[0].id, output.result.requirementId)
  assert.equal(requirements(root).requirements[0].sourceSession, '讨论退款')
  assert.ok(requirements(root).requirements[0].investigationEvidence.some(ref => ref.path === 'reminder.mjs' && ref.line === 1))
  const revised = text.replace('返回成功', '显示成功')
  const update = JSON.parse(runNodeCli([scriptPath, '--root', root, '--update', output.result.requirementId, '--source-session', '二次讨论', '--apply'], revised))
  assert.equal(update.result.result.revision, 2)
  assert.equal(requirements(root).requirements.find(item => item.id === output.result.requirementId).specConvergences[0].sourceSession, '二次讨论')
})

test('loading a legacy manual session repairs it and permits explicit confirmation', async t => {
  const root = mkdtempSync(join(tmpdir(), 'intent-legacy-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  cpSync(new URL('../../../fixtures/order-refund', import.meta.url), root, { recursive: true })
  const text = '标题：退款提醒\n目标：提醒用户\n问题：用户看不到进度\n验收标准：\n- 退款完成后显示提醒'
  const context = buildIntentContext({ root, projectId: 'PAY', intentText: text })
  const session = createSession({ root, project: 'PAY', input: { text, source: 'text' }, context })
  saveSession({ root, session: { ...session, items: [{ itemId: 'ITM-MANUAL-1', recommendedRoute: null, sourceRefs: [], candidate: null, fields: {}, unknowns: [] }] } })
  const loaded = await handleIntentRequest({ root, body: { action: 'load', sessionId: session.sessionId } })
  assert.equal(loaded.session.items[0].recommendedRoute, 'create')
  assert.ok(loaded.session.docDraft?.acceptance.length)
  const confirmed = await handleIntentRequest({ root, body: { action: 'confirm', sessionId: session.sessionId, expectedInputRevision: loaded.session.input.inputRevision, expectedSessionRevision: loaded.session.sessionRevision, contextSnapshotId: loaded.session.context.contextSnapshotId, docHash: loaded.session.docDraft.docHash, draftRevision: loaded.session.docDraft.draftRevision, idempotencyKey: 'legacy-manual-confirm-1', confirmation: { route: 'create', priority: 'P1', items: [{ itemId: 'ITM-MANUAL-1', route: 'create' }] } } })
  assert.equal(confirmed.ok, true)
})

test('a provider failure never invents a draft: no title, no acceptance, no confirm', async t => {
  const root = mkdtempSync(join(tmpdir(), 'intent-fallback-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  cpSync(new URL('../../../fixtures/order-refund', import.meta.url), root, { recursive: true })
  const result = await handleIntentRequest({ root, body: { action: 'analyze', projectId: 'PAY', input: { text: '希望退款后可以提醒用户', source: 'text' } }, resolveAiSelection: async () => ({ provider: 'fake', model: 'fake' }), aiStreamFor: () => async function* () { throw new Error('HTTP 502') } })
  assert.equal(result.localFallback, true)
  assert.equal(result.ai, 'none')
  const session = result.session
  // AC-03: 模型未参与时不得生成 problem 与 acceptance。
  assert.equal(session.docDraft ?? null, null)
  assert.equal(session.items[0].candidate, null)
  assert.equal(session.items[0].ai, 'none')
  assert.ok(session.items[0].sourceRefs[0].quote.includes('退款'))
  const codes = result.readiness.reasons.map(entry => entry.code)
  assert.ok(codes.includes('missing-title'), codes.join(','))
  assert.ok(codes.includes('needs-acceptance'), codes.join(','))
  assert.equal(result.readiness.ready, false)
  // 未澄清状态不允许一键确认。
  const fresh = (await handleIntentRequest({ root, body: { action: 'load', sessionId: session.sessionId } })).session
  await assert.rejects(
    handleIntentRequest({ root, body: { action: 'confirm', sessionId: fresh.sessionId, expectedInputRevision: fresh.input.inputRevision, expectedSessionRevision: fresh.sessionRevision, contextSnapshotId: fresh.context.contextSnapshotId, idempotencyKey: 'fallback-confirm-1', confirmation: { route: 'create', priority: 'P1', items: [{ itemId: fresh.items[0].itemId, route: 'create' }] } } }),
    error => ['not-ready', 'missing-acceptance', 'missing-title', 'needs-acceptance'].includes(error.code),
  )
})

test('a human can still fill the blank draft by hand and confirm it', async t => {
  const root = mkdtempSync(join(tmpdir(), 'intent-manual-fill-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  cpSync(new URL('../../../fixtures/order-refund', import.meta.url), root, { recursive: true })
  const failed = await handleIntentRequest({ root, body: { action: 'analyze', projectId: 'PAY', input: { text: '希望退款后可以提醒用户', source: 'text' } }, resolveAiSelection: async () => ({ provider: 'fake', model: 'fake' }), aiStreamFor: () => async function* () { throw new Error('HTTP 502') } })
  let session = (await handleIntentRequest({ root, body: { action: 'load', sessionId: failed.session.sessionId } })).session
  const edited = await handleIntentRequest({ root, body: { action: 'edit', sessionId: session.sessionId, itemId: session.items[0].itemId, expectedInputRevision: session.input.inputRevision, expectedSessionRevision: session.sessionRevision, fields: { route: 'create', priority: 'P1', title: '退款完成后提醒用户进度', goal: '退款完成后向用户提示进度', problem: '用户看不到退款进度', acceptance: [{ expected: '退款完成后出现进度提醒', judgement: '页面可见提醒' }] } } })
  session = edited.session
  assert.equal(edited.readiness.ready, false)
  assert.ok(edited.readiness.reasons.some(entry => entry.code === 'not-confirmed'))
  const confirmed = await handleIntentRequest({ root, body: { action: 'confirm', sessionId: session.sessionId, expectedInputRevision: session.input.inputRevision, expectedSessionRevision: session.sessionRevision, contextSnapshotId: session.context.contextSnapshotId, docHash: session.docDraft?.docHash, draftRevision: session.draftRevision, idempotencyKey: 'manual-fill-confirm-1', confirmation: { route: 'create', priority: 'P1', items: [{ itemId: session.items[0].itemId, route: 'create' }] } } })
  assert.equal(confirmed.ok, true)
})

test('failed Grill analysis records the failure and leaves the draft unclarified', async t => {
  const root = mkdtempSync(join(tmpdir(), 'intent-self-healing-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  cpSync(new URL('../../../fixtures/order-refund', import.meta.url), root, { recursive: true })
  const skillDir = join(root, '.agents', 'skills', 'grilling')
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: grilling\n---\n\nInterview the user relentlessly until you reach a shared understanding.\n')
  const input = '我希望当需求插件功能在使用该功能时，若功能报错，非网络问题，而是功能本身的bug，可以触发DSH自动修复，修复完成后自动重启该插件'
  const result = await handleIntentRequest({ root, body: { action: 'analyze', projectId: 'PAY', input: { text: input, source: 'text' } }, resolveAiSelection: async () => ({ provider: 'fake', model: 'fake' }), aiStreamFor: () => async function* () { throw new Error('HTTP 502') } })
  assert.equal(result.localFallback, true)
  // 关键词标题库已删除：不再把原话编成“需求插件故障自动修复与重启”。
  assert.equal(result.session.docDraft ?? null, null)
  assert.equal(result.session.ai, 'none')
  assert.equal(result.session.grill.outcome, 'fallback')
  assert.equal(result.session.grill.failureCode, 'ai-call-failed')
})

test('spoken fallback keeps the quote and requires human acceptance before confirming', async t => {
  const root = mkdtempSync(join(tmpdir(), 'intent-spoken-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  cpSync(new URL('../../../fixtures/order-refund', import.meta.url), root, { recursive: true })
  const result = await handleIntentRequest({ root, body: { action: 'analyze', projectId: 'PAY', input: { text: '在需求澄清过程中，可以使用拷问skills，对需求进行拷问，澄清需求是否有价值', source: 'text' } }, resolveAiSelection: async () => ({ provider: 'fake', model: 'fake' }), aiStreamFor: () => async function* () { throw new Error('HTTP 502') } })
  let session = (await handleIntentRequest({ root, body: { action: 'load', sessionId: result.session.sessionId } })).session
  assert.equal(session.docDraft ?? null, null)
  assert.equal(session.items[0].candidate, null)
  assert.equal(session.state, 'needs_input')
  assert.match(session.items[0].sourceRefs[0].quote, /拷问/)
  const acceptance = ['澄清阶段用户能看到价值追问问题']
  const edited = await handleIntentRequest({ root, body: { action: 'edit', sessionId: session.sessionId, itemId: session.items[0].itemId, expectedInputRevision: session.input.inputRevision, expectedSessionRevision: session.sessionRevision, fields: { route: 'create', priority: 'P1', title: '需求澄清接入价值拷问', goal: '澄清阶段评估需求价值', problem: '需求价值未经过评估', acceptance: acceptance.map(text => ({ expected: text, judgement: text })) } } })
  session = edited.session
  const confirmed = await handleIntentRequest({ root, body: { action: 'confirm', sessionId: session.sessionId, expectedInputRevision: session.input.inputRevision, expectedSessionRevision: session.sessionRevision, contextSnapshotId: session.context.contextSnapshotId, docHash: session.docDraft?.docHash, draftRevision: session.draftRevision, idempotencyKey: 'spoken-confirm-1', confirmation: { route: 'create', priority: 'P1', items: [{ itemId: session.items[0].itemId, route: 'create' }] } } })
  assert.equal(confirmed.ok, true)
})
