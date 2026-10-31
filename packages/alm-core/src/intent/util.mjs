/**
 * Small deterministic helpers shared by the intent modules: canonical JSON,
 * hashing, ids, safe UTF-8 bounded text and atomic file writes.
 *
 * Atomic writes matter because a session file is the only carrier of a human
 * decision: a torn write would either lose the decision or leave a JSON file
 * the UI can never load. Every write therefore goes to a sibling temp file and
 * is renamed over the target on the same filesystem.
 */
import { createHash, randomBytes } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import { MAX_EXTRACTED_TEXT, intentError } from './errors.mjs'

/** Stable JSON: recursively sorted object keys, arrays keep their order. */
export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value))
}

function canonicalValue(value) {
  if (value === null || typeof value !== 'object') return value === undefined ? null : value
  if (Array.isArray(value)) return value.map((entry) => canonicalValue(entry))
  if (value instanceof Date) return value.toISOString()
  const out = {}
  for (const key of Object.keys(value).sort()) {
    const entry = value[key]
    if (entry === undefined) continue
    out[key] = canonicalValue(entry)
  }
  return out
}

export function sha256Hex(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : canonicalJson(value), 'utf8').digest('hex')
}

export function shortHash(value, length = 16) {
  return sha256Hex(value).slice(0, length)
}

export function nowIso(now) {
  const value = now instanceof Date ? now : now === undefined ? new Date() : new Date(now)
  if (Number.isNaN(value.getTime())) throw intentError('invalid-request', 'invalid `now` value')
  return value.toISOString()
}

/** `20261031T110900` style timestamp used inside ids and backup directories. */
export function stamp(date = new Date()) {
  const value = date instanceof Date ? date : new Date(date)
  const iso = value.toISOString()
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}`
}

export function randomHex(bytes = 3) {
  return randomBytes(bytes).toString('hex')
}

/** Upper bound a user/model supplied text without splitting a surrogate pair. */
export function truncateText(value, limit = MAX_EXTRACTED_TEXT) {
  const text = typeof value === 'string' ? value : String(value ?? '')
  if (text.length <= limit) return { text, truncated: false, originalLength: text.length }
  let end = limit
  const code = text.charCodeAt(end - 1)
  if (code >= 0xd800 && code <= 0xdbff) end -= 1
  return { text: text.slice(0, end), truncated: true, originalLength: text.length }
}

export function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && value.constructor === Object
}

export function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

export function asString(value, max = 4000) {
  if (value === null || value === undefined) return ''
  const text = typeof value === 'string' ? value : String(value)
  return text.length > max ? text.slice(0, max) : text
}

/** Trim + reject control characters for single-line ids/titles. */
export function cleanLine(value, { max = 200, field = 'value' } = {}) {
  const text = asString(value, max + 1).trim()
  if (text === '') return ''
  if (/[\u0000-\u001F\u007F]/.test(text)) {
    throw intentError('invalid-request', `${field} must not contain control characters`)
  }
  return text.length > max ? text.slice(0, max) : text
}

/** Resolve a repo-relative path and refuse escape (`../`) and absolute paths. */
export function safeRepoPath(root, relativePath, { field = 'path' } = {}) {
  const repo = resolve(root)
  const raw = String(relativePath ?? '').trim()
  if (raw === '' || isAbsolute(raw)) {
    throw intentError('invalid-request', `unsafe ${field}: ${String(relativePath)}`)
  }
  const target = resolve(repo, raw)
  const rel = relative(repo, target)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel) || rel.split(sep).includes('..')) {
    throw intentError('invalid-request', `unsafe ${field}: ${String(relativePath)}`)
  }
  return target
}

export function ensureDir(path) {
  mkdirSync(path, { recursive: true })
  return path
}

export function readJsonFile(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

export function tryReadJsonFile(path) {
  try {
    return readJsonFile(path)
  } catch {
    return null
  }
}

export function fileExists(path) {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

export function dirExists(path) {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** Write a UTF-8 file atomically (temp file + rename in the same directory). */
export function writeFileAtomic(path, content) {
  ensureDir(dirname(path))
  const temp = `${path}.tmp-${process.pid}-${randomHex(3)}`
  try {
    writeFileSync(temp, content, 'utf8')
    renameSync(temp, path)
  } catch (error) {
    rmSync(temp, { force: true })
    throw error
  }
  return path
}

export function writeJsonAtomic(path, value) {
  return writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`)
}

export function listJsonFiles(dir) {
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => join(dir, name))
  } catch {
    return []
  }
}

export function listSubdirs(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
  } catch {
    return []
  }
}

export function normalizeStringList(value, { max = 20, maxLength = 500 } = {}) {
  const list = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]
  const out = []
  const seen = new Set()
  for (const entry of list) {
    const text = asString(entry, maxLength).trim()
    if (text === '' || seen.has(text)) continue
    seen.add(text)
    out.push(text)
    if (out.length >= max) break
  }
  return out
}

export function dateFrom(value, fallback = new Date()) {
  const date = value instanceof Date ? value : value === undefined ? fallback : new Date(value)
  return Number.isNaN(date.getTime()) ? fallback : date
}

export function intentRoot(root) {
  return join(resolve(root), '.alm', 'intents')
}

export function repoRelative(root, absolutePath) {
  return relative(resolve(root), absolutePath).split(sep).join('/')
}

export { existsSync }
