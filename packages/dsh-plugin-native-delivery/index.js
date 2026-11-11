import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, readdirSync, lstatSync, renameSync } from 'node:fs'
import { resolve, join, relative, sep } from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

export const TRUSTED_ROOT = 'D:/DSH'
const RECIPE = 'requirements-native-deployment/v1'
export const BROWSER_EXECUTABLE = 'C:/Users/22878/AppData/Roaming/npm/node_modules/agent-browser/bin/agent-browser-win32-x64.exe'
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const failure = (code, message) => Object.assign(new Error(message), { code, status: 409 })
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

/** Discover only this Host's advertised local GUI; never accept a caller URL. */
export function resolveBrowserUrl(ctx) {
  const rejected = () => failure('gui-url-unavailable', 'Trusted Host GUI URL must be a valid loopback HTTP(S) URL without credentials, query or fragment; remote advertised URLs are unsupported')
  const parseLocal = (value) => {
    if (typeof value !== 'string' || value.trim() !== value || /[\\\s]/.test(value) || !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::[0-9]+)?(?:\/|$)/i.test(value)) throw rejected()
    let parsed
    try { parsed = new URL(value) } catch { throw rejected() }
    if (!['http:', 'https:'].includes(parsed.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) || parsed.username || parsed.password || parsed.hash) throw rejected()
    return parsed
  }
  let advertised
  try { advertised = ctx.webApp.getAdvertisedUrl() } catch { throw rejected() }
  const base = parseLocal(advertised)
  if (advertised.includes('?') || advertised.includes('#')) throw rejected()
  let authenticated
  try { authenticated = ctx.connection.authenticatedUrl(base.href) } catch { throw rejected() }
  const result = parseLocal(authenticated)
  if (result.origin !== base.origin || result.pathname !== base.pathname || authenticated.includes('#')) throw rejected()
  return result.href
}

/** Content identity deliberately excludes generated bundle and operational receipts. */
export function sourceIdentity(root) {
  const files = []
  for (const path of [root, join(root, 'packages'), join(root, 'packages/dsh-plugin-requirements'), join(root, 'packages/alm-core'), join(root, 'packages/alm-core/src')]) {
    if (lstatSync(path).isSymbolicLink()) throw failure('source-link', 'Source ancestry cannot contain links')
  }
  for (const prefix of ['packages/dsh-plugin-requirements', 'packages/alm-core/src']) {
    const walk = (directory) => {
      for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const path = join(directory, entry.name)
        const name = relative(root, path).replaceAll('\\', '/')
        if (entry.isSymbolicLink() || lstatSync(path).isSymbolicLink()) throw failure('source-link', 'Source links are not permitted')
        if (entry.isDirectory()) { if (!['node_modules', 'test'].includes(entry.name)) walk(path) }
        else if (entry.isFile() && !['host.bundle.js', 'client.js', 'client.bundle.js'].includes(entry.name)) files.push([name, digest(readFileSync(path))])
      }
    }
    walk(join(root, prefix))
  }
  return digest(JSON.stringify({ recipe: RECIPE, files }))
}

export function execute(file, args, { cwd, timeoutMs = 180000 } = {}) {
  return new Promise((done, reject) => {
    const child = spawn(file, args, { cwd, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = '', settled = false
    const finish = (error, result) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : done(result) }
    const timer = setTimeout(() => { child.kill(); finish(failure('process-timeout', 'Fixed verification command timed out')) }, timeoutMs)
    const collect = (chunk) => { output = (output + chunk.toString()).slice(-1024 * 1024) }
    child.stdout.on('data', collect); child.stderr.on('data', collect)
    child.on('error', (error) => finish(error))
    child.on('exit', (code) => finish(null, { code, output }))
  })
}

export function guiProof(requirementId, technical = false) {
  if (!/^REQ-ALM-\d+$/.test(requirementId)) throw failure('requirement-denied', 'Invalid GUI requirement')
  return `(() => { const el = document.querySelector('[data-native-delivery-identity]'); const page = document.querySelector('[data-detail-page="v4"]'); const detail = page?.querySelector('[data-detail-id]'); const activeTab = page?.querySelector('[data-detail-tab][aria-selected="true"]'); const text = (page?.innerText ?? '').replace(/\\s+/g,''); const stateText = Array.from(page?.querySelectorAll('[data-detail-section^="delivery-"], [data-delivery-outcome]') ?? []).map(n=>n.innerText).join('').replace(/\\s+/g,''); const technicalPresent = ['delivery-run','delivery-ai-suggestions','delivery-acceptance','delivery-candidate','delivery-release','delivery-trace'].every(id=>page?.querySelector('[data-detail-section="'+id+'"]')) && !!page?.querySelector('[data-delivery-outcome]')?.innerText.trim(); return { ok: !!el && detail?.getAttribute('data-detail-id') === ${JSON.stringify(requirementId)} && activeTab?.getAttribute('data-detail-tab') === ${JSON.stringify(technical ? 'delivery' : 'requirement')}, pageInstance: el?.getAttribute('data-page-instance'), sourceBuildId: el?.getAttribute('data-source-build-id'), clientBuildId: el?.getAttribute('data-client-build-id'), checks: [{name:'requirement-visible',ok:text.includes(${JSON.stringify(requirementId)})},{name:'view-content',ok:${technical ? "technicalPresent && stateText.includes('AI优化建议')" : "!!page?.querySelector('section[data-detail-description=true][aria-label=需求描述][data-description-status=canonical]')?.innerText.trim() && text.includes('交付验证') && text.includes('人工验收与发布是独立动作，不会由自动推进代为完成。')"}},{name:'no-obsolete-rule-gate',ok:${technical ? 'stateText.length > 0 && ' : ''}!stateText.includes('规则评审未运行')&&!stateText.includes('0/5视角')}] }; })()`
}
export const GUI_PROOF = guiProof('REQ-ALM-008', true)
export const NAVIGATION_STATE = `JSON.stringify({detailId:document.querySelector('[data-detail-id]')?.getAttribute('data-detail-id')??null,project:document.querySelector('select[aria-label="选择工作区项目"]')?.value??null,tab:document.querySelector('[data-detail-tab][aria-selected="true"]')?.getAttribute('data-detail-tab')??null})`
export function readBrowserResult(output) {
  let value = JSON.parse(output)
  if (value?.data?.result !== undefined) value = value.data.result
  if (typeof value === 'string') value = JSON.parse(value)
  return value
}
export async function navigateRequirement(invoke, requirementId) {
  if (!/^REQ-ALM-\d+$/.test(requirementId)) throw failure('requirement-denied', 'Invalid navigation requirement')
  await invoke(['wait', '[data-native-delivery-identity]'])
  let state = readBrowserResult(await invoke(['eval', NAVIGATION_STATE]))
  if (state.detailId !== requirementId || state.project !== 'ALM') {
    if (state.detailId) {
      if (state.tab !== 'requirement') await invoke(['click', '[data-detail-tab="requirement"]'])
      await invoke(['click', '[data-drawer-close]'])
    }
    await invoke(['select', 'select[aria-label="选择工作区项目"]', 'ALM'])
    await invoke(['wait', '--text', requirementId])
    await invoke(['find', 'text', requirementId, 'click', '--exact'])
    state = readBrowserResult(await invoke(['eval', NAVIGATION_STATE]))
  }
  if (state.detailId !== requirementId || state.project !== 'ALM') throw failure('gui-navigation-mismatch', 'Actual project or requirement did not match')
  if (state.tab !== 'requirement') await invoke(['click', '[data-detail-tab="requirement"]'])
}

export function sanitizeBrowserOutput(output, secrets = []) {
  let text = String(output ?? '')
  for (const secret of secrets.filter(Boolean)) text = text.split(secret).join('[redacted]')
  return text.replace(/https?:\/\/[^\s"'<>]+/gi, '[url-redacted]').replace(/((?:token|authorization|cookie|password)\s*[:=]\s*)[^\s,;"']+/gi, '$1[redacted]').replace(/[\u0000-\u0008\u000b-\u001f]/g, '').slice(-4096)
}

export default class NativeDelivery {
  static inject = ['hmr', 'connection', 'webApp']
  constructor(ctx) {
    this.ctx = ctx
    this.target = null
    this.active = null
    this.jobs = new Map()
    this.trust = this.trustIdentity()
    ctx.provide('nativeDelivery', this)
    ctx.effect(() => () => { this.closed = true })
  }
  trustIdentity() {
    const root = resolve(TRUSTED_ROOT)
    const require = createRequire(join(root, 'packages/dsh-plugin-requirements/build-host.mjs'))
    const esbuild = require.resolve('esbuild/package.json')
    const platformBinary = require.resolve('@esbuild/win32-x64/esbuild.exe')
    return digest(JSON.stringify([process.execPath, digest(readFileSync(process.execPath)), digest(readFileSync(esbuild)), digest(readFileSync(require.resolve('esbuild'))), digest(readFileSync(platformBinary)), BROWSER_EXECUTABLE, digest(readFileSync(BROWSER_EXECUTABLE)), digest(readFileSync(join(root, 'pnpm-lock.yaml'))), digest(readFileSync(join(root, 'packages/dsh-plugin-requirements/build-host.mjs')))]))
  }
  registerTarget(target) {
    this.target = target
    return () => { if (this.target === target) this.target = null }
  }
  assertRoot(root) {
    if (resolve(root).toLowerCase() !== resolve(TRUSTED_ROOT).toLowerCase()) throw failure('root-denied', 'Only the fixed trusted repository is allowed')
    return resolve(TRUSTED_ROOT)
  }
  get({ root, jobId }) {
    root = this.assertRoot(root)
    if (!/^[a-f0-9-]{36}$/.test(jobId ?? '')) return null
    try { return JSON.parse(readFileSync(join(root, '.alm/native-delivery', `${jobId}.json`), 'utf8')) } catch { return null }
  }
  persist(job, patch = {}) {
    Object.assign(job, patch, { updatedAt: new Date().toISOString() })
    const directory = join(job.root, '.alm/native-delivery')
    mkdirSync(directory, { recursive: true })
    const path = join(directory, `${job.jobId}.json`)
    writeFileSync(`${path}.tmp`, JSON.stringify(job, null, 2) + '\n')
    renameSync(`${path}.tmp`, path)
  }
  async start(input) {
    if (Object.keys(input).some((key) => !['root', 'requirementId', 'subject', 'source'].includes(key))) throw failure('input-denied', 'No command or deployment overrides accepted')
    const { requirementId, subject } = input
    const root = this.assertRoot(input.root)
    if (subject?.kind !== 'human' || !String(subject.id ?? '').startsWith('human:')) throw failure('human-required', 'Trusted native human authorization required')
    if (!/^REQ-ALM-\d+$/.test(requirementId ?? '')) throw failure('requirement-denied', 'Invalid requirement')
    if (this.active) {
      if (this.active.requirementId === requirementId) return this.active
      throw failure('deployment-busy', 'A native deployment is active')
    }
    if (!this.target) throw failure('target-unavailable', 'Requirements target not registered')
    if (this.starting) throw failure('deployment-busy', 'Native deployment authorization is in progress')
    this.starting = true
    let initial
    try { initial = await this.target.inspect({ root, requirementId }) } finally { this.starting = false }
    if (initial.busy || !initial.candidateId || !initial.treeHash || !initial.runId) throw failure('target-not-ready', initial.reason ?? 'A current idle candidate is required')
    const job = { schema: 'alm.native-delivery/v1', jobId: randomUUID(), root, requirementId, runId: initial.runId,
      status: 'running', phase: 'authorized', error: null, actor: subject.id, recipe: RECIPE, sourceBuildId: sourceIdentity(root),
      artifactHash: null, initial, candidate: null, gui: null, createdAt: new Date().toISOString() }
    this.active = job; this.persist(job)
    this.run(job).catch((error) => this.persist(job, { status: 'failed', phase: 'failed', error: { code: error.code ?? 'deployment-failed', message: String(error.message).replace(/([?&]token=)[^&\s]+/g, '$1[redacted]') } })).finally(() => { if (this.active === job) this.active = null })
    return job
  }
  async run(job) {
    const { root, requirementId, runId } = job
    const staging = join(root, 'tmp/native-delivery')
    mkdirSync(staging, { recursive: true })
    const artifact = join(staging, 'host.bundle.js')
    if (this.trustIdentity() !== this.trust) throw failure('toolchain-changed', 'Reviewed bootstrap toolchain changed')
    this.persist(job, { phase: 'building' })
    const built = await execute(process.execPath, [join(root, 'packages/dsh-plugin-requirements/build-host.mjs'), '--outfile', artifact, '--source-build-id', job.sourceBuildId], { cwd: root })
    writeFileSync(join(staging, `${job.jobId}-build.log`), built.output)
    if (built.code !== 0) throw failure('build-failed', 'Fixed build failed; see build log')
    if (this.trustIdentity() !== this.trust) throw failure('toolchain-changed', 'Reviewed bootstrap toolchain changed during build')
    if (sourceIdentity(root) !== job.sourceBuildId) throw failure('source-changed', 'Source changed during build')
    const bytes = readFileSync(artifact)
    this.persist(job, { phase: 'activating', artifactHash: digest(bytes) })
    await this.ctx.hmr.runExclusive(async () => {
      const target = this.target
      const edge = await target?.inspect({ root, requirementId })
      if (!edge || edge.busy || edge.treeHash !== job.initial.treeHash || edge.candidateId !== job.initial.candidateId || sourceIdentity(root) !== job.sourceBuildId) throw failure('activation-stale', 'Candidate changed before activation')
      const released = await target.handoff({ root, requirementId, runId })
      if (!released?.ok) throw failure('handoff-refused', 'Idle handoff refused')
      const destination = join(root, 'packages/dsh-plugin-requirements/host.bundle.js')
      this.persist(job, { phase: 'publishing', activation: 'pending' })
      const clientDestination = join(root, 'packages/dsh-plugin-requirements/client.js')
      const clientBytes = readFileSync(join(staging, 'client.js'))
      writeFileSync(`${clientDestination}.native.tmp`, clientBytes)
      renameSync(`${clientDestination}.native.tmp`, clientDestination)
      this.persist(job, { clientArtifactHash: digest(clientBytes) })
      writeFileSync(`${destination}.native.tmp`, bytes)
      renameSync(`${destination}.native.tmp`, destination)
      this.persist(job, { phase: 'reconciling', activation: 'published-unknown' })
      const result = await this.ctx.hmr.reconcileProfile(['include:alm-requirements'])
      if (result.restartReason || result.pending?.length) throw failure('restart-required', 'Runtime requires restart; not verified')
    })
    const deadline = Date.now() + 30000
    while (!this.closed && Date.now() < deadline && this.target?.identity()?.sourceBuildId !== job.sourceBuildId) await sleep(200)
    if (this.target?.identity()?.sourceBuildId !== job.sourceBuildId) throw failure('loaded-identity-mismatch', 'New Host build identity not observed')
    this.persist(job, { phase: 'revalidating', activation: 'host-identity-observed' })
    const activated = this.target
    const activatedIdentity = activated.identity()
    const candidate = await activated.reverify({ root, requirementId, runId, initial: job.initial, published: { hostHash: job.artifactHash, clientHash: job.clientArtifactHash } })
    if (this.target !== activated || activated.identity().sourceBuildId !== job.sourceBuildId) throw failure('target-generation-changed', 'Target changed during verification')
    if (!candidate?.pass || !candidate.candidateId || candidate.candidateId === job.initial.candidateId || candidate.runId !== runId || candidate.requirementHash !== job.initial.requirementHash || candidate.configHash !== job.initial.configHash || candidate.revision !== job.initial.revision) throw failure('revalidation-failed', 'New instance did not produce a bound current candidate')
    this.persist(job, { phase: 'gui-verification', candidate })
    const gui = await this.verifyBrowser(job)
    if (this.target !== activated || activated.identity().sourceBuildId !== job.sourceBuildId || activated.identity().clientBuildId !== activatedIdentity.clientBuildId) throw failure('target-generation-changed', 'Target changed during GUI verification')
    const current = await activated.inspect({ root, requirementId })
    if (this.target !== activated || activated.identity().sourceBuildId !== job.sourceBuildId || activated.identity().clientBuildId !== activatedIdentity.clientBuildId || current?.busy || current?.candidateId !== candidate.candidateId || current?.treeHash !== candidate.treeHash || current?.requirementHash !== job.initial.requirementHash || current?.configHash !== job.initial.configHash || current?.revision !== job.initial.revision || sourceIdentity(root) !== job.sourceBuildId || digest(readFileSync(join(root, 'packages/dsh-plugin-requirements/host.bundle.js'))) !== job.artifactHash || digest(readFileSync(join(root, 'packages/dsh-plugin-requirements/client.js'))) !== job.clientArtifactHash) throw failure('deployment-drift', 'Deployment or current candidate changed during GUI verification')
    this.persist(job, { status: 'passed', phase: 'gui-verified', gui })
  }
  async verifyBrowser(job) {
    const expected = this.target.identity()
    if (expected.sourceBuildId !== job.sourceBuildId || !expected.clientBuildId) throw failure('gui-contract-missing', 'Loaded identity unavailable')
    const session = `native-delivery-${job.jobId}`
    const output = join(job.root, 'tmp/native-delivery', `${job.jobId}-gui.png`)
    const log = join(job.root, 'tmp/native-delivery', `${job.jobId}-browser.log`)
    const url = resolveBrowserUrl(this.ctx)
    const secrets = [url, ...new URL(url).searchParams.values()]
    let stepNumber = 0
    const invoke = async (args) => {
      const step = `${++stepNumber}:${args[0]}`
      const record = (exit, text) => appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), step, exit, output: sanitizeBrowserOutput(text, secrets) }) + '\n')
      try {
        if (this.trustIdentity() !== this.trust) throw failure('toolchain-changed', 'Reviewed browser toolchain changed')
        const result = await execute(BROWSER_EXECUTABLE, ['--session', session, ...args], { cwd: job.root, timeoutMs: 45000 })
        record(result.code, result.output)
        if (result.code !== 0) throw failure('browser-failed', `Browser step ${step} failed (exit ${result.code}): ${sanitizeBrowserOutput(result.output, secrets).slice(-400)}`)
        return result.output
      } catch (error) {
        if (error.code !== 'browser-failed') record(error.code ?? 'error', error.message)
        throw failure(error.code ?? 'browser-failed', sanitizeBrowserOutput(`Browser step ${step}: ${error.message}`, secrets))
      }
    }
    try {
      await invoke(['open', url])
      await invoke(['wait', '--fn', 'document.readyState === "complete"'])
      await invoke(['find', 'role', 'button', 'click', '--name', '需求', '--exact'])
      await navigateRequirement(invoke, job.requirementId)
      const bodyProof = await invoke(['eval', guiProof(job.requirementId, false)])
      writeFileSync(join(job.root, 'tmp/native-delivery', `${job.jobId}-body-dom.json`), bodyProof)
      await invoke(['screenshot', output.replace('-gui.png', '-body.png')])
      let bodyReceipt
      try { bodyReceipt = JSON.parse(bodyProof); if (bodyReceipt?.data?.result) bodyReceipt = bodyReceipt.data.result } catch { throw failure('gui-body-invalid', 'Body proof invalid') }
      if (!bodyReceipt?.ok || bodyReceipt.sourceBuildId !== job.sourceBuildId || bodyReceipt.clientBuildId !== expected.clientBuildId || bodyReceipt.checks?.some((item) => !item.ok)) throw failure('gui-body-failed', 'Actual requirement body did not pass')
      await invoke(['eval', `document.querySelector('[data-detail-tab="delivery"]').click()`])
      await invoke(['wait', '--fn', `document.querySelector('[data-detail-tab="delivery"]')?.getAttribute('aria-selected') === 'true' && !!document.querySelector('[data-delivery-outcome]')`])
      await invoke(['eval', `document.querySelector('[data-progress-technical]')?.setAttribute('open','')`])
      const dom = await invoke(['eval', guiProof(job.requirementId, true)])
      // CLI output must expose explicit success and identity, not merely exit zero.
      let receipt
      try { receipt = JSON.parse(dom) } catch { throw failure('gui-result-invalid', 'Browser did not return structured proof') }
      if (receipt?.data?.result) receipt = receipt.data.result
      if (!receipt?.ok || receipt.sourceBuildId !== job.sourceBuildId || receipt.clientBuildId !== expected.clientBuildId || !receipt.pageInstance || receipt.pageInstance !== bodyReceipt.pageInstance || !Array.isArray(receipt.checks) || !receipt.checks.length || receipt.checks.some((item) => item.ok !== true)) throw failure('gui-assertion-failed', 'Actual GUI assertions did not pass')
      await invoke(['screenshot', output])
      const path = join(job.root, 'tmp/native-delivery', `${job.jobId}-dom.json`)
      writeFileSync(path, JSON.stringify(receipt, null, 2))
      return { ...receipt, screenshot: output, screenshotHash: digest(readFileSync(output)), dom: path, artifactHash: job.artifactHash, sourceBuildId: job.sourceBuildId }
    } catch (error) {
      try {
        const snapshot = await invoke(['snapshot'])
        writeFileSync(join(job.root, 'tmp/native-delivery', `${job.jobId}-failure-snapshot.txt`), sanitizeBrowserOutput(snapshot, secrets))
      } catch {}
      try { await invoke(['screenshot', output.replace('-gui.png', '-failure.png')]) } catch {}
      throw error
    } finally { try { await invoke(['close']) } catch {} }
  }
}
