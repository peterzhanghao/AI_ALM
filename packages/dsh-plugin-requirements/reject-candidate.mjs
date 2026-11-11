import { lstatSync, readdirSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, relative, isAbsolute, dirname } from 'node:path'
import { requirementContentHash } from '../alm-core/src/model/content-hash.mjs'
import { worktreeSnapshot } from '../alm-core/src/requirements/candidate.mjs'
import { runAcceptance } from '../alm-core/src/acceptance/acceptance.mjs'
import { resolveRunDecision } from '../alm-core/src/requirements/run-decision.mjs'
import { readClosure } from '../alm-core/src/requirements/delivery.mjs'
import { readRequirementSignoffs } from '../alm-core/src/requirements/signoff.mjs'
import { releaseViewFor } from '../alm-core/src/requirements/release.mjs'
import { MAX_AUTO_DISPATCHES } from './auto-advance.mjs'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const fail = () => { throw Object.assign(new Error('审阅对象、原授权或当前工作区已变化，请重新读取后退回修改'), { status: 409, code: 'review-changed' }) }
const hex = value => /^[a-f0-9]{64}$/.test(value ?? '')

// Fixed internal paths only. Never follow links, accept caller paths, or scan unbounded metadata.
function safePath(root, path, directory = false) {
  const parts = path.split('/')
  if (parts.some(part => !part || part === '.' || part === '..' || /[\\:]/.test(part))) fail()
  let current = resolve(root)
  for (let ancestor = current;; ancestor = dirname(ancestor)) {
    const stat = lstatSync(ancestor)
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail()
    if (dirname(ancestor) === ancestor) break
  }
  for (let i = 0; i < parts.length; i++) {
    current = resolve(current, parts[i])
    const stat = lstatSync(current)
    if (stat.isSymbolicLink() || ((i < parts.length - 1 || directory) ? !stat.isDirectory() : !stat.isFile())) fail()
    if (!directory && i === parts.length - 1 && stat.size > 4 * 1024 * 1024) fail()
  }
  return current
}
function read(root, path) {
  const bytes = readFileSync(safePath(root, path))
  return { value: JSON.parse(bytes), hash: hash(bytes) }
}
function list(root, path, pattern) {
  const entries = readdirSync(safePath(root, path, true))
  if (entries.length > 256) fail()
  return entries.filter(name => pattern.test(name)).sort()
}
function evidencePath(root, path) {
  const scoped = relative(resolve(root), resolve(root, path ?? '')).replaceAll('\\', '/')
  if (isAbsolute(scoped) || !/^\.alm\/acceptance\/[^/]+\/[^/]+\.json$/.test(scoped)) fail()
  return scoped
}

/** Read-only binding shared by query and the trusted human command. No current-tree acceptance claim. */
export function rejectionReview({ root, run, asset, assets = [], snapshot = null, plan = null }) {
  try {
    const auto = run?.checkpoint?.autoAdvance
    if (!run || !asset || run.requirement !== asset.id || !/^REQ-[A-Za-z0-9-]+$/.test(asset.id) ||
        !/^RUN-[A-Za-z0-9-]+$/.test(run.id) ||
        !(run.status === 'waiting-input' || (run.status === 'failed' && run.failure?.code === 'host-restart')) ||
        !((run.status === 'waiting-input' && run.phase === 'review-result') ||
          (run.status === 'failed' && run.failure?.code === 'host-restart' && run.phase === 'interrupted')) ||
        auto?.status !== 'candidate-ready' || auto.authorized !== true ||
        auto.authorization?.source !== 'start-v4' || resolveRunDecision(root, run).pending ||
        run.checkpoint?.inPlaceRepair?.status === 'running') fail()
    const attempts = auto.verification?.attempts ?? 0
    if (!Number.isInteger(auto.dispatches) || !Number.isInteger(auto.maxDispatches) || auto.dispatches < 0 ||
        auto.maxDispatches < 1 || auto.maxDispatches > MAX_AUTO_DISPATCHES || auto.dispatches >= auto.maxDispatches ||
        !Number.isInteger(attempts) || attempts < 0 || attempts >= 4) fail()
    const release = releaseViewFor({ root, requirementId: asset.id })
    if (readClosure(root, asset.id) || readRequirementSignoffs(root, asset.id)?.signoff || ['accepted', 'closed'].includes(asset.status) ||
        release?.lastReleased || ['published', 'released'].includes(release?.status)) fail()
    snapshot ??= worktreeSnapshot(root)
    if (!snapshot.complete || !snapshot.headSha || !hex(snapshot.treeHash) || !Array.isArray(snapshot.files) ||
        snapshot.files.some(entry => !hex(entry.hash) && entry.hash !== 'deleted')) fail()
    plan ??= runAcceptance({ root, requirementId: asset.id, context: { asset, assets } })
    const configHash = hash(JSON.stringify(plan.commands))
    const requirementHash = requirementContentHash({ root, asset })
    const revision = asset.extra?.revision ?? 1
    const auth = auto.authorization
    if (!hex(requirementHash) || requirementHash !== auth.requirementHash || revision !== auth.revision ||
        !Object.hasOwn(auth, 'configHash') || configHash !== auth.configHash) fail()
    const dir = `.alm/candidates/${asset.id}`
    const candidates = list(root, dir, /^CAND-[A-Za-z0-9-]+\.json$/).map(name => ({ ...read(root, `${dir}/${name}`), name }))
    candidates.sort((a, b) => String(a.value.createdAt).localeCompare(String(b.value.createdAt)))
    const selected = candidates.at(-1)
    const c = selected?.value
    if (!c || selected.name !== `${c.id}.json` || c.schema !== 'alm.candidate/v2' || c.requirementId !== asset.id ||
        c.complete !== true || c.requirementHash !== requirementHash || c.revision !== revision || !hex(c.treeHash) ||
        c.acceptance?.result !== 'pass' || c.acceptance.configHash !== configHash) fail()
    const evidenceFile = evidencePath(root, c.acceptance.file)
    const evidence = read(root, evidenceFile)
    const e = evidence.value
    if (e.schema !== 'alm.acceptance/v3' || evidence.hash !== c.acceptance.hash || e.result !== 'pass' ||
        e.requirement !== asset.id || e.requirementHash !== requirementHash || e.configHash !== configHash ||
        e.testRevision !== c.acceptance.testRevision || (plan.provenance?.testRevision && e.testRevision !== plan.provenance.testRevision) ||
        e.headSha !== c.headSha || e.worktree?.stable !== true ||
        e.worktree?.after?.treeHash !== c.treeHash || c.acceptance.worktreeHash !== c.treeHash) fail()
    let provenance = { kind: 'automatic', candidateId: c.id }
    if (c.source === 'native-deployment') {
      let match = null
      for (const name of list(root, '.alm/native-delivery', /^[a-f0-9-]{36}\.json$/)) {
        const receipt = read(root, `.alm/native-delivery/${name}`)
        const j = receipt.value, r = j.candidate
        if (j.schema === 'alm.native-delivery/v1' && j.status === 'passed' && j.phase === 'gui-verified' &&
            j.jobId === name.slice(0, -5) && typeof j.root === 'string' && resolve(j.root) === resolve(root) &&
            j.requirementId === asset.id && j.runId === run.id && j.initial?.runId === run.id &&
            j.initial.requirementHash === requirementHash && j.initial.configHash === configHash && j.initial.revision === revision &&
            /^CAND-[A-Za-z0-9-]+$/.test(j.initial.candidateId ?? '') && hex(j.initial.treeHash) &&
            r?.pass === true && r.runId === run.id && r.candidateId === c.id && r.treeHash === c.treeHash &&
            r.requirementHash === requirementHash && r.revision === revision && r.configHash === configHash &&
            evidencePath(root, r.evidencePath) === evidenceFile) {
          match = { kind: 'native-deployment', jobId: name.slice(0, -5), receiptHash: receipt.hash }; break
        }
      }
      if (!match) fail()
      provenance = match
    } else if (auto.candidateId !== c.id) fail()
    return { allowed: true, stale: snapshot.treeHash !== c.treeHash || snapshot.headSha !== c.headSha,
      binding: { runId: run.id, runHash: hash(JSON.stringify(run)), candidateId: c.id, candidateHash: selected.hash,
        evidenceHash: evidence.hash, provenance, requirementId: asset.id, requirementHash, revision, configHash,
        source: { headSha: snapshot.headSha, treeHash: snapshot.treeHash, snapshotHash: hash(JSON.stringify(snapshot.files)) } } }
  } catch { return { allowed: false, binding: null, reason: '原运行、候选归属、授权、预算或安全快照不可用' } }
}

export function assertRejectionReview(current, expected) {
  if (!current?.allowed || !expected || JSON.stringify(current.binding) !== JSON.stringify(expected)) fail()
}

export function rearmRejectedCheckpoint(run, review, actor, text) {
  return { ...run.checkpoint, autoAdvance: { ...run.checkpoint.autoAdvance, status: 'authorized', reason: null },
    rejectedCandidates: [...(run.checkpoint.rejectedCandidates ?? []), { actor, text, review, at: new Date().toISOString() }] }
}
