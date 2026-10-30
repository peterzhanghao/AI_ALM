#!/usr/bin/env node
/**
 * CI drill for the requirement → task → board handoff.
 *
 * Runs the real CLI against a throwaway copy of the sample assets:
 * task draft -> TASK-001 pass -> sync dry-run -> uncovered task fails the gate.
 * Exits non-zero on the first mismatch so the workflow step turns red.
 */
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../', import.meta.url))
const bin = join(repoRoot, 'packages/alm-core/bin/alm.mjs')
const root = mkdtempSync(join(tmpdir(), 'alm-task-drill-'))

function run(args, expect = 0) {
  const result = spawnSync(process.execPath, args, { cwd: repoRoot, encoding: 'utf8' })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  if (result.status !== expect) {
    console.error(`FAIL  node ${args.join(' ')} -> exit ${result.status}, expected ${expect}`)
    console.error(output.trim().split(/\r?\n/).slice(-8).join('\n'))
    cleanup()
    process.exit(1)
  }
  return output
}

function expectText(output, needle, label) {
  if (!output.includes(needle)) {
    console.error(`FAIL  ${label}: missing "${needle}"`)
    cleanup()
    process.exit(1)
  }
}

function cleanup() {
  rmSync(root, { recursive: true, force: true })
}

try {
  cpSync(join(repoRoot, 'fixtures/order-refund'), root, { recursive: true })
  mkdirSync(join(root, '.alm/changes'), { recursive: true })
  writeFileSync(
    join(root, '.alm/changes/CHG-DRILL.json'),
    JSON.stringify({ schema: 'alm.change/v1', changeId: 'CHG-DRILL', baselineSha: 'abcdef1234567890', branch: 'alm/chg-drill', status: 'open' }),
    'utf8',
  )

  const draft = run([bin, 'task', 'draft', '--root', root, '--change', 'CHG-DRILL', '--from', 'REQ-PAY-001'])
  expectText(draft, 'drafted 3 tasks', 'task draft')
  expectText(draft, 'TASK-PAY-001', 'task draft ids')

  const check = run([bin, 'check', '--root', root])
  expectText(check, 'pass TASK-001', 'TASK-001 pass')
  expectText(check, 'check: pass', 'check result')

  const sync = run([join(repoRoot, 'scripts/sync-tasks.mjs'), '--root', root, '--change', 'CHG-DRILL'])
  expectText(sync, 'dry-run', 'sync dry-run')
  expectText(sync, 'TASK-PAY-001', 'sync body')

  const tasksFile = join(root, 'changes/CHG-DRILL/tasks.json')
  const payload = JSON.parse(readFileSync(tasksFile, 'utf8'))
  payload.tasks[0].covers = []
  writeFileSync(tasksFile, JSON.stringify(payload, null, 2), 'utf8')

  const negative = run([bin, 'check', '--root', root], 1)
  expectText(negative, 'fail TASK-001', 'TASK-001 negative')

  console.log('task-drill: draft=3 TASK-001=pass sync=dry-run negative=fail')
  cleanup()
} catch (error) {
  console.error(`task-drill: ${error?.message ?? String(error)}`)
  cleanup()
  process.exit(1)
}
