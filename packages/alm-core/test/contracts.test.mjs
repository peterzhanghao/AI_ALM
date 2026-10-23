import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, cpSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CONTRACTS_DIR } from '../src/cli.mjs'
import { verifyContracts, CONTRACTS } from '../src/contracts/verify.mjs'

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'alm-contracts-'))
  cpSync(CONTRACTS_DIR, dir, { recursive: true })
  return dir
}

test('verified contracts report all five entries', () => {
  const result = verifyContracts(CONTRACTS_DIR)
  assert.equal(result.ok, true)
  assert.deepEqual(
    result.checked.map((c) => c.id),
    CONTRACTS.map((c) => c.id),
  )
})

test('missing contract fails and names the file', () => {
  const dir = sandbox()
  try {
    rmSync(join(dir, 'baseline.schema.json'))
    const result = verifyContracts(dir)
    assert.equal(result.ok, false)
    assert.equal(result.missing.length, 1)
    assert.equal(result.missing[0].file, 'baseline.schema.json')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('wrong schema id fails and reports the mismatch', () => {
  const dir = sandbox()
  try {
    const path = join(dir, 'finding.schema.json')
    const doc = JSON.parse(readFileSync(path, 'utf8'))
    doc.$id = 'alm.finding/v2'
    writeFileSync(path, JSON.stringify(doc), 'utf8')
    const result = verifyContracts(dir)
    assert.equal(result.ok, false)
    assert.equal(result.invalid.length, 1)
    assert.match(result.invalid[0].message, /alm\.finding\/v1/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('invalid json fails without throwing', () => {
  const dir = sandbox()
  try {
    writeFileSync(join(dir, 'asset.schema.json'), '{not json', 'utf8')
    const result = verifyContracts(dir)
    assert.equal(result.ok, false)
    assert.equal(result.invalid[0].file, 'asset.schema.json')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
