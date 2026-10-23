# AI Native ALM MVP 架构与模块边界

- 状态：评审草案（批次 1 开工前冻结）
- 日期：2026-10-23
- 依据：[产品蓝图](../product/ai-native-alm-mvp.md)、[需求评审](../analysis/alm-mvp-requirements-review.md)、[ADR 0003](../adr/0003-alm-mvp-engineering.md)

## 1. 目标与非目标

**目标**：在一个仓库内交付可独立测试的 ALM core、两个 DSH 业务插件、一套 AI 技能与部分退款样例，跑通“改资产 → 门禁 → PR → 基线”的端到端回路。

**非目标**：自研 Git 托管、通用流程引擎、组织权限中心、多 Git 平台/多文档格式同时支持、AI 自动批准。

## 2. 目录布局

```text
.
├── packages/
│   ├── alm-core/                 # 领域模型、解析、索引、门禁、diff、基线、CLI
│   │   ├── bin/alm.mjs           # 命令入口（node ≥ 22）
│   │   ├── src/
│   │   │   ├── contracts/        # 资产/证据/审批/基线/发现 JSON Schema
│   │   │   ├── parse/            # sdoc 子集、YAML、Markdown frontmatter、OpenAPI
│   │   │   ├── model/            # Asset/Relation/ChangeSet/Actor/Approval
│   │   │   ├── index/            # 关系索引、影响闭包
│   │   │   ├── gates/            # 规则实现（每条规则一个文件 + 注册表）
│   │   │   ├── diff/             # 结构化差异
│   │   │   ├── baseline/         # 清单生成、规范化、重建校验
│   │   │   ├── evidence/         # 证据读写与 runId
│   │   │   └── workspace/        # 工作区、写权限边界
│   │   └── test/                 # node:test；正例 + 反例
│   ├── alm-scm/                  # SCM/CI 适配器：local-git、github、gitea
│   ├── dsh-plugin-alm-core/      # Cordis 插件：注册 alm 服务与 Agent 工具
│   ├── dsh-plugin-requirements/  # 需求插件（host 工具 + client 页面）
│   ├── dsh-plugin-architecture/  # 架构插件（host 工具 + client 页面）
│   └── alm-skills/               # 产品技能源（安装到目标工作区 .dsh/skills）
├── fixtures/
│   ├── order-refund/             # 部分退款样例资产（正例）
│   ├── negative/                 # 负例夹具：重复 ID、悬空关系、缺验收、非法状态、秘密串
│   └── smoke/                    # 最小 YAML 资产，用于 walking skeleton 与单测
├── .dsh/skills/
│   ├── ai-github-issue-workflow/ # 现有：工作项
│   ├── ai-github-pr-workflow/    # 现有：PR
│   └── alm-mvp-dev/              # 新增：开发本产品的执行技能
├── docs/                         # 制度、规划、ADR、产品、分析
└── scripts/                      # 仓库脚本（含 demo 初始化）
```

约束：

- `alm-core` 不依赖 DSH、不依赖网络；只依赖 `node:*` 与 `yaml`。
- 插件只做适配：参数校验、权限上下文、调用 core、渲染；不得复制领域规则。
- 样例仓库与产品仓库分离：`scripts/demo-init.ps1` 把 `fixtures/order-refund` 复制到 `tmp/demo-order-refund`（已 gitignore）并初始化 Git，避免测试污染工作区。

## 3. 运行时与依赖

| 项 | 选择 | 说明 |
|---|---|---|
| 运行时 | Node ≥ 22（本机 26.7.0） | ESM；无构建步骤（ADR 0003） |
| 语言 | ESM JavaScript + JSDoc | 插件宿主本来就加载 ESM；`tsc --checkJs` 可选 |
| 运行时依赖 | `yaml` | 仅解析 YAML/OpenAPI；其余用标准库 |
| 测试 | `node:test` + `assert` | 零额外依赖；`node --test` |
| 插件宿主 | DSH 44.7.0 Cordis | 安装方式：`plugin_manager install_bundle`（工作区 bundle） |
| 可选渲染 | Python 3.13.2（`py -3.13`）+ `strictdoc==0.30.4` | 不在核心路径；隔离 venv 生成渲染证据，缺失时 `REN-001` 只做结构检查、`REN-002` 记 `skip` |
| CLI 退出码 | 0 通过 / 1 门禁失败 / 2 用法错误 / 3 内部错误 | CI 与 Agent 都按退出码判定 |

## 4. 领域模型

### 4.1 资产归一化

七类资产：`requirement`、`architecture-decision`、`module`、`interface`、`data-model`、`acceptance-test`、`risk`。

无论源格式如何，解析后统一为：

```js
{
  id: 'REQ-PAY-001',
  type: 'requirement',
  title: '支持部分退款',
  status: 'proposed',            // proposed|accepted|deprecated|superseded
  owner: 'team-payments',
  links: [{ type: 'verified_by', target: 'TEST-PAY-001' }],
  source: { path: 'requirements/refund.sdoc', format: 'sdoc', line: 12 },
  body: '……',                     // 渲染用正文，不参与 ID/关系判定
  extra: {}                       // 领域字段（如 interface 的 operationId）
}
```

### 4.2 源格式与映射

| 资产 | 源格式 | 解析要点 |
|---|---|---|
| requirement | StrictDoc `.sdoc` 子集 | `[REQUIREMENT]` 节点；`UID/TITLE/STATUS/OWNER` 字段；`[RELATION]` 的 `Type/Value` 映射为 `links` |
| acceptance-test | `.sdoc` 或 Markdown + frontmatter | 必须声明 `verifies: [REQ-*]`，与 `verified_by` 双向一致 |
| architecture-decision | Markdown + YAML frontmatter | `id/type/title/status/owner/links`；正文含 Context/Decision/Consequences |
| module | `.yml` | `id/type/title/owner/links/depends_on` |
| interface | OpenAPI `.yml` + 关联 `.md` | `operationId` 作为 `id` 兜底；`links.constrained_by` 指向 ADR |
| data-model | `.yml` | 实体/字段；`links` 指向 interface |
| risk | `.yml` | 关联需求/决策 |

不支持嵌套目录扫描以外的高级语法时，解析器返回 `FMT-001` 并给出文件/行号，不静默跳过。

### 4.3 ID 与关系

- ID 格式：`<PREFIX>-<DOMAIN>-<NNN>`，前缀与类型绑定：`REQ/ADR/MOD/IF/DM/TEST/RISK`。
- 关系类型与允许方向：

| 关系 | 源 → 目标 | 语义 |
|---|---|---|
| `satisfies` | requirement → requirement | 子需求满足父需求 |
| `allocated_to` | requirement → module | 需求分配到模块 |
| `depends_on` | module/interface/data-model → module/interface | 依赖 |
| `constrained_by` | interface/data-model/module → architecture-decision | 受决策约束 |
| `verified_by` | requirement → acceptance-test | 验收覆盖 |
| `supersedes` | 任意 → 同类型 | 取代旧资产 |

反向关系（`verified_by` 的逆）由索引推导，不允许在文件里重复声明两份事实。

## 5. 命令面（稳定契约）

```text
alm check   [--base <sha>] [--json] [--out <file>]         # 门禁，默认对比工作区
alm index   [--json]                                       # 资产与关系索引
alm show    <ASSET-ID> [--json]
alm query   --type <t> [--status <s>] [--owner <o>] [--json]
alm diff    --base <sha> [--head <sha|worktree>] [--json]  # 结构化差异
alm impact  --asset <ID> [--json]                          # 影响闭包
alm trace   <REQ-ID> [--json]                              # 追踪链
alm baseline create --commit <sha> --tag <name> [--json]
alm baseline verify --manifest <path> [--json]
alm evidence show --run <id> [--json]
alm approval record --actor <id> --kind <human> --sha <sha> --decision <approve|reject>
alm approval verify --sha <sha> [--json]
alm workspace create --baseline <sha|tag> --change <CHG-ID>
alm workspace status [--json]
alm contract verify                                        # 契约自检
```

所有 `--json` 输出以 `{"schema":"alm.<area>/v1",...}` 开头；人类输出不得成为判决依据。

## 6. 门禁规则集

R1（ALM-02.03）实现 `FMT/ID/REL/COV/STATE/SEC/REN`；R2（ALM-02.05、ALM-04.*）增加 `BASE/APPROVAL/PUB`。

| 规则 | 级别 | 检查 | 反例 |
|---|---|---|---|
| `FMT-001` | block | 文件可解析、编码合法 | 破损 YAML、缺 `[REQUIREMENT]` |
| `FMT-002` | block | 必填字段与 `schema_version` | 缺 `owner` |
| `ID-001` | block | 全局 ID 唯一 | 两个 `REQ-PAY-001` |
| `ID-002` | block | 前缀与类型一致 | `ADR-*` 标成 `requirement` |
| `REL-001` | block | 关系目标存在 | 指向 `MOD-PAY-NOPE` |
| `REL-002` | block | 关系类型/方向合法 | requirement `depends_on` requirement |
| `COV-001` | block | 每条 requirement 至少一条 `verified_by` | 需求无验收 |
| `COV-002` | warn | 验收用例被引用（孤儿检测） | 孤立 `TEST-*` |
| `STATE-001` | block | 状态迁移合法 | `accepted → proposed` |
| `BASE-001` | block | 已发布基线不被原地修改 | 直接改 `baseline/*` 标签内容 |
| `SEC-001` | block | 秘密/高熵串扫描 | 提交 `api_key=sk-...` |
| `REN-001` | block | Markdown 链接与 Mermaid 块结构可渲染 | 悬空相对链接 |
| `REN-002` | warn | StrictDoc 渲染证据（manifest/版本/产物哈希）；工具或产物缺失记 `skip` | 渲染失败、版本不符、产物哈希不匹配 |
| `APPROVAL-001` | block | 存在绑定当前 head SHA 的 approve | 用旧 SHA 审批合并 |
| `APPROVAL-002` | block | 审批者 kind=human 且非提交者 | Agent 自批 |
| `PUB-001` | block | 发布证据完整且不可覆盖 | 缺证据直接建基线 |

> `checks[].level` 取 `block` / `warn`：只有 `level=block` 的失败才使 `result=fail` 并改变退出码。`REN-002` 是 `REN-001` 的可选渲染证据，恒为 `warn`，StrictDoc 缺失时记 `skip`。
> 上表中 `BASE-001`、`APPROVAL-*`、`PUB-001` 依赖基线/审批数据，随 R2 落地。

规则包版本写在 `packages/alm-core/src/gates/pack.json`（`version` + 规则清单），任何规则的新增/放宽必须升版本并在证据中记录。

## 7. 工作区、权限与身份

- 所有写操作要求 `ALM_WORKSPACE` 指向已创建的变更工作区；写入路径限定在 `requirements/`、`architecture/`、`tests/`、`adr/`。
- Agent 工具分两类：只读（`alm.index/query/show/diff/impact/trace`）与写入建议（`alm.change.*`）；**不存在**审批、发布、改规则、改保护分支的工具。
- 提交必须携带 actor trailer；`APPROVAL-002` 据此判定自批。
- 外部写（PR、发布）调用前展示目标仓库/分支/SHA/动作，写入后回读服务端状态。

## 8. 插件集成点（以实测为准）

| 插件 | Host | Client |
|---|---|---|
| `dsh-plugin-alm-core` | 注册 `alm` 服务（索引/门禁/差异/证据）、注册只读工具 | 无（可选：状态胶囊） |
| `dsh-plugin-requirements` | 需求工具（`alm.query/show/trace/change.*` 的子集） | `main` keyed slot 注册“需求”页；`sidebar.panellist` 加入口 |
| `dsh-plugin-architecture` | 架构工具（依赖图、影响闭包） | 同上，注册“架构”页 |

实现前必须按 `cordis-plugin-development` 技能重新读取目标版本的 host/client 模板与 slot 注册参数，不猜字段名（见 ALM-01.02）。

## 9. 证据、基线与构建

- 门禁一次运行 = 一个 `alm.evidence/v1` 文件，落在 `.alm/evidence/<runId>.json`；服务端与本地跑同一规则包版本，两边的 `runId` 不互相替代。
- 基线清单 = `.alm/baselines/<baselineId>.json`；`contentHash` 只覆盖文件清单，不含时间戳，保证重建可比较。
- 重建：`alm baseline verify` 用 `git archive <sourceCommit>` 解包到临时目录后逐文件哈希；不依赖当前工作区。
- 发布存储（MVP 本地目录 `.alm/published/`）只写一次；同 SHA 重放必须哈希一致。
- 渲染证据：`scripts/strictdoc-render.ps1` 在隔离 venv（`tmp/strictdoc-venv`，`strictdoc==0.30.4`）生成 `.alm/render/manifest.json`（`strictdocVersion`、`sourceSha`、`files[].sha256`）；`REN-002` 只读校验，缺工具/产物记 `skip`，哈希或版本不符记 `fail` 且 `level=warn`，均不改变 `alm check` 退出码。渲染产物是构建物，不进 Git，仅作为证据附件。

## 10. 测试层次

| 层 | 内容 | 命令 |
|---|---|---|
| 单元 | 解析、ID/关系、闭包、diff、规范化哈希 | `node --test packages/alm-core/test/unit` |
| 集成 | 临时 Git 仓库、工作区、门禁、证据、基线重建 | `node --test packages/alm-core/test/integration` |
| 插件契约 | 安装/禁用、服务依赖、工具 schema、slot 注册 | `node --test packages/*/test` + 手工验证记录 |
| 端到端 | 正例 + 6 类负例 + 审批失效 + 重建 | `node --test packages/alm-core/test/e2e` |
| 技能 | 技能加载、命令存在、dry-run | `scripts/validate-skills.ps1` + 技能冒烟脚本 |

## 11. 与现有仓库流程的关系

- 产品代码走现有 Issue/PR 流程：一卡一分支一 PR，目标 `develop`。
- 台账 `docs/planning/issue-register.md` 只登记 `ALM-*`；产品自身不引入第二套工作流。
- 本仓库的 GitHub 工作流保持不变；样例仓库的 PR 由 `alm-scm` 适配器驱动，不迁移本仓库。
