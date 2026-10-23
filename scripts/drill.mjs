#!/usr/bin/env node
/**
 * Three end-to-end drills over the shipped ALM tooling, with timings and UI
 * verification. Everything runs in a throwaway copy of `fixtures/order-refund`
 * so the repository itself stays clean.
 *
 *   A. normal change: workspace -> new requirement + acceptance test -> gates,
 *      diff, impact, evidence
 *   B. gate failure: dangling relation -> REL-001 -> repair -> pass
 *   C. release: baseline -> publish -> verify -> rollback -> verify, plus
 *      idempotent re-runs
 *
 * Usage: node scripts/drill.mjs [--out tmp/drills]
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../', import.meta.url))
const outDir = resolve(process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'tmp/drills')
const workDir = join(outDir, 'repo')
const almBin = join(repoRoot, 'packages/alm-core/bin/alm.mjs')

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

const steps = []
const drills = []

function git(args) {
  return execFileSync('git', ['-c', 'user.name=drill-bot', '-c', 'user.email=drill@example.invalid', ...args], {
    cwd: workDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
}

/** Run one CLI step and record timing, exit code and expected result. */
function alm(drill, name, args, expect = 0, mustInclude) {
  const started = Date.now()
  let exit = 0
  let output = ''
  try {
    output = execFileSync(process.execPath, [almBin, ...args], {
      cwd: workDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    exit = typeof error.status === 'number' ? error.status : 1
    output = `${error.stdout ?? ''}${error.stderr ?? ''}`
  }
  const ms = Date.now() - started
  const includes = mustInclude ? `${output}`.includes(mustInclude) : true
  const ok = exit === expect && includes
  steps.push({ drill, name, ms, exit, expect, ok, output: `${output}`.trim().split(/\r?\n/).slice(-3).join('\n') })
  if (!ok) console.error(`FAIL  ${drill} ${name}: exit=${exit} expected=${expect}${mustInclude ? ` includes "${mustInclude}"` : ''}`)
  return { exit, output, ok }
}

function ui(drill, subdir) {
  const out = join(outDir, `ui-${subdir}`)
  const started = Date.now()
  const result = spawnSync(process.execPath, [join(repoRoot, 'scripts/ui-verify.mjs'), '--root', workDir, '--out', out], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const ms = Date.now() - started
  const path = join(out, 'report.json')
  const report = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { ok: false, checks: [], shots: [] }
  const ok = result.status === 0 && report.ok === true
  steps.push({
    drill,
    name: `ui-verify (${subdir})`,
    ms,
    exit: result.status ?? 1,
    expect: 0,
    ok,
    output: `${report.checks.length} checks`,
  })
  if (!ok) console.error(`FAIL  ${drill} ui-verify: ${(result.stderr ?? '').trim().split(/\r?\n/).slice(-2).join(' | ')}`)
  return { ok, ms, checks: report.checks?.length ?? 0, passed: (report.checks ?? []).filter((entry) => entry.ok).length, shots: report.shots ?? [] }
}

function drill(id, title, body) {
  const started = Date.now()
  const uiResult = body()
  const ms = Date.now() - started
  const drillSteps = steps.filter((step) => step.drill === id)
  drills.push({
    id,
    title,
    ms,
    ok: drillSteps.every((step) => step.ok) && (!uiResult || uiResult.ok),
    steps: drillSteps,
    ui: uiResult,
  })
}

// ---- seed -----------------------------------------------------------------
cpSync(join(repoRoot, 'fixtures/order-refund'), workDir, { recursive: true })
cpSync(join(repoRoot, 'packages/alm-skills'), join(workDir, '.dsh/skills'), { recursive: true })
execFileSync('git', ['init', '-q'], { cwd: workDir })
git(['add', '-A'])
git(['commit', '-q', '-m', 'chore: seed order-refund baseline'])
const seedSha = git(['rev-parse', 'HEAD'])

// ---- A: normal change ------------------------------------------------------
drill('A', '正常变更：新增需求与验收并过门禁', () => {
  alm('A', 'workspace create', ['workspace', 'create', '--baseline', seedSha, '--change', 'CHG-DRILL-A'])
  const requirements = readFileSync(join(workDir, 'requirements/refund.sdoc'), 'utf8')
  writeFileSync(
    join(workDir, 'requirements/refund.sdoc'),
    `${requirements.trimEnd()}

[REQUIREMENT]
UID: REQ-PAY-002
TITLE: 退款金额不得超过订单可退余额
STATUS: proposed
OWNER: team-payments

[RELATION]
Type: allocated_to
Value: MOD-PAY-REFUND

[RELATION]
Type: constrained_by
Value: ADR-PAY-003

[RELATION]
Type: verified_by
Value: TEST-PAY-002
`,
    'utf8',
  )
  const tests = readFileSync(join(workDir, 'tests/refund.sdoc'), 'utf8')
  writeFileSync(
    join(workDir, 'tests/refund.sdoc'),
    `${tests.trimEnd()}

[REQUIREMENT]
UID: TEST-PAY-002
TITLE: 超过可退余额的退款请求被拒绝且不产生退款单
STATUS: proposed
OWNER: team-qa
`,
    'utf8',
  )
  alm('A', 'check --base', ['check', '--base', seedSha], 0, 'check: pass')
  alm('A', 'diff', ['diff', '--base', seedSha, '--json'], 0, 'REQ-PAY-002')
  alm('A', 'impact', ['impact', '--asset', 'REQ-PAY-002', '--json'])
  alm('A', 'check --out evidence', ['check', '--base', seedSha, '--out', '.alm/evidence/chg-a.json'])
  git(['add', '-A'])
  git(['commit', '-q', '-m', 'feat: CHG-DRILL-A partial refund limit'])
  return ui('A', 'a')
})

// ---- B: gate failure and repair -------------------------------------------
drill('B', '门禁失败修复：悬空关系 REL-001', () => {
  writeFileSync(
    join(workDir, 'requirements/broken.sdoc'),
    `[DOCUMENT]
TITLE: 演练负例

[REQUIREMENT]
UID: REQ-PAY-003
TITLE: 演练用悬空关系
STATUS: proposed
OWNER: team-payments

[RELATION]
Type: verified_by
Value: TEST-PAY-999
`,
    'utf8',
  )
  alm('B', 'check fails REL-001', ['check'], 1, 'REL-001')
  writeFileSync(
    join(workDir, 'requirements/broken.sdoc'),
    `[DOCUMENT]
TITLE: 演练负例

[REQUIREMENT]
UID: REQ-PAY-003
TITLE: 演练用悬空关系（已修复）
STATUS: proposed
OWNER: team-payments

[RELATION]
Type: verified_by
Value: TEST-PAY-002
`,
    'utf8',
  )
  alm('B', 'check after repair', ['check'], 0, 'check: pass')
  git(['add', '-A'])
  git(['commit', '-q', '-m', 'fix: CHG-DRILL-B repair dangling relation'])
  return ui('B', 'b')
})

// ---- C: release chain ------------------------------------------------------
drill('C', '发布链：基线、发布、校验、回滚与幂等', () => {
  const head = git(['rev-parse', 'HEAD'])
  const approval = join(outDir, 'approval.json')
  writeFileSync(
    approval,
    `${JSON.stringify(
      {
        schema: 'alm.approval/v1',
        changeId: 'CHG-DRILL-C',
        headSha: head,
        actor: 'human:drill-reviewer',
        kind: 'human',
        decision: 'approve',
        at: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
  for (const id of ['BL-DRILL-001', 'BL-DRILL-002']) {
    alm('C', `baseline create ${id}`, [
      'baseline',
      'create',
      '--commit',
      'HEAD',
      '--tag',
      'drill',
      '--approval',
      approval,
      '--id',
      id,
      '--out',
      '.alm/baselines',
    ])
  }
  for (const id of ['BL-DRILL-001', 'BL-DRILL-002']) {
    alm('C', `release publish ${id}`, ['release', 'publish', '--manifest', `.alm/baselines/${id}.json`])
  }
  alm('C', 'release publish again (unchanged)', ['release', 'publish', '--manifest', '.alm/baselines/BL-DRILL-001.json'], 0, 'unchanged')
  alm('C', 'release verify', ['release', 'verify', '--baseline', 'BL-DRILL-001'], 0, 'release verify ok')
  alm('C', 'release rollback', ['release', 'rollback', '--to', 'BL-DRILL-001'])
  alm('C', 'release verify after rollback', ['release', 'verify', '--baseline', 'BL-DRILL-001'], 0, 'release verify ok')
  alm('C', 'ci run', ['ci', 'run'], 0, 'ci created')
  alm('C', 'ci run again (unchanged)', ['ci', 'run'], 0, 'ci unchanged')
  alm('C', 'ci status', ['ci', 'status', '--sha', 'HEAD'], 0, 'ci ok')
  return ui('C', 'c')
})

// ---- report ----------------------------------------------------------------
const ok = drills.every((entry) => entry.ok)
const metrics = {
  durationMs: drills.reduce((total, entry) => total + entry.ms, 0),
  humanInterventions: 0,
  aiAdoptionRate: '未采集',
  misses: '未采集',
  falsePositives: '未采集',
}

const report = {
  schema: 'alm.drills/v1',
  ok,
  environment: {
    node: process.versions.node,
    platform: `${process.platform} ${process.arch}`,
    host: hostname(),
  },
  seed: { fixture: 'fixtures/order-refund', commit: seedSha },
  drills,
  metrics,
  at: new Date().toISOString(),
}
writeFileSync(join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')

const rows = [
  '# 三次变更演练报告',
  '',
  `- 环境：node ${report.environment.node} · ${report.environment.platform}`,
  `- 种子：${report.seed.fixture} @ ${seedSha.slice(0, 8)}`,
  `- 结论：${ok ? '全部通过' : '存在失败步骤，见下表'}`,
  '',
  '| 演练 | 结论 | 总耗时 (ms) |',
  '|---|---|---|',
  ...drills.map((entry) => `| ${entry.id} ${entry.title} | ${entry.ok ? 'pass' : 'fail'} | ${entry.ms} |`),
  '',
  '## 步骤明细',
  '',
  '| 演练 | 步骤 | 耗时 (ms) | 退出码 | 期望 | 结果 |',
  '|---|---|---|---|---|---|',
  ...steps.map(
    (step) => `| ${step.drill} | ${step.name} | ${step.ms} | ${step.exit} | ${step.expect} | ${step.ok ? 'pass' : 'fail'} |`,
  ),
  '',
  '## UI 验证',
  '',
  '| 演练 | 检查数 | 通过 | 截图 |',
  '|---|---|---|---|',
  ...drills
    .filter((entry) => entry.ui)
    .map(
      (entry) =>
        `| ${entry.id} | ${entry.ui.checks} | ${entry.ui.passed} | ${entry.ui.shots.map((shot) => `\`${shot}\``).join('<br>')} |`,
    ),
  '',
  '## 指标',
  '',
  '| 指标 | 值 | 说明 |',
  '|---|---|---|',
  `| 总耗时 | ${metrics.durationMs} ms | 三演练步骤与 UI 检查合计 |`,
  `| 人工介入 | ${metrics.humanInterventions} | 全自动执行；需要人工判断的项见下 |`,
  `| AI 建议采纳率 | ${metrics.aiAdoptionRate} | 需要评审人逐条打分，不估算 |`,
  `| 漏检/误报 | ${metrics.misses} | 需要与期望结果人工比对，不估算 |`,
  '',
]
writeFileSync(join(outDir, 'report.md'), rows.join('\n'), 'utf8')

console.log(rows.slice(0, 12).join('\n'))
console.log(`\ndrill: ${drills.length} drills, ${steps.length} steps -> ${join(outDir, 'report.md')}`)
process.exit(ok ? 0 : 1)
