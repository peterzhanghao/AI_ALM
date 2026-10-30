import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * TASK-001: every requirement listed in a change task draft must be covered by
 * at least one task. Drafts live in `changes/<CHG>/tasks.json`; when no draft
 * exists the rule skips instead of pretending the change was reviewed.
 */
export const id = 'TASK-001'
export const level = 'block'

export function check({ root, index }) {
  const base = join(root, 'changes')
  if (!existsSync(base)) {
    return { status: 'skip', findings: [], message: 'no changes/ task drafts' }
  }

  const findings = []
  const drafts = readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))

  let seen = 0
  for (const draft of drafts) {
    const file = join(base, draft.name, 'tasks.json')
    if (!existsSync(file)) continue
    seen += 1
    const display = relative(root, file).replaceAll('\\', '/')

    let payload
    try {
      payload = JSON.parse(readFileSync(file, 'utf8'))
    } catch (error) {
      findings.push({ assetId: null, file: display, line: 1, message: `unreadable task draft: ${error.message}` })
      continue
    }

    const requirements = Array.isArray(payload.requirements) ? payload.requirements : []
    const tasks = Array.isArray(payload.tasks) ? payload.tasks : []

    if (requirements.length === 0) {
      findings.push({ assetId: null, file: display, line: 1, message: 'task draft has no requirements' })
    }

    const taskIds = new Set()
    for (const task of tasks) {
      if (!task || typeof task.id !== 'string' || task.id === '') {
        findings.push({ assetId: null, file: display, line: 1, message: 'task without id' })
        continue
      }
      if (taskIds.has(task.id)) {
        findings.push({ assetId: null, file: display, line: 1, message: `duplicate task id ${task.id}` })
      }
      taskIds.add(task.id)
      if (!Array.isArray(task.covers) || task.covers.length === 0) {
        findings.push({ assetId: null, file: display, line: 1, message: `task ${task.id} covers no requirement` })
      }
    }

    for (const requirementId of requirements) {
      if (!index.byId.has(requirementId)) {
        findings.push({ assetId: requirementId, file: display, line: 1, message: `unknown requirement ${requirementId}` })
        continue
      }
      if (!tasks.some((task) => Array.isArray(task?.covers) && task.covers.includes(requirementId))) {
        findings.push({
          assetId: requirementId,
          file: display,
          line: 1,
          message: `requirement ${requirementId} is not covered by any task`,
        })
      }
    }
  }

  if (seen === 0) {
    return { status: 'skip', findings: [], message: 'no task drafts to check' }
  }
  return findings
}
