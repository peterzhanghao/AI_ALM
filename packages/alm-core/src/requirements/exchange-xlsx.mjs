import { createHash } from 'node:crypto'
import { readXlsxZip, writeXlsxZip, xlsxError } from './exchange-zip.mjs'

const SCHEMA = 'alm.requirements.exchange/v1'
const FIELDS = ['title', 'brief', 'priority', 'owner']
const HEADERS = ['operation', 'uid', 'clientId', 'projectId', 'baseHash', ...FIELDS]
const CHUNK = 30000
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const hash = s => createHash('sha256').update(s).digest('hex')
const text = v => v == null ? '' : String(v)
function check(payload) {
  if (!payload || payload.schema !== SCHEMA || typeof payload.exportId !== 'string' || typeof payload.projectId !== 'string' || !Array.isArray(payload.records)) throw xlsxError('unsupported exchange payload')
  if (payload.records.length > 1000) throw xlsxError('more than 1000 records')
  for (const record of payload.records) {
    if (!record || typeof record !== 'object' || !record.values) throw xlsxError('invalid record')
    for (const field of FIELDS) {
      const v = record.values[field]
      if (v !== null && typeof v !== 'string') throw xlsxError(`invalid ${field} type`)
      if (typeof v === 'string' && (/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]/.test(v) || /^\s*[=+@]/.test(v) || /^\s*-/.test(v) && !(field === 'brief' && /^\s*- /.test(v)))) throw xlsxError(`unsafe ${field} text/formula`)
    }
    if (Buffer.byteLength(record.values.brief ?? '') > 1024 * 1024) throw xlsxError('brief exceeds 1 MiB')
    if (text(record.values.title).length > 200 || text(record.values.owner).length > 120) throw xlsxError('title/owner exceeds limit')
  }
}
const escape = s => text(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\r/g, '&#13;')
function col(n) { let s = ''; for (n++; n; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s }
function sheet(rows) {
  return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${NS}"><sheetData>${rows.map((row, r) => `<row r="${r + 1}">${row.map((v, c) => `<c r="${col(c)}${r + 1}" t="inlineStr"><is><t xml:space="preserve">${escape(v)}</t></is></c>`).join('')}</row>`).join('')}</sheetData></worksheet>`
}
function chunks(value) {
  const out = []
  for (let i = 0; i < value.length;) {
    let end = Math.min(i + CHUNK, value.length)
    if (end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1])) end--
    out.push(value.slice(i, end)); i = end
  }
  return out.length ? out : ['']
}
/** Real OOXML workbook. Brief continuation chunks are editable on the Brief sheet.
 * Metadata is not authentication: the domain layer MUST verify retained proofs.
 */
export function encodeRequirementsXlsx(payload) {
  check(payload)
  const json = JSON.stringify(payload), digest = hash(json)
  const rows = [[SCHEMA, payload.exportId, payload.projectId, digest], HEADERS], briefs = [['record', 'chunk', 'brief']]
  payload.records.forEach((r, i) => {
    const parts = chunks(text(r.values.brief))
    rows.push([...HEADERS.slice(0, 5).map(k => text(r[k])), ...FIELDS.map(k => k === 'brief' ? parts[0] : text(r.values[k]))])
    parts.slice(1).forEach((part, j) => briefs.push([String(i + 1), String(j + 2), part]))
  })
  const metadata = [['sha256', digest], ...chunks(Buffer.from(json).toString('base64')).map((s, i) => [String(i), s])]
  const files = new Map([
    ['[Content_Types].xml', `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${[1, 2, 3].map(i => `<Override PartName="/xl/worksheets/sheet${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`],
    ['_rels/.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<workbook xmlns="${NS}" xmlns:r="${REL}"><sheets><sheet name="Requirements" sheetId="1" r:id="rId1"/><sheet name="Brief" sheetId="2" r:id="rId2"/><sheet name="_Metadata" sheetId="3" state="veryHidden" r:id="rId3"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${[1, 2, 3].map(i => `<Relationship Id="rId${i}" Type="${REL}/worksheet" Target="worksheets/sheet${i}.xml"/>`).join('')}</Relationships>`],
    ['xl/worksheets/sheet1.xml', sheet(rows)], ['xl/worksheets/sheet2.xml', sheet(briefs)], ['xl/worksheets/sheet3.xml', sheet(metadata)],
  ])
  return writeXlsxZip(files)
}
function unescape(s) {
  return s.replace(/&([^;]+);/g, (_, entity) => {
    const known = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
    if (Object.hasOwn(known, entity)) return known[entity]
    const n = /^#x[\da-f]+$/i.test(entity) ? parseInt(entity.slice(2), 16) : /^#\d+$/.test(entity) ? Number(entity.slice(1)) : NaN
    if (!Number.isInteger(n) || n < 0 || n > 0x10ffff || n >= 0xd800 && n <= 0xdfff) throw xlsxError('invalid XML entity')
    return String.fromCodePoint(n)
  })
}
// Small non-validating XML tree reader: rejects DTD/entities, mismatched tags and
// unsupported markup; namespace prefixes are preserved only on attributes.
function xml(buffer) {
  const s = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  if (/<!DOCTYPE|<!ENTITY/i.test(s)) throw xlsxError('DTD/entities forbidden')
  const root = { children: [] }, stack = [root]
  const tokens = s.match(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<[^>]*>|[^<]+/g) ?? []
  let length = 0, nodes = 0
  for (const token of tokens) {
    length += token.length
    if (token.startsWith('<?') || token.startsWith('<!--')) continue
    if (token.startsWith('</')) {
      const name = token.slice(2, -1).trim()
      if (stack.length < 2 || stack.pop().fullName !== name) throw xlsxError('mismatched XML tags')
    } else if (token.startsWith('<')) {
      const m = /^<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*\s*)(\/?)>$/.exec(token)
      if (!m || ++nodes > 200000 || stack.length > 64) throw xlsxError('unsupported/oversized XML')
      const attrs = {}
      for (const a of m[2].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
        if (Object.hasOwn(attrs, a[1])) throw xlsxError('duplicate XML attribute')
        attrs[a[1]] = unescape(a[2] ?? a[3])
      }
      const node = { fullName: m[1], name: m[1].split(':').pop(), attrs, children: [], text: '' }
      stack.at(-1).children.push(node)
      if (!m[3]) stack.push(node)
    } else {
      if (stack.length === 1 && token.trim()) throw xlsxError('text outside XML root')
      if (stack.length > 1) stack.at(-1).text += unescape(token)
    }
  }
  if (length !== s.length || stack.length !== 1 || root.children.length !== 1) throw xlsxError('malformed XML')
  return root.children[0]
}
function all(node, name) { return [...(node.name === name ? [node] : []), ...node.children.flatMap(n => all(n, name))] }
function strings(node) { return all(node, 't').map(n => n.text).join('') }
function rows(node, shared) {
  const out = []
  for (const row of all(node, 'row')) {
    const values = [], used = new Set()
    for (const cell of row.children) {
      if (cell.name !== 'c') throw xlsxError('unsupported worksheet row element')
      const ref = /^([A-Z]+)([1-9]\d*)$/.exec(cell.attrs.r ?? '')
      if (!ref) throw xlsxError('missing cell reference')
      let c = 0; for (const ch of ref[1]) c = c * 26 + ch.charCodeAt(0) - 64
      if (c > 16 || used.has(c)) throw xlsxError('duplicate/out-of-range cell')
      used.add(c)
      const type = cell.attrs.t ?? 'n', v = cell.children.find(n => n.name === 'v')?.text ?? ''
      let value
      if (type === 'inlineStr') value = strings(cell)
      else if (type === 's' && /^\d+$/.test(v) && Number(v) < shared.length) value = shared[Number(v)]
      else if (type === 'str' || type === 'n' && (v === '' || /^\d+$/.test(v))) value = v
      else throw xlsxError('unsupported cell type')
      if (value.length > 32767) throw xlsxError('cell exceeds Excel text limit')
      values[c - 1] = value
    }
    Object.defineProperty(values, 'rowNumber', { value: Number(row.attrs.r) })
    if (values.some(v => v !== '')) out.push(values)
  }
  return out
}
export function decodeRequirementsXlsx(buffer) {
  try {
    const files = readXlsxZip(buffer), trees = new Map()
    for (const [name, bytes] of files) {
      if (!/\.(xml|rels)$/.test(name)) throw xlsxError('unsupported binary/macro ZIP part')
      const tree = xml(bytes); trees.set(name, tree)
      if (all(tree, 'f').length || all(tree, 'externalReference').length || all(tree, 'hyperlink').length) throw xlsxError('formulas/external links forbidden')
      for (const r of all(tree, 'Relationship')) if (r.attrs.TargetMode === 'External' || /^(?:[a-z]+:|\/\/)/i.test(r.attrs.Target ?? '') || /externalLink|vbaProject/i.test(r.attrs.Type ?? '')) throw xlsxError('external relationships/macros forbidden')
      if (/macroEnabled|vbaProject/i.test(bytes.toString())) throw xlsxError('macros forbidden')
    }
    const workbook = trees.get('xl/workbook.xml'), rels = trees.get('xl/_rels/workbook.xml.rels')
    if (!workbook || !rels) throw xlsxError('missing workbook')
    const names = all(workbook, 'sheet').map(s => s.attrs.name)
    if (names.length !== 3 || names.some(n => !['Requirements', 'Brief', '_Metadata'].includes(n))) throw xlsxError('unexpected worksheet; only four editable fields are supported')
    const shared = trees.has('xl/sharedStrings.xml') ? all(trees.get('xl/sharedStrings.xml'), 'si').map(strings) : []
    function get(name) {
      const sheets = all(workbook, 'sheet').filter(s => s.attrs.name === name)
      if (sheets.length !== 1) throw xlsxError(`missing/duplicate ${name} sheet`)
      const relation = all(rels, 'Relationship').find(r => r.attrs.Id === sheets[0].attrs['r:id'])
      const target = relation?.attrs.Target ?? ''
      const path = target.startsWith('/xl/') ? target.slice(1) : `xl/${target}`
      if (!/^xl\/worksheets\/[\w.-]+\.xml$/.test(path) || !trees.has(path)) throw xlsxError('invalid worksheet relationship')
      return rows(trees.get(path), shared)
    }
    const meta = get('_Metadata'), main = get('Requirements'), continuation = get('Brief')
    if (meta[0]?.[0] !== 'sha256' || !/^[a-f0-9]{64}$/.test(meta[0]?.[1] ?? '')) throw xlsxError('missing metadata digest')
    let encoded = ''
    meta.slice(1).forEach((r, i) => { if (r[0] !== String(i) || r.length !== 2 || !/^[A-Za-z0-9+/=]*$/.test(r[1])) throw xlsxError('metadata chunk changed'); encoded += r[1] })
    const json = Buffer.from(encoded, 'base64').toString('utf8')
    if (hash(json) !== meta[0][1]) throw xlsxError('metadata digest changed')
    const payload = JSON.parse(json); check(payload)
    if (JSON.stringify(main[0]) !== JSON.stringify([SCHEMA, payload.exportId, payload.projectId, meta[0][1]]) || JSON.stringify(main[1]) !== JSON.stringify(HEADERS)) throw xlsxError('read-only metadata/header changed')
    if (JSON.stringify(continuation[0]) !== JSON.stringify(['record', 'chunk', 'brief'])) throw xlsxError('Brief header changed')
    const extra = new Map()
    for (const r of continuation.slice(1)) {
      if (r.length !== 3 || !/^[1-9]\d*$/.test(r[0]) || !/^[1-9]\d*$/.test(r[1])) throw xlsxError('invalid brief continuation')
      const index = Number(r[0]) - 1, chunk = Number(r[1]), original = payload.records[index]
      if (!original || chunk < 2 || chunk > chunks(text(original.values.brief)).length || extra.has(`${index}:${chunk}`)) throw xlsxError('read-only brief chunk identity changed')
      extra.set(`${index}:${chunk}`, r[2])
    }
    const selected = [], seen = new Set(), clientIds = new Set()
    // Reserve metadata client IDs even for omitted rows; new records cannot
    // shadow an exported create identity with altered read-only fields.
    const reservedClientIds = new Set(payload.records.map(r => r.clientId).filter(v => typeof v === 'string'))
    if (main.length - 2 > 1000) throw xlsxError('more than 1000 records')
    for (const row of main.slice(2)) {
      if (row.length > HEADERS.length) throw xlsxError('unexpected worksheet column')
      const index = payload.records.findIndex(r => HEADERS.slice(0, 5).every((k, i) => text(r[k]) === (row[i] ?? '')))
      if (index < 0) {
        // External editors may append explicit creates, never invent updates.
        // Existing exported row slots remain read-only in their identity columns.
        const clientId = row[2] ?? ''
        if (!(row.rowNumber > payload.records.length + 2) || row[0] !== 'create' || (row[1] ?? '') !== '' || !clientId.trim() || row[3] !== payload.projectId || (row[4] ?? '') !== '' || reservedClientIds.has(clientId) || clientIds.has(clientId)) throw xlsxError('invalid appended create/read-only record identity changed')
        clientIds.add(clientId)
        selected.push({ operation: 'create', clientId, projectId: payload.projectId, values: Object.fromEntries(FIELDS.map((k, i) => [k, row[i + 5] ?? ''])), attachments: [] })
        continue
      }
      if (seen.has(index)) throw xlsxError('read-only record identity changed/duplicated')
      seen.add(index)
      const record = structuredClone(payload.records[index])
      if (record.operation === 'create') {
        if (clientIds.has(record.clientId)) throw xlsxError('duplicate create clientId')
        clientIds.add(record.clientId)
      }
      FIELDS.forEach((k, i) => {
        let v = row[i + 5] ?? ''
        if (k === 'brief') for (let c = 2; c <= chunks(text(record.values.brief)).length; c++) {
          if (!extra.has(`${index}:${c}`)) throw xlsxError('missing brief continuation chunk')
          v += extra.get(`${index}:${c}`)
        }
        record.values[k] = v === '' && record.values[k] === null ? null : v
      })
      selected.push(record)
    }
    payload.records = selected; check(payload)
    return payload
  } catch (error) {
    if (error.code === 'invalid-xlsx') throw error
    throw xlsxError(error.message)
  }
}
