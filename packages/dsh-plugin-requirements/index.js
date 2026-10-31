import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import * as query from './query.mjs'
import { resolveRequirementsRoot } from './query.mjs'
import { associateProject } from '../alm-core/src/project/project.mjs'
import { listWorkspaces } from './workspaces.mjs'
import { openChange } from '../alm-core/src/changes/open.mjs'
import { createRequirement } from '../alm-core/src/requirements/create.mjs'
import { runCi } from '../alm-core/src/ci/ci.mjs'
import { runAcceptance } from '../alm-core/src/acceptance/acceptance.mjs'
import { applyGithub, previewGithub } from './github-sync.mjs'
import { diffRequirementVersions } from './version-diff.mjs'
import { checkReport, indexReport } from '../alm-core/src/commands.mjs'
import { runReview, signReview } from '../alm-core/src/review/executor.mjs'
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

/** Bounded JSON body reader for the local write endpoints. */
function readJsonBody(req, limit = 64 * 1024) {
  return new Promise((resolveBody, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(Object.assign(new Error('request body is too large'), { status: 413, code: 'body-too-large' }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolveBody(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {})
      } catch (error) {
        reject(Object.assign(new Error(`invalid JSON: ${error.message}`), { status: 400, code: 'invalid-json' }))
      }
    })
    req.on('error', reject)
  })
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

    webServer.register({
      kind: 'exact',
      path: '/api/alm/projects',
      handler: (req, res) => this.handleProjects(req, res),
    })

    webServer.register({
      kind: 'exact',
      path: '/api/alm/projects/associate',
      handler: (req, res) => this.handleAssociate(req, res),
    })

    webServer.register({
      kind: 'exact',
      path: '/api/alm/requirements/version',
      handler: (req, res) => this.handleVersion(req, res),
    })

    webServer.register({
      kind: 'exact',
      path: '/api/alm/requirements/diff',
      handler: (req, res) => this.handleDiff(req, res),
    })

    for (const [path, action] of [
      ['/api/alm/requirements/start', 'start'],
      ['/api/alm/requirements/accept', 'accept'],
      ['/api/alm/requirements/create', 'create'],
      ['/api/alm/requirements/github', 'github'],
      ['/api/alm/requirements/acceptance', 'acceptance'],
      ['/api/alm/requirements/review', 'review'],
      ['/api/alm/requirements/signoff', 'signoff'],
    ]) {
      webServer.register({
        kind: 'exact',
        path,
        handler: (req, res) => this.handleWrite(req, res, action),
      })
    }

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

  projectsPayload() {
    const listed = listWorkspaces()
    const projects = listed.workspaces.map((workspace) => ({
      id: workspace.id,
      projectId: workspace.projectId,
      workspaceId: workspace.workspaceId,
      name: workspace.name,
      title: workspace.title,
      root: workspace.root,
      linked: workspace.linked,
      exists: workspace.exists,
      github: workspace.github,
      teams: workspace.teams,
      current: resolve(workspace.root) === resolve(this.root),
    }))
    return { schema: 'alm.projects/v1', source: listed.source, defaultRoot: this.root, projects, errors: listed.errors }
  }

  rootFor(req) {
    const url = new URL(req?.url ?? '/', 'http://127.0.0.1')
    const projectId = url.searchParams.get('project')
    if (projectId) {
      const project = this.projectsPayload().projects.find((entry) => entry.id === projectId || entry.workspaceId === projectId)
      if (!project) {
        const error = new Error(`project not found: ${projectId}`)
        error.status = 404
        error.code = 'project-not-found'
        throw error
      }
      if (!project.exists) {
        const error = new Error(`workspace path is missing: ${project.root}`)
        error.status = 404
        error.code = 'project-workspace-missing'
        throw error
      }
      return project.root
    }
    const requested = url.searchParams.get('root') ?? undefined
    return resolveRequirementsRoot(requested, this.root)
  }

  handlePage(req, res) {
    try {
      const payload = query.requirements(this.rootFor(req))
      const sidebarUrl = this.sidecarOrigin ? `${this.sidecarOrigin}${SIDEBAR_PATH}` : undefined
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      res.end(renderRequirementsPage(payload, { sidebarUrl }))
    } catch (error) {
      const status = error?.status ?? 500
      res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      res.end(renderErrorPage(error?.message ?? String(error), status))
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
    if (path === '/api/alm/projects') {
      this.handleProjects(req, res)
      return
    }
    if (path === '/api/alm/requirements/version') {
      this.handleVersion(req, res)
      return
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('not found')
  }

  handleProjects(req, res) {
    try {
      const payload = this.projectsPayload()
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(payload))
    } catch (error) {
      const status = error?.status ?? 500
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify({ ok: false, error: { code: error?.code ?? 'internal-error', message: error?.message ?? String(error) } }))
    }
  }

  async handleAssociate(req, res) {
    const respond = (status, payload) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(payload))
    }
    try {
      if (req.method !== 'POST') {
        respond(405, { ok: false, error: { code: 'method-not-allowed', message: 'POST required' } })
        return
      }
      const body = await readJsonBody(req)
      const root = this.rootFor(req)
      const result = associateProject({
        root,
        id: body.id,
        name: body.name,
        owner: body.owner,
        repo: body.repo,
        projectNumber: body.projectNumber,
        requirementRoot: body.requirementRoot,
        defaultBranch: body.defaultBranch,
        teams: Array.isArray(body.teams) ? body.teams : [],
      })
      respond(200, { ...result, schema: 'alm.project.associate/v1' })
    } catch (error) {
      respond(error?.status ?? 400, {
        ok: false,
        error: { code: error?.code ?? 'associate-failed', message: error?.message ?? String(error) },
      })
    }
  }

  reviewContext(root, requirementId) {
    if (!requirementId) throw Object.assign(new Error('requirementId is required'), { status: 400, code: 'requirement-required' })
    const index = indexReport(root)
    if (index.ok === false) throw Object.assign(new Error(index.error ?? 'index failed'), { status: 400, code: 'index-failed' })
    const asset = index.assets.find((entry) => entry.id === requirementId && entry.type === 'requirement')
    if (!asset) throw Object.assign(new Error(`requirement not found: ${requirementId}`), { status: 404, code: 'requirement-not-found' })
    const check = checkReport(root)
    if (check.ok === false) throw Object.assign(new Error(check.error ?? 'check failed'), { status: 400, code: 'check-failed' })
    return { asset, item: { id: asset.id, file: asset.source.path }, check }
  }

  async handleWrite(req, res, action) {
    const respond = (status, payload) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(payload))
    }
    try {
      if (req.method !== 'POST') {
        respond(405, { ok: false, error: { code: 'method-not-allowed', message: 'POST required' } })
        return
      }
      const body = await readJsonBody(req)
      const root = this.rootFor(req)
      let payload
      if (action === 'start') {
        payload = openChange({
          root,
          requirementIds: [body.requirementId],
          changeId: body.changeId,
          apply: body.apply === true,
        })
      } else if (action === 'accept') {
        payload = runCi({ root, base: body.base })
      } else if (action === 'create') {
        payload = createRequirement({
          root,
          title: body.title,
          brief: body.brief,
          goal: body.goal,
          priority: body.priority,
          owner: body.owner,
          id: body.id,
          apply: body.apply === true,
        })
      } else if (action === 'github') {
        payload =
          body.apply === true
            ? await applyGithub({ root, changeId: body.changeId })
            : await previewGithub({ root, changeId: body.changeId })
      } else if (action === 'acceptance') {
        payload = runAcceptance({ root, requirementId: body.requirementId, apply: body.apply === true })
      } else if (action === 'review') {
        const context = this.reviewContext(root, body.requirementId)
        payload = runReview({
          root,
          asset: context.asset,
          item: context.item,
          check: context.check,
          apply: body.apply === true,
        })
      } else if (action === 'signoff') {
        const context = this.reviewContext(root, body.requirementId)
        payload = signReview({ root, asset: context.asset, actor: body.actor, apply: body.apply === true })
      } else {
        respond(404, { ok: false, error: { code: 'unknown-action', message: String(action) } })
        return
      }
      respond(200, payload)
    } catch (error) {
      const status = error?.status ?? (error?.code === 'already-exists' ? 409 : 400)
      respond(status, {
        ok: false,
        error: { code: error?.code ?? 'write-failed', message: error?.message ?? String(error) },
      })
    }
  }

  handleDiff(req, res) {
    try {
      const url = new URL(req?.url ?? '/', 'http://127.0.0.1')
      const root = this.rootFor(req)
      const assetId = url.searchParams.get('asset')
      const index = indexReport(root)
      if (index.ok === false) throw Object.assign(new Error(index.error ?? 'index failed'), { status: 400, code: 'index-failed' })
      const asset = index.assets.find((entry) => entry.id === assetId)
      if (!asset) throw Object.assign(new Error(`asset not found: ${assetId}`), { status: 404, code: 'asset-not-found' })
      const payload = diffRequirementVersions({
        root,
        file: asset.source.path,
        assetId,
        from: url.searchParams.get('from'),
        to: url.searchParams.get('to') ?? 'worktree',
      })
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(payload))
    } catch (error) {
      const status = error?.status ?? 400
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify({ ok: false, error: { code: error?.code ?? 'diff-failed', message: error?.message ?? String(error) } }))
    }
  }

  handleVersion(req, res) {
    try {
      const url = new URL(req?.url ?? '/', 'http://127.0.0.1')
      const payload = query.versionSnapshot({
        root: this.rootFor(req),
        assetId: url.searchParams.get('asset'),
        sha: url.searchParams.get('sha'),
      })
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(payload))
    } catch (error) {
      const status = error?.status ?? 500
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify({ ok: false, error: { code: error?.code ?? 'internal-error', message: error?.message ?? String(error) } }))
    }
  }

  handle(req, res) {
    try {
      const url = new URL(req?.url ?? '/', 'http://127.0.0.1')
      const payload =
        url.searchParams.get('project') === 'ALL'
          ? query.requirementsAll(this.projectsPayload().projects.filter((project) => project.exists))
          : query.requirements(this.rootFor(req))
      if (payload && payload.ok === false) {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify({ ok: false, error: { code: 'index-failed', message: payload.error } }))
        return
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(payload))
    } catch (error) {
      const status = error?.status ?? 500
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(
        JSON.stringify({
          ok: false,
          error: { code: error?.code ?? 'internal-error', message: error?.message ?? String(error) },
        }),
      )
    }
  }
}
