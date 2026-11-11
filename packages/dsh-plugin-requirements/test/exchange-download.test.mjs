import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')
const start = source.indexOf('    async function saveExchangeFile(')
const end = source.indexOf('    function ExchangeModal(', start)
function harness({ picker = true, failure, format = 'json', corrupt = false } = {}) {
  const calls = [], timers = []
  const data = Buffer.from(format === 'json' ? '{"title":"中文\\n正文"}' : 'PK\u0003\u0004binary\u0000')
  const writable = {
    async write(blob) { calls.push('write'); assert.deepEqual(Buffer.from(await blob.arrayBuffer()), data); if (failure === 'write') throw new Error('disk full') },
    async close() { calls.push('close'); if (failure === 'close') throw new Error('close failed') },
    async abort() { calls.push('abort') },
  }
  const link = { style: {}, click() { calls.push('click'); if (failure === 'click') throw new Error('click failed') }, remove() { calls.push('remove') } }
  const context = {
    window: picker ? { showSaveFilePicker(options) { calls.push(['picker', options]); if (failure === 'cancel') return Promise.reject(Object.assign(new Error('cancel'), { name: 'AbortError' })); if (failure === 'picker') throw new Error('picker denied'); return Promise.resolve({ name: `saved.${format}`, async createWritable() { calls.push('createWritable'); return writable } }) } } : {},
    Blob, Uint8Array, atob, Number,
    URL: { createObjectURL() { calls.push('url'); return 'blob:exchange' }, revokeObjectURL() { calls.push('revoke') } },
    document: { createElement() { return link }, body: { appendChild() { calls.push('append') } } },
    setTimeout(fn, ms) { timers.push({ fn, ms }) },
  }
  vm.createContext(context)
  vm.runInContext(source.slice(start, end) + '\nthis.save = saveExchangeFile', context)
  const request = async body => {
    calls.push('request'); assert.equal(body.action, 'export'); assert.equal(body.format, format)
    if (failure === 'request') throw new Error('HTTP 401')
    return { filename: `requirements-XCH.${format}`, mime: format === 'json' ? 'application/json' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', content: data.toString('base64'), bytes: data.length + (corrupt ? 1 : 0) }
  }
  return { calls, timers, link, save: () => context.save(format, request) }
}
for (const format of ['json', 'xlsx']) {
  test(`exchange ${format}: picker invoked synchronously, success only after write and close`, async () => {
    const h = harness({ format }); const pending = h.save()
    assert.equal(h.calls[0][0], 'picker'); assert.equal(h.calls.length, 1)
    const result = await pending
    assert.deepEqual(h.calls.slice(1), ['request', 'createWritable', 'write', 'close'])
    assert.match(result.message, /已保存 saved/); assert.equal(h.timers.length, 0)
    assert.equal(h.calls[0][1].suggestedName, `requirements.${format}`)
  })
  test(`exchange ${format}: Blob handoff retains node and URL, never claims saved`, async () => {
    const h = harness({ picker: false, format }); const result = await h.save()
    assert.deepEqual(h.calls, ['request', 'url', 'append', 'click'])
    assert.equal(h.link.download, `requirements-XCH.${format}`)
    assert.match(result.message, /已发起下载/); assert.match(result.message, /尚未确认落盘/); assert.doesNotMatch(result.message, /已保存|已导出/)
    assert.equal(h.timers[0].ms, 60000); h.timers[0].fn()
    assert.deepEqual(h.calls.slice(-2), ['remove', 'revoke'])
  })
}
test('cancel picker: no export request or fallback download', async () => {
  const h = harness({ failure: 'cancel' }); assert.match((await h.save()).message, /已取消/)
  assert.equal(h.calls.length, 1); assert.equal(h.timers.length, 0)
})
for (const failure of ['picker', 'request', 'write', 'close']) {
  test(`exchange ${failure} failure: rejects without success receipt or Blob fallback`, async () => {
    const h = harness({ failure }); await assert.rejects(h.save())
    assert.ok(!h.calls.includes('click')); assert.equal(h.timers.length, 0)
    if (['write', 'close'].includes(failure)) assert.equal(h.calls.at(-1), 'abort')
  })
}
test('byte mismatch fails before touching writable or Blob URL', async () => {
  const h = harness({ corrupt: true }); await assert.rejects(h.save(), /字节数或类型不匹配/)
  assert.equal(h.calls.includes('createWritable'), false); assert.equal(h.calls.includes('url'), false)
})
test('ExchangeModal routes both buttons through save helper and clears stale receipt first', () => {
  const modal = source.slice(end, source.indexOf('    function Workbench(', end))
  assert.match(modal, /setReceipt\(null\)\s+setReceipt\(await saveExchangeFile\(format, request\)\)/)
  assert.match(modal, /download\('json'\)/); assert.match(modal, /download\('xlsx'\)/)
  assert.doesNotMatch(modal, /createObjectURL|已导出/)
})
test('Blob click failure cleans resources and rejects', async () => {
  const h = harness({ picker: false, failure: 'click' }); await assert.rejects(h.save(), /click failed/)
  assert.deepEqual(h.calls.slice(-2), ['remove', 'revoke']); assert.equal(h.timers.length, 0)
})
