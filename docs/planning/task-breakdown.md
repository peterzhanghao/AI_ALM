# 任务拆解

> 每张执行 Task 在此保留稳定的目标、范围与验收；进展写 Issue 评论，不写在这里。批次划分见 [`issue-register.md`](issue-register.md)。

## 拆分原则

- 一个执行 Task 由一人通过一个 PR 交付，并有可独立验证的正例与反例。
- 需要多个 PR 时，原编号降为跟踪 Issue，子项成为 sub-issue。
- 跨仓库或跨服务的改动拆成独立 Issue，不用一个 PR 夹带。
- 依赖关系同时在正文与 GitHub blocked-by 关系中表达。
- 每张卡必须写全五要素：范围、接口、正例、反例、证据；并声明所用技能（见 [`skill-plan.md`](skill-plan.md)）。
- 验收项必须是可运行命令或可观察结果，禁止“测试通过”“符合需求”。

## 卡片模板

```markdown
### ALM-01.02 <标题>

- 类型：Task / Bug / Feature
- Owner：@<login>
- 优先级：P0 / P1 / P2
- 前置：ALM-xx.yy（GitHub #n）
- 技能：alm-mvp-dev（章节）
- 实施范围：模块 / 服务 / 目录
- 不在范围：相邻能力及承接项
- 接口：输入输出 / 命令 / 错误码
- 交付物：
  - [ ] …
- 验收：
  - 正例：输入 → 输出 → 可观察结果
  - 反例：越权 / 错误版本 / 非法状态 / 失败恢复
- 证据：测试命令、固定 SHA、截图或环境
```

---

## 批次 1（P0，可并行）

### ALM-01.01 工程骨架、命令面与 CI

- 类型：Task ｜ Owner：@peterzhanghao ｜ 优先级：P0 ｜ 前置：无
- 技能：`alm-mvp-dev`（仓库布局、常用命令、交付纪律）
- 实施范围：根 `package.json`/`pnpm-workspace.yaml`、`packages/alm-core/{package.json,bin/alm.mjs,src/contracts}`、`scripts/demo-init.ps1`、`.github/workflows/alm-ci.yml`
- 不在范围：具体解析与规则实现（ALM-02.*）；插件（ALM-01.02）
- 接口：`alm --help` 输出命令表；`alm contract verify` 校验五类契约存在且 `schema` 版本一致；未知命令退出码 2
- 交付物：
  - [ ] pnpm workspace 与 `alm-core` 包骨架，唯一运行时依赖 `yaml`
  - [ ] `alm` 命令入口与 `--help`、`--version`、退出码约定
  - [ ] 五类契约骨架文件（asset/evidence/approval/baseline/finding）
  - [ ] `scripts/demo-init.ps1`：从 fixtures 复制到 `tmp/demo-order-refund` 并 `git init`
  - [ ] CI：`node --test`、`alm --help` 冒烟、`validate-skills.ps1`
- 验收：
  - 正例：`node packages/alm-core/bin/alm.mjs --help` → 退出 0 且列出命令；`alm contract verify` → 退出 0
  - 反例：`alm nope` → 退出 2；删除任一契约文件 → `contract verify` 退出 1 并指出缺失文件
- 证据：`node --test packages/alm-core/test`、CI 运行链接、`alm --help` 输出

### ALM-01.02 DSH 44.7.0 插件能力验证

- 类型：Task ｜ Owner：@peterzhanghao ｜ 优先级：P0 ｜ 前置：ALM-01.01
- 技能：`alm-mvp-dev`（宿主验证）、`cordis-plugin-development`（模板与安装）
- 实施范围：`packages/dsh-plugin-alm-core/`（spike 版）、`docs/planning/host-verification.md`
- 不在范围：业务页面与真实业务工具（ALM-03.*）
- 接口：插件导出 host 服务名 `almProbe`、只读工具 `alm_probe`；client 半侧在 `main` slot 渲染占位卡片
- 交付物：
  - [ ] 可安装 bundle（`package.json` + `cordis.patch.yml` + host/client 入口 + locale/icon）
  - [ ] 验证记录：安装/禁用/卸载、Host Service 注册、插件间 Service 依赖、Tool 注册与 schema、Client slot 渲染、权限行为、异常恢复
  - [ ] 失败降级结论：CLI + MCP 是否可作为替代，缺口清单
- 验收：
  - 正例：`install_bundle` 后 `alm_probe` 可调用并返回版本与资产计数；`main` slot 出现页面；禁用后工具与页面同时消失
  - 反例：配置非法时插件加载失败但宿主不崩溃；未安装时调用工具得到“工具不存在”，不是伪造结果
- 证据：`cordis_inspect_query` 输出、安装结果 `application` 字段、截图、`host-verification.md`

### ALM-01.03 `alm index` 与 `alm check` 最小回路

- 类型：Task ｜ Owner：@peterzhanghao ｜ 优先级：P0 ｜ 前置：ALM-01.01
- 技能：`alm-mvp-dev`（命令面、门禁规则）
- 实施范围：`packages/alm-core/src/{model,index,gates}`、`fixtures/smoke/`（仅 YAML 资产）
- 不在范围：SDoc/OpenAPI 解析（ALM-02.01）、全量规则（ALM-02.03）
- 接口：`alm index --json` → `alm.index/v1`；`alm check --json` → `alm.check/v1`；退出 0/1
- 交付物：
  - [ ] YAML 资产生成 `Asset` 归一化模型与内存索引
  - [ ] 规则引擎骨架（注册表、级别、定位到文件/资产）
  - [ ] `ID-001` 唯一性、`REL-001` 悬空引用两条硬规则
  - [ ] 失败输出包含 `assetId`、`file`、`line`
- 验收：
  - 正例：`fixtures/smoke` → `alm check` 退出 0，JSON 含 2 条 `pass`
  - 反例：重复 ID / 指向不存在目标 → 退出 1，错误定位到资产与文件行号
- 证据：`node --test packages/alm-core/test`、两次 `alm check` 输出

### ALM-02.01 资产模型与解析器

- 类型：Task ｜ Owner：@peterzhanghao ｜ 优先级：P0 ｜ 前置：ALM-01.01
- 技能：`alm-mvp-dev`（契约位置、解析边界）
- 实施范围：`packages/alm-core/src/parse/*`、`packages/alm-core/src/contracts/asset.schema.json`、单测
- 不在范围：门禁规则（ALM-02.03）、渲染（REN-001/REN-002 后续）
- 接口：`parseRepo(root)` → `Asset[]`；解析错误结构 `{rule:'FMT-001',file,line,message}`
- 交付物：
  - [ ] `.sdoc` 子集解析（`[DOCUMENT]/[SECTION]/[REQUIREMENT]/[RELATION]`，`UID/TITLE/STATUS/OWNER`）
  - [ ] Markdown + frontmatter、YAML、OpenAPI 引用解析
  - [ ] 七类资产、六类关系的映射与校验
  - [ ] 解析器对未知语法显式报错，不静默跳过
- 验收：
  - 正例：完整样例解析出 7 类资产，`links` 与源文件一致
  - 反例：破损 YAML / 缺 `UID` / 未知关系类型 → `FMT-001` 带文件与行号；退出 1
- 证据：`node --test packages/alm-core/test/unit/parse`

### ALM-02.02 部分退款样例资产与负例夹具

- 类型：Task ｜ Owner：@peterzhanghao ｜ 优先级：P0 ｜ 前置：ALM-02.01
- 技能：`alm-requirements`、`alm-architecture`（格式与关系选择）
- 实施范围：`fixtures/order-refund/`、`fixtures/negative/*`
- 不在范围：样例仓库的 PR/CI（ALM-04.*）
- 接口：样例仓库结构 `requirements/`、`architecture/`、`adr/`、`tests/`
- 交付物：
  - [ ] `REQ-PAY-001` 部分退款需求（sdoc）
  - [ ] `ADR-PAY-003` 退款一致性决策（md + frontmatter）
  - [ ] `MOD-PAY-REFUND` 模块、`IF-PAY-REFUND-API` 接口（OpenAPI）、`DM-PAY-REFUND` 数据模型
  - [ ] `TEST-PAY-001` 验收用例、`RISK-PAY-001` 风险
  - [ ] 负例夹具：重复 ID、悬空关系、缺验收、非法状态、格式错误、秘密串，并在 `cases.json` 标注预期规则与生效状态
- 验收：
  - 正例：`alm index` 列出 7 类资产、4 种格式且全部关系可解析；`alm check` 退出 0
  - 反例：已生效的负例（`ID-001`/`REL-001`/`FMT-001`/`FMT-002`）失败并定位到文件；`COV-001`/`SEC-001` 夹具就位，待 ALM-02.03 生效
- 证据：`alm index --json` 计数、`alm check` 输出、`fixtures/negative/cases.json`

### ALM-02.03 硬门禁规则集 R1

- 类型：Task ｜ Owner：@peterzhanghao ｜ 优先级：P0 ｜ 前置：ALM-02.02、ALM-01.03
- 技能：`alm-change-workflow`（门禁判定与修复）、`alm-mvp-dev`（新增规则流程）
- 实施范围：`packages/alm-core/src/gates/*`、`packages/alm-core/src/gates/pack.json`、`packages/alm-core/src/gates/render.mjs`、`scripts/strictdoc-render.ps1`
- 不在范围：基线/审批/发布类规则（R2，见 ALM-02.05/04.*）；StrictDoc 之外的文档渲染器
- 接口：规则 `{id, level, check(ctx)}`；`REN-002` 读取 `.alm/render/manifest.json`；渲染证据缺失记 `skip`，任何情况下不改变 `alm check` 退出码
- 交付物：
  - [ ] `FMT-001/002`、`ID-001/002`、`REL-001/002`、`COV-001`、`COV-002`(warn)、`STATE-001`、`SEC-001`、`REN-001`（结构，block）
  - [ ] `REN-002`（StrictDoc 渲染证据，warn，非阻断）：校验 manifest 的 `strictdocVersion`、`sourceSha` 与产物哈希；缺失记 `skip`，不匹配记 `fail`（level=warn）
  - [ ] `scripts/strictdoc-render.ps1`：隔离 venv（`tmp/strictdoc-venv`）、固定 `strictdoc==0.30.4`、产出 `.alm/render/manifest.json`
  - [ ] 规则包版本与证据记录（`checks[].level` 区分 block / warn）
  - [ ] 每条规则至少一个反例测试
- 验收：
  - 正例：样例仓库 `alm check` 退出 0，`checks` 覆盖全部 R1 规则；有渲染产物时 `REN-002=pass` 且退出码仍为 0；无产物或未装 StrictDoc 时 `REN-002=skip` 且退出码仍为 0
  - 反例：5 类负例分别只触发预期规则并退出 1；删除/损坏 StrictDoc 产物或工具缺失时 `alm check` **不得失败**，只记录 `skip` / `fail(warn)`，退出码不变
- 证据：`node --test packages/alm-core/test/{unit,integration}`、`alm check --json` 五次输出、`scripts/strictdoc-render.ps1` 运行记录与 `.alm/render/manifest.json`

### ALM-05.03 开发技能 `alm-mvp-dev`

- 类型：Task ｜ Owner：@peterzhanghao ｜ 优先级：P0 ｜ 前置：ALM-01.01
- 技能：自身（遵循 `skill-creator` 的结构约定）
- 实施范围：`.dsh/skills/alm-mvp-dev/{SKILL.md,references/}`
- 不在范围：产品技能（ALM-05.01/05.02）
- 接口：`skill` 工具可加载；正文 ≤ 8 KB；frontmatter `name` 与目录一致
- 交付物：
  - [ ] 仓库布局、常用命令、契约位置、门禁规则表、交付纪律、故障诊断
  - [ ] `references/` 承载长表格与命令清单
  - [ ] 冒烟：文中 `alm` 命令全部存在于 `alm --help`
- 验收：
  - 正例：DSH 可加载；按技能执行 `alm check` 成功；`scripts/validate-skills.ps1` 通过
  - 反例：引用不存在命令 → 冒烟脚本失败；正文超限 → 校验失败
- 证据：校验脚本输出、加载记录、冒烟脚本输出

---

## 批次 2（P0）

### ALM-02.05 证据模型与基线清单

- 前置：ALM-02.03 ｜ 技能：`alm-mvp-dev`、`alm-release-verify`
- 范围：`packages/alm-core/src/{evidence,baseline}`、`contracts/evidence.schema.json`、`contracts/baseline.schema.json`
- 接口：`alm check --out <file>` 写 `alm.evidence/v1`；`alm baseline create|verify`
- 交付物：证据结构与 runId；规范化序列化（键排序/LF/UTF-8）；`contentHash`；只写一次的发布目录
- 验收：
  - 正例：同 commit 重建两次，`files[]` 与 `contentHash` 完全一致；离线可校验
  - 反例：篡改任一文件 → `baseline verify` 退出 1 并列出差异；同 SHA 重复创建不同内容 → 拒绝且不覆盖
- 证据：`node --test test/integration/baseline`、两份清单 diff

### ALM-03.01 core 服务契约与 Agent 工具

- 前置：ALM-01.02、ALM-02.01 ｜ 技能：`alm-mvp-dev`、`alm-change-workflow`
- 范围：`packages/dsh-plugin-alm-core/`、工具定义与权限守卫
- 接口：Host Service `alm`（index/query/show/diff/impact/check/evidence）；工具 5 只读 + 3 写入建议
- 交付物：工具 schema；工作区上下文校验；无审批/发布/改规则工具；错误码映射
- 验收：
  - 正例：工具返回与 CLI JSON 同构；写入工具仅在工作区内成功
  - 反例：无工作区时写入被拒；路径逃逸被拒；不存在“批准/发布”工具
- 证据：`cordis_inspect_query` 工具清单、拒绝路径测试

### ALM-05.01 产品技能：变更工作流

- 前置：ALM-03.01 ｜ 技能：`alm-mvp-dev`
- 范围：`packages/alm-skills/alm-change-workflow/`
- 交付物：拉基线→建工作区→改资产→check→diff→impact→提 PR→证据；权限红线；常见失败修复
- 验收：
  - 正例：在样例仓库按技能完成一次变更并产出证据；命令全部存在
  - 反例：要求“批准自己的变更/改规则/发布”时技能明确拒绝并转人工
- 证据：冒烟脚本、样例演练记录

---

## 批次 3（P1）

### ALM-02.04 语义差异与影响闭包

- 前置：ALM-02.03 ｜ 技能：`alm-change-workflow`、`alm-architecture`
- 范围：`src/diff`、`src/index/closure`
- 接口：`alm diff --base <sha> [--head]` → `alm.diff/v1`；`alm impact --asset` → 资产列表 + 路径
- 验收：正例：改 REQ 后输出字段级差异与受影响资产；反例：环形依赖不递归爆栈，输出确定顺序并标记环
- 证据：`node --test test/unit/{diff,closure}`

### ALM-03.02 需求插件

- 前置：ALM-03.01、ALM-02.04 ｜ 技能：`alm-requirements`
- 范围：`packages/dsh-plugin-requirements/`
- 交付物：`main` slot “需求”页（清单/详情/差异/追踪缺口）；需求工具
- 验收：正例：安装后读取同一基线的需求与缺口；反例：无工作区时只读空态，不崩溃、不伪造数据
- 证据：安装记录、页面截图、工具调用

### ALM-03.03 架构插件

- 前置：ALM-03.01、ALM-02.04 ｜ 技能：`alm-architecture`
- 范围：`packages/dsh-plugin-architecture/`
- 交付物：模块/ADR/接口/数据模型目录、依赖图、影响视图；架构工具
- 验收：正例：依赖图与 `alm index` 一致；反例：非法关系在视图标红并关联门禁规则
- 证据：截图、图与索引对比

### ALM-03.04 跨插件联合变更与写权限边界

- 前置：ALM-03.02、ALM-03.03 ｜ 技能：`alm-change-workflow`
- 范围：两插件 + `alm-core` 工作区写入守卫
- 交付物：同一 ChangeSet 内两插件协作；目录白名单；冲突检测
- 验收：正例：一次变更同时改需求与架构，只产生一个 PR；反例：越界写入被拒；并发编辑冲突显式报错
- 证据：联调记录、拒绝测试

### ALM-05.02 产品技能：需求与架构

- 前置：ALM-03.02、ALM-03.03 ｜ 技能：`alm-mvp-dev`
- 范围：`packages/alm-skills/alm-requirements/`、`packages/alm-skills/alm-architecture/`
- 交付物：
  - [ ] 需求技能：SDoc 子集语法、必填字段、关系选择、验收写法、门禁失败修复
  - [ ] 架构技能：ADR/模块/接口/数据模型格式、Mermaid、影响闭包与依赖图用法
  - [ ] 两者的权限边界：只读默认，写入限当前工作区
- 验收：
  - 正例：按技能在样例仓库新增一条需求与一条 ADR，`alm check` 通过；命令全部存在
  - 反例：技能中的字段名与解析器不一致 → 冒烟测试失败；要求改门禁规则 → 技能拒绝
- 证据：`scripts/validate-skills.ps1`、两项变更的 `alm diff --json`

---

## 批次 4（P1）

### ALM-04.01 SCM 适配器与审批绑定 SHA

- 前置：ALM-02.03、ALM-03.01 ｜ 技能：`alm-change-workflow`
- 范围：`packages/alm-scm/`（`local-git`、`github`，`gitea` 接口预留）
- 交付物：PR 创建/状态/必需检查；审批记录 `alm.approval/v1`；`APPROVAL-001/002`
- 验收：正例：批准 SHA-A 后提交 SHA-B → 合并门禁失败并说明原因；反例：Agent 自批 → 失败；审批人非 human → 失败
- 证据：`node --test test/integration/scm`、两次 SHA 的门禁输出

### ALM-04.02 CI 必需检查与幂等证据

- 前置：ALM-04.01、ALM-02.05 ｜ 技能：`alm-release-verify`
- 范围：`.github/workflows`（样例）/本地 runner 脚本、证据存储
- 交付物：服务端复跑同规则包；必需检查；重复回调幂等键
- 验收：正例：重复 webhook 只产生一条检查记录；反例：客户端伪造通过不改变服务端结论
- 证据：重放测试、证据文件

### ALM-04.03 不可变基线与重建校验

- 前置：ALM-04.02 ｜ 技能：`alm-release-verify`
- 范围：`src/baseline` 发布存储、`alm baseline verify`
- 交付物：清单（commit/规则/工具/审批/证据/文件哈希）；只写一次；重建命令
- 验收：正例：同一 commit 重建文件清单与 SHA-256 一致；反例：内容变更 → 校验失败；已存在基线 → 不覆盖
- 证据：两份校验输出、发布目录列表

### ALM-04.04 故障、重试与恢复演练

- 前置：ALM-04.03 ｜ 技能：`alm-release-verify`
- 范围：失败注入脚本、恢复流程文档
- 交付物：中断重试、重复回调、发布失败不产生半成品、旧基线重建
- 验收：正例：中断后重试成功且只有一份正式基线；反例：失败路径不写正式基线、保留可诊断日志
- 证据：故障演练记录

### ALM-04.05 UI 验证的按需 CI 任务

- 类型：Task ｜ Owner：@peterzhanghao ｜ 优先级：P1 ｜ 前置：ALM-04.04（#41，已关闭）、ALM-06.01（#58，已关闭）
- 技能：`alm-mvp-dev`（测试层次）、`alm-release-verify`（证据）
- 实施范围：`.github/workflows/alm-ui.yml`、`docs/planning/verification-report.md` 的 CI 缺口行、`docs/usage.md` 的触发说明
- 不在范围：PR 必跑 UI 测试（浏览器体积与时长不适合每次 PR）；视觉回归基线对比
- 接口：`workflow_dispatch` 输入 `root`（默认 `fixtures/order-refund`）、`require`（可选文本框）、`base`（可选，指向已运行宿主）；产出 artifact `ui-report`（`report.json` + 两张 PNG）
- 交付物：
  - [ ] `workflow_dispatch` + `push`/`pull_request` 不触发；`concurrency` 串行、`timeout-minutes`
  - [ ] `pnpm install --frozen-lockfile` 后用 `pnpm exec playwright install --with-deps chromium` 安装浏览器
  - [ ] 执行 `node scripts/ui-verify.mjs --root <输入> --out tmp/ui`，`--require` 逐行透传
  - [ ] 上传 `tmp/ui`（`actions/upload-artifact`，保留 7 天）并在 job summary 里写检查数与截图名
- 验收：
  - 正例：`gh workflow run alm-ui.yml --ref develop` → run 绿；artifact 含 `report.json`、`requirements.png`、`architecture.png`；summary 显示 28 项检查
  - 反例：以 `require=REQ-PAY-999` 触发 → run 红，日志含 `FAIL required text`，artifact 仍上传（失败也留证据）
- 证据：run URL、artifact 清单、summary 截图

### ALM-04.06 Gitea SCM 适配器

- 类型：Task ｜ Owner：@peterzhanghao ｜ 优先级：P1 ｜ 前置：ALM-04.01（#35，已关闭）
- 技能：`alm-change-workflow`、`alm-mvp-dev`（适配器边界）
- 实施范围：`packages/alm-scm/src/gitea.mjs`、`packages/alm-scm/test/gitea.test.mjs`、`docs/development/gitea-adapter.md`、`packages/alm-scm/package.json` 的导出
- 不在范围：真实 Gitea 服务器部署；替换 `alm pr` 的本地合并路径；GitLab
- 接口：
  - `createGiteaClient({ baseUrl, owner, repo, token, fetchImpl, timeoutMs })` → `{ createPullRequest, getPullRequest, getCombinedStatus, comment, mergePullRequest }`
  - `createPullRequest({ base, head, title, body })` → `{ number, url, state }`；已存在同 head 的 open PR 时返回既有 PR（`created:false`）
  - `evaluateRequiredChecks(combined, required)` → `{ ok, reasons[] }`：`state=success` 且每个必需检查 `success`
  - 错误统一为 `GiteaError { status, code, message }`，401/403/404/409/超时分别可判定
- 交付物：
  - [ ] 仅用 `fetch` 与 `node:*`，无新依赖；`Authorization: token <token>`、`Accept: application/json`
  - [ ] 幂等创建：409 `pull request already exists` 时回查并返回既有 PR
  - [ ] 超时（`AbortSignal.timeout`）与网络错误映射，不吞异常
  - [ ] 本地 mock HTTP 服务测试覆盖：创建、已存在、必需检查通过/失败、401、404、超时
- 验收：
  - 正例：mock 返回 201 → `createPullRequest` 得到 `number/url`；`evaluateRequiredChecks` 对全 success 返回 `ok:true`
  - 反例：同 head 再建 → `created:false` 且不重复 POST；必需检查 `pending/failure` → `ok:false` 且 `reasons` 指出检查名；401 → `GiteaError(status=401)` 且不泄漏 token
- 证据：`node --test packages/alm-scm/test/gitea.test.mjs`、mock 请求日志断言

### ALM-05.04 技能一致性与权限校验

- 前置：ALM-05.01–05.03 ｜ 技能：`alm-mvp-dev`
- 范围：`scripts/validate-alm-skills.ps1`（或 node 脚本）、CI
- 交付物：抽取技能中的 `alm *` 命令并校验存在于 `--help`；文件/章节链接检查；权限描述与工具清单比对
- 验收：
  - 正例：技能与 CLI 同步时校验通过；CI 中执行
  - 反例：CLI 删除某命令后技能未更新 → 校验失败并指出技能与行号
- 证据：CI 运行记录、故意失配的失败样例

### ALM-05.05 产品技能：发布校验

- 类型：Task ｜ Owner：@peterzhanghao ｜ 优先级：P1 ｜ 前置：ALM-04.04（#41，已关闭）
- 技能：`alm-release-verify`（自身）、`alm-mvp-dev`（交付纪律）
- 实施范围：`packages/alm-skills/alm-release-verify/{SKILL.md,references/}`
- 不在范围：审批与合并（ALM-04.01）、插件页面（ALM-03.*）、试点演练（ALM-06.01）
- 接口：只读命令面 `alm ci status`、`alm release verify`、`alm baseline verify`、`alm contract verify`；写入命令仅 `alm ci run`（写 `.alm/ci/`）、`alm release publish|rollback`（写 `.alm/published/`），且只由人确认后执行
- 交付物：
  - [ ] 发布前链路：`contract verify` → `check --out` → `baseline create` → `release publish` → `release verify`
  - [ ] 幂等与写一次语义：重复 `ci run` 返回 `unchanged`；`release publish` 已存在且内容不同则拒绝并保留旧记录
  - [ ] 回滚语义：`release rollback --to` 先校验目标再移动 `current.json`，历史基线不被删除
  - [ ] 失败诊断表：哈希不一致、未发布、目标未通过校验、包版本不匹配
- 验收：
  - 正例：样例仓库走完 `publish → verify → rollback`，`release verify` 退出 0；同 SHA 重复 `ci run` 输出 `unchanged` 且 `ci status` 仍为 `ok`
  - 反例：篡改已发布 `bundle.tar` → `release verify` 退出 1 并列出 `bundle.tar` mismatch；`release rollback --to` 指向未发布基线 → 退出 1 且 `current.json` 不变
- 证据：`node --test packages/alm-core/test/integration/release.test.mjs`、`scripts/check-alm-skill.mjs` 通过、按技能演练的命令记录

---

## 批次 5（P2）

### ALM-06.01 三次变更演练与指标

- 类型：Task ｜ Owner：@peterzhanghao ｜ 优先级：P2 ｜ 前置：ALM-04.04（#41，已关闭）
- 技能：`alm-change-workflow`、`alm-requirements`、`alm-architecture`、`alm-release-verify`
- 实施范围：`scripts/drill.mjs`（演练编排 + 指标采集）、`scripts/ui-verify.mjs`（Playwright UI 验证）、`packages/alm-core/test/ui/*`、`tmp/drills/`（证据，不入库）
- 不在范围：CI 中执行 UI 测试（GitHub runner 无浏览器）；插件视觉改版
- 接口：`node scripts/drill.mjs --out tmp/drills` → `report.json` + `report.md`；`node scripts/ui-verify.mjs --base <url>` → 截图 + `ui/report.json`，失败退出 1
- 交付物：
  - [ ] 演练 A 正常变更：建工作区 → 新增需求/用例 → `check --base` → `diff`/`impact` → 证据
  - [ ] 演练 B 门禁失败修复：制造悬空关系 → `check` 失败（`REL-001`）→ 修复 → 通过；记录失败/修复轮次
  - [ ] 演练 C 发布链：`baseline create` → `publish` → `verify` → `rollback` → `verify`；幂等重跑
  - [ ] UI 验证（Playwright）：需求页、架构页、`/api/alm/*`；断言表格行、缺口、`check` 状态、无 console 错误；截图归档
  - [ ] 指标表：耗时（每步 ms）、人工介入次数、AI 建议采纳率、漏检/误报；无法自动采集的列标“未采集”
- 验收：
  - 正例：三次演练各产出 `report.json` 与截图；UI 断言全绿；指标表含三项耗时与退出码，缺项标“未采集”
  - 反例：故意让 UI 断言失败（删一行资产或改标题）→ `ui-verify` 退出 1 并指出缺失选择器；演练中断 → `report.json` 标记该步 `failed` 且不写“通过”
- 证据：`tmp/drills/report.md`、`tmp/drills/ui/*.png`、`node scripts/drill.mjs` 与 `node scripts/ui-verify.mjs` 输出

### ALM-06.02 架构/运行/权限/恢复文档与验证报告

- 类型：Task ｜ Owner：@peterzhanghao ｜ 优先级：P2 ｜ 前置：ALM-06.01
- 技能：`alm-mvp-dev`、`alm-release-verify`
- 实施范围：`docs/development/permissions.md`（新增）、`docs/development/upgrade.md`（新增）、`docs/planning/verification-report.md`（新增）、已有 `docs/planning/architecture.md`、`docs/usage.md`、`docs/development/recovery.md` 的交叉引用
- 不在范围：对外发布站点、Gitea 适配
- 接口：文档内命令必须与 `alm --help` 一致；验证报告逐项给“命令 / 期望 / 实际 / 退出码 / 截图或 SHA”
- 交付物：
  - [ ] 权限模型：身份、目录白名单、工具边界、审批与发布职责分离
  - [ ] 升级与兼容：契约版本、规则包版本、基线/发布存储兼容、回滚窗口
  - [ ] 验证报告：版本、环境、命令矩阵、结果、已知缺口（含 UI 验证截图与 drills 指标）
  - [ ] 新环境从零跑通的操作序列（`pnpm install` → `demo-init` → `check` → 插件页面 → `drill` → `ui-verify`）
- 验收：
  - 正例：按文档在干净目录跑通，报告中的每条命令都能复现；UI 截图与报告一致
  - 反例：文档写了不存在的命令 → `scripts/check-alm-skill.mjs` 或 `alm --help` 比对失败；报告把 `skip` 写成 `pass` → 人工评审不通过
- 证据：`docs/planning/verification-report.md`、`node scripts/check-alm-skill.mjs`、drills 与 UI 报告

---

## 任务与技能的绑定检查

发布前逐卡核对：

- [ ] 卡片写了技能名与章节，没有复制技能正文。
- [ ] 正例与反例各至少一条，且能落到命令或测试名。
- [ ] 范围含“不在范围”，并指明承接项。
- [ ] 前置在台账与 GitHub blocked-by 中一致。
- [ ] 证据可被第三人复现（固定 SHA / 环境 / 命令）。

---

## 批次 6（P1）：需求工作台

### ALM-07.01 需求工作台：空态、详情与“下一步”

- 类型：Task ｜ Owner：@peterzhanghao ｜ 优先级：P1 ｜ 前置：ALM-03.03（#29，已关闭）
- 技能：`alm-requirements`（语法与门禁修复）、`alm-change-workflow`（下一步动作）
- 实施范围：`packages/dsh-plugin-requirements/{client.js,index.js,query.mjs,render.mjs,test/}`
- 不在范围：任务生成（ALM-07.02）、看板接入（ALM-07.03）、写操作（本轮只做引导与只读详情）
- 接口：
  - `GET /api/alm/requirements?root=<dir>` 支持按请求覆盖仓库根；非法 root 返回 400
  - payload 增加 `requirements[].file/line/links[]/nextAction`，以及顶层 `state { root, change, check }`
  - 纯函数 `nextActionFor(requirement)`：`missing-acceptance` / `dangling-relation` / `ready-to-change` / `done`
  - 客户端：空态三选一、行点击打开详情、每行一个主按钮（复制可执行提示词）、顶部全局“下一步”
- 交付物：
  - [ ] 空态引导（看示例 / 新建需求提示词 / 打开文档）
  - [ ] 详情抽屉：验收、关系、源文件行号、门禁结论
  - [ ] “下一步”引擎与复制提示词
  - [ ] root 选择器（localStorage 记忆）
  - [ ] 单测：`nextActionFor`、payload 富化、root 校验
- 验收：
  - 正例：0 条需求时显示三步引导；点击 `REQ-PAY-001` 看到 `TEST-PAY-001` 与 `file:line`；缺验收的需求给出“补验收”提示词；`?root=fixtures/order-refund` 与默认一致
  - 反例：`?root=../etc` 被拒（400）；不存在的 root 返回结构化错误而不是空白；删除 `verified_by` 后该行 `nextAction=missing-acceptance`
- 证据：`node --test packages/dsh-plugin-requirements/test`、Playwright 对 eval profile 的截图

### ALM-07.02 需求→任务草案与 `TASK-001`

- 类型：Task ｜ Owner：@peterzhanghao ｜ 优先级：P1 ｜ 前置：ALM-07.01
- 技能：`alm-change-workflow`、`alm-requirements`
- 实施范围：`packages/alm-core/src/tasks/*`、`src/gates/rules/task-001.mjs`、`packages/alm-core/bin/alm.mjs`（`task draft`）、`changes/` 模板
- 不在范围：真实建 Issue（ALM-07.03）、UI 编辑器
- 接口：`alm task draft --change <CHG-ID> --from <REQ-ID...> --out <dir>` 生成 OpenSpec 兼容
  `changes/<id>/{proposal.md,tasks.md}` 与 `tasks.json`；`TASK-001` 校验变更内每条需求至少被一个任务覆盖
- 交付物：任务草案生成（五要素 + blocked-by）、`TASK-001`（block）、技能章节更新
- 验收：
  - 正例：`REQ-PAY-001` 生成 3 张卡，含范围/接口/正例/反例/证据；`alm check` 通过
  - 反例：删除其中一张卡 → `TASK-001` 失败并指出未覆盖的 `REQ-ID`；任务缺验收证据 → 规则报错
- 证据：`node --test packages/alm-core/test`、生成样例 diff

### ALM-07.03 任务看板接入（GitHub Issues / Gitea）

- 类型：Task ｜ Owner：@peterzhanghao ｜ 优先级：P1 ｜ 前置：ALM-07.02
- 技能：`ai-github-issue-workflow`、`alm-change-workflow`
- 实施范围：`scripts/sync-tasks.mjs`、`packages/alm-scm/src/{github,gitea}.mjs`（只读复用）
- 不在范围：自研看板 UI、双向实时同步
- 接口：`node scripts/sync-tasks.mjs --change <CHG-ID> [--apply]`；dry-run 输出 issue 正文；
  `--apply` 幂等建单（同 change 不重复），状态回写 `tasks.json`
- 交付物：dry-run 预览、幂等建单、状态回写、失败恢复
- 验收：
  - 正例：dry-run 生成 3 条五要素正文；`--apply` 两次只建 3 个 Issue；回写后 `tasks.json` 状态为 `open`
  - 反例：无凭据时 `--apply` 明确报错且不写状态；重复运行不产生重复 Issue
- 证据：mock server 测试、dry-run 输出

### ALM-07.04 技能正文与 CI 演练：需求→任务→看板

- 类型：Task ｜ Owner：@peterzhanghao ｜ 优先级：P2 ｜ 前置：ALM-07.02（#74，已关闭）、ALM-07.03（#75，已关闭）
- 技能：`ai-github-issue-workflow`（自身章节）、`alm-mvp-dev`（CI 纪律）
- 实施范围：`.dsh/skills/ai-github-issue-workflow/{SKILL.md,references/task-draft-sync.md}`、`scripts/task-drill.mjs`、`.github/workflows/alm-ci.yml`
- 不在范围：真实建 Issue（需凭据）、改 `sync-tasks` 的实现
- 接口：技能新增 5.1 节与参考文件；`node scripts/task-drill.mjs` 在 CI 中执行（draft → TASK-001 → dry-run → 反例）
- 交付物：
  - [ ] 技能正文记录 `alm task draft` / `sync-tasks` 的步骤、权限与失败处理
  - [ ] CI drill 脚本与 workflow 步骤
  - [ ] 台账与技能校验同步
- 验收：
  - 正例：`node scripts/task-drill.mjs` 输出 `draft=3 TASK-001=pass sync=dry-run negative=fail`，退出 0；CI 绿
  - 反例：清空一张卡的 `covers` → drill 的负例步骤必须看到 `fail TASK-001`；技能超 8 KB 或链接失效 → 校验失败
- 证据：drill 输出、CI 运行记录、`validate-skills.ps1` 与 `check-alm-skill.mjs` 通过

### ALM-07.05 样例资产：REQ-PAY-004 退款幂等

- 类型：Task ｜ Owner：@peterzhanghao ｜ 优先级：P2 ｜ 前置：ALM-02.02（#8，已关闭）
- 技能：`alm-requirements`（SDoc 与验收写法）
- 实施范围：`fixtures/order-refund/{requirements,tests,README.md}`、受影响的测试断言与截图
- 不在范围：真实退款服务实现（样例只含资产）
- 接口：新增 `REQ-PAY-004`（sdoc）与 `TEST-PAY-004/005`；关系 `allocated_to/constrained_by/verified_by`
- 交付物：
  - [ ] 幂等需求与两条验收用例进样例仓库
  - [ ] 受影响断言更新（资产数 10、需求 2 条、ADR 影响 6）
  - [ ] README 与验证截图同步
- 验收：
  - 正例：`alm check --root fixtures/order-refund` 退出 0；`alm index` 仍为 7 类资产、10 个；工作台显示 2 条需求且 `REQ-PAY-004` 的 next 为“发起变更”
  - 反例：删除 `REQ-PAY-004` 的 `verified_by` → `COV-001` 失败并定位到 `requirements/refund-idempotent.sdoc:7`
- 证据：`node --test "packages/*/test/**/*.test.mjs"`、`ui-verify` 截图

### ALM-07.06 需求插件侧边栏入口

- 类型：Task ｜ Owner：@peterzhanghao ｜ 优先级：P2 ｜ 前置：ALM-07.01（#73，已关闭）
- 技能：`alm-mvp-dev`（插件集成）
- 实施范围：`packages/dsh-plugin-requirements/{client.js,README.md}`、截图
- 不在范围：新增数据接口、写操作
- 接口：注册 `sidebar.panellist`（id `requirements`，label `需求`）与 `main`（key `requirements`）同 id；Settings 与侧边栏都渲染同一个列表
- 交付物：
  - [ ] 侧边栏「需求」图标与主面板列表
  - [ ] Settings 从引导页改为列表（空态仍保留引导）
  - [ ] README 与截图同步
- 验收：
  - 正例：点侧边栏「需求」→ 直接看到 2 条需求、Coverage、Next 与「下一步」横幅；Settings 同样显示列表
  - 反例：无需求时仍显示三步引导；接口失败显示错误与重试，不留空白
- 证据：Playwright 截图 `docs/assets/requirements-workbench/sidebar.png`、全量测试

### ALM-07.07 需求详情在旧宿主数据下点击后空白

- 类型：Bug ｜ Owner：@peterzhanghao ｜ 优先级：P1 ｜ 前置：ALM-07.06（#83，已关闭）
- 技能：`alm-mvp-dev`（插件集成与故障诊断）
- 实施范围：`packages/dsh-plugin-requirements/client.js`
- 不在范围：宿主 `query.mjs` 的字段（已由 ALM-07.01 提供）
- 接口：详情对 `links/verifiedBy/line` 使用防御默认值；检测到旧 payload 时显示提示，不卸载面板
- 交付物：
  - [ ] 旧 payload（无 `links`）下详情仍渲染并提示“重启 DSH / 重载插件”
  - [ ] 新 payload 下关系、行号、下一步保持不变
- 验收：
  - 正例：新宿主点击 `REQ-PAY-004` → 详情含三条关系与 `requirements/refund-idempotent.sdoc:7`
  - 反例：Playwright 截获无 `links` 的旧 payload → 详情渲染、无 pageerror、显示旧版数据提示
- 证据：两条 Playwright 输出、全量测试 152

### ALM-07.08 需求工作台视觉原型（Tesla / Apple 风格）

- 类型：Task ｜ Owner：@peterzhanghao ｜ 优先级：P2 ｜ 前置：ALM-07.06（#83，已关闭）
- 技能：`alm-mvp-dev`（插件集成）
- 实施范围：`docs/design/requirements-workbench-prototype.html`、`docs/assets/design/{list,detail,tasks}.png`
- 不在范围：改动插件源码（评审通过后另开实现卡）
- 接口：静态 HTML + 可交互原型（筛选、搜索、详情抽屉、任务预览弹窗），数据取自 `fixtures/order-refund`
- 交付物：
  - [ ] 列表态：卡片、状态 pill、验收进度、单一主行动
  - [ ] 详情态：右侧抽屉、验收清单、AI 补充验收、技术详情折叠
  - [ ] 任务预览态：3 张任务卡预览与确认/取消
  - [ ] 文案去技术化：隐藏 repo/file:line/命令，状态与团队用人类语言
- 验收：
  - 正例：非技术用户能在 3 秒内说出“这条做到哪、还缺什么、下一步做什么”；点卡片出抽屉、点开始开发出预览
  - 反例：技术字段默认不可见；取消所有弹层后回到列表，不留副作用
- 证据：三张截图与 HTML；评审通过后再开实现 PR

### ALM-07.09 需求富内容与版本模型（M1）

- 类型：Task ｜ Owner：@peterzhanghao ｜ 优先级：P1 ｜ 前置：ALM-07.05（#81，已关闭）
- 技能：`alm-requirements`、`alm-mvp-dev`
- 实施范围：`packages/alm-core/{src/model,src/parse,src/gates,src/contracts}`、`fixtures/order-refund`、`dsh-plugin-requirements/{query,render}`
- 不在范围：编辑器 UI、执行验收、看板同步（M3/M4）
- 接口：SDoc 新增 `REVISION/PRIORITY/CATEGORY/BRIEF/SOURCE`；`STATUS` 支持中文别名；新增关系 `parent_of`；新增门禁 `REL-003/REV-001/BRIEF-001/ATT-001`；状态扩展为 7 个（界面中文标签）
- 交付物：
  - [ ] 解析与模型：富字段、中文状态别名、`parent_of`
  - [ ] 门禁：层级环、版本递增、brief、附件哈希
  - [ ] 样例：`REQ-PAY-004` 带 brief、聊天附件与 manifest，`REQ-PAY-001 parent_of REQ-PAY-004`
  - [ ] 插件 payload 带 `statusLabel/revision/priority/brief/sources/attachments`
- 验收：
  - 正例：`alm check --root fixtures/order-refund` 退出 0；`ATT-001`/`BRIEF-001`/`REL-003` pass；`REV-001` 无 base 时 skip
  - 反例：篡改附件哈希 → `ATT-001` fail；内容改动未升 `REVISION` → `REV-001` fail；父子成环 → `REL-003` fail
- 证据：新增 7 个单测，全量 159/159；`alm contract verify` ok

### ALM-07.10 原始材料入库：聊天 Markdown 与本地 OCR 适配

- 类型：Task ｜ Owner：@peterzhanghao ｜ 优先级：P1 ｜ 前置：ALM-07.09（#89，已关闭）
- 技能：`alm-requirements`、`alm-mvp-dev`
- 实施范围：`packages/alm-core/src/intake/{chat,ocr}.mjs`、单测
- 不在范围：入库向导 UI、AI 字段抽取（M3 后续）
- 接口：`parseChatMarkdown` / `normalizeChatMarkdown`（行号引用）；`runOcr` / `normalizeOcrResult`（`alm.ocr/v1`，行置信度 + `#L` 引用），运行时自动发现 `dsh-ocr-local` 与 `~/.dsh-ocr` 引擎
- 交付物：
  - [ ] 聊天 Markdown 四种格式解析，保留 `line` 用于引用
  - [ ] OCR 适配器：JSON 解析、字段归一、`ref: image#L3`、失败诊断
  - [ ] 引擎选择与验证：`dsh-ocr-local` 0.5.1（PP-OCRv5 + ONNX，离线）
- 验收：
  - 正例：`parseChatMarkdown` 解析 10:12/header/bracket/无时间四种形态；`runOcr` 归一化行与引用；全量 165/165
  - 反例：缺图/缺脚本/OCR 非零退出给出明确错误，不返回空文本
- 证据：`ocr_test`（真实引擎 5 秒识别 28 行，doctor 全绿）、单测 6 个

### ALM-07.11 多项目归属：需求 / 看板 / 开发

- 类型：Task ｜ Owner：@peterzhanghao ｜ 优先级：P1 ｜ 前置：ALM-07.10（#91，已关闭）
- 技能：`alm-requirements`、`ai-github-issue-workflow`、`alm-mvp-dev`
- 实施范围：项目模型（`.alm/project.json` + 用户级 registry）、插件项目切换、`sync-tasks` 的 repo/board 解析、变更与 PR 归属
- 不在范围：跨仓库迁移工具、组织级 ProjectV2 汇总（后续）
- 接口：`alm project init/show/verify`；需求的 `PROJECT`（可省略，默认取仓库）；跨项目引用用 `PAY:REQ-…` 复合 ID；`sync-tasks` 从项目配置推导 GitHub repo + 看板
- 交付物：
  - [ ] 项目模型与 registry：`id / name / root / github.repo / project.number / labels`
  - [ ] 工作台项目切换器与「全部项目」聚合视图；新建需求默认归属当前项目
  - [ ] GitHub：需求 Issue（可选）+ 任务 Issue 归属同一 repo 与 ProjectV2 看板
  - [ ] 开发归属：change/分支/PR/上下文包带项目 ID，看板 Status 随 PR 流转
- 验收：
  - 正例：两个项目各自的需求列表互不串；任务建单落在对应 repo 与看板；PR 自动关联需求 Issue
  - 反例：项目 ID 冲突 / repo 与 `.alm/project.json` 不一致 / 需求引用了未注册项目 → 门禁失败
- 证据：项目切换与建单归属的原型/接口设计

### ALM-07.12 项目模型与 CLI（一仓库一项目）

- 类型：Task ｜ Owner：@peterzhanghao ｜ 优先级：P1 ｜ 前置：ALM-07.11（#93，已关闭）
- 技能：`alm-mvp-dev`
- 实施范围：`alm-core/src/project/project.mjs`、`alm project` 命令、SDoc `PROJECT`、门禁 `PRJ-001`、样例项目文件
- 不在范围：GitHub 需求 Issue/看板（ALM-07.13）、插件项目切换 UI
- 接口：`.alm/project.json`（id/name/github.repo/project.number）；`alm project init/show/verify/list`；需求 `PROJECT` 字段；`PRJ-001`
- 交付物：
  - [ ] 项目文件读写与校验（ID 规则、repo 与 `git remote` 一致、需求根存在）
  - [ ] DSH registry（`~/.dsh/alm/projects.json`，`DSH_ALM_REGISTRY` 可覆盖）与重复 ID 检测
  - [ ] 需求 `PROJECT` 解析与不一致门禁
- 验收：
  - 正例：`project init/show/verify` 通过；registry 列出两个项目；样例 `PRJ-001` pass
  - 反例：remote 与 `github.repo` 不一致、重复项目 ID、需求项目不一致 → 失败
- 证据：新增 6 个单测，全量 171/171

### ALM-07.13 GitHub 归属：需求 Issue、任务子议题与 ProjectV2

- 类型：Task ｜ Owner：@peterzhanghao ｜ 优先级：P1 ｜ 前置：ALM-07.12（#95，已关闭）
- 技能：`ai-github-issue-workflow`、`alm-mvp-dev`
- 实施范围：`alm-core/src/github/{provider,mapping,sync-requirements}.mjs`、`src/tasks/sync.mjs`、`scripts/sync-tasks.mjs`
- 不在范围：PR 模板与看板 Status 自动流转（ALM-07.14）
- 接口：需求先建 Issue（`[REQ-ID] 标题`，label `type::requirement` + `project::<id>` + `priority::P*`）→ `gh project item-add` 进项目看板 → 任务 Issue 以需求 Issue 为 parent；映射写 `.alm/github.json`
- 交付物：
  - [ ] 需求 Issue 自动创建/按标题 adopt，dry-run 只输出正文
  - [ ] 项目配置驱动 repo 与 ProjectV2（`.alm/project.json`）
  - [ ] 任务 Issue 带 parent，回写 `.alm/github.json` 与 `tasks.json`
  - [ ] 重复执行幂等
- 验收：
  - 正例：先需求后任务；`addToProject` 调用；第二次全部 skip；dry-run 不落任何文件
  - 反例：无项目配置时 apply 拒绝；需求标题相同则 adopt 不重复
- 证据：5 个单测，全量 176/176

### ALM-07.14 PR 归属与看板状态

- 类型：Task ｜ Owner：@peterzhanghao ｜ 优先级：P1 ｜ 前置：ALM-07.13（#97，已关闭）
- 技能：`ai-github-pr-workflow`、`alm-mvp-dev`
- 实施范围：`tasks/draft.mjs`、`github/{provider,sync-requirements}.mjs`、`tasks/sync.mjs`、PR 模板
- 不在范围：DSH 插件项目切换器（ALM-07.15）
- 接口：任务草案带 `project`；需求/任务 Issue 创建后按项目配置 `github.project.status.ready` 设置看板 Status；PR 模板增加 Project/Requirement/Change/Board 段
- 交付物：
  - [ ] `changes/<CHG>/tasks.json` 与 proposal 记录项目 ID
  - [ ] 建单后 `gh project item-edit` 将 Status 置为 Ready（失败不阻断建单）
  - [ ] PR 模板要求填写项目、需求 Issue、变更号、看板状态
- 验收：
  - 正例：apply 后需求与 3 张任务各一次 `setStatus Ready`；tasks.json 含 `project: PAY`
  - 反例：看板状态失败只记录不丢单；缺项目配置仍拒绝 apply
- 证据：单测更新，全量 176/176

### ALM-07.15 需求工作台项目切换器

- 类型：Task ｜ Owner：@peterzhanghao ｜ 优先级：P1 ｜ 前置：ALM-07.14（#99，已关闭）
- 技能：`alm-mvp-dev`、`cordis-plugin-development`
- 实施范围：`dsh-plugin-requirements/{index.js,query.mjs,client.js}`、HTTP/query 测试
- 不在范围：项目内需求编辑、跨项目聚合视图
- 接口：`GET /api/alm/projects`（registry + 当前仓库项目）；`?project=<ID>` 解析到项目根；payload 增加 `project/projectName`；工作台顶部项目下拉
- 交付物：
  - [ ] 项目 API 与未知项目 404
  - [ ] 下拉切换项目根、持久化到 localStorage
  - [ ] 当前项目名进入摘要行
- 验收：
  - 正例：eval 实测下拉含「支付平台（PAY）」，切换后按项目根加载；177/177
  - 反例：无 registry 时仍显示当前仓库项目；未知 `?project=` 返回 404
- 证据：截图 `docs/assets/design/project-picker.png`、单测

### ALM-07.16 原型补充：项目切换与 GitHub 归属

- 类型：Task ｜ Owner：@peterzhanghao ｜ 优先级：P2 ｜ 前置：ALM-07.15（#102，已关闭）
- 技能：`alm-mvp-dev`、`frontend-design`
- 实施范围：`docs/design/requirements-workbench-prototype.html`、`docs/assets/design/{projects,projects-all,github-attribution,detail-github,start-github,github-create,new-github}.png`
- 不在范围：插件代码改动、真实 GitHub 建单（ALM-07.13/07.14 已实现）
- 接口：原型对齐 `.alm/project.json`、需求 `PROJECT`、`.alm/github.json`、ProjectV2 Status、PR 归属
- 交付物：
  - [ ] 顶部项目切换器（支付平台 PAY / 客户 CRM / 全部项目），切换后按项目根加载并持久化
  - [ ] 全部项目聚合视图：按项目分组、项目徽标、仓库与「GitHub 已归属」统计
  - [ ] 需求抽屉与详情新增 GitHub 归属：仓库、需求 Issue、标签、ProjectV2 看板、任务子议题、PR
  - [ ] 未建单需求一键「创建需求 Issue 并加入看板」；开始开发弹窗与新建向导展示将创建的 Issue/看板
  - [ ] 新增 CRM 样例需求，验证项目隔离与跨项目聚合
- 验收：
  - 正例：切换项目后列表互不串；REQ-PAY-004 显示 #104 / ProjectV2 #1 / Ready / #105–#107；CRM 显示 #12 / In progress / PR #15
  - 反例：无 Issue 的需求显示建单入口；未知项目不参与聚合
- 证据：Playwright 12 项断言通过、0 pageerror；截图 7 张

### ALM-08.01 插件工作台 v2：列表 / 筛选 / 项目聚合 / 抽屉 / 详情 / GitHub 归属

- 类型：Task ｜ Owner：@peterzhanghao ｜ 优先级：P1 ｜ 前置：ALM-07.16（#104，已关闭）
- 技能：`alm-mvp-dev`、`cordis-plugin-development`
- 实施范围：`packages/dsh-plugin-requirements/{query.mjs,index.js,client.js,test}`、`docs/planning/requirements-plugin-ui-plan.md`
- 不在范围：评审报告、版本对比、追溯视图、开始开发/验收/新建向导（ALM-08.02–08.04）
- 接口：`requirements()` 增加 `project/projectName/briefText/attachmentFiles/github/projectInfo`；新增 `requirementsAll(projects)` 与 `GET /api/alm/requirements?project=ALL`；`item.github = { provider, repo, issue, url, labels, board, tasks }`
- 交付物：
  - [ ] 卡片列表（状态色、ID、修订、优先级、验收数、附件/来源、GitHub Issue 徽标、看板状态）替代旧表格
  - [ ] 状态筛选与搜索；项目选择（含「全部项目」聚合视图，按项目分组）
  - [ ] 右侧抽屉：背景（brief markdown）、来源、附件、验收覆盖、关系、GitHub 归属、历史占位、技术详情与提示词
  - [ ] 详情弹层：主栏背景/验收/关系，侧栏项目/GitHub/评审占位/技术
  - [ ] 保留仓库根切换、刷新、追踪缺口与应用内提示词复制
- 验收：
  - 正例：PAY 列表仅 2 条；全部项目显示 PAY/CRM 两组与各自需求；`REQ-PAY-004` 抽屉显示 `#104`、`ProjectV2 #1`、`#105–#107 (parent #104)` 与标签；详情页可打开
  - 反例：无 `.alm/github.json` 时显示「尚未建立 GitHub 归属」；坏项目根在聚合视图按项目报错且不影响其他项目
- 证据：新增 5 个单测（全量 182/182）；eval 宿主实测 6 项断言通过、0 pageerror；截图 `docs/assets/design/plugin-{list,projects,drawer,github,detail}.png`

### ALM-08.02 评审与版本视图

- 类型：Task ｜ Owner：@peterzhanghao ｜ 优先级：P1 ｜ 前置：ALM-08.01（#106，已关闭）
- 技能：`alm-mvp-dev`、`cordis-plugin-development`
- 实施范围：`packages/dsh-plugin-requirements/{query.mjs,index.js,client.js,test}`
- 不在范围：人工签收写接口与 AI 评审执行器（ALM-08.04 起）、追溯图（ALM-08.03）
- 接口：
  - `item.review`：`alm.review/v1`，五角色（业务/架构/测试/安全/交付）映射门禁规则，含 `verdict`、`findings`、`summary`，`signoff: null`
  - `item.versions`：`git log --follow` 的提交列表（sha/short/date/subject）
  - `GET /api/alm/requirements/version?root&asset&sha`：`alm.version/v1` 只读快照
- 交付物：
  - [ ] 抽屉与详情新增「评审」：5 角色结论、阻塞统计、findings（规则、严重度、file:line）
  - [ ] 「历史」改为 git 版本列表，点击打开只读快照弹层
  - [ ] 版本快照接口与坏 sha / 未知资产错误处理
  - [ ] 单测覆盖评审阻塞推导、版本历史、快照与 HTTP 路由
- 验收：
  - 正例：fixture 需求显示 5/5 角色通过、0 阻塞；点击版本行打开快照，内容含 `REQ-PAY-004`；详情页侧栏同时显示评审与版本历史
  - 反例：删掉 `verified_by` 后测试角色变 `block` 且 blockers=1；非法 sha 返回 400 `invalid-sha`，未知资产返回 404 `asset-not-found`
- 证据：新增 4 个单测（全量 186/186）；eval 宿主 4 项断言通过、0 pageerror；截图 `docs/assets/design/plugin-{review,snapshot,detail-review}.png`

### ALM-08.03 追溯图形视图与影响面

- 类型：Task ｜ Owner：@peterzhanghao ｜ 优先级：P1 ｜ 前置：ALM-08.02（#108，已关闭）
- 技能：`alm-mvp-dev`、`cordis-plugin-development`
- 实施范围：`packages/dsh-plugin-requirements/{query.mjs,client.js,test}`
- 不在范围：跨项目合成 ID、图形编辑写操作（ALM-08.04）
- 接口：
  - `item.trace`（`alm.trace/v1`）：`nodes`（当前 + 直接出边目标 + 直接入边来源，含 type/title/status/current）、`edges`、`cycles`、`stats`（上级/子需求/验收/依赖/约束/受影响资产）
  - 构图与影响面复用 `buildGraph` / `walk` / `findCycles`，与 `alm impact` 同口径
- 交付物：
  - [ ] 抽屉/详情「关系」增加「查看追溯图」入口
  - [ ] SVG 三层布局（来源/当前/目标）、可点击节点、边标签沿曲线错位
  - [ ] 点击需求节点切换当前需求；其他资产显示 id/类型/标题；悬空目标显示缺失提示
  - [ ] 影响面统计与关系环提示
- 验收：
  - 正例：`REQ-PAY-004` 显示 6 节点 5 边、`parent_of`、`验收 2`、`受影响资产 1`；点击 `REQ-PAY-001` 节点后抽屉切换成功
  - 反例：关系指向不存在的 `MOD-NOPE` 时图中出现 `missing` 节点且 title=null
- 证据：新增 2 个单测（全量 188/188）；eval 宿主 3 项断言通过、0 pageerror；截图 `docs/assets/design/plugin-{trace,trace-nav}.png`

### ALM-08.04 写操作：开始开发 / 运行门禁验收 / 新建需求

- 类型：Task ｜ Owner：@peterzhanghao ｜ 优先级：P1 ｜ 前置：ALM-08.03（#110，已关闭）
- 技能：`alm-mvp-dev`、`ai-github-issue-workflow`、`cordis-plugin-development`
- 实施范围：`packages/alm-core/src/{changes/open.mjs,requirements/create.mjs}`、`packages/dsh-plugin-requirements/{index.js,client.js,test}`
- 不在范围：切换 git 分支/createWorkspace、任意命令执行、GitHub Issue 自动创建（仍走 `scripts/sync-tasks.mjs`）
- 接口（均为本地 POST，默认 dry-run，`apply:true` 才落盘）：
  - `POST /api/alm/requirements/start` → `alm.change.plan/v1`：`CHG-<PROJECT>-NNN`、branch、baseline、plannedFiles、taskCount；apply 后写变更记录 + 3 张任务卡
  - `POST /api/alm/requirements/accept` → `alm.ci.run/v1`：固定 `alm ci run`，证据写 `.alm/ci/<sha>/<pack>.json`
  - `POST /api/alm/requirements/create` → `alm.requirement.plan/v1`：`REQ-<PROJECT>-NNN`、sdoc 与 brief 内容；apply 后写两个文件并返回门禁结果
- 交付物：
  - [ ] `changes/open.mjs`：变更 id 推导、预演、写变更记录 + `draftTasks`，失败删半成品、不动当前分支
  - [ ] `requirements/create.mjs`：id 推导、sdoc/brief 生成、owner 回落项目 teams[0]、重复/项目不匹配校验
  - [ ] 插件写接口（bounded JSON body、405/400/409 错误映射）
  - [ ] UI：抽屉/详情「开始开发」「运行门禁验收」、顶部「＋ 新建」向导，均先预演再确认
  - [ ] 单测：变更预演/落盘/重复；需求预演/落盘/校验；HTTP 预演与错误
- 验收：
  - 正例：开始开发生成 `CHG-PAY-001` + `TASK-PAY-001..003` 且不切分支；验收返回 `pass/created` 与证据路径；新建生成 `REQ-PAY-005`（`OWNER: 支付团队`）+ brief，门禁 `fail + 1 个覆盖缺口`
  - 反例：重复变更 409；未知需求 404；非 POST 405；非 git 根验收 400 且不落半成品
- 证据：新增 9 个单测（全量 197/197）；eval 宿主 6 项断言通过、0 pageerror；截图 `docs/assets/design/plugin-{start,start-done,accept,create,create-done}.png`

### ALM-09.01 工作区项目空间 + 新建按钮修复 + UI 全流程回归

- 类型：Task ｜ Owner：@peterzhanghao ｜ 优先级：P1 ｜ 前置：ALM-08.04（#112，已关闭）
- 技能：`alm-mvp-dev`、`cordis-plugin-development`
- 实施范围：`packages/dsh-plugin-requirements/{workspaces.mjs,index.js,client.js,test}`、`packages/alm-core/src/project/project.mjs`
- 不在范围：GitHub 建单（ALM-09.02）、验收证据（ALM-09.03）、评审/版本/分支/入库（ALM-09.04–09.07）
- 接口：
  - `GET /api/alm/projects` 改为 DSH 工作区来源（`~/.dsh/storages/workspace.json`，`DSH_WORKSPACES_FILE` 覆盖），剔除默认工作区，未关联工作区 `linked=false`
  - `POST /api/alm/projects/associate?root=<workspace>`：写/更新 `.alm/project.json`、创建 `requirements/`、返回 git remote 一致性
  - `?project=ALL` 改为聚合工作区（跳过路径缺失者）
- 交付物：
  - [ ] `workspaces.mjs` + 单测（默认工作区剔除、关联/未关联、缺失路径、文件覆盖）
  - [ ] `associateProject` + 单测（创建/更新、remote 匹配）
  - [ ] 服务端路由改造 + HTTP 测试（工作区列表、关联、聚合）
  - [ ] 客户端工作区选择、未关联标记、关联/更新关联弹窗、未关联时新建先引导关联
  - [ ] primary 按钮改为 label/base 反色对，修复单色深色主题白底白字
- 验收：
  - 正例：picker 列出 `DSH`、`演示工作区 · 未关联仓库`，不含 `default-workspace`；关联后写 `.alm/project.json` 且列表可用；全流程（关联→列表→抽屉→评审→版本→追溯→开始→验收→新建）14 项断言通过
  - 反例：默认工作区不出现；路径缺失工作区标记 `exists=false` 且不可选；未关联工作区点新建先进入关联弹窗
- 证据：全量 202/202；Playwright 14/14、0 pageerror；按钮对比度（模拟单色深色主题）17.7:1、旧方案 1:1；截图 `docs/assets/design/plugin-{associate,workspace-linked,traces-demo,create-demo,dark-button}.png`

### ALM-09.02 GitHub Issue 自动创建进插件

- 类型：Task ｜ Owner：@peterzhanghao ｜ 优先级：P1 ｜ 前置：ALM-09.01（#114，已关闭）
- 技能：`ai-github-issue-workflow`、`alm-mvp-dev`
- 实施范围：`packages/dsh-plugin-requirements/{github-sync.mjs,index.js,client.js,test}`
- 不在范围：看板字段自定义、PR 状态联动（现有 PR 模板承担）、跨仓库建单
- 接口：
  - `POST /api/alm/requirements/github?root=` body `{changeId, apply?}`：默认 `alm.github.plan/v1`（需求 Issue + 任务子议题标题/正文/标签，0 网络）；`apply:true` 调 `gh` 创建并写 `.alm/github.json`，返回 `alm.github.sync/v1`
  - 未关联项目 409 `no-project`；无任务草稿 404 `no-draft`
- 交付物：
  - [ ] `github-sync.mjs`（preview/apply、上下文校验、任务失败信息）
  - [ ] 插件路由 + lifecycle 路由表
  - [ ] 开始开发弹窗「GitHub 归属」：仓库/看板、预览、创建、结果动作（创建/复用/跳过）
  - [ ] 单测：preview 不写文件；fake provider apply 幂等；未关联/无草稿错误；HTTP preview
- 验收：
  - 正例：预览显示 `[REQ-DEMO-004]` + 3 个任务标题且不写 `.alm/github.json`；fake provider apply 创建 4 个 Issue、4 次看板/状态，第二次全部 skip；HTTP preview 返回 200
  - 反例：未关联工作区 409；无任务草稿 404；不点「创建」不会触网
- 证据：全量 206/206；Playwright 全流程 15/15（含 GitHub 预览）、0 pageerror；真实创建未在 eval 执行（避免污染仓库），apply 路径由 fake provider 单测覆盖；截图 `docs/assets/design/plugin-github-preview.png`

### ALM-09.03 需求级验收证据契约

- 类型：Task ｜ Owner：@peterzhanghao ｜ 优先级：P1 ｜ 前置：ALM-09.02（#116，已关闭）
- 技能：`alm-mvp-dev`、`cordis-plugin-development`
- 实施范围：`packages/alm-core/src/acceptance/acceptance.mjs`、`packages/dsh-plugin-requirements/{query.mjs,index.js,client.js,test}`
- 不在范围：需求级人工签收（ALM-09.05）、任意命令执行、远程执行器
- 接口：
  - `.alm/acceptance/<REQ>.json`（`alm.acceptance.config/v1`）：`commands[{id, command[], timeoutMs?}]`，白名单 `node/npm/pnpm`，无 shell
  - `.alm/acceptance/<REQ>/<sha>.json`（`alm.acceptance/v1`）：整体结果 + 逐条退出码/耗时/输出尾部
  - `POST /api/alm/requirements/acceptance`：plan 默认不执行不写，`apply:true` 执行并归档
  - payload `item.acceptance` 摘要：registered/commandCount/latest(result,current)
- 交付物：
  - [ ] `acceptance.mjs`：配置校验、plan、run、证据读写、摘要
  - [ ] 端点 + query payload + lifecycle/HTTP/query 测试
  - [ ] 抽屉/详情「验收执行」区块与运行弹层（逐条 exit code、输出、证据路径）
  - [ ] 与「运行门禁检查」（`alm ci run`）文案区分
- 验收：
  - 正例：plan 不写证据；apply 后 `pass` 证据落 `<sha>.json`，摘要 `current=true`；eval 运行 2 条 node 命令均 exit 0
  - 反例：非白名单二进制 `binary-not-allowed`；未登记 `no-config` 404；非 git 根 `not-a-git-repo`
- 证据：全量 212/212；Playwright 全流程 17/17（含验收执行）、0 pageerror；截图 `docs/assets/design/plugin-acceptance.png`

### ALM-09.04 版本 diff 对比

- 类型：Task ｜ Owner：@peterzhanghao ｜ 优先级：P1 ｜ 前置：ALM-09.03（#118，已关闭）
- 技能：`alm-mvp-dev`
- 实施范围：`packages/dsh-plugin-requirements/{version-diff.mjs,index.js,client.js,test}`
- 不在范围：门禁影响重算、跨文件 diff、写操作（diff 只读）
- 接口：
  - `diffRequirementVersions({root, file, assetId, from, to='worktree'})` → `alm.version.diff/v1`：`fields[{field,from,to}]`、`relations{added,removed}`、`summary`、`mode`
  - `GET /api/alm/requirements/diff?root&asset&from&to`；非法 ref 400，未知提交/资产 404
- 交付物：
  - [ ] `version-diff.mjs`：git 读取两版 sdoc、解析字段/关系、字段级 diff
  - [ ] 端点 + 单测（两版提交、worktree、坏 ref、未知资产）+ HTTP 测试
  - [ ] 版本行「对比当前」与 diff 弹层（字段旧值→新值、关系增删、summary）
- 验收：
  - 正例：两版提交 TITLE/STATUS/PRIORITY 变化可检出；`to=worktree` 默认；关系增删正确
  - 反例：`not-a-ref` → `invalid-ref`；未知资产 → 404 `asset-not-found`
- 证据：全量 216/216；Playwright 全流程 19/19、0 pageerror；截图 `docs/assets/design/plugin-diff.png`
