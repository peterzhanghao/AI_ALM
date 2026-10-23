import test from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyFile,
  evaluateObligation,
  parseExemption,
  suggestedTestPaths,
} from '../../../../scripts/test-obligation.mjs'

test('classifyFile separates source, tests/fixtures and docs', () => {
  assert.equal(classifyFile('packages/alm-core/src/commands.mjs'), 'source')
  assert.equal(classifyFile('packages/alm-core/bin/alm.mjs'), 'source')
  assert.equal(classifyFile('packages/dsh-plugin-requirements/render.mjs'), 'source')
  assert.equal(classifyFile('packages/dsh-plugin-requirements/index.js'), 'source')

  assert.equal(classifyFile('packages/alm-core/test/unit/asset.test.mjs'), 'test')
  assert.equal(classifyFile('packages/dsh-plugin-architecture/test/http.test.mjs'), 'test')
  assert.equal(classifyFile('packages/alm-core/test/fixtures/sample.yml'), 'test')
  assert.equal(classifyFile('fixtures/negative/cases.json'), 'test')
  assert.equal(classifyFile('fixtures/order-refund/README.md'), 'test')
  assert.equal(classifyFile('packages/alm-core/test/helpers.mjs'), 'other')

  assert.equal(classifyFile('docs/planning/architecture.md'), 'other')
  assert.equal(classifyFile('packages/alm-skills/alm-change-workflow/SKILL.md'), 'other')
  assert.equal(classifyFile('scripts/regression.mjs'), 'other')
  assert.equal(classifyFile('.github/workflows/alm-ci.yml'), 'other')
})

test('source change without tests is missing', () => {
  const result = evaluateObligation({
    files: ['packages/alm-core/src/gates/run.mjs', 'docs/planning/architecture.md'],
  })
  assert.equal(result.status, 'missing')
  assert.deepEqual(result.sources, ['packages/alm-core/src/gates/run.mjs'])
  assert.deepEqual(result.tests, [])
  assert.ok(result.suggestions.includes('packages/alm-core/test/unit/<area>.test.mjs'))
})

test('source change with a test file is satisfied', () => {
  const result = evaluateObligation({
    files: [
      'packages/alm-core/src/gates/run.mjs',
      'packages/alm-core/test/unit/gates/run.test.mjs',
    ],
  })
  assert.equal(result.status, 'satisfied')
  assert.deepEqual(result.sources, ['packages/alm-core/src/gates/run.mjs'])
  assert.deepEqual(result.tests, ['packages/alm-core/test/unit/gates/run.test.mjs'])
})

test('a negative fixture change counts as test coverage', () => {
  const result = evaluateObligation({
    files: [
      'packages/alm-core/src/gates/run.mjs',
      'fixtures/negative/duplicate-id/req.yml',
      'fixtures/negative/cases.json',
    ],
  })
  assert.equal(result.status, 'satisfied')
  assert.equal(result.tests.length, 2)
})

test('documentation-only and test-only changes are not applicable', () => {
  assert.equal(
    evaluateObligation({ files: ['docs/planning/architecture.md', 'README.md'] }).status,
    'not-applicable',
  )
  assert.equal(
    evaluateObligation({ files: ['packages/alm-core/test/unit/asset.test.mjs'] }).status,
    'not-applicable',
  )
})

test('explicit exemption with a reviewable reason is accepted', () => {
  const body = '## Tests\nTest-Exemption: 纯文案修正，行为由现有契约测试覆盖'
  const result = evaluateObligation({
    files: ['packages/alm-core/src/commands.mjs'],
    prBody: body,
  })
  assert.equal(result.status, 'exempt')
  assert.equal(result.exemption, '纯文案修正，行为由现有契约测试覆盖')
})

test('short, commented or fenced exemptions do not bypass the gate', () => {
  const files = ['packages/alm-core/src/commands.mjs']
  assert.equal(evaluateObligation({ files, prBody: 'Test-Exemption: 短' }).status, 'missing')
  assert.equal(evaluateObligation({ files, prBody: 'Test-Exemption: ----------' }).status, 'missing')
  assert.equal(
    evaluateObligation({ files, prBody: '<!-- Test-Exemption: 这是一段不应生效的注释理由 -->' }).status,
    'missing',
  )
  assert.equal(
    evaluateObligation({ files, prBody: '```\nTest-Exemption: 这是一段不应生效的代码示例\n```' }).status,
    'missing',
  )
  assert.equal(parseExemption(''), null)
})

test('plugin source suggests the plugin test directory', () => {
  assert.deepEqual(suggestedTestPaths('packages/dsh-plugin-requirements/service.mjs'), [
    'packages/dsh-plugin-requirements/test/<area>.test.mjs',
  ])
})

test('changed files are normalized across Windows separators', () => {
  const result = evaluateObligation({
    files: ['packages\\alm-core\\src\\commands.mjs'],
  })
  assert.equal(result.status, 'missing')
  assert.deepEqual(result.sources, ['packages/alm-core/src/commands.mjs'])
})
