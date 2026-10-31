import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { gitHead } from '../approvals/approval.mjs'

export const ACCEPTANCE_DIR = '.alm/acceptance'
export const ACCEPTANCE_SCHEMA = 'alm.acceptance/v1'
export const CONFIG_SCHEMA = 'alm.acceptance.config/v1'
/** Only these executables may be registered as acceptance commands. */
export const ALLOWED_BINARIES = ['node', 'npm', 'pnpm']
const MAX_COMMANDS = 10
const MAX_TIMEOUT = 10 * 60 * 1000
const MAX_OUTPUT = 20_000

export class AcceptanceError extends Error {
  constructor(message, { code = 'acceptance', status = 400 } = {}) {
    super(message)
    this.name = 'AcceptanceError'
    this.code = code
    this.status = status
  }
}

export function acceptanceDir(root, requirementId) {
  return join(resolve(root), ACCEPTANCE_DIR, requirementId)
}

export function configPath(root, requirementId) {
  return join(resolve(root), ACCEPTANCE_DIR, `${requirementId}.json`)
}

export function evidencePath(root, requirementId, headSha) {
  return join(acceptanceDir(root, requirementId), `${headSha}.json`)
}

function normalizeCommands(raw) {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new AcceptanceError('acceptance config needs a non-empty commands array', { code: 'no-commands', status: 409 })
  }
  if (raw.length > MAX_COMMANDS) throw new AcceptanceError(`too many commands (max ${MAX_COMMANDS})`, { code: 'too-many-commands' })
  return raw.map((entry, index) => {
    if (!entry || typeof entry !== 'object') throw new AcceptanceError(`command ${index + 1} must be an object`, { code: 'invalid-command' })
    const command = entry.command
    if (!Array.isArray(command) || command.length === 0 || command.some((part) => typeof part !== 'string')) {
      throw new AcceptanceError(`command ${index + 1} must be a non-empty string array`, { code: 'invalid-command' })
    }
    if (!ALLOWED_BINARIES.includes(command[0])) {
      throw new AcceptanceError(`command ${index + 1} uses a non-whitelisted binary: ${command[0]} (allowed: ${ALLOWED_BINARIES.join(', ')})`, {
        code: 'binary-not-allowed',
      })
    }
    const timeoutMs = Number(entry.timeoutMs ?? 120_000)
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT) {
      throw new AcceptanceError(`command ${index + 1} timeoutMs must be 1-${MAX_TIMEOUT}`, { code: 'invalid-timeout' })
    }
    return { id: entry.id ?? `cmd-${index + 1}`, command: [...command], timeoutMs }
  })
}

/** Read `.alm/acceptance/<REQ>.json`; a missing file means "not registered yet". */
export function readAcceptanceConfig(root, requirementId) {
  const file = configPath(root, requirementId)
  if (!existsSync(file)) return null
  let payload
  try {
    payload = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    throw new AcceptanceError(`cannot read ${file}: ${error.message}`, { code: 'config-unreadable' })
  }
  if (payload.schema !== CONFIG_SCHEMA) {
    throw new AcceptanceError(`unsupported config schema: ${String(payload.schema)}`, { code: 'config-schema' })
  }
  return {
    schema: CONFIG_SCHEMA,
    requirement: payload.requirement ?? requirementId,
    commands: normalizeCommands(payload.commands),
    file,
  }
}

/** Latest evidence for a requirement (by file mtime), or null. */
export function readAcceptanceEvidence(root, requirementId) {
  const dir = acceptanceDir(root, requirementId)
  if (!existsSync(dir)) return null
  const files = readdirSync(dir)
    .filter((name) => /^[0-9a-f]{40}\.json$/.test(name))
    .map((name) => ({ file: join(dir, name), mtime: statSync(join(dir, name)).mtimeMs }))
    .sort((left, right) => right.mtime - left.mtime)
  if (files.length === 0) return null
  try {
    const evidence = JSON.parse(readFileSync(files[0].file, 'utf8'))
    return { ...evidence, file: files[0].file }
  } catch {
    return null
  }
}

/** Compact summary for the requirements payload. */
export function acceptanceSummary(root, requirementId, headSha) {
  const config = readAcceptanceConfig(root, requirementId)
  const evidence = readAcceptanceEvidence(root, requirementId)
  return {
    schema: 'alm.acceptance.summary/v1',
    registered: Boolean(config),
    commandCount: config?.commands.length ?? 0,
    commands: config?.commands.map((entry) => ({ id: entry.id, command: entry.command })) ?? [],
    latest: evidence
      ? {
          result: evidence.result,
          headSha: evidence.headSha,
          finishedAt: evidence.finishedAt,
          commands: evidence.commands?.length ?? 0,
          file: evidence.file,
          current: Boolean(headSha) && evidence.headSha === headSha,
        }
      : null,
  }
}

/**
 * Plan or run the registered acceptance commands. Planning never executes or
 * writes; apply runs each command without a shell and archives one evidence
 * file keyed by the current HEAD SHA.
 */
export function runAcceptance({ root, requirementId, apply = false, exec = spawnSync }) {
  const repo = resolve(root)
  if (!requirementId) throw new AcceptanceError('requirementId is required', { code: 'requirement-required' })
  const headSha = gitHead(repo)
  if (!headSha) throw new AcceptanceError('acceptance needs a git repository with a HEAD commit', { code: 'not-a-git-repo' })
  const config = readAcceptanceConfig(repo, requirementId)
  if (!config) {
    throw new AcceptanceError(`未登记验收命令：${configPath(repo, requirementId)}`, { code: 'no-config', status: 404 })
  }

  const plan = {
    schema: 'alm.acceptance.plan/v1',
    requirement: requirementId,
    headSha,
    commands: config.commands,
    evidencePath: evidencePath(repo, requirementId, headSha),
    applied: false,
  }
  if (!apply) return plan

  const startedAt = new Date().toISOString()
  const commands = config.commands.map((entry) => {
    const started = Date.now()
    const result = exec(entry.command[0], entry.command.slice(1), {
      cwd: repo,
      encoding: 'utf8',
      timeout: entry.timeoutMs,
      maxBuffer: 20 * 1024 * 1024,
      windowsHide: true,
    })
    const durationMs = Date.now() - started
    const timedOut = result.error?.code === 'ETIMEDOUT' || result.signal === 'SIGTERM'
    return {
      id: entry.id,
      command: entry.command,
      exitCode: typeof result.status === 'number' ? result.status : null,
      timedOut,
      durationMs,
      stdout: String(result.stdout ?? '').slice(-MAX_OUTPUT),
      stderr: String(result.stderr ?? '').slice(-MAX_OUTPUT),
    }
  })
  const finishedAt = new Date().toISOString()
  const passed = commands.every((entry) => entry.exitCode === 0 && !entry.timedOut)
  const evidence = {
    schema: ACCEPTANCE_SCHEMA,
    requirement: requirementId,
    headSha,
    result: passed ? 'pass' : 'fail',
    startedAt,
    finishedAt,
    commands,
  }

  mkdirSync(acceptanceDir(repo, requirementId), { recursive: true })
  writeFileSync(evidencePath(repo, requirementId, headSha), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
  return { ...plan, applied: true, result: evidence.result, evidence }
}
