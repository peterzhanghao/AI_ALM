export const name = 'alm-core-consumer'
export const inject = ['tools', 'almCore']

/**
 * Separate plugin row that consumes `almCore`. If the Service injection fails,
 * this row stays inactive and `alm_probe_consumer` never appears.
 */
export function apply(ctx) {
  ctx.tools.register({
    name: 'alm_probe_consumer',
    description:
      'Call the almCore Host service through a second plugin row to verify plugin-to-plugin Service dependency.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          via: { type: 'string', description: 'Consumer plugin name.' },
          service: { type: 'string', description: 'Service name it called.' },
          calls: { type: 'integer', description: 'Service call count after this call.' },
          plugin: { type: 'string', description: 'Provider plugin version.' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    execute: async () => {
      const result = ctx.almCore.probe()
      return { via: name, service: result.service, calls: result.calls, plugin: result.plugin }
    },
  })
}
