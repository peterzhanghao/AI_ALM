import test from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, lstatSync, rmSync, writeFileSync, symlinkSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { resolveRunDecision, pendingDecisionFor } from '../../alm-core/src/requirements/run-decision.mjs'
import * as runs from '../../alm-core/src/requirements/run.mjs'
import { requirements } from '../query.mjs'
import RequirementsService from '../index.js'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'alm-projection-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  cpSync(new URL('../../../fixtures/order-refund/', import.meta.url), root, { recursive: true })
  const run = runs.createRun({ root, requirementId: 'REQ-PAY-001', carrier: 'mock' }).run
  runs.updateRun({ root, runId: run.id, status: 'waiting-input', phase: 'awaiting-human', apply: true })
  const path = `.alm/runs/${run.id}-decision.md`
  const service = Object.create(RequirementsService.prototype)
  return { root, run: runs.readRun(root, run.id), path, service }
}
function snapshot(root) {
  const result = {}
  function visit(dir, prefix = '') {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name), rel = `${prefix}${name}`
      const stat = lstatSync(path)
      if (stat.isSymbolicLink()) result[rel] = 'link'
      else if (stat.isDirectory()) visit(path, `${rel}/`)
      else result[rel] = readFileSync(path).toString('base64')
    }
  }
  visit(root)
  return result
}
function project(f) { return requirements(f.root).requirements.find(item => item.id === 'REQ-PAY-001') }

test('conventional technical request projects actual native answer action and same-byte identity without writes', t => {
  const f = fixture(t)
  const text = '# Technical problem\n\nspawn EPERM; permission needs human review'
  writeFileSync(join(f.root, f.path), text)
  const before = snapshot(f.root)
  const item = project(f)
  const host = f.service.runDecision({ root: f.root, requirementId: 'REQ-PAY-001' })
  assert.equal(item.run.awaitingAnswer, true)
  assert.equal(item.run.idleHandback, false)
  assert.equal(item.run.decision, f.path)
  assert.deepEqual(item.run.decisionIdentity, host.decisionIdentity)
  assert.equal(host.decisionIdentity.contentHash, createHash('sha256').update(text).digest('hex'))
  assert.deepEqual(item.run.decisionPresentation, host.presentation)
  assert.equal(item.run.decisionPresentation.complete, false)
  assert.equal(item.detailView.currentMatter.kind, 'technical-block')
  assert.equal(item.detailView.primaryAction.id, 'answer-run')
  assert.equal(item.detailView.primaryAction.enabled, true)
  assert.deepEqual(snapshot(f.root), before)
})

test('restart interruption keeps failed facts but pending decision reaches the same native answer entry', t => {
  const f = fixture(t)
  writeFileSync(join(f.root, f.path), 'Human review required')
  runs.updateRun({ root: f.root, runId: f.run.id, status: 'failed', phase: 'interrupted', failure: { code: 'host-restart', message: 'Host lost' }, apply: true })
  const before = snapshot(f.root), item = project(f)
  const host = f.service.runDecision({ root: f.root, requirementId: 'REQ-PAY-001' })
  assert.equal(item.run.status, 'failed')
  assert.equal(item.run.active, false)
  assert.equal(item.run.failure.code, 'host-restart')
  assert.equal(item.run.awaitingAnswer, true)
  assert.equal(item.detailView.primaryAction.id, 'answer-run')
  assert.equal(host.runId, f.run.id)
  assert.deepEqual(host.decisionIdentity, item.run.decisionIdentity)
  assert.deepEqual(snapshot(f.root), before)
  rmSync(join(f.root, f.path))
  assert.equal(project(f).detailView.primaryAction.id, 'resume-run')
})

test('no conventional file remains genuine idle handback, not a phantom decision', t => {
  const f = fixture(t), before = snapshot(f.root)
  const item = project(f)
  assert.equal(item.run.awaitingAnswer, false)
  assert.equal(item.run.idleHandback, true)
  assert.equal(item.run.decision, null)
  assert.equal(item.detailView.primaryAction.id, 'continue-run')
  assert.deepEqual(snapshot(f.root), before)
})

test('explicit wins, exact resolved bytes stay resolved on touch and reopen on replacement', t => {
  const f = fixture(t), explicit = '.alm/runs/explicit.md'
  writeFileSync(join(f.root, f.path), 'fallback')
  writeFileSync(join(f.root, explicit), 'explicit')
  const run = { ...f.run, checkpoint: { decision: explicit } }
  const result = resolveRunDecision(f.root, run)
  assert.equal(result.path, explicit)
  assert.equal(result.text, 'explicit')
  const resolved = { ...run, checkpoint: { ...run.checkpoint, resolvedDecisions: [{ path: explicit, contentHash: result.identity.sha256 }] } }
  utimesSync(join(f.root, explicit), new Date(), new Date())
  assert.equal(resolveRunDecision(f.root, resolved).pending, false)
  writeFileSync(join(f.root, explicit), 'changed')
  assert.equal(resolveRunDecision(f.root, resolved).pending, true)
  assert.equal(pendingDecisionFor({ run: { checkpoint: {} } }), false)
  assert.equal(resolveRunDecision(f.root, { id: 'RUN-../escape' }).path, null)
})

test('missing explicit, unsafe Windows paths and nonfiles fail closed with no readable identity', t => {
  const f = fixture(t)
  for (const path of ['.alm/runs/missing.md', '../outside.md', '.alm/runs/..\\outside.md', '.alm/runs/file.md:stream']) {
    const result = resolveRunDecision(f.root, { ...f.run, checkpoint: { decision: path } })
    assert.equal(result.pending, true)
    assert.equal(result.identity, null)
    assert.equal(result.text, null)
  }
  mkdirSync(join(f.root, f.path))
  const item = project(f)
  assert.equal(item.run.awaitingAnswer, true)
  assert.equal(item.run.decisionReadable, false)
  assert.equal(item.run.decisionIdentity, null)
  assert.equal(item.run.decisionPresentation.complete, false)
  assert.equal(item.detailView.currentMatter.kind, 'technical-block')
  assert.notEqual(item.detailView.primaryAction.id, 'continue-run')
})

test('linked or missing ancestors never permit conventional continue or external reads', t => {
  const f = fixture(t)
  const outside = join(f.root, 'outside')
  mkdirSync(outside)
  writeFileSync(join(outside, `${f.run.id}-decision.md`), 'must not read')
  rmSync(join(f.root, '.alm/runs'), { recursive: true })
  assert.equal(resolveRunDecision(f.root, f.run).pending, true)
  symlinkSync(outside, join(f.root, '.alm/runs'), 'junction')
  const result = resolveRunDecision(f.root, f.run)
  assert.equal(result.pending, true)
  assert.equal(result.identity, null)
  assert.equal(result.text, null)
})
