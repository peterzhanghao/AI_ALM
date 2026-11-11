import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import RequirementsService from '../index.js'
import { createRun, updateRun, runPath } from '../../alm-core/src/requirements/run.mjs'

test('long event content requires a valid event hash before requesting continuation', async () => {
  const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')
  const marker = '    return {\n      inject:'
  const entry = `import React from 'react'; import {createRoot} from 'react-dom/client';
    window.__ModuleLoader__={load({factory}){factory(()=>React)}}; ${source.replace(marker, '    globalThis.TestText = RunEventText;\n' + marker)}
    createRoot(document.getElementById('root')).render(React.createElement(globalThis.TestText,{entry:{sessionId:'s',seq:1,text:'原始内容',truncated:true},field:'text',root:'D:/test',requirementId:'REQ-A',runId:'RUN-001',segment:0}));`
  const bundle = await build({ stdin: { contents: entry, resolveDir: fileURLToPath(new URL('../../../', import.meta.url)), loader: 'js' }, bundle: true, write: false, platform: 'browser', format: 'esm' })
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  let requests = 0
  await page.route('http://test.local/**', route => {
    if (route.request().url().endsWith('/app.js')) return route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text })
    if (new URL(route.request().url()).pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div><script type="module" src="/app.js"></script>' })
    requests++; return route.fulfill({ json: { ok: true } })
  })
  try {
    await page.goto('http://test.local/')
    await page.getByRole('button', { name: '加载后续内容' }).click()
    await page.getByRole('alert').getByText(/记录校验值不可用/).waitFor()
    assert.equal(requests, 0)
    assert.equal(await page.getByText('原始内容').isVisible(), true)
  } finally { await browser.close() }
})

test('queued run without a session shows its real state and loads the session when attached', async () => {
  const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')
  const marker = '    return {\n      inject:'
  const root = mkdtempSync(join(tmpdir(), 'alm-observe-no-session-'))
  const run = createRun({ root, requirementId: 'REQ-A', carrier: 'dsh-session' }).run
  const entry = `import React from 'react'; import {createRoot} from 'react-dom/client';
    window.__ModuleLoader__={load({factory}){factory(()=>React)}}; ${source.replace(marker, '    globalThis.TestPanel = RunObservationPanel;\n' + marker)}
    createRoot(document.getElementById('root')).render(React.createElement(globalThis.TestPanel,{root:${JSON.stringify(root)},item:{id:'REQ-A',run:{id:${JSON.stringify(run.id)},status:'queued'}},detail:{summaries:{run:{id:${JSON.stringify(run.id)},status:'queued'}}}}));`
  const bundle = await build({ stdin: { contents: entry, resolveDir: fileURLToPath(new URL('../../../', import.meta.url)), loader: 'js' }, bundle: true, write: false, platform: 'browser', format: 'esm' })
  const service = Object.create(RequirementsService.prototype)
  service.rootFor = () => root
  service.ctx = { get: name => name === 'sessionQuery' ? { async readSession() { return { events: [{ seq: 0, type: 'user/message', data: { content: '会话已连接' } }] } } } : null }
  const server = createServer((req, res) => {
    if (req.url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<div id="root"></div><script type="module" src="/app.js"></script>'); return }
    if (req.url === '/app.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(bundle.outputFiles[0].text); return }
    void service.handleRunObservation(req, res).catch(() => { if (!res.headersSent) res.writeHead(500); res.end() })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.addInitScript(() => {
      const original = window.setTimeout
      window.setTimeout = (callback, delay, ...args) => original(callback, delay === 4000 ? 500 : delay, ...args)
    })
    await page.goto(`http://127.0.0.1:${server.address().port}/`)
    await page.getByRole('status').filter({ hasText: '此运行尚未关联 DSH 会话，暂无会话记录。' }).waitFor()
    await page.waitForTimeout(200)
    assert.equal(await page.getByText(/实时内容暂不可用|宿主暂时无法读取|此会话暂无可显示/).count(), 0)
    updateRun({ root, runId: run.id, sessionId: 'attached-session', apply: true })
    await page.getByText('会话已连接').waitFor()
    assert.equal(await page.getByText('此运行尚未关联 DSH 会话，暂无会话记录。').count(), 0)
  } finally {
    await browser.close()
    await new Promise(resolve => server.close(resolve))
    rmSync(root, { recursive: true, force: true })
  }
})

test('tool result association is replayed when a later call makes it ambiguous', async () => {
  const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')
  const marker = '    return {\n      inject:'
  const root = mkdtempSync(join(tmpdir(), 'alm-observe-tool-replay-ui-'))
  const run = createRun({ root, requirementId: 'REQ-A', carrier: 'dsh-session', sessionId: 's', status: 'running' }).run
  const entry = `import React from 'react'; import {createRoot} from 'react-dom/client';
    window.__ModuleLoader__={load({factory}){factory(()=>React)}}; ${source.replace(marker, '    globalThis.TestPanel = RunObservationPanel;\n' + marker)}
    createRoot(document.getElementById('root')).render(React.createElement(globalThis.TestPanel,{root:${JSON.stringify(root)},item:{id:'REQ-A',run:{id:${JSON.stringify(run.id)},status:'running'}},detail:{summaries:{run:{id:${JSON.stringify(run.id)},status:'running'}}}}));`
  const bundle = await build({ stdin: { contents: entry, resolveDir: fileURLToPath(new URL('../../../', import.meta.url)), loader: 'js' }, bundle: true, write: false, platform: 'browser', format: 'esm' })
  const longResult = '结果正文' + 'x'.repeat(115) + '\u{1F680}' + 'y'.repeat(4000) + '末尾'
  const events = [
    { seq: 0, type: 'tool/call', data: { callId: 'call', name: 'read', arguments: '{}' } },
    { seq: 1, type: 'tool/result', data: { message: { toolCallId: 'call', source: { kind: 'tool', callId: 'call' }, content: longResult } } },
    { seq: 2, type: `custom/${'x'.repeat(110)}`, data: { secret: 'must-not-appear' } },
    { seq: 3, type: 'tool/call', data: { callId: 'long', name: 't'.repeat(120), arguments: '{}' } },
  ]
  const service = Object.create(RequirementsService.prototype)
  service.rootFor = () => root
  service.ctx = { get: name => name === 'sessionQuery' ? { async readSession() { return { events } } } : null }
  const server = createServer((req, res) => {
    if (req.url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<div id="root"></div><script type="module" src="/app.js"></script>'); return }
    if (req.url === '/app.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(bundle.outputFiles[0].text); return }
    void service.handleRunObservation(req, res).catch(() => { if (!res.headersSent) res.writeHead(500); res.end() })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 320, height: 640 } })
    await page.addInitScript(() => {
      const original = window.setTimeout
      window.setTimeout = (callback, delay, ...args) => original(callback, delay === 4000 ? 200 : delay, ...args)
      window.copiedValues = []
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => { window.copiedValues.push(text) } } })
    })
    await page.goto(`http://127.0.0.1:${server.address().port}/`)
    await page.getByText(/第 1 段 · 初始会话 · 来源 DSH 会话/).waitFor()
    await page.getByRole('button', { name: '轨迹', exact: true }).click()
    const result = page.locator('article').filter({ hasText: '结果正文' })
    await result.getByText('read', { exact: true }).waitFor()
    await page.getByText(`custom/${'x'.repeat(110)}`).waitFor()
    assert.equal(await page.getByText('t'.repeat(120)).isVisible(), true)
    assert.equal(await page.getByText('must-not-appear').count(), 0)
    assert.equal(await result.locator('details').evaluate(node => node.open), false)
    assert.match(await result.locator('summary').textContent(), /\u{1F680}…$/u)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await result.locator('summary').focus()
    await page.keyboard.press('Enter')
    await result.getByRole('button', { name: '加载后续内容' }).click()
    await result.getByRole('button', { name: '复制内容', exact: true }).waitFor()
    await result.getByRole('button', { name: '复制内容', exact: true }).click()
    assert.deepEqual(await page.evaluate(() => window.copiedValues), [longResult])
    await result.locator('summary').focus()
    events.push({ seq: 4, type: 'tool/call', data: { callId: 'call', name: 'shell', arguments: '{}' } })
    await page.getByText('shell', { exact: true }).waitFor({ timeout: 5000 })
    assert.equal(await result.getByText('read', { exact: true }).count(), 0)
    assert.equal(await result.count(), 1)
    assert.equal(await result.locator('details').evaluate(node => node.open), true)
    assert.equal(await result.locator('summary').evaluate(node => document.activeElement === node), true)
    assert.equal(await result.locator('p').filter({ hasText: '末尾' }).isVisible(), true)
  } finally {
    await browser.close()
    await new Promise(resolve => server.close(resolve))
    rmSync(root, { recursive: true, force: true })
  }
})

test('interruption notice follows the selected session segment', async () => {
  const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')
  const marker = '    return {\n      inject:'
  const root = mkdtempSync(join(tmpdir(), 'alm-observe-interrupted-ui-'))
  const run = createRun({ root, requirementId: 'REQ-A', carrier: 'dsh-session', sessionId: 'first' }).run
  updateRun({ root, runId: run.id, status: 'failed', failure: { code: 'host-restart' }, apply: true })
  updateRun({ root, runId: run.id, status: 'running', sessionId: 'second', apply: true })
  updateRun({ root, runId: run.id, status: 'failed', failure: { code: 'other' }, apply: true })
  const stored = JSON.parse(readFileSync(runPath(root, run.id), 'utf8'))
  delete stored.sessions[0].source
  writeFileSync(runPath(root, run.id), JSON.stringify(stored))
  const entry = `import React from 'react'; import {createRoot} from 'react-dom/client';
    window.__ModuleLoader__={load({factory}){factory(()=>React)}}; ${source.replace(marker, '    globalThis.TestPanel = RunObservationPanel;\n' + marker)}
    createRoot(document.getElementById('root')).render(React.createElement(globalThis.TestPanel,{root:${JSON.stringify(root)},item:{id:'REQ-A',run:{id:${JSON.stringify(run.id)},status:'failed'}},detail:{summaries:{run:{id:${JSON.stringify(run.id)},status:'failed'}}}}));`
  const bundle = await build({ stdin: { contents: entry, resolveDir: fileURLToPath(new URL('../../../', import.meta.url)), loader: 'js' }, bundle: true, write: false, platform: 'browser', format: 'esm' })
  const service = Object.create(RequirementsService.prototype)
  service.rootFor = () => root
  service.ctx = { get: name => name === 'sessionQuery' ? { async readSession(id) { return { events: [{ seq: 0, type: 'user/message', data: { content: `input-${id}` } }] } } } : null }
  const server = createServer((req, res) => {
    if (req.url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<div id="root"></div><script type="module" src="/app.js"></script>'); return }
    if (req.url === '/app.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(bundle.outputFiles[0].text); return }
    void service.handleRunObservation(req, res).catch(() => { if (!res.headersSent) res.writeHead(500); res.end() })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.goto(`http://127.0.0.1:${server.address().port}/`)
    const notice = page.getByRole('status').filter({ hasText: '执行期间宿主中断，尚未保存的实时输出可能缺失。' })
    await notice.waitFor()
    await page.getByText(/第 1 段 · 初始会话 · 来源 未知/).waitFor()
    await page.getByLabel('选择会话').selectOption('1')
    await page.getByText('input-second').waitFor()
    await page.getByText(/第 2 段 · 恢复会话 · 来源 DSH 会话/).waitFor()
    assert.equal(await notice.count(), 0)
    await page.getByLabel('选择会话').selectOption('0')
    await notice.waitFor()
    assert.equal(await page.getByText('input-first').isVisible(), true)
  } finally {
    await browser.close()
    await new Promise(resolve => server.close(resolve))
    rmSync(root, { recursive: true, force: true })
  }
})

test('browser recovers from a stalled persistence read through the HTTP handler', async () => {
  const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')
  const marker = '    return {\n      inject:'
  const root = mkdtempSync(join(tmpdir(), 'alm-observe-browser-http-'))
  const run = createRun({ root, requirementId: 'REQ-A', carrier: 'dsh-session', sessionId: 's' }).run
  updateRun({ root, runId: run.id, status: 'failed', failure: { code: 'heartbeat-lost', message: 'lost' }, apply: true })
  const entry = `import React from 'react'; import {createRoot} from 'react-dom/client';
    window.__ModuleLoader__={load({factory}){factory(()=>React)}}; ${source.replace(marker, '    globalThis.TestPanel = RunObservationPanel;\n' + marker)}
    createRoot(document.getElementById('root')).render(React.createElement(globalThis.TestPanel,{root:${JSON.stringify(root)},item:{id:'REQ-A',run:{id:${JSON.stringify(run.id)},status:'failed'}},detail:{summaries:{run:{id:${JSON.stringify(run.id)},status:'failed'}}}}));`
  const bundle = await build({ stdin: { contents: entry, resolveDir: fileURLToPath(new URL('../../../', import.meta.url)), loader: 'js' }, bundle: true, write: false, platform: 'browser', format: 'esm' })
  let release, calls = 0, closes = 0
  const gate = new Promise(resolve => { release = resolve })
  const persistence = { async open() { calls++; if (calls === 1) await gate; return { async read() { return { events: [{ seq: 0, type: 'user/message', data: { content: '恢复后的记录' } }] } }, async close() { closes++ } } } }
  const service = Object.create(RequirementsService.prototype)
  service.rootFor = () => root
  service.ctx = { get: name => name === 'sessionPersistence' ? persistence : null }
  const server = createServer((req, res) => {
    if (req.url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<div id="root"></div><script type="module" src="/app.js"></script>'); return }
    if (req.url === '/app.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(bundle.outputFiles[0].text); return }
    void service.handleRunObservation(req, res).catch(() => { if (!res.headersSent) res.writeHead(500); res.end() })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.goto(`http://127.0.0.1:${server.address().port}/`)
    await page.getByRole('status').filter({ hasText: '宿主暂时无法读取此会话记录。' }).waitFor({ timeout: 12000 })
    await page.getByRole('status').filter({ hasText: '执行期间宿主中断，尚未保存的实时输出可能缺失。' }).waitFor()
    assert.equal(calls, 1)
    release()
    await new Promise(resolve => setImmediate(resolve))
    await page.getByRole('button', { name: '刷新记录' }).click()
    await page.getByText('恢复后的记录').waitFor()
    assert.equal(calls, 2)
    assert.equal(closes, 2)
  } finally {
    release()
    await browser.close()
    await new Promise(resolve => server.close(resolve))
    rmSync(root, { recursive: true, force: true })
  }
})

test('run selection does not carry across requirements', async () => {
  const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')
  const marker = '    return {\n      inject:'
  const entry = `import React from 'react'; import {createRoot} from 'react-dom/client';
    window.__ModuleLoader__={load({factory}){factory(()=>React)}}; ${source.replace(marker, '    globalThis.TestPanel = RunObservationPanel;\n' + marker)}
    const root=createRoot(document.getElementById('root')); window.renderPanel=(id,run)=>root.render(React.createElement(globalThis.TestPanel,{root:'D:/test',item:{id,run:{id:run,status:'done'}},detail:{summaries:{run:{id:run,status:'done'}}}})); window.renderPanel('REQ-A','RUN-001');`
  const result = await build({ stdin: { contents: entry, resolveDir: fileURLToPath(new URL('../../../', import.meta.url)), loader: 'js' }, bundle: true, write: false, platform: 'browser', format: 'esm' })
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  await page.route('http://test.local/**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div><script type="module" src="/app.js"></script>' })
    if (url.pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: result.outputFiles[0].text })
    if (url.searchParams.get('mode') === 'history') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ runs: url.searchParams.get('requirementId') === 'REQ-A' ? [{ id: 'RUN-001' }, { id: 'RUN-002' }] : [{ id: 'RUN-003' }], next: null }) })
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, runId: url.searchParams.get('runId'), segment: Number(url.searchParams.get('segment') ?? 0), status: 'done', sessions: [], source: 'session-query', events: [], lastSeq: -1, next: null }) })
  })
  try {
    await page.goto('http://test.local/')
    await page.getByLabel('选择运行').selectOption('RUN-002')
    await page.evaluate(() => window.renderPanel('REQ-B', 'RUN-003'))
    await page.waitForFunction(() => !document.body.textContent.includes('RUN-002'))
    assert.equal(await page.getByLabel('选择运行').count(), 0)
  } finally { await browser.close() }
})

test('review usage reports a timed-out history request', async () => {
  const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')
  const marker = '    return {\n      inject:'
  assert.ok(source.includes(marker))
  const exposed = source.replace(marker, '    globalThis.ReviewUsage = ReviewUsage;\n' + marker)
  const entry = `import React from 'react'; import {createRoot} from 'react-dom/client';
    window.__ModuleLoader__={load({factory}){factory(()=>React)}}; ${exposed}
    const root=createRoot(document.getElementById('root')); window.renderReview=(id)=>root.render(React.createElement(globalThis.ReviewUsage, {root:'D:/test', requirementId:id})); window.renderReview('REQ-A');`
  const result = await build({ stdin: { contents: entry, resolveDir: fileURLToPath(new URL('../../../', import.meta.url)), loader: 'js' }, bundle: true, write: false, platform: 'browser', format: 'esm' })
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  await page.addInitScript(() => {
    const original = window.setTimeout
    window.setTimeout = (callback, delay, ...args) => original(callback, delay === 10000 ? 100 : delay, ...args)
    const originalFetch = window.fetch
    window.fetch = (url, options) => String(url).includes('mode=review-usage') && !window.releaseReview
      ? new Promise(resolve => { window.releaseReview = () => resolve(new Response(JSON.stringify({ records: [{ id: 'late' }] }), { status: 200 })) })
      : String(url).includes('requirementId=REQ-D')
        ? new Promise(resolve => { window.releaseNextReview = () => resolve(new Response(JSON.stringify({ records: [] }), { status: 200 })) })
      : originalFetch(url, options)
  })
  await page.route('http://test.local/**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div><script type="module" src="/app.js"></script>' })
    if (url.pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: result.outputFiles[0].text })
    assert.equal(url.searchParams.get('mode'), 'review-usage')
    if (url.searchParams.get('requirementId') === 'REQ-C') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ records: [{ id: 'old', status: 'completed', model: 'previous-model' }] }) })
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })
  try {
    await page.goto('http://test.local/')
    await page.getByRole('alert').getByText('评审调用记录暂不可用，请刷新需求详情重试。').waitFor()
    assert.equal(await page.getByText('正在读取评审调用记录…').count(), 0)
    await page.evaluate(() => window.releaseReview())
    assert.equal(await page.getByRole('alert').count(), 1)
    await page.evaluate(() => window.renderReview('REQ-C'))
    await page.getByText('最近评审调用记录').click()
    await page.getByText(/previous-model/).waitFor()
    await page.evaluate(() => window.renderReview('REQ-D'))
    await page.getByRole('status').getByText('正在读取评审调用记录…').waitFor()
    assert.equal(await page.getByText(/previous-model/).count(), 0)
    await page.evaluate(() => window.releaseNextReview())
    await page.evaluate(() => window.renderReview('REQ-B'))
    await page.getByRole('alert').getByText('评审调用记录暂不可用，请刷新需求详情重试。').waitFor()
    assert.equal(await page.getByText('正在读取评审调用记录…').count(), 0)
  } finally { await browser.close() }
})

test('live observation reports disconnection and recovers without losing recorded history', async () => {
  const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')
  const marker = '    return {\n      inject:'
  assert.ok(source.includes(marker))
  const exposed = source.replace(marker, '    globalThis.RunObservationPanel = RunObservationPanel;\n' + marker)
  const entry = `import React from 'react'; import {createRoot} from 'react-dom/client';
    window.__ModuleLoader__={load({factory}){factory(()=>React)}}; ${exposed}
    createRoot(document.getElementById('root')).render(React.createElement(globalThis.RunObservationPanel, {
      root:'D:/test', item:{id:'REQ-A',run:{id:'RUN-001',status:'running'}}, detail:{summaries:{run:{id:'RUN-001',status:'running'}}}
    }));`
  const result = await build({ stdin: { contents: entry, resolveDir: fileURLToPath(new URL('../../../', import.meta.url)), loader: 'js' }, bundle: true, write: false, platform: 'browser', format: 'esm' })
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  let liveRequests = 0
  let recordsUnavailable = false
  let recordsHang = false
  let usageHang = true
  let wrongUsageScope = false
  let missingUsageSource = false
  let wrongHistoryScope = null
  let invalidTerminalHistory = false
  let invalidEventText = false
  let invalidUnavailable = false
  let invalidSessions = false
  await page.addInitScript(() => {
    const original = window.setTimeout
    window.setTimeout = (callback, delay, ...args) => original(callback, delay === 10000 ? 100 : delay, ...args)
    const fetchOriginal = window.fetch
    let liveCalls = 0
    window.fetch = (input, init) => {
      if (String(input).includes('mode=live') && ++liveCalls === 2) {
        return new Promise(resolve => { window.releaseLive = () => resolve(new Response(JSON.stringify({ ok: true, live: { text: '过期实时内容' } }), { status: 200 })) })
      }
      if (String(input).includes('mode=history') && !window.releaseHistory) {
        return new Promise(resolve => { window.releaseHistory = () => resolve(new Response(JSON.stringify({ runs: [{ id: 'RUN-999' }], next: null }), { status: 200 })) })
      }
      if (String(input).includes('mode=usage') && !window.releaseUsage) {
        return new Promise(resolve => { window.releaseUsage = () => resolve(new Response(JSON.stringify({ usage: { status: 'available', inputTokens: 999 } }), { status: 200 })) })
      }
      if (window.hangRecords && String(input).includes('run-observation?') && !String(input).includes('mode=')) {
        window.hangRecords = false
        return new Promise(resolve => { window.releaseRecords = () => resolve(new Response(JSON.stringify({ ok: true, runId: 'RUN-001', segment: 0, source: 'session-query', sessions: [{ sessionId: 's' }], events: [{ sessionId: 's', seq: 2, kind: 'output', text: '过期历史' }], lastSeq: 2, prefixHash: 'a'.repeat(64), next: null }), { status: 200 })) })
      }
      return fetchOriginal(input, init)
    }
  })
  await page.route('http://test.local/**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div><script type="module" src="/app.js"></script>' })
    if (url.pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: result.outputFiles[0].text })
    if (url.searchParams.get('mode') === 'history') {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ runs: [{ id: 'RUN-001' }], next: null }) })
    }
    if (url.searchParams.get('mode') === 'usage') {
      if (usageHang) { await new Promise(resolve => setTimeout(resolve, 600)); return route.abort().catch(() => {}) }
      return route.fulfill({ json: { ok: true, requirementId: 'REQ-A', runId: wrongUsageScope ? 'RUN-999' : 'RUN-001', segment: 0, usage: { status: 'available', source: missingUsageSource ? null : 'billion-context', scope: 'session', inputTokens: 123, host: { cacheWriteTokens: 37 }, lastSeen: 'invalid' } } })
    }
    if (url.searchParams.get('mode') === 'live') {
      liveRequests++
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, runId: liveRequests === 2 ? 'RUN-999' : 'RUN-001', segment: 0, live: { text: liveRequests === 1 ? '首次实时内容' : liveRequests === 2 ? '错误运行片段' : '恢复后的实时内容', reasoning: '', truncated: false } }) })
    }
    if (wrongHistoryScope) return route.fulfill({ json: { ok: true, runId: wrongHistoryScope === 'run' ? 'RUN-999' : 'RUN-001', segment: wrongHistoryScope === 'segment' ? 1 : 0, status: 'done', historyChanged: true, events: [], source: 'session-query', next: null } })
    if (invalidTerminalHistory) { invalidTerminalHistory = false; return route.fulfill({ json: { ok: true, runId: 'RUN-001', segment: 0, status: 'done', source: 'session-query', sessions: [{ sessionId: 's' }], events: [{ sessionId: 'other', seq: 2, kind: 'output', text: '错误终态' }], lastSeq: 2, prefixHash: 'a'.repeat(64), next: null } }) }
    if (invalidEventText) { invalidEventText = false; return route.fulfill({ json: { ok: true, runId: 'RUN-001', segment: 0, status: 'done', source: 'session-query', sessions: [{ sessionId: 's' }], events: [{ sessionId: 's', seq: 2, kind: 'tool-call', text: null }], lastSeq: 2, prefixHash: 'a'.repeat(64), next: null } }) }
    if (invalidUnavailable) { invalidUnavailable = false; return route.fulfill({ json: { ok: true, runId: 'RUN-001', segment: 0, status: 'done', source: 'unavailable', sessions: [{ sessionId: 's' }], events: [null], next: null } }) }
    if (invalidSessions) { invalidSessions = false; return route.fulfill({ json: { ok: true, runId: 'RUN-001', segment: 0, status: 'done', source: 'unavailable', sessions: [null, null], events: [], next: null } }) }
    if (recordsUnavailable) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ runId: url.searchParams.get('runId'), segment: Number(url.searchParams.get('segment') ?? 0), ok: true, status: 'running', source: 'unavailable', sessions: [{ sessionId: 's' }], events: [], next: null }) })
    if (recordsHang) {
      await new Promise(resolve => setTimeout(resolve, 600))
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ runId: url.searchParams.get('runId'), segment: Number(url.searchParams.get('segment') ?? 0), ok: true, source: 'session-query', events: [] }) }).catch(() => {})
    }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ runId: url.searchParams.get('runId'), segment: Number(url.searchParams.get('segment') ?? 0), ok: true, status: 'running', source: 'session-query', sessions: [{ sessionId: 's' }], events: url.searchParams.has('after') ? [] : [{ sessionId: 's', seq: 1, kind: 'output', text: '已记录内容' }], lastSeq: 1, prefixHash: 'a'.repeat(64), next: null }) })
  })
  try {
    await page.goto('http://test.local/')
    await page.getByText('首次实时内容').waitFor()
    await page.getByText('已记录内容', { exact: true }).waitFor()
    for (const scope of ['run', 'segment']) {
      wrongHistoryScope = scope
      await page.getByRole('button', { name: '刷新记录' }).click()
      await page.getByRole('alert').getByText(/运行记录响应无效/).waitFor()
      assert.equal(await page.getByText('已经完成', { exact: true }).count(), 0)
      assert.equal(await page.getByText('记录已变化，重新核对尚未完成；下方是之前读取的内容。').count(), 0)
      wrongHistoryScope = null
      await page.getByRole('button', { name: '刷新记录' }).click()
      await page.getByText('已记录内容', { exact: true }).waitFor()
    }
    const historyError = page.getByRole('alert').filter({ hasText: '运行列表暂不可用' })
    await historyError.waitFor()
    await historyError.getByRole('button', { name: '重试' }).click()
    await historyError.waitFor({ state: 'hidden' })
    await page.evaluate(() => window.releaseHistory())
    assert.equal(await page.getByText('RUN-999').count(), 0)
    await page.getByRole('button', { name: '用量', exact: true }).click()
    await page.getByText('当前会话的 token、缓存和费用数据尚未确认归属，暂不可用。').waitFor()
    await page.evaluate(() => window.releaseUsage())
    assert.equal(await page.getByText('999', { exact: true }).count(), 0)
    usageHang = false
    wrongUsageScope = true
    await page.getByRole('button', { name: '刷新记录' }).click()
    await page.getByText('当前会话的 token、缓存和费用数据尚未确认归属，暂不可用。').waitFor()
    assert.equal(await page.getByText('123', { exact: true }).count(), 0)
    wrongUsageScope = false
    missingUsageSource = true
    await page.getByRole('button', { name: '刷新记录' }).click()
    await page.getByText('当前会话的 token、缓存和费用数据尚未确认归属，暂不可用。').waitFor()
    assert.equal(await page.getByText('123', { exact: true }).count(), 0)
    missingUsageSource = false
    await page.getByRole('button', { name: '刷新记录' }).click()
    await page.getByText('123', { exact: true }).waitFor()
    assert.equal(await page.getByText('宿主缓存写入 token').locator('xpath=following-sibling::dd[1]').textContent(), '37')
    assert.equal(await page.getByText(/代理会话最近活动：未知/).isVisible(), true)
    await page.getByRole('button', { name: '对话', exact: true }).click()
    recordsUnavailable = true
    await page.getByRole('status').getByText('实时连接暂不可用，正在自动重试；保留的实时片段可能已过期或与已保存记录重复。').waitFor({ timeout: 6000 })
    assert.equal(await page.getByText('已记录内容', { exact: true }).isVisible(), true)
    assert.equal(await page.getByText('首次实时内容').isVisible(), true)
    await page.waitForTimeout(2300)
    assert.equal(await page.getByText('错误运行片段').count(), 0)
    await page.getByText('恢复后的实时内容').waitFor({ timeout: 6000 })
    await page.evaluate(() => window.releaseLive())
    assert.equal(await page.getByText('实时连接暂不可用，正在自动重试；保留的实时片段可能已过期或与已保存记录重复。').count(), 0)
    assert.equal(await page.getByText('首次实时内容').count(), 0)
    assert.equal(await page.getByText('过期实时内容').count(), 0)
    assert.equal(await page.getByText('已记录内容', { exact: true }).count(), 1)
    await page.getByText('以下是上次成功读取的记录，可能不完整或已过期。').waitFor({ timeout: 6000 })
    recordsUnavailable = false
    await page.getByText('以下是上次成功读取的记录，可能不完整或已过期。').waitFor({ state: 'hidden', timeout: 6000 })
    invalidEventText = true
    await page.getByRole('alert').getByText(/运行记录响应无效/).waitFor({ timeout: 6000 })
    assert.equal(await page.getByText('已记录内容', { exact: true }).isVisible(), true)
    await page.getByRole('alert').getByText(/运行记录响应无效/).waitFor({ state: 'hidden', timeout: 6000 })
    invalidSessions = true
    await page.getByRole('alert').getByText(/运行记录响应无效/).waitFor({ timeout: 6000 })
    assert.equal(await page.getByText('已记录内容', { exact: true }).isVisible(), true)
    await page.getByRole('alert').getByText(/运行记录响应无效/).waitFor({ state: 'hidden', timeout: 6000 })
    invalidUnavailable = true
    await page.getByRole('alert').getByText(/运行记录响应无效/).waitFor({ timeout: 6000 })
    assert.equal(await page.getByText('已记录内容', { exact: true }).isVisible(), true)
    await page.getByRole('alert').getByText(/运行记录响应无效/).waitFor({ state: 'hidden', timeout: 6000 })
    await page.evaluate(() => { window.hangRecords = true })
    await page.getByRole('alert').getByText(/读取运行记录超时/).waitFor({ timeout: 6000 })
    assert.equal(await page.getByText('已记录内容', { exact: true }).isVisible(), true)
    await page.evaluate(() => window.releaseRecords())
    assert.equal(await page.getByText('过期历史').count(), 0)
    await page.getByRole('alert').getByText(/读取运行记录超时/).waitFor({ state: 'hidden', timeout: 6000 })
    invalidTerminalHistory = true
    await page.getByRole('alert').getByText(/运行记录响应无效/).waitFor({ timeout: 6000 })
    assert.equal(await page.getByText('错误终态').count(), 0)
    await page.getByRole('alert').getByText(/运行记录响应无效/).waitFor({ state: 'hidden', timeout: 6000 })
    assert.equal(await page.getByText('已记录内容', { exact: true }).isVisible(), true)
  } finally { await browser.close() }
})

test('truncated run text copies only loaded content and retries continuation', async () => {
  const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')
  const marker = '    return {\n      inject:'
  assert.ok(source.includes(marker))
  const exposed = source.replace(marker, '    globalThis.RunEventText = RunEventText;\n' + marker)
  const entry = `import React from 'react'; import {createRoot} from 'react-dom/client';
    window.__ModuleLoader__={load({factory}){factory(()=>React)}}; ${exposed}
    const root = createRoot(document.getElementById('root'));
    window.renderEvent = (hash, text, truncated) => root.render(React.createElement(globalThis.RunEventText, {
      key: 's:7:' + hash, entry:{sessionId:'s',seq:7,eventHash:hash,text,truncated}, field:'text', root:'D:/test', requirementId:'REQ-A', runId:'RUN-001', segment:0
    }));
    window.renderEvent('${'a'.repeat(64)}', '已脱敏的前半', true);`
  const result = await build({ stdin: { contents: entry, resolveDir: fileURLToPath(new URL('../../../', import.meta.url)), loader: 'js' }, bundle: true, write: false, platform: 'browser', format: 'esm' })
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  let attempts = 1
  await page.addInitScript(() => {
    window.copiedValues = []
    const original = window.setTimeout
    window.setTimeout = (callback, delay, ...args) => original(callback, delay === 10000 ? 100 : delay, ...args)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => { window.copiedValues.push(text) } } })
    const originalFetch = window.fetch
    let hang = true
    window.fetch = (url, options) => {
      if (hang && String(url).includes('eventSeq=')) {
        hang = false
        return new Promise(resolve => { window.releaseDetail = () => resolve({ ok: true, json: async () => ({ ok: true, detail: { text: '迟到内容', truncated: false } }) }) })
      }
      return originalFetch(url, options)
    }
  })
  await page.route('http://test.local/**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div><script type="module" src="/app.js"></script>' })
    if (url.pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: result.outputFiles[0].text })
    assert.equal(url.searchParams.get('eventSeq'), '7')
    assert.equal(url.searchParams.get('offset'), String('已脱敏的前半'.length))
    assert.equal(url.searchParams.get('eventHash'), 'a'.repeat(64))
    attempts++
    if (attempts === 2) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { message: '暂时不可用' } }) })
    if (attempts === 3) return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { message: '运行记录已变化，请刷新记录后重新读取' } }) })
    if (attempts === 4) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, offset: '已脱敏的前半'.length, detail: { sessionId: 's', seq: 7, eventHash: 'a'.repeat(64), text: '缺失截断标记' } }) })
    if (attempts === 5) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, offset: '已脱敏的前半'.length, detail: { sessionId: 'other', seq: 7, eventHash: 'a'.repeat(64), text: '其他会话续读', truncated: false } }) })
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, offset: '已脱敏的前半'.length, detail: { sessionId: 's', seq: 7, eventHash: 'a'.repeat(64), text: '和后半', truncated: false } }) })
  })
  try {
    await page.goto('http://test.local/')
    await page.getByText('内容已截断；复制仅包含已加载的内容。').waitFor()
    await page.getByRole('button', { name: '复制已加载内容' }).click()
    await page.getByRole('status').getByText('复制成功').waitFor()
    assert.deepEqual(await page.evaluate(() => window.copiedValues), ['已脱敏的前半'])
    await page.getByRole('button', { name: '加载后续内容' }).click()
    await page.getByRole('alert').getByText('读取完整内容超时；请重试。').waitFor()
    await page.evaluate(() => window.releaseDetail())
    assert.equal(await page.getByText('迟到内容').count(), 0)
    await page.getByRole('button', { name: '加载后续内容' }).click()
    await page.getByRole('alert').getByText('暂时不可用；请重试。').waitFor()
    await page.getByRole('button', { name: '加载后续内容' }).click()
    await page.getByRole('alert').getByText('运行记录已变化，请刷新记录后重新读取。').waitFor()
    assert.equal(await page.getByText('已脱敏的前半').isVisible(), true)
    await page.getByRole('button', { name: '加载后续内容' }).click()
    await page.getByRole('alert').getByText('续读内容不完整或已变化，请刷新记录后重试。').waitFor()
    assert.equal(await page.getByText('缺失截断标记').count(), 0)
    const wrongSessionResponse = page.waitForResponse(response => response.url().includes('eventSeq=7') && response.status() === 200)
    await page.getByRole('button', { name: '加载后续内容' }).click()
    await wrongSessionResponse
    assert.equal(await page.getByText('其他会话续读').count(), 0)
    await page.getByRole('button', { name: '加载后续内容' }).click()
    await page.getByText('已脱敏的前半和后半').waitFor()
    assert.equal(await page.getByText('内容已截断；复制仅包含已加载的内容。').count(), 0)
    assert.equal(await page.getByRole('alert').count(), 0)
    await page.getByRole('button', { name: '复制内容' }).click()
    assert.deepEqual(await page.evaluate(() => window.copiedValues), ['已脱敏的前半', '已脱敏的前半和后半'])
    assert.equal(attempts, 6)
    await page.evaluate(() => window.renderEvent('b'.repeat(64), '更新后的事件', false))
    await page.getByText('更新后的事件').waitFor()
    assert.equal(await page.getByText('已脱敏的前半和后半').count(), 0)
  } finally { await browser.close() }
})

test('run observation renders scoped conversation, trace, pagination and unknown usage', async () => {
  const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')
  const marker = '    return {\n      inject:'
  assert.ok(source.includes(marker))
  const exposed = source.replace(marker, '    globalThis.RunObservationPanel = RunObservationPanel; globalThis.ReviewUsage = ReviewUsage;\n' + marker)
  const entry = `import React from 'react'; import {createRoot} from 'react-dom/client';
    window.__ModuleLoader__={load({factory}){factory(()=>React)}}; ${exposed}
    createRoot(document.getElementById('root')).render(React.createElement(React.Fragment, null, React.createElement(globalThis.RunObservationPanel, {
      root:'D:/test', item:{id:'REQ-A',run:{id:'RUN-001',status:'running'}}, detail:{summaries:{run:{id:'RUN-001',status:'running'}}}, onOpenSession: id => { if (window.deferOpenSession) return new Promise((_, reject) => { window.rejectOpenSession = reject }); if (window.failOpenSession) return Promise.reject(new Error('host navigation unavailable')); window.openedSession = id }
    }), React.createElement(globalThis.ReviewUsage, { root: 'D:/test', requirementId: 'REQ-A' })));`
  const result = await build({ stdin: { contents: entry, resolveDir: fileURLToPath(new URL('../../../', import.meta.url)), loader: 'js' }, bundle: true, write: false, platform: 'browser', format: 'esm' })
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 320, height: 640 } })
  const errors = []
  let usageAvailable = false
  let savedUsd = 0.42
  let estimatedCostUsd = null
  let costUsesCurrentRates = true
  let modelSwitches = 1
  let failedPage = false
  let unavailablePage = true
  let wrongSessionPage = true
  let missingHashPage = true
  let reviewUnavailable = false
  let historyUnavailable = false
  let repeatedHistoryCursor = true
  let corruptSession = false
  let changeHistory = false
  let replayed = false
  let replayUnavailable = true
  let finishRun = false
  let releaseNextRun
  const nextRunGate = new Promise(resolve => { releaseNextRun = resolve })
  let releaseSegment
  const segmentGate = new Promise(resolve => { releaseSegment = resolve })
  const runRequests = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('http://test.local/**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;background:#0f1115;color:#f2f4f7;font:14px sans-serif"><main style="max-width:1000px;margin:auto;padding:24px"><div id="root"></div></main><script type="module" src="/app.js"></script>' })
    if (url.pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: result.outputFiles[0].text })
    assert.equal(url.searchParams.get('requirementId'), 'REQ-A')
    if (url.searchParams.get('mode') === 'history') return historyUnavailable
      ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false }) })
      : route.fulfill({ contentType: 'application/json', body: JSON.stringify(url.searchParams.has('before')
        ? { ok: true, runs: [{ id: 'RUN-001' }, { id: 'RUN-000' }], next: repeatedHistoryCursor ? 'older' : null }
        : { ok: true, runs: [{ id: 'RUN-002' }, { id: 'RUN-001' }], next: 'older' }) })
    if (url.searchParams.get('mode') === 'review-usage') return reviewUnavailable
      ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false }) })
      : route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, records: [{ id: 'failure', status: 'failed', finishedAt: '2026-11-05T00:00:00Z', provider: 'test-provider', model: 'test-model', usage: { inputTokens: 42, outputTokens: 3 } }] }) })
    const runId = url.searchParams.get('runId')
    runRequests.push({ runId, segment: url.searchParams.get('segment') })
    if (corruptSession && !url.searchParams.get('mode')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ runId: url.searchParams.get('runId'), segment: Number(url.searchParams.get('segment') ?? 0), ok: true, sessions: [{ sessionId: 's' }], source: 'corrupt', events: [], next: null }) })
    if (runId === 'RUN-002') {
      await nextRunGate
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ runId: url.searchParams.get('runId'), segment: Number(url.searchParams.get('segment') ?? 0), ok: true, sessions: [{ sessionId: 'other' }], sessionHistoryComplete: true, source: 'session-query', events: [{ sessionId: 'other', seq: 0, kind: 'output', text: '另一轮记录' }], lastSeq: 0, prefixHash: 'a'.repeat(64), next: null }) })
    }
    assert.equal(runId, 'RUN-001')
    if (url.searchParams.get('mode') === 'live') return route.fulfill({ json: { ok: true, runId, segment: Number(url.searchParams.get('segment')), live: { text: '正在生成', reasoning: '实时摘要', truncated: false } } })
    if (!url.searchParams.get('mode') && url.searchParams.get('segment') === '1') await segmentGate
    if (!url.searchParams.get('mode') && url.searchParams.get('segment') === '1') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ runId: url.searchParams.get('runId'), segment: Number(url.searchParams.get('segment') ?? 0), ok: true, status: 'done', sessions: [{ sessionId: 's' }, { sessionId: 's2', reason: 'resume' }], source: 'session-query', events: [{ sessionId: 's2', seq: 1, kind: 'output', text: '已经完成' }], lastSeq: 1, prefixHash: 'a'.repeat(64), next: null }) })
    if (url.searchParams.get('mode') === 'usage') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, requirementId: url.searchParams.get('requirementId'), runId, segment: Number(url.searchParams.get('segment')), usage: usageAvailable ? { status: 'available', source: 'billion-context', scope: 'session', directChildren: 2, foldCount: 3, inputTokens: 100, cachedTokens: 80, savedUsd, estimatedCostUsd, aggregate: { estimatedCostUsd }, costUsesCurrentRates, modelSwitches, coverage: { matched: 2, total: 2, historyComplete: true, duplicateSessions: 1 } } : { status: 'unknown', directChildren: 1 } }) })
    const after = url.searchParams.get('after')
    if (!url.searchParams.get('mode') && after === '2' && changeHistory && !replayed) {
      assert.equal(url.searchParams.get('prefixHash'), 'a'.repeat(64))
      replayed = true
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ runId: url.searchParams.get('runId'), segment: Number(url.searchParams.get('segment') ?? 0), ok: true, historyChanged: true }) })
    }
    if (!url.searchParams.get('mode') && after === '0' && replayed && replayUnavailable) {
      replayUnavailable = false
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ runId: url.searchParams.get('runId'), segment: Number(url.searchParams.get('segment') ?? 0), ok: true, source: 'unavailable', sessions: [{ sessionId: 's' }], events: [], next: null }) })
    }
    if (!url.searchParams.get('mode') && !after && replayed && url.searchParams.get('segment') !== '1') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ runId: url.searchParams.get('runId'), segment: Number(url.searchParams.get('segment') ?? 0), ok: true, status: 'running', sessions: [{ sessionId: 's' }, { sessionId: 's2', reason: 'resume' }], sessionHistoryComplete: true, source: 'session-query', events: [{ sessionId: 's', seq: 0, kind: 'output', text: '迟到的记录' }], lastSeq: 0, prefixHash: 'c'.repeat(64), next: { segment: 0, after: 0 } }) })
    if (!url.searchParams.get('mode') && after === '0' && replayed) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ runId: url.searchParams.get('runId'), segment: Number(url.searchParams.get('segment') ?? 0), ok: true, status: finishRun ? 'done' : 'running', sessions: [{ sessionId: 's' }, { sessionId: 's2', reason: 'resume' }], sessionHistoryComplete: true, source: 'session-query', events: [{ sessionId: 's', seq: 1, kind: 'output', text: '已经完成' }, { sessionId: 's', seq: 2, kind: 'tool-call', name: 'read', text: 'src/a' }], lastSeq: 2, prefixHash: 'b'.repeat(64), next: null }) })
    if (!url.searchParams.get('mode') && after === '2') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ runId: url.searchParams.get('runId'), segment: Number(url.searchParams.get('segment') ?? 0), ok: true, status: finishRun ? 'done' : 'running', sessions: [{ sessionId: 's' }, { sessionId: 's2', reason: 'resume' }], source: 'session-query', events: [], lastSeq: 2, prefixHash: 'b'.repeat(64), next: null }) })
    if (after && unavailablePage) {
      unavailablePage = false
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ runId: url.searchParams.get('runId'), segment: Number(url.searchParams.get('segment') ?? 0), ok: true, source: 'unavailable', sessions: [{ sessionId: 's' }], events: [], next: null }) })
    }
    if (after && wrongSessionPage) {
      wrongSessionPage = false
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ runId: url.searchParams.get('runId'), segment: Number(url.searchParams.get('segment') ?? 0), ok: true, source: 'session-query', sessions: [{ sessionId: 's' }], events: [{ sessionId: 'other', seq: 2, kind: 'output', text: '其他会话内容' }], lastSeq: 2, next: null }) })
    }
    if (after && !failedPage) {
      failedPage = true
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ runId: url.searchParams.get('runId'), segment: Number(url.searchParams.get('segment') ?? 0), ok: true, source: 'session-query', events: [{ sessionId: 's', seq: 2, kind: 'tool-call', text: '不应显示' }], lastSeq: 99, next: null }) })
    }
    if (after && missingHashPage) {
      missingHashPage = false
      assert.equal(url.searchParams.get('prefixHash'), 'a'.repeat(64))
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ runId: url.searchParams.get('runId'), segment: Number(url.searchParams.get('segment') ?? 0), ok: true, source: 'session-query', sessions: [{ sessionId: 's' }], events: [{ sessionId: 's', seq: 2, kind: 'tool-result', text: '缺少校验值的内容' }], lastSeq: 2, next: null }) })
    }
    const events = after ? [{ sessionId: 's', seq: 2, kind: 'tool-result', name: 'read', text: 'src/a', status: 'completed', nonTextBlocks: 1 }] : [{ sessionId: 's', seq: 1, kind: 'output', text: '已经完成', reasoning: '可见摘要' }]
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ runId: url.searchParams.get('runId'), segment: Number(url.searchParams.get('segment') ?? 0), ok: true, status: finishRun ? 'done' : 'running', sessions: [{ sessionId: 's', reason: 'start', startedAt: '2026-11-05T00:00:00Z', requirementRevision: 3 }, { sessionId: 's2', reason: 'resume' }], sessionHistoryComplete: true, source: 'session-query', events, live: after ? null : { text: '正在生成', reasoning: '实时摘要' }, lastSeq: after ? 2 : 1, prefixHash: 'a'.repeat(64), next: after ? null : { segment: 0, after: 1 } }) })
  })
  try {
    await page.goto('http://test.local/')
    await page.getByText('已经完成').waitFor()
    await page.getByText('最近评审调用记录').click()
    assert.equal(await page.getByText(/失败.*test-provider.*未缓存输入 42/).isVisible(), true)
    await page.getByText('正在生成').waitFor()
    assert.equal(await page.getByText(/第 1 段 · 初始会话 · 来源 未知 · 开始 .* · 结束 未知 · 需求版本 v3/).isVisible(), true)
    await page.getByRole('button', { name: '加载更多运行选项' }).click()
    await page.getByRole('alert').filter({ hasText: '运行列表暂不可用。' }).waitFor()
    assert.equal(await page.getByRole('option', { name: 'RUN-001', exact: true }).count(), 1)
    repeatedHistoryCursor = false
    await page.getByRole('alert').filter({ hasText: '运行列表暂不可用。' }).getByRole('button', { name: '重试' }).click()
    await page.getByRole('option', { name: 'RUN-000' }).waitFor({ state: 'attached' })
    assert.equal(await page.getByRole('option', { name: 'RUN-001', exact: true }).count(), 1)
    await page.getByRole('button', { name: '在 DSH 中打开会话' }).click()
    await page.waitForFunction(() => window.openedSession === 's')
    await page.evaluate(() => { window.failOpenSession = true })
    await page.getByRole('button', { name: '在 DSH 中打开会话' }).click()
    await page.getByRole('alert').getByText('host navigation unavailable').waitFor()
    assert.equal(await page.getByText('已经完成').isVisible(), true)
    await page.getByText('模型提供的推理内容').click()
    assert.equal(await page.getByText('可见摘要').isVisible(), true)
    await page.getByRole('button', { name: '加载更多记录' }).click()
    await page.getByText('宿主暂时无法读取此会话记录。').waitFor()
    assert.equal(await page.getByText('已经完成').count(), 1)
    assert.equal(await page.getByRole('button', { name: '加载更多记录' }).isVisible(), true)
    await page.getByRole('button', { name: '加载更多记录' }).click()
    await page.getByRole('alert').getByText(/运行记录响应无效/).waitFor()
    assert.equal(await page.getByText('其他会话内容').count(), 0)
    const invalidPageResponse = page.waitForResponse(response => response.url().includes('after=1') && response.status() === 200)
    await page.getByRole('button', { name: '加载更多记录' }).click()
    await invalidPageResponse
    await page.getByRole('alert').getByText(/运行记录响应无效/).waitFor()
    assert.equal(await page.getByText('已经完成').count(), 1)
    assert.equal(await page.getByText('不应显示').count(), 0)
    const missingHashResponse = page.waitForResponse(response => response.url().includes('after=1') && response.status() === 200)
    await page.getByRole('button', { name: '加载更多记录' }).click()
    await missingHashResponse
    await page.getByRole('alert').getByText(/运行记录响应无效/).waitFor()
    assert.equal(await page.getByText('缺少校验值的内容').count(), 0)
    await page.getByRole('button', { name: '轨迹', exact: true }).click()
    const toolResult = page.locator('article').filter({ hasText: '工具结果' })
    await toolResult.locator('summary').waitFor({ timeout: 8000 })
    assert.equal(await toolResult.locator('details').evaluate(node => node.open), false)
    await toolResult.locator('summary').click()
    assert.equal(await toolResult.getByText('src/a', { exact: true }).isVisible(), true)
    assert.equal(await page.getByText('缺少校验值的内容').count(), 0)
    assert.equal(await page.getByText('包含 1 项非文本内容，当前未展示。').isVisible(), true)
    changeHistory = true
    await page.getByRole('button', { name: '对话', exact: true }).click()
    await page.getByText('宿主暂时无法读取此会话记录。').waitFor({ timeout: 8000 })
    assert.equal(await page.getByText('已经完成').isVisible(), true)
    assert.equal(await page.getByText('迟到的记录').count(), 0)
    assert.equal(await page.getByRole('status').getByText('记录已变化，重新核对尚未完成；下方是之前读取的内容。').isVisible(), true)
    await page.getByRole('button', { name: '加载更多记录' }).click()
    await page.getByText('迟到的记录').waitFor({ timeout: 8000 })
    assert.equal(await page.getByText('此回复没有可显示的推理内容。').count(), 2)
    assert.equal(await page.getByText('已经完成').count(), 1)
    finishRun = true
    await page.waitForFunction(() => !document.querySelector('[data-run-observation]')?.textContent.includes('自动更新'), null, { timeout: 8000 })
    assert.equal(await page.getByText('运行状态：结束').isVisible(), true)
    await page.waitForSelector('[data-live-attempt]', { state: 'detached' })
    assert.equal(await page.getByRole('alert').count(), 0)
    await page.getByRole('button', { name: '回到最新' }).click()
    assert.equal(await page.getByLabel('运行记录末尾').evaluate(node => document.activeElement === node), true)
    await page.getByRole('button', { name: '用量', exact: true }).click()
    await page.getByText(/尚未确认归属/).waitFor()
    assert.equal(await page.getByText(/当前会话登记的直接子任务：1 个；子任务用量未计入/).isVisible(), true)
    usageAvailable = true
    await page.getByRole('button', { name: '对话', exact: true }).click()
    await page.getByRole('button', { name: '用量', exact: true }).click()
    await page.getByText('100', { exact: true }).waitFor()
    assert.equal(await page.getByText('当前会话段的代理压缩记录：3 次；未包含无法归属的压缩调用。').isVisible(), true)
    assert.equal(await page.getByText('费用来源：未知；历史价格版本：未知。').isVisible(), true)
    assert.equal(await page.getByText('代理会话最近活动：未知；不代表账单更新时间。').isVisible(), true)
    assert.equal(await page.getByText(/当前会话登记的直接子任务：2 个；子任务用量未计入/).isVisible(), true)
    assert.equal(await page.getByText('上下文节省估算 token').isVisible(), true)
    assert.equal(await page.getByText('宿主缓存写入 token').locator('xpath=following-sibling::dd[1]').textContent(), '未知')
    assert.equal(await page.getByText('80', { exact: true }).isVisible(), true)
    assert.equal(await page.getByRole('alert').getByText(/会话记录包含重复编号/).isVisible(), true)
    assert.equal(await page.getByText('本运行主会话合计').count(), 0)
    assert.equal(await page.getByRole('alert').getByText(/本会话切换过模型/).isVisible(), true)
    modelSwitches = null
    await page.getByRole('button', { name: '对话', exact: true }).click()
    await page.getByRole('button', { name: '用量', exact: true }).click()
    await page.getByRole('alert').getByText(/模型切换记录不可用/).waitFor()
    await page.getByText(/上下文节省估算：.*0\.42.*代理估算/).waitFor()
    assert.equal(await page.getByText(/上下文节省估算：.*0\.42.*代理估算/).isVisible(), true)
    assert.equal(await page.getByText(/采用当前或配置费率，可能不反映历史模型与价格/).isVisible(), true)
    savedUsd = -0.25
    await page.getByRole('button', { name: '对话', exact: true }).click()
    await page.getByRole('button', { name: '用量', exact: true }).click()
    await page.getByText(/上下文节省估算：-.*0\.25/).waitFor()
    savedUsd = -0.00001
    estimatedCostUsd = 0.00001
    await page.getByRole('button', { name: '对话', exact: true }).click()
    await page.getByRole('button', { name: '用量', exact: true }).click()
    await page.getByText(/上下文节省估算：大于 -US\$0\.0001 且小于 0/).waitFor()
    assert.equal(await page.getByText('费用来源：代理按当前费率估算；历史价格版本：未知。').isVisible(), true)
    costUsesCurrentRates = null
    await page.getByRole('button', { name: '对话', exact: true }).click()
    await page.getByRole('button', { name: '用量', exact: true }).click()
    await page.getByText('费用来源：未知；历史价格版本：未知。').waitFor()
    costUsesCurrentRates = false
    await page.getByRole('button', { name: '对话', exact: true }).click()
    await page.getByRole('button', { name: '用量', exact: true }).click()
    await page.getByText('费用来源：代理记录；历史价格版本：未知。').waitFor()
    assert.equal(await page.getByText('大于 0 且小于 US$0.0001', { exact: true }).isVisible(), true)
    assert.equal(await page.getByText('费用估算 大于 0 且小于 US$0.0001', { exact: true }).count(), 0)
    savedUsd = 0
    estimatedCostUsd = 0
    await page.getByRole('button', { name: '对话', exact: true }).click()
    await page.getByRole('button', { name: '用量', exact: true }).click()
    await page.getByText(/上下文节省估算：[^0]*0\.00/).waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.setViewportSize({ width: 240, height: 640 })
    const overflow = await page.evaluate(() => [...document.querySelectorAll('*')].filter(element => element.getBoundingClientRect().right > innerWidth + 1).map(element => ({ tag: element.tagName, text: element.textContent.slice(0, 60), width: Math.round(element.getBoundingClientRect().width), right: Math.round(element.getBoundingClientRect().right) })).slice(-12))
    assert.deepEqual(overflow, [])
    if (process.env.DSH_OBSERVATION_NARROW_SCREENSHOT) await page.screenshot({ path: process.env.DSH_OBSERVATION_NARROW_SCREENSHOT, fullPage: true })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByRole('button', { name: '对话', exact: true }).click()
    assert.equal(await page.getByText('已经完成').isVisible(), true)
    await page.evaluate(() => { window.failOpenSession = false; window.deferOpenSession = true })
    await page.getByRole('button', { name: '在 DSH 中打开会话' }).click()
    await page.waitForFunction(() => typeof window.rejectOpenSession === 'function')
    await page.getByLabel('选择会话').focus()
    await page.getByLabel('选择会话').selectOption('1')
    assert.equal(await page.getByLabel('选择会话').evaluate(element => element === document.activeElement), true)
    assert.equal(await page.getByText('已经完成').count(), 0)
    assert.equal(await page.getByRole('button', { name: '在 DSH 中打开会话' }).count(), 0)
    releaseSegment()
    await page.getByText('已经完成').waitFor()
    await page.evaluate(() => window.rejectOpenSession(new Error('旧会话跳转失败')))
    assert.equal(await page.getByText('旧会话跳转失败').count(), 0)
    await page.getByRole('button', { name: '用量', exact: true }).click()
    await page.getByText('100', { exact: true }).waitFor()
    await page.getByLabel('选择运行').selectOption('RUN-002')
    assert.equal(await page.getByText('100', { exact: true }).count(), 0)
    assert.equal(await page.getByText('已经完成').count(), 0)
    assert.equal(await page.getByRole('button', { name: '在 DSH 中打开会话' }).count(), 0)
    releaseNextRun()
    await page.getByRole('button', { name: '对话', exact: true }).click()
    await page.getByText('另一轮记录').waitFor()
    assert.equal(runRequests.some(request => request.runId === 'RUN-002' && request.segment !== '0'), false)
    if (process.env.DSH_OBSERVATION_SCREENSHOT) await page.screenshot({ path: process.env.DSH_OBSERVATION_SCREENSHOT })
    reviewUnavailable = true
    await page.reload()
    await page.getByRole('alert').getByText('评审调用记录暂不可用，请刷新需求详情重试。').waitFor()
    historyUnavailable = true
    await page.reload()
    const listError = page.getByRole('alert').filter({ hasText: '运行列表暂不可用' })
    await listError.waitFor()
    historyUnavailable = false
    await listError.getByRole('button', { name: '重试' }).click()
    await listError.waitFor({ state: 'hidden' })
    corruptSession = true
    await page.reload()
    await page.getByRole('alert').getByText(/宿主报告记录损坏/).waitFor()
    assert.equal(await page.getByText('此会话暂无可显示的记录。').count(), 0)
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})

test('closed requirements keep waiting runs read-only and do not poll', async () => {
  const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')
  const marker = '    return {\n      inject:'
  const exposed = source.replace(marker, '    globalThis.RunObservationPanel = RunObservationPanel;\n' + marker)
  const entry = `import React from 'react'; import {createRoot} from 'react-dom/client';
    window.__ModuleLoader__={load({factory}){factory(()=>React)}}; ${exposed}
    createRoot(document.getElementById('root')).render(React.createElement(globalThis.RunObservationPanel, {
      root:'D:/test', item:{id:'REQ-CLOSED',closed:true,run:{id:'RUN-CLOSED',status:'waiting-input'}}, detail:{summaries:{delivery:{key:'closed'},run:{id:'RUN-CLOSED',status:'waiting-input'}}}
    }));`
  const result = await build({ stdin: { contents: entry, resolveDir: fileURLToPath(new URL('../../../', import.meta.url)), loader: 'js' }, bundle: true, write: false, platform: 'browser', format: 'esm' })
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  let observationRequests = 0
  await page.route('http://test.local/**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div><script type="module" src="/app.js"></script>' })
    if (url.pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: result.outputFiles[0].text })
    if (url.searchParams.get('mode') === 'history') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ runs: [{ id: 'RUN-CLOSED' }], next: null }) })
    observationRequests++
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ runId: url.searchParams.get('runId'), segment: Number(url.searchParams.get('segment') ?? 0), ok: true, status: 'waiting-input', source: 'session-query', sessions: [{ sessionId: 'closed-session' }], events: [], lastSeq: -1, next: null }) })
  })
  try {
    await page.goto('http://test.local/')
    await page.getByText('关联运行状态：等待输入（需求已关闭，历史只读）').waitFor()
    await page.waitForTimeout(1100)
    assert.equal(observationRequests, 1)
    assert.equal(await page.getByText('自动更新').count(), 0)
  } finally { await browser.close() }
})

test('large run histories retain all events while deferring offscreen rendering', async () => {
  const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')
  const marker = '    return {\n      inject:'
  const exposed = source.replace(marker, '    globalThis.RunObservationPanel = RunObservationPanel;\n' + marker)
  const entry = `import React from 'react'; import {createRoot} from 'react-dom/client';
    window.__ModuleLoader__={load({factory}){factory(()=>React)}}; ${exposed}
    createRoot(document.getElementById('root')).render(React.createElement(globalThis.RunObservationPanel, {
      root:'D:/test', item:{id:'REQ-LARGE',run:{id:'RUN-LARGE',status:'done'}}, detail:{summaries:{run:{id:'RUN-LARGE',status:'done'}}}
    }));`
  const result = await build({ stdin: { contents: entry, resolveDir: fileURLToPath(new URL('../../../', import.meta.url)), loader: 'js' }, bundle: true, write: false, platform: 'browser', format: 'esm' })
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 800, height: 700 } })
  await page.route('http://test.local/**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/app.js"></script>' })
    if (url.pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: result.outputFiles[0].text })
    if (url.searchParams.get('mode') === 'history') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ runs: [{ id: 'RUN-LARGE' }], next: null }) })
    const after = Number(url.searchParams.get('after') ?? -1)
    const start = after + 1
    const end = Math.min(start + 50, 1000)
    const events = Array.from({ length: end - start }, (_, index) => {
      const seq = start + index
      return { sessionId: 'large-session', seq, kind: 'output', text: `event-${seq}` }
    })
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ runId: url.searchParams.get('runId'), segment: Number(url.searchParams.get('segment') ?? 0), ok: true, status: 'done', sessions: [{ sessionId: 'large-session' }], sessionHistoryComplete: true, source: 'session-query', events, lastSeq: end - 1, prefixHash: 'a'.repeat(64), next: end < 1000 ? { segment: 0, after: end - 1 } : null }) })
  })
  try {
    await page.goto('http://test.local/')
    await page.getByText('event-49').waitFor()
    for (let pageIndex = 1; pageIndex < 20; pageIndex++) {
      await page.getByRole('button', { name: '加载更多记录' }).click()
      await page.getByText(`event-${(pageIndex + 1) * 50 - 1}`).waitFor()
    }
    const metrics = await page.locator('[data-run-observation] article').evaluateAll(articles => ({
      count: articles.length,
      virtualizedStyles: articles.filter(article => {
        const style = getComputedStyle(article)
        return style.contentVisibility === 'auto' && style.containIntrinsicSize.includes('120px')
      }).length,
      scrollHeight: document.documentElement.scrollHeight,
      scrollWidth: document.documentElement.scrollWidth,
    }))
    assert.equal(metrics.count, 1000)
    assert.equal(metrics.virtualizedStyles, 1000)
    assert.ok(metrics.scrollHeight > 700)
    assert.equal(metrics.scrollWidth <= 800, true)
    await page.locator('[data-run-observation] article').last().scrollIntoViewIfNeeded()
    assert.equal(await page.getByText('event-999').isVisible(), true)
  } finally { await browser.close() }
})

test('conversation and trace projections remove host noise and pair readable engineering actions', async () => {
  const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')
  const marker = '    return {\n      inject:'
  assert.ok(source.includes(marker))
  const exposed = source.replace(marker, '    globalThis.projectRunView = projectRunView;\n' + marker)
  const entry = `import React from 'react'; window.__ModuleLoader__={load({factory}){factory(()=>React)}}; ${exposed}`
  const bundle = await build({ stdin: { contents: entry, resolveDir: fileURLToPath(new URL('../../../', import.meta.url)), loader: 'js' }, bundle: true, write: false, platform: 'browser', format: 'iife' })
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setContent('<main></main>')
    await page.addScriptTag({ content: bundle.outputFiles[0].text })
    const projection = await page.evaluate(() => globalThis.projectRunView([
      { sessionId: 's', seq: 0, kind: 'input', text: '<system-reminder>Instructions from: AGENTS.md</system-reminder>' },
      { sessionId: 's', seq: 1, kind: 'input', text: 'Time sampled while preparing turn 1. Browser time zone: Asia/Shanghai' },
      { sessionId: 's', seq: 2, kind: 'input', text: '[MNEMON] Search Documents' },
      { sessionId: 's', seq: 3, kind: 'input', text: 'MNEMON RUNTIME MEMORY SNAPSHOT <runtime-memory-file name="USER.md">private</runtime-memory-file>' },
      { sessionId: 's', seq: 4, kind: 'input', text: '# 需求交付任务：REQ-ALM-011\\n完整需求正文' },
      { sessionId: 's', seq: 5, kind: 'output', text: '已完成代码实现与验证。' },
      { sessionId: 's', seq: 6, kind: 'other', name: 'sandbox/mode', text: '' },
      { sessionId: 's', seq: 7, kind: 'tool-call', callId: 'patch-1', name: 'apply_patch', text: '{"path":"packages/dsh-plugin-requirements/client-source.js"}' },
      { sessionId: 's', seq: 8, kind: 'tool-result', callId: 'patch-1', name: 'apply_patch', status: 'completed', text: 'Done' },
      { sessionId: 's', seq: 9, kind: 'tool-call', callId: 'skill-1', name: 'skill', text: '{"name":"alm-mvp-dev"}' },
      { sessionId: 's', seq: 10, kind: 'tool-result', callId: 'skill-1', name: 'skill', status: 'completed', text: '<skill_content name="alm-mvp-dev">说明</skill_content>' },
      { sessionId: 's', seq: 11, kind: 'output', text: '   ', reasoning: '' },
      { sessionId: 's', seq: 12, kind: 'input', text: 'Team message from req011-audit:\n- 需要补齐范围越界的验收说明\n- intent.mjs:848-889 仅供内部定位' },
    ]))
    assert.deepEqual(projection.conversation.map(row => row.kind), ['dispatch', 'outcome'])
    assert.equal(projection.conversation.at(-1).entry.text, '已完成代码实现与验证。')
    assert.equal(projection.systemEvents.length, 5)
    assert.deepEqual(projection.actions.map(action => action.title), [
      '修改文件：packages/dsh-plugin-requirements/client-source.js',
      '加载开发技能：alm-mvp-dev',
    ])
    assert.deepEqual(projection.actions.map(action => action.status), ['completed', 'completed'])
    assert.match(source, /data-run-dispatch/)
    assert.match(source, /data-engineering-action/)
    assert.match(source, /底层系统事件/)
    assert.doesNotMatch(source, /加载更多记录/)
  } finally { await browser.close() }
})

test('stage outcome cards preserve complete Markdown items and hide superseded host blocks', async () => {
  const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')
  const marker = '    return {\n      inject:'
  assert.ok(source.includes(marker))
  const exposed = source.replace(marker, '    globalThis.TestOutcomeCard = OutcomeSummaryCard;\n' + marker)
  const report = [
    '### 本次完成',
    '- 已更新 [需求正文](requirements/REQ-ALM-012.sdoc) 并完成 **手动标题保护**。',
    '### 验证结果',
    '- `node --test matcher.test.mjs`：**3/3 通过**。',
    '```powershell',
    'node --test matcher.test.mjs',
    '```',
    '### 阻塞',
    'Error: spawn EPERM',
  ].join('\n')
  const entry = `import React from 'react'; import {createRoot} from 'react-dom/client';
    window.__ModuleLoader__={load({factory}){factory(()=>React)}}; ${exposed}
    createRoot(document.getElementById('root')).render(React.createElement(globalThis.TestOutcomeCard,{entry:{sessionId:'s',seq:1,text:${JSON.stringify(report)}},root:'D:/test',requirementId:'REQ-A',runId:'RUN-001',segment:0,hasCurrentCandidate:true}));`
  const bundle = await build({ stdin: { contents: entry, resolveDir: fileURLToPath(new URL('../../../', import.meta.url)), loader: 'js' }, bundle: true, write: false, platform: 'browser', format: 'esm' })
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  try {
    await page.setContent('<div id="root"></div>')
    await page.addScriptTag({ type: 'module', content: bundle.outputFiles[0].text })
    await page.getByText('本轮完成要点').waitFor()
    const visible = await page.locator('[data-run-outcome-summary]').innerText()
    assert.match(visible, /需求正文/)
    assert.match(visible, /手动标题保护/)
    assert.match(visible, /3\/3 通过/)
    assert.doesNotMatch(visible, /###|```|spawn EPERM|阻塞/)
    assert.equal(await page.locator('[data-run-outcome-summary] strong').filter({ hasText: '手动标题保护' }).count(), 1)
    assert.equal(await page.locator('[data-run-outcome-summary] code').filter({ hasText: 'node --test matcher.test.mjs' }).count(), 1)
    assert.equal(await page.getByText('查看完整原始汇报').count(), 1)
    assert.doesNotMatch(source, /\.slice\(-700\)/)
    assert.doesNotMatch(source, /查看完整验收标准对比/)
  } finally { await browser.close() }
})
