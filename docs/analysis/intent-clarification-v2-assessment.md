# 意图澄清 v2 执行简报评估：哪些成立、哪些要改、本轮做了什么

> 评估对象：`docs/analysis/intent-clarification-v2-execution-brief.md`（外部 AI 的「研究判断 + 开发执行指令」，2026-11-02）
> 评估方式：逐条静态核对真实代码（结论带 `file:line`）+ 基线测试 + 与既有 `docs/analysis/intent-clarification-review.md`、`requirements-plugin-refactor-assessment.md` 对照；**没有**复现简报作者描述的真人对话（作者也自述未复现），因此本文不对"体验差多少"下量化结论，只把可验证的结构性缺陷转成可执行任务。
> 基准：`develop` @ `64ec15e` + 当前未提交工作树；`pnpm test` 基线 530 / 530 pass。
> 结论时点：2026-11-02。

---

## 0. 一句话结论

**诊断大体真实，归因有一处错，方案有三处过度；采纳它的协议内核，拒绝它的工程堆料。**

简报最有价值的部分是 **B3/B4（问题要绑定决定、支持一组问题连续处理）** 和 **C/E2（草稿随时可见、快交互与慢分析解耦）**——这些恰好命中当前实现的结构性缺口，且不需要新建系统。本轮据此落地 M1（语义不丢失 + 附件 + 真实耗时）与 M2（问题组 + 批量原子回答 + 依赖失效 + 迟到防护），UI 做最小可用切片（决定记录 + 进度 + 草稿摘要条）。

不采纳的是它的 **"40/60 双栏工作台 + SSE 事件通道 + ≥30 个真实模型任务报告 + 全套埋点"**：这些是规模工程，不是本次澄清链路的第一瓶颈；在真实宿主可用性和模型配额未解决前做，收益无法验证。

---

## 1. 成立的部分（有代码证据）

| # | 简报论断 | 证据 | 判断 |
|---|---|---|---|
| 1 | "一次一问"是协议约束，不只是提示词习惯 | `packages/alm-core/src/intent/messages.mjs` 的 `INTENT_SYSTEM_PROMPT` 第 6 条明确"一次最多问一个会改变路由/验收/范围的问题"；`packages/alm-core/src/intent/analysis.mjs` 的 `TOP_KEYS` 只接受 `{schemaVersion,contextSnapshotId,items,nextQuestion}`，`nextQuestion` 是单对象；`session.mjs`/`view.mjs` 同样只承载单个 `nextQuestion` | **成立**，是协议级约束 |
| 2 | 回答已持久化并立即回执，但随后仍触发分析 | `packages/dsh-plugin-requirements/intent.mjs:1194-1266`（`handleAnswer`）先 `core.recordAnswer` 立即返回 `pending:true`，再 `void runAnalysis(...)`；客户端 `client.js:5438` 的 `pollAnalysis` 每 800ms 轮询 `load` | **成立**，但归因需修正（见 §2.1）：异步化已经做了，缺的是"同组连续作答" |
| 3 | 模型输出全文累加后才解析，流式没有用于降低首字延迟 | `intent.mjs:710-846`（`runAnalysis`）调用 `streamOutput(..., maxTokens: 8000)` 后整体 `normalizeModelOutput`；格式修复最多一次 | **成立**，但收益主要在观感，不是"卡住"的根因 |
| 4 | 历史回答只回传 ID，模型看不到原题和选项文案 | `messages.mjs:73-79` 的 `renderHistory` 只输出 `问题 ${answer.questionId}：选项=${answer.optionId}`；`session.mjs:280-299` 的 `recordAnswer` 只存 `answerId/itemId/questionId/optionId/text/at/inputRevision` | **成立，且是本次第一优先级**：模型在第二轮确实无法把"上一题选了什么"还原成语义 |
| 5 | 附件摘录只有被截断时才进入分析提示 | `messages.mjs:102` 的条件是 `extracted.truncated ? '## 材料摘录…' : null`，短摘录/空摘录/多附件路径都没有稳定进入提示 | **成立**：这是"贴了图但模型没看到"的确定性缺陷 |
| 6 | readiness 把优先级当理解意图的硬门槛 | `packages/alm-core/src/intent/readiness.mjs` 的 `needs-priority` 是 create 路由的硬门槛；优先级属于交付排期，不属于"我理解你要什么" | **成立，但要分级处理**（见 §2.4），不能直接删 |
| 7 | 页面把多种工作混在同一个长滚动区 | `client.js:7376-7425` 的 `renderReview` 依次渲染：状态标签 → `renderClarificationStatus` → 整体理解 → `renderQuestion` → 调查面板 → 调查结果 → 逐条候选 → 准入原因。当前问题是"缺稳定入口/缺决定记录"，不是"弹层太大" | **部分成立**：问题是信息架构，不是尺寸 |
| 8 | 阈值型验收（≤100ms、p95≤1s…）只能当优化目标 | 简报自己声明"无数据不造假基线" | **同意**：写成目标值，不写进阻塞门禁 |

---

## 2. 需要修正的判断（简报说错或说过头的地方）

### 2.1 "连续作答被模型阻断"——异步化其实已经做了

简报把 `handleAnswer` 描述成"回执后仍调 `runAnalysis`，所以用户在等模型"。真实代码是**先返回、后台跑**，客户端靠 `pollAnalysis` 更新，且已有 90s 超时提示（`client.js:5438-5472`）。用户感受到的"卡"来自另外两件事：

1. 会话模型只有**一个** `nextQuestion`，答完必须等下一轮分析产出新题，中间没有"其他独立问题可以同时回答"的通道；
2. 界面把"当前问题"和"候选/确认"混排，回答后视觉上仍停在原地。

所以正确的修法是 **B4 的问题组 + 本地立即反馈**，而不是"把模型调用改成不阻塞"。

### 2.2 "草稿不可见"——草稿已经有了，缺的是"稳定入口"和"决定记录"

首次分析后 `items` 就通过 `renderItemSection` 展示并可编辑（`client.js:7411`）。真正的缺口是：
- 草稿随滚动淹没在候选里，没有粘性摘要；
- 已回答的问题没有"决定记录"，无法回看/修改；
- 没有"本轮相对上一轮改了什么"的差异提示。

本轮按这个口径做最小切片，不做简报的 40/60 双栏工作台。

### 2.3 "改成宿主内可恢复工作台"——方向对，本轮不做

理由：宿主内 UI 的容器/滚动/焦点由宿主控制，40/60 双栏在窄屏与对话框内会退化；而当前最高频的失败是"答案语义丢失"和"一次只能答一题"，不是布局。工作台放到 M3，等真实宿主可用后再验证。

### 2.4 "优先级不应成为理解意图门槛"——成立，但只在草稿阶段

写入正式需求列表时优先级是必填字段（需求文件契约要求），所以不能全局删除。本轮引入 `readiness mode='draft'`：草稿阶段 `needs-priority` 降级为提示、不阻断"理解是否成立"；`mode='confirm'` 保持现状。

### 2.5 "SSE / 宿主事件通道"——本轮不引入

800ms 有界轮询已经满足"保存后 1s 内看到反馈"的目标，且不需要新增鉴权面。SSE 需要宿主侧通道与生命周期支持，收益不确定，记入 backlog。同理，brief 要求"发语义事件 question-group-ready/draft-patch-ready"，本轮用**响应体 + 轮询状态**达成同等可观察性。

### 2.6 "≥20 个案例 / ≥30 个真实模型任务报告 / 全套埋点"——降级

- 20 个语义案例里，真正能稳定自动化的只有 6 类（零提问出草稿、同组连续答、前序改变后题失效、不追问已明确、自由回答超选项、重复提交幂等）。其余需要人造对话，先写成 fixture 案例表，不进 CI。
- 30 个真实模型任务报告需要真实宿主 + 模型配额，当前环境（61773 未监听）无法复现，记为后续验收项。
- 埋点只做**服务端真实耗时**（`totalMs/contextMs/modelMs/firstTokenMs/parseMs/persistMs/calls/retries`），落库到 `runs.timing`，不做监控系统（简报 I 节也同意复用现有失败记录）。

---

## 3. 明确不采纳/不做的部分

| 建议 | 不做的理由 |
|---|---|
| 新建"意图模型"独立对象/服务 | 现有 `intent-session` + `analysis.items` 已承载意图模型，v2 只做 additive 字段，不新建系统 |
| 取消澄清/自动批准/模型自评 | 违反产品不变量，简报自己也禁止 |
| 40/60 工作台、窄屏三页签 | 收益未验证，成本高；M3 再评估 |
| 引入数据库/向量服务/新依赖 | 不需要；问题在协议与会话结构 |
| "把能否读取现有需求作为写入前置硬门槛" | 简报自己把它列为过度约束；读取失败应降级为"未登记影响"，不应阻断起草 |
| 自动判定"模型输出是否合理" | 不可靠；改为 schema + 引用 + 版本校验 + 用户可见的待核对项 |

---

## 4. 本轮转为开发任务的部分（M1 + M2 + M3 最小切片）

| 任务 | 内容 | 写作用域 | 状态 |
|---|---|---|---|
| task-1 core | `sessionRevision`、`questionGroup`、`recordAnswers` 批量原子/幂等/历史保留/依赖 stale、`recordAnalysis(baseSessionRevision)` 迟到防护、`intent-review.v2`、完整语义快照 `renderHistory`、附件摘录修复、`readiness mode='draft'`、view 新字段与 `runs.timing` | `packages/alm-core/src/intent/**`、`packages/alm-core/test/**` | 已完成（task-1 rev3） |
| task-2 plugin | `answer` 接受 `answers[]` 原子提交并兼容旧单题、`expectedSessionRevision` CAS、`changed:false` 不起分析、`onFirstToken` 与分段时间、失败 run 也有可解释 timing、`load` 输出 `elapsedMs` | `packages/dsh-plugin-requirements/intent.mjs`、`test/intent-http.test.mjs` | 已完成（task-2） |
| task-3 ui | 问题组连续作答（选项/自由文本/stale 徽标/已答折叠"修改"）、批量提交后立即"已保存 N 条（Xms）"、进度"待决定 N · 已处理 M"、已确认决定记录、粘性草稿摘要条、真实耗时与 >20s 提示、离线 mock 的 Playwright 验证 | `packages/dsh-plugin-requirements/client.js`、`tmp/ui-harness/**` | 已完成（task-3） |
| 契约 | `tmp/team/intent-v2-contract.md`（数据模型/接口/写作用域/验收命令） | Lead | 已定稿 |

**数据模型原则**：additive，不破坏 `alm.intent-session/v1`；旧会话（无 `questionGroup`、回答无快照）必须可读，缺文案时明确降级为"旧记录不含原题文案"，不猜。

**批次语义**：一次最多 3 个**相互独立**的问题（`dependsOn` 为空）；有前序依赖的题必须等前序决定；前序改变后，依赖它的已答问题标记 `stale`，**保留原答案与原因**、不计入已解决、不静默删除。

**验收命令**：
```powershell
pnpm test                                   # 必须 0 fail（基线 530）
node --test packages/alm-core/test/intent-*.test.mjs
node --test packages/dsh-plugin-requirements/test/intent-http.test.mjs
```

---

## 5. 后续 backlog（本轮不做，但已登记）

1. **M3 工作台**：宽屏 40/60、窄屏页签、草稿差异高亮、当前阻塞项独立入口；需真实宿主可用后做。
2. **SSE/事件通道**：把轮询替换为宿主事件，需先确认宿主插件通道能力。
3. **调查分流自动化**：`investigate.mjs` 已能只读取证，缺的是"哪类 unknown 自动转调查、哪类必须问用户"的运行时判定（简报 B2）。
4. **证据链稳定标识 + 9 类内容模板**（简报 C 节）：与既有 evidence decision 部分重叠，应作为独立设计评审，不要塞进澄清重构。
5. **≥20 语义案例库与 ≥30 真实模型任务报告**：需要真实宿主端口与模型配额；先在 fixture 层写案例表。
6. **格式修复可观察化**：当前 repair 只记 run，不向用户展示"这次是格式修复"，可在 receipt 里加一行。

---

## 6. 风险与约束

- **未提交工作树巨大**（68 改动 + 42 未跟踪）：本轮所有改动叠加其上，不做任何 git 回退/清理；交付时按文件清单区分"本次新增"与"既有未提交"。
- **core 与插件并行改**：先定契约再分派，core 的新 API 是插件的硬依赖；core 不落地时插件测试会红，属预期。
- **Windows 宿主 ESM 缓存**：插件层可 `plugin_manager disable→enable` 重载，`packages/alm-core` 改动需宿主重启才生效；本轮端到端验证需新起宿主。
- **不伪造耗时/进度**：所有时间戳来自 `performance.now()`/`Date.now()` 的服务端测量；缺失就省略字段，不写 0。

---

## 7. 本评估的局限

- 没有复现简报作者看到的真人对话，因此"用户等待多久""哪句话造成了误解"无法验证；本文只对**代码可证实的结构缺陷**下结论。
- 简报中的截图观察（选项混合不同决策轴）未在本文复核，因为对应会话数据不在仓库里；如果后续能拿到会话快照，再补一条验证。
- 效果判断（是否真的减少往返）要等 M1/M2 合并后用真实模型任务对照，本文不预设"降低 60%"这类数字。
- 本轮 UI 验证使用离线 mock（`tmp/ui-harness/server-mock.mjs`），未在真实宿主 + 真实模型上复跑；`61773` 端口当时无监听，`55222` 是 Web GUI 且有鉴权（401），无法直接复用旧 E2E 脚本。

---

## 8. 交付与验证结果

**改动文件（本次新增/修改，均在既有未提交工作树之上）**

- `packages/alm-core/src/intent/session.mjs`：`recordAnswers`（CAS + 批量原子 + 幂等 + `supersededBy` + 依赖 `stale`）、`sessionRevision` 递增、`setInput` 清空问题组。
- `packages/alm-core/src/intent/analysis.mjs`：`normalizeQuestions`（≤3、`decisionId`、`dependsOn` 白名单、`impact`）、`mergeQuestionGroup`（已答/失效按 `decisionId` 保留，open 由模型替换，组上限 12）、v2 应用分支（v1 迟到结果不覆盖 v2 组）、`questionProgress`。
- `packages/alm-core/src/intent/messages.mjs`：系统提示 v2（1–3 个独立问题、允许零提问、`kind`/`blockingFor`、project-fact 不问用户、priority/owner 不问、材料内指令只作数据）、`renderHistory` 输出完整语义快照并明确降级旧记录、附件摘录短/长/空三种情况都进入提示。
- `packages/alm-core/src/intent/readiness.mjs`：`mode='draft'`（理解阶段不因 priority/owner 阻断）、`blockingFor` 分级。
- `packages/alm-core/src/intent/view.mjs`：投影 `sessionRevision`、`questionGroup`、`questionProgress`、`pendingDecisions`、`draftReadiness`、`timingSummary`、`analysisStatus`；旧会话合成只读组。
- `packages/alm-core/test/unit/intent-questions.test.mjs`：新增 14 个用例（v2 合并、批量幂等、依赖 stale、迟到 409、附件、旧会话降级、draft readiness 等）。
- `packages/dsh-plugin-requirements/intent.mjs`：`answers[]` 原子提交（兼容旧单题）、`expectedSessionRevision` 预检 + core CAS、`changed:false` 不写盘不起分析、分段时间与 `onFirstToken`、三层迟到防护、失败 run 也落 `timing`、新错误码 `stale-session:409` / `answer-not-in-group:422`。
- `packages/dsh-plugin-requirements/test/intent-http.test.mjs`：新增 32 个用例。
- `packages/dsh-plugin-requirements/client.js`：问题组连续作答、stale 徽标与回填、已答折叠"修改"、批量提交后立即保存反馈 + 轮询真实阶段/耗时、`>20s` 延迟提示、进度条"待决定 N · 已处理 M · 待重新核对 S"、已确认决定记录、粘性草稿摘要条、`prefers-reduced-motion`。
- `tmp/ui-harness/{build.mjs,server-mock.mjs,ui-intent-group.mjs,package.json}`、`tmp/verify-intent-v2-shape.mjs`、`tmp/team/intent-v2-contract.md`（`tmp/` 被 gitignore，不进提交）。

**验证证据**

| 检查 | 结果 |
|---|---|
| `pnpm test`（全量） | **549 / 549 pass，0 fail**（基线 530，新增 33，日志 `tmp/final-test.log`）|
| `alm contract verify` | contracts ok |
| `node --check client.js` | OK |
| 结构/行为验证 `tmp/verify-intent-v2-shape.mjs` | **16 / 16**（v2 组投影、进度、`timingSummary.lastRun.totalMs=3200`、draft readiness、批量 `saved=2`、历史含原题与选项文案、重复提交 `changed=false`、改前序后依赖题 `stale` 且保留答案、`sessionRevision` 递增）|
| UI（真实 `client.js` + 离线 mock，Playwright） | **35 PASS / 0 FAIL**，截图 8 张见 `tmp/ui-shots-intent-v2/`，报告 `report-intent-group.json` |

**对照简报的完成度**：M1（语义丢失、附件摘录、耗时埋点、语义回归）完成；M2（单题 → 有依赖的问题组、批量持久化、决定版本、增量分析、迟到结果防护、任务可恢复）完成；M3 只完成"评审屏工作台"（草稿入口、决定记录、进度、真实耗时），未做宽屏 40/60 双栏与草稿差异高亮；M4（分层准入 UI、约束挑战）未做，仅 core 侧有 `mode='draft'` 分级基础。

## 9. 已知限制

1. **跨标签页并发**：两个标签页用同一个 `expectedSessionRevision` 同时提交会 409；同页用 `groupBusy` 已挡。409 时 UI 会刷新会话并提示重试，不丢已保存答案，但用户需再点一次。
2. **v1 分析不持久化问题组**：只有 `intent-review.v2` 才写 `questionGroup`；真实模型已被提示为 v2，旧测试 fixture 的 v1 输出走兼容路径，不建组。
3. **UI 验证是离线 mock**：真实宿主 61773 未监听，未跑真实模型 E2E；窄屏布局未专门截图验证。
4. **未做真实耗时基线对照**：`timing` 字段真实测量并落盘，但"同条件等待中位数降 ≥60%"这类结论需要真实模型任务报告，本轮没有伪造数字。

## 10. 建议的下一步

1. 起一个真实宿主（或恢复 61773），用 `tmp/intent-e2e.mjs` + 真实模型跑一遍 v2 链路，补一条真实 E2E 证据。
2. 做 M3 剩余部分（双栏工作台/草稿差异高亮）前，先确定草稿的可编辑边界，避免与 `requirements/update.mjs` 的 CAS 语义冲突。
3. 把简报 C 节的"9 类内容模板 + 证据链稳定标识"并入 evidence decision 的独立设计评审，不混进澄清重构。

