import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, test } from 'node:test'
import {
  beginRound,
  decisionSummary,
  failRound,
  finishRound,
  latestCompletedRound,
  listRounds,
  pluginSlug,
  readRound,
  recordReviews,
  reviewGaps,
  statsOf,
  verdictOf,
} from '../engine/rounds.mjs'
import { cleanup, makeWorkspace } from './helpers.mjs'

const dirs = []
after(() => cleanup(dirs))

function workspace() {
  const root = makeWorkspace()
  dirs.push(root)
  return root
}

const cases = [
  { id: 'a', title: 'A', status: 'pass' },
  { id: 'b', title: 'B', status: 'fail' },
]

test('rounds are sequential, immutable and git-ignored', () => {
  const root = workspace()
  const first = beginRound({ root, plugin: '@ai-alm/demo', level: 'L1' })
  assert.equal(first.roundId, '001')
  assert.equal(pluginSlug('@ai-alm/demo'), 'ai-alm-demo')
  assert.ok(existsSync(join(root, '.alm', 'acceptance2', '.gitignore')))

  finishRound(first.dir, { schema: 'alm.plugin-acceptance/v1', roundId: '001', verdict: 'fail' })
  assert.deepEqual(readRound(first.dir).verdict, 'fail')
  assert.throws(() => finishRound(first.dir, { roundId: '001' }), /immutable/)

  const second = beginRound({ root, plugin: '@ai-alm/demo' })
  assert.equal(second.roundId, '002')
  assert.notEqual(second.acceptanceId, first.acceptanceId)
})

test('listing shows running and failed rounds without inventing a verdict', () => {
  const root = workspace()
  const running = beginRound({ root, plugin: 'p' })
  const failed = beginRound({ root, plugin: 'p' })
  failRound(failed.dir, new Error('browser missing'))

  const rounds = listRounds({ root, plugin: 'p' })
  assert.equal(rounds.length, 2)
  assert.equal(rounds[0].roundId, '002')
  assert.equal(rounds[0].status, 'failed')
  assert.equal(rounds[0].verdict, null)
  assert.equal(rounds[1].status, 'running')
  assert.equal(rounds[1].roundId, running.roundId)
})

test('verdict and stats are derived from cases', () => {
  assert.equal(verdictOf([{ status: 'pass' }]), 'pass')
  assert.equal(verdictOf([{ status: 'pass' }, { status: 'fail' }]), 'fail')
  assert.equal(verdictOf([{ status: 'pass' }, { status: 'blocked' }]), 'blocked')
  assert.equal(verdictOf([]), 'blocked')
  assert.deepEqual(statsOf(cases), { pass: 1, fail: 1, blocked: 0 })
})

test('latestCompletedRound skips unfinished rounds and honours requirement', () => {
  const root = workspace()
  for (const [index, requirement] of ['REQ-A', 'REQ-B', 'REQ-A'].entries()) {
    const round = beginRound({ root, plugin: 'p', requirement })
    finishRound(round.dir, { roundId: round.roundId, requirement, verdict: 'pass' })
    assert.equal(listRounds({ root, plugin: 'p' })[0].roundId, String(index + 1).padStart(3, '0'))
  }
  beginRound({ root, plugin: 'p', requirement: 'REQ-A' })
  const latest = latestCompletedRound({ root, plugin: 'p', requirement: 'REQ-A' })
  assert.equal(latest.roundId, '003')
})

test('reviews are append-only, deduplicated and validate rejections', () => {
  const root = workspace()
  const round = beginRound({ root, plugin: 'p' })
  const document = { roundId: round.roundId, roundIndex: 1, acceptanceId: round.acceptanceId, cases }
  finishRound(round.dir, document)

  const first = recordReviews({
    dir: round.dir,
    round: document,
    decisions: [{ id: 'e1', check: 'a', action: 'accept' }],
  })
  assert.equal(first.events.length, 1)
  assert.equal(first.acceptanceId, round.acceptanceId)
  assert.equal(first.format, 1)

  const again = recordReviews({ dir: round.dir, round: document, decisions: [{ id: 'e1', check: 'a', action: 'accept' }] })
  assert.equal(again.events.length, 1, 'same event id must not be recorded twice')

  recordReviews({
    dir: round.dir,
    round: document,
    decisions: [{ id: 'e2', check: 'b', action: 'accept' }, { id: 'e3', check: 'b', action: 'reject', comment: '缺证据' }],
  })
  const saved = JSON.parse(readFileSync(join(round.dir, 'reviews.json'), 'utf8'))
  assert.equal(saved.events.length, 3)

  const summary = decisionSummary(saved)
  assert.equal(summary.checks.b.action, 'reject', 'latest decision wins')
  assert.equal(summary.checks.b.comment, '缺证据')
  assert.deepEqual(reviewGaps(document, saved), [])

  assert.throws(
    () => recordReviews({ dir: round.dir, round: document, decisions: [{ check: 'b', action: 'reject' }] }),
    /requires a comment/,
  )
  assert.throws(() => recordReviews({ dir: round.dir, round: document, decisions: [{ check: 'b', action: 'maybe' }] }), /accept or reject/)
})

test('a round keeps its evidence when the verdict changes in a later round', () => {
  const root = workspace()
  const one = beginRound({ root, plugin: 'p' })
  finishRound(one.dir, { roundId: '001', verdict: 'fail', cases })
  const two = beginRound({ root, plugin: 'p' })
  finishRound(two.dir, { roundId: '002', verdict: 'pass', cases })
  assert.equal(readRound(one.dir).verdict, 'fail')
  assert.equal(readRound(two.dir).verdict, 'pass')
})
