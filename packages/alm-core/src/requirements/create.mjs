import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { checkReport, indexReport } from '../commands.mjs'
import { readProject } from '../project/project.mjs'

const ID = /^REQ-[A-Z0-9]{2,8}-\d{3}$/
const PRIORITIES = new Set(['P0', 'P1', 'P2'])

export class RequirementCreateError extends Error {
  constructor(message, { code = 'requirement-create', status = 400 } = {}) {
    super(message)
    this.name = 'RequirementCreateError'
    this.code = code
    this.status = status
  }
}

/** Next `REQ-<PROJECT>-NNN` derived from the indexed requirement ids. */
export function nextRequirementId({ root, projectId }) {
  const prefix = `REQ-${projectId}-`
  let max = 0
  const index = indexReport(resolve(root))
  for (const asset of index?.assets ?? []) {
    if (!asset.id.startsWith(prefix)) continue
    const value = Number(asset.id.slice(prefix.length))
    if (Number.isInteger(value)) max = Math.max(max, value)
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`
}

function sdocContent({ id, title, owner, project, priority, briefFile }) {
  return [
    '[DOCUMENT]',
    `TITLE: ${title}`,
    '',
    '[SECTION]',
    'TITLE: 背景',
    '',
    '[REQUIREMENT]',
    `UID: ${id}`,
    `TITLE: ${title}`,
    'STATUS: proposed',
    `OWNER: ${owner}`,
    `PROJECT: ${project}`,
    `PRIORITY: ${priority}`,
    'CATEGORY: functional',
    'REVISION: 1',
    `BRIEF: ${briefFile}`,
    'SOURCE: chat',
    '',
  ].join('\n')
}

function briefMarkdown({ id, title, brief, goal }) {
  return [
    `# ${id} ${title}`,
    '',
    '## 背景',
    '',
    brief || '（待补充背景）',
    '',
    '## 目标',
    '',
    goal || brief || '（待补充目标）',
    '',
  ].join('\n')
}

/**
 * Plan a new requirement: id, files and file content. Planning never writes.
 * The requirement is created as `proposed`; gates will keep reporting COV-001
 * until acceptance assets are added, which is the normal draft state.
 */
export function planRequirement({ root, title, brief = '', goal = '', priority = 'P1', owner, project, id, apply = false }) {
  const repo = resolve(root)
  const cleanTitle = String(title ?? '').trim()
  if (cleanTitle === '') throw new RequirementCreateError('title is required', { code: 'title-required' })
  if (cleanTitle.length > 200) throw new RequirementCreateError('title is too long (max 200)', { code: 'title-too-long' })
  if (!PRIORITIES.has(priority)) throw new RequirementCreateError(`invalid priority: ${priority}`, { code: 'invalid-priority' })

  const projectFile = readProject(repo)
  const projectId = project ?? projectFile?.id
  if (!projectId) throw new RequirementCreateError('no project: pass project or add .alm/project.json', { code: 'no-project' })

  const requirementId = id ?? nextRequirementId({ root: repo, projectId })
  if (!ID.test(requirementId)) throw new RequirementCreateError(`invalid requirement id: ${requirementId}`, { code: 'invalid-id' })
  if (requirementId.split('-')[1] !== projectId) {
    throw new RequirementCreateError(`requirement id ${requirementId} does not match project ${projectId}`, { code: 'project-mismatch' })
  }

  const slug = requirementId.toLowerCase()
  const file = `requirements/${slug}.sdoc`
  const briefFile = `requirements/briefs/${requirementId}.md`
  if (existsSync(join(repo, file)) || existsSync(join(repo, briefFile))) {
    throw new RequirementCreateError(`requirement already exists: ${requirementId}`, { code: 'already-exists', status: 409 })
  }

  const ownerId = String(owner ?? '').trim() || projectFile?.teams?.[0] || 'team-pay'
  return {
    schema: 'alm.requirement.plan/v1',
    requirementId,
    project: projectId,
    title: cleanTitle,
    priority,
    owner: ownerId,
    file,
    briefFile,
    content: sdocContent({ id: requirementId, title: cleanTitle, owner: ownerId, project: projectId, priority, briefFile }),
    briefContent: briefMarkdown({ id: requirementId, title: cleanTitle, brief, goal }),
    applied: false,
  }
}

/** Write a planned requirement (sdoc + brief). The check result is reported, not enforced. */
export function createRequirement({ root, ...input }) {
  const repo = resolve(root)
  const plan = planRequirement({ root: repo, ...input })
  if (input.apply !== true) return plan

  mkdirSync(join(repo, 'requirements', 'briefs'), { recursive: true })
  writeFileSync(join(repo, plan.file), plan.content, 'utf8')
  writeFileSync(join(repo, plan.briefFile), plan.briefContent, 'utf8')

  const check = checkReport(repo)
  const gaps = (check.checks ?? [])
    .filter((entry) => entry.id === 'COV-001' || entry.id === 'COV-002')
    .flatMap((entry) => entry.findings ?? [])
    .filter((finding) => finding.assetId === plan.requirementId || finding.file === plan.file)

  return {
    ...plan,
    applied: true,
    check: { result: check.result ?? 'fail', gaps: gaps.length },
  }
}
