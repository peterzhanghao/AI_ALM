import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * ATT-001: every attachment listed in a manifest exists, stays inside its
 * requirement directory, and matches its recorded SHA-256.
 */
export const id = 'ATT-001'
export const level = 'block'

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

export function check({ root, index }) {
  const base = join(root, 'requirements', 'attachments')
  if (!existsSync(base)) {
    return { status: 'skip', findings: [], message: 'no requirements/attachments directory' }
  }

  const findings = []
  let manifests = 0

  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const requirementId = entry.name
    const dir = join(base, requirementId)
    const manifestPath = join(dir, 'manifest.json')
    const display = `requirements/attachments/${requirementId}`

    if (!existsSync(manifestPath)) {
      findings.push({ assetId: requirementId, file: display, line: 1, message: 'attachments without manifest.json' })
      continue
    }

    manifests += 1
    let manifest
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    } catch (error) {
      findings.push({ assetId: requirementId, file: `${display}/manifest.json`, line: 1, message: `unreadable manifest: ${error.message}` })
      continue
    }

    if (!index.byId.has(requirementId)) {
      findings.push({ assetId: requirementId, file: display, line: 1, message: `unknown requirement ${requirementId}` })
    }

    for (const file of Array.isArray(manifest.files) ? manifest.files : []) {
      if (typeof file?.path !== 'string' || typeof file?.sha256 !== 'string') {
        findings.push({ assetId: requirementId, file: `${display}/manifest.json`, line: 1, message: 'manifest entry needs path and sha256' })
        continue
      }
      const absolute = join(dir, file.path)
      const rel = relative(dir, absolute)
      if (rel.startsWith('..') || rel === '') {
        findings.push({ assetId: requirementId, file: `${display}/manifest.json`, line: 1, message: `attachment escapes its directory: ${file.path}` })
        continue
      }
      if (!existsSync(absolute)) {
        findings.push({ assetId: requirementId, file: display, line: 1, message: `attachment missing: ${file.path}` })
        continue
      }
      if (sha256(absolute) !== file.sha256) {
        findings.push({ assetId: requirementId, file: display, line: 1, message: `attachment hash mismatch: ${file.path}` })
      }
    }
  }

  if (manifests === 0 && findings.length === 0) {
    return { status: 'skip', findings: [], message: 'no attachment manifests' }
  }
  return findings
}
