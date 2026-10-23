import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { run } from '../../src/cli.mjs'

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
}

function commit(root, message) {
  git(root, 'add', '-A')
  execFileSync(
    'git',
    ['-C', root, '-c', 'user.name=alm-test', '-c', 'user.email=alm@example.invalid', 'commit', '-qm', message],
    { stdio: 'ignore' },
  )
  return git(root, 'rev-parse', 'HEAD')
}

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'alm-approval-'))
  const file = join(root, 'architecture/mod.yml')
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(
    file,
    'schema_version: 1\nid: MOD-AP-001\ntype: module\ntitle: 审批测试模块\nstatus: accepted\nowner: team-demo\nlinks: []\n',
    'utf8',
  )
  git(root, 'init', '-b', 'main')
  commit(root, 'base')
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

test('approval record accepts only human actors', async () => {
  const { root } = makeRepo()
  try {
    const agent = await invoke(['approval', 'record', '--root', root, '--sha', 'HEAD', '--actor', 'agent:bot'])
    assert.equal(agent.code, 1)
    assert.match(agent.err, /human:/)

    const human = await invoke(['approval', 'record', '--root', root, '--sha', 'HEAD', '--actor', 'human:alice', '--json'])
    assert.equal(human.code, 0)
    assert.equal(JSON.parse(human.out).kind, 'human')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('pr merge requires an approval bound to the head SHA', async () => {
  const { root, file } = makeRepo()
  try {
    git(root, 'switch', '-c', 'feature')
    writeFileSync(
      file,
      'schema_version: 1\nid: MOD-AP-001\ntype: module\ntitle: 审批测试模块 v2\nstatus: accepted\nowner: team-demo\nlinks: []\n',
      'utf8',
    )
    const headSha = commit(root, 'change asset\n\nAlm-Agent: agent:deepseek')

    const blocked = await invoke(['pr', 'status', '--root', root, '--base', 'main', '--head', 'feature', '--json'])
    assert.equal(blocked.code, 0)
    const blockedPayload = JSON.parse(blocked.out)
    assert.equal(blockedPayload.mergeable, false)
    assert.equal(blockedPayload.headSha, headSha)
    assert.match(blockedPayload.reasons[0], /no human approval/)

    const approve = await invoke(['approval', 'record', '--root', root, '--sha', headSha, '--actor', 'human:alice'])
    assert.equal(approve.code, 0)

    const ready = await invoke(['pr', 'status', '--root', root, '--base', 'main', '--head', 'feature', '--json'])
    const readyPayload = JSON.parse(ready.out)
    assert.equal(readyPayload.mergeable, true)
    assert.deepEqual(readyPayload.approvals, ['human:alice'])
    assert.equal(readyPayload.checkResult, 'pass')

    const merged = await invoke(['pr', 'merge', '--root', root, '--base', 'main', '--head', 'feature', '--json'])
    assert.equal(merged.code, 0)
    const mergeSha = JSON.parse(merged.out).mergeSha
    const parents = git(root, 'rev-list', '--parents', '-n', '1', mergeSha).split(' ')
    assert.equal(parents.length, 3)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a new commit invalidates the previous approval', async () => {
  const { root, file } = makeRepo()
  try {
    git(root, 'switch', '-c', 'feature')
    writeFileSync(
      file,
      'schema_version: 1\nid: MOD-AP-001\ntype: module\ntitle: v1\nstatus: accepted\nowner: team-demo\nlinks: []\n',
      'utf8',
    )
    const first = commit(root, 'first')
    const approve = await invoke(['approval', 'record', '--root', root, '--sha', first, '--actor', 'human:alice'])
    assert.equal(approve.code, 0)

    writeFileSync(
      file,
      'schema_version: 1\nid: MOD-AP-001\ntype: module\ntitle: v2\nstatus: accepted\nowner: team-demo\nlinks: []\n',
      'utf8',
    )
    commit(root, 'second')

    const status = await invoke(['pr', 'status', '--root', root, '--base', 'main', '--head', 'feature', '--json'])
    const payload = JSON.parse(status.out)
    assert.equal(payload.mergeable, false)
    assert.match(payload.reasons[0], /no human approval/)

    const verify = await invoke(['approval', 'verify', '--root', root, '--sha', 'HEAD', '--json'])
    assert.equal(JSON.parse(verify.out).ok, false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a forged non-human approval fails APPROVAL-002 in a PR gate', async () => {
  const { root } = makeRepo()
  try {
    const headSha = git(root, 'rev-parse', 'HEAD')
    const dir = join(root, '.alm/approvals')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, `${headSha}.json`),
      JSON.stringify([
        {
          schema: 'alm.approval/v1',
          changeId: 'local',
          headSha,
          actor: 'agent:bot',
          kind: 'agent',
          decision: 'approve',
          at: '2026-10-23T10:00:00Z',
        },
      ]),
      'utf8',
    )

    const gate = await invoke(['check', '--root', root, '--pr', '--json'])
    assert.equal(gate.code, 1)
    const checks = JSON.parse(gate.out).checks
    const forged = checks.find((check) => check.id === 'APPROVAL-002')
    assert.equal(forged.status, 'fail')

    const plain = await invoke(['check', '--root', root, '--json'])
    assert.equal(JSON.parse(plain.out).result, 'pass')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
