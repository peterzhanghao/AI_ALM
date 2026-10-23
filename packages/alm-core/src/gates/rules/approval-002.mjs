import { commitAgentTrailer, gitHead, loadApprovals } from '../../approvals/approval.mjs'

/** APPROVAL-002: approvals must be human and not the submitting agent. */
export const id = 'APPROVAL-002'
export const level = 'block'

const HUMAN_ACTOR = /^human:[A-Za-z0-9._-]+$/

export function check({ root, requireApproval, prHeadSha }) {
  if (!requireApproval) {
    return { status: 'skip', findings: [], message: 'not a PR gate run (use --pr)' }
  }

  const headSha = prHeadSha ?? gitHead(root)
  if (!headSha) return { status: 'skip', findings: [], message: 'not a git repository' }

  const approvals = loadApprovals({ root, sha: headSha })
  const trailer = commitAgentTrailer(root, headSha)

  const findings = []
  for (const entry of approvals) {
    if (entry.kind !== 'human' || !HUMAN_ACTOR.test(entry.actor)) {
      findings.push({
        assetId: null,
        file: '.alm/approvals',
        line: 1,
        message: `approval actor must be human: ${String(entry.actor)}`,
      })
    } else if (trailer && entry.actor === trailer) {
      findings.push({
        assetId: null,
        file: '.alm/approvals',
        line: 1,
        message: `agent cannot approve its own commit: ${entry.actor}`,
      })
    }
  }
  return findings
}
