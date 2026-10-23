# @ai-alm/dsh-plugin-architecture

架构领域插件（ALM-03.03）：模块、ADR、接口、数据模型的目录、依赖边与影响视图。

| 项 | 内容 |
|---|---|
| 路由 | `GET /api/alm/architecture` → `alm.architecture/v1` |
| 工具 | `alm_architecture [root]` |
| 页面 | Settings → Architecture；`main` 面板 key `architecture` |
| 数据 | `alm-core` index + check + 反向闭包；缺口取 REL-001/REL-002 |

页面包含节点表（含 impact 计数）、依赖边、按资产的反向影响查询、关系缺口。影响计算在浏览器内用同一份 `edges` 完成，不额外请求。

## 约束

- 工作区链接安装不能 `import` `@deepseek-ai/*`。
- 默认根目录 `fixtures/order-refund`，可用 bundle 配置 `root` 覆盖。
- 页面正文英文，标题/描述已本地化；未注册侧栏入口。

## 验证

```powershell
node --test "packages/dsh-plugin-architecture/test/**/*.test.mjs"
# 安装后：alm_architecture、/api/alm/architecture、Slots root=main 含 architecture
```
