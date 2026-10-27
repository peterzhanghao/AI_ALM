#!/usr/bin/env node
/**
 * UI-level verification of the ALM plugin pages with Playwright.
 *
 * Serves the current plugin source locally (or targets a running DSH host with
 * `--base`) and asserts the rendered tables, summaries, JSON payloads and the
 * absence of console errors. Screenshots and a machine-readable report land in
 * `--out`.
 *
 * Usage:
 *   node scripts/ui-verify.mjs --root fixtures/order-refund --out tmp/ui
 *   node scripts/ui-verify.mjs --base http://127.0.0.1:60860 --out tmp/ui-host
 *   node scripts/ui-verify.mjs --root fixtures/order-refund --require REQ-PAY-999
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { servePages } from './lib/plugin-pages.mjs'

function parseArgs(argv) {
  const options = { root: 'fixtures/order-refund', out: 'tmp/ui', base: undefined, require: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--root') options.root = argv[++i]
    else if (arg === '--out') options.out = argv[++i]
    else if (arg === '--base') options.base = argv[++i]
    else if (arg === '--require') options.require.push(argv[++i])
    else throw new Error(`unknown option: ${arg}`)
  }
  return options
}

async function launch() {
  for (const attempt of [{}, { channel: 'chrome' }, { channel: 'msedge' }]) {
    try {
      return await chromium.launch(attempt)
    } catch {
      // try the next executable source
    }
  }
  throw new Error('no browser available; run `pnpm exec playwright install chromium` or install Chrome')
}

const options = parseArgs(process.argv.slice(2))
const outDir = resolve(options.out)
mkdirSync(outDir, { recursive: true })

const checks = []
const consoleErrors = []
const failedRequests = []
const shots = []
const durations = []

function check(name, ok, detail = '') {
  checks.push({ name, ok, detail })
  if (!ok) console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
}

const local = options.base ? null : await servePages({ root: resolve(options.root) })
const base = options.base ?? local.url
const browser = await launch()

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()
  page.on('console', (message) => {
    // Resource failures are tracked per response below, where the URL is known.
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) {
      consoleErrors.push(message.text())
    }
  })
  page.on('pageerror', (error) => consoleErrors.push(error.message))
  page.on('response', (response) => {
    if (response.status() >= 400) failedRequests.push({ url: response.url(), status: response.status() })
  })

  const requirements = local?.pages.requirements
  const architecture = local?.pages.architecture

  const started = Date.now()
  const requirementsResponse = await page.goto(`${base}/alm/requirements`, { waitUntil: 'load' })
  durations.push({ page: 'requirements', ms: Date.now() - started })
  check('requirements responds 200', requirementsResponse?.status() === 200, String(requirementsResponse?.status()))
  check('requirements title', (await page.title()) === 'ALM Requirements', await page.title())

  const requirementsText = await page.locator('body').innerText()
  check('requirements summary separator', requirementsText.includes('·'))
  check('requirements summary has check status', /check (pass|fail)/.test(requirementsText))
  check('requirements lists REQ-PAY-001', requirementsText.includes('REQ-PAY-001'))
  check('requirements lists TEST-PAY-001 link', requirementsText.includes('TEST-PAY-001'))
  check('requirements shows tracking gap section', requirementsText.includes('Tracking gaps'))
  check('requirements has no mojibake', !requirementsText.includes('路') && !requirementsText.includes('鈥'))
  if (!options.base) {
    check('requirements shows the sidebar browser hint', requirementsText.includes('Sidebar browser:'))
  }
  // textContent, not innerText: the CSS uppercases headers via text-transform.
  const headerText = (
    await page.locator('table th').evaluateAll((nodes) => nodes.map((node) => node.textContent.trim()))
  ).join(',')
  check('requirements table headers', headerText === 'ID,Title,Status,Owner,Verified by', headerText)
  const requirementRows = await page.locator('tbody tr').count()
  check('requirements row count matches payload', !requirements || requirementRows === requirements.requirements.length, `${requirementRows}`)
  await page.screenshot({ path: join(outDir, 'requirements.png'), fullPage: true })
  shots.push(join(outDir, 'requirements.png'))

  const architectureStarted = Date.now()
  const architectureResponse = await page.goto(`${base}/alm/architecture`, { waitUntil: 'load' })
  durations.push({ page: 'architecture', ms: Date.now() - architectureStarted })
  check('architecture responds 200', architectureResponse?.status() === 200, String(architectureResponse?.status()))
  check('architecture title', (await page.title()) === 'ALM Architecture', await page.title())

  const architectureText = await page.locator('body').innerText()
  check('architecture lists MOD-PAY-REFUND', architectureText.includes('MOD-PAY-REFUND'))
  check('architecture lists ADR-PAY-003', architectureText.includes('ADR-PAY-003'))
  check('architecture lists IF-PAY-REFUND-API', architectureText.includes('IF-PAY-REFUND-API'))
  check('architecture lists DM-PAY-REFUND', architectureText.includes('DM-PAY-REFUND'))
  check('architecture has dependency edges', architectureText.includes('Dependency edges'))
  check('architecture has no mojibake', !architectureText.includes('路') && !architectureText.includes('鈥'))
  check('architecture summary separator', architectureText.includes('·'))
  const architectureRows = await page.locator('tbody tr').count()
  check(
    'architecture node rows match payload',
    !architecture || architectureRows >= architecture.summary.nodes,
    `${architectureRows}`,
  )
  await page.screenshot({ path: join(outDir, 'architecture.png'), fullPage: true })
  shots.push(join(outDir, 'architecture.png'))

  for (const required of options.require) {
    check(`required text "${required}"`, requirementsText.includes(required) || architectureText.includes(required))
  }

  for (const [name, path, schema, expected] of [
    ['requirements JSON', '/api/alm/requirements', 'alm.requirements/v1', 'REQ-PAY-001'],
    ['architecture JSON', '/api/alm/architecture', 'alm.architecture/v1', 'MOD-PAY-REFUND'],
  ]) {
    const response = await page.request.get(`${base}${path}`)
    const payload = await response.json().catch(() => null)
    check(`${name} responds 200`, response.status() === 200, String(response.status()))
    check(`${name} schema`, payload?.schema === schema, String(payload?.schema))
    check(`${name} contains ${expected}`, JSON.stringify(payload).includes(expected))
  }

  check('no console errors', consoleErrors.length === 0, consoleErrors.join(' | '))
  const meaningfulFailures = failedRequests.filter((entry) => !entry.url.includes('favicon'))
  check(
    'no failed requests',
    meaningfulFailures.length === 0,
    meaningfulFailures.map((entry) => `${entry.status} ${entry.url}`).join(' | '),
  )
  await context.close()
} finally {
  await browser.close()
  if (local) await local.close()
}

const ok = checks.every((entry) => entry.ok)
const report = {
  schema: 'alm.ui.verify/v1',
  base,
  root: local ? resolve(options.root) : null,
  ok,
  checks,
  consoleErrors,
  failedRequests,
  shots,
  durations,
  at: new Date().toISOString(),
}
writeFileSync(join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')

for (const entry of checks) if (entry.ok) console.log(`ok    ${entry.name}`)
console.log(`\nui-verify: ${checks.length} checks, ${checks.filter((entry) => entry.ok).length} ok -> ${join(outDir, 'report.json')}`)
process.exit(ok ? 0 : 1)
