# 权限边界

<!-- alm-tools: alm_check -->

## 允许

| 动作 | 条件 |
|---|---|
| 读取证据、基线、发布记录 | 仓库可读 |
| 跑门禁与契约校验 | 只读 |
| 写门禁证据 | 写入 `.alm/evidence/` |
| 生成基线 | 人工审批记录已存在且 `headSha` 匹配 |
| 发布 / 回滚 | 人已确认目标基线；只在 `.alm/published/` 内操作 |

## 拒绝

| 动作 | 处理 |
|---|---|
| 批准或代签审批记录 | 拒绝；`kind` 必须是 `human`，Agent 不能自批 |
| 合并 PR | 转人工；合并属于 SCM 流程 |
| 改规则包 / CI / 分支保护 | 拒绝 |
| 覆盖已发布基线或改写 `release.json` | 拒绝；写一次语义不可绕过 |
| 手改 `.alm/baselines/`、`.alm/published/`、`.alm/ci/` 内容 | 拒绝；用命令重建 |
| 删除历史基线 | 拒绝；回滚只移动指针 |

## 身份

- 审批记录：`schema=alm.approval/v1`、`kind=human`、`decision=approve`、`headSha` 绑定 commit。
- Agent 可以准备清单与命令，但发布/回滚必须由人确认后执行；技能不替代审批。
