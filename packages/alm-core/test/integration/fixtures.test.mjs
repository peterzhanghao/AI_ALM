import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { run } from '../../src/cli.mjs'

const FIXTURES = fileURLToPath(new URL('../../../../fixtures/', import.meta.url))
const ORDER_REFUND = join(FIXTURES, 'order-refund')
const NEGATIVE = join(FIXTURES, 'negative')

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

test('order-refund sample parses seven asset types in four formats', async () => {
  const { code, out } = await invoke(['index', '--root', ORDER_REFUND, '--json'])
  assert.equal(code, 0)
  const payload = JSON.parse(out)
  assert.equal(payload.errors.length, 0)
  assert.equal(payload.assets.length, 7)
  assert.deepEqual(
    [...new Set(payload.assets.map((asset) => asset.type))].sort(),
    [
      'acceptance-test',
      'architecture-decision',
      'data-model',
      'interface',
      'module',
      'requirement',
      'risk',
    ],
  )
  assert.deepEqual(
    [...new Set(payload.assets.map((asset) => asset.source.format))].sort(),
    ['markdown', 'openapi', 'sdoc', 'yaml'],
  )
})

test('every relation in order-refund resolves to an asset', async () => {
  const { out } = await invoke(['index', '--root', ORDER_REFUND, '--json'])
  const payload = JSON.parse(out)
  const ids = new Set(payload.assets.map((asset) => asset.id))
  const dangling = payload.assets.flatMap((asset) =>
    asset.links.filter((link) => !ids.has(link.target)).map((link) => `${asset.id}->${link.target}`),
  )
  assert.deepEqual(dangling, [])
})

test('order-refund passes the current gates', async () => {
  const { code, out } = await invoke(['check', '--root', ORDER_REFUND, '--json'])
  assert.equal(code, 0)
  assert.equal(JSON.parse(out).result, 'pass')
})

test('negative fixtures behave as declared in cases.json', async () => {
  const cases = JSON.parse(readFileSync(join(NEGATIVE, 'cases.json'), 'utf8'))
  assert.ok(cases.length >= 5)

  for (const testCase of cases) {
    const dir = join(NEGATIVE, testCase.dir)
    assert.ok(existsSync(dir), `missing negative fixture: ${testCase.dir}`)

    if (!testCase.enforced) continue

    const { code, out } = await invoke(['check', '--root', dir, '--json'])
    assert.equal(code, 1, `${testCase.dir} should fail`)
    const payload = JSON.parse(out)
    assert.equal(payload.result, 'fail')
    const ruleIds = payload.checks.map((check) => check.id)
    assert.ok(ruleIds.includes(testCase.rule), `${testCase.dir} should report ${testCase.rule}`)
    const findings = payload.checks.find((check) => check.id === testCase.rule).findings
    assert.ok(findings.length > 0)
    assert.ok(findings[0].file)
  }
})
