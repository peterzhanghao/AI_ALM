import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { checkReport, indexReport } from '../commands.mjs'
import { readProject } from '../project/project.mjs'
import { DOC_SCHEMA, docHashOf, normalizeDoc, parseDoc, renderDoc } from './doc.mjs'
import { initializeRequirementsExchange } from './exchange.mjs'

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

// lstat also treats dangling symlinks as occupied; unreadable paths fail closed.
function requirementPathsOccupied(root, id) {
  return [
    `requirements/${id.toLowerCase()}.sdoc`,
    `requirements/briefs/${id}.md`,
    `requirements/attachments/${id}`,
  ].some((path) => {
    try {
      lstatSync(join(root, path))
      return true
    } catch (error) {
      if (error.code === 'ENOENT') return false
      throw error
    }
  })
}

/** Next indexed sequence, skipping occupied canonical artifact paths without writing. */
export function nextRequirementId({ root, projectId }) {
  const prefix = `REQ-${projectId}-`
  let max = 0
  const index = indexReport(resolve(root))
  for (const asset of index?.assets ?? []) {
    if (!asset.id.startsWith(prefix)) continue
    const value = Number(asset.id.slice(prefix.length))
    if (Number.isInteger(value)) max = Math.max(max, value)
  }
  let candidate
  do {
    candidate = `${prefix}${String(++max).padStart(3, '0')}`
  } while (requirementPathsOccupied(root, candidate))
  return candidate
}

function sdocContent({ id, title, owner, project, priority, briefFile, source = '' }) {
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
    // No STATUS: the delivery lifecycle is derived from candidate + evidence, so
    // a new record does not store a status at all (see requirements/delivery.mjs).
    `OWNER: ${owner}`,
    `PROJECT: ${project}`,
    `PRIORITY: ${priority}`,
    'CATEGORY: functional',
    'REVISION: 1',
    `BRIEF: ${briefFile}`,
    // SOURCE is a single-valued sdoc field: a defect-created requirement is
    // distinguishable from a chat proposal without adding a second SOURCE line.
    `SOURCE: ${source || 'chat'}`,
    '',
  ].join('\n')
}

function safeBriefText(value, max) {
  const text = String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text
}

function feedbackSourceSection(feedback) {
  const lines = [
    '## 反馈来源',
    '',
    '本需求由需求插件的人工反馈生成，只包含用户原话与冻结上下文事实，不含 AI 结论，也不表示优先级/方案已确认。',
    '',
  ]
  const meta = feedback !== null && typeof feedback === 'object' ? feedback : null
  if (!meta) return lines
  const facts = []
  const id = safeBriefText(meta.id ?? meta.feedbackId, 40)
  if (id !== '') facts.push(`- 反馈 ID：${id}`)
  const category = safeBriefText(meta.category, 40)
  if (category !== '') facts.push(`- 类别：${category}`)
  const conversion = safeBriefText(meta.conversionId, 60)
  if (conversion !== '') facts.push(`- 转化 ID：${conversion}`)
  // Only project/workspace names may be rendered; the absolute root is local
  // routing data and must never leak into a requirement brief.
  const observed = meta.observedWorkspace
  if (observed !== null && typeof observed === 'object') {
    const project = safeBriefText(observed.projectId, 40)
    const workspace = safeBriefText(observed.workspaceId, 80)
    if (project !== '') facts.push(`- 观察工作区：${project}`)
    else if (workspace !== '') facts.push(`- 观察工作区：${workspace}`)
  }
  const component = safeBriefText(meta.targetComponent ?? meta.targetProduct?.component, 40)
  if (component !== '') facts.push(`- 目标组件：${component}`)
  if (facts.length > 0) lines.push(...facts, '')
  return lines
}

const META_TAIL = /\n*<!--\s*alm:meta[\s\S]*?-->\s*$/
const AUTO_TITLE_LIMIT = 28

function conciseTitle(value) {
  const raw = String(value ?? '').replace(/\s+/g, ' ').trim()
  if (raw.length <= AUTO_TITLE_LIMIT) return raw
  const firstClause = raw.split(/[。！？；;\n]/)[0]?.trim() || raw
  const preferred = firstClause.length > AUTO_TITLE_LIMIT ? firstClause.slice(0, AUTO_TITLE_LIMIT) : firstClause
  return `${preferred.replace(/[，,、\s]+$/, '')}…`
}

function rawInputSection(value) {
  const text = String(value ?? '').trim()
  return text === '' ? null : `## 用户原话\n\n${text}`
}

/**
 * Split legacy free-form brief text into a canonical document plus the sections
 * the schema cannot represent (unknown headings, appendix blocks). Nothing is
 * discarded: unparsed sections are appended verbatim after the canonical body.
 */
function legacyBriefDocument({ id, title, brief, goal }) {
  const parsed = parseDoc(`# ${id} ${title}\n\n${brief || '（待补充背景）'}`)
  const doc = parsed.doc
  const extras = Array.isArray(parsed.unparsed) ? [...parsed.unparsed] : []
  if (doc.problem === '') {
    const index = extras.findIndex((entry) => entry.title === '（未命名段落）')
    if (index >= 0) {
      doc.problem = String(extras[index].text ?? '').trim()
      extras.splice(index, 1)
    }
  }
  if (doc.goal === '' && goal) doc.goal = String(goal)
  return { doc, extras }
}

function unparsedBlocks(extras) {
  const blocks = []
  for (const entry of extras ?? []) {
    const heading = String(entry?.title ?? '').trim()
    const text = String(entry?.text ?? '').trimEnd()
    if (heading !== '' && heading !== '（未命名段落）') blocks.push(`## ${heading}\n\n${text}`.trimEnd())
    else if (text !== '') blocks.push(text)
  }
  return blocks
}

/**
 * Render a canonical brief. A `doc` (human-edited intent draft) is rendered
 * directly; a legacy free-form `brief` is parsed first so old callers keep
 * every clause. Appendix sections (defect/feedback provenance) are appended
 * after the canonical body, before the single `alm:meta` line.
 */
function briefMarkdown({ id, title, brief, goal, doc = null, confirmedAt = null, source = '', feedback = null, originalInput = null }) {
  let normalized
  let extras = []
  if (doc && typeof doc === 'object' && !Array.isArray(doc)) {
    normalized = normalizeDoc({
      ...doc,
      schema: DOC_SCHEMA,
      requirementId: id,
      title: doc.title || title,
      revision: doc.revision ?? 1,
    }, {})
  } else {
    const legacy = legacyBriefDocument({ id, title, brief, goal })
    normalized = normalizeDoc(legacy.doc, {})
    extras = legacy.extras
  }
  const blocks = unparsedBlocks(extras)
  const rawSection = rawInputSection(originalInput)
  if (rawSection) blocks.push(rawSection)
  if (source === 'defect') {
    blocks.push('## 缺陷来源\n\n本需求由失败监控自动创建，经人工确认后进入修复迭代。')
  }
  if (source === 'feedback') {
    const section = feedbackSourceSection(feedback).join('\n').trim()
    if (section !== '') blocks.push(section)
  }
  const body = renderDoc(normalized).replace(META_TAIL, '').trimEnd()
  const withExtras = blocks.length > 0 ? `${body}\n\n${blocks.join('\n\n')}` : body
  const docHash = docHashOf(withExtras)
  const meta = {
    nextFr: normalized.meta?.nextFr ?? 1,
    nextAc: normalized.meta?.nextAc ?? 1,
    confirmedAt: confirmedAt ?? normalized.meta?.confirmedAt ?? null,
    docHash,
  }
  return {
    markdown: `${withExtras}\n\n<!-- alm:meta ${JSON.stringify(meta)} -->\n`,
    doc: normalized,
    docHash,
  }
}

/**
 * Plan a new requirement: id, files and file content. Planning never writes.
 * The requirement is created as `proposed`; gates will keep reporting COV-001
 * until acceptance assets are added, which is the normal draft state.
 */
export function planRequirement({ root, title, brief = '', goal = '', priority = 'P1', owner, project, id, attachments = [], source = '', feedback = null, doc = null, confirmedAt = null, originalInput = null, titleWasManuallyEdited = false, apply = false }) {
  const repo = resolve(root)
  const rawTitle = String(title ?? '').trim()
  // Validate before distillation so a newline cannot be hidden by a short title.
  if (/[\u0000-\u001F\u007F]/.test(rawTitle)) {
    throw new RequirementCreateError('title must not contain control characters or newlines', { code: 'invalid-title' })
  }
  const cleanTitle = titleWasManuallyEdited ? rawTitle : conciseTitle(rawTitle)
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
  // `source` selects the sdoc SOURCE value and the brief's 缺陷来源 section; the
  // default stays `chat` so a plan without source is byte-identical to before.
  const cleanSource = source === undefined || source === null ? '' : String(source).trim()
  if (/[\u0000-\u001F\u007F]/.test(cleanSource)) {
    throw new RequirementCreateError('source must not contain control characters or newlines', { code: 'invalid-source' })
  }
  if (cleanSource.length > 40) throw new RequirementCreateError('source is too long (max 40)', { code: 'source-too-long' })

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
  if (requirementPathsOccupied(repo, requirementId)
    || (id !== undefined && (indexReport(repo)?.assets ?? []).some((asset) => asset.id === requirementId))) {
    throw new RequirementCreateError(`requirement already exists: ${requirementId}`, { code: 'already-exists', status: 409 })
  }

  const ownerId = owner === undefined || owner === null ? projectFile?.teams?.[0] || 'team-pay' : cleanOwner
  const briefPlan = briefMarkdown({
    id: requirementId,
    title: cleanTitle,
    brief,
    goal,
    doc,
    confirmedAt,
    source: cleanSource,
    feedback,
    originalInput: originalInput ?? (rawTitle.length > AUTO_TITLE_LIMIT ? rawTitle : null),
  })
  return {
    schema: 'alm.requirement.plan/v1',
    requirementId,
    project: projectId,
    title: cleanTitle,
    priority,
    source: cleanSource || 'chat',
    owner: ownerId,
    file,
    briefFile,
    content: sdocContent({ id: requirementId, title: cleanTitle, owner: ownerId, project: projectId, priority, briefFile, source: cleanSource }),
    briefContent: briefPlan.markdown,
    doc: briefPlan.doc,
    docHash: briefPlan.docHash,
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

  // Explicit create is a mutating project operation; provision durable exchange
  // provenance here, never as a side effect of read-only export or preview.
  if (existsSync(join(repo, '.alm/project.json'))) initializeRequirementsExchange({ root: repo })

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
