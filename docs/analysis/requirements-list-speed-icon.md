# 需求列表加载性能与搜索图标修复（ALM-09.17）

日期：2026-11-01
分支：`develop`（HEAD `64ec15e`），工作区改动未提交
宿主：桌面宿主已重启，API 端口 `51055`（旧 61773 已关闭）；插件 `@ai-alm/dsh-plugin-requirements` 已 reload

## 1. 问题与实测

用户反馈（m03929）：

1. 搜索框左侧放大镜图标只显示一条细边，未完整显示；
2. 打开“需求”页 7 条数据需要约 3 秒，要求降到 1 秒以内。

修复前实测：

| 指标 | 修复前 | 修复后 |
| --- | --- | --- |
| `query.requirements(D:/DSH)`（11 条资产，Node 热态） | **2971 ms** | **243–272 ms** |
| `GET /api/alm/requirements?root=D:/DSH`（curl，热态） | **2.53 s** | **0.25–0.28 s** |
| 同上 `root=tmp/list-fixture`（14 条） | 约 3 s | **0.19 s** |
| 浏览器首行可见（harness，真实 `client.js` + 真实 API，1440×900） | — | **460 ms**（含 520 KB bundle 解析与首次渲染） |
| 全仓 `pnpm test` | 407 项 / 45.8 s | **407 项 / 28.1 s** |

CPU profile 显示 88.6% 时间在 `spawnSync`：`query.requirements()` 对每条需求调用 `versionHistory()`，内部先 `git rev-parse --show-toplevel` 再 `git log --follow`，11 条需求即 22 次 git 进程；Windows 上单次 spawn 数十毫秒，合计 1–2.5 s。`versions` 只在详情抽屉的“版本历史”列表使用（`client.js` 版本块），列表页本身并不需要为每行付出 git 成本。

## 2. 修复

### 2.1 一次 git log 覆盖全部需求文件

`packages/dsh-plugin-requirements/query.mjs`

- 新增 `versionHistories(root, files, limit = 20)`：一次 `git rev-parse --show-toplevel` + 一次 `git log --max-count=limit×文件数 --name-only --format=… -- <全部需求路径>`，按提交逐文件填充版本列表（新→旧，每文件最多 20 条）。
- `requirements()` 先用需求文件集合批量取历史，再逐条读取；仅当批量调用整体失败（git 不可用等）时退回旧的 `versionHistory()` 单文件实现，避免错误路径下出现空历史。
- 结果形状与旧实现一致：`item.versions = [{ sha, short, date, subject }]`。

### 2.2 搜索图标完整显示

`packages/dsh-plugin-requirements/client.js`

两个叠加原因：

1. **布局挤压**：搜索框 `label` 是 `display:flex`，输入框 `width:'100%'` 且未设 `min-width:0`，SVG 默认 `flex-shrink:1` 被压成 1–2px 的细条。
   - 图标外层加 `span`：`display:inline-flex; flex:0 0 auto; width/height:14px`；
   - 输入框改 `flex:1 1 auto; minWidth:0`。
2. **路径本身不完整**：`ICON_PATHS.search` 原为 `M11 4a7 7 0 105.2 11.7L21 21M11 4a7 7 0 00-7 7`，两段弧拼出的圆缺一段，即使不挤压也显示不全。
   - 改为完整圆 + 手柄：`M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16M16.65 16.65 21 21`。

## 3. 验证

- 单元/集成：`pnpm test` **407/407 pass**（28.1 s，比修复前快 17.7 s，因为测试里的 `requirements()` 也走批量历史）。
- HTTP（reload 后，宿主 51055）：`root=D:/DSH` 3 次 0.252/0.266/0.282 s；`root=tmp/list-fixture` 3 次 0.187/0.191/0.204 s。
- Node 内测：`root=D:/DSH` 3 次 272/243/249 ms；`root=tmp/list-fixture` 3 次 324/214/154 ms；返回 11/14 行，版本条数 17/14。
- 浏览器（`tmp/ui-harness`，esbuild 打包真实 `client.js`，63113 反代 51055，Chrome 1440×900）：首行可见 460 ms；7 行正常渲染；搜索图标 `boundingBox = { width: 14, height: 14 }`，2x 截图 `tmp/ui-shots-perf/02-search@2x.png` 可见完整放大镜；整页截图 `tmp/ui-shots-perf/01-list.png`；无控制台错误。

## 4. 已知限制

- 批量历史不再对复制/重命名做 `--follow`：`fixtures/order-refund/requirements/refund-idempotent.sdoc` 由 `refund.sdoc` 复制而来，其“版本历史”少 1 条复制前的提交（3 条而非 4 条）。列表页与整体性能不受影响；如需精确追溯，后续可在详情抽屉打开时按需调用单文件 `versionHistory()`。
- 页面数据量越大，`git log --max-count = 20 × 文件数` 的单次输出越大；数百条需求时应改为详情按需加载。
- 浏览器测量包含 520 KB 开发 bundle；宿主内 GUI 已加载 client，刷新后仅需 API 请求（热态约 0.25 s）。
- 未在宿主 GUI 内直接点击验证（GUI 需要 token，沿用 harness 真实 client + 真实 API 的方式）；未提交、未 push。

## 5. 修改文件

- `packages/dsh-plugin-requirements/query.mjs`：新增 `versionHistories()`；`requirements()` 改用批量历史；失败时回退旧实现。
- `packages/dsh-plugin-requirements/client.js`：搜索图标布局（`flex:0 0 auto` 包裹层、输入框 `flex:1 1 auto; minWidth:0`）与 `ICON_PATHS.search` 路径。
- 验证脚本（`tmp/`，不提交）：`tmp/ui-harness/ui-perf-icon3.mjs`、`tmp/time-query2.mjs`、`tmp/check-versions.mjs`。

## 6. 生效状态

- 服务端：`plugin_manager` 对 `@ai-alm/dsh-plugin-requirements` disable→enable，`application: applied`；HTTP 实测已是新代码。
- 客户端：`client.js` 随页面加载，刷新需求页（或重开面板）后生效。
- 未 commit、未 push、未重启宿主。
