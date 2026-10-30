import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { normalizeChatMarkdown, parseChatMarkdown } from '../../src/intake/chat.mjs'
import { OcrError, normalizeOcrResult, parseOcrJson, resolveOcrRuntime, runOcr } from '../../src/intake/ocr.mjs'

const dirs = []
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

test('chat Markdown: inline time, header + body, bracket form and plain paste', () => {
  const markdown = [
    '# 客服群',
    '',
    '- 10:12 客服-小林：同一个订单出现了两笔退款单。',
    '',
    '**支付-阿哲** 10:15',
    '调用方重试没带幂等键，服务端也没去重。',
    '',
    '[10:18] 产品-王: 重复提交要返回第一次的退款单。',
    '',
    '会议结论：P1，本轮修。',
  ].join('\n')

  const parsed = parseChatMarkdown(markdown)
  assert.equal(parsed.messages.length, 4)
  assert.deepEqual(parsed.messages.map((message) => message.time), ['10:12', '10:15', '10:18', null])
  assert.equal(parsed.messages[1].speaker, '支付-阿哲')
  assert.match(parsed.messages[1].text, /幂等键/)
  assert.equal(parsed.messages[2].speaker, '产品-王')
  assert.equal(parsed.messages[0].line, 3)
})

test('chat normalization keeps source line references', () => {
  const parsed = parseChatMarkdown('- 10:12 小林：第一行\n第二行')
  assert.equal(parsed.messages[0].text, '第一行\n第二行')
  assert.match(parsed.messages[0].text, /第一行/)
  const normalized = normalizeChatMarkdown(parseChatMarkdown('- 10:12 小林：内容'))
  assert.match(normalized, /### M1 · 10:12 · 小林/)
  assert.match(normalized, /<!-- line:1 -->/)
})

test('OCR output parsing picks the last JSON line', () => {
  const stdout = '[setup] noise\n{"lines":[{"text":"你好","confidence":0.99,"font_px":12,"low_confidence":false}],"blocks":[]}'
  const payload = parseOcrJson(stdout)
  assert.equal(payload.lines[0].text, '你好')
})

test('normalized OCR result exposes citations, confidence and low-confidence count', () => {
  const result = normalizeOcrResult(
    {
      engine: 'ppocrv5',
      lines: [
        { text: '退款幂等', confidence: 0.99, font_px: 12, low_confidence: false },
        { text: '同一键', confidence: 0.7, font_px: 6, low_confidence: true },
      ],
      blocks: [{ text: '退款幂等', confidence: 0.99, box: [1, 2, 3, 4] }],
    },
    'screenshot-01.png',
  )
  assert.equal(result.schema, 'alm.ocr/v1')
  assert.equal(result.lines[0].ref, 'screenshot-01.png#L1')
  assert.equal(result.lines[1].lowConfidence, true)
  assert.equal(result.lowConfidence, 1)
  assert.equal(result.text, '退款幂等\n同一键')
})

test('runOcr uses the resolved runtime and surfaces failures', () => {
  const dir = mkdtempSync(join(tmpdir(), 'alm-ocr-'))
  dirs.push(dir)
  const image = join(dir, 'shot.png')
  writeFileSync(image, 'not-really-a-png')
  const script = join(dir, 'ocr.py')
  writeFileSync(script, '')
  const calls = []
  const run = (python, args) => {
    calls.push([python, ...args])
    return { status: 0, stdout: '{"lines":[{"text":"hi","confidence":0.9}],"blocks":[]}', stderr: '' }
  }

  const result = runOcr(image, { runtime: { python: 'python.exe', script }, run })
  assert.equal(result.lines[0].ref, `${image}#L1`)
  assert.equal(calls[0][0], 'python.exe')
  assert.deepEqual(calls[0].slice(1, 3), [script, image])

  const failing = () => ({ status: 2, stdout: '', stderr: 'boom' })
  assert.throws(() => runOcr(image, { runtime: { python: 'python.exe', script }, run: failing }), OcrError)
  assert.throws(() => runOcr(image, { runtime: { python: 'python.exe', script: '' } }), /not installed/)
})

test('runtime resolution finds the plugin in a profile and honours overrides', () => {
  const home = mkdtempSync(join(tmpdir(), 'alm-home-'))
  dirs.push(home)
  const script = join(home, '.dsh', 'profiles', 'desktop', 'node_modules', 'dsh-ocr-local', 'ocr', 'ocr.py')
  mkdirSync(join(script, '..'), { recursive: true })
  writeFileSync(script, '')

  const runtime = resolveOcrRuntime({ home, env: {}, platform: 'win32' })
  assert.equal(runtime.script, script)
  assert.match(runtime.python, /\.dsh-ocr/)

  const override = resolveOcrRuntime({ home, env: { DSH_OCR_SCRIPT: 'X:/ocr.py', DSH_OCR_PYTHON: 'py' }, platform: 'win32' })
  assert.deepEqual(override, { python: 'py', script: 'X:/ocr.py' })
})
