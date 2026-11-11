/**
 * UI projection of a session.
 *
 * The view is a plain JSON object (safe to hand to a browser): it exposes the
 * model's suggestions *and* the human's overrides, the honest context boundary,
 * and the machine readiness reasons, but never grants anything. Buttons are a
 * rendering of `readiness.reasons`, not the source of truth.
 */
import { effectiveCandidate, effectiveRoute, effectiveValue } from './analysis.mjs'
import { evaluateDraftReadiness, evaluateReadiness, lookupContextEntry } from './readiness.mjs'
import { questionProgress } from './session.mjs'
import { clone, sha256Hex } from './util.mjs'

export const SESSION_VIEW_SCHEMA = 'alm.intent.session-view/v1'

export function historicalAnswerPage(session, offset = 0) {
  const history = (Array.isArray(session?.answers) ? session.answers : []).filter(entry => entry && (entry.supersededBy != null || entry.inputRevision !== session.input?.inputRevision)).reverse().map(entry => ({
    answerId: entry.answerId ?? null, questionText: entry.questionText ?? null,
    optionId: entry.optionId ?? null, optionLabel: entry.optionLabel ?? null, text: entry.text ?? null,
    at: entry.at ?? null, inputRevision: entry.inputRevision ?? null, superseded: entry.supersededBy != null,
  }))
  return { snapshot: sha256Hex(history), answers: history.slice(offset, offset + 20), next: offset + 20 < history.length ? offset + 20 : null, total: history.length }
}

function derivedDecisionId(question) {
  return `DEC-${sha256Hex(`${question.questionId}|${question.text}`).slice(0, 10)}`
}

function activeAnswerFor(answers, questionId, inputRevision) {
  for (let index = answers.length - 1; index >= 0; index -= 1) {
    const answer = answers[index]
    if (answer?.supersededBy == null && answer?.questionId === questionId && answer.inputRevision === inputRevision) return answer
  }
  return null
}

/**
 * Read-only compatibility group for sessions created before `questionGroup`
 * existed: the stored single `nextQuestion` becomes a one-question group. It is
 * never persisted; new writes go to the real group.
 */
function compatQuestionGroup(session) {
  if (session.questionGroup) return session.questionGroup
  const question = session.nextQuestion
  if (!question) return null
  const answers = Array.isArray(session.answers) ? session.answers : []
  const status = activeAnswerFor(answers, question.questionId, session.input?.inputRevision) ? 'answered' : 'open'
  return {
    groupId: null,
    analysisRunId: null,
    createdAt: null,
    updatedAt: null,
    questions: [
      {
        questionId: question.questionId,
        decisionId: question.decisionId ?? derivedDecisionId(question),
        itemIds: Array.isArray(question.itemIds) ? question.itemIds : [],
        text: question.text ?? '',
        whyNow: question.whyNow ?? null,
        impact: question.impact ?? null,
        materiality: question.materiality ?? 'major',
        recommendedOptionId: question.recommendedOptionId ?? null,
        options: Array.isArray(question.options) ? question.options : [],
        allowFreeText: question.allowFreeText !== false,
        dependsOn: [],
        status,
        staleReason: null,
        analysisRunId: null,
        synthetic: true,
      },
    ],
  }
}

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

/** Compact provenance/staleness marker for a requirement draft. */
function draftSummary(draft) {
  if (!draft || typeof draft !== 'object') return null
  return {
    docHash: draft.docHash ?? null,
    draftRevision: Number.isInteger(draft.draftRevision) ? draft.draftRevision : null,
    basedOnInputRevision: Number.isInteger(draft.basedOnInputRevision) ? draft.basedOnInputRevision : null,
    basedOnSessionRevision: Number.isInteger(draft.basedOnSessionRevision) ? draft.basedOnSessionRevision : null,
  }
}

function projectItem(item) {
  const candidate = effectiveCandidate(item)
  return {
    itemId: item.itemId,
    docDraft: draftSummary(item.docDraft),
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
  const draftReadiness = evaluateDraftReadiness({
    session,
    contextNow: session.context ?? null,
    project: session.project?.id ?? null,
    requireConfirmation: false,
  })
  const questionGroup = compatQuestionGroup(session)
  const progress = questionProgress({ questionGroup })
  const pendingDecisions = (questionGroup?.questions ?? [])
    .filter((question) => question.status === 'open' || question.status === 'stale')
    .map((question) => ({
      decisionId: question.decisionId ?? null,
      questionId: question.questionId ?? null,
      status: question.status,
      text: question.text ?? '',
      impact: question.impact ?? null,
      materiality: question.materiality ?? 'major',
      recommendedOptionId: question.recommendedOptionId ?? null,
      dependsOn: Array.isArray(question.dependsOn) ? question.dependsOn : [],
    }))
  const runs = Array.isArray(session.runs) ? session.runs : []
  const timedRun = [...runs].reverse().find((run) => Number.isFinite(run?.timing?.totalMs))
  const timingSummary = {
    lastRun: timedRun
      ? {
          analysisRunId: timedRun.analysisRunId ?? null,
          totalMs: timedRun.timing.totalMs,
          modelMs: Number.isFinite(timedRun.timing.modelMs) ? timedRun.timing.modelMs : null,
          firstTokenMs: Number.isFinite(timedRun.timing.firstTokenMs) ? timedRun.timing.firstTokenMs : null,
        }
      : null,
  }
  const context = projectContext(session)
  const items = (Array.isArray(session.items) ? session.items : []).map(projectItem)
  const primary = items.find((item) => item.excluded !== true) ?? null
  const allAnswers = Array.isArray(session.answers) ? session.answers : []
  const historicalAnswers = historicalAnswerPage(session)
  return {
    schema: SESSION_VIEW_SCHEMA,
    sessionId: session.sessionId,
    project: clone(session.project ?? null),
    actor: session.actor ?? null,
    state: session.state ?? 'editing',
    sessionRevision: Number.isInteger(session.sessionRevision) ? session.sessionRevision : 1,
    docDraft: session.docDraft ? clone(session.docDraft) : null,
    draftRevision: Number.isInteger(session.draftRevision) ? session.draftRevision : 0,
    lockedClauses: Array.isArray(session.lockedClauses) ? clone(session.lockedClauses) : [],
    questionGroup: questionGroup ? clone(questionGroup) : null,
    questionProgress: progress,
    convergence: clone(session.convergence ?? null),
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
    answers: allAnswers
      .filter((entry) => entry?.supersededBy == null && entry.inputRevision === session.input?.inputRevision)
      .map((entry) => ({
        answerId: entry.answerId,
        itemId: entry.itemId ?? null,
        questionId: entry.questionId ?? null,
        decisionId: entry.decisionId ?? null,
        optionId: entry.optionId ?? null,
        optionLabel: entry.optionLabel ?? null,
        questionText: entry.questionText ?? null,
        options: Array.isArray(entry.options) ? entry.options : null,
        text: entry.text ?? null,
        at: entry.at ?? null,
        inputRevision: entry.inputRevision ?? null,
        sessionRevision: entry.sessionRevision ?? null,
        supersededBy: null,
      })),
    answerHistoryCount: allAnswers.length,
    historicalAnswers: historicalAnswers.answers,
    historicalAnswersOmitted: Math.max(0, historicalAnswers.total - historicalAnswers.answers.length),
    historicalAnswersSnapshot: historicalAnswers.snapshot,
    historicalAnswersNext: historicalAnswers.next,
    runs: runs.map((run) => ({
      analysisRunId: run.analysisRunId,
      status: run.status ?? null,
      startedAt: run.startedAt ?? null,
      finishedAt: run.finishedAt ?? null,
      provider: run.provider ?? null,
      model: run.model ?? null,
      errorCode: run.errorCode ?? null,
      timing: run.timing ?? null,
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
    draftReadiness: {
      ready: draftReadiness.ready,
      reasons: draftReadiness.reasons,
      warnings: draftReadiness.warnings,
    },
    pendingDecisions,
    timingSummary,
    artifacts: Array.isArray(session.artifacts) ? session.artifacts : [],
    receipt: session.receipt ?? null,
    error: session.error ?? null,
    migratedFrom: session.migratedFrom ?? null,
    disclaimer: 'AI 解释不是事实；确认草稿不等于采纳、开工、验收、授权或发布。',
  }
}

export { lookupContextEntry, effectiveValue }
