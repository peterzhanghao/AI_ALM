import { githubDeliveryLinks } from './github-web.mjs'

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
  .evolved { color: #8bd5f5; background: #3fa0cd24; border: 1px solid #6abee166; border-radius: 999px; padding: 1px 7px; white-space: nowrap; }
  .requirement-title { max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .timeline { border-left: 1px solid #30363d; margin: 12px 0; padding-left: 20px; }
  .timeline-event { position: relative; margin: 12px 0; }
  .timeline-event::before { content: ""; position: absolute; left: -26px; top: 6px; width: 10px; height: 10px; border-radius: 50%; background: #58a6ff; box-shadow: 0 0 0 3px #0f1115; }
  .timeline-event.delivery::before { background: #3fb950; }
  .timeline-badge { display: inline-block; padding: 1px 7px; border: 1px solid #58a6ff; border-radius: 999px; color: #79c0ff; font-size: 11px; font-weight: 600; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; }
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

function listTimestamp(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '—'
  const pad = number => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function decisionCell(item) {
  const decision = item.decision
  if (!decision || !['verified', 'failed'].includes(decision.state)) return ''
  const tone = TONE_CLASS[decision.tone] ?? 'muted'
  const label = escapeHtml(decision.label ?? decision.state ?? '未知')
  const gap = decision.topGap?.message && decision.topGap?.code !== 'acceptance-missing' ? `<div class="muted">${escapeHtml(decision.topGap.message)}</div>` : ''
  return `<span class="${tone}">${label}</span>${gap}`
}

function nextStepCell(item) {
  const label = item.pendingPatch || item.currentMatter?.kind === 'decision' ? '去确认' : item.delivery?.key === 'pending' ? '进入需求' : item.decision?.nextStep?.label
  return label ? escapeHtml(label) : '<span class="muted">—</span>'
}

function acceptanceCell(item) {
  const count = item.detailView?.content?.doc?.acceptance?.length ?? item.docView?.doc?.acceptance?.length ?? item.detailView?.content?.acceptanceCriteria?.length ?? 0
  if (count > 0) return `${count} 项标准`
  const section = String(item.briefText ?? '').match(/^#{1,6}\s*(?:验收标准|交付验证|验收要求)[^\n]*\n([\s\S]*?)(?=^#{1,6}\s|(?![\s\S]))/m)?.[1] ?? ''
  const entries = section.match(/^\s*(?:[-*+]\s+|\d+[.)、]\s*|AC[- ]?\d+[:：.、\s])/gmi) ?? []
  return entries.length ? `${entries.length} 项标准` : section.trim() ? '正文内含' : '待细化'
}

function deliveryLinksFor(item) {
  const sourceControl = item?.release?.sourceControl ?? {}
  const candidate = item?.candidate?.development ?? {}
  const development = item?.development ?? {}
  return item?.detailView?.githubLinks ?? githubDeliveryLinks({
    remoteUrl: sourceControl.remoteUrl ?? development.remoteUrl ?? null,
    devBranch: sourceControl.devBranch ?? candidate.devBranch ?? development.integrationBranch ?? null,
    mainBranch: sourceControl.mainBranch ?? development.releaseBranch ?? null,
    devCommitSha: sourceControl.devCommitSha ?? candidate.devCommitSha ?? null,
    mainMergeCommitSha: sourceControl.mainMergeCommitSha ?? null,
    architectureDocPath: item?.candidate?.architecture?.path ?? sourceControl.architectureDocPath ?? null,
  })
}

function gitDeliveryBadge(item) {
  const links = deliveryLinksFor(item)
  if (!links) return ''
  const anchor = (href, label) => href ? `<a class="ok" href="${escapeHtml(href)}" target="_blank" rel="noopener">${escapeHtml(label)}</a>` : ''
  return [
    anchor(links.devBranchUrl, `🌿 ${links.devBranch ?? 'develop'}`),
    links.mainMergeCommitSha ? anchor(links.mainBranchUrl, `✅ ${links.mainBranch ?? 'main'}`) : '',
  ].filter(Boolean).join(' · ')
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

function convergenceSummary(event) {
  const diff = event?.diff && typeof event.diff === 'object' ? event.diff : {}
  const changes = type => Array.isArray(diff[type]) ? diff[type] : []
  const acceptance = type => changes(type).filter(change => change?.kind === 'acceptance')
  const describe = change => {
    const label = String(change?.label ?? '')
    const clause = label.match(/^(.+?[。！？；;])(?:\s|$)/)?.[1] ?? label
    return [change?.id, clause].filter(Boolean).join(': ')
  }
  const parts = []
  const added = acceptance('added'), modified = acceptance('modified'), removed = acceptance('removed')
  if (added.length) parts.push(`新增 ${added.length} 项验收标准${added[0] ? `（${describe(added[0])}）` : ''}`)
  if (modified.length) parts.push(`调整 ${modified.length} 项验收标准${modified[0] ? `（${describe(modified[0])}）` : ''}`)
  if (removed.length) parts.push(`移除 ${removed.length} 项验收标准${removed[0]?.id ? `（${removed[0].id}）` : ''}`)
  const nonAcceptance = ['added', 'modified', 'removed'].flatMap(changes).some(change => change?.kind && change.kind !== 'acceptance')
  if (nonAcceptance) parts.push('同步更新需求说明')
  const note = String(event?.evolutionNote ?? '').trim()
  const generic = !note || /^(?:主对话定稿|需求定稿|已确认|确认收敛)[。！! ]*$/u.test(note)
  return generic ? (parts.join(' · ') || '更新需求基线') : note
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
        <td><code>${escapeHtml(item.id)}</code> · <span class="${Number(item.revision) > 1 ? 'evolved' : 'muted'}" title="${escapeHtml([...item.specConvergences ?? []].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0]?.evolutionNote ?? '需求版本')}">v${escapeHtml(item.revision ?? 1)}${Number(item.revision) > 1 ? ' · 已演进' : ''}</span>${item.pendingPatch ? ' <span class="warn">● 待确认变更</span>' : ''}</td>
        <td class="requirement-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}<div class="muted">${(item.sources ?? []).includes('defect') ? '⚠ 缺陷' : item.sourceSession || (item.sources ?? []).includes('chat') ? '💬 对话生成' : (item.sources ?? []).includes('feedback') ? '反馈' : '✍️ 手动创建'}${gitDeliveryBadge(item) ? ` · ${gitDeliveryBadge(item)}` : ''}</div></td>
        <td>${escapeHtml(item.statusLabel ?? item.status)}</td>
        <td>${escapeHtml(item.owner)}</td>
        <td>${escapeHtml(listTimestamp(item.updatedAt ?? item.createdAt))}${decisionCell(item) ? `<div>${decisionCell(item)}</div>` : ''}</td>
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

  const convergenceHistory = requirements.flatMap(item => (item.specConvergences ?? []).map(event => {
    const before = Array.isArray(event.acceptanceCriteria?.before) ? event.acceptanceCriteria.before : []
    const after = Array.isArray(event.acceptanceCriteria?.after) ? event.acceptanceCriteria.after : []
    const asMap = values => new Map(values.map((entry, index) => [entry?.id ?? `AC-${String(index + 1).padStart(2, '0')}`, typeof entry === 'string' ? entry : entry?.text ?? entry?.label ?? entry?.expected ?? '']))
    const left = asMap(before), right = asMap(after), changes = []
    for (const [id, text] of right) if (!left.has(id)) changes.push({ type: '新增', id, after: text }); else if (left.get(id) !== text) changes.push({ type: '修改', id, before: left.get(id), after: text })
    for (const [id, text] of left) if (!right.has(id)) changes.push({ type: '移除', id, before: text })
    const fields = [['title', '标题'], ['goal', '预期变化'], ['problem', '价值']].flatMap(([key, label]) => typeof event.beforeDocument?.[key] === 'string' && typeof event.afterDocument?.[key] === 'string' && event.beforeDocument[key] !== event.afterDocument[key] ? [{ label, before: event.beforeDocument[key], after: event.afterDocument[key] }] : [])
    const count = type => changes.filter(change => change.type === type).length + (type === '修改' ? fields.length : 0)
    const body = fields.map(field => `<div><strong>${escapeHtml(field.label)}</strong><p>修改前：${escapeHtml(field.before)}</p><p>修改后：${escapeHtml(field.after)}</p></div>`).join('') + changes.map(change => `<div style="border-left:3px solid ${change.type === '新增' ? '#35c47a' : change.type === '移除' ? '#ef7777' : '#e7b04b'};padding:8px;margin:8px 0"><strong>${change.type === '新增' ? '+' : change.type === '移除' ? '-' : '~'} ${change.type} ${escapeHtml(change.id)}</strong>${change.type === '修改' ? `<p>修改前：${escapeHtml(change.before)}</p><p>修改后：${escapeHtml(change.after)}</p>` : `<p${change.type === '移除' ? ' style="text-decoration:line-through"' : ''}>${escapeHtml(change.after ?? change.before)}</p>`}</div>`).join('')
    const version = event.beforeRevision && event.revision ? `v${escapeHtml(event.beforeRevision)} → v${escapeHtml(event.revision)}` : '版本演进'
    return `<article class="timeline-event"><span class="timeline-badge">${version}</span> <code>${escapeHtml(item.id)}</code> · ${escapeHtml(event.at)}<p>${escapeHtml(convergenceSummary(event))}${event.sourceSession ? ` · 来源会话：${escapeHtml(event.sourceSession)}` : ''}</p><details><summary>查看需求和验收变更</summary><div class="visual-spec-diff"><strong>版本对比${event.beforeRevision && event.revision ? ` (v${escapeHtml(event.beforeRevision)} → v${escapeHtml(event.revision)})` : ''}</strong> · +${count('新增')} 新增 / ~${count('修改')} 修改 / -${count('移除')} 移除${body || '<p class="muted">本次未记录可展示的需求或验收变更。</p>'}</div></details></article>`
  }))

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
    <thead><tr><th>ID</th><th>标题</th><th>状态</th><th>负责人</th><th>最近更新</th><th>下一步</th><th>验收标准</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  </div>

  <h2>需求收敛历史</h2>
  ${convergenceHistory.length ? `<section class="timeline">${convergenceHistory.join('')}</section>` : '<p class="muted">暂无已确认的需求收敛记录。</p>'}

  <h2>数据异常（${anomalies.length}）${anomalySummaryLabel ? ` · ${escapeHtml(anomalySummaryLabel)}` : ''}</h2>
  <p class="muted">这些记录不会自动修复：保留两条记录、不自动合并；请打开工作台按 file:line 人工核对。</p>
  ${anomalyItems(anomalies)}

  <h2>Tracking gaps</h2>
  ${gapItems}

  <p class="muted">Read-only · root <code>${escapeHtml(payload.root)}</code></p>
  ${options.sidebarUrl ? `<p class="muted">Sidebar browser: <code>${escapeHtml(options.sidebarUrl)}</code> — DSH blocks its own host, so use this port.</p>` : ''}
</div></body></html>`
}
