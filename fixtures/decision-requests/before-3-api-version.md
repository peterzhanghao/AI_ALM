# RUN-000 决策请求（REQ-ALM-099 决策记录字段冲突）

日期：2026-11-01
关联：RUN-000、CHG-ALM-099、`packages/alm-core/src/requirements/run.mjs`
状态：实现已落盘，等待确认字段语义

## 1. 问题

### A. `alm.run.decision/v1` 的 `decision` 字段既当路径又当内容

`runDecision` 目前返回：

```js
return { schema: 'alm.run.decision/v1', runId: active?.id ?? null, exists: Boolean(active), decision, text }
```

其中 `decision` 是 `checkpoint.decision` 的相对路径，但前端把它当说明文字渲染。仓库内没有写入 `checkpoint.decision` 的代码：

```text
$ grep -rn "checkpoint.decision" packages --include=*.mjs
packages/dsh-plugin-requirements/index.js:1151
```

### B. 解析失败时的回退分支

```js
const safePath = decision && !String(decision).includes('..') ? join(root, String(decision)) : null
```

如果 `decision` 为 null，`text` 为 null，面板显示「没有找到决策请求文件」。真实文件在 `.alm/runs/RUN-000-decision.md`。

## 2. 为什么现在需要人决定

- 改字段名会破坏 `alm.run.decision/v1` 的既有消费者；
- 不改字段名，前端无法区分「路径」和「展示文案」；
- 是否引入 `v2` 属于对外契约变更，需要人类确认兼容策略。

## 3. 推荐选项与影响

### 选项 A（推荐）：新增 `alm.run.decision/v2`，v1 只读兼容

- 正向：不破坏旧消费者，前端可拿结构化字段。
- 影响：需要同时维护两个 schema 的测试，`packages/dsh-plugin-requirements/test/execution.test.mjs` 增加 3 个用例。

### 选项 B：直接改 v1 字段语义

- 正向：代码最简单，无版本分叉。
- 影响：任何缓存了旧 v1 响应的宿主会拿到错误结构，属于破坏性变更。

### 选项 C：不改 schema，前端自己解析文本

- 正向：后端零改动。
- 影响：解析逻辑落在 `client.js`，无法被 `node --test` 单测覆盖，且 `text` 可达 6KB。

## 4. 等待期间我还能做什么

- 补齐 `decision.mjs` 的纯函数测试。
- 用 `node --test --test-isolation=none` 跑一遍相关文件。
