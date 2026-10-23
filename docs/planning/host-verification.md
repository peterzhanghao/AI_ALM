# DSH 宿主插件能力验证记录（ALM-01.02）

- 日期：2026-10-23
- 环境：DeepSeek Harness **44.7.0**（DSH Desktop），Electron 44.7.0，Host Node.js **24.21.0**，Windows，profile `desktop`
- 验证对象：`packages/dsh-plugin-alm-core/`（spike bundle，非最终业务插件）
- 结论：**通过**。Cordis 插件的安装、服务注册、插件间服务依赖、工具注册、Client slot 注册、禁用回收与重装均可用；ALM-03 可按双插件方案推进，无需降级到 CLI + MCP。

## 1. 验证项

| # | 能力 | 方法 | 结果 |
|---|---|---|---|
| 1 | Bundle 安装 | `plugin_manager install_bundle`（工作区目录） | `application: applied`，profile 增加 `link:D:/DSH/packages/dsh-plugin-alm-core` |
| 2 | Host Service 注册 | 插件行 `alm-core` 提供 `almCore` | `alm_probe` 返回真实运行数据 |
| 3 | 插件间 Service 依赖 | 第二行 `alm-core-consumer` 声明 `inject: ['tools','almCore']` | `alm_probe_consumer` 调用到同一服务实例 |
| 4 | Tool 注册 | `ctx.tools.register`（原始 `ToolDefinition`，无 `defineTool`） | `Tool.listTools` 列出两个工具；会话工具表实际新增两个工具 |
| 5 | Client slot 注册 | `main`（keyed）与 `settings.section`（list） | `Slots.listSubTree` 两个 slot 的 occupants 均含 `alm-probe`，`active: true` |
| 6 | 禁用回收 | `plugin_manager set_bundle enabled=false` | 工具从 `Tool.listTools` 消失；`settings.section` 不再含 `alm-probe` |
| 7 | 重新启用 | `enabled=true` | 工具恢复；服务重新构造（`startedAt` 变化、`calls` 归 1） |
| 8 | 卸载与重装 | `remove_bundle` → `install_bundle` | 两次均 `application: applied`，重装后工具可用 |
| 9 | 错误诊断 | 首次安装（含 DSH 包 import） | 失败但宿主不崩溃，返回可读诊断（见第 3 节） |

## 2. 实测输出

```json
// alm_probe
{
  "plugin": "0.1.0",
  "service": "almCore",
  "node": "24.21.0",
  "electron": "44.7.0",
  "startedAt": "2026-10-23T07:31:31.937Z",
  "calls": 1
}

// alm_probe_consumer（验证跨插件服务依赖）
{
  "via": "alm-core-consumer",
  "service": "almCore",
  "calls": 2,
  "plugin": "0.1.0"
}
```

`main` slot 占用：

```json
{ "registrant": "Kb", "key": "alm-probe", "priority": 0, "active": true }
```

`settings.section` 占用：

```json
{ "registrant": "Kb", "id": "alm-probe", "order": 90, "priority": 0, "active": true }
```

## 3. 关键发现：工作区链接的 bundle 不能 import DSH 包

首次安装时两行插件都 `failed to import`：

```text
Cannot find package '@deepseek-ai/cordis' imported from D:\DSH\packages\dsh-plugin-alm-core\index.js
Cannot find package '@deepseek-ai/dsh-tools' imported from D:\DSH\packages\dsh-plugin-alm-core\consumer.js
```

原因：`install_bundle` 以 `link:` 方式安装工作区目录，Node 从链接路径解析，向上找不到 DSH 安装目录里的包。

采用的替代写法（已验证可用，且无构建、无依赖）：

- Service：`ctx.reflect.provide('almCore', this)`（`Service` 构造器内部就是这一步）。
- Tool：`ctx.tools.register({ name, description, parameters, output, execute })`，`parameters` 直接用完整 JSON Schema，不依赖 `defineTool`。
- Client：`window.__ModuleLoader__.load` + `ctx.slots.inject/register`，与模板一致，无需 import。

**对 ALM-03.01 的约束**：业务插件要么继续只用 `ctx` API（推荐，零依赖、可链接安装），要么改为发布 npm 包并声明 `peerDependencies`。若后续确实需要 DSH 类型/工具，在构建期用类型声明，运行期保持零 import。

## 4. 未验证 / 限制

| 项 | 说明 |
|---|---|
| 页面实际渲染 | 未取得截图；只验证了 slot 注册与占用，未验证像素级布局与暗色主题 |
| `sidebar.panellist` 入口 | 未注册；`main` 页面目前没有入口选中 `alm-probe` key |
| Client 文案本地化 | 仅 `meta` 标题/描述中英双语，页面正文为英文硬编码 |
| Config 校验失败路径 | spike 未声明 `Config`，未验证非法 config 的加载失败行为 |
| 宿主版本兼容矩阵 | 只测 44.7.0；升级宿主需重跑本记录 |

## 5. 对后续任务的输入

- ALM-03.01 可直接在 `dsh-plugin-alm-core` 上扩展：服务名 `almCore`、工具前缀 `alm_`、原始 `ToolDefinition` 写法。
- 两个业务插件（需求/架构）可各用一条 bundle 行，通过 `almCore` 共享状态；UI 用 `main` + `sidebar.panellist`，`settings.section` 只放配置/诊断页。
- 禁用/启用已验证会成对回收工具与 slot；发布前仍需补 Config 与真实页面截图。
