# 升级与兼容

> 适用：`@ai-alm/alm-core` 0.1.0、`@ai-alm/alm-scm` 0.1.0、三个 DSH 插件与四个产品技能。
> 目标：升级不破坏已发布的基线与证据；旧基线始终可重建校验。

## 1. 版本面

| 对象 | 位置 | 当前值 | 变更影响 |
|---|---|---|---|
| CLI / core | `packages/alm-core/package.json` | `0.1.0` | 命令面与行为；`alm --version` 输出 |
| SCM 适配器 | `packages/alm-scm/package.json` | `0.1.0` | 合并策略与本地 git 行为 |
| 资产契约 | `src/contracts/asset.schema.json` | `alm.asset/v1` | 解析与索引形状 |
| 证据契约 | `evidence.schema.json` | `alm.evidence/v1` | 门禁证据、`runId` |
| 审批契约 | `approval.schema.json` | `alm.approval/v1` | 审批记录与绑定 SHA |
| 基线契约 | `baseline.schema.json` | `alm.baseline/v1` | 清单与 `contentHash` |
| 发现契约 | `finding.schema.json` | `alm.finding/v1` | 门禁 finding 形状 |
| 规则包 | `src/gates/pack.json` | `1.1.0` | 门禁结论；CI 记录按包版本分文件 |
| 插件 | 三个 `dsh-plugin-*` 的 `package.json` | `0.1.0` | 路由、工具 schema、slot |

## 2. 兼容规则

1. **JSON 只增不改**：`alm.*/v1` 里新增可选字段不升版本；删除/改语义必须新开 `v2` 并双读一个发布周期。
2. **规则包独立版本**：`pack.json.version` 变化即视为不同门禁；`.alm/ci/<sha>/<packVersion>.json` 按包版本分目录，旧记录不会冒充新结论。
3. **证据不可复用**：`ci record` 校验 `rules.packVersion` 与服务端复跑结果；不一致直接拒绝。
4. **基线内容寻址**：`contentHash` 只覆盖 `{path, sha256, size}` 排序后的清单，不含时间戳；升级后重建同一 commit 必须得到相同哈希。
5. **发布写一次**：`release publish` 已存在且 `bundleSha256`/`contentHash` 不同则拒绝；升级不提供“覆盖发布”的能力。
6. **插件契约**：工具名与参数按 `alm_*` 稳定；新增工具必须同时更新 `references/permissions.md` 的声明，否则 `check-alm-skill` 失败。

## 3. 规则包升级流程

1. 新增/修改规则文件与 `pack.json`（升 `version`）。
2. 为该规则补正例 + 反例测试；`alm check` 在样例仓库仍退出 0。
3. 用新包重跑 `alm ci run`；旧记录保留在旧版本目录，`ci status` 只认当前包版本。
4. 更新 `docs/planning/architecture.md` 的规则表与 `packages/alm-skills/alm-requirements`（或对应技能）的失败修复表。
5. 发布基线时记录新 `packVersion`；验证报告引用该版本。

## 4. 升级步骤（本地 MVP）

```powershell
# 0. 准备：确认没有进行中的变更新增
git status --short
node packages/alm-core/bin/alm.mjs workspace status --json

# 1. 备份本地状态（证据/基线/发布/CI 记录）
Copy-Item .alm .alm.backup -Recurse -Force

# 2. 升级依赖与代码
pnpm install --frozen-lockfile
node packages/alm-core/bin/alm.mjs contract verify      # 期望 contracts: ok

# 3. 回归
node --test "packages/*/test/**/*.test.mjs"             # 期望 0 fail
node packages/alm-core/bin/alm.mjs check --root fixtures/order-refund   # 期望 pass

# 4. 旧基线仍可校验（关键兼容断言）
node packages/alm-core/bin/alm.mjs baseline verify --manifest .alm/baselines/<BL>.json
node packages/alm-core/bin/alm.mjs release verify --baseline <BL>
```

任一步失败：用 `.alm.backup` 回退，并按失败项判断是契约破坏还是规则包不兼容。

## 5. 回滚

- 发布级回滚：`alm release rollback --to <旧BL>`（先校验目标，只移动 `current.json`，保留历史）。
- 代码级回滚：`git revert` 到上一个通过验证的 commit，然后重跑第 4 步的基线与发布校验。
- 规则包回滚：恢复 `pack.json` 与规则文件；CI 记录按包版本隔离，不需要删除新记录。

## 6. 兼容矩阵

| 变更 | 需要升版本 | 旧基线可校验 | 备注 |
|---|---|---|---|
| 新增可选字段 | 否 | ✅ | 双读旧数据 |
| 删除/改字段语义 | 是（v2） | ✅（读旧 schema） | 一个发布周期内双读 |
| 新增门禁规则 | 规则包 | ✅ | 新规则只对新门禁结论生效 |
| 放宽门禁规则 | 规则包 | ✅ | 需要评审；不能掩盖历史失败 |
| 存储目录结构变化 | 是 | ⚠️ 需迁移脚本 | 当前未发生；迁移必须幂等 |
| 插件工具改名 | 插件版本 | 不受影响 | 同步改技能声明 |

## 7. 检查命令

```powershell
node packages/alm-core/bin/alm.mjs contract verify
node packages/alm-core/bin/alm.mjs --version
node scripts/check-alm-skill.mjs
node packages/alm-core/bin/alm.mjs baseline verify --manifest .alm/baselines/<BL>.json
node packages/alm-core/bin/alm.mjs release verify --baseline <BL>
```
