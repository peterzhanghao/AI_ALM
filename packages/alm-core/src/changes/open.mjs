import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
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

/**
 * Plan an open change for one requirement: baseline, branch and where the
 * change record / task draft will land. Planning never writes to the repository.
 */
export function planChange({ root, requirementIds, changeId }) {
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

  return {
    schema: 'alm.change.plan/v1',
    changeId: id,
    project: project?.id ?? null,
    baselineSha,
    branch: `alm/${id.toLowerCase()}`,
    requirementIds: ids,
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

/**
 * Open the change: write the change record (no branch switch, the caller's
 * worktree is never moved) and draft the task cards for the requirements.
 */
export function openChange({ root, requirementIds, changeId, apply = false }) {
  const repo = resolve(root)
  const plan = planChange({ root: repo, requirementIds, changeId })
  if (!apply) return { ...plan, applied: false }

  const record = {
    schema: 'alm.change/v1',
    changeId: plan.changeId,
    baselineSha: plan.baselineSha,
    branch: plan.branch,
    createdAt: new Date().toISOString(),
    status: 'open',
  }
  const changeFile = join(repo, CHANGE_DIR, `${plan.changeId}.json`)
  mkdirSync(join(repo, CHANGE_DIR), { recursive: true })
  writeFileSync(changeFile, `${JSON.stringify(record, null, 2)}\n`, 'utf8')

  let draft
  try {
    draft = draftTasks({ root: repo, changeId: plan.changeId, requirementIds: plan.requirementIds })
  } catch (error) {
    // The change record must not survive a failed draft: leave no half state.
    rmSync(changeFile, { force: true })
    throw new ChangeError(`task draft failed: ${error?.message ?? String(error)}`, { code: 'draft-failed' })
  }

  return {
    ...plan,
    applied: true,
    change: record,
    draft: { schema: draft.schema, dir: draft.dir, files: draft.files, tasks: draft.tasks },
  }
}
