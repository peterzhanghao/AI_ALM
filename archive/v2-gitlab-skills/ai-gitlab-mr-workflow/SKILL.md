---
name: ai-gitlab-mr-workflow
description: "ai-platform 仓库的 GitLab MR 工作流：从执行 Task 开 feature 分支、提交规范、Draft MR、评审推进、合并收口与下游依赖重算。用户要开发任务、提 MR、评审合并或收口时使用。"
whenToUse: "需要从 develop 创建 feature 分支、提交代码、创建或更新 MR、处理评审意见、合并到 develop 并关闭 Task 时。"
metadata:
  version: "2.0.0"
  owner: "platform-architecture"
  updated: "2026-10-23"
---

# ai-platform GitLab MR 工作流

## 0. 运行约定（DeepSeek Harness）

- 所有命令通过 `pwsh` 工具执行；读文件用 `read`/`grep`/`glob`，写文件用 `write`/`edit`。
- 工作目录必须是 `ai-platform` 仓库根；先确认当前是文档规划还是已有真实 `#IID` 的执行 Task。
- 远端写入（push、MR、评论、合并）只在用户授权范围内执行；命令失败时报告实际进度，不换写法绕过。
- 本文件引用的 `references/` 相对本 skill 目录解析，按需读取。

## 1. 适用与不适用

| 场景 | 是否使用本 skill |
|---|---|
| 开始执行 Task、创建分支、提交代码 | 是 |
| 创建/更新 MR、处理评审、合并收口 | 是 |
| 拆分或新建 Issue/Task、改状态与依赖 | 否，先用 `ai-gitlab-issue-workflow` |
| 只写文档、不涉及代码交付 | 不必要，直接按仓库文档约定执行 |

## 2. 当前阶段的分支模型

```text
执行 Task → feature/<aagp-key>-<slug> → MR → develop → Task 收口
```

- 集成终点是 `develop`；分支名拼写就是 `develop`，不是 `devlop`，创建前用远端引用核对。
- `main` 暂不接收普通功能 MR；Release 分支、版本标签、`develop → main`、SIT 与生产发布流程当前未定义，不得自行发明。
- 启动阶段例外：执行工作项尚未发布前，任务拆分、规范、skill 等初始化基线可由负责人直接提交到 `develop`，并记录固定 commit SHA。进入 Issue 驱动开发后恢复一 Task、一分支、一 MR。

## 3. 开发前检查

1. 回读目标 Task 的正文、主实现仓库、全部 `Blocked by`、验收与上游交付结果。
2. 读 `docs/gitlab-workflow.md`、`docs/agent-platform/task-breakdown.md`、`task-implementation-spec.md`、`repository-ownership-matrix.md`；契约或复用判断再读 `source-task-crosswalk.md`。
3. 按 `ai-gitlab-issue-workflow` 把 Task 置为 `status::in-progress`；写失败时记录差异，不把本地进度当远端状态。
4. 检查 `git status`，保留用户已有修改；并行分支优先用 `git worktree`。
5. 更新远端引用，从最新 `origin/develop` 创建 `feature/<aagp-key>-<slug>`（例：`feature/aagp-02-04-agent-version`）。
6. 一个分支只对应一个可独立验收的 Task；一个 MR 只改一个仓库。

## 4. 实现与提交

- 采用 Conventional Commits，提交正文写真实 `Refs #<IID>`；`AAGP-*` 是规划键，不能代替 IID。
- 中间提交不使用 `Closes`；跨仓引用写完整项目路径。
- 跨仓依赖开工前回读 Foundation 工作项、MR、目标 release 与制品；合并 commit、发布制品、平台集成结果是三种独立证据，不能互相替代。
- 按风险补充测试、契约与中文文档；公共 API、数据库、事件、权限、Runtime 或部署行为变化必须说明兼容性与回滚。
- 冻结契约与一期决定冲突时记录契约版本或 ADR，不直接改原规范。
- 公共 API、契约字段与代码注释解释**语义、原因和不变量**，不复述语句本身。
- 提交前只对改动模块执行格式化与静态检查：backend 用 `mvn spotless:apply` / `mvn spotless:check`；前端与 agent-runtime 用 `pnpm format` / `pnpm lint` / `pnpm format:check`。
- 运行与改动相称的验证，记录准确命令、结果与固定 SHA；源码存在、CI 绿、本地启动、SIT、生产是不同等级的证据。
- 不提交凭据、个人配置、临时日志或构建产物；不用 `reset --hard` 清理现场。

## 5. 创建与更新 MR

写入前核对认证身份、目标项目、源/目标分支、Task 最新状态与必需检查。

```powershell
glab mr create -R eic/software-architecture/ai-platform --target-branch develop --draft
glab mr view <IID> -R eic/software-architecture/ai-platform --comments
glab mr note create <IID> -R eic/software-architecture/ai-platform --message '<本轮更新>'
glab mr update <IID> -R eic/software-architecture/ai-platform --ready
```

- 参数以当前安装版本的 `glab <命令> --help` 为准；CLI 没暴露的字段再用 `glab api`，写入后回读。
- 验收未完成时保持 Draft；描述用 `references/mr-description-template.md`。
- 后续修改继续推到同一分支、同一 MR。
- 创建或更新后回读 MR URL、源/目标分支、Draft 状态、关联 Task 与 pipeline。

## 6. 评审与推进评论

- 代码行问题在原讨论线程回复；评审意见涉及代码时在同一分支修复并补验证。
- 只在**有意义的变化**时补 MR 评论：新一轮改动与固定 SHA、验证或 pipeline 结果、评审处理结果、阻塞与下一步。不按每次 push 刷评论。
- 描述持续反映当前整体范围、风险与验证结论；过程记录放评论。
- 任务级范围、依赖与交付影响同时回填对应 Issue/Task；MR 评论给评审者，Issue 评论给任务协作者，两边用真实链接互指。

```markdown
### 本轮更新
- 变更：相对上一轮新增或修正的内容
- 提交：固定 SHA
- 验证：命令/pipeline 与结果
- 评审处理：已解决的讨论及仍未解决项
- 下一步：下一轮目标或当前阻塞
```

## 7. 合并收口

按 `references/merge-checklist.md` 逐项执行并回读：

1. 确认 MR 已合入 `develop`，记录实际 merge commit、pipeline 与评审结果；启用 squash 时另记 squash commit。
2. 在 Task 留交付记录：实现范围、固定 SHA、验证命令与结果、修正的缺陷或决策、未交付项、下游影响。
3. 核对 Task 是否实际关闭；`Closes #IID` 不保证本实例自动关闭，需要时手动关闭并清理旧 `status::*`。
4. 对每个下游 Task 回读**全部**前置，全部关闭才可置 `ready`。
5. 结束本次功能开发；不自动创建 Release MR、不合并 `main`、不打版本标签，也不把 `develop` 合并说成 SIT 或生产发布。

## 8. 失败与例外

- 认证或目标分支不可验证 → 不宣称可以合并，报告缺什么。
- pipeline 失败 → 定位失败任务，修复后重跑；不在未通过时转 Ready。
- 远端写入或回读失败 → 报告已确认的实际范围与剩余差异。
- 发现需要跨仓改动 → 停止扩张范围，先更新工作项结构。

## 9. 红线清单

- [ ] 分支从最新 `origin/develop` 开出，目标分支是 `develop`。
- [ ] 一个 MR 只对应一个 Task、一个仓库。
- [ ] 提交信息含真实 `Refs #IID`，中间提交没有 `Closes`。
- [ ] 格式化与检查只在改动模块执行并通过。
- [ ] 验收未完成时 MR 保持 Draft。
- [ ] 合并后有回读，Task 有交付记录并已关闭。
- [ ] 没有把合并到 `develop` 描述成发布。

## 参考文件

- `references/mr-description-template.md`：MR 描述模板。
- `references/merge-checklist.md`：合并收口核对表。
