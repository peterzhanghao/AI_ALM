/**
 * Plugin acceptance engine (L1).
 *
 * One call = one immutable round: load the scenarios that describe the plugin's
 * observable behaviour, serve the current source, drive a browser, capture
 * evidence, derive the verdict and render a self-contained report.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fingerprintDrift, subjectFingerprint } from './fingerprint.mjs'
import { renderReport } from './report.mjs'
import {
  beginRound,
  decisionSummary,
  failRound,
  finishRound,
  latestCompletedRound,
  listRounds,
  pluginRoot,
  readReviews,
  readRound,
  recordReviews,
  reviewGaps,
  statsOf,
  verdictOf,
  writeReport,
} from './rounds.mjs'
import { runScenario } from './runner.mjs'
import { describeScenario, loadScenarios } from './scenarios.mjs'

export const ENGINE_SCHEMA = 'alm.plugin-acceptance.engine/v1'

/**
 * Locate the installed/workspace package for a plugin name so the round can
 * record which manifest and entry file it actually exercised.
 *
 * @param {{root: string, plugin: string}} options
 * @returns {{dir: string, manifest: string, version: string|null, entry: string|null}|null}
 */
export function resolvePluginPackage({ root, plugin }) {
  const candidates = []
  const direct = join(root, 'node_modules', ...plugin.split('/'), 'package.json')
  candidates.push(direct)
  const packagesDir = join(root, 'packages')
  try {
    for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
      if (entry.isDirectory()) candidates.push(join(packagesDir, entry.name, 'package.json'))
    }
  } catch {
    /* no packages dir */
  }
  for (const manifest of candidates) {
    try {
      const parsed = JSON.parse(readFileSync(manifest, 'utf8'))
      if (parsed.name !== plugin) continue
      const dir = manifest.slice(0, manifest.length - 'package.json'.length)
      const entry = typeof parsed.exports === 'string' ? parsed.exports : parsed.exports?.['.'] ?? parsed.main ?? null
      return { dir, manifest, version: parsed.version ?? null, entry: entry ? join(dir, entry) : null }
    } catch {
      /* try next */
    }
  }
  return null
}

/**
 * Start the page source a scenario declares: a pre-running base URL, or a
 * module exporting a `serve(...)` that returns `{ url, close() }`.
 *
 * @param {{root: string, start: object}} options
 */
async function startScenario({ root, start }) {
  if (start.base) return { base: start.base, close: async () => {} }

  const modulePath = isAbsolute(start.module) ? start.module : resolve(root, start.module)
  if (!existsSync(modulePath)) throw new Error(`scenario start module not found: ${start.module}`)
  const module = await import(pathToFileURL(modulePath).href)
  const fn = module[start.export] ?? module.default
  if (typeof fn !== 'function') throw new Error(`scenario start module ${start.module} does not export ${start.export}`)

  const options = { ...start.options }
  if (typeof options.root === 'string' && !isAbsolute(options.root)) options.root = resolve(root, options.root)
  const served = await fn(options)
  if (!served || typeof served.url !== 'string') throw new Error(`scenario start module ${start.module} must resolve { url }`)
  return { base: served.url, close: async () => (typeof served.close === 'function' ? served.close() : undefined) }
}

/** Read a Playwright version without importing the whole package. */
function playwrightVersion(root) {
  for (const dir of [join(root, 'node_modules', 'playwright'), join(root, 'node_modules', 'playwright-core')]) {
    try {
      return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version ?? null
    } catch {
      /* not installed here */
    }
  }
  return null
}

function summarizeCases(cases) {
  return cases.map((entry) => ({
    id: entry.id,
    title: entry.title,
    status: entry.status,
    observation: entry.observation,
    level: entry.level,
    evidence: (entry.evidence ?? []).map((item) => item.path),
  }))
}

/**
 * Run one acceptance round.
 *
 * @param {{
 *   root: string,
 *   plugin: string,
 *   requirement?: string|null,
 *   level?: 'L1'|'L2',
 *   scenarios?: string[],
 *   ids?: string[],
 *   expectHead?: string|null,
 *   timeout?: number,
 *   browser?: object,
 * }} options
 * @returns {Promise<object>} round summary plus `roundDir` and `report`
 */
export async function runAcceptance({
  root,
  plugin,
  requirement = null,
  level = 'L1',
  scenarios: paths = [],
  ids = [],
  expectHead = null,
  timeout,
  browser = null,
}) {
  const workspace = resolve(root)
  const loaded = await loadScenarios({ root: workspace, plugin, paths, ids })
  if (loaded.length === 0) {
    throw new Error(`no acceptance scenario declares plugin ${plugin}; add one under acceptance/plugins/*/scenarios/`)
  }
  const selected = loaded.filter((scenario) => scenario.level === level)
  if (selected.length === 0) {
    const available = [...new Set(loaded.map((scenario) => scenario.level))].join(', ')
    throw new Error(`no scenario for level ${level}; available: ${available}`)
  }

  const pkg = resolvePluginPackage({ root: workspace, plugin })
  const files = [
    ...(pkg ? [pkg.manifest, pkg.entry].filter(Boolean) : []),
    ...selected.map((scenario) => scenario.source).filter(Boolean),
  ]

  const { roundId, dir, acceptanceId } = beginRound({ root: workspace, plugin, requirement, level })
  const startedAt = new Date().toISOString()

  try {
    const cases = []
    let channel = null
    let version = null

    for (const scenario of selected) {
      const started = await startScenario({ root: workspace, start: scenario.start })
      try {
        const result = await runScenario({
          scenario,
          base: started.base,
          evidenceDir: join(dir, 'evidence', scenario.id),
          evidencePrefix: `evidence/${scenario.id}`,
          timeout,
          browser,
        })
        channel = result.channel ?? channel
        version = result.version ?? version
        for (const entry of result.cases) {
          cases.push({ ...entry, scenario: scenario.id, id: selected.length > 1 ? `${scenario.id}--${entry.id}` : entry.id })
        }
      } finally {
        await started.close().catch(() => {})
      }
    }

    // A failure is only actionable if the reviewer can reproduce it, so every
    // case carries the exact scenario command even when the scenario omitted it.
    for (const entry of cases) {
      if (entry.scenario && !(entry.repro ?? []).length) {
        entry.repro = [`pnpm acceptance run --plugin ${plugin} --scenario ${entry.scenario} --level ${level}`]
      }
    }

    const subject = subjectFingerprint({
      root: workspace,
      files,
      browser: version ? `${channel ?? 'browser'} ${version}` : null,
      playwright: playwrightVersion(workspace),
    })

    if (expectHead) {
      const head = subject.git.headSha
      cases.push({
        id: 'fingerprint-head',
        title: '本轮证据对应的提交与预期一致',
        expected: `HEAD = ${expectHead}`,
        requirement,
        category: 'provenance',
        surface: 'none',
        level,
        status: head === expectHead ? 'pass' : 'blocked',
        observation: head === expectHead ? head : `HEAD 是 ${head ?? '未知'}，预期 ${expectHead}`,
        repro: [],
        steps: [],
        evidence: [],
        durationMs: 0,
      })
    }

    const stats = statsOf(cases)
    const verdict = verdictOf(cases)
    const previous = latestCompletedRound({ root: workspace, plugin, requirement, before: roundId })
    const drift = previous?.subject ? fingerprintDrift(previous.subject, subject) : []

    const round = {
      schema: 'alm.plugin-acceptance/v1',
      roundId,
      roundIndex: Number(roundId),
      acceptanceId,
      plugin,
      pluginVersion: pkg?.version ?? null,
      requirement,
      level,
      verdict,
      stats,
      cases,
      subject,
      scenarios: selected.map(describeScenario),
      supersedes: previous && verdict === 'pass' && previous.verdict !== 'pass' ? previous.roundId : null,
      startedAt,
      finishedAt: new Date().toISOString(),
      diffFrom: previous?.roundId ?? null,
      drift,
    }

    finishRound(dir, round)
    const reportPath = writeReport(dir, renderReport({ round, dir, drift }))

    return {
      schema: ENGINE_SCHEMA,
      roundId,
      roundIndex: round.roundIndex,
      acceptanceId,
      roundDir: dir,
      report: reportPath,
      reportUrl: pathToFileURL(reportPath).href,
      verdict,
      stats,
      level,
      plugin,
      requirement,
      cases: summarizeCases(cases),
      failures: cases
        .filter((entry) => entry.status !== 'pass')
        .map((entry) => ({
          check: entry.id,
          title: entry.title,
          reason: entry.observation,
          evidence: (entry.evidence ?? []).map((item) => item.path),
          repro: entry.repro ?? [],
        })),
      subject: {
        headSha: subject.git.headSha,
        branch: subject.git.branch,
        dirty: subject.git.dirty,
        files: subject.files.length,
        browser: subject.environment.browser,
        node: subject.environment.node,
      },
      drift,
    }
  } catch (error) {
    failRound(dir, error)
    throw error
  }
}

/**
 * Record reviewer decisions against an existing round. The round itself is
 * never modified; decisions land in `reviews.json`.
 *
 * @param {{root: string, plugin: string, roundId: string, decisions?: object[], reviewsFile?: string, roundDir?: string}} options
 */
export function reviewAcceptance({ root, plugin, roundId, decisions = [], reviewsFile = null, roundDir = null }) {
  const dir = roundDir ?? join(pluginRoot(resolve(root), plugin), String(roundId))
  const round = readRound(dir)
  if (!round) throw new Error(`round ${roundId} not found under ${dir}`)

  const incoming = [...decisions]
  if (reviewsFile) {
    const path = isAbsolute(reviewsFile) ? reviewsFile : resolve(root, reviewsFile)
    let payload
    try {
      payload = JSON.parse(readFileSync(path, 'utf8'))
    } catch (error) {
      throw new Error(`cannot read reviews file ${reviewsFile}: ${error.message}`)
    }
    if (payload?.acceptanceId && payload.acceptanceId !== round.acceptanceId) {
      throw new Error(`reviews file belongs to acceptance ${payload.acceptanceId}, not ${round.acceptanceId}`)
    }
    const known = new Set((round.cases ?? []).map((entry) => entry.id))
    for (const event of payload?.events ?? []) {
      if (event.kind === 'check' && event.checkId && !known.has(event.checkId)) {
        throw new Error(`reviews file mentions unknown check ${event.checkId}`)
      }
      incoming.push({
        id: event.id,
        action: event.action,
        check: event.kind === 'round' ? null : event.checkId,
        comment: event.comment ?? '',
        createdAt: event.createdAt,
      })
    }
  }
  if (incoming.length === 0) throw new Error('no decisions to record: pass decisions[] or reviewsFile')

  const saved = recordReviews({ dir, round, decisions: incoming })
  // The HTML report is a derived view: refresh it so the reviewer reopening it
  // sees the decisions they just recorded, plus drift against today's workspace.
  const files = (round.subject?.files ?? []).map((file) => file.path)
  const drift = files.length
    ? fingerprintDrift(round.subject, subjectFingerprint({ root: resolve(root), files }))
    : []
  writeReport(dir, renderReport({ round, reviews: saved, dir, drift }))
  return {
    schema: ENGINE_SCHEMA,
    roundId: round.roundId,
    acceptanceId: round.acceptanceId,
    events: saved.events.length,
    decisions: decisionSummary(saved),
    gaps: reviewGaps(round, saved),
    reviewsFile: join(dir, 'reviews.json'),
  }
}

/** Read one round plus its reviews and the drift against the current workspace. */
export function showRound({ root, plugin, roundId, roundDir = null }) {
  const dir = roundDir ?? join(pluginRoot(resolve(root), plugin), String(roundId))
  const round = readRound(dir)
  if (!round) throw new Error(`round ${roundId} not found under ${dir}`)
  const reviews = readReviews(dir)
  const files = (round.subject?.files ?? []).map((file) => file.path)
  const drift = files.length ? fingerprintDrift(round.subject, subjectFingerprint({ root: resolve(root), files })) : []
  return {
    round,
    reviews,
    decisions: decisionSummary(reviews),
    gaps: reviewGaps(round, reviews),
    drift,
    dir,
    report: join(dir, 'report.html'),
  }
}

/** Rounds for a plugin, newest first. */
export function listAcceptanceRounds({ root, plugin, requirement = null }) {
  return listRounds({ root: resolve(root), plugin, requirement }).map((round) => ({
    roundId: round.roundId,
    roundIndex: round.roundIndex ?? null,
    plugin: round.plugin,
    requirement: round.requirement ?? null,
    verdict: round.verdict ?? null,
    status: round.status ?? 'complete',
    stats: round.stats ?? null,
    level: round.level ?? null,
    finishedAt: round.finishedAt ?? round.startedAt ?? round.at ?? null,
    reason: round.reason ?? null,
  }))
}
