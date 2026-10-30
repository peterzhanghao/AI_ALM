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
