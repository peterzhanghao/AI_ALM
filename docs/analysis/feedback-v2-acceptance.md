# 反馈 v2 验收对照（spec §L 最低验收）

来源：`docs/analysis/feedback-v2-entry-context-and-resolution-brief.md` §L。
状态：✅ 自动化已覆盖；🕒 需真实宿主重启后人工/脚本复验。

| # | 最低验收项 | 状态 | 证据 |
| --- | --- | --- | --- |
| 1 | 真实宿主里所有页面/弹层都能看到反馈入口 | 🕒 | 源码层入口覆盖：全局工具栏 `data-feedback-toolbar`、详情头 `data-drawer-feedback`、`ModalShell` 统一注入、三个自绘壳层 `data-layer-feedback`；浏览器探针 `ui-feedback-modal` 12/12、`ui-feedback-entry` |
| 2 | 弹层里的对象不是 selected，而是当前弹层对象 | ✅ | `feedbackContextFor(item)` + `openFeedback` 显式合并；`ui-feedback-modal` 断言“当时所在层：弹窗 / 关闭归档 · REQ-ITS-004” |
| 3 | 切换工作区后提交仍保留原现场，不被静默改投 | ✅ | `observedRoot` 冻结 + 服务端 409 `workspace-changed`；HTTP 测试 “save refuses a draft captured in another workspace root” |
| 4 | 错误正文、决策引用、需求修订、观察/接收时间可核验 | ✅ | `observedAt`（点击）/`receivedAt`（服务端）/`capture.clientBuild`/links 写入记录并读回；`feedback.test.mjs` capture 用例、HTTP capture 用例 |
| 5 | 草稿不套用到新现场 | ✅ | 草稿按 `工作区+需求+修订`（列表按 `工作区+page+stage`）分键；`ui-feedback-batch2` 草稿恢复/清空断言 |
| 6 | 保存不依赖模型，也不要求优先级 | ✅ | `save` 零模型、回执先于整理；compose 无优先级；`ui-feedback-batch2` 断言无“生成需求/优先级必选” |
| 7 | 旧反馈可继续处理（补充、关联、转需求、暂缓…） | ✅ | `supplement/link/disposition/resolve/reopen` + 收件箱处理台；`feedback.test.mjs`、HTTP “disposition and resolution…”、`ui-feedback-batch2/batch4` |
| 8 | 跨工作区引用/打开准确 | ✅ | `requirement-ref` 返回 `{workspaceId,projectId,root,file,id,revision,status,decision,acceptance}`；客户端切 root 打开；`ui-feedback-batch4` 13/13 |
| 9 | 崩溃/重复点击不会重复建需求 | ✅ | `conversion` 对账 + `clientRequestId` 幂等；HTTP “generate reconciles…”、“generate is idempotent”；同问题去重 “generate deduplicates…” |
| 10 | 同一幂等键不同内容返回冲突，不静默覆盖 | ✅ | `idempotencyDigest` + 409 `idempotency-conflict`（含 `details.existing`）；core + HTTP 用例 |
| 11 | 用户陈述 ≠ 已核验缺陷 | ✅ | 候选 `facts[].source='user-statement'`、`analysis.kind='raw'/label='原话候选，尚未分析'`；`feedback.test.mjs` 断言 |
| 12 | 重复/答疑/证据不足/暂缓/不采纳有出口 | ✅ | `disposition` 五态 + 收件箱筛选与动作；HTTP/探针覆盖 |
| 13 | 自动整理不启动开发、不发送业务回答 | ✅ | 整理只生成候选，转需求需确认候选 + 显式动作；`ui-feedback-batch3` 17/17 |
| 14 | 需求关闭/测试通过 ≠ 反馈解决，可重开 | ✅ | `resolve` 要求已关联需求，`resolutionHin` 明示“测试通过不等于原问题解决”，`reopen` 可用；HTTP “disposition and resolution…” |
| 15 | 焦点/键盘/窄屏/200% 可用 | ✅ | `aria-modal=true`、Tab 焦点环、Escape、焦点归还；`ui-feedback-batch4` Tab/Escape；480px/96vw 布局为既有实现 |
| 16 | 缺决策文件等异常场景可追溯 | ✅ | `ModalBoundary` 兜底反馈入口带最近错误；`ui.recentError → evidence.textExcerpts`；K 场景“缺失决策文件不自证授权”未自动化（人工场景） |

## 真实宿主复验步骤（重启后）

```powershell
node tmp/verify-feedback-live.mjs        # 期望 14/14
```

再人工走查：列表/详情各页签/评审/运行/决策/验收/错误态均可见「反馈」；提交后回执 → 收件箱 → 整理 → 确认候选 → 转需求 → 关联推进 → 验证解决；切工作区打开关联需求。

## 已知未覆盖

- 跨工作区“批量历史”页面（收件箱目前按当前工作区 root 读；跨工作区通过 requirement-ref 打开已支持）。
- `settings.enabled/retentionDays` 仍是配置项，未做强制清理策略。
- 附件只存/下载，不解析预览。

## 真实宿主复验结果（2026-11-03 13:3x）

重启桌面应用后（新宿主端口 52167，`feedback-v2/2026-11-03.1`）：

- `node tmp/verify-feedback-live.mjs` → **14/14 PASS**（真实 HTTP：诊断、保存回执、`receivedAt`/`observedAt`+`capture` 落盘、`processing=queued`、最近错误摘录、真实整理生成候选、未分析标记、事实分栏、确认候选、重复确认幂等、同键不同上下文 409、跨工作区 409）。
- `node tmp/ui-harness/ui-feedback-live.mjs`（真实 client.js + 真实宿主 API，无桩）→ **8/8 PASS**：列表入口、面板构建身份、提交反馈得真实回执、收件箱读到真实记录且编号一致、无页面错误。截图 `tmp/ui-shots/feedback-live-ui.png`。
- 顺带修复：收件箱行显示反馈编号（此前只能看到状态/类别/时间，无法引用编号）。
