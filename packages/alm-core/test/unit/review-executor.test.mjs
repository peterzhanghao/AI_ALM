import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  AI_REVIEW_DIR,
  AI_REVIEW_SCHEMA,
  aiReviewReportPath,
  readAiReviewReport,
} from '../../src/review/executor.mjs'

const roots = []

test.after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), 'alm-ai-review-'))
  roots.push(root)
  return root
}

test('AI review reports use an advisory-only schema and separate filename', () => {
  const root = makeRoot()
  assert.equal(AI_REVIEW_SCHEMA, 'alm.ai-review/v1')
  assert.equal(AI_REVIEW_DIR, '.alm/reviews')
  assert.equal(aiReviewReportPath(root, 'REQ-X-001'), join(root, '.alm/reviews', 'REQ-X-001.ai.json'))
})

test('readAiReviewReport returns a valid advisory report', () => {
  const root = makeRoot()
  mkdirSync(join(root, '.alm/reviews'), { recursive: true })
  const payload = {
    schema: AI_REVIEW_SCHEMA,
    requirement: 'REQ-X-001',
    verdict: 'warn',
    suggestions: [{ message: 'clarify boundary' }],
  }
  writeFileSync(aiReviewReportPath(root, 'REQ-X-001'), `${JSON.stringify(payload, null, 2)}\n`)
  const report = readAiReviewReport(root, 'REQ-X-001')
  assert.equal(report.schema, AI_REVIEW_SCHEMA)
  assert.equal(report.verdict, 'warn')
  assert.deepEqual(report.suggestions, payload.suggestions)
  assert.equal(report.file, aiReviewReportPath(root, 'REQ-X-001'))
})

test('missing, malformed and legacy five-perspective reports are ignored', () => {
  const root = makeRoot()
  assert.equal(readAiReviewReport(root, 'REQ-X-001'), null)
  mkdirSync(join(root, '.alm/reviews'), { recursive: true })
  writeFileSync(aiReviewReportPath(root, 'REQ-X-001'), '{not-json')
  assert.equal(readAiReviewReport(root, 'REQ-X-001'), null)
  writeFileSync(aiReviewReportPath(root, 'REQ-X-001'), JSON.stringify({ schema: 'alm.review/v1', roles: [] }))
  assert.equal(readAiReviewReport(root, 'REQ-X-001'), null)
})
