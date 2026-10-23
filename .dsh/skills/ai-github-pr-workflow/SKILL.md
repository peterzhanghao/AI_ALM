---
name: ai-github-pr-workflow
description: "AI_ALM 仓库的 GitHub PR 工作流：从执行 Task 开 feature 分支、提交规范、Draft PR、评审与检查、合并到 develop、关闭 Issue 与下游重算。用户要开发任务、提 PR、评审合并或收口时使用。"
whenToUse: "需要从 develop 创建 feature 分支、提交代码、创建或更新 PR、处理评审意见与 CI 检查、合并到 develop 并关闭 Issue 时。"
metadata:
  version: "3.0.0"
  owner: "peterzhanghao"
  repo: "peterzhanghao/AI_ALM"
  updated: "2026-10-23"
---

# AI_ALM GitHub PR 工作流

## 0. 运行约定（DeepSeek Harness）

- 所有命令通过 `pwsh` 工具执行；读文件用 `read`/`grep`/`glob`，写文件用 `write`/`edit`。
- 仓库：`peterzhanghao/AI_ALM`；工作目录为仓库根时省略 `-R`。
- push、PR、评论、合并、关闭 Issue 只在用户授权范围内执行；命令失败时报告实际进度，不换写法绕过。
- 开始前 `gh auth status` 必须为已登录，`git status` 必须已确认，不覆盖用户已有改动。
- 本文件引用的 `references/` 相对本 skill 目录解析，按需读取。

## 1. 适用与不适用

| 场景 | 是否使用本 skill |
|---|---|
| 开始执行 Task、创建分支、提交代码 | 是 |
| 创建/更新 PR、处理评审与检查、合并收口 | 是 |
| 拆分或新建 Issue、改状态与依赖 | 否，先用 `ai-github-issue-workflow` |
| 只写文档、不涉及代码交付 | 不必要，直接按仓库文档约定执行 |

## 2. 分支模型

```text
执行 Task → feature/alm-<key>-<slug> → PR → develop → Task 收口
```

- `main` 是默认分支与发布基线，只接受来自 `develop` 的发布合并。
- `develop` 是日常集成分支；所有功能 PR 的目标分支都是 `develop`。
- 功能分支命名：`feature/alm-01-02-agent-version`（规划键小写 + 短横线 slug）。
- 启动阶段例外：工作项体系尚未建立前，初始化基线（文档、模板、脚本）可由负责人直接提交到 `develop` 并记录固定 SHA；进入 Issue 驱动开发后恢复一 Task、一分支、一 PR。
- 发布流程（`develop → main`、版本标签）在首个可发布版本前单独定义，当前不得自行发明。

## 3. 开发前检查

1. 回读目标 Issue 的正文、验收、全部 blocked-by 与上游交付结果。
2. 读 `docs/development/github-workflow.md`、`docs/planning/task-breakdown.md`，确认模块边界与 Owner。
3. 按 `ai-github-issue-workflow` 把 Issue 置为 `status::in-progress` 并指派 `@me`。
4. `git status` 确认工作区；保留用户已有修改，并行任务优先 `git worktree add`。
5. `git fetch origin`，从最新 `origin/develop` 创建分支。
6. 一个分支只对应一个可独立验收的 Task；一个 PR 只做一件事。

```powershell
git fetch origin
git switch -c feature/alm-01-02-agent-version origin/develop
```

## 4. 实现与提交

- Conventional Commits：`feat|fix|refactor|test|docs|chore(scope): summary`。
- 提交正文写 `Refs #<编号>`；编号是 GitHub 真实 Issue 号，`ALM-*` 规划键不能替代。
- 中间提交不使用 `Closes/Fixes`；合并阶段再决定关闭方式。
- 按风险补充测试与中文文档；行为、接口、配置变化必须说明兼容性与回滚。
- 注释解释**语义、原因和不变量**，不复述语句本身。
- 提交前只对改动模块执行格式化与检查：backend `mvn spotless:apply` / `spotless:check`；前端与脚本 `pnpm format` / `pnpm lint` / `pnpm format:check`（按本仓实际技术栈调整）。
- 运行与改动相称的验证，记录准确命令、结果与固定 SHA。
- 不提交凭据、个人配置、临时日志或构建产物；不用 `reset --hard` 清理现场。

## 5. 创建与更新 PR

```powershell
git push -u origin HEAD
gh pr create --base develop --draft --title "feat: ..." --body-file .github/pull_request_template.md
```

- 首次推送后立即建 Draft PR，后续修改推同一分支、同一 PR。
- 描述使用 `references/pr-description-template.md`；验收未完成时保持 Draft。
- 请求评审用 `gh pr edit <n> --add-reviewer <login>`；需要复核时 `gh pr review <n> --request-changes`。
- 创建或更新后回读：PR 编号、URL、base/head、Draft 状态、checks、review 状态。

## 6. 评审、检查与推进评论

```powershell
gh pr view <n> --comments
gh pr checks <n> --watch
gh pr review <n> --approve --body "LGTM"
```

- 代码行问题在原讨论线程回复；评审意见涉及代码时在同一分支修复并补验证。
- 只在**有意义的变化**时补 PR 评论：新一轮改动与固定 SHA、检查结果、评审处理结果、阻塞与下一步。不按每次 push 刷评论。
- 描述持续反映当前整体范围、风险与验证结论；过程记录放评论。
- 任务级范围、依赖与交付影响同时回填对应 Issue，两边用真实链接互指。

```markdown
### 本轮更新
- 变更：相对上一轮新增或修正的内容
- 提交：固定 SHA
- 验证：命令 / CI 检查与结果
- 评审处理：已解决的讨论及仍未解决项
- 下一步：下一轮目标或当前阻塞
```

## 7. 合并收口

按 `references/merge-checklist.md` 逐项执行并回读：

1. 确认 checks 全绿、评审通过、无冲突；`gh pr merge <n> --merge --delete-branch`。
2. 回读 `mergedAt`、`mergeCommit`、pipeline/checks 结果与目标分支。
3. 在 Issue 留交付记录：实现范围、固定 SHA、验证命令与结果、偏离决策、未交付项、下游影响。
4. 关闭 Issue：合并到 `develop` **不会**触发 `Closes #n` 自动关闭（closing 关键字只对默认分支生效），必须显式 `gh issue close <n>` 并清理旧 `status::*`。
5. 对每个下游 Issue 回读全部 blocked-by，全部关闭才可置 `ready`。
6. 结束本次功能开发；不合并 `main`、不打标签、不把 `develop` 合并说成发布。

## 8. 失败与例外

- checks 失败 → 定位失败任务，修复后重跑；不在未通过时转 Ready。
- 合并冲突 → 在功能分支 `git rebase origin/develop` 解决，推送后重新等检查。
- 认证或权限不足 → 报告所需权限，不尝试匿名绕行。
- 远端写入或回读失败 → 报告已确认范围与剩余差异，不宣布“已收口”。

## 9. 红线清单

- [ ] 分支从最新 `origin/develop` 开出，PR 目标是 `develop`。
- [ ] 一个 PR 只对应一个 Issue、一件事。
- [ ] 提交信息含真实 `Refs #编号`，中间提交没有 `Closes/Fixes`。
- [ ] 格式化与检查只在改动模块执行并通过。
- [ ] 验收未完成时 PR 保持 Draft。
- [ ] 合并后有回读，Issue 有交付记录并已显式关闭。
- [ ] 没有把合并到 `develop` 描述成发布。

## 参考文件

- `references/pr-description-template.md`：PR 描述模板。
- `references/merge-checklist.md`：合并收口核对表。
