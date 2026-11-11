import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pendingDecisionFor } from '../../src/requirements/run-decision.mjs'

const path = '.alm/runs/RUN-001-decision.md'
const snapshot = { path, contentHash: 'hash-a', readable: true }
const run = { checkpoint: { decision: path }, answers: [{ at: '2099-01-01', text: 'yes' }] }

test('only explicit decision refs create gates, never legacy canonical files or answer times', () => {
  assert.equal(pendingDecisionFor({}), false)
  assert.equal(pendingDecisionFor({ run: { checkpoint: { decision: null } }, decision: snapshot }), false)
  assert.equal(pendingDecisionFor({ run, decision: snapshot }), true)
})

test('only exact readable path and hash receipts consume a decision; changed content reopens it', () => {
  const resolved = { ...run, checkpoint: { decision: path, resolvedDecisions: [{ path, contentHash: 'hash-a', answerIndex: 0, resolvedAt: '2026-11-04' }] } }
  assert.equal(pendingDecisionFor({ run: resolved, decision: snapshot }), false)
  for (const patch of [{ contentHash: 'hash-b' }, { readable: false }, { contentHash: null }, { path: 'other' }]) {
    assert.equal(pendingDecisionFor({ run: resolved, decision: { ...snapshot, ...patch } }), true)
  }
  assert.equal(pendingDecisionFor({ run: { ...run, checkpoint: { decision: path, resolvedDecisions: [{ path: 'other', contentHash: 'hash-a' }] } }, decision: snapshot }), true)
  assert.equal(pendingDecisionFor({ run }), true)
  assert.equal(pendingDecisionFor({ run: { checkpoint: { decision: path, resolvedDecisions: {} } }, decision: snapshot }), true)
})
