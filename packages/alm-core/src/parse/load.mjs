import { readdirSync, readFileSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import { AssetError } from '../model/asset.mjs'
import { parseMarkdownAsset } from './markdown.mjs'
import { parseSdocAsset } from './sdoc.mjs'
import { parseYamlAsset } from './yaml.mjs'

const ASSET_EXTENSIONS = new Set(['.yml', '.yaml', '.sdoc', '.md'])
const IGNORED_DIRS = new Set(['node_modules', '.git', '.alm', 'tmp'])

/** Recursively collect asset files under `root`, in stable path order. */
export function findAssetFiles(root) {
  const files = []
  const visit = (dir) => {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.isDirectory()) continue
      const absolute = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) visit(absolute)
        continue
      }
      const dot = entry.name.lastIndexOf('.')
      const extension = dot === -1 ? '' : entry.name.slice(dot).toLowerCase()
      if (ASSET_EXTENSIONS.has(extension)) files.push(absolute)
    }
  }
  visit(root)
  return files
}

function parseFile(text, file) {
  const lower = file.toLowerCase()
  if (lower.endsWith('.sdoc')) return parseSdocAsset(text, file)
  if (lower.endsWith('.md')) {
    // README files are documentation, not assets. Any other Markdown must
    // carry frontmatter, so a malformed ADR fails instead of disappearing.
    if (basename(file).toLowerCase() === 'readme.md') return []
    if (!/^---\r?\n/.test(text.replace(/^\uFEFF/, ''))) {
      throw new AssetError('missing YAML frontmatter', { rule: 'FMT-001', file, line: 1 })
    }
    return [parseMarkdownAsset(text, file)]
  }
  return [parseYamlAsset(text, file)]
}

/**
 * Load every supported asset under `root` (`.yml`, `.yaml`, `.sdoc`, `.md`).
 * Parse/validation failures are collected instead of aborting, so the caller
 * can report all of them at once.
 */
export function loadRepo(root) {
  const assets = []
  const errors = []

  for (const absolute of findAssetFiles(root)) {
    const file = relative(root, absolute).replaceAll('\\', '/')
    try {
      for (const asset of parseFile(readFileSync(absolute, 'utf8'), file)) assets.push(asset)
    } catch (error) {
      if (!(error instanceof AssetError)) throw error
      errors.push({
        rule: error.rule,
        file: error.file ?? file,
        line: error.line,
        message: error.message,
      })
    }
  }

  return { root, assets, errors }
}
