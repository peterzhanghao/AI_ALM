# 负例夹具

每个子目录是一个可独立运行的最小反例，`cases.json` 声明预期规则与当前是否已有实现。

| 目录 | 预期规则 | 状态 |
|---|---|---|
| `duplicate-id/` | `ID-001` | 已生效 |
| `dangling-relation/` | `REL-001` | 已生效 |
| `malformed-sdoc/` | `FMT-001` | 已生效 |
| `invalid-status/` | `FMT-002` | 已生效 |
| `relation-direction/` | `REL-002` | 已生效 |
| `missing-acceptance/` | `COV-001` | 已生效 |
| `secret-leak/` | `SEC-001` | 已生效 |
| `broken-render/` | `REN-001` | 已生效 |

运行：

```powershell
node packages/alm-core/bin/alm.mjs check --root fixtures/negative/duplicate-id
```

`cases.json` 的 `enforced` 必须与规则实现同步；测试会对每个条目断言“失败且报告预期规则”。
