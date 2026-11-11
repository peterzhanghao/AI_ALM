import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

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

export function syncDevelopmentBranch({ root, requirementId, revision, candidateId, title, paths = [], branch = 'develop', remote = 'origin' } = {}) {
  const repo = resolve(root)
  const base = { devBranch: branch, remote, devCommitSha: null, pushedToRemoteDev: false, reason: null, stagedPaths: [] }
  if (!git(repo, ['rev-parse', '--is-inside-work-tree'], { allowFailure: true })) return { ...base, reason: '当前工作区不是 Git 仓库' }
  const current = git(repo, ['branch', '--show-current'], { allowFailure: true })
  if (!current) return { ...base, reason: '当前处于 detached HEAD，不能自动同步开发分支' }
  if (current !== branch) return { ...base, devBranch: current, reason: `当前分支为 ${current}，仅允许在 ${branch} 自动提交` }
  if (!git(repo, ['remote', 'get-url', remote], { allowFailure: true })) return { ...base, reason: `未配置远程 ${remote}` }
  const selected = [...new Set(paths.map(safe).filter(Boolean))]
  const staged = lines(git(repo, ['diff', '--cached', '--name-only']))
  if (staged.length) return { ...base, reason: `检测到已有暂存改动（${staged.slice(0, 3).join('、')}），为避免混入不自动提交` }
  const dirty = [...new Set([
    ...lines(git(repo, ['diff', '--name-only'])),
    ...lines(git(repo, ['ls-files', '--others', '--exclude-standard'])),
  ])].filter(path => !runtimePath(path))
  const changedImplementation = dirty.filter(path =>
    /\.(?:[cm]?js|jsx|tsx?|css|json|ya?ml|sql|prisma)$/i.test(path),
  )
  const uncovered = changedImplementation.filter(path => !selected.includes(path))
  if (uncovered.length) return { ...base, reason: `发现未归属到 ${requirementId} 的实现改动（${uncovered.slice(0, 3).join('、')}），未自动提交` }
  const toStage = selected.filter(path => existsSync(join(repo, path)) && dirty.includes(path))
  if (!toStage.length) {
    const devCommitSha = git(repo, ['rev-parse', 'HEAD'], { allowFailure: true })
    const remoteHead = git(repo, ['ls-remote', '--heads', remote, `refs/heads/${branch}`], { allowFailure: true })
      ?.split(/\s+/)[0] ?? null
    if (devCommitSha && remoteHead === devCommitSha) {
      return { ...base, devCommitSha, pushedToRemoteDev: true }
    }
    return { ...base, devCommitSha, reason: remoteHead ? `当前 HEAD 尚未同步至 ${remote}/${branch}` : '没有可提交的需求相关改动' }
  }
  git(repo, ['add', '--', ...toStage])
  const subject = String(title ?? requirementId).replace(/[\r\n]+/g, ' ').trim().slice(0, 72)
  try {
    git(repo, ['commit', '-m', `feat(${requirementId}): ${subject} [v${revision} / ${candidateId}]`])
  } catch (error) {
    git(repo, ['reset', '--', ...toStage], { allowFailure: true })
    return { ...base, reason: `创建开发提交失败：${error.message}` }
  }
  const sha = git(repo, ['rev-parse', 'HEAD'])
  try {
    git(repo, ['push', remote, branch])
    return { ...base, devCommitSha: sha, pushedToRemoteDev: true, stagedPaths: toStage }
  } catch (error) {
    return { ...base, devCommitSha: sha, pushedToRemoteDev: false, reason: `提交已创建但推送失败：${error.message}`, stagedPaths: toStage }
  }
}
