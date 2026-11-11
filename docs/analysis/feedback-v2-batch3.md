# 反馈 v2 · 第 3 批：后台整理、候选结构与确认闸门

日期：2026-11-03
规格：[feedback-v2-entry-context-and-resolution-brief.md](./feedback-v2-entry-context-and-resolution-brief.md)

## 这批解决什么

规格要求「保存不依赖模型；保存后由持久任务核对、去重、整理」，并明确「未确认的候选不得成为可执行任务」。前两批已经做到可靠保存与收件箱处理，这批补上中间那段：**保存之后自动排队整理，整理产出结构化候选，候选必须由人确认才能转需求。**

## 设计判断

1. **保存永远不等模型。** `save` 成功即返回回执，随后 best-effort 把记录标记为 `queued`；排队失败不影响保存结果。
2. **整理是可恢复的持久任务，不是内存锁。** 记录里保存 `processing` 状态（`queued / analyzing / draft-ready / failed / skipped`）、`attempts`、`lastError`。进程重启后 `recoverFeedbackProcessing` 会把 `analyzing` 重置为 `queued`，并留下“上一次整理被中断，已重新排队”，不会静默丢单。
3. **候选先声明自己是“原话候选”。** 当前整理是零模型的模板整理，`analysis.kind = 'raw'`、`analysis.label = '原话候选，尚未分析'`。模型不在这一批引入，避免把“未分析”伪装成“已分析”。
4. **确认是硬闸门。** `generate`（转需求）前检查候选；存在未确认候选时返回 409 `proposal-unconfirmed`。这样“整理出候选”与“授权开发”不会混在一起。

## 改动范围

### alm-core `packages/alm-core/src/feedback/`

- `records.mjs`
  - `FEEDBACK_PROCESSING_STATES`，`enqueueFeedbackProcessing` / `updateFeedbackProcessing` / `listFeedbackProcessing` / `recoverFeedbackProcessing`。
  - `processing` 是元数据：状态流转**不改 revision**，也不改写用户原话与原始上下文。
  - `feedbackInbox` 的条目带上 `processing` 投影（状态/尝试次数/最近错误），列表因此能显示处理进度。
- `proposals.mjs`
  - `planProposal` 增加 `facts`（用户陈述来源）、`confirmation`（必填、确认人/时间/备注空态）、`analysis`（`kind: 'raw'` + “原话候选，尚未分析”）。
  - `confirmProposal`：revision CAS、重复确认幂等、仅 `awaiting-confirmation` 可确认。
- `store.mjs`：`PROPOSAL_STATUSES = ['awaiting-confirmation', 'confirmed', 'converted', 'failed']`。

### 插件 `packages/dsh-plugin-requirements/feedback.mjs`

- 新动作：`POST process`、`POST proposal-confirm`、`GET proposal`。
- `save` 后在回执之外 best-effort 入队；`inbox` 读取前 best-effort 恢复被中断的整理。
- `generate` 增加确认闸门：未确认候选直接 409，并返回 `feedbackId / proposalId / proposalStatus`。
- 旧宿主（模块未更新）会得到明确的 500 `module-stale`，而不是静默跳过。

### 客户端 `packages/dsh-plugin-requirements/client.js`

- 收件箱行增加处理徽标：待整理 / 整理中 / 候选已生成 / 整理失败，失败时显示最近错误。
- 新增「整理」动作（可对手动整理与失败重试）与「确认候选」动作；候选状态显示为 待确认 / 已确认 / 已转需求。
- 详情面板增加整理状态、候选 ID、最近整理错误。
- 顺带修正：收件箱刷新时不再把整列表卸载成“正在读取收件箱…”，否则行内操作反馈会丢失。

## 验证

| 范围 | 结果 |
| --- | --- |
| alm-core feedback 单测 | 28/28 |
| feedback HTTP 契约 | 23/23 |
| build 漂移守护 | 2/2 |
| 合计 | **53/53** |
| 浏览器探针 `tmp/ui-harness/ui-feedback-batch3.mjs` | **17/17** |
| 全量仓库测试 | 见本轮运行结果 |

浏览器探针覆盖：处理徽标、整理请求与回执、整理后候选出现、确认候选请求、确认后徽标与提示、失败原因与详情投影、无页面错误。

截图：`tmp/ui-shots/feedback-batch3-01-inbox.png`

## 限制与未做

- 整理仍是零模型模板；接入模型（一次有界分析 + 最多一次格式修复）放在后续，且接入后 `analysis.kind` 必须区分 `raw` 与 `model`。
- 候选确认后不会自动转需求，仍需在确认页显式选择优先级并触发；这正是规格要求的授权边界。
- 持久处理任务的“自动触发”目前由 `save` 入队 + 收件箱/进程启动恢复组成；真正的后台 worker（无需打开面板）留给部署层，本批提供的是可恢复的数据与接口。
- `client.js` 与并行会话共享工作树，补丁通过原子脚本应用；仍全部未提交。

## 下一步（第 4 批）

- `conversionId` / `sourceFeedbackRef` 对账，防“需求已建、关联失败”重复创建；跨工作区幂等。
- 跨工作区用完整引用打开关联需求（workspace + project + file + id + revision）。
- 把需求推进/测试/人工验收结果投影回反馈，生成需求 ≠ 解决，支持重新打开与验证解决。
- 故障恢复与可访问性收尾：焦点、窄屏/200%、缺决策场景可追溯。

## 补遗：保存后自动整理

保存回执只承诺“已保存”，不等模型。客户端在保存成功后 fire-and-forget 发一次 `POST {action:'process', id}`，服务端把该反馈从 `queued` 推进到 `draft-ready` 并生成候选；失败只写 `processing.state='failed'` 与 `lastError`，反馈本身仍在收件箱，可手动「整理」重试。

因此用户看到的顺序是：先拿到回执（含 ID 与耗时）→ 后台整理 → 收件箱出现候选 → 确认候选 → 转需求。任何一步失败都不会回滚已保存的反馈。
