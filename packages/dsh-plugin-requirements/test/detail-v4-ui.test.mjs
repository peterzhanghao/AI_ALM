import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { collectedTimelinePage, deriveDetailView } from '../detail-view.mjs'

test('legacy detail tabs link to the active panel while navigating by keyboard', async () => {
  const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')
  const marker = '    return {\n      inject:'
  const entry = `import React from 'react'; import {createRoot} from 'react-dom/client'; window.__ModuleLoader__={load({factory}){factory(()=>React)}}; ${source.replace(marker, '    globalThis.TestTabs = DetailTabs;\n' + marker)} function Test(){const [tab,setTab]=React.useState('requirement'); return React.createElement(React.Fragment,null,React.createElement(globalThis.TestTabs,{tab,onChange:setTab}),React.createElement('div',{id:'detail-panel',role:'tabpanel','aria-labelledby':'detail-tab-'+tab},tab));} createRoot(document.getElementById('root')).render(React.createElement(Test));`
  const bundle = await build({ stdin: { contents: entry, resolveDir: fileURLToPath(new URL('../../../', import.meta.url)), loader: 'js' }, bundle: true, write: false, platform: 'browser', format: 'esm' })
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 320, height: 640 } })
  await page.route('http://test.local/**', route => route.fulfill(route.request().url().endsWith('/app.js') ? { contentType: 'text/javascript', body: bundle.outputFiles[0].text } : { contentType: 'text/html', body: '<div id="root"></div><script type="module" src="/app.js"></script>' }))
  try {
    await page.goto('http://test.local/')
    const tabs = page.getByRole('tab')
    assert.equal(await tabs.count(), 3)
    await tabs.first().focus()
    for (let i = 0; i < 3; i++) {
      const selected = page.getByRole('tab', { selected: true })
      assert.equal(await selected.getAttribute('aria-controls'), 'detail-panel')
      assert.equal(await page.getByRole('tabpanel').getAttribute('aria-labelledby'), await selected.getAttribute('id'))
      await page.keyboard.press('ArrowRight')
    }
  } finally { await browser.close() }
})

test('idle review-result progress exposes recovery and compact validation controls', async () => {
  const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')
  const marker = '    return {\n      inject:'
  const item = {
    id: 'REQ-RUN-011', title: '列表标题优化', closed: false,
    run: { blueprint: { exists: true, allowedPathCount: 3 } },
  }
  const detail = deriveDetailView({
    ...item,
    run: { exists: true, id: 'RUN-011', sessionId: 'session-011', status: 'waiting-input', active: true, idleHandback: true, blueprint: { exists: true, allowedPathCount: 3 }, autoAdvance: { authorized: true, status: 'authorized' } },
    delivery: { key: 'pending', label: '待推进', source: 'run-idle' },
    acceptance: { registered: true, latest: { result: 'fail', current: false, complete: true, diagnostic: { category: 'verification', title: '🟠 验证检查未通过', summary: '验证命令失败（exit 1）：not ok 1 - 保留手动标题', log: 'not ok 1 - 保留手动标题\nAssertionError: expected title' } } },
    candidate: { exists: false },
    decision: { state: 'unchecked' },
  })
  const entry = `import React from 'react'; import {createRoot} from 'react-dom/client';
    window.__ModuleLoader__={load({factory}){factory(()=>React)}}; ${source.replace(marker, '    globalThis.TestProgress = ExecutionProgress;\n' + marker)}
    const item=${JSON.stringify(item)}, detail=${JSON.stringify(detail)};
    createRoot(document.getElementById('root')).render(React.createElement(globalThis.TestProgress,{item,detail,root:'D:/test',handlers:{'continue-run':()=>window.resumed=true},onAcceptance:()=>window.verified=true,onRefresh:()=>window.refreshed=true,onOpenSession:id=>window.opened=id}));`
  const bundle = await build({ stdin: { contents: entry, resolveDir: fileURLToPath(new URL('../../../', import.meta.url)), loader: 'js' }, bundle: true, write: false, platform: 'browser', format: 'esm' })
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  await page.route('http://test.local/**', route => route.fulfill(route.request().url().endsWith('/app.js') ? { contentType: 'text/javascript', body: bundle.outputFiles[0].text } : { contentType: 'text/html', body: '<div id="root"></div><script type="module" src="/app.js"></script>' }))
  try {
    await page.goto('http://test.local/')
    await page.getByText('等待恢复推进或重新验证').waitFor()
    assert.equal(await page.getByText('AI 正在处理（暂时无需你操作）').count(), 0)
    assert.equal(await page.getByText('✓ 已生成执行蓝图（锁定修改范围 3 个模块）').isVisible(), true)
    assert.equal(await page.getByText('🟠 验证检查未通过').isVisible(), true)
    assert.equal(await page.getByText(/验证命令失败.*not ok 1/).first().isVisible(), true)
    await page.getByText('查看具体报错日志与诊断详情').first().click()
    assert.equal(await page.getByText(/AssertionError: expected title/).first().isVisible(), true)
    await page.getByRole('button', { name: '🔧 让 AI 自动修复未通过项' }).click()
    await page.getByRole('button', { name: '重新运行验证' }).click()
    await page.getByRole('button', { name: '在 DSH 中打开会话' }).click()
    assert.equal(await page.evaluate(() => window.resumed && window.verified && window.opened === 'session-011'), true)
    assert.equal(await page.getByText('技术记录与检查依据').count(), 0)
    assert.equal(await page.getByText('运行与交付').count(), 0)
    assert.equal(await page.getByText('AI 优化建议').count(), 0)
  } finally { await browser.close() }
})

test('delivery progress renders the structured architecture ledger and Git commit badges', async () => {
  const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')
  const marker = '    return {\n      inject:'
  const item = { id: 'REQ-LEDGER-001', title: '交付档案', closed: true, run: {} }
  const detail = deriveDetailView({
    ...item,
    delivery: { key: 'closed', label: '已关闭', source: 'release' },
    acceptance: { registered: true, latest: { result: 'pass', current: true, complete: true } },
    candidate: { exists: true, id: 'CAND-REQ-LEDGER-001', current: true },
    decision: { state: 'verified' },
    release: { exists: true, id: 'REL-LEDGER', status: 'released', sourceControl: { devBranch: 'develop', devCommitSha: '1234567890abcdef', mainBranch: 'main', mainMergeCommitSha: 'abcdef0123456789', pushedToRemoteDev: true, pushedToMain: true } },
    architectureLedger: { path: 'requirements/architecture/REQ-LEDGER-001-design.md', title: 'REQ-LEDGER-001 架构与数据模型交付档案', baseline: ['需求：REQ-LEDGER-001 · v1'], modules: [{ path: 'packages/alm-core/src/requirements/release.mjs', role: '需求领域模型、验证与交付状态' }], contracts: ['沿用既有数据与接口契约。'], verification: ['AC-01：通过'] },
  })
  const entry = `import React from 'react'; import {createRoot} from 'react-dom/client'; window.__ModuleLoader__={load({factory}){factory(()=>React)}}; ${source.replace(marker, '    globalThis.TestProgress = ExecutionProgress;\n' + marker)} const item=${JSON.stringify(item)}, detail=${JSON.stringify(detail)}; createRoot(document.getElementById('root')).render(React.createElement(globalThis.TestProgress,{item,detail,root:'D:/test',handlers:{},onRefresh:()=>{}}));`
  const bundle = await build({ stdin: { contents: entry, resolveDir: fileURLToPath(new URL('../../../', import.meta.url)), loader: 'js' }, bundle: true, write: false, platform: 'browser', format: 'esm' })
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  await page.route('http://test.local/**', route => route.fulfill(route.request().url().endsWith('/app.js') ? { contentType: 'text/javascript', body: bundle.outputFiles[0].text } : { contentType: 'text/html', body: '<div id="root"></div><script type="module" src="/app.js"></script>' }))
  try {
    await page.goto('http://test.local/')
    await page.locator('[data-architecture-ledger]').first().getByText(/查看架构与数据模型交付档案/).click()
    assert.equal(await page.getByText('packages/alm-core/src/requirements/release.mjs：需求领域模型、验证与交付状态').isVisible(), true)
    assert.equal(await page.locator('[data-dev-commit-badge]').isVisible(), true)
    assert.equal(await page.locator('[data-main-commit-badge]').isVisible(), true)
  } finally { await browser.close() }
})

for (const stalledStage of ['fetch', 'body']) test(`timeline ${stalledStage} timeout permits retry and ignores a late response`, async () => {
  const versions = Array.from({ length: 51 }, (_, index) => ({ date: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(), subject: `event-${index}` }))
  const item = { id: 'REQ-A', versions }
  const record = deriveDetailView(item).record
  const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')
  const marker = '    return {\n      inject:'
  const pageData = collectedTimelinePage(item, 1, record.timelineFingerprint)
  const entry = `import React from 'react'; import {createRoot} from 'react-dom/client';
    window.__ModuleLoader__={load({factory}){factory(()=>React)}}; ${source.replace(marker, '    globalThis.TestTimeline = CollectedTimeline;\n' + marker)}
    createRoot(document.getElementById('root')).render(React.createElement(globalThis.TestTimeline,{root:'D:/test',requirementId:'REQ-A',record:${JSON.stringify(record)},onNavigate(){}}));`
  const bundle = await build({ stdin: { contents: entry, resolveDir: fileURLToPath(new URL('../../../', import.meta.url)), loader: 'js' }, bundle: true, write: false, platform: 'browser', format: 'esm' })
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  await page.addInitScript(({ data, stage }) => {
    const originalTimeout = window.setTimeout, originalFetch = window.fetch
    window.setTimeout = (fn, delay, ...args) => originalTimeout(fn, delay === 10000 ? 100 : delay, ...args)
    let calls = 0
    window.fetch = (url, options) => {
      if (!String(url).includes('mode=timeline')) return originalFetch(url, options)
      if (++calls === 1) {
        const old = { ...data, entries: [{ ...data.entries[0], title: '旧响应' }] }
        if (stage === 'body') return Promise.resolve({ ok: true, status: 200, json: () => new Promise(resolve => { window.releaseOldTimeline = () => resolve(old) }).then(value => { window.oldTimelineDelivered = true; return value }) })
        return new Promise(resolve => { window.releaseOldTimeline = () => resolve(new Response(JSON.stringify(old), { status: 200 })) }).then(response => { window.oldTimelineDelivered = true; return response })
      }
      return Promise.resolve(new Response(JSON.stringify(data), { status: 200 }))
    }
  }, { data: pageData, stage: stalledStage })
  await page.route('http://test.local/**', route => route.fulfill(route.request().url().endsWith('/app.js')
    ? { contentType: 'text/javascript', body: bundle.outputFiles[0].text }
    : { contentType: 'text/html', body: '<div id="root"></div><script type="module" src="/app.js"></script>' }))
  try {
    await page.goto('http://test.local/')
    const load = page.getByRole('button', { name: '加载较早事件（剩余 1 条）' })
    await load.click()
    await page.getByRole('alert').getByText('较早事件暂不可用，请重试。').waitFor()
    assert.equal(await page.getByText('event-50', { exact: true }).isVisible(), true)
    await load.click()
    await page.getByText('event-0', { exact: true }).waitFor()
    await page.evaluate(() => window.releaseOldTimeline())
    await page.waitForFunction(() => window.oldTimelineDelivered === true)
    assert.equal(await page.getByText('旧响应', { exact: true }).count(), 0)
    assert.equal(await page.getByText('event-0', { exact: true }).count(), 1)
  } finally { await browser.close() }
})

test('timeline rejects changed snapshots and ignores a late response after switching requirements', async () => {
  const versions = Array.from({ length: 51 }, (_, index) => ({ date: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(), subject: `event-${index}` }))
  const item = { id: 'REQ-A', versions }
  const record = deriveDetailView(item).record
  const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')
  const marker = '    return {\n      inject:'
  const entry = `import React from 'react'; import {createRoot} from 'react-dom/client';
    window.__ModuleLoader__={load({factory}){factory(()=>React)}}; ${source.replace(marker, '    globalThis.TestTimeline = CollectedTimeline;\n' + marker)}
    const root=createRoot(document.getElementById('root')); let record=${JSON.stringify(record)};
    window.showTimeline=id=>root.render(React.createElement(globalThis.TestTimeline,{key:id,root:'D:/test',requirementId:id,record,onNavigate(){},onRefresh(){window.refreshCalled=true; record={...record}; window.showTimeline(id)}})); window.showTimeline('REQ-A');`
  const result = await build({ stdin: { contents: entry, resolveDir: fileURLToPath(new URL('../../../', import.meta.url)), loader: 'js' }, bundle: true, write: false, platform: 'browser', format: 'esm' })
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  let release
  const gate = new Promise(resolve => { release = resolve })
  await page.route('http://test.local/**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div><script type="module" src="/app.js"></script>' })
    if (url.pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: result.outputFiles[0].text })
    if (url.searchParams.get('requirementId') === 'REQ-A') {
      await gate
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(collectedTimelinePage(item, 1, record.timelineFingerprint)) }).catch(() => {})
    }
    return route.fulfill({ status: 409, contentType: 'application/json', body: '{}' })
  })
  try {
    await page.goto('http://test.local/')
    await page.getByRole('button', { name: '加载较早事件（剩余 1 条）' }).click()
    await page.getByRole('status').getByText('正在读取较早事件…').waitFor()
    await page.evaluate(() => window.showTimeline('REQ-B'))
    release()
    const button = page.getByRole('button', { name: '加载较早事件（剩余 1 条）' })
    await button.focus(); await page.keyboard.press('Enter')
    await page.getByRole('alert').getByText('时间线已变化，请刷新需求后重新读取。').waitFor()
    const changed = page.getByRole('button', { name: '请刷新需求后读取' })
    assert.equal(await changed.getAttribute('aria-disabled'), 'true')
    assert.equal(await changed.evaluate(node => document.activeElement === node), true)
    assert.equal(await page.getByText('event-0', { exact: true }).count(), 0)
    await page.getByRole('button', { name: '刷新需求', exact: true }).click()
    assert.equal(await page.evaluate(() => window.refreshCalled), true)
    await page.getByRole('button', { name: '加载较早事件（剩余 1 条）' }).waitFor()
  } finally { release(); await browser.close() }
})

test('candidate validity is rendered honestly and unknown signoff is disabled', async () => {
  const item = { id: 'REQ-TEST-001', title: '候选验证', candidate: { exists: true, id: 'CAND-001', current: null }, delivery: { key: 'awaiting-acceptance' }, decision: { state: 'ready-for-human' }, acceptance: { registered: true, commands: [] } }
  const details = [null, false, true].map(current => deriveDetailView({ ...item, candidate: { ...item.candidate, current } }))
  const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')
  const marker = '    return {\n      inject:'
  assert.ok(source.includes(marker))
  const entry = `import React from 'react'; import {createRoot} from 'react-dom/client';
    window.__ModuleLoader__={load({factory}){factory(()=>React)}}; ${source.replace(marker, '    globalThis.TestDetail = V4DetailPage;\n' + marker)}
    const item=${JSON.stringify(item)}, details=${JSON.stringify(details)}, root=createRoot(document.getElementById('root'));
    window.renderState = (i, tab = 'delivery') => root.render(React.createElement(globalThis.TestDetail,{item,detail:details[i],root:'D:/test',handlers:{},tab,onNavigate(){},onClose(){},onRefresh(){},scrollRef:{current:null},allItems:[item]}));
    window.changeItem = () => { item.id = 'REQ-OTHER'; window.renderState(2, 'record') };
    window.renderState(0);`
  const result = await build({ stdin: { contents: entry, resolveDir: fileURLToPath(new URL('../../../', import.meta.url)), loader: 'js' }, bundle: true, write: false, platform: 'browser', format: 'esm' })
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 320, height: 640 } })
  await page.addInitScript(() => {
    const originalTimer = window.setTimeout
    window.setTimeout = (callback, delay, ...args) => originalTimer(callback, delay === 10000 ? 100 : delay, ...args)
    const originalFetch = window.fetch
    window.fetch = (url, options) => String(url).includes('offset=20') && !window.releaseVersionPage
      ? new Promise(resolve => { window.releaseVersionPage = () => resolve(new Response(JSON.stringify({ schema: 'alm.version.history/v1', asset: 'REQ-TEST-001', head: 'a'.repeat(40), versions: [{ sha: 'f'.repeat(40), subject: '迟到版本' }], next: null }), { status: 200 })) })
      : originalFetch(url, options)
  })
  await page.route('http://test.local/**', route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/app.js"></script>' })
    if (url.pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: result.outputFiles[0].text })
    if (url.pathname === '/api/alm/requirements/version' && url.searchParams.get('mode') === 'history') {
      const offset = Number(url.searchParams.get('offset'))
      const count = offset === 0 ? 20 : 1
      const versions = Array.from({ length: count }, (_, i) => ({ sha: (offset + i + 1).toString(16).padStart(40, '0'), short: `short-${offset + i}`, subject: `版本 ${offset + i}`, date: '2026-01-01' }))
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ schema: 'alm.version.history/v1', asset: item.id, head: 'a'.repeat(40), versions, next: offset === 0 ? 20 : null }) })
    }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ runs: [], next: null, records: [] }) })
  })
  try {
    await page.goto('http://test.local/')
    const candidate = page.locator('[data-verification-candidate-card]')
    await candidate.getByText('交付候选：CAND-001，需要重新核验').waitFor()
    assert.equal(await page.getByRole('button', { name: '✓ 确认签收 (Signoff)' }).count(), 0)
    await page.evaluate(() => window.renderState(1))
    await candidate.getByText('交付候选：CAND-001，需要重新核验').waitFor()
    await page.evaluate(() => window.renderState(2))
    await candidate.getByText('交付候选 CAND-001 已绑定当前需求与验证证据，等待人工签收。').waitFor()
    assert.equal(await page.getByText('验证与交付状态', { exact: true }).isVisible(), true)
  } finally { await browser.close() }
})

test('new structured delivery prompts are folded as dispatched work instead of user input', () => {
  const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')
  const detailSource = readFileSync(new URL('../detail-view.mjs', import.meta.url), 'utf8')
  assert.match(source, /#\\s\*需求交付任务：REQ-ALM-/)
  assert.match(source, /推进任务已派发/)
  assert.match(detailSource, /确认签收 \(Signoff\)/)
  assert.match(source, /发布归档/)
})

test('run history times out and retries without losing earlier entries', async () => {
  const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')
  const marker = '    return {\n      inject:'
  assert.ok(source.includes(marker))
  const entry = `import React from 'react'; import {createRoot} from 'react-dom/client';
    window.__ModuleLoader__={load({factory}){factory(()=>React)}}; ${source.replace(marker, '    globalThis.TestHistory = RunHistory;\n' + marker)}
    const root=createRoot(document.getElementById('root')); window.renderHistory=(id)=>root.render(React.createElement(globalThis.TestHistory,{root:'D:/test',requirementId:id,onOpenRun(){}})); window.renderHistory('REQ-A');`
  const result = await build({ stdin: { contents: entry, resolveDir: fileURLToPath(new URL('../../../', import.meta.url)), loader: 'js' }, bundle: true, write: false, platform: 'browser', format: 'esm' })
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  let attempts = 0
  await page.addInitScript(() => {
    const original = window.setTimeout
    window.setTimeout = (callback, delay, ...args) => original(callback, delay === 10000 ? 100 : delay, ...args)
    const originalFetch = window.fetch
    window.fetch = (url, options) => String(url).includes('requirementId=REQ-B')
      ? new Promise(resolve => { window.releaseNextHistory = () => resolve(new Response(JSON.stringify({ runs: [], next: null }), { status: 200 })) })
      : String(url).includes('before=') && !window.releaseHistoryPage
      ? new Promise(resolve => { window.releaseHistoryPage = () => resolve(new Response(JSON.stringify({ runs: [{ id: 'RUN-999' }], next: null }), { status: 200 })) })
      : originalFetch(url, options)
  })
  await page.route('http://test.local/**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div><script type="module" src="/app.js"></script>' })
    if (url.pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: result.outputFiles[0].text })
    if (!url.searchParams.has('before')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ runs: [{ id: 'RUN-002' }], next: 'RUN-002' }) })
    attempts++
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ runs: [{ id: 'RUN-002' }, { id: 'RUN-001' }], next: null }) })
  })
  try {
    await page.goto('http://test.local/')
    await page.getByRole('button', { name: '加载更多运行' }).click()
    const error = page.getByRole('alert').filter({ hasText: '运行历史暂不可用' })
    await error.waitFor()
    assert.equal(await page.getByRole('button', { name: '查看运行 RUN-002' }).count(), 1)
    await error.getByRole('button', { name: '重试' }).click()
    await page.getByRole('button', { name: '查看运行 RUN-001' }).waitFor()
    await page.evaluate(() => window.releaseHistoryPage())
    assert.equal(await page.getByRole('button', { name: '查看运行 RUN-999' }).count(), 0)
    assert.equal(await page.getByRole('button', { name: '查看运行 RUN-002' }).count(), 1)
    await page.evaluate(() => window.renderHistory('REQ-B'))
    await page.getByRole('status').getByText('正在读取运行历史…').waitFor()
    assert.equal(await page.getByRole('button', { name: '查看运行 RUN-002' }).count(), 0)
    await page.evaluate(() => window.releaseNextHistory())
  } finally { await browser.close() }
})

test('detail tabs retain keyboard focus and fit a narrow panel', async () => {
  const item = { id: 'REQ-TEST-001', title: '需要验证详情面板中较长的需求标题、状态和操作在不同宽度下都能完整显示', revision: 1, root: 'D:/test', briefText: `## 用户原话\n> 需要验证详情页。\n\n- 保留结构\n\n${'业务说明。'.repeat(120)}完整结尾\n<!-- alm:meta {"confirmedAt":"2026-01-01"} -->`,
    review: { roles: [] }, aiReview: { stored: true, provider: 'test', model: 'review-model', usage: { inputTokens: 123, outputTokens: 45, cacheReadTokens: null, cacheWriteTokens: 0 } }, acceptance: { registered: false, commands: [] }, candidate: { exists: false }, run: { exists: true, id: 'RUN-002', status: 'done', startedAt: '2026-11-05T00:00:00Z' }, release: { exists: false }, defect: { exists: false }, delivery: { key: 'pending', label: '待推进' }, decision: { state: 'unchecked', gaps: [] }, links: [], versions: [] }
  item.versions = Array.from({ length: 60 }, (_, index) => ({ date: new Date(Date.parse('2026-01-01T00:00:00Z') + index * 1000).toISOString(), subject: `commit-${index}` }))
  const detail = deriveDetailView(item)
  detail.context = { ...detail.context, question: { title: '待确认的问题' } }
  assert.deepEqual(detail.record.timeline.find(entry => entry.kind === 'run').ref, { tab: 'delivery', anchor: 'delivery-run-observation' })
  detail.record.timeline.push({ at: '2026-11-05T00:01:00Z', kind: 'release', title: '发布测试', ref: { tab: 'delivery', anchor: 'delivery-release' } })
  detail.record.timeline.push({ at: '2026-11-05T00:02:00Z', kind: 'question', title: '问题焦点测试', ref: { tab: 'delivery', anchor: 'delivery-question' } })
  const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')
  const marker = '    return {\n      inject:'
  assert.ok(source.includes(marker))
  const entry = `import React from 'react'; import {createRoot} from 'react-dom/client';
    window.__ModuleLoader__={load({factory}){factory(()=>React)}}; ${source.replace(marker, '    globalThis.TestDetail = V4DetailPage; globalThis.TestColors = T;\n' + marker)}
    const item=${JSON.stringify(item)}, detail=${JSON.stringify(detail)};
    function App(){const [tab,setTab]=React.useState('requirement');const scrollRef=React.useRef(null);return React.createElement(globalThis.TestDetail,{item,detail,root:'D:/test',handlers:{},tab,onNavigate:setTab,onClose(){},onRefresh(){},scrollRef,allItems:[item]})}
    createRoot(document.getElementById('root')).render(React.createElement(App));`
  const result = await build({ stdin: { contents: entry, resolveDir: fileURLToPath(new URL('../../../', import.meta.url)), loader: 'js' }, bundle: true, write: false, platform: 'browser', format: 'esm' })
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 320, height: 640 } })
  const errors = []
  let timelineAttempts = 0
  await page.addInitScript(() => {
    const original = window.setTimeout
    window.setTimeout = (callback, delay, ...args) => original(callback, delay === 60 ? 400 : delay, ...args)
  })
  page.on('pageerror', error => errors.push(error.message))
  await page.route('http://test.local/**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;background:#0f1115;color:white"><div id="root" style="height:100vh"></div><script type="module" src="/app.js"></script>' })
    if (url.pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: result.outputFiles[0].text })
    if (url.searchParams.get('mode') === 'timeline') {
      if (++timelineAttempts === 1) return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' })
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(collectedTimelinePage(item, Number(url.searchParams.get('before')), url.searchParams.get('fingerprint'))) })
    }
    if (url.searchParams.get('mode') === 'history') return route.fulfill({ contentType: 'application/json', body: JSON.stringify(url.searchParams.has('before') ? { ok: true, runs: [{ id: 'RUN-002', status: 'done' }, { id: 'RUN-001', status: 'failed', createdAt: '2026-11-04T00:00:00Z' }], next: null } : { ok: true, runs: [{ id: 'RUN-002', status: 'done', createdAt: '2026-11-05T00:00:00Z' }], next: 'RUN-002' }) })
    if (url.searchParams.get('mode') === 'list') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, runs: [{ id: 'RUN-001', status: 'failed', createdAt: '2026-11-04T00:00:00Z' }, { id: 'RUN-002', status: 'done', createdAt: '2026-11-05T00:00:00Z' }] }) })
    if (url.searchParams.get('runId')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ runId: url.searchParams.get('runId'), segment: Number(url.searchParams.get('segment') ?? 0), ok: true, sessions: [{ sessionId: url.searchParams.get('runId') }], events: [{ sessionId: url.searchParams.get('runId'), seq: 0, kind: 'output', text: `记录 ${url.searchParams.get('runId')}` }], source: 'session-query', lastSeq: 0, prefixHash: 'a'.repeat(64), next: null }) })
    return route.fulfill({ contentType: 'application/json', body: '{"ok":true,"runs":[]}' })
  })
  try {
    await page.goto('http://test.local/')
    assert.equal(await page.getByRole('button', { name: '← 返回需求列表' }).first().isVisible(), true)
    assert.doesNotMatch(await page.locator('body').innerText(), /<!--\s*alm:meta/)
    assert.equal(await page.locator('[data-iteration-feedback]').count(), 1)
    assert.equal(await page.evaluate(() => Boolean(document.querySelector('[data-human-verification]')?.compareDocumentPosition(document.querySelector('[data-iteration-feedback]')) & Node.DOCUMENT_POSITION_FOLLOWING)), true)
    // Feedback-created briefs keep Markdown as the source of record, but the
    // human-facing summary must render its structure instead of exposing ##/>.
    assert.equal(await page.getByText('## 用户原话', { exact: true }).count(), 0)
    assert.equal(await page.getByText('> 需要验证详情页。', { exact: true }).count(), 0)
    const excerpt = page.locator('[data-human-excerpt]').first()
    const toggle = page.getByText('展开这段完整内容', { exact: true }).first()
    assert.equal(await excerpt.isVisible(), true)
    await toggle.click()
    await page.getByText('收起完整内容', { exact: true }).first().waitFor()
    assert.equal(await excerpt.isVisible(), false)
    assert.equal(await page.getByText(/完整结尾/).first().isVisible(), true)
    await page.getByText('收起完整内容', { exact: true }).first().click()
    await toggle.waitFor()
    assert.equal(await excerpt.isVisible(), true)
    const tab = page.getByRole('tab', { name: '需求正文' })
    await tab.waitFor()
    await tab.focus(); await page.keyboard.press('ArrowRight')
    const progress = page.getByRole('tab', { name: 'AI 进展' })
    await progress.waitFor()
    await page.waitForFunction(() => document.querySelector('[data-detail-tab="delivery"]')?.getAttribute('aria-selected') === 'true')
    assert.equal(await page.getByRole('button', { name: '← 返回需求列表' }).first().isVisible(), true)
    assert.equal(await page.locator('[data-iteration-feedback]').count(), 0)
    await page.waitForTimeout(120)
    assert.equal(await progress.evaluate(node => document.activeElement === node), true)
    assert.equal(await progress.evaluate(node => getComputedStyle(node.closest('[role="tablist"]')).overflowX), 'auto')
    assert.equal(await page.getByText('验证与交付状态', { exact: true }).isVisible(), true)
    assert.equal(await page.getByText('最近 AI 评审用量').count(), 0)
    await page.keyboard.press('ArrowRight')
    await page.waitForFunction(() => document.querySelector('[data-detail-tab="record"]')?.getAttribute('aria-selected') === 'true')
    assert.equal(await page.getByText('版本演进与事件时间线', { exact: true }).isVisible(), true)
    await page.getByRole('button', { name: '加载较早事件（剩余 11 条）' }).focus()
    await page.keyboard.press('Enter')
    await page.getByText('较早事件暂不可用，请重试。').waitFor()
    await page.getByRole('button', { name: '加载较早事件（剩余 11 条）' }).focus()
    await page.keyboard.press('Enter')
    await page.locator('[data-detail-section="record-timeline"]').getByText('commit-0', { exact: true }).waitFor()
    const completed = page.getByRole('button', { name: '已显示全部已收集事件' })
    assert.equal(await completed.getAttribute('aria-disabled'), 'true')
    assert.equal(await completed.evaluate(node => document.activeElement === node), true)
    assert.equal(await page.getByRole('status').filter({ hasText: '已读取 11 条较早事件。' }).count(), 1)
    assert.equal(await page.getByRole('button', { name: '查看相关分区' }).count(), 0)
    await page.setViewportSize({ width: 240, height: 640 })
    await page.evaluate(() => document.querySelectorAll('[role="tablist"] [role="tab"]').forEach(node => node.style.setProperty('font-size', '24px', 'important')))
    const progressTab = page.getByRole('tab', { name: 'AI 进展' })
    await progressTab.click()
    await page.waitForTimeout(120)
    await progressTab.focus()
    await page.keyboard.press('End')
    const historyTab = page.getByRole('tab', { name: '历史记录' })
    assert.equal(await historyTab.getAttribute('aria-selected'), 'true')
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-detail-tab') === 'record')
    assert.equal(await historyTab.evaluate(node => document.activeElement === node), true)
    assert.equal(await historyTab.evaluate(node => { const tablist = node.closest('[role="tablist"]'), item = node.getBoundingClientRect(), list = tablist.getBoundingClientRect(); return item.left >= list.left && item.right <= list.right }), true)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.setViewportSize({ width: 600, height: 800 })
    await page.evaluate(() => document.querySelectorAll('[role="tablist"] [role="tab"]').forEach(node => node.style.removeProperty('font-size')))
    await historyTab.focus()
    await page.keyboard.press('Home')
    for (const [index, name] of ['需求正文', 'AI 进展', '历史记录'].entries()) {
      if (index) await page.keyboard.press('ArrowRight')
      const current = page.getByRole('tab', { name })
      assert.equal(await current.getAttribute('aria-selected'), 'true')
      await page.waitForFunction(label => document.activeElement?.getAttribute('role') === 'tab' && document.activeElement?.textContent?.trim() === label, name)
      assert.equal(await current.evaluate(node => document.activeElement === node), true)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true)
      const titleFits = await page.locator('[data-detail-page] h1').evaluate(node => {
        const title = node.getBoundingClientRect(), parent = node.parentElement.getBoundingClientRect()
        return title.left >= parent.left && title.right <= parent.right && title.width > 0
      })
      assert.equal(titleFits, true)
    }
    await page.setViewportSize({ width: 640, height: 900 })
    await page.evaluate(() => {
      document.querySelectorAll('[role="tablist"] [role="tab"]').forEach(node => node.style.removeProperty('font-size'))
      document.body.style.zoom = '2'
      document.body.style.background = '#ffffff'
      document.body.style.color = '#111111'
      const values = { '--dsw-alias-bg-base': '#ffffff', '--dsw-alias-bg-layer-1': '#ffffff', '--dsw-alias-bg-layer-2': '#ffffff', '--dsw-alias-label-primary': '#0f1115', '--dsw-alias-label-secondary': '#61666b', '--dsw-alias-label-tertiary': '#81858c', '--dsw-alias-border-l1': '#0000000a', '--dsw-alias-border-l2': '#0000001a', '--dsw-alias-brand-primary': '#0f1115', '--dsw-alias-state-warn-primary': '#f59e0b', '--dsw-alias-state-success-primary': '#22c55e', '--dsw-alias-state-error-primary': '#ec1313' }
      for (const [name, value] of Object.entries(values)) document.documentElement.style.setProperty(name, value)
    })
    const stateContrast = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1
      const ctx = canvas.getContext('2d')
      const rgb = color => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3) }
      const probe = document.createElement('span'); document.body.append(probe)
      const luminance = channels => channels.map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0)
      const ratio = (foreground, background) => { const a = luminance(foreground), b = luminance(background); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) }
      const measure = (background, buttonText) => ['warn', 'ok', 'err'].flatMap((key, index) => {
        probe.style.color = window.TestColors[key]
        const color = rgb(getComputedStyle(probe).color)
        const tint = [[231, 176, 75], [53, 196, 122], [255, 139, 139]][index]
        return [ratio(color, tint.map((value, channel) => Math.round(value * 0.14 + background[channel] * 0.86))), ratio(buttonText, color)]
      })
      const light = measure([255, 255, 255], [255, 255, 255])
      document.documentElement.style.setProperty('--dsw-alias-label-secondary', '#cfd3d6')
      document.documentElement.style.setProperty('--dsw-alias-state-error-primary', '#f25a5a')
      const dark = measure([35, 35, 36], [21, 21, 23])
      document.documentElement.style.setProperty('--dsw-alias-label-secondary', '#61666b')
      document.documentElement.style.setProperty('--dsw-alias-state-error-primary', '#ec1313')
      probe.remove(); return [...light, ...dark]
    })
    assert.ok(stateContrast.every(value => value >= 4.5), `theme badge and button contrast: ${stateContrast}`)
    for (const name of ['需求正文', 'AI 进展', '历史记录']) {
      await page.getByRole('tab', { name }).click()
      assert.equal(await page.getByRole('tab', { name }).getAttribute('aria-selected'), 'true')
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true)
      if (name === '需求正文') assert.equal(await page.getByRole('heading', { name: '验收标准' }).isVisible(), true)
      if (process.env.DSH_DETAIL_LIGHT_SCREENSHOT) await page.screenshot({ path: `${process.env.DSH_DETAIL_LIGHT_SCREENSHOT}-${name}.png` })
    }
    await page.evaluate(() => { document.body.style.zoom = '' })
    await page.setViewportSize({ width: 320, height: 640 })
    await page.getByRole('tab', { name: '需求正文' }).click()
    await page.getByRole('button', { name: '更多 ▾' }).click()
    await page.getByRole('button', { name: '编辑需求' }).click()
    const titleInput = page.getByRole('textbox', { name: '标题' })
    const briefInput = page.getByRole('textbox', { name: '原始诉求与背景' })
    assert.equal(await titleInput.getAttribute('name'), 'requirement-title')
    assert.equal(await briefInput.getAttribute('name'), 'requirement-brief')
    assert.equal(await titleInput.getAttribute('autocomplete'), 'off')
    assert.equal(await briefInput.getAttribute('autocomplete'), 'off')
    await titleInput.fill('未保存修改')
    await tab.focus()
    page.once('dialog', dialog => dialog.dismiss())
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(120)
    assert.equal(await tab.getAttribute('aria-selected'), 'true')
    assert.equal(await tab.evaluate(node => document.activeElement === node), true)
    assert.equal(await titleInput.inputValue(), '未保存修改')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})

test('unstarted detail keeps one clear progress state and a direct feedback form', async () => {
  const item = { id: 'REQ-EMPTY', title: '界面验证', sources: ['chat'], investigationEvidence: [{ investigationId: 'INV-123', path: 'src/app.js', line: 12, endLine: 14 }], docMeta: { docHash: 'sha256:1234567890abcdef' }, docView: { doc: { status: 'canonical', goal: '让用户看到状态', problem: '目前无法查看', acceptance: [{ id: 'AC-01', text: '显示状态' }, { id: 'AC-02', text: '更新状态' }, { id: 'AC-03', text: '保留历史' }] } }, delivery: { key: 'pending', label: '待推进' }, acceptance: { registered: false, commands: [] } }
  const detail = deriveDetailView(item)
  const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')
  const marker = '    return {\n      inject:'
  const entry = `import React from 'react'; import {createRoot} from 'react-dom/client'; window.__ModuleLoader__={load({factory}){factory(()=>React)}}; ${source.replace(marker, '    globalThis.TestDetail = V4DetailPage;\n' + marker)}
    const item=${JSON.stringify(item)},detail=${JSON.stringify(detail)}; function App(){const [tab,onNavigate]=React.useState('requirement');return React.createElement(globalThis.TestDetail,{item,detail,root:'D:/test',handlers:{start(){}},tab,onNavigate,onClose(){},onRefresh(){},scrollRef:React.useRef(null),allItems:[item]})};createRoot(document.getElementById('root')).render(React.createElement(App));`
  const bundle = await build({ stdin: { contents: entry, resolveDir: fileURLToPath(new URL('../../../', import.meta.url)), loader: 'js' }, bundle: true, write: false, platform: 'browser', format: 'esm' })
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await page.route('http://test.local/**', route => route.fulfill(route.request().url().endsWith('/app.js') ? { contentType: 'text/javascript', body: bundle.outputFiles[0].text } : { contentType: 'text/html', body: '<div id="root"></div><script type="module" src="/app.js"></script>' }))
  try {
    await page.goto('http://test.local/')
    await page.getByText('补充反馈或调整需求').waitFor()
    assert.equal(await page.locator('[data-iteration-feedback] textarea').isVisible(), true)
    assert.equal(await page.locator('[data-iteration-feedback] textarea').getAttribute('rows'), '2')
    assert.equal(await page.locator('[data-iteration-feedback] button').evaluate(node => node.getBoundingClientRect().bottom <= innerHeight), true)
    assert.equal(await page.locator('.detail-sidebar').getByText('对话生成').isVisible(), true)
    const cards = page.locator('.description-cards > div')
    assert.equal(await cards.count(), 2)
    const boxes = await cards.evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width } }))
    assert.equal(boxes[0].y, boxes[1].y)
    assert.ok(boxes[1].x > boxes[0].x && Math.abs(boxes[0].width - boxes[1].width) < 1)
    assert.equal(await page.locator('.detail-sidebar').evaluate((node) => Math.abs(node.getBoundingClientRect().top - document.querySelector('.description-cards').getBoundingClientRect().top) < 1), true)
    await page.getByRole('button', { name: '更多 ▾' }).click()
    assert.equal(await page.locator('#v4-more-actions').getByRole('button', { name: '反馈', exact: true }).count(), 0)
    assert.equal(await page.locator('#v4-more-actions button').first().evaluate(node => getComputedStyle(node).borderStyle), 'none')
    await page.getByRole('button', { name: '更多 ▾' }).click()
    assert.equal(await page.getByText('未登记验收命令').count(), 0)
    assert.equal(await page.getByRole('button', { name: '迭代反馈', exact: true }).count(), 0)
    await page.getByRole('tab', { name: 'AI 进展' }).click()
    await page.getByText('待启动 AI 推进').waitFor()
    assert.equal(await page.locator('[data-progress-not-started]').count(), 1)
    assert.equal(await page.locator('[data-progress-technical], [data-human-progress], [data-iteration-feedback]').count(), 0)
    assert.doesNotMatch(await page.locator('body').innerText(), /verify\.cmd|\.alm\/|还没有可读取的运行活动/)
    await page.getByRole('tab', { name: '历史记录' }).click()
    assert.equal(await page.getByRole('button', { name: '← 返回需求列表' }).count(), 1)
    assert.equal(await page.getByText('版本演进与事件时间线').isVisible(), true)
    assert.equal(await page.getByText('归属与标识').count(), 0)
    await page.getByText('调查证据与技术诊断').click()
    assert.equal(await page.getByText('INV-123 · src/app.js:12–14').isVisible(), true)
    assert.equal(await page.getByText('内容指纹：12345678').isVisible(), true)
    assert.equal(await page.getByRole('button', { name: '读取版本历史' }).count(), 0)
    assert.equal(await page.getByText('运行历史', { exact: true }).count(), 0)
    await page.setViewportSize({ width: 480, height: 800 })
    await page.getByRole('tab', { name: '需求正文' }).click()
    assert.equal(await page.locator('.description-cards').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length), 1)
  } finally { await browser.close() }
})

test('list and timeline present real origin, pending confirmation and human-readable changes', async () => {
  const item = { id: 'REQ-12', title: '一个需要截断的很长很长很长很长很长很长的需求标题', revision: 3, sources: ['chat'], defect: { exists: false, defect: null }, pendingPatch: { patchId: 'p' }, requiresHuman: false, delivery: { key: 'pending', label: '待推进' }, detailView: { content: { doc: { acceptance: [{ id: 'AC-01' }, { id: 'AC-02' }] } } }, specConvergences: [{ at: '2026-01-03T00:00:00Z', evolutionNote: '最近调整' }] }
  const event = { at: '2026-01-03T00:00:00Z', kind: 'spec_converged', title: 'v2 → v3', specDelta: { beforeRevision: 2, revision: 3, beforeDocument: { goal: '旧目标' }, afterDocument: { goal: '新目标' }, diff: { docHashChanged: true }, acceptanceCriteria: { before: [{ id: 'AC-01', text: '旧规则', featureIds: ['FR-1'] }, { id: 'AC-02', text: '保持' }], after: [{ id: 'AC-01', text: '新规则' }, { id: 'AC-02', text: '保持' }, { id: 'AC-03', text: '新增规则' }] } } }
  const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')
  const marker = '    return {\n      inject:'
  const entry = `import React from 'react';import {createRoot} from 'react-dom/client'; window.__ModuleLoader__={load({factory}){factory(()=>React)}}; ${source.replace(marker, '    globalThis.TestTable = RequirementTable; globalThis.TestTimeline = CollectedTimeline; globalThis.TestNeeds = needsHuman; globalThis.TestSource = matchesSource; globalThis.TestMatches = matchesView; globalThis.TestCounts = requirementViewCounts;\n' + marker)}
  const item=${JSON.stringify(item)}, event=${JSON.stringify(event)}; window.item=item; createRoot(document.getElementById('root')).render(React.createElement(React.Fragment,null,React.createElement(globalThis.TestTable,{items:[item],onOpen(){window.opens=(window.opens||0)+1},onArchive(){},onRemove(){}}),React.createElement(globalThis.TestTimeline,{record:{timeline:[{at:'2026-01-01T00:00:00Z',kind:'created',title:'创建需求 · v1'},event]},requirementId:item.id,onNavigate(){}})));`
  const bundle = await build({ stdin: { contents: entry, resolveDir: fileURLToPath(new URL('../../../', import.meta.url)), loader: 'js' }, bundle: true, write: false, platform: 'browser', format: 'esm' })
  const browser = await chromium.launch({ headless: true }); const page = await browser.newPage()
  await page.route('http://test.local/**', route => route.fulfill(route.request().url().endsWith('/app.js') ? { contentType: 'text/javascript', body: bundle.outputFiles[0].text } : { contentType: 'text/html', body: '<div id="root"></div><script type="module" src="/app.js"></script>' }))
  try {
    await page.goto('http://test.local/')
    const row = page.locator('[data-req="REQ-12"]'); await row.waitFor(); await row.scrollIntoViewIfNeeded(); await row.getByText('v3 · 已演进').waitFor()
    assert.match(await row.innerText(), /对话生成.*v3.*待确认变更/s)
    assert.match(await row.innerText(), /2 项标准/)
    assert.doesNotMatch(await row.innerText(), /缺陷|失败监控|登记验收/)
    assert.equal(await row.getByRole('button', { name: /^去确认/ }).count(), 1)
    assert.equal(await row.getByText('v3 · 已演进').getAttribute('title'), '最近调整')
    assert.equal(await row.getByRole('button', { name: item.title, exact: true }).evaluate(node => getComputedStyle(node).whiteSpace), 'nowrap')
    assert.equal(await page.evaluate(() => window.TestNeeds(window.item) && window.TestSource(window.item, 'chat') && !window.TestSource(window.item, 'manual') && window.TestMatches(window.item, 'mine') && window.TestCounts({ requirements: [window.item] }, [window.item]).mine === 1), true)
    await row.locator('[role=cell]').nth(1).click()
    assert.equal(await page.evaluate(() => window.opens), 1)
    await row.getByRole('button', { name: /^去确认/ }).click()
    assert.equal(await page.evaluate(() => window.opens), 2, 'action must not bubble to row')
    assert.equal(await page.getByRole('columnheader', { name: '最近更新' }).count(), 1)
    assert.doesNotMatch(await row.innerText(), /待验证|0 项标准/)
    const list = page.locator('[data-detail-section="record-timeline"] li')
    assert.match(await list.first().innerText(), /v2 → v3/)
    assert.match(await list.last().innerText(), /创建需求 · v1/)
    await page.getByText('查看需求与验收变更').click()
    const diff = page.locator('[data-visual-spec-diff]')
    assert.match(await diff.innerText(), /版本对比.*v2 → v3/)
    assert.match(await diff.innerText(), /\+ 新增 AC-03/)
    assert.match(await diff.innerText(), /~ 修改 AC-01/)
    assert.match(await diff.innerText(), /旧目标.*新目标/s)
    assert.doesNotMatch(await diff.innerText(), /docHashChanged|featureIds|查看相关分区/)
    assert.equal(await diff.getByText('保持', { exact: true }).first().isVisible(), false)
    await diff.getByText(/查看完整验收标准对比/).click()
    assert.equal(await diff.getByText(/AC-02 · 保持/).count(), 2)
  } finally { await browser.close() }
})
