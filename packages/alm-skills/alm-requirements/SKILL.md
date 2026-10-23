---
name: alm-requirements
description: "在 ALM 仓库编写与修复需求资产：SDoc 子集语法、必填字段、关系选择、验收用例、追踪缺口与门禁失败定位。用户要拆需求、补验收条件、查需求追踪缺口或修 REQ/TEST 门禁失败时使用。"
whenToUse: "仓库内已有 requirements/ 或 tests/ 资产（.sdoc，StrictDoc 子集），需要新增或修改需求、验收用例，并让 alm check 通过时。"
metadata:
  version: "0.1.0"
  owner: "peterzhanghao"
  repo: "peterzhanghao/AI_ALM"
  updated: "2026-10-23"
---

# ALM 需求资产

## 0. 边界

- 只处理**需求与验收资产**；架构与决策见 `alm-architecture`，变更流程见 `alm-change-workflow`。
- 只读默认；写入仅限当前工作区（`alm/<chg-id>` 分支）内的 `requirements/`、`tests/`。
- 不审批、不发布、不改门禁规则、不改 CI；不提交、不开 PR。
- 语法与关系全集见 [`references/syntax.md`](references/syntax.md)，命令见 [`references/commands.md`](references/commands.md)，权限见 [`references/permissions.md`](references/permissions.md)。

## 1. 文件与语法

需求放 `requirements/*.sdoc`，验收用例放 `tests/*.sdoc`。两者共用同一套 StrictDoc 子集：

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
Type: verified_by
Value: TEST-PAY-001
```

| 节点/字段 | 规则 |
|---|---|
| `[DOCUMENT]`、`[SECTION]` | 仅分组，不产生资产；`TITLE` 可选 |
| `[REQUIREMENT]` | 每个节点产出一条资产；`UID` 缺失 → `FMT-001` |
| `UID`、`TITLE`、`STATUS`、`OWNER` | 解析器只识别这四个字段；其他写法会被忽略，不要依赖 |
| `[RELATION]` + `Type`/`Value` | 必须成对出现；缺一个 → `FMT-001`；只允许六种 `Type` |
| 其他 `[NODE]` | 不支持，直接 `FMT-001`；不要发明 `[ACCEPTANCE]`、`[FIELD]` 等节点 |

- `UID` 前缀决定类型：`REQ-*` → requirement，`TEST-*` → acceptance-test。
- ID 形如 `REQ-PAY-001`：前缀 + 大写字母/数字段，用 `-` 分隔；`REQ-PAY-001a`、`req-pay-001` 都会 `FMT-002`。
- `STATUS` 缺省为 `proposed`；允许 `proposed`、`accepted`、`deprecated`、`superseded`，只能是这四个。
- `TITLE` 与 `OWNER` 必填（解析后校验）；`OWNER` 用团队标识，如 `team-payments`。
- 文件编码 UTF-8、LF；行首空格会被忽略，注释用 `#` 开头整行。

## 2. 关系选择

关系是**有方向的**，写在源资产里，`Value` 指向目标 ID：

| Type | 合法方向 | 用途 |
|---|---|---|
| `satisfies` | requirement → requirement | 子需求满足上级需求 |
| `allocated_to` | requirement → module | 需求分配到模块 |
| `depends_on` | module/interface/data-model → module/interface | 实现依赖 |
| `constrained_by` | 任意非 ADR → architecture-decision | 受决策约束 |
| `verified_by` | requirement → acceptance-test | 验收覆盖（`COV-001` 依赖它） |
| `supersedes` | 同类型 → 同类型 | 替代旧资产 |

- 方向反了（如 `module -> requirement` 写 `allocated_to`）→ `REL-002`。
- 目标不存在 → `REL-001`；不要用注释或占位 ID 绕过。
- 一条需求可以有多条 `verified_by`；一条用例也可被多条需求引用。

## 3. 验收写法

1. 在 `tests/` 下的 `.sdoc` 里建 `TEST-*` 资产，`UID` 必须以 `TEST-` 开头。
2. 在需求里加 `[RELATION] Type: verified_by Value: TEST-...`。
3. `TITLE` 写可判定的验收结论（金额、状态、幂等键），不写“功能正常”。
4. `COV-001` 要求每条 requirement 至少一条 `verified_by`；`COV-002`（warn）提示未被引用的用例。

## 4. 查看与追踪

```powershell
alm index --json
alm query --root . --type requirement --json
alm show REQ-PAY-001 --root . --json
alm trace REQ-PAY-001 --root . --json
alm impact --asset REQ-PAY-001 --root . --json
alm check --root . --base <baseline> --json
```

- 追踪缺口：`query` 出全部 requirement，逐个 `show` 看是否有 `verified_by`；插件需求页也直接给出缺口清单。
- `trace` 输出前向链（需求 → 模块/用例）；`impact` 输出反向闭包（改这条需求会波及谁），有环时输出去重顺序并标 `cycles`。

## 5. 门禁失败修复

| 规则 | 现象 | 修复 |
|---|---|---|
| `FMT-001` | 缺 `UID`、`[RELATION]` 只有 `Type`、未知节点 | 补齐字段；删掉自造节点 |
| `FMT-002` | ID 不匹配 `REQ-\|TEST-` 前缀，或含小写/下划线 | 改成大写短横线格式 |
| `ID-001` | 同一 ID 出现两次 | 合并或改用新 ID，注意别破坏引用 |
| `ID-002` | 前缀与类型不一致（如 `TEST-` 资产写成 requirement） | 对齐 UID 前缀 |
| `REL-001` | 关系目标不存在 | 先建目标资产，或删除关系 |
| `REL-002` | 关系方向/类型不合法 | 按第 2 节表改 `Type` 或把关系写到正确的源资产 |
| `COV-001` | 需求没有 `verified_by` | 建 `TEST-*` 并加 `verified_by` |
| `STATE-001` | 状态倒退（如 `accepted` → `proposed`） | 只能前进：`proposed` → `accepted`/`deprecated`/`superseded` |
| `SEC-001` | 资产里出现密钥/令牌字面量 | 删除字面量，改引用环境变量名 |

- `check` 失败输出 `file:line assetId`，按定位修；禁止放宽 `pack.json` 或用 `--base` 掩盖。
- `skip` 不是通过：`STATE-001` 无 `--base` 时必 `skip`，汇报里要写明。

## 6. 完成自检

- [ ] 新增/修改的 `.sdoc` 通过 `alm check`，无 `FMT-*`/`ID-*`/`REL-*`/`COV-001`。
- [ ] 每条需求都有可达的 `verified_by`，用例标题可判定。
- [ ] 没有自造节点、字段或关系类型。
- [ ] 改动只在 `requirements/`、`tests/` 内，且已跑 `alm workspace guard`。
- [ ] 汇报里给出 `index` 计数、`check` 结果与 `trace` 链。
