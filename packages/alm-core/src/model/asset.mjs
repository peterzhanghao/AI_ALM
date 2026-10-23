export const ASSET_TYPES = [
  'requirement',
  'architecture-decision',
  'module',
  'interface',
  'data-model',
  'acceptance-test',
  'risk',
]

export const ASSET_STATUSES = ['proposed', 'accepted', 'deprecated', 'superseded']

export const LINK_TYPES = [
  'satisfies',
  'allocated_to',
  'depends_on',
  'constrained_by',
  'verified_by',
  'supersedes',
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
