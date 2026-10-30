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
    const primary = { ...button, background: T.brand, color: '#fff', borderColor: 'transparent' }
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
        '项目',
        h(
          'select',
          { style: input, value: currentId ?? '', onChange: (event) => onPick(event.target.value), 'aria-label': '选择项目' },
          h('option', { value: '' }, '选择项目…'),
          h('option', { value: ALL_PROJECTS }, '全部项目（聚合）'),
          projects.map((project) => h('option', { key: project.id, value: project.id }, `${project.name}（${project.id}）`)),
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

    function DrawerContent({ item, allItems, projectMeta, root, onDetail, onClose, compact }) {
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

        h(Section, { title: '验收覆盖' },
          (item.verifiedBy ?? []).length
            ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '0' } }, item.verifiedBy.map((id) => h('div', { key: id, style: { ...row, color: T.text } }, h('span', { style: { color: T.ok } }, '✓'), id)))
            : h('p', { style: { margin: 0, color: T.warn, fontSize: '12.5px' } }, '没有 verified_by，COV-001 会失败。'),
        ),

        h(Section, { title: '关系' },
          relations.length
            ? h('div', null, relations.map(([label, ids]) => h('div', { key: label, style: row }, h('span', { style: rowLabel }, label), h('span', { style: { color: T.text } }, ids.join('、')))))
            : h('p', { style: { margin: 0, ...muted } }, '暂无关系。'),
        ),

        h(Section, { title: 'GitHub 归属' }, h(GithubBlock, { item, projectMeta })),

        h(Section, { title: '历史' },
          h('div', { style: row }, h('span', { style: rowLabel }, '当前修订'), h('span', { style: { color: T.text } }, `v${item.revision ?? 1}（最新）`)),
          h('p', { style: { margin: '8px 0 0', ...muted } }, '版本对比与快照将在 ALM-08.03 接入（读取 changes/ 与 REVISION 历史）。'),
        ),

        h('details', { style: { marginTop: '22px', borderTop: `1px solid ${T.line}`, paddingTop: '12px' } },
          h('summary', { style: { cursor: 'pointer', color: T.text2, fontSize: '12.5px' } }, '技术详情'),
          h('div', { style: { marginTop: '10px', color: T.text2, fontSize: '12px', lineHeight: 1.9 } },
            h('div', null, h('code', { style: { color: T.text } }, `${item.file}${item.line ? `:${item.line}` : ''}`)),
            item.brief ? h('div', null, '简报：', h('code', { style: { color: T.text } }, item.brief)) : null,
            h('div', null, `门禁提示词：${item.nextActionLabel ?? item.nextAction}`),
          ),
          h(CopyPrompt, { text: nextPrompt(item, root) }),
        ),

        h('div', { style: { display: 'flex', gap: '10px', marginTop: '22px' } },
          h('button', { style: primary, onClick: () => onDetail(item) }, '查看详情'),
          onClose ? h('button', { style: button, onClick: onClose }, '关闭') : null,
        ),
      )
    }

    function Drawer({ item, allItems, projectMeta, root, onClose, onDetail }) {
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
          h(DrawerContent, { item, allItems, projectMeta, root, onDetail, onClose, compact: true }),
        ),
      )
    }

    function DetailModal({ item, allItems, projectMeta, root, onClose }) {
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
              h(Section, { title: '关系' },
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
              h(Section, { title: '评审' }, h('p', { style: { margin: 0, ...muted } }, '评审报告数据将在 ALM-08.02 接入（AI 多角色结论 + findings）。')),
              h(Section, { title: '技术' },
                h('p', { style: { margin: 0, ...muted } }, `${item.file}${item.line ? `:${item.line}` : ''}`),
                item.brief ? h('p', { style: { margin: '4px 0 0', ...muted } }, `简报：${item.brief}`) : null,
                h(CopyPrompt, { text: nextPrompt(item, root) }),
              ),
            ),
          ),
          h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' } },
            h('button', { style: button, onClick: onClose }, '关闭'),
          ),
        ),
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
      const [showRoot, setShowRoot] = useState(false)
      const { loading, error, data, reload } = useRequirements({ root, projectId })

      useEffect(() => {
        fetch('/api/alm/projects')
          .then((response) => (response.ok ? response.json() : null))
          .then((payload) => {
            if (!payload?.projects) return
            setProjects(payload.projects)
          })
          .catch(() => {})
      }, [])

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
        const project = projects.find((entry) => entry.id === id)
        if (!project) return
        setProjectId(id)
        if (typeof localStorage !== 'undefined') localStorage.setItem(PROJECT_KEY, id)
        applyRoot(project.root)
        setRootInput(project.root ?? '')
      }

      const projectMetaFor = useCallback(
        (item) => {
          if (!item) return null
          const fromProjects = projects.find((entry) => entry.id === item.project)
          if (fromProjects) {
            return {
              name: fromProjects.name,
              repo: fromProjects.github ? `${fromProjects.github.owner}/${fromProjects.github.repo}` : null,
              board: fromProjects.github?.project?.number ?? null,
            }
          }
          if (data?.projectInfo) {
            return { name: data.projectInfo.name, repo: data.projectInfo.repo, board: data.projectInfo.board }
          }
          return { name: item.projectName, repo: null, board: null }
        },
        [projects, data?.projectInfo],
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
      const currentProject = projects.find((entry) => entry.id === projectId) ?? null
      const projectLabel =
        projectId === ALL_PROJECTS
          ? '全部项目'
          : currentProject?.name ?? data?.projectName ?? null
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
            })
          : null,
        detailOpen && selected
          ? h(DetailModal, {
              item: selected,
              allItems: items,
              projectMeta: projectMetaFor(selected),
              root: data?.root ?? root,
              onClose: () => setDetailOpen(false),
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
