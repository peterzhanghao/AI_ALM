import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { verifyContracts } from './contracts/verify.mjs'
import { checkReport, indexReport, queryReport, showReport } from './commands.mjs'
import { buildEvidence, writeEvidence } from './evidence/evidence.mjs'
import { BaselineConflictError, createBaseline, verifyBaseline } from './baseline/baseline.mjs'

const PACK = JSON.parse(readFileSync(new URL('./gates/pack.json', import.meta.url), 'utf8'))

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

export const VERSION = pkg.version
export const CONTRACTS_DIR = fileURLToPath(new URL('./contracts/', import.meta.url))

export const HELP = `alm ${VERSION}

Usage:
  alm <command> [options]

Commands:
  index             Print the asset index for a repository
  check             Run the R1 gates
  show <ID>         Print one asset by id
  query             List assets filtered by type/status/owner
  baseline create   Write an immutable baseline manifest for a commit
  baseline verify   Rebuild hashes and compare with a manifest
  contract verify   Validate the five ALM contract schemas
  help              Show this help
  version           Print the CLI version

Options:
  --root <dir>      Repository root for index/check (default: cwd)
  --base <ref>      Base git ref for check (enables STATE-001)
  --out <path>      check: write alm.evidence/v1; baseline create: output dir
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
    if (arg === '--base') {
      const value = args[i + 1]
      if (!value || value.startsWith('--')) return { error: '--base requires a git ref' }
      options.base = value
      i += 1
      continue
    }
    if (arg === '--out') {
      const value = args[i + 1]
      if (!value || value.startsWith('--')) return { error: '--out requires a path' }
      options.out = value
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

      const report = command === 'index'
        ? indexReport(options.root)
        : checkReport(options.root, { base: options.base })
      if (report.ok === false) {
        err.write(`alm: ${report.error}\n`)
        return 2
      }

      if (options.out) {
        if (command !== 'check') {
          err.write('alm: --out is only supported by check\n')
          return 2
        }
        try {
          const evidence = buildEvidence({ root: report.root, report, baseRef: options.base })
          report.evidencePath = writeEvidence(options.out, evidence)
        } catch (error) {
          err.write(`alm: ${error.message}\n`)
          return 2
        }
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
        if (report.evidencePath) out.write(`evidence: ${report.evidencePath}\n`)
      }

      if (command === 'index') return report.errors.length > 0 ? 1 : 0
      return report.result === 'pass' ? 0 : 1
    }

    if (command === 'show' || command === 'query') {
      const options = { json: false, root: process.cwd() }
      const positional = []
      const valueFlags = new Set(['--root', '--type', '--status', '--owner'])

      for (let i = 0; i < rest.length; i += 1) {
        const arg = rest[i]
        if (arg === '--json') {
          options.json = true
          continue
        }
        if (valueFlags.has(arg)) {
          const value = rest[i + 1]
          if (!value || value.startsWith('--')) {
            err.write(`alm: ${arg} requires a value\n`)
            return 2
          }
          options[arg.slice(2)] = value
          i += 1
          continue
        }
        if (arg.startsWith('--')) {
          err.write(`alm: unknown option: ${arg}\n`)
          return 2
        }
        positional.push(arg)
      }

      if (command === 'show') {
        if (positional.length !== 1) {
          err.write('alm: show requires exactly one asset id\n')
          return 2
        }
        const report = showReport(options.root, positional[0])
        if (report.ok === false) {
          err.write(`alm: ${report.error}\n`)
          return report.notFound ? 1 : 2
        }
        if (options.json) {
          out.write(`${JSON.stringify(report, null, 2)}\n`)
        } else {
          const { asset } = report
          out.write(`${asset.id}  ${asset.type}  ${asset.status}\n`)
          out.write(`title: ${asset.title}\n`)
          out.write(`owner: ${asset.owner}\n`)
          out.write(`file: ${asset.source.path}\n`)
          for (const link of asset.links) {
            out.write(`link: ${link.type} -> ${link.target}\n`)
          }
        }
        return 0
      }

      const report = queryReport(options.root, {
        type: options.type,
        status: options.status,
        owner: options.owner,
      })
      if (report.ok === false) {
        err.write(`alm: ${report.error}\n`)
        return 2
      }
      if (options.json) {
        out.write(`${JSON.stringify(report, null, 2)}\n`)
      } else {
        out.write(`${report.assets.length} assets in ${report.root}\n`)
        for (const asset of report.assets) {
          out.write(`${asset.id}  ${asset.type}  ${asset.status}  ${asset.owner}\n`)
        }
      }
      return 0
    }

    if (command === 'baseline' && (rest[0] === 'create' || rest[0] === 'verify')) {
      const sub = rest[0]
      const args = rest.slice(1)
      const options = { root: process.cwd(), out: '.alm/baselines', json: false }
      for (let i = 0; i < args.length; i += 1) {
        const arg = args[i]
        if (arg === '--json') {
          options.json = true
          continue
        }
        if (['--commit', '--tag', '--approval', '--id', '--out', '--root', '--manifest'].includes(arg)) {
          const value = args[i + 1]
          if (!value || value.startsWith('--')) {
            err.write(`alm: ${arg} requires a value\n`)
            return 2
          }
          options[arg.slice(2)] = value
          i += 1
          continue
        }
        err.write(`alm: unknown option: ${arg}\n\n${HELP}`)
        return 2
      }

      if (sub === 'create') {
        if (!options.commit || !options.tag || !options.approval) {
          err.write('alm: baseline create requires --commit, --tag and --approval\n')
          return 2
        }
        try {
          const result = createBaseline({
            root: options.root,
            outDir: options.out,
            commit: options.commit,
            tag: options.tag,
            approvalFile: options.approval,
            id: options.id,
            packVersion: PACK.version,
            toolVersion: VERSION,
          })
          if (options.json) {
            out.write(`${JSON.stringify({ schema: 'alm.baseline.create/v1', status: result.status, path: result.path, baseline: result.baseline }, null, 2)}\n`)
          } else {
            out.write(`baseline ${result.baseline.baselineId} ${result.status} files=${result.baseline.files.length}\n`)
            out.write(`contentHash ${result.baseline.contentHash}\n`)
            out.write(`manifest ${result.path}\n`)
          }
          return 0
        } catch (error) {
          if (error instanceof BaselineConflictError) {
            err.write(`alm: ${error.message}\n`)
            return 1
          }
          err.write(`alm: ${error.message}\n`)
          return 2
        }
      }

      if (!options.manifest) {
        err.write('alm: baseline verify requires --manifest\n')
        return 2
      }
      try {
        const result = verifyBaseline({ root: options.root, manifestPath: options.manifest })
        if (options.json) {
          out.write(`${JSON.stringify({ schema: 'alm.baseline.verify/v1', ...result }, null, 2)}\n`)
        } else {
          for (const mismatch of result.mismatches) {
            out.write(`mismatch ${mismatch.path} expected=${mismatch.expected} actual=${mismatch.actual}\n`)
          }
          out.write(result.ok ? 'baseline verify: ok\n' : 'baseline verify: failed\n')
        }
        return result.ok ? 0 : 1
      } catch (error) {
        err.write(`alm: ${error.message}\n`)
        return 2
      }
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
