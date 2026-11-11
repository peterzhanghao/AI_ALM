import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { checkReport, indexReport } from '../../alm-core/src/commands.mjs'
import { runAcceptance } from '../../alm-core/src/acceptance/acceptance.mjs'
import { signRequirement } from '../../alm-core/src/requirements/signoff.mjs'
import { createCandidate } from '../../alm-core/src/requirements/candidate.mjs'
import { requirements } from '../query.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const fixture = join(repoRoot, 'fixtures/order-refund')

function tempFixture(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  cpSync(fixture, dir, { recursive: true })
  return dir
}

function gitInit(dir) {
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['add', '-A'], { cwd: dir })
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'init'], {
    cwd: dir,
  })
  return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
}

function assetOf(dir, id) {
  return indexReport(dir).assets.find((entry) => entry.id === id)
}

function reviewContext(dir, id) {
  const asset = assetOf(dir, id)
  return { asset, item: { id: asset.id, file: asset.source.path }, check: checkReport(dir) }
}

function writeAcceptanceConfig(dir, id, exitCode) {
  mkdirSync(join(dir, '.alm/acceptance'), { recursive: true })
  writeFileSync(
    join(dir, '.alm/acceptance', `${id}.json`),
    JSON.stringify({
      schema: 'alm.acceptance.config/v1',
      requirement: id,
      commands: [{ id: 'smoke', command: ['node', '-e', `process.exit(${exitCode})`] }],
    }),
  )
}

function itemOf(payload, id) {
  return payload.requirements.find((entry) => entry.id === id)
}

test('duplicate UID keeps both records with their own occurrence keys', () => {
  const dir = tempFixture('alm-anomaly-dup-')
  try {
    cpSync(join(dir, 'requirements/refund.sdoc'), join(dir, 'requirements/refund-copy.sdoc'))
    const payload = requirements(dir)
    assert.equal(payload.anomalySummary.count, 1)
    assert.deepEqual(payload.anomalySummary, { count: 1, duplicateId: 1, duplicateBusinessId: 0, dangling: 0 })

    const anomaly = payload.anomalies.find((entry) => entry.kind === 'duplicate-id')
    assert.ok(anomaly)
    assert.deepEqual(anomaly.requirementIds, ['REQ-PAY-001'])
    assert.equal(anomaly.occurrences.length, 2)
    for (const occurrence of anomaly.occurrences) {
      assert.match(occurrence.occurrenceKey, /^REQ-PAY-001@requirements\/.+\.sdoc:\d+$/)
      assert.ok(occurrence.file)
      assert.ok(occurrence.line >= 1)
      assert.equal(occurrence.uid, 'REQ-PAY-001')
    }
    assert.equal(new Set(anomaly.occurrences.map((entry) => entry.occurrenceKey)).size, 2)

    const records = payload.requirements.filter((entry) => entry.id === 'REQ-PAY-001')
    assert.equal(records.length, 2, 'both duplicate records must stay in the payload')
    assert.equal(new Set(records.map((entry) => entry.occurrenceKey)).size, 2)
    for (const record of records) {
      assert.equal(record.decision.state, 'needs-clarification')
      assert.equal(record.nextAction, 'fix-anomaly')
      assert.ok(record.anomalies.some((entry) => entry.kind === 'duplicate-id'))
      assert.ok(
        record.anomalies.every(
          (entry) => entry.kind !== 'duplicate-id' || entry.ref === record.occurrenceKey,
          'item anomaly ref must be the record occurrence key',
        ),
      )
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('same business id on two UIDs is reported without merging the records', () => {
  const dir = tempFixture('alm-anomaly-biz-')
  try {
    const refund = join(dir, 'requirements/refund.sdoc')
    const idempotent = join(dir, 'requirements/refund-idempotent.sdoc')
    writeFileSync(refund, readFileSync(refund, 'utf8').replace('REVISION: 1\n', 'REVISION: 1\nBUSINESS_ID: SHARED-1\n'))
    writeFileSync(
      idempotent,
      readFileSync(idempotent, 'utf8').replace('REVISION: 2\n', 'REVISION: 2\nBUSINESS_ID: SHARED-1\n'),
    )

    const payload = requirements(dir)
    assert.equal(payload.anomalySummary.duplicateBusinessId, 1)
    const anomaly = payload.anomalies.find((entry) => entry.kind === 'duplicate-business-id')
    assert.ok(anomaly)
    assert.deepEqual([...anomaly.requirementIds].sort(), ['REQ-PAY-001', 'REQ-PAY-004'])
    assert.equal(anomaly.occurrences.length, 2)

    const first = itemOf(payload, 'REQ-PAY-001')
    const second = itemOf(payload, 'REQ-PAY-004')
    assert.equal(first.businessId, 'SHARED-1')
    assert.equal(second.businessId, 'SHARED-1')
    assert.notEqual(first.occurrenceKey, second.occurrenceKey)
    assert.equal(first.decision.state, 'needs-clarification')
    assert.equal(second.decision.state, 'needs-clarification')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a dangling relation is visible in the anomaly queue but not mixed into gaps', () => {
  const dir = tempFixture('alm-anomaly-rel-')
  try {
    const file = join(dir, 'requirements/refund.sdoc')
    writeFileSync(file, `${readFileSync(file, 'utf8')}\n[RELATION]\nType: allocated_to\nValue: MOD-NOPE\n`)

    const payload = requirements(dir)
    const anomaly = payload.anomalies.find((entry) => entry.kind === 'dangling-relation')
    assert.ok(anomaly)
    assert.equal(anomaly.from, 'REQ-PAY-001')
    assert.equal(anomaly.type, 'allocated_to')
    assert.equal(anomaly.target, 'MOD-NOPE')
    assert.deepEqual(anomaly.requirementIds, ['REQ-PAY-001'])
    assert.match(anomaly.message, /MOD-NOPE/)
    assert.equal(payload.anomalySummary.dangling, 1)

    const item = itemOf(payload, 'REQ-PAY-001')
    const visible = item.anomalies.find((entry) => entry.kind === 'dangling-relation')
    assert.ok(visible)
    assert.equal(visible.ref, item.occurrenceKey)
    // AI suggestions are advisory. The dangling relation remains a first-class
    // data anomaly and therefore asks for clarification directly.
    assert.equal(item.decision.state, 'needs-clarification')
    assert.equal(item.nextAction, 'fix-anomaly')
    assert.equal(item.decision.topGap.code, 'dangling-relation')
    assert.match(item.decision.topGap.message, /MOD-NOPE|悬空|dangling/)
    // Tracking gaps stay exactly COV-001/COV-002; anomalies are a separate list.
    assert.ok(payload.gaps.every((gap) => gap.rule === 'COV-001' || gap.rule === 'COV-002'))
    assert.ok(!payload.gaps.some((gap) => gap.kind === 'dangling-relation'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('decision: no stored review proceeds directly to executable acceptance evidence', () => {
  const item = itemOf(requirements(fixture), 'REQ-PAY-001')
  assert.equal(item.decision.state, 'unchecked')
  assert.equal(item.decision.label, '未检查')
  assert.equal(item.decision.tone, 'neutral')
  assert.equal(item.decision.topGap.code, 'acceptance-missing')
  assert.equal(item.decision.nextStep.action, 'run-acceptance')
  assert.equal(item.nextAction, 'run-acceptance')
  assert.equal(item.decision.signoff.allowed, false)
  assert.equal('review' in item, false)
  assert.equal(item.humanAcceptance.signoff, null)
})

test('decision: legacy/incomplete acceptance evidence is stale, never a pass', () => {
  const dir = tempFixture('alm-decision-stale-')
  try {
    const head = gitInit(dir)
    writeAcceptanceConfig(dir, 'REQ-PAY-001', 0)
    mkdirSync(join(dir, '.alm/acceptance/REQ-PAY-001'), { recursive: true })
    writeFileSync(
      join(dir, '.alm/acceptance/REQ-PAY-001', `${head}.json`),
      JSON.stringify({
        schema: 'alm.acceptance/v1',
        requirement: 'REQ-PAY-001',
        headSha: head,
        result: 'pass',
        finishedAt: '2026-10-31T00:00:00.000Z',
        commands: [{ id: 'smoke', exitCode: 0 }],
      }),
    )
    const item = itemOf(requirements(dir), 'REQ-PAY-001')
    assert.equal(item.acceptance.latest.complete, false)
    assert.equal(item.acceptance.latest.current, false)
    assert.equal(item.decision.state, 'stale')
    assert.equal(item.decision.label, '证据过期')
    assert.equal(item.decision.tone, 'warn')
    assert.equal(item.decision.topGap.code, 'evidence-stale')
    assert.equal(item.nextAction, 'rerun-evidence')
    assert.equal(item.decision.signoff.allowed, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('decision: a failing acceptance run is failed, never a pass', () => {
  const dir = tempFixture('alm-decision-failed-')
  try {
    gitInit(dir)
    writeAcceptanceConfig(dir, 'REQ-PAY-001', 1)
    const context = reviewContext(dir, 'REQ-PAY-001')
    const result = runAcceptance({
      root: dir,
      requirementId: 'REQ-PAY-001',
      apply: true,
      context: { asset: context.asset, assets: indexReport(dir).assets, actor: 'human:local', project: 'PAY', file: context.asset.source.path },
    })
    assert.equal(result.result, 'fail')
    const item = itemOf(requirements(dir), 'REQ-PAY-001')
    assert.equal(item.acceptance.latest.complete, true)
    assert.equal(item.acceptance.latest.current, true)
    assert.equal(item.decision.state, 'failed')
    assert.equal(item.decision.label, '执行失败')
    assert.equal(item.decision.tone, 'error')
    assert.equal(item.nextAction, 'run-acceptance')
    assert.equal(item.decision.signoff.allowed, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('decision: complete passing evidence skips optional review adoption and waits for candidate then human', () => {
  const dir = tempFixture('alm-decision-ready-')
  try {
    gitInit(dir)
    writeAcceptanceConfig(dir, 'REQ-PAY-001', 0)
    const context = reviewContext(dir, 'REQ-PAY-001')
    const run = runAcceptance({
      root: dir,
      requirementId: 'REQ-PAY-001',
      apply: true,
      context: { asset: context.asset, assets: indexReport(dir).assets, actor: 'human:local', project: 'PAY', file: context.asset.source.path },
    })
    assert.equal(run.result, 'pass')

    const ready = itemOf(requirements(dir), 'REQ-PAY-001')
    assert.equal(ready.acceptance.latest.complete, true)
    assert.equal(ready.acceptance.latest.current, true)
    assert.equal(ready.decision.state, 'unchecked')
    assert.equal(ready.decision.label, '未检查')
    assert.equal(ready.decision.topGap.code, 'candidate-missing')
    assert.equal(ready.nextAction, 'create-candidate')
    assert.equal(ready.decision.signoff.allowed, false)

    assert.equal(ready.decision.humanAccepted, false)

    // The candidate binds the content the acceptance evidence was produced
    // against; only then does the requirement become 待验收.
    createCandidate({ root: dir, asset: context.asset, acceptance: ready.acceptance, actor: 'ai:adopted' })
    const candidate = itemOf(requirements(dir), 'REQ-PAY-001')
    assert.equal(candidate.decision.candidate.current, true)
    assert.equal(candidate.decision.state, 'ready-for-human')
    assert.equal(candidate.decision.label, '待验收')
    assert.equal(candidate.decision.signoff.allowed, true, 'the human decision is now the next step')

    // Only an explicit human sign-off turns the candidate into 已验收.
    const signed = signRequirement({
      root: dir,
      asset: context.asset,
      actor: 'human:local',
      subject: { id: 'human:local', kind: 'human', source: 'local-session' },
      apply: true,
    })
    assert.equal(signed.applied, true)
    const verified = itemOf(requirements(dir), 'REQ-PAY-001')
    assert.equal(verified.decision.state, 'verified')
    assert.equal(verified.decision.label, '已验收')
    assert.equal(verified.decision.humanAccepted, true)
    assert.equal(verified.nextAction, 'release', 'accepted delivery still needs a release decision')
    assert.equal(verified.nextActionLabel, '决定发布')
    assert.equal(verified.decision.signoff.allowed, false, 'already accepted needs no second sign-off')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
