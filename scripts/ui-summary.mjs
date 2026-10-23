#!/usr/bin/env node
/**
 * Render a markdown summary of `ui/report.json` for GitHub Actions job summaries.
 * Usage: node scripts/ui-summary.mjs tmp/ui/report.json >> "$GITHUB_STEP_SUMMARY"
 */
import { readFileSync } from 'node:fs'

const file = process.argv[2] ?? 'tmp/ui/report.json'
const report = JSON.parse(readFileSync(file, 'utf8'))
const checks = report.checks ?? []
const failed = checks.filter((entry) => !entry.ok)
const lines = [
  '## ALM UI verification',
  '',
  `- base: \`${report.base}\``,
  report.root ? `- root: \`${report.root}\`` : null,
  `- checks: **${checks.length - failed.length}/${checks.length}** passed`,
  `- screenshots: ${(report.shots ?? []).map((shot) => `\`${shot.split(/[\\\\/]/).pop()}\``).join(', ') || '—'}`,
  `- console errors: ${(report.consoleErrors ?? []).length}`,
  `- failed requests: ${(report.failedRequests ?? []).length}`,
  '',
]

if (failed.length > 0) {
  lines.push('### Failed checks', '', '| check | detail |', '|---|---|')
  for (const entry of failed) lines.push(`| ${entry.name} | ${String(entry.detail ?? '').replaceAll('|', '\\|')} |`)
  lines.push('')
}

lines.push('<details><summary>All checks</summary>', '', '| check | result |', '|---|---|')
for (const entry of checks) lines.push(`| ${entry.name} | ${entry.ok ? 'pass' : 'fail'} |`)
lines.push('', '</details>')

process.stdout.write(`${lines.filter((line) => line !== null).join('\n')}\n`)
