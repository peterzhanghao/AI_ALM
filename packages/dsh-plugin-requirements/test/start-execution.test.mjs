import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import RequirementsService, { applyResolvedScopeApprovals, buildExecutionContext, buildExecutionPrompt, buildResumePrompt } from '../index.js'
import { createRun, updateRun } from '../../alm-core/src/requirements/run.mjs'
import { writeBlueprint } from '../../alm-core/src/requirements/blueprint-guard.mjs'

function git(root, ...args) {
  execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], { cwd: root, stdio: 'ignore' })
}

function fixtureRepo() {
  const root = mkdtempSync(join(tmpdir(), 'alm-start-run-'))
  mkdirSync(join(root, 'requirements', 'briefs'), { recursive: true })
  writeFileSync(
    join(root, 'requirements', 'req-pay-001.sdoc'),
    [
      '[DOCUMENT]',
      'TITLE: 需求样例',
      '',
      '[REQUIREMENT]',
      'UID: REQ-PAY-001',
      'TITLE: 列表按创建时间倒序',
      'OWNER: team-x',
      'PRIORITY: P1',
      'CATEGORY: functional',
      'REVISION: 1',
      'BRIEF: requirements/briefs/REQ-PAY-001.md',
      'SOURCE: chat',
      '',
    ].join('\n'),
  )
  writeFileSync(join(root, 'requirements', 'briefs', 'REQ-PAY-001.md'), '# 目标\n\n列表按创建时间倒序。\n')
  writeFileSync(join(root, 'README.md'), '# fixture\n')
  mkdirSync(join(root, 'packages', 'demo', 'test'), { recursive: true })
  writeFileSync(join(root, 'packages', 'demo', 'index.js'), 'export default 1\n')
  writeFileSync(join(root, 'packages', 'demo', 'test', 'index.test.mjs'), "import test from 'node:test'\ntest('列表按创建时间倒序', () => {})\n")
  mkdirSync(join(root, 'requirements', 'attachments', 'REQ-PAY-001'), { recursive: true })
  writeFileSync(join(root, 'requirements', 'attachments', 'REQ-PAY-001', 'investigation-evidence.json'), JSON.stringify([{ investigationId: 'INV-1', findings: [{ refs: [{ path: 'packages/demo/index.js', line: 1, endLine: 1 }] }] }]))
  writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }, null, 2))
  mkdirSync(join(root, '.alm', 'acceptance'), { recursive: true })
  writeFileSync(join(root, '.alm', 'acceptance', 'REQ-PAY-001.json'), JSON.stringify({
    schema: 'alm.acceptance.config/v1',
    requirement: 'REQ-PAY-001',
    commands: [{ id: 'test', command: ['node', '-e', 'process.exit(0)'] }],
  }))
  git(root, 'init')
  git(root, 'add', '.')
  git(root, 'commit', '-m', 'fixture')
  return root
}

async function withServer(root, run, admission = null) {
  const routes = new Map()
  const followed = []
  const agents = {
    async create() {
      return {
        agent: {
          followup: (message) => {
            followed.push(message)
            return Promise.resolve()
          },
          whenIdle: () => Promise.resolve(),
          cancel: () => {},
        },
        dispose: () => {},
      }
    },
  }
  const presets = { resolve: async (name) => ({ id: name }), mount: async () => {} }
  const ctx = {
    effect(callback) {
      callback()
    },
    webServer: {
      register(route) {
        routes.set(route.path, route.handler)
        return () => routes.delete(route.path)
      },
    },
    tools: { register: () => () => {} },
    get(name) {
      if (name === 'connection' && admission) return { admit: () => admission }
      if (name === 'agents') return agents
      if (name === 'agentPresets') return presets
      if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-flash' }) }
      return null
    },
  }
  new RequirementsService(ctx, { root, sidebarPort: 0 })
  const server = createServer((req, res) => {
    const handler = routes.get(new URL(req.url, 'http://127.0.0.1').pathname)
    if (!handler) {
      res.writeHead(404).end('not found')
      return
    }
    handler(req, res)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    await run(`http://127.0.0.1:${server.address().port}`, followed)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

test('native answer and continue reject forged human actor without trusted human principal', async () => {
 for(const admission of [{peer:{principal:{kind:'agent',id:'agent:test'}}},{peer:{principal:{kind:'anonymous'}}},{rejection:401}]) {
 const root=fixtureRepo()
 try {
 await withServer(root,async(base,followed)=>{
 for(const mode of ['answer','continue','reject-candidate']) {
 const response=await fetch(`${base}/api/alm/requirements/run`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mode,requirementId:'REQ-PAY-001',actor:'human:forged',answer:'yes',decisionResponse:{action:'delegate'}})})
 assert.ok([401,403].includes(response.status))
 assert.equal(followed.length,0)
 assert.equal(existsSync(join(root,'.alm/runs')),false)
 }
 },admission)
 }finally{rmSync(root,{recursive:true,force:true})}
 }
})

test('automatic start reports unverified path and creates no change, run or model turn', async () => {
  const root = fixtureRepo()
  try {
    const nested = join(root, 'validation/undeclared-project')
    mkdirSync(nested, { recursive: true })
    git(nested, 'init')
    writeFileSync(join(nested, 'source.js'), 'module.exports=1\n')
    await withServer(root, async (base, followed) => {
      const response = await fetch(`${base}/api/alm/requirements/start`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requirementId: 'REQ-PAY-001', apply: true, autoAdvance: true }),
      })
      const payload = await response.json()
      assert.equal(response.status, 409, JSON.stringify(payload))
      assert.equal(payload.error.code, 'auto-facts-unavailable')
      assert.match(payload.error.message, /validation\/undeclared-project\//)
      assert.match(payload.error.message, /目录或非普通文件/)
      assert.equal(followed.length, 0)
      assert.equal(existsSync(join(root, '.alm/changes')), false)
      assert.equal(existsSync(join(root, '.alm/runs')), false)
    }, { peer: { principal: { kind: 'human', id: 'human:test' } } })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('release blockers are a readable plan, not a transport failure or a publish action', async () => {
  const root = fixtureRepo()
  try {
    await withServer(root, async (base, followed) => {
      const response = await fetch(`${base}/api/alm/requirements/release`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'github-plan', requirementId: 'REQ-PAY-001' }),
      })
      const payload = await response.json()
      assert.equal(response.status, 200)
      assert.equal(payload.ok, true)
      assert.equal(payload.plan.ok, false)
      assert.ok(payload.plan.blockers.some(b => b.code === 'github-not-linked'))
      assert.equal(followed.length, 0)
      assert.equal(existsSync(join(root, '.alm/releases')), false)
    })
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('start with apply schedules one host run and returns its receipt', async () => {
  const root = fixtureRepo()
  try {
    await withServer(root, async (base, followed) => {
      const response = await fetch(`${base}/api/alm/requirements/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requirementId: 'REQ-PAY-001', apply: true }),
      })
      const payload = await response.json()
      assert.equal(response.status, 200, JSON.stringify(payload))
      assert.equal(payload.applied, true)
      assert.match(payload.changeId, /^CHG-/)
      assert.equal(existsSync(join(root, '.alm/changes', `${payload.changeId}.json`)), true)

      assert.equal(payload.execution?.scheduled, true)
      assert.match(payload.execution.runId, /^RUN-/)
      assert.equal(followed.length, 1)
      assert.equal(followed[0].role, 'user')

      const runFile = join(root, '.alm/runs', `${payload.execution.runId}.json`)
      assert.equal(existsSync(runFile), true)
      const stored = JSON.parse(readFileSync(runFile, 'utf8'))
      assert.equal(stored.change, payload.changeId)
      assert.equal(stored.carrier, 'dsh-session')

      // A second click resumes the same run: no second change, no second session.
      const again = await fetch(`${base}/api/alm/requirements/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requirementId: 'REQ-PAY-001', apply: true, changeId: payload.changeId }),
      })
      const second = await again.json()
      assert.equal(again.status, 200, JSON.stringify(second))
      assert.equal(second.execution?.reused, true)
      assert.equal(second.execution?.scheduled, false)
      assert.equal(followed.length, 1)
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('start silently registers inferred verification before creating its run', async () => {
  const root = fixtureRepo()
  try {
    rmSync(join(root, '.alm', 'acceptance', 'REQ-PAY-001.json'))
    await withServer(root, async (base, followed) => {
      const response = await fetch(`${base}/api/alm/requirements/start`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requirementId: 'REQ-PAY-001', apply: true }),
      })
      const payload = await response.json()
      assert.equal(response.status, 200, JSON.stringify(payload))
      assert.equal(payload.execution?.scheduled, true)
      assert.equal(followed.length, 1)
      const config = JSON.parse(readFileSync(join(root, '.alm', 'acceptance', 'REQ-PAY-001.json'), 'utf8'))
      assert.deepEqual(config.commands[0].command, ['node', '--test', 'packages/demo/test/index.test.mjs'])
      assert.equal(config.commands[0].timeoutMs, 30000)
      const blueprint = JSON.parse(readFileSync(join(root, '.alm', 'runs', `${payload.execution.runId}-blueprint.json`), 'utf8'))
      assert.equal(blueprint.runId, payload.execution.runId)
    })
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('execution and resume prompts render a concise task brief without metadata JSON', () => {
  const root = fixtureRepo()
  const hash = 'a'.repeat(64)
  try {
    const run = createRun({ root, requirementId: 'REQ-PAY-001', carrier: 'test', checkpoint: { autoAdvance: { verification: { records: [] } } } }).run
    writeBlueprint(root, {
      schema: 'alm.execution-blueprint/v1', runId: run.id, requirementId: run.requirement, allowedPaths: ['packages/demo/index.js', 'packages/demo/test/index.test.mjs'], approvedExpansions: [], baseline: null,
    })
    const evidencePath = join(root, '.alm', 'acceptance', 'REQ-PAY-001', 'failure.json')
    mkdirSync(join(root, '.alm', 'acceptance', 'REQ-PAY-001'), { recursive: true })
    writeFileSync(evidencePath, JSON.stringify({ result: 'fail', commands: [{ command: ['node', '--test', 'packages/demo/test/index.test.mjs'], timedOut: true, durationMs: 30000, stdout: 'not ok 1 - preserves a manual title' }] }))
    updateRun({ root, runId: run.id, checkpoint: {
      autoAdvance: { baselineFingerprint: hash, verification: { records: [{ reason: 'verification-timeout', evidencePath }] } },
    }, answer: { actor: 'human:test', text: '选 A — 允许扩大到实现所需的需求插件文件' }, apply: true })
    const context = buildExecutionContext({ root, runId: run.id })
    const item = {
      title: '需求列表长标题自动提炼与主操作按钮语义优化', revision: 2,
      briefText: `标题保护\n<!-- alm:meta {"docHash":"sha256:${hash}"} -->`,
      docView: { doc: { goal: '保护用户手动修改过的标题。', acceptance: [{ id: 'AC-04', text: '手动修改标题后不被自动覆盖。' }] } },
    }
    const prompt = buildExecutionPrompt({
      requirementId: run.requirement, runId: run.id,
      item, acceptanceCommands: [{ command: ['node', '--test', 'packages/demo/test/index.test.mjs'] }],
      executionFacts: { allowedPaths: ['packages/demo/index.js'], humanAnswers: ['选 A — 允许扩大到实现所需的需求插件文件'], evidence: '验证命令超时（30000ms）', commandLines: ['node --test packages/demo/test/index.test.mjs'] },
    })
    const resume = buildResumePrompt({ requirementId: run.requirement, runId: run.id, item, answer: '按已批准范围恢复推进。', restarted: false, executionFacts: { allowedPaths: ['packages/demo/index.js'], humanAnswers: ['选 A — 允许扩大到实现所需的需求插件文件'], evidence: '验证命令超时（30000ms）', commandLines: ['node --test packages/demo/test/index.test.mjs'] } })
    for (const text of [prompt, resume]) {
      assert.doesNotMatch(text, /alm:meta|baselineFingerprint|sha256:|a{64}|最新检查点：\{/i)
      assert.match(text, /^# 需求交付任务：REQ-PAY-001 \(修订版本 v2\)/)
      assert.match(text, /AC-04: 手动修改标题后不被自动覆盖/)
      assert.match(text, /允许扩大到实现所需的需求插件文件/)
      assert.match(text, /packages\/demo\/index\.js/)
      assert.match(text, /验证命令超时|专项验证/)
      assert.match(text, /node --test packages\/demo\/test\/index\.test\.mjs/)
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('continue API sends the concise task brief instead of the legacy checkpoint dump', async () => {
  const root = fixtureRepo()
  try {
    await withServer(root, async (base, followed) => {
      const started = await fetch(`${base}/api/alm/requirements/start`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requirementId: 'REQ-PAY-001', apply: true }),
      }).then(response => response.json())
      const stored = JSON.parse(readFileSync(join(root, '.alm', 'runs', `${started.execution.runId}.json`), 'utf8'))
      updateRun({ root, runId: stored.id, expectedRun: stored, status: 'waiting-input', phase: 'review-result', apply: true })
      const response = await fetch(`${base}/api/alm/requirements/run`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'continue', requirementId: 'REQ-PAY-001' }),
      })
      assert.equal(response.status, 200, await response.text())
      assert.equal(followed.length, 2)
      const prompt = followed[1].content[0].text
      assert.match(prompt, /^# 需求交付任务：REQ-PAY-001 \(修订版本 v1\)/)
      assert.match(prompt, /本轮明确动作/)
      assert.doesNotMatch(prompt, /最新检查点：|既往人类回答|docHash|alm:meta|不代表新的人工批准/)
    }, { peer: { principal: { kind: 'human', id: 'human:test' } } })
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a hash-bound legacy scope approval restores proposed paths before verification resumes', () => {
  const root = fixtureRepo()
  try {
    const run = createRun({ root, requirementId: 'REQ-PAY-001', carrier: 'test' }).run
    writeBlueprint(root, {
      schema: 'alm.execution-blueprint/v1', runId: run.id, requirementId: run.requirement,
      allowedPaths: ['packages/demo/index.js'], approvedExpansions: [], baseline: null,
    })
    const decision = join(root, '.alm', 'runs', `${run.id}-decision.md`)
    const text = '## 技术详情\n实现缺口：`packages/dsh-plugin-requirements/client-source.js`、`packages/dsh-plugin-requirements/intent.mjs`。\n当前验收命令：`node --test packages/demo/test/index.test.mjs`。\n'
    writeFileSync(decision, text)
    const hash = createHash('sha256').update(text).digest('hex')
    const approved = updateRun({ root, runId: run.id, answer: { text: '选 A — 允许扩大到实现所需的需求插件文件' }, checkpoint: {
      resolvedDecisions: [{ path: `.alm/runs/${run.id}-decision.md`, contentHash: hash, answerIndex: 0 }],
    }, apply: true }).run
    const blueprint = applyResolvedScopeApprovals(root, approved)
    assert.ok(blueprint.allowedPaths.includes('packages/dsh-plugin-requirements/client-source.js'))
    assert.ok(blueprint.allowedPaths.includes('packages/dsh-plugin-requirements/intent.mjs'))
    assert.equal(blueprint.allowedPaths.some(path => path.includes('node --test')), false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
