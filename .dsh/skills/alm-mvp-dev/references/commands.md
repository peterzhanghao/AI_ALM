# `alm` 命令面

> 本文件是命令状态的唯一清单；`scripts/check-alm-skill.mjs` 只校验「已实现」段的命令在 `alm --help` 中存在。

## 已实现（`alm --help` 可验证）

| 命令 | 参数 | 退出码 | 说明 |
|---|---|---|---|
| `alm --help` | — | 0 | 列出命令与退出码约定 |
| `alm --version` | — | 0 | 输出包版本 |
| `alm index` | `--root <dir>` `--json` | 0 成功 / 1 有解析错误 / 2 用法错误 | 输出资产索引 `alm.index/v1` |
| `alm check` | `--root <dir>` `--base <ref>` `--out <file>` `--json` | 0 通过 / 1 门禁失败 / 2 用法错误 | 运行 R1；`--out` 写 `alm.evidence/v1` |
| `alm show <ID>` | `--root <dir>` `--json` | 0 找到 / 1 不存在 / 2 用法错误 | 单个资产详情 `alm.show/v1` |
| `alm query` | `--root <dir>` `[--type]` `[--status]` `[--owner]` `--json` | 0 成功 / 2 用法错误 | 资产列表 `alm.query/v1` |
| `alm baseline create` | `--root <dir>` `--commit <sha>` `--tag <name>` `--approval <file>` `[--id <id>]` `[--out <dir>]` `--json` | 0 成功/幂等 / 1 同 id 内容冲突 / 2 用法错误 | 生成不可变基线清单 |
| `alm baseline verify` | `--root <dir>` `--manifest <file>` `--json` | 0 一致 / 1 有差异 / 2 用法错误 | 从 commit 重算哈希并比对 |
| `alm contract verify` | `--json` | 0 全部有效 / 1 缺失或 `$id` 不符 | 校验五类契约文件 |

## 计划中（未实现，不得作为验收依据）

| 命令 | 计划卡片 | 说明 |
|---|---|---|
| `alm diff` | ALM-02.04 | 结构化差异 `alm.diff/v1` |
| `alm impact` | ALM-02.04 | 影响闭包 |
| `alm trace` | ALM-02.04 | 需求追踪链 |
| `alm evidence show` | ALM-03.01 | 读取门禁证据 |
| `alm approval record` | ALM-04.01 | 记录绑定 SHA 的人工审批 |
| `alm approval verify` | ALM-04.01 | 校验审批是否满足当前 head |
| `alm workspace create/status` | ALM-03.04 | 变更工作区与写权限边界 |

## 退出码

| 码 | 含义 |
|---|---|
| 0 | 通过 |
| 1 | 门禁/校验失败（可诊断，输出资产与文件定位） |
| 2 | 用法错误（未知命令、参数缺失） |
| 3 | 内部错误（异常、未捕获） |

## JSON 输出约定

所有 `--json` 输出以 `{"schema":"alm.<area>/v1",...}` 开头；字段一旦发布只增不改，破坏性变更升 `v2` 并同步契约与技能。
