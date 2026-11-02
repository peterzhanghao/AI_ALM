# 需求删除：为什么删了还会回来

## 现象

用户在需求插件里删除/归档了几条记录，重启 DSH 后它们又出现在「待评审」列表（`REQ-DAN-001`、`REQ-COV-001`、`REQ-DUP-001` 等）。同时列表里混入了大量 `REQ-*` 反例记录。

## 两个独立原因

1. **列表扫描全仓**：`query.requirements(root)` 直接使用 `indexReport` 的全仓资产，`fixtures/negative/*`、`fixtures/order-refund/*` 等测试 fixture 都被当成可管理需求。它们不随用户删除而消失，因为用户删除的从来不是这些 fixture 文件。
2. **归档被回滚**：仓库内的 `.alm/audit/requirements/` 有 `REQ-COV-001`、`REQ-DAN-001`、`REQ-DUP-001` 的归档审计；但随后一次清理测试污染的 `git checkout -- fixtures/negative/*/req.yml` 把用户写回文件里的 `status: archived` 一并还原成 `proposed`。重启后自然回到待评审。
   教训：不要把可能承载用户操作的 fixture 文件整文件 checkout 回滚。

## 修复

### 列表按项目需求根收敛

`packages/dsh-plugin-requirements/query.mjs`：读取 `.alm/project.json` 的 `requirementRoot`（缺省 `requirements`），只把该目录下的资产当需求；没有项目文件也没有 `requirements/` 目录的旧工程继续扫描全仓，保持兼容。

### 真正可用的删除

- `packages/alm-core/src/requirements/remove.mjs`：`planRemove` / `applyRemove`。
  - 预览与落地分离，落地要求 `expectedBaseline`（CAS）与 `actor`，预览后文件变化返回 `stale-preview`。
  - 删除前把删除前全文、基线、原因、幂等键写入 `.alm/audit/requirements/<REQ>-<stamp>-remove-<key>.json`（`kind: remove`，可据此恢复）。
  - 单一需求文件整文件删除；一个 sdoc 里有多条需求时只删除目标 `[REQUIREMENT]` 块，保留其余记录。
- `packages/dsh-plugin-requirements/index.js`：新增 `POST /api/alm/requirements/remove`，预览/落地复用 `archiveContext` 精确定位文件。
- 客户端入口（抽屉/列表行「删除」、`RemoveModal`）随后续 UI PR 接入；本 PR 先提供可用的 API 与审计语义。

## 验证

- `packages/alm-core/test/unit/requirement-remove.test.mjs` 5/5：共享 sdoc 只删目标块、单文件删除、审计写入、`stale-preview`、缺 actor 拒绝。
- `packages/dsh-plugin-requirements/test/remove-http.test.mjs` 3/3：HTTP 预览不落盘、apply 删除并写审计、stale 409、未知需求 404。
- 本次 PR 提交前：`node --test --test-isolation=none` 相关子集 36/36。
- 客户端探针（`tmp/ui-harness/ui-remove.mjs` 12/12、真实端到端 `tmp/ui-remove-e2e.mjs` 11/11）随 UI PR 验证。

## 生效条件

`query.mjs` 与 `index.js` 属于宿主已加载模块，需重启 DSH 宿主（仅刷新页面不够）。重启后 `D:/DSH` 列表只剩 `requirements/` 下的 `REQ-ALM-001`，fixture 记录不再出现；删除接口已可用，客户端「删除」入口随 UI PR 出现。
