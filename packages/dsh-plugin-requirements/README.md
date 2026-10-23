# @ai-alm/dsh-plugin-requirements

需求领域插件（ALM-03.02）：一个 HTTP 路由、一个 Agent 工具、一个页面。

| 项 | 内容 |
|---|---|
| 路由 | `GET /api/alm/requirements` → `alm.requirements/v1` |
| 工具 | `alm_requirements [root]` |
| 页面 | Settings → Requirements；`main` 面板 key `requirements` |
| 数据 | 复用 `alm-core` 的 index + check；缺口来自 COV-001/COV-002 |

## 约束

- 工作区链接安装不能 `import` `@deepseek-ai/*`；本包只用 `ctx.tools`、`ctx.webServer` 与浏览器 `fetch`。
- 默认根目录是仓库的 `fixtures/order-refund`；可在 bundle 配置 `root` 覆盖。
- 页面文本暂为英文，标题/描述已本地化。

## 验证

```powershell
node --test "packages/dsh-plugin-requirements/test/**/*.test.mjs"
# 安装后：alm_requirements 调用、Slots.listSubTree root=main 出现 requirements
```
