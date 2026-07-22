# Contract DoD — Android Agent 信号上报能力

**Task**: f08ab898-2090-4ffb-9aaa-a48c320d42d2
**Sprint**: 07212317-android-signal-reporting
**Date**: 2026-07-22

---

## DoD 条目（共 9 条 [BEHAVIOR]）

### FR-1 小号在线状态双信号

[BEHAVIOR-1] UIA 在线信号写入
场景：POST `/api/agent/burner/uia-signal` Header `x-agent-id=<valid_agent_uuid>` Body `{ account_label: "burner_001", uia_online: true }`
期望：
- HTTP 200 `{ success: true }`
- DB `zenithjoy.agent_platform_sessions` 对应行 `uia_online=true`、`uia_checked_at` 非 NULL

```bash
# manual:bash
AGENT_UUID="<valid_agent_uuid>"
HTTP=$(curl -s -o /tmp/r1.json -w "%{http_code}" -X POST \
  -H "x-agent-id: $AGENT_UUID" -H "Content-Type: application/json" \
  -d '{"account_label":"burner_001","uia_online":true}' \
  "$API_BASE/api/agent/burner/uia-signal")
[ "$HTTP" = "200" ] || { echo "FAIL HTTP=$HTTP"; cat /tmp/r1.json; exit 1; }
UIA=$(psql "$DB_URL" -At -c "SELECT uia_online FROM zenithjoy.agent_platform_sessions WHERE account_label='burner_001' LIMIT 1")
[ "$UIA" = "t" ] || { echo "FAIL uia_online=$UIA expected t"; exit 1; }
echo "PASS BEHAVIOR-1"
```

---

[BEHAVIOR-2] UIA 掉线信号覆盖心跳
场景：POST `/api/agent/burner/uia-signal` Body `{ account_label: "burner_001", uia_online: false }`（机器心跳仍在 2min 窗口内）
期望：
- HTTP 200 `{ success: true }`
- DB `agent_platform_sessions.status = 'offline'`（UIA 强制覆盖）
- DB `uia_online = false`

```bash
# manual:bash
HTTP=$(curl -s -o /tmp/r2.json -w "%{http_code}" -X POST \
  -H "x-agent-id: $AGENT_UUID" -H "Content-Type: application/json" \
  -d '{"account_label":"burner_001","uia_online":false}' \
  "$API_BASE/api/agent/burner/uia-signal")
[ "$HTTP" = "200" ] || { echo "FAIL HTTP=$HTTP"; exit 1; }
ST=$(psql "$DB_URL" -At -c "SELECT status FROM zenithjoy.agent_platform_sessions WHERE account_label='burner_001' LIMIT 1")
[ "$ST" = "offline" ] || { echo "FAIL status=$ST expected offline"; exit 1; }
echo "PASS BEHAVIOR-2"
```

---

[BEHAVIOR-3] GET /sessions 三级判定返回 computed_online_status
场景：GET `/api/agent/burner/sessions`（tenant 鉴权）
期望：
- 返回 JSON 含 `sessions` 数组，每项包含字段：`computed_online_status`（值 `online|offline|unknown`）、`heartbeat_online`（布尔）、`uia_online`（布尔或 null）、`uia_checked_at`（字符串或 null）、`uia_error`（字符串或 null）
- UIA 上报过 `false` 的小号 → `computed_online_status: "offline"`

```bash
# manual:bash
HTTP=$(curl -s -o /tmp/r3.json -w "%{http_code}" -b "$COOKIES" "$API_BASE/api/agent/burner/sessions")
[ "$HTTP" = "200" ] || { echo "FAIL HTTP=$HTTP"; exit 1; }
STATUS=$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(d['data']['sessions'][0]['computed_online_status'])" /tmp/r3.json 2>/dev/null)
[[ "$STATUS" =~ ^(online|offline|unknown)$ ]] || { echo "FAIL computed_online_status=$STATUS"; exit 1; }
echo "PASS BEHAVIOR-3 computed_online_status=$STATUS"
```

---

### FR-2 采集失败五分类落库

[BEHAVIOR-4] 枚举内 error_code 原值落库
场景：POST `/api/acquisition/collect/report` Body 含 `reason: { "search_result": "empty", "error_code": "KEYWORD_NO_RESULT" }`
期望：
- HTTP 200
- DB `acquisition_collect_tasks.error_code = 'KEYWORD_NO_RESULT'`

```bash
# manual:bash
HTTP=$(curl -s -o /tmp/r4.json -w "%{http_code}" \
  -H "x-agent-id: $AGENT_UUID" -H "Content-Type: application/json" \
  -d "{\"task_id\":\"$TASK_ID\",\"comments\":[],\"reason\":{\"search_result\":\"empty\",\"error_code\":\"KEYWORD_NO_RESULT\"}}" \
  "$API_BASE/api/acquisition/collect/report")
[ "$HTTP" = "200" ] || { echo "FAIL HTTP=$HTTP $(cat /tmp/r4.json)"; exit 1; }
EC=$(psql "$DB_URL" -At -c "SELECT error_code FROM zenithjoy.acquisition_collect_tasks WHERE id='$TASK_ID'")
[ "$EC" = "KEYWORD_NO_RESULT" ] || { echo "FAIL error_code=$EC expected KEYWORD_NO_RESULT"; exit 1; }
echo "PASS BEHAVIOR-4"
```

---

[BEHAVIOR-5] 非枚举 error_code 强制降级为 UNKNOWN
场景：POST `/api/acquisition/collect/report` Body `reason.error_code = "搜索失败"`（非白名单值）
期望：
- HTTP 200（不拒绝请求）
- DB `acquisition_collect_tasks.error_code = 'UNKNOWN'`
- 服务端日志出现 `[acquisition] error_code normalized: UNKNOWN`

```bash
# manual:bash
HTTP=$(curl -s -o /tmp/r5.json -w "%{http_code}" \
  -H "x-agent-id: $AGENT_UUID" -H "Content-Type: application/json" \
  -d "{\"task_id\":\"$TASK_ID2\",\"comments\":[],\"reason\":{\"search_result\":\"empty\",\"error_code\":\"搜索失败\"}}" \
  "$API_BASE/api/acquisition/collect/report")
[ "$HTTP" = "200" ] || { echo "FAIL HTTP=$HTTP"; exit 1; }
EC=$(psql "$DB_URL" -At -c "SELECT error_code FROM zenithjoy.acquisition_collect_tasks WHERE id='$TASK_ID2'")
[ "$EC" = "UNKNOWN" ] || { echo "FAIL error_code=$EC expected UNKNOWN"; exit 1; }
echo "PASS BEHAVIOR-5"
```

---

### FR-3 评论最新回复写入

[BEHAVIOR-6] latest_reply 首次写入
场景：POST `/api/acquisition/collect/report` 含 `latest_reply: "这个有链接吗？"` + `latest_reply_at: "2026-07-22T09:30:00Z"`
期望：
- HTTP 200
- DB `acquisition_leads.latest_reply = '这个有链接吗？'`
- DB `acquisition_leads.latest_reply_at = '2026-07-22T09:30:00Z'`

```bash
# manual:bash
HTTP=$(curl -s -o /tmp/r6.json -w "%{http_code}" \
  -H "x-agent-id: $AGENT_UUID" -H "Content-Type: application/json" \
  -d "{\"task_id\":\"$TASK_ID\",\"comments\":[{\"comment_id\":\"c001\",\"user_id\":\"u001\",\"content\":\"test\"}],\"latest_reply\":\"这个有链接吗？\",\"latest_reply_at\":\"2026-07-22T09:30:00Z\"}" \
  "$API_BASE/api/acquisition/collect/report")
[ "$HTTP" = "200" ] || { echo "FAIL HTTP=$HTTP $(cat /tmp/r6.json)"; exit 1; }
REPLY=$(psql "$DB_URL" -At -c "SELECT latest_reply FROM zenithjoy.acquisition_leads WHERE task_id='$TASK_ID' ORDER BY created_at DESC LIMIT 1")
[ "$REPLY" = "这个有链接吗？" ] || { echo "FAIL latest_reply='$REPLY'"; exit 1; }
echo "PASS BEHAVIOR-6"
```

---

[BEHAVIOR-7] latest_reply 旧时间戳不覆盖新值
场景：已有 `latest_reply_at = '2026-07-22T09:30:00Z'`，重复上报旧时间戳 `latest_reply_at = '2026-07-01T00:00:00Z'`
期望：
- HTTP 200
- DB `latest_reply_at` 保持 `'2026-07-22T09:30:00Z'`（不被覆盖）

```bash
# manual:bash
HTTP=$(curl -s -o /tmp/r7.json -w "%{http_code}" \
  -H "x-agent-id: $AGENT_UUID" -H "Content-Type: application/json" \
  -d "{\"task_id\":\"$TASK_ID\",\"comments\":[{\"comment_id\":\"c002\",\"user_id\":\"u002\",\"content\":\"test2\"}],\"latest_reply\":\"旧回复\",\"latest_reply_at\":\"2026-07-01T00:00:00Z\"}" \
  "$API_BASE/api/acquisition/collect/report")
[ "$HTTP" = "200" ] || { echo "FAIL HTTP=$HTTP"; exit 1; }
REPLY_AT=$(psql "$DB_URL" -At -c "SELECT latest_reply_at::text FROM zenithjoy.acquisition_leads WHERE task_id='$TASK_ID' ORDER BY created_at DESC LIMIT 1")
[[ "$REPLY_AT" == *"2026-07-22"* ]] || { echo "FAIL latest_reply_at=$REPLY_AT expected 2026-07-22"; exit 1; }
echo "PASS BEHAVIOR-7"
```

---

### FR-4 dispatch 前二次检测

[BEHAVIOR-8] gap 内账号变离线 → dispatch 回退 pending_dispatch
场景：
1. `dm_assignments` 存在 `status='queued'` 行（`account_label='burner_001'`）
2. POST UIA 上报 `uia_online=false`（`agent_platform_sessions.status='offline'`）
3. 触发 `dispatchDue` 执行
期望：
- `dm_assignments.status = 'pending_dispatch'`（不是 `dispatched`）
- 未触发私信发送
- 日志含 `[dispatch] pre-dispatch check: offline, requeued as pending_dispatch`

**FR-4b 调用点澄清**：`getSessionOnlineStatus` 叠加在 `dispatchDue` 逐行处理（Step C/D）之前，不替换 Step A 批量扫描。即对每一条取到的 `queued` 行，在调用私信发送前单独执行一次 `getSessionOnlineStatus`。

```bash
# manual:bash
# 前置：建立 queued dm_assignment（account_label='burner_001'，测试对象）
psql "$DB_URL" -c "INSERT INTO zenithjoy.dm_assignments
  (tenant_id, agent_id, account_label, status, created_at, updated_at)
  VALUES ('$TENANT_ID', '$AGENT_UUID', 'burner_001', 'queued', NOW(), NOW())
  ON CONFLICT DO NOTHING"

# Step 1：触发 dispatchDue（真机段等价断言）
HTTP=$(curl -s -o /tmp/r8b.json -w "%{http_code}" -X POST \
  -H "Authorization: Bearer $TOKEN" \
  "$API_BASE/api/acquisition/dispatch/run")
[ "$HTTP" = "200" ] || { echo "FAIL dispatch/run HTTP=$HTTP $(cat /tmp/r8b.json)"; exit 1; }

# Step 2：验证 DB 状态（服务端等价断言，真机发送段为 Android 通道待建）
ST=$(psql "$DB_URL" -At -c "SELECT status FROM zenithjoy.dm_assignments WHERE account_label='burner_001' AND tenant_id='$TENANT_ID' ORDER BY updated_at DESC LIMIT 1")
[ "$ST" = "pending_dispatch" ] || { echo "FAIL dm_assignments.status=$ST expected pending_dispatch"; exit 1; }
echo "PASS BEHAVIOR-8 (api-layer equivalent assertion)"
```

---

### FR-5 信号验证 API

[BEHAVIOR-9] signal-verify 返回三组数据完整性
场景：GET `/api/acquisition/signal-verify`（Bearer token 鉴权，前置步骤已写入信号数据）
期望：
- HTTP 200
- `burner_sessions` 数组非空，首项含 `computed_online_status`（值在 `online|offline|unknown`）
- `recent_collect_errors` 数组非空，首项含 `error_code`（值在枚举白名单内）
- `recent_lead_replies` 数组非空，首项含 `latest_reply_at` 非空

```bash
# manual:bash
HTTP=$(curl -s -o /tmp/r9.json -w "%{http_code}" \
  -H "Authorization: Bearer $TOKEN" \
  "$API_BASE/api/acquisition/signal-verify")
[ "$HTTP" = "200" ] || { echo "FAIL HTTP=$HTTP $(cat /tmp/r9.json)"; exit 1; }
python3 - <<'PY'
import json, sys
d = json.load(open('/tmp/r9.json'))['data']
assert len(d['burner_sessions']) > 0, "burner_sessions empty"
assert d['burner_sessions'][0]['computed_online_status'] in ('online','offline','unknown')
assert len(d['recent_collect_errors']) > 0, "recent_collect_errors empty"
assert d['recent_collect_errors'][0]['error_code'] is not None
assert len(d['recent_lead_replies']) > 0, "recent_lead_replies empty"
assert d['recent_lead_replies'][0]['latest_reply_at'] is not None
print("PASS BEHAVIOR-9")
PY
```

---

## 验收命令汇总（manual:bash）

```bash
# 前置：设置环境变量
API_BASE="http://localhost:5200"
DB_URL="postgresql://cecelia:cecelia@localhost:5432/cecelia"
# AGENT_UUID / TENANT_ID / TASK_ID / TOKEN 由 smoke 脚本前置步骤注册获取

# 运行 golden-path-2-smoke.sh（Step 24-28，Step 1-23 为前序 sprint）
bash .github/workflows/scripts/smoke/golden-path-2-smoke.sh
# 退出码 0 = PASS；非零 = 第 N 步红
```

---

## CI 要求

- `windows_cloud` runner 必须全绿
- `golden-path-2-smoke.sh` Step 24-28 全部通过（Step 1-23 为前序 sprint，不得回退）
- vitest 新增测试：FR-1/FR-2/FR-3/FR-4 各有对应 supertest 单元测试
- FR-4 dispatch 二次检测必须有 mock 离线场景断言（`acquisition-dispatch.test.ts`）

---

## 判定点覆盖矩阵

| FR | [BEHAVIOR] | smoke Step | vitest | 真实链路覆盖 |
|----|-----------|-----------|--------|------------|
| FR-1a Migration | - | Step 24（psql 断言列存在） | 无（DDL） | 完整（psql 查列） |
| FR-1b uia-signal | BEHAVIOR-1,2 | Step 24 | `agent-burner.test.ts` | 服务端完整 |
| FR-1c sessions 三级 | BEHAVIOR-3 | Step 24 | `agent-burner.test.ts` | 服务端完整 |
| FR-2a 枚举定义 | BEHAVIOR-4,5 | Step 25 | `acquisition.test.ts` | 服务端完整 |
| FR-2b error_code 降级 | BEHAVIOR-5 | Step 25 | `acquisition.test.ts` | 服务端完整 |
| FR-3a latest_reply 写入 | BEHAVIOR-6,7 | Step 26 | `acquisition.test.ts` | 服务端完整 |
| FR-3b GET leads 字段 | - | - | 已有 | 已有 |
| FR-4a dispatchDue 二次检测 | BEHAVIOR-8 | Step 27（API 等价） | `acquisition-dispatch.test.ts` | API 层等价（真机 Android 通道待建） |
| FR-4b getSessionOnlineStatus | - | Step 27（间接） | `acquisition-dispatch.test.ts` | 服务端完整 |
| FR-5 signal-verify | BEHAVIOR-9 | Step 28 | `acquisition.test.ts` | 服务端完整 |
