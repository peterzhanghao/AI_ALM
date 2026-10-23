---
name: alm-mvp-dev
description: "在 AI_ALM 仓库开发 AI Native ALM MVP 的执行技能：仓库布局、alm 命令面、五类契约、门禁规则、测试与交付纪律。用户要改 alm-core、解析器、门禁、插件或样例资产时使用。"
whenToUse: "在 AI_ALM 仓库实现或修改 ALM MVP（alm-core、门禁规则、DSH 插件、样例资产、证据与基线）时；或需要确认命令、契约版本、测试与 PR 交付要求时。"
metadata:
  version: "0.1.0"
  owner: "peterzhanghao"
  repo: "peterzhanghao/AI_ALM"
  updated: "2026-10-23"
---

# AI_ALM 开发技能（ALM MVP）

## 0. 用途与边界

- 本技能面向**在本仓库写代码的 Agent**：给出目录、命令、契约、门禁、测试与交付纪律。
- 不负责拆分 Issue（用 `ai-github-issue-workflow`）与 PR 收口（用 `ai-github-pr-workflow`）。
- 领域需求与边界以 `docs/planning/architecture.md` 与 `docs/product/ai-native-alm-mvp.md` 为准；两者与代码冲突时先改文档再改代码。

## 1. 仓库布局

| 路径 | 内容 |
|---|---|
| `packages/alm-core/` | 领域逻辑与 CLI：`bin/alm.mjs`、`src/{contracts,parse,model,index,gates,diff,baseline,evidence,workspace}` |
| `packages/alm-scm/` | SCM/CI 适配器（local-git 先行，Gitea/GitHub 后置） |
| `packages/dsh-plugin-alm-core/` | Host Service `almCore` + Agent 工具（当前为 ALM-01.02 spike） |
| `packages/dsh-plugin-requirements/`、`packages/dsh-plugin-architecture/` | 两个业务插件（ALM-03） |
| `packages/alm-skills/` | 产品技能源，安装到目标工作区 `.dsh/skills/` |
| `fixtures/order-refund/` | 部分退款正例资产 |
| `fixtures/negative/`、`fixtures/smoke/` | 负例与最小夹具 |
| `scripts/demo-init.ps1` | 从 fixtures 生成 `tmp/demo-order-refund` 并 `git init` |
| `.dsh/skills/` | 本仓技能根（只扫描一层） |

约束：`alm-core` 不依赖 DSH、不联网；插件只做适配，不复制领域规则；样例仓库通过 `tmp/` 生成，不污染工作区。

## 2. 命令面

完整清单、参数与退出码见 [`references/commands.md`](references/commands.md)。当前**已实现**：

```text
alm --help / --version
alm contract verify [--json]
```

计划中的 `check/index/show/query/diff/impact/trace/baseline/evidence/approval/workspace` 随各卡落地；未实现前不得在任务验收里当作可用命令。

退出码固定：`0` 通过、`1` 门禁失败、`2` 用法错误、`3` 内部错误。CI 与 Agent 一律按退出码判定，人类输出不作证据。

## 3. 契约

五类契约在 `packages/alm-core/src/contracts/`，`$id` 必须与下表一致：

| 文件 | `$id` | 用途 |
|---|---|---|
| `asset.schema.json` | `alm.asset/v1` | 资产归一化模型（7 类资产、6 类关系） |
| `evidence.schema.json` | `alm.evidence/v1` | 一次门禁运行的证据 |
| `approval.schema.json` | `alm.approval/v1` | 绑定 `headSha` 的人工审批 |
| `baseline.schema.json` | `alm.baseline/v1` | 不可变基线清单 |
| `finding.schema.json` | `alm.finding/v1` | AI 建议，advisory，不改变退出码 |

改契约的流程：改 schema → 升版本 → 更新 `docs/planning/architecture.md` 第 4/9 节 → 更新调用方与测试 → `alm contract verify`。禁止只改实现不改契约。

## 4. 门禁

规则表、级别与反例见 [`references/gates.md`](references/gates.md)。要点：

- R1（ALM-02.03）：`FMT/ID/REL/COV/STATE/SEC/REN`，其中 `REN-001` 是结构检查（block）。
- `REN-002`：StrictDoc 渲染证据，`warn` 非阻断；固定 `strictdoc==0.30.4`，缺工具/产物记 `skip`，版本或哈希不符记 `fail(warn)`，**不改变退出码**。
- R2（ALM-02.05、ALM-04.*）：`BASE-001`、`APPROVAL-001/002`、`PUB-001`。
- 每条规则必须有正例与反例测试；新增规则要升 `pack.json` 版本并写进证据。
- AI 语义审查只产出 `alm.finding/v1`，不得写入 `result`。

## 5. 测试与命令

```powershell
pnpm test                                  # node --test 全部包
node packages/alm-core/bin/alm.mjs --help
node packages/alm-core/bin/alm.mjs contract verify
node scripts/check-alm-skill.mjs           # 技能命令与 CLI 一致性
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/validate-skills.ps1
```

新增测试放 `packages/alm-core/test/{unit,integration}`；端到端放 `test/e2e`。测试用临时目录，不写仓库内固定路径。Node 版本要求 ≥ 22；本机 Host 运行时为 Node 24。

## 6. 交付纪律

1. 一卡一分支一 PR：`feature/alm-<xx-yy>-<slug>`，目标 `develop`，PR 描述引用 Issue 编号。
2. 先跑证据再写“完成”；失败留在 PR 描述与验证报告，不虚报。
3. 提交信息：`<type>: <摘要>`，正文 `Refs #<issue>`；AI 提交加 `Alm-Agent: agent:<name>`。
4. 不夹带无关改动；不覆盖用户未提交内容；不自行合并自己开的 PR。
5. 契约、门禁、权限相关改动必须在 PR 里写清“行为变化 + 反例”。

## 7. 常见故障

| 现象 | 原因 | 处理 |
|---|---|---|
| `Cannot find package '@deepseek-ai/...'` | 工作区链接的插件不能 import DSH 包 | 用 `ctx.reflect.provide` / `ctx.tools.register` 原始定义，保持零 import |
| 插件安装 `failed to import` | 语法错误或路径不存在 | `node --check` 每个入口文件；重装前先 `remove_bundle` |
| `alm` 输出与预期字段不符 | 契约版本或 JSON `schema` 未升 | 先跑 `alm contract verify`，再看对应 schema |
| 测试在临时目录通过、CI 失败 | 路径大小写、CRLF 或依赖缺失 | 用 `path.join` 与相对 URL；CI 用 `pnpm install --frozen-lockfile` |
| `validate-skills.ps1` 失败 | frontmatter、描述长度、相对链接 | 按报错修；技能只扫描一层，别嵌套目录 |
| 样例仓库脏 | 直接改了 `fixtures/` 或 `tmp/` | 用 `scripts/demo-init.ps1 -Force` 重建 |
| 证据哈希不一致 | 时间戳/键序进入哈希 | 只哈希规范化文件清单：键排序、LF、无时间戳 |

## 8. 完成前自检

- [ ] `pnpm test` 全绿，命令退出码符合契约。
- [ ] 新增/修改的门禁有反例，且反例确实失败。
- [ ] 契约、文档、技能命令三处一致（`check-alm-skill.mjs` 通过）。
- [ ] PR 写了证据命令、结果与未覆盖项。
- [ ] 没有把计划中的命令写成已实现。
