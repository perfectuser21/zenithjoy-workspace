# 飞书版发布编排台 + 通用发布 rollup（line01 刀5b）

> Brain task 2ab41fd8 · golden_path c5c0e259 · 分支 cp-09092000-feishu-orchestrator
> 设计审查 APPROVE（4 条落码条件已并入）· 镜像对象：services/notion-orchestrator.ts

## 组件

### 1. 共享回执聚合 helper + 通用 rollup sweeper（还刀5a 终审 P2-2/P2-3 债）

`services/publish-receipts.ts`：
- `aggregateLatestReceipts(tenantId, contentIds)` → `Map<cid, Array<{platform,status,result}>>`——**latest-wins**（DISTINCT ON (cid,platform) ORDER BY created_at DESC），**带 result 列**（notion 回执要 dump）。SQL 与刀5a 列表端点同款语义；改造列表端点与 notion syncReceipts 共用它（注意 publish-dispatch.test.ts:485 的 DISTINCT ON 正则守卫——helper SQL 保持能过正则）。
- 终态判定复用 `NON_TERMINAL_TASK_STATUSES` + `SUCCESS_STATUSES = ['done','completed','success']`（从 notion-orchestrator 抽到本模块 export，notion/feishu/前端注释同源）。

`services/publish-rollup.ts` sweeper（60s，骨架照 worker-lease-sweeper+running 互斥）：
- 只处理**无编排台锚**的 queued 作品：`WHERE status='queued' AND notion_page_id IS NULL AND feishu_record_id IS NULL`（全租户——dashboard 直派的客户作品从此不再永锁 queued）
- 每作品：aggregateLatestReceipts → tasks.length===0 skip（派发进行中守卫）→ **先 latest-wins 再判 allTerminal**（重发后新 pending 行必须让它等待）→ 全终态：全 SUCCESS→'published'，否则→'failed'
- 注释点明与 workbench-rollup.service.ts（路③工作台）无关
- index.ts VITEST 门控挂载（无 env 依赖，永远启动）

notion-orchestrator.syncReceipts 改造：聚合段换 helper（修 P2-3：历史 failed 行不再永锁"部分失败"），行为断言不变（全终态才写、挪出 queued、1900 截断）。

### 2. 飞书轻客户端 `services/feishu-client.ts`

- token：全局 env 路线（FEISHU_APP_ID/SECRET → /auth/v3/tenant_access_token/internal），**模块级缓存**（expire 7200s，提前 5min 刷新，照 feishu-token.ts 阈值惯例；导出 `_resetTokenCache()` 供测试）
- `feishuRequest(method, path, body?)`：FEISHU_API_BASE 可注入（fake-server CI 惯例，multitenant.ts:25 同款）；错误收敛不泄 token（同 notion-client 纪律）；code=1254290（频控）→ 抛可识别错误供 worker 跳过本轮
- 现成范本：feishu-bitable.ts / feishu-bitable-multitenant.ts（建 app/建表/写行）；records/search 与 update 为净新

### 3. migration + 一次性建表脚本

- `contents 加 feishu_record_id TEXT`（照 notion_page_id 那条幂等模板；COMMENT 写明"飞书发布编排台行锚，与 Line04 的同名列无关"）+ 部分索引 `(tenant_id) WHERE feishu_record_id IS NULL`
- `apps/api/scripts/create-feishu-orchestrator-table.mjs`：建 Bitable app「发布编排台」+ 表，字段（**类型号写死**）：标题(1)/文案(1)/素材(1)/回执(1)/content_id(1)、状态(3 单选,6 值预置)、平台(4 多选,9 白名单预置)、预览(15 超链接)；`drive/v1/permissions/{app_token}/members?type=bitable` 把 ADMIN_FEISHU_OPENIDS 加 full_access 协作者；输出 FEISHU_ORCH_APP_TOKEN/TABLE_ID

### 4. `services/feishu-orchestrator.ts` worker（镜像三方向）

- env：FEISHU_ORCH_APP_TOKEN / FEISHU_ORCH_TABLE_ID / FEISHU_ORCH_TENANT_ID（+复用 FEISHU_APP_ID/SECRET）；缺任一→红日志跳过启动
- **互斥（单边拒启）**：`FEISHU_ORCH_TENANT_ID === NOTION_ORCH_TENANT_ID` 且后者非空 → 红日志"与 Notion 编排台租户冲突，拒绝启动"return null（防同租户双推双发；notion 侧不加检查防互相拒启死局）
- 推行：draft+feishu_record_id IS NULL+tenant → 建行（POST records）→ 回写锚。**值形态（镜像最大错误面，合同断言写死）**：多选=字符串数组 `['douyin']`；单选=裸字符串 `'草稿'`；URL=`{text:'预览', link:url}`；文本=裸字符串
- 拉发：`POST records/search` filter 状态='发'（has_more/page_token 分页）→ 读回形态：文本=segment 数组需 `plainText()` 拼接、单选=字符串、多选=字符串数组 → content_id UUID 校验/白名单过滤/终态拒重派/AlreadyQueued 幂等——错误翻译表与 notion 版逐条同
- 回执：`feishu_record_id IS NOT NULL AND status='queued'` → helper 聚合 → 全终态写行（PUT records/{id}）+ contents 挪出 queued。回执文本截断沿用 1900（统一口径）；**文案字段拉发回写不截断**（Bitable 无 2000 限制，别毁长文案）
- 60s 轮询/running 互斥/catch 只打 message/token 不进日志

### 5. env-registry 登记（env-gate 闸）

FEISHU_ORCH_APP_TOKEN / FEISHU_ORCH_TABLE_ID / FEISHU_ORCH_TENANT_ID 三条 + reason。

## 测试策略

- unit/integration（mock pg + mock feishu-client）：helper latest-wins（同平台新 done 旧 failed 取 done）/rollup（无锚才处理、tasks=0 skip、重发后 pending 等待、全成 published/有败 failed）/notion syncReceipts 改造后既有 11 测试保绿+新增"历史失败行不再污染"用例/feishu worker 三方向（值形态断言：多选数组/单选字符串/URL 对象/segment 拼接）/互斥拒启/token 缓存（两次调用一次 token 请求）
- smoke [CONFIG]：无 FEISHU_ORCH env 时 API 健康 + rollup sweeper 真链路一步（种无锚 queued 作品+终态任务→等 sweeper 或直调导出的 runOnce → psql 断言 status='published'——sweeper 无外部依赖可真验）
- staging 真验：建表脚本真跑（表出现在飞书+主理人可见）→ 种测试租户配 FEISHU_ORCH_TENANT_ID → 四条镜像验收（传素材→行出现；改'发'→派发；伪终态→行回执+contents 收敛；互斥场景日志）

## 不做

多租户配置表（v1 env 单租户）；Notion↔飞书双向迁移；PATCH 回写编排台行；飞书消息通知。
