/**
 * Intent-clarification core: shared schema constants and the single error type.
 *
 * The intent store is deliberately separate from requirements: a session, a
 * change draft or an investigation never mutates `requirements/*.sdoc`. Only an
 * explicit human confirmation with a valid priority may create a requirement,
 * and even that write goes through `createRequirement`.
 */

export const INTENT_SCHEMA = 'alm.intent-session/v1'
export const INTENT_SCHEMA_VERSION = 1
export const ANALYSIS_SCHEMA = 'intent-review.v1'
export const CHANGE_DRAFT_SCHEMA = 'alm.intent.change-draft/v1'
export const INVESTIGATION_SCHEMA = 'alm.intent.investigation/v1'
export const RECEIPT_SCHEMA = 'alm.intent.receipt/v1'
export const AUDIT_SCHEMA = 'alm.intent.audit/v1'
export const IDEMPOTENCY_SCHEMA = 'alm.intent.idempotency/v1'
export const JOURNAL_SCHEMA = 'alm.intent.journal/v1'
export const CONTEXT_POLICY = 'intent-context/v1'
export const LEGACY_SCHEMAS = new Set(['alm.intents.legacy/v0', 'alm.intent.legacy/v0', 'alm.intents/v0'])

export const ROUTES = ['create', 'change', 'reuse', 'investigate', 'decline', 'answer']

export const ITEM_ROUTES = ROUTES

export const SESSION_STATES = [
  'editing',
  'analyzing',
  'needs_input',
  'ready_for_confirmation',
  'committed',
  'cancelled',
  'failed',
]

export const INPUT_SOURCES = ['text', 'ocr', 'chat']

export const MATCHES = ['covered', 'related', 'conflict', 'uncertain']

export const RESOLUTIONS = ['clarify', 'investigate', 'exclude', 'pending']

export const MAX_EXTRACTED_TEXT = 20000
export const MAX_TITLE = 200
export const MAX_LIMIT = 50
export const DEFAULT_LIMIT = 8

/** Stable machine error codes used by the HTTP layer. */
export const ERROR_STATUS = {
  'invalid-request': 400,
  'empty-input': 400,
  'invalid-input': 400,
  'invalid-session': 400,
  'invalid-confirmation': 400,
  'idempotency-key-required': 400,
  'unknown-session': 404,
  'unknown-requirement': 404,
  'unknown-route': 422,
  'executable-field': 422,
  'model-assigned-owner': 422,
  'model-assigned-priority': 422,
  'invalid-schema-version': 422,
  'invalid-analysis': 422,
  'context-mismatch': 409,
  'stale-input': 409,
  'stale-context': 409,
  'already-committed': 409,
  'idempotency-conflict': 409,
  'project-mismatch': 409,
  'not-ready': 422,
  'unresolved-source': 422,
  'missing-acceptance': 422,
  'invalid-change-base': 422,
  'write-failed': 500,
  'ai-invalid-output': 502,
  'context-read-failed': 503,
}

export class IntentError extends Error {
  constructor(message, { code = 'intent', status, details = {} } = {}) {
    super(message)
    this.name = 'IntentError'
    this.code = code
    this.status = status ?? ERROR_STATUS[code] ?? 400
    this.details = details ?? {}
  }
}

/** Convenience constructor so every throw site carries a stable code/status. */
export function intentError(code, message, details = {}, status) {
  return new IntentError(message, { code, status, details })
}

export function isIntentError(error) {
  return error instanceof IntentError || (error && error.name === 'IntentError' && typeof error.code === 'string')
}

/** Wrap a third-party error as an intent error without losing its code. */
export function rethrowAsIntent(error, fallback) {
  if (isIntentError(error)) throw error
  throw new IntentError(error?.message ?? String(error), {
    code: fallback?.code ?? 'intent',
    status: fallback?.status,
    details: { causeCode: error?.code ?? null, cause: error?.message ?? String(error) },
  })
}
