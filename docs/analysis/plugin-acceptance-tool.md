# DSH Harness 插件验收工具 · 方案设计

状态：设计提案（未实现）
日期：2026-11-02
前置调研：`lobehub/acceptance` 评估（本仓库 `tmp/acc-poc/` 试跑产物）、DSH 插件扩展点盘点

---

## 0. 一句话方案

在 DSH Harness 里长出一个**插件验收台（Plugin Acceptance Bench）**：agent 一句话触发，自动把插件的 UI 场景跑一遍，采集像素/DOM/控制台/网络证据，产出**自包含报告 + 逐条判定**，人只需在侧栏点「通过 / 打回」，判定连同**代码版本指纹**一起不可变留痕。

它不替代 `alm acceptance`（跑命令）与 `evidence/decision`（判定引擎），而是补上它们缺的那一层：**人能看懂、能签字、能追溯的 UI 证据**。

---

## 1. 为什么市场里没有现成答案

已核实：

- 本机 profile 安装 **224 个 @deepseek-ai/* 包**，逐个 `package.json` 检索 `acceptance` 字样：**0 命中**（`grep -rl "acceptance" .../package.json` 无结果）。
- 唯一配置的插件市场索引是 `https://github.com/omdsh-dev/DSH-better-sidebar`——一个**侧边栏底座**（允许三方注册侧栏页面，内置文件/终端/Git/子 Agent 页），不是验收工具。
- `plugin_market list_plugins` 对该索引报 TLS 断开（网络受限，未完成完整市场枚举，属于本次调研的已知缺口）。

相邻但不够用的能力：

| 已有能力 | 能做什么 | 缺什么 |
| --- | --- | --- |
| `dsh-client-ui-sidebar-browser` | 侧栏里开网页 | 无法被程序化驱动截图；且**封禁宿主端口的 loopback URL**（本仓库 `sidebar.mjs:4-8` 已记录这个坑） |
| `dsh-workspace-changes` / `worktree` | 看代码改动、隔离工作区 | 只看代码，不看渲染结果 |
| `dsh-experimental-auto-review` | 评审向 | 面向代码/变更审阅，不产出 UI 证据 |
| 本仓库 `scripts/ui-verify.mjs` | Playwright 跑页面，出 `report.json` | 无「轮次 / 逐条签收 / 版本指纹 / 视觉基线」 |
| `lobehub/acceptance` | 格式与规则最接近（plan/cases/证据必须带描述/轮次不可变/单测不算 check/逐条 accept） | Windows 便携性差、报告在仓库外、与 DSH 无耦合、无法证明「跑的是哪份代码」 |

**结论：市场空白。** 正确做法不是整包引入 lobehub/acceptance，而是**借它的验收契约（数据形状 + 铁律），长一个 DSH 原生的执行与评审载体**。

---

## 2. 设计原则

1. **证据 / 判定 / 留痕 三分**
   - 证据：像素、DOM、控制台、网络失败、交互时间线——机器采
   - 判定：机器 verdict（pass/fail/blocked）+ 人 verdict（accept / send back）
   - 留痕：轮次不可变，且**绑定代码版本**
2. **不追求「像人一样全自动」，追求「3 分钟看懂该不该签字」**
   效率来自：检查清单自动起草、失败自动定位并附最小复现、视觉 diff、一键复跑失败项。
3. **证据必须自证「跑的是你以为的那份代码」**
   这是 DSH 插件开发的独特陷阱，也是本工具相对 lobehub/acceptance 的**核心差异化**：
   - 客户端 bundle 未重建 → 验收的是旧 UI（只有 `pnpm run dev:web` 在跑才会热更）
   - 宿主 ESM 缓存 → `packages/alm-core` 改动需重启宿主才生效（本仓库已多次踩）
   - profile link 指向别的 checkout → `dsh eval` profile 曾指向 `tmp/req-list/packages/...` 而非仓库源码
4. **证据分级，写明边界**（不假装 L1 等于真实集成）

---

## 3. 证据等级（harness 适配的关键设计）

| 等级 | 跑在哪里 | 能证明 | 自动化 | 现状 |
| --- | --- | --- | --- | --- |
| **L1 隔离渲染** | 独立 sidecar（端口 ≠ DSH 宿主端口，规避侧栏浏览器封禁） | 视觉、布局、文案、状态、交互逻辑 | 全自动 | **可用**（`serve-alm-pages.mjs` + Playwright 已验证） |
| **L2 真实宿主 + 人工在场** | 真实 DSH GUI，插件内嵌跑团脚本执行步骤 | 插槽挂载、宿主服务调用、真实数据流 | 半自动（DOM 快照与断言自动，像素需人/系统截图） | 需实现 |
| **L3 真实宿主全自动** | 宿主以 `--remote-debugging-port` 启动，或拿到令牌化 web 会话 | 一切 | 全自动 | **当前不可用**：桌面进程无调试口（已核实命令行），`127.0.0.1:53748` 需令牌（`401 dsh web authentication required`），无 9222 端口 |

报告里每条检查项**必须标注证据等级**。人看到的不是"绿了"，而是"这条是渲染层证明，那条是集成层证明"。

---

## 4. 数据模型

```
.alm/acceptance2/<plugin>/[<REQ>/]<roundId>/
  round.json        alm.plugin-acceptance/v1
  evidence/
    *.png           截图（可压缩）
    *.dom.json      DOM 快照
    *.console.json  控制台错误/警告
    *.network.json  失败请求
    trace.zip       Playwright trace（可回放）
  baseline/         视觉基线（首轮生成）
  diff/             差异图（三图对比用）
  report.html       自包含报告（截图内联，CSP 锁外部资源）
  reviews.json      人工判定事件流
```

`round.json` 关键字段：

```jsonc
{
  "schema": "alm.plugin-acceptance/v1",
  "plugin": "dsh-plugin-requirements",
  "requirement": "REQ-PAY-004",
  "roundId": "20261102-121500-a1b2c3",
  "roundIndex": 3,
  "supersedes": "20261101-093000-9f8e7d",
  "level": "L1",
  "code": {
    "headSha": "…", "dirty": true,
    "bundle": { "path": "…client.js", "mtime": "…", "sha256": "…" },
    "hostStartedAt": "…", "hostVersion": "…",
    "profile": "desktop", "linkTargetRealpath": "D:\\DSH\\packages\\dsh-plugin-requirements"
  },
  "checks": [
    { "id": "C1", "title": "…", "level": "L1", "status": "pass",
      "observation": "…", "evidence": [{ "path": "evidence/1.png", "description": "…" }],
      "repro": ["open /alm/requirements", "click 验收", "…"] }
  ],
  "summary": { "verdict": "pass", "stats": { "pass": 2, "fail": 0, "blocked": 0 } }
}
```

`reviews.json` 与 lobehub 兼容，便于导出互操作：

```jsonc
{ "acceptanceId": "…", "format": 1,
  "events": [{ "id": "…", "kind": "check", "action": "accept"|"reject",
               "comment": "…", "createdAt": "…", "roundIndex": 3 }] }
```

---

## 5. 工具面（agent 优先）

### 5.1 host tool `acceptance_run`

```ts
acceptance_run({
  plugin: string,
  requirement?: string,
  level?: 'L1' | 'L2',            // 默认 L1
  scenarios?: string[],           // 缺省跑全部
  updateBaseline?: boolean        // 默认 false
})
→ {
  roundId, verdict: 'pass'|'fail'|'blocked',
  stats: { pass, fail, blocked },
  failures: [{ check, reason, evidence: string[], repro: string[] }],
  artifacts: { report: string }
}
```

返回**结构化摘要**，绝不回灌大段日志——这是"高效"的前提（现有 `ui-verify` 会把整份 JSON 吐给 agent）。

### 5.2 host tool `acceptance_review`

人在对话里说"都通过"或"第 2 条打回，按钮没反应"，agent 代为落痕：

```ts
acceptance_review({ roundId, decisions: [{ check: 'C2', action: 'reject', comment: '…' }] })
```

### 5.3 HTTP 路由（客户端 UI 用）

`/api/alm/acceptance/runs`、`/api/alm/acceptance/round/:id`、`/api/alm/acceptance/review`

### 5.4 客户端侧栏页「验收台」

- 检查项列表（等级徽标、状态、耗时）
- 证据画廊：大图、前后对比、控制台折叠、trace 入口
- 逐条「通过 / 打回（带评论）」
- 轮次时间线（第 1 轮打回 → 第 2 轮修复 → 第 3 轮通过）
- 「复跑失败项」

页面必须由 **sidecar 独立端口**提供（参考 `packages/dsh-plugin-requirements/sidebar.mjs`，端口 60870/60872 已有先例）：DSH 侧栏浏览器封禁宿主端口 loopback。

### 5.5 CLI（CI 用）

```
pnpm acceptance --plugin requirements --level L1 --out tmp/acceptance
```
退出码 0/1，产物进 CI artifact。

---

## 6. 场景脚本：把验收知识变成资产

`acceptance/plugins/<plugin>/scenarios/*.mjs`：

```js
export default {
  id: 'requirements-list-render',
  title: '需求列表渲染真实需求行与验收状态列',
  level: 'L1',
  steps: [
    { goto: '/alm/requirements' },
    { expect: { selector: 'tbody tr', count: 2 } },
    { expect: { text: 'REQ-PAY-004' } },
    { shot: 'requirements.png' }
  ],
  expect: { text: '验收尚未执行' }
}
```

- agent 可从需求/变更**自动起草**，人审一遍即固化
- 复用带来的效率：改完插件，同一套场景几秒跑完 + 视觉 diff
- 与 ALM 需求绑定：`scenario.requirement = 'REQ-PAY-004'`，则轮次自动挂在需求下

---

## 7. 视觉回归（性价比最高的一环）

首轮生成 `baseline.png`；后续每轮：

```
base.png | current.png | diff.png   （并排三图）
像素差异率 + 区域框选 + 阈值
```

- 固定 `viewport` + `deviceScaleFactor` + 屏蔽动画 + 区域 mask（时钟、随机数）
- 差异超阈值 → 该项 `fail`，报告直接给三图对比
- 这是"用户难以确认验收"的最佳解法：**不用描述改了哪里，直接看哪里变了**

---

## 8. 与现有资产的关系（不重复造轮子）

| 现有 | 新定位 |
| --- | --- |
| `scripts/ui-verify.mjs` | 升级为**执行器内核**（已有 checks / consoleErrors / failedRequests / shots） |
| `scripts/serve-alm-pages.mjs` | 升级为通用**插件页面 sidecar**（可声明多插件、多路由、多端口） |
| `packages/alm-core/src/acceptance/acceptance.mjs` | 保留：**命令类**验收（测试/CI），与本工具并列 |
| `packages/alm-core/src/evidence/decision.mjs` | 新增输入源 `plugin-acceptance`：把 L1/L2 证据映射到 testing / delivery 视角 |
| `packages/dsh-plugin-requirements/preflight.mjs` | 复用其"预检"思路：验收前先查环境（浏览器可用性、端口、bundle 新鲜度） |
| `lobehub/acceptance` | 借契约不借实现：`export --lobehub` 可把轮次导出成它的 `result.json`，需要时用它的报告页 |

---

## 9. 实现分期

**P0 · 跑通（1–2 天）**
`acceptance_run` host tool + 场景执行器（复用 ui-verify）+ `.alm/acceptance2` 轮次 + 自包含 `report.html` + CLI 退出码。仅 L1。

**P1 · 可签字（2–3 天）**
侧栏「验收台」+ 逐条 accept/打回 + `reviews.json` + 视觉 baseline/diff。

**P2 · 防假绿（2 天）**
代码版本指纹（headSha / bundle sha256+mtime / 宿主启动时间 / profile link realpath）；不一致即 `blocked` 并在报告顶部红字提示。**这一步决定工具是否可信**。

**P3 · 可选增强**
L2 真实宿主内嵌跑团；L3 CDP（需重启宿主开调试口）；`export --lobehub`；录屏（需 python3 合帧，本机暂无）。

---

## 10. 风险与对策

| 风险 | 对策 |
| --- | --- |
| 视觉 diff 抖动（字体/DPR/滚动条） | 固定视口与缩放、关动画、区域 mask、容差阈值 |
| 证据膨胀（PNG） | 报告内联 + 原始证据不进 git（`.alm/acceptance2/` 加 `.gitignore`，报告进 CI artifact） |
| 客户端 bundle 陈旧 | 记录 bundle sha256/mtime，与宿主加载时间比对，不一致直接 `blocked` |
| 多 profile 指向不同源码 | 记录 link 真路径，报告顶部展示 |
| Playwright 浏览器缺失 | 已核实本机 chromium 缺 1248，需 `channel:'chrome'/'msedge'` 回退（已跑通）；preflight 里显式检查并给修复命令 |
| agent-browser 在非交互 shell 挂死 | 不用它做执行器；只用 Playwright |

---

## 11. 需要你决策的三件事

1. **归属**：新开 `packages/dsh-plugin-acceptance` 独立插件，还是并进现有 `dsh-plugin-requirements`（复用其侧栏与路由基建）？
   - 我倾向**独立包**：验收对象不止需求插件，且启停互不影响。
2. **证据是否进 git**：我倾向**不进**（`.alm/acceptance2/` 忽略），轮次元数据进 git 或不进都可磨。
3. **是否接受「L2 需人工在场」作为当前边界**：L3 全自动需要宿主带调试口重启，属于要让用户改启动方式的事，建议放到 P3。

---

## 附：本次调研的已知缺口

- 插件市场只核实了一个已配置索引，且 `plugin_market` 拉取报 TLS 断开，未做全市场枚举。
- `dsh-experimental-*` 系列包在 `app.asar` 内，未解包核对源码，仅按插件清单与名称判断用途。
