import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const EXPERIMENT_TWO = '需求列表里的长标题自动提炼功能，如果用户手动修改过标题，就不要再被 AI 自动提炼覆盖了。'

test('analysis response renders the magnetic requirement card before the clarification draft', async () => {
  const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')
  const marker = '    return {\n      inject:'
  const entry = `import React from 'react'; import {createRoot} from 'react-dom/client';
    window.__ModuleLoader__={load({factory}){factory(()=>React)}}; ${source.replace(marker, '    globalThis.TestIntentMatch = IntentModal;\n' + marker)}
    createRoot(document.getElementById('root')).render(React.createElement(globalThis.TestIntentMatch,{root:'D:/test',project:'ALM',projectId:'ALM',onClose(){},onOpenRequirement(id){window.openedRequirement=id}}));`
  const bundle = await build({ stdin: { contents: entry, resolveDir: fileURLToPath(new URL('../../../', import.meta.url)), loader: 'js' }, bundle: true, write: false, platform: 'browser', format: 'esm' })
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 920, height: 760 } })
  const session = {
    sessionId: 'one', state: 'ready_for_confirmation', sessionRevision: 1,
    input: { text: EXPERIMENT_TWO, rawText: EXPERIMENT_TWO, inputRevision: 1, explicit: {} },
    context: { contextSnapshotId: 'ctx' }, readiness: { ready: true, reasons: [] },
    items: [{ itemId: 'ITM-1', recommendedRoute: 'create', unknowns: [], candidate: {
      title: '长标题自动提炼保留手动修改标题',
      problem: '防止用户手动修改后的需求标题被后续 AI 自动提炼逻辑意外覆盖丢失。',
      goal: '保留用户手动修改的标题，不被自动提炼覆盖。',
      acceptance: [{ expected: '当用户手动修改过需求标题后，AI 自动提炼不得覆盖该标题。', judgement: '页面验证' }],
    } }],
    docDraft: { title: '长标题自动提炼保留手动修改标题', goal: '保留用户手动修改的标题，不被自动提炼覆盖。', problem: '防止用户手动修改后的需求标题被后续 AI 自动提炼逻辑意外覆盖丢失。', acceptance: [{ id: 'AC-01', text: '当用户手动修改过需求标题后，AI 自动提炼不得覆盖该标题。', provenance: 'user-stated' }], pending: [], docHash: 'hash', draftRevision: 1 },
  }
  await page.route('http://test.local/**', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div><script type="module" src="/app.js"></script>' })
    if (url.pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text })
    const body = request.method() === 'POST' ? request.postDataJSON() : null
    if (body?.action === 'analyze') return route.fulfill({ json: { session, matchedReq: { matchedReqId: 'REQ-ALM-011', matchedTitle: '需求列表长标题自动提炼与主操作按钮语义优化', matchedReq: { id: 'REQ-ALM-011', title: '需求列表长标题自动提炼与主操作按钮语义优化', revision: 1 }, confidence: 'high', reason: '业务词：长标题、自动提炼、手动修改' } } })
    if (body?.action === 'match') return route.fulfill({ json: { match: { confidence: 'low' } } })
    return route.fulfill({ json: { session, sessions: [] } })
  })
  try {
    await page.goto('http://test.local/')
    await page.getByRole('textbox', { name: '用你自己的话写下想改变什么' }).fill(EXPERIMENT_TWO)
    await page.getByRole('button', { name: '分析意图' }).click()
    const card = page.getByTestId('requirement-match-card')
    await card.waitFor()
    assert.match(await card.innerText(), /REQ-ALM-011 · v1/)
    assert.equal(await card.getByRole('button', { name: '作为 REQ-ALM-011 的迭代反馈收敛' }).isVisible(), true)
    assert.equal(await page.getByText('如果用户手动修改过标题。', { exact: true }).count(), 0)
    assert.equal(await page.getByText('就不要再被 AI 自动提炼覆盖了。', { exact: true }).count(), 0)
    assert.equal(await page.locator('button').filter({ hasText: EXPERIMENT_TWO.slice(0, 20) }).count(), 0)
    await card.getByRole('button', { name: '仍作为全新需求创建' }).click()
    assert.equal(await card.count(), 0)
  } finally { await browser.close() }
})

test('requirement list uses a full-title tooltip and friendly verification actions', () => {
  const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')
  assert.match(source, /title: item\.title/)
  assert.match(source, /textOverflow: 'ellipsis'/)
  assert.match(source, /待补充验收方式/)
  assert.match(source, /补充验证方式/)
  assert.doesNotMatch(source, /return \{ label: '登记验收'/)
})

test('investigation adoption exposes evidence and status at narrow width', async () => {
  const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')
  const marker = '    return {\n      inject:'
  const entry = `import React from 'react'; import {createRoot} from 'react-dom/client'; window.__ModuleLoader__={load({factory}){factory(()=>React)}}; ${source.replace(marker, '    globalThis.TestIntent = IntentModal;\n' + marker)} createRoot(document.getElementById('root')).render(React.createElement(globalThis.TestIntent,{root:'D:/test',project:'A',projectId:'A',onClose(){}}));`
  const bundle = await build({ stdin: { contents: entry, resolveDir: fileURLToPath(new URL('../../../', import.meta.url)), loader: 'js' }, bundle: true, write: false, platform: 'browser', format: 'esm' })
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 320, height: 640 } })
  const id = 'INV-20261107000000-abcdef'
  const investigation = { investigationId: id, sessionId: 'one', inputRevision: 1, question: '现有实现是什么', summary: '调查摘要', verdict: 'answered', source: 'observed_evidence', findings: [{ claim: '找到实现', refs: [{ path: 'src/example.js', line: 1, quote: 'export const example = true', verified: true }] }] }
  const session = { sessionId: 'one', state: 'reviewing', sessionRevision: 1, input: { text: '原话', inputRevision: 1, explicit: {} }, items: [{ itemId: 'I-1', recommendedRoute: 'create', candidate: {}, unknowns: [{ description: '需要核对实现', blocking: true, resolution: 'investigate' }] }], readiness: { ready: false, reasons: [] } }
  let adoptionBody
  await page.route('http://test.local/**', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div><script type="module" src="/app.js"></script>' })
    if (url.pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text })
    if (url.searchParams.get('action') === 'history') return route.fulfill({ json: { sessions: [{ sessionId: 'one', state: 'reviewing' }] } })
    if (request.method() === 'POST' && request.postDataJSON()?.action === 'adopt-investigation') {
      adoptionBody = request.postDataJSON()
      return route.fulfill({ json: { session: { ...session, sessionRevision: 2, readiness: { ready: false, reasons: [], investigationAdoptions: [{ itemId: 'I-1', unknownDescription: '需要核对实现', inputRevision: 1, investigationId: id, referencesCurrent: true }] } } } })
    }
    return route.fulfill({ json: { session, investigations: [investigation] } })
  })
  try {
    await page.goto('http://test.local/')
    await page.getByRole('button', { name: '查看服务端意图历史' }).click()
    await page.getByRole('button', { name: /one · reviewing/ }).click()
    const group = page.getByRole('group', { name: /需要核对实现/ })
    assert.equal(await group.getByRole('button', { name: '转调查' }).getAttribute('aria-pressed'), 'true')
    assert.equal(await group.getByRole('button', { name: '澄清' }).getAttribute('aria-pressed'), 'false')
    await page.getByText('采纳调查证据', { exact: true }).click()
    assert.equal(await page.getByText('export const example = true').isVisible(), true)
    const described = await page.getByRole('button', { name: '采纳用于此未知项' }).getAttribute('aria-describedby')
    assert.equal(await page.evaluate(ids => ids.split(' ').every(id => Boolean(document.getElementById(id))), described), true)
    assert.match(await page.evaluate(ids => ids.split(' ').map(id => document.getElementById(id).textContent).join(' '), described), /需要核对实现.*现有实现是什么/)
    await page.getByRole('button', { name: '采纳用于此未知项' }).click()
    await page.getByText(/引用本次读取时有效/).waitFor()
    assert.equal(adoptionBody.investigationId, id)
    assert.equal(adoptionBody.unknownDescription, '需要核对实现')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true)
  } finally { await browser.close() }
})

for (const { origin, outcome } of [{ origin: 'answer', outcome: 'done' }, { origin: 'retry', outcome: 'done' }, { origin: 'retry', outcome: 'error' }]) test(`restored ${origin} analysis monitors ${outcome}`, async () => {
  const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')
  const marker = '    return {\n      inject:'
  const entry = `import React from 'react'; import {createRoot} from 'react-dom/client';
    window.__ModuleLoader__={load({factory}){factory(()=>React)}}; ${source.replace(marker, '    globalThis.TestIntent = IntentModal;\n' + marker)}
    createRoot(document.getElementById('root')).render(React.createElement(globalThis.TestIntent,{root:'D:/test',project:'A',projectId:'A',onClose(){}}));`
  const bundle = await build({ stdin: { contents: entry, resolveDir: fileURLToPath(new URL('../../../', import.meta.url)), loader: 'js' }, bundle: true, write: false, platform: 'browser', format: 'esm' })
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 320, height: 640 } })
  const session = { sessionId: 'one', state: 'reviewing', sessionRevision: 1, input: { rawText: '原话', inputRevision: 1, explicit: {} }, items: [], answers: [], historicalAnswers: [{ answerId: 'old', questionText: '旧问题', text: '旧答案', inputRevision: 1 }], historicalAnswersOmitted: 0, nextQuestion: { questionId: 'q', text: '请选择', options: [{ id: 'a', label: '选项 A' }] } }
  let polls = 0
  await page.route('http://test.local/**', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div><script type="module" src="/app.js"></script>' })
    if (url.pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text })
    if (url.searchParams.get('action') === 'history') return route.fulfill({ json: { sessions: [{ sessionId: 'one', state: 'reviewing' }] } })
    if (request.method() === 'POST' && request.postDataJSON()?.action === 'load') { polls++; return route.fulfill({ json: { session, analysisStatus: { status: outcome, origin, ...(outcome === 'error' ? { error: { message: '分析未完成' } } : {}) } } }) }
    return route.fulfill({ json: { session, analysisStatus: { status: 'running', origin } } })
  })
  try {
    await page.goto('http://test.local/')
    await page.getByRole('button', { name: '查看服务端意图历史' }).click()
    await page.getByRole('button', { name: /one · reviewing/ }).click()
    await page.getByText(outcome === 'error' ? '重新分析失败：分析未完成；可重新分析。' : origin === 'retry' ? '重新分析已完成，会话已更新。' : '已记录你的回答，候选已更新').waitFor({ timeout: 4000 })
    const blocker = page.getByTestId('intent-confirm-blocker')
    await page.keyboard.press('Tab')
    await blocker.focus()
    assert.equal(await blocker.evaluate(node => document.activeElement === node && getComputedStyle(node).outlineStyle !== 'none' && parseFloat(getComputedStyle(node).outlineWidth) > 0), true)
    assert.equal(await page.getByTestId('intent-review-notice').getAttribute('role'), 'status')
    const history = page.getByText('历史回答（1 条）')
    await history.focus(); await page.keyboard.press('Enter')
    assert.equal(await page.getByText('旧问题').isVisible(), true)
    assert.equal(await page.getByText(/不作为当前输入的已确认决定/).isVisible(), true)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true)
    if (origin === 'retry') assert.match(await page.getByTestId('intent-review-notice').innerText(), /重新分析/)
    if (origin === 'retry') assert.equal(await page.getByText('已记录你的回答，候选已更新').count(), 0)
    assert.equal(polls, 1)
    assert.equal(await page.getByRole('button', { name: '重新分析', exact: true, includeHidden: true }).isEnabled(), true)
  } finally { await browser.close() }
})

test('switching projects clears answer check state and ignores a late result', async () => {
  const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')
  const marker = '    return {\n      inject:'
  const entry = `import React from 'react'; import {createRoot} from 'react-dom/client';
    window.__ModuleLoader__={load({factory}){factory(()=>React)}}; ${source.replace(marker, '    globalThis.TestIntent = IntentModal;\n' + marker)}
    const root=createRoot(document.getElementById('root'));
    window.showProject = project => root.render(React.createElement(globalThis.TestIntent,{root:'D:/test',project,projectId:project,onClose(){}}));
    window.showProject('A');`
  const bundle = await build({ stdin: { contents: entry, resolveDir: fileURLToPath(new URL('../../../', import.meta.url)), loader: 'js' }, bundle: true, write: false, platform: 'browser', format: 'esm' })
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  let delayCheck = false, releaseCheck
  const checkGate = new Promise(resolve => { releaseCheck = resolve })
  const session = id => ({ sessionId: id, state: 'reviewing', sessionRevision: 1, input: { rawText: '原话', inputRevision: 1, explicit: {} }, items: [], answers: [], nextQuestion: { questionId: 'q', text: '请选择', options: [{ id: 'a', label: '选项 A' }] } })
  await page.route('http://test.local/**', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div><script type="module" src="/app.js"></script>' })
    if (url.pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text })
    const id = url.searchParams.get('project') === 'B' ? 'two' : 'one'
    if (request.method() === 'POST' && request.postDataJSON()?.action === 'answer') return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false }) })
    if (url.searchParams.has('session') && delayCheck && id === 'one') {
      await checkGate
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ session: { ...session(id), answers: [{ text: '旧会话迟到回答' }] } }) }).catch(() => {})
    }
    const payload = url.searchParams.get('action') === 'history' ? { sessions: [{ sessionId: id, state: 'reviewing' }] } : { session: session(id) }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(payload) })
  })
  try {
    await page.goto('http://test.local/')
    await page.getByRole('button', { name: '查看服务端意图历史' }).click()
    await page.getByRole('button', { name: /one · reviewing/ }).click()
    await page.getByRole('button', { name: '选项 A' }).click()
    await page.getByRole('button', { name: '提交回答' }).click()
    await page.getByText('结果未知', { exact: true }).waitFor()
    delayCheck = true
    await page.getByRole('button', { name: '核对服务端回答' }).click()
    await page.getByRole('button', { name: '读取中…' }).waitFor()
    await page.evaluate(() => window.showProject('B'))
    await page.getByRole('button', { name: '查看服务端意图历史' }).click()
    await page.getByRole('button', { name: /two · reviewing/ }).click()
    await page.getByRole('button', { name: '选项 A' }).click()
    await page.getByRole('button', { name: '提交回答' }).click()
    await page.getByText('结果未知', { exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: '核对服务端回答' }).isEnabled(), true)
    releaseCheck()
    await page.getByRole('button', { name: '核对服务端回答' }).click()
    await page.getByText('读取时尚无已记录的回答。').waitFor()
    assert.equal(await page.getByText('旧会话迟到回答').count(), 0)
  } finally { releaseCheck(); await browser.close() }
})

test('answer cancellation and failed analysis report the correct save state', async () => {
  const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')
  const marker = '    return {\n      inject:'
  const entry = `import React from 'react'; import {createRoot} from 'react-dom/client';
    window.__ModuleLoader__={load({factory}){factory(()=>React)}}; ${source.replace(marker, '    globalThis.TestIntent = IntentModal;\n' + marker)}
    createRoot(document.getElementById('root')).render(React.createElement(globalThis.TestIntent,{root:'D:/test',project:'A',projectId:'A',onClose(){}}));`
  const bundle = await build({ stdin: { contents: entry, resolveDir: fileURLToPath(new URL('../../../', import.meta.url)), loader: 'js' }, bundle: true, write: false, platform: 'browser', format: 'esm' })
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  const session = { sessionId: 'one', state: 'reviewing', sessionRevision: 1, input: { rawText: '原话', inputRevision: 1, explicit: {} }, items: [], answers: [], nextQuestion: { questionId: 'q1', text: '请选择', options: [{ id: 'a', label: '选项 A' }] } }
  let answerMode = 'delay', releaseAnswer, delayCheck = false, badCheck = null
  const answerGate = new Promise(resolve => { releaseAnswer = resolve })
  await page.route('http://test.local/**', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div><script type="module" src="/app.js"></script>' })
    if (url.pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text })
    if (url.searchParams.has('session') && delayCheck) {
      await new Promise(resolve => setTimeout(resolve, 600))
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ session: { ...session, answers: [{ answerId: 'late', text: '迟到回答' }] } }) }).catch(() => {})
    }
    if (url.searchParams.has('session') && badCheck) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ session: badCheck }) })
    const body = request.method() === 'POST' ? request.postDataJSON() : null
    if (body?.action === 'answer' && answerMode === 'delay') { await answerGate; return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ session }) }).catch(() => {}) }
    if (body?.action === 'answer' && answerMode === 'server-error') return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false }) })
    if (body?.action === 'answer' && answerMode === 'stale') return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'stale-session', message: '会话已变化' } }) })
    const payload = body?.action === 'answer' ? { session, ...(answerMode === 'unknown' ? {} : { analysisStatus: answerMode === 'running' ? { status: 'running' } : { status: 'error', error: { message: '模型不可用' } } }) } : url.searchParams.get('action') === 'history' ? { sessions: [{ sessionId: 'one', state: 'reviewing' }] } : { session }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(payload) })
  })
  try {
    await page.goto('http://test.local/')
    const analyze = page.getByRole('button', { name: '分析意图' })
    assert.equal(await analyze.isDisabled(), true)
    const disabledAnalyzeBackground = await analyze.evaluate(node => getComputedStyle(node).backgroundColor)
    await page.getByRole('textbox', { name: '用你自己的话写下想改变什么' }).fill('临时输入')
    assert.equal(await analyze.isEnabled(), true)
    assert.notEqual(await analyze.evaluate(node => getComputedStyle(node).backgroundColor), disabledAnalyzeBackground)
    await page.getByRole('textbox', { name: '用你自己的话写下想改变什么' }).fill('')
    await page.getByRole('button', { name: '查看服务端意图历史' }).click()
    await page.getByRole('button', { name: /one · reviewing/ }).click()
    const answerSubmit = page.getByRole('button', { name: '提交回答' })
    assert.equal(await answerSubmit.isDisabled(), true)
    const disabledAnswerBackground = await answerSubmit.evaluate(node => getComputedStyle(node).backgroundColor)
    await page.getByRole('button', { name: '选项 A' }).click()
    assert.equal(await answerSubmit.isEnabled(), true)
    assert.notEqual(await answerSubmit.evaluate(node => getComputedStyle(node).backgroundColor), disabledAnswerBackground)
    await page.evaluate(() => {
      const original = window.setTimeout
      window.setTimeout = (callback, delay, ...args) => original(callback, delay === 10000 ? 300 : delay, ...args)
    })
    await page.getByRole('button', { name: '提交回答' }).click()
    await page.getByRole('button', { name: '取消提交' }).click()
    await page.getByText(/已停止等待，回答可能已保存/).waitFor()
    assert.equal(await page.getByText('结果未知', { exact: true }).isVisible(), true)
    assert.equal(await page.getByRole('button', { name: '重试提交' }).count(), 0)
    delayCheck = true
    await page.getByRole('button', { name: '核对服务端回答' }).click()
    await page.getByText('核对失败：读取超时；本地输入仍保留。').waitFor()
    delayCheck = false
    badCheck = { ...session, sessionId: 'other', answers: [{ text: '其他会话回答' }] }
    await page.getByRole('button', { name: '核对服务端回答' }).click()
    await page.getByText('核对失败：返回的会话与当前会话不一致；本地输入仍保留。').waitFor()
    assert.equal(await page.getByText('其他会话回答').count(), 0)
    badCheck = { ...session, answers: [{ text: { invalid: true } }] }
    await page.getByRole('button', { name: '核对服务端回答' }).click()
    await page.getByText('核对失败：会话回答不可用；本地输入仍保留。').waitFor()
    badCheck = null
    session.answers = [{ answerId: 'a1', questionText: '请选择', optionLabel: '选项 A' }]
    await page.getByRole('button', { name: '核对服务端回答' }).click()
    await page.getByText('请选择 · 选项 A').waitFor()
    assert.equal(await page.getByRole('status').filter({ hasText: '已停止等待，回答可能已保存' }).count(), 1)
    assert.equal(await page.locator('[role="status"] [role="status"]').count(), 0)
    await page.waitForTimeout(700)
    assert.equal(await page.getByText('迟到回答', { exact: true }).count(), 0)
    assert.equal(await page.getByText(/先前请求仍可能在读取后完成/).isVisible(), true)
    releaseAnswer()
    delayCheck = true
    await page.getByRole('button', { name: '核对服务端回答' }).click()
    answerMode = 'server-error'
    await page.getByRole('button', { name: '提交回答' }).click()
    await page.getByText(/未收到提交结果，回答可能已保存/).waitFor()
    await page.waitForTimeout(700)
    assert.equal(await page.getByText('迟到回答', { exact: true }).count(), 0)
    assert.equal(await page.getByRole('button', { name: '核对服务端回答' }).isEnabled(), true)
    delayCheck = false
    answerMode = 'stale'
    session.sessionRevision = 2
    await page.getByRole('textbox', { name: /回答/ }).fill('保留的回答文字')
    delayCheck = true
    await page.getByRole('button', { name: '提交回答' }).click()
    await page.getByText('会话已变化，读取最新会话失败；本地回答仍保留，请重新打开会话核对。').waitFor()
    assert.equal(await page.getByRole('textbox', { name: /回答/ }).inputValue(), '保留的回答文字')
    delayCheck = false
    await page.getByRole('button', { name: '提交回答' }).click()
    await page.getByText('已读取最新会话；请核对问题和保留的文字后重新作答。').waitFor()
    await page.waitForTimeout(700)
    assert.equal(await page.getByText('已读取最新会话；请核对问题和保留的文字后重新作答。').isVisible(), true)
    assert.equal(await page.getByRole('textbox', { name: /回答/ }).inputValue(), '保留的回答文字')
    answerMode = 'analysis-error'
    await page.getByRole('button', { name: '提交回答' }).click()
    await page.getByText('回答已记录，但重新分析失败：模型不可用；可点“重新分析”。').waitFor()
    assert.equal(await page.getByText('回答已记录', { exact: true }).isVisible(), true)
    assert.equal(await page.getByText('提交失败', { exact: true }).count(), 0)
    await page.evaluate(() => {
      const original = window.fetch
      window.fetch = (input, init) => {
        if (init?.body && JSON.parse(init.body).action === 'load') {
          if (window.pollResult) return Promise.resolve(new Response(JSON.stringify(window.pollResult), { status: 200 }))
          return new Promise(resolve => { window.releasePoll = () => resolve(new Response(JSON.stringify({ session: { sessionId: 'late-poll' }, analysisStatus: { status: 'done' } }), { status: 200 })) })
        }
        return original(input, init)
      }
    })
    answerMode = 'running'
    await page.getByRole('textbox', { name: /回答/ }).fill('再次回答')
    await page.getByRole('button', { name: '提交回答' }).click()
    await page.getByText('回答已记录，但刷新会话失败：读取超时').waitFor({ timeout: 4000 })
    assert.equal(await page.getByRole('button', { name: '重新分析', exact: true, includeHidden: true }).isEnabled(), true)
    await page.evaluate(() => window.releasePoll())
    assert.equal(await page.getByText('回答已记录，但刷新会话失败：读取超时').isVisible(), true)
    assert.equal(await page.getByText('late-poll').count(), 0)
    answerMode = 'unknown'
    await page.getByRole('textbox', { name: /回答/ }).fill('新的回答')
    await page.getByRole('button', { name: '提交回答' }).click()
    await page.getByText('回答已记录，但重新分析状态未知；请核对会话后重新分析。').waitFor()
    assert.equal(await page.getByText('已记录你的回答，已更新候选').count(), 0)
    answerMode = 'running'
    await page.evaluate(() => { window.pollResult = { session: { sessionId: 'other' }, analysisStatus: { status: 'done' } } })
    await page.getByRole('textbox', { name: /回答/ }).fill('再次核对')
    await page.getByRole('button', { name: '提交回答' }).click()
    await page.getByText('回答已记录，但刷新会话失败：返回的会话与当前会话不一致').waitFor({ timeout: 4000 })
    await page.evaluate(() => { window.pollResult = { session: { sessionId: 'one', state: 'reviewing', input: { rawText: '原话', inputRevision: 1, explicit: {} }, items: [], answers: [], nextQuestion: { questionId: 'q1', text: '请选择', options: [{ id: 'a', label: '选项 A' }] } } } })
    await page.getByRole('textbox', { name: /回答/ }).fill('状态核对')
    await page.getByRole('button', { name: '提交回答' }).click()
    await page.getByText('回答已记录，但刷新会话失败：重新分析状态未知，请核对会话后重新分析').waitFor({ timeout: 4000 })
  } finally { await browser.close() }
})

test('review prioritizes real question group at desktop and narrow sizes', async () => {
  const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')
  const marker = '    return {\n      inject:'
  const entry = `import React from 'react'; import {createRoot} from 'react-dom/client';
    window.__ModuleLoader__={load({factory}){factory(()=>React)}}; ${source.replace(marker, '    globalThis.TestIntent = IntentModal;\n' + marker)}
    createRoot(document.getElementById('root')).render(React.createElement(globalThis.TestIntent,{root:'D:/test',project:'A',projectId:'A',onClose(){}}));`
  const bundle = await build({ stdin: { contents: entry, resolveDir: fileURLToPath(new URL('../../../', import.meta.url)), loader: 'js' }, bundle: true, write: false, platform: 'browser', format: 'esm' })
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1282, height: 823 } })
  const session = { sessionId: 'group', state: 'reviewing', sessionRevision: 1, input: { rawText: '图片', inputRevision: 1, explicit: {} }, items: [{ itemId: 'I-1', userProblem: '材料展示了 token、缓存命中和上下文统计，但尚未明确希望改变什么。', desiredOutcome: '区分数据解释、异常核查和功能改动' }], answers: [], questionGroup: { groupId: 'G1', questions: [{ questionId: 'Q1', text: '你希望针对这张截图做什么？', status: 'open', options: [{ id: 'a', label: '解释统计数据' }, { id: 'b', label: '核查异常' }] }] } }
  let releaseAnswer, answerConflict = false, failReload = false, answerRunning = false
  const answerGate = new Promise(resolve => { releaseAnswer = resolve })
  await page.route('http://test.local/**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/app.js"></script>' })
    if (url.pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text })
    if (route.request().method() === 'POST' && route.request().postDataJSON()?.action === 'answer') {
      if (answerConflict) return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'stale-session', message: '会话已变化' } }) })
      await answerGate; return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ session, ...(answerRunning ? { analysisStatus: { status: 'running' } } : {}) }) }).catch(() => {})
    }
    if (failReload && url.searchParams.has('session')) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false }) })
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(url.searchParams.get('action') === 'history' ? { sessions: [{ sessionId: 'group', state: 'reviewing' }] } : { session }) })
  })
  try {
    await page.goto('http://test.local/')
    await page.getByRole('button', { name: '查看服务端意图历史' }).click()
    await page.getByRole('button', { name: /group · reviewing/ }).click()
    const group = page.getByTestId('intent-question-group')
    await group.waitFor()
    const submit = group.getByRole('button', { name: '提交本组回答' })
    assert.equal(await submit.isDisabled(), true)
    const disabledBackground = await submit.evaluate(node => getComputedStyle(node).backgroundColor)
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--dsw-alias-bg-layer-1', '#f4f5f6')
      document.documentElement.style.setProperty('--dsw-alias-label-primary', '#111111')
      document.documentElement.style.setProperty('--dsw-alias-label-secondary', '#333333')
      document.documentElement.style.setProperty('--dsw-alias-border-l1', '#cccccc')
    })
    const lightDisabledBackground = await submit.evaluate(node => getComputedStyle(node).backgroundColor)
    assert.notEqual(lightDisabledBackground, disabledBackground)
    const headerVisible = await page.getByRole('button', { name: '关闭弹窗' }).evaluate(node => {
      const button = node.getBoundingClientRect(), dialog = node.closest('[role="dialog"]').getBoundingClientRect()
      return button.top >= dialog.top && button.bottom <= dialog.bottom
    })
    assert.equal(headerVisible, true, 'restoring history must keep the close control in view')
    const box = await group.boundingBox()
    assert.ok(box.y < 450, `question starts at ${box.y}`)
    assert.equal(await page.getByRole('button', { name: '重新分析' }).isVisible(), false)
    await page.setViewportSize({ width: 320, height: 640 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true)
    assert.equal(await page.getByRole('button', { name: '关闭弹窗' }).evaluate(node => {
      const button = node.getBoundingClientRect(), dialog = node.closest('[role="dialog"]').getBoundingClientRect()
      return button.top >= dialog.top && button.bottom <= dialog.bottom
    }), true)
    await group.getByText('你希望针对这张截图做什么？').scrollIntoViewIfNeeded()
    assert.equal(await group.getByText('你希望针对这张截图做什么？').isVisible(), true)
    await group.getByRole('button', { name: '解释统计数据' }).click()
    assert.equal(await submit.isEnabled(), true)
    assert.notEqual(await submit.evaluate(node => getComputedStyle(node).backgroundColor), lightDisabledBackground)
    await group.getByRole('button', { name: '提交本组回答' }).click()
    await group.getByRole('button', { name: '取消提交' }).click()
    await group.getByText(/已停止等待，回答可能已保存/).waitFor()
    assert.equal(await group.getByText('结果未知', { exact: true }).isVisible(), true)
    assert.equal(await group.getByRole('button', { name: '重试提交' }).count(), 0)
    await group.getByRole('button', { name: '核对服务端回答' }).click()
    await group.getByText('读取时尚无已记录的回答。').waitFor()
    assert.equal(await group.getByRole('status').filter({ hasText: '已停止等待，回答可能已保存' }).count(), 1)
    assert.equal(await group.locator('[role="status"] [role="status"]').count(), 0)
    assert.equal(await group.getByText(/先前请求仍可能在读取后完成/).isVisible(), true)
    assert.equal(await group.getByRole('button', { name: '提交本组回答' }).isEnabled(), true)
    releaseAnswer()
    answerConflict = true
    failReload = true
    await group.getByRole('button', { name: '提交本组回答' }).click()
    await page.getByText('会话已变化，读取最新会话失败；本地回答仍保留，请重新打开会话核对。').waitFor()
    assert.equal(await group.getByRole('button', { name: '提交本组回答' }).isEnabled(), true)
    answerConflict = false
    failReload = false
    answerRunning = true
    await page.evaluate(() => {
      const originalTimeout = window.setTimeout
      window.setTimeout = (callback, delay, ...args) => originalTimeout(callback, delay === 10000 ? 100 : delay, ...args)
      const originalFetch = window.fetch
      window.fetch = (input, init) => {
        if (init?.body && JSON.parse(init.body).action === 'load') return new Promise(resolve => { window.releaseGroupPoll = () => resolve(new Response(JSON.stringify({ session: { sessionId: 'late-group' }, analysisStatus: { status: 'done' } }), { status: 200 })) })
        return originalFetch(input, init)
      }
    })
    await group.getByRole('button', { name: '提交本组回答' }).click()
    await page.getByText('回答已保存，但刷新会话失败：读取超时').waitFor({ timeout: 4000 })
    assert.equal(await group.getByRole('button', { name: '重新分析', exact: true }).isEnabled(), true)
    await page.evaluate(() => window.releaseGroupPoll())
    assert.equal(await page.getByText('回答已保存，但刷新会话失败：读取超时').isVisible(), true)
    assert.equal(await page.getByText('late-group').count(), 0)
    answerRunning = false
    await group.getByRole('button', { name: '解释统计数据' }).click()
    await page.getByText('分析与草案信息').click()
    await page.getByRole('button', { name: '重新分析', exact: true }).click()
    await page.getByText('请先保存或取消正在编辑的正文和回答，再重新分析。').waitFor()
    assert.equal(await group.getByRole('button', { name: '提交本组回答' }).isEnabled(), true)
    await group.getByRole('button', { name: '提交本组回答' }).click()
    await page.getByText('回答已保存，但重新分析状态未知；请核对会话后重新分析。').waitFor()
  } finally { await browser.close() }
})

test('unsubmitted session answer recovers only against the same server revision', async () => {
  const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')
  const marker = '    return {\n      inject:'
  const entry = `import React from 'react'; import {createRoot} from 'react-dom/client';
    window.__ModuleLoader__={load({factory}){factory(()=>React)}}; ${source.replace(marker, '    globalThis.TestIntent = IntentModal;\n' + marker)}
    const root=createRoot(document.getElementById('root'));
    window.showIntent = show => root.render(show ? React.createElement(React.StrictMode,null,React.createElement(globalThis.TestIntent,{root:'D:/test',project:'A',projectId:'A',onClose(){window.showIntent(false)}})) : null);
    window.showIntent(true);`
  const result = await build({ stdin: { contents: entry, resolveDir: fileURLToPath(new URL('../../../', import.meta.url)), loader: 'js' }, bundle: true, write: false, platform: 'browser', format: 'esm' })
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  let revision = 1, inputRevision = 1, writes = 0, delaySession = false
  const session = () => ({ sessionId: 'one', state: 'reviewing', sessionRevision: revision, input: { rawText: '原话', inputRevision, explicit: {} }, items: [], nextQuestion: { text: '请选择', options: [{ id: 'a', label: '选项 A' }] } })
  await page.route('http://test.local/**', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div><script type="module" src="/app.js"></script>' })
    if (url.pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: result.outputFiles[0].text })
    if (request.method() !== 'GET') writes++
    if (delaySession && url.searchParams.has('session')) await new Promise(resolve => setTimeout(resolve, 800))
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(url.searchParams.get('action') === 'history' ? { sessions: [{ sessionId: 'one', state: 'reviewing' }] } : { session: session() }) })
  })
  try {
    await page.goto('http://test.local/')
    await page.getByRole('button', { name: '查看服务端意图历史' }).click()
    await page.getByRole('button', { name: /one · reviewing/ }).click()
    const question = page.getByRole('button', { name: '选项 A' })
    const diagnostics = page.getByText('分析与草案信息', { exact: true })
    await question.waitFor()
    assert.equal(await page.getByRole('button', { name: '重新分析' }).isVisible(), false)
    assert.ok((await question.boundingBox()).y < (await diagnostics.boundingBox()).y)
    await diagnostics.click()
    assert.equal(await page.getByRole('button', { name: '重新分析' }).isVisible(), true)
    await page.getByRole('button', { name: '选项 A' }).click()
    await page.evaluate(() => window.showIntent(false))
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    await page.evaluate(() => window.showIntent(true))
    await page.getByRole('button', { name: '查看服务端意图历史' }).click()
    await page.getByRole('button', { name: /one · reviewing/ }).click()
    await page.getByRole('button', { name: '选项 A' }).click()
    await page.evaluate(() => window.showIntent(false))
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    await page.evaluate(() => window.showIntent(true))
    assert.equal(await page.getByRole('button', { name: '核对版本并恢复编辑' }).count(), 2)
    delaySession = true
    await page.getByRole('button', { name: '核对版本并恢复编辑' }).first().click()
    await page.getByRole('textbox', { name: '用你自己的话写下想改变什么' }).fill('恢复期间输入')
    await page.getByText('加载期间输入已变化，当前内容已保留；请重新选择历史会话。').waitFor()
    assert.equal(await page.getByRole('textbox', { name: '用你自己的话写下想改变什么' }).inputValue(), '恢复期间输入')
    assert.equal(await page.getByRole('button', { name: '核对版本并恢复编辑' }).count(), 2)
    await page.getByRole('textbox', { name: '用你自己的话写下想改变什么' }).fill('')
    delaySession = false
    await page.getByRole('button', { name: '核对版本并恢复编辑' }).first().click()
    assert.equal(await page.getByRole('button', { name: '选项 A' }).getAttribute('aria-pressed'), 'true')
    await page.evaluate(() => window.showIntent(false))
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    revision = 2
    await page.evaluate(() => window.showIntent(true))
    assert.equal(await page.getByRole('button', { name: '核对版本并恢复编辑' }).count(), 2)
    const saved = page.getByRole('group', { name: '本地编辑 one 1' })
    await saved.getByRole('button', { name: '核对版本并恢复编辑' }).click()
    await page.getByText(/服务端会话已变化或版本未知/).waitFor()
    await page.getByRole('button', { name: '重试加载' }).click()
    await page.getByText(/服务端会话已变化或版本未知/).waitFor()
    await saved.getByText('查看本地未提交内容').click()
    assert.equal(await saved.getByText(/"choice": "a"/).isVisible(), true)
    assert.equal(writes, 0)
    page.once('dialog', dialog => dialog.dismiss())
    await saved.getByRole('button', { name: '丢弃本地编辑' }).click()
    assert.equal(await page.getByRole('button', { name: '核对版本并恢复编辑' }).count(), 2)
    page.once('dialog', dialog => dialog.accept())
    await saved.getByRole('button', { name: '丢弃本地编辑' }).click()
    assert.equal(await page.getByRole('button', { name: '核对版本并恢复编辑' }).count(), 1)
    revision = 1; inputRevision = undefined
    await page.getByRole('button', { name: '核对版本并恢复编辑' }).click()
    await page.getByText(/服务端会话已变化或版本未知/).waitFor()
    assert.equal(await page.getByRole('button', { name: '核对版本并恢复编辑' }).count(), 1)
    assert.equal(writes, 0)
    await page.getByRole('button', { name: '查看服务端意图历史' }).click()
    await page.getByRole('button', { name: /one · reviewing/ }).click()
    await page.getByRole('button', { name: '选项 A' }).click()
    await page.evaluate(() => window.showIntent(false))
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    await page.evaluate(() => window.showIntent(true))
    await page.getByRole('group', { name: '本地编辑 one 2' }).getByRole('button', { name: '核对版本并恢复编辑' }).click()
    await page.getByText(/服务端会话已变化或版本未知/).waitFor()
    assert.equal(await page.getByRole('button', { name: '核对版本并恢复编辑' }).count(), 2)
    assert.equal(writes, 0)
  } finally { await browser.close() }
})

test('unmounted input can be recovered in the same project without persisting it', async () => {
  const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')
  const marker = '    return {\n      inject:'
  const entry = `import React from 'react'; import {createRoot} from 'react-dom/client';
    window.__ModuleLoader__={load({factory}){factory(()=>React)}}; ${source.replace(marker, '    globalThis.TestIntent = IntentModal;\n' + marker)}
    const root=createRoot(document.getElementById('root'));
    window.showIntent = project => root.render(project ? React.createElement(React.StrictMode, null, React.createElement(globalThis.TestIntent,{root:'D:/test',project,projectId:project,onClose(){window.showIntent(null)}})) : null);
    window.showIntent('A');`
  const result = await build({ stdin: { contents: entry, resolveDir: fileURLToPath(new URL('../../../', import.meta.url)), loader: 'js' }, bundle: true, write: false, platform: 'browser', format: 'esm' })
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  let intakeRequests = 0, delayIntake = false
  await page.route('http://test.local/**', async route => {
    if (route.request().url().includes('/api/alm/requirements/intake')) {
      intakeRequests++
      if (delayIntake) await new Promise(resolve => setTimeout(resolve, 800))
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ schema: 'alm.intake.chat/v1', messages: [{ id: '1', ref: '1', speaker: '用户', text: '待恢复聊天' }], text: '待恢复聊天' }) }).catch(() => {})
    }
    return route.fulfill(route.request().url().endsWith('/app.js')
      ? { contentType: 'text/javascript', body: result.outputFiles[0].text }
      : { contentType: 'text/html', body: '<div id="root"></div><script type="module" src="/app.js"></script>' })
  })
  try {
    await page.goto('http://test.local/')
    await page.getByRole('textbox', { name: '用你自己的话写下想改变什么' }).fill('待恢复原话')
    await page.getByRole('button', { name: '从聊天记录补充' }).click()
    await page.getByRole('textbox', { name: '聊天记录' }).fill('待恢复聊天')
    await page.getByRole('button', { name: '解析聊天' }).click()
    await page.getByText('解析 1 条消息').waitFor()
    await page.locator('input[type="file"]').setInputFiles({ name: 'capture.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') })
    await page.getByRole('img', { name: 'capture.png' }).waitFor()
    await page.evaluate(() => window.showIntent(null))
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    await page.evaluate(() => window.showIntent('B'))
    assert.equal(await page.getByRole('textbox', { name: '用你自己的话写下想改变什么' }).inputValue(), '')
    await page.evaluate(() => window.showIntent(null))
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    await page.evaluate(() => window.showIntent('A'))
    assert.equal(await page.getByRole('textbox', { name: '用你自己的话写下想改变什么' }).inputValue(), '待恢复原话')
    assert.equal(await page.getByRole('textbox', { name: '聊天记录' }).inputValue(), '待恢复聊天')
    assert.equal(await page.getByText('解析 1 条消息').isVisible(), true)
    assert.equal(intakeRequests, 1)
    const preview = page.getByRole('img', { name: 'capture.png' })
    assert.match(await preview.getAttribute('src'), /^data:image\/png;base64,/)
    assert.equal(await preview.evaluate(node => node.complete && node.naturalWidth > 0), true)
    assert.equal(await page.getByText(/已恢复本窗口中未提交的输入/).isVisible(), true)
    page.once('dialog', dialog => dialog.accept())
    await page.getByRole('button', { name: '关闭弹窗' }).click()
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    await page.evaluate(() => window.showIntent('A'))
    assert.equal(await page.getByRole('textbox', { name: '用你自己的话写下想改变什么' }).inputValue(), '')
    await page.evaluate(() => {
      const original = FileReader.prototype.readAsDataURL
      FileReader.prototype.readAsDataURL = function (file) { setTimeout(() => original.call(this, file), 500) }
    })
    await page.locator('input[type="file"]').setInputFiles({ name: 'pending.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') })
    await page.evaluate(() => window.showIntent(null))
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    await page.evaluate(() => window.showIntent('A'))
    await page.getByRole('img', { name: 'pending.png' }).waitFor()
    assert.equal(await page.getByRole('img', { name: 'pending.png' }).count(), 1)
    assert.equal(await page.getByRole('img', { name: 'pending.png' }).evaluate(node => node.complete && node.naturalWidth > 0), true)
    await page.getByRole('button', { name: '从聊天记录补充' }).click()
    await page.getByRole('textbox', { name: '聊天记录' }).fill('解析中切换')
    delayIntake = true
    await page.getByRole('button', { name: '解析聊天' }).click()
    await page.getByText('正在解析聊天记录…').waitFor()
    await page.evaluate(() => window.showIntent(null))
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    await page.evaluate(() => window.showIntent('A'))
    await page.getByText(/聊天解析已中断，请重新解析/).waitFor()
    await page.waitForTimeout(1000)
    assert.equal(await page.getByText('解析 1 条消息').count(), 0)
    assert.equal(await page.getByRole('textbox', { name: '聊天记录' }).inputValue(), '解析中切换')
  } finally { await browser.close() }
})

test('clarification history timeout preserves input and retries in the browser', async () => {
  const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')
  const marker = '    return {\n      inject:'
  assert.ok(source.includes(marker))
  const entry = `import React from 'react'; import {createRoot} from 'react-dom/client';
    window.__ModuleLoader__={load({factory}){factory(()=>React)}}; ${source.replace(marker, '    globalThis.TestIntent = IntentModal;\n' + marker)}
    createRoot(document.getElementById('root')).render(React.createElement(globalThis.TestIntent,{root:'D:/test',project:'A',projectId:'A',onClose(){}}));`
  const result = await build({ stdin: { contents: entry, resolveDir: fileURLToPath(new URL('../../../', import.meta.url)), loader: 'js' }, bundle: true, write: false, platform: 'browser', format: 'esm' })
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  let requests = 0, sessionRequests = 0
  await page.addInitScript(() => {
    const original = window.setTimeout
    window.setTimeout = (callback, delay, ...args) => original(callback, delay === 10000 ? 100 : delay, ...args)
  })
  await page.route('http://test.local/**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div><script type="module" src="/app.js"></script>' })
    if (url.pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: result.outputFiles[0].text })
    if (url.searchParams.get('action') === 'history') {
      if (++requests === 1) { await new Promise(resolve => setTimeout(resolve, 600)); return route.abort().catch(() => {}) }
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ sessions: [{ sessionId: 'one', state: 'reviewing' }] }) })
    }
    assert.equal(url.searchParams.get('session'), 'one')
    sessionRequests++
    await new Promise(resolve => setTimeout(resolve, 600))
    return route.abort().catch(() => {})
  })
  try {
    await page.goto('http://test.local/')
    const input = page.getByRole('textbox', { name: '用你自己的话写下想改变什么' })
    await input.fill('保留这段未提交的内容')
    await page.getByRole('button', { name: '查看服务端意图历史' }).click()
    await page.getByText('读取意图历史超时，请重试。').waitFor()
    assert.equal(await input.inputValue(), '保留这段未提交的内容')
    await page.getByRole('button', { name: '重试加载' }).click()
    await page.getByText('读取意图历史超时，请重试。').waitFor({ state: 'hidden' })
    assert.equal(await input.inputValue(), '保留这段未提交的内容')
    assert.equal(requests, 2)
    page.once('dialog', dialog => dialog.accept())
    await page.getByRole('button', { name: /one · reviewing/ }).click()
    await page.getByText('读取意图历史超时，请重试。').waitFor()
    assert.equal(await input.inputValue(), '保留这段未提交的内容')
    assert.equal(sessionRequests, 1)
  } finally { await browser.close() }
})

test('clarification exposes candidate labels and keeps its controls within a narrow dialog', async () => {
  const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')
  const marker = '    return {\n      inject:'
  assert.ok(source.includes(marker))
  const entry = `import React from 'react'; import {createRoot} from 'react-dom/client';
    window.__ModuleLoader__={load({factory}){factory(()=>React)}}; ${source.replace(marker, '    globalThis.TestIntent = IntentModal;\n' + marker)}
    createRoot(document.getElementById('root')).render(React.createElement(globalThis.TestIntent,{root:'D:/test',project:'A',projectId:'A',onClose(){},onCreated(){},onOpenRequirement(){}}));`
  const result = await build({ stdin: { contents: entry, resolveDir: fileURLToPath(new URL('../../../', import.meta.url)), loader: 'js' }, bundle: true, write: false, platform: 'browser', format: 'esm' })
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 320, height: 640 } })
  const errors = []
  let delayHistory = false, historyLoads = 0, intentPosts = 0
  page.on('pageerror', error => errors.push(error.message))
  const candidate = { title: '退款进度', problem: '进度不可见', goal: '用户可查询', inScope: ['查询'], outOfScope: [], acceptance: [{ action: '查询', expected: '显示结果' }] }
  const session = { sessionId: 'one', state: 'reviewing', input: { rawText: '需要查询退款进度', inputRevision: 1, explicit: { owner: 'owner', priority: 'P1' } }, sessionRevision: 1, readiness: { ready: true, reasons: [], warnings: [] }, items: [{ itemId: 'I-1', recommendedRoute: 'create', userProblem: '进度不可见', candidate }] }
  await page.route('http://test.local/**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;background:#0f1115;color:white"><div id="root"></div><script type="module" src="/app.js"></script>' })
    if (url.pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: result.outputFiles[0].text })
    if (url.pathname === '/api/alm/requirements/intent' && route.request().method() === 'POST') { intentPosts++; return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ session }) }) }
    if (url.searchParams.get('action') === 'history') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ sessions: [{ sessionId: 'one', state: 'reviewing' }] }) })
    if (url.searchParams.get('session') === 'one') {
      historyLoads++
      if (delayHistory) await new Promise(resolve => setTimeout(resolve, 600))
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ session }) })
    }
    return route.fulfill({ contentType: 'application/json', body: '{"ok":true}' })
  })
  try {
    await page.goto('http://test.local/')
    const inputDialog = page.getByRole('dialog')
    assert.equal(await inputDialog.getAttribute('aria-labelledby'), 'intent-modal-title')
    assert.equal(await inputDialog.getAttribute('aria-describedby'), null)
    assert.equal(await inputDialog.evaluate(node => node.style.overscrollBehavior), 'contain')
    assert.equal(await page.getByRole('textbox', { name: '用你自己的话写下想改变什么' }).getAttribute('name'), 'intent-statement')
    assert.equal(await page.getByRole('textbox', { name: '用你自己的话写下想改变什么' }).getAttribute('autocomplete'), 'off')
    const imagePicker = page.getByRole('button', { name: '＋ 图片' })
    assert.equal(await imagePicker.evaluate(node => node.tagName), 'BUTTON')
    assert.equal(await page.locator('input[type="file"]').getAttribute('accept'), 'image/png,image/jpeg,image/webp')
    assert.equal(await page.locator('input[type="file"]').getAttribute('name'), 'intent-images')
    assert.equal(await page.locator('input[type="file"]').getAttribute('aria-label'), '选择图片')
    await page.evaluate(() => {
      window.revokedImageUrls = []
      const revoke = URL.revokeObjectURL.bind(URL)
      URL.revokeObjectURL = url => { window.revokedImageUrls.push(url); revoke(url) }
    })
    const chooser = page.waitForEvent('filechooser')
    await imagePicker.press('Enter')
    const fileChooser = await chooser
    assert.equal(fileChooser.isMultiple(), true)
    await fileChooser.setFiles({ name: 'test.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') })
    const preview = page.getByRole('img', { name: 'test.png' })
    await preview.waitFor()
    const previewUrl = await preview.getAttribute('src')
    assert.match(previewUrl, /^blob:/)
    await page.getByRole('button', { name: '移除图片 test.png' }).click()
    assert.deepEqual(await page.evaluate(() => window.revokedImageUrls), [previewUrl])
    await page.evaluate(() => {
      const data = new DataTransfer()
      data.items.add(new File(['gif'], 'unsupported.gif', { type: 'image/gif' }))
      data.items.add(new File(['text'], 'notes.txt', { type: 'text/plain' }))
      data.items.add(new File(['png'], 'supported.png', { type: 'image/png' }))
      document.querySelector('textarea[name="intent-statement"]').parentElement.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }))
    })
    await page.getByText(/unsupported\.gif 格式不支持/).waitFor()
    assert.equal(await page.getByRole('img', { name: 'unsupported.gif' }).count(), 0)
    assert.equal(await page.getByRole('img', { name: 'supported.png' }).count(), 1)
    await page.getByRole('button', { name: '移除图片 supported.png' }).click()
    assert.equal((await page.evaluate(() => window.revokedImageUrls)).length, 2)
    await page.getByRole('textbox', { name: '用你自己的话写下想改变什么' }).fill('临时输入')
    await page.evaluate(() => {
      window.savedFileReader = FileReader.prototype.readAsDataURL
      FileReader.prototype.readAsDataURL = function (file) { setTimeout(() => window.savedFileReader.call(this, file), 800) }
      const data = new DataTransfer()
      data.items.add(new File(['image'], 'pending-close.png', { type: 'image/png' }))
      document.querySelector('textarea[name="intent-statement"]').parentElement.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }))
    })
    await page.getByRole('button', { name: '分析意图' }).click()
    await page.getByText('图片正在读取，请稍后再分析。').waitFor()
    assert.equal(intentPosts, 0)
    await page.getByRole('button', { name: '手动填写候选' }).click()
    await page.getByText('图片正在读取，请稍后再填写候选。').waitFor()
    assert.equal(await page.getByRole('textbox', { name: '用你自己的话写下想改变什么' }).isVisible(), true)
    assert.equal(await page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented }), true)
    page.once('dialog', dialog => dialog.dismiss())
    await page.keyboard.press('Escape')
    await page.getByRole('img', { name: 'pending-close.png' }).waitFor()
    await page.getByRole('button', { name: '移除图片 pending-close.png' }).click()
    await page.getByRole('textbox', { name: '用你自己的话写下想改变什么' }).fill('')
    await page.evaluate(() => { FileReader.prototype.readAsDataURL = window.savedFileReader })
    await page.evaluate(() => {
      const target = document.querySelector('textarea[name="intent-statement"]').parentElement
      for (let batch = 0; batch < 2; batch++) {
        const data = new DataTransfer()
        for (let i = 0; i < 3; i++) data.items.add(new File(['image'], `batch-${batch}-${i}.png`, { type: 'image/png' }))
        target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }))
      }
    })
    await page.getByText(/最多 4 张图片/).waitFor()
    assert.equal(await page.locator('button[aria-label^="移除图片 "]').count(), 4)
    assert.equal((await page.evaluate(() => window.revokedImageUrls)).length, 5)
    for (let i = 0; i < 4; i++) await page.locator('button[aria-label^="移除图片 "]').first().click()
    assert.equal((await page.evaluate(() => window.revokedImageUrls)).length, 9)
    await page.evaluate(() => {
      window.imageReads = 0
      const read = FileReader.prototype.readAsDataURL
      FileReader.prototype.readAsDataURL = function (file) { window.imageReads++; return read.call(this, file) }
      const data = new DataTransfer()
      for (let i = 0; i < 10; i++) data.items.add(new File(['image'], `large-batch-${i}.png`, { type: 'image/png' }))
      document.querySelector('textarea[name="intent-statement"]').parentElement.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }))
    })
    await page.waitForFunction(() => document.querySelectorAll('button[aria-label^="移除图片 "]').length === 4)
    assert.equal(await page.evaluate(() => window.imageReads), 4)
    for (let i = 0; i < 4; i++) await page.locator('button[aria-label^="移除图片 "]').first().click()
    assert.equal((await page.evaluate(() => window.revokedImageUrls)).length, 13)
    await page.getByRole('button', { name: '从聊天记录补充' }).click()
    assert.equal(await page.getByRole('textbox', { name: '聊天记录' }).isVisible(), true)
    assert.equal(await page.getByRole('textbox', { name: '聊天记录' }).getAttribute('autocomplete'), 'off')
    assert.equal(await page.getByRole('button', { name: '解析聊天' }).isDisabled(), true)
    await page.getByRole('textbox', { name: '聊天记录' }).fill('一条临时聊天')
    assert.equal(await page.getByRole('button', { name: '解析聊天' }).isEnabled(), true)
    await page.getByRole('textbox', { name: '聊天记录' }).fill('')
    await page.getByRole('button', { name: '收起聊天记录' }).click()
    const statement = page.getByRole('textbox', { name: '用你自己的话写下想改变什么' })
    await statement.fill('尚未保存的原话')
    await page.getByRole('button', { name: '查看服务端意图历史' }).click()
    page.once('dialog', dialog => dialog.dismiss())
    await page.getByRole('button', { name: /one · reviewing/ }).click()
    assert.equal(await statement.inputValue(), '尚未保存的原话')
    assert.equal(historyLoads, 0)
    delayHistory = true
    page.once('dialog', dialog => dialog.accept())
    await page.getByRole('button', { name: /one · reviewing/ }).click()
    await statement.fill('加载期间新增的原话')
    await page.getByText('加载期间输入已变化，当前内容已保留；请重新选择历史会话。').waitFor()
    assert.equal(await statement.inputValue(), '加载期间新增的原话')
    assert.equal(historyLoads, 1)
    await statement.fill('')
    await page.getByRole('button', { name: /one · reviewing/ }).click()
    await page.getByRole('button', { name: '从聊天记录补充' }).click()
    await page.getByText('加载期间输入已变化，当前内容已保留；请重新选择历史会话。').waitFor()
    assert.equal(await page.getByRole('textbox', { name: '聊天记录' }).isVisible(), true)
    await page.getByRole('button', { name: '收起聊天记录' }).click()
    await page.getByRole('button', { name: /one · reviewing/ }).click()
    await page.evaluate(() => {
      window.originalImageRead = FileReader.prototype.readAsDataURL
      FileReader.prototype.readAsDataURL = function (file) { setTimeout(() => window.originalImageRead.call(this, file), 1000) }
      const data = new DataTransfer()
      data.items.add(new File(['image'], 'during-load.png', { type: 'image/png' }))
      document.querySelector('textarea[name="intent-statement"]').parentElement.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }))
    })
    await page.getByText('加载期间输入已变化，当前内容已保留；请重新选择历史会话。').waitFor()
    await page.getByRole('img', { name: 'during-load.png' }).waitFor()
    await page.getByRole('button', { name: '移除图片 during-load.png' }).click()
    await page.evaluate(() => { FileReader.prototype.readAsDataURL = window.originalImageRead })
    delayHistory = false
    await page.evaluate(() => {
      const read = FileReader.prototype.readAsDataURL
      FileReader.prototype.readAsDataURL = function (file) { setTimeout(() => read.call(this, file), 400) }
      const data = new DataTransfer()
      data.items.add(new File(['late image'], 'late.png', { type: 'image/png' }))
      document.querySelector('textarea[name="intent-statement"]').parentElement.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }))
    })
    await page.getByRole('button', { name: '查看服务端意图历史' }).click()
    page.once('dialog', dialog => dialog.accept())
    await page.getByRole('button', { name: /one · reviewing/ }).click()
    await page.getByText('查看和编辑需求候选', { exact: true }).click()
    await page.waitForTimeout(600)
    assert.equal(await page.getByRole('img', { name: 'late.png' }).count(), 0)
    assert.equal((await page.evaluate(() => window.revokedImageUrls)).length, 15)
    if (process.env.DSH_CLARIFICATION_SCREENSHOT) await page.screenshot({ path: process.env.DSH_CLARIFICATION_SCREENSHOT })
    const title = page.getByRole('textbox', { name: '标题', exact: true })
    await title.waitFor()
    assert.equal(await title.inputValue(), '退款进度')
    assert.equal(await title.getAttribute('autocomplete'), 'off')
    assert.equal(await page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented }), false)
    await title.fill('尚未保存的标题')
    assert.equal(await page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented }), true)
    assert.equal(await page.getByRole('textbox', { name: '问题', exact: true }).count(), 1)
    const route = page.locator('details').filter({ hasText: 'AI 建议去向' }).first()
    assert.equal(await route.evaluate(node => node.open), false)
    await route.locator('summary').click()
    assert.equal(await route.evaluate(node => node.open), true)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    const dialog = page.getByRole('dialog')
    assert.equal(await dialog.getAttribute('aria-labelledby'), 'intent-modal-title')
    assert.equal(await dialog.getAttribute('aria-describedby'), null)
    assert.equal(await dialog.evaluate(node => node.style.overscrollBehavior), 'contain')
    assert.equal(await dialog.evaluate(node => { const rect = node.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth }), true)
    assert.equal(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1), true)
    await title.focus()
    for (let i = 0; i < 15; i++) {
      await page.keyboard.press('Tab')
      assert.equal(await dialog.evaluate(node => node.contains(document.activeElement)), true)
    }
    await page.getByRole('button', { name: '保存并检查，进入最终确认' }).click()
    const confirmProblem = page.getByRole('textbox', { name: '问题', exact: true })
    await confirmProblem.waitFor()
    const confirmDescription = await dialog.getAttribute('aria-describedby')
    assert.ok(confirmDescription)
    assert.equal(await page.locator(`#${confirmDescription}`).count(), 1)
    assert.equal(await confirmProblem.getAttribute('name'), 'intent-I-1-confirm-problem')
    assert.equal(await confirmProblem.getAttribute('autocomplete'), 'off')
    const confirmGoal = page.getByRole('textbox', { name: '期望行为', exact: true })
    assert.equal(await confirmGoal.isVisible(), true)
    assert.equal(await confirmGoal.getAttribute('name'), 'intent-I-1-confirm-goal')
    assert.equal(await confirmGoal.getAttribute('autocomplete'), 'off')
    for (const label of ['② 范围与未证实部分（可选核对）']) {
      const optional = page.locator('details').filter({ hasText: label }).first()
      assert.equal(await optional.evaluate(node => node.open), false)
    }
    const writeDetails = page.locator('details').filter({ hasText: '④ 写入内容与权限（可选核对）' }).first()
    assert.equal(await writeDetails.evaluate(node => node.open), true)
    const save = page.getByRole('button', { name: '确认并保存这份草案' })
    assert.equal(await save.isVisible(), true)
    await save.focus()
    assert.equal(await dialog.evaluate(node => node.contains(document.activeElement)), true)
    assert.equal(await save.evaluate(node => {
      const button = node.getBoundingClientRect()
      const container = node.closest('[role="dialog"]').getBoundingClientRect()
      return button.top >= container.top && button.bottom <= container.bottom
    }), true)
    await page.setViewportSize({ width: 640, height: 900 })
    await page.evaluate(() => {
      document.body.style.zoom = '2'
      document.documentElement.style.setProperty('--dsw-alias-bg-base', '#ffffff')
      document.documentElement.style.setProperty('--dsw-alias-bg-layer-1', '#f4f5f6')
      document.documentElement.style.setProperty('--dsw-alias-label-primary', '#111111')
      document.documentElement.style.setProperty('--dsw-alias-label-secondary', '#333333')
      document.documentElement.style.setProperty('--dsw-alias-label-tertiary', '#555555')
      document.documentElement.style.setProperty('--dsw-alias-border-l1', '#cccccc')
      document.documentElement.style.setProperty('--dsw-alias-border-l2', '#aaaaaa')
    })
    assert.equal(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1), true)
    assert.equal(await confirmProblem.isVisible(), true)
    assert.equal(await confirmGoal.isVisible(), true)
    assert.equal(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1), true)
    assert.equal(await save.isVisible(), true)
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})

test('long intent and chat text remain readable and the dialog actions stay reachable when zoomed', async () => {
  const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')
  const marker = '    return {\n      inject:'
  const entry = `import React from 'react'; import {createRoot} from 'react-dom/client';
    window.__ModuleLoader__={load({factory}){factory(()=>React)}}; ${source.replace(marker, '    globalThis.TestIntentLong = IntentModal;\n' + marker)}
    createRoot(document.getElementById('root')).render(React.createElement(globalThis.TestIntentLong,{root:'D:/test',project:'A',projectId:'A',onClose(){},onCreated(){},onOpenRequirement(){}}));`
  const result = await build({ stdin: { contents: entry, resolveDir: fileURLToPath(new URL('../../../', import.meta.url)), loader: 'js' }, bundle: true, write: false, platform: 'browser', format: 'esm' })
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 320, height: 640 } })
  page.on('pageerror', error => { throw error })
  let delayChat = false
  let chatError = false
  let analyzeInput = null
  let ocrAttempts = 0
  await page.route('http://test.local/**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;background:#0f1115;color:white"><div id="root"></div><script type="module" src="/app.js"></script>' })
    if (url.pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: result.outputFiles[0].text })
    if (route.request().method() === 'POST' && route.request().postDataJSON()?.mode === 'chat') {
      if (delayChat) await new Promise(resolve => setTimeout(resolve, 500))
      if (chatError) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { message: 'chat parser unavailable' } }) })
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ schema: 'alm.intake.chat/v1', text: '客服确认会保留退款进度记录。', messages: [{ id: 'M-1', ref: 'L1', speaker: '客服', text: '我会帮你查询退款进度。' }] }) })
    }
    if (route.request().method() === 'POST' && route.request().postDataJSON()?.mode === 'ocr') {
      ocrAttempts += 1
      const payload = ocrAttempts === 1 ? { schema: 'alm.ocr/v1', lines: [] } : ocrAttempts === 2 ? { schema: 'alm.ocr/v1', text: '缺失的识别内容', lines: [] } : { schema: 'alm.ocr/v1', text: '截图中的退款状态', lines: [{ text: '截图中的退款状态', ref: 'image#L1' }] }
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(payload) })
    }
    if (route.request().method() === 'POST' && route.request().postDataJSON()?.action === 'analyze') {
      analyzeInput = route.request().postDataJSON().input
      return route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"test model unavailable"}' })
    }
    return route.fulfill({ contentType: 'application/json', body: '{"ok":true,"sessions":[]}' })
  })
  try {
    await page.goto('http://test.local/')
    const dialog = page.getByRole('dialog')
    const statement = page.getByRole('textbox', { name: '用你自己的话写下想改变什么' })
    const longIntent = `${'退款查询条件需要能被普通用户理解并逐步筛选。'.repeat(120)}INTENT-END-MARKER`
    await statement.fill(longIntent)
    await page.getByRole('button', { name: '从聊天记录补充' }).click()
    const chat = page.getByRole('textbox', { name: '聊天记录' })
    const longChat = `${'10:12 客户：希望能看到退款处理进度，并知道下一步需要什么信息。\n'.repeat(100)}CHAT-END-MARKER`
    await chat.fill(longChat)
    assert.equal(await statement.inputValue(), longIntent)
    assert.equal(await chat.inputValue(), longChat)
    await page.getByRole('button', { name: '解析聊天' }).click()
    await page.getByText('解析 1 条消息').waitFor()
    assert.equal(await page.getByText('我会帮你查询退款进度。').isVisible(), true)
    assert.equal(await statement.inputValue(), longIntent)
    await page.getByRole('button', { name: '把聊天内容加入原话' }).click()
    assert.equal(await page.getByRole('button', { name: '已加入原话' }).isDisabled(), true)
    assert.ok((await statement.inputValue()).endsWith('客服确认会保留退款进度记录。'))
    const reviewedIntent = await statement.inputValue()
    delayChat = true
    await page.getByRole('button', { name: '解析聊天' }).click()
    await page.locator('p[role="status"][aria-live="polite"]').filter({ hasText: '正在解析聊天记录…' }).waitFor({ timeout: 2000 })
    assert.equal(await page.getByRole('button', { name: '解析聊天' }).isDisabled(), true)
    assert.equal(await page.getByRole('button', { name: '分析意图' }).isDisabled(), true)
    assert.equal(await page.getByRole('button', { name: '手动填写候选' }).isDisabled(), true)
    await chat.fill('更新后的聊天，不应被旧解析替换')
    await page.waitForTimeout(700)
    assert.equal(await page.getByText('解析 1 条消息').count(), 0)
    assert.equal(await statement.inputValue(), reviewedIntent)
    await chat.fill(longChat)
    await page.evaluate(() => {
      window.revoked = []
      const revoke = URL.revokeObjectURL.bind(URL)
      URL.revokeObjectURL = url => { window.revoked.push(url); revoke(url) }
    })
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: '＋ 图片' }).click()
    await (await chooser).setFiles({
      name: `${'customer-attachment-'.repeat(9)}final-screenshot.png`,
      mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
    })
    const longImageName = `${'customer-attachment-'.repeat(9)}final-screenshot.png`
    const removeImage = page.getByRole('button', { name: `移除图片 ${longImageName}` })
    await removeImage.waitFor()

    const assertLayout = async () => {
      const layout = await page.evaluate(() => {
        const modal = document.querySelector('[role="dialog"]')
        const rect = modal.getBoundingClientRect()
        return {
          documentFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
          dialogFits: modal.scrollWidth <= modal.clientWidth + 1,
          dialogInside: rect.left >= 0 && rect.right <= innerWidth,
          canScroll: modal.scrollHeight > modal.clientHeight,
        }
      })
      assert.equal(layout.documentFits, true)
      assert.equal(layout.dialogFits, true)
      assert.equal(layout.dialogInside, true)
    }
    await assertLayout()
    assert.equal(await removeImage.isVisible(), true)
    assert.equal(await page.getByRole('img', { name: longImageName }).isVisible(), true)
    const previewUrl = await page.getByRole('img', { name: longImageName }).getAttribute('src')
    await page.getByRole('button', { name: '分析意图' }).click()
    await page.getByText(/识别服务返回的数据不完整/).first().waitFor()
    assert.equal(analyzeInput, null)
    assert.equal(ocrAttempts, 1)
    await page.getByRole('button', { name: '分析意图' }).click()
    await page.getByText(/识别服务返回的数据不完整/).first().waitFor()
    assert.equal(analyzeInput, null)
    assert.equal(ocrAttempts, 2)
    const imageAnalysis = page.waitForResponse(response => response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'analyze')
    await page.getByRole('button', { name: '分析意图' }).click()
    await imageAnalysis
    assert.equal(ocrAttempts, 3)
    assert.ok(analyzeInput.extractedText.includes('image#L1 截图中的退款状态'))
    await page.getByText(/分析暂不可用/).waitFor()
    await removeImage.click()
    assert.deepEqual(await page.evaluate(() => window.revoked), [previewUrl])
    for (const field of [statement, chat]) {
      assert.equal(await field.evaluate(node => node.scrollHeight > node.clientHeight), true)
      await field.evaluate(node => { node.scrollTop = node.scrollHeight })
      assert.equal(await field.evaluate(node => node.scrollTop + node.clientHeight >= node.scrollHeight - 1), true)
    }

    await page.setViewportSize({ width: 640, height: 900 })
    await page.evaluate(() => { document.body.style.zoom = '2' })
    await assertLayout()
    assert.equal(await page.getByRole('textbox', { name: '用你自己的话写下想改变什么' }).inputValue(), reviewedIntent)
    assert.equal(await page.getByRole('textbox', { name: '聊天记录' }).inputValue(), longChat)
    const analyze = page.getByRole('button', { name: '分析意图' })
    await analyze.scrollIntoViewIfNeeded()
    assert.equal(await analyze.isVisible(), true)
    assert.equal(await analyze.evaluate(node => {
      const button = node.getBoundingClientRect()
      const modal = node.closest('[role="dialog"]').getBoundingClientRect()
      return button.top >= modal.top && button.bottom <= modal.bottom
    }), true)
    await page.evaluate(() => { document.body.style.zoom = '' })
    delayChat = false
    await page.getByRole('button', { name: '解析聊天' }).click()
    await page.getByRole('button', { name: '把聊天内容加入原话' }).click()
    const analysisResponse = page.waitForResponse(response => response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'analyze')
    await analyze.click()
    await analysisResponse
    assert.ok(analyzeInput.text.includes('客服确认会保留退款进度记录。'))
    assert.equal(analyzeInput.extractedText, '客服确认会保留退款进度记录。')
    assert.equal(analyzeInput.attachment.kind, 'chat')
    await page.getByText(/分析暂不可用/).waitFor()
    await statement.fill(longIntent)
    const retryResponse = page.waitForResponse(response => response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'analyze')
    await analyze.click()
    await retryResponse
    assert.equal(analyzeInput.text, longIntent)
    assert.equal(analyzeInput.extractedText, '客服确认会保留退款进度记录。')
    chatError = true
    delayChat = false
    await chat.fill('触发聊天解析错误')
    await page.getByRole('button', { name: '解析聊天' }).click()
    const chatErrorNotice = page.locator('[role="alert"]').filter({ hasText: 'chat parser unavailable' })
    await chatErrorNotice.waitFor()
    assert.equal(await chatErrorNotice.getAttribute('aria-live'), 'assertive')
  } finally { await browser.close() }
})


test('single draft presents grill choices and confirms in one action', async () => {
  const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')
  const marker = '    return {\n      inject:'
  const entry = `import React from 'react'; import {createRoot} from 'react-dom/client'; window.__ModuleLoader__={load({factory}){factory(()=>React)}}; ${source.replace(marker, '    globalThis.TestIntent = IntentModal;\n' + marker)} createRoot(document.getElementById('root')).render(React.createElement(globalThis.TestIntent,{root:'D:/test',project:'A',projectId:'A',onClose(){}}));`
  const bundle = await build({ stdin: { contents: entry, resolveDir: fileURLToPath(new URL('../../../', import.meta.url)), loader: 'js' }, bundle: true, write: false, platform: 'browser', format: 'esm' })
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } })
  let session = { sessionId: 'one', state: 'reviewing', sessionRevision: 1, draftRevision: 1, input: { text: '希望提高效率', inputRevision: 1, explicit: {} }, context: { contextSnapshotId: 'ctx' }, grill: { status: 'loaded', name: 'grilling', source: 'user', round: 1, answers: [] }, items: [{ itemId: 'ITM-MANUAL-1', recommendedRoute: 'create', candidate: { title: '提高效率', goal: '提高效率', problem: '问题待明确', acceptance: [] }, unknowns: [] }], docDraft: { goal: '提高效率', problem: '问题待明确', docHash: 'hash', draftRevision: 1, acceptance: [], pending: [{ text: '[验收建议·AI 建议] 用户可以完成任务' }, { text: '[验收建议·AI 建议] 异常时显示原因' }] }, readiness: { ready: false, reasons: [] } }
  const requests = []
  await page.route('http://test.local/**', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div><script type="module" src="/app.js"></script>' })
    if (url.pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text })
    if (url.searchParams.get('action') === 'history') return route.fulfill({ json: { sessions: [{ sessionId: 'one', state: 'reviewing' }] } })
    const body = request.method() === 'POST' ? request.postDataJSON() : {}
    if (body.action === 'load') return route.fulfill({ json: { session } })
    if (body.action) requests.push(body)
    if (body.action === 'set-doc-draft') { session = { ...session, sessionRevision: 2, draftRevision: 2, docDraft: { ...session.docDraft, ...body.docDraft, docHash: 'newhash', draftRevision: 2 } }; return route.fulfill({ json: { session } }) }
    if (body.action === 'edit') { session = { ...session, sessionRevision: 3 }; return route.fulfill({ json: { session } }) }
    if (body.action === 'confirm') return route.fulfill({ json: { receipt: { id: 'receipt' }, artifacts: [] } })
    return route.fulfill({ json: { session } })
  })
  try {
    await page.goto('http://test.local/')
    await page.getByRole('button', { name: '查看服务端意图历史' }).click()
    await page.getByRole('button', { name: /one · reviewing/ }).click()
    await page.getByText('需求价值与边界拷问').waitFor()
    assert.equal(await page.getByText('已加载 Grill Skill').isVisible(), true)
    assert.equal(await page.getByLabel('验收标准 1', { exact: true }).inputValue(), '用户可以完成任务')
    assert.equal(await page.getByText('ITM-MANUAL-1').count(), 0)
    assert.equal(await page.getByText(/请先在右上角选择优先级/).isVisible(), true)
    await page.getByRole('button', { name: '减少“提高效率”过程中的重复操作' }).click()
    assert.match(await page.getByLabel('解决什么问题').inputValue(), /重复操作/)
    await page.getByRole('button', { name: '“提高效率”失败时说明原因并允许重试' }).click()
    assert.match(await page.getByLabel('验收标准 3', { exact: true }).inputValue(), /失败时说明原因/)
    assert.doesNotMatch(await page.locator('[data-testid="intent-modal"]').innerText(), /补充：/)
    const bounds = await page.locator('[data-testid="intent-modal"]').evaluate(node => { const r = node.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight })
    assert.equal(bounds, true)
    await page.getByRole('button', { name: 'P1', exact: true }).click()
    await page.getByRole('button', { name: '确认并创建需求' }).click()
    await page.getByText('草案已保存').waitFor()
    assert.deepEqual(requests.map(body => body.action), ['set-doc-draft', 'edit', 'confirm'])
    assert.equal(requests[2].docHash, 'newhash')
    assert.equal(requests[2].confirmation.priority, 'P1')
    assert.match(requests[0].docDraft.problem, /重复操作/)
    assert.ok(requests[0].docDraft.acceptance.some(entry => entry.text.includes('失败时说明原因')))
  } finally { await browser.close() }
})
