# 对《把现有需求插件改成需求证据台》优化指令的评估

- 日期：2026-10-31
- 评估对象：`D:/plug-in/control-game/需求插件创新设计/02-交给Harness创造模式.md`（执行指令）、`01-截图评估与产品决策.md`（决策依据）、`需求证据台.html`（交互样机）
- 被改对象：`@ai-alm/dsh-plugin-requirements`（desktop profile link 安装）+ `packages/alm-core`
- 评估方式：先定位安装身份与真实代码，再在隔离副本复现失败，最后按“能落地且值得做”的范围进入开发。

## 0. 结论

1. **方向合适**：从“字段齐全/角色齐全/状态流转”转向“承诺是否有证据、改动会让什么失效”，击中当前插件最贵的缺陷。截图三处问题中至少两处能在当前代码复现，且一处是业务规则真的放行（无验收证据也能人工签收）。
2. **不能照单全收**：指令自述“没有检查现插件源码和接口”，因此若干前提已过时（UID 已存在、测试关联与执行已分表、五角色是确定性门禁视角而非 AI 角色、评审/签收/验收/版本对比已实现）；另有若干要求与仓库契约/宿主约束冲突，或属于数周级研究。
3. **本轮纳入开发的是三块**：证据说真话（判定层 + 验收溯源 + 签收后端硬门禁 + 异常队列 + 输入校验）、变更试演（预览 + CAS 提交 + 审计/幂等）、围绕决定的 UI 局部重排。价值验证账本、完整 AI 候选协议、键盘/200%/重启恢复矩阵不在本轮；理由与去向见 §4、§5。

## 1. 先证明改对了对象

| 项 | 定位结果（证据） |
|---|---|
| 安装身份 | `~/.dsh/profiles/desktop/package.json` → `"@ai-alm/dsh-plugin-requirements": "link:D:/DSH/packages/dsh-plugin-requirements"`；bundle 见 `packages/dsh-plugin-requirements/cordis.patch.yml`（`alm-requirements`） |
| 页面入口 | 侧边栏 `sidebar.panellist` id `requirements`（`README.md`）；另有 Settings → Requirements 与 `GET /alm/requirements` 独立只读页 |
| UI 源码 | `packages/dsh-plugin-requirements/client.js`（`window.__ModuleLoader__` 客户端模块，约 2.9k 行）+ 独立页 `render.mjs` |
| 业务判定层 | `packages/alm-core`：`review/executor.mjs`（评审/签收）、`acceptance/acceptance.mjs`（验收执行与证据）、`gates/`（门禁）、`index/`（关系图）、`commands.mjs`；插件只做聚合与 HTTP 适配 |
| 持久化 | 需求本体 = git 中的 `.sdoc`；评审 `.alm/reviews/<REQ>.json`；验收配置/证据 `.alm/acceptance/`；变更 `.alm/changes/`；迁移靠 git，不存在数据库 |
| 验收执行通道 | `runAcceptance` 先预览后执行，白名单 `node/npm/pnpm`、无 shell、单条 ≤10 分钟，证据按 HEAD 写 `.alm/acceptance/<REQ>/<sha>.json` |
| 关联仓库 | 项目空间 = DSH 工作区（`workspaces.mjs`），关联写 `.alm/project.json`；GitHub Issue 通过 `github-sync.mjs` |
| 与“控制论学习插件”区分 | 本任务只改 `packages/dsh-plugin-requirements` 与 `packages/alm-core`；未参考、未复用 `D:/plug-in/control-game` 下其他插件路径；未改 `dsh-plugin-architecture` |
| 未提交工作 | 工作区已有上一轮“AI 生成需求草稿”（`ai-draft.mjs`、`client.js`、`index.js`、测试）未提交；本评估保留并在此基础上修订 |

> `cordis_inspect_query Config.listConfigs name=@ai-alm/dsh-plugin-requirements` 返回 `include:alm-requirements`（status `absent` 表示该插件无配置项，不是未安装）。真实浏览器入口需要宿主重启后才能验证，本会话限制见 §6。

## 2. 截图主张 vs 真实语义（复现结果）

隔离副本：`tmp/workspace-demo` → `tmp/repro-evidence`（含独立 git HEAD），脚本 `tmp/repro-evidence.mjs`。结果来自当前代码，不是样机。

| # | 截图主张 | 复现 | 结论类型 |
|---|---|---|---|
| A | 0/5 角色未覆盖，却绿色“可进入人工签收” | 任意解析错误（如一个缺 UID 的 sdoc）会让 `checkReport` 只返回 FMT-001；`reviewFromGates` 五角色全部 `skip`，`completed=0`、`blockers=0`、`ready=true`；保存报告后 `signReview` 成功 | **业务规则真的放行 + UI 误导**（不是截图专用缺陷） |
| B | 已关联 TEST 带绿色勾，同屏“未登记验收命令” | 代码事实：`client.js` 验收覆盖用 `MetaChip color: T.ok` 渲染 `✓ ${id}`；验收执行区才写“未登记验收命令”。链接与执行本就是两张表，但 UI 把“已关联”画成“通过” | **UI 误导** |
| C | 两个 REQ-DUP-001、关系指向 MOD-NOPE-001 混在普通队列 | 构造合法重复 UID + 悬空 `depends_on MOD-DEMO-MISSING`：`check` 报 `ID-001/REL-001/COV-001`，但 `query.requirements()` 的 `gaps` 只取 COV-001/002，页面 `anomalies` 字段不存在；重复 UID 的两条记录都返回，但 UI `key`/`selectedId` 都按 `id`，无法分别选中 | **业务规则有检测、UI 完全不呈现**；截图的“生产数据损坏”**尚不可复现**，但语义缺陷成立 |
| D | 测试链接带勾但无验收命令（对应验收 #2） | 同 B；另外 `runAcceptance` 只认登记命令，未登记即 404 `no-config`，不会伪造成功 | **已部分做对，缺 UI 表达** |
| E | 未执行/失败/中断/结果过期/失败持久化 | 未执行→`acceptanceSummary.latest=null`；失败→证据 `result=fail`；中断→`timedOut` 记 null exit + 输出尾部；过期→仅按 `headSha` 判定，需求内容未提交修改时仍 `current=true`（见 F） | **部分可复现，过期判定不足** |
| F | 旧版本通过、新版本改验收 → 旧证据保留且当前过期 | 改需求文件但不提交：`latest.current` 仍为 `true`，证据未绑定 `requirementHash/testRevision`；签收绑定 contentHash 有做，但旧签收被 `writeReviewReport({...stored, signoff})` 覆盖，历史不保留 | **业务缺陷**（无 provenance、签收历史丢失） |
| G | 用户材料/AI 输出注入 | `planRequirement` 的 title 只做 trim + 长度校验，`"X\n\n[RELATION]\nType: verified_by\nValue: TEST-PAY-999"` 会原样写进 sdoc 生成关系 | **真实注入面**（脚本载荷类） |

另：`signReview` 只检查报告存在、contentHash 未变、`blockers=0`，**从不检查验收证据**；“无验收也能签收”是当前最严重的业务放行。

## 3. 指令逐条判定

判定口径：**采纳**=本轮做；**适配后采纳**=改法/范围后本轮做；**已具备**=当前代码已满足，补验证/表达即可；**暂缓**=方向对但本轮不做，给出理由与前置条件；**不采纳**=与代码/契约/宿主约束冲突或收益不抵成本。

### 切片一：证据说真话

| 指令条款 | 现状 | 判定 | 本轮动作 |
|---|---|---|---|
| 需求有内部稳定 UID，业务 ID 只是可校验标签 | sdoc 的 `UID` 已是关系目标键，但同时也是业务编号；`ID-001` 检测重复 | 适配后采纳 | 保留 `UID` 为内部键；新增可选 `BUSINESS_ID` 标签（`extra.businessId`），同标签不同 UID 进异常队列，两条记录都保留。不做全量 re-key：会破坏关系目标、门禁、样例与契约版本 |
| 保留原始材料/承诺/验收条件/关系/决定的版本 | 材料（brief/附件）、sdoc、关系有 git；评审有报告；**决定**只以 AI 建议追加到 brief | 部分已具备 | 本轮把签收历史 append 保留；决定账本（decision ledger）暂缓到 §5 |
| 关联测试与测试执行分表 | `verified_by` 关系 vs `.alm/acceptance/` 证据，已是两表 | 已具备 | 只修 UI 表达（已关联 ≠ 通过） |
| 执行结果绑定需求修订/实现修订/测试修订/上下文/环境/时间/输出/结果/来源 | 现证据只有 `headSha`、时间、输出、结果 | **采纳** | `alm.acceptance/v2`：`requirementHash`、`testRevision`、`environment`、`source`、`context`、`actor`；`complete/current/missing/staleReason`；v1 只读兼容并标“来源或版本不完整” |
| 共享业务层纯判定：未检查/需澄清/阻塞/执行失败/证据过期/可进入人工确认 | 只有 `review.summary.blockers` 与零散字段，无统一判定 | **采纳** | 新增 `alm-core/src/evidence/decision.mjs`（纯函数、风险策略、状态、缺口、nextStep、签收准入） |
| 准入由明确风险策略决定；缺必需证据不能显示通过 | 签收不看验收/覆盖；`ready` 只看 blockers | **采纳** | 风险策略 P0/P1=5 视角、P2=4、其余=2；缺评审/缺命令/未执行/失败/过期一律不得 `ready` |
| 人工签收绑定精确快照，变化后标记需复核、保留旧记录；不靠按钮 enable/disable | contentHash 绑定有；历史被覆盖；后端校验有但条件不全 | **采纳** | `signReview` 用 decision 做后端硬门禁（409 + 具体 code）；`signoffs[]` append；UI 列 reasons |
| 签收 ≠ 授权智能体执行；执行 ≠ 发布 | 没有自动执行路径 | 已具备 | 文案与判定中明确，不新增自动执行 |
| 重复 ID 保留记录和引用、不自动合并；悬空引用可见、不默默删除 | 门禁检测有；页面不显示；UI key 冲突 | **采纳** | `payload.anomalies` + `item.anomalies`；`occurrenceKey` 支持分别选中；不做自动修复 |
| 用户材料与 AI 输出按不可信输入；严格校验导入/大小/防注入 | 有 body 上限、附件名白名单、OCR 引擎本地；但 create title 可注入 sdoc | **采纳** | create/ai-draft 拒绝控制字符与换行；AI sourceRefs 校验；保持 HTML 转义 |

### 切片二：变更试演

| 指令条款 | 现状 | 判定 | 本轮动作 |
|---|---|---|---|
| 编辑时草稿独立、before/after | 无 | 采纳 | `previewRehearsal` 纯预览，不写盘 |
| 沿有类型、有来源的显式关系求闭包；visited 防环；按语义区分需重验/需重新确认/仅参考 | `impactOf/walk` 有反向闭包，但不分类、无路径、无来源 | 适配后采纳 | 新增 `rehearsal.mjs`：关系语义表、BFS/DFS、多路径、cycles、advisory |
| 显示路径与覆盖边界；无依赖说“未登记影响”不能说“无影响” | 无 | 采纳 | `blindSpots` + `coverage`，文案固定 |
| 不以 AI 相似度命中直接升级为阻塞 | 现无 AI 影响判断 | 已具备 | 影响分组 `advisory:true`，不参与门禁 |
| 结果绑基准修订+关系快照；他人改动拒绝旧预览；事务/原子写；审计；旧证据失效 | 无 | 采纳 | `expectedBaseline` CAS（409 stale-preview）、临时文件+rename、`.alm/audit/requirements/`、内容哈希自然使验收/签收过期 |
| 存储失败保留草稿可重试、不显示已提交；取消试演不写正式状态 | 无 | 采纳 | `writeFile` 注入故障测试；失败 `applied:false` + `draftRetained:true`；preview 零写入 |

### 切片三：围绕决定重排 UI

| 指令条款 | 现状 | 判定 | 本轮动作 |
|---|---|---|---|
| 紧凑队列显示承诺/具体缺口/下一步 | 卡片有 meta，无决定语义 | 采纳 | 卡片显示 decision.label + topGap + nextStep |
| 未检查中性、失败阻塞红、需复核琥珀、绿色只属于有范围有效证据 | 验收覆盖是绿色 ✓ | 采纳 | tone 映射 + “已关联”中性 + provenance |
| 详情顶端先露最关键缺口；角色条不要压住验收 | 评审在验收之前 | 采纳 | 决策条置顶、角色下沉到“质量与验收”内 |
| 状态同时用文字 | 颜色+文字本来就有，但 ready 文案误导 | 采纳 | 文案由 decision 生成 |
| check fail 展开到规则/位置/原因/修复预览 | findings 已有规则/文件/行 | 适配后采纳 | 可展开 + fix 提示 |
| 新建先收原话，AI 形成可编辑候选，最多一个关键歧义；无模型可手工 | 上一轮已做“原话→AI 草稿”，但 AI 自动回填优先级/负责人，且无结构化候选 | 适配后采纳 | 保留原话入口；AI 不填无依据的优先级/负责人；新增 claim/sourceRefs/假设/一问/反例/验收草案/未知项；不自动采纳 |
| 保留宿主导航和主题 | 已用 `--dsw-alias-*` token | 已具备 | 继续沿用 |

### AI 工作协议

| 指令条款 | 现状 | 判定 | 去向 |
|---|---|---|---|
| 价值验证支线：业务假设/最便宜可撤回验证/观察窗口负责人/停止条件；缺数据只生成待确认计划 | 无 | 暂缓 | 需要决定账本与新持久化 `alm.value/v1`；本轮先把“技术验收 ≠ 用户问题改善”写进决定语义与文案，避免假通过 |
| 发布/测试通过不自动把“用户问题改善”置真；停止/缩小是合法决定 | 无决定账本 | 暂缓 | 与上条一起做，避免只做 UI 不做持久化 |
| 澄清与反例研究员；结构化候选；sourceRefs 可解析；一问；反例不是缺陷 | AI 评审/草稿已有，但无结构 | 适配后采纳 | 扩展 `ai-draft.mjs` 候选字段 + sourceRefs 校验；保持 advisory |
| 候选经校验+人审才写；自由文本“同意”不触发状态机 | 采纳 AI 建议才写 brief，已是人审 | 已具备 | 重申并测试 |
| AI 输入带当前快照/缺口/关系边界/已有决定；重试幂等 | AI 评审输入有字段/门禁；无幂等键 | 部分已具备 | 重试幂等本轮只做试演提交的 idempotencyKey；AI 调用幂等暂缓 |

### 必须实际验收（指令第 9 节）

| # | 项 | 本轮状态 |
|---|---|---|
| 1 | 当前修订无验收结果 → 不得通过/准入 | **实现 + 单测**（decision + signoff 硬门禁） |
| 2 | 有链接无命令 → 已关联未执行 | **实现 + 单测**（decision `unchecked`） |
| 3 | 旧版本通过、新版本改验收 → 旧证据保留且当前过期 | **实现 + 单测**（requirementHash/testRevision） |
| 4 | 改 A 影响 B 再影响 C → 两条路径三个上下文；环不死循环；无关系显示盲区 | **实现 + 单测**（rehearsal） |
| 5 | 相同业务 ID、不同 UID → 两条仍在、定位冲突、不擅自选一条 | **实现 + 单测**（anomalies + occurrenceKey） |
| 6 | 草稿/取消/陈旧预览/并发/落盘失败不产生假成功 | **实现 + 单测**（rehearsal CAS/回滚/幂等） |
| 7 | 超大导入/未知枚举/悬空/跨项目/重复主键/脚本载荷 | **部分实现**：注入修复、异常隔离、悬空保留；超大导入沿用现有 body 上限；跨项目 UID 本轮未单独做 |
| 8 | AI 断网/取消/错误/上下文切换不串需求、不伪造证据；用户仍可编辑 | AI 失败路径已有（不写文件、明确错误）；本会话无真实断网测试，**未验证** |
| 9 | 键盘/Escape/焦点/浅深/窄窗/200%/重启/迁移实际页面测试 | **未验证**：需要重启宿主才能加载新插件；本会话不能重启正在运行宿主。已做的替代验证见 §6 |

## 4. 指令本身的问题（为什么不能照单全收）

1. **过时前提**：指令说“每条需求必须有内部稳定 UID”，当前 `.sdoc` 的 `UID` 就是内部键，`REL-001/ID-001` 已在用；说“关联测试与执行分表”，现已是 `.sdoc verified_by` + `.alm/acceptance` 两处；说“五个 AI 角色”，当前五角色是确定性门禁规则映射，不是五个模型。按字面重做会制造第二套事实源。
2. **“内部 UID / 业务 ID”全量重构代价与收益不匹配**：改键会波及关系目标、门禁、样例、CLI、契约版本；而截图真正的问题是“重复业务编号时页面不可区分”。用 `BUSINESS_ID` 标签 + 异常队列 + `occurrenceKey` 达到同样目的，不动主键。
3. **范围与“先交可运行切片”矛盾**：3 个切片 + 9 项验收 + AI 协议 + 研究设计 + 浏览器矩阵，是多周工作量。本轮按“可运行 + 可测试 + 不伪造证据”原则切三块，其余明确列出（§5），不假装完成。
4. **宿主约束**：插件通过 desktop profile link 安装，宿主已运行；本轮改的是 server/client 源码，必须重启宿主才会生效。指令要求“在实际页面测试键盘/Escape/200%/重启恢复”，本会话无法完成，只能做单测 + 独立页 Playwright + `node --check`，并如实标注未验证。
5. **样机不是接口**：`需求证据台.html` 使用自己的 localStorage 域模型（criteria/evidence/edges/decisions），边类型是 `constrains/reference/assigned_to`，与 `.sdoc` 的 `LINK_TYPES` 和验收证据模型不同。直接照搬会形成平行存储；正确做法是映射语义（承诺→sdoc+关系、证据→acceptance v2、试演→关系闭包），而不是复制样机结构。
6. **与上一轮未提交实现冲突**：上一轮 `ai-draft` 会自动回填优先级和负责人（启发式），与指令“AI 不填无依据的优先级、负责人、预期收益；不自动采纳”直接冲突。这是本轮发现的真实内部矛盾，已列入修订。
7. **“生产数据备份/迁移”前提不成立**：数据在 git 工作区，没有数据库；真正需要的是**旧证据 v1 只读兼容**、签收历史兼容，本轮按兼容读取处理，不做破坏性迁移。
8. **0/5 绿色签收**的截图确实对应真实语义，但触发条件是“门禁只跑出解析错误 → 五角色全 skip”，样机/截图不是生产数据损坏证据。评估按“可复现的业务放行”处理，不按“已证实生产漏洞”处理。

## 5. 未纳入本轮的项（明确去向）

| 项 | 理由 | 前置条件 |
|---|---|---|
| 价值验证账本（业务假设/最便宜验证/观察窗口/停止条件，`alm.value/v1`） | 需要新的持久化与责任人模型，且容易变成“AI 编收益” | 先定 schema 与人工确认流程；本轮不做假数据 |
| 决定账本（decision ledger）与“撤回需求” | 与价值验证同批，涉及权限（谁能撤回） | 价值验证 schema 落地后 |
| 完整 AI 澄清协议（校验/人审/幂等/上下文快照） | 本轮只扩展草稿候选字段与 sourceRefs，AI 评审仍 advisory | 需要真实模型回归集 |
| 键盘/Escape/焦点/200%/重启恢复/旧数据迁移的实页测试 | 宿主运行中不可重启 | 用户授权重启或新起隔离宿主 |
| 跨项目 UID 校验、超大导入的更多边界 | 已有基础校验，优先级低于证据语义 | 下一轮 |
| 自动修复重复 ID/悬空引用 | 指令明确“不自动合并、不默默删除” | 只做预览与人工确认（本轮未做修复 UI） |

## 6. 验证方式

- 复现脚本 `tmp/repro-evidence.mjs`：A–G 全部在当前代码上复现（输出见 §2）。
- 单测：`node --test "packages/*/test/**/*.test.mjs"`（最终全量由 verifier 跑）。
- 独立页 Playwright：`render.mjs` 的只读页可在不重启宿主的情况下用真实浏览器验证（决策/异常/溯源文案）。
- `node --check packages/dsh-plugin-requirements/client.js`：客户端语法。
- 未验证：真实宿主 GUI 内的键盘/焦点/200%/重启恢复/浅深色；需要宿主重启后才能确认。

## 7. 风险与回滚

- **数据兼容**：验收 v2 只新增字段，v1 只读兼容并显示“来源或版本不完整”；旧评审报告无 `signoffs[]` 时按单条兼容；不删除任何旧文件。
- **写入范围**：变更试演只允许 `title/priority/brief`，原子写 + 审计；失败不改正式状态；无自动推送/发布/执行。
- **回滚**：本轮改动集中在 `packages/alm-core/{src/evidence,src/acceptance,src/review,src/rehearsal,src/requirements/update.mjs,src/model,src/parse}` 与 `packages/dsh-plugin-requirements/{query,index,client,render,ai-draft}.mjs/js`；回滚即撤销这些文件改动，`.alm` 旧数据不受影响。
- **未提交状态**：工作区已有未提交改动，本轮在其上增量修改，不 commit/push（未获发布授权）。

## 8. 实施结果

本轮按 §3 的判定落地三块（证据判定、变更试演、决策 UI）与 AI 候选协议；§5 中标注“未纳入”的项没有实现。所有改动在工作区，**未 commit、未 push、未重启宿主**。

### 8.1 真实修改位置

业务判定层 `packages/alm-core`：

- 新增 `src/evidence/decision.mjs`（`alm.evidence.decision/v1`，纯函数；blocked > needs-clarification > failed > stale > review > coverage > acceptance-missing > acceptance-not-run > ready/verified；按风险给出所需视角数）。
- 新增 `src/model/content-hash.mjs`（规范化需求内容哈希；与原 `executor.mjs` 的 `contentHash` 逐字节一致）。
- 新增 `src/rehearsal/rehearsal.mjs`（preview/apply；`RELATION_SEMANTICS` 区分需重验/需重新确认/仅参考；多路径、visited 防环、盲区、覆盖边界、advisory；CAS 基准 `{revision, contentHash, relationHash, headSha}`）。
- 新增 `src/requirements/update.mjs`（只改 `title/priority/brief`；临时文件 + rename；持久化失败保留草稿；审计 `.alm/audit/requirements/`；幂等旁路）。
- 改 `src/acceptance/acceptance.mjs`：证据 `alm.acceptance/v2`（`requirementHash/testRevision/environment/source/context`），汇总 v2（`complete/current/missing/staleReason`），v1 只读兼容；同 headSha 但版本变更时旧证据归档 `history/`。
- 改 `src/review/executor.mjs`：`runReview` 输出覆盖度与证据绑定；`signReview` 后端重算 `decideEvidence` 并硬门禁（409），`signoffs[]` 追加保留历史；AI 评审报告不再影响真实执行状态。
- 改 `src/sdoc.mjs` / `src/asset.mjs`：`BUSINESS_ID` 作为可校验标签写入 `extra.businessId`，内部 UID 与关系目标不变。
- 改 `src/requirements/create.mjs`：title/owner 控制字符与换行校验，阻断 sdoc 注入。

插件层 `packages/dsh-plugin-requirements`：

- `query.mjs`：`collectAnomalies`/`occurrenceKeyFor`/`anomaliesForAsset`/`summarizeAnomalies`（`duplicate-id`、`duplicate-business-id`、`dangling-relation`，与 `gaps` 分开）；每项输出 `businessId/occurrenceKey/anomalies/decision/acceptance(v2)/review.coverage`；`nextAction` 由判定推导。
- `index.js`：验收执行传上下文；新增 `POST /api/alm/requirements/rehearsal`（默认 preview；apply 需 `expectedBaseline` + `actor`；409/400/404/500）；签收前置异常收集。
- `ai-draft.mjs`：`priority/owner` 恒为 `null`，只给 `suggestedPriority`/`rationale`；输出 `claim/sourceRefs/assumptions/question(≤1)/counterexample/acceptanceDraft/unknowns`，`candidate:true/requiresHumanConfirmation:true`；`sourceRefs` 只保留可解析的 `#L` 行。
- `render.mjs`：新增“决策 / 下一步 / 验收（溯源）”三列与“数据异常”独立区块（保留两条记录、明确不自动合并）。
- `client.js`：决策条置顶（结论 + 首要缺口 + 修复 + 下一步 + 签收入口及原因）；角色条下沉；`check fail` 可展开到规则/位置/原因/修复；验收溯源；异常独立区块；签收弹层列失败原因；试演弹层（before/after、影响分组与路径、盲区、baseline、陈旧预览重算）；新建弹层不再自动回填 AI 建议；列表与选中改用 `occurrenceKey`，重复 UID 可分别选中。

测试：`packages/alm-core/test/unit/{evidence,rehearsal,acceptance,review,requirements-create}.test.mjs`、`packages/dsh-plugin-requirements/test/{evidence-desk,rehearsal-http,query,ai-draft,http,lifecycle,render,requirements}.test.mjs`。

### 8.2 验收证据

| 项 | 结果 |
| --- | --- |
| 全量 `pnpm test` | **301 tests / 301 pass / 0 fail**，exit 0，26.16s（仅 CRLF 警告） |
| 独立复现脚本 `node tmp/verify-evidence-desk.mjs` | **26/26 passed**，exit 0（`tmp/verify-report.json`） |
| 指令 9 条逐条 | 1/2/3/4/5/6/7/9 有自动化证据；第 8 条（AI 断网/取消/错误）只覆盖了解析与幂等路径，真实模型调用未验证（见 §8.4） |
| 独立页浏览器验证 | Playwright + Chrome channel，**27/27 断言**，`consoleErrors=[]`、`failedRequests=[]`；截图 `tmp/verify-ui/requirements-full.png`、`requirements-viewport.png` |
| 额外判定抽查 `tmp/verify-extra-decisions.mjs` | **13/13**（重复 UID 无悬空→needs-clarification 且两条都保留；duplicate-business-id 不合并；正例→verified 且 signoff 含四类哈希） |
| `node --check client.js / render.mjs` | OK |
| 改动范围 | 19 文件 +2281/−265，全部在 `packages/alm-core`、`packages/dsh-plugin-requirements`、`docs/analysis`、`tmp/`；`dsh-plugin-architecture`/`alm-scm`/`.github`/`package.json`/lockfile 零改动；无删除；HEAD 仍 `92625f5` |

浏览器实测到的关键事实：页面对未检查需求显示“未检查”而非“通过/已签收”；数据异常区块出现且写明“保留两条记录、不自动合并”；v1 旧证据显示“证据过期”+“来源或版本不完整（缺少 requirementHash、testRevision、environment、source）”；重复 UID 两行同时渲染且不被读作 verified。

### 8.3 与评估结论一致的取舍（实施中确认）

- 不引入“5 个 AI 角色/评分”；五角色仍只是门禁规则的投影（BRIEF/REL/COV/SEC/ATT），AI 评审与真实执行分表且不进入判定。
- 不改 `requirements/*.sdoc` 的 `UID`；`BUSINESS_ID` 只做标签与冲突检测，不做全量 re-key。
- 验收命令仍只允许 `node/npm/pnpm` 白名单、无 shell；“命令登记”不等于“安全/成功”，页面与判定都不把登记当执行。
- 试演只改 `title/priority/brief`，不改验收文本或关系；改验收文本走正式编辑并让旧证据过期（“7 天→30 天”例子）。
- 无关系时输出“未登记影响（不等于无影响）”，不推断“无影响”；AI 相似度命中不升级为 blocked。
- 悬空关系 + 已有评审时，`REL-001` 优先判 `blocked`（不是 needs-clarification）——这是门禁优先级的有意结果，已在契约中记录。

### 8.4 未验证项（不视为通过）

- 真实宿主 GUI 内的 `client.js` 交互（决定条/试演弹层/键盘、Escape、焦点返回、浅深色、200% 缩放、重启恢复）：宿主未重启，只做了 `node --check` 与独立页渲染。
- 真实模型调用的 AI 候选协议（断网、取消、错误返回、上下文切换后的串需求检查）；只验证了解析、`sourceRefs` 解析与幂等重放。
- 真实宿主 server 的 409 错误顺序（独立 server + 插件 handler 已测）。
- 生产数据迁移：本仓库无生产数据库，只验证了 `.alm` v1 证据/评审的只读兼容。

### 8.5 环境观察

验收期间（10:23）`~/.dsh/profiles/desktop` 被插件市场安装了 `billion-context@0.1.209`（市场 `log.ndjson` 有记录），非本轮代码写入；它改变了宿主插件清单但不影响本轮代码与数据。未回滚、未重装，留待用户决定。
