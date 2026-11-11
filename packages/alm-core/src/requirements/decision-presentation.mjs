import { parseDecisionRequest, buildDecisionAnswer } from './decision.mjs'

export const DECISION_AUTONOMY_POLICY = [
  '决策分工：产品经理只决定业务规则、功能行为、用户体验和业务范围取舍。',
  '代码组织、索引排除规则、依赖兼容、测试实现、缺陷修复等技术实现，在既有授权内由 AI 选择、实施并验证；不要把技术方案 A/B/C 交给产品经理。',
  '技术失败先查证据并修复；环境限制交由既有 Host 验收/部署链路处理，不能用反复澄清代替实施。',
  '涉及删数据、扩大权限、额外预算或发布，不属于自主技术决策，仍走原有授权边界；不降低验收标准、不替人签收。',
  '只有尚未回答的业务/功能取舍才生成决策请求，每题给 2–4 个业务选项、用户可感知的影响和推荐理由；已回答的问题不重问。',
  '收到“整理业务选项”时，表示用户没有选择任何业务方案：技术事项自行处理，剩余业务问题整理后重新请求；不能当作同意推荐项。',
].join('\n')

export const TECHNICAL_DELEGATION = '技术实现由 AI 在原需求与既有授权范围内自主决定、修复并验证；不代表选择任何历史技术选项，不授权删除数据、扩大权限或预算、降低验收标准、人工签收或发布。'
export const REFRAME_DECISION = '我尚未选择任何业务或功能方案，请把未决业务/功能问题整理成可选择的选项，说明各项影响与推荐理由后重新提出；不要替我选择推荐项。' + TECHNICAL_DELEGATION

const decisionHeading = /^##[ \t]+(?:决策\s*[0-9一二三四五六七八九十]+[ \t]*[：:、.]?[ \t]*|Q[- ]?\d+[ \t]*[：:]?[ \t]*)(.+)$/gm
// Narrow compatibility rules, not a general natural-language authorization classifier.
const technicalTopic = /重复资产|索引规则|索引排除|代码(?:组织|路径|结构)|依赖(?:版本|兼容)|测试(?:实现|框架)|构建配置|缓存失效|子进程|沙箱|\bshow\/trace\b/i
const protectedTopic = /(?:申请|扩大|提升|变更|新增).{0,8}(?:权限|预算)|(?:删除|清空|销毁|移除).{0,8}(?:生产|用户|业务)数据|(?:生产|正式)发布|签收|放宽.{0,6}(?:验收|门禁)|降低.{0,6}(?:标准|验收)/

function sectionsOf(raw) {
  let fenced = false
  const prose = raw.split('\n').map(line => {
    if (/^\s*(?:```|~~~)/.test(line)) { fenced = !fenced; return ' '.repeat(line.length) }
    return fenced ? ' '.repeat(line.length) : line
  }).join('\n')
  const headings = [...prose.matchAll(decisionHeading)]
  return headings.map((match, index) => ({
    title: match[1],
    text: prose.slice(match.index, headings[index + 1]?.index ?? prose.length),
  }))
}

/** Adapt explicit legacy choices only. No model calls, file writes or guessed options. */
function normalizeLegacy(raw) {
  let inAlternatives = false
  let alternativeIndex = 0
  return raw.split('\n').map(line => {
    if (/^(?:[-*]\s*)?类型[：:]\s*(?:业务|功能|技术|授权)\s*$/.test(line.trim())) return ''
    if (/^##\s/.test(line)) { inAlternatives = false; alternativeIndex = 0 }
    if (/^(?:两种口径|可选方案|业务选项)[：:]?$/.test(line.replaceAll('**', '').trim())) {
      inAlternatives = true
      return ''
    }
    if (inAlternatives && /^[-*]\s/.test(line) && line.includes('→')) {
      const [label, ...impact] = line.replace(/^[-*]\s+/, '').replaceAll('**', '').split('→')
      return `- 选 ${String.fromCharCode(65 + alternativeIndex++)}：${label.trim().replace(/视图\s+tab\s*/gi, '视图标签').replace(/\btab\b/gi, '标签')} — ${impact.join('→').trim()}`
    }
    return line.replace(/^##\s+Q[- ]?(\d+)\s*[：:]?\s*(.+)$/, '## 决策 $1：$2')
      .replace(/^([-*]\s+)\*\*([A-D])(?:（([^）]+)）)?\*\*[：:]\s*/, (_, bullet, key, qualifier) => `${bullet}选 ${key}${qualifier?.includes('推荐') ? '（推荐）' : ''}：`)
  }).join('\n')
}

function usableChoices(decision) {
  const keys = decision.options.map(option => option.key)
  return Boolean(decision.title || decision.question) && keys.length >= 2 && keys.length <= 4 &&
    new Set(keys).size === keys.length && decision.options.every(option => option.label && option.impact)
}

/** A product-facing projection; the original request and its CAS identity stay intact. */
export function presentDecisionRequest(text, options = {}) {
  const raw = typeof text === 'string' ? text.replace(/\r\n?/g, '\n') : ''
  const parsed = parseDecisionRequest(normalizeLegacy(raw), options)
  const source = sectionsOf(raw)
  const technicalDecisions = []
  const authorizationDecisions = []
  const decisions = []
  parsed.decisions.forEach((decision, index) => {
    const original = source[index]
    const type = /^(?:[-*]\s*)?类型[：:]\s*(业务|功能|技术|授权)\s*$/m.exec(original?.text ?? '')?.[1]
    const topic = original?.title ?? decision.title
    const protectedDecision = type === '授权' || protectedTopic.test(original?.text ?? topic)
    const technical = !protectedDecision && (type === '技术' || (!type && technicalTopic.test(topic)))
    if (protectedDecision) authorizationDecisions.push({ id: decision.id, title: '需专项授权的事项', category: 'authorization' })
    else if (technical) technicalDecisions.push({ id: decision.id, title: '技术实现与验证', category: 'technical' })
    else decisions.push({ ...decision, title: decision.title.replace(/\b(?:REQ|TEST)-[A-Z0-9]+(?:-[A-Z0-9]+)*[：:、\s]*/g, ''), category: type === '业务' ? 'business' : 'function', selectable: usableChoices(decision) && !parsed.issues.some(issue => issue.startsWith(`决策 ${index + 1} `) && /推荐项(?:冲突|不在选项中|无法识别)/.test(issue)) })
  })
  const selectable = authorizationDecisions.length === 0 && decisions.length > 0 && decisions.every(decision => decision.selectable)
  const technicalOnly = authorizationDecisions.length === 0 && decisions.length === 0 && technicalDecisions.length > 0
  return {
    ...parsed,
    // Do not put legacy technical metadata or unrelated facts above the choices.
    businessQuestion: decisions[0]?.title || parsed.businessQuestion || '',
    context: parsed.complete ? parsed.context : [],
    decisions, technicalDecisions, authorizationDecisions, technicalOnly, selectable,
    complete: selectable,
    issues: selectable ? [] : authorizationDecisions.length ? ['包含需专项授权的事项，请分开整理'] : parsed.issues,
    formatIssues: parsed.issues,
  }
}

/** Validate picks against the current server projection; never trust labels from the client. */
export function buildProductDecisionAnswer(parsed, response) {
  const invalid = message => { throw Object.assign(new Error(message), { code: 'decision-selection-invalid', status: 422 }) }
  if (!response || typeof response !== 'object') invalid('请选择业务方案')
  if (response.note !== undefined && (typeof response.note !== 'string' || response.note.length > 4000)) invalid('补充说明请控制在 4000 字以内')
  const note = response.note?.trim() ? `\n补充业务约束：${response.note.trim()}` : ''
  if (response.action === 'reframe') return REFRAME_DECISION + note
  if (response.action === 'delegate') {
    if (!parsed?.technicalOnly) invalid('还有未决业务问题，不能只交回技术处理')
    return TECHNICAL_DELEGATION + note
  }
  if (response.action !== 'choose' || !parsed?.selectable) invalid('当前问题尚未整理为完整选项，请先让 AI 整理')
  const picks = response.selections
  if (!picks || typeof picks !== 'object' || Array.isArray(picks)) invalid('请完成每一道业务问题的选择')
  if (Object.keys(picks).some(id => !parsed.decisions.some(decision => decision.id === id))) invalid('选择项已变化，请重新读取')
  for (const decision of parsed.decisions) {
    if (!Object.hasOwn(picks, decision.id) || !decision.options.some(option => option.key === picks[decision.id])) invalid('请完成每一道业务问题的选择')
  }
  const answer = parsed.decisions.map(decision => buildDecisionAnswer({ decisions: [decision] }, picks)
    .replace(/^决策 1/, `决策 ${decision.id.slice(1)}`)).join('\n')
  return [answer, note,
    parsed.technicalDecisions.length ? TECHNICAL_DELEGATION : ''].filter(Boolean).join('\n')
}
