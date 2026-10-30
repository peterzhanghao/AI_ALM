import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * BRIEF-001: a declared `BRIEF` must exist and carry real narrative; an
 * accepted requirement without a brief is a warning, not a blocker.
 */
export const id = 'BRIEF-001'
export const level = 'warn'

export function check({ root, assets }) {
  const findings = []
  for (const asset of assets) {
    if (asset.type !== 'requirement') continue
    const brief = asset.extra?.brief
    if (typeof brief === 'string' && brief !== '') {
      const file = join(root, brief)
      if (!existsSync(file)) {
        findings.push({
          assetId: asset.id,
          file: asset.source.path,
          line: asset.source.line,
          message: `brief not found: ${brief}`,
        })
      } else if (readFileSync(file, 'utf8').trim().length < 20) {
        findings.push({
          assetId: asset.id,
          file: asset.source.path,
          line: asset.source.line,
          message: `brief is too short: ${brief}`,
        })
      }
      continue
    }
    if (asset.status === 'accepted') {
      findings.push({
        assetId: asset.id,
        file: asset.source.path,
        line: asset.source.line,
        message: 'accepted requirement has no BRIEF',
      })
    }
  }
  return findings
}
