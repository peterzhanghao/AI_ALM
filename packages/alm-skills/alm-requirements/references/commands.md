# 需求技能常用命令

> 命令状态以 `alm --help` 为准；本技能只声明其中已实现的部分。

## 使用中的命令

| 命令 | 用途 |
|---|---|
| `alm index` | 列出全部资产、类型与源文件行号 |
| `alm query` | 按类型/状态/Owner 过滤需求与用例 |
| `alm show` | 单条资产详情、关系与源位置 |
| `alm trace` | 需求 → 模块/用例的前向链 |
| `alm impact` | 改一条需求的反向影响闭包 |
| `alm check` | 跑 R1 门禁；`--base` 启用 `STATE-001`，`--out` 落证据 |
| `alm workspace guard` | 写入前校验路径是否在当前变更白名单内 |

## 常用参数

| 参数 | 用于 |
|---|---|
| `--root <dir>` | 指定仓库根（默认当前目录） |
| `--type requirement\|acceptance-test` | 只看某一类 |
| `--status proposed\|accepted\|deprecated\|superseded` | 状态过滤 |
| `--owner <team>` | Owner 过滤 |
| `--base <ref>` | 门禁基线，启用状态流转检查 |
| `--out <file>` | 写 `alm.evidence/v1` 证据 |
| `--json` | 机器可读输出 |

## 退出码

`0` 通过 · `1` 门禁/查找失败 · `2` 用法错误 · `3` 内部错误。

失败输出带 `file:line assetId`，先修最早的定位点再重跑。
