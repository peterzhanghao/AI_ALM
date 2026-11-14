import { test } from 'node:test'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  RUN_SCHEMA,
  cleanRequirementBriefForPrompt,
  activeRunFor,
  resumableRunFor,
  createRun,
  listRuns,
  listRunPage,
  readRun,
  runPath,
  runView,
  sweepStaleRuns,
  touchRun,
  updateRun,
  requirementAnchor,
} from '../../src/requirements/run.mjs'

test('execution anchors remove persisted metadata and hashes without changing requirement prose', () => {
  const hash = 'a'.repeat(64)
  const brief = `# 需求\n\n保留用户手动修改的标题。\n<!-- alm:meta {"docHash":"sha256:${hash}"} -->\n`
  const cleaned = cleanRequirementBriefForPrompt(brief)
  assert.match(cleaned, /保留用户手动修改的标题/)
  assert.doesNotMatch(cleaned, /alm:meta|sha256:|a{64}/i)
  const anchor = requirementAnchor({ brief, revision: 2, docHash: `sha256:${hash}` })
  assert.match(anchor, /版本 v2/)
  assert.doesNotMatch(anchor, /docHash|sha256:|a{64}/i)
})

test('run history pages newest first within the requirement despite concurrent newer runs', () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-run-pages-'))
  try {
    const dir = join(root, '.alm', 'runs')
    mkdirSync(dir, { recursive: true })
    const add = (id, requirement) => writeFileSync(join(dir, `${id}.json`), JSON.stringify({ schema: RUN_SCHEMA, id, requirement, status: 'done', createdAt: '2026-11-05T00:00:00Z' }))
    add('RUN-999', 'REQ-A'); add('RUN-1000', 'REQ-B'); add('RUN-1001', 'REQ-A'); add('RUN-1002', 'REQ-A')
    const first = listRunPage(root, 'REQ-A', { limit: 2 })
    assert.deepEqual(first.runs.map(run => run.id), ['RUN-1002', 'RUN-1001'])
    assert.equal(first.next, 'RUN-1001')
    add('RUN-1003', 'REQ-A')
    const second = listRunPage(root, 'REQ-A', { before: first.next, limit: 2 })
    assert.deepEqual(second.runs.map(run => run.id), ['RUN-999'])
    assert.equal(second.next, null)
    assert.throws(() => listRunPage(root, 'REQ-A', { before: '../bad' }), { code: 'run-cursor-invalid' })
    assert.throws(() => listRunPage(root, 'REQ-A', { limit: 101 }), { code: 'run-cursor-invalid' })
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('large run directories keep response pages bounded', t => {
  const root = mkdtempSync(join(tmpdir(), 'alm-run-page-perf-'))
  try {
    const dir = join(root, '.alm', 'runs')
    mkdirSync(dir, { recursive: true })
    for (let i = 1; i <= 1000; i++) {
      const id = `RUN-${String(i).padStart(3, '0')}`
      writeFileSync(join(dir, `${id}.json`), JSON.stringify({ schema: RUN_SCHEMA, id, requirement: i % 2 ? 'REQ-A' : 'REQ-B', status: 'done' }))
    }
    const samples = []
    for (let i = 0; i < 5; i++) {
      const start = performance.now()
      const page = listRunPage(root, 'REQ-A', { limit: 20 })
      samples.push(performance.now() - start)
      assert.equal(page.runs.length, 20)
      assert.ok(page.next)
    }
    samples.sort((a, b) => a - b)
    t.diagnostic(`模拟 1000 个本地运行文件的首屏（5 次）：中位 ${samples[2].toFixed(1)}ms，最大 ${samples[4].toFixed(1)}ms`)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('run mutations serialize across processes and retain session and heartbeat updates', async () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-run-concurrency-'))
  const moduleUrl = new URL('../../src/requirements/run.mjs', import.meta.url).href
  const worker = `import * as runs from ${JSON.stringify(moduleUrl)};
    const [root, action, value] = process.argv.slice(1);
    for (let attempt = 0; ; attempt++) {
      try {
        if (action === 'create') runs.createRun({root, requirementId: value, carrier: 'test'});
        if (action === 'resume') runs.updateRun({root, runId: value, sessionId: 'resumed', answer: {text: 'answer'}, apply: true});
        if (action === 'touch') runs.touchRun({root, runId: value, note: 'heartbeat'});
        break;
      } catch (error) {
        if (error.code !== 'run-busy' || attempt >= 4) throw error;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }`
  const execute = (action, value) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', worker, root, action, value], { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(stderr)))
  })
  try {
    await Promise.all(Array.from({ length: 8 }, (_, index) => execute('create', `REQ-${index % 4}`)))
    const runs = listRuns(root)
    assert.equal(runs.length, 4)
    assert.equal(new Set(runs.map((run) => run.id)).size, 4)
    assert.equal(new Set(runs.map((run) => run.requirement)).size, 4)
    await Promise.all([execute('resume', runs[0].id), execute('touch', runs[0].id)])
    const updated = readRun(root, runs[0].id)
    assert.equal(updated.sessionId, 'resumed')
    assert.equal(updated.answers.at(-1).text, 'answer')
    assert.ok(updated.events.some((event) => event.note === 'heartbeat'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('busy lock and failed serialization preserve the existing run', () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-run-lock-'))
  try {
    const run = createRun({ root, requirementId: 'REQ-A', carrier: 'test' }).run
    const original = readFileSync(runPath(root, run.id), 'utf8')
    assert.throws(() => updateRun({ root, runId: run.id, checkpoint: { invalid: 1n }, apply: true }), TypeError)
    assert.equal(readFileSync(runPath(root, run.id), 'utf8'), original)
    const lock = join(root, '.alm', 'runs', '.write-lock')
    mkdirSync(lock)
    assert.throws(() => touchRun({ root, runId: run.id }), (error) => error.code === 'run-busy')
    assert.equal(readFileSync(runPath(root, run.id), 'utf8'), original)
    rmSync(lock, { recursive: true })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('initial running state and checkpoint are persisted together', () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-run-initial-'))
  try {
    assert.throws(() => createRun({ root, requirementId: 'REQ-A', carrier: 'test', status: 'running', checkpoint: { invalid: 1n } }), TypeError)
    assert.equal(activeRunFor(root, 'REQ-A'), null)
    const result = createRun({ root, requirementId: 'REQ-A', carrier: 'test', status: 'running', checkpoint: { autoAdvance: { authorized: true } } })
    const stored = readRun(root, result.run.id)
    assert.equal(stored.status, 'running')
    assert.deepEqual(stored.checkpoint, { autoAdvance: { authorized: true } })
    assert.equal(stored.events[0].status, 'running')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('exited run lock owner can be reclaimed by competing processes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-run-reclaim-'))
  const moduleUrl = new URL('../../src/requirements/run.mjs', import.meta.url).href
  const execute = (source, args = []) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', source, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', reject)
    child.on('close', code => code === 0 ? resolve(stdout) : reject(new Error(stderr)))
  })
  try {
    const initial = createRun({ root, requirementId: 'REQ-INITIAL', carrier: 'test' }).run
    const original = readFileSync(runPath(root, initial.id), 'utf8')
    const lock = join(root, '.alm', 'runs', '.write-lock')
    const crashingWorker = `import {updateRun} from ${JSON.stringify(moduleUrl)};
      const [root, runId] = process.argv.slice(1);
      updateRun({root, runId, checkpoint:{toJSON(){process.exit(0)}}, apply:true});`
    await execute(crashingWorker, [root, initial.id])
    assert.equal(existsSync(join(lock, 'owner.json')), true)
    assert.equal(readFileSync(runPath(root, initial.id), 'utf8'), original)
    const worker = `import {createRun} from ${JSON.stringify(moduleUrl)};
      const [root, requirementId] = process.argv.slice(1);
      createRun({root, requirementId, carrier:'test'});`
    await Promise.all([execute(worker, [root, 'REQ-A']), execute(worker, [root, 'REQ-B'])])
    const runs = listRuns(root)
    assert.deepEqual(runs.map(run => run.requirement).sort(), ['REQ-A', 'REQ-B', 'REQ-INITIAL'])
    assert.equal(new Set(runs.map(run => run.id)).size, 3)
    assert.equal(existsSync(lock), false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('run locks with uncertain owners remain locked', () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-run-lock-uncertain-'))
  const originalKill = process.kill
  try {
    const run = createRun({ root, requirementId: 'REQ-A', carrier: 'test' }).run
    const original = readFileSync(runPath(root, run.id), 'utf8')
    const lock = join(root, '.alm', 'runs', '.write-lock')
    mkdirSync(lock)
    const uncertainPid = 123456789
    process.kill = (pid, signal) => {
      if (pid === uncertainPid && signal === 0) throw Object.assign(new Error('probe unavailable'), { code: 'EIO' })
      return originalKill.call(process, pid, signal)
    }
    for (const owner of [{ pid: 0, hostname: hostname() }, { pid: process.pid, hostname: hostname() }, { pid: uncertainPid, hostname: hostname() }, { pid: uncertainPid, hostname: 'other-host' }]) {
      writeFileSync(join(lock, 'owner.json'), JSON.stringify(owner))
      assert.throws(() => touchRun({ root, runId: run.id }), { code: 'run-busy' })
      assert.equal(readFileSync(runPath(root, run.id), 'utf8'), original)
      assert.equal(existsSync(join(lock, 'owner.json')), true)
    }
  } finally {
    process.kill = originalKill
    rmSync(root, { recursive: true, force: true })
  }
})

test('incomplete lock and abandoned reclaim marker preserve runs until cleared', () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-run-abandoned-lock-'))
  try {
    const run = createRun({ root, requirementId: 'REQ-A', carrier: 'test' }).run
    const path = runPath(root, run.id)
    const original = readFileSync(path, 'utf8')
    const directory = join(root, '.alm', 'runs')
    for (const name of ['.write-lock', '.write-lock-reclaim']) {
      const marker = join(directory, name)
      mkdirSync(marker)
      assert.throws(() => touchRun({ root, runId: run.id }), { code: 'run-busy' })
      assert.equal(readFileSync(path, 'utf8'), original)
      assert.equal(existsSync(marker), true)
      rmSync(marker, { recursive: true })
    }
    touchRun({ root, runId: run.id, note: 'after recovery' })
    assert.ok(readRun(root, run.id).events.some(event => event.note === 'after recovery'))
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('stale business updates cannot overwrite each other but heartbeats do not invalidate them', async () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-run-conditional-'))
  try {
    const run = createRun({ root, requirementId: 'REQ-A', carrier: 'test' }).run
    touchRun({ root, runId: run.id })
    updateRun({ root, runId: run.id, expectedRun: run, status: 'waiting-input', apply: true })
    const snapshot = readRun(root, run.id)
    const moduleUrl = new URL('../../src/requirements/run.mjs', import.meta.url).href
    const worker = `import { updateRun } from ${JSON.stringify(moduleUrl)};
      const [root, snapshot, value] = process.argv.slice(1);
      try { const run = JSON.parse(snapshot); updateRun({ root, runId: run.id, expectedRun: run, checkpoint: { writer: value }, apply: true }); }
      catch (error) { if (error.code === 'run-changed') process.exit(3); throw error; }`
    const execute = value => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', worker, root, JSON.stringify(snapshot), value], { stdio: ['ignore', 'ignore', 'pipe'] })
      let stderr = ''
      child.stderr.on('data', chunk => { stderr += chunk })
      child.on('error', reject)
      child.on('close', code => code === 0 || code === 3 ? resolve(code) : reject(new Error(stderr)))
    })
    assert.deepEqual((await Promise.all([execute('a'), execute('b')])).sort(), [0, 3])
    const stored = readRun(root, run.id)
    assert.ok(['a', 'b'].includes(stored.checkpoint.writer))
    assert.throws(() => updateRun({ root, runId: run.id, expectedRun: snapshot, answer: { text: 'stale' }, apply: true }), { code: 'run-changed' })
    assert.deepEqual(readRun(root, run.id).answers, [])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('session segments preserve recovery history and never invent legacy predecessors', () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-run-sessions-'))
  try {
    const { run } = createRun({ root, requirementId: 'REQ-A', carrier: 'dsh-session', sessionId: 'first', requirementRevision: 2, requirementDocHash: 'hash-a' })
    assert.equal(run.sessionHistoryComplete, true)
    assert.equal(run.sessions[0].sessionId, 'first')
    assert.equal(run.sessions[0].source, 'dsh-session')
    const preview = updateRun({ root, runId: run.id, sessionId: 'second' })
    assert.equal(preview.run.sessions.length, 2)
    assert.equal(readRun(root, run.id).sessionId, 'first', 'preview does not persist')
    const resumed = updateRun({ root, runId: run.id, sessionId: 'second', apply: true }).run
    assert.equal(resumed.sessions[0].endedAt, resumed.sessions[1].startedAt)
    assert.equal(resumed.sessions[1].requirementDocHash, 'hash-a')
    assert.equal(resumed.sessions[1].source, 'dsh-session')
    assert.equal(updateRun({ root, runId: run.id, sessionId: 'second', apply: true }).run.sessions.length, 2)
    assert.throws(() => updateRun({ root, runId: run.id, sessionId: 'first', apply: true }), { code: 'run-session-reused' })
    assert.equal(readRun(root, run.id).sessionId, 'second')

    const legacy = createRun({ root, requirementId: 'REQ-B', carrier: 'dsh-session', sessionId: 'old' }).run
    delete legacy.sessions
    delete legacy.sessionHistoryComplete
    writeFileSync(runPath(root, legacy.id), JSON.stringify(legacy))
    const migrated = updateRun({ root, runId: legacy.id, sessionId: 'new', apply: true }).run
    assert.equal(migrated.sessionHistoryComplete, false)
    assert.deepEqual(migrated.sessions.map((entry) => entry.sessionId), ['old', 'new'])
    assert.equal(migrated.sessions[0].startedAt, null)
    assert.equal(migrated.sessions[0].source, undefined)
    assert.equal(migrated.sessions[1].source, 'dsh-session')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('runView discovers fixed conventional decisions, consumes exact bytes and fails closed', () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-run-decision-'))
  try {
    const { run } = createRun({ root, requirementId: 'REQ-A', carrier: 'dsh-session' })
    const path = `.alm/runs/${run.id}-decision.md`
    const content = 'Question A\n'
    const contentHash = createHash('sha256').update(content).digest('hex')
    writeFileSync(join(root, path), content)
    updateRun({ root, runId: run.id, status: 'waiting-input', apply: true })
    assert.equal(runView({ root, requirementId: 'REQ-A' }).awaitingAnswer, true, 'fixed conventional unresolved file is a gate shared with the Host')
    assert.equal(runView({ root, requirementId: 'REQ-A' }).idleHandback, false)
    updateRun({ root, runId: run.id, checkpoint: { decision: path }, answer: { actor: 'human', text: 'old unbound answer' }, apply: true })
    assert.equal(runView({ root, requirementId: 'REQ-A' }).awaitingAnswer, true)
    const receipts = [{ path, contentHash, answerIndex: 0, resolvedAt: '2026-11-04T00:00:00Z' }]
    updateRun({ root, runId: run.id, checkpoint: { decision: path, resolvedDecisions: receipts }, apply: true })
    assert.equal(runView({ root, requirementId: 'REQ-A' }).awaitingAnswer, false)
    assert.equal(runView({ root, requirementId: 'REQ-A' }).idleHandback, true)
    writeFileSync(join(root, path), 'Question B\n')
    assert.equal(runView({ root, requirementId: 'REQ-A' }).awaitingAnswer, true, 'same path changed content is a new question')
    rmSync(join(root, path))
    assert.equal(runView({ root, requirementId: 'REQ-A' }).awaitingAnswer, true, 'read failure must not imply consent')
    updateRun({ root, runId: run.id, checkpoint: { decision: '../outside.md', resolvedDecisions: receipts }, apply: true })
    assert.equal(runView({ root, requirementId: 'REQ-A' }).awaitingAnswer, true)
    updateRun({ root, runId: run.id, checkpoint: { decision: null, resolvedDecisions: receipts }, apply: true })
    assert.equal(runView({ root, requirementId: 'REQ-A' }).idleHandback, true)
    assert.deepEqual(readRun(root, run.id).checkpoint.resolvedDecisions, receipts)
    assert.equal(readRun(root, run.id).answers.length, 1, 'projection never writes synthetic answers')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('resumable selector prefers active and only the latest restart failure, never older terminal history', () => {
 const root=mkdtempSync(join(tmpdir(),'alm-resumable-'))
 try {
  const first=createRun({root,requirementId:'REQ-A',carrier:'mock'}).run
  updateRun({root,runId:first.id,status:'failed',failure:{code:'host-restart'},apply:true})
  assert.equal(resumableRunFor(root,'REQ-A').id,first.id)
  const second=createRun({root,requirementId:'REQ-A',carrier:'mock'}).run
  assert.equal(resumableRunFor(root,'REQ-A').id,second.id)
  updateRun({root,runId:second.id,status:'paused',apply:true})
  assert.equal(resumableRunFor(root,'REQ-A').status,'paused','selection does not authorize resuming paused')
  updateRun({root,runId:second.id,status:'cancelled',apply:true})
  assert.equal(resumableRunFor(root,'REQ-A'),null,'never backtrack to older restart failure')
  const third=createRun({root,requirementId:'REQ-A',carrier:'mock'}).run
  updateRun({root,runId:third.id,status:'failed',failure:{code:'ordinary-failure'},apply:true})
  assert.equal(resumableRunFor(root,'REQ-A'),null)
  const fourth=createRun({root,requirementId:'REQ-A',carrier:'mock',sessionId:'transport-session'}).run
  updateRun({root,runId:fourth.id,status:'failed',phase:'interrupted',failure:{code:'transport-failed',hostCode:'TRANSPORT'},apply:true})
  assert.equal(resumableRunFor(root,'REQ-A').id,fourth.id,'a host transport failure retains the checkpoint for resume')
  assert.deepEqual(readRun(root,fourth.id).interruptedSessions,['transport-session'])
  const legacy = createRun({root,requirementId:'REQ-LEGACY',carrier:'mock',sessionId:'legacy-transport'}).run
  updateRun({root,runId:legacy.id,status:'failed',phase:'implement',failure:{code:'TRANSPORT'},apply:true})
  assert.equal(resumableRunFor(root,'REQ-LEGACY').id,legacy.id,'older uppercase TRANSPORT records remain recoverable')
  assert.deepEqual(readRun(root,legacy.id).interruptedSessions,['legacy-transport'])
  assert.equal(resumableRunFor(root,'OTHER'),null)
 } finally {rmSync(root,{recursive:true,force:true})}
})

test('a run needs a real carrier, and repeated starts reuse the active run', () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-run-'))
  try {
    assert.throws(() => createRun({ root, requirementId: 'REQ-A' }), (error) => error.code === 'run-carrier-missing')
    assert.equal(listRuns(root).length, 0, 'task cards are not a run')

    const first = createRun({ root, requirementId: 'REQ-A', changeId: 'CHG-A-001', carrier: 'dsh-session', sessionId: 'alm-CHG-A-001' })
    assert.equal(first.created, true)
    assert.equal(first.run.schema, RUN_SCHEMA)
    assert.equal(first.run.status, 'queued')

    const again = createRun({ root, requirementId: 'REQ-A', changeId: 'CHG-A-001', carrier: 'dsh-session' })
    assert.equal(again.reused, true)
    assert.equal(again.run.id, first.run.id)
    assert.equal(listRuns(root).length, 1, 'a double click does not create a second run')

    const other = createRun({ root, requirementId: 'REQ-B', carrier: 'dsh-session' })
    assert.equal(other.run.id, 'RUN-002')
    assert.equal(activeRunFor(root, 'REQ-A').id, first.run.id)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('run transitions are checked, and a lost heartbeat never reads as running', () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-run-hb-'))
  try {
    const created = createRun({ root, requirementId: 'REQ-A', carrier: 'dsh-session', sessionId: 's1' })
    const running = updateRun({ root, runId: created.run.id, status: 'running', phase: 'implement', apply: true })
    assert.equal(running.run.status, 'running')
    assert.equal(readRun(root, created.run.id).status, 'running')
    assert.throws(
      () => updateRun({ root, runId: created.run.id, status: 'queued' }),
      (error) => error.code === 'run-transition-invalid',
    )
    assert.equal(runView({ root, requirementId: 'REQ-A' }).active, true)

    // Heartbeat older than the timeout: the run is reported as not active and a
    // sweep turns it into a failure with a resumable checkpoint.
    const old = Date.now() + 60 * 60 * 1000
    const view = runView({ root, requirementId: 'REQ-A' })
    assert.equal(view.status, 'running')
    const swept = sweepStaleRuns({ root, now: old, apply: true })
    assert.deepEqual(swept.swept, [created.run.id])
    const after = runView({ root, requirementId: 'REQ-A' })
    assert.equal(after.status, 'failed')
    assert.equal(after.active, false)
    assert.equal(after.failure.code, 'heartbeat-lost')
    assert.deepEqual(readRun(root, created.run.id).interruptedSessions, ['s1'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a live heartbeat keeps a run active and a stopped one reads as interrupted', () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-run-touch-'))
  try {
    const created = createRun({ root, requirementId: 'REQ-A', carrier: 'dsh-session', sessionId: 's1' })
    updateRun({ root, runId: created.run.id, status: 'running', phase: 'implement', apply: true })
    const before = readRun(root, created.run.id).heartbeatAt
    const touched = touchRun({ root, runId: created.run.id, note: 'agent step', now: Date.parse(before) + 30_000 })
    assert.equal(touched.applied, true)
    const live = runView({ root, requirementId: 'REQ-A' })
    assert.equal(live.stale, false)
    assert.equal(live.awaitingAnswer, false)
    assert.equal(live.active, true)
    assert.equal(live.lastActivityAt, new Date(Date.parse(before) + 30_000).toISOString())

    // A turn that stopped sending heartbeats must read as interrupted: the UI
    // cannot keep saying "running" for a session that is gone.
    const file = runPath(root, created.run.id)
    const record = JSON.parse(readFileSync(file, 'utf8'))
    const dead = new Date(Date.now() - 30 * 60 * 1000).toISOString()
    record.heartbeatAt = dead
    record.updatedAt = dead
    writeFileSync(file, JSON.stringify(record, null, 2))
    const interrupted = runView({ root, requirementId: 'REQ-A' })
    assert.equal(interrupted.status, 'running')
    assert.equal(interrupted.active, false)
    assert.equal(interrupted.stale, true)

    // Waiting for a human answer is a designed pause, not a lost heartbeat.
    record.status = 'waiting-input'
    record.phase = 'awaiting-human'
    writeFileSync(file, JSON.stringify(record, null, 2))
    const handback = runView({ root, requirementId: 'REQ-A' })
    assert.equal(handback.stale, false)
    assert.equal(handback.idleHandback, true)
    assert.equal(handback.awaitingAnswer, false, 'an idle hand-back has nothing to answer')
    assert.equal(handback.active, true)

    // Only a recorded decision request turns "waiting input" into a question.
    record.checkpoint = { decision: '.alm/runs/RUN-001-decision.md' }
    writeFileSync(file, JSON.stringify(record, null, 2))
    const waiting = runView({ root, requirementId: 'REQ-A' })
    assert.equal(waiting.stale, false)
    assert.equal(waiting.awaitingAnswer, true)
    assert.equal(waiting.idleHandback, false)
    assert.equal(waiting.active, true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
