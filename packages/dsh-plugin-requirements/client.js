window.__ModuleLoader__.load({
  id: '@ai-alm/dsh-plugin-requirements',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback } = React

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

    function ReviewBlock({ review }) {
      if (!review) return h('p', { style: { margin: 0, ...muted } }, '暂无评审数据。')
      const summary = review.summary
      return h(
        'div',
        null,
        h(
          'p',
          { style: { margin: '0 0 8px', fontSize: '12.5px', color: summary.blockers > 0 ? T.err : T.text2 } },
          `${summary.completed}/${summary.total} 角色完成 · ${summary.blockers} 个阻塞`,
          summary.ready ? h('span', { style: { color: T.ok } }, ' · 无阻塞，可进入人工签收') : h('span', null, ' · 先修复阻塞项'),
        ),
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: '5px' } },
          review.roles.map((role) =>
            h(
              'div',
              {
                key: role.id,
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '10px',
                  border: `1px solid ${T.line}`,
                  borderRadius: '8px',
                  padding: '6px 10px',
                  fontSize: '12.5px',
                  color: T.text2,
                },
              },
              h('span', null, role.label),
              h(VerdictBadge, { verdict: role.verdict }),
            ),
          ),
        ),
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
      const submit = () => {
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
            state.result ? null : h('button', { key: 'sign', style: primary, onClick: submit, disabled: state.loading }, state.loading ? '签收中…' : '确认签收'),
          ],
        },
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
      meta.push(`验收 ${item.verifiedBy?.length ?? 0} 项`)
      if (item.attachments) meta.push(`${item.attachments} 个附件`)
      if (item.sources?.length) meta.push(item.sources.join(' / '))
      if (item.github?.board?.status) meta.push(`看板 ${item.github.board.status}`)
      if (item.review?.summary?.blockers > 0) meta.push(`${item.review.summary.blockers} 个评审阻塞`)

      return h(
        'article',
        {
          style: card,
          role: 'button',
          tabIndex: 0,
          'data-req': item.id,
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

    function DrawerContent({ item, allItems, projectMeta, root, onDetail, onClose, onSnapshot, onTrace, onStart, onAccept, onAcceptance, onDiff, onReview, onSignoff, compact }) {
      const relations = relationsOf(item, allItems)
      return h(
        'div',
        { style: { padding: compact ? '24px 26px 32px' : '28px 30px 40px' } },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
          h(Pill, { status: item.status }),
          h('span', { style: { color: T.text3, fontSize: '11.5px' } }, item.id),
          h(
            'span',
            { style: { color: T.text3, fontSize: '11px', border: `1px solid ${T.line}`, borderRadius: '5px', padding: '0 5px' } },
            `v${item.revision ?? 1}`,
          ),
          h('span', { style: { marginLeft: 'auto' } }, h('button', { style: { ...button, borderColor: 'transparent', background: 'transparent', color: T.text2 }, onClick: onClose, 'aria-label': '关闭' }, '×')),
        ),
        h('h2', { style: { margin: '12px 0 0', fontSize: '21px', lineHeight: 1.4, letterSpacing: '-.01em' } }, item.title),
        h(
          'p',
          { style: { margin: '8px 0 0', ...muted } },
          [item.owner, item.priority, `${item.projectName ?? item.project ?? '未归属项目'}${item.project ? `（${item.project}）` : ''}`].filter(Boolean).join(' · '),
        ),

        h(Section, { title: '背景与来源' },
          item.briefText
            ? renderBrief(item.briefText)
            : h('p', { style: { margin: 0, color: T.text2, fontSize: '13px', lineHeight: 1.8 } }, item.brief ? `见 ${item.brief}` : '未填写背景。'),
        ),
        item.sources?.length ? h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px' } }, item.sources.map((source) => h(Chip, { key: source }, `来源 · ${source}`))) : null,
        h(Attachments, { item }),

        h(Section, { title: '评审', action: h('div', { style: { display: 'flex', gap: '10px' } }, h('button', { style: { border: 0, background: 'transparent', color: T.text2, padding: 0, fontSize: '11.5px', cursor: 'pointer' }, onClick: () => onReview(item) }, '运行评审'), h('button', { style: { border: 0, background: 'transparent', color: T.text2, padding: 0, fontSize: '11.5px', cursor: 'pointer' }, onClick: () => onSignoff(item) }, '人工签收')) }, h(ReviewBlock, { review: item.review })),

        h(Section, { title: '验收覆盖' },
          (item.verifiedBy ?? []).length
            ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '0' } }, item.verifiedBy.map((id) => h('div', { key: id, style: { ...row, color: T.text } }, h('span', { style: { color: T.ok } }, '✓'), id)))
            : h('p', { style: { margin: 0, color: T.warn, fontSize: '12.5px' } }, '没有 verified_by，COV-001 会失败。'),
        ),

        h(
          Section,
          {
            title: '验收执行',
            action: h('button', { style: { border: 0, background: 'transparent', color: T.text2, padding: 0, fontSize: '11.5px', cursor: 'pointer' }, onClick: () => onAcceptance(item) }, '运行需求验收 ›'),
          },
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
                        `${item.acceptance.latest.result} · ${item.acceptance.latest.headSha.slice(0, 8)}${item.acceptance.latest.current ? ' · 当前提交' : ' · 历史提交'}`,
                      )
                    : h('span', { style: muted }, '尚未运行'),
                ),
              )
            : h('p', { style: { margin: 0, ...muted } }, '未登记验收命令（.alm/acceptance/<REQ>.json，白名单 node / npm / pnpm）。'),
        ),

        h(Section, { title: '关系', action: h(TraceLink, { onClick: () => onTrace(item) }) },
          relations.length
            ? h('div', null, relations.map(([label, ids]) => h('div', { key: label, style: row }, h('span', { style: rowLabel }, label), h('span', { style: { color: T.text } }, ids.join('、')))))
            : h('p', { style: { margin: 0, ...muted } }, '暂无关系。'),
        ),

        h(Section, { title: 'GitHub 归属' }, h(GithubBlock, { item, projectMeta })),

        h(Section, { title: '历史' }, h(VersionList, { item, onSnapshot, onDiff })),

        h('details', { style: { marginTop: '22px', borderTop: `1px solid ${T.line}`, paddingTop: '12px' } },
          h('summary', { style: { cursor: 'pointer', color: T.text2, fontSize: '12.5px' } }, '技术详情'),
          h('div', { style: { marginTop: '10px', color: T.text2, fontSize: '12px', lineHeight: 1.9 } },
            h('div', null, h('code', { style: { color: T.text } }, `${item.file}${item.line ? `:${item.line}` : ''}`)),
            item.brief ? h('div', null, '简报：', h('code', { style: { color: T.text } }, item.brief)) : null,
            h('div', null, `门禁提示词：${item.nextActionLabel ?? item.nextAction}`),
          ),
          h(CopyPrompt, { text: nextPrompt(item, root) }),
        ),

        h('div', { style: { display: 'flex', gap: '10px', marginTop: '22px', flexWrap: 'wrap' } },
          h('button', { style: primary, onClick: () => onStart(item) }, '开始开发'),
          h('button', { style: button, onClick: () => onAccept(item) }, '运行门禁检查'),
          h('button', { style: button, onClick: () => onDetail(item) }, '查看详情'),
          onClose ? h('button', { style: button, onClick: onClose }, '关闭') : null,
        ),
      )
    }

    function Drawer({ item, allItems, projectMeta, root, onClose, onDetail, onSnapshot, onTrace, onStart, onAccept, onAcceptance, onDiff, onReview, onSignoff }) {
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
              width: '560px',
              maxWidth: '94vw',
              overflowY: 'auto',
              background: T.base,
              borderLeft: `1px solid ${T.line}`,
              boxShadow: '-24px 0 60px rgba(0,0,0,.4)',
            },
          },
          h(DrawerContent, { item, allItems, projectMeta, root, onDetail, onClose, onSnapshot, onTrace, onStart, onAccept, onAcceptance, onDiff, onReview, onSignoff, compact: true }),
        ),
      )
    }

    function DetailModal({ item, allItems, projectMeta, root, onClose, onSnapshot, onTrace, onStart, onAccept, onAcceptance, onDiff, onReview, onSignoff }) {
      useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape') onClose()
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
      }, [onClose])
      const relations = relationsOf(item, allItems)
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
              h(Section, { title: `验收标准（${item.verifiedBy?.length ?? 0}）` },
                (item.verifiedBy ?? []).length
                  ? h('div', null, item.verifiedBy.map((id) => h('div', { key: id, style: { ...row, color: T.text } }, h('span', { style: { color: T.ok } }, '✓'), id)))
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
              h(Section, { title: '评审', action: h('div', { style: { display: 'flex', gap: '8px' } }, h('button', { style: { border: 0, background: 'transparent', color: T.text2, padding: 0, fontSize: '11.5px', cursor: 'pointer' }, onClick: () => onReview(item) }, '运行评审'), h('button', { style: { border: 0, background: 'transparent', color: T.text2, padding: 0, fontSize: '11.5px', cursor: 'pointer' }, onClick: () => onSignoff(item) }, '签收')) }, h(ReviewBlock, { review: item.review })),
              h(
                Section,
                {
                  title: '验收执行',
                  action: h('button', { style: { border: 0, background: 'transparent', color: T.text2, padding: 0, fontSize: '11.5px', cursor: 'pointer' }, onClick: () => onAcceptance(item) }, '运行 ›'),
                },
                item.acceptance?.registered
                  ? h('p', { style: { margin: 0, fontSize: '12.5px', color: T.text2 } },
                      `${item.acceptance.commandCount} 条命令`,
                      item.acceptance.latest
                        ? ` · 最近 ${item.acceptance.latest.result}${item.acceptance.latest.current ? '（当前提交）' : '（历史提交）'}`
                        : ' · 尚未运行',
                    )
                  : h('p', { style: { margin: 0, ...muted } }, '未登记验收命令。'),
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
            h('button', { style: primary, onClick: () => onStart(item) }, '开始开发'),
            h('button', { style: button, onClick: () => onAcceptance(item) }, '运行需求验收'),
            h('button', { style: button, onClick: () => onAccept(item) }, '运行门禁检查'),
            h('button', { style: button, onClick: onClose }, '关闭'),
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

    function postJson(path, body, root) {
      return fetch(`/api/alm/${path}?root=${encodeURIComponent(root)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }).then(async (response) => {
        const payload = await response.json().catch(() => null)
        if (!response.ok || payload?.ok === false) {
          throw new Error(payload?.error?.message ?? `HTTP ${response.status}`)
        }
        return payload
      })
    }

    function writeJson(path, body, root) {
      return postJson(`requirements/${path}`, body, root)
    }

    function ModalShell({ title, lead, onClose, children, footer, width = '720px' }) {
      useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape') onClose()
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
      }, [onClose])
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
                  ['提交', evidence.headSha.slice(0, 12)],
                  ['证据', result.evidencePath],
                ],
              }),
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

    function CreateModal({ root, project, projectName, onClose, onCreated }) {
      const [form, setForm] = useState({ title: '', brief: '', priority: 'P1', owner: '' })
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
      const runIntake = (body) => {
        setIntake({ loading: true, error: null, data: null })
        writeJson('intake', body, root)
          .then((data) => setIntake({ loading: false, error: null, data }))
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
        ['text', '文本'],
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
          lead: `归属项目 ${projectName ?? project ?? '—'}；支持文本 / 截图 OCR / 聊天记录作为原始材料，先预览再创建。`,
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
          h('label', { style: { display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', color: T.text2 } }, '标题', h('input', { ...field('title'), style: input, placeholder: '例如：退款状态对账' })),
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
            h('label', { style: { flex: 1, display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', color: T.text2 } }, '负责人', h('input', { ...field('owner'), style: input, placeholder: '默认取项目 teams[0]' })),
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
      const [signoffItem, setSignoffItem] = useState(null)
      const [createOpen, setCreateOpen] = useState(false)
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

      const selected = items.find((item) => item.id === selectedId) ?? null
      const currentProject = projects.find((entry) => entry.id === projectId || entry.workspaceId === projectId) ?? null
      const projectLabel =
        projectId === ALL_PROJECTS
          ? '全部项目'
          : currentProject?.title ?? data?.projectName ?? null
      const summary = data
        ? `${projectLabel ? `${projectLabel} · ` : ''}${data.summary.requirements} 条需求 · ${counts.proposed ?? 0} 条待评审 · ${counts['in-progress'] ?? 0} 条开发中 · check ${data.result}${data.scope === 'all' ? ` · ${data.summary.projects} 个项目` : ''}`
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
            title: currentProject && !currentProject.linked ? '先关联该工作区的 GitHub 仓库' : '新建需求',
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
                  projectItems.map((item) => h(RequirementCard, { key: item.id, item, showProject: false, onOpen: (entry) => setSelectedId(entry.id) })),
                )
              })
            : visible.map((item) => h(RequirementCard, { key: item.id, item, showProject: false, onOpen: (entry) => setSelectedId(entry.id) })),
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
              h('h3', { style: { margin: '0 0 6px', fontSize: '13px', fontWeight: 600, color: T.text2 } }, `追踪缺口（${data.gaps.length}）`),
              h(
                'ul',
                { style: { margin: 0, paddingLeft: '18px', fontSize: '12px', color: T.text2, lineHeight: 1.9 } },
                data.gaps.map((gap, index) =>
                  h('li', { key: `${gap.rule}-${index}` }, `${gap.project ? `[${gap.project}] ` : ''}${gap.rule} ${gap.file}${gap.line ? `:${gap.line}` : ''} ${gap.message}`),
                ),
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
        body,
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
              onReview: (entry) => setReviewItem(entry),
              onSignoff: (entry) => setSignoffItem(entry),
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
                setSelectedId(id)
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
