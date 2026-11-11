import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmdirSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { indexReport } from '../commands.mjs'
import { diffDoc, parseDoc } from './doc.mjs'
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
  if (typeof afterBrief !== 'string' || !afterBrief.trim() || afterBrief.length > 60000 || typeof evolutionNote !== 'string' || !evolutionNote.trim() || evolutionNote.length > 4000) fail('invalid-delta', '需要完整的需求正文和演进原因')
  const asset = currentAsset(root, requirementId)
  if (typeof asset.extra?.brief !== 'string' || !asset.extra.brief) fail('brief-missing', '需求缺少正文', 409)
  if (isAbsolute(asset.extra.brief)) fail('invalid-path', '需求正文路径无效')
  const rootReal = realpathSync(root)
  const briefReal = realpathSync(resolve(rootReal, asset.extra.brief))
  const rel = relative(rootReal, briefReal)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) fail('invalid-path', '需求正文路径越界')
  const beforeBrief = readFileSync(briefReal, 'utf8')
  const baseline = requirementBaseline({ root, asset })
  const beforeDoc = parseDoc(beforeBrief).doc
  const afterDoc = parseDoc(afterBrief).doc
  if (!afterDoc.goal || !afterDoc.problem || !afterDoc.acceptance.length) fail('invalid-delta', '变更后必须保留目标、问题和验收标准')
  if (beforeBrief === afterBrief) fail('empty-delta', '需求正文没有变化')
  const delta = { schema: 'alm.spec-delta/v1', runId, requirementId, kind, baseRequirementHash: baseline.contentHash, baseline, beforeBrief, afterBrief, acceptanceCriteria: { before: beforeDoc.acceptance, after: afterDoc.acceptance }, diff: diffDoc(beforeBrief, afterBrief), evolutionNote: evolutionNote.trim(), ...(sourceSession ? { sourceSession: String(sourceSession).slice(0, 200) } : {}), proposedAt: new Date().toISOString() }
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
