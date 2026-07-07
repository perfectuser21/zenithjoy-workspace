# 设计：Line02 warmup 中台调度接线（每日自动养号验活）

日期：2026-07-07　Journey：Line02 客户智能获客（afa6abca）　路径：/dev 路径 B　Sprint：sprints/07071043-warmup-dispatch-wiring

## 背景与目标
养号验活能力已真机跑通（PR#1149+#1150），但只能 adb 广播手动触发。本 sprint 把它接成"中台每天自动下发一次 → agent 逐号养号验活 → 结果回传中台写库 → dashboard 看到每号活/掉线"。照抄 dm_outreach 往返模板，但避开其已知断链（见下"判别符坑"）。

## 用户已拍板的两个决策
1. **落库粒度 = 设备级·按真实昵称**：warmup 结果按设备存，列该设备真实看到的每个号（真实抖音昵称 + 活/掉线/粉丝/验活时间）。绕开 `account_label`↔真实昵称无映射的架构空白（AgentService.kt:294 已登记）。不在本 sprint 补精确映射。
2. **真机端到端走 staging 验收**：本 PR 出代码 + CI smoke；真机端到端（Honor100 repoint staging → 注入 warmup → 真机养号 → 回传 → dashboard）为 PR 后发版验收，不碰生产。

## 判别符坑（关键，不盲抄 dm_outreach）
`getQueuedTasks`（walking-skeleton.service.ts:372）SELECT 的是 publish 类型列 `type`(image/video/article)，**无 `task_type`**；heartbeat 映射 `type: t.type`。dm_outreach 的判别符 `dm_outreach` 只在 `task_type` 列 + payload。故 agent 心跳拿到的 `task.type='image'`，`AgentService.onTask` 里 `task.type=="dm_outreach"` 分支恒不匹配——该心跳下发对 Android 是断的（dm_outreach 真机走 debug 触发验的）。
**本设计判别符改走 payload**：`dispatchDue` 已把 `task_type` 塞进 payload，payload 经 `...realPayload` 完整透传到 agent。warmup INSERT 同样把 `task_type:'warmup'` 放 payload，agent 用 `task.payload["task_type"]=="warmup"` 判别。不动 walking-skeleton 心跳映射，不碰现有 publish/dm 行为，判别符必达 agent。（既有 dm 断链本 sprint 不修，超范围。）

## 架构（4 面 + 1 迁移）

### 1. Agent（services/agent-android）
- **AgentService.onTask 加 warmup 分支**（最前，按 payload 判别）：`task.payload["task_type"]=="warmup"` → 读 `operator_nickname` → `DeviceAccountScanService.dispatchWarmupTask(this, task.task_id, config.machineId, operatorNickname)`。task_id 作 requestId。
- **AgentService 加 warmupResultReceiver**：注册收 `DeviceAccountScanService.ACTION_ACCOUNT_WARMUP_RESULT`；解析 total/alive/offline + results JSON(`[{nickname,alive,followers,reason}]`) → `reportWarmupResult(...)`。onCreate 注册 / onDestroy 注销（照 accountScanResultReceiver）。
- **reportWarmupResult**：`POST ${deriveHttpBase()}/api/agent/burner/warmup-result`，body `{task_id, agent_id, device_id, total, alive, offline, results:[...], error_code}`（照抄 reportDmOutreachResult 的 OkHttp 写法）。
- DeviceAccountScanService/WarmupPass/Model **不改**（能力已就绪）。

### 2. 中台下发（新调度）
- **enqueueWarmupTasks()**（新，放 services/warmup-dispatch.ts 或并入 acquisition-dispatch.ts）：遍历"有 ≥1 个 active douyin burner session 且在线（agents.last_heartbeat_at > now-2min）"的 agent；若该 agent 已有 warmup task 处于 pending/queued/dispatched **或** 24h 内 done → 跳过（去重）；否则解析 `operator_nickname`（该 agent role='main' 的 douyin session 昵称，取自 publish_tasks.response->>'account_nickname'，无则空串）；INSERT `publish_tasks(agent_id, platform='douyin', status='queued', task_type='warmup', payload={task_type:'warmup', operator_nickname}, tenant_id, created_at, updated_at)`。
- **每日 cron**：在 scheduler.ts 加一个 warmup tick（北京时间固定点，如 10:00；范式照现有 09:00 marketing tick + 北京时区判定），fire 时调 enqueueWarmupTasks()。
- **手动触发口**（staging 真机 + smoke 用）：`POST /api/acquisition/warmup/run` → enqueueWarmupTasks()，返回 `{enqueued:N}`。照 dispatch/run。

### 3. 中台回传端点
- **POST /api/agent/burner/warmup-result**（新，agent-burner.ts）：
  - tenant 服务端按 agent_id 反查（**不信设备上报**，铁律）。
  - 幂等：按 task_id 查 publish_tasks.status，已 done/failed 则短路（防重复回传）。
  - `error_code` 非空（MUTEX_BUSY/超时/…）→ UPDATE publish_tasks status='done', response含error → **不 upsert liveness**（保留各号上次状态，不误判掉线）。
  - `error_code` 空 → UPDATE publish_tasks status='done', response=完整报告；对每个 result upsert `agent_warmup_liveness`。
- **GET /api/agent/burner/warmup-liveness?agent_id=**（新）：返回该 agent 最近每号 `{nickname, alive, followers, reason, checked_at}`，供 dashboard。

### 4. 迁移：新表 agent_warmup_liveness
```
CREATE TABLE zenithjoy.agent_warmup_liveness (
  id uuid PK default gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES zenithjoy.agents(id),
  device_id text,
  nickname text NOT NULL,
  alive boolean NOT NULL,
  followers integer,
  reason text,
  checked_at timestamptz NOT NULL default now(),
  UNIQUE(agent_id, nickname)
);
```
upsert on (agent_id, nickname) → 每号只留最新一次。原始报告另存 publish_tasks.response。

### 5. Dashboard（apps/dashboard）
- AcquisitionAccountsPage：加"验活状态"区（或按 agent 分组的面板），读 `GET /api/agent/burner/warmup-liveness`。按真实昵称展示每号：昵称 + 粉丝数 + 验活时间 + 活/掉线徽章（**掉线 alive=false 标红**）。error/未验过显示"未知/上次失败"，不标红为掉线。

## 数据流
中台 cron/手动 → enqueueWarmupTasks INSERT publish_tasks(task_type=warmup) → agent 心跳 getQueuedTasks 拉到 → onTask payload.task_type==warmup → dispatchWarmupTask → 逐号养号验活(已跑通) → ACCOUNT_WARMUP_RESULT 广播 → warmupResultReceiver → POST /warmup-result → upsert agent_warmup_liveness + publish_tasks done → GET /warmup-liveness → dashboard 标红掉线号。

## 测试策略
- **E2E/smoke（第一 commit，先红）**：`.github/workflows/scripts/smoke/warmup-dispatch-smoke.sh`（≥5 行真链路）：① 造一个 android burner agent（psql）② curl `POST /api/acquisition/warmup/run` → psql 断言 publish_tasks 出现 task_type='warmup' queued 行且 payload 含 operator_nickname ③ 模拟 agent curl `POST /api/agent/heartbeat` → 断言响应 queued_tasks 含该 warmup 任务（payload.task_type='warmup'）④ curl `POST /api/agent/burner/warmup-result` 带 2 号样本(1活1掉线) → psql 断言 agent_warmup_liveness 2 行(nickname/alive/followers 正确) + publish_tasks status='done' ⑤ 重复 POST 同 task_id → 断言幂等（不重复写）。接进 CI（[CONFIG] 改 .yml）。
- **单测·api（vitest）**：enqueueWarmupTasks 24h 去重；warmup-result 幂等 + error_code 保留上次不 upsert + tenant 服务端反查；GET warmup-liveness 形状。
- **单测·agent（kotlin JVM）**：warmup 结果 JSON→reportWarmupResult body 解析；onTask payload.task_type=='warmup' → dispatchWarmupTask 被调（照 AgentServiceDispatchGuardTest 模式）。
- **dashboard spec**：掉线号标红渲染 + 粉丝/验活时间展示（真实昵称）。
- **真机端到端（staging，PR 后验收）**：Honor100 registerApiUrl→staging:5201 → `POST /warmup/run` → 真机心跳拉到 → 逐号养号 → 回传 → psql 查 agent_warmup_liveness 2 行(大湖1196/秦军4768) → dashboard 看到活/掉线。

## 守卫
- 逻辑接缝 → 上述单测（去重/幂等/解析/聚合）永久留 CI。
- 环境接缝（心跳下发 + warmup-result 往返）→ smoke.sh 干净环境验管道，接进 required CI；真机端到端为发版验收。

## 不包含
- account_label→真实昵称精确映射、dm_outreach 既有心跳断链修复、多操作号/多设备规模化、验活频率自适应、生产 promote。
