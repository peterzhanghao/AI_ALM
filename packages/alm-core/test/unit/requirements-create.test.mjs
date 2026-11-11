import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  assert.doesNotMatch(plan.content, /^STATUS:/m)
  assert.match(plan.briefContent, /## 问题与场景/)
  assert.match(plan.briefContent, /每天对账退款状态/)
  assert.match(plan.briefContent, /<!-- alm:meta /)
  assert.doesNotMatch(plan.briefContent, /## 背景/)
  assert.ok(!existsSync(join(root, plan.file)))
})

test('long raw title becomes a concise title and preserves the full original words', () => {
  const root = makeRepo()
  const original = '需求列表第一列直接展示用户长篇口语原话导致排版臃肿，需要自动提炼为简明短标题并保留原话。'
  const plan = planRequirement({ root, title: original })
  assert.ok(plan.title.length <= 29)
  assert.notEqual(plan.title, original)
  assert.match(plan.content, new RegExp(`TITLE: ${plan.title}`))
  assert.match(plan.briefContent, /## 用户原话/)
  assert.match(plan.briefContent, new RegExp(original))
})

test('manual title is not shortened during creation', () => {
  const root = makeRepo()
  const manualTitle = '这是用户明确确认且即使超过二十八个字符也必须完整保留的需求标题'
  const plan = planRequirement({ root, title: manualTitle, titleWasManuallyEdited: true })
  assert.equal(plan.title, manualTitle)
})

test('automatic ids skip orphan brief, attachment directory and unindexed sdoc without changing them', () => {
  const root = makeRepo()
  const occupied = [
    ['requirements/briefs/REQ-PAY-005.md', 'orphan brief\r\n用户原文'],
    ['requirements/attachments/REQ-PAY-006/manifest.json', '{"original":true}\n'],
    ['requirements/req-pay-007.sdoc', 'orphan, not an indexed requirement\n'],
  ]
  for (const [path, content] of occupied) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  const before = occupied.map(([path]) => readFileSync(join(root, path)))
  assert.equal(nextRequirementId({ root, projectId: 'PAY' }), 'REQ-PAY-008')
  const plan = planRequirement({ root, title: '安全跳号' })
  assert.equal(plan.requirementId, 'REQ-PAY-008')
  assert.equal(existsSync(join(root, plan.file)), false, 'planning must not write')
  const created = createRequirement({ root, title: '安全跳号', apply: true })
  assert.equal(created.requirementId, 'REQ-PAY-008')
  occupied.forEach(([path], index) => assert.deepEqual(readFileSync(join(root, path)), before[index]))
})

test('explicit ids reject every occupied target and indexed noncanonical ids without writes', () => {
  for (const path of [
    'requirements/briefs/REQ-PAY-005.md',
    'requirements/req-pay-005.sdoc',
    'requirements/attachments/REQ-PAY-005',
  ]) {
    const root = makeRepo()
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), 'keep original bytes\r\n')
    const before = readFileSync(join(root, path))
    assert.throws(
      () => createRequirement({ root, title: '禁止覆盖', id: 'REQ-PAY-005', apply: true }),
      (error) => error.code === 'already-exists' && error.status === 409,
    )
    assert.deepEqual(readFileSync(join(root, path)), before)
    assert.equal(existsSync(join(root, 'requirements/req-pay-006.sdoc')), false)
  }
  const root = makeRepo()
  const original = join(root, 'requirements/refund-idempotent.sdoc')
  const before = readFileSync(original)
  assert.throws(
    () => createRequirement({ root, title: '禁止复用索引UID', id: 'REQ-PAY-004', apply: true }),
    (error) => error.code === 'already-exists' && error.status === 409,
  )
  assert.deepEqual(readFileSync(original), before)
  assert.equal(existsSync(join(root, 'requirements/req-pay-004.sdoc')), false)
})

test('automatic ids treat even an empty orphan attachment directory as occupied', () => {
  const root = makeRepo()
  mkdirSync(join(root, 'requirements/attachments/REQ-PAY-005'), { recursive: true })
  assert.equal(planRequirement({ root, title: '无附件也跳号' }).requirementId, 'REQ-PAY-006')
  assert.throws(
    () => createRequirement({ root, title: '无附件也拒绝', id: 'REQ-PAY-005', apply: true }),
    (error) => error.code === 'already-exists' && error.status === 409,
  )
  assert.equal(existsSync(join(root, 'requirements/attachments/REQ-PAY-005')), true)
  assert.equal(existsSync(join(root, 'requirements/req-pay-005.sdoc')), false)
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
  assert.equal(asset.status, null)
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

test('createRequirement writes attachments and manifest with sha256', () => {
  const root = makeRepo()
  const result = createRequirement({
    root,
    title: '带附件的需求',
    brief: '背景来自聊天与截图',
    attachments: [
      { name: 'chat.md', kind: 'chat', text: '10:12 张三：退款要幂等' },
      { name: 'shot.png', kind: 'screenshot', dataBase64: Buffer.from('fake-png').toString('base64') },
    ],
    apply: true,
  })
  assert.equal(result.attachments.length, 2)
  assert.ok(existsSync(join(root, 'requirements/attachments/REQ-PAY-005/chat.md')))
  assert.ok(existsSync(join(root, 'requirements/attachments/REQ-PAY-005/shot.png')))
  const manifest = JSON.parse(readFileSync(join(root, 'requirements/attachments/REQ-PAY-005/manifest.json'), 'utf8'))
  assert.equal(manifest.files.length, 2)
  assert.ok(manifest.files.every((file) => /^[0-9a-f]{64}$/.test(file.sha256)))
  const index = indexReport(root)
  assert.ok(index.assets.some((asset) => asset.id === 'REQ-PAY-005'))
})

test('createRequirement rejects unsafe attachment names', () => {
  const root = makeRepo()
  assert.throws(
    () =>
      createRequirement({
        root,
        title: '坏附件',
        attachments: [{ name: '../escape.md', kind: 'chat', text: 'x' }],
        apply: true,
      }),
    (error) => error.code === 'invalid-attachment',
  )
  assert.ok(!existsSync(join(root, 'requirements/req-pay-005.sdoc')))
})

test('createRequirement rejects sdoc injection through title and owner', () => {
  const root = makeRepo()
  const payload = 'X\n\n[RELATION]\nType: verified_by\nValue: TEST-PAY-999'
  assert.throws(
    () => planRequirement({ root, title: payload }),
    (error) => error.code === 'invalid-title',
  )
  assert.throws(
    () => planRequirement({ root, title: '正常标题', owner: 'team\n[RELATION]' }),
    (error) => error.code === 'invalid-owner',
  )
  assert.ok(!existsSync(join(root, 'requirements/req-pay-005.sdoc')))
})

test('planRequirement defaults SOURCE to chat and writes no 缺陷来源 section', () => {
  const root = makeRepo()
  const plan = planRequirement({ root, title: '默认来源', brief: '来自聊天' })
  assert.equal(plan.source, 'chat')
  assert.match(plan.content, /^SOURCE: chat$/m)
  assert.doesNotMatch(plan.content, /SOURCE: defect/)
  assert.doesNotMatch(plan.briefContent, /## 缺陷来源/)
})

test('planRequirement carries a defect source into the sdoc and brief', () => {
  const root = makeRepo()
  const plan = planRequirement({ root, title: '缺陷需求', brief: '### 问题描述\n\n退款状态错误', source: 'defect' })
  assert.equal(plan.source, 'defect')
  assert.match(plan.content, /^SOURCE: defect$/m)
  assert.doesNotMatch(plan.content, /SOURCE: chat/)
  assert.match(plan.briefContent, /## 缺陷来源/)
  assert.match(plan.briefContent, /失败监控/)

  const written = createRequirement({ root, title: '缺陷需求', brief: '背景', source: 'defect', apply: true })
  assert.equal(written.source, 'defect')
  assert.match(readFileSync(join(root, 'requirements/req-pay-005.sdoc'), 'utf8'), /^SOURCE: defect$/m)
  assert.match(readFileSync(join(root, 'requirements/briefs/REQ-PAY-005.md'), 'utf8'), /## 缺陷来源/)
})

test('planRequirement rejects an unsafe source value', () => {
  const root = makeRepo()
  assert.throws(
    () => planRequirement({ root, title: '坏来源', source: 'defect\n[RELATION]' }),
    (error) => error.code === 'invalid-source',
  )
  assert.throws(
    () => planRequirement({ root, title: '坏来源', source: 'x'.repeat(41) }),
    (error) => error.code === 'source-too-long',
  )
})
