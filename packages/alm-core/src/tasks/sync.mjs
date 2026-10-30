import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createGiteaClient } from '@ai-alm/alm-scm/gitea'

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

function githubProvider(labels) {
  const gh = (args) =>
    execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

  return {
    name: 'github',
    find(title) {
      const listed = JSON.parse(gh(['issue', 'list', '--state', 'all', '--limit', '50', '--json', 'number,url,title']))
      const match = listed.find((issue) => issue.title === title)
      return match ? { number: match.number, url: match.url, title: match.title } : null
    },
    create({ title, body, labels: extra }) {
      const url = gh(['issue', 'create', '--title', title, '--body', body, '--label', [...labels, ...(extra ?? [])].join(',')])
      const number = Number(url.split('/').pop())
      return { number: Number.isFinite(number) ? number : null, url, title }
    },
  }
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

function providerFor(name, labels) {
  if (name === 'github') return githubProvider(labels)
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
}) {
  const path = join(root, 'changes', changeId, 'tasks.json')
  if (!existsSync(path)) throw new TaskSyncError(`task draft not found: changes/${changeId}/tasks.json`, { code: 'no-draft' })

  const payload = JSON.parse(readFileSync(path, 'utf8'))
  const tasks = Array.isArray(payload.tasks) ? payload.tasks : []
  const adapter = createProvider ? createProvider() : providerFor(provider, labels)
  const actions = []

  for (const task of tasks) {
    const title = `${task.id} ${task.title}`
    if (task.issue?.number) {
      actions.push({ task: task.id, action: 'skip', issue: task.issue })
      continue
    }

    const existing = adapter.find(title)
    if (existing) {
      task.issue = { provider: adapter.name, number: existing.number, url: existing.url }
      task.status = 'open'
      actions.push({ task: task.id, action: 'adopt', issue: task.issue, title })
      if (apply) writePayload(path, payload)
      continue
    }

    if (!apply) {
      actions.push({ task: task.id, action: 'create', title, body: taskIssueBody(task) })
      continue
    }

    const created = adapter.create({ title, body: taskIssueBody(task), labels })
    task.issue = { provider: adapter.name, number: created.number, url: created.url }
    task.status = 'open'
    writePayload(path, payload)
    actions.push({ task: task.id, action: 'created', issue: task.issue, title })
  }

  return {
    schema: 'alm.tasks.sync/v1',
    changeId,
    provider: adapter.name,
    applied: apply,
    actions,
    tasks,
  }
}
