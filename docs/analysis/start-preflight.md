# 开始开发 = AI 自动门禁（preflight）

## 0. 用户问题（m01094）

用户在需求详情里看到「运行门禁检查」单独一步：点开后是整仓 `alm ci run` 的结果（fail / unchanged），失败后「开始开发」按钮仍是禁用，需要自己判断下一步该做什么。

用户的要求：

> 不要让我点击检查，而是融入开发过程。我触发开始开发后，系统自动先检查；检查失败，若是需求本身问题或可以直接解决的，就直接解决，不要反馈过程，我只要结果；AI 执行并记录过程，可以反馈问题，发现后要给我解决；只有不确定的才让我决策。

## 1. 产品判断：拆开“开始开发门禁”和“发布门禁”

两件事被混在一起了：

| 问题 | 回答 |
| --- | --- |
| 开始开发需要什么？ | 评审已保存、验收命令已登记（可复核的证据入口） |
| 验收失败能不能锁住开始？ | 不能。失败正是开发要修的东西，应作为任务带入 |
| 谁来点检查？ | 没有人。`开始开发` 本身就是检查的触发器 |

因此：

- 「运行门禁检查」按钮与弹窗删除；
- `开始开发` 永远可点（归档需求除外）；
- 点下去先跑 preflight，能自动修的全部修完，再登记变更；
- 验收失败 / 证据过期 → 作为 carry-over（带入开发）项，不再锁按钮；
- 只有评审阻塞、需求数据歧义、无可用验收命令等真正不确定的情况，才把问题交给用户。

## 2. 自动修复顺序（deterministic first）

`packages/dsh-plugin-requirements/preflight.mjs` 的 `runPreflight`：

1. **评审**：没有保存的评审 → 自动运行并保存；
2. **AI 评审**：判定卡在 `review-not-accepted` / `coverage-incomplete` / `review-not-run` → 读取已生成的 AI 评审，没有则生成，然后采纳建议并重新评审（adoption 即评审结论，不再要求人工签收五个视角）；
3. **验收命令**：未登记 → 从仓库 `package.json` 的 `test` / `ci` / `verify` 脚本 + 锁文件推导 `pnpm test` / `npm test` 并登记（命令仍走 alm-core 白名单，不发明命令）；推导不出 → 交给用户；
4. **验收执行**：缺证据或证据过期才执行；上次已失败则不重跑（重复跑同一套失败测试又慢又吵），直接记为 carry-over；新执行失败同样记 carry-over；
5. **复核**：用 `startReadiness` 重新判断；仍未就绪则生成 `question`（`proceed` 带着问题开始 / `cancel` 先不开始）。

整个过程写入 `.alm/preflight/<REQ>/<timestamp>.json`（schema `alm.preflight/v1`），包含每一步的时间、状态（`fixed` / `checked` / `carry-over` / `needs-decision` / `failed`）、说明、结论与问题。

## 3. 接口与实现位置

- 插件新增 `POST /api/alm/requirements/preflight`，body `{ requirementId, apply }`，返回 `{ schema, requirementId, steps, decision, readiness, carryOver, question, auditPath }`；
- `packages/dsh-plugin-requirements/index.js`
  - `preflightDeps(root, id)`：把评审、AI 评审、验收登记与执行的副作用注入编排层；
  - `adoptStoredAiReview(...)`：从手写 ai-review 分支抽出，供 preflight 复用；
  - `handlePreflight(...)`：执行编排并落审计；
  - `start`（apply=true）门禁改为 `startReadiness`：只要求评审 + 验收命令已登记；`acknowledgeGaps:true` 支持“带着问题开始开发”，缺口留在审计里。
- `packages/dsh-plugin-requirements/client.js`
  - 删除 `AcceptModal`、`acceptItem` 状态、「运行门禁检查」按钮；
  - `开始开发` 始终可点，打开新的 `PreflightModal`；
  - `PreflightModal`：挂载即执行 preflight（`apply:true`）；完成后展示逐步骤状态、carry-over、`question` 选项；无问题时自动调用 `start`（apply:true）并展示变更 / 任务卡 / worktree 与审计路径；
  - `primaryActionFor` 不再给“运行门禁检查 / 查看并处理阻塞 / 运行验收”等手动门禁入口，非绿需求统一给“开始开发（AI 先处理）”。

> 本次 PR 只包含后端与编排层；`client.js` 正被同一工作树的并行改动重构（详情页 `renderRich` 等），客户端接入放在紧随其后的 UI PR，避免把无关改动带进本 PR。

## 4. 验证

| 项 | 结果 |
| --- | --- |
| `node --test --test-isolation=none packages/dsh-plugin-requirements/test/preflight.test.mjs` | 8/8（推导命令、readiness 各 code、自动登记+验收失败 carry-over、已失败不重跑、阻塞才提问、404、审计落盘） |
| 全量测试 | 见提交时记录 |
| 浏览器探针 `tmp/ui-harness/ui-preflight.mjs`（Playwright + 真实 client.js + 真实宿主 API，preflight/start 用真实 payload 拦截） | 16/16：无「运行门禁检查」、失败证据下开始可点、自动处理步骤、carry-over、审计路径、只有阻塞才提问、取消可关闭 |
| 截图 | `tmp/ui-shots/preflight-01-ready.png`、`preflight-02-question.png` |

## 5. 已知限制

- `packages/alm-core` 与插件后端改动需重启 Harness 宿主才生效（ESM 模块缓存）；仅刷新页面只会更新客户端 UI；
- AI 评审的自动生成依赖宿主模型；模型不可用时该步记 `failed`，不会伪造评审；
- 验收执行仍受命令白名单与 10 分钟超时限制；上一次失败的验收不会在每次开始时重跑，需在开发完成后再验证；
- `preflight` 支持 `apply:false` 预览：该模式只读，不会运行评审、采纳 AI 建议、登记命令或执行验收，步骤会标为 `skipped`；
- “带着问题开始开发”会在变更记录与审计里标记缺口，不会把未解决项当作已解决。

## 6. 状态

后端与编排层随本 PR 提交；`client.js` 的接入（`PreflightModal`、按钮移除）随后续 UI PR 提交（同一工作树的详情页重构尚未提交，混入会污染本 PR）。
