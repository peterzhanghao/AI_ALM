import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { after, test } from 'node:test'
import { GiteaError, createGiteaClient, evaluateRequiredChecks } from '../src/gitea.mjs'

const TOKEN = 'secret-token-value'

/** Minimal Gitea API mock that records every request it receives. */
async function mockServer(handler) {
  const requests = []
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => {
      body += chunk
    })
    request.on('end', () => {
      const entry = { method: request.method, url: request.url, headers: request.headers, body }
      requests.push(entry)
      const result = handler(entry)
      if (result) {
        response.writeHead(result.status ?? 200, { 'content-type': 'application/json' })
        response.end(result.body === undefined ? '' : JSON.stringify(result.body))
      }
    })
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address()

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

const servers = []
after(async () => {
  for (const server of servers) await server.close()
})

async function clientFor(handler, options = {}) {
  const server = await mockServer(handler)
  servers.push(server)
  return {
    server,
    client: createGiteaClient({
      baseUrl: server.url,
      owner: 'acme',
      repo: 'app',
      token: TOKEN,
      ...options,
    }),
  }
}

test('creates a pull request with token auth and the API payload', async () => {
  const { server, client } = await clientFor((entry) => {
    assert.equal(entry.method, 'POST')
    assert.equal(entry.url, '/api/v1/repos/acme/app/pulls')
    assert.equal(entry.headers.authorization, `token ${TOKEN}`)
    return {
      status: 201,
      body: { number: 7, html_url: 'https://gitea.test/acme/app/pulls/7', state: 'open', head: { ref: 'feature/x' }, base: { ref: 'develop' } },
    }
  })

  const pull = await client.createPullRequest({ base: 'develop', head: 'feature/x', title: 'feat: x', body: 'body' })
  assert.deepEqual(pull, {
    number: 7,
    url: 'https://gitea.test/acme/app/pulls/7',
    state: 'open',
    head: 'feature/x',
    base: 'develop',
    created: true,
  })

  const posted = JSON.parse(server.requests[0].body)
  assert.deepEqual(posted, { base: 'develop', head: 'feature/x', title: 'feat: x', body: 'body' })
})

test('returns the existing pull request instead of failing on 409', async () => {
  const { server, client } = await clientFor((entry) => {
    if (entry.method === 'POST') {
      return { status: 409, body: { message: 'pull request already exists' } }
    }
    assert.equal(entry.url, '/api/v1/repos/acme/app/pulls?state=open&limit=50')
    return {
      status: 200,
      body: [
        { number: 3, html_url: 'https://gitea.test/acme/app/pulls/3', state: 'open', head: { ref: 'other' }, base: { ref: 'develop' } },
        { number: 4, html_url: 'https://gitea.test/acme/app/pulls/4', state: 'open', head: { ref: 'feature/x' }, base: { ref: 'develop' } },
      ],
    }
  })

  const pull = await client.createPullRequest({ base: 'develop', head: 'feature/x', title: 'feat: x' })
  assert.equal(pull.number, 4)
  assert.equal(pull.created, false)
  assert.equal(server.requests.filter((entry) => entry.method === 'POST').length, 1)
})

test('required checks pass only when combined and every context are success', () => {
  const combined = {
    state: 'success',
    statuses: [
      { context: 'alm-ci', status: 'success' },
      { context: 'alm-ui', status: 'success' },
    ],
  }
  assert.deepEqual(evaluateRequiredChecks(combined, ['alm-ci', 'alm-ui']), { ok: true, reasons: [] })
})

test('required checks report pending, failed and missing contexts', () => {
  const combined = {
    state: 'pending',
    statuses: [
      { context: 'alm-ci', status: 'success' },
      { context: 'alm-ui', status: 'failure' },
    ],
  }
  const result = evaluateRequiredChecks(combined, ['alm-ci', 'alm-ui', 'release'])
  assert.equal(result.ok, false)
  assert.deepEqual(result.reasons, [
    'combined state is pending',
    'check alm-ui is failure',
    'missing check release',
  ])
})

test('surfaces 401 without leaking the token', async () => {
  const { client } = await clientFor(() => ({ status: 401, body: { message: 'token is required' } }))
  await assert.rejects(
    () => client.getPullRequest(1),
    (error) => {
      assert.ok(error instanceof GiteaError)
      assert.equal(error.status, 401)
      assert.equal(error.code, 'unauthorized')
      assert.ok(!error.message.includes(TOKEN), 'error message must not contain the token')
      return true
    },
  )
})

test('surfaces 404 for a missing pull request', async () => {
  const { client } = await clientFor(() => ({ status: 404, body: { message: 'not found' } }))
  await assert.rejects(
    () => client.getPullRequest(99),
    (error) => error instanceof GiteaError && error.status === 404 && error.code === 'not_found',
  )
})

test('times out slow responses instead of hanging', async () => {
  const server = await mockServer((entry) => {
    const until = Date.now() + 200
    while (Date.now() < until) {
      // keep the response pending so the client timeout fires first
    }
    return { status: 200, body: {} }
  })
  servers.push(server)

  const client = createGiteaClient({
    baseUrl: server.url,
    owner: 'acme',
    repo: 'app',
    token: TOKEN,
    timeoutMs: 50,
  })

  await assert.rejects(
    () => client.getCombinedStatus('deadbeef'),
    (error) => error instanceof GiteaError && error.code === 'timeout',
  )
})

test('maps combined statuses and posts comments and merges', async () => {
  const { server, client } = await clientFor((entry) => {
    if (entry.url.endsWith('/status')) {
      return { status: 200, body: { state: 'success', statuses: [{ context: 'alm-ci', status: 'success' }] } }
    }
    if (entry.url.endsWith('/comments')) {
      return { status: 201, body: { id: 11, html_url: 'https://gitea.test/acme/app/issues/5#comment-11' } }
    }
    return { status: 200, body: {} }
  })

  const combined = await client.getCombinedStatus('abc123')
  assert.deepEqual(combined, { state: 'success', statuses: [{ context: 'alm-ci', status: 'success' }] })

  const comment = await client.comment(5, 'gate: pass')
  assert.deepEqual(comment, { id: 11, url: 'https://gitea.test/acme/app/issues/5#comment-11' })

  await client.mergePullRequest(5, { message: 'merge feature/x' })
  const merge = server.requests.find((entry) => entry.url.endsWith('/merge'))
  assert.equal(merge.method, 'POST')
  assert.deepEqual(JSON.parse(merge.body), { Do: 'merge', MergeMessageField: 'merge feature/x' })
})
