import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'

/**
 * Architecture impact is a module-level fact, not a file listing.
 *
 * The registry `architecture/MOD-*.yml` is the single source of truth: a module
 * owns a set of path prefixes and the focused tests that describe it. A
 * delivery answers two questions with that one table:
 *   - which modules did this change actually move (architecture impact)?
 *   - which tests must run to prove it (verification scope)?
 *
 * A registry that does not exist disables enforcement, so temporary repos and
 * fixtures keep working unchanged.
 */
export const MODULE_DIR = 'architecture'
export const ARCHITECTURE_RECORD_SCHEMA = 'alm.architecture-record/v1'

const TEST_PATH = /(?:^|\/)(?:test|tests)\/|\.(?:test|spec)\./
const NEUTRAL_PATTERNS = [
  TEST_PATH,
  /(?:^|\/)(?:client|client\.bundle|host\.bundle)\.js$/,
  /^requirements\//,
  /^\.alm\//,
  /^architecture\//,
  /^fixtures\//,
  /^docs\//,
  /^scripts\//,
  /\.md$/,
  /^(?:package\.json|pnpm-lock\.yaml|package-lock\.json|tsconfig\.json)$/,
]

const normalizePath = (value) => String(value ?? '').replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+/g, '/').trim()

/** Tests, generated bundles, requirement assets and docs never move architecture. */
export function isArchitectureNeutral(path) {
  const value = normalizePath(path)
  if (!value) return true
  return NEUTRAL_PATTERNS.some((pattern) => pattern.test(value))
}

function text(value) { return typeof value === 'string' ? value.trim() : '' }

/**
 * Read the module registry. Invalid entries are reported, never silently
 * dropped: a typo in a path prefix would otherwise make a gate quietly blind.
 */
export function loadModuleRegistry(root) {
  const dir = join(resolve(root), MODULE_DIR)
  const modules = []
  const errors = []
  if (!existsSync(dir)) return { modules, byId: new Map(), errors, enforced: false, dir: null }
  for (const name of readdirSync(dir).sort()) {
    if (!/\.ya?ml$/i.test(name)) continue
    const file = `${MODULE_DIR}/${name}`
    let doc = null
    try { doc = parseYaml(readFileSync(join(dir, name), 'utf8')) } catch (error) {
      errors.push({ file, reason: `无法解析 YAML：${error.message}` })
      continue
    }
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
      errors.push({ file, reason: '模块注册表必须是映射' })
      continue
    }
    if (doc.type !== 'module') continue
    const id = text(doc.id)
    if (!/^MOD-[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(id)) {
      errors.push({ file, reason: `模块 id 非法：${id || '(空)'}` })
      continue
    }
    const paths = [...new Set((Array.isArray(doc.paths) ? doc.paths : []).map(normalizePath).filter(Boolean))]
    if (paths.length === 0) {
      errors.push({ file, reason: `${id} 未声明 paths，无法归属任何改动` })
      continue
    }
    modules.push({
      id,
      title: text(doc.title) || id,
      owner: text(doc.owner),
      role: text(doc.role),
      paths,
      entries: [...new Set((Array.isArray(doc.entries) ? doc.entries : []).map(normalizePath).filter(Boolean))],
      tests: [...new Set((Array.isArray(doc.tests) ? doc.tests : []).map(normalizePath).filter(Boolean))],
      file,
    })
  }
  return { modules, byId: new Map(modules.map((mod) => [mod.id, mod])), errors, enforced: modules.length > 0, dir }
}

/** Longest-prefix match: a nested module always wins over its parent package. */
export function moduleIdForPath(path, registry) {
  const value = normalizePath(path)
  if (!value || isArchitectureNeutral(value)) return null
  let best = null
  for (const mod of registry?.modules ?? []) {
    for (const prefix of mod.paths) {
      if (value === prefix || value.startsWith(prefix)) {
        if (!best || prefix.length > best.length) best = { id: mod.id, length: prefix.length }
      }
    }
  }
  return best?.id ?? null
}

export function resolveModuleIds(paths, registry) {
  const ids = []
  for (const path of paths ?? []) {
    const id = moduleIdForPath(path, registry)
    if (id) ids.push(id)
  }
  return [...new Set(ids)]
}

/** Focused tests that belong to a module set, deduplicated and capped. */
export function verificationPathsFor(moduleIds, registry, { limit = 8 } = {}) {
  const tests = []
  for (const id of moduleIds ?? []) {
    const mod = registry?.byId?.get(id)
    if (!mod) continue
    for (const test of mod.tests) tests.push(test)
  }
  return [...new Set(tests)].slice(0, limit)
}

/**
 * Compare real changed paths against the requirement's declared modules.
 *
 * `undeclared` blocks delivery: implementation moved a module the requirement
 * never claimed, so either the declaration or the change is wrong. `declared`
 * without a change is only a warning — over-declaring is not a delivery risk.
 */
export function detectArchitectureImpact({ root, changedPaths = [], declaredModules = [], registry = null } = {}) {
  const reg = registry ?? loadModuleRegistry(root)
  const normalized = [...new Set((changedPaths ?? []).map(normalizePath).filter(Boolean))]
  const relevant = normalized.filter((path) => !isArchitectureNeutral(path))
  const ids = resolveModuleIds(relevant, reg)
  const declared = [...new Set((declaredModules ?? []).map(text).filter(Boolean))]
  const undeclared = ids.filter((id) => !declared.includes(id))
  const declaredNotChanged = declared.filter((id) => !ids.includes(id))
  const modules = ids.map((id) => {
    const mod = reg.byId.get(id)
    return { id, title: mod?.title ?? id, role: mod?.role ?? '' }
  })
  return {
    schema: 'alm.architecture-impact/v1',
    enforced: reg.enforced === true,
    changed: modules.length > 0,
    modules,
    moduleIds: ids,
    declaredModules: declared,
    undeclared,
    declaredNotChanged,
    blocking: reg.enforced === true && undeclared.length > 0,
    ignored: normalized.filter((path) => !relevant.includes(path)),
    registryErrors: reg.errors,
    reason: buildReason({ changed: modules.length > 0, modules, undeclared, declaredNotChanged, enforced: reg.enforced === true }),
  }
}

function buildReason({ changed, modules, undeclared, declaredNotChanged, enforced }) {
  if (!enforced) return '未建立模块注册表，架构影响不参与判定'
  if (undeclared.length) return `实现改动了未声明模块：${undeclared.join('、')}`
  if (!changed) return '未触及任何已登记模块'
  if (declaredNotChanged.length) return `已声明但未改动：${declaredNotChanged.join('、')}（不影响交付）`
  return `架构影响：${modules.map((mod) => mod.id).join('、')}`
}

/** The single line a delivery commit carries so `git log --grep` can find it. */
export function architectureImpactTrailer(impact) {
  const ids = impact?.moduleIds ?? []
  return `Architecture-Impact: ${ids.length ? ids.join(', ') : 'none'}`
}

/** Real worktree changes, split into staged/unstaged/untracked. */
export function collectChangedPaths(root) {
  try {
    const output = execFileSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
      cwd: resolve(root), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    })
    const tokens = String(output ?? '').split('\0')
    const paths = []
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index]
      if (!token || token.length < 4) continue
      const flag = token.slice(0, 2)
      const name = normalizePath(token.slice(3))
      if (/[RC]/.test(flag)) index += 1
      if (name) paths.push(name)
    }
    return [...new Set(paths)]
  } catch { return [] }
}

/**
 * Full record used by the delivery candidate. It carries the impact itself plus
 * the registry table, so a caller can decide what the delivery commit must say
 * without re-reading the registry.
 */
export function buildArchitectureRecord({ root, asset = null, changedPaths = null, declaredModules = null, registry = null } = {}) {
  const reg = registry ?? loadModuleRegistry(root)
  const paths = changedPaths ?? collectChangedPaths(root)
  const declared = declaredModules ?? declaredModulesOf(asset)
  const impact = detectArchitectureImpact({ root, changedPaths: paths, declaredModules: declared, registry: reg })
  return {
    ...impact,
    directory: MODULE_DIR,
    moduleTable: reg.modules.map((mod) => ({ id: mod.id, title: mod.title, role: mod.role, paths: mod.paths })),
    trailer: architectureImpactTrailer(impact),
    changedPaths: paths,
  }
}

/** Declared modules of a requirement asset (`allocated_to` relations). */
export function declaredModulesOf(asset) {
  const links = Array.isArray(asset?.links) ? asset.links : []
  return [...new Set(links.filter((link) => link?.type === 'allocated_to').map((link) => text(link.target)).filter(Boolean))]
}

/** A copy-pasteable declaration snippet for the blocking message. */
export function allocationSnippet(moduleIds) {
  return (moduleIds ?? []).map((id) => `[RELATION]\nType: allocated_to\nValue: ${id}`).join('\n\n')
}

/**
 * Re-evaluate one stored architecture record against the requirement's *current*
 * declarations.
 *
 * The record inside a candidate is an immutable statement about one delivery, but
 * a declaration made afterwards must be able to clear its own blocker: otherwise
 * "补声明" is never satisfied, because the frozen `undeclared` list keeps blocking
 * the very action that fixes it. Module ids are the granularity the gate needs, so
 * this needs no filesystem access.
 */
export function reconcileArchitectureDeclarations({ architecture = null, declaredModules = [] } = {}) {
  if (!architecture || typeof architecture !== 'object') return null
  const declared = [...new Set((declaredModules ?? []).map(text).filter(Boolean))]
  const changed = (Array.isArray(architecture.moduleIds) && architecture.moduleIds.length > 0
    ? architecture.moduleIds
    : Array.isArray(architecture.modules)
      ? architecture.modules.map((entry) => entry?.id)
      : []).map(text).filter(Boolean)
  const frozenUndeclared = (Array.isArray(architecture.undeclared) ? architecture.undeclared : []).map(text).filter(Boolean)
  // Only the modules this delivery actually moved can be undeclared; a record that
  // never listed its module ids falls back to its frozen list.
  const candidates = changed.length > 0 ? changed : frozenUndeclared
  const undeclared = candidates.filter((id) => !declared.includes(id))
  const enforced = architecture.enforced !== false
  return {
    ...architecture,
    changed: changed.length > 0,
    moduleIds: changed,
    undeclared,
    declared,
    declaredNotChanged: declared.filter((id) => !changed.includes(id)),
    blocking: enforced && undeclared.length > 0,
    reason: undeclared.length > 0
      ? `实现改动了未声明模块：${undeclared.join('、')}`
      : changed.length > 0
        ? `改动模块均已声明：${changed.join('、')}`
        : (architecture.reason ?? null),
  }
}
