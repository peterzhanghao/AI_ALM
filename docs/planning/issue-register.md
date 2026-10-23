# 问题台账

> 规划键与 GitHub 编号的唯一映射表，也是发布门禁与同步状态的快照。远端写入后必须回读并在此登记。

## 状态说明

| 字段 | 取值 |
|---|---|
| `确认结论` | `待确认` / `需修改` / `暂缓` / `不发布` / `确认发布` |
| `同步状态` | `local-newer` / `remote-newer` / `in-sync` / `conflict` |
| `状态` | `backlog` / `blocked` / `ready` / `in-progress` / `review` / `done` / `deferred` |

只有 `确认结论=确认发布` 的行才允许在 GitHub 创建或更新工作项。`conflict` 必须先人工合并，禁止直接覆盖。

## 批次

| 批次 | 规划键 | 目标 | 出口 |
|---|---|---|---|
| 批次 1（P0） | ALM-01.01–01.03、ALM-02.01–02.03、ALM-05.03 | 工程骨架、宿主验证、`alm check` 切片、样例资产、门禁 R1、开发技能 | 样例仓库上正例通过 + 5 类负例失败；插件安装记录 |
| 批次 2（P0） | ALM-02.05、ALM-03.01、ALM-05.01 | 证据/基线契约、core 服务与工具、变更工作流技能 | 工具可调用；证据可复跑；技能可加载 |
| 批次 3（P1） | ALM-02.04、ALM-03.02–03.04、ALM-05.02 | 差异/影响、双插件、联合变更 | 验收 1–3；两插件同一 ChangeSet |
| 批次 4（P1） | ALM-04.01–04.06、ALM-05.04–05.05 | SCM/CI、审批失效、基线、故障恢复、按需 UI CI、Gitea、技能校验与发布技能 | 验收 4–7 |
| 批次 5（P2） | ALM-06.01–06.02 | 试点演练与文档 | 验收 8 + 验证报告 |

## 台账

| 规划键 | 标题 | 类型 | Owner | 优先级 | 领域 | 状态 | 前置 | 确认结论 | GitHub # | PR | 同步状态 | 最后回读 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ALM-00 | 总控：AI Native ALM MVP | tracking | @peterzhanghao | P0 | core | done | 无 | 确认发布 | #1 | — | in-sync | 2026-10-23 22:20 |
| ALM-01 | 跟踪：宿主与工程基线 | tracking | @peterzhanghao | P0 | core | done | ALM-00 | 确认发布 | #2 | — | in-sync | 2026-10-23 21:45 |
| ALM-01.01 | 工程骨架、命令面与 CI | task | @peterzhanghao | P0 | core | done | 无 | 确认发布 | #3 | #12 | in-sync | 2026-10-23 15:20 |
| ALM-01.02 | DSH 44.7.0 插件能力验证 | task | @peterzhanghao | P0 | core | done | ALM-01.01（#3，已关闭） | 确认发布 | #4 | #13 | in-sync | 2026-10-23 16:07 |
| ALM-01.03 | `alm index` 与 `alm check` 最小回路 | task | @peterzhanghao | P0 | core | done | ALM-01.01（#3，已关闭） | 确认发布 | #5 | #15 | in-sync | 2026-10-23 16:32 |
| ALM-02 | 跟踪：资产契约与确定性门禁 | tracking | @peterzhanghao | P0 | core | done | ALM-00 | 确认发布 | #6 | — | in-sync | 2026-10-23 21:45 |
| ALM-02.01 | 资产模型与解析器 | task | @peterzhanghao | P0 | core | done | ALM-01.01（#3，已关闭） | 确认发布 | #7 | #16 | in-sync | 2026-10-23 16:54 |
| ALM-02.02 | 部分退款样例资产与负例夹具 | task | @peterzhanghao | P0 | core | done | ALM-02.01（#7，已关闭） | 确认发布 | #8 | #17 | in-sync | 2026-10-23 17:02 |
| ALM-02.03 | 硬门禁规则集 R1 | task | @peterzhanghao | P0 | core | done | ALM-02.02（#8，已关闭）、ALM-01.03（#5，已关闭） | 确认发布 | #9 | #18 | in-sync | 2026-10-23 17:22 |
| ALM-02.04 | 语义差异与影响闭包 | task | @peterzhanghao | P1 | core | done | ALM-02.03（#9，已关闭） | 确认发布 | #24 | #25 | in-sync | 2026-10-23 19:20 |
| ALM-02.05 | 证据模型与基线清单 | task | @peterzhanghao | P0 | core | done | ALM-02.03（#9，已关闭） | 确认发布 | #19 | #20 | in-sync | 2026-10-23 18:50 |
| ALM-03 | 跟踪：共享核心服务与双插件 | tracking | @peterzhanghao | P0 | plugin | done | ALM-00 | 确认发布 | #21 | — | in-sync | 2026-10-23 21:45 |
| ALM-03.01 | core 服务契约与 Agent 工具 | task | @peterzhanghao | P0 | plugin | done | ALM-01.02（#4，已关闭）、ALM-02.01（#7，已关闭） | 确认发布 | #22 | #23 | in-sync | 2026-10-23 19:05 |
| ALM-03.02 | 需求插件（页面 + 工具） | task | @peterzhanghao | P1 | plugin | done | ALM-03.01（#22，已关闭）、ALM-02.04（#24，已关闭） | 确认发布 | #26 | #27 | in-sync | 2026-10-23 19:35 |
| ALM-03.03 | 架构插件（页面 + 工具） | task | @peterzhanghao | P1 | plugin | done | ALM-03.01（#22，已关闭）、ALM-02.04（#24，已关闭） | 确认发布 | #28 | #29 | in-sync | 2026-10-23 19:50 |
| ALM-03.04 | 跨插件联合变更与写权限边界 | task | @peterzhanghao | P1 | plugin | done | ALM-03.02（#26，已关闭）、ALM-03.03（#28，已关闭） | 确认发布 | #30 | #31 | in-sync | 2026-10-23 20:20 |
| ALM-03.05 | 插件页面无法从浏览器直接打开（GUI 401） | bug | @peterzhanghao | P0 | plugin | done | ALM-03.02、ALM-03.03 | 确认发布 | #43 | #44 | in-sync | 2026-10-23 20:40 |
| ALM-03.06 | 插件重载后路由残留导致无法激活 | bug | @peterzhanghao | P1 | plugin | done | ALM-03.05 | 确认发布 | #46 | #44 | in-sync | 2026-10-23 20:50 |
| ALM-04 | 跟踪：评审、集成与发布 | tracking | @peterzhanghao | P1 | release | done | ALM-00 | 确认发布 | #34 | — | in-sync | 2026-10-23 21:45 |
| ALM-04.01 | SCM 适配器与审批绑定 SHA | task | @peterzhanghao | P1 | release | done | ALM-02.03（#9，已关闭）、ALM-03.01（#22，已关闭） | 确认发布 | #35 | #36 | in-sync | 2026-10-23 21:30 |
| ALM-04.02 | CI 必需检查与幂等证据 | task | @peterzhanghao | P1 | release | done | ALM-04.01（#35，已关闭）、ALM-02.05（#19，已关闭） | 确认发布 | #37 | #38 | in-sync | 2026-10-23 21:50 |
| ALM-04.03 | 不可变基线与重建校验 | task | @peterzhanghao | P1 | release | done | ALM-04.02（#37，已关闭） | 确认发布 | #39 | #40 | in-sync | 2026-10-23 22:10 |
| ALM-04.04 | 故障、重试与恢复演练 | task | @peterzhanghao | P1 | release | done | ALM-04.03（#39，已关闭） | 确认发布 | #41 | #42 | in-sync | 2026-10-23 22:35 |
| ALM-04.05 | UI 验证的按需 CI 任务 | task | @peterzhanghao | P1 | release | ready | ALM-04.04（#41，已关闭）、ALM-06.01（#58，已关闭） | 确认发布 | — | — | local-newer | — |
| ALM-04.06 | Gitea SCM 适配器 | task | @peterzhanghao | P1 | release | ready | ALM-04.01（#35，已关闭） | 确认发布 | — | — | local-newer | — |
| ALM-05 | 跟踪：AI 技能与 Agent 契约 | tracking | @peterzhanghao | P0 | skills | done | ALM-00 | 确认发布 | #10 | — | in-sync | 2026-10-23 21:45 |
| ALM-05.01 | 产品技能：变更工作流 | task | @peterzhanghao | P0 | skills | done | ALM-03.04（#30，已关闭） | 确认发布 | #32 | #33 | in-sync | 2026-10-23 20:45 |
| ALM-05.02 | 产品技能：需求与架构 | task | @peterzhanghao | P1 | skills | done | ALM-03.02（#26，已关闭）、ALM-03.03（#28，已关闭） | 确认发布 | #50 | #53 | in-sync | 2026-10-23 21:48 |
| ALM-05.03 | 开发技能：alm-mvp-dev | task | @peterzhanghao | P0 | skills | done | ALM-01.01（#3，已关闭） | 确认发布 | #11 | #14 | in-sync | 2026-10-23 16:07 |
| ALM-05.04 | 技能一致性与权限校验 | task | @peterzhanghao | P1 | skills | done | ALM-05.01（#32，已关闭）、ALM-05.02（#50，已关闭）、ALM-05.03（#11，已关闭） | 确认发布 | #51 | #54 | in-sync | 2026-10-23 21:35 |
| ALM-05.05 | 产品技能：发布校验 | task | @peterzhanghao | P1 | skills | done | ALM-04.04（#41，已关闭） | 确认发布 | #52 | #55 | in-sync | 2026-10-23 21:45 |
| ALM-06 | 跟踪：试点评估与文档 | tracking | @peterzhanghao | P2 | pilot | done | ALM-00 | 确认发布 | #57 | — | in-sync | 2026-10-23 22:20 |
| ALM-06.01 | 三次变更演练与指标 | task | @peterzhanghao | P2 | pilot | done | ALM-04.04（#41，已关闭） | 确认发布 | #58 | #61 | in-sync | 2026-10-23 22:20 |
| ALM-06.02 | 架构/运行/权限/恢复文档与验证报告 | task | @peterzhanghao | P2 | pilot | done | ALM-06.01（#58，已关闭） | 确认发布 | #59 | #62 | in-sync | 2026-10-23 22:20 |

> 批次 1 的 11 个工作项已创建并回读：`#1`–`#11`。父项、blocked-by、标签、状态与本文档一致。
> ALM-01.01 已合并：PR `#12` → merge commit `2642153`。
> ALM-01.02 已合并：PR `#13` → merge commit `c117170`；ALM-05.03 已合并：PR `#14` → merge commit `7fcffe2`。`#4`、`#11` 已关闭并置 `status::done`。
> **批次 1 已完成**（01.01/01.02/01.03/02.01/02.02/02.03/05.03）。
> 批次 2 进展：ALM-02.05、ALM-03.01、ALM-02.04、ALM-05.01 已完成。
> 批次 3 已完成（03.01–03.04）；批次 4 已完成（04.01–04.04）。MVP 本地端到端闭环可运行。
> ALM-02.02 已合并：PR `#17` → merge commit `f889d2e`，Issue `#8` 已关闭并置 `status::done`。
> ALM-02.01 已合并：PR `#16` → merge commit `60c9d83`，Issue `#7` 已关闭并置 `status::done`。
> ALM-01.03 已合并：PR `#15` → merge commit `872e06e`，Issue `#5` 已关闭并置 `status::done`。
> `REN-002`（StrictDoc 渲染证据，warn 非阻断，`strictdoc==0.30.4` 固定版本）由 ALM-02.03 承接，见 `ce27add`。
> `暂缓` 仅因批次 5 依赖 MVP-2 完成，不是范围否决；前置关闭后改 `待确认` 并重走发布门禁。
> 批次 5 已由用户确认发布（2026-10-23 21:52）：`ALM-06.01`/`06.02` 解除 `deferred`，`确认结论=确认发布`；`06.01` 增加 Playwright UI 级验证范围，`06.02` 的验证报告须引用 UI 截图与演练指标。
> 批次 5 前收尾：`ALM-05.02`、`ALM-05.04` 前置已全部关闭，`确认结论` 改为 `确认发布` 并创建远端工作项；新增 `ALM-05.05`（`ALM-04.02–04.04` 卡片引用、但此前未交付的 `alm-release-verify` 产品技能），否则这些卡的“技能可加载”验收无判定依据。
> `ALM-05.02`/`05.04`/`05.05` 已合并：PR `#53`/`#54`/`#55`，Issue `#50`/`#51`/`#52` 已关闭并置 `status::done`。产品技能现有四个：需求、架构、变更工作流、发布校验；`scripts/check-alm-skill.mjs` 在 CI 校验命令存在性、链接与权限-工具一致性。
> 领域跟踪 Issue `#2`（ALM-01）、`#6`（ALM-02）、`#21`（ALM-03）、`#34`（ALM-04）、`#10`（ALM-05）已关闭；`#1`（ALM-00）保持打开，等待批次 5（`ALM-06.01`/`06.02`）收口。
> 批次 5 已收口：`ALM-06.01`（PR `#61`）、`ALM-06.02`（PR `#62`）、`#57`（ALM-06）与 `#1`（ALM-00）全部关闭并置 `status::done`。最终证据见 [验证报告](verification-report.md)：119 测试、3 演练 / 21 步、UI 28/28（本地 + 宿主）。`#60`（ALM-03.07 分隔符乱码）经复查为终端解码误报，已关闭且未改代码。
> 2026-10-24 05:44 用户指示继续收尾：新增 `ALM-04.05`（Playwright UI 验证的按需 GitHub Actions）与 `ALM-04.06`（Gitea SCM 适配器），`确认结论=确认发布`；两者都在批次 4 的 SCM/CI 主题内。

## 维护规则

1. 新建规划键时先在此登记，状态为 `backlog`、`确认结论=待确认`。
2. 通过门禁后改为 `确认发布`，再执行远端创建。
3. 创建/更新后回读 GitHub 实际值，填写 `#编号`、`PR`、`同步状态`、`最后回读`。
4. 关闭时 `状态=done` 并记录最终 PR 与 merge commit；暂缓用 `deferred` 并写原因。
5. 每次台账变更随 PR 提交，评审时核对与远端一致。
6. 批次边界调整时，同步更新本文档“批次”表与 `task-breakdown.md` 的对应卡片。
