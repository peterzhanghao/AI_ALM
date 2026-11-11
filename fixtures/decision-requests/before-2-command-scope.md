# RUN-002 决策请求（REQ-ALM-002 验收命令失败）

日期：2026-11-02
关联：RUN-002、DEF-REQ-ALM-002-001、FAIL-REQ-ALM-001-001（`fp_2365b66df0a297e0`）、RUN-001-decision.md
状态：修复已落盘并通过本地回归测试；以下三件事超出“执行器”可自行决定的范围，需要你选择。

## 背景

我修掉了造成“验收命令失败”证据为空的两处缺陷（core 丢弃 spawn 错误、插件读虚构 payload），补了测试，并为 REQ-ALM-002 登记了自动化验收命令，详细根因/证据/手工步骤见 `docs/analysis/req-alm-002-acceptance.md`。

但 REQ-ALM-002 的验收标准是“同一失败指纹不再出现，且关联验收测试通过”。关联的自动化测试已经通过；**“指纹不再出现”必须在宿主重跑 REQ-ALM-001 的验收才能确认**，而 REQ-ALM-001 已登记的验收命令（整仓 `node --test`）本身还不健康（RUN-001 遗留）。这三件事需要你拍板。

## 决策 1：REQ-ALM-001 的验收命令范围（核心）

**问题**：`.alm/acceptance/REQ-ALM-001.json` 登记的是从仓库根执行的 `node --test`。实测它会跑 1461 个测试、120 秒超时，并把 `tmp/` 里的脚手架（`tmp/fix-intake-test.mjs`、`tmp/inv-fixture/...`）也扫进来，14 个失败全部来自这些临时目录。因此 REQ-ALM-001 无法通过验收，REQ-ALM-002 的“指纹不再出现”也没有可执行的验证环境。

**为什么现在必须由人决定**：调整命令=调整该需求的验收口径（验收条件不能由实施者自己改）；清理 `tmp/req-list` 等目录是 git worktree，删除不可逆；不改则 REQ-ALM-001 只能继续卡住。

- **选项 A（推荐）**：保留“关联验收测试通过”的语义，把 REQ-ALM-001 的验收命令改为该需求对应的测试文件（如 `packages/dsh-plugin-requirements/test/query-sort.test.mjs` 及后续补的 TEST-ALM-002/003/004 测试），整仓全量测试继续留在 CI 跑，不作为该需求的验收门槛。
  - 影响：验收更快、可重复；代价是单需求门禁不再覆盖“整仓不回归”，需要接受 CI 承担全量回归。
- **选项 B**：先清理 `tmp/` 下的脚手架与 worktree，再保留整仓 `node --test` 命令。
  - 影响：命令不用改，但仓库继续变大后仍会变慢，且任何临时目录污染都会再次造成“验收失败与需求无关”；删除 worktree 不可逆，需要你确认。
- **选项 C**：维持现状，run 保持 waiting-input，等后续变更处理。
  - 影响：REQ-ALM-001/002 都无法形成可交付验收证据。

## 决策 2：由谁触发宿主验收重跑

本会话被限制：审批交互关闭、shell 沙箱禁止 node 启动子进程（`spawn EPERM`），验收 runner 取 HEAD 需要 `execFileSync('git')` 同样 EPERM；宿主 `http://127.0.0.1:61349` 的验收 API 需要 `dsh web` 认证（本会话返回 401）。所以 `.alm/acceptance/REQ-ALM-002/<sha>.json` 的正式证据无法在本会话生成。

- **选项 A（推荐）**：你或维护者在宿主验收面板/终端运行 `node --test packages/alm-core/test/unit/acceptance-command-record.test.mjs packages/dsh-plugin-requirements/test/defect-api.test.mjs`，把结果回填/告诉我，我据此收口 RUN-002。
- **选项 B**：提供本会话可用的宿主认证方式或已登录的验收入口，由我触发。
- **选项 C**：接受“in-band 17/17 pass”作为本次验收证据，正式 `alm.acceptance/v2` 证据后补。

## 决策 3：缺陷如何关闭

`DEF-REQ-ALM-002-001` 当前被我推到 `verifying`（修复就绪、待验收）。按设计 `awaiting-acceptance → closed` 需要人工状态变更，我没有替你关闭。

- **选项 A（推荐）**：宿主验收通过后由人执行状态变更并收口 RUN-002；我在等待期间不再动缺陷状态。
- **选项 B**：授权我在你确认“验收通过”后自动执行 `updateDefectStatus --status awaiting-acceptance` → `closed`（需要你在下一条消息明确授权）。

## 等待期间我能做什么

已完成：修复（core/插件/前端）、新增 5 个 core 单测、改写插件集成测试、登记 REQ-ALM-002 验收命令与 TEST-ALM-005/006、写根因与手工验收文档、更新 failure/defect/run 台账。

若你同意扩大范围，我还可以（**未做，等你点头**）修 `packages/dsh-plugin-requirements/test/http.test.mjs` 直接写 `fixtures/order-refund` 的测试隔离缺陷——本会话沙箱内 OCR/写失败会把 failure 记录写进 fixture，污染 `failure.test.mjs`；我已清理残留文件，但根因还在。

## 推荐结论

决策 1 选 A（需求验收限定到相关测试文件，全量回归交给 CI），决策 2 选 A（宿主重跑后回填），决策 3 选 A（保持人工关闭）。你回一句选择即可，我继续收口。
