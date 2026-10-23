# 权限边界

<!-- alm-tools: alm_index alm_query alm_show alm_check alm_workspace_guard -->

## 允许

| 动作 | 条件 | 使用的工具/命令 |
|---|---|---|
| 读取资产、索引、追踪链 | 仓库可读 | `alm_index`、`alm_query`、`alm_show` |
| 跑门禁、看 findings | 只读 | `alm_check` |
| 校验待写路径 | 活动 `change` 存在 | `alm_workspace_guard`、`alm workspace guard` |
| 修改需求/用例 | 路径在 `requirements/`、`tests/` 内 | 文件写入 |
| 生成证据 | 写入 `.alm/evidence/` | `alm_check --out` |

## 拒绝

| 动作 | 处理 |
|---|---|
| 批准/拒绝变更 | 转人工；技能不提供该能力，也没有对应工具 |
| 发布、移动发布指针 | 转人工；属于发布技能与人工确认范围 |
| 修改 `pack.json`、CI、分支保护 | 拒绝；规则不可由被检查者改写 |
| 写 `requirements/`、`tests/` 之外的路径 | `workspace guard` 返回 `denied`，停止 |
| 把 `skip`/`warn` 说成 `pass` | 拒绝；按实际 `result` 汇报 |

## 白名单

`requirements/`、`tests/`（本技能只改这两类；架构与 ADR 由 `alm-architecture` 负责）。

绝对路径、含 `..` 的路径、其他目录一律拒绝；需要扩大范围时由人改策略。

## 身份

- 人工审批记录 `kind=human`，绑定 `headSha`；Agent 不能自批。
- Agent 的提交与工具调用必须可追溯到会话；技能不替代审批。
