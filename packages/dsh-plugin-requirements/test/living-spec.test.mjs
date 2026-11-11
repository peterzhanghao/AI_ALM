import test from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { handleIntentRequest } from '../intent.mjs'
import { writeInvestigation, INVESTIGATION_SCHEMA } from '../investigate.mjs'
import { indexReport } from '../../alm-core/src/commands.mjs'
import { createRun, requirementAnchor, updateRun } from '../../alm-core/src/requirements/run.mjs'
import { createCandidate, candidateStatus } from '../../alm-core/src/requirements/candidate.mjs'
import { confirmSpecDelta, listSpecConvergences, markSpecDeltaRepair, pendingSpecDeltas, proposeSpecDelta, triageFeedback, readIterationRetry } from '../../alm-core/src/requirements/convergence.mjs'
import { deriveDetailView } from '../detail-view.mjs'
import { requirements } from '../query.mjs'
import { renderRequirementsPage } from '../render.mjs'
import RequirementsService from '../index.js'
import { createServer } from 'node:http'
import vm from 'node:vm'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'alm-living-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  cpSync(new URL('../../../fixtures/order-refund', import.meta.url), root, { recursive: true })
  execFileSync('git', ['init', '-q', root])
  return root
}

test('chat crystallization creates a confirmed requirement only with current cited lines', async t => {
  const root = fixture(t)
  writeFileSync(join(root, 'evidence.mjs'), 'export const feature = true\n')
  const id = 'INV-20260101000000-abcdef'
  writeInvestigation(root, { schema: INVESTIGATION_SCHEMA, investigationId: id, source: 'observed_evidence', verdict: 'answered', findings: [{ claim: 'feature exists', refs: [{ path: 'evidence.mjs', line: 1, quote: 'export const feature', verified: true }] }] })
  const body = { action: 'crystallize', summary: '10:12 用户：标题：完善功能\n10:13 助手：目标：完成处理\n问题现状：现在无法处理\n验收标准：\n- 提交后显示成功', investigationIds: [id] }
  const preview = await handleIntentRequest({ root, body })
  assert.equal(preview.result.applied, false)
  assert.equal(preview.draft.goal, '完成处理')
  const created = await handleIntentRequest({ root, body: { ...body, apply: true, draftHash: preview.draftHash } })
  assert.equal(created.result.applied, true)
  assert.match(readFileSync(join(root, created.result.briefFile), 'utf8'), /提交后显示成功/)
  writeFileSync(join(root, 'evidence.mjs'), 'changed\n')
  await assert.rejects(handleIntentRequest({ root, body }), { code: 'invalid-investigation' })
})

test('feedback routes bug and pivot while ambiguous feedback stays for review', () => {
  assert.equal(triageFeedback('按钮无法点击，不符合原验收').kind, 'bug_fix')
  assert.equal(triageFeedback('把确认流程改为直接保存').kind, 'spec_pivot')
  assert.equal(triageFeedback('看看这个').kind, 'needs_review')
})

test('confirmed delta updates revision and history, invalidates candidate and rejects replay', t => {
  const root = fixture(t)
  const id = 'REQ-PAY-004'
  const asset = indexReport(root).assets.find(a => a.id === id)
  const candidate = createCandidate({ root, asset })
  const run = createRun({ root, requirementId: id, carrier: 'mock' }).run
  const afterBrief = '# 退款\n\n## 目标\n\n完成退款\n\n## 问题与场景\n\n退款处理复杂\n\n## 验收要求\n\n- AC-01 提交后展示新状态\n'
  const proposal = proposeSpecDelta({ root, runId: run.id, requirementId: id, afterBrief, evolutionNote: '调整展示状态', kind: 'spec_pivot' })
  assert.throws(() => confirmSpecDelta({ root, runId: run.id, requirementId: id, deltaHash: '0'.repeat(64), subject: { kind: 'human', id: 'human:local' } }), { code: 'delta-changed' })
  const result = confirmSpecDelta({ root, runId: run.id, requirementId: id, deltaHash: proposal.deltaHash, subject: { kind: 'human', id: 'human:local' } })
  assert.equal(result.result.revision, Number(asset.extra.revision ?? 1) + 1)
  const revised = indexReport(root).assets.find(a => a.id === id)
  assert.equal(candidateStatus({ root, asset: revised, candidate }).current, false)
  const events = listSpecConvergences(root, id)
  assert.equal(events.length, 1)
  assert.equal(events[0].kind, 'spec_converged')
  assert.ok(events[0].acceptanceCriteria.after.length)
  assert.ok(deriveDetailView({ id, specConvergences: events }).record.timeline.some(e => e.kind === 'spec_converged'))
  assert.throws(() => confirmSpecDelta({ root, runId: run.id, requirementId: id, deltaHash: proposal.deltaHash, subject: { kind: 'human', id: 'human:local' } }), { code: 'stale-baseline' })
  assert.match(requirementAnchor({ brief: afterBrief, revision: result.result.revision, docHash: 'x' }), /提交后展示新状态/)
})

test('one run converges repeatedly against the newest requirement hash', t => {
  const root = fixture(t), id = 'REQ-PAY-004'
  const initial = indexReport(root).assets.find(a => a.id === id)
  const candidate = createCandidate({ root, asset: initial })
  const run = createRun({ root, requirementId: id, carrier: 'mock' }).run
  const subject = { kind: 'human', id: 'human:local' }
  let lastHash = null
  for (let n = 1; n <= 3; n++) {
    const afterBrief = `# 退款\n\n## 目标\n\n完成退款\n\n## 问题与场景\n\n退款处理复杂\n\n## 验收要求\n\n- AC-01 展示状态 ${n}\n`
    const proposal = proposeSpecDelta({ root, runId: run.id, requirementId: id, afterBrief, evolutionNote: `反馈 ${n}`, kind: 'spec_pivot' })
    assert.notEqual(proposal.delta.baseRequirementHash, lastHash)
    lastHash = proposal.delta.baseRequirementHash
    const result = confirmSpecDelta({ root, runId: run.id, requirementId: id, deltaHash: proposal.deltaHash, subject })
    assert.equal(result.result.revision, Number(initial.extra.revision ?? 1) + n)
    assert.equal(candidateStatus({ root, asset: indexReport(root).assets.find(a => a.id === id), candidate }).current, false)
  }
  assert.equal(listSpecConvergences(root, id).length, 3)
  const html = renderRequirementsPage({ ok: true, requirements: [{ id, title: '退款', specConvergences: listSpecConvergences(root, id) }] })
  assert.match(html, /需求收敛历史/)
  assert.match(html, /反馈 3/)
})

test('competing proposals cannot apply against an obsolete baseline', t => {
  const root = fixture(t), id = 'REQ-PAY-004'
  const run = createRun({ root, requirementId: id, carrier: 'mock' }).run
  const brief = text => `# 退款\n\n## 目标\n\n完成退款\n\n## 问题与场景\n\n退款处理复杂\n\n## 验收要求\n\n- AC-01 ${text}\n`
  const one = proposeSpecDelta({ root, runId: run.id, requirementId: id, afterBrief: brief('显示 A'), evolutionNote: 'A', kind: 'spec_pivot' })
  const two = proposeSpecDelta({ root, runId: run.id, requirementId: id, afterBrief: brief('显示 B'), evolutionNote: 'B', kind: 'spec_pivot' })
  const subject = { kind: 'human', id: 'human:local' }
  confirmSpecDelta({ root, runId: run.id, requirementId: id, deltaHash: one.deltaHash, subject })
  assert.throws(() => confirmSpecDelta({ root, runId: run.id, requirementId: id, deltaHash: two.deltaHash, subject }), { code: 'stale-baseline' })
  assert.equal(listSpecConvergences(root, id).length, 1)
})

test('pending proposals survive reload and code-only resolution preserves the baseline', t => {
  const root = fixture(t), id = 'REQ-PAY-004'
  const asset = indexReport(root).assets.find(a => a.id === id)
  const before = readFileSync(join(root, asset.extra.brief), 'utf8')
  const run = createRun({ root, requirementId: id, carrier: 'mock' }).run
  const afterBrief = '# 退款\n\n## 目标\n\n完成退款\n\n## 问题与场景\n\n退款处理复杂\n\n## 验收要求\n\n- AC-01 展示状态\n'
  const proposal = proposeSpecDelta({ root, runId: run.id, requirementId: id, afterBrief, evolutionNote: '调整展示', kind: 'spec_pivot' })
  assert.equal(pendingSpecDeltas(root, id, run.id)[0].patchHash, proposal.deltaHash)
  const listed = requirements(root).requirements.find(item => item.id === id)
  assert.equal(listed.pendingPatch.patchHash, proposal.deltaHash)
  assert.equal(listed.requiresHuman, true)
  assert.equal(listed.mine, true)
  const subject = { kind: 'human', id: 'human:local' }
  assert.throws(() => markSpecDeltaRepair({ root, runId: run.id, requirementId: id, deltaHash: proposal.deltaHash, baseRequirementHash: 'bad', subject }), { code: 'stale-baseline' })
  markSpecDeltaRepair({ root, runId: run.id, requirementId: id, deltaHash: proposal.deltaHash, baseRequirementHash: proposal.delta.baseRequirementHash, subject })
  assert.equal(pendingSpecDeltas(root, id, run.id).length, 0)
  assert.equal(readFileSync(join(root, asset.extra.brief), 'utf8'), before)
  assert.equal(indexReport(root).assets.find(a => a.id === id).extra.revision, asset.extra.revision)
  assert.throws(() => confirmSpecDelta({ root, runId: run.id, requirementId: id, deltaHash: proposal.deltaHash, subject }), { code: 'delta-consumed' })
})

for (const resolution of ['confirm_converge', 'repair_only']) test(`feedback HTTP proposal and ${resolution} preserve the correct baseline`, async t => {
  const root = fixture(t), id = 'REQ-PAY-004'
  const asset = indexReport(root).assets.find(a => a.id === id)
  const run = createRun({ root, requirementId: id, carrier: 'mock' }).run
  updateRun({ root, runId: run.id, status: 'waiting-input', apply: true })
  const service = Object.create(RequirementsService.prototype)
  service.rootFor = () => root
  service.humanSubjectFor = () => ({ kind: 'human', id: 'human:local' })
  service.hasPendingDecision = () => false
  service.prepareAutomaticAuthorization = () => ({ authorized: true })
  let dispatched = null
  service.resumeDeliveryRun = async args => { dispatched = args; return { resumed: true } }
  service.resolveAiSelection = async () => ({ provider: 'fake', model: 'fake' })
  const afterBrief = '# 退款\n\n## 目标\n\n完成退款\n\n## 问题与场景\n\n退款处理复杂\n\n## 验收要求\n\n- AC-01 显示状态\n'
  service.aiStreamFor = () => async function* () { yield { type: 'text-delta', text: JSON.stringify({ afterBrief }) } }
  const server = createServer((req, res) => service.handleConvergence(req, res))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const post = async body => { const r = await fetch(`http://127.0.0.1:${server.address().port}/`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() } }
  const created = await post({ action: 'feedback', reqId: id, feedbackText: '改为显示新状态' })
  assert.equal(created.status, 200)
  const patch = created.body.pendingPatch
  assert.ok(patch.patchHash && patch.baseRequirementHash)
  const stale = await post({ action: 'resolve', reqId: id, patchId: patch.patchId, patchHash: patch.patchHash, baseRequirementHash: 'bad', resolution })
  assert.equal(stale.status, 409)
  const done = await post({ action: 'resolve', reqId: id, patchId: patch.patchId, patchHash: patch.patchHash, baseRequirementHash: patch.baseRequirementHash, resolution })
  assert.equal(done.status, 200)
  assert.equal(done.body.execution.resumed, true)
  assert.equal(dispatched.iteration, true)
  assert.equal(Number(indexReport(root).assets.find(a => a.id === id).extra.revision), Number(asset.extra.revision) + (resolution === 'confirm_converge' ? 1 : 0))
  assert.equal(pendingSpecDeltas(root, id, run.id).length, 0)
})

test('confirmation card starts unselected and submits the displayed bindings', async () => {
  const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')
  const start = source.indexOf('    function IterationFeedback(')
  const end = source.indexOf('    const HUMAN_TABS', start)
  assert.ok(start >= 0 && end > start)
  const states = []; let cursor = 0; const calls = []
  const context = vm.createContext({ HUMAN_CONTROL: {}, HUMAN_PRIMARY: {}, T: {}, encodeURIComponent, JSON,
    useState(initial) { const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], value => { states[i] = value }] },
    h(type, props, ...children) { return { type, props: props ?? {}, children: children.flat().filter(Boolean) } },
    async fetch(url, request) { calls.push(JSON.parse(request.body)); return { ok: true, json: async () => ({ ok: true, execution: { resumed: true } }) } },
  })
  vm.runInContext(`${source.slice(start, end)}\nthis.renderFeedback = IterationFeedback`, context)
  const patch = { patchId: 'RUN-001-spec-delta-1.json', patchHash: 'a'.repeat(64), baseRequirementHash: 'b'.repeat(64), beforeBrief: 'before AC', afterBrief: 'after AC', evolutionNote: 'change' }
  const props = { item: { id: 'REQ-1', run: { exists: true }, pendingPatch: patch }, root: 'x' }
  const render = () => { cursor = 0; return context.renderFeedback(props) }
  const flatten = node => [node, ...(node?.children ?? []).flatMap(child => typeof child === 'object' ? flatten(child) : [])]
  let nodes = flatten(render())
  assert.equal(nodes.filter(n => n.type === 'input' && n.props.type === 'radio').every(n => n.props.checked === false), true)
  assert.equal(nodes.find(n => n.type === 'button' && n.children.includes('确认执行')).props.disabled, true)
  nodes.find(n => n.type === 'input' && n.props.value === 'repair_only').props.onChange()
  nodes = flatten(render())
  await nodes.find(n => n.type === 'button' && n.children.includes('确认执行')).props.onClick()
  assert.equal(calls[0].resolution, 'repair_only')
  assert.equal(calls[0].patchHash, patch.patchHash)
  assert.equal(calls[0].baseRequirementHash, patch.baseRequirementHash)
})

for (const state of ['no-run', 'done']) test(`feedback convergence persists retry when ${state}`, async t => {
  const root = fixture(t), id = 'REQ-PAY-004'
  const asset = indexReport(root).assets.find(a => a.id === id)
  if (state === 'done') { const run = createRun({ root, requirementId: id, carrier: 'mock' }).run; updateRun({ root, runId: run.id, status: 'running', apply: true }); updateRun({ root, runId: run.id, status: 'done', apply: true }) }
  const service = Object.create(RequirementsService.prototype)
  service.rootFor = () => root
  service.humanSubjectFor = () => ({ kind: 'human', id: 'human:local' })
  service.resolveAiSelection = async () => ({ provider: 'fake', model: 'fake' })
  service.aiStreamFor = () => async function* () { yield { type: 'text-delta', text: JSON.stringify({ afterBrief: '# 退款\n\n## 目标\n\n完成退款\n\n## 问题与场景\n\n退款复杂\n\n## 验收要求\n\n- AC-01 显示新状态\n' }) } }
  const server = createServer((req, res) => service.handleConvergence(req, res))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const post = async body => { const r = await fetch(`http://127.0.0.1:${server.address().port}/`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() } }
  const result = await post({ action: 'feedback', reqId: id, feedbackText: '改为显示新状态' })
  assert.equal(result.status, 200, JSON.stringify(result.body))
  const p = result.body.pendingPatch
  const resolved = await post({ action: 'resolve', reqId: id, patchId: p.patchId, patchHash: p.patchHash, baseRequirementHash: p.baseRequirementHash, resolution: 'confirm_converge' })
  assert.equal(resolved.status, 200, JSON.stringify(resolved.body))
  assert.equal(resolved.body.execution.resumed, false)
  assert.equal(Number(indexReport(root).assets.find(a => a.id === id).extra.revision), Number(asset.extra.revision) + 1)
  assert.equal(readIterationRetry(root, id).feedbackText, '改为显示新状态')
  const retry = await post({ action: 'retry', reqId: id })
  assert.equal(retry.body.execution.resumed, false)
})

test('bug feedback resumes a waiting run and retains an undispatched request without one', async t => {
  const root = fixture(t), id = 'REQ-PAY-004'
  const service = Object.create(RequirementsService.prototype)
  service.rootFor = () => root
  service.humanSubjectFor = () => ({ kind: 'human', id: 'human:local' })
  service.hasPendingDecision = () => false
  let calls = 0
  service.resumeDeliveryRun = async () => { calls++; return { resumed: true } }
  const server = createServer((req, res) => service.handleConvergence(req, res))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const post = async () => { const r = await fetch(`http://127.0.0.1:${server.address().port}/`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'feedback', reqId: id, feedbackText: '按钮无法点击' }) }); return r.json() }
  assert.equal((await post()).execution.resumed, false)
  assert.equal(readIterationRetry(root, id).feedbackText, '按钮无法点击')
  const run = createRun({ root, requirementId: id, carrier: 'mock' }).run
  updateRun({ root, runId: run.id, status: 'waiting-input', apply: true })
  assert.equal((await post()).execution.resumed, true)
  assert.equal(calls, 1)
  assert.equal(readIterationRetry(root, id), null)
})

test('confirmed changes keep their original creation time and newest revision in the list', async t => {
  const root = fixture(t)
  writeFileSync(join(root, 'clock-evidence.mjs'), 'export const clockEvidence = true\n')
  const inv = 'INV-20260101000000-abcdef'
  writeInvestigation(root, { schema: INVESTIGATION_SCHEMA, investigationId: inv, source: 'observed_evidence', verdict: 'answered', findings: [{ claim: 'evidence', refs: [{ path: 'clock-evidence.mjs', line: 1, quote: 'export const clockEvidence', verified: true }] }] })
  const body = { action: 'crystallize', summary: '标题：创建时间\n目标：保留初始时间\n问题：时间会变\n验收标准：\n- 初始时间不变', investigationIds: [inv] }
  const preview = await handleIntentRequest({ root, body })
  const created = await handleIntentRequest({ root, body: { ...body, apply: true, draftHash: preview.draftHash } })
  const id = created.result.requirementId
  const initial = requirements(root).requirements.find(item => item.id === id)
  const runId = `SPEC-${id}`
  for (let n = 2; n <= 3; n++) {
    const afterBrief = `# ${id} 创建时间\n\n## 目标\n\n保留初始时间 ${n}\n\n## 问题与场景\n\n时间会变\n\n## 验收要求\n\n- AC-01 初始时间不变 ${n}\n`
    const patch = proposeSpecDelta({ root, runId, requirementId: id, afterBrief, evolutionNote: `调整 ${n}`, kind: 'spec_refinement' })
    confirmSpecDelta({ root, runId, requirementId: id, deltaHash: patch.deltaHash, subject: { kind: 'human', id: 'human:local' } })
  }
  const current = requirements(root).requirements.find(item => item.id === id)
  assert.equal(current.revision, 3)
  assert.equal(current.createdAt, initial.createdAt)
  const events = current.detailView.record.timeline.filter(event => ['created', 'spec_converged'].includes(event.kind))
  assert.equal(events[0].kind, 'created')
  assert.deepEqual(events.slice(1).map(event => event.specDelta.revision), [2, 3])
  const html = renderRequirementsPage({ ok: true, requirements: [current] })
  assert.match(html, /~ 修改 AC-01/)
  assert.doesNotMatch(html, /docHashChanged|featureIds/)
})
