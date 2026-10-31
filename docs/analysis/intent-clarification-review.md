# 需求插件“意图澄清入口”评估与实施记录

日期：2026-10-31 · 仓库：D:/DSH（AI_ALM） · 分支：当前工作分支 `feature/alm-09-12-review-ux`（并行会话分支）+ 本轮未提交改动 · 运行宿主：DSH Web（127.0.0.1:61773，插件 API 61773；sidecar 60870）

任务来源：用户要求“继续优化现有需求插件‘需求意图 / AI 生成需求’入口；使用创造模式，实际开发、安装并验收”，必读 `D:/plug-in/control-game/需求插件创新设计/03-意图入口评审与交互设计.md`、`04-Harness创造模式-意图澄清执行指令.md`、`05-意图澄清验收场景.json`。本文件记录：改对对象、指令判断（采纳/适配/暂缓）、与现状差异、实施与验证结果、未验证项。

## 0. 结论先行

- 04 的方向正确且与现有代码可衔接：它修正的是“输入框直接生成需求草稿”这一入口语义，而不是另做一套 ALM。核心四个不变量（原话≠需求、AI 解释≠事实、建议≠确认、草稿≠采纳）与本轮意图澄清实现一致。
- 05 是验收规格而非设计文档：20 个场景里有 17 个可在当前插件内落地，3 个（INT-18 重启恢复、INT-20 键盘/200%/浅深色、INT-14 断网写失败）需要真实宿主重启或故障注入，本轮只能做到“可重复的进程内/浏览器内验证”，不能宣称已完成宿主级验收。
- 当前代码与 04 的差距主要在入口层，不在业务判定层：`CreateModal` 直接“AI 生成需求草稿→逐字段采用→确认创建”，没有“是否值得成为需求”的判定、没有六去向、没有一次一问、没有确认回执、没有变更草稿/研究项产物。上一轮刚把“证据说真话”做到评审/验收链路，本轮补入口。
- 任务包未检查当前插件源码，其数据结构（intent-review.v1、intent session）是**目标契约**而非现有接口；本轮按现有 `RequirementsService`/`runAiDraft`/`createRequirement`/`openChange` 适配，不把样机或文档结构当宿主 API。
- 不做全量重写：A 切片（输入→真实上下文→推荐去向+一问→回答更新→未确认不写需求）优先交付；B/C 切片在 A 可运行后推进。保留现有 intake（聊天/OCR）、AI 草稿 schema、页面视觉与 `verified_by` 中性表述。

## 1. 改对对象（定位结果）

| 项 | 结果 |
| --- | --- |
| 安装身份 | profile bundle `@ai-alm/dsh-plugin-requirements`，`~/.dsh/profiles/desktop/package.json` 以 `link:D:/DSH/packages/dsh-plugin-requirements` 安装；bundle patch `packages/dsh-plugin-requirements/cordis.patch.yml`，row `alm-requirements` |
| 源码位置 | `packages/dsh-plugin-requirements/`（index.js 服务与路由、client.js 侧边栏 UI、render.mjs 独立只读页、ai-draft.mjs、intake.mjs、query.mjs 等） |
| 业务判定层 | `packages/alm-core/`（requirements/create.mjs、changes/open.mjs、review/executor.mjs、acceptance/、evidence/decision.mjs、rehearsal/） |
| 持久化 | 文件系统 + git：需求 `.sdoc`、`requirements/briefs/*.md`、`.alm/reviews/`、`.alm/acceptance/`、`.alm/changes/`；无数据库，迁移靠 git 与版本化 JSON |
| 评审/验收通道 | 插件 HTTP 路由 `/api/alm/requirements/{review,signoff,acceptance,ai-review,rehearsal,draft,create,...}` → alm-core；验收命令白名单 node/npm/pnpm，无 shell |
| 关联仓库 | `D:/DSH`（AI_ALM）；项目自描述 `.alm/project.json`（fixture order-refund = PAY） |
| AGENTS.md | 仓库根与包内均无 AGENTS.md（已 find 确认）；适用技能为 `cordis-plugin-development`、`alm-mvp-dev`、`ai-github-issue-workflow`/`ai-github-pr-workflow` |
| UI 入口 | 侧边栏 panel id `requirements`（locale “需求”）；App 内 `CreateModal`（client.js 2744–3043）为“AI 生成需求”入口；独立页 `/alm/requirements` |

## 2. 对 04 指令的逐项判断

判定口径：**采纳** = 本轮实现；**适配** = 方向对但按现有契约/成本改造；**已具备** = 现有代码已满足，不重复实现；**暂缓** = 需要宿主重启/真实故障注入/额外权限，登记未验证。

| 04 要求 | 判定 | 说明 |
| --- | --- | --- |
| 原话≠正式需求；未确认不写需求 | 采纳 | 会话草稿独立；确认前不调用 create/openChange |
| AI 解释≠事实；候选为待确认建议 | 已具备+采纳 | ai-draft 已有 candidate/requiresHumanConfirmation；本轮去掉自动回填优先级/负责人 |
| 六去向枚举 create/change/reuse/investigate/decline/answer | 采纳 | 严格枚举；拒绝未知枚举与可执行字段 |
| 上下文包 + read-set + contextSnapshotId | 采纳 | 由 alm-core intent 上下文构建器生成；检索失败标记“相关需求尚未核对” |
| 一次最多一问 + whyNow + ≤3 选项 + 自由输入 | 采纳 | 服务端 schema 校验，最多一问；不得重复已答问题（提示词+规范化约束） |
| 回答后必须改变候选 | 采纳 | answer 触发重新分析，inputRevision 递增 |
| 连续两轮无进展给出口 | 采纳 | 提示保存研究项/只确认已清楚范围 |
| 确认回执（问题/范围/去向/将写入什么） | 采纳 | 确认屏四块 + 唯一主按钮 |
| 用户确认后按类型保存草稿 | 采纳 | create→需求（待评审）；change→变更草稿；investigate→研究项；reuse/decline/answer→仅回执 |
| 变更不覆盖正式需求 | 采纳 | change 只写 `.alm/intents/changes/` 草稿，正式 .sdoc 不动 |
| 来源分类 user_report/observed_evidence/confirmed_decision/hypothesis；不可解析不冒充事实 | 采纳 | sourceRefs 校验 + unresolved 保留待确认 |
| 严格导入校验、大小限制、HTML 不执行 | 已具备+适配 | intake 12MB 限制、OCR 8MB、文本渲染转义；新增 intent 模型输出严格 schema |
| 模型两阶段、单 JSON、不调工具 | 采纳 | analyze 一次调用产出 items+nextQuestion；确认阶段服务端复算 readiness |
| 无模型/超时/解析失败仍可手填 | 采纳 | 503 + manualFallback，前端保留原话与手填入口 |
| 幂等键、重复点击、同键不同负载拒绝 | 采纳 | confirm 幂等（payloadHash）；同键不同负载 409 |
| 取消不接受迟到响应、切换输入旧结果不覆盖 | 采纳 | runId + inputRevision 校验，stale 409 |
| 审计与保存可恢复 | 采纳 | journal + `.alm/audit/intents/`；失败保留草稿 |
| 迁移/重启恢复 | 部分 | 迁移函数+备份+版本校验可测；真实宿主重启验收需用户授权重启（本轮不重启） |
| 键盘/焦点/200%/浅深色/窄窗 | 部分 | 浏览器内可测（Playwright）；宿主内 200% 缩放难以精确模拟，登记未验证 |
| 不以新独立 HTML 冒充插件 | 遵守 | 实现位于真实插件；render.mjs 仅只读页，不作为功能入口 |

## 3. 与 05 场景的对应和差异

- 可完整覆盖：INT-01/02/03/04/05/06/07/09/10/11/12/13/15/16/17/19。
- 需故障注入（进程内模拟，不算宿主级）：INT-08（检索 timeout）、INT-14（写失败/断网/双击）。
- 本轮只能部分覆盖：INT-18（重启恢复需重启宿主）、INT-20（真实宿主内键盘/缩放/主题需人工或受限自动化）。
- 05 中与当前仓库约定冲突处按仓库约定适配：负责人默认不指派（INT-06 保留“待权限确认”而非直接落 OWNER）；优先级必须用户显式选择才写入，否则 readiness `needs-priority`；change 的基准修订必须存在且未被并发修改。

## 4. 实施（文件与接口）

### 4.1 共享业务层：`packages/alm-core/src/intent/`（新增，约 3.7k 行，零 DSH 依赖）

| 文件 | 职责 |
| --- | --- |
| `context.mjs` | 只读上下文包：项目/需求根/选中需求/检索 read-set（uid、revision、contentHash、match、匹配理由、验收线索），`contextSnapshotId = ctx-<sha256(policy+projectId+queryStatus+selected+readSet)[0:16]>`；检索失败 `queryStatus=error` 时 readiness 会阻止新建/变更/复用。 |
| `session.mjs` | `alm.intent-session/v1` 会话存储 `.alm/intents/sessions/<id>.json`（原子写、inputRevision、answers、runs、items、confirmation、artifacts、error），`loadSession/listSessions`；`setInput` 使旧分析失效（stale-input）。 |
| `analysis.mjs` | 严格规范化模型输出 `intent-review.v1`：未知 route 拒绝、可执行字段（apply/approve/sign/publish/status/idempotencyKey…）整份拒绝、模型指派 owner/priority 拒绝；普通未知字段丢弃并记 warnings；模型自撰 prose 走 `stripHtml/cleanModelText`（sourceRefs.quote 保留原文）；空 items 生成 stub 单元（不伪造 route/candidate/验收）。 |
| `messages.mjs` | 两阶段提示词（理解/比较/当前一问；再结合真实上下文与回答形成有范围候选），含“使用类提问优先 answer”“信息不足优先澄清而非判定用户不合理”“只问会改变判断的一问”“反例是待证场景”等约束。 |
| `readiness.mjs` | 纯函数准入判定（UI 与后端共用）：`missing-candidate/missing-title/needs-acceptance/needs-priority/unresolved-blocking-unknown/invalid-change-base/unresolved-source/unverified-context/stale-input/stale-context/not-confirmed` 等机器码；create 必须候选+验收+来源+人工选优先级，change 必须绑定已核对基线（uid 仅作指针，revision/contentHash 一律从上下文取）。 |
| `confirm.mjs` | 人工确认：内容摘要 + 幂等（payloadHash、重复键重放、同键不同负载 409）、六去向产物（requirement 草稿 / 变更草稿 `change-draft`、绝不改正式 sdoc / reuse 关联 / investigate 排查项 / decline 回执 / answer 回执）、审计事件、journal 恢复、`baseRevisions` 回执。 |
| `migrate.mjs` | 旧 intent 会话迁移：先备份 `.alm/intents/backup/`，版本映射后可恢复，失败不覆盖原件。 |
| `view.mjs` | 会话 → 视图（`renderSessionView`），供 UI/测试共用。 |

### 4.2 插件层：`packages/dsh-plugin-requirements/`

- 新增 `intent.mjs`（约 1.2k 行）：六 action（analyze/answer/edit/confirm/cancel/load + migrate）的字段白名单、错误码映射（400/404/409/422/500/502/503）、`streamOutput` 把 message content 规范为宿主要求的 parts 数组、非法模型输出一次性修复重试（失败 502 带 fields/attempts/rawExcerpt）、每次调用带 runId + inputRevision 防迟到覆盖、无模型时落可编辑 stub 会话。
- `index.js`：注册 `POST/GET /api/alm/requirements/intent`（约 L208–212），`handleIntent` 复用 `resolveAiSelection`/`aiStreamFor`（约 L505–536）；另为兼容运行宿主 ESM 模块缓存，把 executor 导入改为命名空间 + 惰性 `acceptReview`（重启后可清理）。
- `client.js`：`CreateModal` 被 `IntentModal` 五屏替代（约 L2978–4870）：输入（原话 + 文本/OCR/聊天来源 + 显式负责人/优先级 + “先澄清，不会创建需求”）→ 分析（真实阶段文案，可取消）→ 结果（一句理解、六去向、相关承诺与匹配理由、至多一问+影响、可编辑候选 dirty-field、未知项澄清/转调查/排除、价值检查/假设/反例/来源/模型信息渐进展开）→ 确认（四块回执：问题与期望、做什么/不做什么、去向与既有承诺、将写入什么；change 才显示旧新差异与影响）→ 回执（真实产物路径/ID、“打开需求详情”、“保存≠采纳/开工/验收/发布”）。列表在创建后提示“已创建但当前筛选不可见”并可清除筛选。
- 测试：`test/intent-http.test.mjs` 20 项（假流 + 假 ctx：analyze→answer→confirm、幂等重放、同键冲突、stale-input/stale-context、非法输出修复重试、无模型 503、取消、load、注入、contextSnapshotId 透传）。

## 5. 验证（实际跑过的证据）

| 验证面 | 命令/方法 | 结果 |
| --- | --- | --- |
| 全仓单测 | `pnpm test` | **375 / 375 pass**（含 core intent 54 项、插件 105 项） |
| 真实模型 E2E（新启动的真实宿主 `dsh eval --no-open --port 61890`，加载同一 link 插件与磁盘新核心；隔离 git 夹具 `tmp/intent-e2e-fixture`） | `ALM_BASE=http://127.0.0.1:61890 node tmp/intent-e2e.mjs` | **34 / 34 pass**；覆盖 INT-02/03/06/07/13/14/16：INT-06 创建草稿+幂等重放+同键冲突 409、INT-02 变更草稿且正式 sdoc 不变、INT-07/03 不建需求、INT-16 注入只作数据、INT-13 stale-input/stale-context 409。对 analyze 的模型偶发 502 允许一次自动重试，重试标记只记录在对应单用例 dump（如 `tmp/e2e-out/int-13.analyze.json` 的 `"retried": true`），不在汇总 `report.json` 里 |
| 真实浏览器 UI（真实 client.js bundle + 真实宿主 API，`tmp/ui-harness`，Playwright chrome） | `HARNESS_URL=http://127.0.0.1:63112/ node tmp/ui-harness/ui-flow.mjs`（反代 61890 新宿主） | **32 / 32 pass**：两阶段流程。A 混合意图 3 轮问答（每屏至多 1 问、仍待答、未确认零写入、关闭后无正式需求）；B 明确意图 4 轮问答收敛（无阻塞未知）→ 选择“新建需求草稿”后后端 gate 放行 → 确认屏四块 → 保存得 `requirements/req-its-004.sdoc` 与回执（“保存 ≠ 采纳/开工/验收/发布”）；Escape、Tab 可达主按钮、关闭后焦点返回、200% CSS zoom、浅色主题、720px 无横向溢出、无未处理脚本错误；截图 `tmp/ui-shots/01..10-*.png` |
| 重启恢复（真实宿主进程重启） | 在 61890 建会话 `INT-20261031112747-20ad24`（needs_input）→ 杀掉宿主进程 → 重新 `dsh eval` 启动同端口 → `GET /api/alm/requirements/intent?...&session=…` | pass：会话保留 `needs_input`、原话、1 条成功 run 与待答问题；`requirements/` 无新增、无回执；证明确认前状态跨重启持久且未推进 |
| 迁移（真实宿主） | 夹具内放旧格式会话 `INT-OLD-1.json` 与 `.alm/intents/legacy.json`（含 `apply:true`、模型给定 owner/priority）→ `POST intent {"action":"migrate"}` → 再跑一次 | pass：`migrated:2, skipped:7`，迁移结果为 `editing`、`confirmation:null`、`artifacts:[]`、`apply` 被丢弃；备份写入 `.alm/intents/backup/<stamp>/…`（原文件字节保留）；再次迁移 `migrated:0, skipped:9, backupDir:null` 幂等；`requirements/` 未改动 |
| 意图单元测试 | `node --test packages/alm-core/test/unit/intent-*.test.mjs` | 54 / 54 |
| 插件测试 | `node --test packages/dsh-plugin-requirements/test/*.test.mjs` | 105 / 105 |
| 语义探针（真实模型，INT-04/05/10） | `node tmp/intent-semantic.mjs` | **13 / 13 pass**：不宣称已复现、保留用户偏好、先问清具体任务、不编造百分比、不含可执行字段 |
| 05 逐项验收 | `docs/analysis/intent-acceptance-report.md` | 20 项中 passed 8、partial 6、unverified 6、failed 0（逐项列证据与缺口） |

关键实测（隔离数据，未触碰示例仓库）：

- 未确认前 `requirements/` 与 `changes/` 零写入；确认后 create 产物 `requirements/<id>.sdoc` 含 `PRIORITY: P2`、`OWNER 李楠`（用户显式提供，非模型指派）。
- 同幂等键重放返回 `replayed:true` 且不重复建需求；同键不同负载 409 `idempotency-conflict`。
- change 只写 `.alm/intents/changes/<CHG>.json`（绑定已核对需求的 revision/contentHash），正式 `requirements/*.sdoc` 字节不变。
- 输入更新后旧确认 409 `stale-input`；伪造 `contextSnapshotId` 409 `stale-context`。
- 结果屏价值检查以“状态/断言/最小验证/停止或撤回条件”结构呈现（修复了 `[object Object]`）；回执屏显示真实路径与“保存 ≠ 采纳/开工/验收/发布”。
- 在新宿主（新核心）上确认：change 产物 `kind` 为 `change-draft`（旧桌面宿主仍返回 `change`）；模型自撰字段中的 `<script>` 被净化（INT-16 通过）；INT-18 的重启恢复与旧数据迁移已在真实宿主进程上执行。
- 调查出口：仍有未答问题时，所有条目改判“先调查”后允许保存——问题本身成为调查项（`INV-ITS-001`，status open），而不是被丢掉；新建/变更在同样情况下仍被阻止。
- 注意：`tmp/ui-harness/ui-flow.mjs` 曾因未定义 `pageErrors/failedResponses` 触发 ReferenceError；已修复并重跑，历史 25/26 报告作废。

### 5.1 澄清阶段只读调查（本轮新增，回应用户反馈）

用户反馈两点：选项点下去没有选中/提交反馈；调查类问题不应拖到开发阶段。实现与证据如下。

| 面 | 位置 / 命令 | 结果 |
| --- | --- | --- |
| 调查引擎 | `packages/dsh-plugin-requirements/investigate.mjs`（819 行）：`collectEvidence` L292、`buildInvestigationMessages` L386、`normalizeInvestigation` L528、`runInvestigation` L622、存储 L698-788 | 只读证据包：≤40 文件、≤60 snippet、单文件读取上限 512KB、root realpath 内、跳过 `.alm/` 运行产物（`project.json` 例外）、symlink/`../` 逃逸记 skipped；quote 逐字核对失败降级为 unknown/`not-determined`；可执行字段整份拒绝 |
| HTTP | `intent.mjs` `action:'investigate'` L1128（422/403/413/502/503，不推进会话）、`analyze.investigationIds` L700/L1064、analyze/GET 返回 `investigations` L1368 | 调查记录写 `.alm/intents/investigations/INV-<stamp>-<hex>.json`（tmp+rename）+ 审计 jsonl |
| UI | `client.js`：选项先选后提交（`aria-pressed`）、`提交中…（已用 Ns）` 计时与取消、成功提示“已记录你的回答，已更新候选”；`renderInvestigationPanel` L4318、`renderInvestigations` L4458、`renderClarificationStatus` L4290、“用这些证据重新判断” | 点选项即变蓝并有边框；提交过程有计时；成功后候选更新并提示 |
| 单测 | `node --test packages/dsh-plugin-requirements/test/investigate.test.mjs`、`test/intent-http.test.mjs` | investigate 12/12、intent-http 26/26、插件 123/123、全仓 **394/394** |
| 真实模型调查（桌面宿主 61773，真实模型 deepseek-flash） | `node tmp/probe-investigate2.mjs`（root `tmp/inv-fixture`，含插件源码副本） | 200，约 32s：verdict `partially-answered`、5 条 findings、3 条 unknown；每条引用 `path#Lx-Ly` 逐字核对通过；boundary `truncated:true`；随后 `analyze + investigationIds` 200，问题变成“具体是哪个入口…”并把去向改为 investigate |
| 真实浏览器调查流（真实 client.js bundle + 真实 API） | `HARNESS_URL=http://127.0.0.1:63113/ node tmp/ui-harness/ui-investigate.mjs` | **8/8 pass**：入口、结果屏、“调查这个问题（只读）”、面板结论、可核对引用（`…/sidebar.mjs#L26-26 引用已核对`）、重新判断入口、带入证据后候选更新、无未处理控制台错误 |
| 真实浏览器选项反馈 | `node tmp/ui-harness/ui-answer-feedback.mjs` | **6/6 pass**：点选项后 `aria-pressed=true` 且边框变色；“提交中…（已用 1s）”；18s 后出现“已记录你的回答” |

本轮调查能力的三处硬化（由真实模型暴露）：单文件读取上限从 16KB 提到 512KB（否则 `client.js`(250KB)、`index.js`、`intent.mjs` 全被当成 too-large 跳过，调查必然空转）；snippet 改为按命中强度排序而非文件顺序（只取文件前几行没有诊断价值）；`runInvestigation` 增加一次非法输出修复轮 + `maxTokens` 8000（4000 时模型在思考段耗尽预算、输出为空）。



## 6. 未验证与限制

1. **桌面宿主未重启，仍是旧核心**：DSH 宿主有 ESM 模块缓存，插件 disable→enable 可重载 `intent.mjs`/`client.js`，但 `packages/alm-core` 的已缓存模块不会刷新。为做真实验收，本轮另起了一个同 profile 插件配置的真实宿主（`dsh eval --no-open --port 61890`，新进程因此加载磁盘新核心），E2E/语义/UI/重启/迁移证据都来自新宿主；你正在使用的桌面宿主（61773）在重启前仍返回旧产物形状 `{kind:'change'}`，重启后才会切到新核心。重启会中断当前会话，需你确认时机。
2. **原生宿主内 UI 未验收**：真实浏览器验收用的是同一份 client.js + 真实宿主 API，但不是 DSH 窗口内的实际 Slot 挂载；宿主 GUI 根返回 401（需 `dsh web` 打印的 token），未读取 token。
3. **INT-14 断网/写失败/双击**：幂等与 journal 有单测/HTTP 测试，未做真实断网注入。
4. **INT-20 的 200% 缩放的实现方式**：浏览器验收用 CSS zoom 近似，非真实浏览器缩放；键盘路径只覆盖 Tab 可达主按钮与 Escape 焦点返回，未覆盖全流程纯键盘操作。
5. **INT-08 检索 timeout**：context 层有 `queryStatus=error` 分支与测试，但真实检索超时未在宿主触发。
6. 真实模型有概率性：同一输入在多次运行中给出的问法/去向可能不同（例如 INT-07 有时 investigate 有时 answer），因此 UI 流程用“问题文本决定回答”的循环收敛到确认，而不是固定断言某一问法。
7. 运行宿主被另一并行会话共用（AI 评审采纳方向未提交改动）；本轮只做最小 patch，未回退或覆盖其改动。
8. **05 仍有 6 项 unverified**（INT-08/09/11/15/17/19）与 6 项 partial（INT-01/05/10/12/13/14），逐项缺口见 `docs/analysis/intent-acceptance-report.md`；这些缺口是验收范围问题，不是已发现缺陷。
9. **UI 脚本对 5xx 的统计曾产生假阴性**：`ui-flow.mjs` 早期只统计 analyze 的自动重试，answer 阶段偶发 502 已由用户循环/重试恢复时仍判失败（复跑 34/35）。已改为“5xx 只允许作为可重试错误出现，且流程最终到达确认/回执”；最近一次运行观测到 1 次 502，由 UI 重试恢复并到达回执，报告记录 `failedResponses` 与 `analyzeRetries`。
10. **一个真实产品判断**：05 要求“未回答的问题”一律视为阻塞；实测发现用户改判“先调查”后，问题本身应成为调查项，因此把客户端 gate 改为“仅当去向仍可能是新建/变更时阻塞”，并保留问题到 `INV-…json`。这是对 04 的“可转调查或排除”的落地解释，已写入 §5 关键实测。

11. **调查能力的边界**：只读证据包按关键词（中文经 `ZH_KEYWORDS` 映射到英文标识符）挑文件与行，问题若与代码词汇无交集（例如纯口径/业务问题），结论可能诚实但空泛（`not-determined`）；这是设计上的“不编证据”，不是故障。单文件读取上限 512KB，超过则记 `too-large` 跳过；`.alm/` 运行产物默认不读（`project.json` 例外），因此调查看不到历史会话和评审记录。
12. **真实 GUI 的 client bundle 刷新未直接核实**：本轮浏览器验收用的是同一份磁盘 `client.js`（esbuild 打包进 `tmp/ui-harness`）加真实宿主 API；桌面 61773 的 GUI 根需要 token（未读），因此“宿主窗口内刷新后即为新版 UI”是按插件 reload 机制推断。请在需求页刷新一次确认选项选中/计时/调查面板。
13. **调查模型输出仍可能波动**：同一问题在不同次数下 verdict 可能是 `partially-answered` 或 `not-determined`；已加一次修复重试与 `maxTokens 8000`，但不保证每次都给 findings。

## 7. 回滚

- 代码全部未提交前：`git checkout -- <files>` 或按文件还原；新增文件直接删除。
- 数据：intent store 在 `.alm/intents/`，与会话/需求正式文件隔离；迁移前自动备份到 `.alm/intents/backup/`；不触碰 .sdoc 除非用户确认 create/change 草稿的正式落地动作。
- 宿主：未重启、未发布；插件热加载状态以实测为准并记录。
