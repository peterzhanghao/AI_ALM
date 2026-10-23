# SDoc 子集与需求资产参考

> 以 `packages/alm-core/src/parse/sdoc.mjs` 与 `src/model/asset.mjs` 为准；本文只是可执行摘要。

## 1. 词法

| 行形式 | 含义 |
|---|---|
| `[DOCUMENT]`、`[SECTION]` | 文档/章节节点，不产生资产 |
| `[REQUIREMENT]` | 开始一条资产，直到下一个节点 |
| `[RELATION]` | 附属于当前 `[REQUIREMENT]`，由 `Type`/`Value` 两行组成 |
| `KEY: value` | 字段行；`KEY` 首字母大写，冒号后一个空格 |
| `# ...` | 整行注释 |
| 空行/缩进 | 忽略 |

节点名只接受大写字母、数字、`_`、`-`，且必须是 `[DOCUMENT]`/`[SECTION]`/`[REQUIREMENT]`/`[RELATION]` 之一；其他节点报 `FMT-001`。

## 2. 字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `UID` | 是 | 资产 ID，同时决定类型：`REQ-*` → requirement，`TEST-*` → acceptance-test |
| `TITLE` | 是 | 一句话结论；进 `alm index`/`show` 输出 |
| `STATUS` | 否 | 缺省 `proposed`；允许值见第 4 节 |
| `OWNER` | 是 | 团队标识，如 `team-payments` |

解析器只读取以上四个键。`PRIORITY`、`TAGS`、`DESCRIPTION` 等键**不会**进入资产模型；需要说明的正文写进 `TITLE` 或同目录 Markdown，不要假设门禁能读到。

## 3. ID 规则

```text
^(REQ|ADR|MOD|IF|DM|TEST|RISK)-[A-Z0-9]+(-[A-Z0-9]+)*$
```

| 合法 | 非法 | 规则 |
|---|---|---|
| `REQ-PAY-001` | `REQ-pay-001` | 只允许大写 |
| `TEST-PAY-001` | `TEST_PAY_001` | 分隔符是 `-` |
| `REQ-PAY-001` | `REQ-PAY-01A`（若类型前缀不符）| 前缀必须与类型一致（`ID-002`） |

## 4. 状态机

```text
proposed → accepted | deprecated | superseded
accepted → deprecated | superseded
deprecated → （终态）
superseded → （终态）
```

`STATE-001` 只在带 `--base` 时比较；没有基线时记 `skip`。

## 5. 关系矩阵

| Type | source 类型 | target 类型 | 示例 |
|---|---|---|---|
| `satisfies` | requirement | requirement | `REQ-PAY-001 satisfies REQ-PAY-000` |
| `allocated_to` | requirement | module | `REQ-PAY-001 → MOD-PAY-REFUND` |
| `depends_on` | module / interface / data-model | module / interface | `IF-PAY-REFUND-API → MOD-PAY-REFUND` |
| `constrained_by` | 非 architecture-decision | architecture-decision | `MOD-PAY-REFUND → ADR-PAY-003` |
| `verified_by` | requirement | acceptance-test | `REQ-PAY-001 → TEST-PAY-001` |
| `supersedes` | 任意同类型 | 同类型 | `ADR-PAY-004 → ADR-PAY-003` |

写错方向或类型 → `REL-002`；目标 ID 不存在 → `REL-001`。

## 6. 完整正例

`requirements/refund.sdoc`：

```text
[DOCUMENT]
TITLE: 订单退款

[SECTION]
TITLE: 部分退款

[REQUIREMENT]
UID: REQ-PAY-001
TITLE: 支持订单部分退款
STATUS: proposed
OWNER: team-payments

[RELATION]
Type: satisfies
Value: REQ-PAY-000

[RELATION]
Type: allocated_to
Value: MOD-PAY-REFUND

[RELATION]
Type: constrained_by
Value: ADR-PAY-003

[RELATION]
Type: verified_by
Value: TEST-PAY-001
```

`tests/refund.sdoc`：

```text
[DOCUMENT]
TITLE: 部分退款验收

[REQUIREMENT]
UID: TEST-PAY-001
TITLE: 部分退款金额与订单状态一致
STATUS: proposed
OWNER: team-qa
```

## 7. 负例与预期规则

| 写法 | 规则 |
|---|---|
| `[REQUIREMENT]` 下没有 `UID` | `FMT-001` |
| `[RELATION]` 只有 `Type` 没有 `Value` | `FMT-001` |
| `[ACCEPTANCE]` 等自造节点 | `FMT-001` |
| `UID: req-pay-001` | `FMT-002` |
| 两条不同文件使用同一 `UID` | `ID-001` |
| `Type: verified_by` 指向 `MOD-PAY-REFUND` | `REL-002` |
| `Type: verified_by` 指向不存在的 `TEST-PAY-999` | `REL-001` |
| 需求没有任何 `verified_by` | `COV-001`（block） |
| 用例没有被任何需求引用 | `COV-002`（warn） |

## 8. 命令选项

| 命令 | 常用选项 |
|---|---|
| `alm index` | `--root`、`--json` |
| `alm check` | `--root`、`--base`、`--pr`、`--out`、`--json` |
| `alm query` | `--root`、`--type`、`--status`、`--owner`、`--json` |
| `alm show` | `<ID>`、`--root`、`--json` |
| `alm trace` | `<ID>`、`--root`、`--json` |
| `alm impact` | `--asset <ID>`、`--root`、`--json` |
| `alm workspace guard` | `--root`、`--change`、`--path`（可重复）、`--json` |
