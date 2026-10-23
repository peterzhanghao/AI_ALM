import { readFileSync } from 'node:fs'
import { basename, relative } from 'node:path'
import { findAssetFiles } from '../../parse/load.mjs'

/** SEC-001: credential-shaped assignments and private keys in asset sources. */
export const id = 'SEC-001'
export const level = 'block'

const PATTERNS = [
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, message: 'private key material' },
  {
    re: /\b(api[_-]?key|secret|token|password|passwd)\b\s*[:=]\s*["']?([A-Za-z0-9_\-./+]{6,})/i,
    message: 'credential-shaped literal value',
  },
]

function assetIdFor(index, file) {
  return index.assets.find((asset) => asset.source.path === file)?.id ?? null
}

export function check({ root, index }) {
  const findings = []

  for (const absolute of findAssetFiles(root)) {
    if (basename(absolute).toLowerCase() === 'readme.md') continue
    const file = relative(root, absolute).replaceAll('\\', '/')
    const lines = readFileSync(absolute, 'utf8').split(/\r?\n/)

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]
      for (const pattern of PATTERNS) {
        const match = pattern.re.exec(line)
        if (!match) continue
        const matched = match[0]
        if (matched.includes('$') || matched.includes('<')) continue
        findings.push({
          assetId: assetIdFor(index, file),
          file,
          line: i + 1,
          message: pattern.message,
        })
        break
      }
    }
  }

  return findings
}
