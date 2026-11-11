/**
 * Scenario executor (L1: isolated render).
 *
 * Drives a real browser against a URL that serves the current plugin source and
 * turns each check into a case with screenshots/DOM snapshots attached. It is
 * deliberately a *capture* engine, not an assertion DSL: the reviewer looks at
 * the same pixels the assertion looked at, and the assertion only decides
 * pass/fail for them to confirm or reject.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, posix } from 'node:path'

export const RUNNER_SCHEMA = 'alm.plugin-acceptance.runner/v1'
const STEP_TIMEOUT = 15_000
const MAX_DOM_BYTES = 400_000
const MAX_TEXT_BYTES = 120_000

class StepError extends Error {
  constructor(message, { index, kind }) {
    super(message)
    this.name = 'StepError'
    this.index = index
    this.kind = kind
  }
}

/**
 * Launch any Chromium the machine actually has. A pinned Playwright revision is
 * often missing here, so fall back to the system Chrome/Edge installs.
 *
 * @returns {Promise<{browser: object, channel: string, version: string}>}
 */
export async function launchBrowser() {
  let playwright
  try {
    playwright = await import('playwright')
  } catch (error) {
    throw new Error(`playwright is not installed (${error.message}); run \`pnpm install\` or install Chrome`)
  }
  const attempts = [
    { label: 'bundled', options: {} },
    { label: 'chrome', options: { channel: 'chrome' } },
    { label: 'msedge', options: { channel: 'msedge' } },
  ]
  const failures = []
  for (const attempt of attempts) {
    try {
      const browser = await playwright.chromium.launch(attempt.options)
      return { browser, channel: attempt.label, version: browser.version() }
    } catch (error) {
      failures.push(`${attempt.label}: ${String(error.message).split('\n')[0]}`)
    }
  }
  throw new Error(`no usable browser; ${failures.join(' | ')}`)
}

function resolveUrl(base, target) {
  if (/^https?:\/\//i.test(target)) return target
  return new URL(target.startsWith('/') ? target : `/${target}`, base).href
}

function clip(text, limit) {
  if (typeof text !== 'string') return ''
  return text.length > limit ? `${text.slice(0, limit)}\n…[truncated ${text.length - limit} chars]` : text
}

/**
 * Evidence collector shared by the step loop and the failure handler, so a
 * failed check still carries everything captured before the failing step.
 */
function createCapture({ check, page, evidenceDir, evidencePrefix }) {
  const evidence = []
  let seq = 0

  const shot = async (name, description) => {
    seq += 1
    const file = `${check.id}-${name || `shot-${seq}`}.png`
    const buffer = await page.screenshot({ path: join(evidenceDir, file), fullPage: true })
    evidence.push({ path: posix.join(evidencePrefix, file), kind: 'screenshot', description, bytes: buffer.byteLength })
    return file
  }

  const dom = async (name, description) => {
    const file = `${check.id}-${name || 'dom'}.dom.json`
    const snapshot = await page.evaluate(() => ({
      url: location.href,
      title: document.title,
      text: document.body ? document.body.innerText : '',
      html: document.documentElement ? document.documentElement.outerHTML : '',
    }))
    const payload = {
      schema: 'alm.plugin-acceptance.dom/v1',
      url: snapshot.url,
      title: snapshot.title,
      text: clip(snapshot.text, MAX_TEXT_BYTES),
      html: clip(snapshot.html, MAX_DOM_BYTES),
    }
    writeFileSync(join(evidenceDir, file), `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    evidence.push({ path: posix.join(evidencePrefix, file), kind: 'dom_snapshot', description })
    return file
  }

  return { evidence, shot, dom }
}

/**
 * Execute the steps of one check on a fresh page.
 *
 * `state` is mutated in place so the caller keeps the partial record after a
 * thrown StepError.
 */
async function runCheck({ page, check, base, evidenceDir, evidencePrefix, timeout, state }) {
  const capture = createCapture({ check, page, evidenceDir, evidencePrefix })
  const { shot, dom } = capture
  // Share the array with `state` so evidence captured before a failing step is
  // still attached to the failed case.
  state.evidence = capture.evidence
  state.shot = shot

  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) {
      state.consoleErrors.push(message.text())
    }
  })
  page.on('pageerror', (error) => state.consoleErrors.push(error.message))
  page.on('response', (response) => {
    if (response.status() >= 400) state.failedRequests.push({ url: response.url(), status: response.status() })
  })

  for (const [index, step] of check.steps.entries()) {
    const [kind] = Object.keys(step)
    const value = step[kind]
    const context = { index, kind }
    const record = { index, action: kind, ok: false, detail: '' }
    state.steps.push(record)
    try {
      switch (kind) {
        case 'goto': {
          const url = resolveUrl(base, value)
          const response = await page.goto(url, { waitUntil: 'load', timeout })
          record.detail = `${url} -> ${response?.status() ?? 'no response'}`
          if (!response) throw new StepError(`no response for ${url}`, context)
          if (response.status() >= 400) throw new StepError(`${url} responded ${response.status()}`, context)
          break
        }
        case 'waitFor': {
          await page.waitForSelector(value, { state: 'visible', timeout })
          record.detail = value
          break
        }
        case 'click': {
          await page.locator(value).first().click({ timeout })
          record.detail = value
          break
        }
        case 'fill': {
          await page.locator(value.selector).first().fill(value.value, { timeout })
          record.detail = `${value.selector} = ${value.value}`
          break
        }
        case 'expectText': {
          const text = typeof value === 'string' ? value : value.text
          const selector = typeof value === 'string' ? null : value.selector
          const haystack = selector
            ? await page.locator(selector).first().innerText({ timeout })
            : await page.locator('body').innerText()
          if (!haystack.includes(text)) {
            throw new StepError(`expected text ${JSON.stringify(text)}${selector ? ` in ${selector}` : ''}, not found`, context)
          }
          record.detail = `${selector ?? 'body'} contains ${JSON.stringify(text)}`
          break
        }
        case 'expectNoText': {
          const text = typeof value === 'string' ? value : value.text
          const selector = typeof value === 'string' ? null : value.selector
          const haystack = selector
            ? await page.locator(selector).first().innerText({ timeout })
            : await page.locator('body').innerText()
          if (haystack.includes(text)) {
            throw new StepError(`text ${JSON.stringify(text)} must not appear${selector ? ` in ${selector}` : ''}`, context)
          }
          record.detail = `absent ${JSON.stringify(text)}`
          break
        }
        case 'expectCount': {
          const { selector } = value
          if ((value.min ?? 0) > 0 || value.equals > 0) await page.waitForSelector(selector, { timeout })
          else await page.waitForTimeout(150)
          const count = await page.locator(selector).count()
          const ok =
            (value.equals !== undefined && count === value.equals) ||
            (value.min !== undefined && count >= value.min) ||
            (value.max !== undefined && count <= value.max)
          if (!ok) {
            const expectation = JSON.stringify({ equals: value.equals, min: value.min, max: value.max })
            throw new StepError(`${selector} count ${count} does not satisfy ${expectation}`, context)
          }
          record.detail = `${selector} = ${count}`
          break
        }
        case 'expectTitle': {
          const title = await page.title()
          if (title !== value) throw new StepError(`title is ${JSON.stringify(title)}, expected ${JSON.stringify(value)}`, context)
          record.detail = title
          break
        }
        case 'expectNoConsoleErrors': {
          if (state.consoleErrors.length) throw new StepError(`console errors: ${state.consoleErrors.join(' | ')}`, context)
          record.detail = 'no console errors'
          break
        }
        case 'expectNoFailedRequests': {
          const meaningful = state.failedRequests.filter((entry) => !entry.url.includes('favicon'))
          if (meaningful.length) {
            throw new StepError(`failed requests: ${meaningful.map((entry) => `${entry.status} ${entry.url}`).join(' | ')}`, context)
          }
          record.detail = 'no failed requests'
          break
        }
        case 'shot': {
          record.detail = await shot(value, `截图：${value}`)
          break
        }
        case 'dom': {
          record.detail = await dom(value, `DOM 快照：${value}`)
          break
        }
        default:
          throw new StepError(`unsupported step ${kind}`, context)
      }
      record.ok = true
    } catch (error) {
      record.ok = false
      record.detail = error.message
      throw error
    }
  }
}

/**
 * Run every check of one scenario.
 *
 * @param {{scenario: object, base: string, evidenceDir: string, timeout?: number, browser?: object}} options
 * @returns {Promise<{cases: object[], channel: string|null, version: string|null}>}
 */
export async function runScenario({
  scenario,
  base,
  evidenceDir,
  evidencePrefix = 'evidence',
  timeout = STEP_TIMEOUT,
  browser: provided = null,
}) {
  mkdirSync(evidenceDir, { recursive: true })
  const launched = provided ? { browser: provided, channel: null, version: null } : await launchBrowser()
  const { browser, channel, version } = launched
  const cases = []

  try {
    for (const check of scenario.checks) {
      const started = Date.now()
      const state = { steps: [], evidence: [], consoleErrors: [], failedRequests: [], shot: null }
      const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        deviceScaleFactor: 1,
        reducedMotion: 'reduce',
        locale: 'zh-CN',
        timezoneId: 'Asia/Shanghai',
      })
      const page = await context.newPage()
      try {
        await runCheck({ page, check, base, evidenceDir, evidencePrefix, timeout, state })
        cases.push({
          id: check.id,
          title: check.title,
          expected: check.expected,
          requirement: check.requirement ?? null,
          category: check.category ?? 'ui',
          surface: 'web',
          level: check.level ?? scenario.level,
          status: state.evidence.length ? 'pass' : 'blocked',
          observation: state.evidence.length
            ? `${state.steps.length} 步骤全部通过，产出 ${state.evidence.length} 件证据`
            : '全部步骤通过但没有产出可审阅证据，按规则记为 blocked',
          repro: check.repro ?? [],
          steps: state.steps,
          evidence: state.evidence,
          durationMs: Date.now() - started,
        })
      } catch (error) {
        try {
          if (state.shot) await state.shot('failure', `失败现场：${error.message}`)
        } catch {
          /* page may already be gone */
        }
        const failedStep = error.index === undefined || error.index === null ? null : check.steps[error.index]
        cases.push({
          id: check.id,
          title: check.title,
          expected: check.expected,
          requirement: check.requirement ?? null,
          category: check.category ?? 'ui',
          surface: 'web',
          level: check.level ?? scenario.level,
          status: 'fail',
          observation: failedStep
            ? `步骤 ${error.index + 1} (${Object.keys(failedStep)[0]}) 失败：${error.message}`
            : error.message,
          repro: check.repro ?? [],
          steps: state.steps,
          evidence: state.evidence,
          consoleErrors: state.consoleErrors,
          failedRequests: state.failedRequests,
          durationMs: Date.now() - started,
        })
      } finally {
        await context.close().catch(() => {})
      }
    }
  } finally {
    if (!provided) await browser.close().catch(() => {})
  }

  return { cases, channel, version }
}
