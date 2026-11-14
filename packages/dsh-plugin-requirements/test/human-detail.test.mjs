import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')
function extract(start, end) {
  const offset = source.indexOf(start)
  const limit = source.indexOf(end, offset)
  assert.ok(offset >= 0 && limit > offset, `Missing source boundary: ${start}`)
  return source.slice(offset, limit)
}
const context = vm.createContext({
  T: {}, button: {}, primary: {},
  useState: value => [value, () => {}],
  isExecutingRequirement: () => false,
  formatLocalStamp: value => value,
  DecisionForm: props => ({ type: 'decision-form-stub', props, children: [] }),
  RejectCandidateControl: () => null,
  renderRich: text => text,
  h(type, props, ...children) {
    return typeof type === 'function' ? type(props ?? {}) : { type, props: props ?? {}, children: children.flat(Infinity) }
  },
})
vm.runInContext([
  extract('    function draftText(', '    function draftOfSession('),
  extract('    function acceptanceResultText(', '    function safeHttpHref('),
  extract('    function safeHttpHref(', '    function relationRows('),
  extract('    function humanDescriptionBlocks(', '    function V4DetailPage('),
  extract('    const DESCRIPTION_STATUS_LABELS =', '    function RequirementDetailShell('),
  'this.ui = { humanDescriptionBlocks, humanMatterCopy, HumanDescriptionBody, HumanVerification, detailDescriptionModel, DetailDescription, humanAcceptanceState, canCancelRequirementRun, HumanCurrentMatter, HumanProgress, GitHubDeliveryProperties }',
].join('\n'), context)
const ui = context.ui
const nodes = node => node && typeof node === 'object' ? [node, ...(node.children ?? []).flatMap(nodes)] : []
const text = node => typeof node === 'string' ? node : node && typeof node === 'object' ? (node.children ?? []).map(text).join('') : ''
const visibleText = node => typeof node === 'string' ? node : node && typeof node === 'object' ? (node.type === 'details' && !node.props.open ? (node.children ?? []).filter(child => child?.type === 'summary') : node.children ?? []).map(visibleText).join('') : ''

test('legacy duplicated goal/background reads once, with no document mutation', () => {
  const prose = '背景：新需求在末尾，列表不能滚动。\n目标：新需求置顶，列表可滚动。'
  const model = { status: 'legacy', doc: { goal: prose, problem: prose } }
  const before = JSON.stringify(model)
  const blocks = ui.humanDescriptionBlocks(model)
  assert.equal(blocks.length, 2)
  assert.equal(blocks[0].title, '预期变化')
  assert.equal(blocks[0].text, '新需求置顶，列表可滚动。')
  assert.equal(JSON.stringify(model), before)
  const body = visibleText(ui.HumanDescriptionBody({ model }))
  assert.equal(body.split('列表不能滚动').length - 1, 1)
  assert.doesNotMatch(body, /\(0\)|尚未填写|暂无|待确认的业务问题/)
})

test('legacy first paragraph is always labelled as an expected change', () => {
  const blocks = ui.humanDescriptionBlocks({ status: 'legacy', doc: { goal: '早期 brief 的首段没有标准标题。', problem: '仍需说明的问题。' } })
  assert.equal(blocks[0].title, '预期变化')
})

test('plain brief, background-only and unparsed-only documents retain a readable body', () => {
  for (const [item, detail, expected] of [
    [{ briefText: '原始自由文本，不能消失。' }, {}, '原始自由文本'],
    [{}, { content: { sections: [{ kind: 'background', text: '只有背景也必须显示。' }] } }, '只有背景'],
    [{}, { content: { doc: { unparsed: [{ text: '未识别章节的业务内容。' }] } } }, '未识别章节'],
  ]) {
    const model = ui.detailDescriptionModel(item, detail)
    assert.ok(model)
    assert.ok(visibleText(ui.HumanDescriptionBody({ model })).includes(expected))
  }
})

test('legacy fallback displays unique parsed sections without inventing a goal', () => {
  const sections = [
    { title: '背景', kind: 'background', text: '' },
    { title: '用户原话', kind: 'background', text: '真实诉求' },
    { title: '用户原话', kind: 'background', text: '真实诉求', sameAs: '用户原话' },
    { title: '补充信息', kind: 'other', text: '独有内容' },
  ]
  const model = ui.detailDescriptionModel({ briefText: '完整原文' }, { content: { sections } })
  const shown = visibleText(ui.HumanDescriptionBody({ model }))
  assert.equal(shown.split('真实诉求').length - 1, 1)
  assert.match(shown, /独有内容/)
  assert.doesNotMatch(shown, /预期变化|完整原文/)
  assert.equal(sections.length, 4)
})

test('business constraints and open decisions remain visible; feature implementation details collapse', () => {
  const model = { status: 'canonical', doc: {
    goal: '改善查询', problem: '查找很慢', features: [{ id: 'FR-1', title: '关键词查询', behavior: '输入即筛选', preconditions: ['已有需求'], response: '返回匹配结果', boundaries: ['最多 3 条件'] }],
    constraints: ['不得丢失现有数据'], pending: [{ status: 'open', text: '是否包含归档需求？' }, { status: 'resolved', text: '已解决旧问题' }],
  } }
  const tree = ui.HumanDescriptionBody({ model })
  const shown = visibleText(tree)
  assert.match(shown, /输入即筛选/)
  assert.match(shown, /不得丢失现有数据/)
  assert.match(shown, /是否包含归档需求/)
  assert.doesNotMatch(shown, /已解决旧问题|已有需求|最多 3 条件/)
  assert.match(text(tree), /已有需求.*最多 3 条件/)
})

test('long prose has a bounded excerpt and accessible full paragraph', () => {
  const body = '业务正文。'.repeat(120) + '结尾不可丢失'
  const tree = ui.HumanDescriptionBody({ model: { doc: { goal: body } } })
  assert.doesNotMatch(visibleText(tree), /结尾不可丢失/)
  assert.match(visibleText(tree), /展开这段完整内容/)
  assert.match(text(tree), /结尾不可丢失/)
})

test('a six-line-sized problem card stays compact until expanded', () => {
  const body = '较长问题说明。'.repeat(35) + '结尾不可直接占据首屏'
  const tree = ui.HumanDescriptionBody({ model: { doc: { goal: '简短目标', problem: body } } })
  assert.doesNotMatch(visibleText(tree), /结尾不可直接占据首屏/)
  assert.match(visibleText(tree), /展开这段完整内容/)
})

test('metadata/full original are collapsed and never deleted from the detail', () => {
  const brief = '背景：用户原文。\n目标：显示一次。\n\n历史 AI 建议：完整留存。'
  const item = { id: 'REQ-1', briefText: brief, docMeta: { docHash: 'sha256:private-metadata', revision: 3 } }
  const detail = { content: { doc: { status: 'legacy', goal: '显示一次。', problem: '用户原文。' } } }
  const tree = ui.DetailDescription({ item, detail })
  assert.doesNotMatch(visibleText(tree), /private-metadata|历史 AI 建议|修订 v3|整理需求描述/)
  assert.match(text(tree), /用户原文/)
  assert.match(text(tree), /内容指纹：private-/)
  assert.doesNotMatch(text(tree), /sha256:private-metadata/)
  assert.equal(nodes(tree).find(node => node.props['data-description-source'])?.props.open, undefined)
})

test('generic first section does not repeat the enclosing heading', () => {
  const tree = ui.DetailDescription({ item: { id: 'REQ-1', briefText: '原始诉求' }, detail: {} })
  const headings = nodes(tree).filter(node => /^h[1-6]$/.test(node.type)).map(text)
  assert.equal(headings.filter(label => label === '需求内容').length, 0)
  assert.match(visibleText(tree), /原始诉求/)
})

test('acceptance shows one concise list without command warnings', () => {
  const detail = { content: { doc: { acceptance: [{ id: 'AC-01', text: '重复操作无重复需求' }] } }, verificationSummary: { criteria: [{ id: 'AC-01', status: 'unverified' }] } }
  const rendered = visibleText(ui.HumanVerification({ item: {}, detail }))
  assert.match(rendered, /AC-01/)
  assert.match(rendered, /重复操作无重复需求/)
  assert.match(rendered, /待验证/)
  assert.doesNotMatch(rendered, /验收命令|验证通过/)
})

test('accepted and candidate-ready ACs use green delivery labels and natural numbering', () => {
  const detail = {
    content: { doc: { acceptance: [
      { id: 'AC-11', text: '第十一项。' },
      { id: 'AC-06', text: '第六项。' },
      { id: 'AC-02', text: '第二项。' },
    ] } },
    verificationSummary: { criteria: [
      { id: 'AC-11', status: 'accepted' },
      { id: 'AC-06', status: 'accepted' },
      { id: 'AC-02', status: 'accepted' },
    ] },
  }
  const rendered = ui.HumanVerification({ item: {}, detail })
  const cards = nodes(rendered).filter(node => node.props?.['data-detail-ac'])
  assert.deepEqual(cards.map(card => card.props['data-detail-ac']), ['AC-02', 'AC-06', 'AC-11'])
  assert.match(visibleText(rendered), /🟢 已验收/)
  const pending = ui.HumanVerification({ item: {}, detail: {
    content: { doc: { acceptance: [{ id: 'AC-01', text: '待签收。' }] } },
    verificationSummary: { criteria: [{ id: 'AC-01', status: 'verified' }] },
  } })
  assert.match(visibleText(pending), /🟢 已验证（待签收）/)
})

test('GitHub delivery properties use safe external links for branches and commit', () => {
  const tree = ui.GitHubDeliveryProperties({ links: {
    repoWebUrl: 'https://github.com/peterzhanghao/AI_ALM', devBranch: 'develop', mainBranch: 'main',
    devBranchUrl: 'https://github.com/peterzhanghao/AI_ALM/tree/develop',
    mainBranchUrl: 'https://github.com/peterzhanghao/AI_ALM/tree/main',
    mainCommitUrl: 'https://github.com/peterzhanghao/AI_ALM/commit/abcdef0123456789', mainMergeCommitSha: 'abcdef0123456789',
  } })
  const links = nodes(tree).filter(node => node.type === 'a')
  assert.equal(links.length, 3)
  assert.ok(links.every(link => link.props.target === '_blank' && link.props.rel === 'noopener'))
  assert.deepEqual(links.map(link => link.props.href), [
    'https://github.com/peterzhanghao/AI_ALM/tree/develop',
    'https://github.com/peterzhanghao/AI_ALM/tree/main',
    'https://github.com/peterzhanghao/AI_ALM/commit/abcdef0123456789',
  ])
})

test('blocked and stale reasons remain truthful; running copy removes machine identifiers', () => {
  assert.match(ui.humanMatterCopy({ kind: 'automatic' }).title, /AI 正在/)
  assert.doesNotMatch(JSON.stringify(ui.humanMatterCopy({ kind: 'automatic', explanation: 'RUN-015 执行中' })), /RUN-/)
  const stopped = ui.humanMatterCopy({ kind: 'technical-block', headline: '验证失败', explanation: '本轮未完成，不能继续自动调度。' })
  assert.equal(stopped.title, '验证失败')
  assert.match(stopped.description, /不能继续自动调度/)
})

test('historical pass never reads as a current pass when stale or unknown', () => {
  assert.equal(ui.humanAcceptanceState({ registered: true, result: 'pass', current: false }).label, '历史通过，当前已过期')
  assert.equal(ui.humanAcceptanceState({ registered: true, result: 'pass' }).label, '历史通过，当前适用性未确认')
  assert.equal(ui.humanAcceptanceState({ registered: true, result: 'pass', current: true, complete: true }).label, '当前技术检查通过')
  assert.equal(ui.humanAcceptanceState({ registered: true, result: 'fail', current: true }).label, '失败')
  assert.equal(ui.humanAcceptanceState({ registered: true, result: 'pass', current: true, complete: false }).label, '已有检查通过，完整验证尚未确认')
  assert.equal(ui.humanAcceptanceState({ registered: true, result: 'pass', current: true }).label, '已有检查通过，完整验证尚未确认')
  assert.equal(ui.humanAcceptanceState({ registered: true, result: 'fail', current: null }).label, '历史检查未通过，当前适用性未确认')
})

test('only open execution states offer cancellation, including a real human wait', () => {
  for (const status of ['queued', 'running', 'waiting-input', 'paused']) assert.equal(ui.canCancelRequirementRun({ exists: true, status }), true)
  for (const status of ['done', 'cancelled', 'failed', 'rolled-back', undefined]) assert.equal(ui.canCancelRequirementRun({ exists: true, status }), false)
  assert.equal(ui.canCancelRequirementRun({ exists: false, status: 'running' }), false)
})

test('progress uses latest dated facts and makes historical evidence explicit', () => {
  const detail = { summaries: { run: { lastActivityAt: '2026-11-05T01:00:00Z', idleHandback: true }, acceptance: { registered: true, current: false, result: 'pass' } }, record: { timeline: [
    { at: '2026-11-01T01:00:00Z', kind: 'commit', title: '旧提交不应占前三' },
    { at: '2026-11-04T01:00:00Z', kind: 'answer', title: '回答业务决定' },
    { at: '2026-11-05T01:00:00Z', kind: 'acceptance', title: '通过', detail: 'pass' },
    { at: 'invalid', kind: 'commit', title: '无效时间' },
    { at: '2026-11-03T01:00:00Z', kind: 'run', title: '启动推进' },
  ] }, verificationSummary: { explanation: '证据已过期' } }
  const result = visibleText(ui.HumanProgress({ item: {}, detail }))
  assert.doesNotMatch(result, /旧提交不应占前三|无效时间|100%|已完成开发/)
  assert.match(result, /历史通过，当前已过期/)
  assert.ok(result.indexOf('执行技术检查') < result.indexOf('回答业务决定'))
  assert.match(result, /本轮已交回结果，等待继续/)
})

test('progress retains the server authorized action; running page has no self-navigation primary', () => {
  let resumed = 0
  const detail = { currentMatter: { kind: 'technical-block', headline: '验证失败', explanation: '缺少证据', action: { id: 'resume-run', enabled: true, label: '继续 AI 推进' } } }
  const props = { item: {}, detail, progressPage: true, handlers: { 'resume-run': () => resumed++ }, onRefresh() {} }
  const tree = ui.HumanCurrentMatter(props)
  const buttons = nodes(tree).filter(node => node.props['data-primary-action'])
  assert.equal(buttons.length, 1)
  buttons[0].props.onClick();assert.equal(resumed, 1)
  detail.currentMatter.action.enabled = false
  detail.currentMatter.action.reason = '当前需求已经变化'
  const blocked = ui.HumanCurrentMatter(props)
  assert.equal(nodes(blocked).filter(node => node.props['data-primary-action']).length, 0)
  assert.match(visibleText(blocked), /当前需求已经变化/)
  detail.currentMatter = { kind: 'automatic', action: { id: 'watch-run', enabled: true } }
  const running = ui.HumanCurrentMatter({ ...props, handlers: { 'watch-run': () => assert.fail('must not navigate itself') } })
  assert.equal(nodes(running).filter(node => node.props['data-primary-action']).length, 0)
  assert.match(visibleText(running), /暂时无需你操作/)
})

test('technical question points to AI handling without inventing a business decision', () => {
  const detail = { currentMatter: { kind: 'technical-block', headline: '技术问题暂停了推进', explanation: '需要 AI 整理问题', action: { id: 'answer-run', enabled: true } }, question: { title: '选择索引实现' } }
  const result = visibleText(ui.HumanCurrentMatter({ item: {}, detail, progressPage: true, handlers: {}, onNavigate() {} }))
  assert.match(result, /查看问题与 AI 处理选项/)
  assert.doesNotMatch(result, /需要你的业务决定|有一件事需要你决定/)
})

test('business decision controls render inline on the AI progress tab', () => {
  const item = { id: 'REQ-1', run: { id: 'RUN-1' } }
  const detail = { currentMatter: { kind: 'decision', action: { id: 'answer-run', enabled: true } }, question: { title: '是否包含归档需求？' } }
  const tree = ui.HumanCurrentMatter({ item, detail, progressPage: true, handlers: {}, onNavigate() {}, onDirty() {}, onRefresh() {} })
  const form = nodes(tree).find(node => node.type === 'decision-form-stub')
  assert.ok(form)
  assert.equal(form.props.inline, true)
  assert.equal(form.props.primaryActionId, 'answer-run')
  assert.doesNotMatch(visibleText(tree), /查看问题与 AI 处理选项/)
})
