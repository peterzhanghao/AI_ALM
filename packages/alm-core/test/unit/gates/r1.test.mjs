import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { normalizeAsset } from '../../../src/model/asset.mjs'
import { buildIndex } from '../../../src/index/index.mjs'
import { runGates } from '../../../src/gates/run.mjs'
import * as id002 from '../../../src/gates/rules/id-002.mjs'
import * as rel002 from '../../../src/gates/rules/rel-002.mjs'
import * as cov001 from '../../../src/gates/rules/cov-001.mjs'
import * as cov002 from '../../../src/gates/rules/cov-002.mjs'
import * as state001 from '../../../src/gates/rules/state-001.mjs'
import * as sec001 from '../../../src/gates/rules/sec-001.mjs'
import * as ren001 from '../../../src/gates/rules/ren-001.mjs'
import * as ren002 from '../../../src/gates/rules/ren-002.mjs'

function asset(id, type, links = [], overrides = {}) {
  return normalizeAsset(
    { schema_version: 1, id, type, title: id, status: 'proposed', owner: 'team', links, ...overrides },
    { path: `${id}.yml`, format: 'yaml', line: 1 },
  )
}

function sandbox(files) {
  const root = mkdtempSync(join(tmpdir(), 'alm-r1-'))
  for (const [name, content] of Object.entries(files)) {
    const path = join(root, name)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content, 'utf8')
  }
  return root
}

test('ID-002 flags an id prefix that does not match the type', () => {
  const assets = [asset('ADR-PAY-001', 'requirement')]
  const findings = id002.check({ assets, index: buildIndex(assets) })
  assert.equal(findings.length, 1)
  assert.match(findings[0].message, /id prefix/)
})

test('REL-002 rejects requirement depends_on requirement', () => {
  const assets = [asset('REQ-A-001', 'requirement', [{ type: 'depends_on', target: 'REQ-A-002' }]), asset('REQ-A-002', 'requirement')]
  const findings = rel002.check({ assets, index: buildIndex(assets) })
  assert.equal(findings.length, 1)
  assert.match(findings[0].message, /illegal depends_on/)
})

test('REL-002 accepts requirement allocated_to module', () => {
  const assets = [asset('REQ-A-001', 'requirement', [{ type: 'allocated_to', target: 'MOD-A-001' }]), asset('MOD-A-001', 'module')]
  assert.deepEqual(rel002.check({ assets, index: buildIndex(assets) }), [])
})

test('COV-001 flags a requirement without verified_by', () => {
  const assets = [asset('REQ-A-001', 'requirement')]
  assert.equal(cov001.check({ assets, index: buildIndex(assets) }).length, 1)
})

test('COV-002 flags an unreferenced acceptance test as warn', () => {
  const assets = [asset('TEST-A-001', 'acceptance-test')]
  assert.equal(cov002.check({ assets, index: buildIndex(assets) }).length, 1)
  assert.equal(cov002.level, 'warn')
})

test('STATE-001 skips without a base and reports an illegal transition with one', () => {
  const current = [asset('REQ-A-001', 'requirement', [], { status: 'proposed' })]
  const skipped = state001.check({ assets: current, index: buildIndex(current) })
  assert.equal(skipped.status, 'skip')

  const base = [asset('REQ-A-001', 'requirement', [], { status: 'accepted' })]
  const findings = state001.check({ assets: current, index: buildIndex(current), baseAssets: base })
  assert.equal(findings.length, 1)
  assert.match(findings[0].message, /accepted -> proposed/)
})

test('SEC-001 finds credential-shaped values but ignores env references', () => {
  const root = sandbox({
    'req.yml': 'schema_version: 1\nid: REQ-A-001\ntype: requirement\ntitle: x\nstatus: proposed\nowner: t\nlinks: []\napi_key: fixture-secret-value\n',
    'env.yml': 'schema_version: 1\nid: REQ-A-002\ntype: requirement\ntitle: x\nstatus: proposed\nowner: t\nlinks: []\ntoken: ${TOKEN}\n',
  })
  try {
    const assets = [asset('REQ-A-001', 'requirement'), asset('REQ-A-002', 'requirement')]
    const findings = sec001.check({ root, index: buildIndex(assets) })
    assert.equal(findings.length, 1)
    assert.equal(findings[0].file, 'req.yml')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('REN-001 reports broken links and unclosed mermaid fences', () => {
  const root = sandbox({
    'adr/ADR-A-001.md': '---\nschema_version: 1\nid: ADR-A-001\ntype: architecture-decision\ntitle: x\nstatus: accepted\nowner: t\nlinks: []\n---\n\n[gone](./missing.md)\n\n```mermaid\ngraph TD\n```\n',
    'adr/ADR-A-002.md': '---\nschema_version: 1\nid: ADR-A-002\ntype: architecture-decision\ntitle: y\nstatus: accepted\nowner: t\nlinks: []\n---\n\n```mermaid\ngraph TD\n',
  })
  try {
    const findings = ren001.check({ root })
    assert.equal(findings.length, 2)
    assert.ok(findings.some((finding) => /broken link/.test(finding.message)))
    assert.ok(findings.some((finding) => /unclosed mermaid/.test(finding.message)))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('REN-002 skips without a manifest and checks version plus hashes with one', () => {
  const root = sandbox({ 'artifact.html': '<html></html>' })
  try {
    const skip = ren002.check({ root })
    assert.equal(skip.status, 'skip')

    const digest = createHash('sha256').update('<html></html>').digest('hex')
    mkdirSync(join(root, '.alm/render'), { recursive: true })
    writeFileSync(
      join(root, '.alm/render/manifest.json'),
      JSON.stringify({
        strictdocVersion: '0.30.4',
        artifacts: [{ path: 'artifact.html', sha256: digest }],
      }),
      'utf8',
    )
    assert.deepEqual(ren002.check({ root }), [])

    writeFileSync(
      join(root, '.alm/render/manifest.json'),
      JSON.stringify({
        strictdocVersion: '0.29.0',
        artifacts: [{ path: 'artifact.html', sha256: 'deadbeef' }],
      }),
      'utf8',
    )
    const findings = ren002.check({ root })
    assert.equal(findings.length, 2)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('runGates keeps warn failures out of the run result and reports skip', () => {
  const assets = [asset('TEST-A-001', 'acceptance-test')]
  const index = buildIndex(assets)
  const root = sandbox({})
  try {
    const { result, checks } = runGates({ assets, index, root })
    assert.equal(result, 'pass')
    assert.equal(checks.find((check) => check.id === 'COV-002').status, 'fail')
    assert.equal(checks.find((check) => check.id === 'STATE-001').status, 'skip')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
