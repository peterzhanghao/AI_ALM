import { rules } from './registry.mjs'

/**
 * Run every registered rule. Only a failing `block` rule makes the run fail;
 * `warn` rules are reported but never change the result.
 */
export function runGates(context) {
  const checks = rules.map((rule) => {
    const findings = rule.check(context)
    return {
      id: rule.id,
      level: rule.level,
      status: findings.length === 0 ? 'pass' : 'fail',
      findings,
    }
  })

  const failedBlocks = checks.filter((check) => check.level === 'block' && check.status === 'fail')
  return { result: failedBlocks.length === 0 ? 'pass' : 'fail', checks }
}
