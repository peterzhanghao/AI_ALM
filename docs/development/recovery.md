# 发布与恢复操作手册

> 适用于 `alm` 本地发布存储（`.alm/published/`）。平台发布（Gitea/GitHub）接入后，步骤不变，只替换存储与审批来源。

## 正式基线的判定

一个基线是“正式”的，必须同时满足：

1. `.alm/published/<baselineId>/release.json` 存在；
2. `alm release verify --baseline <id>` 通过（重建归档、存储 tar、清单哈希一致）；
3. 对应审批记录绑定 `sourceCommit`（`alm approval verify --sha <commit>` 通过）。

只有目录、没有 `release.json` 的，视为**未完成**，可在重试时补齐，不会被当作正式基线。

## 中断与重试

发布中断后：

```powershell
alm release verify --baseline <id>          # 预期：not published
alm release publish --manifest <baseline.json 路径>
alm release verify --baseline <id>          # 预期：ok
```

publish 是幂等的：同 id 同内容返回 `unchanged`，不会生成第二份。

## 重复回调

`alm ci record` / `alm ci run` 以 head SHA + 规则包版本为幂等键；重复调用返回 `unchanged`，不产生第二份检查记录。若同一 SHA 出现不同内容，拒绝并保留原记录。

## 回滚

```powershell
alm release verify --baseline <target>
alm release rollback --to <target>
```

- 回滚只改 `current.json` 指针，不修改任何基线内容。
- `previous` 记录上一指针，便于审计。
- 目标未发布或校验失败时拒绝回滚。

## 旧基线重建

```powershell
alm release verify --baseline <old-id>
```

verify 会从 `sourceCommit` 重新 `git archive` 并逐项比对；任何字节差异都会列出。

## 审计与日志

| 事实 | 位置 |
|---|---|
| 审批 | `.alm/approvals/<sha>.json` |
| CI 证据 | `.alm/ci/<sha>/<pack>.json` |
| 基线清单 | `.alm/baselines/<id>.json` |
| 发布记录 | `.alm/published/<id>/release.json` |
| 当前指针 | `.alm/published/current.json` |

不要手工编辑上述文件；恢复操作只通过命令完成。
