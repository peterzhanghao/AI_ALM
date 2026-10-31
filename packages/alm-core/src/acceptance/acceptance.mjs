import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { gitHead } from '../approvals/approval.mjs'
import { requirementContentHash, testRevisionHash } from '../model/content-hash.mjs'

export const ACCEPTANCE_DIR = '.alm/acceptance'
export const ACCEPTANCE_SCHEMA = 'alm.acceptance/v2'
/** Read-only compatibility: evidence written before the provenance upgrade. */
export const ACCEPTANCE_SCHEMA_V1 = 'alm.acceptance/v1'
export const ACCEPTANCE_SUMMARY_SCHEMA = 'alm.acceptance.summary/v2'
export const CONFIG_SCHEMA = 'alm.acceptance.config/v1'
/** Only these executables may be registered as acceptance commands. */
export const ALLOWED_BINARIES = ['node', 'npm', 'pnpm']
const MAX_COMMANDS = 10
const MAX_TIMEOUT = 10 * 60 * 1000
const MAX_OUTPUT = 20_000
const RUNNER = 'alm-core/acceptance'
const SOURCE = 'local-runner'

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

/** Latest evidence for a requirement (by file mtime), or null. v1/v2 are returned as-is. */
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

function verifiedByOf(asset) {
  return [...(asset?.links ?? [])]
    .filter((link) => link?.type === 'verified_by')
    .map((link) => link.target)
    .sort()
}

function environmentNow() {
  return { platform: process.platform, arch: process.arch, node: process.version, runner: RUNNER }
}

/** Evidence is "complete" only when the full provenance chain is present. */
function completenessOf(evidence) {
  const missing = []
  if (!evidence.requirementHash) missing.push('requirementHash')
  if (!evidence.testRevision) missing.push('testRevision')
  if (!evidence.environment) missing.push('environment')
  if (!evidence.source) missing.push('source')
  const complete =
    evidence.schema === ACCEPTANCE_SCHEMA &&
    Boolean(evidence.headSha) &&
    Boolean(evidence.requirementHash) &&
    Boolean(evidence.testRevision) &&
    Boolean(evidence.environment) &&
    Boolean(evidence.source)
  return { complete, missing }
}

/**
 * Compact summary for the requirements payload. With `context = {asset, assets}`
 * the latest evidence is current only if it is complete and bound to the same
 * HEAD, requirement content hash and test revision; without it the legacy
 * HEAD-only comparison is kept for compatibility.
 */
export function acceptanceSummary(root, requirementId, headSha, context = null) {
  const config = readAcceptanceConfig(root, requirementId)
  const evidence = readAcceptanceEvidence(root, requirementId)
  const bound = Boolean(context?.asset)
  let latest = null
  if (evidence) {
    const { complete, missing } = completenessOf(evidence)
    const requirementHash = evidence.requirementHash ?? null
    const testRevision = evidence.testRevision ?? null
    let current = false
    let staleReason = null
    if (!complete) {
      staleReason = 'incomplete'
    } else if (!headSha || evidence.headSha !== headSha) {
      staleReason = 'head'
    } else if (bound) {
      const expectedRequirementHash = requirementContentHash({ root, asset: context.asset })
      const expectedTestRevision = testRevisionHash({ asset: context.asset, assets: context.assets ?? [] })
      if (requirementHash === expectedRequirementHash) {
        if (testRevision === expectedTestRevision) current = true
        else staleReason = 'tests'
      } else {
        staleReason = 'requirement'
      }
    } else {
      current = true
    }
    latest = {
      result: evidence.result,
      headSha: evidence.headSha,
      finishedAt: evidence.finishedAt,
      commands: evidence.commands?.length ?? 0,
      file: evidence.file,
      current,
      requirementHash,
      testRevision,
      environment: evidence.environment ?? null,
      source: evidence.source ?? null,
      complete,
      missing,
      staleReason,
    }
  }
  return {
    schema: ACCEPTANCE_SUMMARY_SCHEMA,
    registered: Boolean(config),
    commandCount: config?.commands.length ?? 0,
    commands: config?.commands.map((entry) => ({ id: entry.id, command: entry.command })) ?? [],
    latest,
  }
}

/**
 * Plan or run the registered acceptance commands. Planning never executes or
 * writes; apply runs each command without a shell and archives one evidence
 * file keyed by the current HEAD SHA. When `context = {asset, assets, actor,
 * project, file}` is supplied the evidence also records the provenance chain
 * (requirement hash, test revision, environment, source), which makes it
 * possible to tell later whether it is still current.
 */
export function runAcceptance({ root, requirementId, apply = false, exec = spawnSync, context = null }) {
  const repo = resolve(root)
  if (!requirementId) throw new AcceptanceError('requirementId is required', { code: 'requirement-required' })
  const headSha = gitHead(repo)
  if (!headSha) throw new AcceptanceError('acceptance needs a git repository with a HEAD commit', { code: 'not-a-git-repo' })
  const config = readAcceptanceConfig(repo, requirementId)
  if (!config) {
    throw new AcceptanceError(`未登记验收命令：${configPath(repo, requirementId)}`, { code: 'no-config', status: 404 })
  }
  const bound = Boolean(context?.asset)

  const plan = {
    schema: 'alm.acceptance.plan/v1',
    requirement: requirementId,
    headSha,
    commands: config.commands,
    evidencePath: evidencePath(repo, requirementId, headSha),
    ...(bound ? { provenance: boundProvenance(repo, context.asset, context.assets) } : {}),
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
  const provenance = bound ? boundProvenance(repo, context.asset, context.assets) : { requirementHash: null, testRevision: null }
  const evidence = {
    schema: ACCEPTANCE_SCHEMA,
    requirement: requirementId,
    revision: 2,
    requirementHash: provenance.requirementHash,
    testRevision: provenance.testRevision,
    headSha,
    result: passed ? 'pass' : 'fail',
    startedAt,
    finishedAt,
    environment: environmentNow(),
    source: SOURCE,
    ...(bound
      ? {
          context: {
            verifiedBy: verifiedByOf(context.asset),
            project: context.project ?? null,
            file: context.file ?? null,
            actor: context.actor ?? null,
          },
        }
      : {}),
    commands,
  }

  const dir = acceptanceDir(repo, requirementId)
  mkdirSync(dir, { recursive: true })
  const target = evidencePath(repo, requirementId, headSha)
  // A rerun for the same implementation commit overwrites "latest", but when
  // the requirement or test revision changed the previous record is archived
  // first, so old evidence is retained (and shows as stale) instead of lost.
  if (existsSync(target)) {
    try {
      const previous = JSON.parse(readFileSync(target, 'utf8'))
      if (previous.requirementHash !== evidence.requirementHash || previous.testRevision !== evidence.testRevision) {
        const historyDir = join(dir, 'history')
        mkdirSync(historyDir, { recursive: true })
        const stamp = String(previous.finishedAt ?? new Date().toISOString()).replace(/[:.]/g, '-')
        writeFileSync(join(historyDir, `${stamp}-${headSha}.json`), `${JSON.stringify(previous, null, 2)}\n`, 'utf8')
      }
    } catch {
      // A corrupt previous record must not block a fresh run; it stays on disk.
    }
  }
  writeFileSync(target, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
  return { ...plan, applied: true, result: evidence.result, evidence }
}

/** Hashes that bind one acceptance run to the requirement/test snapshot. */
function boundProvenance(root, asset, assets) {
  return {
    requirementHash: requirementContentHash({ root, asset }),
    testRevision: testRevisionHash({ asset, assets: assets ?? [] }),
  }
}
