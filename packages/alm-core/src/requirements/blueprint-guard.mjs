import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'

export const BLUEPRINT_SCHEMA = 'alm.execution-blueprint/v1'
export const WORKSPACE_IMPLEMENTATION_AUTHORIZATION = Object.freeze([
  'packages/',
  'requirements/',
  'tests/',
  '.alm/',
  'package.json',
  'pnpm-lock.yaml',
])
// Generated verification remains intentionally bounded. A single focused Node
// test file gets 30 seconds; every additional file adds budget, and the whole
// command is capped so a dirty worktree can never inflate a requirement's
// acceptance into a repository-wide run.
export const QUICK_VERIFICATION_TIMEOUT_MS = 30_000
export const MAX_VERIFICATION_TEST_FILES = 8
export const VERIFICATION_TIMEOUT_PER_FILE_MS = 15_000
export const VERIFICATION_TIMEOUT_MAX_MS = 180_000

/** Budget grows with the selected test set instead of staying fixed at 30s. */
export function verificationBudget(fileCount) {
  const count = Math.max(1, Number.isInteger(fileCount) ? fileCount : 1)
  return Math.min(VERIFICATION_TIMEOUT_MAX_MS,
    QUICK_VERIFICATION_TIMEOUT_MS + (count - 1) * VERIFICATION_TIMEOUT_PER_FILE_MS)
}

/** Test paths of a registered `node --test` command, ignoring runner flags. */
export function verificationTestFiles(command) {
  if (!Array.isArray(command) || command[0] !== 'node' || !command.includes('--test')) return []
  return command.slice(command.indexOf('--test') + 1).filter(part => typeof part === 'string' && part && !part.startsWith('-'))
}

/**
 * A registered command is unhealthy when its test set exceeds the cap, or its
 * timeout is smaller than the budget that many files need. Both are fixable by
 * re-deriving a bounded command, and neither should be allowed to time out a
 * delivery round.
 */
export function verificationCommandDiagnosis(command, timeoutMs) {
  const files = verificationTestFiles(command)
  const requiredTimeoutMs = verificationBudget(files.length)
  const budget = Number(timeoutMs)
  return {
    fileCount: files.length,
    requiredTimeoutMs,
    oversized: files.length > MAX_VERIFICATION_TEST_FILES,
    underBudget: Number.isFinite(budget) && budget > 0 && budget < requiredTimeoutMs,
  }
}

const TEST_FILE = /(?:^|\/)(?:test|tests)\/.*\.(?:test|spec)\.(?:[cm]?js|tsx?)$/i
const SOURCE_EXTENSIONS = new Set(['.mjs', '.cjs', '.js', '.jsx', '.ts', '.tsx', '.css'])
// These names represent one deliberately small feature boundary. Keeping the
// relation here makes it inspectable and avoids widening a requirement to the
// package (or repository) test suite just because its implementation is an
// HTTP entry point.
const RELATED_TEST_DOMAINS = Object.freeze({
  exchange: ['exchange', 'intent-http', 'clarification'],
})

function normalizedPath(value) {
  return String(value ?? '').replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+/g, '/').trim()
}

function insideRoot(root, value) {
  const path = normalizedPath(value)
  if (!path || path.startsWith('/') || /^[A-Za-z]:/.test(path) || path.split('/').includes('..')) return null
  const absolute = resolve(root, path)
  return relative(resolve(root), absolute).replaceAll('\\', '/').startsWith('..') ? null : path
}

function sourcePaths({ investigationEvidence = [], asset = null, blueprint = null, changedFiles = [] } = {}) {
  const paths = Array.isArray(investigationEvidence)
    ? investigationEvidence.map(entry => typeof entry === 'string' ? entry : entry?.path)
    : []
  if (asset?.source?.path) paths.push(asset.source.path)
  if (asset?.extra?.brief) paths.push(asset.extra.brief)
  if (Array.isArray(blueprint?.allowedPaths)) paths.push(...blueprint.allowedPaths)
  if (Array.isArray(changedFiles)) paths.push(...changedFiles.map(entry => typeof entry === 'string' ? entry : entry?.path))
  return [...new Set(paths.map(normalizedPath).filter(Boolean))]
}

function testCandidates(root, source) {
  const path = insideRoot(root, source)
  if (!path) return []
  const result = []
  if (TEST_FILE.test(path)) result.push(path)
  const extension = extname(path)
  if (!SOURCE_EXTENSIONS.has(extension)) return result
  const stem = basename(path, extension)
  const packageRoot = path.startsWith('packages/') ? path.split('/').slice(0, 2).join('/') : null
  if (packageRoot) {
    result.push(`${packageRoot}/test/${stem}.test.mjs`, `${packageRoot}/test/${stem}.test.js`)
  }
  result.push(`${dirname(path)}/test/${stem}.test.mjs`, `${dirname(path)}/test/${stem}.test.js`)
  return result.map(normalizedPath)
}

function titleMatchedTest(root, sources, asset) {
  const title = String(asset?.title ?? asset?.doc?.title ?? '').trim()
  if (!title) return null
  const roots = [...new Set(sources
    .map(normalizedPath)
    .filter(path => path.startsWith('packages/'))
    .map(path => path.split('/').slice(0, 2).join('/')))]
  const terms = new Set([title])
  for (const text of title.match(/[\u4e00-\u9fff]{2,}/g) ?? []) {
    for (let index = 0; index < text.length - 1; index += 1) terms.add(text.slice(index, index + 2))
  }
  let best = null
  for (const packageRoot of roots) {
    const testRoot = join(root, packageRoot, 'test')
    let names = []
    try { names = readdirSync(testRoot) } catch { continue }
    for (const name of names) {
      if (!/\.(?:test|spec)\.(?:[cm]?js|tsx?)$/i.test(name)) continue
      const path = `${packageRoot}/test/${name}`
      let text = ''
      try { text = readFileSync(join(root, path), 'utf8').slice(0, 512 * 1024) } catch { continue }
      const score = [...terms].reduce((total, term) => total + (text.includes(term) ? term.length : 0), 0)
      if (!best || score > best.score || (score === best.score && path < best.path)) best = { path, score }
    }
  }
  return best?.score >= Math.max(4, Math.floor(title.length / 4)) ? best.path : null
}

function testFilesForDomains(root, sources) {
  const packageRoots = [...new Set(sources
    .filter(path => path.startsWith('packages/'))
    .map(path => path.split('/').slice(0, 2).join('/')))]
  const domains = new Set()
  for (const source of sources) {
    const extension = extname(source)
    if (!SOURCE_EXTENSIONS.has(extension)) continue
    const stem = basename(source, extension).toLowerCase()
    domains.add(stem)
    for (const related of RELATED_TEST_DOMAINS[stem] ?? []) domains.add(related)
  }
  const matched = []
  for (const packageRoot of packageRoots) {
    let names = []
    try { names = readdirSync(join(root, packageRoot, 'test')) } catch { continue }
    for (const name of names) {
      if (!/\.(?:test|spec)\.(?:[cm]?js|tsx?)$/i.test(name)) continue
      const stem = name.replace(/\.(?:test|spec)\.(?:[cm]?js|tsx?)$/i, '').toLowerCase()
      if ([...domains].some(domain => stem === domain || stem.startsWith(`${domain}-`))) matched.push(`${packageRoot}/test/${name}`)
    }
  }
  return matched.sort()
}

/**
 * Build a small, explicit test set from the requirement's evidence and current
 * implementation boundary. Missing paths are never guessed into a command;
 * package-wide and repository-wide globs are never a fallback.
 */
export function deriveVerificationCommand({ root, investigationEvidence = [], asset = null, blueprint = null, changedFiles = [] } = {}) {
  const repo = resolve(root)
  const sources = sourcePaths({ investigationEvidence, asset, blueprint, changedFiles })
  const candidates = sources.flatMap(path => testCandidates(repo, path))
  const direct = [...new Set(candidates)].filter(path => existsSync(join(repo, path)))
  // Title-matched and directly changed tests describe this requirement best;
  // domain expansion is only a supplement. Cap the result so a long-lived
  // dirty worktree cannot turn a requirement into a repository-wide suite.
  const titleMatch = titleMatchedTest(repo, sources, asset)
  const ranked = [...new Set([...(titleMatch ? [titleMatch] : []), ...direct, ...testFilesForDomains(repo, sources)])]
  const testFiles = ranked.slice(0, MAX_VERIFICATION_TEST_FILES)
  if (testFiles.length === 0) return null
  const omittedCount = ranked.length - testFiles.length
  const timeoutMs = verificationBudget(testFiles.length)
  return {
    command: ['node', '--test', ...testFiles],
    // A generated command is part of the handoff path, never a substitute for
    // a repository-wide suite. Its budget follows the bounded file count.
    timeoutMs,
    testFiles,
    omittedCount,
    reason: `根据需求证据推导精准定向验收：node --test ${testFiles.join(' ')}` +
      (omittedCount ? `（另有 ${omittedCount} 个候选用例超出上限 ${MAX_VERIFICATION_TEST_FILES}，已裁剪并计入预算）` : ''),
  }
}

function layerFor(path) {
  const value = normalizedPath(path).toLowerCase()
  if (/client-source|client\.js$|\.(?:jsx|tsx|css)$/.test(value)) return 'frontend'
  if (/(?:^|\/)(?:routes?|api)(?:\/|$)|(?:^|\/)index\.(?:[cm]?js|ts)$/.test(value)) return 'interface'
  if (/alm-core|(?:^|\/)(?:model|store|data|migrations?)(?:\/|$)/.test(value)) return 'data'
  return 'application'
}

function acceptedPaths(root, { asset, investigationEvidence, commands }) {
  const paths = sourcePaths({ asset, investigationEvidence })
  const hasInvestigationScope = Array.isArray(investigationEvidence) && investigationEvidence.some(entry => Boolean(typeof entry === 'string' ? entry : entry?.path))
  for (const entry of commands ?? []) {
    const command = Array.isArray(entry?.command) ? entry.command : []
    const marker = command.indexOf('--test')
    if (marker >= 0) {
      for (const argument of command.slice(marker + 1)) {
        const safe = insideRoot(root, argument)
        if (safe && existsSync(join(root, safe))) paths.push(safe)
      }
    }
    // Non-test Node assertions (for example `node tests/check.cjs`) still
    // identify the verification boundary and are safe to record as a path.
    for (const argument of command.slice(1)) {
      const safe = insideRoot(root, argument)
      if (safe && existsSync(join(root, safe))) paths.push(safe)
    }
  }
  // A newly crystallized requirement can legitimately have no investigation
  // record yet. In that narrow case retain a conservative conventional source
  // boundary for a root-level tests/ command, rather than creating a blueprint
  // that makes every implementation edit an immediate decision. Explicit
  // investigation evidence always wins and stays file-granular.
  if (!hasInvestigationScope && paths.some(path => normalizedPath(path).startsWith('tests/')) && existsSync(join(root, 'src'))) paths.push('src/')
  return [...new Set(paths.map(path => insideRoot(root, path)).filter(Boolean))]
}

export function blueprintPath(root, runId) {
  return join(resolve(root), '.alm', 'runs', `${runId}-blueprint.json`)
}

export function createBlueprint({ root, runId, requirementId, asset = null, investigationEvidence = [], acceptance = null, baseline = null } = {}) {
  if (!/^RUN-[A-Za-z0-9-]+$/.test(String(runId ?? ''))) throw new Error('invalid runId')
  const commands = Array.isArray(acceptance?.commands) ? acceptance.commands : []
  const allowedPaths = [...new Set([
    ...acceptedPaths(root, { asset, investigationEvidence, commands }),
    ...WORKSPACE_IMPLEMENTATION_AUTHORIZATION,
  ])]
  const acceptanceEntries = Array.isArray(asset?.doc?.acceptance) ? asset.doc.acceptance : []
  return {
    schema: BLUEPRINT_SCHEMA,
    scopeMode: 'advisory',
    authorization: {
      mode: 'workspace-implementation',
      grantedAt: new Date().toISOString(),
      paths: [...WORKSPACE_IMPLEMENTATION_AUTHORIZATION],
    },
    runId,
    requirementId,
    createdAt: new Date().toISOString(),
    allowedPaths,
    layers: [...new Set(allowedPaths.map(layerFor))],
    acVerificationMap: acceptanceEntries.map((entry, index) => ({
      id: entry?.id ?? `AC-${String(index + 1).padStart(2, '0')}`,
      check: entry?.text ?? entry?.content ?? '',
      commands: commands.map(command => command.id),
    })),
    commands: commands.map(entry => ({ id: entry.id, command: entry.command })),
    baseline: baseline ? { treeHash: baseline.treeHash ?? null, files: baseline.files ?? [] } : null,
    approvedExpansions: [],
  }
}

export function writeBlueprint(root, blueprint) {
  const target = blueprintPath(root, blueprint.runId)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, `${JSON.stringify(blueprint, null, 2)}\n`, 'utf8')
  return target
}

export function readBlueprint(root, runId) {
  try {
    const value = JSON.parse(readFileSync(blueprintPath(root, runId), 'utf8'))
    return value?.schema === BLUEPRINT_SCHEMA ? value : null
  } catch { return null }
}

function baselineHashes(blueprint) {
  return new Map((blueprint?.baseline?.files ?? []).map(entry => [normalizedPath(entry.path), entry.hash]))
}

function isAllowed(path, allowed) {
  return allowed.some(entry => path === entry || (entry.endsWith('/') && path.startsWith(entry)))
}

/** Check only changes introduced since the run began, ignoring ALM receipts. */
export function inspectBlueprintScope({ blueprint, snapshot }) {
  if (!blueprint || !snapshot?.complete) return { ok: false, outOfScope: [], risky: [], reason: 'snapshot-incomplete' }
  const baseline = baselineHashes(blueprint)
  const changed = (snapshot.files ?? []).filter(entry => baseline.get(normalizedPath(entry.path)) !== entry.hash)
    .map(entry => normalizedPath(entry.path)).filter(path => path && !path.startsWith('.alm/'))
  const outOfScope = changed.filter(path => !isAllowed(path, blueprint.allowedPaths ?? []))
  const risky = changed.filter(path => /(?:^|\/)(?:migrations?|schema|permissions?|roles?)(?:\/|\.|$)|\.(?:sql|prisma)$/i.test(path))
  // A run's blueprint guides the implementation. Starting the run authorizes
  // ordinary workspace code, tests and generated plugin bundles; scope
  // differences remain visible for review but cannot deadlock verification.
  const advisory = blueprint.scopeMode !== 'enforced'
  return { ok: advisory || (outOfScope.length === 0 && risky.length === 0), advisory, enforced: !advisory, outOfScope, risky, changed }
}

export function createScopeDecision({ root, runId, inspection }) {
  const target = join(resolve(root), '.alm', 'runs', `${runId}-decision.md`)
  mkdirSync(dirname(target), { recursive: true })
  const files = [...new Set([...(inspection?.outOfScope ?? []), ...(inspection?.risky ?? [])])]
  const text = [
    '# 决策请求：是否扩大本次需求的影响范围？',
    '',
    '## 要决定什么',
    '本次实现需要修改当前需求蓝图之外的模块，是否批准扩大范围？',
    '',
    '## 背景',
    `- 发现 ${files.length} 个超出原范围或高风险的改动。`,
    '- 未获得明确批准前，系统不会生成交付候选或把这些改动作为验收结果。',
    '',
    '## 决策 1：扩大影响范围',
    '类型：业务',
    '- 选 A：批准扩大范围并继续验收 — 将本次新增模块纳入蓝图，继续完成验证。',
    '- 选 B：拒绝并要求在原范围内实现 — 保持原需求边界，AI 需撤回越界方案。',
    '- 推荐：A（仅在这些模块确为完成当前需求所必需时选择）',
    '',
    '## 等待期间我还能做什么',
    '- 等待你的范围选择后继续实现或调整方案。',
    '',
    '## 技术详情',
    ...files.map(file => `- ${file}`),
  ].join('\n') + '\n'
  writeFileSync(target, text, 'utf8')
  return { path: `.alm/runs/${runId}-decision.md`, hash: createHash('sha256').update(Buffer.from(text)).digest('hex'), files }
}

export function approveBlueprintExpansion({ root, runId, files = [], decisionHash = null }) {
  const blueprint = readBlueprint(root, runId)
  if (!blueprint) throw new Error('blueprint not found')
  const decision = join(resolve(root), '.alm', 'runs', `${runId}-decision.md`)
  const actualHash = existsSync(decision) ? createHash('sha256').update(readFileSync(decision)).digest('hex') : null
  if (!actualHash || actualHash !== decisionHash) throw new Error('decision has changed')
  const safe = [...new Set(files.map(path => insideRoot(root, path)).filter(Boolean))]
  blueprint.allowedPaths = [...new Set([...(blueprint.allowedPaths ?? []), ...safe])]
  blueprint.approvedExpansions = [...(blueprint.approvedExpansions ?? []), { at: new Date().toISOString(), decisionHash, paths: safe }]
  writeBlueprint(root, blueprint)
  return blueprint
}

function testFilesFromCommands(root, commands) {
  const files = []
  for (const entry of commands ?? []) {
    const command = Array.isArray(entry?.command) ? entry.command : []
    const marker = command.indexOf('--test')
    const candidates = marker >= 0 ? command.slice(marker + 1) : command.slice(1)
    for (const path of candidates) {
      const safe = insideRoot(root, path)
      if (safe && existsSync(join(root, safe)) && /\.(?:[cm]?js|tsx?)$/i.test(safe)) files.push(safe)
    }
  }
  return [...new Set(files)]
}

export function snapshotTestFileHashes({ root, commands = [] } = {}) {
  const repo = resolve(root)
  return Object.fromEntries(testFilesFromCommands(repo, commands).map(path => [path, createHash('sha256').update(readFileSync(join(repo, path))).digest('hex')]))
}

export function verifyTestFileHashes({ root, expected = {} } = {}) {
  const repo = resolve(root)
  const changed = []
  for (const [path, hash] of Object.entries(expected ?? {})) {
    const safe = insideRoot(repo, path)
    let actual = null
    try { actual = safe ? createHash('sha256').update(readFileSync(join(repo, safe))).digest('hex') : null } catch {}
    if (actual !== hash) changed.push(path)
  }
  return { ok: changed.length === 0, changed }
}
