import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import * as query from './query.mjs'
import { renderErrorPage, renderRequirementsPage } from './render.mjs'
import { SIDEBAR_API_PATH, SIDEBAR_PATH, SIDEBAR_PORT, startSidebarServer } from './sidebar.mjs'

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
    this.sidecarOrigin = null

    // Own every registration through a Cordis effect: on reload the old routes
    // and tools are disposed, otherwise re-activation hits duplicate errors.
    const disposers = []
    ctx.effect(() => () => {
      for (const dispose of disposers.splice(0)) dispose()
    })
    const webServer = { register: (route) => disposers.push(ctx.webServer.register(route)) }
    const tools = { register: (definition) => disposers.push(ctx.tools.register(definition)) }

    this.webServer = webServer
    this.tools = tools

    // Sidecar listener on its own port: the desktop sidebar browser refuses
    // every loopback URL on the DSH host port, so the page needs another origin.
    ctx.effect(() => {
      let disposed = false
      let server
      startSidebarServer({
        port: config?.sidebarPort ?? SIDEBAR_PORT,
        handler: (req, res) => this.handleSidecar(req, res),
      })
        .then((started) => {
          if (disposed) {
            started.close()
            return
          }
          server = started
          this.sidecarOrigin = started.origin
        })
        .catch((error) => {
          console.error(`alm requirements sidebar server: ${error?.message ?? String(error)}`)
        })
      return () => {
        disposed = true
        this.sidecarOrigin = null
        server?.close()
      }
    })

    webServer.register({
      kind: 'exact',
      path: '/api/alm/requirements',
      handler: (req, res) => this.handle(req, res),
    })

    // Standalone read-only page: the GUI origin itself needs the dsh web token,
    // so expose an HTML view that can be opened directly from a browser.
    webServer.register({
      kind: 'exact',
      path: '/alm/requirements',
      handler: (req, res) => this.handlePage(req, res),
    })

    tools.register({
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

  handlePage(_req, res) {
    try {
      const payload = query.requirements(this.root)
      const sidebarUrl = this.sidecarOrigin ? `${this.sidecarOrigin}${SIDEBAR_PATH}` : undefined
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      res.end(renderRequirementsPage(payload, { sidebarUrl }))
    } catch (error) {
      res.writeHead(500, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      res.end(renderErrorPage(error?.message ?? String(error), 500))
    }
  }

  handleSidecar(req, res) {
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
    if (path === SIDEBAR_PATH) {
      this.handlePage(req, res)
      return
    }
    if (path === SIDEBAR_API_PATH) {
      this.handle(req, res)
      return
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('not found')
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
