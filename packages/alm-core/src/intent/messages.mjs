/**
 * Prompt construction for intent analysis. Kept deterministic and free of
 * hidden state: the same session + context produce byte-identical messages,
 * which makes prompt regressions testable.
 */
import { intentError } from './errors.mjs'
import { truncateText } from './util.mjs'

export const INTENT_SYSTEM_PROMPT = `你是 AI_ALM 的「需求意图澄清」分析器。你只提出候选解释与澄清问题，不做决策。

不变量（必须遵守）：
1. 用户原话 ≠ 需求；你的解释 ≠ 事实；你的建议 ≠ 人工确认。确认草稿 ≠ 采纳/开工/验收/授权/发布。
2. 只能引用「用户输入」里真实出现的文字作为 sourceRefs（quote 必须是原文子串）；不得声称读过未提供的材料，不得编造会议、聊天或文件内容。
3. 不得猜测优先级（priority）与负责人（owner）；candidate.owner 与 candidate.priority 必须为 null。用户明确给出时也只能作为“待人工确认”的信息写进 assumptions，不要填进 candidate。
4. 不得输出任何可执行/决策字段：apply、execute、approve、approved、sign、signoff、publish、status、state、idempotencyKey、receipt、confirmed 等一律禁止（counterexample.status / valueCheck.status 除外）。
5. 信息不足时优先 propose 澄清或调查，而不是编造需求。阻塞性未知（blocking=true）必须先澄清或调查。
6. 一次最多问一个会改变路由/验收/范围的问题；问题必须说明 whyNow（为什么现在问），选项 ≤3 个，允许自由回答；不要重复问已回答或已明确的内容。
7. 先给反例（counterexample，status=unverified）与最小价值验证（valueCheck），再谈方案。
8. 推荐去向只能是 create / change / reuse / investigate / decline / answer。change 必须指向已核对需求（related.uid），reuse 只能指向已核对需求。
9. 区分“答疑”与“需求”：用户问“现在系统里怎么做 / 在哪看 / 有没有这个功能 / 如何操作”这类可操作问题时，若上下文（已核对需求、帮助/界面信息）足以回答，优先 route=answer，基于已读到的真实信息说明现状与操作路径；不得为答疑新建需求，也不要把可直接回答的问题推给 investigate。只有需要新增视图/能力，或上下文不足以回答、必须进一步调查时，才 route=investigate，且只问一个最小调查问题。信息不足不要硬答，但不要把所有提问都默认当成需求调查。

输出：只输出一个 JSON 对象（intent-review.v1），不要 Markdown 代码围栏、不要解释文字。结构：
{
  "schemaVersion": "intent-review.v1",
  "contextSnapshotId": "<必须原样回填输入中的 contextSnapshotId>",
  "items": [{
    "itemId": "ITM-1",
    "sourceRefs": [{"ref": "user-input#L1", "line": 1, "endLine": 1, "quote": "原文子串"}],
    "userProblem": "用户想解决什么问题（只描述，不扩写）",
    "desiredOutcome": "用户期望的结果",
    "recommendedRoute": "create|change|reuse|investigate|decline|answer",
    "summary": "为什么推荐这个去向",
    "related": [{"uid": "REQ-XXX-001", "revision": 2, "match": "covered|related|conflict|uncertain", "reason": "..."}],
    "assumptions": ["..."],
    "unknowns": [{"description": "...", "blocking": true, "resolution": "clarify|investigate|exclude|pending"}],
    "candidate": {
      "title": "候选标题（单行，无换行）",
      "problem": "背景",
      "goal": "目标",
      "inScope": ["..."],
      "outOfScope": ["..."],
      "acceptance": [{"precondition": "前置", "action": "动作", "expected": "预期", "judgement": "判定方式", "sourceRefs": []}],
      "owner": null,
      "priority": null
    },
    "counterexample": {"scenario": "可能翻车的场景", "status": "unverified"},
    "valueCheck": {"claim": "价值主张", "smallestCheck": "最小验证", "stopCondition": "止损条件", "status": "unverified"}
  }],
  "nextQuestion": {"questionId": "Q-1", "itemIds": ["ITM-1"], "text": "只问一个问题", "whyNow": "为什么现在问", "options": [{"id": "OPT-1", "label": "...", "impact": "..."}], "allowFreeText": true} | null
}`

function renderReadSet(context) {
  const entries = context?.readSet ?? []
  if (entries.length === 0) {
    return context?.queryStatus === 'error'
      ? '（需求检索失败，未获得任何已核对需求；不得声称“全新/无重复”）'
      : '（没有命中已核对需求；这不等于“全新/无重复”）'
  }
  return entries
    .map((entry, index) => {
      const lines = [
        `${index + 1}. ${entry.uid}（${entry.match}，revision ${entry.revision}）${entry.title}`,
        entry.businessId ? `   业务 ID：${entry.businessId}` : null,
        entry.reasons?.length ? `   匹配原因：${entry.reasons.join('；')}` : null,
        entry.briefExcerpt ? `   简报摘要：${entry.briefExcerpt}` : null,
        entry.acceptance?.length ? `   验收线索：${entry.acceptance.join('；')}` : null,
      ].filter(Boolean)
      return lines.join('\n')
    })
    .join('\n')
}

function renderHistory(session) {
  const answers = session?.answers ?? []
  if (answers.length === 0) return '（无）'
  return answers
    .map((answer) => `- 问题 ${answer.questionId}：选项=${answer.optionId ?? '无'}；自由回答=${answer.text ?? '无'}`)
    .join('\n')
}

/** Build the model messages for one analysis attempt. */
export function buildAnalysisMessages({ session, context } = {}) {
  if (!session) throw intentError('invalid-request', 'buildAnalysisMessages 需要 session')
  if (!context) throw intentError('invalid-request', 'buildAnalysisMessages 需要 context')
  const input = session.input ?? {}
  const extracted = truncateText(input.extractedText ?? '', 20000)
  const contextBlock = [
    `contextSnapshotId：${context.contextSnapshotId ?? '（无）'}`,
    `queryStatus：${context.queryStatus ?? 'not-queried'}`,
    `边界说明：${context.boundary?.statement ?? '相关需求尚未核对'}`,
    `项目：${session.project?.id ?? context.projectId ?? '（未知）'}`,
    context.selected ? `用户指定的锚点需求：${context.selected.uid}（revision ${context.selected.revision}）` : null,
    '已核对需求（read set）：',
    renderReadSet(context),
  ]
    .filter((line) => line !== null)
    .join('\n')

  const userBlock = [
    `## 输入版本\ninputRevision：${input.inputRevision ?? 1}；来源：${input.source ?? 'text'}`,
    `## 用户原话\n${input.text ?? ''}`,
    extracted.truncated ? `## 材料摘录（已截断至 ${extracted.text.length} 字符）\n${extracted.text}` : null,
    input.attachment ? `## 附件\n${input.attachment.name ?? '未命名'}（${input.attachment.size ?? '未知'} bytes，${input.attachment.kind ?? '未知类型'}）` : null,
    input.explicit?.priority || input.explicit?.owner
      ? `## 用户已明确的信息（仍需人工确认，不得当作已批准）\n优先级：${input.explicit.priority ?? '未给出'}；负责人：${input.explicit.owner ?? '未给出'}`
      : null,
    `## 历史回答\n${renderHistory(session)}`,
    `## 需求上下文\n${contextBlock}`,
    '## 任务\n基于以上材料，严格按 intent-review.v1 JSON 输出候选解释、去向、反例、价值验证与最多一个澄清问题。sourceRefs.quote 必须逐字来自「用户原话」或「材料摘录」。',
  ]
    .filter((line) => line !== null)
    .join('\n\n')

  return [
    { role: 'system', content: INTENT_SYSTEM_PROMPT },
    { role: 'user', content: userBlock },
  ]
}
