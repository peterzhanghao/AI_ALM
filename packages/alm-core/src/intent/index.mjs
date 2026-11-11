/**
 * Intent clarification core.
 *
 * One human intent -> one session. The model proposes interpretations and
 * questions; a human confirms one route; the core then writes a *draft*
 * (proposed requirement, change draft, investigation) or just a receipt. No
 * function here approves, executes, publishes, assigns an owner/priority, or
 * edits an existing requirement document.
 */
export {
  ANALYSIS_SCHEMA,
  ANALYSIS_SCHEMA_V2,
  AUDIT_SCHEMA,
  BLOCKING_FOR,
  CHANGE_DRAFT_SCHEMA,
  CONTEXT_POLICY,
  DEFAULT_LIMIT,
  ERROR_STATUS,
  IDEMPOTENCY_SCHEMA,
  INPUT_SOURCES,
  INTENT_SCHEMA,
  INTENT_SCHEMA_VERSION,
  INVESTIGATION_SCHEMA,
  ITEM_ROUTES,
  JOURNAL_SCHEMA,
  LEGACY_SCHEMAS,
  MATCHES,
  MAX_EXTRACTED_TEXT,
  MAX_LIMIT,
  MAX_TITLE,
  RECEIPT_SCHEMA,
  RESOLUTIONS,
  ROUTES,
  SESSION_STATES,
  UNKNOWN_KINDS,
  IntentError,
  intentError,
  isIntentError,
  rethrowAsIntent,
} from './errors.mjs'

export {
  asString,
  canonicalJson,
  cleanLine,
  clone,
  dateFrom,
  dirExists,
  ensureDir,
  fileExists,
  intentRoot,
  isPlainObject,
  listJsonFiles,
  listSubdirs,
  normalizeStringList,
  nowIso,
  randomHex,
  readJsonFile,
  repoRelative,
  safeRepoPath,
  sha256Hex,
  shortHash,
  stamp,
  truncateText,
  tryReadJsonFile,
  writeFileAtomic,
  writeJsonAtomic,
} from './util.mjs'

export { buildIntentContext, readBrief, tokensOf } from './context.mjs'
export { currentInvestigationEvidence } from './investigation-evidence.mjs'

export {
  SESSIONS_DIR,
  attachContext,
  bumpSessionRevision,
  cancelSession,
  contextOrDefault,
  createSession,
  emptyContext,
  listSessions,
  loadSession,
  makeInput,
  newEntityId,
  newSessionId,
  normalizeSession,
  questionProgress,
  recordAnalysis,
  recordAnswer,
  recordAnswers,
  routeOfSession,
  saveSession,
  sessionFile,
  sessionsDir,
  setDocDraft,
  setEdits,
  setInput,
  lockClauses,
  unlockClauses,
} from './session.mjs'

export {
  ANALYSIS_SCHEMA_V3,
  DOC_DRAFT_SCHEMA,
  applyAnalysis,
  effectiveCandidate,
  effectiveRoute,
  effectiveValue,
  mergeQuestionGroup,
  normalizeAnalysis,
  normalizeDocDraft,
  normalizeQuestions,
  synthesizeLegacyDocDraft,
} from './analysis.mjs'

export {
  READINESS_CODES,
  REASON_TEXT,
  candidateOf,
  evaluateDraftReadiness,
  evaluateReadiness,
  lookupContextEntry,
  resolveChangeBase,
} from './readiness.mjs'

export { INTENT_SYSTEM_PROMPT, buildAnalysisMessages } from './messages.mjs'

export {
  INTENT_DIRS,
  computeConfirmationContentHash,
  confirmIntent,
  dirOf,
  idempotencyPath,
  journalPath,
  receiptPath,
} from './confirm.mjs'

export { SESSION_VIEW_SCHEMA, renderSessionView, historicalAnswerPage } from './view.mjs'

export { migrateIntentStore } from './migrate.mjs'
