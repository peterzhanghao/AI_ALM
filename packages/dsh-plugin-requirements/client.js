window.__ModuleLoader__.load({
  id: '@ai-alm/dsh-plugin-requirements',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback } = React

    const panel = { padding: '24px', maxWidth: '900px', color: 'var(--dsw-alias-label-primary)' }
    const table = { width: '100%', borderCollapse: 'collapse', fontSize: '13px' }
    const th = {
      textAlign: 'left',
      padding: '8px 10px',
      color: 'var(--dsw-alias-label-secondary)',
      borderBottom: '1px solid var(--dsw-alias-border-l1)',
      fontWeight: 500,
    }
    const td = { padding: '8px 10px', borderBottom: '1px solid var(--dsw-alias-border-l1)' }
    const button = {
      border: '1px solid var(--dsw-alias-border-l1)',
      background: 'var(--dsw-alias-bg-layer-1)',
      color: 'var(--dsw-alias-label-primary)',
      borderRadius: '6px',
      padding: '4px 10px',
      fontSize: '12px',
      cursor: 'pointer',
    }

    function useRequirements() {
      const [state, setState] = useState({ loading: true, error: null, data: null })
      const load = useCallback(() => {
        setState({ loading: true, error: null, data: null })
        fetch('/api/alm/requirements', { headers: { accept: 'application/json' } })
          .then(async (response) => {
            const body = await response.json()
            if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`)
            setState({ loading: false, error: null, data: body })
          })
          .catch((error) => setState({ loading: false, error: error.message, data: null }))
      }, [])
      useEffect(() => {
        load()
      }, [load])
      return { ...state, reload: load }
    }

    function RequirementsView({ openPanel }) {
      const { loading, error, data, reload } = useRequirements()

      if (loading) return h('div', { style: panel }, 'Loading requirements…')
      if (error) return h('div', { style: panel }, h('p', { style: { color: 'var(--dsw-alias-state-error-primary)' } }, error), h('button', { style: button, onClick: reload }, 'Retry'))

      const rows = data.requirements.map((item) =>
        h(
          'tr',
          { key: item.id },
          h('td', { style: td }, item.id),
          h('td', { style: td }, item.title),
          h('td', { style: td }, item.status),
          h('td', { style: td }, item.owner),
          h(
            'td',
            { style: { ...td, color: item.verifiedBy.length > 0 ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-warn-primary)' } },
            item.verifiedBy.length > 0 ? item.verifiedBy.join(', ') : '未覆盖',
          ),
        ),
      )

      return h(
        'div',
        { style: panel },
        h('h2', { style: { margin: '0 0 4px', fontSize: '18px', fontWeight: 600 } }, 'Requirements'),
        h(
          'p',
          { style: { margin: '0 0 12px', fontSize: '13px', color: 'var(--dsw-alias-label-secondary)' } },
          `${data.summary.requirements} requirements · ${data.summary.gaps} gaps · check ${data.result}`,
        ),
        h(
          'div',
          { style: { display: 'flex', gap: '8px', marginBottom: '12px' } },
          h('button', { style: button, onClick: reload }, 'Refresh'),
          openPanel ? h('button', { style: button, onClick: openPanel }, 'Open as main panel') : null,
        ),
        h(
          'table',
          { style: table },
          h('thead', null, h('tr', null, ['ID', 'Title', 'Status', 'Owner', 'Coverage'].map((label) => h('th', { key: label, style: th }, label)))),
          h('tbody', null, rows),
        ),
        h('h3', { style: { margin: '18px 0 6px', fontSize: '14px' } }, 'Tracking gaps'),
        data.gaps.length === 0
          ? h('p', { style: { fontSize: '13px', color: 'var(--dsw-alias-label-secondary)' } }, 'None.')
          : h(
              'ul',
              { style: { margin: 0, paddingLeft: '18px', fontSize: '13px' } },
              data.gaps.map((gap, index) =>
                h(
                  'li',
                  { key: `${gap.rule}-${index}` },
                  `${gap.rule}  ${gap.file}${gap.line ? `:${gap.line}` : ''}  ${gap.message}`,
                ),
              ),
            ),
      )
    }

    return {
      inject: ['slots', 'layout'],
      apply(ctx) {
        function SettingsPage() {
          return h(RequirementsView, { openPanel: () => ctx.layout.selectPanel('requirements') })
        }
        function MainPage() {
          return h(RequirementsView, {})
        }
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register({ name: 'settings.section', id: 'requirements', order: 91, label: 'Requirements' }, SettingsPage),
        )
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'requirements' }, MainPage))
      },
    }
  },
})
