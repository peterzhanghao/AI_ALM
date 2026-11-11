/**
 * Version fingerprint for one acceptance round.
 *
 * The point of a round is to prove *which code* produced the evidence. A
 * screenshot alone cannot; it is equally consistent with a stale bundle, a
 * stale host process or an unrelated checkout. Every round therefore records
 * the git subject, the hashes of the files actually under test and the runtime
 * that rendered them.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, sep } from 'node:path'

export const FINGERPRINT_SCHEMA = 'alm.plugin-acceptance.fingerprint/v1'

const GIT_ENV = { ...process.env, GIT_OPTIONAL_LOCKS: '0' }

function git(root, args) {
  try {
    return execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      env: GIT_ENV,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
}

/**
 * Git subject of the workspace: what a reviewer would see in `git status`.
 *
 * @param {string} root
 * @returns {{available: boolean, headSha: string|null, branch: string|null, dirty: boolean|null, statusDigest: string|null}}
 */
export function gitSubject(root) {
  const headSha = git(root, ['rev-parse', 'HEAD'])
  if (headSha === null) {
    return { available: false, headSha: null, branch: null, dirty: null, statusDigest: null }
  }
  const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const status = git(root, ['status', '--porcelain'])
  const lines = (status ?? '').split('\n').map((line) => line.trimEnd()).filter(Boolean).sort()
  return {
    available: true,
    headSha,
    branch: branch === 'HEAD' ? null : branch,
    dirty: lines.length > 0,
    statusDigest: lines.length ? sha256(lines.join('\n')) : null,
  }
}

/** @param {string|Buffer} data */
export function sha256(data) {
  return createHash('sha256').update(data).digest('hex')
}

/**
 * Content hash and mtime of one file, relative to the workspace root.
 *
 * @param {string} root
 * @param {string} path absolute or root-relative
 * @returns {{path: string, sha256: string, bytes: number, mtimeMs: number}}
 */
export function fileFingerprint(root, path) {
  const absolute = isAbsolute(path) ? path : join(root, path)
  const buffer = readFileSync(absolute)
  const stats = statSync(absolute)
  return {
    path: relative(root, absolute).split(sep).join('/'),
    sha256: sha256(buffer),
    bytes: buffer.byteLength,
    mtimeMs: Math.round(stats.mtimeMs),
  }
}

/**
 * Files that decide whether the evidence is about the code the reviewer has in
 * front of them: the plugin manifest, the plugin entry and the scenario file.
 *
 * @param {string} root
 * @param {string[]} files
 */
export function fileFingerprints(root, files) {
  const out = []
  const seen = new Set()
  for (const file of files) {
    if (!file || seen.has(file)) continue
    seen.add(file)
    try {
      out.push(fileFingerprint(root, file))
    } catch {
      out.push({ path: file.split(sep).join('/'), sha256: null, bytes: null, mtimeMs: null })
    }
  }
  return out
}

/**
 * Runtime that produced the pixels. `browser` is filled in after launch, since
 * the channel actually available differs per machine.
 *
 * @param {{browser?: string|null, playwright?: string|null}} [extra]
 */
export function environmentFingerprint(extra = {}) {
  return {
    schema: 'alm.plugin-acceptance.environment/v1',
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    playwright: extra.playwright ?? null,
    browser: extra.browser ?? null,
  }
}

/**
 * @param {{root: string, files?: string[], browser?: string|null, playwright?: string|null}} options
 */
export function subjectFingerprint({ root, files = [], browser = null, playwright = null }) {
  return {
    schema: FINGERPRINT_SCHEMA,
    root,
    git: gitSubject(root),
    files: fileFingerprints(root, files),
    environment: environmentFingerprint({ browser, playwright }),
    at: new Date().toISOString(),
  }
}

/**
 * Compare a recorded fingerprint with the current workspace so a stale round
 * cannot be silently re-signed.
 *
 * @param {object} recorded
 * @param {object} current
 * @returns {string[]} human-readable differences, empty when identical
 */
export function fingerprintDrift(recorded, current) {
  const drift = []
  const a = recorded?.git ?? {}
  const b = current?.git ?? {}
  if (a.headSha && b.headSha && a.headSha !== b.headSha) drift.push(`headSha ${a.headSha} -> ${b.headSha}`)
  if (a.statusDigest !== b.statusDigest) drift.push('working tree status changed')
  for (const file of current?.files ?? []) {
    const before = (recorded?.files ?? []).find((entry) => entry.path === file.path)
    if (!before) drift.push(`${file.path} was not in the round`)
    else if (before.sha256 !== file.sha256) drift.push(`${file.path} sha256 changed`)
  }
  return drift
}
