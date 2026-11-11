import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseChatMarkdown } from '../alm-core/src/intake/chat.mjs'
import { runOcr, runOcrAsync, OcrError } from '../alm-core/src/intake/ocr.mjs'

export class IntakeError extends Error {
  constructor(message, { code = 'intake', status = 400 } = {}) {
    super(message)
    this.name = 'IntakeError'
    this.code = code
    this.status = status
  }
}

const MAX_IMAGE_BYTES = 8 * 1024 * 1024

/** Chat export/paste → messages with stable `chat.md#L<line>` citations. */
export function extractChat({ markdown }) {
  const text = String(markdown ?? '')
  if (text.trim() === '') throw new IntakeError('chat markdown is empty', { code: 'chat-empty' })
  const parsed = parseChatMarkdown(text)
  return {
    schema: 'alm.intake.chat/v1',
    mode: 'chat',
    text: parsed.messages.map((message) => message.text).filter(Boolean).join('\n'),
    messages: parsed.messages.map((message) => ({
      ...message,
      ref: `chat.md#L${message.line}`,
    })),
    citations: parsed.messages.map((message) => ({ ref: `chat.md#L${message.line}`, speaker: message.speaker, time: message.time })),
    warnings: parsed.warnings,
  }
}

/** Extract only explicitly labelled facts; ambiguous conversation is never guessed. */
export function crystallizeChatDraft({ summary, messages, draft } = {}) {
  const clean = value => String(value ?? '').replace(/\r\n?/g, '\n').replace(/^\s*(?:\[?\d{1,2}:\d{2}(?::\d{2})?\]?\s*)?(?:用户|助手|user|assistant)\s*[:：]\s*/gim, '').trim()
  const text = clean([summary, ...(Array.isArray(messages) ? messages.map(m => typeof m === 'string' ? m : m?.text ?? m?.content ?? '') : [])].filter(Boolean).join('\n'))
  if (text.length > 40000) throw new IntakeError('chat context is too long', { code: 'chat-too-long' })
  const fields = { title: '', goal: '', problem: '', acceptance: [] }
  let current = null
  for (const line of text.split('\n')) {
    const match = /^\s*(?:#{1,4}\s*)?(?:\*\*)?(标题|title|目标|goal|问题现状|问题与场景|问题|problem|验收标准|验收要求|acceptance(?: criteria)?|AC)(?:\*\*)?\s*[:：]\s*(.*)$/i.exec(line)
    if (match) {
      const label = match[1].toLowerCase()
      current = /^(标题|title)$/.test(label) ? 'title' : /^(目标|goal)$/.test(label) ? 'goal' : /^(问题现状|问题与场景|问题|problem)$/.test(label) ? 'problem' : 'acceptance'
      if (match[2].trim()) {
        if (current === 'acceptance') fields.acceptance.push(match[2].trim())
        else fields[current] = match[2].trim()
      }
    } else if (current === 'acceptance' && /^\s*(?:[-*]|\d+[.、)])\s+/.test(line)) fields.acceptance.push(line.replace(/^\s*(?:[-*]|\d+[.、)])\s+/, '').trim())
  }
  if (draft && typeof draft === 'object' && !Array.isArray(draft)) {
    for (const key of ['title', 'goal', 'problem']) if (typeof draft[key] === 'string') fields[key] = clean(draft[key])
    const ac = draft.acceptance ?? draft.acceptanceCriteria
    if (Array.isArray(ac)) fields.acceptance = ac.map(entry => typeof entry === 'string' ? entry.trim() : entry).filter(Boolean)
  }
  return { ...fields, sourceText: text }
}

/** Screenshot → local PP-OCRv5 text with per-line confidence and `image#L<n>` refs. */
export function extractOcr({ imageBase64, filename = 'screenshot.png', run, runtime } = {}) {
  if (!imageBase64) throw new IntakeError('imageBase64 is required', { code: 'image-required' })
  const bytes = Buffer.from(String(imageBase64), 'base64')
  if (bytes.length === 0) throw new IntakeError('image is empty', { code: 'image-empty' })
  if (bytes.length > MAX_IMAGE_BYTES) throw new IntakeError('image is too large (max 8MB)', { code: 'image-too-large', status: 413 })

  const dir = mkdtempSync(join(tmpdir(), 'alm-ocr-'))
  try {
    const extension = /\.(png|jpe?g|webp)$/i.exec(String(filename))?.[0]?.toLowerCase() ?? '.png'
    const image = join(dir, `image${extension}`)
    writeFileSync(image, bytes)
    const result = runOcr(image, { run, runtime })
    const name = String(filename)
    return {
      ...result,
      mode: 'ocr',
      sourceImage: name,
      text: result.lines.map((line) => line.text).join('\n'),
      lines: result.lines.map((line, index) => ({ ...line, index: index + 1, ref: `${name}#L${index + 1}` })),
      citations: result.lines.map((line, index) => ({
        ref: `${name}#L${index + 1}`,
        text: line.text,
        confidence: line.confidence,
      })),
      lowConfidence: result.lines.filter((line) => line.lowConfidence).length,
    }
  } catch (error) {
    if (error instanceof OcrError) throw new IntakeError(error.message, { code: 'ocr-failed', status: 400 })
    throw error
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export async function extractOcrAsync({ imageBase64, filename = 'screenshot.png', runtime, signal } = {}) {
  if (!imageBase64) throw new IntakeError('imageBase64 is required', { code: 'image-required' })
  const bytes = Buffer.from(String(imageBase64), 'base64')
  if (bytes.length === 0) throw new IntakeError('image is empty', { code: 'image-empty' })
  if (bytes.length > MAX_IMAGE_BYTES) throw new IntakeError('image is too large (max 8MB)', { code: 'image-too-large', status: 413 })
  const dir = mkdtempSync(join(tmpdir(), 'alm-ocr-'))
  try {
    const extension = /\.(png|jpe?g|webp)$/i.exec(String(filename))?.[0]?.toLowerCase() ?? '.png'
    const image = join(dir, `image${extension}`)
    writeFileSync(image, bytes)
    const result = await runOcrAsync(image, { runtime, signal })
    const name = String(filename)
    return {
      ...result, mode: 'ocr', sourceImage: name,
      text: result.lines.map(line => line.text).join('\n'),
      lines: result.lines.map((line, index) => ({ ...line, index: index + 1, ref: `${name}#L${index + 1}` })),
      citations: result.lines.map((line, index) => ({ ref: `${name}#L${index + 1}`, text: line.text, confidence: line.confidence })),
      lowConfidence: result.lines.filter(line => line.lowConfidence).length,
    }
  } catch (error) {
    if (error instanceof OcrError) throw new IntakeError(error.message, { code: 'ocr-failed', status: 400 })
    throw error
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

/** Read one attachment back from a workspace (used by tests/tools). */
export function readAttachment(root, requirementId, name) {
  const file = join(root, 'requirements', 'attachments', requirementId, name)
  if (!existsSync(file)) return null
  return readFileSync(file, 'utf8')
}
