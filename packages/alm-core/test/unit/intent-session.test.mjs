import test from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  IntentError,
  cancelSession,
  createSession,
  listSessions,
  loadSession,
  recordAnswer,
  saveSession,
  setEdits,
  setInput,
} from '../../src/intent/index.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
const fixture = join(repoRoot, 'fixtures/order-refund')

function makeRepo(t) {
  const root = mkdtempSync(join(tmpdir(), 'alm-intent-session-'))
  cpSync(fixture, root, { recursive: true })
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

function makeSession(root, text = '同一笔退款重试时会产生多条退款单，希望支持幂等键去重。') {
  return createSession({
    root,
    project: { id: 'PAY', name: '支付平台' },
    actor: 'human:alice',
    input: { text, source: 'chat' },
  })
}

test('会话：创建即原子落盘、可加载、可列出', (t) => {
  const root = makeRepo(t)
  const session = makeSession(root)
  assert.equal(session.schema, 'alm.intent-session/v1')
  assert.equal(session.schemaVersion, 1)
  assert.match(session.sessionId, /^INT-\d{14}-[0-9a-f]{6}$/)
  assert.equal(session.input.inputRevision, 1)
  assert.match(session.input.inputHash, /^[0-9a-f]{64}$/)
  assert.equal(session.state, 'editing')

  const dir = join(root, '.alm/intents/sessions')
  const files = readdirSync(dir)
  assert.deepEqual(files, [`${session.sessionId}.json`], '不应残留临时文件')
  const onDisk = JSON.parse(readFileSync(join(dir, files[0]), 'utf8'))
  assert.equal(onDisk.sessionId, session.sessionId)

  const loaded = loadSession({ root, sessionId: session.sessionId })
  assert.deepEqual(loaded.input.text, session.input.text)

  const listed = listSessions({ root })
  assert.equal(listed.length, 1)
  assert.equal(listed[0].sessionId, session.sessionId)
  assert.equal(listed[0].projectId, 'PAY')

  assert.throws(
    () => loadSession({ root, sessionId: 'INT-20200101T000000-abcdef' }),
    (error) => error instanceof IntentError && error.code === 'unknown-session' && error.status === 404,
  )
})

test('会话：空输入拒绝、extractedText 截断到 20000 且保留 inputHash', (t) => {
  const root = makeRepo(t)
  assert.throws(
    () => createSession({ root, project: 'PAY', input: { text: '   ' } }),
    (error) => error instanceof IntentError && error.code === 'empty-input',
  )
  const long = 'x'.repeat(30000)
  const session = createSession({
    root,
    project: 'PAY',
    input: { text: '退款幂等', source: 'ocr', extractedText: long, attachment: { name: 'chat.txt', size: 30000, kind: 'chat' } },
  })
  assert.equal(session.input.extractedText.length, 20000)
  assert.equal(session.input.extractedTextTruncated, true)
  assert.equal(session.input.originalTextLength, 4, '原话长度（非摘录）')
  assert.match(session.input.inputHash, /^[0-9a-f]{64}$/)
  assert.equal(session.input.source, 'ocr')
  assert.equal(session.input.attachment.name, 'chat.txt')
})

test('会话：setInput 让 inputRevision +1 并清空派生建议、保留回答', (t) => {
  const root = makeRepo(t)
  const session = makeSession(root)
  const answered = recordAnswer({
    root,
    session,
    answer: { questionId: 'Q-1', optionId: 'O1', text: '同一订单' },
  })
  assert.equal(answered.answers.length, 1)
  assert.equal(answered.answers[0].inputRevision, 1)

  const dirty = {
    ...answered,
    items: [{ itemId: 'ITM-01', recommendedRoute: 'create' }],
    nextQuestion: { questionId: 'Q-1', text: '还有哪些渠道？' },
    confirmation: { route: 'create' },
  }
  const next = setInput({
    root,
    session: dirty,
    input: { text: '改成：退款审批流也要改', source: 'chat', explicit: { owner: 'team-payments', priority: 'p0' } },
  })
  assert.equal(next.input.inputRevision, 2)
  assert.equal(next.input.text, '改成：退款审批流也要改')
  assert.deepEqual(next.items, [])
  assert.equal(next.nextQuestion, null)
  assert.equal(next.confirmation, null)
  assert.equal(next.state, 'editing')
  assert.equal(next.answers.length, 1, '已回答的问题记录应保留')
  assert.equal(next.input.explicit.priority, 'P0')
  const reloaded = loadSession({ root, sessionId: session.sessionId })
  assert.equal(reloaded.input.inputRevision, 2)
})

test('会话：setEdits 以 human 来源记录人工修改（不被后续 AI 覆盖的载体）', (t) => {
  const session = {
    sessionId: 'INT-20200101T000000-abcdef',
    project: { id: 'PAY', name: null },
    state: 'editing',
    input: { text: '退款幂等', source: 'text', inputRevision: 1, inputHash: 'a'.repeat(64) },
    items: [{ itemId: 'ITM-01', fields: {} }],
    answers: [],
    runs: [],
    context: {},
  }
  const edited = setEdits({ session, edits: [{ itemId: 'ITM-01', field: 'candidate.title', value: '支持退款幂等键' }] })
  assert.equal(edited.items[0].fields['candidate.title'].value, '支持退款幂等键')
  assert.equal(edited.items[0].fields['candidate.title'].source, 'human')
  assert.ok(edited.items[0].fields['candidate.title'].at)
})

test('会话：cancel 后不可再修改；committed 会话拒绝 setInput', (t) => {
  const root = makeRepo(t)
  const session = makeSession(root)
  const cancelled = cancelSession({ root, session, reason: '用户撤回' })
  assert.equal(cancelled.state, 'cancelled')
  assert.equal(cancelled.cancel.reason, '用户撤回')
  assert.throws(
    () => setInput({ root, session: cancelled, input: { text: '再来一次' } }),
    (error) => error instanceof IntentError && error.code === 'session-cancelled',
  )

  const other = makeSession(root, '另一条意图：退款单页面加筛选。')
  const committed = { ...other, state: 'committed' }
  saveSession({ root, session: committed })
  const reloaded = loadSession({ root, sessionId: other.sessionId })
  assert.equal(reloaded.state, 'committed')
  assert.throws(
    () => setInput({ root, session: reloaded, input: { text: '再改' } }),
    (error) => error instanceof IntentError && error.code === 'already-committed',
  )
})

test('会话：损坏/未知 schema 的会话不会被静默当作新会话', (t) => {
  const root = makeRepo(t)
  const session = makeSession(root)
  const file = join(root, '.alm/intents/sessions', `${session.sessionId}.json`)
  const raw = JSON.parse(readFileSync(file, 'utf8'))
  raw.schema = 'alm.intent-session/v0'
  assert.ok(existsSync(file))
  writeFileSync(file, JSON.stringify(raw))
  assert.throws(
    () => loadSession({ root, sessionId: session.sessionId }),
    (error) => error instanceof IntentError && error.code === 'invalid-session',
  )
})
