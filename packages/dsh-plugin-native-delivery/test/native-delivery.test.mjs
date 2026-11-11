import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import NativeDelivery, { sourceIdentity, execute, GUI_PROOF, BROWSER_EXECUTABLE, sanitizeBrowserOutput, navigateRequirement, guiProof, resolveBrowserUrl } from '../index.js'

test('GUI address comes from current trusted Host and preserves local mounts', () => {
 let advertised = 'http://127.0.0.1:56806/'
 const received = []
 const ctx = { webApp: { getAdvertisedUrl: () => advertised }, connection: { authenticatedUrl: (base) => { received.push(base); return `${base}?token=private-test-token` } } }
 for (const value of ['http://127.0.0.1:56806/', 'http://127.0.0.1:52906/', 'http://localhost:61001/mounted/gui/', 'https://[::1]:61002/mount']) {
  advertised = value
  assert.equal(resolveBrowserUrl(ctx), `${value}?token=private-test-token`)
  assert.equal(received.at(-1), value)
 }
 assert.ok(NativeDelivery.inject.includes('webApp'))
 const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
 assert.doesNotMatch(source, /56806|52906/)
})
test('GUI discovery rejects malformed, nonlocal and credential-bearing advertised addresses without disclosure', () => {
 const invalid = ['not-a-url', '//localhost:80/', 'file:///private', 'http://remote.example/', 'http://127.0.0.2/', 'http://127.0.0.1.remote.example/', 'http://localhost@remote.example/', 'http://private-user:private-password@localhost/', 'http://localhost/?token=private-secret', 'http://localhost/?', 'http://localhost/#', 'http://localhost:99999/', 'http://2130706433/', 'http://127.1/', 'http://localhost\\\\@remote.example/', ' http://localhost/']
 for (const value of invalid) {
  let authenticated = false
  const ctx = { webApp: { getAdvertisedUrl: () => value }, connection: { authenticatedUrl: () => { authenticated = true } } }
  assert.throws(() => resolveBrowserUrl(ctx), (error) => error.code === 'gui-url-unavailable' && !/private-secret|private-password|remote\.example/.test(error.message))
  assert.equal(authenticated, false)
 }
 assert.throws(() => resolveBrowserUrl({}), { code: 'gui-url-unavailable' })
 assert.throws(() => resolveBrowserUrl({ webApp: { getAdvertisedUrl() { throw new Error('private-secret') } } }), (error) => error.code === 'gui-url-unavailable' && !error.message.includes('private-secret'))
})
test('authenticated GUI URL must retain discovered origin and mount', () => {
 const base = 'http://127.0.0.1:52906/mount/'
 for (const value of ['http://remote.example/?token=private-secret', 'http://127.0.0.1:52907/mount/?token=private-secret', 'https://127.0.0.1:52906/mount/', 'http://localhost:52906/mount/', 'http://127.0.0.1:52906/other/', `${base}#private-secret`, 'http://private-secret@127.0.0.1:52906/mount/', null]) {
  assert.throws(() => resolveBrowserUrl({ webApp: { getAdvertisedUrl: () => base }, connection: { authenticatedUrl: () => value } }), (error) => error.code === 'gui-url-unavailable' && !error.message.includes('private-secret'))
 }
})

function target() { return { inspect: async () => ({ candidateId: 'candidate-1', runId: 'RUN-009', treeHash: 'tree', requirementHash: 'req' }) } }
function bridge() { return new NativeDelivery({ provide() {}, effect() {} }) }
test('reject arbitrary roots, commands and self-reported nonhuman actors', async () => {
 const service = bridge()
 await assert.rejects(service.start({root:'C:/elsewhere'}), /fixed trusted/)
 await assert.rejects(service.start({root:'D:/DSH',command:'echo evil'}), /overrides/)
 await assert.rejects(service.start({root:'D:/DSH',requirementId:'REQ-ALM-008',subject:{kind:'agent',id:'human:fake'}}), /human/)
})
test('old target disposer cannot remove new target', () => {
 const service = bridge(), old = target(), current = target()
 const dispose = service.registerTarget(old); service.registerTarget(current); dispose()
 assert.equal(service.target, current)
})
test('concurrent authorization cannot pass inspect twice', async () => {
 const service = bridge(); let finish
 service.registerTarget({ inspect: () => new Promise((done) => { finish = done }) })
 const input = {root:'D:/DSH',requirementId:'REQ-ALM-008',subject:{kind:'human',id:'human:test'}}
 const first = service.start(input)
 await assert.rejects(service.start(input), /in progress/)
 finish({busy:true}); await assert.rejects(first, /idle candidate/)
})
test('source identity changes on input but not on generated outputs', () => {
 const root = mkdtempSync(join(tmpdir(),'native-delivery-'))
 try {
  for (const directory of ['packages/dsh-plugin-requirements','packages/alm-core/src']) mkdirSync(join(root,directory),{recursive:true})
  const path = join(root,'packages/dsh-plugin-requirements/index.js'); writeFileSync(path,'one')
  const initial = sourceIdentity(root)
  writeFileSync(join(root,'packages/dsh-plugin-requirements/host.bundle.js'),'generated')
  writeFileSync(join(root,'packages/dsh-plugin-requirements/client.bundle.js'),'historical unused')
  writeFileSync(join(root,'packages/dsh-plugin-requirements/client.js'),'compiled identity')
  assert.equal(sourceIdentity(root),initial)
  const clientSource = join(root,'packages/dsh-plugin-requirements/client-source.js')
  writeFileSync(clientSource,'authored input'); assert.notEqual(sourceIdentity(root),initial)
  const withSource = sourceIdentity(root)
  writeFileSync(clientSource,'changed authored input'); assert.notEqual(sourceIdentity(root),withSource)
  writeFileSync(path,'two'); assert.notEqual(sourceIdentity(root),initial)
 } finally { rmSync(root,{recursive:true,force:true}) }
})
test('real subprocess exit failure remains visible without shell fallback', async () => {
 const result = await execute(process.execPath,['-e','process.exit(7)'])
 assert.equal(result.code,7)
})
test('reviewed Windows browser executable works without PATH or npm shell shim', async () => {
 assert.equal(BROWSER_EXECUTABLE, 'C:/Users/22878/AppData/Roaming/npm/node_modules/agent-browser/bin/agent-browser-win32-x64.exe')
 const result = await execute(BROWSER_EXECUTABLE, ['--version'])
 assert.equal(result.code, 0)
 assert.match(result.output, /agent-browser/i)
})
test('browser executable bytes participate in bootstrap trust', () => {
 const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
 assert.match(source, /digest\(readFileSync\(BROWSER_EXECUTABLE\)\)/)
 assert.doesNotMatch(source, /execute\('agent-browser'/)
})
test('browser diagnostics redact authentication URLs and secrets and bound output', () => {
 const token = 'test-private-login-value'
 const result = sanitizeBrowserOutput(`failed https://localhost/?token=${token} authorization=another-private cookie=session-private ${token}`, [token])
 assert.doesNotMatch(result, /test-private|another-private|session-private|https:/)
 assert.match(result, /failed/)
 assert.equal(sanitizeBrowserOutput('x'.repeat(5000)).length, 4096)
})
test('matching remembered project and detail skip project navigation', async () => {
 const commands = []
 await navigateRequirement(async (args) => { commands.push(args); return JSON.stringify({detailId:'REQ-ALM-008',project:'ALM',tab:'requirement'}) }, 'REQ-ALM-008')
 assert.equal(commands.some(([command]) => command === 'select' || command === 'find'), false)
})
test('other remembered detail uses native back and exact project option value', async () => {
 const commands = []; let reads = 0
 await navigateRequirement(async (args) => {
  commands.push(args)
  return JSON.stringify(++reads && args[0] === 'eval' ? {detailId: commands.filter(([c])=>c==='eval').length===1?'REQ-ALM-009':'REQ-ALM-008',project:'ALM',tab:'requirement'} : {})
 }, 'REQ-ALM-008')
 assert.ok(commands.some(args => args[0] === 'click' && args[1] === '[data-drawer-close]'))
 assert.ok(commands.some(args => args[0] === 'select' && args[2] === 'ALM'))
})
test('wrong actual project after native navigation fails closed', async () => {
 await assert.rejects(navigateRequirement(async () => JSON.stringify({detailId:'REQ-ALM-008',project:'OTHER',tab:'requirement'}), 'REQ-ALM-008'), /did not match/)
})

test('other detail open on progress returns to its body before using the stable list exit', async () => {
 const commands = []; let reads = 0
 await navigateRequirement(async args => {
  commands.push(args)
  if (args[0] === 'eval') return JSON.stringify(++reads === 1 ? {detailId:'REQ-ALM-009',project:'ALM',tab:'delivery'} : {detailId:'REQ-ALM-008',project:'ALM',tab:'requirement'})
  return '{}'
 }, 'REQ-ALM-008')
 const body = commands.findIndex(args => args[0] === 'click' && args[1] === '[data-detail-tab="requirement"]')
 const exit = commands.findIndex(args => args[0] === 'click' && args[1] === '[data-drawer-close]')
 assert.ok(body > 0 && exit > body)
})
test('emitted GUI predicates normalize whitespace and require actual canonical section', () => {
 let sectionPresent = true
 const attrs = {'data-detail-id':'REQ-ALM-008','data-detail-tab':'requirement','data-page-instance':'mount','data-source-build-id':'source','data-client-build-id':'client'}
 let technicalText = 'AI 优化建议 交付结果 验收结果通过 发布尚未发布'
 let missingSection = false
 let descriptionText = '非空需求正文'
 // Actual header is a leaf DIV; sections/outcome are siblings inside the v4 page.
 const header = {getAttribute: name => attrs[name], querySelectorAll: () => []}
 const node = { getAttribute: name => attrs[name], innerText: '真实结果' }
 const page = {
  innerText:'REQ-ALM-008 交付验证 人工验收与发布是独立动作，不会由自动推进代为完成。 AI 优化建议',
  querySelector: selector => selector === '[data-detail-id]' ? header : selector.startsWith('section[') ? (sectionPresent ? {innerText:descriptionText} : null) : selector === '[data-detail-section="delivery-attention"]' || (missingSection && selector === '[data-detail-section="delivery-acceptance"]') ? null : node,
  querySelectorAll: () => [{innerText:technicalText}],
 }
 let pagePresent = true
 const document = {
  body: {innerText:'Other panel text must not serve as detail proof'},
  querySelector: selector => selector === '[data-detail-page="v4"]' ? (pagePresent ? page : null) : selector === '[data-native-delivery-identity]' ? node : null,
 }
 const body = runInNewContext(guiProof('REQ-ALM-008'), {document})
 assert.equal(body.ok, true); assert.equal(body.checks.every(item=>item.ok), true)
 descriptionText = ' '
 assert.equal(runInNewContext(guiProof('REQ-ALM-008'), {document}).checks.find(item=>item.name==='view-content').ok, false)
 descriptionText = '非空需求正文'
 sectionPresent = false
 assert.equal(runInNewContext(guiProof('REQ-ALM-008'), {document}).checks.find(item=>item.name==='view-content').ok, false)
 attrs['data-detail-tab'] = 'delivery'
 const technical = runInNewContext(guiProof('REQ-ALM-008', true), {document})
 assert.equal(technical.ok, true)
 assert.equal(technical.checks.every(item=>item.ok), true)
 attrs['data-detail-id'] = 'REQ-ALM-009'
 assert.equal(runInNewContext(guiProof('REQ-ALM-008', true), {document}).ok, false)
 attrs['data-detail-id'] = 'REQ-ALM-008'
 pagePresent = false
 assert.equal(runInNewContext(guiProof('REQ-ALM-008', true), {document}).ok, false)
 pagePresent = true
 missingSection = true
 assert.equal(runInNewContext(guiProof('REQ-ALM-008', true), {document}).checks.find(item=>item.name==='view-content').ok, false)
 missingSection = false
 node.innerText = ' '
 assert.equal(runInNewContext(guiProof('REQ-ALM-008', true), {document}).checks.find(item=>item.name==='view-content').ok, false)
 node.innerText = '真实结果'
 technicalText = '规则评审未运行（0 / 5 视角）'
 assert.equal(runInNewContext(guiProof('REQ-ALM-008', true), {document}).checks.find(item=>item.name==='no-obsolete-rule-gate').ok, false)
})
test('body assertions precede technical handler navigation', () => {
 const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
 assert.ok(source.indexOf("throw failure('gui-body-failed'") < source.indexOf("document.querySelector('[data-detail-tab=\"delivery\"]').click()"))
})
test('fixed GUI proof checks real content and no network mutation', () => {
 assert.match(GUI_PROOF,/data-native-delivery-identity/)
 assert.match(GUI_PROOF,/规则评审未运行/)
 assert.doesNotMatch(GUI_PROOF,/fetch\(|XMLHttpRequest|localStorage|sessionStorage/)
})
