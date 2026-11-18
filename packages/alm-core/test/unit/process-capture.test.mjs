import test from 'node:test'
import assert from 'node:assert/strict'
import { runCaptured } from '../../src/process-capture.mjs'

test('runCaptured returns stdout, stderr and status through the normal pipe path', () => {
  const result = runCaptured(process.execPath, ['-e', "process.stdout.write('out'); process.stderr.write('err')"])
  assert.equal(result.status, 0)
  assert.equal(result.stdout, 'out')
  assert.equal(result.stderr, 'err')
  assert.equal(result.fileFallback, undefined)
})

test('runCaptured falls back to file descriptors and keeps stdin intact', () => {
  const result = runCaptured(process.execPath, [
    '-e',
    "const text = require('node:fs').readFileSync(0, 'utf8'); process.stdout.write(`out:${text}`); process.stderr.write('err:1')",
  ], { input: 'hello', forceFile: true })
  assert.equal(result.fileFallback, true)
  assert.equal(result.status, 0)
  assert.equal(result.stdout, 'out:hello')
  assert.equal(result.stderr, 'err:1')
})

test('the file fallback preserves a non-zero exit and its stderr', () => {
  const result = runCaptured(process.execPath, ['-e', "process.stderr.write('boom'); process.exit(7)"], { forceFile: true })
  assert.equal(result.status, 7)
  assert.equal(result.stderr, 'boom')
  assert.equal(result.error, undefined)
})

test('the file fallback reports a missing binary instead of inventing success', () => {
  const result = runCaptured('alm-definitely-missing-binary', ['--version'], { forceFile: true })
  assert.equal(result.status, null)
  assert.equal(result.error?.code, 'ENOENT')
})
