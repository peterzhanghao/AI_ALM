import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, test } from 'node:test'
import { HELP } from '../../../alm-core/src/cli.mjs'
import { checkSkills, helpCommands, registryTools } from '../../../../scripts/lib/skill-check.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
const tempDirs = []

function makeRoot({ command = 'alm impact', tool = 'alm_index alm_check', extraLink = '' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'alm-skill-'))
  tempDirs.push(root)

  mkdirSync(join(root, '.dsh/skills/demo-dev/references'), { recursive: true })
  writeFileSync(
    join(root, '.dsh/skills/demo-dev/SKILL.md'),
    ['---', 'name: demo-dev', 'description: "dev skill"', '---', '', 'See [`commands`](references/commands.md).', extraLink].join('\n'),
    'utf8',
  )
  writeFileSync(
    join(root, '.dsh/skills/demo-dev/references/commands.md'),
    ['## 使用中的命令', '', '| 命令 | 用途 |', '|---|---|', '| `alm index` | 索引 |', '| `alm check` | 门禁 |', `| \`${command}\` | 影响 |`].join('\n'),
    'utf8',
  )

  mkdirSync(join(root, 'packages/alm-skills/demo-product/references'), { recursive: true })
  writeFileSync(
    join(root, 'packages/alm-skills/demo-product/SKILL.md'),
    [
      '---',
      'name: demo-product',
      'description: "product skill"',
      '---',
      '',
      '[commands](references/commands.md)、[permissions](references/permissions.md)',
    ].join('\n'),
    'utf8',
  )
  writeFileSync(
    join(root, 'packages/alm-skills/demo-product/references/commands.md'),
    ['## 使用中的命令', '', '| 命令 | 用途 |', '|---|---|', '| `alm index` | 索引 |', '| `alm check` | 门禁 |', '| `alm impact` | 影响 |'].join('\n'),
    'utf8',
  )
  writeFileSync(
    join(root, 'packages/alm-skills/demo-product/references/permissions.md'),
    ['# 权限', '', `<!-- alm-tools: ${tool} -->`].join('\n'),
    'utf8',
  )

  mkdirSync(join(root, 'packages/dsh-plugin-alm-core'), { recursive: true })
  writeFileSync(
    join(root, 'packages/dsh-plugin-alm-core/index.js'),
    "tools.register({ name: 'alm_index' })\ntools.register({ name: 'alm_check' })\n",
    'utf8',
  )

  return root
}

const HELPTEXT = `alm 0.0.0

Commands:
  index             Index assets
  check             Run gates
  impact --asset    Impact closure
  contract verify   Validate contracts

Options:
  --root <dir>      Root
`

after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

test('helpCommands reads only the Commands block', () => {
  assert.deepEqual([...helpCommands(HELPTEXT)], ['index', 'check', 'impact', 'contract'])
})

test('registryTools extracts registered tool names', () => {
  assert.deepEqual([...registryTools("name: 'alm_index' name: 'alm_workspace_guard'")], ['alm_index', 'alm_workspace_guard'])
})

test('the repository skills pass against the live CLI', () => {
  const result = checkSkills({ root: repoRoot, help: HELP })
  assert.deepEqual(result.failures, [])
  assert.equal(result.ok, true)
  assert.ok(result.skills.some((skill) => skill.label === 'dev:alm-mvp-dev'))
})

test('a removed CLI command fails and points at the citing skill line', () => {
  const help = HELP.replace(/^ {2}impact\b.*$/m, '')
  const result = checkSkills({ root: repoRoot, help })
  assert.equal(result.ok, false)

  const failure = result.failures.find((entry) => entry.message.includes('"alm impact"'))
  assert.ok(failure, 'expected a failure for the removed impact command')
  assert.match(failure.file, /\.md$/)
  assert.ok(failure.line >= 1, 'failure must carry a line number')
})

test('a valid fixture tree passes', () => {
  const result = checkSkills({ root: makeRoot(), help: HELPTEXT })
  assert.deepEqual(result.failures, [])
  assert.equal(result.ok, true)
  assert.equal(result.skills.length, 2)
})

test('an undeclared tool is rejected', () => {
  const root = makeRoot({ tool: 'alm_index alm_publish' })
  const result = checkSkills({ root, help: HELPTEXT })
  assert.equal(result.ok, false)
  assert.ok(result.failures.some((entry) => entry.message.includes('alm_publish')))
})

test('a tool used in prose but not declared is rejected', () => {
  const root = makeRoot()
  writeFileSync(
    join(root, 'packages/alm-skills/demo-product/references/commands.md'),
    ['## 使用中的命令', '`alm_check` 只读；`alm_show` 未声明。'].join('\n'),
    'utf8',
  )
  const result = checkSkills({ root, help: HELPTEXT })
  assert.equal(result.ok, false)
  assert.ok(result.failures.some((entry) => entry.message.includes('alm_show')))
})

test('a broken relative link is rejected', () => {
  const root = makeRoot({ extraLink: '\n[missing](references/missing.md)' })
  const result = checkSkills({ root, help: HELPTEXT })
  assert.equal(result.ok, false)
  assert.ok(result.failures.some((entry) => entry.message.includes('broken reference references/missing.md')))
})

test('a command missing from --help is rejected with file and line', () => {
  const root = makeRoot({ command: 'alm deploy' })
  const result = checkSkills({ root, help: HELPTEXT })
  assert.equal(result.ok, false)
  const failure = result.failures.find((entry) => entry.message.includes('"alm deploy"'))
  assert.ok(failure)
  assert.equal(failure.file, 'references/commands.md')
  assert.equal(failure.line, 7)
})

test('sections listing unimplemented commands are not claims', () => {
  const root = makeRoot()
  writeFileSync(
    join(root, '.dsh/skills/demo-dev/references/commands.md'),
    [
      '## 已实现',
      '',
      '| 命令 | 用途 |',
      '|---|---|',
      '| `alm index` | 索引 |',
      '| `alm check` | 门禁 |',
      '| `alm impact` | 影响 |',
      '',
      '## 计划中（未实现）',
      '',
      '| `alm evidence show` | 计划 |',
    ].join('\n'),
    'utf8',
  )
  const result = checkSkills({ root, help: HELPTEXT })
  assert.deepEqual(result.failures, [])
})
