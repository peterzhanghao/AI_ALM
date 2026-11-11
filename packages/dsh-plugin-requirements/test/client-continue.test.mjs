import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')
function fragment(startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, startMarker)
  const end = source.indexOf(endMarker, start)
  assert.ok(end > start, endMarker)
  return source.slice(start, end)
}

test('repair start fetches native decision and routes fallback to existing answer UI, otherwise continues same run', async () => {
 for (const pending of [true,false]) {
 const calls=[], answered=[], started=[]
 let reloads=0
 const context=vm.createContext({data:{root:'D:/root'},root:'D:/fallback',
 writeJson:async(action,body)=>{calls.push(body);return body.mode==='decision'?{exists:true,decision:pending?'.alm/runs/RUN-012-decision.md':null}:{resumed:true}},
 setAnswerItem:entry=>answered.push(entry),setStartItem:entry=>started.push(entry),reload:()=>{reloads++},window:{alert:assert.fail}})
 vm.runInContext('this.cb=({' + fragment('              onStart: async (entry, options) => {','\n              onAcceptance:') + '})',context)
 await context.cb.onStart({id:'REQ-1'})
 assert.deepEqual(calls.map(x=>x.mode),pending?['decision']:['decision','continue'])
 assert.equal(answered.length,pending?1:0);assert.equal(started.length,0);assert.equal(reloads,pending?0:1)
 }
})

// Execute production callback fragments, without a browser or delivery session.
test('continue-run dispatches only onContinueRun, never the new-start flow', () => {
  const item = { id: 'REQ-CONTINUE' }
  const calls = []
  const context = vm.createContext({ item, props: {
    onContinueRun: value => calls.push(value),
    onStart: () => assert.fail('continuing must not start another delivery'),
  } })
  const handler = fragment("        'continue-run':", '\n        start:')
  vm.runInContext('this.handlers = ({' + handler + '})', context)
  context.handlers['continue-run']()
  assert.deepEqual(calls, [item])
  context.props.onContinueRun = null
  assert.doesNotThrow(() => context.handlers['continue-run']())
})

function callbackHarness({ data = { root: 'D:/payload' }, root = 'D:/fallback', reject = false, result = { resumed: true } } = {}) {
  const calls = [], alerts = []
  let reloads = 0
  const context = vm.createContext({ data, root,
    writeJson(action, body, requestRoot) {
      calls.push({ action, body: JSON.parse(JSON.stringify(body)), root: requestRoot })
      return reject ? Promise.reject(new Error('blocked by fresh server state')) : Promise.resolve(result)
    },
    reload: () => { reloads++ },
    window: { alert: message => alerts.push(message) },
  })
  const callback = fragment('              onContinueRun: (entry) => {', '\n              onResumeRun:')
  vm.runInContext('this.callbacks = ({' + callback + '})', context)
  return { invoke: context.callbacks.onContinueRun, calls, alerts, reloads: () => reloads }
}
const flush = () => new Promise(resolve => setImmediate(resolve))

test('continue business refusal is not treated as HTTP success', async () => {
  const harness = callbackHarness({ result: { resumed: false, message: 'new decision requires an answer' } })
  harness.invoke({ id: 'REQ-CONTINUE' })
  await flush()
  assert.equal(harness.reloads(), 0)
  assert.equal(harness.calls.length, 1)
  assert.deepEqual(harness.alerts, ['继续失败：new decision requires an answer'])
})

function answerHarness(result) {
  const calls = [], alerts = []
  let done = 0
  const state = { saving: false, loading: false, result: null, error: null,
    decisionIdentity: { path: '.alm/runs/decision.md', contentHash: 'sha256-current-bytes' } }
  const context = vm.createContext({ window: { alert: message => alerts.push(message) }, state, selections:{D1:'A'},answer:'保留现有导航',choicesReady:true,identityReady:true,submitting:{current:false},
    item: { id: 'REQ-CONTINUE' }, root: 'D:/answer-root',
    setState(update) { Object.assign(state, typeof update === 'function' ? update(state) : update) },
    writeJson(action, body, root) {
      calls.push({ action, body: JSON.parse(JSON.stringify(body)), root })
      return Promise.resolve(result)
    },
    onDone: () => { done++ },
  })
  const start = source.indexOf('    function DecisionForm(')
  const end = source.indexOf('    function ', start + 5)
  assert.ok(start >= 0 && end > start)
  const modal = source.slice(start, end)
  const submitStart = modal.indexOf("      const submit = (action = 'choose') => {")
  const submitEnd = modal.indexOf('\n      return h(', submitStart)
  assert.ok(submitStart >= 0 && submitEnd > submitStart)
  vm.runInContext(modal.slice(submitStart, submitEnd) + '\nthis.submit = submit', context)
  return { state, calls, alerts, invoke: context.submit, done: () => done }
}

test('answer sends the displayed decision identity, not just text, and reports real success', async () => {
  const harness = answerHarness({ resumed: true })
  harness.invoke()
  await flush()
  assert.deepEqual(harness.calls, [{ action: 'run', root: 'D:/answer-root', body: {
    mode: 'answer', requirementId: 'REQ-CONTINUE', decisionResponse:{action:'choose',selections:{D1:'A'},note:'保留现有导航'},
    expectedDecision: { path: '.alm/runs/decision.md', contentHash: 'sha256-current-bytes' },
  } }])
  assert.equal(harness.done(), 1)
  assert.equal(harness.state.saving, false)
})

test('answer explicitly reports when original automatic advancement cannot resume', async () => {
 const harness=answerHarness({resumed:true,autoAdvanceResumed:false,autoAdvanceReason:'auto-facts-changed'})
 harness.invoke(); await flush()
 assert.equal(harness.done(),1)
 assert.match(harness.alerts[0],/自动推进未恢复.*auto-facts-changed/)
})

test('answer refusal keeps the dialog editable without invoking onDone or claiming success', async () => {
  const harness = answerHarness({ resumed: false, message: 'decision changed' })
  harness.invoke()
  await flush()
  assert.equal(harness.done(), 0)
  assert.equal(harness.state.result, null)
  assert.equal(harness.state.saving, false)
  assert.equal(harness.state.error, 'decision changed')
})

test('continue posts only mode and requirement identity with entry root priority, then reloads', async () => {
  const harness = callbackHarness()
  harness.invoke({ id: 'REQ-CONTINUE', root: 'D:/entry' })
  await flush()
  assert.deepEqual(harness.calls, [{ action: 'run', body: { mode: 'continue', requirementId: 'REQ-CONTINUE' }, root: 'D:/entry' }])
  assert.equal(harness.reloads(), 1)
  assert.deepEqual(harness.alerts, [])
})

test('continue falls back to payload root and then selected root without inventing an answer', async () => {
  for (const [data, expected] of [[{ root: 'D:/payload' }, 'D:/payload'], [null, 'D:/fallback']]) {
    const harness = callbackHarness({ data })
    harness.invoke({ id: 'REQ-CONTINUE' })
    await flush()
    assert.equal(harness.calls[0].root, expected)
    assert.deepEqual(Object.keys(harness.calls[0].body).sort(), ['mode', 'requirementId'])
    assert.equal(harness.reloads(), 1)
  }
})

test('continue failure is surfaced and never reloads as success or retries a start', async () => {
  const harness = callbackHarness({ reject: true })
  harness.invoke({ id: 'REQ-CONTINUE' })
  await flush()
  assert.equal(harness.calls.length, 1)
  assert.equal(harness.reloads(), 0)
  assert.deepEqual(harness.alerts, ['继续失败：blocked by fresh server state'])
})
