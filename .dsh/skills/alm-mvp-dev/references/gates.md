# 门禁规则

> 规则实现位于 `packages/alm-core/src/gates/`，规则包版本在 `packages/alm-core/src/gates/pack.json`。每条规则必须有正例与反例测试。

## R1（ALM-02.03）

| 规则 | 级别 | 检查 | 反例 |
|---|---|---|---|
| `FMT-001` | block | 文件可解析、编码合法 | 破损 YAML、缺 `[REQUIREMENT]` 节点 |
| `FMT-002` | block | 必填字段与 `schema_version` | 资产缺 `owner` |
| `ID-001` | block | 全局 ID 唯一 | 两个 `REQ-PAY-001` |
| `ID-002` | block | ID 前缀与资产类型一致 | `ADR-*` 标成 `requirement` |
| `REL-001` | block | 关系目标存在 | 指向 `MOD-PAY-NOPE` |
| `REL-002` | block | 关系类型与方向合法 | requirement `depends_on` requirement |
| `COV-001` | block | 每条 requirement 至少一个 `verified_by` | 需求没有验收用例 |
| `COV-002` | warn | 验收用例被引用（孤儿检测） | 孤立 `TEST-PAY-001` |
| `STATE-001` | block | 状态迁移合法 | `accepted → proposed` |
| `SEC-001` | block | 秘密/高熵串扫描 | 提交 `api_key=sk-...` |
| `REN-001` | block | Markdown 链接与 Mermaid 块结构可渲染 | 悬空相对链接 |
| `REN-002` | warn | StrictDoc 渲染证据 | 见下 |

## REN-002（非阻断渲染证据）

- 固定 `strictdoc==0.30.4`，在隔离 venv（`tmp/strictdoc-venv`）中渲染，产物写入 `.alm/render/`，清单为 `.alm/render/manifest.json`。
- 校验 `manifest.strictdocVersion`、`manifest.sourceSha` 与产物哈希。
- 缺工具或产物 → `skip`；版本或哈希不符 → `fail`，但 `level=warn`。
- **任何情况下不改变 `alm check` 退出码**，只有 `block` 规则失败才让 `result=fail`。
- 脚本：`scripts/strictdoc-render.ps1`（ALM-02.03 交付）。

## R2（ALM-02.05、ALM-04.*）

| 规则 | 级别 | 检查 | 反例 |
|---|---|---|---|
| `BASE-001` | block | 已发布基线不被原地修改 | 直接改 `baseline/*` 标签内容 |
| `APPROVAL-001` | block | 存在绑定当前 `headSha` 的 approve | 用旧 SHA 的审批合并新提交 |
| `APPROVAL-002` | block | 审批者 `kind=human` 且非提交者 | Agent 自批；审批人非人类 |
| `PUB-001` | block | 发布证据完整且不可覆盖 | 缺证据直接建基线；同 SHA 写入不同内容 |

## 证据字段

`alm.evidence/v1` 的 `checks[]` 必须包含：`id`、`status`（pass/fail/skip）、`assets`、`files`、`message`；规则包版本写 `rules.packVersion`；产物写 `artifacts[].sha256`。`level` 区分 `block` 与 `warn`，只有 block 失败影响 `result`。

## 新增规则步骤

1. 在 `src/gates/` 新建规则文件，导出 `{ id, level, check(ctx) }`。
2. 在注册表登记，并在 `pack.json` 升 `version`、加入规则清单。
3. 在 `fixtures/negative/` 增加能触发该规则的最小反例。
4. 写测试：正例通过、反例失败且定位到资产/文件/行。
5. 更新 `docs/planning/architecture.md` 第 6 节与 [`commands.md`](commands.md) 中相关说明。
