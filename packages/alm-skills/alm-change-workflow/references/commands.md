# 变更工作流命令

> 由 `alm-change-workflow` 引用；命令状态以 `packages/alm-core` 的 `alm --help` 为准。

## 使用中的命令

| 命令 | 用途 |
|---|---|
| `alm workspace status` | 当前分支、活动 change、dirty |
| `alm workspace create` | 从基线建变更分支与记录 |
| `alm workspace guard` | 写入前校验路径白名单 |
| `alm task draft` | 从需求生成五要素任务卡（`changes/<CHG>/`） |
| `alm check` | R1 门禁；`--out` 写证据 |
| `alm diff` | 基线到工作区的字段/关系差异 |
| `alm impact` | 受影响资产（反向闭包） |
| `alm trace` | 需求到实现/验收的前向链 |

## 常用参数

| 参数 | 用于 |
|---|---|
| `--root <dir>` | 指定仓库根（默认当前目录） |
| `--base <ref>` | 基线 commit/标签 |
| `--change <CHG-ID>` | 变更 ID |
| `--path <p>` | guard 的待写路径，可重复 |
| `--out <file>` | 证据文件路径 |
| `--json` | 机器可读输出 |

## 退出码

`0` 成功/通过 · `1` 门禁或校验失败 · `2` 用法错误 · `3` 内部错误。

失败时输出包含 `assetId`、`file`、`line`，按定位修复后重跑。
