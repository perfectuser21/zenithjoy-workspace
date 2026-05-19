# Sprint PRD — Step 6 Dispatch Chain（中台→Agent 派发闭环）

## OKR 对齐

- **对应 KR**：Path 1 Step 6（中台派任务 + dryrun 发布 + 回执）
- **当前进度**：Step 6 骨架存在，dispatch chain 未实现
- **本次推进预期**：Step 6 从 🔴 推到 ✅（golden-path-1-smoke.sh Step 6 全通）

## 背景

Golden Path Step 6 当前仅验证 publish_tasks.type 路由（WS2 防回归）。
本 sprint 补全完整 dispatch 闭环：中台触发 publish → Agent 心跳领取 → dryrun ack → works 状态回写。

## Golden Path（核心场景）

用户点"发布" → 系统排队任务 → Agent 心跳领取任务 → Agent 确认执行 → works 状态更新为 success

具体：
1. 用户调用 `POST /api/works/:id/publish`（session auth），中台找当前 tenant 最近活跃 agent
2. 系统往 `publish_tasks` 插 pending 记录（含 `result.payload.work_id`），`works.publish_status` 设 `queued`，返回 `{task_id, status:"queued"}`
3. Agent 发 `POST /api/agent/heartbeat`，`queued_tasks` 数组包含新任务
4. Agent 发 `POST /api/agent/task-ack`（license auth，body `{task_id, result}`），中台把 `publish_tasks.status` 改 `done`，`works.publish_status` 改 `success`，返回 `{ok: true}`
5. `GET /api/works/:id` 返回 `publish_status:"success"`

## Response Schema

### Endpoint: POST /api/works/:id/publish

**Auth**: `tenantContext + tenantBypass`（与其他 works 路由一致）

**Success (HTTP 200)**:
```json
{"task_id": "<uuid>", "status": "queued"}
```
- `task_id` (string/uuid, 必填): publish_tasks 记录 id
- `status` (string, 必填): 字面量 `queued`；禁用 `pending`/`created`/`dispatched`

**Error (HTTP 404)**: `{"error": "work not found"}`
**Error (HTTP 422)**: `{"code": "NO_AGENT", "message": "请先安装并启动 Agent"}`
**禁用响应字段名**: `id`/`data`/`result`/`message`/`payload`

---

### Endpoint: POST /api/agent/task-ack

**Auth**: `licenseAuth`
**Body**: `{task_id: string, result: string}`

**Success (HTTP 200)**:
```json
{"ok": true}
```
- `ok` (boolean, 必填): 字面量 `true`；禁用 `success`/`status`/`done`

**Error (HTTP 404)**: `{"error": "task not found"}`
**Error (HTTP 403)**: `{"error": "forbidden"}` — task 不属于当前 license 的 agent

---

### Migration: works.publish_status

新列 `publish_status TEXT CHECK (IN ('queued','success','failed'))`（可 NULL）。
GET /api/works/:id 现有响应加 `publish_status` 字段（null 表示未发布）。

## 边界情况

- 当前 tenant 无 agent → 422 NO_AGENT
- work 不属于当前 tenant → 404
- task_id 不属于当前 license 的 agent → 403
- work_id 从 `task.result?.payload?.work_id` 提取，若缺失则只更新 publish_tasks（不报错）

## 范围限定

**在范围内**：两个新端点 + migration + service 函数 + golden-path-1-smoke.sh Step 6 扩展
**不在范围内**：真实抖音 API 调用、Dashboard UI 状态刷新、多平台支持、错误重试、publish_tasks 加 work_id 外键列

## 预期受影响文件

- `apps/api/db/migrations/20260519_000000_step6_dispatch_chain.sql`: 新建，加 works.publish_status 列
- `apps/api/src/routes/works.ts`: 加 `POST /:id/publish` 路由
- `apps/api/src/routes/walking-skeleton.ts`: 加 `POST /task-ack` 路由
- `apps/api/src/services/walking-skeleton.service.ts`: 加 `dispatchPublishTask` + `ackPublishTask`
- `.github/workflows/scripts/smoke/golden-path-1-smoke.sh`: Step 6 扩展覆盖完整 dispatch chain

## journey_type: autonomous
## journey_type_reason: 纯后端 dispatch 链路（apps/api），无 Dashboard UI 变更
## target_environment: windows_cloud
## target_environment_reason: dispatch 链路 E2E 需模拟 Windows Agent（heartbeat + task-ack），走 GitHub Actions windows-latest runner，PowerShell 打 production staging
