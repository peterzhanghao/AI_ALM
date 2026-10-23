---
name: ai-gitlab-issue-workflow
description: "ai-platform 仓库的 GitLab 工作项（Issue/Task）工作流：拆分层级、发布门禁、正文模板、glab 写入与回读、标签状态、台账同步、进展评论。用户要新建、调整或关闭 GitLab Issue/Task 时使用。"
whenToUse: "需要拆分或创建 GitLab Issue/Task、调整父子层级或 Blocked by 依赖、修改 status::* 等标签、写工作项进展评论、关闭工作项或同步任务确认台账时。"
metadata:
  version: "2.0.0"
  owner: "platform-architecture"
  updated: "2026-10-23"
---

# ai-platform GitLab 工作项工作流

## 0. 运行约定（DeepSeek Harness）

- 所有命令通过 `pwsh` 工具执行；读取文档用 `read`/`grep`/`glob`，写入用 `write`/`edit`。
- 工作目录必须是 `ai-platform` 仓库根；第 2 节任一事实源缺失时，停止远端写入并报告缺失路径。
- 远端写入有外部副作用，只在用户明确要求发布或维护工作项时执行；仅讨论任务文档时只产出本地草案。
- 命令失败时保留草案并报告阻断，不换写法绕过，不重复重试。
- 本文件引用的 `references/` 相对本 skill 目录解析，按需读取，不要预加载。

## 1. 适用与不适用

| 场景 | 是否使用本 skill |
|---|---|
| 新建、拆分、调整、关闭 Issue/Task | 是 |
| 修改父项、`Blocked by` 依赖、标签、状态 | 是 |
| 写工作项进展评论、同步任务台账 | 是 |
| 只讨论或撰写任务文档 | 用本 skill 的模板，但不写远端 |
| 代码提交、分支、MR、合并 | 否，改用 `ai-gitlab-mr-workflow` |

## 2. 事实源（写入前必读，只读相关章节）

| 文档 | 用来确认 |
|---|---|
| `docs/gitlab-workflow.md` | 仓库约定、标签、当前阶段边界 |
| `docs/agent-platform/task-confirmation-register.md` | 发布门禁、同步快照与回读时间 |
| `docs/agent-platform/gitlab-work-item-structure.md`、`issue-id-map.md` | 入口、父子结构、稳定编号规则 |
| `docs/agent-platform/task-breakdown.md`、`task-implementation-spec.md` | 逐卡目标、依赖、验收与实施细节 |
| `docs/agent-platform/repository-ownership-matrix.md` | 主实现仓库与跨仓责任 |
| `docs/agent-platform/source-task-crosswalk.md` | 原始条款与当前任务的复用/差异决策 |

原文已有的 API 路径、SPI 方法与事件字段应逐项复用；无法复用的差异写进卡片并走契约评审。

## 3. 层级与拆分规则

- `AAGP-00` 总控 → `AAGP-01`～`AAGP-10` 领域跟踪 Issue → `AAGP-xx.yy` 执行 Task → `AAGP-xx.yy.01` 子 Task。
- 原生层级只有 `Issue → Task`；三段编号是规划键，不得描述成已存在的原生三级树。`AAGP` 是历史稳定前缀，不随项目改名。
- 一个执行 Task = 一人 + 一个 MR + 一个仓库 + 一条可独立验收的交付路径。
- 大卡确需多个 MR 时，`AAGP-xx.yy` 降级为跟踪 Issue，子项成为其原生子 Task。
- `Blocked by` 表达执行先后，`relates to` 只做导航；改前置时同步全部下游、父项清单与台账。
- 跨仓改动另建工作项（Foundation 类用 `AFF-*`），不塞进同一个 Task 或 MR。
- 发布前核实新项目可用的工作项类型与父子能力，不能把规划编号说成已存在的远端结构。

## 4. 发布门禁（硬性）

只有台账对应行 `确认结论=确认发布`，且 Owner、类型/拆分、优先级、实施仓库、跨仓前置、依赖、契约/接口、正反例验收全部确认，才允许创建远端工作项。

`待确认`、`需修改`、`暂缓`、`不发布` → 只产出草案，并说明缺哪一项、需要谁确认。

为尽快拿到 IID 而发布半成品描述是明确禁止的。

## 5. 执行步骤

1. 读第 2 节中与目标卡相关的章节，确认当前范围决策；编号存在不等于已排期或已授权实施。
2. 按第 3 节判断该卡是跟踪 Issue、执行 Task 还是子 Task，列出父项、依赖与主实现仓库。
3. 按第 4 节过门禁；不通过则输出草案 + 阻断原因并结束。
4. 用 `references/issue-body-template.md` 生成正文；内容必须针对该卡，禁止把同一段领域模板复制给所有子项。
5. 用 `references/glab-issue-commands.md` 中的命令写入；写入前先核对认证身份、准确项目路径与目标工作项最新状态。
6. 回读 IID、URL、类型、父项/清单、标签、里程碑、状态与依赖。
7. 更新台账的 `GitLab IID/URL`、`GitLab 状态`、`本地状态`、`同步状态`、`最后回读`。
8. 需要时按第 8 节补一条进展评论。

## 6. 标签与状态

| 对象 | 标签 |
|---|---|
| 跟踪 Issue | `type::tracking`，不带 `planning::execution` |
| 执行 Task | `planning::execution` + 一个 `domain::*` + 一个 `phase::*` + 一个 `status::*` |

- 状态机：`blocked → ready → in-progress → review → closed`。
- 换状态时先摘旧 `status::*`，任何时刻只保留一个。
- 只有全部前置解除才能置 `ready`。
- 缺少所需标签时先处理标签配置，不能静默省略。
- 里程碑只用当前项目真实存在且获准的对象，不照搬旧项目 ID。

## 7. 回读与台账同步

1. 写入前同时读取本地行与远端当前值；两边都有不同变更时标记 `conflict`，人工合并后再写。
2. 本地决定尚未写远端 → `local-newer`；远端已变但未落库 → `remote-newer`。
3. 远端写入后必须回读；一致后填实际 IID/URL、state、`status::*`、MR、时间并标记 `in-sync`。
4. 普通过程评论不复制进台账；评论改变状态、范围、依赖、验收或交付证据时才更新对应字段。
5. 关闭时本地状态填 `closed`，记录最终 MR 与 merge commit 证据；暂缓用 `deferred` 并保留原因。
6. 本地台账提交遵循 MR 工作流；无法提交时如实保留 `remote-newer`，不得说成已同步。

## 8. 进展评论

只在出现**可验证的阶段结果、阻塞或解除、范围/契约决定、验收证据变化**时写；不按每次提交刷评论，不把未验证的尝试写成完成。

```markdown
### 进展更新
- 已完成/发现：本次有意义的变化
- 证据：MR、固定 SHA、测试或回读结果
- 影响：验收项、范围、依赖或下游变化；没有则写“无”
- 下一步：下一动作或需要谁确认什么
```

写入前核对项目、工作项与身份；写入后回读评论 ID 与内容。关闭时的交付记录是最后一条明确的结果评论。

## 9. 失败与例外

- 认证、权限或类型能力无法确认 → 保留草案，报告阻断对象与所需权限。
- `glab work-items` 在部分版本仍是实验性接口 → 先看 `glab work-items --help`，写入后回读。
- 回读内容与预期不一致 → 报告实际值、差异与影响，不宣布“已同步”。
- 远端不可达 → 记录本地进度与待同步项，下次继续。

## 10. 红线清单

- [ ] 台账该行是“确认发布”，不是“待确认/需修改/暂缓”。
- [ ] 正文里的 IID 是回读到的真实值，不是规划键或推测值。
- [ ] 没有把 `AAGP-*` 规划键当 GitLab IID 使用。
- [ ] 父项、依赖、标签、状态与实际一致。
- [ ] 写入后有回读，台账已更新。
- [ ] 评论只记录有意义的变化。

## 参考文件

- `references/issue-body-template.md`：工作项正文模板。
- `references/glab-issue-commands.md`：认证、查询、创建、更新、评论与回读命令。
