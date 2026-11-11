/**
 * Content-addressed storage for feedback attachments.
 *
 * Feedback may carry a screenshot or a short log. The bytes must survive on
 * disk independently of the record JSON: the record only keeps a reference
 * (`{ schema, name, type, size, sha256, path }`), never base64. Files are
 * written under `.alm/feedback/attachments/<sha256>.<ext>`, so the same image
 * reported twice costs one file and the reference stays verifiable.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { feedbackError } from './store.mjs'

export const ATTACHMENT_SCHEMA = 'alm.feedback.attachment/v1'
export const ATTACHMENT_LIMITS = Object.freeze({
  count: 3,
  bytes: 2 * 1024 * 1024,
  totalBytes: 4 * 1024 * 1024,
})

const TYPES = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
  ['text/plain', 'txt'],
  ['text/markdown', 'md'],
  ['application/json', 'json'],
])

const BASE64 = /^[A-Za-z0-9+/=\s]+$/

function oneLine(value, max) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text.length > max ? text.slice(0, max) : text
}

function decodeBase64(dataBase64) {
  const raw = String(dataBase64 ?? '').replace(/^data:[^;,]*;base64,/, '').replace(/\s+/g, '')
  if (raw === '' || !BASE64.test(raw)) {
    throw feedbackError('attachment-invalid', '附件内容不是有效的 base64 数据', 400)
  }
  const buffer = Buffer.from(raw, 'base64')
  if (buffer.length === 0) {
    throw feedbackError('attachment-invalid', '附件内容为空', 400)
  }
  return buffer
}

/**
 * Persist one attachment and return the durable reference stored on the record.
 *
 * `dataBase64` and the decoded bytes never leave this function: callers only
 * get the reference back, which is what keeps the record small and the envelope
 * under its size limit.
 */
export function saveAttachment({ root, name, type, dataBase64 } = {}) {
  const repo = resolve(root)
  const label = oneLine(name, 120)
  if (label === '') throw feedbackError('attachment-name-required', '附件缺少文件名', 400)
  const mediaType = oneLine(type, 80).toLowerCase()
  const extension = TYPES.get(mediaType)
  if (!extension) {
    throw feedbackError(
      'attachment-type',
      `不支持的附件类型：${mediaType || '未提供'}（可用：${[...TYPES.keys()].join(', ')}）`,
      400,
    )
  }
  const buffer = decodeBase64(dataBase64)
  if (buffer.length > ATTACHMENT_LIMITS.bytes) {
    throw feedbackError(
      'attachment-too-large',
      `附件太大：${buffer.length} 字节（上限 ${ATTACHMENT_LIMITS.bytes} 字节）`,
      413,
    )
  }
  const sha256 = createHash('sha256').update(buffer).digest('hex')
  const relative = `.alm/feedback/attachments/${sha256}.${extension}`
  const absolute = join(repo, relative)
  if (!existsSync(absolute)) {
    mkdirSync(join(repo, '.alm', 'feedback', 'attachments'), { recursive: true })
    writeFileSync(absolute, buffer)
  }
  return {
    schema: ATTACHMENT_SCHEMA,
    name: label,
    type: mediaType,
    size: buffer.length,
    sha256,
    path: relative,
  }
}

/** Resolve a stored attachment reference back to its bytes (used by tests and future downloads). */
export function readAttachment({ root, sha256 } = {}) {
  const repo = resolve(root)
  const digest = String(sha256 ?? '').toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(digest)) return null
  const dir = join(repo, '.alm', 'feedback', 'attachments')
  const extension = [...TYPES.values()].find((value) => existsSync(join(dir, `${digest}.${value}`)))
  if (!extension) return null
  return { file: join(dir, `${digest}.${extension}`), sha256: digest }
}
