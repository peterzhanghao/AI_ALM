/**
 * Serve the plugin pages from the current source for local verification.
 *
 * The same render functions and payload builders the DSH host uses are mounted
 * on a plain HTTP server, so a browser check does not depend on restarting the
 * host or on its token-protected GUI root.
 */
import { createServer } from 'node:http'
import { requirements } from '../../packages/dsh-plugin-requirements/query.mjs'
import { renderRequirementsPage, sidebarBrowserUrl } from '../../packages/dsh-plugin-requirements/render.mjs'
import { architecture } from '../../packages/dsh-plugin-architecture/query.mjs'
import { renderArchitecturePage } from '../../packages/dsh-plugin-architecture/render.mjs'

/**
 * @param {{ root: string }} options
 * @returns {Promise<{ url: string, close(): Promise<void>, pages: { requirements: object, architecture: object } }>}
 */
export async function servePages({ root }) {
  const pages = {
    requirements: requirements(root),
    architecture: architecture(root),
  }

  const routes = {
    '/alm/requirements': (request) => [
      'text/html; charset=utf-8',
      renderRequirementsPage(pages.requirements, {
        sidebarUrl: sidebarBrowserUrl(request.headers.host, '/alm/requirements'),
      }),
    ],
    '/alm/architecture': (request) => [
      'text/html; charset=utf-8',
      renderArchitecturePage(pages.architecture, {
        sidebarUrl: sidebarBrowserUrl(request.headers.host, '/alm/architecture'),
      }),
    ],
    '/api/alm/requirements': () => ['application/json; charset=utf-8', JSON.stringify(pages.requirements, null, 2)],
    '/api/alm/architecture': () => ['application/json; charset=utf-8', JSON.stringify(pages.architecture, null, 2)],
    '/favicon.ico': () => ['image/x-icon', ''],
  }

  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname
    const route = routes[path]
    if (!route) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('not found')
      return
    }
    const [contentType, body] = route(request)
    response.writeHead(200, { 'content-type': contentType })
    response.end(body)
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })

  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0

  return {
    url: `http://127.0.0.1:${port}`,
    pages,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}
