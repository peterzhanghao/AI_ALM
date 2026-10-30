import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { readProject } from '../alm-core/src/project/project.mjs'

/** DSH workspace store (`~/.dsh/storages/workspace.json`), overridable for tests. */
export function workspacesFile() {
  if (process.env.DSH_WORKSPACES_FILE) return resolve(process.env.DSH_WORKSPACES_FILE)
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'storages', 'workspace.json')
}

/**
 * Workspaces are the project spaces of the requirements plugin. The DSH
 * "default workspace" is excluded: it is a scratch session bucket, not a
 * project. A workspace becomes a project once `.alm/project.json` exists;
 * otherwise it is listed as unlinked so the UI can offer "associate repo".
 */
export function listWorkspaces({ file = workspacesFile() } = {}) {
  const empty = { schema: 'alm.workspaces/v1', source: file, defaultWorkspaceId: null, workspaces: [], errors: [] }
  if (!existsSync(file)) return empty
  let payload
  try {
    payload = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    return { ...empty, errors: [{ message: `unreadable workspace store: ${error.message}` }] }
  }
  const global = payload.global ?? {}
  const table = payload.tables?.workspaces ?? {}
  const defaultWorkspaceId = global.defaultWorkspaceId ?? null
  const errors = []
  const workspaces = []

  for (const [workspaceId, entry] of Object.entries(table)) {
    if (workspaceId === defaultWorkspaceId) continue
    if (!entry || typeof entry.path !== 'string') {
      errors.push({ workspaceId, message: 'workspace entry needs a path' })
      continue
    }
    const root = resolve(entry.path)
    const title = typeof entry.title === 'string' && entry.title.trim() !== '' ? entry.title : root
    if (title === 'default-workspace') continue
    let project = null
    try {
      project = readProject(root)
    } catch (error) {
      errors.push({ workspaceId, title, message: error.message })
    }
    workspaces.push({
      id: project?.id ?? workspaceId,
      projectId: project?.id ?? null,
      workspaceId,
      name: project?.name ?? title,
      title,
      root,
      exists: existsSync(root),
      linked: Boolean(project),
      github: project?.github
        ? { owner: project.github.owner, repo: project.github.repo, project: project.github.project ?? null }
        : null,
      teams: project?.teams ?? [],
    })
  }

  workspaces.sort((left, right) => left.title.localeCompare(right.title, 'zh-CN'))
  return { schema: 'alm.workspaces/v1', source: file, defaultWorkspaceId, workspaces, errors }
}
