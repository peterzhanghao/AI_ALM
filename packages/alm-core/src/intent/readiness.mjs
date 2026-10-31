/**
 * Readiness is a pure decision table over a session snapshot.
 *
 * It deliberately returns machine reason codes (not UI copy) so the plugin can
 * render any button state, and so a confirmation attempt can be rejected with
 * the same reasons the UI showed before the click. “Ready” never means
 * adopted/approved: it only means the draft is complete enough for a human to
 * confirm, and confirmation itself still creates a `proposed` requirement or a
 * change draft — nothing more.
 */
import { MATCHES, ROUTES, intentError } from './errors.mjs'
import { effectiveCandidate, effectiveRoute, effectiveValue } from './analysis.mjs'

export const READINESS_CODES = [
  'no-items',
  'unknown-route',
  'missing-candidate',
  'missing-title',
  'needs-acceptance',
  'needs-priority',
  'invalid-priority',
  'unresolved-blocking-unknown',
  'invalid-change-base',
  'unresolved-source',
  'unverified-context',
  'investigate-needs-question',
  'missing-decline-reason',
  'missing-answer',
  'stale-input',
  'stale-context',
  'not-confirmed',
]

const PRIORITIES = new Set(['P0', 'P1', 'P2'])
const SOURCE_ROUTES = new Set(['create', 'change', 'reuse'])
const REASON_TEXT = {
  'no-items': '没有可确认的意图条目',
  'unknown-route': '建议去向缺失或未知',
  'missing-candidate': '缺少候选草稿',
  'missing-title': '候选需求缺少标题',
  'needs-acceptance': '缺少可判定的验收条件',
  'needs-priority': '优先级需要人工选择，不能由模型猜测',
  'invalid-priority': '优先级无效（允许 P0/P1/P2）',
  'unresolved-blocking-unknown': '存在未解决的阻塞性未知项',
  'invalid-change-base': '变更缺少可核对的基线（需求 uid/revision/内容哈希）',
  'unresolved-source': '缺少可核对的来源引用或可复用需求',
  'unverified-context': '需求检索未成功，相关需求尚未核对',
  'investigate-needs-question': '调查缺少要回答的问题',
  'missing-decline-reason': '拒绝需要理由与替代方案',
  'missing-answer': '回答缺少内容',
  'stale-input': '输入已更新，旧分析结果已过期',
  'stale-context': '需求上下文已变化，请重新分析后再确认',
  'not-confirmed': '尚未执行人工确认',
}

function reason(code, message, itemId) {
  return { code, message: message ?? REASON_TEXT[code] ?? code, ...(itemId ? { itemId } : {}) }
}

export function candidateOf(item) {
  return effectiveCandidate(item)
}

/** Read-set entry for a uid, looking at both the read set and the anchor. */
export function lookupContextEntry(context, uid) {
  if (!context || !uid) return null
  const entry = (context.readSet ?? []).find((item) => item.uid === uid)
  if (entry) return entry
  if (context.selected?.uid === uid) return { ...context.selected, match: 'covered', reasons: ['上下文锚点'] }
  return null
}

/**
 * Resolve the base revision a `change` route is bound to. A model-supplied base
 * is only a *pointer*: revision and contentHash always come from the context
 * snapshot the user saw, never from the model.
 */
export function resolveChangeBase({ item, confirmationItem, context } = {}) {
  const explicit = confirmationItem?.base
  // A request may only point at a base (`uid`). Revision and contentHash are
  // always re-derived from the context snapshot the user actually saw, so a
  // forged/stale pair in the confirmation payload can never become the draft
  // baseline.
  let uid = explicit?.uid ? String(explicit.uid) : null
  let related = null
  const candidates = (item?.related ?? []).filter((entry) => MATCHES.includes(entry.match) && entry.uid)
  if (!uid) {
    related =
      candidates.find((entry) => ['covered', 'related'].includes(entry.match) && lookupContextEntry(context, entry.uid)) ??
      candidates.find((entry) => lookupContextEntry(context, entry.uid)) ??
      candidates[0] ??
      null
    uid = related?.uid ?? context?.selected?.uid ?? null
  }
  if (!uid) return null
  const entry = lookupContextEntry(context, uid)
  if (!entry) {
    // Pointed-at base is not in the checked read set: no verifiable baseline.
    return { uid, revision: null, contentHash: null, title: null, match: null, unverified: true }
  }
  return {
    uid,
    revision: Number(entry.revision ?? 0) || null,
    contentHash: entry.contentHash ?? null,
    title: entry.title ?? null,
    match: entry.match ?? related?.match ?? null,
    unverified: false,
  }
}

function effectivePriority({ session, confirmation }) {
  const fromConfirmation = confirmation?.priority ?? null
  if (fromConfirmation !== null && fromConfirmation !== undefined && String(fromConfirmation).trim() !== '') {
    return String(fromConfirmation).trim().toUpperCase()
  }
  const explicit = session?.input?.explicit?.priority ?? null
  if (explicit) return String(explicit).trim().toUpperCase()
  return null
}

/**
 * @returns {{ready: boolean, reasons: object[], warnings: string[]}}
 */
export function evaluateReadiness({
  session,
  contextNow,
  project,
  confirmation,
  requireConfirmation = true,
  expectedInputRevision,
} = {}) {
  if (!session || typeof session !== 'object') throw intentError('invalid-request', 'evaluateReadiness 需要 session')
  const warnings = []
  const reasons = []
  const add = (code, message, itemId) => {
    if (reasons.some((entry) => entry.code === code && entry.itemId === itemId)) return
    reasons.push(reason(code, message, itemId))
  }

  const context = contextNow ?? session.context ?? null
  if (!contextNow) warnings.push('context-not-rechecked: 使用会话中缓存的上下文评估，确认前需重新核对')

  const currentRevision = session.input?.inputRevision ?? 1
  const declaredRevision = confirmation?.expectedInputRevision ?? expectedInputRevision ?? session.confirmation?.inputRevision
  if (declaredRevision !== undefined && declaredRevision !== null && Number(declaredRevision) !== currentRevision) {
    add('stale-input', `分析/确认针对输入版本 ${declaredRevision}，当前为 ${currentRevision}，请重新分析`)
  }
  const contextSnapshotId = context?.contextSnapshotId ?? null
  if (confirmation?.contextSnapshotId && contextSnapshotId && confirmation.contextSnapshotId !== contextSnapshotId) {
    add('stale-context', `确认基于上下文 ${confirmation.contextSnapshotId}，当前为 ${contextSnapshotId}，请重新分析后再确认`)
  }
  if (session.confirmation?.contextSnapshotId && contextSnapshotId && session.confirmation.contextSnapshotId !== contextSnapshotId) {
    add('stale-context', '会话中的确认记录已与当前需求上下文不一致，请重新确认')
  }
  if (confirmation?.contentHash && session.confirmation?.contentHash && confirmation.contentHash !== session.confirmation.contentHash) {
    warnings.push('confirmation-content-hash-mismatch')
  }

  const items = (session.items ?? []).filter((item) => item && item.excluded !== true)
  if (items.length === 0) {
    add('no-items')
    return { ready: false, reasons, warnings }
  }

  const confirmationItems = new Map(
    (Array.isArray(confirmation?.items) ? confirmation.items : []).filter((entry) => entry?.itemId).map((entry) => [entry.itemId, entry]),
  )
  const contextStatus = context?.queryStatus ?? 'not-queried'
  const priority = effectivePriority({ session, confirmation })

  for (const item of items) {
    const itemId = item.itemId
    const confirmationItem = confirmationItems.get(itemId) ?? null
    // A human may override the model's suggested route at confirmation time.
    const route = confirmationItem?.route ?? effectiveRoute(item)
    if (!route || !ROUTES.includes(route)) {
      add('unknown-route', `条目 ${itemId} 的建议去向无效：${String(route)}`, itemId)
      continue
    }
    const candidate = effectiveCandidate(item)
    const unknowns = Array.isArray(item.unknowns) ? item.unknowns : []
    const blocking = unknowns.filter(
      (unknown) => unknown?.blocking === true && (!unknown.resolution || unknown.resolution === 'pending'),
    )
    if (route !== 'investigate' && route !== 'decline' && route !== 'answer' && blocking.length > 0) {
      add(
        'unresolved-blocking-unknown',
        `条目 ${itemId} 存在未解决的阻塞性未知：${blocking.map((entry) => entry.description).join('；')}`,
        itemId,
      )
    }
    if (SOURCE_ROUTES.has(route) && contextStatus !== 'success') {
      add(
        'unverified-context',
        `条目 ${itemId} 所属需求检索${contextStatus === 'error' ? '失败' : '尚未执行'}，相关需求尚未核对，不能确认${route === 'create' ? '新需求' : '复用/变更'}`,
        itemId,
      )
    }

    if (route === 'create') {
      if (!candidate) add('missing-candidate', `条目 ${itemId} 缺少候选草稿`, itemId)
      if (!candidate?.title) add('missing-title', `条目 ${itemId} 的候选需求缺少标题`, itemId)
      if (!Array.isArray(candidate?.acceptance) || candidate.acceptance.length === 0) {
        add('needs-acceptance', `条目 ${itemId} 缺少验收条件（前置/动作/预期/判定）`, itemId)
      }
      if ((item.sourceRefs ?? []).length === 0) {
        add('unresolved-source', `条目 ${itemId} 没有可核对的原文引用，不能作为事实建需求`, itemId)
      }
      if (!priority) {
        add('needs-priority', `条目 ${itemId} 的优先级需要人工选择`, itemId)
      } else if (!PRIORITIES.has(priority)) {
        add('invalid-priority', `条目 ${itemId} 的优先级 ${priority} 无效（新建需求允许 P0/P1/P2）`, itemId)
      }
      continue
    }

    if (route === 'change') {
      if (!candidate) add('missing-candidate', `条目 ${itemId} 缺少变更草稿`, itemId)
      if (!candidate?.title) add('missing-title', `条目 ${itemId} 的变更缺少标题`, itemId)
      if (!Array.isArray(candidate?.acceptance) || candidate.acceptance.length === 0) {
        add('needs-acceptance', `条目 ${itemId} 的变更缺少验收条件`, itemId)
      }
      if ((item.sourceRefs ?? []).length === 0) {
        add('unresolved-source', `条目 ${itemId} 没有可核对的原文引用，不能作为变更依据`, itemId)
      }
      const base = resolveChangeBase({ item, confirmationItem, context })
      if (!base || !base.uid || !base.revision || !base.contentHash) {
        add('invalid-change-base', `条目 ${itemId} 缺少可核对的变更基线（uid/revision/contentHash）`, itemId)
      }
      continue
    }

    if (route === 'reuse') {
      const related = (item.related ?? []).filter((entry) => ['covered', 'related'].includes(entry.match) && entry.uid)
      const resolved = related.find((entry) => lookupContextEntry(context, entry.uid))
      if (!resolved) {
        add('unresolved-source', `条目 ${itemId} 的复用目标不在当前已核对的需求中`, itemId)
      }
      continue
    }

    if (route === 'investigate') {
      const question =
        confirmationItem?.question ??
        confirmation?.question ??
        session.nextQuestion?.text ??
        candidate?.problem ??
        item.desiredOutcome ??
        (unknowns.length > 0 ? unknowns[0].description : null)
      if (!question) add('investigate-needs-question', `条目 ${itemId} 没有要回答的问题`, itemId)
      continue
    }

    if (route === 'decline') {
      if (!confirmation?.reason && !session.confirmation?.reason) {
        add('missing-decline-reason', '拒绝必须写明理由', itemId)
      }
      if (!confirmation?.alternative && !session.confirmation?.alternative) {
        add('missing-decline-reason', '拒绝必须给出替代方案（或明确“无替代”）', itemId)
      }
      continue
    }

    if (route === 'answer') {
      const answer = confirmationItem?.answer ?? confirmation?.answer ?? session.answers?.at(-1)?.text ?? null
      if (!answer || String(answer).trim() === '') add('missing-answer', `条目 ${itemId} 的回答为空`, itemId)
    }
  }

  if (requireConfirmation && !confirmation && !session.confirmation) {
    add('not-confirmed', '尚未执行人工确认（AI 建议不等于确认）')
  }

  return { ready: reasons.length === 0, reasons, warnings }
}

export { effectiveValue, REASON_TEXT }
