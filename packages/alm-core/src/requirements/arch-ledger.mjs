import { createHash } from 'node:crypto'
import { buildArchitectureRecord, ARCHITECTURE_RECORD_SCHEMA } from './architecture-impact.mjs'

/**
 * The architecture record is a **module-level delta**, not a per-requirement
 * file listing.
 *
 * Earlier revisions wrote `requirements/architecture/REQ-*-design.md` for every
 * delivery and filled its "架构与模块变更" section with the commit's file list.
 * That made a two-line requirement produce an eighty-line architecture document
 * and forced every small change to rewrite it. The record now lives in three
 * places that already travel with the delivery:
 *
 *   - the candidate JSON (`architecture.modules`),
 *   - the delivery commit trailer (`Architecture-Impact: MOD-…`),
 *   - the module registry (`architecture/MOD-*.yml`) that defines the modules.
 *
 * Nothing is written to `requirements/architecture/` any more.
 */
export { ARCHITECTURE_RECORD_SCHEMA }

function hashRecord(record) {
  return createHash('sha256')
    .update(JSON.stringify({ modules: record.moduleIds, unchanged: record.declaredNotChanged, trailer: record.trailer }))
    .digest('hex')
}

/**
 * Build the architecture portion of a candidate. `impact` may be passed in when
 * the caller already analysed the diff; otherwise it is derived from the real
 * changed paths.
 *
 * `carryModules` keeps the record stable across a post-commit re-verification:
 * that run happens on a clean worktree, so the diff is empty even though the
 * delivery did change those modules.
 */
export function buildArchitectureArchive({ root, asset = null, impact = null, carryModules = [] } = {}) {
  const record = impact ?? buildArchitectureRecord({ root, asset })
  const carried = record.changed ? record.moduleIds : [...new Set(carryModules ?? [])]
  const modules = carried.length && !record.changed
    ? record.moduleTable.filter((entry) => carried.includes(entry.id))
    : record.modules
  const moduleIds = modules.map((entry) => entry.id)
  const primary = moduleIds.length ? `${record.directory}/${moduleIds[0]}.yml` : null
  return {
    schema: ARCHITECTURE_RECORD_SCHEMA,
    changed: moduleIds.length > 0,
    modules,
    moduleIds,
    undeclared: record.undeclared,
    declaredNotChanged: record.declaredNotChanged,
    blocking: record.blocking,
    enforced: record.enforced,
    reason: record.reason,
    trailer: record.trailer,
    path: primary,
    indexPath: null,
    hash: hashRecord({ moduleIds, declaredNotChanged: record.declaredNotChanged, trailer: record.trailer }),
    implementationPaths: [],
  }
}
