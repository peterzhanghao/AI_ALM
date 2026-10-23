import test from 'node:test'
import assert from 'node:assert/strict'
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
