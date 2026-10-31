import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { indexReport } from '../commands.mjs'
import { readProject } from '../project/project.mjs'
import { draftTasks } from '../tasks/draft.mjs'

const CHANGE_ID = /^CHG-[A-Z0-9][A-Z0-9-]{2,}$/
const CHANGE_DIR = '.alm/changes'
const DRAFT_DIR = 'changes'

export class ChangeError extends Error {
  constructor(message, { code = 'change', status = 400 } = {}) {
    super(message)
    this.name = 'ChangeError'
    this.code = code
    this.status = status
  }
}

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

export function changeIds(root) {
  const ids = new Set()
  for (const [dir, suffix] of [
    [CHANGE_DIR, '.json'],
    [DRAFT_DIR, ''],
  ]) {
    const path = join(resolve(root), dir)
    if (!existsSync(path)) continue
    for (const name of readdirSync(path)) {
      if (suffix && !name.endsWith(suffix)) continue
      const id = suffix ? name.slice(0, -suffix.length) : name
      if (CHANGE_ID.test(id)) ids.add(id)
    }
  }
  return [...ids].sort()
}

/** Next `CHG-<PROJECT>-NNN` for this repository; the project id is the default domain. */
export function nextChangeId({ root, projectId }) {
  const prefix = `CHG-${projectId ?? 'GEN'}-`
  let max = 0
  for (const id of changeIds(root)) {
    if (!id.startsWith(prefix)) continue
    const value = Number(id.slice(prefix.length))
    if (Number.isInteger(value)) max = Math.max(max, value)
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`
}

/** Sibling default keeps the isolated worktree out of the repository itself. */
export function worktreeRootFor(repo, configured) {
  return resolve(configured ?? process.env.ALM_WORKTREE_ROOT ?? join(dirname(resolve(repo)), '.alm-worktrees'))
}

export function worktreePathFor({ root, changeId, worktreeRoot }) {
  const repo = resolve(root)
  return join(worktreeRootFor(repo, worktreeRoot), `${basename(repo)}-${changeId.toLowerCase()}`)
}

/**
 * Plan an open change for one requirement: baseline, branch and where the
 * change record / task draft will land. Planning never writes to the repository.
 */
export function planChange({ root, requirementIds, changeId, isolate = false, worktreeRoot }) {
  const repo = resolve(root)
  const ids = [...new Set((requirementIds ?? []).map((id) => String(id).trim()).filter(Boolean))]
  if (ids.length === 0) throw new ChangeError('at least one requirement id is required', { code: 'no-requirements' })

  const index = indexReport(repo)
  if (index && index.ok === false) throw new ChangeError(index.error, { code: 'index-failed' })
  for (const id of ids) {
    const asset = index.assets.find((entry) => entry.id === id && entry.type === 'requirement')
    if (!asset) throw new ChangeError(`requirement not found: ${id}`, { code: 'unknown-requirement', status: 404 })
  }

  let baselineSha
  try {
    baselineSha = git(repo, ['rev-parse', 'HEAD'])
  } catch {
    throw new ChangeError('change workspace needs a git repository', { code: 'not-a-git-repo' })
  }

  const project = readProject(repo)
  const id = changeId ?? nextChangeId({ root: repo, projectId: project?.id })
  if (!CHANGE_ID.test(id)) throw new ChangeError(`invalid change id: ${id}`, { code: 'invalid-change' })

  if (existsSync(join(repo, CHANGE_DIR, `${id}.json`)) || existsSync(join(repo, DRAFT_DIR, id))) {
    throw new ChangeError(`change already exists: ${id}`, { code: 'already-exists', status: 409 })
  }

  const worktreePath = isolate ? worktreePathFor({ root: repo, changeId: id, worktreeRoot }) : null
  if (worktreePath && existsSync(worktreePath)) {
    throw new ChangeError(`worktree path already exists: ${worktreePath}`, { code: 'worktree-exists', status: 409 })
  }

  return {
    schema: 'alm.change.plan/v1',
    changeId: id,
    project: project?.id ?? null,
    baselineSha,
    branch: `alm/${id.toLowerCase()}`,
    requirementIds: ids,
    isolate: Boolean(isolate),
    worktreePath,
    changeFile: `${CHANGE_DIR}/${id}.json`,
    taskDir: `${DRAFT_DIR}/${id}/`,
    plannedFiles: [
      `${CHANGE_DIR}/${id}.json`,
      `${DRAFT_DIR}/${id}/proposal.md`,
      `${DRAFT_DIR}/${id}/tasks.md`,
      `${DRAFT_DIR}/${id}/tasks.json`,
    ],
    taskCount: ids.length * 3,
  }
}

function createWorktree({ repo, path, branch, baselineSha }) {
  if (existsSync(path)) throw new ChangeError(`worktree path already exists: ${path}`, { code: 'worktree-exists', status: 409 })
  try {
    git(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])
    throw new ChangeError(`branch already exists: ${branch}`, { code: 'branch-exists', status: 409 })
  } catch (error) {
    if (error instanceof ChangeError) throw error
  }
  mkdirSync(dirname(path), { recursive: true })
  try {
    git(repo, ['worktree', 'add', '-b', branch, path, baselineSha])
  } catch (error) {
    throw new ChangeError(`worktree add failed: ${error?.stderr?.toString?.() ?? error.message}`, { code: 'worktree-add-failed' })
  }
  return { path, branch }
}

function cleanupWorktree(repo, path, branch) {
  try {
    git(repo, ['worktree', 'remove', '--force', path])
  } catch {
    rmSync(path, { recursive: true, force: true })
  }
  try {
    git(repo, ['branch', '-D', branch])
  } catch {
    // branch may never have been created; best effort
  }
}

/**
 * Open the change. Default: write record + task draft without moving the
 * caller's worktree. `isolate`: create a sibling git worktree + branch from
 * the baseline and write the record/draft there (main worktree stays clean).
 */
export function openChange({ root, requirementIds, changeId, apply = false, isolate = false, worktreeRoot }) {
  const repo = resolve(root)
  const plan = planChange({ root: repo, requirementIds, changeId, isolate, worktreeRoot })
  if (!apply) return { ...plan, applied: false }

  const record = {
    schema: 'alm.change/v1',
    changeId: plan.changeId,
    baselineSha: plan.baselineSha,
    branch: plan.branch,
    createdAt: new Date().toISOString(),
    status: 'open',
  }

  const writeDraft = (targetRoot) => {
    const changeFile = join(targetRoot, CHANGE_DIR, `${plan.changeId}.json`)
    mkdirSync(join(targetRoot, CHANGE_DIR), { recursive: true })
    writeFileSync(changeFile, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
    try {
      const draft = draftTasks({ root: targetRoot, changeId: plan.changeId, requirementIds: plan.requirementIds })
      return { changeFile, draft }
    } catch (error) {
      // The change record must not survive a failed draft: leave no half state.
      rmSync(changeFile, { force: true })
      throw new ChangeError(`task draft failed: ${error?.message ?? String(error)}`, { code: 'draft-failed' })
    }
  }

  if (!plan.isolate) {
    const { changeFile, draft } = writeDraft(repo)
    return {
      ...plan,
      applied: true,
      change: record,
      changeFile,
      draft: { schema: draft.schema, dir: draft.dir, files: draft.files, tasks: draft.tasks },
    }
  }

  const worktree = createWorktree({ repo, path: plan.worktreePath, branch: plan.branch, baselineSha: plan.baselineSha })
  try {
    const { changeFile, draft } = writeDraft(worktree.path)
    return {
      ...plan,
      applied: true,
      worktree,
      change: record,
      changeFile,
      draft: { schema: draft.schema, dir: draft.dir, files: draft.files, tasks: draft.tasks },
    }
  } catch (error) {
    cleanupWorktree(repo, worktree.path, worktree.branch)
    throw error
  }
}
