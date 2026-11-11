import { lstatSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

/**
 * Read-only decision discovery shared by execution and presentation. Explicit
 * references win; only the fixed conventional RUN filename may be inferred.
 * Missing conventional files are not gates. Unsafe/unreadable references are
 * pending, never readable consent. No directory scans or persisted repairs.
 */
export function resolveRunDecision(root, run) {
  if (!run) return { path: null, identity: null, text: null, pending: false }
  const explicit = run.checkpoint?.decision
  const fallback = /^RUN-[A-Za-z0-9-]+$/.test(run.id ?? '') ? `.alm/runs/${run.id}-decision.md` : null
  const path = explicit || fallback
  if (!path) return { path: null, identity: null, text: null, pending: false }
  let identity = null
  let text = null
  try {
    const parts = String(path).split('/')
    if (parts[0] !== '.alm' || parts[1] !== 'runs' || parts.length !== 3 || parts.some(part => !part || part === '..' || part === '.' || part.includes('\\') || part.includes(':'))) throw new Error('unsafe decision path')
    for (let i = 1; i <= parts.length; i++) {
      let stat
      try { stat = lstatSync(join(root, ...parts.slice(0, i))) } catch (error) {
        if (!explicit && i === parts.length && error?.code === 'ENOENT') return { path: null, identity: null, text: null, pending: false }
        throw error
      }
      if (stat.isSymbolicLink()) throw new Error('linked decision path')
      if (i === parts.length && !stat.isFile()) throw new Error('decision is not a file')
    }
    const bytes = readFileSync(join(root, ...parts))
    text = bytes.toString('utf8')
    identity = { path, sha256: createHash('sha256').update(bytes).digest('hex') }
  } catch { /* Unsafe ancestors, read races and unreadable files remain gates. */ }
  const registered = { ...run, checkpoint: { ...run.checkpoint, decision: path } }
  return { path, identity, text, pending: pendingDecisionFor({ run: registered, decision: { path, contentHash: identity?.sha256 ?? null, readable: Boolean(identity) } }) }
}

/**
 * Whether an explicitly registered decision still needs a human answer.
 * Pure: callers read and hash the current bytes; time, file age and unbound
 * legacy answers never imply consent. No explicit ref means no pending gate.
 * Consumption receipts are append-only checkpoint.resolvedDecisions entries:
 * { path, contentHash, answerIndex, resolvedAt }. Only path + hash resolve it.
 */
export function pendingDecisionFor({ run, decision = null } = {}) {
  const path = run?.checkpoint?.decision
  if (!path) return false
  if (decision?.readable !== true || decision.path !== path ||
      typeof decision.contentHash !== 'string' || !decision.contentHash) return true
  const resolved = run?.checkpoint?.resolvedDecisions
  return !Array.isArray(resolved) || !resolved.some((entry) =>
    entry?.path === path && entry.contentHash === decision.contentHash)
}
