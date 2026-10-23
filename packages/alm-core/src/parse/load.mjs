import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { AssetError } from '../model/asset.mjs'
import { parseYamlAsset } from './yaml.mjs'

const ASSET_EXTENSIONS = new Set(['.yml', '.yaml'])
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

/**
 * Load every YAML asset under `root`. Parse/validation failures are collected
 * instead of aborting, so the caller can report all of them at once.
 */
export function loadYamlRepo(root) {
  const assets = []
  const errors = []

  for (const absolute of findAssetFiles(root)) {
    const file = relative(root, absolute)
    try {
      assets.push(parseYamlAsset(readFileSync(absolute, 'utf8'), file))
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
