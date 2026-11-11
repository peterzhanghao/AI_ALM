# RUN-001 决策请求：REQ-ALM-001 验收命令与门禁证据边界

- 日期：2026-11-02
- 需求：REQ-ALM-001（v1）
- 变更：CHG-ALM-001
- 运行：RUN-001
- 状态：实现与验收资产已完成；验收命令与 TASK-ALM-003 的门禁期望受环境/历史债务影响，需要人类裁决

## 1. 问题

### A. 验收命令 `node --test` 在本会话不可执行

当前 DSH 会话的 shell 沙箱禁止创建子进程，`node --test` 在按文件隔离时会为每个测试文件 spawn 一个 node 子进程，因此必然失败：

```text
Error: spawn EPERM
    errno: -4048, code: 'EPERM', syscall: 'spawn'
    at ChildProcess.spawn (node:internal/child_process:457:11)
```

同一限制使 `node -e "execSync('git --version')"` 返回 `spawnSync C:\Windows\system32\cmd.exe EPERM`。这不是仓库代码问题：`node --test --test-isolation=none`（单进程内跑）可以通过，但该参数不改变验收命令，且插件测试里凡调用 `execFileSync('git')` 的用例仍会 EPERM。

完整输出已留档：`.alm/evidence/CHG-ALM-001/node-test.log`。

### B. 字面 `node --test` 还会收集 `tmp/` 下的临时测试

`node --test` 不带路径时按默认模式递归发现 `**/*.test.mjs`，仓库内 `tmp/req-list`（一个 linked git worktree）、`tmp/fix-intake-test.mjs`、`tmp/inv-fixture/**` 等前序会话脚手架的测试也会被收集。历史验收证据（`.alm/acceptance/REQ-ALM-001/64ec15e….json`）显示 1469 个测试中 14 个失败全部来自 `tmp/`。即使宿主机允许 spawn，只要 `tmp/` 还在，字面 `node --test` 也会失败。

`tmp/` 被 `.gitignore` 忽略，且 `tmp/req-list` 是 `git worktree add` 注册的链接工作树（`git worktree list` 可见），直接删除目录会留下 stale worktree 元数据；删除属于不可逆操作，我没有擅自执行。

### C. TASK-ALM-003 的 `alm check --base … exit 0` 当前不可达

`alm check --root .` 在基线 64ec15e 上就失败：`checkReport`（`packages/alm-core/src/commands.mjs:72`）只要解析层有错误就短路，规则门禁（含 COV-001）根本不会运行。实测 `checkReport('D:/DSH')` 返回：

```json
{ "result": "fail", "summary": { "assets": 30, "errors": 72 },
  "checks": [ { "id": "FMT-001", "status": "fail" }, { "id": "FMT-002", "status": "fail" } ] }
```

失败来源与 REQ-ALM-001 无关，是仓库既有的文档格式债务：

- `docs/**/*.md`、`archive/v2-gitlab-skills/**/*.md` 等缺少 YAML frontmatter（FMT-001）
- `packages/alm-skills/**/SKILL.md` 等 frontmatter 缺 `id` 等必填（FMT-002）
- `pnpm-lock.yaml`、`pnpm-workspace.yaml`、`packages/*/cordis.patch.yml` 不是资产映射（FMT-001）
- `fixtures/negative/**` 是刻意的反例样例（FMT-001）

要让整仓 `alm check` 退出 0，需要改数十个与本次需求无关的文件（当前 72 条解析错误），或改门禁短路口径，两者都超出 CHG-ALM-001 的授权范围。

## 2. 为什么现在需要人决定

- TASK-ALM-003 的 acceptance 是“`alm check --base 64ec15e6 --out .alm/evidence/CHG-ALM-001.json` exit 0”，按字面无法在不动仓库历史债务的前提下完成；我不能通过删改验收条件来“通过”。
- 验收命令是需求文件指定的 `node --test`，我无法在本会话内真跑成功；能给的最近等价证据是单进程测试 + 分片复跑。是否接受这一证据口径，需要人来定。
- `tmp/` 脚手架的清理涉及删除 linked worktree，属于不可逆操作。

## 3. 推荐选项与影响

### 选项 A（推荐）：接受“范围内门禁证据”，把仓库级债务另立变更

保持验收条件不变，但用**干净临时工程**验证 REQ-ALM-001 相关的全部门禁：

- 把 `requirements/req-alm-001.sdoc`、`requirements/briefs/REQ-ALM-001.md`、`tests/REQ-ALM-001.sdoc`、`.alm/project.json` 复制到临时目录，直接调用与 CLI 相同的 `checkReport()`；
- 正向：`result: pass`，COV-001 / COV-002 / REL-001 / REL-002 / REL-003 / PRJ-001 / BRIEF-001 全部 pass；
- 反向：删掉 `verified_by` 后 `result: fail`，COV-001 在 `requirements/req-alm-001.sdoc:7` 报 `requirement has no verified_by acceptance test`。

证据已生成：`.alm/evidence/CHG-ALM-001/scoped-gates.json`（脚本 `tmp/verify-gates.mjs`）。

影响：CHG-ALM-001 的“本需求门禁通过”有可复现证据；但整仓 `alm check` 仍为 fail，需要单独变更（如 CHG-ALM-00X「仓库文档资产格式治理」）偿还 FMT 债务。TASK-ALM-003 的验收文字建议改为“范围内的 checkReport 证据 + 全仓债务清单”。

### 选项 B：整仓 FMT 债务清理（范围扩张，高风险）

给 `docs/**`、`archive/**`、`packages/alm-skills/**` 等批量补 frontmatter，处理 `pnpm-lock.yaml` / `cordis.patch.yml` / `fixtures/negative/**` 的资产发现规则。影响：一次改上百文件，diff 巨大、评审成本高，且会触碰本需求之外的资产；建议单独立项而不是塞进 CHG-ALM-001。

### 选项 C：改 `checkReport` 的解析错误短路（治理口径变更）

让规则门禁在存在 FMT 错误时仍运行，或对 `fixtures/negative/**`、锁文件等做豁免。影响：改变所有仓库的门禁语义，属于产品/治理决策，不应由交付执行器单方决定。

### 关于 `tmp/` 与验收命令

- 若要在宿主机上真跑 `node --test`：先 `git worktree remove tmp/req-list`（以及清理 `tmp/fix-intake-test.mjs`、`tmp/inv-fixture`），或改用仓库自带脚本 `pnpm test`（glob 限定 `packages/*/test/**/*.test.mjs`）。是否需要我清理这些脚手架，请确认。
- 本会话可执行的等价验证：`node --test --test-isolation=none "packages/*/test/**/*.test.mjs"`，以及逐文件运行；git 相关用例仍因 spawn 限制失败。

## 4. 等待期间我还能做什么

- 继续补齐不依赖 spawn 的测试（已完成：`packages/dsh-plugin-requirements/test/query-sort.test.mjs` 4/4 pass）。
- 准备宿主机验收命令清单与预期输出，供人类在放行沙箱/本机执行时一次跑完。
- 如果选择选项 A，把 TASK-ALM-003 的验收文字与证据路径对齐，并登记全仓 FMT 债务清单。
- 如果选择选项 B/C，先产出影响面清单（文件数、规则分布），再等授权实施。
