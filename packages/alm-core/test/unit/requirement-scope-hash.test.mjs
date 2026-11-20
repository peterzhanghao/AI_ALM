import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { requirementContentHash, requirementScopeHash } from '../../src/model/content-hash.mjs'

const dirs = []
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

function fixture(brief = '# 目标\n\n返回 42。\n\n# 验收\n\n- AC-01 src/value.cjs 导出 42。\n') {
  const root = mkdtempSync(join(tmpdir(), 'alm-scope-'))
  dirs.push(root)
  mkdirSync(join(root, 'requirements/briefs'), { recursive: true })
  writeFileSync(join(root, 'requirements/briefs/REQ-X-001.md'), brief)
  const asset = {
    id: 'REQ-X-001',
    type: 'requirement',
    title: 'Return 42',
    status: 'proposed',
    owner: 'team',
    extra: { revision: 1, priority: 'P1', brief: 'requirements/briefs/REQ-X-001.md' },
    links: [{ type: 'allocated_to', target: 'MOD-A' }],
  }
  return { root, asset }
}

test('scope hash ignores relations and delivery metadata', () => {
  const { root, asset } = fixture()
  const before = requirementScopeHash({ root, asset })
  const decorated = {
    ...asset,
    status: 'accepted',
    owner: 'another-team',
    extra: { ...asset.extra, revision: 2, priority: 'P0' },
    links: [...asset.links, { type: 'allocated_to', target: 'MOD-B' }, { type: 'verified_by', target: 'TEST-1' }],
  }
  assert.equal(requirementScopeHash({ root, asset: decorated }), before)
  // The full content hash keeps changing for evidence binding: only the
  // authorization scope is allowed to ignore metadata.
  assert.notEqual(requirementContentHash({ root, asset: decorated }), requirementContentHash({ root, asset }))
})

test('scope hash changes when the requirement body changes', () => {
  const { root, asset } = fixture()
  const before = requirementScopeHash({ root, asset })
  writeFileSync(join(root, 'requirements/briefs/REQ-X-001.md'), '# 目标\n\n返回 43。\n\n# 验收\n\n- AC-01 src/value.cjs 导出 43。\n')
  assert.notEqual(requirementScopeHash({ root, asset }), before)
})

test('scope hash covers structured acceptance even when the brief is unchanged', () => {
  const { root, asset } = fixture()
  const doc = {
    goal: '返回 42。',
    problem: '调用方拿不到结果。',
    features: [],
    acceptance: [{ id: 'AC-01', text: 'src/value.cjs 导出 42。' }],
    constraints: [],
    scope: [],
    outOfScope: [],
    pending: [],
  }
  const before = requirementScopeHash({ root, asset, doc })
  const changed = { ...doc, acceptance: [{ id: 'AC-01', text: 'src/value.cjs 导出 43。' }] }
  assert.notEqual(requirementScopeHash({ root, asset, doc: changed }), before)
})

test('scope hash normalizes line endings instead of treating them as scope', () => {
  const { root, asset } = fixture('# 目标\r\n\r\n返回 42。\r\n')
  const before = requirementScopeHash({ root, asset })
  writeFileSync(join(root, 'requirements/briefs/REQ-X-001.md'), '# 目标\n\n返回 42。\n')
  assert.equal(requirementScopeHash({ root, asset }), before)
})
