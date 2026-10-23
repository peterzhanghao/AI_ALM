import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { run } from '../../src/cli.mjs'

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
}

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'alm-release-'))
  const file = join(root, 'architecture/mod.yml')
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(
    file,
    'schema_version: 1\nid: MOD-REL-001\ntype: module\ntitle: 发布测试模块\nstatus: accepted\nowner: team-demo\nlinks: []\n',
    'utf8',
  )
  git(root, 'init', '-b', 'main')
  git(root, 'add', '-A')
  execFileSync(
    'git',
    ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'base'],
    { stdio: 'ignore' },
  )
  return { root, headSha: git(root, 'rev-parse', 'HEAD') }
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

function approvalFor(dir, headSha) {
  const path = join(dir, 'approval.json')
  writeFileSync(
    path,
    JSON.stringify({
      schema: 'alm.approval/v1',
      changeId: 'CHG-REL-001',
      headSha,
      actor: 'human:alice',
      kind: 'human',
      decision: 'approve',
      at: '2026-10-23T12:00:00Z',
    }),
    'utf8',
  )
  return path
}

test('release publish is write-once and verify rebuilds the same bytes', async () => {
  const { root, headSha } = makeRepo()
  const work = mkdtempSync(join(tmpdir(), 'alm-release-work-'))
  try {
    const approval = approvalFor(work, headSha)
    const created = await invoke([
      'baseline', 'create', '--root', root, '--commit', 'HEAD', '--tag', 'v1',
      '--approval', approval, '--out', join(work, 'baselines'), '--id', 'BL-REL-001', '--json',
    ])
    assert.equal(created.code, 0)
    const manifestPath = JSON.parse(created.out).path

    const published = await invoke([
      'release', 'publish', '--root', root, '--manifest', manifestPath, '--out', join(work, 'published'), '--json',
    ])
    assert.equal(published.code, 0)
    const first = JSON.parse(published.out)
    assert.equal(first.status, 'published')
    assert.match(first.bundleSha256, /^[0-9a-f]{64}$/)

    const again = await invoke([
      'release', 'publish', '--root', root, '--manifest', manifestPath, '--out', join(work, 'published'), '--json',
    ])
    assert.equal(JSON.parse(again.out).status, 'unchanged')

    const verified = await invoke([
      'release', 'verify', '--root', root, '--baseline', 'BL-REL-001', '--out', join(work, 'published'), '--json',
    ])
    assert.equal(verified.code, 0)
    assert.equal(JSON.parse(verified.out).ok, true)
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(work, { recursive: true, force: true })
  }
})

test('tampering with the stored bundle fails verification', async () => {
  const { root, headSha } = makeRepo()
  const work = mkdtempSync(join(tmpdir(), 'alm-release-tamper-'))
  try {
    const approval = approvalFor(work, headSha)
    const created = await invoke([
      'baseline', 'create', '--root', root, '--commit', 'HEAD', '--tag', 'v1',
      '--approval', approval, '--out', join(work, 'baselines'), '--id', 'BL-REL-002', '--json',
    ])
    const manifestPath = JSON.parse(created.out).path
    await invoke(['release', 'publish', '--root', root, '--manifest', manifestPath, '--out', join(work, 'published'), '--json'])

    appendFileSync(join(work, 'published', 'BL-REL-002', 'bundle.tar'), 'tampered', 'utf8')

    const verified = await invoke([
      'release', 'verify', '--root', root, '--baseline', 'BL-REL-002', '--out', join(work, 'published'), '--json',
    ])
    assert.equal(verified.code, 1)
    const result = JSON.parse(verified.out)
    assert.equal(result.ok, false)
    assert.ok(result.mismatches.some((mismatch) => mismatch.path === 'bundle.tar'))
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(work, { recursive: true, force: true })
  }
})

test('release verify fails for an unknown baseline', async () => {
  const { root } = makeRepo()
  try {
    const verified = await invoke(['release', 'verify', '--root', root, '--baseline', 'BL-NOPE-001', '--json'])
    assert.equal(verified.code, 1)
    assert.match(verified.err, /not published/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
