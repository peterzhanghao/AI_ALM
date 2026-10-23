import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { canonicalJson } from './canonical.mjs'

export class BaselineConflictError extends Error {
  constructor(message) {
    super(message)
    this.name = 'BaselineConflictError'
  }
}

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
}

function gitBuffer(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { stdio: ['ignore', 'pipe', 'ignore'] })
}

/** Tracked files at `commit`, sorted by path bytes. */
export function listCommitFiles(root, commit) {
  return git(root, 'ls-tree', '-r', '--name-only', commit)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

export function hashAtCommit(root, commit, path) {
  const buffer = gitBuffer(root, 'show', `${commit}:${path}`)
  return { sha256: createHash('sha256').update(buffer).digest('hex'), size: buffer.length }
}

export function contentHashOf(files) {
  const normalized = files.map(({ path, sha256, size }) => ({ path, sha256, size }))
  return createHash('sha256').update(canonicalJson(normalized)).digest('hex')
}

export function readApproval(file) {
  const approval = JSON.parse(readFileSync(resolve(file), 'utf8'))
  if (approval.schema !== 'alm.approval/v1') throw new Error('approval: expected schema alm.approval/v1')
  if (approval.kind !== 'human') throw new Error('approval: only human approvals are accepted')
  if (approval.decision !== 'approve') throw new Error('approval: decision must be approve')
  if (!approval.headSha || approval.headSha.length < 7) throw new Error('approval: headSha is required')
  return approval
}

/** Build a baseline manifest from one commit; timestamps never enter the hash. */
export function buildBaseline({ root, commit, tag, approvalFile, id, packVersion, toolVersion }) {
  const sourceCommit = git(root, 'rev-parse', commit)
  const approval = readApproval(approvalFile)
  if (approval.headSha !== sourceCommit) {
    throw new Error('approval: headSha does not match the baseline commit')
  }

  const files = listCommitFiles(root, sourceCommit).map((path) => ({ path, ...hashAtCommit(root, sourceCommit, path) }))
  const date = sourceCommit.slice(0, 12)
  const baselineId = id ?? `BL-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${date}`

  return {
    schema: 'alm.baseline/v1',
    baselineId,
    sourceCommit,
    tag,
    rules: { packVersion },
    tool: { name: 'alm', version: toolVersion },
    createdAt: new Date().toISOString(),
    approval,
    files,
    contentHash: contentHashOf(files),
  }
}

/**
 * Write a baseline exactly once. Re-creating the same id with identical content
 * is idempotent; any different content is refused without touching the file.
 */
export function createBaseline({ root, outDir, packVersion, toolVersion, ...options }) {
  const baseline = buildBaseline({ root, approvalFile: options.approvalFile, ...options, packVersion, toolVersion })
  const dir = resolve(outDir)
  const path = join(dir, `${baseline.baselineId}.json`)

  if (existsSync(path)) {
    const existing = JSON.parse(readFileSync(path, 'utf8'))
    if (existing.contentHash === baseline.contentHash && existing.sourceCommit === baseline.sourceCommit) {
      return { status: 'unchanged', path, baseline: existing }
    }
    throw new BaselineConflictError(
      `baseline ${baseline.baselineId} already exists with different content (${existing.contentHash.slice(0, 12)} != ${baseline.contentHash.slice(0, 12)})`,
    )
  }

  mkdirSync(dir, { recursive: true })
  writeFileSync(path, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8')
  return { status: 'created', path, baseline }
}

/** Recompute every hash from the source commit and compare with the manifest. */
export function verifyBaseline({ root, manifestPath }) {
  const manifest = JSON.parse(readFileSync(resolve(manifestPath), 'utf8'))
  if (manifest.schema !== 'alm.baseline/v1') throw new Error('baseline: expected schema alm.baseline/v1')

  const mismatches = []
  for (const file of manifest.files ?? []) {
    try {
      const actual = hashAtCommit(root, manifest.sourceCommit, file.path)
      if (actual.sha256 !== file.sha256) {
        mismatches.push({ path: file.path, expected: file.sha256, actual: actual.sha256 })
      }
    } catch {
      mismatches.push({ path: file.path, expected: file.sha256, actual: 'missing' })
    }
  }

  const actualContentHash = contentHashOf(manifest.files ?? [])
  if (actualContentHash !== manifest.contentHash) {
    mismatches.push({
      path: '(contentHash)',
      expected: manifest.contentHash,
      actual: actualContentHash,
    })
  }

  return { ok: mismatches.length === 0, sourceCommit: manifest.sourceCommit, mismatches }
}
