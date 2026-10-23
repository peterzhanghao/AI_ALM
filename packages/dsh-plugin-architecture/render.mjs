const ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ESCAPE[character])
}

const STYLE = `
  :root { color-scheme: dark; }
  body { margin: 0; background: #0f1115; color: #e6edf3; font: 14px/1.5 "Segoe UI", system-ui, sans-serif; }
  .wrap { max-width: 1040px; margin: 0 auto; padding: 32px 20px 48px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 24px 0 8px; }
  .summary { color: #9da7b3; margin: 0 0 20px; }
  table { width: 100%; border-collapse: collapse; background: #161b22; border: 1px solid #30363d; border-radius: 8px; overflow: hidden; margin-bottom: 8px; }
  th, td { text-align: left; padding: 7px 12px; border-bottom: 1px solid #21262d; vertical-align: top; }
  th { color: #9da7b3; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; background: #12171e; }
  tr:last-child td { border-bottom: none; }
  code { font: 12px/1.4 "Cascadia Code", Consolas, monospace; color: #c9d1d9; background: #21262d; padding: 1px 5px; border-radius: 4px; }
  .muted { color: #8b949e; }
  .ok { color: #3fb950; }
  .fail { color: #f85149; }
  a { color: #58a6ff; }
  ul { padding-left: 20px; }
`

export function renderErrorPage(message, status = 500) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>ALM Architecture · error</title><style>${STYLE}</style></head>
<body><div class="wrap"><h1>ALM Architecture</h1>
<p class="fail">Failed to load: ${escapeHtml(message)}</p>
<p class="muted">HTTP ${status}. Check the plugin configuration and the repository root.</p>
</div></body></html>`
}

/** Server-rendered read-only page; works without the DSH GUI token. */
export function renderArchitecturePage(payload) {
  if (!payload || payload.ok === false) {
    return renderErrorPage(payload?.error ?? 'architecture payload unavailable', 500)
  }

  const sections = [
    ['Modules', payload.modules ?? []],
    ['Decisions', payload.decisions ?? []],
    ['Interfaces', payload.interfaces ?? []],
    ['Data models', payload.dataModels ?? []],
  ]

  const nodeTable = (title, nodes) => `<h2>${title}</h2>
  <table><thead><tr><th>ID</th><th>Title</th><th>Status</th><th>Owner</th><th>Impact</th></tr></thead><tbody>
  ${
    nodes.length
      ? nodes
          .map(
            (node) => `<tr><td><code>${escapeHtml(node.id)}</code></td><td>${escapeHtml(node.title)}</td>
        <td>${escapeHtml(node.status)}</td><td>${escapeHtml(node.owner)}</td>
        <td>${escapeHtml(payload.impact?.[node.id] ?? 0)}</td></tr>`,
          )
          .join('')
      : '<tr><td colspan="5" class="muted">None.</td></tr>'
  }
  </tbody></table>`

  const edges = payload.edges ?? []
  const edgeTable = `<h2>Dependency edges</h2>
  <table><thead><tr><th>From</th><th>To</th><th>Type</th></tr></thead><tbody>
  ${
    edges.length
      ? edges
          .map(
            (edge) =>
              `<tr><td><code>${escapeHtml(edge.from)}</code></td><td><code>${escapeHtml(edge.to)}</code></td><td>${escapeHtml(edge.type)}</td></tr>`,
          )
          .join('')
      : '<tr><td colspan="3" class="muted">No edges.</td></tr>'
  }
  </tbody></table>`

  const gaps = payload.gaps ?? []
  const gapItems = gaps.length
    ? `<ul>${gaps
        .map(
          (gap) =>
            `<li><code>${escapeHtml(gap.rule)}</code> ${escapeHtml(gap.file)}:${escapeHtml(gap.line)} — ${escapeHtml(gap.message)}</li>`,
        )
        .join('')}</ul>`
    : '<p class="muted">No relation gaps.</p>'

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>ALM Architecture</title><style>${STYLE}</style></head>
<body><div class="wrap">
  <h1>ALM Architecture</h1>
  <p class="summary">${payload.summary?.nodes ?? 0} nodes · ${payload.summary?.edges ?? 0} edges
    · ${gaps.length} gaps · <span class="${payload.result === 'pass' ? 'ok' : 'fail'}">check ${escapeHtml(payload.result)}</span>
    · <a href="/api/alm/architecture">JSON</a></p>

  ${sections.map(([title, nodes]) => nodeTable(title, nodes)).join('\n')}
  ${edgeTable}

  <h2>Relation gaps</h2>
  ${gapItems}

  <p class="muted">Read-only · root <code>${escapeHtml(payload.root)}</code></p>
</div></body></html>`
}
