import test from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { handleIntentRequest } from '../intent.mjs'
import { createSession, saveSession, buildIntentContext } from '../../alm-core/src/intent/index.mjs'
import { requirements } from '../query.mjs'

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
  const output = JSON.parse(execFileSync(process.execPath, [scriptPath, '--root', root, '--source-session', '讨论退款', '--apply'], { input: text, encoding: 'utf8' }))
  assert.equal(output.result.applied, true)
  assert.equal(requirements(root).requirements[0].id, output.result.requirementId)
  assert.equal(requirements(root).requirements[0].sourceSession, '讨论退款')
  assert.ok(requirements(root).requirements[0].investigationEvidence.some(ref => ref.path === 'reminder.mjs' && ref.line === 1))
  const revised = text.replace('返回成功', '显示成功')
  const update = JSON.parse(execFileSync(process.execPath, [scriptPath, '--root', root, '--update', output.result.requirementId, '--source-session', '二次讨论', '--apply'], { input: revised, encoding: 'utf8' }))
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

test('provider failure produces a local editable draft with a valid route', async t => {
  const root = mkdtempSync(join(tmpdir(), 'intent-fallback-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  cpSync(new URL('../../../fixtures/order-refund', import.meta.url), root, { recursive: true })
  const result = await handleIntentRequest({ root, body: { action: 'analyze', projectId: 'PAY', input: { text: '希望退款后可以提醒用户', source: 'text' } }, resolveAiSelection: async () => ({ provider: 'fake', model: 'fake' }), aiStreamFor: () => async function* () { throw new Error('HTTP 502') } })
  assert.equal(result.localFallback, true)
  assert.equal(result.session.items[0].recommendedRoute, 'create')
  assert.ok(result.session.docDraft?.goal)
  assert.ok(result.session.docDraft.pending.length)
})

test('local fallback distills the metrics-and-evidence intent into a searchable title', async t => {
  const root = mkdtempSync(join(tmpdir(), 'intent-local-title-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  cpSync(new URL('../../../fixtures/order-refund', import.meta.url), root, { recursive: true })
  const input = '我希望需求插件能够实现收集需求插件本身开发过程核心数据指标和相关证据，通过数据洞察和分析，实现需求插件自身的迭代和优化，并形成可验证的改进建议。'
  const result = await handleIntentRequest({ root, body: { action: 'analyze', projectId: 'PAY', input: { text: input, source: 'text' } }, resolveAiSelection: async () => ({ provider: 'fake', model: 'fake' }), aiStreamFor: () => async function* () { throw new Error('HTTP 502') } })
  assert.equal(result.localFallback, true)
  assert.equal(result.session.docDraft.title, '需求插件效能数据洞察与迭代优化')
  assert.doesNotMatch(result.session.docDraft.title, /能够实现收集|相关证据，通过/)
})

test('failed Grill analysis labels the fallback and distills a plugin self-healing title', async t => {
  const root = mkdtempSync(join(tmpdir(), 'intent-self-healing-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  cpSync(new URL('../../../fixtures/order-refund', import.meta.url), root, { recursive: true })
  const skillDir = join(root, '.agents', 'skills', 'grilling')
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: grilling\n---\n\nInterview the user relentlessly until you reach a shared understanding.\n')
  const input = '我希望当需求插件功能在使用该功能时，若功能报错，非网络问题，而是功能本身的bug，可以触发DSH自动修复，修复完成后自动重启该插件'
  const result = await handleIntentRequest({ root, body: { action: 'analyze', projectId: 'PAY', input: { text: input, source: 'text' } }, resolveAiSelection: async () => ({ provider: 'fake', model: 'fake' }), aiStreamFor: () => async function* () { throw new Error('HTTP 502') } })
  assert.equal(result.localFallback, true)
  assert.equal(result.session.docDraft.title, '需求插件故障自动修复与重启')
  assert.equal(result.session.grill.outcome, 'fallback')
  assert.equal(result.session.grill.failureCode, 'ai-call-failed')
})

test('loads the installed Grill Skill and injects it into the host model for later rounds', async t => {
  const root = mkdtempSync(join(tmpdir(), 'intent-grill-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  cpSync(new URL('../../../fixtures/order-refund', import.meta.url), root, { recursive: true })
  const skillDir = join(root, '.agents', 'skills', 'grilling')
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: grilling\n---\n\nInterview the user relentlessly until you reach a shared understanding.\n')
  const calls = []
  const analysis = {
    schemaVersion: 'intent-review.v1',
    items: [{
      itemId: 'ITM-GRILL-1', sourceRefs: [{ ref: 'input.text', line: null, endLine: null, quote: '需求澄清支持拷问 Skills' }],
      userProblem: '需求价值没有经过明确评估', desiredOutcome: '在澄清阶段评估需求价值', recommendedRoute: 'create', routeRationale: '需要形成可确认的价值结论', related: [], assumptions: [], unknowns: [],
      candidate: { title: '需求澄清支持拷问 Skills', problem: '需求价值没有经过明确评估', goal: '在澄清阶段评估需求价值', inScope: [], outOfScope: [], acceptance: [{ precondition: '用户提交需求原话', action: '启动拷问', expected: '显示价值判断问题', judgement: '页面展示问题' }], owner: null, priority: null }, counterexample: null, valueCheck: null,
    }],
    nextQuestion: { questionId: 'Q-GRILL-1', itemIds: ['ITM-GRILL-1'], text: '该需求优先避免哪类风险？', whyNow: '确定价值目标', options: [{ id: 'rework', label: '避免返工', impact: '关注需求质量' }], allowFreeText: true },
  }
  const stream = options => {
    calls.push(options)
    return (async function* () { yield { type: 'text-delta', text: JSON.stringify(analysis) }; yield { type: 'finish', reason: { kind: 'stop' } } })()
  }
  const first = await handleIntentRequest({ root, body: { action: 'analyze', projectId: 'PAY', input: { text: '在需求澄清过程中，可以使用拷问skills，对需求进行拷问，澄清需求是否有价值', source: 'text' } }, resolveAiSelection: async () => ({ provider: 'fake', model: 'fake' }), aiStreamFor: () => stream })
  assert.equal(first.session.grill.status, 'loaded')
  assert.equal(first.session.grill.outcome, 'applied')
  assert.equal(first.session.grill.name, 'grilling')
  assert.equal(first.session.grill.source, 'workspace')
  assert.match(calls[0].messages.map(message => message.content.map(part => part.text).join('\n')).join('\n'), /Interview the user relentlessly/)
  const second = await handleIntentRequest({ root, body: { action: 'analyze', projectId: 'PAY', sessionId: first.session.sessionId, retryExisting: true, expectedSessionRevision: first.session.sessionRevision, input: { text: first.session.input.text, source: 'text' }, grillAnswers: [{ question: '该需求优先避免哪类风险？', answer: '避免返工' }] }, resolveAiSelection: async () => ({ provider: 'fake', model: 'fake' }), aiStreamFor: () => stream })
  assert.equal(second.session.grill.round, 2)
  assert.match(calls[1].messages.map(message => message.content.map(part => part.text).join('\n')).join('\n'), /回答：避免返工/)
})


test('spoken fallback supplies editable acceptance and can be confirmed with priority', async t => {
  const root = mkdtempSync(join(tmpdir(), 'intent-spoken-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  cpSync(new URL('../../../fixtures/order-refund', import.meta.url), root, { recursive: true })
  const result = await handleIntentRequest({ root, body: { action: 'analyze', projectId: 'PAY', input: { text: '在需求澄清过程中，可以使用拷问skills，对需求进行拷问，澄清需求是否有价值', source: 'text' } }, resolveAiSelection: async () => ({ provider: 'fake', model: 'fake' }), aiStreamFor: () => async function* () { throw new Error('HTTP 502') } })
  let session = result.session
  assert.ok(session.docDraft.pending.filter(entry => entry.text.includes('验收建议')).length >= 2)
  assert.ok(session.docDraft.title.length <= 50)
  assert.match(session.items[0].candidate.title, /拷问/)
  assert.match(session.docDraft.pending.map(entry => entry.text).join(' '), /拷问.*需求|需求.*拷问/)
  assert.doesNotMatch(session.docDraft.pending.map(entry => entry.text).join(' '), /在目标场景中/)
  const acceptance = session.docDraft.pending.filter(entry => entry.text.includes('验收建议')).map(entry => ({ expected: entry.text, judgement: entry.text }))
  const edited = await handleIntentRequest({ root, body: { action: 'edit', sessionId: session.sessionId, itemId: session.items[0].itemId, expectedInputRevision: session.input.inputRevision, expectedSessionRevision: session.sessionRevision, fields: { route: 'create', priority: 'P1', title: session.items[0].candidate.title, goal: session.docDraft.goal, problem: session.docDraft.problem, acceptance } } })
  session = edited.session
  const confirmed = await handleIntentRequest({ root, body: { action: 'confirm', sessionId: session.sessionId, expectedInputRevision: session.input.inputRevision, expectedSessionRevision: session.sessionRevision, contextSnapshotId: session.context.contextSnapshotId, docHash: session.docDraft.docHash, draftRevision: session.draftRevision, idempotencyKey: 'spoken-confirm-1', confirmation: { route: 'create', priority: 'P1', items: [{ itemId: session.items[0].itemId, route: 'create' }] } } })
  assert.equal(confirmed.ok, true)
})
