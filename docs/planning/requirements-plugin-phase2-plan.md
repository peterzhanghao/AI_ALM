# 需求插件第二阶段规划（工作区项目空间 + 写路径补全）

> 前置：第一阶段（ALM-08.01–08.04）已把原型 v7 的只读视图与写操作主路径进入插件，收口于 `8327b30`。
> 本阶段来源：用户 2026-10-31 反馈——新建按钮空白、UI 全流程需 Playwright 验证、项目空间应取 DSH 工作区（剔除默认工作区）并支持关联 GitHub 仓库，以及补做 1–6 全部项。

## 1. 关键决定

1. **项目空间 = DSH 工作区**：读取 `~/.dsh/storages/workspace.json`（`DSH_WORKSPACES_FILE` 可覆盖），排除 `global.defaultWorkspaceId` 指向的默认工作区；工作区存在 `.alm/project.json` 即为已关联项目，否则标记「未关联仓库」。
2. **关联仓库 = 写工作区根 `.alm/project.json`**：新增 `POST /api/alm/projects/associate`，UI 二次确认后写项目文件并创建 `requirements/`；同时回读 git remote 给出是否一致提示。
3. **主题安全按钮**：primary 按钮用 `label-primary / bg-base` 反色对，而不是 brand 填充 + 白字（单色主题下 brand 为白色会导致白底白字）。
4. 1–6 项全部排期，按「先只读/契约、后写路径」推进。

## 2. 卡片

### ALM-09.01 工作区项目空间 + 新建按钮修复 + UI 全流程回归（本轮）

- `workspaces.mjs`：工作区列表、默认工作区剔除、项目文件解析、缺失路径标记；`DSH_WORKSPACES_FILE` 覆盖。
- `associateProject`（alm-core）：写/更新 `.alm/project.json`、创建需求根、remote 一致性提示。
- `/api/alm/projects` 改为工作区来源；`?project=ALL` 聚合工作区；`POST /api/alm/projects/associate`。
- 客户端：工作区选择、未关联标记、关联/更新关联弹窗、未关联时新建引导先关联、按钮反色修复。
- 验收：Playwright 全流程 14 项断言（工作区列表/关联/列表/评审/版本/追溯/开始/验收/新建）+ 主题对比度验证。

### ALM-09.02 GitHub Issue 自动创建进插件（item 6）

- `github-sync.mjs`：`previewGithub`（无网络，输出需求 Issue 标题/正文/标签与 3 个任务子议题标题）、`applyGithub`（复用 `syncRequirementIssues` + `syncTasks`，创建/复用需求 Issue、任务子议题、ProjectV2 Ready，逐条写 `.alm/github.json`）。
- `POST /api/alm/requirements/github`：默认 preview，`apply:true` 才调用 `gh`；未关联项目/无任务草稿返回 409/404。
- UI：开始开发生成变更后出现「GitHub 归属」，可预览再显式创建；成功后刷新抽屉 GitHub 区块。
- 依赖：工作区已关联 GitHub 仓库；真实创建需要 `gh auth`。
- 验收：单测用 fake provider 覆盖 create/adopt/skip 与幂等；eval 只验证 preview（不向真实仓库建单）。

### ALM-09.03 需求级验收证据契约（item 2）

- 配置：`.alm/acceptance/<REQ>.json`（`alm.acceptance.config/v1`），命令为数组 `{id, command: ["node","..."], timeoutMs?}`；二进制白名单 `node/npm/pnpm`，**无 shell**，最多 10 条、单条 ≤10 分钟。
- 证据：`.alm/acceptance/<REQ>/<headSha>.json`（`alm.acceptance/v1`），含每条命令的退出码、耗时、stdout/stderr 尾部（各 ≤20KB）、整体结果与时间戳；同一提交重复运行覆盖为最新。
- 服务端：`runAcceptance`（plan 默认不执行/不写；apply 才执行并归档）+ `POST /api/alm/requirements/acceptance`；查询 payload 带 `acceptance` 摘要（是否登记/命令数/最近证据/是否当前提交）。
- UI：抽屉与详情「验收执行」显示登记与最近证据；「运行需求验收」弹层先预览命令，再运行并展示逐条 exit code/耗时/输出；与「运行门禁检查」（`alm ci run`）区分。
- 验收：单测覆盖 plan 零写入、pass/fail 证据、白名单拒绝、缺配置；HTTP 预览/执行；eval 全流程运行真实 `node` 命令并落证据。

### ALM-09.04 版本 diff 对比（item 5）

- `version-diff.mjs`：`diffRequirementVersions` 用 `git show <ref>:<path>` 读取两版 sdoc，解析为字段/关系后输出 `alm.version.diff/v1`（字段 before/after、关系增删、summary）；默认 `to=worktree`，只读不写。
- `GET /api/alm/requirements/diff?root&asset&from&to`；非法 ref 400，未知提交/资产 404。
- UI：版本行「对比当前」→ 字段表（旧值删除线 → 新值）+ 关系增删 + summary；与只读快照并列。
- 验收：字段级 diff 与关系增删由 git 提交对比验证；eval 用两版 demo 需求展示 TITLE/STATUS/PRIORITY 变化。

### ALM-09.05 AI 评审执行器 + 人工签收（item 4）

- `alm-core/src/review/executor.mjs`：五角色评审从 `reviewFromGates` 生成，运行后写 `.alm/reviews/<REQ>.json`（`alm.review/v1`，含 requirement/headSha/generatedAt/contentHash/roles/summary/signoff）。
- 内容哈希 = 需求字段 + 关系 + brief 文件字节的 sha256；签收记录 `{actor:"human:<login>", decision:"approve", at, headSha, contentHash}`，内容变化后 `signoffValid=false` 并拒绝再次签收（`review-stale`）。
- 端点：`POST /api/alm/requirements/review`（preview 不写、apply 保存报告）、`POST /api/alm/requirements/signoff`（校验 human actor、报告存在、无阻塞、内容未变）。
- UI：评审区块显示报告是否已保存/来源、签收人及有效性；「运行评审」弹层预览后保存报告，「人工签收」输入 `human:<login>` 确认。
- 验收：无报告/坏 actor/有阻塞/内容变化分别拒绝；保存后签收有效；query payload `review.stored/signoffValid`；eval 完成运行评审 + 签收。

### ALM-09.06 开始开发切分支/隔离 worktree（item 1）

- `openChange({isolate})`：默认只登记变更/任务卡（不动工作区）；`isolate:true` 时在仓库同级 `.alm-worktrees/<repo>-<chg>` 执行 `git worktree add -b <branch> <path> <baseline>`，变更记录与任务卡写在工作区内，主工作区保持干净。
- 失败清理：worktree 创建后任何写盘/任务草稿失败都会 `git worktree remove --force` 并删分支；路径/分支已存在直接 409。
- UI：开始开发弹层增加「创建隔离 worktree」勾选，重新预览显示路径；结果展示 worktree 路径/分支。
- 验收：worktree 分支正确、变更/任务卡只出现在 worktree、主工作区无 CHG 文件；默认（不勾选）行为不变。
- 默认仍走「只登记」，需显式选择隔离工作区。

### ALM-09.07 新建向导接入 OCR/聊天入库（item 3）

- 新建向导三来源：文本 / 截图 OCR / 聊天记录；截图走本地 PP-OCRv5（`runOcr`），聊天走 `parseChatMarkdown`，返回逐行/逐条 `#L` 引用与置信度。
- 原始材料作为附件随需求创建归档到 `requirements/attachments/<REQ>/`：文件 + `manifest.json`（sha256/kind/capturedAt/addedBy）；附件名白名单，失败整体回滚。
- 端点：`POST /api/alm/requirements/intake`（chat/ocr，body 上限 12MB；OCR 临时文件即用即删）；`POST /api/alm/requirements/create` 支持 `attachments[]`（base64 或文本）。
- UI：CreateModal 标签页切换来源，「使用 OCR/聊天内容为背景」，预览/结果显示附件数；OCR 显示逐行置信度，聊天显示 `chat.md#L<n>`。
- 验收：真实 OCR 识别中文截图；聊天解析 3 条消息；创建后附件与 manifest 落盘；OCR 引擎缺失/超大图片有明确错误。

### ALM-09.08 需求详情侧栏可读性（体验补丁）

- 侧栏宽度 560 → 720px（`max-width: 95vw`），头部 sticky：状态/ID/修订 + 标题 + 负责人/优先级/项目 chips。
- 内容按属性分三组卡片，用左侧色条区分：**需求背景**（brand）/ **质量与验收**（success）/ **归属、关系与历史**（neutral）；组内子块用分隔线，标题降级为小号大写标签。
- 评审行按 verdict 加左侧色条与底色（通过绿 / 建议黄 / 阻塞红 / 未覆盖灰）；验收覆盖改为绿色 pill；验收执行保留登记命令与最近证据两行。
- 不改变数据与交互，仅客户端样式；`pnpm test` 全量通过。

## 3. 本轮交付

ALM-09.07：新建向导接入 OCR/聊天入库——三来源标签页，截图走本地 PP-OCRv5、聊天走 `parseChatMarkdown`，均带 `#L` 引用；附件 + manifest 随需求创建归档，失败整体回滚。第二阶段 ALM-09.01–09.07 全部完成。
ALM-09.08：需求详情侧栏加宽到 720px，按背景 / 质量验收 / 归属历史分卡片，评审与验收用状态色块提升可读性。
