import test from 'node:test'
import assert from 'node:assert/strict'
import { renderErrorPage, renderRequirementsPage } from '../render.mjs'

const payload = {
  schema: 'alm.requirements/v1',
  root: 'D:\\DSH\\fixtures\\order-refund',
  result: 'pass',
  requirements: [
    {
      id: 'REQ-PAY-001',
      occurrenceKey: 'REQ-PAY-001@requirements/refund.sdoc:3',
      title: '支持订单部分退款',
      status: 'proposed',
      owner: 'team-payments',
      verifiedBy: ['TEST-PAY-001'],
      file: 'requirements/refund.sdoc',
      decision: {
        state: 'unchecked',
        label: '未检查',
        tone: 'neutral',
        topGap: {
          code: 'REVIEW-MISSING',
          message: '尚未运行并保存评审',
          fix: '运行评审并保存报告',
          severity: 'block',
        },
        gaps: [
          {
            code: 'REVIEW-MISSING',
            message: '尚未运行并保存评审',
            fix: '运行评审并保存报告',
            severity: 'block',
          },
        ],
        nextStep: { label: '运行评审', action: 'run-review' },
        signoff: { allowed: false, reasons: [{ code: 'coverage-incomplete', message: '评审视角未覆盖：security' }] },
        policy: { risk: 'high', requiredRoles: ['business', 'architecture', 'testing'], requiresAcceptance: true },
        coverage: { rolesCompleted: 3, rolesRequired: 5, missingRoles: ['security', 'delivery'] },
      },
      acceptance: {
        schema: 'alm.acceptance.summary/v2',
        registered: true,
        commandCount: 1,
        latest: {
          result: 'fail',
          headSha: 'abcdef1234567890',
          current: false,
          requirementHash: '0123456789abcdef0123',
          testRevision: 'fedcba9876543210fedc',
          complete: false,
          missing: ['environment', 'source'],
          staleReason: 'incomplete',
          environment: null,
          source: null,
          finishedAt: '2026-10-30T12:00:00.000Z',
        },
      },
    },
  ],
  gaps: [{ rule: 'COV-001', file: 'requirements/refund.sdoc', line: 7, message: 'missing verified_by' }],
  anomalies: [
    {
      kind: 'duplicate-id',
      message: '两条记录使用同一需求 ID',
      requirementIds: ['REQ-PAY-001', 'REQ-PAY-001'],
      occurrences: [
        {
          assetId: 'REQ-PAY-001',
          file: 'requirements/refund.sdoc',
          line: 3,
          occurrenceKey: 'REQ-PAY-001@requirements/refund.sdoc:3',
        },
        {
          assetId: 'REQ-PAY-001',
          file: 'requirements/refund-copy.sdoc',
          line: 5,
          occurrenceKey: 'REQ-PAY-001@requirements/refund-copy.sdoc:5',
        },
      ],
    },
  ],
  anomalySummary: { count: 1, duplicateId: 1, duplicateBusinessId: 0, dangling: 0 },
  summary: { requirements: 1, gaps: 1 },
}

test('requirements page renders the table, decision, coverage and gaps', () => {
  const html = renderRequirementsPage(payload)
  assert.match(html, /^<!doctype html>/)
  assert.match(html, /REQ-PAY-001/)
  assert.match(html, /ORDER|支持订单部分退款/)
  assert.match(html, /TEST-PAY-001/)
  assert.match(html, /已关联/)
  assert.match(html, /COV-001/)
  assert.match(html, /href="\/api\/alm\/requirements"/)
  assert.match(html, /check pass/)
})

test('decision state and next step are always rendered as text', () => {
  const html = renderRequirementsPage(payload)
  assert.match(html, /未检查/)
  assert.match(html, /尚未运行并保存评审/)
  assert.match(html, /运行评审/)
  // Unchecked must never read like a pass: no green tick or signoff wording.
  assert.ok(!html.includes('✓'))
  assert.ok(!html.includes('已签收'))
  assert.ok(!html.includes('可进入人工确认'))
})

test('acceptance shows provenance and flags incomplete evidence', () => {
  const html = renderRequirementsPage(payload)
  assert.match(html, /需求修订/)
  assert.match(html, /0123456789ab/)
  assert.match(html, /实现提交/)
  assert.match(html, /abcdef123456/)
  assert.match(html, /测试修订/)
  assert.match(html, /fedcba987654/)
  assert.match(html, /来源或版本不完整/)
  assert.match(html, /environment/)
})

test('complete acceptance evidence does not warn about incomplete provenance', () => {
  const item = payload.requirements[0]
  const html = renderRequirementsPage({
    ...payload,
    requirements: [
      {
        ...item,
        decision: { ...item.decision, state: 'ready-for-human', label: '可进入人工确认', tone: 'success', topGap: null },
        acceptance: {
          ...item.acceptance,
          latest: {
            ...item.acceptance.latest,
            complete: true,
            current: true,
            environment: { platform: 'win32', arch: 'x64', node: '22.0.0', runner: 'alm-core/acceptance' },
            source: 'local-runner',
          },
        },
      },
    ],
  })
  assert.match(html, /可进入人工确认/)
  assert.match(html, /local-runner/)
  assert.ok(!html.includes('来源或版本不完整'))
})

test('unexecuted acceptance never reads as a pass', () => {
  const item = payload.requirements[0]
  const html = renderRequirementsPage({
    ...payload,
    requirements: [{ ...item, decision: { ...item.decision, topGap: null }, acceptance: { registered: false, commandCount: 0, latest: null } }],
  })
  assert.match(html, /验收尚未执行/)
  assert.ok(!html.includes('验证通过'))
  assert.ok(!html.includes('✓'))
})

test('anomalies render in their own block and keep both records', () => {
  const html = renderRequirementsPage(payload)
  assert.match(html, /数据异常（1）/)
  assert.match(html, /ID 重复 1/)
  assert.match(html, /需求 ID 重复/)
  assert.match(html, /两条记录使用同一需求 ID/)
  assert.match(html, /requirements\/refund-copy\.sdoc:5/)
  assert.match(html, /保留两条记录、不自动合并/)
})

test('requirements page escapes asset, decision and anomaly fields', () => {
  const html = renderRequirementsPage({
    ...payload,
    requirements: [{ ...payload.requirements[0], title: '<script>alert(1)</script>' }],
    gaps: [{ rule: 'COV-001', file: 'a&b.sdoc', line: 1, message: '"quote"' }],
    anomalies: [
      {
        kind: 'dangling-relation',
        message: '<script>drop()</script>',
        occurrences: [{ assetId: 'REQ-<x>', file: 'a&b.sdoc', line: 9 }],
      },
    ],
  })
  assert.ok(!html.includes('<script>alert(1)</script>'))
  assert.ok(!html.includes('<script>drop()</script>'))
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.match(html, /&lt;script&gt;drop\(\)&lt;\/script&gt;/)
  assert.match(html, /a&amp;b\.sdoc/)
  assert.match(html, /REQ-&lt;x&gt;/)
})

test('requirements page reports an error payload', () => {
  const html = renderRequirementsPage({ ok: false, error: 'root not found' })
  assert.match(html, /Failed to load: root not found/)
  assert.match(renderErrorPage('boom'), /Failed to load: boom/)
})

test('requirements page renders the sidebar browser hint only when asked', () => {
  const withHint = renderRequirementsPage(payload, { sidebarUrl: 'http://localhost:58546/alm/requirements' })
  assert.match(withHint, /Sidebar browser:/)
  assert.match(withHint, /http:\/\/localhost:58546\/alm\/requirements/)
  assert.ok(!renderRequirementsPage(payload).includes('Sidebar browser:'))
})

test('the sidebar hint escapes its url', () => {
  const html = renderRequirementsPage(payload, { sidebarUrl: 'http://localhost:1/"><script>x</script>' })
  assert.ok(!html.includes('<script>x</script>'))
})

test('empty payload renders the start-here guidance', () => {
  const html = renderRequirementsPage({
    ...payload,
    requirements: [],
    gaps: [],
    anomalies: [],
    anomalySummary: { count: 0, duplicateId: 0, duplicateBusinessId: 0, dangling: 0 },
    summary: { requirements: 0, gaps: 0 },
  })
  assert.match(html, /Start here/)
  assert.match(html, /fixtures\/order-refund/)
  assert.match(html, /没有数据异常/)
})
