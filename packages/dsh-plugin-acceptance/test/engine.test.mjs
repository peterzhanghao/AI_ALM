import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { runAcceptance, reviewAcceptance, showRound } from '../engine/index.mjs'
import { launchBrowser } from '../engine/runner.mjs'
import { cleanup, demoScenario, gitInit, makeWorkspace, writeScenario, writeServeModule } from './helpers.mjs'

const dirs = []
after(() => cleanup(dirs))

// The engine needs a browser; a machine without one must skip, not fail.
let browser = null
let unavailable = 'browser not launched'
try {
  const launched = await launchBrowser()
  browser = launched.browser
  unavailable = ''
} catch (error) {
  unavailable = error.message
}
after(async () => {
  if (browser) await browser.close()
})

const skip = browser ? false : `no browser available: ${unavailable}`

function workspace() {
  const root = makeWorkspace('alm-engine-')
  dirs.push(root)
  writeServeModule(root)
  return root
}

function failingScenario() {
  return demoScenario({
    checks: [
      ...demoScenario().checks,
      {
        id: 'missing-text',
        title: '页面上应当出现一段不存在的文案',
        expected: '看到 ABSENT-TEXT',
        steps: [{ goto: '/' }, { expectText: 'ABSENT-TEXT' }, { shot: 'failure' }],
      },
    ],
  })
}

test('a failing check makes the round fail, with evidence kept', { skip }, async () => {
  const root = workspace()
  writeScenario(root, 'demo-page', failingScenario())

  const round = await runAcceptance({ root, plugin: 'demo-plugin', browser })
  assert.equal(round.roundId, '001')
  assert.equal(round.verdict, 'fail')
  assert.deepEqual(round.stats, { pass: 2, fail: 1, blocked: 0 })
  assert.equal(round.failures.length, 1)
  assert.equal(round.failures[0].check, 'missing-text')
  assert.ok(round.failures[0].evidence.length > 0, 'a failure must still carry what was captured')
  assert.ok(round.failures[0].repro.length > 0)

  const roundDir = round.roundDir
  assert.ok(existsSync(join(roundDir, 'round.json')))
  assert.ok(existsSync(join(roundDir, 'report.html')))

  const shots = readdirSync(join(roundDir, 'evidence', 'demo-page'))
  assert.ok(shots.some((name) => name.endsWith('.png')))
  assert.ok(shots.some((name) => name.endsWith('.dom.json')))

  const report = readFileSync(join(roundDir, 'report.html'), 'utf8')
  assert.ok(report.includes('data:image/png;base64,'), 'report must inline the screenshots')
  assert.ok(report.includes('missing-text'))

  const stored = JSON.parse(readFileSync(join(roundDir, 'round.json'), 'utf8'))
  assert.equal(stored.subject.files.length >= 1, true, 'the scenario file is fingerprinted')
  assert.equal(stored.verdict, 'fail')
})

test('reviewer decisions are recorded against the round, never inside it', { skip }, async () => {
  const root = workspace()
  writeScenario(root, 'demo-page', failingScenario())
  const round = await runAcceptance({ root, plugin: 'demo-plugin', browser })
  const before = readFileSync(join(round.roundDir, 'round.json'), 'utf8')

  const reviewsFile = join(root, 'acceptance-reviews.json')
  writeFileSync(
    reviewsFile,
    JSON.stringify({
      schema: 'alm.plugin-acceptance.reviews/v1',
      acceptanceId: round.acceptanceId,
      roundId: round.roundId,
      format: 1,
      events: [
        { id: 'e1', kind: 'check', checkId: 'rows', action: 'accept', comment: '', createdAt: new Date().toISOString() },
        { id: 'e2', kind: 'check', checkId: 'dom', action: 'accept', comment: '', createdAt: new Date().toISOString() },
        { id: 'e3', kind: 'check', checkId: 'missing-text', action: 'reject', comment: '页面确实没有这段文案', createdAt: new Date().toISOString() },
      ],
    }),
    'utf8',
  )

  const review = reviewAcceptance({ root, plugin: 'demo-plugin', roundId: round.roundId, reviewsFile })
  assert.equal(review.events, 3)
  assert.deepEqual(review.gaps, [])
  assert.equal(review.decisions.checks.rows.action, 'accept')
  assert.equal(review.decisions.checks['missing-text'].comment, '页面确实没有这段文案')
  assert.equal(readFileSync(join(round.roundDir, 'round.json'), 'utf8'), before, 'round.json must not change')

  const shown = showRound({ root, plugin: 'demo-plugin', roundId: round.roundId })
  assert.equal(shown.decisions.checks.rows.action, 'accept')
  assert.equal(shown.drift.length, 0)

  const report = readFileSync(join(round.roundDir, 'report.html'), 'utf8')
  assert.ok(report.includes('已标记通过'), 'the refreshed report shows the recorded decisions')
  assert.ok(report.includes('已标记打回'))
})

test('reviews from another acceptance are rejected', { skip }, async () => {
  const root = workspace()
  writeScenario(root, 'demo-page', failingScenario())
  const round = await runAcceptance({ root, plugin: 'demo-plugin', browser })

  const reviewsFile = join(root, 'wrong.json')
  writeFileSync(reviewsFile, JSON.stringify({ acceptanceId: 'someone-else', events: [] }), 'utf8')
  assert.throws(
    () => reviewAcceptance({ root, plugin: 'demo-plugin', roundId: round.roundId, reviewsFile }),
    /belongs to acceptance someone-else/,
  )
})

test('a second run opens a new round and reports drift from the first', { skip }, async () => {
  const root = workspace()
  writeScenario(root, 'demo-page', failingScenario())
  const first = await runAcceptance({ root, plugin: 'demo-plugin', browser })
  const firstRound = readFileSync(join(first.roundDir, 'round.json'), 'utf8')

  // Touch the scenario so the second round is provably about different inputs.
  writeFileSync(join(root, 'acceptance', 'plugins', 'demo-page', 'scenarios', 'scenario.mjs'), `${readFileSync(join(root, 'acceptance', 'plugins', 'demo-page', 'scenarios', 'scenario.mjs'), 'utf8')}\n`, 'utf8')
  const second = await runAcceptance({ root, plugin: 'demo-plugin', browser })

  assert.equal(second.roundId, '002')
  assert.equal(readFileSync(join(first.roundDir, 'round.json'), 'utf8'), firstRound, 'earlier rounds are immutable')
  assert.equal(second.drift.length, 1, 'a changed scenario file is drift')
  assert.match(second.drift[0], /scenario\.mjs sha256 changed/)

  const secondReport = readFileSync(join(second.roundDir, 'report.html'), 'utf8')
  assert.ok(secondReport.includes('证据与当前代码不一致'), 'the report must warn that the evidence predates the current code')
})

test('a round cannot pass when HEAD is not the expected commit', { skip }, async () => {
  const root = workspace()
  gitInit(root)
  writeScenario(root, 'demo-page', demoScenario())

  const round = await runAcceptance({ root, plugin: 'demo-plugin', expectHead: '0'.repeat(40), browser })
  assert.equal(round.verdict, 'blocked')
  assert.ok(round.cases.some((entry) => entry.id === 'fingerprint-head' && entry.status === 'blocked'))
  assert.equal(round.stats.pass, 2, 'the UI checks may still pass; the round is blocked by provenance')
})

test('a plugin without a scenario fails fast and explains where to put one', { skip }, async () => {
  const root = workspace()
  await assert.rejects(
    () => runAcceptance({ root, plugin: 'unknown-plugin', browser }),
    /no acceptance scenario declares plugin unknown-plugin/,
  )
})
