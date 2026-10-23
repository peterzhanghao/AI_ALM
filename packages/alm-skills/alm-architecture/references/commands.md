# 架构技能常用命令

> 命令状态以 `alm --help` 为准；本技能只声明其中已实现的部分。

## 使用中的命令

| 命令 | 用途 |
|---|---|
| `alm index` | 列出七类资产与关系，依赖图的唯一事实源 |
| `alm query` | 按类型（module/interface/data-model/architecture-decision）过滤 |
| `alm show` | 单条资产的关系与源位置 |
| `alm impact` | 反向影响闭包，含深度、路径与环 |
| `alm trace` | 前向链：需求 → 模块 → 接口 |
| `alm check` | 跑 R1 门禁（含 `REN-001`、`REL-002`、`SEC-001`） |
| `alm workspace guard` | 写入前校验 `architecture/`、`adr/`、`risks/` 白名单 |

## 常用参数

| 参数 | 用于 |
|---|---|
| `--root <dir>` | 仓库根 |
| `--type module\|interface\|data-model\|architecture-decision\|risk` | 类型过滤 |
| `--asset <ID>` | `impact` 的起点资产 |
| `--base <ref>` | 门禁基线（启用 `STATE-001`） |
| `--out <file>` | 写 `alm.evidence/v1` |
| `--json` | 机器可读输出 |

## 退出码

`0` 通过 · `1` 门禁或查找失败 · `2` 用法错误 · `3` 内部错误。

`impact`/`trace` 输出里 `cycles[]` 非空时，汇报必须标注环，不得静默忽略。
