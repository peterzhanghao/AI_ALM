import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { verifyBaseline } from './baseline.mjs'

const RELEASE_DIR = '.alm/published'

function gitBuffer(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { stdio: ['ignore', 'pipe', 'ignore'] })
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function archiveAt(root, commit) {
  return gitBuffer(root, 'archive', '--format=tar', commit)
}

/**
 * Publish a verified baseline into a write-once local store. The bundle comes
 * from `git archive <sourceCommit>`, so rebuilding the same commit yields the
 * same bytes.
 */
export function publishBaseline({ root, manifestPath, outDir = RELEASE_DIR }) {
  const manifest = JSON.parse(readFileSync(resolve(root, manifestPath), 'utf8'))
  if (manifest.schema !== 'alm.baseline/v1') throw new Error('release: expected schema alm.baseline/v1')

  const verification = verifyBaseline({ root, manifestPath: resolve(root, manifestPath) })
  if (!verification.ok) throw new Error('release: baseline verification failed')

  const bundle = archiveAt(root, manifest.sourceCommit)
  const bundleSha256 = sha256(bundle)
  const dir = resolve(root, outDir, manifest.baselineId)
  const recordPath = join(dir, 'release.json')

  if (existsSync(recordPath)) {
    const existing = JSON.parse(readFileSync(recordPath, 'utf8'))
    if (existing.bundleSha256 === bundleSha256 && existing.contentHash === manifest.contentHash) {
      return { schema: 'alm.release/v1', status: 'unchanged', dir, ...existing }
    }
    throw new Error(`release: ${manifest.baselineId} already published with different content`)
  }

  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'baseline.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  writeFileSync(join(dir, 'bundle.tar'), bundle)

  const record = {
    schema: 'alm.release/v1',
    baselineId: manifest.baselineId,
    sourceCommit: manifest.sourceCommit,
    contentHash: manifest.contentHash,
    bundleSha256,
    bundleBytes: bundle.length,
    publishedAt: new Date().toISOString(),
  }
  writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8')

  // Publishing makes the baseline current; rollback is the explicit way back.
  const pointerPath = join(resolve(root, outDir), 'current.json')
  let previous = null
  if (existsSync(pointerPath)) {
    previous = JSON.parse(readFileSync(pointerPath, 'utf8')).baselineId ?? null
  }
  const pointer = {
    schema: 'alm.release.pointer/v1',
    baselineId: manifest.baselineId,
    sourceCommit: manifest.sourceCommit,
    contentHash: manifest.contentHash,
    previous,
    actor: 'release',
    updatedAt: new Date().toISOString(),
  }
  writeFileSync(pointerPath, `${JSON.stringify(pointer, null, 2)}\n`, 'utf8')

  return { status: 'published', dir, ...record }
}

/** Rebuild the archive, check the stored bundle and re-verify the manifest. */
export function verifyRelease({ root, baselineId, outDir = RELEASE_DIR }) {
  const dir = resolve(root, outDir, baselineId)
  const recordPath = join(dir, 'release.json')
  const manifestPath = join(dir, 'baseline.json')
  const bundlePath = join(dir, 'bundle.tar')

  if (!existsSync(recordPath)) throw new Error(`release: ${baselineId} not published`)
  const record = JSON.parse(readFileSync(recordPath, 'utf8'))
  const mismatches = []

  const rebuilt = sha256(archiveAt(root, record.sourceCommit))
  if (rebuilt !== record.bundleSha256) {
    mismatches.push({ path: 'bundle.tar(rebuild)', expected: record.bundleSha256, actual: rebuilt })
  }

  if (!existsSync(bundlePath)) {
    mismatches.push({ path: 'bundle.tar', expected: record.bundleSha256, actual: 'missing' })
  } else {
    const stored = sha256(readFileSync(bundlePath))
    if (stored !== record.bundleSha256) {
      mismatches.push({ path: 'bundle.tar', expected: record.bundleSha256, actual: stored })
    }
  }

  const baseline = verifyBaseline({ root, manifestPath })
  mismatches.push(...baseline.mismatches)

  return {
    schema: 'alm.release.verify/v1',
    ok: mismatches.length === 0,
    baselineId,
    sourceCommit: record.sourceCommit,
    mismatches,
  }
}

/**
 * Switch the current release pointer. History is never rewritten: the target
 * must still verify, and the previous pointer is recorded.
 */
export function rollbackRelease({ root, to, outDir = RELEASE_DIR, actor = 'human:local' }) {
  const verification = verifyRelease({ root, baselineId: to, outDir })
  if (!verification.ok) throw new Error(`release: ${to} failed verification`)

  const dir = resolve(root, outDir)
  const record = JSON.parse(readFileSync(join(dir, to, 'release.json'), 'utf8'))
  const pointerPath = join(dir, 'current.json')
  let previous = null
  if (existsSync(pointerPath)) {
    previous = JSON.parse(readFileSync(pointerPath, 'utf8')).baselineId ?? null
  }

  const pointer = {
    schema: 'alm.release.pointer/v1',
    baselineId: to,
    sourceCommit: record.sourceCommit,
    contentHash: record.contentHash,
    previous,
    actor,
    updatedAt: new Date().toISOString(),
  }
  writeFileSync(pointerPath, `${JSON.stringify(pointer, null, 2)}\n`, 'utf8')
  return pointer
}
