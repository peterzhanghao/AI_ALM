import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { nextActionFor, requirements, requirementsAll, resolveRequirementsRoot } from '../query.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const fixture = join(repoRoot, 'fixtures/order-refund')

test('nextActionFor follows acceptance, relation and status order', () => {
  const base = { id: 'REQ-X', file: 'requirements/x.sdoc', status: 'proposed', verifiedBy: ['TEST-X'] }
  assert.equal(nextActionFor({ ...base, verifiedBy: [] }, []), 'missing-acceptance')
  assert.equal(nextActionFor(base, [{ assetId: null, file: 'requirements/x.sdoc', rule: 'REL-001' }]), 'dangling-relation')
  assert.equal(nextActionFor(base, []), 'ready-to-change')
  assert.equal(nextActionFor({ ...base, status: 'accepted' }, []), 'ready-to-change')
  assert.equal(nextActionFor({ ...base, status: 'in-progress' }, []), 'in-progress')
  assert.equal(nextActionFor({ ...base, status: 'implemented' }, []), 'verify')
  assert.equal(nextActionFor({ ...base, status: 'verified' }, []), 'done')
})

test('resolveRequirementsRoot accepts a relative fixture path and rejects traversal', () => {
  const resolved = resolveRequirementsRoot('fixtures/order-refund', fixture)
  assert.equal(resolved, fixture)
  assert.throws(() => resolveRequirementsRoot('../etc', fixture), (error) => error.status === 400 && error.code === 'invalid-root')
  assert.throws(() => resolveRequirementsRoot('no/such/dir', fixture), (error) => error.status === 404 && error.code === 'root-not-found')
  assert.equal(resolveRequirementsRoot(undefined, fixture), fixture)
})

test('requirements payload carries file, links and the next action', () => {
  const payload = requirements(fixture)
  assert.equal(payload.schema, 'alm.requirements/v1')
  assert.equal(payload.project, 'PAY')
  assert.equal(payload.projectName, '支付平台')
  const item = payload.requirements.find((entry) => entry.id === 'REQ-PAY-001')
  assert.ok(item, 'REQ-PAY-001 missing from the fixture payload')
  assert.equal(item.file, 'requirements/refund.sdoc')
  assert.ok(item.line >= 1)
  assert.deepEqual(item.verifiedBy, ['TEST-PAY-001'])
  assert.ok(item.links.some((link) => link.type === 'verified_by' && link.target === 'TEST-PAY-001'))
  assert.equal(item.nextAction, 'ready-to-change')
  assert.equal(item.nextActionLabel, '发起变更')
})

test('requirements payload carries project, brief text and attachment detail', () => {
  const payload = requirements(fixture)
  const item = payload.requirements.find((entry) => entry.id === 'REQ-PAY-004')
  assert.ok(item)
  assert.equal(item.project, 'PAY')
  assert.equal(item.projectName, '支付平台')
  assert.match(item.briefText, /幂等/)
  assert.equal(item.attachments, 1)
  assert.deepEqual(item.attachmentFiles, [{ name: 'chat-2026-10-29.md', kind: 'chat' }])
  assert.deepEqual(payload.projectInfo, {
    id: 'PAY',
    name: '支付平台',
    repo: 'peterzhanghao/AI_ALM',
    board: 1,
    status: { ready: 'Ready' },
  })
  assert.equal(item.github, null)
})

test('github mapping projects the issue, labels, board and parented task issues', () => {
  const dir = mkdtempSync(join(tmpdir(), 'alm-gh-'))
  try {
    cpSync(fixture, dir, { recursive: true })
    writeFileSync(
      join(dir, '.alm/github.json'),
      JSON.stringify(
        {
          schema: 'alm.github/v1',
          repo: 'peterzhanghao/AI_ALM',
          requirements: {
            'REQ-PAY-004': {
              provider: 'github',
              number: 104,
              url: 'https://github.com/peterzhanghao/AI_ALM/issues/104',
            },
          },
          tasks: {
            'TASK-001': { provider: 'github', number: 105, url: 'https://github.com/peterzhanghao/AI_ALM/issues/105', parent: 104 },
            'TASK-002': { provider: 'github', number: 106, url: 'https://github.com/peterzhanghao/AI_ALM/issues/106', parent: 999 },
          },
        },
        null,
        2,
      ),
    )
    const payload = requirements(dir)
    const item = payload.requirements.find((entry) => entry.id === 'REQ-PAY-004')
    assert.equal(item.github.issue, 104)
    assert.equal(item.github.repo, 'peterzhanghao/AI_ALM')
    assert.deepEqual(item.github.labels, ['type::requirement', 'project::pay', 'priority::P1'])
    assert.deepEqual(item.github.board, { number: 1, status: 'Ready' })
    assert.deepEqual(item.github.tasks.map((task) => task.number), [105])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('requirementsAll merges project roots and tags each requirement', () => {
  const payload = requirementsAll([{ id: 'PAY', name: '支付平台', root: fixture }])
  assert.equal(payload.scope, 'all')
  assert.equal(payload.result, 'pass')
  assert.equal(payload.summary.projects, 1)
  assert.ok(payload.requirements.length >= 2)
  assert.ok(payload.requirements.every((entry) => entry.project === 'PAY'))
  assert.equal(payload.projects[0].project, 'PAY')
  assert.ok(payload.projects[0].requirements >= 1)
})

test('requirementsAll reports a broken project without dropping the others', () => {
  const payload = requirementsAll([
    { id: 'PAY', name: '支付平台', root: fixture },
    { id: 'CRM', name: '客户 CRM', root: join(fixture, 'no-such-root') },
  ])
  assert.equal(payload.result, 'fail')
  assert.equal(payload.summary.failed, 1)
  assert.ok(payload.requirements.length >= 2)
  assert.ok(payload.projects.some((project) => project.project === 'CRM' && project.error))
})
