import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

export { requirementContentHash } from '../model/content-hash.mjs'

/**
 * AI review reports are advisory inputs owned by the AI review/optimization flow.
 * They are deliberately independent from evidence, candidates and human sign-off.
 */
export const AI_REVIEW_SCHEMA = 'alm.ai-review/v1'
export const AI_REVIEW_DIR = '.alm/reviews'

export function aiReviewReportPath(root, requirementId) {
  return join(resolve(root), AI_REVIEW_DIR, `${requirementId}.ai.json`)
}

/** Read an advisory AI review report. Unknown schemas and malformed files are ignored. */
export function readAiReviewReport(root, requirementId) {
  const file = aiReviewReportPath(root, requirementId)
  if (!existsSync(file)) return null
  try {
    const payload = JSON.parse(readFileSync(file, 'utf8'))
    return payload.schema === AI_REVIEW_SCHEMA ? { ...payload, file } : null
  } catch {
    return null
  }
}
