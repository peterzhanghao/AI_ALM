/**
 * Build the read-only context an intent analysis is allowed to cite.
 *
 * The context is deliberately conservative: it reports what was *read* and how
 * each requirement matched, and it never claims "no duplicate" when the query
 * failed. `queryStatus: 'error'` is a first-class outcome because the product
 * rule is “相关需求尚未核对” — success and failure must not look alike.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { indexReport } from '../commands.mjs'
import { requirementContentHash } from '../model/content-hash.mjs'
import { readProject } from '../project/project.mjs'
import {
  CONTEXT_POLICY,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  intentError,
  intentError as _intentError,
} from './errors.mjs'
import { asString, canonicalJson, dateFrom, nowIso, sha256Hex, truncateText } from './util.mjs'

const CJK = /[\u3400-\u9fff]/
const CJK_RUN = /[\u3400-\u9fff]+/g
const ASCII_WORD = /[a-z0-9][a-z0-9_-]{1,}/g
const QUOTED = /[「“"'`]([^」”"'`]{2,60})[」”"'`]/g
const NEGATION = /不需要|不用|不再|不必|无需|不是|取消|废弃|替换掉/
const MAX_SECTION = 4000

function clampLimit(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return DEFAULT_LIMIT
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(number)))
}

/** Words and CJK 2-grams; used only for local, explainable matching. */
export function tokensOf(text) {
  const lower = asString(text, 200000).toLowerCase()
  const tokens = new Set()
  for (const match of lower.matchAll(ASCII_WORD)) tokens.add(match[0])
  for (const match of lower.matchAll(CJK_RUN)) {
    const run = match[0]
    if (run.length <= 12) tokens.add(run)
    for (let index = 0; index + 1 < run.length; index += 1) tokens.add(run.slice(index, index + 2))
  }
  return tokens
}

function phrasesOf(text) {
  const phrases = []
  for (const match of asString(text, 200000).matchAll(QUOTED)) {
    const phrase = match[1].trim().toLowerCase()
    if (phrase.length >= 2) phrases.push(phrase)
  }
  return phrases
}

function hitTokens(tokens, candidateText) {
  if (!candidateText) return []
  const lower = String(candidateText).toLowerCase()
  const hits = []
  for (const token of tokens) {
    if (token.length < 2 && !CJK.test(token)) continue
    if (lower.includes(token)) hits.push(token)
  }
  return hits
}

function redact(text, max) {
  return asString(text, max).replace(/\s+/g, ' ').trim()
}

/** Read a brief file (repo-relative). Failure is silent: it becomes a blind spot. */
export function readBrief({ root, asset }) {
  const briefPath = asset?.extra?.brief
  if (!briefPath) return { path: null, text: '', missing: false }
  const absolute = join(root, briefPath)
  try {
    if (!existsSync(absolute)) return { path: briefPath, text: '', missing: true }
    return { path: briefPath, text: readFileSync(absolute, 'utf8'), missing: false }
  } catch {
    return { path: briefPath, text: '', missing: true }
  }
}

/** Pull acceptance-like text out of a brief's “验收”/“目标” section. */
function briefAcceptanceLines(briefText) {
  const lines = []
  let capture = false
  for (const raw of String(briefText ?? '').split(/\r?\n/)) {
    const line = raw.trim()
    if (/^#{1,6}\s*/.test(line)) {
      capture = /验收|目标|期望|结果/.test(line.replace(/^#{1,6}\s*/, ''))
      continue
    }
    if (!capture) continue
    if (line === '' || line.startsWith('-') === false && line.length < 4) continue
    const clean = line.replace(/^[-*]\s*/, '')
    if (clean) lines.push(redact(clean, 200))
    if (lines.length >= 6) break
  }
  return lines
}

function readAcceptance({ root, asset, byId }) {
  const items = []
  for (const link of asset?.links ?? []) {
    if (link?.type !== 'verified_by' || typeof link.target !== 'string') continue
    const test = byId.get(link.target)
    if (test?.title) items.push(redact(test.title, 200))
  }
  const brief = readBrief({ root, asset })
  if (brief.text) items.push(...briefAcceptanceLines(brief.text))
  return [...new Set(items)].slice(0, 6)
}

function assetProject(asset) {
  const project = asset?.extra?.project
  if (typeof project === 'string' && project !== '') return project
  const id = String(asset?.id ?? '')
  const match = /^(?:REQ|TEST|ADR|MOD|IF|DM|RISK)-([A-Z0-9]{2,8})-\d{3,}$/.exec(id)
  return match ? match[1] : null
}

function matchesProject(asset, projectId) {
  if (!projectId) return true
  return assetProject(asset) === projectId || String(asset?.id ?? '').startsWith(`REQ-${projectId}-`)
}

function contentHashOf({ root, asset }) {
  try {
    return requirementContentHash({ root, asset })
  } catch {
    return sha256Hex({ id: asset?.id, title: asset?.title, revision: asset?.extra?.revision ?? 1 })
  }
}

function classify({ score, titleHits, phraseHit, conflict }) {
  if (conflict) return 'conflict'
  if (score >= 6 && (titleHits > 0 || phraseHit)) return 'covered'
  if (score >= 3) return 'related'
  if (score > 0) return 'uncertain'
  return null
}

function scoreAsset({ asset, byId, tokens, phrases, lowerQuery, root }) {
  const title = String(asset?.title ?? '')
  const businessId = asset?.extra?.businessId ?? null
  const brief = readBrief({ root, asset })
  const acceptance = readAcceptance({ root, asset, byId })
  const acceptanceText = acceptance.join(' ')

  const titleHits = hitTokens(tokens, title)
  const briefHits = hitTokens(tokens, brief.text)
  const acceptanceHits = hitTokens(tokens, acceptanceText)
  const phraseHits = phrases.filter(
    (phrase) => title.toLowerCase().includes(phrase) || brief.text.toLowerCase().includes(phrase),
  )
  const businessHit = businessId && lowerQuery.includes(String(businessId).toLowerCase())
  const conflict = NEGATION.test(lowerQuery) && titleHits.length > 0

  const score =
    titleHits.length * 3 + briefHits.length * 1.5 + acceptanceHits.length * 1 + phraseHits.length * 6 + (businessHit ? 8 : 0)
  const reasons = []
  if (businessHit) reasons.push(`意图中提到了业务 ID ${businessId}`)
  for (const phrase of phraseHits.slice(0, 3)) reasons.push(`出现与标题/简报一致的短语「${phrase}」`)
  if (titleHits.length) reasons.push(`标题命中关键词：${titleHits.slice(0, 6).join('、')}`)
  if (briefHits.length) reasons.push(`简报命中关键词：${briefHits.slice(0, 6).join('、')}`)
  if (acceptanceHits.length) reasons.push(`验收文本命中关键词：${acceptanceHits.slice(0, 6).join('、')}`)
  if (conflict) reasons.push('意图中出现否定/取消语义，同时与现有需求标题重合，需确认是替换还是新需求')
  if (reasons.length === 0) reasons.push('与意图仅有弱关联')

  const match = classify({ score, titleHits: titleHits.length, phraseHit: phraseHits.length > 0, conflict })
  if (!match) return null

  return {
    asset,
    match,
    score,
    reasons,
    briefExcerpt: redact(brief.text, 240),
    acceptance,
  }
}

function readSetEntry({ root, asset, match, reasons, briefExcerpt, acceptance }) {
  return {
    uid: String(asset.id),
    businessId: asset?.extra?.businessId ?? null,
    revision: Number(asset?.extra?.revision ?? 1),
    title: String(asset?.title ?? ''),
    file: asset?.source?.path ?? null,
    contentHash: contentHashOf({ root, asset }),
    match,
    reasons,
    briefExcerpt: briefExcerpt ?? '',
    acceptance: acceptance ?? [],
  }
}

/** Normalize the injectable reader into `{assets}` or throw a coded failure. */
function runReader({ reader, root, projectId }) {
  const input = { root, projectId }
  if (reader === undefined || reader === null) {
    const index = indexReport(root)
    if (!index) throw intentError('context-read-failed', '需求索引不可用')
    if (index.ok === false && !Array.isArray(index.assets)) {
      throw intentError('context-read-failed', '需求索引读取失败', { errors: index.errors ?? [] })
    }
    return { assets: Array.isArray(index.assets) ? index.assets : [], errors: index.errors ?? [] }
  }

  let result
  if (typeof reader === 'function') result = reader(input)
  else if (typeof reader.read === 'function') result = reader.read(input)
  else if (typeof reader.load === 'function') result = reader.load(input)
  else result = reader

  if (result && typeof result.then === 'function') {
    throw intentError('context-read-failed', 'reader 必须是同步的；异步读取请在调用方 await 后传入结果', {
      reason: 'async-reader',
    })
  }
  if (result === null || result === undefined) {
    throw intentError('context-read-failed', 'reader 未返回任何结果')
  }
  if (Array.isArray(result)) return { assets: result, errors: [] }
  const status = String(result.status ?? '').toLowerCase()
  if (result.ok === false || status === 'error' || status === 'timeout' || status === 'failed') {
    const failure = result.error ?? result.failure ?? {}
    throw intentError(
      'context-read-failed',
      asString(failure.message ?? result.message ?? '需求检索失败，相关需求尚未核对', 300),
      { readerStatus: status || 'error', readerCode: failure.code ?? result.code ?? null },
      Number.isInteger(result.statusCode) ? result.statusCode : 503,
    )
  }
  if (!Array.isArray(result.assets)) throw intentError('context-read-failed', 'reader 返回结构缺少 assets 数组')
  return { assets: result.assets, errors: result.errors ?? [] }
}

function snapshotId({ projectId, queryStatus, selected, readSet }) {
  const hash = sha256Hex({
    policy: CONTEXT_POLICY,
    projectId: projectId ?? null,
    queryStatus,
    selected: selected ? { uid: selected.uid, revision: selected.revision, contentHash: selected.contentHash } : null,
    readSet: readSet.map((entry) => ({ uid: entry.uid, revision: entry.revision, contentHash: entry.contentHash })),
  })
  return `ctx-${hash.slice(0, 16)}`
}

/**
 * Build the context snapshot for one intent text.
 *
 * @param {object} input
 * @param {string} input.root repo root
 * @param {string} [input.projectId] project id; defaults to `.alm/project.json`
 * @param {string} [input.selectedRequirementId] requirement the user explicitly anchored
 * @param {string} [input.intentText] the user's own words
 * @param {string} [input.extractedText] bounded OCR/chat transcript
 * @param {number} [input.limit=8] max read-set entries
 * @param {Function|object} [input.reader] injectable synchronous reader for tests/timeouts
 */
export function buildIntentContext({
  root,
  projectId,
  selectedRequirementId,
  intentText,
  extractedText,
  limit = DEFAULT_LIMIT,
  reader,
  now,
} = {}) {
  if (!root || typeof root !== 'string') throw intentError('invalid-request', 'buildIntentContext 需要 root')
  let project = null
  try {
    project = readProject(root)
  } catch {
    project = null
  }
  const resolvedProjectId = String(projectId ?? project?.id ?? '').trim() || null
  if (projectId && project?.id && projectId !== project.id) {
    throw intentError('project-mismatch', `projectId ${projectId} 与 .alm/project.json（${project.id}）不一致`)
  }

  const queryText = asString(intentText ?? '', 4000)
  const materialText = [queryText, asString(extractedText ?? '', 20000)].filter(Boolean).join('\n')
  const cleanedLimit = clampLimit(limit)
  const generatedAt = nowIso(now)
  const selectedId = String(selectedRequirementId ?? '').trim() || null

  if (materialText.trim() === '') {
    return {
      policy: CONTEXT_POLICY,
      contextSnapshotId: snapshotId({ projectId: resolvedProjectId, queryStatus: 'not-queried', selected: null, readSet: [] }),
      projectId: resolvedProjectId,
      generatedAt,
      queryStatus: 'not-queried',
      query: {
        text: '',
        matched: 0,
        total: 0,
        truncated: false,
        failure: null,
      },
      readSet: [],
      selected: null,
      boundary: {
        scope: 'project',
        projectId: resolvedProjectId,
        limit: cleanedLimit,
        total: 0,
        truncated: false,
        statement: '尚未提供意图文本，相关需求尚未核对。',
        caution: '本会话没有查询过需求库，不能据此判断“全新/无重复”。',
      },
    }
  }

  let assets
  let queryStatus = 'success'
  let failure = null
  try {
    const loaded = runReader({ reader, root, projectId: resolvedProjectId })
    assets = Array.isArray(loaded.assets) ? loaded.assets : []
  } catch (error) {
    queryStatus = 'error'
    failure = {
      // Preserve the underlying reader code when present (tests inject failures).
      code: error?.details?.readerCode ?? error?.code ?? 'context-read-failed',
      message: asString(error?.message ?? '需求检索失败，相关需求尚未核对', 300),
      at: generatedAt,
    }
    assets = []
  }

  const requirements = assets.filter(
    (asset) => asset && asset.type === 'requirement' && typeof asset.id === 'string' && matchesProject(asset, resolvedProjectId),
  )
  const byId = new Map(assets.filter((asset) => asset && typeof asset.id === 'string').map((asset) => [asset.id, asset]))

  let selectedAsset = null
  if (selectedId) {
    selectedAsset = requirements.find((asset) => asset.id === selectedId) ?? null
    if (!selectedAsset && queryStatus === 'success') {
      throw intentError('unknown-requirement', `未找到需求 ${selectedId}，无法把它作为上下文锚点`, {
        requirementId: selectedId,
      })
    }
  }

  const readSet = []
  if (queryStatus === 'success') {
    const tokens = tokensOf(materialText)
    const phrases = phrasesOf(materialText)
    const lowerQuery = materialText.toLowerCase()
    const scored = []
    for (const asset of requirements) {
      const result = scoreAsset({ asset, byId, tokens, phrases, lowerQuery, root })
      if (result) scored.push(result)
    }
    scored.sort((left, right) => right.score - left.score || String(left.asset.id).localeCompare(String(right.asset.id)))
    const selectedEntry = selectedAsset
      ? readSetEntry({
          root,
          asset: selectedAsset,
          match: 'covered',
          reasons: ['用户在上下文中明确指定了该需求', `标题：${selectedAsset.title ?? ''}`],
          briefExcerpt: redact(readBrief({ root, asset: selectedAsset }).text, 240),
          acceptance: readAcceptance({ root, asset: selectedAsset, byId }),
        })
      : null
    const seen = new Set(selectedEntry ? [selectedEntry.uid] : [])
    for (const entry of scored) {
      if (seen.has(entry.asset.id)) continue
      if (readSet.length + (selectedEntry ? 1 : 0) >= cleanedLimit) break
      seen.add(entry.asset.id)
      readSet.push(
        readSetEntry({
          root,
          asset: entry.asset,
          match: entry.match,
          reasons: entry.reasons,
          briefExcerpt: entry.briefExcerpt,
          acceptance: entry.acceptance,
        }),
      )
    }
    if (selectedEntry) readSet.unshift(selectedEntry)
  }

  const matchedCandidates = readSet.length
  const total = requirements.length
  const truncated = matchedCandidates < (queryStatus === 'success' ? total : 0) && matchedCandidates >= cleanedLimit
  const selected = readSet.find((entry) => entry.uid === selectedId) ?? null

  const statement =
    queryStatus === 'error'
      ? `需求检索失败（${failure?.code ?? 'context-read-failed'}），相关需求尚未核对。`
      : `已核对项目 ${resolvedProjectId ?? '当前项目'} 内 ${total} 条需求，命中 ${matchedCandidates} 条（上限 ${cleanedLimit} 条${truncated ? '，已截断' : ''}）。`

  const boundary = {
    scope: 'project',
    projectId: resolvedProjectId,
    limit: cleanedLimit,
    total,
    truncated,
    statement,
    caution:
      queryStatus === 'error'
        ? '检索失败不代表不存在相关需求；本结论不能用于声称“全新/无重复”。'
        : '匹配基于标题、业务 ID、简报与验收文本的关键词/短语，仅为提示，不等同于需求已确认或冲突已排除。',
  }

  return {
    policy: CONTEXT_POLICY,
    contextSnapshotId: snapshotId({ projectId: resolvedProjectId, queryStatus, selected, readSet }),
    projectId: resolvedProjectId,
    generatedAt,
    queryStatus,
    query: {
      text: truncateText(materialText, 500).text,
      matched: matchedCandidates,
      total,
      truncated,
      failure,
    },
    readSet,
    selected: selected
      ? { uid: selected.uid, revision: selected.revision, contentHash: selected.contentHash, title: selected.title, businessId: selected.businessId }
      : null,
    boundary,
  }
}

export { CONTEXT_POLICY }
