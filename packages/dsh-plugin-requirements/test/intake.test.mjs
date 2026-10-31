import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { extractChat, extractOcr } from '../intake.mjs'

const dirs = []

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'alm-intake-'))
  dirs.push(dir)
  return dir
}

test.after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

const CHAT = `10:12 张三：退款要幂等
10:13 李四：同一订单同一幂等键只退一次
10:14 张三：并发也要只退一次`

test('extractChat parses messages with chat.md line citations', () => {
  const result = extractChat({ markdown: CHAT })
  assert.equal(result.schema, 'alm.intake.chat/v1')
  assert.equal(result.messages.length, 3)
  assert.equal(result.messages[0].speaker, '张三')
  assert.equal(result.messages[0].time, '10:12')
  assert.equal(result.messages[0].ref, 'chat.md#L1')
  assert.deepEqual(result.citations.map((entry) => entry.ref), ['chat.md#L1', 'chat.md#L2', 'chat.md#L3'])
  assert.match(result.text, /并发也要只退一次/)
})

test('extractChat rejects empty input', () => {
  assert.throws(() => extractChat({ markdown: '   ' }), (error) => error.code === 'chat-empty')
})

test('extractOcr normalizes engine output and image line references', () => {
  const dir = tempDir()
  const script = join(dir, 'fake-ocr.py')
  writeFileSync(script, 'console.log("{}")')
  const result = extractOcr({
    imageBase64: Buffer.from('fake-image').toString('base64'),
    filename: 'shot.png',
    runtime: { python: 'node', script },
    run: () => ({
      status: 0,
      stdout: `${JSON.stringify({
        engine: 'ppocrv5',
        lines: [
          { text: '退款金额不得超过可退余额', confidence: 0.98, font_px: 16 },
          { text: '同一订单只退一次', confidence: 0.72, font_px: 14, low_confidence: true },
        ],
        blocks: [],
      })}\n`,
    }),
  })
  assert.equal(result.schema, 'alm.ocr/v1')
  assert.equal(result.mode, 'ocr')
  assert.equal(result.sourceImage, 'shot.png')
  assert.equal(result.lines.length, 2)
  assert.equal(result.lines[0].ref, 'shot.png#L1')
  assert.equal(result.lowConfidence, 1)
  assert.match(result.text, /退款金额/)
})

test('extractOcr rejects missing or oversized images', () => {
  assert.throws(() => extractOcr({}), (error) => error.code === 'image-required')
  const big = Buffer.alloc(9 * 1024 * 1024).toString('base64')
  assert.throws(() => extractOcr({ imageBase64: big, filename: 'big.png' }), (error) => error.code === 'image-too-large')
})
