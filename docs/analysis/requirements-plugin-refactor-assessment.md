# 需求插件重构评估：对《意图驱动、人类决策、AI 执行的需求推进模型》的二次评估

> 评估对象：`docs/analysis/intent-driven-requirements-lifecycle.md`（外部 AI 的评估结论）
> 评估方式：静态核对 + 4 项专项只读审计（状态模型 / 证据签收 / 执行链路 / 客户端界面），全部结论带 `file:line`。
> 基准：`develop` @ `64ec15e` + 当前未提交工作树（含 `alm-core/src/evidence/decision.mjs` 的未提交改动）。
> 结论时点：2026-11-02。

---

## 0. 一句话结论

**方向同意，诊断要改，顺序要换。**

codex 的"从状态流转工具 → 意图与交付推进台"这个方向，与用户在 m00002 表达的产品目标（人类给意图，AI 澄清/分析/评审/开发/测试，人类只做验收与发布决策）完全一致，应该采纳作为重构总纲。

但它有三处判断需要修正，其中两处是**归因错误**，一处是**漏掉了成本最低的架构选项**：

1. 真正的问题不是"采纳 AI 建议与签收共用语义"，而是 **AI 评审自身的结论（`verdict`/`findings`）从来没有进入证据层**——系统校验的是另一份 gate 报告的 `summary.blockers`，于是 AI 说 `block`、系统照样写 `approve` 签收。
2. 真正的问题不是"三套状态不一致"，而是 **`asset.status` 8 个值里只有 2 个有写入者**，`STATE-001` 在 UI 路径上恒为 `skip`。它不是"算错了"，是**根本没有状态机在跑**。
3. codex 把"接入持久执行器"当成必做的基础设施，但它没看到 **DSH 宿主本身就是 agent 运行时**。自建调度器是重写一个 agent loop；更可能的正解是插件只持久化 `runId + 检查点`，把执行外包给宿主会话。

因此重构第一步**不该**是改状态枚举、也不该是建 `Delivery/ExecutionRun/Release` 六个新对象，而是：

> 先关闭"AI 自签收 → 已验证"这条通道，把证据层已有的 `decision` 升格为主状态源，再谈执行器。

---

## 1. 我同意的部分（并说明为什么值得保留）

| # | codex 主张 | 我的判断 | 补充 |
|---|---|---|---|
| 1 | 人类只保留四类决定：范围/取舍、授权边界、验收、发布 | **同意**，这是本案的产品内核 | 还缺第五类：**取消/关闭**（当前被 `archived` 吞掉，见 §3.2） |
| 2 | 评审/开发/测试仍是质量检查，但不再要求逐阶段点击放行 | **同意** | 现状其实连"逐阶段点击"都做不到，是"点一次就没下文"（§4） |
| 3 | 采纳 AI 建议 ≠ 人类验收；自动检查通过只能到"待验收" | **同意，且这是 P0** | 当前实现直接违反（§3.1） |
| 4 | 状态分层：交付状态 / AI 阶段 / 执行状态 / 证据 / 决策 / 发布 | **同意方向** | 但**不需要新建六套对象**：`evidence decision` 已经把证据态拆成 8 档，缺的是 candidate 与 run 两个绑定 |
| 5 | 不变量 ①–⑦（尤其：未提交工作区要 hash 绑定；重复启动不产生重复任务） | **同意**，应写进验收测试 | 不变量 ④ 当前已被违反（§4.3） |
| 6 | 历史迁移不能只改枚举名 | **同意，但迁移对象说错了** | 见 §3.6 |
| 7 | 用 `REQ-ALM-001` 作首个闭环试点 | **同意** | 但它是被精心挑选过的"最干净"需求，只覆盖列表体验，覆盖不到风险分支 |

---

## 2. 我需要纠正的 5 处

### 2.1 codex §2.2 归因错：问题不是"语义共用"，是 AI 结论根本没进证据链

codex 说：`acceptReview` 用 `actor='ai:adopted'` 写 `decision:'approve'` 签收，导致"AI 采纳签收 = 人类验收"。

机制成立，但**归因不准确**。实际链条是：

- `acceptReview`（`packages/alm-core/src/review/executor.mjs:176`）校验的是 **gate 报告**的 `report.summary.blockers`（`executor.mjs:183`，即 `:78` 的 block 角色数）；
- 它**从不读** `.alm/reviews/<REQ>.ai.json` 的 `verdict` / `findings`；
- 采纳入口 `adoptAiReview`（`packages/dsh-plugin-requirements/ai-review.mjs:260-277`）对 `verdict`/`findings` **完全不检查**；
- 路由 `adoptStoredAiReview`（`packages/dsh-plugin-requirements/index.js:566`，`:579-585` 把 gate 报告喂给 `acceptReview`）。

磁盘实证（同一需求、同一天）：

| 产物 | 时间 | 内容 |
|---|---|---|
| `.alm/reviews/REQ-ALM-001.ai.json` | 2026-10-31T01:55Z | `verdict: "block"`，F1/F2 两条 `severity: block`（"目标不可度量""范围失控"） |
| `.alm/reviews/REQ-ALM-001.json` | 2026-10-31T23:57Z | 五角色全 `skip`，`summary.blockers: 0` → 写入 `signoff{actor:'ai:adopted', decision:'approve'}` |

`index.js:781-782` 的注释还写着"blocked 不算通过"，与实现正好相反。

**所以更准确的说法是**：AI 评审在产品里是一份"建议书"，其质量结论与证据层之间没有数据通路。`actor` 用 `ai:adopted` 只是症状，不是病根。**修复点不在改 actor 命名，而在把 `verdict` 接进 `decideEvidence` 的判定链**——否则即使把 actor 改成 `human:`，AI 的 block 照样被忽略。

### 2.2 codex §2.1 低估：不是"三套状态不一致"，是状态机只有一个空壳

codex 说"截图中'待评审'和'验收失败'能同时出现，来自不同数据源，未必是计算错误"。**实测：这个说法给了现状过多的肯定。**

- 全仓库只有两处写 `STATUS:`——`packages/alm-core/src/requirements/create.mjs:43`（硬编码 `proposed`）与 `packages/alm-core/src/requirements/archive.mjs:104`（写 `archived`；YAML 版 `archive-yaml.mjs:56`）。其余写入被 `requirements/update.mjs:20`（只允许 `title/priority/brief`，`:69-73` 拒绝其他字段）挡死。
- 于是 `accepted / in-progress / implemented / verified / deprecated / superseded` **六个状态没有任何写入者**，只能人工改文件。
- `STATE-001`（`packages/alm-core/src/gates/rules/state-001.mjs:8-17`）的整张 `ALLOWED` 转换表因此没有运行时输入：插件两处调用都不传 `--base`（`packages/dsh-plugin-requirements/index.js:376`、`query.mjs:435`），而 `gates/run.mjs:8-10` 里 `skip` 不影响结果，`commands.mjs:77-78` 没 base 就不构建 `baseAssets`。**这条 `level='block'` 的门禁在 UI 上永远不会拦任何东西。**
- 标签冲突实际是**四处**映射表，且冲突不只发生在表之间：同一详情屏可能同时出现列表用的"已验收"（`query.mjs:499` → `asset.mjs:28`）、详情头用的"已验证"（`client.js:36`）、决策条用的"已签收"（`evidence/decision.mjs:26`）。

**所以更准确的说法是**：`asset.status` 已退化为**人工可改的装饰字段**，产品真实的推进语义早已迁移到 `evidence decision` 上，两套并行。重构不是"统一三处标签"，是**承认 evidence 是主状态源，把 status 降级为 legacy 只读**。

### 2.3 codex §3.2 的 5 状态：维度对，但"存成字段"会再造一套可漂移的枚举

codex 建议需求只保留 5 个交付状态（待推进/推进中/待验收/已验收/已关闭）并给了转入条件。方向对，但两个问题：

1. **它把 5 个状态当成需求上的存储字段**。这等于把刚刚被证伪的 `asset.status` 模式再复制一遍——只要状态是"人写进去的值"，它就会和证据重新漂移。正确做法是**派生**：交付状态由 `candidate + decision + run` 三者推导，不落字段。
2. **"待验收"当前不可达，原因不是缺状态而是缺 candidate**。`decideEvidence` 里 `ready-for-human` 依赖 `legacyHumanSignoff`（`evidence/decision.mjs:291-296`），而 `query.mjs:521` 不传该参数，`SignoffModal`（`client.js:683`）是**无引用的死代码**。也就是说：代码里写了 `ready-for-human`/`verified` 两个人类侧状态，UI 上一条路径都到不了。

**结论**：5 状态的语义我采纳，但必须补一条 codex 没写的：**"待验收"必须绑定一个 `candidate`（内容 hash，含未提交工作区）**；否则"验收的是哪一版"这个问题在数据上无解，而这正是用户最终要做的那个决定。

### 2.4 codex §2.3 / 改造顺序第 2 片：漏掉成本最低的架构选项（B 方案）

codex 说"应在 Runner 接入后才把按钮解释为启动 AI 持续推进"，并把它排在第 2 片、要求"调度回执、有限修复循环、暂停恢复、重启恢复、幂等"。

事实部分**成立**：`start` 路由（`index.js:695-740`）→ `openChange`（`changes/open.mjs:159`）之后，系统只新增一条 `change` 记录 + `proposal.md/tasks.md/tasks.json` + 可选 `worktree`，**没有任何进程/队列/定时器**，`sdoc` 的 `STATUS` 也不改（`open.mjs:176` 是唯一写盘点）。仓库内 grep `runner|executor|dispatcher|scheduler|job|worker|queue|daemon|heartbeat|resume|subagent|child_process`，只命中评审聚合与验收执行。

但 codex **低估了 A 方案的代价、漏掉了 B 方案**：

| | A 自建持久执行器 | B 外包给 DSH 会话 |
|---|---|---|
| 要新建 | job 存储、调度+锁+幂等键、心跳/超时/暂停恢复、重启扫描、执行沙箱/工具循环、回执 API+UI 轮询（约 6–8 个模块） | 单个 `run` 记录（`runId, hostSessionId, changeId, candidateHash, phase, checkpoint, heartbeat`）+ 事件转发 |
| 核心风险 | 等于重写一个 agent loop；恢复/幂等只能靠故障注入验证 | 已通过隔离宿主和真实运行验证 `agents.create`、`agentPresets`、session 查询/观察和恢复边界；真实 Desktop 成功模型流与导航仍需实机验收 |
| 验证成本 | 高 | 中（spike 后可控） |

**我的判断**：`start` 按钮的语义问题（文案承诺"AI 开始开发"，实际只建目录）确实是 P0，但**解法顺序应该是"先做 spike 确认 B 是否可行，再决定 A"**——而不是直接排一个完整执行器进第 2 片。若 B 可行，第 2 片的工程量能砍掉一半以上；若不可行，A 也应先只做"队列+状态机+幂等+租约"，把编码交给外部 CI/人工，而不是第一期就做自循环。

### 2.5 codex §8 的历史迁移：迁移对象与事实不符

codex 说"旧 `verified` 若只有 AI 签收或自动测试记录，应保留历史标签并标'人类验收未确认'"。

**但代码里 `verified` 从来不能被写入**（§2.2）。所以线上不存在"旧 verified 数据"需要迁移。真正的迁移对象是：

- `.alm/reviews/*.json` 里已存在的 `signoff{actor:'ai:adopted', decision:'approve'}` 需要**降级为"AI 建议已采纳"事件**，不再具备任何验收含义；
- `.alm/acceptance/*` 中 `result:'fail'` 的证据要保持可查，不能因为重构被当作"未运行"；
- 旧 `archived` 的迁移尤其要说清：它现在同时承载"完成收口 / 取消 / 废弃 / 被替代"四种语义（`archive.mjs:20` 允许 `verified` 归档），**关闭原因只写在 `.alm/audit/requirements`（`archive.mjs:16/:204-219`），不在需求数据里**，且列表默认隐藏 archived（`client.js:7385-7386`）。这不是迁移问题，是数据模型缺字段。

---

## 3. codex 漏掉的问题（按严重度）

### P0-1 AI 评审 `verdict=block` 仍被采纳并写 `approve` 签收

已发生，见 §2.1 的时间戳实证。触发路径完全正常：`POST /api/alm/requirements/ai-review {action:'ai-review', apply:true}` → `adoptStoredAiReview` → `acceptReview`。

### P0-2 预检/开始开发有破坏性副作用且不可回滚

"开始开发"按钮挂载即执行（`client.js:2995-3008`）：先 `POST preflight {apply:true}`，再无条件 `POST start {apply:true}`。而 `preflight` 的 `apply` 会：

- **重写需求正文**（把"## AI 评审建议（已采纳 …）"追加进 brief，`preflight.mjs:187-226`）；
- 登记验收命令、写 `.alm/acceptance` 与 `.alm/preflight` 审计（`preflight.mjs:337-343`）。

失败时无回滚。用户以为点了"开始开发"，实际先改了需求文档。

而且这条路是**设计意图**，不是疏忽——`preflight.mjs:185-186` 的注释原文：

> `coverage. Adoption records the sign-off (and rewrites the brief through the reviewed suggestions), so the user never signs manually.`

"so the user never signs manually" 这句把 §2.1 的问题从"实现 bug"上升为"产品决策已偏航"：人类永远不需要签收。这也解释了为什么 `SignoffModal` 会变成死代码。

同屏还有一处自相矛盾：详情页脚"开始开发"的启用条件只是 `const canStart = !archived`（`client.js:2167`，按钮在 `:2444-2450`），因此 `verified`/`ready-for-human` 仍然可一键触发补齐证据与登记变更；而决策条在 `verified` 时按设计不渲染主按钮（`client.js:422`）。**同一个需求，页脚说"可以开始开发"，决策条说"没什么要做的"。**

### P0-3 重复点击"开始开发"不幂等，会堆积孤儿 change/task/worktree

- UI 调 `start` 时**不传 `changeId`**（`client.js:3004`），`openChange` 用 `nextChangeId` 自增（`open.mjs:91`、`:46-55`）；
- `already-exists` 409（`open.mjs:94-95`）只在显式传 `changeId` 时触发；
- 每次点击新建 `CHG-…-002/003` 与整套三张任务卡；`isolate` 时还建 worktree；
- `change` 之后永远是 `status:'open'`（全仓仅 `open.mjs:176`、`workspace.mjs:92` 两处写，都是 `'open'`），无取消/超时/回收路径，`open.mjs:182-183` 只回滚一半（删 change 文件，不回滚 worktree）。

**codex 把"重复启动幂等"写进了不变量 ④，但没发现当前实现已经违反它。**

### P1-1 通用测试命令被当成需求级验收证据

`preflight.mjs:39` 从 `package.json` 的 `test/ci/verify` 取第一条（实测落到 `node --test`），登记为 `REQ-ALM-001` 的验收命令。它的实际含义是"跑全仓 375 个用例"，与"创建时间倒序、稳定排序、长列表滚动"这些验收场景毫无对应关系。codex 说"通用脚本不能证明覆盖业务验收条件"是对的，但实际比它说的更强：**这不是覆盖不足，是验收证据与需求之间没有任何映射**，而 `decision` 仍然会基于它给出 `failed`/`ready`。

### P1-2 `REQ-ALM-001` 当前不是"待评审"，而是 `failed`

`.alm/acceptance/REQ-ALM-001/64ec15….json`：`result:'fail'`、`current:true`。所以在 `decideEvidence` 里它停在 `failed`（`decision.mjs:225-289` 的优先级链：`blocked > needs-clarification > failed > stale > review-not-run > coverage > acceptance-missing > acceptance-not-run > verified`）。

截图里"待评审 + 验收失败"并存，**根因是**：业务状态 Pill 用 `asset.status='proposed'`（"待评审"来自 `client.js:1295` 的 `item.statusLabel`），检查结果列用 `decision.label`（"执行失败"来自 `client.js:1056/1333`）。两个字段、两套语义，同屏并列。

### P1-3 五视角评审可以 0 覆盖通过

`aiAdoptedReview`（`decision.mjs:72-75`）在 AI 签收有效时短路 `missing-role` 检查（`decision.mjs:257`），配合 `summary.ready = blockers === 0`（`executor.mjs:84-88`，五角色全 `skip` 也算 ready），评审覆盖率检查形同无物。实测注入：AI 签收 + 五视角全 `skip` + 验收通过 = `verified`，且 `coverage.missingRoles` 为 5。

### P2-1 签收不绑验收证据

`acceptReview` 写的 `signoff` 只有 `actor/decision/at/headSha/contentHash/source/suggestions`（`executor.mjs:199-207`），缺 `requirementHash/testRevision/evidenceHash`（对比 `signReview` 的 `:285-296`）；`evidenceBound`（`:121`）无人消费。所以签收只能证明"某个 HEAD 上评审被采纳过"，证明不了它对应哪份验收证据。

> 需要为 codex 澄清一点：它担心的"需求改了验收仍绿"**不成立**——`content-hash.mjs:14-29` 的 hash 含 brief 正文，需求一变签收即失效。

---

## 4. 与用户产品目标的差距图谱（这是最该先给用户看的一张表）

用户在 m00002 描述的 6 步目标，按代码实证：

| 用户期望的步骤 | 现状 | 证据 |
|---|---|---|
| AI 帮我澄清 | **有（未提交）** | `alm-core/src/intent/*` + `client.js` 五屏 IntentModal（ALM-09.12，工作树未提交） |
| AI 帮我分析 | **一半** | 只读调查 `investigate.mjs`；AI 评审只产出 `plan` 4 步，无执行 |
| AI 帮我评审 | **有名无实** | 单轮 `llm.stream`（`ai-review.mjs:196-217`，无 tools、无循环），结论（`verdict`）不进入证据层 |
| AI 帮我开发 | **无** | `start` 只写目录（§2.4） |
| AI 帮我测试 | **一半** | 验收命令真跑（`acceptance.mjs:274/:299`，白名单 `node/npm/pnpm`），但入口是全仓 `node --test`（§3 P1-1） |
| 我做验收决策 | **无入口** | `signReview` 后端存在且强制 `human:<login>`+绑证据，但 UI 入口是死代码，`ready-for-human` 不可达（§2.3-2） |
| 我决定是否发布 | **无** | 无发布对象 |

**一句话**：用户目标的 7 个环节，**1 个做完、3 个半成品、3 个为零**。所以问题不是"流程太重"，而是"流程存在但执行侧是空的，于是每个状态都靠人手推"。这恰恰反证了 codex 的方向：减少交接的前提是先让 AI 真能推进。

---

## 5. 我的重构路线（与 codex 顺序的差异 + 理由）

### Phase 0：止血（1–2 天，不新增模型）
目标：让"谁能把需求推进到已验收"这条不变量成立。

1. `acceptReview` 不再写 `decision:'approve'` 签收，改为写独立事件 `adoption{actor:'ai:adopted', at, contentHash, appliedSuggestions}`；
2. `decideEvidence` 新增 `adoption` 输入：`adoption` 有效只能推到 `ready-for-human`（=待验收），**永不产生 `verified`**；
3. `verdict==='block'` 时禁止采纳（或允许采纳但强制 `blocked` 态，`index.js:781` 注释与实现对齐）；
4. 恢复一条人类验收路径（先接后端已有 `signReview`，UI 用最小入口，不必等新状态模型）。

**验收**：构造 `.ai.json verdict=block` + 五视角全 skip，确认最终状态不是 `verified`；人类验收必须落在 `human:*` 且绑 `requirementHash/testRevision`。

#### Phase 0 实施记录（2026-11-02，已完成）

按用户拍板"人类验收入口等 candidate 模型做完再上"，本轮只做前三条 + 迁移语义，第 4 条挪进 Phase 1。

已改：

1. `packages/alm-core/src/review/executor.mjs`：`acceptReview` → `adoptReview`，只追加 `adoptions[]`（`actor/at/contentHash/aiVerdict/aiFindings/suggestions`），不再写 `signoff`；`storedReviewShape` 把签收拆成 `signoff`（仅 `human:*` 才算 `signoffValid`）与 `adoption`（历史 `ai:adopted` 签收按 `legacy:true` 读成采纳）；`reviewView` 读取 `.alm/reviews/<REQ>.ai.json`（`alm.ai-review/v1`）并把 `aiReview` 注入评审视图；`adoptReview` 遇到 `verdict==='block'` 直接返回 `ai-review-blocked` 且不落盘。
2. `packages/alm-core/src/evidence/decision.mjs`：删掉 `aiAdoptedReview` 覆盖检查的捷径；AI `block` 结论进入判定链最高优先级（`ai-review-blocked`）；采纳有效只能到 `ready-for-human`（标签改为"待验收"），`verified` 只由人类签收产生；覆盖缺口由 AI 评审（pass/warn）承担时保留 `coverage-overridden` 警告项，不再静默跳过；决策对象新增 `aiReview/adoption/humanAccepted` 字段；`verified` 中文标签统一为"已验收"。
3. `packages/dsh-plugin-requirements/index.js` + `preflight.mjs`：采纳前先拒绝 blocked 报告（409 `ai-review-blocked`），preflight 遇到该错误转 `needs-decision`；采纳回执文案改为"进入待验收，仍需人工验收"。
4. `packages/dsh-plugin-requirements/client.js`：决策标签 `ready-for-human/verified` 改为"待验收/已验收"，评审区分别展示 AI 采纳与人工验收。

验证：

- `node --test "packages/*/test/**/*.test.mjs"` → **433/433 pass**（新增 5 条：AI 采纳不得 verified、block 硬阻塞、block 不可采纳、legacy `ai:adopted` 只读成采纳、历史签收迁移后仍可人工验收）。
- 真实数据：`REQ-ALM-001` 由 `.ai.json` 的 `verdict=block` 判为 **阻塞**（`ai-review-blocked`），采纳记录标 `legacy:true`，`humanAccepted:false`——不再是"已签收"。

### Phase 1：主状态源切换（3–5 天）
1. 新增 `candidate`：`{requirementId, revision, contentHash（含未提交工作区）, createdAt}`，验收证据与签收都绑它；
2. 交付状态**派生**而非存储：`待推进 / 推进中 / 待验收 / 已验收 / 已关闭` 由 `candidate + decision + run + archive` 计算；
3. `asset.status` 标记 legacy：只读展示、写路径全部关闭，`STATE-001` 要么随 base 一起启用、要么直接下线（不要保留一条永远 skip 的 block 级门禁）；
4. 关闭语义独立：`close{reason, actor, at}`，对齐 codex 的"已关闭"，同时让 archived 回归纯可见性属性。

**验收**：8 个状态中还能被写的只剩 0 个；所有状态展示对同一需求给出同一个中文名（消除四处映射表）。

### Phase 2：执行载体（先 spike，后定 A/B）
1. **Spike（0.5 天）**：用 `cordis_inspect_list` 列宿主服务，确认是否存在"创建会话/子代理并返回执行事件"的服务（插件已证可用 `llm`、`agentDefaultModel`）。
2. 若可行 → 走 B：`run` 记录 + `hostSessionId`，`start` = 建 run + 起会话；暂停/恢复 = 转发宿主信号；幂等 = `(requirementId, candidateHash)` 唯一键。
3. 若不可行 → 走 A 的最小版：只做 run 状态机 + 幂等 + 租约 + 失败回执，**编码不放进第一期**，避免重写 agent loop。
4. 无论 A/B：`start` 必须返回真实调度回执；不 ready 时不再靠 `acknowledgeGaps` 静默放行（`index.js:719-731` 现在只要前端传 `true` 就绕过，等于没有门禁）。

### Phase 3：界面按真实事实重做（可与 Phase 2 并行）
1. 主状态源切到 `decision` + 派生交付状态；`asset.status` 降级为副标签；
2. 主按钮矩阵由上下文派生，"开始开发"在 `verified`/`ready-for-human` 隐藏（`client.js:2167/2447` 当前仍可点）；
3. `PreflightModal` 拆成"预览 → 确认 → 执行"三步，`apply:true` 不允许在挂载时自动发（`client.js:2995`）；
4. "开始开发"加二次确认，明确告知会改 brief；重复点击必须命中幂等。

### Phase 4：发布对象（MVP 之后）
codex 第 5 片（独立 Release 对象）我同意其数据形状，但**反对它在 MVP 内**：当前连"人类验收"都没接通，先做发布是给空管道装阀门。

---

## 6. 与 codex 的收敛/分歧清单

| codex 主张 | 我的结论 |
|---|---|
| 产品定位改为"意图与交付推进台" | **采纳** |
| 减少交接、保留证据与人类验收 | **采纳**（但补充"取消/关闭"为第五类人类决定） |
| §2.1 三类状态不一致 | **部分成立但低估**：只有 2/8 状态有写入者，标签实为四处 |
| §2.2 采纳 AI 建议与签收共用语义 | **部分成立但归因错**：病根是 AI verdict 不进证据链 |
| §2.3 开始开发无真实执行 | **成立**，另补：预检有写副作用、无幂等、change 永不关闭 |
| §2.4 通用测试命令只是候选 | **成立且更强**：验收证据与需求无映射 |
| §3.2 五个交付状态 | **语义采纳，实现反对**：应派生不存储，且必须绑 candidate |
| §4 八步推进 | **采纳**，作为 AI 侧行为规范；但第 3 步的 runId/检查点应复用宿主能力 |
| §5 何时打断人类 | **采纳**，建议直接写成决策请求的 schema（问题/为何现在/推荐项/备选项/等待期可做什么） |
| §6 六个工作视图 | **采纳方向**，但"待我处理/AI 推进中"当前无数据源，需先有 run 与"当前用户"概念 |
| §7 六个新对象 | **部分反对**：Requirement/Evidence/HumanDecision 已有可用实现，先补 candidate/run/adoption/close 四个轻对象即可 |
| §8 五片顺序 | **调整**：加 Phase 0 止血；执行器先 spike 再定 A/B |
| §8 历史迁移 | **修正对象**：不存在"旧 verified 数据"，要迁的是 `ai:adopted approve` 签收记录 |
| 试点 REQ-ALM-001 | **采纳**，但它偏体验型，建议再补一个"AI 评审 block 必须拦住"的功能型负例作试点 |

---

## 7. 用户已拍板（2026-11-02）

1. **A 还是 B**：允许在 DSH 宿主里做 spike（列服务、尝试起一个会话）。→ Phase 2 先 spike，再在 A/B 间定案。
2. **人类验收的最小形态**：等 candidate 模型做完再上（不在 Phase 0 先做临时入口）。→ 人类验收入口并入 Phase 1。
3. **`asset.status` 的去留**：直接下线成 legacy 只读，接受对 `STATE-001` 与样例资产的影响。→ Phase 1 执行。
4. Phase 0 完成后继续后续 Phase，直到全部任务完成（已建 goal 跟踪）。

---

## 8. 实施进度（2026-11-02，进行中）

| 阶段 | 状态 | 落地内容 | 证据 |
|---|---|---|---|
| Phase 0 止血 | ✅ 完成 | AI 采纳与人类验收拆分：`acceptReview` → `adoptReview`（只写 `adoptions[]`，不再写 signoff）；AI 评审 `verdict=block` 进入判定链最高优先级；采纳最多到"待验收"；`signoff` 只接受 `human:*`；preflight 拒绝采纳被 block 的报告 | `packages/alm-core/src/review/executor.mjs`、`packages/alm-core/src/evidence/decision.mjs`、`packages/dsh-plugin-requirements/preflight.mjs` |
| Phase 1 主状态源 | ✅ 完成 | 新增交付候选 `CAND-*`（绑定需求内容哈希 + 未提交工作区文件哈希 + 验收哈希）；新增派生交付状态 待推进/推进中/待验收/已验收/已关闭（`deliveryStateFor`）；关闭记录 `.alm/closures/<REQ>.json` 带原因与人；`asset.status` 降为 legacy 只读（`STATE-001` 退役为空规则，`create` 不再写 STATUS） | `packages/alm-core/src/requirements/candidate.mjs`、`delivery.mjs`、`gates/rules/state-001.mjs` |
| Phase 2 执行载体 | ✅ 完成（隔离真实宿主 E2E 通过） | 宿主 session 作为执行载体：`RUN-*` 运行记录（队列/运行/等待输入/暂停/失败/取消 + 心跳超时）、启动回执只来自真实会话创建、重复点击复用同一轮不重复派单、插件卸载或人工取消时 `cancel` 会话并保留记录；执行会话在 `setup` 里 pin 权限（`workspace-write` + `approval:never`），否则无 UI 时 turn 会永久挂在审批上 | `packages/alm-core/src/requirements/run.mjs`、`index.js` 的 `startDeliveryRun/cancelDeliveryRun`、`test/execution.test.mjs`、`test/start-execution.test.mjs` |
| Phase 3 界面 | ✅ 主体完成 | 顶部 6 个工作视图（全部/待我处理/AI 推进中/待验收/已验收/已关闭）；交付状态 Pill 取代 legacy STATUS；详情首屏"交付状态 / AI 当前动作 / 交付候选 / 待你决定"四问；主按钮按交付上下文切换（交给 AI 推进 / 验收交付 / 决定发布）；接通人类验收 SignoffModal | `packages/dsh-plugin-requirements/client.js` |
| Phase 4 发布对象 | 🟡 MVP 完成 | 发布是独立对象 `REL-*`：候选=已验收交付集合，绑定 candidate/treeHash/验收哈希；人类授权后才可执行，候选变化使旧授权失效；执行结果（released/failed）追加记录，不改写验收事实 | `packages/alm-core/src/requirements/release.mjs`、插件 `release` 路由、`ReleaseModal` |
| Phase 5 失败监控 | ✅ 完成（隔离真实宿主闭环通过） | 统一失败事件 `.alm/failures/FAIL-*.json` + 缺陷台账 `.alm/defects/DEF-*.json`：五阶段接入、失败分类（业务结果/用户取消/外部依赖/插件缺陷/产品缺陷）、不含错误文案的指纹与 24h 幂等去重、结构化分析（事实与假设分开）、自动建"来源=缺陷"需求并停在待确认、确认后才复用执行器真实修复、run 结束自动推进到验证；监控异常不覆盖原错误 | `packages/alm-core/src/requirements/failure.mjs`、插件 `index.js` 的 failure/defect 路由与 `closeDefectIteration`、`docs/analysis/failure-closed-loop-design.md` |

**当前测试**：`node --test "packages/*/test/**/*.test.mjs"` = 601/601 通过（含 `failure.test.mjs` 30 条、`defect-api.test.mjs` 13 条、`release.test.mjs` 4 条、`run.test.mjs` 3 条、插件 `execution.test.mjs` 10 条、`start-execution.test.mjs` 1 条）。

**仍开放**：

1. **执行链路已在隔离真实宿主跑通**（见 `docs/analysis/dsh-host-services-spike.md` 末节）：start → 变更登记 → RUN-001 `queued→running` → 真实会话执行 64 次工具调用并改动仓库 → `node --test` 2/2 → turn 结束自动 `waiting-input`；重复点击 `reused`、取消后 `cancelled` 均实测。**仍待**：桌面宿主重启一次（`alm-core` 新模块需重启才加载）后，用你自己的需求点一次「交给 AI 推进」复核。
2. **审批交互**：执行会话已 pin 为 `approval: never` + `workspace-write`（人类点「交给 AI 推进」即授权本轮，沙箱边界替代逐次点击）。若将来要支持"高风险动作单独请示"，需订阅 `user-approval` 事件并把 run 标成"等待审批"。
3. **发布执行者**：人类授权后由 Runner 执行并回报结果（`recordReleaseExecution` 已能记录 released/failed），插件不伪造部署成功。
4. **决策请求的回答入口（2026-11-02 已补）**：执行器停在 `waiting-input` 并写了 `checkpoint.decision` 时，列表行动作、详情首屏「AI 当前动作」格与详情页脚都提供「回答并继续」；回答经 `POST /api/alm/requirements/run {mode:'answer'}` 追加进 `run.answers` 并以原文引用继续推进。同一宿主进程内续在原会话（`continueMode: 'same-session'`）；宿主重启后没有内存会话，降级为新会话续跑（`continueMode: 'resumed-session'`，`sessionId` 覆盖为新会话，历史回答保留）。已在隔离真实宿主实测：RUN-002 `waiting-input → 回答 → running → waiting-input`，且回答内容真的驱动了下一轮仓库修改。
5. **跨重启续跑**：宿主重启后 agent 对话不自动恢复；当前降级路径是"新会话 + 原文引用历史回答"（见上一条），对话级 `resume` 仍待验证。
6. **缺陷自动关闭（2026-11-02 已接线）**：修复迭代结束自动推进到"验证中"；缺陷原因分析写回缺陷台账（`updateDefectAnalysis`）；验收通过时 `closeDefectsOnAcceptance` 记录 `accepted` 迭代并自动关闭缺陷（`verifying → awaiting-acceptance → closed`），验收失败仍只记失败事件；真实仓库 `DEF-REQ-ALM-002-001` 已按此路径关闭。
7. **执行诚实性（心跳与中断恢复，2026-11-02 已补）**：run 记录由 45s 心跳保活，`runView` 区分 `active` / `stale`（心跳丢失）/ `awaitingAnswer`（等待人类）；`sweepStaleRuns` 已接到插件 `reconcileRuns`，进程死后的孤儿 run 会被标失败并保留检查点，而不是永远显示"运行中"；中断后列表与详情提供「恢复推进」（`POST /api/alm/requirements/run {mode:'restart'}`，新 run 带上一轮 checkpoint 继续），等待人类回答时提供「回答并继续」。已知限制：`waiting-input` / `paused` 视为设计内空闲，不参与心跳清理。

### REQ-ALM-002 的真实闭环（2026-11-03）

缺陷需求经「AI 评审 warn → 采纳 → 验收命令通过 → 交付候选 CAND-REQ-ALM-002-003 → human:local 签收 → 归档」关闭，`.alm/closures/REQ-ALM-002.json` 记录关闭原因；期间修复了「人工签收看不到 AI 评审报告导致 coverage-incomplete 死锁」的缺陷（executor.mjs signReview 未传 aiReview）。全仓测试 601/601。

## 附：本评估的证据来源

- 状态模型审计：`create.mjs:43`、`archive.mjs:104/:20/:141-152`、`update.mjs:20/:69-73`、`state-001.mjs:8-19`、`index.js:376`、`query.mjs:435/:498-527`、`gates/run.mjs:8-10`、`commands.mjs:77-78`、`client.js:36/:1295/:7385-7386`
- 证据签收审计：`executor.mjs:114/:176/:183/:199-207/:240-297`、`decision.mjs:26/:72-75/:225-296`、`ai-review.mjs:260-277`、`index.js:566/:579-585/:781-782/:890-896`、`content-hash.mjs:14-29`、`.alm/reviews/REQ-ALM-001.{json,ai.json}`
- 执行链路审计：`index.js:695-740`、`open.mjs:46-55/:91-95/:159-198`、`draft.mjs:92-134/:179-181`、`preflight.mjs:39/:187-226/:337-343`、`acceptance.mjs:14/:274/:299`、`ai-review.mjs:196-217`、`client.js:2995-3008`
- 界面审计：`client.js:42-51/:683/:1056/:1076-1095/:1295/:1347/:2158-2447/:7385-7398`
