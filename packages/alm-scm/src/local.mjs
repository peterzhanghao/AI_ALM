import { execFileSync } from 'node:child_process'

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

export function resolveSha(root, ref) {
  try {
    return git(root, 'rev-parse', ref)
  } catch {
    return undefined
  }
}

export function mergeBase(root, base, head) {
  try {
    return git(root, 'merge-base', base, head)
  } catch {
    return undefined
  }
}

export function currentBranch(root) {
  return git(root, 'rev-parse', '--abbrev-ref', 'HEAD')
}

/** Merge `head` into `base` with a merge commit and return the new SHA. */
export function mergeLocal({ root, base, head, message }) {
  const dirty = git(root, 'status', '--porcelain', '--untracked-files=no')
  if (dirty !== '') throw new Error('merge: worktree must be clean')
  git(root, 'switch', base)
  try {
    git(root, '-c', 'user.name=alm-bot', '-c', 'user.email=alm@local', 'merge', '--no-ff', '-m', message ?? `merge ${head}`, head)
    return { base, head, mergeSha: git(root, 'rev-parse', 'HEAD') }
  } finally {
    // Leave the repository on the base branch; the caller decides the next step.
  }
}
