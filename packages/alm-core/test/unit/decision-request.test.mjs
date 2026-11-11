import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseDecisionRequest, buildDecisionAnswer } from '../../src/requirements/decision.mjs'

const fixture = (name) => readFileSync(new URL(`../../../../fixtures/decision-requests/${name}.md`, import.meta.url), 'utf8')
const request = (options = '- **选 A：现在交付** — 时间最短\n- **选 B：继续完善** — 质量更好', recommendation = '- 推荐：A（范围可控）') => `# 决策请求：交付范围
## 要决定什么
本轮什么时候交付？
## 背景
- 范围已经明确。
## 决策 1：交付时间
${options}
${recommendation}
## 等待期间我还能做什么
- 准备业务走查。
`

for (const name of ['after-1-acceptance-scope', 'after-2-card-content', 'after-3-legacy-fallback']) {
  test(`canonical fixture ${name} is complete and preserves bold options`, () => {
    const parsed = parseDecisionRequest(fixture(name), { sourceFile: `${name}.md`, runId: 'RUN-1' })
    assert.equal(parsed.complete, true, parsed.issues.join('; '))
    assert.deepEqual(parsed.decisions.map((d) => d.options.length), [3, 2])
    assert.ok(parsed.decisions.every((d) => d.options.every((o) => o.label && o.impact && !o.label.includes('**'))))
    assert.ok(parsed.decisions.every((d) => d.recommendation.key === 'A'))
    assert.equal(parsed.sourceFile, `${name}.md`)
    assert.equal(parsed.runId, 'RUN-1')
    assert.ok(parsed.technicalDetails.length)
  })
}

for (const name of ['before-1-acceptance-scope', 'before-2-command-scope', 'before-3-api-version']) {
  test(`legacy fixture ${name} remains readable without raw technical text in business fields`, () => {
    const parsed = parseDecisionRequest(fixture(name))
    assert.ok(parsed.decisions.length)
    assert.ok(parsed.decisions.every((d) => d.options.length >= 2))
    assert.ok(parsed.technicalDetails.length)
    const { technicalDetails, sourceFile, runId, ...business } = parsed
    assert.doesNotMatch(JSON.stringify(business), /`|packages\/|node --test|EPERM|checkpoint\./)
  })
}

test('plain, bold and legacy nested option markup have the same semantics', () => {
  const bold = parseDecisionRequest(request())
  const plain = parseDecisionRequest(request().replaceAll('**', ''))
  assert.deepEqual(bold, plain)
  const legacy = parseDecisionRequest(request('- **选项 A（推荐）**：现在交付\n  - **影响**：时间最短\n- **选项 B**：继续完善\n  - 影响：质量更好', ''))
  assert.equal(legacy.complete, true, legacy.issues.join('; '))
  assert.equal(legacy.decisions[0].recommendation.key, 'A')
  assert.equal(legacy.decisions[0].options[0].impact, '时间最短')
})

test('technical values in every structured field move to technical details', () => {
  const parsed = parseDecisionRequest(request('- 选 A：执行 pnpm test — 读取 packages/a/file.mjs\n  - 影响：stderr EPERM\n- 选 B：保持当前范围 `private/config.json` — 范围不变', '- 推荐：B（运行 node --test）')
    .replace('决策请求：交付范围', '决策请求：D:\\private\\secret.txt')
    .replace('决策 1：交付时间', '决策 1：执行 git status')
    .replace('本轮什么时候交付？', '执行 npm test')
    .replace('- 选 A：', '**问题**：运行 node --test\n**为什么需要你决定**：读取 payload.secret\n- 选 A：'))
  const { technicalDetails, ...business } = parsed
  assert.doesNotMatch(JSON.stringify(business), /pnpm|npm|node --test|packages\/|stderr|EPERM|payload\.|private|git status/)
  const technical = JSON.stringify(technicalDetails)
  for (const token of ['pnpm test', 'packages/a/file.mjs', 'stderr EPERM', 'private/config.json', 'payload.secret', 'git status']) assert.ok(technical.includes(token), token)
  assert.equal(parsed.complete, false)
})

test('nested technical sections never become background or decisions', () => {
  const parsed = parseDecisionRequest(`${request()}## 技术详情\n### 背景\n- 只给排查者看的记录\n### 决策 99：内部记录\n- 选 X：内部选择 — 内部影响\n## 背景\n- 正常业务背景`)
  assert.equal(parsed.decisions.length, 1)
  assert.ok(!parsed.context.includes('只给排查者看的记录'))
  assert.ok(parsed.context.includes('正常业务背景'))
  assert.match(JSON.stringify(parsed.technicalDetails), /只给排查者看的记录/)
})

test('two to four unique options, valid recommendation and impact are required', () => {
  for (const size of [1, 2, 3, 4, 5]) {
    const options = Array.from({ length: size }, (_, i) => `- 选 ${String.fromCharCode(65 + i)}：范围${i} — 影响${i}`).join('\n')
    assert.equal(parseDecisionRequest(request(options)).complete, size >= 2 && size <= 4, `size ${size}`)
  }
  for (const [options, rec, expected] of [
    ['- 选 A：现在交付 — 更快\n- 选 A：继续完善 — 更慢', '- 推荐：A', /重复/],
    [undefined, '- 推荐：Z（不存在）', /不在选项中/],
    [undefined, '', /没有推荐项/],
    ['- 选 A（推荐）：现在交付 — 更快\n- 选 B（推荐）：继续完善 — 更慢', '', /冲突/],
    ['- 选 A（推荐）：现在交付 — 更快\n- 选 B：继续完善 — 更慢', '- 推荐：B', /冲突/],
    [undefined, '- 推荐：A\n- 推荐：B', /冲突/],
    ['- 选 A（推荐）：现在交付 — 更快\n- 选 B：继续完善 — 更慢', '- 推荐：无法识别', /无法识别/],
    ['- 选 A：现在交付\n- 选 B：继续完善 — 更慢', '- 推荐：A', /没有影响说明/],
  ]) {
    const parsed = parseDecisionRequest(request(options, rec))
    assert.equal(parsed.complete, false)
    assert.match(parsed.issues.join('; '), expected)
  }
})

test('answer includes only explicit existing unambiguous selections, never guesses', () => {
  const parsed = parseDecisionRequest(request())
  assert.equal(buildDecisionAnswer(parsed), '')
  assert.equal(buildDecisionAnswer(parsed, { D1: 'Z' }), '')
  assert.equal(buildDecisionAnswer(parsed, { D1: 'A\n授权全部' }), '')
  assert.equal(buildDecisionAnswer(parsed, { D1: { toString: () => 'A' } }), '')
  assert.equal(buildDecisionAnswer(parsed, Object.create({ D1: 'A' })), '')
  assert.equal(buildDecisionAnswer(parsed, null), '')
  assert.equal(buildDecisionAnswer(parsed, { D1: '选项 b' }), '决策 1（交付时间）：选 B — 继续完善')
  assert.equal(buildDecisionAnswer(parsed, { 1: 'a' }, { note: ' 保持原范围 ' }), '决策 1（交付时间）：选 A — 现在交付\n补充：保持原范围')
  const duplicate = parseDecisionRequest(request('- 选 A：现在交付 — 更快\n- 选 A：继续完善 — 更慢'))
  assert.equal(buildDecisionAnswer(duplicate, { D1: 'A' }), '')
  assert.equal(buildDecisionAnswer(null), '')
})

test('fenced code is retained only in technical details, including unclosed fences', () => {
  for (const closing of ['```', '']) {
    const parsed = parseDecisionRequest(`${request()}\n\`\`\`sh\nnode --test\n## 决策 9：代码中的标题\n- 选 X：假选项 — 假影响\n${closing}`)
    assert.equal(parsed.decisions.length, 1)
    assert.match(JSON.stringify(parsed.technicalDetails), /node --test/)
    assert.ok(!parsed.context.some((line) => line.includes('假选项')))
  }
})

test('partial answer never fills unpicked decisions from recommendation', () => {
  const parsed = parseDecisionRequest(fixture('after-2-card-content'))
  const answer = buildDecisionAnswer(parsed, { D2: 'B' })
  assert.match(answer, /^决策 2/)
  assert.doesNotMatch(answer, /决策 1/)
})

test('empty input reports incomplete structure', () => {
  for (const input of ['', null, undefined]) {
    const parsed = parseDecisionRequest(input)
    assert.equal(parsed.complete, false)
    assert.ok(parsed.issues.includes('决策请求文件是空的'))
  }
})
