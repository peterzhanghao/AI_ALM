# 失败监控与缺陷改进闭环：评估 + 设计契约（2026-11-02）

## 1. 评估：spec 与当前实现的对照

| spec 要求 | 现状 | 判断 |
|---|---|---|
| 监控澄清/评审/开发/测试/流程衔接 5 阶段 | 已有：`intent/*`（澄清）、`ai-review.mjs` + `review/executor.mjs`（评审）、`run.mjs` + `startDeliveryRun`（开发）、`acceptance.mjs`（测试）、`changes/open.mjs`（衔接） | 可接入，但**没有统一失败事件层**；失败目前只体现在 `run.failure` / `decision.state=failed` / 异常响应里，不留证据链 |
| 区分业务结果/取消/外部依赖/插件缺陷/待分析 | `decision.mjs` 只有 `failed`（执行失败）与 `blocked`（评审阻塞）两类；`preflight.mjs` 有 `carry-over`/`needs-decision` | **必须新增分类维度**，否则会把"评审不通过"误当缺陷 |
| 失败记录字段（事件/运行/阶段/证据/快照/重试） | `run.mjs` 有 events/attempts/heartbeat/checkpoint；candidate 有 treeHash 快照 | 复用 run + candidate 快照，新建失败事件记录 |
| 原因分析（结构化、区分已证实/假设、分析失败仍留痕） | 无 | 新增：分析由插件层 LLM 生成，core 只校验结构并落盘；`analysisStatus: pending|complete|failed` |
| 自动创建"来源=缺陷"的需求，初始待确认 | `createRequirement` 不写 `SOURCE:`；无 defect 模型 | 需扩展 `create.mjs` 支持 `source`；新建 defect 台账表达"待确认"（不占用交付状态机） |
| 去重/指纹/重复计数/疑似回归/幂等 | 无 | 新增 fingerprint = sha256(requirement + stage + errorType + component + testIds)，**不用错误文案**；同指纹未关闭 → 累加 occurrence；已关闭再现 → `regressionSuspected` |
| 用户确认前不动代码 | 现有 `startDeliveryRun` 只有显式点击才启动 | 天然满足：defect 只落记录；确认 = 一次显式授权，落 `authorization{actor,at,scope,defectRevision}` |
| 确认后复用需求工作流迭代 | `startDeliveryRun`→run→decision→candidate→signoff | **直接复用**：确认后对缺陷需求调用同一入口，不新建执行器 |
| 迭代失败追加同轮 / 独立新问题建子缺陷 | run 支持同 run 追加 answer/resume | 复用 resume（回答并继续）+ 同指纹合并 |
| 页面：来源筛选/待确认入口/缺陷标记/时间线/监控设置 | 列表 6 工作视图、`DeliveryPill`、`CurrentStateStrip`、SignoffModal/ReleaseModal | 新增来源筛选、待确认缺陷入口、缺陷详情（时间线）、确认弹窗、监控设置 |
| 幂等/重启恢复/不重复提单 | 无失败层 | 失败记录按 `(runId, stage, step, fingerprint)` 幂等键去重；防御重复投递 |

**结论**：方向适合本插件，但要按"最小真实闭环"落地，砍掉与当前阶段不匹配的部分：

- 保留：统一失败事件 + 5 阶段接入、分类（业务结果不提缺陷）、结构化分析、指纹去重、自动建"缺陷需求"（待确认）、确认/暂缓/忽略/关联、确认后复用执行器迭代、列表与详情 UI、监控开关。
- 降级：不做独立工作流引擎；缺陷状态是 `.alm/defects/*.json` 的台账状态，交付仍由 `delivery/candidate/decision` 派生；不做逐阶段超时守护（沿用 run 心跳 10min，超时由 `sweepStaleRuns` 记失败事件）。
- 不做（本轮）：跨仓库缺陷聚合、告警通知外发、自动修复重试策略调参。

## 2. 数据契约

### 2.1 失败事件 `packages/alm-core/src/requirements/failure.mjs`

文件：`.alm/failures/<FAIL-ID>.json`，ID = `FAIL-<requirement>-NNN`（无需求时 `FAIL-<project>-NNN`）。

```json
{
  "schema": "alm.failure.event/v1",
  "id": "FAIL-REQ-ALM-001-001",
  "requirement": "REQ-ALM-001",
  "requirementRevision": 1,
  "run": "RUN-001",
  "change": "CHG-ALM-001",
  "stage": "clarify|review|develop|test|handoff",
  "step": "string",
  "at": "ISO",
  "kind": "product-defect|business-outcome|user-cancelled|external|plugin-defect|unknown",
  "kindLabel": "产品缺陷",
  "errorType": "string",
  "summary": "string",
  "evidence": {
    "logs": ["path#anchor"],
    "artifacts": ["path"],
    "snapshot": { "headSha": "…", "treeHash": "…" }
  },
  "attempt": 1,
  "outcome": "failed",
  "fingerprint": "fp_…",
  "defect": null,
  "dedupeKey": "sha256(run|stage|step|fingerprint)",
  "analysisStatus": "pending|complete|failed",
  "analysis": null,
  "createdAt": "ISO",
  "updatedAt": "ISO"
}
```

导出：

- `FAILURE_SCHEMA`、`FAILURE_DIR='.alm/failures'`、`FAILURE_KINDS`、`FAILURE_KIND_LABELS`、`FAILURE_STAGES`
- `classifyFailure({ error, stage, step, context })` → `{ kind, errorType, reason, confidence }`。规则（按序）：
  1. `error.code ∈ {cancelled, run-cancelled}` 或 `context.cancelled` → `user-cancelled`
  2. 网络/服务类：`ECONN* / ETIMEDOUT / EAI_AGAIN / 429 / 5xx / quota / unauthorized(401) / EPERM|EACCES(权限)` → `external`
  3. 业务结果：`context.businessOutcome === true`（评审不通过、等待用户补充信息、需求未通过）→ `business-outcome`
  4. 插件自身：`error.code ∈ {module-stale, carrier-unavailable, preset-unavailable, run-transition-invalid, state-*}` 或 `error.pluginFault === true` → `plugin-defect`
  5. 其余非空错误 → `product-defect`；证据不足 → `kind:'unknown'`, `confidence:'low'`
- `failureFingerprint({ requirement, stage, errorType, component, testIds })` → `fp_<sha256 前 16>`（不含 summary/message）
- `recordFailure({ root, requirement, requirementRevision, run, change, stage, step, error, kind, analysis, evidence, attempt, apply })` → `{ created, deduped, failure, kind, summary }`
  - `dedupeKey` 相同且 24h 内 → `deduped:true`，只更新 `updatedAt`/`attempt`，不新增文件
  - 敏感信息脱敏：`Bearer …`/`sk-…`/`token=…`/`Authorization: …` → `<redacted>`
- `listFailures(root, { requirement, kind, limit })`、`readFailure(root, id)`
- `updateFailureAnalysis({ root, id, analysis, status, apply })` — `analysis` 结构：
  `{ what, expected, actual, impact, directCause, rootCause, evidence[], confidence, missing[], fixes[], tests[] }`，`status: complete|failed`；`failed` 时保留 `analysisStatus:'failed'` 与 `missing`。
- `attachAnalysis({ error })` 不得抛错：分析失败不覆盖原始失败记录

### 2.2 缺陷台账 `.alm/defects/<DEF-ID>.json`（schema `alm.defect/v1`）

```json
{
  "schema": "alm.defect/v1",
  "id": "DEF-REQ-ALM-001-001",
  "requirement": "REQ-ALM-001",
  "title": "…",
  "status": "awaiting-confirmation|confirmed|fixing|verifying|awaiting-acceptance|closed|deferred|ignored|failed",
  "fingerprint": "fp_…",
  "source": { "kind": "failure-monitor", "firstFailure": "FAIL-…", "lastFailure": "FAIL-…" },
  "occurrences": [{ "failure": "FAIL-…", "at": "ISO", "run": "RUN-…", "evidence": {...} }],
  "occurrenceCount": 1,
  "analysisStatus": "pending|complete|failed",
  "analysis": { ...同上... },
  "impact": { "stage": "test", "requirement": "REQ-ALM-001", "severity": "P1", "reason": "…" },
  "authorization": null,
  "iterations": [{ "at": "ISO", "run": "RUN-…", "change": "CHG-…", "result": "running|failed|awaiting-acceptance|accepted", "note": "…" }],
  "regressionSuspected": false,
  "ignore": null,
  "linkedRequirements": ["REQ-…"],
  "timeline": [{ "at": "ISO", "type": "failure|analysis|created|confirmed|run|verified|closed|ignored|deferred|regression", "summary": "…" }],
  "createdAt": "ISO",
  "updatedAt": "ISO"
}
```

导出：

- `DEFECT_SCHEMA`、`DEFECT_DIR='.alm/defects'`、`DEFECT_STATES`、`DEFECT_LABELS`（待确认/已确认/修复中/验证中/待验收/已关闭/已暂缓/已忽略/迭代失败）
- `DEFECT_TRANSITIONS`：awaiting-confirmation→confirmed/deferred/ignored/closed；confirmed→fixing;fixing→verifying/failed;verifying→awaiting-acceptance/failed;awaiting-acceptance→closed;deferred→confirmed/ignored/closed;ignored→closed;failed→awaiting-confirmation/confirmed/closed；closed→[]
- `findDefectByFingerprint(root, fingerprint)`
- `planDefect({ root, failure, analysis })` → `{ schema:'alm.defect.plan/v1', action:'create'|'merge'|'regression'|'skip', fingerprint, defect, requirementId, title, requirementPlan }`
  - `skip`：kind ∈ {business-outcome, user-cancelled, external} 且无 plugin-defect 证据 → 不建缺陷（外部则返回 `event-only:true`）
  - `merge`：同指纹且状态非 closed → 只累加 occurrence
  - `regression`：同指纹且 closed → `regressionSuspected:true`，回 awaiting-confirmation
- `createDefect({ root, failure, analysis, actor='ai:monitor', apply })` → `{ created|merged|regression, defect, requirement?: {requirementId, file} }`
  - 建缺陷时同时 `createRequirement({ source:'defect', title, priority, brief, defect:{id} })`，需求正文含标题/问题描述/触发条件/复现步骤/预期/实际/影响/证据/分析/修复建议/验收标准
- `confirmDefect({ root, defectId, actor, scope, apply })` → 必须 `awaiting-confirmation|deferred`；写 `authorization:{actor,at,scope,defectRevision}` + status confirmed + timeline
- `deferDefect`、`ignoreDefect({ reason, scope, expiresAt })`、`linkDefect({ requirementId })`
- `recordIteration({ root, defectId, run, change, result, note, apply })`
- `updateDefectStatus({ root, defectId, status, note, apply })`（校验 DEFECT_TRANSITIONS）
- `defectView({ root, requirementId })`、`listDefects(root, {status, requirement})`、`defectSummary(root)` → `{ awaitingConfirmation, confirmed, fixing, verifying, awaitingAcceptance, total }`

### 2.3 `create.mjs` 扩展

`planRequirement({ ..., source })`：`source` 非空时在 sdoc 增行 `SOURCE: <source>`（默认不写，保持现状），brief 增"## 缺陷来源"节；`createRequirement` 透传。

### 2.4 监控设置 `.alm/monitoring.json`

`{ schema:'alm.monitoring/v1', enabled:true, stages:['clarify','review','develop','test','handoff'], notify:true, updatedAt, updatedBy }`；`readMonitoring/writeMonitoring`；关闭监控只停止新记录，历史保留。

## 3. 插件接入（index.js）

- 失败钩子：`startDeliveryRun`（carrier/preset/create 失败）、`run` settle catch（执行失败）、`resumeDeliveryRun` 失败、`preflight` 内 acceptance 失败（kind 由 classify 定，业务结果不提缺陷）、`ai-review` 解析失败、`handleWrite` 顶层 catch（plugin-defect）。
- 路由：`/api/alm/requirements/failure`（`mode: list|detail|analyse`）与 `/api/alm/requirements/defect`（`mode: list|summary|plan|create|confirm|defer|ignore|link|iteration|detail|settings`）。
- `analyse` 走现有 `llm.stream`（无工具、单轮），失败则 `analysisStatus:'failed'` 并保留待确认缺陷。
- 确认后：`confirmDefect(apply)` + `startDeliveryRun({root, requirementId: defect.requirement, ...})` 复用执行器；run 结束回写 `recordIteration`。
- 幂等：同一 `dedupeKey` 重复投递不重复建缺陷；`startDeliveryRun` 已有 active run 时复用。

## 4. 界面（client.js）

- 来源筛选 `来源：全部 / 手动创建 / 缺陷`（`item.sources.includes('defect')`），与工作视图叠加。
- 顶部「待确认缺陷 N」入口（来自 `defectSummary`），点开 DefectInbox。
- 列表行：缺陷标记 `缺陷` pill + 失败阶段说明；重复次数 `×N`。
- DefectModal：摘要/分析（区分事实与假设）/证据/关联需求/时间线/操作（确认并迭代、编辑后确认、暂缓、忽略填原因、关联已有需求、监控设置）。
- 确认后跳「已确认 → 修复中」，复用现有 run 展示。
- 监控设置面板：启用开关、阶段勾选、通知开关；明确显示"监控正常运行/已暂停"，关闭不删历史。

## 5. 测试与验收（可执行）

1. `failure.test.mjs`：分类矩阵（业务结果/取消/外部/插件/未知）、指纹稳定且不含错误文案、24h 幂等、脱敏。
2. `defect.test.mjs`：plan 四种 action、同指纹合并计数、closed 再现 → regression、confirm 授权绑定 revision、状态流转校验、confirm 前不产生 run。
3. 插件 `defect-api.test.mjs`：record→create→confirm 全链路（fake llm/agents）、confirm 后调用 startDeliveryRun、重复投递不重复提单、失败不阻断原错误。
4. 真实宿主 E2E（隔离 profile）：造一次外部分类失败（不建缺陷）+ 一次测试失败（建缺陷→确认→复用执行器→run 记录出现 iteration）→ 列表数据与 API 一致。
5. 全仓测试 + `alm contract verify`。

## 6. 实施记录（2026-11-02）

已按"最小真实闭环"落地，代码与测试：

| 层 | 文件 | 内容 |
| --- | --- | --- |
| 核心 | `packages/alm-core/src/requirements/failure.mjs` | `alm.failure.event/v1` 与 `alm.defect/v1` 两个台账；分类（取消/外部/业务结果/插件缺陷/产品缺陷/未知）、不含错误文案的指纹、24h 幂等去重、结构化分析（事实与假设分开、脱敏、分析失败留痕）、`planDefect` 四动作（create/merge/regression/skip）、`confirmDefect` 授权绑定缺陷修订、状态机与时间线、监控开关 |
| 核心 | `packages/alm-core/src/requirements/create.mjs` | 需求新增 `source`：缺陷单写 `SOURCE: defect` 并在 brief 追加"缺陷来源"节；不传 source 时输出逐字节不变 |
| 核心 | `packages/alm-core/src/model/asset.mjs` | `SOURCE_KINDS` 增加 `defect`（否则 FMT-001 会让缺陷需求解析失败、列表不可见） |
| 插件 | `packages/dsh-plugin-requirements/index.js` | `/api/alm/requirements/{failure,defect}` 读写路由；`monitorFailure` 接入验收失败、执行会话失败、写入失败；`monitorAcceptanceFailure`；确认后调用现有 `startDeliveryRun` 复用执行器；run 结束/失败时 `closeDefectIteration` 把迭代推进到验证/失败 |
| 插件 | `packages/dsh-plugin-requirements/query.mjs` | 列表项带 `defect`（状态/次数/疑似回归）；缺陷需求下一步：待确认或迭代失败→`确认缺陷并开始迭代`、已暂缓→`恢复缺陷修复`、验证中→`运行验收`；源需求不抢缺陷动作 |
| 界面 | `packages/dsh-plugin-requirements/client.js` | 来源筛选（全部/手动创建/缺陷）、「待确认缺陷 N」入口、缺陷标记与失败阶段、缺陷详情（分析/证据/时间线/迭代）、确认（可编辑范围）/暂缓/忽略/关联、监控设置面板 |

规则与边界：监控异常不覆盖原错误（所有钩子 try/catch，回执带 `skipped/reason`）；确认前不建 run、不动代码；授权绑定缺陷修订与范围，范围变了重新确认；一次确认授权一轮，不自动无限重试；被忽略/暂缓的缺陷可恢复；缺陷关闭后再现标"疑似回归"。

验证：

- `node --test "packages/*/test/**/*.test.mjs"` = **530/530**（新增 `failure.test.mjs` 29 条、`defect-api.test.mjs` 11 条、需求创建 +3 条）。
- 隔离真实宿主（profile p2，端口 61990）完整闭环：把 e2e 仓库 README 的 `DONE:` 改回 `TODO:`（真实红测试）→ `POST /api/alm/requirements/acceptance {apply:true}` 返回 fail → 自动记录 `FAIL-REQ-DEMO-001-001`（stage=test、step=acceptance、kind=product-defect）并建缺陷需求 `REQ-DEMO-002`（`SOURCE: defect`，状态待确认）→ `defect {mode:'confirm'}` 绑定授权并启动真实执行会话 `RUN-003`（carrier=dsh-session）→ 会话真的把 README 改回 `DONE:` → run 结束为等待输入时缺陷自动从"修复中"推进到"验证中"，迭代记录 `awaiting-acceptance`。
- 真实宿主上还验证：`defect {mode:'summary'}` 计数与列表一致（verifying 1）；缺少 `.alm/project.json` 时降级为 `skipped: monitor-failed`，不覆盖原验收失败。

已知限制（明确未做）：逐阶段超时守护（沿用 run 心跳 10 分钟 + `sweepStaleRuns`）；跨仓库缺陷聚合与外部告警；自动重试调参；缺陷关闭目前需人工用 `updateDefectStatus` 推进（验收通过后的自动关闭尚未接线）。

补充（同日收尾）：

- 缺陷台账现在也会保存原因分析：`analyse` 成功后调用 `updateDefectAnalysis` 把同一份分析（含事实/假设/缺失信息/置信度）写进 `.alm/defects/<DEF>.json`，缺陷详情不再只显示"尚未分析"。
- 缺陷进入"验证中"后，需求的下一步动作自动变成「运行验收」（源需求保持自己的下一步，不被缺陷动作抢走）。
- `analyse` 依赖可用的默认模型。隔离验证宿主里插件直接调用 `llm.stream` 返回"模型调用失败"（该 profile 的账号凭据 403），此时按设计降级为 `analysisStatus: failed`，缺陷仍停在待确认/验证，不影响缺陷台账与迭代记录；在配置了默认模型的桌面宿主中会正常产出分析。

## 7. 收尾补充（同日第二轮）

### 7.1 执行诚实性：心跳、假活与中断恢复

真实缺陷修复暴露出三个"看起来在推进、其实没有"的问题，已全部修掉：

| 问题 | 症状 | 修法 |
|---|---|---|
| 心跳从不刷新 | run 记录的 `heartbeatAt` 只在创建/状态变更时写，长 turn 里永远冻结，10 分钟后被判不 active；UI 隐藏「取消推进」却仍显示"运行" | `run.mjs` 新增 `touchRun`；插件用 45s 定时器保活，turn 结束（settle）与取消时停表 |
| `sweepStaleRuns` 无人调用 | 宿主重启/进程崩溃后孤儿 run 永远 `running`，这才是真正的"假装推进中" | 插件 `reconcileRuns` 在每次 start/resume/restart 前执行，把丢心跳的 run 标 `failed`（`heartbeat-lost`）并把对应缺陷迭代标失败，检查点保留 |
| 没有中断恢复路径 | 中断后「交给 AI 推进」被 in-progress 排除，面板死胡同 | 新增 `mode:'restart'` 与「恢复推进」：新建 run 并带上一轮 `checkpoint.done/open` 提示词，明确"从中断处继续、不要重做" |

界面同时把「AI 当前动作」改成三态：**运行/等待回答/已中断（最后活动 …）**，并在等待回答时显示「回答并继续」、中断时显示「恢复推进」；「待你决定」在中断时直接写"本轮推进已中断：恢复推进或取消"，不再显示"无（AI 推进中）"。

规则边界：`waiting-input` 与 `paused` 是设计内的空闲（等人类、被暂停），不算心跳丢失，不参与清理。

### 7.2 验收通过 → 自动关闭缺陷

`closeDefectsOnAcceptance({root, requirementId})`：对该需求处于 `verifying` / `awaiting-acceptance` 的缺陷记录 `accepted` 迭代并推进 `verifying → awaiting-acceptance → closed`；dry run 只报告会关闭哪些。插件 `monitorAcceptanceResult` 在验收 `pass` 时调用它（失败仍走原 `monitorAcceptanceFailure`），HTTP 验收路由与 preflight 内的验收都接同一入口。

真实验证：`REQ-ALM-002` 登记的缺陷回归命令（`acceptance-command-record.test.mjs` + `defect-api.test.mjs`）实跑 `result: pass`、证据写入 `.alm/acceptance/REQ-ALM-002/64ec15e6…json`，随后 `DEF-REQ-ALM-002-001` 由 `verifying` 自动关闭为 `closed`（iterations 追加 `accepted`）。

## 8. 人类验收路径修复（同日第三轮）

真实缺陷 REQ-ALM-002 走到"待验收"时，人工签收被 `coverage-incomplete` 挡住：`signReview` 只读取了门禁评审报告，没有把 AI 评审报告（`.alm/reviews/<REQ>.ai.json`）传给 `storedReviewShape`，于是 `adoptionCoversRoles` 永远为假，"AI 评审已覆盖视角"在签收路径里失效。

修法：`packages/alm-core/src/review/executor.mjs` 的 `signReview` 改为 `storedReviewShape(stored, currentHash, readAiReviewReport(repo, asset.id))`，与面板的 `reviewView` 看到同一份评审事实；新增回归测试 `an adopted AI review covers the review angles a human sign-off then accepts`（全 skip 的五视角 + AI 评审 warn + 采纳 → 决策 `ready-for-human`、topGap `coverage-overridden`、签收允许 → `verified`）。

由此 REQ-ALM-002 完成真实全链路：重写 brief 补齐证据 → 重跑门禁评审 → AI 评审 verdict warn → 采纳（只写 adoptions）→ 重新登记并执行验收命令（pass，绑定 requirementHash `8050037418…`/testRevision `ce371d857…`）→ 生成交付候选 `CAND-REQ-ALM-002-003` → `human:local` 签收 → `verified` → 归档关闭（`.alm/closures/REQ-ALM-002.json`，reason 记录在交付状态里）。

## 9. 推进语义修正：为什么"都显示待推进"、为什么点推进失败（2026-11-03）

现场：需求列表 4 条里 3 条显示「待推进」，点「交给 AI 推进」分别得到 409（review-missing / review-blocked），另有一条在已有运行的情况下又新建了变更。核查后确认有四个独立原因，前三个是缺陷，第四个是环境。

1. **等待人类被当成"没有推进"**：`deliveryStateFor` 只用 `runCanProgress()` 判「推进中」，而它刻意排除了 `waiting-input`/`paused`。于是所有等回答、等验收的轮次全部回落 `pending`（source `run-idle`），列表看起来"全都没在推进"。修正：`waiting-input`/`paused` 仍是同一轮交付，返回 `in-progress` 并带 `waitingForHuman: true`；只有 `failed`/`cancelled`/`done`/心跳丢失才回落 `pending` 并保留中断原因。
2. **下一步动作抢跑**：`nextActionFor` 先按证据状态（`failed`/`unchecked`）给「运行验收」，等待回答的需求因此被建议去跑验收，而不是回答问题或恢复推进。修正：先看运行事实——心跳丢失 → 恢复推进；有决策请求 → 回答并继续；本轮交接但没完成（`idleHandback`）→ 恢复推进；真在跑 → 查看推进；运行已死（failed/cancelled）→ 恢复推进；之后才轮到验收/评审类动作。
3. **中断被伪装成等待**：插件卸载时 `ctx.effect` 里对仍在跑的会话执行 `cancel+dispose`，`whenIdle` 的 settle 把它记录成 `waiting-input`（且 `checkpoint` 为空）。宿主重启/插件重载后，用户看到"等待输入"其实是"被中断"。修正：卸载时只对仍处于活动状态（且非 failed/cancelled）的运行写入 `failed` + `failure.code='host-restart'`，settle 不再覆盖终态；`resumeDeliveryRun` 接受被宿主重启中断的运行，用新会话继续并保留原回答。
4. **运行中的宿主是旧 core**：桌面宿主 09:27 启动，core 文件 10:17 之后才改，因此 API 里连 `idleHandback` 字段都没有。core 改动必须重启宿主才生效（插件层文件可热重载，`packages/alm-core` 不行）。

顺带修正的重复派单：`start` 在存在活动运行时直接返回 `{applied:false, reused:true, execution:{reused:true, reason:'run-active'}}`，不再新建变更与任务卡。

验证：全仓 640/640；真实仓库派生状态为 REQ-ALM-004 推进中（等待回答）、REQ-ALM-003 待推进（运行被中断 → 恢复推进）、REQ-ALM-001 推进中（回答并继续）、REQ-ALM-002 已关闭；隔离宿主（新 core）上 `start` 返回 `reused:true` 未新建 CHG，`run restart` 真实拉起 RUN-005（running，心跳持续刷新）。
