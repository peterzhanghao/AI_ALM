import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

test('shared dialog focus behavior traps Tab, closes on Escape and restores the opener', async () => {
  const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')
  const start = source.indexOf('    function useDialogFocus(')
  const end = source.indexOf('    function SnapshotModal(', start)
  assert.ok(start >= 0 && end > start)
  const helper = source.slice(start, end)
  const entry = `import React from 'react'; import {createRoot} from 'react-dom/client';
    const {useRef,useEffect,useState,createElement:h}=React; const feedbackLayerOpen=()=>false;
    ${helper}
    function App(){const [open,setOpen]=useState(false);const [nested,setNested]=useState(false);const ref=useRef(null);const nestedRef=useRef(null);return h(React.Fragment,null,
      h('button',{id:'opener',onClick:()=>setOpen(true)},'Open'),
      open?h('div',{ref,tabIndex:-1,role:'dialog','aria-modal':'true'},h('button',{id:'ignored-first',tabIndex:-1},'Ignored'),h('button',{id:'first'},'First'),h('button',{id:'last',onClick:()=>setNested(true)},'Last'),h('button',{id:'close',onClick:()=>setOpen(false)},'Close'),h('fieldset',{disabled:true},h('button',{id:'disabled-child'},'Disabled')),h('div',{id:'inert-parent'},h('button',{id:'inert-child'},'Inert')),h('button',{id:'hidden-child',style:{visibility:'hidden'}},'Hidden'),h('button',{id:'ignored-last',tabIndex:-1},'Ignored last'),h(DialogFocusHarness,{dialogRef:ref,onClose:()=>setOpen(false)}),nested?h('div',{ref:nestedRef,tabIndex:-1,role:'dialog','aria-modal':'true',id:'nested'},h('button',{id:'nested-first'},'Nested first'),h('button',{id:'nested-last'},'Nested last'),h(DialogFocusHarness,{dialogRef:nestedRef,onClose:()=>setNested(false)})):null):null)}
    function DialogFocusHarness({dialogRef,onClose}){useDialogFocus(dialogRef,onClose);return null}
    createRoot(document.getElementById('root')).render(h(App));`
  const result = await build({ stdin: { contents: entry, resolveDir: fileURLToPath(new URL('../../../', import.meta.url)), loader: 'js' }, bundle: true, write: false, platform: 'browser', format: 'esm' })
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  await page.route('http://test.local/**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div><script type="module" src="/app.js"></script>' })
    if (url.pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: result.outputFiles[0].text })
    return route.fulfill({ status: 404 })
  })
  try {
    await page.goto('http://test.local/')
    const opener = page.getByRole('button', { name: 'Open' })
    await opener.focus()
    await opener.click()
    const dialog = page.getByRole('dialog')
    await dialog.waitFor()
    await page.locator('#inert-parent').evaluate(node => node.setAttribute('inert', ''))
    assert.equal(await dialog.evaluate(node => document.activeElement === node), true)
    await page.keyboard.press('Tab')
    assert.equal(await page.evaluate(() => document.activeElement.id), 'first')
    assert.notEqual(await page.evaluate(() => document.activeElement.id), 'ignored-first')
    await page.keyboard.press('Shift+Tab')
    assert.equal(await page.evaluate(() => document.activeElement.id), 'close')
    await page.keyboard.press('Tab')
    assert.equal(await page.evaluate(() => document.activeElement.id), 'first')
    await page.locator('#ignored-last').focus()
    await page.keyboard.press('Tab')
    assert.equal(await page.evaluate(() => document.activeElement.id), 'first')
    await page.locator('#ignored-first').focus()
    await page.keyboard.press('Shift+Tab')
    assert.equal(await page.evaluate(() => document.activeElement.id), 'close')
    await page.locator('#last').click()
    await page.locator('#nested').waitFor()
    await page.keyboard.press('Tab')
    assert.equal(await page.evaluate(() => document.activeElement.id), 'nested-first')
    await page.keyboard.press('Shift+Tab')
    assert.equal(await page.evaluate(() => document.activeElement.id), 'nested-last')
    await page.keyboard.press('Escape')
    await page.locator('#nested').waitFor({ state: 'detached' })
    assert.equal(await page.evaluate(() => document.activeElement.id), 'last')
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'detached' })
    assert.equal(await opener.evaluate(node => document.activeElement === node), true)
  } finally {
    await browser.close()
  }
})

test('modal instances retain distinct accessible title associations', async () => {
  const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')
  const start = source.indexOf('    let modalSequence = 0')
  const end = source.indexOf('    // A modal names the exact object', start)
  assert.ok(start >= 0 && end > start)
  const entry = `import React from 'react'; import {createRoot} from 'react-dom/client';
    const {useRef,useEffect,useState,createElement:h}=React;
    const T={}, button={}, muted={}, feedbackLayerOpen=()=>false, useDialogFocus=()=>{}, launchFeedbackFromLayer=()=>{}, ActionIcon=()=>null;
    ${source.slice(start, end)}
    function App(){const [value,setValue]=useState(0);return h(React.Fragment,null,
      h('button',{id:'rerender',onClick:()=>setValue(value+1)},'Update'),
      h(ModalShell,{title:'First dialog',onClose:()=>{}},String(value)),
      h(ModalShell,{title:'Second dialog',onClose:()=>{}}))}
    createRoot(document.getElementById('root')).render(h(App));`
  const result = await build({ stdin: { contents: entry, resolveDir: fileURLToPath(new URL('../../../', import.meta.url)), loader: 'js' }, bundle: true, write: false, platform: 'browser', format: 'esm' })
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.route('http://test.local/**', async route => {
      if (new URL(route.request().url()).pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div><script type="module" src="/app.js"></script>' })
      return route.fulfill({ contentType: 'text/javascript', body: result.outputFiles[0].text })
    })
    await page.goto('http://test.local/')
    const first = page.getByRole('dialog', { name: 'First dialog' })
    const second = page.getByRole('dialog', { name: 'Second dialog' })
    await first.waitFor()
    await second.waitFor()
    const ids = await Promise.all([first.getAttribute('aria-labelledby'), second.getAttribute('aria-labelledby')])
    assert.ok(ids[0] && ids[1] && ids[0] !== ids[1])
    for (const id of ids) assert.equal(await page.locator(`[id="${id}"]`).count(), 1)
    await page.locator('#rerender').evaluate(node => node.click())
    assert.deepEqual(await Promise.all([first.getAttribute('aria-labelledby'), second.getAttribute('aria-labelledby')]), ids)
    assert.equal(await first.textContent().then(text => text.includes('1')), true)
  } finally { await browser.close() }
})
