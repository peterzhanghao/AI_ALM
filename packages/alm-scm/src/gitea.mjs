/**
 * Gitea SCM adapter: pull requests, commit statuses and comments over the
 * Gitea REST API. Only `fetch` and `node:*` are used, so `alm-core` keeps its
 * single runtime dependency (`yaml`).
 *
 * The adapter is deliberately thin: domain decisions (approval, required checks,
 * merge policy) stay in `alm-core`; this module only talks HTTP and maps errors.
 */

export class GiteaError extends Error {
  /**
   * @param {string} message
   * @param {{ status?: number, code?: string, body?: unknown }} [details]
   */
  constructor(message, { status = 0, code = 'gitea_error', body } = {}) {
    super(message)
    this.name = 'GiteaError'
    this.status = status
    this.code = code
    this.body = body
  }
}

function codeForStatus(status) {
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not_found'
  if (status === 409) return 'conflict'
  if (status === 422) return 'validation'
  return `http_${status}`
}

function trimBase(baseUrl) {
  return String(baseUrl).replace(/\/+$/, '')
}

function parseJson(text) {
  try {
    return text ? JSON.parse(text) : null
  } catch {
    return null
  }
}

function toPullRequest(payload, created) {
  return {
    number: payload.number,
    url: payload.html_url ?? payload.url ?? null,
    state: payload.state ?? 'open',
    head: payload.head?.ref ?? null,
    base: payload.base?.ref ?? null,
    created,
  }
}

/**
 * @param {{
 *   baseUrl: string,
 *   owner: string,
 *   repo: string,
 *   token: string,
 *   fetchImpl?: typeof fetch,
 *   timeoutMs?: number,
 * }} options
 */
export function createGiteaClient({
  baseUrl,
  owner,
  repo,
  token,
  fetchImpl = fetch,
  timeoutMs = 10_000,
}) {
  if (!baseUrl) throw new GiteaError('gitea: baseUrl is required', { code: 'config' })
  if (!owner || !repo) throw new GiteaError('gitea: owner and repo are required', { code: 'config' })
  if (!token) throw new GiteaError('gitea: token is required', { code: 'config' })

  const apiRoot = `${trimBase(baseUrl)}/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`

  async function request(method, path, body) {
    const url = `${apiRoot}${path}`
    let response
    try {
      response = await fetchImpl(url, {
        method,
        headers: {
          accept: 'application/json',
          authorization: `token ${token}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        throw new GiteaError(`gitea: ${method} ${path} timed out after ${timeoutMs}ms`, { code: 'timeout' })
      }
      throw new GiteaError(`gitea: ${method} ${path} failed: ${error?.message ?? String(error)}`, { code: 'network' })
    }

    const text = await response.text()
    const payload = parseJson(text)

    if (!response.ok) {
      const detail = payload?.message ?? text.slice(0, 200)
      throw new GiteaError(`gitea: ${method} ${path} -> HTTP ${response.status}${detail ? `: ${detail}` : ''}`, {
        status: response.status,
        code: codeForStatus(response.status),
        body: payload,
      })
    }

    return payload
  }

  async function findByHead(head) {
    const pulls = await request('GET', '/pulls?state=open&limit=50')
    if (!Array.isArray(pulls)) return null
    const existing = pulls.find((pull) => pull?.head?.ref === head)
    return existing ? toPullRequest(existing, false) : null
  }

  return {
    /**
     * Create a PR, or return the open PR that already has this head branch.
     * Gitea answers 409 for duplicates; that path is not an error here.
     */
    async createPullRequest({ base, head, title, body }) {
      if (!base || !head || !title) {
        throw new GiteaError('gitea: createPullRequest requires base, head and title', { code: 'config' })
      }
      try {
        const payload = await request('POST', '/pulls', { base, head, title, body })
        return toPullRequest(payload, true)
      } catch (error) {
        if (error instanceof GiteaError && error.status === 409 && /already exists/i.test(error.message)) {
          const existing = await findByHead(head)
          if (existing) return existing
        }
        throw error
      }
    },

    async getPullRequest(number) {
      const payload = await request('GET', `/pulls/${number}`)
      return toPullRequest(payload, false)
    },

    /** Combined commit status plus the individual contexts required checks use. */
    async getCombinedStatus(sha) {
      const payload = await request('GET', `/commits/${encodeURIComponent(sha)}/status`)
      const statuses = (payload?.statuses ?? []).map((entry) => ({
        context: entry.context ?? entry.name ?? 'unknown',
        status: entry.status ?? 'unknown',
      }))
      return { state: payload?.state ?? 'unknown', statuses }
    },

    /** Create an issue; labels are names Gitea resolves for the repository. */
    async createIssue({ title, body, labels = [] }) {
      const payload = await request('POST', '/issues', { title, body, labels })
      return { number: payload?.number ?? null, url: payload?.html_url ?? null, title: payload?.title ?? title }
    },

    /** Find one issue by exact title across open and closed issues. */
    async findIssue(title) {
      const issues = await request('GET', `/issues?state=all&q=${encodeURIComponent(title)}&limit=50`)
      if (!Array.isArray(issues)) return null
      const match = issues.find((issue) => issue?.title === title)
      return match ? { number: match.number, url: match.html_url ?? null, title: match.title } : null
    },

    async comment(number, body) {
      const payload = await request('POST', `/issues/${number}/comments`, { body })
      return { id: payload?.id ?? null, url: payload?.html_url ?? null }
    },

    async mergePullRequest(number, { message, method = 'merge' } = {}) {
      await request('POST', `/pulls/${number}/merge`, {
        Do: method,
        MergeMessageField: message ?? '',
      })
      return { number, method }
    },
  }
}

/**
 * Required checks must all be `success` and the combined state must be
 * `success`; anything else is reported with the offending context.
 *
 * @param {{ state: string, statuses: Array<{ context: string, status: string }> }} combined
 * @param {string[]} required
 * @returns {{ ok: boolean, reasons: string[] }}
 */
export function evaluateRequiredChecks(combined, required = []) {
  const reasons = []
  const statuses = combined?.statuses ?? []

  if (combined?.state !== 'success') {
    reasons.push(`combined state is ${combined?.state ?? 'unknown'}`)
  }

  for (const context of required) {
    const entry = statuses.find((status) => status.context === context)
    if (!entry) {
      reasons.push(`missing check ${context}`)
      continue
    }
    if (entry.status !== 'success') {
      reasons.push(`check ${context} is ${entry.status}`)
    }
  }

  return { ok: reasons.length === 0, reasons }
}
