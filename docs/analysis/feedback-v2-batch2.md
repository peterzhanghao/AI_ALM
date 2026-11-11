# 反馈 v2 · 第 2 批：可靠保存、补充修订、收件箱处理台

日期：2026-11-03。设计依据 `feedback-v2-entry-context-and-resolution-brief.md`（§C、§F、§G、§H 的一部分）。
第 1 批（入口覆盖、构建身份、上下文保真）见 `feedback-v2-batch1.md`。

## 本批要解决的问题

1. 写反馈时同时出现“保存反馈”和“生成需求”两个主操作，优先级也在这一步问——反馈还没分析，凭什么要优先级。
2. 草稿是模块级单例：在这个需求下写了一半，关掉去另一个需求，再打开会看到上一个需求的文字。
3. 保存后改一个字再提交，会新建一条记录，而不是补充原反馈。
4. 收件箱只是只读列表：不能看详情、不能关联需求、不能暂缓/不采纳/标记重复、不能验证解决。

## 改动

### 数据层（`packages/alm-core/src/feedback/records.mjs`）

- 新增 `FEEDBACK_DISPOSITIONS = ['open','linked','deferred','declined','duplicate']` 与
  `FEEDBACK_RESOLUTION_STATES = ['pending','resolved','reopened']`。
- `appendSupplement({ root, id, statement, context, supplementId, actor, observedAt })`：
  - 原 `statement` 与首条 `context` 永不改写；每条补充冻结自己的上下文快照（独立
    `contextSnapshotId`）；
  - 同一 `supplementId` 重放返回 `changed:false`，超 20 条 409，记录超 64KB 拒绝；
  - `revision + 1`，`updatedAt` 更新。
- `updateFeedbackDisposition`：可暂缓/不采纳/标记重复/恢复待处理，**不修改 `status`**——
  disposition 是“人怎么处理这条反馈”，status 是“它有没有变成需求”，两者不能互相冒充。
- `updateFeedbackResolution`：`pending / resolved / reopened`；`resolved` 要求已关联需求
  （`resolution-needs-requirement` 409），避免“嘴上说解决”。
- `feedbackInbox(root, filter)`：支持 `status / category / disposition / resolution / page / stage / q / limit`；
  `counts` 始终是全局计数，筛选只收窄 `items`；每项新增 `disposition / resolution / supplementCount / updatedAt`。

### 接口层（`packages/dsh-plugin-requirements/feedback.mjs`）

- 新增动作：`supplement`、`link`、`disposition`、`resolve`、`reopen`。
- `link` 使用反馈路由时记录的目标工作区 root（不是请求里的 root）建立关联，成功后把 disposition 置为
  `linked`，关联失败不影响已有关系。
- GET `inbox` 透传筛选参数并返回 `total / shown / filter`；`publicInboxItem` 增加
  `disposition / resolution / supplementCount / updatedAt / contextSnapshotId / page / stage` 与
  `requirement { id, revision, file }`。
- 缺少核心函数时返回 `module-stale`（提示应用需重启），而不是 500 裸异常。

### 客户端（`packages/dsh-plugin-requirements/client.js`）

- 草稿按实例隔离：`FEEDBACK_DRAFTS` Map，key 为
  `工作区 | requirement:<id> | revision:<n>`（列表/无需求时用 `工作区 | page | stage`）。
  重开同一实例恢复草稿并显示“恢复了未提交的草稿 / 清空，写新的”。
- 写反馈只剩一个主操作：**提交反馈**（已有保存记录且文本变化时为“提交补充”）；
  删除“优先级”与“生成需求”。优先级按规格后移到候选确认阶段。
- 保存回执保留 `savedId / savedStatement`，面板关闭后继续输入改为 `supplement`
  （带独立幂等键），不会重复新建记录。
- 收件箱升级为处理台：
  - 筛选：全部 / 待处理 / 已暂缓 / 不采纳 / 重复 / 已验证；
  - 行内：状态、类别、时间、处置与解决徽标、补充数；
  - 动作：详情、暂缓/恢复待处理、不采纳、标记重复、补充、关联需求、验证解决、重开；
  - 详情展开后读取单条记录全文：原文、场景/观察/接收时间、快照 ID、修订、最近错误摘录、最近补充；
  - 未关联需求的“验证解决”禁用并说明原因（后端同样 409 双保险）。

## 验证

| 项 | 结果 |
| --- | --- |
| `packages/alm-core/test/unit/feedback.test.mjs` | 26/26 |
| `packages/dsh-plugin-requirements/test/feedback-http.test.mjs` | 22/22 |
| `packages/dsh-plugin-requirements/test/feedback-build.test.mjs` | 2/2 |
| 合计 | **50/50** |
| 浏览器探针 `tmp/ui-harness/ui-feedback-batch2.mjs` | **23/23** |

探针覆盖：单一主操作、无优先级/无生成需求、提交调用 `save`、重开恢复同一实例草稿、清空草稿、
收件箱计数与徽标、筛选请求带 `disposition=open`、暂缓调用 `disposition` 并回执、详情上下文与错误摘录、
补充调用 `supplement` 且携带幂等键、未关联需求禁用验证解决。

截图：`tmp/ui-shots/feedback-batch2-01-inbox.png`。

## 限制与剩余

- 草稿只存在当前页面内存里：面板关闭、切换页面内对象不会丢，但**刷新页面会丢**。规格要求的是
  “保存失败/关闭面板不丢”，这一层已满足；跨刷新草稿留待需要时再做持久化。
- 收件箱详情仍从 `.alm/feedback/records` 读取，历史记录（第 1 批之前）没有 `disposition`，
  读取时按 `open / pending` 投影，无需迁移。
- 第 3 批：持久处理任务（保存后自动排队分析、启动恢复）、候选结构与事实/假设分离、候选确认闸门、
  未确认提案不得进入开始开发。
- 第 4 批：`conversionId` 对账与跨工作区幂等转需求、跨工作区直接打开需求、解决验证投影
  （需求/测试/人工验收结果回写反馈）、故障恢复与可访问性收尾。
- 所有改动仍未提交，工作树里同时有并行会话的未提交修改；宿主需重启后才能看到后端新动作。
