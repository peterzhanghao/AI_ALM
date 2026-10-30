# 需求 → 任务卡 → 看板

> 由 `ai-github-issue-workflow` 按需加载。命令状态以 `alm --help` 与 `node scripts/sync-tasks.mjs --help`（无 --help 时以脚本用法行为准）为准。

## 1. 何时使用

- 已有一条或多条需求，需要拆成可交付的任务卡；
- 任务卡需要同步到 GitHub Issues 或 Gitea，而不是手工复制正文；
- 需要证明“每条需求都有任务覆盖”（`TASK-001`）。

## 2. 前提

1. 变更已建立：`.alm/changes/<CHG>.json` 存在，分支为 `alm/<chg>`；
2. 需求已在仓库里（`requirements/*.sdoc`），并且 `alm check` 可运行；
3. 台账对应行 `确认结论=确认发布`（同步看板属于远端写入）。

## 3. 生成任务卡

```powershell
# 一条需求 → 3 张卡（资产 / 实现 / 门禁证据），写入 changes/<CHG>/
alm task draft --root . --change CHG-PAY-001 --from REQ-PAY-001

# 多条需求；已存在时用 --force 覆盖
alm task draft --root . --change CHG-PAY-001 --from REQ-PAY-001,REQ-PAY-002
```

产物：

```text
changes/<CHG>/
  proposal.md    为什么改、改什么、验收
  tasks.md       五要素卡（范围/接口/正例/反例/证据）
  tasks.json     机器可读，含 covers / blockedBy / issue 映射
```

退出码：`0` 成功；`1` 变更不存在、需求不存在、草案已存在（未加 `--force`）；`2` 用法错误。

## 4. 门禁校验

```powershell
alm check --root .
```

- `TASK-001`（block）：`tasks.json` 里列出的每条需求必须被至少一张卡 `covers`；
- 未覆盖、任务无 `covers`、任务 ID 重复 → 失败；
- 仓库没有 `changes/` 草案 → `skip`（不阻塞普通检查）。

## 5. 同步到看板

```powershell
# 默认 dry-run：只打印将创建的 Issue 正文，不写远端
node scripts/sync-tasks.mjs --change CHG-PAY-001

# 确认后真正建单（GitHub，走本机 gh 凭据）
node scripts/sync-tasks.mjs --change CHG-PAY-001 --apply

# Gitea：需要 ALM_GITEA_URL / ALM_GITEA_OWNER / ALM_GITEA_REPO / ALM_GITEA_TOKEN
node scripts/sync-tasks.mjs --change CHG-PAY-001 --provider gitea --apply
```

幂等与回写：

- `tasks.json` 已记录 `issue.number` 的任务 → 跳过；
- 未记录但看板已有同名（`<TASK-ID> <标题>`）Issue → 按精确标题 adopt，不重复创建；
- 每创建一条立即回写 `tasks.json` 的 `issue` 与 `status: open`，中途失败不重复；
- 看板报错直接非零退出，不写“已同步”。

## 6. 权限与红线

| 动作 | 要求 |
|---|---|
| `task draft` | 只写 `changes/<CHG>/`，仍需在变更工作区内 |
| `sync-tasks`（dry-run） | 只读，可随时执行 |
| `sync-tasks --apply` | **远端写入**：先 dry-run，向人说明将创建的 Issue 数量与标题，得到确认后执行 |
| 修改已同步卡 | 改 `changes/<CHG>/tasks.json`/`tasks.md` 后重新 `--apply`；不要只改 Issue 不回写 |
| 关闭/合并 Issue | 需要人工或 PR 流程，不由本 skill 自动完成 |

## 7. 失败处理

| 现象 | 处理 |
|---|---|
| `task draft requires --change and --from` | 补参数；先 `alm workspace status --json` 确认变更 |
| `unknown change` | 先 `alm workspace create`，或确认 CHG-ID 拼写 |
| `requirement not found` | 先 `alm index` 确认需求 ID 与类型 |
| `task draft already exists` | 确认是否要重建；需要时 `--force`，并在评审说明 |
| `TASK-001 ... not covered` | 补一张 `covers` 包含该需求的卡，或恢复被删的卡 |
| `gh: not logged in` | `gh auth login`，不要改用匿名接口 |
| `gitea: ... env` / `GiteaError` | 补齐 `ALM_GITEA_*`，检查 token 权限；错误消息不含 token |
| 看板异常中断 | 已创建的 Issue 已回写；修复后重跑 `--apply`，只会补缺失的 |

## 8. 证据

```powershell
node scripts/sync-tasks.mjs --change CHG-PAY-001          # 输出将创建的正文
node packages/alm-core/bin/alm.mjs check --root .         # TASK-001 pass
node -e "const d=require('./changes/CHG-PAY-001/tasks.json');console.log(d.tasks.map(t=>[t.id,t.issue?.number??'-']))"
```
