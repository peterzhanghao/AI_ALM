# @ai-alm/dsh-plugin-alm-core（ALM-01.02 spike）

用于验证 DeepSeek Harness 44.7.0 的插件能力，不是最终业务插件。验证项：

| 能力 | 证据 |
|---|---|
| Bundle 安装/禁用/卸载 | `plugin_manager` 的 `application` 与插件行状态 |
| Host Service 注册 | 服务 `almCore`，`alm_probe` 返回真实运行数据 |
| 插件间 Service 依赖 | 第二行 `alm-core-consumer` 注入 `almCore`，提供 `alm_probe_consumer` |
| Tool 注册 | `Tool.listTools` 出现两个工具及其 schema |
| Client slot 注册 | `main`（key `alm-probe`）与 `settings.section`（id `alm-probe`） |
| 错误恢复 | 非法 config 时插件失败但不影响宿主；禁用后工具与页面消失 |

## 安装

```powershell
# 由 DSH 会话中的 plugin_manager 执行（需 Full access）
# install_bundle target = 本目录绝对路径
```

本包依赖 DSH 自带的 `@deepseek-ai/cordis` 与 `@deepseek-ai/dsh-tools`，不声明额外依赖。

## 验证

```powershell
# 工具 schema（Host 检查）
# cordis_inspect_query → host / Tool / listTools
# slot 占用（Client 检查）
# cordis_inspect_query → client / Slots / listSubTree root=main
```

## 已知限制

- Client 页面文本未接入 locale 服务，仅 meta 标题/描述本地化。
- 未注册 `sidebar.panellist` 入口，`main` 页面需由后续业务插件选择 key 后展示。
- 这是 spike：不承载 ALM 领域逻辑，业务实现见 ALM-03.01。
