import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initializeRequirementsExchange, exportRequirements, previewRequirementsImport, applyRequirementsImport, requirementsTemplateExport } from '../../src/requirements/exchange.mjs'
import { encodeRequirementsXlsx, decodeRequirementsXlsx } from '../../src/requirements/exchange-xlsx.mjs'
import { readXlsxZip, writeXlsxZip } from '../../src/requirements/exchange-zip.mjs'
import { createRequirement, planRequirement } from '../../src/requirements/create.mjs'
import { normalizeAsset } from '../../src/model/asset.mjs'
const clone = x => structuredClone(x)
function fixture(t) {
  const root = fs.mkdtempSync(join(tmpdir(), 'alm-exchange-unit-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.mkdirSync(join(root, '.alm'))
  fs.writeFileSync(join(root, '.alm/project.json'), JSON.stringify({ schema: 'alm.project/v1', id: 'ALM', name: 'Exchange unit', requirementRoot: 'requirements', github: { owner: 'test', repo: 'test' } }))
  for (let n = 1; n <= 2; n++) createRequirement({ root, id: `REQ-ALM-00${n}`, title: `中文需求${n}`, brief: `多行\n第二行${n}`, priority: 'P2', owner: '', apply: true })
  return root
}
function digest(root) {
  const h = createHash('sha256')
  function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(dir, e.name)
      h.update(p.slice(root.length))
      if (e.isDirectory()) walk(p)
      else h.update(fs.readFileSync(p))
    }
  }
  walk(root)
  return h.digest('hex')
}
function apply(root, payload) {
  const p = previewRequirementsImport({ root, payload })
  assert.equal(p.ok, true)
  return applyRequirementsImport({ root, payload, expectedLocalHash: p.localHash })
}
function exported(root) { return exportRequirements({ root, format: 'json' }) }
function rejectUnchanged(root, payload) {
  const before = digest(root)
  assert.throws(() => {
    const p = previewRequirementsImport({ root, payload })
    applyRequirementsImport({ root, payload, expectedLocalHash: p.localHash })
  })
  assert.equal(digest(root), before)
}

test('first export provisions the project key silently and later exports reuse it', async t => {
  const root = fixture(t)
  fs.rmSync(join(root, '.alm/exchange/key'))
  const before = digest(root)
  const p = exported(root)
  assert.equal(p.records.length, 2)
  assert.notEqual(digest(root), before)
  const key = fs.readFileSync(join(root, '.alm/exchange/key'), 'utf8')
  assert.match(key, /^[0-9a-f]{64}$/)
  const initialized = digest(root)
  assert.equal(exported(root).records.length, 2)
  assert.equal(fs.readFileSync(join(root, '.alm/exchange/key'), 'utf8'), key)
  assert.equal(digest(root), initialized)
  const module = new URL('../../src/requirements/exchange.mjs', import.meta.url)
  module.search = `fresh=${Math.random()}`
  const fresh = await import(module.href)
  assert.equal(fresh.previewRequirementsImport({ root, payload: p }).ok, true)
  assert.equal(digest(root), initialized)
  p.records[0].base.title = 'forged'
  p.records[0].baseHash = createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(p.records[0].base).sort(([a], [b]) => a.localeCompare(b))))).digest('hex')
  assert.throws(() => fresh.previewRequirementsImport({ root, payload: p }), { code: 'invalid-provenance' })
  assert.equal(digest(root), initialized)
})
test('a create-only batch never needs the signing key and never writes one', t => {
  const root = fixture(t)
  fs.rmSync(join(root, '.alm/exchange/key'))
  const before = digest(root)
  const preview = previewRequirementsImport({ root, payload: { schema: 'alm.requirements.exchange/v1', exportId: 'create-only', projectId: 'ALM', records: [{ operation: 'create', clientId: 'row-1', projectId: 'ALM', values: { title: '新建', brief: '', priority: 'P2', owner: '' }, attachments: [] }] } })
  assert.equal(preview.ok, true)
  assert.equal(preview.changes[0].operation, 'create')
  assert.equal(fs.existsSync(join(root, '.alm/exchange/key')), false)
  assert.equal(digest(root), before)
})
test('initialization rejects lock, crash journal and corrupt key without writes', t => {
  const root = fixture(t), key = join(root, '.alm/exchange/key')
  fs.rmSync(key)
  fs.writeFileSync(join(root, '.alm/exchange.lock'), 'busy')
  let before = digest(root)
  assert.throws(() => initializeRequirementsExchange({ root }), { code: 'exchange-locked' })
  assert.equal(digest(root), before)
  fs.rmSync(join(root, '.alm/exchange.lock'))
  fs.writeFileSync(join(root, '.alm/exchange/transaction.json'), '{}')
  before = digest(root)
  assert.throws(() => initializeRequirementsExchange({ root }), { code: 'recovery-required' })
  assert.equal(digest(root), before)
  fs.rmSync(join(root, '.alm/exchange/transaction.json'))
  fs.writeFileSync(key, 'corrupt')
  before = digest(root)
  assert.throws(() => initializeRequirementsExchange({ root }), { code: 'invalid-key' })
  assert.equal(digest(root), before)
})
test('initialization rename failure restores original tree and can retry', t => {
  const root = fixture(t)
  fs.rmSync(join(root, '.alm/exchange'), { recursive: true })
  const before = digest(root)
  t.mock.method(fs, 'renameSync', () => { throw new Error('init rename failure') })
  syncBuiltinESMExports()
  try { assert.throws(() => initializeRequirementsExchange({ root }), /init rename failure/) }
  finally { t.mock.restoreAll(); syncBuiltinESMExports() }
  assert.equal(digest(root), before)
  assert.equal(initializeRequirementsExchange({ root }).created, true)
})
test('create plan never initializes; apply provisions durable provenance before first export', t => {
  const root = fixture(t)
  fs.rmSync(join(root, '.alm/exchange/key'))
  const before = digest(root)
  createRequirement({ root, id: 'REQ-ALM-003', title: 'planned only' })
  assert.equal(digest(root), before)
  createRequirement({ root, id: 'REQ-ALM-003', title: 'apply initializes', apply: true })
  assert.match(fs.readFileSync(join(root, '.alm/exchange/key'), 'utf8'), /^[0-9a-f]{64}$/)
  assert.equal(exported(root).records.length, 3)
})
test('explicit empty owner is preserved; omitted owner keeps previous default', t => {
  const root = fixture(t)
  assert.equal(exported(root).records[0].values.owner, '')
  const p = planRequirement({ root, id: 'REQ-ALM-003', title: 'default' })
  assert.match(p.content, /OWNER: team-pay/)
})
test('asset model accepts explicit empty owner but rejects missing or nonstring owner', () => {
  const raw = { schema_version: 1, id: 'REQ-ALM-001', type: 'requirement', title: 'empty owner', owner: '', links: [] }
  assert.equal(normalizeAsset(raw, { path: 'test.sdoc' }).owner, '')
  for (const owner of [undefined, null, 42]) assert.throws(() => normalizeAsset({ ...raw, owner }, { path: 'test.sdoc' }), /missing or invalid field: owner/)
})
test('legacy requirements without PROJECT derive identity from UID; explicit wrong project rejects', t => {
  const root = fixture(t), path = join(root, 'requirements/req-alm-001.sdoc')
  const original = fs.readFileSync(path, 'utf8')
  fs.writeFileSync(path, original.replace('PROJECT: ALM\n', ''))
  assert.equal(exported(root).records.length, 2)
  fs.writeFileSync(path, original.replace('PROJECT: ALM', 'PROJECT: OTHER'))
  assert.throws(() => exported(root), /project mismatch/)
})
test('Markdown heading and list are literal values, not formula false positives', t => {
  const root = fixture(t), p = exported(root)
  p.records[0].values.brief = '- Markdown列表\n# 标题\n中文内容'
  apply(root, p)
  assert.equal(exported(root).records[0].values.brief, p.records[0].values.brief)
})
test('export, preview and unchanged apply are byte-readonly; Chinese multiline retained', t => {
  const root = fixture(t), before = digest(root), p = exported(root)
  assert.equal(p.records.length, 2)
  assert.match(p.records[0].values.brief, /第二行1/)
  assert.equal(digest(root), before)
  assert.equal(previewRequirementsImport({ root, payload: p }).ok, true)
  assert.equal(digest(root), before)
  assert.equal(apply(root, p).idempotent, true)
  assert.equal(digest(root), before)
})
test('different-field three-way merge; missing rows do not delete; repeated batch is readonly', t => {
  const root = fixture(t), base = exported(root), local = clone(base), external = clone(base)
  local.records[0].values.owner = '本地负责人'
  apply(root, local)
  external.records = [external.records[0]]
  external.records[0].values.title = '外部标题'
  apply(root, external)
  const now = exported(root)
  assert.equal(now.records.length, 2)
  assert.equal(now.records[0].values.owner, '本地负责人')
  assert.equal(now.records[0].values.title, '外部标题')
  const before = digest(root)
  assert.equal(apply(root, external).idempotent, true)
  assert.equal(digest(root), before)
})
test('same-field conflict rejects every record and metadata; stale CAS rejects', t => {
  const root = fixture(t), base = exported(root), local = clone(base), external = clone(base)
  local.records[0].values.title = '本地'
  apply(root, local)
  external.records[0].values.title = '外部'
  external.records[1].values.owner = '不得写入'
  assert.equal(previewRequirementsImport({ root, payload: external }).ok, false)
  rejectUnchanged(root, external)
  const next = exported(root); next.records[0].values.priority = 'P3'
  const preview = previewRequirementsImport({ root, payload: next })
  fs.appendFileSync(join(root, 'requirements/req-alm-002.sdoc'), '\n# concurrent change\n')
  const before = digest(root)
  assert.throws(() => applyRequirementsImport({ root, payload: next, expectedLocalHash: preview.localHash }), { code: 'stale-preview' })
  assert.equal(digest(root), before)
})
for (const [name, mutate] of [
  ['project', p => { p.projectId = 'OTHER' }],
  ['schema', p => { p.schema = 'alm.requirements.exchange/v999' }],
  ['identity', p => { p.records[0].uid = p.records[1].uid }],
  ['baseline and recomputed hash', p => { p.records[0].base.title = 'forged'; p.records[0].baseHash = createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(p.records[0].base).sort(([a], [b]) => a.localeCompare(b))))).digest('hex') }],
  ['authority values', p => { p.records[0].values.receipt = { approved: true } }],
  ['authority row', p => { p.records[0].releaseAuthorization = true }],
  ['authority payload', p => { p.status = 'released' }],
  ['path escape', p => { p.records[0].attachments = [{ path: '../escape' }] }],
  ['absolute path', p => { p.records[0].attachments = [{ path: 'C:/escape' }] }],
  ['manifest tamper', p => { p.records[0].attachments = [{ path: 'safe.txt' }] }],
  ['field type', p => { p.records[0].values.owner = null }],
  ['formula equals', p => { p.records[0].values.title = '=HYPERLINK("evil")' }],
  ['formula prefix', p => { p.records[0].values.brief = '  +SUM(A1)' }],
  ['formula minus', p => { p.records[0].values.owner = '-cmd' }],
  ['line injection', p => { p.records[0].values.owner = 'x\nSTATUS: released' }],
  ['brief size', p => { p.records[0].values.brief = 'x'.repeat(1024 * 1024 + 1) }],
  ['duplicate', p => { p.records.push(clone(p.records[0])) }],
  ['implicit create', p => { p.records.push({ uid: 'REQ-ALM-099', projectId: 'ALM', values: clone(p.records[0].values), attachments: [] }) }],
]) test(`unsafe ${name} rejects byte-atomically`, t => {
  const root = fixture(t), p = exported(root)
  p.records[1].values.title = 'valid but must not write'
  mutate(p)
  rejectUnchanged(root, p)
})
test('explicit new rows receive local UIDs, P3/empty owner and exact brief; restart replay stays idempotent', async t => {
  const root = fixture(t), p = exported(root)
  p.records = [{ operation: 'create', clientId: 'new-row-1', projectId: 'ALM', values: { title: '新建', owner: '', priority: 'P3', brief: '原样\n中文正文' }, attachments: [{ path: 'requirements/attachments/reference.txt', name: 'reference' }] }]
  const result = apply(root, p)
  assert.equal(result.mappings['new-row-1'], 'REQ-ALM-003')
  const now = exported(root).records.find(r => r.uid === 'REQ-ALM-003')
  assert.deepEqual(now.values, p.records[0].values)
  assert.equal(now.attachments[0].name, 'reference')
  const before = digest(root)
  assert.equal(apply(root, p).idempotent, true)
  assert.equal(digest(root), before)
  const changed = clone(p); changed.records[0].values.title = 'different'
  rejectUnchanged(root, changed)
  await restartApply(root, p, true)
})
async function restartApply(root, payload, idempotent) {
  // A fresh module instance has no process-local key map, as on host restart.
  const module = new URL('../../src/requirements/exchange.mjs', import.meta.url)
  module.search = `instance=${Math.random()}`
  const api = await import(module.href)
  const p = api.previewRequirementsImport({ root, payload })
  const result = api.applyRequirementsImport({ root, payload, expectedLocalHash: p.localHash })
  assert.equal(result.idempotent, idempotent)
}
test('persistent initialized proof supports restart three-way merge and repeated replay', async t => {
  const root = fixture(t), base = exported(root), local = clone(base), external = clone(base)
  local.records[0].values.owner = 'local'
  apply(root, local)
  external.records[0].values.title = 'external'
  await restartApply(root, external, false)
  const before = digest(root)
  await restartApply(root, external, true)
  assert.equal(digest(root), before)
  const now = exported(root)
  assert.equal(now.records[0].values.owner, 'local')
  assert.equal(now.records[0].values.title, 'external')
})
test('ordinary mid-commit rename failure restores all bytes, key, journals and directories', t => {
  const root = fixture(t), p = exported(root)
  p.records[0].values.title = 'change first'
  p.records[1].values.brief = 'change second'
  const v = previewRequirementsImport({ root, payload: p }), before = digest(root)
  const original = fs.renameSync
  let count = 0
  t.mock.method(fs, 'renameSync', (...args) => {
    if (++count === 2) throw new Error('injected rename failure')
    return original(...args)
  })
  syncBuiltinESMExports()
  try { assert.throws(() => applyRequirementsImport({ root, payload: p, expectedLocalHash: v.localHash }), /injected rename failure/) }
  finally { t.mock.restoreAll(); syncBuiltinESMExports() }
  assert.equal(count, 2)
  assert.equal(digest(root), before)
  assert.equal(apply(root, p).applied, true)
})
test('export can be limited to the current filtered selection', t => {
  const root = fixture(t)
  const all = exported(root)
  const one = exportRequirements({ root, uids: ['REQ-ALM-002'] })
  assert.deepEqual(one.records.map(r => r.uid), ['REQ-ALM-002'])
  assert.equal(one.schema, all.schema)
  assert.equal(one.projectId, all.projectId)
  assert.deepEqual(exportRequirements({ root, uids: [] }).records, [])
  assert.throws(() => exportRequirements({ root, uids: ['REQ-ALM-999'] }), { code: 'unknown-requirement' })
  assert.throws(() => exportRequirements({ root, uids: 'REQ-ALM-001' }), { code: 'invalid-selection' })
  assert.throws(() => exportRequirements({ root, uids: [42] }), { code: 'invalid-selection' })
})
test('AC-05: the blank template is one example create, needs no key and imports as a create', t => {
  const root = fixture(t)
  const before = digest(root)
  const template = requirementsTemplateExport({ root })
  assert.equal(template.schema, 'alm.requirements.exchange/v1')
  assert.equal(template.projectId, 'ALM')
  assert.equal(template.records.length, 1)
  const [sample] = template.records
  assert.equal(sample.operation, 'create')
  assert.equal(sample.uid, undefined)
  assert.equal(sample.projectId, 'ALM')
  assert.match(sample.clientId, /^template-[a-z0-9]{8}$/)
  assert.equal(sample.values.priority, 'P2')
  // Preparing a template is read-only: nothing in the project is touched.
  assert.equal(digest(root), before)
  // AC-01: a create-only batch never provisions the signing key, so a brand-new
  // project can download a template and import it before any export exists.
  const keyFile = join(root, '.alm/exchange/key')
  fs.rmSync(join(root, '.alm/exchange'), { recursive: true, force: true })
  const roundTrip = decodeRequirementsXlsx(encodeRequirementsXlsx(template))
  assert.equal(roundTrip.records.length, 1)
  assert.deepEqual(roundTrip.records[0].values, template.records[0].values)
  assert.match(roundTrip.records[0].clientId, /^import-/)
  const preview = previewRequirementsImport({ root, payload: roundTrip })
  assert.equal(preview.ok, true)
  assert.deepEqual(preview.changes.map(c => [c.operation, c.uid]), [['create', 'REQ-ALM-003']])
  assert.equal(fs.existsSync(keyFile), false)
  applyRequirementsImport({ root, payload: roundTrip, expectedLocalHash: preview.localHash })
  assert.equal(fs.existsSync(join(root, 'requirements/req-alm-003.sdoc')), true)
  assert.equal(fs.existsSync(keyFile), false)
})
function rewriteHeader(bytes, names) {
  const files = readXlsxZip(bytes), path = 'xl/worksheets/sheet1.xml'
  let i = 0
  const xml = files.get(path).toString().replace(/(<c r="[A-F]1"[^>]*><is><t[^>]*>)[^<]*(<\/t>)/g, (match, open, close) => open + names[i++] + close)
  assert.equal(i, names.length)
  files.set(path, Buffer.from(xml))
  return writeXlsxZip(files)
}
test('AC-05: the worksheet is the six fill-in columns, header frozen on row one', t => {
  const root = fixture(t), base = exported(root), bytes = encodeRequirementsXlsx(base)
  const sheet = readXlsxZip(bytes).get('xl/worksheets/sheet1.xml').toString()
  const header = [...sheet.matchAll(/<c r="[A-F]1"[^>]*><is><t[^>]*>([^<]*)<\/t>/g)].map(m => m[1])
  assert.deepEqual(header, ['需求编号', '项目', '标题', '需求描述', '优先级', '负责人'])
  // The technical first row and the identity columns are gone.
  assert.equal((sheet.match(/<row /g) ?? []).length, base.records.length + 1)
  for (const gone of ['操作', '客户端标识', '基线哈希', 'exportId']) assert.equal(sheet.includes(gone), false)
  assert.match(sheet, /<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"\/>/)
  assert.deepEqual(decodeRequirementsXlsx(bytes).records, base.records)

  // Editing the four fill-in columns flows through preview and apply.
  const files = readXlsxZip(bytes), path = 'xl/worksheets/sheet1.xml'
  files.set(path, files.get(path).toString().replace('>中文需求1<', '>改过的标题<'))
  const preview = previewRequirementsImport({ root, payload: decodeRequirementsXlsx(writeXlsxZip(files)) })
  assert.equal(preview.ok, true)
  assert.deepEqual(preview.changes.map(c => [c.operation, c.uid, c.title]), [['update', 'REQ-ALM-001', '改过的标题']])

  // Renaming a header is a structural edit, not a label tweak.
  assert.throws(() => decodeRequirementsXlsx(rewriteHeader(bytes, ['需求编号', '项目', '名称', '需求描述', '优先级', '负责人'])), /read-only header changed/)
  // The blank template ships the same headers and one row awaiting a title edit.
  const template = readXlsxZip(encodeRequirementsXlsx(requirementsTemplateExport({ root }))).get('xl/worksheets/sheet1.xml').toString()
  assert.match(template, /<t xml:space="preserve">标题<\/t>/)
  assert.match(template, /<row r="2"><c r="A2" t="inlineStr"><is><t xml:space="preserve"><\/t>/)
})
test('preview reports per-record field changes and conflict fields for the diff panel', t => {
  const root = fixture(t), base = exported(root)
  const local = clone(base)
  local.records[0].values.title = '本地标题'
  apply(root, local)
  const external = clone(base)
  external.records[0].values.title = '外部标题'
  external.records[1].values.owner = '外部负责人'
  const preview = previewRequirementsImport({ root, payload: external })
  assert.equal(preview.ok, false)
  assert.deepEqual(preview.changes.map(c => ({ uid: c.uid, operation: c.operation, fields: c.fields, title: c.title })), [
    { uid: 'REQ-ALM-002', operation: 'update', fields: ['owner'], title: '中文需求2' },
  ])
  assert.deepEqual(preview.conflicts.map(c => ({ uid: c.uid, field: c.field, title: c.title })), [
    { uid: 'REQ-ALM-001', field: 'title', title: '本地标题' },
  ])
})
test('lock conflict and unfinished crash journal fail closed without writes', t => {
  const root = fixture(t), p = exported(root)
  p.records[0].values.title = 'new'
  const v = previewRequirementsImport({ root, payload: p })
  fs.writeFileSync(join(root, '.alm/exchange.lock'), 'another writer')
  const locked = digest(root)
  assert.throws(() => applyRequirementsImport({ root, payload: p, expectedLocalHash: v.localHash }), { code: 'exchange-locked' })
  assert.equal(digest(root), locked)
  fs.rmSync(join(root, '.alm/exchange.lock'))
  fs.mkdirSync(join(root, '.alm/exchange'), { recursive: true })
  fs.writeFileSync(join(root, '.alm/exchange/transaction.json'), '{}')
  const crashed = digest(root)
  assert.throws(() => previewRequirementsImport({ root, payload: p }), { code: 'recovery-required' })
  assert.equal(digest(root), crashed)
})
