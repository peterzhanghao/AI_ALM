# 合并收口核对表

> 由 `ai-github-pr-workflow` 按需加载。逐项执行并回读，任何一项未确认都按“未完成”报告。

## 1. 合并与证据

- [ ] checks 全绿：`gh pr checks <n>`，至少包含 `test-obligation` 与 `regression-gate`
- [ ] 行为变更已补测试/夹具，或 PR 正文有经评审确认的 `Test-Exemption: <理由>`
- [ ] 评审已通过：`gh pr view <n> --json reviewDecision`
- [ ] 无冲突：`gh pr view <n> --json mergeable,mergeStateStatus`
- [ ] PR 状态已从 Draft 转为 Ready

```powershell
gh pr view <n> --json number,url,state,isDraft,baseRefName,headRefName,mergeCommit,mergedAt
gh pr merge <n> --merge --delete-branch
```

合并后再次回读 `state=merged`、`mergedAt`、`mergeCommit.oid`。

- [ ] `Issue regression` 已在 merge commit 上完成：`gh run list --workflow issue-regression.yml --limit 1`
- [ ] 关联 Issue 出现 `regression::passed`；若为 `regression::failed`，按评论中的泳道与命令登记修复，不宣布收口

## 2. Issue 交付记录

在对应 Issue 下留最终评论，包含：

- 实现范围与关键决策
- 固定 SHA（merge commit / squash commit）
- 验证命令与结果
- 偏离原计划之处
- 未交付项与下游影响

## 3. 关闭与标签

- [ ] 显式关闭：`gh issue close <n> --comment "..."`（合并到 `develop` 不会自动关闭）
- [ ] 清理旧 `status::*`，补 `status::done`
- [ ] 核对 sub-issue 与父项进度

## 4. 下游重算

- [ ] 对每个下游 Issue 回读全部 blocked-by
- [ ] 只有全部前置关闭，才把下游改为 `status::ready`
- [ ] 同步 `docs/planning/issue-register.md`，标注回读日期

## 5. 边界确认

- [ ] 未合并 `main`
- [ ] 未打版本标签
- [ ] 未把 `develop` 合并表述为发布

## 回读失败时

报告已确认的实际范围、失败对象与剩余差异，保留本地记录，不宣布“已收口”。
