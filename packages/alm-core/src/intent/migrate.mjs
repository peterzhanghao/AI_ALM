/**
 * Migration of pre-schema intent suggestions into the versioned store.
 *
 * Old rows were *suggestions*, never confirmations. Migration therefore always
 * lands in `editing`, clears `confirmation`/`receipt`, drops model-assigned
 * owner/priority and anything executable, and keeps the original bytes in a
 * timestamped backup before touching the store. Running it twice is a no-op:
 * migrated rows carry the current schema and are reported as skipped.
 */
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

import { readProject } from '../project/project.mjs'
import {
  INTENT_SCHEMA,
  INTENT_SCHEMA_VERSION,
  INPUT_SOURCES,
  ROUTES,
  intentError,
} from './errors.mjs'
import {
  SESSIONS_DIR,
  emptyContext,
  newSessionId,
  normalizeSession,
  saveSession,
  sessionFile,
  sessionsDir,
} from './session.mjs'
import {
  asString,
  cleanLine,
  dateFrom,
  ensureDir,
  fileExists,
  isPlainObject,
  listJsonFiles,
  nowIso,
  stamp,
  tryReadJsonFile,
} from './util.mjs'

const BACKUP_DIR = '.alm/intents/backup'
const LEGACY_BUNDLE = '.alm/intents/legacy.json'
const PRIORITIES = new Set(['P0', 'P1', 'P2', 'P3'])

function legacyInput(raw) {
  const text =
    asString(raw?.input?.text, 200000) ||
    asString(raw?.intentText, 200000) ||
    asString(raw?.text, 200000) ||
    '（历史建议迁移：原始输入缺失）'
  const source = INPUT_SOURCES.includes(raw?.input?.source) ? raw.input.source : 'text'
  const explicit = raw?.input?.explicit ?? raw?.explicit ?? null
  const priority = asString(explicit?.priority, 4).toUpperCase()
  return {
    text,
    source,
    extractedText: asString(raw?.input?.extractedText, 20000) || undefined,
    attachment: isPlainObject(raw?.input?.attachment) ? raw.input.attachment : null,
    explicit: {
      owner: cleanLine(explicit?.owner, { max: 120, field: 'owner' }) || null,
      priority: PRIORITIES.has(priority) ? priority : null,
    },
  }
}

function legacySourceRefs(value) {
  return (Array.isArray(value) ? value : [])
    .filter((entry) => isPlainObject(entry) && typeof entry.ref === 'string' && entry.ref.trim() !== '')
    .map((entry) => ({
      ref: entry.ref.trim(),
      line: Number.isInteger(Number(entry.line)) && Number(entry.line) > 0 ? Number(entry.line) : null,
      endLine: Number.isInteger(Number(entry.endLine)) && Number(entry.endLine) > 0 ? Number(entry.endLine) : null,
      quote: asString(entry.quote, 2000) || null,
      verified: false,
    }))
}

function legacyAcceptance(value) {
  return (Array.isArray(value) ? value : [])
    .filter((entry) => entry !== null && entry !== undefined)
    .map((entry) =>
      isPlainObject(entry)
        ? {
            precondition: asString(entry.precondition, 500) || null,
            action: asString(entry.action, 500) || null,
            expected: asString(entry.expected, 1000) || null,
            judgement: asString(entry.judgement, 1000) || null,
            sourceRefs: legacySourceRefs(entry.sourceRefs),
          }
        : {
            precondition: null,
            action: null,
            expected: asString(entry, 1000) || null,
            judgement: null,
            sourceRefs: [],
          },
    )
}

function legacyCandidate(value) {
  if (!isPlainObject(value)) return null
  return {
    title: asString(value.title, 200) || null,
    problem: asString(value.problem, 4000) || null,
    goal: asString(value.goal, 4000) || null,
    inScope: (Array.isArray(value.inScope) ? value.inScope : []).map((entry) => asString(entry, 500)).filter(Boolean),
    outOfScope: (Array.isArray(value.outOfScope) ? value.outOfScope : []).map((entry) => asString(entry, 500)).filter(Boolean),
    acceptance: legacyAcceptance(value.acceptance),
    // A model may never assign these; a human may do it later through confirmation.
    owner: null,
    priority: null,
  }
}

function legacyItem(entry, index) {
  if (!isPlainObject(entry)) return null
  const route = ROUTES.includes(entry.recommendedRoute) ? entry.recommendedRoute : null
  return {
    itemId: cleanLine(entry.itemId, { max: 120, field: 'itemId' }) || `ITM-${String(index + 1).padStart(2, '0')}`,
    sourceRefs: legacySourceRefs(entry.sourceRefs),
    userProblem: asString(entry.userProblem, 4000) || null,
    desiredOutcome: asString(entry.desiredOutcome, 4000) || null,
    recommendedRoute: route,
    routeRationale: asString(entry.routeRationale, 2000) || null,
    related: (Array.isArray(entry.related) ? entry.related : [])
      .filter((related) => isPlainObject(related) && typeof related.uid === 'string' && related.uid.trim() !== '')
      .map((related) => ({
        uid: related.uid.trim(),
        revision: Number.isInteger(Number(related.revision)) ? Number(related.revision) : null,
        match: ['covered', 'related', 'conflict', 'uncertain'].includes(related.match) ? related.match : 'uncertain',
        reason: asString(related.reason, 500) || null,
      })),
    assumptions: (Array.isArray(entry.assumptions) ? entry.assumptions : []).map((item) => asString(item, 1000)).filter(Boolean),
    unknowns: (Array.isArray(entry.unknowns) ? entry.unknowns : [])
      .filter((unknown) => isPlainObject(unknown))
      .map((unknown) => ({
        description: asString(unknown.description, 1000) || null,
        blocking: unknown.blocking === true,
        resolution: ['clarify', 'investigate', 'exclude', 'pending'].includes(unknown.resolution) ? unknown.resolution : 'pending',
      }))
      .filter((unknown) => unknown.description),
    candidate: legacyCandidate(entry.candidate),
    counterexample: isPlainObject(entry.counterexample)
      ? {
          scenario: asString(entry.counterexample.scenario, 2000) || null,
          status: ['unverified', 'observed'].includes(entry.counterexample.status) ? entry.counterexample.status : 'unverified',
        }
      : { scenario: null, status: 'unverified' },
    valueCheck: isPlainObject(entry.valueCheck) ? entry.valueCheck : null,
    fields: isPlainObject(entry.fields) ? entry.fields : {},
    excluded: entry.excluded === true,
  }
}

function legacyNextQuestion(value) {
  if (!isPlainObject(value)) return null
  const options = (Array.isArray(value.options) ? value.options : [])
    .filter((option) => isPlainObject(option))
    .slice(0, 3)
    .map((option, index) => ({
      id: cleanLine(option.id, { max: 60, field: 'option.id' }) || `O${index + 1}`,
      label: asString(option.label, 200) || '',
      impact: asString(option.impact, 500) || null,
    }))
  const text = asString(value.text, 1000) || ''
  if (!text) return null
  return {
    questionId: cleanLine(value.questionId, { max: 120, field: 'questionId' }) || `Q-${Date.now().toString(16)}`,
    itemIds: (Array.isArray(value.itemIds) ? value.itemIds : []).map((id) => asString(id, 120)).filter(Boolean),
    text,
    whyNow: asString(value.whyNow, 1000) || '',
    options,
    allowFreeText: value.allowFreeText !== false,
  }
}

function legacyProject(root, raw) {
  let projectFile = null
  try {
    projectFile = readProject(root)
  } catch {
    projectFile = null
  }
  const projectId =
    cleanLine(raw?.project?.id, { max: 20, field: 'project.id' }).toUpperCase() ||
    cleanLine(raw?.projectId, { max: 20, field: 'projectId' }).toUpperCase() ||
    projectFile?.id ||
    'UNKNOWN'
  return {
    id: projectId,
    name: cleanLine(raw?.project?.name, { max: 80, field: 'project.name' }) || projectFile?.name || null,
  }
}

function buildMigratedSession(root, raw, { now, backupRelative }) {
  const project = legacyProject(root, raw)
  const at = nowIso(now)
  const state = raw?.state === 'cancelled' ? 'cancelled' : 'editing'
  const rawItems = raw?.items ?? raw?.suggestions ?? []
  const items = (Array.isArray(rawItems) ? rawItems : []).map(legacyItem).filter(Boolean)
  const nextQuestion = legacyNextQuestion(raw?.nextQuestion)
  const session = {
    schema: INTENT_SCHEMA,
    schemaVersion: INTENT_SCHEMA_VERSION,
    sessionId: /^INT-[A-Za-z0-9-]+$/.test(String(raw?.sessionId ?? '')) ? String(raw.sessionId) : newSessionId(now),
    project,
    createdAt: asString(raw?.createdAt, 40) || at,
    updatedAt: at,
    actor: cleanLine(raw?.actor, { max: 120, field: 'actor' }) || 'human:local',
    state,
    input: legacyInput(raw),
    answers: Array.isArray(raw?.answers) ? raw.answers.slice(0, 100) : [],
    runs: [],
    context: emptyContext(project.id),
    items,
    nextQuestion,
    // Old suggestions were never confirmed; migration must not confirm them.
    confirmation: null,
    artifacts: [],
    receipt: null,
    error:
      state === 'cancelled'
        ? null
        : { code: 'migrated-unconfirmed', message: '历史建议已迁移为未确认会话，需重新分析与人工确认', at },
    migratedFrom: {
      schema: raw?.schema ?? null,
      schemaVersion: raw?.schemaVersion ?? null,
      at,
      backup: backupRelative ?? null,
    },
  }
  return normalizeSession(session)
}

function backupFile(root, file, backupDir, relativeLabel) {
  const relative = relativeLabel ?? file.slice(root.length).replace(/^[\\/]/, '')
  const target = join(backupDir, relative)
  ensureDir(join(target, '..'))
  writeFileSync(target, readFileSync(file))
  return relative.replace(/\\/g, '/')
}

/**
 * @returns {{migrated:number, skipped:number, backupDir:string|null, sessions:object[]}}
 */
export function migrateIntentStore({ root, now } = {}) {
  if (!root || typeof root !== 'string') throw intentError('invalid-request', 'migrateIntentStore 需要 root')
  const at = nowIso(now)
  const backupDir = join(root, BACKUP_DIR, stamp(dateFrom(now)))
  const report = []
  let migrated = 0
  let skipped = 0
  let backupUsed = false

  const legacyFiles = []
  for (const file of listJsonFiles(sessionsDir(root))) {
    const raw = tryReadJsonFile(file)
    if (!raw || !isPlainObject(raw)) continue
    if (raw.schema === INTENT_SCHEMA && raw.schemaVersion === INTENT_SCHEMA_VERSION) {
      skipped += 1
      report.push({ sessionId: raw.sessionId ?? basename(file, '.json'), state: raw.state ?? 'editing', action: 'skipped' })
      continue
    }
    legacyFiles.push({ file, raw, relative: `${SESSIONS_DIR}/${basename(file)}` })
  }
  const bundleFile = join(root, LEGACY_BUNDLE)
  if (fileExists(bundleFile)) {
    const raw = tryReadJsonFile(bundleFile)
    const entries = Array.isArray(raw) ? raw : Array.isArray(raw?.sessions) ? raw.sessions : raw ? [raw] : []
    entries.forEach((entry, index) => {
      if (!isPlainObject(entry)) return
      legacyFiles.push({ file: bundleFile, raw: entry, relative: `${LEGACY_BUNDLE}#${index}` })
    })
  }

  // Never mutate before the backup exists.
  for (const entry of legacyFiles) {
    const relative = backupFile(root, entry.file, backupDir, entry.relative.split('#')[0])
    entry.backupRelative = relative
    backupUsed = true
  }

  const seenIds = new Set()
  for (const entry of legacyFiles) {
    const session = buildMigratedSession(root, entry.raw, { now, backupRelative: entry.backupRelative })
    let sessionId = session.sessionId
    while (seenIds.has(sessionId) || (fileExists(sessionFile(root, sessionId)) && sessionId !== entry.raw?.sessionId)) {
      sessionId = newSessionId(now)
    }
    seenIds.add(sessionId)
    session.sessionId = sessionId
    saveSession({ root, session })
    migrated += 1
    report.push({ sessionId, state: session.state, action: 'migrated' })
  }

  // The original bytes are already in the backup; remove migrated single-file rows so
  // a second run sees no legacy input (bundle rows are handled below).
  for (const entry of legacyFiles) {
    if (entry.relative.includes('#')) continue
    try {
      rmSync(entry.file, { force: true })
    } catch {
      // best-effort: the backup is the durable copy
    }
  }

  if (backupUsed && fileExists(bundleFile)) {
    // The bundle has been captured in the backup; remove it so a second run is a no-op.
    try {
      renameSync(bundleFile, join(backupDir, basename(bundleFile)))
    } catch {
      writeFileSync(bundleFile, JSON.stringify({ migratedAt: at, backupDir: BACKUP_DIR }))
    }
  }

  report.sort((left, right) => String(left.sessionId).localeCompare(String(right.sessionId)))
  return {
    migrated,
    skipped,
    backupDir: backupUsed ? backupDir : null,
    sessions: report,
  }
}

export { INTENT_SCHEMA, SESSIONS_DIR }
