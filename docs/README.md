# 文档索引

| 文档 | 内容 |
|---|---|
| [`development/github-workflow.md`](development/github-workflow.md) | 仓库级 GitHub 工作项与 PR 约定（制度层） |
| [`planning/architecture.md`](planning/architecture.md) | ALM MVP 模块边界、契约、命令面与门禁规则 |
| [`planning/issue-register.md`](planning/issue-register.md) | 规划键、GitHub 编号、状态与同步台账 |
| [`planning/task-breakdown.md`](planning/task-breakdown.md) | 逐卡范围、依赖与验收 |
| [`planning/skill-plan.md`](planning/skill-plan.md) | 产品能力 → 契约 → 技能 → 任务的转化方法与技能清单 |
| [`usage.md`](usage.md) | 在 DeepSeek Harness 中安装、触发、排错 |
| [`adr/0001-dsh-skill-pack-restructure.md`](adr/0001-dsh-skill-pack-restructure.md) | 技能包重构为 DSH 原生结构 |
| [`adr/0002-github-workflow-migration.md`](adr/0002-github-workflow-migration.md) | 从 GitLab 迁移到 GitHub |
| [`adr/0003-alm-mvp-engineering.md`](adr/0003-alm-mvp-engineering.md) | ALM MVP 的工程落点与技术选型 |
| [`analysis/v1-review.md`](analysis/v1-review.md) | 重构前技能包分析（历史） |
| [`analysis/alm-mvp-requirements-review.md`](analysis/alm-mvp-requirements-review.md) | ALM MVP 需求评审：问题、契约缺口、决策点 |
| [`product/ai-native-alm-mvp.md`](product/ai-native-alm-mvp.md) | AI Native ALM MVP 产品、技术、实施与验证蓝图 |
| [`product/deepseek-harness-creator-brief.md`](product/deepseek-harness-creator-brief.md) | 可直接交给 DeepSeek Harness 创造模式的实施 Brief |

技能正文位于 [`.dsh/skills/`](../.dsh/skills)：

- `ai-github-issue-workflow/`：Issue 拆分、发布门禁、写入回读、台账同步。
- `ai-github-pr-workflow/`：分支、提交、PR、评审、合并收口。
- `alm-mvp-dev/`：ALM MVP 开发技能（布局、命令、契约、门禁、交付纪律）。
