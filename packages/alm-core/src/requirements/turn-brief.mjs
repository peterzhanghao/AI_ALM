import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { declaredModulesOf, loadModuleRegistry, verificationPathsFor } from './architecture-impact.mjs'

/**
 * Turn brief compiler.
 *
 * A delivery turn used to be dispatched as a rigid template whose two most
 * important fields (goal, acceptance) were struct fields of the requirement.
 * For a requirement stored as metadata + a short brief those fields are empty,
 * so the agent received placeholders plus a 59-file authorization list and had
 * to reverse-engineer the intent. That is the whole reason a five-line change
 * took twenty-two minutes.
 *
 * The compiler fixes the information deficit at its source:
 *   L0 — intent is taken from the requirement text itself (brief first), and a
 *        requirement without a goal or acceptance is refused instead of being
 *        dispatched with placeholders.
 *   L1 — the brief is a short, human-shaped instruction: goal, current vs
 *        expected, anchors (at most three), boundary, verification, done.
 *        It is hard-capped so it can never grow back into a file dump.
 */
export const BRIEF_BUDGET = 900
export const MAX_ANCHORS = 3
export const BRIEF_SCHEMA = 'alm.turn-brief/v1'

export class BriefRejected extends Error {
  constructor(message, { code = 'brief-insufficient', detail = [] } = {}) {
    super(message)
    this.name = 'BriefRejected'
    this.code = code
    this.detail = detail
  }
}

const text = (value) => (typeof value === 'string' ? value.trim() : '')
const squash = (value) => text(value).replace(/\s+/g, ' ')
const unique = (values) => [...new Set(values.map(text).filter(Boolean))]
// A brief is a contract, not a document dump: every extracted line is capped so
// a pasted 60k-character legacy body can never become the instruction.
const GOAL_LIMIT = 200
const CRITERION_LIMIT = 160
const MAX_CRITERIA = 8
const clampText = (value, limit) => (value.length > limit ? `${value.slice(0, limit - 1)}…` : value)

/** Read the requirement brief file; it is the requirement's real prose body. */
export function readBriefText({ root, asset = null, item = null, requirementId = null } = {}) {
  const direct = text(item?.briefText)
  if (direct) return direct
  const declared = text(asset?.extra?.brief ?? item?.brief)
  const candidates = [declared]
  // Conventional fallback: a caller that only has the index item (no brief
  // pointer) still resolves the same file the module would have declared.
  if (!declared && requirementId) {
    candidates.push(`requirements/briefs/${requirementId}.md`, `requirements/briefs/${String(requirementId).toLowerCase()}.md`)
  }
  for (const relative of candidates.filter(Boolean)) {
    const file = join(resolve(root), relative)
    if (!existsSync(file)) continue
    try { return readFileSync(file, 'utf8') } catch {}
  }
  return ''
}

const GOAL_LINE = /^\s*(?:[-*]\s*)?(?:#+\s*)?(?:核心)?(?:目标|目的|问题|背景)\s*[:：]\s*(.+)$/
const ACCEPT_LINE = /^\s*(?:[-*]\s*)?(?:#+\s*)?(?:验收标准|验收要求|验收)\s*[:：]\s*(.+)$/
const AC_ID_LINE = /^\s*(?:[-*]\s*)?(AC-\d+)\s*[:：.、\s]\s*(.+)$/
const CONSTRAINT_LINE = /^\s*(?:[-*]\s*)?(?:约束|范围外|不做)\s*[:：]\s*(.+)$/

/**
 * L0: extract the intent. `goalSource` records where it came from so the UI can
 * show why a requirement is (or is not) dispatchable.
 *
 * Both shapes occur in practice: an inline list (`- 目标：…`) and a Markdown
 * section (`## 目标` followed by a paragraph). Missing either one is a real
 * "cannot dispatch" case, not something to paper over with the title.
 */
export function extractIntent({ briefText = '', doc = null, title = '' } = {}) {
  const lines = String(briefText ?? '').split(/\r?\n/)
  const goalLines = []
  const acceptance = []
  const constraints = []
  let section = null
  const openSection = (heading) => {
    const value = squash(heading).replace(/[:：]\s*$/, '')
    if (/^(?:核心)?(?:目标|目的|问题|背景)$/.test(value)) return 'goal'
    if (/^(?:验收标准|验收要求|验收)$/.test(value)) return 'acceptance'
    if (/^(?:约束|范围外|不做|非目标)$/.test(value)) return 'constraint'
    return null
  }
  for (const line of lines) {
    const heading = /^\s*#+\s*(.+?)\s*$/.exec(line)
    if (heading) { section = openSection(heading[1]); continue }
    const goal = GOAL_LINE.exec(line)
    if (goal) { goalLines.push(clampText(squash(goal[1]), GOAL_LIMIT)); continue }
    const accept = ACCEPT_LINE.exec(line)
    if (accept) { acceptance.push({ id: null, text: clampText(squash(accept[1]), CRITERION_LIMIT) }); continue }
    const acId = AC_ID_LINE.exec(line)
    if (acId) { acceptance.push({ id: acId[1], text: clampText(squash(acId[2]), CRITERION_LIMIT) }); continue }
    const constraint = CONSTRAINT_LINE.exec(line)
    if (constraint) { constraints.push(squash(constraint[1])); continue }
    const body = squash(line.replace(/^\s*[-*]\s*/, ''))
    if (!body || body.startsWith('<!--')) continue
    if (section === 'goal' && goalLines.length === 0) goalLines.push(clampText(body, GOAL_LIMIT))
    else if (section === 'acceptance' && acceptance.length < MAX_CRITERIA) acceptance.push({ id: null, text: clampText(body, CRITERION_LIMIT) })
    else if (section === 'constraint') constraints.push(body)
  }
  const docAcceptance = (Array.isArray(doc?.acceptance) ? doc.acceptance : [])
    .map((entry, index) => ({
      id: text(entry?.id) || `AC-${String(index + 1).padStart(2, '0')}`,
      text: clampText(squash(entry?.text ?? entry?.content), CRITERION_LIMIT),
    }))
    .filter((entry) => entry.text)
  const docGoal = clampText(squash(doc?.goal ?? doc?.problem), GOAL_LIMIT)
  let goal = goalLines[0] ?? ''
  let goalSource = goal ? 'brief' : null
  if (!goal && docGoal) { goal = docGoal; goalSource = 'doc' }
  const criteria = docAcceptance.length ? docAcceptance : acceptance
  const acceptanceSource = docAcceptance.length ? 'doc' : (acceptance.length ? 'brief' : null)
  return {
    goal,
    goalSource,
    extraGoals: goalLines.slice(1),
    acceptance: criteria.map((entry, index) => ({
      id: entry.id ?? `AC-${String(index + 1).padStart(2, '0')}`,
      text: entry.text,
    })),
    acceptanceSource,
    constraints,
    title: squash(title),
  }
}

/** Concrete files worth pointing at: changed files first, then module signals. */
function resolveAnchors({ root, subject, registry, handoff }) {
  const declared = declaredModulesOf(subject)
  const entries = []
  const tests = []
  for (const id of declared) {
    const mod = registry.byId?.get(id)
    if (!mod) continue
    entries.push(...(mod.entries ?? []))
    entries.push(...mod.paths.filter((path) => !path.endsWith('/')))
    tests.push(...(mod.tests ?? []))
  }
  // One seat is reserved for a focused test: it states the current expected
  // behaviour more precisely than any prose. Reserve it before filling seats,
  // otherwise a handoff carrying three changed files silently evicts it.
  const test = unique(tests)[0] ?? null
  const changedCap = test ? Math.max(0, MAX_ANCHORS - 1) : MAX_ANCHORS
  const picked = unique(handoff?.changedFiles ?? []).slice(0, changedCap)
  if (test && !picked.includes(test)) picked.push(test)
  for (const path of unique(entries)) { if (picked.length >= MAX_ANCHORS) break; if (!picked.includes(path)) picked.push(path) }
  return picked.slice(0, MAX_ANCHORS)
}

function searchHints({ subject, registry }) {
  const hints = []
  for (const id of declaredModulesOf(subject)) {
    const mod = registry.byId?.get(id)
    if (!mod) continue
    for (const path of mod.paths) if (path.endsWith('/')) hints.push(path)
  }
  return [...new Set(hints)].slice(0, 2)
}

function commandLines(commands) {
  const lines = []
  for (const entry of commands ?? []) {
    const raw = typeof entry === 'string' ? entry : entry?.command
    if (!raw) continue
    const rendered = Array.isArray(raw)
      ? raw.map((part) => (/\s/.test(String(part)) ? `"${part}"` : String(part))).join(' ')
      : String(raw).trim()
    if (rendered) lines.push(rendered)
  }
  return [...new Set(lines)]
}

function phaseInstruction(phase) {
  if (phase === 'plan') {
    return [
      '本轮只做方案，不写代码、不改文件、不跑测试。',
      '输出三条：① 要改的文件与位置；② 具体改动；③ 风险或不确定点。',
      '等你看到确认后再进入实现。',
    ]
  }
  return null
}

function doneCriteria({ phase, commands }) {
  if (phase === 'plan') return '完成标志：给出上述三条方案后停止。'
  if (!commands.length) return '完成标志：改动落在锚点内，说明验证情况后停止。'
  return '完成标志：验证命令退出码为 0 且改动只落在锚点内，然后报告改动文件与结果并停止。'
}

/**
 * L1: compile the brief. Throws BriefRejected when the requirement cannot be
 * dispatched honestly; never returns a placeholder-filled prompt.
 */
export function compileTurnBrief({
  root, requirementId, asset = null, item = null, docView = null,
  commands = [], phase = 'implement', answer = null, handoff = null,
  override = null, registry = null, facts = null, runId = null, degraded = false,
} = {}) {
  if (text(override)) {
    const body = String(override).trim()
    return { schema: BRIEF_SCHEMA, text: body, meta: { override: true, chars: body.length, phase }, fingerprint: fingerprintOf(body) }
  }
  const reg = registry ?? loadModuleRegistry(root)
  const doc = docView?.doc && typeof docView.doc === 'object' ? docView.doc : (item?.docView?.doc ?? asset?.doc ?? null)
  const title = text(item?.title ?? doc?.title ?? asset?.title)
  const briefText = readBriefText({ root, asset, item, requirementId })
  const intent = extractIntent({ briefText, doc, title })
  const subject = (asset && Array.isArray(asset.links) && asset.links.length) ? asset : (item ?? asset ?? {})
  const cmds = commandLines(commands)
  const moduleTests = verificationPathsFor(declaredModulesOf(subject), reg)
  const effectiveCommands = cmds.length
    ? cmds
    : (moduleTests.length ? [`node --test ${moduleTests.join(' ')}`] : (facts?.commandLines ?? []).filter(Boolean))

  const missing = []
  if (!intent.goal) missing.push('目标')
  if (intent.acceptance.length === 0) missing.push('验收标准')
  if (missing.length) {
    // A first dispatch is refused. A resume or repair of a run that is already
    // in flight must not strand work, so it continues on a degraded contract
    // that states the gap instead of inventing content.
    if (degraded) return degradedBrief({ requirementId, title, intent, missing, phase, commands: effectiveCommands, answer, runId })
    throw new BriefRejected(
      `${requirementId} 缺少${missing.join('与')}，不能派发；请在需求简报中补充后再交给 AI 推进`,
      { detail: missing },
    )
  }

  const anchors = resolveAnchors({ root, subject, registry: reg, handoff: handoff ?? facts?.handoff ?? null })
  const hints = searchHints({ subject, registry: reg })
  const decision = text(answer) || text((facts?.humanAnswers ?? []).at(-1)) || null
  const progress = handoff ?? facts?.handoff ?? null

  const sections = []
  sections.push(`# ${requirementId}${title ? ` — ${title}` : ''}`)
  sections.push(`目标：${intent.goal}`)
  if (intent.extraGoals.length) sections.push(`补充：${intent.extraGoals.join('；')}`)
  sections.push(`验收：${intent.acceptance.map((entry) => `${entry.id} ${entry.text}`).join('；')}`)
  if (intent.constraints.length) sections.push(`约束：${intent.constraints.join('；')}`)
  if (decision) sections.push(`已确认的决策：${squash(decision)}`)
  const evidence = squash(facts?.evidence)
  if (evidence) sections.push(`上次验证：${evidence}`)
  if (progress?.summary) sections.push(`当前进度：${squash(progress.summary)}`)
  else if (phase === 'implement') sections.push('当前进度：从零开始，尚无已落盘改动。')
  if (anchors.length) sections.push(`先读这些文件：${anchors.join('、')}`)
  if (hints.length) sections.push(`需要更多上下文时在 ${hints.join('、')} 内搜索，不要全仓扫描。`)
  sections.push('边界：只改与目标直接相关的文件，不要重构、不要顺手改无关代码。')
  // Verification is a capability, not a checklist. The registered commands stay
  // in the receipt and in `meta.commands` (where the white-box view reads
  // them); the turn itself carries one stable alias, so the brief length is
  // independent of how many test files a module happens to own.
  sections.push(`验证：完成后运行 pnpm -s alm verify ${requirementId} 自查；不要展开文件清单，也不要跑全量测试。`)
  const plan = phaseInstruction(phase)
  if (plan) sections.push(...plan)
  if (runId) sections.push(`只有全新的业务分歧才写 .alm/runs/${runId}-decision.md，其余自行决定。`)
  sections.push(doneCriteria({ phase, commands: effectiveCommands }))

  const full = sections.join('\n')
  const brief = shrink(full, { sections, anchors, intent })
  return {
    schema: BRIEF_SCHEMA,
    text: brief.text,
    meta: {
      chars: brief.text.length,
      budget: BRIEF_BUDGET,
      trimmed: brief.trimmed,
      goalSource: intent.goalSource,
      acceptanceSource: intent.acceptanceSource,
      anchors,
      commands: effectiveCommands,
      // Where the alias will actually resolve: a registered config is the
      // authority, module tests are the derived fallback. `none` means the
      // agent will be told to register one first.
      verificationSource: cmds.length ? 'registered' : (moduleTests.length ? 'module-tests' : (effectiveCommands.length ? 'facts' : 'none')),
      modules: declaredModulesOf(subject),
      phase,
    },
    fingerprint: fingerprintOf(brief.text),
  }
}

/**
 * Budget is a gate, not a suggestion: drop the least valuable content in a
 * fixed order so the brief can never creep back into a wall of text.
 */
function shrink(full, { sections, anchors }) {
  if (full.length <= BRIEF_BUDGET) return { text: full, trimmed: [] }
  const trimmed = []
  // 1. Drop the progress line: it is helpful, never essential.
  const withoutProgress = sections.filter((section) => !section.startsWith('当前进度：'))
  if (withoutProgress.length !== sections.length) trimmed.push('进度')
  if (withoutProgress.join('\n').length <= BRIEF_BUDGET) return { text: withoutProgress.join('\n'), trimmed }
  // 2. Shorten acceptance text and drop the reading hints.
  const lean = []
  for (const section of withoutProgress) {
    if (section.startsWith('验收：') && section.length > 240) {
      trimmed.push('验收细节')
      lean.push(`${section.slice(0, 238)}…`)
      continue
    }
    if (section.startsWith('先读这些文件：') || section.startsWith('需要更多上下文时')) {
      trimmed.push('锚点')
      continue
    }
    lean.push(section)
  }
  if (lean.join('\n').length <= BRIEF_BUDGET) return { text: lean.join('\n'), trimmed }
  // 3. Minimal contract: goal, acceptance, one anchor, verification, done.
  const minimal = [
    sections[0],
    sections.find((section) => section.startsWith('目标：')),
    sections.find((section) => section.startsWith('验收：'))?.slice(0, 200),
    anchors.length ? `先读这些文件：${anchors.slice(0, 1).join('、')}` : null,
    sections.find((section) => section.startsWith('验证：')),
    sections.find((section) => section.startsWith('完成标志')),
  ].filter(Boolean).join('\n')
  trimmed.push('已压缩到最小契约')
  return { text: minimal.slice(0, BRIEF_BUDGET), trimmed }
}

/** Honest fallback for a run in flight whose requirement never registered a goal. */
function degradedBrief({ requirementId, title, intent, missing, phase, commands, answer, runId }) {
  const lines = [`# ${requirementId}${title ? ` — ${title}` : ''}`]
  lines.push(`注意：需求尚未登记${missing.join('与')}，本轮只能依据下列已确认信息推进，不要臆造业务规则。`)
  if (intent.goal) lines.push(`目标：${intent.goal}`)
  if (answer) lines.push(`已确认的决策：${squash(answer)}`)
  if (runId) lines.push(`遇到全新业务分歧时写 .alm/runs/${runId}-decision.md，不要自行决定。`)
  // Same single line as the full contract: a degraded brief differs in what it
  // admits about intent, never in how verification is invoked.
  lines.push(`验证：完成后运行 pnpm -s alm verify ${requirementId} 自查；不要展开文件清单，也不要跑全量测试。`)
  lines.push(doneCriteria({ phase, commands }))
  const body = lines.join('\n')
  return { schema: BRIEF_SCHEMA, text: body, meta: { degraded: true, missing, chars: body.length, phase }, fingerprint: fingerprintOf(body) }
}

function fingerprintOf(value) {
  return createHash('sha256').update(String(value ?? '')).digest('hex')
}

/**
 * Preview used by the UI: the human sees exactly what will be sent (or why it
 * cannot be sent) before spending a single model turn.
 */
export function previewTurnBrief(options = {}) {
  try {
    const compiled = compileTurnBrief(options)
    return { ok: true, ...compiled }
  } catch (error) {
    if (error instanceof BriefRejected) {
      return { ok: false, code: error.code, reason: error.message, detail: error.detail, text: null, meta: null }
    }
    throw error
  }
}
