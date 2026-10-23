/**
 * Deterministic checks for the ALM skill packs.
 *
 * The single source of truth for commands is `alm --help`; the single source of
 * truth for Agent tools is the plugin entry that registers them. This module
 * never hard-codes either list, so removing a command or a tool breaks the
 * check instead of silently passing.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

const MAX_SKILL_BYTES = 8 * 1024
const MIN_TABLE_COMMANDS = 3
const TOOL_MARKER = /<!--\s*alm-tools:([^>]*)-->/
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/
const TOOL_NAME = /\b(alm_[a-z0-9_]+)\b/g

function lineAt(text, index) {
  let line = 1
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) line += 1
  }
  return line
}

/** Top-level commands declared in the `Commands:` block of `alm --help`. */
export function helpCommands(help) {
  const commands = new Set()
  let inCommands = false
  for (const line of help.split(/\r?\n/)) {
    if (/^Commands:\s*$/.test(line)) {
      inCommands = true
      continue
    }
    if (inCommands && /^\S/.test(line)) break
    if (!inCommands) continue
    const match = /^\s{2}([a-z][a-z-]*)\b/.exec(line)
    if (match) commands.add(match[1])
  }
  return commands
}

/** Tool names registered by the core plugin, read from its entry file. */
export function registryTools(source) {
  return new Set([...source.matchAll(TOOL_NAME)].map((entry) => entry[1]))
}

function frontmatter(text) {
  const match = FRONTMATTER.exec(text.replace(/^\uFEFF/, ''))
  if (!match) return null
  const name = /^name:\s*["']?([^\s"']+)/m.exec(match[1])?.[1]
  const description = /^description:\s*["']?(.+?)["']?\s*$/m.exec(match[1])?.[1]
  return { name, description }
}

function markdownFiles(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) markdownFiles(path, files)
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) files.push(path)
  }
  return files
}

function collectTargets(root) {
  const targets = []
  const devRoot = join(root, '.dsh/skills')
  if (existsSync(devRoot)) {
    for (const name of readdirSync(devRoot).sort()) {
      const dir = join(devRoot, name)
      if (!statSync(dir).isDirectory()) continue
      // ALM-facing dev skills keep their command list in references/commands.md.
      if (!existsSync(join(dir, 'references/commands.md'))) continue
      targets.push({ label: `dev:${name}`, kind: 'dev', dir })
    }
  }
  const productRoot = join(root, 'packages/alm-skills')
  if (existsSync(productRoot)) {
    for (const name of readdirSync(productRoot).sort()) {
      const dir = join(productRoot, name)
      if (!statSync(dir).isDirectory()) continue
      targets.push({ label: `product:${name}`, kind: 'product', dir })
    }
  }
  return targets
}

function commandFailures({ skill, dir, files, helpSet }) {
  const failures = []
  const commands = new Set()
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    const display = relative(dir, file).replaceAll('\\', '/')
    const lines = text.split(/\r?\n/)
    let planned = false
    for (let i = 0; i < lines.length; i += 1) {
      const heading = /^##\s+(.+?)\s*$/.exec(lines[i])
      // Sections that explicitly list unimplemented commands are not claims.
      if (heading) planned = /计划中|未实现|planned/i.test(heading[1])
      if (planned) continue
      for (const match of lines[i].matchAll(/`alm\s+([a-z][a-z-]*)/g)) {
        const command = match[1]
        commands.add(command)
        if (helpSet.has(command)) continue
        failures.push({
          skill,
          file: display,
          line: i + 1,
          message: `command "alm ${command}" is not in alm --help`,
        })
      }
    }
  }
  return { failures, commands }
}

function linkFailures({ skill, dir, files }) {
  const failures = []
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    const display = relative(dir, file).replaceAll('\\', '/')
    for (const match of text.matchAll(/!?\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const target = match[1]
      if (/^(https?:|mailto:|#)/.test(target)) continue
      const clean = target.split('#')[0]
      if (!clean) continue
      if (existsSync(join(dirname(file), clean))) continue
      failures.push({
        skill,
        file: display,
        line: lineAt(text, match.index),
        message: `broken reference ${target}`,
      })
    }
  }
  return failures
}

function toolFailures({ skill, dir, files, tools }) {
  const failures = []
  const permissions = join(dir, 'references/permissions.md')
  if (!existsSync(permissions)) {
    return [{ skill, file: 'references/permissions.md', line: 1, message: 'missing permissions file' }]
  }

  const text = readFileSync(permissions, 'utf8')
  const marker = TOOL_MARKER.exec(text)
  if (!marker) {
    return [
      {
        skill,
        file: 'references/permissions.md',
        line: 1,
        message: 'missing <!-- alm-tools: ... --> declaration',
      },
    ]
  }

  const declared = new Set(
    marker[1]
      .split(/[,\s]+/)
      .map((entry) => entry.trim())
      .filter(Boolean),
  )
  if (declared.size === 0) {
    failures.push({
      skill,
      file: 'references/permissions.md',
      line: lineAt(text, marker.index),
      message: 'empty <!-- alm-tools: ... --> declaration',
    })
  }

  for (const tool of declared) {
    if (!tools.has(tool)) {
      failures.push({
        skill,
        file: 'references/permissions.md',
        line: lineAt(text, marker.index),
        message: `declared tool "${tool}" is not registered by the core plugin`,
      })
    }
  }

  for (const file of files) {
    const body = readFileSync(file, 'utf8')
    const display = relative(dir, file).replaceAll('\\', '/')
    for (const match of body.matchAll(TOOL_NAME)) {
      if (declared.has(match[1])) continue
      failures.push({
        skill,
        file: display,
        line: lineAt(body, match.index),
        message: `tool "${match[1]}" is used but not declared in permissions.md`,
      })
    }
  }

  return failures
}

/**
 * @param {{ root: string, help: string, pluginIndex?: string }} options
 * @returns {{ ok: boolean, skills: Array<{label: string, bytes: number, commands: number}>, failures: Array<{skill: string, file: string, line: number, message: string}> }}
 */
export function checkSkills({ root, help, pluginIndex }) {
  const helpSet = helpCommands(help)
  const indexSource = pluginIndex ?? readFileSync(join(root, 'packages/dsh-plugin-alm-core/index.js'), 'utf8')
  const tools = registryTools(indexSource)
  const failures = []
  const skills = []

  for (const target of collectTargets(root)) {
    const skillPath = join(target.dir, 'SKILL.md')
    if (!existsSync(skillPath)) {
      failures.push({ skill: target.label, file: 'SKILL.md', line: 1, message: 'missing SKILL.md' })
      continue
    }

    const skill = readFileSync(skillPath, 'utf8')
    const bytes = statSync(skillPath).size
    if (bytes > MAX_SKILL_BYTES) {
      failures.push({ skill: target.label, file: 'SKILL.md', line: 1, message: `${bytes} bytes (> 8 KB)` })
    }

    const meta = frontmatter(skill)
    const dirName = target.dir.split(/[\\/]/).pop()
    if (!meta) {
      failures.push({ skill: target.label, file: 'SKILL.md', line: 1, message: 'missing YAML frontmatter' })
    } else {
      if (meta.name !== dirName) {
        failures.push({
          skill: target.label,
          file: 'SKILL.md',
          line: 1,
          message: `frontmatter name ${String(meta.name)} != ${dirName}`,
        })
      }
      if (!meta.description || meta.description.trim().length === 0) {
        failures.push({ skill: target.label, file: 'SKILL.md', line: 1, message: 'missing description' })
      }
    }

    const files = markdownFiles(target.dir)
    failures.push(...linkFailures({ skill: target.label, dir: target.dir, files }))

    const commandsPath = join(target.dir, 'references/commands.md')
    if (!existsSync(commandsPath)) {
      failures.push({ skill: target.label, file: 'references/commands.md', line: 1, message: 'missing command list' })
      continue
    }
    const tableCommands = readFileSync(commandsPath, 'utf8')
      .split(/\r?\n/)
      .filter((line) => /^\|\s*`alm\s+[a-z]/.test(line))
    if (tableCommands.length < MIN_TABLE_COMMANDS) {
      failures.push({
        skill: target.label,
        file: 'references/commands.md',
        line: 1,
        message: `command table needs at least ${MIN_TABLE_COMMANDS} entries`,
      })
    }

    const commandResult = commandFailures({ skill: target.label, dir: target.dir, files, helpSet })
    failures.push(...commandResult.failures)

    if (target.kind === 'product') {
      failures.push(...toolFailures({ skill: target.label, dir: target.dir, files, tools }))
    }

    skills.push({ label: target.label, bytes, commands: commandResult.commands.size })
  }

  return { ok: failures.length === 0, skills, failures }
}
