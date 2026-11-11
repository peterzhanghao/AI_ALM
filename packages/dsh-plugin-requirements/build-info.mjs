/**
 * Build identity for the requirements plugin.
 *
 * A stale client bundle is invisible by construction: the page keeps running
 * whatever code it loaded at boot, while the server keeps serving the current
 * module. Feedback v2 needs to *prove* which side is old, so both sides carry
 * the same constant and the server exposes it for comparison:
 *
 * - the server imports this module and reports `clientBuild` in
 *   `GET /api/alm/requirements/feedback?action=diagnostics`;
 * - the client hard-codes `FEEDBACK_CLIENT_BUILD` (it cannot import this file:
 *   the browser bundle is built by the host, not by this package) and shows a
 *   visible warning when it differs from the server value.
 *
 * `packages/dsh-plugin-requirements/test/feedback-build.test.mjs` asserts the
 * two constants stay in sync, so a bump cannot silently drift.
 */
export const FEEDBACK_BUILD = 'feedback-v2/2026-11-03.1'
export const FEEDBACK_BUILD_AT = '2026-11-03T10:50:00+08:00'
export const FEEDBACK_CLIENT_BUILD = FEEDBACK_BUILD

export function feedbackBuildInfo() {
  return {
    schema: 'alm.feedback.build/v1',
    clientBuild: FEEDBACK_CLIENT_BUILD,
    buildAt: FEEDBACK_BUILD_AT,
  }
}
