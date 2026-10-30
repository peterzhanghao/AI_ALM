import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export const PROJECT_ID = /^[A-Z][A-Z0-9]{1,7}$/
export const PROJECT_SCHEMA = 'alm.project/v1'

export class ProjectError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ProjectError'
  }
}

export function projectFile(root) {
  return join(resolve(root), '.alm', 'project.json')
}

export function registryPath(home = homedir()) {
  return process.env.DSH_ALM_REGISTRY || join(home, '.dsh', 'alm', 'projects.json')
}

/** `https://github.com/o/r.git` / `git@github.com:o/r.git` -> `o/r`. */
export function remoteSlug(url) {
  const value = String(url).trim().replace(/\.git$/, '')
  const https = /^(?:https?|ssh):\/\/[^/]+\/(.+)$/.exec(value)
  if (https) return https[1]
  const scp = /^[^@]+@[^:]+:(.+)$/.exec(value)
  if (scp) return scp[1]
  const bare = /^(?:www\.)?github\.com\/(.+)$/.exec(value)
  if (bare) return bare[1]
  return value
}

function assertProject(project) {
  if (project === null || typeof project !== 'object' || Array.isArray(project)) {
    throw new ProjectError('project must be a JSON object')
  }
  if (project.schema !== PROJECT_SCHEMA) throw new ProjectError(`unsupported schema: ${String(project.schema)}`)
  if (!PROJECT_ID.test(String(project.id ?? ''))) throw new ProjectError(`invalid project id: ${String(project.id)}`)
  if (typeof project.name !== 'string' || project.name.trim() === '') throw new ProjectError('project name is required')
  if (typeof project.requirementRoot !== 'string' || project.requirementRoot.trim() === '') {
    throw new ProjectError('requirementRoot is required')
  }
  if (project.github === null || typeof project.github !== 'object') throw new ProjectError('github is required')
  const { owner, repo } = project.github
  if (typeof owner !== 'string' || owner.trim() === '') throw new ProjectError('github.owner is required')
  if (typeof repo !== 'string' || repo.trim() === '') throw new ProjectError('github.repo is required')
  if (project.github.project !== undefined) {
    const number = project.github.project?.number
    if (!Number.isInteger(number) || number < 1) throw new ProjectError('github.project.number must be a positive integer')
  }
  return project
}

export function readProject(root) {
  const file = projectFile(root)
  if (!existsSync(file)) return null
  let payload
  try {
    payload = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    throw new ProjectError(`cannot read ${file}: ${error.message}`)
  }
  return assertProject(payload)
}

export function writeProject({ root, id, name, githubRepo, projectNumber, requirementRoot = 'requirements', defaultBranch = 'main', teams = [] }) {
  const file = projectFile(root)
  if (existsSync(file)) throw new ProjectError(`project already exists: ${file}`)
  const [owner, repo] = String(githubRepo).split('/')
  if (!owner || !repo) throw new ProjectError(`--repo must be owner/repo, got ${githubRepo}`)
  const project = {
    schema: PROJECT_SCHEMA,
    id,
    name,
    defaultBranch,
    requirementRoot,
    github: { owner, repo, ...(projectNumber ? { project: { number: projectNumber } } : {}) },
    teams,
  }
  assertProject(project)
  mkdirSync(join(resolve(root), '.alm'), { recursive: true })
  writeFileSync(file, `${JSON.stringify(project, null, 2)}\n`, 'utf8')
  return { ...project, file }
}

/** Compare the project file with the git remote and the requirement folder. */
export function verifyProject({ root, exec = execFileSync } = {}) {
  const findings = []
  let project
  try {
    project = readProject(root)
  } catch (error) {
    return { ok: false, project: null, findings: [{ field: 'project', message: error.message }] }
  }
  if (!project) return { ok: false, project: null, findings: [{ field: 'project', message: 'no .alm/project.json' }] }

  if (!existsSync(join(resolve(root), project.requirementRoot))) {
    findings.push({ field: 'requirementRoot', message: `missing folder: ${project.requirementRoot}` })
  }

  try {
    const remote = exec('git', ['-C', resolve(root), 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim()
    const slug = remoteSlug(remote)
    const expected = `${project.github.owner}/${project.github.repo}`
    if (slug !== expected) findings.push({ field: 'github.repo', message: `remote ${slug} != ${expected}` })
  } catch {
    findings.push({ field: 'github.repo', message: 'git remote origin is missing' })
  }

  return { ok: findings.length === 0, project, findings }
}

/** Read the DSH registry and re-check each entry's project file. */
export function listProjects({ registry = registryPath() } = {}) {
  if (!existsSync(registry)) return { schema: 'alm.projects/v1', projects: [], errors: [] }
  let payload
  try {
    payload = JSON.parse(readFileSync(registry, 'utf8'))
  } catch (error) {
    return { schema: 'alm.projects/v1', projects: [], errors: [{ message: `unreadable registry: ${error.message}` }] }
  }
  const errors = []
  const projects = []
  const seen = new Set()
  for (const entry of payload.projects ?? []) {
    if (!entry || typeof entry.root !== 'string') {
      errors.push({ message: 'registry entry needs root' })
      continue
    }
    const root = resolve(entry.root)
    try {
      const project = readProject(root)
      if (!project) {
        errors.push({ message: `no project file at ${root}` })
        continue
      }
      if (entry.id && entry.id !== project.id) {
        errors.push({ message: `registry id ${entry.id} != project id ${project.id} at ${root}` })
        continue
      }
      if (seen.has(project.id)) {
        errors.push({ message: `duplicate project id ${project.id}` })
        continue
      }
      seen.add(project.id)
      projects.push({ ...project, root })
    } catch (error) {
      errors.push({ message: error.message })
    }
  }
  return { schema: 'alm.projects/v1', projects, errors }
}

export function scanProjects(dirs) {
  const projects = []
  const errors = []
  for (const dir of dirs) {
    const root = resolve(dir)
    if (!existsSync(root)) {
      errors.push({ message: `not a directory: ${dir}` })
      continue
    }
    try {
      const project = readProject(root)
      if (project) projects.push({ ...project, root })
    } catch (error) {
      errors.push({ message: error.message })
    }
  }
  return { schema: 'alm.projects/v1', projects, errors }
}

export function listRegistryFiles() {
  const dir = join(homedir(), '.dsh', 'alm')
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((name) => name.endsWith('.json')).map((name) => join(dir, name))
}
