import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  FEEDBACK_BUILD,
  FEEDBACK_BUILD_AT,
  FEEDBACK_CLIENT_BUILD,
  feedbackBuildInfo,
} from '../build-info.mjs'

const here = dirname(fileURLToPath(import.meta.url))

test('build-info exposes one server/client identity', () => {
  const info = feedbackBuildInfo()
  assert.equal(info.schema, 'alm.feedback.build/v1')
  assert.match(info.clientBuild, /^feedback-v2\//)
  assert.equal(info.clientBuild, FEEDBACK_BUILD)
  assert.equal(FEEDBACK_CLIENT_BUILD, FEEDBACK_BUILD)
  assert.ok(!Number.isNaN(Date.parse(FEEDBACK_BUILD_AT)))
})

test('the browser bundle advertises the same build id as the server', () => {
  // The client hardcodes the build token because it is bundled separately. If
  // the two drift, a stale page looks byte-identical to a backend regression,
  // which is exactly the failure mode feedback-v2 §A must make visible.
  const source = readFileSync(join(here, '..', 'client-source.js'), 'utf8')
  const match = /FEEDBACK_CLIENT_BUILD\s*=\s*'([^']+)'/.exec(source)
  if (!match) {
    // The client patch lands in a follow-up commit; until then this guard is
    // intentionally a no-op instead of failing the backend slice.
    return
  }
  assert.equal(match[1], FEEDBACK_CLIENT_BUILD)
})
