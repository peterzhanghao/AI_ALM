import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')
const slice = (from, to) => source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from)))
const gates = slice('      const analysisPending = () =>', '      const submitConfirm = () =>')
// These slices execute production closures, so supply their real history epoch
// dependencies rather than replacing the guards with always-true test stubs.
const historyCurrentSource = slice('      const historyCurrent =', '      const invalidateHistory =')
function historyContext() {
  return {
    history: { loading: false, error: null },
    historyRequestRef: { current: 1 },
    historyScope: 'test-root:ALM',
    historyScopeRef: { current: 'test-root:ALM' },
    adoptionUncertainRef: { current: false },
  }
}

function harness(reasons = [], fail = false) {
  const calls = [], notices = []
  const ref = { current: { sessionId: 'INT-test', input: { inputRevision: 1 }, readiness: { ready: false, reasons: [{ code: 'missing-acceptance' }] } } }
  const context = vm.createContext({
    ...historyContext(),
    sessionRef: ref, session: ref.current, busy: false, editBusy: false, groupBusy: false, answerBusy: false, groupFeedback: null,
    confirmEntryRef: { current: false }, editQueueRef: { current: Promise.resolve() }, mountedRef: { current: true },
    idemRef: { current: null }, intentIdemKey: () => 'idem', blockerRef: { current: null }, priorityRef: { current: null },
    setBusy: value => calls.push(['busy', value]), setError: value => calls.push(['error', value]),
    setNotice: value => notices.push(value), setConfirmState: value => calls.push(['confirmState', value]),
    setScreen: value => calls.push(['screen', value]), requestAnimationFrame: fn => fn(), errorOf: error => ({ message: error.message }),
    async flushAllEdits() {
      calls.push(['flush'])
      if (fail) throw new Error('server failed')
      ref.current = { ...ref.current, readiness: { ready: reasons.length === 0, reasons } }
      return ref.current
    },
  })
  vm.runInContext(historyCurrentSource + gates + '\nthis.enter = enterConfirm; this.gate = confirmationGate; this.formGate = confirmationFormGate', context)
  return { context, calls, notices, ref }
}

test('save/check flushes before deciding entry; only priority and human confirmation are deferred', async () => {
  const app = harness([{ code: 'needs-priority' }, { code: 'not-confirmed' }])
  await app.context.enter()
  assert.equal(app.calls[1][0], 'error')
  assert.ok(app.calls.findIndex(c => c[0] === 'flush') < app.calls.findIndex(c => c[0] === 'screen'))
  assert.equal(app.calls.find(c => c[0] === 'screen')[1], 'confirm')
  assert.equal(app.context.gate(true).ready, false, 'priority is never waived at final submit')
  app.ref.current.readiness = { ready: false, reasons: [{ code: 'not-confirmed' }] }
  assert.equal(app.context.gate().ready, false)
  assert.equal(app.context.gate(true).ready, true, 'actual final button supplies confirmation payload')
})

test('true unknowns, missing acceptance and missing readiness cannot be bypassed by save/check', async () => {
  for (const code of ['unresolved-unknown', 'missing-acceptance', 'readiness-unavailable', 'stale-context']) {
    const app = harness([{ code, message: code }, { code: 'not-confirmed' }])
    await app.context.enter()
    assert.equal(app.calls.some(c => c[0] === 'screen'), false, code)
    assert.equal(app.context.gate(true).ready, false, code)
    assert.ok(app.notices[0].includes(code))
  }
  const app = harness()
  app.ref.current.readiness = null
  assert.equal(app.context.gate(true).ready, false)
})

test('uncertain investigation adoption blocks final confirmation', () => {
  const app = harness()
  app.ref.current.readiness = { ready: true, reasons: [] }
  app.context.adoptionUncertainRef.current = true
  assert.equal(app.context.gate(true).ready, false)
  assert.ok(app.context.gate(true).reasons.some(reason => reason.code === 'adoption-unknown'))
})

test('server failure stays on review, preserves local state and permits retry; duplicate clicks flush once', async () => {
  const app = harness([], true)
  await Promise.all([app.context.enter(), app.context.enter()])
  assert.equal(app.calls.filter(c => c[0] === 'flush').length, 1)
  assert.equal(app.calls.some(c => c[0] === 'screen'), false)
  assert.ok(app.notices[0].includes('当前填写仍保留'))
  assert.equal(app.context.confirmEntryRef.current, false)
  await app.context.enter()
  assert.equal(app.calls.filter(c => c[0] === 'flush').length, 2)
})

test('real candidate flush sends all acceptance fields and serial queued edits use current server revision', async () => {
  const requests = []
  const ref = { current: { sessionId: 'INT-test', sessionRevision: 1, input: { inputRevision: 1 }, items: [{ itemId: 'one' }, { itemId: 'two' }] } }
  const acceptance = [{ precondition: 'given', action: 'when', expected: 'then', judgement: 'pass' }]
  const context = vm.createContext({
    ...historyContext(),
    sessionRef: ref, mountedRef: { current: true }, editPendingRef: { current: 0 }, editGenerationRef: { current: 0 }, editQueueRef: { current: Promise.resolve() },
    root: 'temporary-test-root', setEditBusy() {}, setSession() {}, setError() {}, setNotice() {}, invalidateIdem() {},
    errorOf: e => ({ message: e.message }), intentView: payload => payload,
    writeJson: async (_path, body) => {
      requests.push(body)
      assert.equal(body.expectedInputRevision, ref.current.input.inputRevision)
      assert.equal(body.expectedSessionRevision, ref.current.sessionRevision)
      return { ...ref.current, sessionRevision: ref.current.sessionRevision + 1 }
    },
    cleanCandidate: value => value, candidateOf: () => ({ title: 'T', problem: 'P', goal: 'G', inScope: ['in'], outOfScope: ['out'], acceptance }),
    routeOf: () => 'create', unknownChoices: {}, ownerChoice: '', priorityChoice: 'P1', routeChoices: {},
    INTENT_FIELDS: ['title', 'problem', 'goal', 'inScope', 'outOfScope', 'acceptance'],
    manual: { one: { acceptance }, two: { acceptance } },
  })
  vm.runInContext(historyCurrentSource + slice('      const sendEdit =', '      const chooseRoute =') + slice('      const flushAllEdits =', '      const analysisPending =') + '\nthis.flush = flushAllEdits; this.edit = sendEdit', context)
  const first = context.edit({ owner: 'human' })
  const second = context.edit({ priority: 'P1' })
  await Promise.all([first, second])
  await context.flush()
  assert.deepEqual(requests.map(r => r.expectedInputRevision), [1, 1, 1, 1])
  assert.deepEqual(requests.map(r => r.expectedSessionRevision), [1, 2, 3, 4])
  assert.equal(requests[2].fields.priority, 'P1')
  assert.deepEqual(requests[2].fields.acceptance, acceptance)
  assert.equal(requests[3].fields.acceptance[0].expected, 'then')
})

test('flush replays resolved unknowns with the actual endpoint normalization and identity contract', async () => {
  const endpoint = readFileSync(new URL('../intent.mjs', import.meta.url), 'utf8')
  const server = vm.createContext({
    optionalString: value => typeof value === 'string' && value.trim() ? value : null,
    invalid: message => new Error(message),
    assertPlainObject: value => assert.ok(value && typeof value === 'object' && !Array.isArray(value)),
    requireEnum: value => { assert.ok(['pending', 'exclude', 'investigate', 'resolved'].includes(value)); return value },
    truncated: (value, max) => value.slice(0, max), UNKNOWN_RESOLUTIONS: [],
  })
  const normalization = endpoint.slice(endpoint.indexOf('  if (value.unknownResolutions !== undefined)'), endpoint.indexOf('\n  return fields', endpoint.indexOf('function normalizeEditFields')))
  const application = endpoint.slice(endpoint.indexOf('function applyUnknownResolutions('), endpoint.indexOf('\n/**', endpoint.indexOf('function applyUnknownResolutions(')))
  vm.runInContext(`function normalize(value) { const fields = {}; ${normalization}; return fields }\n${application}\nthis.normalize = normalize; this.apply = applyUnknownResolutions`, server)
  const ref = { current: { sessionId: 'INT-test', items: [{ itemId: 'ITM-1', unknowns: ['A', 'B', 'C'].map(description => ({ description, resolution: 'exclude' })) }] } }
  const requests = []
  const choices = { 'ITM-1:0': 'exclude', 'ITM-1:1': 'exclude', 'ITM-1:2': 'exclude' }
  const context = vm.createContext({
    sessionRef: ref, unknownChoices: choices, ownerChoice: '', priorityChoice: '', routeChoices: {},
    INTENT_FIELDS: ['title', 'problem', 'goal', 'inScope', 'outOfScope', 'acceptance'],
    manual: { 'ITM-1': { acceptance: [{ expected: 'retained' }] } },
    candidateOf: () => ({ title: 'local', acceptance: [{ expected: 'retained' }] }), cleanCandidate: value => value, routeOf: () => 'create',
    sendEdit: async (fields, itemId) => {
      requests.push(fields)
      const normalized = server.normalize(fields)
      ref.current = server.apply(ref.current, normalized.unknownResolutions, itemId, 'now')
      return ref.current
    },
  })
  vm.runInContext(slice('      const flushAllEdits =', '      const analysisPending =') + '\nthis.flush = flushAllEdits', context)
  const legacy = server.normalize({ unknownResolutions: [{ itemId: 'ITM-1', index: 0, resolution: 'exclude' }] })
  assert.throws(() => server.apply(ref.current, legacy.unknownResolutions, 'ITM-1', 'now'), /未找到要解决的未知项：ITM-1/)
  await context.flush()
  assert.deepEqual(Array.from(requests[0].unknownResolutions, entry => entry.description), ['A', 'B', 'C'])
  assert.ok(requests[0].unknownResolutions.every(entry => !('index' in entry)))
  assert.equal(requests[0].acceptance[0].expected, 'retained')
  ref.current.items[0].unknowns[0].resolution = 'pending'
  delete choices['ITM-1:0']
  await context.flush()
  assert.equal(ref.current.items[0].unknowns[0].resolution, 'pending', 'must not resolve an unrelated first pending unknown')
  assert.equal(ref.current.items[0].unknowns[1].resolution, 'exclude')
  for (const unknowns of [[], [{ description: '', resolution: 'pending' }], [{ description: 'B' }, { description: 'B' }]]) {
    ref.current.items[0].unknowns = unknowns
    const before = requests.length
    await assert.rejects(context.flush(), /无法安全保存选择/)
    assert.equal(requests.length, before, 'identity mismatch must fail before any write')
    assert.equal(choices['ITM-1:1'], 'exclude', 'local choices remain intact')
  }
})

test('leaving unchanged AI candidates does not record human edits; only explicitly edited fields are sent', async () => {
  const requests = []
  const ref = { current: { sessionId: 'INT-test', items: [
    { itemId: 'one', candidate: { title: 'AI title', goal: 'AI goal' } },
    { itemId: 'two', candidate: { title: 'Other AI title' } },
  ] } }
  const context = vm.createContext({
    sessionRef: ref, unknownChoices: {}, ownerChoice: '', priorityChoice: '', routeChoices: {}, manual: {},
    INTENT_FIELDS: ['title', 'problem', 'goal', 'inScope', 'outOfScope', 'acceptance'],
    candidateOf: item => ({ ...item.candidate, ...(context.manual[item.itemId] ?? {}) }),
    cleanCandidate: value => value, routeOf: item => context.routeChoices[item.itemId] ?? 'create',
    sendEdit: async (fields, itemId) => { requests.push({ fields, itemId }); return ref.current },
  })
  vm.runInContext(slice('      const flushAllEdits =', '      const analysisPending =') + '\nthis.flush = flushAllEdits', context)
  assert.equal(await context.flush(), ref.current)
  assert.equal(requests.length, 0)
  context.manual.one = { goal: 'Human goal' }
  context.routeChoices.two = 'change'
  await context.flush()
  assert.equal(requests.length, 2)
  assert.deepEqual(JSON.parse(JSON.stringify(requests)), [
    { itemId: 'one', fields: { goal: 'Human goal' } },
    { itemId: 'two', fields: { route: 'change' } },
  ])
})

test('leaving preserves the dialog and reports a rejected local save', async () => {
  const notices = [], errors = []
  let closed = false
  const context = vm.createContext({
    ...historyContext(), mountedRef: { current: true }, editBusy: false, confirmState: { loading: false },
    draftEditing: null, groupDrafts: {}, answerChoice: null, questionText: '', analysisPending: () => false,
    setNotice: value => notices.push(value), setError: value => errors.push(value),
    flushAllEdits: async () => { throw new Error('未知项已变化') },
    errorOf: error => ({ message: error.message }), invalidateHistory() {}, onClose: () => { closed = true },
  })
  vm.runInContext(historyCurrentSource + slice('      const saveAndLeave =', '      const loadRehearsal =') + '\nthis.leave = saveAndLeave', context)
  context.leave()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(closed, false)
  assert.match(notices.at(-1), /会话未保存/)
  assert.match(errors.at(-1).message, /未知项已变化/)
})

test('final form messaging and footer use the same confirmation-action gate', () => {
  assert.match(slice('      const renderConfirm = () =>', '      const renderReceipt = () =>'), /const gate = confirmationGate\(true\)/)
  assert.match(slice('      const footerFor = () =>', '      const title ='), /const gate = confirmationGate\(true\)/)
  const app = harness()
  app.ref.current.readiness = { ready: false, reasons: [{ code: 'not-confirmed' }] }
  assert.equal(app.context.gate(true).reasons.length, 0)
  app.ref.current.readiness.reasons.push({ code: 'needs-priority' })
  assert.equal(app.context.gate(true).ready, false)
  assert.equal(app.context.gate(true).reasons[0].code, 'needs-priority')
})

test('history loading and load error block form entry and final submit without flushing or writing', async () => {
  for (const history of [
    { loading: true, error: null },
    { loading: false, error: { code: 'unknown-session', message: 'Load failed; retry required' } },
  ]) {
    const app = harness()
    const requests = []
    Object.assign(app.context, {
      history, confirmState: { loading: false },
      writeJson: async (_path, body) => { requests.push(body); return { receipt: {} } },
    })
    vm.runInContext(slice('      const submitConfirm = () =>', '      const finish = () =>') + '\nthis.submit = submitConfirm', app.context)
    app.ref.current.readiness = { ready: true, reasons: [] }
    for (const gate of [app.context.gate(), app.context.gate(true), app.context.formGate()]) {
      assert.equal(gate.ready, false)
      assert.ok(gate.reasons.some(reason => reason.code === 'history-not-editable'))
    }
    await app.context.enter()
    app.context.submit()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(app.calls.some(call => call[0] === 'flush'), false, 'must not save an unloaded history selection')
    assert.equal(app.calls.some(call => call[0] === 'screen'), false, 'must remain on the current screen')
    assert.equal(requests.length, 0, 'must not confirm or create on loading/error')
    assert.equal(app.ref.current.sessionId, 'INT-test', 'must not create a replacement draft')
    // Explicit successful retry removes only the history blocker, not the
    // original server readiness or final human-confirmation requirements.
    app.context.history = { loading: false, error: null }
    app.ref.current.readiness = { ready: false, reasons: [{ code: 'not-confirmed' }] }
    assert.equal(app.context.gate().ready, false)
    assert.equal(app.context.gate(true).ready, true)
    await app.context.enter()
    assert.equal(app.calls.filter(call => call[0] === 'flush').length, 1)
    assert.equal(app.calls.find(call => call[0] === 'screen')[1], 'confirm')
  }
})

test('final submit still refuses a real blocker and sends actual confirmation only after refreshed gate', async () => {
  const app = harness()
  const requests = []
  Object.assign(app.context, {
    confirmState: { loading: false }, screenHeadingRef: { current: null },
    ownerChoice: '', priorityChoice: 'P1', unknownChoices: {},
    candidateOf: item => item.candidate, cleanCandidate: value => value, routeOf: () => 'create', draftOf: () => null,
    writeJson: async (_path, body) => { requests.push(body); return { receipt: {} } },
    setReceipt() {},
  })
  vm.runInContext(slice('      const submitConfirm = () =>', '      const finish = () =>') + '\nthis.submit = submitConfirm', app.context)
  app.ref.current.readiness = { ready: false, reasons: [{ code: 'unresolved-unknown' }] }
  app.context.submit()
  assert.equal(requests.length, 0)
  app.ref.current.readiness = { ready: false, reasons: [{ code: 'not-confirmed' }] }
  app.ref.current.items = []
  app.context.root = 'test-root'
  app.context.submit()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(requests.length, 1)
  assert.equal(requests[0].action, 'confirm')
  assert.equal(requests[0].confirmation.priority, 'P1')
  assert.equal(requests[0].expectedInputRevision, 1)
})

test('blocked confirmation respects reduced-motion preference when revealing the error', () => {
  for (const reduced of [true, false]) {
    const app = harness()
    let behavior
    Object.assign(app.context, {
      REDUCE_MOTION: reduced,
      confirmState: { loading: false },
      screenHeadingRef: { current: { scrollIntoView(options) { behavior = options.behavior } } },
    })
    vm.runInContext(slice('      const submitConfirm = () =>', '      const finish = () =>') + '\nthis.submit = submitConfirm', app.context)
    app.ref.current.readiness = { ready: false, reasons: [{ code: 'unresolved-unknown' }] }
    app.context.submit()
    assert.equal(behavior, reduced ? 'auto' : 'smooth')
  }
})

test('stale session confirmation reports reload success or failure accurately', async () => {
  for (const fails of [false, true]) {
    const app = harness()
    const states = [], applied = []
    Object.assign(app.context, {
      confirmState: { loading: false }, ownerChoice: '', priorityChoice: 'P1', unknownChoices: {},
      candidateOf: item => item.candidate, cleanCandidate: value => value, routeOf: () => 'create', draftOf: () => null,
      writeJson: async () => { throw Object.assign(new Error('stale'), { code: 'stale-session' }) },
      errorOf: error => ({ code: error.code, message: error.message }),
      loadLatestSession: async () => { if (fails) throw new Error('offline'); return { view: { ...app.ref.current, sessionRevision: 2 } } },
      applySession: view => applied.push(view), trackInvestigations() {}, invalidateIdem() {},
      historyCurrent: () => true, setConfirmState: state => states.push(state), root: 'test-root',
    })
    app.ref.current.readiness = { ready: true, reasons: [] }
    app.ref.current.items = []
    vm.runInContext(slice('      const submitConfirm = () =>', '      const finish = () =>') + '\nthis.submit = submitConfirm', app.context)
    app.context.submit()
    await new Promise(resolve => setImmediate(resolve))
    assert.match(states.at(-1).error.message, fails ? /重新读取失败/ : /重新读取，请核对/)
    assert.equal(applied.length, fails ? 0 : 1)
  }
})

test('late confirmation results cannot affect a different history scope', async () => {
  for (const fails of [false, true]) {
    const app = harness()
    let settleRequest, reloaded = false, receipt = false
    Object.assign(app.context, {
      confirmState: { loading: false }, ownerChoice: '', priorityChoice: '', unknownChoices: {},
      candidateOf: item => item.candidate, cleanCandidate: value => value, routeOf: () => 'create', draftOf: () => null,
      writeJson: () => new Promise((resolve, reject) => { settleRequest = fails ? () => reject(Object.assign(new Error('stale'), { code: 'stale-session' })) : () => resolve({ receipt: {} }) }),
      errorOf: error => ({ code: error.code, message: error.message }),
      loadLatestSession: async () => { reloaded = true }, setReceipt: () => { receipt = true }, root: 'test-root',
    })
    app.ref.current.readiness = { ready: true, reasons: [] }
    app.ref.current.items = []
    vm.runInContext(slice('      const submitConfirm = () =>', '      const finish = () =>') + '\nthis.submit = submitConfirm', app.context)
    app.context.submit()
    await new Promise(resolve => setImmediate(resolve))
    app.context.historyRequestRef.current++
    settleRequest()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(reloaded, false)
    assert.equal(receipt, false)
    assert.equal(app.calls.some(call => call[0] === 'screen'), false)
  }
})
