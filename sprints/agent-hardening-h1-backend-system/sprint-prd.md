# Sprint PRD — Agent 系统 hardening · H-1 backend 系统化

## OKR 对齐

- **对应 KR**：[ASSUMPTION: Brain `/api/brain/context` 不可达 / 不返回 active KR；本 sprint 暂归到 Notion AI Journey「Agent 系统 hardening」(`35dc40c2-ba63-81b6-88d1-f53e8eb11211`) Maturity 推进]
- **当前进度**：Journey Maturity = `not_started`（刚建）
- **本次推进预期**：Step 1 + 2 + 3（thin → thin done）= Journey 8 步中前 3 步 thin 通过。完成后 H-2 接 Step 4-8（install pack pipeline + Agent 客户端 + Lead 自验 dispatcher）。

## 背景

ZenithJoy Path 1 / Path 2 在多 sprint 累积出来的 Agent 系统**没有真生产化**：每 sprint 加新 Agent handler / task type 都假定 Agent 客户端会自动升级 + WS routing 能找到正确 Agent + license 限制真 enforce。Path 2 Sprint B-1 Lead 自验暴露 **8 个 system-level architecture bug**（`.agent-knowledge/agent-system-hardening/design-proposal.md`），其中 3 个最阻塞产品的本 sprint 修：

1. **Bug 6 — License 装机数 1 没 enforce**：backend log 写"装机数上限=1"但实际允许 N 个 agent 同 license 注册。客户多机部署绕过收费 = 商业风险。
2. **Bug 2 — `publish_tasks.status='queued'` 撞 `chk_publish_tasks_status` constraint**：B-1 generator 用 `queued` 但旧 enum 只 `pending/running/success/failed/done`。SQL DROP 临时绕过留下 dirty state（无 status check constraint），数据完整性破。
3. **Bug 7 — WS task routing UUID vs string agent_id 混乱**：multi-agent 同 tenant 时 backend 派 task 给哪个 agent 不确定。Sprint B-1 Lead 自验时 backend log "派 task to agent X" 但 Agent 客户端 cmd log 没接到 task → ws routing 漂。

本 sprint 是 dev_pipeline Journey 第一刀，**纯 backend 改动**，让所有未来 Path 2/Path 3 涉及 Agent 的 sprint 在干净的 backend 系统层上跑。

## Golden Path（核心场景）

系统从 [Sprint B-1 Lead 自验暴露 3 个 backend system bug] → 经过 [register endpoint enforce / status enum migration / WS routing UUID 化] → 到达 [3 bug 真在生产环境消除，可由全自动 0-touch lead 自验脚本验证]

具体 10 步：

1. mac controller 注册 test user via API → 拿 license `ZJ-F-XXXXXX`（free tier，装机数=1）
2. mac ssh rog 启第 1 个 Agent 实例 with license → backend `POST /api/agent/register` 返 `{success:true, agent_id:..., license_tier:"free", device_count:1, device_limit:1}`
3. mac ssh rog 启第 2 个 Agent 实例 same license → backend `POST /api/agent/register` 返 **`HTTP 403 {error:"LICENSE_DEVICE_LIMIT_EXCEEDED", current_count:1, limit:1}`**（Bug 6 fix）
4. mac SQL 验 agents 表只有 1 行 status='online' for this license（不允许第 2 行 INSERT）
5. mac controller 模拟 backend POST /api/agent/burner/qr-bind 派 burner task → publish_tasks INSERT row with `status='queued'` → **应 PASS check constraint**（Bug 2 fix — 完整 enum 含 `queued/dispatched/in_progress/completed/failed/pending/running/success/done`）
6. mac SQL `\d zenithjoy.publish_tasks` 验 chk_publish_tasks_status constraint 真存在 + 含完整 enum + 旧 row 不破
7. mac controller 启 mock WS client connect backend `/agent-ws`，identify as 真 agent UUID → backend WS dispatcher 用 UUID 作 routing key（**不再用 string agent_id**）
8. backend 派 task → mock WS client receive task message with `task_id` + `task_type` + `payload`，验证 message 里含正确 agent UUID（不是 hostname / arbitrary string）
9. mac SQL 验 publish_tasks.agent_id 字段填 UUID（`agents.id`），不是 string `agent_id`（`agents.agent_id` 列是 hostname-derived display name，不应作 routing key）
10. mac controller 启第 2 个 mock WS client（不同 capability：'douyin' vs 'feishu'）→ backend 派 douyin task 时按 capability filter 路由到 douyin client，不路由到 feishu client（**dispatcher policy: capability + heartbeat + status 三维度过滤**）

## Response Schema

### Endpoint: POST /api/agent/register（改造）

**Request body**:
```json
{"license_key": "ZJ-F-XXXXXX", "hostname": "<string>", "version": "<semver>", "capabilities": ["douyin"]}
```

**Success (HTTP 200)**:
```json
{
  "success": true,
  "agent_id": "<uuid>",
  "license_tier": "free|pro|enterprise",
  "device_count": 1,
  "device_limit": 1
}
```
- `success` (boolean, 必填): 字面量 `true`
- `agent_id` (string, 必填): UUID 格式（`agents.id` 列），用作后续 WS routing key
- `license_tier` (string, 必填): `free` / `pro` / `enterprise` 之一
- `device_count` (number, 必填): 当前同 license 已注册 active agent 数（含本次注册）
- `device_limit` (number, 必填): 该 tier 允许的最大装机数（free=1, pro=5, enterprise=unlimited 用 -1 表示）

**Error (HTTP 403) — License limit exceeded**:
```json
{
  "success": false,
  "error": "LICENSE_DEVICE_LIMIT_EXCEEDED",
  "current_count": 1,
  "limit": 1,
  "message": "<string 中文>"
}
```
- `error` (string, 必填): 字面量 `LICENSE_DEVICE_LIMIT_EXCEEDED`
- `current_count` (number, 必填): 当前同 license 已 active 的 agent 数（拒绝时，未含本次注册）
- `limit` (number, 必填): 该 tier 允许的最大装机数

**禁用响应字段名**：`device_quota` / `installed_count` / `max_devices` / `data` / `payload`（generator 不得自由发挥）

**Schema 完整性**：success response 顶层 keys 必须**完全等于** `["agent_id", "device_count", "device_limit", "license_tier", "success"]`（按字母序）；error response 顶层 keys 必须**完全等于** `["current_count", "error", "limit", "message", "success"]`。

### Endpoint: POST /api/agent/burner/qr-bind（不改造，但 publish_tasks INSERT 行为改）

本 sprint 不改 endpoint signature。但 INSERT publish_tasks 时 `status='queued'` 必须 PASS constraint。

### WS message — backend → agent (task dispatch)

WS server 改造发送 task message：

```json
{
  "type": "task",
  "task_id": "<uuid>",
  "task_type": "<string e.g. qr_bind/douyin_burner>",
  "agent_id": "<uuid>",
  "payload": {...}
}
```
- `agent_id` 必须是 `agents.id` UUID，**不是** `agents.agent_id` string display name

## 边界情况

- 同 license 第 2 个 register 时第 1 个 agent 还 active → 返 403 LIMIT_EXCEEDED
- 同 license 第 2 个 register 时第 1 个 agent 已 offline > 60s → **允许新 agent 顶替**（thin 阶段简单 timeout 即可，加厚后做 grace period + revoke 逻辑）
- 同 license 第 2 个 register 时第 1 个 agent 跟 hostname 一样 → 视为 reconnect，UPDATE existing row 不 INSERT 新 row（防 Agent 重启撞 limit）
- publish_tasks 旧 row status 含 'success'/'done' 等 (旧 enum) → migration 不丢这些 row，constraint 接受所有历史 status
- WS dispatcher 找不到 active agent matching capability → task INSERT status='queued' 等待，不 immediate dispatch
- WS dispatcher 多个 active agent matching capability → 选 last_heartbeat_at 最新的（按 timestamp DESC）
- WS connection 同 agent UUID 重复 connect → backend close 老 connection 接受新 connection（防止僵尸 ws）

## 范围限定

**在范围内**：
- Backend `apps/api/src/routes/agent.ts` 或 register 路由：加 license enforce check + 返回 device_count/device_limit
- Backend WS server (`apps/api/src/agent-ws.ts` 或类似)：改用 UUID 作 routing key + 加 dispatcher policy（capability + heartbeat + status filter）
- Backend 数据库 migration：DROP 现有 dirty `chk_publish_tasks_status` constraint，ADD 完整 enum 含 `queued/dispatched/in_progress/completed/failed/pending/running/success/done`，迁移现有 row（不丢 data）
- Backend 单元 + 集成 test 覆盖 3 个 fix
- `golden-path-2-h1-smoke.sh` CI smoke (mock Agent + 真 backend) 验证 3 fix
- 0-touch Lead 自验脚本 (mac inline + ssh rog 启 2 Agent + WS mock client) 真证据归档

**不在范围内**（明确推到 H-2 或 follow-up）：
- ❌ install pack auto-deploy（Step 4 — H-2，需要改 GitHub Actions workflow + SSH credentials secrets）
- ❌ Agent 客户端 health server / chrome port collision（Step 5/6 — H-2，要改 Agent 端代码 + 重 build install pack）
- ❌ mock-agent endpoint secret-token 鉴权（Step 7 — H-2）
- ❌ Lead 自验 dispatcher v1 thin（Step 8 — H-2，依赖 Step 4 install pack auto-deploy）
- ❌ Dashboard frontend 不动（本 sprint 1 角色 = 后端 API + DB only）
- ❌ Sprint A `feishu-app-bind.ts` / `feishu-bitable-multitenant.ts` / `feishu-token.ts` 不动
- ❌ Sprint B-1 `agent-burner.ts` / `lead-writer.ts` 不动（本 sprint 修支撑这些 endpoint 的 backend 系统层）
- ❌ Path 1 既有 publish_tasks 行为不破（migration 必须向后兼容，老 row 不破）
- ❌ Agent 客户端代码不改（H-1 是 backend 改动让 Agent 老版本不撞 server-side bug）
- ❌ 不重建 Sprint B-1 dirty SQL drop 之前的 publish_tasks 历史（一次性 migration）

## 假设

- [ASSUMPTION: Brain `/api/brain/context` 不可达 / 不返回 active KR，本 sprint 暂归到 Agent 系统 hardening Journey Maturity 推进]
- [ASSUMPTION: backend `/api/agent/register` endpoint 当前实现没有 license enforce check（Path 2 Sprint B-1 Lead 自验真证据：log 写"装机数上限=1"但实际允许 N 个）]
- [ASSUMPTION: backend WS server 当前用 string agent_id 作 routing key（待 generator 在 contract 阶段 read code 确认实际实现）]
- [ASSUMPTION: free tier device limit = 1，pro = 5，enterprise = unlimited（-1 表示）— 实际 limit 值在 licenses 表的 tier 配置或 hardcoded backend constants，generator 选择来源]
- [ASSUMPTION: 旧 publish_tasks row 含 'success' / 'done' 等历史 status 都允许保留（migration 接受 superset enum）]
- [ASSUMPTION: WS connection identifier 改用 UUID 后，旧 Agent 客户端（如 rog 上 v1.0 install pack）连 ws 时仍能用 string agent_id 做 backwards-compat fallback — 不让旧 Agent 立即断开]
- [ASSUMPTION: Lead 自验 0-touch 跑 mac controller + ssh rog（rog 上 ZenithJoy Agent 已装，复用 install pack v1.0.1 binary）— 不需要 user 物理介入]

## 预期受影响文件

**新增**：
- `apps/api/db/migrations/20260511_xxxxxx_publish_tasks_status_enum_full.sql`（migration: DROP dirty + ADD complete enum constraint）
- `apps/api/src/services/license-enforce.ts`（service: count active agents + check device_limit）
- `apps/api/src/services/ws-dispatcher.ts` 或 `apps/api/src/middleware/ws-routing.ts`（WS routing UUID 化 + dispatcher policy）
- `apps/api/src/routes/agent.test.ts` 或扩展现有 test（register endpoint license enforce 单元 + integration test）
- `apps/api/src/services/license-enforce.test.ts`
- `apps/api/src/services/ws-dispatcher.test.ts`
- `.github/workflows/scripts/smoke/agent-hardening-h1-smoke.sh`（CI smoke）
- `scripts/lead-acceptance/agent-hardening-h1-self-test.cjs`（mac controller Lead 自验脚本）
- `.agent-knowledge/agent-system-hardening/lead-acceptance-h1.md`（自验真证据归档）

**改造**：
- `apps/api/src/routes/agent.ts`（register endpoint 调 license-enforce service + 返回新 response shape）
- `apps/api/src/agent-ws.ts` 或现有 WS server file（用 UUID routing + 应用 dispatcher policy）
- `apps/api/src/app.ts`（如需挂新 route 或 middleware）

**不动**：
- 全部 Sprint A 文件（feishu-app-bind.ts / feishu-bitable-multitenant.ts / feishu-token.ts / FeishuBindTenant.tsx）
- 全部 Sprint B-1 文件（agent-burner.ts / lead-writer.ts / qr-bind-douyin-burner.ts / douyin-comment-crawl.cjs / DouyinBurnerBindPage.tsx）
- Path 1 既有 publish_tasks 历史 row
- Agent 客户端代码（services/agent/src/）
- Dashboard frontend (apps/dashboard/)

## journey_type: dev_pipeline
## journey_type_reason: 本 sprint 修 ZenithJoy Agent 系统的开发者基建（license enforce、WS routing、status enum）— 让所有未来 sprint 在干净 backend 系统上跑，不直接面终端客户。按 walking-skeleton skill 1.2 dev_pipeline 类型定义。
