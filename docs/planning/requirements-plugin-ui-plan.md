# 需求插件 UI 实施规划（原型 v7 → 插件）

> 原型：`docs/design/requirements-workbench-prototype.html`（v7，已合并 PR #105）
> 目标：把原型里的工作台交互逐块落到 `packages/dsh-plugin-requirements`，每块有真实数据源、测试与截图证据。

## 1. 现状

插件当前只有一张表：`ID / Title / Status / Owner / Coverage / Next`，加一个简易详情卡与追踪缺口列表。
原型已经是：卡片列表 + 状态筛选 + 项目切换/聚合 + 右侧抽屉 + 详情页 + 评审/版本/追溯/开始/验收/新建。

两者之间的差距全部是**数据契约 + 视图**两层，按“只读 → 只读写操作”的顺序推进，避免先做写接口再返工视图。

## 2. 模块映射与数据来源

| 原型模块 | 插件视图 | 现有数据源 | 缺口 |
|---|---|---|---|
| 卡片列表、状态筛选、搜索 | 工作台 v2 | `indexReport` + `checkReport` | 无 |
| 项目切换、全部项目聚合 | 工作台 v2 | `/api/alm/projects`、`listProjects` | 聚合接口 `?project=ALL` |
| 项目徽标、PROJECT 归属 | 工作台 v2 | 需求 asset `extra.project` / 项目文件 | payload 增加 `project/projectName` |
| 抽屉：背景/来源/附件 | 工作台 v2 | `brief`、`sources`、`attachments/manifest.json` | `briefText`、附件明细 |
| 抽屉：关系/验收覆盖 | 工作台 v2 | `links`、`verifiedBy`、`gaps` | 无 |
| GitHub 归属（Issue/标签/看板/子议题/PR） | 工作台 v2 | `.alm/github.json`、`.alm/project.json` | payload 增加 `github` 与 `projectInfo` |
| 评审报告（5 角色 + findings） | ALM-08.02 | 无（原型为演示数据） | 新增 `.alm/reviews/<REQ>.json`（`alm.review/v1`） |
| 版本对比 / 快照 | ALM-08.03 | `REVISION`、changes/、git | 变更历史契约（`.alm/versions/<REQ>.json` 或读取 `changes/*`） |
| 追溯图形视图 | ALM-08.03 | `links` 已足够 | 图布局在前端完成 |
| 开始开发 / 运行验收 / 新建向导 | ALM-08.04 | `alm task draft/workspace/ci`、intake | 宿主写接口 + 权限/审计 |

## 3. 卡片拆分

### ALM-08.01 工作台 v2：列表 / 筛选 / 项目聚合 / 抽屉 / 详情 / GitHub 归属

- 实施范围：`packages/dsh-plugin-requirements/{query.mjs,index.js,client.js,test}`。
- 交付：卡片列表（状态色、ID、修订、优先级、覆盖率、附件/来源、GitHub Issue 徽标、看板状态）、状态筛选与搜索、项目选择（全部项目聚合）、右侧抽屉、详情弹层、GitHub 归属区块（仓库/Issue/标签/看板/任务子议题/PR 占位）。
- 数据：`requirements()` 增加 `project/projectName/briefText/attachmentFiles/github`、`projectInfo`；新增 `requirementsAll(projects)` 与 `?project=ALL`。
- 不做：任何写操作；评审/版本/追溯视图。

### ALM-08.02 评审与版本视图

- 先补 `alm.review/v1` 与版本历史契约（可由门禁 + 变更记录推导），再实现抽屉“评审”与“历史/版本对比”。
- 验收：无报告时显示“未评审 + 发起评审入口（只读提示）”；有报告时展示角色结论与 findings；版本对比只读。

### ALM-08.03 追溯图形视图与影响面

- 基于 `links` 在抽屉/详情生成可点击节点图；点击需求节点切换当前需求，其他类型节点提示跳转位置。
- 影响面：上级/子需求/验收/依赖计数与 `alm impact` 口径一致。

### ALM-08.04 写操作：开始开发 / 运行验收 / 新建需求

- 宿主新增写接口（仅本地、需确认），复用 `alm task draft`、`workspace create`、`ci run`、intake 解析器。
- 验收：每次写操作返回命令、退出码、证据路径；失败不落半成品。

## 4. 本轮交付

ALM-08.01：插件从“表格”升级为“卡片列表 + 抽屉/详情 + 项目聚合 + GitHub 归属”，保留原有根目录切换、提示词复制与追踪缺口。完成后全量测试、Playwright 宿主实测截图，再进入 ALM-08.02。
