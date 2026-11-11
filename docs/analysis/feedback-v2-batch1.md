# 反馈功能重构 · 第 1 批交付（入口、上下文、构建身份）

对应规格：`docs/analysis/feedback-v2-entry-context-and-resolution-brief.md`（§A 入口、§B 上下文、§C 保存前置）。

## 一、先回答“为什么源码有按钮、运行时看不到”

复现步骤与证据：

1. 运行中的宿主为 `http://127.0.0.1:52706`（pid 5420，`StartTime 2026-11-03 09:27:11`）。
2. `GET /api/alm/requirements/feedback?root=D:/DSH&action=diagnostics` 返回
   `404 feedback-action-unknown`：说明宿主进程加载的是**旧版 `feedback.mjs`**（ESM 模块已被缓存，磁盘上的新后端不会被热加载）。
3. 同一时刻，用 `tmp/ui-harness`（真实 `client.js` + 同一宿主 API）打开详情抽屉：
   `drawer feedback entries: 1`，可见并可用，点击后出现反馈面板。
4. 工作树里 `client.js` 在 10:47、10:54 被并行会话修改，而宿主 09:27 已启动：运行时客户端 bundle 与本轮源码不一致。

结论：入口不是没写，而是**运行中的宿主是旧模块 + 旧客户端**。本轮为这类问题加了 build identity：
客户端与服务端各自带版本，面板顶部会显示；服务端未升级时直接提示“应用未重启”，不再让用户猜。

## 二、本批修改范围

### 后端 / 数据层

- `packages/dsh-plugin-requirements/build-info.mjs`（新）
  `FEEDBACK_BUILD` / `FEEDBACK_CLIENT_BUILD` / `feedbackBuildInfo()`（schema `alm.feedback.build/v1`）。
- `packages/dsh-plugin-requirements/feedback.mjs`
  - GET `diagnostics`：返回当前服务端 build 身份。
  - `assembleContext` 透传 `observedAt`、`capture`、顶层 `recentError`（兼容旧客户端放在 `ui.recentError`）。
  - `LINK_KEYS` 新增 `requirementFile`、`requirementInstanceKey`。
  - 保存回执新增 `observedAt` / `receivedAt` / `build`。
- `packages/alm-core/src/feedback/context.mjs`
  - `normalizeCapture`：点击时间 `observedAt`、`capture.kind/client/clientBuild/timeSource`。
  - envelope 同时保留服务端 `capturedAt` 与客户端 `observedAt`（双时间戳）。
  - `recentError` 落为 `evidence.textExcerpts`（此前勾选“最近错误”实际被白名单丢弃）。
  - 关联链接新增 `requirementFile`（相对路径校验）与 `requirementInstanceKey`。
- `packages/alm-core/src/feedback/records.mjs`
  - 幂等命中比较 statement + category，不同内容返回 `409 idempotency-conflict`，不再静默复用旧记录。
  - 记录新增 `receivedAt`（服务端接收时间）。

### 客户端

- 常量 `FEEDBACK_CLIENT_BUILD`，与 `build-info.mjs` 同值，由 `test/feedback-build.test.mjs` 守护漂移。
- `freezeFeedbackContext` 冻结 `workspaceId` / `projectId` / `requirementRevision` / `requirementFile`。
- `buildContext` 发送顶层 `observedAt` / `capture` / `recentError`，以及 `requirementRevision` / `requirementFile` / `requirementInstanceKey` / `acceptanceDecisionId` / `failureIds`。
- 入口覆盖：
  - `ModalShell` 新增 `feedbackContext`：评审、回答决策、签收、发布、决策原文、AI 评审、交给 AI 推进、需求验收、缺陷、变更试演、归档、删除都会带上**当前弹窗对象**（需求/run/决策/失败），不再只靠 `selected`。
  - 自绘壳层补入口：版本快照、追溯视图、`ModalBoundary` 崩溃兜底（错误正文作为 `recentError`）。
  - `launchFeedbackFromLayer` 不再静默失败：launcher 未就绪或抛错时显示可见提示。
- 面板顶部新增构建身份行：一致时显示版本；服务端旧时提示“应用未重启”；不一致时提示重启。
- 收件箱页不再渲染“保存反馈/生成需求”（此前作用于后台隐藏草稿）。
- 反馈层 `aria-modal=true`；settings 读取 `destinationWorkspace`（修复“总显示未配置、保存清空目标”）。

## 三、验证

- `node --test packages/alm-core/test/unit/feedback.test.mjs packages/dsh-plugin-requirements/test/feedback-http.test.mjs packages/dsh-plugin-requirements/test/feedback-build.test.mjs` → **44/44 pass**。
- 浏览器探针 `tmp/ui-harness/ui-feedback-modal.mjs`（真实 client.js + 真实宿主 API）→ **12/12 PASS**：
  抽屉打开 → 更多 → 归档弹窗 → 弹窗内“反馈” → 面板显示“当时所在层：弹窗 · 关闭归档 · REQ-ITS-004”，并显示构建身份为“服务端未重启”；无页面错误。
- 既有入口探针 `tmp/ui-harness/ui-feedback-entry.mjs`：列表/抽屉入口可见、面板上下文为“需求详情 · 测试 · REQ-ALM-001”。
- 截图：`tmp/ui-shots/feedback-modal-01.png`。

## 四、剩余问题（后续批次）

1. 草稿按 `workspace + 当前实例` 隔离；已保存后再编辑走 supplement/同 ID 修订，而不是新提单。
2. 收件箱升级为处理台：详情、筛选、补充、关联、标重复、暂缓、不采纳、验证解决。
3. 持久处理任务（保存后排队、启动恢复、串行、失败可重试）与候选结构（事实/假设分开、确认闸门）。
4. 转需求的 `conversionId` 对账、创建前去重、跨工作区完整引用与跳转。
5. 解决方案验证与重新打开；不把“需求创建成功/测试通过”等同于“反馈已解决”。
6. `SnapshotModal` 等三个壳层的入口已覆盖，但“当前对象”仍需更多弹窗补齐；窄屏/200% 与焦点陷阱需一轮专门验收。

本批未提交，工作树中同时存在并行会话的其它未提交修改，未触碰。
