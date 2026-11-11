window.__ModuleLoader__.load({
  id: '@ai-alm/dsh-plugin-requirements',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback, useRef } = React

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
      text3: 'var(--dsw-alias-label-secondary, #929ba7)',
      line: 'var(--dsw-alias-border-l1, #232830)',
      line2: 'var(--dsw-alias-border-l2, #2e343d)',
      layer: 'var(--dsw-alias-bg-layer-1, #14171c)',
      layer2: 'var(--dsw-alias-bg-layer-2, #171b21)',
      base: 'var(--dsw-alias-bg-base, #0f1115)',
      brand: 'var(--dsw-alias-brand-primary, #4d6bfe)',
      ok: 'color-mix(in srgb, var(--dsw-alias-label-secondary, #9aa3ae) 90%, var(--dsw-alias-state-success-primary, #35c47a))',
      warn: 'color-mix(in srgb, var(--dsw-alias-label-secondary, #9aa3ae) 90%, var(--dsw-alias-state-warn-primary, #e7b04b))',
      err: 'color-mix(in srgb, var(--dsw-alias-label-secondary, #9aa3ae) 80%, var(--dsw-alias-state-error-primary, #ff8b8b))',
    }

    const STATUS = {
      proposed: { label: '待评审', color: T.text2, bg: 'rgba(154,163,174,.14)' },
      accepted: { label: '已采纳', color: T.brand, bg: 'rgba(77,107,254,.12)' },
      'in-progress': { label: '开发中', color: T.warn, bg: 'rgba(231,176,75,.14)' },
      implemented: { label: '已实现', color: T.brand, bg: 'rgba(77,107,254,.10)' },
      verified: { label: '已验证', color: T.ok, bg: 'rgba(53,196,122,.14)' },
      deprecated: { label: '已废弃', color: T.text3, bg: 'rgba(107,116,128,.12)' },
      superseded: { label: '被替代', color: T.text3, bg: 'rgba(107,116,128,.12)' },
      archived: { label: '已归档', color: T.text3, bg: 'rgba(107,116,128,.12)' },
    }

    // Work views, not lifecycle states: they may overlap ("待验收" is also part
    // of "待我处理"), and their counts never need to add up to the total.
    const DEFAULT_REQUIREMENT_VIEW = 'all'
    const FILTERS = [
      ['all', '全部'],
      ['mine', '待我处理'],
      ['pending', '待推进'],
      ['running', 'AI 推进中'],
      ['awaiting', '待验收'],
      ['accepted', '已验收'],
      ['closed', '已关闭'],
      ['anomalies', '数据异常'],
    ]

    // Source is a second, orthogonal axis: a defect requirement still belongs to
    // every work view above. `manual` is the complement of the machine-recorded
    // sources (`defect`, `feedback`): an AI-routed requirement was not typed in
    // by a human, so it never shows up under "手动创建".
    const SOURCE_FILTERS = [
      ['all', '全部'],
      ['manual', '手动创建'],
      ['chat', '对话生成'],
      ['defect', '缺陷'],
      ['feedback', '反馈'],
    ]

    // Mirrors alm-core DEFECT_LABELS. The live label is always taken from the
    // record when the backend sends one (defectView.statusLabel); this is the
    // fallback for a bare ledger entry.
    const DEFECT_LABELS = {
      'awaiting-confirmation': '待确认',
      confirmed: '已确认',
      fixing: '修复中',
      verifying: '验证中',
      'awaiting-acceptance': '待验收',
      closed: '已关闭',
      deferred: '已暂缓',
      ignored: '已忽略',
      failed: '迭代失败',
    }

    const DEFECT_STAGE_LABELS = { clarify: '澄清', review: '评审', develop: '开发', test: '测试', handoff: '交接' }
    const DEFECT_SEVERITY_TONE = { P0: T.err, P1: T.warn, P2: T.text2, P3: T.text3 }
    const DEFECT_SEEN_KEY = 'alm.requirements.defectSeen'

    function isDefect(item) {
      return (item?.sources ?? []).includes('defect')
    }

    /** `item.defect` is either a raw defect or a `defectView` wrapper. */
    function defectOf(item) {
      const view = item?.defect
      if (!view || view.exists === false) return null
      return view.defect && typeof view.defect === 'object' ? view.defect : view
    }

    /** Accepts a list item, a defectView or a raw defect (inbox rows). */
    function defectRecord(value) {
      const defect = defectOf(value)
      if (defect) return defect
      return String(value?.id ?? '').startsWith('DEF-') ? value : null
    }

    function defectStatusLabel(item, defect) {
      const label = item?.defect?.statusLabel ?? defect?.statusLabel
      if (label) return label
      const status = defect?.status ?? item?.defect?.status ?? null
      return status ? DEFECT_LABELS[status] ?? status : '待确认'
    }

    function defectTone(item, defect) {
      const status = defect?.status ?? item?.defect?.status ?? null
      if (status === 'awaiting-confirmation' || status === 'deferred') return { color: T.warn, bg: 'rgba(231,176,75,.14)' }
      if (status === 'failed') return { color: T.err, bg: 'rgba(255,139,139,.14)' }
      if (status === 'closed' || status === 'ignored') return { color: T.text3, bg: 'rgba(107,116,128,.12)' }
      return { color: T.brand, bg: 'rgba(77,107,254,.12)' }
    }

    /** Which gate failed; never invent a stage the record did not carry. */
    function defectStageText(item) {
      const defect = defectRecord(item)
      const stage = defect?.impact?.stage ?? null
      if (stage) return DEFECT_STAGE_LABELS[stage] ?? String(stage)
      const kind = defect?.source?.kind ?? null
      if (kind === 'failure-monitor') return '失败监控'
      return '来源：失败监控'
    }

    /** Only these two states still wait for a human (everything else 409s). */
    function defectAwaitingConfirmation(item) {
      const status = defectRecord(item)?.status ?? null
      return status === 'awaiting-confirmation' || status === 'deferred'
    }

    function isFeedbackSource(item) {
      return Array.isArray(item?.sources) && item.sources.includes('feedback')
    }

    // `manual` means "a human typed this in", so it excludes every
    // machine-recorded source. Feedback stays visible under 全部 by design.
    function isChatSource(item) { return Boolean(item?.sourceSession) || (item?.sources ?? []).includes('chat') }
    function matchesSource(item, source) {
      if (source === 'defect') return isDefect(item)
      if (source === 'feedback') return isFeedbackSource(item)
      if (source === 'chat') return isChatSource(item) && !isDefect(item)
      if (source === 'manual') return !isDefect(item) && !isFeedbackSource(item) && !isChatSource(item)
      return true
    }

    // ---- Feedback: the manual feedback loop's UI vocabulary ----------------
    // Facts about lifecycle and routing live on the server. This file only
    // names them; it never invents a phase, a percentage or an ETA.
    const FEEDBACK_CATEGORIES = [
      ['undetermined', '待判断'],
      ['defect', '缺陷'],
      ['experience', '体验'],
      ['capability', '新能力'],
    ]

    const FEEDBACK_STATUS = {
      saved: { label: '待路由', tone: 'warn' },
      'needs-routing': { label: '待路由', tone: 'warn' },
      routed: { label: '已路由', tone: 'brand' },
      'requirement-created': { label: '已转需求', tone: 'ok' },
      failed: { label: '失败', tone: 'err' },
      ignored: { label: '已忽略', tone: 'neutral' },
    }

    const FEEDBACK_TONES = {
      warn: { color: T.warn, bg: 'rgba(231,176,75,.14)' },
      brand: { color: T.brand, bg: 'rgba(77,107,254,.12)' },
      ok: { color: T.ok, bg: 'rgba(53,196,122,.14)' },
      err: { color: T.err, bg: 'rgba(255,139,139,.14)' },
      neutral: { color: T.text3, bg: 'rgba(107,116,128,.12)' },
    }

    const FEEDBACK_PRIORITIES = ['P0', 'P1', 'P2']
    const FEEDBACK_ATTACHMENT_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'text/plain', 'text/markdown', 'application/json']
    const FEEDBACK_ATTACHMENT_MAX_BYTES = 2 * 1024 * 1024
    const FEEDBACK_MAX_STATEMENT = 4000
    // Must match packages/dsh-plugin-requirements/build-info.mjs: the server
    // returns the same token from GET ?action=diagnostics, so a stale page
    // cannot masquerade as a backend regression. Guarded by
    // test/feedback-build.test.mjs.
    const FEEDBACK_CLIENT_BUILD = 'feedback-v2/2026-11-03.1'
    const FEEDBACK_KEEP_LABELS = [
      ['requirement', '当前需求'],
      ['run', '最近运行'],
      ['intent', '意图会话'],
      ['error', '最近错误'],
    ]
    const FEEDBACK_COVERAGE_STAGES = [
      ['intent', '意图'],
      ['review', '评审'],
      ['run', '运行'],
      ['test', '测试'],
      ['acceptance', '验收'],
      ['list', '列表'],
      ['detail', '详情'],
    ]
    const FEEDBACK_PAGE_LABELS = { list: '需求列表', detail: '需求详情' }

    // Drafts are keyed by the captured object, not by the panel: closing the
    // drawer is navigation, not rejection, but opening feedback on another
    // requirement must never paste the previous scene's text into it.
    // Session memory only — a draft may quote an internal failure, so it never
    // goes to localStorage.
    const FEEDBACK_DRAFTS = new Map()
    const emptyFeedbackDraft = () => ({
      statement: '',
      category: 'undetermined',
      keep: { requirement: true, run: true, intent: true, error: true },
      requestId: null,
      supplementRequestId: null,
      savedId: null,
      savedStatement: null,
      attachments: [],
    })
    function feedbackDraftKey(context) {
      const workspace = String(context?.workspaceId ?? context?.projectId ?? 'local')
      if (context?.requirementId) {
        return `${workspace}|requirement:${context.requirementId}|revision:${context.requirementRevision ?? 1}`
      }
      return `${workspace}|page:${context?.page ?? 'list'}|stage:${context?.stage ?? 'none'}`
    }
    function feedbackDraftFor(context) {
      const key = feedbackDraftKey(context)
      if (!FEEDBACK_DRAFTS.has(key)) FEEDBACK_DRAFTS.set(key, emptyFeedbackDraft())
      return FEEDBACK_DRAFTS.get(key)
    }

    // An intent session is not a field of a requirement, so remember the last
    // one the composer opened. Missing here means we honestly show 未记录.

    // Feedback must stay reachable while a modal or the detail drawer covers
    // the toolbar. The workbench registers its opener once; overlays call it
    // with a small label so the frozen context can say which layer the user
    // was looking at when they wrote the report.
    let FEEDBACK_LAUNCHER = null

    // A launch failure must never be silent: if the launcher is not mounted yet
    // (or throws), say so in a place that is visible even from inside a modal.
    function showFeedbackLaunchFailure(message) {
      if (typeof document === 'undefined') return
      const node = document.createElement('div')
      node.setAttribute('data-feedback-toast', 'warn')
      node.setAttribute('role', 'status')
      node.textContent = message
      Object.assign(node.style, {
        position: 'fixed',
        left: '50%',
        bottom: '28px',
        transform: 'translateX(-50%)',
        zIndex: '2147483000',
        maxWidth: 'min(520px, 92vw)',
        padding: '10px 16px',
        borderRadius: '10px',
        border: `1px solid ${T.warn}`,
        background: T.base,
        color: T.text,
        fontSize: '13px',
        lineHeight: '1.6',
        boxShadow: '0 12px 32px rgba(0,0,0,.45)',
      })
      document.body.appendChild(node)
      setTimeout(() => {
        node.remove()
      }, 4200)
    }

    function launchFeedbackFromLayer(overlay) {
      if (typeof FEEDBACK_LAUNCHER !== 'function') {
        showFeedbackLaunchFailure('反馈面板还没有就绪，本次点击没有打开；请刷新页面后重试。')
        return false
      }
      try {
        FEEDBACK_LAUNCHER(overlay)
        return true
      } catch (error) {
        console.error('[requirements] feedback launcher failed', error)
        showFeedbackLaunchFailure('反馈面板打开失败；请重试，若持续失败请刷新页面。')
        return false
      }
    }

    function feedbackLayerOpen() {
      return typeof document !== 'undefined' && Boolean(document.querySelector('[data-feedback-layer="true"]'))
    }

    const FEEDBACK_ERROR_HINTS = {
      'statement-required': '请先写下哪里不顺或希望怎样改变。',
      'statement-too-long': `反馈最多 ${FEEDBACK_MAX_STATEMENT} 字，请精简后再保存。`,
      'priority-required': '请先选择优先级 P0/P1/P2（不猜优先级）。',
      'destination-not-configured': '尚未转为需求：未配置接收工作区',
      'destination-not-writable': '尚未转为需求：接收工作区不可写',
      'idempotency-conflict': '这条反馈已经保存过，但内容或现场与上次不同；请刷新收件箱后重新提交，或把新信息作为补充提交。',
      'feedback-link-failed': '需求已创建，但关联回反馈失败；重试会复用同一条需求，不会重复创建。',
      'proposal-unconfirmed': '候选还没确认；确认候选后才能转成需求。',
    }

    function feedbackErrorView(error) {
      const hint = error && typeof error.code === 'string' ? FEEDBACK_ERROR_HINTS[error.code] : null
      return hint ? { code: error.code, message: hint } : error
    }

    function feedbackStatusKey(status) {
      return String(status ?? '')
        .replace(/([a-z])([A-Z])/g, '$1-$2')
        .toLowerCase()
    }

    function feedbackStatusMeta(status) {
      const key = feedbackStatusKey(status)
      return FEEDBACK_STATUS[key] ?? { label: key || '未知', tone: 'neutral' }
    }

    function feedbackStatusBadge(status) {
      const meta = feedbackStatusMeta(status)
      const tone = FEEDBACK_TONES[meta.tone] ?? FEEDBACK_TONES.neutral
      return h(
        'span',
        {
          'data-feedback-status': status ?? '',
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            padding: '1px 8px',
            borderRadius: 999,
            fontSize: 11,
            color: tone.color,
            background: tone.bg,
            whiteSpace: 'nowrap',
          },
        },
        meta.label,
      )
    }

    function feedbackCategoryLabel(category) {
      const hit = FEEDBACK_CATEGORIES.find(([id]) => id === category)
      return hit ? hit[1] : '待判断'
    }

    function feedbackRequirementId(requirement) {
      if (!requirement) return null
      if (typeof requirement === 'string') return requirement
      return requirement.id ?? requirement.requirementId ?? null
    }

    /** Pending = still in the inbox; created = already a requirement. */
    function feedbackCountsOf(payload) {
      const counts = payload?.counts ?? payload?.inbox?.counts ?? null
      if (counts) {
        return {
          pending: (counts.saved ?? 0) + (counts.needsRouting ?? counts['needs-routing'] ?? 0),
          requirementCreated: counts.requirementCreated ?? counts['requirement-created'] ?? 0,
        }
      }
      const items = Array.isArray(payload?.items) ? payload.items : []
      let pending = 0
      let created = 0
      for (const item of items) {
        const key = feedbackStatusKey(item.status)
        if (key === 'saved' || key === 'needs-routing') pending += 1
        if (key === 'requirement-created') created += 1
      }
      return { pending, requirementCreated: created }
    }

    function feedbackChipStyle(on, disabled = false) {
      return {
        border: `1px solid ${on ? 'rgba(77,107,254,.5)' : T.line}`,
        background: on ? 'rgba(77,107,254,.12)' : 'transparent',
        color: disabled ? T.text3 : on ? T.text : T.text2,
        borderRadius: 999,
        padding: '4px 11px',
        fontSize: 11.5,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
      }
    }

    function feedbackWorkspaceValue(workspace) {
      return workspace?.workspaceId ?? workspace?.id ?? null
    }

    function feedbackWorkspaceLabel(workspace) {
      const name = workspace?.name ?? workspace?.title ?? workspace?.id ?? '未命名工作区'
      const linked = workspace?.linked === true ? '已关联项目' : '未关联项目'
      return workspace?.writable === false ? `${name} · ${linked} · 不可写` : `${name} · ${linked}`
    }

    /** Absolute paths never travel into a feedback card. */
    function feedbackMaskPaths(value) {
      if (!value) return null
      return String(value).replace(/[A-Za-z]:[\\/][^\s，。;；、)）\]]*/g, '[路径已隐藏]')
    }

    function feedbackGet(action, root, extra = '') {
      const query = `root=${encodeURIComponent(root)}&action=${encodeURIComponent(action)}${extra ? `&${extra}` : ''}`
      return fetch(`/api/alm/requirements/feedback?${query}`, {
        headers: { accept: 'application/json' },
        cache: 'no-store',
      }).then(async (response) => {
        let payload = null
        try {
          payload = await response.json()
        } catch {
          payload = null
        }
        if (!response.ok || (payload && payload.ok === false)) {
          const info = payload?.error ?? {}
          const error = new Error(info.message ?? `加载反馈数据失败（HTTP ${response.status}）`)
          error.code = info.code ?? `http-${response.status}`
          error.status = response.status
          error.payload = payload
          throw error
        }
        return payload ?? {}
      })
    }

    function feedbackPost(action, body, root) {
      return postJson('requirements/feedback', { ...body, action }, root)
    }

    // The toast fires once per failure fingerprint: the monitor may re-observe
    // the same failure many times and a human decision is only owed once.
    function readSeenDefectFingerprints() {
      if (typeof localStorage === 'undefined') return new Set()
      try {
        const raw = JSON.parse(localStorage.getItem(DEFECT_SEEN_KEY) ?? '[]')
        return new Set(Array.isArray(raw) ? raw.filter((value) => typeof value === 'string' && value) : [])
      } catch {
        return new Set()
      }
    }

    function rememberDefectFingerprints(fingerprints) {
      if (typeof localStorage === 'undefined') return
      try {
        const seen = readSeenDefectFingerprints()
        for (const value of fingerprints) if (typeof value === 'string' && value) seen.add(value)
        localStorage.setItem(DEFECT_SEEN_KEY, JSON.stringify([...seen].slice(-200)))
      } catch {}
    }

    // The defect route is newer than this bundle: unwrap the shapes it may
    // return and treat anything unrecognisable as "no data", never as success.
    function defectListOf(payload) {
      const value = payload?.defects ?? payload?.items ?? payload?.list ?? payload?.result?.defects ?? null
      return Array.isArray(value) ? value : []
    }

    function defectSummaryOf(payload) {
      const value = payload?.summary ?? payload?.defectSummary ?? payload?.result?.summary ?? payload
      if (!value || typeof value !== 'object') return null
      if (value.awaitingConfirmation === undefined && value.total === undefined) return null
      return value
    }

    function defectOfResponse(payload) {
      return payload?.defect ?? payload?.result?.defect ?? null
    }

    function defectExecutionOf(payload) {
      return payload?.execution ?? payload?.result?.execution ?? null
    }

    const DELIVERY_TONE = {
      pending: { color: T.text2, bg: 'rgba(154,163,174,.14)' },
      'in-progress': { color: T.warn, bg: 'rgba(231,176,75,.14)' },
      'awaiting-acceptance': { color: T.brand, bg: 'rgba(77,107,254,.12)' },
      accepted: { color: T.ok, bg: 'rgba(53,196,122,.14)' },
      closed: { color: T.text3, bg: 'rgba(107,116,128,.12)' },
    }

    /** Delivery state is derived by the backend; the UI never guesses it. */
    function deliveryOf(item) {
      const delivery = item?.delivery
      if (delivery?.key) return delivery
      if (item?.closed === true) return { key: 'closed', label: '已关闭' }
      return { key: 'pending', label: '待推进' }
    }

    function deliveryTone(item) {
      return DELIVERY_TONE[deliveryOf(item).key] ?? DELIVERY_TONE.pending
    }

    /** Human work: decide acceptance, unblock, or answer a clarification. */
    function needsHuman(item) {
      if (deliveryOf(item).key !== 'closed' && (item?.pendingPatch || item?.detailView?.question || item?.currentMatter?.kind === 'decision' || item?.detailView?.currentMatter?.kind === 'decision' || item?.run?.awaitingAnswer)) return true
      if (typeof item?.requiresHuman === 'boolean') return item.requiresHuman
      if (typeof item?.detailView?.currentMatter?.requiresHuman === 'boolean') return item.detailView.currentMatter.requiresHuman
      const delivery = deliveryOf(item)
      const state = item?.decision?.state
      if (delivery.key === 'closed') return false
      // A defect waiting for confirmation, verification or a retry is a human
      // action even while its delivery is still in progress.
      const defectStatus = item?.defect?.defect?.requirement === item?.id ? item?.defect?.status : null
      if (defectStatus === 'awaiting-confirmation' || defectStatus === 'verifying' || defectStatus === 'failed') return true
      if (delivery.key === 'awaiting-acceptance') return true
      return state === 'blocked' || state === 'needs-clarification'
    }

    function isExecutingRequirement(item) {
      const run = item?.detailView?.summaries?.run ?? item?.run
      return run?.exists === true && run.active === true && run.stale !== true &&
        run.idleHandback !== true && run.awaitingAnswer !== true &&
        (run.status === 'running' || run.status === 'queued')
    }

    function matchesView(item, view) {
      if (view === 'anomalies') return (item.anomalies?.length ?? 0) > 0
      if (view === 'pending') return deliveryOf(item).key === 'pending'
      if (view === 'all') return true
      if (view === 'mine') return needsHuman(item)
      if (view === 'running') return deliveryOf(item).key === 'in-progress'
      if (view === 'awaiting') return deliveryOf(item).key === 'awaiting-acceptance'
      if (view === 'accepted') return deliveryOf(item).key === 'accepted'
      if (view === 'closed') return deliveryOf(item).key === 'closed'
      return true
    }

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
      'ready-for-human': '待验收',
      verified: '已验收',
      archived: '已归档',
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

    // Raw engine errors stay in the data, but the list page must explain them
    // in the UI language the user reads.
    function readableError(message) {
      const text = String(message ?? '').trim()
      if (!text) return '未知错误，请重试。'
      const notFound = text.match(/root not found:\s*(.+)$/i)
      if (notFound) return '找不到工作区目录：' + notFound[1] + '（可在「更多 → 指定根目录」重新选择）'
      if (/not a git repository/i.test(text)) return '该目录不是 git 仓库，无法读取需求版本。'
      if (/EACCES|EPERM/i.test(text)) return '没有权限读取该目录。'
      if (/ENOENT/i.test(text)) return '目录或文件不存在：' + text
      return text
    }

    function shortHash(value, size = 12) {
      return value ? String(value).slice(0, size) : '—'
    }

    function formatLocalStamp(iso) {
      if (!iso) return '—'
      const date = new Date(iso)
      if (Number.isNaN(date.getTime())) return String(iso)
      const pad = (value) => String(value).padStart(2, '0')
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    }

    // The workbench owns the viewport: chrome stays put and only the list
    // scrolls, so the header row never leaves the screen and the page itself
    // never grows a second scrollbar.
    const panel = {
      padding: '0 30px',
      width: '100%',
      margin: 0,
      color: T.text,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
      boxSizing: 'border-box',
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }
    const listArea = { flex: '1 1 auto', minHeight: '200px', display: 'flex', flexDirection: 'column', paddingBottom: '30px' }
    const listScroller = {
      flex: '1 1 auto',
      minHeight: 0,
      overflowY: 'auto',
      overflowX: 'hidden',
      border: `1px solid ${T.line}`,
      borderRadius: '12px',
      background: T.layer,
      overscrollBehavior: 'contain',
      scrollbarGutter: 'stable',
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
    const primaryState = (disabled) => disabled ? { ...button, color: T.text2, cursor: 'not-allowed' } : primary
    const input = {
      border: `1px solid ${T.line}`,
      background: T.layer,
      color: T.text,
      borderRadius: '8px',
      padding: '5px 9px',
      fontSize: '12px',
      minWidth: '220px',
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

    /** Delivery state (待推进/推进中/待验收/已验收/已关闭), never a raw STATUS. */
    function DeliveryPill({ item }) {
      const delivery = deliveryOf(item)
      const tone = deliveryTone(item)
      // A rolled-back state keeps its reason on the pill: "待推进" alone would
      // hide why the previous run stopped (heartbeat lost, waiting, failed).
      const title = delivery.reason ? `待推进：${delivery.reason}` : delivery.label ?? delivery.key
      return h(
        'span',
        {
          'data-delivery': delivery.key,
          'data-delivery-source': delivery.source ?? null,
          title,
          'aria-label': title,
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '12px',
            padding: '2px 0',
            borderRadius: '4px',
            color: tone.color,
            background: 'transparent',
            whiteSpace: 'nowrap',
          },
        },
        h('span', { style: { width: '5px', height: '5px', borderRadius: '50%', background: 'currentColor' } }),
        delivery.label ?? delivery.key,
      )
    }

    /** A record whose source is the failure monitor, not a human. */
    function DefectPill() {
      return h(
        'span',
        {
          'data-defect-pill': 'true',
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            flex: 'none',
            lineHeight: '16px',
            fontSize: '11px',
            padding: '1px 7px',
            borderRadius: '999px',
            color: T.warn,
            background: 'rgba(231,176,75,.14)',
            border: '1px solid rgba(231,176,75,.28)',
            whiteSpace: 'nowrap',
          },
        },
        h(ActionIcon, { name: 'alert', size: 10 }),
        '缺陷',
      )
    }

    /** Defect lifecycle (待确认/修复中/待验收/…), never the requirement STATUS. */
    function DefectStatusPill({ item, defect, prefix = null }) {
      const record = defect ?? defectRecord(item)
      const tone = defectTone(item, record)
      return h(
        'span',
        {
          'data-defect-status': record?.status ?? 'unknown',
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '11.5px',
            padding: '2px 9px',
            borderRadius: '999px',
            color: tone.color,
            background: tone.bg,
            whiteSpace: 'nowrap',
          },
        },
        h('span', { style: { width: '5px', height: '5px', borderRadius: '50%', background: 'currentColor' } }),
        prefix ? `${prefix} · ${defectStatusLabel(item, record)}` : defectStatusLabel(item, record),
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
    // --- Decision bar: state, risk, coverage and exactly one next action. -----
    function riskText(decision) {
      const risk = decision?.policy?.risk
      if (risk === 'high') return '风险高'
      if (risk === 'low') return '风险低'
      if (risk === 'normal') return '风险中'
      return null
    }

    function acceptanceLine(item) {
      const acceptance = item?.acceptance
      if (!acceptance?.registered) return { text: '待补充验收方式', color: T.warn }
      const latest = acceptance.latest
      if (!latest) return { text: '待开始验证', color: T.warn }
      if (latest.result !== 'pass') return { text: `验收失败 · ${shortHash(latest.headSha, 8)}`, color: T.err }
      if (latest.current !== true || latest.complete === false) return { text: '历史通过 · 需重跑', color: T.warn }
      return { text: '验收通过 · 当前版本', color: T.ok }
    }

    function coverageText(_decision, item) {
      return item ? acceptanceLine(item).text : ''
    }

    function primaryActionFor(item, decision, actions = {}) {
      const delivery = deliveryOf(item)
      if (delivery.key === 'closed') return null
      // The primary action follows the delivery context, never the legacy
      // STATUS: awaiting acceptance must offer acceptance, not "start".
      if (delivery.key === 'awaiting-acceptance') {
        return { label: '验收交付', icon: 'check', variant: 'primary', onClick: () => actions.onSignoff?.(item) }
      }
      if (delivery.key === 'accepted') return null
      if (delivery.key === 'in-progress') {
        return { label: '推进中', icon: 'refresh', variant: 'ghost', onClick: () => actions.onRefresh?.() }
      }
      // A run that lost its heartbeat rolled the delivery back to 待推进; the
      // real action is resuming from the checkpoint, not a cold restart.
      if (delivery.key === 'pending' && item?.run?.exists && item.run.stale === true && actions.onResumeRun) {
        return { label: '恢复推进', icon: 'play', variant: 'primary', onClick: () => actions.onResumeRun(item, item.run) }
      }
      if (delivery.key === 'pending' && item?.run?.exists && item.run.awaitingAnswer === true && actions.onAnswer) {
        return { label: '回答并继续', icon: 'message', variant: 'accent', onClick: () => actions.onAnswer(item, item.run) }
      }
      if (delivery.key === 'pending' && item?.run?.exists && item.run.idleHandback === true && actions.onStart) {
        return { label: '继续推进', icon: 'play', variant: 'primary', onClick: () => actions.onStart(item) }
      }
      if (!decision) return null
      const code = decision.topGap?.code ?? ''
      if (decision.state === 'blocked' || decision.state === 'needs-clarification') {
        return { label: '查看并处理问题', icon: 'alert', variant: 'accent', onClick: () => actions.onOpen?.(item) }
      }
      if (code === 'review-not-run' || code === 'review-not-accepted' || code === 'coverage-incomplete') {
        return { label: '继续推进', icon: 'play', variant: 'primary', onClick: () => actions.onStart?.(item) }
      }
      if (
        code === 'acceptance-missing' ||
        code === 'acceptance-not-run' ||
        decision.state === 'failed' ||
        decision.state === 'stale'
      ) {
        return { label: '运行验收', icon: 'flask', variant: 'accent', onClick: () => actions.onAcceptance?.(item) }
      }
      return { label: '交给 AI 推进', icon: 'play', variant: 'primary', onClick: () => actions.onStart?.(item) }
    }

    function DecisionBar({ decision, item, actions }) {
      if (!decision) return null
      const gap = decision.topGap
      const tone = decisionTone(decision)
      const risk = riskText(decision)
      const coverage = coverageText(decision, item)
      const action = primaryActionFor(item, decision, actions)
      const extra = Math.max(0, (decision.gaps?.length ?? 0) - (gap ? 1 : 0))
      return h(
        'section',
        {
          'data-decision-state': decision.state,
          'aria-label': `证据结论：${decision.label}`,
          style: {
            background: T.layer2,
            border: `1px solid ${T.line2}`,
            borderLeft: `3px solid ${tone.color}`,
            borderRadius: '10px',
            padding: '11px 14px',
            marginBottom: '12px',
          },
        },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
          h(DecisionPill, { decision }),
          risk ? h('span', { style: { fontSize: '11.5px', color: T.text3 } }, risk) : null,
          coverage ? h('span', { style: { fontSize: '11.5px', color: T.text3 } }, coverage) : null,
          action
            ? h('div', { style: { marginLeft: 'auto' } }, h(ActionButton, { label: action.label, icon: action.icon, variant: action.variant, onClick: action.onClick }))
            : null,
        ),
        gap
          ? h(
              'p',
              { style: { margin: '8px 0 0', fontSize: '12.5px', lineHeight: 1.7, color: T.text2 } },
              h('span', { style: { color: tone.color, fontWeight: 600 } }, gap.severity === 'block' ? '阻塞 ' : '缺口 '),
              h(
                'code',
                { style: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '11.5px', color: T.text2, marginRight: '2px' } },
                gap.code,
              ),
              ' · ',
              gap.message,
              gap.fix ? h('span', { style: { color: T.text3 } }, `　修复：${gap.fix}`) : null,
              extra ? h('span', { style: { color: T.text3 } }, `　另有 ${extra} 项见下方`) : null,
            )
          : h('p', { style: { margin: '8px 0 0', fontSize: '12.5px', color: T.ok } }, '必需证据已满足，可以进入下一步。'),
      )
    }

    /**
     * First screen answers four questions: what is being built, what the AI is
     * doing, what is wrong, and what the human must decide now.
     */
    function CurrentStateStrip({ item, actions }) {
      const delivery = deliveryOf(item)
      const decision = item?.decision ?? null
      const candidate = item?.candidate ?? null
      const next = item?.nextActionLabel ?? null
      const human = needsHuman(item)
      const run = item?.run ?? null
      // The run record is the only honest source for "is the AI really
      // working": a stopped heartbeat reads as interrupted, never as running,
      // and a waiting turn reads as waiting for a human answer.
      const lastActivity = run?.lastActivityAt ? formatLocalStamp(run.lastActivityAt) : null
      const runBusy = run?.active === true
      // Older host core has no awaitingAnswer/idleHandback: fall back to the
      // decision request path it does expose, so the panel stays honest.
      const runWaiting = run?.awaitingAnswer === true || (run?.awaitingAnswer === undefined && run?.status === 'waiting-input' && Boolean(run?.decision))
      const runIdleHandback = run?.idleHandback === true || (run?.awaitingAnswer === undefined && run?.status === 'waiting-input' && !run?.decision)
      const runStale = run?.stale === true
      const runLabel = run?.exists
        ? runStale
          ? `已中断${lastActivity ? `（最后活动 ${lastActivity}）` : ''}`
          : runWaiting
            ? `等待回答${lastActivity ? `（${lastActivity}）` : ''}`
            : `${run.label}${run.phase ? ` · ${run.phase}` : ''}${lastActivity ? `（${lastActivity}）` : ''}${run.failure?.message ? ` · ${run.failure.message}` : ''}`
        : null
      const decideNow = runStale
        ? '本轮推进已中断：恢复推进或取消'
        : human
          ? next ?? '验收'
          : runWaiting
            ? '回答决策请求'
            : runIdleHandback
              ? '查看本轮结果并决定下一步'
              : runBusy
                ? '无（AI 推进中）'
                : delivery.key === 'accepted'
                  ? '发布决定'
                  : '无'
      const rows = [
        ['交付状态', delivery.label],
        ['AI 当前动作', runLabel ? `${runLabel}（${decision?.label ?? '未检查'}）` : decision?.label ?? '未检查'],
        [
          '交付候选',
          candidate?.exists
            ? candidate.current
              ? `当前 · ${shortHash(candidate.treeHash, 8)}`
              : `已过期 · ${(candidate.reasons ?? []).join('、') || '需重新生成'}`
            : '尚未生成',
        ],
        ['待你决定', decideNow],
      ]
      // When a previous run stopped, the rollback reason belongs next to the
      // state, not buried in the run file.
      if (delivery.reason) rows.push(['中断原因', delivery.reason])
      const runActions =
        run?.exists && (runBusy || runWaiting || runStale)
          ? h(
              'div',
              { key: 'run-actions', style: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '2px' } },
              runStale && actions?.onResumeRun
                ? h(
                    'button',
                    {
                      key: 'resume-run',
                      title: '上一轮推进已中断（心跳停止）：从中断处继续，不会重做已完成工作',
                      style: { ...button, fontSize: '11.5px', padding: '2px 8px', borderColor: 'transparent', background: T.ok, color: T.base },
                      onClick: () => actions.onResumeRun(item, run),
                    },
                    '恢复推进',
                  )
                : null,
              runWaiting && actions?.onAnswer
                ? h(
                    'button',
                    {
                      key: 'answer-run',
                      title: 'AI 正在等你回答决策请求：回答后会顺着原会话继续推进',
                      style: { ...button, fontSize: '11.5px', padding: '2px 8px', borderColor: 'transparent', background: T.warn, color: T.base },
                      onClick: () => actions.onAnswer(item, run),
                    },
                    '回答并继续',
                  )
                : null,
              (runBusy || runWaiting) && actions?.onCancelRun
                ? h('button', { key: 'cancel-run', style: { ...button, marginTop: '0px', fontSize: '11.5px', padding: '2px 8px' }, onClick: () => actions.onCancelRun(item, run) }, '取消推进')
                : null,
            )
          : null
      return h(
        'section',
        {
          'aria-label': '当前状态与待你决定',
          'data-delivery': delivery.key,
          style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px', border: `1px solid ${T.line}`, borderRadius: '10px', background: T.layer, padding: '10px 12px', marginBottom: '12px' },
        },
        rows.map(([label, value], index) =>
          h(
            'div',
            { key: label, style: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' } },
            h('span', { style: { fontSize: '10.5px', color: T.text3, letterSpacing: '.02em' } }, label),
            h('span', { style: { fontSize: '12.5px', color: index === 3 && human ? T.warn : runStale && index === 1 ? T.err : T.text, fontWeight: index === 3 && human ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis' } }, value),
            index === 1 ? runActions : null,
          ),
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
        ['时间', latest.finishedAt ? formatLocalStamp(latest.finishedAt) : '—'],
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

    /**
     * Answer the executor's decision request. The answer is appended to the run
     * record and steers the same session (or a fresh one after a host restart).
     */
    const EMPTY_ANSWER_HINT = '请为每个业务问题选择一项，无需填写补充说明。'

    function DecisionFormShell({ inline, title, lead, footer, children, ...props }) {
      if (!inline) return h(ModalShell, { title, lead, footer, ...props }, children)
      return h('section', { 'data-inline-decision': 'true', 'aria-label': '需要你决定', style: { minWidth: 0 } },
        h('p', { style: { color: T.text2, fontSize: '13px', margin: '0 0 12px' } }, '需要你决定'),
        lead ? h('p', { style: { color: T.text2, fontSize: '13px', lineHeight: 1.7, margin: '0 0 16px' } }, lead) : null,
        children,
        h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '16px' } }, footer?.filter((entry) => entry?.key !== 'close')),
      )
    }

    // Foundation-only human rejection entry. Independent of business tabs/counts/focus.
    function RejectCandidateControl({ item, root, onDone }) {
      const review = item.rejectionReview
      const [open, setOpen] = useState(false)
      const [openedReview, setOpenedReview] = useState(null)
      const [text, setText] = useState('')
      const [saving, setSaving] = useState(false)
      const [error, setError] = useState(null)
      if ((!review?.allowed || !review.binding) && !open) return null
      const binding = openedReview?.binding ?? review.binding
      const submit = async () => {
        if (!text.trim() || saving) return
        setSaving(true); setError(null)
        try {
          const result = await writeJson('run', { mode: 'reject-candidate', requirementId: item.id, answer: text.trim(), expectedReview: binding }, root)
          if (result?.resumed !== true) throw new Error(result?.message ?? '未退回修改，请重新读取当前状态')
          setOpen(false); setText(''); await onDone?.()
        } catch (failure) { setError(failure.message) }
        finally { setSaving(false) }
      }
      return h('section', { 'data-reject-candidate': 'true', style: { padding: '12px 20px' } },
        h('button', { type: 'button', style: button, disabled: !review?.allowed, onClick: () => { setOpenedReview(review); setOpen(true); setError(null) } }, '退回修改'),
        open ? h(ModalShell, { title: '退回修改', lead: `原运行 ${binding.runId} · 候选 ${binding.candidateId}`, onClose: () => { if (!saving) setOpen(false) },
          footer: [h('button', { key: 'close', type: 'button', disabled: saving, onClick: () => setOpen(false) }, '取消'),
            h('button', { key: 'submit', type: 'button', disabled: saving || !text.trim(), onClick: submit }, saving ? '正在提交…' : '退回修改并继续原运行')] },
          !review?.allowed ? h('p', { role: 'alert' }, '当前审阅状态已变化；反馈草稿保留，提交将由宿主重新校验。请关闭并重新读取后操作。') : null,
          h('p', null, openedReview?.stale ? '你正在退回此前候选；工作区已变化，修复后必须重新验证。旧候选与检查记录保留。' : '反馈将交回原运行；不扩大原授权或执行预算，不代表签收。'),
          h('label', null, '实际失败与修改反馈', h('textarea', { 'aria-label': '实际失败与修改反馈', value: text, disabled: saving, onChange: event => setText(event.target.value), rows: 6 })),
          error ? h('p', { role: 'alert' }, `${error}。反馈草稿已保留；审阅对象变化时请关闭并重新读取。`) : null,
        ) : null)
    }

    function AnswerRunModal(props) { return h(DecisionForm, props) }

    function DecisionForm({ item, root, onClose, onDone, inline = false, onDirty, primaryActionId = null }) {
      const run = item.run ?? null
      const [answer, setAnswer] = useState('')
      const [selections, setSelections] = useState({})
      const submitting = useRef(false)
      const [state, setState] = useState({ loading: true, decision: null, text: null, presentation: null, error: null, saving: false, result: null })
      const presentation = state.presentation
      const decisions = presentation?.decisions ?? []
      const selectable = presentation?.selectable === true
      const technicalOnly = presentation?.technicalOnly === true
      const pickedCount = decisions.filter(decision => decision.options.some(option => option.key === selections[decision.id])).length
      const choicesReady = selectable && pickedCount === decisions.length
      const identityReady = Boolean(state.decisionIdentity?.path && state.decisionIdentity?.contentHash)
      const canSubmit = !state.loading && !state.result && identityReady && (technicalOnly || choicesReady || !selectable)
      const [reloadDecision, setReloadDecision] = useState(0)
      useEffect(() => { onDirty?.(!state.result && (answer.trim() !== '' || Object.keys(selections).length > 0)) }, [answer, selections, state.result])
      useEffect(() => {
        let alive = true
        setState((previous) => ({ ...previous, loading: true, error: null }))
        writeJson('run', { mode: 'decision', requirementId: item.id }, root)
          .then((result) => {
            if (!alive) return
            setSelections({})
            setState({ loading: false, decision: result.decision ?? null, decisionIdentity: result.decisionIdentity ?? null, text: result.text ?? null, presentation: result.presentation ?? null, error: null, saving: false, result: null })
          })
          .catch((error) => {
            if (!alive) return
            setState({ loading: false, decision: null, text: null, error: error.message, saving: false, result: null })
          })
        return () => {
          alive = false
        }
      }, [item.id, root, item.run?.id, reloadDecision, item.run?.decisionIdentity?.contentHash, item.detailView?.question?.identity?.contentHash])
      useEffect(() => { setAnswer(''); setSelections({}) }, [item.id, root, item.run?.id])
      useEffect(() => { setAnswer(''); setSelections({}) }, [state.decisionIdentity?.contentHash])
      const submit = (action = 'choose') => {
        if (state.loading || state.saving || state.result || submitting.current) return
        if (action === 'choose' && !choicesReady) {
          setState((prev) => ({ ...prev, error: EMPTY_ANSWER_HINT }))
          const field = document.querySelector('[data-decision-choice="true"]:not(:checked)')
          if (field && typeof field.focus === 'function') field.focus()
          return
        }
        if (!identityReady) {
          setState(prev => ({ ...prev, error: '当前问题不可读或已变化，请重新读取后选择。' }))
          return
        }
        submitting.current = true
        setState((prev) => ({ ...prev, saving: true, error: null }))
        writeJson('run', { mode: 'answer', requirementId: item.id, decisionResponse: { action, selections: action === 'choose' ? selections : {}, note: answer.trim() }, expectedDecision: state.decisionIdentity }, root)
          .then((result) => {
            if (result?.resumed === false) throw new Error(result.message ?? '运行尚未恢复，请刷新后检查当前状态')
            if (result?.autoAdvanceResumed === false) window.alert(`已继续本轮，但自动推进未恢复（${result.autoAdvanceReason}）。需在原生界面检查版本与执行预算；未新增授权。`)
            setState((prev) => ({ ...prev, saving: false, result, submittedAction: action }))
            onDone?.()
          })
          .catch((error) => setState((prev) => ({ ...prev, saving: false, error: error.message })))
          .finally(() => { submitting.current = false })
      }
      return h(
        DecisionFormShell,
        {
          inline,
          title: `业务与功能决策 · ${item.id}`,
          lead: '你决定业务规则与功能行为，AI 负责技术实现。选择方案即可继续，推荐项不会自动选中。',
          onClose,
          feedbackContext: feedbackContextFor(item),
          width: '780px',
          footer: [
            h('button', { key: 'close', style: state.result ? primary : button, onClick: onClose }, '关闭'),
            state.result
              ? null
              : h(
                  'button',
                  {
                    key: 'answer',
                    style: canSubmit && !state.saving ? primary : { ...primary, opacity: 0.45, cursor: 'not-allowed' },
                    disabled: state.saving || state.loading || !identityReady,
                    title: canSubmit ? '继续同一运行' : '请完成每一道业务问题的选择',
                    'aria-describedby': !canSubmit ? 'answer-run-hint' : undefined,
                    onClick: () => submit(technicalOnly ? 'delegate' : selectable ? 'choose' : 'reframe'),
                    'data-primary-action': primaryActionId || undefined,
                  },
                  state.saving ? '提交中…' : technicalOnly ? '交回 AI 自主处理' : selectable ? '确认选择并继续' : '请 AI 整理业务选项',
                ),
          ],
        },
        selectable ? h('p', { style: { color: T.text2, fontSize: '12px', margin: '0 0 12px' }, role: 'status' }, `已选择 ${pickedCount} / ${decisions.length} 项`) : null,
        presentation?.context?.length ? h('ul', null, ...presentation.context.map((line, index) => h('li', { key: index }, line))) : null,
        selectable ? decisions.map((decision) => h('fieldset', {
          key: decision.id, style: { border: 0, borderBottom: `1px solid ${T.line}`, margin: '0 0 20px', padding: '0 0 20px', minWidth: 0 },
        },
        h('legend', { style: { fontSize: '17px', fontWeight: 650, lineHeight: 1.6, marginBottom: '8px', overflowWrap: 'anywhere' } }, decision.title || decision.question),
        decision.question && decision.question !== decision.title ? h('p', { style: { color: T.text2, fontSize: '13px', lineHeight: 1.7 } }, decision.question) : null,
        decision.why ? h('p', null, decision.why) : null,
        ...decision.options.map((option) => h('label', { key: option.key, 'data-decision-option': option.key, style: { display: 'flex', alignItems: 'flex-start', gap: '12px', margin: '8px 0', padding: '14px', border: `1px solid ${selections[decision.id] === option.key ? T.brand : T.line}`, borderRadius: '8px', background: selections[decision.id] === option.key ? T.layer2 : T.layer, cursor: 'pointer', overflowWrap: 'anywhere' } },
          h('input', {
            type: 'radio', name: `decision-${decision.id}`, value: option.key,
            checked: selections[decision.id] === option.key, disabled: state.saving || Boolean(state.result),
            'data-decision-choice': 'true', style: { accentColor: T.brand, margin: '4px 0 0', flexShrink: 0 },
            onChange: () => { setSelections((prev) => ({ ...prev, [decision.id]: option.key })); setState((prev) => ({ ...prev, error: null })) },
          }),
          h('span', { style: { minWidth: 0 } },
            h('strong', { style: { fontSize: '14px', lineHeight: 1.7 } }, option.label),
            option.recommended ? h('span', { style: { color: T.brand, fontSize: '11px', marginLeft: '8px' } }, 'AI 推荐') : null,
            h('span', { style: { display: 'block', marginTop: '4px', color: T.text2, fontSize: '12px', lineHeight: 1.7 } }, `影响：${option.impact}`)),
        )),
        decision.recommendation?.reason ? h('p', { style: { color: T.text2, fontSize: '12px', lineHeight: 1.7 } }, `推荐理由：${decision.recommendation.reason}`) : null,
        )) : h('p', { role: 'status', style: { lineHeight: 1.8 } }, state.loading ? '正在读取待决事项…' : technicalOnly ? '这份请求涉及技术实现，无需你挑选技术方案。交回后，AI 将在现有需求范围内处理并验证。' : presentation?.authorizationDecisions?.length ? '这份请求包含需专项授权的事项。请 AI 分开整理业务选择与授权请求；本页不会扩大权限或批准发布。' : '当前问题还没有清晰的业务选项。请让 AI 先整理，你无需编写技术指令。'),
        presentation?.technicalDecisions?.length && !technicalOnly ? h('p', { 'data-ai-owned-decisions': 'true', style: { color: T.text2, fontSize: '12px', lineHeight: 1.8 } }, '技术实现交由 AI 处理，无需你选择具体方案。') : null,
        selectable && !state.result ? h('button', { type: 'button', style: { ...button, marginBottom: '12px' }, disabled: state.saving || !identityReady, onClick: () => submit('reframe') }, '这些选项不合适，请 AI 重新整理') : null,
        !state.loading && !state.result ? h('details', { 'data-decision-note': 'true', style: { marginTop: '12px' } }, h('summary', { style: { color: T.text2, cursor: 'pointer', fontSize: '12px' } }, '补充业务说明（选填）'), h(
          'label',
          { style: { display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', color: T.text2, marginTop: '12px' } },
          '补充你希望保留的业务规则或功能约束',
          h('textarea', {
            style: { ...input, width: '100%', minHeight: '110px', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.7 },
            value: answer,
            name: 'decision-answer',
            autoComplete: 'off',
            'aria-label': '补充你希望保留的业务规则或功能约束',
            onChange: (event) => {
              const next = event.target.value
              setAnswer(next)
              setState((prev) => (prev.error === EMPTY_ANSWER_HINT ? { ...prev, error: null } : prev))
            },
            'data-answer-run-input': 'true',
            maxLength: 4000,
            placeholder: '例如：保留现有导航，默认只显示待处理需求。',
            disabled: state.saving || Boolean(state.result),
          }),
        )) : null,
        !canSubmit && !state.result
          ? h('p', { id: 'answer-run-hint', style: { margin: '6px 0 0', fontSize: '11.5px', color: T.text3 } }, !identityReady && !state.loading ? '请重新读取当前问题，未读取成功不会继续执行。' : '每个问题选择一项后即可提交，无需填写补充说明。')
          : null,
        state.error ? h('div', { role: 'alert', tabIndex: -1, ref: state.error === EMPTY_ANSWER_HINT ? null : (node) => node?.focus?.({ preventScroll: true }), style: { margin: '10px 0 0', color: T.err, fontSize: '13px' } }, state.error, h('button', { type: 'button', style: button, onClick: () => { setState((prev) => ({ ...prev, loading: true })); setReloadDecision((value) => value + 1) } }, '重新读取问题')) : null,
        state.result
          ? h(
              'div',
              { style: { marginTop: '12px' } },
              h('p', { role: 'status' }, state.submittedAction === 'reframe' ? '已请 AI 整理业务选项，尚未作出业务决定。' : state.submittedAction === 'delegate' ? '技术事项已交回 AI，在现有授权范围内继续处理。' : '你的决定已提交，AI 将按你的选择继续推进。'),
              state.result.message ? h('p', { style: { margin: '4px 0 0', fontSize: '12.5px', color: T.text2 } }, state.result.message) : null,
              h('details', null,
                h('summary', null, '提交详情（可选查看）'),
                h(PlanRows, {
                  rows: [
                    ['结果', state.result.message ?? '已继续推进'],
                    ['运行', state.result.runId ?? '—'],
                    ['继续方式', state.result.continueMode === 'resumed-session' ? '新会话（原会话已结束）' : '原会话'],
                  ],
                }),
              ),
            )
          : null,
        h('details', { 'data-decision-technical': 'true', style: { marginTop: '20px', borderTop: `1px solid ${T.line}`, paddingTop: '12px', color: T.text2, fontSize: '12px' } },
          h('summary', { style: { cursor: 'pointer' } }, '运行与技术记录（按需查看）'),
          run ? h(PlanRows, { rows: [['运行', run.id], ['状态', run.label ?? run.status], ['已回答', String(run.answers ?? 0)]] }) : null,
          state.decision ? h('p', null, state.decision) : null,
          h('pre', { style: { whiteSpace: 'pre-wrap', maxHeight: '320px', overflow: 'auto' } }, state.text || '暂无原始记录'),
        ),
      )
    }

    function acceptanceChecklistFor(item) {
      const explicit = item.detailView?.content?.doc?.acceptance
      const criteria = explicit?.length ? explicit : item.detailView?.verificationSummary?.criteria ?? []
      if (criteria.length) return criteria.map((entry, index) => ({ id: entry.id ?? 'AC-' + (index + 1), text: entry.text || entry.title || entry.id }))
      return (item.verifiedBy ?? []).map(id => ({ id, text: item.trace?.nodes?.find(node => node.id === id)?.title ?? id }))
    }

    function SignoffModal({ item, root, onClose, onDone }) {
      const criteria = acceptanceChecklistFor(item)
      const [checks, setChecks] = useState({})
      const [confirmed, setConfirmed] = useState(false)
      const [state, setState] = useState({ loading: false, result: null, error: null })
      const submitting = useRef(false)
      const candidate = item.candidate
      const identity = (candidate?.id ?? '') + ':' + (candidate?.treeHash ?? '')
      useEffect(() => { setChecks({}); setConfirmed(false) }, [identity])
      const complete = confirmed && criteria.length > 0 && criteria.every(entry => checks[entry.id])
      const allowed = item.decision?.signoff?.allowed === true && candidate?.current === true
      const submit = async () => {
        if (submitting.current || !complete || !allowed) return
        submitting.current = true
        setState({ loading: true, result: null, error: null })
        try {
          const result = await writeJson('signoff', { requirementId: item.id, expectedCandidate: { id: candidate.id, treeHash: candidate.treeHash }, apply: true }, root)
          setState({ loading: false, result, error: null }); onDone?.()
        } catch (error) { setState({ loading: false, result: null, error: error.message }) }
        finally { submitting.current = false }
      }
      return h(ModalShell, {
        title: '验收交付 · ' + item.id,
        lead: '先在实际交付版本中操作验证，再逐项确认。自动检查通过只是参考；本次确认会记录为你的人工验收。',
        onClose, feedbackContext: feedbackContextFor(item), width: '720px',
        footer: [
          h('button', { key: 'close', style: HUMAN_CONTROL, onClick: onClose }, state.result ? '返回需求' : '稍后验收'),
          !state.result ? h('button', { key: 'sign', style: complete && allowed ? HUMAN_PRIMARY : { ...HUMAN_CONTROL, opacity: 0.55 }, disabled: state.loading || !complete || !allowed, onClick: submit }, state.loading ? '正在记录…' : '确认验收通过') : null,
        ],
      },
        h('section', { 'data-human-acceptance-guide': 'true', style: { lineHeight: 1.8, fontSize: '14px', padding: '16px 0' } },
          h('h3', { style: { margin: '0 0 8px', fontSize: '18px' } }, state.result ? '人工验收已记录，可以发布归档' : '在交付版本中逐项验证'),
          h('p', { style: { margin: '0 0 12px', color: T.text2 } }, '打开本需求涉及的功能页面，按照下面每项要求实际操作，比较结果。发现问题时暂不确认，返回需求选择“退回 AI 修复”。'),
          criteria.map(entry => h('label', { key: entry.id, style: { display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '12px 0', borderBottom: '1px solid ' + T.line, cursor: 'pointer' } },
            h('input', { type: 'checkbox', name: `acceptance-${entry.id}`, 'aria-label': `验收要求：${entry.text}`, checked: checks[entry.id] === true, disabled: state.loading || Boolean(state.result), onChange: event => setChecks(current => ({ ...current, [entry.id]: event.target.checked })), style: { marginTop: '6px', flexShrink: 0 } }),
            h('span', null, h('span', { style: { color: T.text3, fontSize: '12px', marginRight: '8px' } }, entry.id), entry.text))),
          !criteria.length ? h('p', { role: 'alert', style: { color: T.warn } }, '缺少明确的业务验收清单，请先补充验收要求。') : null,
          h('label', { style: { display: 'flex', gap: '10px', padding: '16px 0', cursor: 'pointer' } }, h('input', { type: 'checkbox', name: 'acceptance-confirmed', 'aria-label': '确认我已在当前交付版本实际验证以上要求', checked: confirmed, disabled: state.loading || Boolean(state.result), onChange: event => setConfirmed(event.target.checked) }), '我已在当前交付版本实际验证以上要求，同意本次交付。'),
          !allowed && !state.result ? h('p', { role: 'status', style: { color: T.warn } }, item.decision?.topGap?.message ?? '当前交付证据不再满足验收条件，请重新核验。') : null,
          state.error ? h('p', { role: 'alert', style: { color: T.err } }, state.error) : null,
          h('details', { style: { marginTop: '12px', color: T.text3, fontSize: '12px' } }, h('summary', { style: { cursor: 'pointer' } }, '查看交付版本与检查依据'),
            h('p', null, '候选：' + (candidate?.id ?? '未生成') + ' · 提交：' + (candidate?.headSha?.slice(0, 12) ?? '未知')),
            h('p', null, '签署身份由当前登录会话确认；这里不会替换或手填他人的身份。')),
        ),
      )
    }

    function ReleaseModal({ item, root, onClose, onDone }) {
      const [state, setState] = useState({ loading: false, release: null, error: null, done: false })
      const busy = useRef(false)
      const publish = useCallback(async () => {
        if (busy.current) return
        busy.current = true
        setState(current => ({ ...current, loading: true, error: null }))
        try {
          const result = await writeJson('release', { mode: 'archive', requirementId: item.id, apply: true }, root)
          setState({ loading: false, release: result.release ?? null, error: null, done: result.release?.status === 'released' })
          onDone?.()
        } catch (error) { setState(current => ({ ...current, loading: false, error: error.message })) }
        finally { busy.current = false }
      }, [item.id, root])
      return h(ModalShell, {
        title: '发布归档 · ' + item.id,
        lead: '本操作会复核当前候选与人工签收仍然有效，并生成不可篡改的发布归档快照后关闭需求。',
        onClose, feedbackContext: feedbackContextFor(item), width: '720px',
        footer: [
          h('button', { key: 'close', style: HUMAN_CONTROL, disabled: state.loading, onClick: onClose }, state.done ? '返回需求' : '稍后处理'),
          !state.done ? h('button', { key: 'publish', style: HUMAN_PRIMARY, disabled: state.loading, 'data-release-primary': 'archive', onClick: publish }, state.loading ? '正在生成归档…' : '🚀 发布交付 (Release)') : null,
        ],
      },
        h('section', { 'aria-live': 'polite', 'data-release-flow': 'true', style: { padding: '18px 0', lineHeight: 1.8 } },
          h('div', { style: { fontSize: '20px', fontWeight: 650, color: T.text } }, state.done ? '发布归档完成，需求已关闭' : '确认发布归档'),
          state.release?.archive?.path ? h('p', { style: { ...muted, margin: '6px 0' } }, `归档记录：${state.release.archive.path}`) : null,
          !state.done ? h('p', { style: { color: T.text2, fontSize: '13px', margin: '14px 0 0' } }, '归档会再次校验交付候选、人工签收和工作区快照。任一受保护内容在签收后发生变化都会被拒绝。') : null,
          state.error ? h('p', { role: 'alert', style: { color: T.err, fontSize: '13px' } }, state.error) : null,
        ),
      )
    }

    function VersionList({ item, onSnapshot, onDiff, compact }) {
      const [storedHistory, setHistory] = useState(null)
      const history = storedHistory?.root === item.root && storedHistory?.id === item.id ? storedHistory : { versions: null, head: null, next: 0, loading: false, error: false }
      const loadHistory = useRef(null)
      useEffect(() => {
        const lifetime = new AbortController()
        let head = null, offset = 0, busy = false
        const seen = new Set()
        setHistory({ root: item.root, id: item.id, versions: null, head: null, next: 0, loading: false, error: false })
        loadHistory.current = async () => {
          if (busy || lifetime.signal.aborted || offset === null) return
          busy = true
          const controller = new AbortController()
          const cancel = () => controller.abort()
          lifetime.signal.addEventListener('abort', cancel, { once: true })
          let timeout
          setHistory(previous => ({ ...previous, loading: true, error: false }))
          try {
            const params = new URLSearchParams({ root: item.root ?? '', asset: item.id, mode: 'history', offset: String(offset) })
            if (head) params.set('head', head)
            const { response, data } = await Promise.race([
              fetch(`/api/alm/requirements/version?${params}`, { headers: { accept: 'application/json' }, signal: controller.signal }).then(async response => ({ response, data: await response.json() })),
              new Promise((_, reject) => { timeout = setTimeout(() => { cancel(); reject(new Error('version timeout')) }, 10000) }),
            ])
            if (!response.ok) throw new Error('unavailable')
            if (data.schema !== 'alm.version.history/v1' || data.asset !== item.id || !/^[0-9a-f]{40,64}$/.test(data.head ?? '') || (head && data.head !== head) || !Array.isArray(data.versions) || data.versions.length > 20 || data.versions.some(version => !version || !/^[0-9a-f]{40,64}$/.test(version.sha ?? '') || typeof version.subject !== 'string' || seen.has(version.sha)) || new Set(data.versions.map(version => version.sha)).size !== data.versions.length || (data.next !== null && (data.next !== offset + 20 || data.versions.length !== 20))) throw new Error('invalid')
            if (controller.signal.aborted) throw new Error('cancelled')
            for (const version of data.versions) seen.add(version.sha)
            head = data.head
            offset = data.next
            setHistory(previous => ({ root: item.root, id: item.id, versions: previous.versions === null ? data.versions : [...previous.versions, ...data.versions], head, next: offset, loading: false, error: false }))
          } catch { if (!lifetime.signal.aborted) setHistory(previous => ({ ...previous, loading: false, error: true })) }
          finally { clearTimeout(timeout); lifetime.signal.removeEventListener('abort', cancel); busy = false }
        }
        return () => { lifetime.abort(); loadHistory.current = null }
      }, [item.root, item.id])
      const versions = history.versions ?? item.versions ?? []
      return h(
        'div',
        null,
        h(
          'div',
          { style: { ...row, paddingTop: 0 } },
          h('span', { style: rowLabel }, '当前修订'),
          h('span', { style: { color: T.text } }, item.revision == null || item.revision === '' ? '未登记' : `v${item.revision}`),
        ),
        versions.length === 0
          ? h('p', { style: { margin: '6px 0 0', ...muted } }, '未读取到版本记录；可能尚未提交或历史暂不可用。')
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
        history.loading ? h('p', { role: 'status', style: muted }, '正在读取版本历史…') : null,
        history.error ? h('p', { role: 'alert', style: muted }, '版本历史暂不可用。 ', h('button', { type: 'button', style: DETAIL_LINK, onClick: () => loadHistory.current?.() }, '重试')) : null,
        history.next !== null && !history.error ? h('button', { type: 'button', style: DETAIL_LINK, disabled: history.loading, onClick: () => loadHistory.current?.() }, history.versions === null ? '读取版本历史' : '加载更多版本') : null,
        compact ? null : h('p', { style: { margin: '8px 0 0', ...muted } }, history.versions === null ? '这里只显示已读取的版本，较早记录可能未包含。快照和对比不会改动工作区。' : '版本按首次读取时的提交固定；快照和对比不会改动工作区。'),
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

    // data must already be masked to the current request scope by useRequirements.
    // An empty loaded array is real zero; missing data is never an empty result.
    function requirementViewCounts(data, keywordMatched) {
      const loaded = Array.isArray(data?.requirements)
      const counts = {}
      for (const [id] of FILTERS) {
        counts[id] = !loaded ? '—' : id === 'all' ? keywordMatched.length : keywordMatched.filter((item) => matchesView(item, id)).length
      }
      return counts
    }

    function useRequirements({ root, projectId }) {
      // An unset scope is not the host's default fixture. Only explicit roots
      // and the user's explicit ALL choice may load business data.
      const scope = projectId === ALL_PROJECTS ? '?project=ALL' : root ? `?root=${encodeURIComponent(root)}` : null
      const [state, setState] = useState({ scope, loading: Boolean(scope), error: null, data: null })
      const load = useCallback(function load({ silent = false } = {}) {
        // The memoized callback owns a request sequence. Cleanup invalidates it
        // on scope changes/unmount; overlapping refreshes are latest-wins too.
        const request = (load.request ?? 0) + 1
        load.request = request
        if (!scope) {
          setState({ scope, loading: false, error: null, data: null })
          return
        }
        // Refresh keeps rows only for this exact scope.
        if (!silent) setState((prev) => ({ scope, loading: true, error: null, data: prev.scope === scope ? prev.data : null }))
        return fetch(`/api/alm/requirements${scope}`, { headers: { accept: 'application/json' } })
          .then(async (response) => {
            const body = await response.json()
            if (!response.ok || body.ok === false) {
              throw new Error(body?.error?.message ?? body?.error ?? `HTTP ${response.status}`)
            }
            if (load.request === request) setState({ scope, loading: false, error: null, data: body })
          })
          .catch((error) => {
            if (load.request === request) setState((prev) => ({ scope, loading: false, error: error.message, data: prev.scope === scope ? prev.data : null }))
          })
      // A server-resolved project ID does not change this root-scoped request.
      // Avoid fetching the same expensive projection twice on first open.
      }, [scope])
      useEffect(() => {
        load()
        return () => { load.request = (load.request ?? 0) + 1 }
      }, [load])
      // Effects run after paint: mask old rows during the very first render of
      // a new scope, before cleanup or the new request has had time to run.
      const visible = state.scope === scope ? state : { loading: Boolean(scope), error: null, data: null }
      return { ...visible, reload: load }
    }

    function ProjectContextPrompt({ selectRef }) {
      return h(
        'div',
        { role: 'status', 'data-project-context-empty': 'true', style: { ...card, cursor: 'default', padding: '28px' } },
        h('p', { style: { margin: '0 0 8px', fontWeight: 600 } }, '请先选择工作区项目'),
        h('p', { style: muted }, '尚未加载需求，不代表没有需求'),
        h('button', { type: 'button', style: button, onClick: () => selectRef.current?.focus() }, '选择工作区项目'),
      )
    }

    function ProjectPicker({ projects = [], currentId, onPick, selectRef }) {
      return h(
        'label',
        { style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: T.text2 } },
        '工作区',
        h(
          'select',
          { ref: selectRef, style: input, value: currentId ?? '', onChange: (event) => onPick(event.target.value), 'aria-label': '选择工作区项目' },
          h('option', { value: '' }, '选择工作区…'),
          projects.length > 0 ? h('option', { value: ALL_PROJECTS }, '全部项目（聚合）') : null,
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
          name: 'repository-root',
          autoComplete: 'off',
          'aria-label': '仓库根目录',
          value: rootInput,
          placeholder: '输入仓库根目录，或选择工作区',
          onChange: (event) => setRootInput(event.target.value),
        }),
        h('button', { style: button, type: 'submit' }, '加载'),
        h('button', { style: button, type: 'button', onClick: onReset }, '清除选择'),
      )
    }

    /* ---------------------------------------------------------------------
     * Requirement list: one compact surface for scanning. Business status and
     * evidence/check state are separate columns; a row is never taller than it
     * needs to be. All data comes from the query payload.
     * ------------------------------------------------------------------- */

    const LIST_COLUMNS = 'minmax(0, 1fr) 108px 88px 76px 156px 124px'
    const LIST_COLUMNS_NARROW = 'minmax(0, 1fr) 104px 148px 124px'
    const LIST_COLUMNS_MOBILE = 'minmax(0, 1fr) 108px'

    function listColumns(narrow, mobile) {
      if (mobile) return LIST_COLUMNS_MOBILE
      return narrow ? LIST_COLUMNS_NARROW : LIST_COLUMNS
    }

    function listCell(extra) {
      return { minWidth: 0, display: 'flex', alignItems: 'center', ...extra }
    }

    /** Acceptance join is a plain count: the list does not fake a drill-down. */
    function acceptanceLabel(item) {
      const count = item.detailView?.content?.doc?.acceptance?.length ?? item.docView?.doc?.acceptance?.length ?? item.detailView?.content?.acceptanceCriteria?.length ?? 0
      if (count > 0) return `${count} 项标准`
      const section = String(item.briefText ?? '').match(/^#{1,6}\s*(?:验收标准|交付验证|验收要求)[^\n]*\n([\s\S]*?)(?=^#{1,6}\s|(?![\s\S]))/m)?.[1] ?? ''
      const entries = section.match(/^\s*(?:[-*+]\s+|\d+[.)、]\s*|AC[- ]?\d+[:：.、\s])/gmi) ?? []
      return entries.length ? `${entries.length} 项标准` : section.trim() ? '正文内含' : '待细化'
    }

    function duplicateCountFor(item, duplicateCounts) {
      const count = duplicateCounts?.[item.id]
      if (!Number.isFinite(count) || count < 2) return 2
      return count
    }

    /**
     * One short line under the record. Business state and data anomalies are
     * different dimensions, so an anomaly is stated as data, with record count.
     */
    function anomalyLine(item, duplicateCounts) {
      const list = item.anomalies ?? []
      if (list.length === 0) return null
      const kind = list[0].kind
      if (kind === 'duplicate-id') return `需求 ID 重复 · 涉及 ${duplicateCountFor(item, duplicateCounts)} 条记录`
      if (kind === 'duplicate-business-id') return `业务编号重复 · 涉及 ${duplicateCountFor(item, duplicateCounts)} 条记录`
      if (kind === 'dangling-relation') return '悬空关系 · 来源记录保留，待人工核对'
      const label = ANOMALY_LABELS[kind] ?? kind
      return list.length > 1 ? `${label}等 ${list.length} 项` : label
    }

    const CHECK_TONE_COLOR = {
      error: () => T.err,
      warn: () => T.warn,
      success: () => T.ok,
      neutral: () => T.text3,
    }

    function checkToneColor(tone) {
      return (CHECK_TONE_COLOR[tone] ?? CHECK_TONE_COLOR.neutral)()
    }

    /** Short check summary: the state word plus the one gap that matters. */
    function checkSummary(item) {
      const decision = item.decision
      if (!decision || decision.state === 'unchecked') return { label: '待验证', detail: null, tone: 'neutral' }
      const code = decision.topGap?.code ?? ''
      let detail = null
      if (decision.state === 'blocked') detail = decision.topGap?.message ?? '存在阻塞项'
      else if (decision.state === 'needs-clarification') detail = '数据异常待澄清'
      else if (decision.state === 'failed') detail = '验收执行失败'
      else if (decision.state === 'stale') detail = '证据与当前版本不一致'
      else if (decision.state === 'unchecked') {
        detail =
          code === 'review-not-run' || code === 'review-not-accepted' || code === 'coverage-incomplete'
            ? '可继续推进；AI 优化建议可选'
            : code === 'acceptance-missing'
              ? '待补充验收方式'
              : code === 'acceptance-not-run'
                ? '待开始验证'
                : decision.topGap?.message ?? null
      } else if (decision.state === 'verified') detail = null
      return { label: decision.label ?? '未检查', detail, tone: decision.tone ?? 'neutral' }
    }

    /** The one action that is real for this record; no placeholder actions. */
    function rowAction(item, { onOpen, onAiReview, onAcceptance, onSignoff, onDefect }) {
      const decision = item?.decision
      const delivery = deliveryOf(item)
      if (item.pendingPatch || item.detailView?.question || item.currentMatter?.kind === 'decision' || item.detailView?.currentMatter?.kind === 'decision' || item.run?.awaitingAnswer) return { label: '去确认', icon: 'alert', run: () => onOpen(item) }
      if (isExecutingRequirement(item)) return { label: '查看推进', icon: 'eye', run: () => onOpen(item) }
      // A defect waiting for confirmation outranks every delivery action: the
      // monitor filed it, but no iteration runs until a human confirms it.
      if (defectAwaitingConfirmation(item)) return { label: '处理缺陷', icon: 'alert', run: () => (onDefect ?? onOpen)(item) }
      if (delivery.key === 'closed') return { label: '查看', icon: 'eye', run: () => onOpen(item) }
      if (delivery.key === 'awaiting-acceptance') return { label: '验收交付', icon: 'check', run: () => (onSignoff ?? onOpen)(item) }
      if (delivery.key === 'accepted') return { label: '查看', icon: 'eye', run: () => onOpen(item) }
      if (delivery.key === 'in-progress') return { label: '查看推进', icon: 'eye', run: () => onOpen(item) }
      if (delivery.key === 'pending') return { label: '进入需求', icon: 'chevron', iconOnly: true, run: () => onOpen(item) }
      if (!decision) return { label: '打开', icon: 'eye', run: () => onOpen(item) }
      const code = decision.topGap?.code ?? ''
      if (decision.state === 'blocked' || decision.state === 'needs-clarification') {
        return { label: '处理', icon: 'alert', run: () => onOpen(item) }
      }
      if (decision.state === 'failed') return { label: '重跑验收', icon: 'flask', run: () => onAcceptance(item) }
      if (decision.state === 'stale') return { label: '重新验收', icon: 'flask', run: () => onAcceptance(item) }
      if (decision.state === 'unchecked') {
        if (code === 'acceptance-missing') return { label: '补充验证方式', icon: 'flask', run: () => onAcceptance(item) }
        if (code === 'acceptance-not-run') return { label: '开始验证', icon: 'flask', run: () => onAcceptance(item) }
        if (code === 'review-not-run' || code === 'review-not-accepted' || code === 'coverage-incomplete') {
          return { label: '打开', icon: 'eye', run: () => onOpen(item) }
        }
        return { label: '打开', icon: 'eye', run: () => onOpen(item) }
      }
      if (decision.state === 'verified') return { label: '查看', icon: 'eye', run: () => onOpen(item) }
      return { label: '打开', icon: 'eye', run: () => onOpen(item) }
    }

    function RequirementRow({ item, narrow, mobile, showProject, selected = false, duplicateCounts, actionHandlers }) {
      const key = item.occurrenceKey ?? item.id
      const decision = item.decision ?? null
      const anomaly = anomalyLine(item, duplicateCounts)
      const check = checkSummary(item)
      const defect = isDefect(item) ? defectRecord(item) : null
      const occurrences = Number(defect?.occurrenceCount ?? 0)
      const action = rowAction(item, actionHandlers)
      const executing = isExecutingRequirement(item)
      const [hover, setHover] = useState(false)
      const open = () => actionHandlers.onOpen(item)
      const actionButton = h(
        'button',
        {
          type: 'button',
          onClick: (event) => {
            event.stopPropagation()
            action.run()
          },
          title: action.label,
          'aria-label': `${action.label}：${item.title}`,
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            height: '28px',
            padding: '0 9px',
            border: `1px solid ${T.line2}`,
            borderRadius: '7px',
            background: action.label === '去确认' ? 'rgba(231,176,75,.12)' : 'transparent',
            color: action.label === '去确认' ? T.warn : action.icon === 'alert' ? T.err : T.text2,
            fontSize: '11.5px',
            whiteSpace: 'nowrap',
            cursor: 'pointer',
          },
        },
        h(ActionIcon, { name: action.icon, size: 13 }),
        action.iconOnly ? null : action.label,
      )
      const archiveButton =
        deliveryOf(item).key === 'closed'
          ? null
          : h(
              'button',
              {
                type: 'button',
                onClick: (event) => {
                  event.stopPropagation()
                  actionHandlers.onArchive(item)
                },
                disabled: executing,
                title: executing ? 'AI 正在执行，请等待完成或先取消运行' : '不推进，关闭并记录原因',
                'aria-label': `关闭归档：${item.title}`,
                'data-archive': item.occurrenceKey ?? item.id,
                style: {
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '28px',
                  height: '28px',
                  padding: 0,
                  border: `1px solid ${T.line2}`,
                  borderRadius: '7px',
                  background: 'transparent',
                  color: T.text3,
                  cursor: 'pointer',
                  flex: 'none',
                },
              },
              h(ActionIcon, { name: 'archive', size: 13 }),
            )
      const removeButton = h(
        'button',
        {
          type: 'button',
          onClick: (event) => {
            event.stopPropagation()
            actionHandlers.onRemove(item)
          },
          disabled: executing,
          title: executing ? 'AI 正在执行，请等待完成或先取消运行' : '从仓库删除这条需求记录',
          'aria-label': `删除需求：${item.title}`,
          'data-remove': item.occurrenceKey ?? item.id,
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '28px',
            height: '28px',
            padding: 0,
            border: `1px solid ${T.line2}`,
            borderRadius: '7px',
            background: 'transparent',
            color: T.text3,
            cursor: 'pointer',
            flex: 'none',
          },
        },
        h(ActionIcon, { name: 'trash', size: 13 }),
      )
      const secondaryActions = h('details', { onClick: (event) => event.stopPropagation(), style: { position: 'relative', flex: 'none' } },
        h('summary', { 'aria-label': `更多操作：${item.title}`, title: '更多操作', style: { cursor: 'pointer', listStyle: 'none', padding: '6px', color: T.text2, borderRadius: '6px' } }, h(ActionIcon, { name: 'more', size: 16 })),
        h('div', { style: { display: 'flex', gap: '6px', padding: '6px 0' } }, archiveButton, removeButton),
      )
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
            minHeight: mobile ? '76px' : '80px',
            contentVisibility: 'auto',
            containIntrinsicSize: `auto ${mobile ? 76 : 80}px`,
            padding: mobile ? '12px 14px' : '13px 18px',
            borderTop: `1px solid ${T.line}`,
            background: selected ? T.layer2 : 'transparent',
            boxShadow: selected ? `inset 2px 0 0 ${T.brand}` : 'none',
            cursor: 'pointer',
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
            'div',
            { style: { display: 'flex', alignItems: 'baseline', gap: '8px', minWidth: 0 } },
            h(
              'button',
              {
                type: 'button',
                onClick: (event) => {
                  event.stopPropagation()
                  open()
                },
                onMouseEnter: () => setHover(true),
                onMouseLeave: () => setHover(false),
                onFocus: () => setHover(true),
                onBlur: () => setHover(false),
                title: item.title,
                style: {
                  display: 'block',
                  minWidth: 0,
                  maxWidth: '100%',
                  overflow: 'hidden',
                  overflowWrap: 'anywhere',
                  whiteSpace: 'nowrap',
                  textOverflow: 'ellipsis',
                  lineHeight: 1.5,
                  border: 0,
                  padding: 0,
                  background: 'transparent',
                  color: T.text,
                  fontFamily: 'inherit',
                  fontSize: '14px',
                  fontWeight: 600,
                  letterSpacing: '-.005em',
                  textAlign: 'left',
                  cursor: 'pointer',
                  textDecoration: hover ? 'underline' : 'none',
                  textUnderlineOffset: '3px',
                  outlineColor: T.brand,
                },
              },
              item.title,
            ),
          ),
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, marginTop: '5px', flexWrap: 'wrap', overflowWrap: 'anywhere' } },
            isDefect(item) ? h(DefectPill, null) : h('span', { style: { fontSize: '11px', color: T.text2, whiteSpace: 'nowrap' } }, isChatSource(item) ? '💬 对话生成' : isFeedbackSource(item) ? '反馈' : '✍️ 手动创建'),
            h(
              'code',
              { style: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: '11.5px', color: T.text2 } },
              item.id,
            ),
            h('span', { title: item.specConvergences?.length ? [...item.specConvergences].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0]?.evolutionNote || '需求已演进' : '需求版本', tabIndex: 0, style: Number(item.revision) > 1 ? { color: '#8bd5f5', background: 'rgba(63,160,205,.14)', border: '1px solid rgba(106,190,225,.4)', borderRadius: '999px', padding: '1px 7px', fontSize: '11px', whiteSpace: 'nowrap' } : { color: T.text3, fontSize: '11px' } }, `v${item.revision ?? 1}${Number(item.revision) > 1 ? ' · 已演进' : ''}`),
            item.pendingPatch ? h('span', { style: { color: T.warn, fontSize: '11px', fontWeight: 600 } }, '● 待确认变更') : null,
            defect?.impact?.stage ? h('span', { style: { color: T.text3, fontSize: '11px' } }, `失败于${defectStageText(item)}`) : null,
            defect && occurrences > 1
              ? h('span', { style: { color: T.text2, fontSize: '11px', fontVariantNumeric: 'tabular-nums' } }, `×${occurrences}`)
              : null,
            defect?.regressionSuspected ? h('span', { style: { color: T.warn, fontSize: '11px' } }, '疑似回归') : null,
            showProject && item.projectName ? h('span', { style: { color: T.text3, fontSize: '11px' } }, item.projectName) : null,
            mobile ? h(DeliveryPill, { item }) : null,
            mobile && check.label !== '待验证'
              ? h(
                  'span',
                  { style: { display: 'inline-flex', alignItems: 'center', gap: '5px', color: check.tone === 'neutral' ? T.text2 : checkToneColor(check.tone), fontSize: '11.5px', fontWeight: 500 } },
                  h('span', { style: { width: '6px', height: '6px', borderRadius: '50%', background: checkToneColor(check.tone), flex: 'none' } }),
                  check.label,
                )
              : null,
          ),
          anomaly
            ? h(
                'div',
                { style: { marginTop: '3px', color: T.err, fontSize: '11.5px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } },
                anomaly,
              )
            : item.duplicateCount > 1
              ? null
              : null,
        ),
        mobile ? null : h('div', { role: 'cell', style: listCell() }, h(DeliveryPill, { item })),
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
                title: '需求中的验收标准数量',
              },
              acceptanceLabel(item),
            ),
        mobile
          ? h(
              'div',
              { role: 'cell', style: listCell({ justifyContent: 'flex-end', gap: '6px' }) },
              actionButton,
              secondaryActions,
            )
          : h(
              'div',
              { role: 'cell', style: listCell({ flexDirection: 'column', alignItems: 'flex-start', gap: '2px' }) },
              h('span', { title: '最近更新', style: { color: T.text2, fontSize: '12px', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' } }, item.updatedAt || item.createdAt ? formatLocalStamp(item.updatedAt ?? item.createdAt).slice(0, 16) : '—'),
              check.label !== '待验证' && ['verified', 'failed'].includes(decision?.state) ? h('span', { style: { color: checkToneColor(check.tone), fontSize: '11px' } }, check.label) : null,
            ),
        mobile ? null : h('div', { role: 'cell', style: listCell({ justifyContent: 'flex-end', gap: '6px' }) }, actionButton, secondaryActions),
      )
    }

    // `contained` renders the table inside the workbench list scroller, which
    // already owns the border, background and rounded corners. The header row
    // stays sticky inside that scroller (stickyTop 0), which is what keeps the
    // column titles visible while the rows scroll.
    function RequirementTable({ items, narrow, mobile, showProject, selectedKey, onOpen, onAiReview, onAcceptance, onArchive, onRemove, duplicateCounts, emptyNode, stickyTop = 0, contained = false, onDefect }) {
      const columns = listColumns(narrow, mobile)
      const actionHandlers = { onOpen, onAiReview, onAcceptance, onArchive, onRemove, onDefect }
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
          style: contained
            ? { overflow: 'visible' }
            : { border: `1px solid ${T.line}`, borderRadius: '12px', background: T.layer, overflow: 'visible' },
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
              padding: mobile ? '9px 14px' : '9px 18px',
              background: contained ? T.layer : T.base,
              borderBottom: `1px solid ${T.line}`,
              borderTopLeftRadius: contained ? 0 : '12px',
              borderTopRightRadius: contained ? 0 : '12px',
              position: 'sticky',
              top: `${stickyTop}px`,
              zIndex: 15,
            },
          },
          headerCell('需求'),
          mobile ? null : headerCell('交付状态'),
          narrow || mobile ? null : headerCell('负责人'),
          narrow || mobile ? null : headerCell('验收标准'),
          mobile ? null : headerCell('最近更新'),
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
                duplicateCounts,
                actionHandlers,
                selected: selectedKey === (item.occurrenceKey ?? item.id),
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
            style: { display: 'grid', gridTemplateColumns: columns, columnGap: '14px', alignItems: 'center', minHeight: mobile ? '76px' : '80px', padding: mobile ? '12px 14px' : '13px 18px', boxSizing: 'border-box', borderTop: `1px solid ${T.line}` },
          },
          h(
            'div',
            null,
            h('div', { style: { width: `${48 + ((index * 17) % 30)}%`, height: '12px', borderRadius: '5px', background: T.layer2 } }),
            h('div', { style: { width: '110px', height: '9px', borderRadius: '4px', background: T.layer2, marginTop: '8px' } }),
          ),
          mobile ? null : h('div', { style: { width: '58px', height: '18px', borderRadius: '999px', background: T.layer2 } }),
          narrow || mobile ? null : h('div', { style: { width: '46px', height: '10px', borderRadius: '4px', background: T.layer2 } }),
          narrow || mobile ? null : h('div', { style: { width: '34px', height: '10px', borderRadius: '4px', background: T.layer2 } }),
          mobile ? null : h('div', { style: { width: '72px', height: '18px', borderRadius: '999px', background: T.layer2 } }),
          h('div', { style: { justifySelf: 'end', width: '46px', height: '22px', borderRadius: '6px', background: T.layer2 } }),
        )
      return h(
        'div',
        { 'aria-busy': 'true', 'aria-label': '正在读取需求', style: { border: `1px solid ${T.line}`, borderRadius: '12px', background: T.layer, overflow: 'hidden' } },
        h('div', { style: { height: '35px', borderBottom: `1px solid ${T.line}`, background: T.base } }),
        [0, 1, 2, 3, 4, 5, 6, 7].map(row),
      )
    }

    function NoResults({ filter, keyword, source, onClear }) {
      return h(
        'div',
        { style: { textAlign: 'center', padding: '54px 24px' } },
        h('p', { style: { margin: 0, color: T.text, fontSize: '14px', fontWeight: 600 } }, '没有符合条件的需求'),
        h(
          'p',
          { style: { margin: '7px 0 18px', color: T.text2, fontSize: '12.5px' } },
          [filter !== 'all' ? `视图：${(FILTERS.find(([id]) => id === filter) ?? [])[1] ?? filter}` : null, source && source !== 'all' ? `来源：${(SOURCE_FILTERS.find(([id]) => id === source) ?? [])[1] ?? source}` : null, keyword ? `搜索：${keyword}` : null]
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
          style: { margin: '0 0 8px', border: `1px solid ${T.line}`, borderLeft: `3px solid ${T.err}`, borderRadius: '10px', background: 'rgba(255,139,139,.055)', padding: '7px 12px' },
        },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } },
          h(ActionIcon, { name: 'alert', size: 15 }),
          h(
            'div',
            {
              style: { minWidth: 0, flex: 1, display: 'flex', alignItems: 'baseline', gap: '8px', overflow: 'hidden', whiteSpace: 'nowrap' },
              title: '保留全部记录，不自动合并；打开记录人工核对。',
            },
            h('span', { style: { color: T.text, fontSize: '12.5px', fontWeight: 500, flex: 'none' } }, `发现 ${list.length} 组数据异常，涉及 ${records.size} 条记录`),
            breakdown ? h('span', { style: { color: T.text2, fontSize: '11.5px', overflow: 'hidden', textOverflow: 'ellipsis' } }, breakdown) : null,
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
      // A failed check explained purely by data anomalies is reported by the
      // anomaly notice; saying "0 gate gaps" here would be noise.
      // Nothing actionable: a bare "fail" without gaps is not worth a banner.
      if (!executionFailed && gaps.length === 0) return null
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
          style: { margin: '0 0 8px', border: `1px solid ${T.line}`, borderLeft: `3px solid ${tone}`, borderRadius: '10px', background: T.layer, padding: '7px 12px' },
        },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } },
          h('span', { style: { width: '7px', height: '7px', borderRadius: '50%', background: tone, flex: 'none' } }),
          h(
            'div',
            { style: { minWidth: 0, flex: 1, display: 'flex', alignItems: 'baseline', gap: '8px', overflow: 'hidden', whiteSpace: 'nowrap' }, title: detail },
            h('span', { style: { color: T.text, fontSize: '12.5px', fontWeight: 500, flex: 'none' } }, title),
            h('span', { style: { color: T.text2, fontSize: '11.5px', overflow: 'hidden', textOverflow: 'ellipsis' } }, executionFailed ? '读取失败后重试，不代表需求未通过' : '展开查看规则与修复建议'),
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
          h('div', null, '尚未建立 GitHub 归属：需求 Issue、任务子议题与看板条目会在「交给 AI 推进」时按项目配置创建。'),
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
                : '尚未创建（交给 AI 推进时生成）',
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
      search: 'M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16M16.65 16.65 21 21',
      refresh: 'M20 11a8 8 0 10-2.3 5.7M20 5v6h-6',
      more: 'M5 12h.01M12 12h.01M19 12h.01',
      plus: 'M12 5v14M5 12h14',
      chevron: 'M9 6l6 6-6 6',
      folder: 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z',
      link: 'M10 13a5 5 0 007 0l2-2a5 5 0 00-7-7l-1 1M14 11a5 5 0 00-7 0l-2 2a5 5 0 007 7l1-1',
      alert: 'M12 3l9 16H3zM12 9v5M12 17h.01',
      archive: 'M4 7h16M6 7v12a1 1 0 001 1h10a1 1 0 001-1V7M9 7V4h6v3M12 11v5M9.5 13.5L12 16l2.5-2.5',
      message: 'M21 11.5a8.5 8.5 0 0 1-8.5 8.5H7l-4 3v-4.6A8.5 8.5 0 0 1 11.5 3h1A8.5 8.5 0 0 1 21 11.5z',
    }

    function ActionIcon({ name, size = 14 }) {
      return h(
        'svg',
        { width: size, height: size, style: { flexShrink: 0 }, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
        h('path', { d: ICON_PATHS[name] ?? ICON_PATHS.sparkles }),
      )
    }

    /** One visual language for every action: icon + label, never a bare text link. */
    function ActionButton({ label, icon, onClick, variant = 'secondary', disabled = false, title, ...rest }) {
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
          ...rest,
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

    // --- Rich, safe rendering for brief / AI review text. ---------------------
    // Markdown-ish text from users and models is rendered as text nodes only:
    // never dangerouslySetInnerHTML, so pasted HTML/script stays inert.
    function renderInline(text, prefix) {
      const source = String(text ?? '')
      const nodes = []
      const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\((https?:\/\/[^\s)]+)\))/g
      let last = 0
      let match = pattern.exec(source)
      let index = 0
      while (match !== null) {
        if (match.index > last) nodes.push(source.slice(last, match.index))
        const token = match[0]
        if (token.startsWith('**')) {
          nodes.push(h('b', { key: `${prefix}-b-${index}`, style: { color: T.text, fontWeight: 600 } }, token.slice(2, -2)))
        } else if (token.startsWith('`')) {
          nodes.push(
            h(
              'code',
              {
                key: `${prefix}-c-${index}`,
                style: {
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: '11.5px',
                  background: T.layer2,
                  borderRadius: '4px',
                  padding: '0 3px',
                  color: T.text,
                },
              },
              token.slice(1, -1),
            ),
          )
        } else {
          const link = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(token)
          nodes.push(h('a', { key: `${prefix}-a-${index}`, href: link[2], target: '_blank', rel: 'noreferrer', style: { color: T.brand } }, link[1]))
        }
        last = match.index + token.length
        index += 1
        match = pattern.exec(source)
      }
      if (last < source.length) nodes.push(source.slice(last))
      return nodes
    }

    function renderRich(text) {
      const lines = String(text ?? '').replace(/<!--\s*alm:meta\b[\s\S]*?-->/g, '').split(/\r?\n/)
      const blocks = []
      let list = null
      let ordered = false
      const flush = () => {
        if (!list) return
        blocks.push(
          h(
            ordered ? 'ol' : 'ul',
            { key: `list-${blocks.length}`, style: { margin: '2px 0 8px', paddingLeft: '18px', color: T.text2, fontSize: '12.5px', lineHeight: 1.7 } },
            list,
          ),
        )
        list = null
      }
      lines.forEach((line, index) => {
        const trimmed = line.trim()
        if (!trimmed) {
          flush()
          return
        }
        const orderedMatch = /^(\d+)\.\s+(.*)$/.exec(trimmed)
        if (orderedMatch) {
          if (!list || !ordered) {
            flush()
            ordered = true
            list = []
          }
          list.push(h('li', { key: `o-${index}` }, renderInline(orderedMatch[2], `oli-${index}`)))
          return
        }
        if (/^[-*]\s+/.test(trimmed)) {
          if (!list || ordered) {
            flush()
            ordered = false
            list = []
          }
          list.push(h('li', { key: `u-${index}` }, renderInline(trimmed.replace(/^[-*]\s+/, ''), `li-${index}`)))
          return
        }
        flush()
        if (trimmed.startsWith('>')) {
          blocks.push(
            h(
              'blockquote',
              { key: `q-${index}`, style: { margin: '4px 0 8px', padding: '2px 0 2px 10px', borderLeft: `2px solid ${T.line2}`, color: T.text2, fontSize: '12.5px', lineHeight: 1.7 } },
              renderInline(trimmed.replace(/^>\s?/, ''), `q-${index}`),
            ),
          )
          return
        }
        const heading = /^(#{2,6})\s+(.*)$/.exec(trimmed)
        if (heading) {
          blocks.push(h('div', { key: `h-${index}`, style: { margin: '10px 0 4px', fontSize: '12px', fontWeight: 600, color: T.text } }, renderInline(heading[2], `h-${index}`)))
          return
        }
        blocks.push(h('p', { key: `p-${index}`, style: { margin: '0 0 6px', color: T.text2, fontSize: '12.5px', lineHeight: 1.75 } }, renderInline(trimmed, `p-${index}`)))
      })
      flush()
      return blocks
    }

    function renderBrief(text) {
      return h('div', null, renderRich(text))
    }

    const BRIEF_SECTION_TITLES = /^(背景|目标|范围|验收|约束|风险|备注|原始诉求|AI|评审|重构|建议|决策)/

    const BRIEF_INLINE_TITLES = /^(背景|目标|范围|验收标准|验收|约束|风险|备注|原始诉求|用户诉求)$/

    // Older briefs repeat the label inside their own section text ("背景：…" under "背景").
    // Peel it so the sentence shows once; other labels become sub-labels.
    function peelInlineLabels(text, title) {
      const out = []
      String(text ?? '')
        .split(/\r?\n/)
        .forEach((line) => {
          const trimmed = line.trim()
          const match = /^(背景|目标|范围|验收标准|验收|约束|风险|备注)[:：]\s*(.*)$/.exec(trimmed)
          if (!match) {
            out.push(line)
            return
          }
          if (match[1] === title) {
            if (match[2]) out.push(match[2])
            return
          }
          out.push(`**${match[1]}**`)
          if (match[2]) out.push(match[2])
        })
      return out.join('\n').trim()
    }

    function briefSections(text) {
      const lines = String(text ?? '').split(/\r?\n/)
      const sections = []
      let current = null
      const startSection = (title) => {
        current = { title, body: [] }
        sections.push(current)
      }
      lines.forEach((line) => {
        const trimmed = line.trim()
        const heading = /^##\s+(.+)$/.exec(trimmed)
        if (heading) {
          startSection(heading[1].trim())
          return
        }
        if (/^#\s+/.test(trimmed)) return
        // briefText is persisted flattened: a standalone label line starts a section.
        if (BRIEF_INLINE_TITLES.test(trimmed)) {
          startSection(trimmed)
          return
        }
        if (!current) {
          if (!trimmed) return
          startSection('原始诉求')
        }
        current.body.push(line)
      })
      return sections
        .map((section) => ({ title: section.title, text: peelInlineLabels(section.body.join('\n'), section.title) }))
        .filter((section) => section.text || BRIEF_SECTION_TITLES.test(section.title))
    }

    function isAiSection(section) {
      return /AI|评审|重构|建议/.test(section.title) || /(^|\n)\s*>?\s*AI (结论|评审|建议)/.test(section.text)
    }

    function compactBody(text) {
      return String(text ?? '').replace(/\s+/g, ' ').trim()
    }

    function CopyTextButton({ value, label = '复制' }) {
      const [copied, setCopied] = useState(false)
      const [failed, setFailed] = useState(false)
      const manualRef = useRef(null)
      const copy = async () => {
        const text = String(value ?? '')
        let success = false
        try {
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text)
            success = true
          }
        } catch { /* Desktop custom schemes may deny the async clipboard API. */ }
        if (!success) {
          const previous = document.activeElement
          const input = document.createElement('textarea')
          input.value = text
          input.setAttribute('aria-label', '待复制内容')
          input.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0'
          // Keep the fallback inside the active focus trap, not outside the dialog.
          ;(previous?.closest('[role="dialog"]') ?? document.body).appendChild(input)
          input.select()
          try { success = document.execCommand('copy') } catch { success = false }
          input.remove()
          previous?.focus?.()
        }
        setFailed(!success)
        setCopied(success)
        if (success) window.setTimeout(() => setCopied(false), 1600)
      }
      useEffect(() => {
        if (failed) { manualRef.current?.focus(); manualRef.current?.select() }
      }, [failed])
      return h(
        'span',
        { style: { display: 'inline-flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' } },
        h('button',
          { type: 'button', onClick: copy, title: copied ? '已复制' : `${label}到剪贴板`, style: { border: 0, background: 'transparent', color: copied ? T.ok : T.text3, fontSize: '10.5px', cursor: 'pointer', padding: '0 2px', flex: 'none' } },
          copied ? '已复制' : label,
        ),
        copied ? h('span', { role: 'status', style: { fontSize: '11px', color: T.ok } }, '复制成功') : null,
        failed ? h('span', { role: 'alert', style: { fontSize: '11px', color: T.warn } }, '自动复制受限，请按 Ctrl+C：', h('input', { ref: manualRef, readOnly: true, value: String(value ?? ''), 'aria-label': '手动复制内容', style: { width: '150px', color: T.text, background: T.layer, border: `1px solid ${T.line}` } })) : null,
      )
    }

    const DETAIL_CARD = {
      background: T.layer,
      border: `1px solid ${T.line}`,
      borderRadius: '10px',
      padding: '12px 14px',
      marginBottom: '12px',
      minWidth: 0,
    }
    const DETAIL_TITLE = { margin: 0, fontSize: '12px', fontWeight: 600, color: T.text, letterSpacing: '.01em' }
    const DETAIL_SUB = { margin: 0, fontSize: '11px', color: T.text3 }
    const DETAIL_ROW = { display: 'flex', alignItems: 'baseline', gap: '8px', padding: '3px 0', fontSize: '12px', minWidth: 0 }
    const DETAIL_LABEL = { flex: 'none', width: '68px', color: T.text3, fontSize: '11.5px' }

    function DetailRow({ label, children }) {
      return h('div', { style: DETAIL_ROW }, h('span', { style: DETAIL_LABEL }, label), h('span', { style: { color: T.text, minWidth: 0, wordBreak: 'break-word' } }, children))
    }

    function DetailsToggle({ summary, children, defaultOpen = false }) {
      return h(
        'details',
        { style: { borderTop: `1px solid ${T.line}`, marginTop: '8px', paddingTop: '8px' }, open: defaultOpen },
        h('summary', { style: { cursor: 'pointer', color: T.text2, fontSize: '11.5px', lineHeight: 1.7 } }, summary),
        h('div', { style: { marginTop: '6px' } }, children),
      )
    }

    // ---- detail v2: single-column requirement detail (contract §6) ----------
    let warnedFallbackDetailView = false

    function detailTitleId(item) {
      return `req-detail-title-${String(item?.occurrenceKey ?? item?.id ?? 'detail').replace(/[^A-Za-z0-9_-]/g, '-')}`
    }

    function detailToneColor(tone) {
      if (tone === 'danger') return T.err
      if (tone === 'attention') return T.warn
      if (tone === 'success') return T.ok
      return T.text3
    }

    // Compatibility projection for old hosts that predate item.detailView.
    // Only state/action basics are derived here; the server projection is the
    // single source of truth and is what normal rendering consumes.
    function fallbackDetailView(item, allItems) {
      if (!warnedFallbackDetailView) {
        warnedFallbackDetailView = true
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[requirements] item.detailView 缺失（旧宿主或旧缓存），详情页使用最小兼容投影；请刷新页面或升级插件。')
        }
      }
      const delivery = deliveryOf(item)
      const decision = item?.decision ?? null
      const acceptance = item?.acceptance ?? null
      const candidate = item?.candidate ?? null
      const run = item?.run ?? null
      const closed = item?.closed === true || delivery.key === 'closed'
      const waiting = Boolean(run && (run.awaitingAnswer === true || (run.awaitingAnswer === undefined && run.status === 'waiting-input' && Boolean(decision))))
      const idleHandback = Boolean(run && (run.idleHandback === true || (run.awaitingAnswer === undefined && run.status === 'waiting-input' && !decision)))
      const stale = Boolean(run && run.stale === true)
      const active = Boolean(run && run.active === true)
      const acceptanceResult = acceptance?.result ?? null
      const acceptanceRegistered = Boolean(acceptance?.registered ?? acceptance)
      const acceptancePassedCurrent = acceptance?.latest?.result === 'pass' && acceptance?.latest?.current !== false
      const accepted = delivery.key === 'accepted'
      const released = item?.release?.exists === true && (item.release.released === true || item.release.status === 'released')
      const blockedFeedback = decision?.state === 'blocked' || decision?.state === 'needs-clarification'
      let primaryAction = null
      if (!closed) {
        if (waiting) primaryAction = { id: 'answer-run', label: '回答并继续', enabled: Boolean(run?.id), reason: run?.id ? null : '未找到决策运行号', target: { runId: run?.id ?? null } }
        else if (stale) primaryAction = { id: 'resume-run', label: '恢复推进', enabled: Boolean(run?.id), reason: run?.id ? null : '未找到可恢复的运行号', target: { runId: run?.id ?? null } }
        else if (active) primaryAction = { id: 'watch-run', label: '查看运行', enabled: true, reason: null, target: { runId: run?.id ?? null } }
        else if (idleHandback) {
          primaryAction = acceptancePassedCurrent
            ? { id: 'create-candidate', label: '生成交付候选', enabled: true, reason: null, target: {} }
            : { id: 'continue-run', label: '继续推进', enabled: true, reason: null, target: { runId: run?.id ?? null } }
        }
        else if (delivery.key === 'awaiting-acceptance') primaryAction = { id: 'signoff', label: '验收交付', enabled: true, reason: null, target: { candidateId: candidate?.id ?? null } }
        else if (accepted && released) primaryAction = null
        else if (accepted) primaryAction = { id: 'release', label: '决定发布', enabled: true, reason: null, target: { candidateId: candidate?.id ?? null } }
        else if (blockedFeedback) primaryAction = null
        else if (acceptanceRegistered && acceptanceResult !== 'pass') primaryAction = { id: 'start-fix', label: '开始修复', enabled: true, reason: null, target: {} }
        else if (delivery.key === 'pending' && String(delivery.source ?? '').startsWith('run-')) primaryAction = { id: 'start', label: '交给 AI 推进', enabled: true, reason: null, target: {} }
        else if (delivery.key === 'in-progress') primaryAction = { id: 'watch-run', label: '查看运行', enabled: true, reason: null, target: {} }
        else primaryAction = { id: 'start', label: '交给 AI 推进', enabled: true, reason: null, target: {} }
      }
      const explanation = closed
        ? '该需求已关闭，只保留记录。'
        : delivery.reason
          ? String(delivery.reason)
          : '宿主未提供详情投影，以下为兼容视图。'
      const contextKind = closed ? 'closed'
        : waiting ? 'answer'
          : stale ? 'run-interrupted'
            : active ? 'run-active'
              : idleHandback ? (acceptancePassedCurrent ? 'candidate-pending' : 'run-idle-handback')
                : delivery.key === 'awaiting-acceptance' ? 'awaiting-acceptance'
                  : accepted && released ? 'released'
                    : accepted ? 'accepted'
                      : blockedFeedback ? 'needs-attention'
                        : acceptanceRegistered && acceptanceResult !== 'pass' ? 'acceptance-failed'
                          : delivery.key === 'pending' && String(delivery.source ?? '').startsWith('run-') ? 'run-rolled-back'
                            : 'not-started'
      const headlines = {
        closed: '已关闭',
        answer: '需要你回答',
        'run-interrupted': '推进已中断',
        'run-active': 'AI 正在开发',
        'run-idle-handback': '等待你决定下一步',
        'candidate-pending': '等待生成交付候选',
        'awaiting-acceptance': '等待验收',
        released: '已发布',
        accepted: '已验收',
        'needs-attention': '需求需要修改',
        'acceptance-failed': '验收失败，可修复',
        'run-rolled-back': '推进已回退，等待启动',
        'not-started': '尚未开始',
      }
      const tones = { closed: 'neutral', answer: 'attention', 'run-interrupted': 'danger', 'run-active': 'attention', 'run-idle-handback': 'attention', 'awaiting-acceptance': 'attention', released: 'success', accepted: 'success', 'needs-attention': 'danger', 'acceptance-failed': 'danger', 'run-rolled-back': 'attention', 'not-started': 'neutral' }
      const attentionItems = []
      if (!closed) {
        if (blockedFeedback) {
          attentionItems.push({ id: 'needs-attention', kind: 'needs-attention', current: true, tone: 'danger', title: '需求需要修改', detail: decision?.topGap?.message ?? decision?.label ?? '存在需要处理的问题。', ref: { tab: 'requirement', anchor: 'requirement-main' } })
        }
        if (acceptanceRegistered && acceptanceResult !== 'pass') {
          attentionItems.push({ id: 'acceptance-failed', kind: 'acceptance-failed', current: true, tone: 'danger', title: '验收失败，可修复', detail: acceptanceResult ? `最近一次验收结果：${acceptanceResult}` : '验收尚未通过。', ref: { tab: 'delivery', anchor: 'delivery-acceptance' } })
        }
      }
      const parsed = briefSections(item?.briefText).map((section, index) => ({
        id: `sec-${index + 1}`,
        title: section.title,
        kind: /验收/.test(section.title) ? 'acceptance' : /目标|范围|场景|问题/.test(section.title) ? 'claim' : /背景|原始诉求|用户诉求|备注/.test(section.title) ? 'background' : /约束|风险|依赖/.test(section.title) ? 'constraint' : 'other',
        text: section.text,
        sameAs: null,
      }))
      const missing = []
      if (!parsed.some((section) => section.kind === 'claim')) missing.push('目标', '范围')
      if (!parsed.some((section) => section.kind === 'acceptance')) missing.push('验收要求')
      const aiReview = item?.aiReview ?? null
      return {
        schema: 'alm.detail.view/v1',
        identity: {
          id: item?.id ?? '—',
          revision: item?.revision ?? item?.version ?? null,
          title: item?.title ?? item?.id ?? '',
          owner: item?.owner ?? null,
          priority: item?.priority ?? null,
          project: item?.project ?? null,
          projectName: item?.projectName ?? item?.project ?? null,
          updatedAt: item?.versions?.[0]?.date ?? null,
          file: item?.file ?? null,
          line: item?.line ?? null,
          brief: item?.briefPath ?? null,
          sources: item?.sources ?? [],
          attachmentCount: (item?.attachmentFiles ?? []).length,
        },
        context: {
          kind: contextKind,
          headline: headlines[contextKind],
          explanation,
          tone: tones[contextKind],
          question: waiting ? { ref: decision?.topGap?.code ?? null, title: decision?.label ?? decision?.title ?? '决策请求', excerpt: null, runId: run?.id ?? null } : null,
          relatedRefs: [],
        },
        primaryAction,
        secondaryActions: closed ? [] : [{ id: 'refresh', label: '刷新', enabled: true, reason: null }],
        attentionItems,
        summaries: {
          delivery: { key: delivery.key, label: delivery.label, reason: delivery.reason ?? null, source: delivery.source ?? null, runId: run?.id ?? null, runStatus: run?.status ?? null },
          run: {
            exists: Boolean(run),
            id: run?.id ?? null,
            status: run?.status ?? null,
            phase: run?.phase ?? null,
            active,
            stale,
            awaitingAnswer: waiting,
            idleHandback,
            lastActivityAt: run?.lastActivityAt ?? run?.updatedAt ?? null,
            label: run?.statusLabel ?? run?.label ?? null,
            failure: run?.failure ? { message: run.failure.message ?? String(run.failure) } : null,
          },
          review: {
            ai: {
              stored: Boolean(aiReview?.stored),
              verdict: aiReview?.verdict ?? null,
              suggestions: aiReview?.suggestions ?? [],
              adopted: aiReview?.adopted === true,
              adoptionValid: aiReview?.adoption?.valid !== false,
              generatedAt: aiReview?.generatedAt ?? null,
            },
          },
          acceptance: {
            registered: acceptanceRegistered,
            commandCount: acceptance?.commandCount ?? 0,
            result: acceptanceResult,
            current: acceptance?.current ?? null,
            complete: acceptance?.complete ?? false,
            finishedAt: acceptance?.finishedAt ?? null,
            headSha: acceptance?.headSha ?? null,
            headShaShort: acceptance?.headSha ? shortHash(acceptance.headSha) : null,
            environment: acceptance?.environment ?? null,
            provenance: { commandIds: [], evidencePath: null, ruleCodes: [] },
          },
          candidate: {
            exists: Boolean(candidate),
            id: candidate?.id ?? null,
            current: candidate?.current ?? null,
            treeHash: candidate?.treeHash ?? null,
            treeHashShort: candidate?.treeHash ? shortHash(candidate.treeHash) : null,
            reasons: candidate?.reasons ?? [],
          },
          defects: { own: null, related: [], closedHistory: [], counts: { open: 0, closed: 0 } },
          release: item?.release?.exists ? { exists: true, id: item.release.id ?? null, label: item.release.label ?? item.release.status ?? null, status: item.release.status ?? null, released } : null,
        },
        tabs: { requirement: { badge: null }, delivery: { badge: attentionItems.filter((entry) => entry.current && entry.kind !== 'defect-closed').length }, record: { badge: null } },
        content: {
          sections: parsed,
          missing,
          verifiedBy: item?.verifiedBy ?? [],
          acceptanceCriteria: parsed.filter((section) => section.kind === 'acceptance').map((section, index) => ({ id: `AC-${index + 1}`, title: section.title, text: section.text })),
          attachments: item?.attachmentFiles ?? [],
        },
        record: {
          timeline: [],
          relations: relationsOf(item, allItems),
          github: item?.github ?? null,
          technical: { file: item?.file ?? null, brief: item?.briefPath ?? null, prompt: null },
        },
        freshness: {
          readAt: new Date().toISOString(),
          requirementRevision: item?.revision ?? null,
          briefPresent: Boolean(item?.briefText),
          candidateCurrent: candidate?.current ?? null,
          acceptanceApplicable: acceptance?.current ?? null,
          missing: [],
        },
      }
    }

    const DETAIL_SMALL = { margin: 0, fontSize: '11.5px', color: T.text3, lineHeight: 1.65 }
    const DETAIL_LINK = { border: 0, background: 'transparent', color: T.text3, fontSize: '11.5px', padding: 0, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: '2px', lineHeight: 1.6 }
    // Header-level entries read as small ghost buttons: at 1x the old underlined
    // 11.5px text sat against the close icon and looked clipped.
    const DETAIL_HEADER_ACTION = { border: `1px solid ${T.line2}`, background: 'transparent', color: T.text2, fontSize: '12px', lineHeight: 1.4, padding: '4px 8px', borderRadius: '6px', cursor: 'pointer' }
    const DETAIL_GHOST = { border: `1px solid ${T.line2}`, background: 'transparent', color: T.text2, fontSize: '11.5px', padding: '6px 10px', borderRadius: '7px', cursor: 'pointer', lineHeight: 1.5 }
    const DETAIL_PRIMARY = { border: 0, borderRadius: '8px', background: T.text, color: T.base, fontSize: '13px', fontWeight: 600, padding: '9px 18px', minHeight: '36px', cursor: 'pointer', flex: 'none' }
    const DETAIL_TABS = [
      { id: 'requirement', label: '需求' },
      { id: 'delivery', label: '交付' },
      { id: 'record', label: '记录' },
    ]
    const DETAIL_SHELL_CSS = [
      '@keyframes alm-detail-fade{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}',
      '[data-detail-shell] [data-detail-body]{animation:alm-detail-fade 150ms ease-out}',
      '@media (prefers-reduced-motion: reduce){[data-detail-shell] [data-detail-body]{animation:none}}',
      '[data-detail-shell] details>summary{list-style:none}',
      '[data-detail-shell] details>summary::-webkit-details-marker{display:none}',
      `[data-detail-shell] details>summary::before{content:"▸ ";color:${T.text2}}`,
      '[data-detail-shell] details[open]>summary::before{content:"▾ "}',
      '[data-detail-shell] *{box-sizing:border-box}',
    ].join('\n')

    function acceptanceResultText(value) {
      if (value === 'pass') return '通过'
      if (value === 'fail') return '失败'
      if (value === 'stale') return '已过期'
      if (value === 'not-run' || !value) return '尚未执行'
      return String(value)
    }

    function acceptanceResultColor(value) {
      if (value === 'pass') return T.ok
      if (value === 'fail') return T.err
      if (value === 'stale') return T.warn
      return T.text3
    }

    function humanAcceptanceState(acceptance = {}) {
      if (!acceptance.registered) return { label: '尚未执行检查', color: T.text2 }
      if (acceptance.current === false) return { label: acceptance.result === 'pass' ? '历史通过，当前已过期' : '历史检查已过期', color: T.warn }
      if (acceptance.current !== true && acceptance.result != null) return { label: acceptance.result === 'pass' ? '历史通过，当前适用性未确认' : '历史检查未通过，当前适用性未确认', color: T.warn }
      if (acceptance.result === 'pass' && acceptance.complete !== true) return { label: '已有检查通过，完整验证尚未确认', color: T.warn }
      return { label: acceptance.result === 'pass' ? '当前技术检查通过' : acceptanceResultText(acceptance.result), color: acceptanceResultColor(acceptance.result) }
    }

    function canCancelRequirementRun(run = {}) {
      return run.exists === true && ['queued', 'running', 'waiting-input', 'paused'].includes(run.status)
    }

    function safeHttpHref(value) {
      return typeof value === 'string' && /^https?:\/\//i.test(value) ? value : null
    }

    function relationRows(relations) {
      return (relations ?? []).map((entry, index) => {
        if (Array.isArray(entry)) return { label: String(entry[0] ?? `关系 ${index + 1}`), ids: Array.isArray(entry[1]) ? entry[1] : [] }
        return { label: String(entry?.label ?? entry?.key ?? `关系 ${index + 1}`), ids: Array.isArray(entry?.ids) ? entry.ids : Array.isArray(entry?.items) ? entry.items : [] }
      })
    }

    function DetailBlock({ title, aside = null, anchor = null, sectionId = null, children }) {
      const progressive = /^(delivery-|record-)/.test(sectionId ?? '') && !['delivery-attention', 'record-timeline'].includes(sectionId)
      return h(
        progressive ? 'details' : 'section',
        {
          'data-detail-section': sectionId ?? undefined,
          'data-detail-anchor': anchor ?? undefined,
          tabIndex: anchor ? -1 : undefined,
          style: { marginTop: '18px', paddingTop: '14px', borderTop: `1px solid ${T.line}`, minWidth: 0 },
        },
        h(
          progressive ? 'summary' : 'div',
          { style: { display: 'flex', alignItems: 'baseline', gap: '10px', marginBottom: '8px', flexWrap: 'wrap', cursor: progressive ? 'pointer' : undefined } },
          h('h3', { style: { margin: 0, fontSize: '13px', fontWeight: 600, color: T.text, letterSpacing: '.01em' } }, title),
          aside ? h('div', { style: { marginLeft: 'auto', fontSize: '11.5px', color: T.text3 } }, aside) : null,
        ),
        children,
      )
    }

    function DetailBodySection({ section }) {
      if (!section) return null
      const body = section.sameAs
        ? h(
            'details',
            { style: { margin: '0 0 6px' } },
            h('summary', { style: { cursor: 'pointer', fontSize: '11px', color: T.text3 } }, `与「${section.sameAs}」内容相同（展开查看）`),
            h('div', { style: { marginTop: '4px' } }, renderRich(section.text)),
          )
        : h('div', null, renderRich(section.text))
      return h(
        'div',
        { 'data-detail-section': section.kind ?? 'other', style: { margin: '0 0 20px', minWidth: 0 } },
        h('h4', { style: { margin: '0 0 3px', fontSize: '11.5px', fontWeight: 600, color: T.text3, letterSpacing: '.02em' } }, section.title || '正文'),
        body,
      )
    }

    function DetailHeader({ item, detail, tab, root, narrow, notice, setNotice, onClose, onArchive, onRemove, onCancelRun, onRefresh }) {
      const [moreOpen, setMoreOpen] = useState(false)
      const [metaOpen, setMetaOpen] = useState(false)
      const moreRef = useRef(null)
      const identity = detail.identity ?? {}
      const technical = detail.record?.technical ?? {}
      const summaries = detail.summaries ?? {}
      const archived = (summaries.delivery?.key ?? '') === 'closed'
      const run = summaries.run ?? null
      const requirementId = identity.id ?? item?.id ?? ''
      const titleId = detailTitleId(item)
      useEffect(() => {
        if (!moreOpen) return undefined
        const onDown = (event) => {
          if (moreRef.current && !moreRef.current.contains(event.target)) setMoreOpen(false)
        }
        if (typeof document === 'undefined') return undefined
        document.addEventListener('mousedown', onDown)
        return () => document.removeEventListener('mousedown', onDown)
      }, [moreOpen])
      const copyPrompt = () => {
        const text = nextPrompt(item, root)
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(text).then(
            () => setNotice('提示词已复制'),
            () => setNotice('复制失败，请在记录页手动复制'),
          )
        } else {
          setNotice('复制失败，请在记录页手动复制')
        }
      }
      const openSource = () => {
        if (!root) {
          setNotice('缺少工作区路径，无法打开文件管理器')
          return
        }
        const base = String(root).replace(/[\\/]+$/, '')
        const relative = String(technical.file ?? '').replace(/\\/g, '/')
        const folder = relative.includes('/') ? relative.slice(0, relative.lastIndexOf('/')) : ''
        const reveal = (target) => writeJson('reveal', { root: target }, root).then(() => true, () => false)
        const fail = () => setNotice(technical.file ? `无法打开文件管理器；源文件路径：${technical.file}` : '无法打开文件管理器')
        if (!folder) {
          reveal(base).then((ok) => (ok ? setNotice(technical.file ? `已打开项目目录；源文件：${technical.file}` : '已打开项目工作区目录') : fail()))
          return
        }
        reveal(`${base}/${folder}`).then((ok) => {
          if (ok) {
            setNotice(`已打开源文件所在目录：${folder}`)
            return
          }
          reveal(base).then((fallback) =>
            fallback ? setNotice(`已打开项目目录；源文件：${technical.file}`) : fail(),
          )
        })
      }
      const menuItems = [
        { id: 'archive', label: '归档', hide: archived || !onArchive, onClick: () => onArchive && onArchive(item) },
        { id: 'remove', label: '删除', hide: !onRemove, onClick: () => onRemove && onRemove(item) },
        { id: 'copy-prompt', label: '复制提示词', hide: false, onClick: copyPrompt },
        { id: 'open-source', label: '打开源文件', hide: false, onClick: openSource },
        { id: 'cancel-run', label: '取消运行', hide: !run?.exists || !onCancelRun, onClick: () => onCancelRun && onCancelRun(item) },
      ].filter((entry) => !entry.hide)
      const metaRows = [
        ['源文件', technical.file ? `${technical.file}${technical.line ? ':' + technical.line : ''}` : '未登记'],
        ['brief', technical.brief ?? identity.brief ?? '未登记'],
        ['负责人', identity.owner ?? '未分配'],
        ['项目', identity.projectName ?? identity.project ?? '未登记'],
        ['优先级', identity.priority ?? '未设置'],
        ['最近更新', identity.updatedAt ? formatLocalStamp(identity.updatedAt) : '未知'],
        ['附件', identity.attachmentCount ? `${identity.attachmentCount} 个` : '无'],
      ]
      return h(
        'header',
        { 'data-detail-header': 'true', style: { flex: 'none', padding: narrow ? '14px 16px 10px' : '18px 20px 12px', borderBottom: `1px solid ${T.line}`, background: T.base, display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0 } },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flexWrap: 'nowrap', minHeight: '24px' } },
          h(
            'span',
            { style: { display: 'inline-flex', alignItems: 'center', gap: '2px', fontSize: '12px', color: T.text2, whiteSpace: 'nowrap', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' } },
            h('span', { 'data-detail-id': requirementId, style: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 } }, requirementId),
            h(CopyTextButton, { value: requirementId, label: '复制 ID' }),
          ),
          h('span', { 'data-detail-revision': String(identity.revision ?? '—'), title: '需求修订', style: { fontSize: '11.5px', color: T.text3, flex: 'none' } }, `v${identity.revision ?? '—'}`),
          isDefect(item) ? h(DefectStatusPill, { item, prefix: '缺陷' }) : null,
          h(
            'div',
            { style: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px', flex: 'none' } },
            h(
              'button',
              {
                type: 'button',
                title: '反馈这个页面',
                onClick: () => launchFeedbackFromLayer({ kind: 'drawer', label: `需求详情 ${requirementId}`, requirementId, tab }),
                style: DETAIL_HEADER_ACTION,
              },
              '反馈',
            ),
            h(
              'div',
              { ref: moreRef, style: { position: 'relative' } },
              h(
                'button',
                {
                  type: 'button',
                  'data-detail-more': 'true',
                  title: '更多操作',
                  'aria-haspopup': 'menu',
                  'aria-expanded': moreOpen,
                  onClick: () => setMoreOpen((value) => !value),
                  style: DETAIL_HEADER_ACTION,
                },
                '更多',
              ),
              moreOpen
                ? h(
                    'div',
                    { role: 'menu', style: { position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 8, background: T.layer2, border: `1px solid ${T.line2}`, borderRadius: '8px', padding: '4px', minWidth: '172px', boxShadow: '0 12px 32px rgba(0,0,0,.4)' } },
                    menuItems.map((entry) =>
                      h(
                        'button',
                        {
                          key: entry.id,
                          type: 'button',
                          role: 'menuitem',
                          'data-detail-more-item': entry.id,
                          onClick: () => {
                            setMoreOpen(false)
                            entry.onClick()
                          },
                          style: { display: 'block', width: '100%', textAlign: 'left', border: 0, background: 'transparent', color: T.text2, fontSize: '12px', padding: '7px 10px', borderRadius: '6px', cursor: 'pointer' },
                        },
                        entry.label,
                      ),
                    ),
                  )
                : null,
            ),
            h(
              'button',
              { type: 'button', 'data-drawer-close': 'true', title: '关闭（Esc）', 'aria-label': '关闭详情', onClick: onClose, style: { ...DETAIL_LINK, display: 'inline-flex', alignItems: 'center', padding: '2px' } },
              h(ActionIcon, { name: 'close', size: 14 }),
            ),
          ),
        ),
        h('h2', { id: titleId, style: { margin: 0, fontSize: '20px', lineHeight: 1.35, fontWeight: 600, color: T.text, overflowWrap: 'anywhere' } }, identity.title ?? requirementId),
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', fontSize: '12px', color: T.text3, minWidth: 0 } },
          h('span', { style: { color: T.text2, minWidth: 0, overflowWrap: 'anywhere' } }, [identity.owner || '未分配', identity.priority, identity.projectName || identity.project].filter(Boolean).join(' · ')),
          identity.updatedAt ? h('span', { title: '最近更新' }, `更新于 ${formatLocalStamp(identity.updatedAt)}`) : null,
          h('button', { type: 'button', 'aria-expanded': metaOpen, onClick: () => setMetaOpen((value) => !value), style: DETAIL_LINK }, metaOpen ? '收起详情' : '详情'),
          notice ? h('span', { role: 'status', 'data-detail-notice': 'true', style: { marginLeft: 'auto', color: T.text2, fontSize: '11.5px' } }, notice) : null,
        ),
        metaOpen
          ? h(
              'div',
              { 'data-detail-meta': 'true', style: { marginTop: '2px', paddingTop: '8px', borderTop: `1px solid ${T.line}`, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1px 18px' } },
              metaRows.map(([label, value]) => h(DetailRow, { key: label, label }, value)),
              technical.file
                ? h('div', { style: { marginTop: '6px', gridColumn: '1 / -1' } }, h(CopyTextButton, { value: technical.file, label: '复制源文件路径' }))
                : null,
            )
          : null,
      )
    }

    function CurrentTaskSummary({ detail, onQuestion, onJump }) {
      const context = detail.context ?? {}
      const tone = context.tone ?? 'neutral'
      const needsAttention = tone === 'attention' || tone === 'danger'
      const color = detailToneColor(tone)
      const question = context.question ?? null
      const relatedRefs = context.relatedRefs ?? []
      const secondary = question
        ? { label: '查看问题', run: onQuestion }
        : relatedRefs.length
          ? { label: relatedRefs[0].label ?? '查看详情', run: () => onJump(relatedRefs[0]) }
          : null
      const surface = needsAttention
        ? {
            padding: '12px 14px',
            borderLeft: `3px solid ${color}`,
            background: tone === 'danger' ? 'rgba(255,139,139,.06)' : 'rgba(231,176,75,.06)',
            borderRadius: '0 8px 8px 0',
          }
        : { padding: '0' }
      return h(
        'section',
        { 'data-detail-context': context.kind ?? 'unknown', 'data-tone': tone, 'aria-label': `当前待办：${context.headline ?? '状态未知'}`, style: { margin: needsAttention ? '12px 0 4px' : '14px 0 2px', minWidth: 0, ...surface } },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' } },
          h('h3', { style: { margin: 0, fontSize: '13px', fontWeight: 600, letterSpacing: '.01em', color: needsAttention ? color : T.text2 } }, context.headline ?? '当前待办'),
          secondary
            ? h('button', { type: 'button', 'data-detail-context-action': 'true', onClick: secondary.run, style: { marginLeft: 'auto', ...DETAIL_LINK } }, secondary.label)
            : null,
        ),
        h('p', { 'data-detail-focus-message': 'true', style: { margin: '4px 0 0', fontSize: '13px', lineHeight: 1.7, color: T.text2 } }, {
          answer: 'AI 需要你的决定，确认后继续推进。',
          'run-active': 'AI 正在执行。需要你决定时，会在这里提出。',
          'run-interrupted': 'AI 的推进已中断，可以恢复后继续。',
          'run-idle-handback': '这一轮已暂停，确认下一步后继续。',
          'acceptance-failed': '当前结果未通过验收。修复后需要重新验证。',
          'awaiting-acceptance': '交付已准备好，请核对结果并决定是否接受。',
          'needs-attention': '需求中存在尚未解决的问题，请处理后继续。',
          accepted: '你已接受这次交付，发布仍需单独决定。',
          released: '这次交付已发布，相关记录可随时查阅。',
          'run-rolled-back': '上一轮已回退，可以重新确认后启动。',
          'release-authorized': '已授权发布，尚未执行。',
          'release-failed': '发布未完成，请核对原因后再决定。',
          'candidate-pending': '接下来生成交付候选；仍需通过服务端门禁。',
          'not-started': '目标确认后，可交给 AI 推进。',
          closed: '这条需求已关闭，原始材料和记录仍可查阅。',
        }[context.kind] ?? context.headline ?? '状态尚未确认'),
        context.explanation && needsAttention && !question ? h('details', { 'data-detail-focus-reason': 'true', style: { marginTop: '6px', fontSize: '12px', lineHeight: 1.7, color: T.text2 } },
          h('summary', { style: { cursor: 'pointer' } }, '查看原因与处理依据'),
          h('p', { style: { margin: '6px 0 0', overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' } }, context.explanation),
        ) : null,
      )
    }

    function DetailTabs({ tab, onChange, badges }) {
      const refs = useRef({})
      const onKeyDown = (event) => {
        const index = DETAIL_TABS.findIndex((entry) => entry.id === tab)
        let next = null
        if (event.key === 'ArrowRight') next = (index + 1) % DETAIL_TABS.length
        else if (event.key === 'ArrowLeft') next = (index - 1 + DETAIL_TABS.length) % DETAIL_TABS.length
        else if (event.key === 'Home') next = 0
        else if (event.key === 'End') next = DETAIL_TABS.length - 1
        if (next === null || next === index) {
          if (next !== null) event.preventDefault()
          return
        }
        event.preventDefault()
        const id = DETAIL_TABS[next].id
        onChange(id)
        const node = refs.current[id]
        if (node && node.focus) node.focus()
      }
      return h(
        'div',
        {
          role: 'tablist',
          'aria-label': '详情分区',
          'data-detail-tabs': 'true',
          onKeyDown,
          style: { display: 'flex', gap: '2px', borderTop: `1px solid ${T.line}`, borderBottom: `1px solid ${T.line}`, margin: '10px 0 2px', position: 'sticky', top: 0, background: T.base, zIndex: 2, overflowX: 'auto', overflowY: 'hidden', overscrollBehaviorX: 'contain', touchAction: 'pan-x', scrollbarWidth: 'thin' },
        },
        DETAIL_TABS.map((entry) => {
          const selected = tab === entry.id
          const badge = Number(badges?.[entry.id] ?? 0)
          return h(
            'button',
            {
              key: entry.id,
              ref: (node) => {
                refs.current[entry.id] = node
              },
              type: 'button',
              role: 'tab',
              id: `detail-tab-${entry.id}`,
              'aria-controls': 'detail-panel',
              'aria-selected': selected,
              tabIndex: selected ? 0 : -1,
              'data-detail-tab': entry.id,
              'aria-label': badge > 0 ? `${entry.label}，${badge} 项待处理` : entry.label,
              onClick: () => onChange(entry.id),
              style: {
                border: 0,
                borderBottom: selected ? `2px solid ${T.text}` : '2px solid transparent',
                marginBottom: '-1px',
                background: 'transparent',
                cursor: 'pointer',
                padding: '10px 12px 9px',
                fontSize: '12.5px',
                fontWeight: selected ? 600 : 400,
                color: selected ? T.text : T.text2,
                display: 'inline-flex',
                flex: '0 0 auto',
                alignItems: 'center',
                gap: '6px',
              },
            },
            entry.label,
            badge > 0
              ? h('span', { 'data-detail-tab-badge': entry.id, style: { minWidth: '16px', height: '16px', borderRadius: '999px', padding: '0 5px', background: 'rgba(231,176,75,.16)', color: T.warn, fontSize: '10.5px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' } }, String(badge))
              : null,
          )
        }),
      )
    }

    function RequirementContent({ item, detail, onNavigate }) {
      const content = detail.content ?? {}
      const sections = content.sections ?? []
      const [casesOpen, setCasesOpen] = useState(false)
      const ordered = [
        ...sections.filter((section) => section.kind === 'claim'),
        ...sections.filter((section) => section.kind === 'constraint'),
        ...sections.filter((section) => section.kind === 'acceptance'),
        ...sections.filter((section) => section.kind === 'other'),
      ]
      const background = sections.filter((section) => section.kind === 'background' || section.kind === 'provenance')
      const aiSections = sections.filter((section) => section.kind === 'ai-suggestion')
      const acceptanceSections = ordered.filter((section) => section.kind === 'acceptance')
      const verifiedBy = content.verifiedBy ?? []
      const criteria = content.acceptanceCriteria ?? []
      const missing = content.missing ?? []
      const attachments = content.attachments ?? item?.attachmentFiles ?? []
      const aiReview = item?.aiReview ?? null
      // item.aiReview.adopted is the server's adoption record (an object in
      // query.mjs, historically a boolean); only its truthiness is meaningful
      // here. Never infer adoption from section titles.
      const adoption = aiReview?.adopted
      const adopted =
        adoption === true ||
        (adoption && typeof adoption === 'object') ||
        aiReview?.adoption?.valid === true
      return h(
        'div',
        { 'data-detail-content': 'requirement', style: { minWidth: 0 } },
        ordered.length
          ? ordered.map((section) => h(DetailBodySection, { key: section.id, section }))
          : h('p', { style: { ...DETAIL_SMALL, margin: '0 0 14px' } }, '尚未解析到可展示的正文。'),
        !acceptanceSections.length && criteria.length
          ? h(
              'div',
              { style: { margin: '0 0 14px' } },
              h('h4', { style: { margin: '0 0 3px', fontSize: '11.5px', fontWeight: 600, color: T.text3, letterSpacing: '.02em' } }, '验收要求'),
              criteria.map((criterion) =>
                h('div', { key: criterion.id, style: { display: 'flex', gap: '8px', fontSize: '12.5px', lineHeight: 1.65, color: T.text2, padding: '2px 0', minWidth: 0 } }, h('span', { style: { color: T.text3, flex: 'none' } }, criterion.id), h('span', { style: { minWidth: 0, overflowWrap: 'anywhere' } }, [criterion.title, criterion.text ? `：${criterion.text}` : ''].join(''))),
              ),
            )
          : null,
        h(
          'div',
          { style: { margin: '18px 0 0', paddingTop: '12px', borderTop: `1px solid ${T.line}` } },
          verifiedBy.length
            ? h(
                'div',
                null,
                h('button', { type: 'button', 'data-detail-cases-toggle': 'true', onClick: () => setCasesOpen((value) => !value), style: DETAIL_LINK }, casesOpen ? `收起关联用例（${verifiedBy.length}）` : `查看关联用例（${verifiedBy.length}）`),
                casesOpen
                  ? h(
                      'div',
                      null,
                      h('div', { style: { marginTop: '6px', display: 'flex', flexWrap: 'wrap', gap: '6px' } }, verifiedBy.map((id) => h(MetaChip, { key: id }, id))),
                      h('p', { style: { margin: '6px 0 0', ...DETAIL_SMALL } }, '关联用例（TEST-*）只表示覆盖关系，不等于执行通过；通过状态以验收结果为准。'),
                    )
                  : null,
              )
            : h('p', { style: DETAIL_SMALL }, '尚未关联验收用例（TEST-*）。'),
        ),
        missing.length
          ? h(
              'div',
              { 'data-detail-missing': 'true', style: { margin: '12px 0 0', padding: '8px 12px', borderLeft: `2px solid ${T.warn}`, background: 'rgba(231,176,75,.05)', borderRadius: '0 6px 6px 0', fontSize: '12px', lineHeight: 1.65, color: T.text2 } },
              h('div', null, `正文尚未明确：${missing.join('、')}。`),
              h('div', { style: { ...DETAIL_SMALL, marginTop: '2px' } }, '这里不会编造要求；可查看源文件补充，或先在列表页向 AI 澄清。'),
              onNavigate ? h('button', { type: 'button', onClick: () => onNavigate('record', 'record-technical'), style: { ...DETAIL_LINK, marginTop: '2px' } }, '查看源文件与技术信息') : null,
            )
          : null,
        background.length
          ? h(
              'details',
              { style: { marginTop: '18px', borderTop: `1px solid ${T.line}`, paddingTop: '10px' } },
              h('summary', { style: { cursor: 'pointer', fontSize: '12px', color: T.text2 } }, `背景与原始诉求（${background.length} 节）`),
              h('div', { style: { marginTop: '8px' } }, background.map((section) => h(DetailBodySection, { key: section.id, section }))),
            )
          : null,
        aiSections.length
          ? h(
              'details',
              { style: { marginTop: '10px' } },
              h('summary', { style: { cursor: 'pointer', fontSize: '12px', color: T.text2 } }, `AI 优化建议（${aiSections.length} 节 · ${adopted ? '已采纳' : '未采纳'} · 非事实来源）`),
              h('div', { style: { marginTop: '8px' } }, aiSections.map((section) => h(DetailBodySection, { key: section.id, section }))),
            )
          : null,
        attachments.length
          ? h(
              'div',
              { style: { marginTop: '18px', paddingTop: '12px', borderTop: `1px solid ${T.line}` } },
              h('h4', { style: { margin: '0 0 6px', fontSize: '11.5px', fontWeight: 600, color: T.text3, letterSpacing: '.02em' } }, '附件'),
              h(Attachments, { item }),
            )
          : null,
      )
    }

    function DeliveryWorkspace({ item, detail, root, onNavigate, onOpenDecision, onAcceptance, onSignoff, onRelease, onAiReview, onRehearsal, onCancelRun, onRefresh, onDefect, onTrace, onSnapshot, onDiff }) {
      const summaries = detail.summaries ?? {}
      const delivery = summaries.delivery ?? {}
      const run = summaries.run ?? {}
      const review = summaries.review ?? {}
      const acceptance = summaries.acceptance ?? {}
      const candidate = summaries.candidate ?? {}
      const defects = summaries.defects ?? {}
      const release = summaries.release ?? null
      const attention = (detail.attentionItems ?? []).filter((entry) => entry.kind !== 'defect-closed')
      const question = detail.context?.question ?? null
      const closed = delivery.key === 'closed'
      const showQuestion = Boolean(question) || run.awaitingAnswer === true
      // v5 的 detail-view 把评审摘要收进 summaries.aiReview；保留旧 review.ai 兼容。
      const ai = review.ai ?? summaries.aiReview ?? {}
      const ownDefect = defects.own ?? null
      const relatedDefects = defects.related ?? []
      const closedHistory = defects.closedHistory ?? []
      const acceptanceState = humanAcceptanceState(acceptance)
      const relationIds = relationRows(detail.record?.relations ?? [])
      const traceLink = h(TraceLink, { onClick: onTrace })
      return h(
        'div',
        { 'data-detail-content': 'delivery', style: { minWidth: 0 } },
        h('section', { 'data-delivery-outcome': 'true', style: { padding: '16px 0 8px' } },
          h('h3', { style: { margin: '0 0 12px', fontSize: '15px', fontWeight: 600 } }, '交付结果'),
          h(DetailRow, { label: '检查结果' }, h('span', { style: { color: acceptanceState.color } }, acceptanceState.label)),
          acceptance.current === false ? h('p', { style: { color: T.warn, fontSize: '12.5px', lineHeight: 1.7 } }, '已有验收结果已过期，不能作为本次交付依据。') : null,
          candidate.exists && candidate.current === false ? h('p', { style: { color: T.warn, fontSize: '12.5px', lineHeight: 1.7 } }, '交付内容发生变化，需要重新整理并验收。') : null,
          h(DetailRow, { label: '发布' }, release?.released ? '已发布' : release?.status === 'authorized' || release?.status === 'releasing' ? '已授权，尚未发布' : release?.status === 'failed' ? '发布失败' : '尚未发布'),
          run.failure?.message ? h('p', { role: 'status', style: { color: T.err, fontSize: '12.5px', lineHeight: 1.7 } }, run.failure.message) : null,
          h('p', { style: { ...DETAIL_SMALL, margin: '12px 0 0' } }, '这里保留完整技术记录。当前进展和下一步操作在页面上方。'),
        ),
        h(
          DetailBlock,
          {
            key: 'run',
            title: '运行与交付',
            sectionId: 'delivery-run',
            anchor: 'delivery-run',
            aside: h('span', { 'data-delivery': delivery.key ?? 'unknown', 'data-delivery-source': delivery.source ?? undefined, style: { fontSize: '11.5px', color: T.text2 } }, delivery.label ?? '—'),
          },
          h(
            'div',
            { style: { display: 'grid', gap: '1px' } },
            h(DetailRow, { label: '交付状态' }, delivery.reason ? `${delivery.label ?? '—'} · ${delivery.reason}` : delivery.label ?? '—'),
            h(DetailRow, { label: '运行' }, run.exists ? [run.id, run.label ?? run.status, run.phase].filter(Boolean).join(' · ') : '当前没有活动运行'),
            run.exists && run.lastActivityAt ? h(DetailRow, { label: '最后活动' }, formatLocalStamp(run.lastActivityAt)) : null,
            run.failure?.message ? h(DetailRow, { label: '失败原因' }, h('span', { style: { color: T.err } }, run.failure.message)) : null,
            candidate.exists ? h(DetailRow, { label: '交付候选' }, `${candidate.id ?? '候选'}${candidate.current === false ? '（非当前）' : candidate.current === null ? '（有效性未知）' : ''}`) : null,
          ),
          h(
            'div',
            { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px' } },
            h('button', { type: 'button', 'data-detail-secondary': 'refresh', onClick: () => onRefresh && onRefresh(), style: DETAIL_GHOST }, '刷新状态'),
          ),
        ),
        showQuestion
          ? h(
              'section',
              { key: 'question', 'data-detail-anchor': 'delivery-question', tabIndex: -1, style: { marginTop: '16px', padding: '12px 14px', borderLeft: `3px solid ${T.warn}`, background: 'rgba(231,176,75,.06)', borderRadius: '0 8px 8px 0' } },
              h(
                'div',
                { style: { display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' } },
                h('h3', { style: { margin: 0, fontSize: '12.5px', fontWeight: 600, color: T.warn } }, 'AI 正在等待你的回答'),
                h('button', { type: 'button', 'data-detail-question-open': 'true', onClick: onOpenDecision, style: { marginLeft: 'auto', ...DETAIL_GHOST } }, '查看问题与选项'),
              ),
              question?.title ? h('p', { style: { margin: '6px 0 0', fontSize: '13px', color: T.text } }, question.title) : h('p', { style: { margin: '6px 0 0', ...DETAIL_SMALL } }, '运行正在等待输入，但没有可读的决策摘要。'),
              h('p', { style: { margin: '8px 0 0', ...DETAIL_SMALL } }, '在决策面板核对问题和选项后回答。信息不完整时，可以要求 AI 补充；不会默认同意推荐方案。'),
            )
          : null,
        attention.length
          ? h(
              DetailBlock,
              { key: 'attention', title: '待处理事项', sectionId: 'delivery-attention', anchor: 'delivery-attention' },
              h(
                'div',
                { style: { display: 'grid', gap: '8px' } },
                attention.map((entry) => {
                  const hot = entry.current === true && entry.tone !== 'neutral'
                  const color = detailToneColor(entry.tone)
                  return h(
                    'div',
                    { key: entry.id, 'data-attention-item': entry.id ?? entry.kind, 'data-attention-tone': entry.tone ?? 'neutral', 'data-attention-current': entry.current === true ? 'true' : 'false', style: { padding: hot ? '8px 10px' : '4px 0', borderLeft: hot ? `2px solid ${color}` : 'none', background: hot ? (entry.tone === 'danger' ? 'rgba(255,139,139,.06)' : 'rgba(231,176,75,.06)') : 'transparent', borderRadius: hot ? '0 6px 6px 0' : 0, minWidth: 0 } },
                    h(
                      'div',
                      { style: { display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' } },
                      h('span', { style: { fontSize: '12.5px', fontWeight: 600, color: hot ? color : entry.tone === 'neutral' ? T.text3 : T.text } }, entry.title ?? entry.kind),
                      entry.current === true ? h('span', { style: { fontSize: '10.5px', color: T.text3 } }, '现在需要处理') : null,
                      entry.ref?.tab ? h('button', { type: 'button', onClick: () => onNavigate(entry.ref.tab, entry.ref.anchor), style: { marginLeft: 'auto', ...DETAIL_GHOST } }, '查看处理依据') : null,
                    ),
                    entry.detail ? h('p', { style: { margin: '2px 0 0', fontSize: '11.5px', lineHeight: 1.6, color: entry.tone === 'neutral' ? T.text3 : T.text2 } }, entry.detail) : null,
                  )
                }),
              ),
              h('p', { style: { margin: '8px 0 0', ...DETAIL_SMALL } }, '以上是交付记录中的真实状态；不改变规则，也不代表需求已完成。'),
            )
          : null,
        h(
          DetailBlock,
          { key: 'ai-suggestions', title: 'AI 优化建议', sectionId: 'delivery-ai-suggestions', anchor: 'delivery-ai-suggestions' },
          h('p', { style: DETAIL_SMALL }, 'AI 建议仅供参考，不是审批、验收或推进门禁；你可以显式采纳所选建议，也可以暂不采纳并继续。'),
          ai.stored
            ? h(
                'div',
                { 'data-review-ai': 'true', style: { marginTop: '8px', paddingTop: '8px', borderTop: `1px solid ${T.line}` } },
                h('div', { style: { fontSize: '12px', color: T.text2 } }, ['AI 优化建议已生成', ai.verdict ? `建议级别：${ai.verdict}` : null, ai.adopted ? '已应用所选建议' : '尚未应用建议'].filter(Boolean).join(' · ')),
                ai.suggestions?.length
                  ? h('ul', { style: { margin: '4px 0 0', paddingLeft: '18px', fontSize: '12px', lineHeight: 1.7, color: T.text2 } }, ai.suggestions.map((suggestion, index) => h('li', { key: index }, typeof suggestion === 'string' ? suggestion : suggestion?.text ?? suggestion?.title ?? '')))
                  : null,
                ai.generatedAt ? h('p', { style: { margin: '2px 0 0', ...DETAIL_SMALL } }, `生成于 ${formatLocalStamp(ai.generatedAt)}`) : null,
              )
            : h('p', { style: { ...DETAIL_SMALL, marginTop: '8px' } }, '尚未生成优化建议。'),
          h(
            'div',
            { style: { display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' } },
            onAiReview ? h('button', { type: 'button', 'data-detail-secondary': 'ai-review', onClick: () => onAiReview(item), style: DETAIL_GHOST }, ai.stored ? '重新生成优化建议' : 'AI 优化建议') : null,
            onRehearsal ? h('button', { type: 'button', 'data-detail-secondary': 'rehearsal', onClick: () => onRehearsal(item), style: DETAIL_GHOST }, '变更试演') : null,
          ),
        ),
        h(
          DetailBlock,
          { key: 'acceptance', title: '验收执行', sectionId: 'delivery-acceptance', anchor: 'delivery-acceptance', aside: h('span', { style: { fontSize: '12px', color: acceptanceState.color } }, acceptanceState.label) },
          h(
            'div',
            { style: { display: 'grid', gap: '1px' } },
            h(DetailRow, { label: '结果' }, acceptanceState.label),
            h(DetailRow, { label: '是否适用' }, acceptance.current === true ? '适用于当前候选' : acceptance.current === false ? '已不适用于当前候选（证据过期）' : '无法判定'),
            acceptance.finishedAt ? h(DetailRow, { label: '最近执行' }, formatLocalStamp(acceptance.finishedAt)) : null,
            acceptance.commandCount ? h(DetailRow, { label: '命令' }, `${acceptance.commandCount} 条`) : null,
            acceptance.headShaShort ? h(DetailRow, { label: 'HEAD' }, acceptance.headShaShort) : null,
            acceptance.environment ? h(DetailRow, { label: '环境' }, acceptance.environment) : null,
            acceptance.provenance?.commandIds?.length ? h(DetailRow, { label: '执行命令' }, acceptance.provenance.commandIds.join(' · ')) : null,
            acceptance.provenance?.ruleCodes?.length ? h(DetailRow, { label: '规则码' }, acceptance.provenance.ruleCodes.join(' · ')) : null,
            acceptance.provenance?.evidencePath ? h(DetailRow, { label: '证据文件' }, acceptance.provenance.evidencePath) : null,
          ),
          acceptance.provenance?.headSha || acceptance.headSha
            ? h(
                'details',
                { style: { marginTop: '8px' } },
                h('summary', { style: { cursor: 'pointer', fontSize: '11.5px', color: T.text3 } }, '完整证据 hash 与记录'),
                h('div', { style: { marginTop: '4px' } }, h(DetailRow, { label: '完整 HEAD' }, acceptance.headSha ?? acceptance.provenance.headSha), acceptance.provenance?.evidencePath ? h(DetailRow, { label: '证据文件' }, acceptance.provenance.evidencePath) : null),
              )
            : null,
          onAcceptance && !closed ? h('div', { style: { marginTop: '10px' } }, h('button', { type: 'button', 'data-detail-secondary': 'acceptance', onClick: () => onAcceptance(item), style: DETAIL_GHOST }, acceptance.registered ? '重新运行验收' : '运行验收')) : null,
        ),
        ownDefect || relatedDefects.length || closedHistory.length
          ? h(
              DetailBlock,
              { key: 'defects', title: '缺陷关系', sectionId: 'delivery-defects', anchor: 'delivery-defects' },
              ownDefect
                ? h(
                    'div',
                    { 'data-defect-own': 'true', style: { padding: '4px 0' } },
                    h(
                      'div',
                      { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
                      h('span', { style: { fontSize: '12px', color: T.text2 } }, ownDefect.id),
                      h('span', { style: { fontSize: '11.5px', color: ownDefect.closed ? T.text3 : T.warn } }, ownDefect.statusLabel ?? ownDefect.status ?? '—'),
                      ownDefect.regressionSuspected ? h('span', { style: { fontSize: '11px', color: T.warn } }, '疑似回归') : null,
                      ownDefect.occurrenceCount ? h('span', { style: { fontSize: '11px', color: T.text3 } }, `出现 ${ownDefect.occurrenceCount} 次`) : null,
                    ),
                    ownDefect.closed
                      ? h('p', { style: { margin: '2px 0 0', ...DETAIL_SMALL } }, '缺陷已关闭，仅作历史记录；不代表需求完成或未完成。')
                      : onDefect
                        ? h('button', { type: 'button', onClick: () => onDefect(item), style: { ...DETAIL_GHOST, marginTop: '6px' } }, '处理缺陷')
                        : null,
                  )
                : null,
              relatedDefects.length
                ? h(
                    'div',
                    { style: { marginTop: '8px' } },
                    h('div', { style: { fontSize: '11.5px', color: T.text3 } }, '相关缺陷'),
                    relatedDefects.map((defect) => h('div', { key: defect.id ?? defect, 'data-defect-related': defect.id ?? defect, style: { fontSize: '12px', color: T.text2, padding: '2px 0' } }, `${defect.id ?? defect}${defect.statusLabel ? ' · ' + defect.statusLabel : ''}`)),
                  )
                : null,
              closedHistory.length
                ? h(
                    'details',
                    { 'data-defect-closed-history': 'true', style: { marginTop: '8px' } },
                    h('summary', { style: { cursor: 'pointer', fontSize: '11.5px', color: T.text3, lineHeight: 1.7 } }, `已关闭缺陷（历史 ${closedHistory.length}）`),
                    closedHistory.map((defect) => h('div', { key: defect.id ?? defect, style: { fontSize: '11.5px', color: T.text3, padding: '2px 0' } }, `${defect.id ?? defect}${defect.statusLabel ? ' · ' + defect.statusLabel : ''}${defect.closedAt ? ' · ' + formatLocalStamp(defect.closedAt) : ''}`)),
                  )
                : null,
            )
          : null,
        h(
          DetailBlock,
          { key: 'candidate', title: '交付候选', sectionId: 'delivery-candidate', anchor: 'delivery-candidate', aside: candidate.exists ? h('span', { style: { fontSize: '11.5px', color: candidate.current === true ? T.ok : T.warn } }, candidate.current === true ? '当前候选' : candidate.current === false ? '已过期' : '有效性未知') : null },
          candidate.exists
            ? h(
                'div',
                { style: { display: 'grid', gap: '1px' } },
                h(DetailRow, { label: '候选' }, candidate.id ?? '—'),
                candidate.treeHashShort ? h(DetailRow, { label: '树哈希' }, candidate.treeHashShort) : null,
                candidate.architecture?.path ? h(DetailRow, { label: '工程档案' }, `已归档：${candidate.architecture.path}`) : null,
                candidate.development?.pushedToRemoteDev ? h(DetailRow, { label: '开发分支' }, `🌿 开发分支已同步：已提交并推送至 origin/${candidate.development.devBranch ?? 'develop'}（Commit: ${(candidate.development.devCommitSha ?? '').slice(0, 7)}）· 架构与数据档案已归档`) :
                  candidate.development?.reason ? h(DetailRow, { label: '开发分支' }, `未自动同步：${candidate.development.reason}`) : null,
                candidate.reasons?.length ? h(DetailRow, { label: '说明' }, candidate.reasons.join('；')) : null,
              )
            : h(
                'div',
                null,
                h('p', { style: DETAIL_SMALL }, '尚未生成交付候选；候选绑定当前需求内容与工作区快照。'),
                h(
                  'button',
                  {
                    type: 'button',
                    'data-create-candidate': 'true',
                    disabled: isExecutingRequirement(item) || closed,
                    title: isExecutingRequirement(item) ? 'AI 正在推进，结束后才能生成交付候选' : undefined,
                    style: { ...DETAIL_GHOST, marginTop: '6px' },
                    onClick: () => {
                      writeJson('candidate', { requirementId: item.id }, root)
                        .then(() => onRefresh && onRefresh())
                        .catch((error) => window.alert('生成交付候选失败：' + error.message))
                    },
                  },
                  '生成交付候选',
                ),
              ),
        ),
        h(
          DetailBlock,
          { key: 'release', title: '发布', sectionId: 'delivery-release', anchor: 'delivery-release', aside: release?.exists ? h('span', { style: { fontSize: '11.5px', color: release.released ? T.ok : T.text2 } }, release.label ?? release.status ?? '—') : null },
          release?.exists
            ? h(
                'div',
                { style: { display: 'grid', gap: '1px' } },
                h(DetailRow, { label: '状态' }, release.label ?? release.status ?? '—'),
                release.id ? h(DetailRow, { label: '发布记录' }, release.id) : null,
                !release.released && delivery.key === 'accepted' ? h('p', { style: { margin: '4px 0 0', ...DETAIL_SMALL } }, '验收已通过；发布决定在底部执行。') : null,
              )
            : h('p', { style: DETAIL_SMALL }, '尚未发布。'),
        ),
        h(
          DetailBlock,
          { key: 'trace', title: '证据与追溯', sectionId: 'delivery-trace', anchor: 'delivery-trace' },
          h('p', { style: { margin: '0 0 8px', ...DETAIL_SMALL } }, '追溯需求、运行、候选、验收与评审之间的证据链；只读查看。'),
          traceLink,
          relationIds.length ? h('p', { style: { margin: '6px 0 0', ...DETAIL_SMALL } }, `已登记归属：${relationIds.map((entry) => entry.label).join(' · ')}`) : null,
        ),
      )
    }

    function RunHistory({ root, requirementId, onOpenRun }) {
      const [storedState, setState] = useState(null)
      const state = storedState?.root === root && storedState?.requirementId === requirementId ? storedState : { loading: true, runs: [], error: false, next: null }
      const loadMore = useRef(null)
      useEffect(() => {
        const controller = new AbortController()
        let cursor = null, busy = false
        setState({ root, requirementId, loading: true, runs: [], error: false, next: null })
        const load = async () => {
          if (busy || controller.signal.aborted) return
          busy = true
          setState(previous => ({ ...previous, loading: true, error: false }))
          const requestController = new AbortController()
          const cancelRequest = () => requestController.abort()
          controller.signal.addEventListener('abort', cancelRequest, { once: true })
          let timeout
          try {
            const params = new URLSearchParams({ root: root ?? '', requirementId, mode: 'history' })
            if (cursor) params.set('before', cursor)
            const { response, data } = await Promise.race([
              fetch(`/api/alm/requirements/run-observation?${params}`, { headers: { accept: 'application/json' }, signal: requestController.signal }).then(async response => ({ response, data: await response.json() })),
              new Promise((_, reject) => { timeout = setTimeout(() => { cancelRequest(); reject(new Error('history timeout')) }, 10000) }),
            ])
            if (!response.ok) throw new Error('unavailable')
            if (!Array.isArray(data.runs) || data.runs.some(run => !run || typeof run.id !== 'string' || !run.id.trim()) || (data.next !== null && (typeof data.next !== 'string' || !data.next || data.next === cursor))) throw new Error('invalid')
            if (controller.signal.aborted) return
            cursor = data.next
            setState(previous => {
              const runs = new Map(previous.runs.map(run => [run.id, run]))
              for (const run of data.runs) if (!runs.has(run.id)) runs.set(run.id, run)
              return { root, requirementId, loading: false, runs: [...runs.values()], error: false, next: data.next }
            })
          } catch { if (!controller.signal.aborted) setState(previous => ({ ...previous, loading: false, error: true })) }
          finally { clearTimeout(timeout); controller.signal.removeEventListener('abort', cancelRequest); busy = false }
        }
        loadMore.current = load
        void load()
        return () => { controller.abort(); loadMore.current = null }
      }, [root, requirementId])
      const labels = { queued: '排队', running: '运行中', 'waiting-input': '等待输入', paused: '暂停', failed: '失败', done: '结束', cancelled: '已取消' }
      return h('section', { 'aria-label': '运行历史', style: { borderTop: `1px solid ${T.line}`, marginTop: '18px', paddingTop: '14px' } },
        h('h3', { style: { fontSize: '15px', margin: '0 0 8px' } }, '运行历史'),
        state.loading ? h('p', { role: 'status', style: DETAIL_SMALL }, '正在读取运行历史…') : null,
        state.error ? h('div', { role: 'alert', style: DETAIL_SMALL }, '运行历史暂不可用。 ', h('button', { type: 'button', style: DETAIL_LINK, onClick: () => loadMore.current?.() }, '重试')) : null,
        !state.loading && !state.error && !state.runs.length ? h('p', { style: DETAIL_SMALL }, '暂无运行记录。') : null,
        state.runs.length ? h('ol', { style: { margin: 0, paddingLeft: '20px' } }, state.runs.map(run => h('li', { key: run.id, style: { padding: '6px 0', color: T.text2, fontSize: '13px' } },
          h('span', null, `${run.id} · ${labels[run.status] ?? '状态未知'}${run.createdAt ? ` · ${formatLocalStamp(run.createdAt)}` : ''}`), ' ',
          h('button', { type: 'button', style: DETAIL_LINK, onClick: () => onOpenRun(run.id), 'aria-label': `查看运行 ${run.id}` }, '查看运行'),
        ))) : null,
        state.next && !state.error ? h('button', { type: 'button', style: DETAIL_LINK, disabled: state.loading, onClick: () => loadMore.current?.() }, '加载更多运行') : null,
      )
    }

    function VisualSpecDiff({ delta }) {
      const before = Array.isArray(delta.acceptanceCriteria?.before) ? delta.acceptanceCriteria.before : []
      const after = Array.isArray(delta.acceptanceCriteria?.after) ? delta.acceptanceCriteria.after : []
      const desc = entry => typeof entry === 'string' ? entry : String(entry?.text ?? entry?.label ?? entry?.expected ?? '')
      const key = (entry, index) => entry?.id || `AC-${String(index + 1).padStart(2, '0')}`
      const left = new Map(before.map((entry, i) => [key(entry, i), desc(entry)]))
      const right = new Map(after.map((entry, i) => [key(entry, i), desc(entry)]))
      const changes = []
      for (const [id, text] of right) if (!left.has(id)) changes.push({ type: 'added', id, after: text }); else if (left.get(id) !== text) changes.push({ type: 'modified', id, before: left.get(id), after: text })
      for (const [id, text] of left) if (!right.has(id)) changes.push({ type: 'removed', id, before: text })
      const fields = [['title', '标题'], ['goal', '预期变化'], ['problem', '解决什么问题']].flatMap(([field, label]) => {
        const a = delta.beforeDocument?.[field], b = delta.afterDocument?.[field]
        return typeof a === 'string' && typeof b === 'string' && a !== b ? [{ label, before: a, after: b }] : []
      })
      const count = type => changes.filter(entry => entry.type === type).length + (type === 'modified' ? fields.length : 0)
      const box = (label, value, color) => h('div', { style: { borderLeft: `3px solid ${color}`, padding: '6px 10px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', background: T.layer } }, h('strong', null, label), ' ', value || '—')
      return h('div', { 'data-visual-spec-diff': 'true', style: { margin: '10px 0', padding: '12px', border: `1px solid ${T.line}`, borderRadius: '8px' } },
        h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' } }, h('strong', null, `版本对比${delta.beforeRevision && delta.revision ? ` (v${delta.beforeRevision} → v${delta.revision})` : ''}`), h('span', { style: { color: T.ok } }, `+${count('added')} 新增`), h('span', { style: { color: T.warn } }, `~${count('modified')} 修改`), h('span', { style: { color: T.err } }, `-${count('removed')} 移除`)),
        fields.map(field => h('div', { key: field.label, style: { marginBottom: '10px' } }, h('strong', null, field.label), box('修改前：', field.before, T.err), box('修改后：', field.after, T.ok))),
        changes.map(change => h('div', { key: change.id, style: { borderLeft: `3px solid ${change.type === 'added' ? T.ok : change.type === 'removed' ? T.err : T.warn}`, padding: '8px 10px', margin: '6px 0', background: T.layer, overflowWrap: 'anywhere' } }, h('strong', { style: { color: change.type === 'added' ? T.ok : change.type === 'removed' ? T.err : T.warn } }, `${change.type === 'added' ? '+ 新增' : change.type === 'removed' ? '- 移除' : '~ 修改'} ${change.id}`), change.type === 'modified' ? h('div', null, box('修改前：', change.before, T.err), box('修改后：', change.after, T.ok)) : h('div', { style: { textDecoration: change.type === 'removed' ? 'line-through' : 'none' } }, change.after ?? change.before))),
        !fields.length && !changes.length ? h('p', { style: DETAIL_SMALL }, '本次未记录可展示的需求或验收变更。') : null,
      )
    }

    function timelineStyle(entry) {
      if (['candidate', 'human-signoff', 'release'].includes(entry.kind)) return { color: T.ok, label: entry.kind === 'candidate' ? '交付候选' : entry.kind === 'human-signoff' ? '人工签收' : '发布归档' }
      if (entry.kind === 'spec_converged') return { color: T.brand, label: entry.title?.match(/v\d+\s*→\s*v\d+/u)?.[0] ?? '版本演进' }
      return { color: T.text3, label: entry.kind === 'run' ? '启动推进' : entry.kind === 'created' ? '创建需求' : '记录' }
    }

    function CollectedTimeline({ root, requirementId, record, onNavigate, onRefresh }) {
      const [state, setState] = useState({ older: [], next: record.timelineOmitted ?? 0, loading: false, error: null, loaded: 0 })
      const controllerRef = useRef(null)
      const recordRef = useRef(record)
      useEffect(() => () => { const controller = controllerRef.current; controllerRef.current = null; controller?.abort() }, [])
      useEffect(() => {
        if (recordRef.current === record) return
        recordRef.current = record
        const controller = controllerRef.current
        controllerRef.current = null
        controller?.abort()
        setState({ older: [], next: record.timelineOmitted ?? 0, loading: false, error: null, loaded: 0 })
      }, [record])
      const load = async () => {
        if (state.loading || !state.next || state.error === 'changed' || controllerRef.current) return
        const controller = new AbortController()
        controllerRef.current = controller
        setState(previous => ({ ...previous, loading: true, error: null }))
        let timeout
        try {
          const params = new URLSearchParams({ root: root ?? '', requirementId, mode: 'timeline', before: String(state.next), fingerprint: record.timelineFingerprint ?? '' })
          const { response, data } = await Promise.race([
            fetch(`/api/alm/requirements/run-observation?${params}`, { headers: { accept: 'application/json' }, signal: controller.signal }).then(async response => ({ response, data: await response.json() })),
            new Promise((_, reject) => { timeout = setTimeout(() => { controller.abort(); reject(new Error('timeout')) }, 10000) }),
          ])
          if (response.status === 409) throw new Error('changed')
          if (!response.ok || data.fingerprint !== record.timelineFingerprint || !Array.isArray(data.entries) || !data.entries.length || data.entries.some(entry => !entry || typeof entry.at !== 'string' || typeof entry.kind !== 'string') || (data.next !== null && (!Number.isSafeInteger(data.next) || data.next < 1 || data.next >= state.next)) || data.entries.length !== state.next - (data.next ?? 0)) throw new Error('invalid')
          if (!controller.signal.aborted) setState(previous => ({ older: [...data.entries, ...previous.older], next: data.next, loading: false, error: null, loaded: data.entries.length }))
        } catch (error) {
          if (controllerRef.current === controller) setState(previous => ({ ...previous, loading: false, error: error?.message === 'changed' ? 'changed' : 'unavailable' }))
        } finally { clearTimeout(timeout); if (controllerRef.current === controller) controllerRef.current = null }
      }
      const timeline = [...state.older, ...(record.timeline ?? [])]
      return h(DetailBlock, { title: '版本演进与事件时间线', sectionId: 'record-timeline', anchor: 'record-timeline' },
        state.error ? h('p', { role: 'alert', style: DETAIL_SMALL }, state.error === 'changed' ? '时间线已变化，请刷新需求后重新读取。' : '较早事件暂不可用，请重试。') : null,
        (state.error === 'changed' || (state.next && !record.timelineFingerprint)) && onRefresh ? h('button', { type: 'button', style: DETAIL_LINK, onClick: onRefresh }, '刷新需求') : null,
        h('p', { role: 'status', 'aria-live': 'polite', style: { ...DETAIL_SMALL, margin: state.loading || (!state.error && state.loaded) ? '6px 0' : 0 } }, state.loading ? '正在读取较早事件…' : !state.error && state.loaded ? `已读取 ${state.loaded} 条较早事件。` : ''),
        state.next && !record.timelineFingerprint ? h('p', { style: DETAIL_SMALL }, `另有 ${state.next} 条较早事件；请刷新需求后读取。`) : null,
        record.timelineOmitted > 0 && record.timelineFingerprint ? h('button', { type: 'button', style: { ...DETAIL_LINK, cursor: state.loading || !state.next || state.error === 'changed' ? 'not-allowed' : 'pointer' }, 'aria-disabled': state.loading || !state.next || state.error === 'changed', onClick: load }, state.loading ? '读取中…' : state.error === 'changed' ? '请刷新需求后读取' : state.next ? `加载较早事件（剩余 ${state.next} 条）` : '已显示全部已收集事件') : null,
        timeline.length ? h('div', { 'data-version-timeline': 'true', style: { position: 'relative', margin: '12px 0 0 8px', paddingLeft: '18px', borderLeft: `1px solid ${T.line}`, display: 'grid', gap: '14px' } }, [...timeline].reverse().map((entry, index) => {
          const appearance = timelineStyle(entry)
          return h('article', { key: `${entry.at ?? 'event'}-${index}`, style: { position: 'relative', fontSize: '12px', color: T.text2, lineHeight: 1.6, minWidth: 0 } },
            h('span', { 'aria-hidden': 'true', style: { position: 'absolute', left: '-24px', top: '5px', width: '10px', height: '10px', borderRadius: '50%', background: appearance.color, boxShadow: `0 0 0 3px ${T.bg ?? T.layer}` } }),
            h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } }, h('span', { style: { color: appearance.color, background: T.layer2, border: `1px solid ${appearance.color}`, borderRadius: '999px', padding: '1px 7px', fontSize: '11px', fontWeight: 600 } }, appearance.label), h('time', { dateTime: entry.at, style: { color: T.text3, fontSize: '11px', flex: 'none' } }, formatLocalStamp(entry.at))),
            h('div', { style: { color: T.text, marginTop: '3px', fontWeight: 600, overflowWrap: 'anywhere' } }, entry.title ?? entry.kind ?? '事件'),
            entry.detail ? h('div', { style: { color: T.text3, fontSize: '11.5px', marginTop: '3px', overflowWrap: 'anywhere' } }, entry.detail) : null,
            entry.specDelta ? h('details', { style: { marginTop: '7px' } }, h('summary', { style: { cursor: 'pointer' } }, '查看需求与验收变更'), h(VisualSpecDiff, { delta: entry.specDelta })) : null,
          )
        })) : h('p', { style: DETAIL_SMALL }, '暂无历史记录。'),
      )
    }

    function RequirementRecord({ item, detail, allItems, projectMeta, root, onSnapshot, onDiff, onTrace, onNavigate, onOpenRun, onRefresh }) {
      const record = detail.record ?? {}
      const relations = relationRows((record.relations ?? []).length ? record.relations : relationsOf(item, allItems)).filter(entry => entry.ids?.length)
      const github = record.github
      const defects = detail.summaries?.defects ?? {}
      const hasDefects = defects.own || defects.related?.length || defects.closedHistory?.length
      const evidence = Array.isArray(item.investigationEvidence) ? item.investigationEvidence : []
      const fingerprint = String(item.docMeta?.docHash ?? '').replace(/^sha256:/, '').slice(0, 8)
      return h('div', { 'data-detail-content': 'record', style: { minWidth: 0 } },
        h(CollectedTimeline, { key: `${item.root ?? root}:${item.id}:${record.timelineFingerprint ?? ''}`, root: item.root ?? root, requirementId: item.id, record, onNavigate, onRefresh }),
        relations.length ? h(DetailBlock, { title: '归属关系', sectionId: 'record-relations' }, relations.map(entry => h(DetailRow, { key: entry.label, label: entry.label }, entry.ids.join('、')))) : null,
        github && (github.issue || github.url || github.board || github.tasks) ? h(DetailBlock, { title: 'GitHub', sectionId: 'record-github' }, github.issue ? h(DetailRow, { label: 'Issue' }, github.issue) : null, github.url ? h(DetailRow, { label: '链接' }, safeHttpHref(github.url) ? h('a', { href: github.url, target: '_blank', rel: 'noreferrer' }, github.url) : github.url) : null, github.board ? h(DetailRow, { label: '看板' }, github.board) : null) : null,
        hasDefects ? h(DetailBlock, { title: '缺陷记录', sectionId: 'record-defects' }, [defects.own, ...(defects.related ?? []), ...(defects.closedHistory ?? [])].filter(Boolean).map((defect, index) => h(DetailRow, { key: index, label: '缺陷' }, `${defect.id ?? defect}${defect.statusLabel ? ' · ' + defect.statusLabel : ''}`))) : null,
        h('details', { style: { marginTop: '24px', color: T.text2 } },
          h('summary', { style: { cursor: 'pointer' } }, '调查证据与技术诊断'),
          evidence.length ? h('ul', { style: { paddingLeft: '20px', lineHeight: 1.8, overflowWrap: 'anywhere' } }, evidence.map((ref, index) => h('li', { key: index }, [ref.investigationId, ref.path + (ref.line ? `:${ref.line}${ref.endLine && ref.endLine !== ref.line ? `–${ref.endLine}` : ''}` : '')].filter(Boolean).join(' · ')))) : h('p', { style: DETAIL_SMALL }, '暂无调查证据。'),
          fingerprint ? h('p', { style: DETAIL_SMALL }, `内容指纹：${fingerprint}`) : null,
          onTrace ? h(TraceLink, { onClick: onTrace }) : null,
        ),
      )
    }

    function ContextActionFooter({ detail, onNavigate, handlers, startIsolate, onToggleIsolate, narrow }) {
      const action = detail.primaryAction ?? null
      const context = detail.context ?? {}
      const startLike = Boolean(action && (action.id === 'start' || action.id === 'start-fix'))
      const secondary = (detail.secondaryActions ?? []).filter((entry) => entry && entry.id !== action?.id).slice(0, 2)
      const enabled = Boolean(action) && action.enabled !== false
      const runEntry = (entry) => {
        if (!entry || entry.enabled === false) return
        const fn = handlers[entry.id]
        if (fn) fn(entry)
      }
      return h(
        'footer',
        { 'data-detail-footer': 'true', style: { flex: 'none', borderTop: `1px solid ${T.line}`, background: T.base, padding: narrow ? '9px 16px 10px' : '10px 24px 11px' } },
        h(
          'div',
          { style: { maxWidth: '720px', margin: '0 auto', display: 'flex', flexDirection: narrow ? 'column' : 'row', alignItems: narrow ? 'stretch' : 'center', gap: '10px', flexWrap: 'wrap', minWidth: 0 } },
          h(
            'div',
            { style: { flex: narrow ? 'none' : '1 1 200px', minWidth: 0 } },
            h('div', { style: { fontSize: '11.5px', color: T.text3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, context.headline ? `当前：${context.headline}` : '当前状态未知'),
            action && enabled === false && action.reason ? h('div', { style: { fontSize: '11px', color: T.text3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, action.reason) : null,
          ),
          secondary.length
            ? h(
                'div',
                { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', flex: 'none', justifyContent: narrow ? 'flex-start' : 'flex-end' } },
                secondary.map((entry) =>
                  h(
                    'button',
                    { key: entry.id, type: 'button', disabled: entry.enabled === false, title: entry.reason ?? entry.label ?? entry.id, 'data-detail-secondary': entry.id, onClick: () => runEntry(entry), style: { ...DETAIL_LINK, opacity: entry.enabled === false ? 0.5 : 1 } },
                    entry.label ?? entry.id,
                  ),
                ),
              )
            : null,
          startLike
            ? h(
                'label',
                { 'data-detail-launch-config': 'true', title: '隔离 worktree：在独立工作区开发，不改动主工作区', style: { display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '11.5px', color: T.text3, cursor: 'pointer', flex: 'none' } },
                h('input', { type: 'checkbox', checked: startIsolate, onChange: (event) => onToggleIsolate(event.target.checked) }),
                '启动配置：在独立工作区开发',
              )
            : null,
          action
            ? h('button', { type: 'button', 'data-primary-action': action.id, disabled: !enabled, title: enabled ? action.label ?? '' : action.reason ?? action.label ?? '', onClick: () => runEntry(action), style: { ...DETAIL_PRIMARY, width: narrow ? '100%' : undefined, opacity: enabled ? 1 : 0.55, cursor: enabled ? 'pointer' : 'not-allowed' } }, action.label ?? '继续')
            : h('span', { 'data-primary-action-none': 'true', style: { fontSize: '11.5px', color: T.text3 } }, context.kind === 'closed' ? '已关闭：没有可推进的动作' : '当前没有可执行的动作'),
        ),
        h('div', { 'data-detail-disclaimer': 'true', style: { maxWidth: '720px', margin: narrow ? '8px auto 0' : '4px auto 0', fontSize: '10.5px', color: T.text3, lineHeight: 1.6, overflowWrap: 'anywhere' } }, 'AI 产出需人工核对；版本、授权与证据以服务端校验为准。'),
      )
    }

    function DecisionTextModal({ item, root, onClose }) {
      const [state, setState] = useState({ loading: true, text: null, decision: null, error: null })
      useEffect(() => {
        let alive = true
        writeJson('run', { mode: 'decision', requirementId: item.id }, root).then(
          (payload) => {
            if (!alive) return
            setState({ loading: false, text: payload?.text ?? payload?.result?.text ?? null, decision: payload?.decision ?? payload?.result?.decision ?? null, error: null })
          },
          (error) => {
            if (!alive) return
            setState({ loading: false, text: null, decision: null, error: error?.message ?? '读取失败' })
          },
        )
        return () => {
          alive = false
        }
      }, [item.id, root])
      return h(
        ModalShell,
        { title: `决策请求原文 · ${item.id}`, lead: '只读：这里不会提交回答，也不会恢复运行。', onClose, feedbackContext: feedbackContextFor(item), width: '780px', footer: h('button', { type: 'button', onClick: onClose, style: DETAIL_GHOST }, '关闭') },
        state.loading
          ? h('p', { style: DETAIL_SMALL }, '正在读取决策请求…')
          : state.error
            ? h('p', { style: { margin: 0, fontSize: '12.5px', color: T.err } }, `读取失败：${state.error}`)
            : [
                state.decision ? h('p', { key: 'decision', style: { margin: '0 0 8px', fontSize: '12px', color: T.text3 } }, `决策请求：${state.decision}`) : null,
                state.text
                  ? h('pre', { key: 'text', style: { margin: 0, padding: '10px 12px', border: `1px solid ${T.line}`, borderRadius: '8px', background: T.layer, color: T.text2, fontSize: '12px', lineHeight: 1.7, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: '52vh', overflow: 'auto' } }, state.text)
                  : h('p', { key: 'none', style: DETAIL_SMALL }, '没有找到决策请求原文。'),
              ],
      )
    }

    function InlineRequirementEditor({ item, root, onDone, onCancel, onDirty }) {
      const [draft, setDraft] = useState({ title: item.title ?? '', brief: item.briefText ?? '' })
      const [state, setState] = useState({ busy: false, error: null, preview: null })
      const [key] = useState(() => `inline-${item.id}-${Date.now().toString(36)}`)
      const changes = ['title', 'brief'].filter((field) => draft[field] !== (field === 'title' ? item.title ?? '' : item.briefText ?? '')).map((field) => ({ field, value: draft[field] }))
      useEffect(() => { onDirty?.(changes.length > 0) }, [draft])
      const preview = async () => {
        setState({ busy: true, error: null, preview: null })
        try { const result = await writeJson('rehearsal', { requirementId: item.id, changes }, root); setState({ busy: false, error: null, preview: result }) }
        catch (error) { setState({ busy: false, error: error.message, preview: null }) }
      }
      const save = async () => {
        if (!state.preview || state.busy) return
        setState((current) => ({ ...current, busy: true, error: null }))
        try {
          const result = await writeJson('rehearsal', { requirementId: item.id, changes, apply: true, expectedBaseline: state.preview.baseline, actor: 'human:local', idempotencyKey: key }, root)
          if (result.applied === false) throw new Error(result.message ?? '尚未保存，请检查变更')
          onDirty?.(false); onDone?.()
        } catch (error) { setState({ busy: false, preview: null, error: `未保存：${error.message}。草稿已保留，请重新预览当前基线。` }) }
      }
      return h('section', { 'aria-label': '编辑需求', style: { margin: '24px 0' } },
        ...[['title', '标题'], ['brief', '原始诉求与背景']].map(([field, label]) => h('label', { key: field, style: { display: 'block', marginBottom: '16px' } }, label,
          h(field === 'brief' ? 'textarea' : 'input', { name: `requirement-${field}`, autoComplete: 'off', style: { ...input, display: 'block', width: '100%', marginTop: '6px', ...(field === 'brief' ? { minHeight: '220px', lineHeight: 1.6 } : {}) }, value: draft[field], disabled: state.busy, onChange: (event) => { setDraft((current) => ({ ...current, [field]: event.target.value })); setState({ busy: false, error: null, preview: null }) } }))),
        state.error ? h('p', { role: 'alert', tabIndex: -1, ref: (node) => node?.focus?.(), style: { color: T.err } }, state.error) : null,
        state.preview ? h('div', null, h('p', null, '保存会使相关验收证据失效，需要重新验证；不会自动验收或发布。'), ...changes.map((change) => h('section', { key: change.field, style: { marginBottom: '16px' } }, h('strong', null, change.field === 'title' ? '标题变更' : '背景变更'), h('div', { style: { whiteSpace: 'pre-wrap', color: T.text3 } }, `原：${change.field === 'title' ? item.title : item.briefText ?? ''}`), h('div', { style: { whiteSpace: 'pre-wrap' } }, `新：${change.value}`)))) : null,
        h('div', { style: { display: 'flex', gap: '8px' } }, h('button', { style: primary, disabled: state.busy || !changes.length, onClick: state.preview ? save : preview }, state.busy ? '处理中…' : state.preview ? '确认保存' : '预览变更'), h('button', { style: button, disabled: state.busy, onClick: onCancel }, '取消编辑')),
      )
    }

    // Reading projection only: the original document, execution prompt and
    // acceptance rules retain their complete content and identities.
    function humanDescriptionBlocks(model) {
      const doc = model?.doc ?? {}
      if (model?.displaySections?.length) return model.displaySections
      const blocks = []
      const seen = new Set()
      const add = (title, text) => {
        const value = draftText(text).trim()
        const key = value.replace(/\*\*|[\s]+/g, '')
        if (!value || seen.has(key)) return
        seen.add(key)
        blocks.push({ title, text: value })
      }
      const addLegacy = (text, fallback) => {
        const value = draftText(text).replace(/\r\n?/g, '\n').trim()
        const headings = [...value.matchAll(/^(?:#{1,6}[ \t]+)?(?:\*\*)?(背景|目标|问题与场景)(?:\*\*)?[ \t]*(?:[：:][ \t]*|\n)/gm)]
        if (!headings.length) return add(fallback, value)
        add(fallback, value.slice(0, headings[0].index))
        headings.forEach((heading, index) => add(heading[1] === '目标' ? '预期变化' : '解决什么问题', value.slice(heading.index + heading[0].length, headings[index + 1]?.index ?? value.length)))
      }
      if (model?.status === 'legacy') {
        addLegacy(doc.goal, '需求内容')
        addLegacy(doc.problem, '解决什么问题')
      } else {
        add('预期变化', doc.goal)
        add('解决什么问题', doc.problem)
      }
      return blocks.sort((a, b) => Number(b.title === '预期变化') - Number(a.title === '预期变化'))
    }

    function humanMatterCopy(matter) {
      const kind = matter?.kind
      if (kind === 'automatic') {
        const phase = matter.progress?.phase
        return { label: 'AI 推进中', title: ['test', 'verify', 'acceptance'].includes(phase) ? 'AI 正在验证结果' : phase === 'implement' ? 'AI 正在开发' : 'AI 正在处理', description: '正在完成本轮工作。需要你做业务决定或验收时，会在这里提示。', next: '暂时无需你操作。' }
      }
      if (kind === 'awaiting-acceptance') return { label: '需要你验收', title: '请确认这次交付是否符合预期', description: 'AI 已提交当前交付候选，请核对实际效果和验收要求。' }
      if (kind === 'not-started') return { label: '下一步', title: '交给 AI 推进', description: 'AI 会根据这条需求完成开发和验证，遇到业务取舍再请你决定。' }
      if (kind === 'unverified' && matter.progress?.phase === 'review-result' && matter.action?.id === 'continue-run') return { label: '等待继续', title: 'AI 已交回本轮结果', description: '你可以继续推进，让 AI 接着处理这条需求。当前交付是否满足要求，请以交付验证结果为准。' }
      const labels = { accepted: '已验收', released: '已发布', closed: '已关闭', 'technical-block': '推进已暂停' }
      const explanation = String(matter?.explanation ?? '').replace(/(?:运行\s*)?RUN-[A-Za-z0-9-]+\s*/g, '').trim()
      return { label: labels[kind] ?? '当前进展', title: matter?.headline ?? '等待下一步', description: explanation || '请查看本轮结果后继续。' }
    }

    function HumanLongDescription({ text, paragraph, preview }) {
      const [expanded, setExpanded] = useState(false)
      return h('div', null,
        h('p', { 'data-human-excerpt': 'true', hidden: expanded, style: paragraph }, `${preview(text).slice(0, 420)}…`),
        h('details', { style: { marginTop: '6px' }, onToggle: event => setExpanded(event.currentTarget.open) },
          h('summary', { style: { fontSize: '12px', color: T.text3, cursor: 'pointer' } }, expanded ? '收起完整内容' : '展开这段完整内容'),
          h('div', { style: paragraph }, renderRich(text))),
      )
    }

    function HumanDescriptionBody({ model, status }) {
      const doc = model?.doc ?? {}
      const features = (Array.isArray(doc.features) ? doc.features : []).filter(feature => draftText(feature?.title) || draftText(feature?.behavior))
      const pending = (Array.isArray(doc.pending) ? doc.pending : []).filter(entry => typeof entry === 'string' ? entry.trim() : (!entry?.status || entry.status === 'open') && draftText(entry?.text))
      const scope = draftList(doc.scope), excluded = draftList(doc.outOfScope), constraints = draftList(doc.constraints)
      const blocks = humanDescriptionBlocks(model)
      const paragraph = { margin: '6px 0 0', fontSize: '15px', color: T.text2, lineHeight: 1.8, overflowWrap: 'anywhere' }
      const preview = value => String(value ?? '')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/^>\s?/gm, '')
        .replace(/^\s*(?:[-*]|\d+\.)\s+/gm, '')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .trim()
      const rows = (label, values) => values.length ? h('div', { style: { marginTop: '16px' } }, h('h3', { style: { margin: 0, fontSize: '13px', color: T.text } }, label), h('ul', { style: { ...paragraph, paddingLeft: '20px' } }, values.map((text, index) => h('li', { key: index }, text)))) : null
      return h('div', { 'data-human-description': 'true' },
        h('div', { className: 'description-cards' }, blocks.map((block, index) => h('div', { key: index, 'data-human-long': block.text.length > 420 ? 'true' : undefined, style: { padding: '12px', border: `1px solid ${T.line}`, borderRadius: '10px', background: T.layer } },
          index === 0 && status === 'unconfirmed' ? descriptionStatusBadge(status) : null,
          index === 0 && block.title === '需求内容' ? null : h('h3', { style: { margin: 0, fontSize: '13px', fontWeight: 600, color: T.text } }, block.title),
          block.text.length > 420
            ? h(HumanLongDescription, { text: block.text, paragraph, preview })
            : h('div', { style: paragraph }, renderRich(block.text)),
        ))),
        features.length ? h('div', { 'data-human-features': 'true', style: { marginTop: '20px' } }, h('h3', { style: { margin: '0 0 8px', fontSize: '13px' } }, '具体要做到'),
          features.map((feature, index) => h('div', { key: feature.id ?? index, 'data-detail-fr': feature.id, style: { margin: '12px 0' } },
            feature.title ? h('strong', { style: { fontSize: '14px', fontWeight: 600 } }, feature.title) : null,
            feature.behavior ? h('p', { style: paragraph }, draftText(feature.behavior)) : null,
            feature.preconditions?.length || feature.response || feature.boundaries?.length ? h('details', { style: { marginTop: '4px' } }, h('summary', { style: { color: T.text3, fontSize: '12px', cursor: 'pointer' } }, '适用条件与边界'), rows('适用条件', draftList(feature.preconditions)), feature.response ? h('p', { style: paragraph }, draftText(feature.response)) : null, rows('边界', draftList(feature.boundaries))) : null,
          ))) : null,
        rows('本次范围', scope), rows('本次不包含', excluded), rows('必须遵守', constraints),
        pending.length ? h('div', { 'data-detail-pending': 'true', style: { marginTop: '20px', borderLeft: `2px solid ${T.warn}`, paddingLeft: '12px' } }, h('strong', { style: { fontSize: '13px' } }, '待确认的业务问题'), h('ul', { style: { ...paragraph, paddingLeft: '20px' } }, pending.map((entry, index) => h('li', { key: index }, typeof entry === 'string' ? entry : draftText(entry.text))))) : null,
      )
    }

    function HumanVerification({ item, detail, matter }) {
      const summary = detail.verificationSummary ?? {}
      const criteria = detail.content?.doc?.acceptance?.length ? detail.content.doc.acceptance.map(entry => ({ ...entry, ...(summary.criteria ?? []).find(result => result.id === entry.id) })) : summary.criteria ?? detail.content?.acceptanceCriteria ?? []
      return h('section', { 'data-human-verification': 'true', style: { marginTop: '14px', paddingTop: '12px', borderTop: `1px solid ${T.line}` } },
        h('h2', { style: { fontSize: '16px', margin: 0 } }, '验收标准'),
        criteria.length ? h('div', { 'data-human-acceptance': 'true', style: { display: 'grid', gap: '6px', marginTop: '8px' } }, criteria.map((entry, index) => h('div', { key: entry.id ?? index, 'data-detail-ac': entry.id ?? `AC-${String(index + 1).padStart(2, '0')}`, style: { border: `1px solid ${T.line}`, borderRadius: '10px', padding: '8px 12px', minWidth: 0 } },
          h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '12px', color: T.text2, fontSize: '12px' } }, h('strong', null, entry.id ?? `AC-${String(index + 1).padStart(2, '0')}`), h('span', null, entry.status === 'passed' ? '已通过' : entry.status === 'failed' ? '未通过' : '待验证')),
          h('div', { style: { marginTop: '5px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, entry.text || entry.title || entry.expected || '待补充')))) : h('p', { style: { color: T.text2 } }, '暂无验收标准。'),
      )
    }

    const HUMAN_CONTROL = { ...button, minHeight: '40px', padding: '8px 14px', fontSize: '14px', fontWeight: 500, lineHeight: 1.5, color: T.text, border: `1px solid ${T.line2}`, background: T.layer }
    const DETAIL_MENU_ITEM = { ...HUMAN_CONTROL, width: '100%', textAlign: 'left', border: 0, background: 'transparent', minHeight: '36px', padding: '7px 10px' }
    const HUMAN_PRIMARY = { ...primary, minHeight: '44px', padding: '10px 20px', fontSize: '14px', fontWeight: 600 }
    function IterationFeedback({ item, root, onRefresh }) {
      const [feedback, setFeedback] = useState('')
      const [localPatch, setLocalPatch] = useState(null)
      const [resolution, setResolution] = useState('')
      const [busy, setBusy] = useState(false)
      const [message, setMessage] = useState('')
      const patch = localPatch ?? item.pendingPatch
      if (item.closed) return null
      const send = async body => {
        setBusy(true); setMessage('')
        try {
          const response = await fetch(`/api/alm/requirements/convergence?root=${encodeURIComponent(item.root ?? root)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
          const result = await response.json()
          if (!response.ok || !result.ok) throw new Error(result.message || '操作失败，请刷新后重试')
          if (body.action === 'feedback') {
            if (result.pendingPatch) { setLocalPatch(result.pendingPatch); setResolution('') }
            else { setMessage(result.execution?.resumed ? '修复反馈已提交，AI 正在继续推进。' : result.execution?.message ?? '反馈已保存，请启动或重试推进。'); onRefresh?.() }
          } else {
            setLocalPatch(null); setFeedback(''); setResolution('')
            setMessage(result.execution?.resumed ? '已提交并继续推进，完成后将重新检查。' : `已记录处理结果，但未能继续推进：${result.execution?.message ?? '请刷新后重试'}`)
            onRefresh?.()
          }
        } catch (error) { setMessage(error?.message || '操作失败，请重试') } finally { setBusy(false) }
      }
      return h('section', { 'data-iteration-feedback': 'true', style: { margin: '14px 0 0', padding: '12px', border: `1px solid ${T.line}`, borderRadius: '10px', background: T.layer } },
        h('h2', { style: { fontSize: '16px', margin: '0 0 12px' } }, patch ? '需求收敛确认' : '补充反馈或调整需求'),
        !patch ? h('div', null,
          h('label', { htmlFor: `iteration-feedback-${item.id}`, style: { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clipPath: 'inset(50%)' } }, '描述需要调整的内容'),
          h('textarea', { id: `iteration-feedback-${item.id}`, value: feedback, maxLength: 4000, rows: 2, placeholder: '直接描述需要微调的交互、补充的规则或发现的问题，AI 将自动判断是修复代码还是升级需求版本...', onChange: event => setFeedback(event.target.value), style: { display: 'block', boxSizing: 'border-box', width: '100%', margin: '8px 0', background: T.layer, color: T.text, border: `1px solid ${T.line2}`, padding: '8px' } }),
          h('div', { style: { display: 'flex', justifyContent: 'flex-end' } }, h('button', { type: 'button', style: HUMAN_CONTROL, disabled: busy || !feedback.trim(), onClick: () => send({ action: 'feedback', reqId: item.id, feedbackText: feedback }) }, busy ? '正在分析…' : '提交反馈'))) :
          h('div', { 'data-pending-patch': 'true' },
            
            h('p', null, patch.evolutionNote),
            h('details', null, h('summary', null, '查看变更前正文及验收'), h('pre', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, String(patch.beforeBrief ?? '').replace(/<!--\s*alm:meta\b[\s\S]*?-->/g, ''))),
            h('details', null, h('summary', null, '查看变更后正文及验收'), h('pre', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, String(patch.afterBrief ?? '').replace(/<!--\s*alm:meta\b[\s\S]*?-->/g, ''))),
            h('fieldset', { style: { margin: '12px 0', border: 0, padding: 0 } }, h('legend', null, '选择处理方式'),
              ...[['confirm_converge', '确认更新需求基线并继续推进'], ['repair_only', '仅作为代码问题修复（不修改需求基线）']].map(([value, label]) => h('label', { key: value, style: { display: 'block', margin: '8px 0' } }, h('input', { type: 'radio', name: `iteration-resolution-${item.id}`, value, checked: resolution === value, onChange: () => setResolution(value) }), ' ', label))),
            h('button', { type: 'button', style: HUMAN_PRIMARY, disabled: busy || !resolution, onClick: () => send({ action: 'resolve', reqId: item.id, patchId: patch.patchId, patchHash: patch.patchHash, baseRequirementHash: patch.baseRequirementHash, resolution }) }, busy ? '正在执行…' : '确认执行')),
        item.iterationRetry ? h('div', null, h('p', null, '迭代反馈已保存，等待启动或继续推进。'), h('button', { type: 'button', style: HUMAN_CONTROL, disabled: busy, onClick: () => send({ action: 'retry', reqId: item.id }) }, '重试推进'), h('p', { style: { color: T.text2, fontSize: '13px' } }, '如果尚未启动运行，请使用本页“交给 AI 推进”。')) : null,
        h('p', { role: 'status', 'aria-live': 'polite', style: { margin: message ? '8px 0 0' : 0 } }, message))
    }
    const HUMAN_TABS = [{ id: 'requirement', label: '需求正文' }, { id: 'delivery', label: 'AI 进展' }, { id: 'record', label: '历史记录' }]

    function HumanCurrentMatter({ item, detail, root, handlers, progressPage, onNavigate, onRefresh, onDirty }) {
      const matter = detail.currentMatter ?? { kind: detail.question ? 'decision' : detail.context?.kind, headline: detail.context?.headline, explanation: detail.context?.explanation, action: detail.primaryAction }
      const human = humanMatterCopy(matter)
      const action = matter.action ?? detail.primaryAction
      const decision = matter.kind === 'decision' || Boolean(detail.question)
      const businessDecision = matter.kind === 'decision'
      const watch = progressPage && action?.id === 'watch-run'
      return h('section', { 'data-current-matter': matter.kind ?? 'unknown', 'data-detail-context': detail.context?.kind ?? matter.kind ?? 'unknown', style: { marginBottom: '24px', borderLeft: `3px solid ${matter.requiresHuman ? T.warn : T.brand}`, padding: '6px 0 6px 18px' } },
        decision && (!progressPage || businessDecision) ? h(DecisionForm, { key: item.run?.id ?? item.id, item, root, inline: true, primaryActionId: action?.id ?? 'answer-run', onDirty, onDone: () => { onDirty?.(false); onRefresh?.() } }) : h('div', null,
          human.label !== human.title || businessDecision ? h('p', { style: { margin: '0 0 6px', color: T.text2, fontSize: '13px' } }, businessDecision ? '需要你的业务决定' : human.label) : null,
          h('h2', { style: { fontSize: '21px', fontWeight: 600, margin: '0 0 8px', lineHeight: 1.5 } }, businessDecision ? '有一件事需要你决定' : human.title),
          h('p', { style: { margin: '0 0 12px', color: T.text2, fontSize: '14px', lineHeight: 1.8 } }, businessDecision ? matter.explanation || '请核对业务选项，确认后 AI 才会继续。' : human.description),
          human.next && !decision ? h('p', { style: { margin: '0 0 12px', color: T.text2, fontSize: '13px' } }, human.next) : null,
          h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' } },
            decision ? h('button', { style: HUMAN_PRIMARY, disabled: action?.enabled === false, 'data-primary-action': action?.id ?? 'answer-run', onClick: () => onNavigate('requirement') }, businessDecision ? '查看业务选项并决定' : '查看问题与 AI 处理选项') : !watch && action?.enabled !== false && handlers[action?.id] ? h('button', { style: HUMAN_PRIMARY, 'data-primary-action': action.id, onClick: () => handlers[action.id]() }, action.id === 'watch-run' ? '查看 AI 进展' : action.label) : null,
            progressPage && onRefresh ? h('button', { style: HUMAN_CONTROL, 'data-progress-refresh': 'true', onClick: onRefresh }, '刷新状态') : null,
          ),
          action?.enabled === false && action.reason ? h('p', { role: 'status', style: { color: T.text2, fontSize: '13px', margin: '8px 0' } }, action.reason) : null,
          ['start', 'start-fix'].includes(action?.id) ? h('details', { style: { marginTop: '12px', fontSize: '13px', color: T.text2 } }, h('summary', { style: { cursor: 'pointer' } }, '本轮推进范围与执行限制'), h('p', null, '启动即授权本轮按范围内自动推进：最多 3 次续推、另有最多 2 次失败修复；无进展或需要决定时停止。不会替你验收或发布。')) : null,
          h(RejectCandidateControl, { item, root: item.root ?? root, onDone: onRefresh }),
        ),
      )
    }

    function HumanProgress({ item, detail }) {
      const run = detail.summaries?.run ?? {}
      const acceptance = detail.summaries?.acceptance ?? {}
      const candidate = detail.summaries?.candidate ?? {}
      const state = humanAcceptanceState(acceptance)
      const timeline = [...(detail.record?.timeline ?? [])].filter(entry => Number.isFinite(Date.parse(entry.at))).sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 3)
      const matter = detail.currentMatter ?? {}
      const blocked = matter.kind === 'technical-block'
      const last = run.lastActivityAt
      return h('div', { 'data-human-progress': 'true' },
        h('section', { style: { margin: '0 0 24px' } },
          h('h2', { style: { fontSize: '16px', margin: '0 0 10px' } }, '最近进展'),
          last ? h('p', { style: { color: T.text2, fontSize: '14px', lineHeight: 1.8, margin: '0 0 12px' } }, `最近活动 ${formatLocalStamp(last)}`, run.idleHandback ? ' · 本轮已交回结果，等待继续' : run.awaitingAnswer ? ' · 等待业务决定' : run.stale ? ' · 推进已中断' : run.status === 'running' ? ' · 执行中' : run.status === 'queued' ? ' · 等待开始执行' : '') : h('p', { style: { color: T.text2, fontSize: '14px' } }, '还没有可读取的运行活动。'),
          timeline.length ? h('ul', { style: { listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '10px' } }, timeline.map((entry, index) => h('li', { key: `${entry.at}-${index}`, style: { display: 'flex', flexWrap: 'wrap', gap: '4px 16px', fontSize: '14px', lineHeight: 1.7 } }, h('time', { dateTime: entry.at, style: { color: T.text2, fontSize: '12px', minWidth: '145px' } }, formatLocalStamp(entry.at)), h('span', null, entry.kind === 'acceptance' ? `执行技术检查 · ${state.label}` : entry.title || '记录了一次活动')))) : null,
          h('p', { style: { color: T.text3, fontSize: '12px', margin: '12px 0 0', lineHeight: 1.7 } }, '仅显示已记录的活动；点击刷新状态获取最新结果。'),
        ),
        blocked || run.failure?.message ? h('section', { 'data-progress-blocker': 'true', style: { borderLeft: `3px solid ${T.warn}`, padding: '4px 0 4px 14px', marginBottom: '24px' } }, h('h2', { style: { fontSize: '16px', margin: '0 0 8px' } }, '当前阻碍'), h('p', { style: { fontSize: '14px', lineHeight: 1.8, color: T.text2, margin: 0 } }, run.failure?.message || humanMatterCopy(matter).description)) : null,
        h('section', { 'data-progress-verification': 'true', style: { borderTop: `1px solid ${T.line}`, paddingTop: '20px', marginBottom: '24px' } },
          h('h2', { style: { fontSize: '16px', margin: '0 0 10px' } }, '当前验证'),
          h('p', { 'data-progress-acceptance': 'true', style: { color: state.color, fontSize: '14px', margin: '0 0 6px', fontWeight: 600 } }, state.label),
          h('p', { style: { fontSize: '14px', color: T.text2, lineHeight: 1.8, margin: 0 } }, detail.verificationSummary?.explanation || '技术检查与业务验收分别记录，当前没有完整的业务验收结论。'),
          candidate.exists && candidate.current === false ? h('p', { style: { color: T.warn, fontSize: '14px' } }, '交付内容已变化，旧候选不能用于本次验收。') : null,
        ),
      )
    }

    function RunEventText({ entry, field, root, requirementId, runId, segment, display = value => value }) {
      const isReasoning = field === 'reasoning'
      const [value, setValue] = useState(entry[field] ?? '')
      const [more, setMore] = useState(isReasoning ? entry.reasoningTruncated : entry.truncated)
      const [error, setError] = useState(null)
      const [busy, setBusy] = useState(false)
      const mounted = useRef(true)
      const request = useRef(null)
      useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current?.abort() } }, [])
      const load = async () => {
        if (busy) return
        setBusy(true); setError(null)
        const controller = new AbortController()
        request.current = controller
        let timeout
        try {
          if (typeof entry.eventHash !== 'string' || !/^[a-f0-9]{64}$/.test(entry.eventHash)) throw new Error('记录校验值不可用，请刷新记录后重试')
          const params = new URLSearchParams({ root: root ?? '', requirementId, runId, segment: String(segment), eventSeq: String(entry.seq), offset: String(value.length) })
          params.set('eventHash', entry.eventHash)
          const { response, data } = await Promise.race([
            fetch(`/api/alm/requirements/run-observation?${params}`, { headers: { accept: 'application/json' }, signal: controller.signal })
              .then(async response => ({ response, data: await response.json() })),
            new Promise((_, reject) => { timeout = setTimeout(() => { controller.abort(); reject(Object.assign(new Error('timeout'), { name: 'AbortError' })) }, 10000) }),
          ])
          if (!response.ok || data.ok === false || !data.detail) throw new Error(data.error?.message ?? '读取完整内容失败')
          const continuation = data.detail[field]
          const truncated = isReasoning ? data.detail.reasoningTruncated : data.detail.truncated
          if (data.offset !== value.length || data.detail.seq !== entry.seq || data.detail.sessionId !== entry.sessionId ||
              data.detail.eventHash !== entry.eventHash ||
              typeof continuation !== 'string' || !continuation || typeof truncated !== 'boolean') {
            throw new Error('续读内容不完整或已变化，请刷新记录后重试')
          }
          if (!mounted.current) return
          setValue(previous => previous + continuation)
          setMore(truncated)
        } catch (caught) { if (mounted.current) setError(caught?.name === 'AbortError' ? '读取完整内容超时' : caught?.message ?? '读取完整内容失败') }
        finally { clearTimeout(timeout); if (request.current === controller) request.current = null; if (mounted.current) setBusy(false) }
      }
      const visible = display(value)
      return h('div', null,
        h('p', { style: { margin: '8px 0 0', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.7, fontSize: '13px', color: isReasoning ? T.text2 : T.text } }, visible),
        visible ? h('div', { style: { marginTop: '8px' } }, h(CopyTextButton, { value: visible, label: more ? '复制已加载内容' : '复制内容' })) : null,
        more ? h('p', { style: { color: T.text2, fontSize: '12px', margin: '8px 0 0' } }, '内容已截断；复制仅包含已加载的内容。') : null,
        more ? h('button', { type: 'button', style: { ...HUMAN_CONTROL, marginTop: '8px', minHeight: '36px' }, disabled: busy, onClick: load }, busy ? '读取中…' : '加载后续内容') : null,
        error ? h('p', { role: 'alert', style: { color: T.err, fontSize: '12px' } }, error, error.includes('刷新记录') ? '。' : '；请重试。') : null,
      )
    }

    const RUN_SYSTEM_EVENT_TYPES = new Set(['sandbox/mode', 'approval/policy', 'agent/inbox/spliced', 'turn/start', 'step/start', 'step/end', 'system/message', 'request/header', 'request/context', 'session/title'])
    const RUN_SYSTEM_INJECTION = /<system-reminder>|Instructions from:\s*AGENTS\.md|Current runtime context\.|Current DSH file policy:|Current DeepSeek Harness implementation checkout:|Time sampled while preparing turn|Browser time zone|\[MNEMON\]|MNEMON RUNTIME MEMORY SNAPSHOT|<runtime-memory-file\b/i
    const RUN_DISPATCH_PROMPT = /(?:^|\n)\s*(?:#\s*需求交付任务：REQ-ALM-|你是需求交付执行器|You are (?:a )?requirement delivery executor)/i
    const RUN_INTERNAL_AUDIT = /(?:^|\n)\s*Team message from\b|\breq\d+-audit\b|\b[A-Za-z][\w-]*\.(?:mjs|js|ts|tsx):\d+(?:-\d+)?|\.slice\(0,\s*\d+\)/i

    function runToolArguments(entry) {
      try {
        const parsed = JSON.parse(entry?.text ?? '')
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
      } catch { return {} }
    }

    function runToolValue(argumentsValue, keys) {
      for (const key of keys) if (typeof argumentsValue[key] === 'string' && argumentsValue[key].trim()) return argumentsValue[key].trim()
      return null
    }

    function runToolOutput(value) {
      return String(value ?? '')
        .replace(/<skill_content\b[^>]*>/gi, '')
        .replace(/<\/skill_content>/gi, '')
        .trim()
    }

    function cleanOutcomeMarkdown(value) {
      return String(value ?? '')
        .replace(/<!--\s*alm:meta[\s\S]*?-->/gi, '')
        .replace(/!?(?:\[([^\]]+)\]\([^)]*\))/g, '$1')
        .replace(/^\s{0,3}#{1,6}\s+/u, '')
        .replace(/^\s*(?:[-*+]\s+|\d+[.)、]\s+)/u, '')
        .replace(/\*\*([^*]+)\*\*/g, '**$1**')
        .trim()
    }

    function outcomeInline(value) {
      const text = cleanOutcomeMarkdown(value)
      if (!text) return null
      return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((part, index) => {
        if (/^\*\*[^*]+\*\*$/u.test(part)) return h('strong', { key: index }, part.slice(2, -2))
        if (/^`[^`]+`$/u.test(part)) return h('code', { key: index, style: { padding: '1px 5px', borderRadius: '4px', background: T.layer2, color: T.text2, fontSize: '0.92em' } }, part.slice(1, -1))
        return part
      })
    }

    function uniqueOutcomeLines(lines) {
      return [...new Set(lines.map(cleanOutcomeMarkdown).filter(Boolean))].slice(0, 6)
    }

    // Project a final assistant report by section and complete list item. This
    // intentionally never crops a raw string from the middle of a sentence.
    function summarizeRunOutcome(value, { hasCurrentCandidate = false } = {}) {
      const sections = []
      let current = { title: '', lines: [] }
      const push = () => { if (current.title || current.lines.length) sections.push(current) }
      let codeFence = false
      for (const rawLine of String(value ?? '').replace(/\r/g, '').split('\n')) {
        if (/^\s*```/u.test(rawLine)) { codeFence = !codeFence; continue }
        if (codeFence) continue
        const heading = rawLine.match(/^\s{0,3}#{1,6}\s+(.+?)\s*$/u)
        if (heading) { push(); current = { title: cleanOutcomeMarkdown(heading[1]), lines: [] }; continue }
        const line = cleanOutcomeMarkdown(rawLine)
        if (line) current.lines.push(line)
      }
      push()

      const completed = []
      const verification = []
      const fallback = []
      for (const section of sections) {
        const title = section.title
        const text = section.lines.join('\n')
        // A subsequent candidate or adaptive pass supersedes an earlier host
        // spawn failure. Keep it only in the opt-in raw report.
        if (hasCurrentCandidate && /spawn\s+EPERM|(?:^|\n)\s*(?:阻塞|blocker?)/iu.test(`${title}\n${text}`)) continue
        if (/(?:已完成|本次完成|完成情况|完成内容|交付内容|实现结果)/u.test(title)) completed.push(...section.lines)
        else if (/(?:验证|测试|检查|验收)/u.test(title)) verification.push(...section.lines.filter(line => /通过|pass|成功|0\s*failures|\d+\s*\/\s*\d+\s*通过|完成/u.test(line) && !/spawn\s+EPERM|失败|阻塞/u.test(line)))
        else fallback.push(...section.lines.filter(line => !/spawn\s+EPERM|^阻塞[：:]/iu.test(line)))
      }
      const normalizedCompleted = uniqueOutcomeLines(completed.length ? completed : fallback)
      return { completed: normalizedCompleted, verification: uniqueOutcomeLines(verification) }
    }

    function auditFindings(value) {
      const lines = String(value ?? '').split(/\r?\n/)
        .map(line => line.replace(/^\s*(?:[-*•]|\d+[.)、])\s*/, '').trim())
        .filter(line => line.length >= 6 && line.length <= 160)
        .filter(line => !RUN_INTERNAL_AUDIT.test(line) && !/^(?:Team message from|From:)/i.test(line))
        .map(line => line.replace(/`[^`]+`/g, '相关实现').replace(/\b[\w/-]+\.(?:mjs|js|ts|tsx)(?::\d+(?:-\d+)?)?/g, '相关实现'))
      return [...new Set(lines)].slice(0, 4)
    }

    function runToolAction(entry) {
      const name = (entry.name ?? 'tool').toLowerCase()
      const args = runToolArguments(entry)
      const file = runToolValue(args, ['path', 'file', 'filePath', 'target'])
      const command = runToolValue(args, ['command', 'cmd', 'script'])
      const skill = runToolValue(args, ['name', 'skill'])
      const mutation = /(?:write|edit|patch|replace|apply|delete|move|rename)/.test(name) || /apply_patch|\b(?:sed|perl)\b.*(?:-i|write)|\b(?:mv|cp)\b/.test(command ?? '')
      const verification = /(?:test|verify|check|lint|build|bash|shell|exec|command)/.test(name) && /(?:--test|\btest\b|\bcheck\b|\blint\b|\bbuild\b|\bnode\b|\bpnpm\b|\bnpm\b)/.test(command ?? entry.text)
      if (/skill/.test(name)) return { type: 'skill', icon: '🧩', title: `加载开发技能：${skill ?? '开发技能'}` }
      if (mutation) return { type: 'mutation', icon: '✏️', title: file ? `修改文件：${file}` : '执行代码修改' }
      if (verification) return { type: 'verification', icon: '🧪', title: `执行命令：${(command ?? entry.text).replace(/\s+/g, ' ').slice(0, 140)}` }
      if (/(?:read|search|find|grep|rg|list|glob|stat)/.test(name)) return { type: 'inspection', icon: '🔍', title: `${/(?:search|find|grep|rg|glob)/.test(name) ? '检索' : '读取'}：${file ?? runToolValue(args, ['query', 'pattern', 'path']) ?? '代码与文件'}` }
      return { type: 'tool', icon: '⚙️', title: `工具结果：${entry.name ?? '工具'}` }
    }

    function projectRunView(events) {
      const conversation = []
      const actions = []
      const systemEvents = []
      const outcomes = []
      const pending = new Map()
      const addSystem = entry => systemEvents.push({ seq: entry.seq, at: entry.at, name: entry.name ?? '系统事件' })
      for (const entry of events) {
        if (entry.kind === 'other' || RUN_SYSTEM_EVENT_TYPES.has(entry.name)) { addSystem(entry); continue }
        if (['input', 'output'].includes(entry.kind)) {
          if (RUN_SYSTEM_INJECTION.test(entry.text ?? '')) { addSystem(entry); continue }
          if (entry.kind === 'input') {
            if (RUN_DISPATCH_PROMPT.test(entry.text ?? '')) conversation.push({ kind: 'dispatch', entry })
            continue
          }
          if (RUN_INTERNAL_AUDIT.test(entry.text ?? '')) {
            conversation.push({ kind: 'audit', entry, findings: auditFindings(entry.text) })
            continue
          }
          if (!(entry.text ?? '').trim()) continue
          outcomes.push({ kind: 'outcome', entry })
          continue
        }
        if (entry.kind === 'tool-call') {
          const action = { ...runToolAction(entry), call: entry, result: null, status: 'running' }
          actions.push(action)
          if (entry.callId) pending.set(entry.callId, action)
          continue
        }
        if (entry.kind === 'tool-result') {
          const action = entry.callId ? pending.get(entry.callId) : null
          if (action) {
            action.result = entry
            action.status = entry.status === 'failed' ? 'failed' : 'completed'
            pending.delete(entry.callId)
          } else actions.push({ ...runToolAction(entry), call: null, result: entry, status: entry.status === 'failed' ? 'failed' : 'completed' })
        }
      }
      const dispatch = conversation.filter(row => row.kind === 'dispatch').at(-1) ?? null
      const audit = conversation.filter(row => row.kind === 'audit').at(-1) ?? null
      conversation.length = 0
      if (dispatch) conversation.push(dispatch)
      if (audit) conversation.push(audit)
      if (outcomes.length) conversation.push(outcomes.at(-1))
      const mutations = actions.filter(action => action.type === 'mutation').length
      const verification = actions.findLast(action => action.type === 'verification' && action.status !== 'running')
      return { conversation, actions, systemEvents, summary: { actions: actions.length, mutations, verification } }
    }

    function OutcomeSummaryCard({ entry, root, requirementId, runId, segment, hasCurrentCandidate }) {
      const summary = summarizeRunOutcome(entry.text, { hasCurrentCandidate })
      const list = (title, icon, lines, tone) => lines.length ? h('section', { style: { marginTop: '10px' } },
        h('strong', { style: { display: 'block', fontSize: '12px', color: tone } }, `${icon} ${title}`),
        h('ul', { style: { margin: '5px 0 0', paddingLeft: '18px', color: T.text2, fontSize: '13px', lineHeight: 1.7 } }, lines.map((line, index) => h('li', { key: `${index}:${line}` }, outcomeInline(line)))),
      ) : null
      return h('article', { 'data-run-outcome': 'true', 'data-run-outcome-summary': 'true', style: { borderTop: `1px solid ${T.line}`, padding: '12px 0', minWidth: 0 } },
        h('div', { style: { display: 'flex', gap: '10px', alignItems: 'baseline', flexWrap: 'wrap', fontSize: '12px', color: T.text2 } }, h('strong', { style: { color: T.text } }, 'AI 阶段结论'), entry.at ? h('time', { dateTime: entry.at }, formatLocalStamp(entry.at)) : null),
        list('本轮完成要点', '✅', summary.completed, T.ok),
        list('验证结论摘要', '🧪', summary.verification, T.brand),
        !summary.completed.length && !summary.verification.length ? h('p', { style: { margin: '8px 0 0', color: T.text2, fontSize: '13px' } }, '本轮汇报未包含可提炼的完成或验证结论。') : null,
        h('details', { style: { marginTop: '10px', fontSize: '12px', color: T.text2 } },
          h('summary', { style: { cursor: 'pointer' } }, '查看完整原始汇报'),
          h(RunEventText, { entry, field: 'text', root, requirementId, runId, segment }),
        ),
      )
    }

    function ReviewUsage({ review, root, requirementId }) {
      const [storedHistory, setHistory] = useState(null)
      const history = storedHistory?.root === root && storedHistory?.requirementId === requirementId ? storedHistory : { loading: true, records: [], error: false }
      useEffect(() => {
        const controller = new AbortController()
        let mounted = true
        const saveHistory = value => setHistory({ root, requirementId, ...value })
        const timeout = setTimeout(() => { controller.abort(); if (mounted) saveHistory({ loading: false, records: [], error: true }) }, 10000)
        saveHistory({ loading: true, records: [], error: false })
        const params = new URLSearchParams({ root: root ?? '', requirementId, mode: 'review-usage' })
        fetch(`/api/alm/requirements/run-observation?${params}`, { headers: { accept: 'application/json' }, signal: controller.signal })
          .then(response => { if (!response.ok) throw new Error('usage unavailable'); return response.json() })
          .then(data => { if (!Array.isArray(data?.records)) throw new Error('invalid usage history'); if (mounted && !controller.signal.aborted) saveHistory({ loading: false, records: data.records, error: false }) })
          .catch(() => { if (mounted) saveHistory({ loading: false, records: [], error: true }) })
          .finally(() => clearTimeout(timeout))
        return () => { mounted = false; clearTimeout(timeout); controller.abort() }
      }, [root, requirementId])
      if (!review?.stored && !history.loading && !history.error && !history.records.length) return null
      const usage = review?.usage
      const count = value => Number.isSafeInteger(value) && value >= 0 ? new Intl.NumberFormat().format(value) : '未知'
      return h('section', { 'aria-label': '最近 AI 评审用量', style: { borderTop: `1px solid ${T.line}`, paddingTop: '16px', marginBottom: '24px', fontSize: '13px', color: T.text2 } },
        h('h2', { style: { fontSize: '15px', color: T.text, margin: '0 0 8px' } }, '最近 AI 评审用量'),
        review?.stored ? h('p', { style: { margin: '0 0 6px', overflowWrap: 'anywhere' } }, `${review.provider ?? '未知提供方'} / ${review.model ?? '未知模型'}${review.generatedAt ? ` · ${formatLocalStamp(review.generatedAt)}` : ''}`) : null,
        review?.stored ? (usage ? h('p', { style: { margin: '0', lineHeight: 1.7 } }, `未缓存输入 ${count(usage.inputTokens)} · 缓存读取 ${count(usage.cacheReadTokens)} · 缓存写入 ${count(usage.cacheWriteTokens)} · 输出 ${count(usage.outputTokens)} token`) : h('p', { style: { margin: 0 } }, '本次评审未记录用量。')) : null,
        review?.usageReceiptStored === false ? h('p', { style: { color: T.warn } }, '最近一次评审的用量记录未能保存。') : null,
        history.loading ? h('p', { role: 'status' }, '正在读取评审调用记录…') : null,
        history.error ? h('p', { role: 'alert', style: { color: T.err } }, '评审调用记录暂不可用，请刷新需求详情重试。') : null,
        history.records.length ? h('details', { style: { marginTop: '8px' } }, h('summary', null, '最近评审调用记录'), h('ul', { style: { paddingLeft: '18px', lineHeight: 1.7 } }, history.records.map(row => h('li', { key: row.id }, `${row.status === 'completed' ? '完成' : '失败'} · ${formatLocalStamp(row.finishedAt)} · ${row.provider ?? '未知提供方'} / ${row.model ?? '未知模型'} · 未缓存输入 ${count(row.usage?.inputTokens)} · 缓存读取 ${count(row.usage?.cacheReadTokens)} · 缓存写入 ${count(row.usage?.cacheWriteTokens)} · 输出 ${count(row.usage?.outputTokens)} token`)))) : null,
        h('p', { style: { fontSize: '12px', margin: '6px 0 0' } }, '每次调用仅记录最后用量样本，可能不含内部重试；最多显示最近 20 条，不计入开发会话合计，费用未知。'),
      )
    }

    function RunObservationPanel({ item, detail, root, onOpenSession, initialRunId = null }) {
      const latestRunId = detail.summaries?.run?.id ?? item.run?.id ?? null
      const latestRunStatus = detail.summaries?.run?.status ?? item.run?.status ?? null
      const blueprint = item.run?.blueprint ?? null
      const requirementClosed = item.closed === true || detail.summaries?.delivery?.key === 'closed' || detail.currentMatter?.kind === 'closed'
      const [runSelection, setRunSelection] = useState(null)
      const runId = runSelection?.root === root && runSelection?.requirementId === item.id ? runSelection.value : initialRunId ?? latestRunId
      const setRunId = value => setRunSelection(previous => ({ root, requirementId: item.id, value: typeof value === 'function' ? value(previous?.root === root && previous?.requirementId === item.id ? previous.value : initialRunId ?? latestRunId) : value }))
      const [storedRunOptions, setRunOptions] = useState(null)
      const runOptions = storedRunOptions?.root === root && storedRunOptions?.requirementId === item.id ? storedRunOptions : { runs: [], next: null, loading: true, error: false }
      const [view, setView] = useState('conversation')
      const [segmentSelection, setSegmentSelection] = useState(null)
      const segment = segmentSelection?.runId === runId && segmentSelection?.root === root && segmentSelection?.requirementId === item.id ? segmentSelection.index : 0
      const [storedState, setState] = useState({ loading: true, events: [], sessions: [], source: null, error: null, complete: false, hasMore: false })
      const sameRun = value => value?.runId === runId && value?.root === root && value?.requirementId === item.id
      const sessionOptions = sameRun(storedState) ? storedState.sessions : []
      const state = sameRun(storedState) && storedState.segment === segment
        ? storedState
        : { loading: true, events: [], sessions: [], source: null, error: null, complete: false, hasMore: false }
      const observedStatus = state.runId === runId && state.root === root && state.requirementId === item.id ? state.runStatus : null
      const currentStatus = observedStatus ?? (runId === latestRunId ? latestRunStatus : null)
      const canPoll = !requirementClosed && ['queued', 'running', 'waiting-input', 'paused'].includes(currentStatus)
      const [refresh, setRefresh] = useState(0)
      const [storedUsage, setUsage] = useState(null)
      const [storedLive, setLive] = useState(null)
      const sameScope = value => value?.root === root && value?.requirementId === item.id && value?.runId === runId && value?.segment === segment
      const usage = sameScope(storedUsage) && storedUsage.refresh === refresh ? storedUsage.value : { status: 'loading' }
      const liveScope = sameScope(storedLive) && view === 'conversation' && !requirementClosed && runId === latestRunId && ['queued', 'running'].includes(currentStatus)
      const live = liveScope ? storedLive.value : null
      const liveError = liveScope && storedLive.error
      const loadMore = useRef(null)
      const loadMoreRuns = useRef(null)
      const latestRef = useRef(null)
      useEffect(() => {
        const controller = new AbortController()
        let cursor = null, busy = false
        setRunId(initialRunId ?? latestRunId)
        setRunOptions({ root, requirementId: item.id, runs: [], next: null, loading: true, error: false })
        const load = async () => {
          if (busy || controller.signal.aborted) return
          busy = true
          setRunOptions(previous => ({ ...previous, loading: true, error: false }))
          const requestController = new AbortController()
          const cancelRequest = () => requestController.abort()
          controller.signal.addEventListener('abort', cancelRequest, { once: true })
          let timeout
          try {
            const params = new URLSearchParams({ root: root ?? '', requirementId: item.id, mode: 'history' })
            if (cursor) params.set('before', cursor)
            const { response, data } = await Promise.race([
              fetch(`/api/alm/requirements/run-observation?${params}`, { headers: { accept: 'application/json' }, signal: requestController.signal }).then(async response => ({ response, data: await response.json() })),
              new Promise((_, reject) => { timeout = setTimeout(() => { cancelRequest(); reject(new Error('history timeout')) }, 10000) }),
            ])
            if (!response.ok) throw new Error('unavailable')
            if (!Array.isArray(data.runs) || data.runs.some(run => !run || typeof run.id !== 'string' || !run.id.trim()) || (data.next !== null && (typeof data.next !== 'string' || !data.next || data.next === cursor))) throw new Error('invalid')
            if (controller.signal.aborted) return
            cursor = data.next
            setRunOptions(previous => {
              const runs = new Map(previous.runs.map(run => [run.id, run]))
              for (const run of data.runs) if (!runs.has(run.id)) runs.set(run.id, run)
              return { root, requirementId: item.id, runs: [...runs.values()], next: data.next, loading: false, error: false }
            })
            if (!initialRunId && !latestRunId && data.runs.length) setRunId(current => current ?? data.runs[0].id)
          } catch { if (!controller.signal.aborted) setRunOptions(previous => ({ ...previous, loading: false, error: true })) }
          finally { clearTimeout(timeout); controller.signal.removeEventListener('abort', cancelRequest); busy = false }
        }
        loadMoreRuns.current = load
        void load()
        return () => { controller.abort(); loadMoreRuns.current = null }
      }, [root, item.id, latestRunId, initialRunId])
      useEffect(() => {
        if (requirementClosed || !runId || runId !== latestRunId || !['queued', 'running'].includes(currentStatus) || view !== 'conversation') return
        let alive = true, timer
        const controller = new AbortController()
        const loadLive = async () => {
          const requestController = new AbortController()
          const cancelRequest = () => requestController.abort()
          controller.signal.addEventListener('abort', cancelRequest, { once: true })
          let timeout
          try {
            const params = new URLSearchParams({ root: root ?? '', requirementId: item.id, runId, segment: String(segment), mode: 'live' })
            const { response, data } = await Promise.race([
              fetch(`/api/alm/requirements/run-observation?${params}`, { headers: { accept: 'application/json' }, signal: requestController.signal }).then(async response => ({ response, data: await response.json() })),
              new Promise((_, reject) => { timeout = setTimeout(() => { cancelRequest(); reject(new Error('live timeout')) }, 10000) }),
            ])
            if (!response.ok) throw new Error('live unavailable')
            const value = data?.live
            if (!data || data.ok === false || data.runId !== runId || data.segment !== segment || !Object.hasOwn(data, 'live') ||
                (value !== null && (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.text !== 'string' || typeof value.reasoning !== 'string' || typeof value.truncated !== 'boolean'))) throw new Error('invalid live response')
            if (alive) setLive({ root, requirementId: item.id, runId, segment, value: data.live ?? null, error: false })
          } catch { if (alive) setLive(previous => ({ root, requirementId: item.id, runId, segment, value: previous?.root === root && previous?.requirementId === item.id && previous?.runId === runId && previous?.segment === segment ? previous.value : null, error: true })) }
          finally { clearTimeout(timeout); controller.signal.removeEventListener('abort', cancelRequest) }
          if (alive) timer = setTimeout(loadLive, 2000)
        }
        void loadLive()
        return () => { alive = false; controller.abort(); clearTimeout(timer) }
      }, [root, item.id, runId, segment, view, latestRunId, currentStatus, requirementClosed])
      useEffect(() => {
        if (!runId || view !== 'usage') return
        const controller = new AbortController()
        let cancelled = false
        const saveUsage = value => setUsage({ root, requirementId: item.id, runId, segment, refresh, value })
        saveUsage({ status: 'loading' })
        const timeout = setTimeout(() => { controller.abort(); if (!cancelled) saveUsage({ status: 'unknown' }) }, 10000)
        const params = new URLSearchParams({ root: root ?? '', requirementId: item.id, runId, segment: String(segment), mode: 'usage' })
        fetch(`/api/alm/requirements/run-observation?${params}`, { headers: { accept: 'application/json' }, signal: controller.signal })
          .then(response => response.ok ? response.json() : null)
          .then(data => {
            if (controller.signal.aborted) return
            const value = data?.usage
            const valid = data?.ok === true && data.requirementId === item.id && data.runId === runId && data.segment === segment && value && typeof value === 'object' && !Array.isArray(value) && (value.status === 'unknown' || (value.status === 'available' && ['dsh-session', 'billion-context'].includes(value.source) && value.scope === 'session'))
            saveUsage(valid ? value : { status: 'unknown' })
          })
          .catch(() => { if (!cancelled) saveUsage({ status: 'unknown' }) })
          .finally(() => clearTimeout(timeout))
        return () => { cancelled = true; clearTimeout(timeout); controller.abort() }
      }, [root, item.id, runId, segment, view, refresh])
      useEffect(() => {
        if (!runId) return
        let alive = true, busy = false, cursor = -1, prefixHash = null, replayUntil = null, replayBuffer = [], timer = null
        const controller = new AbortController()
        let status = runId === latestRunId ? latestRunStatus : null
        const shouldPoll = () => !requirementClosed && runId === latestRunId && ['queued', 'running', 'waiting-input', 'paused'].includes(status)
        const pollDelay = () => ['waiting-input', 'paused'].includes(status) ? 15000 : 4000
        setState(previous => ({ runId, root, requirementId: item.id, segment, runStatus: null, loading: true, events: [], sessions: sameRun(previous) ? previous.sessions : [], source: null, error: null, complete: false, hasMore: false }))
        const load = async () => {
          if (busy || !alive) return
          clearTimeout(timer); timer = null
          busy = true
          const requestController = new AbortController()
          const cancelRequest = () => requestController.abort()
          controller.signal.addEventListener('abort', cancelRequest, { once: true })
          let timeout
          const timedOut = new Promise((_, reject) => { timeout = setTimeout(() => { cancelRequest(); reject(Object.assign(new Error('读取运行记录超时'), { name: 'AbortError' })) }, 10000) })
          try {
            const params = new URLSearchParams({ root: root ?? '', requirementId: item.id, runId, segment: String(segment), limit: '50' })
            if (cursor >= 0) params.set('after', String(cursor))
            if (prefixHash) params.set('prefixHash', prefixHash)
            const { response, data } = await Promise.race([timedOut, (async () => {
              const response = await fetch(`/api/alm/requirements/run-observation?${params}`, { headers: { accept: 'application/json' }, signal: requestController.signal })
              return { response, data: await response.json() }
            })()])
            if (!response.ok || data.ok === false) throw new Error(data.error?.message ?? '读取运行记录失败')
            if (!alive) return
            if (data.ok !== true || data.runId !== runId || data.segment !== segment) throw new Error('运行记录响应无效，请重试')
            if (data.historyChanged) {
              replayUntil = Math.max(replayUntil ?? -1, cursor)
              cursor = -1; prefixHash = null; replayBuffer = []
              setState(previous => ({ ...previous, loading: false, replaying: true, error: null, hasMore: true }))
              timer = setTimeout(load, 0)
              return
            }
            if (!Array.isArray(data.events) || !['session-observation', 'session-query', 'persisted', 'no-session', 'unavailable', 'corrupt'].includes(data.source)) throw new Error('运行记录响应无效，请重试')
            if (!Array.isArray(data.sessions) || data.sessions.some(session => !session || typeof session.sessionId !== 'string' || !session.sessionId.trim())) throw new Error('运行记录响应无效，请重试')
            const unavailable = ['no-session', 'unavailable', 'corrupt'].includes(data.source)
            if (unavailable && data.events.length) throw new Error('运行记录响应无效，请重试')
            if (!unavailable) {
              const sessionId = Array.isArray(data.sessions) ? data.sessions[segment]?.sessionId : null
              if (data.events.length && (typeof sessionId !== 'string' || !sessionId)) throw new Error('运行记录响应无效，请重试')
              let last = cursor
              for (const event of data.events) {
                if (!event || event.sessionId !== sessionId || !Number.isSafeInteger(event.seq) || event.seq <= last ||
                    !['input', 'output', 'tool-call', 'tool-result', 'other'].includes(event.kind) || typeof event.text !== 'string' ||
                    (event.reasoning != null && typeof event.reasoning !== 'string') ||
                    (event.name != null && typeof event.name !== 'string')) throw new Error('运行记录响应无效，请重试')
                last = event.seq
              }
              if (data.lastSeq !== last || (last >= 0 && (typeof data.prefixHash !== 'string' || !/^[a-f0-9]{64}$/.test(data.prefixHash))) || (data.next !== null && (!data.next || data.next.segment !== segment || data.next.after !== last || last === cursor))) throw new Error('运行记录响应无效，请重试')
            }
            if (typeof data.status === 'string') status = data.status
            if (!unavailable) { cursor = data.lastSeq; prefixHash = data.prefixHash ?? null }
            const replaying = replayUntil !== null
            if (!unavailable && replaying) replayBuffer.push(...data.events)
            const replayFinished = !unavailable && replaying && (!data.next || cursor >= replayUntil)
            const replayedEvents = replayFinished ? replayBuffer.slice() : null
            setState(previous => {
              const seen = new Set(previous.events.map(entry => `${entry.sessionId}:${entry.seq}`))
              const added = (data.events ?? []).filter(entry => { const key = `${entry.sessionId}:${entry.seq}`; if (seen.has(key)) return false; seen.add(key); return true })
              const events = unavailable || (replaying && !replayFinished) ? previous.events : replayFinished ? replayedEvents : [...previous.events, ...added]
              return { runId, root, requirementId: item.id, segment, runStatus: status, loading: false, replaying: replaying && !replayFinished, events, sessions: data.sessions ?? [], source: data.source, error: null, complete: data.sessionHistoryComplete === true, interruptedOutputPossible: data.interruptedOutputPossible === true, hasMore: unavailable ? previous.hasMore : Boolean(data.next), updatedAt: unavailable || (replaying && !replayFinished) ? previous.updatedAt : Date.now() }
            })
            if (unavailable) { if (data.source !== 'corrupt' && shouldPoll()) timer = setTimeout(load, pollDelay()) }
            else if (data.next) timer = setTimeout(load, 0)
            else {
              replayUntil = null; replayBuffer = []
              if (!data.next && data.source !== 'corrupt' && shouldPoll()) timer = setTimeout(load, pollDelay())
            }
          } catch (error) {
            if (alive && !controller.signal.aborted) {
              setState(previous => ({ ...previous, loading: false, error: error?.name === 'AbortError' ? '读取运行记录超时' : error?.message ?? '读取运行记录失败' }))
              if (shouldPoll()) timer = setTimeout(load, pollDelay())
            }
          } finally { clearTimeout(timeout); controller.signal.removeEventListener('abort', cancelRequest); busy = false }
        }
        loadMore.current = load
        void load()
        return () => { alive = false; loadMore.current = null; controller.abort(); clearTimeout(timer) }
      }, [root, item.id, runId, segment, refresh, latestRunId, latestRunStatus, requirementClosed])
      if (!runId) return h('section', { style: { borderTop: `1px solid ${T.line}`, paddingTop: '18px' } }, h('h2', { style: { fontSize: '16px' } }, '运行记录'), runOptions.error ? h('div', { role: 'alert' }, '运行列表暂不可用。 ', h('button', { type: 'button', style: HUMAN_CONTROL, onClick: () => loadMoreRuns.current?.() }, '重试')) : h('p', { role: runOptions.loading ? 'status' : undefined, style: { color: T.text2, fontSize: '13px' } }, runOptions.loading ? '正在读取运行列表…' : '尚无 AI 运行记录。'))
      const projected = projectRunView(state.events)
      const conversation = projected.conversation.slice(-8)
      const actions = projected.actions
      const requirementVersion = Number.isSafeInteger(state.sessions[segment]?.requirementRevision) ? `v${state.sessions[segment].requirementRevision}` : '当前需求版本'
      const runs = runOptions.runs.some(run => run.id === runId) ? runOptions.runs : [{ id: runId }, ...runOptions.runs]
      const hasCurrentCandidate = detail.summaries?.candidate?.current === true
      const count = value => typeof value === 'number' ? new Intl.NumberFormat().format(value) : '未知'
      const usd = value => {
        if (typeof value !== 'number' || !Number.isFinite(value)) return '未知'
        if (value > 0 && value < 0.0001) return '大于 0 且小于 US$0.0001'
        if (value < 0 && value > -0.0001) return '大于 -US$0.0001 且小于 0'
        return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 4 }).format(value)
      }
      return h('section', { 'data-run-observation': 'true', 'data-detail-anchor': 'delivery-run-observation', tabIndex: -1, style: { borderTop: `1px solid ${T.line}`, paddingTop: '18px', marginBottom: '24px', minWidth: 0 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } },
          h('h2', { style: { fontSize: '16px', margin: '0 auto 0 0' } }, '运行记录'),
          runs.length > 1 ? h('label', { style: { fontSize: '13px', color: T.text2, minWidth: 0, maxWidth: '100%' } }, '运行 ', h('select', { name: 'run-selection', 'aria-label': '选择运行', value: runId, onChange: event => { setSegmentSelection(null); setRunId(event.target.value) }, style: { ...input, width: 'auto', minWidth: 0, maxWidth: '100%' } }, runs.map(run => h('option', { key: run.id, value: run.id }, `${run.id}${run.createdAt ? ` · ${formatLocalStamp(run.createdAt)}` : ''}`)))) : null,
          runOptions.next && !runOptions.error ? h('button', { type: 'button', style: HUMAN_CONTROL, disabled: runOptions.loading, onClick: () => loadMoreRuns.current?.() }, '加载更多运行选项') : null,
          sessionOptions.length > 1 ? h('label', { style: { fontSize: '13px', color: T.text2, minWidth: 0, maxWidth: '100%' } }, '会话 ', h('select', { name: 'session-selection', 'aria-label': '选择会话', value: segment, onChange: event => setSegmentSelection({ runId, root, requirementId: item.id, index: Number(event.target.value) }), style: { ...input, width: 'auto', minWidth: 0, maxWidth: '100%' } }, sessionOptions.map((entry, index) => h('option', { key: entry.sessionId, value: index }, `第 ${index + 1} 段${entry.reason === 'resume' ? '（恢复）' : ''}`)))) : null,
          view !== 'usage' && !state.hasMore && !state.error && state.source && !['no-session', 'unavailable', 'corrupt'].includes(state.source) && (state.events.length > 0 || live) ? h('button', { type: 'button', style: HUMAN_CONTROL, onClick: () => { latestRef.current?.scrollIntoView({ block: 'end' }); latestRef.current?.focus({ preventScroll: true }) } }, '回到最新') : null,
          h('button', { type: 'button', style: HUMAN_CONTROL, onClick: () => setRefresh(value => value + 1) }, '刷新记录'),
        ),
        runOptions.error ? h('div', { role: 'alert', style: { color: T.err, fontSize: '12px', marginTop: '8px' } }, '运行列表暂不可用。 ', h('button', { type: 'button', style: HUMAN_CONTROL, onClick: () => loadMoreRuns.current?.() }, '重试')) : null,
        !state.complete && state.sessions.length ? h('p', { style: { color: T.text2, fontSize: '12px' } }, '早期会话记录可能不完整。') : null,
        state.interruptedOutputPossible ? h('p', { role: 'status', style: { color: T.text2, fontSize: '12px' } }, '执行期间宿主中断，尚未保存的实时输出可能缺失。') : null,
        !state.loading && state.sessions[segment] ? (() => {
          const selected = state.sessions[segment]
          const stamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? formatLocalStamp(value) : '未知'
          const revision = Number.isSafeInteger(selected.requirementRevision) && selected.requirementRevision >= 0 ? `v${selected.requirementRevision}` : '未知'
          const reason = ({ start: '初始会话', resume: '恢复会话', legacy: '历史会话' })[selected.reason] ?? '来源未知'
          const source = selected.source === 'dsh-session' ? 'DSH 会话' : '未知'
          return h('p', { style: { color: T.text2, fontSize: '12px', margin: '8px 0' } }, `第 ${segment + 1} 段 · ${reason} · 来源 ${source} · 开始 ${stamp(selected.startedAt)} · 结束 ${stamp(selected.endedAt)} · 需求版本 ${revision}`)
        })() : null,
        observedStatus ? h('p', { style: { color: T.text2, fontSize: '12px', margin: '8px 0' } }, `${requirementClosed ? '关联运行状态' : '运行状态'}：${({ queued: '排队', running: '运行中', 'waiting-input': '等待输入', paused: '暂停', failed: '失败', done: '结束', cancelled: '已取消' })[observedStatus] ?? '未知'}${requirementClosed ? '（需求已关闭，历史只读）' : ''}`) : null,
        state.updatedAt && !['no-session', 'unavailable', 'corrupt'].includes(state.source) ? h('p', { style: { color: T.text2, fontSize: '12px', margin: '8px 0' } }, `已记录内容 · 更新于 ${new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(state.updatedAt)}${runId === latestRunId && canPoll ? ' · 自动更新' : ''}`) : null,
        h('details', { 'data-developer-debug': 'true', style: { margin: '12px 0', color: T.text2, fontSize: '13px' } },
          h('summary', { style: { cursor: 'pointer' } }, `开发者调试详情（工具轨迹 ${actions.length} 步${projected.summary.mutations ? ` · 修改 ${projected.summary.mutations} 个文件` : ''}${usage.status === 'available' ? ' · Token 用量可查看' : ''}）`),
          h('div', { role: 'group', 'aria-label': '运行记录视图', style: { display: 'flex', gap: '4px', margin: '10px 0 4px', flexWrap: 'wrap' } },
            [['conversation', '对话'], ['trace', '轨迹'], ['usage', '用量']].map(([id, label]) => h('button', { key: id, type: 'button', 'aria-pressed': view === id, onClick: () => setView(id), style: { ...HUMAN_CONTROL, background: view === id ? T.layer2 : 'transparent', minHeight: '36px', padding: '6px 12px' } }, label))),
        ),
        state.loading ? h('p', { role: 'status', style: { color: T.text2 } }, '正在读取运行记录…') : null,
        state.replaying ? h('p', { role: 'status', style: { color: T.text2 } }, '记录已变化，重新核对尚未完成；下方是之前读取的内容。') : null,
        state.error ? h('p', { role: 'alert', style: { color: T.err } }, state.error, runId === latestRunId && canPoll ? '；将自动重试，也可刷新记录。' : '；请刷新记录重试。') : null,
        h('p', { role: 'status', style: { color: T.text2, margin: !state.loading && !state.error && ['unavailable', 'no-session'].includes(state.source) ? undefined : 0 } },
          !state.loading && !state.error && state.source === 'unavailable' ? '宿主暂时无法读取此会话记录。' :
            !state.loading && !state.error && state.source === 'no-session' ? '此运行尚未关联 DSH 会话，暂无会话记录。' : ''),
        !state.loading && !state.error && state.source === 'corrupt' ? h('p', { role: 'alert', style: { color: T.err } }, '此会话记录无法回放，宿主报告记录损坏；原始记录仍被保留。') : null,
        state.events.length > 0 && (state.error || ['no-session', 'unavailable', 'corrupt'].includes(state.source)) ? h('p', { style: { color: T.warn, fontSize: '12px' } }, '以下是上次成功读取的记录，可能不完整或已过期。') : null,
        view === 'conversation' && liveError ? h('p', { role: 'status', style: { color: T.warn, fontSize: '12px' } }, live ? '实时连接暂不可用，正在自动重试；保留的实时片段可能已过期或与已保存记录重复。' : '实时内容暂不可用，正在自动重试；已记录内容仍可查看。') : null,
        view === 'usage' ? usage.status === 'loading' ? h('p', { role: 'status', style: { color: T.text2 } }, '正在读取用量…') : usage.status !== 'available' ? h('p', { style: { color: T.text2, fontSize: '13px' } }, '当前会话的用量数据暂不可用。') : h('div', { 'data-run-usage-summary': 'true', style: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '8px', fontVariantNumeric: 'tabular-nums' } },
          [['模型', usage.model ?? '未知'], ['输入 / 输出', `${count(usage.inputTokens)} / ${count(usage.outputTokens)}`], ['缓存命中率', usage.cacheHitPct == null ? '未知' : `${count(usage.cacheHitPct)}%`], ['估算费用', usd(usage.estimatedCostUsd)]].map(([label, value]) => h('div', { key: label, style: { minWidth: 0, padding: '8px', border: `1px solid ${T.line}`, borderRadius: '6px' } }, h('div', { style: { fontSize: '11px', color: T.text3 } }, label), h('div', { style: { marginTop: '2px', fontSize: '13px', overflowWrap: 'anywhere' } }, value))),
        ) :
          h('div', null,
            view === 'conversation' && projected.summary.actions ? h('div', { 'data-run-work-summary': 'true', style: { margin: '0 0 12px', padding: '10px 12px', background: T.layer2, borderLeft: `3px solid ${T.brand}`, fontSize: '13px', color: T.text2 } },
              h('strong', { style: { color: T.text } }, '本轮工作摘要'),
              ` · 已记录 ${projected.summary.actions} 个工程动作${projected.summary.mutations ? `，修改 ${projected.summary.mutations} 个文件` : ''}${projected.summary.verification ? `，最近验证${projected.summary.verification.status === 'completed' ? '通过' : '失败'}` : ''}`,
            ) : null,
            !state.loading && !state.error && !['no-session', 'unavailable', 'corrupt'].includes(state.source) && !(view === 'conversation' ? conversation.length : actions.length) && !(view === 'conversation' && (liveError || (live && (live.text || live.reasoning)))) ? h('p', { style: { color: T.text2, fontSize: '13px' } }, view === 'trace' ? '正在等待第一项工程动作。' : '此会话暂无可显示的记录。') : null,
            view === 'conversation' ? conversation.map(row => {
              const entry = row.entry
              if (row.kind === 'dispatch') return h('article', { key: `${entry.sessionId}:${entry.seq}:${entry.eventHash ?? ''}`, 'data-run-dispatch': 'true', style: { borderTop: `1px solid ${T.line}`, padding: '12px 0', minWidth: 0 } },
                h('strong', { style: { fontSize: '13px' } }, '🚀 推进任务已派发'),
                h('p', { style: { margin: '5px 0 0', color: T.text2, fontSize: '13px' } }, `已向 AI 下发推进指令 · 锚定需求版本 ${requirementVersion} · ${state.sessions[segment]?.reason === 'resume' ? '断点续跑' : '初始推进'}`),
                h('details', { style: { marginTop: '8px', fontSize: '13px', color: T.text2 } }, h('summary', { style: { cursor: 'pointer' } }, '查看原始指令'), h('p', { style: { margin: '8px 0 0', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.65 } }, entry.text)),
              )
              if (row.kind === 'audit') return h('article', { key: `${entry.sessionId}:${entry.seq}:${entry.eventHash ?? ''}`, 'data-internal-audit': 'true', style: { borderTop: `1px solid ${T.line}`, padding: '12px 0', minWidth: 0, background: T.layer2 } },
                h('strong', { style: { fontSize: '13px' } }, '🔍 AI 内部质量自检报告'),
                row.findings.length ? h('ul', { style: { margin: '7px 0 0', paddingLeft: '18px', fontSize: '13px', lineHeight: 1.7, color: T.text2 } }, row.findings.map(finding => h('li', { key: finding }, finding))) : h('p', { style: { margin: '6px 0 0', fontSize: '13px', color: T.text2 } }, 'AI 已完成内部审查，未发现可直接展示的业务待补齐项。'),
                h('details', { style: { marginTop: '8px', fontSize: '12px', color: T.text2 } }, h('summary', { style: { cursor: 'pointer' } }, '查看原始自检日志'), h(RunEventText, { entry, field: 'text', root, requirementId: item.id, runId, segment })),
              )
              return h(OutcomeSummaryCard, { key: `${entry.sessionId}:${entry.seq}:${entry.eventHash ?? ''}`, entry, root, requirementId: item.id, runId, segment, hasCurrentCandidate })
            }) : actions.map((action, index) => {
              const output = action.result
              const call = action.call
              const status = action.status === 'failed' ? '🔴 失败' : action.status === 'completed' ? '🟢 完成' : '进行中'
              return h('article', { key: `${call?.sessionId ?? output?.sessionId}:${call?.seq ?? output?.seq}:${index}`, 'data-engineering-action': action.type, style: { borderTop: `1px solid ${T.line}`, padding: '12px 0', minWidth: 0, contentVisibility: 'auto', containIntrinsicSize: 'auto 100px' } },
                h('div', { style: { display: 'flex', gap: '10px', alignItems: 'baseline', flexWrap: 'wrap', fontSize: '13px' } }, h('strong', null, `${action.icon} ${action.title}`), h('span', { style: { color: action.status === 'failed' ? T.err : action.status === 'completed' ? T.ok : T.text2, fontSize: '12px' } }, status)),
                call?.text ? h('details', { style: { marginTop: '8px', fontSize: '12px', color: T.text2 } }, h('summary', { style: { cursor: 'pointer' } }, '查看调用参数'), h(RunEventText, { entry: call, field: 'text', root, requirementId: item.id, runId, segment })) : null,
                output?.text ? h('details', { style: { marginTop: '8px', fontSize: '13px', color: T.text2 } }, h('summary', { style: { cursor: 'pointer' } }, '查看输出'), h(RunEventText, { entry: output, field: 'text', root, requirementId: item.id, runId, segment, display: action.type === 'skill' ? runToolOutput : undefined })) : null,
                output?.nonTextBlocks ? h('p', { style: { color: T.text2, fontSize: '12px' } }, `包含 ${output.nonTextBlocks} 项非文本内容，当前未展示。`) : null,
              )
            }),
            view === 'trace' && projected.systemEvents.length ? h('details', { 'data-run-system-events': 'true', style: { marginTop: '12px', fontSize: '12px', color: T.text2 } }, h('summary', { style: { cursor: 'pointer' } }, `底层系统事件 (${projected.systemEvents.length} 条)`), h('ul', { style: { margin: '8px 0 0', paddingLeft: '18px' } }, projected.systemEvents.map(event => h('li', { key: `${event.seq}:${event.name}` }, event.name)))) : null,
            view === 'conversation' && live && (live.text || live.reasoning) ? h('article', { 'data-live-attempt': 'true', style: { borderTop: `1px solid ${T.line}`, padding: '12px 0', minWidth: 0 } },
              h('strong', { style: { fontSize: '12px' } }, 'AI 正在回复'),
              live.truncated ? h('p', { style: { color: T.text2, fontSize: '12px' } }, '实时内容过长，当前显示开头；完成后可查看完整记录。') : null,
              live.text ? h('p', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: '13px', lineHeight: 1.7 } }, live.text) : null,
              live.reasoning ? h('details', null, h('summary', { style: { color: T.text2, fontSize: '13px' } }, '模型提供的实时推理内容'), h('p', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: '13px' } }, live.reasoning)) : null,
            ) : null,
            h('div', { ref: latestRef, tabIndex: -1, 'aria-label': '运行记录末尾' }),
          ),
      )
    }

    function ExecutionProgress({ item, detail, root, handlers, onAcceptance, onRefresh, onOpenSession }) {
      const run = detail.summaries?.run ?? {}
      const acceptance = detail.summaries?.acceptance ?? {}
      const candidate = detail.summaries?.candidate ?? {}
      const release = detail.summaries?.release ?? null
      const matter = detail.currentMatter ?? {}
      const blueprint = item.run?.blueprint ?? null
      const diagnostic = detail.executionDiagnostic ?? null
      const released = release?.released === true
      const candidateReady = candidate.current === true && !released
      const settled = ['waiting-input', 'paused', 'failed', 'done', 'cancelled'].includes(run.status)
      const title = released
        ? '📦 发布归档报告'
        : candidateReady
        ? '🎉 AI 已完成开发并通过验证，待人工签收'
        : settled ? '等待恢复推进或重新验证'
          : run.status === 'running' || run.status === 'queued' ? 'AI 正在编码'
            : matter.headline ?? '等待推进'
      const verification = humanAcceptanceState(acceptance)
      const action = matter.action ?? detail.primaryAction
      const invoke = id => handlers?.[id]?.()
      return h('div', { 'data-progress-compact': 'true', style: { display: 'grid', gap: '16px' } },
        h('section', { 'data-progress-status-card': 'true', style: { padding: '14px', border: `1px solid ${T.line2}`, borderLeft: `3px solid ${candidateReady ? T.ok : settled ? T.warn : T.brand}`, borderRadius: '8px', background: T.layer } },
          h('h2', { style: { margin: 0, fontSize: '16px' } }, title),
          matter.explanation ? h('p', { style: { margin: '5px 0 0', fontSize: '13px', color: T.text2, lineHeight: 1.6 } }, matter.explanation) : null,
          candidateReady && candidate.development?.pushedToRemoteDev ? h('p', { 'data-dev-branch-synced': 'true', style: { margin: '8px 0 0', color: T.ok, fontSize: '13px', lineHeight: 1.6 } }, `🌿 开发分支已同步：已提交并推送至 origin/${candidate.development.devBranch ?? 'develop'}（Commit: ${(candidate.development.devCommitSha ?? '').slice(0, 7)}）· 架构与数据档案已归档`) : null,
          candidateReady && candidate.development?.reason ? h('p', { style: { margin: '8px 0 0', color: T.warn, fontSize: '12px', lineHeight: 1.6 } }, `开发分支尚未自动同步：${candidate.development.reason}`) : null,
          released ? h('div', { 'data-release-summary': 'true', style: { marginTop: '12px', padding: '10px 12px', borderLeft: `3px solid ${T.ok}`, background: T.layer2, fontSize: '13px', color: T.text2, lineHeight: 1.6 } },
            h('strong', { style: { color: T.text } }, '发布归档已完成'),
            h('div', { style: { marginTop: '4px' } }, `发布记录 ${release.id ?? '—'} · 交付候选 ${release.candidateId ?? candidate.id ?? '—'}${release.releasedAt ? ` · ${formatLocalStamp(release.releasedAt)}` : ''}`),
            release.mainMerged ? h('div', { 'data-main-merged': 'true', style: { marginTop: '5px', color: T.ok } }, `✅ 代码与架构档案已合入 GitHub main 分支（Commit: ${(release.sourceControl?.mainMergeCommitSha ?? '').slice(0, 7)} · 分支: ${release.sourceControl?.devBranch ?? 'develop'} → ${release.sourceControl?.mainBranch ?? 'main'}）`) : null,
          ) : null,
          diagnostic ? h('div', { 'data-execution-diagnostic': 'true', style: { marginTop: '12px', padding: '10px 12px', borderLeft: `3px solid ${T.warn}`, background: T.layer2 } },
            h('strong', { style: { fontSize: '13px' } }, diagnostic.title),
            h('p', { style: { margin: '5px 0 0', fontSize: '13px', color: T.text2, lineHeight: 1.6 } }, diagnostic.summary),
            diagnostic.log ? h('details', { style: { marginTop: '8px', fontSize: '12px', color: T.text2 } }, h('summary', { style: { cursor: 'pointer' } }, '查看具体报错日志与诊断详情'), h('pre', { style: { margin: '8px 0 0', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'inherit' } }, diagnostic.log)) : null,
          ) : null,
          blueprint?.exists ? h('div', { 'data-blueprint-badge': 'true', style: { marginTop: '10px', fontSize: '12px', color: T.ok } }, `✓ 已生成执行蓝图（锁定修改范围 ${blueprint.allowedPathCount ?? 0} 个模块）`) : null,
          h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px' } },
            action?.id && handlers?.[action.id] ? h('button', { type: 'button', style: HUMAN_PRIMARY, disabled: action.enabled === false, onClick: () => invoke(action.id) }, diagnostic?.actionLabel ?? action.label) : null,
            onAcceptance && !item.closed ? h('button', { type: 'button', style: HUMAN_CONTROL, onClick: () => onAcceptance(item) }, '重新运行验证') : null,
            onOpenSession && run.sessionId ? h('button', { type: 'button', style: HUMAN_CONTROL, onClick: () => onOpenSession(run.sessionId) }, '在 DSH 中打开会话') : null,
            h('button', { type: 'button', style: HUMAN_CONTROL, onClick: () => onRefresh?.() }, '刷新状态'),
          ),
        ),
        h('section', { 'data-verification-candidate-card': 'true', style: { padding: '14px', border: `1px solid ${candidate.current === true ? T.ok : T.line}`, borderRadius: '8px', background: candidate.current === true ? 'rgba(53,196,122,.08)' : undefined } },
          h('h2', { style: { margin: '0 0 8px', fontSize: '15px' } }, '验证与交付状态'),
          h('p', { style: { margin: 0, fontSize: '13px', color: candidateReady || released ? T.ok : verification.color } }, released ? `最近验证：🟢 验证通过（发布归档 ${release.id ?? '已完成'}）` : candidateReady ? `最近验证：🟢 验证通过（交付候选 ${candidate.id ?? '已就绪'} 已就绪）` : `最近验证：${verification.label}${diagnostic?.summary ? ` · ${diagnostic.summary}` : ''}`),
          acceptance.finishedAt ? h('p', { style: { margin: '5px 0 0', fontSize: '12px', color: T.text2 } }, `最近执行：${formatLocalStamp(acceptance.finishedAt)}`) : null,
          diagnostic?.log ? h('details', { style: { marginTop: '8px', fontSize: '12px', color: T.text2 } }, h('summary', { style: { cursor: 'pointer' } }, '查看具体报错日志与诊断详情'), h('pre', { style: { margin: '8px 0 0', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'inherit' } }, diagnostic.log)) : null,
          h('p', { style: { margin: '8px 0 0', fontSize: '13px', color: candidateReady || released ? T.ok : T.text2 } }, released ? `交付候选 ${release.candidateId ?? candidate.id ?? '已生成'} 已完成签收与发布归档。` : candidate.exists ? candidateReady ? `交付候选 ${candidate.id ?? '已生成'} 已绑定当前需求与验证证据，等待人工签收。` : `交付候选：${candidate.id ?? '已生成'}，需要重新核验` : '尚未生成交付候选'),
        ),
      )
    }

    function V4DetailPage(props) {
      const { item, detail, root, handlers, tab, onNavigate, onClose, onRefresh, scrollRef } = props
      const [editing, setEditing] = useState(false)
      const [dirty, setDirty] = useState(false)
      const [more, setMore] = useState(false)
      const [runSelection, setRunSelection] = useState(null)
      const selectedRunId = runSelection?.requirementId === item.id && runSelection?.root === (item.root ?? root) ? runSelection.runId : null
      const mainScroll = useRef(0)
      const titleRef = useRef(null)
      const moreRef = useRef(null)
      const navigationTimerRef = useRef(null)
      const tabFocusTimerRef = useRef(null)
      useEffect(() => () => {
        clearTimeout(navigationTimerRef.current)
        clearTimeout(tabFocusTimerRef.current)
      }, [])
      useEffect(() => { titleRef.current?.focus?.({ preventScroll: true }) }, [item.id])
      const matter = detail.currentMatter ?? { kind: detail.question ? 'decision' : detail.context?.kind, headline: detail.context?.headline, explanation: detail.context?.explanation, action: detail.primaryAction }
      const leave = (callback) => { if (dirty && !window.confirm('还有未提交的内容。放弃这些草稿并离开？')) return false; setDirty(false); callback(); return true }
      useEffect(() => {
        if (!more) return
        const dismiss = event => { if (!moreRef.current?.contains(event.target)) setMore(false) }
        const key = event => { if (event.key === 'Escape') { event.stopPropagation(); setMore(false); moreRef.current?.querySelector('button')?.focus() } }
        document.addEventListener('pointerdown', dismiss)
        moreRef.current?.addEventListener('keydown', key)
        const menu = moreRef.current
        return () => { document.removeEventListener('pointerdown', dismiss); menu?.removeEventListener('keydown', key) }
      }, [more])
      useEffect(() => {
        const guard = (event) => { if (dirty) { event.preventDefault(); event.returnValue = '' } }
        window.addEventListener('beforeunload', guard)
        return () => window.removeEventListener('beforeunload', guard)
      }, [dirty])
      const onTabKeyDown = (event) => {
        if (!event.target?.closest?.('[data-detail-tab]')) return
        const order = HUMAN_TABS.map(entry => entry.id)
        const index = order.indexOf(tab)
        let next = null
        if (event.key === 'ArrowRight') next = order[Math.min(order.length - 1, index + 1)]
        else if (event.key === 'ArrowLeft') next = order[Math.max(0, index - 1)]
        else if (event.key === 'Home') next = 'requirement'
        else if (event.key === 'End') next = 'record'
        if (!next) return
        event.preventDefault()
        if (next === tab) return
        if (navigate(next, null, false)) {
          clearTimeout(tabFocusTimerRef.current)
          const previousFocus = document.activeElement
          tabFocusTimerRef.current = setTimeout(() => {
            if (document.activeElement !== previousFocus && document.activeElement !== document.body) return
            document.querySelector(`[data-detail-tab="${next}"]`)?.focus?.()
          }, 0)
        }
      }
      const navigate = (next, anchor = null, focusHeading = true) => leave(() => {
        if (tab === 'requirement') mainScroll.current = scrollRef.current?.scrollTop ?? 0
        setMore(false)
        onNavigate(next, anchor)
         clearTimeout(navigationTimerRef.current)
         clearTimeout(tabFocusTimerRef.current)
         const previousFocus = document.activeElement
         navigationTimerRef.current = setTimeout(() => {
           const container = scrollRef.current
           if (document.activeElement !== previousFocus && document.activeElement !== document.body) return
           if (anchor && container) {
             const node = Array.from(container.querySelectorAll('[data-detail-anchor]')).find(entry => entry.dataset.detailAnchor === anchor)
             if (node) {
               for (let parent = node; parent && parent !== container; parent = parent.parentElement) {
                 if (parent.tagName === 'DETAILS') parent.open = true
               }
               node.scrollIntoView?.({ block: 'start' })
               node.focus?.({ preventScroll: true })
             }
             return
           }
           if (next === 'requirement' && container) container.scrollTop = mainScroll.current
           if (focusHeading) {
             const heading = next === 'requirement' ? titleRef.current : titleRef.current
             heading?.focus?.({ preventScroll: true })
           }
         }, 60)
      })
      const viewRevision = detail.identity?.revision ?? item.revision ?? 1
      const cancelPendingFocus = () => { clearTimeout(navigationTimerRef.current); clearTimeout(tabFocusTimerRef.current) }
      return h('section', { 'data-detail-shell': 'true', 'data-detail-page': 'v4', onPointerDownCapture: cancelPendingFocus, onKeyDownCapture: cancelPendingFocus, onKeyDown: onTabKeyDown, style: { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', background: T.base, minWidth: 0 } },
        h('style', null, `[data-detail-page] .v4-reading{box-sizing:border-box;width:100%;max-width:864px;margin:0 auto;padding:24px 32px 48px;font-size:16px;line-height:1.6;overflow-wrap:anywhere;}@container (max-width:959px){[data-detail-page] .v4-reading{padding-left:24px;padding-right:24px}}@container (max-width:639px){[data-detail-page] .v4-reading{padding-left:16px;padding-right:16px}}[data-detail-page] button:focus-visible,[data-detail-page] input:focus-visible,[data-detail-page] textarea:focus-visible,[data-detail-page] summary:focus-visible,[data-detail-page] h1:focus-visible,[data-detail-page] h2:focus-visible,[data-detail-page] [data-detail-anchor]:focus-visible{outline:2px solid ${T.brand};outline-offset:3px}[data-detail-page] button:disabled{opacity:.5;cursor:not-allowed}[data-detail-page] [data-detail-section] h4{font-size:15px!important;color:${T.text}!important}[data-detail-page] [data-detail-section]{font-size:16px!important;line-height:1.6!important}[data-detail-page] [data-detail-section]>summary{min-height:44px;align-items:center!important;font-size:14px}[data-detail-page] [data-detail-section]>summary h3{font-size:14px!important}[data-detail-page] [data-detail-section] button{min-height:40px;font-size:13px!important;padding:8px 12px!important;color:${T.text}!important;border:1px solid ${T.line2}!important;border-radius:7px}[data-detail-page] [data-detail-section] button:disabled{color:${T.text3}!important}[data-detail-page] [data-detail-section] summary{cursor:pointer}[data-detail-page] [data-detail-section] summary::marker{color:${T.text2}}`),
        h('style', null, `[data-detail-page] select:focus-visible{outline:2px solid ${T.brand};outline-offset:3px}[data-detail-page] [data-human-long]:has(> details[open]) > [data-human-excerpt]{display:none}[data-detail-page] .v4-reading{max-width:1280px!important;margin-left:0!important;margin-right:0!important;padding-left:24px!important;padding-right:24px!important}[data-detail-page] .detail-columns{display:grid;grid-template-columns:minmax(0,1fr) 250px;gap:32px;align-items:start}[data-detail-page] .requirement-body{display:flex;flex-direction:column}[data-detail-page] .requirement-body>[data-detail-description]{display:contents}[data-detail-page] .requirement-body [data-description-source]{order:3}[data-detail-page] .requirement-body>[data-human-verification]{order:1}[data-detail-page] .requirement-body>[data-iteration-feedback]{order:2}[data-detail-page] .description-cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}[data-detail-page] #v4-more-actions button:hover{background:${T.layer}}[data-detail-page] .detail-sidebar{border:1px solid ${T.line};border-radius:10px;background:${T.layer};padding:12px 14px;position:sticky;top:0}@container (max-width:800px){[data-detail-page] .detail-columns{grid-template-columns:minmax(0,1fr)}[data-detail-page] .detail-sidebar{position:static}[data-detail-page] .description-cards{grid-template-columns:minmax(0,1fr)}}`),
        h('nav', { 'aria-label': '需求导航', style: { flexShrink: 0, display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 16px', borderBottom: `1px solid ${T.line}` } },
          h('button', { style: HUMAN_CONTROL, onClick: () => leave(onClose), 'data-drawer-close': 'true' }, '← 返回需求列表'),
          h('span', { style: { flex: 1 } }),
          matter.action?.enabled !== false && handlers[matter.action?.id] ? h('button', { type: 'button', style: HUMAN_PRIMARY, onClick: () => handlers[matter.action.id]() }, matter.action.label) : null,
          h('div', { ref: moreRef, style: { position: 'relative' } },
            h('button', { style: HUMAN_CONTROL, 'aria-expanded': more, 'aria-controls': 'v4-more-actions', onClick: () => setMore(value => !value) }, '更多 ▾'),
            more ? h('div', { id: 'v4-more-actions', role: 'group', 'aria-label': '更多操作', style: { position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 20, width: '210px', padding: '6px', display: 'grid', gap: '4px', border: `1px solid ${T.line2}`, borderRadius: '10px', background: T.base, boxShadow: '0 8px 32px rgba(0,0,0,.24)' } },
              h('button', { style: DETAIL_MENU_ITEM, disabled: isExecutingRequirement(item), onClick: () => leave(() => { setEditing(true); setMore(false); onNavigate('requirement') }) }, '编辑需求'),
              h('button', { style: DETAIL_MENU_ITEM, onClick: () => { setMore(false); onRefresh?.() } }, '刷新状态'),
              props.onCancelRun && canCancelRequirementRun(detail.summaries?.run ?? item.run) ? h('button', { style: { ...DETAIL_MENU_ITEM, color: T.err, marginTop: '6px' }, 'data-detail-cancel-run': 'true', onClick: () => { setMore(false); props.onCancelRun(item) } }, '取消本轮推进…') : null,
              props.onArchive ? h('button', { style: DETAIL_MENU_ITEM, onClick: () => leave(() => { setMore(false); props.onArchive(item) }) }, '归档需求…') : null,
              props.onRemove ? h('button', { style: { ...DETAIL_MENU_ITEM, color: T.err }, onClick: () => leave(() => { setMore(false); props.onRemove(item) }) }, '删除需求…') : null,
            ) : null,
          ),
        ),
        h('div', { role: 'tablist', 'aria-label': '需求页签', style: { flexShrink: 0, display: 'flex', padding: '0 16px', gap: '8px', overflowX: 'auto', borderBottom: `1px solid ${T.line}`, background: T.base } }, HUMAN_TABS.map(entry => h('button', { key: entry.id, id: `v4-tab-${entry.id}`, role: 'tab', tabIndex: tab === entry.id ? 0 : -1, 'data-detail-tab': entry.id, 'aria-selected': tab === entry.id, 'aria-controls': 'v4-detail-body', onClick: () => navigate(entry.id), style: { flexShrink: 0, minHeight: '44px', border: 0, borderBottom: `2px solid ${tab === entry.id ? T.brand : 'transparent'}`, background: 'transparent', color: tab === entry.id ? T.text : T.text2, padding: '8px 12px', fontSize: '14px', fontWeight: tab === entry.id ? 600 : 400, cursor: 'pointer' } }, entry.label))),
        h('div', { id: 'v4-detail-body', role: 'tabpanel', 'aria-labelledby': `v4-tab-${tab}`, ref: scrollRef, style: { flex: 1, minHeight: 0, overflowY: 'auto', containerType: 'inline-size' } },
          h('article', { className: 'v4-reading', 'data-progress-reading': tab === 'delivery' ? 'true' : undefined },
            h('div', { 'data-detail-id': item.id, style: { fontSize: '12px', color: T.text3, marginBottom: '8px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' } }, h('span', null, item.id, ' · ', h('span', { 'data-detail-revision': String(viewRevision) }, `v${viewRevision}`)), h('span', { style: { border: `1px solid ${T.line2}`, borderRadius: '999px', padding: '2px 8px', color: T.text2 } }, item.delivery?.label ?? detail.summaries?.delivery?.label ?? '待推进')),
            h('h1', { ref: titleRef, tabIndex: -1, id: detailTitleId(item), style: { fontFamily: 'inherit', fontSize: '20px', fontWeight: 600, lineHeight: 1.45, letterSpacing: 0, margin: '0 0 18px' } }, item.title),
            item.pendingPatch && (tab === 'requirement' || tab === 'delivery') ? h(IterationFeedback, { key: item.id, item, root, onRefresh }) : null,
            h('div', { className: 'detail-columns' }, h('div', { style: { minWidth: 0 } }, tab !== 'requirement' ? h('div', null,
              tab === 'record' ? h(RequirementRecord, { ...props, onNavigate: (next, anchor) => { if (anchor === 'delivery-run-observation') setRunSelection(null); navigate(next, anchor) }, onOpenRun: runId => { setRunSelection({ requirementId: item.id, root: item.root ?? root, runId }); navigate('delivery', 'delivery-run-observation') } }) : h('div', null,
                !(detail.summaries?.run?.exists || item.run?.id || selectedRunId || detail.summaries?.candidate?.exists || item.candidate?.exists || detail.question || matter.kind === 'decision') ? h('section', { 'data-progress-not-started': 'true', style: { padding: '24px', border: `1px solid ${T.line}`, borderRadius: '10px', background: T.layer } },
                  h('h2', { style: { margin: '0 0 8px', fontSize: '18px' } }, '待启动 AI 推进'),
                  h('p', { style: { color: T.text2, lineHeight: 1.7 } }, '启动后 AI 将在授权范围内自动完成代码实现与验证，遇到业务取舍或需求变更时会向你发起确认。'),
                  handlers[matter.action?.id] ? h('button', { type: 'button', style: HUMAN_PRIMARY, disabled: matter.action?.enabled === false, onClick: () => handlers[matter.action.id]() }, '交给 AI 推进') : null,
                ) : h('div', null,
                 h(ExecutionProgress, { item, detail, root: item.root ?? root, handlers, onAcceptance: props.onAcceptance, onRefresh: props.onRefresh, onOpenSession: props.onOpenSession }),
                 h(RunObservationPanel, { item, detail, root: item.root ?? root, initialRunId: selectedRunId, onOpenSession: props.onOpenSession })),
            )) : editing ? h(InlineRequirementEditor, { item, root, onDirty: setDirty, onCancel: () => leave(() => setEditing(false)), onDone: () => { setDirty(false); setEditing(false); onRefresh?.() } }) : h('div', { className: 'requirement-body' },
              h(DetailDescription, { item, detail, root, onRefresh }),
              h(HumanVerification, { item, detail, matter }),
              !item.pendingPatch ? h(IterationFeedback, { key: item.id, item, root, onRefresh }) : null,
            )), h('aside', { className: 'detail-sidebar', 'aria-label': '需求属性' }, h('h2', { style: { fontSize: '15px', margin: '0 0 8px' } }, '需求属性'),
              ...[['负责人', item.owner || '未分配'], ['优先级', item.priority || '未设置'], ['来源', item.sourceSession ? '对话生成' : (item.sources?.map(source => ({ chat: '对话生成', manual: '手动创建' }[String(source).toLowerCase()] ?? source)).join('、') || '未登记')], ['当前修订', `v${viewRevision}`], ['最近更新', detail.identity?.updatedAt ? formatLocalStamp(detail.identity.updatedAt) : '暂无记录']].map(([label, value]) => h('div', { key: label, style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', padding: '6px 0', fontSize: '13px', color: T.text2 } }, h('div', null, label), h('div', { style: { color: T.text, overflowWrap: 'anywhere', textAlign: 'right', minWidth: 0 } }, value))))),
          ),
        ),
      )
    }

    const DESCRIPTION_STATUS_LABELS = {
      canonical: { label: '已确认需求描述', tone: 'ok' },
      legacy: { label: '根据现有正文展示', tone: 'neutral' },
      unconfirmed: { label: 'AI 整理 · 未确认', tone: 'warn' },
    }

    function descriptionStatusBadge(status) {
      const key = Object.prototype.hasOwnProperty.call(DESCRIPTION_STATUS_LABELS, status) ? status : 'unconfirmed'
      const entry = DESCRIPTION_STATUS_LABELS[key]
      const color = entry.tone === 'warn' ? T.warn : entry.tone === 'ok' ? T.ok : T.text2
      return h(
        'span',
        {
          'data-description-status-badge': key,
          style: {
            fontSize: '11px',
            lineHeight: 1.6,
            color,
            border: `1px solid ${T.line2}`,
            borderRadius: '999px',
            padding: '0 8px',
            whiteSpace: 'nowrap',
          },
        },
        entry.label,
      )
    }

    function descriptionHasBody(doc) {
      if (!doc || typeof doc !== 'object') return false
      if (draftText(doc.goal).trim() || draftText(doc.problem).trim()) return true
      for (const key of ['features', 'acceptance', 'scope', 'outOfScope', 'constraints', 'pending']) {
        if (Array.isArray(doc[key]) && doc[key].length) return true
      }
      return false
    }

    function detailDescriptionModel(item, detail) {
      const content = detail?.content ?? {}
      const fromDetail = content.doc ?? null
      if (fromDetail && descriptionHasBody(fromDetail)) {
        const status = ['canonical', 'legacy', 'unconfirmed'].includes(fromDetail.status)
          ? fromDetail.status
          : item?.docMeta?.source === 'legacy'
            ? 'legacy'
            : 'canonical'
        return { doc: fromDetail, status, unparsed: Array.isArray(fromDetail.unparsed) ? fromDetail.unparsed : [], derived: false }
      }
      const docView = item?.docView ?? null
      const parsed = docView?.doc ?? (descriptionHasBody(docView) ? docView : null)
      if (parsed && descriptionHasBody(parsed)) {
        const status = docView?.legacy === true || item?.docMeta?.source === 'legacy' ? 'legacy' : 'canonical'
        return { doc: { ...parsed, status }, status, unparsed: Array.isArray(docView?.unparsed) ? docView.unparsed : [], derived: false }
      }
      const sections = Array.isArray(content.sections) ? content.sections : []
      const displaySections = sections.filter(section => !section?.sameAs && draftText(section?.text).trim())
        .map(section => ({ title: draftText(section.title).trim() || '需求内容', text: draftText(section.text).trim() }))
      const claim = sections.find((section) => section?.kind === 'claim')
      const background = sections.find((section) => section?.kind === 'background')
      const fallbackText = draftText(claim?.text) || draftText(background?.text) || draftText(item?.briefText) || sections.map(section => draftText(section?.text)).filter(Boolean).join('\n\n') || (fromDetail?.unparsed ?? []).map(entry => draftText(entry?.text ?? entry)).filter(Boolean).join('\n\n')
      if (!fallbackText.trim()) return null
      return {
        doc: {
          goal: fallbackText,
          problem: draftText(background?.text),
          features: [],
          acceptance: [],
          scope: [],
          outOfScope: [],
          constraints: [],
          pending: [],
          provenance: 'unconfirmed',
          status: 'legacy',
        },
        status: 'legacy',
        unparsed: [],
        derived: true,
        displaySections,
        fallbackText: draftText(background?.text),
      }
    }

    function DetailDescription({ item, detail, root, onRefresh }) {
      const model = detailDescriptionModel(item, detail)
      const [organize, setOrganize] = useState({ open: false, busy: false, error: null, draft: null, baseline: null, diff: null, revision: null })
      if (!model) return null
      const { doc, status } = model
      const content = detail?.content ?? {}
      const features = Array.isArray(doc.features) ? doc.features : []
      const acceptance = Array.isArray(doc.acceptance) ? doc.acceptance : []
      const sections = Array.isArray(content.sections) ? content.sections : []
      const sourceRows = []
      for (const feature of features) {
        for (const source of draftList(feature?.sources)) sourceRows.push(`${draftText(feature?.id)} 来源：${source}`)
      }
      for (const entry of acceptance) {
        for (const source of draftList(entry?.sources)) sourceRows.push(`${draftText(entry?.id)} 来源：${source}`)
      }
      for (const section of sections) {
        if (section?.kind !== 'background' && section?.kind !== 'ai-suggestion') continue
        const text = draftText(section?.text)
        if (text) sourceRows.push(`${draftText(section?.title) || '原始意图'}：${text}`)
      }
      if (model.fallbackText) sourceRows.push(`原始背景：${model.fallbackText}`)
      const unparsed = Array.isArray(model.unparsed) ? model.unparsed : []
      const originalText = [item.sourceSession ? `来源会话：${item.sourceSession}` : '', ...sections.filter(section => section?.kind === 'background').map(section => draftText(section?.text)), ...unparsed.map(entry => draftText(entry?.text ?? entry))].filter(Boolean).join('\n\n').replace(/<!--\s*alm:meta\b[\s\S]*?-->/g, '')
      const meta = item?.docMeta ?? {}
      const paragraph = { fontSize: '14px', lineHeight: 1.65, color: T.text2, whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowWrap: 'anywhere' }
      const list = (rows, empty) =>
        rows.length
          ? h(
              'ul',
              { style: { margin: '2px 0 0', paddingLeft: '18px', fontSize: '13.5px', lineHeight: 1.7, color: T.text2 } },
              rows.map((row, index) => h('li', { key: `${index}-${row.slice(0, 24)}` }, row)),
            )
          : h('div', { style: { fontSize: '12.5px', color: T.text3, marginTop: '2px' } }, empty)
      const runOrganize = () => {
        if (organize.busy) return
        setOrganize((current) => ({ ...current, open: true, busy: true, error: null, revision: null }))
        writeJson('description', { action: 'organize', requirementId: item.id }, root)
          .then((payload) => {
            setOrganize({
              open: true,
              busy: false,
              error: null,
              draft: payload?.draft ?? null,
              baseline: payload?.baseline ?? null,
              diff: payload?.diff ?? null,
              revision: null,
            })
          })
          .catch((error) => setOrganize((current) => ({ ...current, busy: false, error: error?.message ?? String(error) })))
      }
      const saveOrganize = () => {
        if (organize.busy || !organize.draft?.markdown) return
        setOrganize((current) => ({ ...current, busy: true, error: null, revision: null }))
        writeJson(
          'description',
          {
            action: 'save',
            requirementId: item.id,
            markdown: organize.draft.markdown,
            doc: organize.draft.doc ?? null,
            expectedBaseline: organize.baseline ?? null,
            apply: true,
          },
          root,
        )
          .then((payload) => {
            setOrganize((current) => ({
              ...current,
              busy: false,
              error: null,
              revision: payload?.revision ?? null,
              draft: payload?.docHash ? { ...current.draft, docHash: payload.docHash } : current.draft,
            }))
            if (typeof onRefresh === 'function') onRefresh()
          })
          .catch((error) => {
            const conflict = error?.code === 'stale-baseline'
            setOrganize((current) => ({
              ...current,
              busy: false,
              error: conflict ? '正文已变化（stale-baseline），请重新整理后再保存。' : error?.message ?? String(error),
            }))
          })
      }
      const organizeRow = (label, body) =>
        h(
          'div',
          { style: { display: 'flex', gap: '10px', alignItems: 'baseline', padding: '3px 0', minWidth: 0 } },
          h('div', { style: { flex: '0 0 74px', fontSize: '12px', color: T.text3 } }, label),
          h('div', { style: { flex: '1 1 auto', minWidth: 0, ...paragraph, fontSize: '13.5px' } }, body),
        )
      return h(
        'section',
        {
          'data-detail-description': 'true',
          'data-description-status': status,
          'aria-label': '需求描述',
          style: { margin: '0', paddingTop: '22px', borderTop: `1px solid ${T.line}`, minWidth: 0 },
        },
        h(HumanDescriptionBody, { model, status }),
        h('details', { 'data-description-source': 'true', style: { marginTop: '18px', fontSize: '12px', color: T.text3 } },
          h('summary', { style: { cursor: 'pointer' } }, '原始记录与调查证据'),
          h('div', { style: { marginTop: '12px', lineHeight: 1.8, overflowWrap: 'anywhere' } }, originalText ? renderRich(originalText) : null),
          features.some(feature => feature?.sources?.length) || acceptance.some(entry => entry?.sources?.length) ? h('div', { style: { marginTop: '12px' } }, list(sourceRows, '')) : null,
          h('div', { style: { marginTop: '12px', fontSize: '11px', overflowWrap: 'anywhere' } },
            status === 'legacy' ? '按现有正文展示，尚未确认结构化描述。' : '来源：需求描述',
            meta.docHash ? h('p', null, '内容指纹：', String(meta.docHash).replace(/^sha256:/, '').slice(0, 8)) : null,
            meta.revision || item.revision ? h('p', null, `修订 v${meta.revision ?? item.revision}`) : null,
          ),
        ),
        status === 'legacy' ? h('details', { 'data-description-tools': 'true', open: organize.open || undefined, style: { marginTop: '12px', fontSize: '12px', color: T.text3 } },
          h('summary', { style: { cursor: 'pointer' } }, '需求整理工具'),
          h('p', { style: { lineHeight: 1.8 } }, '将现有正文整理成结构化描述，先预览，再决定是否保存。'),
          h('button', { type: 'button', 'data-organize-description': 'true', style: button, disabled: organize.busy || isExecutingRequirement(item), onClick: runOrganize }, organize.busy ? '整理中…' : '整理需求描述'),
          isExecutingRequirement(item) ? h('p', null, 'AI 正在推进，结束后可整理正文。') : null,
        ) : null,
        organize.open || organize.error
          ? h(
              'div',
              { 'data-organize-panel': 'true', style: { marginTop: '10px', borderTop: `1px solid ${T.line}`, paddingTop: '8px' } },
              organize.error ? h('div', { style: { fontSize: '12px', color: T.err, marginBottom: '4px' } }, organize.error) : null,
              organize.draft
                ? h(
                    'div',
                    { minWidth: 0 },
                    h(DraftDiffSummary, { diff: organize.diff }),
                    h('div', { style: { fontSize: '12px', color: T.text3, marginTop: '6px' } }, '整理预览（保存前不会写入）'),
                    h(
                      'pre',
                      {
                        'data-organize-preview': 'true',
                        style: {
                          margin: '4px 0 0',
                          maxHeight: '240px',
                          overflow: 'auto',
                          background: T.layer2,
                          border: `1px solid ${T.line}`,
                          borderRadius: '8px',
                          padding: '8px 10px',
                          fontSize: '11.5px',
                          lineHeight: 1.6,
                          color: T.text2,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                        },
                      },
                      draftText(organize.draft.markdown) || draftText(organize.draft.doc?.goal),
                    ),
                    h(
                      'div',
                      { style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px', flexWrap: 'wrap' } },
                      h('button', { type: 'button', 'data-organize-save': 'true', style: { ...primary, padding: '3px 12px' }, disabled: organize.busy, onClick: saveOrganize }, organize.busy ? '保存中…' : '保存为规范描述'),
                      organize.revision ? h('span', { 'data-organize-notice': String(organize.revision), style: { fontSize: '12px', color: T.ok } }, `已保存为 v${organize.revision}`) : null,
                      h('button', { type: 'button', style: { ...button, padding: '3px 10px' }, disabled: organize.busy, onClick: () => setOrganize((current) => ({ ...current, open: false, draft: null, diff: null, error: null })) }, '收起'),
                    ),
                  )
                : h('div', { style: { fontSize: '12px', color: T.text3 } }, organize.busy ? '正在整理现有正文…' : '整理结果为空。'),
            )
          : null,
      )
    }
    function RequirementDetailShell({
      item,
      detail,
      allItems,
      root,
      narrow,
      tab,
      onTabChange,
      onNavigate,
      onOpenDecision,
      scrollRef,
      handlers,
      startIsolate,
      onToggleIsolate,
      notice,
      setNotice,
      onClose,
      onSnapshot,
      onDiff,
      onTrace,
      onAcceptance,
      onSignoff,
      onRelease,
      onAiReview,
      onRehearsal,
      onArchive,
      onRemove,
      onCancelRun,
      onRefresh,
      onDefect,
    }) {
      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, minWidth: 0 } },
        h('style', null, DETAIL_SHELL_CSS),
        h(DetailHeader, { item, detail, tab, root, narrow, notice, setNotice, onClose, onArchive, onRemove, onCancelRun, onRefresh }),
        h(
          'div',
          { ref: scrollRef, style: { flex: '1 1 auto', overflowY: 'auto', overflowX: 'hidden', minHeight: 0 } },
          h(
            'div',
            { 'data-detail-body': 'true', style: { width: '100%', maxWidth: '720px', margin: '0 auto', padding: narrow ? '12px 16px 24px' : '14px 28px 28px', minWidth: 0 } },
            h(CurrentTaskSummary, { detail, onQuestion: onOpenDecision, onJump: (ref) => onNavigate(ref?.tab ?? 'delivery', ref?.anchor) }),
            h(DetailDescription, { item, detail, root, onRefresh }),
            h(DetailTabs, { tab, onChange: onTabChange, badges: { delivery: detail.tabs?.delivery?.badge ?? 0 } }),
            h(
              'div',
              { role: 'tabpanel', id: 'detail-panel', 'aria-labelledby': `detail-tab-${tab}`, style: { paddingTop: '6px', minWidth: 0 } },
              tab === 'delivery'
                ? h(DeliveryWorkspace, { item, detail, root, onNavigate, onOpenDecision, onAcceptance, onSignoff, onRelease, onAiReview, onRehearsal, onCancelRun, onRefresh, onDefect, onTrace, onSnapshot, onDiff })
                : tab === 'record'
                  ? h(RequirementRecord, { item, detail, allItems, root, onNavigate, onSnapshot, onDiff, onTrace, onRefresh })
                  : h(RequirementContent, { item, detail, onNavigate }),
            ),
          ),
        ),
        h(ContextActionFooter, { detail, onNavigate, handlers, startIsolate, onToggleIsolate, narrow }),
      )
    }

    function DrawerContent(props) {
      const { item, allItems, root, narrow } = props
      const detail = item && item.detailView ? item.detailView : fallbackDetailView(item, allItems)
      const executing = isExecutingRequirement(item)
      const [tab, setTab] = useState(() =>
        ['requirement', 'delivery', 'record'].includes(props.initialTab) ? props.initialTab : 'requirement',
      )
      const [startIsolate, setStartIsolate] = useState(false)
      const [decisionOpen, setDecisionOpen] = useState(false)
      const [notice, setNotice] = useState(null)
      const scrollRef = useRef(null)
      const timerRef = useRef(null)
      useEffect(() => () => {
        if (timerRef.current) clearTimeout(timerRef.current)
      }, [])
      useEffect(() => {
        if (!notice) return undefined
        const timer = setTimeout(() => setNotice(null), 4200)
        return () => clearTimeout(timer)
      }, [notice])
      const navigate = (nextTab, anchor) => {
        if (nextTab && nextTab !== tab) setTab(nextTab)
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => {
          const container = scrollRef.current
          if (!container) return
          const node = anchor ? container.querySelector(`[data-detail-anchor="${anchor}"]`) : null
          if (node) {
            for (let parent = node; parent && parent !== container; parent = parent.parentElement) {
              if (parent.tagName === 'DETAILS') parent.open = true
            }
            if (node.scrollIntoView) node.scrollIntoView({ block: 'start' })
            if (typeof node.focus === 'function') {
              try {
                node.focus({ preventScroll: true })
              } catch {}
            }
          } else {
            container.scrollTop = 0
          }
        }, 40)
      }
      const handlers = {
        'answer-run': () => props.onAnswer && props.onAnswer(item),
        'resume-run': () => props.onResumeRun && props.onResumeRun(item),
        'continue-run': () => props.onContinueRun && props.onContinueRun(item),
        start: () => props.onStart && props.onStart(item, { isolate: startIsolate }),
        'start-fix': () => props.onStart && props.onStart(item, { isolate: startIsolate }),
        'watch-run': () => navigate('delivery'),
        'fix-review': () => navigate('delivery', 'delivery-ai-suggestions'),
        'run-review': () => props.onAiReview && props.onAiReview(item),
        review: () => props.onAiReview && props.onAiReview(item),
        signoff: () => props.onSignoff && props.onSignoff(item),
        release: () => props.onRelease && props.onRelease(item),
        'execute-release': () => props.onRelease && props.onRelease(item),
        'create-candidate': () =>
          writeJson('candidate', { requirementId: item.id }, root)
            .then(() => props.onRefresh && props.onRefresh())
            .catch((error) => window.alert('生成交付候选失败：' + error.message)),
        refresh: () => props.onRefresh && props.onRefresh(),
        'open-record': () => setTab('record'),
      }
      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, minWidth: 0 } },
        h(V4DetailPage, {
          item,
          detail,
          allItems,
          root,
          narrow,
          onFeedback: props.onFeedback,
          tab,
          onTabChange: setTab,
          onNavigate: navigate,
          onOpenDecision: () => props.onAnswer && props.onAnswer(item),
          scrollRef,
          handlers,
          startIsolate,
          onToggleIsolate: setStartIsolate,
          notice,
          setNotice,
          onClose: props.onClose,
          onSnapshot: props.onSnapshot,
          onDiff: props.onDiff,
          onTrace: props.onTrace,
          onAcceptance: executing ? null : props.onAcceptance,
          onSignoff: executing ? null : props.onSignoff,
          onRelease: executing ? null : props.onRelease,
          onAiReview: executing ? null : props.onAiReview,
          onRehearsal: executing ? null : props.onRehearsal,
          onArchive: executing ? null : props.onArchive,
          onRemove: executing ? null : props.onRemove,
          onCancelRun: props.onCancelRun,
          onRefresh: props.onRefresh,
          onOpenSession: props.onOpenSession,
          onDefect: executing ? null : props.onDefect,
        }),
        decisionOpen ? h(DecisionTextModal, { item, root, onClose: () => setDecisionOpen(false) }) : null,
      )
    }

    function Drawer(props) {
      return h(DrawerContent, props)
    }

    function useDialogFocus(dialogRef, onClose) {
      const closeRef = useRef(onClose)
      closeRef.current = onClose
      useEffect(() => {
        const previous = document.activeElement
        const onKey = (event) => {
          if (feedbackLayerOpen()) return
          const dialogs = [...document.querySelectorAll('[role="dialog"]')]
          if (dialogs.at(-1) !== dialogRef.current) return
          if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); return }
          if (event.key !== 'Tab') return
          const nodes = [...dialogRef.current.querySelectorAll('button, input, textarea, select, summary, a[href], [tabindex]')].filter((node) => node.tabIndex >= 0 && !node.matches(':disabled') && !node.closest('[inert]') && node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden')
          const first = nodes[0], last = nodes.at(-1)
          if (!first) { event.preventDefault(); dialogRef.current.focus(); return }
          if (!nodes.includes(document.activeElement) || (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
            event.preventDefault(); (event.shiftKey ? last : first).focus()
          }
        }
        dialogRef.current?.focus?.()
        document.addEventListener('keydown', onKey)
        return () => {
          document.removeEventListener('keydown', onKey)
          if (previous && previous !== document.body && typeof previous.focus === 'function') {
            try { previous.focus() } catch {}
          }
        }
      }, [])
    }

    function SnapshotModal({ snapshot, onClose }) {
      const dialogRef = useRef(null)
      const { item, version, loading, content, error } = snapshot
      useDialogFocus(dialogRef, onClose)
      return h(
        'div',
        { style: { position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(4,6,9,.62)', backdropFilter: 'blur(6px)', display: 'grid', placeItems: 'center', padding: '24px' }, onClick: onClose },
        h(
          'div',
          {
            role: 'dialog',
            ref: dialogRef,
            tabIndex: -1,
            'aria-modal': 'true',
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
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
              layerFeedbackButton({ label: `版本快照 · ${version.short}`, context: { requirementId: item.id, requirementRevision: version.revision ?? null } }),
              h('button', { style: { ...button, borderColor: 'transparent', background: 'transparent', color: T.text2, fontSize: '18px' }, onClick: onClose, 'aria-label': '关闭' }, '×'),
            ),
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
                       overscrollBehavior: 'contain',
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
      const dialogRef = useRef(null)
      const trace = item.trace
      const [selectedNode, setSelectedNode] = useState(null)
      useDialogFocus(dialogRef, onClose)

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
            ref: dialogRef,
            tabIndex: -1,
            'aria-modal': 'true',
            'aria-label': `追溯视图 ${item.id}`,
            onClick: (event) => event.stopPropagation(),
            style: {
              width: '980px',
              maxWidth: '96vw',
              maxHeight: '90vh',
              overflowY: 'auto',
              overscrollBehavior: 'contain',
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
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
              layerFeedbackButton({ label: `追溯视图 · ${item.id}`, context: { requirementId: item.id, requirementRevision: item.revision ?? null, requirementFile: item.file ?? null } }),
              h('button', { style: { ...button, borderColor: 'transparent', background: 'transparent', color: T.text2, fontSize: '18px' }, onClick: onClose, 'aria-label': '关闭' }, '×'),
            ),
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
          const fallback =
            response.status === 404
              ? '接口不存在（HTTP 404）：需求插件可能尚未重载，请刷新页面或重启宿主后再试。'
              : `请求失败（HTTP ${response.status}）`
          const error = new Error(payload?.error?.message ?? fallback)
          // Keep the backend error code so callers can react to contract errors
          // (e.g. stale-preview) instead of guessing from the message text.
          error.code = payload?.error?.code ?? null
          if (Array.isArray(payload?.error?.candidates)) error.candidates = payload.error.candidates
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

    let modalSequence = 0
    function ModalShell({ title, lead, onClose, children, footer, width = '720px', feedbackContext = null, testId = null, dataSessionId = null, dataScreen = null }) {
      const dialogRef = useRef(null)
      const modalId = useRef(null)
      if (!modalId.current) modalId.current = `requirements-modal-${++modalSequence}`
      const titleId = testId ? `${testId}-title` : `${modalId.current}-title`
      const leadId = `${modalId.current}-lead`
      useDialogFocus(dialogRef, onClose)
      useEffect(() => {
        if (feedbackLayerOpen()) return
        const initial = dialogRef.current?.querySelector('[data-modal-initial-focus="true"]')
        if (initial && typeof initial.focus === 'function') initial.focus()
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
            gridTemplateColumns: 'minmax(0, 1fr)',
            placeItems: 'center',
            padding: '24px',
          },
          onClick: onClose,
        },
        h(
          'div',
          {
            role: 'dialog',
            ref: dialogRef,
            tabIndex: -1,
            'aria-modal': true,
            'aria-labelledby': titleId,
            'aria-describedby': lead ? leadId : undefined,
            'aria-busy': dataScreen === 'analyzing' ? 'true' : undefined,
            ...(testId ? { 'data-testid': testId } : {}),
            ...(dataSessionId ? { 'data-session-id': dataSessionId } : {}),
            ...(dataScreen ? { 'data-screen': dataScreen } : {}),
            onClick: (event) => event.stopPropagation(),
            style: {
              width,
              maxWidth: '100%',
              boxSizing: 'border-box',
              maxHeight: testId === 'intent-modal' ? '86vh' : '88vh',
              display: testId === 'intent-modal' ? 'flex' : undefined,
              flexDirection: testId === 'intent-modal' ? 'column' : undefined,
              overflowY: testId === 'intent-modal' ? 'hidden' : 'auto',
              overscrollBehavior: 'contain',
              background: T.base,
              border: `1px solid ${T.line2}`,
              borderRadius: '8px',
              padding: '20px 16px',
              boxShadow: '0 24px 80px rgba(0,0,0,.5)',
            },
          },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' } },
            h('h3', { id: titleId, style: { margin: 0, fontSize: '18px' } }, title),
            h(
              'button',
              {
                type: 'button',
                'data-modal-feedback': 'true',
                'aria-label': '反馈这个问题',
                title: '反馈：不用关闭弹层，会冻结当前界面上下文',
                onClick: (event) => {
                  event.stopPropagation()
                  // The modal names the exact object it is about (requirement,
                  // run, decision, failure), not just "a modal was open".
                  launchFeedbackFromLayer({ kind: 'modal', label: title, ...(feedbackContext ?? {}) })
                },
                style: {
                  flex: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  border: `1px solid ${T.line}`,
                  background: 'transparent',
                  color: T.text2,
                  borderRadius: '7px',
                  height: '28px',
                  padding: '0 10px',
                  cursor: 'pointer',
                  fontSize: '12px',
                },
              },
              '反馈',
            ),
            h('button', { type: 'button', 'aria-label': '关闭弹窗', onClick: onClose, style: { ...button, padding: '4px 9px', marginLeft: 'auto' } }, h(ActionIcon, { name: 'close', size: 16 })),
          ),
          lead ? h('p', { id: leadId, style: { margin: '8px 0 0', ...muted, lineHeight: 1.7 } }, lead) : null,
          testId === 'intent-modal' ? h('div', { style: { overflowY: 'auto', minHeight: 0, overscrollBehavior: 'contain' } }, children) : children,
          footer ? h('div', { style: { display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: '10px', marginTop: '18px', minWidth: 0, flexShrink: 0 } }, footer) : null,
        ),
      )
    }

    // A modal names the exact object it is about. The feedback launcher merges
    // this into the frozen workbench context, so the report is not guessed from
    // whatever `selected` happens to be.
    function feedbackContextFor(item, extra = {}) {
      return {
        requirementId: item?.id ?? null,
        requirementRevision: item?.revision ?? null,
        requirementFile: item?.file ?? null,
        runId: item?.run?.id ?? null,
        candidateId: item?.candidate?.id ?? null,
        ...extra,
      }
    }

    // Escape hatches that own their shell (snapshot, trace, crash boundary) use
    // this instead of ModalShell; the entry must still be where the problem is.
    function layerFeedbackButton({ label, context = null }) {
      return h(
        'button',
        {
          type: 'button',
          'data-layer-feedback': 'true',
          'aria-label': '反馈这个界面',
          title: '反馈：不关闭当前弹层，提交时会保留这里的现场',
          onClick: (event) => {
            event.stopPropagation()
            launchFeedbackFromLayer({ kind: 'modal', label, ...(context ?? {}) })
          },
          style: {
            flex: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            border: `1px solid ${T.line}`,
            background: 'transparent',
            color: T.text3,
            borderRadius: '7px',
            height: '26px',
            padding: '0 9px',
            cursor: 'pointer',
            fontSize: '11.5px',
          },
        },
        '反馈',
      )
    }

    function PlanRows({ rows }) {      return h(
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

    const PREFLIGHT_STATUS = {
      fixed: { label: '已自动处理', tone: '#34d399' },
      checked: { label: '已检查', tone: T.text3 },
      'carry-over': { label: '带入开发', tone: '#fbbf24' },
      'needs-decision': { label: '待你决定', tone: '#f59e0b' },
      skipped: { label: '跳过', tone: T.text3 },
      failed: { label: '失败', tone: '#f87171' },
    }

    function PreflightModal({ item, root, projectMeta, isolate = false, onClose, onStarted }) {
      const [state, setState] = useState({ phase: 'running', record: null, start: null, error: null })
      const [github, setGithub] = useState({ loading: false, plan: null, result: null, error: null })
      useEffect(() => {
        let alive = true
        writeJson('preflight', { requirementId: item.id, apply: true }, root)
          .then((record) => {
            if (!alive) return null
            setState((current) => ({ ...current, phase: record?.question ? 'question' : 'starting', record }))
            if (record?.question) return null
            return writeJson('start', { requirementId: item.id, apply: true, isolate, autoAdvance: true }, root).then((started) => {
              if (!alive) return
              setState({ phase: 'done', record, start: started, error: null })
              onStarted?.()
            })
          })
          .catch((error) => {
            if (alive) setState({ phase: 'error', record: null, start: null, error: error.message })
          })
        return () => {
          alive = false
        }
      }, [item.id, root])

      const proceed = () => {
        setState((current) => ({ ...current, phase: 'starting', error: null }))
        writeJson('start', { requirementId: item.id, apply: true, isolate, autoAdvance: true }, root)
          .then((started) => {
            setState((current) => ({ ...current, phase: 'done', start: started }))
            onStarted?.()
          })
          .catch((error) => setState((current) => ({ ...current, phase: 'error', error: error.message })))
      }

      const changeRoot = () => state.start?.worktree?.path ?? root
      const previewGithub = () => {
        const changeId = state.start?.changeId
        if (!changeId) return
        setGithub({ loading: true, plan: null, result: null, error: null })
        writeJson('github', { changeId, apply: false }, changeRoot())
          .then((plan) => setGithub({ loading: false, plan, result: null, error: null }))
          .catch((error) => setGithub({ loading: false, plan: null, result: null, error: error.message }))
      }
      const applyGithub = () => {
        const changeId = state.start?.changeId
        if (!changeId) return
        setGithub((current) => ({ ...current, loading: true, error: null }))
        writeJson('github', { changeId, apply: true }, changeRoot())
          .then((result) => {
            setGithub({ loading: false, plan: null, result, error: null })
            onStarted?.()
          })
          .catch((error) => setGithub((current) => ({ ...current, loading: false, error: error.message })))
      }

      const record = state.record
      const start = state.start
      const question = record?.question
      const running = state.phase === 'running'
      const footer = [
        question
          ? h('button', { key: 'cancel-question', style: button, onClick: onClose }, question.options?.find((option) => option.id === 'cancel')?.label ?? '先不开始')
          : h('button', { key: 'close', style: button, onClick: onClose }, start || state.phase === 'error' ? '关闭' : state.phase === 'running' ? '关闭（尚未启动）' : '关闭（启动请求已提交）'),
        question && state.phase === 'question' ? h('button', { key: 'proceed', style: primary, onClick: proceed }, question.options?.find((option) => option.id === 'proceed')?.label ?? '带着问题交给 AI 推进') : null,
      ]
      return h(
        ModalShell,
        {
          title: `交给 AI 推进 · ${item.id}`,
          lead: '先检查准备情况，再交给 AI。遇到需要你决定的问题会停下来；是否已启动，以这里的结果为准。',
          onClose,
          feedbackContext: feedbackContextFor(item),
          footer,
        },
        running ? h('p', { style: muted }, '正在自动检查并处理证据…') : null,
        state.phase === 'starting' ? h('p', { style: muted }, '证据已处理完，正在登记变更并交给 AI 推进…') : null,
        state.error ? h('p', { style: { color: T.err, fontSize: '13px' } }, state.error) : null,
        start?.execution?.runId ? h('section', { 'data-start-live-progress': 'true', 'aria-live': 'polite', style: { padding: '18px 0', borderBottom: '1px solid ' + T.line } },
          h('h3', { style: { margin: '0 0 8px', fontSize: '20px', color: T.text } }, item.detailView?.currentMatter?.headline ?? item.run?.label ?? 'AI 已接手，正在同步进展'),
          h('p', { style: { color: T.text2, lineHeight: 1.7, margin: 0 } }, item.detailView?.currentMatter?.explanation ?? '开发状态将自动更新。关闭此窗口不会停止 AI。'),
          h('p', { style: { ...muted, margin: '8px 0 0' } }, item.development ? '实际开发分支：' + (item.development.branch ?? '未知') + (item.development.dedicated ? ' · 独立功能分支' : ' · 当前工作区，尚未建立独立功能 PR') : '正在读取实际开发分支…'),
          h('p', { style: { ...muted, margin: '8px 0 0' } }, '每 3 秒自动同步；需要验收或业务决定时，这里的提示会更新。'),
        ) : null,

        record
          ? h(
              'div',
              { style: { marginTop: '10px' } },
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' } },
                h('span', { style: { fontSize: '12px', color: T.text3 } }, '检查结论'),
                h('span', { style: { fontSize: '12.5px', color: record.readiness?.ready ? '#34d399' : '#f59e0b' } }, record.readiness?.ready
                  ? `可以交给 AI 推进${(record.carryOver ?? []).length ? `；${record.carryOver.length} 项验收问题带入开发` : ''}`
                  : `需要你决定（${record.readiness?.label ?? record.decision?.label ?? '待处理'}）`),
              ),
              h('details', { 'data-preflight-steps': 'true', style: { marginTop: '12px' } },
                h('summary', { style: { cursor: 'pointer', color: T.text2, fontSize: '12px' } }, '查看检查过程'),
              h(
                'ul',
                { style: { margin: '8px 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '6px' } },
                (record.steps ?? []).map((step, index) => {
                  const meta = PREFLIGHT_STATUS[step.status] ?? { label: step.status, tone: T.text3 }
                  return h(
                    'li',
                    { key: `${step.code}-${index}`, style: { display: 'flex', alignItems: 'flex-start', gap: '10px', border: `1px solid ${T.line}`, borderRadius: '9px', padding: '8px 10px' } },
                    h('span', { style: { flex: 'none', fontSize: '10.5px', color: meta.tone, border: `1px solid ${meta.tone}44`, borderRadius: '999px', padding: '2px 8px', marginTop: '1px' } }, meta.label),
                    h(
                      'div',
                      { style: { minWidth: 0 } },
                      h('div', { style: { fontSize: '12.5px', color: T.text } }, step.title ?? step.code),
                      step.detail ? h('div', { style: { fontSize: '11.5px', color: T.text3, marginTop: '2px' } }, step.detail) : null,
                    ),
                  )
                }),
              ),
              ),
              (record.carryOver ?? []).length
                ? h(
                    'p',
                    { style: { margin: '8px 0 0', fontSize: '11.5px', color: '#fbbf24' } },
                    `带入开发继续处理：${record.carryOver.map((entry) => entry.message ?? entry.code ?? entry).join('；')}`,
                  )
                : null,
              question
                ? h(
                    'div',
                    { style: { marginTop: '12px', border: '1px solid #f59e0b66', borderRadius: '10px', padding: '10px 12px', background: '#f59e0b0d' } },
                    h('div', { style: { fontSize: '12.5px', color: '#f59e0b', marginBottom: '4px' } }, '需要你决定'),
                    h('div', { style: { fontSize: '12.5px', color: T.text2, lineHeight: 1.7 } }, question.message ?? question.code),
                  )
                : null,
              start
                ? h(
                    'div',
                    { style: { marginTop: '12px', borderTop: `1px solid ${T.line}`, paddingTop: '12px' } },
                    h('div', { style: { ...sectionTitle, margin: '0 0 8px' } }, '变更已登记'),
                    h('details', { style: { marginTop: '8px' } },
                      h('summary', { style: { cursor: 'pointer', color: T.text2, fontSize: '12px' } }, '查看变更与任务记录'),
                      h(PlanRows, {
                      rows: [
                        ['变更', start.changeId],
                        ['任务卡', `${start.draft?.tasks?.length ?? 0} 张`],
                        ['文件', start.draft?.files?.join('、') ?? '—'],
                        ...(start.worktree ? [['隔离 worktree', start.worktree.path], ['分支', start.worktree.branch]] : []),
                      ],
                    })),
                    h('p', { style: { margin: '8px 0 0', ...muted } }, '可以在右侧需求详情里继续查看变更、任务卡与 GitHub 归属。'),
                    !start.execution
                      ? h('p', { style: { margin: '8px 0 0', fontSize: '12px', color: '#f59e0b' } }, '预览模式：未调度 AI 推进。')
                      : start.execution.scheduled
                        ? h('p', { style: { margin: '8px 0 0', fontSize: '12px', color: '#34d399' } }, `AI 已接手本轮交付（运行 ${start.execution.runId ?? '—'} · 会话 ${start.execution.sessionId ?? '—'}）；关闭面板后仍会继续。`)
                        : h('p', { style: { margin: '8px 0 0', fontSize: '12px', color: '#f59e0b' } }, `已登记变更，但未启动 AI 推进：${start.execution.message ?? start.execution.reason ?? '载体不可用'}`),
                  )
                : null,
              start && projectMeta?.repo
                ? h(
                    'details',
                    { style: { marginTop: '12px', borderTop: `1px solid ${T.line}`, paddingTop: '12px' } },
                    h('summary', { style: { cursor: 'pointer', fontSize: '12px', color: T.text2 } }, 'GitHub 归属（可选）'),
                    github.loading ? h('p', { style: muted }, '正在处理 GitHub…') : null,
                    github.error ? h('p', { style: { margin: '6px 0', color: T.err, fontSize: '12.5px' } }, github.error) : null,
                    github.plan
                      ? h('p', { style: { margin: '0 0 4px', fontSize: '12px', color: T.text2 } }, `将创建 1 个需求 Issue + ${github.plan.tasks?.length ?? 0} 个任务子议题（${projectMeta.repo}）`)
                      : null,
                    github.result
                      ? h('p', { style: { margin: '0 0 4px', fontSize: '12px', color: T.text2 } }, `已创建需求 Issue 与 ${github.result.tasks?.length ?? 0} 个任务子议题；映射写入 .alm/github.json`)
                      : null,
                    h(
                      'div',
                      { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' } },
                      !github.result
                        ? h('button', { style: button, onClick: previewGithub, disabled: github.loading }, github.plan ? '重新预览建单' : '预览 GitHub 建单')
                        : null,
                      github.plan && !github.result
                        ? h('button', { style: primary, onClick: applyGithub, disabled: github.loading }, '创建 GitHub Issue')
                        : null,
                    ),
                  )
                : null,
              record.auditPath
                ? h('details', { style: { marginTop: '10px', fontSize: '12px', color: T.text3 } }, h('summary', { style: { cursor: 'pointer' } }, '查看审计记录'), h('p', { style: { overflowWrap: 'anywhere' } }, record.auditPath))
                : null,
            )
          : null,
      )
    }

    function formatAcceptanceMs(value) {
      const ms = Number(value)
      if (!Number.isFinite(ms) || ms < 0) return '—'
      return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`
    }

    function parseAcceptanceOutput(text) {
      const source = String(text ?? '')
      const pick = (label) => {
        const match = source.match(new RegExp(`^ℹ ${label} (\\d+(?:\\.\\d+)?)$`, 'm'))
        return match ? Number(match[1]) : null
      }
      const failingSection = source.split('✖ failing tests:')[1] ?? ''
      const files = [...failingSection.matchAll(/^test at (.+?):\d+:\d+$/gm)].map((match) => match[1].trim())
      const names = [...source.matchAll(/^✖ (.+?) \(/gm)].map((match) => match[1].trim()).filter(Boolean)
      const errors = []
      for (const line of source.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (!trimmed) continue
        if (/^(AssertionError|Error|TypeError|ReferenceError|SyntaxError|RangeError)\b[: ]/.test(trimmed) || /\bAssertionError\b/.test(trimmed)) {
          const clean = trimmed.length > 180 ? `${trimmed.slice(0, 180)}…` : trimmed
          if (!errors.includes(clean)) errors.push(clean)
          if (errors.length >= 3) break
        }
      }
      return { total: pick('tests'), pass: pick('pass'), fail: pick('fail'), durationMs: pick('duration_ms'), files, names, errors }
    }

    function describeAcceptance(evidence) {
      const commands = evidence?.commands ?? []
      if (!commands.length) {
        return { tone: 'warn', headline: '没有执行任何命令', failures: [], errors: [], suggestion: '检查验收命令是否为空，然后重试。', logs: [] }
      }
      const failed = commands.filter(
        (command) =>
          command.timedOut === true ||
          command.spawnFailed === true ||
          Boolean(command.error) ||
          (command.exitCode ?? 1) !== 0,
      )
      const output = commands.map((command) => `${command.stdout ?? ''}${command.stderr ?? ''}`).join('\n')
      const parsed = parseAcceptanceOutput(output)
      const first = failed[0] ?? commands[0]
      // A spawn failure (EPERM/ENOENT) also has exitCode null, but it is not a
      // timeout: say that the command could not start and why.
      const timedOut = failed.some((command) => command.timedOut === true || command.error?.code === 'ETIMEDOUT')
      const notExecuted = failed.find(
        (command) => command.spawnFailed === true || (command.error && command.error.code !== 'ETIMEDOUT'),
      )
      const totalDuration = commands.reduce((sum, command) => sum + (Number(command.durationMs) || 0), 0)
      const logs = commands.map((command) => ({
        id: command.id,
        command: (command.command ?? []).join(' '),
        exit: command.exitCode,
        durationMs: command.durationMs,
        error: command.error?.code
          ? `${command.error.code}${command.error.message ? `：${command.error.message}` : ''}`
          : null,
        text: `${command.stdout ?? ''}${command.stderr ?? ''}`,
      }))
      if (evidence?.result === 'pass') {
        return {
          tone: 'ok',
          headline: `验收通过 · ${commands.length} 条命令 · ${formatAcceptanceMs(totalDuration)}`,
          failures: [],
          errors: [],
          suggestion: null,
          logs,
        }
      }
      const failureList = (parsed.files.length ? parsed.files : parsed.names).map((entry) => entry.replace(/\\/g, '/'))
      const temporary = failureList.filter((entry) => /(^|[\\/])(tmp|\.alm|changes|node_modules)([\\/]|$)/.test(entry))
      let suggestion
      if (timedOut) {
        suggestion = `命令超过超时时间被终止。可以缩小命令范围（只跑该需求的测试），或提高超时时间后重跑。`
      } else if (notExecuted) {
        suggestion = `命令无法启动（${notExecuted.error?.code ?? '未知'}），没有产生测试结果。检查运行环境是否允许启动子进程（例如沙箱 EPERM、可执行文件不存在），或改用不依赖子进程的验收命令。`
      } else if (!parsed.total && !failureList.length) {
        suggestion = `命令退出码 ${first?.exitCode ?? '未知'}，但输出里没有测试汇总。检查命令是否真的执行了测试，或展开完整日志查看原始输出。`
      } else if (parsed.total === 0) {
        suggestion = '命令没有匹配到任何测试。检查命令里的路径是否指向该需求对应的测试文件。'
      } else if (temporary.length && temporary.length >= Math.ceil(failureList.length / 2)) {
        suggestion = `失败集中在临时或生成目录（${temporary[0]} 等）。当前命令从仓库根执行了 ${parsed.total} 个测试，把临时副本也扫进来了；建议把命令限定到该需求对应的测试文件，或清理临时目录后重跑。`
      } else if (parsed.total > 500) {
        suggestion = `命令扫描了整仓 ${parsed.total} 个测试。建议把验收命令限定到该需求对应的测试文件，运行更快、结论也更针对该需求。`
      } else {
        suggestion = '先修复上面列出的失败用例，再重跑验收；也可以修改命令，只运行该需求相关的测试。'
      }
      const headlineParts = []
      if (parsed.total != null) headlineParts.push(`${parsed.fail ?? failureList.length ?? '若干'} 个测试失败`)
      if (parsed.total != null) headlineParts.push(`共 ${parsed.total} 个测试，${parsed.pass ?? 0} 个通过`)
      const reason = timedOut ? '超时' : notExecuted ? `无法执行（${notExecuted.error?.code ?? '未知'}）` : `退出码 ${first?.exitCode ?? '未知'}`
      const headline = headlineParts.length
        ? `验收未通过 · ${headlineParts.join(' / ')}`
        : `验收未通过 · ${reason} · ${formatAcceptanceMs(totalDuration)}`
      return { tone: 'err', headline, failures: failureList, errors: parsed.errors, suggestion, logs }
    }

    function AcceptanceModal({ item, root, onClose, onDone }) {
      const [state, setState] = useState({
        loading: true,
        plan: null,
        result: null,
        error: null,
        errorCode: null,
        running: false,
        startedAt: 0,
        elapsedMs: 0,
        cancelled: false,
        editing: false,
        commandText: '',
        saving: false,
      })
      const controllerRef = useRef(null)
      const autoRunRef = useRef(false)
      const skipAutoRunRef = useRef(false)

      function beginRun() {
        controllerRef.current?.abort()
        const controller = new AbortController()
        controllerRef.current = controller
        const startedAt = Date.now()
        setState((current) => ({ ...current, running: true, startedAt, elapsedMs: 0, error: null, errorCode: null, cancelled: false, result: null }))
        writeJson('acceptance', { requirementId: item.id, apply: true }, root, { signal: controller.signal })
          .then((result) => {
            if (controller.signal.aborted) return
            controllerRef.current = null
            setState((current) => ({ ...current, running: false, plan: null, result, error: null, elapsedMs: Date.now() - startedAt }))
            onDone?.()
          })
          .catch((error) => {
            if (controller.signal.aborted || error?.name === 'AbortError') {
              setState((current) => ({ ...current, running: false, cancelled: true, elapsedMs: Date.now() - startedAt }))
              return
            }
            controllerRef.current = null
            setState((current) => ({ ...current, running: false, error: error.message, errorCode: error.code ?? null, elapsedMs: Date.now() - startedAt }))
          })
      }

      const load = useCallback(() => {
        setState((current) => ({ ...current, loading: true, plan: null, result: null, error: null, errorCode: null, running: false, saving: false }))
        writeJson('acceptance', { requirementId: item.id }, root)
          .then((plan) => {
            setState((current) => ({
              ...current,
              loading: false,
              plan,
              error: null,
              errorCode: null,
              editing: false,
              commandText: (plan.commands ?? []).map((entry) => entry.command.join(' ')).join('\n'),
            }))
            if (!skipAutoRunRef.current && !autoRunRef.current) {
              autoRunRef.current = true
              beginRun()
            }
          })
          .catch((error) =>
            setState((current) => ({
              ...current,
              loading: false,
              plan: null,
              result: null,
              errorCode: error.code ?? null,
              // Not registered yet: open the editor instead of a dead end. The
              // missing-config error is expected here, so do not show it as a failure.
              editing: error.code === 'no-config',
              error: error.code === 'no-config' ? null : error.message,
            })),
          )
      }, [item.id, root])
      useEffect(() => {
        load()
      }, [load])
      useEffect(() => () => {
        controllerRef.current?.abort()
      }, [])
      useEffect(() => {
        if (!state.running) return undefined
        const started = state.startedAt || Date.now()
        const timer = setInterval(() => {
          setState((current) => (current.running ? { ...current, elapsedMs: Date.now() - started } : current))
        }, 250)
        return () => clearInterval(timer)
      }, [state.running, state.startedAt])

      const cancelWait = () => {
        controllerRef.current?.abort()
        controllerRef.current = null
        setState((current) => ({ ...current, running: false, cancelled: true, elapsedMs: Date.now() - (current.startedAt || Date.now()) }))
      }

      const save = () => {
        const commands = String(state.commandText ?? '')
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
        if (commands.length === 0) {
          setState((current) => ({ ...current, error: '请至少填写一条验收命令。' }))
          return
        }
        setState((current) => ({ ...current, saving: true, error: null, errorCode: null }))
        writeJson('acceptance-config', { requirementId: item.id, commands, apply: true }, root)
          .then(() => {
            skipAutoRunRef.current = true
            load()
            onDone?.()
          })
          .catch((error) => setState((current) => ({ ...current, saving: false, error: error.message, errorCode: error.code ?? null })))
      }

      const plan = state.plan
      const result = state.result
      const evidence = result?.evidence
      const editing = state.editing
      const summary = evidence ? describeAcceptance(evidence) : null
      const commandTextEmpty = !String(state.commandText ?? '').split('\n').some((line) => line.trim())
      const footer = editing
        ? [
            h('button', { key: 'cancel', style: button, onClick: () => { if (plan) setState((current) => ({ ...current, editing: false, error: null })); else onClose() } }, plan ? '取消修改' : '关闭'),
            h('button', { key: 'save', style: primary, onClick: save, disabled: state.saving || commandTextEmpty }, state.saving ? '保存中…' : '保存命令'),
          ]
        : state.running
          ? [
              h('button', { key: 'cancel', style: button, onClick: cancelWait }, '停止等待'),
            ]
          : [
              h('button', { key: 'close', style: result ? primary : button, onClick: onClose }, '关闭'),
              evidence
                ? h('button', { key: 'again', style: button, onClick: beginRun }, '重跑验收')
                : null,
              evidence || plan
                ? h('button', { key: 'edit', style: button, onClick: () => setState((current) => ({ ...current, editing: true, error: null })) }, '修改命令')
                : null,
              plan && !evidence
                ? h('button', { key: 'run', style: primary, onClick: beginRun }, '运行验收')
                : null,
            ]
      return h(
        ModalShell,
        {
          title: `验证交付 · ${item.id}`,
          lead: '运行已登记的检查，核对交付是否符合要求。结果会留下证据；检查通过不等于你已接受交付。',
          onClose,
          feedbackContext: feedbackContextFor(item),
          width: '820px',
          footer,
        },
        state.loading ? h('p', { style: muted }, '正在读取验收配置…') : null,
        editing
          ? h(
              'div',
              null,
              h('p', { style: { margin: 0, ...muted } }, '一行一条命令；命令不经过 shell，不能用 | > ; & $ 等操作符。'),
              h(
                'p',
                { style: { margin: '6px 0 0', color: T.text3, fontSize: '12px' } },
                '示例（请替换成该需求对应的测试）：',
                h('code', { style: { marginLeft: '6px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' } }, 'node --test test/your-feature.test.mjs'),
              ),
              h('textarea', {
                value: state.commandText,
                name: 'acceptance-command',
                autoComplete: 'off',
                'aria-label': '验收命令',
                spellCheck: false,
                onChange: (event) => setState((current) => ({ ...current, commandText: event.target.value })),
                placeholder: 'node --test test/your-feature.test.mjs',
                style: { ...input, width: '100%', minHeight: '96px', marginTop: '8px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '12px', lineHeight: 1.6, resize: 'vertical' },
              }),
              h('p', { style: { margin: '8px 0 0', color: T.text3, fontSize: '12px' } }, '保存后会写入 .alm/acceptance/<需求 ID>.json；旧证据会标记为与当前版本不一致。'),
            )
          : null,
        state.error && !editing
          ? h(
              'div',
              { style: { marginTop: '10px', padding: '10px 12px', border: `1px solid ${T.err}`, borderRadius: '10px', background: T.layer } },
              h('p', { style: { margin: 0, color: T.err, fontSize: '12.5px' } }, state.error),
            )
          : null,
        editing && state.error
          ? h('p', { style: { margin: '8px 0 0', color: T.err, fontSize: '12.5px' } }, state.error)
          : null,
        state.running
          ? h(
              'div',
              { style: { marginTop: '12px', padding: '12px 14px', border: `1px solid ${T.line}`, borderRadius: '10px', background: T.layer } },
              h('div', { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '12px' } },
                h('p', { style: { margin: 0, color: T.text, fontSize: '13px', fontWeight: 600 } }, '正在执行验收命令'),
                h('span', { style: { color: T.text3, fontSize: '12px' } }, `已用 ${formatAcceptanceMs(state.elapsedMs)}`),
              ),
              h('p', { style: { margin: '6px 0 0', color: T.text3, fontSize: '12px' } }, '命令在仓库根执行，完成后会写入证据；可以停止等待，命令本身不会中断。'),
            )
          : null,
        state.cancelled && !state.running && !evidence
          ? h('p', { style: { margin: '10px 0 0', color: T.text3, fontSize: '12.5px' } }, '已停止等待。命令可能仍在后台执行，稍后刷新可查看证据。')
          : null,
        plan
          ? h(
              'details',
              { 'data-acceptance-commands': 'true', style: { marginTop: '12px' } },
              h('summary', { style: { cursor: 'pointer', fontSize: '12px', color: T.text2 } }, '查看执行命令与版本'),
              h(PlanRows, {
                rows: [
                  ['需求', plan.requirement],
                  ['提交', shortHash(plan.headSha, 12)],
                  ['命令数', `${plan.commands.length}`],
                ],
              }),
              h(
                'div',
                { style: { marginTop: '8px', border: `1px solid ${T.line}`, borderRadius: '10px', padding: '6px 12px' } },
                plan.commands.map((command) =>
                  h('div', { key: command.id, style: { ...row, borderBottom: 'none', padding: '4px 0', alignItems: 'baseline' } },
                    h('span', { style: { color: T.text3, fontSize: '11.5px', width: '80px', flex: 'none' } }, command.id),
                    h('code', { style: { color: T.text, fontSize: '12px', wordBreak: 'break-all' } }, command.command.join(' ')),
                  ),
                ),
              ),
            )
          : null,
        summary
          ? h(
              'div',
              { style: { marginTop: '12px' } },
              h(
                'div',
                {
                  style: {
                    padding: '12px 14px',
                    border: `1px solid ${summary.tone === 'ok' ? T.ok : summary.tone === 'err' ? T.err : T.warn}`,
                    borderRadius: '10px',
                    background: T.layer,
                  },
                },
                h('p', { style: { margin: 0, color: summary.tone === 'ok' ? T.ok : summary.tone === 'err' ? T.err : T.warn, fontSize: '13px', fontWeight: 650 } }, summary.headline),
                summary.failures.length
                  ? h(
                      'div',
                      { style: { marginTop: '8px' } },
                      h('p', { style: { margin: 0, color: T.text3, fontSize: '11.5px' } }, '失败的测试'),
                      summary.failures.slice(0, 5).map((entry, index) =>
                        h('div', { key: `${entry}-${index}`, style: { marginTop: '4px', color: T.text2, fontSize: '12px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', wordBreak: 'break-all' } }, entry),
                      ),
                      summary.failures.length > 5
                        ? h('p', { style: { margin: '4px 0 0', color: T.text3, fontSize: '11.5px' } }, `另有 ${summary.failures.length - 5} 项，展开完整日志查看。`)
                        : null,
                    )
                  : null,
                summary.errors.length
                  ? h(
                      'div',
                      { style: { marginTop: '8px' } },
                      summary.errors.map((entry) => h('p', { key: entry, style: { margin: '2px 0 0', color: T.err, fontSize: '12px', wordBreak: 'break-word' } }, entry)),
                    )
                  : null,
                summary.suggestion
                  ? h('p', { style: { margin: '8px 0 0', color: T.text2, fontSize: '12.5px', lineHeight: 1.6 } }, `建议：${summary.suggestion}`)
                  : null,
              ),
              h('details', { 'data-acceptance-evidence': 'true', style: { marginTop: '10px' } },
                h('summary', { style: { cursor: 'pointer', fontSize: '12px', color: T.text2 } }, '查看验证依据'),
                h('p', { style: { margin: '8px 0 0', color: T.text3, fontSize: '11.5px', overflowWrap: 'anywhere' } }, `提交 ${shortHash(evidence.headSha, 12)} · 证据 ${result.evidencePath}`),
                h(AcceptanceProvenance, { latest: evidence }),
              ),
              summary.logs.length
                ? h(
                    'details',
                    { style: { marginTop: '10px' } },
                    h('summary', { style: { cursor: 'pointer', color: T.text3, fontSize: '12px' } }, '展开完整输出（原始日志）'),
                    summary.logs.map((log) =>
                      h(
                        'div',
                        { key: log.id, style: { marginTop: '8px' } },
                        h('p', { style: { margin: '0 0 4px', color: T.text3, fontSize: '11.5px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' } }, `${log.id} · ${log.command} · ${log.error ? log.error : `exit ${log.exit ?? 'timeout'}`} · ${formatAcceptanceMs(log.durationMs)}`),
                        h('pre', { style: { margin: 0, padding: '10px', maxHeight: '260px', overflow: 'auto', background: T.layer2 ?? T.layer, border: `1px solid ${T.line}`, borderRadius: '8px', fontSize: '11px', whiteSpace: 'pre-wrap', color: T.text2 } }, log.text || '（无输出）'),
                      ),
                    ),
                  )
                : null,
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

      const applyReport = (next) => {
        setReport(next)
        setSelected([])
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
        if (selected.length === 0) return
        setPhase('adopting')
        setError(null)
        writeJson('ai-review', { requirementId: item.id, apply: true, selectedSuggestionIds: selected }, root)
          .then((next) => {
            setAdopted(next.adopted ?? { suggestionIds: selected })
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
          title: `AI 优化建议 · ${item.id}`,
          lead: 'AI 建议仅供优化需求正文。默认不选择；请明确勾选要应用的建议，也可以暂不采纳并继续当前流程。',
          onClose,
          feedbackContext: feedbackContextFor(item),
          width: '860px',
          footer: [
            h('button', { key: 'close', style: phase === 'report' ? button : primary, onClick: onClose }, phase === 'adopted' ? '关闭' : phase === 'report' ? '暂不采纳，继续推进' : '取消'),
            phase === 'intro' || (phase === 'report' && !report)
              ? h('button', { key: 'generate', style: primary, onClick: generate }, '生成 AI 优化建议')
              : null,
            phase === 'intro' && hasStored ? h('button', { key: 'load', style: button, onClick: load }, '查看已有建议') : null,
            phase === 'report'
              ? h('button', { key: 'adopt', style: primary, onClick: adopt, disabled: selected.length === 0 }, selected.length === 0 ? '采纳所选建议' : `采纳所选建议（${selected.length}）`)
              : null,
          ],
        },
        phase === 'loading' ? h('p', { style: muted }, '正在读取已有 AI 优化建议…') : null,
        phase === 'generating'
          ? h('div', { style: { padding: '16px 0', color: T.text2, fontSize: '13px', lineHeight: 1.9 } },
              h('p', { style: { margin: 0 } }, 'AI 正在阅读需求并生成优化建议，通常需要 10–60 秒…'),
              h('p', { style: { margin: '4px 0 0', ...muted } }, '本次调用使用 DSH 当前默认模型；建议会保存到 .alm/reviews/<REQ>.ai.json。'),
            )
          : null,
        error ? h('p', { style: { margin: '10px 0 0', color: T.err, fontSize: '12.5px' } }, error) : null,
        phase === 'intro'
          ? h('div', { style: { padding: '10px 0', color: T.text2, fontSize: '13px', lineHeight: 1.9 } },
              h('p', { style: { margin: 0 } }, '还没有 AI 优化建议。生成后可以查看：'),
              h('ul', { style: { margin: '6px 0 0', paddingLeft: '20px' } },
                h('li', null, '可参考的问题与风险提示'),
                h('li', null, '可执行的优化建议（需明确勾选应用）'),
                h('li', null, '分步优化方案与建议背景'),
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
              h('details', { style: { marginTop: '6px', ...muted } },
                h('summary', { style: { cursor: 'pointer' } }, '建议来源'),
                h('p', null, `${report.provider} · ${report.model} · ${formatLocalStamp(report.generatedAt)}`),
              ),
              h('div', { style: { marginTop: '12px' } },
                h('div', { style: { fontSize: '11px', letterSpacing: '.08em', color: T.text3, marginBottom: '6px' } }, '问题与风险提示'),
                (report.findings ?? []).length
                  ? report.findings.map((finding) =>
                      h('div', { key: finding.id, style: { borderLeft: `3px solid ${finding.severity === 'block' ? T.err : finding.severity === 'warn' ? T.warn : T.line2}`, background: T.layer2, borderRadius: '8px', padding: '7px 10px', marginBottom: '6px', fontSize: '12.5px', color: T.text2 } },
                        h('b', { style: { color: T.text, fontWeight: 500 } }, `${finding.title} `),
                        finding.detail,
                        finding.ref ? h('span', { style: { ...muted, marginLeft: '6px' } }, `（${finding.ref}）`) : null,
                      ),
                    )
                  : h('p', { style: { margin: 0, ...muted } }, '没有额外问题提示。'),
              ),
              h('div', { style: { marginTop: '12px' } },
                h('div', { style: { fontSize: '11px', letterSpacing: '.08em', color: T.text3, marginBottom: '6px' } }, '优化建议（勾选后应用）'),
                (report.suggestions ?? []).map((suggestion) =>
                  h('label', { key: suggestion.id, style: { display: 'flex', gap: '8px', alignItems: 'flex-start', border: `1px solid ${T.line}`, borderRadius: '8px', padding: '8px 10px', marginBottom: '6px', fontSize: '12.5px', color: T.text2, cursor: 'pointer' } },
                    h('input', { type: 'checkbox', name: `review-suggestion-${suggestion.id}`, 'aria-label': `采用优化建议：${suggestion.title}`, checked: selected.includes(suggestion.id), onChange: () => toggle(suggestion.id), style: { marginTop: '2px' } }),
                    h('span', null,
                      h('b', { style: { color: T.text, fontWeight: 500 } }, `[${suggestion.category}] ${suggestion.title}`),
                      h('span', { style: { display: 'block', marginTop: '2px' } }, suggestion.detail),
                      suggestion.suggestedText ? h('code', { style: { display: 'block', marginTop: '4px', color: T.text3, fontSize: '11.5px', whiteSpace: 'pre-wrap' } }, suggestion.suggestedText) : null,
                    ),
                  ),
                ),
              ),
              (report.plan ?? []).length
                ? h('details', { style: { marginTop: '12px' } },
                    h('summary', { style: { cursor: 'pointer', fontSize: '12px', color: T.text2, marginBottom: '6px' } }, '查看建议方案'),
                    h('ol', { style: { margin: 0, paddingLeft: '20px', fontSize: '12.5px', color: T.text2, lineHeight: 1.9 } },
                      report.plan.map((entry, index) => h('li', { key: `${entry.step}-${index}` }, h('b', { style: { color: T.text, fontWeight: 500 } }, entry.step), `：${entry.detail}`)),
                    ),
                  )
                : null,
              report.proposedBrief
                ? h('details', { style: { marginTop: '12px' } },
                    h('summary', { style: { cursor: 'pointer', fontSize: '12px', color: T.text2, marginBottom: '6px' } }, '查看建议背景（非已确认需求）'),
                    h('pre', { style: { margin: 0, padding: '10px', maxHeight: '160px', overflow: 'auto', background: T.layer, border: `1px solid ${T.line}`, borderRadius: '8px', fontSize: '11.5px', lineHeight: 1.8, whiteSpace: 'pre-wrap' } }, report.proposedBrief),
                    h('p', { style: { margin: '6px 0 0', ...muted } }, '建议背景只保存在评审报告中，不整段写入需求 brief，避免重复膨胀。'),
                  )
                : null,
              phase === 'adopted'
                ? h('div', { style: { margin: '12px 0 0', fontSize: '12.5px', color: T.ok, lineHeight: 1.9 } },
                    h('p', { style: { margin: 0 } }, `已应用 ${adopted?.suggestionIds?.length ?? selected.length} 条建议；brief 的「AI 优化建议」已更新（不会重复追加）。`),
                    h('p', { style: { margin: '2px 0 0', color: T.text2 } }, '这只更新需求正文，不代表评审通过、人工验收或发布授权。'),
                  )
                : null,
            )
          : null,
      )
    }

    /**
     * Keeps an unexpectedly failing modal from disappearing without a trace:
     * the user sees what failed and can close it instead of assuming the click
     * did nothing.
     */
    class ModalBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }
      static getDerivedStateFromError(error) {
        return { error }
      }
      componentDidCatch(error, info) {
        try {
          console.error('[requirements] modal render failed', error, info?.componentStack)
        } catch {}
      }
      render() {
        if (!this.state.error) return this.props.children
        return h(
          'div',
          {
            role: 'alert',
            style: {
              position: 'fixed',
              inset: 0,
              zIndex: 70,
              background: 'rgba(4,6,9,.62)',
              backdropFilter: 'blur(6px)',
              display: 'grid',
              placeItems: 'center',
              padding: '24px',
            },
          },
          h(
            'div',
            { style: { width: '560px', maxWidth: '92vw', background: T.base, border: `1px solid ${T.line2}`, borderRadius: '16px', padding: '22px 24px' } },
            h('h3', { style: { margin: 0, fontSize: '16px' } }, '面板没有正常打开'),
            h(
              'p',
              { style: { margin: '8px 0 0', color: T.text2, fontSize: '13px', lineHeight: 1.75 } },
              `错误：${this.state.error?.message ?? '未知错误'}。关闭后可重试；如果持续出现，请刷新页面。`,
            ),
            h(
              'div',
              { style: { display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '8px', marginTop: '16px' } },
              layerFeedbackButton({ label: '面板没有正常打开', context: { recentError: this.state.error?.message ?? null } }),
              h('button', { style: { ...button }, onClick: this.props.onClose }, '关闭'),
            ),
          ),
        )
      }
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
          setState({ loading: false, preview: null, result: null, error: '还没有改动：先修改标题、优先级或背景，再预览影响面。', stale: false })
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
            name: `rehearsal-${field}`,
            autoComplete: 'off',
            'aria-label': `变更试演 ${field}`,
            style: { ...input, width: '100%', minHeight: '150px', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.7 },
            value: draft.brief,
            onChange: (event) => edit('brief', event.target.value),
          })
        }
        return h('input', { name: `rehearsal-${field}`, autoComplete: 'off', 'aria-label': `变更试演 ${field}`, style: input, value: draft.title, autoFocus: field === 'title', onChange: (event) => edit('title', event.target.value) })
      }
      return h(
        ModalShell,
        {
          title: `变更试演 · ${item.id}`,
          lead: '一次可改标题、优先级、背景；只提交有改动的字段。试演不写文件，确认提交携带当前 baseline 做 CAS 并写审计记录。',
          onClose,
          feedbackContext: feedbackContextFor(item),
          width: '860px',
          footer: [
            h('button', { key: 'close', style: result ? primary : button, onClick: onClose }, result ? '关闭' : '取消'),
            result
              ? null
              : h(
                  'span',
                  { key: 'hint', style: { marginRight: 'auto', fontSize: '12px', color: hasChanges ? T.ok : T.text3 } },
                  hasChanges ? `将提交：${editedLabels.join('、')}` : '先修改任一字段，再预览影响面',
                ),
            result
              ? null
              : h('button', { key: 'preview', style: { ...button, opacity: state.loading ? 0.5 : 1 }, onClick: preview, disabled: state.loading }, state.loading ? '处理中…' : '预览影响面'),
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
              h('p', { style: { color: T.text, fontSize: '13px' } }, result.applied === false ? '未提交变更。' : '变更已提交。'),
              h('details', null, h('summary', { style: { cursor: 'pointer', color: T.text2, fontSize: '12px' } }, '查看提交记录'), h(PlanRows, {
                rows: [
                  ['状态', result.applied === false ? '未提交' : '已提交'],
                  ['修订', result.revision ? `v${result.revision}` : '—'],
                  ['变更', (result.changes ?? []).map((entry) => fieldLabel(entry.field)).join('、') || '—'],
                  ['文件', result.file ?? '—'],
                  ['审计', result.auditFile ?? '—'],
                ],
              })),
              result.applied !== false ? h('p', { style: { margin: '8px 0 0', color: T.warn, fontSize: '12px' } }, '内容已变更，旧评审与验收证据不再适用，需要重新检查。') : null,
            )
          : null,
        previewData
          ? h(
              'div',
              { style: { marginTop: '14px' } },
              h('p', { style: { fontSize: '13px', color: T.text } }, `将修改：${previewChanges.map((entry) => fieldLabel(entry.field)).join('、')}`),
              h('details', { style: { marginTop: '8px' } },
                h('summary', { style: { cursor: 'pointer', fontSize: '12px', color: T.text2 } }, '查看变更基线'),
                h(PlanRows, { rows: [
                  ['需求', item.id],
                  ['基线内容哈希', shortHash(previewData.baseline?.contentHash)],
                  ['基线关系快照', shortHash(previewData.baseline?.relationHash)],
                  ['基线提交', shortHash(previewData.baseline?.headSha, 8)],
                  ['基线修订', `v${previewData.baseline?.revision ?? item.revision ?? 1}`],
                ] }),
              ),
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

    /**
     * Close-and-archive confirmation. The preview decides whether the status
     * transition is legal; apply re-checks the same baseline (CAS) before one
     * audited write. Archived rows stay readable, they just leave the funnel.
     */
    function ArchiveModal({ item, root, onClose, onDone }) {
      const [reason, setReason] = useState('')
      const [idempotencyKey] = useState(() => `ui-archive-${item.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`)
      const [state, setState] = useState({ loading: true, preview: null, result: null, error: null, stale: false })
      const load = useCallback(() => {
        setState({ loading: true, preview: null, result: null, error: null, stale: false })
        writeJson('archive', { requirementId: item.id, file: item.file }, root)
          .then((preview) => setState({ loading: false, preview, result: null, error: null, stale: false }))
          .catch((error) => setState({ loading: false, preview: null, result: null, error: error.message, stale: false }))
      }, [item.id, root])
      useEffect(() => {
        load()
      }, [load])
      const submit = () => {
        const preview = state.preview
        if (!preview || state.loading) return
        setState((current) => ({ ...current, loading: true, result: null, error: null, stale: false }))
        writeJson(
          'archive',
          {
            requirementId: item.id,
            file: item.file,
            apply: true,
            expectedBaseline: preview.baseline,
            actor: 'human:local',
            reason,
            idempotencyKey,
          },
          root,
        )
          .then((result) => {
            setState({ loading: false, preview: null, result, error: null, stale: false })
          })
          .catch((error) => {
            if (error.code !== 'stale-preview') {
              setState((current) => ({ ...current, loading: false, error: error.message }))
              return
            }
            setState((current) => ({ ...current, loading: false, error: null, stale: true }))
            writeJson('archive', { requirementId: item.id, file: item.file }, root)
              .then((next) => setState((current) => ({ ...current, loading: false, preview: next, error: null, stale: true })))
              .catch((nextError) => setState((current) => ({ ...current, loading: false, error: nextError.message, stale: true })))
          })
      }
      const preview = state.preview
      const result = state.result
      const close = () => {
        if (result) onDone?.()
        else onClose()
      }
      return h(
        ModalShell,
        {
          title: `关闭归档 · ${item.id}`,
          lead: '这条需求将退出活跃流程，但原文、证据和历史仍保留。确认不再推进后再归档。',
          onClose: close,
          feedbackContext: feedbackContextFor(item),
          width: '620px',
          footer: [
            h('button', { key: 'close', style: result ? primary : button, onClick: close }, result ? '关闭' : '取消'),
            result
              ? null
              : h('button', { key: 'submit', style: primary, onClick: submit, disabled: state.loading || !preview }, state.loading ? '归档中…' : '确认关闭归档'),
          ],
        },
        state.loading ? h('p', { style: { margin: '10px 0 0', ...muted } }, '正在检查状态与基线…') : null,
        state.error ? h('p', { role: 'alert', style: { margin: '10px 0 0', color: T.err, fontSize: '12.5px', lineHeight: 1.8 } }, state.error) : null,
        state.stale ? h('p', { style: { margin: '10px 0 0', color: T.warn, fontSize: '12.5px' } }, '需求刚刚发生变化，已重新计算，请再次确认。') : null,
        preview
          ? h(
              'div',
              { style: { marginTop: '14px' } },
              h(PlanRows, {
                rows: [
                  ['需求', `${item.title} · ${item.id}`],
                  ['状态', `${preview.status.from} → ${preview.status.to}（已归档）`],
                  ['修订', `v${preview.baseline?.revision ?? item.revision ?? 1} → v${preview.revision}`],
                  ['文件', preview.file ?? '—'],
                  ['影响', '评审、验收证据与 GitHub 归属保留；记录移出活跃列表'],
                ],
              }),
              h(
                'label',
                { style: { display: 'flex', flexDirection: 'column', gap: '5px', marginTop: '12px', fontSize: '12px', color: T.text2 } },
                h('span', null, '关闭原因（可选）'),
                h('textarea', {
                  name: 'archive-reason',
                  autoComplete: 'off',
                  'aria-label': '关闭原因（可选）',
                  value: reason,
                  onChange: (event) => setReason(event.target.value),
                  placeholder: '例如：业务调整，本期不开发；或已被其他方案覆盖。',
                  maxLength: 500,
                  style: { ...input, width: '100%', minHeight: '76px', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.7 },
                }),
              ),
            )
          : null,
        result
          ? h(
              'div',
              { style: { marginTop: '14px' } },
              h('details', null, h('summary', { style: { cursor: 'pointer', color: T.text2, fontSize: '12px' } }, '查看归档记录'), h(PlanRows, {
                rows: [
                  ['状态', '已归档'],
                  ['修订', result.revision ? `v${result.revision}` : '—'],
                  ['文件', result.file ?? '—'],
                  ['审计', result.auditFile ?? '—'],
                ],
              })),
              h(
                'p',
                { style: { margin: '8px 0 0', color: T.ok, fontSize: '12.5px' } },
                result.alreadyArchived
                  ? '该需求已在之前完成归档，本次请求未重复写入。'
                  : '已关闭归档；该需求不再出现在活跃筛选中。',
              ),
            )
          : null,
      )
    }

    function RemoveModal({ item, root, onClose, onDone }) {
      const [reason, setReason] = useState('')
      const [confirmed, setConfirmed] = useState(false)
      const [idempotencyKey] = useState(() => `ui-remove-${item.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`)
      const [state, setState] = useState({ loading: true, preview: null, result: null, error: null, stale: false })
      const load = useCallback(() => {
        setState({ loading: true, preview: null, result: null, error: null, stale: false })
        writeJson('remove', { requirementId: item.id, file: item.file }, root)
          .then((preview) => setState({ loading: false, preview, result: null, error: null, stale: false }))
          .catch((error) => setState({ loading: false, preview: null, result: null, error: error.message, stale: false }))
      }, [item.id, item.file, root])
      useEffect(() => {
        load()
      }, [load])
      const submit = () => {
        const preview = state.preview
        if (!preview || state.loading || !confirmed) return
        setState((current) => ({ ...current, loading: true, result: null, error: null, stale: false }))
        writeJson(
          'remove',
          {
            requirementId: item.id,
            file: item.file,
            apply: true,
            expectedBaseline: preview.baseline,
            actor: 'human:local',
            reason,
            idempotencyKey,
          },
          root,
        )
          .then((result) => setState({ loading: false, preview: null, result, error: null, stale: false }))
          .catch((error) => {
            if (error.code !== 'stale-preview') {
              setState((current) => ({ ...current, loading: false, error: error.message }))
              return
            }
            setState((current) => ({ ...current, loading: false, error: null, stale: true }))
            setConfirmed(false)
            writeJson('remove', { requirementId: item.id, file: item.file }, root)
              .then((next) => setState((current) => ({ ...current, loading: false, preview: next, error: null, stale: true })))
              .catch((nextError) => setState((current) => ({ ...current, loading: false, error: nextError.message, stale: true })))
          })
      }
      const preview = state.preview
      const result = state.result
      const close = () => {
        if (result) onDone?.()
        else onClose()
      }
      return h(
        ModalShell,
        {
          title: `删除需求 · ${item.id}`,
          lead: '这条记录将从仓库和所有列表移除。原文会留在审计中，但不会自动恢复。请核对删除范围并明确确认。',
          onClose: close,
          feedbackContext: feedbackContextFor(item),
          width: '620px',
          footer: [
            h('button', { key: 'close', style: result ? primary : button, onClick: close }, result ? '关闭' : '取消'),
            result
              ? null
              : h('button', { key: 'submit', style: { ...primary, background: T.err, borderColor: T.err }, onClick: submit, disabled: state.loading || !preview || !confirmed }, state.loading ? '删除中…' : '确认删除'),
          ],
        },
        state.loading ? h('p', { style: { margin: '10px 0 0', ...muted } }, '正在检查状态与基线…') : null,
        state.error ? h('p', { role: 'alert', style: { margin: '10px 0 0', color: T.err, fontSize: '12.5px', lineHeight: 1.8 } }, state.error) : null,
        state.stale ? h('p', { style: { margin: '10px 0 0', color: T.warn, fontSize: '12.5px' } }, '需求刚刚发生变化，已重新计算，请再次确认。') : null,
        preview
          ? h(
              'div',
              { style: { marginTop: '14px' } },
              h(PlanRows, {
                rows: [
                  ['需求', `${item.title} · ${item.id}`],
                  ['文件', preview.file ?? '—'],
                  ['方式', preview.mode === 'block' ? '从共享 sdoc 中删除该记录块，保留同文件其他需求' : '删除整个需求文件'],
                  ['修订', `v${preview.baseline?.revision ?? item.revision ?? 1}`],
                  ['可恢复', '审计中保存删除前全文与基线'],
                ],
              }),
              h(
                'label',
                { style: { display: 'flex', gap: '7px', alignItems: 'flex-start', marginTop: '12px', fontSize: '12px', color: T.text2, cursor: 'pointer' } },
                h('input', { type: 'checkbox', name: 'delete-confirmed', 'aria-label': '确认删除该需求记录', checked: confirmed, onChange: (event) => setConfirmed(event.target.checked), style: { marginTop: '2px' } }),
                h('span', null, '我知道删除后该记录不再出现在列表中；需要时从审计恢复。'),
              ),
              h(
                'label',
                { style: { display: 'flex', flexDirection: 'column', gap: '5px', marginTop: '10px', fontSize: '12px', color: T.text2 } },
                h('span', null, '删除原因（可选）'),
                h('textarea', {
                  name: 'delete-reason',
                  autoComplete: 'off',
                  'aria-label': '删除原因（可选）',
                  value: reason,
                  onChange: (event) => setReason(event.target.value),
                  placeholder: '例如：测试数据清理；或这条记录已合并到其他需求。',
                  maxLength: 500,
                  style: { ...input, width: '100%', minHeight: '66px', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.7 },
                }),
              ),
            )
          : null,
        result
          ? h(
              'div',
              { style: { marginTop: '14px' } },
              h('details', null, h('summary', { style: { cursor: 'pointer', color: T.text2, fontSize: '12px' } }, '查看删除记录'), h(PlanRows, {
                rows: [
                  ['结果', result.alreadyRemoved ? '已删除（此前已完成）' : '已删除'],
                  ['文件', result.file ?? '—'],
                  ['方式', result.mode === 'block' ? '删除记录块' : '删除文件'],
                  ['审计', result.auditFile ?? '—'],
                  ['时间', result.removedAt ?? '—'],
                ],
              })),
              h('p', { style: { margin: '8px 0 0', color: T.ok, fontSize: '12.5px' } }, result.alreadyRemoved ? '该需求此前已删除，本次请求未重复写入。' : '记录已从仓库移除；需要恢复时从审计文件找回原文。'),
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
    // 图片不再是单独的一路输入：它和文字一起组成一条图文意图，粘贴时只进
    // 附件托盘，等用户点「分析意图」后才识别，识别文本只作为分析材料。
    const INTENT_STAGES = ['读取项目上下文', '检索相关需求', '生成判断']
    const INTENT_MAX_IMAGES = 4
    const INTENT_IMAGE_MAX_BYTES = 8 * 1024 * 1024
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
      const view = payload?.session ?? payload?.data?.session ?? null
      if (!view) return null
      const analysisStatus = payload?.analysisStatus ?? view.analysisStatus ?? null
      return analysisStatus ? { ...view, analysisStatus } : view
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

    const DRAFT_PROVENANCE_LABELS = {
      'user-stated': { label: '用户原话', tone: 'neutral' },
      'user-answer': { label: '用户回答', tone: 'neutral' },
      'human-edit': { label: '人工编辑', tone: 'brand' },
      'verified-context': { label: '已核实', tone: 'success' },
      'ai-suggestion': { label: 'AI 建议', tone: 'warn' },
      unconfirmed: { label: '未确认', tone: 'warn' },
    }

    function draftProvenanceBadge(provenance) {
      const key = Object.prototype.hasOwnProperty.call(DRAFT_PROVENANCE_LABELS, provenance) ? provenance : 'unconfirmed'
      const entry = DRAFT_PROVENANCE_LABELS[key]
      const color = entry.tone === 'warn' ? T.warn : entry.tone === 'success' ? T.ok : entry.tone === 'brand' ? T.text : T.text2
      return h(
        'span',
        {
          'data-draft-provenance': key,
          title: `来源：${entry.label}`,
          style: {
            fontSize: '10.5px',
            lineHeight: 1.5,
            color,
            border: `1px solid ${T.line2}`,
            borderRadius: '999px',
            padding: '0 7px',
            whiteSpace: 'nowrap',
          },
        },
        entry.label,
      )
    }

    function draftText(value) {
      return typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value)
    }

    function draftList(value) {
      if (!Array.isArray(value)) return []
      return value.map((entry) => (typeof entry === 'string' ? entry : draftText(entry?.text ?? entry?.title ?? entry))).map((entry) => entry.trim()).filter((entry) => entry !== '')
    }

    function draftOfSession(session) {
      if (!session || typeof session !== 'object') return null
      if (session.docDraft && typeof session.docDraft === 'object') return session.docDraft
      const items = Array.isArray(session.items) ? session.items : []
      for (const item of items) {
        if (item && typeof item === 'object' && item.docDraft && typeof item.docDraft === 'object') return item.docDraft
      }
      return null
    }

    function draftChangesCount(changes) {
      if (!changes) return 0
      if (Array.isArray(changes)) return changes.length
      const bucket = (value) => (Array.isArray(value) ? value.length : 0)
      return bucket(changes.added) + bucket(changes.removed) + bucket(changes.modified) + bucket(changes.pending)
    }

    function countDraftChanges(before, after) {
      if (!before || !after) return 0
      let count = 0
      for (const field of ['goal', 'problem']) {
        if (draftText(before[field]).trim() !== draftText(after[field]).trim()) count += 1
      }
      for (const field of ['scope', 'outOfScope', 'constraints']) {
        if (JSON.stringify(draftList(before[field])) !== JSON.stringify(draftList(after[field]))) count += 1
      }
      const digest = (entry) => JSON.stringify([entry?.id, entry?.title, entry?.behavior, entry?.text, entry?.provenance])
      const compareRows = (key) => {
        const left = (Array.isArray(before[key]) ? before[key] : []).map(digest)
        const right = (Array.isArray(after[key]) ? after[key] : []).map(digest)
        if (JSON.stringify(left) !== JSON.stringify(right)) count += 1
      }
      compareRows('features')
      compareRows('acceptance')
      compareRows('pending')
      return count
    }

    function DraftDiffSummary({ diff, style }) {
      if (!diff) return null
      const bucket = (key) => (Array.isArray(diff[key]) ? diff[key].length : 0)
      const added = bucket('added')
      const removed = bucket('removed')
      const modified = bucket('modified')
      const pending = bucket('pending')
      const parts = []
      if (added) parts.push(`新增 ${added}`)
      if (removed) parts.push(`删除 ${removed}`)
      if (modified) parts.push(`改写 ${modified}`)
      if (pending) parts.push(`待确认 ${pending}`)
      if (!parts.length) parts.push('无条款级差异')
      return h(
        'div',
        {
          'data-draft-diff': 'true',
          style: {
            marginTop: '6px',
            padding: '6px 10px',
            border: `1px solid ${T.line}`,
            borderRadius: '8px',
            fontSize: '11.5px',
            lineHeight: 1.6,
            color: T.text2,
            background: T.layer2,
            ...style,
          },
        },
        parts.join(' · '),
      )
    }

    function IntentDraftPanel({
      draft,
      open,
      onToggle,
      editingKey,
      editValue,
      editBusy,
      notice,
      diff,
      onStartEdit,
      onChangeEdit,
      onCancelEdit,
      onSaveEdit,
    }) {
      if (!draft) {
        return h(
          'section',
          { 'data-intent-draft': 'empty', style: { ...card, cursor: 'default', marginBottom: '10px', padding: '10px 14px' } },
          h('div', { style: { fontSize: '11px', letterSpacing: '.05em', color: T.text3, textTransform: 'uppercase' } }, '需求草稿'),
          h('div', { style: { fontSize: '12px', color: T.text3, marginTop: '4px' } }, '这份会话还没有结构化需求草稿（旧模型输出或服务端未返回 docDraft），确认时会按现有正文处理。'),
        )
      }
      const features = Array.isArray(draft.features) ? draft.features : []
      const acceptance = Array.isArray(draft.acceptance) ? draft.acceptance : []
      const scope = draftList(draft.scope)
      const outOfScope = draftList(draft.outOfScope)
      const constraints = draftList(draft.constraints)
      const pending = Array.isArray(draft.pending) ? draft.pending : []
      const docHash = typeof draft.docHash === 'string' ? draft.docHash : ''
      const shortDocHash = docHash ? shortHash(docHash.replace(/^sha256:/, '')) : ''
      const noticeCount = typeof notice?.count === 'number' ? notice.count : 0
      const changeCount = draftChangesCount(diff) || noticeCount
      const noticeText = notice?.message ?? (changeCount ? `草稿已更新（${changeCount} 处变化）` : '')
      const sectionLabel = {
        fontSize: '11px',
        letterSpacing: '.05em',
        color: T.text3,
        textTransform: 'uppercase',
      }
      const paragraph = { fontSize: '13px', lineHeight: 1.7, color: T.text2, marginTop: '4px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowWrap: 'anywhere' }
      const listBody = (rows, empty) =>
        rows.length
          ? h(
              'ul',
              { style: { margin: '4px 0 0', paddingLeft: '18px', fontSize: '13px', lineHeight: 1.7, color: T.text2 } },
              rows.map((row, index) => h('li', { key: `${index}-${row.slice(0, 24)}` }, row)),
            )
          : h('div', { style: { fontSize: '12.5px', color: T.text3, marginTop: '4px' } }, empty)
      const editorFor = (key, rows = 2) =>
        h(
          'div',
          { style: { marginTop: '6px' } },
          h('textarea', {
            'data-draft-edit-input': key,
            name: `draft-edit-${key}`,
            autoComplete: 'off',
            'aria-label': `编辑草稿 ${key}`,
            value: editValue,
            onChange: (event) => onChangeEdit(event.target.value),
            rows,
            style: { ...input, width: '100%', minWidth: 0, resize: 'vertical', fontFamily: 'inherit', fontSize: '13px', lineHeight: 1.7, boxSizing: 'border-box' },
          }),
          h(
            'div',
            { style: { display: 'flex', gap: '6px', marginTop: '6px' } },
            h('button', { type: 'button', 'data-draft-edit-save': key, style: { ...primary, padding: '2px 10px' }, disabled: editBusy, onClick: onSaveEdit }, editBusy ? '保存中…' : '保存修改'),
            h('button', { type: 'button', style: { ...button, padding: '2px 10px' }, disabled: editBusy, onClick: onCancelEdit }, '取消'),
          ),
        )
      const section = (key, title, value, body, options = {}) => {
        const editing = editingKey === key
        return h(
          'div',
          { 'data-draft-section': key, style: { borderTop: `1px solid ${T.line}`, paddingTop: '8px', marginTop: '8px', minWidth: 0 } },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' } },
            h('div', { style: sectionLabel }, title),
            options.provenance ? draftProvenanceBadge(options.provenance) : null,
            options.locked
              ? null
              : h(
                  'button',
                  {
                    type: 'button',
                    'data-draft-edit': key,
                    style: { ...DETAIL_LINK, marginLeft: 'auto', fontSize: '11.5px' },
                    disabled: editBusy,
                    onClick: () => onStartEdit(key, value),
                  },
                  editing ? '编辑中' : '编辑',
                ),
          ),
          editing ? editorFor(key, options.rows ?? 2) : body,
        )
      }
      const provenanceOf = draft.provenance ?? (draft.confirmedAt ? 'verified-context' : 'unconfirmed')
      const pendingRows = pending.map((entry, index) => {
        if (typeof entry === 'string') return { id: `Q-${String(index + 1).padStart(2, '0')}`, text: entry, status: 'open' }
        return { id: entry?.id ?? `Q-${String(index + 1).padStart(2, '0')}`, text: entry?.text ?? '', status: entry?.status ?? 'open' }
      })
      return h(
        'section',
        {
          'data-intent-draft': 'panel',
          'aria-label': '需求草稿',
          style: { ...card, cursor: 'default', marginBottom: '10px', padding: '10px 14px', minWidth: 0 },
        },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
          h(
            'button',
            {
              type: 'button',
              'data-draft-toggle': 'true',
              'aria-expanded': open ? 'true' : 'false',
              style: { ...button, padding: '2px 10px' },
              onClick: onToggle,
            },
            open ? '收起需求草稿' : '展开需求草稿',
          ),
          h('span', { style: { fontSize: '12.5px', fontWeight: 600, color: T.text } }, '需求草稿'),
          h('span', { style: { fontSize: '11px', color: T.text3 } }, `v${draft.draftRevision ?? '—'}`),
          h('span', { style: { fontSize: '11px', color: T.text3 } }, `${features.length} 个功能 · ${acceptance.length} 条验收`),
          h(
            'span',
            {
              'data-draft-diff-count': String(changeCount),
              role: 'status',
              'aria-live': 'polite',
              style: { fontSize: '11.5px', color: changeCount ? T.warn : T.text3, marginLeft: 'auto' },
            },
            noticeText || (changeCount ? `草稿已更新（${changeCount} 处变化）` : '草稿未变化'),
          ),
          docHash
            ? h(
                'span',
                {
                  'data-draft-dochash': shortDocHash,
                  title: docHash,
                  style: { fontSize: '11px', color: T.text3, fontFamily: 'ui-monospace, Cascadia Code, monospace' },
                },
                shortDocHash,
              )
            : null,
          editBusy ? h('span', { style: { fontSize: '11.5px', color: T.text3 } }, '正在保存…') : null,
        ),
        open
          ? h(
              'div',
              { 'data-draft-body': 'true', style: { marginTop: '8px', minWidth: 0 } },
              h(DraftDiffSummary, { diff }),
              section('goal', '目标', draftText(draft.goal), h('div', { style: paragraph }, draftText(draft.goal) || '（尚未填写）'), {
                provenance: provenanceOf,
                rows: 2,
              }),
              section(
                'problem',
                '问题与场景',
                draftText(draft.problem),
                h('div', { style: paragraph }, draftText(draft.problem) || '（尚未填写）'),
                { provenance: provenanceOf, rows: 3 },
              ),
              h(
                'div',
                { 'data-draft-section': 'features', style: { borderTop: `1px solid ${T.line}`, paddingTop: '8px', marginTop: '8px', minWidth: 0 } },
                h('div', { style: { ...sectionLabel, marginBottom: '2px' } }, `详细功能（${features.length}）`),
                features.length
                  ? features.map((feature) => {
                      const id = draftText(feature?.id) || 'FR-??'
                      const key = `feature:${id}`
                      const editing = editingKey === key
                      const clauses = []
                      if (feature?.preconditions?.length) clauses.push(`前置：${draftList(feature.preconditions).join('；')}`)
                      if (feature?.response) clauses.push(`响应：${draftText(feature.response)}`)
                      if (feature?.boundaries?.length) clauses.push(`边界：${draftList(feature.boundaries).join('；')}`)
                      return h(
                        'div',
                        {
                          key,
                          'data-draft-feature': id,
                          style: { border: `1px solid ${T.line}`, borderRadius: '8px', padding: '6px 10px', marginTop: '6px', minWidth: 0 },
                        },
                        h(
                          'div',
                          { style: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' } },
                          h('span', { style: { fontSize: '12.5px', fontWeight: 600, color: T.text } }, `${id}${feature?.title ? ` ${draftText(feature.title)}` : ''}`),
                          draftProvenanceBadge(feature?.provenance),
                          h(
                            'button',
                            {
                              type: 'button',
                              'data-draft-edit': key,
                              style: { ...DETAIL_LINK, marginLeft: 'auto', fontSize: '11.5px' },
                              disabled: editBusy,
                              onClick: () => onStartEdit(key, draftText(feature?.behavior)),
                            },
                            editing ? '编辑中' : '编辑',
                          ),
                        ),
                        editing
                          ? editorFor(key, 3)
                          : h(
                              'div',
                              { style: { fontSize: '13px', lineHeight: 1.7, color: T.text2, marginTop: '4px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowWrap: 'anywhere' } },
                              draftText(feature?.behavior) || '（尚未填写行为）',
                            ),
                        clauses.length
                          ? h('div', { style: { fontSize: '12px', lineHeight: 1.7, color: T.text3, marginTop: '3px' } }, clauses.join('；'))
                          : null,
                      )
                    })
                  : h('div', { style: { fontSize: '12.5px', color: T.text3, marginTop: '4px' } }, '（尚未拆分功能条目）'),
              ),
              h(
                'div',
                { 'data-draft-section': 'acceptance', style: { borderTop: `1px solid ${T.line}`, paddingTop: '8px', marginTop: '8px', minWidth: 0 } },
                h('div', { style: { ...sectionLabel, marginBottom: '2px' } }, `验收要求（${acceptance.length}）`),
                acceptance.length
                  ? acceptance.map((entry) => {
                      const id = draftText(entry?.id) || 'AC-??'
                      const key = `ac:${id}`
                      const editing = editingKey === key
                      const relates = draftList(entry?.featureIds)
                      return h(
                        'div',
                        { key, 'data-draft-ac': id, style: { border: `1px solid ${T.line}`, borderRadius: '8px', padding: '6px 10px', marginTop: '6px', minWidth: 0 } },
                        h(
                          'div',
                          { style: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' } },
                          h('span', { style: { fontSize: '12.5px', fontWeight: 600, color: T.text } }, id),
                          relates.length ? h('span', { style: { fontSize: '11px', color: T.text3 } }, `关联 ${relates.join(' / ')}`) : null,
                          draftProvenanceBadge(entry?.provenance),
                          h(
                            'button',
                            {
                              type: 'button',
                              'data-draft-edit': key,
                              style: { ...DETAIL_LINK, marginLeft: 'auto', fontSize: '11.5px' },
                              disabled: editBusy,
                              onClick: () => onStartEdit(key, draftText(entry?.text)),
                            },
                            editing ? '编辑中' : '编辑',
                          ),
                        ),
                        editing
                          ? editorFor(key, 3)
                          : h(
                              'div',
                              { style: { fontSize: '13px', lineHeight: 1.7, color: T.text2, marginTop: '4px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowWrap: 'anywhere' } },
                              draftText(entry?.text) || '（尚未填写验收条款）',
                            ),
                        entry?.judgement ? h('div', { style: { fontSize: '12px', lineHeight: 1.7, color: T.text3, marginTop: '3px' } }, `判定：${draftText(entry.judgement)}`) : null,
                      )
                    })
                  : h('div', { style: { fontSize: '12.5px', color: T.text3, marginTop: '4px' } }, '（尚未提炼验收条目）'),
              ),
              section('scope', '本次范围', scope.join('\n'), listBody(scope, '（尚未填写范围）'), { rows: 3 }),
              section('outOfScope', '不包含', outOfScope.join('\n'), listBody(outOfScope, '（尚未填写不包含项）'), { rows: 3 }),
              section('constraints', '必要约束', constraints.join('\n'), listBody(constraints, '（尚未填写约束）'), { rows: 3 }),
              h(
                'div',
                { 'data-draft-section': 'pending', style: { borderTop: `1px solid ${T.line}`, paddingTop: '8px', marginTop: '8px', minWidth: 0 } },
                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' } },
                  h('div', { style: sectionLabel }, `待确认（${pendingRows.length}）`),
                  h('span', { style: { fontSize: '11px', color: T.text3 } }, '未纳入正式承诺'),
                ),
                pendingRows.length
                  ? h(
                      'ul',
                      { style: { margin: '4px 0 0', paddingLeft: '18px', fontSize: '12.5px', lineHeight: 1.7, color: T.text2 } },
                      pendingRows.map((entry) => h('li', { key: entry.id }, `${entry.id} ${entry.text}${entry.status && entry.status !== 'open' ? `（${entry.status}）` : ''}`)),
                    )
                  : h('div', { style: { fontSize: '12.5px', color: T.text3, marginTop: '4px' } }, '没有待确认项。'),
              ),
            )
          : null,
      )
    }
    const intentInputRecovery = new Map()
    const intentEditRecovery = new Map()
    function IntentModal({ root, project, projectName, projectId, onClose: closeModal, onCreated, onOpenRequirement }) {
      const recoveryScope = `${root ?? ''}\n${projectId ?? project ?? ''}`
      const [recoveredInput] = useState(() => intentInputRecovery.get(recoveryScope) ?? null)
      useEffect(() => {
        if (recoveredInput && intentInputRecovery.get(recoveryScope) === recoveredInput) intentInputRecovery.delete(recoveryScope)
      }, [])
      const explicitlyClosedRef = useRef(false)
      const onClose = () => { explicitlyClosedRef.current = true; intentInputRecovery.delete(recoveryScope); closeModal() }
      const [screen, setScreen] = useState('input')
      const [history, setHistory] = useState({ loading: false, sessions: [], error: null, selected: null })
      const [editRecoveries, setEditRecoveries] = useState(() => intentEditRecovery.get(recoveryScope) ?? [])
      const historyRequestRef = useRef(0)
      const historyRecoveryRef = useRef(null)
      const historyAbortRef = useRef(null)
      const historyScope = `${root ?? ''}\n${projectId ?? project ?? ''}`
      const historyScopeRef = useRef(historyScope)
      const initializedHistoryScopeRef = useRef(historyScope)
      historyScopeRef.current = historyScope
      const explicitProject = projectId || project
      const historyAllowed = !!explicitProject && explicitProject !== ALL_PROJECTS
      const historyCurrent = (token, scope) => mountedRef.current && historyRequestRef.current === token && historyScopeRef.current === scope
      const invalidateHistory = () => { historyRequestRef.current += 1; historyAbortRef.current?.abort(); historyAbortRef.current = null }

      const [rawText, setRawText] = useState(() => recoveredInput?.rawText ?? '')
      const [requirementMatch, setRequirementMatch] = useState(null)
      const [attachMatchedFeedback, setAttachMatchedFeedback] = useState(true)
      const matchRequestRef = useRef(0)
      const [source, setSource] = useState(() => recoveredInput?.source ?? 'text')
      const [attachment, setAttachment] = useState(() => recoveredInput?.attachment ?? null)
      const [chatMarkdown, setChatMarkdown] = useState(() => recoveredInput?.chatMarkdown ?? '')
      const [intake, setIntake] = useState(() => recoveredInput?.intake ?? { loading: false, error: null, data: null })
      const intakeRequestRef = useRef(0)
      // 图文 composer：图片先停在待识别状态，OCR 推迟到用户点「分析意图」。
      const [images, setImages] = useState(() => recoveredInput?.images ?? [])
      const imagesRef = useRef([])
      imagesRef.current = images
      const imageGenerationRef = useRef(0)
      const imageReadEpochRef = useRef(0)
      const imageReadsRef = useRef(0)
      const pendingImageFilesRef = useRef(new Set())
      const clearImages = () => {
        imageGenerationRef.current += 1
        pendingImageFilesRef.current.clear()
        for (const image of imagesRef.current) {
          if (image.previewObjectUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(image.previewObjectUrl)
        }
        imagesRef.current = []
        setImages([])
      }
      const fileInputRef = useRef(null)
      const [analyzePhase, setAnalyzePhase] = useState(null)
      const [expandedImageId, setExpandedImageId] = useState(null)
      const [dragging, setDragging] = useState(false)
      const [composerFocused, setComposerFocused] = useState(false)
      const [ownerChoice, setOwnerChoice] = useState('')
      const [priorityChoice, setPriorityChoice] = useState('')
      const [simpleDraft, setSimpleDraft] = useState(null)
      const [grillAnswers, setGrillAnswers] = useState({})
      const [grillCustom, setGrillCustom] = useState({})
      const [session, setSession] = useState(null)
      const [manual, setManual] = useState({})
      const [routeChoices, setRouteChoices] = useState({})
      const [unknownChoices, setUnknownChoices] = useState({})
      const [conflicts, setConflicts] = useState([])
      const [busy, setBusy] = useState(false)
      const [editBusy, setEditBusy] = useState(false)
      const [error, setError] = useState(null)
      const [notice, setNotice] = useState(() => recoveredInput ? `已恢复本窗口中未提交的输入；重新打开应用后无法恢复。${recoveredInput.intakeInterrupted ? '聊天解析已中断，请重新解析。' : ''}` : null)
      const [questionText, setQuestionText] = useState('')
      const [serverBlockers, setServerBlockers] = useState([])
      const [confirmState, setConfirmState] = useState({ loading: false, error: null, result: null })
      const [rehearsal, setRehearsal] = useState({ loading: false, error: null, data: null, base: null })
      const [receipt, setReceipt] = useState(null)
      const [answerChoice, setAnswerChoice] = useState(null)
      const [answerBusy, setAnswerBusy] = useState(false)
      const [answerElapsed, setAnswerElapsed] = useState(0)
      const [answerFeedback, setAnswerFeedback] = useState(null)
      const [answerCheck, setAnswerCheck] = useState(null)
      // 问题组（intent-review.v2）：一次可回答 1..3 个问题；旧会话没有 questionGroup 时仍走单题 UI。
      const [groupDrafts, setGroupDrafts] = useState({})
      const [groupBusy, setGroupBusy] = useState(false)
      const [groupElapsed, setGroupElapsed] = useState(0)
      const [groupFeedback, setGroupFeedback] = useState(null)
      const [analysisMonitorLost, setAnalysisMonitorLost] = useState(false)
      const [editingQuestionId, setEditingQuestionId] = useState(null)
      const [expandedWhy, setExpandedWhy] = useState({})
      const [decisionsOpen, setDecisionsOpen] = useState(false)
      const [answerHistoryPage, setAnswerHistoryPage] = useState(null)
      const answerHistoryAbort = useRef(null)
      const answerHistoryKey = JSON.stringify([root, historyScope, session?.sessionId, session?.historicalAnswersSnapshot])
      const answerHistoryKeyRef = useRef(answerHistoryKey)
      answerHistoryKeyRef.current = answerHistoryKey
      useEffect(() => {
        setAnswerHistoryPage(null)
        return () => { answerHistoryAbort.current?.abort(); answerHistoryAbort.current = null }
      }, [answerHistoryKey])
      const [draftBarExpanded, setDraftBarExpanded] = useState(false)
      const [draftOpen, setDraftOpen] = useState(false)
      const [draftEditing, setDraftEditing] = useState(null)
      const [draftEditValue, setDraftEditValue] = useState('')
      const [draftBusy, setDraftBusy] = useState(false)
      const [draftNotice, setDraftNotice] = useState(null)
      const [draftDiff, setDraftDiff] = useState(null)
      const draftPrevRef = useRef(null)
      const [investigations, setInvestigations] = useState([])
      const [investigation, setInvestigation] = useState({ open: false, busy: false, elapsed: 0, error: null, data: null, question: null, expandedId: null })
      const requestRef = useRef(0)
      const abortRef = useRef(null)
      const retryAnalysisRef = useRef(false)
      const answerAbortRef = useRef(null)
      const answerPollRef = useRef(null)
      const answerPollAbortRef = useRef(null)
      const answerTimerRef = useRef(null)
      const investAbortRef = useRef(null)
      const investTimerRef = useRef(null)
      const mountedRef = useRef(true)
      const sessionRef = useRef(null)
      const aiValuesRef = useRef({ inputRevision: null, values: {} })
      const idemRef = useRef(null)
      const screenHeadingRef = useRef(null)
      const blockerRef = useRef(null)
      const priorityRef = useRef(null)
      const editQueueRef = useRef(Promise.resolve())
      const adoptionUncertainRef = useRef(false)
      const confirmEntryRef = useRef(false)
      const editPendingRef = useRef(0)
      const editGenerationRef = useRef(0)
      const groupTimerRef = useRef(null)
      const groupPollRef = useRef(null)
      const groupPollAbortRef = useRef(null)
      const groupPanelRef = useRef(null)
      const groupFeedbackRef = useRef(null)
      const candidateRef = useRef(null)

      const fieldLabelStyle = { fontSize: '11px', letterSpacing: '.06em', textTransform: 'uppercase', color: T.text3 }
      const blockTitleStyle = { fontSize: '12px', fontWeight: 600, color: T.text }

      const candidateDirty = Object.entries(manual).some(([itemId, fields]) => {
        const item = (session?.items ?? []).find(entry => entry.itemId === itemId)
        return Object.entries(fields ?? {}).some(([field, value]) => !intentSame(value, item?.candidate?.[field]))
      })
      const routeDirty = Object.entries(routeChoices).some(([itemId, value]) => {
        const item = (session?.items ?? []).find(entry => entry.itemId === itemId)
        return value !== (item?.effectiveRoute ?? item?.recommendedRoute ?? 'create')
      })
      const explicitDirty = Boolean(session?.sessionId) && (ownerChoice !== (session.input?.explicit?.owner ?? '') || priorityChoice !== (session.input?.explicit?.priority ?? ''))
      const unknownDirty = Object.entries(unknownChoices).some(([key, value]) => {
        const separator = key.lastIndexOf(':')
        const item = (session?.items ?? []).find(entry => entry.itemId === key.slice(0, separator))
        const index = Number(key.slice(separator + 1))
        return separator < 1 || !Number.isInteger(index) || !item?.unknowns?.[index] || value !== (item.unknowns[index].resolution ?? 'pending')
      })
      const unsavedIntent = screen !== 'receipt' && (
        (screen === 'input' && (rawText !== (session?.input?.rawText ?? '') || images.length > 0 || Boolean(chatMarkdown.trim()))) ||
        candidateDirty || routeDirty || explicitDirty || unknownDirty || Boolean(draftEditing) || Object.keys(groupDrafts).length > 0 || answerChoice !== null || Boolean(questionText.trim()) ||
        editBusy || draftBusy || answerBusy || groupBusy || confirmState.loading
      )
      const historyInputRef = useRef(null)
      historyInputRef.current = { rawText, chatMarkdown, images, source, attachment, intake, ownerChoice, priorityChoice }
      const recoveryRef = useRef(null)
      recoveryRef.current = { scope: recoveryScope, screen, session, rawText, chatMarkdown, images, source, attachment, intake, unsavedIntent, manual, routeChoices, unknownChoices, ownerChoice, priorityChoice, questionText, answerChoice, groupDrafts, editingQuestionId, draftEditing, draftEditValue }
      useEffect(() => {
        const guard = event => {
          if (unsavedIntent || imageReadsRef.current > 0) { event.preventDefault(); event.returnValue = '' }
        }
        window.addEventListener?.('beforeunload', guard)
        return () => window.removeEventListener?.('beforeunload', guard)
      }, [unsavedIntent])

      useEffect(() => {
        mountedRef.current = true
        const pendingRecovery = intentInputRecovery.get(recoveryScope)
        if (pendingRecovery?.owner === recoveryRef) intentInputRecovery.delete(recoveryScope)
        const existingEdits = intentEditRecovery.get(recoveryScope) ?? []
        const retainedEdits = existingEdits.filter(entry => entry.owner !== recoveryRef)
        if (retainedEdits.length !== existingEdits.length) {
          if (retainedEdits.length) intentEditRecovery.set(recoveryScope, retainedEdits)
          else intentEditRecovery.delete(recoveryScope)
        }
        return () => {
          const current = recoveryRef.current
          if (!explicitlyClosedRef.current && current?.screen === 'input' && !current.session && (current.rawText || current.chatMarkdown || current.images.length || pendingImageFilesRef.current.size)) {
            intentInputRecovery.set(current.scope, {
              owner: recoveryRef,
              rawText: current.rawText,
              chatMarkdown: current.chatMarkdown,
              source: current.source,
              attachment: current.attachment,
              intakeInterrupted: current.intake.loading,
              intake: current.intake.loading ? { loading: false, error: null, data: null } : current.intake,
              images: current.images.map(image => ({ ...image, previewObjectUrl: null, previewUrl: `data:${image.mimeType || 'image/png'};base64,${image.dataBase64}`, status: 'pending', data: null, error: null })),
              pendingFiles: Array.from(pendingImageFilesRef.current).flat(),
            })
          }
          if (!explicitlyClosedRef.current && current?.session?.sessionId && current.unsavedIntent && ['review', 'confirm'].includes(current.screen)) {
            intentEditRecovery.set(current.scope, [...(intentEditRecovery.get(current.scope) ?? []), { ...current, owner: recoveryRef }])
          }
          mountedRef.current = false
          imageGenerationRef.current += 1
          pendingImageFilesRef.current.clear()
          requestRef.current += 1
          if (answerTimerRef.current) clearInterval(answerTimerRef.current)
          if (answerPollRef.current) clearTimeout(answerPollRef.current)
          if (groupTimerRef.current) clearInterval(groupTimerRef.current)
          if (groupPollRef.current) clearTimeout(groupPollRef.current)
          if (investTimerRef.current) clearInterval(investTimerRef.current)
          for (const controller of [abortRef.current, answerAbortRef.current, answerPollAbortRef.current, groupPollAbortRef.current, investAbortRef.current]) {
            if (!controller) continue
            try {
              controller.abort()
            } catch {}
          }
          for (const image of imagesRef.current) {
            if (image.previewObjectUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(image.previewObjectUrl)
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
        if (node && typeof node.focus === 'function') {
          try { node.focus({ preventScroll: true }) } catch { node.focus() }
          const dialog = node.closest('[role="dialog"]')
          if (dialog) dialog.scrollTop = 0
        }
      }, [screen])

      // 修改已确认回答时，焦点落到该问题的第一个可交互控件，键盘用户不必重新 Tab 一遍。
      useEffect(() => {
        if (!editingQuestionId) return
        const panel = groupPanelRef.current
        if (!panel || typeof panel.querySelector !== 'function') return
        const node = panel.querySelector(`[data-question-id="${editingQuestionId}"] button[aria-pressed], [data-question-id="${editingQuestionId}"] textarea`)
        if (node && typeof node.focus === 'function') {
          try {
            node.focus({ preventScroll: true })
          } catch {
            node.focus()
          }
        }
      }, [editingQuestionId])

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
      useEffect(() => {
        const draft = session?.docDraft
        if (!draft || !session?.sessionId) return
        const suggestions = [...(draft.acceptance ?? []).map(entry => ({ ...entry, text: entry.text ?? '' })), ...(draft.pending ?? []).filter(entry => /^\[验收建议·AI 建议\]/.test(entry.text ?? '')).map(entry => ({ text: entry.text.replace(/^\[验收建议·AI 建议\]\s*/, ''), provenance: 'ai-suggestion' }))]
        if (!suggestions.length) suggestions.push({ text: '用户能够完成预期变化。', provenance: 'ai-suggestion' }, { text: '用户能够核对预期变化是否生效。', provenance: 'ai-suggestion' })
        setSimpleDraft({ title: draft.title || session.items?.[0]?.candidate?.title || '', goal: draft.goal || '', problem: draft.problem || '', acceptance: suggestions })
        setGrillAnswers({})
      }, [session?.sessionId, Boolean(session?.docDraft)])
      const activeItems = () => (session?.items ?? []).filter((item) => !item.excluded)
      const routeOf = (item) => routeChoices[item?.itemId] ?? item?.effectiveRoute ?? item?.recommendedRoute ?? 'create'
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
        setAnalysisMonitorLost(false)
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
        const nextDraft = draftOfSession(view)
        const previousDraft = draftPrevRef.current
        draftPrevRef.current = nextDraft
        if (previousDraft && nextDraft && previousDraft.docHash !== nextDraft.docHash) {
          const changed = countDraftChanges(previousDraft, nextDraft)
          setDraftNotice({ count: changed, message: `草稿已更新（${changed} 处变化）` })
          setDraftDiff(null)
        }
        setSessionView(view)
      }
      const readHistory = async (sessionId = null, recovery = null) => {
        if (!historyAllowed) return
        if (sessionId && (unsavedIntent || imageReadsRef.current > 0) && !window.confirm('切换历史会话会丢弃当前未保存的内容，确定继续？')) return
        const inputAtStart = historyInputRef.current
        const editsAtStart = recoveryRef.current
        const imageReadAtStart = imageReadEpochRef.current
        invalidateHistory()
        editQueueRef.current = Promise.resolve()
        editPendingRef.current = 0
        editGenerationRef.current += 1
        setEditBusy(false)
        const token = historyRequestRef.current
        const scope = historyScope
        historyRecoveryRef.current = recovery
        const controller = new AbortController()
        historyAbortRef.current = controller
        let timedOut = false
        const timeout = setTimeout(() => { timedOut = true; controller.abort() }, 10000)
        if (sessionId) setNotice(null)
        setHistory((value) => ({ ...value, loading: true, error: null, selected: sessionId }))
        try {
          const query = `project=${encodeURIComponent(explicitProject)}&root=${encodeURIComponent(root ?? '')}`
          const suffix = sessionId ? `session=${encodeURIComponent(sessionId)}` : 'action=history'
          const signal = controller.signal
          const response = await fetch(`/api/alm/requirements/intent?${query}&${suffix}`, { headers: { accept: 'application/json' }, signal })
          const payload = await response.json().catch((error) => { if (signal.aborted) throw signal.reason ?? error; return null })
          if (!response.ok || payload?.ok === false) throw new Error(payload?.error?.message ?? `HTTP ${response.status}`)
          if (!historyCurrent(token, scope)) return
          if (!sessionId) {
            if (!Array.isArray(payload?.sessions) || payload.sessions.some(entry => !entry || typeof entry.sessionId !== 'string' || !entry.sessionId.trim())) throw new Error('意图历史响应不完整，请重试。')
            setHistory({ loading: false, sessions: payload.sessions, error: null, selected: null })
            return
          }
          const view = intentView(payload)
          if (!view || view.sessionId !== sessionId) throw new Error('服务端没有返回所选意图；请重试加载。')
          if (view.state === 'committed' && !view.receipt) throw new Error('已提交意图缺少原回执；无法安全恢复，请重试加载。')
          if (recovery && (view.state === 'committed' || !Number.isInteger(view.sessionRevision) || view.sessionRevision < 1 || !Number.isInteger(recovery.session.sessionRevision) || view.sessionRevision !== recovery.session.sessionRevision || !Number.isInteger(view.input?.inputRevision) || view.input.inputRevision < 1 || !Number.isInteger(recovery.session.input?.inputRevision) || view.input.inputRevision !== recovery.session.input.inputRevision)) {
            throw new Error('服务端会话已变化或版本未知，不能自动恢复编辑；请查看保留的本地内容并手动核对。')
          }
          const currentInput = historyInputRef.current
          const currentEdits = recoveryRef.current
          const editFields = ['session', 'manual', 'routeChoices', 'unknownChoices', 'questionText', 'answerChoice', 'groupDrafts', 'editingQuestionId', 'draftEditing', 'draftEditValue']
          if (editFields.some(field => currentEdits[field] !== editsAtStart[field]) || currentInput.rawText !== inputAtStart.rawText || currentInput.chatMarkdown !== inputAtStart.chatMarkdown || imagesRef.current !== inputAtStart.images || imageReadEpochRef.current !== imageReadAtStart || currentInput.source !== inputAtStart.source || currentInput.attachment !== inputAtStart.attachment || currentInput.intake !== inputAtStart.intake || currentInput.ownerChoice !== inputAtStart.ownerChoice || currentInput.priorityChoice !== inputAtStart.priorityChoice) {
            setHistory((value) => ({ ...value, loading: false, error: null, selected: null }))
            setNotice('加载期间输入已变化，当前内容已保留；请重新选择历史会话。')
            return
          }
          // A history row is metadata only. Always restore the authoritative latest view,
          // without carrying manual overrides, route choices or idempotency from another session.
          setManual({})
          setRouteChoices({})
          setUnknownChoices({})
          setConflicts([])
          setGroupDrafts({})
          setAnswerChoice(null)
          setQuestionText('')
          setAnswerFeedback(null)
          setGroupFeedback(null)
          setAnswerCheck(null)
          setEditingQuestionId(null)
          setDraftEditing(null)
          setDraftEditValue('')
          setDraftNotice(null)
          setDraftDiff(null)
          setDraftOpen(false)
          setServerBlockers([])
          adoptionUncertainRef.current = false
          setError(null)
          setNotice(null)
          setConfirmState({ loading: false, error: null, result: null })
          invalidateIdem()
          aiValuesRef.current = { inputRevision: null, values: {} }
          draftPrevRef.current = draftOfSession(view)
          setAnalysisMonitorLost(false)
          investAbortRef.current?.abort()
          investAbortRef.current = null
          stopTimer(investTimerRef)
          setSessionView(view)
          setInvestigations(intentInvestigationList(payload))
          setInvestigation({ open: false, busy: false, elapsed: 0, error: null, data: null, question: null, expandedId: null })
          setRawText(view.input?.rawText ?? '')
          intakeRequestRef.current += 1
          setIntake({ loading: false, error: null, data: null })
          setChatMarkdown('')
          setSource(view.input?.source ?? 'text')
          clearImages()
          setAttachment(null)
          setOwnerChoice(view.input?.explicit?.owner ?? '')
          setPriorityChoice(view.input?.explicit?.priority ?? '')
          setReceipt(view.receipt ? { receipt: view.receipt, artifacts: view.artifacts ?? view.receipt.artifacts ?? [], replayed: true } : null)
          if (recovery) {
            setManual(recovery.manual); setRouteChoices(recovery.routeChoices); setUnknownChoices(recovery.unknownChoices)
            setOwnerChoice(recovery.ownerChoice); setPriorityChoice(recovery.priorityChoice)
            setQuestionText(recovery.questionText); setAnswerChoice(recovery.answerChoice); setGroupDrafts(recovery.groupDrafts)
            setEditingQuestionId(recovery.editingQuestionId); setDraftEditing(recovery.draftEditing); setDraftEditValue(recovery.draftEditValue)
            setDraftOpen(Boolean(recovery.draftEditing))
            const remaining = (intentEditRecovery.get(scope) ?? []).filter(entry => entry !== recovery)
            if (remaining.length) intentEditRecovery.set(scope, remaining); else intentEditRecovery.delete(scope)
            setEditRecoveries(remaining)
            setNotice('已恢复未提交编辑，请核对后再提交。')
          }
          setScreen(view.state === 'committed' ? 'receipt' : 'review')
          setHistory((value) => ({ ...value, loading: false, error: null, selected: sessionId }))
          if (view.state !== 'committed' && view.analysisStatus?.status === 'running') {
            const requestToken = beginRequest()
            if (view.analysisStatus.origin === 'retry') {
              setNotice('正在重新分析，完成后自动更新会话。')
              pollAnalysis(sessionId, requestToken, true)
            } else if (view.questionGroup) {
              const savedInfo = {}
              setGroupFeedback({ kind: 'running', ...savedInfo, elapsed: 0 })
              pollGroupAnalysis(sessionId, requestToken, savedInfo)
            } else {
              setAnswerFeedback({ kind: 'success', message: '回答已记录，正在更新候选…' })
              pollAnalysis(sessionId, requestToken)
            }
          }
        } catch (caught) {
          if (!historyCurrent(token, scope)) return
          setHistory((value) => ({ ...value, loading: false, error: timedOut ? { message: '读取意图历史超时，请重试。' } : errorOf(caught), selected: sessionId }))
        } finally {
          clearTimeout(timeout)
          if (historyAbortRef.current === controller) historyAbortRef.current = null
        }
      }
      useEffect(() => {
        if (initializedHistoryScopeRef.current === historyScope) {
          return invalidateHistory
        }
        initializedHistoryScopeRef.current = historyScope
        invalidateHistory()
        setEditRecoveries(intentEditRecovery.get(historyScope) ?? [])
        requestRef.current += 1
        setHistory({ loading: false, sessions: [], error: null, selected: null })
        editQueueRef.current = Promise.resolve()
        editPendingRef.current = 0
        editGenerationRef.current += 1
        adoptionUncertainRef.current = false
        invalidateIdem()
        setSessionView(null)
        setOwnerChoice('')
        setPriorityChoice('')
        clearImages()
        setAttachment(null)
        setSource('text')
        intakeRequestRef.current += 1
        setChatMarkdown('')
        setIntake({ loading: false, error: null, data: null })
        setInvestigations([])
        setInvestigation({ open: false, busy: false, elapsed: 0, error: null, data: null, question: null, expandedId: null })
        setConflicts([])
        setGroupDrafts({})
        setServerBlockers([])
        setDraftNotice(null)
        setDraftDiff(null)
        setRawText('')
        setManual({})
        setRouteChoices({})
        setUnknownChoices({})
        setAnswerChoice(null)
        setQuestionText('')
        setAnswerFeedback(null)
        setGroupFeedback(null)
        setAnswerCheck(null)
        setGroupDrafts({})
        setReceipt(null)
        setError(null)
        setNotice(null)
        setBusy(false)
        setEditBusy(false)
        setDraftBusy(false)
        setDraftEditing(null)
        setDraftEditValue('')
        setConfirmState({ loading: false, error: null, result: null })
        setScreen('input')
        return invalidateHistory
      }, [historyScope])
      const renderHistory = () => h('section', { 'data-testid': 'intent-history' },
        editRecoveries.map((editRecovery, index) => h('div', { key: `${editRecovery.session.sessionId}:${index}`, role: 'group', 'aria-label': `本地编辑 ${editRecovery.session.sessionId} ${index + 1}`, style: { marginBottom: '8px', color: T.text2 } },
          h('p', null, `本窗口保留了未提交的澄清编辑：${editRecovery.session.sessionId}（第 ${index + 1} 份）。`),
          h('button', { type: 'button', style: button, disabled: history.loading, onClick: () => readHistory(editRecovery.session.sessionId, editRecovery) }, '核对版本并恢复编辑'),
          h('button', { type: 'button', style: button, disabled: history.loading, onClick: () => {
            if (!window.confirm('确定丢弃本窗口保留的未提交编辑？')) return
            const remaining = (intentEditRecovery.get(recoveryScope) ?? []).filter(entry => entry !== editRecovery)
            if (remaining.length) intentEditRecovery.set(recoveryScope, remaining); else intentEditRecovery.delete(recoveryScope)
            setEditRecoveries(remaining)
          } }, '丢弃本地编辑'),
          h('details', null, h('summary', null, '查看本地未提交内容'), h('pre', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, JSON.stringify({ candidate: editRecovery.manual, routes: editRecovery.routeChoices, unknowns: editRecovery.unknownChoices, owner: editRecovery.ownerChoice, priority: editRecovery.priorityChoice, answer: editRecovery.questionText, choice: editRecovery.answerChoice, answers: editRecovery.groupDrafts, draft: editRecovery.draftEditing ? { field: editRecovery.draftEditing, value: editRecovery.draftEditValue } : null }, null, 2))),
        )),
        h('button', { type: 'button', style: button, disabled: !historyAllowed || history.loading, onClick: () => readHistory() }, history.loading ? '加载历史中…' : '查看服务端意图历史'),
        !historyAllowed ? h('p', { role: 'status' }, '请先明确选择一个项目，再查看意图历史。') : null,
        history.error ? h('div', { role: 'alert' }, history.error.message,
          h('button', { type: 'button', style: button, onClick: () => readHistory(history.selected, historyRecoveryRef.current) }, '重试加载')) : null,
        history.sessions.map((entry) => h('button', {
          key: entry.sessionId, type: 'button', style: { ...button, display: 'block', marginTop: '6px' },
          'data-history-session': entry.sessionId, onClick: () => readHistory(entry.sessionId),
        }, `${entry.title ?? ''} · ${entry.sessionId} · ${entry.state} · ${entry.updatedAt ?? '更新时间未知'}`)),
      )
      const draftOf = () => draftOfSession(sessionRef.current ?? session)
      const draftPatchFor = (key, value) => {
        const draft = draftOf()
        if (!draft) return null
        const text = String(value ?? '')
        if (key === 'goal' || key === 'problem') return { [key]: text.trim() }
        if (key === 'scope' || key === 'outOfScope') {
          return { [key]: text.split('\n').map((line) => line.trim()).filter((line) => line !== '') }
        }
        if (key === 'constraints') {
          return { constraints: text.split('\n').map((line) => line.trim()).filter((line) => line !== '') }
        }
        if (key.startsWith('feature:')) {
          const id = key.slice('feature:'.length)
          const features = (Array.isArray(draft.features) ? draft.features : []).map((entry) =>
            entry?.id === id ? { ...entry, behavior: text.trim(), provenance: 'human-edit' } : entry,
          )
          return { features }
        }
        if (key.startsWith('ac:')) {
          const id = key.slice('ac:'.length)
          const acceptance = (Array.isArray(draft.acceptance) ? draft.acceptance : []).map((entry) =>
            entry?.id === id ? { ...entry, text: text.trim(), provenance: 'human-edit' } : entry,
          )
          return { acceptance }
        }
        return null
      }
      const startDraftEdit = (key, value) => {
        if (draftBusy) return
        setDraftOpen(true)
        setDraftEditing(key)
        setDraftEditValue(String(value ?? ''))
      }
      const cancelDraftEdit = () => {
        setDraftEditing(null)
        setDraftEditValue('')
      }
      const applyDraftResponse = (payload) => {
        if (payload?.session) applySession(payload.session)
        if (payload?.changes && !Array.isArray(payload.changes)) setDraftDiff(payload.changes)
        const current = draftOfSession(sessionRef.current) ?? draftOfSession(payload?.session)
        const count = draftChangesCount(payload?.changes) || countDraftChanges(draftPrevRef.current, current)
        setDraftNotice({ count, message: `草稿已更新（${count} 处变化）` })
        setDraftOpen(true)
      }
      const submitDraftEdit = () => {
        const key = draftEditing
        if (!key || draftBusy) return
        const patch = draftPatchFor(key, draftEditValue)
        if (!patch) {
          setDraftEditing(null)
          return
        }
        const current = sessionRef.current ?? session
        if (!current?.sessionId) {
          setError({ code: 'no-session', message: '服务端还没有这份会话，无法保存草稿修改；请先重新分析。' })
          return
        }
        const draft = draftOf()
        const baseRevision = draft?.draftRevision ?? current.draftRevision ?? null
        const historyToken = historyRequestRef.current
        const scope = historyScope
        setDraftBusy(true)
        setError(null)
        writeJson(
          'intent',
          {
            action: 'set-doc-draft',
            sessionId: current.sessionId,
            docDraft: patch,
            expectedDraftRevision: baseRevision,
            expectedSessionRevision: current.sessionRevision ?? null,
          },
          root,
        )
          .then((payload) => {
            if (!historyCurrent(historyToken, scope)) return
            if (payload?.session || payload?.changed === true) applyDraftResponse(payload)
            else setDraftNotice({ count: 0, message: '草稿未变化（服务端没有返回新草稿）' })
            setDraftEditing(null)
            setDraftEditValue('')
          })
          .catch((caught) => {
            if (!historyCurrent(historyToken, scope)) return
            setError(errorOf(caught))
          })
          .finally(() => {
            if (!historyCurrent(historyToken, scope)) return
            setDraftBusy(false)
          })
      }
      // 用户只在点「分析意图」时才触发识别：先把待识别图片逐张 OCR，再把
      // 原话 + 识别材料一起送去意图分析。识别结果缓存在图片上，重新分析不重复识别。
      const runAnalyze = async (options = {}) => {
        if (imageReadsRef.current > 0) {
          setError({ code: 'image-reading', message: '图片正在读取，请稍后再分析。' })
          return
        }
        const analysisOptions = options && typeof options === 'object' && !options.nativeEvent ? options : {}
        const retryExisting = screen === 'review' && Boolean(sessionRef.current?.sessionId) && analysisOptions.textOverride === undefined
        if (retryExisting && (draftEditing || Object.keys(groupDrafts).length || answerChoice !== null || questionText.trim())) {
          setError({ code: 'unsubmitted-edits', message: '请先保存或取消正在编辑的正文和回答，再重新分析。' })
          return
        }
        if (retryExisting && (candidateDirty || routeDirty || explicitDirty || editBusy)) {
          const scope = historyScope, historyToken = historyRequestRef.current, sessionId = sessionRef.current.sessionId
          setBusy(true)
          try {
            await editQueueRef.current
            if (!historyCurrent(historyToken, scope) || sessionRef.current?.sessionId !== sessionId) return
            if (!await flushAllEdits()) throw new Error('服务端未返回已保存会话')
            if (!historyCurrent(historyToken, scope) || sessionRef.current?.sessionId !== sessionId) return
          } catch (caught) {
            if (historyCurrent(historyToken, scope)) setError({ code: 'edit-save-failed', message: `保存当前编辑失败：${caught?.message ?? String(caught)}；请重试。` })
            return
          } finally { if (historyCurrent(historyToken, scope)) setBusy(false) }
        }
        const typedText = String(analysisOptions.textOverride ?? (retryExisting ? sessionRef.current?.input?.text : rawText) ?? '').trim()
        if (typedText === '' && images.length === 0) {
          setError({ code: 'input-required', message: '请先用原话写下你想改变什么，或粘贴至少一张图片' })
          return
        }
        invalidateIdem()
        setServerBlockers([])
        setError(null)
        setNotice(null)
        setAnswerFeedback(null)
        setAnswerCheck(null)
        const token = beginRequest()
        retryAnalysisRef.current = retryExisting
        const controller = new AbortController()
        abortRef.current = controller
        setScreen('analyzing')
        setBusy(true)
        setAnalyzePhase({ phase: images.length > 0 ? 'ocr' : 'analyze', index: 0, total: images.length })
        let prepared = []
        try {
          prepared = await prepareOcrImages(retryExisting ? [] : images, {
            signal: controller.signal,
            isCurrent: () => isCurrent(token),
            onProgress: (index, total) => setAnalyzePhase({ phase: 'ocr', index, total }),
          })
        } catch (caught) {
          if (!isCurrent(token) || caught?.name === 'AbortError') return
          setBusy(false)
          setScreen('input')
          setError({ code: caught?.code ?? 'ocr-failed', message: caught?.message ?? '图片识别失败' })
          return
        }
        if (!isCurrent(token) || controller.signal.aborted) return
        const imageMaterial = prepared
          .map((image, index) => {
            const lines = image.data?.lines
            if (!Array.isArray(lines) || lines.length === 0) return ''
            return `图片 ${index + 1}（${image.name}）识别文本：\n${lines.map((line) => `${line.ref} ${line.text}`).join('\n')}`
          })
          .filter(Boolean)
          .join('\n\n')
        const recognizedText = prepared
          .map((image) => String(image.data?.text ?? '').trim())
          .filter(Boolean)
          .map((text, index, list) => (list.length > 1 ? `【图片 ${index + 1}】\n${text}` : text))
          .join('\n\n')
        const text = typedText === '' ? recognizedText : typedText
        if (text === '') {
          setBusy(false)
          setScreen('input')
          setError({ code: 'empty-input', message: '图片里没有识别到文字；请补充原话后再分析' })
          return
        }
        setAnalyzePhase({ phase: 'analyze', index: prepared.length, total: prepared.length })
        const parsedChat = intake.data?.schema === 'alm.intake.chat/v1' ? String(intake.data.text ?? '') : ''
        const chatText = parsedChat
        const collectedAttachment =
          prepared.length > 0
            ? {
                name: prepared.map((image) => image.name).join('、').slice(0, 200),
                kind: 'screenshot',
                size: prepared.reduce((total, image) => total + (Number(image.size) || 0), 0),
              }
            : attachment
              ? { name: attachment.name, kind: attachment.kind }
              : undefined
        const investigationIds = (analysisOptions.investigationIds ?? []).filter((id) => typeof id === 'string' && id !== '').slice(0, 5)
        const body = {
          action: 'analyze',
          projectId: projectId ?? project ?? undefined,
          input: {
            text,
            // 纯图片输入时，原话来自 OCR，来源标成 ocr；图文混合仍按文字/聊天记录。
            source: typedText === '' && prepared.length > 0 ? 'ocr' : source,
            extractedText: [chatText, imageMaterial].filter(Boolean).join('\n\n'),
            attachment: collectedAttachment,
          },
          explicit: { owner: ownerChoice.trim() || null, priority: priorityChoice || null },
        }
        if (investigationIds.length > 0) body.investigationIds = investigationIds
        if (Array.isArray(analysisOptions.grillAnswers) && analysisOptions.grillAnswers.length > 0) body.grillAnswers = analysisOptions.grillAnswers
        const previous = sessionRef.current
        if (previous?.sessionId) body.sessionId = previous.sessionId
        if (retryExisting) { body.retryExisting = true; body.expectedSessionRevision = previous.sessionRevision }
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
            const match = payload?.matchedReq
            if (match?.matchedReqId && ['high', 'medium'].includes(match.confidence)) {
              setRequirementMatch(match)
              setAttachMatchedFeedback(true)
            } else setRequirementMatch(null)
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
              setNotice(`分析暂不可用：${info.message}。${retryExisting ? '会话可能已变化，请在“分析与草案信息”中重新加载会话后再操作。' : '你仍可手动填写候选并保存会话，稍后再确认；现在不会创建任何需求。'}`)
              setScreen(view || retryExisting ? 'review' : 'input')
              return
            }
            setError(info)
            if (retryExisting && !view) setNotice('会话可能已变化，请在“分析与草案信息”中重新加载会话后再操作。')
            setScreen(view || retryExisting || investigationIds.length > 0 ? 'review' : 'input')
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
        setScreen(retryAnalysisRef.current ? 'review' : 'input')
        setAnalyzePhase(null)
        setImages((current) => current.map((image) => (image.status === 'recognizing' ? { ...image, status: 'pending' } : image)))
        setNotice(retryAnalysisRef.current
          ? '已停止等待；服务端分析可能仍在运行或已完成。请在“分析与草案信息”中重新加载会话后再操作。'
          : '已停止等待；服务端分析可能仍在运行或已完成，旧结果不会自动写入界面。')
      }
      const startManual = () => {
        if (imageReadsRef.current > 0) {
          setError({ code: 'image-reading', message: '图片正在读取，请稍后再填写候选。' })
          return
        }
        const text = rawText.trim()
        if (text === '') {
          setError({
            code: 'input-required',
            message: images.length > 0 ? '手动填写候选需要先写下原话；图片会在「分析意图」时识别。' : '请先用原话写下你想改变什么，再手动填写候选',
          })
          return
        }
        requestRef.current += 1
        invalidateIdem()
        setError(null)
        setNotice('手动填写：没有调用模型。未保存前不会创建任何东西；要保存仍需先拿到服务端会话（可稍后点“重新分析”）。')
        const recognizedMaterial = images
          .map((image) => {
            const lines = image.data?.lines
            if (!Array.isArray(lines) || lines.length === 0) return ''
            return `图片（${image.name}）识别文本：\n${lines.map((line) => `${line.ref} ${line.text}`).join('\n')}`
          })
          .filter(Boolean)
          .join('\n\n')
        const stub = intentManualSession({
          text,
          source,
          extractedText: [intake.data?.text ?? '', recognizedMaterial].filter(Boolean).join('\n\n'),
          attachment: images.length > 0 ? { name: images.map((image) => image.name).join('、').slice(0, 200), kind: 'screenshot' } : attachment ? { name: attachment.name, kind: attachment.kind } : null,
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
        answerPollAbortRef.current?.abort()
        answerPollAbortRef.current = null
        if (answerPollRef.current) {
          clearTimeout(answerPollRef.current)
          answerPollRef.current = null
        }
      }
      const pollSessionWithTimeout = (sessionId, controllerRef) => {
        const controller = new AbortController()
        controllerRef.current = controller
        let timeout
        return Promise.race([
          writeJson('intent', { action: 'load', sessionId }, root, { signal: controller.signal }),
          new Promise((_, reject) => { timeout = setTimeout(() => { reject(controller.signal.aborted ? Object.assign(new Error('已取消'), { name: 'AbortError' }) : new Error('读取超时')); controller.abort() }, 10000) }),
        ]).then(value => { if (controller.signal.aborted) throw Object.assign(new Error('已取消'), { name: 'AbortError' }); return value })
          .finally(() => { clearTimeout(timeout); if (controllerRef.current === controller) controllerRef.current = null })
      }
      // The answer request returns as soon as the answer is recorded; the
      // server re-runs the model in the background. Poll `load` until that run
      // finishes so the UI can show fresh candidates without blocking submit.
      const pollAnalysis = (sessionId, token, generic = false) => {
        stopAnswerPoll()
        const startedAt = Date.now()
        const tick = () => {
          if (!mountedRef.current || requestRef.current !== token) return
          if (Date.now() - startedAt > 90_000) {
            setAnalysisMonitorLost(true)
            if (generic) setNotice('重新分析状态读取超时；请重新加载会话后核对。')
            else setAnswerFeedback({ kind: 'analysis-error', message: '回答已记录，但重新分析超时；可点“重新分析”重试。' })
            return
          }
          pollSessionWithTimeout(sessionId, answerPollAbortRef)
            .then((payload) => {
              if (!mountedRef.current || requestRef.current !== token) return
              const view = intentView(payload)
              if (!view || view.sessionId !== sessionId) throw new Error('返回的会话与当前会话不一致')
              if (view) applySession(view)
              trackInvestigations(payload)
              const status = intentAnalysisStatus(payload)
              if (!status || !['running', 'done', 'error'].includes(status.status)) throw new Error('重新分析状态未知，请核对会话后重新分析')
              if (status.status === 'running') {
                answerPollRef.current = setTimeout(tick, 800)
                return
              }
              answerPollRef.current = null
              if (status.status === 'done') {
                if (generic) setNotice('重新分析已完成，会话已更新。')
                else setAnswerFeedback({ kind: 'success', message: '已记录你的回答，候选已更新' })
              } else {
                if (generic) setNotice(`重新分析失败：${status.error?.message ?? '未知错误'}；可重新分析。`)
                else setAnswerFeedback({ kind: 'analysis-error', message: `回答已记录，但重新分析失败：${status.error?.message ?? '未知错误'}；可点“重新分析”。` })
              }
            })
            .catch((caught) => {
              if (!mountedRef.current || requestRef.current !== token) return
              if (caught?.name === 'AbortError') return
              answerPollRef.current = null
              setAnalysisMonitorLost(true)
              if (generic) setNotice(`刷新会话失败：${caught.message ?? caught}；请重新加载会话。`)
              else setAnswerFeedback({ kind: 'analysis-error', message: `回答已记录，但刷新会话失败：${caught.message ?? caught}` })
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
        setAnswerCheck(null)
        setError(null)
        startTimer(answerTimerRef, () => setAnswerElapsed((current) => current + 1))
        const body = {
          action: 'answer',
          sessionId: session.sessionId,
          expectedInputRevision: session.input?.inputRevision ?? 0,
          questionId: payload.question.questionId,
        }
        if (typeof session.sessionRevision === 'number') body.expectedSessionRevision = session.sessionRevision
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
              setAnswerFeedback({ kind: 'analysis-error', message: `回答已记录，但重新分析失败：${status.error?.message ?? '未知错误'}；可点“重新分析”。` })
            } else if (status?.status === 'done') {
              setAnswerFeedback({ kind: 'success', message: '已记录你的回答，已更新候选' })
            } else {
              setAnswerFeedback({ kind: 'analysis-error', message: '回答已记录，但重新分析状态未知；请核对会话后重新分析。' })
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
            if (caught?.name === 'AbortError' || !Number.isInteger(caught?.status) || caught.status === 408 || caught.status >= 500) {
              setAnswerFeedback({ kind: 'uncertain', message: '未收到提交结果，回答可能已保存；已选内容仍保留，请先核对服务端会话再提交。' })
              return
            }
            const info = errorOf(caught)
            setAnswerFeedback({ kind: 'error', message: `提交失败：${info.message}`, retry: true })
            if (info.code === 'stale-input' || info.code === 'stale-context' || info.code === 'stale-session') {
              const historyToken = historyRequestRef.current, scope = historyScope
              const current = () => isCurrent(token) && historyCurrent(historyToken, scope) && sessionRef.current?.sessionId === session.sessionId
              setNotice(`会话已变化（${info.message}）；正在读取最新会话，本地回答仍保留。`)
              loadLatestSession(session.sessionId)
                .then((result) => {
                  const view = result?.view
                  if (!current()) return
                  if (!view || view.sessionId !== session.sessionId) throw new Error('会话不匹配')
                  applySession(view)
                  setAnswerChoice(null)
                  setNotice('已读取最新会话；请核对问题和保留的文字后重新作答。')
                  if (result.payload) trackInvestigations(result.payload)
                })
                .catch(() => { if (current()) setNotice('会话已变化，读取最新会话失败；本地回答仍保留，请重新打开会话核对。') })
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
        setAnswerFeedback({ kind: 'uncertain', message: '已停止等待，回答可能已保存；已选内容仍保留，请先核对服务端会话再提交。' })
      }

      // ---- 问题组（intent-review.v2）：1..3 个问题可连续作答、批量提交；无 questionGroup 时继续走旧单题流程 ----
      const questionGroupOf = () => {
        const group = sessionRef.current?.questionGroup ?? session?.questionGroup
        const questions = Array.isArray(group?.questions) ? group.questions.filter((question) => question && question.questionId && typeof question.text === 'string') : []
        const recommendations = Array.isArray(group?.recommendations)
          ? group.recommendations.filter((question) => question && question.questionId && typeof question.text === 'string')
          : []
        if (!group || (questions.length === 0 && recommendations.length === 0)) return null
        return { ...group, questions, recommendations }
      }
      const activeAnswerOf = (questionId) => {
        const list = session?.answers ?? []
        for (let index = list.length - 1; index >= 0; index -= 1) {
          const entry = list[index]
          if (!entry || entry.supersededBy) continue
          if (entry.questionId === questionId) return entry
        }
        return null
      }
      const lastAnswerOf = (questionId) => {
        const list = session?.answers ?? []
        for (let index = list.length - 1; index >= 0; index -= 1) {
          const entry = list[index]
          if (entry && entry.questionId === questionId) return entry
        }
        return null
      }
      const groupDraftFor = (question) => {
        const edited = groupDrafts[question.questionId]
        if (edited) return edited
        const active = activeAnswerOf(question.questionId)
        // 依据变化的 stale 问题：就算旧回答已被替代，也把上次答案带回卡片，
        // 让用户核对后再改，而不是从空白重新回答。
        const answer = active ?? (question.status === 'stale' ? lastAnswerOf(question.questionId) : null)
        const answerText = typeof answer?.text === 'string' ? answer.text : ''
        return {
          optionId: answer?.optionId ?? null,
          text: answerText,
          undecided: !answer?.optionId && answerText === '尚不能决定，需要调查',
          stalePrefill: Boolean(!active && answer),
        }
      }
      const groupProgressOf = (group) => {
        const stats = { total: 0, open: 0, answered: 0, stale: 0, pending: 0 }
        for (const question of group?.questions ?? []) {
          stats.total += 1
          if (question.status === 'answered') stats.answered += 1
          else if (question.status === 'stale') stats.stale += 1
          else stats.open += 1
        }
        stats.pending = stats.open + stats.stale
        return stats
      }
      const groupProgressText = (progress) => {
        const segments = [`待决定 ${progress.open} 项`, `已处理 ${progress.answered} 项`]
        if (progress.stale > 0) segments.push(`待重新核对 ${progress.stale} 项`)
        return segments.join(' · ')
      }
      const groupInteractionLocked = () => groupBusy || groupFeedback?.kind === 'running'
      const setGroupDraft = (questionId, patch) => {
        if (groupInteractionLocked()) return
        setGroupFeedback(null)
        setAnswerCheck(null)
        setGroupDrafts((current) => {
          const base = current[questionId] ?? { optionId: null, text: '', undecided: false }
          return { ...current, [questionId]: { ...base, ...patch } }
        })
      }
      const groupAnswersPayload = (group) => {
        const list = []
        for (const question of [...(group?.questions ?? []), ...(group?.recommendations ?? [])]) {
          if (question.status === 'answered' && editingQuestionId !== question.questionId) continue
          // 已作答的问题只在“修改”时才重新提交；stale 问题即使没有新草稿，
          // 也把带回的上次答案一并提交，等价于核对后重新确认。
          const draft = groupDrafts[question.questionId] ?? (question.status === 'stale' ? groupDraftFor(question) : null)
          if (!draft) continue
          const text = String(draft.text ?? '').trim()
          if (draft.undecided) {
            list.push({ questionId: question.questionId, text: text || '尚不能决定，需要调查' })
            continue
          }
          if (!draft.optionId && text === '') continue
          const entry = { questionId: question.questionId }
          if (draft.optionId) entry.optionId = draft.optionId
          if (text !== '') entry.text = text
          list.push(entry)
        }
        return list.slice(0, 3)
      }
      const stopGroupPoll = () => {
        groupPollAbortRef.current?.abort()
        groupPollAbortRef.current = null
        if (groupPollRef.current) {
          clearTimeout(groupPollRef.current)
          groupPollRef.current = null
        }
      }
      const groupTimingText = (payload) => {
        const view = intentView(payload) ?? sessionRef.current
        const last = view?.timingSummary?.lastRun
        if (!last) return null
        const total = Number(last.totalMs)
        if (!Number.isFinite(total) || total < 0) return null
        const model = Number(last.modelMs)
        if (Number.isFinite(model) && model >= 0) return `本轮分析 ${Math.round(total / 1000)}s（模型 ${Math.round(model / 1000)}s）`
        return `本轮分析 ${Math.round(total / 1000)}s`
      }
      const pollGroupAnalysis = (sessionId, token, savedInfo) => {
        stopGroupPoll()
        const startedAt = Date.now()
        const tick = () => {
          if (!mountedRef.current || requestRef.current !== token) return
          const elapsed = Math.round((Date.now() - startedAt) / 1000)
          pollSessionWithTimeout(sessionId, groupPollAbortRef)
            .then((payload) => {
              if (!mountedRef.current || requestRef.current !== token) return
              const view = intentView(payload)
              if (!view || view.sessionId !== sessionId) throw new Error('返回的会话与当前会话不一致')
              if (view) applySession(view)
              trackInvestigations(payload)
              const status = intentAnalysisStatus(payload)
              if (!status || !['running', 'done', 'error'].includes(status.status)) throw new Error('重新分析状态未知，请核对会话后重新分析')
              if (status.status === 'running') {
                if (elapsed >= 90) {
                  setAnalysisMonitorLost(true)
                  setGroupFeedback({ kind: 'timeout', ...savedInfo, elapsed, message: '回答已保存，但重新分析超时。', retryAnalysis: true })
                  return
                }
                setGroupFeedback({ kind: 'running', ...savedInfo, elapsed })
                groupPollRef.current = setTimeout(tick, 800)
                return
              }
              groupPollRef.current = null
              if (status.status === 'error') {
                setGroupFeedback({ kind: 'analysis-error', ...savedInfo, elapsed, message: `重新分析失败：${status.error?.message ?? '未知错误'}`, timing: groupTimingText(payload), retryAnalysis: true })
                return
              }
              setGroupFeedback({ kind: 'done', ...savedInfo, elapsed, timing: groupTimingText(payload) })
            })
            .catch((caught) => {
              if (!mountedRef.current || requestRef.current !== token) return
              if (caught?.name === 'AbortError') return
              groupPollRef.current = null
              setAnalysisMonitorLost(true)
              const info = errorOf(caught)
              setGroupFeedback({ kind: 'analysis-error', ...savedInfo, elapsed, message: `回答已保存，但刷新会话失败：${info.message}`, retryAnalysis: true })
            })
        }
        groupPollRef.current = setTimeout(tick, 800)
      }
      const submitGroupAnswers = () => {
        const group = questionGroupOf()
        if (!group || groupInteractionLocked()) return
        if (!session?.sessionId) {
          setGroupFeedback({ kind: 'error', message: '手动会话还没有服务端会话；先“重新分析”拿到会话后再提交回答。' })
          return
        }
        const answers = groupAnswersPayload(group)
        if (answers.length === 0) {
          setGroupFeedback({ kind: 'error', message: '先选择选项或写下回答，再提交本组回答。' })
          return
        }
        stopGroupPoll()
        stopAnswerPoll()
        const token = beginRequest()
        const controller = new AbortController()
        answerAbortRef.current = controller
        const startedAt = Date.now()
        setGroupBusy(true)
        setGroupElapsed(0)
        setGroupFeedback(null)
        setAnswerCheck(null)
        setError(null)
        setAnswerFeedback(null)
        startTimer(groupTimerRef, () => setGroupElapsed((current) => current + 1))
        const body = {
          action: 'answer',
          sessionId: session.sessionId,
          expectedInputRevision: session.input?.inputRevision ?? 0,
          answers,
        }
        if (typeof session.sessionRevision === 'number') body.expectedSessionRevision = session.sessionRevision
        writeJson('intent', body, root, { signal: controller.signal })
          .then((response) => {
            if (answerAbortRef.current !== controller) return
            answerAbortRef.current = null
            stopTimer(groupTimerRef)
            if (!isCurrent(token)) {
              setGroupBusy(false)
              return
            }
            setGroupBusy(false)
            invalidateIdem()
            const saveMs = Math.max(0, Date.now() - startedAt)
            const view = intentView(response)
            if (view) applySession(view)
            trackInvestigations(response)
            const savedCount = Array.isArray(response?.saved) ? response.saved.length : answers.length
            const savedInfo = { count: savedCount, saveMs }
            setGroupDrafts((current) => {
              const next = { ...current }
              for (const answer of answers) delete next[answer.questionId]
              return next
            })
            setEditingQuestionId(null)
            const status = intentAnalysisStatus(response)
            if (status?.status === 'running') {
              setGroupFeedback({ kind: 'running', ...savedInfo, elapsed: 0 })
              pollGroupAnalysis(session.sessionId, token, savedInfo)
              return
            }
            if (status?.status === 'error') {
              setGroupFeedback({ kind: 'analysis-error', ...savedInfo, elapsed: 0, message: `重新分析失败：${status.error?.message ?? '未知错误'}`, timing: groupTimingText(response), retryAnalysis: true })
              return
            }
            if (status?.status !== 'done') {
              setGroupFeedback({ kind: 'analysis-error', ...savedInfo, elapsed: 0, message: '回答已保存，但重新分析状态未知；请核对会话后重新分析。', retryAnalysis: true })
              return
            }
            setGroupFeedback({ kind: 'done', ...savedInfo, elapsed: 0, timing: groupTimingText(response) })
          })
          .catch((caught) => {
            if (answerAbortRef.current !== controller) return
            answerAbortRef.current = null
            stopTimer(groupTimerRef)
            if (!isCurrent(token)) {
              setGroupBusy(false)
              return
            }
            setGroupBusy(false)
            if (caught?.name === 'AbortError' || !Number.isInteger(caught?.status) || caught.status === 408 || caught.status >= 500) {
              setGroupFeedback({ kind: 'uncertain', message: '未收到提交结果，回答可能已保存；草稿仍保留，请先核对服务端会话再提交。' })
              return
            }
            const info = errorOf(caught)
            setGroupFeedback({ kind: 'save-error', message: `提交失败：${info.message}`, retry: true })
            if (info.code === 'stale-input' || info.code === 'stale-context' || info.code === 'stale-session') {
              const historyToken = historyRequestRef.current, scope = historyScope
              const current = () => isCurrent(token) && historyCurrent(historyToken, scope) && sessionRef.current?.sessionId === session.sessionId
              setNotice(`会话已变化（${info.message}）；正在读取最新会话，本地回答仍保留。`)
              loadLatestSession(session.sessionId)
                .then((result) => {
                  const view = result?.view
                  if (!current()) return
                  if (!view || view.sessionId !== session.sessionId) throw new Error('会话不匹配')
                  applySession(view)
                  setNotice('已读取最新会话；请核对问题和保留的回答后重试。')
                  if (result.payload) trackInvestigations(result.payload)
                })
                .catch(() => { if (current()) setNotice('会话已变化，读取最新会话失败；本地回答仍保留，请重新打开会话核对。') })
            }
          })
      }
      const cancelGroupSubmit = () => {
        const controller = answerAbortRef.current
        answerAbortRef.current = null
        if (controller) {
          try {
            controller.abort()
          } catch {}
        }
        stopTimer(groupTimerRef)
        setGroupBusy(false)
        setGroupFeedback({ kind: 'uncertain', message: '已停止等待，回答可能已保存；草稿仍保留，请先核对服务端会话再提交。' })
      }
      const jumpToCandidate = () => {
        const node = candidateRef.current
        node?.querySelectorAll?.('[data-intent-candidate]')?.forEach(detail => { detail.open = true })
        if (node && typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'start', behavior: REDUCE_MOTION ? 'auto' : 'smooth' })
      }
      const startEditingQuestion = (questionId) => {
        setEditingQuestionId(questionId)
        const panel = groupPanelRef.current
        if (!panel || typeof panel.querySelector !== 'function') return
        const node = panel.querySelector(`[data-question-id="${questionId}"]`)
        if (node && typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'center', behavior: REDUCE_MOTION ? 'auto' : 'smooth' })
      }
      const toggleDraftBar = () => {
        const next = !draftBarExpanded
        setDraftBarExpanded(next)
        if (!next) return
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => jumpToCandidate())
        else jumpToCandidate()
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
        const scope = historyScope
        const revision = current.input?.inputRevision
        const stillCurrent = () => mountedRef.current && historyScopeRef.current === scope && sessionRef.current?.sessionId === current.sessionId && sessionRef.current?.input?.inputRevision === revision
        setInvestigation({ open: true, busy: true, elapsed: 0, error: null, data: null, question: { questionId, text }, expandedId: null })
        startTimer(investTimerRef, () => {
          setInvestigation((current) => ({ ...current, elapsed: current.elapsed + 1 }))
        })
        const body = {
          action: 'investigate',
          sessionId: current.sessionId,
          expectedInputRevision: revision,
          questionId,
          question: text,
        }
        writeJson('intent', body, root, { signal: controller.signal })
          .then((payload) => {
            if (investAbortRef.current !== controller) return
            investAbortRef.current = null
            stopTimer(investTimerRef)
            if (!stillCurrent()) {
              if (mountedRef.current && historyScopeRef.current === scope) setInvestigation({ open: false, busy: false, elapsed: 0, error: null, data: null, question: null, expandedId: null })
              return
            }
            const data = payload?.investigation ?? payload?.data?.investigation ?? null
            if (!data || data.sessionId !== current.sessionId || data.inputRevision !== revision) {
              setInvestigation((state) => ({ ...state, busy: false, error: { message: '调查结果与当前输入不一致，请重新调查。' } }))
              return
            }
            mergeInvestigations([data, ...intentInvestigationList(payload)])
            setInvestigation((state) => ({ ...state, busy: false, error: null, data }))
          })
          .catch((caught) => {
            if (investAbortRef.current !== controller) return
            investAbortRef.current = null
            stopTimer(investTimerRef)
            if (!stillCurrent()) {
              if (mountedRef.current && historyScopeRef.current === scope) setInvestigation({ open: false, busy: false, elapsed: 0, error: null, data: null, question: null, expandedId: null })
              return
            }
            if (caught?.name === 'AbortError') {
              setInvestigation((state) => ({ ...state, busy: false, error: { code: 'cancelled', message: '已停止等待；服务端调查可能仍在完成，请重新加载会话核对。' } }))
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
        setInvestigation((state) => ({ ...state, busy: false, error: { code: 'cancelled', message: '已停止等待；服务端调查可能仍在完成，请重新加载会话核对。' } }))
      }
      const reanalyzeWithEvidence = (entry) => {
        const id = intentInvestigationId(entry)
        if (!id || entry?.sessionId !== sessionRef.current?.sessionId || !Number.isSafeInteger(entry?.inputRevision) || entry.inputRevision !== sessionRef.current?.input?.inputRevision) {
          setNotice('这条调查不属于当前输入版本；请先调查当前问题。')
          return
        }
        setInvestigation((state) => ({ ...state, open: false }))
        runAnalyze({ investigationIds: [id] })
      }
      const loadLatestSession = (sessionId) => {
        const controller = new AbortController()
        let timer
        return Promise.race([
          fetch(`/api/alm/requirements/intent?session=${encodeURIComponent(sessionId)}&project=${encodeURIComponent(explicitProject ?? '')}&root=${encodeURIComponent(root)}`, {
            headers: { accept: 'application/json' }, signal: controller.signal,
          }).then(async (response) => {
            const payload = await response.json().catch(() => null)
            if (!response.ok || payload?.ok === false) throw new Error(payload?.error?.message ?? `HTTP ${response.status}`)
            return { view: intentView(payload), payload }
          }),
          new Promise((_, reject) => { timer = setTimeout(() => { reject(new Error('读取超时')); controller.abort() }, 10000) }),
        ]).finally(() => clearTimeout(timer))
      }
      const checkAnswerSession = async () => {
        const current = sessionRef.current
        if (!current?.sessionId || answerCheck?.loading) return
        const token = requestRef.current
        const historyToken = historyRequestRef.current
        const scope = historyScope
        const stillCurrent = () => isCurrent(token) && historyCurrent(historyToken, scope) && sessionRef.current?.sessionId === current.sessionId
        setAnswerCheck({ loading: true })
        try {
          const result = await loadLatestSession(current.sessionId)
          if (!stillCurrent()) return
          if (result.view?.sessionId !== current.sessionId) throw new Error('返回的会话与当前会话不一致')
          if (!Array.isArray(result.view.answers) || result.view.answers.some(answer => !answer || typeof answer !== 'object' || Array.isArray(answer) || ['answerId', 'questionText', 'optionLabel', 'optionId', 'text'].some(key => answer[key] != null && typeof answer[key] !== 'string'))) throw new Error('会话回答不可用')
          setAnswerCheck({ answers: result.view.answers })
        } catch (caught) {
          if (stillCurrent()) setAnswerCheck({ error: caught?.message ?? '读取失败' })
        }
      }
      const renderAnswerCheck = () => h('div', { style: { flexBasis: '100%', fontSize: '12px', color: T.text2, lineHeight: 1.7 } },
        h('button', { type: 'button', style: button, disabled: answerCheck?.loading, onClick: checkAnswerSession }, answerCheck?.loading ? '读取中…' : '核对服务端回答'),
        answerCheck?.error ? h('p', { role: 'alert' }, `核对失败：${answerCheck.error}；本地输入仍保留。`) : null,
        answerCheck?.answers ? h('div', { role: 'status' },
          h('p', null, '以下为读取时已记录的回答；先前请求仍可能在读取后完成。'),
          answerCheck.answers.length ? h('ul', null, answerCheck.answers.map((answer, index) => h('li', { key: answer.answerId ?? index }, [answer.questionText, answer.optionLabel ?? answer.optionId, answer.text].filter(Boolean).join(' · ') || '回答内容不可用'))) : h('p', null, '读取时尚无已记录的回答。'),
        ) : null,
      )
      const sendEdit = (fields, itemId, strict = false) => {
        const current = sessionRef.current
        if (!current?.sessionId) return Promise.resolve(null)
        const body = {
          action: 'edit',
          sessionId: current.sessionId,
          expectedInputRevision: current.input?.inputRevision ?? 0,
          fields,
        }
        if (itemId) body.itemId = itemId
        const historyToken = historyRequestRef.current
        const scope = historyScope
        const editGeneration = ++editGenerationRef.current
        editPendingRef.current += 1
        setEditBusy(true)
        const run = () => {
          if (!historyCurrent(historyToken, scope)) return null
          if (adoptionUncertainRef.current) throw new Error('调查采纳结果未知，请先重新加载会话核对，再保存编辑。')
          const revision = sessionRef.current?.input?.inputRevision ?? 0
          if (sessionRef.current?.sessionId !== current.sessionId) throw new Error('会话在保存期间发生变化，请确认当前内容后重试。')
          return writeJson('intent', { ...body, expectedInputRevision: revision, expectedSessionRevision: sessionRef.current?.sessionRevision ?? null }, root).then((payload) => {
            if (!historyCurrent(historyToken, scope)) return null
            const view = intentView(payload)
            const live = sessionRef.current
            // 迟到响应：会话或输入版本已变化时丢弃，旧响应不得覆盖新输入/新会话。
            if (!view || live?.sessionId !== current.sessionId || (live?.input?.inputRevision ?? 0) !== revision) {
              if (strict) throw new Error('会话在保存期间发生变化，请确认当前内容后重试。')
              return null
            }
            sessionRef.current = view
            setSession(view)
            return view
          })
        }
        const queued = editQueueRef.current.then(run, run)
        editQueueRef.current = queued.catch(() => {})
        return queued
          .catch((caught) => {
            if (!historyCurrent(historyToken, scope)) return null
            const info = errorOf(caught)
            setError(info)
            if (info.code === 'stale-input' || info.code === 'stale-context' || info.code === 'stale-session') {
              const pendingNotice = `会话已变化（${info.message}）；正在重新读取，请再确认一次。`
              setNotice(pendingNotice)
              invalidateIdem()
              const sessionAtConflict = sessionRef.current
              const currentRead = () => historyCurrent(historyToken, scope) && editGenerationRef.current === editGeneration && sessionRef.current === sessionAtConflict && sessionAtConflict?.sessionId === current.sessionId
              const noteNewerSession = () => {
                if (historyCurrent(historyToken, scope) && sessionRef.current?.sessionId === current.sessionId) {
                  setNotice((notice) => notice === pendingNotice ? '会话在读取期间再次变化，请核对当前编辑。' : notice)
                }
              }
              loadLatestSession(current.sessionId)
                .then((result) => {
                  if (!currentRead()) { noteNewerSession(); return }
                  const view = result?.view
                  if (!view || view.sessionId !== current.sessionId) throw new Error('返回的会话与当前会话不一致')
                  applySession(view)
                  if (result?.payload) trackInvestigations(result.payload)
                  setNotice('会话已重新读取，请核对当前编辑后重试。')
                })
                .catch(() => {
                  if (currentRead()) setNotice('会话已变化，重新读取失败；当前填写仍保留，请重试。')
                  else noteNewerSession()
                })
            }
            if (strict) throw caught
            return null
          })
          .finally(() => {
            if (!historyCurrent(historyToken, scope)) return
            editPendingRef.current -= 1
            if (editPendingRef.current === 0) setEditBusy(false)
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
      const adoptInvestigation = async (item, unknown, entry) => {
        const current = sessionRef.current
        if (!current || editPendingRef.current > 0 || adoptionUncertainRef.current || busy) return
        const token = historyRequestRef.current
        const scope = historyScope
        const generation = ++editGenerationRef.current
        editPendingRef.current += 1
        setEditBusy(true)
        const run = async () => {
          if (!historyCurrent(token, scope)) return
          const controller = new AbortController()
          let timer
          let payload
          try {
            payload = await Promise.race([
              writeJson('intent', { action: 'adopt-investigation', sessionId: current.sessionId, expectedInputRevision: current.input?.inputRevision, expectedSessionRevision: current.sessionRevision, itemId: item.itemId, unknownDescription: unknown.description, investigationId: intentInvestigationId(entry) }, root, { signal: controller.signal }),
              new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('采纳请求超时')) }, 10000) }),
            ])
          } finally { clearTimeout(timer) }
          if (!historyCurrent(token, scope) || sessionRef.current?.sessionId !== current.sessionId || sessionRef.current?.sessionRevision !== current.sessionRevision) {
            if (mountedRef.current && historyScopeRef.current === scope && sessionRef.current?.sessionId === current.sessionId) setNotice('采纳请求已返回，但会话已重新读取或更改；请重新加载会话核对结果。')
            return
          }
          const view = intentView(payload)
          if (!view || view.sessionId !== current.sessionId) throw new Error('返回的会话不一致')
          invalidateIdem()
          setServerBlockers([])
          if (editGenerationRef.current === generation) setUnknownChoices((choices) => { const next = { ...choices }; delete next[`${item.itemId}:${item.unknowns.indexOf(unknown)}`]; return next })
          sessionRef.current = view
          setSession(view)
          setNotice('已采纳该调查用于此未知项；确认前仍会重新核对引用。')
        }
        const guardedRun = async () => {
          try { return await run() } catch (error) {
            if (historyCurrent(token, scope) && sessionRef.current?.sessionId === current.sessionId) adoptionUncertainRef.current = true
            throw error
          }
        }
        const queued = editQueueRef.current.then(guardedRun, guardedRun)
        editQueueRef.current = queued.catch(() => {})
        try {
          await queued
        } catch (error) {
          if (historyCurrent(token, scope) && sessionRef.current?.sessionId === current.sessionId) {
            adoptionUncertainRef.current = true
            setServerBlockers([{ code: 'adoption-unknown', message: '调查采纳结果未知，请重新加载会话核对后再操作。' }])
            setNotice('调查采纳结果未知，服务端可能已保存；请重新加载会话核对。')
            setError(errorOf(error))
          }
        } finally {
          if (historyCurrent(token, scope)) {
            editPendingRef.current -= 1
            if (editPendingRef.current === 0) setEditBusy(false)
          }
        }
      }
      const resolveConflict = (conflict, useAi) => {
        if (useAi) setManualField(conflict.itemId, conflict.field, conflict.aiValue)
        setConflicts((current) => current.filter((entry) => !(entry.itemId === conflict.itemId && entry.field === conflict.field)))
      }
      const flushAllEdits = async () => {
        const current = sessionRef.current
        if (!current?.sessionId) return null
        const items = current.items ?? []
        const merged = items.map((item) => ({ item, candidate: cleanCandidate(candidateOf(item)), route: routeOf(item) }))
        const resolutions = Object.entries(unknownChoices).map(([key, resolution]) => {
          const separator = key.indexOf(':')
          const itemId = key.slice(0, separator)
          const index = Number(key.slice(separator + 1))
          const item = items.find((entry) => entry.itemId === itemId)
          const description = item?.unknowns?.[index]?.description
          if (separator < 1 || !Number.isInteger(index) || index < 0 || typeof description !== 'string' || !description.trim() || item.unknowns.filter((entry) => entry.description === description).length !== 1) {
            throw new Error('未知项已变化，无法安全保存选择；当前填写仍保留，请重新核对未知项后重试。')
          }
          return { itemId, description, resolution }
        })
        if (merged.length === 0) return null
        let chain = Promise.resolve(current)
        for (const [index, entry] of merged.entries()) {
          const fields = {}
          const edited = manual[entry.item.itemId] ?? {}
          for (const field of INTENT_FIELDS) {
            if (edited[field] !== undefined) fields[field] = entry.candidate[field]
          }
          if (routeChoices[entry.item.itemId] !== undefined) fields.route = entry.route
          if (index === 0) {
            if (ownerChoice.trim()) fields.owner = ownerChoice.trim()
            if (priorityChoice) fields.priority = priorityChoice
            if (resolutions.length) fields.unknownResolutions = resolutions
          }
          if (Object.keys(fields).length) chain = chain.then(() => sendEdit(fields, entry.item.itemId, true))
        }
        return chain
      }
      const analysisPending = () =>
        (session?.analysisStatus?.status === 'running' && !analysisMonitorLost) || groupFeedback?.kind === 'running' || groupBusy || answerBusy
      // Confirmation has one source of truth: the readiness projected by the
      // server. The client only adds operations whose in-flight state cannot yet
      // be reflected in that projection. Missing readiness fails closed.
      const confirmationGate = (humanConfirmation = false) => {
        const current = sessionRef.current ?? session
        if (history.loading || history.error || current?.state === 'committed') return { ready: false, reasons: [{ code: 'history-not-editable', message: '历史尚未成功加载或已提交，不能确认' }], warnings: [] }
        const readiness = current?.readiness
        if (!readiness || typeof readiness.ready !== 'boolean') {
          return {
            ready: false,
            reasons: [{ code: 'readiness-unavailable', message: '服务端尚未返回确认门禁，请刷新或重新分析后再试' }],
            warnings: [],
          }
        }
        // The final button is the human confirmation action; the server still
        // validates its actual confirmation payload. No content gate is waived.
        const reasons = (Array.isArray(readiness.reasons) ? [...readiness.reasons] : []).filter((entry) => !humanConfirmation || entry?.code !== 'not-confirmed')
        const warnings = Array.isArray(readiness.warnings) ? [...readiness.warnings] : []
        if (adoptionUncertainRef.current) reasons.push({ code: 'adoption-unknown', message: '调查采纳结果未知，请重新加载会话核对后再操作。' })
        if (busy || editBusy || groupBusy || answerBusy) {
          reasons.push({ code: 'client-operation-pending', message: '当前操作尚未完成，请稍候' })
        }
        const onlyHumanConfirmation = humanConfirmation && readiness.reasons?.length > 0 && readiness.reasons.every((entry) => entry?.code === 'not-confirmed')
        return { ready: (readiness.ready === true || onlyHumanConfirmation) && reasons.length === 0, reasons, warnings }
      }
      const confirmationFormGate = () => {
        const current = sessionRef.current ?? session
        const gate = confirmationGate()
        const reasons = gate.reasons.filter((entry) => entry?.code !== 'needs-priority' && entry?.code !== 'invalid-priority' && entry?.code !== 'not-confirmed')
        if (!current?.sessionId) reasons.push({ code: 'no-session', message: '服务端会话尚未建立' })
        if (analysisPending() || editBusy) reasons.push({ code: 'form-busy', message: '分析或编辑仍在进行' })
        return { ready: reasons.length === 0, reasons, finalGate: gate }
      }
      const draftPhase = () => {
        if (analysisPending()) return { tone: 'neutral', label: '重新分析中' }
        const gate = confirmationGate()
        if (gate.ready) return { tone: 'success', label: '草稿可确认' }
        if ((sessionRef.current ?? session)?.state === 'failed') return { tone: 'error', label: '分析失败' }
        return { tone: 'warn', label: '草稿未就绪' }
      }
      const enterConfirm = async () => {
        if (history.loading || history.error || sessionRef.current?.state === 'committed' || confirmEntryRef.current || busy || editBusy || analysisPending() || !sessionRef.current?.sessionId) return
        confirmEntryRef.current = true
        setBusy(true)
        setError(null)
        try {
          // Save all local candidate fields first; readiness from the edit
          // response, not the stale projection, decides entry to the form.
          await editQueueRef.current
          const saved = await flushAllEdits()
          if (!mountedRef.current) return
          if (!saved) throw new Error('服务端未返回已保存会话，请重试。')
        } catch (caught) {
          if (mountedRef.current) { setError(errorOf(caught)); setNotice('保存并检查失败，当前填写仍保留，请重试。') }
          return
        } finally {
          confirmEntryRef.current = false
          if (mountedRef.current) setBusy(false)
        }
        const formGate = confirmationFormGate()
        const gate = formGate.finalGate
        const formReasons = formGate.reasons
        if (!formGate.ready) {
          setNotice(formReasons.map((entry) => entry.message).filter(Boolean).join('；') || '分析或编辑仍在进行，请完成后再进入最终表单。')
          requestAnimationFrame(() => blockerRef.current?.focus?.())
          return
        }
        if (!idemRef.current) idemRef.current = intentIdemKey()
        setConfirmState({ loading: false, error: null, result: null })
        setScreen('confirm')
        if (gate.reasons.some((entry) => entry?.code === 'needs-priority' || entry?.code === 'invalid-priority')) {
          requestAnimationFrame(() => priorityRef.current?.focus?.())
        }
      }
      const submitConfirm = () => {
        if (history.loading || history.error || (sessionRef.current ?? session)?.state === 'committed' || confirmState.loading) return
        const current = sessionRef.current ?? session
        if (!current?.sessionId) {
          setConfirmState({ loading: false, error: { code: 'no-session', message: '服务端还没有这份会话，无法保存；请先重新分析。' }, result: null })
          return
        }
        const gate = confirmationGate(true)
        if (!gate.ready) {
          setConfirmState({ loading: false, error: { code: 'not-ready', message: '还不能保存', reasons: gate.reasons }, result: null })
          requestAnimationFrame(() => {
            const node = screenHeadingRef.current
            if (node && typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'start', behavior: REDUCE_MOTION ? 'auto' : 'smooth' })
          })
          return
        }
        if (!idemRef.current) idemRef.current = intentIdemKey()
        const confirmHistoryToken = historyRequestRef.current
        const confirmHistoryScope = historyScope
        setConfirmState({ loading: true, error: null, result: null })
        setError(null)
        flushAllEdits()
          .then(() => {
            if (!historyCurrent(confirmHistoryToken, confirmHistoryScope)) return null
            const refreshedGate = confirmationGate(true)
            if (!refreshedGate.ready) {
              setConfirmState({ loading: false, error: { code: 'not-ready', message: '保存前门禁已更新，请核对后重试', reasons: refreshedGate.reasons }, result: null })
              return null
            }
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
              expectedSessionRevision: latest.sessionRevision ?? latest.draftRevision ?? null,
              docHash: latest.docDraft?.docHash ?? draftOf()?.docHash ?? null,
              draftRevision: latest.draftRevision ?? latest.docDraft?.draftRevision ?? draftOf()?.draftRevision ?? null,
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
            if (!historyCurrent(confirmHistoryToken, confirmHistoryScope) || !payload) return
            setReceipt({ receipt: payload.receipt ?? null, artifacts: payload.artifacts ?? [], replayed: payload.replayed === true })
            setConfirmState({ loading: false, error: null, result: payload })
            setScreen('receipt')
          })
          .catch((caught) => {
            if (!historyCurrent(confirmHistoryToken, confirmHistoryScope)) return
            const info = errorOf(caught)
            if (info.code === 'draft-changed') {
              invalidateIdem()
              const details = (info.payload && info.payload.error && info.payload.error.details) || {}
              const latestDraft = details.latest?.docDraft ?? null
              if (latestDraft) {
                const base = sessionRef.current ?? current
                draftPrevRef.current = latestDraft
                setSessionView({
                  ...base,
                  docDraft: latestDraft,
                  draftRevision: details.latest?.draftRevision ?? latestDraft.draftRevision ?? base.draftRevision ?? null,
                })
              }
              if (details.diff) setDraftDiff(details.diff)
              setDraftOpen(true)
              setDraftNotice({ count: draftChangesCount(details.diff), message: '草稿已更新，请重新确认' })
              setConfirmState({
                loading: false,
                error: { ...info, code: 'draft-changed', message: '草稿已更新，请重新确认' },
                result: null,
              })
              return
            }
            if (info.code === 'stale-input' || info.code === 'stale-context' || info.code === 'stale-session') {
              invalidateIdem()
              const token = historyRequestRef.current
              const scope = historyScope
              setConfirmState({ loading: true, error: { ...info, message: '会话已变化，正在重新读取；请核对后再次确认。' }, result: null })
              loadLatestSession(current.sessionId)
                .then((result) => {
                  const view = result?.view
                  if (!historyCurrent(token, scope) || sessionRef.current?.sessionId !== current.sessionId) return
                  if (!view || view.sessionId !== current.sessionId) throw new Error('返回的会话与当前会话不一致')
                  applySession(view)
                  if (result?.payload) trackInvestigations(result.payload)
                  setConfirmState({ loading: false, error: { ...info, message: '会话已变化并重新读取，请核对后再次确认。' }, result: null })
                })
                .catch(() => {
                  if (historyCurrent(token, scope) && sessionRef.current?.sessionId === current.sessionId) setConfirmState({ loading: false, error: { ...info, message: '会话已变化，重新读取失败；请重试或重新打开会话。' }, result: null })
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
        invalidateHistory()
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
        if (editBusy || confirmState.loading) return
        if (analysisPending()) {
          setNotice('模型仍在后台重新分析；完成后再离开以保留当前取证上下文。')
          return
        }
        if (sessionRef.current?.sessionId && (screen === 'review' || screen === 'confirm')) {
          saveAndLeave()
          return
        }
        if ((rawText.trim() || images.length || imageReadsRef.current > 0 || chatMarkdown.trim()) && !window.confirm('尚未保存的原话、聊天记录或图片将被丢弃，确定离开？')) return
        invalidateHistory()
        onClose()
      }
      const saveAndLeave = () => {
        if (editBusy || confirmState.loading) return
        if ((draftEditing || Object.keys(groupDrafts).length || answerChoice !== null || questionText.trim()) && !window.confirm('尚有未提交的草稿或回答，离开将丢弃这些内容。确定离开？')) return
        if (analysisPending()) {
          setNotice('模型仍在后台重新分析；完成后再离开。')
          return
        }
        setNotice('正在保存会话，请稍候…')
        const token = historyRequestRef.current
        const scope = historyScope
        flushAllEdits().then(() => {
          if (!historyCurrent(token, scope)) return
          invalidateHistory()
          onClose()
        }).catch((caught) => {
          if (!historyCurrent(token, scope)) return
          setError(errorOf(caught))
          setNotice('会话未保存，已保留当前编辑。请重试，不要关闭此窗口。')
        })
      }
      const postpone = () => {
        requestRef.current += 1
        saveAndLeave()
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
      const linesField = (label, values, onChange, prefix = '') =>
        h(
          'div',
          { style: { marginTop: '8px' } },
          h('div', { style: fieldLabelStyle }, label),
          h('textarea', {
            'aria-label': `${prefix}${label}`,
            name: `intent-${prefix}${label}`,
            autoComplete: 'off',
            value: intentLines(values),
            onChange: (event) => onChange(event.target.value.split('\n')),
            placeholder: '每行一条；留空表示暂无',
            style: { ...input, width: '100%', minWidth: 0, minHeight: '48px', resize: 'vertical', fontFamily: 'inherit' },
          }),
        )
      const acceptanceInput = (item, list, index, key, placeholder, prefix) =>
        h('input', {
          key,
          'aria-label': `${prefix}验收标准 ${index + 1}：${placeholder}`,
          name: `intent-${item.itemId}-acceptance-${index + 1}-${key}`,
          autoComplete: 'off',
          value: list?.[index]?.[key] ?? '',
          placeholder,
          onChange: (event) => {
            const next = (list ?? []).map((row, position) => (position === index ? { ...row, [key]: event.target.value } : row))
            setManualField(item.itemId, 'acceptance', next)
          },
          style: { ...input, width: '100%', minWidth: 0, marginTop: '4px' },
        })
      const renderAcceptance = (item, list, prefix = '') =>
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
              acceptanceInput(item, list, index, 'precondition', '前置条件', prefix),
              acceptanceInput(item, list, index, 'action', '动作', prefix),
              acceptanceInput(item, list, index, 'expected', '期望结果', prefix),
              acceptanceInput(item, list, index, 'judgement', '判定（pass / fail）', prefix),
            ),
          ),
        )
      const runIntake = (body) => {
        const token = ++intakeRequestRef.current
        setIntake({ loading: true, error: null, data: null })
        writeJson('intake', body, root)
          .then((data) => {
            if (!mountedRef.current || intakeRequestRef.current !== token) return
            setIntake({ loading: false, error: null, data })
          })
          .catch((caught) => {
            if (mountedRef.current && intakeRequestRef.current === token) setIntake({ loading: false, error: caught.message, data: null })
          })
      }
      const readImageFile = (file) =>
        new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result ?? ''))
          reader.onerror = () => reject(new Error('读取图片失败'))
          reader.readAsDataURL(file)
        })
      const uniqueImageName = (name, existing) => {
        const base = String(name || 'screenshot.png').replace(/[^A-Za-z0-9._-]/g, '_') || 'screenshot.png'
        const dot = base.lastIndexOf('.')
        const stem = dot > 0 ? base.slice(0, dot) : base
        const ext = dot > 0 ? base.slice(dot) : ''
        let candidate = base
        let index = 2
        while (existing.some((image) => image.name === candidate)) {
          candidate = `${stem}-${index}${ext}`
          index += 1
        }
        return candidate
      }
      // 粘贴/选择/拖入只把图片放进待识别托盘，不触发 OCR，也不改写原话。
      const addImages = async (files) => {
        const generation = imageGenerationRef.current
        const list = Array.from(files ?? []).filter(Boolean)
        if (list.length === 0) {
          setNotice('只支持图片文件（PNG / JPEG / WebP）。')
          return
        }
        const accepted = []
        const rejected = []
        let skippedForCapacity = 0
        imageReadEpochRef.current += 1
        imageReadsRef.current += 1
        pendingImageFilesRef.current.add(list)
        try { for (const file of list) {
          if (!['image/png', 'image/jpeg', 'image/webp'].includes(String(file.type).toLowerCase())) {
            rejected.push(`${file.name || '文件'} 格式不支持（仅 PNG / JPEG / WebP）`)
            continue
          }
          if (file.size > INTENT_IMAGE_MAX_BYTES) {
            rejected.push(`${file.name || '图片'} 超过 8MB`)
            continue
          }
          if (accepted.length >= INTENT_MAX_IMAGES) {
            skippedForCapacity += 1
            continue
          }
          try {
            const dataUrl = await readImageFile(file)
            const base64 = dataUrl.split(',')[1] ?? ''
            if (!base64) {
              rejected.push(`${file.name || '图片'} 读取失败`)
              continue
            }
            const previewObjectUrl = typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null
            accepted.push({ name: file.name || 'screenshot.png', size: Number(file.size) || 0, mimeType: String(file.type).toLowerCase(), dataUrl, base64, previewObjectUrl })
          } catch {
            rejected.push(`${file.name || '图片'} 读取失败`)
          }
        } } finally { imageReadsRef.current -= 1; pendingImageFilesRef.current.delete(list) }
        if (!mountedRef.current || generation !== imageGenerationRef.current) {
          for (const item of accepted) {
            if (item.previewObjectUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(item.previewObjectUrl)
          }
          return
        }
        const current = imagesRef.current
        const capacity = Math.max(0, INTENT_MAX_IMAGES - current.length)
        const toAdd = accepted.slice(0, capacity)
        const overflow = skippedForCapacity + accepted.length - toAdd.length
        if (toAdd.length > 0) {
          const stamp = Date.now().toString(36)
          const next = [...current]
          toAdd.forEach((item, index) => {
            next.push({
                id: `img-${stamp}-${index}-${Math.random().toString(36).slice(2, 6)}`,
                name: uniqueImageName(item.name, next),
                size: item.size,
                mimeType: item.mimeType,
                kind: 'screenshot',
                previewUrl: item.previewObjectUrl || item.dataUrl,
                previewObjectUrl: item.previewObjectUrl,
                dataBase64: item.base64,
                status: 'pending',
                data: null,
                error: null,
            })
          })
          imagesRef.current = next
          setImages(next)
        }
        for (const item of accepted.slice(toAdd.length)) {
          if (item.previewObjectUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(item.previewObjectUrl)
        }
        const problems = []
        if (overflow > 0) problems.push(`最多 ${INTENT_MAX_IMAGES} 张图片，超出的未加入。`)
        if (rejected.length > 0) problems.push(rejected.slice(0, 2).join('；'))
        setNotice(problems.length > 0 ? problems.join(' ') : null)
      }
      useEffect(() => {
        if (recoveredInput?.pendingFiles?.length) addImages(recoveredInput.pendingFiles)
      }, [])
      const removeImage = (id) => {
        const removed = imagesRef.current.find((image) => image.id === id)
        if (removed?.previewObjectUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(removed.previewObjectUrl)
        imagesRef.current = imagesRef.current.filter((image) => image.id !== id)
        setImages(imagesRef.current)
        setExpandedImageId((current) => (current === id ? null : current))
      }
      const onFile = (event) => {
        const files = Array.from(event.target.files ?? [])
        event.target.value = ''
        if (files.length > 0) addImages(files)
      }
      const onPaste = (event) => {
        const items = Array.from(event.clipboardData?.items ?? [])
        const files = items
          .filter((item) => item.kind === 'file' && String(item.type).startsWith('image/'))
          .map((item) => item.getAsFile())
          .filter(Boolean)
        if (files.length === 0) return
        event.preventDefault()
        addImages(files)
      }
      const onDragOver = (event) => {
        if (!Array.from(event.dataTransfer?.types ?? []).includes('Files')) return
        event.preventDefault()
        setDragging(true)
      }
      const onDragLeave = (event) => {
        if (event.currentTarget && event.relatedTarget && event.currentTarget.contains(event.relatedTarget)) return
        setDragging(false)
      }
      const onDrop = (event) => {
        if (Array.from(event.dataTransfer?.types ?? []).includes('Files')) event.preventDefault()
        setDragging(false)
        const files = Array.from(event.dataTransfer?.files ?? [])
        if (files.length === 0) {
          setNotice('只支持图片文件（PNG / JPEG / WebP）。')
          return
        }
        addImages(files)
      }
      const patchImage = (id, patch) => {
        setImages((current) => current.map((image) => (image.id === id ? { ...image, ...patch } : image)))
      }
      const imageLines = (image) => (Array.isArray(image?.data?.lines) ? image.data.lines : [])
      // 逐张识别，只处理还没有识别结果的图片；取消时保留已完成的结果。
      const prepareOcrImages = async (list, { signal, isCurrent, onProgress } = {}) => {
        const prepared = []
        for (let index = 0; index < list.length; index += 1) {
          const image = list[index]
          if (image.data?.schema === 'alm.ocr/v1') {
            prepared.push(image)
            continue
          }
          if (typeof onProgress === 'function') onProgress(index, list.length)
          patchImage(image.id, { status: 'recognizing', error: null })
          let data
          try {
            data = await writeJson('intake', { mode: 'ocr', filename: image.name, imageBase64: image.dataBase64 }, root, { signal })
            if (data?.schema !== 'alm.ocr/v1' || typeof data.text !== 'string' || !Array.isArray(data.lines) || data.lines.some(line => typeof line?.text !== 'string' || typeof line?.ref !== 'string') || data.text !== data.lines.map(line => line.text).join('\n')) {
              throw new Error('识别服务返回的数据不完整')
            }
          } catch (caught) {
            if (caught?.name === 'AbortError') throw caught
            patchImage(image.id, { status: 'failed', error: caught?.message ?? '识别失败' })
            const failure = new Error(`图片「${image.name}」识别失败：${caught?.message ?? '未知错误'}`)
            failure.code = caught?.code ?? 'ocr-failed'
            throw failure
          }
          if (typeof isCurrent === 'function' && !isCurrent()) return prepared
          patchImage(image.id, { status: 'recognized', data, error: null })
          prepared.push({ ...image, status: 'recognized', data })
        }
        return prepared
      }
      const imageStatusLabel = (image) => {
        if (image.status === 'recognizing') return '正在识别…'
        if (image.status === 'failed') return '识别失败，可重试'
        const lines = imageLines(image)
        if (image.data?.schema === 'alm.ocr/v1' || image.status === 'recognized') return `已识别 ${lines.length} 行`
        return '待分析时识别'
      }
      const renderImageTray = () => {
        if (images.length === 0) return null
        const expanded = images.find((image) => image.id === expandedImageId) ?? null
        return h(
          'div',
          { style: { marginTop: '2px' } },
          h(
            'div',
            { style: { display: 'flex', flexWrap: 'wrap', gap: '8px' } },
            images.map((image, index) => {
              const statusColor =
                image.status === 'failed' ? T.err : image.status === 'recognizing' ? T.brand : image.data?.schema === 'alm.ocr/v1' ? T.ok : T.text3
              const canPreview = image.data?.schema === 'alm.ocr/v1'
              return h(
                'div',
                {
                  key: image.id,
                  style: {
                    position: 'relative',
                    width: '118px',
                    border: `1px solid ${expandedImageId === image.id ? T.brand : T.line}`,
                    borderRadius: '10px',
                    background: T.base,
                    overflow: 'hidden',
                  },
                },
                h(
                  'button',
                  {
                    type: 'button',
                    title: canPreview ? '查看识别文本' : '识别会在点「分析意图」后进行',
                    'aria-label': `图片 ${index + 1} ${image.name}`,
                    onClick: () => {
                      if (!canPreview) return
                      setExpandedImageId((current) => (current === image.id ? null : image.id))
                    },
                    style: { display: 'block', width: '100%', padding: 0, border: 0, background: 'transparent', cursor: canPreview ? 'pointer' : 'default' },
                  },
                  h('img', { src: image.previewUrl, alt: image.name, width: 118, height: 62, style: { display: 'block', width: '100%', height: '62px', objectFit: 'cover' } }),
                ),
                h(
                  'div',
                  { style: { padding: '4px 22px 4px 6px' } },
                  h('div', { title: image.name, style: { fontSize: '10.5px', color: T.text2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, image.name),
                  h('div', { style: { fontSize: '10.5px', color: statusColor, whiteSpace: 'nowrap' } }, imageStatusLabel(image)),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    onClick: () => removeImage(image.id),
                    title: '移除这张图片',
                    'aria-label': `移除图片 ${image.name}`,
                    style: {
                      position: 'absolute',
                      top: '3px',
                      right: '3px',
                      width: '24px',
                      height: '24px',
                      borderRadius: '50%',
                      border: 'none',
                      background: 'rgba(4,6,9,.72)',
                      color: '#fff',
                      fontSize: '12px',
                      lineHeight: '20px',
                      cursor: 'pointer',
                      padding: 0,
                    },
                  },
                  '×',
                ),
              )
            }),
          ),
          expanded
            ? h(
                'div',
                { style: { marginTop: '8px', border: `1px solid ${T.line}`, borderRadius: '10px', background: T.base, padding: '10px 12px' } },
                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
                  h('b', { style: { fontSize: '12px', color: T.text } }, `识别文本 · ${expanded.name}`),
                  h('span', { style: muted }, `${imageLines(expanded).length} 行${expanded.data?.lowConfidence ? ` · ${expanded.data.lowConfidence} 行低置信度` : ''}`),
                  h(
                    'button',
                    { type: 'button', style: { ...button, marginLeft: 'auto', padding: '2px 8px', fontSize: '11px' }, onClick: () => setExpandedImageId(null) },
                    '收起',
                  ),
                ),
                h(
                  'pre',
                  {
                    style: {
                      margin: '8px 0 0',
                      padding: '8px',
                      maxHeight: '160px',
                      overflow: 'auto',
                      background: T.layer,
                      border: `1px solid ${T.line}`,
                      borderRadius: '8px',
                      fontSize: '11.5px',
                      whiteSpace: 'pre-wrap',
                    },
                  },
                  imageLines(expanded).map((line) => `${line.ref}  ${line.text}  (${Math.round((Number(line.confidence) || 0) * 100)}%)`).join('\n'),
                ),
                h('p', { style: { margin: '6px 0 0', ...muted } }, '这些文字只作为分析材料，不会改写上面的原话。'),
              )
            : null,
        )
      }
      const useRecognizedText = (text) => {
        if (!text) return
        setRawText((current) => (current.trim() === '' ? text : `${current.trim()}\n${text}`))
      }
      const renderSourcePanel = () => {
        if (source !== 'chat') return null
        const parsed = intake.data
        return h(
          'div',
          { style: { border: `1px solid ${T.line}`, borderRadius: '10px', padding: '12px', marginTop: '8px' } },
          h('textarea', {
            'aria-label': '聊天记录',
            name: 'intent-chat-record',
            autoComplete: 'off',
            value: chatMarkdown,
            onChange: (event) => {
              intakeRequestRef.current += 1
              setChatMarkdown(event.target.value)
              setIntake({ loading: false, error: null, data: null })
              setAttachment(null)
            },
            placeholder: '粘贴聊天记录，例如：10:12 张三：退款要幂等',
            style: { ...input, minWidth: 0, minHeight: '80px', resize: 'vertical', fontFamily: 'inherit', width: '100%' },
          }),
          h(
            'button',
            {
              type: 'button',
              style: { ...button, marginTop: '8px' },
              disabled: intake.loading || chatMarkdown.trim() === '',
              onClick: () => {
                if (chatMarkdown.trim() === '') return
                setAttachment({ name: 'chat.md', kind: 'chat', text: chatMarkdown })
                runIntake({ mode: 'chat', markdown: chatMarkdown })
              },
            },
            '解析聊天',
          ),
          intake.loading ? h('p', { role: 'status', 'aria-live': 'polite', style: { margin: '6px 0 0', ...muted } }, '正在解析聊天记录…') : null,
          intake.error ? h('p', { role: 'alert', 'aria-live': 'assertive', style: { margin: '6px 0 0', color: T.err, fontSize: '12.5px' } }, intake.error) : null,
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
                h('button', { type: 'button', style: { ...button, marginTop: '8px' }, disabled: intake.added === true || !parsed.text, onClick: () => { useRecognizedText(parsed.text); setIntake(current => ({ ...current, added: true })) } }, intake.added ? '已加入原话' : '把聊天内容加入原话'),
              )
            : null,
        )
      }
      const quietAction = {
        border: 0,
        background: 'transparent',
        color: T.text2,
        padding: '4px 6px',
        borderRadius: '7px',
        fontSize: '12.5px',
        fontFamily: 'inherit',
        cursor: 'pointer',
      }
      const refreshRequirementMatch = (value) => {
        const text = String(value ?? '').trim()
        const request = ++matchRequestRef.current
        if (text.length < 4) { setRequirementMatch(null); return }
        writeJson('convergence', { action: 'match', text }, root)
          .then((payload) => {
            if (request !== matchRequestRef.current) return
            const match = payload?.match
            if (!match || !['high', 'medium'].includes(match.confidence) || !match.matchedReqId) { setRequirementMatch(null); return }
            setRequirementMatch(match)
            setAttachMatchedFeedback(true)
          })
          .catch(() => { if (request === matchRequestRef.current) setRequirementMatch(null) })
      }
      const submitMatchedFeedback = async () => {
        const match = requirementMatch
        const feedbackText = rawText.trim()
        if (!match?.matchedReqId || !feedbackText) return runAnalyze()
        setBusy(true)
        setError(null)
        try {
          const proposed = await writeJson('convergence', { action: 'feedback', reqId: match.matchedReqId, feedbackText }, root)
          const patch = proposed?.pendingPatch
          if (!patch?.patchId || !patch?.patchHash || !patch?.baseRequirementHash) throw new Error('服务端未返回可确认的需求收敛补丁')
          const resolved = await writeJson('convergence', { action: 'resolve', reqId: match.matchedReqId, resolution: 'confirm_converge', patchId: patch.patchId, patchHash: patch.patchHash, baseRequirementHash: patch.baseRequirementHash }, root)
          const revision = resolved?.applied?.result?.revision ?? resolved?.applied?.revision ?? null
          setReceipt({ receipt: { id: `🧲 ${match.matchedReqId}${revision ? ` v${revision}` : ''}` }, artifacts: [], replayed: false })
          setNotice(`🧲 已将跨窗口反馈吸附到 ${match.matchedReqId}${revision ? `，已升级至 v${revision}` : ''}。`)
          onOpenRequirement?.(match.matchedReqId)
        } catch (caught) {
          setError(errorOf(caught))
        } finally { setBusy(false) }
      }
      const renderInput = () =>
        h(
          'div',
          { style: { marginTop: '4px' } },
          renderHistory(),
          requirementMatch
            ? h(
                'section',
                { role: 'status', 'data-testid': 'requirement-match', style: { border: `1px solid ${T.brand}`, borderRadius: '8px', background: T.layer2, padding: '10px 12px', marginBottom: '10px' } },
                h('div', { style: { fontSize: '13px', color: T.text, fontWeight: 600, lineHeight: 1.6 } }, `🧲 检测到与已有需求 [${requirementMatch.matchedReqId}: ${requirementMatch.matchedTitle}] 高度相关`),
                h('div', { style: { marginTop: '3px', fontSize: '11.5px', color: T.text2, lineHeight: 1.6 } }, requirementMatch.reason),
                h('label', { style: { display: 'flex', alignItems: 'flex-start', gap: '7px', marginTop: '8px', color: T.text2, fontSize: '12px', cursor: 'pointer' } },
                  h('input', { type: 'checkbox', checked: attachMatchedFeedback, onChange: (event) => setAttachMatchedFeedback(event.target.checked) }),
                  h('span', null, attachMatchedFeedback ? '作为该需求的迭代反馈收敛（将升级版本）' : '仍作为全新独立需求创建'),
                ),
              )
            : null,
          h(
            'div',
            {
              onDragOver,
              onDragLeave,
              onDrop,
              style: {
                border: `1px solid ${dragging || composerFocused ? T.brand : T.line}`,
                borderRadius: '8px',
                background: T.layer,
                padding: '14px 16px 10px',
                transition: 'border-color .15s ease',
              },
            },
            renderImageTray(),
            h('textarea', {
              value: rawText,
              name: 'intent-statement',
              autoComplete: 'off',
              'data-modal-initial-focus': 'true',
              'aria-label': '用你自己的话写下想改变什么',
              onFocus: () => setComposerFocused(true),
              onBlur: (event) => { setComposerFocused(false); refreshRequirementMatch(event.target.value) },
              onPaste,
              onChange: (event) => {
                const value = event.target.value
                setRawText(value)
                setRequirementMatch(null)
                setError(null)
              },
              placeholder: '例如：退款这里老是重复退，财务对账很麻烦；要保证同一笔订单只退一次，并发也不能重复扣款。',
              style: {
                minWidth: 0,
                width: '100%',
                minHeight: '132px',
                resize: 'vertical',
                fontFamily: 'inherit',
                fontSize: '14px',
                lineHeight: 1.8,
                color: T.text,
                boxSizing: 'border-box',
                border: 0,
                background: 'transparent',
                padding: '0',
              },
            }),
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: '2px', flexWrap: 'wrap', marginTop: '6px' } },
              h(
                'button',
                { type: 'button', onClick: () => fileInputRef.current?.click(), title: '选择图片', style: { ...quietAction, display: 'inline-flex', alignItems: 'center', gap: '4px', cursor: 'pointer' } },
                '＋ 图片',
              ),
              h('input', { ref: fileInputRef, type: 'file', name: 'intent-images', 'aria-label': '选择图片', accept: 'image/png,image/jpeg,image/webp', multiple: true, onChange: onFile, style: { display: 'none' } }),
              h('span', { style: { color: T.text3, fontSize: '12px' } }, '·'),
              h(
                'button',
                {
                  type: 'button',
                  'aria-pressed': source === 'chat',
                  onClick: () => setSource(source === 'chat' ? 'text' : 'chat'),
                  style: { ...quietAction, color: source === 'chat' ? T.text : T.text2 },
                },
                source === 'chat' ? '收起聊天记录' : '从聊天记录补充',
              ),
              h(
                'span',
                { style: { marginLeft: 'auto', fontSize: '11.5px', color: T.text3, textAlign: 'right' } },
                images.length > 0
                  ? `可粘贴截图或拖入图片 · 图片 ${images.length}/${INTENT_MAX_IMAGES}`
                  : '可粘贴截图、拖入图片，点「分析意图」后才识别',
              ),
            ),
          ),
          source === 'chat' ? h('div', { style: { marginTop: '10px' } }, renderSourcePanel()) : null,
          notice ? h('p', { role: 'status', 'aria-live': 'polite', style: { margin: '10px 0 0', color: T.text2, fontSize: '12px', lineHeight: 1.7 } }, notice) : null,
          error ? renderError(error) : null,
        )
      const renderAnalyzing = () => {
        const recognizing = analyzePhase?.phase === 'ocr'
        const total = analyzePhase?.total ?? images.length
        const index = total > 0 ? Math.min(analyzePhase?.index ?? 0, total - 1) : 0
        const imageRows = images.map((image) => {
          const lines = imageLines(image)
          const status =
            image.status === 'recognizing'
              ? '正在本地识别文字…'
              : image.status === 'failed'
                ? `识别失败：${image.error ?? '未知错误'}`
                : image.data?.schema === 'alm.ocr/v1' || image.status === 'recognized'
                  ? `已识别 ${lines.length} 行`
                  : '等待识别'
          const tone = image.status === 'failed' ? 'error' : image.status === 'recognizing' ? 'warn' : image.data?.schema === 'alm.ocr/v1' || image.status === 'recognized' ? 'success' : 'neutral'
          return h(
            'li',
            { key: image.id, style: { display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap', padding: '3px 0', borderBottom: `1px solid ${T.line}` } },
            h('span', { style: { fontSize: '12.5px', color: T.text } }, image.name),
            tonePill(tone, status),
          )
        })
        return h(
          'div',
          { style: { marginTop: '10px' } },
          h(
            'div',
            { style: { ...card, cursor: 'default' } },
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
              tonePill(recognizing ? 'warn' : 'neutral', recognizing ? '识别图片文字' : '分析中'),
              h('span', { style: muted }, '只显示真实阶段，不伪造进度百分比'),
            ),
            images.length > 0
              ? h(
                  'div',
                  { style: { marginTop: '10px' } },
                  h(
                    'p',
                    { style: { margin: '0 0 4px', fontSize: '12px', color: T.text2 } },
                    recognizing
                      ? `先识别图片里的文字（第 ${index + 1}/${total} 张，本地 OCR，图片不上传）；识别完再提交意图分析。`
                      : `图片文字已识别（${images.length} 张）；这些文字只作为分析材料，不会改写你的原话。`,
                  ),
                  h('ul', { style: { margin: 0, padding: 0, listStyle: 'none' } }, imageRows),
                )
              : null,
            h(
              'ol',
              { style: { margin: '10px 0 0', paddingLeft: '20px', fontSize: '12.5px', lineHeight: 2, color: T.text2 } },
              INTENT_STAGES.map((label, position) =>
                h(
                  'li',
                  {
                    key: label,
                    style: {
                      color: recognizing ? T.text3 : position === 0 && String(analyzePhase?.phase ?? '') === 'analyze' ? T.text : T.text2,
                    },
                  },
                  label,
                ),
              ),
            ),
            h('p', { style: { margin: '10px 0 0', ...muted } }, '取消后旧结果不会写入界面；已完成识别的图片在重试时不会重复识别。'),
          ),
        )
      }
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
            name: 'intent-answer',
            autoComplete: 'off',
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
                style: primaryState(answerBusy || !canSubmit),
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
                tonePill(answerFeedback.kind === 'success' || answerFeedback.kind === 'uncertain' ? 'warn' : 'error', answerFeedback.kind === 'success' ? '已记录回答' : answerFeedback.kind === 'analysis-error' ? '回答已记录' : answerFeedback.kind === 'uncertain' ? '结果未知' : '提交失败'),
                h('span', { role: 'status', style: { fontSize: '12px', color: T.text2, flex: '1 1 220px', minWidth: 0, wordBreak: 'break-word', lineHeight: 1.7 } }, answerFeedback.message),
                answerFeedback.retry
                  ? h('button', { type: 'button', style: button, disabled: answerBusy, onClick: () => submitAnswer() }, '重试')
                  : null,
                answerFeedback.kind === 'uncertain' ? renderAnswerCheck() : null,
              )
            : null,
        )
      }

      // ---- 问题组渲染（v2）----
      const renderTimingLine = () => {
        const text = groupTimingText(null)
        if (!text) return null
        return h('span', { 'data-testid': 'intent-timing', style: muted }, text)
      }
      const renderDraftSummary = () => {
        const items = activeItems()
        const first = items[0]
        if (!first) return null
        const candidate = candidateOf(first)
        const title = candidate.title || first.title || '（未命名草稿）'
        const goal = candidate.goal || first.desiredOutcome || first.userProblem || '（还没有一句话目标）'
        const readiness = confirmationGate()
        const pending = analysisPending()
        const ready = readiness.ready
        const reasons = readiness.reasons
        const phase = draftPhase()
        return h(
          'div',
          {
            'data-testid': 'intent-draft-bar',
            style: { position: 'sticky', top: 0, zIndex: 3, borderBottom: `1px solid ${T.line2}`, background: T.base, padding: '8px 0', marginBottom: '10px' },
          },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
            tonePill(phase.tone, phase.label),
            h('span', { style: { flex: '1 1 200px', minWidth: 0, fontSize: '13px', fontWeight: 600, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, title),
            h(
              'button',
              {
                type: 'button',
                style: button,
                'aria-expanded': draftBarExpanded,
                'aria-label': '展开或收起草稿摘要',
                onClick: () => toggleDraftBar(),
              },
              draftBarExpanded ? '收起草稿摘要' : '展开草稿摘要',
            ),
          ),
          h('div', { 'data-testid': 'intent-draft-goal', style: { marginTop: '2px', fontSize: '12px', color: T.text2, lineHeight: 1.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, goal),
          draftBarExpanded
            ? h(
                'div',
                { style: { marginTop: '6px', borderTop: `1px solid ${T.line}`, paddingTop: '6px' } },
                h(
                  'div',
                  { style: { fontSize: '12px', color: T.text2, lineHeight: 1.8, whiteSpace: 'pre-wrap', wordBreak: 'break-word' } },
                  [`目标：${goal}`, candidate.problem ? `问题：${candidate.problem}` : null, reasons.length ? `未就绪原因：${reasons.map((reason) => reason?.message ?? reason?.code ?? String(reason)).join('；')}` : null]
                    .filter(Boolean)
                    .join('\n'),
                ),
                h(
                  'div',
                  { style: { display: 'flex', gap: '8px', marginTop: '6px', flexWrap: 'wrap', alignItems: 'center' } },
                  h('button', { type: 'button', style: button, onClick: () => jumpToCandidate() }, '跳到候选区'),
                  renderTimingLine(),
                ),
              )
            : null,
        )
      }
      const renderGroupQuestionCard = (question, index) => {
        const questionId = question.questionId
        const answered = question.status === 'answered'
        const stale = question.status === 'stale'
        const interactionLocked = groupInteractionLocked()
        const editing = editingQuestionId === questionId
        const answer = activeAnswerOf(questionId)
        if (answered && !editing) {
          const label = answer?.optionLabel ?? (answer?.optionId ? answer.optionId : null)
          const extra = typeof answer?.text === 'string' && answer.text.trim() !== '' ? answer.text.trim() : null
          return h(
            'div',
            {
              key: questionId,
              'data-question-id': questionId,
              'data-status': 'answered',
              style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', borderBottom: `1px solid ${T.line}`, padding: '8px 0', marginBottom: '6px' },
            },
            tonePill('success', '已回答'),
            h('span', { style: { flex: '1 1 220px', minWidth: 0, fontSize: '12.5px', color: T.text, lineHeight: 1.7, wordBreak: 'break-word' } }, answer?.questionText ?? question.text),
            label ? h('span', { style: { fontSize: '12px', color: T.text2 } }, `选择：${label}`) : null,
            extra ? h('span', { style: { fontSize: '11.5px', color: T.text3, wordBreak: 'break-word' } }, `补充：${extra}`) : null,
            h(
              'button',
              { type: 'button', style: button, onClick: () => startEditingQuestion(questionId), 'aria-label': `修改第 ${index + 1} 个问题的回答` },
              '修改',
            ),
          )
        }
        const draft = groupDraftFor(question)
        const options = (Array.isArray(question.options) ? question.options : []).filter((option) => option && option.id).slice(0, 3)
        const whyExpanded = expandedWhy[questionId] === true
        const selectOption = (optionId) => {
          if (groupInteractionLocked()) return
          setGroupDraft(questionId, { optionId: draft.optionId === optionId ? null : optionId, undecided: false })
        }
        const selectUndecided = () => {
          if (groupInteractionLocked()) return
          setGroupDraft(questionId, { undecided: draft.undecided !== true, optionId: null })
        }
        return h(
          'div',
          {
            key: questionId,
            'data-question-id': questionId,
            'data-status': question.status ?? 'open',
            'data-materiality': question.materiality ?? 'blocking',
            ...(question.recommendedOptionId ? { 'data-recommended-option-id': question.recommendedOptionId } : {}),
            style: { ...card, cursor: 'default', padding: '12px 14px', marginBottom: '8px', borderColor: stale ? T.warn : T.line2 },
          },
          h(
            'div',
            { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
            tonePill(stale ? 'warn' : 'neutral', `第 ${index + 1} 个问题`),
            h('span', { style: muted }, stale ? '依据已变化，确认后重新提交' : '可以只回答其中一部分'),
          ),
          stale
            ? h(
                'div',
                {
                  'data-testid': 'intent-stale-badge',
                  role: 'status',
                  style: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', marginTop: '6px', fontSize: '12px', color: T.warn, lineHeight: 1.7 },
                },
                tonePill('warn', '待重新核对'),
                h('span', { style: { flex: '1 1 220px', minWidth: 0, wordBreak: 'break-word' } }, question.staleReason ?? '依据已变化，请重新核对'),
              )
            : null,
          h('div', { style: { marginTop: '8px', fontSize: '13.5px', color: T.text, lineHeight: 1.8, wordBreak: 'break-word' } }, question.text),
          question.impact ? h('div', { style: { marginTop: '4px', fontSize: '12px', color: T.text2, lineHeight: 1.7, wordBreak: 'break-word' } }, `影响：${question.impact}`) : null,
          question.whyNow
            ? h(
                'div',
                { style: { marginTop: '4px' } },
                h(
                  'button',
                  {
                    type: 'button',
                    style: { ...button, padding: '2px 8px' },
                    'aria-expanded': whyExpanded,
                    onClick: () => setExpandedWhy((current) => ({ ...current, [questionId]: !whyExpanded })),
                  },
                  whyExpanded ? '收起“为什么现在问”' : '为什么现在问',
                ),
                whyExpanded ? h('p', { style: { margin: '4px 0 0', fontSize: '12px', color: T.text2, lineHeight: 1.8, whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, question.whyNow) : null,
              )
            : null,
          h(
            'div',
            { role: 'group', 'aria-label': `第 ${index + 1} 个问题的选项`, style: { display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '10px' } },
            options.map((option) => {
              const active = draft.undecided !== true && draft.optionId === option.id
              const recommended = question.recommendedOptionId != null && question.recommendedOptionId === option.id
              return h(
                'button',
                {
                  key: option.id,
                  type: 'button',
                  'data-option-id': option.id,
                  ...(recommended ? { 'data-testid': `intent-recommended-option-${questionId}` } : {}),
                  'aria-pressed': active,
                  disabled: interactionLocked,
                  onClick: () => selectOption(option.id),
                  style: {
                    ...button,
                    textAlign: 'left',
                    padding: '8px 10px',
                    display: 'flex',
                    gap: '8px',
                    alignItems: 'flex-start',
                    width: '100%',
                    borderColor: active ? T.brand : T.line,
                    background: active ? T.layer2 : T.layer,
                    boxShadow: active ? `inset 0 0 0 1px ${T.brand}` : 'none',
                    cursor: groupBusy ? 'default' : 'pointer',
                    opacity: groupBusy ? 0.75 : 1,
                  },
                },
                h('span', {
                  'aria-hidden': 'true',
                  style: { width: '12px', height: '12px', borderRadius: '999px', border: `1px solid ${active ? T.brand : T.line}`, background: active ? T.brand : 'transparent', flex: '0 0 auto', marginTop: '3px' },
                }),
                h(
                  'span',
                  { style: { display: 'block', minWidth: 0, flex: '1 1 auto' } },
                  h(
                    'span',
                    { style: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', fontSize: '12.5px', color: T.text, lineHeight: 1.7, wordBreak: 'break-word' } },
                    h('span', null, option.label ?? option.id),
                    recommended ? tonePill('neutral', '推荐默认') : null,
                  ),
                  option.impact ? h('span', { style: { display: 'block', marginTop: '2px', fontSize: '11.5px', color: T.text3, lineHeight: 1.6, wordBreak: 'break-word' } }, `影响：${option.impact}`) : null,
                ),
              )
            }),
            h(
              'button',
              {
                type: 'button',
                'aria-pressed': draft.undecided === true,
                disabled: interactionLocked,
                onClick: selectUndecided,
                style: {
                  ...button,
                  textAlign: 'left',
                  padding: '8px 10px',
                  borderColor: draft.undecided === true ? T.warn : T.line,
                  background: draft.undecided === true ? T.layer2 : T.layer,
                  color: T.text2,
                  cursor: groupBusy ? 'default' : 'pointer',
                  opacity: groupBusy ? 0.75 : 1,
                },
              },
              h('span', { style: { display: 'block', fontSize: '12.5px' } }, '尚不能决定'),
              h('span', { style: { display: 'block', marginTop: '2px', fontSize: '11.5px', color: T.text3, lineHeight: 1.6 } }, '提交“尚不能决定，需要调查”，不会假装已决定。'),
            ),
          ),
          h('textarea', {
            'data-role': 'free-text',
            name: `intent-question-${questionId}`,
            autoComplete: 'off',
            value: draft.text ?? '',
            onChange: (event) => setGroupDraft(questionId, { text: event.target.value }),
            placeholder: question.allowFreeText === false ? '补充说明（可选）' : '或者直接写下你的回答',
            disabled: interactionLocked,
            'aria-label': `第 ${index + 1} 个问题的回答`,
            rows: 2,
            style: { ...input, width: '100%', minWidth: 0, boxSizing: 'border-box', marginTop: '8px', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.7 },
          }),
          editing
            ? h(
                'div',
                { style: { display: 'flex', gap: '8px', marginTop: '6px', flexWrap: 'wrap' } },
                h(
                  'button',
                  {
                    type: 'button',
                    style: button,
                    onClick: () => {
                      setEditingQuestionId(null)
                      setGroupDrafts((current) => {
                        const next = { ...current }
                        delete next[questionId]
                        return next
                      })
                    },
                  },
                  '取消修改',
                ),
              )
            : null,
        )
      }
      const renderRecommendationCard = (question, index) => {
        const questionId = question.questionId
        const recommendedOption = (question.options ?? []).find((option) => option?.id === question.recommendedOptionId) ?? null
        const draft = groupDraftFor(question)
        const persisted = question.status === 'answered'
        const interactionLocked = groupInteractionLocked()
        const adopted = Boolean(recommendedOption && draft.optionId === recommendedOption.id && draft.undecided !== true)
        return h(
          'div',
          {
            key: questionId,
            'data-testid': 'intent-recommendation-card',
            'data-question-id': questionId,
            'data-status': question.status ?? 'suggested',
            'data-materiality': question.materiality ?? 'reversible',
            ...(question.recommendedOptionId ? { 'data-recommended-option-id': question.recommendedOptionId } : {}),
            style: { ...card, cursor: 'default', padding: '12px 14px', marginBottom: '8px', borderColor: T.line2 },
          },
          h(
            'div',
            { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
            tonePill('neutral', `建议 ${index + 1}`),
            tonePill('neutral', question.materiality === 'reversible' ? '可逆建议' : '建议'),
            h('span', { style: muted }, '仅在你明确采用后才会提交'),
          ),
          h('div', { style: { marginTop: '8px', fontSize: '13.5px', color: T.text, lineHeight: 1.8, wordBreak: 'break-word' } }, question.text),
          question.impact ? h('div', { style: { marginTop: '4px', fontSize: '12px', color: T.text2, lineHeight: 1.7, wordBreak: 'break-word' } }, `影响：${question.impact}`) : null,
          recommendedOption
            ? h(
                'div',
                {
                  'data-testid': `intent-recommended-option-${questionId}`,
                  'data-option-id': recommendedOption.id,
                  style: { marginTop: '8px', border: `1px solid ${adopted ? T.brand : T.line}`, borderRadius: '9px', padding: '8px 10px', background: adopted ? T.layer2 : T.layer },
                },
                h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', fontSize: '12.5px', color: T.text } }, tonePill('neutral', '推荐默认'), h('span', null, recommendedOption.label ?? recommendedOption.id)),
                recommendedOption.impact ? h('div', { style: { marginTop: '2px', fontSize: '11.5px', color: T.text3, lineHeight: 1.6 } }, `影响：${recommendedOption.impact}`) : null,
              )
            : h('p', { style: { margin: '8px 0 0', color: T.warn, fontSize: '12px' } }, '推荐选项无效，不能采用。'),
          h(
            'div',
            { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginTop: '8px' } },
            h(
              'button',
              {
                type: 'button',
                'data-testid': `intent-adopt-recommendation-${questionId}`,
                'data-action': 'adopt-recommendation',
                style: adopted ? button : primary,
                disabled: interactionLocked || persisted || !recommendedOption,
                'aria-pressed': adopted,
                onClick: () => {
                  if (!recommendedOption || interactionLocked || persisted) return
                  setGroupDraft(questionId, { optionId: adopted ? null : recommendedOption.id, text: '', undecided: false })
                },
              },
              persisted ? '已采用并提交' : adopted ? '取消待提交采用' : '采用推荐',
            ),
            persisted
              ? h('span', { role: 'status', style: muted }, '推荐已作为明确回答保存；如需更改，请在“已确认决定”中修改对应问题。')
              : adopted
                ? h('span', { role: 'status', style: muted }, '已选择，尚未提交；请点击“提交本组回答”。')
                : null,
          ),
        )
      }
      const renderGroupFeedback = () => {
        if (!groupFeedback) {
          const timing = groupTimingText(null)
          return timing ? h('p', { style: { margin: '8px 0 0', ...muted, lineHeight: 1.7 } }, timing) : null
        }
        const saved = typeof groupFeedback.saveMs === 'number' ? `已保存 ${groupFeedback.count ?? 0} 条回答（${Math.max(0, Math.round(groupFeedback.saveMs))}ms）` : null
        const running = groupFeedback.kind === 'running' ? `正在根据回答重新分析… 已用 ${groupFeedback.elapsed ?? 0}s` : null
        const stillWorking = groupFeedback.kind === 'running' && (groupFeedback.elapsed ?? 0) > 20 ? '模型仍在处理，回答已保存' : null
        const done = groupFeedback.kind === 'done' ? ['重新分析完成', groupFeedback.timing].filter(Boolean).join('；') : null
        const problem = ['save-error', 'analysis-error', 'error', 'timeout', 'uncertain'].includes(groupFeedback.kind) ? groupFeedback.message : null
        const line = [saved, running, stillWorking, done, problem].filter(Boolean).join(' · ')
        return h(
          'div',
          {
            ref: groupFeedbackRef,
            tabIndex: -1,
            'data-testid': 'intent-group-feedback',
            style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginTop: '8px', border: `1px solid ${T.line2}`, borderRadius: '10px', padding: '8px 10px', background: T.layer },
          },
          groupFeedback.kind === 'done'
            ? tonePill('success', '完成')
            : groupFeedback.kind === 'running'
              ? tonePill('neutral', '分析中')
              : groupFeedback.kind === 'uncertain'
                ? tonePill('warn', '结果未知')
              : groupFeedback.kind === 'save-error' || groupFeedback.kind === 'error'
                ? tonePill('error', '提交失败')
                : groupFeedback.kind === 'analysis-error'
                  ? tonePill('error', '分析失败')
                  : tonePill('warn', '分析超时'),
          h('span', { role: 'status', style: { flex: '1 1 240px', minWidth: 0, fontSize: '12px', color: T.text2, lineHeight: 1.7, wordBreak: 'break-word' } }, line || '已处理。'),
          groupFeedback.retry ? h('button', { type: 'button', style: button, disabled: groupInteractionLocked() || !session?.sessionId, onClick: () => submitGroupAnswers() }, '重试提交') : null,
          groupFeedback.retryAnalysis ? h('button', { type: 'button', style: button, disabled: busy || groupInteractionLocked(), onClick: () => runAnalyze() }, '重新分析') : null,
          groupFeedback.kind === 'uncertain' ? renderAnswerCheck() : null,
        )
      }
      const renderQuestionGroup = () => {
        const group = questionGroupOf()
        if (!group) return null
        const progress = groupProgressOf(group)
        const dirtyCount = groupAnswersPayload(group).length
        const manualSession = Boolean(session?.manual) && !session?.sessionId
        const interactionLocked = groupInteractionLocked()
        return h(
          'div',
          { ref: groupPanelRef, 'data-testid': 'intent-question-group', style: { marginTop: '12px', borderTop: `1px solid ${T.line2}`, padding: '12px 0 0' } },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
            tonePill('neutral', '问题组'),
            h('span', { style: muted }, '一次可提交 1–3 个回答；提交后一起保存'),
            h('span', { 'data-testid': 'intent-progress', style: { marginLeft: 'auto', ...muted } }, groupProgressText(progress)),
          ),
          manualSession ? h('p', { style: { margin: '6px 0 0', ...muted, lineHeight: 1.7 } }, '手动会话还没有服务端会话：先“重新分析”拿到会话，再提交回答。') : null,
          group.questions.length
            ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '0', marginTop: '10px' } }, group.questions.map((question, index) => renderGroupQuestionCard(question, index)))
            : null,
          group.recommendations.length
            ? h(
                'div',
                { 'data-testid': 'intent-recommendations', style: { marginTop: '10px', borderTop: `1px solid ${T.line}`, paddingTop: '10px' } },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' } }, tonePill('neutral', '可逆建议'), h('span', { style: muted }, '推荐不会自动采用；点击采用后仍需统一提交')),
                group.recommendations.map((question, index) => renderRecommendationCard(question, index)),
              )
            : null,
          h(
            'div',
            { style: { position: 'sticky', bottom: 0, display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '10px', padding: '8px 0 2px', background: T.base } },
            h(
              'button',
              {
                type: 'button',
                'data-testid': 'intent-submit-group',
                style: primaryState(interactionLocked || dirtyCount === 0 || manualSession),
                disabled: interactionLocked || dirtyCount === 0 || manualSession,
                onClick: () => submitGroupAnswers(),
              },
              groupBusy ? `保存中…（已用 ${groupElapsed}s）` : interactionLocked ? '重新分析中…' : '提交本组回答',
            ),
            groupBusy ? h('button', { type: 'button', style: button, onClick: () => cancelGroupSubmit() }, '取消提交') : null,
            dirtyCount === 0 ? h('span', { style: muted }, '选择选项或写回答后可提交') : h('span', { style: muted }, `待提交 ${dirtyCount} 条`),
          ),
          renderGroupFeedback(),
        )
      }
      const renderConfirmedDecisions = () => {
        const answers = (session?.answers ?? []).filter((answer) => answer && !answer.supersededBy)
        if (answers.length === 0) return null
        return h(
          'div',
          { style: { marginTop: '10px', border: `1px solid ${T.line}`, borderRadius: '8px', background: T.layer } },
          h(
            'button',
            {
              type: 'button',
              'aria-expanded': decisionsOpen,
              onClick: () => setDecisionsOpen((current) => !current),
              style: { width: '100%', textAlign: 'left', ...button, border: 'none', background: 'transparent', borderRadius: '8px', padding: '10px 12px', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' },
            },
            tonePill('neutral', '已确认决定'),
            h('span', { style: { fontSize: '12.5px', color: T.text2 } }, `${answers.length} 条`),
            h('span', { style: { marginLeft: 'auto', fontSize: '12px', color: T.text3 } }, decisionsOpen ? '收起' : '展开'),
          ),
          decisionsOpen
            ? h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: '6px', padding: '0 12px 10px' } },
                answers.map((answer, index) => {
                  const questionText = typeof answer.questionText === 'string' && answer.questionText.trim() !== '' ? answer.questionText : '（旧会话未保存问题原文）'
                  const choice = answer.optionLabel ?? (answer.optionId ? answer.optionId : '自由回答')
                  const extra = typeof answer.text === 'string' && answer.text.trim() !== '' ? answer.text.trim() : null
                  return h(
                    'div',
                    { key: answer.answerId ?? `${answer.questionId ?? answer.itemId ?? 'answer'}-${index}`, style: { display: 'flex', gap: '8px', alignItems: 'flex-start', flexWrap: 'wrap', border: `1px solid ${T.line}`, borderRadius: '9px', padding: '8px 10px', background: T.base } },
                    h(
                      'div',
                      { style: { flex: '1 1 240px', minWidth: 0 } },
                      h('div', { style: { fontSize: '12.5px', color: T.text, lineHeight: 1.7, wordBreak: 'break-word' } }, questionText),
                      h('div', { style: { marginTop: '2px', fontSize: '12px', color: T.text2, lineHeight: 1.7, wordBreak: 'break-word' } }, `选择：${choice}${extra ? ` · 补充：${extra}` : ''}`),
                      h('div', { style: { marginTop: '2px', fontSize: '11px', color: T.text3 } }, answer.at ? intentTime(answer.at) : ''),
                    ),
                    answer.questionId
                      ? h('button', { type: 'button', style: button, onClick: () => startEditingQuestion(answer.questionId), 'aria-label': `修改回答：${questionText}` }, '修改')
                      : null,
                  )
                }),
              )
            : null,
        )
      }
      const renderHistoricalAnswers = () => {
        const page = answerHistoryPage?.key === answerHistoryKey ? answerHistoryPage : null
        const answers = [...(Array.isArray(session?.historicalAnswers) ? session.historicalAnswers : []), ...(page?.answers ?? [])]
        if (!answers.length) return null
        const next = page ? page.next : session.historicalAnswersNext
        const loadMore = async () => {
          if (page?.loading || !Number.isSafeInteger(next)) return
          const controller = new AbortController()
          answerHistoryAbort.current?.abort()
          answerHistoryAbort.current = controller
          const key = answerHistoryKey, prior = page?.answers ?? [], snapshot = session.historicalAnswersSnapshot
          let timeout
          setAnswerHistoryPage({ key, answers: prior, next, loading: true, error: null })
          try {
            const query = new URLSearchParams({ root: root ?? '', project: explicitProject, action: 'answer-history', session: session.sessionId, offset: String(next), snapshot })
            const data = await Promise.race([
              fetch(`/api/alm/requirements/intent?${query}`, { signal: controller.signal }).then(async response => { const body = await response.json(); if (!response.ok || body?.ok === false) throw new Error(body?.error?.message ?? '读取失败'); return body }),
              new Promise((_, reject) => { timeout = setTimeout(() => { controller.abort(); reject(new Error('读取超时')) }, 10000) }),
            ])
            if (answerHistoryKeyRef.current !== key || answerHistoryAbort.current !== controller) return
            const validAnswer = answer => answer && typeof answer === 'object' && !Array.isArray(answer) &&
              ['answerId', 'questionText', 'optionId', 'optionLabel', 'text', 'at'].every(field => answer[field] == null || typeof answer[field] === 'string') &&
              (answer.inputRevision == null || Number.isSafeInteger(answer.inputRevision)) && typeof answer.superseded === 'boolean'
            const validTotal = Number.isSafeInteger(data.total) && data.total > next
            if (data.sessionId !== session.sessionId || data.snapshot !== snapshot || data.offset !== next || !validTotal || !Array.isArray(data.answers) || data.answers.length !== Math.min(20, data.total - next) || !data.answers.every(validAnswer) || data.next !== (next + 20 < data.total ? next + 20 : null)) throw new Error('回答历史响应无效，请重新加载会话')
            setAnswerHistoryPage({ key, answers: [...prior, ...data.answers], next: data.next, loading: false, error: null })
          } catch (caught) {
            if (answerHistoryKeyRef.current === key && answerHistoryAbort.current === controller) setAnswerHistoryPage({ key, answers: prior, next, loading: false, error: caught?.message ?? '读取失败' })
          } finally { clearTimeout(timeout); if (answerHistoryAbort.current === controller) answerHistoryAbort.current = null }
        }
        return h('details', { style: { marginTop: '10px', color: T.text2, fontSize: '12px' } },
          h('summary', null, `历史回答（${answers.length} 条）`),
          h('p', null, '以下回答仅供追溯，不作为当前输入的已确认决定。'),
          h('ul', { style: { paddingLeft: '20px', lineHeight: 1.7 } }, answers.map((answer, index) => h('li', { key: answer.answerId ?? index, style: { overflowWrap: 'anywhere', marginBottom: '8px' } },
            h('div', null, answer.questionText || '问题原文未记录'),
            h('div', null, `回答：${answer.optionLabel ?? answer.optionId ?? answer.text ?? '未记录'}${answer.text && (answer.optionLabel || answer.optionId) && answer.text !== answer.optionLabel ? `；补充：${answer.text}` : ''}`),
            h('div', null, `输入版本：${Number.isInteger(answer.inputRevision) ? answer.inputRevision : '未知'}${answer.superseded ? '；已被后续回答替代' : ''}${answer.at ? `；${intentTime(answer.at)}` : ''}`),
          ))),
          page?.error ? h('p', { role: 'alert' }, `读取较早回答失败：${page.error}`) : null,
          next != null ? h('button', { type: 'button', style: button, disabled: page?.loading, onClick: loadMore }, page?.loading ? '读取中…' : '加载较早回答') : null,
          next == null && !page && session.historicalAnswersOmitted > 0 ? h('p', null, `另有 ${session.historicalAnswersOmitted} 条较早记录未显示，请重新加载会话。`) : null,
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
                    h('p', { style: { margin: '6px 0 0', fontSize: '12.5px', color: T.text2, lineHeight: 1.7 } }, '调查结果需要核对；引用在调查时校验，不是已确认决定。'),
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
                                    tonePill(ref?.verified === true ? 'success' : 'warn', ref?.verified === true ? '调查时已核对' : '引用未核对'),
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
                      h('button', { type: 'button', style: primary, disabled: busy, onClick: () => reanalyzeWithEvidence(data) }, '用此调查重新判断'),
                      h('button', { type: 'button', style: button, onClick: () => startInvestigation(investigation.question?.text ?? '') }, '再调查一次'),
                      h('button', { type: 'button', style: button, onClick: () => setInvestigation((state) => ({ ...state, open: false })) }, '收起'),
                    ),
                    h('p', { style: { margin: '6px 0 0', ...muted, lineHeight: 1.6 } }, '重新判断会使用这条调查；调查不是已确认决定。'),
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
                  entry?.inputRevision !== session?.input?.inputRevision ? tonePill('warn', Number.isSafeInteger(entry?.inputRevision) ? `历史输入版本 ${entry.inputRevision}` : '输入版本未知') : null,
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
                      Number.isSafeInteger(entry?.inputRevision) && entry.inputRevision === session?.input?.inputRevision && entry?.sessionId === session?.sessionId
                        ? h('button', { type: 'button', style: button, disabled: busy, onClick: () => reanalyzeWithEvidence(entry) }, '用此调查重新判断')
                        : null,
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
          'details',
          { style: { marginTop: '8px' } },
          h(
            'summary',
            { style: { cursor: 'pointer', fontSize: '13px', color: T.text, lineHeight: 1.7 } },
            edited ? `已选去向：${INTENT_ROUTE_LABELS[chosen] ?? chosen} · 修改` : session?.manual ? `当前去向：${INTENT_ROUTE_LABELS[chosen] ?? chosen} · 查看或修改` : `AI 建议去向：${INTENT_ROUTE_LABELS[chosen] ?? chosen} · 查看或修改`,
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
      const renderCandidate = (item, itemIndex, total) => {
        const candidate = candidateOf(item)
        const prefix = total > 1 ? `意图 ${itemIndex + 1} ` : ''
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
              'aria-label': `${prefix}标题`,
              name: `${item.itemId}-title`,
              autoComplete: 'off',
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
              'aria-label': `${prefix}问题`,
              name: `${item.itemId}-problem`,
              autoComplete: 'off',
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
              'aria-label': `${prefix}目标`,
              name: `${item.itemId}-goal`,
              autoComplete: 'off',
              value: candidate.goal,
              onChange: (event) => setManualField(item.itemId, 'goal', event.target.value),
              placeholder: '改成什么样就算对了',
              style: { ...input, width: '100%', minWidth: 0, minHeight: '56px', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.7 },
            }),
          ),
          linesField('范围内', candidate.inScope, (values) => setManualField(item.itemId, 'inScope', values), prefix),
          linesField('范围外', candidate.outOfScope, (values) => setManualField(item.itemId, 'outOfScope', values), prefix),
          renderAcceptance(item, candidate.acceptance, prefix),
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
            const unknownLabelId = `intent-unknown-${encodeURIComponent(item.itemId)}-${index}`
            const resolution = unknownChoices[key] ?? unknown.resolution ?? 'pending'
            const adoption = (session?.readiness?.investigationAdoptions ?? []).find(entry => entry.itemId === item.itemId && entry.unknownDescription === unknown.description && entry.inputRevision === session?.input?.inputRevision)
            const availableInvestigations = investigations.filter(entry => entry?.sessionId === session?.sessionId && entry?.inputRevision === session?.input?.inputRevision && entry?.verdict === 'answered' && entry?.source === 'observed_evidence')
            return h(
              'div',
              { key, style: { border: `1px solid ${T.line}`, borderRadius: '9px', padding: '8px 10px', marginTop: '6px', background: T.layer } },
              h(
                'div',
                { id: unknownLabelId, style: { fontSize: '12px', color: T.text2, lineHeight: 1.7, overflowWrap: 'anywhere' } },
                unknown.blocking ? h('span', { style: { color: T.warn, fontWeight: 500 } }, '[阻塞] ') : null,
                unknown.description,
                h('span', { style: { color: T.text3, marginLeft: '6px' } }, `当前：${INTENT_UNKNOWN_LABELS[resolution] ?? resolution}`),
              ),
              h(
                'div',
                { role: 'group', 'aria-labelledby': unknownLabelId, style: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '4px' } },
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
                      'aria-pressed': resolution === id,
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
              adoption && resolution === 'investigate' ? h('p', { role: 'status', style: { margin: '4px 0', color: adoption.referencesCurrent ? T.text2 : T.warn, fontSize: '12px', overflowWrap: 'anywhere' } }, adoption.referencesCurrent ? `已采纳调查 ${adoption.investigationId}；引用本次读取时有效。` : `已采纳调查 ${adoption.investigationId} 的引用已失效，请重新调查或采纳其他证据。`) : null,
              unknown.blocking ? h('details', { style: { marginTop: '6px' } },
                h('summary', { style: { cursor: 'pointer', color: T.text2, fontSize: '12px' } }, '采纳调查证据'),
                availableInvestigations.length === 0 ? h('p', { style: { margin: '6px 0', ...muted } }, '当前输入尚无可采纳的调查。') : null,
                availableInvestigations.map((entry, investigationIndex) => h('div', { key: intentInvestigationId(entry), style: { marginTop: '6px', color: T.text2, fontSize: '12px' } },
                  h('div', { id: `${unknownLabelId}-investigation-${investigationIndex}`, style: { overflowWrap: 'anywhere' } }, entry.question),
                  entry.summary ? h('p', { style: { margin: '4px 0' } }, entry.summary) : null,
                  (entry.findings ?? []).map((finding, findingIndex) => h('div', { key: findingIndex, style: { margin: '4px 0', overflowWrap: 'anywhere' } },
                    h('div', null, finding.claim ?? ''),
                    (finding.refs ?? []).map((ref, refIndex) => h('div', { key: refIndex, style: { marginTop: '4px' } },
                      h('span', null, intentRefLabel(ref)),
                      ref?.quote ? h('blockquote', { style: { margin: '2px 0 4px 8px', paddingLeft: '8px', borderLeft: `2px solid ${T.line2}`, whiteSpace: 'pre-wrap' } }, ref.quote) : null,
                    )),
                  )),
                  h('button', { type: 'button', style: button, disabled: busy || editBusy, 'aria-describedby': `${unknownLabelId} ${unknownLabelId}-investigation-${investigationIndex}`, onClick: () => adoptInvestigation(item, unknown, entry) }, '采纳用于此未知项'),
                )),
              ) : null,
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
          h('details', { 'data-intent-candidate': 'true', style: { marginTop: '12px' } },
            h('summary', { style: { color: T.text, fontSize: '13px', cursor: 'pointer', lineHeight: 1.7 } }, '查看和编辑需求候选'),
            renderCandidate(item, index, total)),
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
      const renderIntentDraft = () =>
        h(IntentDraftPanel, {
          draft: draftOf(),
          open: draftOpen,
          onToggle: () => setDraftOpen((value) => !value),
          editingKey: draftEditing,
          editValue: draftEditValue,
          editBusy: draftBusy,
          notice: draftNotice,
          diff: draftDiff,
          onStartEdit: startDraftEdit,
          onChangeEdit: setDraftEditValue,
          onCancelEdit: cancelDraftEdit,
          onSaveEdit: submitDraftEdit,
        })
      const confirmDochash = () => {
        const draft = draftOf()
        const hash = draft?.docHash ?? null
        const short = hash ? shortHash(String(hash).replace(/^sha256:/, '')) : ''
        return h(
          'span',
          {
            key: 'dochash',
            'data-confirm-dochash': hash ?? 'none',
            title: hash ?? '草稿哈希尚未生成；确认时由服务端校验',
            style: {
              fontSize: '11px',
              color: T.text3,
              alignSelf: 'center',
              maxWidth: '260px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontFamily: 'ui-monospace, Cascadia Code, monospace',
            },
          },
          hash ? `将保存 ${short}` : '将保存（哈希待生成）',
        )
      }
      const simpleReview = () => activeItems().length === 1 && routeOf(activeItems()[0]) === 'create' && !(activeItems()[0].unknowns ?? []).some(entry => entry.blocking && (!entry.resolution || entry.resolution === 'pending' || entry.resolution === 'investigate')) && simpleDraft
      const grillIsValue = /拷问|grill/i.test(`${simpleDraft?.title ?? ''} ${simpleDraft?.goal ?? ''}`)
      const titlePreservationRule = /(?:手动修改|自动提炼|覆盖)/.test(`${simpleDraft?.title ?? ''} ${simpleDraft?.problem ?? ''} ${simpleDraft?.goal ?? ''}`)
      const modelGrillQuestions = [
        ...(Array.isArray(session?.questionGroup?.questions) ? session.questionGroup.questions : []),
        ...(session?.nextQuestion ? [session.nextQuestion] : []),
      ].filter((question, index, all) => question?.text && all.findIndex(other => other?.questionId === question.questionId) === index)
        .filter(question => question.status !== 'answered')
        .slice(0, 3)
        .map(question => ({ id: `model-${question.questionId}`, question: question.text, options: (question.options ?? []).map(option => option.label).filter(Boolean) }))
      const grillQuestions = modelGrillQuestions.length ? modelGrillQuestions : grillIsValue ? [
        { id: 'value', question: '需求价值拷问主要帮助解决什么问题？', options: ['识别缺少业务价值的需求，避免盲目开发', '明确需求的受益人和使用场景', '减少需求不清造成的返工'] },
        { id: 'boundary', question: '需求价值信息不足时如何处理？', options: ['价值依据不足时继续追问，允许用户补充', '无法判断价值时标记待确认，不直接下结论', '允许用户跳过追问并保留未决问题'] },
        { id: 'measure', question: '如何检验需求价值拷问有效？', options: ['展示价值判断依据和待确认问题', '记录受益人、触发场景和预期收益', '用户确认价值与边界后形成验收标准'] },
      ] : titlePreservationRule ? [
        { id: 'value', question: '何时允许重新触发 AI 提炼？', options: ['永不自动覆盖', '提供手动重新提炼按钮', '仅清空标题时重新提炼'] },
        { id: 'boundary', question: '如何保护手动标题？', options: ['保留用户输入', '提示覆盖风险', '允许恢复原始标题'] },
        { id: 'measure', question: '如何验证保护生效？', options: ['编辑后保持不变', '重新打开后仍保留', '记录手动修改来源'] },
      ] : [
        { id: 'value', question: '这项改动优先解决什么问题？', options: ['减少重复操作', '避免信息遗漏', '提高完成效率'] },
        { id: 'boundary', question: '异常时应如何处理？', options: ['说明失败原因', '保留已有内容', '允许用户重试'] },
        { id: 'measure', question: '如何验证结果有效？', options: ['使用真实场景验证', '用户可查看结果', '验收后记录结论'] },
      ]
      const updateGrill = (id, value) => {
        const previous = grillAnswers[id] ?? ''
        setGrillAnswers(current => ({ ...current, [id]: value }))
        setSimpleDraft(d => {
          if (id === 'value') {
            let problem = d.problem
            if (previous && problem.includes(previous)) problem = problem.replace(previous, value).replace(/\n+$/, '')
            else if (value) problem = [problem.trim(), value].filter(Boolean).join('\n')
            return { ...d, problem }
          }
          const key = `grill-${id}`
          const index = d.acceptance.findIndex(entry => entry.grillKey === key)
          const acceptance = [...d.acceptance]
          if (index >= 0 && value) acceptance[index] = { ...acceptance[index], text: value, provenance: 'human-edit' }
          else if (index >= 0) acceptance.splice(index, 1)
          else if (value) acceptance.push({ text: value, provenance: 'human-edit', grillKey: key })
          return { ...d, acceptance }
        })
      }
      const continueGrilling = () => {
        const answers = grillQuestions
          .map(question => grillAnswers[question.id] ? { question: question.question, answer: grillAnswers[question.id] } : null)
          .filter(Boolean)
        if (!answers.length) {
          setError({ code: 'grill-answer-required', message: '请至少选择或补充一个回答后再继续追问。' })
          return
        }
        runAnalyze({ grillAnswers: answers })
      }
      const copyGrillCommand = async () => {
        const text = `/grilling\n\n请围绕以下需求继续进行多轮价值与边界拷问；达成共识后整理标题、目标、问题和验收标准，并通过 requirements crystallize 命令入库。\n\n${session?.input?.text ?? simpleDraft?.goal ?? ''}`
        try {
          await navigator.clipboard?.writeText(text)
          setNotice('已复制完整 /grilling 指令。粘贴到 DSH 主对话即可继续多轮拷问。')
        } catch {
          setNotice('无法自动复制。请在 DSH 主对话输入 /grilling 后粘贴当前需求原话。')
        }
      }
      const simpleConfirm = async () => {
        if (!priorityChoice || !simpleDraft?.title.trim() || !simpleDraft.goal.trim() || !simpleDraft.acceptance.some(entry => entry.text.trim()) || confirmState.loading || editBusy || analysisPending()) return
        const item = activeItems()[0], current = sessionRef.current
        setConfirmState({ loading: true, error: null, result: null })
        setError(null)
        try {
          const goal = simpleDraft.goal.trim()
          const ac = simpleDraft.acceptance.filter(entry => entry.text.trim()).map(entry => ({ text: entry.text.trim(), provenance: 'human-edit' }))
          const saved = await writeJson('intent', { action: 'set-doc-draft', sessionId: current.sessionId, expectedSessionRevision: current.sessionRevision, expectedDraftRevision: current.draftRevision, docDraft: { goal, problem: simpleDraft.problem.trim(), acceptance: ac, pending: (current.docDraft?.pending ?? []).filter(entry => !/^\[验收建议·AI 建议\]/.test(entry.text ?? '')) } }, root)
          if (saved.session) applySession(saved.session)
          const acceptance = ac.map(entry => ({ expected: entry.text, judgement: entry.text }))
          const edited = await sendEdit({ title: simpleDraft.title.trim(), goal, problem: simpleDraft.problem.trim(), acceptance, priority: priorityChoice, route: 'create' }, item.itemId, true)
          const latest = edited ?? sessionRef.current
          if (!latest?.sessionId) throw new Error('会话保存失败，请重试。')
          if (!idemRef.current) idemRef.current = intentIdemKey()
          const payload = await writeJson('intent', { action: 'confirm', sessionId: latest.sessionId, expectedInputRevision: latest.input?.inputRevision ?? 0, expectedSessionRevision: latest.sessionRevision, docHash: latest.docDraft?.docHash, draftRevision: latest.draftRevision ?? latest.docDraft?.draftRevision, contextSnapshotId: latest.context?.contextSnapshotId ?? null, confirmation: { contentHash: latest.confirmation?.contentHash ?? latest.contentHash ?? null, route: 'create', priority: priorityChoice, owner: ownerChoice.trim() || null, items: [{ itemId: item.itemId, route: 'create', candidate: { ...cleanCandidate(candidateOf(item)), title: simpleDraft.title.trim(), goal, problem: simpleDraft.problem.trim(), acceptance }, unknowns: item.unknowns ?? [] }] }, idempotencyKey: idemRef.current, actor: 'human:local' }, root)
          setReceipt({ receipt: payload.receipt ?? null, artifacts: payload.artifacts ?? [], replayed: payload.replayed === true })
          setConfirmState({ loading: false, error: null, result: payload })
          setScreen('receipt')
        } catch (caught) { setConfirmState({ loading: false, error: errorOf(caught), result: null }) }
      }
      const renderSimpleReview = () => {
        const field = (label, value, onChange, multiline = false) => h('label', { style: { display: 'grid', gap: '6px', color: T.text2, fontSize: '13px' } }, label, h(multiline ? 'textarea' : 'input', { value, onChange: event => onChange(event.target.value), style: { ...input, width: '100%', boxSizing: 'border-box' }, ...(multiline ? { rows: 2 } : {}) }))
        return h('div', { style: { display: 'grid', gap: '18px', marginTop: '12px' } },
          renderRequirementMatchCard(),
          error ? renderError(error) : null, confirmState.error ? renderError(confirmState.error) : null,
          h('div', { role: 'status', style: { display: 'flex', alignItems: 'center', gap: '8px', color: T.text2, fontSize: '12px' } },
            h('span', { style: { border: `1px solid ${session?.grill?.status === 'loaded' ? T.brand : T.line2}`, color: session?.grill?.status === 'loaded' ? T.brand : T.text2, borderRadius: '999px', padding: '3px 8px' } }, session?.grill?.status === 'loaded' ? '已加载 Grill Skill' : '本地澄清'),
            session?.grill?.status === 'loaded' ? `第 ${session.grill.round || 1} 轮` : '模型不可用时使用本地动态建议',
          ),
          h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: '14px', alignItems: 'end' } },
            field('需求标题', simpleDraft.title, value => setSimpleDraft(d => ({ ...d, title: value }))),
            h('fieldset', { style: { border: 0, padding: 0, margin: 0 } }, h('legend', { style: { color: T.text2, fontSize: '13px', marginBottom: '6px' } }, '优先级'), ...['P0','P1','P2'].map(value => h('button', { key: value, type: 'button', 'aria-pressed': priorityChoice === value, onClick: () => setPriorityChoice(value), style: { ...button, marginRight: '5px', borderColor: priorityChoice === value ? T.brand : T.line2, color: priorityChoice === value ? T.text : T.text2 } }, value)))),
          h('section', null, h('h3', { style: { fontSize: '15px', margin: '0 0 10px' } }, '需求价值与边界拷问'), ...grillQuestions.map(q => h('div', { key: q.id, style: { marginBottom: '12px' } }, h('div', { style: { fontSize: '13px', marginBottom: '6px' } }, q.question), h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' } }, ...q.options.map(option => h('button', { key: option, type: 'button', 'aria-pressed': grillAnswers[q.id] === option, onClick: () => updateGrill(q.id, option), style: { ...button, borderColor: grillAnswers[q.id] === option ? T.brand : T.line2 } }, option)), h('button', { type: 'button', style: button, onClick: () => setGrillCustom(current => ({ ...current, [q.id]: !current[q.id] })) }, '自定义…'), grillCustom[q.id] ? h('input', { 'aria-label': `${q.question} 自定义回答`, value: grillAnswers[q.id] ?? '', placeholder: '输入补充回答', onChange: event => updateGrill(q.id, event.target.value), style: { ...input, flex: '1 1 160px', minWidth: 0 } }) : null)))),
          session?.grill?.status === 'loaded' ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px' } }, h('button', { type: 'button', style: button, disabled: busy || analysisPending(), onClick: continueGrilling }, '继续追问'), h('button', { type: 'button', style: button, onClick: copyGrillCommand }, '转入主对话 /grilling')) : null,
          h('section', { style: { display: 'grid', gap: '10px' } }, h('h3', { style: { fontSize: '15px', margin: 0 } }, '需求草稿'), field('预期变化', simpleDraft.goal, value => setSimpleDraft(d => ({ ...d, goal: value })), true), field('解决什么问题', simpleDraft.problem, value => setSimpleDraft(d => ({ ...d, problem: value })), true),
            h('div', null, h('div', { style: { fontSize: '13px', color: T.text2, marginBottom: '6px' } }, '验收标准（建议草稿，请核对）'), ...simpleDraft.acceptance.map((entry, index) => h('div', { key: entry.id ?? index, style: { display: 'flex', gap: '6px', marginBottom: '6px' } }, h('input', { 'aria-label': `验收标准 ${index + 1}`, value: entry.text, onChange: event => setSimpleDraft(d => ({ ...d, acceptance: d.acceptance.map((v, i) => i === index ? { ...v, text: event.target.value, provenance: 'human-edit' } : v) })), style: { ...input, flex: 1, minWidth: 0 } }), h('button', { type: 'button', 'aria-label': `删除验收标准 ${index + 1}`, style: button, onClick: () => setSimpleDraft(d => ({ ...d, acceptance: d.acceptance.filter((_, i) => i !== index) })) }, '删除'))), h('button', { type: 'button', style: button, onClick: () => setSimpleDraft(d => ({ ...d, acceptance: [...d.acceptance, { text: '', provenance: 'human-edit' }] })) }, '新增验收标准'))))
      }
      const renderRequirementMatchCard = () => {
        const match = requirementMatch
        const target = match?.matchedReq
        if (!target || !['high', 'medium'].includes(match.confidence)) return null
        return h(
          'section',
          { role: 'status', 'data-testid': 'requirement-match-card', style: { border: `1px solid ${T.brand}`, borderLeft: `4px solid ${T.brand}`, borderRadius: '8px', background: T.layer2, padding: '12px 14px', marginBottom: '2px' } },
          h('div', { style: { fontSize: '12px', color: T.brand, fontWeight: 600 } }, '🧲 检测到关联需求'),
          h('div', { style: { marginTop: '3px', color: T.text, fontSize: '14px', fontWeight: 600, lineHeight: 1.6 } }, `${target.id} · v${target.revision ?? 1} · ${target.title}`),
          h('div', { style: { marginTop: '3px', color: T.text2, fontSize: '12px', lineHeight: 1.6 } }, match.reason),
          h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px' } },
            h('button', { type: 'button', style: primaryState(busy), disabled: busy, onClick: submitMatchedFeedback }, `作为 ${target.id} 的迭代反馈收敛`),
            h('button', { type: 'button', style: button, disabled: busy, onClick: () => { setAttachMatchedFeedback(false); setRequirementMatch(null) } }, '仍作为全新需求创建'),
          ),
        )
      }
      const renderReview = () => {
        if (simpleReview()) return renderSimpleReview()
        const gate = confirmationGate()
        const items = activeItems()
        const first = items[0]
        return h(
          'div',
          { style: { marginTop: '8px' } },
          renderRequirementMatchCard(),
          renderDraftSummary(),
          h('div', { role: 'status', 'data-testid': 'intent-review-notice', style: notice ? { border: `1px solid ${T.line2}`, borderRadius: '10px', padding: '8px 12px', marginBottom: '10px', color: T.text2, fontSize: '12px', lineHeight: 1.7, background: T.layer } : undefined }, notice ?? ''),
          history.error ? h('p', { role: 'alert', style: { color: T.warn } }, `重新加载失败：${history.error.message}`) : null,
          error ? renderError(error) : null,
          conflicts.length ? renderConflicts() : null,
          h(
            'p',
            { style: { margin: '8px 0 0', fontSize: '13.5px', color: T.text, lineHeight: 1.8 } },
            items.length === 0
              ? '没有可确认的意图项。'
              : items.length === 1
                ? `我的理解：${first.userProblem || first.desiredOutcome || '（见下方候选）'}`
                : `我的理解：这里其实是 ${items.length} 个意图，下面逐个确认。`,
          ),
          renderConfirmedDecisions(),
          renderHistoricalAnswers(),
          renderQuestionGroup() ?? renderQuestion(),
          tonePill(draftPhase().tone, draftPhase().label),
          renderIntentDraft(),
          h('details', { style: { marginTop: '12px', color: T.text2, fontSize: '12px' } },
            h('summary', { style: { cursor: 'pointer' } }, '分析与草案信息'),
            h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '8px' } },
              h('span', { style: muted }, '当前草案版本'), confirmDochash(),
              session?.input?.inputRevision === undefined ? null : h('span', { style: muted }, `输入版本 ${session.input.inputRevision}`),
              session?.context?.generatedAt ? h('span', { style: muted }, `上下文 ${intentTime(session.context.generatedAt)}`) : null,
              renderTimingLine(),
              h('button', { type: 'button', style: { ...button, padding: '4px 8px', fontSize: '12px' }, disabled: busy || analysisPending(), onClick: () => runAnalyze() }, analysisPending() ? '分析中…' : '重新分析'),
              session?.sessionId ? h('button', { type: 'button', style: { ...button, padding: '4px 8px', fontSize: '12px' }, disabled: busy || history.loading || !historyAllowed, onClick: () => readHistory(session.sessionId) }, history.loading ? '重新加载中…' : '重新加载会话') : null,
            ),
            renderClarificationStatus(),
          ),
          session?.manual ? tonePill('warn', '手动模式（未调用模型）') : null,
          editBusy ? h('span', { style: muted }, '正在保存你的修改…') : null,
          renderInvestigationPanel(),
          renderInvestigations(),
          h('div', { ref: candidateRef }, items.map((item, index) => renderItemSection(item, index, items.length))),
          gate.ready
            ? null
            : h(
                'div',
                { ref: blockerRef, id: 'intent-confirm-blocker', tabIndex: -1, 'data-testid': 'intent-confirm-blocker', role: 'status', style: { marginTop: '12px' } },
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
        const gate = confirmationGate(true)
        const shownError = confirmState.error ?? error
        const routes = items.map((item) => routeOf(item))
        const createNeedsPriority = routes.indexOf('create') !== -1
        return h(
          'div',
          { style: { marginTop: '8px' } },
          shownError ? renderError(shownError) : null,
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', margin: '4px 0 10px' } }, h('span', { style: muted }, '本次保存版本'), confirmDochash()),
          renderIntentDraft(),
          h(
            'section',
            { style: { ...card, cursor: 'default', marginTop: '10px' } },
            h('div', { style: blockTitleStyle }, '① 确认的问题与期望行为（最终文本可直接编辑）'),
            items.map((item, index) =>
              h(
                'div',
                { key: item.itemId, style: { marginTop: '8px' } },
                h('div', { style: fieldLabelStyle }, '问题'),
                h('textarea', {
                  'aria-label': `${items.length > 1 ? `意图 ${index + 1} ` : ''}问题`,
                  name: `intent-${item.itemId}-confirm-problem`,
                  autoComplete: 'off',
                  value: candidateOf(item).problem,
                  onChange: (event) => setManualField(item.itemId, 'problem', event.target.value),
                  style: { ...input, width: '100%', minWidth: 0, minHeight: '56px', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.7 },
                }),
                h('div', { style: { ...fieldLabelStyle, marginTop: '6px' } }, '期望行为'),
                h('textarea', {
                  'aria-label': `${items.length > 1 ? `意图 ${index + 1} ` : ''}期望行为`,
                  name: `intent-${item.itemId}-confirm-goal`,
                  autoComplete: 'off',
                  value: candidateOf(item).goal,
                  onChange: (event) => setManualField(item.itemId, 'goal', event.target.value),
                  style: { ...input, width: '100%', minWidth: 0, minHeight: '56px', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.7 },
                }),
              ),
            ),
          ),
          h(
            'details',
            { style: { marginTop: '10px' } },
            h('summary', { style: { cursor: 'pointer', color: T.text2, fontSize: '12px', padding: '8px 2px' } }, '② 范围与未证实部分（可选核对）'),
            h(
              'section',
              { style: { ...card, cursor: 'default', marginTop: '6px' } },
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
            'details',
            { open: createNeedsPriority, style: { marginTop: '10px' } },
            h('summary', { style: { cursor: 'pointer', color: T.text2, fontSize: '12px', padding: '8px 2px' } }, '④ 写入内容与权限（可选核对）'),
            h(
              'section',
              { style: { ...card, cursor: 'default', marginTop: '6px' } },
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
                h('input', { name: 'intent-owner', autoComplete: 'off', value: ownerChoice, onChange: (event) => changeOwner(event.target.value), placeholder: '未指定（沿用项目默认）', style: { ...input, width: '100%', minWidth: 0 } }),
              ),
              h(
                'label',
                { style: { display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', color: T.text2, flex: '0 1 160px', minWidth: 0 } },
                createNeedsPriority ? '优先级（新建必选，不猜）' : '优先级',
                h(
                  'select',
                  { ref: priorityRef, name: 'intent-priority', 'data-testid': 'intent-priority-select', value: priorityChoice, onChange: (event) => changePriority(event.target.value), style: { ...input, width: '100%', minWidth: 0 } },
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
                gate.reasons.some(reason => reason.code === 'investigation-evidence-incomplete')
                  ? h('p', { style: { margin: '6px 0 0', fontSize: '12px', color: T.text2, lineHeight: 1.7 } }, '返回修改，在“分析与草案信息”中重新加载会话并核对调查；如引用已变化，请重新调查或采纳其他证据。')
                  : null,
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
        const gate = confirmationGate(true)
        if (screen === 'input') {
          const analyzeDisabled = (rawText.trim() === '' && images.length === 0) || busy || history.loading || intake.loading
          return [
            h('span', { key: 'note', style: { marginRight: 'auto', fontSize: '11.5px', color: T.text3, alignSelf: 'center' } }, `${projectName ?? project ?? '—'} · 先澄清，不会创建需求。`),
            h('button', { key: 'manual', type: 'button', style: button, disabled: history.loading || intake.loading, onClick: startManual }, '手动填写候选'),
            h(
              'button',
              { key: 'analyze', type: 'button', style: primaryState(analyzeDisabled), disabled: analyzeDisabled, onClick: () => runAnalyze() },
              busy ? '分析中…' : '分析意图',
            ),
          ]
        }
        if (screen === 'analyzing') {
          return [h('button', { key: 'cancel', type: 'button', style: button, onClick: cancelAnalyze }, '取消分析')]
        }
        if (screen === 'review' && simpleReview()) return [
          h('button', { key: 'back', type: 'button', style: button, onClick: () => setScreen('input') }, '返回原话'),
          !priorityChoice ? h('span', { key: 'priority-hint', role: 'status', style: { marginRight: 'auto', alignSelf: 'center', fontSize: '12px', color: T.text2 } }, '请先在右上角选择优先级 (P0/P1/P2)') : null,
          h('button', { key: 'confirm', type: 'button', style: primaryState(!priorityChoice || confirmState.loading), disabled: !priorityChoice || confirmState.loading, onClick: simpleConfirm }, confirmState.loading ? '正在创建…' : '确认并创建需求'),
        ]
        if (screen === 'review') {
          const formGate = confirmationFormGate()
          const blockerText = formGate.reasons[0]?.message ?? null
          const confirmDisabled = busy || editBusy || analysisPending() || !sessionRef.current?.sessionId
          return [
            h('button', { key: 'later', type: 'button', style: button, onClick: postpone }, '暂不处理'),
            h('button', { key: 'back', type: 'button', style: button, onClick: () => setScreen('input') }, '返回原话'),
            h(
              'button',
              { key: 'confirm', type: 'button', 'data-testid': 'intent-enter-confirm', style: primaryState(confirmDisabled), disabled: confirmDisabled, 'aria-describedby': blockerText ? 'intent-confirm-blocker' : undefined, onClick: enterConfirm },
              busy || editBusy ? '保存并检查中…' : '保存并检查，进入最终确认',
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
              { key: 'save', type: 'button', style: primaryState(confirmState.loading || !gate.ready), disabled: confirmState.loading || !gate.ready, onClick: submitConfirm },
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
          ? null
          : screen === 'confirm'
            ? '保存的是一份待确认草案；保存不等于采纳、开工、验收或发布。'
            : screen === 'receipt'
              ? '真实写入的产物如下；关闭后会刷新列表。'
              : null
      return h(
        ModalShell,
        {
          title,
          lead,
          onClose: handleClose,
          width: '820px',
          footer: footerFor(),
          feedbackContext: { stage: 'intent', intentSessionId: session?.sessionId ?? null },
          testId: 'intent-modal',
          dataSessionId: session?.sessionId ?? 'pending',
          dataScreen: screen,
        },
        h(
          'div',
          { ref: screenHeadingRef, tabIndex: -1, 'data-intent-screen-heading': 'true' },
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
        name: `associate-${key}`,
        autoComplete: 'off',
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

    function EmptyState({ root, onCreate, onOpenPanel }) {
      return h(
        'div',
        { style: { ...card, cursor: 'default', padding: '34px 30px', textAlign: 'center' } },
        h('h3', { style: { margin: '0 0 7px', fontSize: '15px' } }, '还没有需求'),
        h(
          'p',
          { style: { margin: '0 auto 18px', maxWidth: '440px', color: T.text2, fontSize: '12.5px', lineHeight: 1.7 } },
          '工作区已读取成功，但这里还没有需求记录。你可以先写一条待评审草稿，或打开工作台查看门禁与资产。',
        ),
        h(
          'div',
          { style: { display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' } },
          onCreate ? h(ActionButton, { label: '新建需求', icon: 'plus', variant: 'primary', onClick: onCreate }) : null,
          onOpenPanel ? h(ActionButton, { label: '打开工作台', icon: 'eye', variant: 'secondary', onClick: onOpenPanel }) : null,
        ),
        root ? h('p', { style: { margin: '16px 0 0', ...muted } }, `当前根：${root}`) : null,
      )
    }

    // ------------------------------------------------------------------
    // Defect closed loop: failure monitor → defect ledger → human decision.
    // This is a separate surface on top of the delivery views: the monitor may
    // create the record, but nothing is fixed until a human confirms it, and
    // every number below comes from the ledger (missing fields stay absent).
    // ------------------------------------------------------------------

    const DEFECT_MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
    const DEFECT_TIMELINE_TONE = {
      failure: T.err,
      regression: T.err,
      failed: T.err,
      analysis: T.text2,
      created: T.text2,
      confirmed: T.brand,
      run: T.brand,
      fixing: T.brand,
      verifying: T.brand,
      verified: T.ok,
      accepted: T.ok,
      closed: T.text3,
      ignored: T.text3,
      deferred: T.warn,
    }
    const DEFECT_ITERATION_LABELS = { running: '运行中', failed: '失败', 'awaiting-acceptance': '待验收', accepted: '已接受' }
    const DEFECT_ITERATION_TONE = { running: T.brand, failed: T.err, 'awaiting-acceptance': T.warn, accepted: T.ok }

    function defectMetaRows(defect) {
      const rows = []
      if (!defect) return rows
      if (defect.impact?.severity) rows.push(['严重度', defect.impact.severity])
      if (defect.impact?.stage) rows.push(['失败阶段', DEFECT_STAGE_LABELS[defect.impact.stage] ?? String(defect.impact.stage)])
      if (defect.source?.kind) rows.push(['来源', defect.source.kind === 'failure-monitor' ? '失败监控' : String(defect.source.kind)])
      const occurrences = Number(defect.occurrenceCount ?? 0)
      if (occurrences > 0) rows.push(['出现次数', `${occurrences} 次`])
      // source.firstFailure/lastFailure hold failure IDs, not timestamps; the times
      // live on the occurrences, so derive both ends from there.
      const occurrenceStamps = (defect.occurrences ?? []).map((entry) => entry?.at).filter(Boolean).sort()
      const firstFailure = occurrenceStamps[0] ?? null
      const lastFailure = occurrenceStamps[occurrenceStamps.length - 1] ?? null
      if (firstFailure) rows.push(['首次失败', formatLocalStamp(firstFailure)])
      if (lastFailure) rows.push(['最近失败', formatLocalStamp(lastFailure)])
      if (defect.updatedAt) rows.push(['最近更新', formatLocalStamp(defect.updatedAt)])
      if (defect.regressionSuspected) rows.push(['回归', '疑似回归（关闭后再次失败）'])
      if (defect.ignore?.reason) rows.push(['忽略原因', defect.ignore.reason])
      if (defect.ignore?.expiresAt) rows.push(['忽略至', formatLocalStamp(defect.ignore.expiresAt)])
      return rows
    }

    /** The ledger separates proven facts from guesses; the UI must too. */
    function defectAnalysisGroups(defect) {
      const analysis = defect?.analysis ?? null
      const facts = []
      const hypotheses = []
      if (analysis) {
        if (analysis.what) facts.push(`现象：${analysis.what}`)
        if (analysis.actual) facts.push(`实际：${analysis.actual}`)
        if (analysis.expected) facts.push(`预期：${analysis.expected}`)
        if (Array.isArray(analysis.evidence)) for (const line of analysis.evidence) if (line) facts.push(String(line))
        if (analysis.directCause) facts.push(`直接原因：${analysis.directCause}`)
        if (analysis.rootCause) hypotheses.push(`根因假设：${analysis.rootCause}`)
        if (analysis.impact) hypotheses.push(`影响判断：${analysis.impact}`)
      }
      const missing = Array.isArray(analysis?.missing) ? analysis.missing.filter(Boolean).map(String) : []
      return { analysis, facts, hypotheses, missing }
    }

    function defectEvidenceOf(defect) {
      const occurrences = Array.isArray(defect?.occurrences) ? defect.occurrences.filter(Boolean) : []
      const latest = occurrences.find((entry) => entry?.evidence) ?? null
      const evidence = latest?.evidence ?? {}
      return {
        occurrence: latest,
        logs: Array.isArray(evidence.logs) ? evidence.logs.filter(Boolean).map(String) : [],
        artifacts: Array.isArray(evidence.artifacts) ? evidence.artifacts.filter(Boolean).map(String) : [],
        snapshot: evidence.snapshot ?? null,
      }
    }

    function defectFactList(lines, emptyText) {
      if (!lines || lines.length === 0) return h('p', { style: { margin: 0, ...DETAIL_SUB } }, emptyText)
      return h(
        'ul',
        { style: { margin: 0, paddingLeft: '16px', color: T.text2, fontSize: '12.5px', lineHeight: 1.7 } },
        lines.map((line, index) => h('li', { key: `${index}-${line.slice(0, 12)}`, style: { marginBottom: '3px', wordBreak: 'break-word' } }, line)),
      )
    }

    /** Vertical timeline: newest first, oldest kept at the bottom. */
    function DefectTimeline({ timeline }) {
      const entries = Array.isArray(timeline) ? timeline.filter((entry) => entry && (entry.summary || entry.type)) : []
      if (entries.length === 0) return h('p', { style: { margin: 0, ...DETAIL_SUB } }, '还没有时间线记录。')
      const ordered = entries.slice().reverse()
      return h(
        'ol',
        { style: { listStyle: 'none', margin: 0, padding: 0 } },
        ordered.map((entry, index) =>
          h(
            'li',
            {
              key: `${entry.at ?? 't'}-${index}`,
              style: { position: 'relative', padding: '0 0 12px 18px', borderLeft: index === ordered.length - 1 ? '1px solid transparent' : `1px solid ${T.line}` },
            },
            h('span', {
              'aria-hidden': 'true',
              style: { position: 'absolute', left: '-4px', top: '5px', width: '7px', height: '7px', borderRadius: '50%', background: DEFECT_TIMELINE_TONE[entry.type] ?? T.text3 },
            }),
            h('div', { style: { fontSize: '11px', color: T.text3 } }, formatLocalStamp(entry.at)),
            h('div', { style: { fontSize: '12.5px', color: T.text2, lineHeight: 1.65, wordBreak: 'break-word' } }, entry.summary ?? entry.type),
          ),
        ),
      )
    }

    function DefectIterations({ iterations }) {
      const entries = Array.isArray(iterations) ? iterations.filter(Boolean) : []
      if (entries.length === 0) return h('p', { style: { margin: 0, ...DETAIL_SUB } }, '还没有修复迭代。')
      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
        entries
          .slice()
          .reverse()
          .map((entry, index) =>
            h(
              'div',
              { key: entry.run ?? `iteration-${index}`, style: { border: `1px solid ${T.line}`, borderRadius: '9px', padding: '8px 10px' } },
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
                h('span', { style: { fontFamily: DEFECT_MONO, fontSize: '11.5px', color: T.text2 } }, entry.run ?? '（无 run 标识）'),
                h('span', { style: { fontSize: '11.5px', color: DEFECT_ITERATION_TONE[entry.result] ?? T.text3 } }, DEFECT_ITERATION_LABELS[entry.result] ?? entry.result ?? '状态未知'),
                h('span', { style: { marginLeft: 'auto', fontSize: '11px', color: T.text3 } }, formatLocalStamp(entry.at)),
              ),
              entry.change ? h('div', { style: { marginTop: '4px', fontSize: '12px', color: T.text2, lineHeight: 1.6, wordBreak: 'break-word' } }, entry.change) : null,
              entry.note ? h('div', { style: { marginTop: '2px', fontSize: '11.5px', color: T.text3, lineHeight: 1.6, wordBreak: 'break-word' } }, entry.note) : null,
            ),
          ),
      )
    }

    function defectSummaryCard(defect, extraRows) {
      const rows = [...defectMetaRows(defect), ...(extraRows ?? [])]
      return h(
        'section',
        { style: DETAIL_CARD },
        h('h4', { style: DETAIL_TITLE }, defect?.title ?? '（无标题）'),
        rows.length
          ? h('div', { style: { marginTop: '6px' } }, rows.map(([label, value]) => h(DetailRow, { key: label, label }, value)))
          : h('p', { style: { margin: '6px 0 0', ...DETAIL_SUB } }, '后端未返回结构化摘要。'),
      )
    }

    function DefectInbox({ root, initial, onClose, onOpen, onSettings }) {
      const [state, setState] = useState({ loading: true, error: null, defects: Array.isArray(initial) ? initial : [] })
      useEffect(() => {
        let live = true
        setState((current) => ({ ...current, loading: true, error: null }))
        writeJson('defect', { mode: 'list', status: 'awaiting-confirmation' }, root)
          .then((payload) => {
            if (!live) return
            setState({ loading: false, error: null, defects: defectListOf(payload) })
          })
          .catch((error) => {
            if (!live) return
            setState((current) => ({ loading: false, error: error.message, defects: current.defects }))
          })
        return () => {
          live = false
        }
      }, [root])

      const rows = state.defects.map((defect, index) => {
        const severity = defect?.impact?.severity ?? null
        const occurrences = Number(defect?.occurrenceCount ?? 0)
        return h(
          'div',
          { key: defect?.id ?? `defect-${index}`, style: { border: `1px solid ${T.line}`, borderRadius: '10px', padding: '10px 12px', marginTop: index === 0 ? '12px' : '8px', background: T.layer } },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
            h(DefectStatusPill, { defect }),
            h('span', { style: { fontFamily: DEFECT_MONO, fontSize: '11.5px', color: T.text2 } }, defect?.id ?? '（缺少 ID）'),
            severity ? h('span', { style: { fontSize: '11px', color: DEFECT_SEVERITY_TONE[severity] ?? T.text3 } }, `严重度 ${severity}`) : null,
            occurrences > 1 ? h('span', { style: { fontSize: '11px', color: T.text2, fontVariantNumeric: 'tabular-nums' } }, `×${occurrences}`) : null,
            defect?.regressionSuspected ? h('span', { style: { fontSize: '11px', color: T.warn } }, '疑似回归') : null,
          ),
          h('div', { style: { marginTop: '5px', fontSize: '13px', color: T.text, lineHeight: 1.5, wordBreak: 'break-word' } }, defect?.title ?? '（无标题）'),
          h(
            'div',
            { style: { marginTop: '6px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', fontSize: '11.5px', color: T.text3 } },
            h('span', null, `失败阶段：${DEFECT_STAGE_LABELS[defect?.impact?.stage] ?? defect?.impact?.stage ?? '未记录'}`),
            defect?.source?.lastFailure ? h('span', null, `最近失败：${formatLocalStamp(defect.source.lastFailure)}`) : null,
            defect?.updatedAt ? h('span', null, `更新：${formatLocalStamp(defect.updatedAt)}`) : null,
            h('span', { style: { marginLeft: 'auto', display: 'inline-flex' } }, h(ActionButton, { label: '处理', icon: 'alert', variant: 'accent', onClick: () => onOpen?.(defect) })),
          ),
        )
      })

      return h(
        ModalShell,
        {
          title: '待确认缺陷',
          lead: '失败监控把可复现的失败自动建成了缺陷需求。确认之前 AI 不改代码；暂缓或忽略也要给出理由。',
          onClose,
          width: '760px',
          footer: [
            h(ActionButton, { key: 'settings', label: '监控设置', icon: 'flask', variant: 'ghost', onClick: () => onSettings?.() }),
            h(ActionButton, { key: 'close', label: '关闭', variant: 'secondary', onClick: onClose }),
          ],
        },
        state.loading ? h('p', { style: { margin: '14px 0 0', ...DETAIL_SUB } }, '正在读取缺陷台账…') : null,
        state.error ? h('p', { style: { margin: '14px 0 0', color: T.err, fontSize: '12.5px', lineHeight: 1.7 } }, `读取缺陷台账失败：${state.error}`) : null,
        !state.loading && !state.error && rows.length === 0 ? h('p', { style: { margin: '16px 0 0', ...DETAIL_SUB } }, '没有待确认的缺陷。') : null,
        rows,
      )
    }

    function DefectModal({ defect, item, root, onClose, onDone, onConfirm, onSettings }) {
      const [current, setCurrent] = useState(defect)
      const [state, setState] = useState({ busy: null, error: null, result: null })
      const [ignoreOpen, setIgnoreOpen] = useState(false)
      const [ignoreReason, setIgnoreReason] = useState('')
      const [ignoreExpires, setIgnoreExpires] = useState('')
      const [linkOpen, setLinkOpen] = useState(false)
      const [linkInput, setLinkInput] = useState('')
      useEffect(() => {
        setCurrent(defect)
      }, [defect])

      const record = current ?? defect ?? null
      const analysisGroups = defectAnalysisGroups(record)
      const evidence = defectEvidenceOf(record)
      const awaiting = record?.status === 'awaiting-confirmation' || record?.status === 'deferred'
      const linked = Array.isArray(record?.linkedRequirements) ? record.linkedRequirements.filter(Boolean) : []

      const act = (mode, extra) => {
        if (state.busy) return
        if (!record?.id) {
          setState({ busy: null, error: '缺陷记录缺少 ID，无法提交。', result: null })
          return
        }
        setState({ busy: mode, error: null, result: null })
        writeJson('defect', { defectId: record.id, actor: 'human:local', ...extra, mode }, root)
          .then((payload) => {
            const next = defectOfResponse(payload)
            if (next) setCurrent(next)
            setState({ busy: null, error: null, result: { mode, payload } })
            onDone?.(payload)
          })
          .catch((error) => setState({ busy: null, error: error.message, result: null }))
      }

      const resultLabel = (mode) => ({ defer: '已暂缓', ignore: '已忽略', link: '已关联' })[mode] ?? '已完成'
      const linkValue = linkInput.trim().toUpperCase()
      const linkValid = /^REQ-[A-Z0-9]{2,8}-\d{3}$/.test(linkValue)

      const footer = [h(ActionButton, { key: 'close', label: '关闭', variant: 'ghost', onClick: onClose })]
      if (onSettings) footer.push(h(ActionButton, { key: 'settings', label: '监控设置', icon: 'flask', variant: 'ghost', onClick: () => onSettings() }))
      if (awaiting) {
        footer.push(
          h(ActionButton, { key: 'link', label: '关联已有需求', icon: 'link', variant: 'ghost', onClick: () => setLinkOpen((value) => !value) }),
          h(ActionButton, { key: 'ignore', label: '忽略', icon: 'close', variant: 'ghost', onClick: () => setIgnoreOpen((value) => !value) }),
          h(ActionButton, { key: 'defer', label: state.busy === 'defer' ? '暂缓中…' : '暂缓', icon: 'refresh', variant: 'secondary', disabled: Boolean(state.busy), onClick: () => act('defer', {}) }),
          h(ActionButton, { key: 'confirm', label: '确认并开始迭代', icon: 'play', variant: 'primary', disabled: Boolean(state.busy), onClick: () => onConfirm?.(record) }),
        )
      }

      return h(
        ModalShell,
        {
          title: `缺陷 ${record?.id ?? ''}`.trim(),
          lead: '来源是失败监控，不是人的需求描述：先确认事实与根因，再授权一次修复迭代。',
          onClose,
          feedbackContext: feedbackContextFor(item, { failureIds: record?.id ? [record.id] : [] }),
          width: '820px',
          footer,
        },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '14px' } },
          h(DefectStatusPill, { defect: record }),
          record?.requirement ? h('span', { style: { fontFamily: DEFECT_MONO, fontSize: '11.5px', color: T.text2 } }, `需求 ${record.requirement}`) : null,
          record?.fingerprint ? h('span', { style: { fontFamily: DEFECT_MONO, fontSize: '11px', color: T.text3 } }, `指纹 ${String(record.fingerprint).slice(0, 18)}`) : null,
        ),
        defectSummaryCard(record),
        h(
          'section',
          { style: DETAIL_CARD },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' } },
            h('h4', { style: DETAIL_TITLE }, '原因分析'),
            h('span', { style: { ...DETAIL_SUB, marginLeft: 'auto' } }, analysisGroups.analysis ? `分析状态 ${record.analysisStatus ?? 'unknown'}` : '尚未分析'),
          ),
          h(SubBlock, { title: '已证实事实', first: true }, defectFactList(analysisGroups.facts, '还没有已证实的事实。')),
          h(SubBlock, { title: '待验证假设' }, defectFactList(analysisGroups.hypotheses, '还没有提出根因假设。')),
          h(SubBlock, { title: '缺失信息' }, defectFactList(analysisGroups.missing, '没有标记缺失信息。')),
          analysisGroups.analysis?.confidence ? h('p', { style: { margin: '8px 0 0', ...DETAIL_SUB } }, `分析置信度：${analysisGroups.analysis.confidence}`) : null,
        ),
        h(
          'section',
          { style: DETAIL_CARD },
          h('h4', { style: { ...DETAIL_TITLE, marginBottom: '8px' } }, '证据'),
          h(SubBlock, { title: '日志', first: true }, defectFactList(evidence.logs, '没有日志片段。')),
          h(SubBlock, { title: '产物', first: false }, defectFactList(evidence.artifacts, '没有产物路径。')),
          h(
            'div',
            { style: { marginTop: '10px' } },
            evidence.snapshot
              ? h(
                  'div',
                  { style: { display: 'flex', gap: '14px', flexWrap: 'wrap', fontSize: '11.5px', color: T.text3 } },
                  h('span', null, `HEAD ${shortHash(evidence.snapshot.headSha, 12)}`),
                  evidence.snapshot.treeHash ? h('span', null, `tree ${shortHash(evidence.snapshot.treeHash, 12)}`) : null,
                  evidence.occurrence?.run ? h('span', null, `失败 run ${evidence.occurrence.run}`) : null,
                )
              : h('p', { style: { margin: 0, ...DETAIL_SUB } }, '没有失败时的快照。'),
          ),
        ),
        h(
          'section',
          { style: DETAIL_CARD },
          h('h4', { style: { ...DETAIL_TITLE, marginBottom: '8px' } }, '关联需求'),
          linked.length
            ? h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } }, linked.map((id) => h(MetaChip, { key: id }, id)))
            : h('p', { style: { margin: 0, ...DETAIL_SUB } }, record?.requirement ? `当前挂在 ${record.requirement} 下。` : '还没有关联需求。'),
          linkOpen
            ? h(
                'div',
                { style: { marginTop: '10px' } },
                h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
                  h('input', {
                    value: linkInput,
                    onChange: (event) => setLinkInput(event.target.value),
                    placeholder: 'REQ-PRJ-001',
                    'aria-label': '要关联的需求 ID',
                    style: { ...input, flex: '1 1 220px' },
                  }),
                  h(ActionButton, { label: state.busy === 'link' ? '关联中…' : '关联', icon: 'link', variant: 'secondary', disabled: !linkValid || Boolean(state.busy), onClick: () => act('link', { requirementId: linkValue }) }),
                ),
                linkInput && !linkValid ? h('p', { style: { margin: '6px 0 0', color: T.warn, fontSize: '11.5px' } }, '需求 ID 形如 REQ-PRJ-001。') : null,
              )
            : null,
        ),
        h('section', { style: DETAIL_CARD }, h('h4', { style: { ...DETAIL_TITLE, marginBottom: '10px' } }, '时间线'), h(DefectTimeline, { timeline: record?.timeline })),
        h('section', { style: DETAIL_CARD }, h('h4', { style: { ...DETAIL_TITLE, marginBottom: '10px' } }, '迭代记录'), h(DefectIterations, { iterations: record?.iterations })),
        ignoreOpen
          ? h(
              'section',
              { style: { ...DETAIL_CARD, borderColor: 'rgba(231,176,75,.3)' } },
              h('h4', { style: { ...DETAIL_TITLE, marginBottom: '8px' } }, '忽略这个缺陷'),
              h('textarea', {
                value: ignoreReason,
                onChange: (event) => setIgnoreReason(event.target.value),
                placeholder: '必填：为什么这次失败可以不修（例如环境噪声、同一指纹已由别的需求覆盖）。',
                'aria-label': '忽略原因',
                style: { ...input, width: '100%', minHeight: '72px', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.7 },
              }),
              h('div', { style: { marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
                h('label', { style: { fontSize: '11.5px', color: T.text3 } }, '忽略到（可选）'),
                h('input', {
                  type: 'date',
                  value: ignoreExpires,
                  onChange: (event) => setIgnoreExpires(event.target.value),
                  'aria-label': '忽略到期日期',
                  style: { ...input, minWidth: 0, width: '160px' },
                }),
                h('span', { style: { marginLeft: 'auto' } }, h(ActionButton, {
                  label: state.busy === 'ignore' ? '提交中…' : '确认忽略',
                  icon: 'close',
                  variant: 'secondary',
                  disabled: ignoreReason.trim() === '' || Boolean(state.busy),
                  onClick: () => {
                    act('ignore', {
                      reason: ignoreReason.trim(),
                      expiresAt: ignoreExpires ? `${ignoreExpires}T00:00:00.000Z` : null,
                    })
                    setIgnoreOpen(false)
                  },
                })),
              ),
            )
          : null,
        state.error ? h('p', { style: { margin: '12px 0 0', color: T.err, fontSize: '12.5px', lineHeight: 1.7 } }, `操作失败：${state.error}`) : null,
        state.result
          ? h(PlanRows, {
              rows: [
                ['结果', resultLabel(state.result.mode)],
                ['缺陷状态', defectStatusLabel(null, defectOfResponse(state.result.payload))],
                ['说明', state.result.payload?.message ?? '已写入缺陷台账'],
              ],
            })
          : null,
        awaiting ? null : h('p', { style: { margin: '12px 0 0', ...DETAIL_SUB } }, `当前状态「${defectStatusLabel(null, record)}」不接受确认操作；若需重试，先让迭代失败回到待确认。`),
      )
    }

    function ConfirmDefectModal({ defect, item, root, onClose, onDone }) {
      const record = defect ?? null
      const analysis = record?.analysis ?? null
      const fixes = Array.isArray(analysis?.fixes) ? analysis.fixes.filter(Boolean).map(String) : []
      const tests = Array.isArray(analysis?.tests) ? analysis.tests.filter(Boolean).map(String) : []
      const missing = Array.isArray(analysis?.missing) ? analysis.missing.filter(Boolean).map(String) : []
      const evidence = defectEvidenceOf(record)
      const [scope, setScope] = useState(fixes.join('\n'))
      const [state, setState] = useState({ loading: false, error: null, result: null })
      const scopeValue = scope.trim()

      const submit = () => {
        if (state.loading || !record?.id || !scopeValue) return
        setState({ loading: true, error: null, result: null })
        writeJson('defect', { mode: 'confirm', defectId: record.id, actor: 'human:local', scope: scopeValue }, root)
          .then((payload) => {
            // The receipt (scheduled=false + reason is a real outcome) must stay
            // on screen: never close the dialog as if the run had started.
            setState({ loading: false, error: null, result: payload })
          })
          .catch((error) => setState({ loading: false, error: error.message, result: null }))
      }

      const finish = () => {
        if (state.loading) return
        if (state.result) onDone?.(state.result)
        onClose?.()
      }

      // The confirm call is the only thing allowed to start work, so the
      // receipt decides what we claim: scheduled=true is a run, false is a
      // reason, and a missing receipt is never reported as success.
      const execution = state.result ? defectExecutionOf(state.result) : null
      let executionText = null
      if (state.result) {
        if (execution?.scheduled === true) {
          const runRef = execution.run ?? execution.runId ?? execution.id ?? null
          executionText = `AI 已接手本轮修复${runRef ? `（${runRef}）` : ''}`
        } else if (execution?.scheduled === false) {
          executionText = execution.reason ?? execution.message ?? state.result.message ?? '宿主未启动迭代（未返回原因）'
        } else {
          executionText = '已确认；执行回执未返回，请刷新查看迭代记录'
        }
      }

      return h(
        ModalShell,
        {
          title: `确认缺陷 ${record?.id ?? ''}`.trim(),
          lead: '确认等于授权 AI 按下面的范围改一次代码，并自动跑验收。范围越具体，返工越少。',
          onClose: finish,
          width: '780px',
          footer: [
            h(ActionButton, { key: 'cancel', label: state.result ? '关闭' : '取消', variant: state.result ? 'primary' : 'ghost', onClick: finish }),
            state.result
              ? null
              : h(ActionButton, {
                  key: 'confirm',
                  label: state.loading ? '确认中…' : '确认并开始迭代',
                  icon: 'play',
                  variant: 'primary',
                  disabled: state.loading || !scopeValue,
                  onClick: submit,
                }),
          ],
        },
        h(PlanRows, {
          rows: [
            ['缺陷', record?.title ?? '（无标题）'],
            ['失败阶段', DEFECT_STAGE_LABELS[record?.impact?.stage] ?? record?.impact?.stage ?? '未记录'],
            ['出现次数', String(record?.occurrenceCount ?? 0)],
            ['证据', evidence.logs.length || evidence.artifacts.length ? `${evidence.logs.length} 条日志 · ${evidence.artifacts.length} 个产物` : '后端未返回证据'],
            ['失败快照', evidence.snapshot ? shortHash(evidence.snapshot.headSha, 12) : '未记录'],
          ],
        }),
        h('div', { style: { marginTop: '16px' } },
          h('div', { style: { fontSize: '11px', letterSpacing: '.06em', textTransform: 'uppercase', color: T.text3, marginBottom: '6px' } }, '修复范围（可编辑）'),
          h('textarea', {
            value: scope,
            onChange: (event) => setScope(event.target.value),
            placeholder: '写清允许改哪些文件/模块、不许动什么，以及修完要满足的条件。',
            'aria-label': '修复范围',
            style: { ...input, width: '100%', minHeight: '110px', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.7 },
          }),
        ),
        h('div', { style: { marginTop: '14px' } },
          h('div', { style: { fontSize: '11px', letterSpacing: '.06em', textTransform: 'uppercase', color: T.text3, marginBottom: '6px' } }, '验收标准'),
          defectFactList(tests, '分析未给出验收标准：请在修复范围里写清怎么算修好。'),
        ),
        missing.length
          ? h('p', { style: { margin: '12px 0 0', color: T.warn, fontSize: '12px', lineHeight: 1.7 } }, `注意：分析仍缺 ${missing.length} 项信息，AI 可能需要回来问你。`)
          : null,
        state.error ? h('p', { style: { margin: '12px 0 0', color: T.err, fontSize: '12.5px', lineHeight: 1.7 } }, `确认失败：${state.error}`) : null,
        state.result
          ? h(PlanRows, {
              rows: [
                ['结果', state.result.message ?? '已确认'],
                ['缺陷状态', defectStatusLabel(null, defectOfResponse(state.result))],
                ['迭代', executionText],
              ],
            })
          : null,
      )
    }

    // ---- Feedback: capture → save → generate, plus the inbox and settings ----
    function FeedbackContextSummary({ context, keep, onToggle }) {
      const values = {
        requirement: context?.requirementId ?? null,
        run: context?.runId ?? null,
        intent: context?.intentSessionId ?? null,
        error: context?.recentError ?? null,
      }
      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
        h('div', { style: { fontSize: 12, color: T.text2 } }, '随反馈一起发送的上下文（可取消勾选）'),
        context?.overlay?.label
          ? h(
              'div',
              { 'data-feedback-overlay': 'true', style: { fontSize: 12, color: T.text2, border: `1px solid ${T.line}`, borderRadius: 7, padding: '5px 8px', background: T.layer } },
              `当时所在层：${context.overlay.kind === 'drawer' ? '详情抽屉' : context.overlay.kind === 'modal' ? '弹窗' : '弹层'}${context.overlay.tab === 'delivery' ? '（交付页签）' : context.overlay.tab === 'record' ? '（记录页签）' : context.overlay.tab === 'requirement' ? '（需求页签）' : ''} · ${context.overlay.label}`,
            )
          : null,
        FEEDBACK_KEEP_LABELS.map(([id, label]) => {
          const value = values[id]
          const checked = value ? keep?.[id] !== false : false
          return h(
            'label',
            {
              key: id,
              'data-feedback-keep-row': id,
              style: { display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, color: value ? T.text : T.text3 },
            },
            h('input', {
              type: 'checkbox',
              'data-feedback-keep': id,
              checked,
              disabled: !value,
              onChange: () => onToggle(id),
              style: { marginTop: 2 },
            }),
            h(
              'span',
              { style: { display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 } },
              h('span', null, label),
              h('span', { style: { color: T.text3, fontSize: 11, wordBreak: 'break-all' } }, value ? String(value) : '未记录'),
            ),
          )
        }),
      )
    }

    const FEEDBACK_INBOX_FILTERS = [
      ['all', '全部'],
      ['open', '待处理'],
      ['deferred', '已暂缓'],
      ['declined', '不采纳'],
      ['duplicate', '重复'],
      ['resolved', '已验证'],
    ]

    function feedbackInboxFilterQuery(filter) {
      if (filter === 'all') return ''
      if (filter === 'open') return 'disposition=open'
      if (filter === 'resolved') return 'resolution=resolved'
      return `disposition=${filter}`
    }

    function FeedbackInboxBadge({ label, tone = 'neutral' }) {
      const color = tone === 'ok' ? T.ok : tone === 'warn' ? T.warn : tone === 'err' ? T.err : T.text2
      return h(
        'span',
        { style: { fontSize: 10.5, color, border: `1px solid ${T.line2}`, borderRadius: 999, padding: '1px 7px', whiteSpace: 'nowrap' } },
        label,
      )
    }

    const FEEDBACK_DISPOSITION_LABELS = { open: '待处理', linked: '已关联需求', deferred: '已暂缓', declined: '不采纳', duplicate: '重复反馈' }
    const FEEDBACK_RESOLUTION_LABELS = { pending: '未验证', resolved: '已验证解决', reopened: '已重开' }
    const FEEDBACK_PROCESSING_LABELS = { queued: '待整理', analyzing: '整理中', 'draft-ready': '候选已生成', failed: '整理失败', skipped: '已跳过' }
    const FEEDBACK_PROPOSAL_LABELS = { 'awaiting-confirmation': '待确认', confirmed: '已确认', converted: '已转需求', failed: '整理失败' }

    function FeedbackInboxRow({ item, root, onOpenRequirement, onChanged }) {
      const [open, setOpen] = useState(false)
      const [detail, setDetail] = useState({ loading: false, record: null, error: null })
      const [busy, setBusy] = useState('')
      const [actionError, setActionError] = useState(null)
      const [actionNote, setActionNote] = useState(null)
      const [linkId, setLinkId] = useState('')
      const [supplementText, setSupplementText] = useState('')
      const [supplementOpen, setSupplementOpen] = useState(false)
      const requirementId = feedbackRequirementId(item.requirement)
      const disposition = item.disposition ?? 'open'
      const resolution = item.resolution ?? 'pending'
      const processing = item.processing ?? null
      const [proposal, setProposal] = useState({ loading: false, data: null, error: null })
      const [refState, setRefState] = useState({ loading: false, data: null, error: null })
      const [convertOpen, setConvertOpen] = useState(false)
      // Priority is a deliberate choice at conversion time; guessing one (P2)
      // would decide on the user's behalf which urgency the problem gets.
      const [convertPriority, setConvertPriority] = useState('')

      const loadRequirementRef = () => {
        if (!requirementId) return
        setRefState({ loading: true, data: null, error: null })
        feedbackGet('requirement-ref', root, `id=${encodeURIComponent(item.id)}`)
          .then((payload) => setRefState({ loading: false, data: payload ?? null, error: null }))
          .catch((error) => setRefState({ loading: false, data: null, error }))
      }

      const openLinkedRequirement = async () => {
        if (!requirementId) return
        let ref = refState.data?.requirement ?? null
        if (!ref) {
          try {
            const payload = await feedbackGet('requirement-ref', root, `id=${encodeURIComponent(item.id)}`)
            setRefState({ loading: false, data: payload ?? null, error: null })
            ref = payload?.requirement ?? null
          } catch (error) {
            setRefState({ loading: false, data: null, error })
          }
        }
        onOpenRequirement(requirementId, ref)
      }

      // Converting is the one action that creates an executable requirement.
      // Priority is asked here, at the confirmation stage, never while writing.
      const convertToRequirement = async () => {
        if (!convertPriority) {
          setActionError({ code: 'priority-required', message: '请先选择优先级 P0/P1/P2（不猜优先级）。' })
          return
        }
        setBusy('generate')
        setActionError(null)
        setActionNote(null)
        try {
          const payload = await feedbackPost('generate', { id: item.id, priority: convertPriority }, root)
          const requirement = payload?.requirement?.id ?? ''
          const destinationName = payload?.destination?.name ?? ''
          setActionNote(
            payload?.deduplicated
              ? `同一问题已有需求，已关联到 ${requirement}`
              : `已生成需求 ${requirement}${destinationName ? `（${destinationName}）` : ''}`,
          )
          setConvertOpen(false)
          loadRequirementRef()
          onChanged?.()
        } catch (error) {
          const code = error?.code ?? ''
          const message =
            code === 'proposal-unconfirmed'
              ? '这条反馈的候选还没确认，先点「确认候选」再转需求。'
              : code === 'destination-not-configured'
                ? '还没有配置接收工作区：在反馈设置里选择目标工作区后再转需求。'
                : code === 'feedback-link-failed'
                  ? `需求已创建但反馈没关联上，可以重试。${error?.message ? `（${error.message}）` : ''}`
                  : `转需求失败：${error?.message ?? '未知错误'}`
          setActionError({ message })
        } finally {
          setBusy('')
        }
      }

      const loadProposal = () => {
        if (!item.proposalId && !processing?.proposalId) return
        setProposal((prev) => ({ ...prev, loading: true, error: null }))
        feedbackGet('proposal', root, `feedbackId=${encodeURIComponent(item.id)}`)
          .then((payload) => setProposal({ loading: false, data: payload?.proposal ?? null, error: null }))
          .catch((error) => setProposal({ loading: false, data: null, error }))
      }

      useEffect(() => {
        loadProposal()
      }, [item.id, item.proposalId])

      const organise = async () => {
        setBusy('process')
        setActionError(null)
        try {
          await feedbackPost('process', { id: item.id }, root)
          setActionNote('已整理出候选，确认后可转需求')
          loadProposal()
          onChanged()
        } catch (error) {
          setActionError(error)
        } finally {
          setBusy('')
        }
      }

      const confirmProposal = async () => {
        setBusy('proposal-confirm')
        setActionError(null)
        try {
          await feedbackPost('proposal-confirm', { id: item.id }, root)
          setActionNote('候选已确认，可以转需求')
          loadProposal()
          onChanged()
        } catch (error) {
          setActionError(error)
        } finally {
          setBusy('')
        }
      }

      const downloadAttachment = async (attachment) => {
        if (!attachment?.sha256) return
        try {
          const payload = await feedbackGet('attachment', root, `sha256=${encodeURIComponent(attachment.sha256)}`)
          const blob = `${payload.attachment.type};base64,${payload.attachment.dataBase64}`
          const link = document.createElement('a')
          link.href = `data:${blob}`
          link.download = attachment.name ?? attachment.sha256
          document.body.appendChild(link)
          link.click()
          link.remove()
        } catch (error) {
          setActionError(error)
        }
      }

      const loadDetail = () => {
        if (detail.record || detail.loading) return
        setDetail({ loading: true, record: null, error: null })
        feedbackGet('record', root, `id=${encodeURIComponent(item.id)}`)
          .then((payload) => setDetail({ loading: false, record: payload?.feedback ?? payload?.record ?? null, error: null }))
          .catch((error) => setDetail({ loading: false, record: null, error }))
      }

      const toggle = () => {
        const next = !open
        setOpen(next)
        if (next) loadDetail()
      }

      const run = async (action, body, note) => {
        setBusy(action)
        setActionError(null)
        setActionNote(null)
        try {
          const payload = await feedbackPost(action, { id: item.id, ...body }, root)
          setDetail((prev) => ({ ...prev, record: payload?.feedback ?? prev.record }))
          setActionNote(note)
          setSupplementText('')
          setLinkId('')
          onChanged()
        } catch (error) {
          setActionError(error)
        } finally {
          setBusy('')
        }
      }

      const submitSupplement = () => {
        const text = supplementText.trim()
        if (!text) {
          setActionError({ message: '补充内容不能为空' })
          return
        }
        const supplementId = `fb-ui-sup-${item.id}-${Date.now().toString(36)}`
        run('supplement', { statement: text, supplementId }, '补充已保存').then(() => setSupplementOpen(false))
      }

      const buttonStyle = (tone = 'neutral') => ({
        ...button,
        padding: '3px 9px',
        fontSize: 11.5,
        ...(tone === 'brand' ? { color: T.brand, border: '1px solid rgba(77,107,254,.35)', background: 'rgba(77,107,254,.12)' } : {}),
        ...(tone === 'err' ? { color: T.err } : {}),
      })

      const record = detail.record
      const supplements = Array.isArray(record?.supplements) ? record.supplements : []

      return h(
        'div',
        {
          'data-feedback-row': item.id,
          'data-feedback-disposition': disposition,
          style: {
            border: `1px solid ${T.line}`,
            borderRadius: 9,
            padding: '9px 11px',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            background: T.layer,
          },
        },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
          feedbackStatusBadge(item.status),
          h('span', { 'data-feedback-id': item.id, style: { fontSize: 11, color: T.text3, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' } }, item.id),
          h('span', { style: { fontSize: 11.5, color: T.text2 } }, feedbackCategoryLabel(item.category)),
          h('span', { style: { fontSize: 11, color: T.text3 } }, formatLocalStamp(item.createdAt)),
          h(FeedbackInboxBadge, { label: FEEDBACK_DISPOSITION_LABELS[disposition] ?? disposition, tone: disposition === 'open' ? 'neutral' : disposition === 'declined' ? 'err' : 'warn' }),
          h(FeedbackInboxBadge, { label: FEEDBACK_RESOLUTION_LABELS[resolution] ?? resolution, tone: resolution === 'resolved' ? 'ok' : resolution === 'reopened' ? 'err' : 'neutral' }),
          processing?.state
            ? h(FeedbackInboxBadge, {
              label: FEEDBACK_PROCESSING_LABELS[processing.state] ?? processing.state,
              tone: processing.state === 'draft-ready' ? 'ok' : processing.state === 'failed' ? 'err' : processing.state === 'analyzing' ? 'warn' : 'neutral',
            })
            : null,
          proposal.data?.status
            ? h(FeedbackInboxBadge, {
              label: `候选${FEEDBACK_PROPOSAL_LABELS[proposal.data.status] ?? proposal.data.status}`,
              tone: proposal.data.status === 'awaiting-confirmation' ? 'warn' : proposal.data.status === 'converted' ? 'ok' : 'neutral',
            })
            : null,
          item.supplementCount > 0 ? h('span', { style: { fontSize: 11, color: T.text3 } }, `补充 ${item.supplementCount} 条`) : null,
        ),
        h('div', { style: { fontSize: 12, color: T.text, lineHeight: 1.6, wordBreak: 'break-word' } }, item.statementExcerpt ?? '（无摘要）'),
        requirementId
          ? h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: 5 } },
              h(
                'div',
                { style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' } },
                h(
                  'button',
                  {
                    type: 'button',
                    'data-feedback-requirement': requirementId,
                    onClick: openLinkedRequirement,
                    style: { ...button, alignSelf: 'flex-start', padding: '3px 9px', fontSize: 11.5, color: T.brand, background: 'rgba(77,107,254,.12)', border: '1px solid rgba(77,107,254,.35)' },
                  },
                  `${requirementId}（v${item.requirement?.revision ?? 1}）`,
                ),
                h(
                  'button',
                  { type: 'button', 'data-feedback-requirement-ref': item.id, disabled: refState.loading, onClick: loadRequirementRef, style: { ...button, padding: '3px 9px', fontSize: 11.5 } },
                  refState.loading ? '读取中…' : '查看推进情况',
                ),
              ),
              refState.data?.requirement
                ? h(
                    'div',
                    {
                      'data-feedback-requirement-status': refState.data.requirement.id,
                      style: { fontSize: 11.5, color: T.text2, lineHeight: 1.7, background: T.layer2, border: `1px solid ${T.line}`, borderRadius: 7, padding: '6px 9px' },
                    },
                    h(
                      'div',
                      { style: { color: T.text } },
                      `需求状态：${refState.data.requirement.status ?? '未知'} · 决策：${refState.data.requirement.decision?.label ?? '未检查'} · 验收：${refState.data.requirement.acceptance?.latest?.result ?? '未登记'}`,
                    ),
                    h('div', { style: { color: T.text3 } }, refState.data.resolutionHint ?? '生成需求不等于原问题解决，需要人工验证后再标记。'),
                  )
                : null,
              refState.data && !refState.data.found
                ? h('div', { style: { fontSize: 11, color: T.warn } }, `已关联 ${requirementId}，但在目标工作区没有读到它（可能已被移动或删除）。`)
                : null,
              refState.error
                ? h('div', { style: { fontSize: 11, color: T.err } }, `读取推进情况失败：${refState.error.message ?? '未知错误'}`)
                : null,
            )
          : null,
        item.failureCode ? h('div', { style: { fontSize: 11, color: T.err } }, `失败原因：${item.failureCode}`) : null,
        h(
          'div',
          { style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' } },
          h('button', { type: 'button', 'data-feedback-expand': item.id, 'aria-expanded': open ? 'true' : 'false', onClick: toggle, style: buttonStyle() }, open ? '收起' : '详情'),
          h('button', { type: 'button', 'data-feedback-organise': item.id, disabled: busy !== '', onClick: organise, style: buttonStyle('brand') }, busy === 'process' ? '整理中…' : '整理'),
          proposal.data?.status === 'awaiting-confirmation'
            ? h('button', { type: 'button', 'data-feedback-confirm-proposal': item.id, disabled: busy !== '', onClick: confirmProposal, style: buttonStyle('brand') }, busy === 'proposal-confirm' ? '确认中…' : '确认候选')
            : null,
          requirementId
            ? null
            : convertOpen
              ? h('button', { type: 'button', 'data-feedback-convert-cancel': item.id, disabled: busy !== '', onClick: () => setConvertOpen(false), style: buttonStyle() }, '取消转需求')
              : h('button', { type: 'button', 'data-feedback-convert': item.id, disabled: busy !== '', onClick: () => setConvertOpen(true), style: buttonStyle('brand') }, '转需求'),
          disposition === 'open'
            ? h('button', { type: 'button', 'data-feedback-defer': item.id, disabled: busy !== '', onClick: () => run('disposition', { disposition: 'deferred', reason: '暂缓处理' }, '已暂缓'), style: buttonStyle() }, '暂缓')
            : h('button', { type: 'button', 'data-feedback-reopen-disposition': item.id, disabled: busy !== '', onClick: () => run('disposition', { disposition: 'open', reason: '重新处理' }, '已恢复待处理'), style: buttonStyle() }, '恢复待处理'),
          h('button', { type: 'button', 'data-feedback-decline': item.id, disabled: busy !== '', onClick: () => run('disposition', { disposition: 'declined', reason: '不采纳' }, '已不采纳'), style: buttonStyle('err') }, '不采纳'),
          h('button', { type: 'button', 'data-feedback-duplicate': item.id, disabled: busy !== '', onClick: () => run('disposition', { disposition: 'duplicate', reason: '与已有反馈重复' }, '已标记重复'), style: buttonStyle() }, '标记重复'),
          h('button', { type: 'button', 'data-feedback-supplement-toggle': item.id, onClick: () => setSupplementOpen((value) => !value), style: buttonStyle() }, supplementOpen ? '收起补充' : '补充'),
          resolution === 'resolved'
            ? h('button', { type: 'button', 'data-feedback-reopen-resolution': item.id, disabled: busy !== '', onClick: () => run('reopen', { note: '问题再次出现' }, '已重开，问题将重新跟进'), style: buttonStyle('err') }, '重开')
            : h('button', { type: 'button', 'data-feedback-resolve': item.id, disabled: busy !== '' || !requirementId, title: requirementId ? '验证原问题已解决' : '先把反馈关联到需求，再验证解决', onClick: () => run('resolve', { note: '已验证原问题解决' }, '已标记解决'), style: buttonStyle('brand') }, '验证解决'),
        ),
        convertOpen
          ? h(
              'div',
              { 'data-feedback-convert-panel': item.id, style: { display: 'flex', flexDirection: 'column', gap: 8, border: `1px solid ${T.line2}`, borderRadius: 8, padding: '9px 11px', background: T.layer } },
              h(
                'div',
                { style: { fontSize: 12, color: T.text2 } },
                '转到哪个优先级？确认后会在接收工作区生成一条待评审需求；同一问题已有需求时只关联、不重复创建。',
              ),
              h(
                'div',
                { style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' } },
                ...['P0', 'P1', 'P2'].map((level) =>
                  h('button', { type: 'button', 'data-feedback-convert-priority': level, 'aria-pressed': convertPriority === level ? 'true' : 'false', disabled: busy !== '', onClick: () => setConvertPriority(level), style: { ...buttonStyle(convertPriority === level ? 'brand' : undefined), padding: '3px 10px' } }, level),
                ),
                h('button', { type: 'button', 'data-feedback-convert-confirm': item.id, disabled: busy !== '', onClick: convertToRequirement, style: buttonStyle('brand') }, busy === 'generate' ? '生成中…' : '确认转需求'),
              ),
            )
          : null,
        supplementOpen
          ? h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
              h('textarea', {
                value: supplementText,
                'data-feedback-supplement-input': item.id,
                'aria-label': '补充这条反馈',
                onChange: (event) => setSupplementText(event.target.value),
                placeholder: '补充新信息：再次出现的条件、影响范围、期望结果…',
                style: { ...input, minHeight: 64, padding: '7px 10px', resize: 'vertical', fontFamily: 'inherit' },
              }),
              h(
                'div',
                { style: { display: 'flex', gap: 6 } },
                h('button', { type: 'button', 'data-feedback-supplement-submit': item.id, disabled: busy !== '', onClick: submitSupplement, style: buttonStyle('brand') }, busy === 'supplement' ? '保存中…' : '保存补充'),
                h('button', { type: 'button', onClick: () => setSupplementOpen(false), style: buttonStyle() }, '取消'),
              ),
            )
          : null,
        open
          ? h(
              'div',
              { 'data-feedback-detail': item.id, style: { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4, paddingTop: 8, borderTop: `1px dashed ${T.line2}` } },
              detail.loading
                ? h('div', { style: muted }, '正在读取详情…')
                : detail.error
                  ? h('div', { role: 'alert', style: { fontSize: 12, color: T.err } }, `详情读取失败：${detail.error.message}`)
                  : record
                    ? h(
                        'div',
                        { style: { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: T.text2, lineHeight: 1.65 } },
                        h('div', { style: { color: T.text } }, record.statement),
                        h(
                          'div',
                          { style: { display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: 11, color: T.text3 } },
                          h('span', null, `场景：${record.context?.ui?.page ?? '—'}${record.context?.ui?.stage ? ` / ${record.context.ui.stage}` : ''}`),
                          h('span', null, `观察：${record.context?.observedAt ? formatLocalStamp(record.context.observedAt) : '未记录'}`),
                          h('span', null, `接收：${record.receivedAt ? formatLocalStamp(record.receivedAt) : '未记录'}`),
                          h('span', null, `快照：${record.context?.contextSnapshotId ?? '—'}`),
                          h('span', null, `修订：v${record.revision ?? 1}`),
                        ),
                        record.processing?.state
                          ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: 11, color: T.text3 } },
                            h('span', null, `整理：${FEEDBACK_PROCESSING_LABELS[record.processing.state] ?? record.processing.state}`),
                            record.processing.proposalId ? h('span', null, `候选：${record.processing.proposalId}`) : null,
                            record.processing.lastError ? h('span', { style: { color: T.err } }, record.processing.lastError) : null,
                          )
                          : null,
                        record.context?.evidence?.textExcerpts?.length
                          ? h(
                              'div',
                              { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
                              record.context.evidence.textExcerpts.slice(0, 3).map((excerpt, index) =>
                                h('div', { key: index, style: { fontSize: 11, color: T.text3 } }, `${excerpt.label ?? '摘录'}：${excerpt.text ?? ''}`),
                              ),
                            )
                          : null,
                        record.context?.evidence?.attachments?.length
                          ? h(
                              'div',
                              { style: { display: 'flex', flexDirection: 'column', gap: 4 }, 'data-feedback-attachments': item.id },
                              h('div', { style: { fontSize: 11, color: T.text3 } }, `附件 ${record.context.evidence.attachments.length} 个`),
                              record.context.evidence.attachments.map((attachment, index) =>
                                h(
                                  'div',
                                  { key: index, style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 11.5, color: T.text2 } },
                                  h('span', null, `${attachment.name ?? attachment.sha256}（${Math.max(0, Math.round((attachment.size ?? 0) / 1024))} KB）`),
                                  h('button', { type: 'button', 'data-feedback-attachment-download': attachment.sha256, onClick: () => downloadAttachment(attachment), style: { ...buttonStyle('ghost'), padding: '2px 8px', fontSize: 11 } }, '下载'),
                                ),
                              ),
                            )
                          : null,
                        supplements.length > 0
                          ? h(
                              'div',
                              { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
                              h('div', { style: { fontSize: 11, color: T.text3 } }, `补充 ${supplements.length} 条`),
                              supplements.slice(-3).map((supplement, index) =>
                                h('div', { key: index, style: { fontSize: 11.5, color: T.text2 } }, `· ${supplement.statement}`),
                              ),
                            )
                          : null,
                        h(
                          'div',
                          { style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' } },
                          h('input', {
                            value: linkId,
                            'data-feedback-link-input': item.id,
                            'aria-label': '关联需求 ID',
                            onChange: (event) => setLinkId(event.target.value),
                            placeholder: '关联需求 ID，例如 REQ-ALM-001',
                            style: { ...input, width: 220, padding: '5px 9px', fontSize: 11.5 },
                          }),
                          h(
                            'button',
                            { type: 'button', 'data-feedback-link-submit': item.id, disabled: busy !== '' || !linkId.trim(), onClick: () => run('link', { requirement: { id: linkId.trim(), revision: 1 } }, '已关联需求'), style: buttonStyle('brand') },
                            busy === 'link' ? '关联中…' : '关联需求',
                          ),
                        ),
                      )
                    : h('div', { style: muted }, '没有读到详情；可重新打开。'),
            )
          : null,
        actionNote ? h('div', { role: 'status', 'data-feedback-action-note': item.id, style: { fontSize: 11.5, color: T.ok } }, actionNote) : null,
        actionError
          ? h(
              'div',
              { role: 'alert', 'data-feedback-action-error': item.id, style: { fontSize: 11.5, color: T.err } },
              `操作未完成：${actionError.code ? `[${actionError.code}] ` : ''}${actionError.message ?? ''}`,
            )
          : null,
      )
    }

    function FeedbackInbox({ root, onOpenRequirement, refreshToken }) {
      const [filter, setFilter] = useState('all')
      const [state, setState] = useState({ loading: true, error: null, data: null })
      const [reloadKey, setReloadKey] = useState(0)

      useEffect(() => {
        let alive = true
        setState((prev) => ({ ...prev, loading: true, error: null }))
        feedbackGet('inbox', root, feedbackInboxFilterQuery(filter))
          .then((payload) => {
            if (alive) setState({ loading: false, error: null, data: payload })
          })
          .catch((error) => {
            if (alive) setState({ loading: false, error, data: null })
          })
        return () => {
          alive = false
        }
      }, [root, refreshToken, reloadKey, filter])

      const data = state.data
      const items = Array.isArray(data?.items) ? data.items : []
      const counts = feedbackCountsOf(data)
      const onChanged = () => setReloadKey((value) => value + 1)

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
        h('div', { role: 'status', 'data-feedback-inbox-counts': 'true', style: { fontSize: 12, color: T.text2 } }, `待处理 ${counts.pending} · 已转需求 ${counts.requirementCreated} · 共 ${data?.total ?? items.length} 条`),
        h(
          'div',
          { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
          FEEDBACK_INBOX_FILTERS.map(([id, label]) =>
            h(
              'button',
              {
                key: id,
                type: 'button',
                'data-feedback-inbox-filter': id,
                'aria-pressed': filter === id ? 'true' : 'false',
                onClick: () => setFilter(id),
                style: feedbackChipStyle(filter === id),
              },
              label,
            ),
          ),
        ),
        state.loading && !data
          ? h('div', { style: muted }, '正在读取收件箱…')
          : state.error
            ? h(
                'div',
                { role: 'alert', style: { fontSize: 12, color: T.err, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
                `收件箱读取失败：${state.error.message}`,
                h('button', { type: 'button', onClick: () => setReloadKey((value) => value + 1), style: { ...button, padding: '3px 9px', fontSize: 11.5 } }, '重试'),
              )
            : items.length === 0
              ? h('div', { style: { ...muted, lineHeight: 1.7, padding: '18px 0' } }, filter === 'all' ? '还没有反馈。' : '当前筛选下没有反馈。')
              : h(
                  'div',
                  { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                  items.map((item) => h(FeedbackInboxRow, { key: item.id, item, root, onOpenRequirement, onChanged })),
                ),
      )
    }

    function normalizeFeedbackSettings(payload, fallbackWorkspaces) {
      const settings = payload?.settings ?? {}
      // The server persists `destinationWorkspace`; reading `destination` made
      // a configured target look unset, and saving then cleared it.
      const destination = settings.destinationWorkspace ?? settings.destination ?? null
      const stages = Array.isArray(settings?.coverage?.stages) ? settings.coverage.stages : FEEDBACK_COVERAGE_STAGES.map(([id]) => id)
      return {
        enabled: settings.enabled === true,
        destinationWorkspaceId: feedbackWorkspaceValue(destination),
        stages: stages.filter((stage) => FEEDBACK_COVERAGE_STAGES.some(([id]) => id === stage)),
        includeAttachments: settings?.capture?.includeAttachments === true,
        retentionDays: Number.isFinite(settings?.capture?.retentionDays) ? settings.capture.retentionDays : 90,
        maxRecords: Number.isFinite(settings?.capture?.maxRecords) ? settings.capture.maxRecords : 500,
        workspaces: Array.isArray(payload?.workspaces) ? payload.workspaces : Array.isArray(fallbackWorkspaces) ? fallbackWorkspaces : [],
      }
    }

    function FeedbackSettingsPanel({ root, onBack }) {
      const [state, setState] = useState({ loading: true, error: null, value: null, saving: false, savedAt: 0, saveError: null })
      const [reloadKey, setReloadKey] = useState(0)

      useEffect(() => {
        let alive = true
        setState((prev) => ({ ...prev, loading: true, error: null }))
        feedbackGet('settings', root)
          .then((payload) => {
            if (!alive) return
            setState({ loading: false, error: null, value: normalizeFeedbackSettings(payload), saving: false, savedAt: 0, saveError: null })
          })
          .catch((error) => {
            if (alive) setState({ loading: false, error, value: null, saving: false, savedAt: 0, saveError: null })
          })
        return () => {
          alive = false
        }
      }, [root, reloadKey])

      const updateValue = (patch) => {
        setState((prev) => (prev.value ? { ...prev, value: { ...prev.value, ...patch }, savedAt: 0 } : prev))
      }

      const toggleStage = (stage) => {
        setState((prev) => {
          if (!prev.value) return prev
          const has = prev.value.stages.includes(stage)
          const stages = has ? prev.value.stages.filter((id) => id !== stage) : [...prev.value.stages, stage]
          return { ...prev, value: { ...prev.value, stages }, savedAt: 0 }
        })
      }

      const save = () => {
        const value = state.value
        if (!value || state.saving) return
        setState((prev) => ({ ...prev, saving: true, saveError: null }))
        feedbackPost(
          'settings',
          {
            destinationWorkspaceId: value.destinationWorkspaceId || null,
            coverage: { stages: value.stages },
            capture: {
              includeAttachments: value.includeAttachments,
              retentionDays: value.retentionDays,
              maxRecords: value.maxRecords,
            },
          },
          root,
        )
          .then((payload) => {
            setState((prev) => ({
              loading: false,
              error: null,
              value: normalizeFeedbackSettings(payload, prev.value?.workspaces),
              saving: false,
              savedAt: Date.now(),
              saveError: null,
            }))
          })
          .catch((error) => {
            setState((prev) => ({ ...prev, saving: false, saveError: error }))
          })
      }

      const value = state.value
      return h(
        'div',
        { 'data-feedback-settings': 'true', style: { display: 'flex', flexDirection: 'column', gap: 14 } },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('button', { type: 'button', 'data-feedback-settings-back': 'true', onClick: onBack, style: { ...button, padding: '4px 9px', fontSize: 11.5 } }, '返回'),
          h('div', { style: { fontSize: 12.5, fontWeight: 600, color: T.text } }, '反馈发送设置'),
        ),
        state.loading
          ? h('div', { style: muted }, '正在读取设置…')
          : state.error
            ? h(
                'div',
                { role: 'alert', style: { fontSize: 12, color: T.err, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
                `读取设置失败：${state.error.message}`,
                h('button', { type: 'button', onClick: () => setReloadKey((prev) => prev + 1), style: { ...button, padding: '3px 9px', fontSize: 11.5 } }, '重试'),
              )
            : !value
              ? null
              : h(
                  'div',
                  { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
                  h(
                    'div',
                    { style: { display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', border: `1px solid ${T.line}`, borderRadius: 9, background: T.layer } },
                    h('input', { type: 'checkbox', checked: false, disabled: true, 'data-feedback-auto-review': 'true' }),
                    h(
                      'div',
                      { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
                      h('div', { style: { fontSize: 12, color: T.text3 } }, '启用自动过程复盘'),
                      h('div', { style: { fontSize: 11, color: T.text3 } }, '自动过程复盘将在后续版本提供。'),
                    ),
                  ),
                  h(
                    'label',
                    { style: { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: T.text2 } },
                    '接收工作区（生成需求的目标）',
                    h(
                      'select',
                      {
                        'data-feedback-destination': 'true',
                        value: value.destinationWorkspaceId ?? '',
                        onChange: (event) => updateValue({ destinationWorkspaceId: event.target.value || null }),
                        style: { ...input, minWidth: 0, padding: '6px 9px' },
                      },
                      h('option', { value: '' }, '未配置'),
                      value.workspaces.map((workspace) => {
                        const id = feedbackWorkspaceValue(workspace)
                        return h('option', { key: id ?? 'unknown', value: id ?? '' }, feedbackWorkspaceLabel(workspace))
                      }),
                    ),
                  ),
                  h(
                    'div',
                    { style: { display: 'flex', flexDirection: 'column', gap: 7 } },
                    h('div', { style: { fontSize: 12, color: T.text2 } }, '覆盖阶段'),
                    h(
                      'div',
                      { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
                      FEEDBACK_COVERAGE_STAGES.map(([id, label]) => {
                        const on = value.stages.includes(id)
                        return h(
                          'button',
                          {
                            key: id,
                            type: 'button',
                            'data-feedback-coverage': id,
                            'aria-pressed': on ? 'true' : 'false',
                            onClick: () => toggleStage(id),
                            style: feedbackChipStyle(on),
                          },
                          label,
                        )
                      }),
                    ),
                  ),
                  h(
                    'label',
                    { style: { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: T.text2 } },
                    '保留条数',
                    h('input', {
                      type: 'number',
                      min: 1,
                      max: 5000,
                      'data-feedback-max-records': 'true',
                      value: value.maxRecords,
                      onChange: (event) => {
                        const next = Number.parseInt(event.target.value, 10)
                        updateValue({ maxRecords: Number.isFinite(next) ? Math.min(5000, Math.max(1, next)) : value.maxRecords })
                      },
                      style: { ...input, minWidth: 120, width: 140 },
                    }),
                  ),
                  state.savedAt ? h('div', { role: 'status', 'data-feedback-settings-saved': 'true', style: { fontSize: 12, color: T.ok } }, '已保存设置') : null,
                  state.saveError ? h('div', { role: 'alert', style: { fontSize: 12, color: T.err } }, `保存设置失败：${state.saveError.message}`) : null,
                  h(
                    'div',
                    { style: { display: 'flex', gap: 8 } },
                    h('button', { type: 'button', 'data-feedback-settings-save': 'true', onClick: save, disabled: state.saving, style: primary }, state.saving ? '保存中…' : '保存设置'),
                  ),
                ),
      )
    }

    function FeedbackDrawer({ root, context, returnFocus, onClose, onOpenRequirement }) {
      const draftRef = useRef(null)
      if (!draftRef.current) draftRef.current = feedbackDraftFor(context)
      const draft = draftRef.current
      const [tab, setTab] = useState('compose')
      const [statement, setStatement] = useState(draft.statement)
      const [category, setCategory] = useState(draft.category)
      const [keep, setKeep] = useState(draft.keep)
      const [restored, setRestored] = useState(Boolean(draft.statement.trim() || draft.savedId))
      const [saved, setSaved] = useState({ id: draft.savedId, statement: draft.savedStatement })
      const [attachments, setAttachments] = useState(Array.isArray(draft.attachments) ? draft.attachments : [])
      const [saveState, setSaveState] = useState({ phase: 'idle', id: null, ms: 0, error: null, appended: false })
      const [refreshToken, setRefreshToken] = useState(0)
      const textareaRef = useRef(null)
      const busy = saveState.phase === 'saving'
      // A stale client bundle was the reported reason a visible-in-source
      // launcher "did not exist" at runtime; make the two builds comparable.
      const [build, setBuild] = useState({ checked: false, serverBuild: null, stale: false, mismatch: false })
      // "What am I improving, and where will the requirement go?" must be
      // visible before submit, not discovered in settings afterwards.
      const [targetInfo, setTargetInfo] = useState({ loading: true, workspace: null, destination: null })
      useEffect(() => {
        let live = true
        feedbackGet('settings', root)
          .then((payload) => {
            if (!live) return
            const settings = payload?.settings ?? {}
            const destination = settings.destinationWorkspace ?? settings.destination ?? null
            const value = feedbackWorkspaceValue(destination)
            const list = Array.isArray(payload?.workspaces) ? payload.workspaces : []
            const workspace = list.find((entry) => feedbackWorkspaceValue(entry) === value) ?? null
            setTargetInfo({ loading: false, workspace, destination: value })
          })
          .catch(() => {
            if (live) setTargetInfo({ loading: false, workspace: null, destination: null })
          })
        return () => {
          live = false
        }
      }, [root])
      useEffect(() => {
        let live = true
        feedbackGet('diagnostics', root)
          .then((payload) => {
            if (!live) return
            const serverBuild = payload?.serverBuild ?? payload?.clientBuild ?? null
            setBuild({
              checked: true,
              serverBuild,
              stale: false,
              mismatch: Boolean(serverBuild) && serverBuild !== FEEDBACK_CLIENT_BUILD,
            })
          })
          .catch(() => {
            if (!live) return
            // 404/unknown-action means the running host still has the old module.
            setBuild({ checked: true, serverBuild: null, stale: true, mismatch: false })
          })
        return () => {
          live = false
        }
      }, [root])

      const clearReceipt = () => {
        draft.requestId = null
        draft.supplementRequestId = null
        setSaveState({ phase: 'idle', id: null, ms: 0, error: null, appended: false })
      }

      const changeStatement = (next) => {
        setStatement(next)
        draft.statement = next
        if (next !== draft.savedStatement) clearReceipt()
      }

      const changeCategory = (next) => {
        setCategory(next)
        if (next === draft.category) return
        draft.category = next
        clearReceipt()
      }

      const toggleKeep = (id) => {
        setKeep((prev) => {
          const next = { ...prev, [id]: prev[id] === false }
          draft.keep = next
          clearReceipt()
          return next
        })
      }

      // Attachments are optional evidence: bytes go to the server once, the
      // record keeps only a content reference. Rejecting here keeps failures
      // local and immediate instead of losing the whole report.
      const readAttachmentFile = (file) =>
        new Promise((resolveRead, rejectRead) => {
          if (!FEEDBACK_ATTACHMENT_TYPES.includes(file.type)) {
            rejectRead(Object.assign(new Error('不支持的附件类型'), { code: 'attachment-type' }))
            return
          }
          if (file.size > FEEDBACK_ATTACHMENT_MAX_BYTES) {
            rejectRead(Object.assign(new Error('附件超过 2 MB'), { code: 'attachment-too-large' }))
            return
          }
          const reader = new FileReader()
          reader.onload = () => {
            const dataUrl = String(reader.result ?? '')
            const dataBase64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
            resolveRead({
              id: `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
              name: file.name || 'attachment',
              type: file.type,
              size: file.size,
              dataBase64,
            })
          }
          reader.onerror = () => rejectRead(Object.assign(new Error('附件读取失败'), { code: 'attachment-read' }))
          reader.readAsDataURL(file)
        })

      const addAttachments = (files) => {
        const incoming = Array.from(files ?? [])
        if (incoming.length === 0) return
        Promise.all(incoming.map((file) => readAttachmentFile(file)))
          .then((entries) => {
            const merged = [...attachments, ...entries].slice(0, 3)
            draft.attachments = merged
            setAttachments(merged)
            setSaveState({ phase: 'idle', id: null, ms: 0, error: null, appended: false })
          })
          .catch((error) => {
            setSaveState({ phase: 'error', id: null, ms: 0, error: { code: error?.code ?? 'attachment-invalid', message: error?.message ?? '附件读取失败' } })
          })
      }

      const removeAttachment = (id) => {
        const merged = attachments.filter((entry) => entry.id !== id)
        draft.attachments = merged
        setAttachments(merged)
      }

      const onComposePaste = (event) => {
        const items = Array.from(event?.clipboardData?.items ?? [])
        const files = items.filter((entry) => entry.kind === 'file').map((entry) => entry.getAsFile()).filter(Boolean)
        if (files.length === 0) return
        event.preventDefault()
        addAttachments(files)
      }

      // Saving is the only thing the user waits for. Organisation runs
      // afterwards as a separate durable request: a model failure can never
      // turn a saved report into a lost one.
      const kickOffProcessing = (id) => {
        if (!id) return
        feedbackPost('process', { id }, root)
          .then(() => setRefreshToken((value) => value + 1))
          .catch(() => {})
      }

      const buildContext = () => {
        const ui = { page: context?.page ?? 'list' }
        if (keep?.requirement !== false && context?.stage) ui.stage = context.stage
        // Which layer was covering the workbench when the report was written.
        // Kept inside the sanitised viewState bag; no new endpoint field.
        if (keep?.requirement !== false && context?.overlay?.kind) {
          const overlay = { kind: context.overlay.kind, label: String(context.overlay.label ?? '').slice(0, 160) }
          if (context.overlay.requirementId) overlay.requirementId = String(context.overlay.requirementId).slice(0, 80)
          ui.viewState = { overlay }
          // Which detail tab the report was written from (whitelisted bag).
          if (['requirement', 'delivery', 'record'].includes(context.overlay.tab)) ui.viewState.tab = context.overlay.tab
        }
        const links = {}
        if (keep?.requirement !== false && context?.requirementId) links.requirementId = context.requirementId
        if (keep?.run !== false && context?.runId) links.runIds = [context.runId]
        if (keep?.intent !== false && context?.intentSessionId) links.intentSessionId = context.intentSessionId
        if (keep?.requirement !== false && context?.candidateId) links.candidateId = context.candidateId
        if (keep?.requirement !== false && context?.requirementRevision != null) links.requirementRevision = context.requirementRevision
        if (keep?.requirement !== false && context?.requirementFile) {
          links.requirementFile = context.requirementFile
          links.requirementInstanceKey = context.requirementFile
        }
        // A modal can be about a decision or a failed test, not only a
        // requirement; those identifiers travel with the report.
        if (keep?.requirement !== false && context?.acceptanceDecisionId) links.acceptanceDecisionId = context.acceptanceDecisionId
        if (keep?.requirement !== false && Array.isArray(context?.failureIds) && context.failureIds.length > 0) {
          links.failureIds = context.failureIds.slice(0, 20)
        }
        // The click time travels separately from capturedAt (server receive
        // time) so latency or a client clock bug stays visible in the record.
        const observedAt = Number.isFinite(context?.frozenAt) ? new Date(context.frozenAt).toISOString() : undefined
        return {
          ...(observedAt ? { observedAt, capturedAt: observedAt } : {}),
          ...(context?.root ? { observedRoot: context.root } : {}),
          capture: { kind: 'client-click', client: 'dsh-web', clientBuild: FEEDBACK_CLIENT_BUILD, ...(observedAt ? { observedAt } : {}) },
          // Top-level, not inside ui: the server's UI whitelist is intentionally
          // narrow, while core already turns recentError into a text excerpt.
          ...(keep?.error !== false && context?.recentError ? { recentError: context.recentError } : {}),
          ui,
          links,
          captureBoundary: { mode: 'current-only', coveredStages: [], notCoveredStages: ['未记录的历史操作'], truncated: false },
        }
      }

      const resetDraft = () => {
        draft.statement = ''
        draft.category = 'undetermined'
        draft.requestId = null
        draft.supplementRequestId = null
        draft.savedId = null
        draft.savedStatement = null
        setStatement('')
        setCategory('undetermined')
        setSaved({ id: null, statement: null })
        setRestored(false)
        setSaveState({ phase: 'idle', id: null, ms: 0, error: null, appended: false })
      }

      const saveFeedback = () => {
        const text = statement.trim()
        if (!text) {
          const error = { code: 'statement-required', message: FEEDBACK_ERROR_HINTS['statement-required'] }
          setSaveState({ phase: 'error', id: null, ms: 0, error })
          return Promise.resolve({ id: null, error })
        }
        if (text.length > FEEDBACK_MAX_STATEMENT) {
          const error = { code: 'statement-too-long', message: FEEDBACK_ERROR_HINTS['statement-too-long'] }
          setSaveState({ phase: 'error', id: null, ms: 0, error })
          return Promise.resolve({ id: null, error })
        }
        const startedAt = Date.now()
        setSaveState({ phase: 'saving', id: null, ms: 0, error: null })
        // Same record, changed text: append a supplement under the original id
        // instead of creating a near-duplicate feedback record.
        const appending = Boolean(draft.savedId) && text !== draft.savedStatement
        if (appending) {
          if (!draft.supplementRequestId) {
            draft.supplementRequestId = `fb-sup-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
          }
          return feedbackPost(
            'supplement',
            { id: draft.savedId, statement: text, context: buildContext(), supplementId: draft.supplementRequestId },
            root,
          )
            .then((payload) => {
              const id = payload?.feedback?.id ?? draft.savedId
              draft.savedId = id
              draft.savedStatement = text
              draft.supplementRequestId = null
              setSaved({ id, statement: text })
              setSaveState({ phase: 'done', id, ms: Math.max(0, Date.now() - startedAt), error: null, appended: true })
              setRefreshToken((value) => value + 1)
              kickOffProcessing(id)
              return { id, error: null }
            })
            .catch((error) => {
              const shown = feedbackErrorView(error)
              setSaveState({ phase: 'error', id: null, ms: 0, error: shown })
              return { id: null, error }
            })
        }
        if (!draft.requestId) {
          draft.requestId = `fb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
        }
        return feedbackPost(
          'save',
          { statement: text, category, context: buildContext(), clientRequestId: draft.requestId, ...(attachments.length > 0 ? { attachments: attachments.map(({ name, type, dataBase64 }) => ({ name, type, dataBase64 })) } : {}) },
          root,
        )
          .then((payload) => {
            const id = payload?.feedback?.id ?? payload?.receipt?.feedbackId ?? null
            draft.savedId = id
            draft.savedStatement = text
            draft.attachments = []
            setAttachments([])
            setSaved({ id, statement: text })
            setSaveState({ phase: 'done', id, ms: Math.max(0, Date.now() - startedAt), error: null, appended: false })
            setRefreshToken((value) => value + 1)
            kickOffProcessing(id)
            return { id, error: null }
          })
          .catch((error) => {
            const shown = feedbackErrorView(error)
            setSaveState({ phase: 'error', id: null, ms: 0, error: shown })
            return { id: null, error: shown }
          })
      }

      useEffect(() => {
        const onKey = (event) => {
          if (event.key !== 'Escape') return
          event.stopPropagation()
          onClose()
        }
        document.addEventListener('keydown', onKey, true)
        return () => document.removeEventListener('keydown', onKey, true)
      }, [onClose])

      useEffect(() => {
        // The layer is the top-most modal surface: Tab must cycle inside it
        // instead of reaching the page behind it.
        const onKey = (event) => {
          if (event.key !== 'Tab') return
          const layer = typeof document !== 'undefined' ? document.querySelector('[data-feedback-layer="true"]') : null
          if (!layer) return
          const focusable = Array.from(layer.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
            .filter((node) => !node.disabled && node.offsetParent !== null)
          if (focusable.length === 0) return
          const first = focusable[0]
          const last = focusable[focusable.length - 1]
          if (!layer.contains(document.activeElement)) {
            event.preventDefault()
            ;(event.shiftKey ? last : first).focus()
          } else if (event.shiftKey && document.activeElement === first) {
            event.preventDefault()
            last.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first.focus()
          }
        }
        document.addEventListener('keydown', onKey, true)
        return () => document.removeEventListener('keydown', onKey, true)
      }, [])

      useEffect(() => {
        const target = textareaRef.current
        if (target && typeof target.focus === 'function') target.focus()
      }, [])

      useEffect(() => {
        const target = returnFocus
        return () => {
          if (!target || typeof target.focus !== 'function') return
          if (target.isConnected === false) return
          try {
            target.focus()
          } catch {}
        }
      }, [returnFocus])

      const renderSaveStatus = () => {
        if (saveState.phase === 'saving') {
          return h('div', { role: 'status', 'data-feedback-save': 'saving', style: { fontSize: 12, color: T.text2 } }, '保存中…')
        }
        if (saveState.phase === 'done') {
          return h(
            'div',
            {
              role: 'status',
              'data-feedback-save': 'done',
              style: { fontSize: 12, color: T.ok, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
            },
            `${saveState.appended ? '已补充到' : '已保存'} ${saveState.id}（${saveState.ms}ms）`,
            h('button', { type: 'button', 'data-feedback-view-inbox': 'true', onClick: () => setTab('inbox'), style: { ...button, padding: '2px 8px', fontSize: 11 } }, '查看收件箱'),
          )
        }
        if (saveState.phase === 'error' && saveState.error) {
          const code = saveState.error.code
          return h(
            'div',
            { role: 'alert', 'data-feedback-save': 'error', style: { fontSize: 12, color: T.err, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
            `保存失败：${code ? `[${code}] ` : ''}${saveState.error.message}`,
            h('button', { type: 'button', 'data-feedback-retry': 'true', onClick: () => { saveFeedback() }, style: { ...button, padding: '2px 8px', fontSize: 11 } }, '重试'),
          )
        }
        return null
      }

      const composeNode = h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
        restored
          ? h(
              'div',
              { 'data-feedback-draft-restored': 'true', style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 11.5, color: T.text2 } },
              h('span', null, '已恢复这条反馈上次未提交的内容。'),
              h(
                'button',
                { type: 'button', 'data-feedback-draft-reset': 'true', onClick: resetDraft, style: { ...button, padding: '2px 8px', fontSize: 11 } },
                '清空，写新的',
              ),
            )
          : null,
        h(
          'div',
          { 'data-feedback-target': 'true', style: { display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 11.5, color: T.text3 } },
          h('span', null, '改进对象：需求插件（DSH 需求）'),
          h('span', null, '·'),
          h(
            'span',
            { 'data-feedback-destination': 'true' },
            targetInfo.loading
              ? '接收工作区：读取中…'
              : targetInfo.workspace
                ? `接收工作区：${targetInfo.workspace.title ?? targetInfo.workspace.name ?? targetInfo.destination}`
                : '接收工作区：未配置（转需求前需在设置里选择）',
          ),
        ),
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
          h('div', { style: { fontSize: 12, color: T.text2 } }, '哪里不顺，或希望怎样改变（必填）'),
          h('textarea', {
            ref: textareaRef,
            'data-feedback-statement': 'true',
            'aria-label': '哪里不顺，或希望怎样改变',
            value: statement,
            maxLength: FEEDBACK_MAX_STATEMENT,
            onChange: (event) => changeStatement(event.target.value),
            onPaste: onComposePaste,
            placeholder: '例如：按来源筛选后列表没有说明，我看不出筛选是否生效。',
            style: { ...input, minHeight: 132, minWidth: 0, padding: '9px 11px', resize: 'vertical', lineHeight: 1.6, fontFamily: 'inherit' },
          }),
          h(
            'div',
            { style: { display: 'flex', justifyContent: 'space-between', fontSize: 11, color: T.text3 } },
            h('span', null, '越具体越容易被转成需求'),
            h('span', { 'data-feedback-counter': 'true' }, `${statement.length}/${FEEDBACK_MAX_STATEMENT}`),
          ),
        ),
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
          h('div', { style: { fontSize: 12, color: T.text2 } }, '类别'),
          h(
            'div',
            { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
            FEEDBACK_CATEGORIES.map(([id, label]) => {
              const on = category === id
              return h(
                'button',
                { key: id, type: 'button', 'data-feedback-category': id, 'aria-pressed': on ? 'true' : 'false', onClick: () => changeCategory(id), style: feedbackChipStyle(on) },
                label,
              )
            }),
          ),
        ),
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12, color: T.text2 } },
            h(
              'label',
              { role: 'button', tabIndex: 0, onKeyDown: (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.currentTarget.querySelector('input').click() } }, style: { ...button, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', fontSize: 11.5, cursor: 'pointer' } },
              '＋ 附件',
              h('input', { type: 'file', multiple: true, accept: FEEDBACK_ATTACHMENT_TYPES.join(','), style: { display: 'none' }, onChange: (event) => { addAttachments(event.target.files); event.target.value = '' } }),
            ),
            h('span', { style: { fontSize: 11, color: T.text3 } }, '截图或日志，最多 3 个；也可以直接粘贴截图'),
          ),
          attachments.length > 0
            ? h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
                ...attachments.map((entry) =>
                  h(
                    'div',
                    { key: entry.id, 'data-feedback-attachment': entry.name, style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: T.text2, background: T.layer2, border: `1px solid ${T.line}`, borderRadius: 6, padding: '4px 8px' } },
                    h('span', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, `${entry.name} · ${Math.round(entry.size / 1024)} KB`),
                    h('button', { type: 'button', 'data-feedback-attachment-remove': entry.id, 'aria-label': `移除附件：${entry.name}`, onClick: () => removeAttachment(entry.id), style: { ...button, padding: '1px 6px', fontSize: 11 } }, '×'),
                  ),
                ),
              )
            : null,
        ),
        h(FeedbackContextSummary, { context, keep, onToggle: toggleKeep }),
        renderSaveStatus(),
      )

      const headerNode = h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderBottom: `1px solid ${T.line}` } },
        h(ActionIcon, { name: 'message', size: 16 }),
        h(
          'div',
          { style: { flex: 1, minWidth: 0 } },
          h('div', { style: { fontSize: 13.5, fontWeight: 600, color: T.text } }, '反馈与建议'),
          h('div', { style: { fontSize: 11.5, color: T.text3, marginTop: 2 } }, '记录不顺，转成需求；不会自动开发。'),
        ),
        h(
          'button',
          { type: 'button', 'data-feedback-close': 'true', 'aria-label': '关闭反馈面板', onClick: onClose, style: { ...button, padding: '5px 9px', fontSize: 12 } },
          h(ActionIcon, { name: 'close', size: 13 }),
        ),
      )

      const buildText = !build.checked
        ? '正在核对客户端与服务端构建…'
        : build.stale
          ? '服务端还没有加载反馈 v2 接口（应用未重启）：新字段与新入口在重启后生效。'
          : build.mismatch
            ? `客户端 ${FEEDBACK_CLIENT_BUILD} 与服务端 ${build.serverBuild} 不一致；请重启应用，避免按旧行为判断。`
            : `构建 ${FEEDBACK_CLIENT_BUILD}`
      const bannerNode = h(
        'div',
        {
          'data-feedback-context': 'true',
          role: 'status',
          style: { padding: '8px 18px', borderBottom: `1px solid ${T.line}`, background: T.layer, fontSize: 11.5, color: T.text2, lineHeight: 1.5 },
        },
        `已固定当前上下文 · ${FEEDBACK_PAGE_LABELS[context?.page] ?? '当前页面'}${context?.stage ? ` · ${DEFECT_STAGE_LABELS[context.stage] ?? context.stage}` : ''}${context?.requirementId ? ` · ${context.requirementId}` : ''}`,
        h(
          'div',
          {
            'data-feedback-build': build.stale ? 'stale-server' : build.mismatch ? 'mismatch' : build.checked ? 'ok' : 'checking',
            style: { marginTop: 3, fontSize: 11, color: build.stale || build.mismatch ? T.warn : T.text3 },
          },
          buildText,
        ),
      )

      const tabsRow = h(
        'div',
        { role: 'tablist', 'aria-label': '反馈视图', onKeyDown: (event) => {
          const ids = ['compose', 'inbox', 'settings']
          const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
          if (!step && event.key !== 'Home' && event.key !== 'End') return
          event.preventDefault()
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (ids.indexOf(tab) + step + 3) % 3
          setTab(ids[next])
          event.currentTarget.querySelectorAll('[role="tab"]')[next]?.focus()
        }, style: { display: 'flex', gap: 6, padding: '12px 18px 0' } },
        [
          ['compose', '写反馈'],
          ['inbox', '收件箱'],
          ['settings', '设置'],
        ].map(([id, label]) => {
          const on = tab === id
          return h(
            'button',
            {
              key: id,
              type: 'button',
              role: 'tab',
              'aria-selected': on ? 'true' : 'false',
              'data-feedback-tab': id,
              id: `feedback-tab-${id}`,
              'aria-controls': 'feedback-tab-panel',
              tabIndex: on ? 0 : -1,
              onClick: () => setTab(id),
              style: {
                ...button,
                border: `1px solid ${on ? 'rgba(77,107,254,.5)' : T.line}`,
                background: on ? 'rgba(77,107,254,.12)' : 'transparent',
                color: on ? T.text : T.text2,
                padding: '5px 12px',
                fontSize: 12,
              },
            },
            label,
          )
        }),
      )

      const body = tab === 'inbox' ? h(FeedbackInbox, { root, onOpenRequirement, refreshToken }) : tab === 'settings' ? h(FeedbackSettingsPanel, { root, onBack: () => setTab('compose') }) : composeNode

      // Only the compose tab may save/generate: on inbox/settings these
      // actions would act on an invisible background draft.
      const footer =
        tab !== 'compose'
          ? null
          : h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '12px 18px', borderTop: `1px solid ${T.line}`, background: T.layer, flexWrap: 'wrap' } },
              h(
                'button',
                {
                  type: 'button',
                  'data-feedback-save-button': 'true',
                  disabled: busy || !statement.trim(),
                  onClick: () => {
                    saveFeedback()
                  },
                  style: { ...button, padding: '7px 14px', fontSize: 12 },
                },
                saved.id && statement.trim() !== (saved.statement ?? '') ? '提交补充' : '提交反馈',
              ),
              h(
                'button',
                { type: 'button', 'data-feedback-dismiss': 'true', onClick: onClose, style: { ...button, padding: '7px 14px', fontSize: 12, marginLeft: 'auto' } },
                '关闭',
              ),
            )

      return h(
        'div',
        { 'data-feedback-layer': 'true', style: { position: 'fixed', inset: 0, zIndex: 65 } },
        h(
          'style',
          null,
          '@keyframes feedback-drawer-in { from { opacity: 0; transform: translateX(18px) } to { opacity: 1; transform: none } } @media (prefers-reduced-motion: reduce) { [data-feedback-panel] { animation: none !important } }',
        ),
        h('div', { onClick: onClose, 'aria-hidden': 'true', style: { position: 'absolute', inset: 0, background: 'rgba(4,6,9,.45)' } }),
        h(
          'aside',
          {
            role: 'dialog',
            'aria-modal': 'false',
            'aria-label': '反馈与建议',
            'data-feedback-panel': 'true',
            style: {
              position: 'absolute',
              top: 0,
              right: 0,
              bottom: 0,
              width: 480,
              maxWidth: '96vw',
              background: T.base,
              borderLeft: `1px solid ${T.line2}`,
              boxShadow: '-24px 0 60px rgba(0,0,0,.45)',
              display: 'flex',
              flexDirection: 'column',
              animation: REDUCE_MOTION ? 'none' : 'feedback-drawer-in 160ms ease-out',
            },
          },
          headerNode,
          bannerNode,
          tabsRow,
          h('div', { role: 'tabpanel', id: 'feedback-tab-panel', 'aria-labelledby': `feedback-tab-${tab}`, style: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 18px 16px' } }, body),
          footer,
        ),
      )
    }

    const MONITORING_STAGE_OPTIONS = ['clarify', 'review', 'develop', 'test', 'handoff']

    function MonitoringPanel({ root, onClose }) {
      const [state, setState] = useState({ loading: true, error: null, value: null, saving: false, savedAt: null, saveError: null })
      useEffect(() => {
        let live = true
        writeJson('defect', { mode: 'settings' }, root)
          .then((payload) => {
            if (!live) return
            const value = payload?.monitoring ?? payload?.settings ?? (payload && payload.enabled !== undefined ? payload : null)
            if (!value) {
              setState({ loading: false, error: '后端没有返回监控设置（接口可能还没就绪）。', value: null, saving: false, savedAt: null, saveError: null })
              return
            }
            const stages = Array.isArray(value.stages) ? value.stages.filter((stage) => MONITORING_STAGE_OPTIONS.includes(stage)) : MONITORING_STAGE_OPTIONS
            setState({ loading: false, error: null, value: { enabled: value.enabled !== false, stages, notify: value.notify !== false }, saving: false, savedAt: null, saveError: null })
          })
          .catch((error) => {
            if (!live) return
            setState({ loading: false, error: error.message, value: null, saving: false, savedAt: null, saveError: null })
          })
        return () => {
          live = false
        }
      }, [root])

      const value = state.value
      const patch = (next) => setState((current) => ({ ...current, value: { ...current.value, ...next }, savedAt: null }))
      const toggleStage = (stage) => {
        if (!value) return
        const stages = value.stages.includes(stage) ? value.stages.filter((entry) => entry !== stage) : [...value.stages, stage]
        patch({ stages })
      }
      const save = () => {
        if (!value || state.saving) return
        setState((current) => ({ ...current, saving: true, saveError: null }))
        writeJson('defect', { mode: 'settings', settings: { enabled: value.enabled, stages: value.stages, notify: value.notify } }, root)
          .then((payload) => {
            const next = payload?.monitoring ?? payload?.settings ?? (payload && payload.enabled !== undefined ? payload : null)
            setState((current) => ({
              ...current,
              saving: false,
              saveError: null,
              savedAt: Date.now(),
              value: next ? { enabled: next.enabled !== false, stages: Array.isArray(next.stages) ? next.stages : current.value.stages, notify: next.notify !== false } : current.value,
            }))
          })
          .catch((error) => setState((current) => ({ ...current, saving: false, saveError: error.message })))
      }

      const stageChips = value
        ? MONITORING_STAGE_OPTIONS.map((stage) => {
            const on = value.stages.includes(stage)
            return h(
              'button',
              {
                key: stage,
                type: 'button',
                'aria-pressed': on,
                onClick: () => toggleStage(stage),
                style: {
                  border: `1px solid ${on ? 'rgba(77,107,254,.5)' : T.line}`,
                  background: on ? 'rgba(77,107,254,.12)' : 'transparent',
                  color: on ? T.text : T.text2,
                  borderRadius: '999px',
                  padding: '4px 11px',
                  fontSize: '11.5px',
                  cursor: 'pointer',
                },
              },
              `${on ? '✓ ' : ''}${DEFECT_STAGE_LABELS[stage] ?? stage}`,
            )
          })
        : []

      return h(
        ModalShell,
        {
          title: '失败监控设置',
          lead: '监控在每次门禁失败后落一条失败事件；可复现的失败会自动建成缺陷需求，等你确认。',
          onClose,
          width: '680px',
          footer: [
            h(ActionButton, { key: 'close', label: '关闭', variant: 'ghost', onClick: onClose }),
            h(ActionButton, { key: 'save', label: state.saving ? '保存中…' : '保存设置', icon: 'check', variant: 'primary', disabled: state.saving || !value, onClick: save }),
          ],
        },
        state.loading ? h('p', { style: { margin: '16px 0 0', ...DETAIL_SUB } }, '正在读取监控设置…') : null,
        state.error
          ? h('div', { style: { marginTop: '14px', border: `1px solid ${T.err}`, borderRadius: '10px', padding: '10px 12px' } }, h('p', { style: { margin: 0, color: T.err, fontSize: '12.5px', lineHeight: 1.7 } }, `读取监控设置失败：${state.error}`))
          : null,
        value
          ? h(
              'div',
              { style: { marginTop: '16px' } },
              h(
                'div',
                {
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    border: `1px solid ${value.enabled ? 'rgba(53,196,122,.35)' : 'rgba(231,176,75,.35)'}`,
                    background: value.enabled ? 'rgba(53,196,122,.1)' : 'rgba(231,176,75,.1)',
                    borderRadius: '10px',
                    padding: '9px 12px',
                  },
                },
                h('span', { style: { width: '7px', height: '7px', borderRadius: '50%', background: value.enabled ? T.ok : T.warn } }),
                h('span', { style: { fontSize: '12.5px', color: T.text } }, value.enabled ? '监控正常运行' : '监控已暂停（历史记录保留）'),
                h('span', { style: { marginLeft: 'auto', display: 'inline-flex' } }, h(ActionButton, {
                  label: value.enabled ? '暂停监控' : '恢复监控',
                  icon: value.enabled ? 'close' : 'play',
                  variant: 'secondary',
                  onClick: () => patch({ enabled: !value.enabled }),
                })),
              ),
              h('div', { style: { marginTop: '14px' } },
                h('div', { style: { fontSize: '11px', letterSpacing: '.06em', textTransform: 'uppercase', color: T.text3, marginBottom: '7px' } }, '监控阶段'),
                h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } }, stageChips),
              ),
              h('div', { style: { marginTop: '14px', display: 'flex', alignItems: 'center', gap: '8px' } },
                h('input', {
                  type: 'checkbox',
                  checked: value.notify,
                  onChange: (event) => patch({ notify: event.target.checked }),
                  'aria-label': '发现缺陷时通知我',
                }),
                h('span', { style: { fontSize: '12.5px', color: T.text2 } }, '发现新缺陷时通知我'),
              ),
              state.saveError ? h('p', { style: { margin: '12px 0 0', color: T.err, fontSize: '12.5px' } }, `保存失败：${state.saveError}`) : null,
              state.savedAt ? h('p', { style: { margin: '12px 0 0', color: T.ok, fontSize: '12px' } }, '已保存。') : null,
            )
          : null,
      )
    }

    function DefectToast({ toast, onOpen, onClose }) {
      const closeRef = useRef(onClose)
      closeRef.current = onClose
      useEffect(() => {
        const timer = setTimeout(() => closeRef.current?.(), 9000)
        return () => clearTimeout(timer)
      }, [toast])
      const record = defectRecord(toast?.defect) ?? toast?.defect ?? null
      if (!record) return null
      const count = Number(toast?.count ?? 1)
      return h(
        'div',
        {
          role: 'status',
          'aria-live': 'polite',
          style: {
            position: 'fixed',
            right: '18px',
            bottom: '18px',
            zIndex: 70,
            width: '320px',
            maxWidth: 'calc(100vw - 36px)',
            background: T.layer2,
            border: '1px solid rgba(231,176,75,.4)',
            borderRadius: '12px',
            padding: '12px 14px',
            boxShadow: '0 16px 44px rgba(0,0,0,.45)',
          },
        },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: '7px' } },
          h(ActionIcon, { name: 'alert', size: 13 }),
          h('span', { style: { fontSize: '12.5px', fontWeight: 600, color: T.text } }, `发现新缺陷需求 ${record.id ?? ''}`.trim()),
          h('button', {
            type: 'button',
            onClick: onClose,
            'aria-label': '关闭通知',
            style: { marginLeft: 'auto', border: 0, background: 'transparent', color: T.text3, cursor: 'pointer', fontSize: '14px', lineHeight: 1, padding: 0 },
          }, '×'),
        ),
        h('div', { style: { marginTop: '5px', fontSize: '11.5px', color: T.text2, lineHeight: 1.6 } }, record.title ?? '（无标题）'),
        h(
          'div',
          { style: { marginTop: '9px', display: 'flex', alignItems: 'center', gap: '10px' } },
          count > 1 ? h('span', { style: { fontSize: '11px', color: T.text3 } }, `共 ${count} 个新缺陷` ) : null,
          h('span', { style: { marginLeft: 'auto', display: 'inline-flex' } }, h(ActionButton, { label: '查看', icon: 'eye', variant: 'accent', onClick: () => onOpen?.(record) })),
        ),
      )
    }

    function readV4Navigation() { try { return JSON.parse(sessionStorage.getItem('alm.requirements.navigation.v4') ?? '{}') } catch { return {} } }

    async function saveExchangeFile(format, request) {
      const mime = format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/json'
      // Invoke the picker before the first await, while the click still has user activation.
      let handle
      if (typeof window.showSaveFilePicker === 'function') {
        try {
          handle = await window.showSaveFilePicker({
            suggestedName: `requirements.${format}`,
            types: [{ description: format === 'xlsx' ? 'Excel workbook' : 'JSON', accept: { [mime]: [`.${format}`] } }],
          })
        } catch (error) {
          if (error.name === 'AbortError') return { message: '已取消保存，未下载文件。' }
          throw error
        }
      }
      const file = await request({ action: 'export', format })
      const bytes = Uint8Array.from(atob(file.content), c => c.charCodeAt(0))
      if (!Number.isSafeInteger(file.bytes) || bytes.byteLength !== file.bytes || file.mime !== mime) throw new Error('导出文件字节数或类型不匹配，未保存')
      const blob = new Blob([bytes], { type: mime })
      if (handle) {
        const writable = await handle.createWritable()
        try {
          await writable.write(blob)
          await writable.close()
        } catch (error) {
          try { await writable.abort() } catch { /* Preserve the original write/close error. */ }
          throw error
        }
        return { message: `已保存 ${handle.name}（${file.bytes} bytes），附件仅含manifest。` }
      }
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      const cleanup = () => { link.remove(); URL.revokeObjectURL(url) }
      try {
        link.href = url; link.download = file.filename; link.style.display = 'none'
        document.body.appendChild(link)
        link.click()
      } catch (error) { cleanup(); throw error }
      // Download handoff is asynchronous. Keep both the node and URL alive.
      setTimeout(cleanup, 60000)
      return { message: `已发起下载 ${file.filename}（${file.bytes} bytes），请检查浏览器下载记录；尚未确认落盘。附件仅含manifest。` }
    }

    function ExchangeModal({ root, onClose, onApplied }) {
      const dialogRef = useRef(null)
      const [busy, setBusy] = useState(false)
      const [selected, setSelected] = useState(null)
      const [preview, setPreview] = useState(null)
      const [receipt, setReceipt] = useState(null)
      const [error, setError] = useState('')
      const request = async (body) => {
        const response = await fetch(`/api/alm/requirements/exchange?root=${encodeURIComponent(root)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
        const result = await response.json()
        if (!response.ok && !Array.isArray(result.conflicts)) throw new Error(result.error?.message ?? result.message ?? `HTTP ${response.status}`)
        return result
      }
      const run = async (fn) => { setBusy(true); setError(''); try { await fn() } catch (e) { setError(e.message) } finally { setBusy(false) } }
      const download = (format) => run(async () => {
        setReceipt(null)
        setReceipt(await saveExchangeFile(format, request))
      })
      const pick = (file) => run(async () => {
        setPreview(null); setReceipt(null); setSelected(null)
        if (!file) return
        if (file.size > 8 * 1024 * 1024) throw new Error('文件超过8 MiB限制')
        const format = file.name.toLowerCase().endsWith('.xlsx') ? 'xlsx' : file.name.toLowerCase().endsWith('.json') ? 'json' : null
        if (!format) throw new Error('仅支持JSON或.xlsx文件')
        const bytes = new Uint8Array(await file.arrayBuffer())
        let binary = ''; for (let i = 0; i < bytes.length; i += 16384) binary += String.fromCharCode(...bytes.subarray(i, i + 16384))
        const input = { format, filename: file.name, content: btoa(binary) }
        const result = await request({ action: 'preview', ...input })
        setSelected(input); setPreview(result)
      })
      const apply = () => run(async () => {
        const result = await request({ action: 'apply', ...selected, expectedLocalHash: preview.localHash })
        if (result.ok === false) { setPreview(result); return }
        setReceipt({ ...result, message: result.idempotent ? '回导完成：无新增变更（幂等）。' : '回导完成：整批已应用。' }); setPreview(null); onApplied()
      })
      useDialogFocus(dialogRef, onClose)
      return h('div', { style: { position: 'fixed', inset: 0, zIndex: 1000, background: '#0008', display: 'grid', placeItems: 'center' } },
        h('section', { ref: dialogRef, tabIndex: -1, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'alm-exchange-title', style: { width: 'min(820px, 94vw)', maxHeight: '90vh', overflow: 'auto', overscrollBehavior: 'contain', padding: 24, background: T.bg, color: T.text, border: `1px solid ${T.line}`, borderRadius: 12 } },
          h('h2', { id: 'alm-exchange-title' }, '需求文件交换'),
          h('p', null, '仅交换title / brief / priority / owner；不导入执行状态、证据、签收或发布授权。缺行不删除。'),
          h('p', null, '旧项目先点「初始化交换」（独立持久化项目密钥）。Excel已有行仅编辑F-I四字段；长正文用Brief表C列，record/chunk只读。新增须在原记录块末尾后追加：A=create、B空、C唯一clientId、D项目ID、E空、F-I四值，新正文限32767字符。身份、基线与隐藏元数据不可修改。附件仅含安全manifest。'),
          h('div', { style: { display: 'flex', gap: 12, marginBottom: 16 } },
            h('button', { disabled: busy, onClick: () => run(async () => { await request({ action: 'initialize' }); setReceipt({ message: '项目交换已初始化；密钥保存在项目内，不导出、不轮换。可导出或选择文件预览。' }) }) }, '初始化交换'),
            h('button', { disabled: busy, onClick: () => download('json') }, '导出JSON'),
            h('button', { disabled: busy, onClick: () => download('xlsx') }, '导出Excel .xlsx')),
          h('label', null, '选择文件导入并预览 ', h('input', { type: 'file', accept: '.json,.xlsx', disabled: busy, onChange: e => { const file = e.target.files?.[0]; e.target.value = ''; pick(file) } })),
          busy ? h('p', { role: 'status' }, '处理中…') : null,
          error ? h('p', { role: 'alert', style: { color: '#d94b4b' } }, error) : null,
          preview ? h('div', null,
            h('h3', null, preview.ok ? '预览通过，等待确认' : '预览拒绝：冲突或校验失败，未写入'),
            h('pre', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 280, overflow: 'auto' } }, JSON.stringify({ changes: preview.changes, conflicts: preview.conflicts, errors: preview.errors }, null, 2)),
            h('button', { disabled: busy || !preview.ok, onClick: apply }, '确认整批导入')) : null,
          receipt ? h('div', { role: 'status' }, h('h3', null, '交换结果回执'), h('p', null, receipt.message), h('pre', { style: { whiteSpace: 'pre-wrap' } }, JSON.stringify(receipt.created ?? receipt.receipt ?? {}, null, 2))) : null,
          h('button', { disabled: busy, onClick: onClose, style: { marginTop: 20 } }, '关闭交换')))
    }
    const NATIVE_SOURCE_BUILD_ID = typeof __ALM_SOURCE_BUILD_ID__ === 'string' ? __ALM_SOURCE_BUILD_ID__ : null
    const NATIVE_CLIENT_BUILD_ID = typeof __ALM_CLIENT_BUILD_ID__ === 'string' ? __ALM_CLIENT_BUILD_ID__ : null

    function NativeDeliveryControl({ root, requirementId }) {
      const [job, setJob] = useState(null)
      const [error, setError] = useState(null)
      const [busy, setBusy] = useState(false)
      const dispatching = useRef(false)
      const scope = `${root}|${requirementId}`
      const currentScope = useRef(scope)
      currentScope.current = scope
      useEffect(() => {
        setJob(null); setError(null)
        if (!root || !requirementId) return
        let saved = null
        try { saved = JSON.parse(localStorage.getItem('alm.native-delivery.job') ?? 'null') } catch {}
        if (saved?.root === root && saved?.requirementId === requirementId) setJob({ jobId: saved.jobId, status: 'running', phase: 'reconnecting' })
      }, [scope])
      useEffect(() => {
        if (!job?.jobId || job.status !== 'running') return
        let active = true
        let timer
        const poll = async () => {
          try {
            const response = await fetch(`/api/alm/requirements/native-delivery?root=${encodeURIComponent(root)}&jobId=${encodeURIComponent(job.jobId)}`)
            const result = await response.json()
            if (!response.ok || !result.ok || !result.job) throw new Error(result.error?.message ?? '部署任务不可用')
            if (active && currentScope.current === scope) { setJob(result.job); setError(null) }
          } catch (failure) { if (active) setError(failure.message) }
          if (active) timer = setTimeout(poll, 2000)
        }
        poll()
        return () => { active = false; clearTimeout(timer) }
      }, [job?.jobId, job?.status, scope])
      const start = async () => {
        if (dispatching.current || !root || !requirementId || job?.status === 'running') return
        if (!window.confirm(`对 ${requirementId} 执行本机真实构建、受控重载、原登记验收重验与只读 GUI 检查？这不是验收签字或发布。`)) return
        dispatching.current = true; setBusy(true); setError(null)
        try {
          const response = await fetch('/api/alm/requirements/native-delivery', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ root, requirementId }) })
          const result = await response.json()
          if (!response.ok || !result.ok || !result.job?.jobId) throw new Error(result.error?.message ?? '无法启动原生部署')
          localStorage.setItem('alm.native-delivery.job', JSON.stringify({ root, requirementId, jobId: result.job.jobId }))
          if (currentScope.current === scope) setJob(result.job)
        } catch (failure) { if (currentScope.current === scope) setError(failure.message) }
        finally { dispatching.current = false; setBusy(false) }
      }
      return h('section', { 'data-native-delivery-control': 'true', style: { padding: 10, borderBottom: `1px solid ${T.line}`, flexShrink: 0 } },
        h('button', { type: 'button', disabled: busy || job?.status === 'running' || !root || !requirementId, onClick: start }, busy ? '正在请求部署…' : '构建、部署并验证本机 GUI'),
        job ? h('div', { role: 'status', 'data-native-delivery-status': job.status }, `${job.jobId} · ${job.status} · ${job.phase ?? ''}${job.error?.message ? ` · ${job.error.message}` : ''}`) : null,
        error ? h('div', { role: 'alert' }, error) : null,
        job?.status === 'passed' ? h('div', null, '本机部署验证通过；仍需独立人工验收与发布决策。') : null)
    }

    function Workbench({ openPanel, onOpenSession }) {
      const nativePageInstance = useRef(`requirements-${Date.now()}-${Math.random().toString(36).slice(2)}`)
      const storedRoot = typeof localStorage === 'undefined' ? '' : localStorage.getItem(ROOT_KEY) ?? ''
      const storedProject = typeof localStorage === 'undefined' ? '' : localStorage.getItem(PROJECT_KEY) ?? ''
      const [rootInput, setRootInput] = useState(storedRoot)
      const [root, setRoot] = useState(storedRoot)
      const [projectId, setProjectId] = useState(storedProject)
      const [projects, setProjects] = useState([])
      const [filter, setFilter] = useState(() => readV4Navigation().filter ?? DEFAULT_REQUIREMENT_VIEW)
      const [source, setSource] = useState(() => readV4Navigation().source ?? 'all')
      const [awaitingDefects, setAwaitingDefects] = useState([])
      const [defectSummary, setDefectSummary] = useState(null)
      const [defectInboxOpen, setDefectInboxOpen] = useState(false)
      const [defectTarget, setDefectTarget] = useState(null)
      const [confirmDefectTarget, setConfirmDefectTarget] = useState(null)
      const [monitoringOpen, setMonitoringOpen] = useState(false)
      const [defectToast, setDefectToast] = useState(null)
      const seenDefectFingerprints = useRef(readSeenDefectFingerprints())
      const [keyword, setKeyword] = useState(() => readV4Navigation().keyword ?? '')
      useEffect(() => { try { sessionStorage.setItem('alm.requirements.navigation.v4', JSON.stringify({ root, projectId, filter, source, keyword })) } catch {} }, [root, projectId, filter, source, keyword])
      const [selectedId, setSelectedId] = useState(() => { try { return sessionStorage.getItem('alm.requirements.detail.v4') || null } catch { return null } })
      const listFocus = useRef(null)
      const listScroll = useRef(null)
      const detailWasOpen = useRef(false)
      useEffect(() => {
        try { if (selectedId) sessionStorage.setItem('alm.requirements.detail.v4', selectedId); else sessionStorage.removeItem('alm.requirements.detail.v4') } catch {}
        if (!selectedId && detailWasOpen.current) setTimeout(() => listFocus.current?.isConnected && listFocus.current.focus?.({ preventScroll: true }), 0)
        detailWasOpen.current = Boolean(selectedId)
      }, [selectedId])
      const [pendingOpenId, setPendingOpenId] = useState(null)
      const [snapshot, setSnapshot] = useState(null)
      const [diff, setDiff] = useState(null)
      const [traceItem, setTraceItem] = useState(null)
      const [startItem, setStartItem] = useState(null)
      const [acceptanceItem, setAcceptanceItem] = useState(null)
      const [signoffItem, setSignoffItem] = useState(null)
      const [answerItem, setAnswerItem] = useState(null)
    const [releaseItem, setReleaseItem] = useState(null)
      const [aiReviewItem, setAiReviewItem] = useState(null)
      const [rehearsalItem, setRehearsalItem] = useState(null)
      const [archiveItem, setArchiveItem] = useState(null)
      const [removeItem, setRemoveItem] = useState(null)
      const [exchangeOpen, setExchangeOpen] = useState(false)
      const [createOpen, setCreateOpen] = useState(false)
      const [createdNotice, setCreatedNotice] = useState(null)
      const [associateTarget, setAssociateTarget] = useState(null)
      const [showRoot, setShowRoot] = useState(false)
      const [anomalyOpen, setAnomalyOpen] = useState(false)
      const [checkOpen, setCheckOpen] = useState(false)
      const [menuOpen, setMenuOpen] = useState(false)
      const menuRef = useRef(null)
      const projectSelectRef = useRef(null)
      const [feedbackContext, setFeedbackContext] = useState(null)
      const [folderNotice, setFolderNotice] = useState(null)
      const [narrow, setNarrow] = useState(typeof window !== 'undefined' ? window.innerWidth < 1120 : false)
      const [mobile, setMobile] = useState(typeof window !== 'undefined' ? window.innerWidth < 760 : false)
      const { loading, error, data, reload } = useRequirements({ root, projectId })

      const refreshRef = useRef(reload)
      refreshRef.current = reload
      const watchDelivery = Boolean(selectedId || startItem || (data?.requirements ?? []).some(entry => entry.run?.active || entry.delivery?.key === 'in-progress'))
      useEffect(() => {
        if (!watchDelivery || !(data?.root ?? root)) return
        let active = true, timer, pending = false
        const tick = async () => {
          if (!active || pending) return
          pending = true
          try { if (document.visibilityState !== 'hidden') await refreshRef.current({ silent: true }) }
          finally { pending = false; if (active) timer = setTimeout(tick, 3000) }
        }
        timer = setTimeout(tick, 3000)
        const onVisible = () => { if (!pending && document.visibilityState !== 'hidden') { clearTimeout(timer); timer = setTimeout(tick, 0) } }
        document.addEventListener('visibilitychange', onVisible)
        return () => { active = false; clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible) }
      }, [watchDelivery, data?.root, root, projectId])

      const workbenchRef = useRef(null)
      useEffect(() => {
        const node = workbenchRef.current
        if (!node || typeof ResizeObserver === 'undefined') return undefined
        // Desktop sidebars consume space without changing window.innerWidth.
        // Layout follows the actual panel, not the enclosing Electron window.
        const observer = new ResizeObserver(([entry]) => {
          setNarrow(entry.contentRect.width < 1060)
          setMobile(entry.contentRect.width < 680)
        })
        observer.observe(node)
        return () => observer.disconnect()
      }, [])

      // The defect ledger is a separate surface and a newer route: a missing
      // route (404), an old host or a broken response is silently "no ledger"
      // and never blocks the requirement list itself.
      const loadDefectLedger = useCallback(() => {
        const ledgerRoot = data?.root ?? root
        // No root yet (first paint / unset project): the ledger route would
        // reject it, and the list view already handles that state.
        if (!ledgerRoot) return
        writeJson('defect', { mode: 'summary' }, ledgerRoot)
          .then((payload) => {
            const summary = defectSummaryOf(payload)
            setDefectSummary(summary)
            if (!summary || !(Number(summary.awaitingConfirmation ?? 0) > 0)) {
              setAwaitingDefects([])
              return null
            }
            return writeJson('defect', { mode: 'list', status: 'awaiting-confirmation' }, ledgerRoot).then((listPayload) => {
              const defects = defectListOf(listPayload)
              setAwaitingDefects(defects)
              const fresh = defects.filter((entry) => entry?.fingerprint && !seenDefectFingerprints.current.has(entry.fingerprint))
              if (fresh.length === 0) return
              for (const entry of fresh) seenDefectFingerprints.current.add(entry.fingerprint)
              rememberDefectFingerprints(fresh.map((entry) => entry.fingerprint))
              setDefectToast({ defect: fresh[0], count: fresh.length })
            })
          })
          .catch(() => {
            setDefectSummary(null)
            setAwaitingDefects([])
          })
      }, [data?.root, root])

      useEffect(() => {
        loadDefectLedger()
      }, [loadDefectLedger, data])

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
        if (!data?.project || projectId === ALL_PROJECTS) return
        setProjectId((current) => (current === ALL_PROJECTS ? current : data.project))
        if (typeof localStorage !== 'undefined') localStorage.setItem(PROJECT_KEY, data.project)
      }, [data?.project, projectId === ALL_PROJECTS])

      const applyRoot = useCallback((value, preserveProject = false) => {
        setRoot(value)
        setSelectedId(null)
        if (!preserveProject) setProjectId('')
        if (typeof localStorage !== 'undefined') {
          if (value) localStorage.setItem(ROOT_KEY, value)
          else localStorage.removeItem(ROOT_KEY)
          if (!preserveProject) localStorage.removeItem(PROJECT_KEY)
        }
      }, [])

      const applyProject = (id) => {
        setSelectedId(null)
        setFilter(DEFAULT_REQUIREMENT_VIEW)
        setKeyword('')
        if (id === ALL_PROJECTS) {
          setProjectId(ALL_PROJECTS)
          if (typeof localStorage !== 'undefined') localStorage.setItem(PROJECT_KEY, ALL_PROJECTS)
          return
        }
        if (!id) {
          applyRoot('')
          setRootInput('')
          return
        }
        const project = projects.find((entry) => entry.id === id || entry.workspaceId === id)
        if (!project) return
        setProjectId(project.id)
        if (typeof localStorage !== 'undefined') localStorage.setItem(PROJECT_KEY, project.id)
        applyRoot(project.root ?? '', true)
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

      useEffect(() => {
        if (!menuOpen) return undefined
        const onKeyDown = (event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            setMenuOpen(false)
          }
        }
        const onPointerDown = (event) => {
          if (menuRef.current && !menuRef.current.contains(event.target)) setMenuOpen(false)
        }
        document.addEventListener('keydown', onKeyDown, true)
        document.addEventListener('mousedown', onPointerDown, true)
        return () => {
          document.removeEventListener('keydown', onKeyDown, true)
          document.removeEventListener('mousedown', onPointerDown, true)
        }
      }, [menuOpen])

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
      // A cross-workspace open switches the root first; once the new workspace
      // has loaded, select the requirement the user originally clicked.
      useEffect(() => {
        if (!pendingOpenId) return
        const target = items.find((entry) => entry.id === pendingOpenId || entry.uid === pendingOpenId)
        if (!target) return
        setSelectedId(keyOf(target))
        setPendingOpenId(null)
      }, [pendingOpenId, items])
      const scopedItems = items
      // Selection is by occurrenceKey, not by UID: duplicate UIDs are kept as
      // two records and must be selectable independently.
      const keyOf = (item) => item?.occurrenceKey ?? item?.id
      const needle = keyword.trim().toLowerCase()
      // Closed records stay readable but are out of the active funnel: the
      // default/全部 view lists open deliveries and the dedicated 已关闭 view
      // is the only place they surface.
      const activeItems = scopedItems.filter((item) => deliveryOf(item).key !== 'closed')
      // The anomaly view includes closed records too; it replaces the former
      // independent toggle so view + source + keyword are exactly three axes.
      const scopeItems = scopedItems
      // Source narrows the list before the work view does, so the tab counts
      // always describe what is currently visible on the source axis.
      const sourceItems = source === 'all' ? scopeItems : scopeItems.filter((item) => matchesSource(item, source))
      const keywordMatched = needle
        ? sourceItems.filter(
            (item) =>
              item.title.toLowerCase().includes(needle) ||
              item.id.toLowerCase().includes(needle) ||
              (item.businessId ?? '').toLowerCase().includes(needle) ||
              (item.owner ?? '').toLowerCase().includes(needle),
          )
        : sourceItems
      const counts = requirementViewCounts(data, keywordMatched)
      const searched = keywordMatched.filter((item) => matchesView(item, filter))
      const visible = searched
      const itemCount = activeItems.length
      const filtered = filter !== 'all' || keyword !== '' || source !== 'all'
      const clearFilters = () => {
        setFilter('all')
        setSource('all')
        setKeyword('')
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
      // A defect can arrive as a list row (item.defect), a linked requirement
      // (sources includes 'defect') or a bare ledger record (DEF-…). All three
      // open the same defect surface; the modal itself tolerates a record-only
      // payload when the requirement row is not loaded yet.
      const openDefect = (value) => {
        const record = defectRecord(value) ?? defectOf(value) ?? null
        const linkedItem =
          items.find((item) => (record?.requirement && item.id === record.requirement) || (value?.id && item.id === value.id)) ?? null
        setDefectInboxOpen(false)
        setDefectTarget({ defect: record, item: linkedItem ?? (isDefect(value) ? value : null) })
      }
      const awaitingDefectCount = Number(defectSummary?.awaitingConfirmation ?? awaitingDefects.length ?? 0)
      // INT-19: after a create, tell the user when the new requirement is
      // hidden by the current filter/keyword, without clearing their filter.
      const onIntentCreated = (result) => {
        if (result?.requirementId) setCreatedNotice({ requirementId: result.requirementId, awaiting: true })
        reload()
      }
      useEffect(() => {
        if (!createdNotice?.awaiting) return
        if (loading || !data) return
        // Sorting the payload is not enough when the user was reading lower
        // rows: reveal the new first row without moving keyboard focus or
        // clearing the user's query. Hidden results keep the filter guidance.
        if (listScroll.current) listScroll.current.scrollTop = 0
        setCreatedNotice((current) => (current && current.awaiting ? { ...current, awaiting: false } : current))
      }, [data, loading, createdNotice])
      const hasScope = projectId === ALL_PROJECTS || Boolean(root)
      const singleWorkspace = projectId !== ALL_PROJECTS && Boolean(root)
      const linked = Boolean(currentProject?.linked)
      const scopeText =
        projectId === ALL_PROJECTS
          ? data
            ? `${data.summary.projects} 个工作区`
            : '全部工作区'
          : !hasScope
            ? '请选择工作区或指定仓库根目录'
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

      // "Open repository folder" must really open it; when the host cannot,
      // say so instead of pretending.
      const openFolder = () => {
        const targetRoot = data?.root ?? root
        if (!targetRoot) {
          setFolderNotice({ ok: false, message: '还没有可打开的仓库根目录。' })
          return
        }
        writeJson('reveal', { root: targetRoot }, targetRoot)
          .then((payload) => {
            if (payload?.ok === false) throw new Error(payload?.error?.message ?? '打开目录失败')
            setFolderNotice({ ok: true, message: '已在系统文件管理器中打开：' + (payload?.root ?? targetRoot) })
          })
          .catch((error) => setFolderNotice({ ok: false, message: '无法打开目录：' + error.message + '（路径：' + targetRoot + '）' }))
      }

      // Feedback freezes whatever the workbench is showing right now. It reads
      // component state only: a click must not wait for a network round-trip.
      const freezeFeedbackContext = () => {
        const defect = selected ? defectOf(selected) : null
        const failure = selected?.run?.failure ?? null
        const rawError = error ? readableError(error) : failure?.message ?? null
        return {
          page: selected ? 'detail' : 'list',
          stage: defect?.impact?.stage ?? selected?.run?.phase ?? null,
          workspaceId: currentProject?.workspaceId ?? null,
          root: data?.root ?? root ?? null,
          projectId: currentProject?.projectId ?? currentProject?.project ?? null,
          requirementId: selected?.id ?? null,
          requirementRevision: selected?.revision ?? null,
          requirementFile: selected?.file ?? null,
          intentSessionId: null,
          runId: selected?.run?.id ?? null,
          candidateId: selected?.candidate?.id ?? null,
          recentError: rawError ? feedbackMaskPaths(rawError).slice(0, 600) : null,
          frozenAt: Date.now(),
        }
      }

      // Opening feedback from inside a modal/drawer passes a label for the
      // layer that covers the toolbar, so the report says where it happened.
      const openFeedback = (overlay) => {
        setMenuOpen(false)
        // Freeze now, then let the calling layer name the exact object it is
        // about (a modal can be showing a run or a decision, not `selected`).
        const explicit = { ...(overlay?.context ?? {}) }
        for (const key of ['requirementId', 'requirementRevision', 'requirementFile', 'runId', 'candidateId', 'intentSessionId', 'acceptanceDecisionId', 'failureIds', 'stage']) {
          if (overlay?.[key] != null && explicit[key] == null) explicit[key] = overlay[key]
        }
        const next = { ...freezeFeedbackContext(), ...explicit }
        if (overlay && overlay.kind) {
          next.overlay = {
            kind: overlay.kind,
            label: overlay.label ?? null,
            requirementId: overlay.requirementId ?? next.requirementId ?? null,
          }
          // Detail tab the report was launched from; the feedback drawer folds
          // this into ui.viewState.tab (whitelisted, no endpoint change).
          if (['requirement', 'delivery', 'record'].includes(overlay.tab)) next.overlay.tab = overlay.tab
        }
        setFeedbackContext(next)
      }
      // Registered during render so any overlay mounted below can reach it.
      FEEDBACK_LAUNCHER = openFeedback

      const menuItem = (label, icon, onClick, extra, attrs) =>
        h(
          'button',
          {
            type: 'button',
            role: 'menuitem',
            ...(attrs ?? {}),
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
        { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '20px', flexWrap: 'wrap', paddingTop: '26px' } },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0, flexWrap: 'wrap' } },
          h('div', { style: { display: 'flex', alignItems: 'baseline', gap: '10px' } },
            h('h1', { style: { margin: 0, fontSize: '28px', lineHeight: 1.2, fontWeight: 600, letterSpacing: '-.025em' } }, '需求'),
            h('span', { style: { color: T.text2, fontSize: '12px', fontVariantNumeric: 'tabular-nums' } }, countLabel),
          ),
          h('span', { 'aria-hidden': 'true', style: { width: '1px', height: '28px', background: T.line } }),
          h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '4px', minWidth: 0 } },
            h(ProjectPicker, { projects, currentId: projectId, onPick: applyProject, selectRef: projectSelectRef }),
            h('span', { style: { color: T.text2, fontSize: '11px', lineHeight: 1.4, overflowWrap: 'anywhere' } }, scopeText),
          ),
        ),
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
          h('button', { disabled: !singleWorkspace, onClick: () => setExchangeOpen(true), title: 'JSON / Excel安全交换' }, '导入 / 导出'),
          h(ActionButton, {
            label: '新建需求',
            icon: 'plus',
            variant: 'primary',
            disabled: !singleWorkspace,
            onClick: createRequirement,
            title: singleWorkspace ? '先澄清意图，再保存需求' : '切换到单个工作区后可新建需求',
          }),
        ),
      )

      // Tabs use the roving-tabindex keyboard pattern: arrows move both focus
      // and selection, Home/End jump to the ends. The list is reachable with
      // the keyboard alone, without inventing a second navigation model.
      const onFilterKeyDown = (event) => {
        const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
        if (step === 0 && event.key !== 'Home' && event.key !== 'End') return
        const current = Math.max(0, FILTERS.findIndex(([id]) => id === filter))
        const next =
          event.key === 'Home' ? 0 : event.key === 'End' ? FILTERS.length - 1 : (current + step + FILTERS.length) % FILTERS.length
        event.preventDefault()
        setFilter(FILTERS[next][0])
        event.currentTarget.querySelectorAll('[role="tab"]')[next]?.focus()
      }

      const toolbar = h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            margin: '0 0 12px',
            padding: '14px 0 12px',
            borderBottom: `1px solid ${T.line}`,
            flexWrap: 'wrap',
            background: T.base,
          },
        },
        h(
          'div',
          { role: 'tablist', 'aria-label': '按交付视图筛选', 'data-work-views': 'true', style: { display: 'flex', alignItems: 'stretch', gap: '4px', width: '100%', minWidth: 0, overflowX: 'auto', borderBottom: `1px solid ${T.line}`, paddingBottom: '4px', marginBottom: '4px' }, onKeyDown: onFilterKeyDown },
          FILTERS.map(([id, label]) => {
            const active = filter === id
            return h(
              'button',
              {
                key: id,
                type: 'button',
                role: 'tab',
                'aria-selected': active,
                tabIndex: active ? 0 : -1,
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
              h('span', { style: { marginLeft: '6px', color: active ? T.text2 : T.text3, fontSize: '11px', fontVariantNumeric: 'tabular-nums' } }, counts[id]),
            )
          }),
        ),
        // Source is a second, orthogonal axis: a defect-born requirement keeps
        // its work view (待处理/推进中/…) and is separable by origin.
        h(
          'div',
          {
            role: 'group',
            'aria-label': '按来源筛选',
            style: { display: 'flex', alignItems: 'center', gap: '2px', flexWrap: 'wrap', padding: '3px', background: T.layer, borderRadius: '8px' },
          },
          h('span', { style: { color: T.text3, fontSize: '11px', marginRight: '2px' } }, '来源'),
          SOURCE_FILTERS.map(([id, label]) => {
            const active = source === id
            return h(
              'button',
              {
                key: id,
                type: 'button',
                'data-source': id,
                'aria-pressed': active,
                onClick: () => setSource(id),
                style: {
                  border: 0,
                  borderRadius: '6px',
                  background: active ? T.layer2 : 'transparent',
                  color: active ? T.text : T.text2,
                  padding: '6px 9px',
                  fontSize: '11.5px',
                  fontWeight: active ? 500 : 400,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                },
              },
              label,
            )
          }),
        ),
        awaitingDefectCount > 0
          ? h(
              'button',
              {
                type: 'button',
                'data-defect-inbox': 'true',
                onClick: () => setDefectInboxOpen(true),
                title: '失败监控发现、尚未确认的缺陷需求',
                style: {
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  marginLeft: '6px',
                  border: `1px solid ${T.warn}`,
                  background: 'transparent',
                  color: T.warn,
                  borderRadius: '999px',
                  padding: '3px 10px 3px 8px',
                  fontSize: '11.5px',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                },
              },
              h(ActionIcon, { name: 'alert', size: 12 }),
              `待确认缺陷 ${awaitingDefectCount}`,
            )
          : null,
        h('div', { style: { flex: 1, minWidth: '12px' } }),
        filtered
          ? h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
              h(
                'span',
                { role: 'status', 'aria-live': 'polite', style: { color: T.text3, fontSize: '11.5px', fontVariantNumeric: 'tabular-nums' } },
                `${visible.length} 条结果`,
              ),
              h(
                'button',
                {
                  type: 'button',
                  onClick: clearFilters,
                  title: '重置全部查询条件',
                  'aria-label': '重置全部查询条件',
                  style: { border: `1px solid ${T.line}`, background: 'transparent', color: T.text2, borderRadius: '6px', padding: '3px 8px', fontSize: '11.5px', cursor: 'pointer' },
                },
                '重置',
              ),
            )
          : null,
        h(
          'label',
          { 'data-requirements-search': 'true', style: { display: 'flex', alignItems: 'center', gap: '7px', height: '36px', width: mobile ? '100%' : '250px', maxWidth: '100%', border: `1px solid ${T.line}`, borderRadius: '8px', background: T.layer, padding: '0 10px' } },
          h('span', { style: { display: 'inline-flex', flex: '0 0 auto', alignItems: 'center', justifyContent: 'center', width: '14px', height: '14px', color: T.text3 } }, h(ActionIcon, { name: 'search', size: 14 })),
          h('input', {
            value: keyword,
            onChange: (event) => setKeyword(event.target.value),
            placeholder: '搜索标题、需求 ID 或负责人',
            'aria-label': '搜索标题、需求 ID 或负责人',
            style: { border: 0, outline: 0, background: 'transparent', color: T.text, fontSize: '12px', flex: '1 1 auto', minWidth: 0, width: '100%' },
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
          { style: { position: 'relative' }, ref: menuRef },
          h(ActionButton, { label: '更多', icon: 'more', variant: 'ghost', onClick: () => setMenuOpen((value) => !value), title: '更多工具', 'aria-haspopup': 'menu', 'aria-expanded': menuOpen }),
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
                menuItem('打开仓库目录', 'folder', openFolder),
                menuItem('指定根目录', 'folder', () => setShowRoot(true)),
                menuItem('失败监控设置', 'alert', () => setMonitoringOpen(true)),
                menuItem('反馈与建议', 'message', () => openFeedback(), null, { 'data-feedback-entry': 'true' }),
                openPanel ? menuItem('在工作台打开', 'eye', openPanel) : null,
              )
            : null,
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
                    clearFilters()
                    setCreatedNotice(null)
                  },
                },
                '清除筛选查看',
              ),
            )
          : null

      // Duplicate UIDs are two records; the count comes from the real data.
      const duplicateCounts = {}
      for (const item of scopedItems) duplicateCounts[item.id] = (duplicateCounts[item.id] ?? 0) + 1

      let body
      // Only the table lives in the fixed-height scroller: the header row
      // sticks to its top, so column titles stay visible and the page itself
      // never scrolls. Loading/error/empty are standalone cards.
      let tableInScroller = false
      if (!hasScope) {
        body = h(ProjectContextPrompt, { selectRef: projectSelectRef })
      } else if (loading && !data) {
        body = h(SkeletonTable, { narrow, mobile })
      } else if (error && !data) {
        body = h(
          'div',
          { style: { border: `1px solid ${T.line}`, borderRadius: '12px', background: T.layer, padding: '28px' } },
          h('p', { style: { margin: '0 0 6px', color: T.text, fontSize: '14px', fontWeight: 600 } }, '读取需求失败'),
          h('p', { style: { margin: '0 0 16px', color: T.err, fontSize: '12.5px', lineHeight: 1.7 } }, readableError(error)),
          h(ActionButton, { label: '重试', icon: 'refresh', variant: 'secondary', onClick: reload }),
        )
      } else if (scopedItems.length === 0) {
        body = h(EmptyState, { root: data?.root ?? root, onCreate: createRequirement, onOpenPanel: openPanel })
      } else {
        tableInScroller = true
        body = h(RequirementTable, {
          items: visible,
          narrow,
          mobile,
          showProject: data?.scope === 'all',
          contained: true,
          stickyTop: 0,
          selectedKey: selectedId,
          duplicateCounts,
          onAiReview: (entry) => setAiReviewItem(entry),
          onAcceptance: (entry) => setAcceptanceItem(entry),
          onSignoff: (entry) => setSignoffItem(entry),
          onOpen: (entry) => { listFocus.current = document.activeElement; setSelectedId(keyOf(entry)) },
          onDefect: (entry) => openDefect(entry),
          onArchive: (entry) => setArchiveItem(entry),
          onRemove: (entry) => setRemoveItem(entry),
          emptyNode: h(NoResults, { filter, keyword, source, onClear: clearFilters }),
        })
      }

      const notices = h(
        'div',
        null,
        folderNotice
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
                  borderColor: folderNotice.ok ? T.line2 : T.err,
                  background: folderNotice.ok ? T.layer2 : EVIDENCE_TONE.warn.bg,
                },
              },
              h('span', { style: { fontSize: '12.5px', color: T.text2 } }, folderNotice.message),
              h('button', { type: 'button', style: button, onClick: () => setFolderNotice(null) }, '知道了'),
            )
          : null,
        error && data
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
                  borderColor: T.err,
                  background: EVIDENCE_TONE.warn.bg,
                },
              },
              h('span', { style: { fontSize: '12.5px', color: T.text2 } }, '刷新失败：' + readableError(error)),
              h('button', { type: 'button', style: button, onClick: reload }, '重试'),
            )
          : null,
        h(AnomalyNotice, {
          anomalies: data?.anomalies,
          summary: data?.anomalySummary,
          expanded: anomalyOpen,
          anomalyOnly: filter === 'anomalies',
          onToggleExpanded: () => setAnomalyOpen((value) => !value),
          onToggleOnly: () => setFilter((value) => value === 'anomalies' ? 'all' : 'anomalies'),
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
        { ref: workbenchRef, style: { ...panel, ...(mobile ? { paddingLeft: '16px', paddingRight: '16px', overflowY: 'auto' } : {}) }, 'data-requirements-workbench': 'true', 'data-native-delivery-identity': 'true', 'data-source-build-id': NATIVE_SOURCE_BUILD_ID, 'data-client-build-id': NATIVE_CLIENT_BUILD_ID, 'data-page-instance': nativePageInstance.current },
        h('style', null, `
          [data-requirements-workbench] button:focus-visible, [role="dialog"] button:focus-visible, [role="dialog"] input:focus-visible, [role="dialog"] textarea:focus-visible, [role="dialog"] select:focus-visible { outline: 2px solid ${T.brand}; outline-offset: 3px; }
          [data-requirements-search]:focus-within { outline: 2px solid ${T.brand}; outline-offset: 2px; }
          [role="dialog"] [data-intent-screen-heading]:focus { outline: 2px solid ${T.brand}; outline-offset: 3px; }
          [data-list-scroll]:focus-visible { outline: 2px solid ${T.brand}; outline-offset: 2px; }
          [data-requirements-workbench] button { transition: background-color 120ms ease, color 120ms ease; }
          [data-work-views] button { flex-shrink: 0; }
          @media (max-width: 760px) { [data-requirements-search] { width: 100% !important; } }
          @media (max-height: 620px) { [data-requirements-workbench] { overflow-y: auto !important; } }
          @media (max-width: 760px) { [data-requirements-workbench] { padding-left: 16px !important; padding-right: 16px !important; overflow-y: auto !important; } }
          [role="dialog"] [role="button"]:focus-visible { outline: 2px solid ${T.brand}; outline-offset: 3px; }
          @media (prefers-reduced-motion: reduce) { [data-requirements-workbench] button { transition: none; } }
        `),
        h('div', { 'data-requirements-list-page': 'true', style: { display: selected ? 'none' : 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 } },
        header,
        showRoot ? h(RootPicker, { rootInput, setRootInput, onApply: () => applyRoot(rootInput), onReset: () => { setRootInput(''); applyRoot('') } }) : null,
        toolbar,
        createdBanner,
        // Notices stay above the list and never push it off screen.
        h('div', { style: { flex: '0 0 auto', maxHeight: '38vh', overflowY: 'auto' } }, notices),
        h(
          'div',
          { style: listArea },
          tableInScroller
            ? h('div', { ref: listScroll, role: 'region', 'aria-label': '需求列表', tabIndex: 0, style: listScroller, 'data-list-scroll': 'true' }, body)
            : h('div', { style: { flex: '1 1 auto', minHeight: 0, overflowY: 'auto' } }, body),
        ),
        ),
        selected
          ? h(Drawer, {
              item: selected,
              onOpenSession,
              onFeedback: openFeedback,
              allItems: items,
              projectMeta: projectMetaFor(selected),
              root: data?.root ?? root,
              onClose: () => setSelectedId(null),
              onSnapshot: openSnapshot,
              onDiff: openDiff,
              onTrace: (entry) => setTraceItem(entry),
              onDefect: openDefect,
              onStart: async (entry, options) => {
                try {
                  const targetRoot = entry.root ?? data?.root ?? root
                  const decision = await writeJson('run', { mode: 'decision', requirementId: entry.id }, targetRoot)
                  if (decision?.decision) { setAnswerItem(entry); return }
                  if (decision?.exists) {
                    const result = await writeJson('run', { mode: 'continue', requirementId: entry.id }, targetRoot)
                    if (result?.resumed !== true) throw new Error(result?.message ?? '运行未继续')
                    if (result?.autoAdvanceResumed === false) window.alert(`已继续本轮，但自动推进未恢复（${result.autoAdvanceReason}）。需在原生界面检查版本与执行预算；未新增授权。`)
                    await reload()
                    return
                  }
                  setStartItem({ item: entry, isolate: options?.isolate === true })
                } catch (error) { window.alert(`开始修复失败：${error.message}`) }
              },
              onAcceptance: (entry) => setAcceptanceItem(entry),
              onSignoff: (entry) => setSignoffItem(entry),
              onRelease: (entry) => setReleaseItem(entry),
              onAiReview: (entry) => setAiReviewItem(entry),
              onRehearsal: (entry) => setRehearsalItem(entry),
              onArchive: (entry) => setArchiveItem(entry),
              onRemove: (entry) => setRemoveItem(entry),
              onRefresh: () => reload(),
              onCancelRun: (entry) => {
                if (!window.confirm(`取消 ${entry.id} 的本轮推进？工作区改动与记录会保留。`)) return
                writeJson('run', { mode: 'cancel', requirementId: entry.id, reason: '人类在需求面板取消本轮推进' }, entry.root ?? data?.root ?? root)
                  .then(() => reload())
                  .catch((error) => window.alert(`取消失败：${error.message}`))
              },
              onAnswer: (entry) => setAnswerItem(entry),
              onContinueRun: (entry) => {
                writeJson('run', { mode: 'continue', requirementId: entry.id }, entry.root ?? data?.root ?? root)
                  .then((result) => {
                    if (result?.resumed !== true) throw new Error(result?.message ?? '运行尚未继续，请刷新后检查当前状态')
                    if (result?.autoAdvanceResumed === false) window.alert(`已继续本轮，但自动推进未恢复（${result.autoAdvanceReason}）。需在原生界面检查版本与执行预算；未新增授权。`)
                    return reload()
                  })
                  .catch((error) => window.alert(`继续失败：${error.message}`))
              },
              onResumeRun: (entry) => {
                if (!window.confirm(`恢复 ${entry.id} 的本轮推进？会新建一次运行并从上次检查点继续。`)) return
                writeJson('run', { mode: 'restart', requirementId: entry.id }, root)
                  .then((payload) => {
                    if (payload?.restarted !== true) window.alert(payload?.message ?? '未能恢复推进')
                    return reload()
                  })
                  .catch((error) => window.alert(`恢复失败：${error.message}`))
              },

              narrow,
            })
          : null,
        defectInboxOpen
          ? h(DefectInbox, {
              root: data?.root ?? root,
              initial: awaitingDefects,
              onOpen: (entry) => openDefect(entry),
              onSettings: () => {
                setDefectInboxOpen(false)
                setMonitoringOpen(true)
              },
              onClose: () => setDefectInboxOpen(false),
            })
          : null,
        defectTarget
          ? h(DefectModal, {
              defect: defectTarget.defect,
              item: defectTarget.item,
              root: defectTarget.item?.root ?? data?.root ?? root,
              onClose: () => setDefectTarget(null),
              onConfirm: (record) => {
                // The confirmation dialog replaces the detail dialog instead
                // of stacking a second backdrop on top of it.
                const next = {
                  defect: record ?? defectTarget.defect,
                  item: defectTarget.item,
                  root: defectTarget.item?.root ?? data?.root ?? root,
                }
                setDefectTarget(null)
                setConfirmDefectTarget(next)
              },
              onSettings: () => {
                setDefectTarget(null)
                setMonitoringOpen(true)
              },
              onDone: () => {
                reload()
                loadDefectLedger()
              },
            })
          : null,
        confirmDefectTarget
          ? h(ConfirmDefectModal, {
              defect: confirmDefectTarget.defect,
              item: confirmDefectTarget.item,
              root: confirmDefectTarget.root,
              onClose: () => setConfirmDefectTarget(null),
              onDone: () => {
                setConfirmDefectTarget(null)
                setDefectTarget(null)
                reload()
                loadDefectLedger()
              },
            })
          : null,
        monitoringOpen ? h(MonitoringPanel, { root: data?.root ?? root, onClose: () => setMonitoringOpen(false) }) : null,
        feedbackContext
          ? h(FeedbackDrawer, {
              root: data?.root ?? root,
              context: feedbackContext,
              returnFocus: menuRef.current?.querySelector('button') ?? null,
              onClose: () => setFeedbackContext(null),
              onOpenRequirement: (id, ref) => {
                setFeedbackContext(null)
                setFilter('all')
                setSource('all')
                setKeyword('')
                        // Full reference: if the linked requirement lives in another
                // workspace, switch there before selecting it instead of
                // pretending it is an item of the current list.
                const targetRoot = typeof ref?.root === 'string' ? ref.root : ''
                const currentRoot = data?.root ?? root ?? ''
                const normalise = (value) => String(value ?? '').replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()
                if (targetRoot && normalise(targetRoot) !== normalise(currentRoot)) {
                  setPendingOpenId(id)
                  applyRoot(targetRoot)
                  return
                }
                openRequirementById(id)
                reload()
              },
            })
          : null,
        defectToast
          ? h(DefectToast, {
              toast: defectToast,
              onOpen: (entry) => {
                setDefectToast(null)
                openDefect(entry)
              },
              onClose: () => setDefectToast(null),
            })
          : null,
        snapshot ? h(SnapshotModal, { snapshot, onClose: () => setSnapshot(null) }) : null,
        diff ? h(DiffModal, { state: diff, onClose: () => setDiff(null) }) : null,
        startItem
          ? h(PreflightModal, {
              item: (data?.requirements ?? []).find(entry => entry.id === startItem.item.id && (!entry.root || entry.root === (startItem.item.root ?? data?.root ?? root))) ?? startItem.item,
              root: startItem.item.root ?? data?.root ?? root,
              projectMeta: projectMetaFor(startItem.item),
              isolate: startItem.isolate,
              onClose: () => setStartItem(null),
              onStarted: () => reload(),
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
        answerItem
          ? h(AnswerRunModal, {
              item: answerItem,
              root: answerItem.root ?? data?.root ?? root,
              onClose: () => setAnswerItem(null),
              onDone: () => reload(),
            })
          : null,
        signoffItem
          ? h(SignoffModal, {
              item: (data?.requirements ?? []).find(entry => entry.id === signoffItem.id && (!entry.root || entry.root === (signoffItem.root ?? data?.root ?? root))) ?? signoffItem,
              root: signoffItem.root ?? data?.root ?? root,
              onClose: () => setSignoffItem(null),
              onDone: () => reload(),
            })
          : null,
        releaseItem
          ? h(ReleaseModal, {
              item: releaseItem,
              root: releaseItem.root ?? data?.root ?? root,
              onClose: () => setReleaseItem(null),
              onDone: () => reload(),
            })
          : null,
        rehearsalItem
          ? h(
              ModalBoundary,
              { key: rehearsalItem.id, onClose: () => setRehearsalItem(null) },
              h(RehearsalModal, {
                item: rehearsalItem,
                root: rehearsalItem.root ?? data?.root ?? root,
                onClose: () => setRehearsalItem(null),
                onDone: () => reload(),
              }),
            )
          : null,
        archiveItem
          ? h(ArchiveModal, {
              item: archiveItem,
              root: archiveItem.root ?? data?.root ?? root,
              onClose: () => setArchiveItem(null),
              onDone: () => {
                setArchiveItem(null)
                setSelectedId(null)
                reload()
              },
            })
          : null,
        removeItem
          ? h(RemoveModal, {
              item: removeItem,
              root: removeItem.root ?? data?.root ?? root,
              onClose: () => setRemoveItem(null),
              onDone: () => {
                setRemoveItem(null)
                setSelectedId(null)
                reload()
              },
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
        exchangeOpen ? h(ExchangeModal, { root: data?.root ?? root, onClose: () => setExchangeOpen(false), onApplied: reload }) : null,
        createOpen
          ? h(IntentModal, {
              root: data?.root ?? root,
              project: data?.project ?? currentProject?.projectId,
              projectName: data?.projectName ?? currentProject?.name,
              projectId: data?.project ?? currentProject?.projectId ?? null,
              onClose: () => setCreateOpen(false),
              onCreated: onIntentCreated,
              onOpenRequirement: (id) => {
                setCreateOpen(false)
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
          const workspace = ctx.get?.('uiWorkspace')
          return h(Workbench, { openPanel: () => ctx.layout.selectPanel('requirements'), onOpenSession: typeof workspace?.openSession === 'function' ? id => workspace.openSession(id) : undefined })
        }
        function MainPage() {
          const workspace = ctx.get?.('uiWorkspace')
          return h(Workbench, { onOpenSession: typeof workspace?.openSession === 'function' ? id => workspace.openSession(id) : undefined })
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
