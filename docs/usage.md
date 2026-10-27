# 在 DeepSeek Harness 中使用

## 先决条件

1. 本仓库位于 DSH 的项目根目录（最近一个包含 `.git` 的祖先目录；若没有 `.git`，则取当前工作目录）。
2. 已安装 `gh` 并登录：`gh auth status` 返回已登录账号。
3. 已运行 `scripts/setup-github.ps1`（创建标签与 `develop` 分支），或手工完成同等配置。

## 技能如何被发现

DSH 的文件系统技能提供方按 rank 扫描：

| Rank | 来源 | 路径 |
|---|---|---|
| 100 | 项目 DSH | `<projectRoot>/.dsh/skills` |
| 200 | 项目 agents | `<projectRoot>/.agents/skills` |
| 400 | 用户 DSH | `~/.dsh/skills` |
| 500 | 用户 agents | `~/.agents/skills` |

约束：

- 只识别**一层**：`<root>/<name>/SKILL.md` 或 `<root>/<name>.md`，嵌套目录不会被扫描。
- frontmatter 必须有 `name`（kebab-case）与 `description`；格式非法时该技能会被**静默跳过**，只留一条警告。
- 技能新增、改名、删除时目录自动刷新，无需重启会话。

## 触发方式

- **自动**：描述匹配任务语义时，模型先调用 `skill` 工具加载完整指令。例如“给 ALM-01.02 建 GitHub Issue”“从 develop 开分支提 PR”“PR 合并后收口”。
- **显式**：在输入中使用 `/ai-github-issue-workflow` 或 `/ai-github-pr-workflow`。
- 两个技能互补：先工作项（做什么），再 PR（怎么交付）。

## 插件页面入口（重要）

DSH Web 的 GUI 根地址需要 `dsh web` 打印的带 token URL；直接打开 `http://127.0.0.1:<端口>/` 会返回：

```text
401 Unauthorized
dsh web authentication required; reopen the URL printed by dsh web.
```

插件页面请用以下入口：

| 入口 | 地址 |
|---|---|
| DSH 内需求页 | Settings → Requirements（可 “Open as main panel”） |
| DSH 内架构页 | Settings → Architecture |
| 需求只读 HTML | `http://127.0.0.1:<端口>/alm/requirements` |
| 架构只读 HTML | `http://127.0.0.1:<端口>/alm/architecture` |
| JSON | `/api/alm/requirements`、`/api/alm/architecture` |

`/alm/*` 与 `/api/alm/*` 是插件路由，免 token、只读，可在内嵌浏览器或系统浏览器直接打开。

## 三个典型场景

```text
# 1. 建卡
读 issue-register 中 ALM-01.02 那一行，确认是“确认发布”后，
按 issue skill 生成正文，在 peterzhanghao/AI_ALM 创建 Task，
打 type::task、planning::execution、status::ready，
建完回读编号并写回台账。

# 2. 开发并提 PR
按 #12 开发：从最新 origin/develop 切 feature/alm-01-02-xxx，
实现后跑格式化与测试，提目标 develop 的 Draft PR。

# 3. 收口
PR #18 检查全绿且评审通过，走收口：合并、回读 merge commit、
在 Issue 留交付记录、显式关闭并重算下游 blocked-by。
```

## 排错

| 现象 | 原因 | 处理 |
|---|---|---|
| 会话目录里没有这两个技能 | 路径不在扫描根内，或 frontmatter 非法 | 确认文件位于 `.dsh/skills/<name>/SKILL.md`，运行校验脚本 |
| `/ai-github-issue-workflow` 无效 | 名称与 frontmatter 的 `name` 不一致 | 名称必须 kebab-case 且与目录同名 |
| 描述在目录里被截断 | 目录只渲染前 500 字符 | 把触发关键词写在描述前部 |
| 加载后提示资源不存在 | 相对路径写错 | 资源路径相对技能目录解析，用 `references/xxx.md` |
| `gh` 报未认证 | 未登录或 token 过期 | `gh auth login` / `gh auth refresh` |
| 合并后 Issue 没关 | closing 关键字只对默认分支生效 | 显式 `gh issue close <n>` |
| 侧边栏「浏览器」打开 `/alm/...` 显示空白（或提示“不能在嵌入浏览器中打开 DSH 应用自身”） | DSH 的侧边栏浏览器拒绝与 GUI **同源**的地址（`parseBrowserAddress` 的 `application-origin` 规则）；插件页与 GUI 共用 `127.0.0.1:<port>` | 换成另一个 loopback 主机名：GUI 是 `127.0.0.1` 就用 `http://localhost:<port>/alm/requirements`，反之用 `127.0.0.1`；页面页脚会直接给出该地址 |
| `/alm/...` 报 `ERR_CONNECTION_REFUSED` | DSH 重启后端口变了 | 从 GUI 地址栏取当前端口，或运行 `dsh web` 看打印的 URL |

校验命令：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/validate-skills.ps1
node scripts/check-alm-skill.mjs
```

- `validate-skills.ps1`：`.dsh/skills` 的 frontmatter、命名、相对链接与体积。
- `check-alm-skill.mjs`：全部 ALM 技能（`.dsh/skills` + `packages/alm-skills`）的命令存在性、链接、权限声明与工具清单，在 `alm-ci.yml` 中执行，失败退出 1。

## 侧边栏浏览器与插件页

DSH 右侧的「浏览器」tab 可以访问 loopback 服务，但**明确拒绝与 GUI 同源的地址**（应用自身 origin），此时页面区域是空白，日志里没有网络错误。判断与用法：

1. 看 GUI 地址栏：`http://127.0.0.1:<port>`；
2. 侧边栏里输入 **另一个** loopback 主机名：

   ```text
   http://localhost:<port>/alm/requirements
   http://localhost:<port>/alm/architecture
   ```

3. 二者指向同一服务（`localhost` 与 `127.0.0.1` 是不同 origin），因此能通过校验；系统浏览器两种写法都可以。

插件页面页脚会渲染 `Sidebar browser: <url>` 提示，按请求 `Host` 自动给出可用的那个主机名；公网域名访问时不显示该提示。

## 按需 UI 验证（GitHub Actions）

PR 流程不装浏览器；需要可归档的页面证据时手动触发：

```powershell
gh workflow run alm-ui.yml --ref develop
gh run watch
gh run download <run-id> -n ui-report -D tmp/ui-ci
```

- 输入：`root`（默认 `fixtures/order-refund`）、`require`（逗号分隔的必含文本）、`base`（可选，指向已运行宿主）。
- 产物：`ui-report` artifact 含 `report.json`、`requirements.png`、`architecture.png`，保留 7 天。
- 负例：`gh workflow run alm-ui.yml -f require=REQ-PAY-999` 会让 run 失败，用于验证断言确实生效。

## 维护约定

- 改动技能后必须跑校验；校验失败不合并。
- 修改内容时同步更新 `metadata.version` 与 `CHANGELOG.md`。
- 新增技能放在 `.dsh/skills/<name>/SKILL.md`，描述包含触发场景，正文控制在 8 KB 内，长内容拆到 `references/`。
- 技能内不引用未随包提供的其他技能；需要的规则直接内联或放入 `references/`。
