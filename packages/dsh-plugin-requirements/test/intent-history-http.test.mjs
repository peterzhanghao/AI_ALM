import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import RequirementsService from '../index.js'
import * as core from '../../alm-core/src/intent/index.mjs'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const route = '/api/alm/requirements/intent'

function tree(root) {
  const out = {}
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = join(dir, entry.name)
      if (entry.isDirectory()) walk(file)
      else out[file.slice(root.length)] = readFileSync(file).toString('base64')
    }
  }
  walk(root)
  return out
}

async function harness(run) {
  mkdirSync(join(repo, 'tmp'), { recursive: true })
  const base = mkdtempSync(join(repo, 'tmp/intent-history-http-'))
  const a = join(base, 'a'), b = join(base, 'b'), outside = join(base, 'unregistered')
  for (const [root, id] of [[a, 'AA'], [b, 'BB'], [outside, 'CC']]) {
    mkdirSync(join(root, '.alm'), { recursive: true })
    writeFileSync(join(root, '.alm/project.json'), JSON.stringify({ schema: 'alm.project/v1', id, name: id, requirementRoot: 'requirements', github: { owner: 'test', repo: id } }))
  }
  const registry = join(base, 'workspace.json')
  writeFileSync(registry, JSON.stringify({ tables: { workspaces: { wa: { path: a }, wb: { path: b } } } }))
  const previous = process.env.DSH_WORKSPACES_FILE
  process.env.DSH_WORKSPACES_FILE = registry
  const routes = new Map()
  const ctx = { effect: fn => fn(), get: () => undefined, webServer: { register: r => { routes.set(r.path, r.handler); return () => {} } }, tools: { register: () => () => {} } }
  const service = new RequirementsService(ctx, { root: a })
  let aiCalls = 0
  service.aiStreamFor = () => { aiCalls++; throw new Error('GET must not invoke AI') }
  const server = createServer((req, res) => routes.get(new URL(req.url, 'http://localhost').pathname)(req, res))
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  const request = async (params, body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${route}?${new URLSearchParams(params)}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {})
    return { status: response.status, payload: await response.json() }
  }
  try { await run({ a, b, outside, base, request, aiCalls: () => aiCalls }) }
  finally {
    await new Promise(done => server.close(done))
    if (previous === undefined) delete process.env.DSH_WORKSPACES_FILE
    else process.env.DSH_WORKSPACES_FILE = previous
    rmSync(base, { recursive: true, force: true })
  }
}

function seed(root, projectId, options = {}) {
  let session = core.createSession({ root, project: { id: projectId }, input: { text: 'Original intent', source: 'text' } })
  session.state = options.state ?? 'ready_for_confirmation'
  session.runs = options.unanalyzed ? [] : [{ analysisRunId: 'RUN-test', status: 'success', finishedAt: '2026-11-04T00:00:00Z' }]
  session.context = { contextSnapshotId: 'CTX-saved', projectId, queryStatus: 'ok' }
  session.items = [{ itemId: 'ITM-1', recommendedRoute: 'create', fields: { recommendedRoute: { source: 'human', value: 'change' } }, candidate: { title: 'Saved title', problem: 'Saved problem', goal: 'Saved goal', inScope: ['history'], outOfScope: ['new writes'], acceptance: [{ id: 'AC-01', text: 'Open saved intent', verify: 'Load via server', expected: 'Original fields visible', independentCheck: 'Compare persisted fields' }] }, unknowns: [{ unknownId: 'U-1', description: 'Unsupported scope', blocking: true, resolution: 'exclude', resolutionReason: 'Explicitly outside this requirement', resolved: true }] }]
  const state = session.state
  session.state = 'editing'
  session = core.setDocDraft({ session, docDraft: { goal: 'Saved draft goal', problem: 'Saved draft problem', scope: ['history'], outOfScope: ['new writes'], features: [{ id: 'FR-01', title: 'Open history', behavior: 'Load original intent', response: 'Fields restored', provenance: 'user-answer' }], acceptance: [{ id: 'AC-01', featureIds: ['FR-01'], text: 'Open saved intent', precondition: 'Project selected', action: 'Load intent', expected: 'Original fields visible', judgement: 'Compare saved bytes', provenance: 'user-answer' }] } })
  session.state = state
  session.receipt = options.receipt ?? null
  return core.saveSession({ root, session })
}

test('answer history pagination is bounded, scoped and rejects changed snapshots', async () => harness(async ({ a, request, aiCalls }) => {
  const session = seed(a, 'AA')
  session.answers = Array.from({ length: 45 }, (_, index) => ({ answerId: `ANS-${index}`, questionId: `Q-${index}`, text: `answer-${index}`, inputRevision: 0 }))
  core.saveSession({ root: a, session })
  const loaded = await request({ project: 'wa', session: session.sessionId })
  assert.equal(loaded.status, 200)
  assert.equal(loaded.payload.session.historicalAnswers.length, 20)
  const snapshot = loaded.payload.session.historicalAnswersSnapshot
  const params = { project: 'wa', session: session.sessionId, action: 'answer-history', offset: 20, snapshot }
  const page = await request(params)
  assert.equal(page.status, 200)
  assert.equal(page.payload.answers.length, 20)
  assert.equal(page.payload.answers[0].text, 'answer-24')
  assert.equal(page.payload.next, 40)
  assert.equal((await request({ ...params, offset: 40 })).payload.answers.length, 5)
  assert.equal((await request({ ...params, project: 'wb' })).status, 404)
  assert.equal((await request({ ...params, offset: 21 })).status, 400)
  session.answers.push({ answerId: 'ANS-new', questionId: 'Q-new', text: 'new', inputRevision: 0 })
  core.saveSession({ root: a, session })
  assert.equal((await request(params)).status, 409)
  assert.equal(aiCalls(), 0)
}))

test('real GET handler: project history is read-only, completed-only and loads latest same identity/fields', async () => harness(async ({ a, b, base, request, aiCalls }) => {
  const saved = seed(a, 'AA')
  const foreign = seed(b, 'BB')
  const wrongProjectInA = seed(a, 'BB')
  seed(a, 'AA', { unanalyzed: true, state: 'editing' })
  seed(a, 'AA', { state: 'analyzing' })
  const committed = seed(a, 'AA', { state: 'committed', receipt: { receiptId: 'RCP-original', artifacts: [{ kind: 'requirement', id: 'REQ-AA-001' }] } })
  const before = tree(base)
  const history = await request({ project: 'AA', action: 'history', root: a })
  assert.equal(history.status, 200, JSON.stringify(history.payload))
  assert.deepEqual(new Set(history.payload.sessions.map(s => s.sessionId)), new Set([saved.sessionId, committed.sessionId]))
  for (const row of history.payload.sessions) { assert.ok(row.updatedAt); assert.ok(row.state); assert.ok(row.sessionRevision) }
  const loaded = await request({ project: 'wa', session: saved.sessionId })
  assert.equal(loaded.status, 200, JSON.stringify(loaded.payload))
  assert.equal(loaded.payload.session.sessionId, saved.sessionId)
  assert.equal(loaded.payload.session.input.text, saved.input.text)
  const restored = loaded.payload.session
  assert.equal(restored.items[0].candidate.title, 'Saved title')
  assert.equal(restored.items[0].candidate.goal, 'Saved goal')
  assert.equal(restored.items[0].candidate.problem, 'Saved problem')
  assert.deepEqual(restored.items[0].candidate.inScope, ['history'])
  assert.deepEqual(restored.items[0].candidate.outOfScope, ['new writes'])
  assert.deepEqual(restored.items[0].candidate.acceptance[0], { id: 'AC-01', text: 'Open saved intent', verify: 'Load via server', expected: 'Original fields visible', independentCheck: 'Compare persisted fields' })
  assert.equal(restored.items[0].recommendedRoute, 'create')
  assert.equal(restored.items[0].effectiveRoute, 'change')
  assert.equal(restored.items[0].unknowns[0].resolution, 'exclude')
  assert.equal(restored.items[0].unknowns[0].resolutionReason, 'Explicitly outside this requirement')
  assert.equal(restored.docDraft.goal, 'Saved draft goal')
  assert.equal(restored.docDraft.acceptance[0].precondition, 'Project selected')
  assert.equal(restored.docDraft.acceptance[0].action, 'Load intent')
  assert.equal(restored.docDraft.acceptance[0].expected, 'Original fields visible')
  assert.equal(restored.docDraft.acceptance[0].judgement, 'Compare saved bytes')
  assert.equal(restored.docDraft.docHash, saved.docDraft.docHash)
  assert.equal(restored.draftRevision, saved.draftRevision)
  assert.deepEqual(tree(base), before, 'GET must not create/update INT, REQ, receipt, run, or any stored bytes')
  let latest = core.loadSession({ root: a, sessionId: saved.sessionId })
  latest.input.text = 'Saved newer input'; latest.sessionRevision += 1
  latest.items[0].candidate.title = 'Saved newer title'
  latest.items[0].candidate.acceptance[0] = { id: 'AC-01', text: 'Updated text', verify: 'Updated verification', expected: 'Updated result', independentCheck: 'Updated independent check' }
  latest.items[0].fields.recommendedRoute = { source: 'human', value: 'create' }
  latest.items[0].unknowns[0].resolutionReason = 'Updated human exclusion reason'
  latest = core.setDocDraft({ session: latest, docDraft: { goal: 'Updated draft goal' } })
  latest = core.saveSession({ root: a, session: latest })
  const again = await request({ project: 'AA', sessionId: saved.sessionId })
  assert.equal(again.payload.session.sessionRevision, latest.sessionRevision)
  assert.equal(again.payload.session.input.text, 'Saved newer input')
  assert.equal(again.payload.session.items[0].candidate.title, 'Saved newer title')
  assert.deepEqual(again.payload.session.items[0].candidate.acceptance[0], { id: 'AC-01', text: 'Updated text', verify: 'Updated verification', expected: 'Updated result', independentCheck: 'Updated independent check' })
  assert.equal(again.payload.session.items[0].effectiveRoute, 'create')
  assert.equal(again.payload.session.items[0].unknowns[0].resolutionReason, 'Updated human exclusion reason')
  assert.equal(again.payload.session.docDraft.goal, 'Updated draft goal')
  assert.equal(again.payload.session.docDraft.docHash, latest.docDraft.docHash)
  assert.equal(again.payload.session.draftRevision, latest.draftRevision)
  const running = seed(a, 'AA', { state: 'analyzing' })
  assert.equal((await request({ project: 'AA', session: running.sessionId })).payload.session.state, 'analyzing', 'load preserves polling for running sessions; only history filters them')
  const committedBefore = tree(base)
  for (let i = 0; i < 2; i++) {
    const opened = await request({ project: 'AA', session: committed.sessionId })
    assert.equal(opened.payload.session.state, 'committed')
    assert.deepEqual(opened.payload.session.receipt, committed.receipt)
  }
  assert.deepEqual(tree(base), committedBefore)
  for (const id of [foreign.sessionId, wrongProjectInA.sessionId]) {
    assert.equal((await request({ project: 'AA', session: id })).status, 404)
  }
  assert.equal(aiCalls(), 0)
}))

test('real GET handler rejects missing/unknown projects, arbitrary roots, invalid IDs and conflicting queries without creating drafts', async () => harness(async ({ a, b, outside, base, request }) => {
  const before = tree(base)
  for (const [params, status] of [
    [{ root: a, action: 'history' }, 400],
    [{ project: 'ALL', action: 'history' }, 404],
    [{ project: 'AA', root: outside, action: 'history' }, 403],
    [{ project: 'AA', root: b, action: 'history' }, 403],
    [{ project: 'AA', root: `${a}/../a`, action: 'history' }, 403],
    [{ project: 'AA', session: '../../etc' }, 404],
    [{ project: 'AA', session: 'INT-20261104000000-abcdef' }, 404],
    [{ project: 'AA', session: 'INT-20261104000000-abcdef', sessionId: 'other' }, 400],
    [{ project: 'AA', action: 'unknown' }, 400],
    [{ project: 'AA', action: 'history', extra: 'bad' }, 400],
  ]) {
    const result = await request(params)
    assert.equal(result.status, status, JSON.stringify({ params, result }))
    assert.equal(result.payload.ok, false)
    assert.ok(result.payload.error.message)
  }
  assert.deepEqual(tree(base), before)
}))

test('restored sessions retain stale-input and committed mutation guards', async () => harness(async ({ a, request }) => {
  const saved = seed(a, 'AA')
  const loaded = await request({ project: 'AA', session: saved.sessionId })
  const stale = await request({ project: 'AA' }, { action: 'edit', sessionId: saved.sessionId, expectedInputRevision: loaded.payload.session.input.inputRevision - 1, itemId: 'ITM-1', fields: { title: 'wrong' } })
  assert.equal(stale.status, 409)
  assert.equal(stale.payload.error.code, 'stale-input')
  const confirm = { action: 'confirm', sessionId: saved.sessionId, expectedInputRevision: saved.input.inputRevision, expectedSessionRevision: saved.sessionRevision, contextSnapshotId: 'CTX-saved', docHash: saved.docDraft.docHash, draftRevision: saved.draftRevision, idempotencyKey: 'history-gate-test', confirmation: { route: 'create', items: [{ itemId: 'ITM-1', route: 'create' }], priority: 'P1' } }
  for (const [patch, code] of [
    [{ expectedInputRevision: saved.input.inputRevision - 1 }, 'stale-input'],
    [{ expectedSessionRevision: saved.sessionRevision - 1 }, 'stale-session'],
    [{ contextSnapshotId: 'CTX-old' }, 'stale-context'],
    [{ docHash: 'outdated-hash' }, 'draft-changed'],
    [{ draftRevision: saved.draftRevision - 1 }, 'draft-changed'],
  ]) {
    const rejected = await request({ project: 'AA' }, { ...confirm, ...patch })
    assert.equal(rejected.status, 409, JSON.stringify(rejected.payload))
    assert.equal(rejected.payload.error.code, code)
  }
  const unconfirmed = core.evaluateReadiness({ session: core.loadSession({ root: a, sessionId: saved.sessionId }), contextNow: saved.context, project: 'AA', requireConfirmation: true })
  assert.ok(unconfirmed.reasons.some(reason => reason.code === 'not-confirmed'), 'opening history does not confer human confirmation')
  const blocked = core.loadSession({ root: a, sessionId: saved.sessionId })
  blocked.items[0].unknowns = [{ unknownId: 'U-block', description: 'Still unknown', blocking: true, resolution: null }]
  const readiness = core.evaluateReadiness({ session: blocked, contextNow: blocked.context, project: 'AA', requireConfirmation: false })
  assert.ok(readiness.reasons.some(reason => reason.code === 'unresolved-blocking-unknown'), 'history restoration does not exempt blocking unknowns')
  const committed = seed(a, 'AA', { state: 'committed', receipt: { receiptId: 'RCP-original' } })
  await request({ project: 'AA', session: committed.sessionId })
  const edit = await request({ project: 'AA' }, { action: 'edit', sessionId: committed.sessionId, expectedInputRevision: committed.input.inputRevision, itemId: 'ITM-1', fields: { title: 'wrong' } })
  assert.equal(edit.status, 409)
  assert.equal(edit.payload.error.code, 'already-committed')
}))
