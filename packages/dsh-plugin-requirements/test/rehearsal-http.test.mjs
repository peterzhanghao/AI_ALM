import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import RequirementsService from '../index.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const fixture = join(repoRoot, 'fixtures/order-refund')

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

async function withRehearsalServer(root, run) {
  const routes = new Map()
  const ctx = {
    effect(callback) {
      callback()
    },
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
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const base = `http://127.0.0.1:${server.address().port}`
    const post = async (body) => {
      const response = await fetch(`${base}/api/alm/requirements/rehearsal?root=${encodeURIComponent(root)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      return { status: response.status, payload: await response.json() }
    }
    await run({ base, post })
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

const TITLE_CHANGE = { field: 'title', value: '支持订单部分退款（试演）' }

test('rehearsal previews by default and never writes', async () => {
  const dir = tempFixture('alm-rehearsal-preview-')
  try {
    const file = join(dir, 'requirements/refund.sdoc')
    const before = readFileSync(file, 'utf8')
    await withRehearsalServer(dir, async ({ post }) => {
      const { status, payload } = await post({ requirementId: 'REQ-PAY-001', change: TITLE_CHANGE })
      assert.equal(status, 200)
      assert.equal(payload.schema, 'alm.rehearsal/v1')
      assert.equal(payload.applied, false)
      assert.deepEqual(payload.writes, [])
      assert.equal(payload.requirement, 'REQ-PAY-001')
      assert.equal(payload.requirementBefore.revision, 1)
      assert.equal(payload.requirementAfter.revision, 2)
      assert.equal(payload.change.field, 'title')
      assert.equal(payload.change.after, TITLE_CHANGE.value)
      assert.equal(payload.impact.advisory, true)
      assert.ok(payload.baseline.contentHash)
      assert.ok(payload.baseline.relationHash)
      assert.equal(!existsSync(join(dir, '.alm/audit')), true)
    })
    assert.equal(readFileSync(file, 'utf8'), before)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('rehearsal apply writes the sdoc revision + audit with a matching baseline', async () => {
  const dir = tempFixture('alm-rehearsal-apply-')
  try {
    const file = join(dir, 'requirements/refund.sdoc')
    await withRehearsalServer(dir, async ({ post }) => {
      const preview = await post({ requirementId: 'REQ-PAY-001', change: TITLE_CHANGE })
      assert.equal(preview.status, 200)
      const { status, payload } = await post({
        requirementId: 'REQ-PAY-001',
        change: TITLE_CHANGE,
        apply: true,
        expectedBaseline: preview.payload.baseline,
        actor: 'human:tester',
        idempotencyKey: 'key-apply-1',
      })
      assert.equal(status, 200)
      assert.equal(payload.applied, true)
      assert.equal(payload.revision, 2)
      assert.equal(payload.file, 'requirements/refund.sdoc')
      assert.equal(payload.signoffInvalidated, true)
      assert.equal(payload.evidenceStale, true)
      assert.ok(payload.auditFile)
      assert.ok(existsSync(join(dir, payload.auditFile)))
      assert.ok(payload.impact)
      const audit = JSON.parse(readFileSync(join(dir, payload.auditFile), 'utf8'))
      assert.equal(audit.schema, 'alm.audit/v1')
      assert.equal(audit.requirement, 'REQ-PAY-001')
      assert.equal(audit.actor, 'human:tester')
    })
    const text = readFileSync(file, 'utf8')
    assert.match(text, /TITLE: 支持订单部分退款（试演）/)
    assert.match(text, /REVISION: 2/)
    assert.match(text, /Type: verified_by\nValue: TEST-PAY-001/, 'other fields and relations must be preserved')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('rehearsal apply rejects a stale baseline with 409 and keeps the draft unapplied', async () => {
  const dir = tempFixture('alm-rehearsal-stale-')
  try {
    const file = join(dir, 'requirements/refund.sdoc')
    await withRehearsalServer(dir, async ({ post }) => {
      const preview = await post({ requirementId: 'REQ-PAY-001', change: TITLE_CHANGE })
      assert.equal(preview.status, 200)
      // Someone else edits the requirement after the preview was computed.
      writeFileSync(file, readFileSync(file, 'utf8').replace('TITLE: 支持订单部分退款', 'TITLE: 被他人修改的标题'))
      const { status, payload } = await post({
        requirementId: 'REQ-PAY-001',
        change: TITLE_CHANGE,
        apply: true,
        expectedBaseline: preview.payload.baseline,
        actor: 'human:tester',
      })
      assert.equal(status, 409)
      assert.equal(payload.ok, false)
      assert.equal(payload.error.code, 'stale-preview')
    })
    assert.match(readFileSync(file, 'utf8'), /TITLE: 被他人修改的标题/)
    assert.doesNotMatch(readFileSync(file, 'utf8'), /试演/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('rehearsal apply replays the same idempotency key without writing again', async () => {
  const dir = tempFixture('alm-rehearsal-idem-')
  try {
    const file = join(dir, 'requirements/refund.sdoc')
    await withRehearsalServer(dir, async ({ post }) => {
      const preview = await post({ requirementId: 'REQ-PAY-001', change: TITLE_CHANGE })
      const first = await post({
        requirementId: 'REQ-PAY-001',
        change: TITLE_CHANGE,
        apply: true,
        expectedBaseline: preview.payload.baseline,
        actor: 'human:tester',
        idempotencyKey: 'key-idem-1',
      })
      assert.equal(first.status, 200)
      assert.equal(first.payload.applied, true)
      assert.equal(first.payload.idempotent, false)

      // A replay uses the current asset but must return the first result.
      const second = await post({
        requirementId: 'REQ-PAY-001',
        change: TITLE_CHANGE,
        apply: true,
        expectedBaseline: preview.payload.baseline,
        actor: 'human:tester',
        idempotencyKey: 'key-idem-1',
      })
      assert.equal(second.status, 200)
      assert.equal(second.payload.applied, true)
      assert.equal(second.payload.idempotent, true)
      assert.equal(second.payload.revision, first.payload.revision)
    })
    const auditFiles = readdirSync(join(dir, '.alm/audit/requirements')).filter((name) => name.endsWith('.json'))
    assert.equal(auditFiles.length, 1, 'idempotent replay must not write a second audit event')
    assert.match(readFileSync(file, 'utf8'), /REVISION: 2/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('rehearsal rejects apply without baseline/actor and invalid changes with 400', async () => {
  const dir = tempFixture('alm-rehearsal-errors-')
  try {
    await withRehearsalServer(dir, async ({ post }) => {
      const preview = await post({ requirementId: 'REQ-PAY-001', change: TITLE_CHANGE })
      const missingBaseline = await post({
        requirementId: 'REQ-PAY-001',
        change: TITLE_CHANGE,
        apply: true,
        actor: 'human:tester',
      })
      assert.equal(missingBaseline.status, 400)
      assert.equal(missingBaseline.payload.error.code, 'baseline-required')

      const missingActor = await post({
        requirementId: 'REQ-PAY-001',
        change: TITLE_CHANGE,
        apply: true,
        expectedBaseline: preview.payload.baseline,
      })
      assert.equal(missingActor.status, 400)
      assert.equal(missingActor.payload.error.code, 'actor-required')

      const invalidField = await post({ requirementId: 'REQ-PAY-001', change: { field: 'status', value: 'verified' } })
      assert.equal(invalidField.status, 400)
      assert.equal(invalidField.payload.error.code, 'invalid-change')

      const invalidTitle = await post({ requirementId: 'REQ-PAY-001', change: { field: 'title', value: 'a\nb' } })
      assert.equal(invalidTitle.status, 400)
      assert.equal(invalidTitle.payload.error.code, 'invalid-title')

      const unknown = await post({ requirementId: 'REQ-NOPE-001', change: TITLE_CHANGE })
      assert.equal(unknown.status, 404)
      assert.equal(unknown.payload.error.code, 'requirement-not-found')
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('rehearsal route only accepts POST', async () => {
  const dir = tempFixture('alm-rehearsal-method-')
  try {
    await withRehearsalServer(dir, async ({ base }) => {
      const response = await fetch(`${base}/api/alm/requirements/rehearsal`)
      assert.equal(response.status, 405)
      assert.equal((await response.json()).error.code, 'method-not-allowed')
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
