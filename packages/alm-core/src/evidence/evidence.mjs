import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
}

export function resolveSha(root, ref = 'HEAD') {
  try {
    return git(root, 'rev-parse', ref)
  } catch {
    return undefined
  }
}

function newRunId() {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
  return `run-${stamp}-${randomBytes(2).toString('hex')}`
}

/** Build the `alm.evidence/v1` document from one check report. */
export function buildEvidence({ root, report, baseRef }) {
  const headSha = resolveSha(root, 'HEAD')
  if (!headSha) throw new Error('evidence requires a git repository')
  const baseSha = resolveSha(root, baseRef ?? 'HEAD') ?? headSha

  return {
    schema: 'alm.evidence/v1',
    runId: newRunId(),
    baseSha,
    headSha,
    result: report.result,
    rules: { packVersion: report.rules.packVersion },
    tool: { name: 'alm', version: pkg.version, node: process.versions.node },
    checks: report.checks,
    artifacts: [],
  }
}

export function writeEvidence(file, evidence) {
  const path = resolve(file)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
  return path
}
