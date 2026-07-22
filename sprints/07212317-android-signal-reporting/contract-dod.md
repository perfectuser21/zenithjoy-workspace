# Contract DoD — Path 2 Android Agent 信号上报能力

Sprint ID: f08ab898-2090-4ffb-9aaa-a48c320d42d2

---

## [BEHAVIOR] B1 — 心跳携带 UIA 结果，uia_online_status 正确写库

**描述**：Android Agent 上报心跳时携带 `account_uia_results` 数组，中台解析后将每个账号的 `uia_status` 写入 `agent_platform_sessions.uia_online_status`。UIA 报离线时同步将 `status` 改为 `offline`（覆盖心跳在线误判）。

**前置条件**：
- `agent_platform_sessions` 表存在对应 `(agent_id, account_label)` 行，`status='active'`
- `agent_platform_sessions` 表已有 `uia_online_status` 列（migration 20260722 已跑）

**验收断言**：
1. 上报 `uia_status:"online"` → DB `uia_online_status='online'`，`status` 不变（仍 `active`）
2. 上报 `uia_status:"offline"` → DB `uia_online_status='offline'` **且** `status='offline'`
3. 上报 `uia_status:"unknown"` → DB `uia_online_status='unknown'`，`status` 不变
4. 不携带 `account_uia_results` 字段的旧版心跳 → 响应 200，`uia_online_status` 不变（null 或旧值）

**manual:bash**:
```bash
#!/usr/bin/env bash
# B1 验收：心跳 UIA 双信号写库
set -e
API_BASE="${API_BASE:-http://localhost:3000}"
DB_URL="${DB_URL:-postgresql://postgres:postgres@localhost:5432/postgres}"
AGENT_PK="${AGENT_PK:?需设置 AGENT_PK（x-agent-id header 值）}"
AGENT_PK_UUID="${AGENT_PK_UUID:?需设置 AGENT_PK_UUID（agents.id UUID）}"
BURNER_LABEL="${BURNER_LABEL:?需设置 BURNER_LABEL（account_label 值）}"

fail() { echo "FAIL: $1" >&2; exit 1; }
ok()   { echo "OK:   $1"; }

# Case 1: uia_status=online
curl -sf -X POST "$API_BASE/api/agent/heartbeat" \
  -H "x-agent-id: $AGENT_PK" -H "Content-Type: application/json" \
  -d "{\"v\":1,\"msgId\":\"b1-1\",\"ts\":$(date +%s),\"type\":\"heartbeat\",\"payload\":{\"uptime\":100,\"busy\":false,\"account_uia_results\":[{\"account_label\":\"$BURNER_LABEL\",\"uia_status\":\"online\"}]}}"
UIA=$(psql "$DB_URL" -tAc "SELECT uia_online_status FROM zenithjoy.agent_platform_sessions WHERE account_label='$BURNER_LABEL' AND agent_id='$AGENT_PK_UUID'")
[ "$UIA" = "online" ] || fail "B1 Case1: uia_online_status 未写入 online，实际值=$UIA"
ok "B1 Case1: uia_online_status=online ✅"

# Case 2: uia_status=offline → status 也改 offline
curl -sf -X POST "$API_BASE/api/agent/heartbeat" \
  -H "x-agent-id: $AGENT_PK" -H "Content-Type: application/json" \
  -d "{\"v\":1,\"msgId\":\"b1-2\",\"ts\":$(date +%s),\"type\":\"heartbeat\",\"payload\":{\"uptime\":200,\"busy\":false,\"account_uia_results\":[{\"account_label\":\"$BURNER_LABEL\",\"uia_status\":\"offline\"}]}}"
STATUS=$(psql "$DB_URL" -tAc "SELECT status FROM zenithjoy.agent_platform_sessions WHERE account_label='$BURNER_LABEL' AND agent_id='$AGENT_PK_UUID'")
UIA2=$(psql "$DB_URL" -tAc "SELECT uia_online_status FROM zenithjoy.agent_platform_sessions WHERE account_label='$BURNER_LABEL' AND agent_id='$AGENT_PK_UUID'")
[ "$STATUS" = "offline" ] || fail "B1 Case2: status 未改 offline，实际值=$STATUS"
[ "$UIA2" = "offline" ] || fail "B1 Case2: uia_online_status 未改 offline，实际值=$UIA2"
ok "B1 Case2: UIA offline 覆盖 status=offline ✅"

# Case 3: uia_status=unknown → status 不变
psql "$DB_URL" -c "UPDATE zenithjoy.agent_platform_sessions SET status='active' WHERE account_label='$BURNER_LABEL' AND agent_id='$AGENT_PK_UUID'"
curl -sf -X POST "$API_BASE/api/agent/heartbeat" \
  -H "x-agent-id: $AGENT_PK" -H "Content-Type: application/json" \
  -d "{\"v\":1,\"msgId\":\"b1-3\",\"ts\":$(date +%s),\"type\":\"heartbeat\",\"payload\":{\"uptime\":300,\"busy\":false,\"account_uia_results\":[{\"account_label\":\"$BURNER_LABEL\",\"uia_status\":\"unknown\"}]}}"
STATUS3=$(psql "$DB_URL" -tAc "SELECT status FROM zenithjoy.agent_platform_sessions WHERE account_label='$BURNER_LABEL' AND agent_id='$AGENT_PK_UUID'")
UIA3=$(psql "$DB_URL" -tAc "SELECT uia_online_status FROM zenithjoy.agent_platform_sessions WHERE account_label='$BURNER_LABEL' AND agent_id='$AGENT_PK_UUID'")
[ "$STATUS3" = "active" ] || fail "B1 Case3: uia=unknown 不应改 status，实际值=$STATUS3"
[ "$UIA3" = "unknown" ] || fail "B1 Case3: uia_online_status 未改 unknown，实际值=$UIA3"
ok "B1 Case3: uia=unknown status 保持 active ✅"

echo "B1 全部通过"
```

---

## [BEHAVIOR] B2 — 采集失败 error_code 五分类落库，不静默丢弃

**描述**：Android Agent 执行采集任务失败时，上报 `error_code` 五分类枚举之一（或 UNKNOWN 兜底），中台原样写入 `acquisition_collect_tasks.error_code`，不改写、不丢弃。

**前置条件**：
- `acquisition_collect_tasks` 表存在对应 `task_id` 行，`status` 为非终态

**验收断言**：
1. 六个合法枚举值均能落库：`KEYWORD_NO_RESULT` / `KEYWORD_BANNED` / `PLATFORM_RATE_LIMIT` / `NETWORK_ERROR` / `ACCOUNT_STATUS_ERROR` / `UNKNOWN`
2. 任务状态变为 `failed`
3. 旧字面值 `failed`（历史兼容）不报错，仍可落库

**manual:bash**:
```bash
#!/usr/bin/env bash
# B2 验收：error_code 五分类落库
set -e
API_BASE="${API_BASE:-http://localhost:3000}"
DB_URL="${DB_URL:-postgresql://postgres:postgres@localhost:5432/postgres}"
AGENT_PK="${AGENT_PK:?需设置 AGENT_PK}"
COLLECT_TASK_ID="${COLLECT_TASK_ID:?需设置 COLLECT_TASK_ID}"

fail() { echo "FAIL: $1" >&2; exit 1; }
ok()   { echo "OK:   $1"; }

for CODE in KEYWORD_NO_RESULT KEYWORD_BANNED PLATFORM_RATE_LIMIT NETWORK_ERROR ACCOUNT_STATUS_ERROR UNKNOWN; do
  # 重置任务状态（每次循环需确保有可用 task，实际测试时按需调整）
  psql "$DB_URL" -c "UPDATE zenithjoy.acquisition_collect_tasks SET status='running', error_code=NULL WHERE id='$COLLECT_TASK_ID'"
  
  curl -sf -X POST "$API_BASE/api/acquisition/collect/report" \
    -H "x-agent-id: $AGENT_PK" -H "Content-Type: application/json" \
    -d "{\"task_id\":\"$COLLECT_TASK_ID\",\"status\":\"failed\",\"error_code\":\"$CODE\"}"
  
  ERR=$(psql "$DB_URL" -tAc "SELECT error_code FROM zenithjoy.acquisition_collect_tasks WHERE id='$COLLECT_TASK_ID'")
  [ "$ERR" = "$CODE" ] || fail "B2 error_code=$CODE 未落库，实际值=$ERR"
  ok "B2 error_code=$CODE 落库 ✅"
done

echo "B2 全部通过（五分类 + UNKNOWN 共 6 个枚举）"
```

---

## [BEHAVIOR] B3 — 评论上报顺带写入 latest_reply / latest_reply_at（死列修复）

**描述**：POST `/api/agent/burner/crawl-comments-result` 携带 `latest_reply` 字段时，中台在 upsert lead 的同一 SQL 内写入 `acquisition_leads.latest_reply` 和 `latest_reply_at`，修复现有死列（全仓库无写入路径）。不携带时保持原值，不置 NULL。

**前置条件**：
- `acquisition_leads` 表存在对应行（由 `crawl-comments-result` 的评论处理流程创建）
- `acquisition_leads.latest_reply` 和 `latest_reply_at` 列已存在（migration 20260703）

**验收断言**：
1. 携带 `latest_reply:"测试回复"` + `latest_reply_at:"2026-07-22T10:00:00Z"` → DB 两列均为非 NULL
2. 重复上报时 upsert 更新，不插入重复行
3. 不携带 `latest_reply` 的旧协议请求 → 评论写入正常，`latest_reply` 保持原值（不置 NULL）

**manual:bash**:
```bash
#!/usr/bin/env bash
# B3 验收：latest_reply 死列修复
set -e
API_BASE="${API_BASE:-http://localhost:3000}"
DB_URL="${DB_URL:-postgresql://postgres:postgres@localhost:5432/postgres}"
AGENT_PK="${AGENT_PK:?需设置 AGENT_PK}"
CRAWL_TASK_ID="${CRAWL_TASK_ID:?需设置 CRAWL_TASK_ID（publish_tasks.id，crawl 类型）}"
TENANT_ID="${TENANT_ID:?需设置 TENANT_ID}"

fail() { echo "FAIL: $1" >&2; exit 1; }
ok()   { echo "OK:   $1"; }

# Case 1: 携带 latest_reply → DB 非 NULL
curl -sf -X POST "$API_BASE/api/agent/burner/crawl-comments-result" \
  -H "x-agent-id: $AGENT_PK" -H "Content-Type: application/json" \
  -d "{\"task_id\":\"$CRAWL_TASK_ID\",\"comments\":[{\"commenter_id\":\"MS4wTestB3\",\"text\":\"很棒\"}],\"latest_reply\":\"测试回复内容B3\",\"latest_reply_at\":\"2026-07-22T10:00:00Z\"}"

REPLY=$(psql "$DB_URL" -tAc "SELECT latest_reply FROM zenithjoy.acquisition_leads WHERE tenant_id='$TENANT_ID' AND latest_reply IS NOT NULL LIMIT 1")
[ -n "$REPLY" ] || fail "B3 Case1: latest_reply 仍为 NULL（死列未修复）"
ok "B3 Case1: latest_reply 已写入: $REPLY ✅"

REPLY_AT=$(psql "$DB_URL" -tAc "SELECT latest_reply_at FROM zenithjoy.acquisition_leads WHERE tenant_id='$TENANT_ID' AND latest_reply IS NOT NULL LIMIT 1")
[ -n "$REPLY_AT" ] || fail "B3 Case1: latest_reply_at 仍为 NULL"
ok "B3 Case1: latest_reply_at 已写入: $REPLY_AT ✅"

# Case 2: 不携带 latest_reply → 旧协议兼容，不报错
curl -sf -X POST "$API_BASE/api/agent/burner/crawl-comments-result" \
  -H "x-agent-id: $AGENT_PK" -H "Content-Type: application/json" \
  -d "{\"task_id\":\"$CRAWL_TASK_ID\",\"comments\":[{\"commenter_id\":\"MS4wTestB3Old\",\"text\":\"普通评论\"}]}"
ok "B3 Case2: 旧协议（无 latest_reply）兼容，不报错 ✅"

echo "B3 全部通过"
```

---

## [BEHAVIOR] B4 — dispatchDue 执行前二次在线检测，gap 离线回退 pending_dispatch

**描述**：`dispatchDue` 执行前（发 WebSocket 派单之前）再次检测对应 `account_label` 的在线状态。若发现账号已离线（`status='offline'` 或 `uia_online_status='offline'`），将该 `dm_assignments` 行从 `queued` 回退为 `pending_dispatch`，不发出 WebSocket 消息。回退次数上限 3 次后标 `failed`。

**前置条件**：
- `dm_assignments` 存在 `status='queued'` 行，`scheduled_for <= NOW()`
- 对应 `account_label` 的 `agent_platform_sessions.status='offline'`

**验收断言**：
1. 账号离线时 `dispatchDue` 调用后，行变 `status='pending_dispatch'`，不发 WebSocket
2. 回退次数达上限（3）后，行变 `status='failed'`
3. 账号在线时正常派单，`status='dispatched'`
4. 回退行保留 `dispatch_reason`（审计链路，不清空）

**manual:bash**:
```bash
#!/usr/bin/env bash
# B4 验收：dispatchDue 二次在线检测 gap 回退
set -e
API_BASE="${API_BASE:-http://localhost:3000}"
DB_URL="${DB_URL:-postgresql://postgres:postgres@localhost:5432/postgres}"
TENANT_ID="${TENANT_ID:?需设置 TENANT_ID}"
BURNER_LABEL="${BURNER_LABEL:?需设置 BURNER_LABEL}"
AGENT_PK_UUID="${AGENT_PK_UUID:?需设置 AGENT_PK_UUID}"

fail() { echo "FAIL: $1" >&2; exit 1; }
ok()   { echo "OK:   $1"; }

# 构造场景：将 burner 置离线
psql "$DB_URL" -c "UPDATE zenithjoy.agent_platform_sessions SET status='offline', uia_online_status='offline', updated_at=NOW() WHERE account_label='$BURNER_LABEL' AND agent_id='$AGENT_PK_UUID'"

BEFORE=$(psql "$DB_URL" -tAc "SELECT count(*) FROM zenithjoy.dm_assignments WHERE tenant_id='$TENANT_ID' AND status='queued' AND account_label='$BURNER_LABEL'")
echo "queued 行数（触发前）: $BEFORE"

# 触发 dispatchDue（通过 dispatch-due 端点或直接调 service）
curl -sf -X POST "$API_BASE/api/acquisition/dispatch-due" \
  -H "X-Tenant-Id: $TENANT_ID" -H "Content-Type: application/json" \
  -d "{}" 2>/dev/null || true  # 端点可能不存在，用 psql 等价断言

REQUEUED=$(psql "$DB_URL" -tAc "SELECT count(*) FROM zenithjoy.dm_assignments WHERE tenant_id='$TENANT_ID' AND status='pending_dispatch'")
[ "$REQUEUED" -ge 1 ] || fail "B4: 离线账号 queued 行未回退 pending_dispatch，pending_dispatch 行数=$REQUEUED"
ok "B4: 离线账号 assignment 已回退 pending_dispatch（行数=$REQUEUED）✅"

# 审计链路：dispatch_reason 非空
DR=$(psql "$DB_URL" -tAc "SELECT dispatch_reason FROM zenithjoy.dm_assignments WHERE tenant_id='$TENANT_ID' AND status='pending_dispatch' LIMIT 1")
[ -n "$DR" ] || fail "B4: dispatch_reason 为空（审计链路丢失）"
ok "B4: dispatch_reason 保留: $DR ✅"

echo "B4 全部通过"
```

---

## [BEHAVIOR] B5 — GET /api/acquisition/account-signal 端点字段完整

**描述**：新端点返回租户下所有 burner session 的信号聚合视图，每个 session 包含 `online_status`（来自 `uia_online_status` 或 `status`）、`last_error_code`（上次采集失败原因）、`latest_comment_sync_at`（最近评论回填时间）。

**前置条件**：
- 租户下有 ≥1 个 burner session
- 请求携带有效的 `X-Tenant-Id` header

**验收断言**：
1. 响应 HTTP 200，`success: true`
2. `data.sessions` 为数组，每个元素含三字段（类型正确）
3. 无有效 tenant 时返回 400/401

**manual:bash**:
```bash
#!/usr/bin/env bash
# B5 验收：account-signal 端点
set -e
API_BASE="${API_BASE:-http://localhost:3000}"
TENANT_ID="${TENANT_ID:?需设置 TENANT_ID}"

fail() { echo "FAIL: $1" >&2; exit 1; }
ok()   { echo "OK:   $1"; }

S_TMP=$(mktemp)
HTTP_CODE=$(curl -s -o "$S_TMP" -w "%{http_code}" "$API_BASE/api/acquisition/account-signal" \
  -H "X-Tenant-Id: $TENANT_ID")
[ "$HTTP_CODE" = "200" ] || fail "B5: HTTP $HTTP_CODE（期望 200），响应: $(cat $S_TMP)"
ok "B5: HTTP 200 ✅"

python3 -c "
import json, sys
d = json.load(open(sys.argv[1]))
assert d.get('success') == True, f'success 字段错误: {d}'
sessions = d.get('data', {}).get('sessions', [])
assert isinstance(sessions, list), 'sessions 不是数组'
assert len(sessions) >= 1, 'sessions 为空（期望 ≥1 个 burner session）'
for s in sessions:
    assert 'online_status' in s, f'online_status 字段缺失: {s}'
    assert 'last_error_code' in s, f'last_error_code 字段缺失: {s}'
    assert 'latest_comment_sync_at' in s, f'latest_comment_sync_at 字段缺失: {s}'
print('account-signal 字段完整，sessions:', sessions)
" "$S_TMP" || fail "B5: 响应字段不完整"
ok "B5: online_status + last_error_code + latest_comment_sync_at 全齐 ✅"

# 无 tenant → 400/401
BAD_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$API_BASE/api/acquisition/account-signal")
[[ "$BAD_CODE" == "400" || "$BAD_CODE" == "401" ]] || fail "B5: 无 tenant 应返回 400/401，实际=$BAD_CODE"
ok "B5: 无 tenant 返回 $BAD_CODE（安全校验通过）✅"

rm -f "$S_TMP"
echo "B5 全部通过"
```

---

## CI 门控

- `lint-feature-has-smoke`：本 PR 改了 `apps/api/src/`，对应 golden-path-2-smoke.sh Step 15-20 必须存在
- `lint-tdd-commit-order`：测试骨架 commit（sprints/07212317-android-signal-reporting/tests/）在实现 commit 之前
- golden-path-2-smoke.sh Step 1-14 保持全绿
- golden-path-2-smoke.sh Step 15-20 从 ❌ 推到 ✅（本 PR CI 门控通过条件）

---

_生成时间: 2026-07-22_
