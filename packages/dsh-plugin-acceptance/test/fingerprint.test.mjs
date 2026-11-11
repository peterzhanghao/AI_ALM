import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, test } from 'node:test'
import {
  FINGERPRINT_SCHEMA,
  fileFingerprint,
  fileFingerprints,
  fingerprintDrift,
  gitSubject,
  sha256,
  subjectFingerprint,
} from '../engine/fingerprint.mjs'
import { cleanup, gitInit, makeWorkspace } from './helpers.mjs'

const dirs = []
after(() => cleanup(dirs))

function repo() {
  const root = makeWorkspace('alm-fingerprint-')
  dirs.push(root)
  const head = gitInit(root)
  return { root, head }
}

test('git subject records head, branch and a stable dirty digest', () => {
  const { root, head } = repo()
  const clean = gitSubject(root)
  assert.equal(clean.available, true)
  assert.equal(clean.headSha, head)
  assert.equal(clean.dirty, false)
  assert.equal(clean.statusDigest, null)

  writeFileSync(join(root, 'index.js'), 'export const answer = 42\n', 'utf8')
  const dirty = gitSubject(root)
  assert.equal(dirty.dirty, true)
  assert.equal(typeof dirty.statusDigest, 'string')
  assert.equal(gitSubject(root).statusDigest, dirty.statusDigest, 'digest must be stable for the same tree')
})

test('a missing git repository degrades instead of throwing', () => {
  const root = makeWorkspace('alm-fingerprint-')
  dirs.push(root)
  const subject = gitSubject(root)
  assert.deepEqual(subject, { available: false, headSha: null, branch: null, dirty: null, statusDigest: null })
  assert.equal(subjectFingerprint({ root }).schema, FINGERPRINT_SCHEMA)
})

test('file fingerprints use root-relative posix paths', () => {
  const { root } = repo()
  writeFileSync(join(root, 'a.txt'), 'hello', 'utf8')
  const fingerprint = fileFingerprint(root, join(root, 'a.txt'))
  assert.equal(fingerprint.path, 'a.txt')
  assert.equal(fingerprint.sha256, sha256('hello'))
  assert.equal(fingerprint.bytes, 5)
  assert.ok(fingerprint.mtimeMs > 0)
  assert.equal(fileFingerprint(root, 'a.txt').sha256, fingerprint.sha256)
})

test('unreadable files are recorded as unhashed rather than crashing the round', () => {
  const { root } = repo()
  const files = fileFingerprints(root, ['a.txt', 'missing.js', 'a.txt'])
  assert.equal(files.length, 2, 'duplicates collapse')
  assert.equal(files[0].sha256, null)
  assert.deepEqual(files.map((file) => file.path), ['a.txt', 'missing.js'])
})

test('drift is detected when the code under test moves on', () => {
  const { root } = repo()
  writeFileSync(join(root, 'index.js'), 'v1', 'utf8')
  const recorded = subjectFingerprint({ root, files: ['index.js'] })

  assert.deepEqual(fingerprintDrift(recorded, subjectFingerprint({ root, files: ['index.js'] })), [])

  writeFileSync(join(root, 'index.js'), 'v2', 'utf8')
  writeFileSync(join(root, 'extra.js'), 'new', 'utf8')
  const drift = fingerprintDrift(recorded, subjectFingerprint({ root, files: ['index.js', 'extra.js'] }))
  assert.ok(drift.some((line) => line.includes('index.js sha256 changed')))
  assert.ok(drift.some((line) => line.includes('extra.js was not in the round')))
  assert.ok(drift.some((line) => line.includes('working tree status changed')))
})
