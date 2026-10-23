# `alm` 命令面

> 本文件是命令状态的唯一清单；`scripts/check-alm-skill.mjs` 只校验「已实现」段的命令在 `alm --help` 中存在。

## 已实现（`alm --help` 可验证）

| 命令 | 参数 | 退出码 | 说明 |
|---|---|---|---|
| `alm --help` | — | 0 | 列出命令与退出码约定 |
| `alm --version` | — | 0 | 输出包版本 |
| `alm index` | `--root <dir>` `--json` | 0 成功 / 1 有解析错误 / 2 用法错误 | 输出资产索引 `alm.index/v1` |
| `alm check` | `--root <dir>` `--base <ref>` `--out <file>` `--pr` `--json` | 0 通过 / 1 门禁失败 / 2 用法错误 | 运行 R1；`--pr` 启用审批规则；`--out` 写证据 |
| `alm show <ID>` | `--root <dir>` `--json` | 0 找到 / 1 不存在 / 2 用法错误 | 单个资产详情 `alm.show/v1` |
| `alm query` | `--root <dir>` `[--type]` `[--status]` `[--owner]` `--json` | 0 成功 / 2 用法错误 | 资产列表 `alm.query/v1` |
| `alm diff` | `--base <ref>` `[--head <ref>]` `--root <dir>` `--json` | 0 成功 / 2 用法错误 | 结构化差异 `alm.diff/v1` |
| `alm impact` | `--asset <ID>` `--root <dir>` `--json` | 0 成功 / 1 不存在 / 2 用法错误 | 反向影响闭包 `alm.impact/v1` |
| `alm trace <ID>` | `--root <dir>` `--json` | 0 成功 / 1 不存在 / 2 用法错误 | 前向追踪链 `alm.trace/v1` |
| `alm workspace create` | `--baseline <ref>` `--change <CHG-ID>` `--root <dir>` `--json` | 0 成功 / 1 冲突或非法 / 2 用法错误 | 建变更分支与记录 `alm.workspace.create/v1` |
| `alm workspace status` | `--root <dir>` `--json` | 0 成功 / 1 非 git / 2 用法错误 | 当前分支、活动 change、dirty |
| `alm workspace guard` | `--change <CHG-ID>` `--path <p>`（可重复）`--json` | 0 允许 / 1 拒绝 / 2 用法错误 | 写入白名单校验 |
| `alm approval record` | `--sha <sha>` `--actor human:<login>` `[--change]` `--root <dir>` `--json` | 0 记录 / 1 拒绝 / 2 用法错误 | 绑定 head SHA 的人工审批 |
| `alm approval verify` | `--sha <sha>` `--root <dir>` `--json` | 0 有效 / 1 无效 / 2 用法错误 | 校验审批与自批 |
| `alm pr status` | `--base <branch>` `--head <branch>` `--root <dir>` `--json` | 0 输出状态 / 2 用法错误 | head 必须已检出；输出可合并原因 |
| `alm pr merge` | `--base <branch>` `--head <branch>` `--root <dir>` `--json` | 0 合并 / 1 被拒 / 2 用法错误 | 审批 + 检查通过后本地合并 |
| `alm ci run` | `--base <ref>` `--root <dir>` `--json` | 0 成功 / 1 失败 | 服务端复跑并落幂等证据 |
| `alm ci record` | `--evidence <file>` `--root <dir>` `--json` | 0 接收 / 1 拒绝 | 与复跑结果比对后接收 |
| `alm ci status` | `--sha <ref>` `--root <dir>` `--json` | 0 通过 / 1 不通过 | 必需检查是否满足 |
| `alm baseline create` | `--root <dir>` `--commit <sha>` `--tag <name>` `--approval <file>` `[--id <id>]` `[--out <dir>]` `--json` | 0 成功/幂等 / 1 同 id 内容冲突 / 2 用法错误 | 生成不可变基线清单 |
| `alm baseline verify` | `--root <dir>` `--manifest <file>` `--json` | 0 一致 / 1 有差异 / 2 用法错误 | 从 commit 重算哈希并比对 |
| `alm contract verify` | `--json` | 0 全部有效 / 1 缺失或 `$id` 不符 | 校验五类契约文件 |

## 计划中（未实现，不得作为验收依据）

| 命令 | 计划卡片 | 说明 |
|---|---|---|
| `alm evidence show` | ALM-03.01 | 读取门禁证据 |

## 退出码

| 码 | 含义 |
|---|---|
| 0 | 通过 |
| 1 | 门禁/校验失败（可诊断，输出资产与文件定位） |
| 2 | 用法错误（未知命令、参数缺失） |
| 3 | 内部错误（异常、未捕获） |

## JSON 输出约定

所有 `--json` 输出以 `{"schema":"alm.<area>/v1",...}` 开头；字段一旦发布只增不改，破坏性变更升 `v2` 并同步契约与技能。
