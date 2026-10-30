import { existsSync, statSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { STATUS_LABELS } from '../alm-core/src/model/asset.mjs'
import { readProject } from '../alm-core/src/project/project.mjs'
import { readMapping } from '../alm-core/src/github/mapping.mjs'
import { requirementLabels } from '../alm-core/src/github/sync-requirements.mjs'
import { checkReport, indexReport } from '../alm-core/src/commands.mjs'

const NEXT = {
  'missing-acceptance': '补验收',
  'dangling-relation': '修关系',
  'ready-to-change': '发起变更',
  'in-progress': '查看进度',
  verify: '去验收',
  done: '已完成',
}

function attachmentFiles(root, id) {
  const file = join(root, 'requirements', 'attachments', id, 'manifest.json')
  if (!existsSync(file)) return []
  try {
    return (JSON.parse(readFileSync(file, 'utf8')).files ?? []).map((entry) => ({
      name: entry.path,
      kind: entry.kind ?? null,
    }))
  } catch {
    return []
  }
}

/** Source narrative lives in a brief markdown file; return its text for the drawer. */
function briefText(root, relative) {
  if (!relative || typeof relative !== 'string') return null
  const file = isAbsolute(relative) ? relative : join(root, relative)
  if (!existsSync(file)) return null
  try {
    return readFileSync(file, 'utf8').trim().slice(0, 8000)
  } catch {
    return null
  }
}

/** Requirement-level GitHub attribution: issue, labels, board and parented task issues. */
function githubFor({ mapping, project, asset }) {
  const entry = mapping?.requirements?.[asset.id]
  if (!entry?.number) return null
  const repo = mapping.repo ?? (project?.github ? `${project.github.owner}/${project.github.repo}` : null)
  const boardNumber = project?.github?.project?.number ?? null
  const tasks = Object.entries(mapping.tasks ?? {})
    .filter(([, task]) => String(task.parent ?? '') === String(entry.number))
    .map(([id, task]) => ({ id, number: task.number ?? null, url: task.url ?? null }))
  return {
    provider: entry.provider ?? 'github',
    repo,
    issue: entry.number,
    url: entry.url ?? null,
    labels: requirementLabels(project, asset),
    board: boardNumber ? { number: boardNumber, status: project?.github?.project?.status?.ready ?? null } : null,
    tasks,
  }
}

export function nextActionLabel(action) {
  return NEXT[action] ?? '查看'
}

/**
 * One deterministic next action per requirement. The UI shows the label and
 * copies a prompt; the action itself still runs through the normal skill and
 * gate path, never through this page.
 */
export function nextActionFor(item, gaps = []) {
  if (!item || !Array.isArray(item.verifiedBy) || item.verifiedBy.length === 0) return 'missing-acceptance'
  const related = gaps.some(
    (gap) => gap.assetId === item.id || (gap.file === item.file && gap.rule === 'REL-001'),
  )
  if (related) return 'dangling-relation'
  if (item.status === 'implemented') return 'verify'
  if (item.status === 'in-progress') return 'in-progress'
  if (['verified', 'deprecated', 'superseded'].includes(item.status)) return 'done'
  return 'ready-to-change'
}

/**
 * Resolve `?root=` for the read-only API. Relative paths resolve against the
 * repository root (the parent of the default fixture), never against the
 * caller's cwd; `..` is rejected so the page cannot roam the filesystem.
 */
export function resolveRequirementsRoot(requested, fallback) {
  if (requested === undefined || requested === null) return fallback
  const value = String(requested).trim()
  if (value === '') return fallback

  const segments = value.split(/[\/]+/)
  if (segments.includes('..')) {
    const error = new Error('root must not contain ".."')
    error.status = 400
    error.code = 'invalid-root'
    throw error
  }

  const repoRoot = resolve(fallback, '..', '..')
  const absolute = isAbsolute(value) ? value : join(repoRoot, value)
  if (!existsSync(absolute) || !statSync(absolute).isDirectory()) {
    const error = new Error(`root not found: ${value}`)
    error.status = 404
    error.code = 'root-not-found'
    throw error
  }
  return absolute
}

/**
 * Requirements page payload. Gaps come from the real gate checks (COV-001 /
 * COV-002), never from a static mock.
 */
export function requirements(root) {
  const index = indexReport(root)
  if (index.ok === false) return index

  const check = checkReport(root)
  if (check.ok === false) return check

  const gaps = check.checks
    .filter((entry) => entry.id === 'COV-001' || entry.id === 'COV-002')
    .flatMap((entry) => entry.findings.map((finding) => ({ rule: entry.id, ...finding })))

  let project = null
  try {
    project = readProject(root)
  } catch {
    project = null
  }
  let mapping = null
  try {
    mapping = readMapping(root)
  } catch {
    mapping = null
  }

  const projectInfo = project
    ? {
        id: project.id,
        name: project.name,
        repo: project.github ? `${project.github.owner}/${project.github.repo}` : null,
        board: project.github?.project?.number ?? null,
        status: project.github?.project?.status ?? null,
      }
    : null

  const items = index.assets
    .filter((asset) => asset.type === 'requirement')
    .map((asset) => {
      const verifiedBy = asset.links.filter((link) => link.type === 'verified_by').map((link) => link.target)
      const extra = asset.extra ?? {}
      const files = attachmentFiles(root, asset.id)
      const item = {
        id: asset.id,
        title: asset.title,
        status: asset.status,
        statusLabel: STATUS_LABELS[asset.status] ?? asset.status,
        owner: asset.owner,
        project: project?.id ?? null,
        projectName: project?.name ?? null,
        priority: extra.priority ?? null,
        category: extra.category ?? null,
        revision: extra.revision ?? 1,
        brief: extra.brief ?? null,
        briefText: briefText(root, extra.brief),
        sources: Array.isArray(extra.sources) ? extra.sources : [],
        attachments: files.length,
        attachmentFiles: files,
        verifiedBy,
        file: asset.source.path,
        line: asset.source.line,
        links: asset.links.map((link) => ({ type: link.type, target: link.target, line: link.line ?? null })),
        github: githubFor({ mapping, project, asset }),
      }
      item.nextAction = nextActionFor(item, gaps)
      item.nextActionLabel = nextActionLabel(item.nextAction)
      return item
    })

  return {
    schema: 'alm.requirements/v1',
    scope: 'project',
    root: index.root,
    project: project?.id ?? null,
    projectName: project?.name ?? null,
    projectInfo,
    result: check.result,
    requirements: items,
    gaps,
    summary: { requirements: items.length, gaps: gaps.length },
  }
}

/**
 * Cross-project aggregate for the "全部项目" view: every project root feeds the
 * same payload shape, each requirement is tagged with its project. A project
 * that fails to index is reported per project instead of failing the whole view.
 */
export function requirementsAll(projects = []) {
  const loaded = projects.map((project) => {
    try {
      const payload = requirements(project.root)
      if (payload?.ok === false) {
        return { project: project.id, projectName: project.name, root: project.root, error: payload.error ?? 'index failed' }
      }
      return { project: project.id, projectName: project.name, root: project.root, payload }
    } catch (error) {
      return { project: project.id, projectName: project.name, root: project.root, error: error?.message ?? String(error) }
    }
  })

  const items = loaded.flatMap((entry) =>
    (entry.payload?.requirements ?? []).map((item) => ({
      ...item,
      project: entry.project,
      projectName: entry.projectName,
    })),
  )
  const gaps = loaded.flatMap((entry) =>
    (entry.payload?.gaps ?? []).map((gap) => ({ ...gap, project: entry.project, projectName: entry.projectName })),
  )
  const failed = loaded.filter((entry) => entry.error)

  return {
    schema: 'alm.requirements/v1',
    scope: 'all',
    root: null,
    project: null,
    projectName: null,
    projectInfo: null,
    result: failed.length ? 'fail' : 'pass',
    requirements: items,
    gaps,
    projects: loaded.map((entry) => ({
      project: entry.project,
      projectName: entry.projectName,
      root: entry.root,
      result: entry.payload?.result ?? 'fail',
      requirements: entry.payload?.requirements?.length ?? 0,
      error: entry.error ?? null,
    })),
    summary: { requirements: items.length, gaps: gaps.length, projects: loaded.length, failed: failed.length },
  }
}
