import { parse } from 'yaml'
import { AssetError, normalizeAsset } from '../model/asset.mjs'
import { lineOf } from './locator.mjs'

/**
 * Parse a Markdown asset with YAML frontmatter. The body is not interpreted;
 * link lines are recovered from the source text.
 */
export function parseMarkdownAsset(text, file) {
  const source = text.replace(/^\uFEFF/, '')
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source)
  if (!match) {
    throw new AssetError('missing YAML frontmatter', { rule: 'FMT-001', file, line: 1 })
  }

  let frontmatter
  try {
    frontmatter = parse(match[1])
  } catch (error) {
    throw new AssetError(`cannot parse frontmatter: ${error.message}`, {
      rule: 'FMT-001',
      file,
      line: error?.linePos?.[0]?.line ?? 1,
    })
  }

  const bodyLine = match[0].split('\n').length
  const asset = normalizeAsset(frontmatter, { path: file, format: 'markdown', line: bodyLine })
  asset.links = asset.links.map((link) => ({ ...link, line: lineOf(source, link.target) }))
  return asset
}
