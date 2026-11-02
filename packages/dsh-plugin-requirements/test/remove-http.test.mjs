import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import RequirementsService from '../index.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const fixture = join(repoRoot, 'fixtures/order-refund')

function tempFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'alm-remove-http-'))
  cpSync(fixture, dir, { recursive: true })
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['add', '-A'], { cwd: dir })
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'init'], { cwd: dir })
  return dir
}

async function withService(root, run) {
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
    const post = async (path, body) => {
      const response = await fetch(`${base}/api/alm/requirements/${path}?root=${encodeURIComponent(root)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      return { status: response.status, payload: await response.json() }
    }
    await run({ post })
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

test('remove previews then deletes the record with an audit copy', async () => {
  const dir = tempFixture()
  try {
    await withService(dir, async ({ post }) => {
      const preview = await post('remove', { requirementId: 'REQ-PAY-004', file: 'requirements/refund-idempotent.sdoc' })
      assert.equal(preview.status, 200)
      assert.equal(preview.payload.schema, 'alm.requirement.remove/v1')
      assert.equal(preview.payload.applied, false)
      assert.equal(preview.payload.mode, 'file')
      assert.ok(preview.payload.baseline?.contentHash)
      assert.ok(existsSync(join(dir, 'requirements/refund-idempotent.sdoc')), 'preview must not delete')

      const applied = await post('remove', {
        requirementId: 'REQ-PAY-004',
        file: 'requirements/refund-idempotent.sdoc',
        apply: true,
        expectedBaseline: preview.payload.baseline,
        actor: 'human:local',
        reason: 'test cleanup',
      })
      assert.equal(applied.status, 200)
      assert.equal(applied.payload.applied, true)
      assert.equal(existsSync(join(dir, 'requirements/refund-idempotent.sdoc')), false)
      const audits = readdirSync(join(dir, '.alm/audit/requirements'))
      assert.equal(audits.length, 1)
      const audit = JSON.parse(readFileSync(join(dir, '.alm/audit/requirements', audits[0]), 'utf8'))
      assert.equal(audit.kind, 'remove')
      assert.match(audit.before.content, /REQ-PAY-004/)
      assert.equal(applied.payload.auditFile, `.alm/audit/requirements/${audits[0]}`)
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('remove refuses a stale baseline and keeps the file', async () => {
  const dir = tempFixture()
  try {
    await withService(dir, async ({ post }) => {
      const stale = await post('remove', {
        requirementId: 'REQ-PAY-004',
        file: 'requirements/refund-idempotent.sdoc',
        apply: true,
        expectedBaseline: { contentHash: 'stale', relationHash: 'stale' },
        actor: 'human:local',
      })
      assert.equal(stale.status, 409)
      assert.equal(stale.payload.error.code, 'stale-preview')
      assert.ok(existsSync(join(dir, 'requirements/refund-idempotent.sdoc')))
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('remove returns 404 for an unknown requirement', async () => {
  const dir = tempFixture()
  try {
    await withService(dir, async ({ post }) => {
      const missing = await post('remove', { requirementId: 'REQ-NOPE-999' })
      assert.equal(missing.status, 404)
      assert.equal(missing.payload.ok, false)
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
