## Summary
本 PR 解决的 Issue 和可观察结果。

## Changes
- 关键模块、接口、迁移或配置变化。

## Tests
- 新增/修改的测试文件与用例：
- 正例与反例（含夹具路径）：
<!-- 仅当确实无法补测时，在下方写一行：Test-Exemption: 至少 10 个字符的理由（需评审确认） -->

## Verification
- `准确命令`：结果、固定 SHA，以及制品或环境证据。
- CI 检查：`gh pr checks <n>` 结果（必须包含 `test-obligation` 与 `regression-gate`）。

## Risks / Rollback
兼容影响、未覆盖项、回滚条件和方法。

## Issue
`Refs #<编号>`；规划键 `ALM-xx.yy`。

合并后 `Issue regression` 会在 merge commit 上复跑并回写关联 Issue；失败时按评论中的泳道与命令修复。
