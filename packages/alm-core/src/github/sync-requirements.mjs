import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { indexReport } from '../commands.mjs'
import { githubProvider } from './provider.mjs'
import { readMapping, writeMapping } from './mapping.mjs'

export class RequirementSyncError extends Error {
  constructor(message, { code = 'requirement-sync' } = {}) {
    super(message)
    this.name = 'RequirementSyncError'
    this.code = code
  }
}

export function requirementLabels(project, asset) {
  const labels = ['type::requirement']
  const configured = project?.github?.labels?.project
  if (configured) labels.push(configured)
  else if (project?.id) labels.push(`project::${project.id.toLowerCase()}`)
  if (asset?.extra?.priority) labels.push(`priority::${asset.extra.priority}`)
  return labels
}

/** Requirement issue body: the brief is the human narrative, links are traceability. */
export function requirementIssueBody(asset, { root, project }) {
  const briefPath = asset?.extra?.brief ? join(root, asset.extra.brief) : null
  const brief = briefPath && existsSync(briefPath) ? readFileSync(briefPath, 'utf8').trim() : ''
  const acceptance = (asset?.links ?? []).filter((link) => link.type === 'verified_by').map((link) => link.target)
  return [
    `## ${asset?.title ?? asset?.id ?? ''}`,
    '',
    `- 需求：\`${asset?.id ?? '—'}\``,
    `- 项目：${project?.id ?? '—'}`,
    `- 状态：${asset?.status ?? 'proposed'}`,
    `- 负责人：${asset?.owner ?? '—'}`,
    ...(asset?.extra?.priority ? [`- 优先级：${asset.extra.priority}`] : []),
    ...(asset?.extra?.version ? [`- 版本：${asset.extra.version}`] : []),
    ...(asset?.extra?.brief ? [`- 简报：\`${asset.extra.brief}\``] : []),
    '',
    '## 背景',
    '',
    brief ? brief.split('\n').slice(0, 40).join('\n') : '（见仓库需求文件）',
    '',
    '## 验收',
    '',
    ...(acceptance.length ? acceptance.map((id) => `- ${id}`) : ['- （待补充）']),
    '',
    '<!-- 由 alm 需求入库自动创建；需求正文以仓库 .sdoc 为准 -->',
  ].join('\n')
}

/**
 * Create one GitHub Issue per requirement, add it to the project's ProjectV2
 * board, and record the mapping in `.alm/github.json`. Dry-run prints bodies
 * without touching GitHub.
 */
export async function syncRequirementIssues({
  root,
  changeId,
  apply = false,
  project,
  createProvider,
  labels,
}) {
  const draftPath = join(root, 'changes', changeId, 'tasks.json')
  if (!existsSync(draftPath)) {
    throw new RequirementSyncError(`task draft not found: changes/${changeId}/tasks.json`, { code: 'no-draft' })
  }
  const draft = JSON.parse(readFileSync(draftPath, 'utf8'))
  const ids = [...new Set(draft.requirements ?? [])]
  if (ids.length === 0) return { schema: 'alm.requirements.sync/v1', changeId, applied: apply, actions: [], mapping: readMapping(root) }

  const index = indexReport(root)
  if (index && index.ok === false) throw new RequirementSyncError(index.error, { code: 'index-failed' })

  if (apply && !project) throw new RequirementSyncError('project is required to create requirement issues', { code: 'no-project' })
  const adapter = createProvider
    ? createProvider()
    : apply
      ? githubProvider({
          repo: `${project.github.owner}/${project.github.repo}`,
          owner: project.github.owner,
          projectNumber: project.github.project?.number,
          labels: [],
        })
      : null

  const mapping = readMapping(root)
  if (project?.github?.repo) mapping.repo = `${project.github.owner}/${project.github.repo}`
  const actions = []

  for (const id of ids) {
    if (mapping.requirements[id]?.number) {
      actions.push({ requirement: id, action: 'skip', issue: mapping.requirements[id] })
      continue
    }

    const asset = index.assets.find((entry) => entry.id === id)
    const title = `[${id}] ${asset?.title ?? id}`
    const body = requirementIssueBody(asset, { root, project })
    const issueLabels = labels ?? requirementLabels(project, asset)

    if (!apply) {
      actions.push({ requirement: id, action: 'create', title, body, labels: issueLabels })
      continue
    }

    const existing = adapter.find(title)
    if (existing) {
      mapping.requirements[id] = { provider: adapter.name, number: existing.number, url: existing.url }
      writeMapping(root, mapping)
      if (project?.github?.project?.number) adapter.addToProject(existing.url, project.github.project.number)
      actions.push({ requirement: id, action: 'adopt', issue: mapping.requirements[id], title })
      continue
    }

    const created = adapter.create({ title, body, labels: issueLabels })
    mapping.requirements[id] = { provider: adapter.name, number: created.number, url: created.url }
    writeMapping(root, mapping)
    if (project?.github?.project?.number) {
      adapter.addToProject(created.url, project.github.project.number)
      const ready = project.github.project.status?.ready
      if (ready && adapter.setStatus) {
        try {
          adapter.setStatus(created.url, ready, project.github.project.number)
        } catch {
          // a board status failure must not lose the created issue
        }
      }
    }
    actions.push({ requirement: id, action: 'created', issue: mapping.requirements[id], title })
  }

  return {
    schema: 'alm.requirements.sync/v1',
    changeId,
    applied: apply,
    actions,
    mapping,
  }
}
