# 架构资产格式参考

> 以 `packages/alm-core/src/parse/{yaml,markdown,openapi}.mjs` 与 `src/model/asset.mjs` 为准。

## 1. YAML 资产（module / data-model / risk）

```yaml
schema_version: 1
id: DM-PAY-REFUND
type: data-model
title: 退款单
status: proposed
owner: team-payments
links:
  - type: constrained_by
    target: ADR-PAY-003
```

| 字段 | 必填 | 规则 |
|---|---|---|
| `schema_version` | 否 | 只能为 `1`；缺省视为 1 |
| `id` | 是 | 前缀与 `type` 一致 |
| `type` | 是 | `module` / `data-model` / `risk`（本文件）；`interface` 用 OpenAPI |
| `title` | 是 | 非空字符串 |
| `status` | 是 | `proposed` / `accepted` / `deprecated` / `superseded` |
| `owner` | 是 | 团队标识 |
| `links` | 否 | `[{type, target}]`，六种关系之一 |

## 2. ADR（Markdown + frontmatter）

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

订单支持部分退款后，退款金额与订单状态必须一起变化。

# Decision

退款写入与订单状态流转在同一个本地事务内完成；退款单只追加，不原地修改。

# Consequences

- 退款接口必须具备幂等键，重复请求返回同一退款单。
- 订单表增加 `refunded_amount` 累计字段，由事务内更新。
- 对账任务以退款单为事实源，不反向推断订单状态。
```

- frontmatter 必须有 `---` 包裹；缺块 → `FMT-001`。
- 正文不参与解析，但 `REN-001` 会检查正文里的相对链接与 Mermaid 围栏。
- 引用旧决策：新建 ADR 后用 `links: [{type: supersedes, target: ADR-PAY-001}]`。

## 3. 接口（OpenAPI 3）

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
paths:
  /orders/{orderId}/refunds:
    post:
      operationId: createRefund
      summary: 为订单创建部分退款
      parameters:
        - name: orderId
          in: path
          required: true
          schema:
            type: string
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [amount, idempotencyKey]
              properties:
                amount:
                  type: number
                  minimum: 0.01
                idempotencyKey:
                  type: string
      responses:
        '201':
          description: 退款单已创建
```

| 扩展键 | 必填 | 映射 |
|---|---|---|
| `info.x-alm-id` | 是 | `id`，必须 `IF-*`；缺失直接 `FMT-001` |
| `info.x-alm-owner` | 是 | `owner`；缺失 `FMT-001` |
| `info.x-alm-status` | 否 | `status`，缺省 `proposed` |
| `info.x-alm-links` | 否 | `links` |
| `info.title` | 否 | `title`，缺省用 `id` |
| `paths` | 是 | 必须是对象，否则 `FMT-001` |

`operationId` 取第一个非空值，写入 `extra.operationId`，供评审引用。

## 4. 风险条目

```yaml
schema_version: 1
id: RISK-PAY-001
type: risk
title: 并发退款导致重复扣款
status: proposed
owner: team-payments
links:
  - type: constrained_by
    target: ADR-PAY-003
```

## 5. 关系方向速查

| Type | source → target |
|---|---|
| `constrained_by` | 非 ADR → ADR |
| `depends_on` | module/interface/data-model → module/interface |
| `allocated_to` | requirement → module |
| `verified_by` | requirement → acceptance-test |
| `satisfies` | requirement → requirement |
| `supersedes` | 同类型 → 同类型 |

## 6. 常见负例

| 写法 | 规则 |
|---|---|
| OpenAPI 缺 `x-alm-id` | `FMT-001` |
| `type: service`（自造类型） | `FMT-002` |
| `id: IF-PAY-API` 但 `type: module` | `ID-002` |
| ADR 上写 `constrained_by` | `REL-002` |
| `depends_on` 指向 ADR | `REL-002` |
| `links[].target` 不存在 | `REL-001` |
| 未闭合的 ```mermaid 围栏 | `REN-001` |
| 接口示例里贴真实 `api_key: sk-...` | `SEC-001` |
