import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')
const start = source.indexOf('    function CopyTextButton(')
const end = source.indexOf('    const DETAIL_CARD', start)

function harness(mode) {
  const values = [], calls = [], effects = []
  let cursor = 0
  const field = { focus() { calls.push('manual-focus') }, select() { calls.push('manual-select') } }
  const ref = { current: field }
  const dialog = { appendChild(n) { calls.push(['append-dialog', n]) } }
  const previous = { closest() { return dialog }, focus() { calls.push('restore-focus') } }
  const context = {
    h: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState(initial) { const i = cursor++; if (!(i in values)) values[i] = initial; return [values[i], v => { values[i] = v }] },
    useRef: () => ref, useEffect: fn => effects.push(fn), T: {},
    navigator: mode === 'absent' ? {} : { clipboard: { writeText: async text => { calls.push(['async', text]); if (mode !== 'async') throw new Error('denied') } } },
    window: { setTimeout() {} },
    document: {
      activeElement: previous,
      createElement: () => ({ style: {}, setAttribute() {}, select() { calls.push('select-fallback') }, remove() { calls.push('remove-fallback') } }),
      execCommand: command => { calls.push(command); return mode === 'fallback' || mode === 'absent' },
      body: { appendChild() { throw new Error('fallback escaped modal') } },
    },
  }
  vm.createContext(context)
  vm.runInContext(source.slice(start, end) + '\nthis.CopyTextButton = CopyTextButton', context)
  return { calls, render() { cursor = 0; effects.length = 0; const tree = context.CopyTextButton({ value: 'REQ-004', label: '复制 ID' }); effects.forEach(fn => fn()); return tree } }
}
for (const mode of ['async', 'fallback', 'absent', 'manual']) {
  test(`copy ID: ${mode}`, async () => {
    const h = harness(mode)
    const tree = h.render()
    await tree.children[0].props.onClick()
    const result = h.render()
    if (mode === 'manual') {
      assert.equal(result.children[2].props.role, 'alert')
      assert.equal(result.children[2].children[1].props.value, 'REQ-004')
      assert.ok(h.calls.includes('manual-select'))
      assert.equal(result.children[1], null, 'failed copy must not claim success')
    } else {
      assert.equal(result.children[1].props.role, 'status')
      assert.equal(result.children[0].children[0], '已复制')
    }
    if (mode !== 'async') {
      assert.ok(h.calls.some(c => Array.isArray(c) && c[0] === 'append-dialog'))
      assert.ok(h.calls.includes('restore-focus'))
    }
  })
}
