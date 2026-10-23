---
name: alm-release-verify
description: "校验与发布 ALM 基线：门禁证据、幂等 CI 记录、不可变基线、发布存储、回滚与重建。用户要核对发布包、重跑必需检查、发布/回滚基线或排查哈希不一致时使用。"
whenToUse: "已有通过门禁的 commit 与人工审批记录，需要生成或核对基线、重跑 CI、发布到写一次存储、回滚或重建时。"
metadata:
  version: "0.1.0"
  owner: "peterzhanghao"
  repo: "peterzhanghao/AI_ALM"
  updated: "2026-10-23"
---

# ALM 发布校验

## 0. 边界

- 默认只读：核对 `alm --help` 里已实现的校验命令，输出哈希与差异。
- 写操作只有四类，且必须由人确认后执行：`alm check --out`、`alm ci run`、`alm baseline create`、`alm release publish|rollback`。
- 不批准、不合并、不改门禁规则、不手改 `.alm/published/` 与 `.alm/baselines/`。
- 命令参数见 [`references/commands.md`](references/commands.md)，权限见 [`references/permissions.md`](references/permissions.md)，故障恢复见 [`references/recovery.md`](references/recovery.md)。

## 1. 发布前链路

按顺序执行，任一步失败就停下，不跳步：

| 步骤 | 命令 | 期望 |
|---|---|---|
| 1. 契约 | `alm contract verify` | 退出 0，五类契约 `$id` 与文件一致 |
| 2. 门禁 | `alm check --base <ref>` | `result=pass`，退出 0 |
| 3. 证据 | `alm check --base <ref> --out .alm/evidence/<change>.json` | 写出 `alm.evidence/v1` |
| 4. 基线 | `alm baseline create --commit <sha> --tag <tag> --approval <file> --id <BL-...>` | `status=created`（重复同内容为 `unchanged`） |
| 5. 发布 | `alm release publish --manifest .alm/baselines/<BL>.json` | `status=published`，`bundleSha256` 固定 |
| 6. 核对 | `alm release verify --baseline <BL>` | 退出 0，`mismatches` 为空 |

- `--approval` 文件是单条 `alm.approval/v1` 记录，`kind=human`、`decision=approve`、`headSha` 必须等于基线 commit。
- 基线 ID 缺省为 `BL-<YYYYMMDD>-<sha12>`；显式 `--id` 便于在汇报里引用。
- 基线内容只来自 `git show <commit>:<path>`，时间戳不进入 `contentHash`。

## 2. 幂等与写一次

| 场景 | 行为 | 处理 |
|---|---|---|
| 同 commit 同规则包重复 `alm ci run` | 返回 `unchanged`，只保留一份记录 | 正常，继续 |
| 同 ID 同内容再 `alm baseline create` | 返回 `unchanged` | 正常，继续 |
| 同 ID 不同内容 `alm baseline create` | 退出 1，旧文件不被覆盖 | 换 ID 或查明内容差异 |
| 同 ID 同内容重复 `alm release publish` | 返回 `unchanged` | 正常，继续 |
| 同 ID 不同内容 `alm release publish` | 退出 1，保留旧发布记录 | 禁止覆盖；新版本用新 ID |
| `alm ci record` 收到客户端证据 | 服务端复跑同规则包后比对，只存服务端结论 | 客户端 `result` 与复跑不一致即拒绝 |

`alm ci status --sha <ref>` 是“必需检查是否满足”的唯一判据：没有记录、包版本不匹配或 `result != pass` 都返回退出 1。

## 3. 回滚与重建

```powershell
alm release rollback --to <旧 BL-ID> --out .alm/published --json
alm release verify --baseline <旧 BL-ID> --out .alm/published --json
```

- `rollback` 先对目标执行完整 `release verify`，失败则不移动 `current.json`。
- 指针记录 `previous`，历史基线与归档文件都不删除；回滚不是“重新发布”。
- 重建验证 = `release verify`：重新 `git archive` 目标 commit、比对存储归档、再校验基线清单，三者都必须一致。

## 4. 失败诊断

| 现象 | 原因 | 处理 |
|---|---|---|
| `release: <BL> not published` | 发布目录没有该 ID | 先 `release publish`，不要手写 `release.json` |
| `release: baseline verification failed` | 基线清单与 commit 不一致 | 用 `alm baseline verify --manifest` 定位 mismatch |
| `mismatch bundle.tar ...` | 存储归档被改动 | 从基线重新发布；不要改哈希字段 |
| `mismatch bundle.tar(rebuild)` | 源码 commit 被改写或不在仓库 | 确认 commit 存在且未被 force-push |
| `mismatch (contentHash)` | 清单被手改 | 重建基线，保留旧清单用于审计 |
| `release: <BL> failed verification`（rollback） | 目标基线已损坏 | 选另一条通过校验的基线 |
| `ci: evidence pack ... != ...` | 证据与当前规则包版本不同 | 用当前规则包重跑 `alm ci run` |
| `ci: evidence head does not match ...` | 证据不是当前检出 commit | 切回对应 commit 或重新生成证据 |

## 5. 汇报

必须包含：基线 ID、`sourceCommit`、`contentHash`、`bundleSha256`、`runId`、每步退出码、`mismatches`（若有）、`current.json` 的 `baselineId/previous`。不得用“已验证”代替这些值。

## 6. 完成自检

- [ ] 链路六步都有退出码，没有跳步或手改产物。
- [ ] `alm ci status` 为 `ok`，`runId` 与基线记录一致。
- [ ] `contentHash` 与 `bundleSha256` 已写入汇报。
- [ ] 回滚后 `current.json` 指向目标且 `previous` 可追溯。
- [ ] 没有批准、合并不属于自己的变更，也没有覆盖已发布的基线。
