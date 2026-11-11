// Acceptance command registry.
//
// The canonical implementation lives in alm-core. A live host, however, keeps
// alm-core modules cached across plugin reloads: newly added exports are not
// visible until the host restarts. This adapter prefers the core implementation
// and falls back to an equivalent, strictly validated writer so the UI can
// register commands without a restart. Delete the fallback once every host in
// use has been restarted onto the current alm-core (tracked in
// docs/analysis/requirement-detail-refactor.md).
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import * as core from '../alm-core/src/acceptance/acceptance.mjs'

const ALLOWED_BINARIES = ['node', 'npm', 'pnpm']
const MAX_COMMANDS = 10
const MAX_TIMEOUT = 10 * 60 * 1000

export class RegistryError extends Error {
  constructor(message, { code = 'acceptance-config', status = 400 } = {}) {
    super(message)
    this.name = 'RegistryError'
    this.code = code
    this.status = status
  }
}

function parseArgs(text) {
  const input = String(text ?? '').trim()
  if (!input) throw new RegistryError('验收命令不能为空', { code: 'command-required' })
  if (/[;&|<>$`\n\r]/.test(input.replace(/&&/g, '\u0000'))) {
    throw new RegistryError('验收命令不支持 shell 语法（| ; & > < $ ` 换行）', { code: 'shell-not-allowed' })
  }
  const args = []
  let current = ''
  let quote = null
  for (const char of input) {
    if (quote) {
      if (char === quote) quote = null
      else current += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (/\s/.test(char)) {
      if (current) {
        args.push(current)
        current = ''
      }
      continue
    }
    current += char
  }
  if (quote) throw new RegistryError('验收命令的引号没有闭合', { code: 'command-invalid' })
  if (current) args.push(current)
  if (args.length === 0) throw new RegistryError('验收命令不能为空', { code: 'command-required' })
  return args
}

function normalize(input) {
  const raw = Array.isArray(input) ? input : [{ id: 'verify', command: input }]
  if (raw.length === 0) throw new RegistryError('至少需要一条验收命令', { code: 'no-commands', status: 409 })
  if (raw.length > MAX_COMMANDS) throw new RegistryError(`命令过多（最多 ${MAX_COMMANDS} 条）`, { code: 'too-many-commands' })
  return raw.map((entry, index) => {
    const command = typeof entry === 'string' ? parseArgs(entry) : typeof entry?.command === 'string' ? parseArgs(entry.command) : entry?.command
    if (!Array.isArray(command) || command.length === 0 || command.some((part) => typeof part !== 'string')) {
      throw new RegistryError(`第 ${index + 1} 条命令必须是非空字符串数组`, { code: 'invalid-command' })
    }
    if (!ALLOWED_BINARIES.includes(command[0])) {
      throw new RegistryError(`第 ${index + 1} 条命令使用了不在白名单中的可执行文件：${command[0]}（允许：${ALLOWED_BINARIES.join(', ')}）`, { code: 'binary-not-allowed' })
    }
    if (command[0] === 'node' && command.includes('--test')) {
      const testIndex = command.indexOf('--test')
      const hasTarget = command.slice(testIndex + 1).some((part) => part && !part.startsWith('-'))
      if (!hasTarget) {
        throw new RegistryError(`第 ${index + 1} 条命令使用了无范围的 "node --test"；请提供需求测试路径，例如 node --test packages/example/test/feature.test.mjs`, {
          code: 'test-scope-required',
          status: 409,
        })
      }
    }
    const timeoutMs = Number(entry?.timeoutMs ?? 120_000)
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT) {
      throw new RegistryError(`第 ${index + 1} 条命令的 timeoutMs 必须在 1-${MAX_TIMEOUT} 之间`, { code: 'invalid-timeout' })
    }
    return { id: entry?.id ?? `cmd-${index + 1}`, command: [...command], timeoutMs }
  })
}

function fallbackPlan({ root, requirementId, commands }) {
  if (!requirementId) throw new RegistryError('requirementId is required', { code: 'requirement-required' })
  return {
    schema: 'alm.acceptance.config.plan/v1',
    requirement: requirementId,
    file: join(resolve(root), '.alm/acceptance', `${requirementId}.json`),
    commands: normalize(commands),
    applied: false,
  }
}

function fallbackApply({ root, requirementId, commands }) {
  const plan = fallbackPlan({ root, requirementId, commands })
  mkdirSync(join(resolve(root), '.alm/acceptance'), { recursive: true })
  const payload = { schema: 'alm.acceptance.config/v1', requirement: plan.requirement, commands: plan.commands }
  const temp = `${plan.file}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(temp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  renameSync(temp, plan.file)
  return { ...plan, applied: true }
}

export function planAcceptanceConfig(args) {
  return typeof core.planAcceptanceConfig === 'function' ? core.planAcceptanceConfig(args) : fallbackPlan(args)
}

export function applyAcceptanceConfig(args) {
  return typeof core.applyAcceptanceConfig === 'function' ? core.applyAcceptanceConfig(args) : fallbackApply(args)
}
