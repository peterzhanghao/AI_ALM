import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { createRun, readRun, runPath, updateRun } from '../../alm-core/src/requirements/run.mjs'
import { observeRun, observeUsage, recordLiveFrame, settleLiveFrame } from '../run-observation.mjs'
import RequirementsService from '../index.js'
import { writeAiReviewUsage } from '../ai-review.mjs'
import { requirements } from '../query.mjs'

test('usage reports only validated direct-child catalog counts without exposing identities', async () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-usage-children-'))
  try {
    const run = createRun({ root, requirementId: 'REQ-A', carrier: 'dsh-session', sessionId: 'parent' }).run
    const fetchImpl = async () => ({ ok: true, json: async () => ({ sessions: [{ id: 'parent', hasLedger: true, inputTokens: 12 }] }) })
    for (const [catalog, expected] of [[[{ id: 'child-a' }, { id: 'child-b' }], 2], [[], 0], [[{ id: 'same' }, { id: 'same' }], null], [[{}], null], [null, null]]) {
      let disposed = false
      const ctx = { get: name => name === 'sessionQuery' ? { observeSession: async () => ({ projections: { values: { subagentCatalog: catalog } }, [Symbol.dispose]() { disposed = true } }) } : null }
      const result = await observeUsage({ ctx, root, requirementId: 'REQ-A', runId: run.id, fetchImpl })
      assert.equal(result.directChildren, expected)
      assert.equal(result.inputTokens, 12)
      assert.equal(disposed, true)
      assert.doesNotMatch(JSON.stringify(result), /child-a|child-b/)
    }
    const ctx = { get: name => name === 'sessionQuery' ? { observeSession: async () => ({ projections: { values: { subagentCatalog: [{ id: 'external', mode: 'external' }] } }, [Symbol.dispose]() {} }) } : null }
    const unavailable = await observeUsage({ ctx, root, requirementId: 'REQ-A', runId: run.id, fetchImpl: async () => { throw new Error('offline') } })
    assert.equal(unavailable.status, 'unknown')
    assert.equal(unavailable.directChildren, 1)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('timeline HTTP reads only the requested requirement and checks the snapshot', async () => {
  const root = fileURLToPath(new URL('../../../fixtures/order-refund', import.meta.url))
  const item = requirements(root).requirements.find(entry => entry.id === 'REQ-PAY-001')
  const timeline = item.detailView.record.timeline
  assert.ok(timeline.length > 0 && item.detailView.record.timelineOmitted === 0)
  const fingerprint = createHash('sha256').update(JSON.stringify(timeline)).digest('hex')
  const service = Object.create(RequirementsService.prototype)
  service.rootFor = () => root
  service.ctx = { get: () => null }
  async function request(query) {
    let status, body
    await service.handleRunObservation({ method: 'GET', url: `/api/alm/requirements/run-observation?${query}` }, { writeHead(code) { status = code }, end(value) { body = JSON.parse(value) } })
    return { status, body }
  }
  const args = `mode=timeline&requirementId=REQ-PAY-001&before=${timeline.length}&fingerprint=${fingerprint}`
  const result = await request(args)
  assert.equal(result.status, 200)
  assert.deepEqual(result.body.entries, timeline)
  assert.equal(result.body.next, null)
  assert.equal((await request(args.replace(fingerprint, '0'.repeat(64)))).status, 409)
  assert.equal((await request(args.replace('REQ-PAY-001', 'REQ-OTHER'))).status, 404)
  assert.equal((await request(args.replace('REQ-PAY-001', '..%2Foutside'))).status, 400)
  service.rootFor = () => { throw new Error('must not query invalid cursor') }
  assert.equal((await request(args.replace(fingerprint, 'invalid'))).status, 400)
  assert.equal((await request(args.replace(`before=${timeline.length}`, 'before=0'))).status, 400)
  service.rootFor = () => join(root, 'missing-workspace')
  const unavailable = await request(args)
  assert.equal(unavailable.status, 503)
  assert.equal(unavailable.body.error.code, 'timeline-source-unavailable')
  assert.doesNotMatch(JSON.stringify(unavailable.body), /missing-workspace/)
  service.ctx = { get: name => name === 'connection' ? { admit: () => ({ rejection: 401 }) } : null }
  assert.equal((await request(args)).status, 401)
})

test('observes only the bound run, pages live events and reports missing usage', async () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-observe-'))
  try {
    const run = createRun({ root, requirementId: 'REQ-A', carrier: 'dsh-session', sessionId: 'session-a' }).run
    const events = [
      { seq: 0, type: 'user/message', data: { content: [{ type: 'text', text: 'Implement this' }, { type: 'image', data: 'private' }] } },
      { seq: 1, type: 'tool/call', data: { name: 'shell', arguments: 'api_key=secret123' } },
      { seq: 2, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'Done' }, { type: 'reasoning', text: 'Visible summary' }] } } },
    ]
    const ctx = { get: (name) => name === 'sessionQuery' ? { readSession: async (id) => ({ events: id === 'session-a' ? events : [] }) } : null }
    const page = await observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id, limit: 2 })
    assert.deepEqual(page.events.map((entry) => entry.kind), ['input', 'tool-call'])
    assert.equal(page.events[1].status, 'called')
    assert.equal(page.events[0].nonTextBlocks, 1)
    assert.doesNotMatch(JSON.stringify(page.events[0]), /private/)
    assert.doesNotMatch(page.events[1].text, /secret123/)
    assert.deepEqual(page.next, { segment: 0, after: 1 })
    assert.equal(page.usage.status, 'unknown')
    const next = await observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id, after: page.next.after })
    assert.equal(next.events[0].reasoning, 'Visible summary')
    assert.equal(next.next, null)
    await assert.rejects(observeRun({ ctx, root, requirementId: 'REQ-B', runId: run.id }), { code: 'run-not-found' })
    await assert.rejects(observeRun({ ctx, root, requirementId: 'REQ-A', runId: '../outside' }), { code: 'run-id-invalid' })
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('an unbound run accepts only its initial session segment', async () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-observe-unbound-'))
  try {
    const run = createRun({ root, requirementId: 'REQ-A', carrier: 'dsh-session' }).run
    const args = { root, requirementId: 'REQ-A', runId: run.id }
    assert.equal((await observeRun(args)).source, 'no-session')
    assert.equal((await observeRun({ ...args, liveOnly: true })).live, null)
    assert.equal((await observeUsage(args)).reason, 'session-unavailable')
    for (const observe of [observeRun, options => observeRun({ ...options, liveOnly: true }), observeUsage]) {
      await assert.rejects(observe({ ...args, segment: 1 }), { code: 'cursor-invalid', status: 400 })
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})

for (const interruption of ['heartbeat-lost', 'host-restart']) test(`observation keeps ${interruption} associated with the interrupted session`, async () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-observe-interrupted-'))
  try {
    const run = createRun({ root, requirementId: 'REQ-A', carrier: 'dsh-session', sessionId: 's' }).run
    const ctx = { get: name => name === 'sessionQuery' ? { readSession: async () => ({ events: [] }) } : null }
    const args = { ctx, root, requirementId: 'REQ-A', runId: run.id }
    assert.equal((await observeRun(args)).interruptedOutputPossible, false)
    updateRun({ root, runId: run.id, status: 'failed', failure: { code: interruption, message: 'lost' }, apply: true })
    assert.equal((await observeRun(args)).interruptedOutputPossible, true)
    const persisted = readRun(root, run.id)
    const legacy = { ...persisted }
    delete legacy.interruptedSessions
    writeFileSync(runPath(root, run.id), JSON.stringify(legacy))
    assert.equal((await observeRun(args)).interruptedOutputPossible, true)
    updateRun({ root, runId: run.id, failure: { code: 'OTHER_FAILURE' }, apply: true })
    assert.equal((await observeRun(args)).interruptedOutputPossible, true)
    writeFileSync(runPath(root, run.id), JSON.stringify(persisted))
    updateRun({ root, runId: run.id, status: 'running', sessionId: 'resumed', apply: true })
    updateRun({ root, runId: run.id, status: 'failed', failure: { code: 'OTHER_FAILURE' }, apply: true })
    assert.equal((await observeRun(args)).interruptedOutputPossible, true)
    assert.equal((await observeRun({ ...args, segment: 1 })).interruptedOutputPossible, false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('tool results use only unique earlier calls from the same session', async () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-observe-tool-link-'))
  try {
    const run = createRun({ root, requirementId: 'REQ-A', carrier: 'dsh-session', sessionId: 's' }).run
    const call = (seq, callId, name) => ({ seq, type: 'tool/call', data: { callId, name } })
    const result = (seq, callId, sourceId = callId) => ({ seq, type: 'tool/result', data: { message: { toolCallId: callId, source: { kind: 'tool', callId: sourceId }, content: [{ type: 'text', text: 'result' }] } } })
    const events = [call(0, 'a', 'read'), call(1, 'b', 'shell'), result(2, 'b'), result(3, 'a'), call(4, 'dup', 'first'), result(5, 'dup'), call(6, 'dup', 'second'), result(7, 'a', 'b'), result(8, 'future'), call(9, 'future', 'later')]
    const ctx = { get: name => name === 'sessionQuery' ? { readSession: async () => ({ events }) } : null }
    const page = await observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id, after: 1, limit: 2 })
    assert.deepEqual(page.events.map(event => event.name), ['shell', 'read'])
    assert.deepEqual(page.events.map(event => event.callId), ['b', 'a'])
    const detail = await observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id, eventSeq: 3 })
    assert.equal(detail.detail.name, 'read')
    assert.equal(detail.detail.callId, 'a')
    const all = await observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id })
    for (const seq of [5, 7, 8]) assert.equal(all.events.find(event => event.seq === seq).name, null)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a later duplicate tool call invalidates the displayed result association', async () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-observe-tool-replay-'))
  try {
    const run = createRun({ root, requirementId: 'REQ-A', carrier: 'dsh-session', sessionId: 's' }).run
    const events = [
      { seq: 0, type: 'tool/call', data: { callId: 'call', name: 'read' } },
      { seq: 1, type: 'tool/result', data: { message: { toolCallId: 'call', source: { kind: 'tool', callId: 'call' }, content: 'done' } } },
    ]
    const ctx = { get: name => name === 'sessionQuery' ? { readSession: async () => ({ events }) } : null }
    const first = await observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id })
    assert.equal(first.events[1].name, 'read')
    events.push({ seq: 2, type: 'tool/call', data: { callId: 'other', name: 'shell' } })
    const appended = await observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id, after: first.lastSeq, prefixHash: first.prefixHash })
    assert.notEqual(appended.historyChanged, true)
    assert.equal(appended.events[0].name, 'shell')
    events.push({ seq: 3, type: 'tool/call', data: { callId: 'call', name: 'shell' } })
    const changed = await observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id, after: first.lastSeq, prefixHash: first.prefixHash })
    assert.equal(changed.historyChanged, true)
    const detail = await observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id, eventSeq: 1, eventHash: first.events[1].eventHash })
    assert.equal(detail.detail.name, null)
    assert.equal(detail.detail.text, first.events[1].text)
    const replay = await observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id })
    assert.equal(replay.events[1].name, null)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('pagination deduplicates identical sequences and rejects conflicting records', async () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-observe-sequences-'))
  try {
    const run = createRun({ root, requirementId: 'REQ-A', carrier: 'dsh-session', sessionId: 's' }).run
    const event = seq => ({ seq, type: 'user/message', data: { content: [{ type: 'text', text: `message-${seq}` }] } })
    let events = [event(0), event(0), event(1), event(2)]
    const ctx = { get: name => name === 'sessionQuery' ? { readSession: async () => ({ events }) } : null }
    const first = await observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id, limit: 1 })
    assert.deepEqual(first.events.map(entry => entry.seq), [0])
    const second = await observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id, limit: 1, after: first.next.after })
    assert.deepEqual(second.events.map(entry => entry.seq), [1])
    const third = await observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id, limit: 1, after: second.next.after })
    assert.deepEqual(third.events.map(entry => entry.seq), [2])
    assert.equal(third.next, null)
    events = [event(0), { ...event(0), type: 'tool/call' }]
    await assert.rejects(observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id }), { code: 'event-sequence-conflict', status: 502 })
    await assert.rejects(observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id, eventSeq: 0 }), { code: 'event-sequence-conflict' })
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('malformed events cannot silently disappear from a session history', async () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-observe-invalid-'))
  try {
    const run = createRun({ root, requirementId: 'REQ-A', carrier: 'dsh-session', sessionId: 's' }).run
    let events = []
    const ctx = { get: name => name === 'sessionQuery' ? { readSession: async () => ({ events }) } : null }
    for (const invalid of [null, { type: 'user/message' }, { seq: -1, type: 'user/message' }, { seq: 1 }, { seq: 1, type: '' }]) {
      events = [{ seq: 0, type: 'user/message', data: { content: 'valid' } }, invalid]
      await assert.rejects(observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id }), { code: 'event-invalid', status: 502 })
    }
    events = [{ seq: 0, type: 'future/event', data: {} }]
    const result = await observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id })
    assert.equal(result.events[0].kind, 'other')
    assert.equal(result.events[0].name, 'future/event')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a changed event prefix requires replay before advancing the cursor', async () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-observe-replay-'))
  try {
    const run = createRun({ root, requirementId: 'REQ-A', carrier: 'dsh-session', sessionId: 's' }).run
    const event = (seq, text = `message-${seq}`) => ({ seq, type: 'user/message', data: { content: text } })
    let events = [event(0), event(2)]
    const ctx = { get: name => name === 'sessionQuery' ? { readSession: async () => ({ events }) } : null }
    const first = await observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id })
    events = [event(0), event(1), event(2), event(3)]
    const changed = await observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id, after: first.lastSeq, prefixHash: first.prefixHash })
    assert.equal(changed.historyChanged, true)
    assert.deepEqual(changed.events, [])
    const replay = await observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id })
    assert.deepEqual(replay.events.map(entry => entry.seq), [0, 1, 2, 3])
    events[1] = event(1, 'corrected')
    assert.equal((await observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id, after: replay.lastSeq, prefixHash: replay.prefixHash })).historyChanged, true)
    await assert.rejects(observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id, after: 2, prefixHash: 'invalid' }), { code: 'cursor-invalid' })
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('reads a recovered persisted session and closes the host handle', async () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-observe-'))
  try {
    const run = createRun({ root, requirementId: 'REQ-A', carrier: 'dsh-session', sessionId: 'old' }).run
    updateRun({ root, runId: run.id, sessionId: 'new', apply: true })
    let closed = 0
    const ctx = { get(name) { return name === 'sessionPersistence' ? { async open(id, mode) {
      assert.equal(id, 'new'); assert.equal(mode, 'read')
      return { async read() { return { events: [{ seq: 7, type: 'tool/result', data: { message: { content: [{ type: 'text', text: 'passed' }] } } }] } }, async close() { closed++ } }
    } } : null } }
    const result = await observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id, segment: 1 })
    assert.equal(result.source, 'persisted')
    assert.equal(result.events[0].text, 'passed')
    assert.equal(closed, 1)
    const unavailable = await observeRun({ ctx: { get: () => null }, root, requirementId: 'REQ-A', runId: run.id })
    assert.equal(unavailable.source, 'unavailable')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('prefers the host observation lease and releases its cached snapshot', async () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-observe-lease-'))
  try {
    const run = createRun({ root, requirementId: 'REQ-A', carrier: 'dsh-session', sessionId: 's' }).run
    let disposed = 0, reads = 0
    const ctx = { get(name) {
      if (name !== 'sessionQuery') return null
      return { async observeSession(id, options) {
        assert.equal(id, 's'); assert.deepEqual(options, { projectionMode: 'none' }); reads++
        return { events: [{ seq: 4, type: 'user/message', data: { content: 'cached' } }], [Symbol.dispose]() { disposed++ } }
      }, readSession: async () => { throw new Error('must use observation lease') } }
    } }
    const result = await observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id })
    assert.equal(result.source, 'session-observation')
    assert.equal(result.events[0].text, 'cached')
    assert.equal(reads, 1)
    assert.equal(disposed, 1)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('query failures fall back to validated persistence and distinguish corrupt logs', async () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-observe-corrupt-'))
  try {
    const run = createRun({ root, requirementId: 'REQ-A', carrier: 'dsh-session', sessionId: 's' }).run
    let corrupt = false, closed = 0
    const ctx = { get(name) {
      if (name === 'sessionQuery') return { async readSession() { throw new Error('unavailable') } }
      if (name === 'sessionPersistence') return { async open() {
        if (corrupt) throw Object.assign(new Error('bad record'), { name: 'SessionPersistenceCorruptionError' })
        return { async read() { return { events: [{ seq: 0, type: 'user/message', data: { content: 'recoverable' } }] } }, async close() { closed++ } }
      } }
      return null
    } }
    const recovered = await observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id })
    assert.equal(recovered.source, 'persisted')
    assert.equal(recovered.events[0].text, 'recoverable')
    assert.equal(closed, 1)
    corrupt = true
    const damaged = await observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id })
    assert.equal(damaged.source, 'corrupt')
    assert.deepEqual(damaged.events, [])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('malformed persisted events are unavailable, while an empty array is valid', async () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-observe-malformed-'))
  try {
    const run = createRun({ root, requirementId: 'REQ-A', carrier: 'dsh-session', sessionId: 's' }).run
    let payload = { events: null }, closed = 0
    const ctx = { get: name => name === 'sessionPersistence' ? { async open() { return {
      async read() { return payload }, async close() { closed++ },
    } } } : null }
    const missing = await observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id })
    assert.equal(missing.source, 'unavailable')
    assert.deepEqual(missing.events, [])
    payload = { events: [] }
    const empty = await observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id })
    assert.equal(empty.source, 'persisted')
    assert.deepEqual(empty.events, [])
    assert.equal(closed, 2)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('persistence close failures do not hide corruption or claim a complete read', async () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-observe-close-'))
  try {
    const run = createRun({ root, requirementId: 'REQ-A', carrier: 'dsh-session', sessionId: 's' }).run
    let corrupt = false
    const ctx = { get: name => name === 'sessionPersistence' ? { async open() { return {
      async read() {
        if (corrupt) throw Object.assign(new Error('bad record'), { name: 'SessionPersistenceCorruptionError' })
        return { events: [{ seq: 0, type: 'user/message', data: { content: 'unconfirmed read' } }] }
      },
      async close() { throw new Error('close failed') },
    } } } : null }
    const failedClose = await observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id })
    assert.equal(failedClose.source, 'unavailable')
    assert.deepEqual(failedClose.events, [])
    corrupt = true
    const damaged = await observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id })
    assert.equal(damaged.source, 'corrupt')
    assert.deepEqual(damaged.events, [])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('long event details are paged only through the run-owned session', async () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-observe-'))
  try {
    const run = createRun({ root, requirementId: 'REQ-A', carrier: 'dsh-session', sessionId: 's' }).run
    let text = 'a'.repeat(4000) + 'tail'
    const ctx = { get: name => name === 'sessionQuery' ? { readSession: async () => ({ events: [{ seq: 3, type: 'assistant/message', data: { message: { content: [{ type: 'text', text }] } } }] }) } : null }
    const first = await observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id })
    assert.equal(first.events[0].truncated, true)
    const eventHash = first.events[0].eventHash
    const next = await observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id, eventSeq: 3, offset: 4000, eventHash })
    assert.equal(next.detail.text, 'tail')
    assert.equal(next.detail.truncated, false)
    text = 'a'.repeat(3999) + '\u{1F600}' + 'tail'
    const unicodeFirst = await observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id })
    assert.equal(unicodeFirst.events[0].text.length, 3999)
    assert.equal(unicodeFirst.events[0].truncated, true)
    const unicodeNext = await observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id, eventSeq: 3, offset: unicodeFirst.events[0].text.length, eventHash: unicodeFirst.events[0].eventHash })
    assert.equal(unicodeFirst.events[0].text + unicodeNext.detail.text, text)
    assert.equal(unicodeNext.detail.truncated, false)
    text = 'b'.repeat(4000) + 'changed'
    await assert.rejects(observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id, eventSeq: 3, offset: 4000, eventHash }), { code: 'event-changed' })
    await assert.rejects(observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id, eventSeq: 3, eventHash: 'invalid' }), { code: 'cursor-invalid' })
    await assert.rejects(observeRun({ ctx, root, requirementId: 'REQ-B', runId: run.id, eventSeq: 3 }), { code: 'run-not-found' })
    await assert.rejects(observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id, eventSeq: 4 }), { code: 'event-not-found' })
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('reply and reasoning continue independently at their own Unicode-safe offsets', async () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-observe-dual-fields-'))
  try {
    const run = createRun({ root, requirementId: 'REQ-A', carrier: 'dsh-session', sessionId: 's' }).run
    const text = 'a'.repeat(3999) + '\u{1F600}' + 'text-tail'
    const reasoning = 'b'.repeat(4000) + '\u{1F680}' + 'reasoning-tail'
    const events = [{ seq: 1, type: 'assistant/message', data: { message: { content: [{ type: 'text', text }, { type: 'reasoning', text: reasoning }] } } }]
    const ctx = { get: name => name === 'sessionQuery' ? { readSession: async () => ({ events }) } : null }
    const args = { ctx, root, requirementId: 'REQ-A', runId: run.id }
    const first = (await observeRun(args)).events[0]
    assert.equal(first.truncated, true)
    assert.equal(first.reasoningTruncated, true)
    assert.notEqual(first.text.length, first.reasoning.length)
    const textNext = await observeRun({ ...args, eventSeq: first.seq, offset: first.text.length, eventHash: first.eventHash })
    const reasoningNext = await observeRun({ ...args, eventSeq: first.seq, offset: first.reasoning.length, eventHash: first.eventHash })
    assert.equal(first.text + textNext.detail.text, text)
    assert.equal(first.reasoning + reasoningNext.detail.reasoning, reasoning)
    assert.equal(textNext.detail.truncated, false)
    assert.equal(reasoningNext.detail.reasoningTruncated, false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('readSession corruption remains visible without a persistence fallback', async () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-observe-query-corrupt-'))
  try {
    const run = createRun({ root, requirementId: 'REQ-A', carrier: 'dsh-session', sessionId: 's' }).run
    for (const error of [
      Object.assign(new Error('corrupt'), { code: 'SESSION_QUERY_CORRUPT_SESSION' }),
      Object.assign(new Error('corrupt'), { name: 'SessionPersistenceCorruptionError' }),
    ]) {
      const ctx = { get: name => name === 'sessionQuery' ? { readSession: async () => { throw error } } : null }
      const result = await observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id })
      assert.equal(result.source, 'corrupt')
      assert.deepEqual(result.events, [])
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('structured tool arguments and token-shaped text use shared secret redaction', async () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-observe-redaction-'))
  try {
    const run = createRun({ root, requirementId: 'REQ-A', carrier: 'dsh-session', sessionId: 's' }).run
    const ctx = { get: name => name === 'sessionQuery' ? { readSession: async () => ({ events: [
      { seq: 1, type: 'tool/call', data: { name: 'shell', arguments: JSON.stringify({ nested: { cookie: 'secret-cookie', credential: 'secret-credential' }, command: 'sk-123456789abcdefgh' }) } },
      { seq: 2, type: 'user/message', data: { content: [{ type: 'text', text: 'password="several secret words"' }] } },
      { seq: 3, type: 'tool/call', data: { name: 'authorization=BasicSecret', arguments: '' } },
      { seq: 4, type: 'plugin/sk-123456789abcdefgh', data: {} },
      { seq: 5, type: 'tool/result', data: { content: 'Authorization: Basic dXNlcjpwYXNz' } },
      { seq: 6, type: 'tool/call', data: { name: 'read', arguments: { path: 'src/example.js', nested: { password: 'object-secret' } } } },
      { seq: 7, type: 'tool/result', data: { content: 'Cookie: session=first-secret; auth=second-secret\nContent-Type: text/plain\nSet-Cookie: token=third-secret; Path=/; extra=fourth-secret' } },
      { seq: 8, type: 'tool/result', data: { content: 'Cookie=session=fifth-secret; auth=sixth-secret\nNext: visible' } },
    ] }) } : null }
    const result = await observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id })
    assert.doesNotMatch(result.events.find(event => event.seq === 8).text, /fifth-secret|sixth-secret/)
    assert.match(result.events.find(event => event.seq === 8).text, /Next: visible/)
    assert.doesNotMatch(result.events[0].text, /secret-cookie|secret-credential|sk-123456789abcdefgh/)
    assert.match(result.events[0].text, /\[redacted\]/)
    assert.doesNotMatch(result.events[1].text, /several secret words/)
    assert.doesNotMatch(result.events[2].name, /BasicSecret/)
    assert.doesNotMatch(result.events[3].name, /sk-123456789abcdefgh/)
    assert.doesNotMatch(result.events[4].text, /dXNlcjpwYXNz/)
    assert.match(result.events[5].text, /src\/example\.js/)
    assert.doesNotMatch(result.events[5].text, /object-secret/)
    assert.doesNotMatch(result.events[6].text, /first-secret|second-secret|third-secret|fourth-secret/)
    assert.match(result.events[6].text, /Content-Type: text\/plain/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('redacts credentials before paging and hides interrupted credential prefixes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-observe-page-redaction-'))
  try {
    const run = createRun({ root, requirementId: 'REQ-A', carrier: 'dsh-session', sessionId: 's' }).run
    const text = 'a'.repeat(3995) + ' sk-123456789abcdefgh end'
    const ctx = { get: name => name === 'sessionQuery' ? { readSession: async () => ({ events: [
      { seq: 1, type: 'assistant/message', data: { message: { content: [{ type: 'text', text }] } } },
      { seq: 2, type: 'assistant/attempt', data: { stream: [
        { type: 'text-chunks', texts: ['partial sk-123'] },
        { type: 'reasoning-chunks', texts: ['partial ghp_abc'] },
      ] } },
      { seq: 3, type: 'tool/result', data: { content: 'a'.repeat(3995) + ' Cookie: first=secret-one; second=secret-two\nNext: safe' } },
    ] }) } : null }
    const first = await observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id })
    const entry = first.events[0]
    const next = await observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id, eventSeq: 1, offset: entry.text.length, eventHash: entry.eventHash })
    const combined = entry.text + next.detail.text
    assert.doesNotMatch(combined, /sk-123456789abcdefgh/)
    assert.match(combined, /\[redacted\] end$/)
    assert.doesNotMatch(first.events[1].text, /sk-123/)
    assert.doesNotMatch(first.events[1].reasoning, /ghp_abc/)
    const cookie = first.events[2]
    const continued = await observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id, eventSeq: 3, offset: cookie.text.length, eventHash: cookie.eventHash })
    const cookieText = cookie.text + continued.detail.text
    assert.doesNotMatch(cookieText, /secret-one|secret-two/)
    assert.match(cookieText, /Next: safe/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('failed attempts and tool errors do not read as successful replies', async () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-observe-failure-'))
  try {
    const run = createRun({ root, requirementId: 'REQ-A', carrier: 'dsh-session', sessionId: 's' }).run
    const ctx = { get: name => name === 'sessionQuery' ? { readSession: async () => ({ events: [
      { seq: 0, type: 'assistant/attempt', data: { stream: [{ type: 'text-chunks', texts: ['partial'] }, { type: 'reasoning-chunks', texts: ['visible'] }] } },
      { seq: 1, type: 'tool/result', data: { message: { isError: true, content: [{ type: 'text', text: 'failed' }, { type: 'image', data: 'image-payload' }] } } },
      { seq: 2, type: 'plugin/unrecognized', data: { secret: 'hidden-payload' } },
      { seq: 3, type: 'assistant/attempt', data: { stream: [{ type: 'chunk', chunk: { type: 'finish', reason: { kind: 'error', failure: { code: 'MISSING_CREDENTIAL', message: 'private detail' } } } }] } },
      { seq: 4, type: 'assistant/attempt', data: { stream: [{ type: 'chunk', chunk: { type: 'finish', reason: { kind: 'error' } } }] } },
    ] }) } : null }
    const result = await observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id })
    assert.equal(result.events[0].status, 'interrupted')
    assert.equal(result.events[0].reasoning, 'visible')
    assert.equal(result.events[1].status, 'failed')
    assert.equal(result.events[1].nonTextBlocks, 1)
    assert.doesNotMatch(JSON.stringify(result.events[1]), /image-payload/)
    assert.equal(result.events[2].kind, 'other')
    assert.doesNotMatch(JSON.stringify(result.events[2]), /hidden-payload/)
    assert.equal(result.events[3].status, 'failed')
    assert.match(result.events[3].text, /凭据不可用/)
    assert.doesNotMatch(JSON.stringify(result.events[3]), /private detail/)
    assert.equal(result.events[4].status, 'failed')
    assert.match(result.events[4].text, /模型调用失败/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('HTTP observation derives sessions from the requested requirement and rejects invalid methods and cursors', async () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-observe-http-'))
  try {
    const run = createRun({ root, requirementId: 'REQ-A', carrier: 'dsh-session', sessionId: 's' }).run
    const service = Object.create(RequirementsService.prototype)
    service.rootFor = () => root
    service.ctx = { get: name => name === 'sessionQuery' ? { readSession: async () => ({ events: [{ seq: 0, type: 'user/message', data: { content: [{ type: 'text', text: 'hello' }] } }] }) } : null }
    async function request(method, query) {
      let status, body
      await service.handleRunObservation({ method, url: `/api/alm/requirements/run-observation?${query}` }, { writeHead(code) { status = code }, end(value) { body = JSON.parse(value) } })
      return { status, body }
    }
    assert.equal((await request('POST', 'requirementId=REQ-A')).status, 405)
    assert.equal((await request('GET', `requirementId=REQ-B&runId=${run.id}`)).status, 404)
    assert.equal((await request('GET', `requirementId=REQ-A&runId=${run.id}&segment=-1`)).status, 400)
    const list = await request('GET', 'mode=list&requirementId=REQ-A')
    assert.deepEqual(list.body.runs.map(entry => entry.id), [run.id])
    const history = await request('GET', 'mode=history&requirementId=REQ-A')
    assert.deepEqual(history.body.runs.map(entry => entry.id), [run.id])
    assert.equal(history.body.next, null)
    assert.equal((await request('GET', 'mode=history&requirementId=REQ-A&before=..%2Fbad')).status, 400)
    service.reviewContext = (_root, id) => { if (id !== 'REQ-A') throw Object.assign(new Error('missing'), { status: 404 }) }
    writeAiReviewUsage(root, { requirement: 'REQ-A', provider: 'test', model: 'model', startedAt: new Date().toISOString(), status: 'failed' })
    assert.equal((await request('GET', 'mode=review-usage&requirementId=REQ-A')).body.records.length, 1)
    assert.equal((await request('GET', 'mode=review-usage&requirementId=REQ-B')).status, 404)
    assert.equal((await request('GET', 'mode=review-usage&requirementId=..%2Foutside')).status, 400)
    const data = await request('GET', `requirementId=REQ-A&runId=${run.id}`)
    assert.equal(data.body.events[0].text, 'hello')
    assert.equal((await request('GET', `requirementId=REQ-A&runId=${run.id}&eventSeq=0&eventHash=${data.body.events[0].eventHash}`)).status, 200)
    assert.equal((await request('GET', `requirementId=REQ-A&runId=${run.id}&eventSeq=0&eventHash=${'0'.repeat(64)}`)).status, 409)
    assert.equal((await request('GET', `requirementId=REQ-A&runId=${run.id}&after=0&prefixHash=${data.body.prefixHash}`)).body.historyChanged, undefined)
    assert.equal((await request('GET', `requirementId=REQ-A&runId=${run.id}&after=0&prefixHash=${'0'.repeat(64)}`)).body.historyChanged, true)
    const unbound = createRun({ root, requirementId: 'REQ-A', carrier: 'dsh-session' }).run
    const usage = await request('GET', `mode=usage&requirementId=REQ-A&runId=${unbound.id}&segment=0`)
    assert.equal(usage.status, 200)
    assert.deepEqual({ requirementId: usage.body.requirementId, runId: usage.body.runId, segment: usage.body.segment }, { requirementId: 'REQ-A', runId: unbound.id, segment: 0 })
    assert.equal(usage.body.usage.status, 'unknown')
    assert.equal((await request('GET', `mode=usage&requirementId=REQ-B&runId=${unbound.id}`)).status, 404)
    service.ctx = { get: name => name === 'connection' ? { admit: () => ({ rejection: 401 }) } : null }
    const denied = await request('GET', `requirementId=REQ-A&runId=${run.id}`)
    assert.equal(denied.status, 401)
    assert.equal(denied.body.error.code, 'unauthenticated-subject')
    assert.equal((await request('GET', 'mode=review-usage&requirementId=REQ-A')).status, 401)
    service.ctx = { get: name => name === 'connection' ? { admit: () => ({ peer: { principal: { kind: 'agent', id: 'agent:test' } } }) } : null }
    assert.equal((await request('GET', 'mode=list&requirementId=REQ-A')).status, 403)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('usage is attributed only to an exact unambiguous session and missing values stay unknown', async () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-observe-usage-'))
  try {
    const run = createRun({ root, requirementId: 'REQ-A', carrier: 'dsh-session', sessionId: 's' }).run
    const fetchImpl = async url => {
      assert.equal(url, 'http://127.0.0.1:18787/__bili/sessions')
      return { ok: true, async json() { return { sessions: [{ id: 'other', inputTokens: 900 }, { id: 's', hasLedger: true, inputTokens: 100, cachedTokens: 80, rates: { w: 0.1, r: 0.01, q: 0.2 }, costUsd: { total: 0.001 } }] } } }
    }
    const result = await observeUsage({ root, requirementId: 'REQ-A', runId: run.id, fetchImpl })
    assert.equal(result.inputTokens, 100)
    assert.equal(result.cachedTokens, 80)
    assert.equal(result.outputTokens, null)
    assert.equal(result.estimatedCostUsd, 0.001)
    assert.equal(result.costUsesCurrentRates, null)
    for (const [costUsd, expected] of [
      [{ input: 1, cacheRead: 2, cacheWrite: 3, output: 4, total: 10 }, false],
      [{ input: 1, cacheRead: 2, cacheWrite: 3, output: 4, total: 11 }, null],
      [{ input: 1, cacheRead: 2, cacheWrite: 3, total: 6 }, null],
    ]) {
      const usage = await observeUsage({ root, requirementId: 'REQ-A', runId: run.id, fetchImpl: async () => ({ ok: true, json: async () => ({ sessions: [{ id: 's', hasLedger: true, rates: { w: 1, r: 1, q: 1 }, costUsd }] }) }) })
      assert.equal(usage.costUsesCurrentRates, expected)
    }
    assert.equal(result.savedUsd, null)
    for (const [value, expected] of [['2026-11-06T00:00:00.000Z', '2026-11-06T00:00:00.000Z'], [0, 0], ['invalid', null], [Infinity, null], [undefined, null]]) {
      const usage = await observeUsage({ root, requirementId: 'REQ-A', runId: run.id, fetchImpl: async () => ({ ok: true, json: async () => ({ sessions: [{ id: 's', hasLedger: true, lastSeen: value }] }) }) })
      assert.equal(usage.lastSeen, expected)
    }
    for (const [value, expected] of [[3, 3], [0, 0], [-1, null], [1.5, null], [undefined, null]]) {
      const usage = await observeUsage({ root, requirementId: 'REQ-A', runId: run.id, fetchImpl: async () => ({ ok: true, json: async () => ({ sessions: [{ id: 's', hasLedger: true, foldCount: value }] }) }) })
      assert.equal(usage.foldCount, expected)
    }
    const inconsistent = await observeUsage({ root, requirementId: 'REQ-A', runId: run.id, fetchImpl: async () => ({ ok: true, json: async () => ({ sessions: [{ id: 's', hasLedger: true, inputTokens: 10, cachedTokens: 11, cacheHitPct: 99 }] }) }) })
    assert.equal(inconsistent.inputTokens, 10)
    assert.equal(inconsistent.cachedTokens, null)
    assert.equal(inconsistent.cacheHitPct, null)
    for (const [inputTokens, cachedTokens, cacheHitPct, expected] of [[100, 80, 10, null], [0, 0, 0, null], [3, 2, 67, 67], [3, 2, 66.67, 66.67]]) {
      const usage = await observeUsage({ root, requirementId: 'REQ-A', runId: run.id, fetchImpl: async () => ({ ok: true, json: async () => ({ sessions: [{ id: 's', hasLedger: true, inputTokens, cachedTokens, cacheHitPct }] }) }) })
      assert.equal(usage.cacheHitPct, expected)
    }
    assert.equal(inconsistent.aggregate.cachedTokens, null)
    for (const invalidInput of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, '100']) {
      const usage = await observeUsage({ root, requirementId: 'REQ-A', runId: run.id, fetchImpl: async () => ({ ok: true, json: async () => ({ sessions: [{ id: 's', hasLedger: true, inputTokens: invalidInput, cachedTokens: 1, cacheHitPct: 50 }] }) }) })
      assert.equal(usage.inputTokens, null)
      assert.equal(usage.cacheHitPct, null)
    }
    const malformed = await observeUsage({ root, requirementId: 'REQ-A', runId: run.id, fetchImpl: async () => ({ ok: true, json: async () => ({ sessions: [{ id: 's', hasLedger: true, requests: 1.5, inputTokens: Number.MAX_SAFE_INTEGER + 1, cachedTokens: 2.5, outputTokens: -1, tokensSaved: 1.5, cacheHitPct: 50, modelSwitches: 0.5 }] }) }) })
    for (const key of ['requests', 'inputTokens', 'cachedTokens', 'outputTokens', 'tokensSaved', 'cacheHitPct', 'modelSwitches']) assert.equal(malformed[key], null, key)
    for (const key of ['requests', 'inputTokens', 'cachedTokens', 'outputTokens', 'tokensSaved']) assert.equal(malformed.aggregate[key], null, key)
    for (const [value, expected] of [[0, 0], [100, 100], [101, null], [-1, null]]) {
      const usage = await observeUsage({ root, requirementId: 'REQ-A', runId: run.id, fetchImpl: async () => ({ ok: true, json: async () => ({ sessions: [{ id: 's', hasLedger: true, cacheHitPct: value }] }) }) })
      assert.equal(usage.cacheHitPct, expected)
    }
    const zeroSaved = await observeUsage({ root, requirementId: 'REQ-A', runId: run.id, fetchImpl: async () => ({ ok: true, json: async () => ({ sessions: [{ id: 's', hasLedger: true, tokensSaved: 0 }] }) }) })
    assert.equal(zeroSaved.tokensSaved, null)
    assert.equal(zeroSaved.aggregate.tokensSaved, null)
    const savings = await observeUsage({ root, requirementId: 'REQ-A', runId: run.id, fetchImpl: async () => ({ ok: true, json: async () => ({ sessions: [{ id: 's', hasLedger: true, inputTokens: 100, cachedTokens: 80, rates: { w: 0.1, r: 0.01, q: 0.2 }, costUsd: { total: 0.001 }, savedUsd: 0.42, savedUsdGross: 0.51 }] }) }) })
    assert.equal(savings.savedUsd, 0.42)
    assert.equal(savings.savedUsdGross, 0.51)
    const loss = await observeUsage({ root, requirementId: 'REQ-A', runId: run.id, fetchImpl: async () => ({ ok: true, json: async () => ({ sessions: [{ id: 's', hasLedger: true, savedUsd: -0.25 }] }) }) })
    assert.equal(loss.savedUsd, -0.25)
    assert.equal(result.complete, false)
    const duplicate = await observeUsage({ root, requirementId: 'REQ-A', runId: run.id, fetchImpl: async () => ({ ok: true, json: async () => ({ sessions: [{ id: 's' }, { id: 's' }] }) }) })
    assert.equal(duplicate.reason, 'ambiguous-session')
    const noRates = await observeUsage({ root, requirementId: 'REQ-A', runId: run.id, fetchImpl: async () => ({ ok: true, json: async () => ({ sessions: [{ id: 's', hasLedger: true, costUsd: { total: 0 } }] }) }) })
    assert.equal(noRates.estimatedCostUsd, null)
    const switched = await observeUsage({ root, requirementId: 'REQ-A', runId: run.id, fetchImpl: async () => ({ ok: true, json: async () => ({ sessions: [{ id: 's', hasLedger: true, modelSwitches: 1, rates: { w: 1, r: 1, q: 1 }, costUsd: { total: 2, estimated: true } }] }) }) })
    assert.equal(switched.estimatedCostUsd, null)
    assert.equal(switched.costUsesCurrentRates, true)
    assert.equal(switched.modelSwitches, 1)
    assert.equal(switched.aggregate.estimatedCostUsd, null)
    const unknownModels = await observeUsage({ root, requirementId: 'REQ-A', runId: run.id, fetchImpl: async () => ({ ok: true, json: async () => ({ sessions: [{ id: 's', hasLedger: true, rates: { w: 1, r: 1, q: 1 }, costUsd: { total: 2, estimated: true } }] }) }) })
    assert.equal(unknownModels.modelSwitches, null)
    assert.equal(unknownModels.estimatedCostUsd, null)
    assert.equal(unknownModels.aggregate.estimatedCostUsd, null)
    const singleModel = await observeUsage({ root, requirementId: 'REQ-A', runId: run.id, fetchImpl: async () => ({ ok: true, json: async () => ({ sessions: [{ id: 's', hasLedger: true, modelSwitches: 0, rates: { w: 1, r: 1, q: 1 }, costUsd: { total: 2, estimated: true } }] }) }) })
    assert.equal(singleModel.estimatedCostUsd, 2)
    const noLedger = await observeUsage({ root, requirementId: 'REQ-A', runId: run.id, fetchImpl: async () => ({ ok: true, json: async () => ({ sessions: [{ id: 's', inputTokens: 0 }] }) }) })
    assert.equal(noLedger.reason, 'ledger-unavailable')
    await assert.rejects(observeUsage({ root, requirementId: 'REQ-B', runId: run.id, fetchImpl }), { code: 'run-not-found' })
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('main-session totals require complete history and every session ledger', async () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-observe-total-'))
  try {
    const run = createRun({ root, requirementId: 'REQ-A', carrier: 'dsh-session', sessionId: 'one' }).run
    updateRun({ root, runId: run.id, sessionId: 'two', apply: true })
    const row = (id, value) => ({ id, hasLedger: true, inputTokens: value, cachedTokens: value / 2, outputTokens: 5, requests: 1, tokensSaved: 2, rates: { w: 1, r: 1, q: 1 }, costUsd: { total: value / 1000 } })
    let sessions = [row('one', 100), row('two', 200)]
    const fetchImpl = async () => ({ ok: true, json: async () => ({ sessions }) })
    const complete = await observeUsage({ root, requirementId: 'REQ-A', runId: run.id, fetchImpl })
    assert.equal(complete.aggregate.inputTokens, 300)
    assert.equal(complete.aggregate.cachedTokens, 150)
    assert.equal(complete.aggregate.tokensSaved, 4)
    assert.deepEqual(complete.coverage, { matched: 2, total: 2, historyComplete: true })
    sessions[0].inputTokens = Number.MAX_SAFE_INTEGER
    sessions[1].inputTokens = 1
    const overflow = await observeUsage({ root, requirementId: 'REQ-A', runId: run.id, fetchImpl })
    assert.equal(overflow.inputTokens, Number.MAX_SAFE_INTEGER)
    assert.equal(overflow.aggregate.inputTokens, null)
    sessions = [row('one', 100), row('two', 200)]
    sessions[0].costUsd.total = Number.MAX_VALUE
    sessions[1].costUsd.total = Number.MAX_VALUE
    const costOverflow = await observeUsage({ root, requirementId: 'REQ-A', runId: run.id, fetchImpl })
    assert.equal(costOverflow.aggregate.estimatedCostUsd, null)
    sessions = [row('one', 100), row('two', 200)]
    sessions[1].tokensSaved = 0
    const unknownSavings = await observeUsage({ root, requirementId: 'REQ-A', runId: run.id, fetchImpl })
    assert.equal(unknownSavings.tokensSaved, 2)
    assert.equal(unknownSavings.aggregate.tokensSaved, null)
    sessions = [row('one', 100)]
    const partial = await observeUsage({ root, requirementId: 'REQ-A', runId: run.id, fetchImpl })
    assert.equal(partial.aggregate, null)
    assert.equal(partial.coverage.matched, 1)
    sessions = [row('one', 100), row('two', 200)]
    const damaged = readRun(root, run.id)
    damaged.sessions.push({ ...damaged.sessions[0] })
    writeFileSync(runPath(root, run.id), JSON.stringify(damaged))
    const duplicate = await observeUsage({ root, requirementId: 'REQ-A', runId: run.id, fetchImpl })
    assert.equal(duplicate.inputTokens, 100)
    assert.equal(duplicate.aggregate, null)
    assert.equal(duplicate.coverage.duplicateSessions, 1)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('host token usage is an independent fallback and releases its observation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-observe-host-usage-'))
  try {
    const run = createRun({ root, requirementId: 'REQ-A', carrier: 'dsh-session', sessionId: 's' }).run
    let disposed = 0
    const ctx = { get: name => name === 'sessionQuery' ? { async observeSession(id, options) {
      assert.equal(id, 's'); assert.equal(options.projectionMode, 'all')
      return { inheritedEventCount: 0, events: [{ type: 'assistant/message', data: { usage: { inputTokens: 100, outputTokens: 10 } } }], projections: { values: { tokenUsage: { uncachedInputTokens: 100, cacheReadTokens: 80, cacheWriteTokens: 20, outputTokens: 10 } } }, [Symbol.dispose]() { disposed++ } }
    } } : null }
    const result = await observeUsage({ ctx, root, requirementId: 'REQ-A', runId: run.id, fetchImpl: async () => { throw new Error('offline') } })
    assert.equal(result.source, 'dsh-session')
    assert.equal(result.inputTokens, 200)
    assert.equal(result.host.cacheWriteTokens, 20)
    assert.equal(result.estimatedCostUsd, null)
    assert.equal(result.tokensSaved, null)
    assert.equal(disposed, 1)
    for (const inheritedEventCount of [1, undefined, -1, '0']) {
      const forkCtx = { get: () => ({ observeSession: async () => ({ inheritedEventCount, events: [{ type: 'assistant/message', data: { usage: { inputTokens: 10, outputTokens: 1 } } }], projections: { values: { tokenUsage: { uncachedInputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1 } } } }) }) }
      const fork = await observeUsage({ ctx: forkCtx, root, requirementId: 'REQ-A', runId: run.id, fetchImpl: async () => { throw new Error('offline') } })
      assert.equal(fork.status, 'unknown')
      const proxy = await observeUsage({ ctx: forkCtx, root, requirementId: 'REQ-A', runId: run.id, fetchImpl: async () => ({ ok: true, json: async () => ({ sessions: [{ id: 's', hasLedger: true, inputTokens: 7 }] }) }) })
      assert.equal(proxy.inputTokens, 7)
      assert.equal(proxy.host, null)
    }
    const emptyCtx = { get: () => ({ observeSession: async () => ({ events: [], projections: { values: { tokenUsage: { uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 } } } }) }) }
    const empty = await observeUsage({ ctx: emptyCtx, root, requirementId: 'REQ-A', runId: run.id, fetchImpl: async () => { throw new Error('offline') } })
    assert.equal(empty.status, 'unknown')
    for (const event of [
      { type: 'assistant/message', data: { usage: { inputTokens: 0, outputTokens: 0 } } },
      { type: 'assistant/attempt', data: { stream: [{ type: 'chunk', chunk: { type: 'usage', usage: { inputTokens: 0, outputTokens: 0 } } }] } },
    ]) {
      const zeroCtx = { get: () => ({ observeSession: async () => ({ inheritedEventCount: 0, events: [event], projections: { values: { tokenUsage: { uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 } } } }) }) }
      const zero = await observeUsage({ ctx: zeroCtx, root, requirementId: 'REQ-A', runId: run.id, fetchImpl: async () => { throw new Error('offline') } })
      assert.equal(zero.inputTokens, 0)
      assert.equal(zero.outputTokens, 0)
    }
    for (const sample of [{}, { inputTokens: 0 }, { inputTokens: 0, outputTokens: -1 }, { inputTokens: 0, outputTokens: 0, cacheReadTokens: null }]) {
      const badSampleCtx = { get: () => ({ observeSession: async () => ({ inheritedEventCount: 0, events: [{ type: 'assistant/message', data: { usage: sample } }], projections: { values: { tokenUsage: { uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 } } } }) }) }
      const invalid = await observeUsage({ ctx: badSampleCtx, root, requirementId: 'REQ-A', runId: run.id, fetchImpl: async () => { throw new Error('offline') } })
      assert.equal(invalid.status, 'unknown')
    }
    for (const chunk of [{ type: 'usage', usage: {} }, { type: 'usage', usage: { inputTokens: 10, outputTokens: 2 } }, { type: 'text-delta', usage: { inputTokens: 0, outputTokens: 0 } }]) {
      const badChunkCtx = { get: () => ({ observeSession: async () => ({ inheritedEventCount: 0, events: [{ type: 'assistant/chunk', data: { chunk } }], projections: { values: { tokenUsage: { uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 } } } }) }) }
      const invalid = await observeUsage({ ctx: badChunkCtx, root, requirementId: 'REQ-A', runId: run.id, fetchImpl: async () => { throw new Error('offline') } })
      assert.equal(invalid.status, 'unknown')
    }
    for (const counts of [
      { uncachedInputTokens: 1.5, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
      { uncachedInputTokens: Number.MAX_SAFE_INTEGER, cacheReadTokens: 1, cacheWriteTokens: 0, outputTokens: 0 },
    ]) {
      const badCtx = { get: () => ({ observeSession: async () => ({ inheritedEventCount: 0, events: [{ type: 'assistant/message', data: { usage: { inputTokens: 0, outputTokens: 0 } } }], projections: { values: { tokenUsage: counts } } }) }) }
      const invalid = await observeUsage({ ctx: badCtx, root, requirementId: 'REQ-A', runId: run.id, fetchImpl: async () => { throw new Error('offline') } })
      assert.equal(invalid.status, 'unknown')
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a stalled proxy response body falls back to host usage and ignores a late result', async () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-observe-proxy-timeout-'))
  try {
    const run = createRun({ root, requirementId: 'REQ-A', carrier: 'dsh-session', sessionId: 's' }).run
    let release, releaseRetry, signal, calls = 0
    const query = { observeSession: async () => ({ inheritedEventCount: 0, events: [{ type: 'assistant/message', data: { usage: { inputTokens: 10, outputTokens: 3 } } }], projections: { values: { tokenUsage: { uncachedInputTokens: 10, cacheReadTokens: 2, cacheWriteTokens: 1, outputTokens: 3 } } } }) }
    const fetchImpl = async (_url, options) => {
      calls++
      if (calls > 1) return { ok: true, json: () => new Promise(resolve => { releaseRetry = resolve }) }
      signal = options.signal
      return { ok: true, json: () => new Promise(resolve => { release = resolve }) }
    }
    const args = { ctx: { get: () => query }, root, requirementId: 'REQ-A', runId: run.id, fetchImpl }
    const result = await observeUsage(args)
    assert.equal(result.source, 'dsh-session')
    assert.equal(result.inputTokens, 13)
    assert.equal(signal.aborted, true)
    const retry = observeUsage(args)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(calls, 2)
    release({ sessions: [{ id: 's', hasLedger: true, inputTokens: 999 }] })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(result.inputTokens, 13)
    const concurrent = observeUsage(args)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(calls, 2)
    releaseRetry({ sessions: [{ id: 's', hasLedger: true, inputTokens: 42 }] })
    assert.equal((await retry).inputTokens, 42)
    assert.equal((await concurrent).inputTokens, 42)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('stalled proxy requests are bounded and recover when one settles', async () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-observe-proxy-bound-'))
  const releases = []
  try {
    const run = createRun({ root, requirementId: 'REQ-A', carrier: 'dsh-session', sessionId: 's' }).run
    let calls = 0
    const fetchImpl = async () => {
      calls++
      if (calls <= 2) return { ok: true, json: () => new Promise(resolve => releases.push(resolve)) }
      return { ok: true, json: async () => ({ sessions: [{ id: 's', hasLedger: true, inputTokens: 42 }] }) }
    }
    const args = { root, requirementId: 'REQ-A', runId: run.id, fetchImpl }
    assert.equal((await observeUsage(args)).status, 'unknown')
    assert.equal((await observeUsage(args)).status, 'unknown')
    assert.equal((await observeUsage(args)).status, 'unknown')
    assert.equal(calls, 2)
    releases[0]({ sessions: [] })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal((await observeUsage(args)).inputTokens, 42)
    assert.equal(calls, 3)
  } finally {
    for (const release of releases) release({ sessions: [] })
    rmSync(root, { recursive: true, force: true })
  }
})

test('concurrent usage requests share a proxy response but retain session attribution', async () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-observe-proxy-shared-'))
  try {
    const first = createRun({ root, requirementId: 'REQ-A', carrier: 'dsh-session', sessionId: 'a' }).run
    const second = createRun({ root, requirementId: 'REQ-B', carrier: 'dsh-session', sessionId: 'b' }).run
    let release, calls = 0
    const fetchImpl = async () => { calls++; return { ok: true, json: () => new Promise(resolve => { release = resolve }) } }
    const a = observeUsage({ root, requirementId: 'REQ-A', runId: first.id, fetchImpl })
    const b = observeUsage({ root, requirementId: 'REQ-B', runId: second.id, fetchImpl })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(calls, 1)
    release({ sessions: [{ id: 'a', hasLedger: true, inputTokens: 10 }, { id: 'b', hasLedger: true, inputTokens: 20 }] })
    assert.equal((await a).inputTokens, 10)
    assert.equal((await b).inputTokens, 20)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a stalled history observation reports unavailable and releases a late lease', async () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-observe-history-timeout-'))
  try {
    const run = createRun({ root, requirementId: 'REQ-A', carrier: 'dsh-session', sessionId: 's' }).run
    let release, disposed = 0, fallbackReads = 0, calls = 0
    const query = {
      observeSession: () => { calls++; return calls === 1 ? new Promise(resolve => { release = resolve }) : Promise.resolve({ events: [] }) },
      readSession: async () => { fallbackReads++; return { events: [] } },
    }
    const ctx = { get: name => name === 'sessionQuery' ? query : null }
    const result = await observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id })
    assert.equal(result.source, 'unavailable')
    assert.equal(fallbackReads, 0)
    assert.equal((await observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id })).source, 'session-observation')
    assert.equal(calls, 2)
    release({ events: [], [Symbol.dispose]() { disposed++ } })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(disposed, 1)
    assert.equal((await observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id })).source, 'session-observation')
    assert.equal(calls, 3)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a stalled legacy session read permits a bounded retry and ignores the late result', async () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-observe-legacy-timeout-'))
  try {
    const run = createRun({ root, requirementId: 'REQ-A', carrier: 'dsh-session', sessionId: 's' }).run
    let release, calls = 0, fallbackReads = 0
    const query = { readSession: () => { calls++; return calls === 1 ? new Promise(resolve => { release = resolve }) : Promise.resolve({ events: [] }) } }
    const ctx = { get: name => name === 'sessionQuery' ? query : name === 'sessionPersistence' ? { open: async () => { fallbackReads++; throw new Error('unexpected fallback') } } : null }
    assert.equal((await observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id })).source, 'unavailable')
    assert.equal((await observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id })).source, 'session-query')
    assert.equal(calls, 2)
    assert.equal(fallbackReads, 0)
    release({ events: [{ seq: 0, type: 'user/message', data: { content: 'late' } }] })
    await new Promise(resolve => setImmediate(resolve))
    const recovered = await observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id })
    assert.equal(recovered.source, 'session-query')
    assert.deepEqual(recovered.events, [])
    assert.equal(calls, 3)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('two stalled history observations cap retries until one finishes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-observe-history-cap-'))
  try {
    const run = createRun({ root, requirementId: 'REQ-A', carrier: 'dsh-session', sessionId: 's' }).run
    const releases = []
    let calls = 0
    const query = { observeSession: () => { calls++; return calls <= 2 ? new Promise(resolve => releases.push(resolve)) : Promise.resolve({ events: [] }) } }
    const ctx = { get: name => name === 'sessionQuery' ? query : null }
    for (let i = 0; i < 3; i++) assert.equal((await observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id })).source, 'unavailable')
    assert.equal(calls, 2)
    releases[0]({ events: [] })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal((await observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id })).source, 'session-observation')
    releases[1]({ events: [] })
    await new Promise(resolve => setImmediate(resolve))
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('stalled persistence open, read and close time out and release late handles', async () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-observe-persistence-timeout-'))
  const releases = new Map(), calls = new Map(), closes = new Map()
  try {
    const phases = ['open', 'read', 'close']
    const runs = phases.map(phase => ({ phase, run: createRun({ root, requirementId: `REQ-${phase}`, carrier: 'dsh-session', sessionId: phase }).run }))
    const gates = Object.fromEntries(phases.map(phase => [phase, new Promise(resolve => releases.set(phase, resolve))]))
    const persistence = { async open(id) {
      calls.set(id, (calls.get(id) ?? 0) + 1)
      const call = calls.get(id)
      if (id === 'open' && call === 1) await gates.open
      return {
        async read() { if (id === 'read' && call === 1) await gates.read; return { events: [] } },
        async close() { closes.set(id, (closes.get(id) ?? 0) + 1); if (id === 'close' && call === 1) await gates.close },
      }
    } }
    const ctx = { get: name => name === 'sessionPersistence' ? persistence : null }
    const observe = ({ phase, run }) => observeRun({ ctx, root, requirementId: `REQ-${phase}`, runId: run.id })
    const service = Object.create(RequirementsService.prototype)
    service.rootFor = () => root
    service.ctx = ctx
    const httpObserve = async ({ phase, run }) => {
      let status, body
      await service.handleRunObservation({ method: 'GET', url: `/api/alm/requirements/run-observation?requirementId=REQ-${phase}&runId=${run.id}` }, { writeHead(code) { status = code }, end(value) { body = JSON.parse(value) } })
      assert.equal(status, 200)
      return body
    }
    const timedOut = await Promise.all([httpObserve(runs[0]), ...runs.slice(1).map(observe)])
    assert.deepEqual(timedOut.map(result => result.source), ['unavailable', 'unavailable', 'unavailable'])
    assert.deepEqual((await Promise.all(runs.map(observe))).map(result => result.source), ['persisted', 'persisted', 'persisted'])
    for (const phase of phases) { assert.equal(calls.get(phase), 2); releases.get(phase)() }
    await new Promise(resolve => setImmediate(resolve))
    for (const phase of phases) assert.equal(closes.get(phase), 2)
    assert.deepEqual((await Promise.all([httpObserve(runs[0]), ...runs.slice(1).map(observe)])).map(result => result.source), ['persisted', 'persisted', 'persisted'])
    for (const phase of phases) { assert.equal(calls.get(phase), 3); assert.equal(closes.get(phase), 3) }
  } finally { for (const release of releases.values()) release(); rmSync(root, { recursive: true, force: true }) }
})

test('two stalled persistence opens cap retries until a handle is released', async () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-observe-persistence-cap-'))
  const releases = []
  try {
    const run = createRun({ root, requirementId: 'REQ-A', carrier: 'dsh-session', sessionId: 's' }).run
    let calls = 0, closes = 0
    const handle = () => ({ read: async () => ({ events: [] }), close: async () => { closes++ } })
    const persistence = { open: () => { calls++; return calls <= 2 ? new Promise(resolve => releases.push(resolve)) : Promise.resolve(handle()) } }
    const ctx = { get: name => name === 'sessionPersistence' ? persistence : null }
    const observe = () => observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id })
    for (let i = 0; i < 3; i++) assert.equal((await observe()).source, 'unavailable')
    assert.equal(calls, 2)
    releases[0](handle())
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(closes, 1)
    assert.equal((await observe()).source, 'persisted')
    assert.equal(calls, 3)
    releases[1](handle())
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(closes, 3)
  } finally {
    for (const release of releases) release({ read: async () => ({ events: [] }), close: async () => {} })
    rmSync(root, { recursive: true, force: true })
  }
})

test('a stalled host usage observation does not block the proxy and releases a late lease', async () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-observe-host-timeout-'))
  try {
    const run = createRun({ root, requirementId: 'REQ-A', carrier: 'dsh-session', sessionId: 's' }).run
    let release, disposed = 0, calls = 0
    const query = { observeSession: () => { calls++; return calls === 1 ? new Promise(resolve => { release = resolve }) : Promise.resolve({ inheritedEventCount: 0, events: [{ type: 'assistant/message', data: { usage: { inputTokens: 10, outputTokens: 1 } } }], projections: { values: { tokenUsage: { uncachedInputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1 } } }, [Symbol.dispose]() { disposed++ } }) } }
    const ctx = { get: () => query }
    const fetchImpl = async () => ({ ok: true, json: async () => ({ sessions: [{ id: 's', hasLedger: true, inputTokens: 42 }] }) })
    const result = await observeUsage({ ctx, root, requirementId: 'REQ-A', runId: run.id, fetchImpl })
    assert.equal(result.source, 'billion-context')
    assert.equal(result.inputTokens, 42)
    assert.equal(result.host, null)
    const recovered = await observeUsage({ ctx, root, requirementId: 'REQ-A', runId: run.id, fetchImpl })
    assert.equal(recovered.inputTokens, 42)
    assert.equal(recovered.host.uncachedInputTokens, 10)
    assert.equal(calls, 2)
    release({ [Symbol.dispose]() { disposed++ } })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(disposed, 2)
    await observeUsage({ ctx, root, requirementId: 'REQ-A', runId: run.id, fetchImpl })
    assert.equal(calls, 3)
    assert.equal(disposed, 3)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('stalled host usage observations have a bounded retry limit', async () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-observe-host-cap-'))
  try {
    const run = createRun({ root, requirementId: 'REQ-A', carrier: 'dsh-session', sessionId: 's' }).run
    const releases = []
    let disposed = 0
    const query = { observeSession: () => new Promise(resolve => releases.push(resolve)) }
    const ctx = { get: () => query }
    const fetchImpl = async () => { throw new Error('offline') }
    const observe = () => observeUsage({ ctx, root, requirementId: 'REQ-A', runId: run.id, fetchImpl })
    assert.equal((await observe()).status, 'unknown')
    assert.equal((await observe()).status, 'unknown')
    assert.equal((await observe()).status, 'unknown')
    assert.equal(releases.length, 2)
    releases[0]({ [Symbol.dispose]() { disposed++ } })
    await new Promise(resolve => setImmediate(resolve))
    const next = observe()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(releases.length, 3)
    releases[2]({ [Symbol.dispose]() { disposed++ } })
    await next
    releases[1]({ [Symbol.dispose]() { disposed++ } })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(disposed, 3)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a late host usage observation does not unlock an active retry', async () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-observe-host-late-'))
  try {
    const run = createRun({ root, requirementId: 'REQ-A', carrier: 'dsh-session', sessionId: 's' }).run
    const releases = []
    let disposed = 0
    const ctx = { get: () => query }
    const query = { observeSession: () => new Promise(resolve => releases.push(resolve)) }
    const fetchImpl = async () => { throw new Error('offline') }
    const observe = () => observeUsage({ ctx, root, requirementId: 'REQ-A', runId: run.id, fetchImpl })
    assert.equal((await observe()).status, 'unknown')
    const retry = observe()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(releases.length, 2)
    releases[0]({ [Symbol.dispose]() { disposed++ } })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal((await observe()).status, 'unknown')
    assert.equal(releases.length, 2)
    releases[1]({ [Symbol.dispose]() { disposed++ } })
    await retry
    assert.equal(disposed, 2)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('live frames require ownership and contiguous indexes; committed events replace transient content', async () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-observe-live-'))
  try {
    const run = createRun({ root, requirementId: 'REQ-A', carrier: 'dsh-session', sessionId: 's' }).run
    const attempts = new Map()
    const send = (id, frame) => recordLiveFrame(attempts, { agent: { session: { id } }, frame }, value => value === 's')
    send('other', { type: 'start', attemptId: 'a', turn: 0, step: 0 })
    assert.equal(attempts.size, 0)
    send('s', { type: 'start', attemptId: 'a', turn: 0, step: 0 })
    send('s', { type: 'chunk', attemptId: 'a', index: 0, chunk: { type: 'text-delta', text: 'partial' } })
    send('s', { type: 'chunk', attemptId: 'a', index: 1, chunk: { type: 'reasoning-delta', text: 'visible' } })
    let events = []
    const ctx = { get: name => name === 'sessionQuery' ? { readSession: async () => ({ events }) } : null }
    const live = await observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id, liveAttempts: attempts })
    assert.equal(live.live.text, 'partial')
    assert.equal(live.live.reasoning, 'visible')
    const only = await observeRun({ ctx: { get() { throw new Error('history should not be read') } }, root, requirementId: 'REQ-A', runId: run.id, liveAttempts: attempts, liveOnly: true })
    assert.equal(only.live.text, 'partial')
    send('s', { type: 'start', attemptId: 'secret', turn: 2, step: 0 })
    send('s', { type: 'chunk', attemptId: 'secret', index: 0, chunk: { type: 'text-delta', text: 'password="unfinished secret value' } })
    assert.doesNotMatch((await observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id, liveAttempts: attempts, liveOnly: true })).live.text, /unfinished secret value/)
    send('s', { type: 'chunk', attemptId: 'secret', index: 1, chunk: { type: 'text-delta', text: 'x'.repeat(41000) } })
    const truncated = (await observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id, liveAttempts: attempts, liveOnly: true })).live
    assert.equal(truncated.truncated, true)
    assert.doesNotMatch(truncated.text, /unfinished secret value|xxxxx/)
    send('s', { type: 'start', attemptId: 'unicode', turn: 2, step: 1 })
    send('s', { type: 'chunk', attemptId: 'unicode', index: 0, chunk: { type: 'text-delta', text: 'x'.repeat(39999) + '\uD83D' } })
    let unicode = (await observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id, liveAttempts: attempts, liveOnly: true })).live
    assert.equal(unicode.text.length, 39999)
    send('s', { type: 'chunk', attemptId: 'unicode', index: 1, chunk: { type: 'text-delta', text: '\uDE80' } })
    send('s', { type: 'chunk', attemptId: 'unicode', index: 2, chunk: { type: 'text-delta', text: 'later' } })
    send('s', { type: 'chunk', attemptId: 'unicode', index: 3, chunk: { type: 'reasoning-delta', text: 'still available' } })
    unicode = (await observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id, liveAttempts: attempts, liveOnly: true })).live
    assert.equal(unicode.text, 'x'.repeat(39999))
    assert.equal(unicode.reasoning, 'still available')
    assert.equal(unicode.truncated, true)
    send('s', { type: 'start', attemptId: 'token', turn: 3, step: 0 })
    send('s', { type: 'chunk', attemptId: 'token', index: 0, chunk: { type: 'text-delta', text: '{"token":"secret\\"value\nnext line' } })
    const multiline = (await observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id, liveAttempts: attempts, liveOnly: true })).live.text
    assert.doesNotMatch(multiline, /secret|value/)
    assert.match(multiline, /next line/)
    send('s', { type: 'start', attemptId: 'cookie', turn: 3, step: 1 })
    send('s', { type: 'chunk', attemptId: 'cookie', index: 0, chunk: { type: 'text-delta', text: 'Cookie: first=secret-one; ' } })
    send('s', { type: 'chunk', attemptId: 'cookie', index: 1, chunk: { type: 'text-delta', text: 'second=secret-two\nNext: safe' } })
    const liveCookie = (await observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id, liveAttempts: attempts, liveOnly: true })).live.text
    assert.doesNotMatch(liveCookie, /secret-one|secret-two/)
    assert.match(liveCookie, /Next: safe/)
    send('s', { type: 'start', attemptId: 'cookie-equals', turn: 3, step: 2 })
    send('s', { type: 'chunk', attemptId: 'cookie-equals', index: 0, chunk: { type: 'text-delta', text: 'Cookie=first=secret-one; second=secret-two\nNext: safe' } })
    const equalsCookie = (await observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id, liveAttempts: attempts, liveOnly: true })).live.text
    assert.doesNotMatch(equalsCookie, /secret-one|secret-two/)
    assert.match(equalsCookie, /Next: safe/)
    for (const [prefix, suffix] of [['sk-', 'abc'], ['ghp_', 'abc'], ['xoxb-', 'abc']]) {
      send('s', { type: 'start', attemptId: 'prefix', turn: 4, step: 0 })
      send('s', { type: 'chunk', attemptId: 'prefix', index: 0, chunk: { type: 'text-delta', text: prefix } })
      send('s', { type: 'chunk', attemptId: 'prefix', index: 1, chunk: { type: 'reasoning-delta', text: prefix + suffix } })
      let partial = (await observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id, liveAttempts: attempts, liveOnly: true })).live
      assert.doesNotMatch(partial.text, new RegExp(prefix))
      assert.doesNotMatch(partial.reasoning, new RegExp(prefix + suffix))
      send('s', { type: 'chunk', attemptId: 'prefix', index: 2, chunk: { type: 'text-delta', text: suffix } })
      partial = (await observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id, liveAttempts: attempts, liveOnly: true })).live
      assert.doesNotMatch(partial.text, new RegExp(prefix + suffix))
    }
    send('s', { type: 'start', attemptId: 'a', turn: 0, step: 0 })
    await assert.rejects(observeRun({ ctx, root, requirementId: 'REQ-B', runId: run.id, liveAttempts: attempts, liveOnly: true }), { code: 'run-not-found' })
    events = [{ seq: 0, type: 'assistant/message', data: { turn: 0, step: 0, message: { content: [{ type: 'text', text: 'complete' }] } } }]
    assert.equal((await observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id, liveAttempts: attempts })).live, null)
    settleLiveFrame(attempts, { id: 's' }, events[0])
    assert.equal(attempts.size, 0)
    send('s', { type: 'start', attemptId: 'a', turn: 0, step: 0 })
    send('s', { type: 'chunk', attemptId: 'a', index: 3, chunk: { type: 'text-delta', text: 'gap' } })
    assert.equal(attempts.size, 0)
    send('s', { type: 'start', attemptId: 'b', turn: 1, step: 0 })
    send('s', { type: 'end' })
    assert.equal(attempts.size, 0)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('large histories return bounded pages without dropping later events', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'alm-observe-large-'))
  try {
    const run = createRun({ root, requirementId: 'REQ-A', carrier: 'dsh-session', sessionId: 's' }).run
    const events = Array.from({ length: 5000 }, (_, seq) => ({ seq, type: 'user/message', data: { content: [{ type: 'text', text: `entry-${seq}` }] } }))
    const ctx = { get: name => name === 'sessionQuery' ? { readSession: async () => ({ events }) } : null }
    const first = await observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id, limit: 50 })
    assert.equal(first.events.length, 50)
    assert.deepEqual(first.next, { segment: 0, after: 49 })
    const last = await observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id, after: 4949, limit: 50 })
    assert.equal(last.events.length, 50)
    assert.equal(last.events.at(-1).text, 'entry-4999')
    assert.equal(last.next, null)
    const samples = []
    for (let i = 0; i < 10; i++) {
      const start = performance.now()
      await observeRun({ ctx, root, requirementId: 'REQ-A', runId: run.id, after: 2449, limit: 50 })
      samples.push(performance.now() - start)
    }
    samples.sort((a, b) => a - b)
    t.diagnostic(`模拟 5000 条宿主事件的单页投影（10 次，含本地运行记录读取）：中位 ${samples[5].toFixed(1)}ms，最大 ${samples.at(-1).toFixed(1)}ms`)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
