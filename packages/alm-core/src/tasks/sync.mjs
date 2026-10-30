import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createGiteaClient } from '@ai-alm/alm-scm/gitea'
import { githubProvider } from '../github/provider.mjs'
import { readMapping, writeMapping } from '../github/mapping.mjs'

export class TaskSyncError extends Error {
  constructor(message, { code = 'task-sync' } = {}) {
    super(message)
    this.name = 'TaskSyncError'
    this.code = code
  }
}

const DEFAULT_LABELS = ['type::task', 'planning::execution', 'status::ready']

export function taskIssueBody(task) {
  const lines = [
    `## ${task.id} ${task.title}`,
    '',
    `- 覆盖需求：${(task.covers ?? []).join('、') || '（未声明）'}`,
    `- 前置：${(task.blockedBy ?? []).length ? task.blockedBy.join('、') : '无'}`,
    `- 实施范围：${(task.scope ?? []).join('、') || '（未声明）'}`,
    `- 不在范围：${(task.outOfScope ?? []).join('、') || '（未声明）'}`,
    '',
    '## 接口',
    '',
    task.interface ?? '（未声明）',
    '',
    '## 验收',
    '',
    `- 正例：${task.positive ?? '（未声明）'}`,
    `- 反例：${task.negative ?? '（未声明）'}`,
    '',
    '## 证据',
    '',
    ...(task.evidence ?? []).map((entry) => `- \`${entry}\``),
    '',
  ]
  return lines.join('\n')
}

function giteaProvider() {
  const client = createGiteaClient({
    baseUrl: process.env.ALM_GITEA_URL,
    owner: process.env.ALM_GITEA_OWNER,
    repo: process.env.ALM_GITEA_REPO,
    token: process.env.ALM_GITEA_TOKEN,
  })
  return {
    name: 'gitea',
    find: (title) => client.findIssue(title),
    create: (issue) => client.createIssue(issue),
  }
}

function providerFor(name, labels, project) {
  if (name === 'github') {
    return githubProvider({
      repo: project ? `${project.github.owner}/${project.github.repo}` : undefined,
      owner: project?.github?.owner,
      projectNumber: project?.github?.project?.number,
      labels,
    })
  }
  if (name === 'gitea') return giteaProvider()
  throw new TaskSyncError(`unknown provider: ${name}`, { code: 'unknown-provider' })
}

function writePayload(path, payload) {
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

/**
 * Sync a change's task draft to an external board. Dry run by default; `apply`
 * creates missing issues, adopts existing ones by exact title, and writes the
 * issue reference back after every creation so a crash cannot duplicate work.
 */
export async function syncTasks({
  root,
  changeId,
  apply = false,
  provider = 'github',
  createProvider,
  labels = DEFAULT_LABELS,
  project,
}) {
  const path = join(root, 'changes', changeId, 'tasks.json')
  if (!existsSync(path)) throw new TaskSyncError(`task draft not found: changes/${changeId}/tasks.json`, { code: 'no-draft' })

  const payload = JSON.parse(readFileSync(path, 'utf8'))
  const tasks = Array.isArray(payload.tasks) ? payload.tasks : []
  // Dry-run must work without board credentials: only build a provider when
  // applying, or when a test injects one.
  const adapter = createProvider ? createProvider() : apply ? providerFor(provider, labels, project) : null
  const mapping = readMapping(root)
  const actions = []

  for (const task of tasks) {
    const title = `${task.id} ${task.title}`
    if (task.issue?.number) {
      actions.push({ task: task.id, action: 'skip', issue: task.issue })
      continue
    }

    const existing = adapter ? adapter.find(title) : null
    if (existing) {
      task.issue = { provider: adapter.name, number: existing.number, url: existing.url }
      task.status = 'open'
      mapping.tasks[task.id] = task.issue
      actions.push({ task: task.id, action: 'adopt', issue: task.issue, title })
      if (apply) {
        writePayload(path, payload)
        writeMapping(root, mapping)
      }
      continue
    }

    if (!apply) {
      actions.push({ task: task.id, action: 'create', title, body: taskIssueBody(task) })
      continue
    }

    const parent = mapping.requirements[task.covers?.[0]]?.number
    const created = adapter.create({ title, body: taskIssueBody(task), labels, parent })
    task.issue = { provider: adapter.name, number: created.number, url: created.url }
    task.status = 'open'
    task.issue.parent = parent ?? null
    mapping.tasks[task.id] = task.issue
    writePayload(path, payload)
    writeMapping(root, mapping)
    if (project?.github?.project?.number) {
      adapter.addToProject?.(task.issue.url, project.github.project.number)
      const ready = project.github.project.status?.ready
      if (ready && adapter.setStatus) {
        try {
          adapter.setStatus(task.issue.url, ready, project.github.project.number)
        } catch {
          // status is best-effort; the issue itself is already persisted
        }
      }
    }
    actions.push({ task: task.id, action: 'created', issue: task.issue, title })
  }

  return {
    schema: 'alm.tasks.sync/v1',
    changeId,
    provider: adapter?.name ?? provider,
    applied: apply,
    actions,
    tasks,
  }
}
