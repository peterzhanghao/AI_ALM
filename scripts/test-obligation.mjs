#!/usr/bin/env node
/**
 * Test obligation gate: a behavior change must arrive with a test or fixture,
 * unless the PR body carries an explicit, reviewable exemption.
 *
 * This script cannot invent semantically correct tests. It guarantees the
 * process invariant that lets the regression lanes do their job:
 *   source change -> test/fixture change (or Test-Exemption reason)
 *   all `*.test.mjs` files under `packages/<pkg>/test` are auto-discovered by
 *   the root `pnpm test` glob, so a new test file needs no registration.
 *
 * Usage:
 *   node scripts/test-obligation.mjs --base origin/develop
 *   node scripts/test-obligation.mjs --base <sha> --head <sha>
 *   node scripts/test-obligation.mjs --base <sha> --head <sha> --json
 *
 * The PR body is read from --pr-body-file or the PR_BODY environment variable.
 * A valid exemption line looks like:
 *   Test-Exemption: 纯文档措辞调整，行为由现有契约测试覆盖
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SOURCE_PATTERNS = [
  /^packages\/[^/]+\/src\//,
  /^packages\/[^/]+\/bin\//,
  /^packages\/[^/]+\/(?:index|service|query|render|client)\.(?:js|mjs)$/,
]

const TEST_PATTERNS = [
  // The root `pnpm test` glob only executes `*.test.mjs`; a helper change
  // alone must not be able to satisfy the obligation.
  /^packages\/[^/]+\/test\/.*\.test\.mjs$/,
  /^packages\/[^/]+\/test\/fixtures\//,
  /^fixtures\//,
]

const EXEMPTION_PATTERN = /(?:^|\r?\n)\s*Test-Exemption:\s*([^\r\n]+)/i
const MIN_EXEMPTION_LENGTH = 10

function normalize(file) {
  return file.replaceAll('\\', '/').replace(/^\.\//, '')
}

/** @returns {'source' | 'test' | 'other'} */
export function classifyFile(file) {
  const path = normalize(file)
  if (TEST_PATTERNS.some((pattern) => pattern.test(path))) return 'test'
  if (SOURCE_PATTERNS.some((pattern) => pattern.test(path))) return 'source'
  return 'other'
}

/** Remove comments and fenced blocks so quoted examples cannot exempt a PR. */
export function stripNonProse(body = '') {
  return String(body)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/```[\s\S]*?```/g, '')
}

export function parseExemption(body = '') {
  const match = EXEMPTION_PATTERN.exec(stripNonProse(body))
  const reason = match?.[1]?.trim() ?? ''
  const hasContent = /[\p{L}\p{N}]/u.test(reason)
  return reason.length >= MIN_EXEMPTION_LENGTH && hasContent ? reason : null
}

export function suggestedTestPaths(file) {
  const path = normalize(file)
  const match = /^packages\/([^/]+)\//.exec(path)
  if (!match) return []
  const pkg = match[1]
  if (pkg === 'alm-core') {
    return [
      'packages/alm-core/test/unit/<area>.test.mjs',
      'packages/alm-core/test/integration/<area>.test.mjs',
    ]
  }
  return [`packages/${pkg}/test/<area>.test.mjs`]
}

/**
 * @param {{ files: string[], prBody?: string }} input
 * @returns {{
 *   status: 'not-applicable' | 'satisfied' | 'exempt' | 'missing',
 *   sources: string[],
 *   tests: string[],
 *   other: string[],
 *   exemption: string | null,
 *   suggestions: string[]
 * }}
 */
export function evaluateObligation({ files, prBody = '' }) {
  const changed = [...new Set((files ?? []).map(normalize).filter(Boolean))]
  const sources = changed.filter((file) => classifyFile(file) === 'source')
  const tests = changed.filter((file) => classifyFile(file) === 'test')
  const other = changed.filter((file) => classifyFile(file) === 'other')
  const exemption = parseExemption(prBody)

  if (sources.length === 0) {
    return { status: 'not-applicable', sources, tests, other, exemption: null, suggestions: [] }
  }
  if (tests.length > 0) {
    return { status: 'satisfied', sources, tests, other, exemption: null, suggestions: [] }
  }
  if (exemption) {
    return { status: 'exempt', sources, tests, other, exemption, suggestions: [] }
  }

  const suggestions = [...new Set(sources.flatMap(suggestedTestPaths))]
  return { status: 'missing', sources, tests, other, exemption: null, suggestions }
}

function gitLines(args, label) {
  const result = spawnSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.error || result.status !== 0) {
    const detail = result.error?.message ?? result.stderr?.trim() ?? 'git failed'
    throw new Error(`${label}: ${detail}`)
  }
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

function changedFiles(base, head, worktree = false) {
  const range = worktree ? base : `${base}...${head}`
  const files = gitLines(
    ['diff', '--name-only', '--diff-filter=ACMRD', range],
    `cannot diff ${range}`,
  )
  if (!worktree) return files
  // Local pre-commit check: new files are untracked and absent from git diff.
  return [...new Set([...files, ...gitLines(['ls-files', '--others', '--exclude-standard'], 'cannot list untracked files')])]
}

function readPrBody(options) {
  if (typeof options['pr-body-file'] === 'string') {
    return readFileSync(resolve(options['pr-body-file']), 'utf8')
  }
  return process.env.PR_BODY ?? ''
}

function parseOptions(args) {
  const options = {}
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--json') {
      options.json = true
      continue
    }
    if (!arg.startsWith('--')) continue
    const key = arg.slice(2)
    const value = args[index + 1]
    if (value !== undefined && !value.startsWith('--')) {
      options[key] = value
      index += 1
    } else {
      options[key] = true
    }
  }
  return options
}

function printReport(report, options, evaluation) {
  if (options.json) {
    console.log(JSON.stringify({ schema: 'alm.test.obligation/v1', ...report, evaluation }, null, 2))
    return
  }

  const label = {
    'not-applicable': 'not applicable (no source changes)',
    satisfied: 'satisfied',
    exempt: 'exempt',
    missing: 'MISSING',
  }[evaluation.status]

  console.log(`test obligation: ${label}`)
  if (options.base) console.log(`base: ${options.base}`)
  if (options.head) console.log(`head: ${options.head}`)
  if (evaluation.sources.length > 0) {
    console.log('source changes:')
    for (const file of evaluation.sources) console.log(`  - ${file}`)
  }
  if (evaluation.tests.length > 0) {
    console.log('test/fixture changes:')
    for (const file of evaluation.tests) console.log(`  - ${file}`)
  }
  if (evaluation.exemption) {
    console.log(`exemption: ${evaluation.exemption}`)
  }
  if (evaluation.status === 'missing') {
    console.log('')
    console.log('Source changed without a test or fixture. Add a test, or put this line in the PR body:')
    console.log('  Test-Exemption: <至少 10 个字符的理由，需评审确认>')
    if (evaluation.suggestions.length > 0) {
      console.log('')
      console.log('suggested test locations:')
      for (const file of evaluation.suggestions) console.log(`  - ${file}`)
    }
  }
}

function main() {
  const options = parseOptions(process.argv.slice(2))
  if (options.help || options.h) {
    console.log('Usage: node scripts/test-obligation.mjs --base <ref> [--head <ref>] [--json]')
    return 0
  }
  if (typeof options.base !== 'string') {
    console.error('test-obligation: --base is required (e.g. origin/develop)')
    return 2
  }

  // Without --head, compare the base against the worktree so the check is
  // useful before the change is committed. CI always passes an explicit head.
  const worktree = typeof options.head !== 'string'
  const head = worktree ? 'WORKTREE' : options.head
  let files
  try {
    files = changedFiles(options.base, head, worktree)
  } catch (error) {
    console.error(`test-obligation: ${error.message}`)
    return 2
  }

  const evaluation = evaluateObligation({ files, prBody: readPrBody(options) })
  const report = {
    base: options.base,
    head,
    changedFiles: files,
    status: evaluation.status,
  }
  printReport(report, { ...options, head }, evaluation)
  return evaluation.status === 'missing' ? 1 : 0
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isCli) {
  process.exitCode = main()
}
