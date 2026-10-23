---
name: aerok-gitlab-mr-workflow
description: "在 aerok-ai-platform 开始 Issue 驱动开发、提交代码、创建或更新 MR、评审合并与收口时使用。"
---

# AEROK AI Platform GitLab MR 工作流

## 当前开发阶段的分支模型

远端实际开发分支名是 `develop`，不是 `devlop`。当前阶段只维护下面这条交付链：

```text
执行 Task → feature/<aagp-key>-<slug> → MR → develop → Task 收口
```

- `develop` 是当前集成终点。功能 MR 合并到 `develop`、回读合并结果并完成 Task 记录后，本次开发流程结束。
- `main` 暂不接收普通功能 MR；Release 分支、版本标签、`develop → main`、回合并及生产发布流程，等一期功能完整并确认发布策略后另行补充。
- 在执行工作项尚未发布前，任务拆分、规范和 skill 等项目初始化基线可由负责人直接提交到 `develop`，并记录固定 commit SHA。这是启动阶段例外；进入 Issue 驱动开发后恢复一 Task、一 feature 分支、一个 MR。

正常功能开发按以下顺序推进：

1. 回读执行 Task、全部前置和验收，将 Task 置为 in-progress。
2. 更新远端引用，从最新 `origin/develop` 建立一个 `feature/*` 分支。
3. 实现、验证、提交并推送该分支；提交关联新仓真实 IID。
4. 创建目标为 `develop` 的 Draft MR，补齐变更、验证、风险和 Task 链接。
5. 后续修改继续推到同一分支、同一 MR；有意义的阶段变化按本 skill 留评论。
6. 自测和 MR 信息完整后转为 Ready，完成评审及适用门禁。
7. 合并到 `develop`，回读实际 merge commit、MR 状态和 pipeline 结果。
8. 回填并关闭 Task、重新计算下游依赖；本次开发结束。

## 确认任务和现场

先确认当前工作是文档规划，还是已有新仓真实 `#IID` 的执行 Task。规划阶段可继续完成本地文档，不虚构 GitLab Task 或 `Refs #IID`。进入实现时读目标 Task 的正文、主实现仓库、全部 `Blocked by`、验收和上游交付；从仓库根目录读取 `docs/development/gitlab-workflow.md`、`docs/agent-platform/task-breakdown.md`、`docs/agent-platform/task-implementation-spec.md`、`docs/agent-platform/repository-ownership-matrix.md`，契约或复用判断再读 `docs/agent-platform/source-task-crosswalk.md` 和 `docs/agent-platform/README.md` 指向的规范源。具体执行状态以新仓 GitLab 回读为准。

开始实现时按 [Issue 工作流](../aerok-gitlab-issue-workflow/SKILL.md) 将真实执行 Task 更新为 `status::in-progress`；自测和 MR 资料完成、MR 已创建后更新为 `status::review`。写入失败时记录实际代码进度和待同步差异，不能把本地进度当作远端状态。

检查 `git status`，保留用户已有修改；并行分支优先用 worktree。核实远端分支与目标项目后，先更新远端引用，再从最新的 `origin/develop` 创建 `feature/<aagp-key>-<slug>`，例如 `feature/aagp-02-04-agent-version`。创建 MR 前重新确认目标分支为 `develop`。一个分支处理一个可独立验收的 Task，一个 MR 只修改一个仓库；平台 Task 不得夹带 Foundation 源码，Foundation 通用能力必须使用其项目的独立 Task、分支和 MR。范围扩张先更新工作项。

## 实现与提交

- 用可审查的提交和 Conventional Commits；新仓真实 IID 存在时，在提交正文写 `Refs #<IID>`。`AAGP-*` 是规划键，不代替 GitLab IID；跨仓引用使用完整项目路径。中间提交不使用 `Closes`。
- 开始跨仓依赖卡前回读 Foundation 工作项、MR、目标 release 和制品。Foundation 合并 commit、发布制品和平台集成结果分别记录，不能用其中一种证据代替另一种。
- 按风险更新测试、契约和中文文档。公共 API、数据库、事件、权限、Runtime 或部署行为变化要说明兼容性与回滚。冻结 M0 与一期决定冲突时记录契约版本/ADR，不直接改原规范。
- 公共 API、契约字段和代码注释按 [代码注释规范](../aerok-code-comment-convention/SKILL.md) 维护；解释语义、原因和不变量，避免复述语句本身。
- 提交前按 [格式与静态检查](../aerok-code-format/SKILL.md) 对改动模块执行格式化与检查（backend 为 `mvn spotless:apply/check`，前端与 agent-runtime 为 format/lint/format:check），只处理本次改动范围。
- 提交前运行与改动相称的验证，记录准确命令、结果与固定 SHA。不要把源码存在、CI 绿色、本地启动、SIT 或生产当成同一种证据。
- 不提交凭据、个人配置、临时日志或构建产物；不通过覆盖用户文件或 `reset --hard` 清理现场。

## 创建和评审 MR

创建或更新远端 MR 前核对认证身份、目标项目 `eic/software-architecture/aerok-ai-platform`、源/目标分支、执行 Task 最新状态与必需检查。旧仓的固定 `-R/-H` 参数、SSH 路径、GraphQL ID 和 CLI 故障绕法不直接迁入。

日常 MR 操作用 `glab mr` 即可：

```bash
glab mr create -R eic/software-architecture/aerok-ai-platform --target-branch develop --draft
glab mr view <IID> -R eic/software-architecture/aerok-ai-platform --comments
glab mr note create <IID> -R eic/software-architecture/aerok-ai-platform --message '<本轮更新>' --resolvable=false
glab mr update <IID> -R eic/software-architecture/aerok-ai-platform --ready
```

命令参数以当前安装版本的 `glab <命令> --help` 为准；普通创建、查看、评论和状态更新不需要直接拼 REST/GraphQL 请求。CLI 没暴露的字段再使用 `glab api`，并在写入后回读 MR。

普通功能 MR 以当前 `develop` 为目标；验收未完时保持 Draft。描述至少包含：

```markdown
## Summary
本 MR 解决的任务和可观察结果。

## Changes
- 关键模块、契约、迁移或配置变化。

## Verification
- `准确命令`：结果、固定 SHA，以及制品或环境证据。

## Risks / Rollback
兼容影响、未覆盖项、回滚条件和方法。

## Issue
新项目 Task URL；AAGP 规划键；默认使用 Refs #<IID> 关联，确定要在合并时尝试自动关闭才使用 Closes #<IID>。
```

创建或更新后回读 MR URL、源/目标分支、Draft 状态、关联 Task 和 pipeline。评审意见涉及代码时在同一分支修复并补验证；必需检查或目标状态不可验证时，不宣称可以合并。

## 持续推进中的评论

MR 跨多个可观察阶段推进时，在 MR 下按**有意义的变化**补评论：新一轮改动和固定 SHA、验证或 pipeline 结果、评审意见的处理、阻塞及下一步。保持 MR 描述反映当前整体范围、风险与验证结论；过程记录用评论，代码行问题在原讨论线程回复。无需每次 push 都发评论，也不要重复发布同一条流水账。

任务级范围决定、前置变化和交付影响同时回填对应 Issue/Task；MR 评论给代码评审者看本轮变化，Issue 评论给任务协作者看进度和决策。两边用真实链接互相指向，避免复制整段内容。远端评论前核对目标 MR 与身份，写入后回读评论 ID 和内容。

```markdown
### 本轮更新
- 变更：相对上一轮新增或修正的内容
- 提交：固定 SHA
- 验证：命令/pipeline 与结果
- 评审处理：已解决的讨论及仍未解决项
- 下一步：下一轮目标或当前阻塞
```

开发或评审中若出现可重复的 Java、前端、契约、测试或交付规范，按 [开发规范沉淀](../aerok-practice-learning/SKILL.md) 整理证据，在自然节点询问开发者是否转为项目 skill。未经确认不创建规范，不把当前 Task 的临时决定扩大成全仓规则。

## 合并收口

当本次工作已授权推进合并及工作项收口时，按以下顺序执行并逐项回读：

1. 确认 MR 已合并到 `develop`，记录实际 merge commit、pipeline 和评审结果；若当次启用了 squash，再同时记录 squash commit。
2. 在执行 Task 留下交付记录：实现范围、固定 SHA、验证命令与结果、实施中修正的缺陷或决策、未交付项以及下游影响。
3. 核对 Task 是否实际关闭；`Closes #IID` 不保证本实例自动关闭。若需要手动关闭，同步清理旧 `status::*`，不能留下“关闭但仍在 review”的矛盾状态。
4. 对每个下游 Task 回读**全部**前置；只有所有前置都关闭，才可改为 ready。同步本地规划索引并标注回读日期。
5. 到此结束当前功能开发流程；不自动创建 Release MR、不合并 `main`、不打版本标签，也不把 `develop` 合并说成 SIT 或生产发布。

远端写入或回读失败时，报告已确认的实际范围和剩余差异。Release、`main`、版本标签、SIT 和生产发布流程当前未定义，待完整功能阶段结束后单独评审和补充。
