import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * REN-002: optional StrictDoc render evidence. Advisory only: a missing
 * manifest is `skip`, any mismatch is `fail(warn)` and never changes the exit
 * code. The manifest is written by `scripts/strictdoc-render.ps1`.
 */
export const id = 'REN-002'
export const level = 'warn'

export const EXPECTED_STRICTDOC = '0.30.4'

function gitHead(root) {
  try {
    return execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return undefined
  }
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

export function check({ root }) {
  const manifestPath = join(root, '.alm/render/manifest.json')
  if (!existsSync(manifestPath)) {
    return { status: 'skip', findings: [], message: 'render manifest not found' }
  }

  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    return [
      {
        assetId: null,
        file: '.alm/render/manifest.json',
        line: 1,
        message: `manifest is not valid JSON: ${error.message}`,
      },
    ]
  }

  const findings = []
  if (manifest.strictdocVersion !== EXPECTED_STRICTDOC) {
    findings.push({
      assetId: null,
      file: '.alm/render/manifest.json',
      line: 1,
      message: `strictdoc version ${String(manifest.strictdocVersion)} != ${EXPECTED_STRICTDOC}`,
    })
  }

  if (manifest.sourceSha) {
    const head = gitHead(root)
    if (head && head !== manifest.sourceSha) {
      findings.push({
        assetId: null,
        file: '.alm/render/manifest.json',
        line: 1,
        message: `manifest sourceSha ${manifest.sourceSha.slice(0, 8)} != HEAD ${head.slice(0, 8)}`,
      })
    }
  }

  for (const artifact of manifest.artifacts ?? []) {
    const path = resolve(root, artifact.path)
    if (!existsSync(path)) {
      findings.push({ assetId: null, file: artifact.path, line: 1, message: 'render artifact missing' })
      continue
    }
    const actual = sha256(path)
    if (actual !== artifact.sha256) {
      findings.push({
        assetId: null,
        file: artifact.path,
        line: 1,
        message: `render artifact hash mismatch: ${actual}`,
      })
    }
  }

  return findings
}
