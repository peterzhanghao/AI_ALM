# 需求详情 v2 重构交付说明

- 日期：2026-11-03
- 依据：`docs/analysis/requirement-detail-v2-focus-and-action-brief.md`
- 分支：`develop`（工作区已有大量未提交改动，本次未回退任何既有修改）
- 范围：需求详情抽屉（`packages/dsh-plugin-requirements/client.js`）+ 状态/动作投影（`detail-view.mjs`、`query.mjs`）+ 交付状态语义（`packages/alm-core/src/requirements/delivery.mjs`）

## 1. 交付摘要

用户要求 | 实际情况
--- | ---
单列需求正文 | 已完成：正文 640–720px 单列，不再与右侧元信息卡并排
统一当前待办 | 已完成：首屏唯一「当前待办」卡（语气/标题/一句话摘要/查看问题）
需求 / 交付 / 记录三个页签 | 已完成：tablist + 方向键/Home/End + 角标（未处理事项数）+ 刷新不丢页签
唯一上下文主动作 | 已完成：底部 footer 只有一个主按钮，动作由服务端投影决定
先统一状态解释和操作判定 | 已完成：`deriveDetailView` 纯函数产出唯一 `context/primaryAction/attentionItems`，客户端只渲染
保留证据追溯/授权/版本校验/反馈 | 已完成，见 §4
重点验证截图组合 | 已完成，见 §6
真实插件截图 | 部分：真实 `client.js` + 真实 `query.mjs` 数据 + mock 传输层（宿主 GUI 401 无法直连，见 §7）

## 2. 先统一状态与动作（改结构之前）

### 2.1 单一事实来源

新增 `packages/dsh-plugin-requirements/detail-view.mjs`（纯函数，零依赖，不读磁盘）：

- `deriveDetailView(item, { now, allItems })` → `alm.detail.view/v1`
  - `identity` / `summaries`（delivery、run、review 双通道、acceptance、defect、candidate、release）
  - `context`（唯一焦点：`kind` + `headline` + 一句话 `explanation` + `tone` + `question`）
  - `primaryAction`（唯一主动作，含 `target` 与不可用原因）
  - `secondaryActions` / `attentionItems`（固定顺序）/ `tabs`（角标）/ `content` / `record` / `freshness`
- `parseBodySections(briefText, { aiStored })` → 正文分区（kind、完全相等才 `sameAs`、AI 建议只认元数据）
- `primaryActionFor(detail)` / `actionAvailability(id, target)` → 动作与可用性

`query.mjs` 在 `item.aiReview` 之后挂 `item.detailView`，**既有字段零改动**；客户端不再自行推断状态或动作。

### 2.2 焦点判定顺序（契约，先命中先返回）

1. 已关闭 → 无主动作
2. 运行有待回答决策 → `answer` /「回答并继续」
3. 运行心跳中断 → `run-interrupted` /「恢复推进」
4. 运行把控制权交回（无决策请求）→ `run-idle-handback` /「继续推进」
5. 运行确实在执行（`running`/`queued`）→ `run-active` /「查看运行」
6. 等待验收 → `signoff`；已验收 → 决定发布；已发布 → 只读
7. 评审阻塞 → `fix-review`；验收失败 → `start-fix`；回退待推进 → `start`

关键修正：`run.active` 只表示心跳新鲜，**不再等于「AI 正在开发」**；`waiting-input`/`paused` 必须先按交接/暂停处理，否则会出现「AI 正在开发 + 等待人类决定下一步」自相矛盾的文案。

### 2.3 交付状态语义：回退「待推进」

上一轮（用户 m01030）已确认：运行被人类接管、等待回答、心跳丢失、失败/取消时，**不应继续显示「推进中」**，应回退「待推进」并给出原因。本次重构中该语义一度被改成「等待人类仍算推进中」，本轮已恢复并补齐判定：

`delivery.mjs` 现在只有 `runCanProgress(run)`（活动状态、非 idle、`active !== false`、`stale !== true`、心跳未超 `RUN_HEARTBEAT_TIMEOUT_MS`）才返回 `in-progress`；其余运行一律返回：

```json
{ "key": "pending", "label": "待推进", "source": "run-idle", "runId": "RUN-001",
  "runStatus": "waiting-input", "waitingForHuman": true,
  "reason": "等待回答决策请求后继续" }
```

`source` 取值：`run-idle` / `run-stale` / `run-failed` / `run-cancelled` / `run-done` / `run-inactive` / `default`。

**含义分层**（避免把「有没有人推进」和「该做什么」混成一个字段）：

- 交付状态回答「现在有人推进吗」→ 待推进 / 推进中 / 等待验收 / 已验收 / 已关闭
- 当前待办回答「下一步该谁做什么」→ 需要你回答 / 等待你决定下一步 / 验收失败可修复 / 需求需要修改
- 主动作回答「点哪里」→ 回答并继续 / 继续推进 / 开始修复 / 查看运行

`nextActionFor` 同步：`pending + idleHandback/paused` → `resume-run`；`pending + awaitingAnswer` → `answer-run`；`pending + stale` → `resume-run`。

## 3. 页面结构

```
[ID 复制 vN]                      [反馈] [更多] [×]
标题
负责人 · P1 · 项目   [详情]
┌ 当前待办（唯一焦点）────────────────────┐
│ 需要你回答                       [查看问题] │
│ 运行 RUN-001 正在等待你回答决策请求……        │
└──────────────────────────────────────┘
需求(2) | 交付(2) | 记录
（单列正文 / 交付工作区 / 记录时间线）
──────────────────────────────────────
当前：需要你回答        [刷新] [查看记录]  [回答并继续]
AI 产出需人工核对；版本、授权与证据以服务端校验为准。
```

- Footer 是唯一的强动作位置；页签、内容区不再出现同名强按钮。
- 顶栏固定，正文区滚动，footer 固定可达；`<640px` 全屏、无横向滚动。
- 「隔离 worktree」从 footer 移到启动配置（只在会启动运行的动作旁出现）。
- 反馈仍在弹层/抽屉内可达，并带 `ui.viewState.tab`。

### 正文解析规则

- 只对**完全相等**的段落做 `sameAs` 合并，保留原文；前缀相同但更长的限制段落不会被吞。
- 「AI 评审建议」只在 `aiReview.stored === true` 且标题严格匹配时归为 AI 建议；用户写的「重构范围/重构建议」仍是普通正文。
- 缺失的正文分区明确列出「正文尚未明确：范围、验收要求」，不编造。

### 交付页

运行摘要、待答问题（默认展开 + 只读打开决策原文）、待处理事项（评审阻塞/验收失败为当前，已关闭缺陷为历史且中性）、评审双通道（规则证据 / AI 语义评审分开）、验收执行与证据来源、缺陷三种关系、候选/发布/追溯。

## 4. 保留的既有能力

证据追溯（`trace`、`TEST-*`、提交 hash）、授权边界（回答写入运行记录、AI 不自动批准）、版本校验（`requirementRevision`/CAS 仍在服务端）、反馈（弹层/抽屉内入口 + 上下文冻结 + 页签）、归档/删除/关闭/复制 ID/更多菜单、`AnswerRunModal`/`SignoffModal`/`ReleaseModal`/`VersionList`/`DiffPanel`/`Attachments`/`TraceLink` 等组件全部复用。

## 5. 改动文件

文件 | 改动
--- | ---
`packages/dsh-plugin-requirements/detail-view.mjs` | 新增：状态/动作/正文/记录投影（约 1045 行）
`packages/dsh-plugin-requirements/query.mjs` | 挂 `item.detailView`；`nextActionFor` 处理 idleHandback/paused；`applyDeliveryShim` 在宿主仍缓存旧 core 时把「推进中」纠正为「待推进」
`packages/alm-core/src/requirements/delivery.mjs` | 运行可推进判定；打断原因与 source；待推进回退
`packages/dsh-plugin-requirements/client.js` | 详情抽屉重构为 Shell/Header/CurrentTask/Tabs/Content/Delivery/Record/Footer/DecisionTextModal；旧双列布局不再使用
`packages/dsh-plugin-requirements/test/detail-view.test.mjs` | 新增 35 用例（含评审未完成 → 运行评审、候选缺失 → 生成交付候选）
`packages/alm-core/src/acceptance/acceptance.mjs` | 验收命令解析：`resolveSpawn`（Windows 下 `.cmd/.bat` 走 shell、`.exe` 不走，PATH 补 npm/pnpm 目录）与 `shellCommandLine`（逐参数引号）
`packages/alm-core/test/unit/acceptance-spawn.test.mjs` | 新增 8 用例（posix/win32 解析、未找到、引号、不误套 shell）
`packages/alm-core/test/unit/delivery-state.test.mjs` | 8 用例（含等待/暂停回退）
`packages/dsh-plugin-requirements/test/query.test.mjs` | 死运行/交接/待答动作
`tmp/ui-harness/server-detail-v2.mjs`、`tmp/ui-harness/ui-detail-v2.mjs` | 真实数据 + 离线传输验证与截图（tmp 不入库）

## 6. 验证

### 6.1 自动化

- 全量 `pnpm test`：**683 / 683 pass，0 fail**（34s；基线 610，新增 73 条：detail-view 37、release 增 1、delivery-state 8、acceptance-spawn 8、query 增 5、feedback 相关 14）
- `delivery-state.test.mjs` 8/8；`query.test.mjs` 18/18（含旧 core 兜底）；`detail-view.test.mjs` 37/37；`release.test.mjs` 5/5；`acceptance-spawn.test.mjs` 8/8
- `node --check client.js` 通过；`node tmp/ui-harness/build.mjs` 打包真实 `client.js` 通过（1.17 MB）
- UI 验证 `node tmp/ui-harness/ui-detail-v2.mjs`：**51 PASS / 0 FAIL**（`tmp/detail-v2/report.json`、`verify.log`；新增「运行评审打开 AI 评审弹层」「AI 评审弹层展示模型/结论/意见、无 undefined」「验收交付打开人工签收」「REQ-ALM-004 焦点=等待验收」「已授权待执行→唯一主动作=执行发布」「执行发布后回到完成且列表同步已发布」「授权后内容变化→执行被拒并提供重新生成并授权」等断言）
- 回归：`ui-feedback` 39/39、`ui-answer-submit` 23/23、`ui-intent-group` 35/35，均未放宽断言

### 6.2 真实数据投影（`query.requirements('D:/DSH')`）

需求 | 交付状态 | 当前待办 | 主动作
--- | --- | --- | ---
REQ-ALM-001 | 待推进（run-idle，等待回答决策请求后继续） | 需要你回答 | 回答并继续
REQ-ALM-003 | 待推进（run-cancelled） | 验收失败，可修复 | 开始修复
REQ-ALM-004 | 已验收（human-signoff；候选 CAND-REQ-ALM-004-006，验收 pass；发布 REL-002 已授权待执行） | 已授权，等待执行发布 | 执行发布

四条都不再显示「推进中」，且主动作与状态一致（001 `answer-run`、003 `start-fix`、004 `execute-release`、002 已关闭无主动作）。

`packages/alm-core` 的改动要宿主重启才生效；重启前由插件层 `applyDeliveryShim`（`query.mjs`）兜底，列表与详情已按同一规则显示，无需等重启。

### 6.4 本轮补强的完成链路（REQ-ALM-004）

问题：验收已通过，但详情页没有「运行评审」入口，候选也无创建入口，`signoff` 又要求候选，唯一主动作停留在会空转的「继续推进」，用户点完只看到 preflight。

修掉三个真缺陷（均指向「卡在保存评审报告」）：

1. **焦点顺序错**：`run.idleHandback` 排在 `delivery.key === 'awaiting-acceptance'` 之前，候选已就绪、决策待验收时主动作仍显示「继续推进」。`detail-view.mjs` 的 `resolveFocus` 重排为：closed → answer → blocked → **awaiting-acceptance** → released → accepted → acceptance-failed → run.stale → run.idleHandback（内部再判 review-pending / candidate-pending）→ run-active → review-pending → candidate-pending → run-rolled-back → in-progress → not-started。
2. **点继续推进空转**：`start` 被 `runCore.activeRunFor` 判为「仍在推进」（waiting-input 也算 active），只出 preflight、不新建运行。现在这类需求不再给「继续推进」，主动作改为更具体的下一步（见 3）。
3. **「运行评审」打开的是旧规则评审**：`run-review` 原先映射到 `ReviewModal`（五角色来自门禁规则，真实数据里全 skip，永远 0/5，只有「保存评审报告」按钮，存完主动作不变）。现改为映射 `AiReviewModal`（`writeJson('ai-review')`，真实模型语义评审，采纳后走 `adoptAiReview` + `runReview` + `adoptReview` + `createDeliveryCandidate`）。

- 新增动作：`run-review`（→ AI 评审）/ `create-candidate`（→ 既有 `candidate` 写入），由 `detail-view.mjs` 统一投影（`review-pending` / `candidate-pending` 两种 focus），客户端不新增端点。
- 用 `tmp/regenerate-candidate-alm-004.mjs` 以真实验收证据重建候选：`CAND-REQ-ALM-004-003`（treeHash `89a344d8…`、requirementHash `98a45d90…`、154 文件、current=true），决策转为 `ready-for-human`，主动作「验收交付」。
- 验收命令缺陷：`pnpm test` 的 `spawnSync pnpm ENOENT` 已由 `resolveSpawn`/`shellCommandLine` 修复；用真实工作区跑通一次验收，证据 `.alm/acceptance/REQ-ALM-004/64ec15e6….json` 现为 `result: pass`（cmd-1 exit 0，45.7s）。
- 截图：`07-alm-004-signoff-action.png`（验收交付 → 人工签收弹层）、`08-review-action-ai.png`（运行评审 → AI 评审报告，含模型/结论/意见/建议/方案）。

### 6.5 发布执行闭环（「点完决定发布仍显示决定发布」）

现象：用户点了两次「决定发布」，`.alm/releases/REL-001.json`、`REL-002.json` 都停在 `status: authorized`、`executions: []`——授权了，从未执行发布。

根因：

1. `ReleaseModal` 只有 plan → create → authorize，没有执行发布这一步；后端 `mode:'execute'` 与 `recordReleaseExecution` 早已存在，但 UI 从不调用。
2. 授权后 `release.status === 'authorized'`、`released === false`，`detail-view` 的 accepted 分支仍映射到 `release`（「决定发布」）→ 按钮永远不变。
3. 详情头部红色徽标「验证中」其实是缺陷状态（`DefectStatusPill`，DEF-REQ-ALM-004-001 `verifying`），与交付状态「已验收」并排却没有前缀，被读成需求状态。

修复：

- `detail-view.mjs`：新增 focus `release-authorized`（「已授权，等待执行发布」）/ `release-failed`（「发布失败，可重试」）与动作 `execute-release`（「执行发布」），解释里明确「授权不是发布：执行结果会单独记录」。
- `client.js`：`ReleaseModal` 增加执行步骤——`authorized` 时按钮为「执行发布」（`data-release-execute`，二次确认后写入 `result:'released'`），成功后回到「完成」；「授权发布」只在 draft 出现。
- `query.mjs`：发布完成且交付已验收时，列表/详情的交付标签同步为「已发布」（source `release`）。
- 授权绑定的内容变化时拒绝执行：`recordReleaseExecution` 新增 `items` 参数，用 `planRelease` 重算内容哈希；与授权时不一致抛 `release-candidate-changed`（409），绝不发布人没看过的内容。UI 收到该错误时显示「重新生成并授权」（`data-release-replan`），重新 create + authorize 后回到「执行发布」。
- 缺陷徽标加前缀：显示「缺陷 · 验证中」，与需求交付状态区分。

验证：`release.test.mjs` 增「授权后候选变化→执行被拒且不落盘，未变化可执行」；UI 增「授权后内容变化→执行被拒→重新生成并授权→执行完成」全链路；真实数据 REQ-ALM-004 现为 `release REL-002 authorized` + 候选 `CAND-REQ-ALM-004-006`，主动作「执行发布」。

### 6.3 截图组合（用户指定）

REQ-ALM-001：等待回答 + 评审阻塞 + 验收失败 + 关联缺陷已关闭，验证点：

- 首屏可见标题、当前待办、目标正文起始、唯一主动作「回答并继续」
- 交付页同时出现「评审阻塞（当前）」「验收失败（当前）」「已关闭缺陷（历史，中性）」
- 点「查看问题」打开 `RUN-001-decision.md` 原文只读弹层，Esc 只关弹层、页签不丢
- 点主动作打开既有 `AnswerRunModal`，请求为 `mode=answer` + `requirementId=REQ-ALM-001`，**不新建运行**
- 420px 宽无横向滚动；footer 纵向堆叠（状态行 / 刷新·查看记录 / 全宽主按钮 / 免责声明在按钮下方），主按钮与免责声明 bbox 不相交（第 37 条断言）
- 顶栏「反馈」「更多」为 12px ghost 按钮 + 独立关闭按钮，1x 截图可读、与 × 有间距；反馈在抽屉内可用且带页签
- 反馈抽屉高于详情抽屉（z-index 65 > 40/60），且 `aria-modal=false`：打开反馈不关闭详情、Esc 只关反馈

> 说明：`04-record.png` 与 `02-delivery.png` 之后的部分状态来自 mock 在「提交回答」后把 RUN-001 置为 `running`（用于覆盖回答后的推进链路）；首屏与 02 交付页截图代表回答前的真实投影（待推进 / run-idle）。

## 7. 未达标项与限制

1. **真实宿主截图**：本机 GUI（`http://127.0.0.1:52706`）返回 401「dsh web authentication required」，无法直连截图。交付截图是「真实 `client.js` 打包 + 真实 `query.mjs` 读 D:/DSH + mock 传输层」，报告中已标注；构造夹具仅 `REQ-DETAIL-TRAP` 的 id/title/briefText/file/createdAt。
2. 「打开源文件」只能打开所在目录（宿主 reveal 只接受目录），提示语注明源文件路径。
3. 决策请求原文默认不内联（只给 ref + 标题），需点「查看问题」；避免把 `.alm/runs/*.md` 读进投影。
4. 投影里 `review.ai.suggestions` 是数量，只展示结论/采纳/失效/时间，不列建议条目。
5. `item.defect` 只带最新一条缺陷，`defects.related` 恒空、已关闭历史最多 1 条。
6. `runView` 不含 checkpoint 内容，心跳中断时无法判断是否可恢复，文案固定「需人工核对」。
7. 页签状态随抽屉生命周期：关闭重开回默认「需求」页（刷新/回答/反馈会保留）。
8. 旧版针对旧详情文案（证据与验收、承诺与背景等）的临时脚本已不再适用；现存四套 UI 脚本（detail-v2 / feedback / answer-submit / intent-group）均已更新并通过。
9. 截图里的灰色水印 `detail-v2 harness · real client.js + real query.mjs data + mock transport` 是验证脚手架自带的标识（截图前已隐藏），不是插件 UI。
10. **「继续推进」对 idle-handback 运行仍是空转**：运行处于 `waiting-input` 且没有决策请求时，`start`/`restart` 会被 `activeRunFor` 判为「仍在推进」而返回 `reused`，只做 preflight 不新建运行。本轮通过把这类需求的主动作改为「运行评审 / 开始修复」绕开了死路，但该底层分支未改；需要服务端提供「接管 idle 运行（新建会话续跑）」再收口。
11. 「运行评审」已改为真实 AI 语义评审入口；「保存评审报告」的旧规则评审弹层仍存在（作为门禁规则报告入口），但不再占据主动作。
12. AI 评审弹层的结论徽标直接显示 `warn/block/pass` 原值（未中文化），属既有组件行为，本轮未改。
13. **发布授权是否过期，只有点「执行发布」后才知道**：投影未暴露授权哈希与当前候选哈希的比对结果（`releaseViewFor` 不带 contentHash），所以过期授权仍显示「执行发布」，点下去才返回 `release-candidate-changed` 并给出「重新生成并授权」。要在点按前提示，需让 `releaseViewFor` 暴露 `authorizationStale`。
14. 本轮改动了 `client.js` / `detail-view.mjs` / `query.mjs` / `release.mjs`，工作区内容哈希因此变化：候选已重建为 `CAND-REQ-ALM-004-006` 并重跑验收（pass），但历史发布记录 `REL-001`/`REL-002` 的授权绑定的是旧内容，需要重新授权后才能执行发布。

## 8. 后续建议

1. 在有真实宿主会话的环境复跑一次截图与点按验证，替换 mock 传输层。
2. 决策请求内联摘要（只读、截断 400 字）以减少一次点击。
3. 缺陷历史补多条（需 `failure.mjs` 提供按需求列缺陷的读取接口）。
4. 把「打开源文件」提升为「复制路径 + 打开目录 + 打开 brief」三选一。
