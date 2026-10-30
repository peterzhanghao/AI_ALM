import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, test } from 'node:test'
import { readProject } from '../../src/project/project.mjs'
import { readMapping } from '../../src/github/mapping.mjs'
import { requirementIssueBody, requirementLabels, syncRequirementIssues } from '../../src/github/sync-requirements.mjs'
import { draftTasks } from '../../src/tasks/draft.mjs'
import { syncTasks } from '../../src/tasks/sync.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
const fixture = join(repoRoot, 'fixtures/order-refund')
const dirs = []

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'alm-gh-sync-'))
  dirs.push(root)
  cpSync(fixture, root, { recursive: true })
  mkdirSync(join(root, '.alm', 'changes'), { recursive: true })
  writeFileSync(
    join(root, '.alm', 'changes', 'CHG-GH-001.json'),
    JSON.stringify({ schema: 'alm.change/v1', changeId: 'CHG-GH-001', baselineSha: 'abcdef1234567890', branch: 'alm/chg-gh', status: 'open' }),
  )
  draftTasks({ root, changeId: 'CHG-GH-001', requirementIds: ['REQ-PAY-004'] })
  return { root, project: readProject(root) }
}

function fakeProvider(existing = []) {
  const created = []
  const board = []
  let sequence = 100
  return {
    created,
    board,
    adapter: {
      name: 'fake',
      find: (title) => existing.find((issue) => issue.title === title) ?? created.find((issue) => issue.title === title) ?? null,
      create: ({ title, body, labels, parent }) => {
        sequence += 1
        const issue = { number: sequence, url: `https://board.test/${sequence}`, title, parent: parent ?? null, labels, body }
        created.push(issue)
        return issue
      },
      addToProject: (url, number) => board.push({ url, number }),
    },
  }
}

after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

test('requirement labels and body carry project, priority and acceptance', () => {
  const { root, project } = makeRepo()
  const asset = {
    id: 'REQ-PAY-004',
    title: '退款幂等',
    status: 'proposed',
    owner: 'team-payments',
    links: [{ type: 'verified_by', target: 'TEST-PAY-004' }],
    extra: { priority: 'P1', brief: 'requirements/briefs/REQ-PAY-004.md' },
  }
  const labels = requirementLabels(project, asset)
  assert.deepEqual(labels, ['type::requirement', 'project::pay', 'priority::P1'])

  const body = requirementIssueBody(asset, { root, project })
  assert.match(body, /退款幂等/)
  assert.match(body, /TEST-PAY-004/)
  assert.match(body, /requirements\/briefs\/REQ-PAY-004\.md/)
})

test('dry-run previews requirement issues without touching GitHub', async () => {
  const { root, project } = makeRepo()
  const fake = fakeProvider()
  const result = await syncRequirementIssues({ root, changeId: 'CHG-GH-001', createProvider: () => fake.adapter, project })
  assert.equal(result.applied, false)
  assert.equal(fake.created.length, 0)
  assert.equal(result.actions[0].action, 'create')
  assert.match(result.actions[0].title, /^\[REQ-PAY-004\]/)
  assert.ok(!existsSync(join(root, '.alm', 'github.json')))
})

test('apply creates requirement issue, adds it to the board and writes the mapping', async () => {
  const { root, project } = makeRepo()
  const fake = fakeProvider()
  const result = await syncRequirementIssues({ root, changeId: 'CHG-GH-001', apply: true, createProvider: () => fake.adapter, project })
  assert.equal(result.actions[0].action, 'created')
  assert.equal(fake.created.length, 1)
  assert.deepEqual(fake.board, [{ url: fake.created[0].url, number: 1 }])

  const mapping = readMapping(root)
  assert.equal(mapping.requirements['REQ-PAY-004'].number, 101)
  assert.equal(mapping.repo, 'peterzhanghao/AI_ALM')
})

test('tasks adopt the requirement issue as parent and are idempotent', async () => {
  const { root, project } = makeRepo()
  const fake = fakeProvider()
  await syncRequirementIssues({ root, changeId: 'CHG-GH-001', apply: true, createProvider: () => fake.adapter, project })
  const taskResult = await syncTasks({ root, changeId: 'CHG-GH-001', apply: true, createProvider: () => fake.adapter, project })
  assert.equal(taskResult.actions.filter((action) => action.action === 'created').length, 3)
  for (const action of taskResult.actions) {
    assert.equal(action.issue.parent ?? 101, 101)
  }

  const second = await syncTasks({ root, changeId: 'CHG-GH-001', apply: true, createProvider: () => fake.adapter, project })
  assert.equal(second.actions.filter((action) => action.action === 'skip').length, 3)
  assert.equal(fake.created.length, 4)

  const mapping = readMapping(root)
  assert.equal(Object.keys(mapping.tasks).length, 3)
  assert.equal(mapping.tasks['TASK-PAY-001'].number, 102)
})

test('requirement sync adopts an existing issue by exact title', async () => {
  const { root, project } = makeRepo()
  const existing = [{ number: 7, url: 'https://board.test/7', title: '[REQ-PAY-004] 同一幂等键的重复退款请求返回同一退款单' }]
  const fake = fakeProvider(existing)
  const result = await syncRequirementIssues({ root, changeId: 'CHG-GH-001', apply: true, createProvider: () => fake.adapter, project })
  assert.equal(result.actions[0].action, 'adopt')
  assert.equal(fake.created.length, 0)
  assert.deepEqual(fake.board, [{ url: existing[0].url, number: 1 }])
})
