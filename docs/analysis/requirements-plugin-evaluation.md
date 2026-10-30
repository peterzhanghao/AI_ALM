# 需求管理插件选型评估（DSH 生态 + 通用开源）

- 日期：2026-10-30
- 范围：SpecFlow（`dsh-plugin-specflow@0.1.1`）、TeamFlow（`dsh-plugin-teamflow@0.3.2`）、DSH 插件目录、通用开源（StrictDoc / OpenSpec / Spec Kit / Doorstop 等）
- 环境：DSH 0.2.1-rc.5（`npx @deepseek-ai/dsh`）、Node 26.7.0、Windows 11；隔离 profile `eval`、`eval-hl`
- 关联：[ADR 0004](../adr/0004-requirements-workbench-composition.md)、[任务拆解](../planning/task-breakdown.md)

## 1. 方法

1. 查 DSH 插件目录（`dsh-plugin-catalog`，3917 条）与 `dshmarket`；配置的索引 `omdsh-dev/DSH-better-sidebar` 无效（`$.format must be 1`）。
2. 两个候选插件安装到**隔离 profile**（`eval` 从 web 模板复制），不触碰 desktop profile。
3. TeamFlow：真实启动并调用 `teamflow_triage`，记录工具返回、耗时与 token；用 Playwright 截图工作台。
4. SpecFlow：安装被宿主兼容门禁拒绝（`engines.dsh = 0.2.1-rc.2`，宿主 rc.5），改读发布包 README、`package.json`、`cordis.patch.yml` 与插件文档。
5. 结论只基于上述证据；未跑通的部分明确标注“未实测”。

## 2. 证据

### 2.1 TeamFlow（已实测）

```text
$ dsh plugin --profile eval add dsh-plugin-teamflow      → + dsh-plugin-teamflow ^0.3.2
$ dsh --profile eval --port 0 --no-open
[teamflow] host 就绪：backlog 根 C:\Users\22878\.dsh\teamflow，Remote 26 个，工具 12 个
```

工具集（12 个）：`teamflow_triage`、`teamflow_start`、`teamflow_backlog`、`teamflow_status`、
`teamflow_assign`、`teamflow_claim`、`teamflow_merge`、`teamflow_update`、`teamflow_cancel`、
`teamflow_pause`、`teamflow_resume`、`teamflow_resume_session`。

对 `REQ-PAY-001` 语义的需求真实分诊（19 秒 / 32.6K tok，模型返回）：

```json
{
  "suggestedMode": "full",
  "kind": "feature",
  "needDesign": false,
  "complexity": "large",
  "confidence": "high",
  "rationale": [
    "用户可见的业务功能变更……排除 tech；牵连订单状态机、退款流水、可退余额计算……排除 patch/lite",
    "幂等键引入跨切面持久化机制……命中 M1 架构判据，至少 medium；跨模块 + 资金正确性风险 → full",
    "需求只提到接口与金额约束，没有 UI 需求，needDesign=false",
    "资金类逻辑必须覆盖并发、超退、重复提交和事务边界，轻量档位撑不住"
  ],
  "allModes": ["full", "medium", "lite", "tech", "patch"]
}
```

- 数据位置：`$DSH_HOME/teamflow/<workspace-slug>/{backlog,logs}`，`docs/teamflow/` 存任务夹；**需求与运行记录不落 Git**。
- UI：左侧「团队工作台」全局面板（产品线 / run / backlog）；空态明确写出“跑过一次流水线后会出现产品线（`$DSH_HOME/teamflow/<key>`）”。
- 防假交付（README + 源码）：阶段必须给出「命令 + 退出码 + 断言数」，验收只认显式结论行；QA 独立探针；超限转人工。
- 未实测：完整 `full` 流水线（成本与时长不可控），因此“并行开发/QA 打回”只按源码与文档评估。

### 2.2 SpecFlow（安装被拒，源码/文档评估）

```text
$ dsh plugin --profile eval add dsh-plugin-specflow@0.1.1
dsh: installation rejected: … incompatible with dsh 0.2.1-rc.5:
requirements {"engines.dsh":"0.2.1-rc.2"} … nothing was installed.
```

- 许可证 Apache-2.0；npm 包存在（`dsh-plugin-specflow@0.1.1`），但 README 仍写“尚未发布到 npm”。
- 数据：`$DSH_HOME/specflow` 下 SQLite 工程库 + 独立 Git worktree + 执行日志；需求/文档修订存库，**不在源仓库**。
- 流程：默认 13 步，含规格澄清、设计、任务、实现、两轮独立复核、验证、人工验收；文档/代码修订会使旧证据**过期**。
- 证据：执行项目配置的验证命令并记录输出、退出码与被测代码版本；模型不能调用 Shell，验证由确定性阶段执行。
- 工具：只读 `specflow_query`；人工接纳只在面板操作。
- 未实测：因版本门禁无法安装，UI 与执行链路未在本机跑通。

### 2.3 通用开源

| 项目 | 许可证 | 与本项目关系 |
|---|---|---|
| StrictDoc | Apache-2.0 | `.sdoc` 子集的母体；可借渲染 / ReqIF / traceability |
| Doorstop | LICENSE.md 为准（GitHub NOASSERTION） | YAML 条目 + links + reviewed 语义 |
| OpenSpec | MIT | `changes/<id>/{proposal,design,tasks}.md` + `specs/`，与 ChangeSet 同构 |
| Spec Kit | MIT | `/specify → /plan → /tasks` 模板 |
| Vibe Kanban | Apache-2.0 | 已宣布 sunsetting，不作底座 |
| OpenProject / TestLink | GPL-3.0 / GPL-2.0 | 只宜 API/MCP 集成，不链接代码 |

## 3. 六维评分（1–5）

| 维度 | ALM（现状） | TeamFlow | SpecFlow |
|---|---|---|---|
| 需求落 Git 且可 review | **5**（`.sdoc` + diff + 审批 SHA） | 2（PRD 在 `docs/teamflow/`，需求本体在 backlog/聊天） | 3（需求/文档修订在 SQLite，非仓库资产） |
| 生成可执行验收/任务 | 2（只有门禁，无任务生成） | **5**（PRD→任务→并行开发→QA） | 4（规格→任务→实现，人工推进） |
| 证据可复核 | 4（确定性门禁 + evidence JSON） | 4（命令+退出码+断言数；未实测全链路） | **5**（验证命令+退出码+代码版本+过期失效） |
| 人工验收/拒绝 | 3（审批绑 SHA，UI 弱） | 4（人工介入中心/结论行） | **5**（显式接纳门禁） |
| 可被现有门禁消费 | **5**（同一 core） | 2（无 sdoc/JSON 导出） | 2（SQLite，无导出） |
| 二次开发/运维成本 | **5**（自有） | 4（MIT、TS、descriptors） | 3（Apache-2.0，但精确锁 rc.2，代码量大） |

## 4. 结论

1. **没有“装上就替代 ALM”的插件**：两个候选都把需求放在 `$DSH_HOME`，天然无法支撑“需求进仓库、门禁、审批绑 SHA、基线发布”。
2. **TeamFlow 的“需求分诊 + 分档流水线 + 防假交付”是最值得借的执行层**，且在本机真实可用。
3. **SpecFlow 的“修订过期 + 双视角复核 + 显式接纳”是最值得借的治理模型**，但当前版本锁死 DSH rc.2，直接采用有兼容风险。
4. 因此选择**组合式**：ALM 保留需求资产/门禁/基线；OpenSpec 约定承载 change；TeamFlow 式证据口径与分档；任务看板外部化。

## 5. 复现

```bat
:: 隔离 profile（不污染 desktop）
npx @deepseek-ai/dsh@0.2.1-rc.5 --profile eval --from-default-profile web --dump-config
npx @deepseek-ai/dsh@0.2.1-rc.5 plugin --profile eval add dsh-plugin-teamflow
npx @deepseek-ai/dsh@0.2.1-rc.5 --profile eval --port 0 --no-open
:: 在打开的 Web UI 中新建会话，发送：
:: “只调用 teamflow_triage 对需求分诊，不要启动流水线：支持订单部分退款，退款金额不得超过可退余额，接口需要幂等键。”
```

SpecFlow 复现会得到兼容性拒绝：

```text
npx @deepseek-ai/dsh@0.2.1-rc.5 plugin --profile eval add dsh-plugin-specflow@0.1.1
→ installation rejected: engines.dsh = 0.2.1-rc.2
```

## 6. 局限

- TeamFlow 只实测了分诊与工作台，未跑完整流水线、未验证 QA 打回与断点续跑。
- SpecFlow 完全未运行，评分基于发布包与官方文档。
- 结论对 DSH 0.2.1-rc.5 有效；宿主升级后需复核。
