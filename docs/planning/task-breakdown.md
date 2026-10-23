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
- 不在范围：门禁规则（ALM-02.03）、渲染（REN-001 后续）
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
  - [ ] 负例夹具：重复 ID、悬空关系、缺验收、非法状态、秘密串
- 验收：
  - 正例：`alm index` 列出 7 类资产且全部关系可解析；`alm trace REQ-PAY-001` 输出需求→模块→决策→验收链
  - 反例：每个负例夹具在对应规则下失败并定位到资产 ID；正例仓库不被负例污染
- 证据：`alm index --json` 计数、`alm trace` 输出、负例清单

### ALM-02.03 硬门禁规则集 R1

- 类型：Task ｜ Owner：@peterzhanghao ｜ 优先级：P0 ｜ 前置：ALM-02.02、ALM-01.03
- 技能：`alm-change-workflow`（门禁判定与修复）、`alm-mvp-dev`（新增规则流程）
- 实施范围：`packages/alm-core/src/gates/*`、`packages/alm-core/src/gates/pack.json`
- 不在范围：基线/审批/发布类规则（R2，见 ALM-02.05/04.*）
- 接口：规则 `{id, level, check(ctx)}`；证据 `checks[]`；规则包 `version`
- 交付物：
  - [ ] `FMT-001/002`、`ID-001/002`、`REL-001/002`、`COV-001`、`COV-002`(warn)、`STATE-001`、`SEC-001`、`REN-001`
  - [ ] 规则包版本与证据记录
  - [ ] 每条规则至少一个反例测试
- 验收：
  - 正例：样例仓库 `alm check` 退出 0，`checks` 覆盖全部规则
  - 反例：5 类负例分别只触发预期规则，退出 1，输出资产 ID + 文件 + 行号
- 证据：`node --test packages/alm-core/test/{unit,integration}`、`alm check --json` 五次输出

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

### ALM-05.04 技能一致性与权限校验

- 前置：ALM-05.01–05.03 ｜ 技能：`alm-mvp-dev`
- 范围：`scripts/validate-alm-skills.ps1`（或 node 脚本）、CI
- 交付物：抽取技能中的 `alm *` 命令并校验存在于 `--help`；文件/章节链接检查；权限描述与工具清单比对
- 验收：
  - 正例：技能与 CLI 同步时校验通过；CI 中执行
  - 反例：CLI 删除某命令后技能未更新 → 校验失败并指出技能与行号
- 证据：CI 运行记录、故意失配的失败样例

---

## 批次 5（P2，暂缓）

### ALM-06.01 三次变更演练与指标

- 前置：ALM-04.04 ｜ 技能：产品技能全集
- 内容：正常变更、门禁失败修复、发布回滚/重建；采集耗时、人工介入、AI 建议采纳率、漏检/误报
- 验收：正例：三次演练均有证据与结论；反例：指标口径缺失的项标注“未采集”，不估算

### ALM-06.02 架构/运行/权限/恢复文档与验证报告

- 前置：ALM-06.01 ｜ 技能：`alm-mvp-dev`
- 内容：运行说明、权限模型、升级与兼容、备份恢复、验证报告（版本/命令/结果/缺口）
- 验收：正例：新环境按文档从零跑通；反例：文档命令与 CLI 不一致时校验脚本失败

---

## 任务与技能的绑定检查

发布前逐卡核对：

- [ ] 卡片写了技能名与章节，没有复制技能正文。
- [ ] 正例与反例各至少一条，且能落到命令或测试名。
- [ ] 范围含“不在范围”，并指明承接项。
- [ ] 前置在台账与 GitHub blocked-by 中一致。
- [ ] 证据可被第三人复现（固定 SHA / 环境 / 命令）。
