import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { gitText } from '../alm-core/src/git-run.mjs'
import { resumableRunFor } from '../alm-core/src/requirements/run.mjs'
import { resolveRunDecision } from '../alm-core/src/requirements/run-decision.mjs'

const rootKey = (root) => process.platform === 'win32' ? resolve(root).toLowerCase() : resolve(root)

export function isolatedDecisionWorktrees(root) {
  let output
  try { output = gitText(root, ['worktree', 'list', '--porcelain', '-z']) } catch { return [] }
  return output.split('\0\0').flatMap(block => {
    const fields = block.split('\0')
    const path = fields.find(value => value.startsWith('worktree '))?.slice(9)
    const branch = fields.find(value => value.startsWith('branch refs/heads/'))?.slice(18)
    if (!path || !branch || rootKey(path) === rootKey(root) || !/^alm\/chg-[a-z0-9-]+$/.test(branch)) return []
    const changeId = branch.slice(4).toUpperCase()
    try {
      const change = JSON.parse(readFileSync(join(path, '.alm/changes', `${changeId}.json`), 'utf8'))
      if (change.isolated !== true || change.changeId !== changeId || change.branch !== branch || !Array.isArray(change.requirementIds)) return []
      return [{ root: resolve(path), changeId, requirementIds: change.requirementIds }]
    } catch { return [] }
  })
}

export function pendingIsolatedDecision(root, requirementId, worktrees = isolatedDecisionWorktrees(root)) {
  const decisions = []
  for (const checkout of worktrees) {
    if (!checkout.requirementIds.includes(requirementId)) continue
    const run = resumableRunFor(checkout.root, requirementId)
    if (run?.change !== checkout.changeId || !['waiting-input', 'failed'].includes(run.status)) continue
    const decision = resolveRunDecision(checkout.root, run)
    if (decision.pending) decisions.push({ root: checkout.root, run, decision })
  }
  return decisions.sort((left, right) => String(right.run.updatedAt).localeCompare(String(left.run.updatedAt)) || rootKey(left.root).localeCompare(rootKey(right.root)))[0] ?? null
}
