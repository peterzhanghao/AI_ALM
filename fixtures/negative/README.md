# 负例夹具

每个子目录是一个可独立运行的最小反例，`cases.json` 声明预期规则与当前是否已有实现。

| 目录 | 预期规则 | 状态 |
|---|---|---|
| `duplicate-id/` | `ID-001` | 已生效 |
| `dangling-relation/` | `REL-001` | 已生效 |
| `malformed-sdoc/` | `FMT-001` | 已生效 |
| `invalid-status/` | `FMT-002` | 已生效 |
| `missing-acceptance/` | `COV-001` | 待 ALM-02.03 |
| `secret-leak/` | `SEC-001` | 待 ALM-02.03 |

运行：

```powershell
node packages/alm-core/bin/alm.mjs check --root fixtures/negative/duplicate-id
```

`enforced: false` 的条目由 `ALM-02.03` 补规则后改为 `true`，测试会随之从“目录存在”升级为“必须失败”。
