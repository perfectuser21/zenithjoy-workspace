# Contract Draft — Android Agent 信号上报能力（Path 2 信号层加厚）

**Task**: f08ab898-2090-4ffb-9aaa-a48c320d42d2
**Sprint**: 07212317-android-signal-reporting
**Contract Version**: 1.0.0
**Date**: 2026-07-22
**Path**: Path 2 客户智能获客 — https://www.notion.so/35ac40c2ba6381ed8df4f3fa0b64f5bf

---

## 本 Sprint 推进声明

本 PR 把 **Path 2 Step 7（中台检测登录态）** 从"心跳粗判"加厚到"心跳 + UIA 双信号精确判定"，同时把 **Step 8（评论区挖客闭环）** 的信号上报可观测性从无到有建立（失败分类 + 最新回复回填 + dispatch 前二次检测）。

Smoke 新增 Step 24-28（golden-path-2-smoke.sh），覆盖本 sprint 全部 5 个 FR 的服务端断言（Step 1-23 已被前序 sprint 占用）。

---

## FR 与技术边界一览

### FR-1 小号在线状态：心跳 + UIA 双信号落库

#### FR-1a Migration — `agent_platform_sessions` 加 UIA 信号字段

```sql
-- 文件：apps/api/db/migrations/20260722_android_signal_reporting.sql
ALTER TABLE zenithjoy.agent_platform_sessions
  ADD COLUMN IF NOT EXISTS uia_online     BOOLEAN     DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS uia_checked_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS uia_error      TEXT        DEFAULT NULL;
```

**不变量**：
- 不得修改 `(agent_id, platform, account_label)` 唯一键
- 新列 `DEFAULT NULL`，现有行值为 NULL（语义"未知"）

#### FR-1b 新增 POST `/api/agent/burner/uia-signal`

| 字段 | 说明 |
|------|------|
| Header | `x-agent-id: <agent_uuid>`（走 agentContext 中间件反查 tenant_id） |
| Body | `{ account_label: string, uia_online: boolean, uia_error?: string }` |
| Response 200 | `{ success: true }` |
| Response 404 | `account_label` 在当前 agent_id 下不存在对应 `agent_platform_sessions` 行时返回 404 |
| 服务端行为 | UPDATE `agent_platform_sessions` 对应 `(agent_id, platform='douyin', account_label)` 行（`platform` 硬编码为 `'douyin'`，与 qr-bind / sessions 端点保持一致）；若 `uia_online=false` 同步将 `status='offline'` |

**禁止**：客户端直传 `tenant_id`；服务端必须通过 `x-agent-id` 反查。
**`platform` 值**：硬编码为 `'douyin'`，与现有 `qr-bind` 和 `burner/sessions` 端点的 UPDATE/SELECT 条件一致，不从请求 body 读取。

#### FR-1c GET `/api/agent/burner/sessions` 扩展返回

三级判定逻辑（服务端计算 `computed_online_status`）：

| 条件 | 判定 |
|------|------|
| `last_heartbeat_at < NOW()-2min` | `offline` |
| 心跳正常 + `uia_online=false` | `offline`（UIA 覆盖心跳） |
| 心跳正常 + `uia_online=true` | `online` |
| 心跳正常 + `uia_online IS NULL` | `unknown` |
| 心跳正常 + `uia_error IS NOT NULL` | `unknown` |

新增返回字段：`computed_online_status`, `heartbeat_online`, `uia_online`, `uia_checked_at`, `uia_error`

---

### FR-2 采集失败原因五分类上报

#### FR-2a 枚举白名单（服务端 + Android Agent 协议）

```
KEYWORD_NO_RESULT   — 关键词无结果
KEYWORD_BANNED      — 关键词违规（平台屏蔽词）
PLATFORM_LIMIT      — 平台限制（频控/超限）
NETWORK_ERROR       — 网络异常
ACCOUNT_OFFLINE     — 账号状态异常
UNKNOWN             — 兜底
```

已有枚举值向后兼容：`STAGE2_DISPATCH_EXHAUSTED` / `COLLECT_TIMEOUT` / `stage1_empty` 继续有效。

#### FR-2b POST `/api/acquisition/collect/report` 扩展

接受结构化 `reason.error_code`：

```json
{ "reason": { "search_result": "empty", "error_code": "KEYWORD_NO_RESULT" } }
```

- 服务端校验白名单（6 值 + 已有历史值），非白名单强制改写为 `UNKNOWN`，写日志 `[acquisition] error_code normalized: UNKNOWN`
- 不拒绝请求（向后兼容）
- **改动位置**：`apps/api/src/routes/acquisition.ts` L742 附近，`reasonErrorCode` 提取后紧接着加白名单校验（`if (!VALID_ERROR_CODES.has(reasonErrorCode)) { reasonErrorCode = 'UNKNOWN'; ... }`）

---

### FR-3 评论最新回复增量写入路径

#### FR-3a POST `/api/acquisition/collect/report` 扩展接受 `latest_reply`

```json
{
  "comments": [...],
  "latest_reply": "这个有链接吗？",
  "latest_reply_at": "2026-07-22T09:30:00Z"
}
```

- 仅当 `latest_reply_at` 更新（比已记录更新）时覆盖
- `latest_reply_at IS NULL`（首次写入）直接覆盖
- `latest_reply` 有值但 `latest_reply_at` 为空时：用 `NOW()` 兜底填入 `latest_reply_at`（防止字段空值导致增量判断永远失效）
- **已有字段**（`acquisition_leads.latest_reply / latest_reply_at`，migration 20260703），本 sprint 只补写入路径，不改列定义

#### FR-3b GET `/api/acquisition/leads` 确认返回

已有代码（`acquisition.ts` L435/L447）已 SELECT 这两列，本 sprint 无需改 GET 路由。

---

### FR-4 dispatch 执行前二次在线检测

#### FR-4a `dispatchDue` 执行前二次检测

**调用点**：`getSessionOnlineStatus` 叠加在 `dispatchDue` 的 Step C/D（逐行处理每条 `queued` 记录）之前，不是替换 Step A（批量扫描拉取 `queued` 列表）。语义即 PRD 原文"取到 `queued` 行后、发私信前"——对每一行单独做一次在线检测，再决定是否调用私信发送逻辑。

取到 `queued` 行后、发实际私信前，重新查 `computed_online_status`：

| 状态 | 行为 |
|------|------|
| `offline` | UPDATE `status='pending_dispatch'`，跳过 dispatch，写日志 `[dispatch] pre-dispatch check: offline, requeued as pending_dispatch` |
| `online` | 继续正常派单 |
| `unknown` | 保守策略：允许继续派单，写日志 `[dispatch] uia_unknown, proceeding with heartbeat-only` |

**不变量**：`dm_assignments.status` 值域 `queued / pending_dispatch / dispatched / sent / failed / cancelled` 不得新增或破坏。

#### FR-4b 辅助函数 `getSessionOnlineStatus`

```typescript
getSessionOnlineStatus(pool, tenantId, accountLabel): Promise<'online'|'offline'|'unknown'>
```

复用 FR-1c 三级判定逻辑，供 `dispatchDue` 及未来扩展点调用。

---

### FR-5 信号验证 API（smoke 专用）

GET `/api/acquisition/signal-verify`

```json
{
  "burner_sessions": [
    { "account_label": "...", "computed_online_status": "...", "uia_checked_at": "...", "uia_online": true }
  ],
  "recent_collect_errors": [
    { "task_id": "...", "error_code": "KEYWORD_NO_RESULT", "updated_at": "..." }
  ],
  "recent_lead_replies": [
    { "lead_id": "...", "latest_reply": "...", "latest_reply_at": "..." }
  ]
}
```

- 每组最多 10 条，不分页，不筛选
- 每组排序：`updated_at DESC`（最新信号优先）
- 鉴权：`Authorization: Bearer <token>`（tenant 级）

---

## 技术边界与 Invariant

1. **`agent_platform_sessions` 唯一键 `(agent_id, platform, account_label)` 不可破坏**，migration 必须 `ADD COLUMN IF NOT EXISTS`
2. **`last_heartbeat_at > NOW()-2min` 心跳门槛不变**，UIA 信号只能收窄判定不得放宽
3. **`acquisition_leads.latest_reply / latest_reply_at` 已存在**，本 sprint 只补写入路径
4. **`error_code` 枚举向后兼容**，已有值（`STAGE2_DISPATCH_EXHAUSTED` / `COLLECT_TIMEOUT` / `stage1_empty`）继续有效
5. **`dm_assignments.status` 值域不破坏**，dispatch 前检测回退到 `pending_dispatch`（已有值）
6. **所有写入路径携带 `tenant_id`**，通过 `x-agent-id` 反查，禁止客户端直传
7. **Migration 幂等**（`ADD COLUMN IF NOT EXISTS`）

---

## E2E 验收

### Golden Path 1 — 小号在线状态双信号

1. POST `/api/agent/burner/uia-signal` body `{ account_label: "burner_001", uia_online: true }`
2. 断言：DB `agent_platform_sessions.uia_online = true`，`uia_checked_at` 非空
3. GET `/api/agent/burner/sessions` → `computed_online_status: "online"`
4. POST `/api/agent/burner/uia-signal` body `{ account_label: "burner_001", uia_online: false }`
5. 断言：DB `agent_platform_sessions.status = 'offline'`，`uia_online = false`
6. GET `/api/agent/burner/sessions` → `computed_online_status: "offline"`（UIA 覆盖心跳）

### Golden Path 2 — 采集失败五分类落库

1. POST `/api/acquisition/collect/report` body `{ reason: { error_code: "KEYWORD_NO_RESULT" } }`
2. 断言：DB `acquisition_collect_tasks.error_code = 'KEYWORD_NO_RESULT'`
3. POST `/api/acquisition/collect/report` body `{ reason: { error_code: "搜索失败" } }`（非枚举值）
4. 断言：DB `error_code = 'UNKNOWN'`，日志出现 `[acquisition] error_code normalized: UNKNOWN`

### Golden Path 3 — 评论最新回复写入

1. POST `/api/acquisition/collect/report` 含 `latest_reply: "这个有链接吗？"` + `latest_reply_at: "2026-07-22T09:30:00Z"`
2. 断言：DB `acquisition_leads.latest_reply = '这个有链接吗？'`，`latest_reply_at = '2026-07-22T09:30:00Z'`
3. 重复上报旧时间戳 `"2026-07-01T00:00:00Z"` → 断言 DB `latest_reply_at` 不更新到更旧值

### Golden Path 4 — dispatch 前二次检测 gap 处理

1. `buildAssignments` 时 `burner_001` 在线 → 插入 `dm_assignments` `status='queued'`
2. gap：POST UIA 上报 `uia_online=false` → `agent_platform_sessions.status='offline'`
3. `dispatchDue` 执行 → 二次检测 `computed_online_status=offline` → `dm_assignments.status='pending_dispatch'`
4. 断言：未调用私信发送逻辑，日志出现 `[dispatch] pre-dispatch check: offline, requeued as pending_dispatch`

### Golden Path 5 — signal-verify 三字段完整性

1. GET `/api/acquisition/signal-verify`
2. 断言：`burner_sessions[0].computed_online_status` 存在（值在 `online|offline|unknown`）
3. 断言：`recent_collect_errors[0].error_code` 存在（值在白名单枚举内）
4. 断言：`recent_lead_replies[0].latest_reply_at` 存在且非空

---

## Smoke 步骤映射（golden-path-2-smoke.sh）

Step 1-23 已被前序 sprint 占用，本 sprint 使用 Step 24-28。

| Step | 场景 | 断言层级 |
|------|------|---------|
| Step 24 | UIA 在线信号上报与读取（心跳 + UIA 双信号） | curl + psql |
| Step 25 | 采集失败 error_code 五分类落库验证 | curl + psql |
| Step 26 | latest_reply 写入路径验证 | curl + psql |
| Step 27 | dispatch 前二次检测 mock 离线场景（API 层等价断言） | curl + psql |
| Step 28 | signal-verify 端点返回三字段完整性断言 | curl + jq |

---

## 未覆盖真实链路清单（规则 C）

- Android 真机实际 UIA 探测截图上报段（走真机 `xian-rog` nightly channel，本 smoke 用 curl 等价断言覆盖服务端链路）
- `dispatchDue` Step 27 的私信实际发送段（Android 真机通道），smoke 仅断言 DB 状态变化（`pending_dispatch` 而非 `sent`）
- signal-verify 端点的分页/筛选功能（本 sprint 不建设，仅 smoke 断言用的 10 条无参数版本）
