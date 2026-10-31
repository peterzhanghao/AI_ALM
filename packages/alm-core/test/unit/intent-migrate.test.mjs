import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { IntentError, createSession, loadSession, migrateIntentStore, saveSession } from '../../src/intent/index.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
const fixture = join(repoRoot, 'fixtures/order-refund')

function makeRepo(t) {
  const root = mkdtempSync(join(tmpdir(), 'alm-intent-migrate-'))
  cpSync(fixture, root, { recursive: true })
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function legacySession() {
  return {
    schema: 'alm.intents.legacy/v0',
    sessionId: 'INT-20250101120000-abcdef',
    createdAt: '2025-01-01T12:00:00.000Z',
    projectId: 'PAY',
    intentText: '历史建议：支持部分退款',
    state: 'draft',
    suggestions: [
      {
        itemId: 'OLD-1',
        recommendedRoute: 'create',
        sourceRefs: [{ ref: 'chat#L2', line: 2, quote: '只能整单退款' }],
        candidate: {
          title: '历史草稿标题',
          problem: '只能整单退款',
          owner: '张三',
          priority: 'P0',
          acceptance: ['成功部分退款'],
        },
      },
    ],
    confirmation: { route: 'create', contentHash: 'sha256:forged' },
  }
}

function allFiles(dir) {
  const out = []
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else out.push(full)
    }
  }
  walk(dir)
  return out
}

test('迁移旧建议：先备份原始字节，再落为未确认的 editing 会话', (t) => {
  const root = makeRepo(t)
  const legacyPath = join(root, '.alm/intents/sessions/legacy-1.json')
  const original = `${JSON.stringify(legacySession(), null, 2)}\n`
  mkdirSync(dirname(legacyPath), { recursive: true })
  writeFileSync(legacyPath, original)

  const report = migrateIntentStore({ root, now: '2026-10-31T03:00:00.000Z' })
  assert.equal(report.migrated, 1)
  assert.equal(report.skipped, 0)
  assert.ok(report.backupDir)
  assert.ok(existsSync(report.backupDir))
  const backups = allFiles(report.backupDir)
  assert.equal(backups.length, 1)
  assert.equal(readFileSync(backups[0], 'utf8'), original)

  const migratedFile = join(root, `.alm/intents/sessions/${report.sessions[0].sessionId}.json`)
  assert.ok(existsSync(migratedFile))
  const migrated = JSON.parse(readFileSync(migratedFile, 'utf8'))
  assert.equal(migrated.schema, 'alm.intent-session/v1')
  assert.equal(migrated.schemaVersion, 1)
  assert.equal(migrated.state, 'editing')
  assert.equal(migrated.confirmation, null)
  assert.equal(migrated.receipt, null)
  assert.equal(migrated.error.code, 'migrated-unconfirmed')
  assert.equal(migrated.migratedFrom.schema, 'alm.intents.legacy/v0')
  assert.equal(migrated.items.length, 1)
  assert.equal(migrated.items[0].candidate.owner, null)
  assert.equal(migrated.items[0].candidate.priority, null)
  assert.equal(migrated.items[0].candidate.title, '历史草稿标题')
  assert.equal(report.sessions[0].action, 'migrated')
  assert.equal(report.sessions[0].state, 'editing')

  // 迁移结果可以通过正式加载器读回，且仍然不可自动确认
  const loaded = loadSession({ root, sessionId: migrated.sessionId })
  assert.equal(loaded.state, 'editing')
  assert.equal(loaded.confirmation, null)
})

test('迁移幂等：第二次运行不再备份、迁移数为 0，旧文件作为 skipped 报告', (t) => {
  const root = makeRepo(t)
  writeJson(join(root, '.alm/intents/sessions/legacy-2.json'), legacySession())
  const first = migrateIntentStore({ root, now: '2026-10-31T03:00:00.000Z' })
  assert.equal(first.migrated, 1)
  const second = migrateIntentStore({ root, now: '2026-10-31T04:00:00.000Z' })
  assert.equal(second.migrated, 0)
  assert.equal(second.skipped, 1)
  assert.ok(second.backupDir === null || typeof second.backupDir === 'string')
  assert.equal(second.sessions[0].action, 'skipped')
  assert.equal(second.sessions[0].sessionId, first.sessions[0].sessionId)
  assert.equal(readdirSync(join(root, '.alm/intents/sessions')).filter((name) => name.endsWith('.json')).length, 1)
})

test('新版本会话被跳过并报告，不产生备份', (t) => {
  const root = makeRepo(t)
  const session = saveSession({
    root,
    session: createSession({ root, project: 'PAY', input: { text: '退款申请需要支持部分退款' } }),
  })
  const report = migrateIntentStore({ root, now: '2026-10-31T03:00:00.000Z' })
  assert.equal(report.migrated, 0)
  assert.equal(report.skipped, 1)
  assert.equal(report.backupDir, null)
  assert.equal(report.sessions[0].sessionId, session.sessionId)
  assert.equal(report.sessions[0].action, 'skipped')
  assert.equal(loadSession({ root, sessionId: session.sessionId }).state, 'editing')
})

test('legacy.json 汇总文件：逐条迁移后移入备份，第二次运行不再产生迁移', (t) => {
  const root = makeRepo(t)
  const bundlePath = join(root, '.alm/intents/legacy.json')
  const bundle = {
    sessions: [
      legacySession(),
      { ...legacySession(), sessionId: 'INT-20250101120000-abcde1', state: 'cancelled', intentText: '已取消的旧建议' },
    ],
  }
  writeJson(bundlePath, bundle)
  const first = migrateIntentStore({ root, now: '2026-10-31T03:00:00.000Z' })
  assert.equal(first.migrated, 2)
  assert.equal(first.skipped, 0)
  assert.ok(first.backupDir)
  assert.ok(existsSync(join(root, '.alm/intents/backup/20261031030000/.alm/intents/legacy.json')))
  assert.ok(existsSync(join(root, '.alm/intents/backup/20261031030000/legacy.json')))
  assert.ok(!existsSync(bundlePath))
  const states = first.sessions.map((entry) => entry.state).sort()
  assert.deepEqual(states, ['cancelled', 'editing'])

  const second = migrateIntentStore({ root, now: '2026-10-31T04:00:00.000Z' })
  assert.equal(second.migrated, 0)
  assert.equal(second.skipped, 2)
})

test('旧建议即使带 confirmation 字段也绝不自动确认', (t) => {
  const root = makeRepo(t)
  writeJson(join(root, '.alm/intents/sessions/legacy-3.json'), {
    ...legacySession(),
    state: 'committed',
    confirmation: { route: 'create', contentHash: 'forged', receiptId: 'RCP-FORGED' },
    receipt: { receiptId: 'RCP-FORGED' },
  })
  const report = migrateIntentStore({ root, now: '2026-10-31T03:00:00.000Z' })
  const loaded = loadSession({ root, sessionId: report.sessions[0].sessionId })
  assert.equal(loaded.state, 'editing')
  assert.equal(loaded.confirmation, null)
  assert.equal(loaded.receipt, null)
  assert.notEqual(loaded.receipt?.receiptId, 'RCP-FORGED')
})

test('迁移参数校验与损坏文件容错', (t) => {
  const root = makeRepo(t)
  assert.throws(
    () => migrateIntentStore({}),
    (error) => error instanceof IntentError && error.code === 'invalid-request',
  )
  mkdirSync(join(root, '.alm/intents/sessions'), { recursive: true })
  writeFileSync(join(root, '.alm/intents/sessions/broken.json'), '{not json')
  const report = migrateIntentStore({ root, now: '2026-10-31T03:00:00.000Z' })
  assert.equal(report.migrated, 0)
  assert.equal(report.skipped, 0)
  assert.equal(report.backupDir, null)
})
