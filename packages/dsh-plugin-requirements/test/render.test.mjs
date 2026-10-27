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
      title: '支持订单部分退款',
      status: 'proposed',
      owner: 'team-payments',
      verifiedBy: ['TEST-PAY-001'],
      file: 'requirements/refund.sdoc',
    },
  ],
  gaps: [{ rule: 'COV-001', file: 'requirements/refund.sdoc', line: 7, message: 'missing verified_by' }],
  summary: { requirements: 1, gaps: 1 },
}

test('requirements page renders the table, coverage and gaps', () => {
  const html = renderRequirementsPage(payload)
  assert.match(html, /^<!doctype html>/)
  assert.match(html, /REQ-PAY-001/)
  assert.match(html, /ORDER|支持订单部分退款/)
  assert.match(html, /TEST-PAY-001/)
  assert.match(html, /COV-001/)
  assert.match(html, /href="\/api\/alm\/requirements"/)
  assert.match(html, /check pass/)
})

test('requirements page escapes asset fields', () => {
  const html = renderRequirementsPage({
    ...payload,
    requirements: [{ ...payload.requirements[0], title: '<script>alert(1)</script>' }],
    gaps: [{ rule: 'COV-001', file: 'a&b.sdoc', line: 1, message: '"quote"' }],
  })
  assert.ok(!html.includes('<script>alert(1)</script>'))
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.match(html, /a&amp;b\.sdoc/)
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
