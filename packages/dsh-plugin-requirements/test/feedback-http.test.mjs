/**
 * HTTP contract tests for the manual feedback loop (feedback v1 contract §3).
 *
 * Every test boots the real plugin HTTP server on a random loopback port and
 * exercises the route exactly like the GUI does. The feedback slice is
 * zero-model-call, so no fake AI stream is needed: what matters is destination
 * resolution from the trusted workspace store, input validation, idempotency
 * and where files land.
 *
 * The observation workspace is a copy of `fixtures/order-refund`; destinations
 * are separate temp repositories registered through `DSH_WORKSPACES_FILE`.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import RequirementsService from '../index.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const fixture = join(repoRoot, 'fixtures/order-refund')
const FEEDBACK_ROUTE = '/api/alm/requirements/feedback'

function tempFixture(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  cpSync(fixture, dir, { recursive: true })
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['add', '-A'], { cwd: dir })
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'init'], {
    cwd: dir,
  })
  return dir
}

function requirementFiles(root) {
  return readdirSync(join(root, 'requirements'))
    .filter((name) => name.endsWith('.sdoc'))
    .sort()
}

/** A destination repository: valid `.alm/project.json` plus requirements/. */
function tempTarget(prefix, { id = 'PLUGIN', blockWrite = false, requirementsFile = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  mkdirSync(join(dir, '.alm'), { recursive: true })
  writeFileSync(
    join(dir, '.alm', 'project.json'),
    JSON.stringify({
      schema: 'alm.project/v1',
      id,
      name: `${id} 开发空间`,
      defaultBranch: 'main',
      requirementRoot: 'requirements',
      github: { owner: 'peterzhanghao', repo: 'AI_ALM' },
      teams: [`${id} 团队`],
    }),
  )
  mkdirSync(join(dir, 'requirements'), { recursive: true })
  if (requirementsFile) {
    rmSync(join(dir, 'requirements'), { recursive: true, force: true })
    writeFileSync(join(dir, 'requirements'), 'not a directory')
  }
  execFileSync('git', ['init', '-q'], { cwd: dir })
  // A regular file where the write probe wants a directory makes the target
  // exist and be linked but provably not writable for feedback.
  if (blockWrite) writeFileSync(join(dir, '.alm', 'feedback'), '')
  return dir
}

/** Temporary DSH workspace store; `entries` maps workspaceId -> {root,title}. */
function workspaceStore(entries) {
  const dir = mkdtempSync(join(tmpdir(), 'alm-fb-store-'))
  const file = join(dir, 'workspace.json')
  const table = { default: { path: join(dir, 'default-workspace'), title: 'default-workspace' } }
  for (const [workspaceId, entry] of Object.entries(entries)) {
    table[workspaceId] = { path: entry.root, title: entry.title ?? workspaceId }
  }
  const payload = { global: { defaultWorkspaceId: 'default' }, tables: { workspaces: table } }
  writeFileSync(file, JSON.stringify(payload, null, 2))
  return file
}

/** Boot the plugin route against `root`, with the workspace store env set. */
async function withServer(root, storeFile, run) {
  const previous = process.env.DSH_WORKSPACES_FILE
  process.env.DSH_WORKSPACES_FILE = storeFile
  const routes = new Map()
  const ctx = {
    effect(callback) {
      callback()
    },
    get: () => undefined,
    webServer: {
      register(route) {
        routes.set(route.path, route.handler)
        return () => routes.delete(route.path)
      },
    },
    tools: { register: () => () => {} },
  }
  new RequirementsService(ctx, { root })
  const server = createServer((req, res) => {
    const handler = routes.get(new URL(req.url, 'http://127.0.0.1').pathname)
    if (!handler) {
      res.writeHead(404).end('not found')
      return
    }
    handler(req, res)
  })
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
  const base = `http://127.0.0.1:${server.address().port}`
  const url = (query = '') => `${base}${FEEDBACK_ROUTE}?root=${encodeURIComponent(root)}${query}`
  const post = async (body) => {
    const response = await fetch(url(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return { status: response.status, payload: await response.json() }
  }
  const get = async (query = '') => {
    const response = await fetch(url(query === '' ? '' : `&${query}`))
    return { status: response.status, payload: await response.json() }
  }
  try {
    await run({ base, url, post, get })
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose))
    if (previous === undefined) delete process.env.DSH_WORKSPACES_FILE
    else process.env.DSH_WORKSPACES_FILE = previous
  }
}

/** Save one feedback record and return its id. */
async function saveFeedback(post, overrides = {}) {
  const response = await post({
    action: 'save',
    statement: '退款进度看不到，用户一直问客服',
    category: '缺陷',
    ...overrides,
  })
  assert.equal(response.status, 200, JSON.stringify(response.payload))
  assert.equal(response.payload.ok, true)
  return response.payload
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

test('GET settings returns the disabled default and trusted workspaces with a writability hint', async () => {
  const obs = tempFixture('alm-fb-settings-')
  const target = tempTarget('alm-fb-target-')
  const blocked = tempTarget('alm-fb-blocked-', { id: 'BLOCK', requirementsFile: true })
  try {
    const store = workspaceStore({
      'ws-obs': { root: obs, title: '观察工作区' },
      'ws-plugin': { root: target, title: '插件开发' },
      'ws-blocked': { root: blocked, title: '不可写空间' },
    })
    await withServer(obs, store, async ({ get }) => {
      const { status, payload } = await get('action=settings')
      assert.equal(status, 200, JSON.stringify(payload))
      assert.equal(payload.schema, 'alm.feedback.settings/v1')
      assert.equal(payload.settings.enabled, false)
      assert.equal(payload.settings.destinationWorkspace, null)
      assert.equal(payload.settings.capture.maxRecords, 500)
      assert.equal(payload.settings.coverage.stages.length > 0, true)
      const byId = new Map(payload.workspaces.map((workspace) => [workspace.workspaceId, workspace]))
      assert.equal(byId.get('ws-plugin').writable, true)
      assert.equal(byId.get('ws-plugin').projectId, 'PLUGIN')
      assert.equal(byId.get('ws-blocked').writable, false)
    })
  } finally {
    rmSync(obs, { recursive: true, force: true })
    rmSync(target, { recursive: true, force: true })
    rmSync(blocked, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

test('save freezes server-side observed facts and keeps only whitelisted context', async () => {
  const obs = tempFixture('alm-fb-save-')
  try {
    const store = workspaceStore({ 'ws-obs': { root: obs, title: '观察工作区' } })
    await withServer(obs, store, async ({ post, get }) => {
      const saved = await saveFeedback(post, {
        statement: '  退款按钮点了没反应  ',
        context: {
          ui: { page: 'list', stage: 'review', junk: 'drop-me' },
          links: { requirementId: 'REQ-PAY-001', requirementRevision: 2, intentSessionId: 'INT-1' },
          observedWorkspace: { root: 'C:\\evil', workspaceId: 'hacker', projectId: 'EVIL' },
          targetProduct: { product: 'dsh-requirements-plugin', junk: 'drop-me' },
          junkKey: 'drop-me',
        },
      })
      assert.equal(saved.feedback.id, 'FB-0001')
      assert.equal(saved.feedback.status, 'needs-routing')
      assert.equal(saved.receipt.changed, true)
      assert.equal(saved.routing.reason, 'no-destination')
      assert.equal(saved.routing.destination, null)
      assert.equal(saved.inbox.counts.needsRouting, 1)

      const detail = await get('action=record&id=FB-0001')
      assert.equal(detail.status, 200, JSON.stringify(detail.payload))
      const feedback = detail.payload.feedback
      assert.equal(detail.payload.schema, 'alm.feedback.detail/v1')
      assert.equal(feedback.statement, '退款按钮点了没反应')
      assert.match(feedback.context.contextSnapshotId, /^FCTX-\d{4}$/)
      assert.ok(feedback.context.capturedAt, 'capturedAt is assigned server-side')
      assert.equal(resolve(feedback.context.observedWorkspace.root), resolve(obs))
      assert.equal(feedback.context.observedWorkspace.workspaceId, 'ws-obs')
      assert.equal(feedback.context.observedWorkspace.projectId, 'PAY')
      assert.equal(feedback.context.ui.page, 'list')
      assert.equal(feedback.context.ui.stage, 'review')
      assert.equal(feedback.context.ui.junk, undefined)
      assert.equal(feedback.context.junkKey, undefined)
      assert.equal(feedback.context.links.requirementId, 'REQ-PAY-001')
      assert.equal(feedback.context.links.requirementRevision, 2)
    })
  } finally {
    rmSync(obs, { recursive: true, force: true })
  }
})

test('save rejects an empty statement and an over-long statement before writing', async () => {
  const obs = tempFixture('alm-fb-statement-')
  try {
    const store = workspaceStore({ 'ws-obs': { root: obs, title: '观察工作区' } })
    await withServer(obs, store, async ({ post, get }) => {
      const empty = await post({ action: 'save', statement: '   ' })
      assert.equal(empty.status, 400, JSON.stringify(empty.payload))
      assert.equal(empty.payload.error.code, 'statement-required')

      const missing = await post({ action: 'save' })
      assert.equal(missing.status, 400)
      assert.equal(missing.payload.error.code, 'statement-required')

      const long = await post({ action: 'save', statement: '退'.repeat(4001) })
      assert.equal(long.status, 400, JSON.stringify(long.payload))
      assert.equal(long.payload.error.code, 'statement-too-long')

      const inbox = await get('action=inbox')
      assert.equal(inbox.status, 200)
      assert.equal(inbox.payload.items.length, 0)
      assert.equal(inbox.payload.counts.needsRouting, 0)
    })
  } finally {
    rmSync(obs, { recursive: true, force: true })
  }
})

test('save is idempotent per clientRequestId and keeps the first snapshot', async () => {
  const obs = tempFixture('alm-fb-idem-')
  try {
    const store = workspaceStore({ 'ws-obs': { root: obs, title: '观察工作区' } })
    await withServer(obs, store, async ({ post, get }) => {
      const first = await saveFeedback(post, { statement: '第一次反馈', clientRequestId: 'save-1' })
      const second = await saveFeedback(post, { statement: '第一次反馈', clientRequestId: 'save-1' })
      assert.equal(second.feedback.id, first.feedback.id)
      assert.equal(second.receipt.changed, false)
      assert.equal(second.receipt.build.clientBuild, first.receipt.build.clientBuild)
      assert.equal(typeof second.receipt.observedAt, 'string')

      // Same key, same text, different captured context: the new snapshot would
      // be silently dropped, which looks like "my page/error was recorded" but
      // is not. The conflict must name the record that already exists.
      const changedContext = await post({
        action: 'save',
        statement: '第一次反馈',
        clientRequestId: 'save-1',
        context: { ui: { page: 'detail', stage: 'test' } },
      })
      assert.equal(changedContext.status, 409, JSON.stringify(changedContext.payload))
      assert.equal(changedContext.payload.error.code, 'idempotency-conflict')
      assert.equal(changedContext.payload.error.details?.existing?.id, first.feedback.id)

      // Same key, different text: the user must not believe the new text was
      // saved while the first snapshot answers instead.
      const conflicting = await post({ action: 'save', statement: '第二次反馈', clientRequestId: 'save-1' })
      assert.equal(conflicting.status, 409, JSON.stringify(conflicting.payload))
      assert.equal(conflicting.payload.error.code, 'idempotency-conflict')

      const inbox = await get('action=inbox')
      assert.equal(inbox.payload.items.length, 1)
      assert.equal(inbox.payload.items[0].statementExcerpt, '第一次反馈')
      const detail = await get(`action=record&id=${first.feedback.id}`)
      assert.equal(detail.payload.feedback.statement, '第一次反馈')
    })
  } finally {
    rmSync(obs, { recursive: true, force: true })
  }
})

test('diagnostics exposes the running build identity', async () => {
  const obs = tempFixture('alm-fb-build-')
  try {
    const store = workspaceStore({ 'ws-obs': { root: obs, title: '观察工作区' } })
    await withServer(obs, store, async ({ get }) => {
      const response = await get('action=diagnostics')
      assert.equal(response.status, 200, JSON.stringify(response.payload))
      assert.equal(response.payload.schema, 'alm.feedback.build/v1')
      assert.match(response.payload.clientBuild, /^feedback-v2\//)
      assert.equal(typeof response.payload.buildAt, 'string')
    })
  } finally {
    rmSync(obs, { recursive: true, force: true })
  }
})

test('save carries the click-observed time and recent error into the stored context', async () => {
  const obs = tempFixture('alm-fb-capture-')
  try {
    const store = workspaceStore({ 'ws-obs': { root: obs, title: '观察工作区' } })
    await withServer(obs, store, async ({ post, get }) => {
      const saved = await saveFeedback(post, {
        statement: '回答弹窗打不开',
        context: {
          observedAt: '2026-11-03T02:55:10.000Z',
          capture: { kind: 'client-click', clientBuild: 'feedback-v2/test' },
          recentError: 'Error: 没有找到决策请求文件',
          links: { requirementId: 'REQ-ALM-001', requirementRevision: 2, requirementFile: 'requirements/req-alm-001.sdoc' },
        },
      })
      assert.equal(saved.receipt.observedAt, '2026-11-03T02:55:10.000Z')
      assert.equal(typeof saved.receipt.receivedAt, 'string')
      assert.notEqual(saved.receipt.observedAt, saved.receipt.receivedAt)

      const detail = await get(`action=record&id=${saved.feedback.id}`)
      assert.equal(detail.payload.feedback.context.observedAt, '2026-11-03T02:55:10.000Z')
      assert.equal(detail.payload.feedback.context.links.requirementRevision, 2)
      assert.equal(detail.payload.feedback.context.links.requirementFile, 'requirements/req-alm-001.sdoc')
      assert.deepEqual(detail.payload.feedback.context.evidence.textExcerpts, [
        { label: '最近错误', text: 'Error: 没有找到决策请求文件', truncated: false },
      ])
    })
  } finally {
    rmSync(obs, { recursive: true, force: true })
  }
})

test('save routes to an explicit destination and refuses an unknown workspace id', async () => {
  const obs = tempFixture('alm-fb-route-')
  const target = tempTarget('alm-fb-target-')
  try {
    const store = workspaceStore({
      'ws-obs': { root: obs, title: '观察工作区' },
      'ws-plugin': { root: target, title: '插件开发' },
    })
    await withServer(obs, store, async ({ post, get }) => {
      const routed = await saveFeedback(post, {
        statement: '希望列表能按状态筛选',
        destinationWorkspaceId: 'ws-plugin',
      })
      assert.equal(routed.feedback.status, 'routed')
      assert.equal(routed.routing.destination.workspaceId, 'ws-plugin')
      assert.equal(routed.routing.destination.projectId, 'PLUGIN')
      assert.deepEqual(requirementFiles(target), [])

      const unknown = await post({
        action: 'save',
        statement: '不要写入',
        destinationWorkspaceId: 'D:\\tmp\\evil-workspace',
        clientRequestId: 'evil-path',
      })
      assert.equal(unknown.status, 422, JSON.stringify(unknown.payload))
      assert.equal(unknown.payload.error.code, 'destination-not-configured')
      const inbox = await get('action=inbox')
      assert.equal(inbox.payload.items.length, 1, 'a rejected destination never writes a record')
    })
  } finally {
    rmSync(obs, { recursive: true, force: true })
    rmSync(target, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// Generate / settings / retry
// ---------------------------------------------------------------------------

test('POST settings stores the destination without creating a requirement', async () => {
  const obs = tempFixture('alm-fb-set-')
  const target = tempTarget('alm-fb-target-')
  try {
    const store = workspaceStore({
      'ws-obs': { root: obs, title: '观察工作区' },
      'ws-plugin': { root: target, title: '插件开发' },
    })
    await withServer(obs, store, async ({ post, get }) => {
      const set = await post({ action: 'settings', destinationWorkspaceId: 'ws-plugin', capture: { maxRecords: 42 } })
      assert.equal(set.status, 200, JSON.stringify(set.payload))
      assert.equal(set.payload.settings.destinationWorkspace.workspaceId, 'ws-plugin')
      assert.equal(set.payload.settings.enabled, false, 'enabled stays read-only in slice 1')
      assert.equal(set.payload.settings.capture.maxRecords, 42)

      const read = await get('action=settings')
      assert.equal(read.payload.settings.destinationWorkspace.projectId, 'PLUGIN')
      assert.deepEqual(requirementFiles(target), [])

      const bad = await post({ action: 'settings', destinationWorkspaceId: 'ws-elsewhere' })
      assert.equal(bad.status, 422, JSON.stringify(bad.payload))
      assert.equal(bad.payload.error.code, 'destination-not-configured')
    })
  } finally {
    rmSync(obs, { recursive: true, force: true })
    rmSync(target, { recursive: true, force: true })
  }
})

test('generate without a destination returns 422 and keeps the feedback needs-routing', async () => {
  const obs = tempFixture('alm-fb-nodest-')
  try {
    const store = workspaceStore({ 'ws-obs': { root: obs, title: '观察工作区' } })
    await withServer(obs, store, async ({ post, get }) => {
      const saved = await saveFeedback(post)
      const generated = await post({ action: 'generate', id: saved.feedback.id, priority: 'P1' })
      assert.equal(generated.status, 422, JSON.stringify(generated.payload))
      assert.equal(generated.payload.error.code, 'destination-not-configured')

      const detail = await get(`action=record&id=${saved.feedback.id}`)
      assert.equal(detail.payload.feedback.status, 'needs-routing')
      assert.equal(detail.payload.feedback.requirement, null)
      assert.equal(detail.payload.requirement, null)
    })
  } finally {
    rmSync(obs, { recursive: true, force: true })
  }
})

test('generate requires an explicit priority and never guesses one', async () => {
  const obs = tempFixture('alm-fb-prio-')
  const target = tempTarget('alm-fb-target-')
  try {
    const store = workspaceStore({
      'ws-obs': { root: obs, title: '观察工作区' },
      'ws-plugin': { root: target, title: '插件开发' },
    })
    await withServer(obs, store, async ({ post, get }) => {
      const saved = await saveFeedback(post)
      const configured = await post({ action: 'settings', destinationWorkspaceId: 'ws-plugin' })
      assert.equal(configured.status, 200, JSON.stringify(configured.payload))

      const noPriority = await post({ action: 'generate', id: saved.feedback.id })
      assert.equal(noPriority.status, 422, JSON.stringify(noPriority.payload))
      assert.equal(noPriority.payload.error.code, 'priority-required')

      const invalid = await post({ action: 'generate', id: saved.feedback.id, priority: 'P3' })
      assert.equal(invalid.status, 422)
      assert.equal(invalid.payload.error.code, 'priority-required')

      assert.deepEqual(requirementFiles(target), [])
      const detail = await get(`action=record&id=${saved.feedback.id}`)
      assert.notEqual(detail.payload.feedback.status, 'requirement-created')
    })
  } finally {
    rmSync(obs, { recursive: true, force: true })
    rmSync(target, { recursive: true, force: true })
  }
})

test('generate creates a real requirement in the destination with source=feedback and priority', async () => {
  const obs = tempFixture('alm-fb-gen-')
  const target = tempTarget('alm-fb-target-')
  try {
    const store = workspaceStore({
      'ws-obs': { root: obs, title: '观察工作区' },
      'ws-plugin': { root: target, title: '插件开发' },
    })
    await withServer(obs, store, async ({ post, get }) => {
      const saved = await saveFeedback(post, {
        statement: '退款进度看不到，用户一直问客服',
        category: '体验',
        context: { ui: { page: 'detail', stage: 'review' }, links: { requirementId: 'REQ-PAY-002' } },
      })
      const configured = await post({ action: 'settings', destinationWorkspaceId: 'ws-plugin' })
      assert.equal(configured.status, 200, JSON.stringify(configured.payload))
      const before = requirementFiles(obs)

      const generated = await post({
        action: 'generate',
        id: saved.feedback.id,
        priority: 'P1',
        title: '补齐退款进度展示',
      })
      assert.equal(generated.status, 200, JSON.stringify(generated.payload))
      assert.equal(generated.payload.ok, true)
      assert.equal(generated.payload.feedback.status, 'requirement-created')
      assert.equal(generated.payload.receipt.changed, true)
      assert.match(generated.payload.requirement.id, /^REQ-PLUGIN-\d{3}$/)
      assert.equal(resolve(generated.payload.requirement.root), resolve(target))
      assert.match(generated.payload.proposal.id, /^IMP-\d{4}$/)
      assert.ok(generated.payload.proposal.fingerprint)

      const files = requirementFiles(target)
      assert.deepEqual(files, ['req-plugin-001.sdoc'])
      const sdoc = readFileSync(join(target, 'requirements', files[0]), 'utf8')
      assert.match(sdoc, /^PRIORITY: P1$/m)
      assert.match(sdoc, /^SOURCE: feedback$/m)
      assert.match(sdoc, /^TITLE: 补齐退款进度展示$/m)
      const brief = readFileSync(join(target, 'requirements', 'briefs', 'REQ-PLUGIN-001.md'), 'utf8')
      assert.match(brief, /退款进度看不到/)
      assert.match(brief, /## 反馈来源/)
      assert.match(brief, /反馈 ID：FB-0001/)
      assert.match(brief, /REQ-PAY-002/)
      assert.doesNotMatch(brief, new RegExp(escapeRegExp(obs)), 'the observation root never leaks into the brief')

      // The observation workspace stays untouched, including its requirements.
      assert.deepEqual(requirementFiles(obs), before)
      assert.equal(existsSync(join(target, '.alm', 'feedback', 'records', 'FB-0001.json')), false)
    })
  } finally {
    rmSync(obs, { recursive: true, force: true })
    rmSync(target, { recursive: true, force: true })
  }
})

test('generate is idempotent: a replay returns the same requirement and creates no second file', async () => {
  const obs = tempFixture('alm-fb-gen-idem-')
  const target = tempTarget('alm-fb-target-')
  try {
    const store = workspaceStore({
      'ws-obs': { root: obs, title: '观察工作区' },
      'ws-plugin': { root: target, title: '插件开发' },
    })
    await withServer(obs, store, async ({ post, get }) => {
      const saved = await saveFeedback(post)
      await post({ action: 'settings', destinationWorkspaceId: 'ws-plugin' })
      const first = await post({ action: 'generate', id: saved.feedback.id, priority: 'P2' })
      assert.equal(first.status, 200, JSON.stringify(first.payload))
      assert.equal(first.payload.receipt.changed, true)

      const replay = await post({ action: 'generate', id: saved.feedback.id, priority: 'P2' })
      assert.equal(replay.status, 200, JSON.stringify(replay.payload))
      assert.equal(replay.payload.receipt.changed, false)
      assert.equal(replay.payload.requirement.id, first.payload.requirement.id)
      assert.equal(replay.payload.feedback.status, 'requirement-created')
      assert.deepEqual(requirementFiles(target), ['req-plugin-001.sdoc'])

      const detail = await get(`action=record&id=${saved.feedback.id}`)
      assert.equal(detail.payload.feedback.requirement.id, first.payload.requirement.id)
      assert.equal(detail.payload.requirement.id, first.payload.requirement.id)
      assert.equal(detail.payload.proposal.status, 'converted')
      assert.equal(detail.payload.proposal.requirementRef.id, first.payload.requirement.id)
    })
  } finally {
    rmSync(obs, { recursive: true, force: true })
    rmSync(target, { recursive: true, force: true })
  }
})

test('generate reconciles a requirement created before the link was written', async () => {
  const obs = tempFixture('alm-fb-conv-')
  const target = tempTarget('alm-fb-target-')
  try {
    const store = workspaceStore({
      'ws-obs': { root: obs, title: '观察工作区' },
      'ws-plugin': { root: target, title: '插件开发' },
    })
    await withServer(obs, store, async ({ post, get }) => {
      const saved = await saveFeedback(post)
      await post({ action: 'settings', destinationWorkspaceId: 'ws-plugin' })
      const first = await post({ action: 'generate', id: saved.feedback.id, priority: 'P2' })
      assert.equal(first.status, 200, JSON.stringify(first.payload))
      const requirementId = first.payload.requirement.id

      // Simulate the crash window: the requirement file exists and the
      // conversion was recorded as "created", but the link write never landed.
      const recordPath = join(obs, '.alm', 'feedback', 'records', `${saved.feedback.id}.json`)
      const record = JSON.parse(readFileSync(recordPath, 'utf8'))
      record.status = 'saved'
      delete record.requirement
      record.conversion = { id: `FBC-${saved.feedback.id}`, state: 'created', requirementId, requirementRoot: target, at: new Date().toISOString() }
      writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`)

      const retried = await post({ action: 'generate', id: saved.feedback.id, priority: 'P2' })
      assert.equal(retried.status, 200, JSON.stringify(retried.payload))
      assert.equal(retried.payload.requirement.id, requirementId, 'no duplicate requirement is created')
      assert.deepEqual(requirementFiles(target), ['req-plugin-001.sdoc'])
      const detail = await get(`action=record&id=${saved.feedback.id}`)
      assert.equal(detail.payload.feedback.requirement.id, requirementId)
      assert.equal(detail.payload.feedback.conversion.state, 'linked')
    })
  } finally {
    rmSync(obs, { recursive: true, force: true })
    rmSync(target, { recursive: true, force: true })
  }
})

test('requirement-ref reads the real requirement state and refuses to equate it with resolution', async () => {
  const obs = tempFixture('alm-fb-ref-')
  const target = tempTarget('alm-fb-target-')
  try {
    const store = workspaceStore({
      'ws-obs': { root: obs, title: '观察工作区' },
      'ws-plugin': { root: target, title: '插件开发' },
    })
    await withServer(obs, store, async ({ post, get }) => {
      const saved = await saveFeedback(post)
      const missing = await get(`action=requirement-ref&id=${saved.feedback.id}`)
      assert.equal(missing.status, 404)
      assert.equal(missing.payload.error.code, 'requirement-not-linked')

      await post({ action: 'settings', destinationWorkspaceId: 'ws-plugin' })
      const generated = await post({ action: 'generate', id: saved.feedback.id, priority: 'P2' })
      assert.equal(generated.status, 200, JSON.stringify(generated.payload))

      const ref = await get(`action=requirement-ref&id=${saved.feedback.id}`)
      assert.equal(ref.status, 200, JSON.stringify(ref.payload))
      assert.equal(ref.payload.schema, 'alm.feedback.requirement-ref/v1')
      assert.equal(ref.payload.found, true)
      assert.equal(ref.payload.requirement.id, generated.payload.requirement.id)
      assert.equal(ref.payload.requirement.workspaceId, 'ws-plugin')
      assert.equal(ref.payload.requirement.projectId, 'PLUGIN')
      assert.match(ref.payload.requirement.file, /req-plugin-001\.sdoc$/)
      assert.ok(ref.payload.requirement.status)
      assert.match(ref.payload.resolutionHint, /不等于原问题解决|人工确认/)
    })
  } finally {
    rmSync(obs, { recursive: true, force: true })
    rmSync(target, { recursive: true, force: true })
  }
})

test('generate refuses a not-writable destination and preserves the feedback', async () => {
  const obs = tempFixture('alm-fb-blocked-')
  const blocked = tempTarget('alm-fb-target-blocked-', { id: 'BLOCK', blockWrite: true })
  try {
    const store = workspaceStore({
      'ws-obs': { root: obs, title: '观察工作区' },
      'ws-blocked': { root: blocked, title: '不可写空间' },
    })
    await withServer(obs, store, async ({ post, get }) => {
      const saved = await saveFeedback(post)
      await post({ action: 'settings', destinationWorkspaceId: 'ws-blocked' })
      const generated = await post({ action: 'generate', id: saved.feedback.id, priority: 'P1' })
      assert.equal(generated.status, 422, JSON.stringify(generated.payload))
      assert.equal(generated.payload.error.code, 'destination-not-writable')

      const detail = await get(`action=record&id=${saved.feedback.id}`)
      assert.ok(
        ['needs-routing', 'failed'].includes(detail.payload.feedback.status),
        `unexpected status ${detail.payload.feedback.status}`,
      )
      assert.equal(detail.payload.feedback.requirement, null)
      assert.deepEqual(requirementFiles(blocked), [])
    })
  } finally {
    rmSync(obs, { recursive: true, force: true })
    rmSync(blocked, { recursive: true, force: true })
  }
})

test('generate to a missing destination directory returns 422 destination-not-configured', async () => {
  const obs = tempFixture('alm-fb-ghost-')
  try {
    const store = workspaceStore({
      'ws-obs': { root: obs, title: '观察工作区' },
      'ws-ghost': { root: join(tmpdir(), `alm-fb-ghost-${Date.now()}-missing`), title: '不存在的空间' },
    })
    await withServer(obs, store, async ({ post, get }) => {
      const saved = await saveFeedback(post)
      await post({ action: 'settings', destinationWorkspaceId: 'ws-ghost' })
      const generated = await post({ action: 'generate', id: saved.feedback.id, priority: 'P1' })
      assert.equal(generated.status, 422, JSON.stringify(generated.payload))
      assert.equal(generated.payload.error.code, 'destination-not-configured')

      const detail = await get(`action=record&id=${saved.feedback.id}`)
      assert.ok(['needs-routing', 'failed'].includes(detail.payload.feedback.status))
    })
  } finally {
    rmSync(obs, { recursive: true, force: true })
  }
})

test('retry re-routes a saved feedback without generating a requirement', async () => {
  const obs = tempFixture('alm-fb-retry-')
  const target = tempTarget('alm-fb-target-')
  try {
    const store = workspaceStore({
      'ws-obs': { root: obs, title: '观察工作区' },
      'ws-plugin': { root: target, title: '插件开发' },
    })
    await withServer(obs, store, async ({ post, get }) => {
      const saved = await saveFeedback(post)
      const retryBefore = await post({ action: 'retry', id: saved.feedback.id })
      assert.equal(retryBefore.status, 422, JSON.stringify(retryBefore.payload))
      assert.equal(retryBefore.payload.error.code, 'destination-not-configured')

      await post({ action: 'settings', destinationWorkspaceId: 'ws-plugin' })
      const retry = await post({ action: 'retry', id: saved.feedback.id })
      assert.equal(retry.status, 200, JSON.stringify(retry.payload))
      assert.equal(retry.payload.feedback.status, 'routed')
      assert.deepEqual(requirementFiles(target), [], 'retry never auto-generates')

      const retried = await post({ action: 'retry', id: saved.feedback.id })
      assert.equal(retried.status, 200, JSON.stringify(retried.payload))
      assert.equal(retried.payload.feedback.status, 'routed')
      const detail = await get(`action=record&id=${saved.feedback.id}`)
      assert.equal(detail.payload.requirement, null)
    })
  } finally {
    rmSync(obs, { recursive: true, force: true })
    rmSync(target, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// Inbox, category, record and routing errors
// ---------------------------------------------------------------------------

test('inbox counts statuses and category update appends a note', async () => {
  const obs = tempFixture('alm-fb-inbox-')
  try {
    const store = workspaceStore({ 'ws-obs': { root: obs, title: '观察工作区' } })
    await withServer(obs, store, async ({ post, get }) => {
      const saved = await saveFeedback(post, { statement: '把筛选条件记住', category: '新能力' })
      const detail = await get(`action=record&id=${saved.feedback.id}`)
      assert.equal(detail.payload.feedback.category, 'capability')

      const updated = await post({ action: 'category', id: saved.feedback.id, category: '缺陷', notes: '确认是缺陷' })
      assert.equal(updated.status, 200, JSON.stringify(updated.payload))
      assert.equal(updated.payload.feedback.category, 'defect')
      assert.equal(updated.payload.feedback.notes.length, 1)
      assert.equal(updated.payload.feedback.notes[0].text, '确认是缺陷')

      const invalid = await post({ action: 'category', id: saved.feedback.id, category: 'bug-ish' })
      assert.equal(invalid.status, 400, JSON.stringify(invalid.payload))
      assert.equal(invalid.payload.error.code, 'category-invalid')

      const inbox = await get('action=inbox')
      assert.equal(inbox.status, 200)
      assert.equal(inbox.payload.schema, 'alm.feedback.inbox/v1')
      assert.equal(inbox.payload.items.length, 1)
      assert.equal(inbox.payload.items[0].category, 'defect')
      assert.equal(inbox.payload.counts.needsRouting, 1)
      assert.equal(inbox.payload.counts.requirementCreated, 0)
    })
  } finally {
    rmSync(obs, { recursive: true, force: true })
  }
})

test('secrets in the statement are redacted before they reach disk and the inbox', async () => {
  const obs = tempFixture('alm-fb-redact-')
  try {
    const store = workspaceStore({ 'ws-obs': { root: obs, title: '观察工作区' } })
    await withServer(obs, store, async ({ post, get }) => {
      const saved = await saveFeedback(post, { statement: '接口报错，token 是 sk-abcdefgh12345678' })
      const detail = await get(`action=record&id=${saved.feedback.id}`)
      assert.doesNotMatch(detail.payload.feedback.statement, /sk-abcdefgh12345678/)
      assert.match(detail.payload.feedback.statement, /\[redacted\]/)
      const inbox = await get('action=inbox')
      assert.doesNotMatch(inbox.payload.items[0].statementExcerpt, /sk-abcdefgh12345678/)
    })
  } finally {
    rmSync(obs, { recursive: true, force: true })
  }
})

test('unknown actions are 404 and unsupported methods never write', async () => {
  const obs = tempFixture('alm-fb-unknown-')
  try {
    const store = workspaceStore({ 'ws-obs': { root: obs, title: '观察工作区' } })
    await withServer(obs, store, async ({ get, post, url }) => {
      const unknownGet = await get('action=nope')
      assert.equal(unknownGet.status, 404, JSON.stringify(unknownGet.payload))
      assert.equal(unknownGet.payload.error.code, 'feedback-action-unknown')

      const unknownPost = await post({ action: 'nope' })
      assert.equal(unknownPost.status, 404, JSON.stringify(unknownPost.payload))

      const invalid = await post({ action: 'save', statement: 42 })
      assert.equal(invalid.status, 400)
      assert.equal(invalid.payload.error.code, 'statement-required')

      const missingId = await post({ action: 'category', category: '缺陷' })
      assert.equal(missingId.status, 400)
      assert.equal(missingId.payload.error.code, 'feedback-id-required')

      const badBody = await fetch(url(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{not-json',
      })
      assert.equal(badBody.status, 400)
      assert.equal((await badBody.json()).error.code, 'invalid-json')
    })
  } finally {
    rmSync(obs, { recursive: true, force: true })
  }
})

test('feedback ids are allocated per observation workspace and never leak across roots', async () => {
  const obsA = tempFixture('alm-fb-a-')
  const obsB = tempFixture('alm-fb-b-')
  try {
    const store = workspaceStore({
      'ws-a': { root: obsA, title: '工作区 A' },
      'ws-b': { root: obsB, title: '工作区 B' },
    })
    let idA
    await withServer(obsA, store, async ({ post, get }) => {
      idA = (await saveFeedback(post, { statement: 'A 的反馈', clientRequestId: 'a-1' })).feedback.id
      assert.equal(idA, 'FB-0001')
      const inbox = await get('action=inbox')
      assert.equal(inbox.payload.items.length, 1)
      assert.equal(inbox.payload.items[0].statementExcerpt, 'A 的反馈')
    })
    await withServer(obsB, store, async ({ post, get }) => {
      const savedB = await saveFeedback(post, { statement: 'B 的反馈', clientRequestId: 'a-1' })
      assert.equal(savedB.feedback.id, 'FB-0001', 'each workspace owns its own ledger')
      const detail = await get('action=record&id=FB-0001')
      assert.equal(detail.payload.feedback.statement, 'B 的反馈')
      assert.equal(detail.payload.feedback.observedWorkspace.root, resolve(obsB))
    })
    const fileA = readFileSync(join(obsA, '.alm', 'feedback', 'records', 'FB-0001.json'), 'utf8')
    const fileB = readFileSync(join(obsB, '.alm', 'feedback', 'records', 'FB-0001.json'), 'utf8')
    assert.match(fileA, /A 的反馈/)
    assert.match(fileB, /B 的反馈/)
    assert.doesNotMatch(fileA, /B 的反馈/)
  } finally {
    rmSync(obsA, { recursive: true, force: true })
    rmSync(obsB, { recursive: true, force: true })
  }
})

test('supplement appends an immutable revision and replays stay idempotent', async () => {
  const obs = tempFixture('alm-fb-supplement-')
  const store = workspaceStore({})
  await withServer(obs, store, async ({ post, get }) => {
    const saved = await saveFeedback(post, { statement: '导出偶尔会多一列' })
    const id = saved.feedback.id

    const supplement = await post({
      action: 'supplement',
      id,
      statement: '今天又出现了，这次是 12 列',
      note: '补充一次复现',
      supplementId: 'sup-http-1',
      context: { ui: { page: 'detail', stage: 'test' }, observedAt: '2026-11-03T03:00:00.000Z' },
      observedAt: '2026-11-03T03:00:00.000Z',
    })
    assert.equal(supplement.status, 200, JSON.stringify(supplement.payload))
    assert.equal(supplement.payload.feedback.statement, '导出偶尔会多一列')
    assert.equal(supplement.payload.feedback.revision, 2)
    assert.equal(supplement.payload.feedback.supplements.length, 1)
    assert.equal(supplement.payload.feedback.supplements[0].statement, '今天又出现了，这次是 12 列')
    assert.equal(typeof supplement.payload.feedback.supplements[0].contextSnapshotId, 'string')

    const replay = await post({ action: 'supplement', id, statement: '今天又出现了，这次是 12 列', supplementId: 'sup-http-1' })
    assert.equal(replay.status, 200)
    assert.equal(replay.payload.feedback.supplements.length, 1)

    const detail = await get(`action=record&id=${id}`)
    assert.equal(detail.payload.feedback.supplements.length, 1)
    const inbox = await get('action=inbox')
    const item = inbox.payload.items.find((entry) => entry.id === id)
    assert.equal(item.supplementCount, 1)

    const empty = await post({ action: 'supplement', id, statement: '   ' })
    assert.equal(empty.status, 400)
    assert.equal(empty.payload.error.code, 'statement-required')
    const missing = await post({ action: 'supplement', id: 'FB-9999', statement: '补充' })
    assert.equal(missing.status, 404)
  })
  rmSync(obs, { recursive: true, force: true })
})

test('disposition and resolution actions enforce the requirement gate and allow reopen', async () => {
  const obs = tempFixture('alm-fb-lifecycle-')
  const store = workspaceStore({})
  await withServer(obs, store, async ({ post, get }) => {
    const saved = await saveFeedback(post, { statement: '提示文案有歧义' })
    const id = saved.feedback.id

    const deferred = await post({ action: 'disposition', id, disposition: 'deferred', reason: '等下一版' })
    assert.equal(deferred.status, 200, JSON.stringify(deferred.payload))
    assert.equal(deferred.payload.feedback.disposition.state, 'deferred')
    assert.equal(deferred.payload.feedback.status, 'needs-routing', 'disposition must not fake creation')

    const invalid = await post({ action: 'disposition', id, disposition: 'done' })
    assert.equal(invalid.status, 400)
    assert.equal(invalid.payload.error.code, 'invalid-disposition')

    const premature = await post({ action: 'resolve', id })
    assert.equal(premature.status, 409)
    assert.equal(premature.payload.error.code, 'resolution-needs-requirement')

    const link = await post({ action: 'link', id, requirement: { id: 'REQ-PAY-001', revision: 1 } })
    assert.equal(link.status, 200, JSON.stringify(link.payload))
    assert.equal(link.payload.feedback.requirement.id, 'REQ-PAY-001')
    assert.equal(link.payload.feedback.disposition.state, 'linked')

    const resolved = await post({ action: 'resolve', id, note: '已在 1.2.0 验证' })
    assert.equal(resolved.status, 200, JSON.stringify(resolved.payload))
    assert.equal(resolved.payload.feedback.resolution.state, 'resolved')

    const reopened = await post({ action: 'reopen', id, note: '同一路径又复现' })
    assert.equal(reopened.status, 200)
    assert.equal(reopened.payload.feedback.resolution.state, 'reopened')

    const inbox = await get('action=inbox')
    const item = inbox.payload.items.find((entry) => entry.id === id)
    assert.equal(item.disposition, 'linked')
    assert.equal(item.resolution, 'reopened')
    assert.equal(item.requirement.id, 'REQ-PAY-001')
  })
  rmSync(obs, { recursive: true, force: true })
})

test('inbox filters narrow items while counts stay global', async () => {
  const obs = tempFixture('alm-fb-filter-')
  const store = workspaceStore({})
  await withServer(obs, store, async ({ post, get }) => {
    const first = await saveFeedback(post, { statement: '列表滚动卡顿', category: '体验' })
    const second = await saveFeedback(post, { statement: '保存按钮没有反应', category: '缺陷' })
    await post({ action: 'disposition', id: second.feedback.id, disposition: 'deferred' })

    const deferred = await get('action=inbox&disposition=deferred')
    assert.equal(deferred.status, 200)
    assert.equal(deferred.payload.items.length, 1)
    assert.equal(deferred.payload.items[0].id, second.feedback.id)
    assert.equal(deferred.payload.total, 2)
    assert.equal(deferred.payload.shown, 1)

    const byText = await get(`action=inbox&q=${encodeURIComponent('滚动')}`)
    assert.equal(byText.payload.items.length, 1)
    assert.equal(byText.payload.items[0].id, first.feedback.id)

    const limited = await get('action=inbox&limit=1')
    assert.equal(limited.payload.items.length, 1)
    assert.equal(limited.payload.total, 2)
  })
  rmSync(obs, { recursive: true, force: true })
})

test('save queues organisation work and process yields a confirmable proposal', async () => {
  const obs = tempFixture('alm-fb-process-')
  const target = tempTarget('alm-fb-process-target-')
  const store = workspaceStore({
    'ws-obs': { root: obs, title: '观察工作区' },
    'ws-plugin': { root: target, title: '插件开发' },
  })
  try {
    await withServer(obs, store, async ({ get, post }) => {
      const configured = await post({ action: 'settings', destinationWorkspaceId: 'ws-plugin' })
      assert.equal(configured.status, 200, JSON.stringify(configured.payload))

      const saved = await saveFeedback(post, { statement: '保存后没有任何提示，不确定是否成功' })
      const queued = await get(`action=record&id=${saved.feedback.id}`)
      assert.equal(queued.payload.feedback.processing.state, 'queued')

      const inbox = await get('action=inbox')
      const item = inbox.payload.items.find((entry) => entry.id === saved.feedback.id)
      assert.equal(item.processing.state, 'queued')

      const processed = await post({ action: 'process', id: saved.feedback.id })
      assert.equal(processed.status, 200, JSON.stringify(processed.payload))
      const result = processed.payload.processed[0]
      assert.equal(result.state, 'draft-ready')
      assert.match(result.proposalId, /^IMP-\d{4}$/)

      const record = await get(`action=record&id=${saved.feedback.id}`)
      assert.equal(record.payload.feedback.processing.state, 'draft-ready')
      assert.equal(record.payload.feedback.processing.proposalId, result.proposalId)

      const proposal = await get(`action=proposal&feedbackId=${saved.feedback.id}`)
      assert.equal(proposal.status, 200, JSON.stringify(proposal.payload))
      assert.equal(proposal.payload.proposal.status, 'awaiting-confirmation')
      assert.equal(proposal.payload.proposal.analysis.kind, 'raw')
      assert.equal(proposal.payload.proposal.analysis.label, '原话候选，尚未分析')
      assert.ok(proposal.payload.proposal.confirmation.required)

      const blocked = await post({ action: 'generate', id: saved.feedback.id, priority: 'P1' })
      assert.equal(blocked.status, 409, JSON.stringify(blocked.payload))
      assert.equal(blocked.payload.error.code, 'proposal-unconfirmed')
      assert.equal(blocked.payload.error.details.proposalStatus, 'awaiting-confirmation')

      const confirmed = await post({ action: 'proposal-confirm', id: saved.feedback.id })
      assert.equal(confirmed.status, 200, JSON.stringify(confirmed.payload))
      assert.equal(confirmed.payload.proposal.status, 'confirmed')
      assert.ok(confirmed.payload.proposal.confirmation.confirmedAt)

      const generated = await post({ action: 'generate', id: saved.feedback.id, priority: 'P2' })
      assert.equal(generated.status, 200, JSON.stringify(generated.payload))
      assert.ok(generated.payload.receipt.requirementId)
    })
  } finally {
    rmSync(obs, { recursive: true, force: true })
    rmSync(target, { recursive: true, force: true })
  }
})

test('save refuses a draft captured in another workspace root', async () => {
  const obs = tempFixture('alm-fb-obs-')
  try {
    const store = workspaceStore({ 'ws-obs': { root: obs, title: '观察工作区' } })
    await withServer(obs, store, async ({ post }) => {
      // The request root is `obs` but the panel was opened against another
      // workspace: silently re-homing the report would attach it to the wrong
      // project, so the conflict has to be visible.
      const { status, payload } = await post({
        action: 'save',
        statement: '在另一个工作区打开的面板',
        context: { observedRoot: 'D:/some/other/workspace', ui: { page: 'list' } },
      })
      assert.equal(status, 409, JSON.stringify(payload))
      assert.equal(payload.error.code, 'workspace-changed')
    })
  } finally {
    rmSync(obs, { recursive: true, force: true })
  }
})

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
