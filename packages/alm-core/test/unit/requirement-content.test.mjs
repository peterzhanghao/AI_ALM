import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, test } from 'node:test'
import { loadRepo } from '../../src/parse/load.mjs'
import { parseSdocAsset } from '../../src/parse/sdoc.mjs'
import { buildIndex } from '../../src/index/index.mjs'
import * as att001 from '../../src/gates/rules/att-001.mjs'
import * as brief001 from '../../src/gates/rules/brief-001.mjs'
import * as rel003 from '../../src/gates/rules/rel-003.mjs'
import * as rev001 from '../../src/gates/rules/rev-001.mjs'
import * as state001 from '../../src/gates/rules/state-001.mjs'
import * as rel002 from '../../src/gates/rules/rel-002.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
const fixture = join(repoRoot, 'fixtures/order-refund')
const dirs = []

function tempRepo() {
  const root = mkdtempSync(join(tmpdir(), 'alm-content-'))
  dirs.push(root)
  cpSync(fixture, root, { recursive: true })
  return root
}

after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

function requirement(id, extraLines = '', relations = '') {
  return `[DOCUMENT]\nTITLE: t\n\n[REQUIREMENT]\nUID: ${id}\nTITLE: ${id} title\nSTATUS: proposed\nOWNER: team\n${extraLines}\n${relations}`
}

function assetWith(overrides = {}) {
  return {
    id: 'REQ-X-001',
    type: 'requirement',
    title: 't',
    status: 'proposed',
    owner: 'team',
    links: [],
    extra: {},
    source: { path: 'requirements/x.sdoc', line: 7, format: 'sdoc' },
    ...overrides,
  }
}

test('the sample requirement carries revision, priority, category, brief and sources', () => {
  const { assets } = loadRepo(fixture)
  const asset = assets.find((entry) => entry.id === 'REQ-PAY-004')
  assert.equal(asset.extra.revision, 2)
  assert.equal(asset.extra.priority, 'P1')
  assert.equal(asset.extra.category, 'functional')
  assert.equal(asset.extra.brief, 'requirements/briefs/REQ-PAY-004.md')
  assert.deepEqual(asset.extra.sources, ['chat', 'meeting'])

  const parent = assets.find((entry) => entry.id === 'REQ-PAY-001')
  assert.ok(parent.links.some((link) => link.type === 'parent_of' && link.target === 'REQ-PAY-004'))
})

test('Chinese status aliases normalize to the stable enum', () => {
  const [asset] = parseSdocAsset(requirement('REQ-ZH-001', 'STATUS: 已采纳'), 'requirements/zh.sdoc')
  assert.equal(asset.status, 'accepted')
  assert.throws(() => parseSdocAsset(requirement('REQ-ZH-002', 'REVISION: 0'), 'requirements/zh.sdoc'), /positive integer/)
})

test('REV-001 rejects a content change without a revision bump', () => {
  const before = assetWith({ extra: { revision: 1 } })
  const changed = assetWith({ title: 'new title', extra: { revision: 1 } })
  const bumped = assetWith({ title: 'new title', extra: { revision: 2 } })

  assert.equal(rev001.check({ assets: [bumped], baseAssets: [before] }).length, 0)
  const findings = rev001.check({ assets: [changed], baseAssets: [before] })
  assert.equal(findings.length, 1)
  assert.match(findings[0].message, /revision 1 must increase/)

  const invalid = rev001.check({ assets: [assetWith({ extra: { revision: 0 } })], baseAssets: [] })
  assert.equal(invalid.length, 1)
})

test('REL-003 reports a parent_of cycle once', () => {
  const root = tempRepo()
  writeFileSync(
    join(root, 'requirements/cycle-a.sdoc'),
    `[REQUIREMENT]\nUID: REQ-CYCLE-001\nTITLE: a\nSTATUS: proposed\nOWNER: team\n\n[RELATION]\nType: parent_of\nValue: REQ-CYCLE-002\n`,
  )
  writeFileSync(
    join(root, 'requirements/cycle-b.sdoc'),
    `[REQUIREMENT]\nUID: REQ-CYCLE-002\nTITLE: b\nSTATUS: proposed\nOWNER: team\n\n[RELATION]\nType: parent_of\nValue: REQ-CYCLE-001\n`,
  )
  const { assets } = loadRepo(root)
  const findings = rel003.check({ assets, index: buildIndex(assets) })
  assert.equal(findings.length, 1)
  assert.match(findings[0].message, /hierarchy cycle/)
})

test('ATT-001 catches a hash mismatch and a missing attachment', () => {
  const root = tempRepo()
  const manifestPath = join(root, 'requirements/attachments/REQ-PAY-004/manifest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

  assert.deepEqual(att001.check({ root, index: buildIndex(loadRepo(root).assets) }), [])

  manifest.files[0].sha256 = '0'.repeat(64)
  writeFileSync(manifestPath, JSON.stringify(manifest), 'utf8')
  let findings = att001.check({ root, index: buildIndex(loadRepo(root).assets) })
  assert.ok(findings.some((finding) => finding.message.includes('hash mismatch')))

  manifest.files[0].sha256 = '0'.repeat(64)
  manifest.files[0].path = 'missing.md'
  writeFileSync(manifestPath, JSON.stringify(manifest), 'utf8')
  findings = att001.check({ root, index: buildIndex(loadRepo(root).assets) })
  assert.ok(findings.some((finding) => finding.message.includes('attachment missing')))
})

test('BRIEF-001 reports a missing brief and accepts the sample', () => {
  const root = tempRepo()
  const { assets } = loadRepo(root)
  assert.deepEqual(brief001.check({ root, assets }), [])

  writeFileSync(join(root, 'requirements/broken.sdoc'), requirement('REQ-BRIEF-001', 'BRIEF: requirements/briefs/nope.md'))
  const broken = loadRepo(root).assets
  const findings = brief001.check({ root, assets: broken })
  assert.ok(findings.some((finding) => finding.message.includes('brief not found')))
})

test('parent_of is a legal requirement relation and STATE-001 allows the new transitions', () => {
  const parent = assetWith({ id: 'REQ-X-001' })
  const child = assetWith({ id: 'REQ-X-002', links: [{ type: 'parent_of', target: 'REQ-X-003' }] })
  const index = buildIndex([parent, child, assetWith({ id: 'REQ-X-003' })])
  assert.deepEqual(rel002.check({ assets: [child], index }), [])

  const base = assetWith({ status: 'accepted' })
  const allowed = [
    ['accepted', 'in-progress'],
    ['in-progress', 'implemented'],
    ['implemented', 'verified'],
    ['verified', 'in-progress'],
  ]
  for (const [from, to] of allowed) {
    const before = assetWith({ status: from })
    const after = assetWith({ status: to })
    assert.deepEqual(
      state001.check({ assets: [after], baseAssets: [before] }),
      [],
      `${from} -> ${to} should be allowed`,
    )
  }
  const illegal = state001.check({ assets: [assetWith({ status: 'verified' })], baseAssets: [assetWith({ status: 'proposed' })] })
  assert.equal(illegal.length, 1)
})
