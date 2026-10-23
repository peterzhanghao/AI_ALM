#!/usr/bin/env node
/**
 * Verify that every skill's "implemented" command list matches `alm --help`,
 * and that each skill stays within its size and naming limits.
 *
 * Dev skills live in `.dsh/skills/`; product skills ship in `packages/alm-skills/`
 * and are installed into a target workspace by `scripts/demo-init.ps1`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { HELP } from '../packages/alm-core/src/cli.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const failures = []

function collectTargets() {
  const targets = [
    { dir: join(root, '.dsh/skills/alm-mvp-dev'), section: '已实现', label: 'dev:alm-mvp-dev' },
  ]
  const productRoot = join(root, 'packages/alm-skills')
  if (existsSync(productRoot)) {
    for (const name of readdirSync(productRoot).sort()) {
      const dir = join(productRoot, name)
      if (statSync(dir).isDirectory()) targets.push({ dir, section: '使用中的命令', label: `product:${name}` })
    }
  }
  return targets
}

function extractCommands(doc, heading) {
  const lines = doc.split(/\r?\n/)
  const start = lines.findIndex((line) => line.startsWith(`## ${heading}`))
  if (start === -1) return null
  const body = []
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i].startsWith('## ')) break
    body.push(lines[i])
  }
  const commands = [...body.join('\n').matchAll(/`alm\s+(--?[a-z-]+|[a-z][a-z-]*)/g)].map((entry) => entry[1])
  return [...new Set(commands)]
}

for (const target of collectTargets()) {
  const skillPath = join(target.dir, 'SKILL.md')
  if (!existsSync(skillPath)) {
    failures.push(`${target.label}: missing SKILL.md`)
    continue
  }

  const skill = readFileSync(skillPath, 'utf8')
  const bytes = statSync(skillPath).size
  if (bytes > 8 * 1024) failures.push(`${target.label}: SKILL.md is ${bytes} bytes (> 8 KB)`)

  const name = /^name:\s*(\S+)\s*$/m.exec(skill)?.[1]
  const dirName = target.dir.split(/[\\/]/).pop()
  if (name !== dirName) failures.push(`${target.label}: frontmatter name ${String(name)} != ${dirName}`)

  for (const link of skill.matchAll(/\]\(([^)\s]+\.md)\)/g)) {
    if (link[1].startsWith('http')) continue
    if (!existsSync(join(target.dir, link[1].split('#')[0]))) {
      failures.push(`${target.label}: broken reference ${link[1]}`)
    }
  }

  const commandsPath = join(target.dir, 'references/commands.md')
  if (!existsSync(commandsPath)) {
    failures.push(`${target.label}: missing references/commands.md`)
    continue
  }
  const commands = extractCommands(readFileSync(commandsPath, 'utf8'), target.section)
  if (!commands || commands.length < 3) {
    failures.push(`${target.label}: "${target.section}" section missing or too small`)
    continue
  }

  for (const command of commands) {
    const pattern = command.startsWith('--') ? command : `\\b${command}\\b`
    if (!new RegExp(pattern).test(HELP)) {
      failures.push(`${target.label}: command "${command}" not in alm --help`)
    }
  }

  if (!failures.some((failure) => failure.startsWith(target.label))) {
    console.log(`ok  ${target.label}: ${commands.length} commands, ${bytes} bytes`)
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL  ${failure}`)
  process.exit(1)
}
