#!/usr/bin/env node
/**
 * 需求意图澄清 · 真端到端验证 (host webServer + real model, no fake AI)
 *
 * 这个脚本刻意不接受 fake AI：它直接打 DSH 宿主内部 webServer 的
 * /api/alm/requirements/intent，用宿主自己注入的真实 llm.stream，
 * 验证的就是用户在页面上点「分析」实际走的那条链路。
 *
 * 背景：仅靠「HTTP 200」判断成功会被骗过去。新建会话的澄清失败在
 * handleAnalyze 里会走 localIntentDraft，返回 200 + ok:true +
 * localFallback:true + ai:'none'（模型答案不可用时 aiTried:true）。
 * 所以本脚本把「真实模型参与且产出可用结果」当作硬断言。
 *
 * 同时回归两类历史缺陷：
 *   1. 结构化输入在 handleAnalyze 短路，根本不调模型（aiTried:false）；
 *   2. Grill 超时后降级成「减少重复操作 / 避免信息遗漏」之类硬编码凑数选项。
 *
 * 用法:
 *   node scripts/intent-e2e-verify.mjs
 *   node scripts/intent-e2e-verify.mjs --url http://127.0.0.1:64561
 *   node scripts/intent-e2e-verify.mjs --project ALM --input "..." --expect "mermaid,渲染" --json
 *   DSH_INTENT_URL=http://127.0.0.1:64561 node scripts/intent-e2e-verify.mjs
 *
 * 退出码: 0 = 真成功 / 1 = 链路或结果不合格 / 2 = 环境或参数错误
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const DEFAULT_INPUT =
  '需求插件可以支持需求正文支持mermaid格式，以图展示部分需求，例如ER图，用例等'
const DEFAULT_EXPECT = ['mermaid', 'ER', '用例', '渲染', '图']
const JUNK_OPTION_LABELS = [
  '减少重复操作',
  '避免信息遗漏',
  '提高完成效率',
  '说明失败原因',
  '继续追问',
  '使用 Grill 重试',
]
const INTENT_PATH = '/api/alm/requirements/intent'

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = {
    url: process.env.DSH_INTENT_URL ?? null,
    project: null,
    root: null,
    input: DEFAULT_INPUT,
    expect: DEFAULT_EXPECT.slice(),
    timeoutMs: 330_000,
    json: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    const value = () => {
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) {
        throw new Error(`参数 ${flag} 缺少取值`)
      }
      i += 1
      return next
    }
    switch (flag) {
      case '--url': out.url = value(); break
      case '--project': out.project = value(); break
      case '--root': out.root = value(); break
      case '--input': out.input = value(); break
      case '--expect': out.expect = value().split(',').map(s => s.trim()).filter(Boolean); break
      case '--timeout': out.timeoutMs = Number(value()) * 1000; break
      case '--json': out.json = true; break
      case '--help': case '-h': out.help = true; break
      default: throw new Error(`未知参数：${flag}`)
    }
  }
  if (!Number.isFinite(out.timeoutMs) || out.timeoutMs <= 0) throw new Error('--timeout 必须是正数（秒）')
  return out
}

const HELP = `意图澄清真端到端验证\n\n` +
  `  --url       宿主内部 webServer 地址；不传则自动发现监听端口\n` +
  `  --project   项目 id（默认读 .alm/project.json 的 id）\n` +
  `  --root      本地仓库根（默认 cwd，用于读取失败账本）\n` +
  `  --input     澄清输入文本（默认 mermaid 需求）\n` +
  `  --expect    逗号分隔的关键词，用于断言模型确实理解了意图\n` +
  `  --timeout   单次请求超时秒数（默认 330）\n` +
  `  --json      只输出结构化 JSON 报告\n` +
  `  E2E_DEBUG=1 把端口探测 / 请求诊断写到 stderr（排障用）\n`

// ---------------------------------------------------------------------------
// port discovery: find the host webServer, not the sidecar
// ---------------------------------------------------------------------------

function loopbackListeningPorts() {
  const ports = new Set()
  let text = ''
  try {
    text = execFileSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8', windowsHide: true })
  } catch {
    try {
      text = execFileSync('ss', ['-ltn'], { encoding: 'utf8', windowsHide: true })
    } catch {
      return []
    }
  }
  for (const line of text.split(/\r?\n/)) {
    // netstat: "  TCP    127.0.0.1:64561   0.0.0.0:0   LISTENING   16576"
    // ss:      "LISTEN  0  128  127.0.0.1:64561  0.0.0.0:*"
    const match = line.match(/127\.0\.0\.1:(\d+)/)
    if (match && /LISTEN/i.test(line)) ports.add(Number(match[1]))
  }
  return [...ports].sort((a, b) => a - b)
}

async function postJson(url, body, timeoutMs) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const text = await response.text()
  let payload = null
  try { payload = JSON.parse(text) } catch { /* plain-text sidecar 404 */ }
  return { status: response.status, text, payload }
}

/** A real intent endpoint answers the empty `load` with a JSON error code.
 *  The sidecar answers "not found [HTTP 404]" (plain text) and the node
 *  helper answers "Not Found" — neither is JSON. */
async function looksLikeIntentEndpoint(port) {
  try {
    const { payload } = await postJson(
      `http://127.0.0.1:${port}${INTENT_PATH}`,
      { action: 'load' },
      1_500,
    )
    return Boolean(payload && payload.ok === false && typeof payload.error?.code === 'string')
  } catch {
    return false
  }
}

async function discoverBaseUrl() {
  const ports = loopbackListeningPorts()
  if (process.env.E2E_DEBUG) console.error('[debug] ports=', ports.join(','))
  if (ports.length === 0) return { url: null, ports, reason: '没有发现任何 127.0.0.1 监听端口' }

  // AbortSignal.timeout() uses an *unref'd* timer. If every pending probe goes
  // quiet, Node sees no active handles and exits 0 with no report at all —
  // which looks exactly like a pass. A ref'd guard timer keeps the loop alive
  // so a stalled discovery always ends in a readable error instead.
  let guardTimer
  const guard = new Promise((_, reject) => {
    guardTimer = setTimeout(() => reject(new Error('端口探测超时')), 20_000)
  })
  const work = (async () => {
    // Bounded concurrency: probing 30 ports at once starved undici's pool and
    // made the whole discovery depend on a race. Six at a time, bail on first hit.
    for (let i = 0; i < ports.length; i += 6) {
      const batch = ports.slice(i, i + 6)
      const results = await Promise.all(
        batch.map(async (port) => ({ port, ok: await looksLikeIntentEndpoint(port) })),
      )
      const hit = results.find(entry => entry.ok)
      if (hit) return hit.port
    }
    return null
  })()

  let hit
  try {
    hit = await Promise.race([work, guard])
  } catch {
    return { url: null, ports, reason: '端口探测超时（宿主可能无响应）' }
  } finally {
    clearTimeout(guardTimer)
  }
  if (process.env.E2E_DEBUG) console.error('[debug] probes hit=', hit)
  if (!hit) {
    return { url: null, ports, reason: `端口 ${ports.join(', ')} 上没有意图 API（宿主是否已启动？）` }
  }
  return { url: `http://127.0.0.1:${hit}`, ports, hit }
}

// ---------------------------------------------------------------------------
// local project / failure ledger
// ---------------------------------------------------------------------------

function resolveProject(root, explicit) {
  if (explicit) return explicit
  try {
    const project = JSON.parse(readFileSync(join(root, '.alm', 'project.json'), 'utf8'))
    if (typeof project.id === 'string' && project.id) return project.id
  } catch { /* fall through */ }
  return null
}

function recentFailures(root, sinceMs, limit = 3) {
  const dir = join(root, '.alm', 'failures')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(name => name.endsWith('.json'))
    .map(name => {
      const file = join(dir, name)
      try { return { name, mtime: statSync(file).mtimeMs, data: JSON.parse(readFileSync(file, 'utf8')) } }
      catch { return null }
    })
    .filter(entry => entry && entry.mtime >= sinceMs - 2_000)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit)
    .map(({ name, mtime, data }) => ({
      file: name,
      mtime: new Date(mtime).toISOString(),
      kind: data.kind ?? null,
      errorType: data.errorType ?? null,
      summary: typeof data.summary === 'string' ? data.summary.slice(0, 300) : null,
      parseFailureCode: data.evidence?.snapshot?.parseFailureCode ?? null,
      rawOutputExcerpt: typeof data.evidence?.snapshot?.rawOutputExcerpt === 'string'
        ? data.evidence.snapshot.rawOutputExcerpt.slice(0, 600)
        : null,
    }))
}

// ---------------------------------------------------------------------------
// result classification — the actual gate
// ---------------------------------------------------------------------------

function summarizeSession(session) {
  const draft = session?.docDraft ?? {}
  return {
    sessionId: session?.sessionId ?? null,
    state: session?.state ?? null,
    ai: session?.ai ?? null,
    aiTried: session?.aiTried === true,
    aiNote: session?.aiNote ?? null,
    itemCount: (session?.items ?? []).length,
    title: draft.title ?? null,
    goal: draft.goal ?? null,
    problem: draft.problem ?? null,
    features: (draft.features ?? []).map(f => f?.title).filter(Boolean),
    pendingCount: (draft.pending ?? []).length,
  }
}

function classify(payload, args) {
  const session = payload?.session ?? null
  const analysis = payload?.analysis ?? null
  const model = analysis?.model ?? payload?.model ?? null
  const view = summarizeSession(session)
  const failures = []

  if (!payload || payload.ok !== true) {
    return {
      verdict: 'API_ERROR',
      reason: `返回体不是成功响应：${payload?.error?.code ?? 'unknown'} ${payload?.error?.message ?? ''}`.trim(),
      view, model, failures,
    }
  }

  // Hard gate 1: a local fallback is never a real clarification, even at 200.
  if (payload.localFallback === true || payload.ai === 'none' || view.ai === 'none') {
    const verdict = view.aiTried ? 'MODEL_RAN_BUT_FAILED' : 'NO_MODEL_SHORTCIRCUIT'
    return {
      verdict,
      reason: view.aiTried
        ? '模型被调用了，但结果不可用，回落成 localFallback（不是澄清成功）'
        : '请求被本地短路（例如结构化输入），模型根本没被调用',
      view, model, failures,
      aiNote: view.aiNote,
    }
  }

  // Hard gate 2: a real model must be named on the analysis run.
  if (!analysis || !model || typeof model.provider !== 'string' || typeof model.model !== 'string' ||
      model.provider === '' || model.model === '' || model.provider === 'none' || model.model === 'none') {
    failures.push('返回体缺少 analysis.model：无法证明真实模型参与了这次澄清')
  }

  // Hard gate 3: the model must have produced substantive content.
  const items = analysis?.items ?? session?.items ?? []
  if (!Array.isArray(items) || items.length < 1) {
    failures.push('模型没有产出任何澄清条目 (items 为空)')
  }
  const semanticText = [
    view.goal, view.problem, view.title,
    ...view.features,
    ...items.flatMap(item => [
      item?.userProblem, item?.desiredOutcome,
      item?.candidate?.title, item?.candidate?.problem, item?.candidate?.goal,
    ]),
  ].filter(Boolean).join(' ')
  if (semanticText.trim().length < 20) {
    failures.push('模型输出没有实质语义内容（无法证明需求被理解）')
  }
  const lowered = semanticText.toLowerCase()
  const hits = args.expect.filter(word => lowered.includes(String(word).toLowerCase()))
  if (args.expect.length > 0 && hits.length === 0) {
    failures.push(`模型输出没有命中意图关键词 ${args.expect.join('/')}：可能答非所问或走了本地兜底`)
  }

  // Hard gate 4: the follow-up question must be a real, mutually-exclusive
  // trade-off from the model — not the hardcoded filler options or the
  // single open fallback question.
  const question = analysis?.nextQuestion ?? session?.nextQuestion ?? null
  const options = Array.isArray(question?.options) ? question.options : []
  if (!question || typeof question.text !== 'string' || question.text.trim() === '') {
    failures.push('模型没有产出追问 (nextQuestion)')
  }
  if (options.length < 2) {
    failures.push(`追问只有 ${options.length} 个选项，不是可选择的业务取舍（fallback 开放问题是 0 个）`)
  }
  const junk = options.filter(option => JUNK_OPTION_LABELS.some(word => String(option?.label ?? '').includes(word)))
  if (junk.length > 0) {
    failures.push(`追问里出现历史硬编码凑数选项：${junk.map(o => o.label).join(' / ')}`)
  }
  const weakImpact = options.filter(option => typeof option?.impact !== 'string' || option.impact.trim().length < 8)
  if (options.length >= 2 && weakImpact.length > 0) {
    failures.push(`${weakImpact.length} 个选项缺少有意义的 impact（互斥取舍代价说明）`)
  }

  return {
    verdict: failures.length === 0 ? 'SUCCESS' : 'WEAK_RESULT',
    reason: failures.length === 0
      ? '真实模型完成了澄清，且输出理解了意图、追问是有价值的互斥取舍'
      : '真实模型响应了，但结果不满足质量门禁',
    view, model, failures,
    checks: {
      analysisRunId: analysis?.analysisRunId ?? null,
      itemCount: items.length,
      expectHits: hits,
      questionText: typeof question?.text === 'string' ? question.text.slice(0, 200) : null,
      optionCount: options.length,
      optionLabels: options.map(o => o?.label ?? null),
    },
  }
}

// ---------------------------------------------------------------------------
// reporting
// ---------------------------------------------------------------------------

function printHuman(report) {
  const line = (label, value) => console.log(`  ${label.padEnd(18)} ${value ?? '-'}`)
  console.log('\n=== 意图澄清 · 真端到端验证 ===')
  line('verdict', report.verdict)
  line('reason', report.reason)
  line('endpoint', report.url)
  line('elapsed', `${report.elapsedMs} ms`)
  line('http', report.httpStatus)
  line('project', report.project)
  if (report.discovery?.ports?.length) line('ports scanned', report.discovery.ports.join(', '))
  if (report.discovery?.hit) line('intent port', report.discovery.hit)
  console.log('\n--- 模型 / 会话 ---')
  line('model', report.classification.model ? `${report.classification.model.provider} / ${report.classification.model.model}` : null)
  line('sessionId', report.classification.view.sessionId)
  line('state', report.classification.view.state)
  line('ai / aiTried', `${report.classification.view.ai ?? 'unset'} / ${report.classification.view.aiTried}`)
  line('items', report.classification.view.itemCount)
  line('docDraft.goal', report.classification.view.goal)
  line('features', report.classification.view.features.length ? report.classification.view.features.join(' | ') : null)
  line('pending', report.classification.view.pendingCount)
  if (report.classification.checks) {
    console.log('\n--- 质量门禁 ---')
    line('runId', report.classification.checks.analysisRunId)
    line('expect hits', report.classification.checks.expectHits.join(', ') || '(none)')
    line('question', report.classification.checks.questionText)
    line('options', report.classification.checks.optionCount)
    for (const label of report.classification.checks.optionLabels) console.log(`    - ${label}`)
  }
  if (report.classification.failures.length > 0) {
    console.log('\n--- 未通过项 ---')
    for (const failure of report.classification.failures) console.log(`  ✗ ${failure}`)
  }
  if (report.classification.aiNote) console.log(`\n  aiNote: ${report.classification.aiNote}`)
  if (report.failuresRecent.length > 0) {
    console.log('\n--- 本次请求期间的失败账本 ---')
    for (const entry of report.failuresRecent) {
      console.log(`  ${entry.file}  ${entry.kind ?? ''} ${entry.errorType ?? ''}`)
      if (entry.summary) console.log(`    summary: ${entry.summary}`)
      if (entry.parseFailureCode) console.log(`    parseFailureCode: ${entry.parseFailureCode}`)
      if (entry.rawOutputExcerpt) console.log(`    rawOutputExcerpt: ${entry.rawOutputExcerpt.slice(0, 300).replace(/\s+/g, ' ')}`)
    }
  } else if (report.verdict !== 'SUCCESS') {
    console.log('\n--- 失败账本 ---\n  (本次请求期间没有新增失败记录，诊断线索可能缺失)')
  }
  console.log(`\n结论: ${report.verdict === 'SUCCESS' ? 'PASS — 真实链路可用' : 'FAIL — ' + report.reason}\n`)
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  if (process.env.E2E_DEBUG) console.error('[debug] main entered argv=', process.argv.slice(2).join('|'))
  let args
  try { args = parseArgs(process.argv.slice(2)) }
  catch (error) { console.error(`参数错误: ${error.message}`); process.exitCode = 2; return }
  if (args.help) { console.log(HELP); return }

  const root = resolve(args.root ?? process.cwd())
  const project = resolveProject(root, args.project)
  if (process.env.E2E_DEBUG) console.error('[debug] root/project=', root, project)
  if (!project) {
    console.error('无法确定项目 id：请传 --project，或确保 .alm/project.json 存在')
    process.exitCode = 2
    return
  }

  let discovery = { ports: [], reason: null }
  let baseUrl = args.url
  if (!baseUrl) {
    discovery = await discoverBaseUrl()
    if (!discovery.url) {
      console.error(`无法发现宿主意图 API：${discovery.reason}\n可用 --url 显式指定，例如 --url http://127.0.0.1:64561`)
      process.exitCode = 2
      return
    }
    baseUrl = discovery.url
  }
  if (process.env.E2E_DEBUG) console.error('[debug] baseUrl=', baseUrl, 'ports=', discovery.ports?.length)
  // ?project=<id> makes the host resolve root to the registered workspace
  // (defaultRoot is a fixture otherwise). This mirrors the real UI request.
  const url = `${baseUrl.replace(/\/$/, '')}${INTENT_PATH}?project=${encodeURIComponent(project)}`
  const body = {
    action: 'analyze',
    projectId: project,
    input: { text: args.input, source: 'text' },
    actor: 'e2e-verify',
  }

  const startedAt = Date.now()
  let result
  try {
    if (process.env.E2E_DEBUG) console.error('[debug] POST', url)
    result = await postJson(url, body, args.timeoutMs)
    if (process.env.E2E_DEBUG) console.error('[debug] POST done status=', result.status, 'bytes=', result.text.length)
  } catch (error) {
    if (process.env.E2E_DEBUG) console.error('[debug] POST threw', error?.name, error?.message)
    const report = {
      verdict: 'TRANSPORT_ERROR',
      reason: `请求未能完成：${error?.name === 'TimeoutError' ? '超时' : error?.message ?? String(error)}`,
      url, project, elapsedMs: Date.now() - startedAt, httpStatus: null,
      discovery, failuresRecent: recentFailures(root, startedAt),
      classification: { model: null, view: summarizeSession(null), failures: [], checks: null, aiNote: null },
    }
    if (args.json) console.log(JSON.stringify(report, null, 2))
    else { printHuman(report); console.error(report.reason) }
    process.exitCode = 1
    return
  }

  const elapsedMs = Date.now() - startedAt
  const classification = classify(result.payload, args)
  const report = {
    verdict: classification.verdict,
    reason: classification.reason,
    url, project, elapsedMs,
    httpStatus: result.status,
    discovery,
    input: args.input,
    expect: args.expect,
    classification,
    failuresRecent: recentFailures(root, startedAt),
    rawBodyHead: result.text.slice(0, 400),
  }

  if (args.json) console.log(JSON.stringify(report, null, 2))
  else printHuman(report)
  // Use exitCode instead of process.exit(): on Windows, exiting immediately
  // can truncate console.log output that is still buffered on a pipe/file.
  process.exitCode = report.verdict === 'SUCCESS' ? 0 : 1
}

main().catch((error) => {
  console.error(`脚本异常: ${error?.stack ?? error}`)
  process.exitCode = 2
})
