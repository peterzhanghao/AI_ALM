import { parse } from 'yaml'
import { AssetError, normalizeAsset } from '../model/asset.mjs'
import { lineOf } from './locator.mjs'
import { parseOpenApiAsset } from './openapi.mjs'

/**
 * Parse one YAML file. A document with `openapi`/`swagger` becomes an
 * `interface` asset via the OpenAPI reader; otherwise it is a plain asset.
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

  if (doc.openapi || doc.swagger) return parseOpenApiAsset(doc, text, file)

  const asset = normalizeAsset(doc, { path: file, format: 'yaml', line: 1 })
  asset.links = asset.links.map((link) => ({ ...link, line: lineOf(text, link.target) }))
  return asset
}
