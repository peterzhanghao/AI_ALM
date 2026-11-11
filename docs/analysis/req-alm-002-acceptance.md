# REQ-ALM-002 验收命令失败：根因、修复与验收

关联：REQ-ALM-002（v1）、RUN-002、DEF-REQ-ALM-002-001、FAIL-REQ-ALM-001-001（指纹 `fp_2365b66df0a297e0`）。

## 1. 结论

这次“验收命令失败”是两处证据链缺陷叠加，不是 REQ-ALM-001 的业务代码回归：

1. **执行器丢错误（alm-core）**：`runAcceptance` 把 `spawnSync` 的返回值映射成命令记录时只保留 `exitCode/timedOut/durationMs/stdout/stderr`，丢掉了 `result.error`。当命令根本没有启动（如沙箱 `spawn EPERM`）时 `exitCode` 是 `null`、`stderr` 为空，证据既不能说清“为什么没跑”，也无法与“超时”区分。
2. **监控器读错形状（插件）**：`monitorAcceptanceFailure` 按一套并不存在的 payload 读取失败命令（`payload.commands[].result === 'fail'`、`entry.logPath`、`payload.file`），而 `runAcceptance` 实际返回的是 `{ result: 'fail', evidencePath, evidence: { commands: [{ exitCode, timedOut, ... }] } }`。于是失败命令列表为空，`logs`/`artifacts` 全空——正是 `.alm/failures/FAIL-REQ-ALM-001-001.json` 里看到的形状。
3. **测试随实现一起错**：`packages/dsh-plugin-requirements/test/defect-api.test.mjs` 用虚构 payload（`result: 'fail'` + `logPath`）验证监控器，所以上述错位没有被测试发现。

## 2. 修复内容

| 位置 | 改动 |
| --- | --- |
| `packages/alm-core/src/acceptance/acceptance.mjs` | 新增 `commandRunRecord()`：记录 `exitCode/timedOut/spawnFailed/error{code,message}/durationMs/signal`；`runAcceptance` 用 try/catch 包住 `exec`，判定失败时把 `error` 也算进去。 |
| `packages/dsh-plugin-requirements/index.js` | `monitorAcceptanceFailure` 改读真实返回（`evidence.commands` 优先，兼容旧 `payload.commands`），写入失败命令诊断日志、`artifacts: [{path: evidencePath, kind: 'acceptance-evidence'}]`、`snapshot {headSha, failedCommands[]}`、`context {failedCommands, timedOut, errorCodes, evidencePath}`。 |
| `packages/dsh-plugin-requirements/client.js` | 验收失败面板展示命令 `error`，把“无法启动（EPERM）”与“超时”分开；建议文案针对无法启动给出可操作提示。 |
| 测试 | 新增 `packages/alm-core/test/unit/acceptance-command-record.test.mjs`（5 个纯测试，不 spawn）；`defect-api.test.mjs` 改为真实 `runAcceptance` 形状并断言证据内容（3 条断言覆盖 logs/artifacts/snapshot）。 |

失败事件的指纹算法不变，因此“同一指纹不再出现”仍然对应“同一需求/阶段/错误类型再次产生验收失败事件”，与本修复兼容。

## 3. 验收方式（已登记）

`.alm/acceptance/REQ-ALM-002.json`：

```json
{
  "schema": "alm.acceptance.config/v1",
  "requirement": "REQ-ALM-002",
  "commands": [
    {
      "id": "defect-regression",
      "command": [
        "node", "--test",
        "packages/alm-core/test/unit/acceptance-command-record.test.mjs",
        "packages/dsh-plugin-requirements/test/defect-api.test.mjs"
      ],
      "timeoutMs": 120000
    }
  ]
}
```

`requirements/req-alm-002.sdoc` 已补 `verified_by` → `TEST-ALM-005`（命令记录保留 spawn/超时信息）与 `TEST-ALM-006`（失败事件携带真实证据并生成缺陷），测试资产见 `tests/REQ-ALM-002.sdoc`。

## 4. 本会话已留证据

```text
$ node --test --test-isolation=none \
    packages/alm-core/test/unit/acceptance-command-record.test.mjs \
    packages/dsh-plugin-requirements/test/defect-api.test.mjs
tests 17 / pass 17 / fail 0 / exit 0
```

同一条命令按登记原样（默认隔离）在本会话执行会立即失败，因为沙箱禁止 node 启动子进程：

```text
$ node --test packages/alm-core/test/unit/acceptance-command-record.test.mjs packages/dsh-plugin-requirements/test/defect-api.test.mjs
Error: spawn EPERM  (errno -4048, code 'EPERM', syscall 'spawn', at node:internal/test_runner/runner:521)
exit 1
```

这不是测试失败，而是 RUN-001 已记录的会话限制：`node --test` 默认隔离会 spawn 测试子进程，本会话 `spawnSync`/`spawn` 一律 EPERM；验收执行器本身还依赖 `execFileSync('git')` 取 HEAD，同样 EPERM，所以本会话内无法由 runner 生成 `.alm/acceptance/REQ-ALM-002/<sha>.json`。

## 5. 手工验收步骤（在允许启动子进程的宿主执行）

1. 在宿主终端（或验收面板“运行验收”）执行已登记命令：
   `node --test packages/alm-core/test/unit/acceptance-command-record.test.mjs packages/dsh-plugin-requirements/test/defect-api.test.mjs`
   期望：`fail 0`、`exit 0`，证据 `result: pass`，`context.verifiedBy` 含 `TEST-ALM-005/006`，`testRevision` 与当前测试资产一致。
2. 复核历史证据：打开 `.alm/acceptance/REQ-ALM-001/<headSha>.json` 的旧记录，确认其中的失败命令现在会带 `error`（新跑出来的失败才会带；旧证据保持只读）。
3. 重跑 REQ-ALM-001 的验收（命令范围见 `.alm/runs/RUN-002-decision.md`），确认不再产生 `fp_2365b66df0a297e0` 的新失败事件；如仍失败，检查新 `FAIL-*` 的 `evidence.logs` 是否已包含失败命令与原因（而不是空数组）。
4. 人工确认修复后，把 `DEF-REQ-ALM-002-001` 从 `verifying` 推到 `awaiting-acceptance` 再 `closed`（现有设计里关闭缺陷需要人工状态变更），并把 RUN-002 收口为 `done`。

## 6. 已知限制与未决问题

- 本会话无法触发宿主验收 API（需要 `dsh web` 认证）与验收 runner（git EPERM），自动化证据以 in-band 等价方式给出，最终 `alm.acceptance/v2` 证据需宿主重跑。
- REQ-ALM-001 的验收命令仍是整仓 `node --test`，`tmp/` 脚手架会让它超时/扫出无关失败；是否把命令限定到需求对应测试文件需要人拍板（见 RUN-002 决策请求）。
- 测试隔离缺陷（另一个问题，未修）：`packages/dsh-plugin-requirements/test/http.test.mjs` 直接对 `fixtures/order-refund` 发起写请求，沙箱内 OCR/写操作失败会把 failure 记录写进 fixture，污染后续 `failure.test.mjs`。本会话已清理残留的 `fixtures/order-refund/.alm/failures/*.json`，根因另立任务处理。
