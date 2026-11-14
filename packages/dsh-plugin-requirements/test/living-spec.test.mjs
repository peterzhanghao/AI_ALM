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
    AbortController, setTimeout, clearTimeout,
    useState(initial) { const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], value => { states[i] = value }] },
    h(type, props, ...children) { return { type, props: props ?? {}, children: children.flat().filter(Boolean) } },
    async fetch(url, request) {
      const body = JSON.parse(request.body); calls.push(body)
      return { ok: true, json: async () => body.action === 'resolve' ? { ok: true, applied: { result: { after: { revision: 3 } }, }, execution: { resumed: false } } : { ok: true, execution: { resumed: true } } }
    },
  })
  vm.runInContext(`${source.slice(start, end)}\nthis.renderFeedback = IterationFeedback`, context)
  const patch = { patchId: 'RUN-001-spec-delta-1.json', patchHash: 'a'.repeat(64), baseRequirementHash: 'b'.repeat(64), beforeBrief: 'before AC', afterBrief: 'after AC', evolutionNote: 'change' }
  const props = { item: { id: 'REQ-1', run: { exists: true }, pendingPatch: patch }, root: 'x' }
  const render = () => { cursor = 0; return context.renderFeedback(props) }
  const flatten = node => [node, ...(node?.children ?? []).flatMap(child => typeof child === 'object' ? flatten(child) : [])]
  let nodes = flatten(render())
  assert.equal(nodes.filter(n => n.type === 'input' && n.props.type === 'radio').every(n => n.props.checked === false), true)
  assert.equal(nodes.find(n => n.type === 'button' && n.children.includes('确认更新需求基线')).props.disabled, true)
  nodes.find(n => n.type === 'input' && n.props.value === 'repair_only').props.onChange()
  nodes = flatten(render())
  await nodes.find(n => n.type === 'button' && n.children.includes('确认更新需求基线')).props.onClick()
  assert.equal(calls[0].resolution, 'repair_only')
  assert.equal(calls[0].patchHash, patch.patchHash)
  assert.equal(calls[0].baseRequirementHash, patch.baseRequirementHash)
})

test('feedback click promotes a returned patch into the requirement confirmation card', async () => {
  const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')
  const start = source.indexOf('    function IterationFeedback(')
  const end = source.indexOf('    const HUMAN_TABS', start)
  const states = []; let cursor = 0; const submitted = []; const patchEvents = []
  const patch = { patchId: 'SPEC-REQ-006-spec-delta-2.json', patchHash: 'a'.repeat(64), baseRequirementHash: 'b'.repeat(64), beforeBrief: '旧 AC-02', afterBrief: '新 AC-02', evolutionNote: '~ 修改 AC-02：必须点击关闭按钮' }
  const context = vm.createContext({ HUMAN_CONTROL: {}, HUMAN_PRIMARY: {}, T: { ok: 'green', err: 'red', text2: 'gray' }, encodeURIComponent, JSON, AbortController, setTimeout, clearTimeout,
    useState(initial) { const index = cursor++; if (!(index in states)) states[index] = initial; return [states[index], value => { states[index] = value }] },
    h(type, props, ...children) { return { type, props: props ?? {}, children: children.flat().filter(Boolean) } },
    async fetch(url, request) { submitted.push(JSON.parse(request.body)); return { ok: true, json: async () => ({ ok: true, pendingPatch: patch }) } },
  })
  vm.runInContext(`${source.slice(start, end)}\nthis.renderFeedback = IterationFeedback`, context)
  const props = { item: { id: 'REQ-ALM-006', revision: 2, pendingPatch: null }, root: 'x', onPatch: value => patchEvents.push(value) }
  const render = () => { cursor = 0; return context.renderFeedback(props) }
  const flatten = node => [node, ...(node?.children ?? []).flatMap(child => typeof child === 'object' ? flatten(child) : [])]
  let nodes = flatten(render())
  nodes.find(node => node.type === 'textarea').props.onChange({ target: { value: '修改 AC-02' } })
  nodes = flatten(render())
  await nodes.find(node => node.type === 'button' && node.children.includes('提交反馈')).props.onClick()
  nodes = flatten(render())
  assert.equal(submitted[0].action, 'feedback')
  assert.equal(nodes.some(node => node.props?.['data-pending-patch'] === 'true'), true)
  assert.equal(nodes.some(node => node.children?.includes?.('需求收敛确认')), true)
  assert.equal(patchEvents[0].patchHash, patch.patchHash)
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

test('slow feedback drafting preserves the feedback and retries into a proposal without a run', async t => {
  const root = fixture(t), id = 'REQ-PAY-004'
  writeFileSync(join(root, 'requirements', 'briefs', 'REQ-PAY-004.md'), '# REQ-PAY-004 退款幂等\n\n## 目标\n\n完成退款。\n\n## 问题与场景\n\n退款复杂。\n\n## 验收要求\n\n- AC-01 显示退款状态\n')
  const service = Object.create(RequirementsService.prototype)
  service.rootFor = () => root
  service.humanSubjectFor = () => ({ kind: 'human', id: 'human:local' })
  service.resolveAiSelection = async () => ({ provider: 'fake', model: 'fake' })
  service.convergenceDraftTimeoutMs = 25
  let stall = true
  const afterBrief = '# 退款\n\n## 目标\n\n完成退款\n\n## 问题与场景\n\n退款复杂\n\n## 验收要求\n\n- AC-01 显示新状态\n'
  service.aiStreamFor = () => async function* ({ signal }) {
    if (stall) await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }))
    else yield { type: 'text-delta', text: JSON.stringify({ afterBrief }) }
  }
  const server = createServer((req, res) => service.handleConvergence(req, res))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const post = async body => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return { status: response.status, body: await response.json() }
  }
  const proposed = await post({ action: 'feedback', reqId: id, feedbackText: '补充退款状态说明' })
  assert.equal(proposed.status, 200, JSON.stringify(proposed.body))
  assert.equal(proposed.body.fallback, 'deterministic-spec-synthesis')
  assert.ok(proposed.body.pendingPatch?.patchHash)
  assert.equal(readIterationRetry(root, id), null)
})

test('a v2 requirement without a run immediately returns a confirmable v3 patch when AI drafting times out', async t => {
  const root = fixture(t), id = 'REQ-PAY-004'
  const v1 = '# REQ-PAY-004 导入导出\n\n## 目标\n\n支持 JSON 与 Excel 导出。\n\n## 问题与场景\n\n导出格式与关闭方式不够清晰。\n\n## 验收要求\n\n- AC-01 支持导出 JSON 与 Excel。\n- AC-02 弹窗支持 Esc 关闭。\n'
  const v2 = '# REQ-PAY-004 导入导出\n\n## 目标\n\n支持安全的文件导出。\n\n## 问题与场景\n\n用户需要更明确的操作提示。\n\n## 验收要求\n\n- AC-01 支持导出 JSON 与 Excel。\n- AC-02 弹窗支持 Esc 关闭。\n'
  const sdoc = join(root, 'requirements', 'refund-idempotent.sdoc')
  writeFileSync(sdoc, readFileSync(sdoc, 'utf8').replace('REVISION: 2', 'REVISION: 1'))
  writeFileSync(join(root, 'requirements', 'briefs', 'REQ-PAY-004.md'), v1)
  const initial = proposeSpecDelta({ root, runId: `SPEC-${id}`, requirementId: id, afterBrief: v2, evolutionNote: '补全导出说明', kind: 'spec_refinement' })
  confirmSpecDelta({ root, runId: `SPEC-${id}`, requirementId: id, deltaHash: initial.deltaHash, subject: { kind: 'human', id: 'human:local' } })
  const service = Object.create(RequirementsService.prototype)
  service.rootFor = () => root
  service.humanSubjectFor = () => ({ kind: 'human', id: 'human:local' })
  service.resolveAiSelection = async () => ({ provider: 'fake', model: 'fake' })
  service.convergenceDraftTimeoutMs = 25
  service.aiStreamFor = () => async function* ({ signal }) { await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })) }
  const server = createServer((req, res) => service.handleConvergence(req, res))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const post = async body => { const response = await fetch(`http://127.0.0.1:${server.address().port}/`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() } }
  const feedback = '1. 不再支持导出 JSON 交换包，卡片一只需要保留导出 Excel；2. 修改 AC-02，必须点击关闭按钮才能关闭弹窗。'
  const proposed = await post({ action: 'feedback', reqId: id, feedbackText: feedback })
  assert.equal(proposed.status, 200, JSON.stringify(proposed.body))
  assert.ok(proposed.body.pendingPatch?.patchHash)
  const draft = proposed.body.pendingPatch
  assert.match(draft.afterBrief, /聚焦为 Excel（\.xlsx）流程/)
  assert.match(draft.afterBrief, /减少格式选择负担/)
  const exportAc = draft.acceptanceCriteria.after.find(entry => entry.id === 'AC-01')
  const closeAc = draft.acceptanceCriteria.after.find(entry => entry.id === 'AC-02')
  assert.match(exportAc.text, /只提供 Excel/)
  assert.match(closeAc.text, /按 Esc 不会关闭/)
  assert.doesNotMatch(closeAc.text, /修改\s*AC-02/)
  assert.ok(draft.diff.modified.some(change => change.kind === 'goal'))
  assert.ok(draft.diff.modified.some(change => change.kind === 'problem'))
  assert.ok(proposed.body.pendingPatch.diff.modified.some(change => change.kind === 'acceptance' && change.id === 'AC-02'))
  const resolved = await post({ action: 'resolve', reqId: id, patchId: proposed.body.pendingPatch.patchId, patchHash: proposed.body.pendingPatch.patchHash, baseRequirementHash: proposed.body.pendingPatch.baseRequirementHash, resolution: 'confirm_converge' })
  assert.equal(resolved.status, 200, JSON.stringify(resolved.body))
  assert.equal(requirements(root).requirements.find(entry => entry.id === id).revision, 3)
})

test('early TEST-only requirement turns four numbered feedback points into a confirmable v2 proposal without a run', async t => {
  const root = fixture(t), id = 'REQ-PAY-004'
  writeFileSync(join(root, 'requirements', 'refund-idempotent.sdoc'), `[DOCUMENT]\nTITLE: 导入导出\n\n[SECTION]\nTITLE: 交换\n\n[REQUIREMENT]\nUID: ${id}\nTITLE: 需求导入导出\nSTATUS: proposed\nOWNER: team-payments\nPROJECT: PAY\nPRIORITY: P2\nCATEGORY: functional\nREVISION: 1\nBRIEF: requirements/briefs/${id}.md\nSOURCE: chat\n\n[RELATION]\nType: verified_by\nValue: TEST-ALM-REQ006-EXCHANGE\n\n[RELATION]\nType: verified_by\nValue: TEST-ALM-REQ006-SECURITY\n\n[RELATION]\nType: verified_by\nValue: TEST-ALM-REQ006-DESKTOP\n`)
  writeFileSync(join(root, 'requirements', 'briefs', `${id}.md`), `# ${id} 需求导入导出\n\n## 目标\n\n安全完成需求文件交换。\n\n## 问题与场景\n\n旧版交换界面对非技术用户不友好。\n`)
  const service = Object.create(RequirementsService.prototype)
  service.rootFor = () => root
  service.humanSubjectFor = () => ({ kind: 'human', id: 'human:local' })
  service.aiStreamFor = () => { throw new Error('early requirement must not wait for an AI draft') }
  const server = createServer((req, res) => service.handleConvergence(req, res))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const post = async body => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return { status: response.status, body: await response.json() }
  }
  const feedbackText = ['1. 首次导出自动初始化项目密钥，不显示初始化按钮。', '2. 导入导出弹窗使用不透明遮罩并支持 Esc 关闭。', '3. Excel 使用中文表头，并清楚区分可编辑和只读列。', '4. 导入后展示新增、更新和冲突的差异预览 $\\rightarrow$ 允许确认落盘。'].join('\n')
  const created = await post({ action: 'feedback', reqId: id, feedbackText })
  assert.equal(created.status, 200, JSON.stringify(created.body))
  assert.ok(created.body.pendingPatch?.patchHash)
  assert.equal(created.body.pendingPatch.acceptanceCriteria.after.length, 4)
  const resolved = await post({ action: 'resolve', reqId: id, patchId: created.body.pendingPatch.patchId, patchHash: created.body.pendingPatch.patchHash, baseRequirementHash: created.body.pendingPatch.baseRequirementHash, resolution: 'confirm_converge' })
  assert.equal(resolved.status, 200, JSON.stringify(resolved.body))
  const current = requirements(root).requirements.find(entry => entry.id === id)
  assert.equal(current.revision, 2)
  assert.deepEqual(current.detailView.content.doc.acceptance.map(entry => entry.id), ['AC-01', 'AC-02', 'AC-03', 'AC-04'])
  assert.deepEqual(current.detailView.content.acceptanceCriteria.map(entry => entry.id), ['TEST-ALM-REQ006-EXCHANGE', 'TEST-ALM-REQ006-SECURITY', 'TEST-ALM-REQ006-DESKTOP', 'AC-01', 'AC-02', 'AC-03', 'AC-04'])
  const updated = readFileSync(join(root, 'requirements', 'briefs', `${id}.md`), 'utf8')
  for (const point of feedbackText.split('\n').map(entry => entry.replace(/^\d+[.、)]\s*/, '').replace(/\$\\rightarrow\$/g, '→'))) assert.match(updated, new RegExp(point.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.doesNotMatch(updated.replace(/<!--\s*alm:meta\b[\s\S]*?-->/g, ''), /\$\\rightarrow\$|->/)
})

test('unified resynthesis updates goal and problem while modifying and removing targeted ACs', t => {
  const root = fixture(t), id = 'REQ-PAY-004'
  writeFileSync(join(root, 'requirements', 'briefs', `${id}.md`), `# ${id} 导出设置\n\n## 目标\n\n支持 JSON 与 Excel 导出。\n\n## 问题与场景\n\n用户无法选择合适的导出格式或关闭弹窗。\n\n## 验收要求\n\n- AC-01 支持导出 JSON。\n- AC-02 弹窗支持 Esc 关闭。\n- AC-03 保留旧版 XML 导出。\n`)
  const afterBrief = `# ${id} 导出设置\n\n## 目标\n\n只保留 Excel 导出，并让关闭操作明确可见。\n\n## 问题与场景\n\nJSON 与 XML 选项增加选择负担，Esc 容易误关闭编辑内容。\n\n## 验收要求\n\n- AC-01 仅支持导出 Excel。\n- AC-02 必须点击关闭按钮关闭弹窗。\n`
  const proposal = proposeSpecDelta({
    root,
    runId: `SPEC-${id}`,
    requirementId: id,
    afterBrief,
    evolutionNote: '不再支持导出 JSON，只保留导出 Excel；把 AC-02 的支持 Esc 关闭改为必须点击关闭按钮；移除 AC-03。',
    kind: 'spec_refinement',
  })
  const after = proposal.delta.acceptanceCriteria.after
  assert.deepEqual(after.map(entry => entry.id), ['AC-01', 'AC-02'])
  assert.match(after.find(entry => entry.id === 'AC-01').text, /Excel/)
  assert.match(after.find(entry => entry.id === 'AC-02').text, /点击.*关闭按钮/)
  assert.match(proposal.delta.afterBrief, /只保留 Excel 导出/)
  assert.match(proposal.delta.afterBrief, /JSON 与 XML 选项增加选择负担/)
  assert.ok(proposal.delta.diff.modified.some(change => change.kind === 'acceptance' && change.id === 'AC-02'))
  assert.ok(proposal.delta.diff.removed.some(change => change.kind === 'acceptance' && change.id === 'AC-03'))
  assert.ok(proposal.delta.diff.modified.some(change => change.kind === 'goal'))
  assert.ok(proposal.delta.diff.modified.some(change => change.kind === 'problem'))
})

test('feedback and detail refresh controls expose progress and completion feedback', () => {
  const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')
  assert.match(source, /提交处理中\.\.\./)
  assert.match(source, /等待 AI 生成草案超时/)
  assert.match(source, /反馈草案暂未生成/)
  assert.match(source, /onPatch\?\.\(result\.pendingPatch\)/)
  assert.match(source, /displayItem\.pendingPatch && \(tab === 'requirement'/)
  assert.match(source, /querySelector\?\.\('\[data-pending-patch\]'\)/)
  assert.match(source, /✅ 需求基线已更新至 v\$\{revision\}/)
  assert.match(source, /data-iteration-feedback-status/)
  assert.match(source, /data-detail-refresh-status/)
  assert.match(source, /data-convergence-coverage/)
  assert.match(source, /'已更新'/)
  assert.match(source, /\['problem', '价值'\]/)
  assert.match(source, /状态已刷新；当前没有新的变化。/)
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
