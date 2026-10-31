/**
 * UI projection of a session.
 *
 * The view is a plain JSON object (safe to hand to a browser): it exposes the
 * model's suggestions *and* the human's overrides, the honest context boundary,
 * and the machine readiness reasons, but never grants anything. Buttons are a
 * rendering of `readiness.reasons`, not the source of truth.
 */
import { effectiveCandidate, effectiveRoute, effectiveValue } from './analysis.mjs'
import { evaluateReadiness, lookupContextEntry } from './readiness.mjs'
import { clone } from './util.mjs'

export const SESSION_VIEW_SCHEMA = 'alm.intent.session-view/v1'

function projectReadSet(readSet) {
  return (Array.isArray(readSet) ? readSet : []).map((entry) => ({
    uid: entry.uid ?? null,
    businessId: entry.businessId ?? null,
    revision: entry.revision ?? null,
    title: entry.title ?? null,
    file: entry.file ?? null,
    contentHash: entry.contentHash ?? null,
    match: entry.match ?? 'uncertain',
    reasons: Array.isArray(entry.reasons) ? entry.reasons : [],
    briefExcerpt: entry.briefExcerpt ?? null,
    acceptance: Array.isArray(entry.acceptance) ? entry.acceptance : [],
  }))
}

function projectContext(session) {
  const context = session.context ?? null
  if (!context) return null
  return {
    policy: context.policy ?? null,
    contextSnapshotId: context.contextSnapshotId ?? null,
    projectId: context.projectId ?? session.project?.id ?? null,
    generatedAt: context.generatedAt ?? null,
    queryStatus: context.queryStatus ?? 'not-queried',
    query: context.query ?? null,
    readSet: projectReadSet(context.readSet),
    selected: context.selected
      ? {
          uid: context.selected.uid ?? null,
          revision: context.selected.revision ?? null,
          title: context.selected.title ?? null,
          contentHash: context.selected.contentHash ?? null,
        }
      : null,
    boundary: context.boundary ?? null,
    caution: context.boundary?.statement ?? null,
  }
}

function projectItem(item) {
  const candidate = effectiveCandidate(item)
  return {
    itemId: item.itemId,
    sourceRefs: Array.isArray(item.sourceRefs) ? item.sourceRefs : [],
    userProblem: item.userProblem ?? null,
    desiredOutcome: item.desiredOutcome ?? null,
    recommendedRoute: item.recommendedRoute ?? null,
    effectiveRoute: effectiveRoute(item),
    routeRationale: item.routeRationale ?? null,
    related: Array.isArray(item.related) ? item.related : [],
    assumptions: Array.isArray(item.assumptions) ? item.assumptions : [],
    unknowns: Array.isArray(item.unknowns) ? item.unknowns : [],
    candidate: candidate
      ? {
          title: candidate.title ?? null,
          problem: candidate.problem ?? null,
          goal: candidate.goal ?? null,
          inScope: candidate.inScope ?? [],
          outOfScope: candidate.outOfScope ?? [],
          acceptance: candidate.acceptance ?? [],
          owner: null,
          priority: null,
        }
      : null,
    counterexample: item.counterexample ?? null,
    valueCheck: item.valueCheck ?? null,
    fields: item.fields ?? {},
    excluded: item.excluded === true,
    summary: item.summary ?? null,
    editedFields: Object.keys(item.fields ?? {}),
  }
}

/**
 * @returns a JSON-serialisable projection of the session for the requirements plugin.
 */
export function renderSessionView(session) {
  if (!session || typeof session !== 'object') throw new TypeError('renderSessionView 需要 session')
  const readiness = evaluateReadiness({
    session,
    contextNow: session.context ?? null,
    project: session.project?.id ?? null,
    requireConfirmation: false,
  })
  const context = projectContext(session)
  const items = (Array.isArray(session.items) ? session.items : []).map(projectItem)
  const primary = items.find((item) => item.excluded !== true) ?? null
  return {
    schema: SESSION_VIEW_SCHEMA,
    sessionId: session.sessionId,
    project: clone(session.project ?? null),
    actor: session.actor ?? null,
    state: session.state ?? 'editing',
    createdAt: session.createdAt ?? null,
    updatedAt: session.updatedAt ?? null,
    input: {
      text: session.input?.text ?? '',
      extractedText: session.input?.extractedText ?? '',
      extractedTextTruncated: session.input?.extractedTextTruncated === true,
      source: session.input?.source ?? 'text',
      attachment: session.input?.attachment ?? null,
      inputRevision: session.input?.inputRevision ?? 1,
      inputHash: session.input?.inputHash ?? null,
      explicit: session.input?.explicit ?? { owner: null, priority: null },
    },
    answers: (Array.isArray(session.answers) ? session.answers : []).map((entry) => ({
      answerId: entry.answerId,
      itemId: entry.itemId ?? null,
      questionId: entry.questionId ?? null,
      optionId: entry.optionId ?? null,
      text: entry.text ?? null,
      at: entry.at ?? null,
      inputRevision: entry.inputRevision ?? null,
    })),
    runs: (Array.isArray(session.runs) ? session.runs : []).map((run) => ({
      analysisRunId: run.analysisRunId,
      status: run.status ?? null,
      startedAt: run.startedAt ?? null,
      finishedAt: run.finishedAt ?? null,
      provider: run.provider ?? null,
      model: run.model ?? null,
      errorCode: run.errorCode ?? null,
    })),
    context,
    contextStatement: context?.boundary?.statement ?? '尚未查询需求库，相关需求尚未核对。',
    items,
    primaryItemId: primary?.itemId ?? null,
    nextQuestion: session.nextQuestion
      ? {
          questionId: session.nextQuestion.questionId,
          itemIds: session.nextQuestion.itemIds ?? [],
          text: session.nextQuestion.text ?? '',
          whyNow: session.nextQuestion.whyNow ?? '',
          options: session.nextQuestion.options ?? [],
          allowFreeText: session.nextQuestion.allowFreeText !== false,
        }
      : null,
    confirmation: session.confirmation
      ? {
          route: session.confirmation.route ?? null,
          inputRevision: session.confirmation.inputRevision ?? null,
          contextSnapshotId: session.confirmation.contextSnapshotId ?? null,
          contentHash: session.confirmation.contentHash ?? null,
          at: session.confirmation.at ?? null,
          actor: session.confirmation.actor ?? null,
          model: session.confirmation.model ?? null,
        }
      : null,
    readiness: {
      ready: readiness.ready,
      reasons: readiness.reasons,
      warnings: readiness.warnings,
    },
    artifacts: Array.isArray(session.artifacts) ? session.artifacts : [],
    receipt: session.receipt ?? null,
    error: session.error ?? null,
    migratedFrom: session.migratedFrom ?? null,
    disclaimer: 'AI 解释不是事实；确认草稿不等于采纳、开工、验收、授权或发布。',
  }
}

export { lookupContextEntry, effectiveValue }
