import test from 'node:test'
import assert from 'node:assert/strict'
import { canonicalJson } from '../../src/baseline/canonical.mjs'
import { contentHashOf } from '../../src/baseline/baseline.mjs'

test('canonicalJson sorts keys at every depth and keeps arrays', () => {
  const a = canonicalJson({ b: 1, a: { d: [3, 2], c: 2 } })
  const b = canonicalJson({ a: { c: 2, d: [3, 2] }, b: 1 })
  assert.equal(a, b)
  assert.equal(a, '{"a":{"c":2,"d":[3,2]},"b":1}')
})

test('contentHashOf ignores key order inside each file entry', () => {
  const first = contentHashOf([{ path: 'a.yml', sha256: 'a'.repeat(64), size: 1 }])
  const second = contentHashOf([{ size: 1, sha256: 'a'.repeat(64), path: 'a.yml' }])
  assert.equal(first, second)
  assert.match(first, /^[0-9a-f]{64}$/)
})
