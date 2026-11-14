import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { IMPLEMENTATION_PATH, developWorktree, isNoisePath } from './delivery-scope.mjs'

const normalize = value => String(value ?? '').replaceAll('\\', '/').replace(/^\.\//, '').trim()
const safe = value => {
  const path = normalize(value)
  return path && !path.startsWith('/') && !/^[A-Za-z]:/.test(path) && !path.split('/').includes('..') ? path : null
}
const git = (root, args, { allowFailure = false } = {}) => {
  try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() } catch (error) {
    if (allowFailure) return null
    throw Object.assign(new Error(error.stderr?.trim() || error.message), { code: 'git-command-failed' })
  }
}
const lines = value => String(value ?? '').split(/\r?\n/).map(normalize).filter(Boolean)
const runtimePath = path => /^(?:\.alm\/|artifacts\/|validation\/|tmp\/|\.tmp\/)/.test(path)

/**
 * Commit and (by default) push one requirement's verified delivery to develop.
 *
 * `scope` comes from collectDeliveryScope: it is the real worktree diff split
 * into owned / noise / foreign paths. Passing a plain `paths` array keeps the
 * older literal-path behaviour for callers that have not adopted a scope yet.
 * A commit is created in the worktree that owns the integration branch, so an
 * isolated agent worktree on another branch cannot silently commit elsewhere.
 */
export function syncDevelopmentBranch({ root, requirementId, revision, candidateId, title, paths = [], scope = null, branch = 'develop', remote = 'origin', push = true } = {}) {
  const repo = resolve(root)
  const base = {
    devBranch: branch, remote, devCommitSha: null, pushedToRemoteDev: false, reason: null, stagedPaths: [],
    committed: false, requiresReverification: false, unattributedPaths: [], noisePaths: [], worktreeRoot: null,
  }
  if (!git(repo, ['rev-parse', '--is-inside-work-tree'], { allowFailure: true })) return { ...base, reason: '当前工作区不是 Git 仓库' }
  const target = developWorktree(repo, branch)
  if (!target) return { ...base, reason: `未找到 ${branch} 分支所在的工作树，不能自动提交` }
  const current = git(target, ['branch', '--show-current'], { allowFailure: true })
  if (!current) return { ...base, worktreeRoot: target, reason: `${branch} 工作树处于 detached HEAD，不能自动提交` }
  if (current !== branch) return { ...base, worktreeRoot: target, devBranch: current, reason: `目标工作树分支为 ${current}，仅允许在 ${branch} 自动提交` }
  if (!git(target, ['remote', 'get-url', remote], { allowFailure: true })) return { ...base, worktreeRoot: target, reason: `未配置远程 ${remote}` }
  const selected = [...new Set([
    ...(scope?.owned ?? []),
    ...paths.map(safe).filter(Boolean),
  ].map(normalize).filter(Boolean))]
  const noise = new Set(scope?.noise ?? [])
  const staged = lines(git(target, ['diff', '--cached', '--name-only']))
  if (staged.length) return { ...base, worktreeRoot: target, reason: `检测到已有暂存改动（${staged.slice(0, 3).join('、')}），为避免混入不自动提交` }
  const dirty = [...new Set([
    ...lines(git(target, ['diff', '--name-only'])),
    ...lines(git(target, ['ls-files', '--others', '--exclude-standard'])),
  ])].map(normalize).filter(Boolean)
  const uncovered = dirty.filter(path => {
    if (runtimePath(path) || isNoisePath(path) || noise.has(path) || selected.includes(path)) return false
    return scope ? true : IMPLEMENTATION_PATH.test(path)
  })
  if (uncovered.length) {
    const preview = uncovered.slice(0, 3).join('、')
    return {
      ...base,
      worktreeRoot: target,
      noisePaths: [...noise],
      unattributedPaths: uncovered,
      reason: `检测到 ${uncovered.length} 个未归属或未按需求拆分的改动（${preview}${uncovered.length > 3 ? ` 等 ${uncovered.length} 个` : ''}），请先按需求拆分/暂存后再提交`,
    }
  }
  const toStage = selected.filter(path => existsSync(join(target, path)) && dirty.includes(path))
  if (!toStage.length) {
    const devCommitSha = git(target, ['rev-parse', 'HEAD'], { allowFailure: true })
    const remoteHead = git(target, ['ls-remote', '--heads', remote, `refs/heads/${branch}`], { allowFailure: true })
      ?.split(/\s+/)[0] ?? null
    if (devCommitSha && remoteHead === devCommitSha) {
      return { ...base, worktreeRoot: target, devCommitSha, pushedToRemoteDev: true, noisePaths: [...noise] }
    }
    return { ...base, worktreeRoot: target, devCommitSha, reason: remoteHead ? `当前 HEAD 尚未同步至 ${remote}/${branch}` : '没有可提交的需求相关改动' }
  }
  git(target, ['add', '--', ...toStage])
  // The Git history is a product-facing delivery ledger. Keep its subject
  // directly searchable by requirement ID and title; Candidate/version details
  // are already bound in the candidate record and should not obscure it.
  const requirementLabel = String(requirementId ?? 'REQ').replace(/[\r\n:]+/g, ' ').trim() || 'REQ'
  const subject = String(title ?? '').replace(/[\r\n]+/g, ' ').trim() || '未命名需求'
  try {
    git(target, ['commit', '-m', `${requirementLabel}: ${subject}`])
  } catch (error) {
    git(target, ['reset', '--', ...toStage], { allowFailure: true })
    return { ...base, worktreeRoot: target, reason: `创建开发提交失败：${error.message}` }
  }
  const sha = git(target, ['rev-parse', 'HEAD'])
  if (!push) {
    return { ...base, worktreeRoot: target, devCommitSha: sha, pushedToRemoteDev: false, committed: true, stagedPaths: toStage, noisePaths: [...noise], reason: '已创建本地提交，按配置未推送' }
  }
  try {
    git(target, ['push', remote, branch])
    return {
      ...base, worktreeRoot: target, devCommitSha: sha, pushedToRemoteDev: true, committed: true,
      requiresReverification: true, stagedPaths: toStage, noisePaths: [...noise],
    }
  } catch (error) {
    // Keep the local commit: a failed push is recoverable, deleting the delivery is not.
    return {
      ...base, worktreeRoot: target, devCommitSha: sha, pushedToRemoteDev: false, committed: true,
      stagedPaths: toStage, noisePaths: [...noise], reason: `提交已创建但推送失败：${error.message}`,
    }
  }
}
