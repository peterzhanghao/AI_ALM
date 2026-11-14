import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
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
    await run({ base, post })
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

test('acceptance-config registers a command registry and then acceptance can run it', async () => {
  const dir = tempFixture('alm-acceptance-config-http-')
  try {
    const plan = join(dir, '.alm/acceptance/REQ-PAY-001.json')
    assert.equal(existsSync(plan), false)
    await withService(dir, async ({ post }) => {
      const missing = await post('acceptance', { requirementId: 'REQ-PAY-001' })
      assert.equal(missing.status, 404)
      assert.equal(missing.payload.error.code, 'no-config')

      const unsafe = await post('acceptance-config', { requirementId: 'REQ-PAY-001', commands: ['node --test'] })
      assert.equal(unsafe.status, 409)
      assert.equal(unsafe.payload.error.code, 'test-scope-required')
      assert.equal(existsSync(plan), false)

      const generic = await post('acceptance-config', { requirementId: 'REQ-PAY-001', commands: ['pnpm test'] })
      assert.equal(generic.status, 409)
      assert.equal(generic.payload.error.code, 'generic-test-command')
      assert.equal(existsSync(plan), false)

      const preview = await post('acceptance-config', {
        requirementId: 'REQ-PAY-001',
        commands: ['node --test test/requirement.test.mjs'],
      })
      assert.equal(preview.status, 200)
      assert.equal(preview.payload.applied, false)
      assert.equal(existsSync(plan), false)
      assert.deepEqual(preview.payload.commands[0].command, ['node', '--test', 'test/requirement.test.mjs'])

      const saved = await post('acceptance-config', { requirementId: 'REQ-PAY-001', commands: ['node -e "process.exit(0)"'], apply: true })
      assert.equal(saved.status, 200)
      assert.equal(saved.payload.applied, true)
      assert.equal(existsSync(plan), true)
      const stored = JSON.parse(readFileSync(plan, 'utf8'))
      assert.equal(stored.schema, 'alm.acceptance.config/v1')
      assert.deepEqual(stored.commands[0].command, ['node', '-e', 'process.exit(0)'])

      const rerunPlan = await post('acceptance', { requirementId: 'REQ-PAY-001' })
      assert.equal(rerunPlan.status, 200)
      assert.equal(rerunPlan.payload.schema, 'alm.acceptance.plan/v1')

      const rejected = await post('acceptance-config', { requirementId: 'REQ-PAY-001', commands: ['bash -lc "npm test"'], apply: true })
      assert.equal(rejected.status, 400)
      assert.equal(rejected.payload.error.code, 'binary-not-allowed')
      assert.deepEqual(JSON.parse(readFileSync(plan, 'utf8')).commands[0].command, ['node', '-e', 'process.exit(0)'])
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('acceptance-config rejects oversized test sets and lifts an insufficient budget', async () => {
  const dir = tempFixture('alm-acceptance-scale-')
  try {
    await withService(dir, async ({ post }) => {
      const files = Array.from({ length: 9 }, (_, index) => `test/case-${index}.test.mjs`)
      const rejected = await post('acceptance-config', {
        requirementId: 'REQ-PAY-001',
        commands: [{ id: 'wide', command: ['node', '--test', ...files], timeoutMs: 30000 }],
        apply: true,
      })
      assert.equal(rejected.status, 409)
      assert.equal(rejected.payload.error.code, 'verification-scale-exceeded')
      assert.equal(existsSync(join(dir, '.alm/acceptance/REQ-PAY-001.json')), false)

      const preview = await post('acceptance-config', {
        requirementId: 'REQ-PAY-001',
        commands: [{ id: 'focused', command: ['node', '--test', ...files.slice(0, 4)], timeoutMs: 1000 }],
      })
      assert.equal(preview.status, 200)
      assert.equal(preview.payload.commands[0].timeoutMs, 75000)
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('acceptance-config returns 404 for an unknown requirement', async () => {
  const dir = tempFixture('alm-acceptance-config-404-')
  try {
    await withService(dir, async ({ post }) => {
      const { status, payload } = await post('acceptance-config', { requirementId: 'REQ-NOPE-999', commands: ['node --test'], apply: true })
      assert.equal(status, 404)
      assert.equal(payload.ok, false)
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
