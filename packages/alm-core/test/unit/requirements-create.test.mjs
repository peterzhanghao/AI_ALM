import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { indexReport } from '../../src/commands.mjs'
import { createRequirement, nextRequirementId, planRequirement } from '../../src/requirements/create.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
const fixture = join(repoRoot, 'fixtures/order-refund')
const dirs = []

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'alm-req-create-'))
  dirs.push(root)
  cpSync(fixture, root, { recursive: true })
  return root
}

test.after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

test('planRequirement picks the next id and returns file content without writing', () => {
  const root = makeRepo()
  assert.equal(nextRequirementId({ root, projectId: 'PAY' }), 'REQ-PAY-005')
  const plan = planRequirement({ root, title: '退款状态对账', brief: '每天对账退款状态', priority: 'P2' })
  assert.equal(plan.schema, 'alm.requirement.plan/v1')
  assert.equal(plan.requirementId, 'REQ-PAY-005')
  assert.equal(plan.project, 'PAY')
  assert.equal(plan.file, 'requirements/req-pay-005.sdoc')
  assert.equal(plan.briefFile, 'requirements/briefs/REQ-PAY-005.md')
  assert.equal(plan.owner, '支付团队')
  assert.match(plan.content, /UID: REQ-PAY-005/)
  assert.match(plan.content, /PROJECT: PAY/)
  assert.match(plan.content, /STATUS: proposed/)
  assert.match(plan.briefContent, /## 背景/)
  assert.ok(!existsSync(join(root, plan.file)))
})

test('createRequirement apply writes the sdoc and brief and reports gate state', () => {
  const root = makeRepo()
  const result = createRequirement({ root, title: '退款状态对账', brief: '每天对账退款状态', apply: true })
  assert.equal(result.applied, true)
  assert.ok(existsSync(join(root, 'requirements/req-pay-005.sdoc')))
  assert.ok(existsSync(join(root, 'requirements/briefs/REQ-PAY-005.md')))
  assert.match(readFileSync(join(root, 'requirements/briefs/REQ-PAY-005.md'), 'utf8'), /退款状态对账/)
  const index = indexReport(root)
  const asset = index.assets.find((entry) => entry.id === 'REQ-PAY-005')
  assert.ok(asset, 'new requirement should be indexed')
  assert.equal(asset.status, 'proposed')
  assert.equal(result.check.gaps, 1)

  assert.throws(
    () => planRequirement({ root, title: '重复创建', id: 'REQ-PAY-005' }),
    (error) => error.code === 'already-exists' && error.status === 409,
  )
})

test('createRequirement validates project, priority and id', () => {
  const root = makeRepo()
  assert.throws(
    () => planRequirement({ root, title: 'x', priority: 'P9' }),
    (error) => error.code === 'invalid-priority',
  )
  assert.throws(
    () => planRequirement({ root, title: 'x', id: 'REQ-CRM-005' }),
    (error) => error.code === 'project-mismatch',
  )
  assert.throws(
    () => planRequirement({ root, title: '' }),
    (error) => error.code === 'title-required',
  )
})
