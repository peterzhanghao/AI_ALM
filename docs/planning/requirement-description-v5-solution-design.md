# 需求描述 v5：从需求意图到需求详情——功能解决方案设计

- 依据：`docs/planning/requirement-description-v5-intent-to-detail-brief.md`（v5 执行简报，188 行）
- 交付范围：**设计**（不改代码）。目标是把「澄清得到的意图」沉淀成**唯一的正式需求描述**，让确认前草稿、确认后正文、详情展示、执行输入、验收判定五处读同一份内容。
- 现状基线：`develop` / HEAD `64ec15e`；需求插件已有意图澄清（ALM-09.12）、需求详情 v4（单列正文 + 统一待办 + 三页签 + 唯一主动作）、AI 优化建议、候选/验收/签收/发布门禁。本轮不重做这些壳，只补「正文内容链路」。

---

## 0. 一句话方案

在现有意图澄清里，把模型输出从「标题 + 问题 + 目标 + 范围 + 验收」升级为**可版本化的需求文档草稿**（`problem / goal / features[FR-*] / scope / outOfScope / acceptance[AC-*] / constraints / pending`，每条带来源）；该草稿在确认前可编辑、可预览；确认时服务端用**草稿内容哈希 + inputRevision + 上下文快照**做 CAS，把草稿渲染成**规范 Markdown** 写入 `requirements/briefs/<ID>.md`（唯一主源）；详情统一由服务端解析成 `docView` 投影；执行提示与运行记录绑定**同一版本的内容哈希与完整正文**；验收按 AC ID 回填结果。

核心取舍（三句话）：

1. **主源只有一个**：Markdown BRIEF 是主源（Git 可审、已有版本/门禁/AI 改写路径）；结构化 `docView` 是**纯派生投影**，不落第二份真相，不存在「两边都能改」。
2. **草稿不是候选**：草稿只在意图会话里，确认才产生正式需求版本；不触发候选、开工、签收、发布。
3. **不新增必经流程**：不加「再写一次 PRD」的模型调用、不加第二次强制评审、不加「每节必填」门禁；只把现有分析与确认的**内容质量**做上去。

---

## 1. 现状盘点（代码事实）

| # | 事实 | 位置 | 后果 |
|---|---|---|---|
| 1 | 分析输出只有 `{title, problem, goal, inScope, outOfScope, acceptance}`；验收条目是 `{precondition, action, expected, judgement}`，无 ID、无功能关联 | `packages/alm-core/src/intent/analysis.mjs:347`（`normalizeCandidate`） | 没有「详细功能行为」这一层，无法表达行为边界、异常、前置响应 |
| 2 | `acceptance` 缺 `action`+`expected` 即被丢弃 | 同上 `normalizeAcceptance` | 模型给的半条验收静默消失 |
| 3 | 确认时用 `candidateMarkdown()` 拼「problem / **目标** / **范围内** / **范围外** / **验收条件** 1..n」，直接交给 `planRequirement` | `packages/alm-core/src/intent/confirm.mjs:196`、`:292` | 落盘的是一个「加粗小标题」的临时格式，不是规范章节 |
| 4 | `briefMarkdown()` 固定写 `## 背景`（brief 原文）+ `## 目标`（goal 或 brief） | `packages/alm-core/src/requirements/create.mjs:97` | **背景与目标重复**的直接根因：整份候选塞进背景，又重复一次目标 |
| 5 | 详情解析 `parseBodySections()` 只按 `##` 切章 + 标题推断 kind，没有 FR/AC ID 概念 | `packages/dsh-plugin-requirements/detail-view.mjs:187`、`:210` | 范围/验收被旧格式裹进背景；详情无法逐条展示功能与验收 |
| 6 | 列表/详情读取正文 `briefText()` 后 `.slice(0, 8000)` 静默截断 | `packages/dsh-plugin-requirements/query.mjs:119` | 长需求末尾的范围/AC 静默消失；截断文本还可能被回写覆盖原文 |
| 7 | 执行提示 `buildExecutionPrompt()` 传 `item.brief`（实为 BRIEF 路径字符串），只附 `acceptanceCommands` | `packages/dsh-plugin-requirements/index.js:217` | 执行器拿到的是「文件路径」而不是「本轮约定的完整正文 + AC」；运行与正文版本无绑定 |
| 8 | 需求更新通道只允许 `title / priority / brief`，brief 按**完整 Markdown 逐字**保存，带 baseline CAS、rehearsal、审计 | `packages/alm-core/src/requirements/update.mjs`（`UPDATE_FIELDS`、`assertBaseline`） | 已有「确认后正文版本化写入」的成熟通道，可直接复用，不必新建写路径 |
| 9 | 确认已有 `payloadHashOf`（幂等回执）与 `expectedInputRevision` 校验 | `packages/alm-core/src/intent/confirm.mjs:167`、`:651` | 幂等与迟到保护已有，但**没有草稿内容哈希/CAS**：客户端预览的草稿可能已被再分析改掉 |
| 10 | 意图视图已把 `candidate` 投影给客户端 | `packages/alm-core/src/intent/view.mjs:106` | 确认前预览有现成出口，只需扩字段 |
| 11 | 详情页已是 v4 完整页面（`data-detail-page: 'v4'`） | `packages/dsh-plugin-requirements/client.js:4246` | 本轮只加「需求描述主区」，不重做壳 |
| 12 | 真实 BRIEF 里已有「AI 评审建议（已采纳 2026-10-31）」小节 | `requirements/briefs/REQ-ALM-001.md` | 历史需求补全时，采纳事实必须保留，不能当未采纳、也不能照单全收 |

结论：**问题不在「没有详情页」，而在「正文没有契约」**——分析侧没有功能行为层、确认侧渲染格式临时、读取侧截断、执行侧不绑定版本。

---

## 2. 目标架构

```
原始意图 + 澄清问答 + 人工修改 + 已核实上下文
        │  (模型，现有 intent/analyze 链路)
        ▼
  需求文档草稿 docDraft            ← 会话内，可编辑、带来源、可 diff
  { problem, goal, features[], scope[], outOfScope[], acceptance[], constraints[], pending[], provenance }
        │  确认（用户看到的那一版）
        ▼  CAS: docHash + inputRevision + contextSnapshotId + sessionRevision
  规范 Markdown（唯一主源）        ← requirements/briefs/<ID>.md
  # REQ-X 标题
  ## 目标 / ## 问题与场景
  ## 详细功能  ### FR-01 …
  ## 本次范围 / ## 不包含
  ## 验收要求  - AC-01（FR-01）…
  ## 必要约束 / ## 待确认
  <!-- alm:meta {...} -->
        │  服务端解析（唯一解析器）
        ▼
     docView 投影  ──► 详情页「需求描述」主区
                 ──► 执行提示（完整正文 + FR/AC）
                 ──► 运行记录（revision + docHash）
                 ──► 验收结果按 AC ID 回填
```

三条硬边界：

- **一份内容**：Markdown 是主源；`docView` 每次从主源解析，不缓存为第二真相，不允许前端另建标题白名单。
- **一种编辑方式**：结构化编辑器（FR/AC 列表）通过共享 `renderDoc()` 生成 Markdown；允许人工直接改 Markdown（兼容），但读取不自动改写，解析不了的段落原样保留并提示。
- **一套 ID**：FR/AC ID 一经确认不复用、不重编号；再生成时按 ID→文本相似度匹配，新增追加编号。

---

## 3. 正文规范与数据契约

### 3.1 规范 Markdown（`alm.requirement.doc/v1`）

```markdown
# REQ-ALM-005 新建需求更容易被发现

## 目标
一句话说明要达到的结果（不含实现方式）。

## 问题与场景
- 现在新建需求默认出现在列表末尾，用户需要滚动查找。

## 详细功能
### FR-01 新建需求按创建时间降序
- 行为：新建需求后，列表默认按创建时间从新到旧排序。
- 前置：需求列表已加载；当前未设置其他排序。
- 响应：新建成功后列表首位可见新需求。
- 边界：无需求时显示空态，不显示排序控件。
- 来源：用户回答 A-2

### FR-02 列表纵向滚动
- 行为：列表内容超出可视区域时可纵向滚动，表头固定。
- 边界：滚动时不触发行点击。
- 来源：用户原话

## 本次范围
- 列表排序与滚动交互。

## 不包含
- 不改查询条件与数据结构。

## 验收要求
- AC-01（FR-01）新建后刷新，列表首位为该需求。
  - 判定：人工核对列表首位 = 新建需求 ID。
- AC-02（FR-02）列表高度不足以容纳全部项时出现纵向滚动条，表头保持可见。

## 必要约束
- 仅调整列表容器与排序函数，不改查询条件。

## 待确认
- [ ] 同创建时间（同一毫秒）的排序规则。
- [ ] 「查询条件优化」是否属于本次范围。

<!-- alm:meta {"nextFr":3,"nextAc":3,"confirmedAt":"2026-11-04T04:00:00.000Z","docHash":"sha256:..."} -->
```

规范章节固定、顺序固定、标题固定（`目标`/`问题与场景`/`详细功能`/`本次范围`/`不包含`/`验收要求`/`必要约束`/`待确认`）。渲染器只输出有内容的章节（空章节省略），确保「有才显示」。

### 3.2 结构化契约（内存/API 传输，`alm.requirement.doc/v1`）

```json
{
  "schema": "alm.requirement.doc/v1",
  "requirementId": "REQ-ALM-005",
  "revision": 1,
  "docHash": "sha256:…",
  "goal": "…",
  "problem": "…",
  "features": [
    { "id": "FR-01", "title": "新建需求按创建时间降序",
      "behavior": "…", "preconditions": ["…"], "response": "…",
      "boundaries": ["…"], "sources": ["answer:A-2"], "provenance": "user-answer" }
  ],
  "scope": ["…"], "outOfScope": ["…"],
  "acceptance": [
    { "id": "AC-01", "featureIds": ["FR-01"], "text": "新建后刷新，列表首位为该需求",
      "judgement": "人工核对列表首位 = 新建需求 ID", "sources": ["answer:A-2"] }
  ],
  "constraints": ["…"],
  "pending": [{ "id": "Q-01", "text": "同创建时间的排序规则", "status": "open" }],
  "meta": { "nextFr": 3, "nextAc": 3 }
}
```

### 3.3 来源与承诺标记（关键）

每个条款（feature / AC / scope / outOfScope / constraint）带 `provenance`，取值固定：

| provenance | 含义 | 能否写入正式承诺 |
|---|---|---|
| `user-stated` | 用户原话/输入直接给出 | 可以 |
| `user-answer` | 用户回答澄清问题时给出 | 可以 |
| `human-edit` | 用户在草稿里手工改过 | 可以（视为确认） |
| `verified-context` | 已核实的项目事实（读到的现有需求/约束） | 可以，但必须带引用（文件/条款 ID） |
| `ai-suggestion` | AI 推导补充（新规则、阈值、排除、权限承诺） | **不可以**，只能进「待确认」 |
| `unconfirmed` | 从旧数据迁移、来源不可考 | 不可以，展示为待确认 |

规则：

- AI 新增的业务规则/阈值/排除/权限承诺，**一律**落到 `pending`，不写进正式条款；「未选择、未反对」≠ 采纳。
- `outOfScope` 只能来自用户明确排除或已核实决定；AI 不得把「没提到」补成「不包含」。
- 历史 BRIEF 里的「AI 评审建议（已采纳）」是**已发生的采纳事实**：整理时保留、标注来源为 `verified-context`（引用采纳记录），但不把未采纳建议当成当前约定。

### 3.4 稳定 ID

- `FR-\d{2,}` / `AC-\d{2,}`，同一需求内单调递增，删除不复用；编号水位存于文末 `<!-- alm:meta -->`。
- 再生成/再整理时的匹配顺序：① 同 ID → ② 文本相似度 ≥ 0.6 → ③ 新增（追加编号）。
- 已确认的 AC **不重编号、不静默删除**；被替代时保留旧 ID 并在确认快照中记录 `supersededBy`。

### 3.5 内容哈希契约

- `docHash = sha256(normalize(markdown))`；`normalize`：CRLF→LF、去行尾空白、连续空行压成一个、文末单个换行、`alm:meta` 中的 `docHash` 自身参与前先置空。
- **章节顺序、条款文本、条款 ID、是否包含某条款**都会改变哈希；纯缩进/空行不改变。
- 哈希只在服务端计算与校验，客户端传的 hash 仅用于「是否过期」提示，不作信任依据。
- 哈希变了就是新内容版本：旧候选/验收证据按现有 `requirementHash` 规则失效（见 §6）。

---

## 4. 端到端链路

### S1 分析：从意图生成草稿

- 扩展分析输出 schema（`intent-review.v3`）：`candidate` → `docDraft`，新增 `features[]`、`constraints[]`、`pending[]`，`acceptance[]` 增 `id`/`featureIds`；旧 `candidate` 字段保留读取兼容。
- 提示词（`intent/messages.mjs`）增加约束：功能条目必须可观察、写清前置/响应/边界；不编造状态机；不确定的进 `pending`；每条必须有来源（引用输入/回答 ID）。
- 归一化（`analysis.mjs`）：`normalizeDocDraft()` 负责 ID 分配、来源校验、`ai-suggestion` 强制进 pending、空条目丢弃并记 warning；不再丢弃「只有 expected 没有 action」的验收——转成 `pending` 里的待确认项。
- 合并策略（对齐现有问题组）：已回答决定进入对应条款；同一决策被新事实推翻时，保留旧条款为「已替代」并写变化说明，不静默覆盖。
- 人工锁定：用户编辑过的条款标 `human-edit`，后续分析不得覆盖（与详情 v4 的「人工编辑不被迟到补丁覆盖」同一原则）。
- **不新增模型阶段**：草稿仍由现有 analyze 调用产出，只是输出更结构化。

### S2 确认前预览与编辑

- `intent/view.mjs` 投影增 `docDraft`（含 `docHash`、`basedOnInputRevision`、`draftRevision`、`provenance`、`pending`）。
- 意图弹层「结果」屏增加**需求草稿面板**（可折叠，不新增页签）：目标 / 功能条目 / 范围 / 不包含 / 验收 / 待确认，每块带来源徽标与「修改」入口；`待确认` 与正式条款视觉分离。
- 任何编辑或新回答都递增 `draftRevision`，并在回到预览时显示「草稿已更新（3 处变化）」，可展开 diff。
- 确认按钮绑定的不是「当前模型输出」，而是**用户屏幕上这一版草稿的 `docHash`**。

### S3 确认：保存用户看到的版本

- 请求体增：`docHash`、`draftRevision`、`expectedSessionRevision`（沿用现有 `expectedInputRevision`）。
- 服务端顺序校验：① `expectedInputRevision` 一致（已有）；② `expectedSessionRevision` 一致（已有批量回答 CAS）；③ 用会话里的草稿重新计算 `docHash` 与请求值比对，不一致 → `409 draft-changed`，返回差异摘要与最新草稿，**保留用户输入**；④ 上下文快照 `contextSnapshotId` 仍有效。
- 落盘：`renderDoc(markdown)` → 复用 `planRequirement`/`requirements/update` 的既有 CAS 写入；回执记录 `requirementId + revision + docHash + 条款 ID 列表 + 确认快照`（`.alm/intents/receipts/`）。
- 幂等：沿用 `payloadHashOf`，同一 payload 重试返回同一回执与同一需求，不重复创建。
- 不新增第二道评审：确认动作保持一次；AI 建议是否采纳仍是确认前的一个可选项。

### S4 读取：完整正文 + 统一解析

- `query.mjs`：去掉 `.slice(0, 8000)`；改为 `briefText` 全文 + `briefBytes`/`briefTruncated:false`。列表 API 若担心响应体过大，返回 `briefExcerpt`（如 240 字符）+ `briefBytes`，**详情与执行一律取全文**。
- 新增 core 解析器 `packages/alm-core/src/requirements/doc.mjs`：`parseDoc(markdown)`、`renderDoc(doc)`、`normalizeDoc(doc)`、`docHashOf(markdown)`、`diffDoc(a,b)`、`validateDoc(doc)`。
- `query.mjs` 给每个 item 附 `docView = parseDoc(briefText)`（含 `legacy:true` 标记与 `sections`），`detail-view.mjs` 直接用 `docView`，不再自己按标题白名单猜。
- 解析失败或未知章节：`docView.unparsed = [{title, text}]`，详情**原样完整展示**并提示「此段未按规范整理」，不塞进背景、不丢内容。

### S5 详情：需求描述主区

在 v4 详情「当前待办」之后、页签之前，插入**需求描述**主区（保留 v4 的壳、页签、唯一主动作）：

1. 状态徽标：`AI 整理·未确认` / `已确认需求描述` / `根据现有正文展示`（依据：有无确认快照 + docView 是否规范）。
2. 目标（一句）+ 问题与场景。
3. 详细功能 FR-01…（每条：名称、行为、前置、响应、边界；来源可展开）。
4. 本次范围 / 不包含 / 必要约束（有内容才显示；只显示一行摘要 + 「展开」，关键排除**不得**被折叠掉）。
5. 验收要求 AC-01…（标注对应 FR；有验收证据时在 AC 行尾显示最近结果，引用同一 AC ID，不复制第二份可编辑验收文本）。
6. 待确认 / AI 建议（明确标注「未纳入正式承诺」）。
7. 「原始意图与澄清记录」「来源与修订」按需展开（默认折叠）；「整理需求描述」入口（历史需求，见 §7）。

### S6 执行与验收同源

- `buildExecutionPrompt()` 改为接收 `docView` 与绑定信息：`需求：REQ-X v3（docHash sha256:ab12…）` + **完整正文**（上限如 60k 字符，超限**拒绝启动并明确提示**，不静默截断）+ 验收命令（按 AC 标注）。
- 运行记录（`.alm/runs/RUN-*.json`）增 `requirementRevision`、`docHash`、`acceptanceIds`；详情区分「本轮执行约定 v3（sha256:ab12）」与「最新编辑草稿 v4」。
- 验收执行结果按 `acceptanceIds` 回填；`decision`/证据继续用 `requirementHash` 判失效（沿用现有规则，不新增门禁）。
- 每个已确认功能**不强制**都有 AC：没有时详情明确显示「仅人工验证」，不伪造自动证据。

---

## 5. API / 契约变更

| 接口 | 变更 | 兼容 |
|---|---|---|
| `POST /api/alm/requirements/intent`（`action:'analyze'`） | 输出 `docDraft`（schema `alm.requirement.doc.draft/v1`）+ `draftRevision`；保留旧 `candidate` 字段 | 旧客户端读不到新字段不受影响 |
| `POST …/intent`（`action:'answer'`） | 回答后草稿增量更新；返回 `docDraft`、`draftRevision`、`changes[]` | 字段新增 |
| `POST …/intent`（`action:'confirm'`） | 请求增 `docHash`、`draftRevision`；错误增 `409 draft-changed`（带最新草稿与 diff） | 不传 `docHash` 时按旧行为（仅 inputRevision 校验），并记 warning |
| `GET /api/alm/requirements` | item 增 `briefBytes`、`briefExcerpt`、`docView`、`docMeta{confirmedAt, docHash, revision}` | 列表不返回全文 |
| 新增 `POST /api/alm/requirements/description` | `{action:'organize'\|'load'\|'save'\|'diff', requirementId, markdown?, doc?, expectedBaseline?, apply?}`；历史需求整理草稿、预览差异、显式保存 | 新接口 |
| 运行启动 | prompt 与 run 记录绑定 `docHash`/`revision`/`acceptanceIds` | 旧 run 无字段时按「未知绑定」展示，不阻断 |

---

## 6. 版本、哈希与失效规则

| 事件 | docHash | 需求 revision | 既有证据 | 说明 |
|---|---|---|---|---|
| 纯格式整理（不增删条款、不改文本） | 不变 | 不变 | 不变 | 规范渲染下格式整理不产生新版本；若人工 Markdown 空格变化，`normalize` 已吸收 |
| 修改条款文本/新增 FR/AC/范围 | 变 | +1 | 候选与验收证据按 `requirementHash` 失效（现有规则） | 详情显示「已验收」不再是当前版本 |
| 删除条款 | 变 | +1 | 同上；确认快照保留旧 ID 记录 | 不静默删 ID 水位 |
| 重新生成草稿但未确认 | 不落盘 | 不变 | 不变 | 只有「保存」形成新版本 |
| 运行中修改正文 | 变 | +1 | 旧 run 绑定旧 `docHash`，不得使用新版本；新版本未授权不得推进旧运行 | 详情同时显示「本轮执行约定」与「最新草稿」 |
| 迁移旧 BRIEF | 解析后计算 | 不变 | 不变 | 读取不改写 |

关键条款：**授权/签收/发布绑定的是 `requirementHash`，不是「文件有没有被碰过」**；格式规范化若改变了哈希（极端情况），按 §6 第 2 行处理并提示需要重新确认，不能借整理移植旧签收。

---

## 7. 历史需求补全（以 REQ-ALM-001 为例）

原则：**显式、按需、可预览、不后台重写、不批量覆盖**。

1. 详情页提供「整理需求描述」按钮（仅当 `docView.legacy === true`）。
2. 服务端 `organize` 生成补全草稿，来源只允许：现有 BRIEF 正文、已核实采纳记录（`aiReview.adopted` + 实际写入的小节）、已有关联验收用例（`verifiedBy`）、**确实存在的**澄清会话回执。找不到就说找不到，不靠标题相似拼接。
3. 草稿以 diff 呈现：新增条款、改写条款、从原文提升为正式条款、无法确定而进「待确认」的项。
4. 用户显式「保存为新版本」→ 走 `requirements/update` 的 CAS 写路径，产生新 revision；不自动重签收、不自动发布、不打断运行。
5. 「AI 评审建议（已采纳 2026-10-31）」处理：
   - 保留采纳事实（引用 `adopted.at` / `suggestionIds`）；
   - 逐条核对「哪些已体现在当前正文」，冲突项（采纳了但正文没有 / 正文有但未采纳）列为待确认，呈现证据而不是替用户裁决；
   - 未采纳建议不得进入正式承诺。
6. 不从实现/测试反推承诺；不凭「苹果级体验」「全面优化」这类形容词生成条数、排序、吸顶、性能阈值。

---

## 8. 前后端共享解析器（唯一实现）

新增 `packages/alm-core/src/requirements/doc.mjs`（纯函数，零依赖）：

```js
export const DOC_SCHEMA = 'alm.requirement.doc/v1'
export function parseDoc(markdown)        // → { doc, legacy, unparsed, warnings }
export function renderDoc(doc)            // → 规范 Markdown（含 alm:meta）
export function normalizeDoc(doc)         // ID 分配/来源校验/空条目清理
export function docHashOf(markdown)       // 规范化 + sha256
export function diffDoc(before, after)    // → { added, removed, modified, pending }
export function validateDoc(doc)          // 结构校验（不要求每节必填）
```

复用点：

- `intent/confirm.mjs` 用 `renderDoc` 替换 `candidateMarkdown`；`intent/analysis.mjs` 用 `normalizeDoc`。
- `requirements/create.mjs` 的 `briefMarkdown()` 改造为「规范正文 + 保留 TITLE/PRIORITY 等 sdoc 字段」，**不再**把整份 brief 塞进 `## 背景` 再重复 `## 目标`。
- `query.mjs` 用 `parseDoc` 产 `docView`；`detail-view.mjs` 删掉本地标题推断逻辑，改消费 `docView`；`client.js` **不再**维护标题白名单正则。
- 执行提示用 `docView` 渲染，验收回填用 `doc.acceptance[].id`。

兼容：

- 旧加粗标签（`**目标**：`、`**范围内**：`、`**范围外**：`、`**验收条件**`）解析为对应章节；
- 旧「背景」整段且内含「目标」的，按 §3.1 拆分并标 `legacy:true`（只读展示，不回写）；
- 未知标题 → `unparsed`，原样完整展示；
- 嵌套列表/人工 Markdown：保留原文文本，不重构语义。

---

## 9. UI 变更（在既有页面上增量）

| 位置 | 变更 | 不做什么 |
|---|---|---|
| 意图弹层「结果屏」 | 新增可折叠「需求草稿」面板：目标 / FR 条目 / 范围 / 不包含 / AC / 待确认；来源徽标；「修改」局部编辑；diff 计数；确认按钮显示将保存的 `docHash` 短值 | 不新增页签、不加第二次确认、不要求每节必填 |
| 意图弹层「确认屏」 | 展示即将写入的规范正文预览（只读）+ 变更摘要；冲突时提示「草稿已更新，请重新确认」并保留输入 | 不静默覆盖用户输入 |
| 详情页 | 当前待办下方新增「需求描述」主区（§4 S5）；历史需求显示「整理需求描述」 | 不重做 v4 壳、不新增页签、不套层弹窗 |
| 编辑入口 | 结构化编辑器（FR/AC 列表 + 目标/范围）→ 保存走 `requirements/update` 版本化 | 不允许「直接改文件」成为唯一编辑方式（Markdown 直改仍兼容） |
| 验收展示 | AC 行引用同一 AC ID 显示最近结果 | 不复制第二份可编辑验收文本 |

可访问性：草稿面板与 diff 支持键盘、焦点可见、`aria-expanded`；长文折叠不隐藏关键排除；减少动效时不做展开动画。

---

## 10. 迁移与兼容

1. **旧会话**：`session.candidate`（v1 结构）→ 读取时合成 `docDraft`（problem→问题与场景、goal→目标、inScope→本次范围、outOfScope→不包含、acceptance→AC-01..，`provenance:'unconfirmed'`，无 FR），标 `legacy:true`；不回写会话文件。
2. **旧 BRIEF**：读取解析、展示原文 + `legacy` 提示；不批量重写。
3. **旧回执**：`payloadHash` 保持有效；新回执增 `docHash`，旧回执缺字段时按「未绑定正文版本」展示。
4. **运行记录**：旧 run 无 `docHash` → 详情显示「本轮未绑定正文版本（历史运行）」，不阻断。
5. **sdoc 字段**：不新增必填字段；`<!-- alm:meta -->` 写在 BRIEF 内，解析器吸收，索引器忽略注释。

---

## 11. 任务拆分（建议 6 张卡）

| # | 任务 | 主要改动 | 依赖 | 验收 |
|---|---|---|---|---|
| T1 | core `doc.mjs` 契约与解析 | 新增 `packages/alm-core/src/requirements/doc.mjs` + `test/unit/requirement-doc.test.mjs`（≥24 用例：解析/渲染往返、旧格式、未知章节、ID 稳定、哈希规范化、diff、超长） | — | 单测全过；往返 `parse(render(doc)) === doc` |
| T2 | 分析输出 v3（草稿） | `intent/messages.mjs` 提示、`intent/analysis.mjs` 归一化（FR/AC/来源/pending）、`intent/session.mjs` 存 `docDraft`+`draftRevision` | T1 | 契约测试：AI 建议必进 pending；半条验收转 pending；人工锁定不被覆盖 |
| T3 | 确认与落盘 | `intent/confirm.mjs`（`docHash` CAS、`renderDoc`、回执快照）、`requirements/create.mjs`（规范正文，消除背景/目标重复） | T1,T2 | 旧预览确认 409；重试幂等；落盘 BRIEF 无重复段 |
| T4 | 读取/详情/执行同源 | `query.mjs`（去 8000 截断、`docView`、`briefBytes`）、`detail-view.mjs`（消费 `docView`）、`index.js`（prompt 绑定 revision/docHash/AC、run 记录） | T1,T3 | 12k 长文两端完整；详情/执行读同一 hash；旧 run 兼容 |
| T5 | UI：意图草稿 + 详情正文 + 历史整理 | `client.js`（预览/编辑/冲突/详情主区/整理入口）、`intent.mjs` 路由（organize/load/save/diff） | T2,T3,T4 | Playwright：草稿编辑→确认→详情；冲突提示；历史整理只读预览 |
| T6 | 验证与报告 | 隔离工作区 E2E、真实模型证据、`artifacts/requirement-description-v5/<ts>/`（HTML 报告 + 结构化结果 + `codex-handoff.md`） | T1–T5 | 简报 §11 八条验收逐条有证据 |

顺序原则：先契约（T1）→ 再语义（T2/T3）→ 再读取/执行（T4）→ 最后 UI（T5）；每张卡单独可运行、`pnpm test` 0 fail。

---

## 12. 风险与对策

| 风险 | 表现 | 对策 |
|---|---|---|
| 模型输出不稳定（FR 时有时无） | 同一意图两次生成结构差异大 | 归一化 + `pending` 兜底；不因模型少给一条就判失败；确认前必须人工可见 |
| ID 抖动 | 重生成导致 FR 编号变化、历史 AC 丢关联 | ID 匹配算法 + 水位持久化 + 确认后不重编号；测试覆盖「多次再生成 ID 稳定」 |
| 双写冲突 | 结构化编辑与 Markdown 直改互相覆盖 | Markdown 唯一主源；结构化编辑必须经 `renderDoc`；直改后下次打开以文件为准并提示 |
| 长文 | 提示词/响应超限 | 执行侧超限**拒绝并提示**；详情分块加载返回 `briefBytes/truncated`，不静默截断 |
| 旧格式兼容 | 老 BRIEF/人工 Markdown 被误解析 | `legacy`/`unparsed` 原样展示；不自动改写；迁移测试覆盖 5 种旧格式 |
| 「已采纳」误判 | 把采纳记录当当前约定 | 采纳只作来源证据，逐条核对正文；冲突进 `pending` |
| 范围扩散 | 变成「重做详情页 v5」 | 明确不做：不改页签/主动作/授权/验收门禁；详情只加主区 |
| 门禁被削弱 | 借「整理」跳过验收/签收 | 哈希变更即版本变更，沿用既有 `requirementHash` 失效与门禁规则 |

---

## 13. 需要你确认的 3 个决定（已给推荐）

1. **主源选 Markdown（推荐）**：人可读、Git 可审、复用现有版本/门禁/更新通道；结构化只是派生视图。代价：结构化编辑器必须走统一渲染，不能绕过。
2. **允许人工直接改 Markdown（推荐允许，但以结构化编辑为主）**：兼容现状与外部工具；读取不自动改写，解析不了就原样展示并提示。
3. **历史需求（REQ-ALM-001）先只生成草稿、不自动保存（推荐）**：需要你看到差异并明确点「保存为新版本」；不改真实需求、不自动重签收/发布。

---

## 14. 完成标准（验收口径）

- 在真实澄清里做一次重大澄清 → 确认前看到含 FR/AC 的草稿 → 确认 → 详情读到**同一份规范正文**（不是原话重放、不是背景目标重复）→ 执行提示里拿到**同一 `docHash` 的完整正文** → 验收结果能按 AC ID 对上。
- AI 新增内容在确认前标 `待确认`，未采纳的不进正式承诺；已采纳的可见但不冒充「当前已确认」。
- 12k 字符长文（末尾含「不包含」与 AC）在详情、执行、编辑保存后都完整。
- 人工编辑不被迟到的模型补丁覆盖；旧预览确认被明确拒绝且输入保留。
- 「整理需求描述」只生成草稿，不批量改真实需求。

---

## 15. 附：与 v5 简报的对齐检查

| 简报要求 | 本设计对应 |
|---|---|
| A 结构化正文一份多界面共用 | §3 契约 + §8 唯一解析器 |
| B 澄清中形成草稿、确认前可见 | §4 S1/S2 + §9 意图草稿面板 |
| C 确认保存用户看到的版本 | §4 S3（`docHash`+`draftRevision`+`sessionRevision` CAS） |
| D 详情默认展示正式描述 | §4 S5 + §9 详情主区 |
| E 执行/验收同源 | §4 S6（revision/docHash/AC 绑定） |
| F 历史需求显式草稿补全 | §7 |
| 移除 8000 截断 | §4 S4 + T4 |
| 兼容旧格式、不静默收进背景 | §8 兼容 + §10 |
| 8 条必须验证 | §11 T6 + §14 |

---

## 16. 实施结果（2026-11-04 已落地）

按 §14 任务拆分实施完成，设计假设与实现一致；以下为可核对的结果，细节见
`artifacts/requirement-description-v5/2026-11-04T06-50-20/codex-handoff.md`。

### 16.1 落地的能力

| 层 | 交付 |
|---|---|
| 正文契约 | `packages/alm-core/src/requirements/doc.mjs`：`parseDoc` / `renderDoc` / `normalizeDoc` / `docHashOf` / `diffDoc` / `validateDoc`，27 用例；旧格式「背景/范围内/范围外/验收标准/加粗标签」兼容，未知章节进 `unparsed` 且 `legacy=true`，不静默收进背景 |
| 澄清草稿 | 意图分析 v3 `docDraft`（FR/AC/provenance/pending）；`set-doc-draft`、`lock-clauses`/`unlock-clauses`；草稿随 inputRevision/sessionRevision 更新，人工锁定不被覆盖 |
| 确认 | `confirm` 校验 inputRevision → sessionRevision → 服务端重算 `docHash`/`draftRevision` → 上下文；409 `draft-changed` 带 `latest` 与 `diff`，不吞输入 |
| 落盘 | `create.mjs` 用「# ID 标题 + 规范正文」，消除「整份 brief 进背景再重复目标」；走既有 `update.mjs` CAS 版本化 |
| 读取 | `query.mjs` 去掉 `slice(0, 8000)`；`docView`/`docMeta`/`briefBytes`/`briefExcerpt`；`> 60000` 字符明确 422，不截断 |
| 详情 | V4 全页壳「当前待办」后新增需求描述主区：canonical / legacy / unconfirmed 三态、FR/AC、逐项验收结果、待确认未纳入承诺、来源与原始意图折叠、legacy「整理需求描述」→ 草稿 → 差异 → 显式保存 |
| 执行同源 | `buildExecutionPrompt` 带 `需求：<ID> v<revision>（docHash <hash>）` 与完整正文；run 记录绑定 `requirementRevision`/`requirementDocHash`/`acceptanceIds` |

### 16.2 验证数字

- `pnpm test`：**919 / 919 pass，0 fail**（集成阶段复跑；含新增 doc/意图/确认/description/run 绑定用例）
- `ui-desc-v5` 34 / 34；`ui-detail-v2` 59 / 59；回归 `ui-feedback` 39/39、`ui-answer-submit` 23/23、`ui-intent-group` 35/35
- 真实数据：REQ-ALM-001 `docStatus=legacy`、`docHash=sha256:be95ce3f…`、3715 bytes、context `review-blocked`；REQ-ALM-004 `released`、3201 bytes —— 历史需求按设计只显示正文+「整理」入口，不自动改写

### 16.3 与设计的偏差（已核对，不改变架构）

1. 评审阻塞语义在实施期间被并行改动改为「AI 评审派生」（规则五角色引擎移出 executor），详情据此显示 `attn-review-blocked` / `fix-review`；本方案的正文与确认链路不受影响。
2. `description` 的 `organize` 恒为只读，`diff` 当前返回 `null`（草稿差异在 UI 侧按 `docHash`/`draftRevision` 与逐节变化呈现）。
3. `restart` 路径仍用 `buildRestartPrompt`，未加 docHash 头；执行主路径已同源。
4. 历史需求整理只生成草稿、不自动保存（符合 v5 决策 3）。

### 16.4 未达标项

- 未驱动真实宿主 GUI 截图（宿主鉴权 401）：验证用真实 `client.js` + 真实 `query.mjs` 读 D:/DSH + 离线 mock 传输层，报告已注明；未调用真实模型，评审/意图响应为夹具。
- V4 可见「当前待办」文案在部分构造夹具下与 `detailView.context.headline` 不一致（结构断言按 `data-detail-context` 校验），属旧 matter 文案遗留。
- 正文「人工直改 Markdown」仍以结构化编辑为主入口，直接改文件后需刷新；文件监听不在本版范围。
