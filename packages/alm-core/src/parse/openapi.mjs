import { AssetError, normalizeAsset } from '../model/asset.mjs'
import { lineOf } from './locator.mjs'

function firstOperationId(paths) {
  for (const item of Object.values(paths ?? {})) {
    if (item === null || typeof item !== 'object') continue
    for (const operation of Object.values(item)) {
      if (operation && typeof operation === 'object' && typeof operation.operationId === 'string') {
        return operation.operationId
      }
    }
  }
  return undefined
}

/**
 * Parse an OpenAPI document into one `interface` asset. ALM metadata lives in
 * `info.x-alm-*`; a document without an explicit ALM id is rejected rather
 * than guessed.
 */
export function parseOpenApiAsset(document, text, file) {
  const info = document.info ?? {}
  const id = info['x-alm-id']
  const owner = info['x-alm-owner']

  if (typeof id !== 'string' || id === '') {
    throw new AssetError('OpenAPI document needs info.x-alm-id', { rule: 'FMT-001', file, line: 1 })
  }
  if (typeof owner !== 'string' || owner === '') {
    throw new AssetError('OpenAPI document needs info.x-alm-owner', { rule: 'FMT-001', file, line: 1 })
  }
  if (document.paths === null || typeof document.paths !== 'object' || Array.isArray(document.paths)) {
    throw new AssetError('OpenAPI document has no paths object', { rule: 'FMT-001', file, line: 1 })
  }

  try {
    const asset = normalizeAsset(
      {
        schema_version: 1,
        id,
        type: 'interface',
        title: typeof info.title === 'string' ? info.title : id,
        status: info['x-alm-status'] ?? 'proposed',
        owner,
        links: info['x-alm-links'] ?? [],
      },
      { path: file, format: 'openapi', line: 1 },
    )
    asset.extra = { ...asset.extra, operationId: firstOperationId(document.paths), openapi: document.openapi }
    asset.links = asset.links.map((link) => ({ ...link, line: lineOf(text, link.target) }))
    return asset
  } catch (error) {
    if (error instanceof AssetError) {
      throw new AssetError(error.message, { rule: 'FMT-001', file, line: 1 })
    }
    throw error
  }
}
