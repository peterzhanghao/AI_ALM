import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { verifyContracts } from './contracts/verify.mjs'
import { checkReport, diffReport, impactReport, indexReport, queryReport, showReport, traceReport } from './commands.mjs'
import { buildEvidence, writeEvidence } from './evidence/evidence.mjs'
import { BaselineConflictError, createBaseline, verifyBaseline } from './baseline/baseline.mjs'
import { WorkspaceError, createWorkspace, guardWrite, statusWorkspace } from './workspace/workspace.mjs'
import { loadApprovals, recordApproval, verifyApproval } from './approvals/approval.mjs'
import { evaluateMerge } from '@ai-alm/alm-scm/policy'
import { currentBranch, mergeBase, mergeLocal, resolveSha } from '@ai-alm/alm-scm/local'

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
  diff              Diff a base ref against the worktree or another ref
  impact --asset    List assets affected by a change
  trace <ID>        Print the forward relation chain from one asset
  workspace create  Open a change branch from a baseline
  workspace status  Show the active change and worktree state
  workspace guard   Check paths against the active change workspace
  approval record   Record a human approval bound to a commit SHA
  approval verify   Verify the approval for a commit SHA
  pr status         Show merge readiness for a base/head pair
  pr merge          Merge after approval and required checks
  baseline create   Write an immutable baseline manifest for a commit
  baseline verify   Rebuild hashes and compare with a manifest
  contract verify   Validate the five ALM contract schemas
  help              Show this help
  version           Print the CLI version

Options:
  --root <dir>      Repository root for index/check (default: cwd)
  --base <ref>      Base git ref for check (enables STATE-001)
  --out <path>      check: write alm.evidence/v1; baseline create: output dir
  --pr              check: enable APPROVAL-* rules for a PR gate
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
    if (arg === '--pr') {
      options.pr = true
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
        : checkReport(options.root, { base: options.base, pr: options.pr })
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

    if (command === 'diff' || command === 'impact' || command === 'trace') {
      const options = { json: false, root: process.cwd() }
      const positional = []
      const valueFlags = new Set(['--root', '--base', '--head', '--asset'])

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

      if (command === 'diff') {
        if (!options.base) {
          err.write('alm: diff requires --base\n')
          return 2
        }
        const report = diffReport(options.root, { base: options.base, head: options.head })
        if (report.ok === false) {
          err.write(`alm: ${report.error}\n`)
          return 2
        }
        if (options.json) {
          out.write(`${JSON.stringify(report, null, 2)}\n`)
        } else {
          out.write(`diff ${report.base}..${report.head} added=${report.summary.added} removed=${report.summary.removed} changed=${report.summary.changed}\n`)
          for (const entry of report.added) out.write(`+ ${entry.id}  ${entry.type}\n`)
          for (const entry of report.removed) out.write(`- ${entry.id}  ${entry.type}\n`)
          for (const entry of report.changed) {
            const fields = entry.fields.map((field) => `${field.field} ${String(field.from)} -> ${String(field.to)}`).join('; ')
            const links = [...entry.links.added.map((link) => `+${link}`), ...entry.links.removed.map((link) => `-${link}`)].join('; ')
            out.write(`~ ${entry.id}  ${[fields, links].filter(Boolean).join('; ')}\n`)
          }
        }
        return 0
      }

      const assetId = command === 'impact' ? options.asset : positional[0]
      if (!assetId) {
        err.write(`alm: ${command} requires an asset id\n`)
        return 2
      }
      const report = command === 'impact' ? impactReport(options.root, assetId) : traceReport(options.root, assetId)
      if (report.ok === false) {
        err.write(`alm: ${report.error}\n`)
        return report.notFound ? 1 : 2
      }
      if (options.json) {
        out.write(`${JSON.stringify(report, null, 2)}\n`)
      } else if (command === 'impact') {
        out.write(`impact ${assetId}: ${report.impacted.length} assets\n`)
        for (const entry of report.impacted) {
          out.write(`${entry.id}  depth=${entry.depth}  via=${entry.via}\n`)
        }
      } else {
        out.write(`trace ${assetId}: ${report.nodes.length} assets\n`)
        for (const entry of report.nodes) {
          out.write(`${entry.id}  depth=${entry.depth}  via=${entry.via}\n`)
        }
      }
      for (const cycle of report.cycles) {
        out.write(`cycle: ${cycle.join(' -> ')}\n`)
      }
      return 0
    }

    if (command === 'workspace' && (rest[0] === 'create' || rest[0] === 'status' || rest[0] === 'guard')) {
      const sub = rest[0]
      const args = rest.slice(1)
      const options = { root: process.cwd(), json: false, paths: [] }

      for (let i = 0; i < args.length; i += 1) {
        const arg = args[i]
        if (arg === '--json') {
          options.json = true
          continue
        }
        if (arg === '--path') {
          const value = args[i + 1]
          if (!value || value.startsWith('--')) {
            err.write('alm: --path requires a path\n')
            return 2
          }
          options.paths.push(value)
          i += 1
          continue
        }
        if (['--root', '--baseline', '--change'].includes(arg)) {
          const value = args[i + 1]
          if (!value || value.startsWith('--')) {
            err.write(`alm: ${arg} requires a value\n`)
            return 2
          }
          options[arg.slice(2)] = value
          i += 1
          continue
        }
        err.write(`alm: unknown option: ${arg}\n`)
        return 2
      }

      if (sub === 'create') {
        if (!options.baseline || !options.change) {
          err.write('alm: workspace create requires --baseline and --change\n')
          return 2
        }
        try {
          const record = createWorkspace({ root: options.root, baseline: options.baseline, changeId: options.change })
          if (options.json) {
            out.write(`${JSON.stringify({ schema: 'alm.workspace.create/v1', ...record }, null, 2)}\n`)
          } else {
            out.write(`change ${record.changeId} on ${record.branch} from ${record.baselineSha}\n`)
          }
          return 0
        } catch (error) {
          if (error instanceof WorkspaceError) {
            err.write(`alm: ${error.message}\n`)
            return 1
          }
          throw error
        }
      }

      if (sub === 'guard') {
        if (!options.paths.length) {
          err.write('alm: workspace guard requires at least one --path\n')
          return 2
        }
        const guarded = guardWrite({ root: options.root, changeId: options.change, paths: options.paths })
        if (options.json) {
          out.write(`${JSON.stringify(guarded, null, 2)}\n`)
        } else if (guarded.ok) {
          out.write(`allowed ${options.paths.length} paths in ${guarded.changeId}\n`)
        } else {
          out.write(`${guarded.error ?? 'denied'}\n`)
          for (const violation of guarded.violations) out.write(`denied ${violation}\n`)
        }
        return guarded.ok ? 0 : 1
      }

      const status = statusWorkspace({ root: options.root })
      if (options.json) {
        out.write(`${JSON.stringify(status, null, 2)}\n`)
      } else {
        out.write(`branch ${status.branch}\n`)
        out.write(`active ${status.active?.changeId ?? 'none'}\n`)
        out.write(`dirty ${status.dirty}\n`)
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

    if (command === 'approval' && (rest[0] === 'record' || rest[0] === 'verify')) {
      const sub = rest[0]
      const args = rest.slice(1)
      const options = { root: process.cwd(), json: false }

      for (let i = 0; i < args.length; i += 1) {
        const arg = args[i]
        if (arg === '--json') {
          options.json = true
          continue
        }
        if (['--root', '--sha', '--actor', '--change'].includes(arg)) {
          const value = args[i + 1]
          if (!value || value.startsWith('--')) {
            err.write(`alm: ${arg} requires a value\n`)
            return 2
          }
          options[arg.slice(2)] = value
          i += 1
          continue
        }
        err.write(`alm: unknown option: ${arg}\n`)
        return 2
      }

      if (!options.sha) {
        err.write(`alm: approval ${sub} requires --sha\n`)
        return 2
      }

      if (sub === 'record') {
        if (!options.actor) {
          err.write('alm: approval record requires --actor human:<login>\n')
          return 2
        }
        try {
          const record = recordApproval({
            root: options.root,
            sha: options.sha,
            actor: options.actor,
            changeId: options.change,
          })
          if (options.json) {
            out.write(`${JSON.stringify(record, null, 2)}\n`)
          } else {
            out.write(`approved ${record.headSha} by ${record.actor}\n`)
          }
          return 0
        } catch (error) {
          err.write(`alm: ${error.message}\n`)
          return 1
        }
      }

      const verified = verifyApproval({ root: options.root, sha: options.sha })
      if (options.json) {
        out.write(`${JSON.stringify(verified, null, 2)}\n`)
      } else {
        out.write(verified.ok ? `approval ok ${verified.headSha}\n` : `approval failed: ${verified.reason}\n`)
      }
      return verified.ok ? 0 : 1
    }

    if (command === 'pr' && (rest[0] === 'status' || rest[0] === 'merge')) {
      const sub = rest[0]
      const args = rest.slice(1)
      const options = { root: process.cwd(), json: false }

      for (let i = 0; i < args.length; i += 1) {
        const arg = args[i]
        if (arg === '--json') {
          options.json = true
          continue
        }
        if (['--root', '--base', '--head'].includes(arg)) {
          const value = args[i + 1]
          if (!value || value.startsWith('--')) {
            err.write(`alm: ${arg} requires a value\n`)
            return 2
          }
          options[arg.slice(2)] = value
          i += 1
          continue
        }
        err.write(`alm: unknown option: ${arg}\n`)
        return 2
      }

      if (!options.base || !options.head) {
        err.write(`alm: pr ${sub} requires --base and --head\n`)
        return 2
      }

      const headSha = resolveSha(options.root, options.head)
      const baseSha = resolveSha(options.root, options.base)
      if (!headSha || !baseSha) {
        err.write('alm: cannot resolve base/head refs\n')
        return 2
      }
      if (currentBranch(options.root) !== options.head) {
        err.write(`alm: head branch ${options.head} must be checked out (current: ${currentBranch(options.root)})\n`)
        return 2
      }

      const baseForCheck = mergeBase(options.root, options.base, options.head) ?? baseSha
      const report = checkReport(options.root, { base: baseForCheck, pr: true, headSha })
      if (report.ok === false) {
        err.write(`alm: ${report.error}\n`)
        return 2
      }

      const approvals = loadApprovals({ root: options.root, sha: headSha })
      const policy = evaluateMerge({ headSha, approvals, checkReport: report })

      if (sub === 'status') {
        const payload = {
          schema: 'alm.pr/v1',
          base: options.base,
          head: options.head,
          headSha,
          checkResult: report.result,
          approvals: policy.approvals.map((entry) => entry.actor),
          mergeable: policy.ok,
          reasons: policy.reasons,
        }
        if (options.json) out.write(`${JSON.stringify(payload, null, 2)}\n`)
        else {
          out.write(`pr ${options.head} -> ${options.base} head=${headSha.slice(0, 8)}\n`)
          out.write(`checks ${report.result} approvals ${payload.approvals.length} mergeable ${policy.ok}\n`)
          for (const reason of policy.reasons) out.write(`blocked: ${reason}\n`)
        }
        return 0
      }

      if (!policy.ok) {
        err.write('alm: merge blocked\n')
        for (const reason of policy.reasons) err.write(`alm: ${reason}\n`)
        return 1
      }

      try {
        const merged = mergeLocal({
          root: options.root,
          base: options.base,
          head: options.head,
          message: `merge ${options.head} (approved by ${policy.approvals.map((entry) => entry.actor).join(', ')})`,
        })
        if (options.json) {
          out.write(`${JSON.stringify({ schema: 'alm.pr.merge/v1', ...merged }, null, 2)}\n`)
        } else {
          out.write(`merged ${options.head} into ${options.base} at ${merged.mergeSha}\n`)
        }
        return 0
      } catch (error) {
        err.write(`alm: ${error.message}\n`)
        return 1
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
