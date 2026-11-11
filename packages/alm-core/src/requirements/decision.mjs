/**
 * Structured decision requests.
 *
 * A decision request is the one place where a delivery executor stops and asks
 * a human to pick. The executor used to write a free-form Markdown page full of
 * commands, file paths and gate output; the person answering does not need any
 * of that to decide. This module turns either the canonical business format or
 * an older free-form page into one shape the panel can render:
 *
 *   {
 *     title, businessQuestion, context[], decisions[], waitingWork[],
 *     technicalDetails[], complete, issues[]
 *   }
 *
 * Every decision carries 2-4 options in business language, an impact per
 * option and a recommendation. Anything command-shaped is moved out of the
 * business view into `technicalDetails`, which the panel keeps collapsed.
 *
 * Pure functions only: no filesystem, no network. The parser is shared by the
 * plugin API (`runDecision`) and the unit tests, so both sides agree on what
 * "a decision request" means.
 */
export const DECISION_REQUEST_SCHEMA = 'alm.decision-request/v1'

/**
 * Canonical format handed to executors by the start/restart prompts. Kept here
 * next to the parser so the template and the parser cannot drift apart.
 */
export const DECISION_REQUEST_GUIDE = [
  '  写成决策请求时用业务语言，让不懂代码的人也能直接选：',
  '  - 标题：`# 决策请求：<一句话说清要定什么>`',
  '  - `## 要决定什么`：一句话业务问题；`## 背景`：2-4 条影响判断的事实；',
  '  - 每个决策用 `## 决策 N：<问题>`，给 2-4 个选项，每个选项一行',
  '  - 决策标题下一行标注 `类型：业务` 或 `类型：功能`；只询问产品经理能决定的规则、功能、体验与范围。',
  '    `- **选 A：<选项>** — <对时间/范围/质量的影响>`，最后一行 `- 推荐：A（一句话理由）`；',
  '  - `## 等待期间我还能做什么`；',
  '  - 命令、文件路径、日志、字段、证据放进最后的 `## 技术详情`（界面默认折叠），不要写进选项。',
].join('\n')

const HEADING_RE = /^(#{1,6})[ \t]+(.+?)[ \t]*$/
const FENCE_RE = /^[ \t]{0,3}(?:```|~~~)/
const BULLET_RE = /^[ \t]*[-*+][ \t]+(.*)$/
const DECISION_HEADING_RE = /^决策\s*([0-9一二三四五六七八九十]+)[ \t]*[：:、.]?[ \t]*(.*)$/
const OPTION_HEADING_RE =
  /^(?:选项|方案)\s*([A-Za-z0-9一二三四五六七八九十]+)[ \t]*(?:[（(][ \t]*(推荐|建议)[ \t]*[)）])?[ \t]*[：:、][ \t]*(.+)$/
const OPTION_BULLET_RE =
  /^(?:选|选项)[ \t]*([A-Za-z0-9一二三四五六七八九十]+)[ \t]*(?:[（(][ \t]*(推荐|建议)[ \t]*[)）])?[ \t]*[：:、][ \t]*(.+)$/
const IMPACT_LABEL_RE = /^(影响|代价|后果|风险|正向|收益|好处|成本)[ \t]*[：:][ \t]*(.+)$/
const QUESTION_LINE_RE = /^(?:\*\*)?问题(?:\*\*)?[ \t]*[：:][ \t]*(.+)$/
const WHY_LINE_RE = /^(?:\*\*)?(为什么[^*：:]{0,40}?决定|为什么需要你决定|需要人决定的原因)(?:\*\*)?[ \t]*[：:][ \t]*(.+)$/
const RECOMMENDATION_LINE_RE =
  /^(?:\*\*)?(?:推荐(?:项|选项|结论)?|我的建议|建议)(?:\*\*)?[ \t]*[：:][ \t]*(.+)$/

const SECTION_KIND = [
  ['question', /^(?:要决定什么|需要你决定什么|需要你决定|一句话问题|问题概述|决策问题|一句话说清|要你定什么)$/],
  ['background', /^(?:背景|背景与影响|上下文|现状|问题背景|为什么要现在决定)$/],
  ['waiting', /^(?:等待期间.*|等待时.*|在等待期间.*|我还能做什么|在等待时.*)$/],
  ['technical', /^(?:技术详情.*|技术信息.*|实现细节.*|技术实现.*|证据与命令.*|命令与证据.*|技术背景.*|附[：:]?[ \t]*技术详情.*)$/],
  ['recommendation', /^(?:推荐结论|我的建议|总结论|建议)$/],
  ['why', /^(?:为什么现在需要人决定|为什么需要人决定|为什么现在必须由人决定|为什么要现在决定)$/],
  ['problem', /^(?:\d+[.、][ \t]*)?问题(?:概述|背景)?$/],
]

const TECHNICAL_LINE_RE = [
  /`[^`]+`/,
  /(^|[\s"'（(])(?:node|pnpm|npm|npx|git|bash|powershell|python|cmd)(?:\s|$)/i,
  /\.(?:mjs|cjs|jsx?|tsx?|json|md|sdoc|lock|ya?ml)\b/,
  /(^|[\s"'（(])(?:packages|scripts|fixtures|node_modules|requirements|tests|changes)\//,
  /\.alm\//,
  /(^|[^a-z])(?:spawn|EPERM|EACCES|ENOENT|exitCode|exit code|stderr|stdout|stack trace|checkReport|heartbeatAt)(?![a-z])/i,
  /(^|\s)--[a-z][\w-]*/,
  /https?:\/\//,
  /(?:[A-Za-z]:[\\/]|\\\\[^\\\s]+\\|(?:^|[\s（("'])\.{0,2}\/)[^\s]+/,
  /\b(?:checkpoint|parsed|payload)\.[A-Za-z_]\w*\b/,
  // Legacy pages open with a metadata block (date, runs, status). It is useful
  // when debugging and noise in the business view, so it moves to 技术详情.
  /^(?:日期|时间|需求|变更|运行|状态|关联|作者|负责人|优先级)[ \t]*[：:]/,
]

const INLINE_CODE_RE = /`([^`\n]{1,300})`/g

function clampLine(value, max = 600) {
  const text = String(value ?? '')
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function trimTitle(value) {
  return String(value ?? '')
    .replace(/^RUN-\d+[ \t]*/, '')
    .replace(/^#+[ \t]*/, '')
    .trim()
}

function cleanHeading(value) {
  return String(value ?? '')
    .replace(/^\d+[.、][ \t]*/, '')
    .replace(/\*\*/g, '')
    .trim()
}

/**
 * Executors wrap option and recommendation lines in bold ("- **选 A：…** — …").
 * Markdown emphasis is presentation, not meaning: the parser matches on the
 * plain text so a bolded canonical line and a plain one behave identically.
 */
function stripEmphasis(value) {
  return String(value ?? '').replace(/\*\*/g, '')
}

function looksTechnical(line) {
  const text = String(line ?? '')
  if (!text.trim()) return false
  return TECHNICAL_LINE_RE.some((pattern) => pattern.test(text))
}

/**
 * Removes inline-code fragments from business text and records them, so a
 * sentence like "见 `packages/alm-core/src/x.mjs`" reads as business prose in
 * the card while the path stays available under 技术详情.
 */
function stripInlineCode(line, sink) {
  let text = String(line ?? '')
  text = text.replace(INLINE_CODE_RE, (match, snippet) => {
    sink.push(snippet.trim())
    return ''
  })
  return text
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([，。；：、）)])/g, '$1')
    .replace(/([（(])[ \t]+/g, '$1')
    .replace(/[（(][ \t]*[)）]/g, '')
    .trim()
}

/** Business prose from a raw Markdown line, or null when the line is command-shaped. */
function businessLine(line, sinks) {
  const raw = String(line ?? '')
  if (!raw.trim()) return null
  const marker = BULLET_RE.exec(raw)
  const body = stripEmphasis(marker ? marker[1] : raw)
  // Headings inside an unknown section (e.g. legacy "### A. …") are structure,
  // not prose: keep them out of the business question.
  if (HEADING_RE.test(raw)) return null
  if (looksTechnical(body)) {
    sinks.technical.push(body.trim())
    return null
  }
  const cleaned = stripInlineCode(body, sinks.inline)
  if (!cleaned) return null
  if (looksTechnical(cleaned)) {
    sinks.technical.push(cleaned)
    return null
  }
  return cleaned
}

function businessText(value, sinks) {
  const text = stripInlineCode(stripEmphasis(value), sinks.inline)
  if (looksTechnical(text)) {
    sinks.technical.push(text)
    return ''
  }
  return text
}

function splitOptionRest(rest, sinks) {
  const text = stripEmphasis(String(rest ?? ''))
  const parts = text.split(/[ \t]+[—–][ \t]+|[ \t]+--[ \t]+/)
  if (parts.length > 1) {
    return { label: businessText(parts.shift(), sinks), impact: businessText(parts.join(' — '), sinks) }
  }
  return { label: businessText(text, sinks), impact: '' }
}

function normalizeOptionKey(value) {
  return String(value ?? '')
    .trim()
    .replace(/^(?:选项|选|方案)\s*/, '')
    .trim()
    .toUpperCase()
}

function parseRecommendation(value, sinks) {
  const text = stripEmphasis(String(value ?? '')).trim()
  const match = /^(?:选项|选|方案)?[ \t]*([A-Za-z0-9一二三四五六七八九十]+)(?=[ \t（(：:—–-]|$)[ \t]*(?:[（(](.*?)[)）])?/.exec(text)
  if (!match) return null
  const key = normalizeOptionKey(match[1])
  if (!key) return null
  const reason = (match[2] ?? text.slice(match[0].length)).replace(/^[ \t]*[—–-]?[ \t]*/, '').trim()
  return { key, reason: businessText(reason, sinks) }
}

function optionFromParts({ key, recommended, labelRest, children, sinks }) {
  const { label, impact: inlineImpact } = splitOptionRest(labelRest, sinks)
  const impacts = []
  if (inlineImpact) impacts.push(inlineImpact)
  for (const child of children) {
    const marker = BULLET_RE.exec(child)
    if (!marker) continue
    const body = stripEmphasis(marker[1])
    const labeled = IMPACT_LABEL_RE.exec(body)
    if (labeled) impacts.push(businessText(labeled[2], sinks))
    else {
      const cleaned = businessLine(body, sinks)
      if (cleaned) impacts.push(cleaned)
    }
  }
  return {
    key: normalizeOptionKey(key),
    label,
    impact: impacts.filter(Boolean).join('；'),
    recommended: Boolean(recommended),
  }
}

/** A nested bullet block directly under an option bullet, e.g. "- 影响：…". */
function takeChildren(lines, startIndex) {
  const children = []
  let index = startIndex
  while (index < lines.length) {
    const raw = lines[index]
    if (!raw.trim()) {
      index += 1
      continue
    }
    if (/^[ \t]{2,}[-*+][ \t]+/.test(raw)) {
      children.push(raw)
      index += 1
      continue
    }
    break
  }
  return { children, next: index }
}

function parseDecisionSection({ heading, lines, kind = 'decision', sinks }) {
  const match = kind === 'decision' ? DECISION_HEADING_RE.exec(heading) : null
  const item = {
    id: null,
    title: businessText(match ? trimTitle(match[2]) : trimTitle(heading), sinks),
    question: '',
    why: '',
    options: [],
    recommendation: null,
  }
  const notes = []
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index]
    if (!raw.trim()) continue
    if (HEADING_RE.test(raw)) continue
    const marker = BULLET_RE.exec(raw)
    const body = stripEmphasis(marker ? marker[1] : raw).trim()
    const questionLine = kind === 'decision' ? QUESTION_LINE_RE.exec(body) : null
    if (questionLine) {
      item.question = businessText(questionLine[1], sinks)
      continue
    }
    const whyLine = WHY_LINE_RE.exec(body)
    if (whyLine) {
      item.why = businessText(whyLine[2], sinks)
      continue
    }
    const recommendationLine = RECOMMENDATION_LINE_RE.exec(body)
    if (recommendationLine) {
      const recommendation = parseRecommendation(recommendationLine[1], sinks)
      if (recommendation) {
        if (item.recommendation && item.recommendation.key !== recommendation.key) item.recommendationConflict = true
        item.recommendation = recommendation
      } else item.recommendationInvalid = true
      continue
    }
    if (kind === 'decision') {
      const optionMatch = marker ? OPTION_BULLET_RE.exec(body) : null
      if (optionMatch) {
        const { children, next } = takeChildren(lines, index + 1)
        index = next - 1
        item.options.push(
          optionFromParts({
            key: optionMatch[1],
            recommended: optionMatch[2],
            labelRest: optionMatch[3],
            children,
            sinks,
          }),
        )
        continue
      }
    }
    const cleaned = businessLine(raw, sinks)
    if (cleaned) notes.push(cleaned)
  }
  if (!item.question && notes.length) item.question = notes[0]
  if (!item.why) item.why = ''
  return item
}

function parseLegacyOptionHeading({ heading, lines, sinks }) {
  const match = OPTION_HEADING_RE.exec(heading)
  if (!match) return null
  return optionFromParts({
    key: match[1],
    recommended: match[2],
    labelRest: match[3],
    children: lines.filter((line) => BULLET_RE.test(line)),
    sinks,
  })
}

function sectionKind(heading) {
  for (const [kind, pattern] of SECTION_KIND) {
    if (pattern.test(heading)) return kind
  }
  return null
}

/**
 * Parses one decision request. `text` may be canonical ("## 决策 1") or an
 * older free-form page; `complete` is false whenever the business structure is
 * missing, and the panel then keeps the raw text behind a hint.
 */
export function parseDecisionRequest(text, { sourceFile = null, runId = null } = {}) {
  const raw = typeof text === 'string' ? text.replace(/\r\n?/g, '\n') : ''
  const sinks = { technical: [], inline: [] }
  const codeBlocks = []
  const sections = []
  let current = { level: 0, title: '', lines: [] }
  let title = null
  let inFence = false
  let fence = []
  let fenceTitle = ''

  for (const line of raw.split('\n')) {
    if (FENCE_RE.test(line)) {
      if (inFence) {
        codeBlocks.push({ title: fenceTitle || '命令与代码片段', lines: fence.slice() })
        fence = []
        inFence = false
      } else {
        inFence = true
        fenceTitle = current.title ? `${trimTitle(current.title)} · 代码片段` : '命令与代码片段'
      }
      continue
    }
    if (inFence) {
      fence.push(clampLine(line))
      continue
    }
    const heading = HEADING_RE.exec(line)
    if (heading) {
      sections.push(current)
      const level = heading[1].length
      const value = heading[2].trim()
      if (level === 1 && !title) title = trimTitle(value)
      current = { level, title: value, lines: [] }
      continue
    }
    current.lines.push(line)
  }
  if (inFence && fence.length) codeBlocks.push({ title: fenceTitle || '命令与代码片段', lines: fence.slice() })
  sections.push(current)

  const decisions = []
  const legacyOptions = []
  const questionLines = []
  const backgroundLines = []
  const whyLines = []
  const waitingLines = []
  const recommendationLines = []
  const technicalSections = []
  let problemHeading = null
  let technicalLevel = null
  title = title ? businessText(title, sinks) : null

  for (const section of sections) {
    if (!section.title) continue
    if (technicalLevel !== null && section.level > technicalLevel) {
      technicalSections.push(section.title, ...section.lines)
      continue
    }
    technicalLevel = null
    const heading = cleanHeading(section.title)
    if (sectionKind(heading) === 'technical') {
      technicalLevel = section.level
      technicalSections.push(...section.lines)
      continue
    }
    if (section.level === 1) {
      // Anything under the H1 before the first H2 is the document lead; keep it
      // as background only when it is prose, not a metadata table.
      if (section.lines.some((line) => line.trim())) backgroundLines.push(...section.lines)
      continue
    }
    const optionHeading = OPTION_HEADING_RE.test(heading) ? parseLegacyOptionHeading({ heading, lines: section.lines, sinks }) : null
    if (optionHeading) {
      legacyOptions.push(optionHeading)
      continue
    }
    if (DECISION_HEADING_RE.test(heading)) {
      decisions.push(parseDecisionSection({ heading, lines: section.lines, kind: 'decision', sinks }))
      continue
    }
    const kind = sectionKind(heading)
    if (kind === 'question') questionLines.push(...section.lines)
    else if (kind === 'background') backgroundLines.push(...section.lines)
    else if (kind === 'why') whyLines.push(...section.lines)
    else if (kind === 'waiting') waitingLines.push(...section.lines)
    else if (kind === 'recommendation') recommendationLines.push(...section.lines)
    else if (kind === 'technical') technicalSections.push(...section.lines)
    else if (kind === 'problem') {
      problemHeading = problemHeading ?? heading
      backgroundLines.push(...section.lines)
    } else {
      // Unknown top-level section: prose becomes background, command-shaped
      // lines still move to technical details inside businessLine().
      backgroundLines.push(...section.lines)
    }
  }

  const collect = (lines) => {
    const collected = []
    for (const line of lines) {
      const cleaned = businessLine(line, sinks)
      if (cleaned) collected.push(cleaned)
    }
    return collected
  }

  const questionProse = collect(questionLines)
  const background = collect(backgroundLines).slice(0, 12)
  const whyProse = collect(whyLines).join(' ')
  const waitingWork = collect(waitingLines).slice(0, 20)
  const recommendationSummary = collect(recommendationLines).join(' ')

  const businessQuestion =
    questionProse.find((line) => line.endsWith('？') || line.endsWith('?')) ?? questionProse[0] ?? ''

  // Legacy pages have options in their own "选项 A" sections rather than inside
  // a "决策 N" section: fold them into one decision so the person still sees
  // choices instead of a wall of text.
  if (!decisions.length && (legacyOptions.length || recommendationLines.length)) {
    decisions.push({
      id: null,
      title: problemHeading && problemHeading !== '问题' ? businessText(`决策：${problemHeading}`, sinks) : '',
      question: businessQuestion,
      why: whyProse,
      options: legacyOptions,
      recommendation: null,
    })
  }

  for (const item of decisions) {
    if (!item.question && businessQuestion) item.question = businessQuestion
    if (!item.why) item.why = whyProse
  }

  // "## 推荐结论" may summarize several decisions ("决策 1 选 A；决策 2 选 B").
  const recommendationByIndex = new Map()
  const recommendationPattern = /决策\s*([0-9一二三四五六七八九十]+)\s*[^。；\n]{0,40}?选\s*([A-Za-z0-9])/g
  let match = null
  while ((match = recommendationPattern.exec(recommendationSummary))) {
    const index = Number(match[1])
    if (Number.isFinite(index)) recommendationByIndex.set(index - 1, normalizeOptionKey(match[2]))
  }
  decisions.forEach((item, index) => {
    if (!item.recommendation && recommendationByIndex.has(index)) {
      const key = recommendationByIndex.get(index)
      const option = item.options.find((candidate) => candidate.key === key)
      item.recommendation = { key, reason: option?.label ? `选择「${option.label}」` : '' }
    }
    if (!item.recommendation) {
      const recommended = item.options.filter((option) => option.recommended)
      if (recommended.length === 1) item.recommendation = { key: recommended[0].key, reason: recommended[0].label }
    }
    item.recommendationConflict = item.recommendationConflict || item.options.some((option) => option.recommended && option.key !== item.recommendation?.key)
    item.options = item.options.map((option) => ({
      ...option,
      recommended: item.recommendation?.key === option.key,
    }))
    item.id = `D${index + 1}`
  })

  const technicalLines = []
  for (const line of sinks.technical) technicalLines.push(clampLine(line.trim()))
  for (const line of sinks.inline) technicalLines.push(clampLine(line.trim()))

  const technicalDetails = []
  if (codeBlocks.length) {
    for (const block of codeBlocks) technicalDetails.push(block)
  }
  if (technicalSections.length) {
    const lines = technicalSections.map((line) => clampLine(String(line).trim())).filter(Boolean)
    if (lines.length) technicalDetails.push({ title: '技术详情', lines })
  }
  const uniqueTechnical = [...new Set(technicalLines.filter(Boolean))]
  if (uniqueTechnical.length) technicalDetails.push({ title: '文中提到的命令、路径与字段', lines: uniqueTechnical.slice(0, 120) })

  const issues = []
  if (!raw.trim()) issues.push('决策请求文件是空的')
  if (!businessQuestion) issues.push('没有一句话业务问题')
  if (!decisions.length) issues.push('没有识别到可选择的决策项')
  decisions.forEach((item, index) => {
    const label = `决策 ${index + 1}`
    if (!item.question) issues.push(`${label} 没有问题描述`)
    if (item.options.length < 2) issues.push(`${label} 的选项少于 2 个`)
    if (item.options.length > 4) issues.push(`${label} 的选项多于 4 个`)
    const keys = new Set()
    for (const option of item.options) {
      if (keys.has(option.key)) issues.push(`${label} 的选项 ${option.key} 重复`)
      keys.add(option.key)
      if (!option.label) issues.push(`${label} 的选项 ${option.key} 没有业务描述`)
      if (!option.impact) issues.push(`${label} 的选项 ${option.key} 没有影响说明`)
    }
    if (!item.recommendation) issues.push(`${label} 没有推荐项`)
    else if (!keys.has(item.recommendation.key)) issues.push(`${label} 的推荐项不在选项中`)
    if (item.recommendationConflict) issues.push(`${label} 的推荐项冲突`)
    if (item.recommendationInvalid) issues.push(`${label} 的推荐项无法识别`)
    delete item.recommendationConflict
    delete item.recommendationInvalid
  })
  if (!waitingWork.length) issues.push('没有说明等待期间能做什么')

  return {
    schema: DECISION_REQUEST_SCHEMA,
    sourceFile,
    runId,
    title: title || null,
    businessQuestion,
    context: background,
    decisions,
    waitingWork,
    technicalDetails,
    complete: issues.length === 0,
    issues,
  }
}

/**
 * Turns the human's option picks into the answer quoted back to the executor.
 * Unpicked decisions stay out of the answer instead of being silently guessed.
 */
export function buildDecisionAnswer(parsed, selections = {}, { note = '' } = {}) {
  const lines = []
  const decisions = Array.isArray(parsed?.decisions) ? parsed.decisions : []
  decisions.forEach((item, index) => {
    const picks = selections && typeof selections === 'object' ? selections : {}
    const ownPick = (id) => Object.hasOwn(picks, id) ? picks[id] : undefined
    const selected = ownPick(item.id) ?? ownPick(String(index + 1))
    if (typeof selected !== 'string' && typeof selected !== 'number') return
    const key = normalizeOptionKey(selected)
    if (!key) return
    const options = Array.isArray(item.options) ? item.options : []
    const matches = options.filter((candidate) => candidate.key === key)
    if (matches.length !== 1 || !matches[0].label) return
    const option = matches[0]
    const title = item.title ? `（${item.title}）` : ''
    lines.push(`决策 ${index + 1}${title}：选 ${key}${option?.label ? ` — ${option.label}` : ''}`)
  })
  const extra = String(note ?? '').trim()
  if (extra) lines.push(`补充：${extra}`)
  return lines.join('\n')
}
