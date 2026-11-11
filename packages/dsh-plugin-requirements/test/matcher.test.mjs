import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createRequirement } from '../../alm-core/src/requirements/create.mjs'
import { indexReport } from '../../alm-core/src/commands.mjs'
import { matchRequirement } from '../../alm-core/src/requirements/matcher.mjs'
import { handleIntentRequest } from '../intent.mjs'

const EXPERIMENT_TWO = '需求列表里的长标题自动提炼功能，如果用户手动修改过标题，就不要再被 AI 自动提炼覆盖了。'

function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'alm-matcher-'))
  const create = ({ id, title, goal, problem, acceptance }) => createRequirement({
    root,
    id,
    title,
    project: 'ALM',
    owner: 'team-alm',
    priority: 'P1',
    doc: { title, goal, problem, acceptance: acceptance.map(text => ({ text, provenance: 'human-edit' })) },
    apply: true,
  })
  create({
    id: 'REQ-ALM-011',
    title: '需求列表长标题自动提炼与主操作按钮语义优化',
    goal: '让长标题列表保持可读',
    problem: '列表中的标题过长且操作语义不明确',
    acceptance: ['长标题在列表内截断并可查看完整内容'],
  })
  create({
    id: 'REQ-ALM-012',
    title: '需求列表展示收敛变更状态与版本徽章',
    goal: '让用户在需求列表直接识别收敛状态和当前版本',
    problem: '列表没有展示版本徽章和收敛变更状态，验收时无法判断迭代版本',
    acceptance: [
      '存在待确认收敛变更时显示醒目的待确认收敛变更标识，无待确认变更时不显示。',
      '列表显示当前正式版本徽章；存在待确认升级时显示候选版本。',
      '存在 pendingPatch 的需求可在待我处理视图中筛选。',
      '高于 v1 的版本徽章悬停显示最近一次收敛摘要，点击后打开历史记录中的对应版本 Diff。',
      '不存在可用 Diff 时提供明确降级反馈，不展示其他版本的 Diff。',
    ],
  })
  return root
}

test('matcher gives REQ-ALM-012 a high-confidence match for unnumbered version badge feedback', () => {
  const root = workspace()
  try {
    const result = matchRequirement({ root, text: '需求列表的版本徽章和收敛变更状态还需要在验收时直接展示。' })
    assert.equal(result.matchedReqId, 'REQ-ALM-012')
    assert.equal(result.matchedTitle, '需求列表展示收敛变更状态与版本徽章')
    assert.equal(result.confidence, 'high')
    assert.equal(result.candidates[0].reqId, 'REQ-ALM-012')
    assert.ok(result.candidates[0].dimensions.semantic > result.candidates[1].dimensions.semantic)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('matcher attaches pending convergence, candidate version, and version-Diff feedback to REQ-ALM-012', () => {
  const root = workspace()
  try {
    const feedback = 'pendingPatch 的需求要进入待我处理，列表显示 v2 → v3 待确认；点击高版本徽章进入历史记录展示最新 Diff，缺少 Diff 时明确提示。'
    const result = matchRequirement({ root, text: feedback })
    assert.equal(result.matchedReqId, 'REQ-ALM-012')
    assert.equal(result.confidence, 'high')
    assert.equal(result.candidates[0].reqId, 'REQ-ALM-012')
    assert.ok(result.candidates[0].dimensions.semantic > result.candidates[1].dimensions.semantic)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('crystallize auto-attaches a matching feedback without --update and records the magnetic convergence', () => {
  const root = workspace()
  try {
    const summary = [
      '标题：需求列表展示收敛变更状态与版本徽章',
      '目标：让验收人员在需求列表直接识别每次收敛后的版本徽章与状态。',
      '问题：当前列表无法清楚展示收敛变更状态和版本徽章。',
      '验收标准：',
      '- 列表展示收敛状态与版本徽章。',
      '- 跨会话反馈收敛后版本号递增。',
    ].join('\n')
    const output = execFileSync(process.execPath, [
      'packages/dsh-plugin-requirements/bin/crystallize.mjs', '--root', root,
      '--feedback', summary, '--source-session', 'external-acceptance-window', '--apply',
    ], { cwd: new URL('../../..', import.meta.url), encoding: 'utf8' })
    const result = JSON.parse(output)
    assert.equal(result.autoAttached, true)
    assert.equal(result.matched.matchedReqId, 'REQ-ALM-012')
    assert.equal(result.result.result.requirement, 'REQ-ALM-012')
    assert.equal(result.result.result.revision, 2)
    assert.match(result.proposal.delta.evolutionNote, /^🧲 跨会话自动吸附反馈：/)
    const asset = indexReport(root).assets.find(entry => entry.id === 'REQ-ALM-012')
    assert.match(readFileSync(join(root, asset.extra.brief), 'utf8'), /跨会话反馈收敛后版本号递增/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('matcher leaves unrelated new functionality on the new-requirement branch', () => {
  const root = workspace()
  try {
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'voice-command.mjs'), 'export const voiceCommand = true\n')
    const result = matchRequirement({ root, text: '新增 voice command 离线唤醒和麦克风权限管理功能。', changedFiles: ['src/voice-command.mjs'] })
    assert.equal(result.confidence, 'low')
    assert.equal(result.matchedReqId, null)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('intent analysis returns the REQ-ALM-011 magnetic match and preserves the complete conditional rule', async () => {
  const root = workspace()
  try {
    const result = await handleIntentRequest({
      root,
      body: { action: 'analyze', projectId: 'ALM', input: { text: EXPERIMENT_TWO, source: 'text' } },
      resolveAiSelection: async () => ({ provider: 'fake', model: 'fake' }),
      aiStreamFor: () => async function* () { throw new Error('offline for local draft') },
    })
    assert.equal(result.matchedReq.matchedReqId, 'REQ-ALM-011')
    assert.equal(result.matchedReq.confidence, 'high')
    assert.deepEqual(result.matchedReq.matchedReq, { id: 'REQ-ALM-011', title: '需求列表长标题自动提炼与主操作按钮语义优化', revision: 1 })
    const draft = result.session.docDraft
    const acceptance = draft.acceptance.map(entry => entry.text)
    assert.ok(acceptance.includes('当用户手动修改过需求标题后，AI 自动提炼不得覆盖该标题。'))
    assert.ok(!acceptance.includes('如果用户手动修改过标题。'))
    assert.ok(!acceptance.includes('就不要再被 AI 自动提炼覆盖了。'))
    assert.match(result.session.items[0].candidate.title, /手动修改/)
    assert.match(result.session.items[0].candidate.title, /保留|不覆盖/)
    assert.match(draft.problem, /防止用户手动修改后的需求标题/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
