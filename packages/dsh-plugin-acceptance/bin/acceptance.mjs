#!/usr/bin/env node
/**
 * CLI for the plugin acceptance bench.
 *
 * Exit codes follow the repository convention: 0 pass, 1 fail/blocked,
 * 2 usage error, 3 internal error — so CI can gate on it without parsing text.
 *
 * Usage:
 *   node packages/dsh-plugin-acceptance/bin/acceptance.mjs run --plugin @ai-alm/dsh-plugin-requirements
 *   node packages/dsh-plugin-acceptance/bin/acceptance.mjs rounds --plugin @ai-alm/dsh-plugin-requirements
 *   node packages/dsh-plugin-acceptance/bin/acceptance.mjs show --plugin ... --round 001
 *   node packages/dsh-plugin-acceptance/bin/acceptance.mjs review --plugin ... --round 001 --reviews acceptance-reviews-xxx.json
 */
import { resolve } from 'node:path'
import { listAcceptanceRounds, reviewAcceptance, runAcceptance, showRound } from '../engine/index.mjs'

const USAGE = `alm-acceptance <command> [options]

commands
  run      run one acceptance round (default)
  rounds   list rounds for a plugin
  show     show one round with its review state
  review   record review decisions for a round

common options
  --plugin <name>        plugin package name under test (required)
  --root <dir>           workspace root (default: current directory)
  --json                 print the structured result instead of a summary

run options
  --requirement <id>     requirement this round is evidence for
  --level <L1|L2>        evidence level (default L1)
  --scenario <path>      scenario file or directory (repeatable)
  --id <scenario-id>     only these scenarios (repeatable)
  --expect-head <sha>    block the round unless HEAD matches

show / review options
  --round <id>           round id, e.g. 001
  --reviews <file>       acceptance-reviews-*.json exported from report.html
  --accept <check>       accept a check id (repeatable)
  --reject <check>       reject a check id (repeatable)
  --comment <text>       comment recorded with the decisions given here
  --round-accept / --round-reject
`

const BOOLEAN = new Set(['json', 'round-accept', 'round-reject', 'help'])
const MULTI = new Set(['scenario', 'id', 'accept', 'reject'])

function parseArgs(argv) {
  const options = { _: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith('--')) {
      options._.push(arg)
      continue
    }
    const name = arg.slice(2)
    if (BOOLEAN.has(name)) {
      options[name] = true
      continue
    }
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) throw new UsageError(`--${name} requires a value`)
    index += 1
    if (MULTI.has(name)) (options[name] ??= []).push(value)
    else options[name] = value
  }
  return options
}

class UsageError extends Error {}

function requireOption(options, name) {
  const value = options[name]
  if (value === undefined || value === '') throw new UsageError(`--${name} is required`)
  return value
}

function printRoundSummary(result) {
  const lines = [
    `${result.plugin} 轮次 ${result.roundId} · ${result.level} · ${result.verdict}`,
    `通过 ${result.stats.pass} / 失败 ${result.stats.fail} / 阻塞 ${result.stats.blocked}`,
  ]
  for (const entry of result.cases) {
    lines.push(`  ${entry.status.padEnd(7)} ${entry.id}  ${entry.title}`)
  }
  for (const failure of result.failures) {
    lines.push(`\n失败 ${failure.check}：${failure.reason}`)
    for (const evidence of failure.evidence) lines.push(`  证据 ${evidence}`)
    for (const repro of failure.repro) lines.push(`  复现 ${repro}`)
  }
  if (result.subject?.dirty) lines.push(`\n注意：工作区有未提交改动，证据对应 HEAD ${String(result.subject.headSha).slice(0, 12)} 之上的代码。`)
  if (result.drift?.length) lines.push(`\n与上一轮的代码差异：${result.drift.join('；')}`)
  lines.push(`\n报告 ${result.report}`)
  lines.push(`目录 ${result.roundDir}`)
  console.log(lines.join('\n'))
}

async function main() {
  const [command = 'run', ...rest] = process.argv.slice(2)
  if (command === '--help' || command === 'help') {
    console.log(USAGE)
    return 0
  }
  const options = parseArgs(rest)
  const root = resolve(options.root ?? process.cwd())

  switch (command) {
    case 'run': {
      const result = await runAcceptance({
        root,
        plugin: requireOption(options, 'plugin'),
        requirement: options.requirement ?? null,
        level: options.level ?? 'L1',
        scenarios: options.scenario ?? [],
        ids: options.id ?? [],
        expectHead: options['expect-head'] ?? null,
      })
      if (options.json) console.log(JSON.stringify(result, null, 2))
      else printRoundSummary(result)
      return result.verdict === 'pass' ? 0 : 1
    }
    case 'rounds': {
      const rounds = listAcceptanceRounds({
        root,
        plugin: requireOption(options, 'plugin'),
        requirement: options.requirement ?? null,
      })
      if (options.json) {
        console.log(JSON.stringify({ rounds }, null, 2))
        return 0
      }
      if (rounds.length === 0) {
        console.log('还没有验收轮次')
        return 0
      }
      for (const round of rounds) {
        const stats = round.stats ? `通过 ${round.stats.pass} / 失败 ${round.stats.fail} / 阻塞 ${round.stats.blocked}` : round.status
        console.log(`${round.roundId}  ${String(round.verdict ?? round.status).padEnd(8)} ${stats}  ${round.finishedAt ?? ''}`)
      }
      return 0
    }
    case 'show': {
      const result = showRound({
        root,
        plugin: requireOption(options, 'plugin'),
        roundId: requireOption(options, 'round'),
      })
      if (options.json) {
        console.log(JSON.stringify(result, null, 2))
        return 0
      }
      console.log(`${result.round.plugin} 轮次 ${result.round.roundId} · ${result.round.verdict}`)
      for (const entry of result.round.cases ?? []) {
        const decision = result.decisions.checks[entry.id]
        console.log(`  ${entry.status.padEnd(7)} ${entry.id.padEnd(28)} ${decision ? decision.action : '未评审'}`)
      }
      if (result.gaps.length) console.log(`\n待评审 ${result.gaps.length} 项：${result.gaps.map((gap) => gap.check).join(', ')}`)
      if (result.drift.length) console.log(`\n与当前代码不一致：${result.drift.join('；')}`)
      console.log(`\n报告 ${result.report}`)
      return 0
    }
    case 'review': {
      const decisions = []
      for (const check of options.accept ?? []) decisions.push({ check, action: 'accept', comment: options.comment ?? '' })
      for (const check of options.reject ?? []) decisions.push({ check, action: 'reject', comment: options.comment ?? '' })
      if (options['round-accept']) decisions.push({ action: 'accept', comment: options.comment ?? '' })
      if (options['round-reject']) decisions.push({ action: 'reject', comment: options.comment ?? '' })
      if (decisions.length === 0 && !options.reviews) {
        throw new UsageError('review needs --reviews <file> or --accept/--reject <check>')
      }
      const result = reviewAcceptance({
        root,
        plugin: requireOption(options, 'plugin'),
        roundId: requireOption(options, 'round'),
        decisions,
        reviewsFile: options.reviews ?? null,
      })
      if (options.json) {
        console.log(JSON.stringify(result, null, 2))
        return 0
      }
      console.log(`轮次 ${result.roundId}：已记录 ${result.events} 条决定`)
      if (result.gaps.length) console.log(`仍有 ${result.gaps.length} 项未评审：${result.gaps.map((gap) => gap.check).join(', ')}`)
      console.log(`评审记录 ${result.reviewsFile}`)
      return 0
    }
    default:
      throw new UsageError(`unknown command ${command}`)
  }
}

main().then(
  (code) => {
    process.exitCode = code
  },
  (error) => {
    if (error instanceof UsageError) {
      console.error(`${error.message}\n\n${USAGE}`)
      process.exitCode = 2
      return
    }
    console.error(error?.stack ?? String(error))
    process.exitCode = 3
  },
)
