import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { verifyContracts } from './contracts/verify.mjs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

export const VERSION = pkg.version
export const CONTRACTS_DIR = fileURLToPath(new URL('./contracts/', import.meta.url))

export const HELP = `alm ${VERSION}

Usage:
  alm <command> [options]

Commands:
  contract verify   Validate the five ALM contract schemas
  help              Show this help
  version           Print the CLI version

Options:
  --json            Machine-readable output where supported
  --help, -h        Show this help
  --version, -v     Print the CLI version

Exit codes:
  0 pass   1 gate failure   2 usage error   3 internal error
`

function writer(stream, fallback) {
  return stream ?? fallback
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
