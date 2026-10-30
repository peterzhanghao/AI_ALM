import { existsSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { STATUS_LABELS } from '../alm-core/src/model/asset.mjs'
import { readProject } from '../alm-core/src/project/project.mjs'
import { readMapping } from '../alm-core/src/github/mapping.mjs'
import { requirementLabels } from '../alm-core/src/github/sync-requirements.mjs'
import { buildGraph, findCycles, walk } from '../alm-core/src/index/closure.mjs'
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

/**
 * Review roles map onto existing gate rules: no second source of truth, and a
 * role is only "covered" when at least one of its rules actually ran.
 */
const REVIEW_ROLES = [
  { id: 'business', label: '业务', rules: ['BRIEF-001'] },
  { id: 'architecture', label: '架构', rules: ['REL-001', 'REL-002', 'REL-003', 'PRJ-001', 'REV-001'] },
  { id: 'testing', label: '测试', rules: ['COV-001', 'COV-002'] },
  { id: 'security', label: '安全', rules: ['SEC-001'] },
  { id: 'delivery', label: '交付', rules: ['ATT-001', 'TASK-001'] },
]

function findingHits(finding, item) {
  if (!finding) return false
  return finding.assetId === item.id || finding.file === item.file
}

/** Gate-backed multi-role review. Human sign-off is a separate, explicit step. */
export function reviewFor(item, check) {
  const checks = new Map((check.checks ?? []).map((entry) => [entry.id, entry]))
  const roles = REVIEW_ROLES.map((role) => {
    const findings = []
    const levels = []
    for (const ruleId of role.rules) {
      const rule = checks.get(ruleId)
      if (!rule) continue
      levels.push(rule.level)
      for (const finding of rule.findings ?? []) {
        if (!findingHits(finding, item)) continue
        findings.push({
          rule: ruleId,
          severity: rule.level === 'warn' ? 'warn' : 'block',
          message: finding.message,
          file: finding.file ?? null,
          line: finding.line ?? null,
        })
      }
    }
    const active = levels.filter((level) => level !== 'skip' && level !== 'off')
    let verdict
    if (active.length === 0) verdict = 'skip'
    else if (findings.some((finding) => finding.severity === 'block')) verdict = 'block'
    else if (findings.length > 0) verdict = 'warn'
    else verdict = 'pass'
    return { id: role.id, label: role.label, verdict, rules: role.rules, findings }
  })
  const blockers = roles.filter((role) => role.verdict === 'block').length
  return {
    schema: 'alm.review/v1',
    source: 'gates',
    roles,
    summary: {
      completed: roles.filter((role) => role.verdict !== 'skip').length,
      total: roles.length,
      blockers,
      ready: blockers === 0,
    },
    signoff: null,
  }
}

const NODE_TYPES = {
  requirement: 'req',
  'acceptance-test': 'test',
  'architecture-decision': 'adr',
  module: 'module',
  interface: 'interface',
  'data-model': 'data',
  risk: 'risk',
}

function nodeType(asset) {
  if (!asset) return 'missing'
  return NODE_TYPES[asset.type] ?? 'other'
}

/**
 * Direct trace graph for one requirement: outgoing links plus incoming links
 * (e.g. a parent requirement's `parent_of`). Impact counts use the same graph
 * closure as `alm impact`, so the numbers agree with the CLI.
 */
export function traceFor({ asset, graph, byId }) {
  const outgoing = graph.forward.get(asset.id) ?? []
  const incoming = graph.reverse.get(asset.id) ?? []
  const seen = new Map()
  const add = (id) => {
    if (seen.has(id)) return
    const target = byId.get(id)
    seen.set(id, {
      id,
      title: target?.title ?? null,
      type: nodeType(target),
      status: target?.status ?? null,
      current: id === asset.id,
    })
  }
  add(asset.id)
  for (const edge of outgoing) add(edge.to)
  for (const edge of incoming) add(edge.from)
  const edges = [
    ...outgoing.map((edge) => ({ from: asset.id, to: edge.to, type: edge.type })),
    ...incoming.map((edge) => ({ from: edge.from, to: asset.id, type: edge.type })),
  ]
  const forward = walk(graph, asset.id, 'forward')
  const backward = walk(graph, asset.id, 'reverse')
  const cycles = [...findCycles(graph, asset.id, 'forward'), ...findCycles(graph, asset.id, 'reverse')]
  return {
    schema: 'alm.trace/v1',
    nodes: [...seen.values()],
    edges,
    cycles,
    stats: {
      parent: incoming.filter((edge) => edge.type === 'parent_of').length,
      children: outgoing.filter((edge) => edge.type === 'parent_of').length,
      tests: outgoing.filter((edge) => edge.type === 'verified_by').length,
      dependencies: outgoing.filter((edge) => edge.type === 'depends_on').length,
      constraints: outgoing.filter((edge) => edge.type === 'constrained_by').length,
      impacted: backward.length,
      reachable: forward.length,
    },
  }
}

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

/** Version history from git: the requirement file is the source of record. */
export function versionHistory(root, file, limit = 20) {
  try {
    const top = git(root, ['rev-parse', '--show-toplevel'])
    const path = relative(top, resolve(root, file)).replace(/\\/g, '/')
    // Run from the repository top: `-C <subdir>` would resolve the path against
    // that subdirectory and silently return no commits.
    const output = git(top, ['log', '--follow', '--max-count', String(limit), '--format=%H%x1f%h%x1f%aI%x1f%s', '--', path])
    return output
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [sha, short, date, subject] = line.split('\x1f')
        return { sha, short, date, subject }
      })
  } catch {
    return []
  }
}

/** Read one committed snapshot of a requirement file, read-only. */
export function versionSnapshot({ root, assetId, sha }) {
  const invalid = (message, status, code) => {
    const error = new Error(message)
    error.status = status
    error.code = code
    return error
  }
  if (!/^[0-9a-f]{7,40}$/.test(String(sha ?? ''))) throw invalid('sha must be 7-40 hex characters', 400, 'invalid-sha')
  const index = indexReport(root)
  if (index.ok === false) throw invalid(index.error ?? 'index failed', 500, 'index-failed')
  const asset = index.assets.find((entry) => entry.id === assetId)
  if (!asset) throw invalid(`asset not found: ${assetId}`, 404, 'asset-not-found')
  try {
    const top = git(root, ['rev-parse', '--show-toplevel'])
    const path = relative(top, resolve(root, asset.source.path)).replace(/\\/g, '/')
    const content = git(top, ['show', `${sha}:${path}`])
    return { schema: 'alm.version/v1', asset: asset.id, sha, path, content }
  } catch (error) {
    throw invalid(`cannot read ${sha}: ${error?.message ?? String(error)}`, 400, 'version-unavailable')
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

  const graph = buildGraph(index.assets)
  const byId = new Map(index.assets.map((asset) => [asset.id, asset]))
  const versionCache = new Map()
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
        root: index.root,
        line: asset.source.line,
        links: asset.links.map((link) => ({ type: link.type, target: link.target, line: link.line ?? null })),
        github: githubFor({ mapping, project, asset }),
      }
      item.nextAction = nextActionFor(item, gaps)
      item.nextActionLabel = nextActionLabel(item.nextAction)
      item.review = reviewFor(item, check)
      const versions = versionCache.get(item.file) ?? versionHistory(root, item.file)
      versionCache.set(item.file, versions)
      item.versions = versions
      item.trace = traceFor({ asset, graph, byId })
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
