# 自动化回归与 Issue 收口

> 目标：Issue 对应的实现合并后，自动在合并提交上重跑完整回归，聚合全部泳道证据；失败就明确失败，部分上传不能伪装成通过，并把结果回写到 Issue。

本方案参考 [`ccsert/artifact-gateway` 的 Actions](https://github.com/ccsert/artifact-gateway/actions) 分层：可复用泳道（`contract-lane.yml`）+ 聚合门禁（`ci.yml` 的 `contract-and-test`）+ 每泳道证据。映射关系见第 8 节。

## 1. 触发点

| 时机 | 工作流 | 测试提交 | 作用 |
|---|---|---|---|
| PR 创建/更新/转 Ready | `ALM MVP CI` | PR merge commit（`github.sha`） | 测试义务 + 回归门禁，合并前阻断 |
| PR 合并到 `develop` 或 `main` | `Issue regression` | `merge_commit_sha` | 合并后全量复跑、回写 Issue |
| 手动补跑 | `Issue regression`（`workflow_dispatch`） | `pr` 或 `ref` | 复现失败、补证据 |

### 为什么用 `pull_request: closed` 而不是 `issues: closed`

“Issue 开发完成”在本仓的操作定义是：**关联 PR 合并进集成分支**。Issue 关闭是随后的收口动作，由工作流回写结果。选择 PR 合并事件还有三个硬原因：

1. GitHub 只从默认分支读取 `issues` 事件的工作流。本仓默认分支是 `main`，日常集成在 `develop`；用 `issues: closed` 会在 `develop` 阶段读到 `main` 上的旧泳道定义。
2. PR 合并事件直接给出 `merge_commit_sha`，回归测试对象精确，不需要再从 Issue 时间线反查提交。
3. 避免“PR 合并”和“Issue 关闭”各跑一遍的重复计算。Issue 仍是报告目标：`report` 作业会评论并打标签。

若未来 `main` 成为日常集成分支，可以再增加 `issues: closed` 触发；当前不采用。

## 2. 回归泳道

泳道定义在 [`scripts/regression.mjs`](../../scripts/regression.mjs) 的 `LANES`，PR 门禁和合并后回归共用同一份定义。

| 泳道 | 命令 | 失败含义 |
|---|---|---|
| `unit` | `pnpm test` | 任一包的单测/集成测试失败 |
| `contract` | `alm contract verify`、`alm index`/`alm check`（`order-refund`、`smoke`） | 五类契约或 R1 门禁回归 |
| `fixtures` | `node scripts/regression-fixtures.mjs` | 正例不再通过，或负例没有按声明规则失败 |
| `cli` | `alm --help/--version/contract/index/check/query/show/trace/impact/diff` | CLI 命令面、退出码或 JSON 契约回归 |
| `skills` | `validate-skills.ps1`、`check-alm-skill.mjs` | 技能 frontmatter、链接、命令表与 `alm --help` 不一致 |

`fixtures` 泳道读取 [`fixtures/negative/cases.json`](../../fixtures/negative/cases.json)：每个 `enforced=true` 的反例必须退出码 1，且结果里出现声明的规则 ID 和至少一条带源文件的 finding。正例必须退出码 0 且资产数量符合预期。

### 2.1 测试义务：后续开发怎样自动补测试

“自动补测试”分两层，不能混为一谈：

1. **语义层（Agent/评审）**：`alm-mvp-dev` 技能指导 Agent 从 Issue 的正例/反例推导测试，写进对应包的 `test/`，并补负例夹具。脚本不会凭空写出正确断言。
2. **门禁层（脚本保证）**：[`scripts/test-obligation.mjs`](../../scripts/test-obligation.mjs) 检查 PR 的 `base...head` 变更：
   - 改了 `packages/*/src/`、`packages/*/bin/` 或插件入口，却没有新增/修改 `*.test.mjs` 或夹具 → 退出码 1。
   - 有测试/夹具变更 → 通过。
   - 确实无法补测 → PR 正文写一行豁免说明（`Test-Exemption` + 冒号 + 至少 10 个字符理由），评审确认后通过。
   - 只改文档、技能、CI YAML、`scripts/` 或 `fixtures/` → 不强制补测试（对应泳道仍会执行）。

CI 中的 `test-obligation` 作业与 `regression-gate` 并列；PR 两者都绿才能合并。`regression-gate` 也会在 `test-obligation` 失败时变红，避免只看见泳道绿而忽略漏测。

测试被执行由机制保证，不依赖人工记得注册：

- 根 `pnpm test` 的 glob 是 `packages/*/test/**/*.test.mjs`，新测试文件自动纳入 `unit` 泳道。
- `fixtures/negative/cases.json` 新增 case 自动纳入 `fixtures` 泳道。
- 新正例夹具需要在 `scripts/regression-fixtures.mjs` 的 `POSITIVE` 登记期望资产数；这是当前唯一需要显式登记的位置。
- 新 CLI 命令还要同步 `HELP` 与 `references/commands.md`，由 `skills` 泳道的 `check-alm-skill.mjs` 检查。

详细落点表、反例写法与豁免规则见 [`alm-mvp-dev` 的 testing 参考](../../.dsh/skills/alm-mvp-dev/references/testing.md)。

## 3. 工作流结构

```text
PR ──> ALM MVP CI
        ├─ test-obligation（源码变更必须有测试/夹具，或显式豁免）
        └─ regression (matrix: unit/contract/fixtures/cli/skills)
             └─ regression-gate（下载全部制品、聚合、失败则红）

merge ─> Issue regression
          ├─ prepare（解析 merge SHA、关联 Issue）
          ├─ regression（同一套 matrix / 可复用工作流）
          ├─ regression-gate（同一套聚合规则）
          └─ report（评论 PR + Issue，打 regression::* 标签）
```

| 文件 | 职责 |
|---|---|
| [`regression-lane.yml`](../../.github/workflows/regression-lane.yml) | `workflow_call` 可复用泳道；checkout 前写 bootstrap，失败也保留证据 |
| [`alm-ci.yml`](../../.github/workflows/alm-ci.yml) | PR 门禁（可手动触发）；泳道矩阵 + 聚合 |
| [`issue-regression.yml`](../../.github/workflows/issue-regression.yml) | PR 合并后回归；解析目标、聚合、回写 Issue |
| [`scripts/regression.mjs`](../../scripts/regression.mjs) | 泳道执行、证据写入、聚合与 Markdown 报告 |
| [`scripts/test-obligation.mjs`](../../scripts/test-obligation.mjs) | PR 测试义务门禁：源码变更必须带测试/夹具或显式豁免 |

`regression-lane.yml` 只接收 `lane` 和 `ref`，不复制测试命令。新增泳道时只需改 `scripts/regression.mjs`、两个工作流的 matrix 和聚合的 `--lanes`，避免 PR 与合并后跑出两套行为。

## 4. 证据契约

每个泳道产生两个文件，上传为 `regression-<lane>-<run_attempt>`：

### 4.1 `bootstrap.json`

checkout **之前**写入，用于 checkout/安装失败时的诊断：

```json
{
  "schema": "alm.regression.bootstrap/v1",
  "lane": "unit",
  "status": "bootstrap-incomplete",
  "ref": "<ref>",
  "head": "<github.sha>",
  "runId": "123456",
  "attempt": "1",
  "startedAt": "2026-10-23T12:00:00Z"
}
```

### 4.2 `result.json`

泳道跑完（成功或命令失败）后由 runner 写入：

```json
{
  "schema": "alm.regression.lane/v1",
  "lane": "unit",
  "title": "单元与集成测试",
  "status": "passed",
  "exitCode": 0,
  "head": "<checkout HEAD>",
  "runId": "123456",
  "attempt": "1",
  "durationMs": 12345,
  "failure": null,
  "commands": [
    { "label": "pnpm test", "command": "pnpm test", "exitCode": 0, "durationMs": 12000 }
  ]
}
```

若 checkout/安装阶段就失败，`Seal evidence when the lane did not run` 步骤会补一个 `status=setup-failed|failed|cancelled` 的 `result.json`，不会留下空制品。

### 4.3 聚合门禁

`regression-gate` 下载 `regression-*`，执行：

```powershell
node scripts/regression.mjs aggregate --input <dir> --output <dir> \
  --lanes unit,contract,fixtures,cli,skills --head <sha>
```

硬规则：

- 期望泳道必须**每个都有** `result.json`；缺失即失败，不能用“其余通过”代替。
- `status` 必须是 `passed`，`exitCode` 必须是 `0`。
- `result.head` 必须等于目标提交；防止拿错提交的证据。
- 出现期望列表之外的泳道证据（例如旧矩阵残留）也失败，避免部分上传被当成完整矩阵。
- 只接受当前 `GITHUB_RUN_ID` / `GITHUB_RUN_ATTEMPT` 的结果；重跑时旧 attempt 不会混入。

聚合产物为 `summary.json`、`summary.md`、`status.txt`，上传为：

- PR：`regression-evidence-<run_attempt>`，保留 14 天。
- 合并后：`issue-regression-evidence-<run_attempt>`，保留 30 天。

## 5. Issue 回写

`prepare` 从 PR 正文和 timeline 解析关联 Issue：

- 正文关键词：`Closes/Fixes/Resolves/Refs #n`。
- timeline 的 `cross-referenced` 事件作为兜底。
- 过滤掉 PR 自身和指向其他 PR 的编号。

`report` 对 PR 和每个关联 Issue：

1. 写入（或更新）带 `<!-- alm-regression:<sha> -->` 标记的评论；同一提交重跑只更新，不刷屏。
2. 给 Issue 打 `regression::passed` 或 `regression::failed`，并移除相反标签。
3. 失败时**不会**自动重开 Issue，也不会改动 `status::*`；按评论里的失败泳道和命令定位，修复后重跑即可。

标签由工作流在缺失时创建，也会由 [`scripts/setup-github.ps1`](../../scripts/setup-github.ps1) 初始化。

## 6. 本地运行

```powershell
# 跑单个泳道（证据写到 tmp/，已被 .gitignore 忽略）
node scripts/regression.mjs run-lane contract --output tmp/regression/contract

# 聚合已有泳道；缺少 unit 时会明确失败
node scripts/regression.mjs aggregate --input tmp/regression --output tmp/regression-gate `
  --lanes contract,fixtures,skills
```

`unit` 泳道等价于 `pnpm test`。在 DSH 文件沙箱里，Node 测试器的子进程管道可能被拒绝（`spawn EPERM`）；这是宿主限制，不是仓库回归失败。GitHub Actions 的普通 runner 不受此限制。Windows 本地运行 `skills` 泳道会优先用 `powershell.exe`，Linux runner 用 `pwsh`。

## 7. 扩展泳道

1. 在 `scripts/regression.mjs` 的 `LANES` 增加 `title` 与 `commands`。
2. 把 lane 加入 `alm-ci.yml` 与 `issue-regression.yml` 的 matrix。
3. 把 lane 加入两个聚合步骤的 `--lanes`，以及 `DEFAULT_LANES`。
4. 更新本文第 2 节和 README 的 CI 说明。
5. 本地跑一次 `run-lane` 和 `aggregate`，确认失败时确实变红。

## 8. 与参考项目对照

| `artifact-gateway` | 本仓落地 | 保留的思想 |
|---|---|---|
| `ci.yml` 的 `contract-core` / `contract-native` | `alm-ci.yml` 的 `regression` matrix | 多泳道并行、`fail-fast: false` |
| `contract-lane.yml` | `regression-lane.yml` | `workflow_call` 复用、每泳道独立 runner |
| `contract-and-test` 聚合 | `regression-gate` + `scripts/regression.mjs aggregate` | 下载全部制品、缺一即失败、聚合证据也上传 |
| checkout 前的 `bootstrap.json` | 同左 | setup 失败仍可归因 |
| `download-artifact` + `toJSON(needs)` | 制品 + `--lanes`/`--head` | 证明完整矩阵与同一提交 |
| `release.yml` 校验 check-runs | 暂未实现 | 发布前要求回归通过；本仓发布流程尚未定义 |
| Action 固定到 commit SHA | 使用 `@v4`/`@v7` | 与现有仓库风格一致；后续可统一收紧 |

## 9. 限制与后续

- 合并后回归不能阻塞已经完成的合并；阻塞层是 PR 的 `ALM MVP CI`。两层使用同一套泳道，避免“PR 绿、合并后红”时命令不一致。
- `ALM MVP CI` 只响应 PR 与手动触发；直接推送到 `develop` 不会自动跑完整回归（初始化期文档基线除外）。代码变更必须走 PR，或手动触发 `ALM MVP CI` / `Issue regression`。
- `test-obligation` 是 PR 门禁，`Issue regression` 只验证已有测试是否回归，不替代“必须补测试”的检查。绕过 PR 检查的提交不会被追溯补测。
- `pull_request` 来自 fork 时令牌只读，`report` 无法评论/打标签。本仓按同仓分支协作设计；若开放 fork，需要单独的 `pull_request_target` 方案并做安全评估。
- 制品保留期受仓库配额限制；需要长期留存的证据应转存到发布基线或外部存储。
- 目前不覆盖真实浏览器 E2E、性能基准和发布制品校验；新增时按第 7 节扩泳道，不要把命令直接塞进 `alm-ci.yml`。
