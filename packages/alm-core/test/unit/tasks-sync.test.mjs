import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, test } from 'node:test'
import { draftTasks } from '../../src/tasks/draft.mjs'
import { syncTasks, taskIssueBody } from '../../src/tasks/sync.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
const fixture = join(repoRoot, 'fixtures/order-refund')
const dirs = []

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'alm-sync-'))
  dirs.push(root)
  cpSync(fixture, root, { recursive: true })
  mkdirSync(join(root, '.alm', 'changes'), { recursive: true })
  writeFileSync(
    join(root, '.alm', 'changes', 'CHG-SYNC.json'),
    JSON.stringify({ schema: 'alm.change/v1', changeId: 'CHG-SYNC', baselineSha: 'abcdef1234567890', branch: 'alm/chg-sync', status: 'open' }),
    'utf8',
  )
  draftTasks({ root, changeId: 'CHG-SYNC', requirementIds: ['REQ-PAY-001'] })
  return root
}

after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

function fakeProvider(existing = [], { failAt = -1 } = {}) {
  const created = []
  let sequence = 100
  return {
    created,
    adapter: {
      name: 'fake',
      find: (title) => existing.find((issue) => issue.title === title) ?? null,
      create: (issue) => {
        if (failAt >= 0 && created.length === failAt) throw new Error('board unavailable')
        sequence += 1
        const record = { number: sequence, url: `https://board.test/issues/${sequence}`, title: issue.title }
        created.push(record)
        return record
      },
    },
  }
}

test('taskIssueBody carries the five elements', () => {
  const body = taskIssueBody({
    id: 'TASK-X-001',
    title: 't',
    covers: ['REQ-X-001'],
    blockedBy: [],
    scope: ['requirements/'],
    outOfScope: ['code'],
    interface: 'i',
    positive: 'p',
    negative: 'n',
    evidence: ['alm check'],
  })
  for (const heading of ['## 接口', '## 验收', '## 证据', '覆盖需求', '前置', '实施范围', '不在范围']) {
    assert.ok(body.includes(heading), `${heading} missing`)
  }
})

test('dry-run never calls create and leaves the draft untouched', async () => {
  const root = makeRepo()
  const { adapter, created } = fakeProvider()
  const result = await syncTasks({ root, changeId: 'CHG-SYNC', createProvider: () => adapter })
  assert.equal(result.applied, false)
  assert.equal(created.length, 0)
  assert.equal(result.actions.filter((action) => action.action === 'create').length, 3)
  const payload = JSON.parse(readFileSync(join(root, 'changes/CHG-SYNC/tasks.json'), 'utf8'))
  assert.ok(payload.tasks.every((task) => task.issue === undefined))
})

test('apply creates every missing issue once and is idempotent afterwards', async () => {
  const root = makeRepo()
  const { adapter, created } = fakeProvider()
  const first = await syncTasks({ root, changeId: 'CHG-SYNC', apply: true, createProvider: () => adapter })
  assert.equal(first.actions.filter((action) => action.action === 'created').length, 3)
  assert.equal(created.length, 3)

  const second = await syncTasks({ root, changeId: 'CHG-SYNC', apply: true, createProvider: () => adapter })
  assert.equal(second.actions.filter((action) => action.action === 'skip').length, 3)
  assert.equal(created.length, 3)

  const payload = JSON.parse(readFileSync(join(root, 'changes/CHG-SYNC/tasks.json'), 'utf8'))
  assert.equal(payload.tasks[0].issue.number, 101)
  assert.equal(payload.tasks[0].status, 'open')
})

test('adopts an existing issue by exact title instead of duplicating', async () => {
  const root = makeRepo()
  const existing = [{ number: 7, url: 'https://board.test/issues/7', title: 'TASK-PAY-001 REQ-PAY-001 需求与验收资产' }]
  const { adapter, created } = fakeProvider(existing)
  const result = await syncTasks({ root, changeId: 'CHG-SYNC', apply: true, createProvider: () => adapter })
  assert.ok(result.actions.some((action) => action.action === 'adopt' && action.issue.number === 7))
  assert.equal(created.length, 2)
})

test('a board failure keeps the issues created so far written back', async () => {
  const root = makeRepo()
  const { adapter } = fakeProvider([], { failAt: 1 })
  await assert.rejects(
    () => syncTasks({ root, changeId: 'CHG-SYNC', apply: true, createProvider: () => adapter }),
    /board unavailable/,
  )
  const payload = JSON.parse(readFileSync(join(root, 'changes/CHG-SYNC/tasks.json'), 'utf8'))
  assert.equal(payload.tasks[0].issue.number, 101)
  assert.equal(payload.tasks[1].issue, undefined)
})

test('dry-run needs no board credentials', async () => {
  const root = makeRepo()
  const result = await syncTasks({ root, changeId: 'CHG-SYNC' })
  assert.equal(result.applied, false)
  assert.equal(result.actions.filter((action) => action.action === 'create').length, 3)
  assert.equal(result.actions.filter((action) => action.action === 'create')[0].body.includes('## 验收'), true)
})
