# GitHub 工作项与 PR 工作流

> 仓库：`peterzhanghao/AI_ALM`。`main` 为默认分支，`develop` 为日常集成分支。创建 Issue、PR、标签或里程碑前先回读远端现状。

执行时使用两个项目技能：

- 工作项：[`ai-github-issue-workflow`](../../.dsh/skills/ai-github-issue-workflow/SKILL.md)
- PR：[`ai-github-pr-workflow`](../../.dsh/skills/ai-github-pr-workflow/SKILL.md)

## 事实来源

| 文档 | 作用 |
|---|---|
| `docs/development/github-workflow.md` | 本文件：约定与边界 |
| `docs/development/regression-ci.md` | 自动化回归泳道、证据契约与 Issue 回写 |
| `docs/planning/architecture.md` | ALM MVP 模块边界、契约与命令面；执行卡的技术依据 |
| `docs/planning/issue-register.md` | 规划键、GitHub 编号、状态与回读时间的唯一台账 |
| `docs/planning/task-breakdown.md` | 每张卡的交付范围与验收 |
| `docs/adr/` | 影响接口、数据结构或流程的决策 |

GitHub 上的 Issue、PR、标签是实时协作事实；仓库文档是规划与快照。两者不一致时按 `local-newer` / `remote-newer` / `conflict` 显式记录，不静默覆盖。

## 分支模型

```text
执行 Task → feature/alm-<key>-<slug> → PR → develop → Task 收口
```

- `main`：默认分支与发布基线，只接受 `develop` 的发布合并。
- `develop`：日常集成，所有功能 PR 的目标分支。
- `feature/*`：一个 Task 一条，命名 `feature/alm-01-02-agent-version`。
- 发布流程（`develop → main`、标签、Release Notes）在首个可发布版本前单独定义。

## 工作项层级

```text
ALM-00 总控 Issue
└─ ALM-01… 领域跟踪 Issue
   └─ ALM-01.02 执行 Task
      └─ ALM-01.02.01 子 Task
```

- `ALM-*` 是稳定规划键，GitHub `#编号` 由平台分配；两者在台账中一一映射。
- 原生层级用 sub-issue（`gh issue create --parent`）表达。
- 依赖用 `blocked-by` / `blocking` 有向关系；`relates to` 仅导航。
- 一个执行 Task = 一人 + 一分支 + 一 PR + 一条可独立验收的路径。

## 标签

| 组 | 取值 |
|---|---|
| 类型 | `type::tracking`、`type::task`、`type::bug`、`type::feature` |
| 规划 | `planning::execution`（仅执行项） |
| 状态 | `status::backlog` / `blocked` / `ready` / `in-progress` / `review` / `done`（唯一） |
| 优先级 | `priority::P0` / `P1` / `P2` |
| 领域 | `domain::*`（按实际模块扩展） |
| 回归 | `regression::passed` / `regression::failed`（合并后自动维护） |

首次使用运行 `scripts/setup-github.ps1` 创建标签与 `develop` 分支，并启用分支保护。

## 发布门禁

只有台账该行 `确认结论=确认发布`，且 Owner、类型、范围、依赖、验收（正例 + 反例）齐备，才允许创建远端 Issue。`待确认` / `需修改` / `暂缓` / `不发布` 一律只留草案。

## 写入与回读

1. 写入前核对 `gh auth status`、仓库路径、目标 Issue 最新状态。
2. 写入后回读编号、类型、父项、标签、依赖、状态。
3. 回读一致才更新台账为 `in-sync`，记录时间。

```powershell
gh issue view <n> --json number,title,state,labels,assignees,milestone,url
gh pr view <n> --json number,url,state,isDraft,baseRefName,headRefName,mergeable,mergeCommit
```

## 评论

- Issue：阶段成果、阻塞与解除、范围/契约决定、验收证据变化。
- PR：新一轮改动与固定 SHA、检查结果、评审处理、下一步。
- 不按每次提交刷评论；关闭时的交付记录是最后一条明确结果。

## PR 与合并

1. PR 目标 `develop`，验收未完成保持 Draft。
2. checks 全绿（`ALM MVP CI` 的 `test-obligation`、`regression-gate` 与 `validate-skills`）、评审通过、无冲突后合并。
3. 合并后回读 `mergedAt` / `mergeCommit`。
4. **合并到 `develop` 不会自动关闭 Issue**——closing 关键字只对默认分支生效，必须显式 `gh issue close`。
5. 关闭后重算下游 blocked-by，全部前置关闭才可置 `ready`。

## 自动化回归

- PR 阶段：`ALM MVP CI` 并行运行 `unit`、`contract`、`fixtures`、`cli`、`skills` 五条泳道；`regression-gate` 要求全部泳道都有当前提交的证据且结果为通过，缺一即红。
- 测试义务：`test-obligation` 检查源码变更是否同时带测试/夹具；没有则要求 PR 正文给出 `Test-Exemption: <理由>`。新增测试放在 `packages/*/test/` 即被 `pnpm test` 自动发现，不需要注册。
- 合并阶段：PR 合并到 `develop` 或 `main` 后，`Issue regression` 在 `merge_commit_sha` 上复跑同一套泳道；聚合证据保留 30 天，泳道证据保留 14 天。
- 回写：工作流评论 PR 与关联 Issue，并维护 `regression::passed` / `regression::failed`；同一提交重跑更新原评论，不刷屏。失败不会自动重开 Issue，按评论定位后修复并重跑。
- 手动补跑：

```powershell
gh workflow run issue-regression.yml --ref develop -f pr=44
gh workflow run issue-regression.yml --ref develop -f ref=<sha>
```

细节、证据格式与扩展方式见 [自动化回归与 Issue 收口](regression-ci.md)。

## 阶段边界

当前处于项目初始化阶段：文档、模板、脚本等基线可由负责人在 `develop` 直接提交并记录 SHA。进入 Issue 驱动开发后，恢复“一 Task、一分支、一 PR”。发布、版本标签与 `main` 合并流程尚未定义，不得自行发明。
