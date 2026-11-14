import test from 'node:test'
import assert from 'node:assert/strict'
import { encodeRequirementsXlsx, decodeRequirementsXlsx } from '../../src/requirements/exchange-xlsx.mjs'
import { readXlsxZip, writeXlsxZip } from '../../src/requirements/exchange-zip.mjs'

function sample() {
  return { schema: 'alm.requirements.exchange/v1', exportId: 'export-1', projectId: 'project-1', proof: { unchanged: true }, records: [
    { operation: 'update', uid: 'REQ-001', projectId: 'project-1', base: { title: '中文需求', brief: '正文\n第二行\r\n<&>', priority: 'P2', owner: null }, baseHash: 'hash-1', values: { title: '中文需求', brief: '正文\n第二行\r\n<&>', priority: 'P2', owner: null }, attachments: [], proof: 'signed' },
    { operation: 'update', uid: 'REQ-002', projectId: 'project-1', base: { title: '空值', brief: null, priority: 'P1', owner: '' }, baseHash: 'hash-2', values: { title: '空值', brief: null, priority: 'P1', owner: '' }, attachments: [] },
  ] }
}
function change(buffer, filename, fn) {
  const files = readXlsxZip(buffer)
  files.set(filename, fn(files.get(filename).toString()))
  return writeXlsxZip(files)
}
const main = 'xl/worksheets/sheet1.xml'
// Header is row 1, so an export of two records occupies rows 2-3 and appended
// rows start at row 4.
function appendRows(buffer, rows) {
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  return change(buffer, main, s => s.replace('</sheetData>', rows.map((values, i) => `<row r="${4 + i}">${values.map((v, j) => `<c r="${String.fromCharCode(65 + j)}${4 + i}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`).join('')}</row>`).join('') + '</sheetData>'))
}
test('the worksheet only exposes the fields a person fills in', () => {
  const sheet = readXlsxZip(encodeRequirementsXlsx(sample())).get(main).toString()
  const header = [...sheet.matchAll(/<c r="[A-F]1"[^>]*><is><t[^>]*>([^<]*)<\/t>/g)].map(m => m[1])
  assert.deepEqual(header, ['需求编号', '项目', '标题', '需求描述', '优先级', '负责人'])
  // No metadata row above the header, no operation/clientId/baseHash columns.
  assert.equal((sheet.match(/<row /g) ?? []).length, 3)
  for (const gone of ['操作', '客户端标识', '基线哈希', 'alm.requirements.exchange/v1']) assert.equal(sheet.includes(gone), false)
  // The Brief tab only carries long-brief continuations, so it stays hidden: an
  // empty visible tab next to the one people fill in gets deleted by editors.
  const workbook = readXlsxZip(encodeRequirementsXlsx(sample())).get('xl/workbook.xml').toString()
  assert.match(workbook, /<sheet name="Brief" sheetId="2" state="hidden"/)
  // Header stays visible while scrolling and 需求描述 is readable.
  assert.match(sheet, /<pane ySplit="1" topLeftCell="A2"/)
  assert.match(sheet, /<col min="4" max="4" width="60" customWidth="1"\/>/)
})
test('a blank requirement number creates a new requirement, and identity is file-scoped', () => {
  const b = appendRows(encodeRequirementsXlsx(sample()), [
    ['', 'project-1', '中文需求', '新正文', 'P2', ''],
    ['', 'project-1', '中文需求', '', 'P1', 'owner'],
  ])
  const result = decodeRequirementsXlsx(b)
  assert.equal(result.records.length, 4)
  assert.equal(result.records[2].operation, 'create')
  assert.match(result.records[2].clientId, /^import-export1-\d+$/)
  assert.deepEqual(result.records[2].values, { title: '中文需求', brief: '新正文', priority: 'P2', owner: '' })
  assert.equal(result.records[3].uid, undefined)
  assert.notEqual(result.records[3].clientId, result.records[2].clientId)
  // Preview and apply read the same bytes, so the create id is stable.
  assert.deepEqual(decodeRequirementsXlsx(b).records.map(r => r.clientId), result.records.map(r => r.clientId))
})
test('worksheet rows reject unknown numbers, foreign projects, missing titles and copies', () => {
  const b = encodeRequirementsXlsx(sample())
  assert.throws(() => decodeRequirementsXlsx(appendRows(b, [['REQ-999', 'project-1', 'New', '', 'P2', '']])), /unknown requirement/)
  assert.throws(() => decodeRequirementsXlsx(appendRows(b, [['', 'other-project', 'New', '', 'P2', '']])), /wrong project/)
  assert.throws(() => decodeRequirementsXlsx(appendRows(b, [['', 'project-1', '', '有正文没标题', 'P2', '']])), /needs a title/)
  const row = ['', 'project-1', 'New', '', 'P2', '']
  assert.throws(() => decodeRequirementsXlsx(appendRows(b, [row, row])), /duplicate new row/)
})
test('clearing a requirement number adds a requirement instead of renaming the exported one', () => {
  const b = change(encodeRequirementsXlsx(sample()), main, s => s.replace('r="A2" t="inlineStr"><is><t xml:space="preserve">REQ-001', 'r="A2" t="inlineStr"><is><t xml:space="preserve">'))
  const result = decodeRequirementsXlsx(b)
  assert.equal(result.records.length, 2)
  assert.equal(result.records[0].operation, 'create')
  assert.equal(result.records[0].uid, undefined)
  assert.equal(result.records[1].uid, 'REQ-002')
})
test('real ZIP/OOXML lossless Chinese, multiline, null, empty and opaque proofs', () => {
  const payload = sample(), bytes = encodeRequirementsXlsx(payload)
  assert.equal(bytes.subarray(0, 2).toString(), 'PK')
  assert.ok(readXlsxZip(bytes).has('[Content_Types].xml'))
  assert.deepEqual(decodeRequirementsXlsx(bytes), payload)
})
test('editable four fields apply, preserving identity and base', () => {
  const p = sample()
  const b = change(encodeRequirementsXlsx(p), main, s => s.replace('r="C2" t="inlineStr"><is><t xml:space="preserve">中文需求', 'r="C2" t="inlineStr"><is><t xml:space="preserve">外部标题').replace('r="E2" t="inlineStr"><is><t xml:space="preserve">P2', 'r="E2" t="inlineStr"><is><t xml:space="preserve">P0'))
  const result = decodeRequirementsXlsx(b)
  assert.equal(result.records[0].values.title, '外部标题')
  assert.equal(result.records[0].values.priority, 'P0')
  assert.deepEqual(result.records[0].base, p.records[0].base)
  assert.equal(result.records[0].proof, 'signed')
})
test('deleted worksheet rows are omitted, never converted into deletes', () => {
  const b = change(encodeRequirementsXlsx(sample()), main, s => s.replace(/<row r="2">[\s\S]*?<\/row>/, ''))
  assert.deepEqual(decodeRequirementsXlsx(b).records.map(r => r.uid), ['REQ-002'])
})
test('large brief chunk sheet preserves Unicode without exceeding Excel cell limits', () => {
  const p = sample(); p.records[0].values.brief = '中文😀\n'.repeat(10000)
  assert.deepEqual(decodeRequirementsXlsx(encodeRequirementsXlsx(p)), p)
  const b = change(encodeRequirementsXlsx(p), 'xl/worksheets/sheet2.xml', s => s.replace('中文', '修改'))
  assert.ok(decodeRequirementsXlsx(b).records[0].values.brief.includes('修改'))
})
test('a deleted Brief sheet still imports and extra sheets are ignored', () => {
  const p = sample(); p.records[0].values.brief = '长描述'.repeat(12000)
  const base = encodeRequirementsXlsx(p)
  assert.ok((readXlsxZip(base).get('xl/worksheets/sheet2.xml').toString().match(/<row /g) ?? []).length > 1)
  // Deleting the tab must not lose text or fail the import: the chunks are
  // rebuilt from the digest-verified metadata.
  const noBrief = readXlsxZip(base)
  noBrief.delete('xl/worksheets/sheet2.xml')
  noBrief.set('xl/workbook.xml', noBrief.get('xl/workbook.xml').toString().replace(/<sheet name="Brief"[^>]*\/>/, ''))
  const decoded = decodeRequirementsXlsx(writeXlsxZip(noBrief))
  assert.equal(decoded.records[0].values.brief, p.records[0].values.brief)
  // Scratch sheets people add for notes are simply not part of the exchange.
  const withNotes = readXlsxZip(base)
  withNotes.set('xl/workbook.xml', withNotes.get('xl/workbook.xml').toString().replace('</sheets>', '<sheet name="Sheet1" sheetId="4" r:id="rId4"/></sheets>'))
  withNotes.set('xl/_rels/workbook.xml.rels', withNotes.get('xl/_rels/workbook.xml.rels').toString().replace('</Relationships>', `<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`))
  assert.deepEqual(decodeRequirementsXlsx(writeXlsxZip(withNotes)).records.map(r => r.uid), ['REQ-001', 'REQ-002'])
  // Renaming the sheet is still a hard error, with a message people can act on.
  const renamed = readXlsxZip(base)
  renamed.set('xl/workbook.xml', renamed.get('xl/workbook.xml').toString().replace('name="Requirements"', 'name="需求"'))
  assert.throws(() => decodeRequirementsXlsx(writeXlsxZip(renamed)), /missing\/duplicate Requirements sheet/)
})
test('headers, digests, unknown identities and the pre-trim layout are rejected', () => {
  const b = encodeRequirementsXlsx(sample())
  for (const [file, from, to] of [[main, '>负责人<', '>证据<'], [main, 'REQ-001', 'REQ-999'], ['xl/worksheets/sheet3.xml', '>sha256<', '>SHA256<']]) {
    assert.throws(() => decodeRequirementsXlsx(change(b, file, s => s.replace(from, to))), /XLSX/)
  }
  // A workbook exported before the first row and three columns were removed.
  const legacy = change(b, main, s => s.replace('<row r="1">', '<row r="1"><c r="A1" t="inlineStr"><is><t>alm.requirements.exchange/v1</t></is></c><c r="B1" t="inlineStr"><is><t>x</t></is></c><c r="C1" t="inlineStr"><is><t>project-1</t></is></c><c r="D1" t="inlineStr"><is><t>digest</t></is></c></row><row r="1">'))
  assert.throws(() => decodeRequirementsXlsx(legacy), /legacy workbook layout/)
})
test('formula cells, external relationships, macros, DTD and corrupt ZIP rejected', () => {
  const b = encodeRequirementsXlsx(sample())
  assert.throws(() => decodeRequirementsXlsx(change(b, main, s => s.replace('<is>', '<f>1+1</f><is>'))), /formula/)
  assert.throws(() => decodeRequirementsXlsx(change(b, 'xl/_rels/workbook.xml.rels', s => s.replace('Target="worksheets/sheet1.xml"', 'TargetMode="External" Target="https://evil.test/a"'))), /external/)
  assert.throws(() => decodeRequirementsXlsx(change(b, main, s => '<!DOCTYPE worksheet [<!ENTITY a "b">]>' + s)), /DTD/)
  const files = readXlsxZip(b); files.set('xl/vbaProject.bin', 'macro')
  assert.throws(() => decodeRequirementsXlsx(writeXlsxZip(files)), /binary\/macro/)
  const broken = Buffer.from(b); broken[100] ^= 1
  assert.throws(() => decodeRequirementsXlsx(broken), /CRC|ZIP/)
  assert.throws(() => decodeRequirementsXlsx(b.subarray(0, 100)), /ZIP/)
})
test('shared-string cells written by spreadsheet editors are accepted', () => {
  const files = readXlsxZip(encodeRequirementsXlsx(sample()))
  files.set('xl/sharedStrings.xml', '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>编辑器标题</t></si></sst>')
  files.set(main, files.get(main).toString().replace('<c r="C2" t="inlineStr"><is><t xml:space="preserve">中文需求</t></is></c>', '<c r="C2" t="s"><v>0</v></c>'))
  assert.equal(decodeRequirementsXlsx(writeXlsxZip(files)).records[0].values.title, '编辑器标题')
})
test('ZIP duplicate paths, traversal, overlap and inflated-size bombs rejected', () => {
  const b = encodeRequirementsXlsx(sample())
  const files = readXlsxZip(b); files.set('../evil.xml', '<evil/>')
  assert.throws(() => decodeRequirementsXlsx(writeXlsxZip(files)), /unsafe/)
  const bomb = Buffer.from(b)
  const central = bomb.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  bomb.writeUInt32LE(33 * 1024 * 1024, central + 24)
  assert.throws(() => decodeRequirementsXlsx(bomb), /expanded/)
  const flags = Buffer.from(b); flags.writeUInt16LE(0x801, central + 8)
  assert.throws(() => decodeRequirementsXlsx(flags), /flags/)
})
test('directory entries and backslash separators written by Excel/WPS are accepted', () => {
  const directoryEntries = readXlsxZip(encodeRequirementsXlsx(sample()))
  for (const dir of ['_rels/', 'docProps/', 'xl/', 'xl/worksheets/', 'xl/theme/']) directoryEntries.set(dir, '')
  assert.deepEqual(decodeRequirementsXlsx(writeXlsxZip(directoryEntries)), sample())
  // Some Windows producers keep the separator in part names.
  const windows = new Map([...readXlsxZip(encodeRequirementsXlsx(sample()))].map(([name, body]) => [name.replaceAll('/', '\\'), body]))
  assert.deepEqual(decodeRequirementsXlsx(writeXlsxZip(windows)), sample())
  // A directory entry that claims a payload is still refused.
  const lying = readXlsxZip(encodeRequirementsXlsx(sample())); lying.set('xl/', 'payload')
  assert.throws(() => decodeRequirementsXlsx(writeXlsxZip(lying)), /directory ZIP entry with content/)
})
test('a renamed csv/text file is reported as not an xlsx package', () => {
  assert.throws(() => decodeRequirementsXlsx(Buffer.from('version,title\n1,something long enough\n')), /not a valid \.xlsx package/)
})
test('Markdown brief lists are plain strings; formula-like inputs are rejected', () => {
  const p = sample(); p.records[0].values.brief = '- first\n- second'
  assert.deepEqual(decodeRequirementsXlsx(encodeRequirementsXlsx(p)), p)
  for (const v of ['=1+1', '+cmd', '@SUM(A1)', '-cmd']) {
    p.records[0].values.brief = v
    assert.throws(() => encodeRequirementsXlsx(p), /formula/)
  }
})
test('resource limits fail explicitly, no truncation', () => {
  assert.throws(() => decodeRequirementsXlsx(Buffer.alloc(8 * 1024 * 1024 + 1)), /8 MiB/)
  const p = sample(); p.records[0].values.brief = 'x'.repeat(1024 * 1024 + 1)
  assert.throws(() => encodeRequirementsXlsx(p), /brief exceeds/)
  const many = sample(); many.records = Array.from({ length: 1001 }, () => sample().records[0])
  assert.throws(() => encodeRequirementsXlsx(many), /1000/)
})
test('create records survive a round trip and duplicated exported rows are rejected', () => {
  const p = sample(); p.records.push({ operation: 'create', clientId: 'new-1', projectId: 'project-1', values: { title: '新建', brief: '', priority: 'P2', owner: '' }, attachments: [] })
  const result = decodeRequirementsXlsx(encodeRequirementsXlsx(p))
  assert.equal(result.records[2].operation, 'create')
  assert.deepEqual(result.records[2].values, { title: '新建', brief: '', priority: 'P2', owner: '' })
  const dup = change(encodeRequirementsXlsx(p), main, s => s.replace('</sheetData>', s.match(/<row r="2">[\s\S]*?<\/row>/)[0] + '</sheetData>'))
  assert.throws(() => decodeRequirementsXlsx(dup), /duplicated/)
})
