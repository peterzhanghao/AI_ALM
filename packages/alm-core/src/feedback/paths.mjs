/**
 * Paths for the feedback ledger.
 *
 * Everything lives under the *observed* workspace root in `.alm/feedback/`:
 * feedback records, the routing settings and the proposals that a feedback may
 * be converted into. Paths are derived in one place so the plugin never has to
 * know the on-disk layout.
 */
import { readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

export const FEEDBACK_DIR = '.alm/feedback'
export const FEEDBACK_SETTINGS_FILE = 'settings.json'
export const FEEDBACK_RECORDS_DIR = 'records'
export const FEEDBACK_PROPOSALS_DIR = 'proposals'

export const FEEDBACK_RECORD_ID = /^FB-\d{4}$/
export const FEEDBACK_PROPOSAL_ID = /^IMP-\d{4}$/
export const CONTEXT_SNAPSHOT_ID = /^FCTX-\d{4}$/
export const REQUIREMENT_ID = /^REQ-[A-Z0-9]{2,8}-\d{3}$/

export function resolveRoot(root) {
  return resolve(root ?? process.cwd())
}

export function feedbackRoot(root) {
  return join(resolveRoot(root), FEEDBACK_DIR)
}

export function feedbackSettingsPath(root) {
  return join(feedbackRoot(root), FEEDBACK_SETTINGS_FILE)
}

export function feedbackRecordsDir(root) {
  return join(feedbackRoot(root), FEEDBACK_RECORDS_DIR)
}

export function feedbackProposalsDir(root) {
  return join(feedbackRoot(root), FEEDBACK_PROPOSALS_DIR)
}

export function feedbackRecordPath(root, id) {
  return join(feedbackRecordsDir(root), `${id}.json`)
}

export function feedbackProposalPath(root, id) {
  return join(feedbackProposalsDir(root), `${id}.json`)
}

export function isFeedbackRecordId(value) {
  return FEEDBACK_RECORD_ID.test(String(value ?? ''))
}

export function isFeedbackProposalId(value) {
  return FEEDBACK_PROPOSAL_ID.test(String(value ?? ''))
}

/** `readdirSync` that treats a missing/unreadable directory as empty. */
export function readDirSafe(absolute) {
  try {
    return readdirSync(absolute)
  } catch {
    return []
  }
}

export function padSequence(value) {
  return String(value).padStart(4, '0')
}
