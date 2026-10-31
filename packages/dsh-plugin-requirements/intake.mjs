import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseChatMarkdown } from '../alm-core/src/intake/chat.mjs'
import { runOcr, OcrError } from '../alm-core/src/intake/ocr.mjs'

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

/** Screenshot → local PP-OCRv5 text with per-line confidence and `image#L<n>` refs. */
export function extractOcr({ imageBase64, filename = 'screenshot.png', run, runtime } = {}) {
  if (!imageBase64) throw new IntakeError('imageBase64 is required', { code: 'image-required' })
  const bytes = Buffer.from(String(imageBase64), 'base64')
  if (bytes.length === 0) throw new IntakeError('image is empty', { code: 'image-empty' })
  if (bytes.length > MAX_IMAGE_BYTES) throw new IntakeError('image is too large (max 8MB)', { code: 'image-too-large', status: 413 })

  const dir = mkdtempSync(join(tmpdir(), 'alm-ocr-'))
  const image = join(dir, String(filename).replace(/[^A-Za-z0-9._-]/g, '_') || 'screenshot.png')
  writeFileSync(image, bytes)
  try {
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

/** Read one attachment back from a workspace (used by tests/tools). */
export function readAttachment(root, requirementId, name) {
  const file = join(root, 'requirements', 'attachments', requirementId, name)
  if (!existsSync(file)) return null
  return readFileSync(file, 'utf8')
}
