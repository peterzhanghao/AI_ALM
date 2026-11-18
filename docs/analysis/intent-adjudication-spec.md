# 需求澄清判决式重构方案

> 状态：设计定稿（待按 §13 分期实施）
> 范围：`packages/dsh-plugin-requirements`、`packages/alm-core/src/intent`
> 关联：`intent-clarification-review.md`（v1 评审）、`intent-clarification-v2-assessment.md`（v2 评估）
> 本文只定义「需求澄清应该是什么样」，不重复 v2 已确认的 contract 约束（CAS、幂等、审计回执）。

## 0. 摘要

当前澄清把「问清楚」当成目标，于是它的产物是一份看起来完整的表单；系统无法回答更要紧的问题：**这条诉求该不该存在、是不是已经存在、它属于哪一条需求、值不值得做。**

本方案把澄清重新定义为**一次带证据的判决（adjudication）**：

```
输入：一句诉求 + 可检索的历史 + 可观察的行为证据
输出：一个判决（八选一）+ 证据链 + 只针对该判决的条款增量
```

判决先于表述。没有判决，不写正文。

## 1. 现状诊断（实测，非推断）

`INT-20261117041544-612f10` 是本方案的触发样本：

| 观测点 | 实测值 | 说明 |
|---|---|---|
| `runs[-1].errorCode` | `ai-call-failed` | 模型调用失败 |
| `runs[-1].timing` | `totalMs 16280`，无 `modelMs`、无 `firstTokenMs` | 首 token 从未到达，被 15s 闸掐断 |
| `grill` | `status: loaded` / `outcome: fallback` | skill 读到并注入，但本轮未运行 |
| `items[0].candidate` | 标题 / 目标 / 验收 = 用户原话 | `suggestedLocalDraft` 回填 |
| `problem` | `用户原话尚未说明具体影响：…` | 模板句，非分析 |

全量会话统计（`.alm/intents/sessions`，20 个有 runs 的会话）：

| 指标 | 值 |
|---|---|
| 成功 | 3 |
| `ai-call-failed` | 17 |
| Grill `applied` | **0** |
| Grill `fallback` | 2 |
| 成功轮次首 token 耗时 | 7.4s / 8.9s / 11.1s |

三个结论：

1. **Grill 从未真正运行过。** 它被当作 prompt 文本注入（`intent.mjs:111-128`），而 skill 的操作性约定（多轮 frontier、等回答、子代理取事实、每题附推荐答案）在单次 HTTP 调用里无法执行。
2. **失败被伪装成产物。** `suggestedLocalDraft`（`intent.mjs:861-921`）用关键词规则生成标题、问题与验收，UI 仍允许「确认并创建需求」。用户感知到的是「澄清没用」，而不是「它坏了」。
3. **失败不进台账。** `.alm/failures` 中 0 条来自澄清链路，17 次失败只躺在 `runs[]` 里。这让「自动修复」缺少唯一的入口证据。

附带发现（与查重直接相关）：`matcher.mjs:19-21` 用 `[\u4e00-\u9fff]{2,8}` 切中文，导致语义相同的两句得到空交集：

```
「需求插件遇到缺陷」→ ['需求插件遇到缺陷', '时自动修复并重启']
「需求插件功能异常」→ ['需求插件功能异常', '自动修复']
交集 = []
```

同时 `context.mjs:45` 用的是 bigram。一个系统两套中文匹配算法，且都不参与 create 的判决（`readiness.mjs:299-313` 不校验 `related` 中的 `covered` / `conflict`）。

## 2. 设计公理

违反任何一条，系统都退化为填表。

1. **判决先于表述**：先定归属，再写条款。未判决的诉求不得生成需求正文。
2. **事实先于提问**：能查的（代码、文档、历史条款、失败台账）由机器查；查不到的才成为决策。
3. **反证先于理由**：`为什么需要` 不可证伪；`已有替代 / 无二次触发 / 成本>损失` 可证伪。
4. **失败必须显式**：失败是一等产出。伪造草稿是最贵的错误，因为它看起来像成功。

推论：**拒绝是一等公民**。一个不能体面拒绝的系统，必然把所有请求都变成需求。

## 3. 主流程：五段四闸

```
S0 归一  → G1 证据等级 + 分型
S1 三查  → G2 命中先裁后问
S2 验伪  → G3 缺答降级不拦死
S3 归属  → G4 多决策轴给拆分
S4 成型  → G5 验收不可执行不入库
```

### S0 归一

把原话拆成三样东西，不许合并：

- **诉求**：他想解决什么（可观察的损失）。
- **隐含方案**：他顺口给出的实现（`让 DSH 对话框修复` 是方案，不是诉求）。
- **证据等级** `evidenceClass`：`observed`（失败台账 / 操作痕迹 / 工单）/ `stated`（用户口述）/ `inferred`（AI 推断）。

同时给出 **需求分型** `kind`：`defect | capability | experience | compliance | exploration`。分型决定后续只问哪两个问题（§6）。

**G1 出口**：`evidenceClass` 与 `kind` 必须存在。缺失时默认 `stated` + `capability`，并标记为待确认。

### S1 三查

查重是判决问题，不是排序问题（§5）。

**G2 出口**：若存在 `covered` 或 `conflict` 且用户未裁决，**不得进入追问**。先让用户在「就是这条 / 不是 / 相关但独立」中选一个。

这是当前最大的顺序错误：先追问 3 轮再定去向。查重是 1 秒的机器活，追问是用户 5 分钟的成本。

### S2 验伪

按分型裁问 + 三条反证（§6）。

**G3 出口**：答案缺失不阻断，降级为 `defer`，并写明缺什么、什么条件下补。

### S3 归属

八种判决选其一（§4），并做粒度检查（§8）。

**G4 出口**：检出一个以上决策轴时，给出拆分方案；拆开后不可独立验收的（如 AC-04 依赖 AC-01/05）不得硬拆。

### S4 成型

只写被判定的那部分：

- `create` → 新条款，带 `sources` 与 `provenance`
- `extend` / `revise` → 条款 diff，不重写全文
- `merge` → 合并稿 + 双向引用
- `split` → 多条草案，共享一份背景

**G5 出口**：任一条验收不可执行（缺前置/动作/预期/判定），不得入库。

## 4. 判决矩阵

| 判决 | 必要条件（机器可校验） | 产物 | 写正文 |
|---|---|---|---|
| `create` | 三查无 covered/conflict；≥1 条可执行验收；验伪有结论 | 新需求 + 查重快照 | 是 |
| `extend` | 命中基线 `uid + revision`；增量不改变原验收 | 条款 diff | 增量 |
| `revise` | 命中基线；冲突定位到具体条款 ID | 变更提案 | 增量 |
| `merge` | ≥2 条同族；各自存活条款可列；主从明确 | 合并稿 + 双向引用 | 是 |
| `split` | 多决策轴且各轴可独立验收 | 拆分清单 | 多条 |
| `decline` | 理由 + 替代方案 + 再提触发条件 | 否决账本 | 否 |
| `defer` | 缺什么 + 补齐条件或到期日 | 观察项 | 否 |
| `answer` | 命中已有条款或文档 | 答疑回执 | 否 |

相对现状的增量：`split`（一条变多条）与 `defer`（带到期日的观察项）完全缺失；`extend` 与 `merge` 缺失，导致同族诉求只能不断新建。

`decline` 已有强校验（`readiness.mjs:353-358` 要求理由 + 替代方案），继续保持，但需要补两项：

1. **再提触发条件**：否则同类需求反复进入。
2. **进检索**：`confirm.mjs:8` 目前 `decline -> receipt only`，否决记录不可被下次查重命中，等于拒绝没有记忆。

## 5. 三查：条款级指纹 + 三通道召回 + 成对判定

### 5.1 判定单位是条款，不是需求

一条 5 个验收的需求，与新诉求重叠的往往只有 1 条；整篇 embedding 会被稀释。DSH 已有稳定的 `AC-xx` / `FR-xx`（`briefs/REQ-ALM-011.md`），天然适合作为检索单位。

### 5.2 条款指纹（写库时生成，查询时对齐）

每条条款抽五元组：

```json
{
  "clauseId": "AC-04",
  "object": "需求标题",
  "action": "覆盖写入",
  "condition": "用户手动修改过",
  "polarity": "forbid",
  "scope": ["需求列表", "标题"]
}
```

示例：用户说「AI 提炼完别把我改的标题又改回去」，与 AC-04 的词法相似度接近 0、向量判别不可靠，但指纹对齐是**完全覆盖**。

`polarity` 是当前完全没有的维度，也是「导出 CSV」对「导入 CSV」、「自动提炼」对「不得自动覆盖」这类误判的根因。

### 5.3 三本账

| 账本 | 内容 | 现状 |
|---|---|---|
| 已实现 | 需求条款 + 代码文件映射 | 部分（`context.mjs` 有路径匹配） |
| 在办 | 活跃需求与运行中的交付 | 有 |
| **已否决** | `decline` 记录 + 理由 + 再提条件 | **无** |

第三本缺失，是「同一个伪需求反复被讨论」的直接原因。

「已实现」这一路还有个更狠的问题可以回答：**这个能力是不是已经能用了**。消除「已经有了还要做」，收益大于消除「重复建需求」。

### 5.4 三通道召回 → 融合 → 成对判定

| 通道 | 方法 | 强项 |
|---|---|---|
| 词法 | 中文 bigram/trigram + 停用词 | 术语命中，零成本 |
| 语义 | 条款级向量 | 同义不同词 |
| 结构 | 指纹字段对齐（object + action + polarity） | 同义同指，极性可判 |

三路各取 top-k，用 RRF 融合，只对前 3–5 条做 **pairwise 判定**：

```
输出：covered | overlap | conflict | unrelated
     + 差异点（哪个字段/条款不同）
     + 双方原文引用（可校验）
```

**相似度是输入，不是结论。** 当前 `related[].match` 直接由词面重叠得出，这是类别错误。

### 5.5 先有评测集

用现有 18 条需求 + 否决记录构造 40 对标注（覆盖/部分/冲突/无关），测 `recall@5` 与 `precision@1`。没有基线数字的检索改造，只是把一种猜换成另一种猜。

**通过判据**：`precision@1 ≥ 0.8`，`recall@5 ≥ 0.9`。

## 6. 验伪：按型裁问 + 三条反证

### 6.1 按型裁问（替代「三问强制」）

| 类型 | 只问 2 问 | 谁答 |
|---|---|---|
| `defect` | 影响面多大 / 不做会持续损失什么 | 机器查失败台账（频次 × 影响面） |
| `capability` | 有替代品吗 / 谁会第二次用 | 机器查代码与已有条款 |
| `experience` | 摩擦卡在哪一步 / 多少人遇到 | 机器查反馈与操作痕迹 |
| `compliance` | 依据哪条外部要求 / 不做的后果 | 人（唯一必须人答） |
| `exploration` | 最小验证怎么做 / 什么信号就停 | 人给方案，机器补数 |

「三问强制」被弃用，两个原因：

1. 它把澄清变成考试，用户会编答案；编出来的答案比空答案更危险，因为它看起来像证据。
2. 对 P0 线上故障问「谁会第二次遇到」是荒谬的；对合规要求问「有替代品吗」是浪费时间。

### 6.2 三条反证

不问「为什么需要」，判三条反证：

| 反证 | 判定方式 | 成立则 |
|---|---|---|
| 已有替代且够用 | 代码/需求检索 | `decline` |
| 90 天内无第二次触发 | 失败台账 / 操作痕迹 | `decline` 或 `defer` |
| 成本估算 > 损失估算 | 人工粗估 + 影响面 | `decline` |

账本里写**反证**，不写理由。理由永远编得出来，反证会被推翻。

### 6.3 边界不得由 AI 推断

`outOfScope` 必须来自用户决策。当前契约允许 `ai-suggestion` 填边界，这是边界幻觉的主要来源。

## 7. 潜在需求：看绕过，不问想要

用户说不出自己需要什么，但行为会暴露。

| 类型 | 定义 | 识别信号 | 处置 |
|---|---|---|---|
| 伪需求 | 真实诉求 + 错误方案，或已有替代，或成本>损失 | 有替代品 / 无二次触发 / 绕过更便宜 | `decline` + 反证 |
| 潜在需求 | 用户没提，行为反复暴露 | **workaround 重复出现** | 自动生成 `observed` 候选 |
| 真需求 | 不做会持续受损，且有二次触发 | 失败/工单/操作痕迹 | `create` |

**证据等级门槛**：

- `observed` → 允许快通道（可跳过验伪，直接给 `create` 建议）
- `stated` → 必须过验伪
- `inferred` → 只能 `defer`，永远不能直接进 backlog

**workaround 聚类**：同一绕过行为出现 ≥3 次 → 自动生成 `observed` 候选，附三次原文与频次。数据源已在仓库里，只是没被用起来：

- `.alm/failures`（有 `fingerprint` / `dedupeKey`，天然可去重计数）
- feedback 台账（已分 `defect / experience / capability`）
- 人工修改痕迹（`human-edit` / `grillKey`）

这是系统「自己长出需求」的唯一可靠路径。

## 8. 粒度与归属

不用字数、不用关键词，只认两条：

1. **独立验收性**：拆开后每条能否单独验收、单独上线？能 → 该拆。
2. **单一否决核心**：一条需求只能有一个「失败即整体否决」的核心验收。出现第二个 → 该拆。

反例（本仓库真实存在）：AC-04「标题不得被自动覆盖」依赖 AC-01/AC-05 的行为，拆开即不可验收，属同一交付单元，**不该拆**。

粒度不是越细越好，是「可独立验收」最好。粒度与查重是同一件事的两面：粒度不清，指纹必然碰撞。

## 9. 失败层

### 9.1 拆调用

| 段 | 输出 | 失败影响 |
|---|---|---|
| 归一 | 诉求 / 隐含方案 / 分型 / 证据等级 | 小，可降级为默认值 |
| 查重判定 | ≤5 条候选的 pairwise 结论 | 中，可退回人工查重 |
| 验伪 + 成型 | 条款 delta + 验收 | 大，必须显式失败 |

每段输出 < 2KB，单段失败只重跑该段。

### 9.2 禁止伪造

模型未参与时：

- UI 必须显示「未澄清」
- 不得生成 `problem` / `acceptance`
- 不允许当作已澄清结果确认

`intent.mjs:882-911` 的关键词标题库（`selfHealingTitle` / `valueGrill` / `titleOverride`）必须删除——它们是「看起来对了」的幻觉。

### 9.3 失败入账

每次 5xx 级失败必须写一条失败事件，带 `runId / model / timing / inputHash / phase`，按 `dedupeKey` 去重累加 `occurrences`。这是「缺陷自动修复」的唯一入口。

### 9.4 自愈策略

| 缺陷类 | 判定 | 自愈动作 | 验证 |
|---|---|---|---|
| `first-token-timeout` | 无 `firstTokenMs`，`totalMs ≈ 预算` | 放宽首 token 预算 / 切备用模型 | 重跑同一会话，要求首 token 到达 |
| `output-timeout` | 有 `firstTokenMs`，`modelMs ≈ 预算` | 放宽输出预算 / 拆分提示 | 重跑，要求 run 成功 |
| `invalid-output` | `ai-invalid-output` | 收紧契约提示 + 一次修复重试 | 重跑，要求通过校验 |
| `no-model` / `config` | `no-model` / `401/403` | 不可自愈，生成修复单 | 人工处理 |

自愈**只改策略参数**（预算、模型链、提示拆分），不改源码。策略落 `.alm/self-heal/policy.json`，下一次分析直接生效。让 AI 改源码再重启插件风险过高，且无法验证；策略调参可验证、可回滚。

### 9.5 环境阻断：验收器不得把 EPERM 当代码失败

`alm verify` 是代理在 workspace-write 会话里的自查，而验收套件可能同时需要管道子进程与浏览器。过去两类失败都被压成「验收未通过，退出码 1」，于是下一轮代理去修一个并不存在的代码缺陷，甚至倾向于删用例换绿灯。现在的分层：

- **统一捕获**：git、node CLI、测试 fixture 都走 `runCaptured`（`packages/alm-core/src/process-capture.mjs`）。先试管道；`EPERM/EACCES` 时改用临时文件描述符，stdin/stdout/stderr 与退出码语义不变。
- **结果分类**：`classifyAcceptanceRun` 把「失败行全是 EPERM/EACCES」或「命令本身 spawnFailed」判为 `blocked`；只要出现一条真实断言失败，仍是 `fail`，不因同批有环境问题而转绿。
- **退出语义**：`status=blocked` 时 `alm verify` 退出 3 并打印「验收被运行环境阻断，不是断言失败」、受限命令与所需能力；`--profile full` 下环境阻断按失败退出 1。`blocked` 永远不等于通过。
- **能力去向**：纯逻辑与 git fixture 在沙箱内可跑完；Playwright 用例无法用文件描述符替代浏览器管道，明确留给宿主/CI，由宿主进程跑全量并铸验收证据。
- **工作区对账**：交付前必须把脏工作区采纳进变更并提交到变更分支，避免「任务说没有改动、磁盘上却已有一版实现」再次消耗一轮诊断。

## 10. 数据模型

| 位置 | 内容 | 状态 |
|---|---|---|
| `.alm/index/clauses.jsonl` | 条款指纹索引（clauseId / uid / 五元组 / 向量） | 新增 |
| `.alm/rejections/REJ-<fp>.json` | 否决账本（理由 / 替代 / 再提条件 / 决策人） | 新增 |
| `.alm/failures/RT-<fp>.json` | 运行时缺陷（`alm.failure.event/v1` + `occurrences`） | 新增 |
| `.alm/self-heal/policy.json` | 自愈策略（预算 / 模型链 / 变更历史） | 新增 |
| `session.review` | 判决快照（duplicates / falsity / verdict / evidence） | 新增字段 |
| `requirement.mergedFrom / extendedBy` | 合并与追加的双向引用 | 新增字段 |
| `clause.polarity` | 极性 | 新增字段 |

既有 `related[].match` 扩展一个取值 `rejected`，使否决记录能被三查命中。

## 11. 交互三屏

不再是一张长表单。

**屏 1 · 裁决屏**（查重结果）

```
你说的可能是这 3 条之一：

REQ-ALM-011  需求列表长标题自动提炼       覆盖 82%
  └ AC-04 标题不得被自动覆盖（正是你这条的反面）
REQ-ALM-015  需求列表待我处理页签           部分 31%

[ 就是 REQ-011，追加 ] [ 不是，是新的 ] [ 相关但独立 ] [ 拒绝 ]
```

拒绝与创建同级并列，一键可达，不藏在路由里。

**屏 2 · 验伪屏**（按型 2 问）

机器已代答的显示依据（「失败台账显示 17 次同类调用失败」），可改；「跳过」等于 `defer` 并写明缺什么。

**屏 3 · 判决屏**

```
判决：split（3 条）
理由：三个决策轴可独立验收
├─ 需求插件故障自动采集
├─ 失败自动分类与策略自愈
└─ 无法自愈时生成修复单
证据：失败台账 17 条 / 会话 INT-...612f10
[ 确认入库 ] [ 改为单条 ] [ 驳回 ]
```

## 12. 指标

| 指标 | 定义 | 目标 |
|---|---|---|
| 重复命中率 | 新建需求中后续被判覆盖的比例 | < 5% |
| 否决率 | `decline` / 全部判决 | 10%–25%（低于 10% 说明不敢拒） |
| **7 日返工率** | 确认后 7 天内被改或被撤的比例 | < 10% |
| 平均追问轮数 | 从输入到判决的轮次 | ≤ 2 |
| AI 参与率 | 有模型参与的会话占比 | > 95%（低于此说明仍在静默降级） |

返工率是唯一诚实的澄清质量指标。

## 13. 分期与完成判据

| 期 | 内容 | 完成判据 |
|---|---|---|
| 止血 | 显式失败 + 失败入账 + 自愈策略 + 多模型兜底 | 不再出现「回显草稿可确认」；失败 100% 入账 |
| 查准 | 条款指纹 + 三通道 + pairwise + 评测基线 | `precision@1 ≥ 0.8` |
| 判对 | 八判决 + 五闸 + 分型验伪 | 重复命中率 < 5%，返工率 < 10% |
| 自生长 | workaround 聚类 + `observed` 快通道 | 每季度 ≥ N 条需求由系统发现 |

**澄清完成的定义**：frontier 为空 + 判决成立且有证据 + 验收可执行。三者同时满足。少一个，就还是填表。

## 14. 与现有实现的映射

| 改造点 | 文件 | 动作 |
|---|---|---|
| 失败入账 | `intent.mjs` handleAnalyze catch | 新增 defect 采集（5xx 路径） |
| 自愈策略 | `intent.mjs` runAnalysis 预算 | 从 policy 读预算，替代硬编码 15s/90s |
| 中文匹配 | `requirements/matcher.mjs` | 改 bigram/trigram，与 `context.mjs` 统一 |
| 查重闸 | `intent/readiness.mjs` | 新增 `duplicate-unadjudicated` |
| 缺答降级 | `intent/readiness.mjs` | 新增 `missing-value-check` → 转 defer |
| 粒度闸 | `intent/readiness.mjs` | 新增 `needs-split` |
| 拒绝记忆 | `intent/confirm.mjs` | `decline` 落 `REJ-*` 并进 readSet |
| 删幻觉兜底 | `intent.mjs:861-951` | 移除关键词标题库与伪草稿 |
| 拆调用 | `intent/messages.mjs` | 拆三段 builder |

## 15. 附录：条款指纹判定示例

| 用户表述 | 最相近条款 | 词法相似度 | 结论 | 依据 |
|---|---|---|---|---|
| AI 提炼完别把我改的标题改回去 | AC-04 | ≈ 0 | `covered` | `object/action/polarity` 完全对齐 |
| 支持导出 CSV | AC-07 | 0.9 | `unrelated` | `polarity` 相同但 `action` 不同（导出 vs 导入） |
| 标题不要太长 | AC-02 | 0.5 | `overlap` | AC-02 只覆盖列表页截断，未覆盖创建时提炼 |

## 16. 实施状态：第一期「止血」已落地

对应需求 `REQ-ALM-014`，覆盖 AC-01 / AC-02 / AC-06。

| 交付 | 位置 | 说明 |
|---|---|---|
| 缺陷采集 | `packages/dsh-plugin-requirements/self-heal.mjs` | `captureIntentFailure` 把每次 5xx 澄清失败写成 `alm.failure.event/v1`，带 runId / model / timing / 输入摘要，按 `run + stage + step + fingerprint` 去重 |
| 分类 | 同上 `classifyRuntimeFailure` | 依据运行记录里**实测**的 `firstTokenMs` / `modelMs` 判定相位；上游故障保持 `external`，本机预算过紧记为 `plugin-defect` |
| 自愈 | 同上 `writeHealPolicy` / `planHeal` | 只改 `.alm/self-heal/policy.json`（含 revision、history、变更理由），不改源码 |
| 验证 | 同上 `verifyHeal` | 用历史运行记录回放「新预算是否还会在同一个点中断」，并报告实测 p95 与余量 |
| 接线 | `intent.mjs` `runAnalysis` / `handleAnalyze` | 预算改读 policy；502/503 路径调用 `captureIntentFailureSafe`，绝不打断主请求 |
| 控制台 | `bin/heal.mjs` | `status / capture / heal / verify / run / reset-policy` |

首轮实测（20 个会话）：采集 19 次超时失败 → 17 条可自愈 → 策略 15000/90000 → **31694/155051ms** → 回放 19/19 不再在相同耗时被中断，p95 11.1s，余量 2.85×。剩余 5 条不可自愈（3 条 `invalid-output` 需改提示契约，2 条 `transport-failure` 需人工），闭环按预期 fail-closed。

未落地（第二、三期）：AC-03 禁止伪造草稿（需同步改 `localIntentDraft` 与 client）、AC-04 八判决、AC-05 否决账本、条款指纹与三通道查重。

## 17. 实施状态：第二期「判对」已落地（可在插件内验证）

第二期完成 AC-03 / AC-04 / AC-05 与条款级查重。所有判定都可复核：每条结论都带条款号、理由与差异点。

| 交付 | 位置 | 说明 |
|---|---|---|
| 条款指纹 | `alm-core/src/intent/review.mjs` | 五元组 `对象·动作·条件·极性·范围`；极性按谓词窗口判定，避免「要自动记录，不要手工复制」被判成否定 |
| 三通道召回 | 同上 `recallClauses` | 词法（CJK 2/3-gram）+ 结构（指纹字段对齐）+ 领域关键词；语义通道无 embedder 时显式返回 `unavailable`，不假装有分数 |
| 成对判定 | 同上 `adjudicateClause` | 输出 covered / partial / conflict / unrelated + 理由 + diff；极性相反且同一动作才判 conflict，动作不同一律 unrelated（导出 ≠ 导入） |
| 条款索引 | `context.mjs` | readSet 每条带 `clauseMatches[]`：命中哪条 AC、什么判定、为什么；关键词命中不再能单独升级为 covered |
| 否决账本 | `review.mjs` + `confirm.mjs` | 拒绝与回执同一事务写入 `.alm/rejections/REJ-*.json`（含理由、替代方案、再提条件、occurrences），并进入下一次查重 |
| 八判决 | `errors.mjs` / `readiness.mjs` / `confirm.mjs` | create·extend·change·merge·split·defer·decline·answer（+ reuse / investigate）；每个判决都有机器可校验的前置条件 |
| 查重闸 | `readiness.mjs` | 命中 covered/conflict 且未裁决时 `duplicate-unadjudicated` 阻断新建；裁决为「确实是新的」后放行并留档 |
| 禁止伪造 | `intent.mjs` `suggestedLocalDraft` | 删除关键词标题库（`selfHealingTitle` / `valueGrill` / `distilledTitle`）；无模型时 title/problem/acceptance 一律为空，`ai: 'none'`，状态 `needs_input` |
| UI | `client-source.js` | 10 个判决按钮、查重裁决屏（就是这条/确实是新的）、按判决展开的必填输入、否决账本提示、未澄清横幅 |

### 在插件里怎么验证

1. **未澄清不再可确认**：断开模型（或用不可用 provider）后提交原话 → 顶部出现「这次澄清没有模型参与」，候选为空，「确认」不可用；手工填标题与一条验收后即可确认（人工路径保留）。
2. **查重闸**：输入一条与 `REQ-ALM-014 AC-02` 同义的诉求（如「插件跑挂了要能自动修好」）→ 出现「查重结论：这条诉求可能已经存在」，列出条款号与判定；直接确认会被 `duplicate-unadjudicated` 拦下；点「确实是新的」后放行。
3. **拒绝有记忆**：选「拒绝并记账」，填理由/替代方案/再提条件 → 确认后 `.alm/rejections/` 出现 REJ 条目；再次提交同类诉求，分析上下文里会带出该条目。
4. **暂缓必须到期**：选「暂缓观察」但不填触发条件 → 确认被 `missing-defer-trigger` 拦下；填条件后确认生成 `.alm/intent/observations/OBS-*.json`，需求库不新增。
5. **拆分只拆账**：选「拆成多条」，每行「标题 | 验收」→ 少于两个可独立验收的部分会被拦；确认后只落拆分计划 `SPL-*.json`，不直接写需求。

### 一个实现上的坑：简版复核界面会吞掉判决

插件原本有一个「简版复核」分支（`simpleReview()`：单条目 + create + 无阻塞未知 + 有 simpleDraft），它只渲染标题/优先级/草稿，没有去向、没有裁决、没有账本。也就是说：**判决体系做好了，但在最常见的路径上根本看不见。**

处理：
- `simpleReview()` 增加「无重复命中」条件——命中 covered/conflict 时必须走完整判决界面；
- 简版界面补上否决账本提示，以及查重裁决：「不是新建？改判为追加 / 修订 / 合并 / 拆分 / 暂缓 / 拒绝…」入口，点任意一条即切到完整界面。

教训：**新能力必须接到用户实际会经过的那条路径上**，否则等于没做。UI 断言因此放在浏览器里跑（`test/intent-adjudication-ui.test.mjs`），而不是只断言 server 返回值。

### 与第一期的关系

第一期的失败账本让「模型没参与」这件事可被看见；第二期让「看见了之后怎么判」有章可循。两期共同的判据没有变：**没有判决就不许写正文，没有证据就不许说 covered。**



## 18. 第三期：首屏可用性缺陷与端到端验证（2026-11-17）

### 18.1 白底白字：主按钮在宿主主题下消失

截图里的两处「空白按钮」（输入页的「分析意图」、复核页的「保存并检查，进入最终确认」、需求详情页的「开始 AI 推进」）是同一个原因：

| 事实 | 值 |
|---|---|
| 宿主 `--dsw-alias-brand-primary` | 在本主题下解析为近白（选中的 tab 下划线就是白色） |
| 旧主按钮 | `background: T.brand` + `color: '#fff'` |
| 旧 `.btn-primary`（详情页） | `background: ${T.text}` + `color: #fff` |
| 结果 | 白底白字，对比度 ≈ 1.0，按钮看起来是「一个白色胶囊」 |

修法不是换一个 token，而是**主按钮使用反色配对**：底色用 label 色、文字用 base 色（`background: T.text, color: T.base`）。明暗两种主题下都成立，而且它天然是页面上最亮的一个对象——这正是主按钮该有的分量。三处一起改：`primary`（意图弹窗）、`.btn-primary`（详情页 band）、归档批量按钮（同为 brand 填充 + 白字）。

**为什么之前的测试没抓到**：测试环境没有宿主样式表，`var(--dsw-alias-brand-primary, #4d6bfe)` 回退成蓝色，白字读得清。所以新增 `test/intent-primary-contrast.test.mjs`：注入宿主的真实 token（brand=近白），渲染组件，**按 WCAG 公式算对比度并要求 ≥ 4.5**，而不是断言某个颜色字符串。

### 18.2 同一屏上的自相矛盾：查重结论说有，相关承诺说没有

截图 1 上方写着「REQ-ALM-014 已覆盖」，下方「相关承诺」却是「0 条候选 / 没有匹配到相关承诺」。原因是两块数据源不同：查重卡片读机器 `readSet`，相关承诺只读模型的 `item.related`——模型缺席时它必然是空的。

处理：`relatedOf(item)` 合并两源（模型声明在前，机器命中补在后，按 uid 去重），机器条目带「机器判定」标；文案不再出现「没有匹配到相关承诺」而上方正列着命中。

### 18.3 其余三处「看起来对、其实在编」的文案

| 位置 | 问题 | 处理 |
|---|---|---|
| 去向摘要 | `session.manual` 才叫「当前去向」，模型没参与时仍写「AI 建议去向：新建需求」 | `ai === 'none'` → 「默认去向（未经 AI 判断）」 |
| 我的理解 | 无候选时写「我的理解：（见下方候选）」 | 无候选 → 「（还没有理解：这次没有生成问题与方案）」 |
| 命中理由 | 直接把分词结果给用户看：`dsh、需求、插件、需求插、求插件` | 改为最长公共短语（非重叠、去被包含），输出「标题与你的说法共用「需求插件」」 |
| 否定提示 | 只要句中含「不需要/不用」就提示「需确认是替换还是新需求」，本句「而不是需要我复制粘贴报错」被误伤，且每条候选都带一遍 | 删除该提示：极性已由条款判定负责 |

### 18.4 端到端验证（真实仓库数据，非模拟）

输入即截图里的原话，模型调用固定失败（模拟宿主当前无可用模型）：

```
① 分析后闸门
   duplicate-unadjudicated, missing-title, needs-acceptance, missing-priority, not-confirmed
   候选为空、docDraft 为空、ai=none、state=needs_input
② 点「确实是新的」后
   missing-title, needs-acceptance, missing-priority, not-confirmed
   → 只解除查重闸，不替你补标题和验收
③ 人工补标题 + 一条验收后
   not-confirmed（剩下的就是“人确认”这一步本身）
```

查重证据（条款级，`buildIntentContext` 实跑）：

```
REQ-ALM-014 covered  AC-02 动作相同（修复），对象重合 100%
                     AC-06 动作相同（修复），但对象只部分重合（33%）→ partial
REQ-ALM-007 related  SEC-3 partial（50%） SEC-11 partial（33%）
标题/简报命中：与你的说法共用「需求插件」「遇到缺陷」「复制粘贴报错」
```

结论与方案预期一致：**covered 只在条款证据下出现；命中不改写正文；缺标题/缺验收不许确认；`not-confirmed` 必须由人点。**

### 18.5 测试

- 新增 `test/intent-primary-contrast.test.mjs`（3 项：输入页/复核页对比度 ≥ 4.5、主按钮不许再出现 brand+白字配对）
- `test/intent-adjudication-ui.test.mjs` 增 1 项：机器命中必须出现在「相关承诺」
- alm-core 557 单元 + 42 集成全过；插件 860 项 857 过，3 项失败均为环境问题（`exchange-*` 需从仓库根跑，`intent-history-http` 并发抖动，单跑通过）
