# GitLab 工作项与 MR 工作流

> 本仓：`eic/software-architecture/ai-platform`。回查基线：默认分支 `main`，`origin/develop` 存在；已发布 57 张任务＋一个总览；项目无里程碑。创建或维护工作项、里程碑、MR 前仍须回读远端。

执行时使用两个项目技能：

- 工作项：[`ai-gitlab-issue-workflow`](../.dsh/skills/ai-gitlab-issue-workflow/SKILL.md)
- MR：[`ai-gitlab-mr-workflow`](../.dsh/skills/ai-gitlab-mr-workflow/SKILL.md)

日常工作项与 MR 维护用 `glab issue`、`glab mr` 的创建、查看、更新、评论命令即可；原生 Work Item 层级或 CLI 未提供的字段再用 `glab work-items` / `glab api`，不要求所有协作者直接维护复杂 GraphQL。

## 事实来源与入口

- 冻结语义以 M0 规范为准；一期承接与裁剪见 `docs/agent-platform/first-phase-scope.md`、`repository-ownership-matrix.md`、`source-task-crosswalk.md`、`task-implementation-spec.md`。
- 规划编号、入口 Issue、父项及叶子录入方法见 `gitlab-work-item-structure.md`；任务正文见 `task-breakdown.md`。GitLab 原生 `#IID` 与 `AAGP-*` 规划键分别记录，不能混用。
- 发布前以 `task-confirmation-register.md` 逐项确认；发布后该表记录仓库内状态快照、GitLab IID、MR、同步结论和回读时间。
- GitLab 写入后的工作项、关联、状态和 MR 是协作事实；文档保存规划、决定和回读快照。
- `AAGP` 是历史稳定规划前缀，项目更名不改编号；跨仓切片使用 AP 后缀。

## 工作项粒度与关系

首批 P0 子集采用 `P-01`～`P-05` 范围跟踪 Issue，Owner 暂为平台架构组、个人待认领；正文保存源码基线、交付物、正反例和有向 `Blocked by`。使用 `type::tracking`、`priority::P0`、`phase::p0-contract-control`、适用领域和单个状态标签，不带 `planning::execution`，不虚构里程碑或原生子项。

一个执行 Task 应能由一人通过一个 MR 交付，并有独立的正反例验收。领域父项是跟踪 Issue；大卡若拆成多个 MR，原编号成为跟踪 Issue，子编号成为原生 Task。当前实例观察到的原生层级是 `Issue → Task`；总控到领域父项、领域父项到大卡跟踪 Issue 用清单和可点击关联表达，不伪装成原生三级树。发布前在新项目回查类型能力。

每张 Task 还必须只有一个主实现仓库。Foundation 通用机制的规划归属是 `ai-foundation-framework`，外部 Owner 独立建项、MR 并提供真实 URL 后再建立跨仓阻塞关系。Foundation 完成通用能力后，平台仍需做领域投影和集成验收。

`Blocked by` 或实例支持的有向阻塞关系表达先后；`relates to` 只表达相关。依赖解除时回读全部前置，不能因一项完成就把仍有前置的任务改为 ready。任务改范围、拆分或取消时，同步维护父项清单、下游依赖、编号表和本地任务正文。

## 标签与状态

跟踪项不带 `planning::execution`。执行项使用当前项目存在的 `planning::execution`、一个适用的 `domain::*`、一个 `phase::*`、一个 `status::*`；P0/P1 和里程碑由获准的排期决定。**目前没有项目里程碑**，不能复制旧项目的里程碑 ID 或假定已绑定。

状态建议为 `blocked → ready → in-progress → review → done/closed`，更新时移除旧 `status::*`；旧项目没有 `status::done` 标签，新项目使用前先核验或创建。

## GitLab 写入前后

每批远端写入前核对当前认证身份、准确项目路径、目标工作项/MR 的最新标题、描述、类型、父项、标签、依赖、状态及目标分支。创建 Task 时按当前实例实际支持的 Work Item 类型和字段操作，不照抄旧项目的 GraphQL 类型 GID、标签 GID、里程碑 GID 或 CLI 故障绕法。认证、权限或回读失败时保留本地草案，并报告实际结果。

创建或更新后通过 API 回读 IID、URL、类型、父项/清单、标签、里程碑、描述中的依赖和状态。只有回读一致才报告“已同步 GitLab”。

任何创建、层级/依赖/标签/状态调整、MR 关联或关闭操作，回读后都要在同一工作时段更新 `task-confirmation-register.md`。GitLab 是实时协作事实，台账是仓库快照；两边不一致时用 `local-newer`、`remote-newer` 或 `conflict` 显式记录，不能静默覆盖。

## 处理中如何留评论

执行 Task 的正文承载稳定的目标、范围、依赖和验收。处理过程中若有阶段成果、阻塞及解除、契约或范围决定、验证证据，在对应工作项下留下评论：写清本次变化、可回读的 MR/固定 SHA/测试证据、对验收与下游的影响和下一步。决策改变正文中的范围、依赖或验收时同步修改正文；不按每次提交刷流水账。

持续推进的 MR 在新一轮可观察改动、验证结果、评审意见处理或阻塞变化时补评论，写明本轮提交 SHA、结果和待处理项；当前总体范围与风险持续维护在 MR 描述，代码行讨论在原线程回复。任务级决策写回 Issue/Task，评审过程留在 MR，互相附真实链接。每次远端评论前核对身份和目标，写入后回读评论内容与 ID。

## 开发与合并

远端实际分支名为 `develop`，不是 `devlop`。当前开发阶段的完整路径是：

```text
执行 Task → feature/<aagp-key>-<slug> → MR → develop → Task 收口
```

`develop` 是当前集成终点。功能 MR 合并到 `develop`，回读合并 SHA、pipeline 和 Task 状态并完成交付记录后，本次流程结束。当前不继续创建 Release MR，不合并 `main`，不打版本标签，也不触发生产发布。

开始开发先读目标执行 Task、主实现仓库、前置结果和工作树；已有本地改动属于用户，需保留。先更新远端引用，再从最新的 `origin/develop` 创建普通功能分支，命名 `feature/<aagp-key>-<slug>`，例如 `feature/aagp-02-04-agent-version`。一个分支对应一个执行 Task，一个 MR 只修改一个仓库；发现跨仓或独立范围先更新工作项结构。

提交采用可审查的 Conventional Commits，正文用新项目真实 `Refs #IID`。MR 目标为 `develop`，描述写清变更、验证命令与结果、契约兼容性、风险/回滚及 `AAGP-*` 与真实 Issue 链接。尚未满足验收时保持 Draft。

合并前核实评审、适用门禁和固定 commit SHA。GitLab 当前项目设置是普通 merge、squash 默认关闭，流程不假定一定产生 squash commit；合并后回读实际 merge commit、MR 状态和 pipeline 结果。在执行 Task 留下交付记录：实现范围、验证证据、偏离原计划的决定、未交付项和下游影响；再核对关闭状态与标签。`Closes #IID` 只能作关联提示，不能替代回读。最后逐项回读下游全部前置，再调整 ready 状态。本地规划快照标注回读日期，CI、本地运行、SIT 和生产证据分开报告。

一期执行工作项尚未发布前，任务拆分、规范和 skill 等初始化基线可由负责人直接提交到 `develop`，记录固定 commit SHA 后结束。这一例外不延续到后续功能开发。Release 分支、`develop → main`、版本标签、回合并和生产发布流程，等一期功能完整并确定发布策略后再单独补充，当前不预设。
