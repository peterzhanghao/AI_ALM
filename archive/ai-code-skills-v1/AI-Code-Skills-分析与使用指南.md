# ai-code-skills 分析与使用指南

> 分析对象：`D:\DSH\ai-code-skills`（同时校验了 `D:\DSH\aerok-ai-platform.zip`，内容与目录完全一致）
> 结论先说：这是一套**项目级 Agent Skills 包**——把 AEROK AI 平台的 GitLab 工作项与 MR 流程，写成 AI 编码助手可直接执行的中文操作手册；当前只包含 2 个技能和 1 份共享规范文档，且依赖若干未随包提供的外部文件。

---

## 一、仓库全貌

```
ai-code-skills/
├── .agents/skills/                      # 技能目录（每个技能一个文件夹 + SKILL.md）
│   ├── aerok-gitlab-issue-workflow/SKILL.md   10,648 B / 135 行
│   └── aerok-gitlab-mr-workflow/SKILL.md       8,948 B / 112 行
└── docs/development/
    └── gitlab-workflow.md                      9,601 B / 62 行
```

| 部分 | 性质 | 作用 |
|---|---|---|
| `SKILL.md` × 2 | 机器/Agent 可读的操作手册 | 带 YAML frontmatter（`name` + `description`），描述即"触发器" |
| `docs/development/gitlab-workflow.md` | 人可读的策略文档 | 仓库约定、事实源、发布历史与当前阶段边界 |

**分层关系**：`gitlab-workflow.md` 是"制度层"（规定做什么、谁是事实源），两个 `SKILL.md` 是"执行层"（规定 AI 按什么顺序、用什么命令、写什么模板去落地）。文档第 5 行明确写了"执行时使用项目 Issue skill 与 MR skill"，二者是配套关系。

**技能不是代码**：没有脚本、没有工具声明，全靠自然语言流程约束 + `glab` 命令行 + 回读校验。它的价值在于把"老工程师脑子里的流程"固化成 AI 每次都会遵守的清单。

---

## 二、内容拆解

### 2.1 `aerok-gitlab-issue-workflow`（工作项 / Issue / Task）

**定位**：在 `eic/software-architecture/aerok-ai-platform` 仓中拆分、创建、调整、关闭 GitLab Issue/Task 时使用。

**核心结构（6 段）**：

1. **适用范围与事实源**：先读 9 份仓库内文档（`docs/development/gitlab-workflow.md`、`docs/agent-platform/*.md` 等），并声明"写入后，远端回读结果才是协作事实"。
2. **拆分与层级**：
   - `AAGP-00` 总控 → `AAGP-01~10` 领域跟踪 Issue → `AAGP-xx.yy` 执行 Task → `AAGP-xx.yy.01` 子 Task；
   - 原生层级只有 `Issue → Task`，规划用的三段编号**不能**说成已存在的原生三级树；
   - `Blocked by` 表达有向依赖，`relates to` 只做导航；
   - 一个执行 Task = 一人 + 一个 MR + 一条可独立验收的路径；
   - 跨仓（Foundation `AFF-*`）必须另建工作项，不夹带进同一 Task/MR。
3. **发布前确认门禁**（最有价值的一条）：只有台账 `docs/agent-platform/task-confirmation-register.md` 对应行 `确认结论=确认发布`，且 Owner、类型、优先级、实施仓库、依赖、契约、正反例验收全部确认，才允许写 GitLab；`待确认/需修改/暂缓/不发布` 一律不许创建。
4. **工作项正文模板**：12 个固定小节——目标与上下文 / Parent / 实施仓库与跨仓前置 / 来源与范围 / 先读 / 涉及模块与契约 / What to build / Out of scope / 交付物 / Blocked by / 验收与证据。明确禁止"参照 M0""完成开发""测试通过"这类空话。
5. **写入、状态与回读**：
   - 日常用 `glab issue view/create/update/note`，只有原生 Task 类型、父子层级、有向依赖才用 `glab work-items`/`glab api`；
   - 标签：跟踪项不带 `planning::execution`；执行项带 `planning::execution` + 单个 `domain::*` + 单个 `phase::*` + **单个** `status::*`；
   - 状态机：`blocked → ready → in-progress → review → closed`，换状态必须摘旧标签；
   - 写完必须回读 IID、URL、类型、父项、标签、里程碑、状态、依赖，再更新本地台账。
6. **仓库状态同步 + 处理中评论**：
   - 台账与远端不一致时显式标 `local-newer` / `remote-newer` / `conflict`，禁止静默覆盖；
   - 评论只在"可验证的阶段结果、阻塞/解除、范围或契约决定、验收证据变化"时写，模板为「已完成/发现、证据、影响、下一步」，反对按提交刷流水账。

### 2.2 `aerok-gitlab-mr-workflow`（分支 / 提交 / MR / 收口）

**定位**：Issue 驱动开发、提交代码、创建或更新 MR、评审合并与收口时使用。

**分支模型（注意原文特别纠正的拼写）**：

```text
执行 Task → feature/<aagp-key>-<slug> → MR → develop → Task 收口
```

- 远端实际分支是 `develop`，**不是** `devlop`（原文写"不是 `devlop`"，属于历史踩坑记录）；
- `main` 暂不接普通功能 MR，Release/版本标签/SIT/生产发布流程当前**未定义**；
- 启动阶段例外：工作项尚未发布前，任务拆分/规范/skill 等基线可由负责人直提 `develop`。

**8 步主流程**：回读 Task 与前置 → 从最新 `origin/develop` 切 feature 分支 → 实现验证提交推送 → 建 Draft MR（目标 `develop`）→ 后续改动推到同一分支同一 MR → 转 Ready 并过门禁 → 合并并回读 merge commit/pipeline → 回填关闭 Task、重算下游依赖。

**实现与提交约束**：
- Conventional Commits，正文写真实 `Refs #<IID>`；`AAGP-*` 是规划键，不能代替 IID；中间提交不用 `Closes`；
- 跨仓依赖要分别记录"Foundation 合并 commit / 发布制品 / 平台集成结果"三种证据；
- 提交前按 `aerok-code-format` 跑格式化（backend `mvn spotless:apply/check`，前端与 agent-runtime 用 format/lint/format:check），按 `aerok-code-comment-convention` 写注释；
- 不提交凭据、临时日志、构建产物，不 `reset --hard` 清理现场。

**MR 模板**：Summary / Changes / Verification（准确命令 + 固定 SHA + 环境证据）/ Risks / Rollback / Issue（默认 `Refs #<IID>`，确定要自动关闭才 `Closes`）。

**收口 5 步**：确认已合入 `develop` 并记录 merge commit（若 squash 再记 squash commit）→ 在 Task 留交付记录 → 核对实际关闭状态并清理旧 `status::*` → 逐个回读下游**全部**前置才置 ready → 到此为止，不自动发 Release、不合并 `main`、不打标签。

### 2.3 两个技能怎么咬合

| 环节 | 负责技能 | 产出 |
|---|---|---|
| 拆卡、建卡、改依赖、改状态、关卡拉评论 | Issue skill | GitLab Issue/Task + 本地台账快照 |
| 开分支、写码、提 MR、评审、合并、收口 | MR skill | feature 分支 + MR + merge commit |

关键衔接点：MR skill 明确规定"开始实现时按 Issue skill 把 Task 置为 `status::in-progress`，MR 创建后置 `status::review`"。所以正确用法是**先加载 Issue skill 定"做什么"，再加载 MR skill 做"怎么交付"**，而不是二选一。

两个技能共享三条铁律：
1. **远端回读才算事实**，本地文件变更 ≠ 已同步；
2. **一个 Task / 一个分支 / 一个 MR / 一个仓库**；
3. **过程写评论、结论写正文**，不刷屏、不虚报完成。

---

## 三、如何使用

### 3.1 放置（安装）

这套技能按"项目级"设计，应放在**目标仓库根目录**：

```text
aerok-ai-platform/
├── .agents/skills/aerok-gitlab-issue-workflow/SKILL.md
├── .agents/skills/aerok-gitlab-mr-workflow/SKILL.md
└── docs/development/gitlab-workflow.md
```

三种接入方式，按你用的客户端选：

| 方式 | 做法 | 适合 |
|---|---|---|
| A. 原生技能目录 | 把 `ai-code-skills/.agents` 整个拷到仓库根（或直接 `git subtree`/软链），支持 Agent Skills 约定的客户端会自动发现 | Claude Code 等支持 `SKILL.md` 的客户端 |
| B. 客户端约定目录 | 复制到 `.claude/skills/`（项目级）或 `~/.claude/skills/`（个人级），每个技能一个文件夹 | 只扫描固定目录的客户端 |
| C. 显式引用 | 在 `AGENTS.md` / `CLAUDE.md` 写："处理 GitLab Issue/Task 前先读 `.agents/skills/aerok-gitlab-issue-workflow/SKILL.md`；提 MR 前读 `aerok-gitlab-mr-workflow/SKILL.md`" | 不支持技能自动发现的客户端（Cursor、Copilot 等） |

> 本会话已核查：当前工作区根是 `D:\DSH`，而技能在 `D:\DSH\ai-code-skills\.agents\skills`（多了一层），所以**不会被自动加载**；这正是"要放到仓库根"的现实例证。

### 3.2 触发

- **自动触发**：靠 frontmatter 的 `description`。当你说"给 AAGP-02.04 建个 GitLab Task""把这个卡拆成两个子任务""从 develop 拉分支开个 Draft MR""合并后把 Task 关掉"时，匹配的 skill 会被注入。
- **显式触发**：直接点名，如"用 aerok-gitlab-mr-workflow 走一遍收口"。
- **不建议**：让它常驻上下文。两个文件合计约 20 KB，只在命中场景时加载才划算。

### 3.3 前置条件（缺一不可）

1. `glab` CLI 已安装（本机实测**未安装**，`glab --version` 报 CommandNotFound），并按技能里的主机名登录：
   ```bash
   glab auth login --hostname gitlab.k8s.aerok.com.cn
   glab auth status --hostname gitlab.k8s.aerok.com.cn
   glab api --hostname gitlab.k8s.aerok.com.cn user
   ```
2. 工作目录是**完整**的 `aerok-ai-platform` 仓库——技能要读的 `docs/agent-platform/*.md`、`docs/development/gitlab-workflow.md` 都在仓库里，只有这两个 SKILL.md 是跑不起来的。
3. 有目标项目的 Issue/MR 写权限；`glab work-items` 可能仍是实验性接口，执行前先看 `--help`。

### 3.4 典型场景与示范说法

**场景 1：把一张规划卡落成 GitLab Task**

> "读 AAGP-02.04 的确认台账和实施细则，按 issue skill 生成正文草案；确认结论是'确认发布'的话，在 `eic/software-architecture/aerok-ai-platform` 建 Task，打 `planning::execution`、`domain::*`、`phase::*`、`status::ready`，建完回读并把 IID 写回台账。"

AI 会执行：读事实源 → 查门禁 → 套 12 节模板 → `glab issue create` → 回读 → 更新台账 `GitLab IID/URL`、`同步状态`、`最后回读`。

**场景 2：按 Task 开发并提 MR**

> "按 #123 开发，从最新 origin/develop 切 feature/aagp-02-04-agent-version，实现完跑 spotless 和相关测试，提一个目标 develop 的 Draft MR，描述按 Summary/Changes/Verification/Risks/Issue 写。"

AI 会执行：回读 Task 与 `Blocked by` → 置 `in-progress` → 建分支 → 实现 → 提交（`Refs #123`）→ `glab mr create --target-branch develop --draft` → 回读 URL/分支/pipeline → 置 `review`。

**场景 3：合并收口**

> "MR !45 已评审通过，走收口流程。"

AI 会执行：合并 → 回读 merge commit 与 pipeline → 在 Task 写交付记录 → 核对关闭状态并清 `status::*` → 逐个回读下游前置 → 报告"develop 已合并，未做 Release/SIT/生产"。

### 3.5 一次完整时序

```
读台账/实施细则 ──► 过确认门禁 ──► 建 Issue/Task ──► 回读 + 记台账
                                                   │
                         置 in-progress ◄──────────┘
                                │
              切 feature 分支 → 实现 → 格式化/测试 → 提交(Refs #IID)
                                │
                  Draft MR → 回读 → 评审修复 → Ready → 合并
                                │
        回读 merge commit/pipeline → Task 交付记录 → 关闭 → 下游重算
```

### 3.6 使用红线（照着检查就不会出错）

- [ ] 写远端前，台账那一行是不是"确认发布"？
- [ ] 标题/正文里的 IID 是**回读到的真实 IID**，还是脑补的？
- [ ] 有没有把 `AAGP-*` 规划键当成 GitLab IID？
- [ ] 有没有把两个仓库的改动塞进一个 MR？
- [ ] 状态标签是否只剩**一个** `status::*`？
- [ ] 写完是否回读，并更新台账的 `同步状态` / `最后回读`？
- [ ] 评论是否只记录"有意义的变化"，而不是每次 push 都发？
- [ ] 是否把"本地改完/CI 绿"说成了"已同步/已发布"？

---

## 四、质量评估与改进建议

**做得好的地方**

1. **事实源与写入分离**：反复强调"本地草案 vs 远端事实"，并给出 `local-newer/remote-newer/conflict` 三态，避免 AI 最常见的"我以为我写进去了"。
2. **模板具体到可执行**：12 节 Issue 正文、MR 五段式、评论四段式，且附 3 个 `glab` 代码块，AI 不需要自由发挥。
3. **写入了负面清单**："不要只写参照 M0""不要按提交机械刷评论""不要把 CI 绿当成 SIT"，这类反例比正面要求更能约束模型。
4. **跨仓边界清晰**：`AAGP-*` / `AFF-*`、平台 Task 不夹带 Foundation 源码，一条就能挡住大量脏 MR。

**需要补的缺口（按优先级）**

| # | 问题 | 影响 | 建议 |
|---|---|---|---|
| 1 | 引用了 4 个未随包提供的 skill：`aerok-code-comment-convention`、`aerok-code-format`、`aerok-practice-learning`、`aerok-persistence-convention` | MR skill 第 44–45、100 行的链接会 404，AI 只能跳过 | 补齐这 4 个 SKILL.md，或把"格式化命令"内联进 MR skill |
| 2 | 依赖 `docs/agent-platform/` 下十余份文档，包内一份都没有 | 脱离完整仓库时门禁、编号、验收全部无法执行 | 明确"本包必须与主仓同仓使用"，或在包内附最小 `docs/agent-platform/` 骨架 |
| 3 | 任务数不一致：Issue skill 写"48 张 `AAGP-*`"，`gitlab-workflow.md` 写"57 张任务＋一个总览" | 读者不确定以哪个为准 | 统一为"当前 57 张，历史 48 张 AAGP 为旧批次" |
| 4 | frontmatter 只有 `name`/`description`，无版本、无 `allowed-tools` | 无法做版本管理，也无法限制其只能调 `glab` | 加 `version`、`allowed-tools: [bash]`、`metadata.owner` |
| 5 | 描述用内部术语（`AAGP`、`aerok-ai-platform`） | 首次使用者很难触发 | 补"当用户说'建 GitLab 任务''开 MR''合并收口'时使用"这类外行话 |
| 6 | 单文件 10 KB+，全量注入 | 占用上下文，细节易被截断 | 拆 `references/issue-template.md`、`references/glab-commands.md`，SKILL.md 只留流程与指针 |

**一句话评价**：作为"流程约束型 skill"，它写得比大多数同类项目扎实——有门禁、有模板、有回读、有反面清单；短板不在内容质量，而在**不完整**（缺 4 个关联 skill 和整套 `docs/agent-platform`）和**未做客户端适配说明**。

---

## 五、附：最小接入片段（可直接粘到 `AGENTS.md`）

```markdown
## GitLab 工作流

- 处理 Issue/Task 的拆分、创建、状态、依赖、评论前，先完整阅读并遵循
  `.agents/skills/aerok-gitlab-issue-workflow/SKILL.md`。
- 开始开发、提交、创建/更新 MR、评审合并与收口前，先完整阅读并遵循
  `.agents/skills/aerok-gitlab-mr-workflow/SKILL.md`。
- 两者共享 `docs/development/gitlab-workflow.md` 中的仓库约定。
- 远端写入后必须回读；本地文件变更不得表述为"已同步 GitLab"。
```
