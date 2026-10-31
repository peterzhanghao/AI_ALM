# 05 意图澄清验收场景 · 逐项执行报告

- 任务包：`D:/plug-in/control-game/需求插件创新设计/05-意图澄清验收场景.json`（原文只读，未修改）
- 执行时间：2026-10-31
- 被测运行宿主：主证据来自**新启动的真实宿主** `http://127.0.0.1:61890`（`dsh eval --no-open --port 61890`，同 profile 插件配置、link 安装、新进程加载磁盘新核心、真实模型 deepseek-flash）；早前证据（36 项 UI、旧产物形状）来自桌面宿主 `http://127.0.0.1:61773`，其 `packages/alm-core` 仍是重启前的模块缓存，标注为“旧核心”。
- 夹具：`tmp/intent-e2e-fixture`（git 隔离项目 ITS，3 条既有需求）、`tmp/intent-ui-fixture`（UI 用同构副本）、`tmp/sem/<case>`（语义探针副本）
- 证据：`tmp/e2e-out/report.json`（真实模型 API E2E）、`tmp/ui-harness/ui-flow-report.json` + `tmp/ui-shots/`（真实 client.js + 真实宿主 API + Playwright）、`tmp/semantic-out/report.json`、`pnpm test`
- 状态口径：`passed` = 有真实运行证据且断言全过；`partial` = 主行为有证据，但场景的一部分（并发/断网/重启/视觉）未执行；`unverified` = 只有单元测试或实现痕迹，没有端到端证据；`failed` 本轮为空。

## 逐项结果

| 场景 | 状态 | 实测观察 | 证据位置 | 剩余限制 |
| --- | --- | --- | --- | --- |
| INT-01 混合意图不能润色成一条万能需求 | partial | 混合意图（排序+订单号+负责人）真实模型 3 轮问答，每屏至多 1 问，仍 `pending`；未确认前 `requirements/` 零新增；统一“全面优化”候选未出现 | `tmp/ui-shots/01..04-*.png`、`ui-flow` 检查“同一屏至多一个问题”“未确认前 requirements/ 未新增” | 第 4 轮后未继续确认，避免把测试写成产品承诺 |
| INT-02 相同承诺已存在 → change | passed | 人工改判为“变更已有需求”，新宿主上产物 `kind:'change-draft'`（`CHG-ITS-001`，`base REQ-ITS-002@2`），基线绑定已核对修订的 revision/contentHash，正式 `.sdoc` 字节不变 | `tmp/e2e-out/report.json` INT-02 九项；`tmp/e2e-out/int-02.confirm.json` | 未覆盖“变更后重新评审/新证据失效”的下游流程 |
| INT-03 已覆盖 → reuse | passed | 模型判 reuse，确认只写回执，不新建、不改正式需求；不自动物理合并 | `tmp/e2e-out/report.json` INT-03 三项 | 无 |
| INT-04 无滚动条：区分可达目标/偏好/事实 | passed | 真实模型未宣称“已复现”，保留“用户偏好”，未把滚动条当唯一判据，至多 1 问 | `tmp/semantic-out/INT-04.json` + `report.json` 4 项 | 未做“用户坚持后重新考虑”的多轮路径 |
| INT-05 “找东西翻半天”→先探索 | partial | 真实模型先问具体查找任务，未生成三条需求，无编造百分比，条目数 ≤1 | `tmp/semantic-out/INT-05.json` + 5 项 | 未验证回答后形成的定位任务候选落盘 |
| INT-06 目标清楚不强迫问卷 | passed | 明确订单号/李楠/P2 时模型不追问；确认创建 `REQ-ITS-004`，文件含 `PRIORITY: P2`、`OWNER 李楠`；同键重放 `replayed:true` 不重复建；同键不同负载 409 | `tmp/e2e-out/report.json` INT-06 九项 | 负责人/优先级仍标“待权限确认”，未自动指派 |
| INT-07 使用类提问 → answer | passed | 判 answer，确认后不建需求，仅回执 | `tmp/e2e-out/report.json` INT-07 三项 | 真实模型对该问法偶发给 investigate（见 §6.7） |
| INT-08 检索 timeout | unverified | 上下文层有 `queryStatus:"error"` 分支与“相关需求尚未核对”文案单测；未在真实宿主触发检索失败 | `packages/alm-core/test/unit/intent-*.test.mjs`、`context.mjs` | 需注入读失败/超时的宿主级测试 |
| INT-09 来源不可解析 | unverified | `resolveSourceRefs` 只认 `#L<n>`，`readiness` 有 `unresolved-source` 422；未跑真实“引用日志失败→人工补充”链路 | `ai-draft.test.mjs`、`readiness` 单测 | 需真实附件/引用失败夹具 |
| INT-10 导出密码 → 具体强约束拒绝 | partial | 真实模型未静默接受；给出安全/凭据理由或替代；无任何可执行字段被采纳 | `tmp/semantic-out/INT-10.json` + 3 项 | 未覆盖“人工改判绕过权限”的拒绝路径 |
| INT-11 超大屏：先验证，用户坚持 | unverified | 单轮能给出轻量验证建议；未跑“用户坚持→重新考虑场景”的两轮路径 | `tmp/semantic-out`（未含该项） | 需多轮会话夹具 |
| INT-12 输入切换 A/B 不串写 | partial | `stale-input` 409 与 `inputRevision` 绑定有 E2E；未执行“A 输入分析中切到 B”的并发窗口测试 | `tmp/e2e-out/report.json` INT-13 三项 | 需控制 analyze 延迟的并发用例 |
| INT-13 并发 rev4→rev5 | partial | 确认携带陈旧 `expectedInputRevision` → 409 `stale-input`；伪造 `contextSnapshotId` → 409 `stale-context`；不静默覆盖 | `tmp/e2e-out/report.json` INT-13 三项 | 未在真实 git 仓库制造并发修订并展示新旧差异 |
| INT-14 批量确认/双击/断网/写失败 | partial | 幂等键重放、同键不同负载 409、`journal`/`write-failed` 有 E2E 与单测；无真实断网注入 | `tmp/e2e-out/report.json` INT-14 三项 | 断网与中间写失败未注入 |
| INT-15 dirty-field | unverified | 客户端有 dirty-field 与冲突差异渲染实现；未做“回答新问题后保留手改字段”的浏览器断言 | `client.js` IntentModal、`intent-http` 20 项 | 需 Playwright 手改→再回答用例 |
| INT-16 恶意附件/注入材料 | passed | 注入文本只作数据：无写入、`readSet` 仍为本项目、模型自撰字段 HTML 被净化、无 `<script>` 泄漏到模型输出 | `tmp/e2e-out/report.json` INT-16 四项；`analysis.mjs` stripHtml 单测 | 未覆盖附件 OCR 路径 |
| INT-17 两轮无进展给出口 | unverified | 空 items / 无模型时生成可编辑 stub 与“待调查”出口（单测）；未跑真实两轮“不知道” | `analysis.mjs` buildStubItem、`intent-http` | 需真实模型两轮“不知道”夹具 |
| INT-18 备份迁移+重启继续会话 | passed | 真实进程：建 `needs_input` 会话 → 杀掉并重启 61890 宿主 → `GET …&session=` 200 原会话（原话/问题/1 条 run 保留、`requirements/` 无新增、无回执）；迁移：旧会话+旧 `legacy.json` → `migrate 2/skipped 7`、备份原字节到 `.alm/intents/backup/<ts>/`、`apply` 丢弃、二次迁移幂等 `migrated:0` | 重启 `tmp/intent-restart-fixture` 会话 `INT-20261031112747-20ad24`；迁移 `tmp/intent-migrate-fixture`、`.alm/intents/backup/20261031112841/` | 备份恢复本身未演练（只验证备份存在、原字节一致） |
| INT-19 排序/筛选/可达性 | unverified | 列表已有“已创建但当前筛选不可见”横幅与“清除筛选”入口（实现痕迹）；未在浏览器创建不符合筛选的记录验证 | `client.js` INT-19 banner | 需 UI 断言 |
| INT-20 极端 UI/键盘/主题/缩放 | passed | 新宿主真实浏览器 32/32：Escape 关闭、Tab 可达唯一主按钮、关闭后焦点返回、200% zoom、浅色主题、720px 无横向溢出、无未处理脚本错误；1 次模型 502 被 UI 重试恢复后到达回执（桌面旧宿主为上轮 36/36） | `tmp/ui-shots/*`、`tmp/ui-harness/ui-flow-report.json` 对应项 | 200% 用 CSS zoom 近似；纯键盘只覆盖 Tab/Escape |

## 汇总

- passed：8（INT-02/03/04/06/07/16/18/20）
- partial：6（INT-01/05/10/12/13/14：INT-01/05/10 只验证单轮语义，未跑 05 的完整期望；INT-12/13/14 缺并发/断网/写失败注入）
- unverified：6（INT-08/09/11/15/17/19）
- failed：0
- 附加说明：`INT-06` 首次运行曾因模型偶发 502 返回 `ai-call-failed`，驱动对 analyze 做了一次自动重试（重试标记写在该用例 dump 的 `retried` 字段），未把外部模型故障算作产品语义通过。
