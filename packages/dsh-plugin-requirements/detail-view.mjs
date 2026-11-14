/**
 * Requirement detail view — one pure, UI-oriented projection of a requirement
 * item for the requirements drawer.
 *
 * `deriveDetailView` never performs IO and never invents data: a missing field
 * becomes `null` / `[]`, and every sentence is built from a field the query
 * layer already produced. The client only renders this projection (the single
 * allowed fallback is `record.relations` when `options.allItems` is omitted).
 *
 * See docs/analysis/requirement-detail-v2-focus-and-action-brief.md and
 * tmp/team/detail-v2-contract.md §2–§4.
 */
import { parseDoc } from '../alm-core/src/requirements/doc.mjs'
import { createHash } from 'node:crypto'
import { githubDeliveryLinks } from './github-web.mjs'

export const DETAIL_VIEW_SCHEMA = 'alm.detail.view/v1'

const BRIEF_SECTION_TITLES = /^(背景|目标|范围|验收|约束|风险|备注|原始诉求|AI|评审|重构|建议|决策)/
const BRIEF_INLINE_TITLES = /^(背景|目标|范围|验收标准|验收|约束|风险|备注|原始诉求|用户诉求)$/
const INLINE_LABEL_RE = /^(背景|目标|范围|验收标准|验收|约束|风险|备注)[:：]\s*(.*)$/
const AI_TITLE_RE = /^AI\s?(评审|建议|评审建议)(\s*[（(].*[)）])?$/

const REL_LABELS = {
  satisfies: '满足',
  allocated_to: '分配到',
  depends_on: '依赖',
  constrained_by: '约束',
  verified_by: '验收',
  supersedes: '替代',
  parent_of: '子需求',
}

const RELATION_GROUPS = ['上级', '子需求', '验收', '依赖', '约束', '分配到']

const CLAIM_TITLES = new Set(['目标', '范围', '场景', '问题', '期望'])
const ACCEPTANCE_TITLES = new Set(['验收', '验收标准', '验收要求'])
const BACKGROUND_TITLES = new Set(['背景', '原始诉求', '用户诉求', '用户原话', '备注'])
const CONSTRAINT_TITLES = new Set(['约束', '风险', '依赖'])
const PROVENANCE_TITLES = new Set(['上下文摘要', '覆盖边界', '反馈来源'])

const STALE_REASON_LABELS = {
  incomplete: '证据记录不完整',
  head: '提交已变化',
  requirement: '需求已变化',
  tests: '关联用例已变化',
}

const ACTION_LABELS = {
  'answer-run': '回答并继续',
  'resume-run': '▶ 从断点恢复推进',
  'run-acceptance': '🧪 验证当前已有改动',
  'watch-run': '查看运行',
  'continue-run': '恢复推进',
  signoff: '✓ 确认签收 (Signoff)',
  release: '🚀 发布交付 (Release)',
  'execute-release': '🚀 发布交付 (Release)',
  'create-candidate': '生成交付候选',
  'narrow-verification': '收窄验收命令并重新验证',
  'start-fix': '🔧 让 AI 自动修复未通过项',
  start: '交给 AI 推进',
}

const ACTION_BY_KIND = {
  answer: 'answer-run',
  'run-interrupted': 'resume-run',
  'run-active': 'watch-run',
  'run-idle-handback': 'continue-run',
  'candidate-pending': 'create-candidate',
  'awaiting-acceptance': 'signoff',
  accepted: 'release',
  'release-authorized': 'execute-release',
  'release-failed': 'execute-release',
  'acceptance-failed': 'start-fix',
  'run-rolled-back': 'start',
  'not-started': 'start',
}

const RUN_REASON_LABELS = {
  'not-authorized': '本轮没有自动续推授权，可继续同一运行。',
  'run-not-active': '本轮已停止，不能继续自动调度。',
  'no-authorized-carrier': '没有可用的原执行会话，已停止自动推进。',
  'facts-unavailable': '无法确认最新验收事实，已停止自动推进；请查看技术信息。',
  'requirement-changed': '需求内容已经变化，旧授权不再适用；请核对新版本。',
  'no-progress': '本轮没有产生新的实现或验收进展，已停止重复执行。',
  'auto-budget-exhausted': '本轮已用完自动推进机会，已停止；请查看结果后选择下一步。',
  'auto-turn-failed': '自动推进执行失败，已停止；可查看失败原因后继续。',
  'settlement-failed': '无法确认本轮执行结果，已停止自动推进。',
  'environment-blocked': '验证环境或前置证据受阻，需刷新证据并重新验证。',
  'verification-timeout': '专项验证超过时间限制，请查看命令输出并重新验证。',
  'verification-command-unavailable': '验证命令无法启动，请检查本机依赖后重新验证。',
  'verification-context-changed': '验收证据已过期，需刷新证据并重新验证。',
  'registered-acceptance-failed': '验证检查未通过，可让 AI 修复后重新验证。',
  'verification-unavailable': '当前无法读取验证结果，请刷新证据后重试。',
}

function humanRunReason(value) {
  return RUN_REASON_LABELS[textOrNull(value)] ?? null
}

// ---------------------------------------------------------------------------
// Small value helpers — null instead of undefined so the projection stays JSON
// round-trippable.
// ---------------------------------------------------------------------------

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function normalizePresentationText(value) {
  return String(value ?? '')
    .replace(/\$\\(?:right)?arrow\$/g, '→')
    .replace(/(^|[^-])\s*->\s*/g, '$1 → ')
}

function frozenSnapshotEnd(text, offset) {
  if (text[offset] !== '{') return -1
  let depth = 0; let quoted = false; let escaped = false
  for (let index = offset; index < text.length; index += 1) {
    const char = text[index]
    if (quoted) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quoted = false
    } else if (char === '"') quoted = true
    else if (char === '{') depth += 1
    else if (char === '}' && --depth === 0) return index + 1
  }
  return -1
}

// Early briefs embedded an internal document snapshot after this marker. It
// is provenance, not a business problem statement, and must not surface in a
// detail card even before the next confirmed convergence rewrites the file.
function cleanBriefForPresentation(value, { keepMeta = false } = {}) {
  let text = normalizePresentationText(value)
  if (!keepMeta) text = text.replace(/^\s*<!--\s*alm:meta\b[\s\S]*?-->\s*$/gim, '')
  const marker = /(?:^|\n)\s*冻结澄清正文\s*[:：]\s*/im.exec(text)
  if (!marker) return text
  const start = marker.index + marker[0].length
  const first = text.slice(start).search(/\S/)
  const end = first < 0 ? -1 : frozenSnapshotEnd(text, start + first)
  if (end < 0) return text.slice(0, marker.index).trim()
  const prefix = text.slice(0, marker.index).trimEnd()
  const tail = text.slice(end).replace(/^\s*人工补充验收\s*[:：]\s*\[\s*\]\s*/im, '')
  return (tail.trim() ? `${prefix}\n\n${tail.trimStart()}` : prefix).replace(/\n{3,}/g, '\n\n').trim()
}

function textOrNull(value) {
  return typeof value === 'string' ? normalizePresentationText(value) : null
}

function nonEmptyText(value) {
  return typeof value === 'string' && value.trim() ? value : null
}

function intOrNull(value) {
  return Number.isInteger(value) ? value : null
}

function boolOrNull(value) {
  return typeof value === 'boolean' ? value : null
}

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function parseTime(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

// ---------------------------------------------------------------------------
// §4 body parsing — mirrors client.js briefSections/peelInlineLabels so the
// server projection and the legacy client render the same sections.
// ---------------------------------------------------------------------------

function peelInlineLabels(text, title) {
  const out = []
  String(text ?? '')
    .split(/\r?\n/)
    .forEach((line) => {
      const trimmed = line.trim()
      const match = INLINE_LABEL_RE.exec(trimmed)
      if (!match) {
        out.push(line)
        return
      }
      if (match[1] === title) {
        if (match[2]) out.push(match[2])
        return
      }
      out.push(`**${match[1]}**`)
      if (match[2]) out.push(match[2])
    })
  return out.join('\n').trim()
}

function rawBriefSections(text) {
  const lines = cleanBriefForPresentation(text).split(/\r?\n/)
  const sections = []
  let current = null
  const startSection = (title) => {
    current = { title, body: [] }
    sections.push(current)
  }
  lines.forEach((line) => {
    const trimmed = line.trim()
    const heading = /^##\s+(.+)$/.exec(trimmed)
    if (heading) {
      startSection(heading[1].trim())
      return
    }
    if (/^#\s+/.test(trimmed)) return
    // briefText is persisted flattened: a standalone label line starts a section.
    if (BRIEF_INLINE_TITLES.test(trimmed)) {
      startSection(trimmed)
      return
    }
    if (!current) {
      if (!trimmed) return
      startSection('原始诉求')
    }
    current.body.push(line)
  })
  return sections
    .map((section) => ({ title: section.title, text: peelInlineLabels(section.body.join('\n'), section.title) }))
    .filter((section) => section.text || BRIEF_SECTION_TITLES.test(section.title))
}

function sectionKind(title, aiStored) {
  if (ACCEPTANCE_TITLES.has(title)) return 'acceptance'
  if (CLAIM_TITLES.has(title)) return 'claim'
  if (BACKGROUND_TITLES.has(title)) return 'background'
  if (CONSTRAINT_TITLES.has(title)) return 'constraint'
  if (PROVENANCE_TITLES.has(title)) return 'provenance'
  // Only metadata decides whether a section is an AI suggestion. A user heading
  // such as「重构范围」or「重构建议」must stay authored content.
  if (aiStored && AI_TITLE_RE.test(title)) return 'ai-suggestion'
  return 'other'
}

/**
 * Split a brief body into typed sections.
 *
 * @param {string|null|undefined} briefText
 * @param {{ aiStored?: boolean }} [options] `aiStored` comes from
 *   `item.aiReview.stored`; only then is an AI section recognised.
 * @returns {Array<{id: string, title: string, kind: string, text: string, sameAs: string|null}>}
 */
export function parseBodySections(briefText, options = {}) {
  const aiStored = options?.aiStored === true
  const sections = rawBriefSections(briefText).map((section, index) => ({
    id: `sec-${index + 1}`,
    title: section.title,
    kind: sectionKind(section.title, aiStored),
    text: section.text,
    sameAs: null,
  }))
  // Old dedupe compared prefixes and hid paragraphs that started the same but
  // added a restriction. Only a fully equal normalised body is a duplicate, and
  // the text is never dropped. Feedback can repeat the goal as user words after
  // intervening sections, so compare against all earlier complete bodies.
  const firstTitleByText = new Map()
  for (const section of sections) {
    const text = normalizeText(section.text)
    if (!text) continue
    if (firstTitleByText.has(text)) section.sameAs = firstTitleByText.get(text)
    else firstTitleByText.set(text, section.title)
  }
  return sections
}

function missingSections(sections) {
  const missing = []
  const hasClaim = (title) =>
    sections.some((section) => section.kind === 'claim' && section.title === title && nonEmptyText(section.text))
  if (!hasClaim('目标')) missing.push('目标')
  if (!hasClaim('范围')) missing.push('范围')
  // A linked test case is not an acceptance statement: verifiedBy never stands
  // in for authored 验收要求.
  if (!sections.some((section) => section.kind === 'acceptance' && nonEmptyText(section.text))) missing.push('验收要求')
  return missing
}

/**
 * The structured document comes from the query layer (`item.docView`, parsed
 * once by the doc module). A caller that only has `briefText` still gets a
 * parse here so the projection stays useful in tests and older payloads.
 */
function resolveDocView(source) {
  const provided = source?.docView
  // A persisted projection can pre-date cleanup. Reparse the brief whenever
  // it contains an old frozen snapshot so every consumer sees the same clean
  // business document.
  if (nonEmptyText(source?.briefText) && /冻结澄清正文|<!--\s*alm:meta\b/i.test(source.briefText)) return parseDoc(cleanBriefForPresentation(source.briefText, { keepMeta: true }))
  if (provided && typeof provided === 'object' && provided.doc && typeof provided.doc === 'object') return provided
  if (nonEmptyText(source?.briefText)) return parseDoc(cleanBriefForPresentation(source.briefText, { keepMeta: true }))
  return null
}

function docContentFor(docView) {
  if (!docView) return null
  const doc = docView.doc ?? {}
  const features = asArray(doc.features).map((feature) => ({
    id: textOrNull(feature?.id),
    title: textOrNull(feature?.title),
    behavior: textOrNull(feature?.behavior),
    preconditions: asArray(feature?.preconditions).filter((entry) => typeof entry === 'string'),
    response: textOrNull(feature?.response),
    boundaries: asArray(feature?.boundaries).filter((entry) => typeof entry === 'string'),
    sources: asArray(feature?.sources).filter((entry) => typeof entry === 'string'),
    provenance: textOrNull(feature?.provenance),
  }))
  const acceptance = asArray(doc.acceptance).map((entry) => ({
    id: textOrNull(entry?.id),
    featureIds: asArray(entry?.featureIds).filter((id) => typeof id === 'string'),
    text: textOrNull(entry?.text),
    precondition: textOrNull(entry?.precondition),
    action: textOrNull(entry?.action),
    expected: textOrNull(entry?.expected),
    judgement: textOrNull(entry?.judgement),
    sources: asArray(entry?.sources).filter((id) => typeof id === 'string'),
    provenance: textOrNull(entry?.provenance),
  }))
  const pending = asArray(doc.pending).map((entry) => ({
    id: textOrNull(entry?.id),
    text: textOrNull(entry?.text),
    status: textOrNull(entry?.status),
  }))
  return {
    status:
      docView.legacy === true
        ? 'legacy'
        : nonEmptyText(doc?.meta?.confirmedAt)
          ? 'canonical'
          : 'unconfirmed',
    goal: textOrNull(doc.goal),
    problem: textOrNull(doc.problem),
    scope: asArray(doc.scope).filter((entry) => typeof entry === 'string'),
    outOfScope: asArray(doc.outOfScope).filter((entry) => typeof entry === 'string'),
    features,
    acceptance,
    constraints: asArray(doc.constraints).filter((entry) => typeof entry === 'string'),
    pending,
    unparsed: asArray(docView.unparsed).map((entry) => ({
      title: textOrNull(entry?.title),
      text: textOrNull(entry?.text),
    })),
  }
}

function missingSectionsFromDoc(docView) {
  const doc = docView?.doc ?? null
  if (!doc) return null
  const missing = []
  if (!nonEmptyText(doc.goal)) missing.push('目标')
  if (!nonEmptyText(doc.problem)) missing.push('问题与场景')
  if (!asArray(doc.scope).some((entry) => nonEmptyText(entry))) missing.push('本次范围')
  // A linked test case never stands in for an authored acceptance statement.
  if (!asArray(doc.acceptance).some((entry) => nonEmptyText(entry?.text))) missing.push('验收要求')
  return missing
}

// ---------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------

function summarizeDelivery(item) {
  const delivery = item?.delivery && typeof item.delivery === 'object' ? item.delivery : {}
  return {
    key: textOrNull(delivery.key),
    label: textOrNull(delivery.label),
    reason: textOrNull(delivery.reason),
    source: textOrNull(delivery.source),
    runId: textOrNull(delivery.runId),
    runStatus: textOrNull(delivery.runStatus),
  }
}

function summarizeRun(item) {
  const run = item?.run && typeof item.run === 'object' ? item.run : {}
  const exists = run.exists === true
  const failure = run.failure && typeof run.failure === 'object' ? { code: textOrNull(run.failure.code), message: textOrNull(run.failure.message) } : null
  return {
    exists,
    id: exists ? textOrNull(run.id) : null,
    sessionId: exists ? textOrNull(run.sessionId) : null,
    status: exists ? textOrNull(run.status) : null,
    phase: exists ? textOrNull(run.phase) : null,
    active: exists && run.active === true,
    stale: exists && run.stale === true,
    awaitingAnswer: exists && run.awaitingAnswer === true,
    idleHandback: exists && run.idleHandback === true,
    autoAdvance: exists && run.autoAdvance && typeof run.autoAdvance === 'object' ? { ...run.autoAdvance } : null,
    startedAt: exists ? textOrNull(run.startedAt) : null,
    lastActivityAt: exists ? textOrNull(run.lastActivityAt) : null,
    label: exists ? textOrNull(run.label) : null,
    failure,
    scopeDiagnostic: exists && run.scopeDiagnostic && typeof run.scopeDiagnostic === 'object' ? {
      changedCount: intOrNull(run.scopeDiagnostic.changedCount) ?? 0,
      allowedCount: intOrNull(run.scopeDiagnostic.allowedCount) ?? 0,
      outOfScope: asArray(run.scopeDiagnostic.outOfScope).map(textOrNull).filter(Boolean),
      risky: asArray(run.scopeDiagnostic.risky).map(textOrNull).filter(Boolean),
      reason: textOrNull(run.scopeDiagnostic.reason),
    } : null,
    failureDiagnostic: exists && run.failureDiagnostic && typeof run.failureDiagnostic === 'object' ? {
      id: textOrNull(run.failureDiagnostic.id), summary: textOrNull(run.failureDiagnostic.summary),
      stage: textOrNull(run.failureDiagnostic.stage), step: textOrNull(run.failureDiagnostic.step),
      category: textOrNull(run.failureDiagnostic.category), title: textOrNull(run.failureDiagnostic.title), log: textOrNull(run.failureDiagnostic.log),
    } : null,
  }
}

function summarizeAiReview(item) {
  const ai = item?.aiReview && typeof item.aiReview === 'object' ? item.aiReview : {}
  const stored = ai.stored === true
  return {
    stored,
    verdict: stored ? textOrNull(ai.verdict) : null,
    suggestions: stored ? intOrNull(ai.suggestions) : null,
    adopted: stored ? (ai.adopted ?? null) : null,
    generatedAt: stored ? textOrNull(ai.generatedAt) : null,
  }
}

/** Historical review facts are advisory, never delivery prerequisites. */
function summarizeReview(item, decision) {
  const review = item?.review ?? {}
  const summary = review.summary ?? {}
  const coverage = review.coverage ?? summary.coverage ?? {}
  const roles = asArray(review.roles)
  const total = intOrNull(coverage.total) ?? intOrNull(summary.total) ?? roles.length
  const completed = intOrNull(coverage.completed) ?? intOrNull(summary.completed) ?? roles.filter(role => role?.verdict).length
  const blockers = intOrNull(summary.blockers) ?? 0
  const missing = asArray(coverage.missing).filter(id => typeof id === 'string')
  const ai = summarizeAiReview(item)
  return {
    state: 'advisory', optional: true, gating: false,
    completed, total, blockers, coverageMissing: missing,
    coverage: { completed, total, missing }, roles, ai,
    channels: [{ id: 'ai', label: 'AI 优化建议（可选）', state: 'advisory',
      detail: ai.stored ? `原结论：${ai.verdict ?? '未知'}；仅供参考，不设门禁` : '可按需生成建议，不设门禁' }],
  }
}

function summarizeAcceptance(item) {
  const acceptance = item?.acceptance && typeof item.acceptance === 'object' ? item.acceptance : {}
  const latest = acceptance.latest && typeof acceptance.latest === 'object' ? acceptance.latest : null
  const commands = asArray(acceptance.commands)
  const headSha = latest ? textOrNull(latest.headSha) : null
  return {
    registered: boolOrNull(acceptance.registered),
    commandCount: intOrNull(acceptance.commandCount) ?? (acceptance.commands ? commands.length : null),
    result: latest ? textOrNull(latest.result) : null,
    current: latest ? boolOrNull(latest.current) : null,
    complete: latest ? boolOrNull(latest.complete) : null,
    finishedAt: latest ? textOrNull(latest.finishedAt) : null,
    headSha,
    headShaShort: headSha ? headSha.slice(0, 8) : null,
    environment: latest ? textOrNull(latest.environment) : null,
    diagnostic: latest?.diagnostic && typeof latest.diagnostic === 'object' ? {
      category: textOrNull(latest.diagnostic.category), title: textOrNull(latest.diagnostic.title),
      summary: textOrNull(latest.diagnostic.summary), command: asArray(latest.diagnostic.command).map(textOrNull).filter(Boolean),
      log: textOrNull(latest.diagnostic.log),
    } : null,
    provenance: {
      commandIds: commands.map((command) => textOrNull(command?.id)).filter((id) => id !== null),
      evidencePath: latest ? textOrNull(latest.file) : null,
      ruleCodes: [],
    },
  }
}

function deriveExecutionDiagnostic(item, summaries) {
  const { run, acceptance } = summaries
  // A live turn is still changing the worktree. A prior failed check cannot
  // diagnose that turn and must never surface a repair action while coding.
  if (isLiveRun(run)) return null
  const scope = run.scopeDiagnostic
  if (scope && (scope.outOfScope.length || scope.risky.length || scope.reason)) {
    const files = [...new Set([...scope.outOfScope, ...scope.risky])]
    return {
      category: 'scope', title: '🟠 修改范围超出蓝图锁定边界',
      summary: `本轮实际修改了 ${scope.changedCount} 个文件，超出执行蓝图锁定的 ${scope.allowedCount} 个模块范围${files.length ? `：${files.join('、')}` : ''}`,
      log: files.join('\n'), actionLabel: '批准当前修改范围并重新验证',
    }
  }
  if (acceptance.diagnostic) return {
    ...acceptance.diagnostic,
    // A timeout is a command/budget problem, not a code defect. Sending it to
    // "let AI fix the failing item" only repeats the same doomed command.
    actionLabel: acceptance.diagnostic.category === 'timeout' ? '收窄验收命令并重新验证'
      : acceptance.diagnostic.category === 'environment' ? '刷新证据并重新验证'
        : '🔧 让 AI 自动修复未通过项',
  }
  const code = run.failure?.code ?? run.autoAdvance?.reason
  const normalizedCode = String(code ?? '').toLowerCase() === 'transport' ? 'transport-failed' : code
  const message = run.failure?.message ?? run.failureDiagnostic?.summary
  const labels = {
    'environment-blocked': '🟠 调查证据过期或环境受阻',
    'verification-timeout': '🟠 专项验证执行超时',
    'verification-command-unavailable': '🟠 验证命令无法启动',
    'verification-unavailable': '🟠 验证环境暂不可用',
    'verification-context-changed': '🟠 验收证据已过期',
    'registered-acceptance-failed': '🟠 验证检查未通过',
    'verify-failed': '🟠 验证检查未通过',
    'waiting-input': '🟡 等待继续推进',
    'review-result': '🟡 AI 已交回本轮结果',
    'tampered_test': '🟠 测试断言防篡改锁已触发',
    'transport-failed': '🟠 模型连接中断，推进已暂停',
  }
  if (!code && !message) return null
  return {
    category: run.failureDiagnostic?.category ?? 'run', title: labels[normalizedCode] ?? run.failureDiagnostic?.title ?? '🟠 推进暂停，等待处理',
    summary: message ?? '系统未能继续确认本轮推进条件；请查看诊断详情后恢复推进。',
    log: run.failureDiagnostic?.log ?? '',
    actionLabel: normalizedCode === 'transport-failed' ? '▶ 从断点恢复推进'
      : normalizedCode === 'verification-timeout' ? '收窄验收命令并重新验证'
        : ['environment-blocked', 'verification-context-changed', 'verification-command-unavailable'].includes(normalizedCode) ? '刷新证据并重新验证'
          : '🔧 让 AI 自动修复未通过项',
  }
}

function summarizeCandidate(item) {
  const candidate = item?.candidate && typeof item.candidate === 'object' ? item.candidate : {}
  const exists = candidate.exists === true
  const treeHash = exists ? textOrNull(candidate.treeHash) : null
  const reasons = asArray(candidate.reasons)
    .map((reason) => (typeof reason === 'string' ? reason : textOrNull(reason?.message ?? reason?.code)))
    .filter((reason) => reason !== null)
  return {
    exists,
    id: exists ? textOrNull(candidate.id) : null,
    current: typeof candidate.current === 'boolean' ? candidate.current : null,
    treeHash,
    treeHashShort: treeHash ? treeHash.slice(0, 8) : null,
    reasons,
    architecture: candidate.architecture && typeof candidate.architecture === 'object' ? {
      path: textOrNull(candidate.architecture.path), indexPath: textOrNull(candidate.architecture.indexPath),
    } : null,
    development: candidate.development && typeof candidate.development === 'object' ? {
      devBranch: textOrNull(candidate.development.devBranch ?? candidate.devBranch),
      devCommitSha: textOrNull(candidate.development.devCommitSha ?? candidate.devCommitSha),
      pushedToRemoteDev: candidate.development.pushedToRemoteDev === true || candidate.pushedToRemoteDev === true,
      reason: textOrNull(candidate.development.reason),
    } : null,
  }
}

function summarizeDefects(item) {
  const view = item?.defect && typeof item.defect === 'object' ? item.defect : {}
  const raw = view.exists === true && view.defect && typeof view.defect === 'object' ? view.defect : null
  if (!raw) {
    return { own: null, related: [], closedHistory: [], counts: { open: 0, closed: 0 } }
  }
  const status = textOrNull(view.status) ?? textOrNull(raw.status)
  const own = {
    id: textOrNull(raw.id),
    status,
    statusLabel: textOrNull(view.statusLabel),
    closed: status === 'closed',
    regressionSuspected: view.regressionSuspected === true || raw.regressionSuspected === true,
    occurrenceCount: intOrNull(view.occurrenceCount) ?? intOrNull(raw.occurrenceCount) ?? 0,
  }
  // item.defect only carries the single most relevant defect, so related stays
  // empty instead of guessing other defects.
  const closedHistory = own.closed
    ? [{ id: own.id, status: own.status, statusLabel: own.statusLabel, closed: true }]
    : []
  return {
    own,
    related: [],
    closedHistory,
    counts: { open: own.closed ? 0 : 1, closed: closedHistory.length },
  }
}

function summarizeRelease(item) {
  const latest = item?.release && typeof item.release === 'object' ? item.release : {}
  // The delivery projection already decided whether publication belongs to the
  // current iteration. A later draft must not hide its successful predecessor.
  const release = item?.delivery?.source === 'release' && latest.status !== 'released'
    ? latest.lastReleased ?? latest
    : latest
  if (release.exists !== true) return null
  return {
    exists: true,
    id: textOrNull(release.id),
    label: textOrNull(release.label),
    status: textOrNull(release.status),
    target: textOrNull(release.target),
    released: release.status === 'released',
    githubVerified: release.githubVerified === true,
    github: release.github ?? null,
    sourceControl: release.sourceControl ?? null,
    mainMerged: release.mainMerged === true ||
      (release.sourceControl?.pushedToMain === true && Boolean(release.sourceControl?.mainMergeCommitSha)),
  }
}

function githubLinksFor(item, summaries) {
  const sourceControl = summaries.release?.sourceControl ?? {}
  const candidateDevelopment = summaries.candidate?.development ?? {}
  const development = item?.development ?? {}
  const architecturePath = summaries.candidate?.architecture?.path ?? sourceControl.architectureDocPath ?? null
  const synced = sourceControl.pushedToRemoteDev === true ||
    candidateDevelopment.pushedToRemoteDev === true ||
    summaries.release?.mainMerged === true
  return githubDeliveryLinks({
    remoteUrl: sourceControl.remoteUrl ?? development.remoteUrl ?? null,
    devBranch: sourceControl.devBranch ?? candidateDevelopment.devBranch ?? development.integrationBranch ?? null,
    mainBranch: sourceControl.mainBranch ?? development.releaseBranch ?? null,
    devCommitSha: sourceControl.devCommitSha ?? candidateDevelopment.devCommitSha ?? null,
    mainMergeCommitSha: sourceControl.mainMergeCommitSha ?? null,
    architectureDocPath: architecturePath,
    synced,
  })
}

// A completed delivery is authoritative over older run snapshots. Runs are
// retained for audit, but their historic failures cannot turn a signed-off or
// published requirement back into a blocked implementation in the UI.
function isDeliverySettled(summaries, decision) {
  const delivery = summaries?.delivery ?? {}
  if (delivery.key === 'closed' || delivery.key === 'accepted') return true
  if (summaries?.release?.released === true) return true
  return delivery.key === 'awaiting-acceptance' &&
    summaries?.candidate?.current === true &&
    decision?.state === 'ready-for-human'
}

function acceptanceNumber(value) {
  const match = /^AC-(\d+)$/i.exec(String(value ?? '').trim())
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER
}

function sortAcceptanceCriteria(criteria) {
  return [...criteria].sort((left, right) => {
    if (Boolean(left?.legacyBaseline) !== Boolean(right?.legacyBaseline)) return left?.legacyBaseline ? -1 : 1
    if (left?.legacyBaseline && right?.legacyBaseline) return 0
    const byNumber = acceptanceNumber(left?.id) - acceptanceNumber(right?.id)
    return byNumber || String(left?.id ?? '').localeCompare(String(right?.id ?? ''))
  })
}

// ---------------------------------------------------------------------------
// §3 focus resolution — order is a contract, first hit wins.
// ---------------------------------------------------------------------------

function blockedDecision(decision) {
  return decision?.state === 'blocked' || decision?.state === 'needs-clarification'
}

function acceptancePassed(acceptance) {
  return acceptance?.registered === true && acceptance?.result === 'pass' && acceptance?.current === true && acceptance?.complete === true
}

function isLiveRun(run) {
  return run?.exists === true && run.active === true && run.stale !== true &&
    run.idleHandback !== true && run.awaitingAnswer !== true &&
    (run.status === 'running' || run.status === 'queued')
}

function isTransportFailure(run) {
  return ['transport-failed', 'transport'].includes(String(run?.failure?.code ?? '').toLowerCase())
}

function resolveFocus(item, summaries, decision) {
  const { delivery, run, acceptance, candidate, release } = summaries
  const closed = item?.closed === true || delivery.key === 'closed'
  if (closed) return { kind: 'closed', headline: '已关闭', tone: delivery.source === 'release' ? 'success' : 'neutral' }
  // Successful publication is historical. Old unanswered/parked runs and stale
  // evidence remain inspectable, but cannot reopen this delivery iteration.
  if (delivery.key === 'accepted' && (delivery.source === 'release' || release?.released === true)) {
    return { kind: 'released', headline: '已发布', tone: 'success' }
  }
  // A current candidate or a trusted sign-off is the delivery authority for
  // this revision. A previous run may still be parked on a now-consumed
  // decision, but it must not take the UI back to an old recovery state.
  if (delivery.key === 'awaiting-acceptance') {
    return { kind: 'awaiting-acceptance', headline: '等待验收', tone: 'attention' }
  }
  if (delivery.key === 'accepted' && release?.status === 'authorized') {
    return { kind: 'release-authorized', headline: '已授权，等待执行发布', tone: 'attention' }
  }
  if (delivery.key === 'accepted' && release?.status === 'failed') {
    return { kind: 'release-failed', headline: '发布失败，可重试', tone: 'danger' }
  }
  if (delivery.key === 'accepted') return { kind: 'accepted', headline: '已验收', tone: 'success' }
  if (run.exists && run.awaitingAnswer) return { kind: 'answer', headline: '需要你回答', tone: 'attention' }
  // Old evidence describes the previous attempt, not the live repair round.
  // Preserve its warnings below, but never invite another start during a turn.
  if (isLiveRun(run) && delivery.key !== 'accepted' && delivery.key !== 'awaiting-acceptance') {
    return { kind: 'run-active', headline: 'AI 正在开发', tone: 'attention' }
  }
  // A settled session is recoverable work, even when old evidence is stale or
  // failed. Surface the run controls first; reporting a historical result as
  // the primary state used to hide the only way out of review-result.
  if (run.exists && (run.status === 'failed' || run.stale)) return { kind: 'run-interrupted', headline: '等待恢复推进或重新验证', tone: 'danger' }
  if (run.exists && run.idleHandback) {
    if (acceptancePassed(acceptance) && summaries.candidate?.exists !== true) {
      return { kind: 'candidate-pending', headline: '等待生成交付候选', tone: 'attention' }
    }
    return { kind: 'run-idle-handback', headline: '等待恢复推进或重新验证', tone: 'attention' }
  }
  // Outside a live turn, deterministic evidence blockers mean the requirement
  // itself must change before another delivery round can start.
  if (blockedDecision(decision)) {
    return { kind: 'acceptance-failed', headline: '需求需要修改', tone: 'danger' }
  }
  // Only a recorded non-pass result means "failed"; registered-but-never-run is
  // still unchecked evidence.
  if (acceptance.registered === true && acceptance.result !== null && acceptance.result !== 'pass') {
    return { kind: 'acceptance-failed', headline: acceptance.current === true ? '验收失败，可修复' : '历史检查未通过，需重新核验', tone: 'danger' }
  }
  // A hand-back is parked by design: the heartbeat may still be warm (the host
  // holds the session), but no turn is running, so it must not read as 开发中.
  if (acceptancePassed(acceptance)) {
    return { kind: 'candidate-pending', headline: '等待生成交付候选', tone: 'attention' }
  }
  if (delivery.key === 'pending' && typeof delivery.source === 'string' && delivery.source.startsWith('run-')) {
    return { kind: 'run-rolled-back', headline: '推进已回退，等待启动', tone: 'attention' }
  }
  if (delivery.key === 'in-progress') return { kind: 'run-active', headline: 'AI 正在开发', tone: 'attention' }
  return { kind: 'not-started', headline: '尚未开始', tone: 'neutral' }
}

function buildQuestion(item, summaries, focus) {
  if (focus.kind !== 'answer') return null
  const raw = item?.run?.decisionRequest ?? item?.run?.decision
  let ref = null
  let title = null
  let excerpt = null
  if (raw && typeof raw === 'object') {
    ref = textOrNull(raw.ref ?? raw.path ?? raw.file)
    title = textOrNull(raw.title) ?? '运行决策请求'
    const text = nonEmptyText(raw.excerpt ?? raw.text)
    excerpt = text ? text.slice(0, 400) : null
  } else if (typeof raw === 'string') {
    ref = raw
    title = textOrNull(item?.run?.decisionTitle) ?? '运行决策请求'
    const text = nonEmptyText(item?.run?.decisionText)
    excerpt = text ? text.slice(0, 400) : null
  } else {
    title = '运行决策请求'
  }
  return { ref, title, excerpt, runId: summaries.run.id ?? null }
}

function buildExplanation(item, summaries, decision, focus) {
  const { delivery, run, acceptance, candidate, release } = summaries
  const runLabel = run.id ?? '当前运行'
  let explanation
  switch (focus.kind) {
    case 'closed': {
      const closure = item?.closure && typeof item.closure === 'object' ? item.closure : null
      const reason = textOrNull(closure?.reason) ?? delivery.reason
      explanation = delivery.source === 'release'
        ? (release?.githubVerified || release?.mainMerged) ? '代码与架构档案已合入 GitHub main 分支，本次需求已关闭。' : '本地发布流程已结束，需求已关闭；历史记录缺少 GitHub 合并凭据，尚不能确认代码已合入 main。'
        : `需求已关闭${reason ? `：${reason}` : ''}；当前为只读历史状态。`
      break
    }
    case 'answer': {
      const decisionRef = textOrNull(item?.run?.decision)
      explanation = `运行 ${runLabel} 正在等待你回答决策请求${decisionRef ? `（${decisionRef}）` : ''}；回答会继续同一运行，不会新建运行。`
      break
    }
    case 'run-interrupted': {
      const hasCheckpoint = Boolean(item?.run && (item.run.checkpoint || item.run.decision))
      explanation = hasCheckpoint
        ? `运行 ${runLabel} 的心跳已中断，但存在检查点，可从检查点恢复后继续。`
        : `运行 ${runLabel} 的心跳已中断，无法确认可恢复，需人工核对。`
      break
    }
    case 'run-active':
      explanation = `运行 ${runLabel} 正在执行，AI 正在开发；完成后会回传结果。`
      break
    case 'run-idle-handback':
      explanation = `运行 ${runLabel} 已把控制权交回，等待你决定下一步。`
      break
    case 'awaiting-acceptance':
      explanation = candidate.exists
        ? `交付候选 ${candidate.id} 已生成，等待你验收确认。`
        : '等待你验收确认当前交付。'
      break
    case 'released':
      explanation = `需求已发布${release?.label ? `（${release.label}）` : ''}；当前为只读历史状态。`
      break
    case 'release-authorized':
      explanation = `发布记录 ${release?.id ? `${release.id} ` : ''}已获得人类授权，等待执行发布（目标环境 ${release?.target ?? '未指定'}）。授权不是发布：执行结果会单独记录。`
      break
    case 'release-failed':
      explanation = `发布记录 ${release?.id ? `${release.id} ` : ''}执行失败，可重试；已验收的交付内容不受影响。`
      break
    case 'accepted':
      explanation = '需求已验收，等待决定是否发布。'
      break
    case 'acceptance-failed':
      explanation = `最近一次检查未通过${acceptance.headShaShort ? `（提交 ${acceptance.headShaShort}）` : ''}${acceptance.current === true ? '' : acceptance.current === false ? '；该结果已过期' : '；该结果对当前内容的适用性尚未确认'}；可先检查并重新验证，不会永久禁止开发。`
      break
    case 'run-rolled-back':
      explanation = `上一次推进已回退，当前等待重新启动${delivery.reason ? `：${delivery.reason}` : ''}；可交给 AI 推进。`
      break
    default:
      explanation = delivery.reason
        ? `尚未开始推进：${delivery.reason}；可交给 AI 推进。`
        : '尚未开始推进；可交给 AI 推进。'
  }
  // A rolled-back delivery keeps its reason visible in the summary line instead
  // of rendering a second "interruption reason" card. The answer / hand-back
  // states already say what is blocking, so appending the rollback reason would
  // only repeat it.
  const selfExplained = focus.kind === 'answer' || focus.kind === 'run-idle-handback' || focus.kind === 'run-active'
  if (!selfExplained && delivery.key === 'pending' && delivery.reason && !explanation.includes(delivery.reason)) {
    explanation = `${explanation} ${delivery.reason}。`
  }
  return explanation
}

// ---------------------------------------------------------------------------
// §3 attention items — fixed order, generated only from real fields.
// ---------------------------------------------------------------------------

function buildAttentionItems(item, summaries, decision) {
  const { acceptance, candidate, defects, delivery, run } = summaries
  const items = []
  // The candidate itself is bound to fresh passing acceptance evidence. Do not
  // resurface a historical failed attempt beside an already deliverable build.
  const deliverySettled = candidate.current === true &&
    ((delivery.key === 'awaiting-acceptance' && decision?.state === 'ready-for-human') ||
      ['accepted', 'closed'].includes(delivery.key))

  if (!deliverySettled && !isLiveRun(run) && acceptance.result !== null && acceptance.result !== 'pass') {
    items.push({
      id: 'attn-acceptance-failed',
      kind: 'acceptance-failed',
      current: acceptance.current === true,
      tone: 'danger',
      title: acceptance.current === true ? '验收失败' : '历史检查未通过',
      detail: `最近一次检查结果为 ${acceptance.result}${acceptance.headShaShort ? `（提交 ${acceptance.headShaShort}）` : ''}${acceptance.current === true ? '' : acceptance.current === false ? '；该结果已过期' : '；当前适用性未确认'}；请检查并重新验证。`,
      ref: { tab: 'delivery', anchor: 'delivery-acceptance' },
    })
  }

  if (!deliverySettled && !isLiveRun(run) && (acceptance.registered !== true || acceptance.result === null)) {
    items.push({
      id: 'attn-acceptance-missing',
      kind: 'acceptance-missing',
      current: true,
      tone: 'attention',
      title: '缺少验收证据',
      detail:
        acceptance.registered !== true
          ? '尚未登记验收命令；在 tests/ 下新增 TEST-* 并加 verified_by 关系'
          : '验收命令尚未执行',
      ref: { tab: 'delivery', anchor: 'delivery-acceptance' },
    })
  }

  if (candidate.exists && candidate.current !== true) {
    items.push({
      id: 'attn-candidate-stale',
      kind: 'candidate-stale',
      current: true,
      tone: 'attention',
      title: candidate.current === false ? '交付候选已过期' : '交付候选有效性未知',
      detail: candidate.reasons.length > 0 ? candidate.reasons.join('；') : candidate.current === false ? '需求或证据已变化，需要重新生成交付候选' : '无法确认候选是否适用于当前内容，请重新核验。',
      ref: { tab: 'delivery', anchor: 'delivery-candidate' },
    })
  }

  if (!deliverySettled && acceptance.result === 'pass' && acceptance.current === false) {
    const staleReason = textOrNull(item?.acceptance?.latest?.staleReason)
    items.push({
      id: 'attn-evidence-stale',
      kind: 'evidence-stale',
      current: true,
      tone: 'attention',
      title: '验收证据已过期',
      detail: `${STALE_REASON_LABELS[staleReason] ?? '证据与当前提交不一致'}；此前验收曾通过${acceptance.headShaShort ? `（提交 ${acceptance.headShaShort}）` : ''}，需重跑验收`,
      ref: { tab: 'delivery', anchor: 'delivery-acceptance' },
    })
  }

  if (!deliverySettled && acceptance.result === 'pass' && acceptance.current === null) {
    items.push({
      id: 'attn-evidence-unknown', kind: 'evidence-unknown', current: true, tone: 'attention',
      title: '验收证据适用性未知',
      detail: '此前检查曾通过，但无法确认是否适用于当前内容；请重新核验。',
      ref: { tab: 'delivery', anchor: 'delivery-acceptance' },
    })
  }

  if (defects.own && !defects.own.closed) {
    items.push({
      id: 'attn-defect-open',
      kind: 'defect-open',
      current: true,
      tone: defects.own.regressionSuspected ? 'danger' : 'attention',
      title: '未关闭缺陷',
      detail: `${defects.own.id ?? '关联缺陷'} 状态：${defects.own.statusLabel ?? defects.own.status ?? '未知'}${defects.own.regressionSuspected ? '；疑似回归' : ''}`,
      ref: { tab: 'delivery', anchor: 'delivery-defects' },
    })
  }

  if (defects.closedHistory.length > 0) {
    items.push({
      id: 'attn-defect-closed',
      kind: 'defect-closed',
      current: false,
      tone: 'neutral',
      title: '已关闭缺陷（历史）',
      detail: `${defects.closedHistory.map((defect) => defect.id ?? '关联缺陷').join('、')} 已关闭；这是历史记录，不代表本次需求已修复`,
      ref: { tab: 'record', anchor: 'record-defects' },
    })
  }

  return items
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function actionAvailability(id, target) {
  if (id === 'answer-run' || id === 'resume-run' || id === 'watch-run' || id === 'continue-run') {
    return target.runId ? { enabled: true, reason: null } : { enabled: false, reason: '缺少关联的运行记录' }
  }
  if (id === 'signoff' || id === 'release') {
    return target.candidateId
      ? { enabled: true, reason: null }
      : { enabled: false, reason: '尚未生成交付候选' }
  }
  if (id === 'execute-release') {
    return target.releaseId ? { enabled: true, reason: null } : { enabled: false, reason: '缺少发布记录' }
  }
  // Review repair is a requirement edit: the server must know the version the
  // reviewer looked at. Running the review only needs the requirement itself.
  if (id === 'fix-review' || id === 'run-review') {
    return target.requirementRevision != null
      ? { enabled: true, reason: null }
      : { enabled: false, reason: '缺少需求版本' }
  }
  // Creating the delivery candidate is a plain server action: the drawer only
  // needs the requirement, and the server decides whether evidence allows it.
  if (id === 'create-candidate') {
    return target.requirementRevision != null
      ? { enabled: true, reason: null }
      : { enabled: false, reason: '缺少需求版本' }
  }
  // Preflight decides whether a fix may start, so the button itself never
  // disables.
  if (id === 'start-fix' || id === 'start') return { enabled: true, reason: null }
  return { enabled: false, reason: '不支持的动作' }
}

/**
 * Map the resolved context to its single primary action.
 *
 * @param {object} detail a detail view (or a partial object with
 *   `context.kind`, `summaries`, `identity`) — pure, no IO.
 * @returns {null|{id: string, label: string, enabled: boolean, reason: string|null,
 *   target: {runId: string|null, decisionRef: string|null, candidateId: string|null,
 *   requirementRevision: number|null}}}
 */
export function primaryActionFor(detail) {
  const source = detail && typeof detail === 'object' ? detail : {}
  const kind = textOrNull(source.context?.kind)
  const id = kind ? (ACTION_BY_KIND[kind] ?? null) : null
  if (!id) return null
  const summaries = source.summaries && typeof source.summaries === 'object' ? source.summaries : {}
  const run = summaries.run && typeof summaries.run === 'object' ? summaries.run : {}
  const candidate = summaries.candidate && typeof summaries.candidate === 'object' ? summaries.candidate : {}
  const release = summaries.release && typeof summaries.release === 'object' ? summaries.release : {}
  const target = {
    runId: run.exists === true ? (run.id ?? null) : null,
    decisionRef: textOrNull(source.context?.question?.ref),
    candidateId: candidate.exists === true ? (candidate.id ?? null) : null,
    releaseId: release.exists === true ? (release.id ?? null) : null,
    requirementRevision: intOrNull(source.identity?.revision) ?? source.identity?.revision ?? null,
  }
  const availability = isLiveRun(run) && id !== 'watch-run' && id !== 'answer-run'
    ? { enabled: false, reason: 'AI 正在推进，请先查看当前运行' }
    : actionAvailability(id, target)
  return { id, label: ACTION_LABELS[id], enabled: availability.enabled, reason: availability.reason, target }
}

function secondaryActionsFor(detail) {
  if (!detail?.primaryAction && detail?.context?.kind === 'closed') return []
  const primaryId = detail?.primaryAction?.id ?? null
  const actions = [
    ...(detail?.context?.kind === 'run-interrupted' && isTransportFailure(detail?.summaries?.run)
      ? [{ id: 'run-acceptance', label: ACTION_LABELS['run-acceptance'], enabled: true, reason: null }]
      : []),
    { id: 'refresh', label: '刷新', enabled: true, reason: null },
    { id: 'open-record', label: '查看记录', enabled: true, reason: null },
  ]
  return actions.filter((action) => action.id !== primaryId)
}

// ---------------------------------------------------------------------------
// Record helpers
// ---------------------------------------------------------------------------

function relationsOf(item, allItems) {
  const groups = RELATION_GROUPS.map((label) => [label, []])
  const byLabel = Object.fromEntries(groups)
  for (const other of allItems) {
    if (other?.id === item?.id) continue
    if (asArray(other?.links).some((link) => link?.type === 'parent_of' && link?.target === item?.id)) {
      byLabel['上级'].push(other.id)
    }
  }
  for (const link of asArray(item?.links)) {
    const label = REL_LABELS[link?.type] ?? link?.type
    if (byLabel[label]) byLabel[label].push(link.target)
  }
  return groups.filter(([, ids]) => ids.length > 0)
}

function buildRelatedRefs(summaries, relations) {
  const refs = []
  const seen = new Set()
  const add = (id, label, tab) => {
    if (!id) return
    const key = `${tab}|${id}`
    if (seen.has(key)) return
    seen.add(key)
    refs.push({ id, label: label ?? id, tab })
  }
  if (summaries.run.exists) add(summaries.run.id, `运行 ${summaries.run.id}`, 'record')
  if (summaries.candidate.exists) add(summaries.candidate.id, `交付候选 ${summaries.candidate.id}`, 'delivery')
  if (summaries.release?.exists) add(summaries.release.id, `发布 ${summaries.release.id}`, 'delivery')
  if (summaries.defects.own) add(summaries.defects.own.id, `缺陷 ${summaries.defects.own.id}`, 'delivery')
  for (const [label, ids] of relations) {
    for (const id of ids) add(id, `${label} ${id}`, 'requirement')
  }
  return refs
}

function convergenceChangeSummary(event) {
  const diff = event?.diff && typeof event.diff === 'object' ? event.diff : {}
  const changes = type => Array.isArray(diff[type]) ? diff[type] : []
  const acceptance = type => changes(type).filter(change => change?.kind === 'acceptance')
  const describe = change => {
    const id = textOrNull(change?.id)
    const label = textOrNull(change?.label)
    // A criterion can be shortened only at a natural sentence boundary; never
    // crop arbitrary characters out of a business rule.
    const firstClause = label?.match(/^(.+?[。！？；;])(?:\s|$)/)?.[1] ?? label
    return [id, firstClause].filter(Boolean).join(': ')
  }
  const added = acceptance('added')
  const modified = acceptance('modified')
  const removed = acceptance('removed')
  const parts = []
  if (added.length) parts.push(`新增 ${added.length} 项验收标准${added[0] ? `（${describe(added[0])}）` : ''}`)
  if (modified.length) parts.push(`调整 ${modified.length} 项验收标准${modified[0] ? `（${describe(modified[0])}）` : ''}`)
  if (removed.length) parts.push(`移除 ${removed.length} 项验收标准${removed[0]?.id ? `（${removed[0].id}）` : ''}`)
  const nonAcceptanceChanges = ['added', 'modified', 'removed'].flatMap(changes).filter(change => change?.kind && change.kind !== 'acceptance')
  if (nonAcceptanceChanges.length) parts.push('同步更新需求说明')

  const note = textOrNull(event?.evolutionNote)
  const genericNote = !note || /^(?:主对话定稿|需求定稿|已确认|确认收敛)[。！! ]*$/u.test(note)
  const summary = genericNote ? (parts.join(' · ') || '更新需求基线') : note
  return [summary, event?.sourceSession ? `来源会话：${event.sourceSession}` : null].filter(Boolean).join(' · ')
}

function buildTimeline(item) {
  const entries = []
  const push = (at, kind, title, detail, tab, anchor) => {
    if (parseTime(at) === null) return
    entries.push({ at, kind, title: title ?? kind, detail: detail ?? null, ref: { tab, anchor } })
  }
  push(item?.createdAt, 'created', '创建需求 · v1', item?.sourceSession ? `来源会话：${item.sourceSession}` : null, 'record', 'record-timeline')
  for (const event of asArray(item?.specConvergences)) {
    push(event.at, 'spec_converged', event.beforeRevision && event.revision ? `需求基线已收敛 · v${event.beforeRevision} → v${event.revision}` : '需求基线已收敛', convergenceChangeSummary(event), 'record', 'record-timeline')
    if (parseTime(event.at) !== null) entries[entries.length - 1].specDelta = { diff: event.diff, acceptanceCriteria: event.acceptanceCriteria, beforeDocument: event.beforeDocument, afterDocument: event.afterDocument, beforeRevision: event.beforeRevision, revision: event.revision }
  }
  for (const version of asArray(item?.versions)) {
    push(
      version?.date,
      'commit',
      version?.subject ?? version?.short ?? version?.sha ?? '提交',
      version?.short ?? version?.sha ?? null,
      'record',
      'record-timeline',
    )
  }
  if (item?.aiReview?.stored === true) {
    push(
      item.aiReview.generatedAt,
      'ai-review',
      '生成 AI 优化建议',
      textOrNull(item.aiReview.verdict),
      'delivery',
      'delivery-ai-suggestions',
    )
  }
  const latestAcceptance = item?.acceptance?.latest
  if (latestAcceptance) {
    push(
      latestAcceptance.finishedAt,
      'acceptance',
      '执行技术检查',
      latestAcceptance.result === 'pass'
        ? latestAcceptance.current === true && latestAcceptance.complete === true ? '当前技术检查通过' : latestAcceptance.current === false ? '历史通过，当前已过期' : '历史通过，当前适用性未知'
        : textOrNull(latestAcceptance.result),
      'delivery',
      'delivery-acceptance',
    )
  }
  if (item?.candidate?.exists === true) {
    push(item.candidate.createdAt, 'candidate', '生成交付候选', textOrNull(item.candidate.id), 'delivery', 'delivery-candidate')
  }
  const signoffs = Array.isArray(item?.humanAcceptance?.signoffs) ? item.humanAcceptance.signoffs : [item?.humanAcceptance?.signoff]
  for (const signoff of signoffs) {
    if (signoff?.decision !== 'approve') continue
    const validity = signoff.valid === true ? '当前有效' : signoff.valid === false ? '当前已失效' : '当前有效性未知'
    push(signoff.at, 'human-signoff', '人工签收交付', [textOrNull(signoff.candidateId), validity].filter(Boolean).join(' · '), 'delivery', 'delivery-candidate')
  }
  if (item?.run?.exists === true) {
    push(item.run.startedAt, 'run', '启动推进', textOrNull(item.run.id), 'delivery', 'delivery-run-observation')
    if (item.run.lastAnswerAt) {
      push(
        item.run.lastAnswerAt,
        'answer',
        '回答决策请求',
        `第 ${intOrNull(item.run.answers) ?? 1} 次回答`,
        'delivery',
        'delivery-run-observation',
      )
    }
  }
  if (item?.closure) {
    push(item.closure.at, 'closure', '关闭需求', textOrNull(item.closure.reason), 'record', 'record-timeline')
  }
  if (item?.release?.exists === true) {
    push(
      item.release.releasedAt ?? item.release.authorizedAt,
      'release',
      '发布',
      textOrNull(item.release.label) ?? textOrNull(item.release.id),
      'delivery',
      'delivery-release',
    )
  }
  if (item?.defect?.exists === true) {
    push(
      item.defect.defect?.updatedAt,
      'defect',
      '缺陷状态更新',
      textOrNull(item.defect.statusLabel) ?? textOrNull(item.defect.status),
      'delivery',
      'delivery-defects',
    )
  }

  entries.sort((left, right) => parseTime(left.at) - parseTime(right.at))
  return entries
}

const timelineHash = entries => createHash('sha256').update(JSON.stringify(entries)).digest('hex')

export function collectedTimelinePage(item, before, fingerprint) {
  if (!Number.isSafeInteger(before) || before < 1 || !/^[a-f0-9]{64}$/.test(fingerprint ?? '')) throw Object.assign(new Error('时间线游标无效'), { status: 400, code: 'timeline-cursor-invalid' })
  const entries = buildTimeline(item)
  if (timelineHash(entries) !== fingerprint) throw Object.assign(new Error('时间线已变化，请刷新需求后重新读取'), { status: 409, code: 'timeline-changed' })
  if (before > entries.length) throw Object.assign(new Error('时间线游标无效'), { status: 400, code: 'timeline-cursor-invalid' })
  const start = Math.max(0, before - 50)
  return { entries: entries.slice(start, before), next: start || null, fingerprint }
}

function technicalPrompt(item) {
  if (!item?.id) return null
  const root = textOrNull(item.root)
  const at = root ? ` --root "${root}"` : ''
  if (item.nextAction === 'missing-acceptance') {
    return `请为 ${item.id} 补验收：在 tests/ 下新增 TEST-* 资产，并在需求里加 verified_by 关系；然后运行 node packages/alm-core/bin/alm.mjs check${at} 确认 COV-001 通过。`
  }
  if (item.nextAction === 'dangling-relation') {
    return `请修复 ${item.id} 的关系：先看 alm check${at} 里 REL-001 的 file:line，补建目标资产或删除悬空关系，再重跑门禁。`
  }
  if (item.nextAction === 'ready-to-change') {
    return `请为 ${item.id} 发起变更：先读 docs/planning/skill-plan.md 与 alm-change-workflow 技能，用 alm workspace create --baseline <sha> --change CHG-<DOMAIN>-<NNN> 建工作区，再改资产并跑 alm check${at}。`
  }
  return `请评估 ${item.id} 的影响面：运行 node packages/alm-core/bin/alm.mjs impact --asset ${item.id}${at}，并检查是否需要更新基线。`
}

function buildIdentity(item) {
  const versions = asArray(item?.versions)
  const latestVersion = versions[0] && typeof versions[0] === 'object' ? versions[0] : null
  const attachments = asArray(item?.attachmentFiles)
  return {
    id: textOrNull(item?.id),
    revision: item?.revision ?? null,
    title: textOrNull(item?.title),
    owner: textOrNull(item?.owner),
    priority: textOrNull(item?.priority),
    project: textOrNull(item?.project),
    projectName: textOrNull(item?.projectName),
    updatedAt: textOrNull(item?.updatedAt) ?? textOrNull(latestVersion?.date) ?? textOrNull(item?.createdAt) ?? textOrNull(item?.docMeta?.confirmedAt) ?? textOrNull(item?.docView?.doc?.meta?.confirmedAt),
    createdAt: textOrNull(item?.createdAt) ?? textOrNull(item?.docMeta?.confirmedAt) ?? textOrNull(item?.docView?.doc?.meta?.confirmedAt),
    sourceSession: textOrNull(item?.sourceSession),
    file: textOrNull(item?.file),
    line: intOrNull(item?.line),
    brief: textOrNull(item?.brief),
    sources: asArray(item?.sources).filter((source) => typeof source === 'string'),
    attachmentCount: intOrNull(item?.attachments) ?? (Array.isArray(item?.attachmentFiles) ? attachments.length : null),
  }
}

function buildGithub(item) {
  const github = item?.github
  if (!github || typeof github !== 'object') return null
  return {
    issue: github.issue ?? null,
    url: textOrNull(github.url),
    board: github.board ?? null,
    tasks: asArray(github.tasks),
  }
}

// ---------------------------------------------------------------------------
// Public projection
// ---------------------------------------------------------------------------

/**
 * Build the requirement detail projection.
 *
 * @param {object} item a requirement item as produced by `requirements()`.
 * @param {{ now?: number, allItems?: Array<{id: string, links?: Array}> }} [options]
 *   `allItems` recomputes `record.relations`; without it relations stay `[]` so
 *   the client may fill them from its local list (the only allowed fallback).
 * @returns {object} JSON-serialisable detail view (`alm.detail.view/v1`).
 */
export function currentMatterFor(item, detail) {
  const { run, candidate, delivery } = detail.summaries
  const focus = detail.context.kind
  const auto = run.autoAdvance
  let kind = 'unverified'
  let requiresHuman = false
  let headline = detail.context.headline
  let explanation = detail.context.explanation
  let action = detail.primaryAction
  if (isTransportFailure(run)) {
    kind = 'run-interrupted'
    headline = 'AI 推进因模型连接中断暂停'
    explanation = run.failure.message ?? 'DeepSeek Messages transport failed；当前工作区改动已保留。'
    action = primaryActionFor({ ...detail, context: { ...detail.context, kind: 'run-interrupted' } })
  } else if (focus === 'closed' || focus === 'released' || focus === 'accepted') kind = focus
  else if (focus === 'release-authorized' || focus === 'release-failed') kind = 'accepted'
  else if (candidate.current === true && delivery.key === 'awaiting-acceptance' && item?.decision?.state === 'ready-for-human') {
    kind = 'awaiting-acceptance'
    requiresHuman = true
  }
  else if (run.awaitingAnswer) {
    const presentation = item?.run?.decisionPresentation
    const business = presentation?.complete === true && Array.isArray(presentation.decisions) && presentation.decisions.length > 0
    kind = business ? 'decision' : 'technical-block'
    requiresHuman = business
    headline = business ? '有一件事需要你决定' : '技术问题暂停了推进'
    explanation = item?.run?.decisionReadable === false
      ? '决策文件不可读或路径不安全；请查看问题并恢复可读的当前决策，不能直接继续或将缺失内容视为同意。'
      : business ? (presentation.businessQuestion || explanation) : '当前请求尚未形成完整业务决策；请查看原始问题，不能将缺失内容视为同意。'
  } else if (focus === 'awaiting-acceptance' && candidate.current === true && item?.decision?.state === 'ready-for-human') {
    kind = 'awaiting-acceptance'
    requiresHuman = true
  } else if (auto?.status !== 'stopped' && !['accepted', 'awaiting-acceptance'].includes(detail.summaries.delivery.key) &&
      (isLiveRun(run) || (auto?.authorized === true && ['authorized', 'running'].includes(auto.status) && !run.stale && ['running', 'queued'].includes(run.status)))) {
    kind = 'automatic'
    headline = 'AI 正在处理'
    action = primaryActionFor({ ...detail, context: { ...detail.context, kind: 'run-active' } })
    explanation = auto?.authorized === true ? `已获本轮自动推进授权，已调度 ${auto.dispatches ?? 0}/${auto.maxDispatches ?? 3} 次；遇到业务决策会停下来。` : explanation
  } else if (auto?.status === 'stopped' || ['run-interrupted', 'blocked', 'acceptance-failed'].includes(focus)) {
    kind = 'technical-block'
    headline = '推进暂时停在技术问题'
    explanation = humanRunReason(auto?.reason) ?? textOrNull(auto?.reason) ?? explanation
    if (auto?.reason === 'auto-budget-exhausted' && Number.isFinite(auto?.maxDispatches)) explanation = `${explanation}（已用完 ${auto.maxDispatches} 次）`
  } else if (!run.exists && !candidate.exists) kind = 'not-started'
  else if (run.idleHandback) {
    explanation = auto?.authorized === true ? (humanRunReason(auto.reason) ?? '本轮自动推进已停止；请查看最新结果后选择下一步。') : '上轮已交回控制权，未获得本轮自动续推授权；可继续同一运行，不会代替你作答。'
  }
  return { kind, requiresHuman, headline, explanation, action, progress: { phase: run.phase, lastActivityAt: run.lastActivityAt, autoAdvance: auto } }
}

export function deriveDetailView(item, options = {}) {
  const source = item && typeof item === 'object' ? item : {}
  const now = Number.isFinite(options?.now) ? Number(options.now) : Date.now()
  const hasAllItems = Array.isArray(options?.allItems)
  const relations = hasAllItems ? relationsOf(source, options.allItems) : []
  const timeline = buildTimeline(source)

  const decision = source.decision && typeof source.decision === 'object' ? source.decision : null
  const summaries = {
    delivery: summarizeDelivery(source),
    run: summarizeRun(source),
    review: summarizeReview(source, decision),
    aiReview: summarizeAiReview(source),
    acceptance: summarizeAcceptance(source),
    candidate: summarizeCandidate(source),
    defects: summarizeDefects(source),
    release: summarizeRelease(source),
  }
  const deliverySettled = isDeliverySettled(summaries, decision)
  const executionDiagnostic = deliverySettled ? null : deriveExecutionDiagnostic(source, summaries)
  const githubLinks = githubLinksFor(source, summaries)

  const docView = resolveDocView(source)
  const sections = parseBodySections(source.briefText, { aiStored: source.aiReview?.stored === true })
  // Legacy bodies keep the historical wording and detection (goal/scope/acceptance
  // sections). Canonical bodies are judged by the structured document only.
  const missing = docView && docView.legacy !== true ? missingSectionsFromDoc(docView) : missingSections(sections)
  // Canonical documents retain one entry per AC. Prefer them over the legacy
  // prose section so delivery status can be mapped to AC-01…AC-n precisely.
  const structuredAcceptance = asArray(docView?.doc?.acceptance)
    .map((criterion) => ({
      id: textOrNull(criterion?.id),
      title: textOrNull(criterion?.id),
      text: textOrNull(criterion?.text),
    }))
    .filter((criterion) => criterion.id && criterion.text)
  const proseAcceptance = sections
    .filter((section) => section.kind === 'acceptance')
    .map((section) => ({ id: section.id, title: section.title, text: section.text }))
  const authoredBulletCount = proseAcceptance.reduce(
    (count, criterion) => count + String(criterion.text ?? '').split(/\r?\n/).filter(line => /^\s*[-*]\s*AC[- ]?\d+/i.test(line)).length,
    0,
  )
  // Older briefs can parse into only the first AC. Fall back to the complete
  // authored section when structured parsing omitted any stated bullet.
  let acceptanceCriteria = structuredAcceptance.length > 0 &&
    (authoredBulletCount === 0 || structuredAcceptance.length >= authoredBulletCount)
    ? structuredAcceptance
    : proseAcceptance
  // A once-legacy brief becomes canonical after its first refinement, while
  // its verified_by relations remain the established safety baseline. Only
  // expose those relations alongside authored ACs; a test link alone never
  // becomes a fabricated acceptance statement.
  const legacyTestCriteria = structuredAcceptance.length > 0
    ? asArray(source.verifiedBy).filter((id) => typeof id === 'string' && id.trim()).map((id) => {
      const test = source.trace?.nodes?.find(node => node.id === id && node.type === 'test')
      return { id, title: id, text: test?.title ? `既有验证基线：${test.title}` : `既有验证基线：${id}`, legacyBaseline: true }
    })
    : []
  if (legacyTestCriteria.length) {
    const existing = new Set(acceptanceCriteria.map((criterion) => criterion.id))
    acceptanceCriteria = [...legacyTestCriteria.filter((criterion) => !existing.has(criterion.id)), ...acceptanceCriteria]
  } else if (acceptanceCriteria.length === 0) {
    for (const id of source.verifiedBy ?? []) {
      const test = source.trace?.nodes?.find(node => node.id === id && node.type === 'test')
      if (test?.title) acceptanceCriteria.push({ id, title: id, text: test.title })
    }
  }
  acceptanceCriteria = sortAcceptanceCriteria(acceptanceCriteria)

  const focus = resolveFocus(source, summaries, decision)
  const attentionItems = buildAttentionItems(source, summaries, decision)

  const detail = {
    schema: DETAIL_VIEW_SCHEMA,
    identity: buildIdentity(source),
    context: {
      kind: focus.kind,
      headline: focus.headline,
      explanation: buildExplanation(source, summaries, decision, focus),
      tone: focus.tone,
      question: buildQuestion(source, summaries, focus),
      relatedRefs: buildRelatedRefs(summaries, relations),
    },
    primaryAction: null,
    secondaryActions: [],
    attentionItems,
    summaries,
    githubLinks,
    executionDiagnostic,
    tabs: {
      requirement: { badge: null },
      // Only items that need a human right now contribute, and a closed defect
      // is history rather than an alert.
      delivery: {
        badge: attentionItems.filter((entry) => entry.current === true && entry.kind !== 'defect-closed').length,
      },
      record: { badge: null },
    },
    content: {
      // Structured description for the detail view. `sections` is kept for the
      // legacy renderer; `doc` is the only source for FR/AC/pending.
      doc: docContentFor(docView),
      sections,
      missing,
      verifiedBy: asArray(source.verifiedBy).filter((id) => typeof id === 'string'),
      acceptanceCriteria,
      attachments: asArray(source.attachmentFiles).map((file) => ({
        name: textOrNull(file?.name),
        kind: textOrNull(file?.kind),
      })),
    },
    record: {
      timeline: timeline.slice(-50),
      timelineOmitted: Math.max(0, timeline.length - 50),
      timelineFingerprint: timeline.length > 50 ? timelineHash(timeline) : null,
      relations,
      github: buildGithub(source),
      githubLinks,
      architecture: source.architectureLedger && typeof source.architectureLedger === 'object'
        ? {
            path: textOrNull(source.architectureLedger.path),
            title: textOrNull(source.architectureLedger.title),
            baseline: asArray(source.architectureLedger.baseline).map(textOrNull).filter(Boolean),
            modules: asArray(source.architectureLedger.modules).map(entry => ({ path: textOrNull(entry?.path), role: textOrNull(entry?.role) })).filter(entry => entry.path),
            contracts: asArray(source.architectureLedger.contracts).map(textOrNull).filter(Boolean),
            verification: asArray(source.architectureLedger.verification).map(textOrNull).filter(Boolean),
          }
        : null,
      technical: {
        file: textOrNull(source.file),
        brief: textOrNull(source.brief),
        prompt: technicalPrompt(source),
      },
    },
    freshness: {
      readAt: new Date(now).toISOString(),
      requirementRevision: source.revision ?? null,
      briefPresent: Boolean(nonEmptyText(source.briefText)),
      candidateCurrent: summaries.candidate.exists ? summaries.candidate.current : null,
      acceptanceApplicable:
        boolOrNull(decision?.policy?.requiresAcceptance) ??
        boolOrNull(summaries.acceptance.registered),
      missing: [...missing],
    },
  }

  detail.primaryAction = primaryActionFor(detail)
  // A delivery label is not authority to sign: stale or inconsistent query
  // inputs must not offer an enabled human gate that the backend will reject.
  if (detail.primaryAction?.id === 'signoff' &&
      (summaries.candidate.current !== true || decision.state !== 'ready-for-human' || decision.signoff?.allowed === false)) {
    detail.primaryAction = { ...detail.primaryAction, enabled: false, reason: '需要当前有效的候选及允许人工验收的证据决策' }
  }
  detail.secondaryActions = secondaryActionsFor(detail)
  // Explicit human rejection is separate from signoff and ordinary continuation.
  detail.rejectionReview = source.rejectionReview ?? { allowed: false, binding: null }
  // Rendered by the isolated RejectCandidateControl, not the generic action dispatcher.
  const latest = source.acceptance?.latest
  const evidencePredatesRun = isLiveRun(detail.summaries.run) &&
    Date.parse(detail.summaries.acceptance.finishedAt ?? '') < Date.parse(detail.summaries.run.startedAt ?? '')
  const kind = detail.summaries.candidate.current === true &&
      ((detail.summaries.delivery.key === 'awaiting-acceptance' && decision?.state === 'ready-for-human') || detail.summaries.delivery.key === 'accepted')
    ? 'candidate-ready'
    : detail.context.kind === 'released' || detail.summaries.delivery.source === 'release' ? 'released-history'
    : detail.summaries.delivery.key === 'accepted' ? 'accepted'
      : evidencePredatesRun ? 'historical-during-run'
      : latest?.current === false ? 'outdated'
        : latest?.current === true && latest?.complete === true ? 'current' : 'unverified'
  const descriptions = {
    'released-history': [(detail.summaries.release?.githubVerified || detail.summaries.release?.mainMerged) ? '发布已核验，需求已关闭' : '本地发布记录已结束', (detail.summaries.release?.githubVerified || detail.summaries.release?.mainMerged) ? '代码与架构档案已合入 GitHub main 分支；后续工作区变化不会撤销历史记录，也不证明新版本已验收。' : '历史发布记录不会撤销；但缺少 GitHub 合并凭据，尚不能确认代码已进入 main，也不证明新版本已验收。'],
    accepted: ['这次交付已人工验收', '人工验收与技术检查分开记录；尚未执行的发布不能视为已发布。'],
    'candidate-ready': [`验证通过（交付候选 ${detail.summaries.candidate.id ?? '已就绪'} 已就绪）`, '当前候选已绑定需求、工作区和验收证据，等待人工签收。'],
    outdated: ['已有检查记录不再适用当前内容', '内容或测试版本已变化，需要重新验证，不能沿用旧结论。'],
    current: [latest?.result === 'pass' ? '当前已执行的技术检查通过' : '当前技术检查未通过', '技术检查仅证明实际执行的检查，不自动覆盖全部业务验收要求。'],
    'historical-during-run': ['上一轮历史检查已过期', '待本轮编码完成后重新验证。'],
    unverified: ['尚无当前版本完整验证结论', '缺少新鲜、完整的检查证据；不能默认通过业务验收。'],
  }
  const criterionStatus = deliverySettled && (detail.summaries.delivery.key === 'closed' || detail.summaries.delivery.key === 'accepted' || detail.summaries.release?.released === true)
    ? 'accepted'
    : detail.summaries.delivery.key === 'awaiting-acceptance' && detail.summaries.candidate.current === true
      ? 'verified'
      : 'unverified'
  const criterionReason = criterionStatus === 'accepted'
    ? '交付候选已通过验证并完成人工签收。'
    : criterionStatus === 'verified'
      ? '交付候选已通过当前验证，等待人工签收。'
      : '尚无逐项绑定的业务验收证据；整体命令通过不能代替此项核验。'
  detail.verificationSummary = {
    kind, headline: descriptions[kind][0], explanation: descriptions[kind][1],
    technicalResult: latest?.result ?? null,
    criteria: acceptanceCriteria.map((criterion) => ({ ...criterion, status: criterionStatus, evidence: null, reason: criterionReason })),
  }
  detail.currentMatter = currentMatterFor(source, detail)
  detail.primaryAction = detail.currentMatter.action
  // A timeout is a command/budget defect. Give the primary button an action
  // that actually re-derives the command, rather than only relabelling resume.
  const verificationCurrent = detail.summaries.acceptance.result === 'pass' &&
    detail.summaries.acceptance.current === true &&
    detail.summaries.acceptance.complete === true
  // Once fresh evidence is green, hand the button back to resume/candidate.
  // autoAdvance.reason still says verification-timeout until the run resumes.
  const timedOut = !verificationCurrent && (executionDiagnostic?.category === 'timeout' ||
    String(detail.summaries.run.autoAdvance?.reason ?? '') === 'verification-timeout')
  if (timedOut && !detail.summaries.run.active) {
    const narrowed = { id: 'narrow-verification', label: ACTION_LABELS['narrow-verification'],
      enabled: true, reason: null, target: { runId: detail.summaries.run.id ?? null } }
    detail.primaryAction = narrowed
    detail.currentMatter.action = narrowed
  }
  return detail
}
