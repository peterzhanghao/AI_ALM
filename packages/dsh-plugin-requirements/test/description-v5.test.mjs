import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { createRun, runView, updateRun } from '../../alm-core/src/requirements/run.mjs'
import { docHashOf } from '../../alm-core/src/requirements/doc.mjs'
import RequirementsService, { buildExecutionPrompt } from '../index.js'
import { requirements } from '../query.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const fixture = join(repoRoot, 'fixtures/order-refund')
const DESCRIPTION_ROUTE = '/api/alm/requirements/description'

const CANONICAL_BRIEF = [
  '# REQ-PAY-004 退款幂等',
  '',
  '## 目标',
  '',
  '同一订单与幂等键只产生一张退款单。',
  '',
  '## 问题与场景',
  '',
  '客服和财务在重试退款时看到重复退款单。',
  '',
  '## 详细功能',
  '',
  '### FR-01 幂等退款',
  '',
  '- 行为：重复请求返回首次结果。',
  '- 前置：订单存在且可退款。',
  '- 响应：返回原退款单。',
  '- 边界：幂等键 7 天内有效。',
  '- 来源：2026-10-28 支付周会。',
  '',
  '## 本次范围',
  '',
  '- 退款单创建接口。',
  '',
  '## 不包含',
  '',
  '- 退款审批流改造。',
  '',
  '## 验收要求',
  '',
  '- AC-01（FR-01）同一幂等键两次退款只生成一张退款单。',
  '',
  '- 判定：退款单数量为 1。',
  '',
  '## 必要约束',
  '',
  '- 金额校验与余额扣减在同一事务内完成。',
  '',
  '## 待确认',
  '',
  '- [ ] Q-01 幂等键是否由财务系统生成？',
  '',
  '<!-- alm:meta {"nextFr":2,"nextAc":2,"confirmedAt":"2026-01-01T00:00:00.000Z","docHash":"sha256:x"} -->',
].join('\n')

function tempFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'alm-desc-v5-'))
  cpSync(fixture, dir, { recursive: true })
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['add', '-A'], { cwd: dir })
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'init'], {
    cwd: dir,
  })
  return dir
}

function itemOf(payload, id) {
  return (payload.requirements ?? []).find((entry) => entry.id === id) ?? null
}

function writeBrief(root, item, text) {
  writeFileSync(join(root, item.brief), text)
}

/** Boot the plugin route against `root`, reusing the plugin test ctx stub. */
async function withServer(root, run) {
  const routes = new Map()
  const ctx = {
    effect(callback) {
      callback()
    },
    get: () => undefined,
    webServer: {
      register(route) {
        routes.set(route.path, route.handler)
        return () => routes.delete(route.path)
      },
    },
    tools: { register: () => () => {} },
  }
  new RequirementsService(ctx, { root })
  const server = createServer((req, res) => {
    const handler = routes.get(new URL(req.url, 'http://127.0.0.1').pathname)
    if (!handler) {
      res.writeHead(404).end('not found')
      return
    }
    handler(req, res)
  })
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
  const base = `http://127.0.0.1:${server.address().port}`
  const url = `${base}${DESCRIPTION_ROUTE}?root=${encodeURIComponent(root)}`
  const post = async (body) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return { status: response.status, payload: await response.json() }
  }
  const get = async () => {
    const response = await fetch(url)
    return { status: response.status, payload: await response.json() }
  }
  try {
    await run({ post, get })
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose))
  }
}

test('query keeps the full brief and adds bytes, excerpt and doc view', () => {
  const dir = tempFixture()
  try {
    const base = itemOf(requirements(dir), 'REQ-PAY-004')
    const body = `# REQ-PAY-004 退款幂等\n\n## 目标\n\n${'长文本内容。'.repeat(2200)}\n\nTAIL-MARKER-END`
    assert.ok(body.length > 12000, 'the fixture body must exceed the old 8000-char cap')
    writeBrief(dir, base, body)

    const item = itemOf(requirements(dir), 'REQ-PAY-004')
    assert.equal(item.briefText, body)
    assert.ok(item.briefText.startsWith('# REQ-PAY-004'))
    assert.ok(item.briefText.endsWith('TAIL-MARKER-END'))
    assert.equal(item.briefBytes, Buffer.byteLength(body, 'utf8'))
    assert.ok(Array.from(item.briefExcerpt).length <= 240)
    assert.ok(!item.briefExcerpt.includes('\n'), 'the excerpt must be a single line')
    assert.equal(item.docMeta.docHash, docHashOf(body))
    assert.equal(item.docMeta.source, item.docView.legacy === true ? 'legacy' : 'canonical')
    assert.equal(typeof item.docView.doc, 'object')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('query docMeta marks the legacy fixture brief and exposes the parsed doc', () => {
  const dir = tempFixture()
  try {
    const item = itemOf(requirements(dir), 'REQ-PAY-004')
    assert.ok(item.briefText.includes('## 背景'))
    assert.equal(item.docView.legacy, true)
    assert.equal(item.docMeta.source, 'legacy')
    assert.equal(item.docMeta.revision, item.revision)
    assert.equal(item.docMeta.confirmedAt, null)
    assert.equal(item.docMeta.docHash, docHashOf(item.briefText))
    assert.equal(typeof item.docView.doc, 'object')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('query docMeta marks a canonical brief with confirmedAt', () => {
  const dir = tempFixture()
  try {
    const base = itemOf(requirements(dir), 'REQ-PAY-004')
    writeBrief(dir, base, CANONICAL_BRIEF)

    const item = itemOf(requirements(dir), 'REQ-PAY-004')
    assert.equal(item.docView.legacy, false)
    assert.equal(item.docMeta.source, 'canonical')
    assert.equal(item.docMeta.docHash, docHashOf(CANONICAL_BRIEF))
    assert.equal(item.docMeta.confirmedAt, '2026-01-01T00:00:00.000Z')
    assert.equal(item.docMeta.revision, item.revision)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('detail view exposes canonical doc content', () => {
  const dir = tempFixture()
  try {
    const base = itemOf(requirements(dir), 'REQ-PAY-004')
    writeBrief(dir, base, CANONICAL_BRIEF)

    const item = itemOf(requirements(dir), 'REQ-PAY-004')
    const doc = item.detailView.content.doc
    assert.equal(doc.status, 'canonical')
    assert.equal(doc.goal, '同一订单与幂等键只产生一张退款单。')
    assert.equal(doc.problem, '客服和财务在重试退款时看到重复退款单。')
    assert.deepEqual(doc.scope, ['退款单创建接口。'])
    assert.equal(doc.features.length, 1)
    assert.equal(doc.features[0].id, 'FR-01')
    assert.equal(doc.features[0].title, '幂等退款')
    assert.equal(doc.acceptance.length, 1)
    assert.equal(doc.acceptance[0].id, 'AC-01')
    assert.deepEqual(doc.acceptance[0].featureIds, ['FR-01'])
    assert.equal(doc.pending.length, 1)
    assert.equal(doc.pending[0].id, 'Q-01')
    assert.deepEqual(doc.unparsed, [])
    // Every required canonical section is present in CANONICAL_BRIEF.
    assert.deepEqual(item.detailView.content.missing, [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('detail view keeps legacy labels and the old section detection', () => {
  const dir = tempFixture()
  try {
    const item = itemOf(requirements(dir), 'REQ-PAY-004')
    const content = item.detailView.content
    assert.equal(content.doc.status, 'legacy')
    assert.deepEqual(content.missing, ['范围', '验收要求'])
    assert.ok(content.sections.length > 0)
    assert.ok(Array.isArray(content.doc.unparsed))
    assert.equal(content.doc.status, 'legacy')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('buildExecutionPrompt embeds docHash, acceptance and the full body', () => {
  const body = '完整正文内容\n第二行'
  const prompt = buildExecutionPrompt({
    requirementId: 'REQ-PAY-004',
    changeId: 'CHG-001',
    runId: 'RUN-001',
    item: { revision: 3, briefText: body, docMeta: { docHash: 'sha256:meta' } },
    acceptanceCommands: ['node --test'],
    docView: {
      doc: {
        revision: 3,
        docHash: 'sha256:abc',
        acceptance: [{ id: 'AC-01', text: '退款成功' }],
      },
    },
  })
  assert.ok(prompt.includes('需求：REQ-PAY-004 v3（docHash sha256:abc）'))
  assert.ok(prompt.includes('AC-01'))
  assert.ok(prompt.includes(body))
  assert.ok(prompt.includes('工作方式'))
  assert.ok(!prompt.includes('当前修订：'))
})

test('buildExecutionPrompt rejects bodies above 60000 characters without truncating', () => {
  const body = 'x'.repeat(60001)
  assert.throws(
    () =>
      buildExecutionPrompt({
        requirementId: 'REQ-PAY-004',
        item: { revision: 1, briefText: body },
        acceptanceCommands: [],
      }),
    (error) => {
      assert.equal(error.code, 'requirement-doc-too-large')
      assert.equal(error.status, 422)
      assert.match(error.message, /60000/)
      assert.match(error.message, /不会截断/)
      return true
    },
  )
  // Exactly at the limit is still accepted.
  assert.doesNotThrow(() =>
    buildExecutionPrompt({
      requirementId: 'REQ-PAY-004',
      item: { revision: 1, briefText: 'y'.repeat(60000) },
      acceptanceCommands: [],
    }),
  )
})

test('buildExecutionPrompt keeps a 12000 character body intact end to end', () => {
  const body = `START-MARKER-${'a'.repeat(12000)}-END-MARKER`
  const prompt = buildExecutionPrompt({
    requirementId: 'REQ-PAY-004',
    item: { revision: 2, briefText: body },
    acceptanceCommands: [],
  })
  assert.ok(prompt.includes('START-MARKER-'))
  assert.ok(prompt.includes('-END-MARKER'))
  assert.ok(prompt.includes(body), 'the executor must receive the body unchanged')
})

test('createRun stores the requirement binding and runView exposes it', () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-desc-run-'))
  try {
    const { run } = createRun({
      root,
      requirementId: 'REQ-BIND-001',
      carrier: 'test-session',
      sessionId: 'sess-1',
      requirementRevision: 3,
      requirementDocHash: 'sha256:abc',
      acceptanceIds: ['AC-01', 'AC-02'],
    })
    assert.equal(run.requirementRevision, 3)
    assert.equal(run.requirementDocHash, 'sha256:abc')
    assert.deepEqual(run.acceptanceIds, ['AC-01', 'AC-02'])
    const view = runView({ root, requirementId: 'REQ-BIND-001' })
    assert.deepEqual(view.requirementBinding, {
      requirementRevision: 3,
      requirementDocHash: 'sha256:abc',
      acceptanceIds: ['AC-01', 'AC-02'],
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('legacy runs do not expose a requirement binding', () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-desc-run-'))
  try {
    const { run } = createRun({ root, requirementId: 'REQ-BIND-002', carrier: 'test-session', sessionId: 'sess-2' })
    assert.ok(!Object.prototype.hasOwnProperty.call(run, 'requirementRevision'))
    assert.ok(!Object.prototype.hasOwnProperty.call(run, 'requirementDocHash'))
    assert.ok(!Object.prototype.hasOwnProperty.call(run, 'acceptanceIds'))
    const view = runView({ root, requirementId: 'REQ-BIND-002' })
    assert.ok(!Object.prototype.hasOwnProperty.call(view, 'requirementBinding'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('updateRun can backfill the requirement binding', () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-desc-run-'))
  try {
    const { run } = createRun({ root, requirementId: 'REQ-BIND-003', carrier: 'test-session', sessionId: 'sess-3' })
    updateRun({
      root,
      runId: run.id,
      requirementRevision: 4,
      requirementDocHash: 'sha256:def',
      acceptanceIds: ['AC-03'],
      apply: true,
    })
    const view = runView({ root, requirementId: 'REQ-BIND-003' })
    assert.deepEqual(view.requirementBinding, {
      requirementRevision: 4,
      requirementDocHash: 'sha256:def',
      acceptanceIds: ['AC-03'],
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('description load returns the markdown, docHash and docMeta', async () => {
  const dir = tempFixture()
  try {
    await withServer(dir, async ({ post }) => {
      const { status, payload } = await post({ action: 'load', requirementId: 'REQ-PAY-004' })
      assert.equal(status, 200)
      assert.equal(payload.ok, true)
      assert.ok(payload.markdown.includes('# REQ-PAY-004'))
      assert.equal(payload.docHash, docHashOf(payload.markdown))
      assert.equal(payload.docMeta.source, 'legacy')
      assert.equal(payload.docMeta.revision, 2)
      assert.equal(payload.docMeta.docHash, payload.docHash)
      assert.equal(typeof payload.doc, 'object')
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('description load reports unknown requirements as 404', async () => {
  const dir = tempFixture()
  try {
    await withServer(dir, async ({ post }) => {
      const { status, payload } = await post({ action: 'load', requirementId: 'REQ-NOT-THERE' })
      assert.equal(status, 404)
      assert.equal(payload.ok, false)
      assert.equal(payload.code, 'requirement-not-found')
      assert.equal(typeof payload.message, 'string')
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('description organize is read-only even when apply is requested', async () => {
  const dir = tempFixture()
  const briefFile = join(dir, 'requirements/briefs/REQ-PAY-004.md')
  try {
    const before = readFileSync(briefFile, 'utf8')
    await withServer(dir, async ({ post }) => {
      const { status, payload } = await post({ action: 'organize', requirementId: 'REQ-PAY-004', apply: true })
      assert.equal(status, 200)
      assert.equal(payload.ok, true)
      assert.equal(payload.draft.status, 'legacy')
      assert.equal(typeof payload.draft.doc, 'object')
      assert.equal(payload.draft.docHash, docHashOf(payload.draft.markdown))
      assert.equal(payload.baseline.revision, 2)
      assert.equal(typeof payload.baseline.contentHash, 'string')
      assert.ok(Array.isArray(payload.diff.added))
      assert.ok(Array.isArray(payload.diff.removed))
      assert.ok(Array.isArray(payload.diff.modified))
      assert.ok(Array.isArray(payload.diff.pending))
    })
    assert.equal(readFileSync(briefFile, 'utf8'), before, 'organize must never write the brief')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('description diff compares the current brief with the submitted markdown', async () => {
  const dir = tempFixture()
  try {
    await withServer(dir, async ({ post }) => {
      const { status, payload } = await post({
        action: 'diff',
        requirementId: 'REQ-PAY-004',
        markdown: CANONICAL_BRIEF,
      })
      assert.equal(status, 200)
      assert.equal(payload.ok, true)
      assert.ok(Array.isArray(payload.diff.added))
      assert.ok(Array.isArray(payload.diff.modified))
      assert.equal(typeof payload.diff.docHashChanged, 'boolean')

      const bad = await post({ action: 'diff', requirementId: 'REQ-PAY-004', markdown: 123 })
      assert.equal(bad.status, 400)
      assert.equal(bad.payload.code, 'invalid-markdown')
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('description save requires apply and a string markdown', async () => {
  const dir = tempFixture()
  try {
    await withServer(dir, async ({ post }) => {
      const noApply = await post({ action: 'save', requirementId: 'REQ-PAY-004', markdown: CANONICAL_BRIEF })
      assert.equal(noApply.status, 400)
      assert.equal(noApply.payload.code, 'apply-required')

      const badMarkdown = await post({ action: 'save', requirementId: 'REQ-PAY-004', markdown: 42, apply: true })
      assert.equal(badMarkdown.status, 400)
      assert.equal(badMarkdown.payload.code, 'invalid-markdown')
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('description save rejects a stale baseline with 409', async () => {
  const dir = tempFixture()
  try {
    await withServer(dir, async ({ post }) => {
      const organized = await post({ action: 'organize', requirementId: 'REQ-PAY-004' })
      assert.equal(organized.payload.ok, true)
      const { status, payload } = await post({
        action: 'save',
        requirementId: 'REQ-PAY-004',
        markdown: CANONICAL_BRIEF,
        apply: true,
        expectedBaseline: { revision: 99 },
      })
      assert.equal(status, 409)
      assert.equal(payload.ok, false)
      assert.equal(payload.code, 'stale-baseline')
      assert.equal(payload.details.latest.revision, 2)
      assert.equal(typeof payload.details.latest.contentHash, 'string')
      assert.equal(typeof payload.details.latest.docHash, 'string')
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('description save writes the brief and bumps the revision', async () => {
  const dir = tempFixture()
  try {
    await withServer(dir, async ({ post }) => {
      const organized = await post({ action: 'organize', requirementId: 'REQ-PAY-004' })
      assert.equal(organized.payload.ok, true)
      const baseline = organized.payload.baseline
      const saved = await post({
        action: 'save',
        requirementId: 'REQ-PAY-004',
        markdown: CANONICAL_BRIEF,
        apply: true,
        expectedBaseline: { revision: baseline.revision, contentHash: baseline.contentHash },
      })
      assert.equal(saved.status, 200)
      assert.equal(saved.payload.ok, true)
      assert.equal(saved.payload.requirementId, 'REQ-PAY-004')
      assert.equal(saved.payload.revision, 3)
      assert.equal(saved.payload.docHash, docHashOf(CANONICAL_BRIEF))

      const loaded = await post({ action: 'load', requirementId: 'REQ-PAY-004' })
      assert.equal(loaded.payload.markdown, CANONICAL_BRIEF)
      assert.equal(loaded.payload.docMeta.source, 'canonical')
      assert.equal(loaded.payload.docMeta.confirmedAt, '2026-01-01T00:00:00.000Z')
    })

    const item = itemOf(requirements(dir), 'REQ-PAY-004')
    assert.equal(item.briefText, CANONICAL_BRIEF)
    assert.equal(item.docMeta.source, 'canonical')
    assert.equal(item.docMeta.revision, 3)
    assert.equal(item.detailView.content.doc.status, 'canonical')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('description organize preserves the adopted AI section in the draft', async () => {
  const dir = tempFixture()
  const briefFile = join(dir, 'requirements/briefs/REQ-PAY-004.md')
  try {
    const before = readFileSync(briefFile, 'utf8')
    const withAi = `${before.replace(/\s+$/, '')}\n\n## AI 评审建议（已采纳 2026-10-31）\n\n> AI 结论（warn）：补验收。\n`
    writeFileSync(briefFile, withAi)
    await withServer(dir, async ({ post }) => {
      const { status, payload } = await post({ action: 'organize', requirementId: 'REQ-PAY-004' })
      assert.equal(status, 200)
      assert.equal(payload.ok, true)
      assert.ok(payload.draft.markdown.includes('AI 评审建议（已采纳 2026-10-31）'))
      assert.ok(payload.draft.markdown.includes('AI 结论（warn）：补验收。'))
      assert.equal(payload.draft.docHash, docHashOf(payload.draft.markdown))
    })
    assert.equal(readFileSync(briefFile, 'utf8'), withAi, 'organize must not drop or rewrite the AI section')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('description rejects an unknown action and non-POST requests', async () => {
  const dir = tempFixture()
  try {
    await withServer(dir, async ({ post, get }) => {
      const bad = await post({ action: 'publish', requirementId: 'REQ-PAY-004' })
      assert.equal(bad.status, 400)
      assert.equal(bad.payload.code, 'invalid-action')

      const wrongMethod = await get()
      assert.equal(wrongMethod.status, 405)
      assert.equal(wrongMethod.payload.code, 'method-not-allowed')
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
