import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { sha256 } from '../model/content-hash.mjs'
import { requireTrustedHumanSubject } from './identity.mjs'
import { readCandidate } from './candidate.mjs'
import { readProject } from '../project/project.mjs'
import { parseDoc } from './doc.mjs'

/**
 * A release is its own object, not the last state of a requirement.
 *
 * One release can carry several accepted deliveries; one requirement can be
 * released to several targets over time. The human authorizes a release
 * candidate (the exact accepted candidate hashes); the executor reports what
 * actually happened. Accepting a delivery never releases it, and authorizing a
 * release never changes the acceptance facts.
 */
export const RELEASE_SCHEMA = 'alm.release/v1'
export const RELEASE_DIR = '.alm/releases'
export const REQUIREMENT_RELEASE_SCHEMA = 'alm.requirement-release/v1'
export const RELEASE_STATES = ['draft', 'authorized', 'releasing', 'released', 'failed', 'cancelled']
export const RELEASE_LABELS = {
  draft: '待发布决定',
  authorized: '已授权待执行',
  releasing: '发布中',
  released: '已发布',
  failed: '发布失败',
  cancelled: '已取消',
}

function git(root, args, { allowFailure = false } = {}) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch (error) {
    if (allowFailure) return null
    throw Object.assign(new Error(error.stderr?.trim() || error.message), { code: 'git-command-failed' })
  }
}

function gitClean(root) {
  const localRuntime = /^(?:\.alm\/|artifacts\/|validation\/|tmp\/|\.tmp\/)/
  return git(root, ['status', '--porcelain', '--untracked-files=all'])
    .split(/\r?\n/)
    .filter(Boolean)
    .every((line) => localRuntime.test(line.slice(3).replaceAll('\\', '/')))
}

function gitIntegrationFailure(base, reason) {
  return { ...base, pushedToMain: false, reason }
}

/**
 * Merge an already-pushed delivery branch into main without pretending that a
 * local archive is a remote publication. This operation intentionally refuses
 * a dirty worktree: branch switching around user changes is not recoverable.
 */
export function mergeDevelopmentToMain({ root, requirementId, revision = null, devBranch = 'develop', mainBranch = 'main', remote = 'origin' } = {}) {
  const repo = resolve(root)
  const base = {
    devBranch,
    devCommitSha: null,
    mainBranch,
    mainMergeCommitSha: null,
    remoteUrl: null,
    pushedToRemoteDev: false,
    pushedToMain: false,
    pushedToMainAt: null,
    architectureDocPath: `requirements/architecture/${requirementId}-design.md`,
    reason: null,
  }
  if (!git(repo, ['rev-parse', '--is-inside-work-tree'], { allowFailure: true })) return gitIntegrationFailure(base, '当前工作区不是 Git 仓库')
  if (!gitClean(repo)) return gitIntegrationFailure(base, '工作区仍有未提交改动，不能安全切换分支合并')
  const current = git(repo, ['branch', '--show-current'], { allowFailure: true })
  if (current !== devBranch) return gitIntegrationFailure(base, `当前分支为 ${current || 'detached HEAD'}，需在 ${devBranch} 执行发布合并`)
  const remoteUrl = git(repo, ['remote', 'get-url', remote], { allowFailure: true })
  if (!remoteUrl) return gitIntegrationFailure(base, `未配置远程 ${remote}`)
  base.remoteUrl = remoteUrl
  try {
    git(repo, ['fetch', remote, devBranch, mainBranch])
    const devRemote = `refs/remotes/${remote}/${devBranch}`
    if (!git(repo, ['rev-parse', '--verify', devRemote], { allowFailure: true })) return gitIntegrationFailure(base, `远程缺少开发分支 ${remote}/${devBranch}`)
    const [aheadText = '0', behindText = '0'] = git(repo, ['rev-list', '--left-right', '--count', `${devBranch}...${remote}/${devBranch}`]).split(/\s+/)
    const ahead = Number(aheadText)
    const behind = Number(behindText)
    if (behind > 0) git(repo, ['pull', '--rebase', remote, devBranch])
    if (ahead > 0 || behind > 0) git(repo, ['push', remote, devBranch])
    const devCommitSha = git(repo, ['rev-parse', devBranch])
    if (git(repo, ['rev-parse', `${remote}/${devBranch}`]) !== devCommitSha) return gitIntegrationFailure({ ...base, devCommitSha }, `开发分支 ${devBranch} 尚未同步到 ${remote}`)

    if (git(repo, ['show-ref', '--verify', '--quiet', `refs/heads/${mainBranch}`], { allowFailure: true }) === null) {
      git(repo, ['switch', '--track', '-c', mainBranch, `${remote}/${mainBranch}`])
    } else {
      git(repo, ['switch', mainBranch])
      git(repo, ['pull', '--ff-only', remote, mainBranch])
    }
    const mainContainsDev = git(repo, ['merge-base', '--is-ancestor', devBranch, mainBranch], { allowFailure: true }) !== null
    if (!mainContainsDev) {
      const releaseLabel = `${requirementId ?? 'delivery'}${revision != null ? ` [v${revision}]` : ''}`
      git(repo, ['merge', '--no-ff', devBranch, '-m', `release(${requirementId ?? 'delivery'}): merge ${releaseLabel} to ${mainBranch}`])
    }
    const mainMergeCommitSha = git(repo, ['rev-parse', mainBranch])
    git(repo, ['push', remote, mainBranch])
    git(repo, ['switch', devBranch])
    const summary = {
      ...base,
      devCommitSha,
      mainMergeCommitSha,
      pushedToRemoteDev: true,
      pushedToMain: true,
      pushedToMainAt: new Date().toISOString(),
    }
    return summary
  } catch (error) {
    // A conflicted rebase must never be left behind for the user to discover.
    if (git(repo, ['rev-parse', '--verify', 'REBASE_HEAD'], { allowFailure: true })) git(repo, ['rebase', '--abort'], { allowFailure: true })
    if (git(repo, ['branch', '--show-current'], { allowFailure: true }) === mainBranch) git(repo, ['switch', devBranch], { allowFailure: true })
    return gitIntegrationFailure(base, error.message)
  }
}

export function releaseDir(root) {
  return join(resolve(root), RELEASE_DIR)
}

export function releasePath(root, releaseId) {
  return join(releaseDir(root), `${releaseId}.json`)
}

export function requirementReleasePath(root, requirementId) {
  return join(releaseDir(root), `${requirementId}-release.json`)
}

function nextReleaseId(root) {
  let entries = []
  try {
    entries = readdirSync(releaseDir(root)).filter((name) => name.startsWith('REL-') && name.endsWith('.json'))
  } catch {
    entries = []
  }
  let max = 0
  for (const entry of entries) {
    const match = /^REL-(\d+)\.json$/.exec(entry)
    if (match) max = Math.max(max, Number(match[1]))
  }
  return `REL-${String(max + 1).padStart(3, '0')}`
}

export function readRelease(root, releaseId) {
  const file = releasePath(root, releaseId)
  if (!existsSync(file)) return null
  try {
    const payload = JSON.parse(readFileSync(file, 'utf8'))
    return payload?.schema === RELEASE_SCHEMA ? payload : null
  } catch {
    return null
  }
}

export function listReleases(root) {
  let entries = []
  try {
    entries = readdirSync(releaseDir(root))
  } catch {
    return []
  }
  return entries
    .filter((name) => name.startsWith('REL-') && name.endsWith('.json'))
    .map((name) => readRelease(root, name.slice(0, -'.json'.length)))
    .filter(Boolean)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
}

/**
 * Normalizes one requirement item into the delivery fact a release binds.
 * Returns a blocker instead of silently dropping requirements that are not
 * accepted: a release candidate must be explainable.
 */
export function deliveryFact(item) {
  const decision = item?.decision ?? null
  const candidate = item?.candidate ?? null
  const accepted = decision?.state === 'verified' && decision?.humanAccepted === true
  if (!accepted) {
    return {
      ok: false,
      requirement: item?.id ?? null,
      code: 'delivery-not-accepted',
      message: `${item?.id ?? '需求'} 尚未通过人类验收，不能进入发布候选`,
    }
  }
  if (!candidate?.exists) {
    return {
      ok: false,
      requirement: item.id,
      code: 'candidate-missing',
      message: `${item.id} 已验收但没有交付候选记录，无法绑定发布内容`,
    }
  }
  if (candidate.current !== true) {
    return {
      ok: false,
      requirement: item.id,
      code: 'candidate-stale',
      message: `${item.id} 的交付候选已过期（${(candidate.reasons ?? []).join(', ') || '内容变化'}），需要重新验收`,
    }
  }
  return {
    ok: true,
    delivery: {
      requirement: item.id,
      requirementRevision: item.revision ?? null,
      title: item.title,
      candidateId: candidate.id,
      treeHash: candidate.treeHash,
      requirementHash: candidate.requirementHash ?? null,
      acceptance: candidate.acceptance
        ? {
            file: candidate.acceptance.file ?? null,
            hash: candidate.acceptance.hash ?? null,
            result: candidate.acceptance.result ?? null,
            finishedAt: candidate.acceptance.finishedAt ?? null,
          }
        : null,
      humanSignoff: item.humanAcceptance?.signoff?.actor || decision?.signoff?.actor
        ? { actor: (item.humanAcceptance?.signoff ?? decision.signoff).actor, at: (item.humanAcceptance?.signoff ?? decision.signoff).at ?? null }
        : null,
      acceptedAt: decision?.at ?? null,
    },
  }
}

export function releaseContentHash({ target, version, deliveries }) {
  return sha256({
    target: target ?? null,
    version: version ?? null,
    deliveries: (deliveries ?? [])
      .map((delivery) => ({
        requirement: delivery.requirement,
        candidateId: delivery.candidateId,
        treeHash: delivery.treeHash,
        acceptanceHash: delivery.acceptance?.hash ?? null,
      }))
      .sort((a, b) => String(a.requirement).localeCompare(String(b.requirement))),
  })
}

/** Preview a release candidate: what would be released, or why it cannot be. */
export function planRelease({ items = [], requirementIds = null, target = 'staging', version = null } = {}) {
  const wanted = requirementIds ? new Set(requirementIds) : null
  const selected = (items ?? []).filter((item) => !wanted || wanted.has(item.id))
  const blockers = []
  const deliveries = []
  for (const item of selected) {
    const fact = deliveryFact(item)
    if (fact.ok) deliveries.push(fact.delivery)
    else blockers.push({ requirement: fact.requirement, code: fact.code, message: fact.message })
  }
  if (selected.length === 0) blockers.push({ requirement: null, code: 'empty', message: '没有可发布的已验收交付' })
  return {
    schema: 'alm.release.plan/v1',
    ok: blockers.length === 0,
    target,
    version,
    deliveries,
    blockers,
    contentHash: blockers.length === 0 ? releaseContentHash({ target, version, deliveries }) : null,
  }
}

export function createRelease({ root, items = [], requirementIds = null, target = 'staging', version = null, actor = 'human:local' }) {
  const plan = planRelease({ items, requirementIds, target, version })
  if (!plan.ok) {
    const error = new Error(plan.blockers.map((blocker) => blocker.message).join('；'))
    error.code = 'release-blocked'
    error.status = 409
    error.plan = plan
    throw error
  }
  const releaseId = nextReleaseId(root)
  const payload = {
    schema: RELEASE_SCHEMA,
    id: releaseId,
    status: 'draft',
    target,
    version,
    contentHash: plan.contentHash,
    deliveries: plan.deliveries,
    createdBy: actor,
    createdAt: new Date().toISOString(),
    authorization: null,
    executions: [],
  }
  mkdirSync(releaseDir(root), { recursive: true })
  writeFileSync(releasePath(root, releaseId), `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  return payload
}

function releaseError(code, message, status = 409) {
  const error = new Error(message)
  error.code = code
  error.status = status
  return error
}

/**
 * The human authorizes this exact candidate. If any bound acceptance fact
 * changed since the plan (new candidate, stale worktree), the old authorization
 * must not be reused: the release has to be re-planned.
 */
export function authorizeRelease({ root, releaseId, items = [], actor = null, subject = null, apply = false }) {
  const principal = requireTrustedHumanSubject(subject, {
    actor,
    error: (message) => releaseError('untrusted-subject', message, 403),
  })
  actor = principal.id
  const release = readRelease(root, releaseId)
  if (!release) throw releaseError('release-not-found', `发布记录 ${releaseId} 不存在`, 404)
  if (release.status === 'released') throw releaseError('release-already-released', '已发布的记录不能再次授权')
  if (release.status !== 'draft') throw releaseError('release-not-draft', `只有待发布决定的记录可以授权（当前 ${release.status}）`)
  const byId = new Map((items ?? []).map((item) => [item.id, item]))
  const blockers = []
  for (const delivery of release.deliveries) {
    const fact = deliveryFact(byId.get(delivery.requirement))
    if (!fact.ok) {
      blockers.push({ requirement: delivery.requirement, code: fact.code, message: fact.message })
      continue
    }
    if (fact.delivery.candidateId !== delivery.candidateId || fact.delivery.treeHash !== delivery.treeHash) {
      blockers.push({
        requirement: delivery.requirement,
        code: 'release-candidate-changed',
        message: `${delivery.requirement} 的交付候选在计划后发生变化，请重新生成发布候选并再次授权`,
      })
    }
  }
  if (blockers.length > 0) {
    const error = releaseError('release-stale', blockers.map((blocker) => blocker.message).join('；'))
    error.blockers = blockers
    throw error
  }
  const authorization = { actor, subject: principal, at: new Date().toISOString(), contentHash: release.contentHash }
  if (apply) {
    const next = { ...release, status: 'authorized', authorization }
    writeFileSync(releasePath(root, releaseId), `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    return { applied: true, release: next }
  }
  return { applied: false, release: { ...release, status: 'authorized', authorization } }
}

/** Records what the executor actually did — success or failure, never both. */
export function recordReleaseExecution({ root, releaseId, result, note = null, actor = 'ai:runner', apply = false, items = null, verifiedGithub = null, archiveOnly = false }) {
  const release = readRelease(root, releaseId)
  if (!release) throw releaseError('release-not-found', `发布记录 ${releaseId} 不存在`, 404)
  if (!['released', 'failed', 'releasing'].includes(result)) {
    throw releaseError('release-result-invalid', `未知的发布结果 ${result}`, 400)
  }
  if (release.status === 'draft') throw releaseError('release-not-authorized', '发布尚未获得人类授权，不能执行')
  if (release.status === 'cancelled') throw releaseError('release-cancelled', '发布已取消')
  if (release.status === 'released') throw releaseError('release-already-released', '已发布的历史记录不能再次执行或改写')
  const project = readProject(root)
  if (result === 'released' && !archiveOnly && project?.github?.owner && project?.github?.repo) {
    if (verifiedGithub?.verified !== true || verifiedGithub.repository !== `${project.github.owner}/${project.github.repo}` ||
      verifiedGithub.target !== (project.defaultBranch ?? 'main') || !verifiedGithub.mergedAt ||
      !/^[a-f0-9]{40}$/.test(verifiedGithub.mergeCommit ?? '') || !/^[a-f0-9]{40}$/.test(verifiedGithub.head ?? '') ||
      !Number.isSafeInteger(verifiedGithub.pr) || verifiedGithub.pr < 1 || release.github?.pr !== verifiedGithub.pr || release.github?.head !== verifiedGithub.head) {
      throw releaseError('github-merge-required', '发布尚未验证 GitHub PR 合入主分支，不能仅凭人工备注登记成功。请使用发布 PR 流程。')
    }
  }
  // Authorization binds the exact candidate hashes the human saw. If the bound
  // delivery changed after authorization, executing it would publish content the
  // human never approved — refuse and ask for a re-plan instead.
  if (Array.isArray(items) && items.length > 0) {
    const bound = (release.deliveries ?? []).map((delivery) => delivery.requirement).filter(Boolean)
    if (bound.length > 0) {
      const plan = planRelease({ items, requirementIds: bound, target: release.target ?? 'staging', version: release.version ?? null })
      if (!plan.ok || plan.contentHash !== release.contentHash) {
        throw releaseError(
          'release-candidate-changed',
          `${bound.join('、')} 的交付内容在授权后发生变化，请重新生成发布记录并再次授权`,
        )
      }
    }
  }
  const execution = {
    result,
    note: typeof note === 'string' && note.trim() !== '' ? note.trim() : null,
    actor,
    at: new Date().toISOString(),
    archiveOnly: archiveOnly === true,
  }
  const next = { ...release, ...(verifiedGithub ? { github: verifiedGithub } : {}), ...(archiveOnly ? { archiveOnly: true } : {}), status: result, executions: [...(release.executions ?? []), execution] }
  if (apply) writeFileSync(releasePath(root, releaseId), `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  return { applied: apply === true, release: next, execution }
}

function acceptanceCriteriaFor(item, doc) {
  const parsed = Array.isArray(doc?.acceptance) ? doc.acceptance : []
  if (parsed.length > 0) return parsed.map((criterion) => ({ id: criterion.id, text: criterion.text ?? criterion.title ?? null }))
  const criteria = []
  for (const line of String(item?.briefText ?? '').split(/\r?\n/)) {
    const match = /^\s*[-*]?\s*(AC-\d{2,})\s*[:：]?[\s-]*(.+?)\s*$/.exec(line)
    if (match) criteria.push({ id: match[1], text: match[2] })
  }
  return criteria
}

function releaseNotesFor(item, criteria, candidate) {
  return {
    title: `${item.id} 发布归档`,
    summary: `${item.title ?? item.id} 已完成人工验收并归档。`,
    highlights: [
      `交付候选 ${candidate.candidateId ?? candidate.id ?? '未知候选'} 已通过当前验证并完成签收。`,
      ...criteria.map((criterion) => `${criterion.id ?? 'AC'}：${criterion.text ?? '已达成'}`),
    ],
  }
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

/**
 * Persist the verifiable Git result beside both release records. It is useful
 * for an existing local archive too: a past signoff can be integrated after a
 * baseline cleanup without manufacturing a new human approval.
 */
export function syncRequirementReleaseToMain({ root, requirementId, releaseId = null, revision = null, apply = false } = {}) {
  const repo = resolve(root)
  const archiveFile = requirementReleasePath(repo, requirementId)
  let archive = null
  try { archive = existsSync(archiveFile) ? JSON.parse(readFileSync(archiveFile, 'utf8')) : null } catch {}
  const resolvedReleaseId = releaseId ?? archive?.releaseId ?? null
  const release = resolvedReleaseId ? readRelease(repo, resolvedReleaseId) : null
  const sourceControl = mergeDevelopmentToMain({
    root: repo,
    requirementId,
    revision: revision ?? archive?.requirement?.revision ?? release?.version ?? null,
  })
  if (!apply || !sourceControl.pushedToMain) return { applied: false, sourceControl, release, archive }

  const nextRelease = release ? { ...release, sourceControl } : null
  if (nextRelease) writeJson(releasePath(repo, resolvedReleaseId), nextRelease)
  const nextArchive = archive
    ? { ...archive, sourceControl, architectureDocPath: sourceControl.architectureDocPath }
    : null
  if (nextArchive) {
    const record = { ...nextArchive }
    delete record.archiveHash
    nextArchive.archiveHash = sha256(record)
    writeJson(archiveFile, nextArchive)
  }
  return { applied: true, sourceControl, release: nextRelease, archive: nextArchive }
}

/**
 * Close one trusted, signed-off delivery as a local release archive. This is a
 * requirements-record publication, not a claim that a remote deployment has
 * happened. The ordinary GitHub release path remains available for projects
 * that need a verified merge.
 */
export function archiveRequirementRelease({ root, item, actor, subject = null, apply = false }) {
  const principal = requireTrustedHumanSubject(subject, {
    actor,
    error: (message) => releaseError('untrusted-subject', message, 403),
  })
  const repo = resolve(root)
  const plan = planRelease({ items: [item], requirementIds: [item?.id], target: 'requirement-archive', version: item?.revision != null ? `v${item.revision}` : null })
  if (!plan.ok) {
    const error = releaseError('release-blocked', plan.blockers.map((blocker) => blocker.message).join('；'))
    error.plan = plan
    throw error
  }
  if (!apply) return { schema: REQUIREMENT_RELEASE_SCHEMA, applied: false, plan }

  const archiveFile = requirementReleasePath(repo, item.id)
  if (existsSync(archiveFile)) {
    try {
      const existing = JSON.parse(readFileSync(archiveFile, 'utf8'))
      if (existing?.schema === REQUIREMENT_RELEASE_SCHEMA && existing.requirement?.id === item.id) {
        const integration = syncRequirementReleaseToMain({ root: repo, requirementId: item.id, releaseId: existing.releaseId, revision: item?.revision ?? null, apply })
        return {
          schema: REQUIREMENT_RELEASE_SCHEMA,
          applied: integration.applied,
          release: integration.release ?? readRelease(repo, existing.releaseId),
          archive: { path: `${RELEASE_DIR}/${item.id}-release.json`, record: integration.archive ?? existing },
          sourceControl: integration.sourceControl,
        }
      }
    } catch {}
    throw releaseError('release-archive-exists', `发布归档 ${item.id} 已存在且无法验证，不能覆盖`, 409)
  }

  const created = createRelease({ root: repo, items: [item], requirementIds: [item.id], target: 'requirement-archive', version: item?.revision != null ? `v${item.revision}` : null, actor: principal.id })
  const authorized = authorizeRelease({ root: repo, releaseId: created.id, items: [item], actor: principal.id, subject: principal, apply: true })
  const executed = recordReleaseExecution({ root: repo, releaseId: created.id, result: 'released', note: '已生成需求发布归档', actor: principal.id, apply: true, items: [item], archiveOnly: true })
  const delivery = executed.release.deliveries.find((entry) => entry.requirement === item.id)
  const doc = parseDoc(item?.briefText ?? '', { requirementId: item.id, revision: item?.revision ?? null })
  const acceptanceCriteria = acceptanceCriteriaFor(item, doc)
  const snapshot = {
    schema: REQUIREMENT_RELEASE_SCHEMA,
    id: `${item.id}-release`,
    releaseId: executed.release.id,
    releasedAt: executed.execution.at,
    requirement: {
      id: item.id,
      title: item.title ?? null,
      revision: item.revision ?? null,
      contentHash: delivery?.requirementHash ?? null,
    },
    evolution: Array.isArray(item.specConvergences) ? item.specConvergences.map((entry) => ({ revision: entry.revision ?? null, at: entry.at ?? entry.createdAt ?? null, summary: entry.summary ?? entry.title ?? null })) : [],
    acceptanceCriteria,
    candidate: delivery ?? null,
    signoff: item?.humanAcceptance?.signoff ?? item?.decision?.signoff ?? null,
    releaseNotes: releaseNotesFor(item, acceptanceCriteria, delivery ?? { id: item?.candidate?.id ?? '未知候选' }),
  }
  const record = { ...snapshot, archiveHash: sha256(snapshot) }
  mkdirSync(releaseDir(repo), { recursive: true })
  writeFileSync(archiveFile, `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  const integration = syncRequirementReleaseToMain({ root: repo, requirementId: item.id, releaseId: executed.release.id, revision: item?.revision ?? null, apply: true })
  return {
    schema: REQUIREMENT_RELEASE_SCHEMA,
    applied: true,
    release: integration.release ?? executed.release,
    authorization: authorized.release.authorization,
    archive: { path: `${RELEASE_DIR}/${item.id}-release.json`, record: integration.archive ?? record },
    sourceControl: integration.sourceControl,
  }
}

/** Newest release plus the last successful publication: later drafts cannot erase history. */
export function releaseViewFor({ root, requirementId }) {
  const releases = listReleases(root)
    .filter((release) => (release.deliveries ?? []).some((delivery) => delivery.requirement === requirementId))
  const found = releases.at(-1)
  if (!found) return { exists: false, id: null, status: null, label: null }
  const summarize = (record) => {
    const delivery = record.deliveries.find((entry) => entry.requirement === requirementId)
    // Legacy releases bind a candidate but do not record its requirement revision.
    // Read that immutable candidate, never infer a new iteration from dirty files.
    const candidate = delivery.candidateId ? readCandidate(root, requirementId, delivery.candidateId) : null
    const summary = {
      exists: true,
      id: record.id,
      status: record.status,
      label: RELEASE_LABELS[record.status] ?? record.status,
      target: record.target ?? null,
      version: record.version ?? null,
      authorizedBy: record.authorization?.actor ?? null,
      authorizedAt: record.authorization?.at ?? null,
      releasedAt: (record.executions ?? []).filter((execution) => execution.result === 'released').at(-1)?.at ?? null,
      github: record.github ?? null,
      githubVerified: record.github?.verified === true && Boolean(record.github?.mergeCommit && record.github?.mergedAt),
      candidateId: delivery.candidateId ?? null,
      requirementRevision: delivery.requirementRevision ?? candidate?.revision ?? null,
      requirementHash: delivery.requirementHash ?? candidate?.requirementHash ?? null,
      treeHash: delivery.treeHash ?? candidate?.treeHash ?? null,
    }
    // sourceControl is written after the original archive-only release. Keep it
    // in the query projection so Desktop can verify the eventual main merge.
    if (record.sourceControl) {
      summary.sourceControl = record.sourceControl
      summary.mainMerged = record.sourceControl.pushedToMain === true && Boolean(record.sourceControl.mainMergeCommitSha)
    }
    return summary
  }
  const published = releases.filter((record) => record.status === 'released').at(-1)
  return { ...summarize(found), lastReleased: published ? summarize(published) : null }
}
