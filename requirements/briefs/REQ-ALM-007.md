# REQ-ALM-007 修复只读调查证据消息预算分配导致源码片段丢失

## 目标
仅修改investigate消息预算分配及相应文档和测试，在既定总消息不超过25000字符内优先保留可验证源码证据，保持完整可解析JSON和既有安全边界，并通过冻结测试与真实Desktop重放验证。

## 执行协调（用户已授权第二轮）

本轮必须由需求插件创建的执行agent实现；Lead/observer只提供真实证据、登记门禁与独立验证。已有大量dirty工作，不reset/stash/整体commit，不修改observer冻结文件或其断言。仅允许investigate.mjs消息序列化、对应产品/架构/README及测试；不修其他优化，不添加自动需求。

冻结原gate artifacts/requirements-collaboration-loop/observer/check-investigation-message-budget.mjs SHA6bba104f5374f70be56816b1fd0fbbf447a7fa6602cca4310841679d06968936；baseline实际exit1、24053chars、四项fail/预算pass，见observer/b-investigation-baseline.log。source原SHA8345eb8bd4aad7a6fd3c039337dd99a1194c963250fe8e225b7b3cc30f852b39。文档先行。保持总消息<=25000，不增budget、不整体截断。不要创建/修改verified_by关联以免重现OPT10导致已授权hash变化；本需求已有结构化FR/AC，验收命令Lead先登记，测试代码直接加不等于新验收资产。若确需改变需求身份，明确停止申请，不改授权。候选/人工签收/发布不能伪造。agent子环境若spawn EPERM保留日志，Lead自身允许环境运行独立验证，不假装你已构建通过。

## 问题与场景
用户报告需求插件只读调查中源码片段因消息预算序列化而丢失：collectEvidence已有60条snippet，但800条repo.tree先序列化，约89k的JSON在24k整体切断，所有snippet都在截断之后；三次真实调查均为not-determined/0 findings。本草稿未将报告内容视为已独立核查的工程事实。

## 详细功能
### FR-01 预算内优先保留可验证源码证据
- 行为：investigate消息在既定总消息不超过25000字符内，优先保留可验证snippet及其path、起止行和逐字quote；tree和文件元数据按剩余预算裁减。
- 前置：investigate组织调查证据消息。
- 响应：输出完整可解析的结构JSON，显式包含原始、保留、遗漏计数与预算。
- 边界：不得简单加大token预算。
- 边界：不得整体substring截断。
- 来源：user-input#L1

### FR-02 保持只读调查与引用安全边界
- 行为：保持read-only、root path、引用逐字核对及现有安全边界，无可用证据时诚实表达未知。
- 前置：进行只读调查及证据引用。
- 响应：不产生写入、签收或执行权力，不制造固定finding数量。
- 边界：验证环境加载不等于正式人类签收或发布授权。
- 来源：user-input#L1

## 本次范围
- 仅创建一条独立需求的正文草稿。
- investigate消息预算分配及相应文档和测试。
- 原冻结budget脚本验证、既有调查安全测试、全量回归。
- 构建重载同一Desktop后的第一次调查问题重放及每一步真实记录。

## 不包含
- 编号碰撞。
- 模板。
- 评审残留。
- 子会话可见性。
- 其他非本次消息预算问题。

## 验收要求
- AC-01（FR-01）原冻结budget脚本从baseline失败变为全通过。
  - 前置：使用artifacts/requirements-collaboration-loop/observer/check-investigation-message-budget.mjs原冻结脚本。
  - 动作：记录baseline并对修复后的消息预算实现运行该脚本。
  - 预期：baseline失败，修复后全通过。
  - 判定：核对原冻结脚本及真实运行记录。
  - 来源：user-input#L1
- AC-02（FR-01、FR-02）既有调查安全测试和全量回归无放宽。
  - 前置：消息预算修复及相应文档、测试变更可供验证。
  - 动作：运行既有调查安全测试和全量回归，并核对变更。
  - 预期：既有调查安全测试和全量回归无放宽，维持现有安全边界。
  - 判定：依据真实测试记录和变更内容核对，不以放宽测试替代修复。
  - 来源：user-input#L1
- AC-03（FR-01、FR-02）构建重载同一Desktop后重放第一次调查问题，记录真实效果和未知。
  - 前置：构建重载同一Desktop，并从真实记录取得第一次调查问题。
  - 动作：重放第一次调查问题并留存过程记录。
  - 预期：记录消息字数、可用snippet、可核对引用、耗时、有效回答和未知；不以单测或finding数量单独证明经济价值。
  - 判定：检查真实重放及逐步记录是否覆盖上述内容；经济价值不凭单测或finding数量单独判定。
  - 来源：user-input#L1

## 必要约束
- 既定总消息不超过25000字符。
- 优先保留可验证snippet及path、起止行和逐字quote。
- 输出完整可解析JSON，显式原始、保留、遗漏计数与预算。
- tree和文件元数据仅按剩余预算裁减，不简单增加token预算或整体substring截断。
- 保持read-only、root path、引用逐字核对及现有安全边界。
- 无可用证据时诚实未知，不制造固定finding数量。
- 每一步留真实记录，不臆造现有事实。
- 工程能力未知作为实现调查内容，不据此阻止形成独立需求草稿。
- 本草稿不代表采纳、开工、验收、授权或发布。

## 待确认
- [ ] Q-01 实现调查：核对用户提供的证据文件、冻结脚本、当前代码和预算口径；本轮未读取这些文件，不声称已复现。
- [ ] Q-02 实现调查：从真实记录取得第一次调查问题、同一Desktop环境信息、既有安全测试及全量回归入口；不得编造问题、操作路径或运行结果。
- [ ] Q-03 用户要求记录有效回答和经济价值相关证据，但未给出量化价值通过阈值。本草稿仅保留其明确的记录与判定限制，不新增耗时、snippet或finding数量门槛。
- [ ] Q-04 P2及负责人不指定为用户明确表达、待人工确认的信息；未写入候选优先级或负责人字段。

<!-- alm:meta {"nextFr":3,"nextAc":4,"confirmedAt":"2026-11-04T09:06:40.734Z","docHash":"sha256:df493559dddea29b50a9946ae1a546a94a1ef31b10782d1a4f497db6d34c8599"} -->
