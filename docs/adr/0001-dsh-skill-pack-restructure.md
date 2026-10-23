# ADR 0001：将技能包重构为 DSH 原生结构

- 状态：已采纳
- 日期：2026-10-23
- 决策者：平台架构组

## 背景

重构前的技能包（见 `archive/ai-code-skills-v1/`）存在四个问题：

1. **位置不符合 DSH 约定**：技能位于 `ai-code-skills/.agents/skills/`，比项目根多一层，DSH 只扫描一层，无法发现。
2. **命名与内容绑定旧品牌**：技能名与项目路径含 `aerok`，与当前项目名不一致。
3. **存在悬空依赖**：正文引用了 4 个未随包提供的技能（代码注释、格式化、规范沉淀、持久化约定），加载后会出现无效链接。
4. **面向 Claude Code 的假设**：使用 `bash` 代码块与 `.agents` 目录语义，未说明 DSH 的工具映射、权限与技能目录机制。

此外，单个 `SKILL.md` 约 10 KB，加载即占满上下文，且模板、命令、清单混在一起，难以局部维护。

## 决策

1. **采用 DSH 原生技能根**：技能存放于 `.dsh/skills/<name>/SKILL.md`（rank 100），与 `.agents/skills`（rank 200）相比优先级更高且语义明确。
2. **统一更名为 `ai-` 前缀**：`ai-gitlab-issue-workflow`、`ai-gitlab-mr-workflow`；项目路径改为 `eic/software-architecture/ai-platform`。
3. **消除悬空依赖**：删除对 4 个外部技能的引用，把必需的格式化命令、注释原则、验证要求内联进 MR 工作流。
4. **拆分资源**：`SKILL.md` 只保留流程与判定规则，正文模板、命令参考、收口清单移入 `references/`，按需加载。
5. **补齐 DSH frontmatter**：增加 `whenToUse`、`metadata.version/owner/updated`，描述控制在 500 字符内并把触发词前置。
6. **引入自动校验**：`scripts/validate-skills.ps1` 检查命名、frontmatter、描述长度、悬空链接与禁用词。
7. **保留历史**：原始文件完整归档到 `archive/ai-code-skills-v1/`，便于对照与回滚。

## 影响

正面：

- 技能可被 DSH 自动发现并热更新，无需额外配置。
- 加载成本从约 10 KB 降到约 7 KB，细节按需读取。
- 不再产生 404 式引用；规则自包含。
- 校验脚本把“技能静默消失”变成可检测的构建失败。

代价：

- 依赖 DSH 的 `frontmatter` 约定（`name`、`description`、`whenToUse` 等），迁移到其他客户端需转换目录与字段。
- 拆分后文件数量增加，维护时需同步 `SKILL.md` 与 `references/` 的链接。
- 主机名、项目路径等仍为示例值，接入真实环境时需替换。

## 迁移映射

| 旧 | 新 |
|---|---|
| `.agents/skills/aerok-gitlab-issue-workflow/SKILL.md` | `.dsh/skills/ai-gitlab-issue-workflow/SKILL.md` |
| `.agents/skills/aerok-gitlab-mr-workflow/SKILL.md` | `.dsh/skills/ai-gitlab-mr-workflow/SKILL.md` |
| `docs/development/gitlab-workflow.md` | `docs/gitlab-workflow.md` |
| 正文模板（内嵌） | `references/issue-body-template.md`、`references/mr-description-template.md` |
| glab 命令（内嵌） | `references/glab-issue-commands.md` |
| 收口步骤（内嵌） | `references/merge-checklist.md` |
