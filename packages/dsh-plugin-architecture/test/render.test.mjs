import test from 'node:test'
import assert from 'node:assert/strict'
import { renderArchitecturePage, renderErrorPage, sidebarBrowserUrl } from '../render.mjs'

const payload = {
  schema: 'alm.architecture/v1',
  root: 'D:\\DSH\\fixtures\\order-refund',
  result: 'pass',
  modules: [
    { id: 'MOD-PAY-REFUND', title: '退款模块', status: 'accepted', owner: 'team-payments', file: 'architecture/MOD-PAY-REFUND.yml' },
  ],
  decisions: [
    { id: 'ADR-PAY-003', title: '退款与订单状态在同一事务边界内完成', status: 'accepted', owner: 'team-arch', file: 'adr/ADR-PAY-003.md' },
  ],
  interfaces: [],
  dataModels: [],
  edges: [{ from: 'MOD-PAY-REFUND', to: 'ADR-PAY-003', type: 'constrained_by' }],
  impact: { 'MOD-PAY-REFUND': 1, 'ADR-PAY-003': 5 },
  gaps: [{ rule: 'REL-001', file: 'architecture/x.yml', line: 3, message: 'dangling relation' }],
  summary: { nodes: 2, edges: 1, gaps: 1, affected: 6 },
}

test('architecture page renders nodes, impact, edges and gaps', () => {
  const html = renderArchitecturePage(payload)
  assert.match(html, /^<!doctype html>/)
  assert.match(html, /MOD-PAY-REFUND/)
  assert.match(html, /ADR-PAY-003/)
  assert.match(html, /constrained_by/)
  assert.match(html, /REL-001/)
  assert.match(html, /href="\/api\/alm\/architecture"/)
  assert.match(html, /2 nodes · 1 edges/)
})

test('architecture page escapes asset fields', () => {
  const html = renderArchitecturePage({
    ...payload,
    modules: [{ ...payload.modules[0], title: '<img src=x onerror=alert(1)>' }],
  })
  assert.ok(!html.includes('<img src=x onerror=alert(1)>'))
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/)
})

test('architecture page reports an error payload', () => {
  const html = renderArchitecturePage({ ok: false, error: 'parse failed' })
  assert.match(html, /Failed to load: parse failed/)
  assert.match(renderErrorPage('boom'), /Failed to load: boom/)
})

test('architecture page points the sidebar browser at the other loopback hostname', () => {
  assert.equal(sidebarBrowserUrl('127.0.0.1:58546', '/alm/architecture'), 'http://localhost:58546/alm/architecture')
  const html = renderArchitecturePage(payload, { sidebarUrl: 'http://localhost:58546/alm/architecture' })
  assert.match(html, /Sidebar browser:/)
  assert.match(html, /http:\/\/localhost:58546\/alm\/architecture/)
  assert.ok(!renderArchitecturePage(payload).includes('Sidebar browser:'))
})
