import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

/**
 * Delivery scope is derived from the real worktree diff, not from the list of
 * files mentioned in an acceptance command. A verification command describes
 * what was tested; it does not prove which implementation files belong to the
 * requirement. Directory entries in the execution blueprint (for example
 * `packages/`) are workspace implementation authorizations and must be kept as
 * prefix rules instead of being dropped as "not a literal file".
 */

const normalize = value => String(value ?? '').replaceAll('\\', '/').replace(/^\.\//, '').trim()
export const IMPLEMENTATION_PATH = /\.(?:[cm]?js|jsx|tsx?|css|json|ya?ml|sql|prisma)$/i

const NOISE_PATTERNS = Object.freeze([
  /(?:^|\/)\.alm\//,
  /^\.workbuddy\//,
  /^\.dsh\//,
  /^\.git\//,
  /(?:^|\/)node_modules\//,
  /^dist\//,
  /^tmp\//,
  /^\.tmp\//,
  /^artifacts\//,
  /^validation\//,
])

const git = (root, args, { allowFailure = false } = {}) => {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    if (allowFailure) return null
    throw Object.assign(new Error(error.stderr?.trim() || error.message), { code: 'git-command-failed' })
  }
}

export function isNoisePath(path) {
  const value = normalize(path)
  return Boolean(value) && NOISE_PATTERNS.some(pattern => pattern.test(value))
}

/** `packages/` authorizes everything below it; literal paths match exactly. */
export function isAllowedPath(path, allowedPaths = []) {
  const value = normalize(path)
  if (!value) return false
  return (allowedPaths ?? []).some(entry => {
    const allowed = normalize(entry)
    if (!allowed) return false
    return value === allowed || (allowed.endsWith('/') && value.startsWith(allowed))
  })
}

/** Files that visibly belong to another requirement must be split first. */
export function belongsToOtherRequirement(path, requirementId) {
  const value = normalize(path).toUpperCase()
  const id = normalize(requirementId).toUpperCase()
  if (!id || !/REQ-[A-Z0-9-]+/.test(value)) return false
  return !value.includes(id)
}

/** Locate the worktree that owns the integration branch, when it is not root. */
export function developWorktree(root, branch = 'develop') {
  const repo = resolve(root)
  const current = git(repo, ['branch', '--show-current'], { allowFailure: true })?.trim() ?? null
  if (current === branch) return repo
  const list = git(repo, ['worktree', 'list', '--porcelain'], { allowFailure: true })
  if (!list) return null
  for (const block of list.split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/)
    const worktree = lines.find(line => line.startsWith('worktree '))?.slice('worktree '.length)
    const ref = lines.find(line => line.startsWith('branch '))?.slice('branch '.length)
    if (worktree && ref === `refs/heads/${branch}`) return resolve(worktree)
  }
  return null
}

function changedPaths(root) {
  const output = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']) ?? ''
  const tokens = output.split('\0')
  const paths = []
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (!token || token.length < 4) continue
    const flag = token.slice(0, 2)
    const name = normalize(token.slice(3))
    if (/[RC]/.test(flag)) index += 1
    if (name) paths.push(name)
  }
  return [...new Set(paths)]
}

/**
 * @returns {{root: string, allowedPaths: string[], all: string[], owned: string[],
 *   noise: string[], foreign: string[], implementation: string[], ok: boolean}}
 */
export function collectDeliveryScope({ root, allowedPaths = [], requirementPaths = [], extraPaths = [], requirementId = null } = {}) {
  const repo = resolve(root)
  const allowed = [...new Set([...allowedPaths, ...requirementPaths, ...extraPaths].map(normalize).filter(Boolean))]
  const all = changedPaths(repo)
  const noise = [], owned = [], foreign = []
  for (const path of all) {
    if (isNoisePath(path)) { noise.push(path); continue }
    if (belongsToOtherRequirement(path, requirementId)) { foreign.push(path); continue }
    if (isAllowedPath(path, allowed)) owned.push(path)
    else foreign.push(path)
  }
  return {
    root: repo,
    allowedPaths: allowed,
    all,
    owned,
    noise,
    foreign,
    implementation: owned.filter(path => IMPLEMENTATION_PATH.test(path)),
    ok: foreign.length === 0,
  }
}
