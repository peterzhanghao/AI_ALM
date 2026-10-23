import { rules } from './registry.mjs'

/**
 * Run every registered rule. A rule returns either an array of findings or an
 * object `{ status, findings, message }`. Only failing `block` rules make the
 * run fail; `warn` and `skip` never change the result.
 */
export function runGates({ index, root, baseAssets }) {
  const context = { assets: index.assets, index, root, baseAssets }
  const checks = rules.map((rule) => {
    const outcome = rule.check(context)
    const findings = Array.isArray(outcome) ? outcome : (outcome.findings ?? [])
    const status = Array.isArray(outcome)
      ? findings.length === 0
        ? 'pass'
        : 'fail'
      : (outcome.status ?? (findings.length === 0 ? 'pass' : 'fail'))

    const check = { id: rule.id, level: rule.level, status, findings }
    if (!Array.isArray(outcome) && outcome.message) check.message = outcome.message
    return check
  })

  const failedBlocks = checks.filter((check) => check.level === 'block' && check.status === 'fail')
  return { result: failedBlocks.length === 0 ? 'pass' : 'fail', checks }
}
