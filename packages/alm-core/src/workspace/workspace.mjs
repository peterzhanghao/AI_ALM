import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

export const ALLOWED_DIRS = ['requirements', 'architecture', 'adr', 'tests', 'risks']
export const CHANGE_DIR = '.alm/changes'
const CHANGE_ID = /^CHG-[A-Z0-9][A-Z0-9-]{2,}$/

export class WorkspaceError extends Error {
  constructor(message) {
    super(message)
    this.name = 'WorkspaceError'
  }
}

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function assertGitRepo(root) {
  try {
    git(root, 'rev-parse', '--git-dir')
  } catch {
    throw new WorkspaceError('not a git repository')
  }
}

function branchExists(root, branch) {
  try {
    git(root, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`)
    return true
  } catch {
    return false
  }
}

function changeFile(root, changeId) {
  return join(root, CHANGE_DIR, `${changeId}.json`)
}

function readChanges(root) {
  const dir = join(root, CHANGE_DIR)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(dir, name), 'utf8')))
}

export function normalizePath(path) {
  return String(path).replaceAll('\\', '/')
}

export function pathAllowed(path) {
  const normalized = normalizePath(path)
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) return false
  if (normalized.split('/').includes('..')) return false
  return ALLOWED_DIRS.some((dir) => normalized === dir || normalized.startsWith(`${dir}/`))
}

/**
 * Open a change workspace: a branch from the baseline plus a committed change
 * record. The worktree must be clean so the branch switch cannot hide edits.
 */
export function createWorkspace({ root, baseline, changeId }) {
  const repo = resolve(root)
  assertGitRepo(repo)
  if (!CHANGE_ID.test(changeId)) throw new WorkspaceError(`invalid change id: ${changeId}`)

  const dirty = git(repo, 'status', '--porcelain')
  if (dirty !== '') throw new WorkspaceError('worktree must be clean to open a change workspace')

  const baselineSha = git(repo, 'rev-parse', baseline)
  const branch = `alm/${changeId.toLowerCase()}`
  if (branchExists(repo, branch)) throw new WorkspaceError(`branch already exists: ${branch}`)
  if (existsSync(changeFile(repo, changeId))) throw new WorkspaceError(`change already exists: ${changeId}`)

  git(repo, 'switch', '-c', branch, baselineSha)

  const record = {
    schema: 'alm.change/v1',
    changeId,
    baselineSha,
    branch,
    createdAt: new Date().toISOString(),
    status: 'open',
  }
  mkdirSync(join(repo, CHANGE_DIR), { recursive: true })
  writeFileSync(changeFile(repo, changeId), `${JSON.stringify(record, null, 2)}\n`, 'utf8')
  git(repo, 'add', CHANGE_DIR)
  git(repo, '-c', 'user.name=alm-bot', '-c', 'user.email=alm@local', 'commit', '-qm', `chore(alm): open change ${changeId}`)

  return { ...record, path: changeFile(repo, changeId) }
}

export function statusWorkspace({ root }) {
  const repo = resolve(root)
  assertGitRepo(repo)
  const branch = git(repo, 'rev-parse', '--abbrev-ref', 'HEAD')
  const dirty = git(repo, 'status', '--porcelain') !== ''
  const changes = readChanges(repo)
  return {
    schema: 'alm.workspace.status/v1',
    branch,
    dirty,
    active: changes.find((change) => change.branch === branch) ?? null,
    changes,
  }
}

/** Deny writes outside an open change workspace and outside the asset dirs. */
export function guardWrite({ root, changeId, paths }) {
  const status = statusWorkspace({ root })
  if (!status.active) {
    return {
      schema: 'alm.workspace.guard/v1',
      ok: false,
      error: 'no active change workspace',
      violations: [],
    }
  }
  if (changeId && status.active.changeId !== changeId) {
    return {
      schema: 'alm.workspace.guard/v1',
      ok: false,
      error: `active change is ${status.active.changeId}, not ${changeId}`,
      violations: [],
    }
  }

  const violations = paths.filter((path) => !pathAllowed(path))
  return {
    schema: 'alm.workspace.guard/v1',
    ok: violations.length === 0,
    changeId: status.active.changeId,
    branch: status.branch,
    violations,
  }
}
