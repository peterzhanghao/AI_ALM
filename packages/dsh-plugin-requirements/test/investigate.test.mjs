import assert from 'node:assert/strict'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  INVESTIGATION_SCHEMA,
  InvestigationError,
  buildInvestigationMessages,
  collectEvidence,
  listInvestigations,
  normalizeInvestigation,
  readInvestigation,
  runInvestigation,
  writeInvestigation,
} from '../investigate.mjs'

// ---------------------------------------------------------------------------
// Temp repository with relevant matches, runtime noise, oversize/binary files,
// and (when the platform allows it) symlinks that must not escape the root.
// ---------------------------------------------------------------------------

function write(root, rel, content) {
  const target = join(root, rel)
  mkdirSync(join(target, '..'), { recursive: true })
  writeFileSync(target, content, 'utf8')
}

function listAll(dir, base = dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name)
    const rel = abs.slice(base.length + 1).replaceAll('\\', '/')
    if (entry.isDirectory()) listAll(abs, base, out)
    else out.push(rel)
  }
  return out.sort()
}

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'intent-investigate-'))
  const outside = mkdtempSync(join(tmpdir(), 'intent-investigate-outside-'))
  write(root, 'src/list.mjs', ['export function loadList() {', '  // 加载列表慢：先查缓存 cache', '  return query(list)', '}', ''].join('\n'))
  write(root, 'src/session.mjs', 'export function session() {\n  return null\n}\n')
  write(root, 'README.md', '# demo\n需求列表加载性能\n')
  write(root, 'docs/notes.md', '列表加载调查记录\n')
  write(root, 'big.txt', `${'x'.repeat(600_000)}\n`)
  write(root, 'binary.txt', 'abc\u0000def\n')
  write(root, 'node_modules/dep/index.js', 'export const load = "LEAK-NODE-MODULES"\n')
  write(root, '.git/config', '[core]\n\trepositoryformatversion = 0\n')
  write(root, '.alm/project.json', '{"id":"PAY"}\n')
  write(root, '.alm/intents/sessions/INT-20260101000000-abcdef.json', '{"secret":"LEAK-SESSION"}\n')
  write(outside, 'outside.txt', 'TOP_SECRET_OUTSIDE 加载\n')
  let hasSymlinks = false
  try {
    symlinkSync(join(root, 'src/list.mjs'), join(root, 'link-in.mjs'))
    symlinkSync(join(outside, 'outside.txt'), join(root, 'escape.mjs'))
    hasSymlinks = true
  } catch {
    hasSymlinks = false
  }
  return { root, outside, hasSymlinks }
}

// ---------------------------------------------------------------------------
// collectEvidence: read-only, bounded, path-safe
// ---------------------------------------------------------------------------

test('collectEvidence picks relevant files and snippets and skips runtime noise', () => {
  const { root } = makeRepo()
  const evidence = collectEvidence({ root, question: '列表加载慢，缓存没有命中' })

  assert.ok(evidence.files.some((file) => file.path === 'src/list.mjs'), JSON.stringify(evidence.files))
  assert.ok(!evidence.files.some((file) => file.path.startsWith('node_modules/')), 'node_modules must not be evidence')
  assert.ok(!evidence.files.some((file) => file.path.startsWith('.git/')), '.git must not be evidence')
  assert.ok(!evidence.files.some((file) => file.path.startsWith('.alm/intents')), 'runtime state must not be evidence')
  assert.ok(evidence.tree.includes('.alm/project.json'), 'project.json is the allowed .alm exception')

  for (const keyword of ['load', 'list', 'cache']) assert.ok(evidence.keywords.includes(keyword), `missing ${keyword}`)
  const snippet = evidence.snippets.find((entry) => entry.path === 'src/list.mjs' && entry.text.includes('加载列表慢'))
  assert.ok(snippet, 'expected a snippet from src/list.mjs')
  assert.equal(snippet.line, 2)
  assert.ok(snippet.text.includes('加载列表慢'))
  assert.ok(evidence.boundary.scannedFiles > 0)
  assert.ok(!JSON.stringify(evidence).includes('LEAK-NODE-MODULES'))
  assert.ok(!JSON.stringify(evidence).includes('LEAK-SESSION'))
})

test('collectEvidence rejects traversal, absolute and symlink escapes without leaking content', () => {
  const { root, outside, hasSymlinks } = makeRepo()
  const traversed = collectEvidence({ root, question: '任意', focus: ['../outside.txt'] })
  assert.ok(traversed.boundary.skipped.some((entry) => entry.reason === 'outside-root'))
  assert.ok(!JSON.stringify(traversed).includes('TOP_SECRET_OUTSIDE'))

  const absolute = collectEvidence({ root, question: '任意', focus: [join(outside, 'outside.txt')] })
  assert.ok(absolute.boundary.skipped.some((entry) => entry.reason === 'outside-root'))
  assert.ok(!JSON.stringify(absolute).includes('TOP_SECRET_OUTSIDE'))

  const focused = collectEvidence({ root, question: 'list', focus: ['src/list.mjs'] })
  assert.equal(focused.files[0].path, 'src/list.mjs')

  if (hasSymlinks) {
    const linked = collectEvidence({ root, question: '任意' })
    assert.ok(
      linked.boundary.skipped.some((entry) => entry.path === 'escape.mjs' && entry.reason === 'outside-root'),
      'escaping symlink must be skipped',
    )
    assert.ok(!JSON.stringify(linked).includes('TOP_SECRET_OUTSIDE'))
  }
})

test('collectEvidence enforces per-file size, snippet/file caps and reports the limits', () => {
  const { root } = makeRepo()
  for (let index = 0; index < 45; index += 1) {
    write(root, `many/file-${String(index).padStart(2, '0')}.mjs`, `export const load = ${index}\n`)
  }
  const evidence = collectEvidence({ root, question: 'load list cache' })

  assert.ok(evidence.files.length <= 40)
  assert.ok(evidence.snippets.length <= 60)
  assert.equal(evidence.boundary.truncated, true)
  assert.ok(
    evidence.boundary.skipped.some((entry) => entry.reason === 'too-many'),
    'file-cap overflow is reported as too-many',
  )
  assert.ok(evidence.boundary.skipped.some((entry) => entry.path === 'big.txt' && entry.reason === 'too-large'))
  assert.ok(evidence.boundary.skipped.some((entry) => entry.path === 'binary.txt' && entry.reason === 'binary'))
  assert.ok(!evidence.files.some((file) => file.path === 'big.txt' || file.path === 'binary.txt'))
})

test('collectEvidence keeps oversized focus entries out of the pack', () => {
  const { root } = makeRepo()
  const evidence = collectEvidence({ root, question: 'list', focus: ['nope/missing.mjs'] })
  assert.ok(evidence.boundary.skipped.some((entry) => entry.reason === 'not-found'))
})

// ---------------------------------------------------------------------------
// Prompt shape: host requires content to be a parts array
// ---------------------------------------------------------------------------

test('buildInvestigationMessages returns a string system prompt and array content', () => {
  const { root } = makeRepo()
  const evidence = collectEvidence({ root, question: '列表加载慢' })
  const { system, user } = buildInvestigationMessages({ question: '列表加载慢', evidence, session: { project: { id: 'PAY' } } })
  assert.equal(typeof system, 'string')
  assert.ok(system.includes('只读') && system.includes('JSON'))
  assert.ok(Array.isArray(user))
  assert.equal(user[0].type, 'text')
  assert.equal(typeof user[0].text, 'string')
  assert.ok(user[0].text.includes('src/list.mjs'))
  assert.ok(user[0].text.includes('列表加载慢'))
})

// ---------------------------------------------------------------------------
// normalizeInvestigation: quote verification and degradation
// ---------------------------------------------------------------------------

function investigationJson({ quote, path = 'src/list.mjs', line = 2, verdict = 'answered', extra = {} } = {}) {
  return JSON.stringify({
    verdict,
    summary: '缓存未命中导致列表加载变慢',
    findings: [{ claim: '列表加载会先查缓存', refs: [{ path, line, endLine: line, quote }], confidence: 'high' }],
    unknowns: [],
    nextStep: null,
    ...extra,
  })
}

test('normalizeInvestigation keeps only refs whose quote matches the real line', () => {
  const { root } = makeRepo()
  const evidence = collectEvidence({ root, question: '列表加载慢' })
  const lines = readFileSync(join(root, 'src/list.mjs'), 'utf8').split('\n')
  const quote = lines[1].trim()
  const investigation = normalizeInvestigation(investigationJson({ quote }), { evidence, root })

  assert.equal(investigation.schema, INVESTIGATION_SCHEMA)
  assert.equal(investigation.verdict, 'answered')
  assert.equal(investigation.source, 'observed_evidence')
  assert.equal(investigation.findings.length, 1)
  assert.equal(investigation.findings[0].refs[0].path, 'src/list.mjs')
  assert.equal(investigation.findings[0].refs[0].line, 2)
  assert.equal(investigation.findings[0].refs[0].verified, true)
  assert.ok(investigation.findings[0].refs[0].quote.includes('加载列表慢'))

  // ```json fences are tolerated.
  const fenced = normalizeInvestigation(`\`\`\`json\n${investigationJson({ quote })}\n\`\`\``, { evidence, root })
  assert.equal(fenced.findings.length, 1)
})

test('normalizeInvestigation downgrades unverifiable findings to unknowns', () => {
  const { root } = makeRepo()
  const evidence = collectEvidence({ root, question: '列表加载慢' })
  const investigation = normalizeInvestigation(
    investigationJson({ quote: '这句话不在文件里 at all' }),
    { evidence, root },
  )
  assert.equal(investigation.findings.length, 0)
  assert.equal(investigation.verdict, 'not-determined')
  assert.equal(investigation.source, 'hypothesis')
  assert.ok(investigation.warnings.includes('unverified-ref'))
  assert.ok(investigation.unknowns.some((unknown) => unknown.description.startsWith('未验证？')))
})

test('normalizeInvestigation drops malformed refs instead of rejecting the answer', () => {
  const { root } = makeRepo()
  const evidence = collectEvidence({ root, question: '列表加载慢' })
  const json = JSON.stringify({
    verdict: 'partially-answered',
    summary: '有一个可核对引用',
    findings: [
      {
        claim: '短引用不可核对',
        refs: [
          { path: 'src/list.mjs', line: 2, endLine: 2, quote: '短' },
          { path: 'src/list.mjs', line: 2, endLine: 2, quote: readFileSync(join(root, 'src/list.mjs'), 'utf8').split('\n')[1].trim() },
          { path: '../escape.mjs', line: 1, endLine: 1, quote: 'export const x = 1' },
        ],
        confidence: 'medium',
      },
    ],
    unknowns: [],
    nextStep: null,
  })
  const investigation = normalizeInvestigation(json, { evidence, root })
  assert.equal(investigation.findings.length, 1)
  assert.equal(investigation.findings[0].refs.length, 1)
  assert.ok(investigation.warnings.includes('unverified-ref'))
})

test('normalizeInvestigation rejects executable fields and unknown enums', () => {
  const { root } = makeRepo()
  const evidence = collectEvidence({ root, question: '列表加载慢' })
  const lines = readFileSync(join(root, 'src/list.mjs'), 'utf8').split('\n')
  const quote = lines[1].trim()

  assert.throws(
    () => normalizeInvestigation(investigationJson({ quote, extra: { apply: true } }), { evidence, root }),
    (error) => error instanceof InvestigationError && error.code === 'ai-invalid-output',
  )
  assert.throws(
    () => normalizeInvestigation(investigationJson({ quote, verdict: 'approved' }), { evidence, root }),
    (error) => error instanceof InvestigationError && error.code === 'ai-invalid-output',
  )
  assert.throws(
    () => normalizeInvestigation('not json at all', { evidence, root }),
    (error) => error instanceof InvestigationError && error.code === 'ai-invalid-output',
  )
})

// ---------------------------------------------------------------------------
// runInvestigation + store
// ---------------------------------------------------------------------------

function fakeStream(lines, state) {
  return async (options) => {
    state.push(options)
    return (async function* () {
      yield { type: 'text-delta', text: investigationJson({ quote: lines[1].trim() }) }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })()
  }
}

test('runInvestigation without a model is a 503 no-model error', async () => {
  const { root } = makeRepo()
  await assert.rejects(
    runInvestigation({
      root,
      session: { sessionId: 'INT-20260101000000-abcdef' },
      question: '列表加载慢',
    }),
    (error) => error instanceof InvestigationError && error.code === 'no-model' && error.status === 503,
  )
})

test('runInvestigation writes the store + audit and leaves repository files untouched', async () => {
  const { root } = makeRepo()
  const lines = readFileSync(join(root, 'src/list.mjs'), 'utf8').split('\n')
  const session = {
    sessionId: 'INT-20260101000000-abcdef',
    project: { id: 'PAY' },
    input: { inputRevision: 1 },
  }
  const before = listAll(root).filter((file) => !file.startsWith('.alm/'))
  const calls = []
  const { investigation } = await runInvestigation({
    aiStream: fakeStream(lines, calls),
    provider: 'fake',
    model: 'fake-model',
    root,
    session,
    question: '列表加载慢',
  })

  assert.match(investigation.investigationId, /^INV-\d{14}-[0-9a-f]{6}$/)
  assert.equal(investigation.sessionId, session.sessionId)
  assert.equal(investigation.verdict, 'answered')
  assert.equal(investigation.source, 'observed_evidence')
  assert.equal(calls.length, 1)
  assert.equal(typeof calls[0].system, 'string')
  assert.ok(Array.isArray(calls[0].messages[0].content))
  assert.equal(calls[0].messages[0].content[0].type, 'text')
  assert.equal(calls[0].maxTokens, 8000)
  assert.equal(calls[0].temperature, 0.2)

  assert.ok(statSync(join(root, '.alm/intents/investigations', `${investigation.investigationId}.json`)).isFile())
  assert.ok(statSync(join(root, '.alm/audit/intents/investigations.jsonl')).isFile())
  const stored = readInvestigation(root, investigation.investigationId)
  assert.equal(stored.schema, INVESTIGATION_SCHEMA)
  assert.equal(stored.findings[0].refs[0].verified, true)
  assert.deepEqual(listInvestigations(root, { sessionId: session.sessionId }).map((entry) => entry.investigationId), [
    investigation.investigationId,
  ])
  assert.deepEqual(listInvestigations(root, { sessionId: 'INT-20260101000000-000000' }), [])

  const after = listAll(root).filter((file) => !file.startsWith('.alm/'))
  assert.deepEqual(after, before, 'investigation must not write repository files')
})

test('store rejects malformed ids and unknown records', () => {
  const { root } = makeRepo()
  assert.equal(readInvestigation(root, 'INV-bad'), null)
  assert.throws(
    () => writeInvestigation(root, { schema: INVESTIGATION_SCHEMA, investigationId: '../escape' }),
    (error) => error instanceof InvestigationError,
  )
  assert.equal(readInvestigation(root, 'INV-20260101000000-abcdef'), null)
})
