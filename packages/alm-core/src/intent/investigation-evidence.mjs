import { readFileSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, sep } from 'node:path'

// Persisted verification flags describe a past observation, not current files.
export function currentInvestigationEvidence(root, session) {
  const records = Array.isArray(session?.investigationEvidence) ? session.investigationEvidence : []
  let rootReal
  try { rootReal = realpathSync(root) } catch { return [] }
  return records.filter((entry) => {
    if (!entry || !Array.isArray(entry.findings) || entry.findings.length === 0) return false
    return entry.findings.every((finding) => Array.isArray(finding?.refs) && finding.refs.length > 0 && finding.refs.every((ref) => {
      if (ref?.verified !== true || typeof ref.path !== 'string' || !ref.path || isAbsolute(ref.path)) return false
      const segments = ref.path.replaceAll('\\', '/').split('/')
      if (segments.includes('..') || !Number.isSafeInteger(ref.line) || ref.line < 1 || typeof ref.quote !== 'string' || ref.quote.trim().length < 8) return false
      const endLine = ref.endLine ?? ref.line
      if (!Number.isSafeInteger(endLine) || endLine < ref.line) return false
      try {
        const target = realpathSync(join(rootReal, ref.path))
        const rel = relative(rootReal, target)
        if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return false
        const stat = statSync(target)
        if (!stat.isFile() || stat.size > 1024 * 1024) return false
        const lines = readFileSync(target, 'utf8').split('\n')
        return endLine <= lines.length && lines[ref.line - 1].includes(ref.quote)
      } catch { return false }
    }))
  })
}
