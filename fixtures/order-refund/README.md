# 部分退款样例

“订单支持部分退款”的完整正例，覆盖 7 类资产与 4 种源格式：

| 资产 | 文件 | 格式 |
|---|---|---|
| `REQ-PAY-001` 需求 | `requirements/refund.sdoc` | sdoc |
| `TEST-PAY-001` 验收 | `tests/refund.sdoc` | sdoc |
| `ADR-PAY-003` 决策 | `adr/ADR-PAY-003.md` | markdown |
| `MOD-PAY-REFUND` 模块 | `architecture/MOD-PAY-REFUND.yml` | yaml |
| `DM-PAY-REFUND` 数据模型 | `architecture/DM-PAY-REFUND.yml` | yaml |
| `IF-PAY-REFUND-API` 接口 | `architecture/refund-api.yml` | openapi |
| `RISK-PAY-001` 风险 | `risks/RISK-PAY-001.yml` | yaml |

关系链：需求 → 模块（`allocated_to`）→ 接口（`depends_on`）；需求/接口/模块/数据模型/风险均受 ADR 约束（`constrained_by`）；需求由验收用例覆盖（`verified_by`）。

验证：

```powershell
node packages/alm-core/bin/alm.mjs check --root fixtures/order-refund
node packages/alm-core/bin/alm.mjs index --root fixtures/order-refund --json
```
