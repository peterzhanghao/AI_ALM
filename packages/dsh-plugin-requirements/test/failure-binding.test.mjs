/**
 * A run's failure card must describe *that run*.
 *
 * REQ-ALM-014 showed a red 「AI 自检发现未完成项 · 请求未通过宿主身份认证」 card for
 * days while RUN-009's own `failure` was null: the query took the requirement's
 * latest failure, and that event had `run: null`. These tests pin the binding and
 * the settlement path so an unrelated (or already settled) event can never
 * masquerade as the current run's diagnosis again.
 */
import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { requirements } from '../query.mjs'
import { resolveFailure } from '../../alm-core/src/requirements/failure.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const fixture = join(repoRoot, 'fixtures/order-refund')
const REQUIREMENT = 'REQ-PAY-001'
const RUN = 'RUN-T-1'

function repo() {
  const root = mkdtempSync(join(tmpdir(), 'alm-failure-binding-'))
  cpSync(fixture, root, { recursive: true })
  // Start from an empty ledger: the shared fixture carries its own history.
  if (existsSync(join(root, '.alm/failures'))) rmSync(join(root, '.alm/failures'), { recursive: true, force: true })
  return root
}

function writeRun(root, { status = 'waiting-input' } = {}) {
  const at = '2026-11-18T05:00:00.000Z'
  mkdirSync(join(root, '.alm/runs'), { recursive: true })
  writeFileSync(join(root, '.alm/runs', `${RUN}.json`), JSON.stringify({
    schema: 'alm.execution.run/v1',
    id: RUN,
    requirement: REQUIREMENT,
    change: 'CHG-T-1',
    carrier: 'dsh-session',
    status,
    phase: 'review-result',
    createdAt: at,
    updatedAt: at,
    heartbeatAt: at,
    attempts: 1,
    answers: [],
    events: [],
  }, null, 2))
}

function writeFailure(root, { id, run = null, summary, at = '2026-11-18T05:00:00.000Z' }) {
  mkdirSync(join(root, '.alm/failures'), { recursive: true })
  writeFileSync(join(root, '.alm/failures', `${id}.json`), JSON.stringify({
    schema: 'alm.failure.event/v1',
    id,
    requirement: REQUIREMENT,
    requirementRevision: 1,
    run,
    change: null,
    stage: 'develop',
    step: 'agent-turn',
    at,
    kind: 'business-outcome',
    kindLabel: '业务结果未达成',
    errorType: 'unauthenticated-subject',
    summary,
    evidence: { logs: [], artifacts: [], snapshot: null, testFileHashes: null },
    attempt: 1,
    outcome: 'failed',
    fingerprint: `fp-${id}`,
    defect: null,
    dedupeKey: `key-${id}`,
    analysisStatus: 'pending',
    analysis: null,
    createdAt: at,
    updatedAt: at,
  }, null, 2))
}

function itemFor(root) {
  return requirements(root).requirements.find((entry) => entry.id === REQUIREMENT)
}

test('an unbound failure is never presented as the current run failure', () => {
  const root = repo()
  try {
    writeRun(root)
    writeFailure(root, { id: 'FAIL-T-001', run: null, summary: '请求未通过宿主身份认证' })
    const item = itemFor(root)
    assert.equal(item.run.exists, true)
    assert.equal(item.run.id, RUN)
    assert.equal(item.run.failureDiagnostic, null, 'a run with run:null failures has no run diagnosis')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a failure bound to another run is not this run diagnosis either', () => {
  const root = repo()
  try {
    writeRun(root)
    writeFailure(root, { id: 'FAIL-T-002', run: 'RUN-OTHER', summary: '别的一轮失败' })
    assert.equal(itemFor(root).run.failureDiagnostic, null)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the bound failure is shown, and settling it clears the card', () => {
  const root = repo()
  try {
    writeRun(root)
    writeFailure(root, { id: 'FAIL-T-003', run: null, summary: '孤儿：身份未通过' })
    writeFailure(root, { id: 'FAIL-T-004', run: RUN, summary: '本轮执行失败', at: '2026-11-18T05:05:00.000Z' })

    const diagnosed = itemFor(root)
    assert.equal(diagnosed.run.failureDiagnostic.id, 'FAIL-T-004')
    assert.equal(diagnosed.run.failureDiagnostic.summary, '本轮执行失败')

    resolveFailure({ root, id: 'FAIL-T-004', actor: 'human:local', note: '已核对：确认与本轮无关' })
    assert.equal(itemFor(root).run.failureDiagnostic, null, 'a settled failure stops being the live diagnosis')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
