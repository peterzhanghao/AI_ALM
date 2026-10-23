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

订单支持部分退款后，退款金额与订单状态必须一起变化；否则会出现“钱退了、订单仍是已支付”或重复退款的账实不一致。

# Decision

退款写入与订单状态流转在同一个本地事务内完成，退款单只追加、不原地修改；跨服务通知使用幂等事件。

# Consequences

- 退款接口必须具备幂等键，重复请求返回同一退款单。
- 订单表增加 `refunded_amount` 累计字段，由事务内更新。
- 对账任务以退款单为事实源，不反向推断订单状态。
