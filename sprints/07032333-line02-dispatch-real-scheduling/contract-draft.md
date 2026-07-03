# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: 代码现状推导 + PRD 隐含字段）

### Endpoint: POST /api/acquisition/dispatch/build
**Success (HTTP 200)**:
```json
{
  "success": true,
  "data": {
    "scored": "<number>",
    "assigned": "<number>",
    "skipped_dedup": "<number>",
    "skipped_budget": "<number>",
    "burners": "<string[]>",
    "pending": "<number>"
  },
  "timestamp": "<ISO8601>"
}
```
- `scored` (number, 必填): scoreLeads 打分数量，来源 — 代码现状 `buildAssignments` 路由已有
- `assigned` (number, 必填): 成功派出条数（写入 queued status），来源 — 代码现状
- `skipped_dedup` (number, 必填): 去重跳过数，来源 — 代码现状
- `skipped_budget` (number, 必填): 预算超限跳过数，来源 — 代码现状
- `burners` (string[], 必填): 本次参与选号列表，来源 — 代码现状
- `pending` (number, 必填): 本次写入 pending_dispatch 的 lead 数，来源 — [NEW_PATTERN] PRD Step 4

**禁用字段名**: 无（本 sprint 扩展现有字段集）

**Error (HTTP 4xx)**:
```json
{"success": false, "error": {"code": "<string>", "message": "<string>"}, "timestamp": "<ISO8601>"}
```

---

## 已知约束（来自回归测试）

- [acquisition-dispatch.test.ts] → 无活跃 burner → 不指派 (assigned=0)
- [acquisition-dispatch.test.ts] → 按 relevance_score 降序 + 轮换分摊到多个 burner
- [acquisition-dispatch.test.ts] → 去重：(tenant,lead,label) 已有指派 → 跳过
- [acquisition-dispatch.test.ts] → 天预算闸：该号当天已达 dm_per_day → 不再指派
- [acquisition-dispatch.test.ts] → scheduled_for 落在 dm_active 时段内
- [acquisition-dispatch.test.ts] → dispatchDue 不在活跃时段 → 一条不发（skipped_window=-1）
- [acquisition-dispatch.test.ts] → dispatchDue 到期指派 → 真派单到 publish_tasks + 写 dm_outreach_log
- [acquisition-dispatch.test.ts] → per-hour 上限：该号本小时已发满 → 标 limited 不发
- [acquisition-dispatch.test.ts] → 租户隔离：plan 查询 SQL 第一参数为 req.tenantId（不信 query.tenant_id）

---

## 接缝清单

本 sprint 所有逻辑均为后端服务升级，接缝点如下（2 条，均需真 DB 验证）：

1. **Migration 接缝**：`dm_assignments` 需新增 `dispatch_reason TEXT` 列和 `pending_dispatch` status（更新 check constraint）。E2E 跑前必须先运行 migration；若 constraint 未更新，INSERT `pending_dispatch` 会报错而非静默通过。
   - 验证方式：`psql $DB -c "\d zenithjoy.dm_assignments"` 确认 `dispatch_reason` 列存在、`chk_dm_assign_status` 含 `pending_dispatch`
2. **agents.last_heartbeat_at 心跳接缝**：PRD 假设 `agents.last_heartbeat_at` 由 heartbeat 端点持续更新。E2E 测试用 `psql` 直接写 `last_heartbeat_at = now()` 模拟在线、`last_heartbeat_at = now() - interval '10 minutes'` 模拟离线。
   - 验证方式：`psql $DB -c "SELECT last_heartbeat_at FROM zenithjoy.agents WHERE id='$AGENT_ID'"` 确认写入生效

---

## Golden Path

[触发] → [查询在线小号+负载] → [选最优小号 + 记原因] → [无可用小号→pending_dispatch] → [下周期重试]

---

### Step 1: 系统调用 buildAssignments，查询候选小号并携带在线状态+当天负载

**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 条"查询候选 burner 小号，附带各号 agent 的 last_heartbeat_at 和当天已派 dm_assignments 数量"

**可观测行为**: `POST /api/acquisition/dispatch/build` 返回 HTTP 200，响应含 `data.assigned`（≥0）和 `data.pending`（≥0），无论有无可用小号均不报错。

**验证命令**:
```bash
RESP=$(curl -sf -X POST http://localhost:3000/api/acquisition/dispatch/build \
  -H "X-Tenant-Id: $TEST_TENANT" \
  -H "Content-Type: application/json")
echo "$RESP" | jq -e '.success == true' || { echo "FAIL: response not success"; exit 1; }
echo "$RESP" | jq -e '.data.assigned | type == "number"' || { echo "FAIL: assigned not number"; exit 1; }
echo "$RESP" | jq -e '.data.pending | type == "number"' || { echo "FAIL: pending field missing"; exit 1; }
echo OK
```

**硬阈值**: HTTP 200, `data.assigned ≥ 0`, `data.pending ≥ 0`，无 error 字段

**可执行硬阈值验证**:
```bash
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/api/acquisition/dispatch/build \
  -H "X-Tenant-Id: $TEST_TENANT" -H "Content-Type: application/json")
[ "$CODE" = "200" ] || { echo "FAIL: HTTP $CODE != 200"; exit 1; }
```

---

### Step 2: 候选小号按心跳在线状态 + 当天任务量排序，离线/超配额小号被跳过

**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 条"候选排序：心跳在 2 分钟内（在线）的小号优先，同层内按当天已派任务量升序；离线或超配额的小号跳过"

**可观测行为**: 在线小号 A（当天已派 5 条）和在线小号 B（当天已派 2 条）均存在时，新 lead 优先派给 B；离线小号 C 从不出现在本次 dm_assignments 结果的 account_label 中。

**验证命令**:
```bash
# 验证被选中的小号当天任务量最少（psql 查 dm_assignments）
CHOSEN=$(psql "$DATABASE_URL" -t -c \
  "SELECT account_label FROM zenithjoy.dm_assignments \
   WHERE tenant_id='$TEST_TENANT' AND status='queued' \
   AND created_at > NOW() - interval '2 minutes' LIMIT 1" | tr -d ' ')
DAY_COUNT=$(psql "$DATABASE_URL" -t -c \
  "SELECT count(*) FROM zenithjoy.dm_assignments \
   WHERE tenant_id='$TEST_TENANT' AND account_label='$CHOSEN' \
   AND status IN ('queued','dispatched','sent') \
   AND scheduled_for >= date_trunc('day', now())" | tr -d ' ')
# 离线小号 $OFFLINE_LABEL 不应出现
OFFLINE_IN=$(psql "$DATABASE_URL" -t -c \
  "SELECT count(*) FROM zenithjoy.dm_assignments \
   WHERE tenant_id='$TEST_TENANT' AND account_label='$OFFLINE_LABEL' \
   AND created_at > NOW() - interval '2 minutes'" | tr -d ' ')
[ "$OFFLINE_IN" = "0" ] || { echo "FAIL: offline burner was selected"; exit 1; }
echo "chosen=$CHOSEN day_count=$DAY_COUNT OK"
```

**硬阈值**: 离线小号条数 = 0，在线最少负载小号被选中

**可执行硬阈值验证**:
```bash
C=$(psql "$DATABASE_URL" -t -c \
  "SELECT count(*) FROM zenithjoy.dm_assignments \
   WHERE tenant_id='$TEST_TENANT' AND account_label='$OFFLINE_LABEL' \
   AND created_at > NOW() - interval '2 minutes'" | tr -d ' ')
[ "$C" = "0" ] || { echo "FAIL: offline_count=$C != 0"; exit 1; }
```

---

### Step 3: 成功派发 — dm_assignments 写入，dispatch_reason='least_load'

**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 条"为每条符合条件的 lead 选出排序最优的可用小号，插入 dm_assignments，dispatch_reason 字段记录选择原因"

**可观测行为**: 至少一个在线小号且有待派 lead 时，dm_assignments 新行的 `dispatch_reason='least_load'`，`status='queued'`。

**验证命令**:
```bash
COUNT=$(psql "$DATABASE_URL" -t -c \
  "SELECT count(*) FROM zenithjoy.dm_assignments \
   WHERE tenant_id='$TEST_TENANT' AND dispatch_reason='least_load' \
   AND created_at > NOW() - interval '2 minutes'" | tr -d ' ')
[ "$COUNT" -ge 1 ] || { echo "FAIL: no least_load assignments"; exit 1; }
STATUS=$(psql "$DATABASE_URL" -t -c \
  "SELECT status FROM zenithjoy.dm_assignments \
   WHERE tenant_id='$TEST_TENANT' AND dispatch_reason='least_load' \
   AND created_at > NOW() - interval '2 minutes' LIMIT 1" | tr -d ' ')
[ "$STATUS" = "queued" ] || { echo "FAIL: status=$STATUS != queued"; exit 1; }
echo "least_load_count=$COUNT OK"
```

**硬阈值**: `dispatch_reason='least_load'` 且 `status='queued'`，count ≥ 1（在线小号存在时）

**可执行硬阈值验证**:
```bash
C=$(psql "$DATABASE_URL" -t -c \
  "SELECT count(*) FROM zenithjoy.dm_assignments \
   WHERE tenant_id='$TEST_TENANT' AND dispatch_reason='least_load' \
   AND created_at > NOW() - interval '2 minutes'" | tr -d ' ')
[ "$C" -ge 1 ] || { echo "FAIL: least_load_count=$C < 1"; exit 1; }
```

---

### Step 4: 全部小号离线/超配额 — lead 写入 pending_dispatch，不丢弃，assigned=0

**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 条"若本次循环中所有小号均离线或超配额：该批 lead 写入 dm_assignments，status 设 pending_dispatch，不丢弃、不报错"

**可观测行为**: 所有 burner 心跳超时的情况下，`POST /dispatch/build` 返回 `data.assigned=0, data.pending≥1`（HTTP 200，无 error），dm_assignments 有 `status='pending_dispatch'` 行。

**验证命令**:
```bash
RESP=$(curl -sf -X POST http://localhost:3000/api/acquisition/dispatch/build \
  -H "X-Tenant-Id: $TEST_OFFLINE_TENANT" -H "Content-Type: application/json")
echo "$RESP" | jq -e '.data.assigned == 0' || { echo "FAIL: assigned != 0 when all offline"; exit 1; }
echo "$RESP" | jq -e '.data.pending >= 1' || { echo "FAIL: pending < 1 when all offline"; exit 1; }
PCOUNT=$(psql "$DATABASE_URL" -t -c \
  "SELECT count(*) FROM zenithjoy.dm_assignments \
   WHERE tenant_id='$TEST_OFFLINE_TENANT' AND status='pending_dispatch' \
   AND created_at > NOW() - interval '2 minutes'" | tr -d ' ')
[ "$PCOUNT" -ge 1 ] || { echo "FAIL: no pending_dispatch rows in DB"; exit 1; }
echo "pending_count=$PCOUNT OK"
```

**硬阈值**: `assigned=0`, `pending≥1`, DB 中存在 `status='pending_dispatch'` 行，count ≥ 1，写入时间窗口 2 分钟内

**可执行硬阈值验证**:
```bash
PC=$(psql "$DATABASE_URL" -t -c \
  "SELECT count(*) FROM zenithjoy.dm_assignments \
   WHERE tenant_id='$TEST_OFFLINE_TENANT' AND status='pending_dispatch' \
   AND created_at > NOW() - interval '2 minutes'" | tr -d ' ')
[ "$PC" -ge 1 ] || { echo "FAIL: pending_dispatch_count=$PC < 1"; exit 1; }
```

---

### Step 5: 下一个派发周期 — pending_dispatch lead 被优先重试，有可用小号时补派为 queued

**来源**: `[FROM_PRD]` — PRD Golden Path 第 5 条"下一个派发周期调用 buildAssignments 时，pending_dispatch 的 lead 被优先重试；检测到有可用小号即补派，更新 status 为 queued"

**可观测行为**: 上一轮留有 `pending_dispatch` 行，本轮小号心跳在线，再次调用 `POST /dispatch/build` 后，这些行的 `status` 更新为 `queued`，`dispatch_reason='least_load'`。

**验证命令**:
```bash
# 前提：DB 中存在 pending_dispatch 行，agent 心跳已更新为 now()
# 触发下一个周期
RESP=$(curl -sf -X POST http://localhost:3000/api/acquisition/dispatch/build \
  -H "X-Tenant-Id: $TEST_RETRY_TENANT" -H "Content-Type: application/json")
echo "$RESP" | jq -e '.data.assigned >= 1' || { echo "FAIL: retry assigned < 1"; exit 1; }
STILL_PENDING=$(psql "$DATABASE_URL" -t -c \
  "SELECT count(*) FROM zenithjoy.dm_assignments \
   WHERE tenant_id='$TEST_RETRY_TENANT' AND status='pending_dispatch'" | tr -d ' ')
[ "$STILL_PENDING" = "0" ] || { echo "FAIL: still $STILL_PENDING pending_dispatch after retry"; exit 1; }
RETRIED=$(psql "$DATABASE_URL" -t -c \
  "SELECT count(*) FROM zenithjoy.dm_assignments \
   WHERE tenant_id='$TEST_RETRY_TENANT' AND status='queued' \
   AND updated_at > NOW() - interval '2 minutes'" | tr -d ' ')
[ "$RETRIED" -ge 1 ] || { echo "FAIL: no rows updated to queued on retry"; exit 1; }
echo "retried=$RETRIED still_pending=$STILL_PENDING OK"
```

**硬阈值**: `status='pending_dispatch'` 行数变为 0，`status='queued'` 行 `updated_at` 在 2 分钟内

**可执行硬阈值验证**:
```bash
STILL=$(psql "$DATABASE_URL" -t -c \
  "SELECT count(*) FROM zenithjoy.dm_assignments \
   WHERE tenant_id='$TEST_RETRY_TENANT' AND status='pending_dispatch'" | tr -d ' ')
[ "$STILL" = "0" ] || { echo "FAIL: still pending_dispatch=$STILL"; exit 1; }
```

---

## E2E 验收（final-e2e 跑 — target_environment = local_api）

**journey_type**: autonomous
**target_environment**: local_api

<!-- GOLDEN_SMOKE_ABILITY_SLUG: buildassignments-online-dispatch -->
<!-- GOLDEN_SMOKE_TARGET_ENV: local_api -->

### Scenario 1: online-burner-least-load
<!-- GOLDEN_SMOKE_SCENARIO: online-burner-least-load -->
<!-- GOLDEN_SMOKE_TIMEOUT_MS: 60000 -->

```bash
#!/bin/bash
set -e
# 前提: API server 在 $API_URL（默认 http://localhost:3000），DB 在 $DATABASE_URL
API_URL="${API_URL:-http://localhost:3000}"
DB="${DATABASE_URL:-postgresql://localhost/zenithjoy}"
TENANT="e2e-dispatch-online-$(date +%s)"

# 1. 创建 agents（模拟2个在线小号，B 的负载更少）
AGENT_A_ID=$(psql "$DB" -t -c \
  "INSERT INTO zenithjoy.agents (tenant_id, agent_id, hostname, status, last_heartbeat_at) \
   VALUES ((SELECT id FROM zenithjoy.tenants LIMIT 1), 'e2e-agent-a-$TENANT', 'host-a', 'online', now()) RETURNING id" | tr -d ' ')
AGENT_B_ID=$(psql "$DB" -t -c \
  "INSERT INTO zenithjoy.agents (tenant_id, agent_id, hostname, status, last_heartbeat_at) \
   VALUES ((SELECT id FROM zenithjoy.tenants LIMIT 1), 'e2e-agent-b-$TENANT', 'host-b', 'online', now()) RETURNING id" | tr -d ' ')

# 2. 创建 sessions (burner)
psql "$DB" -c "INSERT INTO zenithjoy.agent_platform_sessions (agent_id, platform, account_label, role, status) VALUES ('$AGENT_A_ID', 'douyin', 'burner-a-$TENANT', 'burner', 'active')"
psql "$DB" -c "INSERT INTO zenithjoy.agent_platform_sessions (agent_id, platform, account_label, role, status) VALUES ('$AGENT_B_ID', 'douyin', 'burner-b-$TENANT', 'burner', 'active')"

# 3. 给 A 号预插 5 条历史任务（负载更高），B 号 0 条
LEAD_PRE=$(psql "$DB" -t -c \
  "INSERT INTO zenithjoy.acquisition_leads (tenant_id, sec_uid, profile_url, relevance_score) \
   VALUES ('$TENANT', 'pre-sec', 'https://d/pre', 70) RETURNING id" | tr -d ' ')
for i in 1 2 3 4 5; do
  psql "$DB" -c "INSERT INTO zenithjoy.dm_assignments (tenant_id, lead_id, account_label, status, scheduled_for) VALUES ('$TENANT', '$LEAD_PRE', 'burner-a-$TENANT', 'queued', now() + interval '${i} minutes') ON CONFLICT DO NOTHING"
done

# 4. 创建新 lead（供本轮派发）
LEAD_ID=$(psql "$DB" -t -c \
  "INSERT INTO zenithjoy.acquisition_leads (tenant_id, sec_uid, profile_url, relevance_score) \
   VALUES ('$TENANT', 'new-sec-$TENANT', 'https://d/new-$TENANT', 90) RETURNING id" | tr -d ' ')

# 5. 触发 buildAssignments
RESP=$(curl -sf -X POST "$API_URL/api/acquisition/dispatch/build" \
  -H "X-Tenant-Id: $TENANT" -H "Content-Type: application/json")
echo "$RESP" | jq -e '.success == true' || { echo "FAIL: not success"; exit 1; }
echo "$RESP" | jq -e '.data.assigned >= 1' || { echo "FAIL: assigned=0 unexpectedly"; exit 1; }

# 6. 验证新 lead 被派给 B（负载最少），dispatch_reason='least_load'
ASSIGNED_LABEL=$(psql "$DB" -t -c \
  "SELECT account_label FROM zenithjoy.dm_assignments \
   WHERE tenant_id='$TENANT' AND lead_id='$LEAD_ID' AND dispatch_reason='least_load'" | tr -d ' ')
[ "$ASSIGNED_LABEL" = "burner-b-$TENANT" ] || { echo "FAIL: expected burner-b, got $ASSIGNED_LABEL"; exit 1; }

# 清理
psql "$DB" -c "DELETE FROM zenithjoy.dm_assignments WHERE tenant_id='$TENANT'"
psql "$DB" -c "DELETE FROM zenithjoy.acquisition_leads WHERE tenant_id='$TENANT'"
psql "$DB" -c "DELETE FROM zenithjoy.agent_platform_sessions WHERE account_label LIKE '%-$TENANT'"
psql "$DB" -c "DELETE FROM zenithjoy.agents WHERE agent_id LIKE '%-$TENANT'"

echo "✅ Scenario 1 通过: 在线小号负载最少优先选择 dispatch_reason=least_load"
```

### Scenario 2: all-offline-pending-dispatch
<!-- GOLDEN_SMOKE_SCENARIO: all-offline-pending-dispatch -->
<!-- GOLDEN_SMOKE_TIMEOUT_MS: 60000 -->

```bash
#!/bin/bash
set -e
API_URL="${API_URL:-http://localhost:3000}"
DB="${DATABASE_URL:-postgresql://localhost/zenithjoy}"
TENANT="e2e-offline-$(date +%s)"

# 1. 创建离线 agent（heartbeat 超过 2 分钟前）
AGENT_ID=$(psql "$DB" -t -c \
  "INSERT INTO zenithjoy.agents (tenant_id, agent_id, hostname, status, last_heartbeat_at) \
   VALUES ((SELECT id FROM zenithjoy.tenants LIMIT 1), 'e2e-offline-$TENANT', 'host-c', 'offline', now() - interval '10 minutes') RETURNING id" | tr -d ' ')
psql "$DB" -c "INSERT INTO zenithjoy.agent_platform_sessions (agent_id, platform, account_label, role, status) VALUES ('$AGENT_ID', 'douyin', 'burner-c-$TENANT', 'burner', 'active')"

# 2. 创建 lead（有 relevance_score）
LEAD_ID=$(psql "$DB" -t -c \
  "INSERT INTO zenithjoy.acquisition_leads (tenant_id, sec_uid, profile_url, relevance_score) \
   VALUES ('$TENANT', 'offline-sec-$TENANT', 'https://d/offline-$TENANT', 80) RETURNING id" | tr -d ' ')

# 3. 触发 buildAssignments
RESP=$(curl -sf -X POST "$API_URL/api/acquisition/dispatch/build" \
  -H "X-Tenant-Id: $TENANT" -H "Content-Type: application/json")
echo "$RESP" | jq -e '.success == true' || { echo "FAIL: error when all offline"; exit 1; }
echo "$RESP" | jq -e '.data.assigned == 0' || { echo "FAIL: assigned != 0 with offline burner"; exit 1; }
echo "$RESP" | jq -e '.data.pending >= 1' || { echo "FAIL: pending < 1"; exit 1; }

# 4. 验证 DB 中有 pending_dispatch 行（带时间窗口）
PCOUNT=$(psql "$DB" -t -c \
  "SELECT count(*) FROM zenithjoy.dm_assignments \
   WHERE tenant_id='$TENANT' AND status='pending_dispatch' \
   AND created_at > NOW() - interval '2 minutes'" | tr -d ' ')
[ "$PCOUNT" -ge 1 ] || { echo "FAIL: no pending_dispatch in DB; count=$PCOUNT"; exit 1; }

# 5. 离线小号不出现在 queued 行
QUEUED=$(psql "$DB" -t -c \
  "SELECT count(*) FROM zenithjoy.dm_assignments \
   WHERE tenant_id='$TENANT' AND account_label='burner-c-$TENANT' AND status='queued'" | tr -d ' ')
[ "$QUEUED" = "0" ] || { echo "FAIL: offline burner in queued; count=$QUEUED"; exit 1; }

# 清理
psql "$DB" -c "DELETE FROM zenithjoy.dm_assignments WHERE tenant_id='$TENANT'"
psql "$DB" -c "DELETE FROM zenithjoy.acquisition_leads WHERE tenant_id='$TENANT'"
psql "$DB" -c "DELETE FROM zenithjoy.agent_platform_sessions WHERE account_label LIKE '%-$TENANT'"
psql "$DB" -c "DELETE FROM zenithjoy.agents WHERE agent_id LIKE '%-$TENANT'"

echo "✅ Scenario 2 通过: 全部离线时 lead→pending_dispatch，assigned=0"
```

### Scenario 3: pending-dispatch-retry-on-next-cycle
<!-- GOLDEN_SMOKE_SCENARIO: pending-dispatch-retry-on-next-cycle -->
<!-- GOLDEN_SMOKE_TIMEOUT_MS: 90000 -->

```bash
#!/bin/bash
set -e
API_URL="${API_URL:-http://localhost:3000}"
DB="${DATABASE_URL:-postgresql://localhost/zenithjoy}"
TENANT="e2e-retry-$(date +%s)"

# 1. 创建 agent（先设为离线）
AGENT_ID=$(psql "$DB" -t -c \
  "INSERT INTO zenithjoy.agents (tenant_id, agent_id, hostname, status, last_heartbeat_at) \
   VALUES ((SELECT id FROM zenithjoy.tenants LIMIT 1), 'e2e-retry-$TENANT', 'host-r', 'offline', now() - interval '10 minutes') RETURNING id" | tr -d ' ')
psql "$DB" -c "INSERT INTO zenithjoy.agent_platform_sessions (agent_id, platform, account_label, role, status) VALUES ('$AGENT_ID', 'douyin', 'burner-r-$TENANT', 'burner', 'active')"

# 2. 创建 lead + 第一轮（离线）→ pending_dispatch
LEAD_ID=$(psql "$DB" -t -c \
  "INSERT INTO zenithjoy.acquisition_leads (tenant_id, sec_uid, profile_url, relevance_score) \
   VALUES ('$TENANT', 'retry-sec-$TENANT', 'https://d/retry-$TENANT', 85) RETURNING id" | tr -d ' ')
curl -sf -X POST "$API_URL/api/acquisition/dispatch/build" \
  -H "X-Tenant-Id: $TENANT" -H "Content-Type: application/json" | jq -e '.data.pending >= 1' || \
  { echo "FAIL: first round did not produce pending_dispatch"; exit 1; }

# 3. 模拟小号上线（更新 heartbeat 为 now()）
psql "$DB" -c "UPDATE zenithjoy.agents SET last_heartbeat_at = now(), status = 'online' WHERE id='$AGENT_ID'"

# 4. 第二轮 buildAssignments → pending_dispatch 被重试
RESP=$(curl -sf -X POST "$API_URL/api/acquisition/dispatch/build" \
  -H "X-Tenant-Id: $TENANT" -H "Content-Type: application/json")
echo "$RESP" | jq -e '.data.assigned >= 1' || { echo "FAIL: retry assigned < 1"; exit 1; }

# 5. pending_dispatch 行已更新为 queued
STILL_PENDING=$(psql "$DB" -t -c \
  "SELECT count(*) FROM zenithjoy.dm_assignments \
   WHERE tenant_id='$TENANT' AND status='pending_dispatch'" | tr -d ' ')
[ "$STILL_PENDING" = "0" ] || { echo "FAIL: still pending_dispatch=$STILL_PENDING after retry"; exit 1; }

RETRIED=$(psql "$DB" -t -c \
  "SELECT count(*) FROM zenithjoy.dm_assignments \
   WHERE tenant_id='$TENANT' AND lead_id='$LEAD_ID' AND status='queued' \
   AND updated_at > NOW() - interval '2 minutes'" | tr -d ' ')
[ "$RETRIED" -ge 1 ] || { echo "FAIL: lead not retried to queued"; exit 1; }

# 清理
psql "$DB" -c "DELETE FROM zenithjoy.dm_assignments WHERE tenant_id='$TENANT'"
psql "$DB" -c "DELETE FROM zenithjoy.acquisition_leads WHERE tenant_id='$TENANT'"
psql "$DB" -c "DELETE FROM zenithjoy.agent_platform_sessions WHERE account_label LIKE '%-$TENANT'"
psql "$DB" -c "DELETE FROM zenithjoy.agents WHERE agent_id LIKE '%-$TENANT'"

echo "✅ Scenario 3 通过: pending_dispatch → 上线后下周期补派为 queued"
```

### Scenario 4: tenant-isolation-pending-backlog
<!-- GOLDEN_SMOKE_SCENARIO: tenant-isolation-pending-backlog -->
<!-- GOLDEN_SMOKE_TIMEOUT_MS: 60000 -->

```bash
#!/bin/bash
set -e
API_URL="${API_URL:-http://localhost:3000}"
DB="${DATABASE_URL:-postgresql://localhost/zenithjoy}"
TS="$(date +%s)"
TENANT_A="e2e-iso-a-$TS"
TENANT_B="e2e-iso-b-$TS"

# 租户 A: 离线 burner → 会有 pending_dispatch 积压
AGENT_A=$(psql "$DB" -t -c \
  "INSERT INTO zenithjoy.agents (tenant_id, agent_id, hostname, status, last_heartbeat_at) \
   VALUES ((SELECT id FROM zenithjoy.tenants LIMIT 1), 'e2e-agent-a-$TS', 'host-a', 'offline', now() - interval '10 minutes') RETURNING id" | tr -d ' ')
psql "$DB" -c "INSERT INTO zenithjoy.agent_platform_sessions (agent_id, platform, account_label, role, status) VALUES ('$AGENT_A', 'douyin', 'burner-a-$TS', 'burner', 'active')"
psql "$DB" -c "INSERT INTO zenithjoy.acquisition_leads (tenant_id, sec_uid, profile_url, relevance_score) VALUES ('$TENANT_A', 'sec-a-$TS', 'https://d/a', 70)"

# 租户 B: 在线 burner
AGENT_B=$(psql "$DB" -t -c \
  "INSERT INTO zenithjoy.agents (tenant_id, agent_id, hostname, status, last_heartbeat_at) \
   VALUES ((SELECT id FROM zenithjoy.tenants LIMIT 1), 'e2e-agent-b-$TS', 'host-b', 'online', now()) RETURNING id" | tr -d ' ')
psql "$DB" -c "INSERT INTO zenithjoy.agent_platform_sessions (agent_id, platform, account_label, role, status) VALUES ('$AGENT_B', 'douyin', 'burner-b-$TS', 'burner', 'active')"
psql "$DB" -c "INSERT INTO zenithjoy.acquisition_leads (tenant_id, sec_uid, profile_url, relevance_score) VALUES ('$TENANT_B', 'sec-b-$TS', 'https://d/b', 70)"

# 触发租户 A（产生 pending_dispatch 积压）
curl -sf -X POST "$API_URL/api/acquisition/dispatch/build" \
  -H "X-Tenant-Id: $TENANT_A" -H "Content-Type: application/json" > /dev/null

# 触发租户 B（应正常完成，不受 A 积压影响）
RESP_B=$(curl -sf -X POST "$API_URL/api/acquisition/dispatch/build" \
  -H "X-Tenant-Id: $TENANT_B" -H "Content-Type: application/json")
echo "$RESP_B" | jq -e '.success == true' || { echo "FAIL: tenant B dispatch failed"; exit 1; }
echo "$RESP_B" | jq -e '.data.assigned >= 1' || { echo "FAIL: tenant B assigned=0 (should be ≥1)"; exit 1; }

# 验证 pending_dispatch 只在租户 A 的行中，租户 B 没有
PENDING_B=$(psql "$DB" -t -c \
  "SELECT count(*) FROM zenithjoy.dm_assignments \
   WHERE tenant_id='$TENANT_B' AND status='pending_dispatch'" | tr -d ' ')
[ "$PENDING_B" = "0" ] || { echo "FAIL: tenant B has pending_dispatch=$PENDING_B (cross-tenant contamination)"; exit 1; }

# 清理
for T in "$TENANT_A" "$TENANT_B"; do
  psql "$DB" -c "DELETE FROM zenithjoy.dm_assignments WHERE tenant_id='$T'"
  psql "$DB" -c "DELETE FROM zenithjoy.acquisition_leads WHERE tenant_id='$T'"
done
psql "$DB" -c "DELETE FROM zenithjoy.agent_platform_sessions WHERE account_label LIKE '%-$TS'"
psql "$DB" -c "DELETE FROM zenithjoy.agents WHERE agent_id LIKE '%-$TS'"

echo "✅ Scenario 4 通过: 租户 A pending 积压不阻塞租户 B 正常派发"
```

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 在线感知排序 | `tests/buildAssignments-dispatch.test.ts` | 心跳2分钟内=在线，超时=离线，不被选 | → "pending field missing / online sensing" failures |
| dispatch_reason | `tests/buildAssignments-dispatch.test.ts` | dispatch_reason='least_load' 写入 INSERT | → "dispatch_reason not in INSERT" failure |
| pending_dispatch | `tests/buildAssignments-dispatch.test.ts` | 全离线→status=pending_dispatch | → "status pending_dispatch" failure |
| pending 重试 | `tests/buildAssignments-dispatch.test.ts` | 上轮 pending→下轮有可用时补派 | → "pending leads not retried" failure |
| 租户隔离 | `tests/buildAssignments-dispatch.test.ts` | ≥2 租户，pending_dispatch 不跨租户 | → "tenant isolation" existing test passes (regression guard) |
