import { gitHead, loadApprovals } from '../../approvals/approval.mjs'

/** APPROVAL-001: the current head SHA needs a human approval. */
export const id = 'APPROVAL-001'
export const level = 'block'

export function check({ root, requireApproval, prHeadSha }) {
  if (!requireApproval) {
    return { status: 'skip', findings: [], message: 'not a PR gate run (use --pr)' }
  }

  const headSha = prHeadSha ?? gitHead(root)
  if (!headSha) return { status: 'skip', findings: [], message: 'not a git repository' }

  const approvals = loadApprovals({ root, sha: headSha })
  const approved = approvals.some(
    (entry) => entry.kind === 'human' && entry.decision === 'approve' && entry.headSha === headSha,
  )

  return approved
    ? []
    : [
        {
          assetId: null,
          file: '.alm/approvals',
          line: 1,
          message: `no human approval for head ${headSha.slice(0, 8)}`,
        },
      ]
}
