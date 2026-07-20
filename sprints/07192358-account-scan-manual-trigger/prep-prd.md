# 小改动 PrepPRD：Path2 账号扫描补手动触发通道（30-60分钟被动轮询 → 最长约30秒）

## 改什么

三处联动，照抄已验证过的 DM 派单模式（`dispatchDue`/`routeDmOutreachTask`）：

1. **API 新增触发端点** `POST /api/agent/account-scan/trigger`（`apps/api/src/routes/agent-burner.ts` 或 `agent.ts`，具体挂哪个文件按现有相邻端点归属对齐）：
   - 入参：`tenant_id`（走现有租户鉴权中间件）
   - 逻辑：查该租户 online 的 android agent（`agents.tenant_id=$1 AND capabilities @> '{android}' AND last_heartbeat_at > now() - interval '2 minutes'`），没有在线设备 → 400 返回明确错误（不静默排队）；有 → `INSERT INTO zenithjoy.publish_tasks (agent_id, platform, status, task_type, payload, tenant_id) VALUES ($1, 'douyin', 'queued', 'account_scan', '{}'::jsonb, $2)`（`type` 列不设，走默认 `'image'`，与 dm_outreach 现有模式一致，`publish_tasks_type_check` 约束不受影响）
   - **限流（Agent D 补的 NFR）**：同一 agent 60 秒内只允许触发一次（查最近一条 `task_type='account_scan'` 的 `created_at`），防止用户连点按钮把无障碍服务打崩

2. **Android `AgentService.kt` WS 消息处理新增分支**（`apps/api/src/routes` 对应的 client 侧，`services/agent-android/.../AgentService.kt` heartbeatLoop 的 `onTask` 回调里）：
   - 新增 `shouldRouteAccountScan(payloadTaskType: String?): Boolean = payloadTaskType == "account_scan"`（与 `shouldRouteWarmup`/`shouldRouteDmOutreach` 同一模式）
   - 命中时调用 `DeviceAccountScanService.dispatchTask(this@AgentService, task.task_id, tenantId = "", thisDeviceId = config.machineId)`（`tenantId` 按既有安全约定传空字符串，不信任设备侧值，服务端按 `agent_id` 反查真实 tenantId——同现有 `runAccountScanLoop` 调用方式）
   - **不需要新增去重/重入保护**：`DeviceAccountScanService` 已有 `state != State.IDLE` 早退判断（`DeviceAccountScanService.kt:58,79`），手动触发和内部 30-60 分钟循环触发共享同一把状态锁，天然互斥，不会并发跑两次扫描

3. **Dashboard "立即扫描" 按钮**（`AcquisitionAccountsPage.tsx`，Android 绑定卡片区域）：
   - 点击后调用触发端点，成功后展示"扫描请求已发送，等待手机端处理…"的提示（不承诺具体秒数——诚实反映延迟依赖 ws1 心跳 30 秒周期，最坏情况接近 30 秒，不是精确的 3-5 秒）
   - 60 秒内重复点击 → 前端本地禁用按钮 + 倒计时（配合后端限流，两层防护）
   - 设备离线（后端返回 400）→ Toast 提示"未检测到在线的安卓设备，请先确认手机 App 在运行"

## 为什么改

真人真机测试（xuxiao21xx@icloud.com 测试账号）实测发现：客户切换抖音账号后，Dashboard「绑抖音小号」页面长时间不显示新账号。查代码确认 `DeviceAccountScanService` 的唯一触发路径是 `AgentService.runAccountScanLoop` 里 `Random.nextLong(30分钟, 60分钟)` 的被动定时器，WS 协议对比 `collect_task`/`dm_outreach` 都有服务端主动推送分支，唯独账号扫描没有——这是 Path2 Step 7（真机检测账号登录态）功能本身"代码在但真机未验"这个已知缺口的具体表现之一。DM 私信从派单到真机执行今天实测只需 60-90 秒，账号扫描理应有同等能力，而不是强制客户等最长一小时、且中途毫无反馈。

## 关联上下文

- 相关 Journey：客户智能获客路径（`afa6abca-53c0-4815-8594-b7fb81ca547f`），Path2 Step 7
- 相关文件：`services/agent-android/.../AgentService.kt`（`runAccountScanLoop`/`sampleAccountScanIntervalMs`/`shouldRouteWarmup`/`shouldRouteDmOutreach`）、`.../account/DeviceAccountScanService.kt`（`dispatchTask`/`state`）、`apps/api/src/services/acquisition-dispatch.ts`（`dispatchDue`，作为已验证的同款"服务端建task+WS心跳拉取"参考实现）
- 无相关历史决策记录（`decisions/match` 查询为空）

## 边界场景（Agent B/C 快速对抗补全）

- 并发：两个浏览器 tab 同时点"立即扫描" → 后端限流按 `agent_id + 60s` 窗口判断，第二次请求 400（"刚触发过，请稍后再试"），不会排队两个 task
- 设备离线后又上线：触发时离线返回 400，用户看到明确提示，不会有一个"卡在queued永远不会被处理"的僵尸task
- 扫描本身失败（无障碍服务读取面板失败等）：沿用 `DeviceAccountScanService` 现有的失败上报路径（`account-scan-result reported: <code>`），本次不改动扫描本体逻辑，只改触发方式
- 租户隔离：触发端点必须校验 agent 属于当前请求的 tenant_id（同现有中间件模式，不允许跨租户触发别人的设备扫描）

## 影响范围

- 不改变 `runAccountScanLoop` 内部 30-60 分钟被动轮询本身（继续保留作为兜底，防止用户一直不点手动按钮的情况下彻底没有扫描）
- 不改 `DeviceAccountScanService` 扫描本体逻辑（面板读取/账号识别/结果上报），只新增一个外部触发入口
- 新增一个 `publish_tasks.task_type` 取值 `'account_scan'`，不影响现有 `'dm_outreach'`/`'warmup'`/null（普通 collect）分支

## 验收标准

- [ ] API 端点单测：无在线设备 → 400；有在线设备 → 200 且 `publish_tasks` 新增一行 `task_type='account_scan'`；60秒内重复触发 → 限流 400
- [ ] Android 单测：`shouldRouteAccountScan` 判别符测试；WS 收到 `task_type=account_scan` 时调用 `DeviceAccountScanService.dispatchTask`（同 warmup/dm_outreach 现有测试模式，`AgentServiceAccountScanTest.kt` 追加用例）
- [ ] Dashboard：按钮存在 + 点击后 60 秒本地禁用 + 离线态明确提示（Playwright E2E，stub 后端响应，同 PR #1408 已建立的真 Playwright 规格模式）
- [ ] CI 全绿
