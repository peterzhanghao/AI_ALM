import test from 'node:test'
import assert from 'node:assert/strict'
import { AssetError } from '../../../src/model/asset.mjs'
import { parseMarkdownAsset } from '../../../src/parse/markdown.mjs'

const ADR = `---
schema_version: 1
id: ADR-PAY-003
type: architecture-decision
title: 退款与订单状态一致性
status: accepted
owner: team-arch
links:
  - type: supersedes
    target: ADR-PAY-002
---

# Context

退款必须与订单状态在同一事务边界内完成。
`

test('parses Markdown frontmatter into an asset', () => {
  const asset = parseMarkdownAsset(ADR, 'adr/ADR-PAY-003.md')
  assert.equal(asset.id, 'ADR-PAY-003')
  assert.equal(asset.type, 'architecture-decision')
  assert.equal(asset.source.format, 'markdown')
  assert.equal(asset.source.line, 12)
  assert.deepEqual(asset.links, [{ type: 'supersedes', target: 'ADR-PAY-002', line: 10 }])
})

test('missing frontmatter fails with FMT-001', () => {
  assert.throws(() => parseMarkdownAsset('# no frontmatter\n', 'adr/bad.md'), (error) => {
    assert.ok(error instanceof AssetError)
    assert.equal(error.rule, 'FMT-001')
    assert.match(error.message, /frontmatter/)
    return true
  })
})
