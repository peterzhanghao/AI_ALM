const ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ESCAPE[character])
}

const STYLE = `
  :root { color-scheme: dark; }
  body { margin: 0; background: #0f1115; color: #e6edf3; font: 14px/1.5 "Segoe UI", system-ui, sans-serif; }
  .wrap { max-width: 1180px; margin: 0 auto; padding: 32px 20px 48px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 28px 0 8px; }
  .summary { color: #9da7b3; margin: 0 0 20px; }
  .pill { display: inline-block; padding: 1px 8px; border-radius: 10px; background: #1f6feb33; color: #79c0ff; font-size: 12px; }
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; background: #161b22; border: 1px solid #30363d; border-radius: 8px; overflow: hidden; }
  th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #21262d; vertical-align: top; }
  th { color: #9da7b3; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; background: #12171e; }
  tr:last-child td { border-bottom: none; }
  td div { margin-top: 3px; }
  code { font: 12px/1.4 "Cascadia Code", Consolas, monospace; color: #c9d1d9; background: #21262d; padding: 1px 5px; border-radius: 4px; }
  .muted { color: #8b949e; }
  .ok { color: #3fb950; }
  .warn { color: #d29922; }
  .fail { color: #f85149; }
  a { color: #58a6ff; }
  .empty { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px 20px; margin: 0 0 16px; }
  .empty h2 { margin: 0 0 8px; font-size: 15px; }
  .empty ol { margin: 0; padding-left: 20px; color: #c9d1d9; }
  .empty li { margin: 4px 0; }
  ul { padding-left: 20px; }
  li { margin: 4px 0; }
`

const TONE_CLASS = { neutral: 'muted', error: 'fail', warn: 'warn', success: 'ok' }

const ANOMALY_LABELS = {
  'duplicate-id': '需求 ID 重复',
  'duplicate-business-id': '业务 ID 重复',
  'dangling-relation': '悬空关系',
}

function shortHash(value, size = 12) {
  return value ? `<code>${escapeHtml(String(value).slice(0, size))}</code>` : '<span class="muted">—</span>'
}

function decisionCell(item) {
  const decision = item.decision
  if (!decision) return '<span class="muted">—</span>'
  const tone = TONE_CLASS[decision.tone] ?? 'muted'
  const label = escapeHtml(decision.label ?? decision.state ?? '未知')
  const gap = decision.topGap?.message ? `<div class="muted">${escapeHtml(decision.topGap.message)}</div>` : ''
  return `<span class="${tone}">${label}</span>${gap}`
}

function nextStepCell(item) {
  const label = item.decision?.nextStep?.label
  return label ? escapeHtml(label) : '<span class="muted">—</span>'
}

function acceptanceCell(item) {
  const codes = (item.verifiedBy ?? []).map((id) => `<code>${escapeHtml(id)}</code>`).join(' ')
  const linked = codes ? `<div class="muted">已关联 ${codes}</div>` : '<div class="muted">未关联验收资产</div>'
  const latest = item.acceptance?.latest
  if (!latest) return `${linked}<div class="muted">验收尚未执行</div>`
  const environment = latest.environment
    ? [latest.environment.platform, latest.environment.arch, latest.environment.node ? `node ${latest.environment.node}` : null, latest.environment.runner]
        .filter(Boolean)
        .join(' · ')
    : '—'
  const time = latest.finishedAt ? String(latest.finishedAt).slice(0, 19).replace('T', ' ') : '—'
  const provenance = `<div class="muted">需求修订 ${shortHash(latest.requirementHash)} · 实现提交 ${shortHash(latest.headSha)} · 测试修订 ${shortHash(latest.testRevision)}</div>
        <div class="muted">环境 ${escapeHtml(environment)} · 时间 ${escapeHtml(time)} · 来源 ${escapeHtml(latest.source ?? '—')}</div>`
  const incomplete =
    latest.complete === false
      ? `<div class="warn">来源或版本不完整${latest.missing?.length ? `（缺少：${escapeHtml(latest.missing.join('、'))}）` : ''}</div>`
      : ''
  return `${linked}${provenance}${incomplete}`
}

function anomalyItems(anomalies) {
  if (!anomalies.length) return '<p class="muted">没有数据异常。</p>'
  const items = anomalies
    .map((anomaly) => {
      const occurrences = (anomaly.occurrences ?? [])
        .map(
          (occurrence) =>
            `<code>${escapeHtml(occurrence.assetId ?? occurrence.uid ?? occurrence.occurrenceKey ?? '—')}</code> ${escapeHtml(occurrence.file ?? anomaly.file ?? '—')}:${escapeHtml(occurrence.line ?? anomaly.line ?? '')}`,
        )
        .join(' · ')
      const fallback = anomaly.file ? `<code>${escapeHtml(anomaly.file)}:${escapeHtml(anomaly.line ?? '')}</code>` : ''
      return `<li><span class="fail">${escapeHtml(ANOMALY_LABELS[anomaly.kind] ?? anomaly.kind)}</span> ${escapeHtml(anomaly.message)} ${occurrences || fallback}</li>`
    })
    .join('')
  return `<ul>${items}</ul>`
}

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
  const anomalies = payload.anomalies ?? []
  const anomalySummary = payload.anomalySummary ?? {}
  const resultClass = payload.result === 'pass' ? 'ok' : 'fail'

  const rows = requirements.length
    ? requirements
        .map(
          (item) => `<tr>
        <td><code>${escapeHtml(item.id)}</code></td>
        <td>${escapeHtml(item.title)}</td>
        <td>${escapeHtml(item.statusLabel ?? item.status)}</td>
        <td>${escapeHtml(item.owner)}</td>
        <td>${decisionCell(item)}</td>
        <td>${nextStepCell(item)}</td>
        <td>${acceptanceCell(item)}</td>
      </tr>`,
        )
        .join('')
    : '<tr><td colspan="7" class="muted">No requirements found.</td></tr>'

  const gapItems = gaps.length
    ? `<ul>${gaps
        .map(
          (gap) =>
            `<li><code>${escapeHtml(gap.rule)}</code> ${escapeHtml(gap.file)}:${escapeHtml(gap.line)} — ${escapeHtml(gap.message)}</li>`,
        )
        .join('')}</ul>`
    : '<p class="muted">No tracking gaps.</p>'

  const anomalySummaryLabel = [
    anomalySummary.duplicateId ? `ID 重复 ${anomalySummary.duplicateId}` : null,
    anomalySummary.duplicateBusinessId ? `业务 ID 重复 ${anomalySummary.duplicateBusinessId}` : null,
    anomalySummary.dangling ? `悬空关系 ${anomalySummary.dangling}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>ALM Requirements</title><style>${STYLE}</style></head>
<body><div class="wrap">
  <h1>ALM Requirements</h1>
  <p class="summary">${requirements.length} requirements · ${gaps.length} gaps · ${anomalies.length} anomalies · <span class="${resultClass}">check ${escapeHtml(payload.result)}</span>
    · <a href="/api/alm/requirements">JSON</a></p>

  ${
    requirements.length === 0
      ? `<section class="empty">
    <h2>Start here</h2>
    <ol>
      <li>Load the sample: point <code>?root=fixtures/order-refund</code> at the demo assets.</li>
      <li>Or ask the agent: &quot;draft a requirement for the change&quot;, then run <code>alm check</code>.</li>
      <li>Open the workbench for the next action, relations and acceptance coverage.</li>
    </ol>
  </section>`
      : ""
  }

  <div class="table-wrap">
  <table>
    <thead><tr><th>ID</th><th>标题</th><th>状态</th><th>负责人</th><th>决策</th><th>下一步</th><th>验收（溯源）</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  </div>

  <h2>数据异常（${anomalies.length}）${anomalySummaryLabel ? ` · ${escapeHtml(anomalySummaryLabel)}` : ''}</h2>
  <p class="muted">这些记录不会自动修复：保留两条记录、不自动合并；请打开工作台按 file:line 人工核对。</p>
  ${anomalyItems(anomalies)}

  <h2>Tracking gaps</h2>
  ${gapItems}

  <p class="muted">Read-only · root <code>${escapeHtml(payload.root)}</code></p>
  ${options.sidebarUrl ? `<p class="muted">Sidebar browser: <code>${escapeHtml(options.sidebarUrl)}</code> — DSH blocks its own host, so use this port.</p>` : ''}
</div></body></html>`
}
