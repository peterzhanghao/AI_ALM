window.__ModuleLoader__.load({
  id: '@ai-alm/dsh-plugin-requirements',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback } = React

    const ROOT_KEY = 'alm.requirements.root'
    const panel = { padding: '24px', maxWidth: '980px', color: 'var(--dsw-alias-label-primary)' }
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
    const primary = { ...button, background: 'var(--dsw-alias-brand-primary, #4d6bfe)', color: '#fff', borderColor: 'transparent' }
    const input = {
      border: '1px solid var(--dsw-alias-border-l1)',
      background: 'var(--dsw-alias-bg-layer-1)',
      color: 'var(--dsw-alias-label-primary)',
      borderRadius: '6px',
      padding: '4px 8px',
      fontSize: '12px',
      minWidth: '260px',
    }
    const muted = { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' }
    const card = {
      border: '1px solid var(--dsw-alias-border-l1)',
      borderRadius: '8px',
      padding: '14px 16px',
      marginBottom: '12px',
      background: 'var(--dsw-alias-bg-layer-1)',
    }
    const pre = {
      margin: '8px 0 0',
      padding: '10px',
      fontSize: '12px',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      background: 'var(--dsw-alias-bg-base, #0f1115)',
      border: '1px solid var(--dsw-alias-border-l1)',
      borderRadius: '6px',
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
        null,
        h('button', { style: primary, onClick: copy }, state === 'copied' ? '已复制' : state === 'failed' ? '复制失败，请手动选择' : '复制提示词'),
        h('pre', { style: pre }, text),
      )
    }

    function useRequirements(root) {
      const [state, setState] = useState({ loading: true, error: null, data: null })
      const load = useCallback(() => {
        setState({ loading: true, error: null, data: null })
        const query = root ? `?root=${encodeURIComponent(root)}` : ''
        fetch(`/api/alm/requirements${query}`, { headers: { accept: 'application/json' } })
          .then(async (response) => {
            const body = await response.json()
            if (!response.ok || body.ok === false) {
              throw new Error(body?.error?.message ?? body?.error ?? `HTTP ${response.status}`)
            }
            setState({ loading: false, error: null, data: body })
          })
          .catch((error) => setState({ loading: false, error: error.message, data: null }))
      }, [root])
      useEffect(() => {
        load()
      }, [load])
      return { ...state, reload: load }
    }

    function RootPicker({ rootInput, setRootInput, onApply, onReset }) {
      return h(
        'form',
        {
          style: { display: 'flex', gap: '8px', alignItems: 'center', margin: '8px 0 16px', flexWrap: 'wrap' },
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

    function EmptyState({ root, onOpenPanel }) {
      return h(
        'div',
        { style: card },
        h('h3', { style: { margin: '0 0 8px', fontSize: '15px' } }, '从这一步开始'),
        h(
          'ol',
          { style: { margin: 0, paddingLeft: '20px', fontSize: '13px', lineHeight: 1.9 } },
          h('li', null, '看示例：点「恢复默认」加载 fixtures/order-refund，认识 7 类资产与追踪关系。'),
          h('li', null, '写第一条：让 Agent 按 alm-requirements 技能起草需求，再用 alm check 验证。'),
          h(
            'li',
            null,
            '进入变更流程：',
            onOpenPanel ? h('button', { style: { ...button, marginLeft: '6px' }, onClick: onOpenPanel }, '打开工作台') : null,
          ),
        ),
        root ? h('p', { style: muted }, `当前根：${root}`) : null,
      )
    }

    function RequirementDetail({ item, gaps, root }) {
      const related = gaps.filter((gap) => gap.assetId === item.id || gap.file === item.file)
      return h(
        'div',
        { style: card },
        h('h3', { style: { margin: '0 0 4px', fontSize: '15px' } }, `${item.id} · ${item.title}`),
        h('p', { style: muted }, `${item.status} · ${item.owner} · ${item.file}:${item.line}`),
        h('h4', { style: { margin: '10px 0 4px', fontSize: '13px' } }, '验收覆盖'),
        item.verifiedBy.length > 0
          ? h('ul', { style: { margin: 0, paddingLeft: '18px', fontSize: '13px' } }, item.verifiedBy.map((id) => h('li', { key: id }, id)))
          : h('p', { style: { ...muted, color: 'var(--dsw-alias-state-warn-primary)' } }, '没有 verified_by，COV-001 会失败。'),
        h('h4', { style: { margin: '10px 0 4px', fontSize: '13px' } }, '关系'),
        item.links.length > 0
          ? h(
              'ul',
              { style: { margin: 0, paddingLeft: '18px', fontSize: '13px' } },
              item.links.map((link, index) => h('li', { key: `${link.type}-${link.target}-${index}` }, `${link.type} → ${link.target}`)),
            )
          : h('p', { style: muted }, '暂无关系。'),
        related.length > 0
          ? h(
              'div',
              null,
              h('h4', { style: { margin: '10px 0 4px', fontSize: '13px' } }, '门禁提示'),
              h(
                'ul',
                { style: { margin: 0, paddingLeft: '18px', fontSize: '13px' } },
                related.map((gap, index) => h('li', { key: index }, `${gap.rule} · ${gap.message}`)),
              ),
            )
          : null,
        h('div', { style: { marginTop: '12px' } }, h(CopyPrompt, { text: nextPrompt(item, root) })),
      )
    }

    function Workbench({ openPanel }) {
      const stored = typeof localStorage === 'undefined' ? '' : localStorage.getItem(ROOT_KEY) ?? ''
      const [rootInput, setRootInput] = useState(stored)
      const [root, setRoot] = useState(stored)
      const [selected, setSelected] = useState(null)
      const { loading, error, data, reload } = useRequirements(root)

      const applyRoot = useCallback(
        (value) => {
          setRoot(value)
          setSelected(null)
          if (typeof localStorage !== 'undefined') {
            if (value) localStorage.setItem(ROOT_KEY, value)
            else localStorage.removeItem(ROOT_KEY)
          }
        },
        [],
      )

      const header = h(
        'div',
        null,
        h('h2', { style: { margin: '0 0 4px', fontSize: '18px', fontWeight: 600 } }, 'Requirements'),
        h(
          'p',
          { style: muted },
          data ? `${data.summary.requirements} 条需求 · ${data.summary.gaps} 个追踪缺口 · check ${data.result}` : '加载中…',
        ),
      )

      if (loading) return h('div', { style: panel }, header, h('p', { style: muted }, '正在读取资产…'))
      if (error) {
        return h(
          'div',
          { style: panel },
          header,
          h(RootPicker, { rootInput, setRootInput, onApply: () => applyRoot(rootInput), onReset: () => { setRootInput(''); applyRoot('') } }),
          h('p', { style: { color: 'var(--dsw-alias-state-error-primary)' } }, error),
          h('button', { style: button, onClick: reload }, '重试'),
        )
      }

      const next = data.requirements.find((item) => item.nextAction !== 'done')
      const banner = data.requirements.length
        ? h(
            'div',
            { style: card },
            h('h3', { style: { margin: '0 0 6px', fontSize: '14px' } }, next ? `下一步：${next.nextActionLabel}` : '全部就绪'),
            h(
              'p',
              { style: { ...muted, margin: '0 0 8px' } },
              next ? `建议从 ${next.id} 开始；下面可以直接复制给 Agent 的提示词。` : '所有需求都有验收覆盖，可进入变更/发布流程。',
            ),
            next ? h(CopyPrompt, { text: nextPrompt(next, data.root) }) : null,
          )
        : null

      const rows = data.requirements.map((item) =>
        h(
          'tr',
          {
            key: item.id,
            style: { cursor: 'pointer' },
            onClick: () => setSelected(selected === item.id ? null : item.id),
          },
          h('td', { style: td }, item.id),
          h('td', { style: td }, item.title),
          h('td', { style: td }, item.status),
          h('td', { style: td }, item.owner),
          h(
            'td',
            { style: { ...td, color: item.verifiedBy.length ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-warn-primary)' } },
            item.verifiedBy.length ? item.verifiedBy.join(', ') : '未覆盖',
          ),
          h('td', { style: td }, item.nextActionLabel),
        ),
      )

      const selectedItem = data.requirements.find((item) => item.id === selected) ?? null

      return h(
        'div',
        { style: panel },
        header,
        h(RootPicker, { rootInput, setRootInput, onApply: () => applyRoot(rootInput), onReset: () => { setRootInput(''); applyRoot('') } }),
        banner,
        data.requirements.length === 0
          ? h(EmptyState, { root: data.root, onOpenPanel: openPanel })
          : h(
              'table',
              { style: table },
              h('thead', null, h('tr', null, ['ID', 'Title', 'Status', 'Owner', 'Coverage', 'Next'].map((label) => h('th', { key: label, style: th }, label)))),
              h('tbody', null, rows),
            ),
        selectedItem ? h(RequirementDetail, { item: selectedItem, gaps: data.gaps, root: data.root }) : null,
        h('h3', { style: { margin: '18px 0 6px', fontSize: '14px' } }, '追踪缺口'),
        data.gaps.length === 0
          ? h('p', { style: muted }, '没有追踪缺口。')
          : h(
              'ul',
              { style: { margin: 0, paddingLeft: '18px', fontSize: '13px' } },
              data.gaps.map((gap, index) => h('li', { key: `${gap.rule}-${index}` }, `${gap.rule}  ${gap.file}${gap.line ? `:${gap.line}` : ''}  ${gap.message}`)),
            ),
        h(
          'div',
          { style: { display: 'flex', gap: '8px', marginTop: '16px' } },
          h('button', { style: button, onClick: reload }, '刷新'),
          openPanel ? h('button', { style: button, onClick: openPanel }, 'Open as main panel') : null,
        ),
      )
    }

    function Intro({ openPanel }) {
      return h(
        'div',
        { style: panel },
        h('h2', { style: { margin: '0 0 6px', fontSize: '18px', fontWeight: 600 } }, '需求工作台'),
        h('p', { style: { ...muted, margin: '0 0 12px' } }, '需求资产、验收覆盖与下一步动作都在这里。'),
        h(EmptyState, { root: '', onOpenPanel: openPanel }),
      )
    }

    return {
      inject: ['slots', 'layout'],
      apply(ctx) {
        function SettingsPage() {
          return h(Intro, { openPanel: () => ctx.layout.selectPanel('requirements') })
        }
        function MainPage() {
          return h(Workbench, {})
        }
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register({ name: 'settings.section', id: 'requirements', order: 91, label: 'Requirements' }, SettingsPage),
        )
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'requirements' }, MainPage))
      },
    }
  },
})
