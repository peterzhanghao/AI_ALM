#!/usr/bin/env node
/**
 * Sync a change's task draft to an external board.
 *
 *   node scripts/sync-tasks.mjs --change CHG-X                 # dry run
 *   node scripts/sync-tasks.mjs --change CHG-X --apply         # create issues
 *   node scripts/sync-tasks.mjs --change CHG-X --provider gitea --apply
 */
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TaskSyncError, syncTasks } from '../packages/alm-core/src/tasks/sync.mjs'

const repoRoot = fileURLToPath(new URL('../', import.meta.url))
const argv = process.argv.slice(2)

function value(flag, fallback) {
  const index = argv.indexOf(flag)
  return index === -1 ? fallback : argv[index + 1]
}

const changeId = value('--change')
if (!changeId) {
  console.error('usage: node scripts/sync-tasks.mjs --change <CHG-ID> [--root .] [--provider github|gitea] [--apply] [--json]')
  process.exit(2)
}

try {
  const result = await syncTasks({
    root: resolve(repoRoot, value('--root', '.')),
    changeId,
    apply: argv.includes('--apply'),
    provider: value('--provider', 'github'),
  })

  if (argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    console.log(`change ${result.changeId} · provider ${result.provider} · ${result.applied ? 'apply' : 'dry-run'}`)
    for (const action of result.actions) {
      if (action.action === 'create') {
        console.log(`\n--- ${action.title} (create)\n`)
        console.log(action.body)
      } else {
        console.log(`${action.action.padEnd(8)} ${action.task} -> #${action.issue?.number ?? '?'} ${action.issue?.url ?? ''}`)
      }
    }
    const created = result.actions.filter((action) => action.action === 'created').length
    console.log(`\n${result.actions.length} tasks · ${created} created · ${result.applied ? 'applied' : 'dry-run (use --apply)'}`)
  }
} catch (error) {
  if (error instanceof TaskSyncError) {
    console.error(`sync-tasks: ${error.message}`)
    process.exit(1)
  }
  console.error(`sync-tasks: ${error?.message ?? String(error)}`)
  process.exit(1)
}
