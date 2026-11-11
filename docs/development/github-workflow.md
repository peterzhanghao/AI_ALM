# GitHub 工作项与 PR 工作流

> 仓库：`peterzhanghao/AI_ALM`。`main` 为默认分支，`develop` 为日常集成分支。创建 Issue、PR、标签或里程碑前先回读远端现状。

执行时使用两个项目技能：

- 工作项：[`ai-github-issue-workflow`](../../.dsh/skills/ai-github-issue-workflow/SKILL.md)
- PR：[`ai-github-pr-workflow`](../../.dsh/skills/ai-github-pr-workflow/SKILL.md)

## 事实来源

| 文档 | 作用 |
|---|---|
| `docs/development/github-workflow.md` | 本文件：约定与边界 |
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
- 需求插件发布路径为 `develop → main` 的独立 PR，见下文。版本标签与 GitHub Release 暂不由该操作创建。

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
2. checks 全绿、评审通过、无冲突后合并。
3. 合并后回读 `mergedAt` / `mergeCommit`。
4. **合并到 `develop` 不会自动关闭 Issue**——closing 关键字只对默认分支生效，必须显式 `gh issue close`。
5. 关闭后重算下游 blocked-by，全部前置关闭才可置 `ready`。

## 阶段边界

初始化基线的直提例外不适用于需求插件中的日常开发。需求开发遵守“一 Task、一分支、一 PR”，功能集成到 `develop` 与发布到 `main` 分开记录。

## 需求插件发布与关闭（2026-11-05）

用户确认的发布含义是：已验收的集成提交通过发布 PR 合入 `main`。这不是环境部署、GitHub Release 或打标签。

1. AI 在独立功能分支开发，按 Conventional Commits 提交本需求改动，经功能 PR 合入 `develop`。禁止把工作区中其他未提交改动批量纳入需求提交。
2. 在 `develop` 的固定提交完成技术检查与人工验收，工作区交付快照必须完整且无未提交文件；本地提交须等于 GitHub `develop`。
3. 发布窗口只提供「准备发布 PR」和条件满足后的「合并到主分支并关闭需求」。准备阶段生成/复用本地授权和对应发布 PR，不登记发布成功。
4. 插件合并前必须核验主分支启用了至少一项必需检查和至少一个评审，PR 检查全成功、评审通过、无冲突、非 Draft；合并指定的 head SHA，不使用管理员绕过。
5. 合并后回读 PR、合并提交和主分支历史，证明已验收提交已进入 `main`，再写发布回执，将当前需求版本推导为「已关闭」。网络中断不算成功；重试核对原 PR，避免重复合并。
6. 本地历史发布记录继续保留，并归入「已关闭」；缺少 GitHub 合并凭据时明确标记未验证，不能将它作为真实主分支发布证明。新需求版本独立推进。

仅定义并实现插件流程，不代表远端保护已配置。管理员仍需在 GitHub 启用 `main` 的评审与必需检查保护；本地 CI 配置现已覆盖 `main` 的 PR/push，但须正常提交集成后才会在远端生效。
