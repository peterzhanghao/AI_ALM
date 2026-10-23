# Gitea SCM 适配器

> 代码：`packages/alm-scm/src/gitea.mjs` ｜ 导出：`@ai-alm/alm-scm/gitea` ｜ 测试：`packages/alm-scm/test/gitea.test.mjs`
> 定位：薄适配层，只做 HTTP 与错误映射；审批、必需检查判定、合并策略仍由 `alm-core` 决定。

## 1. 能力

| 方法 | HTTP | 用途 |
|---|---|---|
| `createPullRequest({base,head,title,body})` | `POST /pulls` | 建 PR；同 head 已存在 open PR 时返回既有 PR（`created:false`） |
| `getPullRequest(number)` | `GET /pulls/{n}` | 读 PR 状态 |
| `getCombinedStatus(sha)` | `GET /commits/{sha}/status` | 读提交检查汇总与各 context |
| `evaluateRequiredChecks(combined, required)` | — | 判定必需检查：`success` 且每个 context `success` |
| `comment(number, body)` | `POST /issues/{n}/comments` | 留门禁/证据评论 |
| `mergePullRequest(number, {message, method})` | `POST /pulls/{n}/merge` | 合并（`Do=merge`） |

## 2. 用法

```js
import { createGiteaClient, evaluateRequiredChecks } from '@ai-alm/alm-scm/gitea'

const gitea = createGiteaClient({
  baseUrl: process.env.ALM_GITEA_URL,      // 例如 https://gitea.internal
  owner: process.env.ALM_GITEA_OWNER,      // 例如 team-payments
  repo: process.env.ALM_GITEA_REPO,        // 例如 order-service
  token: process.env.ALM_GITEA_TOKEN,      // 只从环境读，不写入仓库
  timeoutMs: 10_000,
})

const pr = await gitea.createPullRequest({ base: 'develop', head: 'feature/refund', title: 'feat: 部分退款', body: '…' })
const combined = await gitea.getCombinedStatus(pr.head)
const verdict = evaluateRequiredChecks(combined, ['alm-ci'])
if (!verdict.ok) throw new Error(`required checks: ${verdict.reasons.join('; ')}`)
await gitea.comment(pr.number, `gate: ${verdict.ok ? 'pass' : 'fail'}`)
```

环境变量约定（与 `docs/development/permissions.md` 一致：token 不落仓库）：

| 变量 | 说明 |
|---|---|
| `ALM_GITEA_URL` | 实例根地址，不带 `/api/v1` |
| `ALM_GITEA_OWNER` / `ALM_GITEA_REPO` | 目标仓库 |
| `ALM_GITEA_TOKEN` | 访问令牌；只读或写取决于用途 |

## 3. 错误语义

| 场景 | 结果 |
|---|---|
| 401 / 403 | `GiteaError.status` + `code=unauthorized/forbidden`；消息不含 token |
| 404 | `code=not_found`（PR 不存在、仓库不可见） |
| 409 `already exists` | 不抛错：回查 open PR 并返回 `created:false` |
| 超时 | `code=timeout`，消息含 `timeoutMs` |
| 网络失败 | `code=network`，保留原始错误信息 |

`GiteaError` 同时带 `status`、`code`、`body`，调用方按字段判定，不解析文案。

## 4. 边界

- 不实现 OAuth/Webhook 服务端，不部署 Gitea；token 由调用方注入。
- 不接入 `alm pr status/merge` 的 CLI 本地路径（那两条仍用 local-git）；接入需要真实凭据，另卡处理。
- 与 GitHub 策略（`packages/alm-scm/src/policy.mjs`）共用同一“必需检查 + 审批”判定思路：Gitea 侧只提供检查状态，不替代 `APPROVAL-*`。

## 5. 测试

```powershell
node --test packages/alm-scm/test/gitea.test.mjs
```

覆盖：创建成功（路径/鉴权头/请求体）、409 幂等回查、必需检查通过、`pending`/`failure`/缺失 context、401 不泄漏 token、404、超时、评论与合并请求体。mock 用 `node:http`，不依赖网络。
