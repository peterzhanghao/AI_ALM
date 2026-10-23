/**
 * Merge policy shared by every provider: a human approval bound to the exact
 * head SHA plus a passing required check run. Pure function, no git access.
 */
export function evaluateMerge({ headSha, approvals, checkReport }) {
  const reasons = []
  const human = (approvals ?? []).filter(
    (entry) => entry.kind === 'human' && entry.decision === 'approve' && entry.headSha === headSha,
  )
  if (human.length === 0) reasons.push(`no human approval for head ${headSha.slice(0, 8)}`)
  if (!checkReport || checkReport.result !== 'pass') reasons.push('required checks did not pass')

  return {
    schema: 'alm.merge.policy/v1',
    ok: reasons.length === 0,
    headSha,
    approvals: human,
    reasons,
  }
}
