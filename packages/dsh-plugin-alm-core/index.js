import { readFileSync } from 'node:fs'
import * as service from './service.mjs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

const OUTPUT = {
  schema: {
    type: 'object',
    properties: { result: { type: 'object' } },
  },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
}

function defineTool(name, description, parameters, run) {
  return { name, description, parameters, output: OUTPUT, execute: run }
}

/** Tool results must be lossless JSON; drop undefined keys from core reports. */
function jsonSafe(value) {
  return JSON.parse(JSON.stringify(value))
}

/**
 * Host-side ALM core service and read-only Agent tools.
 *
 * No imports from DSH packages: a workspace-linked bundle cannot resolve them,
 * so this uses the Cordis context APIs directly (`ctx.reflect.provide`,
 * `ctx.tools.register`). There is deliberately no approval, publish or
 * rule-editing tool here.
 */
export default class AlmCoreService {
  static inject = ['tools', 'workingDirectory']

  constructor(ctx) {
    this.ctx = ctx
    this.version = pkg.version
    ctx.reflect.provide('almCore', this)

    const rootFor = async (args, exec) => {
      if (args.root) return args.root
      if (!exec.agent) throw new Error('alm tools require an agent Session')
      return ctx.workingDirectory.ensure(exec.agent, exec.signal)
    }

    ctx.tools.register(
      defineTool(
        'alm_index',
        'Index ALM assets under the current workspace (or an explicit root) and return the normalized asset index.',
        { type: 'object', properties: { root: { type: 'string' } }, additionalProperties: false },
        async (args, exec) => ({ result: jsonSafe(service.index(await rootFor(args, exec))) }),
      ),
    )

    ctx.tools.register(
      defineTool(
        'alm_check',
        'Run the R1 deterministic gates over ALM assets and return the check report with findings.',
        {
          type: 'object',
          properties: { root: { type: 'string' }, base: { type: 'string' } },
          additionalProperties: false,
        },
        async (args, exec) => ({ result: jsonSafe(service.check(await rootFor(args, exec), { base: args.base })) }),
      ),
    )

    ctx.tools.register(
      defineTool(
        'alm_show',
        'Return one ALM asset by its stable id, including relations and source location.',
        {
          type: 'object',
          properties: { id: { type: 'string' }, root: { type: 'string' } },
          required: ['id'],
          additionalProperties: false,
        },
        async (args, exec) => ({ result: jsonSafe(service.show(await rootFor(args, exec), args.id)) }),
      ),
    )

    ctx.tools.register(
      defineTool(
        'alm_query',
        'List ALM assets filtered by type, status or owner.',
        {
          type: 'object',
          properties: {
            root: { type: 'string' },
            type: { type: 'string' },
            status: { type: 'string' },
            owner: { type: 'string' },
          },
          additionalProperties: false,
        },
        async (args, exec) =>
          ({ result: jsonSafe(service.query(await rootFor(args, exec), { type: args.type, status: args.status, owner: args.owner })) }),
      ),
    )

    ctx.tools.register(
      defineTool(
        'alm_workspace_create',
        'Open a change workspace: create a branch from a baseline and commit a change record. The worktree must be clean.',
        {
          type: 'object',
          properties: {
            baseline: { type: 'string' },
            change: { type: 'string' },
            root: { type: 'string' },
          },
          required: ['baseline', 'change'],
          additionalProperties: false,
        },
        async (args, exec) =>
          ({ result: jsonSafe(service.workspaceCreate(await rootFor(args, exec), { baseline: args.baseline, changeId: args.change })) }),
      ),
    )

    ctx.tools.register(
      defineTool(
        'alm_workspace_status',
        'Return the current branch, whether it belongs to an open change, and whether the worktree is dirty.',
        { type: 'object', properties: { root: { type: 'string' } }, additionalProperties: false },
        async (args, exec) => ({ result: jsonSafe(service.workspaceStatus(await rootFor(args, exec))) }),
      ),
    )

    ctx.tools.register(
      defineTool(
        'alm_workspace_guard',
        'Check whether paths may be written in the active change workspace. Allowed dirs: requirements, architecture, adr, tests, risks.',
        {
          type: 'object',
          properties: {
            paths: { type: 'array', items: { type: 'string' } },
            change: { type: 'string' },
            root: { type: 'string' },
          },
          required: ['paths'],
          additionalProperties: false,
        },
        async (args, exec) =>
          ({ result: jsonSafe(service.workspaceGuard(await rootFor(args, exec), { changeId: args.change, paths: args.paths })) }),
      ),
    )
  }

  index(root) {
    return service.index(root)
  }

  check(root, options) {
    return service.check(root, options)
  }

  show(root, id) {
    return service.show(root, id)
  }

  query(root, filter) {
    return service.query(root, filter)
  }
}
