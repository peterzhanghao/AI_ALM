/**
 * Scenario model: what a plugin acceptance round is allowed to claim.
 *
 * A scenario turns a requirement into observable checks. Every check must name
 * an expected observation and requires at least one piece of human-reviewable
 * evidence — a unit test or a green build is not a check here, because the
 * reviewer cannot see what the user sees from a test name.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const SCENARIO_SCHEMA = 'alm.plugin-acceptance.scenario/v1'
export const LEVELS = ['L1', 'L2']

/** Step kinds the runner knows how to execute. */
export const STEPS = [
  'goto',
  'waitFor',
  'click',
  'fill',
  'expectText',
  'expectNoText',
  'expectCount',
  'expectTitle',
  'expectNoConsoleErrors',
  'expectNoFailedRequests',
  'shot',
  'dom',
]

export class ScenarioError extends Error {
  /** @param {string} message @param {string} [path] */
  constructor(message, path) {
    super(path ? `${path}: ${message}` : message)
    this.name = 'ScenarioError'
    this.path = path ?? null
  }
}

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

function requireString(value, path) {
  if (typeof value !== 'string' || value.trim() === '') throw new ScenarioError('must be a non-empty string', path)
  return value
}

function validateStep(step, path) {
  if (!isPlainObject(step)) throw new ScenarioError('step must be an object', path)
  const keys = Object.keys(step).filter((key) => step[key] !== undefined)
  if (keys.length !== 1) throw new ScenarioError(`step must have exactly one action, got ${keys.join(', ') || 'none'}`, path)
  const [kind] = keys
  if (!STEPS.includes(kind)) throw new ScenarioError(`unknown step "${kind}"; expected one of ${STEPS.join(', ')}`, path)

  const value = step[kind]
  switch (kind) {
    case 'goto':
      requireString(value, `${path}.goto`)
      break
    case 'waitFor':
    case 'click':
      requireString(value, `${path}.${kind}`)
      break
    case 'fill':
      if (!isPlainObject(value)) throw new ScenarioError('must be { selector, value }', `${path}.fill`)
      requireString(value.selector, `${path}.fill.selector`)
      requireString(value.value, `${path}.fill.value`)
      break
    case 'expectText':
    case 'expectNoText':
      if (isPlainObject(value)) {
        requireString(value.text, `${path}.${kind}.text`)
        if (value.selector !== undefined) requireString(value.selector, `${path}.${kind}.selector`)
      } else {
        requireString(value, `${path}.${kind}`)
      }
      break
    case 'expectTitle':
      requireString(value, `${path}.expectTitle`)
      break
    case 'expectCount': {
      if (!isPlainObject(value)) throw new ScenarioError('must be { selector, equals }', `${path}.expectCount`)
      requireString(value.selector, `${path}.expectCount.selector`)
      const bounds = ['equals', 'min', 'max'].filter((key) => value[key] !== undefined)
      if (bounds.length !== 1) throw new ScenarioError('requires exactly one of equals, min, max', `${path}.expectCount`)
      const number = value[bounds[0]]
      if (typeof number !== 'number' || !Number.isInteger(number) || number < 0) {
        throw new ScenarioError(`${bounds[0]} must be a non-negative integer`, `${path}.expectCount.${bounds[0]}`)
      }
      break
    }
    case 'expectNoConsoleErrors':
    case 'expectNoFailedRequests':
      if (value !== true) throw new ScenarioError('must be true; drop the step to disable the assertion', `${path}.${kind}`)
      break
    case 'shot':
    case 'dom':
      requireString(value, `${path}.${kind}`)
      break
  }
}

function validateCheck(check, path) {
  if (!isPlainObject(check)) throw new ScenarioError('check must be an object', path)
  requireString(check.id, `${path}.id`)
  if (!/^[a-z0-9][a-z0-9-]*$/.test(check.id)) {
    throw new ScenarioError('must be kebab-case so it survives URLs and filenames', `${path}.id`)
  }
  requireString(check.title, `${path}.title`)
  requireString(check.expected, `${path}.expected`)
  if (!Array.isArray(check.steps) || check.steps.length === 0) {
    throw new ScenarioError('requires a non-empty steps array', `${path}.steps`)
  }
  check.steps.forEach((step, index) => validateStep(step, `${path}.steps[${index}]`))
  if (!check.steps.some((step) => step.shot !== undefined || step.dom !== undefined)) {
    throw new ScenarioError(
      'must capture at least one shot or dom step: a check without reviewable evidence is not a check',
      `${path}.steps`,
    )
  }
  if (check.level !== undefined && !LEVELS.includes(check.level)) {
    throw new ScenarioError(`must be one of ${LEVELS.join(', ')}`, `${path}.level`)
  }
  if (check.requirement !== undefined) requireString(check.requirement, `${path}.requirement`)
  if (check.repro !== undefined) {
    if (!Array.isArray(check.repro)) throw new ScenarioError('must be an array of strings', `${path}.repro`)
    check.repro.forEach((entry, index) => requireString(entry, `${path}.repro[${index}]`))
  }
  return check
}

/**
 * Validate and normalise one scenario object.
 *
 * @param {unknown} input
 * @param {{source?: string|null}} [options]
 */
export function normalizeScenario(input, { source = null } = {}) {
  if (!isPlainObject(input)) throw new ScenarioError('scenario must export an object')
  if (input.schema !== undefined && input.schema !== SCENARIO_SCHEMA) {
    throw new ScenarioError(`unsupported schema "${input.schema}", expected ${SCENARIO_SCHEMA}`, 'schema')
  }
  requireString(input.id, 'id')
  requireString(input.title, 'title')
  requireString(input.plugin, 'plugin')
  const level = input.level ?? 'L1'
  if (!LEVELS.includes(level)) throw new ScenarioError(`must be one of ${LEVELS.join(', ')}`, 'level')

  if (!isPlainObject(input.start)) throw new ScenarioError('must be { module, export? } or { base }', 'start')
  const hasBase = typeof input.start.base === 'string' && input.start.base !== ''
  const hasModule = typeof input.start.module === 'string' && input.start.module !== ''
  if (hasBase === hasModule) throw new ScenarioError('requires exactly one of base or module', 'start')
  if (hasModule) {
    if (input.start.export !== undefined) requireString(input.start.export, 'start.export')
    if (input.start.options !== undefined && !isPlainObject(input.start.options)) {
      throw new ScenarioError('must be an object', 'start.options')
    }
  }

  if (!Array.isArray(input.checks) || input.checks.length === 0) {
    throw new ScenarioError('requires a non-empty checks array', 'checks')
  }
  const checks = input.checks.map((check, index) => validateCheck(check, `checks[${index}]`))
  const ids = new Set()
  for (const check of checks) {
    if (ids.has(check.id)) throw new ScenarioError(`duplicate check id "${check.id}"`, 'checks')
    ids.add(check.id)
  }

  return {
    schema: SCENARIO_SCHEMA,
    id: input.id,
    title: input.title,
    plugin: input.plugin,
    level,
    requirement: input.requirement ?? null,
    source,
    start: hasBase
      ? { base: input.start.base }
      : { module: input.start.module, export: input.start.export ?? 'default', options: input.start.options ?? {} },
    notes: typeof input.notes === 'string' ? input.notes : null,
    checks: checks.map((check) => ({
      id: check.id,
      title: check.title,
      expected: check.expected,
      level: check.level ?? level,
      requirement: check.requirement ?? input.requirement ?? null,
      category: check.category ?? 'ui',
      repro: check.repro ?? [],
      steps: check.steps.map((step) => ({ ...step })),
    })),
  }
}

/**
 * Load one scenario module from disk.
 *
 * @param {string} file absolute path
 */
export async function loadScenarioFile(file) {
  let module
  try {
    module = await import(pathToFileURL(file).href)
  } catch (error) {
    throw new ScenarioError(`cannot import scenario: ${error.message}`, file)
  }
  const exported = module.default ?? module.scenario
  if (exported === undefined) throw new ScenarioError('must export default (or `scenario`)', file)
  return normalizeScenario(exported, { source: file })
}

/** Candidate scenario files for a workspace: `<root>/acceptance/plugins/<name>/scenarios/*.mjs`. */
export function scenarioDirs(root) {
  const base = join(root, 'acceptance', 'plugins')
  let entries
  try {
    entries = readdirSync(base, { withFileTypes: true })
  } catch {
    return [base]
  }
  return entries.filter((entry) => entry.isDirectory()).map((entry) => join(base, entry.name, 'scenarios'))
}

function mjsFiles(dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.mjs'))
    .map((entry) => join(dir, entry.name))
    .sort()
}

/**
 * Discover scenarios for a plugin.
 *
 * Explicit paths win; otherwise every module under `acceptance/plugins/*​/scenarios`
 * is loaded and filtered by the plugin name it declares, so directory naming
 * never has to encode the package name.
 *
 * @param {{root: string, plugin: string, paths?: string[], ids?: string[]}} options
 * @returns {Promise<object[]>}
 */
export async function loadScenarios({ root, plugin, paths = [], ids = [] }) {
  const candidates = []
  for (const path of paths) {
    const absolute = isAbsolute(path) ? path : resolve(root, path)
    let stats
    try {
      stats = statSync(absolute)
    } catch {
      throw new ScenarioError('scenario path does not exist', path)
    }
    if (stats.isDirectory()) candidates.push(...mjsFiles(absolute))
    else candidates.push(absolute)
  }
  if (candidates.length === 0) {
    for (const dir of scenarioDirs(root)) candidates.push(...mjsFiles(dir))
  }

  const scenarios = []
  for (const file of candidates) {
    const scenario = await loadScenarioFile(file)
    if (scenario.plugin !== plugin) continue
    if (ids.length && !ids.includes(scenario.id)) continue
    scenarios.push(scenario)
  }
  if (ids.length) {
    const found = new Set(scenarios.map((scenario) => scenario.id))
    const missing = ids.filter((id) => !found.has(id))
    if (missing.length) throw new ScenarioError(`no scenario named ${missing.join(', ')} for ${plugin}`)
  }
  return scenarios
}

/** Minimal inline description used by the CLI listing and the host tool result. */
export function describeScenario(scenario) {
  return {
    id: scenario.id,
    title: scenario.title,
    level: scenario.level,
    requirement: scenario.requirement,
    checks: scenario.checks.length,
    source: scenario.source ? scenario.source.split(/[\\/]/).slice(-1)[0] : null,
  }
}

/** Read a scenario file without importing it, for cheap listing. */
export function scenarioText(file) {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}
