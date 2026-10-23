# ADR 0003：AI Native ALM MVP 的工程落点与技术选型

- 状态：已采纳（2026-10-23，Q1–Q4 全部按本 ADR 决策）
- 日期：2026-10-23
- 决策者：peterzhanghao
- 关联：[产品蓝图](../product/ai-native-alm-mvp.md)、[架构](../planning/architecture.md)、[技能化方案](../planning/skill-plan.md)

## 背景

MVP 需要在 DeepSeek Harness 44.7.0 中交付两个业务插件、一个共享 core、一套确定性门禁和可重建基线。现状约束：

1. 本仓库已有 Issue/PR 技能、CI 校验与台账，产品代码尚无落点。
2. 本机有 Node 26.7.0、pnpm 10.30.3、git 2.48.1，`python` 不在 PATH。
3. DSH 插件通过 Cordis bundle 安装；Host 侧注册 Service/Tool，Client 侧注册 Slot。
4. 蓝图要求 StrictDoc 与 Gitea，但两者都会把外部依赖压进关键路径。

## 决策

### D1. 产品代码落在本仓库 `packages/`（monorepo）

在 `AI_ALM` 内建立 `packages/*` 与 `fixtures/`，复用现有工作流、CI 与台账。

**备选**：新建独立仓库。**否决原因**：需要再维护一套工作项/分支/技能与两套 CI；MVP 阶段协作成本大于隔离收益。样例资产仍是独立 Git 仓库，由 `scripts/demo-init.ps1` 生成，不污染产品仓库。

### D2. Node ESM + JSDoc，无构建步骤

`alm-core` 与插件全部为 ESM JavaScript；类型用 JSDoc，必要时 `tsc --checkJs`；测试用 `node:test`。

**备选**：TypeScript + 构建。**否决原因**：DSH 插件直接加载 ESM，构建产物会引入“源码/产物不一致”的验证成本；MVP 阶段运行时校验比编译期类型更能直接产出门禁证据。代价：接口约束靠契约测试补足，重构时缺编译期保护。

### D3. 自研 StrictDoc `.sdoc` 子集解析，StrictDoc 仅作可选渲染

解析器覆盖 `[DOCUMENT]/[SECTION]/[REQUIREMENT]/[RELATION]` 与 `UID/TITLE/STATUS/OWNER` 字段；StrictDoc 渲染作为可选证据（`REN-001` 的增强项），不进入必须路径。

**备选**：StrictDoc 硬依赖。**否决原因**：本机无 Python，pip 安装与版本锁定会成为开工阻塞；格式兼容性用样例 + 可选渲染验证兜底。风险：真实 StrictDoc 语法超出子集时需扩展解析器，已用 `FMT-001` 明确报错而非静默丢弃。

### D4. SCM 抽象为适配器，本地 Git 先行

`alm-scm` 定义 `ScmProvider`（分支、PR、必需检查、审批、合并）；先实现 `local-git`（bare repo + 本地 PR 记录 + 脚本化 CI），再实现 `github` / `gitea`。

**备选**：直接接入 Gitea Docker。**否决原因**：领域规则（ID/关系/覆盖/基线）与托管平台无关；平台环境问题不应阻塞领域闭环。代价：MVP 演示的“PR 门禁”先由本地 provider 证明，Gitea 作为独立验收项（ALM-04.01）。

### D5. 技能是一等交付物

产品技能（`alm-change-workflow`、`alm-requirements`、`alm-architecture`）与开发技能（`alm-mvp-dev`）随产品版本化，进 `packages/alm-skills/`（产品）与 `.dsh/skills/`（开发），纳入验收与 CI 校验。

**备选**：把流程知识留在插件说明或提示词里。**否决原因**：不可版本化、不可测试、换 Agent 即失效；与“AI 原生”目标冲突。

### D6. 契约版本化，规则包独立版本

资产/证据/审批/基线/发现五类契约带 `schema` 版本；门禁规则包 `pack.json` 独立版本。证据记录两者，基线清单锁定规则包版本。

**否决**：规则与工具同版本号。**原因**：规则放宽/收紧需要独立审计，不能靠工具升级隐式发生。

## 影响

正面：

- 少一套仓库与流程；CI、技能、台账直接复用。
- 无构建步骤，`node bin/alm.mjs check` 即可验证，AI 与人都能复现。
- 外部依赖（StrictDoc/Gitea）降级为适配器与可选证据，领域闭环可先验收。

代价与约束：

- 无编译期类型保护，靠契约测试与运行时校验；接口变更必须同步契约版本。
- 本地 SCM provider 不是真实托管平台，验收报告需明确“已证明/未证明”。
- 解析器只覆盖子集，遇到真实 StrictDoc 高级语法需显式报错并排期扩展。

## 待确认

- Q1 是否同意产品代码入本仓库 `packages/`。
- Q2 是否同意本地 SCM 先行、Gitea 后置。
- Q3 是否同意 StrictDoc 仅作可选渲染。
- Q4 是否同意技能作为一等交付物。
