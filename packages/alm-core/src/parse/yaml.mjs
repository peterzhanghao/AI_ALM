import { parse } from 'yaml'
import { AssetError, normalizeAsset } from '../model/asset.mjs'

/** 1-based line of the first occurrence of `needle`, or 1 when absent. */
function lineOf(text, needle) {
  const index = text.indexOf(needle)
  if (index === -1) return 1
  return text.slice(0, index).split('\n').length
}

/**
 * Parse one YAML asset document. Link lines are recovered from the source text
 * so dangling-reference findings can point at the offending line.
 */
export function parseYamlAsset(text, file) {
  let doc
  try {
    doc = parse(text)
  } catch (error) {
    const line = error?.linePos?.[0]?.line ?? 1
    throw new AssetError(`cannot parse YAML: ${error.message}`, { rule: 'FMT-001', file, line })
  }

  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new AssetError('asset must be a mapping', { rule: 'FMT-001', file, line: 1 })
  }

  const asset = normalizeAsset(doc, { path: file, format: 'yaml', line: 1 })
  asset.links = asset.links.map((link) => ({ ...link, line: lineOf(text, link.target) }))
  return asset
}
