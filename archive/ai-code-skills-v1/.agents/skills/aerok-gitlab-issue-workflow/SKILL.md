---
name: aerok-gitlab-issue-workflow
description: "在 aerok-ai-platform 拆分、创建、调整或关闭 GitLab Issue/Task 时，维护入口、层级、依赖、状态和验收证据。"
---

# AEROK AI Platform GitLab Issue 工作流

## 适用范围与事实源

本 skill 处理新仓 `eic/software-architecture/aerok-ai-platform` 的工作项。仅讨论或修改任务文档时，完成本地草案；用户要求发布或维护 GitLab 工作项时，再执行远端写入。写入后，远端回读结果才是协作事实。

以下路径均从**仓库根目录**解析；执行前确认仍存在，并阅读与目标卡相关的章节：

- `docs/development/gitlab-workflow.md`：本仓工作项、标签和 MR 约定。
- `docs/agent-platform/first-phase-scope.md`：一期承接与裁剪。
- `docs/agent-platform/gitlab-work-item-structure.md`、`docs/agent-platform/issue-id-map.md`：入口、父子结构、稳定编号规则。
- `docs/agent-platform/task-confirmation-register.md`：发布前确认门禁，以及发布后的本地状态、GitLab IID、MR 和同步快照。
- `docs/agent-platform/repository-ownership-matrix.md`：平台、Foundation 与外部 Owner 的逐卡责任和跨仓工作项。
- `docs/agent-platform/task-breakdown.md`、`docs/agent-platform/task-implementation-spec.md`：逐卡目标、依赖、验收与实施细节。
- `docs/agent-platform/source-task-crosswalk.md`：原始条款、接口和当前任务的复用或差异决策。契约争议再按 `docs/agent-platform/README.md` 找冻结 M0 原文。

不借用旧仓的状态或路径。

## 拆分与层级

- `AAGP-00` 是总控入口；`AAGP-01`～`AAGP-10` 是领域跟踪 Issue。总控通过清单和链接汇总领域项。
- 一个执行 Task 原则上是一人、一个 MR、一条可独立验收的交付路径。`AAGP-xx.yy` 能这样交付时，作为领域 Issue 下的原生 Task。
- 大卡确需多个独立 MR 时，`AAGP-xx.yy` 保留为跟踪 Issue，`AAGP-xx.yy.01` 等成为其原生子 Task；领域父项通过清单和链接汇总大卡。不能同时创建同编号的 Issue 和 Task。
- 规划采用 `Issue → Task`；发布前核实新项目可用类型和父子能力，不能把三段规划编号说成已存在的原生三级树。真实 GitLab IID 另行记录。
- `Blocked by` 或实例支持的有向阻塞关系表达执行先后，`relates to` 只提供导航。拆分或改前置时同步所有下游依赖、父项清单、本地编号规则和任务状态台账。
- 发布每一张卡前核对当前范围决策；编号存在不等于已排期、已授权实施或已完成。
- 48 张 `AAGP-*` 的主实现仓库都是 `aerok-ai-platform`。需要修改 Foundation 通用机制时，在 Foundation 项目另建 `AFF-*` 工作项；一张执行 Task、一个分支和一个 MR 只属于一个仓库。
- `AFF-*` 在本地只作为发布前规划键。远端未创建并回读前，不得把它写成已存在的依赖；创建后在平台 Task 的 `Blocked by` 使用完整项目 URL。

## 发布前确认门禁

发布工作项前先读 `docs/agent-platform/task-confirmation-register.md` 对应行。只有 `确认结论=确认发布`，且 Owner、类型/拆分、优先级、实施仓库、跨仓前置、依赖、契约/接口、正反例验收都已确认，才进入 GitLab。`待确认`、`需修改`、`暂缓`、`不发布` 均不得创建远端工作项。

确认导致标题、范围、依赖或拆分变化时，先更新任务清单、实施细则和台账；不要为了尽快取得 IID 而发布半成品描述。拆出 `AAGP-xx.yy.zz` 时在台账父行下增加子行，并把父行类型改为跟踪 Issue。

## 工作项正文

跟踪 Issue 写目标、范围、子项清单、退出条件、跨域依赖和截至日期明确的状态快照。执行 Task 用下面的结构，内容必须针对该卡，不能把同一段领域模板复制给所有子项：

```markdown
## 目标与上下文
本切片在发布链或执行链中的位置、上游可复用成果、下游消费者。

## Parent
新仓父项的真实链接；尚未发布时写 AAGP 规划键并标明“待同步”。

## 实施仓库与跨仓前置
- 主实现仓库：准确项目路径。
- 本仓交付：本 Task 在该仓库内交付的模块和可观察结果。
- Foundation 复用：固定版本、接口/模块，以及是否只复用不改动。
- 跨仓前置：Foundation 或其他项目的真实工作项完整 URL；没有写“无”。
- 外部 Owner：Nacos/Auth/STS/Secret/模型/基础设施责任方和所需证据；没有写“无”。

## 来源与范围
M0/详细设计条款、一期裁剪或 ADR，以及此处选择复用或偏离的理由。

## 先读
3～5 个准确的章节、契约文件或已合并 MR（含固定 SHA）；不能只填文档名。

## 涉及模块与契约
准确模块、已有代码/契约位置、输入输出、状态与事务边界。

## What to build
列出可观察的实现结果、关键数据流和各接口或事件的行为。

## Out of scope
相邻能力及其承接 Task；不要把服务端 Task 的范围写成管理端页面。

## 交付物
- [ ] 可独立检查的实现或文档产物。

## Blocked by
全部前置的真实链接；没有前置写“无”。

## 验收与证据
- [ ] 正例：输入、输出和可观察结果。
- [ ] 反例：越权、错版本、非法状态、失败或恢复行为。
- [ ] MR、测试命令、固定 SHA、制品或环境证据位置。
```

原文已有的 API 路径、SPI 方法和事件字段应逐项复用；无法复用的差异写进卡片并走契约版本/ADR 评审。不要只写“参照 M0”“完成开发”或“测试通过”。

跨仓工作不能放进同一个执行 Task 或 MR。Foundation 完成候选生成、REMOTE 安全语义、MCP 协议或通用 Adapter 后，只解除对应平台 Task 的前置；平台仍须完成领域投影、授权、状态、持久化和集成验收。Nacos/Auth/STS/Secret/模型服务的产品能力记为外部依赖，不以 Foundation 代码任务代替。

## 写入、状态与回读

每批远端写入前，核对 `glab` 认证、API 当前用户、准确项目路径及目标工作项的最新标题、描述、类型、父项、标签、里程碑、状态和全部前置。按新项目当前能力选择 CLI/API；旧仓固定 GraphQL 类型 GID、标签 GID、里程碑和 CLI 绕法不可照搬。认证、权限或类型能力无法确认时，只保留草案并报告阻断。

日常查看、创建、更新和评论优先使用简单的 `glab issue` 命令；不要求开发者记 GraphQL：

```bash
glab auth status --hostname gitlab.k8s.aerok.com.cn
glab api --hostname gitlab.k8s.aerok.com.cn user
glab issue view <IID> --comments -R eic/software-architecture/aerok-ai-platform
glab issue create -R eic/software-architecture/aerok-ai-platform --title "<标题>"
glab issue update <IID> -R eic/software-architecture/aerok-ai-platform --label '<新标签>' --unlabel '<旧标签>'
glab issue note <IID> -R eic/software-architecture/aerok-ai-platform --message '<进展评论>'
```

长正文可让 `glab issue create` 打开编辑器，或使用仓库中的 Issue 模板。只有原生 Task 类型、父子层级或有向依赖等 `glab issue` 没有参数的能力才使用 `glab work-items` 或 `glab api`；这些能力在当前 CLI 中仍可能是实验性接口，执行前先看 `--help`，写入后按下文回读。

跟踪项不带 `planning::execution`。执行项在发布时核对并设置 `planning::execution`、适用的 `domain::*`、`phase::*`、优先级和**单个** `status::*`；缺少所需标签时先处理标签配置，不能静默省略。里程碑只用当前项目真实存在且获准的对象，不凭旧仓 ID 填充。状态按 `blocked → ready → in-progress → review → closed` 管理，变更时移除旧状态标签；只有全部前置解除才能置 ready。关闭时若项目已有 `status::done` 则使用，否则以关闭状态为准并清理过期状态标签。

写入后回读 IID、URL、类型、父项或清单、标签、里程碑、状态和依赖，再更新本地台账的 `GitLab IID/URL`、`GitLab 状态`、`本地状态`、`同步状态` 和 `最后回读`。稳定编号规则仍维护在 `issue-id-map.md`，不要把动态执行状态塞回编号表。关闭前核对验收与交付记录；不能把本地文件变更或 API 请求已发出说成 GitLab 已同步。

## 仓库状态同步

GitLab 工作项创建后，远端回读是实时协作事实，`docs/agent-platform/task-confirmation-register.md` 是仓库内可审查的状态快照。创建、修改父项/依赖/标签/状态、关联 MR 或关闭工作项时，在同一工作时段更新对应行：

1. 写入前同时读取本地行和 GitLab 当前值；两边都发生不同变更时标记 `conflict`，先人工合并，不能直接覆盖。
2. 本地决定尚未写远端时标记 `local-newer`；发现远端更新尚未落库时标记 `remote-newer`。
3. 远端写入后必须回读；一致后填实际 IID/URL、state、`status::*`、MR、时间并标记 `in-sync`。
4. 只记录过程的普通评论不复制进台账；评论改变状态、范围、依赖、验收或交付证据时更新对应字段和备注。
5. 关闭时本地状态填 `closed`，记录最终 MR 和 merge commit 证据；暂缓或明确不发布的卡使用 `deferred`，保留原因。

本地状态快照的提交与推送遵循 MR 工作流；暂时无法提交时如实保留 `remote-newer`，不要把未入库状态说成已同步。

## 处理中的评论

真实工作项在处理期间，遇到可验证的阶段结果、阻塞或解除、范围/契约决定、验收证据变化时，在**对应工作项**下补一条有时间上下文的评论。正文保留稳定的目标、范围和验收；阶段过程写评论，决定改变了范围或依赖时还要同步正文及下游。不要按每次提交机械刷评论，也不要把未验证的尝试写成完成。

评论简要写明“本次进展或问题、证据链接/固定 SHA、对验收或下游的影响、下一步或待谁决策”；若关联 MR，附真实 MR URL。写入前核对项目、工作项和身份；写入后回读评论 ID 与内容。关闭时的交付记录是最后一条明确的结果评论，不替代过程中的关键决策记录。

```markdown
### 进展更新
- 已完成/发现：本次有意义的变化
- 证据：MR、固定 SHA、测试或回读结果
- 影响：验收项、范围、依赖或下游变化；没有则写“无”
- 下一步：下一动作或需要谁确认什么
```
