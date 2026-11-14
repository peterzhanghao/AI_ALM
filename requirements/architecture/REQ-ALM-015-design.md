# REQ-ALM-015 架构与数据模型交付档案

## 需求与版本基线
- 需求：REQ-ALM-015 · v1 · 需求列表默认显示待我处理tab页面
- 核心业务目标：按已确认需求完成交付

## 架构与模块变更
- `requirements/req-alm-015.sdoc`：需求规格与工程资产
- `requirements/briefs/REQ-ALM-015.md`：需求规格与工程资产
- `package.json`：本需求交付涉及的实现模块
- `packages/alm-core/src/acceptance/acceptance.mjs`：需求领域模型、验证与交付状态
- `packages/alm-core/src/intent/analysis.mjs`：需求领域模型、验证与交付状态
- `packages/alm-core/src/intent/confirm.mjs`：需求领域模型、验证与交付状态
- `packages/alm-core/src/intent/messages.mjs`：需求领域模型、验证与交付状态
- `packages/alm-core/src/requirements/arch-ledger.mjs`：需求领域模型、验证与交付状态
- `packages/alm-core/src/requirements/blueprint-guard.mjs`：需求领域模型、验证与交付状态
- `packages/alm-core/src/requirements/candidate.mjs`：需求领域模型、验证与交付状态
- `packages/alm-core/src/requirements/convergence.mjs`：需求领域模型、验证与交付状态
- `packages/alm-core/src/requirements/create.mjs`：需求领域模型、验证与交付状态
- `packages/alm-core/src/requirements/dev-branch-sync.mjs`：需求领域模型、验证与交付状态
- `packages/alm-core/src/requirements/exchange-xlsx.mjs`：需求领域模型、验证与交付状态
- `packages/alm-core/src/requirements/exchange-zip.mjs`：需求领域模型、验证与交付状态
- `packages/alm-core/src/requirements/exchange.mjs`：需求领域模型、验证与交付状态
- `packages/alm-core/src/requirements/release.mjs`：需求领域模型、验证与交付状态
- `packages/alm-core/src/requirements/run.mjs`：需求领域模型、验证与交付状态
- `packages/alm-core/src/requirements/worktree-snapshot.mjs`：需求领域模型、验证与交付状态
- `packages/alm-core/test/unit/acceptance-config.test.mjs`：需求领域模型、验证与交付状态
- `packages/alm-core/test/unit/acceptance.test.mjs`：需求领域模型、验证与交付状态
- `packages/alm-core/test/unit/candidate-dev-sync.test.mjs`：需求领域模型、验证与交付状态
- `packages/alm-core/test/unit/intent-analysis.test.mjs`：需求领域模型、验证与交付状态
- `packages/alm-core/test/unit/intent-confirm-v5.test.mjs`：需求领域模型、验证与交付状态
- `packages/alm-core/test/unit/intent-doc-draft.test.mjs`：需求领域模型、验证与交付状态
- `packages/alm-core/test/unit/plugin-pages.test.mjs`：需求领域模型、验证与交付状态
- `packages/alm-core/test/unit/release.test.mjs`：需求领域模型、验证与交付状态
- `packages/alm-core/test/unit/requirements-create.test.mjs`：需求领域模型、验证与交付状态
- `packages/alm-core/test/unit/requirements-exchange-xlsx.test.mjs`：需求领域模型、验证与交付状态
- `packages/alm-core/test/unit/requirements-exchange.test.mjs`：需求领域模型、验证与交付状态
- `packages/alm-core/test/unit/run.test.mjs`：需求领域模型、验证与交付状态
- `packages/alm-core/test/unit/worktree-snapshot.test.mjs`：需求领域模型、验证与交付状态
- `packages/dsh-plugin-requirements/README.md`：DSH 插件接口与用户视图
- `packages/dsh-plugin-requirements/acceptance-registry.mjs`：DSH 插件接口与用户视图
- `packages/dsh-plugin-requirements/ai-draft.mjs`：DSH 插件接口与用户视图
- `packages/dsh-plugin-requirements/bin/crystallize.mjs`：DSH 插件接口与用户视图
- `packages/dsh-plugin-requirements/client-source.js`：DSH 插件接口与用户视图
- `packages/dsh-plugin-requirements/client.js`：DSH 插件接口与用户视图
- `packages/dsh-plugin-requirements/detail-view.mjs`：DSH 插件接口与用户视图
- `packages/dsh-plugin-requirements/exchange.mjs`：DSH 插件接口与用户视图
- `packages/dsh-plugin-requirements/host.bundle.js`：DSH 插件接口与用户视图
- `packages/dsh-plugin-requirements/index.js`：DSH 插件接口与用户视图
- `packages/dsh-plugin-requirements/intake.mjs`：DSH 插件接口与用户视图
- `packages/dsh-plugin-requirements/intent.mjs`：DSH 插件接口与用户视图
- `packages/dsh-plugin-requirements/preflight.mjs`：DSH 插件接口与用户视图
- `packages/dsh-plugin-requirements/query.mjs`：DSH 插件接口与用户视图
- `packages/dsh-plugin-requirements/render.mjs`：DSH 插件接口与用户视图
- `packages/dsh-plugin-requirements/test/acceptance-config-http.test.mjs`：DSH 插件接口与用户视图
- `packages/dsh-plugin-requirements/test/ai-draft.test.mjs`：DSH 插件接口与用户视图
- `packages/dsh-plugin-requirements/test/auto-advance.test.mjs`：DSH 插件接口与用户视图
- `packages/dsh-plugin-requirements/test/automatic-verification.test.mjs`：DSH 插件接口与用户视图
- `packages/dsh-plugin-requirements/test/blueprint-guard.test.mjs`：DSH 插件接口与用户视图
- `packages/dsh-plugin-requirements/test/clarification-ui.test.mjs`：DSH 插件接口与用户视图
- `packages/dsh-plugin-requirements/test/decision-lifecycle.test.mjs`：DSH 插件接口与用户视图
- `packages/dsh-plugin-requirements/test/default-view.test.mjs`：DSH 插件接口与用户视图
- `packages/dsh-plugin-requirements/test/defect-api.test.mjs`：DSH 插件接口与用户视图
- `packages/dsh-plugin-requirements/test/description-v5.test.mjs`：DSH 插件接口与用户视图
- `packages/dsh-plugin-requirements/test/detail-v4-ui.test.mjs`：DSH 插件接口与用户视图
- `packages/dsh-plugin-requirements/test/detail-view.test.mjs`：DSH 插件接口与用户视图
- `packages/dsh-plugin-requirements/test/exchange-download.test.mjs`：DSH 插件接口与用户视图
- `packages/dsh-plugin-requirements/test/exchange-http.test.mjs`：DSH 插件接口与用户视图
- `packages/dsh-plugin-requirements/test/execution.test.mjs`：DSH 插件接口与用户视图
- `packages/dsh-plugin-requirements/test/human-detail.test.mjs`：DSH 插件接口与用户视图
- `packages/dsh-plugin-requirements/test/intent-fast-path.test.mjs`：DSH 插件接口与用户视图
- `packages/dsh-plugin-requirements/test/intent-http.test.mjs`：DSH 插件接口与用户视图
- `packages/dsh-plugin-requirements/test/lifecycle.test.mjs`：DSH 插件接口与用户视图
- `packages/dsh-plugin-requirements/test/list-query-axes.test.mjs`：DSH 插件接口与用户视图
- `packages/dsh-plugin-requirements/test/living-spec.test.mjs`：DSH 插件接口与用户视图
- `packages/dsh-plugin-requirements/test/preflight.test.mjs`：DSH 插件接口与用户视图
- `packages/dsh-plugin-requirements/test/project-context.test.mjs`：DSH 插件接口与用户视图
- `packages/dsh-plugin-requirements/test/render.test.mjs`：DSH 插件接口与用户视图
- `packages/dsh-plugin-requirements/test/run-observation-ui.test.mjs`：DSH 插件接口与用户视图
- `packages/dsh-plugin-requirements/test/start-execution.test.mjs`：DSH 插件接口与用户视图
- `packages/alm-core/src/requirements/delivery-scope.mjs`：需求领域模型、验证与交付状态
- `packages/alm-core/test/unit/delivery-scope.test.mjs`：需求领域模型、验证与交付状态
- `packages/dsh-plugin-requirements/github-web.mjs`：DSH 插件接口与用户视图
- `packages/dsh-plugin-requirements/test/exchange-render.test.mjs`：DSH 插件接口与用户视图
- `packages/dsh-plugin-requirements/test/exchange-ui.test.mjs`：DSH 插件接口与用户视图
- `packages/dsh-plugin-requirements/test/github-web.test.mjs`：DSH 插件接口与用户视图
- `requirements/architecture/REQ-ALM-015-design.md`：需求规格与工程资产

调用关系：需求规格与验收标准 → 领域实现与插件交互 → 定向验证证据 → 交付候选。

## 数据模型与接口契约
- 数据结构或接口契约定义（保持向后兼容）
- 运行态证据、候选和签收仍存放于 `.alm/`，不改变既有读取兼容性。

## 验证与证据摘要
- 未解析到结构化验收标准。
- 最近验证：通过
