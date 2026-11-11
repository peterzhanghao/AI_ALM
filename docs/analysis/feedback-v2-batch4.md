# 反馈 v2 · 第 4 批：转化对账、跨工作区引用与解决验证

日期：2026-11-03
范围：`packages/alm-core/src/feedback/{records,index}.mjs`、`packages/alm-core/src/requirements/create.mjs`、`packages/dsh-plugin-requirements/feedback.mjs`、`packages/dsh-plugin-requirements/client.js`、测试与浏览器探针。

## 设计判断

1. **生成需求是跨工作区写入，必须对账。** 之前“需求创建成功、反馈关联失败”会返回 500，用户重试会再建一条需求。现在先把转化意图写成 `conversion`，创建后立刻记下 `requirementId`，关联成功才置 `linked`；重试先看 `conversion.requirementId`，有就直接关联，不再创建。
2. **“需求推进情况”必须从目标工作区真实读取。** 反馈里只存引用，不能把“已生成需求”当成“问题已解决”。新增 `requirement-ref` 读取目标工作区的真实 status / decision / warning，并把“测试通过不等于原问题解决”作为返回的一部分给到 UI。
3. **解决是人工验证动作，不是系统推断。** `resolution` 仍只能由 `resolve`/`reopen` 改变；需求关闭、测试通过只作为参考信息展示。

## 改动范围

### 数据层 `packages/alm-core/src/feedback/records.mjs`
- `FEEDBACK_CONVERSION_STATES = ['pending','created','linked']`。
- `beginFeedbackConversion({root,id,now})`：创建 `conversion = { id:'FBC-<feedbackId>', state:'pending', startedAt, at }`；已有 startedAt 时幂等返回 `changed:false`。
- `updateFeedbackConversion({root,id,patch,now})`：只允许 pending/created/linked；写 `requirementId`/`requirementRoot`/`note`/`linkedAt`；**不改 revision**（转化是元数据，不是用户陈述修改）。
- `index.mjs` 导出两个新函数。

### 需求写入 `packages/alm-core/src/requirements/create.mjs`
- 反馈来源章节在正文中写入 `- 转化 ID：FBC-…`（`feedbackMeta.conversionId`），便于人工从需求文件追溯回反馈，也为后续“按 conversionId 搜索”留出依据。

### 接口层 `packages/dsh-plugin-requirements/feedback.mjs`
- `handleGenerate`：
  - 创建前 `beginFeedbackConversion`；已有 `conversion.requirementId` 时跳过创建直接关联；
  - 创建成功立即 `updateFeedbackConversion({state:'created', requirementId, requirementRoot})`；
  - 关联成功置 `linked`；
  - 关联失败返回 **409 `feedback-link-failed`**（details `{feedbackId, requirementId, retryable:true}`），并把失败写进 conversion note——不再 500，也不再让用户靠重试制造重复需求。
  - `feedbackMeta` 带 `conversionId`。
- 新增 GET `requirement-ref`：按反馈 id 读取关联需求的真实状态。
  - 返回 `{schema:'alm.feedback.requirement-ref/v1', found, requirement:{workspaceId, projectId, root, file, id, revision, title, status, decision:{state,label,topGap}, acceptance:{registered,commandCount,latest:{result,current,at}}}, resolutionHint}`。
  - `workspaceId/projectId` 优先从可信工作区列表按 root 反查，其次用路由目标。
  - 未关联 404 `requirement-not-linked`；目标工作区找不到该需求时 `found:false`，UI 明确提示“可能被移动或删除”。
- `GET_ACTIONS` 增加 `requirement-ref`。

### 客户端 `packages/dsh-plugin-requirements/client.js`
- 收件箱行：关联需求旁新增「查看推进情况」，读取 `requirement-ref` 后就地展示“需求状态 · 决策 · 验收结果”，并始终显示 `resolutionHint`；`found:false`、读取失败分别给出可读提示。
- 可访问性：反馈层新增 Tab 焦点环（`[data-feedback-layer]` 内循环），配合已有 Escape 关闭与关闭后焦点归还，覆盖层不再把焦点漏到背后的页面。

## 验证

- 单测 `packages/alm-core/test/unit/feedback.test.mjs`：新增 conversion 生命周期测试（幂等 begin、created/linked、不改 revision、非法状态 400）。**29/29**。
- HTTP `packages/dsh-plugin-requirements/test/feedback-http.test.mjs`：
  - 新增 “generate reconciles a requirement created before the link was written”：模拟崩溃窗口后重试，需求 id 不变、目标仓库仍只有 1 个需求文件、conversion 变 linked。
  - 新增 “requirement-ref reads the real requirement state and refuses to equate it with resolution”：未关联 404、关联后返回 workspaceId/projectId/file/status 与 resolutionHint。
  - **25/25**。
- build 守护 **2/2**；反馈相关合计 **56/56**。
- 全量 `node --test --test-isolation=none "packages/*/test/**/*.test.mjs"`：见交付说明中的数字。
- 浏览器探针 `tmp/ui-harness/ui-feedback-batch4.mjs`：**10/10**——列表入口、收件箱关联需求、查看推进情况（状态/决策/验收/“不等于解决”）、Tab 焦点留在层内、Escape 关闭、无页面错误。

## 限制 / 后续

- `save` 的观察工作区仍以服务端解析的请求 root 为准；切换工作区后立刻提交一条“尚未保存过”的反馈，仍可能落到新工作区（spec P1-6）。需要冻结 root + workspace 并在服务端校验，留待后续。
- 跨工作区“点击关联需求直接跳过去”仍是本地查找；跨工作区场景目前显示真实状态与所属工作区，不做隐式切换。
- 宿主需要重启才能加载新的 `requirement-ref` 与服务端对账逻辑；客户端文件刷新即可更新。

## 补遗（同一批的剩余项）

### 跨工作区直接打开关联需求
- 收件箱行点击关联需求时，先拿到 `requirement-ref`，再交给 Workbench：如果目标 root 与当前工作区不同，先 `applyRoot(targetRoot)` 切工作区，并用 `pendingOpenId` 在重新加载后选中该需求；同一工作区则走原有本地查找。不再只展示状态。
- 探针扩展为 **13/13**：新增“跨工作区切换到 `D:/tmp/plugin`”“切换后反馈层关闭”“确实请求了目标工作区的需求列表”。

### 保存幂等比较上下文摘要（P0-1）
- `records.mjs` 新增 `idempotencyDigest(text, category, context)`（statement+category+observedAt+links+evidence+ui+recentError 的 sha256），新记录写入 `idempotency.digest`。
- 同一 `clientRequestId` 重放时同时比较文字、类别和摘要：上下文变了（切需求、最近错误、勾选变化）也返回 409 `idempotency-conflict`，并在 details 带 `existing:{id,observedAt}`，避免“旧回执冒充新保存”。旧记录没有 digest 时用其已存 statement/category/context 重算，兼容历史数据。
- `FeedbackError` 支持 `details`（此前被 `feedbackError()` 丢弃）。
- 客户端把 `idempotency-conflict`/`feedback-link-failed`/`proposal-unconfirmed` 映射为可读提示，而不是直接抛服务端英文/长句。
- 单测新增 “saveFeedback rejects the same key when only the captured context changed”（上下文变化 409、相同重放 changed:false）。反馈相关合计 **57/57**。

### 故障恢复
- 整理失败：收件箱行保留「整理」按钮可重试，失败原因投影在行内与详情（`processing.lastError`）。
- 保存冲突：409 提示用户刷新收件箱后重提或改用补充；补充本身幂等（同 `supplementId` 重放不重复追加）。
- 关联失败：409 `feedback-link-failed` 后重试复用 `conversion.requirementId`，不会重复建需求。

### 真实宿主复验（2026-11-03 11:5x，GUI 52706）
- 宿主当前已加载**新版插件层**：`GET ?action=diagnostics` 返回 `alm.feedback.build/v1`（`feedback-v2/2026-11-03.1`）；`GET ?action=requirement-ref&id=FB-0002` 返回 `alm.feedback.requirement-ref/v1`（`found:false`，因为旧记录指向的 `REQ-ALM-005` 已不在工作区，提示语正确）。
- 但 **alm-core 模块仍是宿主启动时的旧版本**：在临时工作区真实 POST `save` 成功并返回回执，落盘记录却缺 `receivedAt` / `context.observedAt` / `idempotency` / `processing` 字段——这些正是本批 core 改动。说明插件文件被重载、core 未重载（ESM 缓存），所以 `process / proposal-confirm / requirement-ref 的真实数据面`要等宿主重启。
- 结论：服务层端到端已由 HTTP 测试覆盖（真实 `RequirementsService` + 真实 HTTP，57/57）；**真实宿主 GUI 的完整验收仍需重启应用一次**：重启后依次验证入口覆盖、上下文落盘、草稿隔离、收件箱动作、跨工作区打开、生成≠解决。

### 对账与跨工作区保存（审计 P0-3 / P1-6）
- **关联失败留痕**：core 新增 `markFeedbackReconciliation`（`FEEDBACK_RECONCILIATION_STATES=['link-failed','resolved']`，只写元数据、不改 revision）；generate 在 `markFeedbackRequirement` 失败时写 `link-failed + requirementId`，成功关联后写 `resolved`；inbox 行投影 `reconciliation`，让“需求已建、反馈没关联”可见且可重试。单测/HTTP 各覆盖。
- **跨工作区保存保护**：客户端在打开反馈面板时冻结 `root`，保存时随上下文发送 `observedRoot`；服务端与请求 root 规范化比较，不一致返回 409 `workspace-changed`，不再把 A 工作区写的草稿静默保存到 B。
- 验证：单测 **31/31**、HTTP **26/26**、build **2/2**，合计 **59/59**；浏览器探针 batch2 **23/23**、batch4 **13/13** 无回归。

### 真实宿主验收脚本
- `tmp/verify-feedback-live.mjs`：直接对运行中的宿主做 `diagnostics → save → 读落盘 → process → proposal → confirm → 同键不同上下文 409 → 跨工作区 409`，用完删除临时工作区。
- 当前宿主（未重启）结果 **2/14**：`diagnostics` 与保存回执通过，`receivedAt/observedAt/processing/recentError/process/proposal-confirm/409s` 全失败——正是 alm-core ESM 缓存未更新的证据。**重启桌面应用后重跑该脚本应达到 14/14**，再配合 GUI 检查入口覆盖与收件箱动作即完成真实宿主验收。

### 跨反馈去重（审计 P1-9）与转需求入口
- **去重是硬前置**：`handleGenerate` 在创建需求前，用当前反馈的 `planProposal(...).fingerprint` 在本工作区的已转换提案里查找同一问题；命中且目标需求仍存在时，直接把当前反馈关联到已有需求（`conversion.state='created'`，回执 `deduplicated:true`），不再创建第二条。转化 ID / 来源反馈仍写入需求正文，便于追溯。
- converted 提案把关联需求存在 `requirementRef`（不是 `requirement`），去重匹配按此字段读取；创建前还会用目标工作区需求列表确认该需求确实还在，避免关联到已删除的需求。
- **转需求 UI 补回**：Batch2 为贯彻“写反馈只有一个动作”，删除了写反馈阶段的「生成需求」；但规格 G 要求收件箱能“转需求”。现在收件箱行在没有关联需求时提供「转需求」：内联选择 P0/P1/P2（优先级只在正式转需求时问），确认后调用 `generate`。去重回执显示“同一问题已有需求，已关联到 …”；候选未确认、未配置接收工作区、关联失败分别给出可操作提示。
- 验证：HTTP 新增“generate deduplicates a second feedback about the same problem onto the existing requirement”（同文案两条反馈 → 第二条返回 200、`deduplicated:true`、同需求 ID、目标仓库仍 1 个需求文件）；反馈相关 **60/60**。浏览器探针扩展为 **17/17**：新增转需求按钮、面板、优先级选择、请求载荷（`action:'generate', id, priority:'P1'`）与去重回执文案。

## 补遗：反馈附件（spec §D/审计 G23）

写反馈支持附件（截图/日志），但记录里只保存引用，不保存内容：

- 内容寻址：附件字节写到 `.alm/feedback/attachments/<sha256>.<ext>`，同内容只存一份；记录 JSON 只留 `{name,type,size,sha256,path}`，路径必须匹配 `^\.alm/feedback/attachments/[0-9a-f]{64}\.[a-z0-9]+$`，避免任意路径引用。
- 限额：最多 3 个、单个 2MB、合计 4MB；类型白名单 png/jpeg/webp/txt/md/json。超过 3 个返回 `attachment-too-many`，而不是静默丢弃。
- 显式附件不受“自动采集附件”设置影响；取消勾选上下文不会连带丢弃用户主动附上的文件。
- 客户端：写反馈面板「＋ 附件」多选、可直接粘贴截图、chips 可移除；保存后清空。

验证：`feedback-attachments.test.mjs` 2/2、HTTP “save stores attachment bytes…”（记录不含 base64、文件落盘、4 个附件 400）→ 反馈测试 63/63；浏览器探针 25/25（chip 显示 + 保存载荷带附件）。

下载：`GET /api/alm/requirements/feedback?action=attachment&sha256=…` 只按 root 读取内容寻址文件，非法摘要 400、不存在 404；收件箱详情列出附件并可下载。附件内容不解析。

## 补遗：上下文不串场（审计 G15）

反馈不再读取模块级 `LAST_INTENT_SESSION_ID`。意图会话只由发起反馈的层显式提供（意图澄清弹窗传入当前 `sessionId`），普通页面冻结时 `intentSessionId` 为 `null`。这样在别的页面提交不会把“最近一次意图会话”缝进上下文。

浏览器探针新增断言：列表页保存请求的 `context.links.intentSessionId` 必须缺省。

## 补遗：提交前说明改进对象与接收工作区（spec §3）

写反馈面板在文本框上方常显一行：`改进对象：需求插件（DSH 需求） · 接收工作区：<目标工作区或“未配置”>`。目标工作区来自服务端 `settings.destinationWorkspace`（按可信工作区列表解析名称），不在客户端猜路径；未配置时明确提示“转需求前需在设置里选择”，避免写完才发现无处可去。

浏览器探针新增断言：`[data-feedback-target]` 存在且包含“改进对象”。

## 补遗：幂等冲突的错误细节

同一幂等键但内容或上下文变化时，错误现在带 `details.existing = {id, observedAt}`（此前后端 wrapper 会丢弃 core 的 details，客户端只能看到一句冲突提示，无法指向原反馈）。保存失败回执同时保留 `status` 与 `code`，可直接做“查看原反馈”的后续入口。
