import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run, VERSION } from '../src/cli.mjs'

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

test('no arguments prints help and exits 0', async () => {
  const { code, out } = await invoke([])
  assert.equal(code, 0)
  assert.match(out, /Usage:/)
})

test('--help lists contract verify', async () => {
  const { code, out } = await invoke(['--help'])
  assert.equal(code, 0)
  assert.match(out, /contract verify/)
})

test('--version prints the package version', async () => {
  const { code, out } = await invoke(['--version'])
  assert.equal(code, 0)
  assert.equal(out.trim(), VERSION)
})

test('unknown command exits 2 and writes usage to stderr', async () => {
  const { code, out, err } = await invoke(['nope'])
  assert.equal(code, 2)
  assert.match(err, /unknown command: nope/)
  assert.equal(out, '')
})

test('contract verify passes on the shipped contracts', async () => {
  const { code, out } = await invoke(['contract', 'verify'])
  assert.equal(code, 0)
  assert.match(out, /contracts: ok/)
})

test('contract verify --json emits a versioned payload', async () => {
  const { code, out } = await invoke(['contract', 'verify', '--json'])
  assert.equal(code, 0)
  const payload = JSON.parse(out)
  assert.equal(payload.schema, 'alm.contract.verify/v1')
  assert.equal(payload.ok, true)
  assert.equal(payload.checked.length, 5)
})

test('verify needs a requirement id and explains an unregistered acceptance', async () => {
  const missing = await invoke(['verify'])
  assert.equal(missing.code, 2)
  assert.match(missing.err, /requires a requirement id/)

  const root = mkdtempSync(join(tmpdir(), 'alm-verify-'))
  execFileSync('git', ['init', '-q'], { cwd: root })
  writeFileSync(join(root, 'README.md'), '# demo\n')
  execFileSync('git', ['add', '-A'], { cwd: root })
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'init'], { cwd: root })
  // A requirement with no registered commands gets an actionable hint, not a
  // stack trace: the fix is a UI action, so the message has to name it.
  const unregistered = await invoke(['verify', 'req-x-001', '--root', root])
  assert.equal(unregistered.code, 1)
  assert.match(unregistered.err, /未登记验收命令/)
  assert.match(unregistered.err, /收窄验证范围/)
})

test('verify rejects malformed options instead of guessing', async () => {
  const limit = await invoke(['verify', 'REQ-X', '--limit', '0'])
  assert.equal(limit.code, 2)
  assert.match(limit.err, /--limit requires a positive integer/)
  const unknown = await invoke(['verify', 'REQ-X', '--nope'])
  assert.equal(unknown.code, 2)
  assert.match(unknown.err, /unknown option/)
})
