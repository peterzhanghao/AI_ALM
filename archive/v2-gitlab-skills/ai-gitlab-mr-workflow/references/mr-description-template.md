# MR 描述模板

> 由 `ai-gitlab-mr-workflow` 按需加载。

```markdown
## Summary
本 MR 解决的任务和可观察结果。

## Changes
- 关键模块、契约、迁移或配置变化。

## Verification
- `准确命令`：结果、固定 SHA，以及制品或环境证据。

## Risks / Rollback
兼容影响、未覆盖项、回滚条件和方法。

## Issue
Task URL；AAGP 规划键；默认用 `Refs #<IID>` 关联，
确定要在合并时尝试自动关闭才使用 `Closes #<IID>`。
```

## 写作要求

- Summary 写“解决了什么、可观察到什么”，不写“按需求开发”。
- Verification 必须包含可复现命令与固定 SHA；只说“测试通过”不合格。
- Risks / Rollback 没有风险时写“无”，但需说明兼容性结论。
- Issue 段同时给出真实 Task URL 与规划键，两者不混用。
