import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { listWorkspaces, workspacesFile } from '../workspaces.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const fixture = join(repoRoot, 'fixtures/order-refund')
const dirs = []

function makeStore(entries, defaultId = 'default-ws') {
  const dir = mkdtempSync(join(tmpdir(), 'alm-workspaces-'))
  dirs.push(dir)
  const file = join(dir, 'workspace.json')
  writeFileSync(
    file,
    JSON.stringify({
      unit: { name: 'workspace', version: 2 },
      global: { initialized: true, defaultWorkspaceId: defaultId, workspaceIds: Object.keys(entries) },
      tables: { workspaces: entries },
    }),
  )
  return file
}

test.after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

test('listWorkspaces excludes the default workspace and resolves linked projects', () => {
  const unlinked = mkdtempSync(join(tmpdir(), 'alm-ws-unlinked-'))
  dirs.push(unlinked)
  const file = makeStore({
    'default-ws': { path: join(unlinked, 'default'), title: 'default-workspace' },
    'pay-ws': { path: fixture, title: '支付平台工作区' },
    'bare-ws': { path: unlinked, title: 'plug-in' },
  })
  const payload = listWorkspaces({ file })
  assert.equal(payload.schema, 'alm.workspaces/v1')
  assert.equal(payload.defaultWorkspaceId, 'default-ws')
  assert.equal(payload.workspaces.length, 2)
  assert.ok(!payload.workspaces.some((workspace) => workspace.workspaceId === 'default-ws'))

  const pay = payload.workspaces.find((workspace) => workspace.workspaceId === 'pay-ws')
  assert.equal(pay.projectId, 'PAY')
  assert.equal(pay.linked, true)
  assert.equal(pay.github.repo, 'AI_ALM')
  assert.equal(pay.exists, true)

  const bare = payload.workspaces.find((workspace) => workspace.workspaceId === 'bare-ws')
  assert.equal(bare.linked, false)
  assert.equal(bare.projectId, null)
  assert.ok(payload.workspaces[0].title.localeCompare(payload.workspaces[1].title, 'zh-CN') <= 0)
})

test('listWorkspaces reports missing workspace paths and unreadable stores', () => {
  const file = makeStore({ 'ghost-ws': { path: join(tmpdir(), 'alm-no-such-workspace-dir'), title: 'ghost' } })
  const payload = listWorkspaces({ file })
  assert.equal(payload.workspaces.length, 1)
  assert.equal(payload.workspaces[0].exists, false)
  assert.equal(payload.workspaces[0].linked, false)

  const empty = listWorkspaces({ file: join(tmpdir(), 'alm-no-workspace-store.json') })
  assert.equal(empty.workspaces.length, 0)
  assert.equal(empty.errors.length, 0)
})

test('workspacesFile honours DSH_WORKSPACES_FILE', () => {
  const previous = process.env.DSH_WORKSPACES_FILE
  process.env.DSH_WORKSPACES_FILE = 'C:/tmp/override-workspace.json'
  try {
    assert.equal(workspacesFile(), 'C:\\tmp\\override-workspace.json')
  } finally {
    if (previous === undefined) delete process.env.DSH_WORKSPACES_FILE
    else process.env.DSH_WORKSPACES_FILE = previous
  }
})
