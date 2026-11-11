import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deliveryStateFor } from '../../src/requirements/delivery.mjs'

const asset = { id: 'REQ-X', status: 'proposed' }
const base = { asset, decision: { state: 'unchecked' }, candidate: null, closure: null }

const released = { exists: true, id: 'REL-1', status: 'released', candidateId: 'CAND-1', requirementRevision: 1, requirementHash: 'req-1' }

test('published history survives dirty evidence and old runs without granting an evidence pass', () => {
  for (const status of ['waiting-input', 'failed', 'running', 'done']) {
    const decision = { state: 'stale', humanAccepted: false }
    const state = deliveryStateFor({ ...base, asset: { ...asset, extra: { revision: 1 } }, decision, candidate: { id: 'CAND-2', current: false, requirementHash: 'req-1' }, release: released, run: { id: 'RUN-old', status, stale: true } })
    assert.equal(state.key, 'closed')
    assert.equal(state.label, '已关闭')
    assert.equal(state.source, 'release')
    assert.equal(state.releaseId, 'REL-1')
    assert.equal(decision.state, 'stale')
    assert.equal(decision.humanAccepted, false)
  }
})

test('a new explicit revision progresses independently while retaining release history', () => {
  const release = { status: 'draft', lastReleased: released }
  assert.equal(deliveryStateFor({ ...base, asset: { ...asset, extra: { revision: 2 } }, release }).key, 'pending')
  assert.equal(release.lastReleased.status, 'released')
  assert.equal(deliveryStateFor({ ...base, asset: { ...asset, extra: { revision: 1 } }, release }).label, '已关闭')
})

test('legacy publication uses hash fallback without treating missing fields as a new iteration', () => {
  const release = { ...released, requirementRevision: null }
  assert.equal(deliveryStateFor({ ...base, release, candidate: { requirementHash: 'req-1' } }).label, '已关闭')
  assert.equal(deliveryStateFor({ ...base, release, candidate: { requirementHash: 'req-2' } }).key, 'pending')
  assert.equal(deliveryStateFor({ ...base, release: { status: 'released' } }).label, '已关闭')
})

test('authorization never counts as publication and closure remains highest priority', () => {
  for (const status of ['draft', 'authorized', 'releasing', 'failed', 'cancelled']) {
    assert.equal(deliveryStateFor({ ...base, release: { ...released, status } }).key, 'pending')
  }
  assert.equal(deliveryStateFor({ ...base, release: released, closure: { reason: '已替代' } }).key, 'closed')
})

test('a requirement with no run is 待推进 without a reason', () => {
  const state = deliveryStateFor({ ...base, run: null })
  assert.equal(state.key, 'pending')
  assert.equal(state.source, 'default')
  assert.equal(state.reason, null)
})

test('a live run backs 推进中', () => {
  const state = deliveryStateFor({ ...base, run: { id: 'RUN-1', status: 'running', active: true } })
  assert.equal(state.key, 'in-progress')
  assert.equal(state.source, 'run')
  assert.equal(state.runId, 'RUN-1')
})

test('a raw run with a fresh heartbeat still counts as progress', () => {
  const state = deliveryStateFor({
    ...base,
    run: { id: 'RUN-1', status: 'running', heartbeatAt: new Date().toISOString() },
  })
  assert.equal(state.key, 'in-progress')
})

test('a lost heartbeat rolls the delivery back to 待推进 with a reason', () => {
  const state = deliveryStateFor({
    ...base,
    run: { id: 'RUN-3', status: 'running', stale: true, heartbeatAt: '2026-11-03T02:12:45.672Z' },
  })
  assert.equal(state.key, 'pending')
  assert.equal(state.label, '待推进')
  assert.equal(state.source, 'run-stale')
  assert.equal(state.runId, 'RUN-3')
  assert.equal(state.runStatus, 'running')
  assert.equal(state.reason, '执行器心跳丢失，本轮推进已中断')
})

test('a round waiting for a human rolls back to 待推进 with the reason', () => {
  // A turn that ended without a decision request is a hand-back: nothing is
  // advancing, so the row must not keep saying 推进中.
  const handback = deliveryStateFor({
    ...base,
    run: { id: 'RUN-1', status: 'waiting-input', active: true, awaitingAnswer: false, idleHandback: true },
  })
  assert.equal(handback.key, 'pending')
  assert.equal(handback.source, 'run-idle')
  assert.equal(handback.runStatus, 'waiting-input')
  assert.equal(handback.waitingForHuman, true)
  assert.equal(handback.reason, '本轮推进已交接，等待人类决定下一步')

  // A real decision request is equally a waiting round, with a question on it.
  const question = deliveryStateFor({
    ...base,
    run: { id: 'RUN-1', status: 'waiting-input', active: true, awaitingAnswer: true, decision: '.alm/runs/RUN-1-decision.md' },
  })
  assert.equal(question.key, 'pending')
  assert.equal(question.waitingForHuman, true)
  assert.equal(question.reason, '等待回答决策请求后继续')
})

test('a paused round waits for a human, while finished runs roll back to 待推进', () => {
  // Paused on purpose: parked, not progressing.
  const paused = deliveryStateFor({ ...base, run: { id: 'RUN-1', status: 'paused', active: true } })
  assert.equal(paused.key, 'pending')
  assert.equal(paused.source, 'run-idle')
  assert.equal(paused.waitingForHuman, true)
  assert.equal(paused.reason, '本轮推进已暂停，等待恢复')

  const cases = [
    ['failed', 'run-failed', '本轮推进失败，可从检查点恢复'],
    ['cancelled', 'run-cancelled', '本轮推进已取消'],
    ['done', 'run-done', '本轮推进已结束，等待下一步'],
  ]
  for (const [status, source, reason] of cases) {
    const state = deliveryStateFor({ ...base, run: { id: 'RUN-1', status, active: true } })
    assert.equal(state.key, 'pending', `${status} must not be 推进中`)
    assert.equal(state.source, source, status)
    assert.equal(state.reason, reason, status)
  }
})

test('a recorded failure message wins over the generic interruption text', () => {
  const state = deliveryStateFor({
    ...base,
    run: { id: 'RUN-1', status: 'failed', failure: { message: 'spawn EPERM' } },
  })
  assert.equal(state.key, 'pending')
  assert.equal(state.reason, 'spawn EPERM')
})

test('evidence and closure still outrank a stopped run', () => {
  const run = { id: 'RUN-1', status: 'running', stale: true }
  assert.equal(deliveryStateFor({ ...base, decision: { state: 'verified' }, run }).key, 'accepted')
  assert.equal(deliveryStateFor({ ...base, decision: { state: 'ready-for-human' }, run }).key, 'awaiting-acceptance')
  assert.equal(
    deliveryStateFor({ ...base, asset: { id: 'REQ-X', status: 'archived' }, closure: { reason: '重复' }, run }).key,
    'closed',
  )
})
