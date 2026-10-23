#!/usr/bin/env node
/**
 * End-to-end fixture regression: positive samples must pass, every enforced
 * negative sample must fail with the declared rule.
 *
 * This runs the CLI in-process so it works without a shell, and it exercises
 * the same exit codes a user or CI pipeline sees.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { run } from '../packages/alm-core/src/cli.mjs'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const FIXTURES = join(ROOT, 'fixtures')
const POSITIVE = [
  { dir: 'order-refund', assets: 7 },
  { dir: 'smoke', assets: 3 },
]

function capture() {
  const chunks = []
  return {
    write(chunk) {
      chunks.push(String(chunk))
    },
    get text() {
      return chunks.join('')
    },
  }
}

async function invoke(argv) {
  const out = capture()
  const err = capture()
  const code = await run(argv, { out, err })
  let json
  if (out.text.trim()) {
    try {
      json = JSON.parse(out.text)
    } catch {
      json = undefined
    }
  }
  return { code, out: out.text, err: err.text, json }
}

let failures = 0

function pass(message) {
  console.log(`PASS  ${message}`)
}

function fail(message) {
  failures += 1
  console.error(`FAIL  ${message}`)
}

for (const positive of POSITIVE) {
  const root = join(FIXTURES, positive.dir)
  const check = await invoke(['check', '--root', root, '--json'])
  if (check.code !== 0) {
    fail(`${positive.dir}: check exited ${check.code} (expected 0)${check.err ? `: ${check.err.trim()}` : ''}`)
  } else if (check.json?.result !== 'pass') {
    fail(`${positive.dir}: check result ${String(check.json?.result)} (expected pass)`)
  } else {
    pass(`${positive.dir}: check pass`)
  }

  const index = await invoke(['index', '--root', root, '--json'])
  if (index.code !== 0) {
    fail(`${positive.dir}: index exited ${index.code} (expected 0)`)
  } else if (index.json?.errors?.length !== 0) {
    fail(`${positive.dir}: index reported ${index.json.errors.length} parse errors`)
  } else if (index.json?.assets?.length !== positive.assets) {
    fail(`${positive.dir}: index found ${index.json?.assets?.length ?? 0} assets (expected ${positive.assets})`)
  } else {
    pass(`${positive.dir}: index ${positive.assets} assets without parse errors`)
  }
}

const cases = JSON.parse(readFileSync(join(FIXTURES, 'negative', 'cases.json'), 'utf8'))
if (!Array.isArray(cases) || cases.length < 5) {
  fail(`negative/cases.json: expected at least 5 cases, found ${Array.isArray(cases) ? cases.length : 0}`)
}

for (const testCase of cases) {
  if (!testCase.enforced) {
    console.log(`SKIP  ${testCase.dir}: documented but not enforced`)
    continue
  }

  const root = join(FIXTURES, 'negative', testCase.dir)
  const check = await invoke(['check', '--root', root, '--json'])
  if (check.code !== 1) {
    fail(`${testCase.dir}: check exited ${check.code} (expected 1)`)
    continue
  }
  if (check.json?.result !== 'fail') {
    fail(`${testCase.dir}: check result ${String(check.json?.result)} (expected fail)`)
    continue
  }

  const rule = check.json.checks?.find((entry) => entry.id === testCase.rule)
  if (!rule) {
    fail(`${testCase.dir}: missing rule ${testCase.rule}`)
    continue
  }
  if (!Array.isArray(rule.findings) || rule.findings.length === 0) {
    fail(`${testCase.dir}: rule ${testCase.rule} produced no findings`)
    continue
  }
  if (!rule.findings[0].file) {
    fail(`${testCase.dir}: rule ${testCase.rule} finding has no source file`)
    continue
  }
  pass(`${testCase.dir}: failed with ${testCase.rule}`)
}

console.log('')
if (failures > 0) {
  console.error(`fixture regression: ${failures} failure(s)`)
  process.exitCode = 1
} else {
  console.log(`fixture regression: passed (${POSITIVE.length} positive, ${cases.filter((entry) => entry.enforced).length} negative)`)
}
