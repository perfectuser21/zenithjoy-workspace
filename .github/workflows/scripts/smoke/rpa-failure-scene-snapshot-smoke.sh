#!/usr/bin/env bash
# rpa-failure-scene-snapshot-smoke.sh
# AI on-call 横切件 · 刀1：失败现场第三件（无障碍树快照）+ 设备版本三件套落正表
#
# 验证点：
#   1. dm_outreach_log 四新列存在（migration 已跑）
#   2. /dm-outreach-result 携带 ui_tree_snapshot/device_model/os_version/app_version
#      → 全部落进正表该行（不是 JSONB，人和后续 AI 管线直接可查）
#   3. 30 天保留期：写入时顺手把 30 天前的旧快照置 NULL，新快照保留
#      （只清重列，error_code/foreground_pkg/failure_diag 永久保留）
#
# Android 端序列化/截断由 JVM 单测守（UiTreeSnapshotTest / FailureSceneTest /
# FailureSceneSnapshotWiringTest），本 smoke 只守"中台落库"这半程。

set -euo pipefail

API_BASE="${API_BASE:-http://localhost:5200}"
DB="${DB_URL:-${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/zenithjoy_test}}"

ok()   { echo "✅ $1"; }
fail() { echo "❌ $1"; exit "${2:-1}"; }

# ── 1. 四新列存在 ──
for col in ui_tree_snapshot device_model os_version app_version; do
  GOT=$(psql "$DB" -At -c "SELECT column_name FROM information_schema.columns WHERE table_schema='zenithjoy' AND table_name='dm_outreach_log' AND column_name='$col'")
  [ "$GOT" = "$col" ] || fail "dm_outreach_log.$col 列缺失（migration 未跑或漂移）"
done
ok "dm_outreach_log 四新列齐（ui_tree_snapshot/device_model/os_version/app_version）"

# ── 2. 直插最小前置（不走 dispatch——本 smoke 只守上报→正表半程）──
TENANT_ID=$(psql "$DB" -At -c "INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ('snap-smoke-${RANDOM}-$$', 'snap-tkey-${RANDOM}-$$', 'free') RETURNING id" | grep -oE '[0-9a-f-]{36}' | head -1)
[ -n "$TENANT_ID" ] || fail "前置：建 tenant 失败" 99

AGENT_ID=$(psql "$DB" -At -c "INSERT INTO zenithjoy.agents (tenant_id, agent_id, capabilities, status) VALUES ('$TENANT_ID', 'snap-agent-$$', ARRAY['android'], 'online') RETURNING id" | grep -oE '[0-9a-f-]{36}' | head -1)
LEAD_ID=$(psql "$DB" -At -c "INSERT INTO zenithjoy.acquisition_leads (tenant_id, sec_uid, nickname, profile_url, relevance_score) VALUES ('$TENANT_ID','sec_snap','快照客户','https://www.douyin.com/user/sec_snap', 90) RETURNING id" | grep -oE '[0-9a-f-]{36}' | head -1)
ASSIGN_ID=$(psql "$DB" -At -c "INSERT INTO zenithjoy.dm_assignments (tenant_id, lead_id, account_label, status, scheduled_for) VALUES ('$TENANT_ID', '$LEAD_ID', 'snap-号1', 'dispatched', NOW()) RETURNING id" | grep -oE '[0-9a-f-]{36}' | head -1)
[ -n "$ASSIGN_ID" ] || fail "前置：建 dm_assignment 失败" 99

psql "$DB" -c "INSERT INTO zenithjoy.dm_outreach_log (tenant_id, account_label, lead_id, profile_url, status, assignment_id) VALUES ('$TENANT_ID', 'snap-号1', '$LEAD_ID', 'https://www.douyin.com/user/sec_snap', 'dispatched', '$ASSIGN_ID')" >/dev/null

# 40 天前的旧失败行：带旧快照，等着被保留期闸清掉
# （label 用 snap-号2——dm_assignments 有 (tenant,lead,label) 唯一约束）
OLD_ASSIGN_ID=$(psql "$DB" -At -c "INSERT INTO zenithjoy.dm_assignments (tenant_id, lead_id, account_label, status, scheduled_for) VALUES ('$TENANT_ID', '$LEAD_ID', 'snap-号2', 'failed', NOW() - interval '40 days') RETURNING id" | grep -oE '[0-9a-f-]{36}' | head -1)
psql "$DB" -c "INSERT INTO zenithjoy.dm_outreach_log (tenant_id, account_label, lead_id, status, sent_at, assignment_id, ui_tree_snapshot) VALUES ('$TENANT_ID', 'snap-号2', '$LEAD_ID', 'failed', NOW() - interval '40 days', '$OLD_ASSIGN_ID', 'd0 stale-tree')" >/dev/null

TASK_ID=$(psql "$DB" -At -c "INSERT INTO zenithjoy.publish_tasks (tenant_id, agent_id, platform, task_type, status, payload) VALUES ('$TENANT_ID', '$AGENT_ID', 'douyin', 'dm_outreach', 'dispatched', jsonb_build_object('account_label','snap-号1','profile_url','https://www.douyin.com/user/sec_snap','dm_assignment_id','$ASSIGN_ID')) RETURNING id" | grep -oE '[0-9a-f-]{36}' | head -1)
[ -n "$TASK_ID" ] || fail "前置：建 publish_task 失败" 99

# ── 3. 失败回传携带快照 + 设备版本 ──
# 注意：这串会被内嵌进 JSON 字符串，不能带裸双引号
SNAP_LINE='d0 android.widget.FrameLayout id=- click bounds=[0,0][1080,2400]'
curl -sf -X POST "$API_BASE/api/agent/burner/dm-outreach-result" -H "Content-Type: application/json" \
  -d "{\"task_id\":\"$TASK_ID\",\"agent_id\":\"$AGENT_ID\",\"account_label\":\"snap-号1\",\"status\":\"failed\",\"error_code\":\"NO_MATCH\",\"foreground_pkg\":\"com.ss.android.ugc.aweme\",\"failure_diag\":\"matchProfileByDouyinId 零匹配\",\"ui_tree_snapshot\":\"$SNAP_LINE\",\"device_model\":\"HONOR TEST-AN00\",\"os_version\":\"Android 16 (API 36)\",\"app_version\":\"2.1.36\",\"device_platform\":\"android\",\"dm_assignment_id\":\"$ASSIGN_ID\"}" >/dev/null \
  || fail "dm-outreach-result 回传失败"

ROW=$(psql "$DB" -At -F'|' -c "SELECT status, error_code, device_model, os_version, app_version, COALESCE(ui_tree_snapshot,'') FROM zenithjoy.dm_outreach_log WHERE assignment_id='$ASSIGN_ID'")
STATUS=$(echo "$ROW" | cut -d'|' -f1)
DM=$(echo "$ROW" | cut -d'|' -f3)
OSV=$(echo "$ROW" | cut -d'|' -f4)
AV=$(echo "$ROW" | cut -d'|' -f5)
TREE=$(echo "$ROW" | cut -d'|' -f6-)
[ "$STATUS" = "failed" ] || fail "status 应=failed 实得 $STATUS"
[ "$DM" = "HONOR TEST-AN00" ] || fail "device_model 未落正表，实得 '$DM'"
[ "$OSV" = "Android 16 (API 36)" ] || fail "os_version 未落正表，实得 '$OSV'"
[ "$AV" = "2.1.36" ] || fail "app_version 未落正表，实得 '$AV'"
echo "$TREE" | grep -q 'android.widget.FrameLayout' || fail "ui_tree_snapshot 未落正表，实得 '$TREE'"
ok "树快照 + 设备版本三件套全部落进正表"

# ── 4. 保留期闸：40 天前的旧快照被清，新快照保留，其余现场字段不动 ──
OLD_TREE=$(psql "$DB" -At -c "SELECT COALESCE(ui_tree_snapshot,'<null>') FROM zenithjoy.dm_outreach_log WHERE assignment_id='$OLD_ASSIGN_ID'")
[ "$OLD_TREE" = "<null>" ] || fail "30 天保留期未生效：40 天前的旧快照仍在（'$OLD_TREE'）"
NEW_TREE=$(psql "$DB" -At -c "SELECT COALESCE(ui_tree_snapshot,'<null>') FROM zenithjoy.dm_outreach_log WHERE assignment_id='$ASSIGN_ID'")
[ "$NEW_TREE" != "<null>" ] || fail "保留期闸误伤：30 天内的新快照被清掉了"
OLD_STATUS=$(psql "$DB" -At -c "SELECT status FROM zenithjoy.dm_outreach_log WHERE assignment_id='$OLD_ASSIGN_ID'")
[ "$OLD_STATUS" = "failed" ] || fail "保留期闸只许清快照列，不许动其他字段（status 变成了 $OLD_STATUS）"
ok "30 天保留期闸生效：旧快照清、新快照留、其余字段不动"

echo "🎉 rpa-failure-scene-snapshot smoke 全部通过"
