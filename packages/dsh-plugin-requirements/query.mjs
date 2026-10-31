import { existsSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { STATUS_LABELS } from '../alm-core/src/model/asset.mjs'
import { readProject } from '../alm-core/src/project/project.mjs'
import { readMapping } from '../alm-core/src/github/mapping.mjs'
import { requirementLabels } from '../alm-core/src/github/sync-requirements.mjs'
import { buildGraph, findCycles, walk } from '../alm-core/src/index/closure.mjs'
import { buildIndex } from '../alm-core/src/index/index.mjs'
import { acceptanceSummary } from '../alm-core/src/acceptance/acceptance.mjs'
import { reviewView } from '../alm-core/src/review/executor.mjs'
import { decideEvidence } from '../alm-core/src/evidence/decision.mjs'
import { aiReviewSummary } from './ai-review.mjs'
import { gitHead } from '../alm-core/src/approvals/approval.mjs'
import { checkReport, indexReport } from '../alm-core/src/commands.mjs'

const NEXT = {
  'fix-blockers': '修阻塞',
  'fix-anomaly': '修数据异常',
  'rerun-evidence': '重跑证据',
  'run-review': '运行评审',
  'ai-review': '采纳 AI 评审',
  'run-acceptance': '运行验收',
  signoff: '去签收',
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
 * One deterministic next action per requirement, derived from the evidence
 * decision (not from status alone). The UI shows the label; the action itself
 * still runs through the normal skill and gate path, never through this page.
 */
export function nextActionFor(item, gaps = []) {
  const state = item?.decision?.state ?? null
  if (state === 'blocked') return 'fix-blockers'
  if (state === 'needs-clarification') return 'fix-anomaly'
  if (state === 'stale') return 'rerun-evidence'
  if (state === 'failed') return 'run-acceptance'
  if (state === 'ready-for-human') return 'signoff'
  if (state === 'verified') return 'done'
  // `unchecked` (or a decision that is not available yet): the first gap says
  // whether the missing evidence is the review or the acceptance run.
  const gap = item?.decision?.topGap ?? gaps[0] ?? null
  const code = String(gap?.code ?? '').toLowerCase()
  if (code === 'review-not-accepted') return 'ai-review'
  if (/review|role|coverage/.test(code)) return 'run-review'
  if (/acceptance|command|evidence/.test(code)) return 'run-acceptance'
  return 'run-review'
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

/** Stable key per parsed record, so two records with the same UID stay selectable. */
export function occurrenceKeyFor(asset) {
  return `${asset.id}@${asset.source.path}:${asset.source.line}`
}

function occurrenceFor(asset) {
  return {
    assetId: asset.id,
    uid: asset.id,
    title: asset.title ?? null,
    businessId: asset.extra?.businessId ?? null,
    file: asset.source.path,
    line: asset.source.line,
    occurrenceKey: occurrenceKeyFor(asset),
  }
}

/**
 * Data anomalies are collected in the query layer and never merged away: two
 * records with the same UID (or business id) both stay in the payload. The
 * anomaly is a clarification signal, so it is not mixed into the tracking gaps.
 */
export function collectAnomalies({ assets = [], check = null } = {}) {
  const index = buildIndex(assets)
  const anomalies = []

  for (const entry of index.duplicates) {
    anomalies.push({
      kind: 'duplicate-id',
      message: `需求 UID ${entry.id} 出现 ${entry.occurrences.length} 次；保留全部记录，不自动合并`,
      requirementIds: [entry.id],
      occurrences: entry.occurrences.map(occurrenceFor),
    })
  }

  // Same business id (or, when absent, the same UID) may only map to one UID.
  const businessGroups = new Map()
  for (const asset of assets.filter((entry) => entry.type === 'requirement')) {
    const key = asset.extra?.businessId ?? asset.id
    if (!businessGroups.has(key)) businessGroups.set(key, [])
    businessGroups.get(key).push(asset)
  }
  for (const [key, group] of businessGroups) {
    const ids = [...new Set(group.map((entry) => entry.id))]
    if (ids.length < 2) continue
    anomalies.push({
      kind: 'duplicate-business-id',
      message: `业务编号 ${key} 对应 ${ids.length} 个不同需求 UID（${ids.join('、')}）；保留两条记录，不自动合并`,
      requirementIds: ids,
      occurrences: group.map(occurrenceFor),
    })
  }

  // Dangling relations come from the real REL-001 gate findings; resolve the
  // original link so the anomaly shows the from/type/target triple.
  const rel = (check?.checks ?? []).find((entry) => entry.id === 'REL-001')
  const seenDangling = new Set()
  for (const finding of rel?.findings ?? []) {
    const asset =
      assets.find((entry) => entry.id === finding.assetId && entry.source.path === finding.file) ??
      index.byId.get(finding.assetId) ??
      null
    const dangling =
      asset?.links?.find((link) => !index.byId.has(link.target) && (link.line ?? asset.source.line) === finding.line) ??
      asset?.links?.find((link) => !index.byId.has(link.target)) ??
      null
    const message = finding.message ?? 'dangling relation'
    const from = finding.assetId ?? asset?.id ?? null
    const type = dangling?.type ?? /^dangling\s+(\S+)\s+target/.exec(message)?.[1] ?? null
    const target = dangling?.target ?? /target\s+(\S+)/.exec(message)?.[1] ?? null
    const dedupeKey = `${from}|${type}|${target}|${finding.file ?? ''}|${finding.line ?? ''}`
    if (seenDangling.has(dedupeKey)) continue
    seenDangling.add(dedupeKey)
    anomalies.push({
      kind: 'dangling-relation',
      message: `悬空关系：${from ?? '?'} --${type ?? '?'}--> ${target ?? '?'}；来源记录保留，不自动删除`,
      requirementIds: from ? [from] : [],
      occurrences: asset ? [occurrenceFor(asset)] : [],
      from,
      type,
      target,
      file: finding.file ?? asset?.source.path ?? null,
      line: finding.line ?? asset?.source.line ?? null,
    })
  }

  return anomalies
}

export function summarizeAnomalies(anomalies = []) {
  return {
    count: anomalies.length,
    duplicateId: anomalies.filter((entry) => entry.kind === 'duplicate-id').length,
    duplicateBusinessId: anomalies.filter((entry) => entry.kind === 'duplicate-business-id').length,
    dangling: anomalies.filter((entry) => entry.kind === 'dangling-relation').length,
  }
}

/** Per-requirement anomaly view; `ref` is the record key so duplicate rows stay distinguishable. */
export function anomaliesForAsset(anomalies, asset) {
  const key = occurrenceKeyFor(asset)
  return anomalies
    .filter((anomaly) => anomaly.requirementIds.includes(asset.id))
    .map((anomaly) => {
      const occurrence = anomaly.occurrences?.find((entry) => entry.occurrenceKey === key) ?? null
      return {
        kind: anomaly.kind,
        message: anomaly.message,
        ref: occurrence?.occurrenceKey ?? key,
        file: occurrence?.file ?? anomaly.file ?? asset.source.path,
        line: occurrence?.line ?? anomaly.line ?? asset.source.line,
      }
    })
}

/** `reviewView` owns the coverage once the shared layer provides it; keep a fallback. */
function reviewWithCoverage(review) {
  if (review?.coverage) return review
  const roles = Array.isArray(review?.roles) ? review.roles : []
  const missing = roles.filter((role) => role.verdict === 'skip').map((role) => role.id)
  return { ...review, coverage: { completed: roles.length - missing.length, total: roles.length, missing } }
}

/**
 * Requirements page payload. Gaps come from the real gate checks (COV-001 /
 * COV-002), never from a static mock. Evidence decision and data anomalies are
 * separate fields so an anomaly never looks like a pass/fail verdict.
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
  const assets = index.assets
  const anomalies = collectAnomalies({ assets, check })
  let headSha = null
  try {
    headSha = gitHead(root)
  } catch {
    headSha = null
  }
  const versionCache = new Map()
  const items = assets
    .filter((asset) => asset.type === 'requirement')
    .map((asset) => {
      const verifiedBy = asset.links.filter((link) => link.type === 'verified_by').map((link) => link.target)
      const extra = asset.extra ?? {}
      const files = attachmentFiles(root, asset.id)
      const item = {
        id: asset.id,
        businessId: extra.businessId ?? null,
        occurrenceKey: occurrenceKeyFor(asset),
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
      item.review = reviewWithCoverage(reviewView({ root, asset, item, check }))
      item.anomalies = anomaliesForAsset(anomalies, asset)
      item.acceptance = acceptanceSummary(root, asset.id, headSha, { asset, assets })
      item.decision = decideEvidence({
        asset,
        review: item.review,
        acceptance: item.acceptance,
        anomalies,
      })
      item.nextAction = nextActionFor(item, gaps)
      item.nextActionLabel = nextActionLabel(item.nextAction)
      const versions = versionCache.get(item.file) ?? versionHistory(root, item.file)
      versionCache.set(item.file, versions)
      item.versions = versions
      item.trace = traceFor({ asset, graph, byId })
      item.aiReview = aiReviewSummary(root, asset.id)
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
    anomalies,
    anomalySummary: summarizeAnomalies(anomalies),
    summary: { requirements: items.length, gaps: gaps.length, anomalies: anomalies.length },
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
  const anomalies = loaded.flatMap((entry) =>
    (entry.payload?.anomalies ?? []).map((anomaly) => ({
      ...anomaly,
      project: entry.project,
      projectName: entry.projectName,
    })),
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
    anomalies,
    anomalySummary: summarizeAnomalies(anomalies),
    projects: loaded.map((entry) => ({
      project: entry.project,
      projectName: entry.projectName,
      root: entry.root,
      result: entry.payload?.result ?? 'fail',
      requirements: entry.payload?.requirements?.length ?? 0,
      anomalies: entry.payload?.anomalies?.length ?? 0,
      error: entry.error ?? null,
    })),
    summary: {
      requirements: items.length,
      gaps: gaps.length,
      anomalies: anomalies.length,
      projects: loaded.length,
      failed: failed.length,
    },
  }
}
