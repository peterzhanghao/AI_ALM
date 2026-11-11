/**
 * Deterministic requirement affinity scoring for feedback that did not name a
 * REQ id.  This is deliberately model-free: callers may display its evidence
 * before deciding whether to converge an existing requirement or create one.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { indexReport } from '../commands.mjs'
import { parseDoc } from './doc.mjs'

const MAX_CONTEXT_FILE_BYTES = 512 * 1024
const STOP_WORDS = new Set(['需求', '功能', '用户', '需要', '可以', '这个', '那个', '我们', '希望', '进行', '相关', '问题', '修改', '调整', '补充', '现在', '支持'])
const ACTIVE = /^(?:proposed|draft|active|in.progress|in_progress|pending|waiting|ai|待推进|待验收|AI 推进中)$/i
const CLOSED = /(?:closed|done|released|archived|cancelled|已关闭|已完成|已发布|已归档|已取消)/i

const normalisePath = value => String(value ?? '').replaceAll('\\', '/').replace(/^\.\//, '').toLowerCase()
const unique = values => [...new Set(values.filter(Boolean))]

function words(value) {
  const text = String(value ?? '').toLowerCase()
  const result = new Set(text.match(/[a-z][a-z0-9_.\/-]{1,}|[\u4e00-\u9fff]{2,8}/g) ?? [])
  // Chinese is not whitespace-separated.  Overlapping short phrases make
  // "版本徽章" and "列表展示" useful anchors without a dictionary service.
  for (const sequence of text.match(/[\u4e00-\u9fff]{2,}/g) ?? []) {
    for (let size = 2; size <= Math.min(6, sequence.length); size++) {
      for (let index = 0; index <= sequence.length - size; index++) result.add(sequence.slice(index, index + size))
    }
  }
  return new Set([...result].filter(word => word.length > 1 && !STOP_WORDS.has(word)))
}

function pathsIn(value) {
  const source = String(value ?? '')
  return unique((source.match(/(?:[A-Za-z0-9_.-]+\/)+(?:[A-Za-z0-9_.-]+)(?:\.[A-Za-z0-9_-]+)?|[A-Za-z0-9_.-]+\.(?:mjs|cjs|js|ts|tsx|jsx|css|html|json|md|sdoc|ya?ml)/g) ?? [])
    .map(normalisePath)
    .filter(path => !path.startsWith('../') && !path.includes('/../')))
}

function overlap(left, right) {
  const shared = [...left].filter(value => right.has(value))
  return { shared, score: left.size === 0 ? 0 : shared.length / left.size }
}

function readSmallJson(path) {
  try {
    if (statSync(path).size > MAX_CONTEXT_FILE_BYTES) return null
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch { return null }
}

function walkJson(dir, output = []) {
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walkJson(path, output)
      else if (entry.isFile() && entry.name.endsWith('.json')) output.push(path)
    }
  } catch {}
  return output
}

function contextFor(root, asset) {
  const briefPath = typeof asset.extra?.brief === 'string' ? join(root, asset.extra.brief) : null
  let brief = ''
  if (briefPath && existsSync(briefPath)) {
    try { brief = readFileSync(briefPath, 'utf8') } catch {}
  }
  const doc = brief ? parseDoc(brief).doc : null
  const texts = [asset.title, brief, doc?.goal, doc?.problem, ...(doc?.acceptance ?? []).map(entry => entry.text)]
  const filePaths = [asset.source?.path, asset.extra?.brief, ...pathsIn(texts.join('\n'))]
  const attachmentDir = join(root, 'requirements', 'attachments', asset.id)
  for (const file of walkJson(attachmentDir)) {
    const json = readSmallJson(file)
    if (json) {
      const stringified = JSON.stringify(json)
      texts.push(stringified)
      filePaths.push(...pathsIn(stringified))
    }
  }
  // Candidate/run records are intentionally best-effort.  They are useful
  // lineage hints, never required state, and a malformed record is ignored.
  for (const dir of [join(root, '.alm', 'candidates'), join(root, '.alm', 'runs')]) {
    for (const file of walkJson(dir)) {
      const json = readSmallJson(file)
      const serialized = json ? JSON.stringify(json) : ''
      if (!serialized.includes(asset.id)) continue
      texts.push(serialized)
      filePaths.push(...pathsIn(serialized))
    }
  }
  let updatedAt = null
  for (const file of [briefPath, asset.source?.path ? join(root, asset.source.path) : null].filter(Boolean)) {
    try { updatedAt = Math.max(updatedAt ?? 0, statSync(file).mtimeMs) } catch {}
  }
  return { text: texts.filter(Boolean).join('\n'), paths: unique(filePaths.map(normalisePath)), updatedAt: updatedAt ? new Date(updatedAt).toISOString() : null }
}

function activityScore(asset, updatedAt, now) {
  const status = String(asset.status ?? '')
  const state = CLOSED.test(status) ? 0 : ACTIVE.test(status) ? 1 : 0.65
  const ageDays = updatedAt ? Math.max(0, (now - Date.parse(updatedAt)) / 86_400_000) : 180
  return (state * 0.7) + (Math.max(0, 1 - ageDays / 90) * 0.3)
}

function confidenceFor(score, semantic, file) {
  if (file >= 0.5 || semantic >= 0.20 || (score >= 0.60 && semantic >= 0.2)) return 'high'
  if ((score >= 0.28 || semantic >= 0.18) && semantic >= 0.1) return 'medium'
  return 'low'
}

/**
 * Score all requirement assets. `changedFiles` is optional and lets a file
 * watcher contribute lineage without manufacturing keywords in user feedback.
 */
export function matchRequirement({ root, text = '', changedFiles = [], assets = null, now = Date.now() } = {}) {
  const workspace = resolve(root ?? '.')
  const queryText = String(text ?? '').trim()
  const queryWords = words(queryText)
  const queryPaths = new Set(unique([...pathsIn(queryText), ...(Array.isArray(changedFiles) ? changedFiles : [])].map(normalisePath)))
  const requirementAssets = (assets ?? indexReport(workspace).assets ?? []).filter(asset => asset?.type === 'requirement')
  const candidates = requirementAssets.map(asset => {
    const context = contextFor(workspace, asset)
    const semantic = overlap(queryWords, words(context.text))
    const knownPaths = new Set(context.paths)
    const file = overlap(queryPaths, knownPaths)
    const activity = activityScore(asset, context.updatedAt, now)
    // Activity only breaks ties.  A new, unrelated feedback must remain low.
    // File lineage remains the largest single signal; an exact business
    // description still deserves a high-confidence match when no path was
    // mentioned (the normal cross-window feedback case).
    const score = Math.min(1, (file.score * 0.62) + (semantic.score * 0.55) + ((file.score > 0 || semantic.score > 0) ? activity * 0.08 : 0))
    const confidence = confidenceFor(score, semantic.score, file.score)
    const reasons = []
    if (file.shared.length) reasons.push(`文件血缘：${file.shared.slice(0, 3).join('、')}`)
    if (semantic.shared.length) reasons.push(`业务词：${semantic.shared.slice(0, 5).join('、')}`)
    if (confidence !== 'low') reasons.push(`${asset.status ?? '未标注状态'}；${context.updatedAt ? `最近更新 ${context.updatedAt.slice(0, 10)}` : '更新时间未知'}`)
    return { reqId: asset.id, title: asset.title, revision: Number(asset.extra?.revision ?? 1) || 1, score: Number(score.toFixed(3)), confidence, reason: reasons.join('；') || '未发现可复核的文件或业务词重合', dimensions: { file: Number(file.score.toFixed(3)), semantic: Number(semantic.score.toFixed(3)), activity: Number(activity.toFixed(3)) }, updatedAt: context.updatedAt }
  }).sort((left, right) => right.score - left.score || right.dimensions.file - left.dimensions.file || String(right.updatedAt ?? '').localeCompare(String(left.updatedAt ?? '')) || left.reqId.localeCompare(right.reqId))
  const winner = candidates[0] ?? null
  return {
    matchedReqId: winner?.confidence === 'low' ? null : winner?.reqId ?? null,
    matchedTitle: winner?.confidence === 'low' ? null : winner?.title ?? null,
    matchedReq: winner?.confidence === 'low' ? null : { id: winner?.reqId, title: winner?.title, revision: winner?.revision ?? 1 },
    confidence: winner?.confidence ?? 'low',
    reason: winner?.reason ?? '当前工作区没有可匹配的需求',
    candidates: candidates.slice(0, 5),
  }
}

export const matchFeedback = matchRequirement
