import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { loadRepo, loadBaseAssets, showReport, traceReport, checkReport } from '../../src/commands.mjs'

const requirement = `schema_version: 1
id: REQ-PAY-001
type: requirement
title: Canonical requirement
status: proposed
owner: team
links:
  - type: verified_by
    target: TEST-PAY-001
`
const verification = `schema_version: 1
id: TEST-PAY-001
type: acceptance-test
title: Canonical test
status: proposed
owner: team
links: []
`

test('archived evidence cannot replace live assets in index, show, trace or Git base', () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-source-boundary-'))
  const files = {
    'requirements/req.yml': requirement,
    'tests/test.yml': verification,
    'artifacts/frozen/requirements/req.yml': requirement.replace('Canonical requirement', 'Archived copy'),
    'artifacts/frozen/tests/test.yml': verification,
    'artifacts/report.md': '# Evidence without asset frontmatter',
    '.alm/evidence/req.yml': requirement,
    'tmp/req.yml': requirement,
    'requirements/briefs/brief.md': '# Requirement prose',
  }
  try {
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, file)), { recursive: true })
      writeFileSync(join(root, file), text)
    }
    const loaded = loadRepo(root)
    assert.deepEqual(loaded.errors, [])
    assert.deepEqual(loaded.assets.map(a => a.source.path).sort(), ['requirements/req.yml', 'tests/test.yml'])
    assert.equal(showReport(root, 'REQ-PAY-001').asset.title, 'Canonical requirement')
    assert.deepEqual(traceReport(root, 'REQ-PAY-001').nodes, [{ id: 'TEST-PAY-001', depth: 1, via: 'verified_by' }])
    assert.equal(checkReport(root).checks.find(c => c.id === 'ID-001').status, 'pass')
    const git = (...args) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' })
    git('init')
    git('add', '.')
    git('-c', 'user.name=ALM Test', '-c', 'user.email=alm@example.test', '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture')
    assert.deepEqual(loadBaseAssets(root, 'HEAD').map(a => a.source.path).sort(), ['requirements/req.yml', 'tests/test.yml'])
    for (const [file, text] of Object.entries(files)) assert.equal(readFileSync(join(root, file), 'utf8'), text)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
