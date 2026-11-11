# 「关闭归档」无反应（HTTP 404）修复记录

日期：2026-10-31 · 分支：`feat/alm-09-14-intent-paste-latency`（工作区改动未提交）

## 1. 用户报告与复现

用户截图：在需求列表点击行内归档图标 → 弹出「关闭归档 · REQ-DUP-001」→ 正文下方红字 `HTTP 404`，点「确认关闭归档」无反应。

复现（桌面宿主 61773，root 指向含 `fixtures/negative/duplicate-id/*.yml` 的仓库）：

1. 运行中的宿主仍是旧插件，`/api/alm/requirements/archive` 未注册，宿主对未注册的 `/api/alm/*` 路径直接返回 401/404 且不是 JSON；客户端 `postJson` 只能显示 `HTTP 404`。
2. 即使路由已注册，`REQ-DUP-001` 的两条记录是 **YAML 资产**（`fixtures/negative/duplicate-id/req-a.yml`、`req-b.yml`），而原 `planArchive` 只会改写 sdoc 的 `[REQUIREMENT]` 块，返回 `file-invalid: cannot find [REQUIREMENT] REQ-DUP-001 in the source file`。
3. 后端 `reviewContext(root, id)` 用 `assets.find(entry => entry.id === id)` 取第一条；重复 UID 时归档目标不确定，两个文件会被随机挑一个。

结论：这是三个真实缺陷叠加（旧插件路由 + YAML 不支持 + 重复 UID 目标不确定），不是纯前端按钮问题。

## 2. 修复

### 2.1 核心：YAML 需求也能归档

新增 `packages/alm-core/src/requirements/archive-yaml.mjs`：

- `isYamlAsset(asset)`：按 `source.format` / 路径判断 YAML 资产。
- `planArchiveYaml({ root, asset, reason })`：校验文件内 `id` 与资产一致、存在 `status` 行、状态可归档、未归档；只改 `status: archived` 与 `revision`（有则替换、无则插入到 status 行后）；返回与 sdoc 版同形的 `alm.requirement.archive/v1`（`file/format/status/revision/baseline/before/after`），不写盘。
- `applyArchiveYaml({ root, asset, expectedBaseline, actor, reason, idempotencyKey, writeFile })`：actor 必填、基线 CAS（`stale-preview` 409）、幂等重放、审计写入 `.alm/audit/requirements/`、临时文件 + rename 原子替换、失败回滚、返回 `applied/idempotent/file/status/revision/auditFile/evidenceStale`。

共用 `archive.mjs` 已有的 `ARCHIVE_SCHEMA / ArchiveError / normalizeReason / revisionOf / ARCHIVABLE_STATUSES`，保证与 sdoc 归档同一契约与错误码。

### 2.2 插件：按 id + file 精确定位

`packages/dsh-plugin-requirements/index.js`：

- 新增 `archiveContext(root, requirementId, file)`：给了 `file` 则精确匹配，找不到再判断该文件是否已包含该 id 且 `status: archived`（重试/双击场景返回幂等成功）；未给 `file` 且同 ID 多条 → 409 `ambiguous-requirement` 并返回 `candidates`；单条直接返回。
- archive 分支按 `isYamlAsset` 分派到 YAML / sdoc 两套 plan/apply。
- 新增 `archivedFileFor(root, file, id)`：避免归档完成后第二次请求变成 404。

### 2.3 客户端

`packages/dsh-plugin-requirements/client.js`：

- preview / apply / stale 重读三处请求都带 `file: item.file`（列表 `data-req` 已经是 uid+file 唯一键）。
- `postJson` 对非 JSON 响应给出可操作文案：`接口不存在（HTTP 404）：需求插件可能尚未重载，请刷新页面或重启宿主后再试。`
- 回执区分 `alreadyArchived`：显示“该需求已在之前完成归档，本次请求未重复写入。”
- 修正文案：归档后记录仍在需求文件中可追溯、移出活跃列表（不再承诺列表内“仍可查看”，因为索引默认不返回 archived 记录）。

## 3. 验证

| 层次 | 证据 |
| --- | --- |
| 单元测试 | `node --test packages/alm-core/test/unit/archive-yaml.test.mjs` → 7/7；覆盖 plan 只改目标文件、apply 只归档指定记录且同 UID 另一条不动、审计、幂等重放、stale-preview、actor/baseline 必填、already-archived、id 不一致 |
| 全仓测试 | `pnpm test` → 406/406 pass |
| 真实宿主（61773，插件已 reload） | 未给 file → 409 `ambiguous-requirement`（2 条候选）；带 file → preview 200（`format: yaml`、`proposed → archived`、baseline）；apply 200（`req-b.yml` 变 `status: archived`、`revision: 2`、审计文件写入，`req-a.yml` 保持 proposed）；同幂等键重放 200 `idempotent: true, alreadyArchived: true` |
| sdoc 回归 | 复制 `fixtures/order-refund` 后归档 `REQ-PAY-004` → apply 200、`revision: 3`，sdoc 路径未被 YAML 支持破坏 |
| 真实浏览器（Playwright + 真实 client.js + live API） | `tmp/ui-harness/ui-archive.mjs` → 11/11：两条重复记录都在；行键 uid+file 精确；预览显示 `requirements/req-b.yml` 与 `proposed → archived（已归档）`；确认后显示成功回执而非 HTTP 404；目标文件 archived+revision 2；另一条不动；审计存在；关闭后列表只剩 1 条活跃记录；无控制台错误。截图 `tmp/ui-shots-archive/{01-preview,02-receipt}.png` |

## 4. 安装与生效状态

- 插件层已通过 `plugin_manager set_bundle`（`@ai-alm/dsh-plugin-requirements` disable → enable）重载，archive 路由与 YAML 分派在桌面宿主 61773 生效。
- 客户端 `client.js` 属于页面脚本：**需要刷新需求页**（或重开页面）才能拿到新 bundle；本次浏览器验收用的是重新 esbuild 打包的真实 client.js。
- 宿主未重启，`packages/alm-core` 已有模块缓存对旧模块仍生效，但本次新增的 `archive-yaml.mjs` 是插件路径首次 import，实测已加载并工作。

## 5. 未验证 / 已知限制

- 「已归档」筛选标签目前仍为空：`indexReport` 默认不返回 archived 记录，列表 API 也没有 include-archived 参数；这是既有数据口径限制，本次未扩大范围。归档记录可在需求文件中追溯（YAML/sdoc），文案已按实际行为修正。
- 桌面 GUI 内的真实点击未直接操作（宿主页面需要 token），使用同一份真实 client.js + 真实 API 的浏览器 harness 验收；需要在刷新后的真实窗口再点一次确认。
- 未 commit、未 push、未重启宿主。
