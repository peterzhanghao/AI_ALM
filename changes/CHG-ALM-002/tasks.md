# CHG-ALM-002 任务卡

> 由 `alm task draft` 生成；五要素与 ai-github-issue-workflow 一致。

### TASK-ALM-001 REQ-ALM-011 需求与验收资产

- 类型：Task ｜ 优先级：P1 ｜ 覆盖：REQ-ALM-011
- 前置：无
- 实施范围：requirements/、tests/
- 不在范围：实现代码（下一张卡）
- 接口：补齐 REQ-ALM-011 的验收：新增 TEST-* 并在需求里加 verified_by
- 正例：alm check 通过，COV-001 不再报告 REQ-ALM-011
- 反例：缺少 verified_by → COV-001 失败，退出码 1
- 证据：node packages/alm-core/bin/alm.mjs trace REQ-ALM-011；node packages/alm-core/bin/alm.mjs check --root .

### TASK-ALM-002 REQ-ALM-011 实现

- 类型：Task ｜ 优先级：P1 ｜ 覆盖：REQ-ALM-011
- 前置：TASK-ALM-001
- 实施范围：architecture/、adr/
- 不在范围：验收资产（上一张卡）、发布（ALM-04）
- 接口：实现 REQ-ALM-011：需求列表长标题自动提炼与主操作按钮语义优化
- 正例：需求场景可执行并通过：验收用例
- 反例：超出边界（如金额越界）返回明确错误且不产生副作用
- 证据：node --test；node packages/alm-core/bin/alm.mjs check --root .

### TASK-ALM-003 REQ-ALM-011 门禁、差异与证据

- 类型：Task ｜ 优先级：P1 ｜ 覆盖：REQ-ALM-011
- 前置：TASK-ALM-001
- 实施范围：changes/、.alm/evidence/
- 不在范围：实现细节
- 接口：跑门禁并记录证据：check/diff/impact → alm.evidence/v1
- 正例：alm check --base 64ec15e6 --out .alm/evidence/CHG-ALM-002.json 退出 0
- 反例：跳过门禁直接提 PR → APPROVAL/证据缺失被拒
- 证据：node packages/alm-core/bin/alm.mjs diff --base 64ec15e6；node packages/alm-core/bin/alm.mjs impact --asset REQ-ALM-011

