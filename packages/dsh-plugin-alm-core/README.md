# @ai-alm/dsh-plugin-alm-core

把 `alm-core` 的只读能力暴露为 DSH Host 服务与 Agent 工具（ALM-03.01）。

| 项 | 内容 |
|---|---|
| Host 服务 | `almCore`（index / check / show / query） |
| 工具 | `alm_index`、`alm_check`、`alm_show`、`alm_query` |
| 默认根目录 | 当前 Agent 的工作目录；可用 `root` 参数覆盖 |
| 权限 | 只读；**没有**审批、发布、改规则、改保护分支的工具 |

## 约束

工作区链接安装的 bundle 不能 `import` `@deepseek-ai/*`，因此：

- 服务用 `ctx.reflect.provide('almCore', this)` 注册；
- 工具用原始 `ToolDefinition` 调 `ctx.tools.register`；
- 领域逻辑全部在 `../alm-core`，本包只做参数与上下文适配。

## 验证

```powershell
node --test "packages/dsh-plugin-alm-core/test/**/*.test.mjs"
# 安装后在会话中调用 alm_index / alm_check
```

安装：`plugin_manager install_bundle`，target 为本目录绝对路径；移除：`remove_bundle @ai-alm/dsh-plugin-alm-core`。
