# AI_ALM

AI_ALM 的工程仓库：承载代码、开发流程与 AI 技能（DeepSeek Harness Skills）。

- 代码仓库：<https://github.com/peterzhanghao/AI_ALM>
- 集成分支：`develop`；发布基线：`main`
- 工作流：Issue 驱动 → feature 分支 → Draft PR → 评审 → 合并 → 收口

## 目录结构

```text
.
├── .dsh/skills/                     # DSH 技能根（rank 100，自动发现）
│   ├── ai-github-issue-workflow/    # Issue 拆分、门禁、写入回读、台账
│   └── ai-github-pr-workflow/       # 分支、提交、PR、评审、合并收口
├── .github/                         # Issue/PR 模板、CODEOWNERS、CI
├── docs/
│   ├── development/github-workflow.md   # 制度层：约定与边界
│   ├── planning/                        # 问题台账与任务拆解
│   ├── adr/                             # 架构决策记录
│   ├── analysis/                        # 历史分析
│   └── usage.md                         # DSH 使用与排错
├── scripts/
│   ├── setup-github.ps1             # 标签、develop、分支保护
│   └── validate-skills.ps1          # 技能校验（CI 复用）
├── archive/                         # 历史版本，不参与发现
├── CHANGELOG.md
└── README.md
```

## 快速开始

```powershell
gh auth login
gh auth status

# 首次推送 main 后执行一次
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup-github.ps1

# 校验技能格式
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/validate-skills.ps1
```

然后在 DSH 会话中直接描述任务，例如：

> 读 issue-register，确认“确认发布”后给 ALM-01.02 建 GitHub Task，建完回读并写回台账。

## 开发流程

```text
执行 Task → feature/alm-<key>-<slug> → PR → develop → Task 收口
```

1. 在 `docs/planning/issue-register.md` 登记规划键与门禁结论。
2. 通过门禁后创建 Issue（类型、父项、blocked-by、标签）。
3. 从 `origin/develop` 切分支，实现并验证。
4. 提 Draft PR，补齐描述与证据；检查全绿后转 Ready。
5. 合并到 `develop`，回读 merge commit，留交付记录并**显式关闭** Issue。

细节见 [GitHub 工作流](docs/development/github-workflow.md)。

## 为什么是这套结构

- **`.dsh/skills` 原生根**：DSH 只扫描一层目录，技能不嵌套、可热更新。
- **`SKILL.md` + `references/`**：正文保持一屏，模板与命令按需读取。
- **制度层与执行层分离**：`docs/` 给人评审，技能给 AI 执行，两者相对链接。
- **CI 校验**：DSH 会静默跳过 frontmatter 非法的技能，校验脚本把这类问题变成可见失败。
