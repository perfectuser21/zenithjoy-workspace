# Contract Draft — Path 2 Android Agent 信号上报能力

Sprint ID: f08ab898-2090-4ffb-9aaa-a48c320d42d2
Sprint Dir: sprints/07212317-android-signal-reporting
Journey: Path 2 客户智能获客（https://www.notion.so/35ac40c2ba6381ed8df4f3fa0b64f5bf）
本 PR 推进：Path 2 Step 7-8 服务端信号链路（Step 15-20 smoke 断言）从 ❌ 推到 ✅

---

## 功能边界（In Scope）

| 编号 | 功能点 | 涉及文件 | thickness |
|------|--------|----------|-----------|
| F1 | 心跳 + UIA 双信号写 `agent_platform_sessions.uia_online_status` | `schemas/agent-protocol.ts` `routes/walking-skeleton.ts` `db/migrations/20260722_android_signal_reporting.sql` | medium → thick |
| F2 | 采集失败 `error_code` 五分类落库 | `services/acquisition-collect.ts` | thin → medium |
| F3 | 评论上报顺带写 `acquisition_leads.latest_reply` + `latest_reply_at`（修复死列） | `routes/agent-burner.ts` POST `/crawl-comments-result` | thin → medium |
| F4 | `dispatchDue` 执行前二次在线检测 + gap 离线回退 `pending_dispatch` | `services/acquisition-dispatch.ts` | medium → thick |
| F5 | GET `/api/acquisition/account-signal` 新端点（在线状态 + 失败原因 + 评论同步时间戳） | `routes/agent-burner.ts` | 新建 thin |

**不在范围**：Dashboard 展示层、评论独立轮询、Android APK Kotlin 代码、人工触达配置、关键词去重机制。

---

## 技术断言（AI 翻译用户语言 → 可验证断言）

### F1 — 心跳 UIA 双信号

**用户语言**：「看小号列表能看到真实在线状态」

**可验证断言**：
1. POST `/api/agent/heartbeat` 携带 `account_uia_results:[{account_label, uia_status:"online"}]` 后，`zenithjoy.agent_platform_sessions.uia_online_status = 'online'`（psql 查确认）。
2. 同一账号后续上报 `uia_status:"offline"` 后，`uia_online_status = 'offline'` 且 `status = 'offline'`（UIA 离线覆盖心跳在线误判）。
3. UIA 探测失败（`uia_status:"unknown"`）时，`uia_online_status = 'unknown'`，`status` 字段**不被修改**（不强制改离线）。
4. 旧版心跳（不携带 `uia_online_status` / `account_uia_results` 字段）**正常响应 200**，不报 Zod validation error。

### F2 — 采集失败 error_code 五分类

**用户语言**：「采集失败能看到具体原因」

**可验证断言**：
1. POST `/api/acquisition/collect/report`（或等价路由）携带 `error_code:"KEYWORD_NO_RESULT"` 后，`zenithjoy.acquisition_collect_tasks.error_code = 'KEYWORD_NO_RESULT'`。
2. 六个合法枚举值（`KEYWORD_NO_RESULT` / `KEYWORD_BANNED` / `PLATFORM_RATE_LIMIT` / `NETWORK_ERROR` / `ACCOUNT_STATUS_ERROR` / `UNKNOWN`）各自均能直接透传落库，不被服务层改写或丢弃。
3. 旧的 `failed`（字面字符串）仍可落库（历史兼容，不 DB CHECK 约束）。

### F3 — 评论回复回填死列修复

**用户语言**：「线索详情能看到最新评论回复」

**可验证断言**：
1. POST `/api/agent/burner/crawl-comments-result` 携带 `latest_reply:"某回复文本"` + `latest_reply_at:"2026-07-22T10:00:00Z"` 后，`zenithjoy.acquisition_leads.latest_reply` 为非 NULL 非空字符串。
2. 同一 lead 重复上报时执行 upsert，`latest_reply_at` 更新为最新值，不插入重复行。
3. 不携带 `latest_reply` 字段的旧协议请求，lead-writer 正常运行（`latest_reply` 保持原值，不被置 NULL）。

### F4 — 触达前二次在线检测

**用户语言**：「触达前知道账号是否真能用，不强发给掉线的号」

**可验证断言**：
1. `dm_assignments` 表有 `status='queued'` 行，对应 `account_label` 的 `agent_platform_sessions.status='offline'`（或 `uia_online_status='offline'`）时，调用 `dispatchDue` 后该行变为 `status='pending_dispatch'`，不发出 WebSocket 派单消息。
2. 回退次数达到上限（3 次）后，行标为 `status='failed'`（状态机不卡死）。
3. 账号在线时，`dispatchDue` 正常派单，`status` 流转为 `dispatched`。
4. 回退只写 `pending_dispatch`，禁止写 `cancelled` 或删除行（审计链路保留）。

### F5 — account-signal 端点

**用户语言**：「有个 API 能一次看到账号在线状态 + 上次失败原因 + 评论同步时间」

**可验证断言**：
1. GET `/api/acquisition/account-signal` 响应 `data.sessions` 数组，每个元素含 `online_status`、`last_error_code`（可为 null）、`latest_comment_sync_at`（可为 null）三个字段。
2. 响应 HTTP 200，`success: true`，字段类型正确（`online_status` 为字符串枚举，时间戳为 ISO 8601 或 null）。
3. 无 tenant 时返回 401/400（不泄露跨租户数据）。

---

## E2E 验收

对应 golden-path-2-smoke.sh Step 15-20（服务端等价断言）。

### Step 15 — 心跳携带 UIA 结果写入 uia_online_status

```bash
# 真机段等价断言（TODO android-evaluator-channel）
curl -s -X POST "$API_BASE/api/agent/heartbeat" \
  -H "x-agent-id: $AGENT_PK" -H "Content-Type: application/json" \
  -d "{\"v\":1,\"msgId\":\"s15-1\",\"ts\":$(date +%s),\"type\":\"heartbeat\",\"payload\":{\"uptime\":100,\"busy\":false,\"uia_online_status\":\"online\",\"account_uia_results\":[{\"account_label\":\"$BURNER_LABEL\",\"uia_status\":\"online\"}]}}"
UIA=$(psql "$DB_URL" -tAc "SELECT uia_online_status FROM zenithjoy.agent_platform_sessions WHERE account_label='$BURNER_LABEL' AND agent_id='$AGENT_PK_UUID'")
[ "$UIA" = "online" ] || fail "Step 15 uia_online_status 未写入 online"
ok "Step 15 ✅ uia_online_status=online 已写入"
```

### Step 16 — UIA 判离线覆盖心跳在线误判

```bash
curl -s -X POST "$API_BASE/api/agent/heartbeat" \
  -H "x-agent-id: $AGENT_PK" -H "Content-Type: application/json" \
  -d "{\"v\":1,\"msgId\":\"s16-1\",\"ts\":$(date +%s),\"type\":\"heartbeat\",\"payload\":{\"uptime\":200,\"busy\":false,\"account_uia_results\":[{\"account_label\":\"$BURNER_LABEL\",\"uia_status\":\"offline\"}]}}"
STATUS=$(psql "$DB_URL" -tAc "SELECT status FROM zenithjoy.agent_platform_sessions WHERE account_label='$BURNER_LABEL' AND agent_id='$AGENT_PK_UUID'")
[ "$STATUS" = "offline" ] || fail "Step 16 UIA 离线未覆盖 status"
ok "Step 16 ✅ UIA offline 覆盖 status=offline"
```

### Step 17 — 采集失败 error_code 五分类之一落库

```bash
curl -s -X POST "$API_BASE/api/acquisition/collect/report" \
  -H "x-agent-id: $AGENT_PK" -H "Content-Type: application/json" \
  -d "{\"task_id\":\"$COLLECT_TASK_ID\",\"status\":\"failed\",\"error_code\":\"KEYWORD_NO_RESULT\"}"
ERR=$(psql "$DB_URL" -tAc "SELECT error_code FROM zenithjoy.acquisition_collect_tasks WHERE id='$COLLECT_TASK_ID'")
[ "$ERR" = "KEYWORD_NO_RESULT" ] || fail "Step 17 error_code 未落库"
ok "Step 17 ✅ error_code=KEYWORD_NO_RESULT 落库"
```

### Step 18 — 评论新回复写入 acquisition_leads.latest_reply

```bash
curl -s -X POST "$API_BASE/api/agent/burner/crawl-comments-result" \
  -H "x-agent-id: $AGENT_PK" -H "Content-Type: application/json" \
  -d "{\"task_id\":\"$CRAWL_TASK_ID\",\"comments\":[{\"commenter_id\":\"MS4wTest\",\"text\":\"很好\"}],\"latest_reply\":\"测试回复内容\",\"latest_reply_at\":\"2026-07-22T10:00:00Z\"}"
REPLY=$(psql "$DB_URL" -tAc "SELECT latest_reply FROM zenithjoy.acquisition_leads WHERE collect_task_id='$CRAWL_TASK_ID' LIMIT 1")
[ -n "$REPLY" ] || fail "Step 18 latest_reply 仍为 NULL（死列未修复）"
REPLY_AT=$(psql "$DB_URL" -tAc "SELECT latest_reply_at FROM zenithjoy.acquisition_leads WHERE collect_task_id='$CRAWL_TASK_ID' LIMIT 1")
[ -n "$REPLY_AT" ] || fail "Step 18 latest_reply_at 仍为 NULL"
ok "Step 18 ✅ latest_reply + latest_reply_at 已写入"
```

### Step 19 — 触达前二次检测 gap 回退 pending_dispatch

```bash
# 构造场景：assignment=queued，但对应 burner 已离线
# 服务端 mock 等价断言（TODO android-evaluator-channel: 真机段由 Android 通道接管）
psql "$DB_URL" -c "UPDATE zenithjoy.agent_platform_sessions SET status='offline', uia_online_status='offline' WHERE account_label='$BURNER_LABEL' AND agent_id='$AGENT_PK_UUID'"
node -e "
const { dispatchDue } = require('./apps/api/dist/services/acquisition-dispatch');
dispatchDue(pool, '$TENANT_ID', new Date()).then(r => { process.stdout.write(JSON.stringify(r)); process.exit(0); });
" 2>/dev/null || true
REQUEUED=$(psql "$DB_URL" -tAc "SELECT count(*) FROM zenithjoy.dm_assignments WHERE status='pending_dispatch' AND tenant_id='$TENANT_ID'")
[ "$REQUEUED" -ge 1 ] || fail "Step 19 gap 离线账号未回退 pending_dispatch"
ok "Step 19 ✅ 离线账号 assignment 已回退 pending_dispatch"
```

### Step 20 — account-signal 端点字段完整性

```bash
S20_TMP=$(mktemp)
curl -s "$API_BASE/api/acquisition/account-signal" \
  -H "X-Tenant-Id: $TENANT_ID" -o "$S20_TMP"
python3 -c "
import json, sys
d = json.load(open(sys.argv[1]))
assert d.get('success') == True, 'success 字段缺失'
sessions = d['data']['sessions']
assert len(sessions) >= 1, 'sessions 为空'
s = sessions[0]
assert 'online_status' in s, 'online_status 字段缺失'
assert 'last_error_code' in s, 'last_error_code 字段缺失'
assert 'latest_comment_sync_at' in s, 'latest_comment_sync_at 字段缺失'
print('account-signal 端点字段完整:', s)
" "$S20_TMP" || fail "Step 20 account-signal 端点字段不完整"
ok "Step 20 ✅ online_status + last_error_code + latest_comment_sync_at 全齐"
```

---

## 未覆盖真实链路清单

| 编号 | 未覆盖场景 | 原因 | 等价断言类型 | TODO 标记 |
|------|-----------|------|------------|-----------|
| UC-1 | Android APK 真机上报 UIA 探测结果 | Android Kotlin 代码不在本 sprint 范围；真机联调需 Android 通道 | 服务端 curl 等价（Step 15-16） | `TODO android-evaluator-channel` |
| UC-2 | `dispatchDue` 真实 WebSocket 派单消息不发出（gap 回退验证） | WebSocket 连接在 CI 环境无真实 Agent 客户端 | psql 查 `dm_assignments.status='pending_dispatch'` 等价（Step 19） | `TODO android-evaluator-channel` |
| UC-3 | 多账号并发心跳 UIA 上报竞争写入 | CI 环境单进程，无并发负载 | 单进程串行顺序上报等价测试 | `TODO concurrency-stress-test` |
| UC-4 | 评论回复增量识别（与上次任务 `latest_reply_at` 比较） | 依赖真实抖音评论区时间线，CI 无法模拟 | 固定 mock `latest_reply_at` 字段插入等价（Step 18） | `TODO android-evaluator-channel` |
| UC-5 | `dm_assignments` 回退次数上限 3 次后标 `failed` | 需多轮 `dispatchDue` 调用且每轮账号均离线 | Vitest mock 循环调用等价（unit test） | `TODO multi-round-dispatch-test` |
| UC-6 | 心跳超时（2分钟无心跳）→ 直接判离线路径 | CI 无法等待真实超时，需 mock 时间 | Vitest mock `Date.now()` 等价（unit test） | `TODO heartbeat-timeout-mock` |

---

## Invariant 对齐声明

实现必须满足以下不变量（已从现有代码/DB 验证）：

1. `agent_platform_sessions.status` CHECK 约束现有值 `pending | active | expired | offline | connected`（migration 20260507 + 20260524），新增 `uia_online_status` 为独立列，不修改现有 `status` CHECK 约束。
2. `acquisition_collect_tasks.error_code` 无 DB CHECK 约束（应用层约定），五分类枚举不加 DB 约束。
3. `acquisition_leads.latest_reply` / `latest_reply_at` 全仓库无写入路径（死列），本次必须补写入路径。
4. golden-path-2-smoke.sh Step 1-14 保持全绿，新增 Step 15-20 不得破坏已有步骤。
5. 心跳超时门限 `last_heartbeat_at > NOW() - INTERVAL '5 minutes'`（agent-context.ts 第 86 行），在线判定复用此常量。
6. `buildAssignments` burner 查询：`WHERE s.role='burner' AND s.status='active'`（acquisition-dispatch.ts 第 381 行），二次检测复用同一逻辑。
7. `dm_assignments` 状态机：`pending_dispatch → queued → dispatched → sent | failed`，gap 回退只写 `pending_dispatch`。
8. `crawl-comments-result` 协议向前兼容，`latest_reply` / `latest_reply_at` 为可选字段追加。

---

_生成时间: 2026-07-22_
_Sprint PRD 版本: sprints/07212317-android-signal-reporting/sprint-prd.md_
