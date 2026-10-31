export const ASSET_TYPES = [
  'requirement',
  'architecture-decision',
  'module',
  'interface',
  'data-model',
  'acceptance-test',
  'risk',
]

export const ASSET_STATUSES = [
  'proposed',
  'accepted',
  'in-progress',
  'implemented',
  'verified',
  'deprecated',
  'superseded',
]

/** Display labels. Assets store the stable English enum; UI and reports show Chinese. */
export const STATUS_LABELS = {
  proposed: '待评审',
  accepted: '已采纳',
  'in-progress': '开发中',
  implemented: '已实现',
  verified: '已验收',
  deprecated: '已废弃',
  superseded: '已替代',
}

export const STATUS_ALIASES = Object.fromEntries(Object.entries(STATUS_LABELS).map(([key, label]) => [label, key]))

export const PRIORITIES = ['P0', 'P1', 'P2', 'P3']
export const CATEGORIES = ['functional', 'non-functional', 'constraint', 'quality']
export const SOURCE_KINDS = ['chat', 'meeting', 'doc', 'screenshot', 'email']

export const LINK_TYPES = [
  'satisfies',
  'allocated_to',
  'depends_on',
  'constrained_by',
  'verified_by',
  'supersedes',
  'parent_of',
]

const TYPE_PREFIX = {
  requirement: 'REQ',
  'architecture-decision': 'ADR',
  module: 'MOD',
  interface: 'IF',
  'data-model': 'DM',
  'acceptance-test': 'TEST',
  risk: 'RISK',
}

export { TYPE_PREFIX }

export const ID_PATTERN = /^(REQ|ADR|MOD|IF|DM|TEST|RISK)-[A-Z0-9]+(-[A-Z0-9]+)*$/

/**
 * Optional human-facing business id (e.g. JIRA-1234). It is only a label: the
 * stable internal key is still `id`, and relations keep targeting `id`.
 */
export const BUSINESS_ID_PATTERN = /^[A-Za-z0-9._/-]{1,64}$/

export class AssetError extends Error {
  constructor(message, { rule = 'FMT-002', file, line = 1 } = {}) {
    super(message)
    this.name = 'AssetError'
    this.rule = rule
    this.file = file
    this.line = line
  }
}

function requireString(raw, key, where) {
  if (typeof raw[key] !== 'string' || raw[key].trim() === '') {
    throw new AssetError(`missing or invalid field: ${key}`, where)
  }
  return raw[key]
}

/**
 * Normalize one parsed source document into the shared Asset shape.
 * Throws AssetError with a rule id, file and line so gates can report it.
 */
export function normalizeAsset(raw, source) {
  const where = { file: source.path, line: source.line ?? 1 }

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new AssetError('asset must be a mapping', { ...where, rule: 'FMT-001' })
  }

  const id = requireString(raw, 'id', where)
  const type = requireString(raw, 'type', where)
  const title = requireString(raw, 'title', where)
  const status = requireString(raw, 'status', where)
  const owner = requireString(raw, 'owner', where)

  if (raw.schema_version !== undefined && raw.schema_version !== 1) {
    throw new AssetError(`unsupported schema_version: ${String(raw.schema_version)}`, where)
  }
  if (!ASSET_TYPES.includes(type)) throw new AssetError(`unknown asset type: ${type}`, where)
  if (!ID_PATTERN.test(id)) throw new AssetError(`invalid asset id: ${id}`, where)
  if (!ASSET_STATUSES.includes(status)) throw new AssetError(`unknown status: ${status}`, where)
  if (raw.project !== undefined && !/^[A-Z][A-Z0-9]{1,7}$/.test(String(raw.project))) {
    throw new AssetError(`invalid project id: ${String(raw.project)}`, where)
  }
  if (raw.businessId !== undefined) {
    if (typeof raw.businessId !== 'string' || !BUSINESS_ID_PATTERN.test(raw.businessId)) {
      throw new AssetError(`invalid businessId: ${String(raw.businessId)}`, where)
    }
  }

  if (raw.revision !== undefined) {
    if (!Number.isInteger(raw.revision) || raw.revision < 1) {
      throw new AssetError('revision must be a positive integer', where)
    }
  }
  if (raw.priority !== undefined && !PRIORITIES.includes(raw.priority)) {
    throw new AssetError(`unknown priority: ${String(raw.priority)}`, where)
  }
  if (raw.category !== undefined && !CATEGORIES.includes(raw.category)) {
    throw new AssetError(`unknown category: ${String(raw.category)}`, where)
  }
  if (raw.brief !== undefined && (typeof raw.brief !== 'string' || raw.brief.trim() === '')) {
    throw new AssetError('brief must be a non-empty path', where)
  }
  if (raw.sources !== undefined) {
    if (!Array.isArray(raw.sources) || raw.sources.some((source) => typeof source !== 'string' || !SOURCE_KINDS.includes(source))) {
      throw new AssetError(`sources must be among ${SOURCE_KINDS.join(', ')}`, where)
    }
  }

  const rawLinks = raw.links === undefined ? [] : raw.links
  if (!Array.isArray(rawLinks)) throw new AssetError('links must be an array', where)

  const links = rawLinks.map((link, i) => {
    if (link === null || typeof link !== 'object' || Array.isArray(link)) {
      throw new AssetError(`links[${i}] must be a mapping`, where)
    }
    if (!LINK_TYPES.includes(link.type)) {
      throw new AssetError(`unknown link type: ${String(link.type)}`, where)
    }
    if (typeof link.target !== 'string' || !ID_PATTERN.test(link.target)) {
      throw new AssetError(`invalid link target: ${String(link.target)}`, where)
    }
    return { type: link.type, target: link.target }
  })

  const reserved = new Set(['schema_version', 'id', 'type', 'title', 'status', 'owner', 'links'])
  const extra = Object.fromEntries(Object.entries(raw).filter(([key]) => !reserved.has(key)))

  return {
    id,
    type,
    title,
    status,
    owner,
    links,
    source: { path: source.path, format: source.format ?? 'yaml', line: source.line ?? 1 },
    extra,
  }
}
