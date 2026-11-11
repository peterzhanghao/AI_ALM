# DSH 宿主服务 Spike：需求插件"AI 持续推进"的执行载体选型

> 结论先行：**选 B（复用宿主会话）**，但只把"起会话 + 观察事件 + 取消/恢复"做进第一期，编码执行先用宿主 agent 的 preset 组合；**A（自建最小执行器）只在 B 的 preset 组合探测失败时作为降级**。
> 时间盒内未做破坏性实验（未重启宿主、未写插件代码），因此 (a)(b)(c) 的"插件内可直接调用"有实现级证据但缺一次线上探测（见 §6）。

- 探测时间：2026-11-02，DSH Desktop `0.2.1-rc.5`（`resources/runtime/primary-runtime/runtime.json`）
- 运行中宿主：PID 39924，`DeepSeek Harness.exe --expose-internals .../dsh-desktop-host/lib/index.js .../app.asar/dsh C:\Users\22878\.dsh\profiles\desktop .../primary-runtime ...`
  （`Get-CimInstance Win32_Process -Filter "name='DeepSeek Harness.exe'"`；GUI 端口 `http://127.0.0.1:53748`）
- 宿主代码位置：`app.asar` 是**单个打包文件**（`resources/app.asar`，182 MB），内部路径形如
  `...\resources\app.asar\dsh\node_modules\@deepseek-ai\<pkg>\...`。本次用 Node 直接解析 asar 头（`u32[0]=4`，`u32[4]=header 长度`，条目 `offset/size` 为**字符串**，须 `Number()`）只读抽取文件，未解包落盘。
- 仓库侧已证事实（不复述）：`packages/dsh-plugin-requirements/index.js:114` `this.ctx = ctx`；`:528/:530/:543` 用 `ctx.get('agentDefaultModel')`、`ctx.get('llm')`；插件行由 `packages/dsh-plugin-requirements/cordis.patch.yml` 插入宿主。

## 1. 宿主服务清单（名称、证据、能力）

分类：**[实现]** = 看到契约实现/挂载行；**[推断]** = 由相邻实现推导，未直接验证调用点。

| 服务/包 | 证据（file:line） | 能力 | 类型 |
|---|---|---|---|
| `llm`（`dsh-llm`） | `dsh-base/cordis.patch.yml:34`；插件已用 | `stream/listProviders/listModels/resolveModelInfo` 单轮模型调用 | [实现] |
| `agentDefaultModel`（`dsh-agent-default-model`） | `dsh-base/cordis.patch.yml:90`；插件已用 | `currentSelection() -> {provider, model, reasoningEffort?}` | [实现] |
| `sessions`（`dsh-session`） | 挂载：`dsh-base/cordis.patch.yml:40-41`；契约：`@deepseek-ai/dsh-session/README.md` "Use this package" | `create(id,{meta})/get/list/fork`；`session.append(type,data,{surfaceOp})` 追加事件并通知观察者；`deriveMessages()` 增量投影模型历史 | [实现] |
| `agents` + `AgentHandle`（`dsh-agent`） | 挂载：`dsh-base/cordis.patch.yml:82-83`；契约：`@deepseek-ai/dsh-agent/README.md` | `ctx.agents.create({sessionId,agentOptions,meta,setup})` / `resume()` / `get/list/roots`；句柄 `dispose()`；`agent.followup()/steer()/inject()/cancel(cause)/whenIdle()` | [实现] |
| agent 驱动（`dsh-agent-loop`） | `dsh-base/cordis.patch.yml:512`；`@deepseek-ai/dsh-agent-loop/README.md` | 注册 factory 使 `ctx.agents` 生效；"The loop runs each created agent to completion"；可声明式起 agents | [实现] |
| `subagent`（`dsh-subagent` + spawn/fork 后端 + 工具） | 挂载：`dsh-base/cordis.patch.yml:360,363,368,374-381`；`@deepseek-ai/dsh-subagent/README.md` | `startActivation({provider,label,request,signal,delivery}) -> {childId,messageId?,result,dispose}`；`delivery:'caller'` 让调用方 await 结果；`sendMessage/interrupt/listChildren` | [实现] |
| `jobs`（`dsh-jobs-local`，模型侧 `dsh-tool-jobs`） | 挂载：`dsh-base/cordis.patch.yml:96-97,289-290`；`@deepseek-ai/dsh-jobs/README.md` | 后台 job：`start`（kind+label -> `<kind>-<uuid>`）、读输出、`list`、`wait(timeout)`、取消；状态 `running/stopping/completed/killed/failed`；settle 走事件流 | [实现] |
| Session 持久化/查询 | `dsh-base/cordis.patch.yml:138-139,157-158` | `dsh-session-persistence-jsonl` 落盘、`dsh-session-query-sqlite` 查询/投影缓存 | [实现] |

### 子会话用量归属补充（2026-11-07）

- 当前安装的 `dsh-subagent/README.md` 说明，`listChildren(parentSessionId, signal?)` 从父会话的 `subagentCatalog` 投影读取直接子项；递归发现读取各本地子会话目录，无法读取的分支会被跳过并返回诊断。因此，成功返回的列表本身不能证明所有后代均已覆盖，外部条目也不能按本地会话处理。
- 当前安装的 `dsh-session-query/README.md` 说明，`traceSession(id)` 返回已知祖先链和递归后代树；含事件正文的 `readSession` 和保留的 `SessionObservation` 提供 `inheritedEventCount`，可区分继承前缀与自有事件。该字段是事件边界，不直接提供可去重的请求或费用账本。
- 后续实现应先验证目录诊断、外部节点及 `inheritedEventCount` 在实际 fork、恢复和读取失败时的结构与语义，再基于可验证的会话与请求标识计算自有调用；继承前缀不能再次计入。任何不可读取分支、无法归属调用或无法核实的价格均须显示未知或覆盖不完整，不能用已发现节点数推断完整率。当前需求插件未把子会话用量计入运行总计，也未声称子会话覆盖完整。
| Web 宿主 API（`dsh-api-gateway` + `dsh-api-session-controller`） | `dsh-base/cordis.patch.yml`（typert-gateway/api-gateway、remote-access）；`dsh-api-session-controller/lib/index.js:498,513-521` | Host 侧同进程：`assertPresetApplicable` 用 `ctx.get("agentPresets")`；`createAgent()` 就是 `ctx.agents.create({sessionId, agentOptions: this.agentOptions(), meta:{cwd,agentPreset}, setup})` | [实现] |
| Agent preset（`dsh-agent-preset-registry` + `dsh-agent-preset`） | `dsh-web-app/cordis.patch.yml:591-592`；`dsh-web-app/presets/cordis.patch.yml:1-6,126`；`dsh-agent-preset-registry/README.md` "Use this package" | registry 提供 `agentPresets` 服务（api-session-controller:498 直接 `ctx.get`），preset 是普通插件行（tool-bash/tool-fs/system-prompt…按 preset 组合），"agent plane moves behind agent presets" | [实现]（注册表本身）；preset→新 agent 的编程组合方式 [推断] |
| SDK 跨进程协议（`dsh-sdk-jsonrpc-server` + `dsh-sdk-protocol` + `dsh-sdk-app`） | `dsh-sdk-protocol/README.md`（methods 表 + Known Limitations）；`dsh-sdk-jsonrpc-server/lib/index.js:322-337`；`dsh-sdk-app/README.md` | stdio 上的 newline JSON-RPC：`initialize / session/prompt / session/resume / session/wait / session/working-directory/{get,set} / shutdown`；server→client `session.event`（全 runtime 事件）、`session.status`、`subagent.started/finished`；**无 cancel / close 方法**，"a client abandons a turn by closing the runtime process"；stdout 专用于 JSON-RPC | [实现] |
| CLI 一次性任务 | `dsh --help` 输出："`dsh headless \"run the tests\"  answer one task, print the result, and exit`"；`dsh-headless/lib/index.js:317`（`agents.create`） | 外部进程跑一个任务并退出；`dsh --profile <name>` 起完整 profile；`dsh plugin --profile <name> add ...` | [实现] |
| HTTP 观察通道 | `curl http://127.0.0.1:53748/` → `401 dsh web authentication required; reopen the URL printed by dsh web`；`/api` → `401 unauthorized` | 有鉴权，不是免授权观察通道 | [实现] |

## 2. 五个问题的明确回答

**(a) 插件能否创建 DSH agent 会话并让它执行任务？→ YES（同进程），有一个关键前提。**
`ctx.agents.create({sessionId, agentOptions, meta:{cwd, agentPreset}, setup})` 是宿主自己的正规路径（`dsh-api-session-controller/lib/index.js:513-521`；SDK 同款 `dsh-sdk-jsonrpc-server/lib/index.js:322-337`；headless `dsh-headless/lib/index.js:317`）。创建后 `followup()` 入队、loop 跑到完成，`whenIdle()` 收敛（`dsh-agent/README.md`）。
**前提/风险**：Web/桌面 profile 把工具面移进 agent preset（`dsh-web-app/cordis.patch.yml:465-566`，tool-bash/tool-fs/system-prompt 等行是 preset 行），`create()` 的 `setup` 决定新 agent 挂哪些工具。插件若不传 `setup`/不挂 preset，得到的 agent **没有工具**（只能对话）。`setup` 与 preset 的编程组合方式本次未验证（§6 的 P1）。

**(b) 能否订阅该会话的事件/输出？→ YES（同进程）；跨进程 YES 但要起 SDK runtime。**
同进程：`agent/*` 事件（`agent/pre-step`、`agent/request-error`、`agent/assistant-stream`、`agent/status`、`agent/created`、`agent/disposed`、`agent/inbox/*`，见 `dsh-agent/README.md` "Intercept or observe work in flight"），`session.append()` "notifies observers"（`dsh-session/README.md`）。注意 `agent/assistant-stream` 是**进程内**表现数据，重放源是持久事件。
跨进程：`session.event`（全 runtime 未过滤）+ `session.status` 通知，见 `dsh-sdk-protocol/README.md` methods 表。

**(c) 能否取消/暂停？→ 取消 YES，暂停 NO（只有"取消 + 之后 resume"）。**
`AgentHandle.agent.cancel(cause)`（"aborts the active activity and, unless keepInbox, clears pending work"）、`handle.dispose()`、subagent `dispose()`/interrupt、jobs `cancel`（`dsh-agent/README.md`，`dsh-subagent/README.md`，`dsh-jobs/README.md`）。SDK 协议层**没有** cancel/close，只能杀进程（`dsh-sdk-protocol/README.md` Known Limitations）。"暂停"没有一等语义；等价物是 `cancel` + `ctx.agents.resume({resumeSessionId})` 继续，或 `whenIdle()` 等待。

**(d) 会话状态能否被另一个进程/请求观察？→ YES（持久化日志 + 查询层 + SDK 协议），但 HTTP 需鉴权。**
落盘：`C:\Users\22878\.dsh\sessions\<workspace-slug>\<sessionId>\session.v4.jsonl.zstd`（实例：`...\--D-DSH--\session-185a0c35-5358-479b-a41d-a3ddcc120eaf\session.v4.jsonl.zstd`），投影缓存在 `~/.dsh/storages/session_projcache`。官方跨进程通道是另起 SDK runtime 走 stdio JSON-RPC（`dsh-sdk-app`/`dsh-sdk-jsonrpc-server`）。GUI 的 HTTP 端口对未认证请求返回 401，不能当观察通道。

**(e) 是否有后台 job 服务？→ YES，但是**进程内**、且生产者需要 controller。**
`ctx.jobs`（`dsh-jobs-local` 挂载于 base，:96-97）；"Jobs managed by the shipped in-process registry die with the harness process; durable execution across restarts needs a different backend"；"A job belongs to the agent session that started it: another agent cannot read or stop it"；"A producer can start work only while a controller that serves the owner is attached"（`dsh-tool-jobs`，:289-290）。→ 适合"跑一条命令 + 读回显"，不适合"重启后继续跑"。

## 3. 结论：A 还是 B

**建议 B（复用宿主会话/子代理），采用"薄 B"分层：**

1. 需求插件只存执行记录：`requirementId → { sessionId, agentPreset, changeId, checkpoint: lastEventSeq, status }`（写进 `.alm/`，与现有 change 记录同层）。
2. 起执行：`ctx.agents.create({ sessionId: 'alm-<changeId>', agentOptions: ctx.agentDefaultModel.currentSelection(), meta: { cwd: <worktree>, agentPreset: 'standard' }, setup })`，幂等键 = 确定性 `sessionId`（SDK 用 `brandString(sessionId)` 同样做法，`dsh-sdk-jsonrpc-server/lib/index.js:331`）。
3. 推进：`handle.agent.followup({ content:[{type:'text',text:taskPrompt}], source:{kind:'alm'} })`；需要纠偏时 `steer()`。
4. 观察：监听 `agent/status` + `session/event`（同进程），把 `tool/result`、`assistant/message` 折叠成"AI 正在做什么/待你决定什么"；断线/重启后从持久化日志（eventSeq 检查点）回放。
5. 取消/恢复：`handle.agent.cancel()` / `ctx.agents.resume({resumeSessionId})`；"暂停"=cancel + 记 checkpoint。
6. 编码/测试：优先用 preset 组合出的 `tool-bash`/`tool-fs` 跑命令；命令型长任务用 `ctx.jobs`（进程内，接受"宿主重启即失"的语义），或直接让 agent 调 bash。
7. 降级开关：若 P1/P2 探测失败 → A-lite（插件只维护 change/tasks 状态与"等待人工/AI 建议"，不真执行）；或 B′：`spawn` 一个 `dsh headless "<task>"` 子进程拿退出码与 stdout（跨进程隔离，但无事件流、启动成本高、profile 管理复杂）。

**为什么不是 A**：A 要自建调度、回执、事件、恢复、幂等、暂停——本次已证宿主 `agents/sessions/subagent/jobs/persistence-query` 五件套齐备且已有三种官方调用点（web controller / sdk server / headless），B 的增量代码量小一个数量级，且能直接复用宿主 UI 的会话可视化。A 只在"插件必须脱离宿主进程独立运行"时才值得。

**B 的最小接口草图（插件内，约 200 行）**

```js
// services actually probed (names per package READMEs / mount rows)
const agents = ctx.get('agents')        // dsh-agent
const defaults = ctx.get('agentDefaultModel').currentSelection()
const presets = ctx.get('agentPresets') // dsh-agent-preset-registry (web-app patch :591)

async function ensureRunner(change) {
  const sessionId = `alm-${change.id}`
  const existing = agents.get(sessionId)
  if (existing) return existing
  try {
    return await agents.resume({ resumeSessionId: sessionId, agentOptions: defaults })
  } catch {
    return await agents.create({
      sessionId,
      agentOptions: defaults,
      meta: { cwd: change.worktree, agentPreset: 'standard' },
      setup: composeAgentWorld,      // ← 唯一未验证点：从 preset 组合工具面
    })
  }
}

async function drive(change, prompt) {
  const handle = await ensureRunner(change)
  const dispose = ctx.on('agent/status', (e) => e.sessionId === handle.agent.session.id && onStatus(e))
  handle.agent.followup({ content: [{ type: 'text', text: prompt }], source: { kind: 'alm' } })
  await handle.agent.whenIdle()
  dispose()
}
```

**B 的风险（按严重度）**

1. **工具面组合未证**（阻断级）：没有 preset/setup，agent 只能对话不能改代码。这是 B 唯一可能让方案塌掉的点，必须先做 P1/P2 探测。
2. **API 稳定性**：`ctx.agents`/`ctx.sessions`/`ctx.jobs` 是宿主内部 cordis 服务，不是对外稳定插件 SDK；当前版本 `0.2.1-rc.5`（pre-release），无兼容承诺（`dsh-sdk-protocol` 自述 "No protocol-version negotiation / pre-release stance"）。升级宿主即可能改签名。
3. **生命周期绑定插件 fiber**：`ctx.sessions.create()` "bound to the calling fiber"；插件重载/HMR/profile patch 更新会 dispose 该 agent → 必须用"确定性 sessionId + resume"兜底，不能把运行中状态只放内存。
4. **取消语义不足**：没有 pause；`cancel` 会清空未处理 inbox（除非 `keepInbox`），"暂停后原样继续"要自己设计检查点。
5. **后台任务不持久**：`ctx.jobs` 进程内，宿主重启即丢；"重启恢复"必须落在 session 日志 + resume 上，而不是 job 上。
6. **权限/审批**：新 agent 继承调用方 context 的权限根；工具调用可能触发审批（desktop 有 user-approval 行），插件需要处理等待人类的状态，否则会表现为"卡住"。
7. **运维封闭**：`dsh --profile desktop --dump-config` 直接报 `error: profile "desktop" is managed exclusively by the Electron application` → 桌面 profile 的编排不能靠 CLI 旁路调试，验证要在 GUI/日志里做。
8. **事件模型细节**：`agent/assistant-stream` 是进程内展示数据，"not the replay source"，UI/持久化必须读 `session/event`，别把流当真相。

## 4. 未解问题与下一步探测（按顺序）

- **P1（5 分钟，需插件侧一行代码或临时插件）**：在需求插件里 `console.log(ctx.get('agents'), ctx.get('agents')?.get)`，确认服务在**该插件 fiber** 上可注入（[推断]→[实现]）。同时 `ctx.get('agentPresets')` 是否存在。
- **P2（30 分钟，一次性 spike 插件）**：用 `setup` 或 preset 挂 `tool-fs`+`tool-bash`，`agents.create` 一个 `cwd=D:\DSH` 的 agent，`followup("读 README 第一行")`，验证：工具有效、`agent/status` 事件到达、`whenIdle()` 收敛、`cancel()` 能打断、重启后 `resume({resumeSessionId})` 能续上。
- **P3**：`dsh headless "run the tests"` 能否在当前机器直接跑（需要对应 profile），作为 B′ 备选；若可行，可作为"隔离执行"通道。
- **P4**：确认 GUI 端要不要显示插件的 AI 会话（是否复用宿主会话 UI，还是插件侧 render 一条只读轨迹）。

## 5. 命令清单（全部只读，可复现）

```bash
# 宿主进程与 profile
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"name='DeepSeek Harness.exe'\" | Select-Object ProcessId,CommandLine | Format-List"
# asar 头解析（读任意内部文件）
node -e 'const fs=require("fs");const p="C:/Users/22878/AppData/Local/Programs/DeepSeek Harness/resources/app.asar";const fd=fs.openSync(p,"r");const b=Buffer.alloc(8);fs.readSync(fd,b,0,8,0);const n=Number(b.readUInt32LE(4));const h=Buffer.alloc(n);fs.readSync(fd,h,0,n,8);const s=h.toString("utf8");const j=JSON.parse(s.slice(s.indexOf("{")));/* walk j.files; read at 8+n+Number(entry.offset), size=Number(entry.size) */'
# 关键内部文件（路径以 app.asar 为根）
#   dsh/node_modules/@deepseek-ai/dsh-base/cordis.patch.yml
#   dsh/node_modules/@deepseek-ai/dsh-{agent,agent-loop,session,subagent,jobs,sdk-protocol,sdk-app,agent-preset-registry}/README.md
#   dsh/node_modules/@deepseek-ai/dsh-api-session-controller/lib/index.js
#   dsh/node_modules/@deepseek-ai/dsh-sdk-jsonrpc-server/lib/index.js
#   dsh/node_modules/@deepseek-ai/dsh-web-app/cordis.patch.yml
#   dsh/node_modules/@deepseek-ai/dsh-web-app/presets/cordis.patch.yml
# 挂载/CLI
cd "C:/Users/22878/AppData/Local/Programs/DeepSeek Harness/resources/runtime/cli/bin" && cmd //c "dsh.cmd --help"
cmd //c "dsh.cmd --profile desktop --dump-config"   # → 被 Electron 独占管理，报错（见风险 7）
# HTTP 通道鉴权
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:53748/        # 401
# 会话落盘
ls ~/.dsh/sessions/--D-DSH--/*/session.v4.jsonl.zstd | head
```

## P1/P2 实测（Phase 2 前置）

> 结论：**P1、P2 均通过，方案 B 的可实现性由"[推断]"升级为"[实测]"**。需求插件可以在宿主进程内起一个**带完整工具面的 agent 会话**，能 followup、观察事件、cancel、dispose。唯一新增的集成硬约束：`followup()` 的参数必须是**完整 Message（含 `role`）**，用 `createUserMessage()` 造，不能用 `{content, source}` 裸对象（见 P2-4）。
>
> 探测时间：2026-11-02 12:04–12:13；方式：**独立 DSH_HOME + 独立 profile + 独立端口**的第二个宿主进程，桌面宿主 PID 39924 全程未触碰（探测结束后其仍 `LISTENING 127.0.0.1:53748`）。

### P1 实测环境与方法

| 项 | 值 |
|---|---|
| 隔离 HOME | `DSH_HOME=D:/DSH/tmp/host-probe/home`（`@deepseek-ai/dsh-home-paths` 支持该环境变量；只复制 `.credentials.yaml`，sessions/storages/profiles 全新建，不污染 `~/.dsh`） |
| 宿主形态 | `dsh --profile probe --from-default-profile web --no-open --port 61986`，profile probe = bundles `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app`（与桌面同构的 web 形态；`--dump-config` 1231 行，含 `agent-preset-registry`(default: `standard`) 与 4 个 preset 行） |
| 插件注入方式 | `--patch D:/DSH/tmp/host-probe/probe-patch.yml`，插入行 `name: D:/DSH/tmp/host-probe/probe-p1.mjs`（**绝对路径直接可用**，`dsh-app-boot` 加载时转 file URL；无需装进 profile 的 node_modules） |
| 产物 | `D:/DSH/tmp/host-probe/`（`probe-p1.mjs`、`probe-p2.mjs`、`probe-patch.yml`、`out/probe-report.json`、`out/host7.log`、`out/request-header.json`） |

### P1 结论：`agents` / `agentPresets` 都可达，但**不能在 apply 阶段裸读**

同一个行（**不声明 inject**）在 apply 里逐时间点采样 `ctx.get(name)`：

| 时刻 | `ctx.get('agents')` | `ctx.get('agentPresets')` | `ctx.agents`（属性访问） |
|---|---|---|---|
| apply 内（t≈0ms） | `undefined` | `undefined` | **抛错** `cannot get property "agents" without inject` |
| t+1000ms / 3000ms / 8000ms / 20000ms | `present:object` | `present:object` | 仍抛同样错误（未 inject 时属性访问被 cordis 守卫） |

- `ctx.get('agents')` **不需要 inject 也能在服务就绪后取到**（t+1s 起稳定 present）；但 `ctx.agents` 这种属性访问在未 inject 的 fiber 上**永远抛错**。
- 因此需求插件有两种正规写法：①`export const inject = ['agents']`（apply 推迟到 agents 就绪后执行，实测 P2 行就是这么起效的）；②不 inject，但把 `ctx.get('agents')` 推迟到工具执行/用户点击时再读（此时已 present）。**禁止**在 apply 里直接 `ctx.agents.*`。
- 同一时刻还确认可达：`tool` 侧的 `systemPrompt`/`sessions`/`sessionQuery`/`llm`/`jobs`/`agentLoop`/`agentDefaultModel`/`credentials`/`authorization` 均 present；`ctx.get('fsSandbox')` 在插件 fiber 上始终 `undefined`（沙箱是 agent-scoped，随 preset 挂到会话上，见 P2 的 `permission/preset=workspace-write`）。

### P2 结论：带工具的会话可起、可驱动、可观察、可取消

用 `export const inject = ['agents']` 的探针行，按 `dsh-api-session-controller` 同款配方执行，全程一次跑通：

1. `ctx.get('agentPresets').resolve('standard')` → `{id:'standard'}`（web/桌面 composed 配置里 preset 存在且可解析）。
2. `ctx.agents.create({ sessionId, agentOptions:{provider:'deepseek-official', model:'deepseek-flash'}, meta:{cwd:'D:/DSH/tmp/host-probe/workdir', agentPreset:'standard'}, setup: async (agentCtx) => { await presets.mount(agentCtx, 'standard') } })`
   → 返回 `{ agent, dispose }`；`agent` 暴露 `loopCtx/id/options/session/inbox/phase/ctx/dispatch/systemPrompt/...`，`whenIdle`/`cancel`/`followup` 均为 function。
3. `agent.followup(<完整 user Message>)` → `whenIdle()` resolved；`session.deriveMessages()` 得到 8 条消息：`system,user,user,user,user,assistant,tool,assistant`。
4. **工具真的生效**（这是本次探测的关键证据）：模型发起 `tool-call: read`，`tool/result` 回传
   `<path>D:\DSH\tmp\host-probe\workdir\probe-target.txt</path> … 1: HOSTPROBE-TOOL-OK-4821`，
   最终 assistant 文本恰好是 `HOSTPROBE-TOOL-OK-4821`（探针预写入文件的 marker）。请求头里 `tools` 共 **31 个**（standard preset 的 tool-pwsh/tool-fs/tool-fs-search/tool-jobs/tool-schedule/tool-skill/tool-goal/planning/…）。
5. **事件可观察**：同进程收到 28 条 `session/event`，类型覆盖
   `permission/preset, sandbox/mode, approval/policy, agent/inbox/spliced, turn/start, step/start, system/message, user/message, request/header, request/context, session/title, session/title-llm-request, session-log-deepseek/delivery-accepted, assistant/message, tool/call, tool/result, step/end, turn/end`；
   `agent/status`、`agent/assistant-stream` 也可订阅（探针同时挂了 `agent/request-error`）。
6. `agent.cancel({kind:'user'})` 正常返回（undefined），`handle.dispose()` 正常完成，`agent.phase` 回到 `{kind:'idle', lastTurn:1}`。

会话内建的权限上下文（来自 preset/base 行，不是探针给的）：`permission/preset = workspace-write`、`sandbox/mode = workspace-write`、`approval/policy = ask`。→ **审批通道存在**；本次用的 `read` 工具无需审批，所以"等待人类审批"的状态本次未触发（见"未验证"）。

### P2-4 踩坑（Phase 2 必须照抄，否则必挂）：followup 要传完整 Message

第一版探针按 README 示例写 `agent.followup({ content:[{type:'text',text}], source:{kind:'hostprobe'} })`，结果每次 turn 都在 ~30ms 内失败：

```
assistant/attempt → finish.reason = { kind:'error', failure:{ message:'DeepSeek Messages transport failed', code:'TRANSPORT' } }
turn/end          → reason = { kind:'error', error:{ message:'DeepSeek Messages transport failed', code:'TRANSPORT' } }
```

bisect 过程（用 `ctx.get('llm').stream()` 直接重放同一批消息，绕开 agent loop）：

| 变体 | 结果 |
|---|---|
| 简单 user 消息 / 带 31 个 tools / 带 `maxTokens:256000`+`reasoningEffort:'high'` | 全部成功（`finish.reason={kind:'stop'}`）→ 适配器、凭据、网络、工具 schema 都正常 |
| 重放该会话 `deriveMessages()` 的全部消息 | `TRANSPORT` 失败 |
| 逐条消息重放 | 只有**第 2 条**失败；其形状为 `{ content:[…], /* 没有 role 字段 */ }` |

根因链：`followup(input)` 就是 `send(input)`（`dsh-agent-loop/lib/index.js:806-807`），**入参被当作消息本体**直接 splice 进 inbox；缺 `role` 的消息最终以无 role 形态进入模型请求，适配器在序列化/映射阶段抛非 `LlmError`，被 `dsh-llm-deepseek/lib/index.js:2167` 包成 `TRANSPORT`（cause 被 `normalizeLlmFailure` 丢弃，所以日志里只剩一句 "DeepSeek Messages transport failed"）。

宿主自己的正规写法在 `dsh-api-session-controller/lib/index.js:943-950`：`createUserMessage({content, source})` 后再 `agent.followup(message)`。探针改成 `{ role:'user', content, source:{kind:'user'} }` 后立刻跑通。

### 最小代码片段（Phase 2 可直接用）

```js
// 需求插件 host 侧（packages/dsh-plugin-requirements/index.js 已验证可用 ctx.get，见下）
import { createUserMessage } from '@deepseek-ai/dsh-llm'

export const inject = ['agents']            // ← 关键：否则 apply 早于 agents 就绪

export function apply(ctx) {
  // ...
  const presets = ctx.get('agentPresets')                  // P1：present
  const { provider, model } = ctx.get('agentDefaultModel').currentSelection()

  async function startRequirementSession({ sessionId, cwd, prompt }) {
    const resolved = await presets.resolve('standard')     // web/桌面 profile 的 shipped preset
    const handle = await ctx.agents.create({
      sessionId,
      agentOptions: { provider, model },
      meta: { cwd, agentPreset: resolved.id },             // ← 不传 preset/setup 的 agent 没有工具
      setup: async (agentCtx) => { await presets.mount(agentCtx, resolved.id) },
    })
    // 观察：ctx.on('session/event', …) 收 tool/call、assistant/message；ctx.on('agent/status', …)
    await handle.agent.followup(createUserMessage({       // ← 必须完整 Message，别传裸 {content,source}
      content: [{ type: 'text', text: prompt }],
      source: { kind: 'user' },
    }))
    await handle.agent.whenIdle()
    const messages = handle.agent.session.deriveMessages() // 终态投影（tool 调用可在此核对）
    return { handle, messages }
    // 收尾：handle.agent.cancel({ kind: 'user' }); await handle.dispose()
  }
}
```

`ctx.get('agents')` 的两种等价写法（P1 实测）：

```js
// A. 声明 inject —— apply 推迟到 agents 就绪（推荐，P2 探针即此法）
export const inject = ['agents']
// B. 不声明 inject —— 只能在"服务就绪后"（实测 t+1s 起）用 ctx.get，且永远不能用 ctx.agents 属性访问
function later() { const agents = ctx.get('agents'); /* present:object */ }
```

### 未验证 / 仍需 Phase 2 决定的点

| 项 | 状态 | 需要谁做什么 |
|---|---|---|
| 审批交互（工具触发 user-approval 时的等待/超时） | **未验证** | 探针只用了免审批的 `read`。Phase 2 要跑一次 `pwsh` 写文件/越界读，确认审批请求如何抵达（desktop 的 user-approval 行）以及插件侧要不要兜底超时 |
| `resume({resumeSessionId})` 跨宿主重启续跑 | **未验证**（task-6 未要求） | Phase 2 需要"宿主重启后继续"时再单独探测；已知持久化行 `dsh-session-persistence-jsonl` 存在 |
| 插件 HMR/重载导致 agent 被 dispose | 未验证 | B 的生命周期风险仍成立，仍需"确定性 sessionId + resume"兜底设计 |
| 桌面 profile（含 requirements 插件链）内的完全一致行为 | 未验证 | 探针是 web 同构 profile，未装 requirements 插件（不改仓库、不碰桌面宿主）；Phase 2 合并前应在桌面宿主里跑一次同样序列 |
| 模型侧：本次用 `deepseek-flash` + `reasoningEffort: high` | 已验证可跑 | — |

### 复现命令（全部只读宿主、产物只写 tmp）

```bash
export DSH_HOME='D:/DSH/tmp/host-probe/home'
cp ~/.dsh/.credentials.yaml "$DSH_HOME/.credentials.yaml"
dsh --profile probe --from-default-profile web --dump-config      # 先确认 composed 配置
dsh --profile probe --patch D:/DSH/tmp/host-probe/probe-patch.yml --no-open --port 61986
# 探测结束：按端口找 PID 后 taskkill /T /F（本次用完即杀，桌面宿主 39924 未受影响）
```

> 复现注意：`dsh --profile desktop` 被 Electron 独占管理（本文件风险 7），所以探测只能用**自建 profile**；`--patch` 插入行的 `name` 支持绝对路径/file URL/包名三种形态，绝对路径最省事。

## Phase 2 真实宿主 E2E 验证（2026-11-02，已通过）

隔离宿主：`DSH_HOME=D:/DSH/tmp/e2e-p2/home`，profile `p2`（dsh-base + dsh-web-app + 绝对路径 insert 需求插件），端口 61990，夹具仓库 `tmp/e2e-p2/repo`（REQ-DEMO-001：README TODO→DONE + CHANGELOG + 测试）。全程未触碰桌面宿主。

| 步骤 | 观察 |
|---|---|
| `POST /api/alm/requirements/start {apply:true, acknowledgeGaps:true}` | 200，`changeId` CHG-GEN-001、`applied:true`、`execution.scheduled:true`、`runId` RUN-001、`carrier:'dsh-session'` |
| 运行记录 | `.alm/runs/RUN-001.json`：`queued → running`（派单后立即置 running，不再长期显示排队）|
| 真实会话 | 同一 turn 内 64 次工具调用（读需求/brief/任务卡 → 补 `tests/readme.sdoc` → 改需求正文 → 改 README → 建 CHANGELOG → 改测试 → 登记 `.alm/acceptance/REQ-DEMO-001.json` → `node --test`）|
| 结果 | 仓库产生真实改动 `M README.md`、`M requirements/req-demo-001.sdoc`、`M test/readme.test.mjs`、`?? CHANGELOG.md`、`?? tests/`；`node --test` 2/2 通过 |
| 收尾 | turn 结束后 run 自动 `waiting-input / awaiting-human`；`GET /api/alm/requirements` → delivery `in-progress(source run)`、run `等待输入`、nextAction `run-review` |
| 幂等 | 带同一 `changeId` 再点 start → `reused:true` + `execution.reused:true (run-active)`，不新建会话 |
| 取消 | `POST /api/alm/requirements/run {mode:'cancel'}` → `cancelled:true`，run 状态 `cancelled`，工作区改动与记录保留 |

**关键实现约束（本轮实测得出）**
1. `approval: ask` 在无 UI 的宿主里会让 turn 永久挂起（首次实测就卡在 `approval/asked`）。执行会话必须在 `setup` 里 pin 权限：`session.append('sandbox/mode',{mode:'workspace-write'})` + `session.append('approval/policy',{policy:'never'})`。人类点「交给 AI 推进」即本轮授权，沙箱边界代替逐次点击。
2. `followup()` 必须传完整 user Message（含 `role` 与 `source:{kind:'user'}`）；`agents.create` 的 `setup(agentCtx, agent)` 第二个参数才拿到 Agent（`session` 在它上面）。
3. 会话日志是**多帧 zstd**：单帧解压只能看到 session 头，需按 magic 逐帧解压才能看到完整事件流（排查用）。
