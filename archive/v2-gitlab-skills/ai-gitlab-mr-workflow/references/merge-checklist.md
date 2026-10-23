# 合并收口核对表

> 由 `ai-gitlab-mr-workflow` 按需加载。逐项执行并回读，任何一项未确认都按“未完成”报告。

## 1. 合并与证据

- [ ] MR 状态为 merged，目标分支是 `develop`。
- [ ] 记录实际 merge commit SHA；启用 squash 时另记 squash commit。
- [ ] 记录 pipeline 结果与评审结论。

```powershell
glab mr view <IID> -R eic/software-architecture/ai-platform --comments
git log -1 --format='%H %s' origin/develop
```

## 2. Task 交付记录

在对应 Task 下留最终评论，包含：

- 实现范围与关键决策
- 固定 SHA（merge commit / squash commit）
- 验证命令与结果
- 修正的缺陷或偏离原计划之处
- 未交付项与下游影响

## 3. 关闭与标签

- [ ] 核对 Task 实际状态；`Closes #IID` 不保证自动关闭。
- [ ] 手动关闭时清理旧 `status::*`，不留“关闭但仍在 review”的矛盾状态。
- [ ] 项目存在 `status::done` 时才使用，否则以关闭状态为准。

## 4. 下游重算

- [ ] 对每个下游 Task 回读**全部** `Blocked by`。
- [ ] 只有全部前置关闭，才把下游改为 `ready`。
- [ ] 同步本地规划索引，标注回读日期。

## 5. 边界确认

- [ ] 未创建 Release MR。
- [ ] 未合并 `main`、未打版本标签。
- [ ] 未把 `develop` 合并表述为 SIT 或生产发布。

## 回读失败时

报告已确认的实际范围、失败对象与剩余差异，保留本地记录，不宣布“已收口”。
