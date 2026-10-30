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

- 复用 `syncRequirementIssues` / `syncTasks`，在「开始开发」确认后可选建需求 Issue + 任务子议题 + ProjectV2 状态；写 `.alm/github.json`；失败不阻断本地变更。
- 依赖：工作区已关联 GitHub 仓库。

### ALM-09.03 需求级验收证据契约（item 2）

- 新增 `.alm/acceptance/<REQ>/<sha>.json`（`alm.acceptance/v1`）：白名单命令、退出码、耗时、SHA、输出摘要；服务端执行/记录，UI 展示证据与签收。
- 与 `alm ci run` 的门禁证据区分：验收针对需求登记的检查命令。

### ALM-09.04 版本 diff 对比（item 5）

- 在 git 快照基础上解析两个版本的 sdoc 字段，输出字段级 diff（标题/状态/优先级/关系/验收）与门禁影响；UI 版本行支持「对比当前」。

### ALM-09.05 AI 评审执行器 + 人工签收（item 4）

- `.alm/reviews/<REQ>.json`（`alm.review/v1`）保存五角色结论与 findings；执行器基于门禁 + 结构化检查生成报告；人工签收记录绑定版本哈希，内容变化自动失效。

### ALM-09.06 开始开发切分支/隔离 worktree（item 1）

- 在现有变更登记（不切分支）之上增加可选的隔离 worktree：`git worktree add` 到 `.alm/worktrees/<CHG>`，不移动主工作区；失败回滚 worktree 与变更记录。
- 默认仍走「只登记」，需显式选择隔离工作区。

### ALM-09.07 新建向导接入 OCR/聊天入库（item 3）

- 新建需求向导支持文本/截图/聊天记录来源：截图走本地 OCR（`ocr_image` 等价服务）、聊天走 `intake/chat.mjs` 解析；引用位置写入 brief/attachments，再进入确认创建。

## 3. 本轮交付

ALM-09.01：工作区项目空间 + 关联 GitHub 仓库 + 新建按钮修复 + Playwright 全流程回归。完成后跑全量测试、更新台账，并进入 ALM-09.02。
