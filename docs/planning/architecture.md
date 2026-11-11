# AI Native ALM MVP 架构与模块边界

- 状态：评审草案（批次 1 开工前冻结）
- 日期：2026-10-23
- 依据：[产品蓝图](../product/ai-native-alm-mvp.md)、[需求评审](../analysis/alm-mvp-requirements-review.md)、[ADR 0003](../adr/0003-alm-mvp-engineering.md)

## 原生意图编辑与确认衔接（2026-11-04）

- 本地验收字段编辑不得被旧服务端 readiness 永久禁用保存入口；进入最终表单前须串行保存本地编辑，再依据最新服务端结果判断真实缺失/未知/过期条件。表单入口与最终写入是不同阶段，优先级可在最终页补齐，人工确认本身只能由真实提交产生。
- 最终确认仍由 core 重算完整门禁并校验 revision/context/hash/幂等键；客户端不伪造 confirmation，不将本地草稿当作已确认。保存失败保留本地字段，不创建需求；并行点击、在途保存与旧响应必须隔离。

## 验收执行证据迁移（2026-11-04）

- `alm.acceptance/v3`（summary/v3）将验收绑定到执行前后完整且稳定的 worktree 快照、HEAD、requirementHash、testRevision 和规范化命令注册 configHash（含 timeout）；命令 id/argv 与实际结果须一致。独立 `contracts/acceptance.schema.json` 描述执行回执，不替换门禁 `alm.evidence/v1`。单测执行该 schema 的全部已用关键词，并由 binding 检查跨字段一致性。
- v1/v2 回执只读保留，不隐式升级；其 current=false、staleReason=worktree-unbound。必须针对当前内容真实重跑才生成 v3。相同 HEAD 重跑将不同旧回执原始字节以 SHA256 内容地址归档，包括损坏 JSON，不覆盖历史。
- 新 candidate/v2 的 current 必须验证实际回执文件 SHA、真实 pass、完整 provenance、命令结果、稳定工作树、需求/测试/注册绑定；只拿旧摘要不能给新 dirty 内容洗成已验证。旧 candidate/v1 和未验证 draft 保留但不 current，不阻止创建新 draft；已发布历史事实仍独立，不因迁移回滚。
- worktreeSnapshot 无 DSH 依赖，git 失败、HEAD 不可用、超限、超大文件、非普通文件、读取失败一律 complete=false，不以文件大小充当内容哈希。既定 `.git/.alm/node_modules/dist/tmp` 排除范围不变。
- query 可在单次同步读取共享惰性 worktreeSnapshot 与已索引 assets；无 TTL/跨请求缓存。候选、签收等写门禁默认重新读取快照与测试资产，不复用 query 缓存。此证据证明命令运行内容一致，不声称覆盖每条业务 AC，也不新增自动签收/发布权限。

## REQ-ALM-006 交换设计（2026-11-04，实施前设计）

- 冻结领域入口 `requirements/exchange.mjs`：exportRequirements({root,format:'json'}) 直接返回 `alm.requirements.exchange/v1`；previewRequirementsImport({root,payload}) 返回 ok/conflicts/localHash/changes；applyRequirementsImport({root,payload,expectedLocalHash}) 返回 applied/idempotent。JSON 导出与预览不写文件。
- payload 含 exportId/projectId/records；record 含 uid/projectId/base/baseHash/values/attachments。只准四个字段 title/brief/priority/owner。使用规范键顺序 SHA256，导出基线及身份另以本地项目密钥HMAC签章：显式 initializeRequirementsExchange({root}) 在项目内持久化随机256-bit密钥（幂等、不轮换已有key）；createRequirement 的真实创建路径初始化，旧项目经独立HTTP initialize动作及UI「初始化交换」按钮初始化。export/preview仅读取key，未初始化时返回exchange-uninitialized，绝不隐式写盘或使用进程内临时key。相同项目的独立进程读取同一持久key，首次导出即支持跨进程回导；无改导入仍不写。不可仅重新计算外部自带 hash 就信任伪造基线。
- 三向逻辑：E=B 保留 L；L=B 或 L=E 接受 E；否则冲突。缺行不删除。预览 hash 绑定当前源文件字节；确认须 CAS。先验证/规划全批，再在同项目锁下暂存并原子替换文件；写失败回滚，进程崩溃恢复与外部不合作写入的限制需明确留证。
- XLSX 适配独立于 UI，保留完整元数据/基线并验证不可编辑列；拒绝公式、外部关系、宏、损坏 ZIP、超大展开内容。工程限制：单文件 8 MiB、至多 1000 记录、brief 1 MiB、title 200 字符、owner 120 字符、附件仅相对安全 manifest；超过限制明确失败，不截断。priority 采用现有更新支持的 P0-P3，owner 支持空字符串代表未分配（缺失/非字符串仍拒绝）；asset/v1 schema同步做兼容性输入放宽，不改版本或删字段。XLSX的Requirements表F-I是可编辑四字段，Brief表C列保存长正文续块，record/chunk只读；不截断长正文。普通外部编辑器可在原记录块末尾后追加显式create行：A=create/B空UID/C唯一clientId/D当前project/E空baseHash/F-I四值，attachments为空；既有槽位身份不许改成create。新增brief限单格32767字符，超长新建请用JSON，不静默截断。
- HTTP 复用插件工作区路由与权限边界，不允许文件 payload 指定本机根路径。POST exchange 按 initialize/export/preview/apply 分派，文件通过有界 base64 传输，导出返回 MIME/filename/content；前端使用 Blob 下载与 input[type=file]，预览确认后提交同一文件和 localHash。错误需返回明确 4xx，冲突/CAS 为 409。
- 下载修复设计：支持 File System Access 的浏览器在用户点击的同步调用栈内打开保存选择器（不得先 await export 丢失用户激活），再经既有认证 POST 取文件、校验字节数并 write/close；只有 close 成功才显示已保存。用户取消不降级为另一次下载；写失败中止 writable 并明确报错。其他浏览器仍用 Blob 下载，但锚点和 URL 同时保留60秒再清理，不立即 remove；浏览器无完成回执，因此仅显示「已发起下载，请检查浏览器下载记录」，不得显示已保存。此设计不更改 HTTP/认证/交换领域协议；真实落盘仍须 Desktop 独立验证。
- 不修改冻结观察员、不修调查证据序列化/ID 分配独立缺陷，不伪造签收。实际实现偏差及构建/HTTP/Desktop 证据登记 RUN-007。

## REQ-ALM-007 调查消息预算（2026-11-04，实施前设计）

- 仅修改插件 `investigate.mjs` 的消息序列化；采集、根路径隔离、逐字引用核对、只读权限及结果降级保持原样。冻结 observer 脚本不改，生成任务卡的 verified_by 模板不执行，以已授权正文为准。
- 总 system + user 文本限制 25000 个 JavaScript UTF-16 字符（比冻结门禁仅检查 user 更严格）。保持原消息 parts 形状。先计固定提示与结构 JSON，再逐条尝试完整 snippet（path/line/endLine/text 原样），然后文件元数据，最后 tree；不能容纳的整条遗漏，继续尝试后续较小条目。不切源码 quote，不整体截断 JSON，不提高预算。
- boundary.messageBudget 显式记录 limitCharacters、systemCharacters、userCharacters、totalCharacters，以及 snippets/files/tree 原始、保留、遗漏条数；每次试装均包含最新计数及字符数，自洽后才判定是否容纳。collection boundary.truncated 与预算遗漏分别记录，并在任一发生时标记 truncated。question 使用既有 2000 字符限制，keywords/project 上下文有界。
- 导出 builder 对继承 boundary 元数据 fail closed：maxFiles/maxSnippets 为非负安全整数或 null/缺失，scannedFiles 为非负安全整数或缺失，truncated 为布尔值或缺失；字符串、非有限数、负数、非整数及不安全整数明确返回 invalid-request/400，不进行隐式类型转换。返回前复核总字符硬预算，超限明确拒绝，不返回超限消息。这是导出函数健壮性，不宣称正常 collector 或 HTTP 已存在外部利用。
- 没有 snippet 可容纳时输出完整空数组与遗漏计数；保留既有 not-determined/unknowns 指令，不能为测试制造 finding。真实 Desktop 构建重载和原第一次问题重放另留证，不以序列化单测替代 AC-03。

## 原生需求确认编号占用（2026-11-04，bootstrap 修复）

- 自动编号从当前项目已索引 UID 的最大序号之后开始，依次跳过已占用的标准目标路径：`requirements/<小写UID>.sdoc`、`requirements/briefs/<UID>.md`、`requirements/attachments/<UID>`。孤立文件或目录同样占号，无附件输入也不得复用已有附件目录；规划仅读取，不清理、覆盖或认领孤立材料。
- 显式 UID 若已索引或任一目标路径被占用，返回 `already-exists`/409，不自动换号、不写入。编号修复不处理历史意图记录，不改确认去向、就绪校验或任何人工门禁。
- 确认沿用既有同键同负载回执重放与失败计划恢复；已分配 UID 不在重试时重新分配，同键不同负载仍拒绝。临时根测试核对孤立材料、既有需求和回执原始字节不变；不以此代替 Desktop 确认、人工签收或自主交付。

## 需求项目上下文隔离（2026-11-04，bootstrap 修复）

- 未明确选择项目/root 时，不调用需求列表的默认 fixture root，不把样例记录展示为当前工作区需求。允许真实项目目录加载；没有可信宿主上下文时明确提示选择，不猜测项目。
- 列表请求绑定 root/project scope 和请求代次；scope 改变立即隔离旧 rows、统计和错误，丢弃迟到的旧响应；同 scope 刷新可保留已有数据但只允许最新请求提交结果。项目响应不得把其他 scope 的 project 写回当前选择。
- 持久有效 root/项目与全部项目聚合路径保留；切换到新项目不得继续操作旧项目的选中需求。此为可见性基础修复，不补造历史意图或运行成功，不计两轮插件交付。

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
| interface | OpenAPI `.yml` + 关联 `.md` | `info.x-alm-id` 与 `info.x-alm-owner` 必填；`x-alm-links` 映射关系；`operationId` 记入 `extra` |
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
| `TASK-001` | block | 变更任务草案（`changes/<CHG>/tasks.json`）覆盖每条需求 | 需求无任务覆盖 / 任务无 covers / 重复任务 ID |
| `REL-003` | block | 需求层级（`parent_of` / `satisfies`）无环 | 父子关系成环 |
| `PRJ-001` | block | 需求声明的 `PROJECT` 必须与仓库 `.alm/project.json` 一致 | 项目不一致 / 项目文件非法 |
| `REV-001` | block | `REVISION` 为正整数；内容变化必须递增（状态变更交给 STATE-001） | 版本回退 / 改了内容没升版本 |
| `BRIEF-001` | warn | 声明了 `BRIEF` 的文件必须存在且有内容；`accepted` 需求应有 brief | brief 缺失 / 过短 |
| `ATT-001` | block | `requirements/attachments/<ID>/manifest.json` 的文件存在且哈希匹配 | 附件缺失 / 哈希不符 / manifest 逃逸目录 |
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
