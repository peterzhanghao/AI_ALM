# 测试义务与自动执行

> 本文件是 `alm-mvp-dev` 的按需参考。它回答两个问题：后续开发怎样自动补测试，以及脚本怎样保证这些测试一定被执行。

## 1. 机制总览

```text
Issue 验收（正例 + 反例 + 测试落点）
  → 开发时补测试/夹具
  → PR 的 test-obligation 检查（源码变更必须有测试/夹具，或显式豁免）
  → ALM MVP CI 五泳道（unit 自动发现并执行全部测试）
  → regression-gate 聚合
  → 合并后 Issue regression 复跑
```

边界要说清：**脚本不能自动写出语义正确的测试**。脚本保证的是“变更必须带测试、测试必须被执行、缺失必须变红”；测试内容仍由 Agent 从验收反例推导，并由评审确认。

## 2. 硬规则

1. 改 `packages/*/src/`、`packages/*/bin/`、插件入口（`index.js`/`service.mjs`/`query.mjs`/`render.mjs`/`client.js`）时，同一 PR 必须改测试或夹具。
2. 每个行为至少一个正例；每个门禁/解析/权限/失败路径至少一个反例。
3. 反例必须断言**具体规则、退出码或错误字段**，不能只断言“抛错”。
4. 测试必须能在临时目录运行，不写死仓库内路径，不依赖执行顺序或当前时间。
5. 只改文档、技能、CI YAML、`scripts/` 自动化或 `fixtures/` 时，`test-obligation` 不强制补测试；但仍要跑对应泳道。
6. 确实无法补测时，在 PR 正文写一行豁免说明（`Test-Exemption` + 冒号 + 至少 10 个字符理由）；不得写空理由、短理由，或把理由藏在 HTML 注释/代码块里。评审必须确认。

## 3. 测试落点

| 改动类型 | 首选落点 | 最低要求 |
|---|---|---|
| `alm-core` 命令/CLI | `packages/alm-core/test/cli.test.mjs` 或 `test/integration/` | 退出码 + JSON `schema` + 关键字段 |
| 解析器/资产模型 | `packages/alm-core/test/unit/parse/` | 合法输入、破损输入、错误行号 |
| 门禁规则 | `packages/alm-core/test/unit/gates/` + `fixtures/negative/` | 正例通过；反例触发声明规则并退出 1 |
| 差异/影响闭包 | `packages/alm-core/test/{unit,integration}/` | 字段级变化、环、确定顺序 |
| 证据/基线/发布 | `packages/alm-core/test/integration/` | 幂等、篡改失败、不覆盖 |
| 插件（requirements/architecture） | `packages/dsh-plugin-*/test/` | HTTP 页面、JSON 工具、转义、生命周期释放 |
| 技能/文档一致性 | 无单测；由 `skills` 泳道执行 | `validate-skills.ps1` + `check-alm-skill.mjs` 通过 |
| 回归/自动化脚本 | `packages/alm-core/test/integration/`（纯逻辑）或对应泳道 | 至少一个失败路径；纯 CLI 编排可由泳道执行验证 |

新增测试文件放在 `packages/<pkg>/test/**/*.test.mjs`，文件名以 `.test.mjs` 结尾。

## 4. 自动发现规则

- 根 `pnpm test` 的 glob 是 `packages/*/test/**/*.test.mjs`；新增测试文件**不需要注册**，下一次 `unit` 泳道会执行。
- 新负例夹具：在 `fixtures/negative/<case>/` 放文件，并在 `fixtures/negative/cases.json` 增加 `{ "dir", "rule", "via": "check", "enforced": true }`；`fixtures` 泳道自动遍历全部 case。
- 新正例夹具：除新增目录外，还要在 `scripts/regression-fixtures.mjs` 的 `POSITIVE` 列表登记期望资产数；未登记不会被 `fixtures` 泳道执行。
- 新 CLI 命令：除测试外，更新 `packages/alm-core/src/cli.mjs` 的 `HELP` 与 `references/commands.md`；`check-alm-skill.mjs` 会检查命令是否存在。

## 5. 写法

使用 `node:test` 与 `node:assert/strict`，与现有测试保持一致：

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { run } from '../../src/cli.mjs'

test('duplicate id fails with ID-001', async () => {
  const out = capture()
  const code = await run(['check', '--root', dir, '--json'], { out })
  assert.equal(code, 1)
  const payload = JSON.parse(out.text)
  assert.equal(payload.result, 'fail')
  assert.ok(payload.checks.some((check) => check.id === 'ID-001'))
})
```

- CLI 用 `run()` 返回的退出码判定，不靠人类输出。
- 插件测试用临时目录/内存 HTTP，不写仓库内固定路径。
- 断言业务不变量，不断言实现细节（例如内部函数调用次数）。
- 每个反例问一句：如果删掉这段修复，测试会不会红？不会红就不是回归测试。

## 6. 本地检查

```powershell
# 只改源码、没补测试时，下面命令退出 1；CI 的 test-obligation 同样会红
node scripts/test-obligation.mjs --base origin/develop

# 已提交的 PR 范围
node scripts/test-obligation.mjs --base origin/develop --head HEAD

# 跑单条泳道；unit 等价于 pnpm test
node scripts/regression.mjs run-lane unit --output tmp/regression/unit
node scripts/regression.mjs run-lane fixtures --output tmp/regression/fixtures
```

`--base` 不带 `--head` 时比较基线到工作区（含未跟踪文件）；CI 显式传 `base.sha` 与 `head.sha`。

## 7. 完成前自检

- [ ] 行为变更同 PR 有测试或夹具；`test-obligation` 通过或豁免理由经评审。
- [ ] 正例、反例各至少一条，反例断言具体规则/退出码。
- [ ] 新测试文件在 `packages/<pkg>/test/` 下，`pnpm test` 能自动发现。
- [ ] 新负例已进 `cases.json`；新正例已进 `POSITIVE`。
- [ ] 本地 `unit` 与 `fixtures` 泳道通过。
- [ ] PR 描述写明测试文件、命令、固定 SHA 与未覆盖项。
