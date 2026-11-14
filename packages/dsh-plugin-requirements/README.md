# @ai-alm/dsh-plugin-requirements

需求领域插件（ALM-03.02）：一个 HTTP 路由、一个 Agent 工具、一个页面。

决策回答面向产品经理：业务/功能问题使用带影响说明的单选卡片，推荐不预选，补充说明选填。服务端按当前决策路径与内容哈希校验结构化选择并生成回答；刷新前后问题变化会拒绝旧选择。旧 Q-n/箭头选项兼容转换，无法可靠转换时通过“请 AI 整理业务选项”继续原运行，明确不构成业务同意；未取得业务决定前不自动生成候选。索引、代码组织、测试实现等技术事项由 AI 在既有授权内处理；删除业务数据、扩大权限/预算、降低验收标准、人工签收与发布不属于技术自主授权。决策原文保留在折叠运行记录中，REQ-ALM-001 的现有 RUN-015 无需改写历史文件即可使用新界面。

| 项 | 内容 |
|---|---|
| 路由 | `GET /api/alm/requirements`、`/api/alm/projects`；写接口 `/api/alm/requirements/{preflight,start,accept,create,github,acceptance,ai-review,signoff,diff,intake,remove,candidate,release,run,failure,defect}` |
| 页面路由 | `GET /alm/requirements` → 只读 HTML（免 token，可直接在浏览器打开） |
| 工具 | `alm_requirements [root]` |
| 页面 | 侧边栏「需求」图标 / Settings → Requirements；`main` 面板 key `requirements` |
| 交付状态 | 派生自 candidate + evidence + run：待推进 / 推进中 / 待验收 / 已验收 / 已关闭；`STATUS:` 已下线为 legacy 只读（STATE-001 退役为空规则）。顶部工作视图：全部/待我处理/AI 推进中/待验收/已验收/已关闭；进入插件默认落在「待我处理」，列表沿用服务端创建时间倒序（见下文 REQ-ALM-015） |
| 项目空间 | 项目列表 = DSH 工作区（剔除默认工作区），每个工作区可关联 GitHub 仓库（`.alm/project.json`） |
| 交付推进 | 「交给 AI 推进」= preflight（登记验收/保留已有验收结果，不再强制重复评审）+ 登记变更 + 创建宿主执行会话：`.alm/runs/<RUN>.json` 记录 排队/运行/等待输入/暂停/失败/取消，关闭面板后仍继续；执行会话 pin 为 `workspace-write` + `approval:never`（点按钮即本轮授权），遇到业务取舍会写 `.alm/runs/<RUN>-decision.md` 等你回答；面板提供「回答并继续」（`run {mode:'answer'}`，回答追加进 `run.answers` 并继续推进，宿主重启则用新会话降级续跑）与「取消推进」（`run {mode:'cancel'}`，改动与记录保留） |
| 验收 / 交付候选 | 验收通过后生成 `CAND-*` 交付候选（绑定需求内容哈希 + 未提交工作区文件哈希 + 验收哈希）；人类对具体候选签收才到「已验收」；候选变化会让旧验收与旧发布授权失效 |
| 发布 | 发布是独立对象 `REL-*`：已验收交付集合 → 人类授权 → 执行结果（released/failed）追加记录；`.alm/releases/` 可查 |
| 失败监控 | 验收失败、执行会话失败、写入失败都会汇总成统一失败事件 `.alm/failures/FAIL-*.json`（阶段/步骤/分类/指纹/脱敏证据/快照/重试），区分业务结果、用户取消、外部依赖、插件缺陷、产品缺陷；监控异常不覆盖原错误 |
| 原需求内修复 | 开发或验收的产品失败只记录事件，不自动新建需求；存在原已授权执行会话时复用原需求与原 run 修复，每 run 最多两次，人工决策、暂停、取消、终态及授权范围仍生效。没有会话时明确等待人工恢复，不偷偷创建新会话。人工显式创建缺陷及已有缺陷闭环保留 |
| 列表 / 删除 | 列表只展示项目 `requirementRoot` 内的需求（测试 fixture 不再混入）；「归档」保留记录并移出活跃列表，「删除」从仓库移除记录，删除前把原文与基线写入 `.alm/audit/requirements/` |
| 优化建议 / 版本 | 完成需求澄清并确认后不再强制第二轮评审；`.alm/reviews/<REQ>.ai.json` 仅保存可选的 AI 优化建议。建议默认不勾选，可明确采纳所选项或暂不采纳后继续；`pass/warn/block` 仅是建议元数据，不阻断推进，也不代表人工验收或发布授权。可信人工签收独立存放在 `.alm/signoffs/<REQ>.json`，并绑定当前候选与验收证据；版本快照/字段 diff |
| 入库 | 新建向导支持口语 / 截图本地 OCR / 聊天记录；AI 自动生成标题、背景、优先级（责任人默认张浩），附件归档到 `requirements/attachments/` |

## DSH 执行与 token 口径

需求插件把 DSH Desktop 作为执行载体：通过宿主 `agents.create` 创建带 `standard` `agentPresets` 的工作区会话，运行记录绑定需求版本、工作区和 session 段；宿主不可用时返回明确失败，不创建假运行。对话与轨迹读取优先使用 `sessionQuery.observeSession` 的 revision cache/lease，复制事件后释放 lease，旧宿主才回退完整 `readSession`。这能减少重复冷读，但不能把 DSH 的完整日志回放变成范围分页。

澄清与独立 AI 评审使用宿主 `llm.stream` 和所选模型，属于独立调用，不自动并入开发会话的用量。宿主已启用的模型路由、缓存或上下文压缩插件是否作用于某次调用，取决于该插件的实际接入路径和模型配置；需求插件不强制启用它们，也不保证每次命中缓存或节省费用。观察读取缓存只减少本地重复读取，不代表减少模型 token。以对应会话的可归属数据和供应商账单核对实际效果。

用量显示只接受可精确匹配的本机会话账本：缓存读取、缓存写入、输入/输出 token、命中率和代理费用估算分别展示；`savedUsd` 只有代理提供时才显示，并明确为“代理估算，非账单”。缺失、历史不完整、重复 session、模型切换或价格版本不明时显示未知，不用 0 或猜测节省额替代。真实供应商账单、Desktop 主题/读屏/缩放和原生跳转仍需独立人工验收。

## REQ-ALM-006 文件交换（验证待完成）

单工作区顶部「导入 / 导出」打开JSON及Excel文件交换。下载真实文件，选择文件立即只读预览，确认时携带同一内容和localHash，显示整批结果回执。只交换title/brief/priority/owner；不导入签收、执行状态、证据或发布授权。

下载使用浏览器原生保存选择器（支持File System Access时）：点击即打开保存对话框，选定后通过既有认证export获取文件，核对类型及字节数，write/close均成功才显示「已保存」。取消不另行下载，失败明确报错。不支持该API时使用Blob锚点，节点与URL保留60秒再一起清理，仅提示「已发起下载，尚未确认落盘」；浏览器下载记录及真实文件才是成功证据。新下载实现的真实Desktop落盘仍待独立重载验证，不将测试替身当作实机通过。

HTTP：`POST /api/alm/requirements/exchange?root=<workspace>`，Content-Type为application/json；action为initialize/export/preview/apply。旧项目先用独立请求`{"action":"initialize"}`初始化项目密钥（UI「初始化交换」按钮）；此动作不带format，幂等且不轮换。其余动作format为json/xlsx。export返回filename/mime/content(base64)/bytes；preview/apply传filename/content，apply另传expectedLocalHash。成功200；校验400、项目冲突/CAS409、不支持格式415，跨origin403，非POST405。请求12MiB、文件8MiB；底层安全限制详见架构文档。所有exchange动作均先通过`humanSubjectFor(req)`调用宿主Connection.admit认证，再解析文件或访问项目；匿名返回401/403，非可信人类/owner主体返回403，body.actor不能提供身份。同源检查仅防跨站请求，不能代替认证。不带Connection的显式本地单用户组合保持既有行为；不改变旧公共接口。不允许payload选择root。

Excel 表头为中文，只有六列：`需求编号 / 项目 / 标题 / 需求描述 / 优先级 / 负责人`（第 1 行即表头并已冻结；此前版本的首行版本信息与 操作/客户端标识/基线哈希 三列已移除，旧版文件请重新导出）。只有「标题 / 需求描述 / 优先级 / 负责人」可改；「需求编号」是行身份，「项目」必须保持导出时的值；长 brief（>3 万字）使用隐藏的 Brief 表 C 列续块；该表可留可删——删掉后长描述从校验过的元数据回填，导入不会失败。record/chunk 及隐藏元数据只读。附件只有 manifest，不含二进制。新增需求：在末尾追加一行，把「需求编号」留空并填写标题等内容即可（清空某行编号等于新增，请勿误删）；重复编号、重复内容、外来项目或未改标题的追加行都会被拒绝。新增 brief 受 Excel 单格 32767 字符限制；现有长 brief 仍支持续块，JSON 支持 1MiB。不能按同名标题猜 UID，不能伪造更新行。工作簿只强制要求 `Requirements` 与隐藏的 `_Metadata` 两张表，额外的工作表（随手记、草稿）会被忽略。经 Excel / WPS「另存为」后的工作簿同样可导入：编辑器写入的目录条目（如 `xl/worksheets/`）、Windows 反斜杠路径与共享字符串（sharedStrings）都会被规范化接受；损坏、改名冒充 .xlsx 或含宏/外部链接的文件会被拒绝，并给出「另存为 → Excel 工作簿(.xlsx)」等可执行提示。

无改应用不写磁盘。HMAC密钥经独立初始化持久化；export/preview不写，未初始化返回409 exchange-uninitialized，初始化后首个导出包即可跨独立进程回导。普通写失败全批回滚，崩溃journal存在时fail closed，需人工恢复；不保证外部不合作读写隔离。当前构建因沙箱spawn EPERM未通过，未宣称现有Desktop完成验证。

## REQ-ALM-007 调查消息预算

消息序列化优先完整 snippet，再文件元数据，最后 tree；system + user 共不超过 25000 个 UTF-16 字符。导出 builder 拒绝非规范 boundary 元数据（计数字段须为非负安全整数，截断标记须为布尔值），最终预算超限也明确返回 400，不返回超限消息。逐条装入完整 JSON，装不下的条目整体遗漏且继续尝试后续条目，不截 quote 或整段 JSON。`boundary.messageBudget` 记录字符预算与实际字符数，以及 snippets/files/tree 的 original/retained/omitted 计数；采集截断与消息预算遗漏均明确披露。既有只读、根路径隔离、逐字引用验证及未知降级不变。本节为实现约定，Desktop 重载重放结果以 RUN-008 实际记录为准。

## REQ-ALM-015 默认「待我处理」视图

进入需求插件时默认选中「待我处理」工作视图（`DEFAULT_REQUIREMENT_VIEW = 'mine'`），而不是「全部」。该视图复用既有 `matchesView(item, 'mine')` 语义：待人工决策、补充回答、确认/验证缺陷、待验收等需要人处理的需求可见；执行中但无需人工介入的需求与已关闭需求不在此视图。列表顺序不自作主张：服务端 `sortRequirements` 已按 `createdAt` 倒序返回（同一时刻再按需求 ID 倒序），客户端筛选只过滤、不重排。项目切换仍回到该默认视图；同一浏览器会话内用户主动切到其他视图后刷新会保留其显式选择。升级前会话在首屏持久化过旧的「全部」默认，它从未是人类显式选择，因此导航 schema 升到版本 5 后旧记录不再掩盖新默认（迁移一次）。实现见 `client-source.js`，回归覆盖 `test/default-view.test.mjs`、`test/list-query-axes.test.mjs` 与 `test/query-sort.test.mjs`。

## 打开页面

需求详情以当前进展和下一步为首屏中心：需求内容只展示非空的目标、问题、功能及必要业务约束，旧正文中重复的背景/目标只读去重；长段落可展开。完整原文、来源和内容标识放在折叠区，整理描述工具默认折叠，构建/部署工具移到「查看技术信息」。待验收阶段默认展开验收要求，其他阶段保持简短验证结论；未绑定或过期证据不会被显示为通过。此改造只调整阅读投影，不修改需求正文、执行提示、AC 或运行记录。隔离组件验证记录见 `artifacts/human-detail-20261105/`，真实 Desktop 验证仍需重载本地插件后进行。

2026-11-05 进一步根据 grilling 设计拷问重构导航与 AI 进展：固定页签「需求正文 / AI 进展 / 历史记录」，顶部返回按钮明确区分正文与需求列表。正文与进展页共享当前状态和主操作，刷新是次操作；取消、归档、删除进入更多操作。进展默认展示最后活动、最新真实事件、阻碍及当前验证，完整 DeliveryWorkspace 位于「技术记录与检查依据」折叠区；原生 GUI 验证会实际展开后检查原有六个技术分区。过期结果统一显示「历史通过，当前已过期」，当前适用性不明也不使用成功色。记录有界保留最新 50 条而非最早 50 条，AI 建议锚点与实际分区一致。没有实时推送或百分比，页面明确需要刷新获取最新状态。更多菜单仅对开放运行显示取消；执行中禁用生成候选。设计与隔离验证见 `artifacts/progress-ux-grilling-20261105/`，真实 Desktop 操作仍待用户验证。

后续运行观察改造：AI 进展可查看关联运行和会话段的对话、轨迹及用量，并在宿主提供 `uiWorkspace.openSession` 时打开原生会话。`GET /api/alm/requirements/run-observation` 由服务端校验需求与运行的关联，优先调用 DSH `sessionQuery.observeSession(sessionId, { projectionMode: 'none' })` 复用宿主 revision cache/lease，复制事件后释放 lease；旧宿主才回退 `readSession` 和持久化读取。活跃执行通过进程内流事件展示临时片段，落盘消息才用于回放。宿主的完整日志回放没有历史范围游标，因此首次超大日志仍需完整验证，响应分页不等于存储分页。旧运行的会话段可能不完整，非文本内容目前只标明未展示，常见凭据按共享规则脱敏，不能保证识别所有敏感信息。用量只读取本机 billion-context 中会话 ID 精确匹配且有账本的记录，缺失为未知，费用为当前会话段估算而非账单；默认探测 `127.0.0.1:18787`，其他端口可由宿主环境变量 `ALM_BILI_PORT` 指定。此节不代表实时流和原生导航已完成真实 Desktop 端到端验收。

1. DSH 内：点左侧边栏「需求」图标（`sidebar.panellist`，id `requirements`），或 Settings → Requirements；两处都直接渲染需求列表，页面里也有 “Open as main panel”。
2. 浏览器直接打开：`http://127.0.0.1:<DSH 端口>/alm/requirements`（服务端渲染、只读、无需 token）。

> 注意：`http://127.0.0.1:<端口>/` 是 DSH GUI 入口，必须使用 `dsh web` 打印的带 token URL；直接打开会返回 401 `dsh web authentication required`。插件页面请用上面的 `/alm/requirements` 或 DSH 内的 Settings。

## 约束

- 工作区链接安装不能 `import` `@deepseek-ai/*`；本包只用 `ctx.tools`、`ctx.webServer` 与浏览器 `fetch`。
- 默认根目录是仓库的 `fixtures/order-refund`；可在 bundle 配置 `root` 覆盖。
- 页面文本为中文，使用宿主主题 token（`--dsw-alias-*`），不写死品牌色/白字。

## 宿主构建与更新

开发详情与启动窗口每 3 秒串行同步后台状态；后台刷新保留当前内容，隐藏窗口暂停请求。开发分支以 Git 实际分支为准，变更记录另外保存计划分支，不把计划名称当成分支创建结果。

人工验收窗口显示需求正文中的验收条目；旧需求没有内嵌条目时，使用真实 `verified_by` 测试资产的标题。逐项勾选和总确认完成后才可签收，服务端校验用户看到的候选编号与内容标识，签署主体来自宿主认证。

发布窗口遵循 `develop → main`：准备/复用 PR，核对检查、评审和分支保护，显式合并固定提交，回读 PR 与提交历史后记录成功并将当前版本归入「已关闭」。关联 GitHub 的项目不能再通过手填执行结果登记成功。历史本地发布记录保留，缺失 GitHub 凭据时明确披露未验证。该流程不代替环境部署、标签或 GitHub Release。真实远端发布验证须在正常提交、集成和保护配置完成后进行；隔离测试不能代表真实合并已发生。

本地修改宿主或 alm-core 后，先执行 `node packages/dsh-plugin-requirements/build-host.mjs`。宿主入口是同目录 `host.bundle.js`，将本地域模块一起构建，避免 Desktop 仅重载插件入口、却继续使用旧的传递 ESM 缓存。各模块资源 URL 保持相对于源模块的位置；移动完整仓库后仍有效。不要手工编辑生成物。首次从旧入口切换需经插件管理器重新安装；后续重建后重载插件。客户端入口保持不变。构建依赖使用仓库已有 esbuild。

## 验证

```powershell
node --test "packages/dsh-plugin-requirements/test/**/*.test.mjs"
# 安装后：alm_requirements 调用、Slots.listSubTree root=main 出现 requirements
```

## Living Spec：Stage 1 接口

`POST /api/alm/requirements/intent` 的 `action: "crystallize"` 接受 `summary`、`messages` 或 `draft`（`title`、`goal`、`problem`、`acceptance`）。仅提取有明确标签的文本；不能可靠提取时返回 `not-ready`。提供 `investigationIds` 会复核已保存的代码行引用；未提供时预览会调用配置的模型运行 Investigation，返回调查 ID。预览返回 `draftHash` 和 `investigationIds`，确认时提交相同输入、调查 ID、`draftHash` 和 `apply: true`。确认会重新校验调查并绑定预览内容。

`POST /api/alm/requirements/convergence` 提供 `triage`（`feedback`）、`propose`（`requirementId`、`runId`、`kind`、完整 `afterBrief` 和 `evolutionNote`）以及 `confirm`（`requirementId`、`runId`、`deltaHash`）。分流是保守建议，无法判断时返回 `needs_review`；补丁需要可信人类确认，并核对补丁与需求基线。同一运行的补丁使用递增序号保存；每次确认基于当前需求版本，过期补丁必须重新生成。收敛后重新生成候选，旧验收授权不会自动转移。
