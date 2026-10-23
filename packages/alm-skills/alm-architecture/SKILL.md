---
name: alm-architecture
description: "在 ALM 仓库编写与检查架构资产：ADR、模块、接口（OpenAPI）、数据模型的格式与关系方向，依赖图与影响闭包，Mermaid/链接校验与门禁失败修复。用户要新增 ADR、改接口、评估变更影响范围时使用。"
whenToUse: "仓库内已有 architecture/ 或 adr/ 资产，需要新增或修改模块、接口、数据模型、架构决策，并让 alm check 通过或评估影响范围时。"
metadata:
  version: "0.1.0"
  owner: "peterzhanghao"
  repo: "peterzhanghao/AI_ALM"
  updated: "2026-10-23"
---

# ALM 架构资产

## 0. 边界

- 只处理**架构与决策资产**；需求与验收见 `alm-requirements`，端到端变更见 `alm-change-workflow`。
- 只读默认；写入仅限当前工作区的 `architecture/`、`adr/`（风险条目在 `risks/`）。
- 不审批、不发布、不改门禁规则；不提交、不开 PR。
- 模板见 [`references/formats.md`](references/formats.md)，命令见 [`references/commands.md`](references/commands.md)，权限见 [`references/permissions.md`](references/permissions.md)。

## 1. 四类资产与格式

| 资产 | ID 前缀 | 位置 | 格式 |
|---|---|---|---|
| 架构决策 ADR | `ADR-` | `adr/*.md` | Markdown + YAML frontmatter |
| 模块 | `MOD-` | `architecture/*.yml` | YAML |
| 接口 | `IF-` | `architecture/*.yml` | OpenAPI 3（`x-alm-*` 扩展） |
| 数据模型 | `DM-` | `architecture/*.yml` | YAML |

YAML 资产的顶层字段固定为：

```yaml
schema_version: 1
id: MOD-PAY-REFUND
type: module          # module | interface | data-model | risk
title: 退款模块
status: accepted      # proposed | accepted | deprecated | superseded
owner: team-payments
links:
  - type: constrained_by
    target: ADR-PAY-003
  - type: depends_on
    target: IF-PAY-REFUND-API
```

- `schema_version` 只能是 `1`；`type` 必须是七类之一；`id` 前缀必须与类型匹配（`ID-002`）。
- `links` 是数组，每项 `{type,target}`；`target` 必须是已存在的资产 ID（`REL-001`）。
- 未知字段保留在 `extra`，不参与门禁；不要把关键信息只写在那里。

## 2. ADR

```markdown
---
schema_version: 1
id: ADR-PAY-003
type: architecture-decision
title: 退款与订单状态在同一事务边界内完成
status: accepted
owner: team-arch
links: []
---

# Context
为什么要做这个决策。

# Decision
决策本身，一句话可判定。

# Consequences
- 对接口/数据/运维的后果。
```

- 正文用 `# Context / # Decision / # Consequences` 三段，便于评审阅读。
- ADR 只被别的资产用 `constrained_by` 指向，自身不用 `constrained_by`（`REL-002`）。
- 决策被推翻时新建 ADR，用 `supersedes` 指向旧 ADR；不要改旧 ADR 的语义。

## 3. 接口（OpenAPI）

接口用 OpenAPI 3 文档表达，ALM 字段放在 `info` 下的扩展键：

```yaml
openapi: 3.0.3
info:
  title: 退款接口
  version: 1.0.0
  x-alm-id: IF-PAY-REFUND-API
  x-alm-owner: team-payments
  x-alm-status: proposed
  x-alm-links:
    - type: constrained_by
      target: ADR-PAY-003
paths: {}
```

- `x-alm-id` 必填且为 `IF-*`；缺 `x-alm-*` 的 OpenAPI 文件不会被当成资产。
- `paths` 里写清 `operationId`、请求体必填项与错误码；幂等键、金额下限这类约束要落到 schema。

## 4. 关系方向与依赖图

| Type | 合法方向 | 架构里的典型用法 |
|---|---|---|
| `constrained_by` | 任意非 ADR → ADR | 模块/接口/数据模型/风险受某决策约束 |
| `depends_on` | module/interface/data-model → module/interface | 接口依赖模块、模块依赖模块 |
| `allocated_to` | requirement → module | 需求分配到模块（写在需求侧） |
| `satisfies` | requirement → requirement | 需求层级（写在需求侧） |
| `verified_by` | requirement → acceptance-test | 验收覆盖（写在需求侧） |
| `supersedes` | 同类型 → 同类型 | ADR 替代 |

依赖图来源是 `alm index --json` 的 `links`，不要手工另画一份不一致的图：

```powershell
alm index --root . --json
alm query --root . --type module --json
alm show MOD-PAY-REFUND --root . --json
```

## 5. 影响闭包

```powershell
alm impact --asset IF-PAY-REFUND-API --root . --json
alm impact --asset ADR-PAY-003 --root . --json
```

- 输出 `impacted[]`（`id/depth/via`）与 `cycles[]`；环不会导致递归爆栈，顺序确定。
- 改接口先看反向闭包：被哪些模块/需求引用；改 ADR 看 `constrained_by` 的传播。
- 汇报必须包含：受影响资产清单、最大深度、是否存在环。

## 6. Mermaid 与链接

- 图放 Markdown 内 ` ```mermaid ` 围栏；`REN-001` 检查围栏成对、相对链接可达。
- 链接指向仓库内真实文件；外链用 `https://`，锚点用 `#`，两者不检查可达性。
- 图里的节点只写真实 ID，避免与 `alm index` 漂移。

## 7. 门禁失败修复

| 规则 | 现象 | 修复 |
|---|---|---|
| `FMT-001` | 缺 frontmatter / YAML 解析失败 / 缺 `UID` | 补 `---` 块与必填字段 |
| `FMT-002` | `id` 不符合 `MOD-\|IF-\|DM-\|ADR-` 格式 | 改成大写短横线 |
| `ID-001` | ID 重复 | 合并或换新 ID，并修所有引用 |
| `ID-002` | 前缀与 `type` 不符 | 对齐前缀与类型 |
| `REL-001` | `links[].target` 不存在 | 先建目标 |
| `REL-002` | `constrained_by` 写在 ADR 上、`depends_on` 指向 ADR 等 | 按第 4 节表改写 |
| `REN-001` | Mermaid 围栏未闭合、相对链接 404 | 补 ``` 或改路径 |
| `SEC-001` | 接口里出现真实密钥字面量 | 改引用环境变量名 |

## 8. 页面入口

- DSH 内：Settings → Architecture（可 “Open as main panel”）。
- 只读 HTML：`/alm/architecture`；JSON：`/api/alm/architecture`（端口以 `dsh web` 打印的为准）。
- 页面与 `alm index` 同源，读到的是当前工作区；无工作区时是空态，不是伪造数据。

## 9. 完成自检

- [ ] 新增资产的 `id`/`type`/`status`/`owner`/`links` 合法，前缀与类型一致。
- [ ] `alm check` 无 `FMT-*`/`ID-*`/`REL-*`/`REN-001`，`SEC-001` 通过。
- [ ] `alm impact` 已跑并写入汇报，环已标注。
- [ ] 依赖图与 `alm index --json` 一致，没有第二份手绘图。
- [ ] 改动只在 `architecture/`、`adr/`、`risks/` 内。
