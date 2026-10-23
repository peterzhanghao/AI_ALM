# 中断、重试与恢复

> 目标：任何中断都不产生“半份正式基线”，重试只补完缺失步骤，不覆盖已有结论。

## 1. 中断后先看状态

```powershell
alm ci status --sha <sha> --root . --json
alm baseline verify --manifest .alm/baselines/<BL>.json --root . --json
alm release verify --baseline <BL> --root . --json
```

- `ci status`：`ok=false` 且 `reason` 为“无记录”才需要重跑；已有 `runId` 说明记录完整。
- 发布目录里只有 `baseline.json`、没有 `release.json` → 发布在写 bundle 阶段被中断：重跑 `release publish`，它会重建归档并补写记录。
- 已有 `release.json` → 用 `release verify` 判断完整性，不要手工补文件。

## 2. 重试规则

| 中断点 | 重试命令 | 判定 |
|---|---|---|
| `check --out` 前 | 原命令 | 证据文件不存在或 runId 不同 |
| `baseline create` 前 | 原命令 | 同 ID 同内容返回 `unchanged` |
| `release publish` 中 | 原命令 | 返回 `published`/`unchanged`，且 `bundleSha256` 一致 |
| `release rollback` 后 | `release verify` | 指针已移动且目标校验通过 |

同一 baseline ID 内容不同时命令会拒绝（写一次），此时必须换 ID，不能删除旧目录“重来”。

## 3. 重复回调

- `alm ci run` 对同 commit、同规则包重复调用返回 `unchanged`，只保留 `.alm/ci/<sha>/<pack>.json` 一份。
- `alm ci record` 重复投递同一份客户端证据：服务端复跑后比对，仍只写服务端记录。
- 客户端伪造 `result=pass`：服务端复跑结果不同即拒绝，退出 1。

## 4. 发布失败不留半成品

1. 失败后不要删除目录，也不要手写 `release.json`。
2. 用 `release verify --baseline <BL>` 确认失败原因（`mismatches[]` 指向具体文件）。
3. 修复源 commit 或换新 ID 重新 `baseline create` → `release publish`。
4. 旧发布目录保留用于审计；`current.json` 仍是上一次成功发布的值。

## 5. 回滚与重建

```powershell
alm release verify --baseline <旧BL> --root . --json
alm release rollback --to <旧BL> --root . --json
alm release verify --baseline <旧BL> --root . --json
```

- 回滚前必须 verify 通过；失败时 `current.json` 不变。
- 回滚只移动指针并记录 `previous`；历史归档与基线清单不删除。
- 重建旧基线 = `baseline verify` + `release verify` 同时通过；两者任一 mismatch 都不算恢复完成。

## 6. 故障注入自检（不改仓库内容）

```powershell
Copy-Item .alm/published/<BL>/bundle.tar .alm/published/<BL>/bundle.tar.bak
Add-Content .alm/published/<BL>/bundle.tar 'tampered'
alm release verify --baseline <BL> --root . --json   # 期望退出 1，列出 bundle.tar
Move-Item .alm/published/<BL>/bundle.tar.bak .alm/published/<BL>/bundle.tar -Force
alm release verify --baseline <BL> --root . --json   # 期望退出 0
```

- 期望：篡改后 `mismatches[]` 含 `bundle.tar`；恢复后重新通过。
- 若恢复后仍失败，说明同时改动了 `release.json` 或基线清单；用 `baseline verify` 定位。

## 7. 记录

恢复完成后在汇报里写：中断步骤、重试命令、退出码、`runId`、`contentHash`、`bundleSha256`、`current.json` 的 `previous`。不要只写“已恢复”。
