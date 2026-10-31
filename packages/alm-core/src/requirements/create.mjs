import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
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
export function planRequirement({ root, title, brief = '', goal = '', priority = 'P1', owner, project, id, attachments = [], apply = false }) {
  const repo = resolve(root)
  const cleanTitle = String(title ?? '').trim()
  if (cleanTitle === '') throw new RequirementCreateError('title is required', { code: 'title-required' })
  // User material and AI output are untrusted: a newline in a single-line sdoc
  // field could inject a field or a [RELATION] block into the file.
  if (/[\u0000-\u001F\u007F]/.test(cleanTitle)) {
    throw new RequirementCreateError('title must not contain control characters or newlines', { code: 'invalid-title' })
  }
  if (cleanTitle.length > 200) throw new RequirementCreateError('title is too long (max 200)', { code: 'title-too-long' })
  if (!PRIORITIES.has(priority)) throw new RequirementCreateError(`invalid priority: ${priority}`, { code: 'invalid-priority' })
  const cleanOwner = owner === undefined || owner === null ? '' : String(owner).trim()
  if (/[\u0000-\u001F\u007F]/.test(cleanOwner)) {
    throw new RequirementCreateError('owner must not contain control characters or newlines', { code: 'invalid-owner' })
  }
  if (cleanOwner.length > 120) throw new RequirementCreateError('owner is too long (max 120)', { code: 'owner-too-long' })

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

  const ownerId = cleanOwner || projectFile?.teams?.[0] || 'team-pay'
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
    attachmentCount: Array.isArray(attachments) ? attachments.length : 0,
    attachmentNames: Array.isArray(attachments) ? attachments.map((entry) => String(entry?.name ?? '')).filter(Boolean) : [],
    applied: false,
  }
}

const ATTACHMENT_NAME = /^[A-Za-z0-9._-]{1,120}$/

function writeAttachments({ repo, requirementId, attachments }) {
  if (!Array.isArray(attachments) || attachments.length === 0) return []
  const dir = join(repo, 'requirements', 'attachments', requirementId)
  mkdirSync(dir, { recursive: true })
  const files = []
  for (const entry of attachments) {
    const name = String(entry?.name ?? '').trim()
    if (!ATTACHMENT_NAME.test(name)) {
      throw new RequirementCreateError(`invalid attachment name: ${name}`, { code: 'invalid-attachment' })
    }
    let bytes
    if (entry.dataBase64) bytes = Buffer.from(String(entry.dataBase64), 'base64')
    else if (typeof entry.text === 'string') bytes = Buffer.from(entry.text, 'utf8')
    else throw new RequirementCreateError(`attachment ${name} needs dataBase64 or text`, { code: 'invalid-attachment' })
    writeFileSync(join(dir, name), bytes)
    files.push({
      path: name,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      kind: entry.kind ?? 'attachment',
      capturedAt: new Date().toISOString(),
      addedBy: entry.addedBy ?? 'human:local',
    })
  }
  files.sort((left, right) => left.path.localeCompare(right.path))
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify({ requirement: requirementId, files }, null, 2)}
`, 'utf8')
  return files
}

/** Write a planned requirement (sdoc + brief + attachments). The check result is reported, not enforced. */
export function createRequirement({ root, ...input }) {
  const repo = resolve(root)
  const plan = planRequirement({ root: repo, ...input })
  if (input.apply !== true) return plan

  mkdirSync(join(repo, 'requirements', 'briefs'), { recursive: true })
  const sdocFile = join(repo, plan.file)
  const briefFile = join(repo, plan.briefFile)
  let attachmentFiles = []
  try {
    writeFileSync(sdocFile, plan.content, 'utf8')
    writeFileSync(briefFile, plan.briefContent, 'utf8')
    attachmentFiles = writeAttachments({ repo, requirementId: plan.requirementId, attachments: input.attachments })
  } catch (error) {
    rmSync(sdocFile, { force: true })
    rmSync(briefFile, { force: true })
    rmSync(join(repo, 'requirements', 'attachments', plan.requirementId), { recursive: true, force: true })
    throw error
  }

  const check = checkReport(repo)
  const gaps = (check.checks ?? [])
    .filter((entry) => entry.id === 'COV-001' || entry.id === 'COV-002')
    .flatMap((entry) => entry.findings ?? [])
    .filter((finding) => finding.assetId === plan.requirementId || finding.file === plan.file)

  return {
    ...plan,
    applied: true,
    check: { result: check.result ?? 'fail', gaps: gaps.length },
    attachments: attachmentFiles,
  }
}
