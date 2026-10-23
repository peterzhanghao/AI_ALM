#!/usr/bin/env node
/**
 * Verify that the commands the dev skill calls "implemented" really exist in
 * `alm --help`, and that the skill stays within its size and naming limits.
 *
 * Exit 0 = consistent; exit 1 = drift (printed with the offending entry).
 */
import { readFileSync, statSync } from 'node:fs'
import { HELP } from '../packages/alm-core/src/cli.mjs'

const root = new URL('../', import.meta.url)
const skillUrl = new URL('.dsh/skills/alm-mvp-dev/SKILL.md', root)
const commandsUrl = new URL('.dsh/skills/alm-mvp-dev/references/commands.md', root)

const failures = []

function fail(message) {
  failures.push(message)
}

const skill = readFileSync(skillUrl, 'utf8')
const skillBytes = statSync(skillUrl).size
if (skillBytes > 8 * 1024) fail(`SKILL.md 超过 8 KB（${skillBytes} bytes）`)

const name = /^name:\s*(\S+)\s*$/m.exec(skill)?.[1]
if (name !== 'alm-mvp-dev') fail(`frontmatter name 应为 alm-mvp-dev，实际为 ${String(name)}`)

const commandsDoc = readFileSync(commandsUrl, 'utf8')
const implemented = commandsDoc.split(/^## 已实现[^\n]*\n/m)[1]?.split(/^## /m)[0]
if (!implemented) fail('commands.md 缺少「已实现」段')

const mentioned = [...(implemented ?? '').matchAll(/`alm\s+(--?[a-z-]+|[a-z][a-z-]*)/g)].map((m) => m[1])
const unique = [...new Set(mentioned)]
if (unique.length < 3) fail(`「已实现」段命令过少（${unique.length} 条）`)

for (const command of unique) {
  const pattern = command.startsWith('--') ? command : `\\b${command}\\b`
  if (!new RegExp(pattern).test(HELP)) {
    fail(`命令 "${command}" 在 alm --help 中不存在（skills/alm-mvp-dev/references/commands.md）`)
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL  ${failure}`)
  process.exit(1)
}

console.log(`ok  alm-mvp-dev：${unique.length} 条已实现命令与 CLI 一致，SKILL.md ${skillBytes} bytes`)
