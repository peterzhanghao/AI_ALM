import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildIndex } from './index/index.mjs'
import { buildGraph, impactOf, traceOf } from './index/closure.mjs'
import { diffAssets } from './diff/diff.mjs'
import { loadRepo as loadParserRepo, parseAssetFile } from './parse/load.mjs'
import { runGates } from './gates/run.mjs'

const PACK = JSON.parse(readFileSync(new URL('./gates/pack.json', import.meta.url), 'utf8'))

function groupErrors(errors) {
  const groups = new Map()
  for (const error of errors) {
    if (!groups.has(error.rule)) groups.set(error.rule, [])
    groups.get(error.rule).push(error)
  }
  return [...groups]
}

export function loadRepo(root) {
  const absolute = resolve(root)
  if (!existsSync(absolute) || !statSync(absolute).isDirectory()) {
    return { ok: false, error: `not a directory: ${absolute}` }
  }
  const { assets, errors } = loadParserRepo(absolute)
  return { ok: true, root: absolute, assets, errors }
}

/**
 * Read the same asset set at a git ref, so STATE-001 can compare transitions.
 * Returns undefined when the ref or git is unavailable; the rule then skips.
 */
export function loadBaseAssets(root, ref) {
  try {
    // `git -C <subdir> ls-tree` prints paths relative to that subdirectory,
    // while `git show <ref>:<path>` always resolves from the repository root.
    // Prefix the listing so a fixture root (or any nested workspace) still
    // reads the right blobs instead of silently comparing against an empty base.
    const prefix = execFileSync('git', ['-C', root, 'rev-parse', '--show-prefix'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    const listing = execFileSync('git', ['-C', root, 'ls-tree', '-r', '--name-only', ref], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const assets = []
    for (const file of listing.split('\n').map((line) => line.trim()).filter(Boolean)) {
      if (!/\.(yml|yaml|sdoc|md)$/i.test(file)) continue
      if (/^readme\.md$/i.test(file) || /\/readme\.md$/i.test(file)) continue
      try {
        const repoPath = prefix ? `${prefix}${file}` : file
        const text = execFileSync('git', ['-C', root, 'show', `${ref}:${repoPath}`], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        })
        for (const asset of parseAssetFile(text, file)) assets.push(asset)
      } catch {
        // A base file that no longer parses is the business of the base commit,
        // not this gate run; skip it and keep the rest comparable.
      }
    }
    return assets
  } catch {
    return undefined
  }
}

export function indexReport(root) {
  const loaded = loadRepo(root)
  if (!loaded.ok) return loaded
  return {
    schema: 'alm.index/v1',
    root: loaded.root,
    assets: loaded.assets,
    errors: loaded.errors,
  }
}

export function checkReport(root, options = {}) {
  const loaded = loadRepo(root)
  if (!loaded.ok) return loaded

  const index = buildIndex(loaded.assets)
  const base = options.base
  const baseAssets = base ? loadBaseAssets(loaded.root, base) : undefined
  const gate = loaded.errors.length > 0
    ? {
        result: 'fail',
        checks: groupErrors(loaded.errors).map(([rule, errors]) => ({
          id: rule,
          level: 'block',
          status: 'fail',
          findings: errors.map((error) => ({
            assetId: null,
            file: error.file,
            line: error.line,
            message: error.message,
          })),
        })),
      }
    : runGates({ index, root: loaded.root, baseAssets, requireApproval: options.pr === true, prHeadSha: options.headSha })

  return {
    schema: 'alm.check/v1',
    root: loaded.root,
    base: base ?? null,
    rules: { packVersion: PACK.version },
    result: gate.result,
    checks: gate.checks,
    summary: { assets: loaded.assets.length, errors: loaded.errors.length },
  }
}

export function traceReport(root, assetId) {
  const loaded = loadRepo(root)
  if (!loaded.ok) return loaded
  const index = buildIndex(loaded.assets)
  if (!index.byId.has(assetId)) return { ok: false, notFound: true, error: `asset not found: ${assetId}` }

  const graph = buildGraph(loaded.assets)
  const { nodes, cycles } = traceOf(graph, assetId)
  return {
    schema: 'alm.trace/v1',
    root: loaded.root,
    rootAsset: assetId,
    nodes,
    cycles,
  }
}

export function impactReport(root, assetId) {
  const loaded = loadRepo(root)
  if (!loaded.ok) return loaded
  const index = buildIndex(loaded.assets)
  if (!index.byId.has(assetId)) return { ok: false, notFound: true, error: `asset not found: ${assetId}` }

  const graph = buildGraph(loaded.assets)
  const { impacted, cycles } = impactOf(graph, assetId)
  return {
    schema: 'alm.impact/v1',
    root: loaded.root,
    asset: assetId,
    impacted,
    cycles,
  }
}

export function diffReport(root, { base, head } = {}) {
  if (!base) return { ok: false, error: '--base is required' }
  const loaded = loadRepo(root)
  if (!loaded.ok) return loaded

  const baseAssets = loadBaseAssets(loaded.root, base)
  if (!baseAssets) return { ok: false, error: `cannot resolve base ref: ${base}` }
  const headAssets = head ? loadBaseAssets(loaded.root, head) : loaded.assets
  if (!headAssets) return { ok: false, error: `cannot resolve head ref: ${head}` }

  return {
    schema: 'alm.diff/v1',
    root: loaded.root,
    base,
    head: head ?? 'worktree',
    ...diffAssets(baseAssets, headAssets),
  }
}

export function showReport(root, id) {
  const loaded = loadRepo(root)
  if (!loaded.ok) return loaded
  const asset = loaded.assets.find((entry) => entry.id === id)
  if (!asset) return { ok: false, notFound: true, error: `asset not found: ${id}` }
  return { schema: 'alm.show/v1', root: loaded.root, asset }
}

export function queryReport(root, filter = {}) {
  const loaded = loadRepo(root)
  if (!loaded.ok) return loaded
  const effective = {}
  for (const key of ['type', 'status', 'owner']) {
    if (typeof filter[key] === 'string' && filter[key] !== '') effective[key] = filter[key]
  }
  const assets = loaded.assets.filter(
    (asset) =>
      (!effective.type || asset.type === effective.type) &&
      (!effective.status || asset.status === effective.status) &&
      (!effective.owner || asset.owner === effective.owner),
  )
  return {
    schema: 'alm.query/v1',
    root: loaded.root,
    filter: effective,
    assets,
  }
}
