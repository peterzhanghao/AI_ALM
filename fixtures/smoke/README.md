# 冒烟夹具

最小 YAML 资产集，用于 `alm index` / `alm check` 的垂直回路（ALM-01.03）：

- `REQ-SMK-001`：需求，指向模块与验收用例；
- `MOD-SMK-001`：模块；
- `TEST-SMK-001`：验收用例。

预期：`alm check --root fixtures/smoke` 退出 0，`ID-001` 与 `REL-001` 均为 pass。

负例不放在这里：重复 ID、悬空引用由测试在临时目录中构造，避免污染正例。
