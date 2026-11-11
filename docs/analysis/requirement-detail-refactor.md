# 需求详情页重构：高信息密度 + 核心信息聚焦

- 日期：2026-11-01
- 分支：`develop`（HEAD `64ec15e` + 未提交改动）
- 关联：`docs/analysis/requirement-detail-review.md`（评估与 P0/P1/P2 建议）

## 0. 结论

需求详情从「一个需要滚动约 3 屏的长报告」改为「一屏内可判断、可行动的单面工作区」：

- 第一屏：状态与风险 → 唯一主行动 → 证据与验收（验收/评审的真实结论）→ 承诺摘要。
- 右栏：归属、关系、版本历史、技术详情（默认折叠）。
- AI 评审建议从需求背景中拆出，默认折叠，不再压住验收结论。
- 删除冗余的「查看详情」二级弹窗，抽屉本身是唯一详情面。
- 「开始开发」在后端按证据门禁拦截（不再只靠前端隐藏按钮）。

验收数字：`pnpm test` **407/407**；浏览器探针 `ui-detail-compact.mjs` **24/24**；列表回归 `ui-list.mjs` **47/47**；live `POST /start` 未满足证据 → **409 evidence-incomplete**，已验收需求 → **200 plan**。

## 1. 重构前实测问题（真实浏览器 + 真实数据）

| # | 问题 | 证据 |
| --- | --- | --- |
| 1 | Markdown 泄漏：`**bold**`、`> 引用`、`1. **…**` 原样显示 | `tmp/ui-shots-detail/unchecked-high.png` |
| 2 | 背景/目标两段同文重复 | 同上 |
| 3 | 已采纳的 AI 评审长报告塞在「需求背景」里，首屏被占满 | 同上 |
| 4 | 缺口信息在决策条、证据缺口、评审发现三处重复 | `probe.json` |
| 5 | 中英混排：`风险 high`、`AI 结论（block）`、`executor · …` | 同上 |
| 6 | 历史空态误导：未提交文件显示“工作区可能不是 git 仓库” | 同上 |
| 7 | 「下一步 · 登记验收命令」是文字，不可点 | `probe.json` |
| 8 | blocked/needs-clarification 记录「开始开发」可用，绕过门禁 | `probe.json` |
| 9 | 抽屉无 `aria-modal`、无焦点管理，Tab 会逃到背景列表 | `probe.json` |
| 10 | 底部 6 个按钮平铺，「关闭归档」紧邻主操作 | 截图 |
| 11 | 首屏没有创建/最近修订时间与风险原因 | 截图 |
| 12 | ID/路径不可复制 | 截图 |

## 2. 信息架构（重构后）

```
需求详情（880px 抽屉，窄窗 96vw）
├─ 标题区：状态 · 需求 ID（可复制）· 版本 · 最近更新
├─ 决策条（紧凑）：状态 / 风险 / 评审 x/y / 验收状态 + 唯一上下文主行动
├─ 左列（主信息）
│  ├─ 证据与验收：验收结论、评审覆盖、关联用例、证据来源（折叠）、其余缺口
│  └─ 承诺与背景：原始诉求分段、背景/目标去重、AI 评审建议（默认折叠）
└─ 右栏
   ├─ 归属：负责人 / 优先级 / 项目 / 文件（可复制）/ 更新 / 关系 / 追溯
   ├─ 版本历史（紧凑，未提交时明确提示）
   └─ 技术详情（默认折叠）
底部操作条：开始开发（按证据禁用+原因）/ 运行门禁检查 · 运行验收 ｜ 归档 · 关闭
```

## 3. 改动文件与落点

### `packages/dsh-plugin-requirements/client.js`

- **DecisionBar 重写**：状态 pill + 中文风险 + `评审 x/y · 验收 <状态>` + 单个主行动；删除重复的「签收条件未满足」行；`风险 high` → `风险高`。
- **primaryActionFor(item, actions)**：按 `decision.state` / `topGap.code` 映射真实动作（登记验收命令 / 运行验收 / 重跑验收 / 重新验收 / 运行评审 / 查看并处理…）；`verified`、`ready-for-human` 返回 `null`，主行动只留在底部 footer。
- **DrawerContent 重写**：两列布局（`DETAIL_CARD`、`DETAIL_LABEL`、`DETAIL_ROW` 等共享样式）；左列证据与验收 + 承诺与背景；右列归属 + 版本历史 + 技术详情。
- **renderBrief / renderRich**：安全渲染 `**bold**`、`` `code` ``、`[链接]`、`>` 引用、有序/无序列表；不使用 `dangerouslySetInnerHTML`。
- **briefSections / peelInlineLabels / 去重**：按 `## ` 标题与独立标签行（背景/目标/范围/验收/约束/风险/备注…）切节；行内 `背景：…` 剥成正文；跨节重复段落按「完全相同」与「前缀覆盖」两种规则合并，整节重复时显示“与「X」内容相同，已合并显示”。
- **AI 评审拆节**：命中 AI/评审/重构/建议的小节进入默认折叠的 `<details>`，不占首屏。
- **Drawer a11y**：`aria-modal="true"`、`aria-labelledby` 指向标题、打开时焦点进入抽屉、Tab/Shift+Tab 焦点陷阱、Escape 关闭、关闭后焦点归还触发元素；宽 880px，窄窗 96vw。
- **删除 DetailModal**：移除二级详情弹窗、`detailOpen` 状态、行内「查看详情」按钮，以及 4 处遗留的 `setDetailOpen(false)` 调用。
- **VersionList**：空态改为“尚未提交，暂无版本历史。”；`compact` 模式用于详情右栏；commit subject 截断到 34 字并保留 title 全文。
- **归属信息**：需求 ID、文件路径添加复制按钮；“更新”行显示中文日期 + short sha + 提交说明。

### `packages/dsh-plugin-requirements/index.js`

- **start 门禁**：`apply === true` 前用 `query.requirements(root)` 按 `requirementId`（有 `file` 时 `id + file`）定位；状态不是 `verified` / `ready-for-human` 时返回 **409**：

```json
{"ok":false,"error":{"code":"evidence-incomplete","message":"…","state":"blocked","reasons":[…]}}
```

- 预览（不带 `apply`）保持原行为（`alm.change.plan/v1` 200），兼容既有测试与「先看计划」的用法。

## 4. 关键设计决策

1. **单一详情面**：两套详情（抽屉 + 查看详情弹窗）导致信息重复、焦点与返回路径混乱；保留抽屉、删除弹窗，行内只保留“打开”与真实动作。
2. **880px 两列**：1440×900 下左列约 520px、右栏 260px，可同时看到决策、验收结论、承诺与归属；窄窗改为单列，避免横向滚动。
3. **AI 评审折叠**：AI 评审是“建议与依据”，不是“当前需求原文”；放在承诺区末尾折叠，避免把建议当成事实。
4. **门禁做在后端**：前端 `disabled` 只是提示；`apply` 分支重算状态并 409，防止 API/脚本绕过。
5. **自研 markdown 子集**：需求 brief 由用户与 AI 共同产生，不可信；只渲染白名单语法，全部走 React 文本节点。
6. **去重不做“智能合并”**：只隐藏完全重复或前缀覆盖的段落，并显式标注“与「X」内容相同”，不删除原始文件内容。

## 5. 验证

| 项 | 结果 | 说明 |
| --- | --- | --- |
| `pnpm test` | **407/407** | 含 `start` 预览 200 的既有断言 |
| 详情探针 `tmp/ui-harness/ui-detail-compact.mjs` | **24/24** | 未检查 / 阻塞 / 已验收三态；markdown 泄漏、AI 折叠、去重、a11y、Tab 陷阱、Escape、下一步真实弹层、门禁禁用 |
| 列表回归 `tmp/ui-harness/ui-list.mjs` | **47/47** | 删除 DetailModal 后无 `setDetailOpen` 报错；行内动作、提示条、筛选、滚动、空/错误/加载态 |
| live 门禁 | 409 / 200 | `REQ-ALM-014`（blocked）→ `evidence-incomplete`；`REQ-ALM-001`（verified）→ `alm.change.plan/v1` |
| 截图 | `tmp/ui-shots-detail/compact-{unchecked,blocked,verified,narrow,mobile}.png` | 1440×1000 / 900 / 600 |

复现命令：

```bash
HARNESS_PORT=63114 ALM_BASE=http://127.0.0.1:54672 node tmp/ui-harness/server.mjs
HARNESS_URL=http://127.0.0.1:63114/ node tmp/ui-harness/ui-detail-compact.mjs
HARNESS_URL=http://127.0.0.1:63114/ node tmp/ui-harness/ui-list.mjs
```

## 6. 未验证与限制

- 未在**真实宿主窗口**内点击：桌面宿主需要页面 token，验收在 Playwright + 真实 `client.js` + 真实 API 的 harness 页面完成；插件服务端已 reload，客户端需刷新页面加载新 bundle。
- 浅色主题下的对比度未重新测量；本轮按宿主深色变量设计。
- 屏幕阅读器（NVDA/VoiceOver）未实测，仅验证了 `aria-modal`/`labelledby`/焦点陷阱/Tab 顺序。
- 200% 缩放与触屏未复测（窄窗/移动端断点已测）。
- AI 评审折叠内容的完整长文未逐字核对，只验证“默认不占首屏、可展开”。
- 验收夹具为隔离构造数据（`tmp/list-fixture`，14 行、覆盖 verified/stale/failed/blocked/needs-clarification/unchecked），非生产数据。

## 7. 回滚

- 仅涉及两个文件：`client.js`、`index.js`。
- 详情块与 DecisionBar 为独立函数，可用补丁脚本 `tmp/detail/patch.cjs` 的备份 `tmp/detail/client.before.js`、`tmp/detail/index.before.js` 对照回退。
- 后端门禁只加在 `start` 的 `apply` 分支，去掉该分支即恢复旧行为。
