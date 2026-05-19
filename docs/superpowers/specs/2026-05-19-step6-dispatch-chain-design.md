# Step 6 Dispatch Chain — Design Spec

**Goal:** 补全 中台 → Agent dispatch 链路，实现 work 发布任务从中台触发、Agent 心跳领取、dryrun 确认、状态回写的完整闭环。

**Architecture:** 在现有 walking-skeleton 基础上新增两个端点（`POST /api/works/:id/publish`、`POST /api/agent/task-ack`）和一个 migration（`works.publish_status` 列）。work_id 通过 `publish_tasks.result` JSONB payload 传递（零迁移成本方案）。

**Tech Stack:** Express/TypeScript，PostgreSQL（zenithjoy schema），现有 walking-skeleton.service.ts + works.ts 路由模式。

---

## 文件结构

| 文件 | 变更 |
|------|------|
| `apps/api/db/migrations/20260519_000000_step6_dispatch_chain.sql` | 新建：加 works.publish_status 列 |
| `apps/api/src/routes/works.ts` | 修改：加 `POST /:id/publish` handler |
| `apps/api/src/routes/walking-skeleton.ts` | 修改：加 `POST /task-ack` handler |
| `apps/api/src/services/walking-skeleton.service.ts` | 修改：加 `dispatchPublishTask` + `ackPublishTask` |

---

## 数据流

```
用户点发布
  → POST /api/works/:id/publish  (session auth / tenantContext)
      → 找 tenant 最近活跃 agent（按 last_heartbeat_at DESC LIMIT 1）
      → INSERT publish_tasks (agent_id, platform='douyin', result={payload:{work_id}})
      → UPDATE works SET publish_status='queued'
      → 返回 {task_id, status:"queued"}

Agent 心跳
  → POST /api/agent/heartbeat  (licenseAuth, 已有)
      → getQueuedTasks(agent.id)  ← 查 publish_tasks WHERE status='pending'
      → 返回 queued_tasks 数组含新任务

Agent dryrun
  → POST /api/agent/task-ack  (licenseAuth, 新建)
      → 校验 task_id + 所有权
      → UPDATE publish_tasks SET status='done'
      → 从 task.result.payload.work_id 取 work_id
      → UPDATE works SET publish_status='success'
      → 返回 {ok: true}
```

---

## Migration

```sql
ALTER TABLE zenithjoy.works
  ADD COLUMN IF NOT EXISTS publish_status TEXT
  CHECK (publish_status IN ('queued', 'success', 'failed'));
```

---

## POST /api/works/:id/publish

**位置：** `apps/api/src/routes/works.ts`
**Auth：** `[tenantContext, tenantBypass]`（与其他 works 路由一致）

**逻辑：**
1. 从 `req.params.id` 取 work UUID，验证格式
2. 查 work，确认属于当前 tenant（404 if not found）
3. 查 tenant 最近活跃 agent：`SELECT id FROM zenithjoy.agents WHERE tenant_id=$1 ORDER BY last_heartbeat_at DESC NULLS LAST LIMIT 1`
4. 若无 agent → 返回 `422 {code:'NO_AGENT', message:'请先安装并启动 Agent'}`
5. 调用 `dispatchPublishTask({workId, agentId, platform:'douyin'})`
6. UPDATE `works.publish_status = 'queued'`
7. 返回 `200 {task_id, status:'queued'}`

**新 service 函数 `dispatchPublishTask`：**
```typescript
INSERT INTO zenithjoy.publish_tasks (agent_id, platform, type, status, result)
VALUES ($1, $2, 'image', 'pending', $3::jsonb)
RETURNING id, status
// $3 = JSON.stringify({ payload: { work_id: workId } })
```

---

## POST /api/agent/task-ack

**位置：** `apps/api/src/routes/walking-skeleton.ts`（挂在 `heartbeatRouter`）
**Auth：** `licenseAuth`
**Body：** `{task_id: string, result: string}`

**逻辑：**
1. 校验 `task_id` UUID 格式
2. `getPublishTask(task_id)` → 404 if not found
3. `findAgentById(task.agent_id)` → 确认 `agent.license_id === req.license.id`（403）
4. 调用 `ackPublishTask({taskId, licenseId})`：
   - `UPDATE publish_tasks SET status='done', receipt_at=now() WHERE id=$1`
   - 从 `task.result?.payload?.work_id` 取 work_id
   - 若有 work_id：`UPDATE zenithjoy.works SET publish_status='success' WHERE id=$2`
5. 返回 `200 {ok: true}`

---

## E2E 流程（修正顺序）

原 PRD 顺序中 heartbeat 在 publish 之后，但 `publish_tasks.agent_id NOT NULL`，必须先有 agent。修正顺序：

1. 注册 → session + license_key
2. 创建 work
3. **heartbeat（注册 agent）** ← 移到 publish 前
4. POST /api/works/:id/publish → status=queued
5. POST /api/agent/heartbeat → queued_tasks 非空
6. POST /api/agent/task-ack
7. GET /api/works/:id → publish_status=success

---

## 测试策略

| 层级 | 覆盖内容 |
|------|---------|
| **Unit** | `dispatchPublishTask` SQL insert 正确；`ackPublishTask` work_id 提取逻辑 |
| **Integration** | 全链路：heartbeat → publish → heartbeat → ack → works 状态回写（真 PG 实例） |
| **E2E (windows_cloud)** | PowerShell 脚本打 production staging，6 步全链路 exit 0 |

---

## 不做

- 真实抖音发布 API 调用
- Dashboard UI 状态刷新动画
- 多平台（只做 douyin）
- 错误重试机制
- publish_tasks 加 work_id 外键列（用 payload 方案）

## 成功标准

1. `POST /api/works/:id/publish` 返回 `{task_id, status:"queued"}`
2. `POST /api/agent/heartbeat` 返回 `queued_tasks` 数组非空
3. `POST /api/agent/task-ack` 返回 `{ok: true}`
4. `GET /api/works/:id` 的 `publish_status === 'success'`
5. windows_cloud E2E PowerShell 脚本 exit 0
