import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

export const ARCHITECTURE_DIR = 'requirements/architecture'

const normalizePath = value => String(value ?? '').replaceAll('\\', '/').replace(/^\.\//, '').trim()
const unique = values => [...new Set(values.map(normalizePath).filter(Boolean))]
const sha256 = value => createHash('sha256').update(value).digest('hex')

function text(value) { return typeof value === 'string' ? value.trim() : '' }

function cleanInline(value) {
  return text(value)
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
}

/** Parse the delivery record into a deliberately small view model for the UI. */
export function parseArchitectureLedger(markdown, { path = null } = {}) {
  const sections = new Map()
  let current = null
  for (const raw of String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const heading = /^##\s+(.+?)\s*$/.exec(raw)
    if (heading) { current = cleanInline(heading[1]); sections.set(current, []); continue }
    if (current && /^\s*-\s+/.test(raw)) sections.get(current).push(cleanInline(raw.replace(/^\s*-\s+/, '')))
  }
  const baseline = sections.get('需求与版本基线') ?? []
  const modules = (sections.get('架构与模块变更') ?? []).map((entry) => {
    const match = /^(.+?)：(.+)$/.exec(entry)
    return match ? { path: match[1], role: match[2] } : { path: entry, role: null }
  })
  return {
    path: normalizePath(path),
    title: cleanInline(String(markdown ?? '').match(/^#\s+(.+?)\s*$/m)?.[1] ?? '架构与数据模型交付档案'),
    baseline,
    modules,
    contracts: sections.get('数据模型与接口契约') ?? [],
    verification: sections.get('验证与证据摘要') ?? [],
  }
}

/** Read only the conventional, requirement-scoped ledger file. */
export function readArchitectureLedger({ root, requirementId, path = null } = {}) {
  const relativeFile = normalizePath(path || `${ARCHITECTURE_DIR}/${requirementId}-design.md`)
  const expected = `${ARCHITECTURE_DIR}/${requirementId}-design.md`
  if (!requirementId || relativeFile !== expected) return null
  const file = join(resolve(root), relativeFile)
  if (!existsSync(file)) return null
  try { return parseArchitectureLedger(readFileSync(file, 'utf8'), { path: relativeFile }) } catch { return null }
}

function criteriaOf(requirement, asset) {
  const fromDoc = asset?.doc?.acceptance ?? requirement?.doc?.acceptance ?? []
  if (Array.isArray(fromDoc) && fromDoc.length) return fromDoc.map((entry, index) => ({ id: entry?.id ?? `AC-${String(index + 1).padStart(2, '0')}`, text: text(entry?.text ?? entry?.expected) })).filter(entry => entry.text)
  return String(requirement?.briefText ?? '').split(/\r?\n/).flatMap((line, index) => {
    const match = /^\s*[-*]?\s*(AC-\d+)\s*[:：.、\s-]*(.+?)\s*$/.exec(line)
    return match ? [{ id: match[1], text: match[2] }] : []
  })
}

function moduleRole(path) {
  if (/^packages\/alm-core\//.test(path)) return '需求领域模型、验证与交付状态'
  if (/^packages\/dsh-plugin-/.test(path)) return 'DSH 插件接口与用户视图'
  if (/(?:^|\/)(?:test|tests)\//.test(path)) return '专项自动化验证'
  if (/^requirements\//.test(path)) return '需求规格与工程资产'
  return '本需求交付涉及的实现模块'
}

function schemaRole(path) {
  if (/\.alm\//.test(path)) return 'ALM 运行证据与交付记录（兼容既有 JSON 账本）'
  if (/(?:schema|model|contract|\.json$)/i.test(path)) return '数据结构或接口契约定义（保持向后兼容）'
  return null
}

/** Persist a human-readable delivery record; no hidden AI rationale is stored. */
export function writeArchitectureLedger({ root, asset, requirement = null, acceptance = null, implementationPaths = [] } = {}) {
  const repo = resolve(root)
  const requirementId = text(requirement?.id ?? asset?.id)
  if (!requirementId) throw new Error('requirement id is required for architecture ledger')
  const revision = Number(requirement?.revision ?? asset?.extra?.revision ?? 1) || 1
  const title = text(requirement?.title ?? asset?.title) || requirementId
  const goal = text(requirement?.doc?.goal ?? asset?.doc?.goal) || text(String(requirement?.briefText ?? '').match(/^##\s*目标\s*\n+([^#]+)/m)?.[1]) || '按已确认需求完成交付'
  const criteria = criteriaOf(requirement, asset)
  const relativeFile = `${ARCHITECTURE_DIR}/${requirementId}-design.md`
  const file = join(repo, relativeFile)
  const existingBody = existsSync(file) ? readFileSync(file, 'utf8') : null
  const previousModules = (existingBody ? parseArchitectureLedger(existingBody, { path: relativeFile }).modules : [])
    .map(entry => entry.path)
  // A post-commit re-verification runs on a clean worktree: an empty diff must
  // not erase the module list that was archived in the delivery commit.
  const declaredPaths = unique([
    asset?.source?.path,
    asset?.extra?.brief,
    ...(implementationPaths ?? []),
  ])
  const paths = implementationPaths === null && previousModules.length ? previousModules : declaredPaths
  const modules = paths.filter(path => !path.startsWith('.alm/'))
  const schemas = paths.map(schemaRole).filter(Boolean)
  const evidence = acceptance?.latest ?? null
  mkdirSync(join(repo, ARCHITECTURE_DIR), { recursive: true })
  const body = [
    `# ${requirementId} 架构与数据模型交付档案`,
    '',
    '## 需求与版本基线',
    `- 需求：${requirementId} · v${revision} · ${title}`,
    `- 核心业务目标：${goal.replace(/\s+/g, ' ')}`,
    '',
    '## 架构与模块变更',
    ...(modules.length ? modules.map(path => `- \`${path}\`：${moduleRole(path)}`) : ['- 未记录到可归属的代码模块；本次档案保留需求与验证基线。']),
    '',
    '调用关系：需求规格与验收标准 → 领域实现与插件交互 → 定向验证证据 → 交付候选。',
    '',
    '## 数据模型与接口契约',
    ...(schemas.length ? [...new Set(schemas)].map(item => `- ${item}`) : ['- 本次未检测到独立 Schema 迁移；沿用现有数据与接口契约。']),
    '- 运行态证据、候选和签收仍存放于 `.alm/`，不改变既有读取兼容性。',
    '',
    '## 验证与证据摘要',
    ...(criteria.length ? criteria.map(entry => `- ${entry.id}：${entry.text}`) : ['- 未解析到结构化验收标准。']),
    // The Candidate JSON binds the exact evidence file and hash. Keeping that
    // volatile SHA-derived path out of the repository asset prevents a fresh
    // verification from creating a new Git commit and invalidating itself.
    `- 最近验证：${evidence?.result === 'pass' ? '通过' : evidence?.result ?? '未执行'}`,
    ...(Array.isArray(evidence?.commands) ? evidence.commands.filter(entry => entry?.exitCode === 0).map(entry => `- 通过命令：\`${(entry.command ?? []).join(' ')}\``) : []),
    '',
  ].join('\n')
  // "Architecture changed" is a comparison against the last archived module
  // list, not against the acceptance command. This is what decides whether the
  // delivery has to carry a refreshed architecture record to the repository.
  const changed = !existingBody || previousModules.length !== modules.length ||
    modules.some(path => !previousModules.includes(path)) || previousModules.some(path => !modules.includes(path))
  if (existingBody !== body) writeFileSync(file, body, 'utf8')

  const indexPath = join(repo, ARCHITECTURE_DIR, 'ARCHITECTURE-LEDGER.md')
  const row = `| ${requirementId} | v${revision} | [${title}](${requirementId}-design.md) |`
  const heading = '# 架构与数据模型交付档案索引\n\n| 需求 | 版本 | 交付档案 |\n| --- | --- | --- |\n'
  const existing = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : heading
  const rows = existing.split(/\r?\n/).filter(line => !line.startsWith(`| ${requirementId} |`))
  if (!rows.some(line => line.startsWith('| ---'))) rows.splice(3, 0, '| --- | --- | --- |')
  while (rows.at(-1) === '') rows.pop()
  rows.push(row)
  const index = `${rows.join('\n')}\n`
  const existingIndex = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : null
  if (existingIndex !== index) writeFileSync(indexPath, index, 'utf8')
  return {
    path: relativeFile,
    indexPath: `${ARCHITECTURE_DIR}/ARCHITECTURE-LEDGER.md`,
    hash: sha256(body),
    implementationPaths: paths,
    changed,
    changedModules: changed ? modules : [],
  }
}
