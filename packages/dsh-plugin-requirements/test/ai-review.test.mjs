import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { checkReport, indexReport } from '../../alm-core/src/commands.mjs'
import { worktreeSnapshot } from '../../alm-core/src/requirements/worktree-snapshot.mjs'
import RequirementsService from '../index.js'
import {
  adoptAiReview,
  aiReviewSummary,
  readAiReview,
  recentAiReviewUsage,
  runAiReview,
  writeAiReview,
  writeAiReviewUsage,
} from '../ai-review.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const fixture = join(repoRoot, 'fixtures/order-refund')
const dirs = []

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'alm-ai-review-'))
  dirs.push(root)
  cpSync(fixture, root, { recursive: true })
  return root
}

function context(root) {
  const index = indexReport(root)
  const asset = index.assets.find((entry) => entry.id === 'REQ-PAY-001')
  return { asset, item: { id: asset.id, file: asset.source.path }, check: checkReport(root) }
}

const REVIEW = {
  verdict: 'warn',
  summary: '需求目标清楚，但验收与边界仍需补齐。',
  findings: [
    { title: '缺少异常路径', severity: 'warn', detail: '退款失败/超时的行为未描述。', ref: '背景' },
    { title: '验收不可测', severity: 'block', detail: '没有可执行的验收场景。', ref: 'COV-001' },
  ],
  suggestions: [
    { id: 'S1', title: '补充异常路径', category: '范围', detail: '明确失败与重试行为。', suggestedText: '退款失败时保留幂等键，允许同键重试。' },
    { id: 'S2', title: '增加验收场景', category: '验收', detail: '为并发重复请求补充测试。', suggestedText: '并发两次同键请求只产生一张退款单。' },
  ],
  plan: [
    { step: '补齐边界', detail: '补充失败、超时、并发三类边界。' },
    { step: '补验收', detail: '新增 TEST 资产并建立 verified_by。' },
  ],
  proposedBrief: '## 背景\n\n明确幂等退款边界与验收场景。',
}

function fakeStream(payload) {
  return async function* stream() {
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload)
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

test.after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

test('runAiReview parses the model JSON into a normalized review', async () => {
  const root = makeRepo()
  const ctx = context(root)
  let options
  const report = await runAiReview({
    stream: value => { options = value; return fakeStream(REVIEW)() },
    provider: 'fake',
    model: 'fake-review',
    reasoningEffort: 'low',
    asset: ctx.asset,
    item: ctx.item,
    check: ctx.check,
    briefText: '# brief',
  })
  assert.equal(options.reasoningEffort, 'low')
  assert.equal(report.schema, 'alm.ai-review/v1')
  assert.equal(report.verdict, 'warn')
  assert.equal(report.findings.length, 2)
  assert.equal(report.suggestions[0].id, 'S1')
  assert.equal(report.plan.length, 2)
  assert.match(report.proposedBrief, /幂等退款/)
  assert.equal(report.adopted, null)
  assert.equal(report.usage, null)
})

test('review keeps the final provider usage sample with unknown fields and exposes it in the saved summary', async () => {
  const root = makeRepo()
  const ctx = context(root)
  async function* stream() {
    yield { type: 'text-delta', text: JSON.stringify(REVIEW) }
    yield { type: 'usage', usage: { inputTokens: 30, outputTokens: 4, cacheReadTokens: 5 } }
    yield { type: 'usage', usage: { inputTokens: 40, outputTokens: 7, cacheReadTokens: 8, cacheWriteTokens: -1 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
  const report = await runAiReview({ stream, provider: 'fake', model: 'model', ...ctx, briefText: '' })
  assert.deepEqual(report.usage, { inputTokens: 40, outputTokens: 7, cacheReadTokens: 8, cacheWriteTokens: null })
  writeAiReview(root, report)
  assert.deepEqual(aiReviewSummary(root, ctx.asset.id).usage, report.usage)
})

test('an invalid final usage sample is unknown rather than an older partial total', async () => {
  const root = makeRepo()
  const ctx = context(root)
  async function* stream() {
    yield { type: 'text-delta', text: JSON.stringify(REVIEW) }
    yield { type: 'usage', usage: { inputTokens: 30, outputTokens: 4 } }
    yield { type: 'usage', usage: { inputTokens: -1, outputTokens: 'bad' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
  const report = await runAiReview({ stream, provider: 'fake', model: 'model', ...ctx, briefText: '' })
  assert.equal(report.usage, null)
})

test('independent review attempts retain successful and failed usage without prompts or output', async () => {
  const root = makeRepo()
  const ctx = context(root)
  let fail = true
  async function* stream() {
    yield { type: 'usage', usage: { inputTokens: 42, outputTokens: 3 } }
    yield { type: 'text-delta', text: fail ? 'private invalid output' : JSON.stringify(REVIEW) }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
  const service = { resolveAiSelection: async () => ({ provider: 'fake', model: 'model' }), aiStreamFor: () => stream }
  await assert.rejects(RequirementsService.prototype.generateAiReview.call(service, root, ctx, {}), error => error.code === 'ai-parse-failed' && error.usageReceiptStored === true)
  assert.equal(aiReviewSummary(root, ctx.asset.id).stored, false)
  let history = recentAiReviewUsage(root, ctx.asset.id)
  assert.equal(history[0].status, 'failed')
  assert.equal(history[0].usage.inputTokens, 42)
  assert.equal(history[0].usage.cacheReadTokens, null)
  assert.doesNotMatch(JSON.stringify(history), /private invalid output/)
  fail = false
  const report = await RequirementsService.prototype.generateAiReview.call(service, root, ctx, {})
  assert.equal(report.usageReceiptStored, true)
  history = recentAiReviewUsage(root, ctx.asset.id)
  assert.equal(history.length, 2)
  assert.deepEqual(new Set(history.map(row => row.status)), new Set(['failed', 'completed']))
  assert.ok(history.every(row => row.complete === false))
})

test('review usage evidence does not change the deliverable snapshot', () => {
  const root = mkdtempSync(join(tmpdir(), 'alm-review-snapshot-'))
  dirs.push(root)
  const git = (...args) => execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', ...args], { cwd: root, stdio: 'pipe' })
  git('init')
  writeFileSync(join(root, 'source.txt'), 'content')
  git('add', 'source.txt')
  git('commit', '-qm', 'initial')
  const before = worktreeSnapshot(root)
  writeAiReviewUsage(root, { requirement: 'REQ-A', provider: 'test', model: 'model', startedAt: new Date().toISOString(), status: 'failed' })
  assert.equal(worktreeSnapshot(root).treeHash, before.treeHash)
})

test('review survives an unavailable usage ledger and reports the missing receipt', async () => {
  const root = makeRepo()
  const ctx = context(root)
  const reviewDir = join(root, '.alm', 'reviews')
  mkdirSync(reviewDir, { recursive: true })
  writeFileSync(join(reviewDir, 'usage'), 'not a directory')
  const service = { resolveAiSelection: async () => ({ provider: 'fake', model: 'model' }), aiStreamFor: () => fakeStream(REVIEW) }
  const report = await RequirementsService.prototype.generateAiReview.call(service, root, ctx, {})
  assert.equal(report.usageReceiptStored, false)
  assert.equal(aiReviewSummary(root, ctx.asset.id).usageReceiptStored, false)
  assert.equal(readAiReview(root, ctx.asset.id).verdict, REVIEW.verdict)
})

test('damaged usage receipts are reported as unavailable rather than silently hidden', () => {
  const root = makeRepo()
  const dir = join(root, '.alm', 'reviews', 'usage', 'REQ-PAY-001')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, '20261105000000000-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.json'), '{')
  assert.throws(() => recentAiReviewUsage(root, 'REQ-PAY-001'), { code: 'review-usage-unavailable', status: 503 })
})

test('runAiReview tolerates code fences and rejects invalid JSON', async () => {
  const root = makeRepo()
  const ctx = context(root)
  const fenced = `\`\`\`json\n${JSON.stringify(REVIEW)}\n\`\`\``
  const ok = await runAiReview({ stream: fakeStream(fenced), provider: 'fake', model: 'fake', ...ctx, briefText: '' })
  assert.equal(ok.suggestions.length, 2)
  await assert.rejects(
    runAiReview({ stream: fakeStream('not json'), provider: 'fake', model: 'fake', ...ctx, briefText: '' }),
    (error) => error.code === 'ai-parse-failed',
  )
})

test('runAiReview repairs a JSON response truncated mid-stream', async () => {
  const root = makeRepo()
  const ctx = context(root)
  const full = JSON.stringify(REVIEW)
  const cut = full.indexOf('"proposedBrief"') + 30
  const report = await runAiReview({
    stream: fakeStream(full.slice(0, cut)),
    provider: 'fake',
    model: 'fake',
    ...ctx,
    briefText: '',
  })
  assert.equal(report.suggestions.length, 2)
  assert.equal(report.plan.length, 2)
  assert.match(report.proposedBrief, /## 背景/)
})

test('adoptAiReview appends selected suggestions and is idempotent', () => {
  const root = makeRepo()
  const ctx = context(root)
  const report = {
    schema: 'alm.ai-review/v1',
    requirement: ctx.asset.id,
    provider: 'fake',
    model: 'fake',
    generatedAt: new Date().toISOString(),
    ...REVIEW,
    adopted: null,
  }
  const adopted = adoptAiReview({
    root,
    asset: ctx.asset,
    report,
    selectedSuggestionIds: ['S1'],
    includeBrief: true,
  })
  assert.deepEqual(adopted.adopted.suggestionIds, ['S1'])
  assert.ok(existsSync(join(root, '.alm/reviews/REQ-PAY-001.ai.json')))
  const brief = readFileSync(join(root, 'requirements/briefs/REQ-PAY-001.md'), 'utf8')
  assert.match(brief, /AI 优化建议（已采纳/)
  assert.match(brief, /补充异常路径/)
  assert.doesNotMatch(brief, /增加验收场景/)
  assert.match(brief, /### 重构方案/)
  // The full proposed brief lives in the AI report; it is never pasted into the
  // requirement brief, so the brief stays compact and readable.
  assert.doesNotMatch(brief, /### AI 建议背景/)
  assert.doesNotMatch(brief, /# REQ-PAY-001 退款/)

  const second = adoptAiReview({ root, asset: ctx.asset, report: adopted, selectedSuggestionIds: ['S2'], includeBrief: false })
  const twice = readFileSync(join(root, 'requirements/briefs/REQ-PAY-001.md'), 'utf8')
  assert.equal((twice.match(/## AI 优化建议（已采纳/g) ?? []).length, 1)
  assert.match(twice, /增加验收场景/)
  assert.doesNotMatch(twice, /补充异常路径/, 're-adoption replaces the previous section')
  assert.equal(second.changed, true)

  const third = adoptAiReview({ root, asset: ctx.asset, report: second, selectedSuggestionIds: ['S2'], includeBrief: false })
  const thrice = readFileSync(join(root, 'requirements/briefs/REQ-PAY-001.md'), 'utf8')
  assert.equal(thrice, twice, 'repeating the same adoption is a no-op')
  assert.equal(third.changed, false)
  assert.equal(aiReviewSummary(root, 'REQ-PAY-001').adopted.includeBrief, false)
  assert.equal(readAiReview(root, 'REQ-PAY-001').requirement, 'REQ-PAY-001')
})

test('adoptAiReview with no selected suggestions is a pure no-op', () => {
  const root = makeRepo()
  const ctx = context(root)
  const file = join(root, 'requirements/briefs/REQ-PAY-001.md')
  const reportFile = join(root, '.alm/reviews/REQ-PAY-001.ai.json')
  const before = existsSync(file) ? readFileSync(file, 'utf8') : null
  const skipped = adoptAiReview({
    root,
    asset: ctx.asset,
    report: { ...REVIEW, requirement: ctx.asset.id, verdict: 'warn', summary: '', adopted: null, suggestions: [], plan: [], proposedBrief: '' },
    selectedSuggestionIds: [],
  })
  assert.equal(skipped.applied, false)
  assert.equal(skipped.skipped, true)
  assert.equal(skipped.adopted, null)
  assert.equal(skipped.changed, false)
  assert.equal(existsSync(reportFile), false)
  assert.equal(existsSync(file) ? readFileSync(file, 'utf8') : null, before)
})
