import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import RequirementsService from '../index.js'
import * as runs from '../../alm-core/src/requirements/run.mjs'
import * as acceptance from '../../alm-core/src/acceptance/acceptance.mjs'
const id = 'REQ-REAL-001'
function fixture(t, command = ['node', 'tests/check.cjs'], timeoutMs = 10000) {
  const root = mkdtempSync(join(tmpdir(), 'alm-host-verification-'))
  for (const dir of ['requirements', 'tests', 'src']) mkdirSync(join(root, dir))
  writeFileSync(join(root, 'requirements/r.sdoc'), '[DOCUMENT]\nTITLE: Test\n\n[REQUIREMENT]\nUID: '+id+'\nTITLE: Return 42\nOWNER: test\nPRIORITY: P1\nCATEGORY: functional\nREVISION: 1\n\n[RELATION]\nType: verified_by\nValue: TEST-REAL-001\n')
  writeFileSync(join(root, 'tests/t.sdoc'), '[DOCUMENT]\nTITLE: Tests\n\n[REQUIREMENT]\nUID: TEST-REAL-001\nTITLE: Check 42\nOWNER: test\nSTATUS: proposed\n')
  writeFileSync(join(root, 'src/value.cjs'), 'module.exports=0\n')
  writeFileSync(join(root, 'tests/check.cjs'), "console.log('HOST_REAL_PROCESS pid='+process.pid);require('node:assert/strict').equal(require('../src/value.cjs'),42)\n")
  const git = (...args) => execFileSync('git', ['-c','user.name=fixture','-c','user.email=fixture@example.invalid', ...args], { cwd: root, stdio: 'pipe' })
  git('init'); git('add','.'); git('commit','-qm','fixture')
  acceptance.applyAcceptanceConfig({ root, requirementId: id, commands: [{ id: 'check', command, timeoutMs }] })
  const service = Object.create(RequirementsService.prototype)
  Object.assign(service, { activeRuns: new Map(), runHeartbeats: new Map(), pendingRepairs: new Map(), repairJobs: new Map(), startingRuns: new Map(), resumingRuns: new Map(), disposed: false })
  const run = runs.createRun({ root, requirementId: id, carrier: 'controlled' }).run
  service.activeRuns.set(service.executionKey(root, id), { root, runId: run.id, agent: { followup: async () => { throw new Error('unexpected model turn') } } })
  const auth = service.prepareAutomaticAuthorization(root, id, { id: 'human:test', kind: 'human' })
  runs.updateRun({ root, runId: run.id, status: 'running', checkpoint: { autoAdvance: auth }, apply: true })
  t.after(() => { service.disposed = true; for (const timer of service.runHeartbeats.values()) clearInterval(timer); rmSync(root, { recursive: true, force: true }) })
  return { root, service, runId: run.id, handle: service.activeRuns.get(service.executionKey(root, id)) }
}
async function drain(f) { for (let i=0;i<12;i++) { const jobs=[...(f.service.autoAdvanceJobs?.values()??[]), ...f.service.repairJobs.values()]; if(!jobs.length) break; await Promise.all(jobs) } }
const stored = f => runs.readRun(f.root, f.runId)
test('carrier only changes source: host runs real registered subprocess and creates candidate, ignoring fake receipt', async t => {
  const f=fixture(t)
  writeFileSync(join(f.root,'src/value.cjs'),'module.exports=42\n')
  writeFileSync(join(f.root,'.alm/runs/fake.json'), JSON.stringify({ result:'pass', schema:'standalone' }))
  f.service.settleResumedTurn(f.root,f.runId); await drain(f)
  const run=stored(f); const receipt=run.checkpoint.autoAdvance.verification.records[0]
  assert.equal(run.checkpoint.autoAdvance.status,'candidate-ready')
  assert.equal(run.checkpoint.autoAdvance.dispatches,0)
  assert.equal(receipt.status,'passed'); assert.ok(receipt.evidenceHash)
  const evidence=JSON.parse(readFileSync(receipt.evidencePath,'utf8'))
  assert.equal(evidence.schema,acceptance.ACCEPTANCE_SCHEMA); assert.equal(evidence.commands[0].exitCode,0)
  assert.match(evidence.commands[0].stdout,/HOST_REAL_PROCESS pid=\d+/)
  assert.equal(evidence.worktree.stable,true)
  assert.equal(evidence.worktree.before.treeHash,evidence.worktree.after.treeHash)
  assert.equal(typeof evidence.configHash,'string')
  const summary=acceptance.acceptanceSummary(f.root,id,f.service.automaticFacts(f.root,id).snapshot.headSha,f.service.acceptanceContext(f.root,id))
  assert.equal(summary.latest.current,true)
  f.service.scheduleAutomaticAdvance(f.root,f.runId); await drain(f)
  assert.equal(stored(f).checkpoint.autoAdvance.verification.attempts,1)
  assert.equal(run.answers.length,0)
  assert.equal(existsSync(join(f.root,'.alm/releases')),false)
})
test('real start lifecycle serializes initial turn, host verification and one repair', async t => {
  const f=fixture(t); let created=0; let turns=0; let active=0; let peak=0
  runs.updateRun({root:f.root,runId:f.runId,status:'cancelled',apply:true})
  const disposers=[]
  const instance=new RequirementsService({effect(fn){disposers.push(fn())},webServer:{register:()=>()=>{}},tools:{register:()=>()=>{}},get(name){
    if(name==='agentPresets')return {resolve:async()=>({id:'standard'}),mount:async()=>{}}
    if(name==='agents')return {create:async()=>{created++;return {agent:{followup:async()=>{active++;peak=Math.max(peak,active);turns++;if(turns===2)writeFileSync(join(f.root,'src/value.cjs'),'module.exports=42\n');await Promise.resolve();active--},whenIdle:async()=>{},cancel(){}},dispose(){}}}}
    return null
  }},{sidebarPort:0})
  t.after(()=>disposers.forEach(fn=>fn()))
  const result=await instance.startDeliveryRun({root:f.root,requirementId:id,changeId:'CHG-TEST',autoAdvance:true,authorizationSubject:{kind:'human',id:'human:test'},item:{id,title:'Return 42'}})
  await new Promise(resolve=>setImmediate(resolve))
  await drain({...f,service:instance})
  const run=runs.readRun(f.root,result.runId)
  assert.equal(created,1);assert.equal(turns,2);assert.equal(peak,1)
  assert.equal(run.checkpoint.autoAdvance.status,'candidate-ready')
  assert.equal(run.checkpoint.autoAdvance.dispatches,0);assert.equal(run.checkpoint.inPlaceRepair.attempts,1)
  assert.equal(run.answers.length,0)
})
test('explicit human candidate rejection rearms original history and host verifies a fresh source key', async t => {
  const f=fixture(t)
  writeFileSync(join(f.root,'src/value.cjs'),'module.exports=42\n')
  f.service.settleResumedTurn(f.root,f.runId); await drain(f)
  const before=stored(f), review=f.service.rejectionReview(f.root,id,before)
  assert.equal(review.allowed,true)
  const oldKey=before.checkpoint.autoAdvance.verification.records[0].key
  f.handle.agent.followup=async()=>{writeFileSync(join(f.root,'src/value.cjs'),'module.exports=42 // repaired from actual human feedback\n')}
  f.handle.agent.whenIdle=async()=>{}
  const result=await f.service.resumeDeliveryRun({root:f.root,requirementId:id,rejectCandidate:true,subject:{kind:'human',id:'human:test'},actor:'human:test',answer:'Actual observed defect; repair within original requirement',expectedReview:review.binding})
  assert.equal(result.resumed,true)
  await new Promise(resolve=>setImmediate(resolve)); await drain(f)
  const after=stored(f)
  assert.equal(after.id,before.id);assert.equal(after.checkpoint.autoAdvance.status,'candidate-ready')
  assert.equal(after.checkpoint.autoAdvance.verification.attempts,before.checkpoint.autoAdvance.verification.attempts+1)
  assert.notEqual(after.checkpoint.autoAdvance.verification.records.at(-1).key,oldKey)
  assert.equal(after.checkpoint.autoAdvance.dispatches,before.checkpoint.autoAdvance.dispatches)
  assert.deepEqual(after.checkpoint.autoAdvance.authorization,before.checkpoint.autoAdvance.authorization)
  assert.equal(after.answers.at(-1).text,'Actual observed defect; repair within original requirement')
})

test('same HEAD dirty source change gets a different key and old pass is not reused', async t => {
  const f=fixture(t)
  writeFileSync(join(f.root,'src/value.cjs'),'module.exports=42\n')
  runs.updateRun({root:f.root,runId:f.runId,status:'waiting-input',apply:true})
  const first=await f.service.verifyAutomaticIdle(f.root,f.runId,f.handle,f.service.automaticFacts(f.root,id))
  assert.equal(first.stop,null)
  writeFileSync(join(f.root,'src/value.cjs'),'module.exports=7\n')
  const second=await f.service.verifyAutomaticIdle(f.root,f.runId,f.handle,f.service.automaticFacts(f.root,id))
  assert.equal(second.stop,'registered-acceptance-failed')
  assert.equal(stored(f).checkpoint.autoAdvance.verification.attempts,2)
})
for (const gate of ['cancelled','stopped','decision','unreadable','budget']) test(`verification blocks ${gate} without executing`, async t => {
  const f=fixture(t); const run=stored(f)
  const checkpoint={...run.checkpoint, autoAdvance:{...run.checkpoint.autoAdvance}}
  if(gate==='stopped') checkpoint.autoAdvance.status='stopped'
  if(gate==='decision'||gate==='unreadable') checkpoint.decision='.alm/runs/missing-decision.md'
  if(gate==='budget') checkpoint.autoAdvance.verification={attempts:4,records:[]}
  runs.updateRun({root:f.root,runId:f.runId,status:gate==='cancelled'?'cancelled':'waiting-input',checkpoint,apply:true})
  await f.service.verifyAutomaticIdle(f.root,f.runId,f.handle,f.service.automaticFacts(f.root,id))
  assert.equal(acceptance.readAcceptanceEvidence(f.root,id),null)
})
test('registered command changes after authorization stop before spawning', async t => {
  const f=fixture(t)
  acceptance.applyAcceptanceConfig({root:f.root,requirementId:id,commands:[{id:'check',command:['node','-e','throw new Error("unauthorized")'],timeoutMs:2000}]})
  runs.updateRun({root:f.root,runId:f.runId,status:'waiting-input',apply:true})
  const result=await f.service.verifyAutomaticIdle(f.root,f.runId,f.handle,f.service.automaticFacts(f.root,id))
  assert.equal(result.stop,'verification-config-changed')
  assert.equal(acceptance.readAcceptanceEvidence(f.root,id),null)
})
test('size-only snapshot cannot authorize registered process execution', async t => {
  const f=fixture(t)
  writeFileSync(join(f.root,'src/large.bin'),Buffer.alloc(4*1024*1024+1))
  runs.updateRun({root:f.root,runId:f.runId,status:'waiting-input',apply:true})
  const facts=f.service.automaticFacts(f.root,id)
  assert.equal(facts.snapshot.complete,false)
  await f.service.verifyAutomaticIdle(f.root,f.runId,f.handle,facts)
  assert.equal(acceptance.readAcceptanceEvidence(f.root,id),null)
})
test('same-key receipt tampering cannot be reused', async t => {
  const f=fixture(t)
  writeFileSync(join(f.root,'src/value.cjs'),'module.exports=42\n')
  runs.updateRun({root:f.root,runId:f.runId,status:'waiting-input',apply:true})
  await f.service.verifyAutomaticIdle(f.root,f.runId,f.handle,f.service.automaticFacts(f.root,id))
  const receipt=stored(f).checkpoint.autoAdvance.verification.records[0]
  writeFileSync(receipt.evidencePath,'{}')
  const result=await f.service.verifyAutomaticIdle(f.root,f.runId,f.handle,f.service.automaticFacts(f.root,id))
  assert.equal(result.stop,'verification-evidence-changed')
})
test('timeout is an explicit verification timeout and never dispatches repair', async t => {
  const f=fixture(t,['node','-e','setTimeout(()=>{},5000)'],1000)
  f.service.settleResumedTurn(f.root,f.runId); await drain(f)
  assert.equal(stored(f).checkpoint.autoAdvance.reason,'verification-timeout')
  assert.equal(stored(f).checkpoint.inPlaceRepair,undefined)
})
test('a human may resume automatic verification after a bounded timeout', t => {
  const f=fixture(t)
  const run=stored(f)
  runs.updateRun({root:f.root,runId:f.runId,status:'waiting-input',checkpoint:{...run.checkpoint,autoAdvance:{...run.checkpoint.autoAdvance,status:'stopped',reason:'verification-timeout'}},apply:true})
  const resumed=f.service.resumeAutomaticCheckpoint(f.root,stored(f),'human:test')
  assert.equal(resumed.receipt.autoAdvanceResumed,true)
  assert.equal(resumed.checkpoint.autoAdvance.status,'authorized')
  assert.equal(resumed.checkpoint.autoAdvance.reason,null)
})
test('registered assertion failure schedules exactly one repair; repaired idle is verified by host', async t => {
  const f=fixture(t); let turns=0
  f.handle.agent.followup=async()=>{ turns++; writeFileSync(join(f.root,'src/value.cjs'),'module.exports=42\n') }
  f.service.settleResumedTurn(f.root,f.runId); await drain(f)
  const run=stored(f)
  assert.equal(turns,1); assert.equal(run.checkpoint.inPlaceRepair.attempts,1)
  assert.equal(run.checkpoint.autoAdvance.dispatches,0)
  assert.equal(run.checkpoint.autoAdvance.status,'candidate-ready')
  assert.equal(run.checkpoint.autoAdvance.verification.attempts,2)
  const evidence=JSON.parse(readFileSync(run.checkpoint.autoAdvance.verification.records.at(-1).evidencePath,'utf8'))
  assert.equal(evidence.commands[0].spawnFailed,false)
  assert.equal(evidence.commands[0].timedOut,false)
})
