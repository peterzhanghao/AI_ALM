import { readRun } from '../alm-core/src/requirements/run.mjs'
import { redactValue } from '../alm-core/src/feedback/redact.mjs'
import { createHash } from 'node:crypto'

const MAX_PAGE = 100
const MAX_TEXT = 4000
const MAX_LIVE_TEXT = 40000
const pendingHistoryObservations = new WeakMap()
const pendingHistoryReads = new WeakMap()
const pendingPersistenceReads = new WeakMap()
const pendingUsageObservations = new WeakMap()
const pendingProxyUsage = new WeakMap()

function beginHistoryRead(registry, query, sessionId) {
  let sessions = registry.get(query)
  if (!sessions) { sessions = new Map(); registry.set(query, sessions) }
  let state = sessions.get(sessionId)
  if (!state) { state = { active: false, inFlight: 0 }; sessions.set(sessionId, state) }
  if (state.active || state.inFlight >= 2) return null
  state.active = true
  state.inFlight++
  return {
    timedOut() {
      state.active = false
      if (!state.inFlight) sessions.delete(sessionId)
    },
    settled() {
      state.inFlight--
      if (!state.inFlight && !state.active) sessions.delete(sessionId)
    },
    finished() {
      state.active = false
      if (!state.inFlight) sessions.delete(sessionId)
    },
  }
}

/** Live frames are presentation only. A gap invalidates the attempt. */
export function recordLiveFrame(attempts, payload, ownsSession) {
  const id = payload?.agent?.session?.id
  const frame = payload?.frame
  if (typeof id !== 'string' || !frame) return
  if (!ownsSession(id)) { attempts.delete(id); return }
  const attempt = attempts.get(id)
  if (frame.type === 'end') {
    if (typeof frame.attemptId !== 'string' || attempt?.attemptId === frame.attemptId) attempts.delete(id)
    return
  }
  if (typeof frame.attemptId !== 'string') return
  if (frame.type === 'start') {
    if (!Number.isSafeInteger(frame.turn) || frame.turn < 0 || !Number.isSafeInteger(frame.step) || frame.step < 0) return
    attempts.set(id, { attemptId: frame.attemptId, turn: frame.turn, step: frame.step, nextIndex: 0, text: '', reasoning: '', truncated: false, truncatedFields: new Set() })
  } else if (frame.type === 'chunk' && attempt?.attemptId === frame.attemptId) {
    if (!Number.isSafeInteger(frame.index) || frame.index !== attempt.nextIndex) { attempts.delete(id); return }
    attempt.nextIndex++
    const key = frame.chunk?.type === 'text-delta' ? 'text' : frame.chunk?.type === 'reasoning-delta' ? 'reasoning' : null
    if (key && typeof frame.chunk.text === 'string' && !attempt.truncatedFields.has(key)) {
      attempt[key] += frame.chunk.text
      if (attempt[key].length > MAX_LIVE_TEXT) { attempt[key] = textPage(attempt[key], 0, MAX_LIVE_TEXT).value; attempt.truncated = true; attempt.truncatedFields.add(key) }
    }
  }
}

export function settleLiveFrame(attempts, session, event) {
  const attempt = attempts.get(session?.id)
  if (attempt && ['assistant/message', 'assistant/attempt'].includes(event?.type) && event.data?.turn === attempt.turn && event.data?.step === attempt.step) attempts.delete(session.id)
}

function fail(code, message, status = 400) {
  throw Object.assign(new Error(message), { code, status })
}

function safeText(value) {
  if (typeof value !== 'string') return ''
  let text = value
  try {
    const parsed = JSON.parse(value)
    if (parsed && typeof parsed === 'object') text = JSON.stringify(redactValue(parsed).value, null, 2)
  } catch {}
  return redactValue(text).value
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi, '$1[已隐藏]')
    .replace(/\b(authorization\s*[:=]\s*)(?:basic|bearer)\s+[^\s,;]+/gi, '$1[已隐藏]')
    .replace(/\b((?:set-)?cookie[ \t]*[:=][ \t]*)[^\r\n]*/gi, '$1[已隐藏]')
    .replace(/(["']?(?:api[_-]?key|access[_-]?token|token|password|passwd|secret|credential|cookie|authorization)["']?\s*[:=]\s*)(["'])((?:\\.|(?!\2)[^\\\r\n])*)(?:\2|(?=\r?$|\n))/gim, '$1$2[已隐藏]$2')
    .replace(/\b(api[_-]?key|access[_-]?token|token|password|passwd|secret|credential|cookie|authorization)\s*([=:])\s*([^\s,;]+)/gi, '$1$2[已隐藏]')
}

function safeLiveText(value) {
  return safeText(value).replace(/[\uD800-\uDBFF]$/, '').replace(/\b(?:sk-|ghp_|xoxb-)[A-Za-z0-9._-]*/g, '[已隐藏]')
}

function textBlocks(content, type = 'text') {
  if (typeof content === 'string') return type === 'text' ? content : ''
  if (!Array.isArray(content)) return ''
  return content.filter((entry) => entry?.type === type && typeof entry.text === 'string').map((entry) => entry.text).join('')
}

function streamBlocks(stream, wanted) {
  if (!Array.isArray(stream)) return ''
  return stream.map((record) => {
    if (record?.type === `${wanted}-chunks` && Array.isArray(record.texts)) return record.texts.filter(part => typeof part === 'string').join('')
    if (record?.type === 'chunk' && record.chunk?.type === `${wanted}-delta` && typeof record.chunk.text === 'string') return record.chunk.text
    return ''
  }).join('')
}

function textPage(text, offset, limit = MAX_TEXT) {
  let end = Math.min(text.length, offset + limit)
  if (end < text.length && end > offset && /[\uD800-\uDBFF]/.test(text[end - 1]) && /[\uDC00-\uDFFF]/.test(text[end])) end--
  return { value: text.slice(offset, end), truncated: end < text.length }
}

function project(event, sessionId, offset = 0, toolName = null, callId = null) {
  const data = event?.data ?? {}
  let kind, text = '', name = null, status = null, reasoning = '', nonTextBlocks = 0
  if (event.type === 'user/message') {
    kind = 'input'
    const content = data.content ?? data.message?.content
    text = textBlocks(content)
    nonTextBlocks = Array.isArray(content) ? content.filter(block => block?.type !== 'text').length : 0
  } else if (event.type === 'assistant/message') {
    kind = 'output'
    text = textBlocks(data.message?.content)
    reasoning = textBlocks(data.message?.content, 'reasoning')
    nonTextBlocks = Array.isArray(data.message?.content) ? data.message.content.filter(block => !['text', 'reasoning'].includes(block?.type)).length : 0
  } else if (event.type === 'assistant/attempt') {
    kind = 'output'
    status = 'interrupted'
    text = streamBlocks(data.stream, 'text')
    reasoning = streamBlocks(data.stream, 'reasoning')
    const failedFinish = Array.isArray(data.stream) ? data.stream.findLast(record => record?.type === 'chunk' && record.chunk?.type === 'finish' && record.chunk?.reason?.kind === 'error') : null
    if (failedFinish) {
      const rawCode = failedFinish.chunk.reason.failure?.code
      const code = typeof rawCode === 'string' && /^[A-Z0-9_-]{1,80}$/.test(rawCode) ? rawCode : null
      status = 'failed'
      text = [text, code === 'MISSING_CREDENTIAL' ? '模型凭据不可用，请检查 DSH 模型配置。' : `模型调用失败${code ? `（${code}）` : ''}。`].filter(Boolean).join('\n')
    }
  } else if (event.type === 'tool/call') {
    kind = 'tool-call'
    name = typeof data.name === 'string' ? data.name : 'tool'
    if (typeof data.arguments === 'string') text = data.arguments
    else if (data.arguments && typeof data.arguments === 'object') {
      try { text = JSON.stringify(data.arguments) ?? '' } catch { text = '[工具参数无法显示]' }
    }
    status = 'called'
  } else if (event.type === 'tool/result') {
    kind = 'tool-result'
    name = toolName
    const content = data.message?.content ?? data.content
    text = textBlocks(content)
    nonTextBlocks = Array.isArray(content) ? content.filter(block => block?.type !== 'text').length : 0
    status = data.error || data.message?.isError === true ? 'failed' : 'completed'
  } else {
    kind = 'other'
    name = typeof event.type === 'string' ? event.type : 'unknown'
  }
  const sanitize = event.type === 'assistant/attempt' ? safeLiveText : safeText
  const cleaned = sanitize(text)
  const cleanReasoning = sanitize(reasoning)
  const textPart = textPage(cleaned, offset)
  const reasoningPart = textPage(cleanReasoning, offset)
  return { sessionId, seq: event.seq, eventHash: createHash('sha256').update(JSON.stringify(event)).digest('hex'), at: event.time ?? null, kind, name: name === null ? null : safeText(name).slice(0, 120), callId: typeof callId === 'string' && callId ? safeText(callId).slice(0, 160) : null, status, text: textPart.value, truncated: textPart.truncated, reasoning: reasoningPart.value, reasoningTruncated: reasoningPart.truncated, nonTextBlocks }
}

async function readEvents(ctx, sessionId) {
  const query = ctx?.get?.('sessionQuery')
  if (typeof query?.observeSession === 'function') {
    const read = beginHistoryRead(pendingHistoryObservations, query, sessionId)
    if (!read) return { events: null, source: 'unavailable' }
    let observation
    let expired = false
    let timeout
    try {
      const pending = Promise.resolve().then(() => query.observeSession(sessionId, { projectionMode: 'none' })).then(value => {
        read.settled()
        if (expired) { try { value?.[Symbol.dispose]?.() } catch {} }
        return value
      }, error => { read.settled(); throw error })
      observation = await Promise.race([pending, new Promise(resolve => { timeout = setTimeout(() => { expired = true; resolve(null) }, 8000) })])
      if (expired) { read.timedOut(); return { events: null, source: 'unavailable' } }
      const events = Array.isArray(observation?.events) ? observation.events.slice() : null
      if (events) return { events, source: 'session-observation' }
    } catch (error) {
      if (error?.code === 'SESSION_QUERY_CORRUPT_SESSION' || error?.name === 'SessionPersistenceCorruptionError') return { events: null, source: 'corrupt' }
    } finally {
      clearTimeout(timeout)
      if (!expired) read.finished()
      try { observation?.[Symbol.dispose]?.() } catch {}
    }
  }
  if (typeof query?.readSession === 'function') {
    const read = beginHistoryRead(pendingHistoryReads, query, sessionId)
    if (!read) return { events: null, source: 'unavailable' }
    let timeout
    let expired = false
    try {
      const pending = Promise.resolve().then(() => query.readSession(sessionId)).finally(() => read.settled())
      const result = await Promise.race([pending, new Promise(resolve => { timeout = setTimeout(() => { expired = true; resolve(null) }, 8000) })])
      if (expired) { read.timedOut(); return { events: null, source: 'unavailable' } }
      if (Array.isArray(result?.events)) return { events: result.events, source: 'session-query' }
    } catch (error) {
      if (error?.code === 'SESSION_QUERY_CORRUPT_SESSION' || error?.name === 'SessionPersistenceCorruptionError') return { events: null, source: 'corrupt' }
    } finally { clearTimeout(timeout); if (!expired) read.finished() }
  }
  const persistence = ctx?.get?.('sessionPersistence')
  if (!persistence?.open) return { events: null, source: 'unavailable' }
  const read = beginHistoryRead(pendingPersistenceReads, persistence, sessionId)
  if (!read) return { events: null, source: 'unavailable' }
  const pending = (async () => {
    let handle
    let result
    try {
      handle = await persistence.open(sessionId, 'read')
      const payload = await handle.read()
      result = Array.isArray(payload?.events)
        ? { events: payload.events, source: 'persisted' }
        : { events: null, source: 'unavailable' }
    } catch (error) {
      result = { events: null, source: error?.name === 'SessionPersistenceCorruptionError' ? 'corrupt' : 'unavailable' }
    } finally {
      try { await handle?.close?.() } catch {
        if (result?.source !== 'corrupt') result = { events: null, source: 'unavailable' }
      }
    }
    return result
  })().finally(() => read.settled())
  let timeout
  let expired = false
  try {
    const result = await Promise.race([pending, new Promise(resolve => { timeout = setTimeout(() => { expired = true; resolve({ events: null, source: 'unavailable' }) }, 8000) })])
    if (expired) read.timedOut()
    return result
  } finally { clearTimeout(timeout); if (!expired) read.finished() }
}

/** Resolve the run on the server; callers cannot choose a host session ID. */
export async function observeRun({ ctx, root, requirementId, runId, segment = 0, after = -1, limit = 50, eventSeq = null, offset = 0, eventHash = null, prefixHash = null, liveAttempts = null, liveOnly = false }) {
  if (!/^RUN-\d+$/.test(String(runId ?? ''))) fail('run-id-invalid', '运行编号无效')
  if (typeof requirementId !== 'string' || !requirementId) fail('requirement-id-invalid', '需求编号无效')
  if (!Number.isSafeInteger(segment) || segment < 0 || !Number.isSafeInteger(after) || after < -1 || !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE) fail('cursor-invalid', '运行记录游标无效')
  if ((eventSeq !== null && (!Number.isSafeInteger(eventSeq) || eventSeq < 0)) || !Number.isSafeInteger(offset) || offset < 0) fail('cursor-invalid', '记录内容游标无效')
  if (eventHash !== null && (eventSeq === null || !/^[a-f0-9]{64}$/.test(eventHash))) fail('cursor-invalid', '记录内容校验值无效')
  if (prefixHash !== null && (after < 0 || !/^[a-f0-9]{64}$/.test(prefixHash))) fail('cursor-invalid', '运行记录校验值无效')
  const run = readRun(root, runId)
  if (!run || run.requirement !== requirementId) fail('run-not-found', '找不到该需求的运行记录', 404)
  const sessions = Array.isArray(run.sessions) ? run.sessions : run.sessionId ? [{ sessionId: run.sessionId, startedAt: null, endedAt: null, reason: 'legacy' }] : []
  if (segment >= Math.max(sessions.length, 1)) fail('cursor-invalid', '会话分段不存在')
  const selected = sessions[segment]
  const interruptedOutputPossible = Array.isArray(run.interruptedSessions)
    ? run.interruptedSessions.includes(selected?.sessionId)
    : ['heartbeat-lost', 'host-restart'].includes(run.failure?.code)
  const base = { runId: run.id, status: run.status, sessions, sessionHistoryComplete: run.sessionHistoryComplete === true, interruptedOutputPossible, segment, usage: { status: 'unknown' } }
  if (!selected) return liveOnly
    ? { runId: run.id, segment, live: null }
    : { ...base, events: [], source: 'no-session', next: null }
  const attempt = ['queued', 'running'].includes(run.status) && run.sessionId === selected.sessionId ? liveAttempts?.get(selected.sessionId) : null
  const liveValue = attempt ? { text: safeLiveText(attempt.text), reasoning: safeLiveText(attempt.reasoning), truncated: attempt.truncated } : null
  if (liveOnly) return { runId: run.id, segment, live: liveValue }
  const loaded = await readEvents(ctx, selected.sessionId)
  if (!loaded.events) return { ...base, events: [], source: loaded.source, next: null }
  const unique = new Map()
  for (const event of loaded.events) {
    if (!Number.isSafeInteger(event?.seq) || event.seq < 0 || typeof event.type !== 'string' || !event.type) fail('event-invalid', '宿主会话记录包含无法排序或识别的事件，暂无法可靠读取', 502)
    const prior = unique.get(event.seq)
    if (prior && JSON.stringify(prior) !== JSON.stringify(event)) fail('event-sequence-conflict', '宿主会话记录存在冲突的事件序号，暂无法可靠读取', 502)
    if (!prior) unique.set(event.seq, event)
  }
  const events = [...unique.values()].sort((a, b) => a.seq - b.seq)
  const calls = new Map()
  for (const event of events) {
    const id = event.type === 'tool/call' ? event.data?.callId : null
    if (typeof id !== 'string' || !id) continue
    if (calls.has(id)) calls.set(id, null)
    else calls.set(id, { seq: event.seq, name: typeof event.data?.name === 'string' && event.data.name ? event.data.name : null })
  }
  const callIdForResult = event => {
    const message = event.type === 'tool/result' ? event.data?.message : null
    const id = message?.source?.kind === 'tool' ? message.source.callId : null
    return typeof id === 'string' && id && message.toolCallId === id ? id : null
  }
  const nameForResult = event => {
    const id = callIdForResult(event)
    const call = id ? calls.get(id) : null
    return call && call.seq < event.seq ? call.name : null
  }
  if (eventSeq !== null) {
    const event = unique.get(eventSeq)
    const detail = event && project(event, selected.sessionId, offset, nameForResult(event), event.type === 'tool/call' ? event.data?.callId : callIdForResult(event))
    if (!detail) fail('event-not-found', '找不到该运行记录', 404)
    if (eventHash !== null && eventHash !== detail.eventHash) fail('event-changed', '运行记录已变化，请刷新记录后重新读取', 409)
    return { ...base, source: loaded.source, detail, offset }
  }
  const hashThrough = seq => createHash('sha256').update(JSON.stringify(events.filter(event => event.seq <= seq).map(event => event.type === 'tool/result' ? [event, nameForResult(event)] : event))).digest('hex')
  if (prefixHash !== null && prefixHash !== hashThrough(after)) return { ...base, source: loaded.source, events: [], historyChanged: true, next: null, lastSeq: after }
  const remaining = events.filter((event) => event.seq > after)
  const page = remaining.slice(0, limit).map((event) => project(event, selected.sessionId, 0, nameForResult(event), event.type === 'tool/call' ? event.data?.callId : callIdForResult(event))).filter(Boolean)
  const committed = attempt && events.some(event => ['assistant/message', 'assistant/attempt'].includes(event.type) && event.data?.turn === attempt.turn && event.data?.step === attempt.step)
  const live = committed ? null : liveValue
  const lastSeq = page.at(-1)?.seq ?? after
  return { ...base, events: page, source: loaded.source, next: remaining.length > limit ? { segment, after: page.at(-1).seq } : null, lastSeq, prefixHash: lastSeq >= 0 ? hashThrough(lastSeq) : null, live }
}

/** Proxy statistics are per exact host session and are never a billing receipt. */
export async function observeUsage({ ctx = null, root, requirementId, runId, segment = 0, port = 18787, fetchImpl = fetch }) {
  if (!/^RUN-\d+$/.test(String(runId ?? ''))) fail('run-id-invalid', '运行编号无效')
  if (typeof requirementId !== 'string' || !requirementId) fail('requirement-id-invalid', '需求编号无效')
  if (!Number.isSafeInteger(segment) || segment < 0 || !Number.isInteger(port) || port < 1 || port > 65535) fail('cursor-invalid', '会话分段无效')
  const run = readRun(root, runId)
  if (!run || run.requirement !== requirementId) fail('run-not-found', '找不到该需求的运行记录', 404)
  const sessions = Array.isArray(run.sessions) ? run.sessions : run.sessionId ? [{ sessionId: run.sessionId }] : []
  if (segment >= Math.max(sessions.length, 1)) fail('cursor-invalid', '会话分段不存在')
  const selected = sessions[segment]
  if (!selected) return { status: 'unknown', reason: 'session-unavailable' }
  let host = null
  let directChildren = null
  const query = ctx?.get?.('sessionQuery')
  const usageRead = typeof query?.observeSession === 'function' ? beginHistoryRead(pendingUsageObservations, query, selected.sessionId) : null
  if (usageRead) {
    let observation
    let expired = false
    let timeout
    try {
      const pending = Promise.resolve().then(() => query.observeSession(selected.sessionId, { projectionMode: 'all' })).then(value => {
        usageRead.settled()
        if (expired) { try { value?.[Symbol.dispose]?.() } catch {} }
        return value
      }, error => { usageRead.settled(); throw error })
      observation = await Promise.race([pending, new Promise(resolve => { timeout = setTimeout(() => { expired = true; resolve(null) }, 1500) })])
      if (expired) usageRead.timedOut()
      const usage = observation?.projections?.values?.tokenUsage
      const catalog = observation?.projections?.values?.subagentCatalog
      if (Array.isArray(catalog) && catalog.every(entry => entry && typeof entry.id === 'string' && entry.id.length > 0) && new Set(catalog.map(entry => entry.id)).size === catalog.length) directChildren = catalog.length
      const keys = ['uncachedInputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'outputTokens']
      const validUsage = value => value && typeof value === 'object' && !Array.isArray(value) &&
        ['inputTokens', 'outputTokens'].every(key => Number.isSafeInteger(value[key]) && value[key] >= 0) &&
        ['cacheReadTokens', 'cacheWriteTokens'].every(key => value[key] === undefined || (Number.isSafeInteger(value[key]) && value[key] >= 0))
      const reported = Array.isArray(observation?.events) && observation.events.some(event =>
        ['assistant/message', 'assistant/attempt'].includes(event?.type) && (
          validUsage(event.data?.usage) || (Array.isArray(event.data?.stream) && event.data.stream.some(record => record?.type === 'chunk' && record.chunk?.type === 'usage' && validUsage(record.chunk?.usage)))
        ))
      if (observation?.inheritedEventCount === 0 && reported && usage && keys.every(key => Number.isSafeInteger(usage[key]) && usage[key] >= 0) && Number.isSafeInteger(usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens)) host = Object.fromEntries(keys.map(key => [key, usage[key]]))
    } catch {} finally { clearTimeout(timeout); if (!expired) usageRead.finished(); try { observation?.[Symbol.dispose]?.() } catch {} }
  }
  const fallback = reason => host ? {
    status: 'available', source: 'dsh-session', scope: 'session', complete: false, host, directChildren,
    inputTokens: host.uncachedInputTokens + host.cacheReadTokens + host.cacheWriteTokens,
    cachedTokens: host.cacheReadTokens, outputTokens: host.outputTokens, requests: null, tokensSaved: null, cacheHitPct: null, estimatedCostUsd: null, model: null,
  } : { status: 'unknown', reason, directChildren }
  let pendingProxy = pendingProxyUsage.get(fetchImpl)
  if (!pendingProxy) { pendingProxy = new Map(); pendingProxyUsage.set(fetchImpl, pendingProxy) }
  const proxyKey = port
  let proxyState = pendingProxy.get(proxyKey)
  if (!proxyState) { proxyState = { active: null, inFlight: new Set() }; pendingProxy.set(proxyKey, proxyState) }
  let pending = proxyState.active
  if (!pending) {
    if (proxyState.inFlight.size >= 2) return fallback('proxy-unavailable')
    const controller = new AbortController()
    let proxyTimeout
    const token = {}
    proxyState.inFlight.add(token)
    const request = Promise.resolve().then(async () => {
      const response = await fetchImpl(`http://127.0.0.1:${port}/__bili/sessions`, { signal: controller.signal })
      if (!response.ok) throw new Error('proxy unavailable')
      return response.json()
    }).finally(() => {
      proxyState.inFlight.delete(token)
      if (!proxyState.active && !proxyState.inFlight.size && pendingProxy.get(proxyKey) === proxyState) pendingProxy.delete(proxyKey)
    })
    pending = Promise.race([
      request,
      new Promise((_, reject) => { proxyTimeout = setTimeout(() => { controller.abort(); reject(new Error('proxy timeout')) }, 1500) }),
    ]).finally(() => {
      clearTimeout(proxyTimeout)
      if (proxyState.active === pending) proxyState.active = null
      if (!proxyState.inFlight.size && pendingProxy.get(proxyKey) === proxyState) pendingProxy.delete(proxyKey)
    })
    proxyState.active = pending
  }
  try {
    const data = await pending
    const matches = Array.isArray(data?.sessions) ? data.sessions.filter(entry => entry?.id === selected.sessionId) : []
    if (matches.length !== 1) return fallback(matches.length ? 'ambiguous-session' : 'session-not-found')
    const entry = matches[0]
    if (entry.hasLedger !== true) return fallback('ledger-unavailable')
    const number = key => typeof entry[key] === 'number' && Number.isFinite(entry[key]) && entry[key] >= 0 ? entry[key] : null
    const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null
    const signedNumber = key => typeof entry[key] === 'number' && Number.isFinite(entry[key]) ? entry[key] : null
    const cachedTokens = row => {
      const cached = row.cachedTokens
      const input = row.inputTokens
      if (count(cached) === null) return null
      if (typeof input === 'number' && Number.isFinite(input) && input >= 0 && cached > input) return null
      return cached
    }
    const cacheHitPct = row => {
      if (row.cachedTokens != null && cachedTokens(row) === null) return null
      if (row.inputTokens != null && count(row.inputTokens) === null) return null
      const value = row.cacheHitPct
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) return null
      if (count(row.inputTokens) !== null && count(row.cachedTokens) !== null) {
        if (row.inputTokens === 0 || Math.abs(value - row.cachedTokens / row.inputTokens * 100) > 0.500001) return null
      }
      return value
    }
    const cost = row => {
      const hasRates = row.rates && ['w', 'r', 'q'].every(key => typeof row.rates[key] === 'number' && Number.isFinite(row.rates[key]) && row.rates[key] >= 0)
      const value = row.costUsd?.total
      if (!hasRates || (row.costUsd?.estimated === true && row.modelSwitches !== 0)) return null
      return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
    }
    const costSource = row => {
      if (row.costUsd?.estimated === true) return true
      if (cost(row) === null) return null
      if (row.costUsd?.estimated !== undefined && row.costUsd.estimated !== false) return null
      const components = ['input', 'cacheRead', 'cacheWrite', 'output'].map(key => row.costUsd?.[key])
      if (!components.every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0)) return null
      const total = components.reduce((sum, value) => sum + value, 0)
      return Number.isFinite(total) && Math.abs(total - row.costUsd.total) <= Math.max(1e-12, total * 1e-9) ? false : null
    }
    const matched = sessions.map(session => {
      const found = data.sessions.filter(row => row?.id === session.sessionId)
      return found.length === 1 && found[0].hasLedger === true ? found[0] : null
    })
    const coverage = { matched: matched.filter(Boolean).length, total: sessions.length, historyComplete: run.sessionHistoryComplete === true }
    const duplicateSessions = sessions.length - new Set(sessions.map(session => session.sessionId)).size
    if (duplicateSessions) coverage.duplicateSessions = duplicateSessions
    let aggregate = null
    if (coverage.historyComplete && !duplicateSessions && coverage.matched === coverage.total && coverage.total > 0) {
      const sum = get => {
        const values = matched.map(get)
        if (!values.every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0)) return null
        const total = values.reduce((a, b) => a + b, 0)
        return Number.isFinite(total) ? total : null
      }
      const sumCounts = get => {
        const values = matched.map(row => count(get(row)))
        if (values.some(value => value === null)) return null
        const total = values.reduce((a, b) => a + b, 0)
        return Number.isSafeInteger(total) ? total : null
      }
      aggregate = {
        requests: sumCounts(row => row.requests), inputTokens: sumCounts(row => row.inputTokens), cachedTokens: sumCounts(cachedTokens),
        outputTokens: sumCounts(row => row.outputTokens), tokensSaved: sumCounts(row => row.tokensSaved > 0 ? row.tokensSaved : null),
        estimatedCostUsd: sum(cost),
      }
    }
    return { status: 'available', source: 'billion-context', scope: 'session', complete: false, directChildren,
      requests: count(entry.requests), inputTokens: count(entry.inputTokens), cachedTokens: cachedTokens(entry), outputTokens: count(entry.outputTokens),
      tokensSaved: count(entry.tokensSaved) > 0 ? count(entry.tokensSaved) : null, savedUsd: signedNumber('savedUsd'), savedUsdGross: number('savedUsdGross'), cacheHitPct: cacheHitPct(entry), estimatedCostUsd: cost(entry),
      foldCount: Number.isSafeInteger(entry.foldCount) && entry.foldCount >= 0 ? entry.foldCount : null,
      modelSwitches: count(entry.modelSwitches), costUsesCurrentRates: costSource(entry),
      model: typeof entry.model === 'string' ? entry.model : null, lastSeen: (typeof entry.lastSeen === 'string' || typeof entry.lastSeen === 'number') && Number.isFinite(new Date(entry.lastSeen).getTime()) ? entry.lastSeen : null, coverage, aggregate, host }
  } catch { return fallback('proxy-unavailable') }
}
