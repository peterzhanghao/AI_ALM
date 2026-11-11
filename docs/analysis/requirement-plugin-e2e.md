# 验收命令登记入口修复 + 需求插件全流程自检

日期：2026-11-01
对象：`@ai-alm/dsh-plugin-requirements`（需求插件，desktop profile 以 link 方式安装）
分支：`develop`，HEAD `64ec15e`
状态：已实现并自检通过，未 commit / 未 push；插件已 disable→enable 重载，客户端需刷新页面。

## 1. 用户报告的问题

需求详情页点击「登记验收命令」后，弹层只有红字：

```
未登记验收命令：D:\DSH\.alm\acceptance\REQ-ALM-001.json
可在工作区创建 .alm/acceptance/<需求ID>.json 登记命令，例如 {"commands":[...]}
```

这是死路：插件没有提供“登记命令”的写入入口，用户只能手写 JSON。

## 2. 根因（三层）

1. **缺少写入通道**：核心 `acceptance.mjs` 只有 `runAcceptance`（读配置执行），没有“校验 + 原子写配置”的 API；插件没有对应路由；客户端弹层只会显示 `no-config` 错误。
2. **缺少编辑界面**：`AcceptanceModal` 在无配置时只有一段提示文字，没有可编辑控件。
3. **live 宿主的模块缓存**：桌面宿主在运行中缓存了旧版 `packages/alm-core`。插件直接 `import { applyAcceptanceConfig }` 会让插件**激活失败**（`does not provide an export named 'applyAcceptanceConfig'`），必须用命名空间导入 + 惰性回退。

## 3. 修复内容

### 3.1 核心（canonical）

`packages/alm-core/src/acceptance/acceptance.mjs` 新增：

- `parseCommandArgs(text)`：支持引号，拒绝 `| ; & > < $ \`` 与换行（`shell-not-allowed` / `command-invalid` / `command-required`）。
- `normalizeAcceptanceCommands(input)`：复用既有白名单（node / npm / pnpm）与 timeout 校验，输入可以是命令行字符串数组或 `{id, command, timeoutMs}` 数组。
- `planAcceptanceConfig({ root, requirementId, commands })`：只返回计划，不落盘（`alm.acceptance.config.plan/v1`）。
- `applyAcceptanceConfig({ root, requirementId, commands, writeFile })`：`mkdir .alm/acceptance` → 临时文件 → `renameSync` 原子写；校验失败不覆盖旧配置。

### 3.2 插件层

- `packages/dsh-plugin-requirements/acceptance-registry.mjs`（新增）：优先使用核心实现；当 live 宿主缓存旧核心、导出缺失时，回退到等价实现（同一套引号/白名单/timeout 校验与原子写，`RegistryError`）。
  - 这是**宿主重启前的过渡层**：重启后核心导出可见，自动走核心实现，可删除该回退。
- `packages/dsh-plugin-requirements/index.js`：
  - 路由 `POST /api/alm/requirements/acceptance-config`；
  - 先用 `reviewContext` 校验需求存在（404），再 plan / apply；`RegistryError` 转 400 并保留 code。
  - `acceptance` 分支改为命名空间导入 `acceptanceCore.runAcceptance`，避免缓存导致激活失败。

### 3.3 客户端

- `AcceptanceModal` 重写：
  - 无配置（`no-config`）时**直接进入编辑态**，不再显示红色死路错误；一行一条命令，默认示例 `node --test`，提示“不经过 shell”。
  - 保存走 `acceptance-config`，成功后重新加载：显示命令列表、「修改命令」、「运行验收」。
  - 校验错误原样展示（如 `binary-not-allowed` 的中文原因），失败停留在编辑器。
  - 运行后展示结果（pass/fail）、需求修订/实现提交/测试修订/环境/时间/来源与每条命令的 exit code。

## 4. 测试

- 新增 `packages/alm-core/test/unit/acceptance-config.test.mjs`（6）：引号解析、shell 拒绝、白名单、timeout 边界、plan 不落盘、apply 可读、校验失败不覆盖旧配置。
- 新增 `packages/dsh-plugin-requirements/test/acceptance-config-http.test.mjs`（2）：no-config 404 → preview 不写盘 → apply 写入 → 读回计划 → 非白名单 400 且旧配置不变；未知需求 404。
- `packages/dsh-plugin-requirements/test/lifecycle.test.mjs` 路由清单补 `acceptance-config`。
- 全仓 `pnpm test`：**415 / 415 pass**（32.7s）。

## 5. 真实宿主（54672）验收

`tmp/probe-acceptance-config.mjs` → `tmp/acceptance-config-live.json`：

| 请求 | 结果 |
| --- | --- |
| `plan`（`node -e "process.exit(0)"`） | 200，`alm.acceptance.config.plan/v1`，`applied:false` |
| `node ... ; rm -rf /` | 400 `shell-not-allowed` |
| `curl ...` | 400 `binary-not-allowed` |
| `apply` | 200，写入 `.alm/acceptance/REQ-ALM-014.json` |
| `acceptance apply` | 200，`result:pass`，证据 `alm.acceptance/v2`，绑定 requirementHash/testRevision |

浏览器（真实 `client.js` bundle + harness 反代宿主，`tmp/ui-harness/ui-acceptance-register.mjs`）：**13 / 13 pass**
无配置时直接出现编辑器 → 非白名单被拒绝且停留在编辑器 → 保存后出现命令列表与「运行验收」→ 运行返回 `pass` → 配置文件 schema 正确 → 证据落盘 → 无脚本错误。
截图：`tmp/ui-shots-acceptance/01-registered.png`、`02-run-result.png`。

## 6. 全流程自检（提出优化需求 → 评审 → 开发 → 验收 → 发布预览）

脚本：`tmp/flow-selfcheck.mjs`（隔离夹具 `tmp/flow-fixture`，从 `fixtures/order-refund` 复制并独立 `git init`），报告：`tmp/flow-out/report.json`。

| 步骤 | 实际操作 | 结果 |
| --- | --- | --- |
| 1 提出优化需求 | `POST /create`（标题「验收命令登记入口…」，P1，负责人张浩，含背景/目标/范围/验收线索） | `REQ-PAY-005`，`requirements/req-pay-005.sdoc` |
| 2 开发准备 | 写 `tests/flow-check.sdoc`（TEST-PAY-905）+ `verified_by` 关系 + `test/flow.test.mjs`，git commit | 通过 |
| 3 登记验收命令 | `acceptance-config`：预览不落盘；`; rm -rf` 400；`curl` 400；apply 写入 | 通过 |
| 4 执行验收 | `POST /acceptance apply` | `pass`，证据 v2，绑定需求/测试修订 |
| 5 评审 | `POST /review apply` | 5/5 视角，0 阻塞 |
| 6 人工签收 | `POST /signoff`（`human:local`） | `applied`，决策 `verified`，业务状态仍 `proposed` |
| 7 开始开发 | `POST /start apply` | `CHG-PAY-001` + 任务卡；负例（未验证需求）→ 409 `evidence-incomplete` |
| 8 发布通道 | `POST /github`（预览） | 200 `alm.github.plan/v1`（**未写入远端**） |
| 9 AI 评审通道 | `POST /ai-review`（真实模型） | 200，14.0s，`alm.ai-review/v1`，verdict `warn`，3 条建议 |

**21 / 21 断言通过**。

浏览器复核（`tmp/ui-harness/ui-flow-verified.mjs`）：**7 / 7 pass**
列表行显示「已签收」→ 详情决策条「已签收 / 验收通过」→ 「开始开发」可用 → 打开真实变更计划弹层（自检已创建 `CHG-PAY-001`，界面按当前仓库预览下一个编号 `CHG-PAY-002`，含 3 张任务卡与将写入的文件清单）；无脚本错误。
截图：`tmp/ui-shots-flow/01-list.png`、`02-detail-verified.png`、`03-start-plan.png`。

## 7. 人工验证清单（请在 GUI 中逐项确认）

1. 打开 GUI（`http://127.0.0.1:54672`）→ 需求插件 → 刷新页面（客户端 bundle 才会更新）。
2. 「更多 → 指定根目录」填 `D:/DSH/tmp/flow-fixture` → 加载：应看到 3 条需求，`REQ-PAY-005` 行检查结果为「已签收」。
3. 打开 `REQ-PAY-005` 详情：决策条「已签收」；「证据与验收」显示验收通过、5/5 视角、需求修订/实现提交/测试修订；底部「开始开发」可用。
4. 点「运行验收」：应直接看到已登记命令 `node --test test/flow.test.mjs` 与「运行验收」按钮（不再出现“未登记验收命令”）。
5. 点「开始开发」：应显示变更计划（`CHG-PAY-001`、任务卡、隔离 worktree 选项），确认不会自动切换分支。
6. 选择 `D:/DSH/tmp/acceptance-ui-fixture` 的 `REQ-ALM-008`（无配置）：点「登记验收命令」→ 直接出现编辑器 → 输入 `node -e "process.exit(0)"` → 保存 → 运行验收 → 看到 `pass` 与来源信息。
7. 回到 D:/DSH 工作区，任一未检查需求上点「登记验收命令」，确认三件事：能编辑、能保存、保存后按钮状态变化（不要求真跑命令）。

## 8. 未验证 / 已知限制

- 未在真实 GUI 窗口内点击（同一 `client.js` 经 Playwright + 真实 API 验证）；宿主重启后核心实现会替换过渡回退层，需再验证一次。
- GitHub「发布」只验证了预览计划（不写远端、不建 Issue）；真实发布需显式授权。
- 验收命令不支持 shell 语法（设计如此）；`&&` 在字符串命令中会被当作普通参数，建议一条命令只做一件事。
- `REQ-ALM-001` 等真实需求的 `.alm/acceptance` 配置未改动；验证产生的数据都在 `tmp/` 夹具中。
- 未 commit / 未 push；上一轮遗留的未跟踪项（`.alm/`、`requirements/` 等）保持原样。

## 9. 修改文件清单

- `packages/alm-core/src/acceptance/acceptance.mjs`（新增配置解析/计划/原子写）
- `packages/alm-core/test/unit/acceptance-config.test.mjs`（新增）
- `packages/dsh-plugin-requirements/acceptance-registry.mjs`（新增，过渡适配层）
- `packages/dsh-plugin-requirements/index.js`（路由 + 分支 + 命名空间导入）
- `packages/dsh-plugin-requirements/client.js`（AcceptanceModal 重写 + no-config 不再报错）
- `packages/dsh-plugin-requirements/test/acceptance-config-http.test.mjs`（新增）
- `packages/dsh-plugin-requirements/test/lifecycle.test.mjs`（路由清单补一行）
- `tmp/probe-acceptance-config.mjs`、`tmp/flow-selfcheck.mjs`、`tmp/ui-harness/ui-acceptance-register.mjs`、`tmp/ui-harness/ui-flow-verified.mjs`（验证脚本）
