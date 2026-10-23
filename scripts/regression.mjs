#!/usr/bin/env node
/**
 * Regression lane runner and evidence gate.
 *
 * Design notes:
 * - A lane is a named list of commands. The runner writes `result.json` even
 *   when a command fails, so the aggregate job can explain the failure instead
 *   of only seeing "job failed".
 * - `bootstrap.json` is written by the workflow before checkout. If setup
 *   fails before the runner starts, the aggregate gate still gets a lane
 *   artifact with a reason instead of silently missing evidence.
 * - `aggregate` requires every expected lane exactly once, for the current run
 *   attempt, with a matching head commit. A partially uploaded matrix is a
 *   failure, never a pass.
 *
 * Usage:
 *   node scripts/regression.mjs bootstrap --lane unit --output <dir>
 *   node scripts/regression.mjs run-lane <lane> --output <dir>
 *   node scripts/regression.mjs aggregate --input <dir> --output <dir> \
 *     --lanes unit,contract,fixtures,cli,skills --head <sha>
 */
import { spawnSync } from 'node:child_process'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const ALM = join(ROOT, 'packages', 'alm-core', 'bin', 'alm.mjs')
const NODE = process.execPath
const PNPM = process.platform === 'win32'
  ? { cmd: 'pnpm.cmd', shell: true }
  : { cmd: 'pnpm', shell: false }
// GitHub's ubuntu runners ship PowerShell 7 as `pwsh`. Local Windows shells
// may only expose Windows PowerShell 5.1; validate-skills.ps1 supports both.
const PWSH = process.platform === 'win32'
  ? { cmd: 'powershell.exe', shell: false }
  : { cmd: 'pwsh', shell: false }

const LANE_SCHEMA = 'alm.regression.lane/v1'
const BOOTSTRAP_SCHEMA = 'alm.regression.bootstrap/v1'
const SUMMARY_SCHEMA = 'alm.regression.summary/v1'
const DEFAULT_LANES = ['unit', 'contract', 'fixtures', 'cli', 'skills']

function alm(...args) {
  return { cmd: NODE, args: [ALM, ...args], shell: false }
}

const LANES = {
  unit: {
    title: '单元与集成测试',
    commands: [{ ...PNPM, args: ['test'], timeoutMs: 15 * 60_000 }],
  },
  contract: {
    title: '契约与样例门禁',
    commands: [
      { ...alm('contract', 'verify', '--json'), label: 'alm contract verify' },
      { ...alm('index', '--root', 'fixtures/order-refund', '--json'), label: 'alm index order-refund' },
      { ...alm('check', '--root', 'fixtures/order-refund'), label: 'alm check order-refund' },
      { ...alm('check', '--root', 'fixtures/smoke'), label: 'alm check smoke' },
    ],
  },
  fixtures: {
    title: '负例夹具回归',
    commands: [{ cmd: NODE, args: [join(ROOT, 'scripts', 'regression-fixtures.mjs')], shell: false }],
  },
  cli: {
    title: 'CLI 命令面',
    commands: [
      { ...alm('--help'), label: 'alm --help' },
      { ...alm('--version'), label: 'alm --version' },
      { ...alm('contract', 'verify', '--json'), label: 'alm contract verify --json' },
      { ...alm('index', '--root', 'fixtures/order-refund', '--json'), label: 'alm index --json' },
      { ...alm('check', '--root', 'fixtures/order-refund', '--json'), label: 'alm check --json' },
      { ...alm('query', '--root', 'fixtures/order-refund', '--type', 'requirement', '--json'), label: 'alm query' },
      { ...alm('show', '--root', 'fixtures/order-refund', 'REQ-PAY-001', '--json'), label: 'alm show' },
      { ...alm('trace', '--root', 'fixtures/order-refund', 'REQ-PAY-001', '--json'), label: 'alm trace' },
      { ...alm('impact', '--root', 'fixtures/order-refund', '--asset', 'REQ-PAY-001', '--json'), label: 'alm impact' },
      { ...alm('diff', '--root', 'fixtures/order-refund', '--base', 'HEAD', '--json'), label: 'alm diff' },
    ],
  },
  skills: {
    title: '技能与文档一致性',
    commands: [
      {
        cmd: PWSH.cmd,
        args: [
          '-NoProfile',
          ...(process.platform === 'win32' ? ['-ExecutionPolicy', 'Bypass'] : []),
          '-File',
          join(ROOT, 'scripts', 'validate-skills.ps1'),
        ],
        shell: PWSH.shell,
        label: 'validate-skills.ps1',
      },
      {
        cmd: NODE,
        args: [join(ROOT, 'scripts', 'check-alm-skill.mjs')],
        shell: false,
        label: 'check-alm-skill.mjs',
      },
    ],
  },
}

function usage() {
  console.log(`Regression lane runner

Usage:
  node scripts/regression.mjs bootstrap --lane <lane> --output <dir>
  node scripts/regression.mjs run-lane <lane> --output <dir>
  node scripts/regression.mjs aggregate --input <dir> --output <dir> [options]

Lanes: ${DEFAULT_LANES.join(', ')}
`)
}

function parseOptions(args) {
  const options = {}
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (!arg.startsWith('--')) continue
    const key = arg.slice(2)
    const next = args[index + 1]
    if (next !== undefined && !next.startsWith('--')) {
      options[key] = next
      index += 1
    } else {
      options[key] = true
    }
  }
  return options
}

function writeJson(file, payload) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

function gitHead() {
  try {
    const result = spawnSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    if (result.status === 0 && result.stdout.trim()) return result.stdout.trim()
  } catch {
    // The sandbox may block piped child processes; fall back to the event SHA.
  }
  return process.env.GITHUB_SHA || null
}

function headOf() {
  return gitHead() ?? process.env.GITHUB_SHA ?? null
}

function runLane(lane, output) {
  const spec = LANES[lane]
  if (!spec) {
    console.error(`unknown lane: ${lane}`)
    return false
  }

  const evidenceDir = resolve(typeof output === 'string' ? output : join(ROOT, 'tmp', 'regression', lane))
  mkdirSync(evidenceDir, { recursive: true })

  const startedAt = new Date().toISOString()
  const started = Date.now()
  const commands = []
  let failure = null
  let status = 'passed'

  for (const command of spec.commands) {
    const commandStarted = Date.now()
    const label = command.label || [command.cmd, ...command.args].join(' ')
    console.log(`\n==> [${lane}] ${label}`)
    const result = spawnSync(command.cmd, command.args, {
      cwd: ROOT,
      env: process.env,
      stdio: 'inherit',
      shell: Boolean(command.shell),
      timeout: command.timeoutMs ?? 10 * 60_000,
    })
    const entry = {
      label,
      command: [command.cmd, ...command.args].join(' '),
      exitCode: result.status,
      signal: result.signal ?? null,
      timedOut: result.error?.code === 'ETIMEDOUT',
      durationMs: Date.now() - commandStarted,
      error: result.error ? String(result.error.message) : null,
    }
    commands.push(entry)
    if (result.error || result.status !== 0) {
      status = 'failed'
      failure = entry
      break
    }
  }

  const payload = {
    schema: LANE_SCHEMA,
    lane,
    title: spec.title,
    status,
    exitCode: status === 'passed' ? 0 : 1,
    head: headOf(),
    ref: process.env.GITHUB_REF ?? null,
    repository: process.env.GITHUB_REPOSITORY ?? null,
    runId: process.env.GITHUB_RUN_ID ?? null,
    attempt: process.env.GITHUB_RUN_ATTEMPT ?? 'local',
    workflow: process.env.GITHUB_WORKFLOW ?? null,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    failure,
    commands,
  }
  writeJson(join(evidenceDir, 'result.json'), payload)

  if (status === 'passed') {
    console.log(`\nlane ${lane}: PASSED (${payload.durationMs} ms)`)
  } else {
    console.error(`\nlane ${lane}: FAILED at ${failure?.label ?? 'unknown command'} (exit ${failure?.exitCode ?? 'n/a'})`)
  }
  return status === 'passed'
}

function bootstrap(lane, output) {
  if (!LANES[lane]) {
    console.error(`unknown lane: ${lane}`)
    return false
  }
  const evidenceDir = resolve(typeof output === 'string' ? output : join(ROOT, 'tmp', 'regression', lane))
  const payload = {
    schema: BOOTSTRAP_SCHEMA,
    lane,
    status: 'bootstrap-incomplete',
    ref: process.env.GITHUB_REF ?? null,
    head: process.env.GITHUB_SHA ?? gitHead(),
    runId: process.env.GITHUB_RUN_ID ?? null,
    attempt: process.env.GITHUB_RUN_ATTEMPT ?? 'local',
    repository: process.env.GITHUB_REPOSITORY ?? null,
    startedAt: new Date().toISOString(),
  }
  writeJson(join(evidenceDir, 'bootstrap.json'), payload)
  console.log(`bootstrap ${lane}: ${join(evidenceDir, 'bootstrap.json')}`)
  return true
}

function findFiles(directory, name, depth = 0) {
  if (depth > 4 || !existsSync(directory)) return []
  const found = []
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry)
    let stat
    try {
      stat = statSync(full)
    } catch {
      continue
    }
    if (stat.isDirectory()) {
      found.push(...findFiles(full, name, depth + 1))
    } else if (entry === name) {
      found.push(full)
    }
  }
  return found
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

function attemptOf(value) {
  const number = Number.parseInt(String(value ?? '0'), 10)
  return Number.isFinite(number) ? number : 0
}

function formatDuration(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return '—'
  if (milliseconds < 1000) return `${milliseconds} ms`
  const seconds = milliseconds / 1000
  if (seconds < 60) return `${seconds.toFixed(1)} s`
  return `${(seconds / 60).toFixed(1)} min`
}

function renderSummary(summary) {
  const passed = summary.status === 'passed'
  const icon = passed ? '✅' : '❌'
  const lines = [
    `## 自动化回归：${icon} ${passed ? '通过' : '失败'}`,
    '',
    `- 目标提交：\`${summary.head ?? 'unknown'}\`${summary.ref ? `（\`${summary.ref}\`）` : ''}`,
    `- 工作流：${summary.runUrl ? `[${summary.runId ?? 'run'}](${summary.runUrl})` : `\`${summary.runId ?? 'local'}\``}`,
    `- 证据：\`${summary.artifact}\``,
    `- 生成时间：${summary.generatedAt}`,
    '',
    '| 泳道 | 结果 | 用时 | 说明 |',
    '|---|---|---|---|',
  ]

  for (const lane of summary.lanes) {
    const laneIcon = lane.status === 'passed' ? '✅' : lane.status === 'missing' ? '⚠️' : '❌'
    const detail = lane.status === 'passed'
      ? lane.title
      : lane.reason || lane.failure?.command || lane.failure?.error || 'lane failed'
    lines.push(`| \`${lane.lane}\` | ${laneIcon} ${lane.status} | ${formatDuration(lane.durationMs)} | ${detail} |`)
  }
  for (const lane of summary.unexpected ?? []) {
    lines.push(`| \`${lane}\` | ⚠️ unexpected | — | 不在期望泳道列表中 |`)
  }

  const failed = summary.lanes.filter((lane) => lane.status !== 'passed')
  if (failed.length > 0 || (summary.unexpected ?? []).length > 0) {
    lines.push('', '### 失败详情', '')
    for (const lane of failed) {
      if (lane.status === 'missing') {
        lines.push(`- \`${lane.lane}\`：没有收到该泳道的 \`result.json\`（${lane.reason}）`)
        continue
      }
      const failure = lane.failure
      if (!failure) {
        lines.push(`- \`${lane.lane}\`：${lane.reason || 'lane failed'}`)
        continue
      }
      lines.push(
        `- \`${lane.lane}\`：\`${failure.command ?? 'unknown command'}\` 退出码 ${failure.exitCode ?? 'n/a'}${failure.error ? `，${failure.error}` : ''}`,
      )
    }
    for (const lane of summary.unexpected ?? []) {
      lines.push(`- \`${lane}\`：上传了不在期望列表中的证据，聚合门禁拒绝部分/过期矩阵`)
    }
    lines.push('', '修复后在本工作流点击 **Re-run failed jobs**，或在 Actions 中手动触发 `Issue regression`。')
  } else {
    lines.push('', '所有泳道均通过；该提交可作为 Issue 收口的自动化证据。')
  }

  lines.push('', '<!-- alm-regression-summary -->', '')
  return `${lines.join('\n')}\n`
}

function aggregate(options) {
  const input = resolve(options.input)
  const output = resolve(options.output)
  const expected = options.lanes
    ? String(options.lanes).split(',').map((lane) => lane.trim()).filter(Boolean)
    : DEFAULT_LANES
  const expectedHead = options.head && options.head !== true ? String(options.head) : null
  const expectedRef = options.ref && options.ref !== true ? String(options.ref) : null
  const currentRun = process.env.GITHUB_RUN_ID
  const currentAttempt = options.attempt && options.attempt !== true
    ? String(options.attempt)
    : process.env.GITHUB_RUN_ATTEMPT

  const resultFiles = findFiles(input, 'result.json')
  const bootstrapFiles = findFiles(input, 'bootstrap.json')
  const results = []
  for (const file of resultFiles) {
    const payload = readJson(file)
    if (!payload || payload.schema !== LANE_SCHEMA || !payload.lane) continue
    if (currentRun && payload.runId && String(payload.runId) !== String(currentRun)) continue
    if (currentAttempt && payload.attempt && String(payload.attempt) !== String(currentAttempt)) continue
    results.push({ ...payload, file })
  }

  const bootstraps = new Map()
  for (const file of bootstrapFiles) {
    const payload = readJson(file)
    if (!payload || payload.schema !== BOOTSTRAP_SCHEMA || !payload.lane) continue
    bootstraps.set(payload.lane, payload)
  }

  const byLane = new Map()
  for (const result of results) {
    const previous = byLane.get(result.lane)
    if (!previous || attemptOf(result.attempt) > attemptOf(previous.attempt)) {
      byLane.set(result.lane, result)
    }
  }

  const lanes = []
  for (const lane of expected) {
    const result = byLane.get(lane)
    if (!result) {
      const bootstrapInfo = bootstraps.get(lane)
      lanes.push({
        lane,
        title: LANES[lane]?.title ?? lane,
        status: 'missing',
        reason: bootstrapInfo
          ? `bootstrap 记录了 ${bootstrapInfo.status}，但 runner 没有产出 result.json`
          : '没有下载到该泳道的证据制品',
        durationMs: 0,
        failure: null,
        commands: [],
      })
      continue
    }

    const reasons = []
    if (result.status !== 'passed') reasons.push(`lane status is ${String(result.status)}`)
    if (result.exitCode !== 0) reasons.push(`exitCode is ${String(result.exitCode)}`)
    if (expectedHead && result.head !== expectedHead) {
      reasons.push(`head ${String(result.head)} does not match target ${expectedHead}`)
    }
    lanes.push({
      lane,
      title: result.title ?? LANES[lane]?.title ?? lane,
      status: reasons.length === 0 ? 'passed' : 'failed',
      reason: reasons.join('; '),
      durationMs: result.durationMs ?? 0,
      failure: result.failure ?? null,
      commands: result.commands ?? [],
      head: result.head ?? null,
    })
  }

  const unexpected = [...byLane.keys()].filter((lane) => !expected.includes(lane))
  const status = lanes.every((lane) => lane.status === 'passed') && unexpected.length === 0
    ? 'passed'
    : 'failed'
  const runId = currentRun ?? results[0]?.runId ?? 'local'
  const server = process.env.GITHUB_SERVER_URL ?? 'https://github.com'
  const repository = process.env.GITHUB_REPOSITORY ?? results[0]?.repository ?? null
  const attempt = currentAttempt ?? results[0]?.attempt ?? 'local'
  const summary = {
    schema: SUMMARY_SCHEMA,
    status,
    head: expectedHead ?? results[0]?.head ?? null,
    ref: expectedRef ?? results[0]?.ref ?? null,
    repository,
    runId,
    attempt,
    runUrl: repository && runId !== 'local' ? `${server}/${repository}/actions/runs/${runId}` : null,
    artifact: options.artifact && options.artifact !== true
      ? String(options.artifact)
      : process.env.ALM_REGRESSION_ARTIFACT ?? `regression-evidence-${attempt}`,
    generatedAt: new Date().toISOString(),
    lanes,
    unexpected,
  }

  mkdirSync(output, { recursive: true })
  writeJson(join(output, 'summary.json'), summary)
  const markdown = renderSummary(summary)
  writeFileSync(join(output, 'summary.md'), markdown, 'utf8')
  writeFileSync(join(output, 'status.txt'), `${status}\n`, 'utf8')

  console.log(markdown)
  if (unexpected.length > 0) {
    console.error(`unexpected lane evidence: ${unexpected.join(', ')}`)
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown, 'utf8')
    } catch {
      // The step summary is a convenience; never turn a passing gate red
      // because the runner's summary file is unavailable.
    }
  }
  return status === 'passed'
}

function main() {
  const [command, ...rest] = process.argv.slice(2)
  if (!command || command === '--help' || command === '-h' || command === 'help') {
    usage()
    return 0
  }

  if (command === 'run-lane') {
    const lane = rest[0]
    if (!lane) {
      console.error('run-lane requires a lane')
      return 2
    }
    const options = parseOptions(rest.slice(1))
    return runLane(lane, options.output) ? 0 : 1
  }

  if (command === 'bootstrap') {
    const options = parseOptions(rest)
    if (!options.lane || options.lane === true) {
      console.error('bootstrap requires --lane')
      return 2
    }
    return bootstrap(String(options.lane), options.output) ? 0 : 2
  }

  if (command === 'aggregate') {
    const options = parseOptions(rest)
    if (!options.input || options.input === true || !options.output || options.output === true) {
      console.error('aggregate requires --input and --output')
      return 2
    }
    return aggregate(options) ? 0 : 1
  }

  console.error(`unknown command: ${command}`)
  usage()
  return 2
}

process.exitCode = main()
