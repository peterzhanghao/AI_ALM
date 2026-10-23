# AI Native ALM MVP 需求评审（第 1 轮）

- 评审对象：[`ai-native-alm-mvp.md`](../product/ai-native-alm-mvp.md)、[`deepseek-harness-creator-brief.md`](../product/deepseek-harness-creator-brief.md)
- 评审日期：2026-10-23
- 评审范围：产品边界、领域契约、宿主可行性、实施顺序、验收可判定性
- 结论：**通过**。Q1–Q4 已于 2026-10-23 确认为推荐方案，按“三层切片”进入批次 1；P0 契约缺口随批次 1/2 落地。
- 确认记录：Q1 本仓库 monorepo ｜ Q2 本地 SCM 先行、Gitea 后置 ｜ Q3 自研 SDoc 子集 + 可选渲染 ｜ Q4 技能作为一等交付物。
- 关联：[架构与模块边界](../planning/architecture.md)、[ADR 0003](../adr/0003-alm-mvp-engineering.md)、[技能化方案](../planning/skill-plan.md)

## 1. 产品意图（复述并校准）

把需求、架构决策、接口、数据定义、验收依据从“文档”变成**有稳定 ID、可版本化、可确定性门禁、可重建**的研发资产，让 AI 在 DSH 里完成：

```text
拉基线 → 建工作区 → 改资产（需求 + 架构 + 验收同属一个变更集）
      → 确定性门禁 → 差异/影响评审 → PR（人工审批绑定 SHA）
      → develop 预览 → 发布审批 → 不可变基线（可离线重建校验）
```

一句话判断标准：**能否从任一基线独立重建出字节一致的发布包**。这比“生成了多少文档”更接近产品价值，也直接决定 MVP 的技术选型。

## 2. 设计上成立的部分

| # | 设计 | 为什么成立 |
|---|---|---|
| 1 | 文本文件是唯一可编辑事实源，Git 是历史事实源 | 避免“双主”冲突；AI 与人都能用同一套 diff/review 工具 |
| 2 | 稳定资产 ID 与文件路径解耦 | 重命名/搬目录不破坏追踪关系；这是关系索引与影响分析的前提 |
| 3 | 确定性门禁与 AI 语义审查分层，模型不得覆盖硬门禁 | 把“可判定”和“需判断”分开，验收才可自动化 |
| 4 | 审批绑定 commit SHA，新提交使旧审批失效 | 直接对应真实评审风险；比“PR 已批准”更严格 |
| 5 | 客户端检查只做快速反馈，服务端复跑同版本规则 | 防止本地环境被绕过；证据可追溯 |
| 6 | 基线由 commit + 规则/工具版本 + 审批 + 证据 + 哈希构成 | 版本可复现的最小信息集 |

## 3. 问题清单

### P0：开工前必须处理

| # | 问题 | 依据/现象 | 影响 | 建议 |
|---|---|---|---|---|
| P0-1 | MVP 范围按“一人 / 一个 AI 团队”估算明显超载 | 蓝图必须交付含 2 插件 + 共享服务 + 6 类门禁 + 语义 diff + Gitea/CI + 基线 + 4 角色试点，粗算 ≥ 22 个可交付 PR | 要么长期无法验收，要么大面积降级 | 拆成 MVP-0/1/2 三层，每层有独立可验收出口（见第 5 节） |
| P0-2 | 宿主插件能力仍是假设 | 已探测：本机 DSH **44.7.0**，`cordis_inspect_list` 提供 Host Service / Client Slots 等 Provider，`plugin_manager` 支持从工作区目录安装 bundle；但“双插件 + 服务依赖 + 工具 + Slot”的端到端组合未验证 | 阶段 0 失败会导致插件层返工 | 阶段 0 先做最小插件 spike，产出可执行的验证清单；失败即按既定降级（CLI + MCP）并记录缺口 |
| P0-3 | 外部重型依赖压在关键路径上 | Gitea + Actions Runner 需要容器与网络；StrictDoc 未安装；Python 3.13.2 已装（`py -3.13` 可用，pip 25.0.1），但 `python`/`python3` 不在 PATH | 环境问题会伪装成“功能未完成” | SCM 抽象为适配器，本地 Git 先行；StrictDoc 只作为可选渲染器（见 P0-5 / ADR 0003） |
| P0-4 | 四个关键契约缺失 | 蓝图有“Agent 不得自批”“审批绑定 SHA”，但没有 Actor、Approval、Evidence、Baseline 的字段定义；没有规范化序列化规则，“重建一致”无法判定 | 验收 3/5/7 无法客观判定，实现各写一套 | 按第 4 节补齐契约后再开卡；契约文件进仓库并由门禁校验 |
| P0-5 | “必须两个插件”是硬验收，但降级路径未写清 | 验收 1 要求“可安装并启用两个业务插件”；brief 又说宿主受阻可降级 CLI/API | 降级后是否算通过没有判定标准 | 明确：两个独立可安装插件为 P0；若宿主 UI 受限，允许“同一插件内两个独立页面 + 两个独立 Skill”作为有条件通过，并单列缺口 |

### P1：MVP 内应解决

| # | 问题 | 说明 | 建议 |
|---|---|---|---|
| P1-1 | AI 语义审查没有数据结构 | 只说“带引用的发现与建议” | 定义 `alm.finding/v1`：`ruleHint`、`assetId`、`file`、`locator`、`severity`、`evidence`、`suggestion`；永远 advisory |
| P1-2 | “审批失效”的实现点未定义 | GitHub/Gitea 的分支保护语义不同（GitHub 有 dismiss stale reviews，Gitea 需自校验 head SHA） | 审批记录落服务端（文件或 DB），门禁 `APPROVAL-001/002` 校验 `approval.headSha == head` 且审批人 kind=human |
| P1-3 | 性能门槛缺样本与环境 | P95 < 2s / < 10s 未说明资产规模生成方式与机器 | 提供 1000 资产生成器 + 记录环境；MVP 只做趋势门槛，不做硬性阻断 |
| P1-4 | 技能没有作为产品交付物 | 蓝图交付物只有插件与 CLI；AI 侧的“流程知识”没有版本化载体 | 将 Skill 列为一等交付物（见 [技能化方案](../planning/skill-plan.md)），纳入验收 |
| P1-5 | 人/Agent 身份模型缺失 | 无组织目录，但需要判定“Agent 不能批准自己” | 最小 Actor 模型：`human:<login>` / `agent:<name>`；提交带 `Alm-Agent` trailer；审批记录必须 `kind=human` 且 actor ≠ 提交者 |

### P2：记录，不在本轮处理

| # | 问题 | 处理 |
|---|---|---|
| P2-1 | “不以文档数量衡量成功”与交付物中的文档包关系 | 明确产物 = 基线文件包 + 校验值，文档渲染只是视图 |
| P2-2 | 当前 `README.md`、`CHANGELOG.md`、`docs/README.md` 有未提交改动 | 保留用户改动；本轮文档与代码按一卡一 PR 提交，不夹带 |
| P2-3 | 试点指标（耗时、采纳率、漏检率）未定义口径 | 在 ALM-06.01 定义指标表与采集方式 |

## 4. 必须补齐的契约

契约先于实现，全部落在 `packages/alm-core/src/contracts/`，由 `alm contract verify` 自检。

### 4.1 Actor

```yaml
# .alm/actors.yml（样例仓库内，随 PR 评审）
actors:
  - id: human:peterzhanghao
    kind: human
  - id: agent:deepseek
    kind: agent
```

- 提交信息必须带 `Alm-Agent: agent:<name>`（AI 提交时）或 `Alm-Actor: human:<login>`。
- 审批记录只接受 `kind=human`；Agent 身份提交的变更不得由同一 Agent 审批。

### 4.2 Approval

```json
{
  "schema": "alm.approval/v1",
  "changeId": "CHG-2026-10-23-001",
  "headSha": "<sha>",
  "actor": "human:peterzhanghao",
  "kind": "human",
  "decision": "approve",
  "at": "2026-10-23T06:00:00Z",
  "evidenceRunId": "<run>"
}
```

门禁规则：`APPROVAL-001` 要求存在针对当前 head SHA 的 approve；`APPROVAL-002` 要求审批者 kind=human 且是变更集中作者身份之外的独立主体。旧 SHA 的审批不参与判定。

### 4.3 Evidence

```json
{
  "schema": "alm.evidence/v1",
  "runId": "run-20261023-0001",
  "repo": "order-refund",
  "baseSha": "<sha>",
  "headSha": "<sha>",
  "result": "pass",
  "rules": { "packVersion": "1.0.0" },
  "tool": { "name": "alm", "version": "0.1.0", "node": "v26.7.0" },
  "checks": [
    { "id": "ID-001", "status": "pass", "assets": [], "files": [], "message": "" }
  ],
  "artifacts": [{ "path": "dist/requirements.html", "sha256": "<hex>" }]
}
```

### 4.4 Baseline

- 清单字段：`sourceCommit`、`rules.packVersion`、`tool.version`、`approval`、`evidenceRunId`、`files[]（path/sha256/size）`、`contentHash`。
- 规范化：文件按 repo 相对路径字节序排序；JSON 键排序、LF、UTF-8、无尾随空白；`contentHash = sha256(canonical(files[]))`。
- 不可覆盖：同一 `sourceCommit` 已有清单时，只允许完全一致（哈希相同）的幂等重放，否则失败并保留旧记录。
- 校验：`alm baseline verify` 从 `sourceCommit` 重新读取文件并计算哈希，逐项比对。

### 4.5 Finding（AI 建议，advisory）

```json
{
  "schema": "alm.finding/v1",
  "source": "ai",
  "ruleHint": "COV-002",
  "assetId": "TEST-PAY-001",
  "file": "requirements/refund.sdoc",
  "locator": { "line": 42 },
  "severity": "warning",
  "evidence": "该验收用例未被任何需求 verified_by 引用",
  "suggestion": "在 REQ-PAY-001.links 增加 verified_by: TEST-PAY-001"
}
```

- 不得写入 `result` 字段，不得改变门禁退出码；只出现在评审视图与证据 `findings` 附件。

## 5. 范围收敛建议

| 层 | 目标 | 必须通过 | 预估 |
|---|---|---|---|
| **MVP-0 垂直切片** | 证明“宿主 + core + 样例 + 一条门禁”能跑通 | 安装最小插件；`alm check` 在样例仓库上给出通过/失败 JSON；样例资产可解析 | 2–3 天 |
| **MVP-1 领域闭环** | 证明“跨资产变更 + 全量门禁 + 差异/影响 + 双插件” | 验收 1、2、3；正例 1 次、负例 5 类；需求/架构两插件读同一数据源 | ~1 周 |
| **MVP-2 集成与发布** | 证明“PR 审批 + 幂等 CI + 不可变基线 + 恢复” | 验收 4、5、6、7；故障与重建演练 | ~1 周 |
| 试点评估 | 三次演练与指标 | 验收 8（评审结论） | 0.5 周 |

不在本轮：Gitea 强绑定、公网 StrictDoc、测试/缺陷管理扩展、GitHub 工作流迁移。

## 6. 决策点（需负责人确认）

| # | 决策 | 选项 | 推荐 | 理由 |
|---|---|---|---|---|
| Q1 | 产品代码落点 | A. 本仓库 `packages/` monorepo；B. 新建独立仓库 | **A** | 现有 Issue/PR 技能、CI、台账可直接复用；样例仓库仍是独立 Git 仓库，不污染产品仓库 |
| Q2 | SCM/CI 路线 | A. 本地 Git + 本地 PR/CI 模拟先行，Gitea 适配器后置；B. 直接 Gitea Docker | **A** | 门禁与基线逻辑不依赖托管平台；Gitea 适配器可独立验收，环境失败不阻塞领域闭环 |
| Q3 | StrictDoc 定位 | A. 自研 SDoc 子集解析 + StrictDoc 可选渲染；B. StrictDoc 作为硬依赖 | **A** | Python 3.13.2 可用但 `python` 不在 PATH、StrictDoc 未安装；硬依赖会把 pip/venv 引入核心路径，可选渲染仍可复现 |
| Q4 | 技能定位 | A. 技能是一等交付物（产品技能 + 开发技能）；B. 仅开发期内部使用 | **A** | “AI 原生”的核心是 AI 可执行的流程契约；技能不进验收就会退化成提示词 |

## 7. 评审门禁结论

| 检查项 | 结论 |
|---|---|
| 产品边界是否清楚 | 通过（明确不做的 7 项） |
| 是否可独立验收 | 需修改（补 4 个契约 + 3 层切片） |
| 是否有不可验证表述 | 需修改（性能门槛、AI 建议边界、降级通过标准） |
| 是否可开工 | 有条件通过（Q1–Q4 确认后） |

> 本文件为评审快照。Q1–Q4 确认后，结论与台账 `确认结论` 同步更新，并按 [`task-breakdown.md`](../planning/task-breakdown.md) 进入批次 1。
