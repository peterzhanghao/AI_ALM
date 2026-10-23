# 发布校验命令

> 命令状态以 `alm --help` 为准；本技能只声明其中已实现的部分。

## 使用中的命令

| 命令 | 用途 |
|---|---|
| `alm contract verify` | 校验五类契约文件与 `$id` |
| `alm check` | 跑 R1 门禁；`--out` 写 `alm.evidence/v1` |
| `alm ci run` | 服务端复跑同规则包并落幂等记录 |
| `alm ci record` | 收到客户端证据后复跑比对，只存服务端结论 |
| `alm ci status` | 判定必需检查是否满足 |
| `alm baseline create` | 从 commit 生成不可变基线清单 |
| `alm baseline verify` | 重算文件哈希并与清单比对 |
| `alm release publish` | 把已验证基线写入只写一次的发布存储 |
| `alm release verify` | 重建归档、比对存储归档、再校验清单 |
| `alm release rollback` | 校验目标后移动当前发布指针 |

## 常用参数

| 参数 | 用于 |
|---|---|
| `--root <dir>` | 仓库根（默认当前目录） |
| `--base <ref>` | 门禁/CI 基线 ref |
| `--out <path>` | `check` 写证据；`baseline`/`release` 指定存储目录 |
| `--evidence <file>` | `ci record` 的客户端证据路径 |
| `--sha <ref>` | `ci status` 的目标 commit |
| `--commit <sha>` / `--tag <tag>` | `baseline create` 的源 commit 与标签 |
| `--approval <file>` | 人工审批记录（`alm.approval/v1`） |
| `--id <BL-...>` | 显式基线 ID |
| `--manifest <file>` | 基线清单路径（publish 必需） |
| `--baseline <BL-ID>` | 发布存储中的基线 |
| `--to <BL-ID>` | 回滚目标 |
| `--json` | 机器可读输出 |

## 输出与退出码

- 退出码：`0` 成功 · `1` 校验失败/被拒 · `2` 用法错误 · `3` 内部错误。
- 关键字段：`sourceCommit`、`contentHash`、`bundleSha256`、`runId`、`mismatches[]`、`status`（`created`/`unchanged`/`published`/`recorded`）。
- 写一次与幂等语义见技能正文第 2 节；不要手工修改 `.alm/` 下的产物来“修好”校验。
