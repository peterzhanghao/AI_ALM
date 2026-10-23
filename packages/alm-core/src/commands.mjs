import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildIndex } from './index/index.mjs'
import { loadRepo as loadParserRepo } from './parse/load.mjs'
import { runGates } from './gates/run.mjs'

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

export function checkReport(root) {
  const loaded = loadRepo(root)
  if (!loaded.ok) return loaded

  const index = buildIndex(loaded.assets)
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
    : runGates({ index, root: loaded.root })

  return {
    schema: 'alm.check/v1',
    root: loaded.root,
    result: gate.result,
    checks: gate.checks,
    summary: { assets: loaded.assets.length, errors: loaded.errors.length },
  }
}
