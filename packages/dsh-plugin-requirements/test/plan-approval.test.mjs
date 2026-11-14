import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

import RequirementsService from '../index.js'
import * as runCore from '../../alm-core/src/requirements/run.mjs'
import { deriveDetailView } from '../detail-view.mjs'
import { BRIEF_BUDGET } from '../../alm-core/src/requirements/turn-brief.mjs'

function git(root, ...args) {
  execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], { cwd: root, stdio: 'ignore' })
}

function service({ agents = null, presets = null } = {}) {
  const disposers = []
  const listeners = new Map()
  const ctx = {
    effect(callback) { disposers.push(callback()) },
    webServer: { register: () => () => {} },
    tools: { register: () => () => {} },
    on(name, callback) { listeners.set(name, callback); return () => listeners.delete(name) },
    get(name) {
      if (name === 'agents') return agents
      if (name === 'agentPresets') return presets
      if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-flash' }) }
      return null
    },
  }
  return { instance: new RequirementsService(ctx, { sidebarPort: 0 }), dispose: () => disposers.forEach((fn) => fn()) }
}

function harness() {
  const followed = []
  // The host hands the turn either as a string or as a message object; the tests
  // care about the instruction text only.
  const asText = (message) => (typeof message === 'string'
    ? message
    : (message?.content ?? []).filter((part) => part?.type === 'text').map((part) => part.text).join('\n'))
  const agents = {
    async create() {
      return {
        agent: {
          followup: (message) => { followed.push(asText(message)); return Promise.resolve() },
          whenIdle: () => Promise.resolve(),
          cancel: () => {},
        },
        dispose: () => {},
      }
    },
  }
  const presets = { resolve: async (name) => ({ id: name }), mount: async () => {} }
  return { followed, agents, presets }
}

/** A requirement whose brief carries a real goal and one acceptance criterion. */
function goodRoot() {
  const root = mkdtempSync(join(tmpdir(), 'alm-plan-'))
  mkdirSync(join(root, 'requirements', 'briefs'), { recursive: true })
  writeFileSync(
    join(root, 'requirements', 'req-pay-001.sdoc'),
    '[DOCUMENT]\nTITLE: 测试\n\n[REQUIREMENT]\nUID: REQ-PAY-001\nTITLE: 列表按创建时间倒序\nOWNER: team\nPROJECT: PAY\nREVISION: 1\nBRIEF: requirements/briefs/REQ-PAY-001.md\n',
  )
  writeFileSync(
    join(root, 'requirements', 'briefs', 'REQ-PAY-001.md'),
    '# 列表排序\n\n目标：列表按创建时间倒序展示。\n\n验收标准：\n- AC-01 进入列表时最新的在最前\n\n约束：不改动既有接口。\n',
  )
  git(root, 'init')
  git(root, 'add', '.')
  git(root, 'commit', '-m', 'fixture')
  return root
}

/** Same requirement without a goal or acceptance criteria. */
function emptyRoot() {
  const root = mkdtempSync(join(tmpdir(), 'alm-plan-empty-'))
  mkdirSync(join(root, 'requirements', 'briefs'), { recursive: true })
  writeFileSync(
    join(root, 'requirements', 'req-pay-002.sdoc'),
    '[DOCUMENT]\nTITLE: 测试\n\n[REQUIREMENT]\nUID: REQ-PAY-002\nTITLE: 优化一下列表\nOWNER: team\nPROJECT: PAY\nREVISION: 1\nBRIEF: requirements/briefs/REQ-PAY-002.md\n',
  )
  writeFileSync(join(root, 'requirements', 'briefs', 'REQ-PAY-002.md'), '# 优化一下列表\n\n先看看再说。\n')
  git(root, 'init')
  git(root, 'add', '.')
  git(root, 'commit', '-m', 'fixture')
  return root
}

const item = { id: 'REQ-PAY-001', title: '列表按创建时间倒序', revision: 1 }

test('a requirement without a goal or acceptance is refused before dispatch', async () => {
  const root = emptyRoot()
  const { agents, presets } = harness()
  const { instance, dispose } = service({ agents, presets })
  try {
    const result = await instance.startDeliveryRun({
      root,
      requirementId: 'REQ-PAY-002',
      item: { id: 'REQ-PAY-002', title: '优化一下列表', revision: 1 },
    })
    assert.equal(result.scheduled, false)
    assert.equal(result.reason, 'brief-insufficient')
    assert.match(result.message, /缺少目标与验收标准/)
    assert.deepEqual(result.detail, ['目标', '验收标准'])
  } finally {
    dispose()
    rmSync(root, { recursive: true, force: true })
  }
})

test('the first turn is a plan-only turn with a bounded brief', async () => {
  const root = goodRoot()
  const { followed, agents, presets } = harness()
  const { instance, dispose } = service({ agents, presets })
  try {
    const execution = await instance.startDeliveryRun({ root, requirementId: item.id, changeId: 'CHG-PAY-001', item })
    assert.equal(execution.scheduled, true)
    const prompt = followed[0]
    assert.match(prompt, /^# REQ-PAY-001 — 列表按创建时间倒序/)
    assert.match(prompt, /目标：列表按创建时间倒序展示/)
    assert.match(prompt, /本轮只做方案，不写代码、不改文件、不跑测试/)
    assert.ok(prompt.length <= BRIEF_BUDGET, `派发指令必须受预算约束，实际 ${prompt.length}`)
    // The old failure mode: a template full of placeholders and a file dump.
    assert.doesNotMatch(prompt, /按当前需求基线完成实现并验证/)
    assert.doesNotMatch(prompt, /allowedPaths/)

    const run = runCore.readRun(root, execution.runId)
    assert.equal(run.phase, 'plan')
    assert.equal(run.checkpoint.plan.required, true)
    assert.equal(run.checkpoint.plan.status, 'pending')
  } finally {
    dispose()
    rmSync(root, { recursive: true, force: true })
  }
})

test('a plan turn parks the run and the page offers exactly one confirmation', async () => {
  const root = goodRoot()
  const { agents, presets } = harness()
  const { instance, dispose } = service({ agents, presets })
  try {
    const execution = await instance.startDeliveryRun({ root, requirementId: item.id, changeId: 'CHG-PAY-001', item })
    await new Promise((resolve) => setTimeout(resolve, 25))
    const view = runCore.runView({ root, requirementId: item.id })
    assert.equal(view.status, 'waiting-input')
    assert.equal(view.phase, 'plan-review')
    assert.equal(view.awaitingAnswer, false, '方案确认是点击动作，不是回答决策')

    const detail = deriveDetailView({
      id: item.id,
      title: item.title,
      run: { exists: true, id: execution.runId, status: 'waiting-input', phase: 'plan-review', plan: { required: true, status: 'pending' } },
    })
    assert.equal(detail.context.kind, 'plan-review')
    assert.equal(detail.primaryAction.id, 'approve-plan')
    assert.equal(detail.primaryAction.enabled, true)
    assert.equal(detail.summaries.run.plan.status, 'pending')
    assert.match(detail.context.explanation, /没有改任何文件/)
  } finally {
    dispose()
    rmSync(root, { recursive: true, force: true })
  }
})

test('approving the plan continues the same run into implementation', async () => {
  const root = goodRoot()
  const { followed, agents, presets } = harness()
  const { instance, dispose } = service({ agents, presets })
  try {
    const execution = await instance.startDeliveryRun({ root, requirementId: item.id, changeId: 'CHG-PAY-001', item })
    await new Promise((resolve) => setTimeout(resolve, 25))
    const approved = await instance.approveDeliveryPlan({ root, requirementId: item.id, subject: { kind: 'human', id: 'human:local' } })
    assert.equal(approved.approved, true)
    assert.equal(approved.resumed, true)
    assert.equal(approved.runId, execution.runId)

    assert.equal(followed.length, 2)
    const prompt = followed[1]
    assert.doesNotMatch(prompt, /本轮只做方案/)
    assert.match(prompt, /方案已确认，按该方案进入实现/)
    assert.ok(prompt.length <= BRIEF_BUDGET, `实现轮指令必须受预算约束，实际 ${prompt.length}`)

    const run = runCore.readRun(root, execution.runId)
    assert.equal(run.checkpoint.plan.status, 'approved')
    assert.ok(run.checkpoint.plan.approvedAt)

    // A second click is idempotent: no extra turn is dispatched.
    const again = await instance.approveDeliveryPlan({ root, requirementId: item.id })
    assert.equal(again.approved, true)
    assert.equal(again.reused, true)
    assert.equal(followed.length, 2)
  } finally {
    dispose()
    rmSync(root, { recursive: true, force: true })
  }
})

test('approving without a pending plan explains why instead of throwing', async () => {
  const root = goodRoot()
  const { instance, dispose } = service()
  try {
    const none = await instance.approveDeliveryPlan({ root, requirementId: item.id })
    assert.equal(none.approved, false)
    assert.equal(none.reason, 'no-active-run')
    assert.match(none.message, /没有等待确认的方案/)
  } finally {
    dispose()
    rmSync(root, { recursive: true, force: true })
  }
})

test('the brief preview shows the exact instruction, or the exact gap', async () => {
  const root = goodRoot()
  const { instance, dispose } = service()
  try {
    const preview = instance.previewExecutionBrief({ root, requirementId: item.id, phase: 'plan' })
    assert.equal(preview.schema, 'alm.execution-brief-preview/v1')
    assert.equal(preview.ok, true)
    assert.ok(preview.text.length <= BRIEF_BUDGET)
    assert.ok(preview.meta.anchors.length <= 3)
  } finally {
    dispose()
    rmSync(root, { recursive: true, force: true })
  }

  const empty = emptyRoot()
  const second = service()
  try {
    const preview = second.instance.previewExecutionBrief({ root: empty, requirementId: 'REQ-PAY-002' })
    assert.equal(preview.ok, false)
    assert.equal(preview.code, 'brief-insufficient')
    assert.match(preview.reason, /缺少/)
  } finally {
    second.dispose()
    rmSync(empty, { recursive: true, force: true })
  }
})
