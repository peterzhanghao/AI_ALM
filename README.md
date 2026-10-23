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
│   ├── ai-github-pr-workflow/       # 分支、提交、PR、评审、合并收口
│   └── alm-mvp-dev/                 # ALM MVP 开发技能（布局、命令、门禁）
├── .github/                         # Issue/PR 模板、CODEOWNERS、CI
├── packages/                        # ALM MVP 实现（见架构文档）
│   ├── alm-core/                    # 领域模型、解析、门禁、差异、基线、CLI
│   ├── alm-scm/                     # SCM/CI 适配器
│   ├── dsh-plugin-alm-core/         # core 服务与 Agent 工具插件
│   ├── dsh-plugin-requirements/     # 需求插件
│   ├── dsh-plugin-architecture/     # 架构插件
│   └── alm-skills/                  # 产品技能源
├── fixtures/order-refund/           # 部分退款样例资产与负例夹具
├── docs/
│   ├── development/github-workflow.md   # 制度层：约定与边界
│   ├── planning/                        # 架构、问题台账与任务拆解
│   ├── adr/                             # 架构决策记录
│   ├── analysis/                        # 历史分析与需求评审
│   └── usage.md                         # DSH 使用与排错
├── scripts/
│   ├── setup-github.ps1             # 标签、develop、分支保护
│   ├── validate-skills.ps1          # 技能校验（CI 复用）
│   └── demo-init.ps1                # 生成样例 ALM 仓库（tmp/，不入库）
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

## AI Native ALM MVP 方案

- [产品与技术蓝图](docs/product/ai-native-alm-mvp.md)：定义需求/架构双插件、共享资产与变更服务，以及 MVP 验收。
- [创造模式实施 Brief](docs/product/deepseek-harness-creator-brief.md)：与蓝图一起提供给 DeepSeek Harness Desktop 创造模式，构建可运行原型。
- [需求评审](docs/analysis/alm-mvp-requirements-review.md)：范围收敛、契约缺口、决策点与验证建议。
- [架构与模块边界](docs/planning/architecture.md)：目录、契约、命令面、门禁规则与插件集成点。
- [技能化方案](docs/planning/skill-plan.md)：如何把产品能力转成 AI 可执行技能与开发任务。
- 已拆解任务：[问题台账](docs/planning/issue-register.md)、[任务拆解](docs/planning/task-breakdown.md)。
