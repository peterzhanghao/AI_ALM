/**
 * Manual feedback loop (slice 1) — core API.
 *
 * The feedback ledger lives inside the *observed* workspace under
 * `.alm/feedback/`; no database, no new dependency. Callers (the requirements
 * plugin) only use the functions exported here.
 */
export { FEEDBACK_DIR, FEEDBACK_RECORD_ID, FEEDBACK_PROPOSAL_ID, CONTEXT_SNAPSHOT_ID } from './paths.mjs'

export {
  PROPOSAL_KINDS,
  PROPOSAL_SCHEMA,
  PROPOSAL_STATUSES,
  FEEDBACK_CATEGORIES,
  FEEDBACK_CATEGORY_LABELS,
  FEEDBACK_CONTEXT_SCHEMA,
  FEEDBACK_INBOX_SCHEMA,
  FEEDBACK_LIMITS,
  FEEDBACK_PAGES,
  FEEDBACK_SCHEMA,
  FEEDBACK_SETTINGS_SCHEMA,
  FEEDBACK_STAGES,
  FEEDBACK_STATUSES,
  FeedbackError,
  DEFAULT_FEEDBACK_SETTINGS,
  feedbackError,
  readFeedbackSettings,
  writeFeedbackSettings,
} from './store.mjs'

export { redactValue, redactPaths, redactText } from './redact.mjs'

export { normalizeContextEnvelope } from './context.mjs'

export { ATTACHMENT_LIMITS, ATTACHMENT_SCHEMA, readAttachment, saveAttachment } from './attachments.mjs'

export {
  FEEDBACK_DISPOSITIONS,
  FEEDBACK_PROCESSING_STATES,
  FEEDBACK_RECONCILIATION_STATES,
  FEEDBACK_RESOLUTION_STATES,
  appendSupplement,
  enqueueFeedbackProcessing,
  feedbackInbox,
  listFeedback,
  listFeedbackProcessing,
  markFeedbackFailed,
  markFeedbackReconciliation,
  markFeedbackRequirement,
  readFeedback,
  recoverFeedbackProcessing,
  routeFeedback,
  saveFeedback,
  beginFeedbackConversion,
  updateFeedbackConversion,
  updateFeedbackCategory,
  updateFeedbackDisposition,
  updateFeedbackProcessing,
  updateFeedbackResolution,
  validateDestination,
} from './records.mjs'

export {
  confirmProposal,
  planProposal,
  listProposals,
  proposalFingerprint,
  readProposal,
  saveProposal,
  updateProposal,
} from './proposals.mjs'
