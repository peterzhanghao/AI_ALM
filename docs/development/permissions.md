# 权限模型

> 适用：AI Native ALM MVP（`packages/alm-core` 0.1.0、两个 DSH 插件、产品技能）。
> 原则：**权限由代码与门禁判定，不靠提示词**；技能只描述边界。

## 1. 主体

| 主体 | 标识 | 能做什么 |
|---|---|---|
| 人 | `human:<login>` | 审批、发布、回滚、合并、改规则；对交付负责 |
| Agent | 会话内工具调用 / `Alm-Agent: agent:<name>` 提交尾注 | 只读查询、在工作区内改资产、跑门禁与演练、准备发布产物 |
| CI | 规则包复跑 | 只写 `.alm/ci/<sha>/<pack>.json`，不复用客户端结论 |

## 2. 能力矩阵

| 能力 | 人 | Agent | 判定点 |
|---|---|---|---|
| 读取索引/资产/差异/影响 | ✅ | ✅ | `alm index/show/query/diff/impact/trace`、`alm_*` 只读工具 |
| 建变更工作区 | ✅ | ✅（工作树干净时） | `alm workspace create`、`alm_workspace_create` |
| 改资产 | ✅ | ✅ 仅白名单目录 | `alm workspace guard`、`alm_workspace_guard` |
| 跑门禁/写证据 | ✅ | ✅ | `alm check --out` |
| 记录审批 | ✅ 仅 `human:<login>` | ❌ | `approval record` 校验 actor 正则 |
| 合并 | ✅ | ❌ | `pr merge` 需审批 + 必需检查；`APPROVAL-001/002` |
| 建基线 | ✅ | ⚠️ 需人工审批文件 | `baseline create --approval` 校验 `kind=human`、`headSha` |
| 发布 / 回滚 | ✅ | ⚠️ 仅执行人已确认的目标 | `release publish/rollback` 写一次、先校验后移指针 |
| 改规则包 / CI / 分支保护 | ✅（走 PR） | ❌ | 不在任何工具或技能范围内 |

**不存在**审批、发布、改规则的 Agent 工具：插件只注册 7 个 `alm_*` 工具（index/check/show/query/workspace create/status/guard）。

## 3. 目录白名单

```text
允许写入：requirements/  architecture/  adr/  tests/  risks/
拒绝：docs/、根文件、.alm/ 规则与发布存储、绝对路径、包含 .. 的路径
```

- 白名单在 `packages/alm-core/src/workspace/workspace.mjs` 的 `guardWrite` 中实现，插件工具只是调用它。
- 拒绝时返回 `violations[]` 且退出码 1；技能必须停止，不得改路径“绕过去”。

## 4. 审批与发布职责分离

1. 人用 `approval record --sha <head> --actor human:<login>` 写 `.alm/approvals/<sha>.json`。
2. `APPROVAL-001` 要求当前 head 存在 `kind=human` + `decision=approve`；`APPROVAL-002` 通过提交尾注识别 `agent` 自批。
3. `baseline create` 读取单条审批记录，`headSha` 必须等于基线 commit。
4. `release publish` 只接受 `alm.baseline/v1` 清单且重建校验通过；写入后不可覆盖。
5. `release rollback` 先对目标 `release verify`，失败不移动 `current.json`。

Agent 可以准备上述命令与产物，但**不能产生审批记录**，也不能替人决定发布目标。

## 5. 被拒时的行为

| 场景 | 返回 | 技能/Agent 应做 |
|---|---|---|
| 路径不在白名单 | `denied <path>`，退出 1 | 停手，向人说明需要扩大范围 |
| 工作树不干净时建工作区 | `worktree must be clean`，退出 1 | 先处理未提交改动，不强切分支 |
| 无活动变更写资产 | `no active change workspace`，退出 1 | 先建工作区 |
| 审批 actor 非 human | `actor must be human:<login>`，退出 1 | 转人工，不伪造 |
| 审批 SHA 不匹配 | `approval: headSha does not match` | 重新由人对当前 head 审批 |
| 发布已存在且内容不同 | `release: ... already published with different content`，退出 1 | 换新基线 ID，不删旧目录 |
| 回滚目标未通过校验 | `release: <id> failed verification`，退出 1 | 选另一条通过校验的基线 |

## 6. 可执行的检查

```powershell
node packages/alm-core/bin/alm.mjs workspace guard --change CHG-X --path docs/x.md   # 期望退出 1
node --test packages/alm-core/test/integration/approval-merge.test.mjs               # 自批/SHA 失效
node --test packages/alm-core/test/integration/release.test.mjs                      # 写一次/回滚
node scripts/check-alm-skill.mjs                                                     # 技能声明的工具必须已注册
```

`scripts/check-alm-skill.mjs` 会比对技能里的 `<!-- alm-tools: ... -->` 与插件注册表：技能声称拥有未知工具（如 `alm_publish`）即失败。
