import { createServer } from 'node:http'

/**
 * Dedicated read-only origin for the requirements page.
 *
 * DSH's sidebar browser blocks every loopback URL on the DSH host port
 * (`isApplicationHost` in the desktop guest manager), so the page must be
 * served from a different port to be reachable from that panel.
 */
export const SIDEBAR_PORT = 60870
export const SIDEBAR_PATH = '/alm/requirements'
export const SIDEBAR_API_PATH = '/api/alm/requirements'

/**
 * Start the sidecar listener on `port`, falling back to an ephemeral port when
 * the preferred one is taken.
 *
 * @param {{ port?: number, handler: import('node:http').RequestListener }} options
 * @returns {Promise<{ origin: string, port: number, close(): Promise<void> }>}
 */
export function startSidebarServer({ port = SIDEBAR_PORT, handler }) {
  const listen = (candidate) =>
    new Promise((resolve, reject) => {
      const server = createServer(handler)
      server.once('error', reject)
      server.listen(candidate, '127.0.0.1', () => {
        server.removeListener('error', reject)
        server.unref()
        const address = server.address()
        resolve({
          origin: `http://127.0.0.1:${address.port}`,
          port: address.port,
          close: () => new Promise((done) => server.close(() => done())),
        })
      })
    })

  return listen(port).catch((error) => {
    if (error?.code === 'EADDRINUSE' && port !== 0) return listen(0)
    throw error
  })
}
