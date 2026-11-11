/**
 * Self-contained HTML report for one round.
 *
 * It has to work by double-clicking from disk on a machine with no server, no
 * network and no DSH running, so: inline CSS, inline base64 images, inline
 * script, CSP that forbids everything external. The reviewer signs or rejects
 * each check in the page and exports `acceptance-reviews-<id>.json`, which
 * `acceptance_review` ingests into `reviews.json`.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const REPORT_SCHEMA = 'alm.plugin-acceptance.report/v1'
const MAX_INLINE_BYTES = 4_000_000
const DOM_PREVIEW_CHARS = 4_000

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ESCAPES[char])
}

function shortSha(sha) {
  return typeof sha === 'string' && sha.length > 12 ? sha.slice(0, 12) : (sha ?? '无')
}

const STATUS_LABEL = { pass: '通过', fail: '失败', blocked: '阻塞' }
const STATUS_CLASS = { pass: 'ok', fail: 'bad', blocked: 'warn' }

function bytesLabel(bytes) {
  if (!Number.isFinite(bytes)) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function formatDuration(ms) {
  if (!Number.isFinite(ms)) return ''
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`
}

/**
 * Inline one evidence item: screenshots become data URIs, DOM snapshots become
 * collapsible text. A missing file is reported as missing instead of hidden —
 * a broken evidence link is exactly what a reviewer must not miss.
 *
 * @param {{dir: string, item: object}} options
 */
function renderEvidence({ dir, item }) {
  const caption = esc(item.description ?? item.path)
  const kind = item.kind ?? 'file'
  let body
  if (kind === 'screenshot') {
    try {
      const buffer = readFileSync(join(dir, item.path))
      if (buffer.byteLength > MAX_INLINE_BYTES) {
        body = `<p class="missing">截图 ${esc(item.path)} 体积 ${bytesLabel(buffer.byteLength)}，超过内联上限，未嵌入报告。</p>`
      } else {
        body = `<img alt="${caption}" src="data:image/png;base64,${buffer.toString('base64')}">`
      }
    } catch {
      body = `<p class="missing">证据文件缺失：${esc(item.path)}</p>`
    }
  } else if (kind === 'dom_snapshot') {
    try {
      const snapshot = JSON.parse(readFileSync(join(dir, item.path), 'utf8'))
      const text = typeof snapshot.text === 'string' ? snapshot.text : ''
      const preview = text.length > DOM_PREVIEW_CHARS ? `${text.slice(0, DOM_PREVIEW_CHARS)}\n…[截断]` : text
      body = `<details><summary>DOM 快照 · ${esc(snapshot.url ?? '')} · ${esc(snapshot.title ?? '')}</summary><pre>${esc(preview)}</pre></details>`
    } catch {
      body = `<p class="missing">DOM 快照无法读取：${esc(item.path)}</p>`
    }
  } else {
    body = `<p class="file">${esc(item.path)}</p>`
  }
  return `<figure class="evidence">${body}<figcaption>${caption}<span class="path">${esc(item.path)}</span></figcaption></figure>`
}

function renderSteps(steps) {
  if (!Array.isArray(steps) || steps.length === 0) return ''
  const rows = steps
    .map(
      (step) => `<tr class="${step.ok ? 'step-ok' : 'step-bad'}">
      <td>${esc(step.index + 1)}</td>
      <td><code>${esc(step.action)}</code></td>
      <td>${esc(step.detail)}</td>
    </tr>`,
    )
    .join('')
  return `<details class="steps"><summary>步骤 ${steps.length} 条 · ${steps.filter((step) => step.ok).length} 通过</summary>
    <table><thead><tr><th>#</th><th>动作</th><th>观察</th></tr></thead><tbody>${rows}</tbody></table></details>`
}

function renderCheck({ dir, round, entry, decision }) {
  const status = STATUS_CLASS[entry.status] ?? 'warn'
  const decided = decision ? (decision.action === 'accept' ? 'accepted' : 'rejected') : ''
  const comment = decision?.comment ?? ''
  return `<section class="check ${status}" data-check="${esc(entry.id)}">
    <header>
      <h3><span class="chip ${status}">${esc(STATUS_LABEL[entry.status] ?? entry.status)}</span> ${esc(entry.title)}</h3>
      <p class="ids"><code>${esc(entry.id)}</code> · ${esc(entry.level ?? round.level)} · ${esc(entry.surface ?? 'web')} · ${formatDuration(entry.durationMs)}</p>
    </header>
    <p class="expected"><strong>期望</strong> ${esc(entry.expected)}</p>
    <p class="observation"><strong>观察</strong> ${esc(entry.observation)}</p>
    ${entry.repro?.length ? `<p class="repro"><strong>复现</strong> ${entry.repro.map((line) => `<code>${esc(line)}</code>`).join(' ')}</p>` : ''}
    ${renderSteps(entry.steps)}
    <div class="gallery">${(entry.evidence ?? []).map((item) => renderEvidence({ dir, item })).join('')}</div>
    <div class="decision">
      <button type="button" class="accept" data-action="accept" data-check="${esc(entry.id)}"${decided === 'accepted' ? ' aria-pressed="true"' : ''}>通过</button>
      <button type="button" class="reject" data-action="reject" data-check="${esc(entry.id)}"${decided === 'rejected' ? ' aria-pressed="true"' : ''}>打回</button>
      <input type="text" placeholder="打回必须填写理由" value="${esc(comment)}" data-comment="${esc(entry.id)}">
      <span class="saved" data-saved="${esc(entry.id)}">${decided === 'accepted' ? '已标记通过' : decided === 'rejected' ? '已标记打回' : '未评审'}</span>
    </div>
  </section>`
}

/**
 * @param {{round: object, reviews?: object|null, dir: string, drift?: string[]}} options
 * @returns {string}
 */
export function renderReport({ round, reviews = null, dir, drift = [] }) {
  const cases = round.cases ?? []
  const stats = round.stats ?? { pass: 0, fail: 0, blocked: 0 }
  const verdict = round.verdict ?? 'blocked'
  const git = round.subject?.git ?? {}
  const env = round.subject?.environment ?? {}
  const decisions = new Map()
  for (const event of reviews?.events ?? []) {
    if (event.kind === 'check' && event.checkId) decisions.set(event.checkId, event)
  }

  const fileRows = (round.subject?.files ?? [])
    .map(
      (file) => `<tr><td><code>${esc(file.path)}</code></td><td><code>${esc(shortSha(file.sha256))}</code></td><td>${esc(bytesLabel(file.bytes))}</td></tr>`,
    )
    .join('')

  const banners = []
  if (git.dirty) {
    banners.push(
      `<p class="banner warn"><strong>工作区有未提交改动</strong>：本轮证据来自 commit <code>${esc(shortSha(git.headSha))}</code> 之上的改动，不能直接等同于该提交的验收结论。</p>`,
    )
  }
  if (drift.length) {
    banners.push(`<p class="banner bad"><strong>证据与当前代码不一致</strong>：${drift.map((line) => esc(line)).join('；')}</p>`)
  }
  if (cases.some((entry) => !(entry.evidence ?? []).length)) {
    banners.push('<p class="banner warn"><strong>存在无证据的检查项</strong>：这些项目前不可签字。</p>')
  }

  const payload = {
    schema: REPORT_SCHEMA,
    acceptanceId: round.acceptanceId,
    roundId: round.roundId,
    plugin: round.plugin,
    requirement: round.requirement ?? null,
    verdict,
    cases: cases.map((entry) => ({ id: entry.id, title: entry.title, status: entry.status })),
  }

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>验收报告 · ${esc(round.plugin)} · 轮次 ${esc(round.roundId)}</title>
<style>
:root { color-scheme: light; --ink:#1a1c1f; --mute:#5b646e; --line:#d8dde3; --ok:#0a7d4b; --bad:#b42318; --warn:#8a5a00; --bg:#f6f7f9; }
* { box-sizing: border-box; }
body { margin:0; padding:32px 24px 96px; background:var(--bg); color:var(--ink); font:15px/1.6 -apple-system, "Segoe UI", "Microsoft YaHei", system-ui, sans-serif; }
main { max-width: 1080px; margin: 0 auto; }
h1 { font-size: 22px; margin: 0 0 4px; letter-spacing: -.01em; }
h2 { font-size: 16px; margin: 32px 0 12px; text-transform: uppercase; letter-spacing: .08em; color: var(--mute); }
h3 { font-size: 16px; margin: 0; display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
a { color: inherit; }
code { font: 12.5px/1.5 ui-monospace, "Cascadia Mono", Consolas, monospace; background:#eceff3; padding:1px 5px; border-radius:4px; }
.sub { color: var(--mute); margin: 0 0 20px; }
.chip { display:inline-block; padding:2px 10px; border-radius:999px; font-size:12px; font-weight:600; letter-spacing:.02em; }
.chip.ok { background:#e3f4ea; color:var(--ok); }
.chip.bad { background:#fde7e5; color:var(--bad); }
.chip.warn { background:#fbf0da; color:var(--warn); }
.verdict { display:flex; gap:16px; align-items:center; flex-wrap:wrap; padding:16px 20px; background:#fff; border:1px solid var(--line); border-radius:12px; }
.verdict .big { font-size:20px; font-weight:700; }
.stats { display:flex; gap:20px; color:var(--mute); font-variant-numeric: tabular-nums; }
.stats b { color:var(--ink); }
.banner { padding:12px 16px; border-radius:10px; margin:12px 0 0; border:1px solid; }
.banner.warn { background:#fdf6e7; border-color:#ecd9a8; color:#6b4700; }
.banner.bad { background:#fdecea; border-color:#f2c2bd; color:#8a1c12; }
.check { background:#fff; border:1px solid var(--line); border-radius:12px; padding:20px; margin:16px 0; }
.check.bad { border-color:#f0b7b1; }
.check.warn { border-color:#e8d29a; }
.ids { color:var(--mute); font-size:13px; margin:6px 0 12px; }
.expected, .observation, .repro { margin:6px 0; }
.missing { color:var(--bad); margin:0; font-size:13px; }
.gallery { display:grid; gap:16px; margin:16px 0 8px; }
figure.evidence { margin:0; border:1px solid var(--line); border-radius:10px; overflow:hidden; background:#fafbfc; }
figure.evidence img { display:block; width:100%; height:auto; background:#fff; }
figure.evidence pre { margin:0; padding:12px; max-height:320px; overflow:auto; font:12.5px/1.5 ui-monospace, Consolas, monospace; background:#fff; }
figure.evidence details { padding:10px 12px; }
figure.evidence summary { cursor:pointer; font-size:13px; color:var(--mute); }
figure.evidence figcaption { display:flex; justify-content:space-between; gap:12px; padding:8px 12px; font-size:12.5px; color:#3d454e; border-top:1px solid var(--line); background:#f2f4f7; }
figcaption .path { color:var(--mute); font-family:ui-monospace, Consolas, monospace; }
details.steps { margin:12px 0; font-size:13px; }
details.steps summary { cursor:pointer; color:var(--mute); }
details.steps table { width:100%; border-collapse:collapse; margin-top:8px; }
details.steps td, details.steps th { text-align:left; padding:4px 8px; border-bottom:1px solid #eceff3; vertical-align:top; }
.step-bad td { color:var(--bad); }
.decision { display:flex; gap:10px; align-items:center; flex-wrap:wrap; border-top:1px dashed var(--line); padding-top:14px; margin-top:8px; }
.decision input { flex:1 1 260px; min-width:200px; padding:7px 10px; border:1px solid var(--line); border-radius:8px; font:inherit; font-size:13px; }
button { font:inherit; font-size:13px; padding:7px 16px; border-radius:8px; border:1px solid var(--line); background:#fff; cursor:pointer; }
button:hover { border-color:#9aa4ae; }
button.accept[aria-pressed="true"] { background:var(--ok); border-color:var(--ok); color:#fff; }
button.reject[aria-pressed="true"] { background:var(--bad); border-color:var(--bad); color:#fff; }
.saved { font-size:12.5px; color:var(--mute); }
.bar { position:fixed; left:0; right:0; bottom:0; display:flex; gap:12px; align-items:center; padding:12px 24px; background:#fffffff2; backdrop-filter:blur(6px); border-top:1px solid var(--line); }
.bar .grow { flex:1; }
.bar .note { color:var(--mute); font-size:12.5px; }
table.meta { width:100%; border-collapse:collapse; background:#fff; border:1px solid var(--line); border-radius:10px; overflow:hidden; font-size:13px; }
table.meta td, table.meta th { padding:7px 12px; border-bottom:1px solid #eceff3; text-align:left; vertical-align:top; }
table.meta th { color:var(--mute); font-weight:500; width:180px; }
details.fingerprint pre { background:#fff; padding:14px; border:1px solid var(--line); border-radius:10px; overflow:auto; max-height:360px; font-size:12px; }
@media print { body { background:#fff; padding:0; } .bar, .decision { display:none; } .check { break-inside: avoid; } }
</style>
</head>
<body>
<main>
  <h1>${esc(round.plugin)} · 验收轮次 ${esc(round.roundId)}</h1>
  <p class="sub">${esc(round.requirement ? `需求 ${round.requirement}` : '未绑定需求')} · 级别 ${esc(round.level)} · ${esc(round.finishedAt ?? '')}</p>

  <div class="verdict">
    <span class="big chip ${STATUS_CLASS[verdict] ?? 'warn'}">${esc(verdict === 'pass' ? '机器判定通过' : verdict === 'fail' ? '机器判定失败' : '阻塞')}</span>
    <span class="stats"><span>通过 <b>${stats.pass ?? 0}</b></span><span>失败 <b>${stats.fail ?? 0}</b></span><span>阻塞 <b>${stats.blocked ?? 0}</b></span></span>
    <span class="stats"><span>检查项 <b>${cases.length}</b></span><span>证据 <b>${cases.reduce((total, entry) => total + (entry.evidence ?? []).length, 0)}</b></span></span>
  </div>
  ${banners.join('\n  ')}

  <h2>这轮证据对应哪份代码</h2>
  <table class="meta">
    <tr><th>HEAD</th><td><code>${esc(git.headSha ?? '无 git 仓库')}</code>${git.branch ? ` · 分支 ${esc(git.branch)}` : ''}${git.dirty ? ' · <strong>有未提交改动</strong>' : ''}</td></tr>
    <tr><th>被测文件</th><td>${(round.subject?.files ?? []).length ? `${round.subject.files.length} 个文件指纹（见下）` : '未记录'}</td></tr>
    <tr><th>运行环境</th><td>Node ${esc(env.node ?? '?')} · ${esc(env.platform ?? '?')}/${esc(env.arch ?? '?')} · 浏览器 ${esc(env.browser ?? '?')} · Playwright ${esc(env.playwright ?? '?')}</td></tr>
    <tr><th>工作区</th><td><code>${esc(round.subject?.root ?? '')}</code></td></tr>
    <tr><th>验收编号</th><td><code>${esc(round.acceptanceId)}</code></td></tr>
  </table>
  ${fileRows ? `<details class="fingerprint"><summary>文件指纹明细</summary><table class="meta"><tr><th>文件</th><th>sha256</th><th>大小</th></tr>${fileRows}</table></details>` : ''}

  <h2>检查项</h2>
  ${cases.map((entry) => renderCheck({ dir, round, entry, decision: decisions.get(entry.id) })).join('\n')}

  <h2>原始记录</h2>
  <details class="fingerprint"><summary>round.json</summary><pre>${esc(JSON.stringify({ ...round, dir: undefined }, null, 2))}</pre></details>
</main>

<div class="bar">
  <button type="button" id="save-reviews">保存评审</button>
  <button type="button" id="copy-reviews">复制评审 JSON</button>
  <span class="grow"></span>
  <span class="note" id="bar-note">逐条点通过或打回，然后保存；把导出的 JSON 交回 Agent 执行 acceptance_review。</span>
</div>

<script type="application/json" id="acceptance-payload">${JSON.stringify(payload).replace(/</g, '\\u003c')}</script>
<script>
(function () {
  var payload = JSON.parse(document.getElementById('acceptance-payload').textContent);
  var KEY = 'alm-acceptance:' + payload.acceptanceId + ':reviews';
  var decisions = {};
  try {
    var saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    (saved && saved.decisions ? saved.decisions : []).forEach(function (entry) { decisions[entry.check] = entry; });
  } catch (error) { /* file:// may block storage; decisions stay in memory */ }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ decisions: Object.keys(decisions).map(function (id) { return decisions[id]; }) }));
    } catch (error) { /* ignore */ }
  }

  function mark(check, action) {
    var commentInput = document.querySelector('[data-comment="' + check + '"]');
    var comment = commentInput ? commentInput.value.trim() : '';
    if (action === 'reject' && !comment) {
      if (commentInput) { commentInput.focus(); commentInput.placeholder = '打回必须填写理由'; commentInput.style.borderColor = '#b42318'; }
      return;
    }
    decisions[check] = { check: check, action: action, comment: comment, id: uuid(), createdAt: new Date().toISOString() };
    persist();
    document.querySelectorAll('[data-action][data-check="' + check + '"]').forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.getAttribute('data-action') === action));
    });
    var label = document.querySelector('[data-saved="' + check + '"]');
    if (label) label.textContent = action === 'accept' ? '已标记通过' : '已标记打回';
  }

  document.addEventListener('click', function (event) {
    var target = event.target.closest ? event.target.closest('[data-action]') : null;
    if (target) { mark(target.getAttribute('data-check'), target.getAttribute('data-action')); return; }
    if (event.target.id === 'save-reviews' || event.target.id === 'copy-reviews') {
      var events = Object.keys(decisions).map(function (id) {
        var entry = decisions[id];
        return { id: entry.id, kind: 'check', checkId: entry.check, action: entry.action, comment: entry.comment, createdAt: entry.createdAt };
      });
      var output = { schema: 'alm.plugin-acceptance.reviews/v1', acceptanceId: payload.acceptanceId, roundId: payload.roundId, format: 1, events: events };
      var text = JSON.stringify(output, null, 2);
      var note = document.getElementById('bar-note');
      if (event.target.id === 'copy-reviews') {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () { note.textContent = '评审 JSON 已复制到剪贴板'; },
            function () { note.textContent = '复制失败，请用「保存评审」下载文件'; });
        } else { note.textContent = '此环境不支持剪贴板，请用「保存评审」'; }
        return;
      }
      var blob = new Blob([text], { type: 'application/json' });
      var link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'acceptance-reviews-' + payload.acceptanceId + '.json';
      document.body.appendChild(link);
      link.click();
      setTimeout(function () { URL.revokeObjectURL(link.href); link.remove(); }, 1000);
      var missing = payload.cases.filter(function (entry) { return !decisions[entry.id]; });
      note.textContent = '已导出 ' + events.length + ' 条决定' + (missing.length ? '，还有 ' + missing.length + ' 项未评审' : '，全部检查项已评审');
    }
  });
})();
</script>
</body>
</html>
`
}
