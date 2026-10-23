import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { run } from '../../src/cli.mjs'

const ORDER_REFUND = fileURLToPath(new URL('../../../../fixtures/order-refund', import.meta.url))
const REQUIREMENT = `schema_version: 1
id: REQ-DIFF-001
type: requirement
title: 旧标题
status: proposed
owner: team-demo
links:
  - type: allocated_to
    target: MOD-DIFF-001
`

function git(root, ...args) {
  execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' })
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

test('diff compares a base commit with the worktree', async () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-diff-'))
  const file = join(root, 'requirements/req.yml')
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, REQUIREMENT, 'utf8')
    mkdirSync(join(root, 'architecture'), { recursive: true })
    writeFileSync(
      join(root, 'architecture/mod.yml'),
      'schema_version: 1\nid: MOD-DIFF-001\ntype: module\ntitle: 模块\nstatus: accepted\nowner: team-demo\nlinks: []\n',
      'utf8',
    )
    git(root, 'init', '-q')
    git(root, 'add', '-A')
    git(root, '-c', 'user.name=alm-test', '-c', 'user.email=alm@example.invalid', 'commit', '-qm', 'base')

    writeFileSync(
      file,
      REQUIREMENT.replace('旧标题', '新标题').replace('status: proposed', 'status: accepted'),
      'utf8',
    )

    const { code, out } = await invoke(['diff', '--root', root, '--base', 'HEAD', '--json'])
    assert.equal(code, 0)
    const diff = JSON.parse(out)
    assert.equal(diff.schema, 'alm.diff/v1')
    assert.equal(diff.head, 'worktree')
    assert.equal(diff.summary.changed, 1)
    assert.deepEqual(diff.changed[0].fields.map((field) => field.field), ['status', 'title'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('impact of the ADR reaches every constrained asset', async () => {
  const { code, out } = await invoke(['impact', '--root', ORDER_REFUND, '--asset', 'ADR-PAY-003', '--json'])
  assert.equal(code, 0)
  const impact = JSON.parse(out)
  assert.equal(impact.schema, 'alm.impact/v1')
  assert.deepEqual(
    impact.impacted.map((entry) => entry.id).sort(),
    ['DM-PAY-REFUND', 'IF-PAY-REFUND-API', 'MOD-PAY-REFUND', 'REQ-PAY-001', 'RISK-PAY-001'],
  )
  assert.deepEqual(impact.cycles, [])
})

test('trace walks requirement to module, interface, decision and test', async () => {
  const { code, out } = await invoke(['trace', 'REQ-PAY-001', '--root', ORDER_REFUND, '--json'])
  assert.equal(code, 0)
  const trace = JSON.parse(out)
  assert.equal(trace.schema, 'alm.trace/v1')
  const byId = new Map(trace.nodes.map((node) => [node.id, node]))
  assert.equal(byId.get('MOD-PAY-REFUND').depth, 1)
  assert.equal(byId.get('IF-PAY-REFUND-API').depth, 2)
  assert.equal(byId.get('ADR-PAY-003').depth, 1)
  assert.equal(byId.get('TEST-PAY-001').depth, 1)
})

test('impact on a missing asset exits 1', async () => {
  const { code, err } = await invoke(['impact', '--root', ORDER_REFUND, '--asset', 'REQ-NOPE-999'])
  assert.equal(code, 1)
  assert.match(err, /not found/)
})
