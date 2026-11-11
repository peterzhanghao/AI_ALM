import assert from 'node:assert/strict'
import test from 'node:test'
import { commandRunRecord } from '../../src/acceptance/acceptance.mjs'

// Regression cover for REQ-ALM-002 / FAIL-REQ-ALM-001-001: the acceptance
// evidence used to drop `spawnSync` errors, so a command that could not start
// (EPERM/ENOENT) or timed out was archived as `exitCode: null` with empty
// stderr — a red run nobody could explain. These tests exercise the pure
// mapping, so they run in environments that forbid spawning child processes.

const ENTRY = { id: 'cmd-1', command: ['node', '--test'] }

function spawnError(code, message) {
  return Object.assign(new Error(message), { code })
}

test('a successful command keeps its exit code and reports no error', () => {
  const record = commandRunRecord({
    entry: ENTRY,
    result: { status: 0, stdout: 'ok', stderr: '' },
    durationMs: 12,
  })
  assert.equal(record.id, 'cmd-1')
  assert.deepEqual(record.command, ['node', '--test'])
  assert.equal(record.exitCode, 0)
  assert.equal(record.timedOut, false)
  assert.equal(record.spawnFailed, false)
  assert.equal(record.error, null)
  assert.equal(record.durationMs, 12)
  assert.equal(record.stdout, 'ok')
})

test('a spawn failure (EPERM) is preserved instead of vanishing into a null exit code', () => {
  const record = commandRunRecord({
    entry: ENTRY,
    result: {
      status: null,
      stdout: '',
      stderr: '',
      error: spawnError('EPERM', 'spawnSync node EPERM'),
    },
    durationMs: 8,
  })
  assert.equal(record.exitCode, null)
  assert.equal(record.timedOut, false)
  assert.equal(record.spawnFailed, true)
  assert.equal(record.error.code, 'EPERM')
  assert.match(record.error.message, /EPERM/)
})

test('a timeout is reported as timed out, not as a generic spawn failure', () => {
  const record = commandRunRecord({
    entry: ENTRY,
    result: {
      status: null,
      signal: 'SIGTERM',
      stdout: '',
      stderr: '',
      error: spawnError('ETIMEDOUT', 'spawnSync node ETIMEDOUT'),
    },
    durationMs: 120000,
  })
  assert.equal(record.timedOut, true)
  assert.equal(record.spawnFailed, false)
  assert.equal(record.error.code, 'ETIMEDOUT')
})

test('an executor error without a code still produces a diagnosable record', () => {
  const record = commandRunRecord({
    entry: ENTRY,
    result: { error: new Error('executor refused') },
    durationMs: 3,
  })
  assert.equal(record.error.code, 'exec-failed')
  assert.match(record.error.message, /executor refused/)
  assert.equal(record.exitCode, null)
})

test('long output keeps the tail so the failure summary survives truncation', () => {
  const stdout = `${'x'.repeat(30000)}SUMMARY: 3 failed`
  const record = commandRunRecord({
    entry: ENTRY,
    result: { status: 1, stdout, stderr: 'boom', error: null },
    durationMs: 5,
  })
  assert.equal(record.exitCode, 1)
  assert.equal(record.stdout.length, 20000)
  assert.match(record.stdout, /SUMMARY: 3 failed$/)
  assert.equal(record.stderr, 'boom')
  assert.equal(record.spawnFailed, false)
  assert.equal(record.error, null)
})
