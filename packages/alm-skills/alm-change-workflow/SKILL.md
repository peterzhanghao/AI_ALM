---
name: alm-change-workflow
description: "在 ALM 仓库内完成一次可评审的变更：从基线建工作区、改需求/架构/验收资产、跑确定性门禁、生成差异与影响、落证据。用户要改 ALM 资产、建变更分支或跑 alm check 时使用。"
whenToUse: "已有 ALM 仓库（含 requirements/、architecture/、adr/、tests/ 等资产目录），需要从基线建立变更、修改资产、验证并输出证据时。"
metadata:
  version: "0.1.0"
  owner: "peterzhanghao"
  repo: "peterzhanghao/AI_ALM"
  updated: "2026-10-23"
---

# ALM 变更工作流

## 0. 边界

- 适用于**业务仓库**里的资产变更；本技能随样例仓库安装到 `.dsh/skills/`。
- 不做审批、发布、改门禁规则、改分支保护；这些永远由人完成。
- 不提交 Git、不开 PR、不合并；只产出工作区内的改动与证据，交给人评审。
- 命令与退出码见 [`references/commands.md`](references/commands.md)，权限见 [`references/permissions.md`](references/permissions.md)。

## 1. 红线

| 禁止 | 原因 |
|---|---|
| 批准/拒绝变更、发布基线、移动发布指针 | 审批主体是人 |
| 修改 `.alm/` 规则、`gates/pack.json`、CI 配置 | 规则不可由被检查者改写 |
| 写入白名单外路径（`docs/`、根文件、绝对路径、`..`） | 工作区边界 |
| 把门禁失败说成通过，或用 AI 结论覆盖 `result` | 确定性优先 |
| 在未打开变更时直接改资产 | 变更集缺失，无法评审 |

## 2. 流程

### 2.1 确认根目录与基线

```powershell
git rev-parse HEAD
alm workspace status --root . --json
```

- 没有活动 change → 进入 2.2；已有活动 change 且与任务一致 → 跳到 2.3。
- 基线由用户指定（SHA 或标签）；未指定时用当前 HEAD，并在汇报里写明。

### 2.2 建变更工作区

```powershell
alm workspace create --root . --baseline <sha|tag> --change CHG-<DOMAIN>-<NNN>
```

要求工作树干净；命令会创建 `alm/<chg-id>` 分支并提交 `.alm/changes/<CHG-ID>.json`。

### 2.3 改资产（白名单内）

允许目录：`requirements/`、`architecture/`、`adr/`、`tests/`、`risks/`。

写入前先验证路径：

```powershell
alm workspace guard --root . --change CHG-<...> --path requirements/refund.sdoc
```

一个变更内可以同时改需求、ADR、接口、数据模型与验收；不要拆成多个变更集。

### 2.4 跑门禁

```powershell
alm check --root . --base <baseline> --json
```

- 只看 `result` 与 `checks[].status`；`warn` 不阻断，`skip` 要说明原因（如无 `--base` 或渲染证据）。
- 失败时按 `file:line assetId` 定位修复，不能放宽规则。

### 2.5 差异与影响

```powershell
alm diff --base <baseline> --root . --json
alm impact --asset <改动资产ID> --root . --json
```

汇报里必须包含：改了哪些字段/关系、影响了哪些资产、是否存在环。

### 2.6 落证据

```powershell
alm check --root . --base <baseline> --out .alm/evidence/<change>.json
```

证据文件与 `alm.evidence/v1` 契约一致；不要手工改写。

### 2.7 汇报（不提交）

给出：变更 ID、基线 SHA、改动文件、门禁结果、影响清单、证据路径、未覆盖项。然后交给人评审。

## 3. 失败处理

| 现象 | 处理 |
|---|---|
| `worktree must be clean` | 先处理未提交改动，不要强切分支 |
| `branch already exists` | 变更已存在；改用 `workspace status` 确认，不要复用旧分支 |
| `no active change workspace` | 回到 2.2 建工作区 |
| `denied <path>` | 目标不在白名单；改到资产目录，或由人决定扩大范围 |
| `check` 失败 | 按 findings 修复；禁止改 `pack.json` 或 CI 绕过 |
| 基线无法解析 | 换用存在的 SHA/标签；不要用 `HEAD` 冒充 |

## 4. 完成自检

- [ ] 活动 change 与本次任务一致，分支为 `alm/<chg-id>`。
- [ ] 改动全部在白名单目录内，`guard` 通过。
- [ ] `check` 的 `result=pass`，失败项已修复而非绕过。
- [ ] `diff` 与 `impact` 已生成并写入汇报。
- [ ] 证据文件存在且未被手工修改。
- [ ] 没有提交、没有审批、没有发布。
