import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, test } from 'node:test'
import { indexReport } from '../../src/commands.mjs'
import { buildIndex } from '../../src/index/index.mjs'
import * as task001 from '../../src/gates/rules/task-001.mjs'
import { TaskDraftError, draftTasks } from '../../src/tasks/draft.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
const fixture = join(repoRoot, 'fixtures/order-refund')
const dirs = []

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'alm-tasks-'))
  dirs.push(root)
  cpSync(fixture, root, { recursive: true })
  mkdirSync(join(root, '.alm', 'changes'), { recursive: true })
  writeFileSync(
    join(root, '.alm', 'changes', 'CHG-TEST.json'),
    JSON.stringify({ schema: 'alm.change/v1', changeId: 'CHG-TEST', baselineSha: 'abcdef1234567890', branch: 'alm/chg-test', status: 'open' }),
    'utf8',
  )
  return root
}

after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

test('draftTasks writes proposal, tasks.md and tasks.json with three cards per requirement', () => {
  const root = makeRepo()
  const result = draftTasks({ root, changeId: 'CHG-TEST', requirementIds: ['REQ-PAY-001'] })

  assert.equal(result.tasks.length, 3)
  assert.deepEqual(result.tasks.map((task) => task.concern), ['assets', 'implement', 'verify'])
  assert.deepEqual(result.tasks[0].covers, ['REQ-PAY-001'])
  assert.equal(result.tasks[1].blockedBy[0], result.tasks[0].id)
  assert.ok(existsSync(join(root, 'changes/CHG-TEST/tasks.json')))
  assert.match(readFileSync(join(root, 'changes/CHG-TEST/tasks.md'), 'utf8'), /正例/)
  assert.match(readFileSync(join(root, 'changes/CHG-TEST/proposal.md'), 'utf8'), /CHG-TEST/)

  const payload = JSON.parse(readFileSync(join(root, 'changes/CHG-TEST/tasks.json'), 'utf8'))
  assert.equal(payload.schema, 'alm.tasks/v1')
  assert.deepEqual(payload.requirements, ['REQ-PAY-001'])
})

test('draftTasks refuses to overwrite unless forced and rejects unknown targets', () => {
  const root = makeRepo()
  draftTasks({ root, changeId: 'CHG-TEST', requirementIds: ['REQ-PAY-001'] })
  assert.throws(
    () => draftTasks({ root, changeId: 'CHG-TEST', requirementIds: ['REQ-PAY-001'] }),
    (error) => error instanceof TaskDraftError && error.code === 'already-exists',
  )
  assert.ok(draftTasks({ root, changeId: 'CHG-TEST', requirementIds: ['REQ-PAY-001'], force: true }))
  assert.throws(
    () => draftTasks({ root, changeId: 'CHG-TEST', requirementIds: ['REQ-NOPE-001'], force: true }),
    (error) => error instanceof TaskDraftError && error.code === 'unknown-requirement',
  )
})

test('TASK-001 passes a covered draft and fails an uncovered requirement', () => {
  const root = makeRepo()
  draftTasks({ root, changeId: 'CHG-TEST', requirementIds: ['REQ-PAY-001'] })
  const index = buildIndex(indexReport(root).assets)

  assert.deepEqual(task001.check({ root, index }), [])

  const file = join(root, 'changes/CHG-TEST/tasks.json')
  const payload = JSON.parse(readFileSync(file, 'utf8'))
  payload.tasks = payload.tasks.filter((task) => task.concern !== 'verify')
  for (const task of payload.tasks) task.covers = []
  writeFileSync(file, JSON.stringify(payload), 'utf8')

  const findings = task001.check({ root, index })
  assert.ok(findings.some((finding) => finding.message.includes('REQ-PAY-001 is not covered')))
  assert.ok(findings.some((finding) => finding.message.includes('covers no requirement')))
})

test('TASK-001 skips when no task drafts exist', () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-tasks-empty-'))
  dirs.push(root)
  cpSync(fixture, root, { recursive: true })
  const index = buildIndex(indexReport(root).assets)
  const outcome = task001.check({ root, index })
  assert.equal(outcome.status, 'skip')
})
