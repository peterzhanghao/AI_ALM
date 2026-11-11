import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Temporary workspace roots, removed by the caller. */
export function makeWorkspace(prefix = 'alm-acceptance-') {
  return mkdtempSync(join(tmpdir(), prefix))
}

export function cleanup(dirs) {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
}

/** A one-pixel PNG, enough to exercise inline evidence rendering. */
export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
)

export function writeScenario(root, name, scenario) {
  const dir = join(root, 'acceptance', 'plugins', name, 'scenarios')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'scenario.mjs')
  writeFileSync(file, `export default ${JSON.stringify(scenario, null, 2)}\n`, 'utf8')
  return file
}

/**
 * A static page source module the engine can start: exports `serve()` returning
 * `{ url, close() }`, which is the contract a scenario's `start.module` needs.
 */
export function writeServeModule(root, { rows = 2 } = {}) {
  const file = join(root, 'serve.mjs')
  const body = `import { createServer } from 'node:http'

const html = (rows) => \`<!doctype html><html><head><title>Demo</title></head><body>
<h1>Demo</h1><p>摘要 · 2 项</p><table><thead><tr><th>ID</th></tr></thead><tbody>
\${Array.from({ length: rows }, (_, index) => \`<tr><td>DQ-\${index + 1}</td></tr>\`).join('')}
</tbody></table><section><h2>Tracking gaps</h2><p>0</p></section></body></html>\`

export async function serve(options = {}) {
  const rows = options.rows ?? ${rows}
  const server = createServer((request, response) => {
    if (request.url === '/api') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ schema: 'demo/v1', rows }))
      return
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(html(rows))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return { url: \`http://127.0.0.1:\${port}\`, close: () => new Promise((done) => server.close(() => done())) }
}
`
  writeFileSync(file, body, 'utf8')
  return file
}

/** Minimal demo scenario against `serve.mjs`. */
export function demoScenario(overrides = {}) {
  return {
    id: 'demo-page',
    title: '演示页面渲染',
    plugin: 'demo-plugin',
    level: 'L1',
    start: { module: 'serve.mjs', export: 'serve', options: { rows: 2 } },
    checks: [
      {
        id: 'rows',
        title: '表格渲染两行',
        expected: '表格 2 行且含 DQ-1',
        steps: [
          { goto: '/' },
          { expectText: 'DQ-1' },
          { expectCount: { selector: 'tbody tr', equals: 2 } },
          { expectNoConsoleErrors: true },
          { shot: 'page' },
        ],
      },
      {
        id: 'dom',
        title: 'DOM 快照可审阅',
        expected: '页面含 Tracking gaps',
        steps: [{ goto: '/' }, { expectText: 'Tracking gaps' }, { dom: 'page' }],
      },
    ],
    ...overrides,
  }
}

export function gitInit(root) {
  execFileSync('git', ['init', '-q'], { cwd: root })
  writeFileSync(join(root, 'README.md'), '# demo\n')
  execFileSync('git', ['add', '-A'], { cwd: root })
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'init'], { cwd: root })
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
}
