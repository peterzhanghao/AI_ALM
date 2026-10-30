import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { nextActionFor, requirements, resolveRequirementsRoot } from '../query.mjs'

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
