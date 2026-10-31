import { parseAiJson } from './ai-review.mjs'

export const AI_DRAFT_SCHEMA = 'alm.ai-draft/v1'
const PRIORITIES = new Set(['P0', 'P1', 'P2'])

export class AiDraftError extends Error {
  constructor(message, { code = 'ai-draft', status = 400 } = {}) {
    super(message)
    this.name = 'AiDraftError'
    this.code = code
    this.status = status
  }
}

function fallbackTitle(intent) {
  const first = String(intent).split(/\r?\n/)[0].replace(/^[-*#\s]+/, '').trim()
  return (first || '未命名需求').slice(0, 40)
}

function text(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

function textList(value, max) {
  const source = Array.isArray(value) ? value : value === null || value === undefined || value === '' ? [] : [value]
  return source.map(text).filter(Boolean).slice(0, max)
}

function candidatePriority(value) {
  const normalized = text(value).toUpperCase()
  return PRIORITIES.has(normalized) ? normalized : null
}

/**
 * Source references are only meaningful when they point at a real line of the
 * material the model was given. Anything else is dropped and reported as an
 * unresolved unknown instead of being shown as evidence.
 */
export function resolveSourceRefs(rawRefs, extractedText = '') {
  const lines = String(extractedText ?? '').split(/\r?\n/)
  const candidates = Array.isArray(rawRefs) ? rawRefs : rawRefs === null || rawRefs === undefined || rawRefs === '' ? [] : [rawRefs]
  const sourceRefs = []
  const unresolved = []
  const seen = new Set()

  for (const candidate of candidates) {
    let label = ''
    if (typeof candidate === 'string') {
      label = candidate
    } else if (candidate && typeof candidate === 'object') {
      const line = Number(candidate.line ?? candidate.startLine)
      label = text(candidate.ref ?? candidate.source ?? candidate.quote ?? (Number.isInteger(line) ? `#L${line}` : ''))
    }
    label = label.replace(/\s+/g, '')
    if (label === '') continue
    const match = /^#?L?(\d+)(?:-L?(\d+))?$/i.exec(label)
    if (!match) {
      unresolved.push(`无法定位的引用（格式无效）：${label}`)
      continue
    }
    const start = Number(match[1])
    const end = Number(match[2] ?? match[1])
    if (!Number.isInteger(start) || start < 1 || end < start || end > lines.length) {
      unresolved.push(`无法定位的引用（超出原文范围）：${label}`)
      continue
    }
    const quote = lines.slice(start - 1, end).join('\n').trim()
    if (quote === '') {
      unresolved.push(`无法定位的引用（原文为空行）：${label}`)
      continue
    }
    const canonical = start === end ? `#L${start}` : `#L${start}-L${end}`
    if (seen.has(canonical)) continue
    seen.add(canonical)
    sourceRefs.push({ ref: canonical, line: start, endLine: end, quote: quote.slice(0, 200) })
  }

  return { sourceRefs, unresolved }
}

/**
 * Normalize the model output into a candidate draft. The AI never fills formal
 * fields: `priority` and `owner` stay null, the priority is only a suggestion,
 * and every unresolved claim is surfaced in `unknowns` for a human to confirm.
 */
export function normalizeDraft(payload, { intent = '', extractedText = '' } = {}) {
  const source = payload && typeof payload === 'object' ? payload : {}
  let title = text(source.title).replace(/^#+\s*/, '').replace(/^["'“”]+|["'“”]+$/g, '').trim()
  if (title === '') title = fallbackTitle(intent)
  title = title.slice(0, 200)

  let brief = text(source.brief)
  if (brief === '') brief = `## 背景\n\n${String(intent).trim()}\n\n## 目标\n\n（待补充）`

  const { sourceRefs, unresolved } = resolveSourceRefs(source.sourceRefs, extractedText)
  const suggestedPriority = candidatePriority(source.suggestedPriority ?? source.priority)
  const question = textList(source.question, 1)[0] ?? null
  const counterexample = text(source.counterexample) || null

  const unknowns = textList(source.unknowns, 8)
  for (const note of unresolved) if (!unknowns.includes(note)) unknowns.push(note)
  if (sourceRefs.length === 0) unknowns.push('来源引用待确认：未能解析到聊天/截图原文行号')
  if (!suggestedPriority) unknowns.push('优先级无依据，待人工确认')
  unknowns.push('负责人由人工指定，待确认')

  return {
    schema: AI_DRAFT_SCHEMA,
    candidate: true,
    requiresHumanConfirmation: true,
    title,
    brief,
    priority: null,
    owner: null,
    suggestedPriority,
    rationale: text(source.rationale).slice(0, 500),
    claim: text(source.claim).slice(0, 500),
    sourceRefs,
    assumptions: textList(source.assumptions, 5),
    question,
    counterexample,
    acceptanceDraft: textList(source.acceptanceDraft, 5),
    unknowns,
  }
}

const SYSTEM_PROMPT = [
  '你是 AI Native ALM 的需求分析师。用户只给口语、聊天记录或截图文字，不要要求用户再整理结构。',
  '请把它整理成一条候选需求草稿，只输出一个 JSON 对象，不要 Markdown 代码围栏，不要解释。',
  'AI 输出只是候选，不会写入正式状态；不能替人做决定。',
  'JSON 结构：',
  '{',
  '  "title": "不超过 30 字的标题，动词开头，具体可检索",',
  '  "brief": "Markdown：必须含 ## 背景、## 目标、## 范围外、## 关键决策、## 验收线索 五节；保留用户原意，不足处用（待确认）标注",',
  '  "claim": "这条需求要解决的核心断言，一句话，不超过 80 字",',
  '  "suggestedPriority": "P0 | P1 | P2 或空字符串；这只是建议，不是结论",',
  '  "rationale": "标题与建议优先级的依据，尽量引用原文，不超过 120 字",',
  '  "sourceRefs": ["#L3", "#L5-L6"],',
  '  "assumptions": ["为了让草稿成立而假定的前提"],',
  '  "question": "最多 1 个必须先向提出人确认的问题；没有就给空字符串",',
  '  "counterexample": "一个可能推翻该需求的假设性反例（不是已发生的缺陷）；没有就给空字符串",',
  '  "acceptanceDraft": ["可验证的验收线索，最多 3 条"],',
  '  "unknowns": ["尚缺依据、不能由 AI 决定的事项"]',
  '}',
  '硬规则：',
  '- 不要输出 "priority" 或 "owner" 字段；优先级只放 suggestedPriority 供人工确认，负责人一律留空由人工指定。',
  '- 不得编造预期收益、具体数字、接口或负责人；没有依据就写进 unknowns 或用（待确认）标注。',
  '- sourceRefs 必须引用下方提供的聊天/截图原文行号，格式 #L<行号>（从 1 开始）；没有原文可引用时输出空数组。',
  '- title 与 brief 使用中文；不要编造具体数字与接口。',
].join('\n')

/** Turn a colloquial intent (plus chat/OCR text) into a structured candidate draft. */
export async function runAiDraft({ stream, provider, model, intent, extractedText = '', projectName = '', source = 'text' }) {
  const value = String(intent ?? '').trim()
  if (value === '') throw new AiDraftError('需求意图不能为空', { code: 'intent-required' })
  if (typeof stream !== 'function') throw new AiDraftError('AI 模型不可用（缺少 llm stream）', { code: 'ai-unavailable', status: 503 })

  const details = [
    `项目：${projectName || '未命名项目'}`,
    `来源：${source}`,
    extractedText
      ? `已解析的聊天/截图内容（行号从 1 开始，供 sourceRefs 引用）：\n${extractedText}`
      : '（没有可引用的原文，sourceRefs 输出空数组）',
    `用户意图：\n${value}`,
  ].join('\n\n')

  let output = ''
  try {
    for await (const chunk of stream({
      provider,
      model,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: [{ type: 'text', text: `${details}\n\n请输出需求草稿 JSON。` }] }],
      temperature: 0.2,
      maxTokens: 3000,
    })) {
      if (chunk?.type === 'text-delta') output += chunk.text ?? ''
      if (chunk?.type === 'finish' && chunk.reason?.kind === 'error') {
        throw new AiDraftError(chunk.reason.failure?.message ?? 'AI 调用失败', { code: 'ai-call-failed', status: 502 })
      }
    }
  } catch (error) {
    if (error instanceof AiDraftError) throw error
    throw new AiDraftError(`AI 调用失败: ${error?.message ?? String(error)}`, { code: 'ai-call-failed', status: 502 })
  }
  if (output.trim() === '') throw new AiDraftError('AI 返回为空', { code: 'ai-empty', status: 502 })
  return {
    ...normalizeDraft(parseAiJson(output), { intent: value, extractedText }),
    provider,
    model,
    generatedAt: new Date().toISOString(),
    source,
  }
}
