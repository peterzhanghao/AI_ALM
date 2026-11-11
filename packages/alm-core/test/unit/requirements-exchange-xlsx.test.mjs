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
function appendRows(buffer, rows) {
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  return change(buffer, main, s => s.replace('</sheetData>', rows.map((values, i) => `<row r="${5 + i}">${values.map((v, j) => `<c r="${String.fromCharCode(65 + j)}${5 + i}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`).join('')}</row>`).join('') + '</sheetData>'))
}
test('external appended explicit creates need no preexisting metadata or proof', () => {
  const b = appendRows(encodeRequirementsXlsx(sample()), [
    ['create', '', 'external-1', 'project-1', '', '中文需求', '新正文', 'P2', ''],
    ['create', '', 'external-2', 'project-1', '', '中文需求', '', 'P1', 'owner'],
  ])
  const result = decodeRequirementsXlsx(b)
  assert.equal(result.records.length, 4)
  assert.deepEqual(result.records[2], { operation: 'create', clientId: 'external-1', projectId: 'project-1', values: { title: '中文需求', brief: '新正文', priority: 'P2', owner: '' }, attachments: [] })
  assert.equal(result.records[3].values.title, result.records[2].values.title)
  assert.equal(result.records[3].uid, undefined)
})
test('appended rows reject guessed updates, project/UID/base injection and duplicate client IDs', () => {
  const b = encodeRequirementsXlsx(sample())
  for (const [column, value] of [[0, 'update'], [1, 'REQ-001'], [2, ''], [2, '   '], [3, 'wrong-project'], [4, 'fake-base']]) {
    const row = ['create', '', 'external-1', 'project-1', '', 'New', '', 'P2', '']; row[column] = value
    assert.throws(() => decodeRequirementsXlsx(appendRows(b, [row])), /identity|create/)
  }
  const row = ['create', '', 'duplicate', 'project-1', '', 'New', '', 'P2', '']
  assert.throws(() => decodeRequirementsXlsx(appendRows(b, [row, row])), /identity|create/)
  const p = sample(); p.records.push({ operation: 'create', clientId: 'reserved', projectId: 'project-1', values: { title: 'Old', brief: '', priority: 'P2', owner: '' }, attachments: [] })
  const shadow = ['create', '', 'reserved', 'project-1', '', 'New', '', 'P2', '']
  assert.throws(() => decodeRequirementsXlsx(appendRows(encodeRequirementsXlsx(p), [shadow])), /duplicated/)
})

test('an existing update row cannot be relabeled into an appended create', () => {
  const b = change(encodeRequirementsXlsx(sample()), main, s => s.replace(/<row r="3">[\s\S]*?<\/row>/, '<row r="3"><c r="A3" t="inlineStr"><is><t>create</t></is></c><c r="C3" t="inlineStr"><is><t>injected</t></is></c><c r="D3" t="inlineStr"><is><t>project-1</t></is></c><c r="F3" t="inlineStr"><is><t>New</t></is></c><c r="H3" t="inlineStr"><is><t>P2</t></is></c></row>'))
  assert.throws(() => decodeRequirementsXlsx(b), /read-only/)
})
test('real ZIP/OOXML lossless Chinese, multiline, null, empty and opaque proofs', () => {
  const payload = sample(), bytes = encodeRequirementsXlsx(payload)
  assert.equal(bytes.subarray(0, 2).toString(), 'PK')
  assert.ok(readXlsxZip(bytes).has('[Content_Types].xml'))
  assert.deepEqual(decodeRequirementsXlsx(bytes), payload)
})
test('editable four fields apply, preserving identity and base', () => {
  const p = sample()
  const b = change(encodeRequirementsXlsx(p), main, s => s.replace('r="F3" t="inlineStr"><is><t xml:space="preserve">中文需求', 'r="F3" t="inlineStr"><is><t xml:space="preserve">外部标题').replace('r="H3" t="inlineStr"><is><t xml:space="preserve">P2', 'r="H3" t="inlineStr"><is><t xml:space="preserve">P0'))
  const result = decodeRequirementsXlsx(b)
  assert.equal(result.records[0].values.title, '外部标题')
  assert.equal(result.records[0].values.priority, 'P0')
  assert.deepEqual(result.records[0].base, p.records[0].base)
  assert.equal(result.records[0].proof, 'signed')
})
test('deleted worksheet rows are omitted, never converted into deletes', () => {
  const b = change(encodeRequirementsXlsx(sample()), main, s => s.replace(/<row r="3">[\s\S]*?<\/row>/, ''))
  assert.deepEqual(decodeRequirementsXlsx(b).records.map(r => r.uid), ['REQ-002'])
})
test('large brief chunk sheet preserves Unicode without exceeding Excel cell limits', () => {
  const p = sample(); p.records[0].values.brief = '中文😀\n'.repeat(10000)
  assert.deepEqual(decodeRequirementsXlsx(encodeRequirementsXlsx(p)), p)
  const b = change(encodeRequirementsXlsx(p), 'xl/worksheets/sheet2.xml', s => s.replace('中文', '修改'))
  assert.ok(decodeRequirementsXlsx(b).records[0].values.brief.includes('修改'))
})
test('read-only metadata, baseline hash, identities, headers and digest tampering rejected', () => {
  const b = encodeRequirementsXlsx(sample())
  for (const [file, from, to] of [[main, 'export-1', 'export-2'], [main, 'REQ-001', 'REQ-999'], [main, 'hash-1', 'forged'], [main, '>owner<', '>evidence<'], ['xl/worksheets/sheet3.xml', '>sha256<', '>SHA256<']]) {
    assert.throws(() => decodeRequirementsXlsx(change(b, file, s => s.replace(from, to))), /XLSX/)
  }
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
  files.set(main, files.get(main).toString().replace('<c r="F3" t="inlineStr"><is><t xml:space="preserve">中文需求</t></is></c>', '<c r="F3" t="s"><v>0</v></c>'))
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
test('explicit create records survive, duplicate worksheet identities rejected', () => {
  const p = sample(); p.records.push({ operation: 'create', clientId: 'new-1', projectId: 'project-1', values: { title: '新建', brief: '', priority: 'P2', owner: '' }, attachments: [] })
  assert.deepEqual(decodeRequirementsXlsx(encodeRequirementsXlsx(p)), p)
  const b = change(encodeRequirementsXlsx(p), main, s => s.replace('</sheetData>', s.match(/<row r="3">[\s\S]*?<\/row>/)[0] + '</sheetData>'))
  assert.throws(() => decodeRequirementsXlsx(b), /duplicated/)
})
