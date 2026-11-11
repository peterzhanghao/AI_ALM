# 运行验收：价值、失败解读与交互修复

## 0. 本轮用户问题（m05175）

用户点了「运行验收」后看到两类界面：

1. 弹窗先要求二次确认（回执/计划），再执行；
2. 执行失败后，展开的“证据”是一大段 `git` LF/CRLF 警告和 `✖` 测试行，没有结论，也没有“接下来怎么办”。

用户据此质疑：这个功能的价值和业务逻辑是什么？二次确认是否合理？失败为什么没有任何反馈？

## 1. 核心价值与业务逻辑

验收不是“跑一下测试”，而是把“需求做完了”从一句话变成**可复核的证据**：

- **绑定四要素**：需求修订（requirementHash）、实现提交（headSha）、测试修订（testRevision）、环境（platform/arch/node/runner）+ 时间 + 来源 + 实际输出，写入 `.alm/acceptance/<REQ>/<headSha>.json`（`alm.acceptance/v2`）。
- **参与判定**：验收结果进入 `decideEvidence`，与数据异常、评审覆盖、阻塞项一起决定需求处于“未检查/阻塞/执行失败/证据过期/可进入人工确认/已签收”。
- **参与门禁**：`POST /api/alm/requirements/start`（apply=true）在需求未达到 ready/verified 时返回 409 `evidence-incomplete`；验收是“开始开发”的前置证据之一。
- **可追溯**：需求修改、实现提交或测试修订变化后，旧证据自动判定为过期（`current:false`、`staleReason`），不会被当成新的通过。

因此它的业务语义是“证据台账”，不是“CI 触发器”。

## 2. 为什么取消二次确认（产品判断）

原二次确认只是再次展示“要执行什么”，对用户没有信息增量；而验收运行是：

- 只读工作区（命令限定白名单 node/npm/pnpm，不经 shell）；
- 只写证据文件（`.alm/acceptance/...`），不改变需求与代码；
- 可停止等待（不阻塞界面），结果可重跑。

**决定：点击“运行验收”直接执行，不再弹二次确认。** 只有在“未登记命令”时才进入编辑器；运行中给出已用时间与“停止等待”。

## 3. 失败必须可解释（本次实现）

失败结果面板分三层：

1. **结论**：“验收未通过 · 14 个测试失败 / 共 1461 个测试，1447 个通过”，或“验收通过 · 1 条命令 · 72 ms”。
2. **失败摘要**：失败用例文件（前 5 条 + “另有 N 项”）、`AssertionError` 等错误行（最多 3 条）、**可执行建议**。
3. **原始日志**：`<details>` 默认折叠，展开可看完整输出（最高 260px 滚动）。

建议规则（`describeAcceptance`）：

- 超时 → 缩小命令范围或提高超时；
- 输出里没有测试汇总 → 检查命令是否真的执行了测试；
- 0 个测试 → 检查命令路径；
- 失败集中在 `tmp/.alm/changes/node_modules` 等临时目录 → 当前命令从仓库根扫描到临时副本，建议限定到该需求的测试文件；
- 扫描整仓 > 500 个测试 → 建议限定测试文件；
- 其他 → 先修失败用例再重跑。

这条规则直接来自本次真实故障：`node --test` 在 `D:/DSH` 跑出 1461 个测试，其中 14 个失败全部来自 `tmp/fix-intake-test.mjs` 与 `tmp/inv-fixture/packages/.../test/*.test.mjs`（历史临时副本），仓库自身测试全绿。

## 4. 命令默认值

原默认 `node --test` 会让用户误以为“验收 = 跑全仓”。**决定：默认留空，强制填写**；占位符给示例 `node --test test/your-feature.test.mjs`，并注明“请替换成该需求对应的测试”。保存后不自动回跑，显示计划与“运行验收”。

## 5. 实现位置

`packages/dsh-plugin-requirements/client.js`

- `parseAcceptanceOutput(text)`：解析 node --test 汇总、失败用例、错误行；
- `describeAcceptance(evidence)`：结论/失败列表/建议/日志；
- `AcceptanceModal` 重写：自动运行、进度与已用时间、停止等待（AbortController 中止等待）、失败摘要、原始日志折叠、结果后“关闭/重跑验收/修改命令”；
- `formatLocalStamp(iso)`：验收时间、报告时间统一成本地时间（原显示 UTC，差 8 小时）；
- 失败用例路径统一正斜杠。

`packages/dsh-plugin-requirements/index.js`、`packages/alm-core/src/acceptance/acceptance.mjs` 的登记与执行逻辑沿用上一轮（未改协议）。

## 6. 验证

| 项 | 结果 |
| --- | --- |
| `pnpm test` | 415/415 |
| 登记入口浏览器探针（`tmp/ui-harness/ui-acceptance-register.mjs`） | 15/15 |
| 真实失败摘要浏览器探针（`tmp/ui-harness/ui-acceptance-summary.mjs`，真实 `D:/DSH` + `node --test`，74s） | 12/12 |
| 自动运行/停止等待探针（`tmp/ui-harness/ui-acceptance-cancel.mjs`） | 7/7 |
| 截图 | `tmp/ui-shots-acceptance/{01-registered,02-run-result,03-running,04-failure-summary,05-raw-log,06-cancel-wait}.png` |

## 7. 已知限制

- 证据里的 stdout 仅保留最后 20,000 字节（core `MAX_OUTPUT`），超长输出时失败摘要可能缺少早期行；
- “停止等待”只停止前端等待，命令本身继续在宿主执行（完成后仍会写证据）；
- 失败摘要依赖 `node --test` 的文本格式；其他 runner 会退化为“退出码 + 原始日志”；
- 未直接在宿主 GUI 窗口内点击（通过 Playwright + 真实 client.js + 真实宿主 API 验收）；
- 未提交、未 push。
