import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readProject } from '../alm-core/src/project/project.mjs'
import { worktreeSnapshot } from '../alm-core/src/requirements/worktree-snapshot.mjs'
import { planRelease, createRelease, authorizeRelease, readRelease, recordReleaseExecution, releasePath } from '../alm-core/src/requirements/release.mjs'
import { requireTrustedHumanSubject } from '../alm-core/src/requirements/identity.mjs'

const exec = promisify(execFile)
const execute = async (command, args, root) => (await exec(command, args, { cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024, windowsHide: true })).stdout.trim()
const failure = (message, code = 'github-release-blocked') => Object.assign(new Error(message), { code, status: 409 })
const fields = 'number,url,state,isDraft,headRefName,baseRefName,headRefOid,mergedAt,mergeCommit,reviewDecision,mergeable,statusCheckRollup'

/** Network reads are explicit and asynchronous, never part of the list projection. */
export async function inspectGithubRelease({ root, items, requirementIds, run = execute }) {
  const project = readProject(root)
  const repository = project?.github?.owner && project?.github?.repo ? `${project.github.owner}/${project.github.repo}` : null
  const source = project?.github?.workflow?.integrationBranch ?? 'develop'
  const target = project?.defaultBranch ?? 'main'
  const plan = planRelease({ items, requirementIds, target })
  const blockers = [...plan.blockers], warnings = []
  const add = (code, message) => blockers.push({ code, message })
  const github = { repository, source, target, branch: null, head: null, pr: null, protected: false, mergeReady: false }
  if (!repository || !/^[\w.-]+\/[\w.-]+$/.test(repository)) add('github-not-linked', '请先关联有效的 GitHub 仓库，才能通过 PR 发布。')
  if (!/^[\w./-]+$/.test(source) || !/^[\w./-]+$/.test(target) || source === target) add('github-branch-policy', '开发集成分支与发布分支配置无效。')
  const snapshot = worktreeSnapshot(root)
  github.head = snapshot.headSha
  if (!snapshot.complete) add('snapshot-incomplete', '无法完整核验工作区，请先解决工作区检查问题。')
  if (snapshot.files.length) add('uncommitted-delivery', `还有 ${snapshot.files.length} 个交付文件未提交。请由 AI 在独立功能分支整理本需求改动，提交并通过功能 PR 集成；不得将其他需求的改动一并发布。`)
  for (const delivery of plan.deliveries) {
    const item = items.find(item => item.id === delivery.requirement)
    if (!item?.candidate?.headSha || item.candidate.headSha !== snapshot.headSha) add('candidate-commit-mismatch', '验收候选未绑定当前提交，请在集成后的提交上重新检查并验收。')
  }
  try { github.branch = await run('git', ['branch', '--show-current'], root) } catch { add('git-branch-unavailable', '无法读取实际开发分支。') }
  if (github.branch !== source) add('integration-required', `当前分支为 ${github.branch || '游离提交'}。请先将功能 PR 合入 ${source}，再在 ${source} 的当前提交上完成验收。`)
  if (!repository || blockers.some(b => ['github-not-linked', 'github-branch-policy'].includes(b.code))) return { ...plan, ok: false, blockers, warnings, github }
  const gh = async args => JSON.parse(await run('gh', args, root))
  try {
    const remote = await run('git', ['remote', 'get-url', 'origin'], root)
    // Compare the repository component exactly; never publish into another host/repository.
    const normalized = remote.replace(/^https:\/\/github\.com\//i, '').replace(/^git@github\.com:/i, '').replace(/\.git\/?$/, '').replace(/\/$/, '')
    if (normalized.toLowerCase() !== repository.toLowerCase()) add('remote-mismatch', 'origin 与关联的 GitHub 仓库不一致，请先核对工作区。')
    const repo = await gh(['repo', 'view', repository, '--json', 'defaultBranchRef'])
    if (repo.defaultBranchRef?.name !== target) add('default-branch-mismatch', '配置的发布分支与 GitHub 默认分支不一致。')
    const remoteHead = await gh(['api', `repos/${repository}/git/ref/heads/${source}`])
    if (remoteHead.object?.sha !== snapshot.headSha) add('source-not-pushed', `本地提交与 GitHub ${source} 不一致，请完成正常提交、推送与集成后重验。`)
    const prs = await gh(['pr', 'list', '--repo', repository, '--head', source, '--base', target, '--state', 'all', '--limit', '100', '--json', fields])
    const matches = prs.filter(pr => pr.headRefName === source && pr.baseRefName === target && pr.headRefOid === snapshot.headSha && ['OPEN', 'MERGED'].includes(pr.state))
    if (matches.length > 1) add('ambiguous-release-pr', '同一提交存在多个发布 PR，请先在 GitHub 核对，不能自动选择。')
    github.pr = matches.length === 1 ? matches[0] : null
    try {
      const protection = await gh(['api', `repos/${repository}/branches/${target}/protection`])
      github.protected = protection.required_pull_request_reviews?.required_approving_review_count >= 1 &&
        ((protection.required_status_checks?.contexts?.length ?? 0) + (protection.required_status_checks?.checks?.length ?? 0) > 0)
    } catch { /* Missing/inaccessible protection is never treated as protected. */ }
    if (!github.protected) warnings.push('主分支尚未验证启用 PR 评审与必需检查保护；可准备 PR，暂不能在插件中合并。')
    const checks = github.pr?.statusCheckRollup ?? []
    github.checksPassed = checks.length > 0 && checks.every(check => check.status === 'COMPLETED' ? check.conclusion === 'SUCCESS' : check.state === 'SUCCESS')
    github.mergeReady = github.protected && github.pr?.state === 'OPEN' && github.pr.isDraft === false && github.pr.reviewDecision === 'APPROVED' && github.pr.mergeable === 'MERGEABLE' && github.checksPassed
  } catch (error) {
    add('github-unavailable', '无法核验 GitHub 仓库、分支或 PR。请检查 gh 登录、网络与仓库读取权限后重试。')
  }
  return { ...plan, ok: blockers.length === 0, blockers, warnings, github }
}

/** Each click is explicit human authority; retry reuses the same release and PR. */
export async function publishGithubRelease({ root, items, requirementIds, subject, releaseId, mode, run = execute, loadItems = () => items }) {
  const principal = requireTrustedHumanSubject(subject, { error: message => failure(message, 'untrusted-subject') })
  const plan = await inspectGithubRelease({ root, items, requirementIds, run })
  if (!plan.ok) throw failure(plan.blockers.map(b => b.message).join('；'))
  const { repository, source, target, head } = plan.github
  let release = releaseId ? readRelease(root, releaseId) : null
  if (release && (release.contentHash !== plan.contentHash || !['draft', 'authorized', 'failed', 'releasing'].includes(release.status))) throw failure('发布内容或状态已变化，请重新读取发布计划。')
  if (!release && mode !== 'prepare') throw failure('请先准备发布 PR。')
  // Merged foreign PRs are not adopted implicitly. The local authorization must precede the merge.
  if (plan.github.pr?.state === 'MERGED' && (!release?.github?.pr || release.github.pr !== plan.github.pr.number)) throw failure('发现已合并 PR，但缺少本次发布绑定，需人工核对历史交付。')
  if (!release) release = createRelease({ root, items, requirementIds, target, actor: principal.id })
  if (release.status === 'draft') release = authorizeRelease({ root, releaseId: release.id, items, subject: principal, actor: principal.id, apply: true }).release
  if (mode === 'prepare') {
    let pr = plan.github.pr
    if (!pr) {
      const temporary = mkdtempSync(join(tmpdir(), 'alm-release-pr-'))
      try {
        const bodyFile = join(temporary, 'body.md')
        writeFileSync(bodyFile, `将已验收的交付从 ${source} 发布到 ${target}。\n\n需求：${plan.deliveries.map(d => d.requirement).join('、')}\n提交：${head}\n发布记录：${release.id}\n\n合并前必须通过仓库检查与评审。\n`, 'utf8')
        await run('gh', ['pr', 'create', '--repo', repository, '--head', source, '--base', target, '--title', `release: ${plan.deliveries.map(d => d.requirement).join(', ')}`, '--body-file', bodyFile], root)
      } finally { rmSync(temporary, { recursive: true, force: true }) }
      const reread = await inspectGithubRelease({ root, items, requirementIds, run })
      if (!reread.ok || !reread.github.pr || reread.github.pr.state !== 'OPEN') throw failure('PR 请求已提交，但尚未确认绑定；请刷新状态，勿重复创建。')
      pr = reread.github.pr
    }
    release = { ...release, github: { repository, source, target, head, pr: pr.number, url: pr.url, verified: false } }
    writeFileSync(releasePath(root, release.id), JSON.stringify(release, null, 2) + '\n')
    return { ok: true, release, message: '发布 PR 已准备，等待检查和评审；尚未合并或关闭需求。', plan: await inspectGithubRelease({ root, items, requirementIds, run }) }
  }
  const pr = plan.github.pr
  if (!pr || release.github?.pr !== pr.number || release.github?.head !== head || release.github?.repository !== repository) throw failure('当前 PR 与授权发布记录不一致，请重新准备。')
  if (pr.state !== 'MERGED') {
    if (!plan.github.mergeReady) throw failure('PR 尚未满足主分支保护、检查通过、评审通过和无冲突条件。请在 GitHub 完成后刷新。')
    await run('gh', ['pr', 'merge', String(pr.number), '--repo', repository, '--merge', '--match-head-commit', head], root)
  }
  const merged = JSON.parse(await run('gh', ['pr', 'view', String(pr.number), '--repo', repository, '--json', fields], root))
  if (merged.state !== 'MERGED' || !merged.mergedAt || !/^[a-f0-9]{40}$/.test(merged.mergeCommit?.oid ?? '') || merged.headRefOid !== head || merged.baseRefName !== target || merged.headRefName !== source) throw failure('尚未回读到指定提交的合并结果，需求保持待发布；可刷新重试。')
  for (const comparison of [`${head}...${merged.mergeCommit.oid}`, `${merged.mergeCommit.oid}...${target}`]) {
    const result = JSON.parse(await run('gh', ['api', `repos/${repository}/compare/${comparison}`], root))
    if (!['ahead', 'identical'].includes(result.status)) throw failure('无法证明已验收提交位于主分支发布历史中。')
  }
  // Refresh local evidence as well: a network wait must not mask changed files/signoff.
  const currentItems = await loadItems()
  const fresh = await inspectGithubRelease({ root, items: currentItems, requirementIds, run })
  if (!fresh.ok || fresh.github.head !== head) throw failure('合并已完成，但本地交付事实发生变化；请核对后补录，不会伪造关闭结果。')
  const github = { ...release.github, verified: true, mergedAt: merged.mergedAt, mergeCommit: merged.mergeCommit.oid, checkedAt: new Date().toISOString() }
  return { ...recordReleaseExecution({ root, releaseId: release.id, result: 'released', note: 'GitHub 发布 PR 已合并并回读验证', actor: principal.id, apply: true, items: currentItems, verifiedGithub: github }), ok: true, message: '发布 PR 已合入主分支，本次需求已关闭。' }
}
