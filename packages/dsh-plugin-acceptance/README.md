# @ai-alm/dsh-plugin-acceptance

插件验收台（Plugin Acceptance Bench）：为 DSH 插件跑一轮**可审阅的 UI 验收**，把结论落成证据 + 逐条签收 + 不可变轮次。

## 它解决什么

`alm acceptance`（`packages/alm-core/src/acceptance/`）跑的是**命令**：单测、CI、`tsc`。它只能证明"测试过了"，不能证明"用户点开插件看到的东西是对的"，也不能让评审人逐条签收。本包补上这一段：

- 用真实浏览器打开插件页面，截图像素 + 抓 DOM 快照作为证据；
- 每条检查项必须带证据，没有证据的检查项记 `blocked`，不允许签字；
- 报告是单个自包含 HTML，双击即可看，评审人逐条点「通过」/「打回」并导出 JSON；
- 判定写进 `reviews.json`，轮次本身不可变，修复必须开新轮。

## 快速开始

```bash
# 跑一轮（默认 L1）
pnpm acceptance run --plugin @ai-alm/dsh-plugin-requirements

# 看历史轮次 / 看某一轮
pnpm acceptance rounds --plugin @ai-alm/dsh-plugin-requirements
pnpm acceptance show --plugin @ai-alm/dsh-plugin-requirements --round 001 --json

# 把评审页导出的 acceptance-reviews-<id>.json 收回
pnpm acceptance review --plugin @ai-alm/dsh-plugin-requirements --round 001 --reviews ./acceptance-reviews-<id>.json
```

跑完会打印报告路径，直接打开 `report.html` 即可审阅。证据全部在 `.alm/acceptance2/` 下，且该目录自带 `.gitignore`（内容 `*`），**不会进 git**。

退出码：`0` 判定通过、`1` 失败或阻塞、`2` 用法错误、`3` 内部错误。CI 可以直接用。

## 场景怎么定义

放在 `acceptance/plugins/<包名>/scenarios/*.mjs`，默认导出：

```js
export default {
  id: 'requirements-pages',
  title: '需求与架构页渲染',
  plugin: '@ai-alm/dsh-plugin-requirements',
  level: 'L1',
  start: { module: 'scripts/lib/plugin-pages.mjs', export: 'servePages', options: { root: 'fixtures/order-refund' } },
  checks: [
    {
      id: 'requirements-table',
      title: '需求页渲染出需求行',
      expected: '表格里能看到 REQ-PAY-001',
      steps: [
        { goto: '/alm/requirements' },
        { expectTitle: 'ALM Requirements' },
        { expectText: 'REQ-PAY-001' },
        { expectCount: { selector: 'tbody tr', min: 2 } },
        { expectNoConsoleErrors: true },
        { shot: 'requirements' },
        { dom: 'requirements' },
      ],
    },
  ],
}
```

`start` 三选一：

| 写法 | 用途 |
| --- | --- |
| `{ base: 'http://127.0.0.1:60870' }` | 页面已经跑起来了（DSH 侧栏、dev server） |
| `{ module: 'scripts/lib/plugin-pages.mjs', export: 'servePages' }` | 引擎自己起页面源，返回 `{ url, close() }` |
| 不写 `start` | 报错：验收必须知道自己打开什么 |

可用步骤：`goto`、`waitFor`、`click`、`fill`、`expectText`、`expectNoText`、`expectCount`、`expectTitle`、`expectNoConsoleErrors`、`expectNoFailedRequests`、`shot`、`dom`。

硬规则（加载时校验，违反直接报错而不是默默放行）：

- 每个检查项至少要有 `shot` 或 `dom` 一步——**没有可审阅证据的检查不算检查**；
- `expectCount` 必须带且只带 `equals`/`min`/`max` 之一；
- 检查项 `id` 必须 kebab-case 且在场景内唯一。

## 一轮里到底存了什么

```
.alm/acceptance2/<plugin-slug>/
  001/
    round.json          # 判定、每项观察、步骤日志、证据清单、代码指纹
    evidence/<scenario>/<check>-*.png
    evidence/<scenario>/<check>-*.dom.json
    report.html         # 自包含：截图内联、CSP 锁死外部资源
    reviews.json        # 评审人的逐条决定（可多次追加）
  002/
```

`round.json` 记录的**代码指纹**是这一轮的核心：`git HEAD`、分支、工作区是否 dirty（连同 status digest）、被测文件（插件 manifest、入口、场景文件）的 sha256、运行环境（Node / Playwright / 实际用到的浏览器版本）。没有这层，"截图"无法证明它对应的是哪份代码。

后续轮次会自动与上一轮比对，代码动了就在报告顶部挂"证据与当前代码不一致"的横幅。

## 与 Agent 的接口

插件注册 4 个 host tool（`index.js`）：

| 工具 | 作用 |
| --- | --- |
| `acceptance_run({plugin, requirement?, level?, scenarios?, ids?, expectHead?})` | 跑一轮，只回结构化摘要（判定/统计/失败项/证据路径），不回灌日志 |
| `acceptance_review({roundId, plugin, decisions?, reviewsFile?})` | 收回评审决定，返回已决定项与未评审缺口 |
| `acceptance_show({roundId, plugin})` | 读一轮 + 评审 + 当前代码漂移 |
| `acceptance_rounds({plugin, requirement?})` | 轮次时间线 |

给 `expectHead` 传一个提交号时，HEAD 不匹配会让整轮 `blocked`——防止把别人机器上跑的旧证据当成这次提交的验收结论。

## 证据分级（必须在场景里写明）

| 等级 | 含义 | 现状 |
| --- | --- | --- |
| `L1` | 隔离渲染：引擎起页面源 + 真实浏览器截图 | **已实现**，也是当前默认 |
| `L2` | 真实 DSH 宿主内的页面，人工在场 | 待做 |
| `L3` | 真实宿主全自动（CDP 接管） | 不做：需要改宿主启动方式（`--remote-debugging-port` 或令牌） |

L1 的边界要说清楚：它渲染的是**插件页面的页面源**（例如 `scripts/lib/plugin-pages.mjs` 起的只读页），不是宿主里的侧栏宿主壳。它证明"页面能渲染、数据对、无报错"，不证明"在 DSH 侧栏里长得一样"。所以每条检查项都带 `level` 字段，报告里逐条标出来。

## 遇到问题

- **找不到浏览器**：本机只装了部分 Playwright revision，`launchBrowser()` 会依次回退 `bundled` → `chrome` → `msedge`；都没有就报 `no usable browser`。
- **页面打不开**：DSH 侧栏浏览器封禁宿主端口的 loopback URL，插件必须用独立端口（见 `packages/dsh-plugin-requirements/sidebar.mjs`）。
- **轮次写不进去**：轮次不可变，同一个 `roundId` 不能重写；修复后开新轮，旧轮的 `supersedes` 会指向前一轮。
- **要重跑失败项**：`pnpm acceptance run --plugin <p> --scenario <scenarioId>`，报告里每条的 `repro` 就是这条命令。

## 安装到 profile

```bash
plugin_manager install_bundle target="./packages/dsh-plugin-acceptance"
```

或者本地 link 后 `plugin_manager set_plugin`，与其它 `@ai-alm/*` 插件同路。
