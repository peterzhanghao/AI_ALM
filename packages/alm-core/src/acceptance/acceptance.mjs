import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { run as runNodeTests } from 'node:test'
import { gitHead } from '../approvals/approval.mjs'
import { requirementContentHash, testRevisionHash, sha256 } from '../model/content-hash.mjs'
import { worktreeSnapshot } from '../requirements/worktree-snapshot.mjs'
import { MAX_VERIFICATION_TEST_FILES, snapshotTestFileHashes, verificationBudget, verificationCommandDiagnosis, verificationTestFiles, verifyTestFileHashes } from '../requirements/blueprint-guard.mjs'

export const ACCEPTANCE_DIR = '.alm/acceptance'
export const ACCEPTANCE_SCHEMA = 'alm.acceptance/v3'
export const ACCEPTANCE_SCHEMA_V2 = 'alm.acceptance/v2'
/** Read-only compatibility: evidence written before the provenance upgrade. */
export const ACCEPTANCE_SCHEMA_V1 = 'alm.acceptance/v1'
export const ACCEPTANCE_SUMMARY_SCHEMA = 'alm.acceptance.summary/v3'
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

/**
 * Windows has no exec bit: `pnpm` resolves to `pnpm.cmd` somewhere on PATH,
 * and Node cannot spawn a .cmd/.bat without a shell. Resolving the shim
 * ourselves keeps the acceptance command working from the GUI host (whose PATH
 * may also lack the shim directory), while leaving plain executables shell-free.
 * Pure and injectable so both platforms are testable on one machine.
 */
export function resolveSpawn(command, { platform = process.platform, env = process.env, exists = existsSync, nodeDir = dirname(process.execPath) } = {}) {
  const file = String(command ?? '')
  if (!file) return { file, shell: false, resolved: false }
  if (platform !== 'win32') return { file, shell: false, resolved: false }
  if (/.(exe|com)$/i.test(file)) return { file, shell: false, resolved: false }
  if (/.(cmd|bat)$/i.test(file)) return { file, shell: true, resolved: true }
  const exts = String(env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
  const dirs = [
    ...String(env.PATH ?? env.Path ?? '')
      .split(platform === 'win32' ? ';' : ':')
      .filter(Boolean),
    nodeDir,
    env.APPDATA ? join(env.APPDATA, 'npm') : null,
    env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'pnpm') : null,
  ].filter(Boolean)
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = join(dir, file + ext)
      if (exists(candidate)) return { file: candidate, shell: /.(cmd|bat)$/i.test(candidate), resolved: true }
    }
  }
  // Nothing on disk: let the executor report the spawn failure as evidence.
  return { file, shell: false, resolved: false }
}

/** One command line for the shell cases; arguments are quoted, never concatenated raw. */
export function shellCommandLine(file, args = []) {
  const quote = (value) => {
    const text = String(value ?? '')
    return /[\s"&|<>^()]/.test(text) || text === '' ? '"' + text.replace(/"/g, '\\"') + '"' : text
  }
  return [quote(file), ...args.map(quote)].join(' ')
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

export function isUnscopedNodeTestCommand(command) {
  if (!Array.isArray(command) || command[0] !== 'node' || !command.includes('--test')) return false
  const testIndex = command.indexOf('--test')
  return !command.slice(testIndex + 1).some((part) => part && !part.startsWith('-'))
}

/**
 * Broad package scripts have no requirement boundary. They are prohibited for
 * single-requirement acceptance, whether suggested by the system or entered
 * manually.
 */
export function isGenericTestCommand(command) {
  if (!Array.isArray(command) || command.length === 0) return false
  if (isUnscopedNodeTestCommand(command)) return true
  if (!['pnpm', 'npm'].includes(command[0])) return false
  return (command.length === 2 && command[1] === 'test') ||
    (command.length === 3 && command[1] === 'run' && command[2] === 'test')
}

function genericTestCommandError(index) {
  return new AcceptanceError(
    `command ${index + 1} uses a repository-wide test script; provide explicit requirement test paths, for example: node --test packages/example/test/feature.test.mjs`,
    { code: 'generic-test-command', status: 409 },
  )
}

function normalizeCommands(raw, { allowLegacyGeneric = false } = {}) {
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
    if (isUnscopedNodeTestCommand(command)) {
      if (!allowLegacyGeneric) {
        throw new AcceptanceError(
          `command ${index + 1} uses unscoped "node --test"; provide requirement test paths, for example: node --test packages/example/test/feature.test.mjs`,
          { code: 'test-scope-required', status: 409 },
        )
      }
    }
    if (isGenericTestCommand(command) && !allowLegacyGeneric) throw genericTestCommandError(index)
    const timeoutMs = Number(entry.timeoutMs ?? 120_000)
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT) {
      throw new AcceptanceError(`command ${index + 1} timeoutMs must be 1-${MAX_TIMEOUT}`, { code: 'invalid-timeout' })
    }
    return { id: entry.id ?? `cmd-${index + 1}`, command: [...command], timeoutMs }
  })
}

/**
 * Split a user-entered command line into argv. Accepts double/single quoted
 * groups and rejects shell operators: acceptance commands never run a shell,
 * so `node --test | tee` must fail loudly instead of silently dropping `| tee`.
 */
export function parseCommandArgs(text) {
  const input = String(text ?? '').trim()
  if (!input) throw new AcceptanceError('验收命令不能为空', { code: 'command-required' })
  if (/[;&|<>$`\n\r]/.test(input.replace(/&&/g, '\u0000'))) {
    throw new AcceptanceError('验收命令不支持 shell 语法（| ; & > < $ ` 换行）', { code: 'shell-not-allowed' })
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
  if (quote) throw new AcceptanceError('验收命令的引号没有闭合', { code: 'command-invalid' })
  if (current) args.push(current)
  if (args.length === 0) throw new AcceptanceError('验收命令不能为空', { code: 'command-required' })
  return args
}

/**
 * Registration-side scale guard. Reading a legacy config stays permissive so
 * preflight can replace an oversized binding; a write must never create one.
 * An under-budget command is lifted to the budget its file count needs instead
 * of being allowed to time out a delivery round.
 */
export function enforceVerificationScale(commands) {
  return commands.map((entry) => {
    const files = verificationTestFiles(entry.command)
    if (files.length === 0) return entry
    const diagnosis = verificationCommandDiagnosis(entry.command, entry.timeoutMs)
    if (diagnosis.oversized) {
      throw new AcceptanceError(
        `验收命令包含 ${files.length} 个测试文件，超出单条上限 ${MAX_VERIFICATION_TEST_FILES}；请收窄为本需求用例或拆成多条命令。`,
        { code: 'verification-scale-exceeded', status: 409 },
      )
    }
    return entry.timeoutMs < diagnosis.requiredTimeoutMs
      ? { ...entry, timeoutMs: diagnosis.requiredTimeoutMs }
      : entry
  })
}

/** Normalize a registration request into `{id, command, timeoutMs}` entries. */
export function normalizeAcceptanceCommands(input) {
  const raw = Array.isArray(input) ? input : [{ id: 'verify', command: input }]
  return enforceVerificationScale(normalizeCommands(
    raw.map((entry, index) => {
      if (typeof entry === 'string') return { id: `cmd-${index + 1}`, command: parseCommandArgs(entry) }
      const command = typeof entry?.command === 'string' ? parseCommandArgs(entry.command) : entry?.command
      return { id: entry?.id ?? `cmd-${index + 1}`, command, timeoutMs: entry?.timeoutMs }
    }),
  ))
}

/** Dry-run view of a command registry write. */
export function planAcceptanceConfig({ root, requirementId, commands }) {
  if (!requirementId) throw new AcceptanceError('requirementId is required', { code: 'requirement-required' })
  const repo = resolve(root)
  return {
    schema: 'alm.acceptance.config.plan/v1',
    requirement: requirementId,
    file: configPath(repo, requirementId),
    commands: normalizeAcceptanceCommands(commands),
    applied: false,
  }
}

/** Atomically write `.alm/acceptance/<REQ>.json`; the previous file is replaced only on success. */
export function applyAcceptanceConfig({ root, requirementId, commands, writeFile = writeFileSync }) {
  const plan = planAcceptanceConfig({ root, requirementId, commands })
  const repo = resolve(root)
  mkdirSync(join(repo, ACCEPTANCE_DIR), { recursive: true })
  const payload = { schema: CONFIG_SCHEMA, requirement: plan.requirement, commands: plan.commands }
  const temp = `${plan.file}.tmp-${process.pid}-${Date.now()}`
  writeFile(temp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  renameSync(temp, plan.file)
  return { ...plan, applied: true }
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
    // Keep legacy generic configs readable so preflight can replace them with
    // a precise test set. `runAcceptance` rejects them before any process can
    // start, and new writes are rejected by normalizeAcceptanceCommands.
    commands: normalizeCommands(payload.commands, { allowLegacyGeneric: true }),
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

/** Validate execution-time content, independently of caller-supplied current flags. */
export function acceptanceBinding({ root, evidence, asset = null, assets = null, snapshot = null, config = null }) {
  const live = snapshot ?? worktreeSnapshot(root)
  const registered = config ?? readAcceptanceConfig(root, evidence?.requirement)
  if (evidence?.schema !== ACCEPTANCE_SCHEMA) return { current: false, reason: 'worktree-unbound' }
  if (!completenessOf(evidence).complete || evidence.environment?.runner !== RUNNER || evidence.source !== SOURCE) return { current: false, reason: 'incomplete' }
  const commandPass = Array.isArray(evidence.commands) && evidence.commands.length > 0 &&
    evidence.commands.every(c => c.exitCode === 0 && c.timedOut === false && !c.spawnFailed && !c.error)
  if (!['pass', 'fail'].includes(evidence.result) || (evidence.result === 'pass') !== commandPass) return { current: false, reason: 'result' }
  const binding = evidence.worktree
  if (!binding?.stable || binding.before?.complete !== true || binding.after?.complete !== true ||
    binding.before.treeHash !== binding.after.treeHash || !live.complete) return { current: false, reason: 'worktree-incomplete' }
  if (binding.before.headSha !== evidence.headSha || binding.after.headSha !== evidence.headSha ||
    binding.after.treeHash !== live.treeHash || evidence.headSha !== live.headSha) return { current: false, reason: 'worktree' }
  if (!registered || evidence.configHash !== sha256(registered.commands)) return { current: false, reason: 'config' }
  if (asset && evidence.requirement !== asset.id) return { current: false, reason: 'requirement' }
  const executed = evidence.commands?.map(({ id, command }) => ({ id, command }))
  const expected = registered.commands.map(({ id, command }) => ({ id, command }))
  if (JSON.stringify(executed) !== JSON.stringify(expected)) return { current: false, reason: 'config' }
  if (asset && evidence.requirementHash !== requirementContentHash({ root, asset })) return { current: false, reason: 'requirement' }
  if (asset && assets && evidence.testRevision !== testRevisionHash({ asset, assets })) return { current: false, reason: 'tests' }
  return { current: true, reason: null }
}

/** Evidence is "complete" only when the full provenance chain is present. */
function completenessOf(evidence) {
  const missing = []
  if (!evidence.requirementHash) missing.push('requirementHash')
  if (!evidence.testRevision) missing.push('testRevision')
  if (!evidence.environment) missing.push('environment')
  if (!evidence.source) missing.push('source')
  if (!evidence.worktree?.stable) missing.push('worktree')
  if (!evidence.configHash) missing.push('configHash')
  const complete =
    evidence.schema === ACCEPTANCE_SCHEMA &&
    Boolean(evidence.headSha) &&
    Boolean(evidence.requirementHash) &&
    Boolean(evidence.testRevision) &&
    Boolean(evidence.environment) &&
    Boolean(evidence.source) && Boolean(evidence.configHash) && evidence.worktree?.stable === true &&
    evidence.worktree.before?.complete === true && evidence.worktree.after?.complete === true
  return { complete, missing }
}

function diagnosticLog(value, max = 4000) {
  return String(value ?? '')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi, '$1[已隐藏]')
    .replace(/\b(api[_-]?key|access[_-]?token|token|password|secret)\s*([=:])\s*[^\s,;]+/gi, '$1$2[已隐藏]')
    .slice(-max)
}

/** A small, user-facing failure receipt. Full evidence stays on disk. */
function latestDiagnostic(evidence) {
  const tampered = evidence?.failure?.code === 'tampered_test'
  const failed = Array.isArray(evidence?.commands)
    ? evidence.commands.find(entry => entry?.exitCode !== 0 || entry?.timedOut || entry?.spawnFailed || entry?.error)
    : null
  if (!tampered && !failed) return null
  const command = Array.isArray(failed?.command) ? failed.command : null
  const log = diagnosticLog([failed?.stderr, failed?.stdout, failed?.error?.message, evidence?.failure?.message].filter(Boolean).join('\n'))
  const line = log.split(/\r?\n/).map(value => value.trim()).find(value => /(?:not ok|assert(?:ion)?error|error:|expected|failed|fail)/i.test(value)) ?? log.split(/\r?\n/).map(value => value.trim()).find(Boolean) ?? null
  if (tampered) return { category: 'tampered-test', title: '测试断言防篡改锁已触发', summary: evidence.failure.message ?? '验收期间检测到测试文件被修改', command, log }
  if (failed?.timedOut) {
    const fileCount = verificationTestFiles(failed.command).length
    const oversized = fileCount > MAX_VERIFICATION_TEST_FILES
    return {
      category: 'timeout',
      title: '验证命令超时',
      summary: oversized
        ? `验证命令包含 ${fileCount} 个测试文件，超出单条上限 ${MAX_VERIFICATION_TEST_FILES}，预算内无法跑完；请收窄验收命令为本需求用例，再重新验证。`
        : `验证命令在限定时间内未完成${command ? `：${command.join(' ')}` : ''}；请缩小测试范围或提高超时预算后重新验证。`,
      command,
      log,
      ...(oversized ? { scale: { fileCount, max: MAX_VERIFICATION_TEST_FILES } } : {}),
    }
  }
  if (failed?.spawnFailed || failed?.error) return { category: 'environment', title: '验证环境或命令受阻', summary: failed?.error?.message ?? `无法启动验证命令${command ? `：${command.join(' ')}` : ''}`, command, log }
  return { category: 'verification', title: '验证检查未通过', summary: `验证命令失败${Number.isInteger(failed?.exitCode) ? `（exit ${failed.exitCode}）` : ''}${line ? `：${line}` : ''}`, command, log }
}

/**
 * Compact summary for the requirements payload. With `context = {asset, assets}`
 * the latest evidence is current only if it is complete and bound to the same
 * HEAD, requirement content hash, test revision, command registry and stable
 * execution-time worktree. Legacy v1/v2 remain readable but never current.
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
    if (evidence.schema !== ACCEPTANCE_SCHEMA) {
      staleReason = 'worktree-unbound'
    } else if (!complete) {
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
    const binding = acceptanceBinding({ root, evidence, asset: context?.asset, assets: context?.assets, config,
      snapshot: context?.readContext?.worktreeSnapshot ? context.readContext.worktreeSnapshot(root) : null })
    if (!binding.current) { current = false; if (complete || evidence.schema !== ACCEPTANCE_SCHEMA) staleReason = binding.reason }
    latest = {
      worktree: evidence.worktree ?? null,
      configHash: evidence.configHash ?? null,
      schema: evidence.schema,
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
      diagnostic: latestDiagnostic(evidence),
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
 * writes; apply executes registered argv (Windows shims use the guarded shell
 * adapter) and writes v3 evidence keyed by HEAD. Every differing previous raw
 * receipt is content-addressed in history. Currentness requires stable complete
 * execution-time worktree snapshots plus command registry and context binding
 * (requirement hash, test revision, environment, source).
 */
/**
 * Record one command execution. `spawnSync` reports spawn failures (EPERM,
 * ENOENT, ...) through `error` while `status` stays null and stderr stays
 * empty; keeping that error in the evidence is what separates an actionable
 * red run from an unexplained one. Pure on purpose, so the mapping can be
 * tested without spawning a process.
 */
export function commandRunRecord({ entry, result, durationMs, maxOutput = MAX_OUTPUT }) {
  const error = result?.error ?? null
  const errorCode = typeof error?.code === 'string' ? error.code : error ? 'exec-failed' : null
  const errorMessage = error
    ? String(error.message ?? errorCode ?? 'exec failed')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 500)
    : null
  const timedOut = error?.code === 'ETIMEDOUT' || result?.signal === 'SIGTERM'
  return {
    id: entry.id,
    command: entry.command,
    exitCode: typeof result?.status === 'number' ? result.status : null,
    timedOut,
    spawnFailed: Boolean(error) && !timedOut,
    durationMs,
    error: error ? { code: errorCode, message: errorMessage } : null,
    ...(typeof result?.signal === 'string' ? { signal: result.signal } : {}),
    stdout: String(result?.stdout ?? '').slice(-maxOutput),
    stderr: String(result?.stderr ?? '').slice(-maxOutput),
  }
}

function persistEvidence(repo, requirementId, headSha, evidence) {
  const dir = acceptanceDir(repo, requirementId)
  mkdirSync(dir, { recursive: true })
  const target = evidencePath(repo, requirementId, headSha)
  // Preserve every different receipt's exact bytes, including malformed legacy
  // payloads. Content-addressing avoids same-timestamp archival collisions.
  if (existsSync(target)) {
    const previous = readFileSync(target)
    const next = Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`)
    if (!previous.equals(next)) {
      const historyDir = join(dir, 'history')
      mkdirSync(historyDir, { recursive: true })
      const archived = join(historyDir, `${headSha}-${createHash('sha256').update(previous).digest('hex')}.json`)
      try { writeFileSync(archived, previous, { flag: 'wx' }) }
      catch (error) { if (error.code !== 'EEXIST') throw error }
    }
  }
  writeFileSync(target, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
  return target
}

function isSandboxSpawnError(command) {
  return command?.spawnFailed === true && ['EPERM', 'EACCES'].includes(command?.error?.code)
}

function isTimingOutCommand(command) {
  return command?.timedOut === true || command?.error?.code === 'ETIMEDOUT'
}

/**
 * Both a blocked child process and a killed `spawnSync` can be retried by the
 * in-process Node runner. The host (where spawn works) previously had no
 * recovery from a timeout at all; the sandbox did. Keep the two paths equal.
 */
function canRetryInProcess(repo, command, entry) {
  return (isSandboxSpawnError(command) || isTimingOutCommand(command)) && Boolean(inProcessNodeTestSpec(repo, entry?.command))
}

/** Only explicit, repository-local `node --test file.test.mjs` commands may run in-process. */
function inProcessNodeTestSpec(repo, command) {
  if (!Array.isArray(command) || command[0] !== 'node') return null
  const index = command.indexOf('--test')
  if (index < 0) return null
  const files = []
  const testNamePatterns = []
  for (let cursor = index + 1; cursor < command.length; cursor += 1) {
    const part = command[cursor]
    if (part === '--test-name-pattern') {
      const pattern = command[++cursor]
      if (!pattern) return null
      testNamePatterns.push(pattern)
    } else if (part.startsWith('--test-name-pattern=')) {
      testNamePatterns.push(part.slice('--test-name-pattern='.length))
    } else if (part.startsWith('-')) {
      // The fallback intentionally supports the narrow command shape inferred
      // by preflight; unrecognised runner options must remain a real failure.
      return null
    } else {
      const file = resolve(repo, part)
      const scoped = relative(repo, file)
      if (!scoped || isAbsolute(scoped) || scoped === '..' || scoped.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) ||
        !/\.test\.[cm]?js$/i.test(file) || !existsSync(file) || !statSync(file).isFile()) return null
      files.push(file)
    }
  }
  return files.length > 0 ? { files, testNamePatterns } : null
}

function eventErrorText(event) {
  const error = event?.data?.details?.error
  return String(error?.message ?? error?.stack ?? event?.data?.name ?? 'unknown test failure').trim()
}

/**
 * Runs Node's test engine without `child_process`. This is deliberately limited
 * to the fast, explicit Node test commands generated by preflight, preserving
 * the same assertions and test-file lock as a normal acceptance run.
 */
async function runInProcessNodeTests({ repo, entry }) {
  const spec = inProcessNodeTestSpec(repo, entry.command)
  if (!spec) return null
  const started = Date.now()
  let timedOut = false
  const passed = []
  const failed = []
  try {
    // Re-running a timed-out command with the same doomed budget cannot heal
    // it. The fallback gets the budget its file count needs, capped at 180s.
    const options = { files: spec.files, cwd: repo, isolation: 'none',
      timeout: Math.max(Number(entry.timeoutMs) || 0, verificationBudget(spec.files.length)) }
    if (spec.testNamePatterns.length) options.testNamePatterns = spec.testNamePatterns
    for await (const event of runNodeTests(options)) {
      if (event.type === 'test:pass') passed.push(event.data?.name ?? 'unnamed test')
      if (event.type === 'test:fail') failed.push(eventErrorText(event))
    }
  } catch (error) {
    if (error?.code === 'ABORT_ERR' || error?.code === 'ETIMEDOUT') timedOut = true
    else failed.push(String(error?.message ?? error))
  }
  const stdout = passed.map(name => `ok - ${name}`).join('\n')
  const stderr = failed.map(message => `not ok - ${message}`).join('\n')
  return {
    status: timedOut || failed.length ? 1 : 0,
    signal: timedOut ? 'SIGTERM' : null,
    stdout,
    stderr,
    timedOut,
    durationMs: Date.now() - started,
    execution: { mode: 'in-process-esm-runner', files: spec.files.map(file => relative(repo, file).replaceAll('\\', '/')) },
  }
}

export function runAcceptance({ root, requirementId, apply = false, exec = spawnSync, context = null }) {
  const repo = resolve(root)
  if (!requirementId) throw new AcceptanceError('requirementId is required', { code: 'requirement-required' })
  const headSha = gitHead(repo)
  if (!headSha) throw new AcceptanceError('acceptance needs a git repository with a HEAD commit', { code: 'not-a-git-repo' })
  const config = readAcceptanceConfig(repo, requirementId)
  if (!config) {
    throw new AcceptanceError(`未登记验收命令：${configPath(repo, requirementId)}`, { code: 'no-config', status: 404 })
  }
  const unscoped = config.commands.find(entry => isUnscopedNodeTestCommand(entry.command))
  if (unscoped) {
    throw new AcceptanceError(
      `command ${unscoped.id} uses unscoped "node --test"; provide requirement test paths`,
      { code: 'test-scope-required', status: 409 },
    )
  }
  const generic = config.commands.find(entry => isGenericTestCommand(entry.command))
  if (generic) throw genericTestCommandError(config.commands.indexOf(generic))
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

  const before = worktreeSnapshot(repo)
  // Tests are the acceptance contract. Keep their exact bytes around the
  // command execution so a green exit code cannot be manufactured by weakening
  // an assertion halfway through a repair.
  const testFileHashes = snapshotTestFileHashes({ root: repo, commands: config.commands })
  const beforeProvenance = bound ? boundProvenance(repo, context.asset, context.assets) : { requirementHash: null, testRevision: null }
  const configHash = sha256(config.commands)
  const startedAt = new Date().toISOString()
  const commands = config.commands.map((entry) => {
    const started = Date.now()
    let result
    try {
      const spawn = resolveSpawn(entry.command[0])
      const args = entry.command.slice(1)
      result = spawn.shell
        ? exec(shellCommandLine(spawn.file, args), [], {
            cwd: repo,
            encoding: 'utf8',
            timeout: entry.timeoutMs,
            maxBuffer: 20 * 1024 * 1024,
            windowsHide: true,
            shell: true,
          })
        : exec(spawn.file, args, {
            cwd: repo,
            encoding: 'utf8',
            timeout: entry.timeoutMs,
            maxBuffer: 20 * 1024 * 1024,
            windowsHide: true,
          })
    } catch (error) {
      // A throwing executor must still leave evidence behind instead of
      // aborting the run before the record is written.
      result = { error }
    }
    return commandRunRecord({ entry, result, durationMs: Date.now() - started })
  })
  const finishedAt = new Date().toISOString()
  const testLock = verifyTestFileHashes({ root: repo, expected: testFileHashes })
  const passed = commands.every((entry) => entry.exitCode === 0 && !entry.timedOut && !entry.error) && testLock.ok
  const provenance = bound ? boundProvenance(repo, context.asset, context.assets) : { requirementHash: null, testRevision: null }
  const after = worktreeSnapshot(repo)
  let afterConfig = null
  try { afterConfig = readAcceptanceConfig(repo, requirementId) } catch {}
  const stable = before.complete && after.complete && before.treeHash === after.treeHash &&
    JSON.stringify(beforeProvenance) === JSON.stringify(provenance) && afterConfig && sha256(afterConfig.commands) === configHash
  const compact = ({ headSha, treeHash, complete }) => ({ headSha, treeHash, complete })
  const evidence = {
    schema: ACCEPTANCE_SCHEMA,
    configHash,
    worktree: { before: compact(before), after: compact(after), stable: Boolean(stable) },
    requirement: requirementId,
    revision: 3,
    requirementHash: provenance.requirementHash,
    testRevision: provenance.testRevision,
    headSha,
    result: passed ? 'pass' : 'fail',
    testFileHashes,
    ...(testLock.ok ? {} : { failure: { code: 'tampered_test', message: `验收期间测试文件被修改：${testLock.changed.join('、')}`, files: testLock.changed } }),
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

  persistEvidence(repo, requirementId, headSha, evidence)
  return { ...plan, applied: true, result: evidence.result, evidence }
}

/**
 * Execute acceptance with a narrowly-scoped sandbox fallback. The synchronous
 * API remains available to CLI callers; host delivery uses this async form so
 * an EPERM from `child_process.spawn` can run the same Node tests in-process.
 */
export async function runAcceptanceAdaptive(options) {
  const receipt = runAcceptance(options)
  if (!options?.apply || receipt.result !== 'fail') return receipt
  const repo = resolve(options.root)
  const eligible = receipt.evidence.commands
    .map((command, index) => ({ command, entry: receipt.commands[index] }))
    .filter(({ command, entry }) => canRetryInProcess(repo, command, entry))
  if (eligible.length === 0) return receipt

  // A failed spawn cannot have executed test code. Snapshot again around the
  // fallback nevertheless, so an in-process test still cannot mutate tests,
  // config, requirement content, or the delivered worktree undetected.
  const before = worktreeSnapshot(repo)
  const testFileHashes = snapshotTestFileHashes({ root: repo, commands: receipt.commands })
  const beforeProvenance = options.context?.asset
    ? boundProvenance(repo, options.context.asset, options.context.assets)
    : { requirementHash: null, testRevision: null }
  const commands = []
  for (let index = 0; index < receipt.evidence.commands.length; index += 1) {
    const original = receipt.evidence.commands[index]
    const entry = receipt.commands[index]
    if (!canRetryInProcess(repo, original, entry)) {
      commands.push(original)
      continue
    }
    const fallback = await runInProcessNodeTests({ repo, entry })
    commands.push({
      ...commandRunRecord({ entry, result: fallback, durationMs: fallback.durationMs }),
      execution: fallback.execution,
      fallback: {
        reason: isTimingOutCommand(original) ? 'verification-timeout' : original.error?.code ?? 'spawn-blocked',
        originalError: original.error?.message ?? null,
      },
    })
  }
  const testLock = verifyTestFileHashes({ root: repo, expected: testFileHashes })
  const provenance = options.context?.asset
    ? boundProvenance(repo, options.context.asset, options.context.assets)
    : { requirementHash: null, testRevision: null }
  const after = worktreeSnapshot(repo)
  let afterConfig = null
  try { afterConfig = readAcceptanceConfig(repo, receipt.requirement) } catch {}
  const stable = before.complete && after.complete && before.treeHash === after.treeHash &&
    JSON.stringify(beforeProvenance) === JSON.stringify(provenance) && afterConfig && sha256(afterConfig.commands) === receipt.evidence.configHash
  const compact = ({ headSha, treeHash, complete }) => ({ headSha, treeHash, complete })
  const passed = commands.every(command => command.exitCode === 0 && !command.timedOut && !command.error) && testLock.ok
  const evidence = {
    ...receipt.evidence,
    result: passed ? 'pass' : 'fail',
    requirementHash: provenance.requirementHash,
    testRevision: provenance.testRevision,
    testFileHashes,
    worktree: { before: compact(before), after: compact(after), stable: Boolean(stable) },
    finishedAt: new Date().toISOString(),
    environment: { ...environmentNow(), execution: 'in-process-fallback' },
    commands,
    ...(testLock.ok ? {} : { failure: { code: 'tampered_test', message: `验收期间测试文件被修改：${testLock.changed.join('、')}`, files: testLock.changed } }),
  }
  if (testLock.ok) delete evidence.failure
  persistEvidence(repo, receipt.requirement, receipt.headSha, evidence)
  return { ...receipt, result: evidence.result, evidence }
}

/** Hashes that bind one acceptance run to the requirement/test snapshot. */
function boundProvenance(root, asset, assets) {
  return {
    requirementHash: requirementContentHash({ root, asset }),
    testRevision: testRevisionHash({ asset, assets: assets ?? [] }),
  }
}
