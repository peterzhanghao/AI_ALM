window.__ModuleLoader__.load({
  id: '@ai-alm/dsh-plugin-alm-core',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const card = {
      border: '1px solid var(--dsw-alias-border-l1)',
      borderRadius: '8px',
      background: 'var(--dsw-alias-bg-layer-1)',
      overflow: 'hidden',
    }
    const rowStyle = {
      display: 'flex',
      justifyContent: 'space-between',
      gap: '16px',
      padding: '10px 14px',
      fontSize: '13px',
      borderTop: '1px solid var(--dsw-alias-border-l1)',
    }

    const rows = [
      ['Host service', 'almCore'],
      ['Tools', 'alm_probe · alm_probe_consumer'],
      ['Consumer row', 'alm-core-consumer'],
      ['Verification', 'ALM-01.02'],
    ]

    function ProbePage() {
      return h(
        'div',
        { style: { padding: '24px', maxWidth: '720px', color: 'var(--dsw-alias-label-primary)' } },
        h('h2', { style: { margin: '0 0 6px', fontSize: '18px', fontWeight: 600 } }, 'ALM Probe'),
        h(
          'p',
          { style: { margin: '0 0 16px', fontSize: '13px', color: 'var(--dsw-alias-label-secondary)' } },
          'Host capability spike for the AI Native ALM MVP. Ask the agent to call alm_probe for live values.',
        ),
        h(
          'div',
          { style: card },
          rows.map(([label, value], index) =>
            h(
              'div',
              { key: label, style: index === 0 ? { ...rowStyle, borderTop: 'none' } : rowStyle },
              h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, label),
              h('span', { style: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' } }, value),
            ),
          ),
        ),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            { name: 'settings.section', id: 'alm-probe', order: 90, label: 'ALM Probe' },
            ProbePage,
          ),
        )
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: 'alm-probe' }, ProbePage),
        )
      },
    }
  },
})
