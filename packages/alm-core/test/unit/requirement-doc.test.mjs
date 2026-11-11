import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DOC_PROVENANCES,
  DOC_SCHEMA,
  PENDING_STATUSES,
  diffDoc,
  docHashOf,
  normalizeDoc,
  parseDoc,
  renderDoc,
  textSimilarity,
  validateDoc,
} from '../../src/requirements/doc.mjs'

function canonicalDoc(overrides = {}) {
  return {
    schema: DOC_SCHEMA,
    requirementId: 'REQ-ALM-005',
    revision: null,
    docHash: '',
    title: '新建需求更容易被发现',
    goal: '新建需求后能立刻在列表首位看到它。',
    problem: '新建的需求默认排在列表末尾，用户需要滚动查找。',
    features: [
      {
        id: 'FR-01',
        title: '新建需求按创建时间降序',
        behavior: '新建成功后，列表默认按创建时间从新到旧排序。',
        preconditions: ['需求列表已加载', '当前未设置其他排序'],
        response: '列表首位显示刚创建的需求。',
        boundaries: ['没有需求时显示空态，不显示排序控件'],
        sources: ['用户回答 A-2'],
        provenance: 'user-stated',
      },
      {
        id: 'FR-02',
        title: '排序切换保持',
        behavior: '手动切换排序后，新建需求不重置当前排序。',
        preconditions: [],
        response: '当前排序保持不变。',
        boundaries: [],
        sources: [],
        provenance: 'user-answer',
      },
    ],
    scope: ['列表排序与滚动交互。', '新建成功后的提示。'],
    outOfScope: ['不修改查询条件与数据结构。'],
    acceptance: [
      {
        id: 'AC-01',
        featureIds: ['FR-01'],
        text: '新建后刷新，列表首位为该需求。',
        precondition: '已登录并存在至少一个需求',
        action: '新建需求并刷新列表',
        expected: '列表首位是刚创建的需求',
        judgement: '人工核对列表首位 = 新建需求 ID。',
        sources: ['用户回答 A-2'],
        provenance: 'user-stated',
      },
      {
        id: 'AC-02',
        featureIds: ['FR-02'],
        text: '切换排序后新建，排序不被重置。',
        precondition: '',
        action: '',
        expected: '',
        judgement: '人工核对排序控件仍为手动选择值。',
        sources: [],
        provenance: 'user-answer',
      },
    ],
    constraints: ['仅调整列表容器与排序函数。'],
    pending: [
      { id: 'Q-01', text: '同一毫秒创建的多个需求的先后顺序。', status: 'open' },
      { id: 'Q-02', text: '是否需要在移动端同步排序。', status: 'done' },
    ],
    meta: { nextFr: 3, nextAc: 3, confirmedAt: null },
    ...overrides,
  }
}

const LEGACY_WITH_ALIASES = [
  '# REQ-ALM-101 列表排序',
  '',
  '## 背景',
  '原来新建需求排在最后，用户看不到。',
  '',
  '## 目标',
  '新建后置顶。',
  '',
  '## 范围内',
  '- 排序',
  '- 提示',
  '',
  '## 范围外',
  '- 查询条件',
  '',
  '## 验收标准',
  '1. 前置：打开列表；动作：新建需求；预期：出现在首位；判定：列表首位是新建项',
  '2. 只有一句话的验收要求',
  '',
  '## 约束',
  '- 只改排序，不动查询',
  '',
  '## 验收线索',
  '- 这条是不规范章节',
  '',
].join('\n')

const LEGACY_BOLD = [
  '# REQ-ALM-102 旧候选',
  '',
  '## 背景',
  '**目标**：让用户更快找到新建的需求',
  '',
  '**范围内**：',
  '- 排序与提示',
  '',
  '**范围外**：',
  '- 查询与统计',
  '',
  '**验收条件**：',
  '1. 前置：列表已加载；动作：新建；预期：置顶；判定：首位可见',
  '',
].join('\n')

test('DOC_SCHEMA / PROVENANCES / PENDING_STATUSES 常量与契约一致', () => {
  assert.equal(DOC_SCHEMA, 'alm.requirement.doc/v1')
  assert.deepEqual(DOC_PROVENANCES, ['user-stated', 'user-answer', 'human-edit', 'verified-context', 'ai-suggestion', 'unconfirmed'])
  assert.deepEqual(PENDING_STATUSES, ['open', 'done'])
})

test('renderDoc：标题、章节、条款、meta 的规范形状', () => {
  const markdown = renderDoc(canonicalDoc())
  assert.ok(markdown.startsWith('# REQ-ALM-005 新建需求更容易被发现\n'))
  assert.ok(markdown.includes('## 目标\n新建需求后能立刻在列表首位看到它。'))
  assert.ok(markdown.includes('## 问题与场景\n'))
  assert.ok(markdown.includes('### FR-01 新建需求按创建时间降序'))
  assert.ok(markdown.includes('- 行为：新建成功后'))
  assert.ok(markdown.includes('- 前置：需求列表已加载'))
  assert.ok(markdown.includes('## 本次范围\n- 列表排序与滚动交互。'))
  assert.ok(markdown.includes('## 不包含\n- 不修改查询条件与数据结构。'))
  assert.ok(markdown.includes('## 验收要求\n- AC-01（FR-01）新建后刷新'))
  assert.ok(markdown.includes('  - 判定：人工核对列表首位'))
  assert.ok(markdown.includes('## 必要约束\n- 仅调整列表容器与排序函数。'))
  assert.ok(markdown.includes('## 待确认\n- [ ] Q-01 同一毫秒创建'))
  assert.ok(markdown.includes('- [x] Q-02 是否需要在移动端'))
  const metaLine = markdown.split('\n').filter((line) => line.includes('alm:meta'))
  assert.equal(metaLine.length, 1)
  const meta = JSON.parse(metaLine[0].replace(/^\s*<!-- alm:meta /, '').replace(/ -->\s*$/, ''))
  assert.deepEqual(Object.keys(meta).sort(), ['confirmedAt', 'docHash', 'nextAc', 'nextFr'])
  assert.match(meta.docHash, /^sha256:[0-9a-f]{64}$/)
})

test('parse(render(doc)) 往返：docHash 相同、再 render 逐字节一致、validate 通过', () => {
  const authored = canonicalDoc()
  const markdown = renderDoc(authored)
  const parsed = parseDoc(markdown)
  assert.equal(parsed.legacy, false)
  assert.deepEqual(parsed.unparsed, [])
  assert.equal(parsed.doc.requirementId, 'REQ-ALM-005')
  assert.equal(parsed.doc.title, '新建需求更容易被发现')
  assert.equal(parsed.doc.features.length, 2)
  assert.deepEqual(parsed.doc.features[0].preconditions, ['需求列表已加载', '当前未设置其他排序'])
  assert.deepEqual(parsed.doc.acceptance[0].featureIds, ['FR-01'])
  assert.equal(parsed.doc.acceptance[0].action, '新建需求并刷新列表')
  assert.equal(parsed.doc.acceptance[39 - 38].judgement, '人工核对排序控件仍为手动选择值。')
  assert.equal(parsed.doc.pending[1].status, 'done')
  assert.equal(parsed.doc.docHash, docHashOf(markdown))
  assert.equal(renderDoc(parsed.doc), markdown)
  assert.deepEqual(validateDoc(parsed.doc), { ok: true, errors: [] })
})

test('空章节省略、无功能时不渲染 ## 详细功能', () => {
  const markdown = renderDoc({
    requirementId: 'REQ-ALM-001',
    title: '只有一个标题',
    goal: '',
    problem: '',
    features: [],
    scope: [],
    outOfScope: [],
    acceptance: [],
    constraints: [],
    pending: [],
    meta: { nextFr: 1, nextAc: 1, confirmedAt: null },
  })
  assert.equal(markdown.split('\n')[0], '# REQ-ALM-001 只有一个标题')
  assert.ok(!markdown.includes('## 详细功能'))
  assert.ok(!markdown.includes('## 目标'))
  assert.ok(!markdown.includes('## 待确认'))
  const parsed = parseDoc(markdown)
  assert.deepEqual(parsed.doc.features, [])
  assert.deepEqual(parsed.doc.scope, [])
  assert.equal(parsed.legacy, true, '没有规范正文的文档应标记 legacy')
})

test('alm:meta 被解析与校验：水位、confirmedAt、非法 JSON 告警', () => {
  const markdown = renderDoc(canonicalDoc({ meta: { nextFr: 21, nextAc: 11, confirmedAt: '2026-11-01T09:00:00.000Z' } }))
  const parsed = parseDoc(markdown)
  assert.equal(parsed.doc.meta.nextFr, 21)
  assert.equal(parsed.doc.meta.nextAc, 11)
  assert.equal(parsed.doc.meta.confirmedAt, '2026-11-01T09:00:00.000Z')

  const broken = `# REQ-ALM-002 坏 meta\n\n## 目标\n目标文本\n\n<!-- alm:meta {not json} -->\n`
  const brokenParsed = parseDoc(broken)
  assert.equal(brokenParsed.doc.goal, '目标文本')
  assert.equal(brokenParsed.doc.meta.nextFr, 1)
  assert.ok(brokenParsed.warnings.some((warning) => warning.includes('alm:meta 不是合法 JSON')))
})

test('旧格式：别名章节 + 编号验收行 + 未知章节原样保留，legacy=true', () => {
  const parsed = parseDoc(LEGACY_WITH_ALIASES)
  assert.equal(parsed.legacy, true)
  assert.equal(parsed.doc.requirementId, 'REQ-ALM-101')
  assert.equal(parsed.doc.title, '列表排序')
  assert.equal(parsed.doc.problem, '原来新建需求排在最后，用户看不到。')
  assert.equal(parsed.doc.goal, '新建后置顶。')
  assert.deepEqual(parsed.doc.scope, ['排序', '提示'])
  assert.deepEqual(parsed.doc.outOfScope, ['查询条件'])
  assert.deepEqual(parsed.doc.constraints, ['只改排序，不动查询'])
  assert.equal(parsed.doc.acceptance.length, 2)
  assert.equal(parsed.doc.acceptance[0].id, 'AC-01')
  assert.equal(parsed.doc.acceptance[0].precondition, '打开列表')
  assert.equal(parsed.doc.acceptance[0].action, '新建需求')
  assert.equal(parsed.doc.acceptance[0].expected, '出现在首位')
  assert.equal(parsed.doc.acceptance[0].judgement, '列表首位是新建项')
  assert.equal(parsed.doc.acceptance[1].id, 'AC-02')
  assert.equal(parsed.doc.acceptance[1].text, '只有一句话的验收要求')
  assert.deepEqual(parsed.unparsed.map((entry) => entry.title), ['验收线索'])
  assert.ok(parsed.unparsed[0].text.includes('这条是不规范章节'))
  assert.ok(parsed.warnings.some((warning) => warning.includes('旧格式别名')))
  assert.ok(parsed.warnings.some((warning) => warning.includes('未能按规范解析')))
})

test('旧格式：加粗标签拆分到目标/范围内外/验收条件，legacy=true', () => {
  const parsed = parseDoc(LEGACY_BOLD)
  assert.equal(parsed.legacy, true)
  assert.equal(parsed.doc.goal, '让用户更快找到新建的需求')
  assert.deepEqual(parsed.doc.scope, ['排序与提示'])
  assert.deepEqual(parsed.doc.outOfScope, ['查询与统计'])
  assert.equal(parsed.doc.acceptance.length, 1)
  assert.equal(parsed.doc.acceptance[0].action, '新建')
  assert.ok(parsed.warnings.some((warning) => warning.includes('旧加粗标签')))
})

test('缺标题：无法识别需求 ID，legacy=true 且保留标题文本', () => {
  const parsed = parseDoc('## 目标\n把新建需求置顶。\n\n## 本次范围\n- 排序\n')
  assert.equal(parsed.legacy, true)
  assert.equal(parsed.doc.requirementId, null)
  assert.equal(parsed.doc.title, '')
  assert.ok(parsed.warnings.some((warning) => warning.includes('缺少 `# <ID> <标题>` 标题')))
})

test('验收：显式 AC ID 与（FR-01、FR-02）引用被解析', () => {
  const markdown = [
    '# REQ-ALM-003 引用',
    '',
    '## 详细功能',
    '### FR-01 甲',
    '- 行为：甲行为',
    '',
    '### FR-02 乙',
    '- 行为：乙行为',
    '',
    '## 验收要求',
    '- AC-05（FR-01、FR-02）两条功能都要满足。',
    '  - 判定：人工核对。',
    '',
  ].join('\n')
  const parsed = parseDoc(markdown)
  assert.equal(parsed.doc.acceptance[0].id, 'AC-05')
  assert.deepEqual(parsed.doc.acceptance[0].featureIds, ['FR-01', 'FR-02'])
  assert.equal(parsed.doc.acceptance[0].judgement, '人工核对。')
})

test('docHash 规范化：空行/CRLF/行尾空格/meta 变化不改，条款变化必改', () => {
  const markdown = renderDoc(canonicalDoc())
  const base = docHashOf(markdown)
  assert.equal(docHashOf(markdown.replace(/\n\n/g, '\n\n\n')), base, '多余空行不影响哈希')
  assert.equal(docHashOf(markdown.replace(/\n/g, '\r\n')), base, 'CRLF 不影响哈希')
  assert.equal(docHashOf(markdown.replace(/\n/g, '   \n')), base, '行尾空格不影响哈希')
  assert.equal(docHashOf(markdown.replace(/<!-- alm:meta .* -->/, '<!-- alm:meta {"nextFr":99} -->')), base, 'meta 行不参与哈希')
  assert.notEqual(docHashOf(markdown.replace('新建需求后能立刻在列表首位看到它。', '换了一个目标。')), base, '文本变化必改哈希')
  assert.notEqual(docHashOf(markdown.replace('### FR-01', '### FR-09')), base, '条款 ID 变化必改哈希')
  assert.notEqual(docHashOf(markdown.replace('## 目标', '## 必要约束')), base, '章节变化必改哈希')
})

test('12k 长文本往返两端不截断', () => {
  const longGoal = `开头${'长'.repeat(12000)}结尾`
  const doc = canonicalDoc({ goal: longGoal, features: [], acceptance: [], pending: [] })
  const markdown = renderDoc(doc)
  const parsed = parseDoc(markdown)
  assert.equal(parsed.doc.goal.length, longGoal.length)
  assert.ok(parsed.doc.goal.startsWith('开头'))
  assert.ok(parsed.doc.goal.endsWith('结尾'))
  assert.equal(parsed.doc.docHash, docHashOf(markdown))
  assert.equal(renderDoc(parsed.doc), markdown)
})

test('normalizeDoc：同 ID 保留、水位取 previous.meta、绝不回退', () => {
  const previous = normalizeDoc(canonicalDoc({ meta: { nextFr: 9, nextAc: 7, confirmedAt: null } }))
  assert.equal(previous.meta.nextFr, 9)
  const incoming = normalizeDoc(
    canonicalDoc({ features: [{ id: 'FR-01', title: '改名', behavior: '改行为', provenance: 'human-edit' }], acceptance: [] }),
    { previous },
  )
  assert.equal(incoming.features[0].id, 'FR-01')
  assert.equal(incoming.meta.nextFr, 9, '没有新增条款时水位不下降')
  const withNew = normalizeDoc(
    canonicalDoc({
      features: [
        { id: 'FR-01', title: '改名', behavior: '改行为', provenance: 'human-edit' },
        { title: '全新条款', behavior: '全新行为', provenance: 'user-stated' },
      ],
      acceptance: [],
    }),
    { previous },
  )
  assert.equal(withNew.features[1].id, 'FR-09', '新条款从 previous 水位继续编号')
  assert.equal(withNew.meta.nextFr, 10)
})

test('normalizeDoc：文本相似度 ≥0.6 采纳旧 ID，否则从水位新增', () => {
  const previous = normalizeDoc(
    canonicalDoc({
      features: [{ id: 'FR-04', title: '新建后置顶', behavior: '新建成功后列表首位可见新需求。', provenance: 'user-stated' }],
      acceptance: [],
      meta: { nextFr: 5, nextAc: 1, confirmedAt: null },
    }),
  )
  assert.equal(previous.features[0].id, 'FR-04')
  const similar = normalizeDoc(
    canonicalDoc({
      features: [{ title: '新建后置顶', behavior: '新建成功后列表首位可见新需求', provenance: 'user-answer' }],
      acceptance: [],
      pending: [],
      meta: { nextFr: 1, nextAc: 1, confirmedAt: null },
    }),
    { previous },
  )
  assert.equal(similar.features[0].id, 'FR-04', '相似文本继承旧 ID')
  assert.equal(similar.meta.nextFr, 5)

  const different = normalizeDoc(
    canonicalDoc({
      features: [{ title: '完全不同的东西', behavior: '互不相关的行为描述。', provenance: 'user-answer' }],
      acceptance: [],
      pending: [],
      meta: { nextFr: 1, nextAc: 1, confirmedAt: null },
    }),
    { previous },
  )
  assert.equal(different.features[0].id, 'FR-05')
  assert.equal(different.meta.nextFr, 6)
})

test('normalizeDoc：AI/未确认条款移入 pending 且原文保留', () => {
  const normalized = normalizeDoc(
    canonicalDoc({
      features: [
        { id: 'FR-01', title: '正式条款', behavior: '正式行为', provenance: 'user-stated' },
        { id: 'FR-02', title: 'AI 建议条款', behavior: '建议做法是缓存 5 分钟', provenance: 'ai-suggestion' },
        { id: 'FR-03', title: '未确认条款', behavior: '未确认的行为', provenance: 'unconfirmed' },
      ],
      acceptance: [
        { id: 'AC-01', text: 'AI 验收建议', action: '点一下', expected: '有效果', provenance: 'ai-suggestion' },
      ],
      pending: [],
    }),
  )
  assert.deepEqual(normalized.features.map((entry) => entry.id), ['FR-01'])
  const texts = normalized.pending.map((entry) => entry.text)
  assert.ok(texts.some((text) => text.includes('[功能建议·AI 建议] AI 建议条款：建议做法是缓存 5 分钟')))
  assert.ok(texts.some((text) => text.includes('[功能建议·未确认] 未确认条款：未确认的行为')))
  assert.ok(texts.some((text) => text.includes('[验收建议·AI 建议] AC-01 AI 验收建议')))
  assert.deepEqual(normalized.acceptance, [])
  assert.ok(normalized.pending.every((entry) => /^Q-\d{2,}$/.test(entry.id)))
})

test('normalizeDoc：半条验收（只有 action 或只有 expected）转 pending，不整条丢失', () => {
  const normalized = normalizeDoc(
    canonicalDoc({
      acceptance: [
        { id: 'AC-01', text: '只有动作', action: '点击新建', expected: '', provenance: 'user-answer' },
        { id: 'AC-02', text: '只有预期', action: '', expected: '列表置顶', provenance: 'user-answer' },
        { id: 'AC-03', text: '只有文本没有动作预期', provenance: 'user-answer' },
      ],
      pending: [],
    }),
  )
  assert.deepEqual(normalized.acceptance.map((entry) => entry.id), ['AC-03'], '只有文本的验收仍可往返')
  const texts = normalized.pending.map((entry) => entry.text)
  assert.ok(texts.some((text) => text.includes('[验收待补] AC-01') && text.includes('动作（action）')))
  assert.ok(texts.some((text) => text.includes('[验收待补] AC-02') && text.includes('预期（expected）')))
})

test('normalizeDoc：pending 去重、已有 Q ID 稳定、非法 ID 重新分配', () => {
  const normalized = normalizeDoc(
    canonicalDoc({
      features: [],
      acceptance: [],
      pending: [
        { id: 'Q-05', text: '问题甲', status: 'open' },
        { id: 'Q-05', text: '问题甲', status: 'open' },
        { id: 'Q-01', text: '问题乙', status: 'done' },
        { id: 'BAD-ID', text: '问题丙', status: 'open' },
      ],
      meta: { nextFr: 1, nextAc: 1, confirmedAt: null },
    }),
  )
  assert.deepEqual(normalized.pending.map((entry) => entry.id), ['Q-05', 'Q-01', 'Q-06'])
  assert.equal(normalized.pending[0].text, '问题甲')
  assert.equal(normalized.pending[1].status, 'done')
})

test('normalizeDoc 幂等：二次规范化内容、ID、哈希完全一致', () => {
  const once = normalizeDoc(canonicalDoc())
  const twice = normalizeDoc(once)
  assert.equal(twice.docHash, once.docHash)
  assert.deepEqual(twice.features, once.features)
  assert.deepEqual(twice.acceptance, once.acceptance)
  assert.deepEqual(twice.pending, once.pending)
  assert.deepEqual(twice.meta, once.meta)
})

test('normalizeDoc 输出可被 renderDoc/parseDoc 往返', () => {
  const normalized = normalizeDoc(canonicalDoc())
  const markdown = renderDoc(normalized)
  const parsed = parseDoc(markdown)
  assert.equal(parsed.legacy, false)
  assert.equal(parsed.doc.docHash, normalized.docHash)
  assert.deepEqual(validateDoc(parsed.doc), { ok: true, errors: [] })
})

test('diffDoc：新增/删除/修改条款、待确认变化与哈希变化', () => {
  const before = normalizeDoc(canonicalDoc())
  const after = normalizeDoc(
    canonicalDoc({
      title: '改名后的标题',
      goal: '',
      features: [
        { id: 'FR-01', title: '新建需求按创建时间降序', behavior: '行为已经被修改。', provenance: 'human-edit' },
        { id: 'FR-03', title: '新增条款', behavior: '新增行为', provenance: 'user-answer' },
      ],
      acceptance: [
        { id: 'AC-01', featureIds: ['FR-01'], text: '验收文本改了。', judgement: '人工核对列表首位 = 新建需求 ID。', provenance: 'human-edit' },
      ],
      scope: ['列表排序与滚动交互。'],
      pending: [{ id: 'Q-01', text: '同一毫秒创建的多个需求的先后顺序。', status: 'open' }, { id: 'Q-03', text: '新增待确认。', status: 'open' }],
    }),
  )
  const diff = diffDoc(before, after)
  assert.ok(diff.added.some((entry) => entry.kind === 'feature' && entry.id === 'FR-03'))
  assert.ok(diff.removed.some((entry) => entry.kind === 'feature' && entry.id === 'FR-02'))
  assert.ok(diff.removed.some((entry) => entry.kind === 'acceptance' && entry.id === 'AC-02'))
  assert.ok(diff.removed.some((entry) => entry.kind === 'scope' && entry.label === '新建成功后的提示。'))
  assert.ok(diff.modified.some((entry) => entry.kind === 'title' && entry.label === '改名后的标题'))
  assert.ok(diff.modified.some((entry) => entry.kind === 'feature' && entry.id === 'FR-01'))
  assert.ok(diff.modified.some((entry) => entry.kind === 'acceptance' && entry.id === 'AC-01'))
  assert.ok(diff.removed.some((entry) => entry.kind === 'goal'))
  assert.ok(diff.pending.some((entry) => entry.change === 'added' && entry.label === '新增待确认。'))

  const removedPending = diffDoc(after, before)
  assert.ok(removedPending.pending.some((entry) => entry.change === 'removed' && entry.label === '新增待确认。'))

  assert.equal(diff.docHashChanged, true)
  const same = diffDoc(before, before)
  assert.deepEqual(same, { added: [], removed: [], modified: [], pending: [], docHashChanged: false })
})

test('diffDoc：接受 Markdown 字符串，meta 不同但正文相同不算哈希变化', () => {
  const markdown = renderDoc(canonicalDoc())
  const otherMeta = markdown.replace(/<!-- alm:meta .* -->/, '<!-- alm:meta {"nextFr":99,"nextAc":99,"confirmedAt":null} -->')
  const diff = diffDoc(markdown, otherMeta)
  assert.deepEqual(diff.added, [])
  assert.deepEqual(diff.removed, [])
  assert.deepEqual(diff.modified, [])
  assert.equal(diff.docHashChanged, false, 'meta 不参与 docHash')
})

test('validateDoc：规范文档 ok；错误路径可定位', () => {
  const valid = normalizeDoc(canonicalDoc())
  assert.deepEqual(validateDoc(valid), { ok: true, errors: [] })

  const broken = JSON.parse(JSON.stringify(valid))
  broken.schema = 'wrong'
  broken.docHash = 'sha256:short'
  broken.features[0].id = 'FR-01'
  broken.features[1].id = 'FR-01'
  broken.features[0].provenance = 'maybe'
  broken.acceptance[0].id = 'AC-x'
  broken.pending[0].status = 'deferred'
  broken.meta.nextFr = 0
  const result = validateDoc(broken)
  assert.equal(result.ok, false)
  const paths = result.errors.map((error) => error.path)
  for (const path of ['schema', 'docHash', 'features[0].provenance', 'features[1].id', 'acceptance[0].id', 'pending[0].status', 'meta.nextFr']) {
    assert.ok(paths.includes(path), `缺少错误路径 ${path}（实际：${paths.join(', ')}）`)
  }
  assert.ok(result.errors.every((error) => typeof error.message === 'string' && error.message !== ''))

  assert.deepEqual(validateDoc(null), { ok: false, errors: [{ path: '', message: 'doc 必须是对象' }] })
})

test('textSimilarity：相同/相似/无关/空文本的边界', () => {
  assert.equal(textSimilarity('新建后置顶。', '新建后置顶'), 1)
  assert.equal(textSimilarity('', ''), 1, '两段空文本视为相同')
  assert.equal(textSimilarity('abc', ''), 0)
  assert.ok(textSimilarity('新建需求后置顶', '新建需求后置顶显示') >= 0.6)
  assert.ok(textSimilarity('完全不同的主题', '另一个毫无关系的描述') < 0.6)
  assert.equal(textSimilarity('abc', 'xyz'), textSimilarity('xyz', 'abc'), '相似度对称')
})

test('parseDoc：空文档不抛错、标记 legacy、meta 从 1 起', () => {
  const parsed = parseDoc('')
  assert.equal(parsed.legacy, true)
  assert.equal(parsed.doc.requirementId, null)
  assert.deepEqual(parsed.doc.meta, { nextFr: 1, nextAc: 1, confirmedAt: null })
  assert.equal(parsed.doc.docHash, docHashOf(''))
})

test('parseDoc：CRLF 与行尾空白不影响解析结果与哈希', () => {
  const markdown = renderDoc(canonicalDoc())
  const messy = markdown.replace(/\n/g, '   \r\n')
  const plain = parseDoc(markdown)
  const parsed = parseDoc(messy)
  assert.deepEqual(parsed.doc.features, plain.doc.features)
  assert.deepEqual(parsed.doc.acceptance, plain.doc.acceptance)
  assert.equal(parsed.doc.docHash, plain.doc.docHash)
})

test('parseDoc：非规范需求 ID 行整体当作标题，legacy=true', () => {
  const parsed = parseDoc(['# 这是一行没有 ID 的标题', '', '## 目标', '目标文本', ''].join('\n'))
  assert.equal(parsed.legacy, true)
  assert.equal(parsed.doc.requirementId, null)
  assert.equal(parsed.doc.title, '这是一行没有 ID 的标题')
  assert.equal(parsed.doc.goal, '目标文本')
})

test('多行条款与验收来源：render→parse 续行内容完整保留', () => {
  const doc = canonicalDoc({
    scope: ['第一行范围\n第二行补充说明'],
    acceptance: [
      {
        id: 'AC-01',
        featureIds: ['FR-01'],
        text: '多行验收',
        precondition: '前置第一行\n前置第二行',
        action: '动作第一行\n动作第二行',
        expected: '预期第一行',
        judgement: '判定第一行\n判定第二行',
        sources: ['用户回答 A-2', '工单 #42'],
        provenance: 'user-stated',
      },
    ],
    features: [],
    pending: [],
  })
  const markdown = renderDoc(doc)
  const parsed = parseDoc(markdown)
  assert.deepEqual(parsed.doc.scope, ['第一行范围\n第二行补充说明'])
  assert.equal(parsed.doc.acceptance[0].precondition, '前置第一行\n前置第二行')
  assert.equal(parsed.doc.acceptance[0].action, '动作第一行\n动作第二行')
  assert.equal(parsed.doc.acceptance[0].judgement, '判定第一行\n判定第二行')
  assert.deepEqual(parsed.doc.acceptance[0].sources, ['用户回答 A-2', '工单 #42'])
  assert.equal(renderDoc(parsed.doc), markdown)
  assert.deepEqual(validateDoc(parsed.doc), { ok: true, errors: [] })
})

test('normalizeDoc：非法 requirementId 归 null，未知 provenance 转 pending', () => {
  const normalized = normalizeDoc(
    canonicalDoc({
      requirementId: '不是合法 ID',
      features: [
        { id: 'FR-01', title: '保留', behavior: '保留行为', provenance: 'user-stated' },
        { id: 'FR-02', title: '丢弃', behavior: '丢弃行为', provenance: 'bogus' },
      ],
      acceptance: [],
      pending: [],
    }),
  )
  assert.equal(normalized.requirementId, null)
  assert.deepEqual(normalized.features.map((entry) => entry.id), ['FR-01'])
  assert.ok(normalized.pending.some((entry) => entry.text.includes('[功能建议·未确认] 丢弃：丢弃行为')))
  assert.equal(normalized.meta.nextFr, 3)
})
