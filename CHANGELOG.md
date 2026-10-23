# 变更记录

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与语义化版本。

## [3.0.0] - 2026-10-23

### 变更

- 开发流程从 GitLab 迁移到 GitHub（`peterzhanghao/AI_ALM`），技能改为 `ai-github-issue-workflow` 与 `ai-github-pr-workflow`。
- 命令面从 `glab` 改为 `gh`，覆盖查询、创建、更新、评论、回读，以及 sub-issue 与 blocked-by 关系。
- 规划键前缀改为 `ALM`，与 GitHub `#编号` 在 `docs/planning/issue-register.md` 一一映射。
- 明确关闭语义：合并到 `develop` 不会自动关闭 Issue，收口时必须显式 `gh issue close`。
- 新增 `.github/` 模板（Task、跟踪 Issue、PR）、`CODEOWNERS` 与 `validate-skills` CI。
- 新增 `scripts/setup-github.ps1`：一键创建标签、`develop` 分支与分支保护。
- 新增 `docs/development/github-workflow.md`、`docs/planning/` 与 ADR 0002。
- GitLab 版技能归档到 `archive/v2-gitlab-skills/`。

## [2.0.0] - 2026-10-23

### 变更

- 技能迁移到 DSH 原生根 `.dsh/skills/`，从 `ai-code-skills/.agents/skills/` 移出（原位置比项目根多一层，DSH 不会发现）。
- 技能更名为 `ai-gitlab-issue-workflow`、`ai-gitlab-mr-workflow`，内容中的旧品牌前缀统一为 `ai`（项目路径 `eic/software-architecture/ai-platform`）。
- 移除对 4 个未随包提供技能的引用（代码注释、格式化、规范沉淀、持久化约定），必需规则内联进 MR 工作流。
- 拆分正文：模板、命令、收口清单移入 `references/`，`SKILL.md` 只保留流程与判定规则。
- 补充 DSH frontmatter：`whenToUse`、`metadata.version/owner/updated`，描述前置触发词并控制在 500 字符内。
- 新增 `scripts/validate-skills.ps1`，校验命名、frontmatter、描述长度、相对链接与禁用词。
- 仓库结构按软件工程方式重组：`docs/`（制度层、使用说明、ADR、历史分析）、`scripts/`、`archive/`。
- 原技能包完整归档到 `archive/ai-code-skills-v1/`，不参与技能发现。

### 移除

- 根目录临时文件与旧版单文件技能布局。

## [1.0.0] - 2026-10-10

### 新增

- 导入 `aerok-gitlab-issue-workflow`、`aerok-gitlab-mr-workflow` 与 `docs/development/gitlab-workflow.md`。
