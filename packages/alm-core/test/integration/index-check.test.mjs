import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { run } from '../../src/cli.mjs'

const SMOKE = fileURLToPath(new URL('../../../../fixtures/smoke', import.meta.url))

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

function sandbox(files) {
  const root = mkdtempSync(join(tmpdir(), 'alm-check-'))
  for (const [name, content] of Object.entries(files)) {
    const path = join(root, name)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content, 'utf8')
  }
  return root
}

const assetYaml = (id, type, links = []) => `schema_version: 1
id: ${id}
type: ${type}
title: ${id}
status: proposed
owner: team
links:${links.length === 0 ? ' []' : ''}
${links.map((link) => `  - type: ${link.type}\n    target: ${link.target}`).join('\n')}
`

test('index prints all assets from the smoke fixture', async () => {
  const { code, out } = await invoke(['index', '--root', SMOKE, '--json'])
  assert.equal(code, 0)
  const payload = JSON.parse(out)
  assert.equal(payload.schema, 'alm.index/v1')
  assert.equal(payload.assets.length, 3)
  assert.equal(payload.assets[0].source.path.includes('.yml'), true)
})

test('check passes on the smoke fixture', async () => {
  const { code, out } = await invoke(['check', '--root', SMOKE, '--json'])
  assert.equal(code, 0)
  const payload = JSON.parse(out)
  assert.equal(payload.schema, 'alm.check/v1')
  assert.equal(payload.result, 'pass')
  assert.deepEqual(payload.checks.map((check) => check.id), ['ID-001', 'REL-001'])
})

test('duplicate ids fail ID-001 with both files', async () => {
  const root = sandbox({
    'a.yml': assetYaml('REQ-PAY-001', 'requirement'),
    'b.yml': assetYaml('REQ-PAY-001', 'requirement'),
  })
  try {
    const { code, out } = await invoke(['check', '--root', root, '--json'])
    assert.equal(code, 1)
    const payload = JSON.parse(out)
    assert.equal(payload.result, 'fail')
    const idCheck = payload.checks.find((check) => check.id === 'ID-001')
    assert.equal(idCheck.status, 'fail')
    assert.equal(idCheck.findings.length, 2)
    assert.deepEqual(
      idCheck.findings.map((finding) => finding.file).sort(),
      ['a.yml', 'b.yml'],
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('dangling relations fail REL-001 at the link line', async () => {
  const root = sandbox({
    'req.yml': assetYaml('REQ-PAY-001', 'requirement', [{ type: 'allocated_to', target: 'MOD-PAY-404' }]),
  })
  try {
    const { code, out } = await invoke(['check', '--root', root, '--json'])
    assert.equal(code, 1)
    const payload = JSON.parse(out)
    const relCheck = payload.checks.find((check) => check.id === 'REL-001')
    assert.equal(relCheck.status, 'fail')
    assert.equal(relCheck.findings[0].assetId, 'REQ-PAY-001')
    assert.equal(relCheck.findings[0].file, 'req.yml')
    assert.equal(relCheck.findings[0].line, 9)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('missing root is a usage error', async () => {
  const { code, err } = await invoke(['check', '--root', join(tmpdir(), 'alm-definitely-missing')])
  assert.equal(code, 2)
  assert.match(err, /not a directory/)
})

test('unknown option is a usage error', async () => {
  const { code, err } = await invoke(['check', '--verbose'])
  assert.equal(code, 2)
  assert.match(err, /unknown option/)
})
