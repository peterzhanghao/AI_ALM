/**
 * Primary actions must stay readable in the host's monochrome theme.
 *
 * The bug this locks down: the host resolves `--dsw-alias-brand-primary` to a
 * near-white value, so every "brand fill + white label" button rendered as a
 * blank white pill — 「分析意图」「开始 AI 推进」「保存并检查…」 all disappeared.
 * The old tests never saw it because without the host style sheet the var falls
 * back to blue, so the pair looks fine.
 *
 * So this test injects the host's real token values and measures WCAG contrast
 * on the rendered button, instead of asserting a style string.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

// The tokens the desktop host actually defines in its dark, monochrome theme.
const HOST_TOKENS = `:root{
  --dsw-alias-brand-primary:#f2f4f7;
  --dsw-alias-label-primary:#f2f4f7;
  --dsw-alias-label-secondary:#9aa3ae;
  --dsw-alias-bg-base:#0f1115;
  --dsw-alias-bg-layer-1:#14171c;
  --dsw-alias-bg-layer-2:#171b21;
  --dsw-alias-border-l1:#232830;
  --dsw-alias-border-l2:#2e343d;
  --dsw-alias-state-warn-primary:#e7b04b;
  --dsw-alias-state-error-primary:#ff8b8b;
  --dsw-alias-state-success-primary:#35c47a;
}`

const TEXT = '需求插件使用过程中遇到缺陷时自动修复，不要让我复制粘贴报错'

/** Unclarified session: no model ran, but the machine dedup did find a clause. */
function unclarifiedSession() {
  return {
    sessionId: 'contrast-1',
    state: 'needs_input',
    ai: 'none',
    sessionRevision: 3,
    input: { text: TEXT, rawText: TEXT, inputRevision: 1, explicit: {} },
    context: {
      contextSnapshotId: 'ctx-1',
      queryStatus: 'success',
      readSet: [{
        uid: 'REQ-ALM-014',
        revision: 2,
        title: '需求澄清判决式重构与运行时缺陷自愈',
        match: 'covered',
        reasons: ['条款 AC-02'],
        clauseMatches: [{ clauseId: 'AC-02', verdict: 'covered', text: '缺陷必须能被自动分类并自愈', reasons: ['动作相同（修复），对象重合 100%'], scores: { fused: 0.27 } }],
      }],
      rejections: [],
    },
    readiness: { ready: false, reasons: [{ code: 'missing-title', message: '缺少标题' }] },
    items: [{
      itemId: 'ITM-MANUAL-1',
      ai: 'none',
      recommendedRoute: 'create',
      unknowns: [],
      related: [],
      sourceRefs: [{ ref: 'input.text', quote: TEXT }],
      candidate: null,
    }],
  }
}

function luminance(rgb) {
  const [r, g, b] = rgb.slice(0, 3).map((value) => {
    const channel = value / 255
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrastOf(a, b) {
  const [high, low] = [luminance(a), luminance(b)].sort((left, right) => right - left)
  return (high + 0.05) / (low + 0.05)
}

function parseColor(value) {
  const numbers = (String(value).match(/[\d.]+/g) ?? []).map(Number)
  if (numbers.length < 3) throw new Error(`unparsable colour: ${value}`)
  if (numbers.length >= 4 && numbers[3] < 1) throw new Error(`translucent fill: ${value}`)
  return numbers.slice(0, 3)
}

async function openModal(t, session) {
  const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')
  const marker = '    return {\n      inject:'
  const entry = `import React from 'react'; import {createRoot} from 'react-dom/client';
    window.__ModuleLoader__={load({factory}){factory(()=>React)}}; ${source.replace(marker, '    globalThis.TestIntentModal = IntentModal;\n' + marker)}
    createRoot(document.getElementById('root')).render(React.createElement(globalThis.TestIntentModal,{root:'D:/test',project:'ALM',projectId:'ALM',onClose(){},onOpenRequirement(){}}));`
  const bundle = await build({ stdin: { contents: entry, resolveDir: fileURLToPath(new URL('../../../', import.meta.url)), loader: 'js' }, bundle: true, write: false, platform: 'browser', format: 'esm' })
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } })
  await page.route('http://test.local/**', (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text })
    // Only the analysis endpoint returns a session; everything else is empty.
    return route.fulfill({
      contentType: path === '/' ? 'text/html' : 'application/json',
      body: path === '/'
        ? `<div id="root"></div><style>${HOST_TOKENS}</style><script type="module" src="/app.js"></script>`
        : JSON.stringify({ ok: true, session, sessions: [], items: [], requirements: [] }),
    })
  })
  await page.goto('http://test.local/')
  return page
}

async function contrastOfButton(page, name) {
  const button = page.getByRole('button', { name }).first()
  assert.equal(await button.count(), 1, `button not found: ${name}`)
  const style = await button.evaluate((element) => {
    const computed = getComputedStyle(element)
    return { background: computed.backgroundColor, color: computed.color }
  })
  return { ratio: contrastOf(parseColor(style.background), parseColor(style.color)), style }
}

test('输入页的主按钮在宿主单色主题下仍然可读', async (t) => {
  const page = await openModal(t, unclarifiedSession())
  await page.getByRole('textbox', { name: '用你自己的话写下想改变什么' }).fill(TEXT)
  const { ratio, style } = await contrastOfButton(page, '分析意图')
  assert.ok(ratio >= 4.5, `对比度 ${ratio.toFixed(2)}（bg ${style.background} / fg ${style.color}）`)
})

test('复核页的主按钮在宿主单色主题下仍然可读', async (t) => {
  const page = await openModal(t, unclarifiedSession())
  await page.getByRole('textbox', { name: '用你自己的话写下想改变什么' }).fill(TEXT)
  await page.getByRole('button', { name: '分析意图' }).click()
  await page.getByText('这份理解对吗？').waitFor()
  const { ratio, style } = await contrastOfButton(page, '保存并检查，进入最终确认')
  assert.ok(ratio >= 4.5, `对比度 ${ratio.toFixed(2)}（bg ${style.background} / fg ${style.color}）`)
})

test('主按钮样式不再把 brand token 或白色文字配成一对', () => {
  const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')
  // 主按钮 = 反色配对（底色用 label 色，文字用 base 色），在明暗两种主题里都成立。
  assert.ok(
    source.includes("const primary = { ...button, background: T.text, color: T.base"),
    '主按钮应使用反色配对',
  )
  assert.ok(
    source.includes('btn-primary{background:${T.text}!important;color:${T.base}!important'),
    '详情页 .btn-primary 必须与主按钮同色，不能白底白字',
  )
  // 兜底：任何“填充 brand 却写白字”的组合都会在近白主题下消失。
  assert.equal(/background:\s*(?:primary \? )?T\.brand[^,\n]*,\s*\n?\s*color:\s*'#fff'/.test(source), false)
})
