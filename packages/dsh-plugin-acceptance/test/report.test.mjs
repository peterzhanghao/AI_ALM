import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { REPORT_SCHEMA, renderReport } from '../engine/report.mjs'
import { TINY_PNG, cleanup, makeWorkspace } from './helpers.mjs'

const dirs = []
after(() => cleanup(dirs))

function fixture({ withEvidence = true, dirty = false } = {}) {
  const dir = makeWorkspace('alm-report-')
  dirs.push(dir)
  mkdirSync(join(dir, 'evidence'), { recursive: true })
  if (withEvidence) {
    writeFileSync(join(dir, 'evidence', 'rows-page.png'), TINY_PNG)
    writeFileSync(
      join(dir, 'evidence', 'rows-dom.dom.json'),
      JSON.stringify({ schema: 'alm.plugin-acceptance.dom/v1', url: 'http://127.0.0.1/x', title: 'Demo', text: 'DQ-1\nDQ-2' }),
      'utf8',
    )
  }
  const round = {
    schema: 'alm.plugin-acceptance/v1',
    roundId: '001',
    roundIndex: 1,
    acceptanceId: '11111111-2222-3333-4444-555555555555',
    plugin: '@ai-alm/demo',
    requirement: 'REQ-DEMO-001',
    level: 'L1',
    verdict: 'fail',
    stats: { pass: 1, fail: 1, blocked: 0 },
    finishedAt: '2026-11-02T10:00:00.000Z',
    subject: {
      root: dir,
      git: { available: true, headSha: 'abcdef0123456789abcdef0123456789abcdef01', branch: 'develop', dirty, statusDigest: dirty ? 'x' : null },
      files: [{ path: 'packages/demo/index.js', sha256: 'f'.repeat(64), bytes: 120, mtimeMs: 1 }],
      environment: { schema: 'alm.plugin-acceptance.environment/v1', node: 'v22.0.0', platform: 'win32', arch: 'x64', playwright: '1.64.1', browser: 'chrome 141' },
    },
    cases: [
      {
        id: 'rows',
        title: '表格渲染 <script>alert(1)</script>',
        expected: '两行',
        level: 'L1',
        surface: 'web',
        status: 'fail',
        observation: '只看到一行',
        repro: ['pnpm acceptance run --id rows'],
        durationMs: 812,
        steps: [
          { index: 0, action: 'goto', ok: true, detail: '/' },
          { index: 1, action: 'expectCount', ok: false, detail: '期望 2 行，实际 1 行' },
        ],
        evidence: [
          { path: 'evidence/rows-page.png', kind: 'screenshot', description: '失败时页面截图' },
          { path: 'evidence/rows-dom.dom.json', kind: 'dom_snapshot', description: '失败时 DOM 快照' },
        ],
      },
      { id: 'dom', title: 'DOM', expected: 'Tracking gaps', status: 'pass', observation: 'ok', evidence: [] },
    ],
  }
  return { dir, round }
}

test('report is a self-contained document that cannot load anything remote', () => {
  const { dir, round } = fixture()
  const html = renderReport({ round, dir })

  assert.ok(html.startsWith('<!doctype html>'))
  assert.match(html, /Content-Security-Policy/)
  assert.match(html, /default-src 'none'/)
  assert.ok(!/\ssrc="https?:/i.test(html), 'report must not reference remote assets')
  assert.ok(!/<script[^>]+\ssrc=/i.test(html), 'report must not load external scripts')
  assert.ok(!/@import|url\(https?:/i.test(html), 'styles must be inline only')
})

test('screenshots are inlined and dom snapshots are readable', () => {
  const { dir, round } = fixture()
  const html = renderReport({ round, dir })
  assert.ok(html.includes(`data:image/png;base64,${TINY_PNG.toString('base64')}`))
  assert.match(html, /<details><summary>DOM 快照/)
  assert.ok(html.includes('DQ-1'))
})

test('missing evidence is surfaced, never silently dropped', () => {
  const { dir, round } = fixture({ withEvidence: false })
  const html = renderReport({ round, dir })
  assert.ok(html.includes('证据文件缺失：evidence/rows-page.png'))
  assert.ok(html.includes('DOM 快照无法读取：evidence/rows-dom.dom.json'))
})

test('the reviewer can decide every check and export a reviews file', () => {
  const { dir, round } = fixture()
  const html = renderReport({ round, dir })

  assert.match(html, /data-action="accept" data-check="rows"/)
  assert.match(html, /data-action="reject" data-check="rows"/)
  assert.match(html, /data-comment="rows"/)
  assert.match(html, /id="save-reviews"/)
  assert.match(html, /acceptance-reviews-' \+ payload\.acceptanceId \+ '\.json/)

  const payload = html.match(/<script type="application\/json" id="acceptance-payload">([\s\S]*?)<\/script>/)[1]
  const parsed = JSON.parse(payload)
  assert.equal(parsed.schema, REPORT_SCHEMA)
  assert.equal(parsed.acceptanceId, round.acceptanceId)
  assert.deepEqual(parsed.cases.map((entry) => entry.id), ['rows', 'dom'])
})

test('html in check titles is escaped', () => {
  const { dir, round } = fixture()
  const html = renderReport({ round, dir })
  assert.ok(html.includes('表格渲染 &lt;script&gt;alert(1)&lt;/script&gt;'))
  assert.ok(!html.includes('alert(1)</script>'))
})

test('dirty workspace, drift and evidence-less checks are called out', () => {
  const { dir, round } = fixture({ dirty: true })
  const clean = renderReport({ round, dir })
  assert.ok(clean.includes('工作区有未提交改动'))
  assert.ok(clean.includes('存在无证据的检查项'))

  const drifted = renderReport({ round, dir, drift: ['packages/demo/index.js sha256 changed'] })
  assert.ok(drifted.includes('证据与当前代码不一致'))
  assert.ok(drifted.includes('packages/demo/index.js sha256 changed'))
})

test('an existing review marks the check as decided', () => {
  const { dir, round } = fixture()
  const reviews = {
    schema: 'alm.plugin-acceptance.reviews/v1',
    acceptanceId: round.acceptanceId,
    format: 1,
    events: [{ id: 'e1', kind: 'check', checkId: 'rows', action: 'reject', comment: '截图里只有一行', createdAt: '2026-11-02T10:05:00.000Z' }],
  }
  const html = renderReport({ round, reviews, dir })
  assert.ok(html.includes('已标记打回'))
  assert.ok(html.includes('截图里只有一行'))
})
