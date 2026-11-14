import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import RequirementsService from '../index.js'
import * as runs from '../../alm-core/src/requirements/run.mjs'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'alm-decision-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'requirements'), { recursive: true })
  writeFileSync(join(root, 'requirements', 'req.sdoc'), '[DOCUMENT]\nTITLE: 测试\n\n[REQUIREMENT]\nUID: REQ-1\nTITLE: 测试\nOWNER: team\nREVISION: 1\nBRIEF: requirements/brief.md\n')
  writeFileSync(join(root, 'requirements', 'brief.md'), '# 测试\n\n## 目标\n\n完成测试\n\n## 验收要求\n\n- AC-01 验证成功\n')
  const instance = Object.create(RequirementsService.prototype)
  Object.assign(instance, { activeRuns: new Map(), runHeartbeats: new Map(), startingRuns: new Map(), closeDefectIteration() {}, drainInPlaceRepair() {}, monitorFailure() { return {} } })
  const run = runs.createRun({ root, requirementId: 'REQ-1', carrier: 'mock' }).run
  const path = `.alm/runs/${run.id}-decision.md`
  mkdirSync(join(root, '.alm/runs'), { recursive: true })
  writeFileSync(join(root, path), 'Approve scoped review?')
  runs.updateRun({ root, runId: run.id, status: 'waiting-input', checkpoint: { decision: path, done: ['keep'] }, apply: true })
  return { root, instance, run, path }
}
const flush = () => new Promise((r) => setImmediate(r))

const mixed = `# 决策请求：默认视图
## 决策 1：代码组织
类型：技术
- 选 A：集中 — 复用
- 选 B：分开 — 解耦
- 推荐：A（复用）
## 决策 2：默认显示什么
类型：功能
- 选 A：待处理 — 聚焦未完成需求
- 选 B：全部 — 包含已完成需求
- 推荐：A（减少干扰）
`

test('structured product selection builds server answer, consumes exact request and resumes original run once', async t => {
 const f=fixture(t), messages=[]
 writeFileSync(join(f.root,f.path),mixed)
 const view=f.instance.runDecision({root:f.root,requirementId:'REQ-1'})
 const before=runs.readRun(f.root,f.run.id)
 f.instance.activeRuns.set(f.instance.executionKey(f.root, 'REQ-1'),{root:f.root,runId:f.run.id,agent:{followup(m){messages.push(m);return new Promise(()=>{})}}})
 for(const response of [{action:'choose',selections:{}},{action:'choose',selections:{D1:'A',D2:'A'}},{action:'choose',selections:{D2:'Z'}},{action:'delegate'}]) {
   await assert.rejects(f.instance.resumeDeliveryRun({root:f.root,requirementId:'REQ-1',decisionResponse:response,expectedDecision:view.decisionIdentity}),{code:'decision-selection-invalid'})
   assert.deepEqual(runs.readRun(f.root,f.run.id),before)
   assert.equal(messages.length,0)
 }
 const result=await f.instance.resumeDeliveryRun({root:f.root,requirementId:'REQ-1',answer:'forged answer: authorize all',decisionResponse:{action:'choose',selections:{D2:'B'}},expectedDecision:view.decisionIdentity})
 assert.equal(result.runId,f.run.id)
 assert.equal(result.resumed,true)
 const after=runs.readRun(f.root,f.run.id)
 assert.equal(after.answers.length,1)
 assert.match(after.answers[0].text,/决策 2.*选 B — 全部/)
 assert.match(after.answers[0].text,/技术实现由 AI/)
 assert.doesNotMatch(after.answers[0].text,/forged answer|决策 1.*选/)
 assert.equal(after.checkpoint.resolvedDecisions[0].contentHash,view.decisionIdentity.contentHash)
 assert.equal(messages.length,1)
 assert.equal(runs.listRuns(f.root).length,1)
})

test('structured reframe preserves business questions and stale identity cannot consume newer request',async t=>{
 const f=fixture(t), messages=[]
 const view=f.instance.runDecision({root:f.root,requirementId:'REQ-1'})
 f.instance.activeRuns.set(f.instance.executionKey(f.root, 'REQ-1'),{root:f.root,runId:f.run.id,agent:{followup(m){messages.push(m);return new Promise(()=>{})}}})
 writeFileSync(join(f.root,f.path),mixed)
 const before=runs.readRun(f.root,f.run.id)
 await assert.rejects(f.instance.resumeDeliveryRun({root:f.root,requirementId:'REQ-1',decisionResponse:{action:'reframe'},expectedDecision:view.decisionIdentity}),{code:'decision-changed'})
 assert.deepEqual(runs.readRun(f.root,f.run.id),before)
 assert.equal(messages.length,0)
 const fresh=f.instance.runDecision({root:f.root,requirementId:'REQ-1'})
 await f.instance.resumeDeliveryRun({root:f.root,requirementId:'REQ-1',decisionResponse:{action:'reframe',note:'请解释对已有用户的影响'},expectedDecision:fresh.decisionIdentity})
 const after=runs.readRun(f.root,f.run.id)
 assert.match(after.answers.at(-1).text,/尚未选择任何业务或功能方案/)
 assert.equal(after.checkpoint.decisionReframe.contentHash,fresh.decisionIdentity.contentHash)
 assert.throws(()=>f.instance.createDeliveryCandidate(f.root,'REQ-1'),{code:'decision-options-requested'})
 assert.match(after.answers.at(-1).text,/请解释对已有用户的影响/)
 assert.doesNotMatch(after.answers.at(-1).text,/选 A|选 B/)
})

test('fixed conventional decision is displayed and blocks continue without checkpoint registration', async (t) => {
 const f = fixture(t)
 runs.updateRun({root:f.root,runId:f.run.id,checkpoint:{decision:null},apply:true})
 const before = runs.readRun(f.root,f.run.id)
 assert.equal(f.instance.hasPendingDecision(f.root,before),true)
 assert.equal(f.instance.runDecision({root:f.root,requirementId:'REQ-1'}).decision,f.path)
 assert.equal((await f.instance.resumeDeliveryRun({root:f.root,requirementId:'REQ-1',continuing:true})).reason,'human-decision-required')
 assert.deepEqual(runs.readRun(f.root,f.run.id),before)
 const identity = f.instance.decisionIdentity(f.root,f.path)
 const resolved = {...before,checkpoint:{decision:null,resolvedDecisions:[{path:f.path,contentHash:identity.sha256}]}}
 assert.equal(f.instance.hasPendingDecision(f.root,resolved),false)
 writeFileSync(join(f.root,f.path),'New question')
 assert.equal(f.instance.hasPendingDecision(f.root,resolved),true)
})
test('restart answer resumes the original round in a fresh carrier without granting automatic authority', async t => {
 const f = fixture(t)
 runs.updateRun({root:f.root,runId:f.run.id,status:'failed',failure:{code:'host-restart'},checkpoint:{decision:null,done:['keep']},apply:true})
 const before = runs.readRun(f.root,f.run.id)
 const decision = f.instance.runDecision({root:f.root,requirementId:'REQ-1'})
 assert.equal(decision.runId,f.run.id)
 assert.equal((await f.instance.resumeDeliveryRun({root:f.root,requirementId:'REQ-1',continuing:true})).reason,'human-decision-required')
 f.instance.ctx={get:name=>name==='agentPresets'?{resolve:async()=>({id:'mock'}),mount:async()=>{}}:null}
 f.instance.startRunHeartbeat=()=>{}
 let message
 f.instance.executionCarrier=()=>({async create(){return {agent:{followup(m){message=m;return new Promise(()=>{})}},dispose(){}}}})
 const result=await f.instance.resumeDeliveryRun({root:f.root,requirementId:'REQ-1',answer:'Explicit scoped answer',expectedDecision:decision.decisionIdentity})
 assert.equal(result.resumed,true)
 assert.equal(result.runId,f.run.id)
 assert.equal(result.continueMode,'resumed-session')
 const after=runs.readRun(f.root,f.run.id)
 assert.equal(runs.listRuns(f.root).length,1)
 assert.equal(after.answers.length,before.answers.length+1)
 assert.equal(after.answers.at(-1).text,'Explicit scoped answer')
 assert.deepEqual(after.checkpoint.done,['keep'])
 assert.equal(after.checkpoint.resolvedDecisions[0].contentHash,decision.decisionIdentity.contentHash)
 assert.notEqual(after.checkpoint.autoAdvance?.authorized,true)
 assert.equal(after.failure.code,'host-restart','historical interruption is retained')
 assert.match(message.content[0].text,/Explicit scoped answer/)
})

for (const replacement of ['active', 'terminal']) {
 test(`fresh restart resume rejects a newer ${replacement} selector even when original bytes are unchanged`, async t => {
  const f=fixture(t)
  runs.updateRun({root:f.root,runId:f.run.id,status:'failed',failure:{code:'host-restart'},apply:true})
  const before=runs.readRun(f.root,f.run.id)
  let disposed=0
  f.instance.ctx={get:name=>name==='agentPresets'?{resolve:async()=>({id:'mock'}),mount:async()=>{}}:null}
  f.instance.executionCarrier=()=>({async create(){
   const newer=runs.createRun({root:f.root,requirementId:'REQ-1',carrier:'mock'}).run
   if(replacement==='terminal') runs.updateRun({root:f.root,runId:newer.id,status:'failed',failure:{code:'ordinary-failure'},apply:true})
   return {dispose(){disposed++},agent:{followup(){assert.fail('stale selector must not dispatch')}}}
  }})
  await assert.rejects(f.instance.resumeDeliveryRun({root:f.root,requirementId:'REQ-1',answer:'Yes'}),{code:'decision-changed'})
  assert.deepEqual(runs.readRun(f.root,f.run.id),before)
  assert.equal(disposed,1)
  assert.equal(runs.listRuns(f.root).length,2)
 })
}

test('unsafe, unreadable and linked decision paths fail closed', (t) => {
 const f = fixture(t)
 const run = path => ({id:f.run.id,checkpoint:{decision:path}})
 for(const path of ['../outside.md','.alm/runs/missing.md']) assert.equal(f.instance.hasPendingDecision(f.root,run(path)),true)
 rmSync(join(f.root,f.path)); mkdirSync(join(f.root,f.path))
 assert.equal(f.instance.hasPendingDecision(f.root,run(null)),true)
 rmSync(join(f.root,f.path),{recursive:true})
 const outside = join(f.root,'outside'); mkdirSync(outside)
 rmSync(join(f.root,'.alm/runs'),{recursive:true})
 symlinkSync(outside,join(f.root,'.alm/runs'),'junction')
 assert.equal(f.instance.hasPendingDecision(f.root,run(null)),true)
 assert.equal(f.instance.runDecision({root:f.root,requirementId:'REQ-1'}).text,null)
})

test('answer consumes exact decision, preserves checkpoint/history and idle becomes handback', async (t) => {
  const f = fixture(t)
  const messages = []
  f.instance.activeRuns.set(f.instance.executionKey(f.root, 'REQ-1'), { root: f.root, runId: f.run.id, agent: { followup(m) { messages.push(m); return Promise.resolve() } } })
  const result = await f.instance.resumeDeliveryRun({ root: f.root, requirementId: 'REQ-1', answer: 'Allow scoped review' })
  assert.equal(result.resumed, true)
  await flush()
  const run = runs.readRun(f.root, f.run.id)
  assert.equal(run.checkpoint.decision, null)
  assert.deepEqual(run.checkpoint.done, ['keep'])
  assert.equal(run.checkpoint.resolvedDecisions.length, 1)
  assert.equal(run.answers[0].text, 'Allow scoped review')
  assert.equal(run.phase, 'review-result')
  assert.match(messages[0].content[0].text, /已批准决策/)
  assert.match(messages[0].content[0].text, /Allow scoped review/)
  assert.equal(runs.runView({ root: f.root, requirementId: 'REQ-1' }).awaitingAnswer, false)
  const continued = await f.instance.resumeDeliveryRun({ root: f.root, requirementId: 'REQ-1', continuing: true })
  assert.equal(continued.resumed, true)
  await flush()
  assert.equal(runs.readRun(f.root, f.run.id).answers.length, 1)
})

test('fallback answer requires identity and fresh-session CAS detects content replacement', async (t) => {
 const f = fixture(t)
 runs.updateRun({root:f.root,runId:f.run.id,checkpoint:{decision:null},apply:true})
 await assert.rejects(f.instance.resumeDeliveryRun({root:f.root,requirementId:'REQ-1',answer:'Yes'}),{code:'decision-identity-required'})
 const expectedDecision = {path:f.path,contentHash:f.instance.decisionIdentity(f.root,f.path).sha256}
 await assert.rejects(f.instance.resumeDeliveryRun({root:f.root,requirementId:'REQ-1',answer:'Yes',expectedDecision:{...expectedDecision,contentHash:'old'}}),{code:'decision-changed'})
 f.instance.ctx={get:()=>({resolve:async()=>({id:'mock'}),mount:async()=>{}})}
 f.instance.executionCarrier=()=>({async create(){writeFileSync(join(f.root,f.path),'Replacement');return {dispose(){},agent:{followup(){assert.fail('must not dispatch')}}}}})
 await assert.rejects(f.instance.resumeDeliveryRun({root:f.root,requirementId:'REQ-1',answer:'Yes',expectedDecision}),{code:'decision-changed'})
 assert.equal(runs.readRun(f.root,f.run.id).answers.length,0)
})

test('automatic resume changes only status under exact authorization and original budgets', t => {
 const f=fixture(t)
 const auto={authorized:true,authorization:{source:'start-v4',requirementHash:'req',configHash:'cfg',revision:2},status:'stopped',reason:'registered-acceptance-failed',dispatches:1,maxDispatches:3,verification:{attempts:1,records:[{status:'failed',key:'old'}]},inPlaceRepair:{attempts:1}}
 const run={requirement:'REQ-1',checkpoint:{autoAdvance:auto}}
 f.instance.automaticFacts=()=>({requirementHash:'req',configHash:'cfg',revision:2,snapshot:{complete:true,headSha:'head'}})
 const result=f.instance.resumeAutomaticCheckpoint(f.root,run,'human:local')
 assert.equal(result.receipt.autoAdvanceResumed,true)
 assert.deepEqual(result.checkpoint.autoAdvance,{...auto,status:'authorized',reason:null})
 for(const patch of [{authorized:false},{dispatches:6},{verification:{attempts:4}}]) assert.equal(f.instance.resumeAutomaticCheckpoint(f.root,{...run,checkpoint:{autoAdvance:{...auto,...patch}}},'human:local').receipt.autoAdvanceResumed,false)
 const rebound=f.instance.resumeAutomaticCheckpoint(f.root,{...run,checkpoint:{autoAdvance:{...auto,authorization:{...auto.authorization,configHash:'changed'}}}},'human:local')
 assert.equal(rebound.receipt.autoAdvanceResumed,true)
 assert.equal(rebound.checkpoint.autoAdvance.authorization.configHash,'cfg')
 assert.equal(rebound.checkpoint.autoAdvance.authorization.rebound.from,'changed')
 f.instance.automaticFacts=()=>({requirementHash:'req',configHash:'cfg',revision:2,snapshot:{complete:false,headSha:'head'}})
 assert.equal(f.instance.resumeAutomaticCheckpoint(f.root,run,'human:local').receipt.autoAdvanceResumed,false)
})

test('resolved hash does not reopen on touch; explicitly changed content does', (t) => {
  const f = fixture(t)
  const identity = f.instance.decisionIdentity(f.root, f.path)
  const run = { checkpoint: { decision: f.path, resolvedDecisions: [{ path: f.path, contentHash: identity.sha256 }] } }
  utimesSync(join(f.root, f.path), new Date(), new Date(Date.now() + 5000))
  assert.equal(f.instance.hasPendingDecision(f.root, run), false)
  writeFileSync(join(f.root, f.path), 'A genuinely new scope decision')
  assert.equal(f.instance.hasPendingDecision(f.root, run), true)
  assert.equal(f.instance.hasPendingDecision(f.root, { checkpoint: { decision: '.alm/runs/missing.md' } }), true)
})

test('continue cannot bypass pending or unreadable decision', async (t) => {
  const f = fixture(t)
  const result = await f.instance.resumeDeliveryRun({ root: f.root, requirementId: 'REQ-1', continuing: true })
  assert.equal(result.reason, 'human-decision-required')
  assert.equal(runs.readRun(f.root, f.run.id).answers.length, 0)
})

test('stale decision identity rejects before answer or carrier mutation', async (t) => {
  const f = fixture(t)
  await assert.rejects(f.instance.resumeDeliveryRun({ root: f.root, requirementId: 'REQ-1', answer: 'Yes', expectedDecision: { path: f.path, contentHash: 'old' } }), { code: 'decision-changed', status: 409 })
  assert.equal(runs.readRun(f.root, f.run.id).answers.length, 0)
})

test('wrong root or run carrier is never followed', async (t) => {
  for (const mismatch of ['root', 'run']) {
    const f = fixture(t)
    f.instance.activeRuns.set(f.instance.executionKey(f.root, 'REQ-1'), { root: mismatch === 'root' ? join(f.root, 'other') : f.root, runId: mismatch === 'run' ? 'RUN-other' : f.run.id, agent: { followup() { assert.fail('must not follow wrong carrier') } } })
    f.instance.executionCarrier = () => null
    f.instance.monitorHint = () => ({})
    const result = await f.instance.resumeDeliveryRun({ root: f.root, requirementId: 'REQ-1', answer: 'Yes' })
    assert.equal(result.reason, 'carrier-unavailable')
    assert.equal(runs.readRun(f.root, f.run.id).answers.length, 0)
  }
})

test('new decision written at same explicit path survives idle', async (t) => {
  const f = fixture(t)
  f.instance.activeRuns.set(f.instance.executionKey(f.root, 'REQ-1'), { root: f.root, runId: f.run.id, agent: { followup() {
    writeFileSync(join(f.root, f.path), 'New irreversible scope choice')
    const run = runs.readRun(f.root, f.run.id)
    runs.updateRun({ root: f.root, runId: f.run.id, checkpoint: { ...run.checkpoint, decision: f.path }, apply: true })
    return Promise.resolve()
  } } })
  await f.instance.resumeDeliveryRun({ root: f.root, requirementId: 'REQ-1', answer: 'Approve first question' })
  await flush()
  assert.equal(runs.readRun(f.root, f.run.id).checkpoint.decision, f.path)
  assert.equal(runs.runView({ root: f.root, requirementId: 'REQ-1' }).awaitingAnswer, true)
})

for (const change of ['decision', 'cancel']) {
  test(`fresh resume rejects ${change} during session creation without overwriting it`, async (t) => {
    const f = fixture(t)
    let disposeCount = 0
    f.instance.ctx = { get(name) { return name === 'agentPresets' ? { resolve: async () => ({ id: 'mock' }), mount: async () => {} } : null } }
    f.instance.executionCarrier = () => ({ async create() {
      assert.equal(f.instance.busyDelivery(f.root, ['REQ-1']).status, 'starting')
      const start = await f.instance.startDeliveryRun({ root: f.root, requirementId: 'REQ-1' })
      assert.equal(start.reason, 'run-starting')
      if (change === 'decision') writeFileSync(join(f.root, f.path), 'New question while starting')
      else runs.updateRun({ root: f.root, runId: f.run.id, status: 'cancelled', apply: true })
      return { agent: { followup() { assert.fail('stale resume must not run') } }, dispose() { disposeCount++ } }
    } })
    await assert.rejects(f.instance.resumeDeliveryRun({ root: f.root, requirementId: 'REQ-1', answer: 'Yes' }), { code: 'decision-changed' })
    const run = runs.readRun(f.root, f.run.id)
    assert.equal(run.answers.length, 0)
    assert.equal(run.checkpoint.decision, f.path)
    assert.equal(run.status, change === 'cancel' ? 'cancelled' : 'waiting-input')
    assert.equal(disposeCount, 1)
    assert.equal(f.instance.resumingRuns.size, 0)
  })
}

test('paused run cannot use continue or answer to bypass its gate', async (t) => {
  const f = fixture(t)
  runs.updateRun({ root: f.root, runId: f.run.id, status: 'paused', apply: true })
  for (const continuing of [true, false]) {
    assert.equal((await f.instance.resumeDeliveryRun({ root: f.root, requirementId: 'REQ-1', answer: 'Yes', continuing })).reason, 'run-not-resumable')
  }
  assert.equal(runs.readRun(f.root, f.run.id).status, 'paused')
})

test('concurrent answers dispatch only once and do not duplicate history', async (t) => {
  const f = fixture(t)
  let finish
  let count = 0
  f.instance.activeRuns.set(f.instance.executionKey(f.root, 'REQ-1'), { root: f.root, runId: f.run.id, agent: { followup() { count++; return new Promise((r) => { finish = r }) } } })
  const results = await Promise.all([1, 2].map(() => f.instance.resumeDeliveryRun({ root: f.root, requirementId: 'REQ-1', answer: 'Yes' })))
  assert.equal(results.filter((r) => r.resumed).length, 1)
  assert.equal(count, 1)
  assert.equal(runs.readRun(f.root, f.run.id).answers.length, 1)
  finish()
  await flush()
})
