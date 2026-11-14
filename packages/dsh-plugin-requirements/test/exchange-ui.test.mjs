import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')
const modalStart = source.indexOf('    function ExchangeModal(')
const modalEnd = source.indexOf('    const NATIVE_SOURCE_BUILD_ID', modalStart)
const modal = source.slice(modalStart, modalEnd)

test('AC-01/AC-03: the exchange dialog offers a silent key and Excel-only export', () => {
  assert.ok(modalStart > 0 && modalEnd > modalStart)
  assert.doesNotMatch(modal, /初始化交换|action: 'initialize'/)
  assert.doesNotMatch(modal, /导出JSON|download\('json'\)|导出 JSON/)
  assert.match(modal, /导出 Excel \(\.xlsx\)/)
  assert.match(modal, /需求文件交换/)
  // AC-03: both scopes stay available.
  assert.match(modal, /全部需求/)
  assert.match(modal, /当前筛选结果/)
  assert.match(modal, /\{ uids \}/)
})

test('AC-02: Escape is swallowed and only the explicit close button closes the dialog', () => {
  assert.match(modal, /useDialogFocus\(dialogRef, onClose, \{ closeOnEscape: false \}\)/)
  assert.match(modal, /data-exchange-close/)
  const focusStart = source.indexOf('    function useDialogFocus(')
  const focusEnd = source.indexOf('    function SnapshotModal(', focusStart)
  const helper = source.slice(focusStart, focusEnd)
  assert.match(helper, /if \(!closeOnEscape\) \{ event\.stopPropagation\(\); return \}/)
  assert.match(helper, /closeOnEscape = true/)
})

test('AC-04: the import card parses dropped files and lists per-field changes', () => {
  assert.match(modal, /data-exchange-dropzone/)
  assert.match(modal, /onDrop/)
  assert.match(modal, /accept: '\.xlsx,\.json'/)
  assert.match(modal, /🟢 新增/)
  assert.match(modal, /🟡 更新/)
  assert.match(modal, /🔴 冲突/)
  assert.match(modal, /修改字段：\$\{EXCHANGE_FIELD_TEXT\(change\.fields\)\}/)
  assert.match(modal, /冲突字段：\$\{EXCHANGE_FIELD_TEXT\(group\.fields\)\}/)
  assert.match(modal, /data-exchange-apply[^]*?确认导入/)
  assert.match(modal, /disabled: busy \|\| !preview\.ok/)
})

test('AC-05: the import card ships a downloadable Excel template and fill-in rules', () => {
  assert.match(modal, /data-exchange-template/)
  assert.match(modal, /下载导入模板 \(\.xlsx\)/)
  assert.match(modal, /request\(\{ action: 'template' \}\)/)
  assert.match(modal, /suggestedName: 'requirements-template\.xlsx'/)
  // The template only ever creates; editing existing requirements needs a baseline.
  assert.match(modal, /模板只用于新增/)
  assert.match(modal, /填写规则/)
  assert.match(modal, /「需求编号」留空并填写标题/)
  assert.match(modal, /P0–P3/)
  assert.doesNotMatch(modal, /附件仅含manifest/)
})

test('primary actions keep a readable foreground instead of brand-token white-on-white', () => {
  // Regression: the CTA rendered as a white box with invisible white text.
  assert.doesNotMatch(modal, /color: '#fff'/)
  assert.match(modal, /const primaryButton = \{[^}]*color: T\.base, background: T\.text/)
  assert.match(modal, /data-exchange-export-action/)
  assert.match(modal, /ActionIcon, \{ name: 'download'/)
  // A host that is still running the old module has to say so, not just fail.
  assert.match(modal, /宿主插件 \$\{hostBuild\} 未更新：请完全退出并重启 DSH Desktop/)
})

test('domain errors are translated into an actionable Chinese next step', () => {
  const start = source.indexOf('    const EXCHANGE_ERROR_HINTS')
  const end = source.indexOf('    function ExchangeModal(', start)
  const context = {}
  vm.createContext(context)
  vm.runInContext(source.slice(start, end) + '\nthis.hint = exchangeErrorHint', context)
  assert.match(context.hint('file rejected: missing metadata digest'), /不是由「导出 Excel」/)
  assert.match(context.hint('unknown requirement in worksheet: REQ-9'), /「需求编号」不在本次导出里/)
  assert.match(context.hint('read-only record identity changed/duplicated'), /出现了两次/)
  assert.match(context.hint('create identity already used for different content'), /重新导出/)
  assert.match(context.hint('stale-preview'), /重新选择文件预览/)
  // A WPS/Excel re-save is a structural error, not a dead end: say so and how.
  assert.match(context.hint('Invalid requirements XLSX: unsafe ZIP path'), /另存为 → Excel 工作簿/)
  assert.match(context.hint('Invalid requirements XLSX: not a valid .xlsx package (missing ZIP signature)'), /不是 \.xlsx 工作簿/)
  assert.match(context.hint('Invalid requirements XLSX: unexpected worksheet column'), /只保留「需求编号 \/ 项目 \/ 标题/)
  assert.match(context.hint('Invalid requirements XLSX: macros forbidden'), /含宏、外部链接或超链接/)
  assert.match(context.hint('Invalid requirements XLSX: missing/duplicate _Metadata sheet'), /保留「Requirements」和隐藏的「_Metadata」/)
  // A deleted Brief tab is not an error any more: it only carries long-brief chunks.
  assert.doesNotMatch(context.hint('Invalid requirements XLSX: missing/duplicate _Metadata sheet'), /Brief」三张表/)
  assert.match(context.hint('Invalid requirements XLSX: read-only header changed'), /表头被改动了/)
  assert.match(context.hint('file rejected: invalid JSON: Unexpected token } in JSON at position 9'), /JSON 文件解析失败/)
  // Unrecognised parser output still ends with a remedy, never bare English.
  const unknownXlsx = context.hint('Invalid requirements XLSX: something new happened')
  assert.match(unknownXlsx, /重新下载导入模板/)
  assert.match(unknownXlsx, /技术信息：something new happened/)
  assert.equal(context.hint('未知的内部错误'), '未知的内部错误')
  assert.equal(context.hint(''), '操作失败，请重试。')
})

test('preview summary counts records and groups conflict fields per requirement', () => {
  const start = source.indexOf('    const EXCHANGE_FIELD_LABELS')
  const end = source.indexOf('    function ExchangeModal(', start)
  const context = {}
  vm.createContext(context)
  vm.runInContext(source.slice(start, end) + '\nthis.summary = exchangePreviewSummary; this.labels = EXCHANGE_FIELD_TEXT;', context)
  const summary = context.summary({
    changes: [
      { uid: 'REQ-ALM-003', operation: 'create', title: '新需求', fields: ['title', 'brief', 'priority', 'owner'] },
      { uid: 'REQ-ALM-001', operation: 'update', title: '旧需求', fields: ['owner'] },
    ],
    conflicts: [
      { uid: 'REQ-ALM-002', field: 'title', title: '冲突需求' },
      { uid: 'REQ-ALM-002', field: 'brief', title: '冲突需求' },
      { uid: 'REQ-ALM-004', field: 'priority', title: '另一条' },
    ],
  })
  assert.equal(summary.creates.length, 1)
  assert.equal(summary.updates.length, 1)
  assert.equal(summary.conflicts.length, 2)
  assert.deepEqual(JSON.parse(JSON.stringify(summary.conflicts[0])), { uid: 'REQ-ALM-002', title: '冲突需求', fields: ['title', 'brief'] })
  assert.deepEqual(JSON.parse(JSON.stringify(summary.conflicts[1].fields)), ['priority'])
  assert.equal(context.summary(null).conflicts.length, 0)
  assert.equal(context.labels(['title', 'brief', 'owner']), '标题、需求描述、负责人')
})
