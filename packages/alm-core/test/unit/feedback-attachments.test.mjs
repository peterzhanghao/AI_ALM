import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ATTACHMENT_LIMITS, ATTACHMENT_SCHEMA, readAttachment, saveAttachment } from '../../src/feedback/attachments.mjs'

const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function tempRoot() {
  return mkdtempSync(join(tmpdir(), 'alm-fb-att-'))
}

test('saveAttachment writes the bytes content-addressed and returns a small durable reference', () => {
  const root = tempRoot()
  try {
    const ref = saveAttachment({ root, name: '截图.png', type: 'image/png', dataBase64: PNG_1X1 })
    assert.equal(ref.schema, ATTACHMENT_SCHEMA)
    assert.equal(ref.name, '截图.png')
    assert.equal(ref.type, 'image/png')
    assert.match(ref.sha256, /^[0-9a-f]{64}$/)
    assert.equal(ref.path, `.alm/feedback/attachments/${ref.sha256}.png`)
    assert.equal(ref.size, statSync(join(root, '.alm', 'feedback', 'attachments', `${ref.sha256}.png`)).size)
    assert.equal('dataBase64' in ref, false, 'the reference never carries the payload')

    const again = saveAttachment({ root, name: 'same.png', type: 'image/png', dataBase64: PNG_1X1 })
    assert.equal(again.sha256, ref.sha256, 'identical bytes are stored once')
    assert.equal(readAttachment({ root, sha256: ref.sha256 })?.file, join(root, '.alm', 'feedback', 'attachments', `${ref.sha256}.png`))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('saveAttachment accepts explicit data URLs and rejects unsupported types and oversized payloads', () => {
  const root = tempRoot()
  try {
    const ref = saveAttachment({ root, name: 'log.txt', type: 'text/plain', dataBase64: `data:text/plain;base64,${Buffer.from('hello').toString('base64')}` })
    assert.equal(ref.size, 5)
    assert.ok(existsSync(join(root, ref.path)))

    assert.throws(
      () => saveAttachment({ root, name: 'evil.exe', type: 'application/x-msdownload', dataBase64: PNG_1X1 }),
      (error) => error.code === 'attachment-type' && error.status === 400,
    )
    assert.throws(
      () => saveAttachment({ root, name: 'empty.png', type: 'image/png', dataBase64: '' }),
      (error) => error.code === 'attachment-invalid',
    )
    const oversized = Buffer.alloc(ATTACHMENT_LIMITS.bytes + 1, 1).toString('base64')
    assert.throws(
      () => saveAttachment({ root, name: 'big.png', type: 'image/png', dataBase64: oversized }),
      (error) => error.code === 'attachment-too-large' && error.status === 413,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
