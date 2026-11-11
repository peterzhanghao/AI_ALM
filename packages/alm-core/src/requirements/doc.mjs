// Requirement document contract (v5): the single parser/renderer for the
// canonical Markdown BRIEF. Markdown is the only source of truth; the `doc`
// object is a pure projection. This module is deliberately dependency-free
// (node:crypto only) so both core and plugin consumers can import it.

import { createHash } from 'node:crypto'

export const DOC_SCHEMA = 'alm.requirement.doc/v1'

// Provenance values a clause may carry. Only the first four may enter a
// formal commitment; `ai-suggestion` / `unconfirmed` are pushed to `pending`.
export const DOC_PROVENANCES = Object.freeze([
  'user-stated',
  'user-answer',
  'human-edit',
  'verified-context',
  'ai-suggestion',
  'unconfirmed',
])

export const PENDING_STATUSES = Object.freeze(['open', 'done'])

const FORMAL_PROVENANCE = new Set(['user-stated', 'user-answer', 'human-edit', 'verified-context'])
const AI_PROVENANCE = new Set(['ai-suggestion', 'unconfirmed'])

const SECTION_TITLES = Object.freeze({
  goal: '目标',
  problem: '问题与场景',
  features: '详细功能',
  scope: '本次范围',
  outOfScope: '不包含',
  acceptance: '验收要求',
  constraints: '必要约束',
  pending: '待确认',
})

const CANONICAL_HEADINGS = new Set(Object.values(SECTION_TITLES))

const HEADING_ALIASES = new Set(['背景', '范围内', '范围外', '不包含事项', '验收标准', '验收条件', '约束'])

const HEADING_KIND = new Map([
  ['目标', 'goal'],
  ['问题与场景', 'problem'],
  ['背景', 'problem'],
  ['详细功能', 'features'],
  ['本次范围', 'scope'],
  ['范围内', 'scope'],
  ['不包含', 'outOfScope'],
  ['范围外', 'outOfScope'],
  ['不包含事项', 'outOfScope'],
  ['验收要求', 'acceptance'],
  ['验收标准', 'acceptance'],
  ['验收条件', 'acceptance'],
  ['必要约束', 'constraints'],
  ['约束', 'constraints'],
  ['待确认', 'pending'],
])

const SECTION_LABELS = [
  '目标',
  '问题与场景',
  '背景',
  '详细功能',
  '本次范围',
  '范围内',
  '不包含事项',
  '不包含',
  '范围外',
  '验收要求',
  '验收标准',
  '验收条件',
  '必要约束',
  '约束',
  '待确认',
]

const BOLD_LABEL_RE = new RegExp(`^\\s*\\*\\*\\s*(${SECTION_LABELS.join('|')})\\s*\\*\\*\\s*[:：]?\\s*(.*)$`)

const FEATURE_FIELD_KIND = new Map([
  ['行为', 'behavior'],
  ['前置', 'preconditions'],
  ['响应', 'response'],
  ['边界', 'boundaries'],
  ['来源', 'sources'],
])

const ACCEPTANCE_FIELD_KIND = new Map([
  ['前置', 'precondition'],
  ['动作', 'action'],
  ['操作', 'action'],
  ['预期', 'expected'],
  ['判定', 'judgement'],
  ['来源', 'sources'],
])

const FEATURE_HEADING_RE = /^###\s+(FR-\d{2,})\s*(.*)$/
const FEATURE_BULLET_RE = /^\s*[-*]\s*(行为|前置|响应|边界|来源)\s*[:：]\s*(.*)$/
const ACCEPTANCE_HEADING_RE = /^\s*[-*]\s+(AC-\d{2,})\s*(?:[（(]([^）)]*)[）)])?\s*(.*)$/
const ACCEPTANCE_FIELD_RE = /^\s*[-*]\s*(前置|动作|操作|预期|判定|来源)\s*[:：]\s*(.*)$/
const BULLET_RE = /^\s*[-*]\s+(.*)$/
const NUMBERED_RE = /^\s*(\d+)[.、)]\s+(.*)$/
const PENDING_LINE_RE = /^\s*[-*]\s*\[([ xX])\]\s*(.*)$/
const META_LINE_RE = /^\s*<!--\s*alm:meta\b.*-->\s*$/
const FR_ID_RE = /^FR-\d{2,}$/
const AC_ID_RE = /^AC-\d{2,}$/
const PENDING_ID_RE = /^Q-\d{2,}$/
const REQUIREMENT_ID_RE = /^[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)+$/
const SHA256_RE = /^sha256:[0-9a-f]{64}$/
const HASH_PREFIX = 'sha256:'

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function clone(value) {
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value))
}

function asString(value) {
  return typeof value === 'string' ? value : ''
}

function trimText(value) {
  return asString(value).replace(/\r\n?/g, '\n').trim()
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function cleanStringList(value) {
  const seen = new Set()
  const out = []
  for (const entry of asArray(value)) {
    const text = trimText(entry)
    if (text === '' || seen.has(text)) continue
    seen.add(text)
    out.push(text)
  }
  return out
}

function pad2(number) {
  return String(number).padStart(2, '0')
}

function idNumber(value, prefix) {
  const match = new RegExp(`^${prefix}-(\\d{2,})$`).exec(String(value ?? ''))
  return match ? Number(match[1]) : null
}

function maxIdNumber(items, prefix) {
  let max = 0
  for (const item of asArray(items)) {
    const number = idNumber(item?.id, prefix)
    if (number !== null && number > max) max = number
  }
  return max
}

function intOr(value, fallback) {
  return Number.isInteger(value) && value >= 1 ? value : fallback
}

function normalizeProvenance(value) {
  const text = asString(value)
  if (text === '') return 'user-stated'
  return DOC_PROVENANCES.includes(text) ? text : 'unconfirmed'
}

function emptyDoc() {
  return {
    schema: DOC_SCHEMA,
    requirementId: null,
    revision: null,
    docHash: null,
    title: '',
    goal: '',
    problem: '',
    features: [],
    scope: [],
    outOfScope: [],
    acceptance: [],
    constraints: [],
    pending: [],
    meta: { nextFr: 1, nextAc: 1, confirmedAt: null },
  }
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

function isMetaLine(line) {
  return META_LINE_RE.test(String(line ?? ''))
}

/**
 * Canonical content hash. The `alm:meta` line is stripped entirely (it carries
 * the hash itself and bookkeeping), CRLF becomes LF, trailing whitespace is
 * removed per line, consecutive blank lines collapse, and the whole text is
 * trimmed. Pure blank-line/indent churn therefore never changes the hash.
 */
export function docHashOf(markdown) {
  const lines = String(markdown ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((line) => !isMetaLine(line))

  const collapsed = []
  for (const raw of lines) {
    const line = raw.replace(/[ \t]+$/, '')
    if (line === '' && collapsed.length > 0 && collapsed[collapsed.length - 1] === '') continue
    if (line === '' && collapsed.length === 0) continue
    collapsed.push(line)
  }
  const text = collapsed.join('\n').trim()
  return `${HASH_PREFIX}${createHash('sha256').update(text, 'utf8').digest('hex')}`
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function parseMetaLine(line, warnings) {
  const body = String(line)
    .replace(/^\s*<!--\s*alm:meta\s*/, '')
    .replace(/\s*-->\s*$/, '')
    .trim()
  if (body === '') return null
  try {
    const parsed = JSON.parse(body)
    if (!isPlainObject(parsed)) {
      warnings.push('alm:meta 不是对象，已忽略')
      return null
    }
    return parsed
  } catch {
    warnings.push('alm:meta 不是合法 JSON，已忽略')
    return null
  }
}

function pushUnparsed(unparsed, warnings, title, lines) {
  const text = asArray(lines).join('\n').replace(/\s+$/, '')
  if (text.trim() === '') return
  unparsed.push({ title: title ?? '（未命名段落）', text })
  warnings.push(`章节「${title ?? '（未命名段落）'}」未能按规范解析，已原样保留`)
}

function extractListItems(lines) {
  const items = []
  let current = null
  for (const raw of asArray(lines)) {
    const line = String(raw)
    const bullet = line.match(/^\s*[-*]\s+(.*)$/)
    const numbered = line.match(/^\s*\d+[.、)]\s+(.*)$/)
    if (bullet) {
      items.push(bullet[1].trim())
      current = items.length - 1
    } else if (numbered) {
      items.push(numbered[1].trim())
      current = items.length - 1
    } else if (line.trim() === '') {
      current = null
    } else if (current !== null && /^\s{2,}/.test(line)) {
      items[current] = `${items[current]}\n${line.trim()}`.trim()
    } else {
      items.push(line.trim())
      current = items.length - 1
    }
  }
  return items.filter((entry) => entry !== '')
}

function splitFeatureIds(value) {
  return String(value ?? '')
    .split(/[、,，;；\s]+/)
    .map((entry) => entry.trim().toUpperCase())
    .filter((entry) => FR_ID_RE.test(entry))
}

function legacyAcceptanceEntry(text) {
  const entry = {
    id: null,
    featureIds: [],
    text: '',
    precondition: '',
    action: '',
    expected: '',
    judgement: '',
    sources: [],
    provenance: 'user-stated',
  }
  const rest = []
  for (const part of String(text ?? '').split(/[；;]/)) {
    const trimmed = part.trim()
    if (trimmed === '') continue
    const match = trimmed.match(/^(前置|动作|操作|预期|判定|来源)\s*[:：]\s*(.*)$/)
    if (!match) {
      rest.push(trimmed)
      continue
    }
    const field = ACCEPTANCE_FIELD_KIND.get(match[1])
    const value = match[2].trim()
    if (field === 'sources') entry.sources.push(value)
    else entry[field] = value
  }
  entry.text = rest.join('；').trim()
  if (entry.text === '') {
    // A legacy entry may consist of labelled fields only; keep a readable
    // summary instead of duplicating the raw labels into `text`.
    entry.text = (entry.judgement || entry.expected || entry.action || entry.precondition || '').trim()
  }
  return entry
}

function parseFeatureSection(lines, unparsed, warnings) {
  const features = []
  let current = null
  let field = null
  for (const raw of asArray(lines)) {
    const line = String(raw)
    const heading = line.match(FEATURE_HEADING_RE)
    if (heading) {
      current = {
        id: heading[1].toUpperCase(),
        title: heading[2].trim(),
        behavior: '',
        preconditions: [],
        response: '',
        boundaries: [],
        sources: [],
        provenance: 'user-stated',
      }
      features.push(current)
      field = null
      continue
    }
    if (line.trim() === '') continue
    if (current === null) {
      pushUnparsed(unparsed, warnings, '详细功能', [line])
      continue
    }
    const bullet = line.match(FEATURE_BULLET_RE)
    if (bullet) {
      const kind = FEATURE_FIELD_KIND.get(bullet[1])
      const value = bullet[2].trim()
      field = kind
      if (kind === 'behavior' || kind === 'response') {
        current[kind] = value
      } else if (value !== '') {
        current[kind].push(value)
      }
      continue
    }
    if (field === null) {
      pushUnparsed(unparsed, warnings, current.id, [line])
      continue
    }
    if (field === 'behavior' || field === 'response') {
      current[field] = current[field] === '' ? line.trim() : `${current[field]}\n${line.trim()}`
    } else {
      const values = current[field]
      if (values.length === 0) values.push(line.trim())
      else values[values.length - 1] = `${values[values.length - 1]}\n${line.trim()}`
    }
  }
  return features
}

function parseAcceptanceSection(lines, unparsed, warnings) {
  const entries = []
  let current = null
  let lastField = null
  for (const raw of asArray(lines)) {
    const line = String(raw)
    if (line.trim() === '') continue
    const heading = line.match(ACCEPTANCE_HEADING_RE)
    if (heading) {
      current = {
        id: heading[1].toUpperCase(),
        featureIds: splitFeatureIds(heading[2]),
        text: heading[3].trim(),
        precondition: '',
        action: '',
        expected: '',
        judgement: '',
        sources: [],
        provenance: 'user-stated',
      }
      entries.push(current)
      lastField = null
      continue
    }
    const field = line.match(ACCEPTANCE_FIELD_RE)
    if (field) {
      if (current === null) {
        pushUnparsed(unparsed, warnings, '验收要求', [line])
        continue
      }
      const kind = ACCEPTANCE_FIELD_KIND.get(field[1])
      const value = field[2].trim()
      if (kind === 'sources') {
        current.sources.push(value)
        lastField = 'sources'
      } else {
        current[kind] = value
        lastField = kind
      }
      continue
    }
    const numbered = line.match(NUMBERED_RE)
    const bullet = line.match(BULLET_RE)
    if (numbered || bullet) {
      const text = (numbered ? numbered[2] : bullet[1]).trim()
      if (text === '') continue
      current = legacyAcceptanceEntry(text)
      entries.push(current)
      lastField = null
      continue
    }
    if (current === null) {
      pushUnparsed(unparsed, warnings, '验收要求', [line])
      continue
    }
    const continuation = line.trim()
    if (lastField === 'sources') {
      current.sources.push(continuation)
    } else if (lastField && lastField !== 'sources') {
      current[lastField] = current[lastField] === '' ? continuation : `${current[lastField]}\n${continuation}`
    } else {
      current.text = current.text === '' ? continuation : `${current.text}\n${continuation}`
    }
  }
  return entries
}

function parsePendingSection(lines, unparsed, warnings) {
  const pending = []
  let current = null
  for (const raw of asArray(lines)) {
    const line = String(raw)
    if (line.trim() === '') {
      current = null
      continue
    }
    const checkbox = line.match(PENDING_LINE_RE)
    let text = ''
    let status = 'open'
    if (checkbox) {
      status = checkbox[1].toLowerCase() === 'x' ? 'done' : 'open'
      text = checkbox[2].trim()
    } else {
      const bullet = line.match(BULLET_RE)
      const numbered = line.match(NUMBERED_RE)
      if (bullet) text = bullet[1].trim()
      else if (numbered) text = numbered[2].trim()
      else if (current !== null) {
        current.text = `${current.text}\n${line.trim()}`.trim()
        continue
      } else {
        pushUnparsed(unparsed, warnings, '待确认', [line])
        continue
      }
    }
    const idMatch = text.match(/^(Q-\d{2,})\s*(.*)$/)
    current = {
      id: idMatch ? idMatch[1].toUpperCase() : null,
      text: idMatch ? idMatch[2].trim() : text,
      status,
    }
    pending.push(current)
  }
  return pending
}

function assignAcceptanceIds(entries) {
  const seen = new Set()
  let counter = maxIdNumber(entries, 'AC')
  for (const entry of entries) {
    if (entry.id && AC_ID_RE.test(entry.id) && !seen.has(entry.id)) {
      seen.add(entry.id)
      continue
    }
    entry.id = null
  }
  for (const entry of entries) {
    if (entry.id) continue
    counter += 1
    while (seen.has(`AC-${pad2(counter)}`)) counter += 1
    entry.id = `AC-${pad2(counter)}`
    seen.add(entry.id)
  }
  return entries
}

function mergeText(current, incoming) {
  const next = trimText(incoming)
  if (next === '') return current
  if (current === '') return next
  if (current === next) return current
  if (current.includes(next)) return current
  if (next.includes(current)) return next
  return `${current}\n\n${next}`
}

/**
 * Parse canonical or legacy Markdown into a structured doc projection.
 *
 * Contract: only `FR-\\d{2,}` / `AC-\\d{2,}` headings identify clauses. Legacy
 * alias headings and bold labels are mapped onto canonical sections, unknown
 * sections are preserved verbatim in `unparsed`, and nothing is silently
 * rewritten or pushed into 背景.
 */
export function parseDoc(markdown) {
  const warnings = []
  const unparsed = []
  const doc = emptyDoc()
  const source = String(markdown ?? '').replace(/\r\n?/g, '\n')

  let meta = {}
  const lines = []
  for (const line of source.split('\n')) {
    if (isMetaLine(line)) {
      const parsed = parseMetaLine(line, warnings)
      if (parsed) meta = { ...meta, ...parsed }
      continue
    }
    lines.push(line)
  }

  const legacyState = { usedAlias: false, usedBold: false, missingTitle: false }
  let cursor = 0
  while (cursor < lines.length && lines[cursor].trim() === '') cursor += 1
  if (cursor < lines.length) {
    const titleLine = lines[cursor]
    const heading = titleLine.match(/^#\s+(.+)$/)
    if (heading) {
      const text = heading[1].trim()
      const match = text.match(/^([A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)+)\s+(.*)$/)
      if (match) {
        doc.requirementId = match[1]
        doc.title = match[2].trim()
      } else {
        doc.title = text
        legacyState.missingTitle = true
      }
      cursor += 1
    } else {
      legacyState.missingTitle = true
    }
  } else {
    legacyState.missingTitle = true
  }
  const body = lines.slice(cursor)

  const sections = []
  let currentSection = { heading: null, lines: [] }
  for (const line of body) {
    const heading = line.match(/^##\s+(.+?)\s*$/)
    if (heading) {
      sections.push(currentSection)
      currentSection = { heading: heading[1], lines: [] }
    } else {
      currentSection.lines.push(line)
    }
  }
  sections.push(currentSection)

  const applySegment = (kind, segmentLines) => {
    if (kind === 'goal') {
      doc.goal = mergeText(doc.goal, segmentLines.join('\n'))
      return
    }
    if (kind === 'problem') {
      doc.problem = mergeText(doc.problem, segmentLines.join('\n'))
      return
    }
    if (kind === 'scope' || kind === 'outOfScope' || kind === 'constraints') {
      for (const entry of extractListItems(segmentLines)) doc[kind].push(entry)
      return
    }
    if (kind === 'pending') {
      doc.pending.push(...parsePendingSection(segmentLines, unparsed, warnings))
      return
    }
    if (kind === 'features') {
      doc.features.push(...parseFeatureSection(segmentLines, unparsed, warnings))
      return
    }
    if (kind === 'acceptance') {
      doc.acceptance.push(...parseAcceptanceSection(segmentLines, unparsed, warnings))
    }
  }

  for (const section of sections) {
    const sectionKind = section.heading === null ? null : (HEADING_KIND.get(section.heading) ?? null)
    if (section.heading !== null && sectionKind === null) {
      pushUnparsed(unparsed, warnings, section.heading, section.lines)
      continue
    }
    if (section.heading !== null && HEADING_ALIASES.has(section.heading)) legacyState.usedAlias = true

    // Old candidateMarkdown puts several semantic blocks (bold labels) inside a
    // single heading section (usually 背景). Split them and map each to its own
    // canonical section.
    const segments = []
    let active = { kind: sectionKind, lines: [] }
    for (const line of section.lines) {
      const bold = line.match(BOLD_LABEL_RE)
      if (bold) {
        segments.push(active)
        legacyState.usedBold = true
        const kind = HEADING_KIND.get(bold[1]) ?? null
        active = { kind, lines: bold[2].trim() === '' ? [] : [bold[2]] }
      } else {
        active.lines.push(line)
      }
    }
    segments.push(active)

    for (const segment of segments) {
      const hasContent = segment.lines.some((line) => String(line).trim() !== '')
      if (!hasContent) continue
      if (segment.kind === null) {
        pushUnparsed(unparsed, warnings, section.heading, segment.lines)
        continue
      }
      applySegment(segment.kind, segment.lines)
    }
  }

  const features = doc.features
  const acceptance = assignAcceptanceIds(doc.acceptance)

  const nextFr = Math.max(intOr(meta.nextFr, 1), maxIdNumber(features, 'FR') + 1)
  const nextAc = Math.max(intOr(meta.nextAc, 1), maxIdNumber(acceptance, 'AC') + 1)
  const confirmedAt = typeof meta.confirmedAt === 'string' && !Number.isNaN(Date.parse(meta.confirmedAt)) ? meta.confirmedAt : null

  doc.features = features
  doc.acceptance = acceptance
  doc.pending = doc.pending.filter((entry) => trimText(entry.text) !== '')
  doc.scope = doc.scope.filter((entry) => entry !== '')
  doc.outOfScope = doc.outOfScope.filter((entry) => entry !== '')
  doc.constraints = doc.constraints.filter((entry) => entry !== '')
  doc.meta = { nextFr, nextAc, confirmedAt }
  doc.docHash = docHashOf(markdown)

  const hasCanonicalContent =
    doc.goal !== '' ||
    doc.problem !== '' ||
    doc.features.length > 0 ||
    doc.scope.length > 0 ||
    doc.outOfScope.length > 0 ||
    doc.acceptance.length > 0 ||
    doc.constraints.length > 0 ||
    doc.pending.length > 0
  const hasCanonicalHeading = sections.some((section) => section.heading !== null && CANONICAL_HEADINGS.has(section.heading))
  const legacy =
    legacyState.usedAlias ||
    legacyState.usedBold ||
    legacyState.missingTitle ||
    unparsed.length > 0 ||
    !hasCanonicalContent ||
    !hasCanonicalHeading
  if (legacyState.usedAlias) warnings.push('章节标题使用了旧格式别名，已按规范语义解析（legacy）')
  if (legacyState.usedBold) warnings.push('检测到旧加粗标签，已映射到规范章节（legacy）')
  if (legacyState.missingTitle) warnings.push('缺少 `# <ID> <标题>` 标题，无法识别需求 ID（legacy）')

  return { doc, legacy, unparsed, warnings }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderMultilineBullet(label, value) {
  const parts = String(value ?? '').split('\n')
  const first = `- ${label}：${parts[0] ?? ''}`.trimEnd()
  const rest = parts.slice(1).map((part) => `  ${part}`)
  return [first, ...rest].join('\n')
}

function renderListEntry(value) {
  const parts = String(value ?? '').split('\n')
  return [`- ${parts[0] ?? ''}`.trimEnd(), ...parts.slice(1).map((part) => `  ${part}`)].join('\n')
}

/**
 * Render a doc into canonical Markdown, including the single-line `alm:meta`
 * comment. Empty sections are omitted; `## 详细功能` disappears when there are
 * no features.
 */
export function renderDoc(doc) {
  const source = isPlainObject(doc) ? doc : {}
  const lines = []
  const titleParts = [trimText(source.requirementId), trimText(source.title)].filter((entry) => entry !== '')
  lines.push(`# ${titleParts.join(' ')}`.trim())

  const pushSection = (heading, bodyLines) => {
    const body = asArray(bodyLines).filter((line) => String(line).trim() !== '')
    if (body.length === 0) return
    lines.push('', `## ${heading}`, ...body)
  }

  const goal = trimText(source.goal)
  if (goal !== '') pushSection(SECTION_TITLES.goal, goal.split('\n'))

  const problem = trimText(source.problem)
  if (problem !== '') pushSection(SECTION_TITLES.problem, problem.split('\n'))

  const features = asArray(source.features)
  if (features.length > 0) {
    lines.push('', `## ${SECTION_TITLES.features}`)
    features.forEach((feature, index) => {
      const id = trimText(feature?.id)
      const title = trimText(feature?.title)
      if (index > 0) lines.push('')
      lines.push(`### ${[id, title].filter(Boolean).join(' ')}`.trim())
      const behavior = trimText(feature?.behavior)
      if (behavior !== '') lines.push(renderMultilineBullet('行为', behavior))
      for (const entry of cleanStringList(feature?.preconditions)) lines.push(renderMultilineBullet('前置', entry))
      const response = trimText(feature?.response)
      if (response !== '') lines.push(renderMultilineBullet('响应', response))
      for (const entry of cleanStringList(feature?.boundaries)) lines.push(renderMultilineBullet('边界', entry))
      for (const entry of cleanStringList(feature?.sources)) lines.push(renderMultilineBullet('来源', entry))
    })
  }

  const scope = cleanStringList(source.scope)
  if (scope.length > 0) pushSection(SECTION_TITLES.scope, scope.map(renderListEntry))

  const outOfScope = cleanStringList(source.outOfScope)
  if (outOfScope.length > 0) pushSection(SECTION_TITLES.outOfScope, outOfScope.map(renderListEntry))

  const acceptance = asArray(source.acceptance)
  if (acceptance.length > 0) {
    lines.push('', `## ${SECTION_TITLES.acceptance}`)
    for (const entry of acceptance) {
      const id = trimText(entry?.id)
      const featureIds = asArray(entry?.featureIds).map((value) => trimText(value)).filter((value) => FR_ID_RE.test(value))
      const target = featureIds.length > 0 ? `（${featureIds.join('、')}）` : ''
      lines.push(`- ${id}${target}${trimText(entry?.text)}`)
      for (const [label, kind] of [
        ['前置', 'precondition'],
        ['动作', 'action'],
        ['预期', 'expected'],
        ['判定', 'judgement'],
      ]) {
        const value = trimText(entry?.[kind])
        if (value !== '') lines.push(renderMultilineBullet(label, value).replace(/^- /, '  - '))
      }
      for (const value of cleanStringList(entry?.sources)) {
        lines.push(renderMultilineBullet('来源', value).replace(/^- /, '  - '))
      }
    }
  }

  const constraints = cleanStringList(source.constraints)
  if (constraints.length > 0) pushSection(SECTION_TITLES.constraints, constraints.map(renderListEntry))

  const pending = asArray(source.pending)
  if (pending.length > 0) {
    const pendingLines = []
    for (const entry of pending) {
      const id = trimText(entry?.id)
      const text = trimText(entry?.text)
      if (text === '') continue
      const box = entry?.status === 'done' ? 'x' : ' '
      const head = `- [${box}] ${[id, text].filter(Boolean).join(' ')}`
      const parts = head.split('\n')
      pendingLines.push(parts[0], ...parts.slice(1).map((part) => `  ${part}`))
    }
    pushSection(SECTION_TITLES.pending, pendingLines)
  }

  const body = lines.join('\n')
  const docHash = docHashOf(body)
  const meta = {
    nextFr: intOr(source.meta?.nextFr, Math.max(maxIdNumber(features, 'FR') + 1, 1)),
    nextAc: intOr(source.meta?.nextAc, Math.max(maxIdNumber(acceptance, 'AC') + 1, 1)),
    confirmedAt: typeof source.meta?.confirmedAt === 'string' ? source.meta.confirmedAt : null,
    docHash,
  }
  return `${body}\n\n<!-- alm:meta ${JSON.stringify(meta)} -->\n`
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

function normalizeFeature(entry) {
  if (!isPlainObject(entry)) return null
  return {
    id: FR_ID_RE.test(trimText(entry.id).toUpperCase()) ? trimText(entry.id).toUpperCase() : null,
    title: trimText(entry.title),
    behavior: trimText(entry.behavior),
    preconditions: cleanStringList(entry.preconditions),
    response: trimText(entry.response),
    boundaries: cleanStringList(entry.boundaries),
    sources: cleanStringList(entry.sources),
    provenance: normalizeProvenance(entry.provenance),
  }
}

function normalizeAcceptanceEntry(entry) {
  if (!isPlainObject(entry)) return null
  return {
    id: AC_ID_RE.test(trimText(entry.id).toUpperCase()) ? trimText(entry.id).toUpperCase() : null,
    featureIds: cleanStringList(entry.featureIds)
      .map((value) => value.toUpperCase())
      .filter((value) => FR_ID_RE.test(value)),
    text: trimText(entry.text),
    precondition: trimText(entry.precondition),
    action: trimText(entry.action),
    expected: trimText(entry.expected),
    judgement: trimText(entry.judgement),
    sources: cleanStringList(entry.sources),
    provenance: normalizeProvenance(entry.provenance),
  }
}

function normalizePendingEntry(entry) {
  if (typeof entry === 'string') {
    return { id: null, text: trimText(entry), status: 'open' }
  }
  if (!isPlainObject(entry)) return null
  return {
    id: PENDING_ID_RE.test(trimText(entry.id).toUpperCase()) ? trimText(entry.id).toUpperCase() : null,
    text: trimText(entry.text),
    status: PENDING_STATUSES.includes(entry.status) ? entry.status : 'open',
  }
}

function featureHasContent(feature) {
  return (
    feature.title !== '' ||
    feature.behavior !== '' ||
    feature.response !== '' ||
    feature.preconditions.length > 0 ||
    feature.boundaries.length > 0 ||
    feature.sources.length > 0
  )
}

function acceptanceHasContent(entry) {
  return (
    entry.text !== '' ||
    entry.action !== '' ||
    entry.expected !== '' ||
    entry.judgement !== '' ||
    entry.precondition !== '' ||
    entry.sources.length > 0
  )
}

function featureBasis(feature) {
  return [feature.id, feature.title, feature.behavior, feature.response, ...feature.boundaries].join(' ')
}

function acceptanceBasis(entry) {
  return [entry.id, entry.text, entry.judgement, entry.action, entry.expected].join(' ')
}

function normalizeForSimilarity(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[\s"'`“”‘’（）()【】[\]{}<>《》,，。;；:：!！?？、|/\\_-]+/g, '')
}

/** Character-bigram Dice similarity in [0, 1]; used for ID re-matching. */
export function textSimilarity(a, b) {
  const x = normalizeForSimilarity(a)
  const y = normalizeForSimilarity(b)
  if (x === '' || y === '') return x === y ? 1 : 0
  if (x === y) return 1
  if (x.length < 2 || y.length < 2) return 0
  const bigrams = new Map()
  for (let index = 0; index < x.length - 1; index += 1) {
    const gram = x.slice(index, index + 2)
    bigrams.set(gram, (bigrams.get(gram) ?? 0) + 1)
  }
  let common = 0
  for (let index = 0; index < y.length - 1; index += 1) {
    const gram = y.slice(index, index + 2)
    const count = bigrams.get(gram) ?? 0
    if (count > 0) {
      bigrams.set(gram, count - 1)
      common += 1
    }
  }
  return (2 * common) / (x.length - 1 + (y.length - 1))
}

function matchPreviousIds(items, previousItems, prefix, startNumber) {
  const prevItems = asArray(previousItems)
  const prevById = new Map(prevItems.filter((entry) => entry && entry.id).map((entry) => [entry.id, entry]))
  const usedPrev = new Set()
  const idMap = new Map()

  // 1) Same ID wins.
  for (const item of items) {
    const rawId = item.id
    if (!rawId) continue
    if (!prevById.has(rawId) || usedPrev.has(rawId)) continue
    usedPrev.add(rawId)
    idMap.set(rawId, rawId)
  }
  // 2) An explicit, unused ID from the incoming document is kept as a new clause.
  const claimed = new Set(items.filter((item) => item.id && !idMap.has(item.id)).map((item) => item.id))
  // 3) Text similarity >= 0.6 re-attaches IDs for clauses that arrived without one.
  for (const item of items) {
    if (item.id) continue
    let best = null
    for (const prev of prevItems) {
      if (!prev || !prev.id || usedPrev.has(prev.id)) continue
      const score = textSimilarity(prefix === 'FR' ? featureBasis(item) : acceptanceBasis(item), prefix === 'FR' ? featureBasis(prev) : acceptanceBasis(prev))
      if (score >= 0.6 && (best === null || score > best.score)) best = { id: prev.id, score }
    }
    if (best) {
      item.id = best.id
      usedPrev.add(best.id)
    }
  }
  const used = new Set(items.map((item) => item.id).filter(Boolean))
  let next = Math.max(
    startNumber,
    maxIdNumber(items, prefix) + 1,
    maxIdNumber(prevItems, prefix) + 1,
    1,
  )
  for (const item of items) {
    if (item.id && !used.has(item.id)) {
      used.add(item.id)
      continue
    }
    if (item.id) {
      const duplicate = items.filter((entry) => entry.id === item.id).length > 1
      if (!duplicate) continue
      item.id = null
    }
    while (used.has(`${prefix}-${pad2(next)}`)) next += 1
    item.id = `${prefix}-${pad2(next)}`
    next += 1
    used.add(item.id)
  }
  next = Math.max(next, maxIdNumber(items, prefix) + 1)
  return { nextNumber: next, idMap, claimed }
}

/**
 * Normalize a doc: assign stable IDs (same ID → similarity ≥ 0.6 → new),
 * enforce provenance (AI/unconfirmed clauses go to `pending`), keep half
 * acceptance entries as explicit pending questions, and compute the doc hash.
 */
export function normalizeDoc(doc, { previous = null } = {}) {
  const source = isPlainObject(doc) ? clone(doc) : {}
  const prev = isPlainObject(previous) ? previous : null
  const out = emptyDoc()

  out.schema = DOC_SCHEMA
  const requirementId = trimText(source.requirementId)
  out.requirementId = REQUIREMENT_ID_RE.test(requirementId) ? requirementId : null
  out.title = trimText(source.title)
  out.revision = Number.isInteger(source.revision) && source.revision >= 1 ? source.revision : null
  out.goal = trimText(source.goal)
  out.problem = trimText(source.problem)
  out.scope = cleanStringList(source.scope)
  out.outOfScope = cleanStringList(source.outOfScope)
  out.constraints = cleanStringList(source.constraints)

  const pending = asArray(source.pending).map(normalizePendingEntry).filter(Boolean)

  const features = []
  for (const raw of asArray(source.features)) {
    const feature = normalizeFeature(raw)
    if (!feature || !featureHasContent(feature)) continue
    if (AI_PROVENANCE.has(feature.provenance)) {
      pending.push({
        id: null,
        text: `[功能建议·${feature.provenance === 'unconfirmed' ? '未确认' : 'AI 建议'}] ${[feature.title, feature.behavior].filter(Boolean).join('：')}`.trim(),
        status: 'open',
      })
      continue
    }
    if (!FORMAL_PROVENANCE.has(feature.provenance)) continue
    features.push(feature)
  }

  const acceptance = []
  for (const raw of asArray(source.acceptance)) {
    const entry = normalizeAcceptanceEntry(raw)
    if (!entry || !acceptanceHasContent(entry)) continue
    if (AI_PROVENANCE.has(entry.provenance)) {
      pending.push({
        id: null,
        text: `[验收建议·${entry.provenance === 'unconfirmed' ? '未确认' : 'AI 建议'}] ${[entry.id, entry.text].filter(Boolean).join(' ')}`.trim(),
        status: 'open',
      })
      continue
    }
    if (!FORMAL_PROVENANCE.has(entry.provenance)) continue
    const hasAction = entry.action !== ''
    const hasExpected = entry.expected !== ''
    if (hasAction !== hasExpected) {
      pending.push({
        id: null,
        text: `[验收待补] ${entry.id ?? ''} 只有${hasAction ? '动作（action）' : '预期（expected）'}，缺少${hasAction ? '预期（expected）' : '判定动作（action）'}：${entry.text || entry.judgement}`.trim(),
        status: 'open',
      })
      continue
    }
    acceptance.push(entry)
  }

  const featureMatch = matchPreviousIds(
    features,
    prev?.features,
    'FR',
    Math.max(intOr(source.meta?.nextFr, 1), intOr(prev?.meta?.nextFr, 1)),
  )
  for (const entry of acceptance) {
    entry.featureIds = entry.featureIds.map((id) => featureMatch.idMap.get(id) ?? id)
  }
  const acceptanceMatch = matchPreviousIds(
    acceptance,
    prev?.acceptance,
    'AC',
    Math.max(intOr(source.meta?.nextAc, 1), intOr(prev?.meta?.nextAc, 1)),
  )

  let nextPending = 1
  for (const entry of pending) {
    const number = idNumber(entry.id, 'Q')
    if (number !== null && number >= nextPending) nextPending = number + 1
  }
  const usedPending = new Set()
  const seenPendingText = new Set()
  const finalPending = []
  for (const entry of pending) {
    if (!entry || entry.text === '') continue
    if (seenPendingText.has(entry.text)) continue
    seenPendingText.add(entry.text)
    let id = entry.id && PENDING_ID_RE.test(entry.id) && !usedPending.has(entry.id) ? entry.id : null
    if (!id) {
      while (usedPending.has(`Q-${pad2(nextPending)}`)) nextPending += 1
      id = `Q-${pad2(nextPending)}`
      nextPending += 1
    }
    usedPending.add(id)
    finalPending.push({ id, text: entry.text, status: entry.status })
  }

  out.features = features
  out.acceptance = acceptance
  out.pending = finalPending
  out.meta = {
    nextFr: featureMatch.nextNumber,
    nextAc: acceptanceMatch.nextNumber,
    confirmedAt:
      typeof source.meta?.confirmedAt === 'string' && !Number.isNaN(Date.parse(source.meta.confirmedAt))
        ? source.meta.confirmedAt
        : null,
  }
  out.docHash = docHashOf(renderDoc(out))
  return out
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

function docFromInput(value) {
  if (typeof value === 'string') return parseDoc(value).doc
  if (isPlainObject(value)) return value
  return emptyDoc()
}

function hashOfInput(value) {
  if (typeof value === 'string') return docHashOf(value)
  if (isPlainObject(value)) return docHashOf(renderDoc(value))
  return docHashOf('')
}

function scalarDiff(before, after, kind, label, added, removed, modified) {
  const left = trimText(before)
  const right = trimText(after)
  if (left === right) return
  if (left === '') {
    added.push({ kind, id: null, label })
    return
  }
  if (right === '') {
    removed.push({ kind, id: null, label })
    return
  }
  modified.push({ kind, id: null, label })
}

function listDiff(beforeList, afterList, kind, added, removed) {
  const before = cleanStringList(beforeList)
  const after = cleanStringList(afterList)
  for (const entry of after) if (!before.includes(entry)) added.push({ kind, id: null, label: entry })
  for (const entry of before) if (!after.includes(entry)) removed.push({ kind, id: null, label: entry })
}

/**
 * Compare two docs (or Markdown strings). `added` / `removed` / `modified`
 * describe clause changes; `pending` isolates 待确认-item churn so the UI can
 * surface "AI 建议 / 未确认" changes separately.
 */
export function diffDoc(before, after) {
  const left = docFromInput(before)
  const right = docFromInput(after)
  const added = []
  const removed = []
  const modified = []
  const pending = []

  scalarDiff(left.title, right.title, 'title', trimText(right.title), added, removed, modified)
  scalarDiff(left.goal, right.goal, 'goal', trimText(right.goal) || trimText(left.goal), added, removed, modified)
  scalarDiff(left.problem, right.problem, 'problem', trimText(right.problem) || trimText(left.problem), added, removed, modified)
  listDiff(left.scope, right.scope, 'scope', added, removed)
  listDiff(left.outOfScope, right.outOfScope, 'outOfScope', added, removed)
  listDiff(left.constraints, right.constraints, 'constraint', added, removed)

  const rightFeatures = new Map(asArray(right.features).filter((entry) => entry && entry.id).map((entry) => [entry.id, entry]))
  const leftFeatures = new Map(asArray(left.features).filter((entry) => entry && entry.id).map((entry) => [entry.id, entry]))
  for (const [id, entry] of rightFeatures) {
    const previous = leftFeatures.get(id)
    if (!previous) {
      added.push({ kind: 'feature', id, label: trimText(entry.title) })
      continue
    }
    if (JSON.stringify(featureBasis(previous)) !== JSON.stringify(featureBasis(entry))) {
      modified.push({ kind: 'feature', id, label: trimText(entry.title) || trimText(previous.title) })
    }
  }
  for (const [id, entry] of leftFeatures) {
    if (!rightFeatures.has(id)) removed.push({ kind: 'feature', id, label: trimText(entry.title) })
  }

  const rightAcceptance = new Map(asArray(right.acceptance).filter((entry) => entry && entry.id).map((entry) => [entry.id, entry]))
  const leftAcceptance = new Map(asArray(left.acceptance).filter((entry) => entry && entry.id).map((entry) => [entry.id, entry]))
  for (const [id, entry] of rightAcceptance) {
    const previous = leftAcceptance.get(id)
    if (!previous) {
      added.push({ kind: 'acceptance', id, label: trimText(entry.text) })
      continue
    }
    if (JSON.stringify(acceptanceBasis(previous)) !== JSON.stringify(acceptanceBasis(entry))) {
      modified.push({ kind: 'acceptance', id, label: trimText(entry.text) || trimText(previous.text) })
    }
  }
  for (const [id, entry] of leftAcceptance) {
    if (!rightAcceptance.has(id)) removed.push({ kind: 'acceptance', id, label: trimText(entry.text) })
  }

  const rightPending = asArray(right.pending).filter((entry) => entry && trimText(entry.text) !== '')
  const leftPending = asArray(left.pending).filter((entry) => entry && trimText(entry.text) !== '')
  const leftPendingText = new Set(leftPending.map((entry) => trimText(entry.text)))
  const rightPendingText = new Set(rightPending.map((entry) => trimText(entry.text)))
  for (const entry of rightPending) {
    const text = trimText(entry.text)
    if (!leftPendingText.has(text)) pending.push({ kind: 'pending', id: trimText(entry.id) || null, label: text, change: 'added' })
  }
  for (const entry of leftPending) {
    const text = trimText(entry.text)
    if (!rightPendingText.has(text)) pending.push({ kind: 'pending', id: trimText(entry.id) || null, label: text, change: 'removed' })
  }

  return {
    added,
    removed,
    modified,
    pending,
    docHashChanged: hashOfInput(before) !== hashOfInput(after),
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Structural validation only — sections are never required to be non-empty.
 * Returns `{ ok, errors }` where each error carries a `path` and `message`.
 */
export function validateDoc(doc) {
  const errors = []
  const fail = (path, message) => errors.push({ path, message })

  if (!isPlainObject(doc)) {
    return { ok: false, errors: [{ path: '', message: 'doc 必须是对象' }] }
  }
  if (doc.schema !== DOC_SCHEMA) fail('schema', `schema 必须是 ${DOC_SCHEMA}`)
  if (doc.requirementId !== null && doc.requirementId !== undefined && !REQUIREMENT_ID_RE.test(String(doc.requirementId))) {
    fail('requirementId', 'requirementId 必须是形如 REQ-ALM-001 的 ID 或 null')
  }
  if (doc.revision !== null && doc.revision !== undefined && !(Number.isInteger(doc.revision) && doc.revision >= 1)) {
    fail('revision', 'revision 必须是 >=1 的整数或 null')
  }
  if (typeof doc.docHash !== 'string' || !SHA256_RE.test(doc.docHash)) fail('docHash', 'docHash 必须是 sha256:<64 hex>')
  if (typeof doc.title !== 'string') fail('title', 'title 必须是字符串')
  if (typeof doc.goal !== 'string') fail('goal', 'goal 必须是字符串')
  if (typeof doc.problem !== 'string') fail('problem', 'problem 必须是字符串')

  const featureIds = new Set()
  if (!Array.isArray(doc.features)) fail('features', 'features 必须是数组')
  else {
    doc.features.forEach((feature, index) => {
      const path = `features[${index}]`
      if (!isPlainObject(feature)) {
        fail(path, 'feature 必须是对象')
        return
      }
      if (!FR_ID_RE.test(String(feature.id ?? ''))) fail(`${path}.id`, 'FR ID 必须是 FR-<两位以上数字>')
      else if (featureIds.has(feature.id)) fail(`${path}.id`, `重复的 FR ID：${feature.id}`)
      else featureIds.add(feature.id)
      if (typeof feature.title !== 'string') fail(`${path}.title`, 'title 必须是字符串')
      if (typeof feature.behavior !== 'string') fail(`${path}.behavior`, 'behavior 必须是字符串')
      if (typeof feature.response !== 'string') fail(`${path}.response`, 'response 必须是字符串')
      for (const key of ['preconditions', 'boundaries', 'sources']) {
        if (!Array.isArray(feature[key])) fail(`${path}.${key}`, `${key} 必须是字符串数组`)
      }
      if (!DOC_PROVENANCES.includes(feature.provenance)) fail(`${path}.provenance`, 'provenance 不合法')
    })
  }

  const acceptanceIds = new Set()
  if (!Array.isArray(doc.acceptance)) fail('acceptance', 'acceptance 必须是数组')
  else {
    doc.acceptance.forEach((entry, index) => {
      const path = `acceptance[${index}]`
      if (!isPlainObject(entry)) {
        fail(path, 'acceptance 条目必须是对象')
        return
      }
      if (!AC_ID_RE.test(String(entry.id ?? ''))) fail(`${path}.id`, 'AC ID 必须是 AC-<两位以上数字>')
      else if (acceptanceIds.has(entry.id)) fail(`${path}.id`, `重复的 AC ID：${entry.id}`)
      else acceptanceIds.add(entry.id)
      if (!Array.isArray(entry.featureIds)) fail(`${path}.featureIds`, 'featureIds 必须是数组')
      else {
        for (const featureId of entry.featureIds) {
          if (!FR_ID_RE.test(String(featureId))) fail(`${path}.featureIds`, `非法的 FR 引用：${featureId}`)
        }
      }
      if (typeof entry.text !== 'string') fail(`${path}.text`, 'text 必须是字符串')
      for (const key of ['precondition', 'action', 'expected', 'judgement']) {
        if (typeof entry[key] !== 'string') fail(`${path}.${key}`, `${key} 必须是字符串`)
      }
      if (!Array.isArray(entry.sources)) fail(`${path}.sources`, 'sources 必须是数组')
      if (!DOC_PROVENANCES.includes(entry.provenance)) fail(`${path}.provenance`, 'provenance 不合法')
    })
  }

  for (const key of ['scope', 'outOfScope', 'constraints']) {
    if (!Array.isArray(doc[key])) fail(key, `${key} 必须是字符串数组`)
  }

  const pendingIds = new Set()
  if (!Array.isArray(doc.pending)) fail('pending', 'pending 必须是数组')
  else {
    doc.pending.forEach((entry, index) => {
      const path = `pending[${index}]`
      if (!isPlainObject(entry)) {
        fail(path, 'pending 条目必须是对象')
        return
      }
      if (!PENDING_ID_RE.test(String(entry.id ?? ''))) fail(`${path}.id`, 'Q ID 必须是 Q-<两位以上数字>')
      else if (pendingIds.has(entry.id)) fail(`${path}.id`, `重复的 Q ID：${entry.id}`)
      else pendingIds.add(entry.id)
      if (typeof entry.text !== 'string' || entry.text.trim() === '') fail(`${path}.text`, 'text 不能为空')
      if (!PENDING_STATUSES.includes(entry.status)) fail(`${path}.status`, 'status 必须是 open / done')
    })
  }

  if (!isPlainObject(doc.meta)) fail('meta', 'meta 必须是对象')
  else {
    if (!(Number.isInteger(doc.meta.nextFr) && doc.meta.nextFr >= 1)) fail('meta.nextFr', 'nextFr 必须是 >=1 的整数')
    if (!(Number.isInteger(doc.meta.nextAc) && doc.meta.nextAc >= 1)) fail('meta.nextAc', 'nextAc 必须是 >=1 的整数')
    if (doc.meta.confirmedAt !== null && (typeof doc.meta.confirmedAt !== 'string' || Number.isNaN(Date.parse(doc.meta.confirmedAt)))) {
      fail('meta.confirmedAt', 'confirmedAt 必须是 ISO 时间字符串或 null')
    }
  }

  return { ok: errors.length === 0, errors }
}
