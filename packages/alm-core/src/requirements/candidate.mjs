import { worktreeSnapshot } from './worktree-snapshot.mjs'
export { worktreeSnapshot } from './worktree-snapshot.mjs'
import { acceptanceBinding } from '../acceptance/acceptance.mjs'
import { loadRepo } from '../parse/load.mjs'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve, relative, isAbsolute } from 'node:path'
import { requirementContentHash, sha256 } from '../model/content-hash.mjs'
import { writeArchitectureLedger } from './arch-ledger.mjs'
import { syncDevelopmentBranch } from './dev-branch-sync.mjs'

/**
 * Delivery candidate: the exact content a human is asked to accept.
 *
 * HEAD alone is not enough — the product is used on a dirty worktree, and an
 * uncommitted edit is still delivered content. A candidate therefore binds the
 * requirement snapshot (requirementHash) to a worktree snapshot (headSha +
 * hashes of the changed/untracked files). 已验收 must bind a candidate, and a
 * candidate stops being usable as soon as any of its content changes.
 */
export const CANDIDATE_SCHEMA = 'alm.candidate/v2'
export const CANDIDATE_DIR = '.alm/candidates'
function candidateFile(root, requirementId) {
  return join(resolve(root), CANDIDATE_DIR, requirementId)
}

function nextCandidateId(root, requirementId) {
  const dir = candidateFile(root, requirementId)
  if (!existsSync(dir)) return `CAND-${requirementId}-001`
  const ids = readdirSync(dir)
    .filter((name) => name.endsWith('.json') && name.startsWith('CAND-'))
    .map((name) => Number(name.match(/-(\d+)\.json$/)?.[1] ?? 0))
    .filter((value) => Number.isFinite(value))
  const next = (ids.length > 0 ? Math.max(...ids) : 0) + 1
  return `CAND-${requirementId}-${String(next).padStart(3, '0')}`
}

/**
 * Create (and persist) a candidate for the current delivered content. `acceptance`
 * is the acceptance summary the candidate was verified against; it is recorded as
 * a pointer (file + hash) so a later run cannot silently rewrite what was tested.
 */
export function createCandidate({ root, asset, acceptance = null, actor = 'ai:adopted', source = 'adoption', development = null }) {
  const repo = resolve(root)
  const requirementHash = requirementContentHash({ root: repo, asset })
  const evidenceFile = typeof acceptance?.latest?.file === 'string' ? resolve(repo, acceptance.latest.file) : null
  const evidenceRelative = evidenceFile ? relative(repo, evidenceFile) : null
  const evidenceInternal = evidenceFile && evidenceRelative && !isAbsolute(evidenceRelative) && evidenceRelative !== '..' && !evidenceRelative.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
  let actual = null
  try { if (evidenceInternal) actual = JSON.parse(readFileSync(evidenceFile, 'utf8')) } catch {}
  if (actual?.failure?.code === 'tampered_test') {
    throw Object.assign(new Error('验收期间测试断言被修改，不能生成交付候选'), { code: 'tampered-test', status: 409 })
  }
  const acceptanceRecord = actual
    ? {
        file: acceptance.latest.file ?? null,
        hash: evidenceInternal && existsSync(evidenceFile) ? sha256(readFileSync(evidenceFile, 'utf8')) : null,
        result: actual.result ?? null,
        finishedAt: actual.finishedAt ?? null,
        requirementHash: actual.requirementHash ?? null,
        testRevision: actual.testRevision ?? null,
        headSha: actual.headSha ?? null,
        schema: actual.schema ?? null,
        worktreeHash: actual.worktree?.after?.treeHash ?? null,
        configHash: actual.configHash ?? null,
      }
    : null
  const dir = candidateFile(repo, asset.id)
  mkdirSync(dir, { recursive: true })
  const lock = join(dir, '.create-lock')
  try {
    mkdirSync(lock)
  } catch (error) {
    if (error.code === 'EEXIST') throw Object.assign(new Error('交付候选正在准备，请重新读取后重试'), { code: 'candidate-busy', status: 409 })
    throw error
  }
  try {
    const id = nextCandidateId(repo, asset.id)
    let architecture = null
    let devSync = null
    if (development?.enabled === true) {
      architecture = writeArchitectureLedger({
        root: repo,
        asset,
        requirement: development.requirement ?? null,
        acceptance,
        // Record only files that really changed. Acceptance command paths used
        // to be archived as "module changes" even when they were untouched.
        implementationPaths: development.scope
          ? (development.scope.owned.length ? development.scope.owned : null)
          : (development.paths ?? []),
      })
      devSync = syncDevelopmentBranch({
        root: repo,
        requirementId: asset.id,
        revision: asset.extra?.revision ?? development.requirement?.revision ?? 1,
        candidateId: id,
        title: development.requirement?.title ?? asset.title,
        branch: development.branch ?? 'develop',
        remote: development.remote ?? 'origin',
        scope: development.scope ?? null,
        push: development.push ?? true,
        paths: [...(development.paths ?? []), architecture.path, architecture.indexPath],
      })
    }
    const snapshot = worktreeSnapshot(repo)
    // Metadata (actor/source/time) is not delivered content. Repeated requests
    // bind the same immutable object; changed evidence or revision does not.
    const existing = latestCandidate(repo, asset.id)
    if (existing && existing.requirementHash === requirementHash && existing.revision === (asset.extra?.revision ?? 1) &&
      existing.headSha === snapshot.headSha && existing.treeHash === snapshot.treeHash &&
      JSON.stringify(existing.acceptance) === JSON.stringify(acceptanceRecord)) return existing
    const candidate = {
      schema: CANDIDATE_SCHEMA,
      id,
      requirementId: asset.id,
      revision: asset.extra?.revision ?? 1,
      createdAt: new Date().toISOString(),
      createdBy: actor,
      source,
      requirementHash,
      headSha: snapshot.headSha,
      treeHash: snapshot.treeHash,
      complete: snapshot.complete,
      fileCount: snapshot.files.length,
      files: snapshot.files,
      acceptance: acceptanceRecord,
      architecture: architecture ? {
        ...architecture,
        synced: devSync?.pushedToRemoteDev === true,
        syncedCommitSha: devSync?.devCommitSha ?? null,
      } : null,
      development: devSync,
      architectureChanged: architecture?.changed === true,
      devCommitSha: devSync?.devCommitSha ?? null,
      devBranch: devSync?.devBranch ?? null,
      pushedToRemoteDev: devSync?.pushedToRemoteDev ?? false,
      requiresReverification: devSync?.requiresReverification === true,
    }
    writeFileSync(join(dir, `${id}.json`), `${JSON.stringify(candidate, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    return candidate
  } finally {
    rmSync(lock, { recursive: true })
  }
}

export function readCandidate(root, requirementId, candidateId) {
  const file = join(candidateFile(root, requirementId), `${candidateId}.json`)
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

export function listCandidates(root, requirementId) {
  const dir = candidateFile(root, requirementId)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json') && name.startsWith('CAND-'))
    .map((name) => readCandidate(root, requirementId, name.replace(/\.json$/, '')))
    .filter(Boolean)
    .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)))
}

export function latestCandidate(root, requirementId) {
  const all = listCandidates(root, requirementId)
  return all.length > 0 ? all[all.length - 1] : null
}

/**
 * Is the candidate still the content a human can accept? Checked against the
 * live worktree, so an edit made after the run invalidates the candidate instead
 * of letting a stale "pass" stand.
 */
export function candidateStatus({ root, candidate, asset, assets = null, readContext = null }) {
  const repo = resolve(root)
  const reasons = []
  if (!candidate) {
    return { exists: false, current: false, reasons: [{ code: 'candidate-missing', message: '尚未生成交付候选' }] }
  }
  if (candidate.complete === false) {
    reasons.push({ code: 'candidate-incomplete', message: '交付候选文件过多，快照不完整' })
  }
  const requirementHash = requirementContentHash({ root: repo, asset })
  if (candidate.requirementHash !== requirementHash) {
    reasons.push({ code: 'requirement-changed', message: '需求内容已变化，候选需要重新生成' })
  }
  if (candidate.revision !== undefined && candidate.revision !== (asset.extra?.revision ?? 1)) {
    reasons.push({ code: 'revision-changed', message: '需求版本已变化，候选需要重新生成' })
  }
  // A caller may share this lazy reader only for one synchronous read projection.
  // Mutating commands omit it and always validate a fresh worktree snapshot.
  const snapshot = readContext?.worktreeSnapshot ? readContext.worktreeSnapshot(repo) : worktreeSnapshot(repo)
  if (candidate.headSha && snapshot.headSha !== candidate.headSha) {
    reasons.push({ code: 'head-changed', message: 'HEAD 已变化，候选需要重新验证' })
  }
  let verified = false
  try {
    const record = candidate.acceptance
    const file = record?.file ? resolve(repo, record.file) : null
    const scoped = file ? relative(repo, file) : '..'
    if (candidate.schema === CANDIDATE_SCHEMA && file && scoped && !isAbsolute(scoped) && !scoped.startsWith('..')) {
      const bytes = readFileSync(file, 'utf8'), evidence = JSON.parse(bytes)
      verified = record.hash === sha256(bytes) && evidence.result === 'pass' &&
        evidence.requirement === asset.id && evidence.requirementHash === candidate.requirementHash &&
        evidence.worktree?.after?.treeHash === candidate.treeHash && record.worktreeHash === candidate.treeHash &&
        record.testRevision === evidence.testRevision && record.configHash === evidence.configHash &&
        acceptanceBinding({ root: repo, evidence, asset, assets: assets ?? loadRepo(repo).assets, snapshot }).current
    }
  } catch {}
  if (!verified) reasons.push({ code: 'candidate-unverified', message: '候选未绑定与交付内容一致的有效验收证据；历史与草稿保留' })
  const current = new Map(snapshot.files.map((entry) => [entry.path, entry.hash]))
  const changed = []
  for (const entry of candidate.files ?? []) {
    const now = current.get(entry.path)
    if (now !== entry.hash) changed.push(entry.path)
  }
  const previousPaths = new Set((candidate.files ?? []).map((entry) => entry.path))
  for (const entry of snapshot.files) {
    if (!previousPaths.has(entry.path)) changed.push(entry.path)
  }
  if (snapshot.complete === false && candidate.complete !== false) {
    reasons.push({ code: 'worktree-incomplete', message: '当前工作区快照不完整，不能确认候选仍有效' })
  }
  if (changed.length > 0) {
    reasons.push({
      code: 'worktree-changed',
      message: `交付内容已变化：${changed.slice(0, 3).join('、')}${changed.length > 3 ? ` 等 ${changed.length} 个文件` : ''}`,
    })
  }
  return { exists: true, current: reasons.length === 0, reasons }
}

/** Compact candidate view for decisions and the UI (never the full file list). */
export function candidateView({ root, asset, assets = null, acceptance = null, readContext = null }) {
  const candidate = latestCandidate(root, asset.id)
  const status = candidateStatus({ root, candidate, asset, assets, readContext })
  return {
    exists: status.exists,
    id: candidate?.id ?? null,
    current: status.current,
    reasons: status.reasons,
    treeHash: candidate?.treeHash ?? null,
    headSha: candidate?.headSha ?? null,
    createdAt: candidate?.createdAt ?? null,
    source: candidate?.source ?? null,
    fileCount: candidate?.fileCount ?? null,
    requirementHash: candidate?.requirementHash ?? null,
    acceptance: candidate?.acceptance ?? null,
    architecture: candidate?.architecture ?? null,
    architectureChanged: candidate?.architectureChanged === true,
    development: candidate?.development ?? null,
    requiresReverification: candidate?.requiresReverification === true,
    devCommitSha: candidate?.devCommitSha ?? null,
    devBranch: candidate?.devBranch ?? null,
    pushedToRemoteDev: candidate?.pushedToRemoteDev ?? false,
  }
}
