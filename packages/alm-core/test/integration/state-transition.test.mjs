import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { run } from '../../src/cli.mjs'

const ADR = (status) => `---
schema_version: 1
id: ADR-ST-001
type: architecture-decision
title: 状态迁移测试
status: ${status}
owner: team-demo
links: []
---

# Context

状态迁移。
`

function git(root, ...args) {
  execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' })
}

function commit(root, message) {
  git(root, '-c', 'user.name=alm-test', '-c', 'user.email=alm@example.invalid', 'commit', '-qm', message)
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

test('STATE-001 compares the worktree against --base', async () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-state-'))
  const file = join(root, 'adr/ADR-ST-001.md')
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, ADR('proposed'), 'utf8')
    git(root, 'init', '-q')
    git(root, 'add', '-A')
    commit(root, 'base proposed')

    let result = await invoke(['check', '--root', root, '--base', 'HEAD', '--json'])
    assert.equal(result.code, 0)
    let payload = JSON.parse(result.out)
    assert.equal(payload.checks.find((check) => check.id === 'STATE-001').status, 'pass')

    writeFileSync(file, ADR('accepted'), 'utf8')
    result = await invoke(['check', '--root', root, '--base', 'HEAD', '--json'])
    assert.equal(result.code, 0)

    git(root, 'add', '-A')
    commit(root, 'accept')

    writeFileSync(file, ADR('proposed'), 'utf8')
    result = await invoke(['check', '--root', root, '--base', 'HEAD', '--json'])
    assert.equal(result.code, 1)
    payload = JSON.parse(result.out)
    assert.equal(payload.result, 'fail')
    const state = payload.checks.find((check) => check.id === 'STATE-001')
    assert.equal(state.status, 'fail')
    assert.match(state.findings[0].message, /accepted -> proposed/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('STATE-001 is skipped when no base ref is given', async () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-state-skip-'))
  const file = join(root, 'adr/ADR-ST-001.md')
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, ADR('accepted'), 'utf8')
    const { code, out } = await invoke(['check', '--root', root, '--json'])
    assert.equal(code, 0)
    const payload = JSON.parse(out)
    const state = payload.checks.find((check) => check.id === 'STATE-001')
    assert.equal(state.status, 'skip')
    assert.match(state.message, /no --base/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
