#!/usr/bin/env bash
# line02-dm-dispatch-trigger-smoke.sh
# Line02 评论写库后自动触发DM派发 smoke
#   POST /api/acquisition/comment-score-result 写 leads → auto-trigger buildAssignments → dm_assignments 有记录
#
# 验收：
#   1. comment-score-result 写入 acquisition_leads
#   2. fire-and-forget 自动触发 buildAssignments + dispatchDue
#   3. dm_assignments 表有对应记录（证明 trigger 已执行）
set -uo pipefail

API_BASE="${API_BASE:-http://localhost:5200}"
DB="${DB_URL:-${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/zenithjoy_test}}"

ok()   { echo "✅ $1"; }
fail() { echo "❌ $1"; exit "${2:-1}"; }

# ── 前置：建测试 tenant + burner session（供 buildAssignments 使用）──
TENANT_ID=$(psql "$DB" -At -c "
  INSERT INTO zenithjoy.tenants (name, license_key, plan)
  VALUES ('dm-trig-smoke-$$', 'dm-trig-key-$$', 'free')
  RETURNING id" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
[ -n "$TENANT_ID" ] || fail "前置：建 tenant 失败" 99
echo "    [TENANT_ID=$TENANT_ID]"

AGENT_ID=$(psql "$DB" -At -c "
  INSERT INTO zenithjoy.agents (tenant_id, agent_id, status)
  VALUES ('$TENANT_ID', 'dm-trig-agent-$$', 'online')
  RETURNING id" | grep -oE '[0-9a-f-]{36}' | head -1)
[ -n "$AGENT_ID" ] || fail "前置：建 agent 失败" 99

psql "$DB" -c "
  INSERT INTO zenithjoy.agent_platform_sessions
    (agent_id, platform, account_label, role, status, bound_at)
  VALUES
    ('$AGENT_ID','douyin','burner-trig-1','burner','active', NOW())" >/dev/null \
  || fail "前置：建 burner session 失败" 99
ok "前置：tenant + agent + burner session 就绪"

# ── 1. POST comment-score-result（触发自动 DM 派发）──
RESP=$(curl -fsS -X POST "$API_BASE/api/acquisition/comment-score-result" \
  -H "Content-Type: application/json" \
  -d '{
    "keyword_task_id": "smoke-kw-'"$$"'",
    "video_url": "https://www.douyin.com/video/7639980779505871013",
    "comments": [
      {"commenter_id": "/user/sec_smoke_1", "text": "请问这个怎么联系您呢", "grade": "精准"},
      {"commenter_id": "/user/sec_smoke_2", "text": "有意向合作", "grade": "感兴趣"}
    ]
  }')
echo "$RESP" | jq -er '.received == true and .written_count >= 1' >/dev/null \
  || fail "comment-score-result 应 received=true written_count>=1 — $RESP" 1
WRITTEN=$(echo "$RESP" | jq -r '.written_count')
ok "POST comment-score-result → written_count=$WRITTEN"

# ── 2. 等 fire-and-forget 执行完（最多 5s）──
for i in 1 2 3 4 5; do
  DB_LEADS=$(psql "$DB" -At -c "SELECT count(*) FROM zenithjoy.acquisition_leads WHERE tenant_id='$TENANT_ID'" 2>/dev/null || echo 0)
  [ "$DB_LEADS" -ge 1 ] && break
  sleep 1
done

# ── 3. acquisition_leads 落库校验 ──
DB_LEADS=$(psql "$DB" -At -c "SELECT count(*) FROM zenithjoy.acquisition_leads WHERE tenant_id='$TENANT_ID'")
[ "$DB_LEADS" -ge 1 ] || fail "acquisition_leads 应有>=1 行，实得 $DB_LEADS" 1
ok "acquisition_leads 落库 $DB_LEADS 条"

# ── 4. 验证 buildAssignments 被触发（dm_assignments 有记录）──
for i in 1 2 3 4 5; do
  DB_ASSIGN=$(psql "$DB" -At -c "SELECT count(*) FROM zenithjoy.dm_assignments WHERE tenant_id='$TENANT_ID'" 2>/dev/null || echo 0)
  [ "$DB_ASSIGN" -ge 1 ] && break
  sleep 1
done
DB_ASSIGN=$(psql "$DB" -At -c "SELECT count(*) FROM zenithjoy.dm_assignments WHERE tenant_id='$TENANT_ID'")
[ "$DB_ASSIGN" -ge 1 ] || fail "dm_assignments 应有>=1 行（buildAssignments 已触发），实得 $DB_ASSIGN" 1
ok "dm_assignments 自动生成 $DB_ASSIGN 条（trigger 闭环验证通过）"

# ── 清理 ──
psql "$DB" -c "DELETE FROM zenithjoy.dm_assignments    WHERE tenant_id='$TENANT_ID'" >/dev/null 2>&1 || true
psql "$DB" -c "DELETE FROM zenithjoy.acquisition_leads WHERE tenant_id='$TENANT_ID'" >/dev/null 2>&1 || true
psql "$DB" -c "DELETE FROM zenithjoy.agent_platform_sessions WHERE agent_id='$AGENT_ID'" >/dev/null 2>&1 || true
psql "$DB" -c "DELETE FROM zenithjoy.agents WHERE id='$AGENT_ID'"  >/dev/null 2>&1 || true
psql "$DB" -c "DELETE FROM zenithjoy.tenants WHERE id='$TENANT_ID'" >/dev/null 2>&1 || true

echo "✅ line02-dm-dispatch-trigger smoke ALL PASS"
