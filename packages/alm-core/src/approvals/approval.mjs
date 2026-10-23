import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const APPROVAL_DIR = '.alm/approvals'
const HUMAN_ACTOR = /^human:[A-Za-z0-9._-]+$/

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

export function gitHead(root, ref = 'HEAD') {
  try {
    return git(root, 'rev-parse', ref)
  } catch {
    return undefined
  }
}

export function approvalFile(root, sha) {
  return join(root, APPROVAL_DIR, `${sha}.json`)
}

export function loadApprovals({ root, sha }) {
  const file = approvalFile(root, sha)
  if (!existsSync(file)) return []
  return JSON.parse(readFileSync(file, 'utf8'))
}

/** Records are written only for human actors; agents cannot approve. */
export function recordApproval({ root, sha, actor, changeId, decision = 'approve' }) {
  if (!HUMAN_ACTOR.test(actor)) throw new Error('approval: actor must be human:<login>')
  const headSha = gitHead(root, sha)
  if (!headSha) throw new Error(`approval: cannot resolve ${sha}`)

  const record = {
    schema: 'alm.approval/v1',
    changeId: changeId ?? 'local',
    headSha,
    actor,
    kind: 'human',
    decision,
    at: new Date().toISOString(),
  }

  const file = approvalFile(root, headSha)
  const existing = loadApprovals({ root, sha: headSha }).filter((entry) => entry.actor !== actor)
  existing.push(record)
  existing.sort((left, right) => left.actor.localeCompare(right.actor))
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(existing, null, 2)}\n`, 'utf8')
  return record
}

/** Trailer written by AI commits: `Alm-Agent: agent:<name>`. */
export function commitAgentTrailer(root, sha) {
  try {
    const body = git(root, 'log', '-1', '--format=%B', sha)
    return /^Alm-Agent:\s*(\S+)\s*$/m.exec(body)?.[1]
  } catch {
    return undefined
  }
}

export function verifyApproval({ root, sha }) {
  const headSha = gitHead(root, sha)
  if (!headSha) return { schema: 'alm.approval.verify/v1', ok: false, reason: `cannot resolve ${sha}` }

  const approvals = loadApprovals({ root, sha: headSha })
  const human = approvals.filter(
    (entry) => entry.kind === 'human' && entry.decision === 'approve' && entry.headSha === headSha,
  )

  if (human.length === 0) {
    return {
      schema: 'alm.approval.verify/v1',
      ok: false,
      headSha,
      reason: `no human approval for head ${headSha.slice(0, 8)}`,
    }
  }

  const forged = approvals.find((entry) => entry.kind !== 'human' || !HUMAN_ACTOR.test(entry.actor))
  if (forged) {
    return { schema: 'alm.approval.verify/v1', ok: false, headSha, reason: `non-human approval: ${forged.actor}` }
  }

  const trailer = commitAgentTrailer(root, headSha)
  const self = trailer && human.find((entry) => entry.actor === trailer)
  if (self) {
    return { schema: 'alm.approval.verify/v1', ok: false, headSha, reason: `self approval by ${self.actor}` }
  }

  return {
    schema: 'alm.approval.verify/v1',
    ok: true,
    headSha,
    approvals: human,
  }
}
