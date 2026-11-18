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
import { clausesFromBrief, matchRejections, readRejections, recallClauses, tokenize as reviewTokenize } from './review.mjs'

const CJK = /[\u3400-\u9fff]/
const CJK_RUN = /[\u3400-\u9fff]+/g
const ASCII_WORD = /[a-z0-9][a-z0-9_-]{1,}/g
const QUOTED = /[「“"'`]([^」”"'`]{2,60})[」”"'`]/g
const MAX_SECTION = 4000

function clampLimit(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return DEFAULT_LIMIT
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(number)))
}

/**
 * Words and CJK n-grams, used for explainable local matching.
 *
 * Delegates to the review module so there is exactly one Chinese tokenizer in
 * the codebase. The old run-based splitter here disagreed with the one in
 * `requirements/matcher.mjs`, which is how two “duplicate” requests ended up
 * scoring zero against each other.
 */
export function tokensOf(text) {
  return reviewTokenize(text)
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

/**
 * Why-hit lists are read by humans, so they must not expose the tokenizer.
 * `tokensOf` emits overlapping CJK 2- and 3-grams, which is right for scoring
 * and wrong as a sentence: a title match used to print
 * "dsh、需求、插件、需求插、求插件". What a reader wants is the phrase the two
 * texts actually share, so pick the longest non-overlapping ones instead.
 * Nothing three characters or longer means there is nothing worth quoting.
 */
function sharedPhrases(query, candidate, limit = 4) {
  const needle = String(query ?? '').toLowerCase()
  const haystack = String(candidate ?? '').toLowerCase()
  if (!needle || !haystack) return []
  const spans = []
  for (let size = 12; size >= 3; size -= 1) {
    for (let index = 0; index + size <= needle.length; index += 1) {
      if (spans.length >= limit) break
      const window = needle.slice(index, index + size)
      if (/\s/.test(window)) continue
      let from = 0
      while (from <= haystack.length - size) {
        const at = haystack.indexOf(window, from)
        if (at === -1) break
        if (!spans.some(([start, end]) => at < end && start < at + size)) {
          spans.push([at, at + size])
          break
        }
        from = at + 1
      }
    }
    if (spans.length >= limit) break
  }
  const texts = spans.sort((left, right) => left[0] - right[0]).map(([start, end]) => haystack.slice(start, end))
  // A shorter span that is contained in a longer one is the same match, not a
  // second reason: 「需求插件」 already says 「需求插」 and 「求插件」.
  return [...new Set(texts.filter((text) => !texts.some((other) => other !== text && other.includes(text))))]
}

function classify({ score, titleHits, phraseHit }) {
  // `conflict` is no longer produced here. Negation regex over the whole query
  // (“…而不是需要我复制粘贴报错”) fired on the word 不 alone and labelled every
  // requirement whose title shared a keyword as a conflict. Polarity now comes
  // from clause adjudication, which reads it near the predicate.
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

  const score =
    titleHits.length * 3 + briefHits.length * 1.5 + acceptanceHits.length * 1 + phraseHits.length * 6 + (businessHit ? 8 : 0)
  const reasons = []
  if (businessHit) reasons.push(`意图中提到了业务 ID ${businessId}`)
  for (const phrase of phraseHits.slice(0, 3)) reasons.push(`出现与标题/简报一致的短语「${phrase}」`)
  const titleShared = sharedPhrases(lowerQuery, title)
  if (titleShared.length) reasons.push(`标题与你的说法共用「${titleShared.join('」「')}」`)
  const briefShared = sharedPhrases(lowerQuery, brief.text)
  if (briefShared.length) reasons.push(`简报与你的说法共用「${briefShared.join('」「')}」`)
  const acceptanceShared = sharedPhrases(lowerQuery, acceptanceText)
  if (acceptanceShared.length) reasons.push(`验收与你的说法共用「${acceptanceShared.join('」「')}」`)
  if (reasons.length === 0) reasons.push('与意图仅有弱关联')

  const match = classify({ score, titleHits: titleHits.length, phraseHit: phraseHits.length > 0 })
  if (!match) return null

  return {
    asset,
    match,
    score,
    reasons,
    briefExcerpt: redact(brief.text, 240),
    acceptance,
    clauses: clausesFromBrief({
      uid: String(asset?.id ?? ''),
      title,
      revision: Number(asset?.extra?.revision ?? 1),
      briefText: brief.text,
    }),
  }
}

function readSetEntry({ root, asset, match, reasons, briefExcerpt, acceptance, clauseMatches = null }) {
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
    // Clause-level evidence. A requirement with five acceptance clauses whose
    // overlap is one clause must say *which* clause, otherwise the user cannot
    // adjudicate the duplicate claim.
    clauseMatches: clauseMatches ?? [],
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
      rejections: [],
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
      // Clause-level adjudication decides *which* clause overlaps and whether it
      // is covered/partial/conflict. It may only strengthen the keyword match,
      // never weaken it: a keyword hit is still evidence worth showing.
      const clauseMatches = entry.clauses?.length
        ? recallClauses({ text: materialText, clauses: entry.clauses, limit: 3 })
            .filter((match) => match.verdict !== 'unrelated')
        : []
      let match = entry.match
      if (clauseMatches.length > 0) {
        // Clause evidence wins outright, in both directions. A keyword hit on a
        // title must not be able to promote a `partial` clause review into
        // `covered`, because the user then sees “已覆盖” for something that is
        // only adjacent.
        let best = 'related'
        for (const clauseMatch of clauseMatches) {
          if (clauseMatch.verdict === 'conflict') best = 'conflict'
          else if (clauseMatch.verdict === 'covered' && best !== 'conflict') best = 'covered'
        }
        match = best
      } else {
        match = entry.score >= 12 ? 'related' : 'uncertain'
      }
      const reasons = [...entry.reasons]
      for (const clauseMatch of clauseMatches.slice(0, 2)) {
        reasons.push(`条款 ${clauseMatch.clauseId ?? ''}：${clauseMatch.reasons[0] ?? clauseMatch.verdict}`)
      }
      readSet.push(
        readSetEntry({
          root,
          asset: entry.asset,
          match,
          reasons,
          briefExcerpt: entry.briefExcerpt,
          acceptance: entry.acceptance,
          clauseMatches,
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

  // The rejection ledger is a third source of truth: a request that was already
  // rejected must not be rediscovered every month as if it were new.
  let rejections = []
  if (queryStatus === 'success') {
    try {
      rejections = matchRejections({ text: materialText, rejections: readRejections(root), limit: 3 })
    } catch {
      rejections = []
    }
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
    rejections,
    selected: selected
      ? { uid: selected.uid, revision: selected.revision, contentHash: selected.contentHash, title: selected.title, businessId: selected.businessId }
      : null,
    boundary,
  }
}

export { CONTEXT_POLICY }
