---
name: ai-github-issue-workflow
description: "AI_ALM 仓库的 GitHub 工作项工作流：Issue 类型与子议题、blocked-by 依赖、发布门禁、正文模板、gh 写入与回读、标签状态、台账同步、进展评论。用户要新建、调整或关闭 GitHub Issue 时使用。"
whenToUse: "需要拆分或创建 GitHub Issue、调整父子层级或 blocked-by 依赖、修改 status::* 等标签、写 Issue 进展评论、关闭 Issue 或同步问题台账时。"
metadata:
  version: "3.1.0"
  owner: "peterzhanghao"
  repo: "peterzhanghao/AI_ALM"
  updated: "2026-10-30"
---

# AI_ALM GitHub 工作项工作流

## 0. 运行约定（DeepSeek Harness）

- 所有命令通过 `pwsh` 工具执行；读文件用 `read`/`grep`/`glob`，写文件用 `write`/`edit`。
- 仓库：`peterzhanghao/AI_ALM`。命令默认在当前仓库内执行，跨目录时显式加 `-R peterzhanghao/AI_ALM`。
- 远端写入有外部副作用，只在用户明确要求发布或维护工作项时执行；仅讨论任务文档时只产出本地草案。
- 写入前先 `gh auth status`；未登录时停止并提示 `gh auth login`，不要改用匿名接口。
- 命令失败时保留草案并报告阻断，不换写法绕过，不重复重试。
- 本文件引用的 `references/` 相对本 skill 目录解析，按需读取。

## 1. 适用与不适用

| 场景 | 是否使用本 skill |
|---|---|
| 新建、拆分、调整、关闭 Issue | 是 |
| 修改父项、blocked-by 依赖、标签、状态 | 是 |
| 写 Issue 进展评论、同步问题台账 | 是 |
| 从需求生成任务卡并同步到 GitHub/Gitea | 是，见 5.1 与 `references/task-draft-sync.md` |
| 只讨论或撰写任务文档 | 用本 skill 的模板，但不写远端 |
| 代码提交、分支、PR、合并 | 否，改用 `ai-github-pr-workflow` |

## 2. 事实源（写入前必读，只读相关章节）

| 文档 | 用来确认 |
|---|---|
| `docs/development/github-workflow.md` | 仓库约定、标签、分支模型、当前阶段边界 |
| `docs/planning/issue-register.md` | 发布门禁、规划键与真实 # 编号映射、同步快照 |
| `docs/planning/task-breakdown.md` | 逐卡目标、依赖、验收 |
| `docs/planning/architecture.md` | 模块边界与 Owner（存在时） |

台账中没有记录的规划键，视为未规划，不得直接发到 GitHub。

## 3. 层级与拆分规则

```text
ALM-00 总控 Issue
└─ ALM-01…ALM-0N 领域跟踪 Issue
   └─ ALM-01.02 执行 Task
      └─ ALM-01.02.01 子 Task
```

- `ALM` 是本仓规划键前缀，与 GitHub `#编号` 一一映射后记录在台账；规划键稳定，`#编号` 由 GitHub 分配。
- 原生层级用 GitHub sub-issue 表达（`gh issue create --parent <n>`）；领域父项用清单链接汇总，不伪装成不存在的层级。
- 一个执行 Task = 一人 + 一个 PR + 一条可独立验收的交付路径。
- 大卡确需多个 PR 时，`ALM-xx.yy` 降级为跟踪 Issue，子项成为其 sub-issue。
- 依赖用 `--blocked-by` / `--blocking` 建立有向关系；`relates to` 只做导航。
- 需求派生任务（不合并需求）：`alm task draft` 默认生成 3 张卡，`TASK-001` 校验覆盖。
- 跨仓改动另建 Issue，不塞进同一个 Task 或 PR。
- 拆分或改前置时，同步所有下游、父项清单与台账。

## 4. 发布门禁（硬性）

只有台账对应行 `确认结论=确认发布`，且 Owner、类型、优先级、实施范围、依赖、验收（正例 + 反例）全部确认，才允许创建远端 Issue。

`待确认`、`需修改`、`暂缓`、`不发布` → 只产出草案，并说明缺哪一项、需要谁确认。

为尽快拿到编号而发布半成品描述是明确禁止的。

## 5. 执行步骤

1. 读第 2 节中与目标卡相关的章节，确认范围决策；规划键存在不等于已排期或已授权。
2. 按第 3 节判断该卡是总控、领域跟踪、执行 Task 还是子 Task，列出父项、依赖与实施范围。
3. 按第 4 节过门禁；不通过则输出草案 + 阻断原因并结束。
4. 用 `references/issue-body-template.md` 生成正文；内容必须针对该卡，禁止套用同一段模板。
5. 用 `references/gh-issue-commands.md` 中的命令写入；写入前核对身份、仓库、目标 Issue 最新状态。
6. 回读编号、URL、类型、父项、标签、依赖、状态。
7. 更新台账的 `GitHub #`、`状态`、`PR`、`同步状态`、`最后回读`。
8. 需要时按第 8 节补一条进展评论。

### 5.1 需求到任务卡

1. `alm task draft --change <CHG> --from <REQ-ID,...>` 生成 `changes/<CHG>/`。
2. `alm check`，`TASK-001` 必须 pass。
3. `node scripts/sync-tasks.mjs --change <CHG>` 预览；经人确认后加 `--apply` 并回读 `issue.number`。

详见 `references/task-draft-sync.md`。

## 6. 标签与状态

| 对象 | 标签 |
|---|---|
| 总控 / 领域跟踪 | `type::tracking`，不带 `planning::execution` |
| 执行 Task | `type::task` + `planning::execution` + 一个 `domain::*` + 一个 `status::*` |
| 缺陷 | `type::bug`，按需叠加 `status::*` |
| 新能力 | `type::feature`，按需叠加 `status::*` |

- 状态机：`backlog → blocked → ready → in-progress → review → done`。
- 换状态时先摘旧 `status::*`，任何时刻只保留一个。
- 只有全部 `blocked-by` 关闭才能置 `ready`。
- 优先级用 `priority::P0/P1/P2`；里程碑只用仓库真实存在且获准的对象。
- 标签不存在时先跑 `scripts/setup-github.ps1` 或手工创建，不能静默省略。

## 7. 回读与台账同步

1. 写入前同时读取本地行与远端当前值；两边都有不同变更时标记 `conflict`，人工合并后再写。
2. 本地决定尚未写远端 → `local-newer`；远端已变但未落库 → `remote-newer`。
3. 远端写入后必须回读；一致后填真实 `#编号`、state、`status::*`、PR、时间并标记 `in-sync`。
4. 普通过程评论不复制进台账；评论改变状态、范围、依赖、验收或交付证据时才更新字段。
5. 关闭时填 `done`，记录最终 PR 与 merge commit；暂缓用 `deferred` 并保留原因。
6. 台账变更随 PR 提交；无法提交时如实保留 `remote-newer`，不得说成已同步。

## 8. 进展评论

只在出现**可验证的阶段结果、阻塞或解除、范围/契约决定、验收证据变化**时写；不按每次提交刷评论，不把未验证的尝试写成完成。

```markdown
### 进展更新
- 已完成/发现：本次有意义的变化
- 证据：PR、固定 SHA、测试或回读结果
- 影响：验收项、范围、依赖或下游变化；没有则写“无”
- 下一步：下一动作或需要谁确认什么
```

写入后回读评论 URL 与内容；关闭时的交付记录是最后一条明确的结果评论。

## 9. 失败与例外

- `gh` 未认证或无写权限 → 保留草案，提示 `gh auth login` / 申请权限。
- Issue 类型（`--type`）在当前仓库不可用 → 退回 `type::*` 标签，不阻塞流程。
- sub-issue 或依赖接口不可用 → 用正文清单 + `blocked-by` 文本表达，并在台账注明降级方式。
- 回读内容与预期不一致 → 报告实际值、差异与影响，不宣布“已同步”。
- 网络不可达 → 记录本地进度与待同步项，下次继续。

## 10. 红线清单

- [ ] 台账该行是“确认发布”，不是“待确认/需修改/暂缓”。
- [ ] 正文里的 `#编号` 是回读到的真实值，不是规划键或推测值。
- [ ] 没有把 `ALM-*` 规划键当 GitHub 编号使用。
- [ ] 父项、依赖、标签、状态与实际一致。
- [ ] 写入后有回读，台账已更新。
- [ ] 评论只记录有意义的变化。
- [ ] `sync-tasks --apply` 前先 dry-run 并说明将创建的 Issue 数。

## 参考文件

- `references/issue-body-template.md`：Issue 正文模板。
- `references/gh-issue-commands.md`：认证、查询、创建、更新、评论与回读命令。
- `references/task-draft-sync.md`：需求→任务卡→看板同步与幂等。
