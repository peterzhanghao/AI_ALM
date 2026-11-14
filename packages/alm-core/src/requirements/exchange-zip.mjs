// Deliberately bounded ZIP subset for OOXML: no filesystem extraction or dependencies.
import { inflateRawSync } from 'node:zlib'

export const MAX_XLSX_BYTES = 8 * 1024 * 1024
const MAX_EXPANDED = 32 * 1024 * 1024
const MAX_ENTRIES = 128
export function xlsxError(message) {
  return Object.assign(new Error(`Invalid requirements XLSX: ${message}`), { code: 'invalid-xlsx', status: 400 })
}
const table = Array.from({ length: 256 }, (_, n) => {
  for (let j = 0; j < 8; j++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1
  return n >>> 0
})
export function crc32(buffer) {
  let n = 0xffffffff
  for (const byte of buffer) n = table[(n ^ byte) & 255] ^ (n >>> 8)
  return (n ^ 0xffffffff) >>> 0
}
// Excel, WPS and openpyxl all rewrite workbooks with explicit directory entries
// (`_rels/`, `xl/`, `xl/worksheets/`) and a few Windows producers use
// backslashes. Neither carries data, so normalize the separator and drop the
// leading slash instead of rejecting an otherwise valid workbook.
function normalizeName(raw) {
  let name = raw.replace(/\\/g, '/')
  while (name.startsWith('/')) name = name.slice(1)
  return name
}
function validName(name) {
  if (!name || name.includes(':') || /[\x00-\x1f]/.test(name)) return false
  const parts = name.split('/')
  return parts.every((part, i) => (part === '' ? i === parts.length - 1 : part !== '.' && part !== '..'))
}
export function writeXlsxZip(entries) {
  const locals = [], central = []
  let offset = 0
  for (const [name, text] of entries) {
    const filename = Buffer.from(name), data = Buffer.from(text), crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6)
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(filename.length, 26)
    locals.push(local, filename, data)
    const dir = Buffer.alloc(46)
    dir.writeUInt32LE(0x02014b50); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(0x800, 8)
    dir.writeUInt32LE(crc, 16); dir.writeUInt32LE(data.length, 20); dir.writeUInt32LE(data.length, 24)
    dir.writeUInt16LE(filename.length, 28); dir.writeUInt32LE(offset, 42)
    central.push(dir, filename)
    offset += local.length + filename.length + data.length
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.size, 8); end.writeUInt16LE(entries.size, 10)
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16)
  const out = Buffer.concat([...locals, directory, end])
  if (out.length > MAX_XLSX_BYTES) throw xlsxError('file exceeds 8 MiB')
  return out
}
export function readXlsxZip(input) {
  if (!Buffer.isBuffer(input) && !(input instanceof Uint8Array)) throw xlsxError('expected file bytes')
  const b = Buffer.from(input)
  if (b.length > MAX_XLSX_BYTES) throw xlsxError('file exceeds 8 MiB')
  try {
    if (b.length < 22) throw xlsxError('truncated ZIP')
    // A file renamed to .xlsx without being one (csv, xls, plain text) fails
    // here; the message says so instead of blaming the ZIP directory.
    if (b.readUInt32LE(0) !== 0x04034b50) throw xlsxError('not a valid .xlsx package (missing ZIP signature)')
    let end = -1
    for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
      if (b.readUInt32LE(i) === 0x06054b50 && i + 22 + b.readUInt16LE(i + 20) === b.length) { end = i; break }
    }
    if (end < 0) throw xlsxError('missing ZIP directory')
    const count = b.readUInt16LE(end + 10), size = b.readUInt32LE(end + 12), start = b.readUInt32LE(end + 16)
    if (b.readUInt16LE(end + 4) || b.readUInt16LE(end + 6) || b.readUInt16LE(end + 8) !== count || count > MAX_ENTRIES || start + size !== end) throw xlsxError('unsupported ZIP directory')
    const files = new Map(), ranges = []
    let at = start, expanded = 0
    for (let i = 0; i < count; i++) {
      if (at + 46 > end || b.readUInt32LE(at) !== 0x02014b50) throw xlsxError('corrupt ZIP entry')
      const flags = b.readUInt16LE(at + 8), method = b.readUInt16LE(at + 10), crc = b.readUInt32LE(at + 16)
      const packed = b.readUInt32LE(at + 20), unpacked = b.readUInt32LE(at + 24)
      const nl = b.readUInt16LE(at + 28), el = b.readUInt16LE(at + 30), cl = b.readUInt16LE(at + 32), pos = b.readUInt32LE(at + 42)
      if (at + 46 + nl + el + cl > end || b.readUInt16LE(at + 34) || flags & ~0x808 || ![0, 8].includes(method)) throw xlsxError('unsupported ZIP flags/compression')
      const name = normalizeName(new TextDecoder('utf-8', { fatal: true }).decode(b.subarray(at + 46, at + 46 + nl)))
      if (!validName(name)) throw xlsxError('unsafe ZIP path')
      if (name.endsWith('/')) {
        // Directory entry: no payload, no part. Editors emit one per folder.
        if (packed || unpacked) throw xlsxError('directory ZIP entry with content')
        at += 46 + nl + el + cl
        continue
      }
      if (files.has(name)) throw xlsxError('duplicate ZIP path')
      expanded += unpacked
      if (expanded > MAX_EXPANDED || unpacked > MAX_EXPANDED) throw xlsxError('expanded ZIP exceeds 32 MiB')
      if (pos + 30 > start || b.readUInt32LE(pos) !== 0x04034b50 || b.readUInt16LE(pos + 6) !== flags || b.readUInt16LE(pos + 8) !== method) throw xlsxError('corrupt local ZIP header')
      const localNl = b.readUInt16LE(pos + 26), localEl = b.readUInt16LE(pos + 28), dataAt = pos + 30 + localNl + localEl
      if (localNl !== nl || !b.subarray(pos + 30, pos + 30 + localNl).equals(b.subarray(at + 46, at + 46 + nl)) || dataAt + packed > start) throw xlsxError('corrupt ZIP data range')
      if (!(flags & 8) && (b.readUInt32LE(pos + 14) !== crc || b.readUInt32LE(pos + 18) !== packed || b.readUInt32LE(pos + 22) !== unpacked)) throw xlsxError('ZIP header size/CRC mismatch')
      ranges.push([pos, dataAt + packed])
      const data = method === 0 ? b.subarray(dataAt, dataAt + packed) : inflateRawSync(b.subarray(dataAt, dataAt + packed), { maxOutputLength: Math.min(MAX_EXPANDED, unpacked + 1) })
      if (data.length !== unpacked || crc32(data) !== crc) throw xlsxError('ZIP CRC/size mismatch')
      files.set(name, data)
      at += 46 + nl + el + cl
    }
    if (at !== end) throw xlsxError('ZIP directory length mismatch')
    ranges.sort((a, z) => a[0] - z[0])
    for (let i = 1; i < ranges.length; i++) if (ranges[i][0] < ranges[i - 1][1]) throw xlsxError('overlapping ZIP entries')
    return files
  } catch (error) {
    if (error.code === 'invalid-xlsx') throw error
    throw xlsxError(`corrupt ZIP (${error.message})`)
  }
}
