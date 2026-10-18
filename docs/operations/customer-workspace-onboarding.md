# 客户独立工作台开户

模板定义：`apps/api/src/services/customer-workspace.ts`。基础11类＋可选leadgen5类。模板是共享定义，每家公司独立创建外部库；公司内部按部门组织内容。接口位于`/api/internal/customer-workspaces`，所有接口必须具有已配置的`ZENITHJOY_INTERNAL_TOKEN`服务凭据，缺配置直接503；不是公开客户入口。

## 登记与运行

1. 通过已有公司开户/资料流程取得真实company_id和tenant_id，不自行编造。
2. 确认Notion集成可访问客户批准的父页面，或飞书应用有客户批准base的权限。读取成功只证明可读；首次创建与读回才证明所需操作可完成。此流程不设置分享权限。
3. `GET /template?module=leadgen`检查16对象定义。`POST /:companyId/bind`请求体为`tenant_id,platform,parent_id,modules:["leadgen"],approved_parent:true`。可选`credential_ref`须为`CUSTOMER_WORKSPACE_NOTION_*`或`CUSTOMER_WORKSPACE_FEISHU_*`环境引用，凭据仍由1Password提供。省略时复用该部署的`NOTION_INTEGRATION_TOKEN`或`FEISHU_TENANT_ACCESS_TOKEN`，后者须为有效令牌。
4. 按现行迁移部署流程安装映射表，设置`CUSTOMER_WORKSPACE_PROVISIONING_ENABLED=true`。index启动worker，每30秒检查至多2个pending/provisioning项；PG advisory lock覆盖完整外部动作。默认关闭不会触发任何外部创建。
5. `GET /:companyId`检查逐资源checkpoint、错误、更新时间。返回202只表示登记成功；worker_enabled=false代表尚未运行。structure_ready只表示11/16个库字段与目标读回一致，data_sync_status仍为not_connected。

## 恢复与身份

Notion UUID统一32位小写，数据库canonical唯一索引防别名重复绑定。平台父位置唯一属于一家公司。每个外部库带company+tenant+object稳定标记；列表必须完整分页，缺列表/游标字段即拒绝。

外部POST前将creating写入PG并记事件，响应丢失/5xx/无ID均保留未知。续跑找到唯一原资源后复用并验证；未知且找不到不能再次POST。明确400/401/403/404/413/422/429拒绝可在修复授权或输入后重新尝试。

修复后调用`POST /:companyId/reconcile`，提交`platform`和上次GET的`expected_updated_at`；版本变化返回409。该接口只恢复检查，不清空逐资源创建意图。重复候选或实际schema漂移必须核查原目标，不猜测、不自动删除重建。

## 后续数据接入

部署与生效配置继续引用Brain及现行业务提供方，文档保留知识真身，凭据只进1Password。产品、画像、关键词回灌需走原公司资料expected_version和草稿确认流程；设备状态、账号核验、任务/运行/发送事实是只读投影。此版本未接通这些数据消费者，不能把空表或模拟协议测试作为客户完整交付。

## 已验收样板（2026-10-18）

| 公司 | 独立工作台 | 初次快照 |
|---|---|---|
| 金诺盛源 | https://app.notion.com/p/3fdc40c2ba63815aa734dd37a07f7c0f | 16库，67条资料，来源版本14 |
| 悦升云端 | https://app.notion.com/p/3fdc40c2ba6381a3ae03cd09a8cc9428 | 16库，73条资料，来源版本26 |

两家均逐库逐行独立读回，首页含公司基本资料、查看顺序及未启用同步提示。快照仅包含产品、画像、关键词、4个流程与原说明文档引用；其他库的数据消费者、持续同步、编辑回灌和客户访客访问尚未验收。分享权限保持原样。

综合CI的每个隔离分片显式安装并编译services/agent，供既有uptime smoke检查dist产物；不能依赖其他smoke碰巧同组且先执行。原分片、基线失败语义与超时预算保持不变。
