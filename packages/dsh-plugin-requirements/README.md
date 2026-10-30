# @ai-alm/dsh-plugin-requirements

需求领域插件（ALM-03.02）：一个 HTTP 路由、一个 Agent 工具、一个页面。

| 项 | 内容 |
|---|---|
| 路由 | `GET /api/alm/requirements` → `alm.requirements/v1` |
| 页面路由 | `GET /alm/requirements` → 只读 HTML（免 token，可直接在浏览器打开） |
| 工具 | `alm_requirements [root]` |
| 页面 | 侧边栏「需求」图标 / Settings → Requirements；`main` 面板 key `requirements` |
| 数据 | 复用 `alm-core` 的 index + check；缺口来自 COV-001/COV-002 |

## 打开页面

1. DSH 内：点左侧边栏「需求」图标（`sidebar.panellist`，id `requirements`），或 Settings → Requirements；两处都直接渲染需求列表，页面里也有 “Open as main panel”。
2. 浏览器直接打开：`http://127.0.0.1:<DSH 端口>/alm/requirements`（服务端渲染、只读、无需 token）。

> 注意：`http://127.0.0.1:<端口>/` 是 DSH GUI 入口，必须使用 `dsh web` 打印的带 token URL；直接打开会返回 401 `dsh web authentication required`。插件页面请用上面的 `/alm/requirements` 或 DSH 内的 Settings。

## 约束

- 工作区链接安装不能 `import` `@deepseek-ai/*`；本包只用 `ctx.tools`、`ctx.webServer` 与浏览器 `fetch`。
- 默认根目录是仓库的 `fixtures/order-refund`；可在 bundle 配置 `root` 覆盖。
- 页面文本暂为英文，标题/描述已本地化。

## 验证

```powershell
node --test "packages/dsh-plugin-requirements/test/**/*.test.mjs"
# 安装后：alm_requirements 调用、Slots.listSubTree root=main 出现 requirements
```
