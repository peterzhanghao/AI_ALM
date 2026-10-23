import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gitHead } from '../approvals/approval.mjs'
import { checkReport } from '../commands.mjs'

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
const PACK = JSON.parse(readFileSync(new URL('../gates/pack.json', import.meta.url), 'utf8'))

const CI_DIR = '.alm/ci'

function ciFile(root, sha) {
  return join(root, CI_DIR, sha, `${PACK.version}.json`)
}

function sameRecord(left, right) {
  return JSON.stringify(left.checks) === JSON.stringify(right.checks) && left.result === right.result
}

function buildServerEvidence({ headSha, baseSha, report }) {
  return {
    schema: 'alm.evidence/v1',
    runId: `ci-${headSha.slice(0, 12)}-${PACK.version}`,
    baseSha,
    headSha,
    result: report.result,
    rules: { packVersion: PACK.version },
    tool: { name: 'alm', version: pkg.version, node: process.versions.node },
    checks: report.checks,
    artifacts: [],
  }
}

/**
 * Server-side re-run: same rule pack, deterministic runId. Repeated runs for
 * the same commit + pack return `unchanged` and keep a single record.
 */
export function runCi({ root, base }) {
  const headSha = gitHead(root)
  if (!headSha) throw new Error('ci: requires a git repository')
  const baseSha = base ? (gitHead(root, base) ?? headSha) : headSha

  const report = checkReport(root, { base })
  if (report.ok === false) throw new Error(report.error)

  const evidence = buildServerEvidence({ headSha, baseSha, report })
  const file = ciFile(root, headSha)

  if (existsSync(file)) {
    const existing = JSON.parse(readFileSync(file, 'utf8'))
    if (sameRecord(existing, evidence)) {
      return { schema: 'alm.ci.run/v1', status: 'unchanged', path: file, headSha, runId: existing.runId, result: existing.result }
    }
  }

  mkdirSync(join(root, CI_DIR, headSha), { recursive: true })
  writeFileSync(file, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
  return { schema: 'alm.ci.run/v1', status: 'created', path: file, headSha, runId: evidence.runId, result: evidence.result }
}

/**
 * Accept a client evidence file only when the server re-run agrees with it.
 * The stored record is the server's own evidence, never the client's.
 */
export function recordEvidence({ root, evidencePath }) {
  const client = JSON.parse(readFileSync(evidencePath, 'utf8'))
  if (client.schema !== 'alm.evidence/v1') throw new Error('ci: expected schema alm.evidence/v1')
  if (client.rules?.packVersion !== PACK.version) {
    throw new Error(`ci: evidence pack ${String(client.rules?.packVersion)} != ${PACK.version}`)
  }

  const headSha = gitHead(root)
  if (!headSha) throw new Error('ci: requires a git repository')
  if (client.headSha !== headSha) throw new Error('ci: evidence head does not match the checked-out commit')

  const server = runCi({ root, base: client.baseSha })
  const stored = JSON.parse(readFileSync(server.path, 'utf8'))
  if (stored.result !== client.result) {
    throw new Error(`ci: client result ${client.result} differs from server ${stored.result}`)
  }
  return { ...server, status: server.status === 'created' ? 'recorded' : server.status, clientResult: client.result }
}

export function ciStatus({ root, sha = 'HEAD' }) {
  const headSha = gitHead(root, sha)
  if (!headSha) {
    return { schema: 'alm.ci.status/v1', ok: false, sha: null, reason: 'cannot resolve commit' }
  }

  const file = ciFile(root, headSha)
  if (!existsSync(file)) {
    return {
      schema: 'alm.ci.status/v1',
      ok: false,
      sha: headSha,
      reason: `no CI record for pack ${PACK.version}`,
    }
  }

  const record = JSON.parse(readFileSync(file, 'utf8'))
  if (record.rules?.packVersion !== PACK.version) {
    return { schema: 'alm.ci.status/v1', ok: false, sha: headSha, reason: 'record pack version mismatch' }
  }
  if (record.result !== 'pass') {
    return { schema: 'alm.ci.status/v1', ok: false, sha: headSha, reason: 'required checks failed', runId: record.runId }
  }

  return {
    schema: 'alm.ci.status/v1',
    ok: true,
    sha: headSha,
    runId: record.runId,
    packVersion: PACK.version,
    checks: record.checks.length,
  }
}
