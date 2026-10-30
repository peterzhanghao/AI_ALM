#!/usr/bin/env node
/**
 * Sync a change's requirement + task drafts to GitHub/Gitea.
 *
 *   node scripts/sync-tasks.mjs --change CHG-X                 # dry run
 *   node scripts/sync-tasks.mjs --change CHG-X --apply         # create issues
 *   node scripts/sync-tasks.mjs --change CHG-X --provider gitea --apply
 *
 * The repository's `.alm/project.json` decides the GitHub repo and ProjectV2
 * board; requirements are created as issues before their tasks.
 */
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ProjectError, readProject } from '../packages/alm-core/src/project/project.mjs'
import { RequirementSyncError, syncRequirementIssues } from '../packages/alm-core/src/github/sync-requirements.mjs'
import { TaskSyncError, syncTasks } from '../packages/alm-core/src/tasks/sync.mjs'

const repoRoot = fileURLToPath(new URL('../', import.meta.url))
const argv = process.argv.slice(2)

function value(flag, fallback) {
  const index = argv.indexOf(flag)
  return index === -1 ? fallback : argv[index + 1]
}

const changeId = value('--change')
if (!changeId) {
  console.error(
    'usage: node scripts/sync-tasks.mjs --change <CHG-ID> [--root .] [--provider github|gitea] [--apply] [--json] [--no-requirements]',
  )
  process.exit(2)
}

const root = resolve(repoRoot, value('--root', '.'))
const apply = argv.includes('--apply')
const provider = value('--provider', 'github')

function printActions(actions, key) {
  for (const action of actions) {
    if (action.action === 'create') {
      console.log(`\n--- ${action.title} (${key} create)\n`)
      console.log(action.body)
    } else {
      console.log(`${action.action.padEnd(8)} ${action[key]} -> #${action.issue?.number ?? '?'} ${action.issue?.url ?? ''}`)
    }
  }
}

try {
  const project = readProject(root)
  if (apply && !project) throw new ProjectError('run `alm project init` before applying; GitHub target is unknown')

  const requirements = argv.includes('--no-requirements')
    ? null
    : await syncRequirementIssues({ root, changeId, apply, project })

  const tasks = await syncTasks({ root, changeId, apply, provider, project })

  if (argv.includes('--json')) {
    console.log(JSON.stringify({ requirements, tasks }, null, 2))
  } else {
    console.log(`change ${changeId} · project ${project?.id ?? '—'} · ${apply ? 'apply' : 'dry-run'}`)
    if (requirements) {
      printActions(requirements.actions, 'requirement')
      const created = requirements.actions.filter((action) => action.action === 'created').length
      console.log(`\n${requirements.actions.length} requirements · ${created} created`)
    }
    console.log('')
    printActions(tasks.actions, 'task')
    const createdTasks = tasks.actions.filter((action) => action.action === 'created').length
    console.log(`\n${tasks.actions.length} tasks · ${createdTasks} created · ${apply ? 'applied' : 'dry-run (use --apply)'}`)
  }
} catch (error) {
  if (error instanceof ProjectError || error instanceof RequirementSyncError || error instanceof TaskSyncError) {
    console.error(`sync-tasks: ${error.message}`)
    process.exit(1)
  }
  console.error(`sync-tasks: ${error?.message ?? String(error)}`)
  process.exit(1)
}
