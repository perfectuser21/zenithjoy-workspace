#!/usr/bin/env bash
# douyin-dm-outreach-android-smoke.sh
# 抖音私信主动触达 · Android 无障碍执行路径 smoke（sprint 07052218-douyin-dm-outreach-android）
#
# 验证点：
#   1. 派单按 agent.capabilities 标记 publish_tasks.payload.device_platform=android
#   2. 话术复用 acquisition_config.dm_message，不新增平行字段
#   3. /dm-outreach-result 按 dm_assignment_id 幂等：重复回传不重复计数
#   4. outreach-history 联表修复后可见该记录 status=sent（既有 assignment_id 缺列断点已修）
#
# Android 端（频控计数器 DmOutreachRateLimiter + 快照重抓纪律 SnapshotDiscipline）
# 用 gradle :app:testDebugUnitTest 本地/CI 单测验证，见
# services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/collect/
# DmOutreachRateLimiterTest.kt / DmOutreachSnapshotDisciplineTest.kt。

set -euo pipefail

API_BASE="${API_BASE:-http://localhost:5200}"
DB="${DB_URL:-${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/zenithjoy_test}}"

ok()   { echo "✅ $1"; }
fail() { echo "❌ $1"; exit "${2:-1}"; }

# ── Android 端纯逻辑单元测试（本地有 ANDROID_HOME 时跑，CI windows/linux runner 必跑）──
if [ -d services/agent-android ] && [ -n "${ANDROID_HOME:-}" ]; then
  pushd services/agent-android >/dev/null
  gradle :app:testDebugUnitTest --tests "*DmOutreachRateLimiterTest*" --tests "*DmOutreachSnapshotDisciplineTest*" --rerun
  for f in app/build/test-results/testDebugUnitTest/TEST-com.zenithjoy.agent.collect.DmOutreachRateLimiterTest.xml \
           app/build/test-results/testDebugUnitTest/TEST-com.zenithjoy.agent.collect.DmOutreachSnapshotDisciplineTest.xml; do
    grep -q 'failures="0" errors="0"' "$f" || fail "Android 单测未全绿: $f"
  done
  popd >/dev/null
  ok "Android 频控 + 快照重抓纪律单测全绿"
else
  echo "⚠️  ANDROID_HOME 未配置，跳过本地 gradle 验证（CI windows/linux runner 上必须跑）"
fi

# ── 中台派单 + 回传 + 幂等 + Dashboard 联表 ──
TENANT_ID=$(psql "$DB" -At -c "INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ('dmand-smoke-${RANDOM}-$$', 'dmand-tkey-${RANDOM}-$$', 'free') RETURNING id" | grep -oE '[0-9a-f-]{36}' | head -1)
[ -n "$TENANT_ID" ] || fail "前置：建 tenant 失败" 99
H_TENANT=(-H "X-Tenant-Id: $TENANT_ID")

ANDROID_AGENT_ID=$(psql "$DB" -At -c "INSERT INTO zenithjoy.agents (tenant_id, agent_id, capabilities, status) VALUES ('$TENANT_ID', 'dmand-android-$$', ARRAY['android'], 'online') RETURNING id" | grep -oE '[0-9a-f-]{36}' | head -1)
WIN_AGENT_ID=$(psql "$DB" -At -c "INSERT INTO zenithjoy.agents (tenant_id, agent_id, capabilities, status) VALUES ('$TENANT_ID', 'dmand-win-$$', ARRAY[]::text[], 'online') RETURNING id" | grep -oE '[0-9a-f-]{36}' | head -1)
[ -n "$ANDROID_AGENT_ID" ] && [ -n "$WIN_AGENT_ID" ] || fail "前置：建双 agent 失败" 99

LABEL_A="andr-号1"; LABEL_W="win-号1"
psql "$DB" -c "INSERT INTO zenithjoy.agent_platform_sessions (agent_id, platform, account_label, role, status, bound_at) VALUES
  ('$ANDROID_AGENT_ID','douyin','$LABEL_A','burner','active', NOW()),
  ('$WIN_AGENT_ID','douyin','$LABEL_W','burner','active', NOW())" >/dev/null

LEAD_A=$(psql "$DB" -At -c "INSERT INTO zenithjoy.acquisition_leads (tenant_id, sec_uid, nickname, profile_url, relevance_score) VALUES ('$TENANT_ID','sec_and','客户Android','https://www.douyin.com/user/sec_and', 90) RETURNING id" | grep -oE '[0-9a-f-]{36}' | head -1)

curl -fsS -X PUT "${H_TENANT[@]}" -H "Content-Type: application/json" \
  -d '{"dm_per_day":30,"dm_per_hour":10,"burner_count":2,"dm_active_start":"00:00","dm_active_end":"23:59","dm_interval_min_sec":1,"dm_interval_max_sec":2}' \
  "$API_BASE/api/acquisition/config" >/dev/null

ASSIGN_ID=$(psql "$DB" -At -c "INSERT INTO zenithjoy.dm_assignments (tenant_id, lead_id, account_label, status, scheduled_for) VALUES ('$TENANT_ID', '$LEAD_A', '$LABEL_A', 'queued', NOW() - interval '1 minute') RETURNING id" | grep -oE '[0-9a-f-]{36}' | head -1)
[ -n "$ASSIGN_ID" ] || fail "前置：建 dm_assignment 失败" 99

curl -fsS -X POST "${H_TENANT[@]}" "$API_BASE/api/acquisition/dispatch/run" >/dev/null || fail "dispatch/run 调用失败"

DEVICE_PLATFORM=$(psql "$DB" -At -c "SELECT payload->>'device_platform' FROM zenithjoy.publish_tasks WHERE task_type='dm_outreach' AND agent_id='$ANDROID_AGENT_ID' ORDER BY created_at DESC LIMIT 1")
[ "$DEVICE_PLATFORM" = "android" ] || fail "device_platform 应为 android，实得 $DEVICE_PLATFORM"
ok "派单正确标记 device_platform=android"

MSG_CHECK=$(psql "$DB" -At -c "SELECT (payload ? 'message') AND NOT (payload ? 'android_message') AND NOT (payload ? 'dm_text') FROM zenithjoy.publish_tasks WHERE task_type='dm_outreach' AND agent_id='$ANDROID_AGENT_ID' ORDER BY created_at DESC LIMIT 1")
[ "$MSG_CHECK" = "t" ] || fail "message 字段复用检查失败 got=$MSG_CHECK"
ok "话术复用 acquisition_config.dm_message，未新增平行字段"

TASK_ID=$(psql "$DB" -At -c "SELECT id FROM zenithjoy.publish_tasks WHERE task_type='dm_outreach' AND agent_id='$ANDROID_AGENT_ID' ORDER BY created_at DESC LIMIT 1")

BEFORE=$(psql "$DB" -At -c "SELECT count(*) FROM zenithjoy.dm_outreach_log WHERE tenant_id='$TENANT_ID' AND account_label='$LABEL_A' AND status='sent'")
curl -sf -X POST "$API_BASE/api/agent/burner/dm-outreach-result" -H "Content-Type: application/json" \
  -d "{\"task_id\":\"$TASK_ID\",\"agent_id\":\"$ANDROID_AGENT_ID\",\"account_label\":\"$LABEL_A\",\"status\":\"sent\",\"profile_url\":\"https://www.douyin.com/user/sec_and\",\"device_platform\":\"android\",\"dm_assignment_id\":\"$ASSIGN_ID\"}" >/dev/null
curl -sf -X POST "$API_BASE/api/agent/burner/dm-outreach-result" -H "Content-Type: application/json" \
  -d "{\"task_id\":\"$TASK_ID\",\"agent_id\":\"$ANDROID_AGENT_ID\",\"account_label\":\"$LABEL_A\",\"status\":\"sent\",\"profile_url\":\"https://www.douyin.com/user/sec_and\",\"device_platform\":\"android\",\"dm_assignment_id\":\"$ASSIGN_ID\"}" >/dev/null
AFTER=$(psql "$DB" -At -c "SELECT count(*) FROM zenithjoy.dm_outreach_log WHERE tenant_id='$TENANT_ID' AND account_label='$LABEL_A' AND status='sent'")
[ "$AFTER" = "$((BEFORE + 1))" ] || fail "幂等失败 before=$BEFORE after=$AFTER"
FINAL_STATUS=$(psql "$DB" -At -c "SELECT status FROM zenithjoy.dm_assignments WHERE id='$ASSIGN_ID'")
[ "$FINAL_STATUS" = "sent" ] || fail "dm_assignments.status 被第二次回传重置，当前=$FINAL_STATUS"
ok "重复回传不重复计数 (before=$BEFORE after=$AFTER)，dm_assignments.status 未被重置=$FINAL_STATUS"

COL=$(psql "$DB" -At -c "SELECT column_name FROM information_schema.columns WHERE table_schema='zenithjoy' AND table_name='dm_outreach_log' AND column_name='assignment_id'")
[ "$COL" = "assignment_id" ] || fail "dm_outreach_log.assignment_id 列未补齐"
HIST=$(curl -sf "${H_TENANT[@]}" "$API_BASE/api/acquisition/dispatch/outreach-history")
echo "$HIST" | jq -e "[.data.items[] | select(.id==\"$ASSIGN_ID\")] | any(.status==\"sent\")" >/dev/null \
  || fail "outreach-history 未见 $ASSIGN_ID status=sent — $HIST"
ok "Dashboard 触达记录页可见该记录 status=sent"

echo "✅ Golden Path 验证通过（Android dm_outreach 执行路径）"
