import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCandidate, candidateStatus, worktreeSnapshot } from '../../src/requirements/candidate.mjs'

test('parallel processes cannot allocate duplicate candidates or overwrite records', async (t) => {
  const { root, asset } = fixture(t)
  const url = new URL('../../src/requirements/candidate.mjs', import.meta.url).href
  const code = `import {createCandidate} from ${JSON.stringify(url)}; try { console.log(JSON.stringify(createCandidate(${JSON.stringify({ root, asset })}))) } catch(e) { if(e.code !== 'candidate-busy') throw e; console.log('busy') }`
  const execute = promisify(execFile)
  const results = await Promise.all(Array.from({ length: 4 }, () => execute(process.execPath, ['--input-type=module', '-e', code])))
  const candidates = results.map((r) => r.stdout.trim()).filter((r) => r !== 'busy').map(JSON.parse)
  assert.ok(candidates.length > 0)
  assert.equal(new Set(candidates.map((c) => c.id)).size, 1)
  assert.equal(readdirSync(join(root, '.alm/candidates/REQ-X')).filter((name) => name.endsWith('.json')).length, 1)
  assert.equal(createCandidate({ root, asset }).id, candidates[0].id)
})

test('leading tracked modification retains porcelain status whitespace and the full path', (t) => {
  const { root } = fixture(t)
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src/value.cjs'), 'module.exports=1')
  execFileSync('git', ['add', '.'], { cwd: root })
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'base'], { cwd: root })
  writeFileSync(join(root, 'src/value.cjs'), 'module.exports=2')
  const first = worktreeSnapshot(root)
  assert.equal(first.files[0].path, 'src/value.cjs')
  assert.notEqual(first.files[0].hash, 'deleted')
  writeFileSync(join(root, 'src/value.cjs'), 'module.exports=3')
  const second = worktreeSnapshot(root)
  assert.notEqual(second.treeHash, first.treeHash)
})

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'alm-candidate-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  execFileSync('git', ['init', '-q', root])
  writeFileSync(join(root, 'requirement.sdoc'), 'business requirement')
  const asset = { id: 'REQ-X', file: 'requirement.sdoc', extra: { revision: 1 } }
  return { root, asset }
}

test('candidate creation is idempotent but new content, revision and evidence get immutable new ids', (t) => {
  const { root, asset } = fixture(t)
  const first = createCandidate({ root, asset })
  const file = join(root, '.alm/candidates/REQ-X', `${first.id}.json`)
  const bytes = readFileSync(file, 'utf8')
  assert.equal(createCandidate({ root, asset, actor: 'someone-else', source: 'retry' }).id, first.id)
  writeFileSync(join(root, 'new-file.txt'), 'new content')
  assert.equal(candidateStatus({ root, asset, candidate: first }).current, false)
  const second = createCandidate({ root, asset })
  assert.notEqual(second.id, first.id)
  const revised = { ...asset, extra: { revision: 2 } }
  assert.equal(candidateStatus({ root, asset: revised, candidate: second }).current, false)
  const third = createCandidate({ root, asset: revised })
  assert.notEqual(third.id, second.id)
  mkdirSync(join(root, '.alm/acceptance'), { recursive: true })
  writeFileSync(join(root, '.alm/acceptance/result.json'), '{"result":"pass"}')
  const acceptance = { latest: { file: '.alm/acceptance/result.json', result: 'pass' } }
  const fourth = createCandidate({ root, asset: revised, acceptance })
  assert.notEqual(fourth.id, third.id)
  assert.equal(createCandidate({ root, asset: revised, acceptance }).id, fourth.id)
  const absolute = createCandidate({ root, asset: revised, acceptance: { latest: { ...acceptance.latest, file: join(root, acceptance.latest.file) } } })
  assert.equal(absolute.acceptance.hash, fourth.acceptance.hash)
  assert.match(absolute.acceptance.hash, /^[a-f0-9]{64}$/)
  writeFileSync(join(root, '.alm/acceptance/result.json'), '{"result":"pass","new":true}')
  assert.notEqual(createCandidate({ root, asset: revised, acceptance }).id, fourth.id)
  assert.equal(readFileSync(file, 'utf8'), bytes)
})

test('candidate lock rejects a concurrent creator without reclaiming its lock and cleans up failures', (t) => {
  const { root, asset } = fixture(t)
  const dir = join(root, '.alm/candidates/REQ-X')
  const lock = join(dir, '.create-lock')
  mkdirSync(lock, { recursive: true })
  assert.throws(() => createCandidate({ root, asset }), { code: 'candidate-busy', status: 409 })
  assert.equal(existsSync(lock), true)
  rmSync(lock, { recursive: true })
  // Serialization failure must release this call's lock via finally.
  assert.throws(() => createCandidate({ root, asset, actor: 1n }))
  assert.equal(existsSync(lock), false)
  createCandidate({ root, asset })
  assert.equal(readdirSync(dir).filter((name) => name.endsWith('.json')).length, 1)
})
