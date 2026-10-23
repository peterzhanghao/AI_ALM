import { AssetError, normalizeAsset } from '../model/asset.mjs'

const NODE_RE = /^\[([A-Z][A-Z0-9_-]*)\]\s*$/
const FIELD_RE = /^([A-Za-z][A-Za-z0-9_]*)\s*:\s*(.*)$/
const FIELD_KEYS = new Set(['UID', 'TITLE', 'STATUS', 'OWNER'])

/** Infer the asset type from the StrictDoc UID prefix. */
function typeOf(uid) {
  return uid.startsWith('TEST-') ? 'acceptance-test' : 'requirement'
}

/**
 * Parse the supported StrictDoc subset:
 * `[DOCUMENT]`, `[SECTION]`, `[REQUIREMENT]`, `[RELATION]` with
 * `UID/TITLE/STATUS/OWNER` fields and `Type/Value` relation entries.
 *
 * Returns one asset per `[REQUIREMENT]` node; any unsupported construct or
 * missing UID fails with FMT-001 at the offending line.
 */
export function parseSdocAsset(text, file) {
  const requirements = []
  let current = null
  let relation = null

  const finishRelation = () => {
    if (!relation) return
    if (!relation.type || !relation.value) {
      throw new AssetError('[RELATION] requires both Type and Value', {
        rule: 'FMT-001',
        file,
        line: relation.line,
      })
    }
    current.relations.push({
      type: relation.type,
      target: relation.value,
      line: relation.valueLine ?? relation.line,
    })
    relation = null
  }

  const finishRequirement = () => {
    if (!current) return
    finishRelation()
    if (!current.fields.UID) {
      throw new AssetError('[REQUIREMENT] is missing UID', { rule: 'FMT-001', file, line: current.line })
    }
    requirements.push(current)
    current = null
  }

  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const line = index + 1
    const trimmed = lines[index].trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue

    const node = NODE_RE.exec(trimmed)
    if (node) {
      const kind = node[1]
      if (kind === 'REQUIREMENT') {
        finishRequirement()
        current = { fields: {}, relations: [], line }
        continue
      }
      if (kind === 'RELATION') {
        if (!current) {
          throw new AssetError('[RELATION] outside [REQUIREMENT]', { rule: 'FMT-001', file, line })
        }
        finishRelation()
        relation = { line }
        continue
      }
      if (kind === 'DOCUMENT' || kind === 'SECTION') {
        finishRequirement()
        continue
      }
      throw new AssetError(`unsupported SDoc node [${kind}]`, { rule: 'FMT-001', file, line })
    }

    const field = FIELD_RE.exec(trimmed)
    if (!field) continue

    const [, key, value] = field
    if (relation && (key === 'Type' || key === 'Value')) {
      if (key === 'Type') relation.type = value.trim()
      else {
        relation.value = value.trim()
        relation.valueLine = line
      }
      continue
    }

    if (current && FIELD_KEYS.has(key)) current.fields[key] = value.trim()
  }

  finishRequirement()

  if (requirements.length === 0) {
    throw new AssetError('no [REQUIREMENT] node found', { rule: 'FMT-001', file, line: 1 })
  }

  return requirements.map((requirement) => {
    try {
      const asset = normalizeAsset(
        {
          schema_version: 1,
          id: requirement.fields.UID,
          type: typeOf(requirement.fields.UID),
          title: requirement.fields.TITLE,
          status: requirement.fields.STATUS ?? 'proposed',
          owner: requirement.fields.OWNER,
          links: requirement.relations.map((entry) => ({ type: entry.type, target: entry.target })),
        },
        { path: file, format: 'sdoc', line: requirement.line },
      )
      asset.links = asset.links.map((link, i) => ({ ...link, line: requirement.relations[i].line }))
      return asset
    } catch (error) {
      if (error instanceof AssetError) {
        throw new AssetError(error.message, { rule: 'FMT-001', file, line: requirement.line })
      }
      throw error
    }
  })
}
