# PR 描述模板

> 由 `ai-github-pr-workflow` 按需加载。与本仓 `.github/pull_request_template.md` 保持一致。

```markdown
## Summary
本 PR 解决的 Issue 和可观察结果。

## Changes
- 关键模块、接口、迁移或配置变化。

## Verification
- `准确命令`：结果、固定 SHA，以及制品或环境证据。
- CI 检查：`gh pr checks <n>` 结果。

## Risks / Rollback
兼容影响、未覆盖项、回滚条件和方法。

## Issue
`Refs #<编号>`；规划键 `ALM-xx.yy`。
合并到 develop 不会自动关闭 Issue，合并后需显式 `gh issue close`。
```

## 写作要求

- Summary 写“解决了什么、可观察到什么”，不写“按需求开发”。
- Verification 必须包含可复现命令与固定 SHA；只说“测试通过”不合格。
- Risks / Rollback 没有风险时写“无”，但需说明兼容性结论。
- Issue 段同时给出真实编号与规划键，两者不混用。
