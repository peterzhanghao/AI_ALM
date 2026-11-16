import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  BRIEF_BUDGET,
  BriefRejected,
  MAX_ANCHORS,
  compileTurnBrief,
  extractIntent,
  previewTurnBrief,
  readBriefText,
} from '../../src/requirements/turn-brief.mjs'

const REGISTRY = `schema_version: 1
id: MOD-SHOP
type: module
title: 购物车
role: 购物车模块
paths:
  - packages/shop/
entries:
  - packages/shop/cart.js
  - packages/shop/index.js
tests:
  - packages/shop/test/cart.test.mjs
`

function fixture({ brief = null, requirementId = 'REQ-SHOP-001' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'alm-brief-'))
  mkdirSync(join(root, 'architecture'), { recursive: true })
  writeFileSync(join(root, 'architecture', 'MOD-SHOP.yml'), REGISTRY)
  if (brief != null) {
    mkdirSync(join(root, 'requirements', 'briefs'), { recursive: true })
    writeFileSync(join(root, 'requirements', 'briefs', `${requirementId}.md`), brief)
  }
  return { root, requirementId }
}

const asset = {
  id: 'REQ-SHOP-001',
  title: '购物车合并行',
  links: [{ type: 'allocated_to', target: 'MOD-SHOP' }],
}

const GOOD_BRIEF = `# 购物车合并行

目标：同一商品重复加入购物车时合并数量，而不是新增一行。

验收标准：
- AC-01 重复加入同一 SKU 时行数不变，数量累加
- AC-02 不同 SKU 仍然各占一行

约束：不改变既有购物车接口，不新增依赖。
`

test('L0 refuses a requirement without a goal or acceptance criteria', () => {
  const { root, requirementId } = fixture({ brief: '# 购物车合并行\n\n随手记一下。\n', requirementId: 'REQ-SHOP-001' })
  assert.throws(
    () => compileTurnBrief({ root, requirementId, asset, item: { id: requirementId, title: '购物车合并行' } }),
    (error) => {
      assert.equal(error instanceof BriefRejected, true)
      assert.equal(error.code, 'brief-insufficient')
      assert.deepEqual(error.detail, ['目标', '验收标准'])
      assert.match(error.message, /不能派发/)
      return true
    },
  )
})

test('a degraded brief states the gap instead of inventing content', () => {
  const { root, requirementId } = fixture({ brief: '# 购物车合并行\n', requirementId: 'REQ-SHOP-001' })
  const compiled = compileTurnBrief({
    root,
    requirementId,
    asset,
    item: { id: requirementId, title: '购物车合并行' },
    runId: 'RUN-9',
    degraded: true,
  })
  assert.equal(compiled.meta.degraded, true)
  assert.deepEqual(compiled.meta.missing, ['目标', '验收标准'])
  assert.match(compiled.text, /尚未登记目标与验收标准/)
  assert.match(compiled.text, /RUN-9-decision\.md/)
})

test('preview reports the rejection instead of throwing', () => {
  const { root, requirementId } = fixture({ brief: '# 空\n', requirementId: 'REQ-SHOP-001' })
  const preview = previewTurnBrief({ root, requirementId, asset, item: { id: requirementId } })
  assert.equal(preview.ok, false)
  assert.equal(preview.code, 'brief-insufficient')
  assert.equal(preview.text, null)
})

test('a good brief compiles into a short instruction, not a file dump', () => {
  const { root, requirementId } = fixture({ brief: GOOD_BRIEF })
  const compiled = compileTurnBrief({
    root,
    requirementId,
    asset,
    item: { id: requirementId, title: '购物车合并行' },
    commands: ['node --test packages/shop/test/cart.test.mjs'],
  })
  assert.equal(compiled.schema, 'alm.turn-brief/v1')
  assert.ok(compiled.text.length <= BRIEF_BUDGET, `brief 必须受 ${BRIEF_BUDGET} 字符预算约束，实际 ${compiled.text.length}`)
  assert.match(compiled.text, /^# REQ-SHOP-001 — 购物车合并行/)
  assert.match(compiled.text, /目标：同一商品重复加入购物车时合并数量/)
  assert.match(compiled.text, /AC-01/)
  assert.match(compiled.text, /AC-02/)
  assert.match(compiled.text, /约束：不改变既有购物车接口/)
  assert.match(compiled.text, /验证：完成后运行 pnpm -s alm verify REQ-SHOP-001 自查/)
  assert.match(compiled.text, /不要跑全量测试/)
  assert.equal(compiled.meta.goalSource, 'brief')
  assert.equal(compiled.meta.acceptanceSource, 'brief')
})

test('anchors stay at three and always include a focused test', () => {
  const { root, requirementId } = fixture({ brief: GOOD_BRIEF })
  const compiled = compileTurnBrief({
    root,
    requirementId,
    asset,
    item: { id: requirementId, title: '购物车合并行' },
    commands: ['node --test packages/shop/test/cart.test.mjs'],
    handoff: { changedFiles: ['packages/shop/a.js', 'packages/shop/b.js', 'packages/shop/c.js', 'packages/shop/d.js'] },
  })
  assert.equal(compiled.meta.anchors.length, MAX_ANCHORS)
  assert.ok(compiled.meta.anchors.includes('packages/shop/test/cart.test.mjs'), '定向测试必须占一个锚点席位')
  assert.match(compiled.text, /先读这些文件：/)
})

test('the verification line is a fixed alias, immune to how many tests a module owns', () => {
  const compile = (testCount) => {
    const { root, requirementId } = fixture({ brief: GOOD_BRIEF })
    const tests = Array.from({ length: testCount }, (_, i) => `  - packages/shop/test/t${i}.test.mjs`).join('\n')
    writeFileSync(
      join(root, 'architecture', 'MOD-SHOP.yml'),
      REGISTRY.replace('tests:\n  - packages/shop/test/cart.test.mjs\n', `tests:\n${tests}\n`),
    )
    return compileTurnBrief({
      root,
      requirementId,
      asset,
      item: { id: requirementId, title: '购物车合并行' },
      commands: [],
    })
  }
  const one = compile(1)
  const many = compile(13)
  // The whole point of the alias: the instruction describes a capability, not
  // the file list behind it. 1 test and 13 tests must cost the same.
  assert.equal(one.text.length, many.text.length, `验证段不得随模块测试数量变化（1 条 ${one.text.length}，13 条 ${many.text.length}）`)
  const line = one.text.split('\n').find((row) => row.startsWith('验证：'))
  assert.match(line, /pnpm -s alm verify REQ-SHOP-001/)
  assert.match(line, /不要展开文件清单/)
  assert.doesNotMatch(many.text, /t12\.test\.mjs/, '文件清单不得进入正文')
  assert.ok(many.meta.commands.length > 0, '完整命令必须保留在 meta 里，白盒和排查都要读它')
  assert.equal(one.meta.verificationSource, 'module-tests')
})

test('a registered acceptance command is referenced by alias, never inlined', () => {
  const { root, requirementId } = fixture({ brief: GOOD_BRIEF })
  const compiled = compileTurnBrief({
    root,
    requirementId,
    asset,
    item: { id: requirementId, title: '购物车合并行' },
    commands: [{ id: 'ac-1', command: ['node', '--test', 'packages/shop/test/cart.test.mjs'] }],
  })
  assert.match(compiled.text, /pnpm -s alm verify REQ-SHOP-001/)
  assert.doesNotMatch(compiled.text, /node --test/, '登记命令只进 meta，不进正文')
  assert.equal(compiled.meta.commands.length, 1)
  assert.equal(compiled.meta.verificationSource, 'registered')
})

test('the budget is a gate: a bloated acceptance list is compressed, not dispatched', () => {
  const { root, requirementId } = fixture({ brief: GOOD_BRIEF })
  const bulked = Array.from({ length: 8 }, (_, index) => `- AC-${String(index + 1).padStart(2, '0')} ${'验收细节描述'.repeat(20)}`).join('\n')
  const compiled = compileTurnBrief({
    root,
    requirementId,
    asset,
    item: {
      id: requirementId,
      title: '购物车合并行',
      briefText: `目标：同一商品重复加入购物车时合并数量。\n\n验收标准：\n${bulked}\n\n## 背景\n${'历史细节。'.repeat(5000)}\n`,
    },
    commands: ['node --test packages/shop/test/cart.test.mjs'],
  })
  assert.ok(compiled.text.length <= BRIEF_BUDGET, `实际 ${compiled.text.length}`)
  assert.ok(compiled.meta.trimmed.length > 0, '压缩必须留下痕迹，方便排查丢掉了什么')
  // Pasted history is never part of the contract.
  assert.doesNotMatch(compiled.text, /历史细节/)
})

test('the plan phase forbids code and asks for three bullets', () => {
  const { root, requirementId } = fixture({ brief: GOOD_BRIEF })
  const plan = compileTurnBrief({
    root,
    requirementId,
    asset,
    item: { id: requirementId, title: '购物车合并行' },
    commands: ['node --test packages/shop/test/cart.test.mjs'],
    phase: 'plan',
  })
  assert.equal(plan.meta.phase, 'plan')
  assert.match(plan.text, /本轮只做方案，不写代码、不改文件、不跑测试/)
  assert.match(plan.text, /完成标志：给出上述三条方案后停止/)
  assert.doesNotMatch(plan.text, /当前进度：从零开始/)
  assert.ok(plan.text.length <= BRIEF_BUDGET)
})

test('a human override is passed through verbatim', () => {
  const { root, requirementId } = fixture({ brief: GOOD_BRIEF })
  const compiled = compileTurnBrief({ root, requirementId, asset, item: { id: requirementId }, override: '  只改 cart.js 的合并逻辑  ' })
  assert.equal(compiled.text, '只改 cart.js 的合并逻辑')
  assert.equal(compiled.meta.override, true)
})

test('intent extraction accepts both inline and section shapes', () => {
  const inline = extractIntent({ briefText: '目标：合并行\n验收：AC-01 数量累加\n' })
  assert.equal(inline.goal, '合并行')
  assert.equal(inline.acceptance.length, 1)
  assert.equal(inline.acceptance[0].id, 'AC-01')

  const section = extractIntent({ briefText: '## 目标\n同一商品合并数量。\n\n## 验收标准\n- 行数不变\n' })
  assert.equal(section.goal, '同一商品合并数量。')
  assert.equal(section.acceptance.length, 1)
  assert.equal(section.acceptance[0].text, '行数不变')
})

test('the structured document wins over prose when both exist', () => {
  const intent = extractIntent({
    briefText: '目标：散文里的目标\n验收：散文里的验收\n',
    doc: {
      goal: '结构化目标',
      acceptance: [{ id: 'AC-07', text: '结构化验收' }],
    },
  })
  assert.equal(intent.goal, '散文里的目标')
  assert.equal(intent.goalSource, 'brief')
  assert.equal(intent.acceptance.length, 1)
  assert.equal(intent.acceptance[0].id, 'AC-07')
  assert.equal(intent.acceptanceSource, 'doc')
})

test('the brief is read from the conventional path when nothing points at it', () => {
  const { root, requirementId } = fixture({ brief: GOOD_BRIEF })
  assert.match(readBriefText({ root, requirementId }), /购物车合并行/)
  assert.equal(readBriefText({ root, requirementId: 'REQ-MISSING' }), '')
})
