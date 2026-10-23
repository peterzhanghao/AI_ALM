import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { run } from '../../src/cli.mjs'

const ASSET = `schema_version: 1
id: MOD-EV-001
type: module
title: 证据测试需求
status: accepted
owner: team-demo
links: []
`

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
}

function commit(root, message) {
  execFileSync('git', ['-C', root, '-c', 'user.name=alm-test', '-c', 'user.email=alm@example.invalid', 'commit', '-qm', message], {
    stdio: 'ignore',
  })
  return git(root, 'rev-parse', 'HEAD')
}

function makeRepo(asset = ASSET) {
  const root = mkdtempSync(join(tmpdir(), 'alm-baseline-'))
  mkdirSync(join(root, 'requirements'), { recursive: true })
  writeFileSync(join(root, 'requirements/req.yml'), asset, 'utf8')
  git(root, 'init', '-q')
  git(root, 'add', '-A')
  const head = commit(root, 'base')
  return { root, head }
}

function approvalFile(dir, headSha) {
  const path = join(dir, 'approval.json')
  writeFileSync(
    path,
    JSON.stringify({
      schema: 'alm.approval/v1',
      changeId: 'CHG-TEST-001',
      headSha,
      actor: 'human:tester',
      kind: 'human',
      decision: 'approve',
      at: '2026-10-23T09:00:00Z',
    }),
    'utf8',
  )
  return path
}

function capture() {
  const chunks = []
  return {
    write(chunk) {
      chunks.push(String(chunk))
    },
    get text() {
      return chunks.join('')
    },
  }
}

async function invoke(argv) {
  const out = capture()
  const err = capture()
  const code = await run(argv, { out, err })
  return { code, out: out.text, err: err.text }
}

test('check --out writes a versioned evidence document', async () => {
  const { root, head } = makeRepo()
  const evidencePath = join(root, '.alm/evidence/run.json')
  try {
    const { code } = await invoke(['check', '--root', root, '--out', evidencePath, '--json'])
    assert.equal(code, 0)
    const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'))
    assert.equal(evidence.schema, 'alm.evidence/v1')
    assert.match(evidence.runId, /^run-/)
    assert.equal(evidence.baseSha, head)
    assert.equal(evidence.headSha, head)
    assert.equal(evidence.result, 'pass')
    assert.equal(evidence.rules.packVersion, '1.0.0')
    assert.equal(evidence.tool.name, 'alm')
    assert.ok(evidence.checks.length >= 8)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('baseline create is deterministic and idempotent', async () => {
  const { root, head } = makeRepo()
  const work = mkdtempSync(join(tmpdir(), 'alm-baseline-work-'))
  try {
    const approval = approvalFile(work, head)
    const outDir = join(work, 'baselines')
    const first = await invoke(['baseline', 'create', '--root', root, '--commit', 'HEAD', '--tag', 'v1', '--approval', approval, '--out', outDir, '--id', 'BL-FIXED', '--json'])
    assert.equal(first.code, 0)
    const manifestA = JSON.parse(first.out)
    const path = manifestA.path
    const contentA = readFileSync(path, 'utf8')

    const second = await invoke(['baseline', 'create', '--root', root, '--commit', 'HEAD', '--tag', 'v1', '--approval', approval, '--out', outDir, '--id', 'BL-FIXED', '--json'])
    assert.equal(second.code, 0)
    assert.equal(JSON.parse(second.out).status, 'unchanged')
    assert.equal(readFileSync(path, 'utf8'), contentA)

    const baseline = JSON.parse(contentA)
    assert.equal(baseline.schema, 'alm.baseline/v1')
    assert.equal(baseline.sourceCommit, head)
    assert.match(baseline.contentHash, /^[0-9a-f]{64}$/)
    assert.deepEqual(
      baseline.files.map((file) => file.path),
      ['requirements/req.yml'],
    )
    assert.equal(baseline.approval.headSha, head)
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(work, { recursive: true, force: true })
  }
})

test('same baseline id with different content is refused and the original stays', async () => {
  const { root, head } = makeRepo()
  const work = mkdtempSync(join(tmpdir(), 'alm-baseline-conflict-'))
  try {
    const approval1 = approvalFile(work, head)
    const outDir = join(work, 'baselines')
    const first = await invoke(['baseline', 'create', '--root', root, '--commit', 'HEAD', '--tag', 'v1', '--approval', approval1, '--out', outDir, '--id', 'BL-FIXED', '--json'])
    assert.equal(first.code, 0)
    const path = JSON.parse(first.out).path
    const original = readFileSync(path, 'utf8')

    writeFileSync(join(root, 'requirements/req.yml'), ASSET.replace('证据测试需求', '改动后的需求'), 'utf8')
    git(root, 'add', '-A')
    const head2 = commit(root, 'change')
    const approval2 = approvalFile(work, head2)

    const second = await invoke(['baseline', 'create', '--root', root, '--commit', 'HEAD', '--tag', 'v1', '--approval', approval2, '--out', outDir, '--id', 'BL-FIXED', '--json'])
    assert.equal(second.code, 1)
    assert.match(second.err, /already exists with different content/)
    assert.equal(readFileSync(path, 'utf8'), original)
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(work, { recursive: true, force: true })
  }
})

test('baseline verify accepts a clean manifest and reports tampering', async () => {
  const { root, head } = makeRepo()
  const work = mkdtempSync(join(tmpdir(), 'alm-baseline-verify-'))
  try {
    const approval = approvalFile(work, head)
    const created = await invoke(['baseline', 'create', '--root', root, '--commit', 'HEAD', '--tag', 'v1', '--approval', approval, '--out', join(work, 'baselines'), '--json'])
    const path = JSON.parse(created.out).path

    const clean = await invoke(['baseline', 'verify', '--root', root, '--manifest', path, '--json'])
    assert.equal(clean.code, 0)
    assert.equal(JSON.parse(clean.out).ok, true)

    const manifest = JSON.parse(readFileSync(path, 'utf8'))
    manifest.files[0].sha256 = 'deadbeef'.repeat(8)
    const tampered = join(work, 'tampered.json')
    writeFileSync(tampered, JSON.stringify(manifest), 'utf8')

    const broken = await invoke(['baseline', 'verify', '--root', root, '--manifest', tampered, '--json'])
    assert.equal(broken.code, 1)
    const result = JSON.parse(broken.out)
    assert.equal(result.ok, false)
    assert.ok(result.mismatches.some((mismatch) => mismatch.path === 'requirements/req.yml'))
    assert.ok(result.mismatches.some((mismatch) => mismatch.path === '(contentHash)'))
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(work, { recursive: true, force: true })
  }
})
