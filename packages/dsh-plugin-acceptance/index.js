import { readFileSync } from 'node:fs'
import * as engine from './engine/index.mjs'

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

/** Tool results must be lossless JSON; drop undefined keys. */
function jsonSafe(value) {
  return JSON.parse(JSON.stringify(value))
}

const ROOT_PROPERTY = { type: 'string', description: 'Workspace root; defaults to the Session working directory.' }

/**
 * Plugin acceptance bench (Host side).
 *
 * `acceptance_run` is the only tool that drives a browser; it executes the
 * workspace's own scenario modules under `acceptance/plugins/*​/scenarios`, so the
 * plugin under test is whatever the workspace currently builds. Evidence and
 * the report stay on disk under `.alm/acceptance2/` — deliberately not in git.
 *
 * No imports from DSH packages: a workspace-linked bundle cannot resolve them,
 * so this uses the Cordis context APIs directly.
 */
export default class AcceptanceBench {
  static inject = ['tools', 'workingDirectory']

  constructor(ctx) {
    this.ctx = ctx
    this.version = pkg.version
    ctx.reflect.provide('acceptanceBench', this)

    // Cordis effects own every registration so a reload cannot leave a stale
    // tool behind (duplicate-name errors on re-activation).
    const disposers = []
    ctx.effect(() => () => {
      for (const dispose of disposers.splice(0)) dispose()
    })
    const tools = { register: (definition) => disposers.push(ctx.tools.register(definition)) }

    const rootFor = async (args, exec) => {
      if (args.root) return args.root
      if (!exec.agent) throw new Error('acceptance tools require an agent Session')
      return ctx.workingDirectory.ensure(exec.agent, exec.signal)
    }

    tools.register(
      defineTool(
        'acceptance_run',
        'Run one UI acceptance round for a DSH plugin: execute the workspace scenario modules for that plugin, capture screenshots/DOM as evidence, derive pass/fail/blocked and write a self-contained report.html under .alm/acceptance2. Returns only a structured summary — open the report for the pixels.',
        {
          type: 'object',
          properties: {
            plugin: { type: 'string', description: 'Package name under test, e.g. @ai-alm/dsh-plugin-requirements.' },
            requirement: { type: 'string', description: 'Optional requirement id this round is evidence for.' },
            level: { type: 'string', enum: ['L1', 'L2'], description: 'L1 = isolated render (default). L2 requires a running host and is not implemented yet.' },
            scenarios: {
              type: 'array',
              items: { type: 'string' },
              description: 'Scenario files or directories; defaults to every scenario declaring this plugin.',
            },
            ids: { type: 'array', items: { type: 'string' }, description: 'Only run these scenario ids.' },
            expectHead: { type: 'string', description: 'Refuse to claim a pass unless HEAD is this commit.' },
            root: ROOT_PROPERTY,
          },
          required: ['plugin'],
          additionalProperties: false,
        },
        async (args, exec) => ({
          result: jsonSafe(
            await engine.runAcceptance({
              root: await rootFor(args, exec),
              plugin: args.plugin,
              requirement: args.requirement ?? null,
              level: args.level ?? 'L1',
              scenarios: args.scenarios ?? [],
              ids: args.ids ?? [],
              expectHead: args.expectHead ?? null,
            }),
          ),
        }),
      ),
    )

    tools.register(
      defineTool(
        'acceptance_review',
        'Record human review decisions (accept/reject per check) for an acceptance round. Accepts a decisions array or the acceptance-reviews-*.json exported from report.html; the round evidence is never modified.',
        {
          type: 'object',
          properties: {
            roundId: { type: 'string', description: 'Round id such as "001".' },
            plugin: { type: 'string', description: 'Plugin package name the round belongs to.' },
            decisions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  check: { type: 'string', description: 'Check id; omit to decide the round as a whole.' },
                  action: { type: 'string', enum: ['accept', 'reject'] },
                  comment: { type: 'string', description: 'Required when rejecting.' },
                },
                required: ['action'],
                additionalProperties: false,
              },
            },
            reviewsFile: { type: 'string', description: 'Path to acceptance-reviews-<id>.json exported from the report.' },
            root: ROOT_PROPERTY,
          },
          required: ['roundId', 'plugin'],
          additionalProperties: false,
        },
        async (args, exec) => ({
          result: jsonSafe(
            engine.reviewAcceptance({
              root: await rootFor(args, exec),
              plugin: args.plugin,
              roundId: args.roundId,
              decisions: args.decisions ?? [],
              reviewsFile: args.reviewsFile ?? null,
            }),
          ),
        }),
      ),
    )

    tools.register(
      defineTool(
        'acceptance_show',
        'Return one acceptance round with its review decisions, remaining unreviewed checks and any drift against the current workspace.',
        {
          type: 'object',
          properties: {
            roundId: { type: 'string' },
            plugin: { type: 'string' },
            root: ROOT_PROPERTY,
          },
          required: ['roundId', 'plugin'],
          additionalProperties: false,
        },
        async (args, exec) =>
          ({ result: jsonSafe(engine.showRound({ root: await rootFor(args, exec), plugin: args.plugin, roundId: args.roundId })) }),
      ),
    )

    tools.register(
      defineTool(
        'acceptance_rounds',
        'List acceptance rounds for a plugin, newest first.',
        {
          type: 'object',
          properties: {
            plugin: { type: 'string' },
            requirement: { type: 'string' },
            root: ROOT_PROPERTY,
          },
          required: ['plugin'],
          additionalProperties: false,
        },
        async (args, exec) => ({
          result: jsonSafe({
            rounds: engine.listAcceptanceRounds({
              root: await rootFor(args, exec),
              plugin: args.plugin,
              requirement: args.requirement ?? null,
            }),
          }),
        }),
      ),
    )
  }
}
