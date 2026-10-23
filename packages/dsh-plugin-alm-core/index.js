import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

/**
 * Host-side ALM core service. ALM-01.02 spike: proves a plugin can expose a
 * Service and a tool, and that another plugin row can depend on that Service.
 *
 * No imports from DSH packages: a workspace-linked bundle cannot resolve them,
 * so this uses the Cordis context APIs directly (the same call `Service` makes).
 */
export default class AlmCoreService {
  static inject = ['tools']

  constructor(ctx) {
    this.ctx = ctx
    this.startedAt = new Date().toISOString()
    this.version = pkg.version
    this.calls = 0

    ctx.reflect.provide('almCore', this)

    const service = this
    ctx.tools.register({
      name: 'alm_probe',
      description:
        'Return live ALM Host probe data: plugin version, Node/Electron version, service start time and call count. Used to verify DSH plugin capability for ALM-01.02.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            plugin: { type: 'string', description: 'Plugin package version.' },
            service: { type: 'string', description: 'Exposed Host service name.' },
            node: { type: 'string', description: 'Host Node.js version.' },
            electron: { type: 'string', description: 'Electron version when running in Desktop.' },
            startedAt: { type: 'string', description: 'Service construction time.' },
            calls: { type: 'integer', description: 'Service probe call count.' },
          },
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      execute: async () => service.probe(),
    })
  }

  probe() {
    this.calls += 1
    return {
      plugin: this.version,
      service: 'almCore',
      node: process.versions.node,
      electron: process.versions.electron,
      startedAt: this.startedAt,
      calls: this.calls,
    }
  }
}
