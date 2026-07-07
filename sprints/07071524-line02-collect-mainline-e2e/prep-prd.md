# Bug PrepPRD：智能获客采集主链断链 —— 网页点关键词手机不动，修通四步贯穿（第一刀）

## 症状
用户在 dashboard 智能获客页输入关键词点搜索，安卓机（Honor100）不动、采集主链跑不通。

## 根因假设（已通过代码排查确认）
`POST /api/acquisition/keyword-search`(apps/api/src/routes/acquisition.ts:31) 建的采集任务 tenant_id=NULL：
- handler 没挂任何租户中间件，只读 X-Tenant-Id 头 / body.tenant_id（都没传）；
- 前端 AcquisitionConfigPage 发 keyword-search 只带 {keyword}，不带租户。
→ 任务落库 tenant_id=NULL → `pending-keyword-tasks`(acquisition.ts:118) 用 `WHERE tenant_id=$1` 过滤 → 安卓 agent 永远拉不到 → 手机不动（P0）。
附带断点：AcquisitionConfigPage 发 A 表(keyword)任务却读 B 表(collect-tasks)列表（两套管线没对齐）；采集无障碍服务 DouyinCollectService 真机没授权、全链（搜索→视频→评论）从未验证。

## 关联上下文
- Journey：客户智能获客路径（afa6abca-53c0-4815-8594-b7fb81ca547f，Notion 368c40c2-ba63-8120-86a9-c8739cde0d2a），Path2 Step8 评论区挖客闭环。
- 无直接相关历史 Issue/decision（本断点新摸出）。
- 平行参照：warmup 中台调度接线（PR#1151）刚真机端到端验通，本刀照其"网页触发→真机→回传→展示"范式，但采集走 keyword 管线。

## 第一刀 Golden Path（用户视角，1 个关键词「麻婆豆腐」）
1. staging 网页智能获客页输入「麻婆豆腐」点搜索 → 系统建**带用户租户**的采集任务 → 页面显示"采集中"
2. Honor100 被唤醒 → 自动打开抖音搜「麻婆豆腐」→ 点开第 1 条爆款视频
3. 打开评论区 → 抓留言人 → 每个写成 1 条 Lead
4. Lead 页冒出这些留言人（潜在客户）
5. 对其中 1 个 Lead 触达：**真发 1 条私信/回评（带企微号）** → 看到真发送 + 回执

出错路径：采集中掉线 / 抖音没登录 / 搜不到 → 任务标 failed + 页面显示失败原因 → 用户知道要重试。

## 修法（第一刀范围）
1. 修 P0 租户断链：`/keyword-search` 挂租户解析（tenantContextOptional / session）+ 前端 AcquisitionConfigPage 带租户（X-Tenant-Id）→ 任务 tenant_id 非空且与安卓 agent license 租户一致。
2. 前端这页发/读对齐到同一 keyword 管线（点了能看到任务在跑）。
3. Honor100 授权采集无障碍服务 DouyinCollectService（真机操作，开发者做）。
4. 真机验前三步：搜索→第1条视频→抓评论→出 Lead→Lead 页展示。
5. 第4步真发 1 条触达（企微号真机验收时由用户提供，缺则先发话术不带号）。

## Regression Test 计划（先写 failing test）
- 逻辑守卫：`keyword-search` 建任务后，`pending-keyword-tasks` 以**同租户** agent 身份查询应拉到该任务（现在因 tenant_id=NULL 拉不到 → RED）；修 P0 后变 GREEN。永久留 CI。
- 真机接缝守卫：采集是安卓真机接缝，CI 测不到 → 靠 smoke（curl 造带租户 keyword 任务 + 查 pending-keyword-tasks 能拉到 + 造 comment-score-result 回传 + 查 acquisition_leads 落库）+ Honor100 真机端到端为验收。

## 不包含（下一刀加厚）
- 视频抓成 list（第一刀只 1 条视频）；视频维度回传写库（TasksPage 视频卡）；多关键词/自动选词。

## 前置工作
- [x] staging :5201 已起（f327450e/1.0.1，zenithjoy_test）
- [x] Honor100 已装含最新代码 debug 包、repoint staging、在线心跳（agent id=3c104bfc，tenant=59532559 Personal-tmp-hash2）
- [x] 抖音小号已登录（秦军餐饮4768/大湖1196）
- [x] 关键词「麻婆豆腐」
- [ ] 采集无障碍服务 DouyinCollectService 授权（真机操作，开发中做）
- [ ] 引流企微号（第4步真发用；真机验收时用户提供，缺则先发话术不带号）

## 验收标准（Final E2E）
- [ ] failing test 先 commit（同租户拉 keyword 任务，RED）
- [ ] 修复让 test 变绿（P0 修复，GREEN）
- [ ] smoke：带租户 keyword 任务全链（下发→拉取→回传→Lead 落库）真库通
- [ ] Honor100 真机：网页点「麻婆豆腐」→ 手机被唤醒搜索→抓评论→出 Lead→Lead 页展示（前三步硬验收）
- [ ] 第4步真发 1 条触达 + 回执（企微号到位时）
- [ ] CI 全绿
