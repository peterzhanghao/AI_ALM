import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { verifyContracts } from './contracts/verify.mjs'
import { checkReport, indexReport } from './commands.mjs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

export const VERSION = pkg.version
export const CONTRACTS_DIR = fileURLToPath(new URL('./contracts/', import.meta.url))

export const HELP = `alm ${VERSION}

Usage:
  alm <command> [options]

Commands:
  index             Print the asset index for a repository
  check             Run the ID-001 and REL-001 gates
  contract verify   Validate the five ALM contract schemas
  help              Show this help
  version           Print the CLI version

Options:
  --root <dir>      Repository root for index/check (default: cwd)
  --json            Machine-readable output where supported
  --help, -h        Show this help
  --version, -v     Print the CLI version

Exit codes:
  0 pass   1 gate failure   2 usage error   3 internal error
`

function writer(stream, fallback) {
  return stream ?? fallback
}

function parseReportOptions(args) {
  const options = { json: false, root: process.cwd() }
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--json') {
      options.json = true
      continue
    }
    if (arg === '--root') {
      const value = args[i + 1]
      if (!value || value.startsWith('--')) return { error: '--root requires a directory' }
      options.root = value
      i += 1
      continue
    }
    return { error: `unknown option: ${arg}` }
  }
  return options
}

/**
 * Run the CLI without touching process state, so tests can capture output.
 * @param {string[]} argv
 * @param {{ out?: { write(chunk: string): unknown }, err?: { write(chunk: string): unknown } }} [io]
 * @returns {Promise<number>} exit code
 */
export async function run(argv, io = {}) {
  const out = writer(io.out, process.stdout)
  const err = writer(io.err, process.stderr)

  try {
    const [command, ...rest] = argv

    if (!command || command === '--help' || command === '-h' || command === 'help') {
      out.write(HELP)
      return 0
    }

    if (command === '--version' || command === '-v' || command === 'version') {
      out.write(`${VERSION}\n`)
      return 0
    }

    if (command === 'index' || command === 'check') {
      const options = parseReportOptions(rest)
      if (options.error) {
        err.write(`alm: ${options.error}\n\n${HELP}`)
        return 2
      }

      const report = command === 'index' ? indexReport(options.root) : checkReport(options.root)
      if (report.ok === false) {
        err.write(`alm: ${report.error}\n`)
        return 2
      }

      if (options.json) {
        out.write(`${JSON.stringify(report, null, 2)}\n`)
      } else if (command === 'index') {
        out.write(`${report.assets.length} assets in ${report.root}\n`)
        for (const asset of report.assets) {
          out.write(`${asset.id}  ${asset.type}  ${asset.source.path}\n`)
        }
        for (const error of report.errors) {
          out.write(`error ${error.file}:${error.line} ${error.rule} ${error.message}\n`)
        }
      } else {
        for (const check of report.checks) {
          out.write(`${check.status.padEnd(4)} ${check.id} (${check.level})\n`)
          for (const finding of check.findings) {
            out.write(`     ${finding.file}:${finding.line} ${finding.assetId ?? '-'} ${finding.message}\n`)
          }
        }
        out.write(`check: ${report.result}\n`)
      }

      if (command === 'index') return report.errors.length > 0 ? 1 : 0
      return report.result === 'pass' ? 0 : 1
    }

    if (command === 'contract' && rest[0] === 'verify') {
      const json = rest.includes('--json')
      const result = verifyContracts(CONTRACTS_DIR)
      if (json) {
        out.write(`${JSON.stringify({ schema: 'alm.contract.verify/v1', ...result }, null, 2)}\n`)
      } else {
        for (const contract of result.checked) out.write(`ok      ${contract.file}  ${contract.id}\n`)
        for (const contract of result.missing) out.write(`missing ${contract.file}  ${contract.id}\n`)
        for (const contract of result.invalid) {
          out.write(`invalid ${contract.file}: ${contract.message}\n`)
        }
        out.write(result.ok ? 'contracts: ok\n' : 'contracts: failed\n')
      }
      return result.ok ? 0 : 1
    }

    err.write(`alm: unknown command: ${argv.join(' ')}\n\n${HELP}`)
    return 2
  } catch (error) {
    err.write(`alm: internal error: ${error?.message ?? String(error)}\n`)
    return 3
  }
}
