#!/usr/bin/env node
/**
 * Standalone read-only page server for the DSH sidebar browser.
 *
 * DSH's desktop sidebar browser refuses every loopback URL on the DSH host
 * port, so this serves the same pages on a different port. Use it when the
 * host plugins have not been reloaded yet, or to preview pages without DSH:
 *
 *   node scripts/serve-alm-pages.mjs [--port 60872] [--root fixtures/order-refund]
 */
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { servePages } from './lib/plugin-pages.mjs'

const repoRoot = fileURLToPath(new URL('../', import.meta.url))
const argv = process.argv.slice(2)
const valueOf = (flag, fallback) => {
  const index = argv.indexOf(flag)
  return index === -1 ? fallback : argv[index + 1]
}

const port = Number(valueOf('--port', '60872'))
const root = resolve(repoRoot, valueOf('--root', 'fixtures/order-refund'))

const server = await servePages({ root, port })
console.log(`ALM pages:        ${server.url}`)
console.log(`  requirements:   ${server.url}/alm/requirements`)
console.log(`  architecture:   ${server.url}/alm/architecture`)
console.log(`  JSON:           ${server.url}/api/alm/requirements , ${server.url}/api/alm/architecture`)
console.log('Paste either HTML URL into the DSH sidebar browser. Ctrl+C to stop.')

const shutdown = async () => {
  await server.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
