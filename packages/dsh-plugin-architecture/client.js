window.__ModuleLoader__.load({
  id: '@ai-alm/dsh-plugin-architecture',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback } = React

    const panel = { padding: '24px', maxWidth: '960px', color: 'var(--dsw-alias-label-primary)' }
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
    const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '12px' }

    function reverseImpact(edges, id) {
      const reverse = new Map()
      for (const edge of edges) {
        if (!reverse.has(edge.to)) reverse.set(edge.to, [])
        reverse.get(edge.to).push(edge)
      }
      const seen = new Set([id])
      const order = []
      const queue = [{ id, depth: 0 }]
      while (queue.length > 0) {
        const current = queue.shift()
        for (const edge of reverse.get(current.id) ?? []) {
          if (seen.has(edge.from)) continue
          seen.add(edge.from)
          order.push({ id: edge.from, via: edge.type, depth: current.depth + 1 })
          queue.push({ id: edge.from, depth: current.depth + 1 })
        }
      }
      return order
    }

    function useArchitecture() {
      const [state, setState] = useState({ loading: true, error: null, data: null })
      const load = useCallback(() => {
        setState({ loading: true, error: null, data: null })
        fetch('/api/alm/architecture', { headers: { accept: 'application/json' } })
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

    function ArchitectureView({ openPanel }) {
      const { loading, error, data, reload } = useArchitecture()
      const [selected, setSelected] = useState('')

      if (loading) return h('div', { style: panel }, 'Loading architecture…')
      if (error) {
        return h(
          'div',
          { style: panel },
          h('p', { style: { color: 'var(--dsw-alias-state-error-primary)' } }, error),
          h('button', { style: button, onClick: reload }, 'Retry'),
        )
      }

      const nodes = [...data.modules, ...data.decisions, ...data.interfaces, ...data.dataModels]
      const current = selected || nodes[0]?.id || ''
      const affected = current ? reverseImpact(data.edges, current) : []

      return h(
        'div',
        { style: panel },
        h('h2', { style: { margin: '0 0 4px', fontSize: '18px', fontWeight: 600 } }, 'Architecture'),
        h(
          'p',
          { style: { margin: '0 0 12px', fontSize: '13px', color: 'var(--dsw-alias-label-secondary)' } },
          `${data.summary.nodes} nodes · ${data.summary.edges} edges · ${data.summary.gaps} gaps · check ${data.result}`,
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
          h('thead', null, h('tr', null, ['ID', 'Type', 'Title', 'Status', 'Impact'].map((label) => h('th', { key: label, style: th }, label)))),
          h(
            'tbody',
            null,
            nodes.map((node) =>
              h(
                'tr',
                { key: node.id },
                h('td', { style: td }, node.id),
                h('td', { style: td }, node.type ?? ''),
                h('td', { style: td }, node.title),
                h('td', { style: td }, node.status),
                h('td', { style: td }, String(data.impact[node.id] ?? 0)),
              ),
            ),
          ),
        ),
        h('h3', { style: { margin: '18px 0 6px', fontSize: '14px' } }, 'Dependencies'),
        h(
          'ul',
          { style: { margin: 0, paddingLeft: '18px', ...mono } },
          data.edges.map((edge, index) => h('li', { key: `${edge.from}-${edge.to}-${index}` }, `${edge.from} -[${edge.type}]-> ${edge.to}`)),
        ),
        h('h3', { style: { margin: '18px 0 6px', fontSize: '14px' } }, 'Impact'),
        h(
          'div',
          { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
          h(
            'select',
            { value: current, onChange: (event) => setSelected(event.target.value), style: { ...button, padding: '4px 8px' } },
            nodes.map((node) => h('option', { key: node.id, value: node.id }, node.id)),
          ),
          h('span', { style: { fontSize: '13px', color: 'var(--dsw-alias-label-secondary)' } }, `${affected.length} affected`),
        ),
        affected.length === 0
          ? h('p', { style: { fontSize: '13px', color: 'var(--dsw-alias-label-secondary)' } }, 'No dependents.')
          : h(
              'ul',
              { style: { margin: '6px 0 0', paddingLeft: '18px', ...mono } },
              affected.map((entry) => h('li', { key: `${entry.id}-${entry.depth}` }, `${entry.id}  depth=${entry.depth}  via=${entry.via}`)),
            ),
        h('h3', { style: { margin: '18px 0 6px', fontSize: '14px' } }, 'Relation gaps'),
        data.gaps.length === 0
          ? h('p', { style: { fontSize: '13px', color: 'var(--dsw-alias-label-secondary)' } }, 'None.')
          : h(
              'ul',
              { style: { margin: 0, paddingLeft: '18px', fontSize: '13px' } },
              data.gaps.map((gap, index) =>
                h('li', { key: `${gap.rule}-${index}` }, `${gap.rule}  ${gap.file}${gap.line ? `:${gap.line}` : ''}  ${gap.message}`),
              ),
            ),
      )
    }

    return {
      inject: ['slots', 'layout'],
      apply(ctx) {
        function SettingsPage() {
          return h(ArchitectureView, { openPanel: () => ctx.layout.selectPanel('architecture') })
        }
        function MainPage() {
          return h(ArchitectureView, {})
        }
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register({ name: 'settings.section', id: 'architecture', order: 92, label: 'Architecture' }, SettingsPage),
        )
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'architecture' }, MainPage))
      },
    }
  },
})
