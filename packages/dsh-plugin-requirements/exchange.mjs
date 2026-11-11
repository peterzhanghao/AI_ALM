import { initializeRequirementsExchange, exportRequirements, previewRequirementsImport, applyRequirementsImport } from '../alm-core/src/requirements/exchange.mjs'
import { encodeRequirementsXlsx, decodeRequirementsXlsx } from '../alm-core/src/requirements/exchange-xlsx.mjs'

const MAX_FILE = 8 * 1024 * 1024
export const MAX_EXCHANGE_BODY = 12 * 1024 * 1024
const fail = (message, code = 'invalid-exchange', status = 400) => { throw Object.assign(new Error(message), { code, status }) }

export function exchangeRequest({ root, body }) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('request object required')
  const allowed = new Set(['action', 'format', 'filename', 'content', 'expectedLocalHash'])
  for (const key of Object.keys(body)) if (!allowed.has(key)) fail(`unsupported request field: ${key}`)
  const { action, format } = body
  if (action === 'initialize') {
    if (Object.keys(body).some(key => key !== 'action')) fail('initialize only accepts action')
    return { ok: true, ...initializeRequirementsExchange({ root }) }
  }
  if (!['json', 'xlsx'].includes(format)) fail('only JSON and .xlsx are supported', 'unsupported-format', 415)
  if (action === 'export') {
    const payload = exportRequirements({ root, format: 'json' })
    const bytes = format === 'xlsx' ? encodeRequirementsXlsx(payload) : Buffer.from(JSON.stringify(payload, null, 2), 'utf8')
    if (bytes.length > MAX_FILE) fail('export exceeds 8 MiB file limit', 'file-too-large', 413)
    return { ok: true, filename: `requirements-${payload.projectId}.${format}`, mime: format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/json', content: bytes.toString('base64'), bytes: bytes.length }
  }
  if (!['preview', 'apply'].includes(action)) fail('unknown exchange action')
  if (typeof body.filename !== 'string' || !body.filename.toLowerCase().endsWith(`.${format}`)) fail('filename does not match format', 'unsupported-format', 415)
  if (typeof body.content !== 'string' || body.content.length > Math.ceil(MAX_FILE / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body.content)) fail('invalid or oversized base64 file', 'invalid-file')
  const bytes = Buffer.from(body.content, 'base64')
  if (!bytes.length || bytes.length > MAX_FILE) fail('file must be between 1 byte and 8 MiB', 'file-too-large', 413)
  let payload
  try { payload = format === 'xlsx' ? decodeRequirementsXlsx(bytes) : JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
  catch (error) { if (error.code && error.status) throw error; fail(`file rejected: ${error.message}`, 'invalid-file') }
  if (action === 'preview') return previewRequirementsImport({ root, payload })
  return { ok: true, ...applyRequirementsImport({ root, payload, expectedLocalHash: body.expectedLocalHash }) }
}
