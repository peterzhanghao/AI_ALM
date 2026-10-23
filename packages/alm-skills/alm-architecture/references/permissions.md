# 权限边界

<!-- alm-tools: alm_index alm_query alm_show alm_check alm_workspace_guard -->

## 允许

| 动作 | 条件 | 使用的工具/命令 |
|---|---|---|
| 读取架构资产、依赖与影响闭包 | 仓库可读 | `alm_index`、`alm_query`、`alm_show` |
| 跑门禁、读 `REN-001`/`REL-002` findings | 只读 | `alm_check` |
| 校验待写路径 | 活动 `change` 存在 | `alm_workspace_guard`、`alm workspace guard` |
| 修改架构/ADR/风险 | 路径在 `architecture/`、`adr/`、`risks/` 内 | 文件写入 |
| 生成证据 | 写入 `.alm/evidence/` | `alm check --out` |

## 拒绝

| 动作 | 处理 |
|---|---|
| 批准或否决 ADR | 转人工评审；技能只产出候选决策 |
| 发布、移动发布指针 | 转人工；属于发布技能范围 |
| 修改 `pack.json`、CI、分支保护 | 拒绝 |
| 改 `requirements/`、`tests/` | 交给 `alm-requirements`；跨资产变更走同一 ChangeSet 的变更流程 |
| 写白名单外路径 | `workspace guard` 返回 `denied`，停止 |

## 白名单

`architecture/`、`adr/`、`risks/`。绝对路径、含 `..` 的路径、其他目录一律拒绝。

## 身份

- 人工审批记录 `kind=human`，绑定 `headSha`；Agent 不能自批。
- ADR 的 `status: accepted` 表示评审结论，不等于 Agent 可以自行批准；由人决定。
