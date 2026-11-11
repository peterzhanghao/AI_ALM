# 原生部署验证桥（限定 bootstrap 能力）

独立生命周期桥只处理可信原生人类动作授权的 D:/DSH requirements 插件部署作业。固定构建配方、隔离输出、输入身份检查、HMR串行安全激活、新实例重新验收/生成候选、固定同源只读浏览器验证。无任意命令、目录、包安装、执行agent权限提升、人类签收或发布。作业记录 .alm/native-delivery，构建与截图 tmp；观察资料不能写入候选工件树。

start 接收 root/requirementId/subject/source；只有既有可信路由解析的 human subject 可请求，任意额外参数拒绝。get 返回job。registerTarget 提供 inspect/handoff/reverify/identity 回调，旧实例disposer只清自己。加载sourceBuildId必须与本次构建对应；重验必须真实生成新candidate，不延用旧pass。失败保存失败终态，Host不默默提升权限或绕过EPERM。

此包需要单独受信bootstrap加载；本次能力安装不是历史RUN009自主交付。HMR与浏览器provider失败如实失败，无fallback绿。GUI只读场景由固定产品测试契约断言，必须同时保留DOM与截图；不接受模型传入JS/selector/URL。

GUI predicate v2（按真实产品DOM修正，不修改独立冻结业务判定）：全部详情查询限定真实 [data-detail-page=v4] 页面，内部叶子 header 的 data-detail-id 必须精确匹配作业需求；技术 sections 是 header 的兄弟而非后代。正文要求 canonical 非空需求描述 section 与交付验证/人工门禁说明。技术页要求真实 delivery tab、run/AI建议/验收/candidate/release/trace 六区和非空 outcome；attention 仅有问题时存在，不作为必需区。对非空技术区及 outcome 文本整体检查完整旧阻断句（规则评审未运行、0/5视角），不扫描需求标题/正文中的历史描述。两视图必须同一真实 Client mount 与编译身份。缺区、空结果或旧阻断句均失败。
