import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import * as query from './query.mjs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
const DEFAULT_ROOT = fileURLToPath(new URL('../../fixtures/order-refund', import.meta.url))

const OUTPUT = {
  schema: {
    type: 'object',
    properties: { result: { type: 'object' } },
  },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
}

function jsonSafe(value) {
  return JSON.parse(JSON.stringify(value))
}

/**
 * Requirements domain plugin: one HTTP route for the page and one Agent tool.
 * No DSH package imports (workspace-linked bundles cannot resolve them).
 */
export default class RequirementsService {
  static inject = ['tools', 'webServer']

  constructor(ctx, config) {
    this.ctx = ctx
    this.version = pkg.version
    this.root = config?.root ? resolve(config.root) : DEFAULT_ROOT

    ctx.webServer.register({
      kind: 'exact',
      path: '/api/alm/requirements',
      handler: (req, res) => this.handle(req, res),
    })

    ctx.tools.register({
      name: 'alm_requirements',
      description:
        'Return the requirements list, their acceptance coverage and tracking gaps for the ALM workspace.',
      parameters: {
        type: 'object',
        properties: { root: { type: 'string' } },
        additionalProperties: false,
      },
      output: OUTPUT,
      execute: async (args) => ({ result: jsonSafe(query.requirements(args.root ?? this.root)) }),
    })
  }

  handle(_req, res) {
    try {
      const payload = query.requirements(this.root)
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(payload))
    } catch (error) {
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: error?.message ?? String(error) }))
    }
  }
}
