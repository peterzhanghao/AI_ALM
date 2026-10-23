import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { run } from '../../src/cli.mjs'

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
}

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'alm-recovery-'))
  const file = join(root, 'architecture/mod.yml')
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, moduleYaml('v1'), 'utf8')
  git(root, 'init', '-b', 'main')
  git(root, 'add', '-A')
  execFileSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'base'], { stdio: 'ignore' })
  return { root, file }
}

const moduleYaml = (title) =>
  `schema_version: 1\nid: MOD-RC-001\ntype: module\ntitle: ${title}\nstatus: accepted\nowner: team-demo\nlinks: []\n`

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

function approval(work, headSha, name) {
  const path = join(work, `${name}.json`)
  writeFileSync(
    path,
    JSON.stringify({
      schema: 'alm.approval/v1',
      changeId: 'CHG-RC-001',
      headSha,
      actor: 'human:alice',
      kind: 'human',
      decision: 'approve',
      at: '2026-10-23T12:30:00Z',
    }),
    'utf8',
  )
  return path
}

async function createAndPublish(root, work, id, commit, approvalPath) {
  const baseline = await invoke([
    'baseline', 'create', '--root', root, '--commit', commit, '--tag', id,
    '--approval', approvalPath, '--out', join(work, 'baselines'), '--id', id, '--json',
  ])
  assert.equal(baseline.code, 0)
  const manifestPath = JSON.parse(baseline.out).path
  const published = await invoke([
    'release', 'publish', '--root', root, '--manifest', manifestPath, '--out', join(work, 'published'), '--json',
  ])
  assert.equal(published.code, 0)
  return JSON.parse(published.out)
}

test('rollback switches the pointer and keeps history intact', async () => {
  const { root, file } = makeRepo()
  const work = mkdtempSync(join(tmpdir(), 'alm-recovery-work-'))
  try {
    const head1 = git(root, 'rev-parse', 'HEAD')
    const a = await createAndPublish(root, work, 'BL-RC-A', 'HEAD', approval(work, head1, 'a'))

    writeFileSync(file, moduleYaml('v2'), 'utf8')
    git(root, 'add', '-A')
    execFileSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'v2'], { stdio: 'ignore' })
    const head2 = git(root, 'rev-parse', 'HEAD')
    const b = await createAndPublish(root, work, 'BL-RC-B', 'HEAD', approval(work, head2, 'b'))

    const rolled = await invoke([
      'release', 'rollback', '--root', root, '--to', 'BL-RC-A', '--out', join(work, 'published'), '--json',
    ])
    assert.equal(rolled.code, 0)
    const pointer = JSON.parse(rolled.out)
    assert.equal(pointer.baselineId, 'BL-RC-A')
    assert.equal(pointer.previous, 'BL-RC-B')

    const stored = JSON.parse(readFileSync(join(work, 'published', 'current.json'), 'utf8'))
    assert.equal(stored.baselineId, 'BL-RC-A')

    // Both published baselines remain verifiable after the rollback.
    for (const id of ['BL-RC-A', 'BL-RC-B']) {
      const verified = await invoke([
        'release', 'verify', '--root', root, '--baseline', id, '--out', join(work, 'published'), '--json',
      ])
      assert.equal(verified.code, 0)
    }
    assert.notEqual(a.bundleSha256, b.bundleSha256)
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(work, { recursive: true, force: true })
  }
})

test('an interrupted publish can be retried and is not official until complete', async () => {
  const { root } = makeRepo()
  const work = mkdtempSync(join(tmpdir(), 'alm-recovery-retry-'))
  try {
    const head = git(root, 'rev-parse', 'HEAD')
    const published = await createAndPublish(root, work, 'BL-RC-C', 'HEAD', approval(work, head, 'c'))

    const releaseRecord = join(work, 'published', 'BL-RC-C', 'release.json')
    assert.ok(existsSync(releaseRecord))
    unlinkSync(releaseRecord)

    const halfBaked = await invoke([
      'release', 'verify', '--root', root, '--baseline', 'BL-RC-C', '--out', join(work, 'published'), '--json',
    ])
    assert.equal(halfBaked.code, 1)
    assert.match(halfBaked.err, /not published/)

    const retried = await invoke([
      'release', 'publish', '--root', root, '--manifest', join(work, 'published', 'BL-RC-C', 'baseline.json'),
      '--out', join(work, 'published'), '--json',
    ])
    assert.equal(retried.code, 0)
    assert.equal(JSON.parse(retried.out).status, 'published')
    assert.equal(JSON.parse(retried.out).bundleSha256, published.bundleSha256)

    const verified = await invoke([
      'release', 'verify', '--root', root, '--baseline', 'BL-RC-C', '--out', join(work, 'published'), '--json',
    ])
    assert.equal(verified.code, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(work, { recursive: true, force: true })
  }
})

test('rollback refuses an unpublished or unverifiable baseline', async () => {
  const { root } = makeRepo()
  const work = mkdtempSync(join(tmpdir(), 'alm-recovery-deny-'))
  try {
    const missing = await invoke([
      'release', 'rollback', '--root', root, '--to', 'BL-NOPE', '--out', join(work, 'published'), '--json',
    ])
    assert.equal(missing.code, 1)
    assert.match(missing.err, /not published/)
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(work, { recursive: true, force: true })
  }
})
