import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { readProject } from '../alm-core/src/project/project.mjs'
import { readMapping } from '../alm-core/src/github/mapping.mjs'
import { syncRequirementIssues } from '../alm-core/src/github/sync-requirements.mjs'
import { syncTasks } from '../alm-core/src/tasks/sync.mjs'

export class GithubSyncError extends Error {
  constructor(message, { code = 'github-sync', status = 400 } = {}) {
    super(message)
    this.name = 'GithubSyncError'
    this.code = code
    this.status = status
  }
}

/** Common preconditions: a linked project and a generated task draft. */
export function githubContext({ root, changeId }) {
  if (!changeId) throw new GithubSyncError('changeId is required', { code: 'change-required' })
  const project = readProject(root)
  if (!project) throw new GithubSyncError('工作区未关联项目：请先关联 GitHub 仓库', { code: 'no-project', status: 409 })
  if (!project.github?.owner || !project.github?.repo) {
    throw new GithubSyncError('项目缺少 github.owner/repo', { code: 'no-github', status: 409 })
  }
  const draft = join(root, 'changes', changeId, 'tasks.json')
  if (!existsSync(draft)) {
    throw new GithubSyncError(`任务草案不存在：changes/${changeId}/tasks.json，请先「开始开发」`, {
      code: 'no-draft',
      status: 404,
    })
  }
  return {
    project,
    repo: `${project.github.owner}/${project.github.repo}`,
    board: project.github.project?.number ?? null,
  }
}

function shapePlan({ context, changeId, requirementResult, taskResult, mapping }) {
  return {
    schema: 'alm.github.plan/v1',
    changeId,
    repo: context.repo,
    board: context.board,
    requirements: requirementResult.actions.map((action) => ({
      requirement: action.requirement,
      action: action.action,
      title: action.title,
      labels: action.labels,
      body: action.body,
    })),
    tasks: taskResult.actions.map((action) => ({
      task: action.task,
      action: action.action,
      title: action.title,
      body: action.body,
    })),
    mapping: mapping ?? null,
  }
}

/** Dry-run: show the exact Issue titles/bodies/labels without touching GitHub. */
export async function previewGithub({ root, changeId }) {
  const context = githubContext({ root, changeId })
  const requirementResult = await syncRequirementIssues({ root, changeId, apply: false, project: context.project })
  const taskResult = await syncTasks({ root, changeId, apply: false, project: context.project })
  return shapePlan({ context, changeId, requirementResult, taskResult, mapping: readMapping(root) })
}

/**
 * Create/adopt requirement Issues, then task sub-issues and board entries.
 * Mapping is written after every creation, so a retry never duplicates work.
 */
export async function applyGithub({ root, changeId, createProvider }) {
  const context = githubContext({ root, changeId })
  const requirementResult = await syncRequirementIssues({
    root,
    changeId,
    apply: true,
    project: context.project,
    createProvider,
  })
  let taskResult
  try {
    taskResult = await syncTasks({ root, changeId, apply: true, project: context.project, createProvider })
  } catch (error) {
    throw new GithubSyncError(
      `需求 Issue 已处理（${requirementResult.actions.length} 个），任务建单失败：${error?.message ?? String(error)}`,
      { code: 'task-sync-failed' },
    )
  }
  return {
    schema: 'alm.github.sync/v1',
    changeId,
    repo: context.repo,
    board: context.board,
    requirements: requirementResult.actions,
    tasks: taskResult.actions,
    mapping: readMapping(root),
  }
}
