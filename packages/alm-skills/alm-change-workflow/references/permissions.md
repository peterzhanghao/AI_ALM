# 权限边界

<!-- alm-tools: alm_index alm_query alm_show alm_check alm_workspace_create alm_workspace_status alm_workspace_guard -->

## 允许

| 动作 | 条件 |
|---|---|
| 读取资产、索引、差异、影响 | 仓库可读 |
| 创建变更分支与记录 | 工作树干净、变更 ID 合法 |
| 修改资产 | 活动 change 存在，路径在白名单 |
| 运行门禁 | 只读；可带 `--out` 写证据 |
| 生成证据 | 写入 `.alm/evidence/` |

## 拒绝

| 动作 | 处理 |
|---|---|
| 审批/拒绝变更 | 转人工；技能不提供该能力 |
| 发布、移动发布指针 | 转人工；需要审批记录 |
| 修改规则包、CI、分支保护 | 拒绝；属于治理动作 |
| 写白名单外路径 | `guard` 返回 violations，停止 |
| 写入已发布基线 | 拒绝；必须从基线派生新分支 |

## 白名单

`requirements/`、`architecture/`、`adr/`、`tests/`、`risks/`。

绝对路径、包含 `..` 的路径、其他目录一律拒绝；需要扩大范围时由人修改策略。

## 身份

- 人工审批记录 `kind=human`，绑定 `headSha`。
- Agent 的提交与工具调用必须可追溯到会话；技能不替代审批。
