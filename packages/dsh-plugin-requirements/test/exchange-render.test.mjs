import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { requirementsTemplateExport } from '../../alm-core/src/requirements/exchange.mjs'
import { encodeRequirementsXlsx, decodeRequirementsXlsx } from '../../alm-core/src/requirements/exchange-xlsx.mjs'

/**
 * The exchange dialog is only useful if its primary action is visible. The host
 * theme is not owned by this plugin, so the checks below mount the real
 * component under a hostile brand token (the one that turned the export button
 * into white-on-white) and drive the template download end to end.
 */
async function mount(page) {
  const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')
  const marker = '    return {\n      inject:'
  const entry = `import React from 'react'; import {createRoot} from 'react-dom/client';
    window.__ModuleLoader__={load({factory}){factory(()=>React)}};
    ${source.replace(marker, '    globalThis.TestExchange = ExchangeModal;\n' + marker)}
    createRoot(document.getElementById('root')).render(React.createElement(globalThis.TestExchange,{root:'D:/fixtures/order-refund',visibleIds:['REQ-PAY-001'],onClose(){}}));`
  const bundle = await build({ stdin: { contents: entry, resolveDir: fileURLToPath(new URL('../../../', import.meta.url)), loader: 'js' }, bundle: true, write: false, platform: 'browser', format: 'esm' })
  return bundle.outputFiles[0].text
}

test('AC-03/AC-05: export CTA stays readable and the template downloads then imports', async () => {
  const payload = requirementsTemplateExport({ root: 'fixtures/order-refund' })
  const bytes = encodeRequirementsXlsx(payload)
  const app = await mount()
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1000, height: 780 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const posts = []
  // A light brand token is what broke the CTA: white fill + white label.
  const theme = ':root{--dsw-alias-brand-primary:#ffffff;--dsw-alias-label-primary:#f2f4f7;--dsw-alias-base-bg:#0f1115;--dsw-alias-bg-base:#0f1115}body{margin:0;background:#0b0d10}'
  await page.route('http://test.local/**', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: `<style>${theme}</style><div id="root"></div><script type="module" src="/app.js"></script>` })
    if (url.pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: app })
    if (url.pathname === '/api/alm/requirements/exchange') {
      const body = request.postDataJSON(); posts.push(body)
      if (body.action === 'template') return route.fulfill({ json: { ok: true, filename: `requirements-${payload.projectId}-template.xlsx`, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', content: bytes.toString('base64'), bytes: bytes.length } })
      if (body.action === 'preview') return route.fulfill({ json: { ok: true, conflicts: [], localHash: 'hash', mappings: {}, changes: [{ uid: 'REQ-PAY-005', operation: 'create', title: '示例行', fields: ['title', 'brief', 'priority', 'owner'] }] } })
      return route.fulfill({ json: { ok: true } })
    }
    return route.fulfill({ json: { ok: true } })
  })
  try {
    await page.goto('http://test.local/')
    const dialog = page.getByRole('dialog')
    await dialog.waitFor()
    const cta = page.locator('[data-exchange-export-action]')
    const paint = await cta.evaluate(node => {
      const style = getComputedStyle(node)
      const parse = value => value.match(/\d+(?:\.\d+)?/g).slice(0, 3).map(Number)
      const luminance = ([r, g, b]) => [r, g, b].map(channel => { const c = channel / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0)
      const foreground = luminance(parse(style.color)), background = luminance(parse(style.backgroundColor))
      return { label: node.innerText.trim(), color: style.color, background: style.backgroundColor, contrast: (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05) }
    })
    assert.equal(paint.label, '导出 Excel (.xlsx)')
    // WCAG AA for large text is 3:1; the broken build measured 1.0.
    assert.ok(paint.contrast >= 4.5, `export CTA contrast ${paint.contrast} (${paint.color} on ${paint.background})`)
    // Nothing is imported yet, so the apply action is not on screen.
    assert.equal(await page.locator('[data-exchange-apply]').count(), 0)

    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-exchange-template]').click()])
    const saved = readFileSync(await download.path())
    assert.equal(download.suggestedFilename(), `requirements-${payload.projectId}-template.xlsx`)
    assert.deepEqual(saved, bytes)
    assert.equal(decodeRequirementsXlsx(saved).records[0].operation, 'create')
    await page.locator('[data-exchange-receipt]').waitFor()
    assert.match(await page.locator('[data-exchange-receipt]').innerText(), /模板含 1 行示例/)

    // The downloaded file goes straight back through the import card.
    await page.locator('[data-exchange-input]').setInputFiles({ name: 'requirements-PAY-template.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: saved })
    await page.locator('[data-exchange-preview]').waitFor()
    assert.match(await page.locator('[data-exchange-preview]').innerText(), /新增 1 条/)
    assert.equal(await page.locator('[data-exchange-apply]').isEnabled(), true)
    // The dialog probes the host build first so a stale host is visible, then
    // downloads and previews.
    assert.deepEqual(posts.map(body => body.action), ['version', 'template', 'preview'])
    // The route answers the probe without a build, which reads as "unknown host";
    // the footer must still name the workbook contract on screen.
    assert.match(await page.locator('[data-exchange-build]').innerText(), /工作簿格式 v3/)
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})
