/**
 * Read-only "investigate this question against the current repo" support for
 * the intent clarification flow (contract: tmp/team/intent-investigation-contract.md §1).
 *
 * Everything here is plugin-local on purpose: the desktop host caches core ESM
 * modules, so this feature must not depend on a new `packages/alm-core` export.
 * The module is strictly read-only for the repository: it only writes the
 * investigation store (`.alm/intents/investigations/`) and one audit line
 * (`.alm/audit/intents/investigations.jsonl`) after a model answered.
 */
import { createHash, randomBytes } from 'node:crypto'
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, extname, isAbsolute, join, relative, sep } from 'node:path'

export const INVESTIGATION_SCHEMA = 'alm.intent-investigation/v1'
export const INVESTIGATIONS_DIR = '.alm/intents/investigations'
export const AUDIT_DIR = '.alm/audit/intents'
const AUDIT_FILE = 'investigations.jsonl'
const INVESTIGATION_ID_PATTERN = /^INV-\d{14}-[0-9a-f]{6}$/

// Read cap for one file. Real plugin sources reach 250KB (client.js); the
// evidence pack stays small because only matching lines become snippets.
const MAX_FILE_BYTES = 512 * 1024
const MAX_FILES = 40
const MAX_SNIPPETS = 60
const MAX_SNIPPET_LINES = 300
const MAX_FILE_SNIPPETS = 6
const MAX_SCANNED_FILES = 4000
const MAX_TREE_ENTRIES = 800
const MAX_SKIPPED = 100

const CODE_EXTENSIONS = new Set([
  '.mjs', '.js', '.cjs', '.ts', '.tsx', '.json', '.md', '.sdoc', '.yml', '.yaml', '.html', '.css', '.txt', '.toml',
])

// Runtime/state products never count as code evidence. `.alm/project.json` is
// the single exception (the project identity is read-only context).
const SKIPPED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', 'tmp'])
const SKIPPED_ALM_PREFIX = '.alm/'

const ZH_KEYWORDS = [
  [['加载', '载入', '读取'], ['load', 'loading', 'read']],
  [['缓存'], ['cache']],
  [['列表'], ['list']],
  [['插件'], ['plugin']],
  [['速度', '性能', '慢', '延迟'], ['performance', 'speed', 'latency', 'slow']],
  [['查询'], ['query']],
  [['过滤', '筛选'], ['filter']],
  [['界面', '页面', '显示', '渲染'], ['ui', 'page', 'render']],
  [['测试'], ['test']],
  [['需求'], ['requirement']],
  [['意图', '澄清'], ['intent']],
  [['对话', '会话'], ['session', 'dialog']],
  [['路由'], ['route']],
  [['证据', '调查'], ['evidence', 'investigate']],
  [['存储', '保存'], ['store', 'persist']],
  [['确认'], ['confirm']],
  [['滚动'], ['scroll']],
  [['提交'], ['submit']],
  [['模型', '流式'], ['model', 'stream']],
]

export class InvestigationError extends Error {
  constructor(code, message, { status, details } = {}) {
    super(message)
    this.name = 'InvestigationError'
    this.code = code
    this.status = status ?? (code === 'no-model' ? 503 : code === 'outside-root' ? 403 : code === 'too-large' ? 413 : 502)
    this.details = details
  }
}

const invalidOutput = (message) => new InvestigationError('ai-invalid-output', message)
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

function truncated(value, max) {
  const text = String(value)
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function assertRoot(root) {
  if (typeof root !== 'string' || root === '') throw new InvestigationError('invalid-request', 'root is required', { status: 400 })
  let real
  try {
    real = realpathSync(root)
  } catch {
    throw new InvestigationError('invalid-request', 'root 不存在', { status: 404 })
  }
  let info
  try {
    info = statSync(real)
  } catch {
    throw new InvestigationError('invalid-request', 'root 不可读', { status: 404 })
  }
  if (!info.isDirectory()) throw new InvestigationError('invalid-request', 'root 不是目录', { status: 400 })
  return real
}

const insideRoot = (rootReal, targetReal) => targetReal === rootReal || targetReal.startsWith(rootReal + sep)

const toRel = (rootReal, targetReal) => relative(rootReal, targetReal).split(sep).join('/')

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex')

// ---------------------------------------------------------------------------
// Evidence collection (read-only)
// ---------------------------------------------------------------------------

function questionKeywords(question) {
  const keywords = new Set()
  const latin = String(question ?? '').match(/[A-Za-z][A-Za-z0-9_-]{2,}/g) ?? []
  for (const word of latin) keywords.add(word.toLowerCase())
  for (const [zhTerms, enTerms] of ZH_KEYWORDS) {
    if (zhTerms.some((term) => String(question ?? '').includes(term))) {
      for (const word of enTerms) keywords.add(word)
    }
  }
  return [...keywords].slice(0, 24)
}

function normalizeFocusEntries({ rootReal, focus }) {
  const focusFiles = new Set()
  const focusDirs = new Set()
  const skipped = []
  if (focus === undefined || focus === null) return { focusFiles, focusDirs, skipped }
  if (!Array.isArray(focus)) throw new InvestigationError('invalid-request', 'focus must be an array', { status: 400 })
  if (focus.length > 10) throw new InvestigationError('invalid-request', 'focus 最多 10 条', { status: 400 })
  for (const entry of focus) {
    if (typeof entry !== 'string') throw new InvestigationError('invalid-request', 'focus 必须是字符串数组', { status: 400 })
    const value = entry.trim()
    if (value === '') continue
    if (value.length > 300) throw new InvestigationError('invalid-request', 'focus 每条最多 300 字符', { status: 400 })
    const normalized = value.replaceAll('\\', '/').replace(/^\.\//, '')
    if (isAbsolute(normalized)) {
      skipped.push({ path: value, reason: 'outside-root' })
      continue
    }
    const segments = normalized.split('/')
    if (segments.includes('..')) {
      skipped.push({ path: value, reason: 'outside-root' })
      continue
    }
    let real
    try {
      real = realpathSync(join(rootReal, normalized))
    } catch {
      skipped.push({ path: value, reason: 'not-found' })
      continue
    }
    if (!insideRoot(rootReal, real)) {
      skipped.push({ path: value, reason: 'outside-root' })
      continue
    }
    const rel = toRel(rootReal, real)
    let info
    try {
      info = statSync(real)
    } catch {
      skipped.push({ path: value, reason: 'not-found' })
      continue
    }
    if (info.isDirectory()) focusDirs.add(rel)
    else if (info.isFile()) focusFiles.add(rel)
  }
  return { focusFiles, focusDirs, skipped }
}

/** Walk the repo without following symlinked directories; collect candidate text files. */
function walkCandidates({ rootReal, boundary }) {
  const candidates = []
  const tree = []
  const skipped = []
  let truncated = false
  let scannedFiles = 0
  const stack = [rootReal]
  while (stack.length > 0) {
    const dir = stack.pop()
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const entry of entries) {
      const abs = join(dir, entry.name)
      const rel = toRel(rootReal, abs)
      if (SKIPPED_DIRS.has(entry.name)) continue
      if (rel.startsWith(SKIPPED_ALM_PREFIX) && rel !== '.alm/project.json') continue
      if (entry.isSymbolicLink()) {
        let real
        try {
          real = realpathSync(abs)
        } catch {
          if (skipped.length < MAX_SKIPPED) skipped.push({ path: rel, reason: 'broken-link' })
          continue
        }
        if (!insideRoot(rootReal, real)) {
          if (skipped.length < MAX_SKIPPED) skipped.push({ path: rel, reason: 'outside-root' })
          continue
        }
        let info
        try {
          info = statSync(real)
        } catch {
          continue
        }
        if (info.isDirectory()) {
          if (skipped.length < MAX_SKIPPED) skipped.push({ path: rel, reason: 'symlink' })
          continue
        }
        if (!info.isFile()) continue
        if (!CODE_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue
        if (scannedFiles >= MAX_SCANNED_FILES) {
          truncated = true
          boundary.truncated = true
          stack.length = 0
          break
        }
        scannedFiles += 1
        candidates.push({ abs: real, rel, bytes: info.size })
        if (tree.length < MAX_TREE_ENTRIES) tree.push(rel)
        else truncated = true
        continue
      }
      if (entry.isDirectory()) {
        if (rel.startsWith(SKIPPED_ALM_PREFIX)) continue
        stack.push(abs)
        continue
      }
      if (!entry.isFile()) continue
      if (!CODE_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue
      if (scannedFiles >= MAX_SCANNED_FILES) {
        truncated = true
        boundary.truncated = true
        stack.length = 0
        break
      }
      scannedFiles += 1
      let info
      try {
        info = statSync(abs)
      } catch {
        continue
      }
      candidates.push({ abs, rel, bytes: info.size })
      if (tree.length < MAX_TREE_ENTRIES) tree.push(rel)
      else truncated = true
    }
  }
  return { candidates, tree, skipped, truncated, scannedFiles }
}

function readCandidate(candidate) {
  if (candidate.bytes > MAX_FILE_BYTES) return { skipped: 'too-large' }
  let buffer
  try {
    buffer = readFileSync(candidate.abs)
  } catch {
    return { skipped: 'unreadable' }
  }
  if (buffer.length > MAX_FILE_BYTES) return { skipped: 'too-large' }
  if (buffer.includes(0)) return { skipped: 'binary' }
  return {
    bytes: candidate.bytes,
    sha256: sha256(buffer),
    content: buffer.toString('utf8'),
  }
}

function countHits(haystack, needle, cap = 8) {
  if (!needle) return 0
  let count = 0
  let index = haystack.indexOf(needle)
  while (index >= 0 && count < cap) {
    count += 1
    index = haystack.indexOf(needle, index + needle.length)
  }
  return count
}

/**
 * Collect a bounded, read-only evidence pack: relevant files, matching line
 * snippets and the repo tree. Paths are repo-relative POSIX strings.
 */
export function collectEvidence({ root, question, focus = [], limits = {} } = {}) {
  const rootReal = assertRoot(root)
  if (typeof question !== 'string' || question.trim() === '') {
    throw new InvestigationError('invalid-request', 'question is required', { status: 400 })
  }
  const maxFiles = limits.maxFiles ?? MAX_FILES
  const maxSnippets = limits.maxSnippets ?? MAX_SNIPPETS
  const maxSnippetLines = limits.maxSnippetLines ?? MAX_SNIPPET_LINES
  const keywords = questionKeywords(question)
  const boundary = {
    maxFiles,
    maxSnippets,
    truncated: false,
    skipped: [],
    scannedFiles: 0,
  }
  const normalizedFocus = normalizeFocusEntries({ rootReal, focus })
  boundary.skipped.push(...normalizedFocus.skipped)

  const walked = walkCandidates({ rootReal, boundary })
  boundary.truncated = boundary.truncated || walked.truncated
  boundary.skipped.push(...walked.skipped)
  boundary.scannedFiles = walked.scannedFiles
  if (boundary.skipped.length > MAX_SKIPPED) boundary.skipped = boundary.skipped.slice(0, MAX_SKIPPED)

  const scored = []
  for (const candidate of walked.candidates) {
    const loaded = readCandidate(candidate)
    if (loaded.skipped) {
      if (loaded.skipped === 'too-large' || loaded.skipped === 'binary') {
        if (boundary.skipped.length < MAX_SKIPPED) boundary.skipped.push({ path: candidate.rel, reason: loaded.skipped })
        boundary.truncated = true
      }
      continue
    }
    const pathHits = keywords.reduce((sum, keyword) => sum + countHits(candidate.rel.toLowerCase(), keyword), 0)
    const contentHits = Math.min(50, keywords.reduce((sum, keyword) => sum + countHits(loaded.content.toLowerCase(), keyword), 0))
    let score = pathHits * 3 + contentHits
    if (normalizedFocus.focusFiles.has(candidate.rel)) score += 1000
    if ([...normalizedFocus.focusDirs].some((dir) => candidate.rel.startsWith(`${dir}/`))) score += 500
    scored.push({ ...candidate, ...loaded, score, pathHits, contentHits })
  }

  scored.sort((a, b) => b.score - a.score || (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
  const selected = scored.slice(0, maxFiles)
  if (selected.length < scored.length) {
    boundary.truncated = true
    // Contract §1.1: file-cap overflows are reported with reason `too-many`.
    for (const entry of scored.slice(maxFiles)) {
      if (boundary.skipped.length >= MAX_SKIPPED) break
      boundary.skipped.push({ path: entry.rel, reason: 'too-many' })
    }
  }


  const files = selected.map((entry) => ({ path: entry.rel, bytes: entry.bytes, sha256: entry.sha256 }))
  const snippets = []
  let snippetLines = 0
  // Pick the strongest matching lines per file instead of the first matches in
  // file order: in a 6000-line client the top hits point at the real code path.
  outer: for (const entry of selected) {
    const lines = entry.content.split('\n')
    const hitsPerLine = []
    for (let index = 0; index < lines.length; index += 1) {
      const lower = lines[index].toLowerCase()
      const hits = keywords.reduce((sum, keyword) => sum + countHits(lower, keyword, 2), 0)
      if (hits > 0) hitsPerLine.push({ index, hits })
    }
    hitsPerLine.sort((a, b) => b.hits - a.hits || a.index - b.index)
    for (const hit of hitsPerLine.slice(0, MAX_FILE_SNIPPETS)) {
      if (snippets.length >= maxSnippets || snippetLines >= maxSnippetLines) {
        boundary.truncated = true
        break outer
      }
      snippets.push({
        path: entry.rel,
        line: hit.index + 1,
        endLine: hit.index + 1,
        text: truncated(lines[hit.index].trim(), 400),
        score: hit.hits,
      })
      snippetLines += 1
    }
  }
  if (snippets.length >= maxSnippets) boundary.truncated = true

  return {
    question: question.trim(),
    keywords,
    files,
    snippets,
    tree: walked.tree,
    boundary,
  }
}

// ---------------------------------------------------------------------------
// Model prompt (host requires message.content to be a parts array)
// ---------------------------------------------------------------------------

export function buildInvestigationMessages({ question, evidence, session } = {}) {
  const evidencePack = {
    question: evidence?.question ?? question,
    keywords: evidence?.keywords ?? [],
    repo: { projectId: session?.project?.id ?? null, tree: evidence?.tree ?? [] },
    files: evidence?.files ?? [],
    snippets: (evidence?.snippets ?? []).map((snippet) => ({
      path: snippet.path,
      line: snippet.line,
      endLine: snippet.endLine,
      text: snippet.text,
    })),
    boundary: {
      maxFiles: evidence?.boundary?.maxFiles ?? null,
      maxSnippets: evidence?.boundary?.maxSnippets ?? null,
      truncated: evidence?.boundary?.truncated ?? false,
      scannedFiles: evidence?.boundary?.scannedFiles ?? 0,
    },
  }
  const system = [
    '你是一个只读的代码现场调查员，帮助产品/需求澄清阶段回答用户问题。',
    '你只能依据下面给出的“证据包”作答，禁止声称读过证据包之外的文件，禁止猜测文件内容。',
    '每条 finding 必须给出 refs：path（仓库相对路径）、line（1 基起始行）、endLine、quote（该行的逐字原文，长度 ≥8，必须与文件一致）。',
    '引用无法逐字核对的内容一律不要放进 findings；证据不足就把 verdict 设为 not-determined，并写入 unknowns。',
    '禁止输出任何可执行字段或决定字段（apply/execute/approve/sign/publish/status/idempotencyKey/confirmed 等）；本调查不改变需求状态。',
    '不要调用工具、不要给 owner/priority 指派、不要猜测权限。',
    '只输出一个 JSON 对象，不要 Markdown 围栏，不要解释：',
    '{"verdict":"answered|partially-answered|not-determined","summary":"...","findings":[{"claim":"...","refs":[{"path":"...","line":1,"endLine":1,"quote":"..."}],"confidence":"high|medium|low"}],"unknowns":[{"description":"...","blocking":false,"resolution":"..."}],"nextStep":"..."}',
    '用户问题：',
    truncated(String(question ?? evidence?.question ?? ''), 2000),
  ].join('\n')
  const userText = [
    '证据包（只读采集，路径均相对当前仓库根）：',
    truncated(JSON.stringify(evidencePack, null, 2), 24_000),
    '请基于以上证据回答用户问题，严格遵守 JSON 契约。',
  ].join('\n\n')
  return { system, user: [{ type: 'text', text: userText }] }
}

// ---------------------------------------------------------------------------
// Normalisation + quote verification
// ---------------------------------------------------------------------------

const VERDICTS = new Set(['answered', 'partially-answered', 'not-determined'])
const CONFIDENCES = new Set(['high', 'medium', 'low'])
const BANNED_KEYS = new Set([
  'apply', 'execute', 'approve', 'sign', 'publish', 'status', 'idempotencykey', 'idempotency_key', 'confirmed',
])

function parseJsonObject(rawText) {
  const text = String(rawText ?? '').trim()
  const candidates = [text]
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) candidates.push(fenced[1].trim())
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1))
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      if (isPlainObject(parsed)) return parsed
    } catch {
      // try the next shape
    }
  }
  return null
}

function assertNoExecutableFields(value, path = '') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoExecutableFields(entry, `${path}[${index}]`))
    return
  }
  if (!isPlainObject(value)) return
  for (const key of Object.keys(value)) {
    if (BANNED_KEYS.has(key.toLowerCase())) throw invalidOutput(`调查输出包含可执行字段：${path}${key}`)
    assertNoExecutableFields(value[key], `${path}${key}.`)
  }
}

/**
 * A ref is only usable when it is well-formed; malformed refs are dropped
 * (contract §1.1: "不通过的 ref 删除并记 warning unverified-ref") instead of
 * rejecting the whole model answer.
 */
function requireFindingRef(value, index) {
  if (!isPlainObject(value)) return null
  const path = value.path
  if (typeof path !== 'string' || path.trim() === '') return null
  if (path.length > 300) return null
  const line = value.line
  if (!Number.isInteger(line) || line < 1) return null
  const endLine = value.endLine === undefined || value.endLine === null ? line : value.endLine
  if (!Number.isInteger(endLine) || endLine < line) return null
  const quote = typeof value.quote === 'string' ? value.quote.trim() : ''
  if (quote.length < 8) return null
  return { path: path.trim(), line, endLine, quote }
}

function loadFileLines(rootReal, relPath) {
  if (typeof relPath !== 'string' || relPath === '' || isAbsolute(relPath)) return null
  const normalized = relPath.replaceAll('\\', '/').replace(/^\.\//, '')
  const segments = normalized.split('/')
  if (segments.includes('..')) return null
  if (!CODE_EXTENSIONS.has(extname(normalized).toLowerCase())) return null
  let real
  try {
    real = realpathSync(join(rootReal, normalized))
  } catch {
    return null
  }
  if (!insideRoot(rootReal, real)) return null
  try {
    const info = statSync(real)
    if (!info.isFile() || info.size > 1024 * 1024) return null
    return { rel: toRel(rootReal, real), lines: readFileSync(real, 'utf8').split('\n') }
  } catch {
    return null
  }
}

function verifyRef({ rootReal, ref, cache }) {
  if (!cache.has(ref.path)) cache.set(ref.path, loadFileLines(rootReal, ref.path))
  const loaded = cache.get(ref.path)
  if (!loaded || ref.line > loaded.lines.length || ref.endLine > loaded.lines.length) return null
  const lineText = loaded.lines[ref.line - 1] ?? ''
  if (!lineText.includes(ref.quote)) return null
  return {
    path: loaded.rel,
    line: ref.line,
    endLine: ref.endLine,
    quote: ref.quote,
    verified: true,
  }
}

/**
 * Parse + validate the model answer. A ref only stays in `findings` when the
 * quoted line actually exists in the repo and contains the quote verbatim;
 * everything else degrades to `unknowns`, so the UI never shows fiction as
 * an observed fact.
 */
export function normalizeInvestigation(rawText, { evidence, root } = {}) {
  const rootReal = assertRoot(root)
  const parsed = parseJsonObject(rawText)
  if (!parsed) throw invalidOutput('调查输出不是合法 JSON')
  assertNoExecutableFields(parsed)

  const verdict = parsed.verdict
  if (!VERDICTS.has(verdict)) throw invalidOutput('verdict 非法')
  const summary = typeof parsed.summary === 'string' ? truncated(parsed.summary.trim(), 4000) : ''
  const nextStep = typeof parsed.nextStep === 'string' ? truncated(parsed.nextStep.trim(), 2000) : null
  if (parsed.findings !== undefined && parsed.findings !== null && !Array.isArray(parsed.findings)) {
    throw invalidOutput('findings 必须是数组')
  }
  if (parsed.unknowns !== undefined && parsed.unknowns !== null && !Array.isArray(parsed.unknowns)) {
    throw invalidOutput('unknowns 必须是数组')
  }

  const warnings = []
  const cache = new Map()
  const unknowns = []
  for (const [index, rawUnknown] of (parsed.unknowns ?? []).entries()) {
    if (!isPlainObject(rawUnknown)) throw invalidOutput(`unknowns[${index}] 必须是对象`)
    const description = typeof rawUnknown.description === 'string' ? rawUnknown.description.trim() : ''
    if (!description) throw invalidOutput(`unknowns[${index}].description 缺失`)
    const resolution = typeof rawUnknown.resolution === 'string' ? truncated(rawUnknown.resolution.trim(), 500) : 'pending'
    unknowns.push({
      description: truncated(description, 1000),
      blocking: rawUnknown.blocking === true,
      resolution: resolution || 'pending',
    })
  }

  const findings = []
  for (const [index, rawFinding] of (parsed.findings ?? []).entries()) {
    if (!isPlainObject(rawFinding)) throw invalidOutput(`findings[${index}] 必须是对象`)
    const claim = typeof rawFinding.claim === 'string' ? rawFinding.claim.trim() : ''
    if (!claim) throw invalidOutput(`findings[${index}].claim 缺失`)
    const confidence = CONFIDENCES.has(rawFinding.confidence) ? rawFinding.confidence : 'low'
    if (!Array.isArray(rawFinding.refs)) throw invalidOutput(`findings[${index}].refs 必须是数组`)
    if (rawFinding.refs.length > 8) throw invalidOutput(`findings[${index}].refs 最多 8 条`)
    const refs = []
    for (const [refIndex, rawRef] of rawFinding.refs.entries()) {
      const ref = requireFindingRef(rawRef, refIndex)
      if (!ref) {
        warnings.push('unverified-ref')
        continue
      }
      const verified = verifyRef({ rootReal, ref, cache })
      if (verified) refs.push(verified)
      else warnings.push('unverified-ref')
    }
    if (refs.length === 0) {
      warnings.push('unverified-ref')
      unknowns.push({ description: truncated(`未验证？${claim}`, 1000), blocking: false, resolution: 'unverified' })
      continue
    }
    findings.push({ claim: truncated(claim, 2000), refs, confidence })
  }

  let finalVerdict = verdict
  let source = 'observed_evidence'
  if (findings.length === 0) {
    finalVerdict = 'not-determined'
    source = 'hypothesis'
    if (unknowns.length === 0) {
      unknowns.push({ description: '证据不足以形成可核对的结论', blocking: false, resolution: 'need-more-evidence' })
    }
  }
  if (finalVerdict === 'not-determined') source = 'hypothesis'

  return {
    schema: INVESTIGATION_SCHEMA,
    question: truncated(String(evidence?.question ?? ''), 2000),
    verdict: finalVerdict,
    summary,
    findings,
    unknowns,
    nextStep,
    source,
    warnings: [...new Set(warnings)],
  }
}

// ---------------------------------------------------------------------------
// Run + persistence
// ---------------------------------------------------------------------------

function streamText(aiStream, options) {
  return (async function* () {
    const stream = await aiStream(options)
    for await (const chunk of stream) yield chunk
  })()
}

export async function runInvestigation({ aiStream, provider, model, root, session, question, focus = [] } = {}) {
  if (typeof aiStream !== 'function') {
    throw new InvestigationError('no-model', '未配置可用的模型，无法调查', { status: 503 })
  }
  if (!isPlainObject(session) || typeof session.sessionId !== 'string') {
    throw new InvestigationError('invalid-request', 'session 缺失', { status: 400 })
  }
  const evidence = collectEvidence({ root, question, focus })
  const { system, user } = buildInvestigationMessages({ question, evidence, session })

  // The same model sometimes wraps JSON in prose. One repair round keeps a
  // transient formatting slip from looking like "the investigation failed".
  const runOnce = async (repairNote) => {
    let output = ''
    let finishKind = null
    const messages = [{ role: 'user', content: user }]
    if (repairNote) {
      messages.push({ role: 'user', content: [{ type: 'text', text: repairNote }] })
    }
    try {
      for await (const chunk of streamText(aiStream, {
        provider,
        model,
        system,
        messages,
        temperature: 0.2,
        maxTokens: 8000,
      })) {
        if (chunk?.type === 'text-delta') output += chunk.text ?? ''
        if (chunk?.type === 'finish') finishKind = chunk.reason?.kind ?? null
        if (chunk?.type === 'finish' && chunk.reason?.kind === 'error') {
          const detail = truncated(String(chunk.reason?.message ?? chunk.reason?.error ?? ''), 200)
          throw new InvestigationError('ai-call-failed', `调查调用失败，可重试${detail ? `（${detail}）` : ''}`, { status: 502 })
        }
      }
    } catch (error) {
      if (error instanceof InvestigationError) throw error
      throw new InvestigationError('ai-call-failed', '调查调用失败，可重试', { status: 502 })
    }
    if (output.trim() === '') {
      throw new InvestigationError('ai-invalid-output', `调查返回为空（finish=${finishKind ?? 'none'}）`, { status: 502 })
    }
    return normalizeInvestigation(output, { evidence, root })
  }

  let normalized
  try {
    normalized = await runOnce(null)
  } catch (error) {
    if (!(error instanceof InvestigationError) || error.code !== 'ai-invalid-output') throw error
    normalized = await runOnce(
      '上一次回答不是合法 JSON。请只输出一个 JSON 对象，不要 Markdown 代码块、解释或前后缀；字段与枚举必须与系统要求一致。',
    )
  }
  const investigation = {
    ...normalized,
    investigationId: newInvestigationId(),
    sessionId: session.sessionId,
    projectId: session.project?.id ?? null,
    inputRevision: session.input?.inputRevision ?? null,
    question: truncated(String(question).trim(), 2000),
    focus: Array.isArray(focus) ? focus.filter((entry) => typeof entry === 'string').slice(0, 10) : [],
    model: { provider: provider ?? null, model: model ?? null },
    evidence: {
      files: evidence.files,
      snippetCount: evidence.snippets.length,
      keywords: evidence.keywords,
      boundary: {
        maxFiles: evidence.boundary.maxFiles,
        maxSnippets: evidence.boundary.maxSnippets,
        truncated: evidence.boundary.truncated,
        scannedFiles: evidence.boundary.scannedFiles,
        skippedCount: evidence.boundary.skipped.length,
      },
    },
    createdAt: new Date().toISOString(),
  }
  writeInvestigation(root, investigation)
  return { investigation, evidence }
}

function newInvestigationId(now = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  return `INV-${stamp}-${randomBytes(3).toString('hex')}`
}

export function assertInvestigationId(id) {
  if (typeof id !== 'string' || !INVESTIGATION_ID_PATTERN.test(id)) {
    throw new InvestigationError('invalid-investigation', '调查 ID 非法', { status: 422 })
  }
  return id
}

export function investigationPath(root, id) {
  assertInvestigationId(id)
  const rootReal = assertRoot(root)
  const target = join(rootReal, INVESTIGATIONS_DIR, `${id}.json`)
  if (!insideRoot(rootReal, target)) throw new InvestigationError('outside-root', '调查路径越界', { status: 403 })
  return target
}

export function writeInvestigation(root, investigation) {
  if (!isPlainObject(investigation)) throw new InvestigationError('invalid-request', 'investigation 无效', { status: 400 })
  if (investigation.schema !== INVESTIGATION_SCHEMA) {
    throw new InvestigationError('invalid-request', 'investigation.schema 非法', { status: 400 })
  }
  const target = investigationPath(root, investigation.investigationId)
  mkdirSync(dirname(target), { recursive: true })
  const temp = `${target}.${randomBytes(4).toString('hex')}.tmp`
  writeFileSync(temp, `${JSON.stringify(investigation, null, 2)}\n`, 'utf8')
  renameSync(temp, target)

  const rootReal = assertRoot(root)
  const auditDir = join(rootReal, AUDIT_DIR)
  mkdirSync(auditDir, { recursive: true })
  appendFileSync(
    join(auditDir, AUDIT_FILE),
    `${JSON.stringify({
      event: 'investigation-written',
      investigationId: investigation.investigationId,
      sessionId: investigation.sessionId ?? null,
      verdict: investigation.verdict ?? null,
      source: investigation.source ?? null,
      at: new Date().toISOString(),
    })}\n`,
    'utf8',
  )
  return toRel(rootReal, target)
}

export function readInvestigation(root, id) {
  let target
  try {
    assertInvestigationId(id)
    target = investigationPath(root, id)
  } catch {
    return null
  }
  let text
  try {
    text = readFileSync(target, 'utf8')
  } catch {
    return null
  }
  try {
    const parsed = JSON.parse(text)
    return isPlainObject(parsed) && parsed.schema === INVESTIGATION_SCHEMA ? parsed : null
  } catch {
    return null
  }
}

export function listInvestigations(root, { sessionId = null, limit = 20 } = {}) {
  let rootReal
  try {
    rootReal = assertRoot(root)
  } catch {
    return []
  }
  let names
  try {
    names = readdirSync(join(rootReal, INVESTIGATIONS_DIR))
  } catch {
    return []
  }
  const investigations = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const id = name.slice(0, -'.json'.length)
    if (!INVESTIGATION_ID_PATTERN.test(id)) continue
    const investigation = readInvestigation(rootReal, id)
    if (!investigation) continue
    if (sessionId && investigation.sessionId !== sessionId) continue
    investigations.push(investigation)
  }
  investigations.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
  return investigations.slice(0, Math.max(1, Math.min(limit, 50)))
}

// ---------------------------------------------------------------------------
// Evidence note appended to the analysis prompt (analyze.investigationIds)
// ---------------------------------------------------------------------------

export function buildEvidenceNote(investigations, { maxChars = 8000 } = {}) {
  const lines = [
    '以下是本轮澄清中已经做过的只读现场调查（observed_evidence）。这些是观察证据，引用可核对；不得扩大为已确认决定，也不得据此直接确认或执行。',
  ]
  for (const investigation of Array.isArray(investigations) ? investigations.slice(0, 5) : []) {
    lines.push('')
    lines.push(`【调查 ${investigation.investigationId}】问题：${truncated(investigation.question ?? '', 300)}`)
    lines.push(`结论：${investigation.verdict ?? 'not-determined'}（source=${investigation.source ?? 'hypothesis'}）`)
    if (investigation.summary) lines.push(`摘要：${truncated(investigation.summary, 800)}`)
    for (const finding of (investigation.findings ?? []).slice(0, 8)) {
      const refs = (finding.refs ?? [])
        .filter((ref) => ref.verified === true)
        .slice(0, 3)
        .map((ref) => `${ref.path}#L${ref.line}-L${ref.endLine} “${truncated(ref.quote, 200)}”`)
        .join('；')
      lines.push(`- ${truncated(finding.claim, 300)}${refs ? ` [${refs}]` : ''}`)
    }
    for (const unknown of (investigation.unknowns ?? []).slice(0, 4)) {
      lines.push(`- 仍未知：${truncated(unknown.description, 200)}`)
    }
  }
  return truncated(lines.join('\n'), maxChars)
}
