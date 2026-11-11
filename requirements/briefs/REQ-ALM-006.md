# REQ-ALM-006 DSH需求插件跨智能体JSON与Excel安全导入导出

## 目标
提供真实UI文件交换、基于稳定身份的三向合并、安全校验和批次原子性，并限定于验证环境交付与真实Desktop验证。

## 执行协调与冻结测试契约

本需求为INT-20261104073918-aabf4b澄清后通过插件create API显式编号接力创建，原confirm因旧孤儿brief005冲突未成功，不得伪称confirm成功。用户授权已存在，不伪造正式签收或发布权力。

实现可测领域模块 `packages/alm-core/src/requirements/exchange.mjs`：`exportRequirements({root,format:'json'})` 返回交换payload本体；`previewRequirementsImport({root,payload})` 返回 `{ok,conflicts:[],localHash,changes:[]}`；`applyRequirementsImport({root,payload,expectedLocalHash})` 返回 `{applied:boolean,idempotent:boolean}`。同步或async均可。顶层 `schema:'alm.requirements.exchange/v1',exportId,projectId,records`；记录 `{uid,projectId,base:{title,brief,priority,owner},baseHash,values:{title,brief,priority,owner},attachments:[]}`。可增字段，不可破坏该外部冻结测试入口。XLSX/API/UI同样必须实现，不以最小JSON验收替代全部业务。

观察员冻结测试在 `artifacts/requirements-collaboration-loop/observer/`，只读不可修改。实现者仅修改feature相关源代码、自己的测试和必要文档/构建产物，不动其他既有变更。不要清理/reset/提交整个仓库；不要另开需求。暂不修调查证据序列化或ID分配两个独立流程缺陷；第二轮只会选择一项。先更新产品/架构文档再实现，结束输出实际改动、测试、HTTP协议与构建信息。当前仓库脏状态已有内容快照，不要从纯HEAD新建空工作树丢掉基线。

## 问题与场景
为DSH现有需求插件实现面向跨智能体协作的需求导入导出。用户已授权按此方案开发并在验证环境交付，不是连接远端系统。
范围：原生JSON结构化交换包（需求正文与附件manifest）和Excel .xlsx可编辑子集，均需真实UI导出/选择文件导入/预览/确认与结果回执。以项目ID+稳定需求UID识别，绝不按标题猜测。交换包含schema版本、exportId、projectId、导出时基线B及hash；回导用B/当前L/外部E三向合并：仅外部修改且本地未改可合并，同字段双方不同修改明确冲突拒绝，不猜测覆盖；缺行不删除本地需求；重复导入幂等。新建必须明确标记，禁止伪造UID覆盖异项目；导入前检查项目、版本、字段类型、大小、附件路径安全和公式注入，拒绝损坏或不支持文件。单批次全有或全无，冲突/验证失败不能留下半写入。可编辑字段只包括title/brief/priority/owner，UID/project/基线只读；不导入执行状态、签收、验收证据、发布授权等可信权力。附件仅安全manifest、不承诺二进制打包。Excel保留元数据和基线，非可编辑列修改应拒绝而非静默改变。包含中文、多行、空值、无改往返、不同字段合并、同字段冲突、重复回导、错误项目/版本、缺行、批量回滚、越界路径与伪证据负例。Word/PDF、在线集成、自动删除不在本轮范围。
开发前通过现有插件澄清确认，再由插件创建的执行agent实际写仓与注册验收。已有工作区变更必须保留，不清理或重置、不改写冻结验收。P2，负责人留空。仅验证环境部署/真实Desktop验证，不代表人工正式签收和生产发布授权。
澄清补充：对既有系统未知的工程细节作为本需求开发设计与验收任务，不宣称已存在；不要将新能力尚未实现当成禁止创建需求的条件。已有UID与项目等以实际源码为准。用户已接受上述业务边界与P2，负责人空。
冻结澄清正文：
{
  "schema": "alm.requirement.doc.draft/v1",
  "requirementId": null,
  "revision": null,
  "docHash": "sha256:1aafe399c9d5357f74ddabe33b87b162f53ff67d23c7100e07bfc4f44df034fd",
  "title": "",
  "goal": "为DSH现有需求插件实现面向跨智能体协作的JSON及Excel需求文件导入导出，在验证环境交付并完成真实Desktop验证，不连接远端系统。",
  "problem": "用户需要通过现有需求插件交换需求正文和附件manifest，并安全回导外部编辑结果。",
  "features": [
    {
      "id": "FR-01",
      "title": "真实UI文件交换",
      "behavior": "支持原生JSON结构化交换包和Excel .xlsx可编辑子集的导出及选择文件导入，提供预览、确认与结果回执。",
      "preconditions": [],
      "response": "通过真实UI完成文件交换流程。",
      "boundaries": [
        "JSON包含需求正文和附件manifest。",
        "附件仅提供安全manifest，不承诺二进制打包。",
        "不包含Word/PDF或在线集成。"
      ],
      "sources": [
        "user-input#L5",
        "user-input#L6"
      ],
      "provenance": "user-stated"
    },
    {
      "id": "FR-02",
      "title": "稳定身份与交换元数据",
      "behavior": "交换包含schema版本、exportId、projectId、导出时基线B及hash，以项目ID和稳定需求UID识别需求。",
      "preconditions": [],
      "response": "新建必须明确标记，不按标题猜测，不允许伪造UID覆盖异项目。",
      "boundaries": [
        "已有UID与项目等以实际源码为准。"
      ],
      "sources": [
        "user-input#L6",
        "user-input#L8"
      ],
      "provenance": "user-stated"
    },
    {
      "id": "FR-03",
      "title": "三向合并与原子回导",
      "behavior": "回导使用基线B、当前L和外部E三向合并；仅外部修改且本地未改可合并，同字段双方不同修改明确冲突拒绝。",
      "preconditions": [
        "回导文件包含基线及身份信息。"
      ],
      "response": "不猜测覆盖；缺行不删除本地需求；重复导入幂等；单批次全有或全无，冲突或验证失败不留下半写入。",
      "boundaries": [
        "包含不同字段合并和同字段冲突验证。"
      ],
      "sources": [
        "user-input#L6"
      ],
      "provenance": "user-stated"
    },
    {
      "id": "FR-04",
      "title": "可编辑字段与信任边界",
      "behavior": "仅允许编辑title、brief、priority、owner；UID、project、基线只读。",
      "preconditions": [],
      "response": "Excel保留元数据和基线，非可编辑列修改应拒绝，不静默改变。",
      "boundaries": [
        "不导入执行状态、签收、验收证据、发布授权等可信权力。"
      ],
      "sources": [
        "user-input#L6"
      ],
      "provenance": "user-stated"
    },
    {
      "id": "FR-05",
      "title": "导入前安全验证",
      "behavior": "导入前检查项目、版本、字段类型、大小、附件路径安全和公式注入。",
      "preconditions": [
        "用户选择待导入文件。"
      ],
      "response": "拒绝损坏或不支持文件，验证失败不得留下半写入。",
      "boundaries": [
        "包含错误项目、错误版本、越界路径与伪证据负例。"
      ],
      "sources": [
        "user-input#L6"
      ],
      "provenance": "user-stated"
    }
  ],
  "scope": [
    "原生JSON结构化交换包及Excel .xlsx可编辑子集。",
    "真实UI完整文件交换流程。",
    "三向合并、幂等回导、批次原子性及导入安全检查。",
    "中文、多行、空值、无改往返与用户列明的合并、冲突及安全负例验证。",
    "验证环境部署与真实Desktop验证。"
  ],
  "outOfScope": [
    "Word/PDF。",
    "在线集成、连接远端系统。",
    "自动删除。",
    "附件二进制打包承诺。",
    "导入可信权力。",
    "人工正式签收和生产发布授权。"
  ],
  "acceptance": [
    {
      "id": "AC-01",
      "featureIds": [
        "FR-01"
      ],
      "text": "JSON和.xlsx均通过真实UI完成导出、选择文件导入、预览、确认及结果回执。",
      "precondition": "使用本轮支持的JSON或.xlsx文件。",
      "action": "分别通过真实UI进行导出及选择文件导入，查看预览并确认。",
      "expected": "两种格式均提供所要求的UI流程和结果回执。",
      "judgement": "真实Desktop验证上述操作链路。",
      "sources": [
        "user-input#L6",
        "user-input#L7"
      ],
      "provenance": "user-stated"
    }
  ],
  "constraints": [
    "开发前通过现有插件澄清确认，再由插件创建的执行agent实际写仓与注册验收；此处仅记录用户提出的流程约束。",
    "保留已有工作区变更，不清理、不重置、不改写冻结验收。",
    "未知工程细节属于本需求开发设计与验收任务，不宣称已存在。",
    "已有UID与项目等以实际源码为准。",
    "仅验证环境部署及真实Desktop验证，不等于人工正式签收或生产发布授权。"
  ],
  "pending": [
    {
      "id": "Q-01",
      "text": "核对源码中的项目、UID、字段模型、UI入口、执行agent及验收注册机制；属于工程调查，不作为重复询问用户的业务决策。",
      "status": "open"
    },
    {
      "id": "Q-02",
      "text": "明确schema支持版本、hash与基线表示、大小限制、字段类型、安全检查和原子回导实现，并形成可验证条款；不得虚构当前系统已有这些能力。",
      "status": "open"
    },
    {
      "id": "Q-03",
      "text": "中文、多行、空值、无改往返及不同字段合并已被用户列为验证范围；具体数据、动作序列和判定方法尚未完整展开，待设计验收用例。",
      "status": "open"
    },
    {
      "id": "Q-04",
      "text": "错误项目/版本、损坏或不支持文件、越界路径、公式注入和伪证据负例需补充具体输入样例及可观测判定方式，不自行添加未说明的阈值或可信字段处理规则。",
      "status": "open"
    },
    {
      "id": "Q-05",
      "text": "新建标记的具体表示、生成合法新UID的方式及重复回导识别机制待结合源码设计；不改变新建明确标记、禁止跨项目伪造覆盖和重复导入幂等的既定边界。",
      "status": "open"
    },
    {
      "id": "Q-06",
      "text": "[验收建议·AI 建议] AC-02 仅外部修改且本地未改的字段可合并，同字段双方不同修改明确冲突拒绝。",
      "status": "open"
    },
    {
      "id": "Q-07",
      "text": "[验收建议·AI 建议] AC-03 重复回导幂等，缺行不删除本地需求。",
      "status": "open"
    },
    {
      "id": "Q-08",
      "text": "[验收建议·AI 建议] AC-04 批次内存在冲突或验证失败时全批次不留下半写入。",
      "status": "open"
    },
    {
      "id": "Q-09",
      "text": "[验收建议·AI 建议] AC-05 修改Excel非可编辑列后回导应被拒绝。",
      "status": "open"
    }
  ],
  "meta": {
    "nextFr": 6,
    "nextAc": 2,
    "confirmedAt": null
  },
  "draftRevision": 1,
  "basedOnInputRevision": 3,
  "basedOnSessionRevision": 4,
  "legacy": false
}
人工补充验收：
[]

<!-- alm:meta {"nextFr":1,"nextAc":1,"confirmedAt":null,"docHash":"sha256:e68031c6a18cd3e3f7fc66132c31501de4b35c3c674ae5eaeb3a011238e042ab"} -->
