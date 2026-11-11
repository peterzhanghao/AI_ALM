import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import * as core from '../../alm-core/src/intent/index.mjs'
import { handleIntentRequest, handleIntentLoad } from '../intent.mjs'
import vm from 'node:vm'

const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')

// Execute the real module factory and real IntentModal, with a small React hook
// driver. Child elements stay as element trees; no copied product state machine.
function client(initial = {}, { shortReadTimeout = false } = {}) {
  const slots = [], effects = [], requests = [], opened = [], listeners = new Map()
  let cursor = 0, pendingEffects = [], factory, component, tree, closed = 0
  let props = { root: 'D:/DSH', project: 'A', projectId: 'A', onClose: () => closed++, onOpenRequirement: id => opened.push(id), ...initial }
  const React = {
    Component: class {},
    createElement(type, props, ...children) { return { type, props: props ?? {}, children: children.flat(Infinity).filter(x => x != null) } },
    useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = typeof value === 'function' ? value() : value; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next }] },
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value } },
    useEffect(fn, deps) { const i = cursor++; const old = effects[i]; if (!old || deps.some((v, n) => v !== old.deps[n])) { pendingEffects.push(() => { old?.cleanup?.(); effects[i] = { deps, cleanup: fn() } }) } },
    useCallback(fn) { return fn },
  }
  const testTimeout = (fn, delay, ...args) => setTimeout(fn, shortReadTimeout && delay === 10000 ? 30 : delay, ...args)
  const context = vm.createContext({ console, AbortController, AbortSignal, URLSearchParams, setInterval, clearInterval, setTimeout: testTimeout, clearTimeout,
    window: { confirm: () => true, addEventListener(type, fn) { listeners.set(type, fn) }, removeEventListener(type, fn) { if (listeners.get(type) === fn) listeners.delete(type) }, __ModuleLoader__: { load(value) { factory = value.factory } } },
    fetch(url, options) { return new Promise((resolve, reject) => requests.push({ url, options, resolve: payload => resolve({ ok: true, json: async () => payload }), reject })) },
  })
  const marker = '    return {\n      inject:'
  assert.ok(source.includes(marker))
  const modalMarker = '      const title =\n        screen ==='
  vm.runInContext(source.replace(marker, '    globalThis.IntentModal = IntentModal;\n' + marker).replace(modalMarker, '      globalThis.modalActions = { changePriority, ownerChoice, priorityChoice, renderConfirm, runAnalyze, setManualField, startInvestigation, cancelInvestigation };\n' + modalMarker), context)
  factory(name => { assert.equal(name, 'react'); return React })
  component = context.IntentModal
  function render(next) { props = { ...props, ...next }; cursor = 0; pendingEffects = []; tree = component(props); pendingEffects.forEach(fn => fn()); return tree }
  function nodes(node = tree) { if (!node || typeof node !== 'object') return []; return [node, ...(node.children ?? []).flatMap(n => nodes(n)), ...(node.props?.footer ?? []).flatMap(n => nodes(n))] }
  function text(node) { return typeof node === 'object' ? (node.children ?? []).map(text).join('') : String(node) }
  function find(label) { const node = nodes().find(n => n.type === 'button' && text(n).includes(label)); assert.ok(node, `missing button ${label}`); return node }
  render(); render()
  return { render, nodes, text, find, requests, opened, setConfirm(fn) { context.window.confirm = fn }, dispatch(type, event) { listeners.get(type)?.(event) }, get actions() { return context.modalActions }, get tree() { return tree }, get closed() { return closed }, unmount() { effects.forEach(e => e?.cleanup?.()) }, remount() { effects.forEach(e => e?.cleanup?.()); effects.length = 0; slots.length = 0; render(); render() }, async settle() { await new Promise(resolve => setImmediate(resolve)); render() } }
}
const view = (id, extra = {}) => ({ sessionId: id, state: 'reviewing', input: { rawText: `input-${id}`, inputRevision: 7, explicit: { owner: 'owner', priority: 'P1' } }, sessionRevision: 9, items: [], ...extra })
async function list(c, sessions = [{ sessionId: 'one', state: 'reviewing', updatedAt: '2026-11-04' }]) {
  c.find('查看服务端意图历史').props.onClick(); c.render()
  c.requests.at(-1).resolve({ ok: true, sessions }); await c.settle()
}

test('reanalysis does not start when candidate save fails or project changes', async () => {
  for (const changeProject of [false, true]) {
    const c = client()
    try {
      await list(c)
      c.find('one ·').props.onClick(); c.render()
      const candidate = { title: '原始标题', problem: '原始问题', goal: '原始目标', inScope: [], outOfScope: [], acceptance: [] }
      c.requests.at(-1).resolve({ session: view('one', { input: { text: '原话', rawText: '原话', inputRevision: 7, explicit: { owner: 'owner', priority: 'P1' } }, items: [{ itemId: 'I-1', recommendedRoute: 'create', candidate }] }) })
      await c.settle()
      c.actions.setManualField('I-1', 'title', '尚未保存的标题'); c.render()
      const work = c.actions.runAnalyze()
      await c.settle()
      const edit = c.requests.at(-1)
      assert.equal(JSON.parse(edit.options.body).action, 'edit')
      if (changeProject) {
        c.render({ project: 'B', projectId: 'B' })
        edit.resolve({ session: view('one') })
      } else edit.reject(new Error('保存失败'))
      await work; await c.settle()
      assert.equal(c.requests.some(request => request.options.body && JSON.parse(request.options.body).action === 'analyze'), false)
      if (!changeProject) assert.match(c.text(c.tree), /保存当前编辑失败/)
    } finally { c.unmount() }
  }
})

test('reanalysis uses the revision returned after saving candidate edits', async () => {
  const c = client()
  try {
    await list(c)
    c.find('one ·').props.onClick(); c.render()
    const candidate = { title: '原始标题', problem: '原始问题', goal: '原始目标', inScope: [], outOfScope: [], acceptance: [] }
    const input = { text: '原话', rawText: '原话', inputRevision: 7, explicit: { owner: 'owner', priority: 'P1' } }
    c.requests.at(-1).resolve({ session: view('one', { input, items: [{ itemId: 'I-1', recommendedRoute: 'create', candidate }] }) })
    await c.settle()
    c.actions.setManualField('I-1', 'title', '修改标题'); c.render()
    const work = c.actions.runAnalyze()
    await c.settle()
    const edit = c.requests.at(-1)
    assert.equal(JSON.parse(edit.options.body).fields.title, '修改标题')
    edit.resolve({ session: view('one', { sessionRevision: 10, input, items: [{ itemId: 'I-1', recommendedRoute: 'create', candidate: { ...candidate, title: '修改标题' } }] }) })
    await work; await c.settle()
    const analyze = JSON.parse(c.requests.at(-1).options.body)
    assert.equal(analyze.action, 'analyze')
    assert.equal(analyze.retryExisting, true)
    assert.equal(analyze.expectedSessionRevision, 10)
  } finally { c.unmount() }
})

test('failed reanalysis stays in review and the next attempt retains the existing session', async () => {
  for (const status of [502, 503]) {
    const c = client()
    try {
      await list(c)
      c.find('one ·').props.onClick(); c.render()
      c.requests.at(-1).resolve({ session: view('one', { input: { text: '原话', rawText: '原话', inputRevision: 7, explicit: {} }, answers: [{ text: '已保存回答' }] }) })
      await c.settle()
      await c.actions.runAnalyze(); await c.settle()
      c.requests.at(-1).reject(Object.assign(new Error('分析失败'), { status }))
      await c.settle()
      assert.match(c.text(c.tree), /已确认决定1 条/)
      assert.match(c.text(c.tree), /分析与草案信息.*重新加载会话/)
      if (status === 503) assert.doesNotMatch(c.text(c.tree), /模型不可用/)
      await c.actions.runAnalyze(); await c.settle()
      const body = JSON.parse(c.requests.at(-1).options.body)
      assert.equal(body.sessionId, 'one')
      assert.equal(body.retryExisting, true)
      assert.equal(body.expectedSessionRevision, 9)
    } finally { c.unmount() }
  }
})

test('cancelling reanalysis returns to review and preserves retry semantics', async () => {
  const c = client()
  try {
    await list(c)
    c.find('one ·').props.onClick(); c.render()
    c.requests.at(-1).resolve({ session: view('one', { input: { text: '原话', rawText: '原话', inputRevision: 7, explicit: {} }, answers: [{ text: '已保存回答' }] }) })
    await c.settle()
    await c.actions.runAnalyze(); await c.settle()
    c.find('取消分析').props.onClick(); c.render()
    assert.match(c.text(c.tree), /已确认决定1 条/)
    assert.match(c.text(c.tree), /服务端分析可能仍在运行或已完成/)
    await c.actions.runAnalyze(); await c.settle()
    assert.equal(JSON.parse(c.requests.at(-1).options.body).retryExisting, true)
  } finally { c.unmount() }
})

test('historical answers remain distinct from current confirmed decisions', async () => {
  const c = client()
  try {
    await list(c)
    c.find('one ·').props.onClick(); c.render()
    c.requests.at(-1).resolve({ session: view('one', { historicalAnswers: [{ answerId: 'old', questionText: '旧问题', text: '旧答案', inputRevision: 1, superseded: false }], historicalAnswersOmitted: 2 }) })
    await c.settle()
    assert.match(c.text(c.tree), /历史回答（1 条）/)
    assert.match(c.text(c.tree), /不作为当前输入的已确认决定/)
    assert.match(c.text(c.tree), /旧问题.*旧答案.*输入版本：1/)
    assert.match(c.text(c.tree), /另有 2 条较早记录未显示/)
    assert.doesNotMatch(c.text(c.tree), /已确认决定1 条/)
  } finally { c.unmount() }
})

test('restoring a different session replaces investigation records and labels old input evidence', async () => {
  const c = client()
  try {
    await list(c, [{ sessionId: 'one', state: 'reviewing' }, { sessionId: 'two', state: 'reviewing' }])
    c.find('one ·').props.onClick(); c.render()
    c.requests.at(-1).resolve({ session: view('one'), investigations: [{ investigationId: 'INV-20261107000000-abcdef', question: '旧版调查', inputRevision: 6 }] }); await c.settle()
    assert.match(c.text(c.tree), /旧版调查/)
    assert.match(c.text(c.tree), /历史输入版本 6/)
    c.find('返回原话').props.onClick(); c.render()
    await list(c, [{ sessionId: 'two', state: 'reviewing' }])
    c.find('two ·').props.onClick(); c.render()
    c.requests.at(-1).resolve({ session: view('two'), investigations: [] }); await c.settle()
    assert.doesNotMatch(c.text(c.tree), /旧版调查/)
  } finally { c.unmount() }
})

test('reanalyzing an investigation sends only the selected current record', async () => {
  const c = client()
  try {
    await list(c)
    c.find('one ·').props.onClick(); c.render()
    const first = { investigationId: 'INV-20261107000000-abcdef', sessionId: 'one', inputRevision: 7, question: '第一条调查', findings: [] }
    const second = { investigationId: 'INV-20261107000000-123456', sessionId: 'one', inputRevision: 7, question: '第二条调查', findings: [] }
    c.requests.at(-1).resolve({ session: view('one', { input: { text: '原话', rawText: '原话', inputRevision: 7, explicit: {} } }), investigations: [first, second] }); await c.settle()
    c.find('第一条调查').props.onClick(); c.render()
    c.find('用此调查重新判断').props.onClick(); await c.settle()
    const body = JSON.parse(c.requests.at(-1).options.body)
    assert.equal(body.action, 'analyze')
    assert.deepEqual(body.investigationIds, [first.investigationId])
  } finally { c.unmount() }
})

test('adoption sends the chosen investigation and exact unknown with session revisions', async () => {
  const c = client()
  try {
    await list(c)
    c.find('one ·').props.onClick(); c.render()
    const investigation = { investigationId: 'INV-20261107000000-abcdef', sessionId: 'one', inputRevision: 7, question: '现有实现是什么', summary: '核对结果', verdict: 'answered', source: 'observed_evidence', findings: [{ claim: '已核对', refs: [] }] }
    c.requests.at(-1).resolve({ session: view('one', { items: [{ itemId: 'I-1', recommendedRoute: 'create', candidate: {}, unknowns: [{ description: '需要核对实现', blocking: true, resolution: 'investigate' }] }] }), investigations: [investigation] }); await c.settle()
    c.find('采纳用于此未知项').props.onClick(); await c.settle()
    const body = JSON.parse(c.requests.at(-1).options.body)
    assert.equal(body.action, 'adopt-investigation')
    assert.equal(body.itemId, 'I-1')
    assert.equal(body.unknownDescription, '需要核对实现')
    assert.equal(body.investigationId, investigation.investigationId)
    assert.equal(body.expectedInputRevision, 7)
    assert.equal(body.expectedSessionRevision, 9)
  } finally { c.unmount() }
})

test('restored adoption shows whether its citations were valid when loaded', async () => {
  for (const referencesCurrent of [true, false]) {
    const c = client()
    try {
      await list(c)
      c.find('one ·').props.onClick(); c.render()
      const id = 'INV-20261107000000-abcdef'
      c.requests.at(-1).resolve({ session: view('one', { items: [{ itemId: 'I-1', recommendedRoute: 'create', candidate: {}, unknowns: [{ description: '需要核对实现', blocking: true, resolution: 'investigate' }] }], readiness: { ready: false, reasons: [], investigationAdoptions: [{ itemId: 'I-1', unknownDescription: '需要核对实现', inputRevision: 7, investigationId: id, referencesCurrent }] } }), investigations: [] }); await c.settle()
      assert.match(c.text(c.tree), referencesCurrent ? /引用本次读取时有效/ : /引用已失效/)
      assert.match(c.text(c.tree), /当前输入尚无可采纳的调查/)
    } finally { c.unmount() }
  }
})

test('late adoption cannot overwrite a reloaded copy of the same session', async () => {
  const c = client()
  try {
    await list(c)
    c.find('one ·').props.onClick(); c.render()
    const item = { itemId: 'I-1', recommendedRoute: 'create', candidate: {}, unknowns: [{ description: '需要核对实现', blocking: true, resolution: 'investigate' }] }
    const investigation = { investigationId: 'INV-20261107000000-abcdef', sessionId: 'one', inputRevision: 7, question: '调查问题', verdict: 'answered', source: 'observed_evidence', findings: [] }
    c.requests.at(-1).resolve({ session: view('one', { items: [item] }), investigations: [investigation] }); await c.settle()
    c.find('采纳用于此未知项').props.onClick(); await c.settle()
    const adoption = c.requests.at(-1)
    c.find('重新加载会话').props.onClick(); c.render()
    c.requests.at(-1).resolve({ session: view('one', { items: [{ ...item, userProblem: '最新加载状态' }] }), investigations: [investigation] }); await c.settle()
    adoption.resolve({ session: view('one', { sessionRevision: 10, items: [{ ...item, userProblem: '过期采纳响应' }] }) }); await c.settle()
    assert.match(c.text(c.tree), /最新加载状态/)
    assert.doesNotMatch(c.text(c.tree), /过期采纳响应|已采纳该调查/)
    assert.match(c.text(c.tree), /采纳请求已返回.*重新加载会话核对结果/)
    assert.equal(Boolean(c.find('采纳用于此未知项').props.disabled), false)
  } finally { c.unmount() }
})

test('edits made during adoption wait for its new session revision', async () => {
  const c = client()
  try {
    await list(c)
    c.find('one ·').props.onClick(); c.render()
    const item = { itemId: 'I-1', recommendedRoute: 'create', candidate: {}, unknowns: [{ description: '需要核对实现', blocking: true, resolution: 'investigate' }] }
    const investigation = { investigationId: 'INV-20261107000000-abcdef', sessionId: 'one', inputRevision: 7, question: '调查问题', verdict: 'answered', source: 'observed_evidence', findings: [] }
    c.requests.at(-1).resolve({ session: view('one', { items: [item] }), investigations: [investigation] }); await c.settle()
    c.find('采纳用于此未知项').props.onClick(); await c.settle()
    const adoption = c.requests.at(-1), count = c.requests.length
    c.find('澄清').props.onClick(); await c.settle()
    assert.equal(c.requests.length, count, 'edit waits for adoption')
    adoption.resolve({ session: view('one', { sessionRevision: 10, items: [item] }) }); await c.settle()
    const edit = JSON.parse(c.requests.at(-1).options.body)
    assert.equal(edit.action, 'edit')
    assert.equal(edit.expectedSessionRevision, 10)
    assert.equal(edit.fields.unknownResolutions[0].resolution, 'clarify')
    assert.match(c.text(c.tree), /当前：澄清/)
    c.requests.at(-1).resolve({ session: view('one', { sessionRevision: 11, items: [{ ...item, unknowns: [{ ...item.unknowns[0], resolution: 'clarify' }] }] }) }); await c.settle()
  } finally { c.unmount() }
})

test('timed out adoption blocks queued edits until the session is reloaded', async () => {
  const c = client({}, { shortReadTimeout: true })
  try {
    await list(c)
    c.find('one ·').props.onClick(); c.render()
    const item = { itemId: 'I-1', recommendedRoute: 'create', candidate: {}, unknowns: [{ description: '需要核对实现', blocking: true, resolution: 'investigate' }] }
    const investigation = { investigationId: 'INV-20261107000000-abcdef', sessionId: 'one', inputRevision: 7, question: '调查问题', verdict: 'answered', source: 'observed_evidence', findings: [] }
    c.requests.at(-1).resolve({ session: view('one', { items: [item], readiness: { ready: true, reasons: [] } }), investigations: [investigation] }); await c.settle()
    c.find('采纳用于此未知项').props.onClick(); await c.settle()
    const adoption = c.requests.at(-1), count = c.requests.length
    c.find('澄清').props.onClick(); await c.settle()
    await new Promise(resolve => setTimeout(resolve, 80)); await c.settle()
    assert.equal(c.requests.length, count, 'queued edit must not be sent with an uncertain revision')
    assert.match(c.text(c.tree), /采纳结果未知/)
    c.find('保存并检查，进入最终确认').props.onClick(); c.render()
    assert.match(c.text(c.tree), /调查采纳结果未知，请重新加载会话核对后再操作/)
    assert.doesNotMatch(c.text(c.tree), /确认并保存这份草案/)
    let prompts = 0
    c.setConfirm(() => { prompts++; return false })
    c.find('重新加载会话').props.onClick(); c.render()
    assert.equal(prompts, 1, 'unsaved unknown selection requires confirmation before reload')
    assert.equal(c.requests.length, count)
    assert.match(c.text(c.tree), /当前：澄清/)
    adoption.resolve({ session: view('one', { sessionRevision: 10, items: [item] }) }); await c.settle()
    assert.doesNotMatch(c.text(c.tree), /已采纳该调查/)
  } finally { c.unmount() }
})

test('late investigation cannot appear after switching sessions', async () => {
  const c = client()
  try {
    await list(c, [{ sessionId: 'one', state: 'reviewing' }, { sessionId: 'two', state: 'reviewing' }])
    c.find('one ·').props.onClick(); c.render()
    c.requests.at(-1).resolve({ session: view('one') }); await c.settle()
    c.actions.startInvestigation('调查问题'); c.render()
    const request = c.requests.at(-1)
    assert.equal(JSON.parse(request.options.body).expectedInputRevision, 7)
    c.find('返回原话').props.onClick(); c.render()
    await list(c, [{ sessionId: 'two', state: 'reviewing' }])
    c.find('two ·').props.onClick(); c.render()
    c.requests.at(-1).resolve({ session: view('two'), investigations: [] }); await c.settle()
    request.resolve({ investigation: { investigationId: 'INV-20261107000000-abcdef', sessionId: 'one', inputRevision: 7, question: '迟到调查' } }); await c.settle()
    assert.doesNotMatch(c.text(c.tree), /迟到调查/)
  } finally { c.unmount() }
})

test('cancelling investigation reports that server work may continue', async () => {
  const c = client()
  try {
    await list(c)
    c.find('one ·').props.onClick(); c.render()
    c.requests.at(-1).resolve({ session: view('one') }); await c.settle()
    c.actions.startInvestigation('调查问题'); c.render()
    c.actions.cancelInvestigation(); c.render()
    assert.match(c.text(c.tree), /服务端调查可能仍在完成/)
    assert.doesNotMatch(c.text(c.tree), /没有写入任何证据/)
  } finally { c.unmount() }
})

test('older answer history pages retry without replacing already loaded records', async () => {
  const c = client()
  try {
    await list(c)
    c.find('one ·').props.onClick(); c.render()
    const snapshot = 'a'.repeat(64)
    c.requests.at(-1).resolve({ session: view('one', { historicalAnswers: [{ answerId: 'recent', text: '最近回答', inputRevision: 1 }], historicalAnswersNext: 20, historicalAnswersSnapshot: snapshot }) })
    await c.settle()
    c.find('加载较早回答').props.onClick(); c.render()
    c.requests.at(-1).reject(new Error('网络失败')); await c.settle()
    assert.match(c.text(c.tree), /最近回答/)
    assert.match(c.text(c.tree), /读取较早回答失败/)
    c.find('加载较早回答').props.onClick(); c.render()
    assert.match(c.requests.at(-1).url, /offset=20/)
    c.requests.at(-1).resolve({ ok: true, sessionId: 'one', offset: 20, snapshot, total: 22, answers: [{ answerId: 'bad', text: { secret: 'invalid-object' }, inputRevision: 1, superseded: false }], next: null }); await c.settle()
    assert.match(c.text(c.tree), /回答历史响应无效/)
    assert.doesNotMatch(c.text(c.tree), /invalid-object/)
    assert.match(c.text(c.tree), /最近回答/)
    c.find('加载较早回答').props.onClick(); c.render()
    c.requests.at(-1).resolve({ ok: true, sessionId: 'one', offset: 20, snapshot, total: 21, answers: [{ answerId: 'older', text: '更早回答', inputRevision: 1, superseded: false }], next: null }); await c.settle()
    assert.match(c.text(c.tree), /最近回答/)
    assert.match(c.text(c.tree), /更早回答/)
    assert.equal(c.nodes().some(node => node.type === 'button' && c.text(node).includes('加载较早回答')), false)
  } finally { c.unmount() }
})

test('answer history timeout permits retry and ignores the late page', async () => {
  const c = client({}, { shortReadTimeout: true })
  try {
    await list(c)
    c.find('one ·').props.onClick(); c.render()
    const snapshot = 'c'.repeat(64)
    c.requests.at(-1).resolve({ session: view('one', { historicalAnswers: [{ answerId: 'recent', text: '最近回答', inputRevision: 1 }], historicalAnswersNext: 20, historicalAnswersSnapshot: snapshot }) })
    await c.settle()
    c.find('加载较早回答').props.onClick(); c.render()
    const late = c.requests.at(-1)
    await new Promise(resolve => setTimeout(resolve, 60)); await c.settle()
    assert.match(c.text(c.tree), /读取超时/)
    c.find('加载较早回答').props.onClick(); c.render()
    c.requests.at(-1).resolve({ ok: true, sessionId: 'one', offset: 20, snapshot, total: 21, answers: [{ answerId: 'new', text: '有效回答', inputRevision: 1, superseded: false }], next: null }); await c.settle()
    late.resolve({ ok: true, sessionId: 'one', offset: 20, snapshot, total: 21, answers: [{ answerId: 'old', text: '迟到回答', inputRevision: 1, superseded: false }], next: null }); await c.settle()
    assert.match(c.text(c.tree), /有效回答/)
    assert.doesNotMatch(c.text(c.tree), /迟到回答/)
  } finally { c.unmount() }
})

test('late answer history page is ignored after switching project', async () => {
  const c = client()
  try {
    await list(c)
    c.find('one ·').props.onClick(); c.render()
    const snapshot = 'b'.repeat(64)
    c.requests.at(-1).resolve({ session: view('one', { historicalAnswers: [{ answerId: 'recent', text: '最近回答', inputRevision: 1 }], historicalAnswersNext: 20, historicalAnswersSnapshot: snapshot }) })
    await c.settle()
    c.find('加载较早回答').props.onClick(); c.render()
    const late = c.requests.at(-1)
    c.render({ project: 'B', projectId: 'B' }); c.render()
    late.resolve({ ok: true, sessionId: 'one', offset: 20, snapshot, answers: [{ answerId: 'late', text: '迟到回答', inputRevision: 1 }], next: null })
    await c.settle()
    assert.doesNotMatch(c.text(c.tree), /迟到回答/)
  } finally { c.unmount() }
})

test('answer history can be loaded again after switching away and back during a request', async () => {
  const c = client()
  try {
    await list(c)
    c.find('one ·').props.onClick(); c.render()
    const snapshot = 'd'.repeat(64)
    const session = view('one', { historicalAnswers: [{ answerId: 'recent', text: '最近回答', inputRevision: 1 }], historicalAnswersNext: 20, historicalAnswersSnapshot: snapshot })
    c.requests.at(-1).resolve({ session }); await c.settle()
    c.find('加载较早回答').props.onClick(); c.render()
    const old = c.requests.at(-1)
    c.render({ project: 'B', projectId: 'B' }); c.render()
    c.render({ project: 'A', projectId: 'A' }); c.render()
    await list(c)
    c.find('one ·').props.onClick(); c.render()
    c.requests.at(-1).resolve({ session }); await c.settle()
    assert.notEqual(c.find('加载较早回答').props.disabled, true)
    old.resolve({ ok: true, sessionId: 'one', offset: 20, snapshot, total: 21, answers: [{ text: '迟到回答', superseded: false }], next: null }); await c.settle()
    assert.doesNotMatch(c.text(c.tree), /迟到回答/)
  } finally { c.unmount() }
})

test('reloading the current session applies its latest revision and exposes read failures', async () => {
  const c = client()
  try {
    await list(c)
    c.find('one ·').props.onClick(); c.render()
    const input = { text: '原话', rawText: '原话', inputRevision: 7, explicit: {} }
    c.requests.at(-1).resolve({ session: view('one', { input }) }); await c.settle()
    c.find('重新加载会话').props.onClick(); c.render()
    c.requests.at(-1).reject(new Error('读取失败')); await c.settle()
    assert.match(c.text(c.tree), /重新加载失败：读取失败/)
    c.find('重新加载会话').props.onClick(); c.render()
    c.requests.at(-1).resolve({ session: view('one', { input, sessionRevision: 10 }) }); await c.settle()
    await c.actions.runAnalyze(); await c.settle()
    assert.equal(JSON.parse(c.requests.at(-1).options.body).expectedSessionRevision, 10)
  } finally { c.unmount() }
})

test('reloading the current session preserves edits made while the request is pending', async () => {
  const c = client()
  try {
    await list(c)
    c.find('one ·').props.onClick(); c.render()
    const candidate = { title: '原始标题', problem: '问题', goal: '目标', inScope: [], outOfScope: [], acceptance: [] }
    const input = { text: '原话', rawText: '原话', inputRevision: 7, explicit: {} }
    c.requests.at(-1).resolve({ session: view('one', { input, items: [{ itemId: 'I-1', recommendedRoute: 'create', candidate }] }) })
    await c.settle()
    c.find('重新加载会话').props.onClick(); c.render()
    const reload = c.requests.at(-1)
    c.actions.setManualField('I-1', 'title', '加载期间编辑'); c.render()
    reload.resolve({ session: view('one', { sessionRevision: 10, input, items: [{ itemId: 'I-1', recommendedRoute: 'create', candidate }] }) })
    await c.settle()
    assert.match(c.text(c.tree), /加载期间输入已变化/)
    assert.ok(c.nodes().some(node => node.props?.value === '加载期间编辑'))
  } finally { c.unmount() }
})

test('clarification candidates expose accessible names and keep route choices available', async () => {
  const c = client()
  try {
    await list(c)
    c.find('one ·').props.onClick(); c.render()
    const candidate = { title: '标题一', problem: '问题一', goal: '目标一', inScope: ['范围'], outOfScope: [], acceptance: [{ action: '操作', expected: '结果' }, { action: '第二个操作', expected: '第二个结果' }] }
    c.requests.at(-1).resolve({ session: view('one', { items: [{ itemId: 'I-1', recommendedRoute: 'create', candidate }, { itemId: 'I-2', recommendedRoute: 'create', candidate }] }) })
    await c.settle()
    const controls = c.nodes().filter(node => ['input', 'textarea'].includes(node.type))
    assert.ok(controls.some(node => node.props['aria-label'] === '意图 1 标题'))
    assert.ok(controls.some(node => node.props['aria-label'] === '意图 2 标题'))
    assert.ok(controls.some(node => node.props['aria-label'] === '意图 1 问题'))
    assert.ok(controls.some(node => node.props['aria-label'] === '意图 2 范围内'))
    assert.ok(controls.some(node => String(node.props['aria-label']).startsWith('意图 2 验收标准 2：')))
    assert.ok(c.nodes().some(node => node.type === 'summary' && c.text(node).includes('查看或修改')))
    const finalControls = c.nodes(c.actions.renderConfirm()).filter(node => node.type === 'textarea')
    assert.ok(finalControls.some(node => node.props['aria-label'] === '意图 1 问题'))
    assert.ok(finalControls.some(node => node.props['aria-label'] === '意图 2 期望行为'))
  } finally { c.unmount() }
})

test('manual clarification does not describe the route as an AI suggestion', async () => {
  const c = client()
  try {
    await list(c)
    c.find('one ·').props.onClick(); c.render()
    c.requests.at(-1).resolve({ session: view('one', { manual: true, items: [{ itemId: 'I-1', recommendedRoute: 'create', candidate: { title: '手动需求' } }] }) })
    await c.settle()
    const summaries = c.nodes().filter(node => node.type === 'summary').map(node => c.text(node))
    assert.ok(summaries.some(label => label.includes('当前去向')))
    assert.ok(summaries.every(label => !label.includes('AI 建议去向')))
  } finally { c.unmount() }
})

test('history is an explicit project-scoped GET and restores same ID latest input without writes', async () => {
  const c = client(); await list(c)
  assert.match(c.requests[0].url, /project=A/)
  assert.match(c.requests[0].url, /action=history/)
  assert.ok(c.text(c.tree).includes('one · reviewing · 2026-11-04'))
  c.find('one ·').props.onClick(); c.render()
  assert.match(c.requests.at(-1).url, /session=one/)
  c.requests.at(-1).resolve({ session: view('one') }); await c.settle()
  assert.equal(c.tree.props.dataSessionId, 'one')
  assert.equal(c.tree.props.dataScreen, 'review')
  c.find('返回原话').props.onClick(); c.render()
  assert.equal(c.nodes().find(n => n.type === 'textarea').props.value, 'input-one')
  assert.ok(c.requests.every(r => !r.options.method || r.options.method === 'GET'))
  c.unmount()
})

test('leaving a restored AI candidate without editing does not submit it as a human edit', async () => {
  const c = client()
  try {
    await list(c)
    c.find('one ·').props.onClick(); c.render()
    const candidate = { title: 'AI title', problem: 'AI problem', goal: 'AI goal', inScope: [], outOfScope: [], acceptance: [] }
    c.requests.at(-1).resolve({ session: view('one', { input: { rawText: 'input-one', inputRevision: 7, explicit: {} }, items: [{ itemId: 'I-1', recommendedRoute: 'create', candidate }] }) })
    await c.settle()
    const before = c.requests.length
    c.find('暂不处理').props.onClick(); await c.settle()
    assert.equal(c.requests.length, before, 'leaving an untouched candidate must not send edit')
    assert.equal(c.closed, 1)
  } finally { c.unmount() }
})

test('an unsubmitted legacy answer choice is protected on unload and close', async () => {
  const c = client()
  try {
    await list(c, ['one', 'two'].map(sessionId => ({ sessionId, state: 'reviewing' })))
    c.find('one ·').props.onClick(); c.render()
    c.requests.at(-1).resolve({ session: view('one', { nextQuestion: { text: '请选择', options: [{ id: 'a', label: '选项 A' }] } }) })
    await c.settle()
    c.find('选项 A').props.onClick(); c.render()
    let prevented = false
    c.dispatch('beforeunload', { preventDefault() { prevented = true }, returnValue: undefined })
    assert.equal(prevented, true)
    c.setConfirm(() => false)
    c.find('暂不处理').props.onClick(); await c.settle()
    assert.equal(c.closed, 0)
    assert.equal(c.find('选项 A').props['aria-pressed'], true)
    c.find('返回原话').props.onClick(); c.render()
    const before = c.requests.length
    c.find('two ·').props.onClick(); c.render()
    assert.equal(c.requests.length, before, 'cancelled history switch must not load another session')
    c.setConfirm(() => true)
    c.find('two ·').props.onClick(); c.render()
    c.requests.at(-1).resolve({ session: view('two', { nextQuestion: { text: '新问题', options: [{ id: 'a', label: '选项 A' }] } }) })
    await c.settle()
    assert.equal(c.find('选项 A').props['aria-pressed'], false)
  } finally { c.unmount() }
})

test('load failures are explicit and retry loads original selection without creating a draft', async () => {
  const c = client(); await list(c)
  c.find('one ·').props.onClick(); c.render()
  c.requests.at(-1).reject(new Error('not found')); await c.settle()
  assert.ok(c.text(c.tree).includes('not found'))
  assert.equal(c.tree.props.dataSessionId, 'pending')
  c.find('重试加载').props.onClick(); c.render()
  assert.match(c.requests.at(-1).url, /session=one/)
  c.requests.at(-1).resolve({ session: view('one') }); await c.settle()
  assert.equal(c.tree.props.dataSessionId, 'one'); c.unmount()
})

test('history request is aborted when the project changes', async () => {
  const c = client()
  try {
    c.find('查看服务端意图历史').props.onClick(); c.render()
    const request = c.requests.at(-1)
    assert.equal(request.options.signal.aborted, false)
    c.render({ projectId: 'B', project: 'B' }); c.render()
    assert.equal(request.options.signal.aborted, true)
    request.resolve({ ok: true, sessions: [{ sessionId: 'old' }] }); await c.settle()
    assert.ok(!c.text(c.tree).includes('old'))
  } finally { c.unmount() }
})

test('malformed history rows report an error and can be retried', async () => {
  const c = client()
  try {
    c.find('查看服务端意图历史').props.onClick(); c.render()
    c.requests.at(-1).resolve({ ok: true, sessions: [null, { state: 'reviewing' }] }); await c.settle()
    assert.ok(c.text(c.tree).includes('意图历史响应不完整'))
    assert.equal(c.tree.props.dataSessionId, 'pending')
    c.find('重试加载').props.onClick(); c.render()
    c.requests.at(-1).resolve({ ok: true, sessions: [{ sessionId: 'one', state: 'reviewing' }] }); await c.settle()
    assert.ok(c.text(c.tree).includes('one · reviewing'))
  } finally { c.unmount() }
})

test('out of order load success and failure cannot overwrite the newest selection', async () => {
  for (const failure of [false, true]) {
    const c = client(); await list(c, ['one', 'two'].map(sessionId => ({ sessionId, state: 'reviewing' })))
    c.find('one ·').props.onClick(); c.render(); const old = c.requests.at(-1)
    c.find('two ·').props.onClick(); c.render(); c.requests.at(-1).resolve({ session: view('two') }); await c.settle()
    if (failure) old.reject(new Error('late error')); else old.resolve({ session: view('one') })
    await c.settle(); assert.equal(c.tree.props.dataSessionId, 'two'); assert.ok(!c.text(c.tree).includes('late error')); c.unmount()
  }
})

test('project switching and closing invalidate late list/load successes and failures', async () => {
  for (const failure of [false, true]) for (const close of [false, true]) {
    const c = client(); await list(c)
    c.find('one ·').props.onClick(); c.render(); const old = c.requests.at(-1)
    if (close) c.tree.props.onClose(); else { c.render({ projectId: 'B', project: 'B' }); c.render() }
    if (failure) old.reject(new Error('late error')); else old.resolve({ session: view('one') })
    await c.settle(); assert.equal(c.tree.props.dataSessionId, 'pending'); assert.ok(!c.text(c.tree).includes('late error'))
    if (close) assert.equal(c.closed, 1)
    else { await list(c, []); assert.match(c.requests.at(-1).url, /project=B/) }
    c.unmount()
  }
})

test('committed history is receipt only, reopens the original requirement without POST', async () => {
  const c = client(); await list(c)
  c.find('one ·').props.onClick(); c.render()
  c.requests.at(-1).resolve({ session: view('one', { state: 'committed', receipt: { id: 'receipt-original' }, artifacts: [{ kind: 'requirement', id: 'REQ-original' }] }) }); await c.settle()
  assert.equal(c.tree.props.dataScreen, 'receipt')
  assert.ok(c.text(c.tree).includes('receipt-original'))
  assert.ok(!c.nodes().some(n => n.type === 'button' && c.text(n).includes('确认并保存')))
  c.find('打开需求详情').props.onClick(); assert.deepEqual(c.opened, ['REQ-original'])
  assert.ok(c.requests.every(r => !r.options.method)); c.unmount()
})

test('draft save failure preserves real editor values and retry submits original binding', async () => {
  const c = client(); await list(c)
  c.find('one ·').props.onClick(); c.render()
  const docDraft = { goal: 'saved goal', docHash: 'sha256:original', draftRevision: 3, features: [], acceptance: [] }
  c.requests.at(-1).resolve({ session: view('one', { docDraft }) }); await c.settle()
  const panel = () => c.nodes().find(n => typeof n.type === 'function' && n.type.name === 'IntentDraftPanel')
  panel().props.onStartEdit('goal', 'saved goal'); c.render()
  panel().props.onChangeEdit('unsaved human edit'); c.render()
  panel().props.onSaveEdit(); c.render()
  const first = c.requests.at(-1)
  assert.equal(JSON.parse(first.options.body).docDraft.goal, 'unsaved human edit')
  first.reject(new Error('save failed')); await c.settle()
  assert.equal(panel().props.editingKey, 'goal')
  assert.equal(panel().props.editValue, 'unsaved human edit')
  assert.equal(panel().props.editBusy, false)
  assert.ok(c.text(c.tree).includes('save failed'))
  assert.ok(!c.text(c.tree).includes('已保存草案'))
  panel().props.onSaveEdit(); c.render()
  assert.equal(c.requests.at(-1).options.body, first.options.body)
  c.requests.at(-1).resolve({ session: view('one', { docDraft: { ...docDraft, goal: 'unsaved human edit', draftRevision: 4 } }) }); await c.settle()
  assert.equal(panel().props.editingKey, null)
  assert.equal(panel().props.draft.goal, 'unsaved human edit'); c.unmount()
})

test('ABA project changes invalidate old A success and error even after returning to A', async () => {
  for (const failure of [false, true]) {
    const c = client(); await list(c)
    c.find('one ·').props.onClick(); c.render(); const old = c.requests.at(-1)
    c.render({ projectId: 'B', project: 'B' }); c.render()
    c.render({ projectId: 'A', project: 'A' }); c.render()
    if (failure) old.reject(new Error('stale A failure')); else old.resolve({ session: view('one') })
    await c.settle(); assert.equal(c.tree.props.dataSessionId, 'pending'); assert.ok(!c.text(c.tree).includes('stale A failure')); c.unmount()
  }
})

test('late history list success and error are ignored after scope switch or close', async () => {
  for (const failure of [false, true]) for (const close of [false, true]) {
    const c = client(); c.find('查看服务端意图历史').props.onClick(); c.render(); const old = c.requests.at(-1)
    assert.equal(c.find('分析意图').props.disabled, true)
    assert.ok(!c.nodes().some(n => n.type === 'button' && c.text(n).includes('确认并保存')))
    if (close) c.tree.props.onClose(); else { c.render({ projectId: 'B', project: 'B' }); c.render() }
    if (failure) old.reject(new Error('late list failure')); else old.resolve({ sessions: [{ sessionId: 'old-A', state: 'reviewing' }] })
    await c.settle(); assert.ok(!c.text(c.tree).includes('old-A')); assert.ok(!c.text(c.tree).includes('late list failure')); c.unmount()
  }
})

test('actual client draft-save request is accepted by real handler and restores persisted edit', async () => {
  const temp = resolve('tmp'); mkdirSync(temp, { recursive: true })
  const root = mkdtempSync(join(temp, 'history-client-handler-'))
  const c = client({ root })
  try {
    let saved = core.createSession({ root, project: { id: 'A' }, input: { text: 'Original request' } })
    saved = core.setDocDraft({ session: saved, docDraft: { goal: 'Original goal' } })
    saved = core.saveSession({ root, session: saved })
    await list(c, [{ sessionId: saved.sessionId, state: saved.state }])
    c.find(`${saved.sessionId} ·`).props.onClick(); c.render()
    c.requests.at(-1).resolve(await handleIntentLoad({ root, projectId: 'A', query: { session: saved.sessionId } })); await c.settle()
    const panel = () => c.nodes().find(n => typeof n.type === 'function' && n.type.name === 'IntentDraftPanel')
    panel().props.onStartEdit('goal', 'Original goal'); c.render()
    panel().props.onChangeEdit('Persisted human edit'); c.render()
    panel().props.onSaveEdit(); c.render()
    const request = c.requests.at(-1)
    const body = JSON.parse(request.options.body)
    assert.equal(body.expectedSessionRevision, saved.sessionRevision)
    assert.equal(body.expectedDraftRevision, saved.docDraft.draftRevision)
    request.resolve(await handleIntentRequest({ root, body })); await c.settle()
    assert.equal(panel().props.editingKey, null)
    const loaded = await handleIntentLoad({ root, projectId: 'A', query: { session: saved.sessionId } })
    assert.equal(loaded.session.sessionId, saved.sessionId)
    assert.equal(loaded.session.docDraft.goal, 'Persisted human edit')
    assert.ok(loaded.session.draftRevision > saved.draftRevision)
  } finally { c.unmount(); rmSync(root, { recursive: true, force: true }) }
})

test('recovered draft cannot overwrite a concurrent server edit', async () => {
  const temp = resolve('tmp'); mkdirSync(temp, { recursive: true })
  const root = mkdtempSync(join(temp, 'history-recovery-concurrency-'))
  const c = client({ root })
  try {
    let saved = core.createSession({ root, project: { id: 'A' }, input: { text: 'Original request' } })
    saved = core.setDocDraft({ session: saved, docDraft: { goal: 'Original goal' } })
    saved = core.saveSession({ root, session: saved })
    await list(c, [{ sessionId: saved.sessionId, state: saved.state }])
    c.find(`${saved.sessionId} ·`).props.onClick(); c.render()
    c.requests.at(-1).resolve(await handleIntentLoad({ root, projectId: 'A', query: { session: saved.sessionId } })); await c.settle()
    const panel = () => c.nodes().find(n => typeof n.type === 'function' && n.type.name === 'IntentDraftPanel')
    panel().props.onStartEdit('goal', 'Original goal'); c.render()
    panel().props.onChangeEdit('Local recovered goal'); c.render()
    c.remount()
    c.find('核对版本并恢复编辑').props.onClick(); c.render()
    c.requests.at(-1).resolve(await handleIntentLoad({ root, projectId: 'A', query: { session: saved.sessionId } })); await c.settle()
    assert.equal(panel().props.editValue, 'Local recovered goal')

    await handleIntentRequest({ root, body: { action: 'set-doc-draft', sessionId: saved.sessionId, expectedSessionRevision: saved.sessionRevision, expectedDraftRevision: saved.docDraft.draftRevision, docDraft: { goal: 'Concurrent goal' } } })
    panel().props.onSaveEdit(); c.render()
    const request = c.requests.at(-1)
    const body = JSON.parse(request.options.body)
    assert.equal(body.expectedSessionRevision, saved.sessionRevision)
    assert.equal(body.expectedDraftRevision, saved.docDraft.draftRevision)
    let failure
    try { await handleIntentRequest({ root, body }) } catch (error) { failure = error }
    assert.equal(failure?.code, 'stale-session')
    request.reject(failure); await c.settle()
    assert.equal(panel().props.editValue, 'Local recovered goal')
    const latest = await handleIntentLoad({ root, projectId: 'A', query: { session: saved.sessionId } })
    assert.equal(latest.session.docDraft.goal, 'Concurrent goal')
  } finally { c.unmount(); rmSync(root, { recursive: true, force: true }) }
})

test('late edit success and failure cannot cross project epochs or close', async () => {
  for (const failure of [false, true]) for (const close of [false, true]) {
    const c = client(); await list(c)
    c.find('one ·').props.onClick(); c.render()
    c.requests.at(-1).resolve({ session: view('one') }); await c.settle()
    c.actions.changePriority('P2')
    await c.settle(); const old = c.requests.at(-1)
    assert.equal(JSON.parse(old.options.body).action, 'edit')
    if (close) c.unmount()
    else { c.render({ project: 'B', projectId: 'B' }); c.render() }
    if (failure) old.reject(new Error('old A edit failed'))
    else old.resolve({ session: view('one', { input: { inputRevision: 8 } }) })
    await c.settle()
    assert.ok(!c.text(c.tree).includes('old A edit failed'))
    if (!close) assert.equal(c.tree.props.dataSessionId, 'pending')
    c.unmount()
  }
})

test('edit conflict rejects a reload for another session and preserves local choice', async () => {
  const c = client()
  try {
    await list(c)
    c.find('one ·').props.onClick(); c.render()
    c.requests.at(-1).resolve({ session: view('one') }); await c.settle()
    c.actions.changePriority('P2'); await c.settle()
    c.requests.at(-1).reject(Object.assign(new Error('版本冲突'), { code: 'stale-session' })); await c.settle()
    c.requests.at(-1).resolve({ session: view('other') }); await c.settle()
    assert.ok(c.text(c.tree).includes('会话已变化，重新读取失败；当前填写仍保留，请重试。'))
    assert.ok(!c.text(c.tree).includes('会话已重新读取，请核对当前编辑后重试。'))
    assert.equal(c.actions.priorityChoice, 'P2')
    assert.equal(c.tree.props.dataSessionId, 'one')
  } finally { c.unmount() }
})

test('conflict reload times out even if fetch ignores abort and ignores its late result', async () => {
  const c = client({}, { shortReadTimeout: true })
  try {
    await list(c)
    c.find('one ·').props.onClick(); c.render()
    c.requests.at(-1).resolve({ session: view('one') }); await c.settle()
    c.actions.changePriority('P2'); await c.settle()
    c.requests.at(-1).reject(Object.assign(new Error('版本冲突'), { code: 'stale-session' })); await c.settle()
    const late = c.requests.at(-1)
    await new Promise(resolve => setTimeout(resolve, 60)); await c.settle()
    assert.equal(late.options.signal.aborted, true)
    assert.ok(c.text(c.tree).includes('会话已变化，重新读取失败；当前填写仍保留，请重试。'))
    c.actions.changePriority('P3'); await c.settle()
    c.requests.at(-1).resolve({ session: view('one', { sessionRevision: 10, input: { rawText: 'new input', inputRevision: 8, explicit: { priority: 'P3' } } }) }); await c.settle()
    late.resolve({ session: view('one') }); await c.settle()
    assert.equal(c.actions.priorityChoice, 'P3')
    assert.ok(!c.text(c.tree).includes('会话已重新读取，请核对当前编辑后重试。'))
  } finally { c.unmount() }
})

test('late conflict reload does not overwrite a newer successful edit', async () => {
  const c = client()
  try {
    await list(c)
    c.find('one ·').props.onClick(); c.render()
    c.requests.at(-1).resolve({ session: view('one') }); await c.settle()
    c.actions.changePriority('P2'); await c.settle()
    c.requests.at(-1).reject(Object.assign(new Error('版本冲突'), { code: 'stale-session' })); await c.settle()
    const reload = c.requests.at(-1)
    c.actions.changePriority('P3'); await c.settle()
    c.requests.at(-1).resolve({ session: view('one', { sessionRevision: 10, input: { rawText: 'new input', inputRevision: 8, explicit: { priority: 'P3' } } }) }); await c.settle()
    reload.resolve({ session: view('one') }); await c.settle()
    assert.equal(c.actions.priorityChoice, 'P3')
    assert.ok(c.text(c.tree).includes('会话在读取期间再次变化，请核对当前编辑。'))
    assert.ok(!c.text(c.tree).includes('会话已重新读取，请核对当前编辑后重试。'))
  } finally { c.unmount() }
})

test('conflict reload does not overwrite a newer edit still in flight', async () => {
  const c = client()
  try {
    await list(c)
    c.find('one ·').props.onClick(); c.render()
    c.requests.at(-1).resolve({ session: view('one') }); await c.settle()
    c.actions.changePriority('P2'); await c.settle()
    c.requests.at(-1).reject(Object.assign(new Error('版本冲突'), { code: 'stale-session' })); await c.settle()
    const reload = c.requests.at(-1)
    c.actions.changePriority('P3'); await c.settle()
    const edit = c.requests.at(-1)
    reload.resolve({ session: view('one') }); await c.settle()
    assert.equal(c.actions.priorityChoice, 'P3')
    assert.ok(c.text(c.tree).includes('会话在读取期间再次变化，请核对当前编辑。'))
    edit.resolve({ session: view('one', { sessionRevision: 10, input: { rawText: 'new input', inputRevision: 8, explicit: { priority: 'P3' } } }) }); await c.settle()
    assert.equal(c.actions.priorityChoice, 'P3')
  } finally { c.unmount() }
})

test('project change clears restored owner and priority before new input', async () => {
  const c = client(); await list(c)
  c.find('one ·').props.onClick(); c.render()
  c.requests.at(-1).resolve({ session: view('one') }); await c.settle()
  assert.equal(c.actions.priorityChoice, 'P1')
  assert.equal(c.actions.ownerChoice, 'owner')
  c.render({ project: 'B', projectId: 'B' }); c.render()
  assert.equal(c.actions.priorityChoice, '')
  assert.equal(c.actions.ownerChoice, '')
  c.unmount()
})

test('ALL and absent project do not request server history', () => {
  for (const project of ['ALL', '']) {
    const c = client({ project, projectId: project }); assert.equal(c.find('查看服务端意图历史').props.disabled, true); assert.equal(c.requests.length, 0); c.unmount()
  }
})
