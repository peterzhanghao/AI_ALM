# ADR 0002：开发流程从 GitLab 迁移到 GitHub

- 状态：已采纳
- 日期：2026-10-23
- 决策者：peterzhanghao
- 关联：[ADR 0001](0001-dsh-skill-pack-restructure.md)

## 背景

项目代码仓库定为 `https://github.com/peterzhanghao/AI_ALM`（迁移时为空的公开仓库）。此前的两个技能以 GitLab 为对象：`glab` 命令、MR 概念、GitLab Work Item 类型与 `status::*` 标签、`develop → main` 的团队约定。

GitHub 与 GitLab 的差异会直接影响流程正确性：

1. CLI 不同（`gh` vs `glab`）。
2. 工作项层级用 sub-issue 表达，依赖用 blocked-by 关系。
3. **closing 关键字只对默认分支生效**：PR 合入 `develop` 不会自动关闭 Issue。
4. 标签需显式创建；Issue Types 仅在启用后可用。

## 决策

1. **技能改为 GitHub 版**：`ai-github-issue-workflow`、`ai-github-pr-workflow`；GitLab 版本归档到 `archive/v2-gitlab-skills/`，不参与发现。
2. **命令面统一为 `gh`**：查询、创建、更新、评论、回读均用 `gh`；CLI 未覆盖的关系字段用 `gh api`。
3. **保留 ALM 规划键模型**：`ALM-00` 总控、`ALM-xx` 领域、`ALM-xx.yy` 执行、`.zz` 子任务；GitHub `#编号` 在 `docs/planning/issue-register.md` 一一映射。
4. **分支模型**：`main` 为默认与发布基线，`develop` 为集成分支，功能分支 `feature/alm-<key>-<slug>`，PR 目标 `develop`。
5. **关闭语义显式化**：合并后必须 `gh issue close`，不依赖 `Closes #n`。
6. **仓库级模板**：`.github/ISSUE_TEMPLATE/`、`pull_request_template.md`、`CODEOWNERS`，让网页端操作也走同一套结构。
7. **自动化**：`scripts/setup-github.ps1` 创建标签、`develop` 与分支保护；`.github/workflows/validate-skills.yml` 在 PR 上校验技能格式。
8. **初始化基线直提 `develop`**：首个提交记录固定 SHA，随后进入 Issue 驱动开发。

## 影响

正面：

- 流程与仓库平台一致，`gh` 可脚本化，AI 与人都能复现。
- 模板与标签在网页端同样生效，降低绕过流程的概率。
- CI 校验把技能格式问题挡在合并前。

代价与约束：

- 需要 `gh auth login`；未认证时流程只能产出草案。
- Issue Types、分支保护在部分账户类型/计划下不可用，需退回标签与手工配置（文档已给出降级路径）。
- GitHub 的 blocked-by 与 sub-issue 为较新能力，旧实例可能缺失，技能保留正文清单作为降级表达。

## 迁移映射

| 旧（GitLab） | 新（GitHub） |
|---|---|
| `glab issue create` | `gh issue create` |
| `glab mr` | `gh pr` |
| `AAGP-*` 规划键 | `ALM-*` 规划键 |
| `Refs #IID` | `Refs #<编号>` |
| `Closes #IID` 自动关闭 | 合并后 `gh issue close` |
| `gitlab.k8s.*` 项目路径 | `peterzhanghao/AI_ALM` |
