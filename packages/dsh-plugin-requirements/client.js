window.__ModuleLoader__.load({
  id: '@ai-alm/dsh-plugin-requirements',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback } = React

    const ROOT_KEY = 'alm.requirements.root'
    const PROJECT_KEY = 'alm.requirements.project'
    const ALL_PROJECTS = 'ALL'
    const REDUCE_MOTION =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
        : false

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

    const panel = {
      padding: '0 30px 40px',
      width: '100%',
      margin: 0,
      color: T.text,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
      boxSizing: 'border-box',
      height: '100vh',
      overflowY: 'auto',
      overflowX: 'hidden',
    }
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

    /* ---------------------------------------------------------------------
     * Requirement list: one compact surface for scanning. Business status and
     * evidence/check state are separate columns; a row is never taller than it
     * needs to be. All data comes from the query payload.
     * ------------------------------------------------------------------- */

    const LIST_COLUMNS = 'minmax(280px, 1fr) 108px 104px 96px 132px 76px'
    const LIST_COLUMNS_NARROW = 'minmax(220px, 1fr) 104px 132px 76px'
    const LIST_COLUMNS_MOBILE = 'minmax(0, 1fr) 68px'

    function listColumns(narrow, mobile) {
      if (mobile) return LIST_COLUMNS_MOBILE
      return narrow ? LIST_COLUMNS_NARROW : LIST_COLUMNS
    }

    function listCell(extra) {
      return { minWidth: 0, display: 'flex', alignItems: 'center', ...extra }
    }

    function acceptanceLabel(item) {
      const count = item.verifiedBy?.length ?? 0
      return count > 0 ? `${count} 项` : '—'
    }

    function anomalyLine(item) {
      const first = item.anomalies?.[0]
      if (!first) return null
      const label = ANOMALY_LABELS[first.kind] ?? first.kind
      return item.anomalies.length > 1 ? `${label}等 ${item.anomalies.length} 项数据异常` : `${label} · 需澄清`
    }

    function RequirementRow({ item, narrow, mobile, showProject, selected = false, onOpen }) {
      const key = item.occurrenceKey ?? item.id
      const decision = item.decision ?? null
      const anomaly = anomalyLine(item)
      const open = () => onOpen(item)
      const subline = [
        h(
          'code',
          { key: 'id', style: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: '11.5px', color: T.text2 } },
          item.id,
        ),
        h('span', { key: 'rev', style: { color: T.text3, fontSize: '11px' } }, `v${item.revision ?? 1}`),
        showProject && item.projectName
          ? h('span', { key: 'project', style: { color: T.text3, fontSize: '11px' } }, item.projectName)
          : null,
      ]
      return h(
        'div',
        {
          role: 'row',
          'data-req': key,
          style: {
            display: 'grid',
            gridTemplateColumns: listColumns(narrow, mobile),
            columnGap: '14px',
            alignItems: 'center',
            boxSizing: 'border-box',
            minHeight: mobile ? '64px' : '68px',
            padding: mobile ? '10px 14px' : '9px 16px',
            borderTop: `1px solid ${T.line}`,
            background: selected ? T.layer2 : 'transparent',
            transition: REDUCE_MOTION ? 'none' : 'background-color 140ms ease',
          },
          'aria-selected': selected,
          onMouseEnter: (event) => {
            if (!selected) event.currentTarget.style.background = T.layer2
          },
          onMouseLeave: (event) => {
            event.currentTarget.style.background = selected ? T.layer2 : 'transparent'
          },
          onClick: open,
        },
        h(
          'div',
          { role: 'cell', style: { minWidth: 0 } },
          h(
            'button',
            {
              type: 'button',
              onClick: (event) => {
                event.stopPropagation()
                open()
              },
              title: `打开需求：${item.title}`,
              style: {
                display: 'block',
                maxWidth: '100%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                border: 0,
                padding: 0,
                background: 'transparent',
                color: T.text,
                font: 'inherit',
                fontSize: '14px',
                fontWeight: 600,
                letterSpacing: '-.005em',
                textAlign: 'left',
                cursor: 'pointer',
                outlineColor: T.brand,
              },
            },
            item.title,
          ),
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, marginTop: '3px', flexWrap: 'wrap' } },
            subline,
            mobile
              ? h(Pill, { status: item.status, label: item.statusLabel })
              : null,
            mobile && decision ? h(DecisionPill, { decision }) : null,
            anomaly
              ? h('span', { style: { color: T.err, fontSize: '11px', whiteSpace: 'nowrap' } }, anomaly)
              : null,
          ),
        ),
        mobile ? null : h('div', { role: 'cell', style: listCell() }, h(Pill, { status: item.status, label: item.statusLabel })),
        narrow || mobile
          ? null
          : h(
              'div',
              { role: 'cell', style: listCell({ color: item.owner ? T.text2 : T.text3, fontSize: '12.5px' }) },
              item.owner || '未分配',
            ),
        narrow || mobile
          ? null
          : h(
              'div',
              {
                role: 'cell',
                style: listCell({ color: (item.verifiedBy?.length ?? 0) > 0 ? T.text2 : T.text3, fontSize: '12.5px' }),
                title: (item.verifiedBy ?? []).join('、') || '尚未关联验收',
              },
              acceptanceLabel(item),
            ),
        mobile
          ? null
          : h(
          'div',
          { role: 'cell', style: listCell({ gap: '4px', flexDirection: 'column', alignItems: 'flex-start' }) },
          decision
            ? h('span', { title: decision.topGap?.message }, h(DecisionPill, { decision }))
            : h('span', { style: { color: T.text3, fontSize: '11.5px' } }, '未检查'),
        ),
        h(
          'div',
          { role: 'cell', style: listCell({ justifyContent: 'flex-end' }) },
          h(
            'button',
            {
              type: 'button',
              onClick: (event) => {
                event.stopPropagation()
                open()
              },
              'aria-label': `查看 ${item.title}`,
              title: '打开详情',
              style: {
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
                height: '28px',
                padding: '0 9px',
                border: `1px solid ${T.line}`,
                borderRadius: '7px',
                background: 'transparent',
                color: T.text2,
                fontSize: '11.5px',
                cursor: 'pointer',
              },
            },
            h(ActionIcon, { name: 'eye', size: 13 }),
            '详情',
          ),
        ),
      )
    }

    function RequirementTable({ items, narrow, mobile, showProject, selectedKey, onOpen, emptyNode, stickyTop = 0 }) {
      const columns = listColumns(narrow, mobile)
      const headerCell = (label, extra) =>
        h(
          'div',
          { role: 'columnheader', style: { minWidth: 0, fontSize: '11px', color: T.text3, fontWeight: 500, letterSpacing: '.02em', ...extra } },
          label,
        )
      return h(
        'div',
        {
          role: 'table',
          'aria-label': '需求列表',
          style: { border: `1px solid ${T.line}`, borderRadius: '12px', background: T.layer, overflow: 'visible' },
        },
        h(
          'div',
          {
            role: 'row',
            style: {
              display: 'grid',
              gridTemplateColumns: columns,
              columnGap: '14px',
              alignItems: 'center',
              padding: mobile ? '9px 14px' : '9px 16px',
              background: T.base,
              borderBottom: `1px solid ${T.line}`,
              borderTopLeftRadius: '12px',
              borderTopRightRadius: '12px',
              position: 'sticky',
              top: `${stickyTop}px`,
              zIndex: 15,
            },
          },
          headerCell('需求'),
          mobile ? null : headerCell('业务状态'),
          narrow || mobile ? null : headerCell('负责人'),
          narrow || mobile ? null : headerCell('验收关联'),
          mobile ? null : headerCell('检查结果'),
          headerCell('操作', { textAlign: 'right' }),
        ),
        items.length > 0
          ? items.map((item) =>
              h(RequirementRow, {
                key: item.occurrenceKey ?? item.id,
                item,
                narrow,
                mobile,
                showProject,
                selected: selectedKey === (item.occurrenceKey ?? item.id),
                onOpen,
              }),
            )
          : emptyNode ?? null,
      )
    }

    function SkeletonTable({ narrow, mobile }) {
      const columns = listColumns(narrow, mobile)
      const row = (index) =>
        h(
          'div',
          {
            key: index,
            style: { display: 'grid', gridTemplateColumns: columns, columnGap: '14px', alignItems: 'center', minHeight: '68px', padding: '9px 16px', borderTop: `1px solid ${T.line}` },
          },
          h(
            'div',
            null,
            h('div', { style: { width: `${48 + ((index * 17) % 30)}%`, height: '12px', borderRadius: '5px', background: T.layer2 } }),
            h('div', { style: { width: '110px', height: '9px', borderRadius: '4px', background: T.layer2, marginTop: '8px' } }),
          ),
          narrow || mobile ? null : h('div', { style: { width: '58px', height: '18px', borderRadius: '999px', background: T.layer2 } }),
          narrow || mobile ? null : h('div', { style: { width: '46px', height: '10px', borderRadius: '4px', background: T.layer2 } }),
          narrow || mobile ? null : h('div', { style: { width: '34px', height: '10px', borderRadius: '4px', background: T.layer2 } }),
          h('div', { style: { width: '72px', height: '18px', borderRadius: '999px', background: T.layer2 } }),
          h('div', { style: { justifySelf: 'end', width: '46px', height: '22px', borderRadius: '6px', background: T.layer2 } }),
        )
      return h(
        'div',
        { 'aria-busy': 'true', 'aria-label': '正在读取需求', style: { border: `1px solid ${T.line}`, borderRadius: '12px', background: T.layer, overflow: 'hidden' } },
        h('div', { style: { height: '35px', borderBottom: `1px solid ${T.line}`, background: T.base } }),
        [0, 1, 2, 3, 4, 5, 6, 7].map(row),
      )
    }

    function NoResults({ filter, keyword, anomalyOnly, onClear }) {
      return h(
        'div',
        { style: { textAlign: 'center', padding: '54px 24px' } },
        h('p', { style: { margin: 0, color: T.text, fontSize: '14px', fontWeight: 600 } }, '没有符合条件的需求'),
        h(
          'p',
          { style: { margin: '7px 0 18px', color: T.text2, fontSize: '12.5px' } },
          [filter !== 'all' ? `状态：${(FILTERS.find(([id]) => id === filter) ?? [])[1] ?? filter}` : null, keyword ? `搜索：${keyword}` : null, anomalyOnly ? '只看异常' : null]
            .filter(Boolean)
            .join(' · ') || '当前筛选下没有记录。',
        ),
        h(
          'button',
          {
            type: 'button',
            onClick: onClear,
            style: { border: `1px solid ${T.line2}`, background: T.layer2, color: T.text, borderRadius: '8px', padding: '6px 12px', fontSize: '12px', cursor: 'pointer' },
          },
          '清除筛选',
        ),
      )
    }

    function AnomalyNotice({ anomalies, summary, expanded, anomalyOnly, onToggleExpanded, onToggleOnly, onOpen }) {
      const list = anomalies ?? []
      if (list.length === 0) return null
      const records = new Set()
      for (const anomaly of list) {
        for (const occurrence of anomaly.occurrences ?? []) {
          records.add(occurrence.occurrenceKey ?? occurrence.assetId ?? occurrence.id ?? occurrence.file ?? JSON.stringify(occurrence))
        }
      }
      const counts = summary ?? {}
      const breakdown = [
        counts.duplicateId ? `需求 ID 重复 ${counts.duplicateId} 组` : null,
        counts.duplicateBusinessId ? `业务编号重复 ${counts.duplicateBusinessId} 组` : null,
        counts.dangling ? `悬空关系 ${counts.dangling} 组` : null,
      ]
        .filter(Boolean)
        .join(' · ')
      return h(
        'section',
        {
          'aria-label': '数据异常提示',
          style: { margin: '0 0 14px', border: `1px solid ${T.line}`, borderLeft: `3px solid ${T.err}`, borderRadius: '10px', background: 'rgba(255,139,139,.055)', padding: '10px 12px' },
        },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } },
          h(ActionIcon, { name: 'alert', size: 15 }),
          h(
            'div',
            { style: { minWidth: 0, flex: 1 } },
            h(
              'span',
              { style: { color: T.text, fontSize: '12.5px', fontWeight: 500 } },
              `发现 ${list.length} 组数据异常，涉及 ${records.size} 条记录`,
            ),
            breakdown ? h('span', { style: { marginLeft: '9px', color: T.text2, fontSize: '11.5px' } }, breakdown) : null,
            h('span', { style: { display: 'block', marginTop: '3px', color: T.text2, fontSize: '11.5px' } }, '保留全部记录，不自动合并；打开记录人工核对。'),
          ),
          h(
            'button',
            {
              type: 'button',
              onClick: onToggleOnly,
              'aria-pressed': anomalyOnly,
              style: {
                border: `1px solid ${anomalyOnly ? 'rgba(255,139,139,.45)' : T.line}`,
                background: anomalyOnly ? 'rgba(255,139,139,.12)' : 'transparent',
                color: anomalyOnly ? T.err : T.text2,
                borderRadius: '7px',
                padding: '5px 10px',
                fontSize: '11.5px',
                cursor: 'pointer',
              },
            },
            anomalyOnly ? '显示全部' : '只看异常',
          ),
          h(
            'button',
            {
              type: 'button',
              onClick: onToggleExpanded,
              'aria-expanded': expanded,
              style: { border: `1px solid ${T.line}`, background: 'transparent', color: T.text2, borderRadius: '7px', padding: '5px 10px', fontSize: '11.5px', cursor: 'pointer' },
            },
            expanded ? '收起原因' : '查看原因',
          ),
        ),
        expanded
          ? h(
              'div',
              { style: { marginTop: '10px', borderTop: `1px solid ${T.line}`, paddingTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' } },
              list.map((anomaly, index) =>
                h(
                  'div',
                  { key: `${anomaly.kind}-${index}`, style: { fontSize: '12px', color: T.text2, lineHeight: 1.7 } },
                  h('span', { style: { color: T.err, marginRight: '7px', fontSize: '11px' } }, ANOMALY_LABELS[anomaly.kind] ?? anomaly.kind),
                  anomaly.message,
                  (anomaly.occurrences ?? []).length
                    ? h(
                        'div',
                        { style: { display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '3px' } },
                        anomaly.occurrences.map((occurrence, occurrenceIndex) =>
                          h(
                            'button',
                            {
                              type: 'button',
                              key: `${occurrence.occurrenceKey ?? occurrenceIndex}-${occurrenceIndex}`,
                              onClick: () => onOpen?.(occurrence),
                              style: { border: 0, padding: 0, background: 'transparent', color: T.brand, fontSize: '11.5px', cursor: 'pointer' },
                            },
                            `${occurrence.assetId ?? occurrence.id ?? occurrence.occurrenceKey ?? '—'}${occurrence.title ? ` · ${occurrence.title}` : ''}`,
                          ),
                        ),
                      )
                    : null,
                ),
              ),
            )
          : null,
      )
    }

    function CheckNotice({ data, expanded, onToggleExpanded }) {
      if (!data) return null
      const failedProjects = (data.projects ?? []).filter((project) => project.error)
      const gaps = data.gaps ?? []
      const executionFailed = failedProjects.length > 0 || data.summary?.failed > 0
      const gateFailed = data.result && data.result !== 'pass'
      if (!executionFailed && !gateFailed && gaps.length === 0) return null
      const tone = executionFailed ? T.err : T.warn
      const title = executionFailed
        ? `检查执行失败：${failedProjects.length || data.summary?.failed || 0} 个工作区无法读取`
        : `检查未通过：${gaps.length} 个门禁缺口`
      const detail = executionFailed
        ? '这是读取或执行失败，不是需求未通过；修复后重新检查。'
        : '需求文件已读取，门禁规则未全部通过；展开查看规则与修复建议。'
      return h(
        'section',
        {
          'aria-label': '检查结果提示',
          style: { margin: '0 0 14px', border: `1px solid ${T.line}`, borderLeft: `3px solid ${tone}`, borderRadius: '10px', background: T.layer, padding: '10px 12px' },
        },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } },
          h('span', { style: { width: '7px', height: '7px', borderRadius: '50%', background: tone, flex: 'none' } }),
          h(
            'div',
            { style: { minWidth: 0, flex: 1 } },
            h('span', { style: { color: T.text, fontSize: '12.5px', fontWeight: 500 } }, title),
            h('span', { style: { display: 'block', marginTop: '2px', color: T.text2, fontSize: '11.5px' } }, detail),
          ),
          executionFailed || gaps.length > 0
            ? h(
                'button',
                {
                  type: 'button',
                  onClick: onToggleExpanded,
                  'aria-expanded': expanded,
                  style: { border: `1px solid ${T.line}`, background: 'transparent', color: T.text2, borderRadius: '7px', padding: '5px 10px', fontSize: '11.5px', cursor: 'pointer' },
                },
                expanded ? '收起' : '查看原因',
              )
            : null,
        ),
        expanded
          ? h(
              'div',
              { style: { marginTop: '9px', borderTop: `1px solid ${T.line}`, paddingTop: '4px' } },
              failedProjects.map((project) =>
                h(
                  'div',
                  { key: project.project, style: { padding: '5px 0', fontSize: '12px', color: T.text2 } },
                  h('b', { style: { color: T.text } }, project.projectName ?? project.project),
                  `：${project.error}`,
                ),
              ),
              gaps.length
                ? h('div', { style: { border: `1px solid ${T.line}`, borderRadius: '9px', padding: '2px 10px', marginTop: '4px' } }, gaps.map((gap, index) => h(GapDetail, { key: `${gap.project ?? ''}-${gap.rule ?? gap.code}-${index}`, gap, index })))
                : null,
            )
          : null,
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
      search: 'M11 4a7 7 0 105.2 11.7L21 21M11 4a7 7 0 00-7 7',
      refresh: 'M20 11a8 8 0 10-2.3 5.7M20 5v6h-6',
      more: 'M5 12h.01M12 12h.01M19 12h.01',
      plus: 'M12 5v14M5 12h14',
      chevron: 'M9 6l6 6-6 6',
      folder: 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z',
      link: 'M10 13a5 5 0 007 0l2-2a5 5 0 00-7-7l-1 1M14 11a5 5 0 00-7 0l-2 2a5 5 0 007 7l1-1',
      alert: 'M12 3l9 16H3zM12 9v5M12 17h.01',
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
            padding: '7px 12px',
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

    function CreateModal({ root, project, projectName, onClose, onCreated }) {
      const [form, setForm] = useState({ title: '', brief: '', priority: 'P1', owner: '张浩' })
      const [intent, setIntent] = useState('')
      const [aiDraft, setAiDraft] = useState({ loading: false, error: null, draft: null })
      const [source, setSource] = useState('text')
      const [attachment, setAttachment] = useState(null)
      const [chatMarkdown, setChatMarkdown] = useState('')
      const [intake, setIntake] = useState({ loading: false, error: null, data: null })
      const [state, setState] = useState({ loading: false, error: null, plan: null, result: null })
      const field = (key) => ({
        value: form[key],
        onChange: (event) => setForm((current) => ({ ...current, [key]: event.target.value })),
      })
      const payload = (apply) => ({ ...form, attachments: attachment ? [attachment] : [], apply })
      const preview = () => {
        setState({ loading: true, error: null, plan: null, result: null })
        writeJson('create', payload(false), root)
          .then((plan) => setState({ loading: false, error: null, plan, result: null }))
          .catch((error) => setState({ loading: false, error: error.message, plan: null, result: null }))
      }
      const apply = () => {
        setState((current) => ({ ...current, loading: true, error: null }))
        writeJson('create', payload(true), root)
          .then((result) => {
            setState((current) => ({ ...current, loading: false, result }))
            onCreated?.(result)
          })
          .catch((error) => setState((current) => ({ ...current, loading: false, error: error.message })))
      }
      const generateDraft = (overrideIntent) => {
        const text = String(overrideIntent ?? intent ?? '').trim()
        if (text === '') return
        setAiDraft({ loading: true, error: null, draft: null })
        writeJson('draft', { intent: text, source, extractedText: parsed?.text ?? '', projectName }, root)
          .then((draft) => {
            // AI only proposes: never auto-fill priority/owner (or any field)
            // before the human explicitly adopts the suggestion.
            setAiDraft({ loading: false, error: null, draft })
          })
          .catch((error) => setAiDraft({ loading: false, error: error.message, draft: null }))
      }
      const adoptSuggestion = (key, suggestedValue) => {
        const suggested = suggestedValue ?? aiDraft.draft?.[key]
        if (suggested === undefined || suggested === null || suggested === '') return
        setForm((current) => ({ ...current, [key]: suggested }))
      }
      const suggestionRow = (label, suggested, key, adoptValue) => {
        if (!suggested) return null
        const shown = String(suggested).length > 160 ? `${String(suggested).slice(0, 160)}…` : String(suggested)
        return h(
          'div',
          { style: { display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap', padding: '3px 0', fontSize: '12px', color: T.text2 } },
          h('span', { style: { color: T.text3, flex: 'none' } }, label),
          h('span', { style: { color: T.text, minWidth: 0, wordBreak: 'break-word' } }, shown),
          h('button', { style: { ...button, padding: '1px 8px', fontSize: '11px', flex: 'none' }, onClick: () => adoptSuggestion(key, adoptValue) }, '采用'),
        )
      }
      const suggestionNote = (label, values) => {
        const list = (values ?? []).filter(Boolean)
        if (list.length === 0) return null
        return h(
          'div',
          { style: { padding: '3px 0', fontSize: '12px', color: T.text2, lineHeight: 1.8 } },
          h('span', { style: { color: T.text3, marginRight: '6px' } }, label),
          list.join('；'),
        )
      }
      const runIntake = (body) => {
        setIntake({ loading: true, error: null, data: null })
        writeJson('intake', body, root)
          .then((data) => {
            setIntake({ loading: false, error: null, data })
            const text = data.text ?? ''
            if (text) {
              setIntent(text)
              generateDraft(text)
            }
          })
          .catch((error) => setIntake({ loading: false, error: error.message, data: null }))
      }
      const onFile = (event) => {
        const file = event.target.files?.[0]
        if (!file) return
        const reader = new FileReader()
        reader.onload = () => {
          const base64 = String(reader.result ?? '').split(',')[1] ?? ''
          setAttachment({ name: file.name.replace(/[^A-Za-z0-9._-]/g, '_'), kind: 'screenshot', dataBase64: base64 })
          runIntake({ mode: 'ocr', filename: file.name, imageBase64: base64 })
        }
        reader.onerror = () => setIntake({ loading: false, error: '读取图片失败', data: null })
        reader.readAsDataURL(file)
      }
      const useAsBackground = (text) => {
        if (!text) return
        setForm((current) => ({ ...current, brief: current.brief ? `${current.brief}\n\n${text}` : text }))
      }
      const parsed = intake.data
      const result = state.result
      const tabs = [
        ['text', '口语 / 文本'],
        ['ocr', '截图 OCR'],
        ['chat', '聊天记录'],
      ]
      const sourcePanel =
        source === 'text'
          ? null
          : source === 'ocr'
            ? h(
                'div',
                { style: { border: `1px solid ${T.line}`, borderRadius: '10px', padding: '12px', marginTop: '4px' } },
                h('input', { type: 'file', accept: 'image/*', onChange: onFile, style: { fontSize: '12px', color: T.text2 } }),
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
                      h('button', { style: { ...button, marginTop: '8px' }, onClick: () => useAsBackground(parsed.text) }, '使用 OCR 文本为背景'),
                    )
                  : null,
              )
            : h(
                'div',
                { style: { border: `1px solid ${T.line}`, borderRadius: '10px', padding: '12px', marginTop: '4px' } },
                h('textarea', {
                  value: chatMarkdown,
                  onChange: (event) => setChatMarkdown(event.target.value),
                  placeholder: '粘贴聊天记录，例如：10:12 张三：退款要幂等',
                  style: { ...input, minHeight: '80px', resize: 'vertical', fontFamily: 'inherit', width: '100%' },
                }),
                h('button', {
                  style: { ...button, marginTop: '8px' },
                  onClick: () => {
                    if (chatMarkdown.trim() === '') return
                    setAttachment({ name: 'chat.md', kind: 'chat', text: chatMarkdown })
                    runIntake({ mode: 'chat', markdown: chatMarkdown })
                  },
                }, '解析聊天'),
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
                          h('div', { key: message.id, style: { padding: '3px 0', fontSize: '12px', color: T.text2, borderBottom: `1px solid ${T.line}` } },
                            h('span', { style: { color: T.text3, marginRight: '6px' } }, message.ref),
                            h('b', { style: { color: T.text, fontWeight: 500 } }, message.speaker || '—'),
                            ` ${message.text}`,
                          ),
                        ),
                      ),
                      h('button', { style: { ...button, marginTop: '8px' }, onClick: () => useAsBackground(parsed.text) }, '使用聊天内容为背景'),
                    )
                  : null,
              )
      return h(
        ModalShell,
        {
          title: '新建需求',
          lead: `归属项目 ${projectName ?? project ?? '—'}；输入口语 / 聊天 / 截图，AI 生成建议草稿（待确认），不会自动填写优先级与负责人；预览确认后创建。`,
          onClose,
          width: '820px',
          footer: [
            h('button', { key: 'cancel', style: button, onClick: onClose }, result ? '关闭' : '取消'),
            result
              ? null
              : state.plan
                ? h('button', { key: 'apply', style: primary, onClick: apply, disabled: state.loading }, state.loading ? '创建中…' : '确认创建')
                : h('button', { key: 'preview', style: primary, onClick: preview, disabled: state.loading || form.title.trim() === '' }, '预览'),
          ],
        },
        h(
          'div',
          { style: { display: 'flex', gap: '6px', marginTop: '14px', borderBottom: `1px solid ${T.line}`, paddingBottom: '8px' } },
          tabs.map(([id, label]) =>
            h(
              'button',
              {
                key: id,
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
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '14px' } },
          h(
            'div',
            { style: { border: `1px solid ${T.line}`, borderRadius: '10px', padding: '12px', background: T.layer } },
            h('label', { style: { display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '12px', color: T.text2 } },
              '需求意图（直接用口语描述，或先在截图/聊天标签解析）',
              h('textarea', {
                value: intent,
                onChange: (event) => setIntent(event.target.value),
                placeholder: '例如：退款这里老是重复退，财务对账很麻烦，要保证同一笔订单只退一次，并发也不能重复扣款。',
                style: { ...input, minHeight: '76px', resize: 'vertical', fontFamily: 'inherit', width: '100%' },
              }),
            ),
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '8px', flexWrap: 'wrap' } },
              h('button', { style: primary, onClick: () => generateDraft(), disabled: aiDraft.loading || intent.trim() === '' }, aiDraft.loading ? 'AI 正在生成…' : 'AI 生成需求草稿'),
              h('span', { style: { ...muted } }, 'AI 只生成建议草稿（待确认）；优先级与负责人不会被自动填写。'),
            ),
            aiDraft.loading ? h('p', { style: { margin: '6px 0 0', ...muted } }, '正在调用 DSH 默认模型整理需求，约 5–30 秒…') : null,
            aiDraft.error ? h('p', { style: { margin: '6px 0 0', color: T.err, fontSize: '12px' } }, aiDraft.error) : null,
            aiDraft.draft
              ? h(
                  'div',
                  { style: { marginTop: '8px', border: `1px dashed ${T.line2}`, borderRadius: '10px', padding: '10px 12px' } },
                  h('div', { style: { fontSize: '11px', letterSpacing: '.08em', textTransform: 'uppercase', color: T.text3, marginBottom: '4px' } }, 'AI 建议（待确认）'),
                  suggestionRow('标题', aiDraft.draft.title, 'title'),
                  suggestionRow('背景', aiDraft.draft.brief, 'brief'),
                  suggestionRow(
                    '建议优先级',
                    aiDraft.draft.suggestedPriority ?? aiDraft.draft.priority,
                    'priority',
                    aiDraft.draft.suggestedPriority ?? aiDraft.draft.priority,
                  ),
                  h('p', { style: { margin: '3px 0 0', ...muted, lineHeight: 1.8 } }, '负责人：AI 不提供建议，由人工指定；表单里已有的负责人不会被覆盖。'),
                  aiDraft.draft.rationale ? h('p', { style: { margin: '6px 0 0', ...muted, lineHeight: 1.8 } }, aiDraft.draft.rationale) : null,
                  suggestionNote('核心断言', [aiDraft.draft.claim]),
                  suggestionNote('假设', aiDraft.draft.assumptions),
                  suggestionNote('待确认问题', [aiDraft.draft.question]),
                  suggestionNote('反例（不是已发生缺陷）', [aiDraft.draft.counterexample]),
                  suggestionNote('验收线索', aiDraft.draft.acceptanceDraft),
                  suggestionNote('未知 / 待确认', aiDraft.draft.unknowns),
                  h('p', { style: { margin: '6px 0 0', fontSize: '11.5px', color: T.text3 } }, '需逐项手动「采用」；未采用的建议不会写入表单。'),
                )
              : null,
          ),
          h('label', { style: { display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', color: T.text2 } }, '标题', h('input', { ...field('title'), style: input, placeholder: '可手填，或采用 AI 建议' })),
          h('label', { style: { display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', color: T.text2 } }, '背景 / 目标', h('textarea', { ...field('brief'), style: { ...input, minHeight: '88px', resize: 'vertical', fontFamily: 'inherit' }, placeholder: '原始诉求、目标与范围外' })),
          sourcePanel,
          attachment
            ? h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', fontSize: '12px', color: T.text2 } },
                h('span', null, `附件：${attachment.name}（${attachment.kind}）`),
                h('button', { style: { ...button, padding: '2px 8px' }, onClick: () => { setAttachment(null); setIntake({ loading: false, error: null, data: null }) } }, '移除'),
              )
            : null,
          h(
            'div',
            { style: { display: 'flex', gap: '10px', flexWrap: 'wrap' } },
            h('label', { style: { display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', color: T.text2 } }, '优先级', h('select', { ...field('priority'), style: input }, ['P0', 'P1', 'P2'].map((value) => h('option', { key: value, value }, value)))),
            h('label', { style: { flex: 1, display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', color: T.text2 } }, '责任人', h('input', { ...field('owner'), style: input, placeholder: '默认张浩' })),
          ),
        ),
        state.loading ? h('p', { style: { margin: '12px 0 0', ...muted } }, '处理中…') : null,
        state.error ? h('p', { style: { margin: '12px 0 0', color: T.err, fontSize: '13px' } }, state.error) : null,
        state.plan
          ? h(
              'div',
              { style: { marginTop: '14px' } },
              h(PlanRows, {
                rows: [
                  ['需求', state.plan.requirementId],
                  ['项目', state.plan.project],
                  ['sdoc', state.plan.file],
                  ['brief', state.plan.briefFile],
                  ['附件', `${state.plan.attachmentCount ?? 0} 个`],
                ],
              }),
              h('div', { style: { marginTop: '10px', fontSize: '12px', color: T.text3 } }, '文件内容预览：'),
              h(
                'pre',
                { style: { margin: '6px 0 0', padding: '12px', maxHeight: '180px', overflow: 'auto', background: T.layer, border: `1px solid ${T.line}`, borderRadius: '10px', fontSize: '11.5px', lineHeight: 1.7, whiteSpace: 'pre-wrap' } },
                state.plan.content,
              ),
            )
          : null,
        result
          ? h(
              'div',
              { style: { marginTop: '14px' } },
              h(PlanRows, {
                rows: [
                  ['状态', '已创建'],
                  ['需求', result.requirementId],
                  ['sdoc', result.file],
                  ['brief', result.briefFile],
                  ['附件', `${result.attachments?.length ?? 0} 个`],
                  ['门禁', `${result.check.result} · ${result.check.gaps} 个覆盖缺口`],
                ],
              }),
              h('p', { style: { margin: '10px 0 0', ...muted } }, '需求状态为 proposed；补验收后 COV-001 才会通过。原始材料已归档到 requirements/attachments/。'),
            )
          : null,
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
      const [reviewItem, setReviewItem] = useState(null)
      const [aiReviewItem, setAiReviewItem] = useState(null)
      const [signoffItem, setSignoffItem] = useState(null)
      const [rehearsalItem, setRehearsalItem] = useState(null)
      const [createOpen, setCreateOpen] = useState(false)
      const [associateTarget, setAssociateTarget] = useState(null)
      const [showRoot, setShowRoot] = useState(false)
      const [anomalyOnly, setAnomalyOnly] = useState(false)
      const [anomalyOpen, setAnomalyOpen] = useState(false)
      const [checkOpen, setCheckOpen] = useState(false)
      const [menuOpen, setMenuOpen] = useState(false)
      const [narrow, setNarrow] = useState(typeof window !== 'undefined' ? window.innerWidth < 1120 : false)
      const [mobile, setMobile] = useState(typeof window !== 'undefined' ? window.innerWidth < 760 : false)
      const [toolbarNode, setToolbarNode] = useState(null)
      const [toolbarHeight, setToolbarHeight] = useState(48)
      const { loading, error, data, reload } = useRequirements({ root, projectId })

      useEffect(() => {
        if (!toolbarNode) return undefined
        const measure = () => setToolbarHeight(toolbarNode.offsetHeight)
        measure()
        if (typeof ResizeObserver === 'undefined') return undefined
        const observer = new ResizeObserver(measure)
        observer.observe(toolbarNode)
        return () => observer.disconnect()
      }, [toolbarNode])

      useEffect(() => {
        if (typeof window === 'undefined') return undefined
        const onResize = () => {
          setNarrow(window.innerWidth < 1120)
          setMobile(window.innerWidth < 760)
        }
        window.addEventListener('resize', onResize)
        return () => window.removeEventListener('resize', onResize)
      }, [])

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
        setFilter('all')
        setKeyword('')
        setAnomalyOnly(false)
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
      const scopedItems = items
      // Selection is by occurrenceKey, not by UID: duplicate UIDs are kept as
      // two records and must be selectable independently.
      const keyOf = (item) => item?.occurrenceKey ?? item?.id
      const counts = {}
      for (const item of scopedItems) counts[item.status] = (counts[item.status] ?? 0) + 1
      const searched = scopedItems
        .filter((item) => filter === 'all' || item.status === filter)
        .filter((item) => {
          if (!keyword) return true
          const needle = keyword.toLowerCase()
          return (
            item.title.toLowerCase().includes(needle) ||
            item.id.toLowerCase().includes(needle) ||
            (item.businessId ?? '').toLowerCase().includes(needle) ||
            (item.owner ?? '').toLowerCase().includes(needle)
          )
        })
      const visible = anomalyOnly ? searched.filter((item) => (item.anomalies?.length ?? 0) > 0) : searched
      const itemCount = scopedItems.length
      const filtered = filter !== 'all' || keyword !== '' || anomalyOnly
      const clearFilters = () => {
        setFilter('all')
        setKeyword('')
        setAnomalyOnly(false)
      }

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
      const singleWorkspace = projectId !== ALL_PROJECTS
      const linked = Boolean(currentProject?.linked)
      const scopeText =
        projectId === ALL_PROJECTS
          ? data
            ? `${data.summary.projects} 个工作区`
            : '全部工作区'
          : linked
            ? '已关联仓库'
            : '未关联仓库'
      const countLabel = loading ? '读取中' : data ? `${itemCount} 条` : '—'

      const createRequirement = () => {
        if (!singleWorkspace) return
        if (currentProject && !currentProject.linked) {
          setAssociateTarget(currentProject)
          return
        }
        setCreateOpen(true)
      }

      const menuItem = (label, icon, onClick, extra) =>
        h(
          'button',
          {
            type: 'button',
            role: 'menuitem',
            onClick: () => {
              setMenuOpen(false)
              onClick()
            },
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              width: '100%',
              border: 0,
              background: 'transparent',
              color: T.text,
              padding: '8px 10px',
              borderRadius: '7px',
              fontSize: '12px',
              textAlign: 'left',
              cursor: 'pointer',
              ...extra,
            },
            onMouseEnter: (event) => {
              event.currentTarget.style.background = T.layer2
            },
            onMouseLeave: (event) => {
              event.currentTarget.style.background = 'transparent'
            },
          },
          h(ActionIcon, { name: icon, size: 14 }),
          label,
        )

      const header = h(
        'div',
        { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '20px', flexWrap: 'wrap', paddingTop: '26px' } },
        h(
          'div',
          { style: { minWidth: 0 } },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'baseline', gap: '10px' } },
            h('h1', { style: { margin: 0, fontSize: '26px', lineHeight: 1.2, fontWeight: 600, letterSpacing: '-.02em' } }, '需求'),
            h('span', { style: { color: T.text3, fontSize: '13px', fontVariantNumeric: 'tabular-nums' } }, countLabel),
          ),
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '9px', flexWrap: 'wrap' } },
            h(ProjectPicker, { projects, currentId: projectId, onPick: applyProject }),
            h('span', { style: { color: T.text3, fontSize: '11.5px' } }, scopeText),
          ),
        ),
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
          h(ActionButton, {
            label: '新建需求',
            icon: 'plus',
            variant: 'primary',
            disabled: !singleWorkspace,
            onClick: createRequirement,
            title: singleWorkspace ? '新建需求' : '切换到单个工作区后可新建需求',
          }),
        ),
      )

      const toolbar = h(
        'div',
        {
          ref: setToolbarNode,
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            margin: '0 0 12px',
            padding: '12px 0 8px',
            borderBottom: `1px solid ${T.line}`,
            flexWrap: 'wrap',
            position: 'sticky',
            top: 0,
            zIndex: 20,
            background: T.base,
          },
        },
        h(
          'div',
          { role: 'tablist', 'aria-label': '按业务状态筛选', style: { display: 'flex', alignItems: 'stretch', gap: '2px', flexWrap: 'wrap' } },
          FILTERS.map(([id, label]) => {
            const active = filter === id
            return h(
              'button',
              {
                key: id,
                type: 'button',
                role: 'tab',
                'aria-selected': active,
                onClick: () => setFilter(id),
                style: {
                  border: 0,
                  borderBottom: `2px solid ${active ? T.text : 'transparent'}`,
                  background: 'transparent',
                  color: active ? T.text : T.text2,
                  padding: '7px 9px 8px',
                  fontSize: '12.5px',
                  fontWeight: active ? 500 : 400,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                },
              },
              label,
              h('span', { style: { marginLeft: '6px', color: active ? T.text2 : T.text3, fontSize: '11px', fontVariantNumeric: 'tabular-nums' } }, id === 'all' ? itemCount : counts[id] ?? 0),
            )
          }),
        ),
        h('div', { style: { flex: 1, minWidth: '12px' } }),
        filtered
          ? h('span', { style: { color: T.text3, fontSize: '11.5px', fontVariantNumeric: 'tabular-nums' } }, `${visible.length} 条结果`)
          : null,
        h(
          'label',
          { style: { display: 'flex', alignItems: 'center', gap: '7px', height: '36px', width: '250px', maxWidth: '100%', border: `1px solid ${T.line}`, borderRadius: '8px', background: T.base, padding: '0 10px' } },
          h(ActionIcon, { name: 'search', size: 14 }),
          h('input', {
            value: keyword,
            onChange: (event) => setKeyword(event.target.value),
            placeholder: '搜索标题、需求 ID 或负责人',
            'aria-label': '搜索标题、需求 ID 或负责人',
            style: { border: 0, outline: 0, background: 'transparent', color: T.text, fontSize: '12px', width: '100%' },
          }),
          keyword
            ? h(
                'button',
                {
                  type: 'button',
                  onClick: () => setKeyword(''),
                  'aria-label': '清除搜索',
                  style: { border: 0, background: 'transparent', color: T.text3, cursor: 'pointer', padding: 0, display: 'inline-flex' },
                },
                h(ActionIcon, { name: 'close', size: 12 }),
              )
            : null,
        ),
        h(ActionButton, { label: loading ? '刷新中…' : '刷新', icon: 'refresh', variant: 'ghost', disabled: loading, onClick: reload, title: '重新读取需求资产' }),
        h(
          'div',
          { style: { position: 'relative' } },
          h(ActionButton, { label: '更多', icon: 'more', variant: 'ghost', onClick: () => setMenuOpen((value) => !value), title: '更多工具' }),
          menuOpen
            ? h(
                'div',
                {
                  role: 'menu',
                  style: {
                    position: 'absolute',
                    right: 0,
                    top: 'calc(100% + 6px)',
                    zIndex: 40,
                    minWidth: '190px',
                    background: T.layer,
                    border: `1px solid ${T.line2}`,
                    borderRadius: '10px',
                    padding: '5px',
                    boxShadow: '0 12px 32px rgba(0,0,0,.35)',
                  },
                },
                singleWorkspace && currentProject
                  ? menuItem(linked ? '更新工作区关联' : '关联 GitHub 仓库', 'link', () => setAssociateTarget(currentProject))
                  : null,
                menuItem('指定根目录', 'folder', () => setShowRoot(true)),
                openPanel ? menuItem('在工作台打开', 'eye', openPanel) : null,
              )
            : null,
        ),
      )

      let body
      if (loading) {
        body = h(SkeletonTable, { narrow, mobile })
      } else if (error) {
        body = h(
          'div',
          { style: { border: `1px solid ${T.line}`, borderRadius: '12px', background: T.layer, padding: '28px' } },
          h('p', { style: { margin: '0 0 6px', color: T.text, fontSize: '14px', fontWeight: 600 } }, '读取需求失败'),
          h('p', { style: { margin: '0 0 16px', color: T.err, fontSize: '12.5px', lineHeight: 1.7 } }, error),
          h(ActionButton, { label: '重试', icon: 'refresh', variant: 'secondary', onClick: reload }),
        )
      } else if (itemCount === 0) {
        body = h(EmptyState, { root: data?.root ?? root, onOpenPanel: openPanel })
      } else {
        body = h(RequirementTable, {
          items: visible,
          narrow,
          mobile,
          showProject: data?.scope === 'all',
          stickyTop: toolbarHeight,
          selectedKey: selectedId,
          onOpen: (entry) => setSelectedId(keyOf(entry)),
          emptyNode: h(NoResults, { filter, keyword, anomalyOnly, onClear: clearFilters }),
        })
      }

      const notices = h(
        'div',
        null,
        h(AnomalyNotice, {
          anomalies: data?.anomalies,
          summary: data?.anomalySummary,
          expanded: anomalyOpen,
          anomalyOnly,
          onToggleExpanded: () => setAnomalyOpen((value) => !value),
          onToggleOnly: () => setAnomalyOnly((value) => !value),
          onOpen: openOccurrence,
        }),
        h(CheckNotice, {
          data,
          expanded: checkOpen,
          onToggleExpanded: () => setCheckOpen((value) => !value),
        }),
      )

      return h(
        'div',
        { style: panel },
        header,
        showRoot ? h(RootPicker, { rootInput, setRootInput, onApply: () => applyRoot(rootInput), onReset: () => { setRootInput(''); applyRoot('') } }) : null,
        toolbar,
        notices,
        body,
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
              onReview: (entry) => setReviewItem(entry),
              onSignoff: (entry) => setSignoffItem(entry),
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
              onReview: (entry) => setReviewItem(entry),
              onSignoff: (entry) => setSignoffItem(entry),
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
        reviewItem
          ? h(ReviewModal, {
              item: reviewItem,
              root: reviewItem.root ?? data?.root ?? root,
              onClose: () => setReviewItem(null),
              onDone: () => reload(),
            })
          : null,
        signoffItem
          ? h(SignoffModal, {
              item: signoffItem,
              root: signoffItem.root ?? data?.root ?? root,
              onClose: () => setSignoffItem(null),
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
          ? h(CreateModal, {
              root: data?.root ?? root,
              project: data?.project ?? currentProject?.projectId,
              projectName: data?.projectName ?? currentProject?.name,
              onClose: () => setCreateOpen(false),
              onCreated: () => {
                reload()
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
