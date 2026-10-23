import test from 'node:test'
import assert from 'node:assert/strict'
import { AssetError } from '../../../src/model/asset.mjs'
import { parseSdocAsset } from '../../../src/parse/sdoc.mjs'

const SDOC = `[DOCUMENT]
TITLE: Order refund

[SECTION]
TITLE: Requirements

[REQUIREMENT]
UID: REQ-PAY-001
TITLE: 支持部分退款
STATUS: proposed
OWNER: team-payments

[RELATION]
Type: allocated_to
Value: MOD-PAY-001

[RELATION]
Type: verified_by
Value: TEST-PAY-001

[REQUIREMENT]
UID: TEST-PAY-001
TITLE: 部分退款验收
STATUS: proposed
OWNER: team-qa
`

test('parses requirements, types and relations from the SDoc subset', () => {
  const assets = parseSdocAsset(SDOC, 'requirements/refund.sdoc')
  assert.equal(assets.length, 2)
  assert.equal(assets[0].type, 'requirement')
  assert.equal(assets[0].source.format, 'sdoc')
  assert.deepEqual(
    assets[0].links.map((link) => `${link.type}:${link.target}`),
    ['allocated_to:MOD-PAY-001', 'verified_by:TEST-PAY-001'],
  )
  assert.equal(assets[1].type, 'acceptance-test')
})

test('missing UID fails with FMT-001 at the requirement line', () => {
  const text = `[REQUIREMENT]
TITLE: no id
STATUS: proposed
OWNER: team
`
  assert.throws(() => parseSdocAsset(text, 'bad.sdoc'), (error) => {
    assert.ok(error instanceof AssetError)
    assert.equal(error.rule, 'FMT-001')
    assert.equal(error.line, 1)
    assert.match(error.message, /UID/)
    return true
  })
})

test('unknown relation type fails with FMT-001', () => {
  const text = `[REQUIREMENT]
UID: REQ-PAY-001
TITLE: x
STATUS: proposed
OWNER: team

[RELATION]
Type: relates_to
Value: MOD-PAY-001
`
  assert.throws(() => parseSdocAsset(text, 'bad.sdoc'), (error) => {
    assert.equal(error.rule, 'FMT-001')
    assert.match(error.message, /unknown link type/)
    return true
  })
})

test('unsupported node fails instead of being skipped', () => {
  const text = `[REQUIREMENT]
UID: REQ-PAY-001
TITLE: x
STATUS: proposed
OWNER: team

[TABLE]
`
  assert.throws(() => parseSdocAsset(text, 'bad.sdoc'), /unsupported SDoc node/)
})
