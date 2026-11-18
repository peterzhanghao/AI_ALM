import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { classifyAcceptanceRun, summarizeAcceptanceRun } from '../../src/acceptance/acceptance.mjs'

test('EPERM-only test failures are a blocked environment, not a code failure', () => {
  const summary = summarizeAcceptanceRun({
    requirement: 'REQ-X',
    result: 'fail',
    worktree: { after: { treeHash: 'a'.repeat(40) } },
    commands: [{
      id: 'cmd-1',
      exitCode: 1,
      durationMs: 100,
      stderr: 'not ok - spawnSync git EPERM\nnot ok - spawnSync node EPERM',
    }],
  })
  assert.equal(summary.status, 'blocked')
  assert.equal(summary.failureCount, 0)
  assert.equal(summary.blockedCount, 1)
  assert.match(summary.line, /验收被运行环境阻断，不是断言失败/)
  assert.doesNotMatch(summary.line, /验收失败/)
  assert.match(summary.line, /宿主\/CI/)
})

test('a spawn-failed command is blocked with its capability named', () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-classify-'))
  try {
    mkdirSync(join(root, 'test'), { recursive: true })
    writeFileSync(join(root, 'test', 'ui.test.mjs'), "import { chromium } from 'playwright'\n")
    const summary = summarizeAcceptanceRun({
      requirement: 'REQ-X',
      result: 'fail',
      commands: [{
        id: 'cmd-1',
        command: ['node', '--test', 'test/ui.test.mjs'],
        exitCode: null,
        spawnFailed: true,
        error: { code: 'EPERM', message: 'spawnSync node EPERM' },
      }],
    }, { root })
    assert.equal(summary.status, 'blocked')
    assert.equal(summary.blocked[0].capabilities.includes('browser'), true)
    assert.match(summary.line, /浏览器/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('real assertion failures stay red even when a different command is blocked', () => {
  const tap = [
    'not ok 2 - 确认方案后进入实现',
    '  ---',
    "  expected: '2'",
    "  actual: '1'",
  ].join('\n')
  const summary = summarizeAcceptanceRun({
    requirement: 'REQ-X',
    result: 'fail',
    commands: [
      { id: 'cmd-1', exitCode: 1, stdout: tap },
      { id: 'cmd-2', exitCode: 1, stderr: 'not ok - spawnSync git EPERM' },
    ],
  })
  assert.equal(summary.status, 'fail')
  assert.equal(summary.failureCount, 1)
  assert.equal(summary.blockedCount, 1)
  assert.match(summary.line, /验收失败 1 项/)
  assert.match(summary.line, /另有 1 条命令被运行环境阻断/)
})

test('a mixed command with a real assertion and an EPERM stays a failure', () => {
  const summary = classifyAcceptanceRun({
    commands: [{
      id: 'cmd-1',
      exitCode: 1,
      stderr: 'not ok 1 - real assertion\nnot ok - spawnSync git EPERM',
    }],
  })
  assert.equal(summary.status, 'fail')
  assert.equal(summary.blocked.length, 0)
})

test('an empty green run stays pass', () => {
  const summary = summarizeAcceptanceRun({
    requirement: 'REQ-X', result: 'pass', commands: [{ id: 'cmd-1', exitCode: 0, stdout: 'ok 1 - fine' }],
  })
  assert.equal(summary.status, 'pass')
  assert.match(summary.line, /验收通过/)
})
