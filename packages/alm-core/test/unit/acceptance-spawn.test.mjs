import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { resolveSpawn, runAcceptance, runAcceptanceAdaptive, shellCommandLine } from '../../src/acceptance/acceptance.mjs'

const dirs = []
function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'alm-acceptance-spawn-'))
  dirs.push(root)
  execFileSync('git', ['init', '-q'], { cwd: root })
  writeFileSync(join(root, 'README.md'), '# demo\n')
  execFileSync('git', ['add', '-A'], { cwd: root })
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'init'], { cwd: root })
  return root
}
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

const BIN = String.raw`C:\bin`
const NODE = String.raw`C:\node`
const pnpmCmd = (dir) => dir + String.raw`\pnpm.cmd`
const nodeExe = (dir) => dir + String.raw`\node.EXE`

test('posix leaves the command untouched (no shell)', () => {
  const spawn = resolveSpawn('pnpm', { platform: 'linux', env: { PATH: '/usr/bin' } })
  assert.deepEqual(spawn, { file: 'pnpm', shell: false, resolved: false })
})

test('win32 resolves a .cmd shim on PATH and marks it shell-bound', () => {
  const seen = []
  const spawn = resolveSpawn('pnpm', {
    platform: 'win32',
    env: { PATH: BIN, PATHEXT: '.EXE;.CMD' },
    exists: (candidate) => {
      seen.push(candidate)
      return candidate.toLowerCase() === pnpmCmd(BIN).toLowerCase()
    },
  })
  assert.equal(String(spawn.file).toLowerCase(), pnpmCmd(BIN).toLowerCase())
  assert.equal(spawn.shell, true)
  assert.equal(spawn.resolved, true)
  assert.ok(seen.includes(BIN + String.raw`\pnpm.EXE`), 'the first attempt prefers .exe')
})

test('win32 prefers a plain executable over a shim', () => {
  const spawn = resolveSpawn('node', {
    platform: 'win32',
    env: { PATH: NODE, PATHEXT: '.EXE;.CMD' },
    exists: () => true,
  })
  assert.equal(String(spawn.file).toLowerCase(), nodeExe(NODE).toLowerCase())
  assert.equal(spawn.shell, false)
})

test('win32 falls back to the node directory when PATH has no shim', () => {
  const spawn = resolveSpawn('pnpm', {
    platform: 'win32',
    env: { PATH: String.raw`C:\empty`, PATHEXT: '.CMD' },
    exists: (candidate) => candidate.toLowerCase() === pnpmCmd(NODE).toLowerCase(),
    nodeDir: NODE,
  })
  assert.equal(String(spawn.file).toLowerCase(), pnpmCmd(NODE).toLowerCase())
  assert.equal(spawn.shell, true)
})

test('win32 reports an unresolved command instead of inventing a path', () => {
  const spawn = resolveSpawn('pnpm', {
    platform: 'win32',
    env: { PATH: String.raw`C:\empty`, PATHEXT: '.EXE;.CMD' },
    exists: () => false,
    nodeDir: NODE,
  })
  assert.deepEqual(spawn, { file: 'pnpm', shell: false, resolved: false })
})

test('an absolute .cmd path is shell-bound and an .exe is not', () => {
  assert.equal(resolveSpawn(pnpmCmd(BIN), { platform: 'win32' }).shell, true)
  assert.equal(resolveSpawn(nodeExe(BIN), { platform: 'win32' }).shell, false)
})

test('shellCommandLine quotes arguments instead of pasting them raw', () => {
  const file = String.raw`C:\Program Files\pnpm\pnpm.cmd`
  const line = shellCommandLine(file, ['test', 'a b', 'x"y', 'plain'])
  assert.ok(line.startsWith('"' + file + '" test '), line)
  assert.ok(line.includes('"a b"'), line)
  assert.ok(line.includes('"x\\"y"'), line)
  assert.ok(line.endsWith(' plain'), line)
})


test('runAcceptance spawns a resolved executable without a shell for plain node', () => {
  const root = makeRepo()
  mkdirSync(join(root, '.alm', 'acceptance'), { recursive: true })
  writeFileSync(
    join(root, '.alm', 'acceptance', 'REQ-X-001.json'),
    JSON.stringify({
      schema: 'alm.acceptance.config/v1',
      requirement: 'REQ-X-001',
      commands: [{ id: 'smoke', command: ['node', '-e', 'process.exit(0)'] }],
    }),
  )
  const calls = []
  const result = runAcceptance({
    root,
    requirementId: 'REQ-X-001',
    apply: true,
    exec: (file, args, options) => {
      calls.push({ file, args, options })
      return { status: 0, stdout: '', stderr: '' }
    },
  })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].options.shell, undefined, 'plain executables must not go through a shell')
  const expected = process.platform === 'win32' ? /node\.exe$/i : /node$/
  assert.match(String(calls[0].file), expected)
  assert.deepEqual(calls[0].args, ['-e', 'process.exit(0)'])
  assert.equal(result.result, 'pass')
})

test('spawn EPERM falls back to Node test runner in the current process', async () => {
  const root = makeRepo()
  mkdirSync(join(root, 'test'), { recursive: true })
  mkdirSync(join(root, '.alm', 'acceptance'), { recursive: true })
  writeFileSync(join(root, 'test', 'direct.test.mjs'), "import test from 'node:test'\nimport assert from 'node:assert/strict'\ntest('direct assertion', () => assert.equal(21 * 2, 42))\n")
  writeFileSync(
    join(root, '.alm', 'acceptance', 'REQ-X-002.json'),
    JSON.stringify({
      schema: 'alm.acceptance.config/v1',
      requirement: 'REQ-X-002',
      commands: [{ id: 'direct', command: ['node', '--test', '--test-name-pattern', 'direct assertion', 'test/direct.test.mjs'], timeoutMs: 5_000 }],
    }),
  )
  // The programmatic `node:test` runner cannot be nested in this outer test
  // harness. A normal Node process matches the DSH host shape; inside it the
  // acceptance executor is still forced to receive EPERM.
  const acceptanceUrl = new URL('../../src/acceptance/acceptance.mjs', import.meta.url).href
  const script = [
    `import { acceptanceSummary, runAcceptanceAdaptive } from ${JSON.stringify(acceptanceUrl)}`,
    `import { candidateStatus, createCandidate } from ${JSON.stringify(new URL('../../src/requirements/candidate.mjs', import.meta.url).href)}`,
    "const asset = { id: 'REQ-X-002', type: 'requirement', title: 'Direct fallback', status: 'proposed', owner: 'test', links: [], extra: { revision: 1 } }",
    "const context = { asset, assets: [asset], actor: 'human:test' }",
    `const result = await runAcceptanceAdaptive({ root: process.cwd(), requirementId: 'REQ-X-002', apply: true, context, exec: () => ({ error: Object.assign(new Error('spawn EPERM'), { code: 'EPERM' }) }) })`,
    "const candidate = createCandidate({ root: process.cwd(), asset, acceptance: acceptanceSummary(process.cwd(), asset.id, result.headSha, context) })",
    "console.log(JSON.stringify({ result: result.result, command: result.evidence.commands[0], candidate: { id: candidate.id, current: candidateStatus({ root: process.cwd(), asset, assets: context.assets, candidate }).current } }))",
  ].join(';')
  writeFileSync(join(root, 'fallback-runner.mjs'), script)
  const payload = JSON.parse(execFileSync(process.execPath, ['fallback-runner.mjs'], { cwd: root, encoding: 'utf8' }))
  const command = payload.command
  assert.equal(payload.result, 'pass', JSON.stringify(payload))
  assert.equal(command.exitCode, 0)
  assert.equal(command.spawnFailed, false)
  assert.equal(command.execution?.mode, 'in-process-esm-runner')
  assert.match(command.stdout, /direct assertion/)
  assert.match(payload.candidate.id, /^CAND-REQ-X-002-001$/)
  assert.equal(payload.candidate.current, true)
})
