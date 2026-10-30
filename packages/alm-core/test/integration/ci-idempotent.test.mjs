import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { run } from '../../src/cli.mjs'

const MODULE = 'schema_version: 1\nid: MOD-CI-001\ntype: module\ntitle: CI 测试模块\nstatus: accepted\nowner: team-demo\nlinks: []\n'

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
}

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'alm-ci-'))
  const file = join(root, 'architecture/mod.yml')
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, MODULE, 'utf8')
  git(root, 'init', '-b', 'main')
  git(root, 'add', '-A')
  execFileSync(
    'git',
    ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'base'],
    { stdio: 'ignore' },
  )
  return { root, file }
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

test('ci run is idempotent for one commit and rule pack', async () => {
  const { root } = makeRepo()
  try {
    const before = await invoke(['ci', 'status', '--root', root, '--json'])
    assert.equal(before.code, 1)
    assert.match(JSON.parse(before.out).reason, /no CI record/)

    const first = await invoke(['ci', 'run', '--root', root, '--json'])
    assert.equal(first.code, 0)
    const created = JSON.parse(first.out)
    assert.equal(created.status, 'created')
    assert.equal(created.result, 'pass')

    const second = await invoke(['ci', 'run', '--root', root, '--json'])
    const unchanged = JSON.parse(second.out)
    assert.equal(unchanged.status, 'unchanged')
    assert.equal(unchanged.runId, created.runId)

    const files = readdirSync(join(root, '.alm/ci', created.headSha))
    assert.equal(files.length, 1)

    const status = await invoke(['ci', 'status', '--root', root, '--json'])
    assert.equal(status.code, 0)
    assert.equal(JSON.parse(status.out).ok, true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('ci record accepts a matching evidence file once', async () => {
  const { root } = makeRepo()
  try {
    const evidencePath = join(root, 'evidence.json')
    const check = await invoke(['check', '--root', root, '--out', evidencePath, '--json'])
    assert.equal(check.code, 0)

    const recorded = await invoke(['ci', 'record', '--root', root, '--evidence', evidencePath, '--json'])
    assert.equal(recorded.code, 0)
    assert.equal(JSON.parse(recorded.out).status, 'recorded')

    const again = await invoke(['ci', 'record', '--root', root, '--evidence', evidencePath, '--json'])
    assert.equal(JSON.parse(again.out).status, 'unchanged')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('client evidence that disagrees with the server re-run is refused', async () => {
  const { root, file } = makeRepo()
  try {
    const evidencePath = join(root, 'evidence.json')
    await invoke(['check', '--root', root, '--out', evidencePath, '--json'])

    // Break the worktree after the client produced a passing evidence file.
    mkdirSync(join(root, 'architecture'), { recursive: true })
    writeFileSync(file.replace('mod.yml', 'dup.yml'), MODULE, 'utf8')

    const recorded = await invoke(['ci', 'record', '--root', root, '--evidence', evidencePath, '--json'])
    assert.equal(recorded.code, 1)
    assert.match(recorded.err, /differs from server/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('evidence from another rule pack is refused', async () => {
  const { root } = makeRepo()
  try {
    const evidencePath = join(root, 'evidence.json')
    await invoke(['check', '--root', root, '--out', evidencePath, '--json'])
    const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'))
    evidence.rules.packVersion = '0.9.0'
    writeFileSync(evidencePath, JSON.stringify(evidence), 'utf8')

    const recorded = await invoke(['ci', 'record', '--root', root, '--evidence', evidencePath, '--json'])
    assert.equal(recorded.code, 1)
    assert.match(recorded.err, /pack 0\.9\.0 != 1\.2\.0/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
