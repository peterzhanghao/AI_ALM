import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { indexReport } from '../../src/commands.mjs'
import { applyRehearsal, previewRehearsal } from '../../src/rehearsal/rehearsal.mjs'
import {
  applyRequirementUpdate,
  planRequirementUpdate,
  requirementBaseline,
} from '../../src/requirements/update.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
const fixture = join(repoRoot, 'fixtures/order-refund')
const dirs = []
const SDOC = join('requirements', 'refund-idempotent.sdoc')
const BRIEF = join('requirements', 'briefs', 'REQ-PAY-004.md')

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'alm-rehearsal-'))
  dirs.push(root)
  cpSync(fixture, root, { recursive: true })
  git(root, ['init', '-q'])
  git(root, ['add', '-A'])
  git(root, ['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'fixture'])
  return root
}

function loadRequirement(root, id = 'REQ-PAY-004') {
  const index = indexReport(root)
  return { index, asset: index.assets.find((entry) => entry.id === id) }
}

function auditFiles(root) {
  const dir = join(root, '.alm', 'audit', 'requirements')
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((name) => name.endsWith('.json')).sort()
}

function makeAsset({ id, type = 'requirement', title = id, links = [], extra = {} }) {
  return {
    id,
    type,
    title,
    status: 'proposed',
    owner: 'team-payments',
    links,
    extra,
    source: { path: `requirements/${id.toLowerCase()}.sdoc`, format: 'sdoc', line: 1 },
  }
}

test.after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

test('previewRehearsal reports the impact closure per relation semantics without writing', () => {
  const root = makeRepo()
  const { index, asset } = loadRequirement(root)
  const sdocBefore = readFileSync(join(root, SDOC), 'utf8')
  const briefBefore = readFileSync(join(root, BRIEF), 'utf8')
  const change = { field: 'title', value: '同一幂等键重复退款返回同一退款单（修订）' }

  const preview = previewRehearsal({ root, asset, assets: index.assets, change })

  assert.equal(preview.schema, 'alm.rehearsal/v1')
  assert.equal(preview.applied, false)
  assert.deepEqual(preview.writes, [])
  assert.match(preview.baseline.contentHash, /^[0-9a-f]{64}$/)
  assert.match(preview.baseline.relationHash, /^[0-9a-f]{64}$/)
  assert.match(preview.baseline.headSha, /^[0-9a-f]{40}$/)
  assert.equal(preview.baseline.revision, 2)
  assert.equal(preview.change.field, 'title')
  assert.equal(preview.change.before, '同一幂等键的重复退款请求返回同一退款单')
  assert.equal(preview.change.after, change.value)
  assert.equal(preview.requirementBefore.title, preview.change.before)
  assert.equal(preview.requirementAfter.title, change.value)
  assert.equal(preview.requirementAfter.revision, 3)

  assert.equal(preview.impact.advisory, true)
  assert.equal(preview.impact.coverage.maxDepth, 4)
  assert.equal(preview.impact.coverage.truncated, false)
  const reverify = preview.impact.groups.reverify.map((node) => node.id)
  assert.ok(reverify.includes('TEST-PAY-004'))
  assert.ok(reverify.includes('TEST-PAY-005'))
  const reconfirm = preview.impact.groups.reconfirm.map((node) => node.id)
  assert.ok(reconfirm.includes('MOD-PAY-REFUND'))
  assert.ok(reconfirm.includes('ADR-PAY-003'))
  // parent_of is bidirectional: the parent requirement is reconfirmed as well.
  assert.ok(reconfirm.includes('REQ-PAY-001'))
  assert.equal(preview.impact.blindSpots.length, 0)

  assert.equal(readFileSync(join(root, SDOC), 'utf8'), sdocBefore)
  assert.equal(readFileSync(join(root, BRIEF), 'utf8'), briefBefore)
  assert.equal(git(root, ['status', '--porcelain']).trim(), '')
  assert.ok(!existsSync(join(root, '.alm', 'audit')))
})

test('planRequirementUpdate rewrites TITLE/PRIORITY/REVISION and preserves every other line', () => {
  const root = makeRepo()
  const { index, asset } = loadRequirement(root)
  const sdocFile = join(root, SDOC)
  const original = readFileSync(sdocFile, 'utf8')

  const titlePlan = planRequirementUpdate({
    root,
    asset,
    change: { field: 'title', value: '  同一幂等键重复退款返回同一退款单  ' },
  })
  assert.equal(titlePlan.file, 'requirements/refund-idempotent.sdoc')
  assert.equal(titlePlan.before.revision, 2)
  assert.equal(titlePlan.after.revision, 3)
  assert.equal(titlePlan.after.title, '同一幂等键重复退款返回同一退款单')
  const rewritten = titlePlan.after.content
  assert.ok(rewritten.split('\n').includes('UID: REQ-PAY-004'))
  assert.ok(rewritten.split('\n').includes('TITLE: 同一幂等键重复退款返回同一退款单'))
  assert.ok(rewritten.split('\n').includes('REVISION: 3'))
  assert.ok(rewritten.split('\n').includes('PRIORITY: P1'))
  assert.ok(rewritten.split('\n').includes('BRIEF: requirements/briefs/REQ-PAY-004.md'))
  assert.ok(rewritten.split('\n').includes('SOURCE: chat,meeting'))
  // The [DOCUMENT] title is not a requirement field and must stay untouched.
  assert.ok(rewritten.split('\n').includes('TITLE: 退款幂等'))
  assert.equal((rewritten.match(/^\[RELATION\]$/gm) ?? []).length, 4)
  assert.ok(rewritten.includes('Value: TEST-PAY-005'))
  assert.equal(readFileSync(sdocFile, 'utf8'), original, 'planning must not write')

  const priorityPlan = planRequirementUpdate({ root, asset, change: { field: 'priority', value: 'P2' } })
  assert.equal(priorityPlan.after.priority, 'P2')
  assert.ok(priorityPlan.after.content.split('\n').includes('PRIORITY: P2'))
  assert.ok(priorityPlan.after.content.split('\n').includes('REVISION: 3'))

  const briefPlan = planRequirementUpdate({ root, asset, change: { field: 'brief', value: '# 新简报\n\n正文\n' } })
  assert.equal(briefPlan.briefFile, 'requirements/briefs/REQ-PAY-004.md')
  assert.equal(briefPlan.briefContent, '# 新简报\n\n正文\n')
  assert.ok(briefPlan.after.content.split('\n').includes('REVISION: 3'))
  assert.equal(readFileSync(sdocFile, 'utf8'), original)

  assert.throws(
    () => planRequirementUpdate({ root, asset, change: { field: 'title', value: 'bad\ntitle' } }),
    (error) => error.code === 'invalid-title',
  )
  assert.throws(
    () => planRequirementUpdate({ root, asset, change: { field: 'priority', value: 'P9' } }),
    (error) => error.code === 'invalid-priority',
  )
  assert.throws(
    () => planRequirementUpdate({ root, asset, change: { field: 'owner', value: 'team-x' } }),
    (error) => error.code === 'invalid-change',
  )
  const withoutBrief = index.assets.find((entry) => entry.id === 'REQ-PAY-001')
  assert.throws(
    () => planRequirementUpdate({ root, asset: withoutBrief, change: { field: 'brief', value: '# x' } }),
    (error) => error.code === 'brief-missing',
  )
})

test('applyRequirementUpdate applies atomically, writes the audit event and enforces CAS', () => {
  const root = makeRepo()
  const { asset } = loadRequirement(root)
  const baseline = requirementBaseline({ root, asset })

  const result = applyRequirementUpdate({
    root,
    asset,
    change: { field: 'priority', value: 'P2' },
    expectedBaseline: baseline,
    actor: 'human:local',
    idempotencyKey: 'direct-update-1',
  })

  assert.equal(result.applied, true)
  assert.equal(result.idempotent, false)
  assert.equal(result.revision, 3)
  assert.equal(result.before.priority, 'P1')
  assert.equal(result.after.priority, 'P2')
  assert.equal(result.signoffInvalidated, true)
  assert.equal(result.evidenceStale, true)
  assert.match(result.auditFile, /^\.alm\/audit\/requirements\/REQ-PAY-004-\d{8}T\d{9}Z-direct-update-1\.json$/)

  const sdoc = readFileSync(join(root, SDOC), 'utf8')
  assert.ok(sdoc.split('\n').includes('PRIORITY: P2'))
  assert.ok(sdoc.split('\n').includes('REVISION: 3'))
  assert.ok(sdoc.split('\n').includes('TITLE: 同一幂等键的重复退款请求返回同一退款单'))

  const audit = JSON.parse(readFileSync(join(root, result.auditFile), 'utf8'))
  assert.equal(audit.schema, 'alm.audit/v1')
  assert.equal(audit.requirement, 'REQ-PAY-004')
  assert.equal(audit.actor, 'human:local')
  assert.equal(audit.change.field, 'priority')
  assert.equal(audit.change.value, 'P2')
  assert.equal(audit.before.revision, 2)
  assert.equal(audit.after.revision, 3)
  assert.deepEqual(audit.baseline, baseline)
  assert.ok(audit.at)

  const indexed = indexReport(root).assets.find((entry) => entry.id === 'REQ-PAY-004')
  assert.equal(indexed.extra.priority, 'P2')
  assert.equal(indexed.extra.revision, 3)

  assert.throws(
    () =>
      applyRequirementUpdate({
        root,
        asset: indexed,
        change: { field: 'title', value: '陈旧预览' },
        expectedBaseline: baseline,
        actor: 'human:local',
        idempotencyKey: 'direct-update-2',
      }),
    (error) => error.code === 'stale-preview' && error.status === 409,
  )
  assert.equal(auditFiles(root).length, 1, 'a rejected CAS must not write an audit event')
})

test('applyRehearsal rejects a stale preview with 409 and leaves the file alone', () => {
  const root = makeRepo()
  const { index, asset } = loadRequirement(root)
  const change = { field: 'title', value: '新标题' }
  const preview = previewRehearsal({ root, asset, assets: index.assets, change })

  const sdocFile = join(root, SDOC)
  const edited = readFileSync(sdocFile, 'utf8').replace(
    'TITLE: 同一幂等键的重复退款请求返回同一退款单',
    'TITLE: 被他人修改的标题',
  )
  writeFileSync(sdocFile, edited, 'utf8')

  assert.throws(
    () =>
      applyRehearsal({
        root,
        asset,
        assets: index.assets,
        change,
        expectedBaseline: preview.baseline,
        actor: 'human:local',
        idempotencyKey: 'stale-1',
      }),
    (error) => error.code === 'stale-preview' && error.status === 409,
  )
  assert.equal(readFileSync(sdocFile, 'utf8'), edited)
  assert.ok(!existsSync(join(root, '.alm', 'audit')))
})

test('applyRehearsal applies the previewed title and invalidates sign-off/evidence', () => {
  const root = makeRepo()
  const { index, asset } = loadRequirement(root)
  const change = { field: 'title', value: '同一幂等键重复退款返回同一退款单（修订）' }
  const preview = previewRehearsal({ root, asset, assets: index.assets, change })

  const result = applyRehearsal({
    root,
    asset,
    assets: index.assets,
    change,
    expectedBaseline: preview.baseline,
    actor: 'human:local',
    idempotencyKey: 'rehearsal-apply-1',
  })

  assert.equal(result.schema, 'alm.rehearsal/v1')
  assert.equal(result.applied, true)
  assert.equal(result.idempotent, false)
  assert.equal(result.revision, 3)
  assert.equal(result.requirementBefore.title, preview.requirementBefore.title)
  assert.equal(result.requirementAfter.title, change.value)
  assert.equal(result.impact.advisory, true)
  assert.equal(result.signoffInvalidated, true)
  assert.equal(result.evidenceStale, true)

  const sdoc = readFileSync(join(root, SDOC), 'utf8')
  assert.ok(sdoc.split('\n').includes(`TITLE: ${change.value}`))
  assert.ok(sdoc.split('\n').includes('REVISION: 3'))
  assert.equal((sdoc.match(/^\[RELATION\]$/gm) ?? []).length, 4)
  assert.equal(indexReport(root).assets.find((entry) => entry.id === 'REQ-PAY-004').title, change.value)

  const audit = JSON.parse(readFileSync(join(root, result.auditFile), 'utf8'))
  assert.equal(audit.schema, 'alm.audit/v1')
  assert.equal(audit.requirement, 'REQ-PAY-004')
  assert.equal(audit.impactSummary.advisory, true)
  assert.ok(audit.impactSummary.groups.reverify >= 2)
  assert.equal(audit.baseline.contentHash, preview.baseline.contentHash)
})

test('applyRehearsal replays the same idempotency key without a second write', () => {
  const root = makeRepo()
  const { index, asset } = loadRequirement(root)
  const change = { field: 'title', value: '幂等重放标题' }
  const preview = previewRehearsal({ root, asset, assets: index.assets, change })
  const input = {
    root,
    asset,
    assets: index.assets,
    change,
    expectedBaseline: preview.baseline,
    actor: 'human:local',
    idempotencyKey: 'replay-1',
  }

  const first = applyRehearsal(input)
  const second = applyRehearsal(input)

  assert.equal(first.idempotent, false)
  assert.equal(second.idempotent, true)
  assert.equal(second.applied, true)
  assert.equal(second.revision, first.revision)
  assert.equal(second.auditFile, first.auditFile)
  assert.equal(auditFiles(root).length, 1, 'replay must not append a second audit event')
  const sdoc = readFileSync(join(root, SDOC), 'utf8')
  assert.equal((sdoc.match(/^REVISION: 3$/gm) ?? []).length, 1)
  assert.ok(!/^REVISION: 4$/m.test(sdoc))
})

test('applyRehearsal writes a brief change to requirements/briefs and bumps revision', () => {
  const root = makeRepo()
  const { index, asset } = loadRequirement(root)
  const change = { field: 'brief', value: '# REQ-PAY-004 退款幂等\n\n## 背景\n\n改后的背景\n' }
  const preview = previewRehearsal({ root, asset, assets: index.assets, change })

  assert.equal(preview.change.field, 'brief')
  assert.match(preview.change.before, /## 背景/)
  assert.equal(preview.requirementAfter.title, asset.title)

  const result = applyRehearsal({
    root,
    asset,
    assets: index.assets,
    change,
    expectedBaseline: preview.baseline,
    actor: 'human:local',
    idempotencyKey: 'brief-1',
  })

  assert.equal(result.applied, true)
  assert.equal(result.briefFile, 'requirements/briefs/REQ-PAY-004.md')
  assert.equal(readFileSync(join(root, BRIEF), 'utf8'), change.value)
  const sdoc = readFileSync(join(root, SDOC), 'utf8')
  assert.ok(sdoc.split('\n').includes('REVISION: 3'))
  assert.ok(sdoc.split('\n').includes('TITLE: 同一幂等键的重复退款请求返回同一退款单'))
  assert.equal(result.writes.length, 2)
})

test('applyRehearsal rolls back partial writes and throws write-failed with draftRetained', () => {
  const root = makeRepo()
  const { index, asset } = loadRequirement(root)
  const sdocFile = join(root, SDOC)
  const briefFile = join(root, BRIEF)
  const sdocBefore = readFileSync(sdocFile, 'utf8')
  const briefBefore = readFileSync(briefFile, 'utf8')
  const change = { field: 'brief', value: '# 写入失败前的简报\n' }
  const preview = previewRehearsal({ root, asset, assets: index.assets, change })

  let writes = 0
  const failingWrite = (path, content, encoding) => {
    writes += 1
    if (writes === 2) throw new Error('simulated disk failure')
    writeFileSync(path, content, encoding)
  }

  assert.throws(
    () =>
      applyRehearsal({
        root,
        asset,
        assets: index.assets,
        change,
        expectedBaseline: preview.baseline,
        actor: 'human:local',
        idempotencyKey: 'fail-1',
        writeFile: failingWrite,
      }),
    (error) => {
      assert.equal(error.code, 'write-failed')
      assert.equal(error.status, 500)
      assert.equal(error.applied, false)
      assert.equal(error.draftRetained, true)
      assert.ok(error.auditFile)
      assert.ok(existsSync(join(root, error.auditFile)), 'audit draft must be retained')
      return true
    },
  )

  assert.equal(writes, 2)
  assert.equal(readFileSync(briefFile, 'utf8'), briefBefore, 'the first written file must be rolled back')
  assert.equal(readFileSync(sdocFile, 'utf8'), sdocBefore)
  assert.equal(auditFiles(root).length, 1, 'the failed attempt keeps one audit draft')

  const leftoverTemps = readdirSync(join(root, 'requirements', 'briefs')).filter((name) => name.includes('.tmp-'))
  assert.deepEqual(leftoverTemps, [])
  assert.ok(!existsSync(join(root, '.alm', 'audit', 'requirements', 'idempotency')), 'a failed write has no replay record')

  // The retained draft means the same key can be retried safely.
  const retry = applyRehearsal({
    root,
    asset,
    assets: index.assets,
    change,
    expectedBaseline: preview.baseline,
    actor: 'human:local',
    idempotencyKey: 'fail-1',
  })
  assert.equal(retry.applied, true)
  assert.equal(retry.idempotent, false)
  assert.equal(readFileSync(briefFile, 'utf8'), change.value)
  assert.equal(auditFiles(root).length, 2, 'each attempt keeps its own audit event')
})

test('previewRehearsal follows relation cycles without looping and reports them', () => {
  const root = makeRepo()
  const a = makeAsset({ id: 'REQ-PAY-101', links: [{ type: 'parent_of', target: 'REQ-PAY-102' }] })
  const b = makeAsset({ id: 'REQ-PAY-102', links: [{ type: 'parent_of', target: 'REQ-PAY-101' }] })

  const preview = previewRehearsal({
    root,
    asset: a,
    assets: [a, b],
    change: { field: 'title', value: '环测试' },
  })

  assert.ok(preview.impact.cycles.length >= 1)
  const cycleTexts = preview.impact.cycles.map((ids) => ids.join('>'))
  assert.ok(cycleTexts.some((text) => text.includes('REQ-PAY-101') && text.includes('REQ-PAY-102')))
  assert.ok(preview.impact.paths.length <= 50)
  assert.equal(preview.impact.coverage.truncated, false)
  assert.ok(preview.impact.groups.reconfirm.some((node) => node.id === 'REQ-PAY-102'))
  assert.equal(preview.applied, false)
})

test('previewRehearsal reports an explicit no-relations blind spot', () => {
  const root = makeRepo()
  const lonely = makeAsset({ id: 'REQ-PAY-201' })

  const preview = previewRehearsal({
    root,
    asset: lonely,
    assets: [lonely],
    change: { field: 'priority', value: 'P2' },
  })

  assert.deepEqual(preview.impact.groups, { reverify: [], reconfirm: [], reference: [] })
  assert.deepEqual(preview.impact.paths, [])
  const blind = preview.impact.blindSpots.find((entry) => entry.kind === 'no-relations')
  assert.ok(blind, 'an empty relation graph must be a blind spot')
  assert.equal(blind.detail, '未登记影响（不等于无影响）')
  assert.equal(preview.impact.advisory, true)
})

test('previewRehearsal reports unresolved targets and unknown relations as blind spots', () => {
  const root = makeRepo()
  const moduleAsset = makeAsset({ id: 'MOD-PAY-999', type: 'module' })
  const asset = makeAsset({
    id: 'REQ-PAY-301',
    links: [
      { type: 'parent_of', target: 'REQ-PAY-999' },
      { type: 'invented_by', target: 'MOD-PAY-999' },
    ],
  })

  const preview = previewRehearsal({
    root,
    asset,
    assets: [asset, moduleAsset],
    change: { field: 'title', value: '盲区测试' },
  })

  const kinds = preview.impact.blindSpots.map((entry) => entry.kind).sort()
  assert.deepEqual(kinds, ['unknown-relation', 'unresolved-target'])
  assert.deepEqual(preview.impact.groups, { reverify: [], reconfirm: [], reference: [] })
  assert.deepEqual(preview.impact.paths, [])
})

test('previewRehearsal keeps both A→B→C and A→C paths across all three groups', () => {
  const root = makeRepo()
  const moduleAsset = makeAsset({ id: 'MOD-PAY-777', type: 'module' })
  const testAsset = makeAsset({ id: 'TEST-PAY-777', type: 'acceptance-test' })
  const a = makeAsset({
    id: 'REQ-PAY-401',
    title: 'A',
    links: [
      { type: 'allocated_to', target: 'MOD-PAY-777' },
      { type: 'verified_by', target: 'TEST-PAY-777' },
      { type: 'parent_of', target: 'REQ-PAY-402' },
      { type: 'supersedes', target: 'REQ-PAY-403' },
    ],
  })
  const b = makeAsset({ id: 'REQ-PAY-402', title: 'B', links: [{ type: 'parent_of', target: 'REQ-PAY-403' }] })
  const c = makeAsset({ id: 'REQ-PAY-403', title: 'C' })

  const preview = previewRehearsal({
    root,
    asset: a,
    assets: [a, b, c, moduleAsset, testAsset],
    change: { field: 'title', value: '多路径' },
  })

  const toC = preview.impact.paths.filter((path) => path.to === 'REQ-PAY-403')
  assert.equal(toC.length, 2, 'both paths to C must be kept')
  assert.deepEqual(toC.map((path) => path.depth).sort((left, right) => left - right), [1, 2])

  const direct = toC.find((path) => path.depth === 1)
  assert.deepEqual(direct.kinds, ['reference'])
  assert.equal(direct.relations.length, 1)
  assert.equal(direct.relations[0].type, 'supersedes')
  assert.equal(direct.relations[0].direction, 'out')

  const indirect = toC.find((path) => path.depth === 2)
  assert.deepEqual(indirect.kinds, ['reconfirm'])
  assert.equal(indirect.relations.length, 2)
  assert.equal(indirect.relations[0].from, 'REQ-PAY-401')
  assert.equal(indirect.relations[0].to, 'REQ-PAY-402')
  assert.equal(indirect.relations[1].from, 'REQ-PAY-402')
  assert.equal(indirect.relations[1].to, 'REQ-PAY-403')
  assert.ok(indirect.relations.every((relation) => relation.type === 'parent_of'))

  // All three semantic contexts are represented.
  assert.ok(preview.impact.groups.reverify.some((node) => node.id === 'TEST-PAY-777'))
  assert.ok(preview.impact.groups.reconfirm.some((node) => node.id === 'REQ-PAY-402'))
  assert.ok(preview.impact.groups.reconfirm.some((node) => node.id === 'REQ-PAY-403'))
  assert.ok(preview.impact.groups.reference.some((node) => node.id === 'REQ-PAY-403'))
  assert.equal(preview.impact.groups.reconfirm.find((node) => node.id === 'REQ-PAY-403').depth, 1)
  assert.equal(preview.impact.cycles.length, 0)
  assert.equal(preview.applied, false)
})
