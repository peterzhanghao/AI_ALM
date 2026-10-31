import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export const AI_REVIEW_SCHEMA = 'alm.ai-review/v1'
export const AI_REVIEW_DIR = '.alm/reviews'

export class AiReviewError extends Error {
  constructor(message, { code = 'ai-review', status = 400 } = {}) {
    super(message)
    this.name = 'AiReviewError'
    this.code = code
    this.status = status
  }
}

function briefPath(root, asset) {
  return asset.extra?.brief ? join(resolve(root), asset.extra.brief) : join(resolve(root), 'requirements', 'briefs', `${asset.id}.md`)
}

export function readRequirementBrief(root, asset) {
  const file = briefPath(root, asset)
  return existsSync(file) ? readFileSync(file, 'utf8') : ''
}

export function aiReviewPath(root, requirementId) {
  return join(resolve(root), AI_REVIEW_DIR, `${requirementId}.ai.json`)
}

export function readAiReview(root, requirementId) {
  const file = aiReviewPath(root, requirementId)
  if (!existsSync(file)) return null
  try {
    const payload = JSON.parse(readFileSync(file, 'utf8'))
    return payload.schema === AI_REVIEW_SCHEMA ? { ...payload, file } : null
  } catch {
    return null
  }
}

export function writeAiReview(root, report) {
  const file = aiReviewPath(root, report.requirement)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  return file
}

export function aiReviewSummary(root, requirementId) {
  const stored = readAiReview(root, requirementId)
  if (!stored) return { stored: false }
  return {
    stored: true,
    requirement: stored.requirement,
    generatedAt: stored.generatedAt ?? null,
    provider: stored.provider ?? null,
    model: stored.model ?? null,
    verdict: stored.verdict ?? 'warn',
    summary: stored.summary ?? '',
    findings: (stored.findings ?? []).length,
    suggestions: (stored.suggestions ?? []).length,
    adopted: stored.adopted ?? null,
  }
}

function gateFindings(asset, check) {
  return (check.checks ?? [])
    .flatMap((rule) => (rule.findings ?? []).map((finding) => ({ rule: rule.id, level: rule.level, ...finding })))
    .filter((finding) => finding.assetId === asset.id || finding.file === asset.source.path)
    .map((finding) => `${finding.rule}（${finding.level}）${finding.message}${finding.file ? ` @ ${finding.file}:${finding.line ?? 1}` : ''}`)
}

export function buildAiReviewPrompt({ asset, item, check, briefText }) {
  const relations = (asset.links ?? []).map((link) => `${link.type} → ${link.target}`)
  const fields = [
    `需求 ID：${asset.id}`,
    `标题：${asset.title}`,
    `状态：${asset.status}`,
    `负责人：${asset.owner}`,
    `优先级：${asset.extra?.priority ?? '未设置'}`,
    `项目：${asset.extra?.project ?? item?.project ?? '未设置'}`,
    `关系：${relations.length ? relations.join('；') : '无'}`,
    `门禁发现：${gateFindings(asset, check).join('；') || '无'}`,
  ].join('\n')
  const system = [
    '你是 AI Native ALM 的资深需求评审专家，同时具备业务、架构、测试与交付视角。',
    '任务：评审一条需求，指出问题，给出可执行的重构建议和落地计划。',
    '只输出一个 JSON 对象，不要 Markdown 代码围栏，不要额外解释。JSON 结构：',
    '{',
    '  "verdict": "pass | warn | block",',
    '  "summary": "一句话结论（不超过 120 字）",',
    '  "findings": [{"title":"问题标题","severity":"block|warn|info","detail":"问题说明与影响","ref":"引用（可空）"}],',
    '  "suggestions": [{"id":"S1","title":"建议标题","category":"背景|验收|关系|范围|可测试性|其他","detail":"具体怎么改","suggestedText":"可直接采纳的文本（可空）"}],',
    '  "plan": [{"step":"步骤名","detail":"执行说明"}],',
    '  "proposedBrief": "改进后的需求背景 Markdown（可空；保留原意，补足目标、范围、边界与验收线索）"',
    '}',
    '要求：findings 最多 3 条；suggestions 最多 3 条且每条可执行；plan 最多 3 步；proposedBrief 最多 300 字；输出紧凑 JSON（不要缩进换行）；不要编造仓库事实，引用门禁/背景中的信息。',
  ].join('\n')
  const messages = [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `${fields}\n\n需求背景 Markdown：\n${briefText || '（未填写）'}\n\n请给出评审 JSON。`,
        },
      ],
    },
  ]
  return { system, messages }
}

/** Close a JSON object the model cut off mid-stream (finish: max-tokens). */
function repairTruncatedJson(candidate) {
  let inString = false
  let escaped = false
  const stack = []
  for (const char of candidate) {
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{' || char === '[') stack.push(char)
    else if (char === '}' || char === ']') stack.pop()
  }
  let repaired = candidate
  if (inString) repaired += '"'
  repaired = repaired.replace(/,\s*$/, '')
  while (stack.length) {
    const open = stack.pop()
    repaired += open === '{' ? '}' : ']'
  }
  return repaired
}

function extractJson(text) {
  const raw = String(text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '')
  const start = raw.indexOf('{')
  if (start < 0) throw new AiReviewError('AI 输出中没有 JSON 对象', { code: 'ai-parse-failed' })
  const end = raw.lastIndexOf('}')
  const candidates = [raw.slice(start)]
  if (end > start) candidates.push(raw.slice(start, end + 1))
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      if (parsed && typeof parsed === 'object') return parsed
    } catch {
      // try the truncation repair before giving up
    }
    try {
      const parsed = JSON.parse(repairTruncatedJson(candidate))
      if (parsed && typeof parsed === 'object') return parsed
    } catch {
      // next candidate
    }
  }
  throw new AiReviewError(`AI 输出 JSON 无法解析（尾部：${raw.slice(-160)}）`, { code: 'ai-parse-failed' })
}

export function parseAiJson(text) {
  return extractJson(text)
}

function normalizeReview(payload) {
  const verdict = ['pass', 'warn', 'block'].includes(payload.verdict) ? payload.verdict : 'warn'
  const findings = (Array.isArray(payload.findings) ? payload.findings : []).slice(0, 8).map((finding, index) => ({
    id: `F${index + 1}`,
    title: String(finding?.title ?? `问题 ${index + 1}`).slice(0, 160),
    severity: ['block', 'warn', 'info'].includes(finding?.severity) ? finding.severity : 'warn',
    detail: String(finding?.detail ?? '').slice(0, 2000),
    ref: String(finding?.ref ?? ''),
  }))
  const suggestions = (Array.isArray(payload.suggestions) ? payload.suggestions : []).slice(0, 8).map((suggestion, index) => ({
    id: String(suggestion?.id ?? `S${index + 1}`),
    title: String(suggestion?.title ?? `建议 ${index + 1}`).slice(0, 160),
    category: String(suggestion?.category ?? '其他').slice(0, 40),
    detail: String(suggestion?.detail ?? '').slice(0, 3000),
    suggestedText: String(suggestion?.suggestedText ?? '').slice(0, 3000),
  }))
  const plan = (Array.isArray(payload.plan) ? payload.plan : []).slice(0, 8).map((entry, index) => ({
    step: String(entry?.step ?? `步骤 ${index + 1}`).slice(0, 120),
    detail: String(entry?.detail ?? '').slice(0, 2000),
  }))
  return {
    verdict,
    summary: String(payload.summary ?? '').slice(0, 600),
    findings,
    suggestions,
    plan,
    proposedBrief: String(payload.proposedBrief ?? '').slice(0, 12000),
  }
}

/** One AI call over an injected model stream; returns a normalized review. */
export async function runAiReview({ stream, provider, model, asset, item, check, briefText }) {
  if (typeof stream !== 'function') throw new AiReviewError('AI 模型不可用（缺少 llm stream）', { code: 'ai-unavailable', status: 503 })
  const prompt = buildAiReviewPrompt({ asset, item, check, briefText })
  let text = ''
  const seen = []
  let finishKind = null
  try {
    for await (const chunk of stream({
      provider,
      model,
      system: prompt.system,
      messages: prompt.messages,
      temperature: 0.2,
      maxTokens: 6000,
    })) {
      if (chunk?.type) seen.push(chunk.type)
      if (chunk?.type === 'text-delta') text += chunk.text ?? ''
      if (chunk?.type === 'finish') finishKind = chunk.reason?.kind ?? null
      if (chunk?.type === 'finish' && chunk.reason?.kind === 'error') {
        throw new AiReviewError(chunk.reason.failure?.message ?? 'AI 调用失败', { code: 'ai-call-failed', status: 502 })
      }
    }
  } catch (error) {
    if (error instanceof AiReviewError) throw error
    throw new AiReviewError(`AI 调用失败: ${error?.message ?? String(error)}`, { code: 'ai-call-failed', status: 502 })
  }
  if (text.trim() === '') {
    throw new AiReviewError(
      `AI 返回为空（${provider}/${model}；chunks: ${seen.join(',') || 'none'}；finish: ${finishKind ?? 'none'}）`,
      { code: 'ai-empty', status: 502 },
    )
  }
  return {
    schema: AI_REVIEW_SCHEMA,
    requirement: asset.id,
    provider,
    model,
    generatedAt: new Date().toISOString(),
    ...normalizeReview(extractJson(text)),
    adopted: null,
  }
}

const ADOPT_HEADING = '## AI 评审建议（已采纳'

/**
 * Split a brief into its authored body and the previously adopted AI section.
 * The section always lives at the tail of the brief, so a single heading match
 * is enough: everything from that heading on is replaced, never accumulated.
 */
function splitAdoptedSection(text) {
  const index = text.search(/^## AI 评审建议（已采纳/m)
  if (index < 0) return { base: text.replace(/\s+$/, ''), hadSection: false }
  // Slice the original text instead of rebuilding it line by line: rebuilding
  // would rewrite the authored body's line endings on every adoption and make
  // an otherwise idempotent second adoption look like a change.
  return { base: text.slice(0, index).replace(/\s+$/, ''), hadSection: true }
}

/**
 * Append selected suggestions + plan to the brief. Repeated adoption is
 * replacement-based: the old AI section is cut off first, so clicking
 * 采纳 several times never grows the brief.
 */
export function adoptAiReview({ root, asset, report, selectedSuggestionIds = [] }) {
  const wanted = [...new Set((selectedSuggestionIds ?? []).map((id) => String(id)))]
  const suggestions = Array.isArray(report.suggestions) ? report.suggestions : []
  const selected = suggestions.filter((suggestion) => wanted.includes(String(suggestion.id)))
  // Accepting a review without picking suggestions is valid: adoption then
  // records the acceptance only and leaves the authored brief untouched.
  if (selected.length === 0) {
    const adopted = {
      at: new Date().toISOString(),
      suggestionIds: [],
      includeBrief: false,
      sectionReplaced: false,
      noSuggestions: true,
    }
    const next = { ...report, adopted }
    writeAiReview(root, next)
    return { ...next, changed: false }
  }
  const file = briefPath(root, asset)
  const existing = existsSync(file) ? readFileSync(file, 'utf8') : ''
  const { base, hadSection } = splitAdoptedSection(existing)
  const lines = [
    '',
    '',
    `${ADOPT_HEADING} ${new Date().toISOString().slice(0, 10)}）`,
    '',
    `> AI 结论（${report.verdict}）：${report.summary}`,
    '',
    '### 采纳建议',
    ...selected.flatMap((suggestion) => {
      const entry = [`- **[${suggestion.category}] ${suggestion.title}**：${suggestion.detail}`]
      if (suggestion.suggestedText) entry.push(`  - 建议文本：${suggestion.suggestedText}`)
      return entry
    }),
  ]
  if ((report.plan ?? []).length) {
    lines.push('', '### 重构方案', ...report.plan.map((entry, index) => `${index + 1}. **${entry.step}**：${entry.detail}`))
  }
  // The full proposed brief stays in .alm/reviews/<REQ>.ai.json. It is not
  // pasted into the requirement brief: adopting several times used to grow a
  // second, near-duplicate copy of the whole document. The brief keeps one
  // compact, replaceable AI section instead.
  const newline = existing.includes('\r\n') ? '\r\n' : '\n'
  const section = lines.join('\n').replace(/\n/g, newline)
  const nextContent = `${base}${section}${newline}`
  const changed = nextContent !== existing
  if (changed) {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, nextContent, 'utf8')
  }
  const adopted = {
    at: new Date().toISOString(),
    suggestionIds: selected.map((suggestion) => suggestion.id),
    includeBrief: false,
    sectionReplaced: hadSection,
  }
  const next = { ...report, adopted }
  writeAiReview(root, next)
  return { ...next, changed }
}
