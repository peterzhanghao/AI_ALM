/**
 * Confirmation: turn one human-confirmed draft into a *draft* artifact.
 *
 * What confirmation may write:
 *   - create   -> a new `proposed` requirement (via createRequirement)
 *   - change   -> a change draft under `.alm/intents/changes/`, never the sdoc
 *   - investigate -> an investigation record
 *   - reuse / decline / answer -> receipt (+ link metadata) only
 *
 * Idempotency is keyed by the caller's key and a payload hash. A failed write
 * records the artifacts already applied so the same key can be retried and
 * recover without duplicating a requirement or a change draft; a different
 * payload under the same key is a conflict, never a silent overwrite.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { indexReport } from '../commands.mjs'
import { buildGraph } from '../index/closure.mjs'
import { requirementContentHash } from '../model/content-hash.mjs'
import { previewRehearsal } from '../rehearsal/rehearsal.mjs'
import { createRequirement, planRequirement, RequirementCreateError } from '../requirements/create.mjs'
import { effectiveCandidate, effectiveRoute } from './analysis.mjs'
import { buildIntentContext } from './context.mjs'
import {
  AUDIT_SCHEMA,
  CHANGE_DRAFT_SCHEMA,
  IDEMPOTENCY_SCHEMA,
  INTENT_SCHEMA_VERSION,
  INVESTIGATION_SCHEMA,
  JOURNAL_SCHEMA,
  RECEIPT_SCHEMA,
  ROUTES,
  ERROR_STATUS,
  intentError,
  isIntentError,
} from './errors.mjs'
import { evaluateReadiness, resolveChangeBase } from './readiness.mjs'
import { loadSession, saveSession } from './session.mjs'
import {
  asString,
  canonicalJson,
  ensureDir,
  fileExists,
  intentRoot,
  listJsonFiles,
  normalizeStringList,
  nowIso,
  randomHex,
  readJsonFile,
  sha256Hex,
  stamp,
  tryReadJsonFile,
  writeJsonAtomic,
} from './util.mjs'

export const INTENT_DIRS = {
  sessions: '.alm/intents/sessions',
  receipts: '.alm/intents/receipts',
  changes: '.alm/intents/changes',
  investigations: '.alm/intents/investigations',
  idempotency: '.alm/intents/idempotency',
  journal: '.alm/intents/journal',
  backup: '.alm/intents/backup',
  audit: '.alm/audit/intents',
}

const ROUTE_DEFAULT_TITLE = {
  create: '新建需求草稿',
  change: '需求变更草稿',
  investigate: '调查任务',
  reuse: '复用现有需求',
  decline: '拒绝并登记替代方案',
  answer: '回答澄清问题',
}

export function dirOf(root, key) {
  return join(root, INTENT_DIRS[key])
}

export function receiptPath(root, receiptId) {
  return join(dirOf(root, 'receipts'), `${receiptId}.json`)
}

export function journalPath(root, receiptId) {
  return join(dirOf(root, 'journal'), `${receiptId}.json`)
}

export function idempotencyPath(root, keyHash) {
  return join(dirOf(root, 'idempotency'), `${keyHash}.json`)
}

function normalizeRoute(route) {
  const value = String(route ?? '').trim()
  return ROUTES.includes(value) ? value : null
}

function normalizeConfirmation(confirmation) {
  if (!confirmation || typeof confirmation !== 'object' || Array.isArray(confirmation)) {
    throw intentError('invalid-confirmation', 'confirmation 必须是对象')
  }
  const route = normalizeRoute(confirmation.route)
  if (!route) {
    throw intentError('invalid-confirmation', `缺少或未知确认去向：${String(confirmation.route)}（允许 ${ROUTES.join('/')}）`, {
      route: confirmation.route ?? null,
    })
  }
  const items = (Array.isArray(confirmation.items) ? confirmation.items : []).map((entry, index) => {
    if (!entry || typeof entry !== 'object') throw intentError('invalid-confirmation', `confirmation.items[${index}] 必须是对象`)
    const itemRoute = entry.route === undefined || entry.route === null ? null : normalizeRoute(entry.route)
    if (entry.route !== undefined && entry.route !== null && !itemRoute) {
      throw intentError('invalid-confirmation', `confirmation.items[${index}].route 未知：${String(entry.route)}`)
    }
    const base = entry.base && typeof entry.base === 'object' ? entry.base : null
    return {
      itemId: String(entry.itemId ?? '').trim() || null,
      route: itemRoute,
      base: base
        ? {
            uid: String(base.uid ?? '').trim() || null,
            revision: Number.isInteger(Number(base.revision)) && Number(base.revision) > 0 ? Number(base.revision) : null,
            contentHash: typeof base.contentHash === 'string' && base.contentHash !== '' ? base.contentHash : null,
            title: asString(base.title, 200) || null,
          }
        : null,
      answer: asString(entry.answer, 4000) || null,
      question: asString(entry.question, 1000) || null,
    }
  })
  const expectedInputRevision = Number(confirmation.expectedInputRevision)
  const owner = asString(confirmation.owner, 120).trim() || null
  const priority = asString(confirmation.priority, 4).trim().toUpperCase() || null
  if (priority && !['P0', 'P1', 'P2', 'P3'].includes(priority)) {
    throw intentError('invalid-confirmation', `无效优先级：${priority}（允许 P0-P3）`)
  }
  return {
    route,
    items,
    owner,
    priority,
    reason: asString(confirmation.reason, 1000).trim() || null,
    alternative: asString(confirmation.alternative, 1000).trim() || null,
    answer: asString(confirmation.answer, 4000).trim() || null,
    question: asString(confirmation.question, 1000).trim() || null,
    expectedInputRevision: Number.isInteger(expectedInputRevision) && expectedInputRevision > 0 ? expectedInputRevision : null,
    contextSnapshotId: asString(confirmation.contextSnapshotId, 120).trim() || null,
    contentHash: asString(confirmation.contentHash, 128).trim() || null,
  }
}

/** Hash of exactly what the human confirmed; model text is never included. */
export function computeConfirmationContentHash({ sessionId, confirmation }) {
  const normalized = normalizeConfirmation(confirmation)
  return sha256Hex({
    policy: 'intent-confirmation/v1',
    sessionId: sessionId ?? null,
    route: normalized.route,
    items: [...normalized.items].sort((left, right) => String(left.itemId).localeCompare(String(right.itemId))),
    owner: normalized.owner,
    priority: normalized.priority,
    reason: normalized.reason,
    alternative: normalized.alternative,
    answer: normalized.answer,
  })
}

function payloadHashOf({ sessionId, confirmation, expectedInputRevision, contextSnapshotId }) {
  return sha256Hex({
    policy: 'intent-confirm-payload/v1',
    sessionId,
    confirmation: {
      ...confirmation,
      items: [...confirmation.items].sort((left, right) => String(left.itemId).localeCompare(String(right.itemId))),
    },
    expectedInputRevision: expectedInputRevision ?? null,
    contextSnapshotId: contextSnapshotId ?? null,
  })
}

function intentEntityId({ root, dir, prefix, projectId, now }) {
  const project = String(projectId ?? '').trim().toUpperCase()
  const pattern = new RegExp(`^${prefix}-${project}-(\\d{3,})\\.json$`)
  let max = 0
  const files = [...listJsonFiles(join(root, dir))]
  // change ids may have been issued by the general change flow before the intent store existed
  if (prefix === 'CHG') files.push(...listJsonFiles(join(root, '.alm/changes')))
  for (const file of files) {
    const name = file.split(/[\\/]/).pop()
    const match = pattern.exec(name)
    if (!match) continue
    max = Math.max(max, Number(match[1]))
  }
  return `${prefix}-${project}-${String(max + 1).padStart(3, '0')}`
}

function candidateMarkdown(candidate) {
  const lines = []
  if (candidate?.problem) lines.push(candidate.problem, '')
  if (candidate?.goal) lines.push(`**目标**：${candidate.goal}`, '')
  if (candidate?.inScope?.length) lines.push('**范围内**：', ...candidate.inScope.map((entry) => `- ${entry}`), '')
  if (candidate?.outOfScope?.length) lines.push('**范围外**：', ...candidate.outOfScope.map((entry) => `- ${entry}`), '')
  if (candidate?.acceptance?.length) {
    lines.push('**验收条件**：')
    candidate.acceptance.forEach((entry, index) => {
      const parts = [
        entry.precondition ? `前置：${entry.precondition}` : null,
        entry.action ? `动作：${entry.action}` : null,
        entry.expected ? `预期：${entry.expected}` : null,
        entry.judgement ? `判定：${entry.judgement}` : null,
      ].filter(Boolean)
      lines.push(`${index + 1}. ${parts.join('；')}`)
    })
  }
  return lines.join('\n').trim()
}

function impactForChange({ root, base, proposedBrief }) {
  const fallback = () => {
    try {
      const index = indexReport(root)
      const assets = Array.isArray(index?.assets) ? index.assets : []
      const graph = buildGraph(assets)
      const asset = assets.find((entry) => entry.id === base.uid)
      const direct = (asset?.links ?? []).map((link) => link.target).filter(Boolean)
      const reverse = (graph.reverse.get(base.uid) ?? []).map((edge) => edge.from)
      const paths = [...new Set([...direct, ...reverse])]
      return {
        paths,
        blindSpots: paths.length === 0 ? ['关系图未连出任何受影响资产，影响范围以人工判断为准'] : [],
        coverage: { relations: direct.length + reverse.length, explored: paths.length, maxDepth: 1, truncated: false },
        advisory: true,
        source: 'closure-fallback',
      }
    } catch {
      return {
        paths: [],
        blindSpots: ['影响分析不可用（索引读取失败），未探索任何关系'],
        coverage: { relations: 0, explored: 0, maxDepth: 0, truncated: true },
        advisory: true,
        source: 'unavailable',
      }
    }
  }
  try {
    const index = indexReport(root)
    const assets = Array.isArray(index?.assets) ? index.assets : []
    const asset = assets.find((entry) => entry.id === base.uid)
    if (!asset) return fallback()
    const preview = previewRehearsal({ root, asset, assets, change: { field: 'brief', value: proposedBrief } })
    const impact = preview?.impact ?? {}
    const paths = (Array.isArray(impact.paths) ? impact.paths : []).map((entry) =>
      Array.isArray(entry) ? entry.join(' > ') : typeof entry === 'string' ? entry : JSON.stringify(entry),
    )
    return {
      paths,
      blindSpots: Array.isArray(impact.blindSpots) ? impact.blindSpots : [],
      coverage: impact.coverage ?? { relations: 0, explored: paths.length, maxDepth: 0, truncated: false },
      advisory: true,
      source: 'rehearsal',
      groups: impact.groups ?? null,
    }
  } catch (error) {
    return { ...fallback(), note: `rehearsal 不可用：${error?.code ?? error?.message ?? 'unknown'}` }
  }
}

function selectItemForRoute(session, confirmation) {
  const items = (session.items ?? []).filter((item) => item && item.excluded !== true)
  const byItemId = new Map(items.map((item) => [item.itemId, item]))
  for (const entry of confirmation.items ?? []) {
    if (entry.itemId && byItemId.has(entry.itemId)) return byItemId.get(entry.itemId)
  }
  const matching = items.find((item) => (effectiveRoute(item) ?? null) === confirmation.route)
  return matching ?? items[0] ?? null
}

function plannedArtifactsFor({ root, session, confirmation, context, now }) {
  const item = selectItemForRoute(session, confirmation)
  if (!item) return []
  const candidate = effectiveCandidate(item)
  const project = session.project?.id ?? context?.projectId ?? null
  const route = confirmation.route
  const baseDecision = {
    sessionId: session.sessionId,
    route,
    itemId: item.itemId,
    sourceRefs: item.sourceRefs ?? [],
  }

  if (route === 'create') {
    const title = candidate?.title ?? ROUTE_DEFAULT_TITLE.create
    const brief = candidateMarkdown(candidate)
    const goal = candidate?.goal ?? ''
    const priority = confirmation.priority ?? session.input?.explicit?.priority ?? null
    const owner = confirmation.owner ?? session.input?.explicit?.owner ?? null
    const plan = planRequirement({
      root,
      title,
      brief,
      goal,
      priority,
      owner: owner ?? undefined,
      project,
    })
    return [
      {
        kind: 'requirement',
        requirementId: plan.requirementId,
        file: plan.file,
        briefFile: plan.briefFile,
        title,
        brief,
        goal,
        priority,
        owner: plan.owner,
        ownerRequested: owner,
        ownerSource: owner ? 'user-explicit' : 'project-default',
        project,
        check: null,
      },
    ]
  }

  if (route === 'change') {
    const confirmationItem = (confirmation.items ?? []).find((entry) => entry.itemId === item.itemId) ?? null
    const base = resolveChangeBase({ item, confirmationItem, context })
    if (!base || !base.uid || !base.revision || !base.contentHash) {
      throw intentError('invalid-change-base', '变更缺少可核对的基线（uid/revision/contentHash）', {
        itemId: item.itemId,
      })
    }
    const changeId = intentEntityId({ root, dir: INTENT_DIRS.changes, prefix: 'CHG', projectId: project, now })
    const proposed = {
      title: candidate?.title ?? base.title ?? '',
      brief: candidateMarkdown(candidate),
      goal: candidate?.goal ?? '',
      acceptance: candidate?.acceptance ?? [],
      inScope: candidate?.inScope ?? [],
      outOfScope: candidate?.outOfScope ?? [],
    }
    const draft = {
      schema: CHANGE_DRAFT_SCHEMA,
      schemaVersion: INTENT_SCHEMA_VERSION,
      changeId,
      sessionId: session.sessionId,
      project,
      base: {
        uid: base.uid,
        revision: base.revision,
        contentHash: base.contentHash,
        title: base.title ?? null,
      },
      proposed,
      diffSummary: {
        fields: ['title', 'brief', 'acceptance'],
        before: { title: base.title ?? null, revision: base.revision, contentHash: base.contentHash },
        after: { title: proposed.title },
        note: '仅生成变更草稿，未修改 requirements/*.sdoc；需要走正式变更流程。',
      },
      impact: impactForChange({ root, base, proposedBrief: proposed.brief }),
      sourceRefs: item.sourceRefs ?? [],
      rationale: item.routeRationale ?? candidate?.problem ?? null,
      status: 'draft',
      createdAt: nowIso(now),
      decision: baseDecision,
    }
    return [{ kind: 'change-draft', changeId, file: `${INTENT_DIRS.changes}/${changeId}.json`, draft }]
  }

  if (route === 'investigate') {
    const investigationId = intentEntityId({ root, dir: INTENT_DIRS.investigations, prefix: 'INV', projectId: project, now })
    const confirmationItem = (confirmation.items ?? []).find((entry) => entry.itemId === item.itemId) ?? null
    const question =
      confirmation.question ??
      confirmationItem?.question ??
      session.nextQuestion?.text ??
      candidate?.problem ??
      item.desiredOutcome ??
      (item.unknowns ?? [])[0]?.description ??
      null
    if (!question) throw intentError('not-ready', '调查缺少要回答的问题', { reasons: [{ code: 'investigate-needs-question' }] })
    const record = {
      schema: INVESTIGATION_SCHEMA,
      schemaVersion: INTENT_SCHEMA_VERSION,
      investigationId,
      sessionId: session.sessionId,
      project,
      question,
      known: [
        item.userProblem ? `用户问题：${item.userProblem}` : null,
        item.desiredOutcome ? `期望结果：${item.desiredOutcome}` : null,
        ...(candidate?.inScope ?? []).map((entry) => `范围内：${entry}`),
      ].filter(Boolean),
      unknowns: (item.unknowns ?? []).map((unknown) => ({
        description: unknown.description,
        blocking: unknown.blocking === true,
        resolution: unknown.resolution ?? 'pending',
      })),
      nextObservations: normalizeStringList(
        [
          candidate?.valueCheck?.smallestCheck,
          ...(item.unknowns ?? []).map((unknown) => `观察：${unknown.description}`),
        ],
        { max: 10, maxLength: 500 },
      ),
      sourceRefs: item.sourceRefs ?? [],
      status: 'open',
      createdAt: nowIso(now),
      decision: baseDecision,
    }
    return [{ kind: 'investigation', investigationId, file: `${INTENT_DIRS.investigations}/${investigationId}.json`, investigation: record }]
  }

  if (route === 'reuse') {
    const related = (item.related ?? []).find(
      (entry) => ['covered', 'related'].includes(entry.match) && entry.uid && context?.readSet?.some((read) => read.uid === entry.uid),
    )
    if (!related) throw intentError('not-ready', '复用目标不在当前已核对需求中', { reasons: [{ code: 'unresolved-source' }] })
    const entry = context.readSet.find((read) => read.uid === related.uid)
    return [
      {
        kind: 'link',
        uid: related.uid,
        revision: entry?.revision ?? related.revision ?? null,
        contentHash: entry?.contentHash ?? null,
        match: entry?.match ?? related.match,
        title: entry?.title ?? null,
        path: null,
      },
    ]
  }

  return []
}

function artifactSummary(planned) {
  if (planned.kind === 'requirement') {
    return `新建需求草稿 ${planned.requirementId}（status=proposed，priority=${planned.priority}，owner=${planned.owner}）`
  }
  if (planned.kind === 'change-draft') return `变更草稿 ${planned.changeId}（base ${planned.draft.base.uid}@${planned.draft.base.revision}）`
  if (planned.kind === 'investigation') return `调查记录 ${planned.investigationId}（status=open）`
  if (planned.kind === 'link') return `复用 ${planned.uid}（as-is，未新建需求）`
  return planned.kind
}

function publicArtifact(planned, at) {
  const artifact = {
    kind: planned.kind,
    id: planned.requirementId ?? planned.changeId ?? planned.investigationId ?? planned.uid ?? planned.kind,
    path: planned.file ?? planned.path ?? null,
    summary: artifactSummary(planned),
    appliedAt: at,
  }
  if (planned.kind === 'link') {
    artifact.revision = planned.revision ?? null
    artifact.contentHash = planned.contentHash ?? null
    artifact.match = planned.match ?? null
  }
  return artifact
}

function materializeArtifact({ root, planned, at }) {
  if (planned.kind === 'requirement') {
    const index = indexReport(root)
    const existing = (index?.assets ?? []).find((asset) => asset.id === planned.requirementId)
    if (!existing) {
      createRequirement({
        root,
        id: planned.requirementId,
        title: planned.title,
        brief: planned.brief,
        goal: planned.goal,
        priority: planned.priority,
        owner: planned.owner,
        project: planned.project,
        apply: true,
      })
    }
    return publicArtifact(planned, at)
  }
  if (planned.kind === 'change-draft') {
    const target = join(root, planned.file)
    if (!fileExists(target)) writeJsonAtomic(target, planned.draft)
    return publicArtifact(planned, at)
  }
  if (planned.kind === 'investigation') {
    const target = join(root, planned.file)
    if (!fileExists(target)) writeJsonAtomic(target, planned.investigation)
    return publicArtifact(planned, at)
  }
  return publicArtifact(planned, at)
}

function mapCreateError(error) {
  if (error instanceof RequirementCreateError) {
    return intentError(error.code, error.message, { causeCode: error.code }, error.status)
  }
  return error
}

function rejectNotReady(readiness) {
  const reasons = readiness.reasons
  const codes = new Set(reasons.map((entry) => entry.code))
  let code = 'not-ready'
  if (codes.size === 1) {
    const only = [...codes][0]
    if (only === 'needs-acceptance') code = 'missing-acceptance'
    else if (['unresolved-source', 'invalid-change-base'].includes(only)) code = only
  }
  throw intentError(code, reasons.map((entry) => entry.message).join('；'), {
    reasons,
    warnings: readiness.warnings,
  })
}

function writeJournal({ root, receiptId, journal }) {
  try {
    writeJsonAtomic(journalPath(root, receiptId), journal)
    return journalPath(root, receiptId)
  } catch {
    return null
  }
}

function buildReceipt({ session, confirmation, context, artifacts, baseRevisions, contentHash, actor, receiptId, at, warnings }) {
  const decision = { route: confirmation.route }
  if (confirmation.route === 'decline') {
    decision.decline = {
      reason: confirmation.reason,
      alternative: confirmation.alternative,
      appeal: 'reopen',
    }
  }
  if (confirmation.route === 'answer') {
    decision.answer = confirmation.answer ?? null
  }
  if (confirmation.route === 'reuse') {
    const link = artifacts.find((entry) => entry.kind === 'link')
    decision.link = link ? { uid: link.id, revision: link.revision ?? null, contentHash: link.contentHash ?? null } : null
  }
  return {
    schema: RECEIPT_SCHEMA,
    schemaVersion: INTENT_SCHEMA_VERSION,
    receiptId,
    sessionId: session.sessionId,
    project: session.project?.id ?? null,
    actor,
    route: confirmation.route,
    createdAt: at,
    inputRevision: session.input.inputRevision,
    contextSnapshotId: context?.contextSnapshotId ?? null,
    queryStatus: context?.queryStatus ?? null,
    contentHash,
    baseRevisions,
    artifacts,
    warnings,
    model: session.analysisMeta
      ? {
          provider: session.analysisMeta.provider ?? null,
          model: session.analysisMeta.model ?? null,
          analysisRunId: session.analysisMeta.analysisRunId ?? null,
        }
      : null,
    decision,
    note: 'AI 建议已由人工确认；本回执只登记草稿，不等于采纳、开工、验收、授权或发布。',
  }
}

/**
 * Confirm one session route.
 *
 * @returns {{receipt: object, artifacts: object[], replayed: boolean}}
 */
export function confirmIntent({ root, sessionId, confirmation, actor = 'human:local', idempotencyKey, now } = {}) {
  if (!root || typeof root !== 'string') throw intentError('invalid-request', 'confirmIntent 需要 root')
  if (!sessionId) throw intentError('invalid-request', 'confirmIntent 需要 sessionId')
  const cleanKey = asString(idempotencyKey, 300).trim()
  if (cleanKey === '') {
    throw intentError('idempotency-key-required', 'confirmIntent 需要 idempotencyKey，不能重复提交同一确认')
  }
  const at = nowIso(now)
  const normalized = normalizeConfirmation(confirmation)
  const session = loadSession({ root, sessionId })

  const expectedInputRevision = normalized.expectedInputRevision ?? session.input.inputRevision
  const declaredContextId = normalized.contextSnapshotId ?? session.context?.contextSnapshotId ?? null
  const payloadHash = payloadHashOf({
    sessionId,
    confirmation: normalized,
    expectedInputRevision,
    contextSnapshotId: declaredContextId,
  })
  const keyHash = sha256Hex(cleanKey)
  const idemPath = idempotencyPath(root, keyHash)
  const previous = tryReadJsonFile(idemPath)
  if (previous && previous.payloadHash !== payloadHash) {
    throw intentError('idempotency-conflict', '同一幂等键已用于不同的确认负载；拒绝覆盖', {
      idempotencyKeyHash: keyHash,
      previousPayloadHash: previous.payloadHash,
      payloadHash,
    })
  }
  if (previous?.status === 'committed' && previous.receiptFile) {
    const receipt = tryReadJsonFile(join(root, previous.receiptFile))
    if (receipt) return { receipt, artifacts: receipt.artifacts ?? [], replayed: true }
  }
  if (session.state === 'committed') {
    throw intentError('already-committed', '该会话已提交；如需再次确认请新建会话', {
      sessionId,
      receipt: session.receipt ?? null,
    })
  }

  // Recompute the context from the real index: the confirmation must be bound
  // to the requirement state the human actually saw.
  let contextNow
  try {
    contextNow = buildIntentContext({
      root,
      projectId: session.project?.id ?? null,
      selectedRequirementId: session.context?.selected?.uid ?? null,
      intentText: session.input?.text ?? '',
      extractedText: session.input?.extractedText ?? '',
    })
  } catch (error) {
    if (error?.code === 'unknown-requirement') {
      throw intentError('stale-context', '会话锚定的需求已不存在或不可读；请重新分析后再确认', {
        causeCode: error.code,
        expected: declaredContextId,
      })
    }
    throw error
  }
  const isRetry = Boolean(previous && ['pending', 'failed'].includes(previous.status))
  if (!isRetry && declaredContextId && contextNow.contextSnapshotId !== declaredContextId) {
    throw intentError(
      'stale-context',
      `需求上下文已变化（确认基于 ${declaredContextId}，当前 ${contextNow.contextSnapshotId}）；请重新分析后再确认`,
      { expected: declaredContextId, current: contextNow.contextSnapshotId, queryStatus: contextNow.queryStatus },
    )
  }
  if (isRetry && declaredContextId && contextNow.contextSnapshotId !== declaredContextId) {
    // Recovering an interrupted write: our own partially applied artifact may have
    // joined the read set. Retry resumes the confirmation the human actually made.
    contextNow = {
      ...contextNow,
      contextSnapshotId: declaredContextId,
      retryRecomputedContextSnapshotId: contextNow.contextSnapshotId,
    }
  }
  if (expectedInputRevision !== session.input.inputRevision) {
    throw intentError(
      'stale-input',
      `确认针对输入版本 ${expectedInputRevision}，当前已是 ${session.input.inputRevision}；迟到结果不能覆盖新输入`,
      { expected: session.input.inputRevision, received: expectedInputRevision },
    )
  }
  if (contextNow.queryStatus !== 'success' && ['create', 'change', 'reuse'].includes(normalized.route)) {
    throw intentError(
      'stale-context',
      '需求检索未成功，相关需求尚未核对；请恢复检索或改为调查后再确认',
      { queryStatus: contextNow.queryStatus, failure: contextNow.query?.failure ?? null },
    )
  }

  const readiness = evaluateReadiness({
    session,
    contextNow,
    project: session.project?.id ?? null,
    confirmation: normalized,
    requireConfirmation: false,
    expectedInputRevision,
  })
  if (!readiness.ready) rejectNotReady(readiness)

  const contentHash = normalized.contentHash ?? computeConfirmationContentHash({ sessionId, confirmation: normalized })
  let planned
  try {
    planned = previous?.planned?.length ? previous.planned : plannedArtifactsFor({ root, session, confirmation: normalized, context: contextNow, now })
  } catch (error) {
    if (isIntentError(error)) throw error
    throw mapCreateError(error)
  }

  const baseRevisions = {}
  for (const entry of planned) {
    if (entry.kind === 'change-draft') baseRevisions[entry.draft.base.uid] = { revision: entry.draft.base.revision, contentHash: entry.draft.base.contentHash }
    if (entry.kind === 'link') baseRevisions[entry.uid] = { revision: entry.revision, contentHash: entry.contentHash }
  }

  const receiptId = previous?.receiptId ?? `RCP-${stamp(new Date(at))}-${randomHex(3)}`
  const journal = {
    schema: JOURNAL_SCHEMA,
    schemaVersion: INTENT_SCHEMA_VERSION,
    receiptId,
    sessionId,
    route: normalized.route,
    payloadHash,
    idempotencyKeyHash: keyHash,
    status: 'writing',
    planned,
    artifacts: [],
    startedAt: at,
    updatedAt: at,
  }
  const journalFile = writeJournal({ root, receiptId, journal })
  const idempotencyRecord = {
    schema: IDEMPOTENCY_SCHEMA,
    schemaVersion: INTENT_SCHEMA_VERSION,
    keyHash,
    sessionId,
    route: normalized.route,
    payloadHash,
    receiptId,
    planned,
    artifacts: [],
    status: 'pending',
    createdAt: previous?.createdAt ?? at,
    updatedAt: at,
  }
  try {
    writeJsonAtomic(idemPath, idempotencyRecord)
  } catch (error) {
    throw intentError('write-failed', `幂等记录写入失败：${error.message}`, { appliedArtifacts: [], journalPath: journalFile })
  }

  const artifacts = []
  try {
    for (const entry of planned) {
      const artifact = materializeArtifact({ root, planned: entry, at })
      artifacts.push(artifact)
      journal.artifacts = artifacts
      writeJournal({ root, receiptId, journal })
    }
    const warnings = [
      ...(readiness.warnings ?? []),
      ...(session.analysisMeta?.warnings ?? []),
      ...(normalized.route === 'create' && !normalized.owner && planned[0]?.ownerSource === 'project-default'
        ? ['未指定负责人，已使用项目默认团队（需人工确认）']
        : []),
    ]
    const receipt = buildReceipt({
      session,
      confirmation: normalized,
      context: contextNow,
      artifacts,
      baseRevisions,
      contentHash,
      actor,
      receiptId,
      at,
      warnings,
    })
    const receiptFile = `${INTENT_DIRS.receipts}/${receiptId}.json`
    writeJsonAtomic(receiptPath(root, receiptId), receipt)
    artifacts.push({ kind: 'receipt', id: receiptId, path: receiptFile, summary: `确认回执 ${receiptId}`, appliedAt: at })

    writeJsonAtomic(join(root, INTENT_DIRS.audit, `${receiptId}.json`), {
      schema: AUDIT_SCHEMA,
      schemaVersion: INTENT_SCHEMA_VERSION,
      event: 'intent.confirm',
      receiptId,
      sessionId,
      actor,
      route: normalized.route,
      createdAt: at,
      inputRevision: session.input.inputRevision,
      contextSnapshotId: contextNow.contextSnapshotId,
      payloadHash,
      idempotencyKeyHash: keyHash,
      contentHash,
      artifacts,
      warnings,
    })

    const committed = {
      ...session,
      state: 'committed',
      confirmation: {
        route: normalized.route,
        inputRevision: session.input.inputRevision,
        contextSnapshotId: contextNow.contextSnapshotId,
        contentHash,
        model: session.analysisMeta ? { provider: session.analysisMeta.provider, model: session.analysisMeta.model } : null,
        at,
        actor,
      },
      artifacts,
      receipt: { receiptId, file: receiptFile },
      error: null,
      updatedAt: at,
    }
    saveSession({ root, session: committed })

    writeJsonAtomic(idemPath, {
      ...idempotencyRecord,
      status: 'committed',
      artifacts,
      receiptFile,
      updatedAt: at,
    })
    writeJournal({
      root,
      receiptId,
      journal: { ...journal, status: 'done', artifacts, finishedAt: at, updatedAt: at },
    })
    return { receipt, artifacts, replayed: false }
  } catch (error) {
    const failure = isIntentError(error) ? error : mapCreateError(error)
    writeJournal({
      root,
      receiptId,
      journal: {
        ...journal,
        status: 'failed',
        artifacts,
        error: { code: failure.code ?? 'write-failed', message: failure.message },
        updatedAt: nowIso(),
      },
    })
    try {
      writeJsonAtomic(idemPath, {
        ...idempotencyRecord,
        status: 'failed',
        artifacts,
        error: { code: failure.code ?? 'write-failed', message: failure.message },
        updatedAt: nowIso(),
      })
      saveSession({
        root,
        session: {
          ...session,
          state: 'failed',
          error: { code: failure.code ?? 'write-failed', message: failure.message, at: nowIso() },
          artifacts: session.artifacts ?? [],
          updatedAt: nowIso(),
        },
      })
    } catch {
      // Recovery metadata is best-effort; the journal remains the source of truth.
    }
    if (isIntentError(error)) throw error
    throw intentError('write-failed', `确认写入失败：${error.message}`, {
      appliedArtifacts: artifacts,
      journalPath: journalFile,
      causeCode: error.code ?? null,
    })
  }
}
