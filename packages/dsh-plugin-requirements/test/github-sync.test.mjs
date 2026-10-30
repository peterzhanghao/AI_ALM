import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { draftTasks } from '../../alm-core/src/tasks/draft.mjs'
import { applyGithub, previewGithub } from '../github-sync.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const fixture = join(repoRoot, 'fixtures/order-refund')
const dirs = []

function makeDraftRepo() {
  const root = mkdtempSync(join(tmpdir(), 'alm-github-sync-'))
  dirs.push(root)
  cpSync(fixture, root, { recursive: true })
  mkdirSync(join(root, '.alm', 'changes'), { recursive: true })
  writeFileSync(
    join(root, '.alm', 'changes', 'CHG-GH-001.json'),
    JSON.stringify({
      schema: 'alm.change/v1',
      changeId: 'CHG-GH-001',
      baselineSha: 'a'.repeat(40),
      branch: 'alm/chg-gh-001',
      status: 'open',
    }),
  )
  draftTasks({ root, changeId: 'CHG-GH-001', requirementIds: ['REQ-PAY-004'] })
  return root
}

function fakeProvider() {
  const created = []
  const board = []
  const statuses = []
  let sequence = 100
  return {
    created,
    board,
    statuses,
    adapter: {
      name: 'fake',
      find: () => null,
      create: ({ title, body, labels, parent }) => {
        sequence += 1
        const issue = { number: sequence, url: `https://board.test/${sequence}`, title, body, labels, parent: parent ?? null }
        created.push(issue)
        return issue
      },
      addToProject: (url, number) => board.push({ url, number }),
      setStatus: (url, name) => statuses.push({ url, name }),
    },
  }
}

test.after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

test('previewGithub shows issue titles/bodies/labels without touching GitHub', async () => {
  const root = makeDraftRepo()
  const plan = await previewGithub({ root, changeId: 'CHG-GH-001' })
  assert.equal(plan.schema, 'alm.github.plan/v1')
  assert.equal(plan.repo, 'peterzhanghao/AI_ALM')
  assert.equal(plan.board, 1)
  assert.equal(plan.requirements.length, 1)
  assert.equal(plan.requirements[0].action, 'create')
  assert.match(plan.requirements[0].title, /^\[REQ-PAY-004\]/)
  assert.ok(plan.requirements[0].labels.includes('type::requirement'))
  assert.match(plan.requirements[0].body, /退款幂等/)
  assert.equal(plan.tasks.length, 3)
  assert.ok(plan.tasks.every((task) => task.action === 'create' && /^TASK-PAY-00/.test(task.title)))
  assert.ok(!existsSync(join(root, '.alm', 'github.json')))
})

test('applyGithub creates requirement + task issues, fills mapping and is idempotent', async () => {
  const root = makeDraftRepo()
  const fake = fakeProvider()
  const first = await applyGithub({ root, changeId: 'CHG-GH-001', createProvider: () => fake.adapter })
  assert.equal(first.schema, 'alm.github.sync/v1')
  assert.equal(first.requirements[0].action, 'created')
  assert.equal(first.tasks.filter((task) => task.action === 'created').length, 3)
  assert.equal(fake.created.length, 4)
  assert.equal(fake.board.length, 4)
  assert.equal(fake.statuses.length, 4)
  assert.ok(fake.created[0].title.startsWith('[REQ-PAY-004]'))
  assert.equal(fake.created[1].parent, fake.created[0].number)

  const mapping = JSON.parse(readFileSync(join(root, '.alm', 'github.json'), 'utf8'))
  assert.equal(mapping.requirements['REQ-PAY-004'].number, fake.created[0].number)
  assert.equal(Object.keys(mapping.tasks).length, 3)

  const second = await applyGithub({ root, changeId: 'CHG-GH-001', createProvider: () => fake.adapter })
  assert.ok(second.requirements.every((action) => action.action === 'skip'))
  assert.ok(second.tasks.every((action) => action.action === 'skip'))
  assert.equal(fake.created.length, 4)
})

test('githubContext rejects unlinked projects and missing drafts', async () => {
  const unlinked = mkdtempSync(join(tmpdir(), 'alm-github-unlinked-'))
  dirs.push(unlinked)
  await assert.rejects(() => previewGithub({ root: unlinked, changeId: 'CHG-X-001' }), (error) => error.code === 'no-project')

  const root = makeDraftRepo()
  rmSync(join(root, 'changes', 'CHG-GH-001'), { recursive: true, force: true })
  await assert.rejects(() => previewGithub({ root, changeId: 'CHG-GH-001' }), (error) => error.code === 'no-draft')
})
