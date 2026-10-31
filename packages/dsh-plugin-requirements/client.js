window.__ModuleLoader__.load({
  id: '@ai-alm/dsh-plugin-requirements',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback, useRef } = React

    const ROOT_KEY = 'alm.requirements.root'
    const PROJECT_KEY = 'alm.requirements.project'
    const ALL_PROJECTS = 'ALL'

    const T = {
      text: 'var(--dsw-alias-label-primary, #f2f4f7)',
      text2: 'var(--dsw-alias-label-secondary, #9aa3ae)',
      text3: 'var(--dsw-alias-label-tertiary, #6b7480)',
      line: 'var(--dsw-alias-border-l1, #232830)',
      line2: 'var(--dsw-alias-border-l2, #2e343d)',
      layer: 'var(--dsw-alias-bg-layer-1, #14171c)',
      layer2: 'var(--dsw-alias-bg-layer-2, #171b21)',
      base: 'var(--dsw-alias-bg-base, #0f1115)',
      brand: 'var(--dsw-alias-brand-primary, #4d6bfe)',
      ok: 'var(--dsw-alias-state-success-primary, #35c47a)',
      warn: 'var(--dsw-alias-state-warn-primary, #e7b04b)',
      err: 'var(--dsw-alias-state-error-primary, #ff8b8b)',
    }

    const STATUS = {
      proposed: { label: '待评审', color: T.text2, bg: 'rgba(154,163,174,.14)' },
      accepted: { label: '已采纳', color: T.brand, bg: 'rgba(77,107,254,.12)' },
      'in-progress': { label: '开发中', color: T.warn, bg: 'rgba(231,176,75,.14)' },
      implemented: { label: '已实现', color: T.brand, bg: 'rgba(77,107,254,.10)' },
      verified: { label: '已验证', color: T.ok, bg: 'rgba(53,196,122,.14)' },
      deprecated: { label: '已废弃', color: T.text3, bg: 'rgba(107,116,128,.12)' },
      superseded: { label: '被替代', color: T.text3, bg: 'rgba(107,116,128,.12)' },
    }

    const FILTERS = [
      ['all', '全部'],
      ['proposed', '待评审'],
      ['accepted', '已采纳'],
      ['in-progress', '开发中'],
      ['implemented', '已实现'],
      ['verified', '已验证'],
    ]

    const REL_LABELS = {
      satisfies: '满足',
      allocated_to: '分配到',
      depends_on: '依赖',
      constrained_by: '约束',
      verified_by: '验收',
      supersedes: '替代',
      parent_of: '子需求',
    }

    const VERDICT = {
      pass: { label: '通过', color: T.ok, bg: 'rgba(53,196,122,.12)' },
      warn: { label: '有建议', color: T.warn, bg: 'rgba(231,176,75,.14)' },
      block: { label: '阻塞', color: T.err, bg: 'rgba(255,139,139,.14)' },
      skip: { label: '未覆盖', color: T.text3, bg: 'rgba(107,116,128,.12)' },
    }

    // Evidence tones only pick a color; the decision label is always rendered as
    // text next to it so a color-blind or monochrome theme cannot hide the state.
    const EVIDENCE_TONE = {
      neutral: { color: T.text2, bg: 'rgba(154,163,174,.14)' },
      error: { color: T.err, bg: 'rgba(255,139,139,.14)' },
      warn: { color: T.warn, bg: 'rgba(231,176,75,.14)' },
      success: { color: T.ok, bg: 'rgba(53,196,122,.14)' },
    }

    const DECISION_LABELS = {
      unchecked: '未检查',
      'needs-clarification': '需澄清',
      blocked: '阻塞',
      failed: '执行失败',
      stale: '证据过期',
      'ready-for-human': '可进入人工确认',
      verified: '已签收',
    }

    const ANOMALY_LABELS = {
      'duplicate-id': '需求 ID 重复',
      'duplicate-business-id': '业务 ID 重复',
      'dangling-relation': '悬空关系',
    }

    const REHEARSAL_FIELDS = [
      ['title', '标题'],
      ['priority', '优先级'],
      ['brief', '背景'],
    ]

    function decisionTone(decision) {
      return EVIDENCE_TONE[decision?.tone] ?? EVIDENCE_TONE.neutral
    }

    function decisionLabel(decision) {
      if (!decision) return null
      return decision.label ?? DECISION_LABELS[decision.state] ?? decision.state ?? '未知'
    }

    function decisionPillStyle(decision) {
      const tone = decisionTone(decision)
      return {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        fontSize: '11.5px',
        padding: '2px 9px',
        borderRadius: '999px',
        color: tone.color,
        background: tone.bg,
        whiteSpace: 'nowrap',
      }
    }

    /** Green tick is only allowed when the backend says human signoff is possible/done. */
    function stateIsGreen(decision) {
      return decision?.state === 'ready-for-human' || decision?.state === 'verified'
    }

    function gapSeverityMeta(severity) {
      if (severity === 'block') return { label: '阻塞', color: T.err, bg: 'rgba(255,139,139,.14)' }
      if (severity === 'warn') return { label: '建议', color: T.warn, bg: 'rgba(231,176,75,.14)' }
      return { label: '提示', color: T.text3, bg: 'rgba(107,116,128,.12)' }
    }

    function shortHash(value, size = 12) {
      return value ? String(value).slice(0, size) : '—'
    }

    const panel = { padding: '24px', maxWidth: '1080px', color: T.text }
    const muted = { color: T.text2, fontSize: '12px' }
    const button = {
      border: `1px solid ${T.line}`,
      background: T.layer,
      color: T.text,
      borderRadius: '8px',
      padding: '5px 11px',
      fontSize: '12px',
      cursor: 'pointer',
    }
    // Primary actions invert the foreground/background pair. Using the brand
    // token as a filled background breaks in monochrome themes where brand is
    // white (white text on a white button) — the label/base pair always contrasts.
    const primary = { ...button, background: T.text, color: T.base, borderColor: 'transparent' }
    const input = {
      border: `1px solid ${T.line}`,
      background: T.layer,
      color: T.text,
      borderRadius: '8px',
      padding: '5px 9px',
      fontSize: '12px',
      minWidth: '220px',
      outline: 'none',
    }
    const card = {
      border: `1px solid ${T.line}`,
      borderRadius: '12px',
      background: T.layer,
      padding: '16px 18px',
      marginBottom: '10px',
      cursor: 'pointer',
    }
    const sectionTitle = {
      margin: '22px 0 8px',
      fontSize: '11px',
      letterSpacing: '.08em',
      textTransform: 'uppercase',
      color: T.text3,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '8px',
    }
    const rowLabel = { color: T.text3, fontSize: '11.5px', width: '70px', flex: 'none' }
    const row = { display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 0', fontSize: '12.5px', color: T.text2, borderBottom: `1px solid ${T.line}` }

    function statusMeta(status) {
      return STATUS[status] ?? { label: status, color: T.text2, bg: 'rgba(154,163,174,.14)' }
    }

    function Pill({ status, label }) {
      const meta = statusMeta(status)
      return h(
        'span',
        {
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '11.5px',
            padding: '2px 9px',
            borderRadius: '999px',
            color: meta.color,
            background: meta.bg,
          },
        },
        h('span', { style: { width: '5px', height: '5px', borderRadius: '50%', background: 'currentColor' } }),
        label ?? meta.label,
      )
    }

    function Chip({ children }) {
      return h(
        'span',
        {
          style: {
            fontSize: '11px',
            color: T.text2,
            border: `1px solid ${T.line}`,
            borderRadius: '999px',
            padding: '2px 8px',
          },
        },
        children,
      )
    }

    function VerdictBadge({ verdict }) {
      const meta = VERDICT[verdict] ?? VERDICT.skip
      return h(
        'span',
        {
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            fontSize: '11px',
            color: meta.color,
            background: meta.bg,
            borderRadius: '999px',
            padding: '1px 8px',
            whiteSpace: 'nowrap',
          },
        },
        meta.label,
      )
    }

    function ReviewBlock({ review, showRoles = true }) {
      if (!review) return h('p', { style: { margin: 0, ...muted } }, '暂无评审数据。')
      const summary = review.summary
      return h(
        'div',
        null,
        h(
          'p',
          { style: { margin: '0 0 8px', fontSize: '12.5px', color: summary.blockers > 0 ? T.err : T.text2 } },
          `${summary.completed}/${summary.total} 角色完成 · ${summary.blockers} 个阻塞`,
          review.coverage?.missing?.length
            ? h('span', { style: { color: T.text3 } }, ` · 未覆盖：${review.coverage.missing.join('、')}`)
            : null,
        ),
        showRoles
          ? h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: '5px' } },
              review.roles.map((role) => {
                const meta = VERDICT[role.verdict] ?? VERDICT.skip
                return h(
                  'div',
                  {
                    key: role.id,
                    style: {
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '10px',
                      border: `1px solid ${T.line}`,
                      borderLeft: `3px solid ${meta.color}`,
                      borderRadius: '8px',
                      background: T.layer2,
                      padding: '6px 10px',
                      fontSize: '12.5px',
                      color: T.text2,
                    },
                  },
                  h('span', null, role.label),
                  h(VerdictBadge, { verdict: role.verdict }),
                )
              }),
            )
          : null,
        review.roles.some((role) => role.findings.length)
          ? h(
              'div',
              { style: { marginTop: '8px' } },
              review.roles.flatMap((role) =>
                role.findings.map((finding, index) =>
                  h(
                    'div',
                    {
                      key: `${role.id}-${index}`,
                      style: {
                        borderTop: index === 0 ? 'none' : `1px solid ${T.line}`,
                        padding: '7px 0',
                        fontSize: '12px',
                        lineHeight: 1.7,
                        color: T.text2,
                      },
                    },
                    h(
                      'span',
                      {
                        style: {
                          marginRight: '6px',
                          fontSize: '10.5px',
                          padding: '1px 6px',
                          borderRadius: '5px',
                          color: finding.severity === 'block' ? T.err : T.warn,
                          background: finding.severity === 'block' ? 'rgba(255,139,139,.14)' : 'rgba(231,176,75,.14)',
                        },
                      },
                      finding.severity === 'block' ? '阻塞' : '建议',
                    ),
                    h('b', { style: { color: T.text, fontWeight: 500 } }, `${finding.rule} `),
                    finding.message,
                    finding.file ? h('span', { style: { ...muted, marginLeft: '6px' } }, `${finding.file}${finding.line ? `:${finding.line}` : ''}`) : null,
                  ),
                ),
              ),
            )
          : null,
        review.stored
          ? h('p', { style: { margin: '8px 0 0', ...muted } }, `报告已保存（${review.source}${review.generatedAt ? ` · ${review.generatedAt.slice(0, 19).replace('T', ' ')}` : ''}）`)
          : h('p', { style: { margin: '8px 0 0', ...muted } }, '实时门禁推导结果；运行评审可保存报告。'),
        review.signoff
          ? h(
              'p',
              { style: { margin: '4px 0 0', fontSize: '12px', color: review.signoff.valid ? T.ok : T.err } },
              `人工签收：${review.signoff.actor} · ${review.signoff.valid ? '有效' : '已失效（内容已变化，需重新评审签收）'}`,
            )
          : h('p', { style: { margin: '4px 0 0', ...muted } }, '尚未人工签收。'),
      )
    }

    function DecisionPill({ decision }) {
      return h(
        'span',
        { style: decisionPillStyle(decision) },
        h('span', { style: { width: '5px', height: '5px', borderRadius: '50%', background: 'currentColor', flex: 'none' } }),
        decisionLabel(decision),
      )
    }

    /**
     * Decision summary shown above the requirement background. Tone only colors
     * the bar; label, gap message, fix hint and next step are always text.
     */
    function DecisionBar({ decision }) {
      if (!decision) {
        return h(
          'section',
          {
            style: {
              marginTop: '14px',
              border: `1px dashed ${T.line2}`,
              borderRadius: '12px',
              padding: '12px 14px',
              color: T.text2,
              fontSize: '12.5px',
              lineHeight: 1.8,
            },
          },
          '决策：接口尚未返回 decision；按未知处理，不显示通过。',
        )
      }
      const tone = decisionTone(decision)
      const topGap = decision.topGap
      const policy = decision.policy
      const coverage = decision.coverage
      return h(
        'section',
        {
          'data-decision-state': decision.state,
          style: {
            marginTop: '14px',
            border: `1px solid ${T.line}`,
            borderLeft: `3px solid ${tone.color}`,
            borderRadius: '12px',
            background: T.layer,
            padding: '12px 16px',
          },
        },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: '9px', flexWrap: 'wrap' } },
          h(DecisionPill, { decision }),
          h(
            'span',
            { style: { fontSize: '11.5px', color: T.text3 } },
            `风险 ${policy?.risk ?? '—'} · 角色 ${coverage?.rolesCompleted ?? 0}/${coverage?.rolesRequired ?? 0}`,
          ),
          decision.nextStep
            ? h(
                'span',
                { style: { marginLeft: 'auto', fontSize: '12px', color: T.text2, border: `1px solid ${T.line}`, borderRadius: '999px', padding: '2px 9px' } },
                `下一步 · ${decision.nextStep.label}`,
              )
            : null,
        ),
        topGap
          ? h(
              'div',
              { style: { marginTop: '8px', fontSize: '12.5px', lineHeight: 1.75, color: T.text2 } },
              h('span', { style: { color: tone.color, fontWeight: 600 } }, `缺口 ${topGap.code ?? ''}：`),
              topGap.message,
              topGap.fix
                ? h('div', { style: { marginTop: '2px', color: T.text3, fontSize: '12px' } }, `修复提示：${topGap.fix}`)
                : null,
            )
          : h('p', { style: { margin: '8px 0 0', ...muted } }, '没有未解决的证据缺口。'),
        decision.signoff?.reasons?.length && !decision.signoff.allowed
          ? h(
              'p',
              { style: { margin: '6px 0 0', color: T.text3, fontSize: '11.5px', lineHeight: 1.8 } },
              `签收条件未满足：${decision.signoff.reasons.map((reason) => reason.message).join('；')}`,
            )
          : null,
      )
    }

    function RoleBars({ review, decision }) {
      if (!review?.roles?.length) {
        return h('p', { style: { margin: 0, ...muted } }, '尚未运行评审，没有角色覆盖数据。')
      }
      const coverage = decision?.coverage
      return h(
        'div',
        null,
        h(
          'p',
          { style: { margin: '0 0 8px', ...muted } },
          `角色覆盖 ${coverage?.rolesCompleted ?? review.summary?.completed ?? 0}/${coverage?.rolesRequired ?? review.summary?.total ?? 0}`,
          coverage?.missingRoles?.length ? ` · 缺失：${coverage.missingRoles.join('、')}` : '',
        ),
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: '5px' } },
          review.roles.map((role) => {
            const meta = VERDICT[role.verdict] ?? VERDICT.skip
            return h(
              'div',
              {
                key: role.id,
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '10px',
                  border: `1px solid ${T.line}`,
                  borderLeft: `3px solid ${meta.color}`,
                  borderRadius: '8px',
                  background: T.layer2,
                  padding: '6px 10px',
                  fontSize: '12.5px',
                  color: T.text2,
                },
              },
              h('span', null, role.label),
              h(VerdictBadge, { verdict: role.verdict }),
            )
          }),
        ),
      )
    }

    /** Expandable gap row: rule, file:line, reason and fix suggestion. */
    function GapDetail({ gap, index }) {
      const severity = gapSeverityMeta(gap.severity ?? (gap.rule ? 'block' : 'info'))
      const rule = gap.rule ?? gap.code ?? 'GAP'
      const fileLine = gap.file ? `${gap.file}${gap.line ? `:${gap.line}` : ''}` : null
      return h(
        'details',
        { style: { borderTop: index === 0 ? 'none' : `1px solid ${T.line}` } },
        h(
          'summary',
          { style: { cursor: 'pointer', padding: '7px 0', fontSize: '12.5px', color: T.text2, lineHeight: 1.6 } },
          h(
            'span',
            { style: { display: 'inline-block', marginRight: '7px', fontSize: '10.5px', padding: '1px 6px', borderRadius: '5px', color: severity.color, background: severity.bg } },
            severity.label,
          ),
          h('code', { style: { color: T.text, marginRight: '7px' } }, rule),
          fileLine ? h('span', { style: { color: T.text3, marginRight: '7px' } }, fileLine) : null,
          gap.message,
        ),
        h(
          'div',
          { style: { padding: '0 0 9px 12px', fontSize: '12px', lineHeight: 1.85, color: T.text2 } },
          h('div', null, h('span', { style: { color: T.text3 } }, '原因：'), gap.message),
          h('div', null, h('span', { style: { color: T.text3 } }, '修复建议：'), gap.fix ?? '按规则修复后重新运行检查。'),
          h('div', null, h('span', { style: { color: T.text3 } }, '来源：'), gap.rule ? '门禁 check' : '证据判定'),
          gap.project ? h('div', null, h('span', { style: { color: T.text3 } }, '项目：'), gap.project) : null,
        ),
      )
    }

    function GapsList({ decision }) {
      const gaps = decision?.gaps ?? []
      if (!decision) {
        return h('p', { style: { margin: 0, ...muted } }, '决策数据尚未返回；暂按原始评审与验收数据展示。')
      }
      if (gaps.length === 0) return h('p', { style: { margin: 0, ...muted } }, '没有未解决的证据缺口。')
      return h(
        'div',
        { style: { border: `1px solid ${T.line}`, borderRadius: '10px', padding: '2px 12px' } },
        gaps.map((gap, index) => h(GapDetail, { key: `${gap.code ?? 'gap'}-${index}`, gap, index })),
      )
    }

    /** Acceptance provenance rows; incomplete evidence never reads as a pass. */
    function AcceptanceProvenance({ latest }) {
      if (!latest) return null
      const environment = latest.environment
        ? [latest.environment.platform, latest.environment.arch, latest.environment.node ? `node ${latest.environment.node}` : null, latest.environment.runner]
            .filter(Boolean)
            .join(' · ')
        : '—'
      const rows = [
        ['需求修订', shortHash(latest.requirementHash)],
        ['实现提交', shortHash(latest.headSha, 12)],
        ['测试修订', shortHash(latest.testRevision)],
        ['环境', environment],
        ['时间', latest.finishedAt ? String(latest.finishedAt).slice(0, 19).replace('T', ' ') : '—'],
        ['来源', latest.source ?? '—'],
      ]
      return h(
        'div',
        { style: { marginTop: '8px' } },
        latest.complete === false
          ? h(
              'p',
              { style: { margin: '0 0 6px', color: T.warn, fontSize: '12px' } },
              `来源或版本不完整${latest.missing?.length ? `（缺少：${latest.missing.join('、')}）` : ''}`,
            )
          : null,
        h(
          'div',
          { style: { border: `1px solid ${T.line}`, borderRadius: '10px', padding: '2px 12px' } },
          rows.map(([label, value], index) =>
            h(
              'div',
              { key: label, style: { ...row, fontSize: '12px', borderBottom: index === rows.length - 1 ? 'none' : `1px solid ${T.line}` } },
              h('span', { style: rowLabel }, label),
              h('span', { style: { color: T.text, fontSize: '12px', wordBreak: 'break-all', minWidth: 0 } }, value),
            ),
          ),
        ),
      )
    }

    function AnomalyBlock({ anomalies, summary, onOpen }) {
      const list = anomalies ?? []
      if (list.length === 0) return null
      const counts = summary ?? {}
      const summaryLabel = [
        counts.duplicateId ? `ID 重复 ${counts.duplicateId}` : null,
        counts.duplicateBusinessId ? `业务 ID 重复 ${counts.duplicateBusinessId}` : null,
        counts.dangling ? `悬空关系 ${counts.dangling}` : null,
      ]
        .filter(Boolean)
        .join(' · ')
      return h(
        'section',
        { style: { marginTop: '28px', border: `1px solid ${T.line}`, borderLeft: `3px solid ${T.err}`, borderRadius: '12px', background: T.layer, padding: '14px 16px' } },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' } },
          h('h3', { style: { margin: 0, fontSize: '13.5px', fontWeight: 600, color: T.text } }, `数据异常（${list.length}）`),
          summaryLabel ? h('span', { style: muted }, summaryLabel) : null,
        ),
        h(
          'p',
          { style: { margin: '6px 0 10px', fontSize: '12.5px', color: T.text2, lineHeight: 1.8 } },
          '这些记录不会自动修复：保留两条记录、不自动合并；点击条目打开对应需求后人工核对。',
        ),
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
          list.map((anomaly, index) =>
            h(
              'div',
              { key: `${anomaly.kind}-${index}`, style: { border: `1px solid ${T.line}`, borderRadius: '10px', padding: '9px 11px' } },
              h(
                'div',
                { style: { display: 'flex', gap: '8px', alignItems: 'baseline', flexWrap: 'wrap', fontSize: '12.5px', color: T.text2 } },
                h('span', { style: { color: T.err, fontSize: '11px', border: `1px solid ${T.line2}`, borderRadius: '5px', padding: '0 6px' } }, ANOMALY_LABELS[anomaly.kind] ?? anomaly.kind),
                anomaly.message,
              ),
              anomaly.occurrences?.length
                ? h(
                    'div',
                    { style: { display: 'flex', flexDirection: 'column', gap: '3px', marginTop: '6px' } },
                    anomaly.occurrences.map((occurrence, occurrenceIndex) =>
                      h(
                        'button',
                        {
                          type: 'button',
                          key: `${occurrence.occurrenceKey ?? occurrenceIndex}-${occurrenceIndex}`,
                          title: '打开对应需求',
                          onClick: () => onOpen?.(occurrence),
                          style: { display: 'flex', gap: '8px', alignItems: 'baseline', flexWrap: 'wrap', textAlign: 'left', border: 0, background: 'transparent', color: T.text2, padding: '2px 0', fontSize: '12px', cursor: 'pointer' },
                        },
                        h('code', { style: { color: T.brand } }, occurrence.assetId ?? occurrence.id ?? occurrence.occurrenceKey ?? '—'),
                        occurrence.title ? h('span', null, occurrence.title) : null,
                        h(
                          'span',
                          { style: { color: T.text3 } },
                          `${occurrence.file ?? anomaly.file ?? '—'}${(occurrence.line ?? anomaly.line) ? `:${occurrence.line ?? anomaly.line}` : ''}`,
                        ),
                      ),
                    ),
                  )
                : h(
                    'button',
                    {
                      type: 'button',
                      onClick: () => onOpen?.({ assetId: anomaly.requirementIds?.[0], file: anomaly.file, line: anomaly.line }),
                      style: { marginTop: '4px', border: 0, background: 'transparent', color: T.brand, padding: 0, fontSize: '12px', cursor: 'pointer' },
                    },
                    `${anomaly.ref ?? anomaly.file ?? '—'}${anomaly.line ? `:${anomaly.line}` : ''} · 打开需求`,
                  ),
            ),
          ),
        ),
      )
    }

    function ReviewModal({ item, root, onClose, onDone }) {
      const [state, setState] = useState({ loading: true, plan: null, result: null, error: null, saving: false })
      const load = useCallback(() => {
        setState({ loading: true, plan: null, result: null, error: null, saving: false })
        writeJson('review', { requirementId: item.id }, root)
          .then((plan) => setState({ loading: false, plan, result: null, error: null, saving: false }))
          .catch((error) => setState({ loading: false, plan: null, result: null, error: error.message, saving: false }))
      }, [item.id, root])
      useEffect(() => {
        load()
      }, [load])
      const save = () => {
        setState((current) => ({ ...current, saving: true, error: null }))
        writeJson('review', { requirementId: item.id, apply: true }, root)
          .then((result) => {
            setState({ loading: false, plan: null, result, error: null, saving: false })
            onDone?.()
          })
          .catch((error) => setState((current) => ({ ...current, saving: false, error: error.message })))
      }
      const review = state.result ?? state.plan
      return h(
        ModalShell,
        {
          title: `运行评审 · ${item.id}`,
          lead: '执行五角色门禁评审并生成报告（.alm/reviews/<REQ>.json）；预览不写文件，保存后才持久化。',
          onClose,
          width: '760px',
          footer: [
            h('button', { key: 'close', style: state.result ? primary : button, onClick: onClose }, '关闭'),
            state.plan && !state.result
              ? h('button', { key: 'save', style: primary, onClick: save, disabled: state.saving }, state.saving ? '保存中…' : '保存评审报告')
              : null,
          ],
        },
        state.loading ? h('p', { style: muted }, '正在执行评审…') : null,
        state.error ? h('p', { style: { margin: 0, color: T.err, fontSize: '13px' } }, state.error) : null,
        review ? h('div', null, h(ReviewBlock, { review: { ...review, stored: Boolean(state.result) } })) : null,
      )
    }

    function SignoffModal({ item, root, onClose, onDone }) {
      const [actor, setActor] = useState('human:peterzhanghao')
      const [state, setState] = useState({ loading: false, result: null, error: null })
      const decision = item.decision ?? null
      const signoffReasons = decision?.signoff?.reasons ?? []
      const submit = () => {
        if (state.loading) return
        setState({ loading: true, result: null, error: null })
        writeJson('signoff', { requirementId: item.id, actor, apply: true }, root)
          .then((result) => {
            setState({ loading: false, result, error: null })
            onDone?.()
          })
          .catch((error) => setState({ loading: false, result: null, error: error.message }))
      }
      return h(
        ModalShell,
        {
          title: `人工签收 · ${item.id}`,
          lead: '签收绑定当前版本内容哈希；内容变化后自动失效，需重新评审并签收。',
          onClose,
          width: '620px',
          footer: [
            h('button', { key: 'close', style: state.result ? primary : button, onClick: onClose }, '关闭'),
            state.result ? null : h('button', { key: 'sign', style: primary, onClick: submit }, state.loading ? '签收中…' : '确认签收'),
          ],
        },
        h(
          'div',
          { style: { marginTop: '12px', border: `1px solid ${T.line}`, borderRadius: '10px', padding: '10px 12px', fontSize: '12px', lineHeight: 1.8, color: T.text2 } },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
            decision ? h(DecisionPill, { decision }) : h('span', { style: muted }, '决策数据尚未返回'),
            decision?.topGap ? h('span', null, decision.topGap.message) : null,
          ),
          signoffReasons.length
            ? h(
                'ul',
                { style: { margin: '6px 0 0', paddingLeft: '20px' } },
                signoffReasons.map((reason, index) =>
                  h('li', { key: `${reason.code ?? 'reason'}-${index}` }, h('code', { style: { color: T.text, marginRight: '6px' } }, reason.code ?? 'reason'), reason.message),
                ),
              )
            : h('div', { style: { marginTop: '4px', color: T.text3 } }, '后端会按当前证据判定是否允许签收；前端不做假校验，提交后以后端错误为准。'),
        ),
        h(
          'label',
          { style: { display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', color: T.text2, marginTop: '12px' } },
          '签收人（human:<login>）',
          h('input', { style: input, value: actor, onChange: (event) => setActor(event.target.value) }),
        ),
        state.error ? h('p', { style: { margin: '10px 0 0', color: T.err, fontSize: '12.5px' } }, state.error) : null,
        state.result
          ? h(
              'div',
              { style: { marginTop: '12px' } },
              h(PlanRows, {
                rows: [
                  ['签收人', state.result.signoff.actor],
                  ['内容哈希', state.result.signoff.contentHash.slice(0, 16)],
                  ['状态', state.result.alreadySigned ? '已签收（同一内容）' : '签收成功'],
                ],
              }),
            )
          : null,
      )
    }

    function VersionList({ item, onSnapshot, onDiff, compact }) {
      const versions = item.versions ?? []
      return h(
        'div',
        null,
        h(
          'div',
          { style: { ...row, paddingTop: 0 } },
          h('span', { style: rowLabel }, '当前修订'),
          h('span', { style: { color: T.text } }, `v${item.revision ?? 1}（最新）`),
        ),
        versions.length === 0
          ? h('p', { style: { margin: '6px 0 0', ...muted } }, '没有 git 历史（工作区可能不是 git 仓库）。')
          : h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
              versions.map((version) =>
                h(
                  'div',
                  {
                    key: version.sha,
                    style: { display: 'flex', alignItems: 'baseline', gap: '8px', borderTop: `1px solid ${T.line}`, padding: '4px 0' },
                  },
                  h(
                    'button',
                    {
                      'data-version-sha': version.sha,
                      onClick: () => onSnapshot(item, version),
                      style: {
                        display: 'flex',
                        alignItems: 'baseline',
                        gap: '8px',
                        flex: 1,
                        minWidth: 0,
                        textAlign: 'left',
                        border: 0,
                        background: 'transparent',
                        color: T.text2,
                        padding: '1px 0',
                        fontSize: '12px',
                        cursor: 'pointer',
                        lineHeight: 1.6,
                      },
                    },
                    h('span', { style: { color: T.text3, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '11px', flex: 'none' } }, version.short),
                    h('span', { style: { color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, version.subject),
                  ),
                  h('span', { style: { color: T.text3, fontSize: '11px', flex: 'none' } }, version.date?.slice(0, 10)),
                  onDiff
                    ? h(
                        'button',
                        {
                          'data-diff-sha': version.sha,
                          onClick: () => onDiff(item, version),
                          style: { border: 0, background: 'transparent', color: T.brand, padding: 0, fontSize: '11px', cursor: 'pointer', flex: 'none' },
                        },
                        '对比当前',
                      )
                    : null,
                ),
              ),
            ),
        compact ? null : h('p', { style: { margin: '8px 0 0', ...muted } }, '只读快照 / 对比：读取提交时的需求文件，不改动工作区。'),
      )
    }

    function DiffModal({ state, onClose }) {
      const { item, version, data, loading, error } = state
      const fieldRow = (field) =>
        h(
          'div',
          { key: field.field, style: { ...row, alignItems: 'baseline' } },
          h('span', { style: { ...rowLabel, width: '110px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '11px' } }, field.field),
          h('span', { style: { color: T.text2, textDecoration: 'line-through', wordBreak: 'break-word' } }, field.from === null ? '（无）' : field.from),
          h('span', { style: { color: T.text3, flex: 'none' } }, '→'),
          h('span', { style: { color: T.ok, wordBreak: 'break-word' } }, field.to === null ? '（删除）' : field.to),
        )
      return h(
        ModalShell,
        {
          title: `版本对比 · ${item.id}`,
          lead: `${version.short}（${version.date?.slice(0, 10) ?? ''}）→ 当前工作区；只读，不改动工作区。`,
          onClose,
          width: '820px',
          footer: [h('button', { key: 'close', style: primary, onClick: onClose }, '关闭')],
        },
        loading ? h('p', { style: muted }, '正在对比版本…') : null,
        error ? h('p', { style: { margin: 0, color: T.err, fontSize: '13px' } }, error) : null,
        data
          ? h(
              'div',
              null,
              h(PlanRows, {
                rows: [
                  ['变更字段', `${data.summary.changedFields}`],
                  ['新增关系', `${data.summary.addedRelations}`],
                  ['移除关系', `${data.summary.removedRelations}`],
                  ['文件', data.file],
                ],
              }),
              data.fields.length
                ? h(
                    'div',
                    { style: { marginTop: '12px', border: `1px solid ${T.line}`, borderRadius: '10px', padding: '4px 12px' } },
                    data.fields.map(fieldRow),
                  )
                : h('p', { style: { margin: '12px 0 0', ...muted } }, '字段无变化。'),
              data.relations.added.length || data.relations.removed.length
                ? h(
                    'div',
                    { style: { marginTop: '12px', fontSize: '12.5px', color: T.text2, lineHeight: 1.9 } },
                    data.relations.added.map((key) => h('div', { key: `add-${key}`, style: { color: T.ok } }, `+ ${key.replace('|', ' → ')}`)),
                    data.relations.removed.map((key) => h('div', { key: `remove-${key}`, style: { color: T.err } }, `- ${key.replace('|', ' → ')}`)),
                  )
                : h('p', { style: { margin: '10px 0 0', ...muted } }, '关系无变化。'),
            )
          : null,
      )
    }

    function nextPrompt(item, root) {
      const at = root ? ` --root "${root}"` : ''
      if (item.nextAction === 'missing-acceptance') {
        return `请为 ${item.id} 补验收：在 tests/ 下新增 TEST-* 资产，并在需求里加 verified_by 关系；然后运行 node packages/alm-core/bin/alm.mjs check${at} 确认 COV-001 通过。`
      }
      if (item.nextAction === 'dangling-relation') {
        return `请修复 ${item.id} 的关系：先看 alm check${at} 里 REL-001 的 file:line，补建目标资产或删除悬空关系，再重跑门禁。`
      }
      if (item.nextAction === 'ready-to-change') {
        return `请为 ${item.id} 发起变更：先读 docs/planning/skill-plan.md 与 alm-change-workflow 技能，用 alm workspace create --baseline <sha> --change CHG-<DOMAIN>-<NNN> 建工作区，再改资产并跑 alm check${at}。`
      }
      return `请评估 ${item.id} 的影响面：运行 node packages/alm-core/bin/alm.mjs impact --asset ${item.id}${at}，并检查是否需要更新基线。`
    }

    function CopyPrompt({ text }) {
      const [state, setState] = useState('idle')
      const copy = useCallback(async () => {
        try {
          await navigator.clipboard.writeText(text)
          setState('copied')
        } catch {
          setState('failed')
        }
        setTimeout(() => setState('idle'), 1800)
      }, [text])
      return h(
        'div',
        { style: { marginTop: '10px' } },
        h('button', { style: button, onClick: copy }, state === 'copied' ? '已复制' : state === 'failed' ? '复制失败，请手动选择' : '复制提示词'),
        h(
          'pre',
          {
            style: {
              margin: '8px 0 0',
              padding: '10px',
              fontSize: '12px',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              background: T.base,
              border: `1px solid ${T.line}`,
              borderRadius: '8px',
            },
          },
          text,
        ),
      )
    }

    function useRequirements({ root, projectId }) {
      const [state, setState] = useState({ loading: true, error: null, data: null })
      const load = useCallback(() => {
        setState({ loading: true, error: null, data: null })
        const query =
          projectId === ALL_PROJECTS
            ? '?project=ALL'
            : root
              ? `?root=${encodeURIComponent(root)}`
              : ''
        fetch(`/api/alm/requirements${query}`, { headers: { accept: 'application/json' } })
          .then(async (response) => {
            const body = await response.json()
            if (!response.ok || body.ok === false) {
              throw new Error(body?.error?.message ?? body?.error ?? `HTTP ${response.status}`)
            }
            setState({ loading: false, error: null, data: body })
          })
          .catch((error) => setState({ loading: false, error: error.message, data: null }))
      }, [root, projectId])
      useEffect(() => {
        load()
      }, [load])
      return { ...state, reload: load }
    }

    function ProjectPicker({ projects, currentId, onPick }) {
      if (!projects || projects.length === 0) return null
      return h(
        'label',
        { style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: T.text2 } },
        '工作区',
        h(
          'select',
          { style: input, value: currentId ?? '', onChange: (event) => onPick(event.target.value), 'aria-label': '选择工作区项目' },
          h('option', { value: '' }, '选择工作区…'),
          h('option', { value: ALL_PROJECTS }, '全部项目（聚合）'),
          projects.map((project) =>
            h(
              'option',
              { key: project.id, value: project.id, disabled: project.exists === false },
              `${project.title}${project.linked ? `（${project.projectId}）` : ' · 未关联仓库'}${project.exists === false ? ' · 路径缺失' : ''}`,
            ),
          ),
        ),
      )
    }

    function RootPicker({ rootInput, setRootInput, onApply, onReset }) {
      return h(
        'form',
        {
          style: { display: 'flex', gap: '8px', alignItems: 'center', margin: '4px 0 16px', flexWrap: 'wrap' },
          onSubmit: (event) => {
            event.preventDefault()
            onApply()
          },
        },
        h('span', { style: muted }, '仓库根'),
        h('input', {
          style: input,
          value: rootInput,
          placeholder: '默认 fixtures/order-refund',
          onChange: (event) => setRootInput(event.target.value),
        }),
        h('button', { style: button, type: 'submit' }, '加载'),
        h('button', { style: button, type: 'button', onClick: onReset }, '恢复默认'),
      )
    }

    function RequirementCard({ item, showProject, onOpen }) {
      const meta = []
      if (item.owner) meta.push(item.owner)
      if (item.priority) meta.push(item.priority)
      if (item.attachments) meta.push(`${item.attachments} 个附件`)
      if (item.verifiedBy?.length) meta.push(`验收已关联 ${item.verifiedBy.length} 项`)
      if (item.sources?.length) meta.push(item.sources.join(' / '))
      if (item.github?.board?.status) meta.push(`看板 ${item.github.board.status}`)
      const decision = item.decision ?? null
      const decisionNext = decision?.nextStep?.label ?? null
      const occurrenceKey = item.occurrenceKey ?? item.id

      return h(
        'article',
        {
          style: card,
          role: 'button',
          tabIndex: 0,
          'data-req': occurrenceKey,
          onClick: () => onOpen(item),
          onKeyDown: (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              onOpen(item)
            }
          },
          onMouseEnter: (event) => {
            event.currentTarget.style.borderColor = T.line2
            event.currentTarget.style.background = T.layer2
          },
          onMouseLeave: (event) => {
            event.currentTarget.style.borderColor = T.line
            event.currentTarget.style.background = T.layer
          },
        },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px' } },
          h(
            'div',
            { style: { minWidth: 0 } },
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '6px' } },
              h(Pill, { status: item.status }),
              h('span', { style: { color: T.text3, fontSize: '11.5px' } }, item.id),
              h(
                'span',
                {
                  style: {
                    color: T.text3,
                    fontSize: '11px',
                    border: `1px solid ${T.line}`,
                    borderRadius: '5px',
                    padding: '0 5px',
                  },
                },
                `v${item.revision ?? 1}`,
              ),
              showProject && item.project
                ? h(
                    'span',
                    {
                      style: {
                        fontSize: '10.5px',
                        letterSpacing: '.04em',
                        color: T.brand,
                        border: '1px solid rgba(110,160,255,.4)',
                        borderRadius: '5px',
                        padding: '0 5px',
                      },
                    },
                    item.project,
                  )
                : null,
              item.github
                ? h(
                    'span',
                    {
                      style: { color: T.text3, border: `1px solid ${T.line}`, borderRadius: '5px', padding: '0 5px', fontSize: '10.5px' },
                      title: `GitHub Issue #${item.github.issue}`,
                    },
                    `#${item.github.issue}`,
                  )
                : null,
            ),
            h('h3', { style: { margin: 0, fontSize: '15.5px', fontWeight: 600, lineHeight: 1.5, letterSpacing: '-.01em' } }, item.title),
            h('p', { style: { margin: '7px 0 0', ...muted } }, meta.join(' · ')),
            decision
              ? h(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '8px' } },
                  h(DecisionPill, { decision }),
                  decision.topGap ? h('span', { style: { fontSize: '12px', color: T.text2, minWidth: 0 } }, decision.topGap.message) : null,
                  decisionNext ? h('span', { style: { fontSize: '11.5px', color: T.text3 } }, `下一步 · ${decisionNext}`) : null,
                )
              : null,
          ),
          h(
            'span',
            {
              style: {
                flex: 'none',
                fontSize: '12px',
                color: T.text2,
                border: `1px solid ${T.line}`,
                borderRadius: '8px',
                padding: '5px 11px',
                marginTop: '2px',
              },
            },
            '查看',
          ),
        ),
      )
    }

    /**
     * Lightweight markdown rendering for brief files: headings, bullets and
     * paragraphs only. The brief is human narrative, not a full markdown engine.
     */
    function renderBrief(text) {
      if (!text) return null
      const blocks = []
      let list = null
      const flush = () => {
        if (!list) return
        blocks.push(
          h(
            'ul',
            { key: `ul-${blocks.length}`, style: { margin: '2px 0 8px', paddingLeft: '18px', color: T.text2, fontSize: '13px', lineHeight: 1.85 } },
            list,
          ),
        )
        list = null
      }
      text.split(/\r?\n/).forEach((line, index) => {
        const trimmed = line.trim()
        if (!trimmed) {
          flush()
          return
        }
        if (trimmed.startsWith('- ')) {
          if (!list) list = []
          list.push(h('li', { key: index }, trimmed.slice(2)))
          return
        }
        flush()
        const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed)
        if (heading) {
          if (heading[1].length === 1) return
          blocks.push(
            h(
              'div',
              { key: index, style: { margin: '14px 0 6px', fontSize: '13px', fontWeight: 600, color: T.text } },
              heading[2],
            ),
          )
          return
        }
        blocks.push(h('p', { key: index, style: { margin: '0 0 6px', color: T.text2, fontSize: '13px', lineHeight: 1.85 } }, trimmed))
      })
      flush()
      return h('div', null, blocks)
    }

    function Section({ title, action, children, style }) {
      return h(
        'div',
        { style },
        h('div', { style: sectionTitle }, title, action ?? null),
        children,
      )
    }

    function GithubBlock({ item, projectMeta }) {
      const projectName = projectMeta?.name ?? item.projectName ?? item.project ?? '未归属项目'
      const repo = item.github?.repo ?? projectMeta?.repo ?? '—'
      if (!item.github) {
        return h(
          'div',
          {
            style: {
              border: `1px dashed ${T.line2}`,
              borderRadius: '10px',
              padding: '12px 14px',
              fontSize: '12.5px',
              color: T.text2,
              lineHeight: 1.8,
            },
          },
          h('div', null, '尚未建立 GitHub 归属：需求 Issue、任务子议题与看板条目会在「开始开发」时按项目配置创建。'),
          h('div', { style: { ...muted, marginTop: '6px' } }, `${projectName} · ${repo}${projectMeta?.board ? ` · ProjectV2 #${projectMeta.board}` : ''}`),
        )
      }
      const labels = item.github.labels ?? []
      const board = item.github.board
      return h(
        'div',
        { style: { border: `1px solid ${T.line}`, borderRadius: '10px', overflow: 'hidden' } },
        [
          ['仓库', h('span', { style: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '11.5px' } }, repo)],
          [
            '需求 Issue',
            h(
              'span',
              null,
              item.github.url
                ? h('a', { href: item.github.url, target: '_blank', rel: 'noreferrer', style: { color: T.brand } }, `#${item.github.issue}`)
                : `#${item.github.issue}`,
              ` · [${item.id}] ${item.title}`,
            ),
          ],
          ['标签', h('span', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } }, labels.map((label) => h(Chip, { key: label }, label)))],
          [
            '看板',
            h(
              'span',
              null,
              board ? `ProjectV2 #${board.number}` : '未配置看板',
              board?.status ? h('span', { style: { marginLeft: '8px', color: T.ok } }, `· ${board.status}`) : null,
            ),
          ],
          [
            '任务子议题',
            h(
              'span',
              null,
              (item.github.tasks ?? []).length
                ? item.github.tasks.map((task) => `#${task.number}`).join(' · ')
                : '尚未创建（开始开发时生成）',
              item.github.tasks?.length ? h('span', { style: { ...muted, marginLeft: '6px' } }, `（parent #${item.github.issue}）`) : null,
            ),
          ],
          [
            'PR / 交付',
            h('span', { style: muted }, '尚未关联 PR；PR 模板要求填写项目 / 需求 Issue / 变更 / 看板状态'),
          ],
        ].map(([label, value], index) =>
          h('div', { key: label, style: { ...row, borderBottom: index === 5 ? 'none' : `1px solid ${T.line}` } }, h('span', { style: rowLabel }, label), h('span', { style: { color: T.text, minWidth: 0 } }, value)),
        ),
      )
    }

    function relationsOf(item, allItems) {
      const groups = [
        ['上级', []],
        ['子需求', []],
        ['验收', []],
        ['依赖', []],
        ['约束', []],
        ['分配到', []],
      ]
      const byLabel = Object.fromEntries(groups)
      for (const other of allItems ?? []) {
        if (other.id === item.id) continue
        if ((other.links ?? []).some((link) => link.type === 'parent_of' && link.target === item.id)) byLabel['上级'].push(other.id)
      }
      for (const link of item.links ?? []) {
        const label = REL_LABELS[link.type] ?? link.type
        if (label === '子需求') byLabel['子需求'].push(link.target)
        else if (label === '验收') byLabel['验收'].push(link.target)
        else if (label === '依赖') byLabel['依赖'].push(link.target)
        else if (label === '约束') byLabel['约束'].push(link.target)
        else if (label === '分配到') byLabel['分配到'].push(link.target)
        else if (!byLabel[label]) byLabel[label] = [link.target]
      }
      return groups.filter(([, items]) => items.length > 0)
    }

    function Attachments({ item }) {
      const files = item.attachmentFiles ?? []
      if (files.length === 0) return h('p', { style: { ...muted, margin: '4px 0 0' } }, '无附件')
      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '6px' } },
        files.map((file) =>
          h(
            'div',
            {
              key: file.name,
              style: {
                display: 'flex',
                justifyContent: 'space-between',
                gap: '10px',
                border: `1px solid ${T.line}`,
                borderRadius: '8px',
                padding: '6px 10px',
                fontSize: '12px',
                color: T.text2,
              },
            },
            h('span', null, file.name),
            h('span', { style: { color: T.text3 } }, file.kind ?? '附件'),
          ),
        ),
      )
    }

    function TraceLink({ onClick }) {
      return h(
        'button',
        { style: { border: 0, background: 'transparent', color: T.text2, padding: 0, fontSize: '11.5px', cursor: 'pointer' }, onClick },
        '查看追溯图 ›',
      )
    }

    function GroupCard({ title, hint, accent, children }) {
      return h(
        'section',
        {
          style: {
            marginTop: '14px',
            border: `1px solid ${T.line}`,
            borderLeft: `2px solid ${accent}`,
            borderRadius: '12px',
            background: T.layer,
            padding: '13px 16px 15px',
          },
        },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '10px', marginBottom: '10px' } },
          h('div', { style: { fontSize: '12.5px', fontWeight: 600, color: T.text2, letterSpacing: '.01em' } }, title),
          hint ?? null,
        ),
        children,
      )
    }

    function SubBlock({ title, action, children, first = false }) {
      return h(
        'div',
        { style: { marginTop: first ? 0 : 12, paddingTop: first ? 0 : 12, borderTop: first ? 0 : `1px solid ${T.line}` } },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '7px' } },
          h('span', { style: { fontSize: '10.5px', letterSpacing: '.08em', textTransform: 'uppercase', color: T.text3 } }, title),
          action ?? null,
        ),
        children,
      )
    }

    function MetaChip({ children, color }) {
      return h(
        'span',
        {
          style: {
            border: `1px solid ${T.line}`,
            borderRadius: '999px',
            padding: '1px 9px',
            fontSize: '11.5px',
            color: color ?? T.text2,
            background: T.layer2,
            whiteSpace: 'nowrap',
          },
        },
        children,
      )
    }

    const ICON_PATHS = {
      sparkles: 'M12 3l1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7z',
      play: 'M8 5v14l11-7z',
      check: 'M20 6L9 17l-5-5',
      flask: 'M9 3h6M10 3v5l-5 9a2 2 0 002 3h10a2 2 0 002-3l-5-9V3',
      eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z M12 9a3 3 0 100 6 3 3 0 000-6z',
      close: 'M6 6l12 12M18 6L6 18',
    }

    function ActionIcon({ name, size = 14 }) {
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
        h('path', { d: ICON_PATHS[name] ?? ICON_PATHS.sparkles }),
      )
    }

    /** One visual language for every action: icon + label, never a bare text link. */
    function ActionButton({ label, icon, onClick, variant = 'secondary', disabled = false, title }) {
      const variants = {
        primary: { background: T.text, color: T.base, borderColor: 'transparent' },
        secondary: { background: T.layer2, color: T.text, borderColor: T.line2 },
        ghost: { background: 'transparent', color: T.text2, borderColor: T.line2 },
        accent: { background: 'rgba(231,176,75,.12)', color: T.warn, borderColor: 'rgba(231,176,75,.32)' },
      }
      return h(
        'button',
        {
          type: 'button',
          title: title ?? label,
          disabled,
          onClick,
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            padding: '6px 12px',
            borderRadius: '8px',
            border: '1px solid',
            fontSize: '12px',
            fontWeight: 500,
            lineHeight: 1.4,
            whiteSpace: 'nowrap',
            cursor: disabled ? 'default' : 'pointer',
            opacity: disabled ? 0.5 : 1,
            ...(variants[variant] ?? variants.secondary),
          },
        },
        icon ? h(ActionIcon, { name: icon }) : null,
        label,
      )
    }

    function DrawerContent({ item, allItems, projectMeta, root, onDetail, onClose, onSnapshot, onTrace, onStart, onAccept, onAcceptance, onDiff, onAiReview, onRehearsal, compact }) {
      const relations = relationsOf(item, allItems)
      const priorityColor = item.priority === 'P0' ? T.err : item.priority === 'P1' ? T.warn : T.text2
      const review = item.review
      const decision = item.decision ?? null
      const reviewHint = decision
        ? h('span', { style: { color: decisionTone(decision).color, fontSize: '11.5px' } }, decisionLabel(decision))
        : review?.summary
          ? h('span', { style: { color: review.summary.blockers > 0 ? T.err : T.text2, fontSize: '11.5px' } }, `${review.summary.completed}/${review.summary.total} 角色 · ${review.summary.blockers} 阻塞`)
          : null
      return h(
        'div',
        null,
        h(
          'div',
          {
            style: {
              position: 'sticky',
              top: 0,
              zIndex: 2,
              background: T.base,
              borderBottom: `1px solid ${T.line}`,
              padding: compact ? '18px 22px 14px' : '22px 26px 16px',
            },
          },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
            h(Pill, { status: item.status }),
            h('span', { style: { color: T.text3, fontSize: '11.5px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' } }, item.id),
            h('span', { style: { color: T.text3, fontSize: '11px', border: `1px solid ${T.line}`, borderRadius: '5px', padding: '0 5px' } }, `v${item.revision ?? 1}`),
            h('span', { style: { marginLeft: 'auto' } }, h('button', { style: { ...button, borderColor: 'transparent', background: 'transparent', color: T.text2 }, onClick: onClose, 'aria-label': '关闭' }, '×')),
          ),
          h('h2', { style: { margin: '10px 0 0', fontSize: '22px', lineHeight: 1.4, letterSpacing: '-.012em' } }, item.title),
          h(
            'div',
            { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '10px' } },
            item.owner ? h(MetaChip, null, item.owner) : null,
            item.priority ? h(MetaChip, { color: priorityColor }, item.priority) : null,
            h(MetaChip, null, `${item.projectName ?? item.project ?? '未归属项目'}${item.project ? `（${item.project}）` : ''}`),
          ),
        ),
        h(
          'div',
          { style: { padding: compact ? '4px 22px 28px' : '4px 26px 34px' } },
          h(DecisionBar, { decision }),
          h(
            GroupCard,
            { title: '需求背景', accent: T.brand, hint: item.brief ? h('span', { style: { ...muted } }, item.brief) : null },
            item.briefText
              ? renderBrief(item.briefText)
              : h('p', { style: { margin: 0, color: T.text2, fontSize: '13.5px', lineHeight: 1.85 } }, item.brief ? `见 ${item.brief}` : '未填写背景。'),
            item.sources?.length ? h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px' } }, item.sources.map((source) => h(Chip, { key: source }, `来源 · ${source}`))) : null,
            h(Attachments, { item }),
          ),
          h(
            GroupCard,
            { title: '质量与验收', accent: T.ok, hint: reviewHint },
            h(
              SubBlock,
              { title: '证据缺口', first: true },
              h(GapsList, { decision }),
            ),
            h(
              SubBlock,
              { title: `验收覆盖（${item.verifiedBy?.length ?? 0}）` },
              (item.verifiedBy ?? []).length
                ? h(
                    'div',
                    { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } },
                    item.verifiedBy.map((id) => {
                      const green = stateIsGreen(decision)
                      return h(MetaChip, { key: id, color: green ? T.ok : T.text2 }, green ? `✓ ${id}` : `已关联 ${id}`)
                    }),
                  )
                : h('p', { style: { margin: 0, color: T.warn, fontSize: '12.5px' } }, '没有 verified_by，COV-001 会失败。'),
            ),
            h(SubBlock, { title: '角色覆盖' }, h(RoleBars, { review, decision })),
            h(
              SubBlock,
              {
                title: '评审',
                action: h(
                  'div',
                  { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
                  h(ActionButton, { label: item.aiReview?.adopted ? '重新评审' : 'AI 评审', icon: 'sparkles', variant: 'primary', onClick: () => onAiReview(item) }),
                  h(ActionButton, { label: '变更试演', icon: 'flask', variant: 'secondary', onClick: () => onRehearsal(item) }),
                ),
              },
              h(ReviewBlock, { review, showRoles: false }),
              h(
                'div',
                { style: { marginTop: '8px', fontSize: '12px', lineHeight: 1.7 } },
                item.aiReview?.stored
                  ? h('span', { style: { color: item.aiReview.verdict === 'block' ? T.err : item.aiReview.verdict === 'pass' ? T.ok : T.warn } }, `AI 评审：${item.aiReview.verdict} · ${item.aiReview.suggestions} 条建议${item.aiReview.adopted ? ' · 已采纳' : ''}`)
                  : h('span', { style: muted }, 'AI 尚未参与评审，可生成评审与重构方案。'),
                h(
                  'div',
                  { style: { ...muted, marginTop: '2px' } },
                  item.review?.signoff?.actor?.startsWith?.('ai:')
                    ? '采纳 AI 评审即视为评审通过，无需人工签收；验收证据仍需独立门禁。'
                    : '采纳 AI 评审即视为评审通过，无需人工签收。',
                ),
              ),
            ),
            h(
              SubBlock,
              { title: '验收执行', action: h(ActionButton, { label: '运行验收', icon: 'play', variant: 'secondary', onClick: () => onAcceptance(item) }) },
              item.acceptance?.registered
                ? h(
                    'div',
                    null,
                    h('div', { style: row }, h('span', { style: rowLabel }, '登记命令'), h('span', { style: { color: T.text } }, `${item.acceptance.commandCount} 条`)),
                    h(
                      'div',
                      { style: row },
                      h('span', { style: rowLabel }, '最近证据'),
                      item.acceptance.latest
                        ? h(
                            'span',
                            { style: { color: item.acceptance.latest.result === 'pass' ? T.ok : T.err } },
                            `${item.acceptance.latest.result} · ${shortHash(item.acceptance.latest.headSha, 8)}${item.acceptance.latest.current ? ' · 当前提交' : ' · 历史提交'}${item.acceptance.latest.complete === false ? ' · 来源不完整' : ''}`,
                          )
                        : h('span', { style: muted }, '尚未运行'),
                    ),
                  )
                : h('p', { style: { margin: 0, ...muted } }, '未登记验收命令（.alm/acceptance/<REQ>.json，白名单 node / npm / pnpm）。'),
              h(AcceptanceProvenance, { latest: item.acceptance?.latest }),
            ),
          ),
          h(
            GroupCard,
            { title: '归属、关系与历史', accent: T.line2 },
            h(
              SubBlock,
              { title: '关系', first: true, action: h(TraceLink, { onClick: () => onTrace(item) }) },
              relations.length
                ? h('div', null, relations.map(([label, ids]) => h('div', { key: label, style: row }, h('span', { style: rowLabel }, label), h('span', { style: { color: T.text } }, ids.join('、')))))
                : h('p', { style: { margin: 0, ...muted } }, '暂无关系。'),
            ),
            h(SubBlock, { title: 'GitHub 归属' }, h(GithubBlock, { item, projectMeta })),
            h(SubBlock, { title: '历史' }, h(VersionList, { item, onSnapshot, onDiff })),
          ),
          h(
            'details',
            { style: { marginTop: '18px', borderTop: `1px solid ${T.line}`, paddingTop: '12px' } },
            h('summary', { style: { cursor: 'pointer', color: T.text2, fontSize: '12.5px' } }, '技术详情'),
            h(
              'div',
              { style: { marginTop: '10px', color: T.text2, fontSize: '12px', lineHeight: 1.9 } },
              h('div', null, h('code', { style: { color: T.text } }, `${item.file}${item.line ? `:${item.line}` : ''}`)),
              item.brief ? h('div', null, '简报：', h('code', { style: { color: T.text } }, item.brief)) : null,
              h('div', null, `门禁提示词：${item.nextActionLabel ?? item.nextAction}`),
            ),
            h(CopyPrompt, { text: nextPrompt(item, root) }),
          ),
          h(
            'div',
            {
              style: {
                position: 'sticky',
                bottom: 0,
                zIndex: 2,
                display: 'flex',
                gap: '10px',
                marginTop: '20px',
                flexWrap: 'wrap',
                padding: '12px 0 6px',
                background: T.base,
                borderTop: `1px solid ${T.line}`,
              },
            },
            h(ActionButton, { label: '开始开发', icon: 'play', variant: 'primary', onClick: () => onStart(item) }),
            h(ActionButton, { label: '运行门禁检查', icon: 'check', variant: 'secondary', onClick: () => onAccept(item) }),
            h(ActionButton, { label: '变更试演', icon: 'flask', variant: 'secondary', onClick: () => onRehearsal(item) }),
            h(ActionButton, { label: '查看详情', icon: 'eye', variant: 'ghost', onClick: () => onDetail(item) }),
            onClose ? h(ActionButton, { label: '关闭', icon: 'close', variant: 'ghost', onClick: onClose }) : null,
          ),
        ),
      )
    }

    function Drawer({ item, allItems, projectMeta, root, onClose, onDetail, onSnapshot, onTrace, onStart, onAccept, onAcceptance, onDiff, onAiReview, onRehearsal }) {
      useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape') onClose()
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
      }, [onClose])
      return h(
        'div',
        { style: { position: 'fixed', inset: 0, zIndex: 40 } },
        h('div', { style: { position: 'absolute', inset: 0, background: 'rgba(4,6,9,.55)', backdropFilter: 'blur(4px)' }, onClick: onClose }),
        h(
          'aside',
          {
            role: 'dialog',
            'aria-label': `需求详情 ${item.id}`,
            style: {
              position: 'absolute',
              top: 0,
              right: 0,
              height: '100%',
              width: '60vw',
              minWidth: '560px',
              maxWidth: '95vw',
              overflowY: 'auto',
              background: T.base,
              borderLeft: `1px solid ${T.line}`,
              boxShadow: '-24px 0 60px rgba(0,0,0,.4)',
            },
          },
          h(DrawerContent, { item, allItems, projectMeta, root, onDetail, onClose, onSnapshot, onTrace, onStart, onAccept, onAcceptance, onDiff, onAiReview, onRehearsal, compact: true }),
        ),
      )
    }

    function DetailModal({ item, allItems, projectMeta, root, onClose, onSnapshot, onTrace, onStart, onAccept, onAcceptance, onDiff, onAiReview, onRehearsal }) {
      useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape') onClose()
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
      }, [onClose])
      const relations = relationsOf(item, allItems)
      const decision = item.decision ?? null
      const verifiedGreen = stateIsGreen(decision)
      return h(
        'div',
        { style: { position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(4,6,9,.62)', backdropFilter: 'blur(6px)', display: 'grid', placeItems: 'center', padding: '24px' }, onClick: onClose },
        h(
          'div',
          {
            role: 'dialog',
            'aria-label': `需求详情页 ${item.id}`,
            onClick: (event) => event.stopPropagation(),
            style: {
              width: '940px',
              maxWidth: '96vw',
              maxHeight: '90vh',
              overflowY: 'auto',
              background: T.base,
              border: `1px solid ${T.line2}`,
              borderRadius: '16px',
              padding: '26px 30px 30px',
              boxShadow: '0 24px 80px rgba(0,0,0,.5)',
            },
          },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' } },
            h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
              h(Pill, { status: item.status }),
              h('span', { style: { color: T.text3, fontSize: '11.5px' } }, item.id),
              h('span', { style: { color: T.text3, fontSize: '11px', border: `1px solid ${T.line}`, borderRadius: '5px', padding: '0 5px' } }, `v${item.revision ?? 1}`),
            ),
            h('button', { style: { ...button, borderColor: 'transparent', background: 'transparent', color: T.text2, fontSize: '18px' }, onClick: onClose, 'aria-label': '关闭' }, '×'),
          ),
          h('h2', { style: { margin: '12px 0 4px', fontSize: '24px', lineHeight: 1.35, letterSpacing: '-.01em' } }, item.title),
          h('p', { style: { margin: 0, ...muted } }, [item.owner, item.priority, `${item.projectName ?? item.project ?? '未归属项目'}${item.project ? `（${item.project}）` : ''}`].filter(Boolean).join(' · ')),
          h(DecisionBar, { decision }),
          h(
            'div',
            { style: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 300px', gap: '30px', marginTop: '20px' } },
            h(
              'div',
              { style: { minWidth: 0 } },
              h(Section, { title: '背景与来源', style: { marginTop: 0 } },
                item.briefText
                  ? renderBrief(item.briefText)
                  : h('p', { style: { margin: 0, color: T.text2, fontSize: '13.5px', lineHeight: 1.85 } }, item.brief ? `见 ${item.brief}` : '未填写背景。'),
                item.sources?.length ? h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px' } }, item.sources.map((source) => h(Chip, { key: source }, `来源 · ${source}`))) : null,
                h(Attachments, { item }),
              ),
              h(Section, { title: '证据缺口' }, h(GapsList, { decision })),
              h(Section, { title: `验收覆盖（${item.verifiedBy?.length ?? 0}）` },
                (item.verifiedBy ?? []).length
                  ? h('div', null, item.verifiedBy.map((id) => h('div', { key: id, style: { ...row, color: T.text } }, h('span', { style: { color: verifiedGreen ? T.ok : T.text3 } }, verifiedGreen ? '✓' : '·'), `已关联 ${id}`)))
                  : h('p', { style: { margin: 0, color: T.warn, fontSize: '12.5px' } }, '没有 verified_by，COV-001 会失败。'),
              ),
              h(Section, { title: '关系', action: h(TraceLink, { onClick: () => onTrace(item) }) },
                relations.length
                  ? h('div', null, relations.map(([label, ids]) => h('div', { key: label, style: row }, h('span', { style: rowLabel }, label), h('span', { style: { color: T.text } }, ids.join('、')))))
                  : h('p', { style: { margin: 0, ...muted } }, '暂无关系。'),
              ),
            ),
            h(
              'aside',
              { style: { minWidth: 0 } },
              h(Section, { title: '项目', style: { marginTop: 0 } },
                h('p', { style: { margin: 0, fontSize: '13px', color: T.text } }, `${projectMeta?.name ?? item.projectName ?? '未归属项目'}${item.project ? `（${item.project}）` : ''}`),
                h('p', { style: { margin: '4px 0 0', ...muted } }, projectMeta?.repo ?? item.github?.repo ?? '—'),
              ),
              h(Section, { title: 'GitHub / 看板' }, h(GithubBlock, { item, projectMeta })),
              h(
                Section,
                {
                  title: '评审',
                  action: h(
                    'div',
                    { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
                    h(ActionButton, { label: 'AI 评审', icon: 'sparkles', variant: 'primary', onClick: () => onAiReview(item) }),
                    h(ActionButton, { label: '变更试演', icon: 'flask', variant: 'secondary', onClick: () => onRehearsal(item) }),
                  ),
                },
                h(ReviewBlock, { review: item.review, showRoles: false }),
                h('p', { style: { margin: '6px 0 0', ...muted } }, '采纳 AI 评审即视为评审通过，无需人工签收。'),
              ),
              h(Section, { title: '角色覆盖' }, h(RoleBars, { review: item.review, decision })),
              h(
                Section,
                {
                  title: '验收执行',
                  action: h(ActionButton, { label: '运行验收', icon: 'play', variant: 'secondary', onClick: () => onAcceptance(item) }),
                },
                item.acceptance?.registered
                  ? h('p', { style: { margin: 0, fontSize: '12.5px', color: T.text2 } },
                      `${item.acceptance.commandCount} 条命令`,
                      item.acceptance.latest
                        ? ` · 最近 ${item.acceptance.latest.result}${item.acceptance.latest.current ? '（当前提交）' : '（历史提交）'}${item.acceptance.latest.complete === false ? ' · 来源不完整' : ''}`
                        : ' · 尚未运行',
                    )
                  : h('p', { style: { margin: 0, ...muted } }, '未登记验收命令。'),
                h(AcceptanceProvenance, { latest: item.acceptance?.latest }),
              ),
              h(Section, { title: '版本历史' }, h(VersionList, { item, onSnapshot, onDiff, compact: true })),
              h(Section, { title: '技术' },
                h('p', { style: { margin: 0, ...muted } }, `${item.file}${item.line ? `:${item.line}` : ''}`),
                item.brief ? h('p', { style: { margin: '4px 0 0', ...muted } }, `简报：${item.brief}`) : null,
                h(CopyPrompt, { text: nextPrompt(item, root) }),
              ),
            ),
          ),
          h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px', flexWrap: 'wrap' } },
            h(ActionButton, { label: '开始开发', icon: 'play', variant: 'primary', onClick: () => onStart(item) }),
            h(ActionButton, { label: '运行验收', icon: 'play', variant: 'secondary', onClick: () => onAcceptance(item) }),
            h(ActionButton, { label: '运行门禁检查', icon: 'check', variant: 'secondary', onClick: () => onAccept(item) }),
            h(ActionButton, { label: '变更试演', icon: 'flask', variant: 'secondary', onClick: () => onRehearsal(item) }),
            h(ActionButton, { label: '关闭', icon: 'close', variant: 'ghost', onClick: onClose }),
          ),
        ),
      )
    }

    function SnapshotModal({ snapshot, onClose }) {
      const { item, version, loading, content, error } = snapshot
      useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape') onClose()
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
      }, [onClose])
      return h(
        'div',
        { style: { position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(4,6,9,.62)', backdropFilter: 'blur(6px)', display: 'grid', placeItems: 'center', padding: '24px' }, onClick: onClose },
        h(
          'div',
          {
            role: 'dialog',
            'aria-label': `版本快照 ${version.short}`,
            onClick: (event) => event.stopPropagation(),
            style: {
              width: '860px',
              maxWidth: '96vw',
              maxHeight: '88vh',
              display: 'flex',
              flexDirection: 'column',
              background: T.base,
              border: `1px solid ${T.line2}`,
              borderRadius: '16px',
              padding: '24px 28px',
              boxShadow: '0 24px 80px rgba(0,0,0,.5)',
            },
          },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' } },
            h('h3', { style: { margin: 0, fontSize: '18px' } }, `版本快照 · ${version.short}`),
            h('button', { style: { ...button, borderColor: 'transparent', background: 'transparent', color: T.text2, fontSize: '18px' }, onClick: onClose, 'aria-label': '关闭' }, '×'),
          ),
          h('p', { style: { margin: '6px 0 12px', ...muted } }, `${item.id} · ${version.date?.slice(0, 10) ?? ''} · ${version.subject}`),
          loading
            ? h('p', { style: muted }, '正在读取快照…')
            : error
              ? h('p', { style: { color: T.err, fontSize: '13px' } }, error)
              : h(
                  'pre',
                  {
                    style: {
                      margin: 0,
                      padding: '14px',
                      overflow: 'auto',
                      maxHeight: '56vh',
                      background: T.layer,
                      border: `1px solid ${T.line}`,
                      borderRadius: '10px',
                      fontSize: '12px',
                      lineHeight: 1.7,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    },
                  },
                  content,
                ),
          h('p', { style: { margin: '10px 0 0', ...muted } }, '只读快照：读取该提交时的需求文件内容，不会改动工作区。'),
          h('div', { style: { display: 'flex', justifyContent: 'flex-end', marginTop: '14px' } },
            h('button', { style: button, onClick: onClose }, '关闭'),
          ),
        ),
      )
    }

    const TRACE_DIM = {
      req: [172, 54],
      test: [162, 40],
      adr: [172, 42],
      module: [162, 42],
      interface: [172, 42],
      data: [162, 42],
      risk: [162, 42],
      missing: [162, 40],
      other: [162, 40],
    }
    const TRACE_COLOR = {
      req: T.brand,
      test: T.ok,
      adr: T.warn,
      module: T.text2,
      interface: '#7fa7ff',
      data: '#c9b8ff',
      risk: T.err,
      missing: T.err,
      other: T.text2,
    }
    const TRACE_LABEL = {
      req: '需求',
      test: '验收',
      adr: '决策',
      module: '模块',
      interface: '接口',
      data: '数据',
      risk: '风险',
      missing: '缺失资产',
      other: '资产',
    }

    function TraceModal({ item, allItems, onClose, onOpenRequirement }) {
      const trace = item.trace
      const [selectedNode, setSelectedNode] = useState(null)
      useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape') onClose()
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
      }, [onClose])

      const current = trace?.nodes.find((node) => node.current) ?? null
      const related = (trace?.nodes ?? []).filter((node) => !node.current)
      const isTarget = (id) => (trace?.edges ?? []).some((edge) => edge.from === current?.id && edge.to === id)
      const targets = related.filter((node) => isTarget(node.id))
      const sources = related.filter((node) => !isTarget(node.id))
      const place = (list, x) =>
        list.map((node, index) => {
          const [width, height] = TRACE_DIM[node.type] ?? TRACE_DIM.other
          return { ...node, x, y: 56 + index * 74, w: width, h: height }
        })
      const laid = [
        ...place(sources, 36),
        current ? { ...current, x: 344, y: 190, w: TRACE_DIM.req[0], h: TRACE_DIM.req[1] } : null,
        ...place(targets, 652),
      ].filter(Boolean)
      const boxes = new Map(laid.map((node) => [node.id, node]))
      const graphHeight = Math.max(420, 56 + Math.max(sources.length, targets.length) * 74 + 40)
      const edges = (trace?.edges ?? [])
        .map((edge, index) => {
          const from = boxes.get(edge.from)
          const to = boxes.get(edge.to)
          if (!from || !to) return null
          const x1 = from.x + from.w
          const y1 = from.y + from.h / 2
          const x2 = to.x
          const y2 = to.y + to.h / 2
          const mx = (x1 + x2) / 2
          const my = (y1 + y2) / 2
          // Put labels at 68% of the curve so parallel edges do not stack in
          // the narrow gap right next to the current node.
          const t = 0.68
          const labelX = (1 - t) ** 3 * x1 + 3 * (1 - t) ** 2 * t * mx + 3 * (1 - t) * t ** 2 * mx + t ** 3 * x2
          const labelY = (1 - t) ** 3 * y1 + 3 * (1 - t) ** 2 * t * y1 + 3 * (1 - t) * t ** 2 * y2 + t ** 3 * y2
          return {
            key: `${edge.from}-${edge.to}-${index}`,
            path: `M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`,
            label: edge.type,
            mx: labelX,
            my: labelY,
          }
        })
        .filter(Boolean)
      const stats = trace?.stats ?? { parent: 0, children: 0, tests: 0, dependencies: 0, constraints: 0, impacted: 0 }
      const types = [...new Set((trace?.nodes ?? []).map((node) => node.type))]

      return h(
        'div',
        {
          style: {
            position: 'fixed',
            inset: 0,
            zIndex: 55,
            background: 'rgba(4,6,9,.62)',
            backdropFilter: 'blur(6px)',
            display: 'grid',
            placeItems: 'center',
            padding: '24px',
          },
          onClick: onClose,
        },
        h(
          'div',
          {
            role: 'dialog',
            'aria-label': `追溯视图 ${item.id}`,
            onClick: (event) => event.stopPropagation(),
            style: {
              width: '980px',
              maxWidth: '96vw',
              maxHeight: '90vh',
              overflowY: 'auto',
              background: T.base,
              border: `1px solid ${T.line2}`,
              borderRadius: '16px',
              padding: '24px 28px',
              boxShadow: '0 24px 80px rgba(0,0,0,.5)',
            },
          },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' } },
            h('h3', { style: { margin: 0, fontSize: '18px' } }, `追溯视图 · ${item.id}`),
            h('button', { style: { ...button, borderColor: 'transparent', background: 'transparent', color: T.text2, fontSize: '18px' }, onClick: onClose, 'aria-label': '关闭' }, '×'),
          ),
          h(
            'div',
            { style: { display: 'flex', gap: '12px', flexWrap: 'wrap', margin: '8px 0 12px', fontSize: '11.5px', color: T.text2 } },
            types.map((type) =>
              h(
                'span',
                { key: type, style: { display: 'inline-flex', alignItems: 'center', gap: '5px' } },
                h('span', { style: { width: '9px', height: '9px', borderRadius: '2px', background: TRACE_COLOR[type] ?? T.text2 } }),
                TRACE_LABEL[type] ?? type,
              ),
            ),
            h('span', { style: { marginLeft: 'auto', color: T.text3 } }, '点击需求节点切换当前需求'),
          ),
          h(
            'svg',
            { viewBox: `0 0 900 ${graphHeight}`, role: 'img', 'aria-label': '需求追溯图', style: { width: '100%', height: 'auto', background: T.layer, border: `1px solid ${T.line}`, borderRadius: '12px' } },
            h(
              'defs',
              null,
              h(
                'marker',
                { id: 'alm-trace-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' },
                h('path', { d: 'M0 0 L10 5 L0 10 z', fill: '#4a5563' }),
              ),
            ),
            edges.map((edge) =>
              h(
                'g',
                { key: edge.key },
                h('path', { d: edge.path, fill: 'none', stroke: '#3a4450', strokeWidth: 1.2, markerEnd: 'url(#alm-trace-arrow)' }),
                h('text', { x: edge.mx, y: edge.my - 6, fill: '#8b95a3', fontSize: 10.5, fontFamily: 'inherit', textAnchor: 'middle' }, edge.label),
              ),
            ),
            laid.map((node) =>
              h(
                'g',
                {
                  key: node.id,
                  role: 'button',
                  tabIndex: 0,
                  'aria-label': `${node.id} ${node.title ?? ''}`,
                  onClick: () => {
                    if (!node.current && node.type === 'req' && allItems.some((entry) => entry.id === node.id)) {
                      onOpenRequirement(node.id)
                    } else {
                      setSelectedNode(node)
                    }
                  },
                  onKeyDown: (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      if (!node.current && node.type === 'req' && allItems.some((entry) => entry.id === node.id)) {
                        onOpenRequirement(node.id)
                      } else {
                        setSelectedNode(node)
                      }
                    }
                  },
                  style: { cursor: 'pointer' },
                },
                h('rect', {
                  x: node.x,
                  y: node.y,
                  width: node.w,
                  height: node.h,
                  rx: 10,
                  fill: node.current ? 'rgba(77,107,254,.12)' : T.layer2,
                  stroke: node.current ? TRACE_COLOR.req : T.line2,
                  strokeWidth: selectedNode?.id === node.id ? 2 : 1,
                }),
                h('text', { x: node.x + 12, y: node.y + (node.h > 48 ? 21 : 16), fill: T.text, fontSize: 11, fontWeight: 600, fontFamily: 'inherit' }, node.id),
                h(
                  'text',
                  { x: node.x + 12, y: node.y + (node.h > 48 ? 38 : 31), fill: T.text2, fontSize: 10.5, fontFamily: 'inherit' },
                  (() => {
                    const title = node.title ?? (node.type === 'missing' ? '目标资产不存在' : '')
                    return title.length > 20 ? `${title.slice(0, 19)}…` : title
                  })(),
                ),
              ),
            ),
          ),
          h(
            'p',
            { style: { margin: '10px 0 0', fontSize: '12px', color: T.text2 } },
            `影响面：上级 ${stats.parent} · 子需求 ${stats.children} · 验收 ${stats.tests} · 依赖 ${stats.dependencies} · 约束 ${stats.constraints} · 受影响资产 ${stats.impacted}`,
          ),
          trace?.cycles?.length
            ? h('p', { style: { margin: '6px 0 0', fontSize: '12px', color: T.err } }, `检测到关系环：${trace.cycles.map((cycle) => cycle.join(' → ')).join('；')}`)
            : null,
          selectedNode
            ? h(
                'div',
                { style: { marginTop: '10px', border: `1px solid ${T.line}`, borderRadius: '10px', padding: '10px 12px', fontSize: '12px', color: T.text2, lineHeight: 1.7 } },
                h('b', { style: { color: T.text } }, selectedNode.id),
                ` · ${TRACE_LABEL[selectedNode.type] ?? selectedNode.type}${selectedNode.status ? ` · ${selectedNode.status}` : ''}`,
                selectedNode.title
                  ? h('div', null, selectedNode.title)
                  : h('div', { style: { color: T.warn } }, '目标资产不存在；REL-001 会把它报为悬空关系。'),
              )
            : null,
          h('div', { style: { display: 'flex', justifyContent: 'flex-end', marginTop: '14px' } },
            h('button', { style: button, onClick: onClose }, '关闭'),
          ),
        ),
      )
    }

    function postJson(path, body, root, options = {}) {
      return fetch(`/api/alm/${path}?root=${encodeURIComponent(root)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: options.signal,
      }).then(async (response) => {
        const payload = await response.json().catch(() => null)
        if (!response.ok || payload?.ok === false) {
          const error = new Error(payload?.error?.message ?? `HTTP ${response.status}`)
          // Keep the backend error code so callers can react to contract errors
          // (e.g. stale-preview) instead of guessing from the message text.
          error.code = payload?.error?.code ?? null
          error.status = response.status
          // Contract errors also carry recovery details (reasons, applied
          // artifacts, manual-fallback session); keep the payload reachable.
          error.payload = payload
          error.reasons = payload?.error?.reasons ?? null
          error.appliedArtifacts = payload?.error?.appliedArtifacts ?? null
          error.manualFallback = payload?.manualFallback === true
          throw error
        }
        return payload
      })
    }

    function writeJson(path, body, root, options) {
      return postJson(`requirements/${path}`, body, root, options)
    }

    function ModalShell({ title, lead, onClose, children, footer, width = '720px' }) {
      const returnFocusRef = useRef(undefined)
      if (returnFocusRef.current === undefined) {
        returnFocusRef.current = typeof document === 'undefined' ? null : document.activeElement
      }
      const closeRef = useRef(onClose)
      closeRef.current = onClose
      useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape') closeRef.current()
        }
        document.addEventListener('keydown', onKey)
        return () => {
          document.removeEventListener('keydown', onKey)
          const previous = returnFocusRef.current
          if (previous && previous !== document.body && typeof previous.focus === 'function') {
            try {
              previous.focus()
            } catch {}
          }
        }
      }, [])
      return h(
        'div',
        {
          style: {
            position: 'fixed',
            inset: 0,
            zIndex: 60,
            background: 'rgba(4,6,9,.62)',
            backdropFilter: 'blur(6px)',
            display: 'grid',
            placeItems: 'center',
            padding: '24px',
          },
          onClick: onClose,
        },
        h(
          'div',
          {
            role: 'dialog',
            'aria-label': title,
            onClick: (event) => event.stopPropagation(),
            style: {
              width,
              maxWidth: '96vw',
              maxHeight: '88vh',
              overflowY: 'auto',
              background: T.base,
              border: `1px solid ${T.line2}`,
              borderRadius: '16px',
              padding: '24px 28px',
              boxShadow: '0 24px 80px rgba(0,0,0,.5)',
            },
          },
          h('h3', { style: { margin: 0, fontSize: '18px' } }, title),
          lead ? h('p', { style: { margin: '8px 0 0', ...muted, lineHeight: 1.7 } }, lead) : null,
          children,
          footer ? h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '18px' } }, footer) : null,
        ),
      )
    }

    function PlanRows({ rows }) {
      return h(
        'div',
        { style: { border: `1px solid ${T.line}`, borderRadius: '10px', padding: '4px 12px', marginTop: '14px' } },
        rows.map(([label, value], index) =>
          h(
            'div',
            { key: label, style: { ...row, borderBottom: index === rows.length - 1 ? 'none' : `1px solid ${T.line}` } },
            h('span', { style: rowLabel }, label),
            h('span', { style: { color: T.text, minWidth: 0, fontSize: '12.5px' } }, value),
          ),
        ),
      )
    }

    function StartModal({ item, root, projectMeta, onClose, onGithubApplied }) {
      const [state, setState] = useState({ loading: true, error: null, plan: null, result: null, applying: false })
      const [isolate, setIsolate] = useState(false)
      const [github, setGithub] = useState({ loading: false, plan: null, result: null, error: null })
      const load = useCallback(() => {
        setState({ loading: true, error: null, plan: null, result: null, applying: false })
        writeJson('start', { requirementId: item.id, isolate }, root)
          .then((plan) => setState({ loading: false, error: null, plan, result: null, applying: false }))
          .catch((error) => setState({ loading: false, error: error.message, plan: null, result: null, applying: false }))
      }, [item.id, root, isolate])
      useEffect(() => {
        load()
      }, [load])

      const apply = () => {
        setState((current) => ({ ...current, applying: true, error: null }))
        writeJson('start', { requirementId: item.id, apply: true, isolate }, root)
          .then((result) => setState((current) => ({ ...current, applying: false, result })))
          .catch((error) => setState((current) => ({ ...current, applying: false, error: error.message })))
      }

      const githubRoot = () => state.result?.worktree?.path ?? root
      const previewGithubIssues = (changeId) => {
        setGithub({ loading: true, plan: null, result: null, error: null })
        writeJson('github', { changeId, apply: false }, githubRoot())
          .then((plan) => setGithub({ loading: false, plan, result: null, error: null }))
          .catch((error) => setGithub({ loading: false, plan: null, result: null, error: error.message }))
      }

      const applyGithubIssues = (changeId) => {
        setGithub((current) => ({ ...current, loading: true, error: null }))
        writeJson('github', { changeId, apply: true }, githubRoot())
          .then((result) => {
            setGithub({ loading: false, plan: null, result, error: null })
            onGithubApplied?.()
          })
          .catch((error) => setGithub((current) => ({ ...current, loading: false, error: error.message })))
      }

      const canGithub = Boolean(projectMeta?.repo)
      const plan = state.plan
      const result = state.result
      const actionLabel = { create: '创建', created: '已创建', adopt: '复用', skip: '跳过' }
      return h(
        ModalShell,
        {
          title: `开始开发 · ${item.id}`,
          lead: '登记变更并生成任务卡；不会切换当前分支。GitHub 建单可在此预览并显式创建。',
          onClose,
          footer: [
            h('button', { key: 'cancel', style: button, onClick: onClose }, result ? '关闭' : '取消'),
            result
              ? null
              : plan
                ? h('button', { key: 'apply', style: primary, onClick: apply, disabled: state.applying }, state.applying ? '生成中…' : '确认并生成')
                : null,
          ],
        },
        h(
          'label',
          { style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px', fontSize: '12.5px', color: T.text2 } },
          h('input', { type: 'checkbox', checked: isolate, onChange: (event) => setIsolate(event.target.checked) }),
          '创建隔离 worktree（不改动主工作区；默认只登记变更）',
        ),
        state.loading ? h('p', { style: muted }, '正在预演变更…') : null,
        state.error ? h('p', { style: { color: T.err, fontSize: '13px' } }, state.error) : null,
        plan
          ? h(
              'div',
              null,
              h(PlanRows, {
                rows: [
                  ['项目', `${plan.project ?? '—'}`],
                  ['变更', plan.changeId],
                  ['分支', plan.branch],
                  ['基线', plan.baselineSha.slice(0, 8)],
                  ['任务卡', `${plan.taskCount} 张`],
                  ['需求', plan.requirementIds.join('、')],
                  ['隔离 worktree', plan.isolate ? '是' : '否（只登记）'],
                  ...(plan.worktreePath ? [['worktree', plan.worktreePath]] : []),
                ],
              }),
              h('div', { style: { marginTop: '12px', fontSize: '12px', color: T.text3 } }, '将写入：'),
              h(
                'ul',
                { style: { margin: '6px 0 0', paddingLeft: '18px', fontSize: '12px', color: T.text2, lineHeight: 1.9 } },
                plan.plannedFiles.map((file) => h('li', { key: file, style: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' } }, file)),
              ),
            )
          : null,
        result
          ? h(
              'div',
              { style: { marginTop: '14px' } },
              h(PlanRows, {
                rows: [
                  ['状态', '已生成'],
                  ['变更', result.changeId],
                  ['任务卡', `${result.draft.tasks.length} 张`],
                  ['文件', result.draft.files.join('、')],
                  ...(result.worktree ? [['隔离 worktree', result.worktree.path], ['分支', result.worktree.branch]] : []),
                ],
              }),
              h(
                'div',
                { style: { marginTop: '10px', border: `1px solid ${T.line}`, borderRadius: '10px', padding: '8px 12px' } },
                result.draft.tasks.map((task) =>
                  h('div', { key: task.id, style: { ...row, borderBottom: 'none', padding: '4px 0' } },
                    h('span', { style: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '11.5px', color: T.text3 } }, task.id),
                    h('span', { style: { color: T.text, fontSize: '12px' } }, task.title),
                  ),
                ),
              ),
            )
          : null,
        result
          ? h(
              'div',
              { style: { marginTop: '16px', borderTop: `1px solid ${T.line}`, paddingTop: '14px' } },
              h('div', { style: { ...sectionTitle, margin: '0 0 8px' } }, 'GitHub 归属'),
              !canGithub
                ? h('p', { style: { margin: 0, ...muted } }, '当前工作区未关联 GitHub 仓库，无法建单；请先在顶部「关联仓库」。')
                : h(
                    'div',
                    null,
                    h('p', { style: { margin: '0 0 8px', ...muted } }, `${projectMeta.repo}${projectMeta.board ? ` · ProjectV2 #${projectMeta.board}` : ''}`),
                    github.loading ? h('p', { style: muted }, '正在处理 GitHub…') : null,
                    github.error ? h('p', { style: { margin: '6px 0', color: T.err, fontSize: '12.5px' } }, github.error) : null,
                    github.plan
                      ? h(
                          'div',
                          null,
                          h('p', { style: { margin: '0 0 4px', fontSize: '12.5px', color: T.text2 } }, `将创建 1 个需求 Issue + ${github.plan.tasks.length} 个任务子议题：`),
                          h(
                            'ul',
                            { style: { margin: 0, paddingLeft: '18px', fontSize: '12px', color: T.text2, lineHeight: 1.8 } },
                            [github.plan.requirements[0]?.title, ...github.plan.tasks.map((task) => task.title)]
                              .filter(Boolean)
                              .map((title, index) => h('li', { key: index }, title)),
                          ),
                        )
                      : null,
                    github.result
                      ? h(
                          'div',
                          null,
                          h(
                            'ul',
                            { style: { margin: 0, paddingLeft: '18px', fontSize: '12px', color: T.text2, lineHeight: 1.8 } },
                            [...github.result.requirements, ...github.result.tasks].map((action, index) =>
                              h('li', { key: index }, `${actionLabel[action.action] ?? action.action}：${action.title ?? action.issue?.title ?? ''}`),
                            ),
                          ),
                          h('p', { style: { margin: '6px 0 0', ...muted } }, `映射已写入 .alm/github.json（${github.result.repo}）`),
                        )
                      : null,
                    h(
                      'div',
                      { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px' } },
                      !github.result
                        ? h('button', { style: button, onClick: () => previewGithubIssues(result.changeId), disabled: github.loading }, github.plan ? '重新预览' : '预览 GitHub 建单')
                        : null,
                      github.plan && !github.result
                        ? h('button', { style: primary, onClick: () => applyGithubIssues(result.changeId), disabled: github.loading }, '创建 GitHub Issue')
                        : null,
                    ),
                  ),
            )
          : null,
      )
    }

    function AcceptModal({ item, root, onClose }) {
      const [state, setState] = useState({ loading: true, error: null, result: null })
      const run = useCallback(() => {
        setState({ loading: true, error: null, result: null })
        writeJson('accept', {}, root)
          .then((result) => setState({ loading: false, error: null, result }))
          .catch((error) => setState({ loading: false, error: error.message, result: null }))
      }, [root])
      useEffect(() => {
        run()
      }, [run])
      return h(
        ModalShell,
        {
          title: `运行门禁检查 · ${item.id}`,
          lead: '执行 `alm ci run`（固定白名单命令，不接受任意命令）；证据写入 .alm/ci/<sha>/。',
          onClose,
          footer: [
            h('button', { key: 'again', style: button, onClick: run }, '再次运行'),
            h('button', { key: 'close', style: primary, onClick: onClose }, '关闭'),
          ],
        },
        state.loading ? h('p', { style: muted }, '正在运行门禁…') : null,
        state.error ? h('p', { style: { color: T.err, fontSize: '13px' } }, state.error) : null,
        state.result
          ? h(
              'div',
              null,
              h(PlanRows, {
                rows: [
                  ['结果', state.result.result],
                  ['状态', state.result.status],
                  ['提交', state.result.headSha?.slice(0, 12) ?? '—'],
                  ['runId', state.result.runId ?? '—'],
                  ['证据', state.result.path],
                ],
              }),
              h('p', { style: { margin: '10px 0 0', ...muted } }, '重复运行同一提交 + 同一规则包时返回 unchanged，只保留一份证据。'),
            )
          : null,
      )
    }

    function AcceptanceModal({ item, root, onClose, onDone }) {
      const [state, setState] = useState({ loading: true, plan: null, result: null, error: null, running: false })
      const load = useCallback(() => {
        setState({ loading: true, plan: null, result: null, error: null, running: false })
        writeJson('acceptance', { requirementId: item.id }, root)
          .then((plan) => setState({ loading: false, plan, result: null, error: null, running: false }))
          .catch((error) => setState({ loading: false, plan: null, result: null, error: error.message, running: false }))
      }, [item.id, root])
      useEffect(() => {
        load()
      }, [load])

      const run = () => {
        setState((current) => ({ ...current, running: true, error: null }))
        writeJson('acceptance', { requirementId: item.id, apply: true }, root)
          .then((result) => {
            setState({ loading: false, plan: null, result, error: null, running: false })
            onDone?.()
          })
          .catch((error) => setState((current) => ({ ...current, running: false, error: error.message })))
      }

      const plan = state.plan
      const result = state.result
      const evidence = result?.evidence
      return h(
        ModalShell,
        {
          title: `运行需求验收 · ${item.id}`,
          lead: '只执行 .alm/acceptance/<REQ>.json 登记的命令（白名单 node / npm / pnpm，无 shell）；证据写 .alm/acceptance/<REQ>/<sha>.json。',
          onClose,
          width: '820px',
          footer: [
            h('button', { key: 'close', style: result ? primary : button, onClick: onClose }, '关闭'),
            plan && !result
              ? h('button', { key: 'run', style: primary, onClick: run, disabled: state.running }, state.running ? '运行中…' : '运行验收')
              : null,
          ],
        },
        state.loading ? h('p', { style: muted }, '正在读取验收配置…') : null,
        state.error
          ? h(
              'div',
              null,
              h('p', { style: { margin: 0, color: T.err, fontSize: '13px' } }, state.error),
              h('p', { style: { margin: '8px 0 0', ...muted } }, '可在工作区创建 .alm/acceptance/<需求ID>.json 登记命令，例如 {"commands":[{"id":"smoke","command":["node","-e","process.exit(0)"]}]}。'),
            )
          : null,
        plan
          ? h(
              'div',
              null,
              h(PlanRows, {
                rows: [
                  ['需求', plan.requirement],
                  ['提交', plan.headSha.slice(0, 12)],
                  ['命令数', `${plan.commands.length}`],
                  ['证据', plan.evidencePath],
                ],
              }),
              h(
                'div',
                { style: { marginTop: '10px', border: `1px solid ${T.line}`, borderRadius: '10px', padding: '8px 12px' } },
                plan.commands.map((command) =>
                  h('div', { key: command.id, style: { ...row, borderBottom: 'none', padding: '4px 0', alignItems: 'baseline' } },
                    h('span', { style: { color: T.text3, fontSize: '11.5px', width: '90px', flex: 'none' } }, command.id),
                    h('code', { style: { color: T.text, fontSize: '12px', wordBreak: 'break-all' } }, command.command.join(' ')),
                  ),
                ),
              ),
            )
          : null,
        evidence
          ? h(
              'div',
              { style: { marginTop: '14px' } },
              h(PlanRows, {
                rows: [
                  ['结果', evidence.result],
                  ['提交', shortHash(evidence.headSha, 12)],
                  ['证据', result.evidencePath],
                ],
              }),
              h(AcceptanceProvenance, { latest: evidence }),
              h(
                'div',
                { style: { marginTop: '10px', border: `1px solid ${T.line}`, borderRadius: '10px', padding: '8px 12px' } },
                evidence.commands.map((command) =>
                  h(
                    'div',
                    { key: command.id, style: { borderBottom: `1px solid ${T.line}`, padding: '6px 0', fontSize: '12px', color: T.text2 } },
                    h('div', { style: { display: 'flex', gap: '10px', alignItems: 'baseline' } },
                      h('span', { style: { color: T.text3, width: '90px', flex: 'none' } }, command.id),
                      h('span', { style: { color: command.exitCode === 0 ? T.ok : T.err, fontWeight: 600 } }, `exit ${command.exitCode ?? 'timeout'}`),
                      h('span', { style: { color: T.text3 } }, `${command.durationMs} ms`),
                    ),
                    command.stdout || command.stderr
                      ? h(
                          'pre',
                          { style: { margin: '6px 0 0 100px', padding: '8px', maxHeight: '140px', overflow: 'auto', background: T.layer, border: `1px solid ${T.line}`, borderRadius: '8px', fontSize: '11px', whiteSpace: 'pre-wrap' } },
                          `${command.stdout ?? ''}${command.stderr ?? ''}`.slice(0, 2000),
                        )
                      : null,
                  ),
                ),
              ),
            )
          : null,
      )
    }

    function AiReviewModal({ item, root, onClose, onDone }) {
      const hasStored = Boolean(item.aiReview?.stored)
      const [phase, setPhase] = useState(hasStored ? 'loading' : 'intro')
      const [report, setReport] = useState(null)
      const [error, setError] = useState(null)
      const [selected, setSelected] = useState([])
      const [adopted, setAdopted] = useState(null)
      const [accepted, setAccepted] = useState(null)

      const applyReport = (next) => {
        setReport(next)
        setSelected((next.suggestions ?? []).map((suggestion) => suggestion.id))
        setPhase('report')
      }
      const load = useCallback(() => {
        if (!hasStored) return
        setPhase('loading')
        writeJson('ai-review', { requirementId: item.id, load: true }, root)
          .then((next) => applyReport(next))
          .catch((err) => {
            setError(err.message)
            setPhase('intro')
          })
      }, [hasStored, item.id, root])
      useEffect(() => {
        load()
      }, [load])

      const generate = () => {
        setPhase('generating')
        setError(null)
        writeJson('ai-review', { requirementId: item.id }, root)
          .then((next) => applyReport(next))
          .catch((err) => {
            setError(err.message)
            setPhase('intro')
          })
      }
      const adopt = () => {
        setPhase('adopting')
        setError(null)
        writeJson('ai-review', { requirementId: item.id, apply: true, selectedSuggestionIds: selected }, root)
          .then((next) => {
            setAdopted(next.adopted ?? { suggestionIds: selected })
            setAccepted(next.accepted ?? null)
            setReport(next)
            setPhase('adopted')
            onDone?.()
          })
          .catch((err) => {
            setError(err.message)
            setPhase('report')
          })
      }
      const toggle = (id) => setSelected((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]))
      const verdictMeta = report ? VERDICT[report.verdict] ?? VERDICT.warn : null
      return h(
        ModalShell,
        {
          title: `AI 评审 · ${item.id}`,
          lead: 'AI 读取需求字段、门禁发现与背景，给出评审意见、重构建议与方案。采纳后只维护一个「AI 评审建议」小节（重复采纳替换，不追加），并视为评审通过。',
          onClose,
          width: '860px',
          footer: [
            h('button', { key: 'close', style: phase === 'report' ? button : primary, onClick: onClose }, phase === 'adopted' ? '关闭' : '取消'),
            phase === 'intro' || (phase === 'report' && !report)
              ? h('button', { key: 'generate', style: primary, onClick: generate }, '生成 AI 评审')
              : null,
            phase === 'intro' && hasStored ? h('button', { key: 'load', style: button, onClick: load }, '查看已有评审') : null,
            phase === 'report'
              ? h('button', { key: 'adopt', style: primary, onClick: adopt }, selected.length === 0 ? '确认评审通过' : `采纳 ${selected.length} 条并确认通过`)
              : null,
          ],
        },
        phase === 'loading' ? h('p', { style: muted }, '正在读取已有 AI 评审…') : null,
        phase === 'generating'
          ? h('div', { style: { padding: '16px 0', color: T.text2, fontSize: '13px', lineHeight: 1.9 } },
              h('p', { style: { margin: 0 } }, 'AI 正在阅读需求并生成评审与方案，通常需要 10–60 秒…'),
              h('p', { style: { margin: '4px 0 0', ...muted } }, '本次调用使用 DSH 当前默认模型；生成结果会保存到 .alm/reviews/<REQ>.ai.json。'),
            )
          : null,
        error ? h('p', { style: { margin: '10px 0 0', color: T.err, fontSize: '12.5px' } }, error) : null,
        phase === 'intro'
          ? h('div', { style: { padding: '10px 0', color: T.text2, fontSize: '13px', lineHeight: 1.9 } },
              h('p', { style: { margin: 0 } }, '还没有 AI 评审记录。生成后可以查看：'),
              h('ul', { style: { margin: '6px 0 0', paddingLeft: '20px' } },
                h('li', null, '评审意见与阻塞/建议分级'),
                h('li', null, '可执行的重构建议（可勾选采纳）'),
                h('li', null, '分步重构方案与建议背景'),
              ),
            )
          : null,
        report
          ? h(
              'div',
              { style: { marginTop: '10px' } },
              h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' } },
                h('span', { style: { borderRadius: '999px', padding: '2px 10px', fontSize: '11.5px', color: verdictMeta.color, background: verdictMeta.bg } }, report.verdict),
                h('b', { style: { fontSize: '13.5px', color: T.text, fontWeight: 500 } }, report.summary),
              ),
              h('p', { style: { margin: '6px 0 0', ...muted } }, `${report.provider} · ${report.model} · ${report.generatedAt?.slice(0, 19).replace('T', ' ')}`),
              h('div', { style: { marginTop: '12px' } },
                h('div', { style: { fontSize: '11px', letterSpacing: '.08em', color: T.text3, marginBottom: '6px' } }, '评审意见'),
                (report.findings ?? []).length
                  ? report.findings.map((finding) =>
                      h('div', { key: finding.id, style: { borderLeft: `3px solid ${finding.severity === 'block' ? T.err : finding.severity === 'warn' ? T.warn : T.line2}`, background: T.layer2, borderRadius: '8px', padding: '7px 10px', marginBottom: '6px', fontSize: '12.5px', color: T.text2 } },
                        h('b', { style: { color: T.text, fontWeight: 500 } }, `${finding.title} `),
                        finding.detail,
                        finding.ref ? h('span', { style: { ...muted, marginLeft: '6px' } }, `（${finding.ref}）`) : null,
                      ),
                    )
                  : h('p', { style: { margin: 0, ...muted } }, '无评审意见。'),
              ),
              h('div', { style: { marginTop: '12px' } },
                h('div', { style: { fontSize: '11px', letterSpacing: '.08em', color: T.text3, marginBottom: '6px' } }, '重构建议（勾选后采纳）'),
                (report.suggestions ?? []).map((suggestion) =>
                  h('label', { key: suggestion.id, style: { display: 'flex', gap: '8px', alignItems: 'flex-start', border: `1px solid ${T.line}`, borderRadius: '8px', padding: '8px 10px', marginBottom: '6px', fontSize: '12.5px', color: T.text2, cursor: 'pointer' } },
                    h('input', { type: 'checkbox', checked: selected.includes(suggestion.id), onChange: () => toggle(suggestion.id), style: { marginTop: '2px' } }),
                    h('span', null,
                      h('b', { style: { color: T.text, fontWeight: 500 } }, `[${suggestion.category}] ${suggestion.title}`),
                      h('span', { style: { display: 'block', marginTop: '2px' } }, suggestion.detail),
                      suggestion.suggestedText ? h('code', { style: { display: 'block', marginTop: '4px', color: T.text3, fontSize: '11.5px', whiteSpace: 'pre-wrap' } }, suggestion.suggestedText) : null,
                    ),
                  ),
                ),
              ),
              (report.plan ?? []).length
                ? h('div', { style: { marginTop: '12px' } },
                    h('div', { style: { fontSize: '11px', letterSpacing: '.08em', color: T.text3, marginBottom: '6px' } }, '重构方案'),
                    h('ol', { style: { margin: 0, paddingLeft: '20px', fontSize: '12.5px', color: T.text2, lineHeight: 1.9 } },
                      report.plan.map((entry, index) => h('li', { key: `${entry.step}-${index}` }, h('b', { style: { color: T.text, fontWeight: 500 } }, entry.step), `：${entry.detail}`)),
                    ),
                  )
                : null,
              report.proposedBrief
                ? h('div', { style: { marginTop: '12px' } },
                    h('div', { style: { fontSize: '11px', letterSpacing: '.08em', color: T.text3, marginBottom: '6px' } }, '建议背景'),
                    h('pre', { style: { margin: 0, padding: '10px', maxHeight: '160px', overflow: 'auto', background: T.layer, border: `1px solid ${T.line}`, borderRadius: '8px', fontSize: '11.5px', lineHeight: 1.8, whiteSpace: 'pre-wrap' } }, report.proposedBrief),
                    h('p', { style: { margin: '6px 0 0', ...muted } }, '建议背景只保存在评审报告中，不整段写入需求 brief，避免重复膨胀。'),
                  )
                : null,
              phase === 'adopted'
                ? h('div', { style: { margin: '12px 0 0', fontSize: '12.5px', color: T.ok, lineHeight: 1.9 } },
                    h('p', { style: { margin: 0 } }, adopted?.noSuggestions
                      ? '已记录评审通过；未选择建议，需求 brief 未修改。'
                      : `已采纳 ${adopted?.suggestionIds?.length ?? selected.length} 条建议；brief 的「AI 评审建议」已更新（不会重复追加）。`),
                    accepted?.accepted
                      ? h('p', { style: { margin: '2px 0 0' } }, '评审已通过：采纳 AI 评审即视为签收，无需人工操作。')
                      : h('p', { style: { margin: '2px 0 0', color: T.warn } }, accepted?.reason === 'blocking-findings' ? '评审仍有阻塞项，已记录采纳，但不能视为通过。' : `评审通过记录未生成：${accepted?.reason ?? '未知原因'}`),
                  )
                : null,
            )
          : null,
      )
    }

    function RehearsalModal({ item, root, onClose, onDone }) {
      const original = {
        title: item.title ?? '',
        priority: item.priority ?? 'P1',
        brief: item.briefText ?? '',
      }
      const [draft, setDraft] = useState(original)
      const [state, setState] = useState({ loading: false, preview: null, result: null, error: null, stale: false })
      const [idempotencyKey] = useState(() => `ui-rehearsal-${item.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`)
      const changes = () =>
        REHEARSAL_FIELDS.map(([field]) => ({ field, value: draft[field] ?? '' })).filter(
          (entry) => String(entry.value) !== String(original[entry.field] ?? ''),
        )
      const fieldLabel = (key) => (REHEARSAL_FIELDS.find(([id]) => id === key) ?? [key, key])[1]
      const edit = (field, value) => {
        setDraft((current) => ({ ...current, [field]: value }))
        setState((current) => ({ ...current, preview: null, result: null, error: null, stale: false }))
      }
      const preview = () => {
        const list = changes()
        if (list.length === 0) {
          setState({ loading: false, preview: null, result: null, error: '至少修改一个字段后再预览。', stale: false })
          return
        }
        setState({ loading: true, preview: null, result: null, error: null, stale: false })
        writeJson('rehearsal', { requirementId: item.id, changes: list }, root)
          .then((next) => setState({ loading: false, preview: next, result: null, error: null, stale: false }))
          .catch((error) => setState({ loading: false, preview: null, result: null, error: error.message, stale: false }))
      }
      const submit = () => {
        const current = state.preview
        if (!current || state.loading) return
        const list = changes()
        setState((previous) => ({ ...previous, loading: true, result: null, error: null, stale: false }))
        writeJson(
          'rehearsal',
          { requirementId: item.id, changes: list, apply: true, expectedBaseline: current.baseline, actor: 'human:local', idempotencyKey },
          root,
        )
          .then((result) => {
            setState({ loading: false, preview: null, result, error: null, stale: false })
            onDone?.()
          })
          .catch((error) => {
            const stale = error.code === 'stale-preview' || String(error.message ?? '').includes('stale-preview')
            if (!stale) {
              setState((previous) => ({ ...previous, loading: false, error: error.message, stale: false }))
              return
            }
            // The baseline moved under us: recompute instead of pretending success.
            setState((previous) => ({ ...previous, loading: false, error: null, stale: true }))
            writeJson('rehearsal', { requirementId: item.id, changes: list }, root)
              .then((next) => setState((previous) => ({ ...previous, loading: false, preview: next, error: null, stale: true })))
              .catch((nextError) => setState((previous) => ({ ...previous, loading: false, error: nextError.message, stale: true })))
          })
      }
      const previewData = state.preview
      const result = state.result
      const previewChanges = previewData ? previewData.changes ?? (previewData.change ? [previewData.change] : []) : []
      const editedLabels = changes().map((entry) => fieldLabel(entry.field))
      const hasChanges = editedLabels.length > 0
      const nodeLabel = (node) => {
        if (!node) return '—'
        if (typeof node === 'string') return node
        return `${node.id ?? node.title ?? node.assetId ?? '—'}${node.title && node.id ? ` · ${node.title}` : ''}`
      }
      const groups = [
        ['reverify', '需重验'],
        ['reconfirm', '需重新确认'],
        ['reference', '仅参考'],
      ]
      const fieldInput = (field) => {
        if (field === 'priority') {
          return h(
            'select',
            { style: input, value: draft.priority, onChange: (event) => edit('priority', event.target.value) },
            ['P0', 'P1', 'P2', 'P3'].map((priority) => h('option', { key: priority, value: priority }, priority)),
          )
        }
        if (field === 'brief') {
          return h('textarea', {
            style: { ...input, width: '100%', minHeight: '150px', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.7 },
            value: draft.brief,
            onChange: (event) => edit('brief', event.target.value),
          })
        }
        return h('input', { style: input, value: draft.title, onChange: (event) => edit('title', event.target.value) })
      }
      return h(
        ModalShell,
        {
          title: `变更试演 · ${item.id}`,
          lead: '一次可改标题、优先级、背景；只提交有改动的字段。试演不写文件，确认提交携带当前 baseline 做 CAS 并写审计记录。',
          onClose,
          width: '860px',
          footer: [
            h('button', { key: 'close', style: result ? primary : button, onClick: onClose }, result ? '关闭' : '取消'),
            result
              ? null
              : h('button', { key: 'preview', style: { ...button, opacity: state.loading || !hasChanges ? 0.5 : 1 }, onClick: preview, disabled: state.loading || !hasChanges }, state.loading ? '处理中…' : '预览影响面'),
            previewData && !result ? h('button', { key: 'submit', style: primary, onClick: submit, disabled: state.loading }, '确认提交') : null,
          ],
        },
        h(
          'div',
          { style: { marginTop: '14px', border: `1px solid ${T.line}`, borderRadius: '10px', padding: '12px' } },
          h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'baseline', flexWrap: 'wrap' } },
            h('div', { style: { fontSize: '11px', letterSpacing: '.08em', textTransform: 'uppercase', color: T.text3 } }, '可修改字段'),
            h('span', { style: { fontSize: '12px', color: hasChanges ? T.ok : T.text3 } }, hasChanges ? `将提交：${editedLabels.join('、')}` : '尚未修改'),
          ),
          REHEARSAL_FIELDS.map(([field, label]) =>
            h(
              'label',
              { key: field, style: { display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '10px', fontSize: '12px', color: T.text2 } },
              h('span', null, label, h('span', { style: { ...muted, marginLeft: '8px' } }, String(draft[field] ?? '') === String(original[field] ?? '') ? '未修改' : '已修改')),
              fieldInput(field),
            ),
          ),
        ),
        state.stale
          ? h('p', { style: { margin: '10px 0 0', color: T.warn, fontSize: '12.5px', lineHeight: 1.8 } }, '已被他人修改，已重新计算，请确认。')
          : null,
        state.loading ? h('p', { style: { margin: '10px 0 0', ...muted } }, '正在读取影响面…') : null,
        state.error ? h('p', { style: { margin: '10px 0 0', color: T.err, fontSize: '12.5px' } }, state.error) : null,
        result
          ? h(
              'div',
              { style: { marginTop: '14px' } },
              h(PlanRows, {
                rows: [
                  ['状态', result.applied === false ? '未提交' : '已提交'],
                  ['修订', result.revision ? `v${result.revision}` : '—'],
                  ['变更', (result.changes ?? []).map((entry) => fieldLabel(entry.field)).join('、') || '—'],
                  ['文件', result.file ?? '—'],
                  ['审计', result.auditFile ?? '—'],
                ],
              }),
              h('p', { style: { margin: '8px 0 0', color: T.warn, fontSize: '12px' } }, '评审与验收证据已失效：请重新采纳 AI 评审并重跑验收。'),
            )
          : null,
        previewData
          ? h(
              'div',
              { style: { marginTop: '14px' } },
              h(PlanRows, {
                rows: [
                  ['变更', `${previewChanges.map((entry) => fieldLabel(entry.field)).join('、')} · ${item.id}`],
                  ['基线内容哈希', shortHash(previewData.baseline?.contentHash)],
                  ['基线关系快照', shortHash(previewData.baseline?.relationHash)],
                  ['基线提交', shortHash(previewData.baseline?.headSha, 8)],
                  ['基线修订', `v${previewData.baseline?.revision ?? item.revision ?? 1}`],
                ],
              }),
              previewChanges.map((entry) =>
                h(
                  'div',
                  { key: entry.field, style: { marginTop: '10px' } },
                  h('div', { style: { fontSize: '11px', letterSpacing: '.08em', textTransform: 'uppercase', color: T.text3, marginBottom: '5px' } }, fieldLabel(entry.field)),
                  h(
                    'div',
                    { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '10px' } },
                    h(
                      'div',
                      { style: { border: `1px solid ${T.line}`, borderRadius: '10px', padding: '10px 12px', background: T.layer } },
                      h('div', { style: { fontSize: '11px', color: T.text3, marginBottom: '4px' } }, '变更前'),
                      h('div', { style: { fontSize: '12.5px', color: T.text2, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: entry.field === 'brief' ? '180px' : 'none', overflow: entry.field === 'brief' ? 'auto' : 'visible' } }, entry.before || '（空）'),
                    ),
                    h(
                      'div',
                      { style: { border: `1px solid ${T.line}`, borderLeft: `3px solid ${T.brand}`, borderRadius: '10px', padding: '10px 12px' } },
                      h('div', { style: { fontSize: '11px', color: T.text3, marginBottom: '4px' } }, '变更后'),
                      h('div', { style: { fontSize: '12.5px', color: T.text, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: entry.field === 'brief' ? '180px' : 'none', overflow: entry.field === 'brief' ? 'auto' : 'visible' } }, entry.after || '（空）'),
                    ),
                  ),
                ),
              ),
              h(
                'div',
                { style: { marginTop: '12px' } },
                h('div', { style: { fontSize: '11px', letterSpacing: '.08em', textTransform: 'uppercase', color: T.text3 } }, '影响分组（提示，不是阻塞）'),
                groups.map(([key, label]) => {
                  const nodes = previewData.impact?.groups?.[key] ?? []
                  return h(
                    'div',
                    { key, style: { marginTop: '6px', fontSize: '12px', color: T.text2 } },
                    h('span', { style: { color: T.text3, marginRight: '6px' } }, `${label} ${nodes.length}`),
                    nodes.length
                      ? h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '4px' } }, nodes.map((node, index) => h(MetaChip, { key: `${key}-${index}` }, nodeLabel(node))))
                      : h('span', { style: muted }, '无'),
                  )
                }),
              ),
              previewData.impact?.paths?.length
                ? h(
                    'details',
                    { style: { marginTop: '10px', borderTop: `1px solid ${T.line}`, paddingTop: '8px' } },
                    h('summary', { style: { cursor: 'pointer', fontSize: '12px', color: T.text2 } }, `影响路径（${previewData.impact.paths.length}）`),
                    h(
                      'div',
                      { style: { marginTop: '6px', fontSize: '11.5px', color: T.text2, lineHeight: 1.8 } },
                      previewData.impact.paths.map((path, index) =>
                        h(
                          'div',
                          { key: index },
                          `${path.to} · 深度 ${path.depth}`,
                          path.relations?.length ? h('span', { style: { color: T.text3 } }, ` · ${path.relations.map((relation) => `${relation.from}→${relation.type}→${relation.to}`).join(' / ')}`) : null,
                        ),
                      ),
                    ),
                  )
                : null,
              previewData.impact?.blindSpots?.length
                ? h(
                    'div',
                    { style: { marginTop: '10px', border: `1px solid ${T.line}`, borderRadius: '10px', padding: '8px 12px' } },
                    h('div', { style: { color: T.warn, fontSize: '12px', marginBottom: '3px' } }, '盲区：未登记影响不等于无影响'),
                    previewData.impact.blindSpots.map((spot, index) =>
                      h(
                        'div',
                        { key: index, style: { fontSize: '12px', color: T.text2, lineHeight: 1.8 } },
                        `${spot.kind === 'no-relations' ? '未登记关系' : spot.kind === 'unresolved-target' ? '目标资产缺失' : '未知关系类型'}：${spot.detail}`,
                      ),
                    ),
                  )
                : null,
              previewData.impact?.coverage
                ? h('p', { style: { margin: '8px 0 0', ...muted } }, `扫描关系 ${previewData.impact.coverage.relations ?? 0} · 已探索 ${previewData.impact.coverage.explored ?? 0} · 深度上限 ${previewData.impact.coverage.maxDepth ?? 4}${previewData.impact.coverage.truncated ? ' · 已截断' : ''}`)
                : null,
              h('p', { style: { margin: '8px 0 0', ...muted } }, '影响是提示，不是阻塞；确认提交前请人工判断。'),
            )
          : null,
      )
    }

    const INTENT_ROUTE_LIST = [
      ['create', '新建需求草稿', '把这次改动写成一份新的需求草案'],
      ['change', '变更已有需求', '修改已存在承诺，保留修订历史'],
      ['reuse', '已被覆盖', '现有承诺已经覆盖，不必新写'],
      ['investigate', '先调查', '证据不足，先调查再决定'],
      ['decline', '建议暂缓或不做', '当前不建议做，记下理由'],
      ['answer', '直接答疑', '只是问题，不改动资产'],
    ]
    const INTENT_ROUTE_LABELS = INTENT_ROUTE_LIST.reduce((acc, entry) => {
      acc[entry[0]] = entry[1]
      return acc
    }, {})
    const INTENT_MATCH_LABELS = { covered: '已覆盖', related: '相关', conflict: '冲突', uncertain: '不确定' }
    const INTENT_UNKNOWN_LABELS = { clarify: '澄清', investigate: '转调查', exclude: '排除', pending: '待处理' }
    const INTENT_FIELDS = ['title', 'problem', 'goal', 'inScope', 'outOfScope', 'acceptance']
    const INTENT_SOURCE_TABS = [['text', '文字'], ['ocr', '图片 OCR'], ['chat', '聊天记录']]
    const INTENT_STAGES = ['读取项目上下文', '检索相关需求', '生成判断']
    const INTENT_STATE_LABELS = {
      editing: '正在编辑',
      analyzing: '分析中',
      needs_input: '待你回答',
      ready_for_confirmation: '可确认',
      committed: '已保存',
      cancelled: '已取消',
      failed: '失败',
    }
    const INTENT_VERDICT_LABELS = { answered: '已回答', 'partially-answered': '部分回答', 'not-determined': '未确定' }
    const INTENT_INVESTIGATION_STAGES = ['读取文件', '生成证据', '核对引用']

    function intentView(payload) {
      return payload?.session ?? payload?.data?.session ?? null
    }

    function intentAnalysisStatus(payload) {
      return payload?.analysisStatus ?? payload?.session?.analysisStatus ?? null
    }

    function intentInvestigationId(investigation) {
      return investigation?.investigationId ?? investigation?.id ?? null
    }

    function intentInvestigationList(payload) {
      const list = payload?.investigations ?? payload?.session?.investigations ?? []
      return Array.isArray(list) ? list : []
    }

    function intentInvestigationTime(investigation) {
      return intentTime(investigation?.finishedAt ?? investigation?.createdAt ?? investigation?.startedAt ?? null)
    }

    function intentRefLabel(ref) {
      if (!ref?.path) return ref?.ref ?? '未知来源'
      const line = ref.line === undefined || ref.line === null ? '' : `#L${ref.line}${ref.endLine ? `-${ref.endLine}` : ''}`
      return `${ref.path}${line}`
    }

    function intentSame(a, b) {
      return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
    }

    function intentLines(values) {
      return (values ?? []).join('\n')
    }

    function intentTime(iso) {
      if (!iso) return '—'
      const date = new Date(iso)
      return Number.isNaN(date.getTime()) ? String(iso) : date.toLocaleString()
    }

    function intentIdemKey() {
      return `ui-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`
    }

    function intentBriefOf(candidate) {
      const c = candidate ?? {}
      const parts = []
      if (c.problem) parts.push(`## 问题\n${c.problem}`)
      if (c.goal) parts.push(`## 目标\n${c.goal}`)
      if ((c.inScope ?? []).length) parts.push(`## 范围内\n${c.inScope.map((line) => `- ${line}`).join('\n')}`)
      if ((c.outOfScope ?? []).length) parts.push(`## 范围外\n${c.outOfScope.map((line) => `- ${line}`).join('\n')}`)
      if ((c.acceptance ?? []).length) {
        parts.push(
          `## 验收\n${c.acceptance
            .map((row) => `- 当 ${row.precondition || '—'}，${row.action || '—'}，应 ${row.expected || '—'}`)
            .join('\n')}`,
        )
      }
      return parts.join('\n\n')
    }

    function intentManualSession({ text, source, extractedText, attachment, projectId, projectName }) {
      return {
        sessionId: null,
        state: 'editing',
        manual: true,
        input: {
          text,
          source,
          extractedText: extractedText ?? '',
          attachment: attachment ?? null,
          inputRevision: 0,
          explicit: { owner: null, priority: null },
        },
        answers: [],
        runs: [],
        context: { projectId: projectId ?? null, projectName: projectName ?? null, queryStatus: 'not-queried', readSet: [], boundary: '本项目' },
        items: [
          {
            itemId: 'manual-1',
            sourceRefs: [],
            userProblem: text,
            desiredOutcome: '',
            recommendedRoute: 'create',
            routeRationale: '没有模型判断：去向与候选完全由你填写，仍需确认才会保存。',
            related: [],
            assumptions: [],
            unknowns: [],
            candidate: { title: '', problem: text, goal: '', inScope: [], outOfScope: [], acceptance: [] },
            counterexample: null,
            fields: {},
          },
        ],
        nextQuestion: null,
        confirmation: null,
        artifacts: [],
        receipt: null,
        readiness: null,
      }
    }

    function IntentModal({ root, project, projectName, projectId, requirementCount, onClose, onCreated, onOpenRequirement }) {
      const [screen, setScreen] = useState('input')
      const [rawText, setRawText] = useState('')
      const [source, setSource] = useState('text')
      const [attachment, setAttachment] = useState(null)
      const [chatMarkdown, setChatMarkdown] = useState('')
      const [intake, setIntake] = useState({ loading: false, error: null, data: null })
      const [ownerChoice, setOwnerChoice] = useState('')
      const [priorityChoice, setPriorityChoice] = useState('')
      const [session, setSession] = useState(null)
      const [manual, setManual] = useState({})
      const [routeChoices, setRouteChoices] = useState({})
      const [unknownChoices, setUnknownChoices] = useState({})
      const [conflicts, setConflicts] = useState([])
      const [busy, setBusy] = useState(false)
      const [editBusy, setEditBusy] = useState(false)
      const [error, setError] = useState(null)
      const [notice, setNotice] = useState(null)
      const [questionText, setQuestionText] = useState('')
      const [serverBlockers, setServerBlockers] = useState([])
      const [confirmState, setConfirmState] = useState({ loading: false, error: null, result: null })
      const [rehearsal, setRehearsal] = useState({ loading: false, error: null, data: null, base: null })
      const [receipt, setReceipt] = useState(null)
      const [answerChoice, setAnswerChoice] = useState(null)
      const [answerBusy, setAnswerBusy] = useState(false)
      const [answerElapsed, setAnswerElapsed] = useState(0)
      const [answerFeedback, setAnswerFeedback] = useState(null)
      const [investigations, setInvestigations] = useState([])
      const [investigation, setInvestigation] = useState({ open: false, busy: false, elapsed: 0, error: null, data: null, question: null, expandedId: null })
      const requestRef = useRef(0)
      const abortRef = useRef(null)
      const answerAbortRef = useRef(null)
      const answerPollRef = useRef(null)
      const answerTimerRef = useRef(null)
      const investAbortRef = useRef(null)
      const investTimerRef = useRef(null)
      const mountedRef = useRef(true)
      const sessionRef = useRef(null)
      const aiValuesRef = useRef({ inputRevision: null, values: {} })
      const idemRef = useRef(null)
      const screenHeadingRef = useRef(null)
      const editQueueRef = useRef(Promise.resolve())
      const editPendingRef = useRef(0)

      const fieldLabelStyle = { fontSize: '11px', letterSpacing: '.06em', textTransform: 'uppercase', color: T.text3 }
      const blockTitleStyle = { fontSize: '12px', fontWeight: 600, color: T.text }

      useEffect(() => {
        return () => {
          mountedRef.current = false
          requestRef.current += 1
          if (answerTimerRef.current) clearInterval(answerTimerRef.current)
          if (answerPollRef.current) clearTimeout(answerPollRef.current)
          if (investTimerRef.current) clearInterval(investTimerRef.current)
          for (const controller of [abortRef.current, answerAbortRef.current, investAbortRef.current]) {
            if (!controller) continue
            try {
              controller.abort()
            } catch {}
          }
        }
      }, [])

      useEffect(() => {
        if (!session || session.manual) return
        const explicit = session.input?.explicit ?? {}
        if (explicit.owner) setOwnerChoice((current) => current || explicit.owner)
        if (explicit.priority) setPriorityChoice((current) => current || explicit.priority)
      }, [session])

      useEffect(() => {
        if (screen === 'input') return
        const node = screenHeadingRef.current
        if (node && typeof node.focus === 'function') node.focus()
      }, [screen])

      const invalidateIdem = () => {
        idemRef.current = null
      }
      const beginRequest = () => {
        const token = requestRef.current + 1
        requestRef.current = token
        return token
      }
      const isCurrent = (token) => mountedRef.current && requestRef.current === token
      const setSessionView = (view) => {
        sessionRef.current = view ?? null
        if (mountedRef.current) setSession(view ?? null)
      }
      const stopTimer = (ref) => {
        if (ref.current) {
          clearInterval(ref.current)
          ref.current = null
        }
      }
      const startTimer = (ref, tick) => {
        stopTimer(ref)
        ref.current = setInterval(() => {
          if (!mountedRef.current) {
            stopTimer(ref)
            return
          }
          tick()
        }, 1000)
      }
      const trackInvestigations = (payload) => {
        const list = intentInvestigationList(payload)
        if (list.length === 0) return
        setInvestigations((current) => {
          const seen = new Map()
          for (const entry of [...list, ...current]) {
            const id = intentInvestigationId(entry)
            if (!id || seen.has(id)) continue
            seen.set(id, entry)
          }
          return [...seen.values()].slice(0, 20)
        })
      }
      const activeItems = () => (session?.items ?? []).filter((item) => !item.excluded)
      const routeOf = (item) => routeChoices[item?.itemId] ?? item?.recommendedRoute ?? 'create'
      const fieldWasEdited = (item, field) => (manual[item?.itemId] ?? {})[field] !== undefined
      const candidateOf = (item) => {
        const base = item?.candidate ?? {}
        const edited = manual[item?.itemId] ?? {}
        return {
          title: edited.title ?? base.title ?? '',
          problem: edited.problem ?? base.problem ?? '',
          goal: edited.goal ?? base.goal ?? '',
          inScope: edited.inScope ?? base.inScope ?? [],
          outOfScope: edited.outOfScope ?? base.outOfScope ?? [],
          acceptance: edited.acceptance ?? base.acceptance ?? [],
        }
      }
      const cleanCandidate = (candidate) => ({
        title: String(candidate.title ?? '').trim(),
        problem: String(candidate.problem ?? '').trim(),
        goal: String(candidate.goal ?? '').trim(),
        inScope: (candidate.inScope ?? []).map((line) => String(line).trim()).filter((line) => line !== ''),
        outOfScope: (candidate.outOfScope ?? []).map((line) => String(line).trim()).filter((line) => line !== ''),
        acceptance: (candidate.acceptance ?? []).map((row) => ({
          ...row,
          precondition: row?.precondition ?? '',
          action: row?.action ?? '',
          expected: row?.expected ?? '',
          judgement: row?.judgement ?? 'pass',
        })),
      })
      const changeBaseOf = (item) => {
        const related = item?.related ?? []
        return related.find((entry) => entry.match === 'covered' || entry.match === 'conflict') ?? related.find((entry) => entry.match === 'related') ?? related[0] ?? null
      }
      const relatedTitleOf = (entry) => {
        if (entry?.title) return entry.title
        const readSet = session?.context?.readSet ?? []
        const found = readSet.find((item) => item?.uid === entry?.uid || item?.id === entry?.uid)
        return found?.title ?? null
      }
      const errorOf = (caught) => ({
        code: caught?.code ?? null,
        status: caught?.status ?? null,
        message: caught?.message ?? String(caught),
        reasons: caught?.reasons ?? caught?.payload?.error?.reasons ?? [],
        appliedArtifacts: caught?.appliedArtifacts ?? caught?.payload?.error?.appliedArtifacts ?? [],
        manualFallback: caught?.manualFallback === true || caught?.payload?.manualFallback === true,
      })
      const setManualField = (itemId, field, value) => {
        invalidateIdem()
        setServerBlockers([])
        setManual((current) => ({ ...current, [itemId]: { ...(current[itemId] ?? {}), [field]: value } }))
      }
      const applySession = (view) => {
        if (!view) return
        const nextValues = {}
        for (const item of view.items ?? []) {
          const base = item.candidate ?? {}
          const fieldValues = {}
          for (const field of INTENT_FIELDS) fieldValues[field] = base[field] ?? (Array.isArray(base[field]) ? [] : '')
          nextValues[item.itemId] = fieldValues
        }
        const previous = aiValuesRef.current.values
        const found = []
        for (const item of view.items ?? []) {
          const edited = manual[item.itemId] ?? {}
          for (const field of INTENT_FIELDS) {
            if (edited[field] === undefined) continue
            const before = previous[item.itemId]?.[field]
            const after = nextValues[item.itemId]?.[field]
            if (before === undefined && after === undefined) continue
            if (before !== undefined && after !== undefined && !intentSame(before, after) && !intentSame(edited[field], after) && !intentSame(edited[field], before)) {
              found.push({ itemId: item.itemId, field, manualValue: edited[field], aiValue: after })
            }
          }
        }
        setConflicts(found)
        aiValuesRef.current = { inputRevision: view.input?.inputRevision ?? null, values: nextValues }
        // 手动模式下重新分析：把手填候选带到新会话的第一个意图项，避免从零重填。
        const carryFor = session?.manual ? manual['manual-1'] : null
        const firstNew = (view.items ?? []).find((item) => !item.excluded)
        if (carryFor && firstNew) {
          setManual((current) => (current[firstNew.itemId] ? current : { ...current, [firstNew.itemId]: carryFor }))
        }
        const previousRoutes = routeChoices
        const nextRoutes = {}
        for (const item of view.items ?? []) {
          if (previousRoutes[item.itemId] !== undefined) nextRoutes[item.itemId] = previousRoutes[item.itemId]
        }
        setRouteChoices(nextRoutes)
        setSessionView(view)
      }
      const runAnalyze = (options = {}) => {
        const text = String(options.textOverride ?? rawText).trim()
        if (text === '') {
          setError({ code: 'input-required', message: '请先用原话写下你想改变什么' })
          return
        }
        invalidateIdem()
        setServerBlockers([])
        setError(null)
        setNotice(null)
        setAnswerFeedback(null)
        const token = beginRequest()
        const controller = new AbortController()
        abortRef.current = controller
        setScreen('analyzing')
        setBusy(true)
        const investigationIds = (options.investigationIds ?? []).filter((id) => typeof id === 'string' && id !== '').slice(0, 5)
        const body = {
          action: 'analyze',
          projectId: projectId ?? project ?? undefined,
          input: {
            text,
            source,
            extractedText: intake.data?.text ?? '',
            attachment: attachment ? { name: attachment.name, kind: attachment.kind } : undefined,
          },
          explicit: { owner: ownerChoice.trim() || null, priority: priorityChoice || null },
        }
        if (investigationIds.length > 0) body.investigationIds = investigationIds
        const previous = sessionRef.current
        if (previous?.sessionId) body.sessionId = previous.sessionId
        writeJson('intent', body, root, { signal: controller.signal })
          .then((payload) => {
            if (!isCurrent(token)) return
            setBusy(false)
            const view = intentView(payload)
            if (!view) {
              setScreen('input')
              setError({ code: 'empty-response', message: '分析没有返回会话' })
              return
            }
            trackInvestigations(payload)
            applySession(view)
            setScreen('review')
            if (investigationIds.length > 0) setNotice('已把调查证据带入这次判断；证据仍需要你核对。')
          })
          .catch((caught) => {
            if (!isCurrent(token) || caught?.name === 'AbortError') return
            setBusy(false)
            const view = intentView(caught?.payload)
            if (view) applySession(view)
            const info = errorOf(caught)
            if (info.status === 503) {
              setNotice(`模型不可用：${info.message}。你仍可手动填写候选并保存会话，稍后再确认；现在不会创建任何需求。`)
              setScreen(view ? 'review' : 'input')
              return
            }
            setError(info)
            setScreen(view || (options.investigationIds ?? []).length > 0 ? 'review' : 'input')
          })
      }
      const cancelAnalyze = () => {
        requestRef.current += 1
        if (abortRef.current) {
          try {
            abortRef.current.abort()
          } catch {}
        }
        setBusy(false)
        setScreen('input')
        setNotice('已取消分析；旧结果不会写入界面。')
      }
      const startManual = () => {
        const text = rawText.trim()
        if (text === '') {
          setError({ code: 'input-required', message: '请先用原话写下你想改变什么，再手动填写候选' })
          return
        }
        requestRef.current += 1
        invalidateIdem()
        setError(null)
        setNotice('手动填写：没有调用模型。未保存前不会创建任何东西；要保存仍需先拿到服务端会话（可稍后点“重新分析”）。')
        const stub = intentManualSession({
          text,
          source,
          extractedText: intake.data?.text ?? '',
          attachment: attachment ? { name: attachment.name, kind: attachment.kind } : null,
          projectId: projectId ?? project,
          projectName,
        })
        aiValuesRef.current = { inputRevision: null, values: {} }
        setSessionView(stub)
        setScreen('review')
      }
      const answerPayload = () => {
        const question = session?.nextQuestion
        if (!question) return null
        const optionId = answerChoice && answerChoice !== 'unknown' ? answerChoice : undefined
        const text = answerChoice === 'unknown' ? '我不知道，需要调查' : questionText.trim() === '' ? undefined : questionText.trim()
        if (optionId === undefined && text === undefined) return null
        return { question, optionId, text }
      }
      const stopAnswerPoll = () => {
        if (answerPollRef.current) {
          clearTimeout(answerPollRef.current)
          answerPollRef.current = null
        }
      }
      // The answer request returns as soon as the answer is recorded; the
      // server re-runs the model in the background. Poll `load` until that run
      // finishes so the UI can show fresh candidates without blocking submit.
      const pollAnalysis = (sessionId, token) => {
        stopAnswerPoll()
        const startedAt = Date.now()
        const tick = () => {
          if (!mountedRef.current || requestRef.current !== token) return
          if (Date.now() - startedAt > 90_000) {
            setAnswerFeedback({ kind: 'error', message: '回答已记录，但重新分析超时；可点“重新分析”重试。' })
            return
          }
          writeJson('intent', { action: 'load', sessionId }, root)
            .then((payload) => {
              if (!mountedRef.current || requestRef.current !== token) return
              const view = intentView(payload)
              if (view) applySession(view)
              trackInvestigations(payload)
              const status = intentAnalysisStatus(payload)
              if (!status || status.status === 'running') {
                answerPollRef.current = setTimeout(tick, 800)
                return
              }
              answerPollRef.current = null
              if (status.status === 'done') {
                setAnswerFeedback({ kind: 'success', message: '已记录你的回答，候选已更新' })
              } else {
                setAnswerFeedback({ kind: 'error', message: `回答已记录，但重新分析失败：${status.error?.message ?? '未知错误'}；可点“重新分析”。` })
              }
            })
            .catch((caught) => {
              if (!mountedRef.current || requestRef.current !== token) return
              answerPollRef.current = null
              setAnswerFeedback({ kind: 'error', message: `回答已记录，但刷新会话失败：${caught.message ?? caught}` })
            })
        }
        answerPollRef.current = setTimeout(tick, 600)
      }
      const submitAnswer = () => {
        const payload = answerPayload()
        if (!payload || answerBusy || !session?.sessionId) return
        stopAnswerPoll()
        const token = beginRequest()
        const controller = new AbortController()
        answerAbortRef.current = controller
        setAnswerBusy(true)
        setAnswerElapsed(0)
        setAnswerFeedback(null)
        setError(null)
        startTimer(answerTimerRef, () => setAnswerElapsed((current) => current + 1))
        const body = {
          action: 'answer',
          sessionId: session.sessionId,
          expectedInputRevision: session.input?.inputRevision ?? 0,
          questionId: payload.question.questionId,
        }
        if (payload.optionId !== undefined) body.optionId = payload.optionId
        if (payload.text !== undefined) body.text = payload.text
        writeJson('intent', body, root, { signal: controller.signal })
          .then((response) => {
            if (answerAbortRef.current !== controller) return
            answerAbortRef.current = null
            stopTimer(answerTimerRef)
            if (!isCurrent(token)) {
              setAnswerBusy(false)
              return
            }
            setAnswerBusy(false)
            setAnswerChoice(null)
            setQuestionText('')
            invalidateIdem()
            const view = intentView(response)
            if (view) applySession(view)
            trackInvestigations(response)
            const status = intentAnalysisStatus(response)
            if (status?.status === 'running') {
              setAnswerFeedback({ kind: 'success', message: '已记录你的回答，正在更新候选…' })
              pollAnalysis(session.sessionId, token)
            } else if (status?.status === 'error') {
              setAnswerFeedback({ kind: 'error', message: `回答已记录，但重新分析失败：${status.error?.message ?? '未知错误'}；可点“重新分析”。` })
            } else {
              setAnswerFeedback({ kind: 'success', message: '已记录你的回答，已更新候选' })
            }
          })
          .catch((caught) => {
            if (answerAbortRef.current !== controller) return
            answerAbortRef.current = null
            stopTimer(answerTimerRef)
            if (!isCurrent(token)) {
              setAnswerBusy(false)
              return
            }
            setAnswerBusy(false)
            if (caught?.name === 'AbortError') {
              setAnswerFeedback({ kind: 'error', message: '提交已取消；已选内容仍保留，可重试。', retry: true })
              return
            }
            const info = errorOf(caught)
            setAnswerFeedback({ kind: 'error', message: `提交失败：${info.message}`, retry: true })
            if (info.code === 'stale-input' || info.code === 'stale-context') {
              setAnswerChoice(null)
              setNotice(`会话已变化（${info.message}）；已回答的内容可能没有写入，已刷新会话，请重试。`)
              loadLatestSession(session.sessionId)
                .then((result) => {
                  const view = result?.view
                  if (view && mountedRef.current && sessionRef.current?.sessionId === session.sessionId) applySession(view)
                  if (result?.payload) trackInvestigations(result.payload)
                })
                .catch(() => {})
            }
          })
      }
      const cancelAnswer = () => {
        const controller = answerAbortRef.current
        answerAbortRef.current = null
        if (controller) {
          try {
            controller.abort()
          } catch {}
        }
        stopTimer(answerTimerRef)
        setAnswerBusy(false)
        setAnswerFeedback({ kind: 'error', message: '已取消提交；已选内容仍保留，可重试。', retry: true })
      }
      const mergeInvestigations = (list) => {
        if (!Array.isArray(list) || list.length === 0) return
        setInvestigations((current) => {
          const seen = new Map()
          for (const entry of [...list, ...current]) {
            const id = intentInvestigationId(entry)
            if (!id || seen.has(id)) continue
            seen.set(id, entry)
          }
          return [...seen.values()].slice(0, 20)
        })
      }
      const startInvestigation = (focus) => {
        const current = sessionRef.current
        if (!current?.sessionId) return
        const question = current.nextQuestion
        const questionId = question?.questionId ?? null
        const text = String(focus ?? question?.text ?? '').trim()
        if (text === '') return
        if (investAbortRef.current) {
          try {
            investAbortRef.current.abort()
          } catch {}
        }
        const controller = new AbortController()
        investAbortRef.current = controller
        setInvestigation({ open: true, busy: true, elapsed: 0, error: null, data: null, question: { questionId, text }, expandedId: null })
        startTimer(investTimerRef, () => {
          setInvestigation((current) => ({ ...current, elapsed: current.elapsed + 1 }))
        })
        const body = {
          action: 'investigate',
          sessionId: current.sessionId,
          questionId,
          question: text,
        }
        writeJson('intent', body, root, { signal: controller.signal })
          .then((payload) => {
            if (investAbortRef.current !== controller) return
            investAbortRef.current = null
            stopTimer(investTimerRef)
            if (!mountedRef.current) return
            const data = payload?.investigation ?? payload?.data?.investigation ?? null
            if (!data) throw new Error('调查没有返回证据')
            mergeInvestigations([data, ...intentInvestigationList(payload)])
            setInvestigation((state) => ({ ...state, busy: false, error: null, data }))
          })
          .catch((caught) => {
            if (investAbortRef.current !== controller) return
            investAbortRef.current = null
            stopTimer(investTimerRef)
            if (!mountedRef.current) return
            if (caught?.name === 'AbortError') {
              setInvestigation((state) => ({ ...state, busy: false, error: { code: 'cancelled', message: '调查已取消；没有写入任何证据。' } }))
              return
            }
            const info = errorOf(caught)
            const hint =
              info.code === 'outside-root'
                ? '当前项目的可读边界之外的内容不会被读取，请缩小到本项目。'
                : info.code === 'too-large'
                  ? '问题太大，请把问题缩小到一个具体行为或文件。'
                  : info.code === 'no-question'
                    ? '请先写下要调查的问题。'
                    : info.status === 503
                      ? '模型暂不可用，稍后重试；这不会影响你已经填写的内容。'
                      : info.status === 502
                        ? '模型这次没有给出可校验的证据，稍后重试。'
                        : null
            setInvestigation((state) => ({ ...state, busy: false, error: { ...info, hint } }))
          })
      }
      const cancelInvestigation = () => {
        const controller = investAbortRef.current
        investAbortRef.current = null
        if (controller) {
          try {
            controller.abort()
          } catch {}
        }
        stopTimer(investTimerRef)
        setInvestigation((state) => ({ ...state, busy: false }))
      }
      const reanalyzeWithEvidence = () => {
        const list = investigations.slice(0, 5)
        const ids = list.map(intentInvestigationId).filter(Boolean)
        if (ids.length === 0) {
          setNotice('还没有可用的调查证据；先点“调查这个问题（只读）”。')
          return
        }
        setInvestigation((state) => ({ ...state, open: false }))
        runAnalyze({ investigationIds: ids })
      }
      const loadLatestSession = (sessionId) => {
        return fetch(`/api/alm/requirements/intent?session=${encodeURIComponent(sessionId)}&root=${encodeURIComponent(root)}`, {
          headers: { accept: 'application/json' },
        }).then(async (response) => {
          const payload = await response.json().catch(() => null)
          if (!response.ok || payload?.ok === false) throw new Error(payload?.error?.message ?? `HTTP ${response.status}`)
          return { view: intentView(payload), payload }
        })
      }
      const sendEdit = (fields, itemId) => {
        const current = sessionRef.current
        if (!current?.sessionId) return Promise.resolve(null)
        const body = {
          action: 'edit',
          sessionId: current.sessionId,
          expectedInputRevision: current.input?.inputRevision ?? 0,
          fields,
        }
        if (itemId) body.itemId = itemId
        editPendingRef.current += 1
        setEditBusy(true)
        const run = () =>
          writeJson('intent', body, root).then((payload) => {
            if (!mountedRef.current) return null
            const view = intentView(payload)
            const live = sessionRef.current
            // 迟到响应：会话或输入版本已变化时丢弃，旧响应不得覆盖新输入/新会话。
            if (!view || live?.sessionId !== current.sessionId || (live?.input?.inputRevision ?? 0) !== (current.input?.inputRevision ?? 0)) return null
            sessionRef.current = view
            setSession(view)
            return view
          })
        const queued = editQueueRef.current.then(run, run)
        editQueueRef.current = queued.catch(() => {})
        return queued
          .catch((caught) => {
            if (!mountedRef.current) return null
            const info = errorOf(caught)
            setError(info)
            if (info.code === 'stale-input' || info.code === 'stale-context') {
              setNotice(`会话已变化（${info.message}）；已刷新，请再确认一次。`)
              invalidateIdem()
              loadLatestSession(current.sessionId)
                .then((result) => {
                  const view = result?.view
                  if (view && mountedRef.current && view.sessionId === current.sessionId && sessionRef.current?.sessionId === current.sessionId) applySession(view)
                  if (result?.payload) trackInvestigations(result.payload)
                })
                .catch(() => {})
            }
            return null
          })
          .finally(() => {
            editPendingRef.current -= 1
            if (mountedRef.current && editPendingRef.current === 0) setEditBusy(false)
          })
      }
      const chooseRoute = (item, route) => {
        invalidateIdem()
        setServerBlockers([])
        setRouteChoices((current) => ({ ...current, [item.itemId]: route }))
        sendEdit({ route }, item.itemId)
      }
      const changeOwner = (value) => {
        invalidateIdem()
        setServerBlockers([])
        setOwnerChoice(value)
        sendEdit({ owner: value.trim() || null })
      }
      const changePriority = (value) => {
        invalidateIdem()
        setServerBlockers([])
        setPriorityChoice(value)
        sendEdit({ priority: value || null })
      }
      const chooseUnknown = (item, index, resolution) => {
        invalidateIdem()
        setServerBlockers([])
        setUnknownChoices((current) => ({ ...current, [`${item.itemId}:${index}`]: resolution }))
        sendEdit(
          {
            unknownResolutions: [
              {
                itemId: item.itemId,
                index,
                description: item.unknowns?.[index]?.description ?? '',
                resolution,
              },
            ],
          },
          item.itemId,
        )
      }
      const resolveConflict = (conflict, useAi) => {
        if (useAi) setManualField(conflict.itemId, conflict.field, conflict.aiValue)
        setConflicts((current) => current.filter((entry) => !(entry.itemId === conflict.itemId && entry.field === conflict.field)))
      }
      const flushAllEdits = () => {
        const current = sessionRef.current
        if (!current?.sessionId) return Promise.resolve(null)
        const items = current.items ?? []
        const merged = items.map((item) => ({ item, candidate: cleanCandidate(candidateOf(item)), route: routeOf(item) }))
        const resolutions = Object.entries(unknownChoices).map(([key, resolution]) => {
          const separator = key.indexOf(':')
          return { itemId: key.slice(0, separator), index: Number(key.slice(separator + 1)), resolution }
        })
        if (merged.length === 0) return Promise.resolve(null)
        const primary = merged[0]
        const fields = {
          route: primary.route,
          title: primary.candidate.title,
          problem: primary.candidate.problem,
          goal: primary.candidate.goal,
          inScope: primary.candidate.inScope,
          outOfScope: primary.candidate.outOfScope,
          acceptance: primary.candidate.acceptance,
        }
        if (ownerChoice.trim()) fields.owner = ownerChoice.trim()
        if (priorityChoice) fields.priority = priorityChoice
        if (resolutions.length) fields.unknownResolutions = resolutions
        let chain = sendEdit(fields, primary.item.itemId)
        for (const entry of merged.slice(1)) {
          chain = chain.then(() =>
            sendEdit(
              {
                route: entry.route,
                title: entry.candidate.title,
                problem: entry.candidate.problem,
                goal: entry.candidate.goal,
                inScope: entry.candidate.inScope,
                outOfScope: entry.candidate.outOfScope,
                acceptance: entry.candidate.acceptance,
              },
              entry.item.itemId,
            ),
          )
        }
        return chain
      }
      // An unanswered question blocks saving only while it could still change the
      // route or scope. If every item has been routed to "investigate", the open
      // question *is* the research question that gets saved with the investigation.
      const openQuestionBlocks = () => {
        if (!session?.nextQuestion) return false
        const items = activeItems()
        if (items.length === 0) return true
        return !items.every((item) => routeOf(item) === 'investigate')
      }
      const reviewReadiness = () => {
        const reasons = []
        if (!session) reasons.push({ code: 'no-session', message: '还没有分析结果' })
        else {
          if (session.state === 'committed') reasons.push({ code: 'already-committed', message: '这份草案已经保存过' })
          if (openQuestionBlocks()) reasons.push({ code: 'open-question', message: '还有一个会影响判断的问题未回答' })
          if (activeItems().length === 0) reasons.push({ code: 'no-items', message: '没有可确认的意图项' })
        }
        return { ready: reasons.length === 0, reasons }
      }
      const confirmReadiness = () => {
        const reasons = []
        if (!session) reasons.push({ code: 'no-session', message: '还没有分析结果' })
        else {
          if (!session.sessionId) reasons.push({ code: 'no-session-id', message: '服务端还没有会话（可能是模型不可用）；请重新分析以保存' })
          if (session.state === 'committed') reasons.push({ code: 'already-committed', message: '这份草案已经保存过' })
          if (openQuestionBlocks()) reasons.push({ code: 'open-question', message: '还有一个会影响判断的问题未回答' })
          for (const item of activeItems()) {
            const route = routeOf(item)
            const candidate = candidateOf(item)
            if (route === 'create' && String(candidate.title ?? '').trim() === '') {
              reasons.push({ code: 'candidate-title-required', itemId: item.itemId, message: '新建需求需要先填写标题' })
            }
            if (route === 'create' && !priorityChoice) {
              reasons.push({ code: 'needs-priority', message: '需要你明确选择优先级（优先级不猜）' })
            }
            if (route === 'change' && !changeBaseOf(item)) {
              reasons.push({ code: 'change-needs-requirement', itemId: item.itemId, message: '变更需要先选择要修改的既有承诺' })
            }
            const pendingBlocking = (item.unknowns ?? []).filter(
              (unknown, index) => unknown.blocking && (unknownChoices[`${item.itemId}:${index}`] ?? unknown.resolution ?? 'pending') === 'pending',
            )
            if (pendingBlocking.length) reasons.push({ code: 'blocking-unknown', itemId: item.itemId, message: '有阻塞性未知项还没处理（澄清 / 转调查 / 排除）' })
          }
          for (const reason of serverBlockers) reasons.push(reason)
        }
        return { ready: reasons.length === 0, reasons }
      }
      const enterConfirm = () => {
        if (!idemRef.current) idemRef.current = intentIdemKey()
        setConfirmState({ loading: false, error: null, result: null })
        setScreen('confirm')
      }
      const submitConfirm = () => {
        if (confirmState.loading) return
        const current = sessionRef.current ?? session
        if (!current?.sessionId) {
          setConfirmState({ loading: false, error: { code: 'no-session', message: '服务端还没有这份会话，无法保存；请先重新分析。' }, result: null })
          return
        }
        const gate = confirmReadiness()
        if (!gate.ready) {
          setConfirmState({ loading: false, error: { code: 'not-ready', message: '还不能保存', reasons: gate.reasons }, result: null })
          requestAnimationFrame(() => {
            const node = screenHeadingRef.current
            if (node && typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'start', behavior: 'smooth' })
          })
          return
        }
        if (!idemRef.current) idemRef.current = intentIdemKey()
        setConfirmState({ loading: true, error: null, result: null })
        setError(null)
        flushAllEdits()
          .then(() => {
            if (!mountedRef.current) return null
            const latest = sessionRef.current ?? current
            const items = (latest.items ?? [])
              .filter((item) => !item.excluded)
              .map((item) => ({
                itemId: item.itemId,
                route: routeOf(item),
                candidate: cleanCandidate(candidateOf(item)),
                unknowns: (item.unknowns ?? []).map((unknown, index) => ({
                  ...unknown,
                  resolution: unknownChoices[`${item.itemId}:${index}`] ?? unknown.resolution ?? 'pending',
                })),
              }))
            const leadItem = items[0] ?? null
            const body = {
              action: 'confirm',
              sessionId: latest.sessionId,
              expectedInputRevision: latest.input?.inputRevision ?? 0,
              contextSnapshotId: latest.context?.contextSnapshotId ?? null,
              confirmation: {
                contentHash: latest.confirmation?.contentHash ?? latest.contentHash ?? null,
                route: leadItem?.route ?? 'create',
                items,
                owner: ownerChoice.trim() || null,
                priority: priorityChoice || null,
              },
              idempotencyKey: idemRef.current,
              actor: 'human:local',
            }
            return writeJson('intent', body, root)
          })
          .then((payload) => {
            if (!mountedRef.current || !payload) return
            setReceipt({ receipt: payload.receipt ?? null, artifacts: payload.artifacts ?? [], replayed: payload.replayed === true })
            setConfirmState({ loading: false, error: null, result: payload })
            setScreen('receipt')
          })
          .catch((caught) => {
            if (!mountedRef.current) return
            const info = errorOf(caught)
            if (info.code === 'stale-input' || info.code === 'stale-context') {
              invalidateIdem()
              loadLatestSession(current.sessionId)
                .then((result) => {
                  const view = result?.view
                  if (view && mountedRef.current && view.sessionId === current.sessionId && sessionRef.current?.sessionId === current.sessionId) applySession(view)
                  if (result?.payload) trackInvestigations(result.payload)
                })
                .catch(() => {})
              setConfirmState({
                loading: false,
                error: { ...info, message: `上下文或输入已变化（${info.message}）。已刷新会话，请核对后再次确认。` },
                result: null,
              })
              return
            }
            if (info.code === 'not-ready') {
              setServerBlockers(info.reasons ?? [])
              setConfirmState({ loading: false, error: { ...info, message: '后端判定还不能保存' }, result: null })
              return
            }
            setConfirmState({ loading: false, error: info, result: null })
          })
      }
      const finish = () => {
        const artifacts = receipt?.artifacts ?? []
        const requirement = artifacts.find((artifact) => artifact.kind === 'requirement')
        if (onCreated) onCreated({ requirementId: requirement?.id ?? null, artifacts })
        onClose()
      }
      const handleClose = () => {
        if (screen === 'receipt') {
          finish()
          return
        }
        if (sessionRef.current?.sessionId && (screen === 'review' || screen === 'confirm')) flushAllEdits().catch(() => {})
        onClose()
      }
      const postpone = () => {
        requestRef.current += 1
        if (sessionRef.current?.sessionId) flushAllEdits().catch(() => {})
        onClose()
      }
      const saveAndLeave = () => {
        flushAllEdits().catch(() => {})
        onClose()
      }
      const loadRehearsal = () => {
        const changeItems = activeItems().filter((item) => routeOf(item) === 'change')
        const first = changeItems[0]
        if (!first) {
          setRehearsal({ loading: false, error: null, data: null, base: null })
          return
        }
        const base = changeBaseOf(first)
        if (!base?.uid) {
          setRehearsal({ loading: false, error: null, data: null, base: base ?? null })
          return
        }
        const candidate = cleanCandidate(candidateOf(first))
        const changes = []
        if (candidate.title) changes.push({ field: 'title', value: candidate.title })
        const brief = intentBriefOf(candidate)
        if (brief) changes.push({ field: 'brief', value: brief })
        if (changes.length === 0) {
          setRehearsal({ loading: false, error: null, data: null, base })
          return
        }
        setRehearsal({ loading: true, error: null, data: null, base })
        const requestPreview = (list) => postJson('requirements/rehearsal', { requirementId: base.uid, changes: list, apply: false }, root)
        requestPreview(changes)
          .catch((caught) => {
            // 没有 BRIEF 字段的需求无法预演 brief 变更；降级为仅标题差异，仍然只读。
            const info = errorOf(caught)
            const titleOnly = changes.filter((entry) => entry.field === 'title')
            if (info.code === 'brief-missing' && titleOnly.length > 0) return requestPreview(titleOnly)
            throw caught
          })
          .then((payload) => {
            if (mountedRef.current) setRehearsal({ loading: false, error: null, data: payload, base })
          })
          .catch((caught) => {
            if (mountedRef.current) setRehearsal({ loading: false, error: caught.message, data: null, base })
          })
      }
      useEffect(() => {
        if (screen === 'confirm') loadRehearsal()
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [screen, session?.sessionId, session?.input?.inputRevision])

      const tonePill = (tone, text, key) => {
        const colors = EVIDENCE_TONE[tone] ?? EVIDENCE_TONE.neutral
        return h(
          'span',
          {
            key: key ?? `${tone}-${text}`,
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              border: `1px solid ${T.line2}`,
              borderRadius: '999px',
              padding: '1px 8px',
              fontSize: '11.5px',
              color: colors.color,
              background: colors.bg,
              whiteSpace: 'nowrap',
            },
          },
          text,
        )
      }
      const contextCell = (label, value) =>
        h(
          'div',
          { key: label, style: { minWidth: 0 } },
          h('div', { style: { fontSize: '10.5px', letterSpacing: '.06em', textTransform: 'uppercase', color: T.text3 } }, label),
          h('div', { style: { marginTop: '2px', fontSize: '12.5px', color: T.text, wordBreak: 'break-word' } }, value),
        )
      const fieldBlock = (label, tag, control) =>
        h(
          'div',
          { style: { marginTop: '8px' } },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginBottom: '3px' } },
            h('span', { style: { fontSize: '11px', letterSpacing: '.06em', textTransform: 'uppercase', color: T.text3 } }, label),
            tag,
          ),
          control,
        )
      const sourceTag = (edited) =>
        h(
          'span',
          { style: { fontSize: '10.5px', color: edited ? T.warn : T.text3, border: `1px solid ${T.line2}`, borderRadius: '5px', padding: '0 5px' } },
          edited ? '已手改' : 'AI 候选',
        )
      const linesField = (label, values, onChange) =>
        h(
          'div',
          { style: { marginTop: '8px' } },
          h('div', { style: fieldLabelStyle }, label),
          h('textarea', {
            value: intentLines(values),
            onChange: (event) => onChange(event.target.value.split('\n')),
            placeholder: '每行一条；留空表示暂无',
            style: { ...input, width: '100%', minWidth: 0, minHeight: '48px', resize: 'vertical', fontFamily: 'inherit' },
          }),
        )
      const acceptanceInput = (item, list, index, key, placeholder) =>
        h('input', {
          key,
          value: list?.[index]?.[key] ?? '',
          placeholder,
          onChange: (event) => {
            const next = (list ?? []).map((row, position) => (position === index ? { ...row, [key]: event.target.value } : row))
            setManualField(item.itemId, 'acceptance', next)
          },
          style: { ...input, width: '100%', minWidth: 0, marginTop: '4px' },
        })
      const renderAcceptance = (item, list) =>
        h(
          'div',
          { style: { marginTop: '10px' } },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' } },
            h('span', { style: fieldLabelStyle }, `验收标准（${(list ?? []).length} 条）`),
            h(
              'button',
              {
                type: 'button',
                style: { ...button, padding: '2px 9px', fontSize: '11px' },
                onClick: () =>
                  setManualField(item.itemId, 'acceptance', [...(list ?? []), { precondition: '', action: '', expected: '', judgement: 'pass' }]),
              },
              '＋ 加一条',
            ),
          ),
          (list ?? []).map((row, index) =>
            h(
              'div',
              { key: index, style: { border: `1px solid ${T.line}`, borderRadius: '9px', padding: '8px 10px', marginTop: '6px', background: T.layer } },
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' } },
                h('span', { style: { fontSize: '11px', color: T.text3 } }, `验收 ${index + 1}`),
                h(
                  'button',
                  {
                    type: 'button',
                    style: { ...button, padding: '0 8px', fontSize: '11px' },
                    onClick: () => setManualField(item.itemId, 'acceptance', (list ?? []).filter((_, position) => position !== index)),
                  },
                  '删除',
                ),
              ),
              acceptanceInput(item, list, index, 'precondition', '前置条件'),
              acceptanceInput(item, list, index, 'action', '动作'),
              acceptanceInput(item, list, index, 'expected', '期望结果'),
              acceptanceInput(item, list, index, 'judgement', '判定（pass / fail）'),
            ),
          ),
        )
      const runIntake = (body) => {
        setIntake({ loading: true, error: null, data: null })
        writeJson('intake', body, root)
          .then((data) => {
            if (!mountedRef.current) return
            setIntake({ loading: false, error: null, data })
            const text = data?.text ?? ''
            if (text) setRawText((current) => (current.trim() === '' ? text : `${current.trim()}\n${text}`))
          })
          .catch((caught) => {
            if (mountedRef.current) setIntake({ loading: false, error: caught.message, data: null })
          })
      }
      const ingestImage = (file) => {
        if (!file) return
        setSource('ocr')
        setAttachment({ name: String(file.name || 'screenshot.png').replace(/[^A-Za-z0-9._-]/g, '_'), kind: 'screenshot' })
        const reader = new FileReader()
        reader.onload = () => {
          const base64 = String(reader.result ?? '').split(',')[1] ?? ''
          if (!base64) {
            setIntake({ loading: false, error: '读取图片失败', data: null })
            return
          }
          setAttachment({ name: String(file.name || 'screenshot.png').replace(/[^A-Za-z0-9._-]/g, '_'), kind: 'screenshot', dataBase64: base64 })
          runIntake({ mode: 'ocr', filename: file.name || 'screenshot.png', imageBase64: base64 })
        }
        reader.onerror = () => setIntake({ loading: false, error: '读取图片失败', data: null })
        reader.readAsDataURL(file)
      }
      const onFile = (event) => {
        const file = event.target.files?.[0]
        if (!file) return
        ingestImage(file)
      }
      const onPasteImage = (event) => {
        const items = Array.from(event.clipboardData?.items ?? [])
        const imageItem = items.find((entry) => entry.kind === 'file' && String(entry.type).startsWith('image/'))
        if (!imageItem) return
        const file = imageItem.getAsFile()
        if (!file) return
        event.preventDefault()
        setNotice('已从剪贴板读取图片，正在本地 OCR；识别结果会写入原话。')
        ingestImage(file)
      }
      const useRecognizedText = (text) => {
        if (!text) return
        setRawText((current) => (current.trim() === '' ? text : `${current.trim()}\n${text}`))
      }
      const renderSourcePanel = () => {
        if (source === 'text') return null
        const parsed = intake.data
        if (source === 'ocr') {
          return h(
            'div',
            { style: { border: `1px solid ${T.line}`, borderRadius: '10px', padding: '12px', marginTop: '8px' } },
            h('input', { type: 'file', accept: 'image/*', onChange: onFile, 'aria-label': '选择截图做本地 OCR', style: { fontSize: '12px', color: T.text2 } }),
            attachment ? h('p', { style: { margin: '6px 0 0', ...muted } }, `已选择：${attachment.name}`) : null,
            intake.loading ? h('p', { style: { margin: '6px 0 0', ...muted } }, '正在本地 OCR（离线 PP-OCRv5）…') : null,
            intake.error ? h('p', { style: { margin: '6px 0 0', color: T.err, fontSize: '12.5px' } }, intake.error) : null,
            parsed?.schema === 'alm.ocr/v1'
              ? h(
                  'div',
                  null,
                  h('p', { style: { margin: '8px 0 4px', fontSize: '12px', color: T.text2 } }, `识别 ${parsed.lines.length} 行 · ${parsed.lowConfidence} 行低置信度`),
                  h(
                    'pre',
                    { style: { margin: 0, padding: '8px', maxHeight: '150px', overflow: 'auto', background: T.layer, border: `1px solid ${T.line}`, borderRadius: '8px', fontSize: '11.5px', whiteSpace: 'pre-wrap' } },
                    parsed.lines.map((line) => `${line.ref}  ${line.text}  (${Math.round(line.confidence * 100)}%)`).join('\n'),
                  ),
                  h('button', { type: 'button', style: { ...button, marginTop: '8px' }, onClick: () => useRecognizedText(parsed.text) }, '把识别文本加入原话'),
                )
              : null,
          )
        }
        return h(
          'div',
          { style: { border: `1px solid ${T.line}`, borderRadius: '10px', padding: '12px', marginTop: '8px' } },
          h('textarea', {
            value: chatMarkdown,
            onChange: (event) => setChatMarkdown(event.target.value),
            placeholder: '粘贴聊天记录，例如：10:12 张三：退款要幂等',
            style: { ...input, minWidth: 0, minHeight: '80px', resize: 'vertical', fontFamily: 'inherit', width: '100%' },
          }),
          h(
            'button',
            {
              type: 'button',
              style: { ...button, marginTop: '8px' },
              onClick: () => {
                if (chatMarkdown.trim() === '') return
                setAttachment({ name: 'chat.md', kind: 'chat', text: chatMarkdown })
                runIntake({ mode: 'chat', markdown: chatMarkdown })
              },
            },
            '解析聊天',
          ),
          intake.loading ? h('p', { style: { margin: '6px 0 0', ...muted } }, '正在解析聊天记录…') : null,
          intake.error ? h('p', { style: { margin: '6px 0 0', color: T.err, fontSize: '12.5px' } }, intake.error) : null,
          parsed?.schema === 'alm.intake.chat/v1'
            ? h(
                'div',
                null,
                h('p', { style: { margin: '8px 0 4px', fontSize: '12px', color: T.text2 } }, `解析 ${parsed.messages.length} 条消息`),
                h(
                  'div',
                  { style: { maxHeight: '140px', overflow: 'auto', border: `1px solid ${T.line}`, borderRadius: '8px', padding: '6px 10px' } },
                  parsed.messages.map((message) =>
                    h(
                      'div',
                      { key: message.id, style: { padding: '3px 0', fontSize: '12px', color: T.text2, borderBottom: `1px solid ${T.line}` } },
                      h('span', { style: { color: T.text3, marginRight: '6px' } }, message.ref),
                      h('b', { style: { color: T.text, fontWeight: 500 } }, message.speaker || '—'),
                      ` ${message.text}`,
                    ),
                  ),
                ),
                h('button', { type: 'button', style: { ...button, marginTop: '8px' }, onClick: () => useRecognizedText(parsed.text) }, '把聊天内容加入原话'),
              )
            : null,
        )
      }
      const renderInput = () =>
        h(
          'div',
          { style: { marginTop: '6px' } },
          h(
            'div',
            { style: { ...card, cursor: 'default', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' } },
            contextCell('项目', projectName ?? project ?? '—'),
            contextCell('项目 ID', project ?? '—'),
            contextCell('可读需求', requirementCount === undefined || requirementCount === null ? '—' : `${requirementCount} 条`),
            contextCell('只读边界', '本项目（只读检索，不写入其他项目）'),
          ),
          h(
            'div',
            { style: { marginTop: '14px' } },
            h(
              'label',
              { style: { display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '12px', color: T.text2 } },
              '用你自己的话写下想改变什么（必填）',
              h('textarea', {
                value: rawText,
                autoFocus: true,
                onPaste: onPasteImage,
                onChange: (event) => {
                  setRawText(event.target.value)
                  setError(null)
                },
                placeholder: '例如：退款这里老是重复退，财务对账很麻烦；要保证同一笔订单只退一次，并发也不能重复扣款。',
                style: { ...input, minWidth: 0, width: '100%', minHeight: '96px', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.8, boxSizing: 'border-box' },
              }),
              h('span', { style: { fontSize: '11.5px', color: T.text3 } }, '可以直接粘贴截图（Ctrl/⌘+V），会自动本地 OCR 并写入原话。'),
            ),
            h(
              'div',
              { style: { display: 'flex', gap: '6px', marginTop: '12px', borderBottom: `1px solid ${T.line}`, paddingBottom: '8px', flexWrap: 'wrap' } },
              INTENT_SOURCE_TABS.map(([id, label]) =>
                h(
                  'button',
                  {
                    key: id,
                    type: 'button',
                    'aria-pressed': source === id,
                    onClick: () => setSource(id),
                    style: {
                      border: 0,
                      background: source === id ? T.layer2 : 'transparent',
                      color: source === id ? T.text : T.text2,
                      borderRadius: '7px',
                      padding: '5px 12px',
                      fontSize: '12.5px',
                      cursor: 'pointer',
                    },
                  },
                  label,
                ),
              ),
            ),
            renderSourcePanel(),
            h(
              'div',
              { style: { ...card, cursor: 'default', marginTop: '12px' } },
              h('div', { style: { fontSize: '12px', color: T.text2, fontWeight: 500 } }, '可选的明确信息'),
              h('p', { style: { margin: '4px 0 0', ...muted, lineHeight: 1.7 } }, '只有你在原话或这里明确说的才会填；不填就不会指派负责人，也不会猜优先级。'),
              h(
                'div',
                { style: { display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '8px' } },
                h(
                  'label',
                  { style: { display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', color: T.text2, flex: '1 1 160px', minWidth: 0 } },
                  '负责人（可选）',
                  h('input', { value: ownerChoice, onChange: (event) => setOwnerChoice(event.target.value), placeholder: '例如：李楠', style: { ...input, width: '100%', minWidth: 0 } }),
                ),
                h(
                  'label',
                  { style: { display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', color: T.text2, flex: '0 1 150px', minWidth: 0 } },
                  '优先级（可选）',
                  h(
                    'select',
                    { value: priorityChoice, onChange: (event) => setPriorityChoice(event.target.value), style: { ...input, width: '100%', minWidth: 0 } },
                    h('option', { value: '' }, '未指定（不猜）'),
                    ['P0', 'P1', 'P2'].map((value) => h('option', { key: value, value }, value)),
                  ),
                ),
              ),
            ),
          ),
          notice ? h('p', { style: { margin: '10px 0 0', color: T.text2, fontSize: '12px', lineHeight: 1.7 } }, notice) : null,
          error ? renderError(error) : null,
        )
      const renderAnalyzing = () =>
        h(
          'div',
          { style: { marginTop: '10px' } },
          h(
            'div',
            { style: { ...card, cursor: 'default' } },
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
              tonePill('neutral', '分析中'),
              h('span', { style: muted }, '只显示真实阶段，不伪造进度百分比'),
            ),
            h(
              'ul',
              { style: { margin: '10px 0 0', paddingLeft: '20px', fontSize: '12.5px', lineHeight: 2, color: T.text2 } },
              INTENT_STAGES.map((label) => h('li', { key: label }, label)),
            ),
            h('p', { style: { margin: '10px 0 0', ...muted } }, '这次请求会依次做这三件事；没有伪造的进度百分比。取消后旧结果不会写入界面。'),
          ),
        )
      const renderQuestion = () => {
        const question = session?.nextQuestion
        if (!question) return null
        const options = (question.options ?? []).slice(0, 3)
        const selected = answerChoice
        const canSubmit = selected !== null || questionText.trim() !== ''
        const select = (id) => {
          if (answerBusy) return
          setAnswerFeedback(null)
          setAnswerChoice((current) => (current === id ? null : id))
        }
        return h(
          'div',
          { style: { ...card, cursor: 'default', marginTop: '12px', borderColor: T.line2 } },
          h(
            'div',
            { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
            tonePill('neutral', '需要你回答一个问题'),
            h('span', { style: muted }, '一次只问一个；先选择，再提交'),
          ),
          h('div', { style: { marginTop: '8px', fontSize: '13.5px', color: T.text, lineHeight: 1.8 } }, question.text),
          question.whyNow ? h('p', { style: { margin: '4px 0 0', ...muted, lineHeight: 1.7 } }, `为什么现在问：${question.whyNow}`) : null,
          h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '10px' } },
            options.map((option) => {
              const active = selected === option.id
              return h(
                'button',
                {
                  key: option.id,
                  type: 'button',
                  'aria-pressed': active,
                  disabled: answerBusy,
                  onClick: () => select(option.id),
                  style: {
                    textAlign: 'left',
                    ...button,
                    padding: '8px 10px',
                    display: 'flex',
                    gap: '8px',
                    alignItems: 'flex-start',
                    width: '100%',
                    borderColor: active ? T.brand : T.line,
                    background: active ? T.layer2 : T.layer,
                    boxShadow: active ? `inset 0 0 0 1px ${T.brand}` : 'none',
                    cursor: answerBusy ? 'default' : 'pointer',
                  },
                },
                h('span', {
                  'aria-hidden': 'true',
                  style: {
                    flex: '0 0 auto',
                    width: '14px',
                    height: '14px',
                    marginTop: '2px',
                    borderRadius: '50%',
                    border: `2px solid ${active ? T.brand : T.ln2 ?? T.line}`,
                    background: active ? T.brand : 'transparent',
                    boxSizing: 'border-box',
                    display: 'inline-block',
                  },
                }),
                h(
                  'span',
                  { style: { display: 'block', minWidth: 0, flex: '1 1 auto' } },
                  h('span', { style: { display: 'block', fontSize: '12.5px', color: T.text, wordBreak: 'break-word' } }, option.label),
                  option.impact
                    ? h('span', { style: { display: 'block', marginTop: '2px', fontSize: '11.5px', color: T.text3, lineHeight: 1.6 } }, `影响：${option.impact}`)
                    : null,
                ),
              )
            }),
            h(
              'button',
              {
                type: 'button',
                'aria-pressed': selected === 'unknown',
                disabled: answerBusy,
                onClick: () => select('unknown'),
                style: {
                  textAlign: 'left',
                  ...button,
                  padding: '8px 10px',
                  borderColor: selected === 'unknown' ? T.warn : T.line,
                  background: selected === 'unknown' ? T.layer2 : T.layer,
                  color: T.text2,
                  cursor: answerBusy ? 'default' : 'pointer',
                },
              },
              h('span', { style: { display: 'block', fontSize: '12.5px' } }, '不知道 / 需要调查'),
              h('span', { style: { display: 'block', marginTop: '2px', fontSize: '11.5px', color: T.text3 } }, '当前证据不足时选这个；不会假装已经回答。'),
            ),
          ),
          h('input', {
            value: questionText,
            onChange: (event) => {
              setAnswerFeedback(null)
              setQuestionText(event.target.value)
            },
            onKeyDown: (event) => {
              if (event.key === 'Enter' && canSubmit && !answerBusy) {
                event.preventDefault()
                submitAnswer()
              }
            },
            placeholder: '或者直接写下你的回答',
            disabled: answerBusy,
            'aria-label': '自由回答',
            style: { ...input, width: '100%', marginTop: '8px', boxSizing: 'border-box', minWidth: 0 },
          }),
          h(
            'div',
            { style: { display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap', alignItems: 'center' } },
            h(
              'button',
              {
                type: 'button',
                style: { ...primary, opacity: answerBusy ? 0.7 : 1 },
                disabled: answerBusy || !canSubmit,
                onClick: () => submitAnswer(),
              },
              answerBusy ? `提交中…（已用 ${answerElapsed}s）` : '提交回答',
            ),
            answerBusy
              ? h('button', { type: 'button', style: button, onClick: () => cancelAnswer() }, '取消提交')
              : h(
                  'button',
                  {
                    type: 'button',
                    style: button,
                    onClick: () => startInvestigation(question.text),
                    disabled: !session?.sessionId || investigation.busy,
                  },
                  '调查这个问题（只读）',
                ),
          ),
          h('p', { style: { margin: '4px 0 0', ...muted, lineHeight: 1.6 } }, '“调查”只读取当前项目代码，不修改文件；证据需要你核对。'),
          answerFeedback
            ? h(
                'div',
                { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginTop: '8px' } },
                tonePill(answerFeedback.kind === 'success' ? 'warn' : 'error', answerFeedback.kind === 'success' ? '已记录回答' : '提交失败'),
                h('span', { style: { fontSize: '12px', color: T.text2, flex: '1 1 220px', minWidth: 0, wordBreak: 'break-word', lineHeight: 1.7 } }, answerFeedback.message),
                answerFeedback.retry
                  ? h('button', { type: 'button', style: button, disabled: answerBusy, onClick: () => submitAnswer() }, '重试')
                  : null,
              )
            : null,
        )
      }
      const renderClarificationStatus = () => {
        const pending = (session?.items ?? []).filter((item) => !item.excluded && (item.unknowns ?? []).some((unknown) => (unknown.resolution ?? 'pending') === 'pending')).length
        const total = investigations.length
        const gateQuestion = session?.nextQuestion ? 1 : 0
        const allCovered = gateQuestion === 0 && pending === 0 && session?.state === 'ready_for_confirmation'
        return h(
          'div',
          {
            style: {
              display: 'flex',
              gap: '8px',
              flexWrap: 'wrap',
              alignItems: 'center',
              marginTop: '10px',
              padding: '8px 10px',
              border: `1px solid ${T.line}`,
              borderRadius: '10px',
              background: T.layer,
            },
          },
          h('span', { style: { fontSize: '12.5px', color: T.text2 } }, `待澄清问题 ${pending + gateQuestion} · 已有调查证据 ${total}`),
          allCovered
            ? tonePill('neutral', '澄清可以收口：所有阻塞问题都有证据或明确留给你决定')
            : total > 0
              ? tonePill('warn', '还有待澄清项；证据只是旁证')
              : tonePill('neutral', '尚未使用调查证据'),
        )
      }
      const renderInvestigationPanel = () => {
        if (!investigation.open) return null
        const data = investigation.data
        const verdict = data?.verdict ?? null
        const findings = Array.isArray(data?.findings) ? data.findings : []
        const unknowns = Array.isArray(data?.unknowns) ? data.unknowns : []
        return h(
          'div',
          { style: { ...card, cursor: 'default', marginTop: '12px', borderColor: T.line2 } },
          h(
            'div',
            { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
            tonePill('neutral', '只读调查'),
            h('span', { style: { fontSize: '12px', color: T.text2, flex: '1 1 220px', minWidth: 0, wordBreak: 'break-word' } }, investigation.question?.text ?? ''),
            investigation.busy
              ? h('span', { style: { fontSize: '12px', color: T.warn } }, `已用 ${investigation.elapsed}s`)
              : null,
          ),
          investigation.busy
            ? h(
                'div',
                null,
                h(
                  'div',
                  { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '8px' } },
                  INTENT_INVESTIGATION_STAGES.map((stage) =>
                    h(
                      'span',
                      { key: stage, style: { fontSize: '11.5px', color: T.text3, padding: '2px 8px', border: `1px solid ${T.line}`, borderRadius: '999px' } },
                      stage,
                    ),
                  ),
                ),
                h('p', { style: { margin: '8px 0 0', ...muted, lineHeight: 1.7 } }, '这次调查会依次读取当前项目文件、生成证据并核对引用；完成前没有伪造的进度百分比。这一步只读，不会改任何文件。'),
                h(
                  'div',
                  { style: { display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' } },
                  h('button', { type: 'button', style: button, onClick: () => cancelInvestigation() }, '取消调查'),
                ),
              )
            : investigation.error
              ? h(
                  'div',
                  { style: { marginTop: '8px' } },
                  h(
                    'div',
                    { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
                    tonePill('error', `调查失败：${investigation.error.code ?? 'error'}`),
                    h(
                      'span',
                      { style: { fontSize: '12px', color: T.text2, flex: '1 1 220px', minWidth: 0, wordBreak: 'break-word', lineHeight: 1.7 } },
                      investigation.error.message,
                    ),
                    h('button', { type: 'button', style: button, onClick: () => startInvestigation(investigation.question?.text ?? '') }, '重试'),
                    h('button', { type: 'button', style: button, onClick: () => setInvestigation((state) => ({ ...state, open: false })) }, '关闭'),
                  ),
                  investigation.error.hint ? h('p', { style: { margin: '6px 0 0', ...muted, lineHeight: 1.7 } }, investigation.error.hint) : null,
                )
              : data
                ? h(
                    'div',
                    { style: { marginTop: '8px' } },
                    h(
                      'div',
                      { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
                      tonePill(
                        verdict === 'partially-answered' ? 'warn' : 'neutral',
                        `调查结论：${INTENT_VERDICT_LABELS[verdict] ?? (verdict || '未确定')}`,
                      ),
                      data?.investigationId ? h('span', { style: { fontSize: '11px', color: T.text3 } }, `INV ${data.investigationId}`) : null,
                      investigation.elapsed > 0 ? h('span', { style: { fontSize: '11px', color: T.text3 } }, `用时约 ${investigation.elapsed}s`) : null,
                    ),
                    h('p', { style: { margin: '6px 0 0', fontSize: '12.5px', color: T.text2, lineHeight: 1.7 } }, '这些是只读观察证据，引用可核对；仍不是已确认决定。'),
                    data.summary ? h('p', { style: { margin: '6px 0 0', fontSize: '12.5px', color: T.text, lineHeight: 1.8 } }, data.summary) : null,
                    verdict === 'not-determined'
                      ? h('p', { style: { margin: '6px 0 0', color: T.warn, fontSize: '12px', lineHeight: 1.7 } }, '模型没有从代码里得到确定答案。可以换个问题、缩小范围，或把结论留给你决定。')
                      : null,
                    findings.length === 0
                      ? null
                      : h(
                          'div',
                          { style: { display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' } },
                          findings.map((finding, index) =>
                            h(
                              'div',
                              { key: typeof finding?.claim === 'string' ? `${index}-${finding.claim.slice(0, 24)}` : index, style: { border: `1px solid ${T.line}`, borderRadius: '8px', padding: '8px 10px', background: T.base } },
                              h('div', { style: { fontSize: '12.5px', color: T.text, lineHeight: 1.7, wordBreak: 'break-word' } }, finding?.claim ?? '（无描述）'),
                              (finding?.refs ?? []).map((ref) =>
                                h(
                                  'div',
                                  { key: `${ref.path}-${ref.line}-${ref.endLine ?? ''}`, style: { marginTop: '4px' } },
                                  h(
                                    'div',
                                    { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' } },
                                    h('span', { style: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '11.5px', color: T.text2, wordBreak: 'break-all' } }, intentRefLabel(ref)),
                                    tonePill(ref?.verified === false ? 'warn' : 'success', ref?.verified === false ? '引用未核对' : '引用已核对'),
                                  ),
                                  ref?.quote
                                    ? h(
                                        'pre',
                                        { style: { margin: '4px 0 0', padding: '6px 8px', background: T.layer2, borderRadius: '6px', fontSize: '11px', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: T.text2, maxHeight: '7.5em', overflow: 'auto', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' } },
                                        String(ref.quote).split('\n').slice(0, 6).join('\n'),
                                      )
                                    : null,
                                ),
                              ),
                            ),
                          ),
                        ),
                    unknowns.length > 0
                      ? h(
                          'div',
                          { style: { marginTop: '8px' } },
                          h('div', { style: fieldLabelStyle }, '仍需确认'),
                          unknowns.map((unknown, index) =>
                            h(
                              'p',
                              { key: index, style: { margin: '2px 0 0', fontSize: '12px', color: T.text2, lineHeight: 1.7 } },
                              typeof unknown === 'string'
                                ? unknown
                                : `${unknown?.description ?? unknown?.text ?? '未知项'}${unknown?.blocking === true ? '（需要你决定）' : unknown?.resolution === 'investigate' ? '（需进一步调查）' : ''}`,
                            ),
                          ),
                        )
                      : null,
                    (data?.warnings ?? []).length > 0
                      ? h('p', { style: { margin: '6px 0 0', ...muted, lineHeight: 1.7 } }, `提醒：${data.warnings.join('；')}`)
                      : null,
                    h(
                      'div',
                      { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px' } },
                      h('button', { type: 'button', style: primary, disabled: busy, onClick: () => reanalyzeWithEvidence() }, '用这些证据重新判断'),
                      h('button', { type: 'button', style: button, onClick: () => startInvestigation(investigation.question?.text ?? '') }, '再调查一次'),
                      h('button', { type: 'button', style: button, onClick: () => setInvestigation((state) => ({ ...state, open: false })) }, '收起'),
                    ),
                    h('p', { style: { margin: '6px 0 0', ...muted, lineHeight: 1.6 } }, '“用这些证据重新判断”会把最近几条调查证据交给模型重新分析；证据仍不是已确认决定。'),
                  )
                : null,
        )
      }
      const renderInvestigations = () => {
        if (investigations.length === 0) return null
        return h(
          'div',
          { style: { ...card, cursor: 'default', marginTop: '12px' } },
          h('div', { style: fieldLabelStyle }, `调查记录（${investigations.length}）`),
          h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' } },
            investigations.map((entry, index) => {
              const id = intentInvestigationId(entry)
              const outerId = investigation.expandedId
              const expanded = outerId === id
              const verdict = entry?.verdict ?? null
              const findings = Array.isArray(entry?.findings) ? entry.findings : []
              return h(
                'div',
                { key: id ?? `${index}`, style: { border: `1px solid ${T.line}`, borderRadius: '8px', padding: '8px 10px', background: T.layer } },
                h(
                  'button',
                  {
                    type: 'button',
                    onClick: () => setInvestigation((state) => ({ ...state, expandedId: expanded ? null : id })),
                    style: {
                      textAlign: 'left',
                      border: `1px solid ${T.line}`,
                      borderRadius: '8px',
                      background: T.base,
                      padding: '6px 8px',
                      display: 'flex',
                      gap: '8px',
                      flexWrap: 'wrap',
                      alignItems: 'baseline',
                      width: '100%',
                      cursor: 'pointer',
                      color: T.text,
                    },
                  },
                  h('span', { style: { fontSize: '12px', color: T.text2, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' } }, id ?? 'INV-?'),
                  h('span', { style: { fontSize: '12px', color: T.text, flex: '1 1 220px', minWidth: 0, wordBreak: 'break-word' } }, entry?.question ?? ''),
                  tonePill(verdict === 'partially-answered' ? 'warn' : 'neutral', INTENT_VERDICT_LABELS[verdict] ?? '未确定'),
                  h('span', { style: { fontSize: '11px', color: T.text3 } }, intentInvestigationTime(entry)),
                ),
                expanded
                  ? h(
                      'div',
                      { style: { marginTop: '6px' } },
                      findings.length === 0
                        ? h('p', { style: { margin: 0, ...muted } }, '这次调查没有可校验的发现。')
                        : findings.map((finding, findingIndex) =>
                            h(
                              'p',
                              { key: findingIndex, style: { margin: '3px 0 0', fontSize: '12px', color: T.text2, lineHeight: 1.7 } },
                              typeof finding === 'string' ? finding : `${finding?.claim ?? ''}${(finding?.refs ?? []).length ? ` — ${(finding.refs ?? []).map(intentRefLabel).join('；')}` : ''}`,
                            ),
                          ),
                    )
                  : null,
              )
            }),
          ),
        )
      }
      const renderRelated = (item) => {
        const related = item.related ?? []
        const contextFailed = session?.context?.queryStatus === 'error'
        return h(
          'div',
          { style: { marginTop: '10px' } },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
            h('span', { style: fieldLabelStyle }, '相关承诺'),
            contextFailed ? tonePill('warn', '相关需求尚未核对') : tonePill('neutral', `${related.length} 条候选`),
          ),
          contextFailed
            ? h('p', { style: { margin: '4px 0 0', color: T.warn, fontSize: '12px', lineHeight: 1.7 } }, '检索失败：相关需求尚未核对，不能据此认为“全新”或“没有重复”。')
            : null,
          related.length === 0
            ? h('p', { style: { margin: '4px 0 0', ...muted } }, '没有匹配到相关承诺；这不等于没有影响。')
            : h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' } },
                related.map((entry, index) =>
                  h(
                    'button',
                    {
                      key: `${entry.uid}-${index}`,
                      type: 'button',
                      disabled: !onOpenRequirement,
                      onClick: () => onOpenRequirement && onOpenRequirement(entry.uid),
                      style: {
                        textAlign: 'left',
                        border: `1px solid ${T.line}`,
                        borderRadius: '10px',
                        background: T.layer,
                        padding: '8px 10px',
                        cursor: onOpenRequirement ? 'pointer' : 'default',
                        color: T.text,
                      },
                    },
                    h(
                      'span',
                      { style: { display: 'flex', gap: '8px', alignItems: 'baseline', flexWrap: 'wrap' } },
                      h('span', { style: { fontSize: '12.5px', fontWeight: 500, wordBreak: 'break-word' } }, entry.uid),
                      entry.revision === undefined || entry.revision === null ? null : h('span', { style: { fontSize: '11px', color: T.text3 } }, `rev ${entry.revision}`),
                      h('span', { style: { fontSize: '11px', color: T.warn } }, INTENT_MATCH_LABELS[entry.match] ?? entry.match ?? '相关'),
                    ),
                    relatedTitleOf(entry)
                      ? h('span', { style: { display: 'block', marginTop: '2px', fontSize: '12px', color: T.text2, wordBreak: 'break-word' } }, relatedTitleOf(entry))
                      : null,
                    h('span', { style: { display: 'block', marginTop: '2px', fontSize: '11.5px', color: T.text3, lineHeight: 1.6 } }, entry.reason ?? ''),
                  ),
                ),
              ),
        )
      }
      const renderRoutes = (item) => {
        const chosen = routeOf(item)
        const edited = routeChoices[item.itemId] !== undefined
        return h(
          'div',
          { style: { marginTop: '8px' } },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
            h('span', { style: fieldLabelStyle }, '去向建议'),
            h(
              'span',
              { style: { fontSize: '11px', color: edited ? T.warn : T.text3 } },
              edited ? `已手改：${INTENT_ROUTE_LABELS[chosen] ?? chosen}` : `AI 建议：${INTENT_ROUTE_LABELS[chosen] ?? chosen}`,
            ),
          ),
          h(
            'div',
            { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '8px', marginTop: '6px' } },
            INTENT_ROUTE_LIST.map(([id, label, hint]) =>
              h(
                'button',
                {
                  key: id,
                  type: 'button',
                  'aria-pressed': chosen === id,
                  disabled: busy,
                  onClick: () => chooseRoute(item, id),
                  style: {
                    textAlign: 'left',
                    cursor: 'pointer',
                    border: `1px solid ${chosen === id ? T.brand : T.line}`,
                    borderLeftWidth: chosen === id ? '3px' : '1px',
                    borderRadius: '10px',
                    padding: '8px 10px',
                    background: chosen === id ? T.layer2 : T.layer,
                    color: chosen === id ? T.text : T.text2,
                  },
                },
                h('span', { style: { display: 'block', fontSize: '12.5px', fontWeight: 500 } }, label),
                h('span', { style: { display: 'block', marginTop: '2px', fontSize: '11px', color: T.text3, lineHeight: 1.6 } }, hint),
              ),
            ),
          ),
          item.routeRationale ? h('p', { style: { margin: '6px 0 0', ...muted, lineHeight: 1.7 } }, `为什么这么建议：${item.routeRationale}`) : null,
        )
      }
      const renderCandidate = (item) => {
        const candidate = candidateOf(item)
        return h(
          'div',
          { style: { marginTop: '10px' } },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' } },
            h('span', { style: fieldLabelStyle }, routeOf(item) === 'change' ? '变更后的内容（草案）' : '需求候选（草案）'),
            h('span', { style: { fontSize: '11px', color: T.text3 } }, 'AI 只给候选；你改过的字段不会被自动覆盖'),
          ),
          fieldBlock(
            '标题',
            sourceTag(fieldWasEdited(item, 'title')),
            h('input', {
              value: candidate.title,
              onChange: (event) => setManualField(item.itemId, 'title', event.target.value),
              placeholder: '一句话说清要改变什么',
              style: { ...input, width: '100%', minWidth: 0 },
            }),
          ),
          fieldBlock(
            '问题',
            sourceTag(fieldWasEdited(item, 'problem')),
            h('textarea', {
              value: candidate.problem,
              onChange: (event) => setManualField(item.itemId, 'problem', event.target.value),
              placeholder: '现在哪里不对、谁受影响',
              style: { ...input, width: '100%', minWidth: 0, minHeight: '64px', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.7 },
            }),
          ),
          fieldBlock(
            '目标',
            sourceTag(fieldWasEdited(item, 'goal')),
            h('textarea', {
              value: candidate.goal,
              onChange: (event) => setManualField(item.itemId, 'goal', event.target.value),
              placeholder: '改成什么样就算对了',
              style: { ...input, width: '100%', minWidth: 0, minHeight: '56px', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.7 },
            }),
          ),
          linesField('范围内', candidate.inScope, (values) => setManualField(item.itemId, 'inScope', values)),
          linesField('范围外', candidate.outOfScope, (values) => setManualField(item.itemId, 'outOfScope', values)),
          renderAcceptance(item, candidate.acceptance),
        )
      }
      const renderUnknowns = (item) => {
        const unknowns = item.unknowns ?? []
        if (unknowns.length === 0) return null
        return h(
          'div',
          { style: { marginTop: '10px' } },
          h('div', { style: fieldLabelStyle }, `未知项（${unknowns.length}）`),
          unknowns.map((unknown, index) => {
            const key = `${item.itemId}:${index}`
            const resolution = unknownChoices[key] ?? unknown.resolution ?? 'pending'
            return h(
              'div',
              { key, style: { border: `1px solid ${T.line}`, borderRadius: '9px', padding: '8px 10px', marginTop: '6px', background: T.layer } },
              h(
                'div',
                { style: { fontSize: '12px', color: T.text2, lineHeight: 1.7 } },
                unknown.blocking ? h('span', { style: { color: T.warn, fontWeight: 500 } }, '[阻塞] ') : null,
                unknown.description,
                h('span', { style: { color: T.text3, marginLeft: '6px' } }, `当前：${INTENT_UNKNOWN_LABELS[resolution] ?? resolution}`),
              ),
              h(
                'div',
                { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '4px' } },
                [
                  ['clarify', '澄清'],
                  ['investigate', '转调查'],
                  ['exclude', '排除'],
                ].map(([id, label]) =>
                  h(
                    'button',
                    {
                      key: id,
                      type: 'button',
                      style: {
                        ...button,
                        padding: '2px 8px',
                        fontSize: '11px',
                        borderColor: resolution === id ? T.brand : T.line,
                        background: resolution === id ? T.layer2 : T.layer,
                      },
                      onClick: () => chooseUnknown(item, index, id),
                    },
                    label,
                  ),
                ),
              ),
            )
          }),
        )
      }
      const renderDetails = (item) => {
        const runs = session?.runs ?? []
        const lastRun = runs[runs.length - 1] ?? null
        const references = item.sourceRefs ?? []
        return h(
          'details',
          { style: { marginTop: '10px', borderTop: `1px solid ${T.line}`, paddingTop: '8px' } },
          h('summary', { style: { cursor: 'pointer', fontSize: '12px', color: T.text2 } }, '依据、反例与模型信息（展开）'),
          (item.assumptions ?? []).length
            ? h(
                'div',
                { style: { marginTop: '8px' } },
                h('div', { style: fieldLabelStyle }, `假设（${item.assumptions.length} 条，未证实）`),
                h(
                  'ul',
                  { style: { margin: '4px 0 0', paddingLeft: '18px', fontSize: '12px', color: T.text2, lineHeight: 1.8 } },
                  item.assumptions.map((line, index) => h('li', { key: index }, line)),
                ),
              )
            : null,
          item.counterexample
            ? h(
                'div',
                { style: { marginTop: '8px' } },
                h('div', { style: fieldLabelStyle }, '反例（待证场景，不是已发生缺陷）'),
                h('p', { style: { margin: '4px 0 0', fontSize: '12px', color: T.text2, lineHeight: 1.8 } }, item.counterexample.scenario ?? '—'),
              )
            : null,
          h(
            'div',
            { style: { marginTop: '8px' } },
            h('div', { style: fieldLabelStyle }, '来源引用'),
            references.length === 0
              ? h('p', { style: { margin: '4px 0 0', ...muted } }, '没有可显示的来源引用。')
              : references.map((reference, index) => {
                  const resolved = reference?.resolved !== false && reference?.ref !== undefined
                  return h(
                    'div',
                    { key: index, style: { fontSize: '11.5px', color: resolved ? T.text2 : T.warn, lineHeight: 1.7, wordBreak: 'break-word' } },
                    resolved
                      ? `${reference.ref}${reference.line ? `:${reference.line}` : ''}${reference.endLine ? `-${reference.endLine}` : ''} · ${reference.quote ?? ''}`
                      : `${reference.ref ?? '未知来源'} · 来源无法解析`,
                  )
                }),
          ),
          h(
            'div',
            { style: { marginTop: '8px' } },
            h('div', { style: fieldLabelStyle }, '模型信息'),
            h(
              'p',
              { style: { margin: '4px 0 0', ...muted, lineHeight: 1.8 } },
              lastRun
                ? `${lastRun.provider ?? '—'} / ${lastRun.model ?? '—'} · ${INTENT_STATE_LABELS[lastRun.status] ?? lastRun.status ?? '—'} · ${intentTime(lastRun.finishedAt ?? lastRun.startedAt)}`
                : '这次没有模型运行记录（手动填写或模型不可用）。',
            ),
          ),
        )
      }
      const VALUE_CHECK_STATUS_LABELS = { pending: '待确认', unknown: '待确认', unverified: '未验证', verified: '已验证', failed: '未通过', blocked: '已阻塞' }
      // 对象/数组字段兜底转文本，避免任何情况下渲染出 [object Object]。
      const valueCheckText = (value) => {
        if (typeof value === 'string') return value
        if (value !== null && typeof value === 'object') {
          try {
            return JSON.stringify(value)
          } catch (caught) {
            return String(value)
          }
        }
        return String(value)
      }
      const valueCheckOf = (value) => {
        if (value === null || value === undefined) return null
        if (typeof value === 'string') {
          const text = value.trim()
          return text ? { kind: 'text', text } : null
        }
        if (typeof value === 'object' && !Array.isArray(value)) {
          const rows = [
            ['断言', value.claim],
            ['最小验证', value.smallestCheck],
            ['停止或撤回条件', value.stopCondition],
          ]
            .filter(([, current]) => current !== null && current !== undefined && String(current).trim() !== '')
            .map(([label, current]) => [label, valueCheckText(current)])
          const statusRaw = value.status === null || value.status === undefined ? '' : valueCheckText(value.status).trim()
          if (rows.length === 0 && statusRaw === '') return null
          return {
            kind: 'object',
            rows,
            status: statusRaw === '' ? null : { raw: statusRaw, label: VALUE_CHECK_STATUS_LABELS[statusRaw] ?? statusRaw },
          }
        }
        return { kind: 'text', text: String(value) }
      }
      const valueCheckTone = (status) => {
        if (!status) return 'neutral'
        if (status.raw === 'verified') return 'success'
        if (status.raw === 'unverified' || status.raw === 'failed' || status.raw === 'blocked') return status.raw === 'unverified' ? 'warn' : 'error'
        return 'neutral'
      }
      // 价值检查来自 core 的 valueCheck 对象（intent-review.v1），这里统一做对象/字符串/null 容错，只走文本渲染。
      const renderValueCheck = (item) => {
        const valueCheck = valueCheckOf(item?.valueCheck)
        if (!valueCheck) return null
        if (valueCheck.kind === 'text') return tonePill('neutral', `价值检查：${valueCheck.text}`)
        return h(
          'div',
          { style: { marginTop: '8px', border: `1px solid ${T.line}`, borderLeft: `3px solid ${T.line2}`, borderRadius: '10px', padding: '8px 12px', background: T.layer } },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
            h('span', { style: fieldLabelStyle }, '价值检查'),
            valueCheck.status ? tonePill(valueCheckTone(valueCheck.status), `状态：${valueCheck.status.label}`) : null,
          ),
          valueCheck.rows.map(([label, text]) =>
            h(
              'div',
              { key: label, style: { marginTop: '4px', fontSize: '12px', color: T.text2, lineHeight: 1.8, wordBreak: 'break-word' } },
              h('span', { style: { color: T.text3 } }, `${label}：`),
              text,
            ),
          ),
        )
      }
      const renderItemSection = (item, index, total) =>
        h(
          'section',
          {
            key: item.itemId ?? index,
            style: { borderTop: index === 0 ? 'none' : `1px solid ${T.line}`, paddingTop: index === 0 ? 0 : '12px', marginTop: '12px' },
          },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
            h(
              'span',
              { style: { fontSize: '11px', color: T.text3, letterSpacing: '.06em', textTransform: 'uppercase' } },
              total > 1 ? `意图 ${index + 1} / ${total}` : '这次意图',
            ),
          ),
          h('p', { style: { margin: '6px 0 0', fontSize: '13px', color: T.text, lineHeight: 1.8 } }, item.userProblem || item.desiredOutcome || '（没有可显示的理解）'),
          item.desiredOutcome && item.userProblem ? h('p', { style: { margin: '2px 0 0', ...muted, lineHeight: 1.7 } }, `期望：${item.desiredOutcome}`) : null,
          renderValueCheck(item),
          renderRoutes(item),
          renderRelated(item),
          renderCandidate(item),
          renderUnknowns(item),
          renderDetails(item),
        )
      const renderConflicts = () =>
        h(
          'div',
          { style: { border: `1px solid ${T.line2}`, borderLeft: `3px solid ${T.warn}`, borderRadius: '10px', padding: '8px 12px', marginBottom: '10px', background: T.layer } },
          h('div', { style: { color: T.warn, fontSize: '12px', fontWeight: 500 } }, '重新分析后 AI 给出了不同的建议'),
          h('p', { style: { margin: '2px 0 6px', ...muted, lineHeight: 1.7 } }, '你的手改不会被自动覆盖；请逐项选择。'),
          conflicts.map((conflict, index) =>
            h(
              'div',
              {
                key: `${conflict.itemId}-${conflict.field}-${index}`,
                style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', padding: '4px 0', borderTop: index === 0 ? 'none' : `1px solid ${T.line}` },
              },
              h(
                'span',
                { style: { fontSize: '12px', color: T.text2, flex: '1 1 220px', minWidth: 0, wordBreak: 'break-word' } },
                `${conflictLabel(conflict.field)}：你的「${previewValue(conflict.manualValue)}」 ↔ AI「${previewValue(conflict.aiValue)}」`,
              ),
              h('button', { type: 'button', style: button, onClick: () => resolveConflict(conflict, false) }, '保留我的手改'),
              h('button', { type: 'button', style: button, onClick: () => resolveConflict(conflict, true) }, '使用新建议'),
            ),
          ),
        )
      const conflictLabel = (field) => ({ title: '标题', problem: '问题', goal: '目标', inScope: '范围内', outOfScope: '范围外', acceptance: '验收标准' })[field] ?? field
      const previewValue = (value) => {
        if (Array.isArray(value)) {
          return value
            .slice(0, 2)
            .map((entry) => (typeof entry === 'string' ? entry : entry?.expected ?? entry?.action ?? ''))
            .join(' / ') || '（空）'
        }
        const text = String(value ?? '')
        return text.length > 60 ? `${text.slice(0, 60)}…` : text || '（空）'
      }
      const renderError = (info) =>
        h(
          'div',
          { role: 'alert', style: { border: `1px solid ${T.line2}`, borderLeft: `3px solid ${T.err}`, borderRadius: '10px', padding: '8px 12px', marginTop: '10px', background: EVIDENCE_TONE.error.bg } },
          h('div', { style: { color: T.err, fontSize: '12.5px', lineHeight: 1.7 } }, info.message ?? '出错了'),
          info.code
            ? h('div', { style: { marginTop: '2px', fontSize: '11px', color: T.text3 } }, `错误码：${info.code}${info.status ? ` · HTTP ${info.status}` : ''}`)
            : null,
          (info.reasons ?? []).length
            ? h(
                'ul',
                { style: { margin: '6px 0 0', paddingLeft: '18px', fontSize: '11.5px', color: T.text2, lineHeight: 1.8 } },
                info.reasons.map((reason, index) => h('li', { key: index }, `${reason.message ?? reason.code}${reason.itemId ? `（${reason.itemId}）` : ''}`)),
              )
            : null,
          (info.appliedArtifacts ?? []).length
            ? h(
                'div',
                { style: { marginTop: '6px', fontSize: '11.5px', color: T.text2, lineHeight: 1.7 } },
                `已写入：${info.appliedArtifacts.map((artifact) => `${artifact.kind ?? '产物'} ${artifact.id ?? ''}`).join('、')}`,
              )
            : null,
        )
      const renderReview = () => {
        const gate = reviewReadiness()
        const items = activeItems()
        const first = items[0]
        return h(
          'div',
          { style: { marginTop: '8px' } },
          notice ? h('div', { style: { border: `1px solid ${T.line2}`, borderRadius: '10px', padding: '8px 12px', marginBottom: '10px', color: T.text2, fontSize: '12px', lineHeight: 1.7, background: T.layer } }, notice) : null,
          error ? renderError(error) : null,
          conflicts.length ? renderConflicts() : null,
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
            tonePill(
              session?.state === 'failed' ? 'error' : session?.state === 'needs_input' ? 'warn' : 'neutral',
              INTENT_STATE_LABELS[session?.state] ?? '待确认',
            ),
            session?.input?.inputRevision === undefined ? null : h('span', { style: muted }, `输入版本 ${session.input.inputRevision}`),
            session?.context?.generatedAt ? h('span', { style: muted }, `上下文 ${intentTime(session.context.generatedAt)}`) : null,
            session?.manual ? tonePill('warn', '手动模式（未调用模型）') : null,
            editBusy ? h('span', { style: muted }, '正在保存你的修改…') : null,
          ),
          renderClarificationStatus(),
          h(
            'p',
            { style: { margin: '8px 0 0', fontSize: '13.5px', color: T.text, lineHeight: 1.8 } },
            items.length === 0
              ? '没有可确认的意图项。'
              : items.length === 1
                ? `我的理解：${first.userProblem || first.desiredOutcome || '（见下方候选）'}`
                : `我的理解：这里其实是 ${items.length} 个意图，下面逐个确认。`,
          ),
          renderQuestion(),
          renderInvestigationPanel(),
          renderInvestigations(),
          items.map((item, index) => renderItemSection(item, index, items.length)),
          gate.ready
            ? null
            : h(
                'div',
                { style: { marginTop: '12px' } },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } }, tonePill('neutral', '还不能确认'), h('span', { style: muted }, '先处理下面的原因')),
                h(
                  'ul',
                  { style: { margin: '6px 0 0', paddingLeft: '18px', fontSize: '12px', color: T.text2, lineHeight: 1.8 } },
                  gate.reasons.map((reason, index) => h('li', { key: `${reason.code ?? 'reason'}-${index}` }, reason.message ?? reason.code)),
                ),
              ),
        )
      }
      const renderRehearsal = () => {
        if (rehearsal.loading) return h('p', { style: { margin: '6px 0 0', ...muted } }, '正在读取旧/新差异与影响（只读请求）…')
        if (rehearsal.error) return h('p', { style: { margin: '6px 0 0', color: T.warn, fontSize: '12px' } }, `影响预览失败：${rehearsal.error}`)
        const preview = rehearsal.data
        if (!preview) {
          const noBase = !rehearsal.base?.uid
          return h(
            'p',
            { style: { margin: '6px 0 0', color: T.warn, fontSize: '12px', lineHeight: 1.7 } },
            noBase
              ? '没有匹配到可变更的既有承诺：请返回原话补充需求 ID，或把去向改为“新建需求”。未登记影响（不等于无影响）。'
              : '未登记影响（不等于无影响）；未取得变更预览。',
          )
        }
        const before = preview.requirementBefore ?? {}
        const after = preview.requirementAfter ?? {}
        const changes = preview.changes ?? []
        const impact = preview.impact ?? {}
        return h(
          'div',
          { style: { marginTop: '6px' } },
          h(
            'div',
            { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '8px' } },
            h(
              'div',
              { style: { border: `1px solid ${T.line}`, borderRadius: '9px', padding: '8px 10px', background: T.layer } },
              h('div', { style: { fontSize: '10.5px', color: T.text3 } }, '变更前'),
              h(
                'div',
                { style: { fontSize: '12px', color: T.text2, whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginTop: '2px' } },
                `标题：${before.title ?? '—'}\n优先级：${before.priority ?? '—'}`,
              ),
            ),
            h(
              'div',
              { style: { border: `1px solid ${T.line}`, borderLeft: `3px solid ${T.brand}`, borderRadius: '9px', padding: '8px 10px' } },
              h('div', { style: { fontSize: '10.5px', color: T.text3 } }, '变更后'),
              h(
                'div',
                { style: { fontSize: '12px', color: T.text, whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginTop: '2px' } },
                `标题：${after.title ?? '—'}\n优先级：${after.priority ?? '—'}`,
              ),
            ),
          ),
          h(
            'div',
            { style: { marginTop: '6px', fontSize: '11.5px', color: T.text2, lineHeight: 1.8 } },
            changes.map((entry) => `${entry.field}：${entry.before || '（空）'} → ${entry.after || '（空）'}`).join('\n'),
          ),
          impact.coverage
            ? h(
                'div',
                { style: { marginTop: '4px', fontSize: '11px', color: T.text3 } },
                `影响扫描：关系 ${impact.coverage.relations ?? 0} · 已探索 ${impact.coverage.explored ?? 0} · 路径 ${(impact.paths ?? []).length}${impact.coverage.truncated ? ' · 已截断' : ''}`,
              )
            : null,
          (impact.paths ?? []).length
            ? h(
                'details',
                { style: { marginTop: '6px' } },
                h('summary', { style: { cursor: 'pointer', fontSize: '11.5px', color: T.text2 } }, `影响路径（${impact.paths.length}）`),
                h(
                  'div',
                  { style: { marginTop: '4px', fontSize: '11.5px', color: T.text2, lineHeight: 1.8 } },
                  impact.paths.map((path, index) => h('div', { key: index }, `${path.to} · 深度 ${path.depth}`)),
                ),
              )
            : null,
          (impact.blindSpots ?? []).length
            ? h(
                'div',
                { style: { marginTop: '6px', border: `1px solid ${T.line}`, borderRadius: '9px', padding: '6px 10px' } },
                h('div', { style: { color: T.warn, fontSize: '11.5px' } }, '盲区：未登记影响不等于无影响'),
                impact.blindSpots.map((spot, index) =>
                  h(
                    'div',
                    { key: index, style: { fontSize: '11.5px', color: T.text2, lineHeight: 1.8 } },
                    `${spot.kind === 'no-relations' ? '未登记关系' : spot.kind === 'unresolved-target' ? '目标资产缺失' : '未知关系类型'}：${spot.detail}`,
                  ),
                ),
              )
            : null,
          h('p', { style: { margin: '4px 0 0', fontSize: '11px', color: T.text3 } }, '影响只是提示，不是阻塞；正式变更仍需人工确认。'),
        )
      }
      const estimateArtifacts = (routes) => {
        const unique = new Set(routes)
        const lines = []
        if (unique.has('create')) lines.push('1 份需求草稿')
        if (unique.has('change')) lines.push('1 份变更草稿（不改正式 sdoc）')
        if (unique.has('investigate')) lines.push('1 个排查项')
        lines.push('1 份决策回执')
        return lines
      }
      const renderConfirm = () => {
        const items = activeItems()
        const gate = confirmReadiness()
        const shownError = confirmState.error ?? error
        const routes = items.map((item) => routeOf(item))
        const createNeedsPriority = routes.indexOf('create') !== -1
        return h(
          'div',
          { style: { marginTop: '8px' } },
          shownError ? renderError(shownError) : null,
          h(
            'section',
            { style: { ...card, cursor: 'default', marginTop: '10px' } },
            h('div', { style: blockTitleStyle }, '① 确认的问题与期望行为（最终文本可直接编辑）'),
            items.map((item) =>
              h(
                'div',
                { key: item.itemId, style: { marginTop: '8px' } },
                h('div', { style: fieldLabelStyle }, '问题'),
                h('textarea', {
                  value: candidateOf(item).problem,
                  onChange: (event) => setManualField(item.itemId, 'problem', event.target.value),
                  style: { ...input, width: '100%', minWidth: 0, minHeight: '56px', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.7 },
                }),
                h('div', { style: { ...fieldLabelStyle, marginTop: '6px' } }, '期望行为'),
                h('textarea', {
                  value: candidateOf(item).goal,
                  onChange: (event) => setManualField(item.itemId, 'goal', event.target.value),
                  style: { ...input, width: '100%', minWidth: 0, minHeight: '56px', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.7 },
                }),
              ),
            ),
          ),
          h(
            'section',
            { style: { ...card, cursor: 'default', marginTop: '10px' } },
            h('div', { style: blockTitleStyle }, '② 做什么 / 不做什么，以及未证实部分'),
            items.map((item) => {
              const candidate = candidateOf(item)
              const unknowns = item.unknowns ?? []
              return h(
                'div',
                { key: item.itemId, style: { marginTop: '6px', fontSize: '12px', color: T.text2, lineHeight: 1.8 } },
                h('div', null, h('b', { style: { color: T.text, fontWeight: 500 } }, '做：'), (candidate.inScope ?? []).length ? candidate.inScope.join('；') : '（未填写范围内）'),
                h('div', null, h('b', { style: { color: T.text, fontWeight: 500 } }, '不做：'), (candidate.outOfScope ?? []).length ? candidate.outOfScope.join('；') : '（未填写范围外）'),
                h(
                  'div',
                  { style: { color: T.text3 } },
                  `未证实：假设 ${(item.assumptions ?? []).length} 条、未知项 ${unknowns.length} 条、反例 ${item.counterexample ? '1' : '0'} 条；这些不会被写成已证实事实。`,
                ),
              )
            }),
          ),
          h(
            'section',
            { style: { ...card, cursor: 'default', marginTop: '10px' } },
            h('div', { style: blockTitleStyle }, '③ 去向与既有承诺'),
            items.map((item, index) => {
              const route = routeOf(item)
              const related = item.related ?? []
              return h(
                'div',
                { key: item.itemId, style: { marginTop: index === 0 ? '6px' : '10px', borderTop: index === 0 ? 'none' : `1px solid ${T.line}`, paddingTop: index === 0 ? 0 : '8px' } },
                h('div', { style: { fontSize: '12.5px', color: T.text } }, `${INTENT_ROUTE_LABELS[route] ?? route}${items.length > 1 ? `（意图 ${index + 1}）` : ''}`),
                related.length
                  ? h(
                      'div',
                      { style: { marginTop: '4px', fontSize: '12px', color: T.text2, lineHeight: 1.8 } },
                      `既有承诺：${related.map((entry) => `${entry.uid}（${INTENT_MATCH_LABELS[entry.match] ?? entry.match}）`).join('、')}`,
                    )
                  : h(
                      'div',
                      { style: { marginTop: '4px', fontSize: '12px', color: T.text3 } },
                      route === 'create' ? '将新建需求，不改动既有承诺。' : '未登记影响（不等于无影响）。',
                    ),
                route === 'change' ? renderRehearsal() : null,
              )
            }),
          ),
          h(
            'section',
            { style: { ...card, cursor: 'default', marginTop: '10px' } },
            h('div', { style: blockTitleStyle }, '④ 将写入什么（保存不等于采纳）'),
            h(
              'div',
              { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '4px' } },
              estimateArtifacts(routes).map((line, index) =>
                h('span', { key: index, style: { fontSize: '12px', color: T.text2, border: `1px solid ${T.line}`, borderRadius: '7px', padding: '2px 8px', background: T.layer } }, line),
              ),
            ),
            h(
              'div',
              { style: { marginTop: '8px', display: 'flex', gap: '12px', flexWrap: 'wrap' } },
              h(
                'label',
                { style: { display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', color: T.text2, flex: '1 1 180px', minWidth: 0 } },
                '负责人',
                h('input', { value: ownerChoice, onChange: (event) => changeOwner(event.target.value), placeholder: '未指定（沿用项目默认）', style: { ...input, width: '100%', minWidth: 0 } }),
              ),
              h(
                'label',
                { style: { display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', color: T.text2, flex: '0 1 160px', minWidth: 0 } },
                createNeedsPriority ? '优先级（新建必选，不猜）' : '优先级',
                h(
                  'select',
                  { value: priorityChoice, onChange: (event) => changePriority(event.target.value), style: { ...input, width: '100%', minWidth: 0 } },
                  h('option', { value: '' }, '未指定（不猜）'),
                  ['P0', 'P1', 'P2'].map((value) => h('option', { key: value, value }, value)),
                ),
              ),
            ),
            h(
              'p',
              { style: { margin: '6px 0 0', ...muted, lineHeight: 1.7 } },
              `负责人来源：${ownerChoice.trim() ? '你在原话或表单里明确指定' : '未指定，沿用项目默认'}；优先级来源：${priorityChoice ? '你明确选择' : '未指定'}。两者都“待权限确认”，保存时不会自动指派或通知。`,
            ),
          ),
          gate.ready
            ? null
            : h(
                'div',
                { style: { marginTop: '10px', borderTop: `1px solid ${T.line}`, paddingTop: '8px' } },
                h('div', { style: { color: T.text3, fontSize: '11px', letterSpacing: '.06em', textTransform: 'uppercase' } }, '还不能保存'),
                h(
                  'ul',
                  { style: { margin: '4px 0 0', paddingLeft: '18px', fontSize: '12px', color: T.text2, lineHeight: 1.8 } },
                  gate.reasons.map((reason, index) => h('li', { key: index }, reason.message ?? reason.code)),
                ),
              ),
        )
      }
      const renderReceipt = () => {
        const artifacts = receipt?.artifacts ?? []
        const kindLabel = { requirement: '需求草稿', change: '变更草稿', 'change-draft': '变更草稿', investigation: '排查项', link: '关联记录', receipt: '决策回执' }
        return h(
          'div',
          { style: { marginTop: '10px' } },
          h(
            'div',
            { style: { ...card, cursor: 'default' } },
            h(
              'div',
              { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
              tonePill('success', '已保存草案'),
              receipt?.replayed ? tonePill('neutral', '幂等重放') : null,
            ),
            artifacts.length === 0
              ? h('p', { style: { margin: '8px 0 0', ...muted } }, '没有返回产物；保存可能只写入了回执。')
              : h(
                  'div',
                  { style: { display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px' } },
                  artifacts.map((artifact, index) => {
                    // 兼容两代核心形状：旧 {kind:'change', id, path}，新 {kind:'change-draft', changeId, file} / {kind:'requirement', id, file}。
                    const artifactId = artifact.id ?? artifact.changeId ?? null
                    const artifactPath = artifact.path ?? artifact.file ?? null
                    const artifactLabel = kindLabel[artifact.kind] ?? artifact.kind ?? '产物'
                    const artifactSummary = artifact.summary ?? artifact.draft?.summary ?? null
                    return h(
                      'div',
                      { key: `${artifact.kind ?? 'artifact'}-${artifactId ?? index}`, style: { border: `1px solid ${T.line}`, borderRadius: '9px', padding: '8px 10px', background: T.layer } },
                      h(
                        'div',
                        { style: { display: 'flex', gap: '8px', alignItems: 'baseline', flexWrap: 'wrap' } },
                        h('span', { style: { fontSize: '11px', color: T.text3 } }, artifactLabel),
                        h('span', { style: { fontSize: '12.5px', color: T.text, fontWeight: 500, wordBreak: 'break-word' } }, artifactId ?? artifactLabel),
                        artifact.kind === 'requirement' && onOpenRequirement && artifactId
                          ? h(
                              'button',
                              {
                                type: 'button',
                                style: { ...button, padding: '0 8px', fontSize: '11px' },
                                onClick: () => {
                                  onOpenRequirement(artifactId)
                                  finish()
                                },
                              },
                              '打开需求详情',
                            )
                          : null,
                      ),
                      artifactPath ? h('div', { style: { marginTop: '2px', fontSize: '11px', color: T.text3, wordBreak: 'break-all' } }, artifactPath) : null,
                      artifactSummary ? h('div', { style: { marginTop: '2px', fontSize: '11.5px', color: T.text2, lineHeight: 1.7 } }, artifactSummary) : null,
                      artifactPath || artifactSummary || artifactId
                        ? null
                        : h('div', { style: { marginTop: '2px', ...muted } }, '核心未返回该产物的 ID、路径或摘要。'),
                    )
                  }),
                ),
            h(
              'p',
              { style: { margin: '10px 0 0', color: T.text2, fontSize: '12px', lineHeight: 1.8 } },
              '保存 ≠ 采纳 / 开工 / 验收 / 发布。需求仍是草稿；变更草稿尚不改正式 sdoc；负责人 / 优先级待权限确认。',
            ),
            receipt?.receipt?.id ? h('p', { style: { margin: '4px 0 0', ...muted } }, `回执：${receipt.receipt.id}`) : null,
          ),
        )
      }
      const footerFor = () => {
        if (screen === 'input') {
          return [
            h('span', { key: 'note', style: { marginRight: 'auto', fontSize: '11.5px', color: T.text3, alignSelf: 'center' } }, '先澄清，不会创建需求。'),
            h('button', { key: 'manual', type: 'button', style: button, onClick: startManual }, '手动填写候选'),
            h('button', { key: 'analyze', type: 'button', style: primary, disabled: rawText.trim() === '' || busy, onClick: runAnalyze }, busy ? '分析中…' : '分析意图'),
          ]
        }
        if (screen === 'analyzing') {
          return [h('button', { key: 'cancel', type: 'button', style: button, onClick: cancelAnalyze }, '取消分析')]
        }
        if (screen === 'review') {
          return [
            h('button', { key: 'later', type: 'button', style: button, onClick: postpone }, '暂不处理'),
            h('button', { key: 'back', type: 'button', style: button, onClick: () => setScreen('input') }, '返回原话'),
            h('button', { key: 'again', type: 'button', style: button, disabled: busy, onClick: runAnalyze }, busy ? '分析中…' : '重新分析'),
            h(
              'button',
              { key: 'confirm', type: 'button', style: primary, disabled: busy, onClick: enterConfirm },
              '确认并保存这份草案',
            ),
          ]
        }
        if (screen === 'confirm') {
          const retry = confirmState.error?.code === 'write-failed'
          return [
            h(
              'button',
              { key: 'leave', type: 'button', style: { ...button, borderColor: 'transparent', background: 'transparent', color: T.text2 }, onClick: saveAndLeave },
              '保存会话离开',
            ),
            h('button', { key: 'back', type: 'button', style: button, onClick: () => setScreen('review') }, '返回修改'),
            h(
              'button',
              { key: 'save', type: 'button', style: primary, disabled: confirmState.loading, onClick: submitConfirm },
              confirmState.loading ? '保存中…' : retry ? '重试保存（同幂等键）' : '确认并保存这份草案',
            ),
          ]
        }
        return [h('button', { key: 'done', type: 'button', style: primary, onClick: finish }, '完成')]
      }
      const title =
        screen === 'input'
          ? '你想改变什么？'
          : screen === 'analyzing'
            ? '正在理解你的意图'
            : screen === 'review'
              ? '这份理解对吗？'
              : screen === 'confirm'
                ? '确认并保存这份草案'
                : '草案已保存'
      const lead =
        screen === 'input'
          ? `归属项目 ${projectName ?? project ?? '—'} · 只读边界：本项目。先澄清，不会创建需求。`
          : screen === 'confirm'
            ? '保存的是一份待确认草案；保存不等于采纳、开工、验收或发布。'
            : screen === 'receipt'
              ? '真实写入的产物如下；关闭后会刷新列表。'
              : null
      return h(
        ModalShell,
        { title, lead, onClose: handleClose, width: '820px', footer: footerFor() },
        h(
          'div',
          { ref: screenHeadingRef, tabIndex: -1, style: { outline: 'none' } },
          screen === 'input'
            ? renderInput()
            : screen === 'analyzing'
              ? renderAnalyzing()
              : screen === 'review'
                ? renderReview()
                : screen === 'confirm'
                  ? renderConfirm()
                  : renderReceipt(),
        ),
      )
    }

    function AssociateModal({ workspace, onClose, onLinked }) {
      const [form, setForm] = useState({
        id: workspace.projectId ?? '',
        name: workspace.linked ? workspace.name : workspace.title,
        owner: workspace.github?.owner ?? '',
        repo: workspace.github?.repo ?? '',
        projectNumber: workspace.github?.project?.number ? String(workspace.github.project.number) : '',
      })
      const [state, setState] = useState({ loading: false, error: null, result: null })
      const field = (key) => ({
        value: form[key],
        onChange: (event) => setForm((current) => ({ ...current, [key]: event.target.value })),
      })
      const submit = () => {
        setState({ loading: true, error: null, result: null })
        postJson(
          'projects/associate',
          {
            id: form.id.trim(),
            name: form.name.trim(),
            owner: form.owner.trim(),
            repo: form.repo.trim(),
            projectNumber: form.projectNumber.trim() === '' ? undefined : Number(form.projectNumber),
          },
          workspace.root,
        )
          .then((result) => {
            setState({ loading: false, error: null, result })
            onLinked?.(result)
          })
          .catch((error) => setState({ loading: false, error: error.message, result: null }))
      }
      const disabled = state.loading || ['id', 'name', 'owner', 'repo'].some((key) => form[key].trim() === '')
      const remote = state.result?.remote
      return h(
        ModalShell,
        {
          title: `关联 GitHub 仓库 · ${workspace.title}`,
          lead: `写入 ${workspace.root}/.alm/project.json（缺失时创建 requirements/）。关联后该工作区即作为需求项目空间。`,
          onClose,
          footer: [
            h('button', { key: 'cancel', style: button, onClick: onClose }, state.result ? '关闭' : '取消'),
            state.result ? null : h('button', { key: 'submit', style: primary, onClick: submit, disabled }, state.loading ? '关联中…' : '关联仓库'),
          ],
        },
        h(
          'div',
          { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '14px' } },
          h('label', { style: { display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', color: T.text2 } }, '项目 ID', h('input', { ...field('id'), style: input, placeholder: 'PAY' })),
          h('label', { style: { display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', color: T.text2 } }, '项目名称', h('input', { ...field('name'), style: input, placeholder: '支付平台' })),
          h('label', { style: { display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', color: T.text2 } }, 'GitHub owner', h('input', { ...field('owner'), style: input, placeholder: 'peterzhanghao' })),
          h('label', { style: { display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', color: T.text2 } }, '仓库名', h('input', { ...field('repo'), style: input, placeholder: 'AI_ALM' })),
          h('label', { style: { display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', color: T.text2 } }, 'ProjectV2 编号（可选）', h('input', { ...field('projectNumber'), style: input, placeholder: '1' })),
        ),
        state.loading ? h('p', { style: { margin: '12px 0 0', ...muted } }, '正在写入…') : null,
        state.error ? h('p', { style: { margin: '12px 0 0', color: T.err, fontSize: '13px' } }, state.error) : null,
        state.result
          ? h(
              'div',
              { style: { marginTop: '14px' } },
              h(PlanRows, {
                rows: [
                  ['项目', `${state.result.id} · ${state.result.name}`],
                  ['仓库', `${state.result.github?.owner}/${state.result.github?.repo}`],
                  ['文件', state.result.file],
                ],
              }),
              remote?.matches === false
                ? h('p', { style: { margin: '10px 0 0', color: T.warn, fontSize: '12px' } }, `当前 git remote 是 ${remote.slug ?? '无'}，与关联仓库不一致；推送前请确认。`)
                : remote?.matches === true
                  ? h('p', { style: { margin: '10px 0 0', color: T.ok, fontSize: '12px' } }, 'git remote 与关联仓库一致。')
                  : h('p', { style: { margin: '10px 0 0', ...muted } }, '该目录不是 git 仓库，未校验 remote。'),
            )
          : null,
      )
    }

    function EmptyState({ root, onOpenPanel }) {
      return h(
        'div',
        { style: { ...card, cursor: 'default' } },
        h('h3', { style: { margin: '0 0 8px', fontSize: '15px' } }, '从这一步开始'),
        h(
          'ol',
          { style: { margin: 0, paddingLeft: '20px', fontSize: '13px', lineHeight: 1.9 } },
          h('li', null, '看示例：点「恢复默认」加载 fixtures/order-refund，认识 7 类资产与追踪关系。'),
          h('li', null, '写第一条：让 Agent 按 alm-requirements 技能起草需求，再用 alm check 验证。'),
          h('li', null, '进入变更流程：', onOpenPanel ? h('button', { style: { ...button, marginLeft: '6px' }, onClick: onOpenPanel }, '打开工作台') : null),
        ),
        root ? h('p', { style: muted }, `当前根：${root}`) : null,
      )
    }

    function Workbench({ openPanel }) {
      const storedRoot = typeof localStorage === 'undefined' ? '' : localStorage.getItem(ROOT_KEY) ?? ''
      const storedProject = typeof localStorage === 'undefined' ? '' : localStorage.getItem(PROJECT_KEY) ?? ''
      const [rootInput, setRootInput] = useState(storedRoot)
      const [root, setRoot] = useState(storedRoot)
      const [projectId, setProjectId] = useState(storedProject)
      const [projects, setProjects] = useState([])
      const [filter, setFilter] = useState('all')
      const [keyword, setKeyword] = useState('')
      const [selectedId, setSelectedId] = useState(null)
      const [detailOpen, setDetailOpen] = useState(false)
      const [snapshot, setSnapshot] = useState(null)
      const [diff, setDiff] = useState(null)
      const [traceItem, setTraceItem] = useState(null)
      const [startItem, setStartItem] = useState(null)
      const [acceptItem, setAcceptItem] = useState(null)
      const [acceptanceItem, setAcceptanceItem] = useState(null)
      const [aiReviewItem, setAiReviewItem] = useState(null)
      const [rehearsalItem, setRehearsalItem] = useState(null)
      const [createOpen, setCreateOpen] = useState(false)
      const [createdNotice, setCreatedNotice] = useState(null)
      const [associateTarget, setAssociateTarget] = useState(null)
      const [showRoot, setShowRoot] = useState(false)
      const { loading, error, data, reload } = useRequirements({ root, projectId })

      const loadProjects = useCallback(() => {
        return fetch('/api/alm/projects')
          .then((response) => (response.ok ? response.json() : null))
          .then((payload) => {
            if (!payload?.projects) return
            setProjects(payload.projects)
          })
          .catch(() => {})
      }, [])

      useEffect(() => {
        loadProjects()
      }, [loadProjects])

      useEffect(() => {
        if (!data?.project) return
        setProjectId((current) => (current === ALL_PROJECTS ? current : data.project))
        if (typeof localStorage !== 'undefined') localStorage.setItem(PROJECT_KEY, data.project)
      }, [data?.project])

      const applyRoot = useCallback((value) => {
        setRoot(value)
        setSelectedId(null)
        setDetailOpen(false)
        if (typeof localStorage !== 'undefined') {
          if (value) localStorage.setItem(ROOT_KEY, value)
          else localStorage.removeItem(ROOT_KEY)
        }
      }, [])

      const applyProject = (id) => {
        setSelectedId(null)
        setDetailOpen(false)
        if (id === ALL_PROJECTS) {
          setProjectId(ALL_PROJECTS)
          if (typeof localStorage !== 'undefined') localStorage.setItem(PROJECT_KEY, ALL_PROJECTS)
          return
        }
        const project = projects.find((entry) => entry.id === id || entry.workspaceId === id)
        if (!project) return
        setProjectId(project.id)
        if (typeof localStorage !== 'undefined') localStorage.setItem(PROJECT_KEY, project.id)
        applyRoot(project.root)
        setRootInput(project.root ?? '')
      }

      const openSnapshot = (item, version) => {
        const snapshotRoot = item.root ?? data?.root ?? root
        setSnapshot({ item, version, loading: true, content: null, error: null })
        const query = `root=${encodeURIComponent(snapshotRoot)}&asset=${encodeURIComponent(item.id)}&sha=${encodeURIComponent(version.sha)}`
        fetch(`/api/alm/requirements/version?${query}`, { headers: { accept: 'application/json' } })
          .then(async (response) => {
            const body = await response.json().catch(() => null)
            if (!response.ok || body?.ok === false) throw new Error(body?.error?.message ?? `HTTP ${response.status}`)
            setSnapshot((current) =>
              current?.version.sha === version.sha ? { ...current, loading: false, content: body.content } : current,
            )
          })
          .catch((error) =>
            setSnapshot((current) =>
              current?.version.sha === version.sha ? { ...current, loading: false, error: error.message } : current,
            ),
          )
      }

      const openDiff = (item, version) => {
        const diffRoot = item.root ?? data?.root ?? root
        setDiff({ loading: true, item, version, data: null, error: null })
        const query = `root=${encodeURIComponent(diffRoot)}&asset=${encodeURIComponent(item.id)}&from=${encodeURIComponent(version.sha)}`
        fetch(`/api/alm/requirements/diff?${query}`, { headers: { accept: 'application/json' } })
          .then(async (response) => {
            const body = await response.json().catch(() => null)
            if (!response.ok || body?.ok === false) throw new Error(body?.error?.message ?? `HTTP ${response.status}`)
            setDiff((current) => (current?.version.sha === version.sha ? { ...current, loading: false, data: body } : current))
          })
          .catch((error) =>
            setDiff((current) => (current?.version.sha === version.sha ? { ...current, loading: false, error: error.message } : current)),
          )
      }

      const projectMetaFor = useCallback(
        (item) => {
          if (!item) return null
          const fromProjects = projects.find((entry) => entry.projectId === item.project || entry.id === item.project)
          if (fromProjects) {
            return {
              name: fromProjects.name,
              repo: fromProjects.github ? `${fromProjects.github.owner}/${fromProjects.github.repo}` : null,
              board: fromProjects.github?.project?.number ?? null,
              workspaceTitle: fromProjects.title,
              linked: fromProjects.linked,
            }
          }
          if (data?.projectInfo) {
            return { name: data.projectInfo.name, repo: data.projectInfo.repo, board: data.projectInfo.board, workspaceTitle: data.projectName, linked: true }
          }
          return { name: item.projectName, repo: null, board: null }
        },
        [projects, data?.projectInfo, data?.projectName],
      )

      const items = data?.requirements ?? []
      // Selection is by occurrenceKey, not by UID: duplicate UIDs are kept as
      // two records and must be selectable independently.
      const keyOf = (item) => item?.occurrenceKey ?? item?.id
      const scopedItems = items
      const counts = {}
      for (const item of scopedItems) counts[item.status] = (counts[item.status] ?? 0) + 1
      const visible = scopedItems
        .filter((item) => filter === 'all' || item.status === filter)
        .filter((item) => {
          if (!keyword) return true
          const needle = keyword.toLowerCase()
          return (
            item.title.toLowerCase().includes(needle) ||
            item.id.toLowerCase().includes(needle) ||
            (item.owner ?? '').toLowerCase().includes(needle)
          )
        })

      const selected = items.find((item) => keyOf(item) === selectedId) ?? null
      const currentProject = projects.find((entry) => entry.id === projectId || entry.workspaceId === projectId) ?? null
      const openOccurrence = (occurrence) => {
        const match = items.find((item) => {
          if (occurrence?.occurrenceKey) return keyOf(item) === occurrence.occurrenceKey
          return item.id === (occurrence?.assetId ?? occurrence?.id ?? occurrence?.requirementIds?.[0])
        })
        if (match) setSelectedId(keyOf(match))
      }
      const openRequirementById = (id) => {
        const match = items.find((item) => item.id === id)
        setSelectedId(match ? keyOf(match) : id)
      }
      // INT-19: after a create, tell the user when the new requirement is
      // hidden by the current filter/keyword, without clearing their filter.
      const onIntentCreated = (result) => {
        if (result?.requirementId) setCreatedNotice({ requirementId: result.requirementId, awaiting: true })
        reload()
      }
      useEffect(() => {
        if (!createdNotice?.awaiting) return
        if (loading || !data) return
        setCreatedNotice((current) => (current && current.awaiting ? { ...current, awaiting: false } : current))
      }, [data, loading, createdNotice])
      const projectLabel =
        projectId === ALL_PROJECTS
          ? '全部项目'
          : currentProject?.title ?? data?.projectName ?? null
      const summary = data
        ? `${projectLabel ? `${projectLabel} · ` : ''}${data.summary.requirements} 条需求 · ${counts.proposed ?? 0} 条待评审 · ${counts['in-progress'] ?? 0} 条开发中 · check ${data.result}${data.scope === 'all' ? ` · ${data.summary.projects} 个项目` : ''}${data.anomalySummary?.count ? ` · ${data.anomalySummary.count} 个数据异常` : ''}`
        : '加载中…'

      const header = h(
        'div',
        { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' } },
        h(
          'div',
          null,
          h('h2', { style: { margin: 0, fontSize: '20px', fontWeight: 600, letterSpacing: '-.01em' } }, '需求'),
          h('p', { style: { margin: '6px 0 0', ...muted } }, summary),
        ),
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
          h(ProjectPicker, { projects, currentId: projectId, onPick: applyProject }),
          currentProject && projectId !== ALL_PROJECTS
            ? h('button', { style: button, onClick: () => setAssociateTarget(currentProject), title: '关联/更新该工作区的 GitHub 仓库与 ProjectV2' }, currentProject.linked ? '更新关联' : '关联仓库')
            : null,
          h('button', {
            style: primary,
            onClick: () => {
              if (currentProject && !currentProject.linked) {
                setAssociateTarget(currentProject)
                return
              }
              setCreateOpen(true)
            },
            title: currentProject && !currentProject.linked ? '先关联该工作区的 GitHub 仓库' : '澄清一个意图（先澄清，不会创建需求）',
          }, '＋ 新建'),
          h('button', { style: button, onClick: reload, title: '重新读取资产' }, '刷新'),
          h('button', { style: { ...button, borderColor: 'transparent', background: 'transparent', color: T.text2 }, onClick: () => setShowRoot((value) => !value) }, showRoot ? '收起根目录' : '仓库根'),
        ),
      )

      const toolbar = h(
        'div',
        { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', margin: '18px 0 14px', flexWrap: 'wrap' } },
        h(
          'div',
          { style: { display: 'inline-flex', gap: '2px', padding: '3px', background: T.base, border: `1px solid ${T.line}`, borderRadius: '10px', flexWrap: 'wrap' } },
          FILTERS.map(([id, label]) =>
            h(
              'button',
              {
                key: id,
                onClick: () => setFilter(id),
                style: {
                  border: 0,
                  background: filter === id ? T.layer2 : 'transparent',
                  color: filter === id ? T.text : T.text2,
                  borderRadius: '7px',
                  padding: '5px 10px',
                  fontSize: '12px',
                  cursor: 'pointer',
                },
              },
              label,
              h('span', { style: { marginLeft: '5px', color: T.text3, fontVariantNumeric: 'tabular-nums' } }, id === 'all' ? scopedItems.length : counts[id] ?? 0),
            ),
          ),
        ),
        h(
          'label',
          { style: { display: 'flex', alignItems: 'center', gap: '6px', border: `1px solid ${T.line}`, borderRadius: '9px', background: T.base, padding: '5px 10px', minWidth: '220px' } },
          h('span', { style: { color: T.text3, fontSize: '12px', whiteSpace: 'nowrap', flex: 'none' } }, '搜索'),
          h('input', {
            value: keyword,
            onChange: (event) => setKeyword(event.target.value),
            placeholder: '标题 / ID / 负责人',
            'aria-label': '搜索需求',
            style: { border: 0, outline: 0, background: 'transparent', color: T.text, fontSize: '12px', width: '100%' },
          }),
        ),
      )

      const createdBanner =
        createdNotice && !createdNotice.awaiting && !visible.some((item) => item.id === createdNotice.requirementId)
          ? h(
              'div',
              {
                role: 'status',
                style: {
                  ...card,
                  cursor: 'default',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px',
                  flexWrap: 'wrap',
                  borderColor: T.line2,
                  background: EVIDENCE_TONE.warn.bg,
                },
              },
              h('span', { style: { fontSize: '12.5px', color: T.text2 } }, `已创建 ${createdNotice.requirementId}，但当前筛选下不可见`),
              h(
                'button',
                {
                  style: button,
                  onClick: () => {
                    setFilter('all')
                    setKeyword('')
                    setCreatedNotice(null)
                  },
                },
                '清除筛选查看',
              ),
            )
          : null

      let body
      if (loading) {
        body = h('p', { style: muted }, '正在读取资产…')
      } else if (error) {
        body = h(
          'div',
          { style: { ...card, cursor: 'default' } },
          h('p', { style: { margin: '0 0 10px', color: T.err, fontSize: '13px' } }, error),
          h('button', { style: button, onClick: reload }, '重试'),
        )
      } else if (items.length === 0) {
        body = h(EmptyState, { root: data?.root ?? root, onOpenPanel: openPanel })
      } else {
        body = h(
          'div',
          null,
          data.scope === 'all'
            ? (data.projects ?? []).map((project) => {
                const projectItems = visible.filter((item) => item.project === project.project)
                if (projectItems.length === 0) return null
                return h(
                  'section',
                  { key: project.project, style: { marginBottom: '22px' } },
                  h(
                    'div',
                    { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px', color: T.text2, fontSize: '12px', flexWrap: 'wrap' } },
                    h('span', { style: { fontSize: '10.5px', letterSpacing: '.04em', color: T.brand, border: `1px solid ${T.line2}`, borderRadius: '5px', padding: '0 6px' } }, project.project),
                    h('b', { style: { color: T.text, fontSize: '13px', fontWeight: 600 } }, project.projectName ?? project.project),
                    h('span', { style: { color: T.text3 } }, `${project.root ?? ''} · ${projectItems.length} 条`),
                    project.error ? h('span', { style: { color: T.err } }, `读取失败：${project.error}`) : null,
                  ),
                  projectItems.map((item) => h(RequirementCard, { key: keyOf(item), item, showProject: false, onOpen: (entry) => setSelectedId(keyOf(entry)) })),
                )
              })
            : visible.map((item) => h(RequirementCard, { key: keyOf(item), item, showProject: false, onOpen: (entry) => setSelectedId(keyOf(entry)) })),
          visible.length === 0
            ? h('div', { style: { ...card, cursor: 'default', textAlign: 'center', color: T.text2, padding: '36px' } }, '没有符合筛选条件的需求')
            : null,
        )
      }

      const gapsBlock =
        data && data.gaps?.length
          ? h(
              'div',
              { style: { marginTop: '24px' } },
              h('h3', { style: { margin: '0 0 6px', fontSize: '13px', fontWeight: 600, color: T.text2 } }, `门禁 check 缺口（${data.gaps.length}）`),
              h(
                'div',
                { style: { border: `1px solid ${T.line}`, borderRadius: '10px', padding: '2px 12px' } },
                data.gaps.map((gap, index) => h(GapDetail, { key: `${gap.rule}-${index}`, gap, index })),
              ),
            )
          : data
            ? h('p', { style: { marginTop: '20px', ...muted } }, '没有追踪缺口。')
            : null

      return h(
        'div',
        { style: panel },
        header,
        showRoot ? h(RootPicker, { rootInput, setRootInput, onApply: () => applyRoot(rootInput), onReset: () => { setRootInput(''); applyRoot('') } }) : null,
        toolbar,
        createdBanner,
        body,
        h(AnomalyBlock, { anomalies: data?.anomalies, summary: data?.anomalySummary, onOpen: openOccurrence }),
        gapsBlock,
        selected
          ? h(Drawer, {
              item: selected,
              allItems: items,
              projectMeta: projectMetaFor(selected),
              root: data?.root ?? root,
              onClose: () => setSelectedId(null),
              onDetail: () => setDetailOpen(true),
              onSnapshot: openSnapshot,
              onDiff: openDiff,
              onTrace: (entry) => setTraceItem(entry),
              onStart: (entry) => setStartItem(entry),
              onAccept: (entry) => setAcceptItem(entry),
              onAcceptance: (entry) => setAcceptanceItem(entry),
              onAiReview: (entry) => setAiReviewItem(entry),
              onRehearsal: (entry) => setRehearsalItem(entry),
            })
          : null,
        detailOpen && selected
          ? h(DetailModal, {
              item: selected,
              allItems: items,
              projectMeta: projectMetaFor(selected),
              root: data?.root ?? root,
              onClose: () => setDetailOpen(false),
              onSnapshot: openSnapshot,
              onDiff: openDiff,
              onTrace: (entry) => setTraceItem(entry),
              onStart: (entry) => setStartItem(entry),
              onAccept: (entry) => setAcceptItem(entry),
              onAcceptance: (entry) => setAcceptanceItem(entry),
              onAiReview: (entry) => setAiReviewItem(entry),
              onRehearsal: (entry) => setRehearsalItem(entry),
            })
          : null,
        snapshot ? h(SnapshotModal, { snapshot, onClose: () => setSnapshot(null) }) : null,
        diff ? h(DiffModal, { state: diff, onClose: () => setDiff(null) }) : null,
        startItem
          ? h(StartModal, {
              item: startItem,
              root: startItem.root ?? data?.root ?? root,
              projectMeta: projectMetaFor(startItem),
              onClose: () => setStartItem(null),
              onGithubApplied: () => reload(),
            })
          : null,
        acceptItem
          ? h(AcceptModal, {
              item: acceptItem,
              root: acceptItem.root ?? data?.root ?? root,
              onClose: () => setAcceptItem(null),
            })
          : null,
        aiReviewItem
          ? h(AiReviewModal, {
              item: aiReviewItem,
              root: aiReviewItem.root ?? data?.root ?? root,
              onClose: () => setAiReviewItem(null),
              onDone: () => reload(),
            })
          : null,
        rehearsalItem
          ? h(RehearsalModal, {
              item: rehearsalItem,
              root: rehearsalItem.root ?? data?.root ?? root,
              onClose: () => setRehearsalItem(null),
              onDone: () => reload(),
            })
          : null,
        acceptanceItem
          ? h(AcceptanceModal, {
              item: acceptanceItem,
              root: acceptanceItem.root ?? data?.root ?? root,
              onClose: () => setAcceptanceItem(null),
              onDone: () => reload(),
            })
          : null,
        associateTarget
          ? h(AssociateModal, {
              workspace: associateTarget,
              onClose: () => setAssociateTarget(null),
              onLinked: (result) => {
                setProjectId(result.id)
                if (typeof localStorage !== 'undefined') localStorage.setItem(PROJECT_KEY, result.id)
                loadProjects()
                reload()
              },
            })
          : null,
        createOpen
          ? h(IntentModal, {
              root: data?.root ?? root,
              project: data?.project ?? currentProject?.projectId,
              projectName: data?.projectName ?? currentProject?.name,
              projectId: data?.project ?? currentProject?.projectId ?? null,
              requirementCount: data?.summary?.requirements,
              onClose: () => setCreateOpen(false),
              onCreated: onIntentCreated,
              onOpenRequirement: (id) => {
                setCreateOpen(false)
                setDetailOpen(false)
                openRequirementById(id)
              },
            })
          : null,
        traceItem
          ? h(TraceModal, {
              item: traceItem,
              allItems: items,
              onClose: () => setTraceItem(null),
              onOpenRequirement: (id) => {
                setTraceItem(null)
                setDetailOpen(false)
                openRequirementById(id)
              },
            })
          : null,
        h(
          'div',
          { style: { display: 'flex', gap: '8px', marginTop: '20px' } },
          h('button', { style: button, onClick: reload }, '刷新'),
          openPanel ? h('button', { style: button, onClick: openPanel }, 'Open as main panel') : null,
        ),
      )
    }

    /** Sidebar rail icon: a small checklist glyph using the shell's current color. */
    function RequirementsIcon() {
      return h(
        'svg',
        { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('path', {
          d: 'M3.5 2.5h6l3 3v8a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Z',
          stroke: 'currentColor',
          strokeWidth: 1.2,
        }),
        h('path', { d: 'M5.5 7h5M5.5 10h4', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' }),
      )
    }

    return {
      inject: ['slots', 'layout'],
      apply(ctx) {
        // Both entry points render the same workbench: the sidebar rail icon opens
        // the main panel, and Settings shows it instead of a second intro screen.
        function SettingsPage() {
          return h(Workbench, { openPanel: () => ctx.layout.selectPanel('requirements') })
        }
        function MainPage() {
          return h(Workbench, {})
        }
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register({ name: 'settings.section', id: 'requirements', order: 91, label: 'Requirements' }, SettingsPage),
        )
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register({ name: 'sidebar.panellist', id: 'requirements', order: 90, label: () => '需求' }, RequirementsIcon),
        )
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'requirements' }, MainPage))
      },
    }
  },
})
