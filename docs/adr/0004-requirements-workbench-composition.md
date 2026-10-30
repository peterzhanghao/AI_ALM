# ADR 0004：需求管理工作台采用组合式，而不是整体替换

- 状态：提议（Proposed）
- 日期：2026-10-30
- 关联：[评估报告](../analysis/requirements-plugin-evaluation.md)、[任务拆解](../planning/task-breakdown.md)、[权限模型](../development/permissions.md)

## 背景

现有需求插件只有一张只读表，用户打开后不知道“下一步做什么”。同时，DSH 生态里出现了两个强相关插件：

- **TeamFlow**（MIT）：一句话需求 → 分档流水线（PRD/设计/技术/并行开发/QA/验收），有看板与“命令+退出码+断言数”的防假交付；实测分诊可用，但数据在 `$DSH_HOME/teamflow`，需求不落 Git。
- **SpecFlow**（Apache-2.0）：13 步规格工作台，修订会使旧证据过期，有人工接纳；但精确锁 `engines.dsh=0.2.1-rc.2`，在当前 rc.5 上被宿主拒绝安装，数据在 `$DSH_HOME/specflow`。

本项目的差异点是“需求作为仓库资产 + 确定性门禁 + 审批绑定 SHA + 不可变基线”，三者都依赖 `.sdoc` 在 Git 里。整体替换会丢掉这些能力。

## 决策

采用**组合式**，四层分工：

| 层 | 归属 | 说明 |
|---|---|---|
| 需求资产与追踪 | **ALM core（自研）** | `.sdoc` + 关系 + `alm check` + `alm diff/impact` + evidence |
| 变更/规格约定 | **OpenSpec 布局** | `changes/<id>/{proposal,design,tasks}.md` 与现有 ChangeSet 对齐 |
| 执行与证据口径 | **TeamFlow 语义** | 档位（patch/lite/medium/tech/full）、命令+退出码+断言数、人工验收结论行；不复制其存储 |
| 任务看板 | **外部化** | GitHub Issues（默认）或 `dsh-kanban`(Gitea)；不写拖拽看板 |
| 交互 | **薄工作台（自研 UI）** | 需求台 / 追踪台 / 变更台 + “下一步”引擎 + 空态引导 |

**不采用**：

- fork SpecFlow 或 TeamFlow 作为底座（数据模型与门禁不兼容，且 SpecFlow 锁死宿主小版本）；
- 把需求或证据存到 `$DSH_HOME`（会丢 Git 审计与基线）；
- 自研看板/拖拽（已有成熟实现）。

## 后果

正向：

- 保留可审计的需求资产与门禁；同时获得“AI 分档 + 证据口径 + 验收”的成熟经验。
- UI 只需实现“看清与下一步”，不重做执行引擎。
- 任务看板可替换（GitHub / Gitea / 未来其他），不绑死。

代价与风险：

- 需要一层“需求 ↔ change ↔ 任务卡”的导出/导入（新增 `TASK-001` 覆盖门禁）。
- 依赖外部看板的状态回写时，需要凭据与幂等（沿用 `alm-scm` 的 Gitea 客户端）。
- TeamFlow/SpecFlow 若升级到兼容 rc.5，可作为可选执行器接入，但不得成为唯一路径。

## 替代方案

| 方案 | 结果 | 否决理由 |
|---|---|---|
| B：直接装 SpecFlow，改造成资产层 | 现成工作台 | 锁 rc.2；需求在 SQLite，改造成本高于组合 |
| C：直接装 TeamFlow 做交付 | 立刻有流水线 | 需求不落 Git、追踪弱，无法支撑审批/基线 |
| D：接禅道/OpenProject | 成熟需求系统 | 重运维；需求不在 Git；GPL/ZPL 只宜 API |

## 验证

- 评估证据见 [评估报告](../analysis/requirements-plugin-evaluation.md)；
- M1 完成后以 Playwright 验证空态、详情与“下一步”；
- `TASK-001` 以“需求无任务覆盖”为反例，必须 block。
