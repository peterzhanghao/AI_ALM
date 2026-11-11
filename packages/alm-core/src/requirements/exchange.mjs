import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { parseSdocAsset } from '../parse/sdoc.mjs'

export const EXCHANGE_SCHEMA = 'alm.requirements.exchange/v1'
export const EXCHANGE_LIMITS = Object.freeze({ bytes: 8 * 1024 * 1024, records: 1000, briefBytes: 1024 * 1024 })
const FIELDS = ['title', 'brief', 'priority', 'owner']
const KEY = '.alm/exchange/key'
const CREATES = '.alm/exchange/creates.json'
const JOURNAL = '.alm/exchange/transaction.json'
const LOCK = '.alm/exchange.lock'

export class RequirementsExchangeError extends Error {
  constructor(message, code = 'invalid-exchange', status = 400) {
    super(message)
    this.name = 'RequirementsExchangeError'
    this.code = code
    this.status = status
  }
}
function fail(message, code, status) { throw new RequirementsExchangeError(message, code, status) }
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`
  return JSON.stringify(value)
}
function hash(value) { return createHash('sha256').update(value).digest('hex') }
function object(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(`${label} must be a plain object`)
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${label}: forbidden field ${key}`, 'forbidden-field')
}
function safePath(repo, path) {
  if (typeof path !== 'string' || !path || path.includes('\\') || path.includes(':') || path.startsWith('/') || path.split('/').some(p => !p || p === '.' || p === '..') || /[\x00-\x1f\x7f]/.test(path)) fail(`unsafe path: ${path}`, 'unsafe-path')
  let current = repo
  if (lstatSync(repo).isSymbolicLink()) fail('symbolic link repository is not supported', 'unsafe-path')
  for (const part of path.split('/')) {
    current = join(current, part)
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) fail(`symbolic link path: ${path}`, 'unsafe-path')
  }
  return current
}
function values(v) {
  object(v, FIELDS, 'values')
  for (const field of FIELDS) {
    if (typeof v[field] !== 'string') fail(`${field} must be a string`)
    if (/^[=+@]/.test(v[field].trimStart()) || /^-(?!\s)/.test(v[field].trimStart())) fail(`${field} contains a formula-like value`, 'formula-injection')
  }
  for (const [field, max] of [['title', 200], ['owner', 120]]) {
    if (v[field].length > max || /[\x00-\x1f\x7f]/.test(v[field]) || v[field] !== v[field].trim()) fail(`invalid ${field}`)
  }
  if (!v.title || !/^P[0-3]$/.test(v.priority) || Buffer.byteLength(v.brief) > EXCHANGE_LIMITS.briefBytes || v.brief.includes('\0')) fail('invalid title, priority or brief')
  return v
}
function attachments(repo, list) {
  if (!Array.isArray(list) || list.length > 1000) fail('invalid attachments')
  const seen = new Set()
  for (const a of list) {
    object(a, ['path', 'name', 'sha256', 'size', 'mime', 'kind', 'capturedAt', 'addedBy'], 'attachment')
    safePath(repo, a.path)
    if (seen.has(a.path)) fail('duplicate attachment path')
    seen.add(a.path)
    for (const [key, value] of Object.entries(a)) {
      if (key === 'size') { if (!Number.isSafeInteger(value) || value < 0) fail('invalid attachment size') }
      else if (typeof value !== 'string' || value.length > 2048 || /[\x00-\x1f\x7f]/.test(value)) fail('invalid attachment metadata')
    }
  }
  return list
}
function project(repo) {
  const p = JSON.parse(readFileSync(safePath(repo, '.alm/project.json'), 'utf8'))
  if (p.schema !== 'alm.project/v1' || !/^[A-Z][A-Z0-9]{1,7}$/.test(p.id)) fail('invalid local project')
  safePath(repo, p.requirementRoot)
  return p
}
function snapshot(repo) {
  if (existsSync(safePath(repo, JOURNAL))) fail('unfinished exchange transaction; explicit recovery required', 'recovery-required', 409)
  const p = project(repo), files = new Map(), rows = new Map()
  let total = 0
  function read(path) {
    if (files.has(path)) return files.get(path)
    const absolute = safePath(repo, path)
    const stat = lstatSync(absolute)
    if (!stat.isFile()) fail(`not a regular file: ${path}`, 'unsafe-path')
    if (stat.size > 64 * 1024 * 1024 || total + stat.size > 64 * 1024 * 1024) fail('local requirement tree exceeds safe limits', 'size-limit')
    const bytes = readFileSync(absolute)
    total += bytes.length
    if (files.size >= 10000 || total > 64 * 1024 * 1024) fail('local requirement tree exceeds safe limits', 'size-limit')
    files.set(path, bytes)
    return bytes
  }
  function walk(path) {
    if (!existsSync(safePath(repo, path))) return
    for (const e of readdirSync(safePath(repo, path), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = `${path}/${e.name}`
      if (e.isSymbolicLink()) fail(`symbolic link: ${child}`, 'unsafe-path')
      if (e.isDirectory()) walk(child)
      else if (e.isFile()) read(child)
      else fail(`unsupported filesystem entry: ${child}`, 'unsafe-path')
    }
  }
  read('.alm/project.json')
  walk(p.requirementRoot)
  for (const file of [KEY, CREATES]) if (existsSync(safePath(repo, file))) read(file)
  for (const [path, bytes] of [...files]) {
    if (!path.endsWith('.sdoc')) continue
    for (const a of parseSdocAsset(bytes.toString('utf8'), path)) {
      if (a.type !== 'requirement') continue
      if (rows.has(a.id)) fail(`duplicate UID: ${a.id}`)
      if ((a.extra?.project !== undefined && a.extra.project !== p.id) || !a.id.startsWith(`REQ-${p.id}-`)) fail(`requirement project mismatch: ${a.id}`)
      const briefFile = a.extra?.brief
      const brief = briefFile ? read(briefFile).toString('utf8') : ''
      const manifestFile = `${p.requirementRoot}/attachments/${a.id}/manifest.json`
      const manifest = existsSync(safePath(repo, manifestFile)) ? JSON.parse(read(manifestFile).toString('utf8')).files : []
      const row = { uid: a.id, projectId: p.id, values: { title: a.title, brief, priority: a.extra?.priority ?? 'P2', owner: a.owner ?? '' }, attachments: attachments(repo, manifest), file: path, briefFile, revision: a.extra?.revision ?? 1 }
      values(row.values)
      rows.set(a.id, row)
    }
  }
  const localHash = hash(canonical([...files].sort(([a], [b]) => a.localeCompare(b)).map(([path, bytes]) => [path, hash(bytes)])))
  return { p, files, rows, localHash }
}
function localKey(repo) {
  const file = safePath(repo, KEY)
  if (!existsSync(file)) fail('requirements exchange is not initialized; explicitly initialize before export or import', 'exchange-uninitialized', 409)
  if (!lstatSync(file).isFile() || lstatSync(file).size !== 64) fail('invalid exchange signing key', 'invalid-key')
  const text = readFileSync(file, 'utf8')
  if (!/^[0-9a-f]{64}$/.test(text)) fail('invalid exchange signing key', 'invalid-key')
  return text
}

/** Explicit, persistent project setup. Export and preview never initialize implicitly. */
export function initializeRequirementsExchange({ root }) {
  const repo = resolve(root)
  const p = project(repo)
  if (existsSync(safePath(repo, JOURNAL))) fail('unfinished exchange transaction; explicit recovery required', 'recovery-required', 409)
  if (existsSync(safePath(repo, KEY))) {
    localKey(repo)
    return { initialized: true, created: false, projectId: p.id }
  }
  let fd
  try { fd = openSync(safePath(repo, LOCK), 'wx') } catch (error) {
    if (error.code === 'EEXIST') fail('another import holds the project lock', 'exchange-locked', 409)
    throw error
  }
  try {
    if (existsSync(safePath(repo, JOURNAL))) fail('unfinished exchange transaction; explicit recovery required', 'recovery-required', 409)
    if (existsSync(safePath(repo, KEY))) {
      localKey(repo)
      return { initialized: true, created: false, projectId: p.id }
    }
    transaction(repo, new Map([[KEY, Buffer.from(randomBytes(32).toString('hex'))]]))
    return { initialized: true, created: true, projectId: p.id }
  } finally { closeSync(fd); rmSync(safePath(repo, LOCK), { force: true }) }
}
function immutable(payload, row) {
  return canonical({ schema: payload.schema, exportId: payload.exportId, projectId: payload.projectId, operation: row.operation, uid: row.uid, project: row.projectId, base: row.base, baseHash: row.baseHash, attachments: row.attachments })
}
function signature(repo, payload, row) { return createHmac('sha256', Buffer.from(localKey(repo), 'hex')).update(immutable(payload, row)).digest('hex') }
function verify(repo, payload, row) {
  if (typeof row.proof !== 'string' || !/^[0-9a-f]{64}$/.test(row.proof) || !timingSafeEqual(Buffer.from(signature(repo, payload, row)), Buffer.from(row.proof))) fail('export baseline or identity proof is invalid', 'invalid-provenance')
}
export function exportRequirements({ root, format = 'json' }) {
  if (format !== 'json') fail('only JSON is supported by the domain exchange', 'unsupported-format')
  const repo = resolve(root), s = snapshot(repo)
  localKey(repo)
  const payload = { schema: EXCHANGE_SCHEMA, exportId: randomUUID(), projectId: s.p.id, records: [] }
  if (s.rows.size > EXCHANGE_LIMITS.records) fail('too many requirements', 'size-limit')
  for (const r of [...s.rows.values()].sort((a, b) => a.uid.localeCompare(b.uid))) {
    const row = { operation: 'update', uid: r.uid, projectId: r.projectId, base: { ...r.values }, baseHash: hash(canonical(r.values)), values: { ...r.values }, attachments: structuredClone(r.attachments) }
    row.proof = signature(repo, payload, row)
    payload.records.push(row)
  }
  if (Buffer.byteLength(JSON.stringify(payload)) > EXCHANGE_LIMITS.bytes) fail('exchange exceeds 8 MiB', 'size-limit')
  return payload
}
function rewrite(content, uid, fields) {
  const eol = content.includes('\r\n') ? '\r\n' : '\n'
  const lines = content.split(/\r?\n/)
  let start = -1, end = lines.length
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== '[REQUIREMENT]') continue
    let j = i + 1
    while (j < lines.length && !/^\[(REQUIREMENT|DOCUMENT|SECTION)\]$/.test(lines[j].trim())) j++
    if (lines.slice(i, j).some(l => /^UID\s*:/.test(l) && l.replace(/^UID\s*:\s*/, '').trim() === uid)) { start = i; end = j; break }
  }
  if (start < 0) fail(`UID missing from source: ${uid}`)
  for (const [key, value] of Object.entries(fields)) {
    const index = lines.findIndex((l, i) => i > start && i < end && new RegExp(`^${key}\\s*:`).test(l))
    if (index >= 0) lines[index] = `${key}: ${value}`
    else { lines.splice(start + 1, 0, `${key}: ${value}`); end++ }
  }
  return lines.join(eol)
}
function plan(repo, payload) {
  object(payload, ['schema', 'exportId', 'projectId', 'records'], 'payload')
  if (Buffer.byteLength(JSON.stringify(payload)) > EXCHANGE_LIMITS.bytes) fail('exchange exceeds 8 MiB', 'size-limit')
  if (payload.schema !== EXCHANGE_SCHEMA || typeof payload.exportId !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(payload.exportId)) fail('invalid schema or exportId')
  if (!Array.isArray(payload.records) || payload.records.length > EXCHANGE_LIMITS.records) fail('invalid record count', 'size-limit')
  const s = snapshot(repo)
  localKey(repo)
  if (payload.projectId !== s.p.id) fail('wrong project', 'project-mismatch')
  const changes = [], conflicts = [], writes = new Map(), mappings = Object.create(null), seen = new Set()
  const receipts = s.files.has(CREATES) ? JSON.parse(s.files.get(CREATES).toString('utf8')) : {}
  let next = Math.max(0, ...[...s.rows.keys()].map(id => Number(id.slice(`REQ-${s.p.id}-`.length))).filter(Number.isSafeInteger))
  for (const r of payload.records) {
    object(r, ['operation', 'clientId', 'uid', 'projectId', 'base', 'baseHash', 'values', 'attachments', 'proof'], 'record')
    if (r.projectId !== s.p.id) fail('record project mismatch')
    values(r.values); attachments(repo, r.attachments)
    if (r.operation === 'create') {
      if (r.uid !== undefined || r.base !== undefined || r.baseHash !== undefined || r.proof !== undefined || typeof r.clientId !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(r.clientId)) fail('create requires clientId and must not supply UID or baseline')
      const identity = `create:${r.clientId}`
      if (seen.has(identity)) fail('duplicate clientId')
      seen.add(identity)
      const receiptKey = hash(canonical([payload.exportId, r.clientId])), bodyHash = hash(canonical(r))
      if (Object.hasOwn(receipts, receiptKey)) {
        if (receipts[receiptKey].bodyHash !== bodyHash || !s.rows.has(receipts[receiptKey].uid)) fail('create identity already used for different content', 'create-conflict', 409)
        mappings[r.clientId] = receipts[receiptKey].uid
        continue
      }
      const uid = `REQ-${s.p.id}-${String(++next).padStart(3, '0')}`
      if (next > 999) fail('project requirement ID space exhausted')
      const file = `${s.p.requirementRoot}/${uid.toLowerCase()}.sdoc`, briefFile = `${s.p.requirementRoot}/briefs/${uid}.md`
      for (const path of [file, briefFile]) if (existsSync(safePath(repo, path))) fail(`new requirement path already exists: ${path}`, 'create-conflict', 409)
      writes.set(file, Buffer.from(`[DOCUMENT]\nTITLE: ${r.values.title}\n\n[REQUIREMENT]\nUID: ${uid}\nTITLE: ${r.values.title}\nPROJECT: ${s.p.id}\nOWNER: ${r.values.owner}\nPRIORITY: ${r.values.priority}\nREVISION: 1\nCATEGORY: functional\nBRIEF: ${briefFile}\nSOURCE: doc\n`))
      writes.set(briefFile, Buffer.from(r.values.brief))
      if (r.attachments.length) writes.set(`${s.p.requirementRoot}/attachments/${uid}/manifest.json`, Buffer.from(JSON.stringify({ requirement: uid, files: r.attachments }, null, 2) + '\n'))
      receipts[receiptKey] = { uid, bodyHash }
      mappings[r.clientId] = uid
      changes.push({ uid, operation: 'create', fields: FIELDS })
      continue
    }
    if (r.operation !== 'update' || r.clientId !== undefined || typeof r.uid !== 'string' || seen.has(r.uid)) fail('invalid or duplicate update identity')
    seen.add(r.uid)
    values(r.base)
    if (r.baseHash !== hash(canonical(r.base))) fail('baseline hash mismatch', 'invalid-provenance')
    verify(repo, payload, r)
    const local = s.rows.get(r.uid)
    if (!local) fail(`unknown requirement: ${r.uid}`, 'unknown-requirement')
    const merged = { ...local.values }, changed = []
    for (const field of FIELDS) {
      const b = r.base[field], l = local.values[field], e = r.values[field]
      if (e === b || l === e) continue
      if (l === b) { merged[field] = e; changed.push(field) }
      else conflicts.push({ uid: r.uid, field, base: b, local: l, external: e })
    }
    if (!changed.length) continue
    const content = (writes.get(local.file) ?? s.files.get(local.file)).toString('utf8')
    const fields = { REVISION: Number(local.revision) + 1 }
    for (const f of changed) if (f !== 'brief') fields[f.toUpperCase()] = merged[f]
    if (changed.includes('brief')) {
      if (!local.briefFile) fail('cannot import brief into requirement without a local BRIEF path')
      if (writes.has(local.briefFile)) fail('multiple requirements share a modified brief', 'shared-brief', 409)
      writes.set(local.briefFile, Buffer.from(merged.brief))
    }
    writes.set(local.file, Buffer.from(rewrite(content, r.uid, fields)))
    changes.push({ uid: r.uid, operation: 'update', fields: changed })
  }
  if (Object.keys(mappings).length && changes.some(c => c.operation === 'create')) writes.set(CREATES, Buffer.from(JSON.stringify(receipts, null, 2) + '\n'))
  return { ...s, changes, conflicts, writes, mappings }
}
export function previewRequirementsImport({ root, payload }) {
  const p = plan(resolve(root), payload)
  return { ok: !p.conflicts.length, conflicts: p.conflicts, localHash: p.localHash, changes: p.changes, mappings: p.mappings }
}

// Cooperative writer lock + write-ahead journal. No filesystem API offers a
// multi-file atomic rename: readers outside this lock can see intermediate files.
// Rollback covers ordinary I/O failures; a crash leaves the journal fail-closed.
function transaction(repo, writes) {
  const originals = [], madeDirs = [], temps = [], installed = []
  const ensureDir = path => {
    if (existsSync(path)) return
    ensureDir(dirname(path)); mkdirSync(path); madeDirs.push(path)
  }
  let journalWritten = false
  try {
    for (const [path, bytes] of writes) {
      const target = safePath(repo, path)
      if (existsSync(target) && !lstatSync(target).isFile()) fail(`not a regular file: ${path}`)
      originals.push({ path, before: existsSync(target) ? readFileSync(target).toString('base64') : null })
      ensureDir(dirname(target))
      const temp = `${target}.exchange-${randomUUID()}.tmp`
      temps.push(temp); writeFileSync(temp, bytes, { flag: 'wx' })
    }
    ensureDir(dirname(safePath(repo, JOURNAL)))
    journalWritten = true
    writeFileSync(safePath(repo, JOURNAL), JSON.stringify({ schema: 'alm.exchange.transaction/v1', originals }), { flag: 'wx' })
    let index = 0
    for (const [path] of writes) { renameSync(temps[index++], safePath(repo, path)); installed.push(path) }
    rmSync(safePath(repo, JOURNAL))
    journalWritten = false
  } catch (error) {
    const errors = []
    for (const path of installed.reverse()) {
      try {
        const original = originals.find(o => o.path === path)
        if (original.before === null) rmSync(safePath(repo, path), { force: true })
        else writeFileSync(safePath(repo, path), Buffer.from(original.before, 'base64'))
      } catch (rollbackError) { errors.push(rollbackError.message) }
    }
    if (errors.length) fail(`rollback failed; retain journal for recovery: ${errors.join('; ')}`, 'rollback-failed', 500)
    if (journalWritten) rmSync(safePath(repo, JOURNAL), { force: true })
    throw error
  } finally {
    for (const temp of temps) if (existsSync(temp)) rmSync(temp, { force: true })
    for (const dir of madeDirs.reverse()) if (existsSync(dir) && readdirSync(dir).length === 0) rmdirSync(dir)
  }
}
export function applyRequirementsImport({ root, payload, expectedLocalHash }) {
  const repo = resolve(root)
  const initial = plan(repo, payload)
  if (initial.conflicts.length) fail('import has field conflicts', 'import-conflict', 409)
  if (typeof expectedLocalHash !== 'string' || expectedLocalHash !== initial.localHash) fail('local files changed after preview', 'stale-preview', 409)
  if (!initial.writes.size) return { applied: false, idempotent: true, mappings: initial.mappings }
  let fd
  try { fd = openSync(safePath(repo, LOCK), 'wx') } catch (error) {
    if (error.code === 'EEXIST') fail('another import holds the project lock', 'exchange-locked', 409)
    throw error
  }
  try {
    const fresh = plan(repo, payload)
    if (fresh.localHash !== expectedLocalHash || fresh.conflicts.length) fail('local files changed after preview', 'stale-preview', 409)
    transaction(repo, fresh.writes)
    return { applied: true, idempotent: false, mappings: fresh.mappings, changes: fresh.changes }
  } finally { closeSync(fd); rmSync(safePath(repo, LOCK), { force: true }) }
}
