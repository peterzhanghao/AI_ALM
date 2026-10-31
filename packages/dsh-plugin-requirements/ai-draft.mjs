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

export function normalizeDraft(payload, { intent = '' } = {}) {
  const source = payload && typeof payload === 'object' ? payload : {}
  let title = String(source.title ?? '').replace(/^#+\s*/, '').replace(/^["'“”]+|["'“”]+$/g, '').trim()
  if (title === '') title = fallbackTitle(intent)
  title = title.slice(0, 200)
  let brief = String(source.brief ?? '').trim()
  if (brief === '') brief = `## 背景\n\n${String(intent).trim()}\n\n## 目标\n\n（待补充）`
  let priority = String(source.priority ?? '').toUpperCase()
  if (!PRIORITIES.has(priority)) {
    if (/线上|资损|紧急|P0|事故|安全/.test(intent)) priority = 'P0'
    else if (/优化|体验|文案|样式/.test(intent)) priority = 'P2'
    else priority = 'P1'
  }
  const owner = String(source.owner ?? '').trim() || '张浩'
  return {
    schema: AI_DRAFT_SCHEMA,
    title,
    brief,
    priority,
    owner,
    rationale: String(source.rationale ?? '').slice(0, 500),
  }
}

/** Turn a colloquial intent (plus chat/OCR text) into a structured requirement draft. */
export async function runAiDraft({ stream, provider, model, intent, extractedText = '', projectName = '', source = 'text' }) {
  const text = String(intent ?? '').trim()
  if (text === '') throw new AiDraftError('需求意图不能为空', { code: 'intent-required' })
  if (typeof stream !== 'function') throw new AiDraftError('AI 模型不可用（缺少 llm stream）', { code: 'ai-unavailable', status: 503 })
  const system = [
    '你是 AI Native ALM 的需求分析师。用户只给口语、聊天记录或截图文字，不要要求用户再整理结构。',
    '请把它整理成一条可直接进入评审的需求草稿，只输出一个 JSON 对象，不要 Markdown 代码围栏，不要解释。',
    'JSON 结构：',
    '{',
    '  "title": "不超过 30 字的标题，动词开头，具体可检索",',
    '  "brief": "Markdown：必须含 ## 背景、## 目标、## 范围外、## 关键决策、## 验收线索 五节；保留用户原意，不足处用（待确认）标注",',
    '  "priority": "P0 | P1 | P2（按业务影响/紧急度判断）",',
    '  "owner": "张浩",',
    '  "rationale": "一句话说明标题/优先级判断依据"',
    '}',
    '规则：title 与 brief 使用中文；不要编造具体数字与接口；owner 默认张浩，除非用户明确指定其他人；优先级拿不准时用 P1。',
  ].join('\n')
  const details = [
    `项目：${projectName || '未命名项目'}`,
    `来源：${source}`,
    extractedText ? `已解析的聊天/截图内容：\n${extractedText}` : '',
    `用户意图：\n${text}`,
  ].filter(Boolean).join('\n\n')

  let output = ''
  try {
    for await (const chunk of stream({
      provider,
      model,
      system,
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
    ...normalizeDraft(parseAiJson(output), { intent: text }),
    provider,
    model,
    generatedAt: new Date().toISOString(),
    source,
  }
}
