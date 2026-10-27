const ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ESCAPE[character])
}

const STYLE = `
  :root { color-scheme: dark; }
  body { margin: 0; background: #0f1115; color: #e6edf3; font: 14px/1.5 "Segoe UI", system-ui, sans-serif; }
  .wrap { max-width: 980px; margin: 0 auto; padding: 32px 20px 48px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 28px 0 8px; }
  .summary { color: #9da7b3; margin: 0 0 20px; }
  .pill { display: inline-block; padding: 1px 8px; border-radius: 10px; background: #1f6feb33; color: #79c0ff; font-size: 12px; }
  table { width: 100%; border-collapse: collapse; background: #161b22; border: 1px solid #30363d; border-radius: 8px; overflow: hidden; }
  th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #21262d; vertical-align: top; }
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
<title>ALM Requirements · error</title><style>${STYLE}</style></head>
<body><div class="wrap"><h1>ALM Requirements</h1>
<p class="fail">Failed to load: ${escapeHtml(message)}</p>
<p class="muted">HTTP ${status}. Check the plugin configuration and the repository root.</p>
</div></body></html>`
}

/** Server-rendered read-only page; works without the DSH GUI token. */
export function renderRequirementsPage(payload, options = {}) {
  if (!payload || payload.ok === false) {
    return renderErrorPage(payload?.error ?? 'requirements payload unavailable', 500)
  }

  const requirements = payload.requirements ?? []
  const gaps = payload.gaps ?? []
  const resultClass = payload.result === 'pass' ? 'ok' : 'fail'

  const rows = requirements.length
    ? requirements
        .map(
          (item) => `<tr>
        <td><code>${escapeHtml(item.id)}</code></td>
        <td>${escapeHtml(item.title)}</td>
        <td>${escapeHtml(item.status)}</td>
        <td>${escapeHtml(item.owner)}</td>
        <td>${item.verifiedBy?.length ? item.verifiedBy.map((id) => `<code>${escapeHtml(id)}</code>`).join(' ') : '<span class="muted">—</span>'}</td>
      </tr>`,
        )
        .join('')
    : '<tr><td colspan="5" class="muted">No requirements found.</td></tr>'

  const gapItems = gaps.length
    ? `<ul>${gaps
        .map(
          (gap) =>
            `<li><code>${escapeHtml(gap.rule)}</code> ${escapeHtml(gap.file)}:${escapeHtml(gap.line)} — ${escapeHtml(gap.message)}</li>`,
        )
        .join('')}</ul>`
    : '<p class="muted">No tracking gaps.</p>'

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>ALM Requirements</title><style>${STYLE}</style></head>
<body><div class="wrap">
  <h1>ALM Requirements</h1>
  <p class="summary">${requirements.length} requirements · ${gaps.length} gaps · <span class="${resultClass}">check ${escapeHtml(payload.result)}</span>
    · <a href="/api/alm/requirements">JSON</a></p>

  <table>
    <thead><tr><th>ID</th><th>Title</th><th>Status</th><th>Owner</th><th>Verified by</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <h2>Tracking gaps</h2>
  ${gapItems}

  <p class="muted">Read-only · root <code>${escapeHtml(payload.root)}</code></p>
  ${options.sidebarUrl ? `<p class="muted">Sidebar browser: <code>${escapeHtml(options.sidebarUrl)}</code> — DSH blocks its own origin, so use this hostname.</p>` : ''}
</div></body></html>`
}

/**
 * The DSH sidebar browser refuses URLs whose origin equals the application
 * origin, so the same page is offered under the other loopback hostname
 * (`localhost` <-> `127.0.0.1`), which is a distinct origin.
 *
 * @param {string | undefined} hostHeader request `Host` header
 * @param {string} path page path
 * @returns {string | null} sidebar-browser URL, or null for non-loopback hosts
 */
export function sidebarBrowserUrl(hostHeader, path) {
  if (typeof hostHeader !== 'string' || hostHeader.trim() === '') return null
  let parsed
  try {
    parsed = new URL(`http://${hostHeader.trim()}`)
  } catch {
    return null
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '')
  if (!['localhost', '127.0.0.1', '::1'].includes(hostname)) return null
  const alias = hostname === 'localhost' ? '127.0.0.1' : 'localhost'
  return `http://${alias}${parsed.port ? `:${parsed.port}` : ''}${path}`
}
