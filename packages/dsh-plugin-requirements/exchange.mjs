import { initializeRequirementsExchange, exportRequirements, previewRequirementsImport, applyRequirementsImport, requirementsTemplateExport } from '../alm-core/src/requirements/exchange.mjs'
import { encodeRequirementsXlsx, decodeRequirementsXlsx } from '../alm-core/src/requirements/exchange-xlsx.mjs'

const MAX_FILE = 8 * 1024 * 1024
export const MAX_EXCHANGE_BODY = 12 * 1024 * 1024
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const fail = (message, code = 'invalid-exchange', status = 400) => { throw Object.assign(new Error(message), { code, status }) }

/**
 * Bumped whenever the host/client exchange contract changes. A running host
 * keeps the module it imported at boot, so an old build can silently reject a
 * format the page already offers; the dialog compares this stamp with its own
 * to make that mismatch visible instead.
 */
export const EXCHANGE_BUILD = 'v4.2026-11-16'

/**
 * AC-01: the product exchanges requirements through one editable Excel workbook
 * and the native JSON package produced by the same domain export. Both formats
 * are also importable, so a package written by another agent (or round-tripped
 * through this plugin) can be reviewed and merged.
 *
 * AC-05: `template` returns the same workbook shape with one sample create row,
 * so a first-time author can download a blank sheet instead of exporting data.
 */
export function exchangeRequest({ root, body }) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('request object required')
  const allowed = new Set(['action', 'format', 'filename', 'content', 'expectedLocalHash', 'uids'])
  for (const key of Object.keys(body)) if (!allowed.has(key)) fail(`unsupported request field: ${key}`)
  const { action, format } = body
  if (body.uids !== undefined && action !== 'export') fail('uids is only accepted for export')
  if (action === 'version') {
    if (Object.keys(body).some(key => key !== 'action')) fail('version only accepts action')
    return { ok: true, build: EXCHANGE_BUILD }
  }
  if (action === 'initialize') {
    if (Object.keys(body).some(key => key !== 'action')) fail('initialize only accepts action')
    return { ok: true, ...initializeRequirementsExchange({ root }) }
  }
  if (action === 'export') {
    // AC-01: exporting silently provisions the project key inside the domain
    // layer; there is no separate initialize step for humans.
    if (!['json', 'xlsx'].includes(format)) fail('导出只提供 JSON 交换包或 Excel（.xlsx）', 'unsupported-format', 415)
    const payload = exportRequirements({ root, uids: body.uids })
    if (format === 'json') {
      const bytes = Buffer.from(JSON.stringify(payload))
      if (bytes.length > MAX_FILE) fail('export exceeds 8 MiB file limit', 'file-too-large', 413)
      return { ok: true, build: EXCHANGE_BUILD, filename: `requirements-${payload.projectId}.json`, mime: 'application/json', content: bytes.toString('base64'), bytes: bytes.length }
    }
    const bytes = encodeRequirementsXlsx(payload)
    if (bytes.length > MAX_FILE) fail('export exceeds 8 MiB file limit', 'file-too-large', 413)
    return { ok: true, build: EXCHANGE_BUILD, filename: `requirements-${payload.projectId}.xlsx`, mime: XLSX_MIME, content: bytes.toString('base64'), bytes: bytes.length }
  }
  if (action === 'template') {
    // AC-05: the template is a read-only convenience for first-time authors. It
    // never provisions the signing key and never needs an export first.
    if (format !== undefined && format !== 'xlsx') fail('模板只提供 Excel（.xlsx）', 'unsupported-format', 415)
    const payload = requirementsTemplateExport({ root })
    const bytes = encodeRequirementsXlsx(payload)
    return { ok: true, build: EXCHANGE_BUILD, filename: `requirements-${payload.projectId}-template.xlsx`, mime: XLSX_MIME, content: bytes.toString('base64'), bytes: bytes.length, editable: ['title', 'brief', 'priority', 'owner'] }
  }
  if (!['json', 'xlsx'].includes(format)) fail('only JSON and .xlsx are supported', 'unsupported-format', 415)
  if (!['preview', 'apply'].includes(action)) fail('unknown exchange action')
  if (typeof body.filename !== 'string' || !body.filename.toLowerCase().endsWith(`.${format}`)) fail('filename does not match format', 'unsupported-format', 415)
  const { content } = body
  // A repeated four-character group can overflow V8's regex stack on large inputs.
  if (typeof content !== 'string' || content.length > Math.ceil(MAX_FILE / 3) * 4 || content.length % 4 !== 0 || !BASE64.test(content)) {
    fail('invalid or oversized base64 file', 'invalid-file')
  }
  const bytes = Buffer.from(content, 'base64')
  if (!bytes.length || bytes.length > MAX_FILE) fail('file must be between 1 byte and 8 MiB', 'file-too-large', 413)
  let payload
  try { payload = format === 'xlsx' ? decodeRequirementsXlsx(bytes) : JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
  catch (error) {
    if (error.code && error.status) throw error
    // Keep the two file families distinguishable so the UI can say what to fix:
    // a malformed JSON package is never a broken workbook.
    fail(`file rejected: ${format === 'json' ? 'invalid JSON: ' : ''}${error.message}`, 'invalid-file')
  }
  if (action === 'preview') return { build: EXCHANGE_BUILD, ...previewRequirementsImport({ root, payload }) }
  return { ok: true, build: EXCHANGE_BUILD, ...applyRequirementsImport({ root, payload, expectedLocalHash: body.expectedLocalHash }) }
}
