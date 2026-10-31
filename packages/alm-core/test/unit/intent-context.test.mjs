import test from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { IntentError, buildIntentContext } from '../../src/intent/index.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
const fixture = join(repoRoot, 'fixtures/order-refund')

function makeRepo(t) {
  const root = mkdtempSync(join(tmpdir(), 'alm-intent-context-'))
  cpSync(fixture, root, { recursive: true })
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

const REFUND_TEXT =
  '同一笔退款在重试或并发提交时会产生多条退款单，对账困难；希望同一订单 + 同一幂等键只产生一张退款单，重复请求返回首次结果。'

test('上下文：命中标题/简报/验收关键词并给出可核对 reason', (t) => {
  const root = makeRepo(t)
  const context = buildIntentContext({ root, intentText: REFUND_TEXT, limit: 8 })
  assert.equal(context.queryStatus, 'success')
  assert.equal(context.projectId, 'PAY')
  assert.match(context.contextSnapshotId, /^ctx-[0-9a-f]{16}$/)
  assert.ok(context.readSet.length >= 1)
  const entry = context.readSet.find((item) => item.uid === 'REQ-PAY-004')
  assert.ok(entry, '应命中 REQ-PAY-004')
  assert.equal(entry.revision, 2)
  assert.match(entry.contentHash, /^[0-9a-f]{64}$/)
  assert.ok(['covered', 'related', 'conflict', 'uncertain'].includes(entry.match))
  assert.ok(entry.reasons.length > 0, '必须给出命中理由')
  assert.ok(entry.reasons.some((reason) => /标题|简报|验收|短语|业务/.test(reason)))
  assert.ok(Array.isArray(entry.acceptance))
  assert.ok(entry.acceptance.includes('同键重放返回同一 refundId 且不新增退款记录'))
  assert.match(context.boundary.statement, /已核对项目 PAY 内 \d+ 条需求/)
  assert.equal(context.query.total, 2)
  assert.equal(context.query.truncated, false)
})

test('上下文：limit 截断要有标记且 readSet 不超过 limit', (t) => {
  const root = makeRepo(t)
  const context = buildIntentContext({ root, intentText: '部分退款 幂等 退款单 重复提交', limit: 1 })
  assert.equal(context.queryStatus, 'success')
  assert.equal(context.readSet.length, 1)
  assert.equal(context.boundary.limit, 1)
  assert.equal(context.query.truncated, true)
  assert.match(context.boundary.statement, /已截断/)
})

test('上下文：未命中时不得暗示“全新/无重复”', (t) => {
  const root = makeRepo(t)
  const context = buildIntentContext({ root, intentText: '把登录页的按钮改成蓝色', limit: 8 })
  assert.equal(context.queryStatus, 'success')
  assert.equal(context.readSet.length, 0)
  assert.equal(context.query.matched, 0)
  assert.match(context.boundary.statement, /命中 0 条/)
  assert.doesNotMatch(context.boundary.statement, /全新|无重复/)
  assert.match(context.boundary.caution, /不等同于需求已确认或冲突已排除/)
})

test('上下文：检索失败时必须明确“相关需求尚未核对”', (t) => {
  const root = makeRepo(t)
  const context = buildIntentContext({
    root,
    intentText: REFUND_TEXT,
    reader: { ok: false, status: 'error', error: { code: 'index-unavailable', message: '索引服务超时' } },
  })
  assert.equal(context.queryStatus, 'error')
  assert.equal(context.readSet.length, 0)
  assert.equal(context.query.failure.code, 'index-unavailable')
  assert.match(context.boundary.statement, /相关需求尚未核对/)
  assert.match(context.boundary.caution, /不能用于声称“全新\/无重复”/)
})

test('上下文：reader 直接抛出也要转成诚实的 error 状态而不是假成功', (t) => {
  const root = makeRepo(t)
  const explode = () => {
    throw new Error('boom')
  }
  const context = buildIntentContext({ root, intentText: REFUND_TEXT, reader: explode })
  assert.equal(context.queryStatus, 'error')
  assert.equal(context.query.matched, 0)
  assert.match(context.boundary.statement, /相关需求尚未核对/)
})

test('上下文：未提供意图文本时 queryStatus=not-queried', (t) => {
  const root = makeRepo(t)
  const context = buildIntentContext({ root, intentText: '   ', limit: 8 })
  assert.equal(context.queryStatus, 'not-queried')
  assert.equal(context.readSet.length, 0)
  assert.match(context.boundary.statement, /尚未提供意图文本/)
})

test('上下文：selectedRequirementId 作为锚点；未知锚点 404', (t) => {
  const root = makeRepo(t)
  const context = buildIntentContext({
    root,
    intentText: REFUND_TEXT,
    selectedRequirementId: 'REQ-PAY-004',
  })
  assert.ok(context.selected)
  assert.equal(context.selected.uid, 'REQ-PAY-004')
  assert.equal(context.readSet[0].uid, 'REQ-PAY-004')
  assert.equal(context.readSet[0].match, 'covered')
  assert.ok(context.readSet[0].reasons.some((reason) => reason.includes('明确指定')))

  assert.throws(
    () => buildIntentContext({ root, intentText: REFUND_TEXT, selectedRequirementId: 'REQ-PAY-999' }),
    (error) => error instanceof IntentError && error.code === 'unknown-requirement' && error.status === 404,
  )
})

test('上下文：同样的输入与相同已核对集合产生同样的 contextSnapshotId，集合变化则不同', (t) => {
  const root = makeRepo(t)
  const first = buildIntentContext({ root, intentText: REFUND_TEXT, limit: 8 })
  const second = buildIntentContext({ root, intentText: REFUND_TEXT, limit: 8 })
  assert.equal(first.contextSnapshotId, second.contextSnapshotId)
  const narrowed = buildIntentContext({ root, intentText: REFUND_TEXT, limit: 1 })
  assert.notEqual(narrowed.contextSnapshotId, first.contextSnapshotId)
})
