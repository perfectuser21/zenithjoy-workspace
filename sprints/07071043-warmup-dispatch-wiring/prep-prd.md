# PrepPRD：Line02 客户智能获客 — warmup 中台调度接线（每日自动养号验活）

## 本次对话涵盖的所有事项（防信息丢失）
- [x] 本 PrepPRD 包含：中台每日下发 warmup 任务 + agent 接收触发 dispatchWarmupTask + agent POST 回传结果 + 中台写库(设备级按真实昵称) + dashboard 展示活/掉线标红
- [ ] 另立 Sprint（本次不做）：account_label→真实抖音昵称精确映射（含 dm dispatch 一致性空白）——用户已选"先不补"
- [ ] 待讨论：多设备/多操作号规模化、验活频率自适应

## Journey 当前状态（Line02 客户智能获客，afa6abca / notion 368c40c2-ba63-8120-86a9-c8739cde0d2a）
- ✅ 账号扫描地基（多号登录检测，PR#1148）
- ✅ 养号+验活合一 pass（逐号刷视频保活+读昵称粉丝判活，真机跑通 PR#1149+#1150）
- 🔄 本次：把 warmup 能力接到中台调度（每天自动触发 + 结果回传 + dashboard 展示）

## 本次要做的
把已真机跑通的"养号验活"能力从"只能 adb 手动广播触发"接成"中台每天自动下发一次、结果回传中台写库、dashboard 能看到每个小号活/掉线"。照抄现有 dm_outreach 的完整往返模板（publish_tasks 下发 + POST 结果端点回传）。

## Golden Path（用户操作流程，单线性）
1. 中台每日定时（北京 09:00，可调）→ 对每个有 burner 小号的**在线** android agent，若该 agent 24h 内无 pending/queued warmup 任务 → INSERT `zenithjoy.publish_tasks(agent_id, platform='android_douyin', status='queued', task_type='warmup', payload={operator_nickname})` → 系统队列出现一条 warmup 待派单
2. agent 下次心跳 `POST /api/agent/heartbeat` → `getQueuedTasks` 拉到该行 → `HttpHeartbeatLoop.onTask` 识别 `type='warmup'` → 调 `DeviceAccountScanService.dispatchWarmupTask(this, task_id, machineId, operator_nickname)` → 系统开始逐号养号
3. agent 逐号切进抖音刷 2-3 视频保活 + 读我页昵称/粉丝判活（已真机跑通）→ 收尾切回 operator 号 → 广播 `ACCOUNT_WARMUP_RESULT`(total/alive/offline + `[{nickname,alive,followers,reason}]`)
4. `AgentService.warmupResultReceiver` 收广播 → 解析 → `POST /api/agent/burner/warmup-result {task_id, agent_id, device_id, total, alive, offline, results:[...], error_code}`（照抄 reportDmOutreachResult）
5. 中台端点：`UPDATE publish_tasks status='done', response=报告`；把设备级验活结果**按真实昵称**落库（每号 nickname/alive/followers/last_warmup_at）；error_code 非空则保留上次各号状态、只记一次尝试失败（不误判掉线）
6. 用户在 dashboard 看该设备最近一次每号**活/掉线**（掉线标红）+ 粉丝数 + 验活时间；掉线号据此去手机重登

> **出错/掉线场景**：warmup `error_code=MUTEX_BUSY`/超时/`profile_unreadable` → dashboard 显示"上次验活失败/未知"，不把号标成掉线（保留上次）。agent 心跳陈旧（>2min）→ 该设备不下发 warmup，dashboard 标"设备离线"。

## 客户视角
每天早上小号被系统自动养一遍，主理人打开 dashboard 就能一眼看到哪个抖音小号还活着、哪个掉线要重登，粉丝数一并显示，不用手动一台台去点。

## 完成后用户能
1. 不用手动触发，每天自动给绑定的抖音小号养号保活
2. dashboard 一眼看到每个小号活/掉线 + 粉丝数 + 最近验活时间
3. 掉线号标红，主理人据此去手机重登

## 涉及的 Ability / Feature
- warmup 中台调度接线（Feature，thin，Line02 Step7 收尾）

## 不包含
- account_label→真实抖音昵称精确映射（用户已选先不补）
- 多操作号/多设备规模化调度、验活频率自适应
- 生产 promote（AI 只部署 staging，生产 promote 用户手点）

## 前置工作（已逐项确认，无 TBD）
### 账号与登录
- [x] Honor100 已登 秦军餐饮(4768粉)/大湖成长之路(1196粉) burner 小号；操作号可作 operator_nickname
### API 与凭据
- [x] 无新外部凭据；中台 staging :5201 (zenithjoy_test) 本机 mac-mini-m4-us 可 psql/curl
### E2E 测试账号
- [x] 真机 = 本机 Honor100，经 tailscale honor-100-1 (100.91.227.1:5555) 可达；MBA 中转 adb
### 基础设施
- [x] 中台 staging API :5201 + zenithjoy_test DB 本机可用；Honor100 可 repoint registerApiUrl 到 staging 做真机端到端
- [x] agent 接口就绪：dispatchWarmupTask + ACTION_ACCOUNT_WARMUP_RESULT 广播（DeviceAccountScanService）
- [x] 模板就绪：dm_outreach 往返（publish_tasks 下发 walking-skeleton.ts / 回传 agent-burner.ts:470）

## 验收标准（Final E2E）
- [ ] CI smoke：curl `POST /api/agent/burner/warmup-result` 真写 DB，psql 查到设备级验活记录（nickname/alive/followers/last_warmup_at 字段正确）；curl 心跳能拉到 task_type='warmup' 的 queued_task
- [ ] 单测：中台每日调度去重逻辑（24h 内不重复下发）、agent warmup 结果解析、dashboard 展示组件
- [ ] dashboard spec：掉线号标红、粉丝/验活时间展示
- [ ] **真机端到端（staging，PR 后单独验收）**：Honor100 repoint staging → 注入 warmup 任务 → 真机心跳拉到 → 逐号养号 → POST 回传 → psql 查到写库 → dashboard 看到 2 号活/掉线态
- [ ] CI 全绿

## 守卫（回归）
- 逻辑接缝（CI test）：调度去重、结果解析、判活聚合 → 单测
- 环境接缝（真机往返）：warmup-result 端点 + 心跳下发 → CI curl smoke（干净环境验管道）；真机端到端为发版验收（staging）
