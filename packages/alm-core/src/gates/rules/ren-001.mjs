import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, relative, resolve } from 'node:path'
import { findAssetFiles } from '../../parse/load.mjs'

/** REN-001: Markdown links resolve and Mermaid fences are balanced. */
export const id = 'REN-001'
export const level = 'block'

const LINK_RE = /!?\[[^\]]*\]\(([^)\s]+)\)/g

export function check({ root }) {
  const findings = []

  for (const absolute of findAssetFiles(root)) {
    if (!absolute.toLowerCase().endsWith('.md')) continue
    if (basename(absolute).toLowerCase() === 'readme.md') continue

    const file = relative(root, absolute).replaceAll('\\', '/')
    const lines = readFileSync(absolute, 'utf8').split(/\r?\n/)

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]
      for (const match of line.matchAll(LINK_RE)) {
        const target = match[1]
        if (/^(https?:|mailto:|#)/.test(target)) continue
        const clean = target.split('#')[0]
        if (!clean) continue
        if (!existsSync(resolve(dirname(absolute), clean))) {
          findings.push({ assetId: null, file, line: i + 1, message: `broken link: ${target}` })
        }
      }
    }

    let mermaidOpen = false
    let mermaidLine = 0
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i].trim()
      if (/^```mermaid\b/.test(line)) {
        if (mermaidOpen) {
          findings.push({ assetId: null, file, line: i + 1, message: 'nested mermaid fence' })
        }
        mermaidOpen = true
        mermaidLine = i + 1
      } else if (mermaidOpen && /^```$/.test(line)) {
        mermaidOpen = false
      }
    }
    if (mermaidOpen) {
      findings.push({ assetId: null, file, line: mermaidLine, message: 'unclosed mermaid fence' })
    }
  }

  return findings
}
