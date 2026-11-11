import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { requirementContentHash } from '../../alm-core/src/model/content-hash.mjs'
import * as runs from '../../alm-core/src/requirements/run.mjs'
import RequirementsService from '../index.js'
import { rejectionReview, assertRejectionReview } from '../reject-candidate.mjs'
const hash = value => createHash('sha256').update(value).digest('hex')
const h = 'a'.repeat(64), configHash = hash(JSON.stringify([]))
function fixture(t, native = false) {
  const root = mkdtempSync(join(tmpdir(), 'alm-reject-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const asset = { id: 'REQ-TEST-001', type: 'requirement', title: 'Original', extra: { revision: 1 }, links: [], source: { path: 'requirements/a.sdoc' } }
  mkdirSync(join(root, 'requirements')); writeFileSync(join(root, asset.source.path), 'Original requirement')
  const requirementHash = requirementContentHash({ root, asset })
  const run = runs.createRun({ root, requirementId: asset.id, carrier: 'mock' }).run
  const id = 'CAND-REQ-TEST-001-003', dir = `.alm/candidates/${asset.id}`
  mkdirSync(join(root, dir), { recursive: true }); mkdirSync(join(root, `.alm/acceptance/${asset.id}`), { recursive: true })
  const evidenceFile = `.alm/acceptance/${asset.id}/head.json`
  const evidence = { schema: 'alm.acceptance/v3', result: 'pass', requirement: asset.id, requirementHash, configHash, testRevision: h, headSha: 'old-head', worktree: { stable: true, after: { treeHash: h } } }
  const bytes = JSON.stringify(evidence); writeFileSync(join(root, evidenceFile), bytes)
  const candidate = { schema: 'alm.candidate/v2', id, requirementId: asset.id, revision: 1, createdAt: '2026-11-05T01:36:03.147Z', source: native ? 'native-deployment' : 'automatic', complete: true, requirementHash, headSha: 'old-head', treeHash: h, acceptance: { file: evidenceFile, hash: hash(bytes), result: 'pass', configHash, testRevision: h, worktreeHash: h } }
  const candidatePath = `${dir}/${id}.json`; writeFileSync(join(root, candidatePath), JSON.stringify(candidate))
  const auto = { authorized: true, authorization: { source: 'start-v4', actor: 'human:owner', requirementHash, revision: 1, configHash }, status: 'candidate-ready', candidateId: native ? 'CAND-REQ-TEST-001-001' : id, dispatches: 1, maxDispatches: 3, verification: { attempts: 1, records: [{ result: 'pass' }] }, repair: { attempts: 1 } }
  runs.updateRun({ root, runId: run.id, status: 'waiting-input', phase: 'review-result', checkpoint: { autoAdvance: auto, done: ['preserve'], resolvedDecisions: [] }, apply: true })
  const snapshot = { complete: true, headSha: 'fresh-head', treeHash: 'b'.repeat(64), files: [{ path: 'source.js', hash: h, status: 'M', omitted: false }] }
  const options = () => ({ root, run: runs.readRun(root, run.id), asset, snapshot, plan: { commands: [] } })
  const service = Object.create(RequirementsService.prototype)
  Object.assign(service, { activeRuns: new Map(), startingRuns: new Map(), runHeartbeats: new Map(), monitorFailure() { return {} }, startRunHeartbeat() {}, closeDefectIteration() {}, drainInPlaceRepair() {} })
  service.currentRequirementAnchor = () => runs.requirementAnchor({ brief: readFileSync(join(root, asset.source.path), 'utf8'), revision: asset.extra.revision })
  service.rejectionReview = () => rejectionReview(options())
  const jobPath = '.alm/native-delivery/03a81674-bcce-40f3-9eb0-113249860f61.json'
  if (native) { mkdirSync(join(root, '.alm/native-delivery')); writeFileSync(join(root, jobPath), JSON.stringify({ schema: 'alm.native-delivery/v1', jobId: '03a81674-bcce-40f3-9eb0-113249860f61', root, status: 'passed', phase: 'gui-verified', requirementId: asset.id, runId: run.id, initial: { runId: run.id, candidateId: 'CAND-REQ-TEST-001-002', treeHash: h, requirementHash, configHash, revision: 1 }, candidate: { pass: true, candidateId: id, runId: run.id, treeHash: h, requirementHash, revision: 1, configHash, evidencePath: evidenceFile } })) }
  return { root, asset, run, auto, snapshot, options, service, jobPath, candidatePath, evidenceFile }
}
function request(f, binding) { return { root: f.root, requirementId: f.asset.id, rejectCandidate: true, subject: { kind: 'human', id: 'human:owner' }, actor: 'human:owner', answer: 'Actual observed failure; repair original scope', expectedReview: binding } }

test('source-stale review binds fresh full snapshot and historical candidate without inventing candidate.runId', t => {
 const f=fixture(t,true), before=readFileSync(join(f.root,f.candidatePath),'utf8'), review=rejectionReview(f.options())
 assert.equal(review.allowed,true); assert.equal(review.stale,true)
 assert.equal(review.binding.provenance.kind,'native-deployment')
 assert.equal('runId' in JSON.parse(before),false)
 assertRejectionReview(review,review.binding)
 f.snapshot.files[0].hash='c'.repeat(64)
 assert.throws(()=>assertRejectionReview(rejectionReview(f.options()),review.binding),{code:'review-changed'})
 assert.equal(readFileSync(join(f.root,f.candidatePath),'utf8'),before)
})

for (const mutation of ['candidate','receipt','initial-config','initial-requirement','receipt-root','receipt-job','evidence','config','revision','pending','ordinary-failure','paused','negative-budget','nan-budget','exhausted','verification-limit','partial-snapshot']) {
 test(`strict review rejects ${mutation}`, t=>{
  const f=fixture(t,true)
  if(mutation==='candidate') writeFileSync(join(f.root,f.candidatePath),'{}')
  if(mutation==='receipt') {const j=JSON.parse(readFileSync(join(f.root,f.jobPath)));j.runId='RUN-OTHER';writeFileSync(join(f.root,f.jobPath),JSON.stringify(j))}
  if(['initial-config','initial-requirement','receipt-root','receipt-job'].includes(mutation)) {const j=JSON.parse(readFileSync(join(f.root,f.jobPath)));if(mutation==='initial-config')j.initial.configHash='bad';if(mutation==='initial-requirement')j.initial.requirementHash='bad';if(mutation==='receipt-root')j.root=join(f.root,'other');if(mutation==='receipt-job')j.jobId='wrong';writeFileSync(join(f.root,f.jobPath),JSON.stringify(j))}
  if(mutation==='evidence') writeFileSync(join(f.root,f.evidenceFile),'{}')
  if(mutation==='config') f.options=()=>({root:f.root,run:runs.readRun(f.root,f.run.id),asset:f.asset,snapshot:f.snapshot,plan:{commands:['changed']}})
  if(mutation==='revision') f.asset.extra.revision=2
  if(mutation==='pending') writeFileSync(join(f.root,`.alm/runs/${f.run.id}-decision.md`),'A real pending question')
  if(mutation==='ordinary-failure') runs.updateRun({root:f.root,runId:f.run.id,status:'failed',phase:'interrupted',failure:{code:'agent-failed'},apply:true})
  if(mutation==='paused') runs.updateRun({root:f.root,runId:f.run.id,status:'paused',apply:true})
  if(mutation==='partial-snapshot') f.snapshot.complete=false
  if(['negative-budget','nan-budget','exhausted','verification-limit'].includes(mutation)) {const auto=structuredClone(f.auto);if(mutation==='negative-budget')auto.dispatches=-1;if(mutation==='nan-budget')auto.dispatches=null;if(mutation==='exhausted')auto.dispatches=3;if(mutation==='verification-limit')auto.verification.attempts=4;runs.updateRun({root:f.root,runId:f.run.id,checkpoint:{autoAdvance:auto},apply:true})}
  assert.equal(rejectionReview(f.options()).allowed,false)
 })
}

for(const queue of ['pendingRepairs','repairJobs','autoAdvanceJobs']) for(const fresh of [false,true]) test(`rejects queued ${queue} at ${fresh?'fresh await':'entry'} without original run writes`,async t=>{
 const f=fixture(t),review=rejectionReview(f.options()),path=join(f.root,`.alm/runs/${f.run.id}.json`),before=readFileSync(path,'utf8');let disposed=0
 const original=f.service.rejectionReview
 f.service.rejectionReview=(...args)=>{
  if(f.service[queue]?.size) return RequirementsService.prototype.rejectionReview.call(f.service,...args)
  return original()
 }
 // Use exact production queue keys while keeping fixture acceptance context deterministic.
 const key=queue==='autoAdvanceJobs'?`${f.service.deliveryRootKey(f.root)}|${f.run.id}`:`${f.root}|${f.run.id}`
 const enqueue=()=>{f.service[queue]=new Map([[key,{}]])}
 if(!fresh)enqueue()
 f.service.ctx={get:name=>name==='agentPresets'?{resolve:async()=>({id:'mock'}),mount:async()=>{}}:null}
 f.service.executionCarrier=()=>({async create(){enqueue();return {dispose(){disposed++},agent:{followup(){assert.fail('must not dispatch')}}}}})
 await assert.rejects(f.service.resumeDeliveryRun(request(f,review.binding)),{code:'review-changed'})
 assert.equal(readFileSync(path,'utf8'),before);assert.equal(disposed,fresh?1:0)
})

test('same live session records real rejection and rearms without resetting history or budgets', async t=>{
 const f=fixture(t), review=rejectionReview(f.options()), before=runs.readRun(f.root,f.run.id)
 let message
 f.service.activeRuns.set(f.service.executionKey(f.root, f.asset.id),{root:f.root,runId:f.run.id,agent:{followup(m){message=m;return new Promise(()=>{})}}})
 const result=await f.service.resumeDeliveryRun(request(f,review.binding))
 assert.equal(result.resumed,true);assert.equal(result.runId,f.run.id)
 const after=runs.readRun(f.root,f.run.id)
 assert.equal(after.checkpoint.autoAdvance.status,'authorized')
 for(const key of ['authorization','dispatches','maxDispatches','verification','repair']) assert.deepEqual(after.checkpoint.autoAdvance[key],before.checkpoint.autoAdvance[key])
 assert.deepEqual(after.checkpoint.done,before.checkpoint.done)
 assert.equal(after.answers.at(-1).text,'Actual observed failure; repair original scope')
 assert.match(message.content[0].text,/Actual observed failure/)
 assert.equal(runs.listRuns(f.root).length,1)
})

test('exact failed.host-restart interrupted lifecycle resumes same run with fresh carrier',async t=>{
 const f=fixture(t,true)
 runs.updateRun({root:f.root,runId:f.run.id,status:'failed',phase:'interrupted',failure:{code:'host-restart'},apply:true})
 const review=rejectionReview(f.options());assert.equal(review.allowed,true)
 f.service.ctx={get:name=>name==='agentPresets'?{resolve:async()=>({id:'mock'}),mount:async()=>{}}:null}
 f.service.executionCarrier=()=>({create:async()=>({agent:{followup(){return new Promise(()=>{})}},dispose(){}})})
 const result=await f.service.resumeDeliveryRun(request(f,review.binding))
 assert.equal(result.resumed,true);assert.equal(result.runId,f.run.id)
 assert.equal(runs.readRun(f.root,f.run.id).failure.code,'host-restart')
})

for(const mutation of ['source','receipt','new-run','pending','req']) test(`fresh await CAS disposes and leaves original bytes unchanged: ${mutation}`,async t=>{
 const f=fixture(t,true),review=rejectionReview(f.options()),path=join(f.root,`.alm/runs/${f.run.id}.json`),before=readFileSync(path,'utf8')
 let disposed=0
 f.service.ctx={get:name=>name==='agentPresets'?{resolve:async()=>({id:'mock'}),mount:async()=>{}}:null}
 f.service.executionCarrier=()=>({async create(){
  if(mutation==='source')f.snapshot.files[0].hash='c'.repeat(64)
  if(mutation==='receipt')writeFileSync(join(f.root,f.jobPath),'{}')
  if(mutation==='new-run') { const newer=runs.createRun({root:f.root,requirementId:'REQ-OTHER',carrier:'mock'}).run; newer.requirement=f.asset.id; writeFileSync(join(f.root,`.alm/runs/${newer.id}.json`),JSON.stringify(newer)) }
  if(mutation==='pending')writeFileSync(join(f.root,`.alm/runs/${f.run.id}-decision.md`),'New question')
  if(mutation==='req')f.asset.extra.revision=2
  return {dispose(){disposed++},agent:{followup(){assert.fail('must not dispatch')}}}
 }})
 await assert.rejects(f.service.resumeDeliveryRun(request(f,review.binding)),error=>['review-changed','decision-changed'].includes(error.code))
 assert.equal(disposed,1);assert.equal(readFileSync(path,'utf8'),before)
})

test('forged subject and absent binding never dispatch or record an answer',async t=>{
 const f=fixture(t),review=rejectionReview(f.options()),before=runs.readRun(f.root,f.run.id)
 await assert.rejects(f.service.resumeDeliveryRun({...request(f,review.binding),subject:{kind:'agent',id:'human:owner'}}),{code:'human-required'})
 await assert.rejects(f.service.resumeDeliveryRun(request(f,null)),{code:'review-changed'})
 assert.deepEqual(runs.readRun(f.root,f.run.id),before)
})

test('linked internal candidate directory fails closed',t=>{
 const f=fixture(t),dir=join(f.root,'.alm/candidates',f.asset.id),outside=join(f.root,'outside')
 mkdirSync(outside);rmSync(dir,{recursive:true});symlinkSync(outside,dir,'junction')
 assert.equal(rejectionReview(f.options()).allowed,false)
})
