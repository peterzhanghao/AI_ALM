import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { indexReport } from '../commands.mjs'

const CHANGE_ID = /^CHG-[A-Z0-9][A-Z0-9-]{2,}$/

export class TaskDraftError extends Error {
  constructor(message, { code = 'task-draft' } = {}) {
    super(message)
    this.name = 'TaskDraftError'
    this.code = code
  }
}

function domainOf(id) {
  return (id.split('-')[1] ?? 'GEN').toUpperCase()
}

function rel(root, path) {
  return path.slice(root.length).replaceAll('\\', '/').replace(/^\//, '')
}

function cardMarkdown(task) {
  return [
    `### ${task.id} ${task.title}`,
    '',
    `- 类型：Task ｜ 优先级：P1 ｜ 覆盖：${task.covers.join(', ')}`,
    `- 前置：${task.blockedBy.length ? task.blockedBy.join('、') : '无'}`,
    `- 实施范围：${task.scope.join('、')}`,
    `- 不在范围：${task.outOfScope.join('、')}`,
    `- 接口：${task.interface}`,
    `- 正例：${task.positive}`,
    `- 反例：${task.negative}`,
    `- 证据：${task.evidence.join('；')}`,
    '',
  ].join('\n')
}

/**
 * Draft delivery tasks for a change from its requirements. The split is
 * deterministic: for every requirement, one asset task, one implementation
 * task and one gate/evidence task, with the latter two blocked by the first.
 */
export function draftTasks({ root, changeId, requirementIds, outDir = 'changes', force = false }) {
  if (!CHANGE_ID.test(changeId)) {
    throw new TaskDraftError(`invalid change id: ${changeId}`, { code: 'invalid-change' })
  }

  const changePath = join(root, '.alm', 'changes', `${changeId}.json`)
  if (!existsSync(changePath)) {
    throw new TaskDraftError(`unknown change: ${changeId}`, { code: 'unknown-change' })
  }
  const change = JSON.parse(readFileSync(changePath, 'utf8'))

  const index = indexReport(root)
  if (index && index.ok === false) throw new TaskDraftError(index.error, { code: 'index-failed' })

  const ids = [...new Set(requirementIds.map((id) => id.trim()).filter(Boolean))]
  if (ids.length === 0) throw new TaskDraftError('at least one requirement id is required', { code: 'no-requirements' })

  const requirements = ids.map((id) => {
    const asset = index.assets.find((entry) => entry.id === id && entry.type === 'requirement')
    if (!asset) throw new TaskDraftError(`requirement not found: ${id}`, { code: 'unknown-requirement' })
    return asset
  })

  const dir = join(root, outDir, changeId)
  if (existsSync(join(dir, 'tasks.json')) && !force) {
    throw new TaskDraftError(`task draft already exists: ${outDir}/${changeId} (use --force)`, { code: 'already-exists' })
  }

  const tasks = []
  for (const requirement of requirements) {
    const domain = domainOf(requirement.id)
    const sequence = tasks.length
    const acceptance = requirement.links.filter((link) => link.type === 'verified_by').map((link) => link.target)
    const modules = requirement.links.filter((link) => link.type === 'allocated_to').map((link) => link.target)
    const decisions = requirement.links.filter((link) => link.type === 'constrained_by').map((link) => link.target)
    const evidence = [`node packages/alm-core/bin/alm.mjs check --root .`]
    const base = {
      covers: [requirement.id],
      evidence,
    }

    const assetTask = {
      ...base,
      id: `TASK-${domain}-${String(sequence + 1).padStart(3, '0')}`,
      title: `${requirement.id} 需求与验收资产`,
      concern: 'assets',
      scope: ['requirements/', 'tests/'],
      outOfScope: ['实现代码（下一张卡）'],
      interface: `补齐 ${requirement.id} 的验收：${acceptance.length ? acceptance.join('、') : '新增 TEST-* 并在需求里加 verified_by'}`,
      positive: `alm check 通过，COV-001 不再报告 ${requirement.id}`,
      negative: `缺少 verified_by → COV-001 失败，退出码 1`,
      evidence: [`node packages/alm-core/bin/alm.mjs trace ${requirement.id}`, ...evidence],
      blockedBy: [],
    }

    const implTask = {
      ...base,
      id: `TASK-${domain}-${String(sequence + 2).padStart(3, '0')}`,
      title: `${requirement.id} 实现${modules.length ? `（${modules.join('、')}）` : ''}`,
      concern: 'implement',
      scope: modules.length ? modules.map((id) => `architecture/${id} 对应实现`) : ['architecture/', 'adr/'],
      outOfScope: ['验收资产（上一张卡）', '发布（ALM-04）'],
      interface: `实现 ${requirement.id}：${requirement.title}${decisions.length ? `；遵守 ${decisions.join('、')}` : ''}`,
      positive: `需求场景可执行并通过：${acceptance.join('、') || '验收用例'}`,
      negative: `超出边界（如金额越界）返回明确错误且不产生副作用`,
      evidence: [`node --test`, ...evidence],
      blockedBy: [assetTask.id],
    }

    const gateTask = {
      ...base,
      id: `TASK-${domain}-${String(sequence + 3).padStart(3, '0')}`,
      title: `${requirement.id} 门禁、差异与证据`,
      concern: 'verify',
      scope: ['changes/', '.alm/evidence/'],
      outOfScope: ['实现细节'],
      interface: `跑门禁并记录证据：check/diff/impact → alm.evidence/v1`,
      positive: `alm check --base ${change.baselineSha.slice(0, 8)} --out .alm/evidence/${changeId}.json 退出 0`,
      negative: `跳过门禁直接提 PR → APPROVAL/证据缺失被拒`,
      evidence: [`node packages/alm-core/bin/alm.mjs diff --base ${change.baselineSha.slice(0, 8)}`, `node packages/alm-core/bin/alm.mjs impact --asset ${requirement.id}`],
      blockedBy: [assetTask.id],
    }

    tasks.push(assetTask, implTask, gateTask)
  }

  const proposal = [
    `# ${changeId} 变更提案`,
    '',
    `- 基线：${change.baselineSha}`,
    `- 分支：${change.branch}`,
    `- 需求：${ids.join('、')}`,
    '',
    '## 为什么',
    '',
    ...requirements.map((requirement) => `- ${requirement.id}：${requirement.title}`),
    '',
    '## 改什么',
    '',
    `- 资产：${[...new Set(requirements.flatMap((requirement) => requirement.links.filter((link) => link.type === 'allocated_to').map((link) => link.target)))].join('、') || '见需求关系'}`,
    `- 任务：见 tasks.md（${tasks.length} 张卡）`,
    '',
    '## 验收',
    '',
    `- alm check 退出 0，COV-001/TASK-001 均通过`,
    '',
  ].join('\n')

  const tasksDoc = [
    `# ${changeId} 任务卡`,
    '',
    '> 由 `alm task draft` 生成；五要素与 ai-github-issue-workflow 一致。',
    '',
    ...tasks.map(cardMarkdown),
  ].join('\n')

  const payload = {
    schema: 'alm.tasks/v1',
    changeId,
    requirements: ids,
    baselineSha: change.baselineSha,
    generatedAt: new Date().toISOString(),
    tasks,
  }

  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'proposal.md'), `${proposal}\n`, 'utf8')
  writeFileSync(join(dir, 'tasks.md'), `${tasksDoc}\n`, 'utf8')
  writeFileSync(join(dir, 'tasks.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8')

  return {
    schema: 'alm.tasks.draft/v1',
    changeId,
    dir: rel(root, dir),
    files: [`${rel(root, dir)}/proposal.md`, `${rel(root, dir)}/tasks.md`, `${rel(root, dir)}/tasks.json`],
    tasks,
  }
}
