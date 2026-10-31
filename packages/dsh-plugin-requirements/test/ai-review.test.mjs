import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { checkReport, indexReport } from '../../alm-core/src/commands.mjs'
import {
  adoptAiReview,
  aiReviewSummary,
  readAiReview,
  runAiReview,
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
  const report = await runAiReview({
    stream: fakeStream(REVIEW),
    provider: 'fake',
    model: 'fake-review',
    asset: ctx.asset,
    item: ctx.item,
    check: ctx.check,
    briefText: '# brief',
  })
  assert.equal(report.schema, 'alm.ai-review/v1')
  assert.equal(report.verdict, 'warn')
  assert.equal(report.findings.length, 2)
  assert.equal(report.suggestions[0].id, 'S1')
  assert.equal(report.plan.length, 2)
  assert.match(report.proposedBrief, /幂等退款/)
  assert.equal(report.adopted, null)
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
  assert.match(brief, /AI 评审建议（已采纳/)
  assert.match(brief, /补充异常路径/)
  assert.doesNotMatch(brief, /增加验收场景/)
  assert.match(brief, /### 重构方案/)
  // The full proposed brief lives in the AI report; it is never pasted into the
  // requirement brief, so the brief stays compact and readable.
  assert.doesNotMatch(brief, /### AI 建议背景/)
  assert.doesNotMatch(brief, /# REQ-PAY-001 退款/)

  const second = adoptAiReview({ root, asset: ctx.asset, report: adopted, selectedSuggestionIds: ['S2'], includeBrief: false })
  const twice = readFileSync(join(root, 'requirements/briefs/REQ-PAY-001.md'), 'utf8')
  assert.equal((twice.match(/## AI 评审建议（已采纳/g) ?? []).length, 1)
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

test('adoptAiReview with no selected suggestions accepts the review without touching the brief', () => {
  const root = makeRepo()
  const ctx = context(root)
  const file = join(root, 'requirements/briefs/REQ-PAY-001.md')
  const before = existsSync(file) ? readFileSync(file, 'utf8') : null
  const accepted = adoptAiReview({
    root,
    asset: ctx.asset,
    report: { ...REVIEW, requirement: ctx.asset.id, verdict: 'warn', summary: '', adopted: null, suggestions: [], plan: [], proposedBrief: '' },
    selectedSuggestionIds: [],
  })
  assert.equal(accepted.adopted.suggestionIds.length, 0)
  assert.equal(accepted.adopted.noSuggestions, true)
  assert.equal(accepted.changed, false)
  assert.equal(existsSync(file) ? readFileSync(file, 'utf8') : null, before)
})
