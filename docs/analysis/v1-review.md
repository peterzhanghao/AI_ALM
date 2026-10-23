# 重构前技能包分析（v1）

> 历史记录，对应 `archive/ai-code-skills-v1/`。结论仅用于解释 v2 的改动原因，不代表当前用法。

## 结构

```text
ai-code-skills/
├── .agents/skills/aerok-gitlab-issue-workflow/SKILL.md   135 行 / 10.6 KB
├── .agents/skills/aerok-gitlab-mr-workflow/SKILL.md      112 行 / 8.9 KB
└── docs/development/gitlab-workflow.md                    62 行 / 9.6 KB
```

两份 `SKILL.md` 是执行层操作手册，`gitlab-workflow.md` 是制度层约定，二者配套：文档规定"做什么"，技能规定"按什么顺序、用什么命令、写什么模板"。

## 内容要点

**Issue 工作流**：事实源 → 拆分层级（`AAGP-00` 总控 / `AAGP-01~10` 领域 / `AAGP-xx.yy` 执行 / `.01` 子项）→ 发布门禁（台账必须"确认发布"）→ 12 节正文模板 → `glab` 写入 → 回读 → 台账三态同步（`local-newer` / `remote-newer` / `conflict`）→ 阶段性评论。

**MR 工作流**：`执行 Task → feature/<key>-<slug> → MR → develop → 收口`；8 步主流程、Conventional Commits + `Refs #IID`、Draft 直到验收通过、合并后回读 merge commit 并重算下游。

**共同铁律**：远端回读才算事实；一 Task 一分支一 MR 一仓库；过程写评论、结论写正文。

## 发现的问题

| # | 问题 | 影响 |
|---|---|---|
| 1 | 位于 `.agents/skills` 且比项目根多一层 | DSH 只扫描一层，技能不会被发现 |
| 2 | 引用 4 个未提供的技能 | 加载后链接失效，规则缺失 |
| 3 | 依赖整套 `docs/agent-platform/*` | 脱离完整仓库无法执行 |
| 4 | 任务数不一致（48 vs 57） | 阅读者无法判断当前基线 |
| 5 | 无版本、无 `whenToUse`、无 `allowed-tools` | 无法演进管理、触发依赖内部术语 |
| 6 | 单文件约 10 KB | 加载即占大量上下文，难局部维护 |
| 7 | 面向 Claude Code 的 `bash` 假设 | 未适配 DSH 的 `pwsh`、权限与目录语义 |

## 结论

内容质量不是主要短板——门禁、模板、回读、反例清单都写得扎实；短板在**不完整**（缺依赖技能与配套文档）、**不适配**（目录、命名、工具假设）和**不可维护**（单文件、无校验）。v2 的重构针对这三点，见 [ADR 0001](../adr/0001-dsh-skill-pack-restructure.md)。
