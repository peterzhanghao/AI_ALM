import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmdirSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { indexReport } from '../commands.mjs'
import { diffDoc, normalizeDoc, parseDoc, renderDoc } from './doc.mjs'
import { applyRequirementUpdate, readIdempotentResult, requirementBaseline } from './update.mjs'
import { readRun } from './run.mjs'

const fail = (code, message, status = 400) => { throw Object.assign(new Error(message), { code, status }) }
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const validRun = id => /^(?:RUN-\d+|SPEC-REQ-[A-Za-z0-9-]+)$/.test(String(id ?? ''))
export const requirementSpecContext = requirementId => {
  if (!/^REQ-[A-Za-z0-9-]+$/.test(String(requirementId ?? ''))) fail('unknown-requirement', '需求编号无效')
  return `SPEC-${requirementId}`
}
const retryPath = (root, id) => join(resolve(root), '.alm', 'iterations', `${requirementSpecContext(id)}.json`)
export function readIterationRetry(root, requirementId) {
  try { const row = JSON.parse(readFileSync(retryPath(root, requirementId), 'utf8')); return row?.schema === 'alm.iteration-retry/v1' && row.requirementId === requirementId && row.status === 'pending' ? row : null } catch { return null }
}
export function writeIterationRetry(root, requirementId, { feedbackText, status = 'pending', execution = null }) {
  const path = retryPath(root, requirementId)
  mkdirSync(join(resolve(root), '.alm', 'iterations'), { recursive: true })
  const row = { schema: 'alm.iteration-retry/v1', requirementId, feedbackText, status, execution, updatedAt: new Date().toISOString() }
  const temp = `${path}.${process.pid}-${Math.random().toString(36).slice(2)}.tmp`
  writeFileSync(temp, JSON.stringify(row), { flag: 'wx' })
  renameSync(temp, path)
  return row
}
const deltaPath = (root, id, seq = null) => join(resolve(root), '.alm', 'runs', `${id}-spec-delta${seq === null ? '' : `-${seq}`}.json`)
const deltaNames = (root, runId) => {
  try { return readdirSync(join(resolve(root), '.alm', 'runs')).filter(name => new RegExp(`^${runId}-spec-delta(?:-\\d+)?\\.json$`).test(name)) } catch { return [] }
}

function normalizeRequirementText(value) {
  return String(value ?? '')
    .replace(/\$\\(?:right)?arrow\$/g, '→')
    .replace(/(^|[^-])\s*->\s*/g, '$1 → ')
}

function frozenJsonEnd(text, offset) {
  if (text[offset] !== '{') return -1
  let depth = 0
  let quote = false
  let escaped = false
  for (let index = offset; index < text.length; index += 1) {
    const char = text[index]
    if (quote) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quote = false
      continue
    }
    if (char === '"') quote = true
    else if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return index + 1
    }
  }
  return -1
}

/** Remove old internal draft snapshots before they can become business prose. */
export function sanitizeRequirementBrief(value) {
  let text = normalizeRequirementText(value)
    .replace(/^\s*<!--\s*alm:meta\b[\s\S]*?-->\s*$/gim, '')
  const marker = /(?:^|\n)\s*冻结澄清正文\s*[:：]\s*/im.exec(text)
  if (marker) {
    const start = marker.index + marker[0].length
    const jsonStart = text.slice(start).search(/\S/)
    const absoluteStart = jsonStart < 0 ? -1 : start + jsonStart
    const end = absoluteStart >= 0 ? frozenJsonEnd(text, absoluteStart) : -1
    // A valid historical snapshot can be removed without swallowing a later
    // canonical acceptance section that was appended after it.
    if (end >= 0) {
      const tail = text.slice(end).replace(/^\s*人工补充验收\s*[:：]\s*\[\s*\]\s*/im, '')
      const prefix = text.slice(0, marker.index).trimEnd()
      text = tail.trim() ? `${prefix}\n\n${tail.trimStart()}` : prefix
    } else {
      text = text.slice(0, marker.index)
    }
  }
  return text.replace(/\n{3,}/g, '\n\n').trim() + '\n'
}

function feedbackPoints(feedback) {
  const source = normalizeRequirementText(feedback).replace(/\r\n?/g, '\n').trim()
  const collect = expression => {
    const points = []
    let current = null
    for (const line of source.split('\n')) {
      const match = line.match(expression)
      if (match) {
        points.push(match[1].trim())
        current = points.length - 1
      } else if (current !== null && line.trim()) {
        points[current] = `${points[current]} ${line.trim()}`.trim()
      }
    }
    return points.filter(Boolean)
  }
  const numbered = collect(/^\s*\d+[.、)]\s*(.+)$/)
  if (numbered.length > 1) return numbered
  const bulleted = collect(/^\s*[-*]\s+(.+)$/)
  if (bulleted.length > 1) return bulleted
  const directives = source.split(/[；;]\s*/).map(entry => entry.trim()).filter(Boolean)
  if (directives.length > 1 && directives.some(entry => /(?:AC-\d{2,}|TEST-[A-Z0-9-]+|改为|改成|替换|移除|删除|取消|不再支持)/iu.test(entry))) return directives
  // Long feedback copied from a design review often loses line breaks. A run
  // of labelled Chinese clauses remains a stable, readable unit in that case.
  const labelled = source
    .split(/(?<=[。！？])\s*(?=[^。！？\n]{2,80}[：:])/)
    .map(entry => entry.trim())
    .filter(Boolean)
  if (labelled.length > 1) {
    const grouped = []
    for (const entry of labelled) {
      // "Excel 模板" is part of the preceding export card rather than a
      // separate user journey. Preserve the user's four-card structure when
      // a rich-text feedback box flattens its original line breaks.
      if (/^Excel\s*模板/i.test(entry) && /^卡片一[（(]导出需求/.test(grouped.at(-1) ?? '')) grouped[grouped.length - 1] = `${grouped.at(-1)} ${entry}`
      else grouped.push(entry)
    }
    return grouped
  }
  return source ? [source] : []
}

const clone = value => JSON.parse(JSON.stringify(value ?? {}))
const normalizeClause = value => String(value ?? '').toLowerCase().replace(/[\s，,。；;：:、()（）【】\[\]"'`]/g, '')

function explicitCriterionId(text) {
  return String(text ?? '').match(/\b((?:AC-\d{2,}|TEST-[A-Z0-9-]+))\b/i)?.[1]?.toUpperCase() ?? null
}

function explicitCriterionIds(text) {
  return [...String(text ?? '').matchAll(/\b(?:AC-\d{2,}|TEST-[A-Z0-9-]+)\b/gi)].map(match => match[0].toUpperCase())
}

function feedbackTarget(point, acceptance) {
  const explicit = explicitCriterionId(point)
  if (explicit) return acceptance.find(entry => entry.id === explicit) ?? null
  const source = normalizeClause(point)
  let best = null
  for (const entry of acceptance) {
    const basis = normalizeClause([entry.text, entry.action, entry.expected, entry.judgement].filter(Boolean).join(' '))
    const score = ['json', 'excel', 'esc', '关闭', '导出', '导入', '弹窗'].reduce((total, token) => total + (source.includes(token) && basis.includes(token) ? 1 : 0), 0)
    if (score > 0 && (!best || score > best.score)) best = { entry, score }
  }
  return best?.score >= 2 ? best.entry : null
}

function clauseTextFromPoint(point, previous) {
  let text = normalizeRequirementText(point)
    .replace(/^\s*(?:[-*]|\d+[.、)])\s*/, '')
    .replace(/^\s*(?:AC-\d{2,}|TEST-[A-Z0-9-]+)\s*[:：]?\s*/i, '')
    .trim()
  // Feedback is an instruction to the convergence engine, not suitable
  // acceptance prose. Turn the common interaction changes into observable
  // business rules instead of storing "修改 AC-02 ..." verbatim.
  if ((/(?:Esc|ESC).*(?:关闭|关掉)|(?:关闭|关掉).*(?:Esc|ESC)/u.test(text) || /(?:Esc|ESC)/u.test(String(previous?.text ?? ''))) && /(?:去掉|不再|必须|点击)/u.test(text)) {
    return '弹窗只能通过点击明确的关闭按钮关闭；按 Esc 不会关闭弹窗，以避免误触。'
  }
  if (/不再支持.*(?:JSON|json).*(?:只(?:需要)?保留|仅(?:需)?保留).*(?:Excel|excel|xlsx)/u.test(text)) {
    return '导出区域只提供 Excel（.xlsx）导出，不再展示或生成 JSON 交换包；用户仍可导出全部需求或当前筛选结果。'
  }
  const replacement = /(?:改为|改成|替换为)\s*(.+)$/u.exec(text)?.[1]?.trim()
  if (replacement) return replacement
  if (/不再支持/u.test(text) && /(?:只(?:需要)?保留|仅(?:需)?保留)/u.test(text)) return text
  return text || previous?.text || ''
}

function appliesRemoval(point) {
  return /(?:移除|删除|废弃|取消)\s*(?:原有|该|此)?\s*(?:AC-|TEST-)?/iu.test(point) ||
    (/不再支持/u.test(point) && !/(?:只(?:需要)?保留|仅(?:需)?保留|改为|改成|替换)/u.test(point))
}

function appliesModification(point) {
  return /(?:改为|改成|替换|不再支持|调整|必须)/u.test(point)
}

function removesUnsupportedExclusiveClause(point, target) {
  const text = normalizeClause(point)
  const clause = normalizeClause([target?.text, target?.action, target?.expected].filter(Boolean).join(' '))
  return text.includes('不再支持导出json') && clause.includes('json') && !clause.includes('excel')
}

function feedbackImpact(feedback) {
  const impact = { goal: [], value: [] }
  for (const point of feedbackPoints(feedback)) {
    const text = normalizeRequirementText(point)
    if (/不再支持.*(?:JSON|json).*(?:只(?:需要)?保留|仅(?:需)?保留).*(?:Excel|excel|xlsx)/u.test(text)) {
      impact.goal.push('将文件导出聚焦为 Excel（.xlsx）流程。')
      impact.value.push('减少格式选择负担，让用户使用可直接编辑的 Excel 完成交换。')
    }
    if ((/(?:Esc|ESC).*(?:关闭|关掉)|(?:关闭|关掉).*(?:Esc|ESC)/u.test(text) || /(?:必须|点击).*(?:关闭|关掉)/u.test(text)) && /(?:去掉|不再|必须|点击)/u.test(text)) {
      impact.goal.push('让弹窗关闭动作保持明确且可预期。')
      impact.value.push('避免按 Esc 造成误触关闭，降低编辑过程丢失操作上下文的风险。')
    }
  }
  impact.goal = [...new Set(impact.goal)]
  impact.value = [...new Set(impact.value)]
  return impact
}

function narrativeWithImpact(current, proposed, additions) {
  const base = String(current ?? '').trim()
  // A complete LLM rewrite may be used when it is not simply echoing an
  // imperative feedback sentence. Explicit product-impact rules below still
  // win so goal/value/acceptance cannot drift apart.
  const candidate = String(proposed ?? '').trim()
  const next = candidate && normalizeClause(candidate) !== normalizeClause(base) &&
    !/(?:本轮调整|调整需求范围|修改\s*(?:AC-|TEST-)|本轮已按最新反馈)/u.test(candidate)
    ? candidate
    : base
  const missing = additions.filter(entry => !normalizeClause(next).includes(normalizeClause(entry)))
  if (!missing.length) return next
  return `${next}${next ? ' ' : ''}${missing.join(' ')}`.trim()
}

/**
 * Produce one complete, canonical requirement document for every convergence
 * entry point. Existing clauses survive by default; only explicit feedback
 * may replace or remove them.
 */
export function resynthesizeRequirementSpec({ beforeBrief, feedback = '', proposedBrief = null } = {}) {
  const before = parseDoc(sanitizeRequirementBrief(beforeBrief)).doc
  const proposed = typeof proposedBrief === 'string' && proposedBrief.trim()
    ? parseDoc(sanitizeRequirementBrief(proposedBrief)).doc
    : null
  const impact = feedbackImpact(feedback)
  const next = clone(before)
  next.title = proposed?.title || before.title
  next.goal = narrativeWithImpact(before.goal, proposed?.goal, impact.goal)
  next.problem = narrativeWithImpact(before.problem, proposed?.problem, impact.value)

  const proposedById = new Map((proposed?.acceptance ?? []).filter(entry => entry?.id).map(entry => [entry.id, entry]))
  let acceptance = before.acceptance.map(entry => clone(proposedById.get(entry.id) ?? entry))
  const known = new Set(acceptance.map(entry => entry.id).filter(Boolean))
  for (const entry of proposed?.acceptance ?? []) {
    if (!entry?.id || known.has(entry.id)) continue
    acceptance.push(clone(entry)); known.add(entry.id)
  }

  for (const point of feedbackPoints(feedback)) {
    const mergeIds = explicitCriterionIds(point)
    if (/合并/u.test(point) && mergeIds.length >= 2) {
      const [keeper, ...merged] = mergeIds
      const keepIndex = acceptance.findIndex(entry => entry.id === keeper)
      if (keepIndex >= 0) {
        const drafted = proposedById.get(keeper)
        acceptance[keepIndex] = { ...acceptance[keepIndex], ...(drafted ? clone(drafted) : {}), provenance: 'human-edit' }
        acceptance = acceptance.filter(entry => entry.id === keeper || !merged.includes(entry.id))
      }
      continue
    }
    const target = feedbackTarget(point, acceptance)
    if (target && (appliesRemoval(point) || removesUnsupportedExclusiveClause(point, target))) {
      acceptance = acceptance.filter(entry => entry.id !== target.id)
      continue
    }
    if (target && appliesModification(point)) {
      const index = acceptance.findIndex(entry => entry.id === target.id)
      const drafted = proposedById.get(target.id)
      acceptance[index] = { ...target, ...(drafted ? clone(drafted) : {}), text: clauseTextFromPoint(point, drafted ?? target), provenance: 'human-edit' }
      continue
    }
    // An AI-drafted new AC is already incorporated above. In an offline or
    // legacy path, each independent feedback point becomes one reviewable AC.
    if (!target && !proposed && point.trim()) acceptance.push({ text: clauseTextFromPoint(point), provenance: 'human-edit' })
  }
  next.acceptance = acceptance
  return renderDoc(normalizeDoc(next, { previous: before }))
}

/**
 * Convert a legacy brief with TEST-* relations but no canonical AC section
 * into a proposal the human can review. It does not update the requirement;
 * normal confirmation and baseline checks still apply in confirmSpecDelta.
 */
export function draftLegacyFeedbackBrief({ beforeBrief, feedback }) {
  const before = sanitizeRequirementBrief(beforeBrief)
  const doc = parseDoc(before).doc
  if (!doc.goal || !doc.problem) fail('legacy-brief-incomplete', '旧需求正文缺少目标或问题描述，无法生成收敛草案', 409)
  const points = feedbackPoints(feedback)
  if (!points.length) fail('feedback-invalid', '反馈中没有可生成验收标准的内容')
  return resynthesizeRequirementSpec({ beforeBrief: before, feedback })
}

function readDelta(root, runId, requirementId, deltaHash) {
  if (!validRun(runId) || !/^[a-f0-9]{64}$/.test(String(deltaHash ?? ''))) fail('delta-changed', '补丁标识无效', 409)
  for (const name of deltaNames(root, runId)) {
    try {
      const delta = JSON.parse(readFileSync(join(resolve(root), '.alm', 'runs', name), 'utf8'))
      if (digest(delta) === deltaHash && delta.schema === 'alm.spec-delta/v1' && delta.runId === runId && delta.requirementId === requirementId && delta.baseRequirementHash === delta.baseline?.contentHash) return { delta, patchId: name }
    } catch {}
  }
  fail('delta-changed', '补丁内容已变化，请重新确认', 409)
}

/** Return only unconsumed proposals for the current baseline. */
export function pendingSpecDeltas(root, requirementId, runId) {
  if (!validRun(runId)) return []
  let baseline
  try { baseline = requirementBaseline({ root, asset: currentAsset(root, requirementId) }) } catch { return [] }
  return deltaNames(root, runId).flatMap(name => {
    try {
      const delta = JSON.parse(readFileSync(join(resolve(root), '.alm', 'runs', name), 'utf8'))
      const deltaHash = digest(delta)
      if (delta.schema !== 'alm.spec-delta/v1' || delta.runId !== runId || delta.requirementId !== requirementId || delta.baseRequirementHash !== baseline.contentHash || delta.baseline?.relationHash !== baseline.relationHash) return []
      if (readIdempotentResult({ root, requirementId, idempotencyKey: `spec-${runId}-${deltaHash}` })) return []
      try { readFileSync(join(resolve(root), '.alm', 'runs', `${runId}-repair-${deltaHash}.json`)); return [] } catch (error) { if (error.code !== 'ENOENT') return [] }
      return [{ ...delta, patchId: name, patchHash: deltaHash }]
    } catch { return [] }
  }).sort((a, b) => String(b.proposedAt).localeCompare(String(a.proposedAt)))
}

/** A suggestion, never an authorization. Ambiguous feedback requires review. */
export function triageFeedback(feedback) {
  const text = String(feedback ?? '').trim()
  if (!text) fail('feedback-required', '反馈不能为空')
  if (/改为|改成|替换|不再|调整验收|取消原|pivot|instead/i.test(text)) return { kind: 'spec_pivot', requiresConfirmation: true }
  if (/新增|增加|补充|增加验收|界面调整|交互调整|refin/i.test(text)) return { kind: 'spec_refinement', requiresConfirmation: true }
  if (/不符合|未达到|错误|失效|无法|不显示|bug|broken|fails?/i.test(text)) return { kind: 'bug_fix', requiresConfirmation: false }
  return { kind: 'needs_review', requiresConfirmation: true }
}

function currentAsset(root, id) {
  const assets = indexReport(resolve(root))?.assets ?? []
  const matches = assets.filter(asset => asset.id === id && asset.type === 'requirement')
  if (matches.length !== 1) fail('unknown-requirement', '需求不存在或编号不唯一', 404)
  return matches[0]
}

function checkedRun(root, runId, requirementId) {
  if (!validRun(runId)) fail('invalid-run', '运行编号无效')
  if (runId === requirementSpecContext(requirementId)) { currentAsset(root, requirementId); return null }
  const run = readRun(root, runId)
  if (!run || run.requirement !== requirementId || ['cancelled'].includes(run.status)) fail('invalid-run', '运行与需求不匹配', 409)
  return run
}

/** Persist an immutable proposal; exclusive creation allocates distinct sequences. */
export function proposeSpecDelta({ root, runId, requirementId, afterBrief, evolutionNote, kind, sourceSession = null }) {
  checkedRun(root, runId, requirementId)
  if (!['spec_refinement', 'spec_pivot'].includes(kind)) fail('invalid-triage', '仅需求演进可生成补丁')
  const normalizedAfterBrief = normalizeRequirementText(afterBrief)
  const normalizedEvolutionNote = normalizeRequirementText(evolutionNote)
  if (typeof afterBrief !== 'string' || !normalizedAfterBrief.trim() || normalizedAfterBrief.length > 60000 || typeof evolutionNote !== 'string' || !normalizedEvolutionNote.trim() || normalizedEvolutionNote.length > 4000) fail('invalid-delta', '需要完整的需求正文和演进原因')
  const asset = currentAsset(root, requirementId)
  if (typeof asset.extra?.brief !== 'string' || !asset.extra.brief) fail('brief-missing', '需求缺少正文', 409)
  if (isAbsolute(asset.extra.brief)) fail('invalid-path', '需求正文路径无效')
  const rootReal = realpathSync(root)
  const briefReal = realpathSync(resolve(rootReal, asset.extra.brief))
  const rel = relative(rootReal, briefReal)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) fail('invalid-path', '需求正文路径越界')
  const beforeBrief = readFileSync(briefReal, 'utf8')
  const resynthesizedAfterBrief = resynthesizeRequirementSpec({ beforeBrief, feedback: evolutionNote, proposedBrief: normalizedAfterBrief })
  const baseline = requirementBaseline({ root, asset })
  const beforeDoc = parseDoc(beforeBrief).doc
  const afterDoc = parseDoc(resynthesizedAfterBrief).doc
  if (!afterDoc.goal || !afterDoc.problem || !afterDoc.acceptance.length) fail('invalid-delta', '变更后必须保留目标、问题和验收标准')
  if (sanitizeRequirementBrief(beforeBrief) === resynthesizedAfterBrief) fail('empty-delta', '需求正文没有变化')
  const delta = { schema: 'alm.spec-delta/v1', runId, requirementId, kind, baseRequirementHash: baseline.contentHash, baseline, beforeBrief, afterBrief: resynthesizedAfterBrief, acceptanceCriteria: { before: beforeDoc.acceptance, after: afterDoc.acceptance }, diff: diffDoc(beforeBrief, resynthesizedAfterBrief), evolutionNote: normalizedEvolutionNote.trim(), ...(sourceSession ? { sourceSession: String(sourceSession).slice(0, 200) } : {}), proposedAt: new Date().toISOString() }
  mkdirSync(join(resolve(root), '.alm', 'runs'), { recursive: true })
  for (let seq = 1; seq <= 100000; seq++) {
    const path = deltaPath(root, runId, seq)
    try {
      writeFileSync(path, `${JSON.stringify(delta, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
      return { delta, deltaHash: digest(delta), path: `.alm/runs/${runId}-spec-delta-${seq}.json` }
    } catch (error) { if (error.code !== 'EEXIST') throw error }
  }
  fail('delta-limit', '本轮补丁数量已达上限', 409)
}

/** Apply only the exact human-confirmed proposal to its original baseline. */
export function confirmSpecDelta({ root, runId, requirementId, deltaHash, baseRequirementHash, subject }) {
  if (subject?.kind !== 'human' || !/^human:[A-Za-z0-9._-]+$/.test(String(subject.id ?? ''))) fail('human-required', '需要可信人类确认', 403)
  checkedRun(root, runId, requirementId)
  if (!/^[A-Za-z0-9-]+$/.test(String(requirementId ?? ''))) fail('unknown-requirement', '需求编号无效')
  const lock = join(resolve(root), '.alm', 'runs', `.spec-${requirementId}.lock`)
  try { mkdirSync(lock) } catch (error) { if (error.code === 'EEXIST') fail('spec-busy', '需求正在收敛，请稍后重试', 409); throw error }
  try {
  const { delta } = readDelta(root, runId, requirementId, deltaHash)
  try { readFileSync(join(resolve(root), '.alm', 'runs', `${runId}-repair-${deltaHash}.json`)); fail('delta-consumed', '补丁已按修复处理', 409) } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (delta.schema !== 'alm.spec-delta/v1' || delta.runId !== runId || delta.requirementId !== requirementId || !/^[a-f0-9]{64}$/.test(String(deltaHash ?? '')) || digest(delta) !== deltaHash || delta.baseRequirementHash !== delta.baseline?.contentHash) fail('delta-changed', '补丁内容已变化，请重新确认', 409)
  const asset = currentAsset(root, requirementId)
  const current = requirementBaseline({ root, asset })
  if ((baseRequirementHash !== undefined && baseRequirementHash !== delta.baseRequirementHash) || current.contentHash !== delta.baseRequirementHash || current.relationHash !== delta.baseline.relationHash) fail('stale-baseline', '需求基线已变化，请重新生成补丁', 409)
  const result = applyRequirementUpdate({ root, asset, change: { field: 'brief', value: delta.afterBrief }, expectedBaseline: delta.baseline, actor: subject.id, idempotencyKey: `spec-${runId}-${deltaHash}`, impactSummary: { kind: 'spec_converged', runId, deltaHash, evolutionNote: delta.evolutionNote } })
  return { result, deltaHash }
  } finally { rmdirSync(lock) }
}

/** Consume the exact proposal as a code-only repair without changing the brief. */
export function markSpecDeltaRepair({ root, runId, requirementId, deltaHash, baseRequirementHash, subject }) {
  if (subject?.kind !== 'human' || !/^human:[A-Za-z0-9._-]+$/.test(String(subject.id ?? ''))) fail('human-required', '需要可信人类确认', 403)
  checkedRun(root, runId, requirementId)
  if (!/^[A-Za-z0-9-]+$/.test(String(requirementId ?? ''))) fail('unknown-requirement', '需求编号无效')
  const lock = join(resolve(root), '.alm', 'runs', `.spec-${requirementId}.lock`)
  try { mkdirSync(lock) } catch (error) { if (error.code === 'EEXIST') fail('spec-busy', '需求正在收敛，请稍后重试', 409); throw error }
  try {
    const { delta, patchId } = readDelta(root, runId, requirementId, deltaHash)
    const current = requirementBaseline({ root, asset: currentAsset(root, requirementId) })
    if (baseRequirementHash !== delta.baseRequirementHash || current.contentHash !== baseRequirementHash || current.relationHash !== delta.baseline.relationHash) fail('stale-baseline', '需求基线已变化，请重新生成补丁', 409)
    if (readIdempotentResult({ root, requirementId, idempotencyKey: `spec-${runId}-${deltaHash}` })) fail('delta-consumed', '补丁已经合入', 409)
    const receipt = { schema: 'alm.spec-repair/v1', requirementId, runId, patchId, deltaHash, baseRequirementHash, actor: subject.id, at: new Date().toISOString() }
    try { writeFileSync(join(resolve(root), '.alm', 'runs', `${runId}-repair-${deltaHash}.json`), `${JSON.stringify(receipt, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' }) } catch (error) { if (error.code === 'EEXIST') fail('delta-consumed', '补丁已按修复处理', 409); throw error }
    return { receipt, feedbackText: delta.evolutionNote }
  } finally { rmdirSync(lock) }
}

/** History derives only from successful idempotency receipts, never proposals. */
export function listSpecConvergences(root, requirementId) {
  const dir = join(resolve(root), '.alm', 'runs')
  let names
  try { names = readdirSync(dir) } catch { return [] }
  return names.filter(name => /^(?:RUN-\d+|SPEC-REQ-[A-Za-z0-9-]+)-spec-delta(?:-\d+)?\.json$/.test(name)).flatMap(name => {
    try {
      const delta = JSON.parse(readFileSync(join(dir, name), 'utf8'))
      if (delta.requirementId !== requirementId) return []
      const hash = digest(delta)
      const key = `spec-${delta.runId}-${hash}`
      const stored = readIdempotentResult({ root, requirementId, idempotencyKey: key })
      if (stored?.applied !== true || stored.requirement !== requirementId) return []
      return [{ at: delta.proposedAt, kind: 'spec_converged', runId: delta.runId, deltaHash: hash, evolutionNote: delta.evolutionNote, sourceSession: delta.sourceSession ?? null, beforeRevision: stored.before?.revision ?? null, revision: stored.revision ?? null, initialConfirmedAt: stored.before?.revision === 1 ? parseDoc(delta.beforeBrief).doc?.meta?.confirmedAt ?? null : null, diff: delta.diff, acceptanceCriteria: delta.acceptanceCriteria, beforeDocument: (() => { const d = parseDoc(delta.beforeBrief).doc; return { title: d.title, goal: d.goal, problem: d.problem } })(), afterDocument: (() => { const d = parseDoc(delta.afterBrief).doc; return { title: d.title, goal: d.goal, problem: d.problem } })() }]
    } catch { return [] }
  })
}
