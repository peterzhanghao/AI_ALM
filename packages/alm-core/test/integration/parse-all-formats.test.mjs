import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { run } from '../../src/cli.mjs'

const FILES = {
  'requirements/refund.sdoc': `[DOCUMENT]
TITLE: Order refund

[REQUIREMENT]
UID: REQ-PAY-001
TITLE: 支持部分退款
STATUS: proposed
OWNER: team-payments

[RELATION]
Type: allocated_to
Value: MOD-PAY-REFUND

[RELATION]
Type: constrained_by
Value: ADR-PAY-003

[RELATION]
Type: verified_by
Value: TEST-PAY-001

[REQUIREMENT]
UID: TEST-PAY-001
TITLE: 部分退款验收
STATUS: proposed
OWNER: team-qa
`,
  'adr/ADR-PAY-003.md': `---
schema_version: 1
id: ADR-PAY-003
type: architecture-decision
title: 退款与订单状态一致性
status: accepted
owner: team-arch
links: []
---

# Context

退款必须与订单状态在同一事务边界内完成。
`,
  'architecture/MOD-PAY-REFUND.yml': `schema_version: 1
id: MOD-PAY-REFUND
type: module
title: 退款模块
status: accepted
owner: team-payments
links:
  - type: constrained_by
    target: ADR-PAY-003
`,
  'architecture/DM-PAY-REFUND.yml': `schema_version: 1
id: DM-PAY-REFUND
type: data-model
title: 退款单
status: proposed
owner: team-payments
links:
  - type: constrained_by
    target: ADR-PAY-003
`,
  'architecture/refund-api.yml': `openapi: 3.0.3
info:
  title: Refund API
  version: 1.0.0
  x-alm-id: IF-PAY-REFUND-API
  x-alm-owner: team-payments
  x-alm-status: proposed
  x-alm-links:
    - type: constrained_by
      target: ADR-PAY-003
paths:
  /refunds:
    post:
      operationId: createRefund
`,
  'risks/RISK-PAY-001.yml': `schema_version: 1
id: RISK-PAY-001
type: risk
title: 并发退款导致重复扣款
status: proposed
owner: team-payments
links:
  - type: constrained_by
    target: ADR-PAY-003
`,
}

function sandbox(files) {
  const root = mkdtempSync(join(tmpdir(), 'alm-formats-'))
  for (const [name, content] of Object.entries(files)) {
    const path = join(root, name)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content, 'utf8')
  }
  return root
}

function capture() {
  const chunks = []
  return {
    write(chunk) {
      chunks.push(String(chunk))
    },
    get text() {
      return chunks.join('')
    },
  }
}

async function invoke(argv) {
  const out = capture()
  const err = capture()
  const code = await run(argv, { out, err })
  return { code, out: out.text, err: err.text }
}

test('parses all seven asset types across four formats', async () => {
  const root = sandbox(FILES)
  try {
    const { code, out } = await invoke(['index', '--root', root, '--json'])
    assert.equal(code, 0)
    const payload = JSON.parse(out)
    assert.equal(payload.assets.length, 7)
    assert.deepEqual(
      [...new Set(payload.assets.map((asset) => asset.source.format))].sort(),
      ['markdown', 'openapi', 'sdoc', 'yaml'],
    )
    assert.deepEqual(
      [...new Set(payload.assets.map((asset) => asset.type))].sort(),
      [
        'acceptance-test',
        'architecture-decision',
        'data-model',
        'interface',
        'module',
        'requirement',
        'risk',
      ],
    )
    const { code: checkCode, out: checkOut } = await invoke(['check', '--root', root, '--json'])
    assert.equal(checkCode, 0)
    assert.equal(JSON.parse(checkOut).result, 'pass')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a Markdown asset without frontmatter fails with FMT-001', async () => {
  const root = sandbox({ ...FILES, 'adr/ADR-PAY-004.md': '# no frontmatter\n' })
  try {
    const { code, out } = await invoke(['index', '--root', root, '--json'])
    assert.equal(code, 1)
    const payload = JSON.parse(out)
    assert.equal(payload.errors[0].rule, 'FMT-001')
    assert.equal(payload.errors[0].file, 'adr/ADR-PAY-004.md')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('README.md is treated as documentation, not an asset', async () => {
  const root = sandbox({ ...FILES, 'README.md': '# Sample repo\n' })
  try {
    const { code, out } = await invoke(['index', '--root', root, '--json'])
    assert.equal(code, 0)
    assert.equal(JSON.parse(out).assets.length, 7)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
