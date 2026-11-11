/**
 * Round store: `.alm/acceptance2/<plugin>/<roundId>/`.
 *
 * Two rules shape this module.
 *
 * 1. A round is immutable once written. Evidence plus verdict are one artefact;
 *    a fix produces a new round instead of editing the old one, so a reviewer
 *    can always see what they were looking at when they signed.
 * 2. Review decisions are *not* part of the round. They are appended to
 *    `reviews.json` as an event log, so accepting a check never touches the
 *    evidence it refers to.
 */
import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

export const ROUND_SCHEMA = 'alm.plugin-acceptance/v1'
export const REVIEWS_SCHEMA = 'alm.plugin-acceptance.reviews/v1'
export const RUNNING_MARKER = '.running.json'
export const FAILED_MARKER = '.failed.json'
export const ROUND_FILE = 'round.json'
export const REPORT_FILE = 'report.html'
export const EVIDENCE_DIR = 'evidence'
export const REVIEWS_FILE = 'reviews.json'

/** Package name to a stable, filesystem-safe directory segment. */
export function pluginSlug(plugin) {
  return String(plugin ?? '')
    .trim()
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'unknown-plugin'
}

export function acceptanceRoot(root) {
  return join(root, '.alm', 'acceptance2')
}

export function pluginRoot(root, plugin) {
  return join(acceptanceRoot(root), pluginSlug(plugin))
}

/** Keep generated evidence out of git without touching the user's ignore files. */
function ensureIgnored(root) {
  const dir = acceptanceRoot(root)
  mkdirSync(dir, { recursive: true })
  const ignore = join(dir, '.gitignore')
  if (!existsSync(ignore)) writeFileSync(ignore, '*\n', 'utf8')
  return dir
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

/** Next free round id ("001", "002", ...). */
export function nextRoundId(dir) {
  let taken = []
  try {
    taken = readdirSync(dir)
  } catch {
    taken = []
  }
  let max = 0
  for (const entry of taken) {
    if (/^\./.test(entry)) continue
    if (!/^\d+$/.test(entry)) continue
    max = Math.max(max, Number(entry))
  }
  return String(max + 1).padStart(3, '0')
}

/**
 * Allocate a round directory and mark it in progress.
 *
 * @param {{root: string, plugin: string, requirement?: string|null, level?: string}} options
 * @returns {{roundId: string, dir: string, acceptanceId: string, plugin: string}}
 */
export function beginRound({ root, plugin, requirement = null, level = 'L1' }) {
  const parent = ensureIgnored(root)
  mkdirSync(join(parent, pluginSlug(plugin)), { recursive: true })
  const base = pluginRoot(root, plugin)

  let roundId = nextRoundId(base)
  // The sequence can race when two agents run at once; retry on collision.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const dir = join(base, roundId)
    try {
      mkdirSync(dir)
      const acceptanceId = randomUUID()
      writeFileSync(
        join(dir, RUNNING_MARKER),
        `${JSON.stringify({ schema: ROUND_SCHEMA, acceptanceId, plugin, requirement, level, startedAt: new Date().toISOString() }, null, 2)}\n`,
        'utf8',
      )
      mkdirSync(join(dir, EVIDENCE_DIR), { recursive: true })
      return { roundId, dir, acceptanceId, plugin }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      roundId = String(Number(roundId) + 1).padStart(3, '0')
    }
  }
  throw new Error(`cannot allocate a round directory under ${base}`)
}

/**
 * Write the immutable round document. Refuses to overwrite an existing round.
 *
 * @param {string} dir
 * @param {object} round
 */
export function finishRound(dir, round) {
  const file = join(dir, ROUND_FILE)
  try {
    writeFileSync(file, `${JSON.stringify(round, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  } catch (error) {
    if (error?.code === 'EEXIST') throw new Error(`${file} already exists; rounds are immutable, start a new one`)
    throw error
  }
  unlinkIfPresent(join(dir, RUNNING_MARKER))
  return file
}

/** Record why a round never completed; the directory stays visible in listings. */
export function failRound(dir, error) {
  const payload = {
    schema: ROUND_SCHEMA,
    reason: error?.message ?? String(error),
    at: new Date().toISOString(),
  }
  writeFileSync(join(dir, FAILED_MARKER), `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  unlinkIfPresent(join(dir, RUNNING_MARKER))
  return join(dir, FAILED_MARKER)
}

function unlinkIfPresent(file) {
  try {
    unlinkSync(file)
  } catch {
    /* already gone */
  }
}

export function isRoundDir(dir) {
  return /^\d+$/.test(dir)
}

/** @param {string} dir round directory */
export function readRound(dir) {
  return readJson(join(dir, ROUND_FILE))
}

/**
 * List rounds, newest first, without reading evidence files.
 *
 * @param {{root: string, plugin: string, requirement?: string|null, status?: string}} options
 */
export function listRounds({ root, plugin, requirement = null, status = null }) {
  const base = pluginRoot(root, plugin)
  let entries = []
  try {
    entries = readdirSync(base, { withFileTypes: true })
  } catch {
    return []
  }
  const rounds = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !isRoundDir(entry.name)) continue
    const dir = join(base, entry.name)
    const round = readRound(dir)
    if (round) {
      if (requirement && round.requirement !== requirement) continue
      if (status && round.verdict !== status) continue
      rounds.push({ ...round, dir })
      continue
    }
    const running = readJson(join(dir, RUNNING_MARKER))
    const failed = readJson(join(dir, FAILED_MARKER))
    if (running) {
      rounds.push({ roundId: entry.name, dir, schema: ROUND_SCHEMA, status: 'running', ...running, verdict: null })
    } else if (failed) {
      rounds.push({ roundId: entry.name, dir, schema: ROUND_SCHEMA, status: 'failed', ...failed, verdict: null })
    }
  }
  return rounds.sort((a, b) => String(b.roundId).localeCompare(String(a.roundId)))
}

/** Most recent completed round, used as the visual baseline for the next one. */
export function latestCompletedRound({ root, plugin, requirement = null, before = null }) {
  const rounds = listRounds({ root, plugin, requirement }).filter((round) => round.verdict)
  if (before) return rounds.filter((round) => String(round.roundId) < String(before))[0] ?? null
  return rounds[0] ?? null
}

/** Verdict of a round is derived, never asserted by the caller. */
export function verdictOf(cases) {
  if (cases.some((entry) => entry.status === 'fail')) return 'fail'
  if (cases.some((entry) => entry.status === 'blocked')) return 'blocked'
  return cases.length ? 'pass' : 'blocked'
}

export function statsOf(cases) {
  const stats = { pass: 0, fail: 0, blocked: 0 }
  for (const entry of cases) if (entry.status in stats) stats[entry.status] += 1
  return stats
}

export function writeReport(dir, html) {
  const file = join(dir, REPORT_FILE)
  writeFileSync(file, html, 'utf8')
  return file
}

export function removeRound(dir) {
  try {
    rmdirSync(dir, { recursive: true })
    return true
  } catch {
    return false
  }
}

/* ── reviews ─────────────────────────────────────────────────────────────── */

/**
 * Normalise one incoming decision.
 *
 * @param {object} decision
 * @param {number} roundIndex
 */
export function normalizeDecision(decision, roundIndex = null) {
  if (!decision || typeof decision !== 'object') throw new Error('decision must be an object')
  const action = decision.action === 'accept' || decision.action === 'reject' ? decision.action : null
  if (!action) throw new Error(`decision action must be accept or reject, got ${JSON.stringify(decision.action)}`)
  const checkId = decision.check ?? decision.checkId ?? null
  const comment = typeof decision.comment === 'string' ? decision.comment.trim() : ''
  if (action === 'reject' && comment === '') throw new Error(`rejecting ${checkId ?? 'the round'} requires a comment`)
  return {
    id: decision.id ?? randomUUID(),
    kind: checkId ? 'check' : 'round',
    checkId,
    action,
    comment,
    createdAt: decision.createdAt ?? new Date().toISOString(),
    roundIndex,
  }
}

/**
 * Append decisions. Existing events are preserved; a repeated event id is
 * ignored, so re-importing the same exported file is harmless.
 *
 * @param {{dir: string, round: object, decisions: object[]}} options
 */
export function recordReviews({ dir, round, decisions }) {
  const file = join(dir, REVIEWS_FILE)
  const existing = readJson(file, null)
  const events = Array.isArray(existing?.events) ? [...existing.events] : []
  const seen = new Set(events.map((event) => event.id))
  const roundIndex = round?.roundIndex ?? (Number(round?.roundId) || null)

  for (const decision of decisions) {
    const event = normalizeDecision(decision, roundIndex)
    if (seen.has(event.id)) continue
    seen.add(event.id)
    events.push(event)
  }

  const payload = {
    schema: REVIEWS_SCHEMA,
    acceptanceId: round.acceptanceId,
    roundId: round.roundId,
    format: 1,
    events,
  }
  const tmp = `${file}.tmp`
  writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  renameSync(tmp, file)
  return payload
}

export function readReviews(dir) {
  return readJson(join(dir, REVIEWS_FILE), null)
}

/**
 * Latest decision per check, plus the latest round-level decision.
 *
 * @param {object|null} reviews
 */
export function decisionSummary(reviews) {
  const checks = {}
  let round = null
  for (const event of reviews?.events ?? []) {
    if (event.kind === 'check' && event.checkId) checks[event.checkId] = event
    else if (event.kind === 'round') round = event
  }
  return { checks, round }
}

/** Whether every failing check has a rejection and every passing one an accept. */
export function reviewGaps(round, reviews) {
  const { checks } = decisionSummary(reviews)
  const gaps = []
  for (const entry of round?.cases ?? []) {
    if (!checks[entry.id]) gaps.push({ check: entry.id, reason: '尚未评审' })
  }
  return gaps
}
