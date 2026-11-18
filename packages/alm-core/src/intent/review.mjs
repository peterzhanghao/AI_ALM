/**
 * Requirement review: clause fingerprints, three-channel recall, pairwise
 * adjudication and the rejection ledger.
 *
 * Why this module exists
 * ----------------------
 * The old matcher treated “is this a duplicate?” as a similarity-sorting
 * problem and used the top score as the verdict. That fails in both directions:
 * 「导出 CSV」/「导入 CSV」 are lexically identical but unrelated, while
 * 「自动修复」/「自愈」 are lexically disjoint but the same requirement.
 * Similarity is a *recall* signal. The verdict has to be a separate judgement
 * over structured evidence, which is what this file provides.
 *
 * Design rules
 * ------------
 * 1. The unit of judgement is a **clause** (AC-xx / FR-xx), never a whole
 *    requirement: one overlapping clause out of five would be diluted away.
 * 2. Recall uses three channels — lexical (CJK n-grams), structural (fingerprint
 *    fields), semantic (embedding, optional). The semantic channel reports
 *    `unavailable` instead of pretending a number when no embedder is wired.
 * 3. Every verdict carries human-readable `reasons` and a `diff`, so the user
 *    can disagree with the machine. A verdict nobody can audit is worse than no
 *    verdict.
 * 4. Nothing here writes requirements. Rejections and observations go to their
 *    own append-only ledgers.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const CLAUSE_SCHEMA = 'alm.clause.fingerprint/v1'
export const REJECTION_SCHEMA = 'alm.rejection/v1'
export const OBSERVATION_SCHEMA = 'alm.observation/v1'

export const REJECTION_DIR = '.alm/rejections'
export const OBSERVATION_DIR = '.alm/intent/observations'

/** Verdict vocabulary. `partial` maps onto the store's `related` match label. */
export const CLAUSE_VERDICTS = ['covered', 'partial', 'conflict', 'unrelated']
export const EVIDENCE_CLASSES = ['observed', 'stated', 'inferred']

const CJK_RUN = /[\u3400-\u9fff]+/g
const ASCII_WORD = /[a-z0-9][a-z0-9_.\-/]{1,}/g

/** Words that carry no discriminating power in this domain. */
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this',
  '需求', '功能', '用户', '我们', '需要', '可以', '这个', '那个', '进行', '相关', '问题',
  '支持', '实现', '一个', '以及', '或者', '如果', '然后', '当前', '现在', '同时', '已经',
])

/** Action vocabulary. Aliases map onto one canonical action. */
const ACTION_ALIASES = [
  ['覆盖', /覆盖|改写|改回|改掉|冲掉|篡改|override/i],
  ['提炼', /提炼|总结出|生成标题|归纳/i],
  ['生成', /生成|产出|写出|自动写出/i],
  ['记录', /记录|登记|留痕|记账|入账|写入|落到|存到/i],
  ['截断', /截断|省略|收起|折叠/i],
  ['校验', /校验|验证|核查|检查|核对|预检/i],
  ['拦截', /拦截|阻止|拦住|阻断/i],
  ['展示', /展示|显示|呈现|露出|可见/i],
  ['导出', /导出|export/i],
  ['导入', /导入|import/i],
  ['删除', /删除|移除|清空|清除/i],
  ['新建', /新建|创建|新增|加一条/i],
  ['更新', /更新|修改|编辑|调整|变更/i],
  ['合并', /合并|归并|合到一起/i],
  ['拆分', /拆分|拆开|分裂/i],
  ['重启', /重启|重新启动|reload/i],
  ['修复', /修复|自愈|自动恢复|自动解决|修好/i],
  ['分类', /分类|归类|分诊/i],
  ['统计', /统计|汇总|计数/i],
  ['排序', /排序|重排/i],
  ['通知', /通知|提醒|推送/i],
  ['确认', /确认|采纳|批准/i],
]

/** Negation only. “必须/应当” is a strength marker, not a reversal, so it is
 * deliberately not part of polarity: allow vs require is never a conflict. */
const DENY_MARKERS = /不得|禁止|不允许|不要|不能|不再|不必|无需|切勿|严禁|别把|千万别|不应/

const CONDITION_MARKERS = /^(?:当|如果|若|一旦|只要|在)/

/**
 * Domain keyword channel. N-grams dilute badly when a one-sentence request is
 * compared against a long acceptance clause, and the semantic channel is
 * unavailable without an embedder, so a curated vocabulary carries the recall
 * that pure n-grams lose. Deliberately small and explicit: a keyword list you
 * can read is auditable, a 400-dim vector is not.
 */
const DOMAIN_KEYWORDS = [
  '失败', '超时', '报错', '错误', '异常', '崩溃', '澄清', '追问', '提问', '需求', '验收', '标题',
  '覆盖', '重启', '修复', '自愈', '缺陷', '台账', '证据', '模型', '指纹', '重复', '查重', '否决',
  '拒绝', '拆分', '合并', '追加', '优先级', '预算', '链接', '导出', '导入', '表格', '字段',
  '按钮', '页面', '状态', '历史', '记录', '日志', '条目', '草案', '确认', '审批', '通知',
  '权限', '登录', '性能', '延迟', '缓存', '搜索', '筛选', '排序', '统计', '报表', '附件',
]

function keywordsOf(text) {
  const haystack = String(text ?? '')
  const found = new Set()
  for (const keyword of DOMAIN_KEYWORDS) if (haystack.includes(keyword)) found.add(keyword)
  return found
}

function keywordOverlap(left, right) {
  const a = left instanceof Set ? left : keywordsOf(left)
  const b = right instanceof Set ? right : keywordsOf(right)
  if (a.size === 0 || b.size === 0) return 0
  let common = 0
  for (const keyword of a) if (b.has(keyword)) common += 1
  return common / (a.size + b.size - common)
}

function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[\s\u3000]+/g, ' ')
    .replace(/[，。；：、！？,.;:!?"'“”‘’（）()【】\[\]<>《》]/g, ' ')
    .trim()
}

/**
 * CJK is tokenized into 2- and 3-grams plus ASCII words.
 *
 * The previous implementation matched whole CJK runs (`[\u4e00-\u9fff]{2,8}`),
 * which greedily swallowed entire sentences, so two phrasings of the same
 * request shared no token at all. N-grams make recall monotonic in shared
 * wording, which is the only property we actually need from this channel.
 */
export function tokenize(text) {
  const lower = normalize(text)
  const tokens = new Set()
  for (const match of lower.matchAll(ASCII_WORD)) {
    if (match[0].length >= 2) tokens.add(match[0])
  }
  for (const match of lower.matchAll(CJK_RUN)) {
    const run = match[0]
    for (let index = 0; index + 1 < run.length; index += 1) tokens.add(run.slice(index, index + 2))
    for (let index = 0; index + 2 < run.length; index += 1) tokens.add(run.slice(index, index + 3))
  }
  for (const stop of STOP_WORDS) tokens.delete(stop)
  return tokens
}

/** Overlap coefficient weighted towards 3-grams (more specific → more weight). */
export function similarity(left, right) {
  const a = left instanceof Set ? left : tokenize(left)
  const b = right instanceof Set ? right : tokenize(right)
  if (a.size === 0 || b.size === 0) return 0
  let hit = 0
  let total = 0
  for (const token of a) {
    const weight = token.length >= 3 ? 1.4 : 1
    total += weight
    if (b.has(token)) hit += weight
  }
  if (total === 0) return 0
  return hit / total
}

function actionOf(text) {
  const found = []
  for (const [canonical, pattern] of ACTION_ALIASES) {
    if (pattern.test(text)) found.push(canonical)
  }
  return found
}

function polarityOf(text, actionMatches = []) {
  // Polarity belongs to a *predicate*, not to a whole sentence. 「要自动记录，
  // 不要让我手工复制」 is an affirmative request with a subordinate negation;
  // reading the whole string as `deny` made every such request look like a
  // conflict with its own acceptance clause. So look near the verb first.
  const haystack = String(text ?? '')
  const windows = []
  if (actionMatches.length > 0) {
    for (const match of actionMatches) {
      const start = Math.max(0, match.index - 16)
      windows.push(haystack.slice(start, match.index + match[0].length + 6))
    }
  } else {
    windows.push(haystack)
  }
  for (const window of windows) {
    if (DENY_MARKERS.test(window)) return 'deny'
  }
  return 'allow'
}

function actionMatchesOf(text) {
  const matches = []
  for (const [, pattern] of ACTION_ALIASES) {
    const flags = pattern.flags.includes('g') ? pattern : new RegExp(pattern.source, `${pattern.flags}g`)
    for (const match of String(text ?? '').matchAll(flags)) {
      matches.push(match)
      break
    }
  }
  return matches.sort((left, right) => left.index - right.index)
}

function conditionOf(text) {
  const cleaned = String(text ?? '').replace(/^#+\s*/, '').replace(/^-\s*/, '')
  const index = cleaned.search(/当|如果|若|一旦|只要/)
  if (index < 0) return ''
  const tail = cleaned.slice(index)
  const end = tail.search(/[，,。；;]/)
  return (end > 0 ? tail.slice(0, end) : tail).slice(0, 60)
}

function objectOf(text, actions) {
  // Objects in Chinese sit on either side of the verb (“把标题改回去” /
  // “覆盖该标题”). Extraction is deliberately cheap and returns *candidates*;
  // the comparison then takes the best pair, so a wrong guess on one side does
  // not decide the verdict on its own.
  let working = String(text ?? '').replace(/^#+\s*/, '').replace(/^-\s*/, '').replace(/^AC-?\d+[:：\s]*/i, '')
  working = normalize(working)
  working = working.replace(/^(?:当|如果|若|一旦|只要)\S*?\s/, '')
  if (actions.length === 0) return { primary: working.slice(0, 40), candidates: [working.slice(0, 40)] }
  const candidates = []
  for (const [, pattern] of ACTION_ALIASES) {
    const match = pattern.exec(working)
    if (!match) continue
    candidates.push(...objectCandidatesAround(working, match.index, match[0].length))
    if (candidates.length >= 6) break
  }
  const cleaned = [...new Set(candidates.filter((entry) => entry.length >= 1))]
  return { primary: cleaned[0] ?? '', candidates: cleaned.slice(0, 6) }
}

const OBJECT_BOUNDARY = /[把被对给的了过又别不要得能可会让使将从到和与或及在时后前是]/

function objectCandidatesAround(working, index, length) {
  const out = []
  const before = working.slice(Math.max(0, index - 12), index)
  const after = working.slice(index + length, index + length + 12)
  const tail = trimObject(before, 'tail')
  const head = trimObject(after, 'head')
  if (tail) out.push(tail)
  if (head) out.push(head)
  return out
}

function trimObject(segment, side) {
  let text = String(segment ?? '').trim()
  if (side === 'tail') {
    // Walk backwards to the nearest boundary character and keep what follows.
    let cut = -1
    for (let cursor = text.length - 1; cursor >= 0; cursor -= 1) {
      if (OBJECT_BOUNDARY.test(text[cursor])) {
        cut = cursor
        break
      }
    }
    text = cut >= 0 ? text.slice(cut + 1) : text
  } else {
    let cut = text.length
    for (let cursor = 0; cursor < text.length; cursor += 1) {
      if (OBJECT_BOUNDARY.test(text[cursor])) {
        cut = cursor
        break
      }
    }
    text = text.slice(0, cut)
  }
  text = text.replace(/^[\s该此其这那为把被对给]/, '').replace(/[\s的了过又再]+$/, '')
  return text.length >= 1 && text.length <= 20 ? text : text.slice(0, 20)
}

function containment(left, right) {
  const a = normalize(left).replace(/\s+/g, '')
  const b = normalize(right).replace(/\s+/g, '')
  if (!a || !b) return 0
  const setA = new Set(a)
  const setB = new Set(b)
  let common = 0
  for (const char of setA) if (setB.has(char)) common += 1
  return common / Math.min(setA.size, setB.size)
}

function objectOverlapOf(left, right) {
  const leftCandidates = left?.candidates ?? (left?.primary ? [left.primary] : [])
  const rightCandidates = right?.candidates ?? (right?.primary ? [right.primary] : [])
  let best = 0
  let pair = [leftCandidates[0] ?? '', rightCandidates[0] ?? '']
  for (const a of leftCandidates) {
    for (const b of rightCandidates) {
      const score = containment(a, b)
      if (score > best) {
        best = score
        pair = [a, b]
      }
    }
  }
  return { overlap: best, pair }
}

/** Structured five-tuple used by the structural recall channel. */
export function fingerprintClause(text) {
  const cleaned = String(text ?? '').trim()
  const actions = actionOf(cleaned)
  const matches = actionMatchesOf(cleaned)
  return {
    schema: CLAUSE_SCHEMA,
    text: cleaned.slice(0, 400),
    action: actions[0] ?? null,
    actions,
    object: objectOf(cleaned, actions),
    condition: conditionOf(cleaned),
    polarity: polarityOf(cleaned, matches),
    tokens: [...tokenize(cleaned)],
  }
}

function fieldAgreement(left, right) {
  const parts = []
  let score = 0
  let weight = 0
  if (left.action && right.action) {
    weight += 5
    const scoreForAction = left.action === right.action ? 5 : left.actions.includes(right.action) ? 4 : 0
    score += scoreForAction
    parts.push({ field: 'action', same: scoreForAction > 0, left: left.action, right: right.action })
  }
  if (left.object && right.object) {
    weight += 3.5
    const { overlap, pair } = objectOverlapOf(left.object, right.object)
    score += overlap * 3.5
    parts.push({ field: 'object', same: overlap >= 0.4, left: pair[0], right: pair[1], overlap: Number(overlap.toFixed(2)) })
  }
  weight += 1.5
  const polaritySame = left.polarity === right.polarity
  if (polaritySame) score += 1.5
  parts.push({ field: 'polarity', same: polaritySame, left: left.polarity, right: right.polarity })
  if (left.condition && right.condition) {
    weight += 1
    const same = similarity(left.condition, right.condition) >= 0.3
    if (same) score += 1
    parts.push({ field: 'condition', same, left: left.condition, right: right.condition })
  }
  return { score: weight === 0 ? 0 : score / weight, parts }
}

/**
 * Judge one candidate clause against the user's own words.
 *
 * The rules are ordered by what would be most costly to get wrong: polarity
 * reversal (says the opposite) first, then full agreement, then partial.
 */
export function adjudicateClause({ query, clause }) {
  const queryPrint = typeof query === 'string' ? fingerprintClause(query) : query
  const clausePrint = typeof clause === 'string' ? fingerprintClause(clause) : (clause?.fingerprint ?? fingerprintClause(clause?.text))
  const lexical = similarity(queryPrint.tokens ?? tokenize(queryPrint.text), clausePrint.tokens ?? tokenize(clausePrint.text))
  const keyword = keywordOverlap(keywordsOf(queryPrint.text), keywordsOf(clausePrint.text))
  const { score: structural, parts } = fieldAgreement(queryPrint, clausePrint)
  const decision = judgeClause({ queryPrint, clausePrint, lexical, structural, keyword, parts })
  const scores = {
    lexical: Number(lexical.toFixed(3)),
    structural: Number(structural.toFixed(3)),
    keyword: Number(keyword.toFixed(3)),
  }
  return { verdict: decision.verdict, reasons: decision.reasons, diff: decision.diff, parts, ...scores }
}

function judgeClause({ queryPrint, clausePrint, lexical, structural, keyword, parts }) {
  const reasons = []

  const polarityDiffers = queryPrint.polarity !== clausePrint.polarity
  const sameAction = Boolean(queryPrint.action && clausePrint.action && (queryPrint.action === clausePrint.action || queryPrint.actions.includes(clausePrint.action) || clausePrint.actions.includes(queryPrint.action)))
  const objectPart = parts.find((part) => part.field === 'object')
  const objectOverlap = objectPart?.overlap ?? 0
  const objectPair = [objectPart?.left ?? '', objectPart?.right ?? '']
  const conditionPart = parts.find((part) => part.field === 'condition')

  if (polarityDiffers && sameAction) {
    reasons.push(`极性相反（你的表述：${queryPrint.polarity}｜已有条款：${clausePrint.polarity}），说的是相反的事`)
    reasons.push(`但作用的是同一件事（${queryPrint.action}）`)
    return {
      verdict: 'conflict',
      lexical: Number(lexical.toFixed(3)),
      structural: Number(structural.toFixed(3)),
      reasons,
      diff: { field: 'polarity', query: queryPrint.polarity, clause: clausePrint.polarity },
      parts,
    }
  }

  if (sameAction && polarityDiffers === false) {
    if (objectOverlap >= 0.55 && (!conditionPart || conditionPart.same)) {
      reasons.push(`动作相同（${queryPrint.action}），对象重合 ${(objectOverlap * 100).toFixed(0)}%`)
      if (conditionPart?.same) reasons.push('适用条件也一致')
      return {
        verdict: 'covered',
        lexical: Number(lexical.toFixed(3)),
        structural: Number(structural.toFixed(3)),
        reasons,
        diff: null,
        parts,
      }
    }
    if (objectOverlap >= 0.2 || lexical >= 0.3) {
      reasons.push(`动作相同（${queryPrint.action}），但对象只部分重合（${(objectOverlap * 100).toFixed(0)}%）`)
      if (conditionPart && conditionPart.same === false) reasons.push(`条件不同：你的「${queryPrint.condition}」vs 已有「${clausePrint.condition}」`)
      return {
        verdict: 'partial',
        lexical: Number(lexical.toFixed(3)),
        structural: Number(structural.toFixed(3)),
        reasons,
        diff: { field: 'object', query: objectPair[0], clause: objectPair[1] },
        parts,
      }
    }
  }

  if (queryPrint.action && clausePrint.action && !sameAction) {
    reasons.push(`动作不同（你的「${queryPrint.action}」vs 已有「${clausePrint.action}」），不是同一件事`)
    return {
      verdict: 'unrelated',
      lexical: Number(lexical.toFixed(3)),
      structural: Number(structural.toFixed(3)),
      reasons,
      diff: { field: 'action', query: queryPrint.action, clause: clausePrint.action },
      parts,
    }
  }

  // One side has no recognisable verb. Fall back to character containment over
  // the whole sentences, but keep the verdict at `partial`: “titles are too
  // long” overlaps AC-02 without being the same promise.
  if (!queryPrint.action || !clausePrint.action) {
    const whole = containment(queryPrint.text, clausePrint.text)
    if (whole >= 0.4 || lexical >= 0.22 || keyword >= 0.4) {
      reasons.push(`没有对齐到明确动作，但字面重合 ${(whole * 100).toFixed(0)}%`)
      return {
        verdict: 'partial',
        lexical: Number(lexical.toFixed(3)),
        structural: Number(structural.toFixed(3)),
        reasons,
        diff: { field: 'action', query: queryPrint.action, clause: clausePrint.action },
        parts,
      }
    }
    reasons.push('没有可对齐的动作或对象')
    return {
      verdict: 'unrelated',
      lexical: Number(lexical.toFixed(3)),
      structural: Number(structural.toFixed(3)),
      reasons,
      diff: null,
      parts,
    }
  }

  if (lexical >= 0.18 || objectOverlap >= 0.3 || keyword >= 0.28) {
    reasons.push('动作相同但对象或条件只部分重合')
    if (keyword >= 0.28) reasons.push('共享领域关键词，但对象没有对齐')
    return {
      verdict: 'partial',
      lexical: Number(lexical.toFixed(3)),
      structural: Number(structural.toFixed(3)),
      reasons,
      diff: { field: 'action', query: queryPrint.action, clause: clausePrint.action },
      parts,
    }
  }

  reasons.push('没有可对齐的动作或对象')
  return {
    verdict: 'unrelated',
    lexical: Number(lexical.toFixed(3)),
    structural: Number(structural.toFixed(3)),
    reasons,
    diff: null,
    parts,
  }
}

/**
 * Three-channel recall. Fusion is weighted; the semantic channel is only used
 * when an embedder is injected, otherwise it reports `unavailable` and the
 * weights renormalize instead of silently scoring zero.
 */
export function recallClauses({ text, clauses = [], limit = 5, embed = null } = {}) {
  const query = fingerprintClause(text)
  const queryVector = embed ? embed(query.text) : null
  const scored = []
  for (const clause of clauses) {
    if (!clause || typeof clause.text !== 'string' || clause.text.trim() === '') continue
    const verdict = adjudicateClause({ query, clause })
    const clauseVector = embed && queryVector ? embed(clause.text) : null
    const semantic = queryVector && clauseVector ? cosine(queryVector, clauseVector) : null
    const weights = semantic === null
      ? { lexical: 0.35, structural: 0.45, keyword: 0.2 }
      : { lexical: 0.3, structural: 0.35, keyword: 0.15, semantic: 0.2 }
    const fused =
      verdict.lexical * weights.lexical +
      verdict.structural * weights.structural +
      (verdict.keyword ?? 0) * weights.keyword +
      (semantic === null ? 0 : semantic * weights.semantic)
    scored.push({
      clauseId: clause.clauseId ?? null,
      uid: clause.uid ?? null,
      title: clause.title ?? null,
      revision: clause.revision ?? null,
      text: clause.text,
      fingerprint: clause.fingerprint ?? fingerprintClause(clause.text),
      verdict: verdict.verdict,
      reasons: verdict.reasons,
      diff: verdict.diff,
      scores: {
        lexical: verdict.lexical,
        structural: verdict.structural,
        keyword: verdict.keyword ?? 0,
        semantic: semantic === null ? 'unavailable' : Number(semantic.toFixed(3)),
        fused: Number(fused.toFixed(3)),
      },
    })
  }
  return scored
    .filter((entry) => entry.scores.fused >= 0.12)
    .sort((left, right) => right.scores.fused - left.scores.fused)
    .slice(0, limit)
}

function cosine(left, right) {
  if (!left || !right || left.length !== right.length) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index]
    na += left[index] * left[index]
    nb += right[index] * right[index]
  }
  if (na === 0 || nb === 0) return 0
  return dot / Math.sqrt(na * nb)
}

/**
 * Extract clause-level text from a brief. Acceptance lines (`- AC-01…`) and
 * scope/lines are the natural unit; falling back to the brief headings keeps
 * legacy briefs usable.
 */
export function clausesFromBrief({ uid = null, title = null, revision = null, briefText = '' } = {}) {
  const clauses = []
  const lines = String(briefText ?? '').split(/\r?\n/)
  let section = ''
  for (const raw of lines) {
    const line = raw.trim()
    if (/^#{1,6}\s*/.test(line)) {
      section = line.replace(/^#{1,6}\s*/, '')
      continue
    }
    const match = /^[-*]\s*(AC-?\d+|FR-?\d+)\s*[:：]?\s*(.+)$/i.exec(line)
    if (match) {
      clauses.push({ uid, title, revision, clauseId: match[1].toUpperCase().replace(/^(AC|FR)(?=\d)/, '$1-'), text: match[2].trim() })
      continue
    }
    if (/^[-*]\s+/.test(line) && /验收|要求|目标/.test(section)) {
      const text = line.replace(/^[-*]\s+/, '').trim()
      if (text.length >= 6) clauses.push({ uid, title, revision, clauseId: `SEC-${clauses.length + 1}`, text })
    }
  }
  return clauses.map((entry) => ({ ...entry, fingerprint: fingerprintClause(entry.text) }))
}

// ---------------------------------------------------------------------------
// Rejection ledger (§AC-05)
// ---------------------------------------------------------------------------

function rejectionFile(root, id) {
  return join(root, REJECTION_DIR, `${id}.json`)
}

function ensureDir(path) {
  mkdirSync(dirname(path), { recursive: true })
}

function fingerprintId(text) {
  const tokens = [...tokenize(text)].sort().slice(0, 12).join('|')
  let hash = 0
  for (let index = 0; index < tokens.length; index += 1) {
    hash = (hash * 31 + tokens.charCodeAt(index)) >>> 0
  }
  return hash.toString(16).padStart(8, '0').slice(0, 8)
}

/** Read every rejection; a broken file is skipped, never fatal. */
export function readRejections(root) {
  const dir = join(root, REJECTION_DIR)
  if (!existsSync(dir)) return []
  const entries = []
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue
    try {
      const parsed = JSON.parse(readFileSync(join(dir, file), 'utf8'))
      if (parsed && typeof parsed.statement === 'string') entries.push(parsed)
    } catch {
      // A corrupt ledger entry must not blind the whole lookup.
    }
  }
  return entries.sort((left, right) => String(right.at ?? '').localeCompare(String(left.at ?? '')))
}

/** Deterministic ledger id, so the same statement never forks into two files. */
export function rejectionIdFor(statement) {
  return `REJ-${fingerprintId(String(statement ?? ''))}`
}

/**
 * Append one rejection. The ledger is the memory the product was missing: a
 * rejected request that is not stored comes back next month and gets rejected
 * again, which is exactly the loop users complain about.
 */
export function writeRejection(root, entry = {}) {
  const statement = String(entry.statement ?? '').trim()
  if (statement === '') return null
  const id = rejectionIdFor(statement)
  const record = {
    schema: REJECTION_SCHEMA,
    id,
    statement,
    statementFingerprint: fingerprintClause(statement),
    reason: String(entry.reason ?? '').trim().slice(0, 2000),
    alternative: String(entry.alternative ?? '').trim().slice(0, 2000),
    revisitTrigger: String(entry.revisitTrigger ?? '').trim().slice(0, 500) || null,
    evidenceClass: EVIDENCE_CLASSES.includes(entry.evidenceClass) ? entry.evidenceClass : 'stated',
    sessionId: entry.sessionId ?? null,
    itemId: entry.itemId ?? null,
    decidedBy: entry.decidedBy ?? 'human:local',
    at: entry.at ?? new Date().toISOString(),
    supersededBy: null,
    occurrences: 1,
  }
  const path = rejectionFile(root, id)
  if (existsSync(path)) {
    try {
      const previous = JSON.parse(readFileSync(path, 'utf8'))
      record.occurrences = (Number(previous.occurrences) || 1) + 1
      record.firstAt = previous.firstAt ?? previous.at ?? null
      record.supersededBy = previous.supersededBy ?? null
    } catch {
      // Overwrite a corrupt entry with a fresh one.
    }
  }
  ensureDir(path)
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
  return record
}

/** Recall prior rejections so the next session can say “你上次拒绝过这个”. */
export function matchRejections({ text, rejections = [], limit = 3 } = {}) {
  const query = fingerprintClause(text)
  return rejections
    .map((entry) => {
      const verdict = adjudicateClause({ query, clause: entry.statementFingerprint ?? fingerprintClause(entry.statement) })
      const overlap = verdict.lexical * 0.55 + verdict.structural * 0.45
      return { ...entry, verdict: verdict.verdict, reasons: verdict.reasons, score: Number(overlap.toFixed(3)) }
    })
    .filter((entry) => entry.verdict !== 'unrelated' && entry.score >= 0.15)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
}

// ---------------------------------------------------------------------------
// Observation ledger (defer)
// ---------------------------------------------------------------------------

export function writeObservation(root, entry = {}) {
  const id = entry.observationId ?? `OBS-${fingerprintId(String(entry.statement ?? '') + String(entry.at ?? Date.now()))}`
  const record = {
    schema: OBSERVATION_SCHEMA,
    observationId: id,
    statement: String(entry.statement ?? '').trim().slice(0, 2000),
    trigger: String(entry.trigger ?? '').trim().slice(0, 500) || null,
    dueAt: entry.dueAt ?? null,
    sessionId: entry.sessionId ?? null,
    itemId: entry.itemId ?? null,
    decidedBy: entry.decidedBy ?? 'human:local',
    at: entry.at ?? new Date().toISOString(),
  }
  const path = join(root, OBSERVATION_DIR, `${id}.json`)
  ensureDir(path)
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
  return record
}
