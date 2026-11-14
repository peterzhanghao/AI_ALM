import { existsSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
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
import { candidateView, worktreeSnapshot } from '../alm-core/src/requirements/candidate.mjs'
import { DELIVERY_LABELS, deliveryStateFor, isClosed, readClosure } from '../alm-core/src/requirements/delivery.mjs'
import { releaseViewFor } from '../alm-core/src/requirements/release.mjs'
import { readArchitectureLedger } from '../alm-core/src/requirements/arch-ledger.mjs'
import { defectView, failureDiagnosis, listFailures } from '../alm-core/src/requirements/failure.mjs'
import { runView, readRun } from '../alm-core/src/requirements/run.mjs'
import { listSpecConvergences, pendingSpecDeltas, readIterationRetry, requirementSpecContext } from '../alm-core/src/requirements/convergence.mjs'
import { resolveRunDecision } from '../alm-core/src/requirements/run-decision.mjs'
import { inspectBlueprintScope, readBlueprint } from '../alm-core/src/requirements/blueprint-guard.mjs'
import { presentDecisionRequest } from '../alm-core/src/requirements/decision-presentation.mjs'
import { signoffView } from '../alm-core/src/requirements/signoff.mjs'
import { decideEvidence } from '../alm-core/src/evidence/decision.mjs'
import { aiReviewSummary } from './ai-review.mjs'
import { docHashOf, parseDoc } from '../alm-core/src/requirements/doc.mjs'
import { deriveDetailView } from './detail-view.mjs'
import { versionPath } from './version-path.mjs'
import { rejectionReview } from './reject-candidate.mjs'
import { gitHead } from '../alm-core/src/approvals/approval.mjs'
import { checkReport, indexReport, loadRepo } from '../alm-core/src/commands.mjs'

const NEXT = {
  'fix-blockers': '修阻塞',
  'fix-anomaly': '修数据异常',
  'rerun-evidence': '重跑证据',
  'run-review': '运行评审',
  'ai-review': '采纳 AI 评审',
  'run-acceptance': '运行验收',
  'create-candidate': '生成交付候选',
  'confirm-defect': '确认缺陷并开始迭代',
  'resume-run': '恢复推进',
  'answer-run': '回答并继续',
  'watch-run': '查看推进',
  'resume-defect': '恢复缺陷修复',
  signoff: '人类验收',
  release: '决定发布',
  'execute-release': '执行发布',
  done: '已完成',
}

/**
 * Requirement roots are stored as repo-relative paths (`.alm/project.json`).
 * Accept backslashes and a leading `./` so hand-written configs keep working;
 * an empty value means "whole repository" (legacy fixture projects).
 */
function normaliseRoot(value) {
  if (typeof value !== 'string') return null
  const normalized = value.trim().replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, '')
  return normalized === '' || normalized === '.' ? null : normalized
}

/** Compare repo-relative paths across Windows and POSIX separators. */
function normaliseFile(value) {
  return String(value ?? '')
    .replaceAll('\\', '/')
    .replace(/^\.\//, '')
}

/** The requirement root declared by the project, else the conventional `requirements/`. */
function requirementRootOf(root, project) {
  return normaliseRoot(project?.requirementRoot) ?? (existsSync(join(root, 'requirements')) ? 'requirements' : null)
}

function belongsToRequirementRoot(asset, requirementRoot) {
  if (!requirementRoot) return true
  const file = normaliseFile(asset?.source?.path)
  return file === requirementRoot || file.startsWith(`${requirementRoot}/`)
}

/**
 * Requirements belong to the project's declared requirement root. A nullable
 * root means "whole repository" and keeps legacy projects working.
 */
export function visibleRequirementAssets({ root, assets = [], project = null }) {
  const requirementRoot = requirementRootOf(root, project)
  return {
    requirementRoot,
    assets: assets.filter((asset) => asset.type === 'requirement' && belongsToRequirementRoot(asset, requirementRoot)),
  }
}

/**
 * Report data anomalies only for the records this project can show. Scanning
 * the whole repository would surface negative fixtures (`fixtures/negative/*`)
 * in the banner while the list hides them: the count would not reconcile with
 * the visible rows, so the user is told about a duplicate they cannot open.
 */
export function collectProjectAnomalies({ root, assets = [], check = null, project = null } = {}) {
  const scoped = visibleRequirementAssets({ root, assets, project })
  const files = scoped.assets.map((asset) => asset.source.path)
  return {
    requirementRoot: scoped.requirementRoot,
    anomalies: collectAnomalies({
      assets: scoped.assets,
      check,
      visibleFiles: scoped.requirementRoot ? files : null,
    }),
  }
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

/** Source narrative lives in a brief markdown file; return its full text for the drawer. */
function briefText(root, relative) {
  if (!relative || typeof relative !== 'string') return null
  const file = isAbsolute(relative) ? relative : join(root, relative)
  if (!existsSync(file)) return null
  try {
    // The brief is the only source of truth: never truncate it here. Execution
    // and the detail description both read this exact text.
    return readFileSync(file, 'utf8').trim()
  } catch {
    return null
  }
}

/** UTF-8 byte size of the brief, for list badges and execution limits. */
function briefBytesOf(text) {
  return typeof text === 'string' ? Buffer.byteLength(text, 'utf8') : null
}

/**
 * One-line list preview. The list never needs the whole document, so it gets a
 * flattened excerpt while the detail drawer keeps `briefText` intact.
 */
function briefExcerptOf(text, limit = 240) {
  if (typeof text !== 'string') return null
  const flattened = text.replace(/\s+/g, ' ').trim()
  if (!flattened) return null
  const characters = Array.from(flattened)
  return characters.length <= limit ? flattened : characters.slice(0, limit).join('')
}

/**
 * Structured view of the same brief. The doc module is the only parser: the
 * query layer never re-interprets headings itself, it only records the hash and
 * which format the body is in.
 */
function docViewOf(text) {
  if (typeof text !== 'string' || text === '') return null
  return parseDoc(text)
}

function docMetaOf(docView, text, fallbackRevision = null) {
  if (!docView) return { source: null, docHash: null, revision: null, confirmedAt: null }
  const doc = docView.doc ?? null
  return {
    source: docView.legacy === true ? 'legacy' : 'canonical',
    docHash: typeof text === 'string' && text !== '' ? docHashOf(text) : null,
    // The document version when the body declares one; legacy bodies fall back
    // to the requirement revision so the UI still has a version to show.
    revision: doc?.revision ?? fallbackRevision ?? null,
    confirmedAt: doc?.meta?.confirmedAt ?? null,
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

/**
 * Version history for many requirement files with one log walk. The list view
 * renders every row, so spawning git twice per row (top-level lookup plus log)
 * dominated payload time on Windows. Results are newest first, with at most
 * `limit` entries per file. The shared bounded walk can truncate older history
 * for quiet files; the on-demand version endpoint uses `versionHistory` and
 * follows renames for the complete per-file window.
 */
export function versionHistories(root, files, limit = 20, readContext = null) {
  const result = new Map()
  const unique = [...new Set((files ?? []).filter(Boolean))]
  if (unique.length === 0) return result
  let top
  try {
    top = readContext?.gitTop ? readContext.gitTop() : git(root, ['rev-parse', '--show-toplevel'])
  } catch {
    return result
  }
  const relToFile = new Map()
  for (const file of unique) {
    relToFile.set(relative(top, resolve(root, file)).replace(/\\/g, '/'), file)
  }
  const paths = [...relToFile.keys()]
  let output
  try {
    output = git(top, [
      'log',
      '--max-count', String(limit * paths.length),
      '--name-only',
      '--format=%x1e%H%x1f%h%x1f%aI%x1f%s',
      '--',
      ...paths,
    ])
  } catch {
    return result
  }
  // Empty success is known-empty history; only an actual failure uses fallback.
  for (const file of unique) result.set(file, [])
  for (const chunk of output.split('\u001e')) {
    const lines = chunk.split('\n').map((line) => line.trim()).filter(Boolean)
    const header = (lines[0] ?? '').split('\u001f')
    if (header.length < 4) continue
    const version = { sha: header[0], short: header[1], date: header[2], subject: header.slice(3).join('\u001f') }
    for (const path of lines.slice(1)) {
      const file = relToFile.get(path)
      if (!file) continue
      const list = result.get(file) ?? []
      if (list.length < limit) list.push(version)
      result.set(file, list)
    }
  }
  return result
}

/**
 * Creation times for many requirement files, in one git walk.
 *
 * Git's first-add commit is the source of record: a fresh clone resets file
 * birthtimes, so filesystem metadata alone would order requirements by
 * checkout time. A requirement that is not committed yet falls back to its
 * filesystem creation time (mtime when the platform reports no birthtime),
 * which is what makes a just-created requirement sort to the top before the
 * next commit happens.
 */
export function creationTimes(root, files, readContext = null) {
  const result = new Map()
  const unique = [...new Set((files ?? []).filter(Boolean))]
  for (const file of unique) result.set(file, { ms: fileCreationMs(root, file), source: 'file' })
  if (unique.length === 0) return result
  let top
  try {
    top = readContext?.gitTop ? readContext.gitTop() : git(root, ['rev-parse', '--show-toplevel'])
  } catch {
    return result
  }
  const relToFile = new Map()
  for (const file of unique) {
    relToFile.set(relative(top, resolve(root, file)).replace(/\\/g, '/'), file)
  }
  let output
  try {
    output = git(top, ['log', '--diff-filter=A', '--name-only', '--format=%x1e%aI', '--', ...relToFile.keys()])
  } catch {
    return result
  }
  for (const chunk of output.split('\u001e')) {
    const lines = chunk.split('\n').map((line) => line.trim()).filter(Boolean)
    const ms = lines[0] ? Date.parse(lines[0]) : Number.NaN
    if (!Number.isFinite(ms)) continue
    for (const path of lines.slice(1)) {
      const file = relToFile.get(path)
      if (!file) continue
      // `git log` walks newest first, so the last assignment is the first add.
      result.set(file, { ms, source: 'git' })
    }
  }
  return result
}

function fileCreationMs(root, file) {
  try {
    const stat = statSync(isAbsolute(file) ? file : join(root, file))
    if (Number.isFinite(stat.birthtimeMs) && stat.birthtimeMs > 0) return stat.birthtimeMs
    return stat.mtimeMs
  } catch {
    return null
  }
}

export function createdAtOf(entry) {
  if (!entry || !Number.isFinite(entry.ms)) return null
  return new Date(entry.ms).toISOString()
}

/**
 * Newest requirement first: creation time descending, then id descending for
 * records created in the same instant, then the occurrence key so duplicate
 * UIDs keep a stable row order across reloads.
 */
export function sortRequirements(items = []) {
  const time = (item) => {
    const value = Date.parse(item?.createdAt ?? '')
    return Number.isFinite(value) ? value : 0
  }
  return [...items].sort((left, right) => {
    const byTime = time(right) - time(left)
    if (byTime !== 0) return byTime
    const byId = String(right?.id ?? '').localeCompare(String(left?.id ?? ''))
    if (byId !== 0) return byId
    return String(left?.occurrenceKey ?? left?.id ?? '').localeCompare(String(right?.occurrenceKey ?? right?.id ?? ''))
  })
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
    const { top, path } = versionPath(root, asset.source.path, sha)
    const content = git(top, ['show', `${sha}:${path}`])
    return { schema: 'alm.version/v1', asset: asset.id, sha, path, content }
  } catch (error) {
    throw invalid(`cannot read ${sha}: ${error?.message ?? String(error)}`, 400, 'version-unavailable')
  }
}

/** Read a stable, bounded page of one requirement file's Git history. */
export function versionHistoryPage({ root, assetId, head = null, offset = 0 }) {
  const invalid = (message, status, code) => Object.assign(new Error(message), { status, code })
  if (typeof assetId !== 'string' || !assetId) throw invalid('asset is required', 400, 'asset-required')
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) throw invalid('invalid offset', 400, 'invalid-offset')
  if ((head !== null && !/^[0-9a-f]{40,64}$/.test(head)) || (offset > 0 && head === null)) throw invalid('invalid history head', 400, 'invalid-head')
  const index = indexReport(root)
  if (index.ok === false) throw invalid(index.error ?? 'index failed', 500, 'index-failed')
  const asset = index.assets.find(entry => entry.id === assetId && entry.type === 'requirement')
  if (!asset) throw invalid('requirement not found', 404, 'asset-not-found')
  try {
    const top = git(root, ['rev-parse', '--show-toplevel'])
    const path = relative(top, resolve(root, asset.source.path)).replace(/\\/g, '/')
    if (path === '..' || path.startsWith('../') || isAbsolute(path)) throw invalid('invalid asset path', 400, 'invalid-path')
    const pinned = head ?? git(top, ['rev-parse', '--verify', 'HEAD^{commit}'])
    const output = git(top, ['log', '--follow', '--max-count=21', `--skip=${offset}`, '--format=%H%x1f%h%x1f%aI%x1f%s', pinned, '--', path])
    const rows = output.split('\n').filter(Boolean).map(line => {
      const [sha, short, date, ...subject] = line.split('\x1f')
      return { sha, short, date, subject: subject.join('\x1f') }
    })
    return { schema: 'alm.version.history/v1', asset: asset.id, head: pinned, versions: rows.slice(0, 20), next: rows.length > 20 ? offset + 20 : null }
  } catch (error) {
    if (error?.code === 'invalid-path') throw error
    throw invalid('无法读取版本历史', 503, 'history-unavailable')
  }
}

export function nextActionLabel(action) {
  return NEXT[action] ?? '查看'
}

// A run that has stopped making progress (parked on a human, paused, failed,
// cancelled, finished, or with a lost heartbeat) must not read as 推进中.
const RUN_STATUSES_WITHOUT_PROGRESS = ['waiting-input', 'paused', 'failed', 'cancelled', 'done']

export function progressCapableRun(run) {
  if (!run || run.exists !== true) return null
  if (run.active === false || run.stale === true) return null
  if (RUN_STATUSES_WITHOUT_PROGRESS.includes(run.status)) return null
  return run
}

export function runInterruptionReason(run) {
  if (run?.failure?.message) return run.failure.message
  if (run?.status === 'waiting-input') {
    // Fallback for a host still running the previous core: runView then has no
    // awaitingAnswer, but it already exposed the decision request path.
    const awaiting = run.awaitingAnswer === true || (run.awaitingAnswer === undefined && Boolean(run.decision))
    return awaiting ? '等待回答决策请求后继续' : '本轮推进已交接，等待人类决定下一步'
  }
  if (run?.status === 'paused') return '本轮推进已暂停，等待恢复'
  if (run?.status === 'failed') return '本轮推进失败，可从检查点恢复'
  if (run?.status === 'cancelled') return '本轮推进已取消'
  if (run?.status === 'done') return '本轮推进已结束，等待下一步'
  return '执行器心跳丢失，本轮推进已中断'
}

// A host that keeps the previous alm-core in its ESM cache still projects a
// parked run as 推进中. Correct it at the plugin boundary so the list never
// claims progress a run cannot make; once the host reloads the new core this
// is a no-op (the canonical rule already returns 待推进).
export function applyDeliveryShim(item) {
  const delivery = item?.delivery
  if (!delivery || delivery.key !== 'in-progress') return delivery
  const run = item.run
  if (progressCapableRun(run)) return delivery
  return {
    ...delivery,
    key: 'pending',
    label: DELIVERY_LABELS.pending,
    source: runInterruptionSource(run),
    runId: run?.id ?? delivery.runId ?? null,
    runStatus: run?.status ?? null,
    reason: runInterruptionReason(run),
  }
}

export function runInterruptionSource(run) {
  if (run?.status === 'failed') return 'run-failed'
  if (run?.status === 'cancelled') return 'run-cancelled'
  if (run?.status === 'done') return 'run-done'
  if (run?.status === 'waiting-input' || run?.status === 'paused') return 'run-idle'
  if (run?.stale === true) return 'run-stale'
  return 'run-inactive'
}

/**
 * One deterministic next action per requirement, derived from the evidence
 * decision (not from status alone). The UI shows the label; the action itself
 * still runs through the normal skill and gate path, never through this page.
 */
export function nextActionFor(item, gaps = []) {
  // Delivery state answers "what happens now" before any evidence detail does.
  const deliveryKey = item?.delivery?.key ?? null
  if (deliveryKey === 'closed') return 'done'
  if (deliveryKey === 'accepted') {
    if (item.delivery.source === 'release') return 'done'
    const releaseStatus = item?.release?.status ?? null
    if (releaseStatus === 'released') return 'done'
    if (releaseStatus === 'authorized' || releaseStatus === 'releasing') return 'execute-release'
    return 'release'
  }
  if (deliveryKey === 'awaiting-acceptance') return 'signoff'
  // A run whose heartbeat stopped is not "in progress" in any honest sense:
  // the panel offers resuming it instead of waiting for a turn that is gone.
  if (deliveryKey === 'in-progress' && item?.run?.exists) {
    if (item.run.stale === true) return 'resume-run'
    if (item.run.awaitingAnswer === true) return 'answer-run'
    // The turn ended without writing a decision request: nothing to answer, but
    // the round is not finished either — continue it from the last checkpoint.
    if (item.run.idleHandback === true) return 'resume-run'
    return 'watch-run'
  }
  // A run parked for a human decision (or a dead one) keeps its honest action
  // even though the delivery state itself is 待推进.
  if (deliveryKey === 'pending' && item?.run?.exists) {
    // A round that died (unfinished, or the host restarted) is continued, not
    // re-evaluated: the evidence action would only re-run acceptance on code
    // that was never finished.
    if (item.run.status === 'failed' || item.run.status === 'cancelled') return 'resume-run'
    if (item.run.stale === true) return 'resume-run'
    if (item.run.awaitingAnswer === true) return 'answer-run'
    // Handed back with nothing to answer: the round continues from its checkpoint.
    if (item.run.idleHandback === true || item.run.status === 'paused') return 'resume-run'
  }
  // A defect is a first-class pending decision only on the defect requirement
  // itself; the source requirement keeps its own delivery action.
  const defectStatus =
    item?.id && item?.defect?.defect?.requirement === item.id ? item.defect.status ?? null : null
  if (defectStatus === 'awaiting-confirmation' || defectStatus === 'failed') return 'confirm-defect'
  if (defectStatus === 'deferred') return 'resume-defect'
  if (defectStatus === 'ignored') return 'done'
  // A fixed iteration still needs a human-run acceptance before the defect can
  // be closed, so verification is the next real action for this requirement.
  if (defectStatus === 'verifying') return 'run-acceptance'
  const state = item?.decision?.state ?? null
  const topGap = item?.decision?.topGap ?? null
  // Candidate gaps are about the delivery object itself; they win over the
  // generic "run acceptance" advice because no evidence can be accepted without
  // a candidate that still matches the delivered content.
  const topCode = String(topGap?.code ?? '').toLowerCase()
  if (topCode === 'candidate-missing' || topCode === 'candidate-incomplete' || topCode === 'candidate-stale') return 'create-candidate'
  if (topCode === 'requirement-changed' || topCode === 'head-changed' || topCode === 'worktree-changed') return 'create-candidate'
  if (state === 'blocked') return 'fix-blockers'
  if (state === 'needs-clarification') return 'fix-anomaly'
  if (state === 'stale') return 'rerun-evidence'
  if (state === 'failed') return 'run-acceptance'
  if (state === 'ready-for-human') return 'signoff'
  if (state === 'verified') return 'done'
  // `unchecked` (or a decision that is not available yet) goes to executable
  // acceptance evidence. Review and AI suggestions are optional advisory tools,
  // never a second mandatory gate after intent clarification.
  const gap = item?.decision?.topGap ?? gaps[0] ?? null
  const code = String(gap?.code ?? '').toLowerCase()
  if (/acceptance|command|evidence/.test(code)) return 'run-acceptance'
  return 'run-acceptance'
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
export function collectAnomalies({ assets = [], check = null, visibleFiles = null } = {}) {
  const index = buildIndex(assets)
  const visible = visibleFiles == null ? null : new Set(visibleFiles.map(normaliseFile))
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
    // A dangling link is shown only when its source record is one the project
    // displays; fixture findings would otherwise be uncountable from the list.
    if (visible && finding.file && !visible.has(normaliseFile(finding.file))) continue
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

/**
 * Requirements page payload. Gaps come from the real gate checks (COV-001 /
 * COV-002), never from a static mock. Evidence decision and data anomalies are
 * separate fields so an anomaly never looks like a pass/fail verdict.
 */
export function requirements(root, { requirementId = null } = {}) {
  const loaded = loadRepo(root)
  const index = indexReport(root, { loaded })
  if (index.ok === false) return index

  const check = checkReport(root, {}, { loaded })
  // Request-local only: no TTL can hide edits between separate queries or writes.
  let snapshot
  let top
  const readContext = {
    worktreeSnapshot: () => (snapshot ??= worktreeSnapshot(root)),
    gitTop: () => (top ??= git(root, ['rev-parse', '--show-toplevel'])),
  }
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
  let headSha = null
  try {
    headSha = gitHead(root)
  } catch {
    headSha = null
  }
  // Requirements belong to the project's declared requirement root. Scanning
  // the whole repository would surface test fixtures (`fixtures/negative/*`)
  // as editable requirements, so a record deleted through the plugin would
  // reappear from a fixture file the user never meant to manage.
  const { requirementRoot, assets: requirementAssets } = visibleRequirementAssets({ root, assets, project })
  // Anomalies use the same scope as the list: a banner counting duplicates
  // from fixture files next to zero visible rows is not actionable.
  const anomalies = collectProjectAnomalies({ root, assets, check, project }).anomalies
  const requirementFiles = requirementAssets.map((asset) => asset.source.path)
  const versionHistoriesByFile = versionHistories(root, requirementFiles, 20, readContext)
  const createdByFile = creationTimes(root, requirementFiles, readContext)
  let actualBranch = null
  try { actualBranch = execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null } catch {}
  let remoteUrl = null
  try { remoteUrl = git(root, ['remote', 'get-url', 'origin']) || null } catch {}
  const items = (requirementId === null ? requirementAssets : requirementAssets.filter(asset => asset.id === requirementId))
    .map((asset) => {
      const verifiedBy = asset.links.filter((link) => link.type === 'verified_by').map((link) => link.target)
      const extra = asset.extra ?? {}
      const files = attachmentFiles(root, asset.id)
      const brief = briefText(root, extra.brief)
      const docView = docViewOf(brief)
      const item = {
        id: asset.id,
        businessId: extra.businessId ?? null,
        occurrenceKey: occurrenceKeyFor(asset),
        title: asset.title,
        // Legacy, read-only: kept for compatibility, never drives the lifecycle.
        status: asset.status,
        statusLabel: asset.status ? (STATUS_LABELS[asset.status] ?? asset.status) : null,
        owner: asset.owner,
        project: project?.id ?? null,
        projectName: project?.name ?? null,
        priority: extra.priority ?? null,
        category: extra.category ?? null,
        revision: extra.revision ?? 1,
        brief: extra.brief ?? null,
        briefText: brief,
        briefBytes: briefBytesOf(brief),
        briefExcerpt: briefExcerptOf(brief),
        // Structured description: parsed once here so detail, list and execution
        // all consume the same document instead of guessing from headings.
        docView,
        docMeta: docMetaOf(docView, brief, extra.revision ?? 1),
        sources: Array.isArray(extra.sources) ? extra.sources : [],
        attachments: files.length,
        attachmentFiles: files,
        investigationEvidence: (() => {
          try {
            const file = join(root, 'requirements', 'attachments', asset.id, 'investigation-evidence.json')
            if (statSync(file).size > 1024 * 1024) return []
            const records = JSON.parse(readFileSync(file, 'utf8'))
            return (Array.isArray(records) ? records : []).slice(0, 20).flatMap(record => (Array.isArray(record.findings) ? record.findings : []).flatMap(finding => (Array.isArray(finding.refs) ? finding.refs : []).filter(ref => typeof ref?.path === 'string').map(ref => ({ investigationId: record.investigationId ?? null, path: ref.path.slice(0, 500), line: Number.isSafeInteger(ref.line) ? ref.line : null, endLine: Number.isSafeInteger(ref.endLine) ? ref.endLine : null }))))
          } catch { return [] }
        })(),
        verifiedBy,
        file: asset.source.path,
        root: index.root,
        line: asset.source.line,
        // The list's primary order: real creation time, not file order.
        createdAt: createdAtOf(createdByFile.get(asset.source.path)),
        updatedAt: (() => { try { return new Date(Math.max(statSync(join(root, asset.source.path)).mtimeMs, extra.brief ? statSync(join(root, extra.brief)).mtimeMs : 0)).toISOString() } catch { return null } })(),
        sourceSession: (() => { try { const value = JSON.parse(readFileSync(join(root, 'requirements', 'attachments', asset.id, 'source-session.json'), 'utf8')).sourceSession; return typeof value === 'string' ? value.slice(0, 200) : null } catch { return null } })(),
        links: asset.links.map((link) => ({ type: link.type, target: link.target, line: link.line ?? null })),
        github: githubFor({ mapping, project, asset }),
      }
      item.anomalies = anomaliesForAsset(anomalies, asset)
      item.acceptance = acceptanceSummary(root, asset.id, headSha, { asset, assets, readContext })
      // Human acceptance needs a candidate: it is the object a human accepts.
      // Compute the shared worktree snapshot once per request, then reuse it in
      // the signoff projection instead of rescanning git.
      item.candidate = candidateView({ root, asset, assets, acceptance: item.acceptance, readContext })
      item.humanAcceptance = signoffView({
        root,
        asset,
        acceptance: item.acceptance,
        candidate: item.candidate,
        anomalies: item.anomalies,
      })
      item.closure = readClosure(root, asset.id)
      item.closed = isClosed({ root, asset, closure: item.closure })
      item.decision = decideEvidence({
        asset,
        acceptance: item.acceptance,
        candidate: item.candidate,
        humanAcceptance: item.humanAcceptance,
        closed: item.closed,
        anomalies,
      })
      let discovered = null
      item.run = runView({ root, requirementId: item.id, decisionFor: (repo, run) => (discovered = resolveRunDecision(repo, run)) })
      if (item.run.exists) {
        const blueprint = readBlueprint(root, item.run.id)
        if (blueprint) {
          item.run.blueprint = {
            exists: true,
            path: `.alm/runs/${item.run.id}-blueprint.json`,
            allowedPathCount: blueprint.allowedPaths?.length ?? 0,
            layers: blueprint.layers ?? [],
            approvedExpansions: blueprint.approvedExpansions?.length ?? 0,
          }
          try {
            const inspection = inspectBlueprintScope({ blueprint, snapshot: readContext.worktreeSnapshot(root) })
            if (inspection.enforced === true && !inspection.ok) item.run.scopeDiagnostic = {
              changedCount: inspection.changed?.length ?? 0,
              allowedCount: blueprint.allowedPaths?.length ?? 0,
              outOfScope: (inspection.outOfScope ?? []).slice(0, 12),
              risky: (inspection.risky ?? []).slice(0, 12),
              reason: inspection.reason ?? null,
            }
          } catch {}
        }
        item.run.autoAdvance = readRun(root, item.run.id)?.checkpoint?.autoAdvance ?? null
        try {
          const failure = listFailures(root, { requirement: item.id, limit: 1 }).at(-1)
          if (failure) item.run.failureDiagnostic = failureDiagnosis(failure)
        } catch {}
        // Identity and presentation use the same safely discovered bytes.
        if (item.run.awaitingAnswer) {
          item.run.decisionIdentity = discovered.identity ? { path: discovered.path, contentHash: discovered.identity.sha256 } : null
          item.run.decisionPresentation = presentDecisionRequest(discovered.text, { sourceFile: discovered.path, runId: item.run.id })
        }
      }
      item.rejectionReview = item.run.exists && item.run.autoAdvance?.status === 'candidate-ready'
        ? rejectionReview({ root, run: readRun(root, item.run.id), asset, assets, snapshot: readContext.worktreeSnapshot(root) })
        : { allowed: false, binding: null }
      item.release = releaseViewFor({ root, requirementId: item.id })
      item.architectureLedger = readArchitectureLedger({
        root,
        requirementId: item.id,
        path: item.candidate.architecture?.path ?? item.release.sourceControl?.architectureDocPath ?? null,
      })
      item.development = { branch: actualBranch, headSha, remoteUrl, dedicated: /^(feature|feat|fix|codex|alm)\//.test(actualBranch ?? ''), repository: projectInfo?.repo ?? null, integrationBranch: project?.github?.workflow?.integrationBranch ?? 'develop', releaseBranch: project?.defaultBranch ?? 'main' }
      // The canonical rule lives in alm-core's deliveryStateFor: only a round
      // that can actually make progress is 推进中; one parked on a human,
      // paused, failed, cancelled, finished or heartbeat-lost rolls back to
      // 待推进 with an interruption reason.
      item.delivery = deliveryStateFor({
        root,
        asset,
        decision: item.decision,
        candidate: item.candidate,
        run: item.run?.exists ? item.run : null,
        closure: item.closure,
        release: item.release,
      })
      item.delivery = applyDeliveryShim(item)
      item.defect = defectView({ root, requirementId: item.id })
      item.nextAction = nextActionFor(item, gaps)
      item.nextActionLabel = nextActionLabel(item.nextAction)
      const versions = versionHistoriesByFile.has(item.file)
        ? versionHistoriesByFile.get(item.file)
        : versionHistoriesByFile.size === 0
          ? versionHistory(root, item.file)
          : []
      item.versions = versions
      item.specConvergences = listSpecConvergences(root, item.id)
      item.revision = Math.max(Number(item.revision) || 1, ...item.specConvergences.map(event => Number(event.revision) || 1))
      const originalConfirmedAt = item.specConvergences.find(event => event.beforeRevision === 1 && Number.isFinite(Date.parse(event.initialConfirmedAt)))?.initialConfirmedAt
      if (originalConfirmedAt) item.createdAt = originalConfirmedAt
      else if (item.docMeta?.confirmedAt && Number.isFinite(Date.parse(item.docMeta.confirmedAt))) item.createdAt = item.docMeta.confirmedAt
      item.pendingPatch = pendingSpecDeltas(root, item.id, requirementSpecContext(item.id))[0] ?? (item.run?.id ? pendingSpecDeltas(root, item.id, item.run.id)[0] : null) ?? null
      item.iterationRetry = readIterationRetry(root, item.id)
      item.trace = traceFor({ asset, graph, byId })
      item.aiReview = aiReviewSummary(root, asset.id)
      // Rule-role review is deliberately out of band in this build: the review
      // engine no longer produces a projection here. The detail view derives the
      // review summary from AI review evidence and decision gaps instead of
      // pretending a rule report exists.
      // Read-only projection for the detail drawer. Relations are recomputed
      // from the same asset list the list view already has.
      item.detailView = deriveDetailView(item, {
        allItems: requirementAssets.map((entry) => ({ id: entry.id, links: entry.links })),
      })
      item.currentMatter = item.detailView.currentMatter
      item.requiresHuman = Boolean(item.pendingPatch) || item.currentMatter.requiresHuman
      item.mine = item.requiresHuman
      return item
    })

  // Newest first: the list is a feed of work, not a file listing.
  const sortedItems = sortRequirements(items)

  return {
    schema: 'alm.requirements/v1',
    scope: 'project',
    root: index.root,
    project: project?.id ?? null,
    projectName: project?.name ?? null,
    projectInfo,
    result: check.result,
    requirements: sortedItems,
    gaps,
    anomalies,
    anomalySummary: summarizeAnomalies(anomalies),
    summary: { requirements: sortedItems.length, gaps: gaps.length, anomalies: anomalies.length, mine: sortedItems.filter((item) => item.mine).length },
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

  const items = sortRequirements(
    loaded.flatMap((entry) =>
      (entry.payload?.requirements ?? []).map((item) => ({
        ...item,
        project: entry.project,
        projectName: entry.projectName,
      })),
    ),
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
      mine: items.filter((item) => item.mine).length,
      gaps: gaps.length,
      anomalies: anomalies.length,
      projects: loaded.length,
      failed: failed.length,
    },
  }
}
