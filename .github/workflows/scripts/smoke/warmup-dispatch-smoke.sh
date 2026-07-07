#!/usr/bin/env bash
# warmup-dispatch-smoke.sh
# Line02 Path2 Step7 —— warmup 中台调度接线 E2E smoke（纯 curl+psql，CI-capable）
#
# 端到端三段：
#   1) 下发   POST /api/acquisition/warmup/run  → enqueueWarmupTasks 给在线 android burner agent
#             建一条 publish_tasks(task_type='warmup', payload.task_type='warmup') queued 行
#   2) 回传   POST /api/agent/burner/warmup-result  → 设备级按真实昵称 upsert agent_warmup_liveness
#             + publish_tasks 置 done；error_code 空才写 liveness
#   3) 幂等   重复回传同 task_id → publish_tasks 已 done → 短路，不新增 liveness 行
#
# heartbeat 下发链路的 payload.task_type 透传由 vitest 单测覆盖（licenseAuth 不进 bash smoke）。
# 任一断言失败 → exit 非 0。租户上下文走 X-Tenant-Id 头（tenantContextOptional），绝不信 query.tenant_id。

set -uo pipefail

API_BASE="${API_BASE:-http://localhost:5201}"  # 默认 staging(5201) 而非 prod(5200)，防本地误打生产；CI 用 API_BASE 覆盖
DB="${DB_URL:-${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/zenithjoy_test}}"

ok()   { echo "✅ $1"; }
fail() { echo "❌ $1"; exit "${2:-1}"; }

# ── 前置：建 tenant + 在线 android agent + 1 个 active android burner 小号 ──
TENANT_ID=$(psql "$DB" -At -c "INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ('warmup-smoke-${RANDOM}-$$', 'warmup-tkey-${RANDOM}-$$', 'free') RETURNING id" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
[ -n "$TENANT_ID" ] || fail "前置：建 tenant 失败" 99
echo "    [TENANT_ID=$TENANT_ID]"
H_TENANT=(-H "X-Tenant-Id: $TENANT_ID")

AGENT_ID=$(psql "$DB" -At -c "INSERT INTO zenithjoy.agents (tenant_id, agent_id, status, last_heartbeat_at) VALUES ('$TENANT_ID', 'warmup-agent-$$', 'online', NOW()) RETURNING id" | grep -oE '[0-9a-f-]{36}' | head -1)
[ -n "$AGENT_ID" ] || fail "前置：建 agent 失败" 99
# android burner 小号（device_type='android' 是 enqueue 识别 android agent 的锚点）
psql "$DB" -c "INSERT INTO zenithjoy.agent_platform_sessions (agent_id, platform, account_label, role, status, device_type, bound_at) VALUES ('$AGENT_ID','douyin','warmup-burner-1','burner','active','android', NOW())" >/dev/null || fail "前置：建 burner session 失败" 99
ok "前置：在线 android agent + 1 active android burner 就绪"

# ── 1. 下发：POST /api/acquisition/warmup/run ──
RUN=$(curl -fsS -X POST "${H_TENANT[@]}" -H "Content-Type: application/json" -d '{}' "$API_BASE/api/acquisition/warmup/run")
echo "$RUN" | jq -er '.success == true and .data.enqueued >= 1' >/dev/null \
  || fail "warmup/run 应 enqueued>=1 — $RUN" 1
ok "POST warmup/run → enqueued=$(echo "$RUN" | jq -r '.data.enqueued')"

# 落库：publish_tasks 有 task_type='warmup' queued 行 + payload.task_type='warmup'
DB_Q=$(psql "$DB" -At -c "SELECT count(*) FROM zenithjoy.publish_tasks WHERE agent_id='$AGENT_ID' AND task_type='warmup' AND status='queued' AND payload->>'task_type'='warmup'")
[ "$DB_Q" = "1" ] || fail "应有 1 条 warmup queued 行(payload.task_type=warmup)，实得 $DB_Q" 1
TASK_ID=$(psql "$DB" -At -c "SELECT id FROM zenithjoy.publish_tasks WHERE agent_id='$AGENT_ID' AND task_type='warmup' ORDER BY created_at DESC LIMIT 1")
# payload 必含 operator_nickname 键（本 smoke 无 main 号，值为空串亦可）
HAS_OP=$(psql "$DB" -At -c "SELECT (payload ? 'operator_nickname') FROM zenithjoy.publish_tasks WHERE id='$TASK_ID'")
[ "$HAS_OP" = "t" ] || fail "warmup payload 应含 operator_nickname 键 — 实得 $HAS_OP" 1
ok "落库：warmup queued 行就绪(payload.task_type=warmup + operator_nickname 键)"

# 去重：再 run 一次不应再新增（已有 pending/queued）
RUN2=$(curl -fsS -X POST "${H_TENANT[@]}" -H "Content-Type: application/json" -d '{}' "$API_BASE/api/acquisition/warmup/run")
echo "$RUN2" | jq -er '.data.enqueued == 0' >/dev/null || fail "24h/pending 去重失败，第二次 run 仍 enqueued>0 — $RUN2" 1
DB_Q2=$(psql "$DB" -At -c "SELECT count(*) FROM zenithjoy.publish_tasks WHERE agent_id='$AGENT_ID' AND task_type='warmup'")
[ "$DB_Q2" = "1" ] || fail "去重后仍应只有 1 条 warmup 行，实得 $DB_Q2" 1
ok "去重：第二次 run enqueued=0，仍只 1 条 warmup 行"

# ── 2. 回传：POST /api/agent/burner/warmup-result（2 号，1 活 1 掉线）──
RES=$(curl -fsS -X POST -H "Content-Type: application/json" \
  -d "{\"task_id\":\"$TASK_ID\",\"agent_id\":\"$AGENT_ID\",\"device_id\":\"dev-smoke\",\"total\":2,\"alive\":1,\"offline\":1,\"results\":[{\"nickname\":\"大湖成长\",\"alive\":true,\"followers\":1196,\"reason\":\"ok\"},{\"nickname\":\"秦军\",\"alive\":false,\"followers\":null,\"reason\":\"profile_unreadable\"}],\"error_code\":\"\"}" \
  "$API_BASE/api/agent/burner/warmup-result")
echo "$RES" | jq -er '.success == true' >/dev/null || fail "warmup-result 应 success — $RES" 1
# 落库：agent_warmup_liveness 2 行 + 字段正确
DB_L=$(psql "$DB" -At -c "SELECT count(*) FROM zenithjoy.agent_warmup_liveness WHERE agent_id='$AGENT_ID'")
[ "$DB_L" = "2" ] || fail "agent_warmup_liveness 应 2 行，实得 $DB_L" 1
FANS=$(psql "$DB" -At -c "SELECT followers FROM zenithjoy.agent_warmup_liveness WHERE agent_id='$AGENT_ID' AND nickname='大湖成长'")
[ "$FANS" = "1196" ] || fail "大湖成长 followers 应=1196，实得 $FANS" 1
ALIVE_B=$(psql "$DB" -At -c "SELECT alive FROM zenithjoy.agent_warmup_liveness WHERE agent_id='$AGENT_ID' AND nickname='秦军'")
[ "$ALIVE_B" = "f" ] || fail "秦军 alive 应=false，实得 $ALIVE_B" 1
TASK_STATUS=$(psql "$DB" -At -c "SELECT status FROM zenithjoy.publish_tasks WHERE id='$TASK_ID'")
[ "$TASK_STATUS" = "done" ] || fail "warmup task 应置 done，实得 $TASK_STATUS" 1
ok "落库：agent_warmup_liveness 2 行(1196粉/秦军掉线) + publish_tasks done"

# ── 3. 幂等：重复回传同 task_id（已 done）→ 不新增 liveness 行 ──
curl -fsS -X POST -H "Content-Type: application/json" \
  -d "{\"task_id\":\"$TASK_ID\",\"agent_id\":\"$AGENT_ID\",\"total\":2,\"alive\":1,\"offline\":1,\"results\":[{\"nickname\":\"新号\",\"alive\":true,\"followers\":5,\"reason\":\"ok\"}],\"error_code\":\"\"}" \
  "$API_BASE/api/agent/burner/warmup-result" >/dev/null || true
DB_L2=$(psql "$DB" -At -c "SELECT count(*) FROM zenithjoy.agent_warmup_liveness WHERE agent_id='$AGENT_ID'")
[ "$DB_L2" = "2" ] || fail "幂等失败：重复回传后 liveness 行应仍=2，实得 $DB_L2" 1
ok "幂等：重复回传同 task_id 不新增 liveness 行"

# ── 清理 ──
psql "$DB" -c "DELETE FROM zenithjoy.agent_warmup_liveness WHERE agent_id='$AGENT_ID'" >/dev/null 2>&1 || true
psql "$DB" -c "DELETE FROM zenithjoy.publish_tasks WHERE agent_id='$AGENT_ID'" >/dev/null 2>&1 || true
psql "$DB" -c "DELETE FROM zenithjoy.agent_platform_sessions WHERE agent_id='$AGENT_ID'" >/dev/null 2>&1 || true
psql "$DB" -c "DELETE FROM zenithjoy.agents WHERE id='$AGENT_ID'" >/dev/null 2>&1 || true
psql "$DB" -c "DELETE FROM zenithjoy.tenants WHERE id='$TENANT_ID'" >/dev/null 2>&1 || true

echo "✅ warmup-dispatch smoke ALL PASS"
