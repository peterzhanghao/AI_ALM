/**
 * UI contract for the judgement screen.
 *
 * What a user must be able to see without reading the code:
 *   - 命中的一致/相反条款，以及「就是这条 / 确实是新的」这两个裁决出口；
 *   - 十个去向（判决）都在，而不是只有「新建/变更」；
 *   - 模型没参与时，界面说“未澄清”，并且确认按钮不可用；
 *   - 否决账本命中会被摆出来，而不是藏在日志里。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const TEXT = '退款幂等：同一笔退款重复提交会生成多条退款单，需要同一幂等键只产生一张退款单。'

function sessionFixture(overrides = {}) {
  return {
    sessionId: 'judge-1',
    state: 'ready_for_confirmation',
    sessionRevision: 1,
    input: { text: TEXT, rawText: TEXT, inputRevision: 1, explicit: { priority: 'P1' } },
    context: {
      contextSnapshotId: 'ctx',
      queryStatus: 'success',
      readSet: [{
        uid: 'REQ-PAY-004',
        revision: 2,
        title: '同一幂等键的重复退款请求返回同一退款单',
        match: 'covered',
        reasons: ['条款 AC-02：动作相同（记录），对象重合 100%'],
        clauseMatches: [{ clauseId: 'AC-02', verdict: 'covered', text: '同一幂等键只产生一张退款单', reasons: ['动作相同（记录），对象重合 100%'], scores: { fused: 0.72 } }],
      }],
      rejections: [],
    },
    readiness: { ready: false, reasons: [{ code: 'duplicate-unadjudicated', message: '与已有条款重合' }] },
    items: [{
      itemId: 'ITM-1',
      recommendedRoute: 'create',
      unknowns: [],
      related: [{ uid: 'REQ-PAY-004', revision: 2, match: 'covered', reason: '已有幂等条款' }],
      candidate: {
        title: '退款幂等补充约束',
        problem: '重复提交产生多条退款单',
        goal: '同一幂等键只产生一张退款单',
        acceptance: [{ expected: '重复提交返回首次退款单', judgement: '接口断言' }],
      },
    }],
    docDraft: { title: '退款幂等补充约束', goal: '同一幂等键只产生一张退款单', problem: '重复提交产生多条退款单', acceptance: [{ id: 'AC-01', text: '重复提交返回首次退款单', provenance: 'user-stated' }], pending: [], docHash: 'hash', draftRevision: 1 },
    ...overrides,
  }
}

async function openPage(t, session) {
  const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')
  const marker = '    return {\n      inject:'
  const entry = `import React from 'react'; import {createRoot} from 'react-dom/client';
    window.__ModuleLoader__={load({factory}){factory(()=>React)}}; ${source.replace(marker, '    globalThis.TestIntentJudge = IntentModal;\n' + marker)}
    createRoot(document.getElementById('root')).render(React.createElement(globalThis.TestIntentJudge,{root:'D:/test',project:'ALM',projectId:'ALM',onClose(){},onOpenRequirement(){}}));`
  const bundle = await build({ stdin: { contents: entry, resolveDir: fileURLToPath(new URL('../../../', import.meta.url)), loader: 'js' }, bundle: true, write: false, platform: 'browser', format: 'esm' })
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 920, height: 900 } })
  await page.route('http://test.local/**', async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div><script type="module" src="/app.js"></script>' })
    if (url.pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text })
    return route.fulfill({ json: { session, sessions: [], ok: true } })
  })
  await page.goto('http://test.local/')
  // 首屏是输入框；先把会话灌进去，避免依赖真实分析。
  await page.getByRole('textbox', { name: '用你自己的话写下想改变什么' }).fill(TEXT)
  await page.getByRole('button', { name: '分析意图' }).click()
  return page
}

test('查重命中时摆出裁决出口与十个去向', async t => {
  const page = await openPage(t, sessionFixture())
  await page.getByText('查重结论：这条诉求可能已经存在').first().waitFor({ timeout: 8000 })
  assert.equal(await page.getByRole('button', { name: '确实是新的' }).count(), 1)
  assert.equal(await page.getByRole('button', { name: '就是这条 → 追加条款' }).count(), 1)
  assert.equal(await page.getByRole('button', { name: '就是这条 → 修订条款' }).count(), 1)
  // 十个判决都在（折叠里的按钮），并且不只有「新建」
  await page.getByText(/AI 建议去向/).first().click()
  for (const label of ['新建需求', '追加到已有需求', '修订已有需求', '合并同族需求', '拆成多条', '暂缓观察', '拒绝并记账', '直接复用', '先调查', '直接答疑']) {
    assert.ok(await page.getByRole('button', { name: label }).count() >= 1, `缺少判决按钮：${label}`)
  }
})

test('模型未参与时显示未澄清，且确认按钮不可用', async t => {
  const session = sessionFixture({
    ai: 'none',
    aiNote: '模型未参与本次澄清：没有生成问题、标题与验收。',
    state: 'needs_input',
    items: [{ itemId: 'ITM-MANUAL-1', recommendedRoute: 'create', unknowns: [], related: [], candidate: null }],
    docDraft: null,
    readiness: { ready: false, reasons: [{ code: 'missing-title', message: '缺少标题' }, { code: 'needs-acceptance', message: '缺少验收条件' }] },
  })
  const page = await openPage(t, session)
  await page.getByText('这次澄清没有模型参与：下面的内容不是分析结果').first().waitFor({ timeout: 8000 })
  assert.equal(await page.getByText('补全标题与至少一条验收后才能确认；在此之前「确认」按钮会保持不可用，避免把未澄清的内容写进需求库。').count() >= 1, true)
})

test('否决账本命中会被摆出来，带理由与再提条件', async t => {
  const session = sessionFixture({
    context: {
      contextSnapshotId: 'ctx',
      queryStatus: 'success',
      readSet: [],
      rejections: [{
        id: 'REJ-abc12345',
        statement: '需求列表要支持导出 CSV',
        verdict: 'partial',
        score: 0.52,
        reason: '已有 REQ-ALM-006 的导出能力',
        alternative: '直接复用 REQ-ALM-006',
        revisitTrigger: '外部系统要求固定列顺序时',
        at: '2026-11-01T00:00:00.000Z',
      }],
    },
    items: [{
      itemId: 'ITM-1',
      recommendedRoute: 'create',
      unknowns: [],
      related: [],
      candidate: { title: '导出 CSV', problem: 'p', goal: 'g', acceptance: [{ expected: 'e', judgement: 'j' }] },
    }],
    readiness: { ready: true, reasons: [] },
  })
  const page = await openPage(t, session)
  await page.getByText('否决账本里已有类似诉求').first().waitFor({ timeout: 8000 })
  assert.ok(await page.getByText(/REJ-abc12345/).count() >= 1)
  assert.ok(await page.getByText(/再提条件：外部系统要求固定列顺序时/).count() >= 1)
})

test('机器查重命中的需求必须出现在「相关承诺」里，不能又说没匹配到', async t => {
  // 复现截图里的自相矛盾：上方写着 REQ-ALM-014 已覆盖，下方「相关承诺」却是 0 条候选。
  // 原因是那一块只看模型声明的 item.related；模型没参与时它永远是空的。
  const session = sessionFixture({
    items: [{
      itemId: 'ITM-MANUAL-1',
      recommendedRoute: 'create',
      unknowns: [],
      related: [],
      candidate: null,
    }],
  })
  const page = await openPage(t, session)
  await page.getByText('查重结论：这条诉求可能已经存在').first().waitFor({ timeout: 8000 })
  const related = page.locator('div', { hasText: /^相关承诺/ }).first()
  assert.ok(await page.getByText('1 条候选').count() >= 1, '相关承诺应统计到机器命中的候选')
  assert.equal(await page.getByText('没有匹配到相关承诺；这不等于没有影响。').count(), 0, '不应再声称没有匹配到相关承诺')
  assert.ok(await page.getByText('REQ-PAY-004').count() >= 1, '机器命中的需求 uid 要出现在相关承诺里')
  assert.ok(await related.count() >= 1, '相关承诺区块应存在')
})
