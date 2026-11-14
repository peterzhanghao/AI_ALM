import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  AcceptanceError,
  applyAcceptanceConfig,
  configPath,
  normalizeAcceptanceCommands,
  parseCommandArgs,
  planAcceptanceConfig,
  readAcceptanceConfig,
} from '../../src/acceptance/acceptance.mjs'

function tempRoot() {
  const dir = mkdtempSync(join(tmpdir(), 'alm-acceptance-config-'))
  writeFileSync(join(dir, '.keep'), '')
  return dir
}

test('parseCommandArgs keeps quoted arguments together', () => {
  assert.deepEqual(parseCommandArgs('node --test'), ['node', '--test'])
  assert.deepEqual(parseCommandArgs('node -e "process.exit(0)"'), ['node', '-e', 'process.exit(0)'])
  assert.deepEqual(parseCommandArgs("node -e 'console.log(1)'"), ['node', '-e', 'console.log(1)'])
})

test('parseCommandArgs rejects shell operators and unbalanced quotes', () => {
  assert.throws(() => parseCommandArgs('node --test | tee out.txt'), (error) => error instanceof AcceptanceError && error.code === 'shell-not-allowed')
  assert.throws(() => parseCommandArgs('node --test > out.txt'), (error) => error.code === 'shell-not-allowed')
  assert.throws(() => parseCommandArgs('node -e "unclosed'), (error) => error.code === 'command-invalid')
  assert.throws(() => parseCommandArgs('   '), (error) => error.code === 'command-required')
})

test('normalizeAcceptanceCommands validates scope, binary whitelist and timeout', () => {
  assert.throws(
    () => normalizeAcceptanceCommands('node --test'),
    (error) => error.code === 'test-scope-required' && error.status === 409,
  )
  for (const command of ['pnpm test', 'pnpm run test', 'npm test', 'npm run test']) {
    assert.throws(
      () => normalizeAcceptanceCommands(command),
      (error) => error.code === 'generic-test-command' && error.status === 409,
      command,
    )
  }
  const commands = normalizeAcceptanceCommands('node --test packages/alm-core/test/unit/acceptance.test.mjs')
  assert.equal(commands.length, 1)
  assert.deepEqual(commands[0].command, ['node', '--test', 'packages/alm-core/test/unit/acceptance.test.mjs'])
  assert.equal(commands[0].id, 'verify')
  assert.throws(
    () => normalizeAcceptanceCommands('bash -lc "npm test"'),
    (error) => error.code === 'binary-not-allowed',
  )
  assert.throws(
    () => normalizeAcceptanceCommands([{ id: 'slow', command: ['node', '--test', 'test/feature.test.mjs'], timeoutMs: 0 }]),
    (error) => error.code === 'invalid-timeout',
  )
})

test('planAcceptanceConfig writes nothing', () => {
  const root = tempRoot()
  try {
    const plan = planAcceptanceConfig({ root, requirementId: 'REQ-PAY-001', commands: ['node --test packages/pay/test/refund.test.mjs'] })
    assert.equal(plan.applied, false)
    assert.equal(plan.requirement, 'REQ-PAY-001')
    assert.equal(plan.file, configPath(root, 'REQ-PAY-001'))
    assert.equal(readAcceptanceConfig(root, 'REQ-PAY-001'), null)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('applyAcceptanceConfig writes a registry the reader accepts', () => {
  const root = tempRoot()
  try {
    const result = applyAcceptanceConfig({
      root,
      requirementId: 'REQ-PAY-001',
      commands: ['node --test packages/pay/test/refund.test.mjs', 'npm run smoke'],
    })
    assert.equal(result.applied, true)
    const stored = readAcceptanceConfig(root, 'REQ-PAY-001')
    assert.equal(stored.schema, 'alm.acceptance.config/v1')
    assert.deepEqual(stored.commands.map((entry) => entry.command), [
      ['node', '--test', 'packages/pay/test/refund.test.mjs'],
      ['npm', 'run', 'smoke'],
    ])
    const raw = JSON.parse(readFileSync(configPath(root, 'REQ-PAY-001'), 'utf8'))
    assert.equal(raw.schema, 'alm.acceptance.config/v1')
    assert.equal(raw.requirement, 'REQ-PAY-001')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('legacy generic configs remain readable for migration but cannot be newly registered', () => {
  const root = tempRoot()
  try {
    const file = configPath(root, 'REQ-PAY-001')
    applyAcceptanceConfig({ root, requirementId: 'REQ-PAY-001', commands: ['node --test packages/pay/test/refund.test.mjs'] })
    writeFileSync(
      file,
      JSON.stringify(
        {
          schema: 'alm.acceptance.config/v1',
          requirement: 'REQ-PAY-001',
          commands: [{ id: 'cmd-1', command: ['pnpm', 'test'], timeoutMs: 120000 }],
        },
        null,
        2,
      ),
    )
    assert.deepEqual(readAcceptanceConfig(root, 'REQ-PAY-001').commands[0].command, ['pnpm', 'test'])
    assert.throws(
      () => applyAcceptanceConfig({ root, requirementId: 'REQ-PAY-001', commands: ['pnpm test'] }),
      (error) => error.code === 'generic-test-command',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('applyAcceptanceConfig keeps the previous registry when the write fails', () => {
  const root = tempRoot()
  try {
    applyAcceptanceConfig({ root, requirementId: 'REQ-PAY-001', commands: ['node --test packages/pay/test/refund.test.mjs'] })
    const before = readFileSync(configPath(root, 'REQ-PAY-001'), 'utf8')
    assert.throws(() =>
      applyAcceptanceConfig({
        root,
        requirementId: 'REQ-PAY-001',
        commands: ['bash -lc "npm test"'],
        // Validation fails before any write happens.
      }),
    )
    assert.equal(readFileSync(configPath(root, 'REQ-PAY-001'), 'utf8'), before)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
